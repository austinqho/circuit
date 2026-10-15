#!/usr/bin/env node
/**
 * G5 grader (docs/gates/G5-demo.md §6). Independent of the implementation: it
 * imports nothing from analysis/, collector/ or mcp/. It recomputes every
 * answer the MCP gave in the rehearsal transcript from the raw store rows and
 * the fixture's source, and compares.
 *
 *   node test/g5-grader.mjs <evidence dir> --source-root <fixture checkout> [--store <dir>] [--out GRADE-g5.md]
 *
 * <evidence dir> holds mcp-transcript.json, run/annotation-anchor.json and
 * store/ (records.jsonl[.gz], spans.jsonl[.gz], manifests/*.json[.gz]).
 * The fixture checkout must hold the frontend files at the recorded content
 * hashes (checked; a mismatch fails the file:line checks rather than guessing).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { parseArgs } from 'node:util';

const { values: options, positionals } = parseArgs({ allowPositionals: true, options: { 'source-root': { type: 'string' }, store: { type: 'string' }, out: { type: 'string' } } });
const evidence = path.resolve(positionals[0] || '.');
const sourceRoot = path.resolve(options['source-root'] || '.');
const storeDir = path.resolve(options.store || path.join(evidence, 'store'));

const readMaybeGz = file => {
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
  if (fs.existsSync(`${file}.gz`)) return zlib.gunzipSync(fs.readFileSync(`${file}.gz`)).toString('utf8');
  return null;
};
const jsonl = text => (text || '').split('\n').filter(line => line.trim()).map(line => JSON.parse(line));
const records = jsonl(readMaybeGz(path.join(storeDir, 'records.jsonl')));
const spans = jsonl(readMaybeGz(path.join(storeDir, 'spans.jsonl')));
const manifests = fs.readdirSync(path.join(storeDir, 'manifests')).map(name => JSON.parse(readMaybeGz(path.join(storeDir, 'manifests', name.replace(/\.gz$/u, '')))));
const manifestRow = new Map(manifests.flatMap(manifest => manifest.functions.map(row => [row.id, row])));
const anchor = JSON.parse(fs.readFileSync(path.join(evidence, 'run', 'annotation-anchor.json'), 'utf8'));
const transcript = JSON.parse(fs.readFileSync(path.join(evidence, 'mcp-transcript.json'), 'utf8')).lines;

// Pair every tools/call with its response.
const calls = [];
const responses = new Map(transcript.filter(line => line.direction === 'server→client' && line.message.id !== undefined).map(line => [line.message.id, line.message]));
for (const line of transcript) {
  const message = line.message;
  if (line.direction !== 'client→server' || message.method !== 'tools/call') continue;
  calls.push({ name: message.params.name, args: message.params.arguments, result: responses.get(message.id)?.result?.structuredContent ?? null });
}
const call = (name, predicate = () => true) => calls.find(entry => entry.name === name && predicate(entry.args)) || null;

const checks = [];
const check = (name, pass, detail) => checks.push({ name, pass: Boolean(pass), detail: typeof detail === 'string' ? detail : JSON.stringify(detail) });
const sha = text => crypto.createHash('sha256').update(text).digest('hex');
const lineOf = (content, offset) => content.slice(0, offset).split('\n').length;
const readSource = file => { const full = path.join(sourceRoot, file); return fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : null; };
const order = (left, right) => Number(left.timestamp) - Number(right.timestamp) || String(left.capture_page_id).localeCompare(String(right.capture_page_id)) || Number(left.sequence) - Number(right.sequence);

// 1. Key: the live DOM's stamp (recorded as ground truth, not by the lookup) = the key the agent sent.
const key = anchor.ground_truth.closest_data_tracer_el;
const resolveCall = call('resolve_element', args => args.element_key !== undefined);
check('1 key: DOM stamp of the annotated element = the key sent to the MCP = the key it answered', key && resolveCall?.args.element_key === key && resolveCall?.result?.element_key === key,
  { dom: key, sent: resolveCall?.args.element_key, answered: resolveCall?.result?.element_key });
const stampRows = records.filter(row => row.kind === 'element.stamp' && row.element_key === key);
const placements = [...new Set(stampRows.map(row => row.placement_id))];
check('1 key: stamped for exactly one placement in the store', stampRows.length >= 1 && placements.length === 1, { stamp_rows: stampRows.length, placements });

// 2. Component + file:line from the stamp row, checked against the fixture source.
const stamp = stampRows[0];
const stampSource = stamp ? readSource(stamp.file) : null;
const placementHash = /^placement:([0-9a-f]{64}):/u.exec(stamp?.placement_id || '')?.[1];
const stampLine = stampSource ? lineOf(stampSource, stamp.start) : null;
check('2 source: fixture file hash equals the placement id hash', stampSource && sha(stampSource) === placementHash, { file: stamp?.file });
check('2 source: text at the stamp start is <tag and its line is the stamp line', stampSource && stampSource.slice(stamp.start).startsWith(`<${stamp.tag}`) && stampLine === stamp.line,
  { file: stamp?.file, start: stamp?.start, tag: stamp?.tag, line_recomputed: stampLine, line_recorded: stamp?.line, text: stampSource?.slice(stamp.start, stamp.start + 24) });
const resolved = resolveCall?.result;
check('2 resolve_element: exact, component and file:line equal the recomputed ones', resolved?.status === 'ok' && resolved.confidence === 'exact' && resolved.component === stamp?.component
  && resolved.source?.file === stamp?.file && resolved.source?.line === stampLine, { mcp: { component: resolved?.component, source: resolved?.source, confidence: resolved?.confidence }, grader: { component: stamp?.component, file: stamp?.file, line: stampLine } });

// 3/4. Actions on the element and the attempts (a submit closes an attempt).
const actions = records.filter(row => row.kind === 'dom.action' && row.target?.element_key === key).sort(order);
const attempts = []; let pending = [];
for (const action of actions) { pending.push(action); if (action.event === 'submit') { attempts.push({ submit: action, members: pending }); pending = []; } }
const newestFirst = [...attempts].reverse();
const historyCall = call('element_history');
const history = historyCall?.result;
check('3 actions: element_history lists the element\'s dom.action rows (target.element_key equality), newest first', history?.status === 'ok'
  && JSON.stringify(history.actions.map(row => row.action_id)) === JSON.stringify([...actions].reverse().slice(0, historyCall.args.n ?? 10).map(row => row.action_id)),
  { grader: actions.length, mcp: history?.actions?.length });
check('4 attempts: grouped as the grader groups them (each submit closes one), newest first', history && history.attempts.length === newestFirst.length
  && newestFirst.slice(0, history.attempts.length).every((attempt, index) => history.attempts[index].carrier_action_id === attempt.submit.action_id
    && JSON.stringify([...history.attempts[index].action_ids].sort()) === JSON.stringify(attempt.members.map(row => row.action_id).sort())),
  { grader: newestFirst.map(attempt => [attempt.submit.action_id, attempt.members.map(row => row.event)]), mcp: history?.attempts?.map(attempt => [attempt.carrier_action_id, attempt.events]) });

// 5/6/7/8. Per attempt: request, route/status, handlers, db, entry handler, frontier.
const byId = new Map(spans.map(span => [span.span_id, span]));
const descendsFrom = (span, ancestorId) => { for (let cursor = span; cursor; cursor = byId.get(cursor.parent_span_id)) if (cursor.parent_span_id === ancestorId) return true; return false; };
const statusOf = span => span?.attributes?.['http.response.status_code'] ?? span?.attributes?.['http.status_code'] ?? null;
const recomputed = newestFirst.map(attempt => {
  const id = attempt.submit.action_id;
  const requests = records.filter(row => row.kind === 'network.request' && row.action_id === id && row.internal !== true);
  const request = requests[0];
  const server = request ? spans.filter(span => span.kind === 'server' && span.trace_id === request.trace_context?.trace_id && span.parent_span_id === request.trace_context?.span_id) : [];
  const handlers = server.length === 1 ? spans.filter(span => span.instrumentation?.name === 'producttrace-express-handlers' && span.trace_id === server[0].trace_id && descendsFrom(span, server[0].span_id)) : [];
  const db = spans.filter(span => (span.attributes?.['db.system'] || span.attributes?.['db.system.name']) && handlers.some(handler => descendsFrom(span, handler.span_id)));
  const enter = records.filter(row => row.kind === 'function.enter' && row.action_id === id && String(row.parent_continuation_id || '').startsWith(`continuation:${id}:action:`)).sort(order)[0];
  const fn = enter ? manifestRow.get(enter.function_id) : null;
  const content = fn ? readSource(fn.source.file) : null;
  const name = content ? /([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?$/u.exec(content.slice(Math.max(0, fn.source.start - 120), fn.source.start))?.[1] ?? null : null;
  return { id, requests: requests.length, method: request?.method, path: request ? new URL(request.url, 'http://x').pathname : null, server_spans: server.length,
    route: server[0]?.attributes?.['http.route'] ?? null, status: statusOf(server[0]), handlers: handlers.map(span => span.attributes?.['producttrace.express.handler.name']), db: db.length,
    entry: enter?.function_id ?? null, entry_file: fn?.source.file ?? null, entry_line: content ? lineOf(content, fn.source.start) : null, entry_name: name,
    entry_hash_ok: content ? sha(content) === /^function:([0-9a-f]{64}):/u.exec(enter.function_id)?.[1] : false, bound_on_submit: content && name ? content.includes(`onSubmit={${name}}`) : false,
    expected_stopped_at: handlers.length && !db.length ? 'handler' : db.length ? null : server.length ? 'route' : 'network' };
});
(history?.attempts || []).forEach((attempt, index) => {
  const want = recomputed[index];
  if (!want) { check(`5-8 attempt ${index + 1}`, false, 'no grader attempt'); return; }
  check(`5 attempt ${index + 1} (${want.id}): request`, want.requests === 1 && attempt.request?.method === want.method && attempt.request?.path === want.path, { mcp: attempt.request && `${attempt.request.method} ${attempt.request.path}`, grader: `${want.method} ${want.path}` });
  check(`6 attempt ${index + 1}: route and status from the exact server span; handler spans; no DB span`, want.server_spans === 1 && attempt.route?.route === want.route && attempt.route?.status_code === want.status && want.db === 0, { mcp: [attempt.route?.route, attempt.route?.status_code], grader: [want.route, want.status, want.handlers, `db=${want.db}`] });
  check(`7 attempt ${index + 1}: entry handler = first depth-zero function of the submit; developer-named onSubmit handler`, attempt.entry_handler?.function_id === want.entry && attempt.entry_handler?.source?.file === want.entry_file
    && attempt.entry_handler?.source?.line === want.entry_line && want.entry_hash_ok && want.bound_on_submit, { mcp: attempt.entry_handler?.source, grader: { file: want.entry_file, line: want.entry_line, name: want.entry_name, bound_on_submit: want.bound_on_submit } });
  check(`8 attempt ${index + 1}: frontier`, attempt.stopped_at === want.expected_stopped_at && (Number(want.status) >= 400 ? attempt.because.includes(String(want.status)) : !/server responded/u.test(attempt.because)),
    { mcp: [attempt.reached, attempt.stopped_at, attempt.because], grader: [want.expected_stopped_at, want.status] });
});
check('4 attempts: statuses newest first are 200, 422, 200', JSON.stringify(recomputed.slice(0, 3).map(row => row.status)) === JSON.stringify([200, 422, 200]), recomputed.slice(0, 3).map(row => row.status));

// 9. action_chain for the failing attempt.
const failing = recomputed.find(row => Number(row.status) >= 400);
const chainCall = call('action_chain');
const chain = chainCall?.result;
const route = chain?.stops?.find(stop => stop.stop === 'route');
check('9 action_chain: asked for the grader\'s failing submit; route status and because name it', failing && chainCall.args.action_id === failing.id && route?.status_code === failing.status
  && chain.because.includes(String(failing.status)) && chain.stopped_at === failing.expected_stopped_at, { asked: chainCall?.args.action_id, grader: failing?.id, route: route?.status_code, because: chain?.because });

// 10. The no-key fallback never picks and lists the key.
const fallbackCall = call('resolve_element', args => args.element_key === undefined);
const fallbackKeys = (fallbackCall?.result?.candidates || []).flatMap(candidate => (candidate.keys || []).map(entry => entry.element_key));
check('10 fallback without a key: ambiguous, candidates include the key', fallbackCall?.result?.status === 'ambiguous' && fallbackCall.result.confidence === 'ambiguous' && fallbackKeys.includes(key),
  { status: fallbackCall?.result?.status, candidates: fallbackCall?.result?.candidates_total, includes: fallbackKeys.includes(key) });

const passed = checks.filter(entry => entry.pass).length;
const report = ['# G5 grade (recomputed from the raw store)', '', `Evidence: \`${path.relative(process.cwd(), evidence) || '.'}\`; store: \`${path.relative(process.cwd(), storeDir)}\`; source root: \`${sourceRoot}\`.`,
  `Rows: ${records.length} records, ${spans.length} spans, ${manifests.length} manifest(s). Element key: \`${key}\`.`, '',
  '| check | result | detail |', '|---|---|---|', ...checks.map(entry => `| ${entry.name} | ${entry.pass ? 'PASS' : 'FAIL'} | ${entry.detail.replace(/\|/gu, '\\|').slice(0, 600)} |`), '',
  `Overall: ${passed === checks.length ? 'PASS' : 'FAIL'} (${passed}/${checks.length}).`, '',
  'Independence caveat: written by the implementing agent; shares no code with analysis/, collector/ or mcp/. A separate agent should rerun it.', ''].join('\n');
if (options.out) fs.writeFileSync(path.resolve(options.out), report);
console.log(report);
process.exitCode = passed === checks.length ? 0 : 1;
