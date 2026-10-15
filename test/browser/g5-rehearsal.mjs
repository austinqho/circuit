#!/usr/bin/env node
// G5 Part A: the automated rehearsal of the Codex step (docs/gates/G5-demo.md §5).
//
// Headless Playwright performs the actions and the annotation (through
// build-fresh-repo.mjs + sessions/anything-llm-g5.mjs, which also runs the
// skill's DOM lookup from the prompt fields only). This script then does what
// the skill tells Codex to do next: start the real MCP server from the
// installed tarball (`producttrace-mcp --store <fixture>/.tracer`) and speak
// MCP over stdio: resolve_element → element_history → action_chain for the
// failing attempt, plus the no-key fallback. Every JSON-RPC line is kept
// verbatim (mcp-transcript.json). No model runs anywhere.
//
//   node test/browser/g5-rehearsal.mjs --repo <fixture> --out docs/evidence/<new dir> [--port 4100] [--keep-work]
//   node test/browser/g5-rehearsal.mjs --mcp-only --run-dir <harness out> --store <dir> --source-root <fixture> --out <dir>
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { parseArgs } from 'node:util';
import { execFileSync } from 'node:child_process';

const tracerRoot = path.resolve(import.meta.dirname, '../..');
const { values: args } = parseArgs({ options: {
  repo: { type: 'string' }, out: { type: 'string' }, port: { type: 'string', default: '4100' }, 'work-root': { type: 'string' }, 'keep-work': { type: 'boolean', default: false },
  'mcp-only': { type: 'boolean', default: false }, 'run-dir': { type: 'string' }, store: { type: 'string' }, 'source-root': { type: 'string' },
  session: { type: 'string', default: 'test/browser/sessions/anything-llm-g5.mjs' }, server: { type: 'string' }, label: { type: 'string', default: 'g5-demo' },
} });
const log = (...parts) => console.error('[g5]', ...parts);
const PLUGIN_OPTIONS = { stamps: true, requestBridge: false };
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const readJsonl = file => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) : []);
const sha256 = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

// ---------------------------------------------------------------- MCP client
/** A minimal JSON-RPC-over-stdio MCP client that records every line verbatim. */
function startMcp(serverPath, serverArgs) {
  const child = spawn(process.execPath, [serverPath, ...serverArgs], { stdio: ['pipe', 'pipe', 'pipe'] });
  const transcript = []; const waiting = new Map(); let buffer = ''; let stderr = ''; let nextId = 1;
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.stdout.on('data', chunk => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
      if (!line.trim()) continue;
      const message = JSON.parse(line);
      transcript.push({ direction: 'server→client', at: new Date().toISOString(), message });
      if (message.id !== undefined && waiting.has(message.id)) { waiting.get(message.id)(message); waiting.delete(message.id); }
    }
  });
  const send = message => { transcript.push({ direction: 'client→server', at: new Date().toISOString(), message }); child.stdin.write(`${JSON.stringify(message)}\n`); };
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => reject(new Error(`MCP ${method} timed out; stderr: ${stderr.slice(-500)}`)), 120000);
    waiting.set(id, message => { clearTimeout(timer); resolve(message); });
    send({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) });
  });
  const call = async (name, argumentsObject) => {
    const response = await request('tools/call', { name, arguments: argumentsObject });
    if (response.error) throw new Error(`${name}: ${JSON.stringify(response.error)}`);
    return response.result.structuredContent;
  };
  const close = () => new Promise(resolve => { child.once('exit', resolve); child.stdin.end(); setTimeout(() => child.kill('SIGTERM'), 2000); });
  return { request, call, notify: (method, params) => send({ jsonrpc: '2.0', method, ...(params ? { params } : {}) }), close, transcript, stderr: () => stderr };
}

// ---------------------------------------------------------------- source checks (read the fixture, not the MCP)
const lineOf = (content, offset) => content.slice(0, offset).split('\n').length;
function functionFacts(repo, source) {
  const content = fs.readFileSync(path.join(repo, source.file), 'utf8');
  const before = content.slice(Math.max(0, source.start - 120), source.start);
  const name = /([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?$/u.exec(before)?.[1] ?? null;
  return { name, line: lineOf(content, source.start), text_head: content.slice(source.start, source.start + 40).replace(/\s+/gu, ' '),
    bound_as_on_submit: name ? content.includes(`onSubmit={${name}}`) : false,
    hash_matches: createHash('sha256').update(content).digest('hex') === (/^function:([0-9a-f]{64}):/u.exec(source.function_id || '')?.[1] ?? null) };
}

// ---------------------------------------------------------------- the MCP phase
export async function mcpPhase({ runDir, storeDir, sourceRoot, serverPath, out }) {
  const annotation = readJson(path.join(runDir, 'annotation-anchor.json'));
  const attemptsObserved = readJson(path.join(runDir, 'attempts.json'));
  const gates = readJson(path.join(runDir, 'build-gates.json'));
  const serverArgs = ['--store', storeDir, '--source-root', sourceRoot];
  const mcp = startMcp(serverPath, serverArgs);
  const initialize = await mcp.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'g5-rehearsal (stands in for Codex; no model)', version: '1' } });
  mcp.notify('notifications/initialized');
  const tools = await mcp.request('tools/list');

  // Skill step 2 already ran in the page: the key read from the live DOM.
  const key = annotation.lookup.element_key;
  const resolved = key ? await mcp.call('resolve_element', { element_key: key }) : null;
  const history = key ? await mcp.call('element_history', { element_key: key, n: 10 }) : null;
  // The agent's own choice: the newest attempt whose HTTP status is an error.
  const failing = history?.attempts?.find(attempt => Number(attempt.outcome?.http_status) >= 400) || null;
  const chain = failing ? await mcp.call('action_chain', { action_id: failing.carrier_action_id }) : null;
  // Skill step 3, exercised on purpose: the raw evidence without a key.
  const anchor = annotation.anchor;
  const fallbackArgs = Object.fromEntries(Object.entries({ url: annotation.page_url, selector: anchor.selector, element_path: anchor.element_path,
    role: anchor.role || undefined, name: anchor.name || undefined, nearby_text: anchor.nearby_text || undefined }).filter(([, value]) => value !== undefined));
  const fallback = await mcp.call('resolve_element', fallbackArgs);
  await mcp.close();
  fs.writeFileSync(path.join(out, 'mcp-transcript.json'), JSON.stringify({ schema: 'producttrace.g5-mcp-transcript.v1', server: { path: serverPath, args: serverArgs },
    note: 'Every JSON-RPC line exchanged with producttrace-mcp over stdio, verbatim, in order. This is what a coding agent would read.', lines: mcp.transcript }, null, 2));

  // ---- assertions (the rehearsal's own; test/g5-grader.mjs recomputes independently)
  const results = [];
  const check = (id, pass, what, detail) => { results.push({ id, pass: Boolean(pass), what, detail }); };
  const stampRows = readJsonl(path.join(storeDir, 'records.jsonl')).filter(row => row.kind === 'element.stamp' && row.element_key === key);
  const stamp = stampRows[0] || null;

  check('A1', annotation.lookup.status === 'ok' && annotation.lookup.matches === 1 && key && key === annotation.ground_truth.closest_data_tracer_el,
    'DOM step from the prompt fields: one selector match, key via closest(), equals the annotated element\'s stamp',
    { selector: anchor.selector, matches: annotation.lookup.matches, via: annotation.lookup.via, query_selector_all_matches: annotation.lookup.query_selector_all_matches, key, truth: annotation.ground_truth.closest_data_tracer_el });

  let sourceFacts = null;
  if (stamp) {
    const content = fs.readFileSync(path.join(sourceRoot, stamp.file), 'utf8');
    sourceFacts = { file: stamp.file, line_of_start: lineOf(content, stamp.start), text_at_start: content.slice(stamp.start, stamp.start + 30).replace(/\s+/gu, ' '), tag: stamp.tag };
  }
  check('A2', resolved?.status === 'ok' && resolved.confidence === 'exact' && resolved.key_kind === 'element_stamp' && stamp
    && resolved.component === stamp.component && resolved.source?.file === stamp.file && resolved.source?.line === stamp.line
    && sourceFacts.line_of_start === stamp.line && sourceFacts.text_at_start.startsWith(`<${stamp.tag}`),
    'resolve_element: exact; component and file:line equal the stamp row and the fixture source',
    { status: resolved?.status, confidence: resolved?.confidence, component: resolved?.component, source: resolved?.source, stamp: stamp && { component: stamp.component, file: stamp.file, line: stamp.line, start: stamp.start, tag: stamp.tag }, source_check: sourceFacts });

  const attempts = history?.attempts || [];
  const entryIds = [...new Set(attempts.map(attempt => attempt.entry_handler?.function_id))];
  const entry = attempts[0]?.entry_handler || null;
  const entryFacts = entry?.source ? functionFacts(sourceRoot, { ...entry.source, function_id: entry.function_id }) : null;
  check('A3', attempts.length >= 3 && entryIds.length === 1 && entryFacts && entryFacts.name === 'handleUpdate' && entryFacts.bound_as_on_submit
    && entry.source.line === entryFacts.line && entryFacts.hash_matches,
    'entry handler: one function for every attempt; it is the developer-named form onSubmit handler (checked in source)',
    { function_ids: entryIds, source: entry?.source, source_check: entryFacts });

  const newestThree = attempts.slice(0, 3);
  const expected = [...attemptsObserved].reverse();
  const perAttempt = newestThree.map((attempt, index) => {
    const want = expected[index];
    const status = attempt.route?.status_code;
    return { attempt: want?.attempt, carrier_action_id: attempt.carrier_action_id, events: attempt.events,
      request: attempt.request && `${attempt.request.method} ${attempt.request.path}`, route: attempt.route?.route, status, observed_by_playwright: want?.observed_status,
      stopped_at: attempt.stopped_at, because: attempt.because,
      ok: Boolean(want) && attempt.request?.method === want.method && attempt.request?.path === want.url && Boolean(attempt.route?.route) && status === want.observed_status
        && attempt.stopped_at === 'handler' && (status >= 400 ? attempt.because.startsWith(`server responded ${status};`) : !attempt.because.includes('server responded')) };
  });
  check('A4', history?.status === 'ok' && newestThree.length === 3 && perAttempt.every(row => row.ok)
    && JSON.stringify(perAttempt.map(row => row.status)) === JSON.stringify(expected.map(row => row.observed_status)),
    'element_history: three attempts newest first with request, route, HTTP status and frontier; the 4xx is named in because',
    { attempts_total: attempts.length, per_attempt: perAttempt });

  const routeStop = chain?.stops?.find(stop => stop.stop === 'route');
  check('A5', chain?.status === 'ok' && /\b422\b/u.test(chain.because || '') && routeStop?.status_code === 422 && chain.stopped_at === 'handler',
    'action_chain(failing attempt): because names the 422, route stop 422, stopped at handler',
    { action_id: failing?.carrier_action_id, summary: chain?.summary, because: chain?.because, route: routeStop, stopped_at: chain?.stopped_at });

  const candidateKeys = (fallback.candidates || []).flatMap(candidate => (candidate.keys || []).map(entryKey => entryKey.element_key));
  check('A6', fallback.status === 'ambiguous' && fallback.confidence === 'ambiguous' && candidateKeys.includes(key),
    'no-key fallback (selector/path/name/nearby text only): ambiguous, candidates include the right key, never a pick',
    { args: fallbackArgs, status: fallback.status, confidence: fallback.confidence, candidates_total: fallback.candidates_total, candidate_keys: candidateKeys, summary: fallback.summary });

  const store = gates.store || {};
  check('A7a', store.via === 'collector' && store.crosscheck?.pass && gates.markers?.pass && gates.parity?.pass && gates.smoke?.status === 'ok' && gates.source?.pass,
    'store written through producttrace-collector equals the harness capture; G2 build gates pass; tracked source clean (store path excluded)',
    { crosscheck: store.crosscheck && { pass: store.crosscheck.pass, missing: store.crosscheck.missing_in_store, extra: store.crosscheck.extra_in_store, harness: store.crosscheck.harness_rows_by_kind, store: store.crosscheck.store_rows_by_kind, spans: [store.crosscheck.harness_spans, store.crosscheck.store_spans] },
      sink: store.sink, markers: gates.markers?.pass, parity: gates.parity?.pass, smoke: gates.smoke?.status, source_clean: gates.source?.pass, unfiltered_status_after: gates.source?.unfiltered_status_after });

  const report = { schema: 'producttrace.g5-rehearsal.v1', question: annotation.question, element_key: key, results,
    pass: results.every(row => row.pass), mcp: { protocol: initialize.result?.protocolVersion, server: initialize.result?.serverInfo, tools: tools.result?.tools?.map(tool => tool.name) } };
  fs.writeFileSync(path.join(out, 'rehearsal.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(out, 'REHEARSAL.md'), renderRehearsal(report));
  fs.writeFileSync(path.join(out, 'AGENT-READS.md'), renderAgentReads({ annotation, resolved, history, chain, fallback, entryFacts }));
  return report;
}

function renderRehearsal(report) {
  const lines = ['# G5 Part A: rehearsal assertions', '', `Question: "${report.question}". Element key read from the live DOM: \`${report.element_key}\`.`, '',
    `MCP: protocol ${report.mcp.protocol}, server ${JSON.stringify(report.mcp.server)}, tools ${report.mcp.tools?.join(', ')}.`, '',
    '| id | result | assertion | evidence |', '|---|---|---|---|'];
  const evidence = { A1: 'run/annotation-anchor.json, run/annotation-prompt.txt, run/annotated-element.html', A2: 'mcp-transcript.json (resolve_element), store/records.jsonl.gz (element.stamp)',
    A3: 'mcp-transcript.json (element_history attempts[].entry_handler)', A4: 'mcp-transcript.json (element_history), run/attempts.json', A5: 'mcp-transcript.json (action_chain)',
    A6: 'mcp-transcript.json (second resolve_element)', A7a: 'run/build-gates.json (store.crosscheck), run/coverage.json' };
  for (const row of report.results) lines.push(`| ${row.id} | ${row.pass ? 'PASS' : 'FAIL'} | ${row.what} | ${evidence[row.id] || ''} |`);
  lines.push('', `Overall: ${report.pass ? 'PASS' : 'FAIL'} (${report.results.filter(row => row.pass).length}/${report.results.length}). A7b (fixture restored) is recorded in RUN.md.`, '', '## Details', '');
  for (const row of report.results) lines.push(`### ${row.id} ${row.pass ? 'PASS' : 'FAIL'}`, '', '```json', JSON.stringify(row.detail, null, 2), '```', '');
  return `${lines.join('\n')}\n`;
}

function renderAgentReads({ annotation, resolved, history, chain, fallback, entryFacts }) {
  const at = source => (source ? `${source.file}:${source.line ?? `@${source.start}`}` : 'unknown');
  const lines = ['# What the agent reads (G5 rehearsal)', '',
    'Rendered from `mcp-transcript.json`; every value below is a field the Tracer MCP returned, or the annotation Codex would send. No model ran; the last section is a fixed template filled from those fields, showing what the agent can say without reading code first.', '',
    '## 1. The annotation Codex puts in the prompt (no `data-*` attribute reaches the model)', '', '```text', fs.readFileSync(path.join(args['run-dir'] || path.join(args.out, 'run'), 'annotation-prompt.txt'), 'utf8').trimEnd(), '```', '',
    '## 2. The skill\'s browser-tool step (from the prompt fields only)', '',
    `\`resolveAnnotatedKey(document, { selector, target, nearby_text })\` → status \`${annotation.lookup.status}\`, ${annotation.lookup.matches} match, key via \`${annotation.lookup.via}\`: \`${annotation.lookup.element_key}\`.`, '',
    '## 3. `resolve_element({ element_key })`', '', `> ${resolved?.summary}`, '',
    `component \`${resolved?.component}\` at \`${at(resolved?.source)}\`, confidence \`${resolved?.confidence}\`, build \`${resolved?.build}\`.`, '',
    '## 4. `element_history({ element_key, n: 10 })`', '', `> ${history?.summary}`, '', '| # | attempt (carrier action) | events on this element | request | route | status | reached / stopped at / because |', '|---|---|---|---|---|---|---|'];
  (history?.attempts || []).forEach((attempt, index) => lines.push(`| ${index + 1} | \`${attempt.carrier_action_id}\` | ${attempt.events.join(', ')} | ${attempt.request ? `${attempt.request.method} ${attempt.request.path}` : '—'} | ${attempt.route?.route ?? '—'} | ${attempt.route?.status_code ?? '—'} | ${attempt.reached} / ${attempt.stopped_at} / ${attempt.because} |`));
  lines.push('', '## 5. `action_chain` for the failing attempt', '', `> ${chain?.summary}`, '', '| stop | detail |', '|---|---|');
  for (const stop of chain?.stops || []) {
    const detail = stop.stop === 'dispatch' ? `${stop.event} ${stop.action_id} on ${stop.target?.tag} (${stop.element_key})`
      : stop.stop === 'entry_handler' ? `${stop.event} → \`${at(stop.source)}\``
        : stop.stop === 'request' ? `${stop.method} ${stop.path}`
          : stop.stop === 'route' ? `${stop.method} ${stop.route} → ${stop.status_code}`
            : stop.stop === 'handler' ? `#${stop.index} ${stop.name} (${stop.route})` : JSON.stringify(stop);
    lines.push(`| ${stop.stop} | ${detail} |`);
  }
  lines.push('', `reached \`${chain?.reached}\` / stopped at \`${chain?.stopped_at}\` / because "${chain?.because}"`, '',
    '## 6. No key (skill step 3): `resolve_element({ url, selector, element_path, name, nearby_text })`', '', `> ${fallback.summary}`, '',
    `status \`${fallback.status}\`, confidence \`${fallback.confidence}\`, ${fallback.candidates_total} candidate target(s); the candidates list the right key, but it is not a pick.`, '',
    '## 7. Template filled from the fields above', '');
  const attempts = history?.attempts || [];
  const failing = attempts.find(attempt => Number(attempt.outcome?.http_status) >= 400);
  const entry = attempts[0]?.entry_handler;
  lines.push(`The annotated button is \`${resolved?.component}\` (\`${at(resolved?.source)}\`). Submitting it runs \`${entryFacts?.name ?? '?'}\` (\`${at(entry?.source)}\`), the form's \`onSubmit\` handler.`
    + ` The last ${attempts.length} attempts on this button, newest first: ${attempts.map(attempt => `${attempt.request?.method} ${attempt.request?.path} → ${attempt.route?.status_code}`).join('; ')}.`
    + (failing ? ` The failing one (\`${failing.carrier_action_id}\`) reached route \`${failing.route?.route}\`, which answered ${failing.route?.status_code}; the evidence stops at the server handler because "${failing.because}". Tracer records no database span for this app, so it cannot show which line in the handler returned the ${failing.route?.status_code}; the next step is to read the handlers of \`${failing.route?.route}\`, starting from the request body the form sent.` : ''), '');
  return `${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------- full run
async function main() {
  if (args['mcp-only']) {
    const runDir = path.resolve(args['run-dir']); const out = path.resolve(args.out); fs.mkdirSync(out, { recursive: true });
    const gates = readJson(path.join(runDir, 'build-gates.json'));
    const serverPath = args.server ? path.resolve(args.server) : path.join(path.dirname(gates.install.wrapper), 'node_modules', 'producttrace', 'mcp', 'server.mjs');
    const report = await mcpPhase({ runDir, storeDir: path.resolve(args.store), sourceRoot: path.resolve(args['source-root']), serverPath, out });
    console.log(JSON.stringify({ pass: report.pass, results: report.results.map(row => `${row.id}:${row.pass ? 'PASS' : 'FAIL'}`) }));
    return;
  }
  if (!args.repo || !args.out) throw new Error('--repo and --out are required');
  const repo = fs.realpathSync(path.resolve(args.repo)); const out = path.resolve(args.out);
  if (fs.existsSync(out)) throw new Error(`evidence directory exists (immutable): ${out}`);
  const git = (...gitArgs) => execFileSync('git', ['-C', repo, ...gitArgs], { encoding: 'utf8' }).trim();
  if (git('status', '--porcelain')) throw new Error('fixture is not clean');
  const storeDir = path.join(repo, '.tracer');
  if (fs.existsSync(storeDir)) throw new Error(`${storeDir} exists; G5 starts from an empty store`);
  fs.mkdirSync(out, { recursive: true });
  const fixture = { head: git('rev-parse', 'HEAD'), branch: git('rev-parse', '--abbrev-ref', 'HEAD'), diff_vs_upstream: git('diff', '--stat', 'ad97bc8dfcb6919f34f7d6d0c722efdda64d66d9', 'HEAD') };
  fs.writeFileSync(path.join(out, 'fixture-state-before.json'), JSON.stringify(fixture, null, 2));
  // --work-root: a directory other harness runs do not clean (they may remove .g2-work wholesale).
  const work = path.join(path.resolve(args['work-root'] || path.join(path.dirname(repo), '.g2-work')), `g5-${Date.now().toString(36)}`);
  const harnessArgs = [path.join(tracerRoot, 'test/browser/build-fresh-repo.mjs'), '--repo', repo, '--session', path.resolve(tracerRoot, args.session), '--out', path.join(out, 'run'),
    '--port', args.port, '--store', storeDir, '--label', args.label, '--collector', '--plugin-options', JSON.stringify(PLUGIN_OPTIONS), '--work', work];
  fs.writeFileSync(path.join(out, 'harness-command.txt'), `node ${harnessArgs.map(arg => (/[\s{}"]/u.test(arg) ? `'${arg}'` : arg)).join(' ')}\n`);
  log('harness', harnessArgs.slice(1).join(' '));
  const harnessLog = fs.openSync(path.join(out, 'harness.log'), 'w');
  const code = await new Promise(resolve => { const child = spawn(process.execPath, harnessArgs, { stdio: ['ignore', harnessLog, harnessLog] }); child.on('exit', resolve); });
  fs.closeSync(harnessLog);
  if (code !== 0) throw new Error(`harness exited ${code}; see ${path.join(out, 'harness.log')}`);
  const runDir = path.join(out, 'run');
  const gates = readJson(path.join(runDir, 'build-gates.json'));
  const serverPath = path.join(path.dirname(gates.install.wrapper), 'node_modules', 'producttrace', 'mcp', 'server.mjs');
  args['run-dir'] = runDir;
  const report = await mcpPhase({ runDir, storeDir, sourceRoot: repo, serverPath, out });
  log('rehearsal', report.pass ? 'PASS' : 'FAIL', report.results.map(row => `${row.id}:${row.pass ? 'PASS' : 'FAIL'}`).join(' '));

  // Bank the store (gzipped, with sha256 and row counts), then remove it from the fixture.
  const banked = path.join(out, 'store'); fs.mkdirSync(path.join(banked, 'manifests'), { recursive: true });
  const files = [];
  const bank = (from, to) => {
    const raw = fs.readFileSync(from); const gz = zlib.gzipSync(raw, { level: 9 }); fs.writeFileSync(to, gz);
    files.push({ file: path.relative(out, to), source: path.relative(repo, from), bytes: raw.length, sha256: createHash('sha256').update(raw).digest('hex'),
      rows: from.endsWith('.jsonl') ? raw.toString('utf8').split('\n').filter(Boolean).length : null, gz_bytes: gz.length, gz_sha256: sha256(to) });
  };
  for (const name of ['records.jsonl', 'spans.jsonl', 'runs.jsonl']) if (fs.existsSync(path.join(storeDir, name))) bank(path.join(storeDir, name), path.join(banked, `${name}.gz`));
  for (const name of fs.readdirSync(path.join(storeDir, 'manifests'))) bank(path.join(storeDir, 'manifests', name), path.join(banked, 'manifests', `${name}.gz`));
  fs.writeFileSync(path.join(out, 'store-files.json'), JSON.stringify(files, null, 2));
  fs.rmSync(storeDir, { recursive: true, force: true });
  if (!args['keep-work']) fs.rmSync(work, { recursive: true, force: true });
  fs.writeFileSync(path.join(out, 'fixture-state-after-run.json'), JSON.stringify({ head: git('rev-parse', 'HEAD'), status_porcelain: git('status', '--porcelain') }, null, 2));
  console.log(JSON.stringify({ out, pass: report.pass, results: report.results.map(row => `${row.id}:${row.pass ? 'PASS' : 'FAIL'}`) }, null, 2));
  if (!report.pass) process.exitCode = 1;
}

await main();
