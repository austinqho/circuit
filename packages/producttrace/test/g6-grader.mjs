#!/usr/bin/env node
/**
 * G6 grader. Independent of the implementation: imports nothing from
 * analysis/, collector/ or mcp/. From the raw store (runs.jsonl,
 * records.jsonl[.gz], spans.jsonl[.gz], manifests/*.json[.gz]) it recomputes,
 * for every compare/<before>__<after>.json the scenario wrote: the selected
 * action per run, its first depth-zero entered function, its request, the
 * exact-parent server span (route + status), the handler spans under it, the
 * db spans under those, the manifest remap of the entry function, and the
 * path_changed verdict. It then checks the MCP output against its own values
 * and against the gate's expectation (docs/gates/G6-verification.md §2).
 *
 *   node test/g6-grader.mjs <store-dir> --compare <dir with compare/*.json> [--out GRADE.md]
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { parseArgs } from 'node:util';

const { values: args, positionals } = parseArgs({ allowPositionals: true, options: { compare: { type: 'string' }, out: { type: 'string' } } });
const storeDir = positionals[0];
if (!storeDir || !args.compare) throw new Error('usage: g6-grader.mjs <store-dir> --compare <dir> [--out GRADE.md]');

const readText = file => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : fs.existsSync(`${file}.gz`) ? zlib.gunzipSync(fs.readFileSync(`${file}.gz`)).toString('utf8') : null);
const jsonl = file => (readText(file) || '').split('\n').filter(line => line.trim()).map(line => JSON.parse(line));
const runs = jsonl(path.join(storeDir, 'runs.jsonl'));
const records = jsonl(path.join(storeDir, 'records.jsonl'));
const spans = jsonl(path.join(storeDir, 'spans.jsonl'));
const manifests = new Map();
for (const name of fs.readdirSync(path.join(storeDir, 'manifests'))) {
  const base = name.replace(/\.gz$/u, '');
  if (!base.endsWith('.json')) continue;
  const value = JSON.parse(readText(path.join(storeDir, 'manifests', base)));
  manifests.set(value.build || base.slice(0, -5), value);
}

const ID_SEGMENT = /^(?:[0-9a-f]{24}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{8,}|[0-9]+|[a-z]+_(?=[A-Za-z0-9_-]*[0-9A-Z])[A-Za-z0-9_-]{8,})$/iu;
const pathOf = url => { try { return new URL(url, 'http://x.invalid').pathname; } catch { return String(url); } };
const normalized = url => pathOf(url).split('/').map(part => (ID_SEGMENT.test(part) ? ':id' : part)).join('/');
const statusOf = span => span?.attributes?.['http.response.status_code'] ?? span?.attributes?.['http.status_code'] ?? null;

function facts(label, step, event) {
  const run = runs.filter(row => row.label === label);
  if (run.length !== 1) return { error: `runs labelled ${label}: ${run.length}` };
  const window = run[0].steps.find(row => row.name === step);
  const actions = records.filter(row => row.kind === 'dom.action' && row.tracer_run === run[0].run_id && row.event === event && row.timestamp >= window.started && row.timestamp <= window.ended);
  if (actions.length !== 1) return { error: `${label}: ${actions.length} ${event} actions in ${step}` };
  const action = actions[0];
  const own = records.filter(row => row.action_id === action.action_id && row.capture_page_id === action.capture_page_id).sort((a, b) => a.sequence - b.sequence);
  const entry = own.find(row => row.kind === 'function.enter' && String(row.parent_continuation_id || '').startsWith(`continuation:${action.action_id}:action:`)) || null;
  const requests = own.filter(row => row.kind === 'network.request' && row.internal !== true && row.transport_internal !== true);
  const request = requests.at(-1) || null;
  let server = null; let handlers = []; let dbs = [];
  if (request) {
    const trace = request.trace_context?.trace_id; const parent = request.trace_context?.span_id;
    const servers = spans.filter(span => span.trace_id === trace && span.kind === 'server' && span.parent_span_id === parent);
    server = servers.length === 1 ? servers[0] : null;
    if (server) {
      const inTrace = spans.filter(span => span.trace_id === trace);
      const byId = new Map(inTrace.map(span => [span.span_id, span]));
      const descends = (span, ancestor) => { let cursor = span; for (let hops = 0; cursor && hops < 64; hops += 1) { if (cursor.parent_span_id === ancestor) return true; cursor = byId.get(cursor.parent_span_id); } return false; };
      handlers = inTrace.filter(span => span.instrumentation?.name === 'producttrace-express-handlers' && descends(span, server.span_id));
      dbs = inTrace.filter(span => (span.attributes?.['db.system'] || span.attributes?.['db.system.name']) && handlers.some(handler => descends(span, handler.span_id)));
    }
  }
  return { label, run_id: run[0].run_id, build: run[0].build, commit: run[0].source?.commit ?? null, action_id: action.action_id, entry: entry?.function_id ?? null,
    request: request ? `${String(request.method || 'GET').toUpperCase()} ${normalized(request.url)}` : null, requests: requests.length,
    route: server ? `${server.attributes?.['http.route'] ?? '?'}` : null, status: statusOf(server),
    handlers: handlers.map(span => `${span.attributes['http.route']}#${span.attributes['producttrace.express.handler.index']}=${span.attributes['producttrace.express.handler.name']}`).sort(),
    dbs: dbs.map(span => `${span.attributes['db.operation'] ?? span.name} ${span.attributes['db.collection.name'] ?? span.attributes['db.mongodb.collection'] ?? ''}`).sort() };
}

/** Independent remap, same order as the gate: text_sha256, then a unique name (several same-named: unique text among them, else abstain), then ordinal with equal structure. */
function remap(fromBuild, toBuild, functionId) {
  const from = manifests.get(fromBuild); const to = manifests.get(toBuild);
  if (!from || !to) return { kind: 'no_manifest' };
  const row = from.functions.find(value => value.id === functionId);
  if (!row) return { kind: 'unmapped_revision', basis: 'unmapped', why: 'not in own manifest' };
  const list = manifest => manifest.functions.filter(value => value.source.file === row.source.file)
    .sort((a, b) => a.source.start - b.source.start || b.source.end - a.source.end);
  const left = list(from); const right = list(to);
  if (!right.length) return { kind: 'unmapped_revision', basis: 'unmapped' };
  if (row.text_sha256) { const hits = right.filter(value => value.text_sha256 === row.text_sha256); if (hits.length === 1) return { kind: 'mapped', basis: 'text_match', id: hits[0].id }; }
  if (row.name) {
    const hits = right.filter(value => value.name === row.name);
    if (hits.length === 1) return { kind: 'mapped', basis: 'name_match', id: hits[0].id };
    if (hits.length > 1) {
      const textual = hits.filter(value => row.text_sha256 && value.text_sha256 === row.text_sha256);
      return textual.length === 1 ? { kind: 'mapped', basis: 'text_match', id: textual[0].id } : { kind: 'unmapped_revision', basis: 'unmapped', why: `${hits.length} functions named ${row.name}` };
    }
  }
  const shape = items => { const open = []; return items.map(value => { while (open.length && !(value.source.start >= open.at(-1)[0] && value.source.end <= open.at(-1)[1])) open.pop(); const token = `${value.kind}@${open.length}`; open.push([value.source.start, value.source.end]); return token; }).join(','); };
  if (shape(left) !== shape(right)) return { kind: 'unmapped_revision', basis: 'unmapped', why: 'structure differs' };
  return { kind: 'mapped', basis: 'ordinal', id: right[left.findIndex(value => value.id === functionId)].id };
}

let lastBasis = null;
function entryKind(before, after) {
  lastBasis = null;
  if (!before.entry && !after.entry) return 'none';
  if (!before.entry || !after.entry) return before.entry ? 'removed' : 'added';
  if (before.entry === after.entry) return 'same';
  if (before.build === after.build) return 'different_handler';
  const forward = remap(before.build, after.build, before.entry);
  if (forward.kind !== 'mapped') return forward.kind === 'no_manifest' ? 'no_manifest' : 'unmapped_revision';
  const backward = remap(after.build, before.build, after.entry);
  lastBasis = forward.basis;
  return forward.id === after.entry && backward.id === before.entry ? 'source_revision' : 'different_handler';
}

const EXPECT = {
  'A-baseline__B-seeded-422': { path_changed: true, status: [200, 422], entry: 'same' },
  'B-seeded-422__C-fix-r2': { path_changed: true, status: [422, 200], entry: 'same' },
  'A-baseline__C-fix-r2': { path_changed: false, status: [200, 200], entry: 'same' },
  // Run "C-fix" was executed at the seed commit (the revert command failed; see
  // RUN.md). It is kept, append-only, as a replay-determinism control: B vs a
  // second replay of B must be unchanged.
  'B-seeded-422__C-fix': { path_changed: false, status: [422, 422], entry: 'same' },
  'A-baseline__D-noop-refactor': { path_changed: false, status: [200, 200], entry: 'source_revision' },
  // Amended 2026-09-24 (fix/outcome-labels): E is a silent early return (no
  // validation feedback in its receipt), so the after chain stops at `browser`
  // (no_request), not `validation`; the bug → fix verdict is still a path
  // change on the request (the request stop is removed).
  'A-baseline__E-frontend-early-return': { path_changed: true, status: [200, null], entry: 'source_revision', request: 'removed', after_stopped_at: 'browser' },
};

const lines = ['# G6 grade (independent recomputation from the raw store)', '', `Store: \`${storeDir}\` (${runs.length} runs, ${records.length} records, ${spans.length} spans, ${manifests.size} build manifests). Compare dir: \`${args.compare}\`.`, ''];
const verdicts = [];
for (const file of fs.readdirSync(path.join(args.compare, 'compare')).filter(name => name.includes('__') && name.endsWith('.json')).sort()) {
  const saved = JSON.parse(fs.readFileSync(path.join(args.compare, 'compare', file), 'utf8'));
  const result = saved.compare_chains; const name = file.slice(0, -5);
  const [beforeLabel, afterLabel] = name.split('__');
  const before = facts(beforeLabel, saved.pair.before.step, saved.pair.before.event); const after = facts(afterLabel, saved.pair.after.step, saved.pair.after.event);
  const checks = [];
  const check = (label, ok, detail = '') => checks.push({ label, ok: Boolean(ok), detail });
  if (before.error || after.error) { check('selection', false, before.error || after.error); }
  else {
    check('selected before action = MCP input', before.action_id === saved.pair.before.action_id, `${before.action_id} (run ${before.run_id}, build ${before.build}, fixture ${String(before.commit).slice(0, 8)})`);
    check('selected after action = MCP input', after.action_id === saved.pair.after.action_id, `${after.action_id} (run ${after.run_id}, build ${after.build}, fixture ${String(after.commit).slice(0, 8)})`);
    const kind = entryKind(before, after);
    const mcpEntry = result.stops.find(stop => stop.stop === 'entry_handler');
    const mcpKind = !mcpEntry ? 'none' : mcpEntry.status === 'changed' ? mcpEntry.change_kind : mcpEntry.status;
    check('entry function (first depth-zero function.enter) = MCP entry', (mcpEntry?.before?.function_id ?? null) === before.entry && (mcpEntry?.after?.function_id ?? null) === after.entry,
      `${before.entry} / ${after.entry}`);
    check('entry change kind (independent remap) = MCP', kind === mcpKind, `grader ${kind}, MCP ${mcpKind}${mcpEntry?.change_basis ? ` (${mcpEntry.change_basis})` : ''}`);
    const status = (left, right) => (left == null && right == null ? null : left == null ? 'added' : right == null ? 'removed' : left === right ? 'same' : 'changed');
    const mcpStop = kindName => result.stops.find(stop => stop.stop === kindName)?.status ?? null;
    check('request stop', status(before.request, after.request) === mcpStop('request'), `${before.request} → ${after.request}`);
    check('route stop (route + status)', status(before.route && `${before.route} ${before.status}`, after.route && `${after.route} ${after.status}`) === mcpStop('route'), `${before.route} ${before.status} → ${after.route} ${after.status}`);
    const handlerKeys = [...new Set([...before.handlers, ...after.handlers].map(value => value.split('=')[0]))];
    const handlerOk = handlerKeys.every(key => { const left = before.handlers.find(value => value.startsWith(`${key}=`)); const right = after.handlers.find(value => value.startsWith(`${key}=`));
      return status(left, right) === result.stops.find(stop => stop.stop === 'handler' && stop.key === key)?.status; });
    check('handler stops', handlerOk && result.stops.filter(stop => stop.stop === 'handler').length === handlerKeys.length, `${before.handlers.length} → ${after.handlers.length}`);
    check('db stops', JSON.stringify(before.dbs) === JSON.stringify(after.dbs) ? result.stops.filter(stop => stop.stop === 'db').every(stop => stop.status === 'same') : result.stops.some(stop => stop.stop === 'db' && stop.status !== 'same'), `${before.dbs.length} → ${after.dbs.length}`);
    check('outcome http_status', result.outcome_delta.before.http_status === before.status && result.outcome_delta.after.http_status === after.status
      && result.outcome_delta.changed.includes('http_status') === (before.status !== after.status), `${before.status} → ${after.status}`);
    const graderChanged = before.request !== after.request || before.route !== after.route || before.status !== after.status
      || JSON.stringify(before.handlers) !== JSON.stringify(after.handlers) || JSON.stringify(before.dbs) !== JSON.stringify(after.dbs) || !['same', 'source_revision', 'none'].includes(kind);
    check('path_changed (grader) = MCP', graderChanged === result.path_changed, `grader ${graderChanged}, MCP ${result.path_changed}`);
    const expected = EXPECT[name];
    if (expected) {
      check('gate expectation: path_changed', result.path_changed === expected.path_changed, `expected ${expected.path_changed}`);
      check('gate expectation: statuses', before.status === expected.status[0] && after.status === expected.status[1], `expected ${expected.status.join(' → ')}`);
      // "manifest_remap" is the pre-amendment name of the remap basis (evidence of 2026-09-23 before the
      // text/name/ordinal amendment); a remap-decided basis is required, never the legacy content_hash rule.
      check('gate expectation: entry', kind === expected.entry && (expected.entry !== 'source_revision' || ['manifest_remap', 'text_match', 'name_match', 'ordinal'].includes(mcpEntry?.change_basis)),
        `expected ${expected.entry}${expected.entry === 'source_revision' ? ` via a manifest remap basis (MCP ${mcpEntry?.change_basis})` : ''}`);
      if (expected.request) check('gate expectation: request stop', mcpStop('request') === expected.request && result.path_change_reasons?.includes('request'), `expected ${expected.request}, MCP ${mcpStop('request')}`);
      if (expected.after_stopped_at) check('gate expectation: after stopped_at', result.outcome_delta.after.stopped_at === expected.after_stopped_at, `expected ${expected.after_stopped_at}, MCP ${result.outcome_delta.after.stopped_at}`);
      if (expected.entry === 'source_revision' && mcpEntry?.change_basis !== 'manifest_remap') check('remap basis (grader) = MCP', lastBasis === mcpEntry?.change_basis, `grader ${lastBasis}, MCP ${mcpEntry?.change_basis}`);
    }
  }
  const pass = checks.every(row => row.ok);
  verdicts.push({ pair: name, pass });
  lines.push(`## ${name}: ${pass ? 'PASS' : 'FAIL'}`, '', '| check | ok | detail |', '|---|---|---|', ...checks.map(row => `| ${row.label} | ${row.ok ? 'yes' : '**no**'} | ${String(row.detail).replace(/\|/gu, '\\|')} |`), '');
}
lines.push(`Overall: ${verdicts.every(row => row.pass) ? 'PASS' : 'FAIL'} (${verdicts.filter(row => row.pass).length}/${verdicts.length} pairs).`, '',
  'Independence caveat: written by the implementing agent; shares no code with analysis/, collector/ or mcp/. A separate agent should rerun it.');
const text = lines.join('\n') + '\n';
if (args.out) fs.writeFileSync(args.out, text);
process.stdout.write(text);
process.exitCode = verdicts.every(row => row.pass) ? 0 : 1;
