// Static server for the harness. Usage: node server.mjs [port]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { confirmBackendExecution, connectRequestToHandler, createReactRuntimeIntegration } from '../../analysis/index.mjs';
import { indexWorkflowEpisodes } from '../../analysis/runtime-attribution.mjs';
import { buildEpisodeChain } from '../../analysis/causal-chain.mjs';
import { buildBridgeWorkflow, buildClickFrontierWorkflow } from './bridge-workflow.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const port = Number(process.argv[2] || 8123);
const types = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.mp4': 'video/mp4',
  '.woff2': 'font/woff2',
};

const viewers = new Set();
const recent = [];
const bridgeRecent = [];
const backendSpans = [];
const pendingBackendSpans = [];
const reactObservations = [];
// A production-scale LibreChat navigation emits tens of thousands of React
// records. Retain the complete ancestry needed to validate late cleanup
// observations after generic API observations are added to the same stream.
const maxReactObservations = 100_000;
const bridgeConfigPath = process.env.PRODUCTTRACE_BRIDGE_CONFIG;
const attributionManifestPath = process.env.PRODUCTTRACE_ATTRIBUTION_MANIFEST;
const liveRecordsPath = process.env.PRODUCTTRACE_LIVE_RECORDS;
const backendSpansPath = process.env.PRODUCTTRACE_BACKEND_SPANS;
// Declared, never inferred from missing spans: frontend-only runs set 0.
const backendInstrumented = process.env.PRODUCTTRACE_BACKEND_TELEMETRY !== '0';
const episodeIdleMs = Math.max(100, Number(process.env.PRODUCTTRACE_EPISODE_IDLE_MS || 1500));
let bridge = null;
let attributionManifest = null;
let attributionById = new Map();
const liveRows = [];
const liveCaptureSequences = new Map();
const liveEpisodeFingerprints = new Map();
const liveEpisodeEvidenceFingerprints = new Map();
const liveEpisodeIdleTimers = new Map();
const idleEpisodes = new Set();
const publishedEpisodeIds = new Set();
let livePublishTimer = null;

if (bridgeConfigPath) {
  const config = JSON.parse(fs.readFileSync(path.resolve(bridgeConfigPath), 'utf8'));
  bridge = { config, integration: createReactRuntimeIntegration(config.react_map) };
}
if (attributionManifestPath) {
  attributionManifest = JSON.parse(fs.readFileSync(path.resolve(attributionManifestPath), 'utf8'));
  attributionById = new Map((attributionManifest.functions || []).map(row => [row.id, row]));
}

function broadcast(record) {
  recent.unshift(record);
  if (recent.length > 200) recent.length = 200;
  for (const viewer of viewers) viewer.write(`data: ${JSON.stringify(record)}\n\n`);
}

function liveSource(functionId) {
  const source = attributionById.get(functionId)?.source;
  return source ? { file: source.file, start: source.start, end: source.end } : null;
}

function liveEpisodeRecord(episode, { idle = false } = {}) {
  // One chain assembler shared with the MCP server and harnesses.
  return buildEpisodeChain(episode, liveRows, backendSpans, {
    registeredFunctionIds: attributionManifest?.functions?.map(row => row.id) || null,
    sourceFor: liveSource, idle, sessionId: 'm1-live', backendInstrumented,
  });
}

function publishLiveEpisodes() {
  const indexed = indexWorkflowEpisodes(liveRows);
  const currentEpisodeIds = new Set(indexed.episodes.keys());
  // Episode membership is evidence-derived. An episode never spans two
  // controls (G5 §15), so an opener's card is never absorbed by the dialog,
  // menu or form it rendered; this retraction stays as a guard for any id the
  // current evidence no longer derives, instead of leaving stale cards.
  for (const episodeId of publishedEpisodeIds) {
    if (currentEpisodeIds.has(episodeId)) continue;
    broadcast({ schema: 'producttrace.causal-chain-retraction.v1', kind: 'workflow.retract',
      workflow_id: `causal:${episodeId}`, episode_id: episodeId,
      reason: 'provisional episode was absorbed by the current evidence-derived episode' });
    publishedEpisodeIds.delete(episodeId);
    liveEpisodeFingerprints.delete(episodeId);
    liveEpisodeEvidenceFingerprints.delete(episodeId);
    clearTimeout(liveEpisodeIdleTimers.get(episodeId));
    liveEpisodeIdleTimers.delete(episodeId);
    idleEpisodes.delete(episodeId);
  }
  for (const episode of indexed.episodes.values()) {
    publishedEpisodeIds.add(episode.episode_id);
    const evidenceRecord = liveEpisodeRecord(episode, { idle: false });
    const evidenceFingerprint = JSON.stringify(evidenceRecord);
    if (liveEpisodeEvidenceFingerprints.get(episode.episode_id) !== evidenceFingerprint) {
      liveEpisodeEvidenceFingerprints.set(episode.episode_id, evidenceFingerprint);
      idleEpisodes.delete(episode.episode_id);
      clearTimeout(liveEpisodeIdleTimers.get(episode.episode_id));
      liveEpisodeIdleTimers.delete(episode.episode_id);
      if (evidenceRecord.terminal?.pending === true) liveEpisodeIdleTimers.set(episode.episode_id, setTimeout(() => {
        liveEpisodeIdleTimers.delete(episode.episode_id);
        idleEpisodes.add(episode.episode_id);
        publishLiveEpisodes();
      }, episodeIdleMs));
    }
    const record = liveEpisodeRecord(episode, { idle: idleEpisodes.has(episode.episode_id) });
    const fingerprint = JSON.stringify(record);
    if (liveEpisodeFingerprints.get(episode.episode_id) === fingerprint) continue;
    liveEpisodeFingerprints.set(episode.episode_id, fingerprint);
    broadcast(record);
  }
}

function scheduleLiveEpisodePublish() {
  if (livePublishTimer) return;
  livePublishTimer = setTimeout(() => { livePublishTimer = null; publishLiveEpisodes(); }, 25);
}

function acceptLiveRows(received, pageId = 'default') {
  const seen = liveCaptureSequences.get(pageId) || new Set();
  const accepted = received.filter(row => {
    if (!row || row.internal === true || row.transport_internal === true) return false;
    const sequence = Number(row.sequence);
    if (Number.isFinite(sequence) && seen.has(sequence)) return false;
    if (Number.isFinite(sequence)) seen.add(sequence);
    row.capture_page_id = pageId;
    return true;
  });
  liveCaptureSequences.set(pageId, seen);
  if (liveRecordsPath && accepted.length) fs.appendFileSync(liveRecordsPath, `${accepted.map(row => JSON.stringify(row)).join('\n')}\n`);
  liveRows.push(...accepted);
  const acceptedRequests = accepted.filter(row => row.kind === 'network.request' && row.trace_context?.trace_id);
  const terminalUpdate = accepted.some(row => row.kind === 'network.request' || row.kind === 'dom.mutation'
    || (row.kind === 'dom.action' && ['click', 'submit'].includes(row.event)));
  if (terminalUpdate) publishLiveEpisodes();
  else if (accepted.some(row => row.kind === 'function.enter')) scheduleLiveEpisodePublish();
  if (acceptedRequests.length && pendingBackendSpans.length) {
    const admittedTraces = new Set(acceptedRequests.map(row => row.trace_context.trace_id));
    const admitted = pendingBackendSpans.filter(span => admittedTraces.has(span.trace_id));
    if (admitted.length) {
      backendSpans.unshift(...admitted);
      for (let index = pendingBackendSpans.length - 1; index >= 0; index -= 1) {
        if (admittedTraces.has(pendingBackendSpans[index].trace_id)) pendingBackendSpans.splice(index, 1);
      }
      if (backendSpans.length > 20000) backendSpans.length = 20000;
      publishLiveEpisodes();
    }
  }
}

function acceptBackendSpans(received) {
  const accepted = received.filter(span => span?.schema === 'producttrace.backend-span.v1');
  if (backendSpansPath && accepted.length) fs.appendFileSync(backendSpansPath, `${accepted.map(span => JSON.stringify(span)).join('\n')}\n`);
  const admittedTraces = new Set(liveRows.filter(row => row.kind === 'network.request' && row.trace_context?.trace_id)
    .map(row => row.trace_context.trace_id));
  const admitted = accepted.filter(span => admittedTraces.has(span.trace_id));
  const pending = accepted.filter(span => !admittedTraces.has(span.trace_id));
  backendSpans.unshift(...admitted);
  pendingBackendSpans.push(...pending);
  if (backendSpans.length > 20000) backendSpans.length = 20000;
  if (pendingBackendSpans.length > 20000) pendingBackendSpans.splice(0, pendingBackendSpans.length - 20000);
  if (admitted.length) scheduleLiveEpisodePublish();
}

http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-headers', 'content-type');
  res.setHeader('access-control-allow-methods', 'GET, POST, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }
  if (req.method === 'DELETE' && url.pathname === '/api/demo/events') {
    recent.length = 0;
    bridgeRecent.length = 0;
    backendSpans.length = 0;
    pendingBackendSpans.length = 0;
    reactObservations.length = 0;
    liveRows.length = 0;
    liveCaptureSequences.clear();
    liveEpisodeFingerprints.clear();
    liveEpisodeEvidenceFingerprints.clear();
    publishedEpisodeIds.clear();
    for (const timer of liveEpisodeIdleTimers.values()) clearTimeout(timer);
    liveEpisodeIdleTimers.clear();
    idleEpisodes.clear();
    clearTimeout(livePublishTimer);
    livePublishTimer = null;
    res.writeHead(204);
    return res.end();
  }
  if (req.method === 'GET' && url.pathname === '/api/demo/bridge/latest') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify(bridgeRecent, null, 2));
  }
  if (req.method === 'GET' && url.pathname === '/api/demo/backend-spans/latest') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify(backendSpans, null, 2));
  }
  if (req.method === 'GET' && url.pathname === '/api/demo/react-observations') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify(reactObservations, null, 2));
  }
  if (req.method === 'POST' && url.pathname === '/api/demo/runtime-attribution') {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', chunk => { if (body.length < 8_000_000) body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        const received = Array.isArray(payload) ? payload : (Array.isArray(payload.rows) ? payload.rows : [payload.row || payload]);
        const spans = received.filter(row => row?.schema === 'producttrace.backend-span.v1');
        const rows = received.filter(row => row?.schema !== 'producttrace.backend-span.v1');
        if (spans.length) acceptBackendSpans(spans);
        if (rows.length) acceptLiveRows(rows, payload.page_id || 'default');
        res.writeHead(202, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ accepted: received.length, runtime_rows: rows.length, backend_spans: spans.length }));
      } catch (error) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ accepted: 0, error: error.message }));
      }
    });
    return;
  }
  if (req.method === 'POST' && url.pathname === '/api/demo/react-observations') {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', chunk => { if (body.length < 5_000_000) body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        const received = Array.isArray(payload) ? payload : [payload];
        for (const observation of received) reactObservations.push(observation);
        if (reactObservations.length > maxReactObservations) {
          reactObservations.splice(0, reactObservations.length - maxReactObservations);
        }
        res.writeHead(202, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ accepted: received.length }));
      } catch (error) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ accepted: 0, error: error.message }));
      }
    });
    return;
  }
  if (req.method === 'POST' && url.pathname === '/api/demo/backend-spans') {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', chunk => { if (body.length < 1_000_000) body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        const received = Array.isArray(payload) ? payload : [payload];
        acceptBackendSpans(received);
        let confirmed = 0;
        for (const entry of bridgeRecent) {
          // Database spans may arrive after the handler span. Rejoin each new
          // batch for this trace so the displayed evidence can become complete.
          const traceId = entry.result.request?.trace_context?.trace_id;
          if (!traceId || !received.some(span => span.trace_id === traceId)) continue;
          const next = confirmBackendExecution(entry.result,
            backendSpans.filter(span => span.trace_id === traceId));
          entry.result = next;
          if (next.handler?.backend_execution === 'confirmed') {
            confirmed += 1;
            if (!liveRecordsPath) broadcast(buildBridgeWorkflow(next, entry.action, bridge.config.backend_map, entry.frontend_join));
            console.log(`[backend-execution] ${JSON.stringify({ trace_id: traceId,
              route_id: next.handler.route_id, handler_ids: next.handler.entry_handler_ids,
              backend_execution: next.handler.backend_execution,
              evidence_ids: next.handler.backend_evidence.evidence_ids })}`);
          }
        }
        res.writeHead(202, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ accepted: received.length, confirmed }));
      } catch (error) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ accepted: 0, error: error.message }));
      }
    });
    return;
  }
  if (req.method === 'POST' && url.pathname === '/api/demo/bridge') {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', chunk => { if (body.length < 1_000_000) body += chunk; });
    req.on('end', () => {
      try {
        if (!bridge) throw new Error('The request-handler bridge is not configured.');
        const payload = JSON.parse(body);
        if (payload.frontier) {
          const frontier = payload.frontier;
          if (frontier.schema !== 'producttrace.click-frontier.v1'
            || frontier.map_fingerprint !== bridge.config.react_map.fingerprint) {
            throw new Error('Invalid or foreign click frontier');
          }
          const workflow = buildClickFrontierWorkflow(frontier);
          if (!liveRecordsPath) broadcast(workflow);
          res.writeHead(202, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ status: 'unresolved', reason: frontier.reason }));
          return;
        }
        const frontendJoin = bridge.integration.join(payload.action);
        const staticResult = connectRequestToHandler(frontendJoin, payload.request, bridge.config.backend_map);
        const result = confirmBackendExecution(staticResult, backendSpans);
        const entry = { received_at: new Date().toISOString(), action: payload.action,
          frontend_join: frontendJoin, result };
        bridgeRecent.unshift(entry);
        if (bridgeRecent.length > 50) bridgeRecent.length = 50;
        if (!liveRecordsPath) broadcast(buildBridgeWorkflow(result, payload.action, bridge.config.backend_map, frontendJoin));
        console.log(`[request-handler-bridge] ${JSON.stringify({ status: result.status,
          reason: result.reason, action_occurrence_id: result.frontend?.action_occurrence_id,
          request_occurrence_id: result.request?.request_occurrence_id,
          method: result.request?.method, path: result.route_join?.request?.path,
          route_id: result.route_join?.match?.id,
          handler_ids: result.handler?.entry_handler_ids,
          backend_execution: result.handler?.backend_execution })}`);
        res.writeHead(result.status === 'resolved' ? 200 : 422, { 'content-type': 'application/json' });
        res.end(JSON.stringify(entry));
      } catch (error) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: error.message }));
      }
    });
    return;
  }
  if (req.method === 'POST' && url.pathname === '/api/demo/events') {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      if (body.length < 1_000_000) body += chunk;
    });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        for (const record of Array.isArray(payload) ? payload : [payload]) broadcast(record);
        res.writeHead(202, { 'content-type': 'application/json' });
        res.end('{"accepted":true}');
      } catch (error) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ accepted: false, error: error.message }));
      }
    });
    return;
  }
  if (req.method === 'GET' && url.pathname === '/api/demo/stream') {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    res.write('data: {"kind":"hello"}\n\n');
    // Replay oldest first so a provisional mapping cannot overwrite its later
    // backend confirmation when a viewer reconnects.
    for (const record of [...recent].reverse()) res.write(`data: ${JSON.stringify(record)}\n\n`);
    viewers.add(res);
    req.on('close', () => viewers.delete(res));
    return;
  }
  let p = url.pathname;
  if (p === '/regression') p = '/test/browser/regression.html';
  else if (p === '/' || p === '/fiber-demo') p = '/test/browser/fiber-demo.html';
  else if (p === '/harness' || p.startsWith('/c/')) p = '/test/browser/harness.html';
  const file = path.join(root, p);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); return res.end('nope');
  }
  res.writeHead(200, { 'content-type': types[path.extname(file)] || 'text/plain' });
  fs.createReadStream(file).pipe(res);
}).listen(port, '127.0.0.1', () => console.log(`harness on http://127.0.0.1:${port}/`));
