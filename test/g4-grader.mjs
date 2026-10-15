#!/usr/bin/env node
/**
 * G4 grader. Independent of the implementation: it imports nothing from
 * analysis/, collector/ or mcp/. It recomputes every answer from raw
 * records.jsonl / spans.jsonl (and HANDLERS.md as the handler answer key),
 * drives the MCP server as a black box over stdio, and compares.
 *
 *   node test/g4-grader.mjs <evidence-dir> --manifest <file> [--out <GRADE.md>]
 *
 * Exported functions are reused by test/mcp.test.mjs.
 */
import fs from 'node:fs';
import zlib from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const WRITE = /^(?:insert|update|delete|remove|replace|findandmodify|bulk)/iu;

export function readRaw(file) {
  const resolved = fs.existsSync(file) ? file : (fs.existsSync(`${file}.gz`) ? `${file}.gz` : null);
  if (!resolved) return [];
  const text = resolved.endsWith('.gz') ? zlib.gunzipSync(fs.readFileSync(resolved)).toString('utf8') : fs.readFileSync(resolved, 'utf8');
  return text.split('\n').filter(line => line.trim()).map(line => JSON.parse(line));
}

/** HANDLERS.md → { flow: { function_id, file } } (the answer key). */
export function readHandlerKey(file) {
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const cells = line.split(' | ');
    if (cells.length < 6 || !cells[0].startsWith('| ') || cells[0].includes('flow') || cells[0].startsWith('|---')) continue;
    const flow = cells[0].slice(2).trim();
    const after = cells[2].trim();
    const functionId = after.slice(0, after.lastIndexOf('|'));
    const event = after.slice(after.lastIndexOf('|') + 1);
    const file = cells[4].trim().split(':')[0];
    out[flow] = { function_id: functionId, event, file };
  }
  return out;
}

/** Flow → credited action ids, from the harness's own chain file. */
export function readFlowActions(file) {
  return Object.fromEntries(readRaw(file).map(row => [row.flow, row.action_ids]));
}

/** Mongo collection for a DB span, with findAndModify's collection taken from the command. */
function dbDetails(span) {
  const a = span.attributes || {};
  let collection = a['db.collection.name'] ?? a['db.mongodb.collection'] ?? null;
  const operation = a['db.operation.name'] ?? a['db.operation'] ?? span.name;
  if (collection === '$cmd' && String(operation).toLowerCase() === 'findandmodify') {
    const raw = a['producttrace.mongo.command_collection'] ?? a['db.mongodb.command.findAndModify'];
    if (typeof raw === 'string' && raw) collection = raw;
    else {
      let command = a['db.statement'] ?? a['db.mongodb.command'];
      if (typeof command === 'string') { try { command = JSON.parse(command); } catch { command = null; } }
      if (command?.findAndModify) collection = command.findAndModify;
    }
  }
  return { operation, collection };
}

/**
 * The server code a database span was issued by (G4 amendment 2026-09-24,
 * fix/middleware-reads), recomputed from raw span attributes: walk the span's
 * parents up to the server span and take the first one that names code.
 * Tracer's handler spans name a route handler (`handler`), a `router.param`
 * callback (`param`) or an error middleware (`error handler`); the official
 * Express layer spans name a `middleware` (express.name), a `route`
 * (request-handler layer, http.route) or a `router`. None: `issuer: unknown`.
 */
function gradeIssuer(span, byId, serverSpanId) {
  let cursor = span.parent_span_id; const seen = new Set();
  while (cursor && cursor !== serverSpanId && !seen.has(cursor)) {
    seen.add(cursor);
    const parent = byId.get(cursor); if (!parent) break;
    const a = parent.attributes || {};
    if (parent.instrumentation?.name === 'producttrace-express-handlers') {
      const kind = a['producttrace.express.handler.kind'];
      return `${kind === 'param' ? 'param' : kind === 'error_middleware' ? 'error handler' : 'handler'}: ${a['producttrace.express.handler.name'] || '<anonymous>'}`;
    }
    if (a['express.type'] === 'middleware') return `middleware: ${a['express.name'] || '<anonymous>'}`;
    if (a['express.type'] === 'request_handler') return `route: ${a['http.route'] || a['express.name'] || '<anonymous>'}`;
    if (a['express.type'] === 'router') return `router: ${a['express.name'] || '<anonymous>'}`;
    cursor = parent.parent_span_id;
  }
  return 'issuer: unknown';
}

/**
 * Exact join for one request row, recomputed from spans: trace + parent +
 * method. Database spans: every one under the server span in the same trace,
 * with its issuer (amended 2026-09-24; previously only those under a handler span).
 */
export function gradeRequestJoin(request, spans) {
  const traceId = request.trace_context?.trace_id; const parent = request.trace_context?.span_id;
  const inTrace = spans.filter(span => span.trace_id === traceId);
  const method = String(request.method || 'GET').toUpperCase();
  const servers = inTrace.filter(span => span.kind === 'server' && span.parent_span_id === parent
    && String(span.attributes?.['http.method'] ?? span.attributes?.['http.request.method'] ?? '').toUpperCase() === method);
  if (servers.length !== 1) return { server: null, handlers: [], dbs: [], servers_found: servers.length };
  const byId = new Map(inTrace.map(span => [span.span_id, span]));
  const under = (span, ancestorId) => { let cursor = span.parent_span_id; const seen = new Set(); while (cursor && !seen.has(cursor)) { if (cursor === ancestorId) return true; seen.add(cursor); cursor = byId.get(cursor)?.parent_span_id; } return false; };
  const server = servers[0];
  const handlers = inTrace.filter(span => span.instrumentation?.name === 'producttrace-express-handlers' && under(span, server.span_id)
    && !['param', 'error_middleware'].includes(span.attributes?.['producttrace.express.handler.kind']));
  const isDb = span => Boolean(span.attributes?.['db.system'] ?? span.attributes?.['db.system.name']) || /mongo/u.test(span.instrumentation?.name || '');
  const dbs = inTrace.filter(span => isDb(span) && under(span, server.span_id));
  return { server, handlers, dbs: dbs.map(span => ({ span_id: span.span_id, ...dbDetails(span), issued_by: gradeIssuer(span, byId, server.span_id) })), servers_found: 1 };
}

/** dom.action rows newest first by (timestamp, page, sequence). */
export function gradeRecent(rows, n) {
  return rows.filter(row => row.kind === 'dom.action').sort((left, right) => Number(right.timestamp) - Number(left.timestamp)
    || String(right.capture_page_id).localeCompare(String(left.capture_page_id)) || Number(right.sequence) - Number(left.sequence)).slice(0, n).map(row => row.action_id);
}

/** Comparable stop signature of one action's graded request. */
export function gradeSignature(rows, spans, requestOccurrenceId) {
  const request = rows.find(row => row.kind === 'network.request' && row.request_occurrence_id === requestOccurrenceId);
  const join = gradeRequestJoin(request, spans);
  const status = join.server?.attributes?.['http.status_code'] ?? null;
  // Request path compared literally except id-shaped segments (24-hex, UUID, 8+ hex, digits).
  const idShaped = segment => /^(?:[0-9a-f]{24}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{8,}|[0-9]+)$/iu.test(segment);
  const requestPath = new URL(request.url, 'http://grader.invalid').pathname.split('/').map(segment => (idShaped(segment) ? ':id' : segment)).join('/');
  return { request: `${String(request.method).toUpperCase()} ${requestPath}`, route: join.server?.attributes?.['http.route'] ?? null, status, handlers: join.handlers.map(span => `${span.attributes?.['http.route']}#${span.attributes?.['producttrace.express.handler.index']}=${span.attributes?.['producttrace.express.handler.name']}`).sort(),
    db: [...new Set(join.dbs.map(db => `${db.operation} ${db.collection} (${db.issued_by})`))].sort(), writes: [...new Set(join.dbs.filter(db => WRITE.test(String(db.operation))).map(db => `${db.operation} ${db.collection}`))].sort() };
}

// ---------------------------------------------------------------------------

async function connect(args) {
  const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(here, '..', 'mcp', 'server.mjs'), ...args], stderr: 'ignore' });
  const client = new Client({ name: 'g4-grader', version: '1' });
  await client.connect(transport);
  return { call: async (name, input) => (await client.callTool({ name, arguments: input })).structuredContent, close: () => client.close() };
}

export async function grade({ dir, manifest }) {
  const rows = readRaw(path.join(dir, 'records.jsonl')); const spans = readRaw(path.join(dir, 'spans.jsonl'));
  const key = readHandlerKey(path.join(dir, 'HANDLERS.md')); const flows = readFlowActions(path.join(dir, 'causal-chains.jsonl'));
  const checks = [];
  const check = (name, pass, detail) => checks.push({ name, pass: Boolean(pass), detail });
  const mcp = await connect(['--store', dir, '--manifest', manifest]);
  try {
    // 1. action_chain for every flow's credited action.
    for (const [flow, actionIds] of Object.entries(flows)) {
      const actionId = actionIds[0];
      const result = await mcp.call('action_chain', { action_id: actionId });
      const entry = result.stops?.find(stop => stop.stop === 'entry_handler');
      check(`${flow}: entry handler = HANDLERS.md`, entry?.function_id === key[flow]?.function_id && entry?.source?.file === key[flow]?.file,
        `mcp=${entry?.function_id} ${entry?.source?.file}; key=${key[flow]?.function_id} ${key[flow]?.file}`);
      const request = result.stops?.find(stop => stop.stop === 'request');
      const requestRow = rows.find(row => row.kind === 'network.request' && row.request_occurrence_id === request?.request_occurrence_id);
      check(`${flow}: chain request belongs to the episode`, requestRow && result.episode_action_ids.includes(requestRow.action_id), `${request?.method} ${request?.url} action=${requestRow?.action_id}`);
      const graded = requestRow ? gradeRequestJoin(requestRow, spans) : { server: null, handlers: [], dbs: [] };
      const route = result.stops?.find(stop => stop.stop === 'route');
      const handlers = result.stops?.filter(stop => stop.stop === 'handler').map(stop => stop.span_id).sort();
      const dbs = result.stops?.filter(stop => stop.stop === 'db').map(stop => stop.span_id).sort();
      check(`${flow}: route span = exact-parent server span`, route?.span_id === graded.server?.span_id, `mcp=${route?.span_id} grader=${graded.server?.span_id}`);
      check(`${flow}: handler spans equal`, JSON.stringify(handlers) === JSON.stringify(graded.handlers.map(span => span.span_id).sort()), `mcp=${handlers?.length} grader=${graded.handlers.length}`);
      check(`${flow}: db spans equal`, JSON.stringify(dbs) === JSON.stringify(graded.dbs.map(db => db.span_id).sort()), `mcp=${dbs?.length} grader=${graded.dbs.length}`);
      const gradedWrites = [...new Set(graded.dbs.filter(db => WRITE.test(String(db.operation))).map(db => `${db.operation} ${db.collection}`))].sort();
      check(`${flow}: writes equal and non-empty`, gradedWrites.length > 0 && JSON.stringify(result.outcome?.writes) === JSON.stringify(gradedWrites), `mcp=${JSON.stringify(result.outcome?.writes)} grader=${JSON.stringify(gradedWrites)}`);
      check(`${flow}: frontier says terminal effect`, result.reached === 'db' && result.stopped_at === null, `${result.reached} / ${result.stopped_at} / ${result.because}`);
    }
    // 2. recent_actions order.
    const recent = await mcp.call('recent_actions', { n: 15 });
    const expectedRecent = gradeRecent(rows, 15);
    check('recent_actions: newest-first order equals raw rows', JSON.stringify(recent.actions.map(action => action.action_id)) === JSON.stringify(expectedRecent), `first=${recent.actions[0]?.action_id} grader=${expectedRecent[0]}`);
    // 3. element_history for each flow's handler key contains the credited actions.
    for (const [flow, actionIds] of Object.entries(flows)) {
      const handlerKey = `handler:${key[flow].function_id}|${key[flow].event}`;
      const history = await mcp.call('element_history', { element_key: handlerKey, n: 100 });
      const listed = new Set(history.actions?.map(action => action.action_id));
      check(`${flow}: element_history(${key[flow].file}) lists the credited action(s)`, history.status === 'ok' && actionIds.every(id => listed.has(id)), `listed=${[...listed].join(',')}`);
    }
    // 4. resolve_element never exact without a key.
    const probes = [{ selector: 'form' }, { selector: 'div > form > textarea#prompt-textarea', name: 'Message input' }, { element_path: 'div > div > button', nearby_text: 'Save' }, { role: 'menuitem' }];
    for (const probe of probes) {
      const result = await mcp.call('resolve_element', probe);
      check(`resolve_element ${JSON.stringify(probe)}: no silent pick`, result.confidence === 'ambiguous' && ['ambiguous', 'not_found'].includes(result.status), `status=${result.status} candidates=${result.candidates?.length}`);
    }
    // 5. compare_chains statuses agree with graded signatures.
    const requestOf = async actionId => (await mcp.call('action_chain', { action_id: actionId })).stops.find(stop => stop.stop === 'request')?.request_occurrence_id;
    // Amended 2026-09-24 (fix/middleware-reads): the two regenerates were expected
    // unchanged while database operations counted only under handler spans. With
    // every operation under the server span compared, the first regenerate's
    // middleware `validateConvoAccess` read of `conversations` is absent from the
    // second, so the runtime path differs (the grader's own signature says so too).
    const pairs = [[flows.regenerate[0], 'action:mud8sys4:17', true], [flows.send[0], flows['agent-chat'][0], true], [flows.send[0], flows.rename[0], true]];
    for (const [before, after, expectChange] of pairs) {
      if (!rows.some(row => row.action_id === after)) continue;
      const result = await mcp.call('compare_chains', { before_action_id: before, after_action_id: after });
      const left = gradeSignature(rows, spans, await requestOf(before)); const right = gradeSignature(rows, spans, await requestOf(after));
      const gradedChange = JSON.stringify({ ...left }) !== JSON.stringify({ ...right });
      const dbStatuses = Object.fromEntries(result.stops.filter(stop => stop.stop === 'db').map(stop => [stop.key, stop.status]));
      const dbAgree = [...new Set([...left.db, ...right.db])].every(keyName => dbStatuses[keyName] === (left.db.includes(keyName) && right.db.includes(keyName) ? 'same' : left.db.includes(keyName) ? 'removed' : 'added'));
      check(`compare ${before} vs ${after}: path_changed=${expectChange}`, result.path_changed === expectChange && gradedChange === expectChange && dbAgree, result.summary.split('. Before:')[0]);
    }
  } finally { await mcp.close(); }
  // 6. Frontend-only: the same store with no spans.
  const empty = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'g4-frontend-only-')), 'spans.jsonl'); fs.writeFileSync(empty, '');
  const front = await connect(['--records', path.join(dir, 'records.jsonl'), '--spans', empty, '--manifest', manifest]);
  try {
    const actionIds = [...new Set(rows.filter(row => row.kind === 'network.request' && row.action_id && row.internal !== true).map(row => row.action_id))];
    let networkFrontiers = 0; const violations = [];
    for (const actionId of actionIds) {
      const result = await front.call('action_chain', { action_id: actionId });
      const backendStops = result.stops.filter(stop => ['route', 'handler', 'db'].includes(stop.stop)).length;
      if (backendStops) violations.push(`${actionId} has ${backendStops} backend stops`);
      if (result.stops.some(stop => stop.stop === 'request')) {
        if (result.stopped_at === 'network' && result.because === 'backend not instrumented') networkFrontiers += 1;
        else violations.push(`${actionId}: ${result.stopped_at} / ${result.because}`);
      }
    }
    check(`frontend-only: ${actionIds.length} request-bearing actions, 0 backend stops, all end at the network frontier`, violations.length === 0 && networkFrontiers > 0, `network_frontiers=${networkFrontiers}; violations=${violations.slice(0, 5).join(' | ')}`);
  } finally { await front.close(); }
  return checks;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  const argv = process.argv.slice(2);
  const dir = path.resolve(argv[0] || '');
  const manifest = path.resolve(argv[argv.indexOf('--manifest') + 1] || path.join(dir, 'manifest.json'));
  const out = argv.includes('--out') ? path.resolve(argv[argv.indexOf('--out') + 1]) : null;
  const checks = await grade({ dir, manifest });
  const passed = checks.filter(entry => entry.pass).length;
  const lines = [`# G4 grade`, '', `store: ${path.relative(process.cwd(), dir)}`, `manifest: ${path.relative(process.cwd(), manifest)}`, `result: ${passed}/${checks.length} checks pass`, '',
    '| check | pass | detail |', '|---|---|---|', ...checks.map(entry => `| ${entry.name.replaceAll('|', '/')} | ${entry.pass ? 'PASS' : 'FAIL'} | ${String(entry.detail).replaceAll('|', '/').slice(0, 400)} |`)];
  if (out) fs.writeFileSync(out, lines.join('\n') + '\n');
  process.stdout.write(lines.join('\n') + '\n');
  process.exitCode = passed === checks.length ? 0 : 1;
}
