// G6: compare_chains across two builds in one store. The entry-handler stop is
// decided by remapping the before function through the other build's manifest
// (docs/gates/G6-verification.md §4), not by the G4 content-hash rule.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { createStore, remapFunctionId } from '../collector/store.mjs';
import { enrichManifest, functionNameAt } from '../collector/store-writer.mjs';
import { callTool } from '../mcp/tools.mjs';

const H = letter => letter.repeat(64);
const fid = (hash, start, end) => `function:${hash}:${start}:${end}`;
const manifestOf = (build, rows) => ({ schema: 'producttrace.runtime-attribution-manifest.v1', build,
  functions: rows.map(([id, file], index) => { const [, , start, end] = id.split(':'); return { id, index, kind: 'function', source: { file, start: Number(start), end: Number(end) } }; }) });

let clock = 1_800_000_000_000;
/** One submit whose entry handler sends one request (optionally joined to a server span). */
function submitRows({ actionId, page, build, run, functionId, request = true, status = null, traceId = null }) {
  const at = (clock += 10_000);
  const cont = `continuation:${actionId}:action:1`; const fcont = `continuation:${actionId}:function:2`;
  const tag = row => ({ schema: 'producttrace.runtime-evidence.v1', capture_page_id: page, tracer_build: build, tracer_run: run, timestamp: at, ...row });
  const spanId = traceId ? traceId.slice(0, 16) : '1111111111111111';
  const rows = [
    tag({ sequence: 1, kind: 'dom.action', action_id: actionId, event: 'submit', target: { tag: 'button', attributes: {} }, submitter: { tag: 'button', attributes: {} },
      form: { tag: 'form', attributes: {}, ref: 'object:1' }, form_ref: 'object:1', continuation_id: cont, parent_continuation_id: null }),
    tag({ sequence: 2, kind: 'function.enter', action_id: actionId, function_id: functionId, invoked_by: 'event', entry_hint: true, continuation_kind: 'function',
      parent_continuation_id: cont, continuation_id: fcont }),
  ];
  if (request) rows.push(tag({ sequence: 3, kind: 'network.request', action_id: actionId, action_occurrence_id: actionId, request_occurrence_id: `${actionId}:request:1`,
    method: 'POST', url: '/api/workspace/demo/update', transport: 'fetch', internal: false, linkage_kind: 'direct', parent_continuation_id: fcont,
    terminal_owner_continuation_id: fcont, trace_context: { trace_id: traceId || 'a'.repeat(32), span_id: spanId, trace_flags: '01' } }));
  rows.push(tag({ sequence: 4, kind: 'function.exit', action_id: actionId, function_id: functionId, parent_continuation_id: cont, continuation_id: fcont }));
  if (!request) rows.push(tag({ sequence: 5, kind: 'dom.mutation', action_id: actionId, count: 1, parent_continuation_id: fcont }));
  const spans = [];
  if (request && status != null) {
    const server = { schema: 'producttrace.backend-span.v1', trace_id: traceId, span_id: `${traceId.slice(16, 28)}0001`, parent_span_id: spanId, kind: 'server', status: { code: 0 },
      attributes: { 'http.route': '/api/workspace/:slug/update', 'http.request.method': 'POST', 'http.response.status_code': status } };
    const handler = { schema: 'producttrace.backend-span.v1', trace_id: traceId, span_id: `${traceId.slice(16, 28)}0002`, parent_span_id: server.span_id, kind: 'internal', status: { code: 0 },
      attributes: { 'http.route': '/api/workspace/:slug/update', 'producttrace.express.handler.name': 'update', 'producttrace.express.handler.index': 0 },
      instrumentation: { name: 'producttrace-express-handlers' } };
    spans.push(server, handler);
  }
  return { rows, spans };
}

// Build 1: form.jsx has component(0..500) ⊃ handleUpdate(100..300), onDelete(320..400).
const FILE = 'src/form.jsx';
const b1 = { component: fid(H('a'), 0, 500), update: fid(H('a'), 100, 300), remove: fid(H('a'), 320, 400) };
// Build 2: a local variable renamed inside handleUpdate (+4 characters); same structure.
const b2 = { component: fid(H('b'), 0, 504), update: fid(H('b'), 100, 304), remove: fid(H('b'), 324, 404) };
// Build 3: a helper function added to the file (different structure).
const b3 = { component: fid(H('c'), 0, 560), update: fid(H('c'), 100, 300), helper: fid(H('c'), 302, 330), remove: fid(H('c'), 380, 460) };
const manifests = new Map([
  ['b-one', manifestOf('b-one', [[b1.component, FILE], [b1.update, FILE], [b1.remove, FILE]])],
  ['b-two', manifestOf('b-two', [[b2.component, FILE], [b2.update, FILE], [b2.remove, FILE]])],
  ['b-three', manifestOf('b-three', [[b3.component, FILE], [b3.update, FILE], [b3.helper, FILE], [b3.remove, FILE]])],
]);

function storeOf(entries, options = {}) {
  const parts = entries.map(entry => submitRows(entry));
  return createStore({ records: parts.flatMap(part => part.rows), spans: parts.flatMap(part => part.spans), manifests: options.legacy ? new Map() : manifests,
    manifest: options.legacy ? manifestOf('legacy', [...manifests.values()].flatMap(value => value.functions.map(row => [row.id, row.source.file]))) : null, now: () => clock + 60_000 });
}

test('remapFunctionId maps by pre-order ordinal when the file structure is equal, and abstains otherwise', () => {
  const plain = remapFunctionId(manifests.get('b-one'), manifests.get('b-two'), b1.update);
  assert.deepEqual({ ...plain, tried: undefined }, { status: 'mapped', basis: 'ordinal', mapped_id: b2.update, file: FILE, ordinal: 1, functions_in_file: 3, tried: undefined });
  assert.deepEqual(plain.tried, ['text_match: no text hash in the manifest', 'name_match: no name in the manifest']);
  assert.equal(remapFunctionId(manifests.get('b-one'), manifests.get('b-two'), b1.remove).mapped_id, b2.remove);
  const changed = remapFunctionId(manifests.get('b-one'), manifests.get('b-three'), b1.update);
  assert.equal(changed.status, 'unmapped'); assert.equal(changed.basis, 'unmapped'); assert.match(changed.reason, /function structure of src\/form\.jsx differs/u);
  assert.equal(remapFunctionId(manifests.get('b-one'), manifests.get('b-two'), fid(H('d'), 1, 2)).status, 'unmapped');
  assert.equal(remapFunctionId(manifests.get('b-one'), { functions: [] }, b1.update).status, 'unmapped');
});

test('no-op refactor across builds without text/name keys: source_revision via ordinal, path unchanged', () => {
  const store = storeOf([
    { actionId: 'action:a:1', page: 'p1', build: 'b-one', run: 'r1', functionId: b1.update },
    { actionId: 'action:d:1', page: 'p2', build: 'b-two', run: 'r2', functionId: b2.update },
  ]);
  const result = callTool(store, 'compare_chains', { before_action_id: 'action:a:1', after_action_id: 'action:d:1' });
  assert.equal(result.status, 'ok');
  const entry = result.stops.find(stop => stop.stop === 'entry_handler');
  assert.equal(entry.status, 'changed'); assert.equal(entry.change_kind, 'source_revision'); assert.equal(entry.change_basis, 'ordinal');
  assert.equal(entry.remap.mapped_id, b2.update); assert.equal(entry.remap.reverse_mapped_id, b1.update);
  assert.equal(result.path_changed, false, result.summary);
  assert.equal(result.stops.find(stop => stop.stop === 'request').status, 'same');
});

test('rebinding to another function in the edited file stays different_handler (negative control)', () => {
  const store = storeOf([
    { actionId: 'action:a:1', page: 'p1', build: 'b-one', run: 'r1', functionId: b1.update },
    { actionId: 'action:x:1', page: 'p2', build: 'b-two', run: 'r2', functionId: b2.remove },
  ]);
  const result = callTool(store, 'compare_chains', { before_action_id: 'action:a:1', after_action_id: 'action:x:1' });
  const entry = result.stops.find(stop => stop.stop === 'entry_handler');
  assert.equal(entry.change_kind, 'different_handler'); assert.equal(entry.change_basis, 'ordinal');
  assert.equal(result.path_changed, true); assert.deepEqual(result.path_change_reasons, ['entry_handler']);
});

test('a changed function structure is unmapped_revision and counts as a path change (abstain, never claim unchanged)', () => {
  const store = storeOf([
    { actionId: 'action:a:1', page: 'p1', build: 'b-one', run: 'r1', functionId: b1.update },
    { actionId: 'action:s:1', page: 'p2', build: 'b-three', run: 'r3', functionId: b3.update },
  ]);
  const result = callTool(store, 'compare_chains', { before_action_id: 'action:a:1', after_action_id: 'action:s:1' });
  const entry = result.stops.find(stop => stop.stop === 'entry_handler');
  assert.equal(entry.change_kind, 'unmapped_revision'); assert.equal(entry.change_basis, 'unmapped'); assert.match(entry.detail, /cannot remap/u);
  assert.equal(result.path_changed, true);
});

test('two functions in one build are different handlers; a legacy store falls back to the content-hash rule', () => {
  const same = storeOf([
    { actionId: 'action:a:1', page: 'p1', build: 'b-one', run: 'r1', functionId: b1.update },
    { actionId: 'action:a:2', page: 'p2', build: 'b-one', run: 'r2', functionId: b1.remove },
  ]);
  const sameBuild = callTool(same, 'compare_chains', { before_action_id: 'action:a:1', after_action_id: 'action:a:2' }).stops.find(stop => stop.stop === 'entry_handler');
  assert.equal(sameBuild.change_kind, 'different_handler'); assert.equal(sameBuild.remap.status, 'same_build'); assert.equal(sameBuild.change_basis, 'same_build');
  const legacy = storeOf([
    { actionId: 'action:a:1', page: 'p1', build: undefined, run: undefined, functionId: b1.update },
    { actionId: 'action:d:1', page: 'p2', build: undefined, run: undefined, functionId: b2.update },
  ], { legacy: true });
  const entry = callTool(legacy, 'compare_chains', { before_action_id: 'action:a:1', after_action_id: 'action:d:1' }).stops.find(stop => stop.stop === 'entry_handler');
  assert.equal(entry.change_basis, 'content_hash'); assert.equal(entry.change_kind, 'source_revision');
});

test('a seeded 422 shows at the route stop and in the outcome, and the frontier says so; the revert restores it', () => {
  const store = storeOf([
    { actionId: 'action:a:1', page: 'p1', build: 'b-one', run: 'r1', functionId: b1.update, status: 200, traceId: '1'.repeat(32) },
    { actionId: 'action:b:1', page: 'p2', build: 'b-one', run: 'r2', functionId: b1.update, status: 422, traceId: '2'.repeat(32) },
    { actionId: 'action:c:1', page: 'p3', build: 'b-one', run: 'r3', functionId: b1.update, status: 200, traceId: '3'.repeat(32) },
  ]);
  const ab = callTool(store, 'compare_chains', { before_action_id: 'action:a:1', after_action_id: 'action:b:1' });
  assert.equal(ab.path_changed, true, ab.summary);
  assert.deepEqual(ab.stops.find(stop => stop.stop === 'route'), { stop: 'route', key: '/api/workspace/:slug/update', status: 'changed', change_kind: 'different_value',
    before: 'POST /api/workspace/:slug/update 200', after: 'POST /api/workspace/:slug/update 422', detail: null });
  assert.ok(ab.outcome_delta.changed.includes('http_status'));
  assert.equal(ab.after.stopped_at, 'handler'); assert.match(ab.after.because, /^server responded 422; /u);
  assert.doesNotMatch(ab.before.because, /server responded/u);
  const bc = callTool(store, 'compare_chains', { before_action_id: 'action:b:1', after_action_id: 'action:c:1' });
  assert.equal(bc.path_changed, true); assert.equal(bc.outcome_delta.after.http_status, 200);
  const ac = callTool(store, 'compare_chains', { before_action_id: 'action:a:1', after_action_id: 'action:c:1' });
  assert.equal(ac.path_changed, false, ac.summary); assert.ok(ac.stops.every(stop => stop.status === 'same'));
});

test('a frontend early return removes the request stops while the entry handler is a source revision', () => {
  const store = storeOf([
    { actionId: 'action:a:1', page: 'p1', build: 'b-one', run: 'r1', functionId: b1.update, status: 200, traceId: '4'.repeat(32) },
    { actionId: 'action:e:1', page: 'p2', build: 'b-two', run: 'r2', functionId: b2.update, request: false },
  ]);
  const result = callTool(store, 'compare_chains', { before_action_id: 'action:a:1', after_action_id: 'action:e:1' });
  assert.equal(result.path_changed, true);
  for (const kind of ['request', 'route', 'handler']) assert.equal(result.stops.find(stop => stop.stop === kind).status, 'removed', kind);
  assert.equal(result.stops.find(stop => stop.stop === 'entry_handler').change_kind, 'source_revision');
});

// --- Remap bases on real source text (coordinator amendment): text_match, then
// name_match (nearest start offset), then ordinal, then unmapped.

/** A manifest for `content` whose functions are the given source snippets, enriched as the store writer does. */
function realManifest(build, file, content, snippets) {
  const hash = createHash('sha256').update(content).digest('hex');
  const functions = snippets.map((snippet, index) => {
    const start = content.indexOf(snippet); assert.ok(start >= 0, snippet);
    return { id: `function:${hash}:${start}:${start + snippet.length}`, index, kind: 'function', source: { file, start, end: start + snippet.length } };
  });
  return enrichManifest({ build, functions }, name => (name === file ? content : null));
}
const SRC = 'src/settings.jsx';
const HANDLER = 'async (e) => {\n    e.preventDefault();\n    const data = read(form);\n    await save(data);\n  }';
const HANDLER_REFORMATTED = 'async (e) => {\n      e.preventDefault();   const data = read(form);\n      await save(data);\n  }';
const HANDLER_RENAMED = 'async (e) => {\n    e.preventDefault();\n    const payload = read(form);\n    await save(payload);\n  }';
const HELPER = '(value) => value.trim()';
const before = `export default function Settings() {\n  const handleUpdate = ${HANDLER};\n  return null;\n}\n`;
const beforeFns = ['function Settings() {\n  const handleUpdate = ' + HANDLER + ';\n  return null;\n}', HANDLER];

test('functionNameAt reads declaration, method and assigned names; enrichManifest only enriches rows whose file hash matches the id', () => {
  assert.equal(functionNameAt(before, before.indexOf(HANDLER), before.indexOf(HANDLER) + HANDLER.length), 'handleUpdate');
  assert.equal(functionNameAt(before, before.indexOf('function Settings'), before.length), 'Settings');
  const manifest = realManifest('b-1', SRC, before, beforeFns);
  assert.deepEqual(manifest.functions.map(row => row.name), ['Settings', 'handleUpdate']);
  assert.ok(manifest.functions.every(row => /^[0-9a-f]{64}$/u.test(row.text_sha256)));
  const stale = enrichManifest({ functions: manifest.functions.map(({ text_sha256, name, ...row }) => row) }, () => before.replace('null', 'undefined'));
  assert.ok(stale.functions.every(row => !('text_sha256' in row) && !('name' in row)), 'a checkout that does not match the build is not used');
});

test('text_match: a function added above the handler shifts the ordinal, and the whitespace-normalised text still maps it', () => {
  const after = `export default function Settings() {\n  const clean = ${HELPER};\n  const handleUpdate = ${HANDLER_REFORMATTED};\n  return null;\n}\n`;
  const left = realManifest('b-1', SRC, before, beforeFns);
  const right = realManifest('b-2', SRC, after, [`function Settings() {\n  const clean = ${HELPER};\n  const handleUpdate = ${HANDLER_REFORMATTED};\n  return null;\n}`, HELPER, HANDLER_REFORMATTED]);
  const handlerId = left.functions[1].id; const expected = right.functions[2].id;
  const result = remapFunctionId(left, right, handlerId);
  assert.equal(result.status, 'mapped'); assert.equal(result.basis, 'text_match'); assert.equal(result.mapped_id, expected);
  assert.equal(result.ordinal, 2, 'the handler moved from pre-order position 1 to 2');
  // Without text hashes, the ordinal rule cannot help (3 vs 2 functions) and the name decides.
  const strip = manifest => ({ ...manifest, functions: manifest.functions.map(({ text_sha256, ...row }) => row) });
  assert.equal(remapFunctionId(strip(left), strip(right), handlerId).basis, 'name_match');
  // Through compare_chains: source_revision by text_match, path unchanged.
  const store = createStore({ records: [
    ...submitRows({ actionId: 'action:t:1', page: 'q1', build: 'b-1', run: 'r1', functionId: handlerId }).rows,
    ...submitRows({ actionId: 'action:t:2', page: 'q2', build: 'b-2', run: 'r2', functionId: expected }).rows,
  ], manifests: new Map([['b-1', left], ['b-2', right]]), now: () => clock + 60_000 });
  const compared = callTool(store, 'compare_chains', { before_action_id: 'action:t:1', after_action_id: 'action:t:2' });
  const entry = compared.stops.find(stop => stop.stop === 'entry_handler');
  assert.equal(entry.change_kind, 'source_revision'); assert.equal(entry.change_basis, 'text_match'); assert.equal(compared.path_changed, false);
});

test('name_match: a renamed local (text differs) plus a function added above maps by a unique name; several same-named functions abstain (h8)', () => {
  const after = `export default function Settings() {\n  const clean = ${HELPER};\n  const handleUpdate = ${HANDLER_RENAMED};\n  return null;\n}\n`;
  const left = realManifest('b-1', SRC, before, beforeFns);
  const right = realManifest('b-3', SRC, after, [`function Settings() {\n  const clean = ${HELPER};\n  const handleUpdate = ${HANDLER_RENAMED};\n  return null;\n}`, HELPER, HANDLER_RENAMED]);
  const result = remapFunctionId(left, right, left.functions[1].id);
  assert.equal(result.basis, 'name_match'); assert.equal(result.mapped_id, right.functions[2].id);
  assert.deepEqual(result.tried, ['text_match: no function with the same normalised text']);
  // h8: two functions named onClick in the other build. Never pick by offset (even though one is nearer):
  // unmapped with the candidate count, unless exactly one of them also matches the normalised text.
  const two = { functions: [
    { id: 'function:x:0:10', kind: 'function', source: { file: SRC, start: 0, end: 10 }, name: 'onClick', text_sha256: 'a' },
    { id: 'function:x:200:210', kind: 'function', source: { file: SRC, start: 200, end: 210 }, name: 'onClick', text_sha256: 'b' },
  ] };
  const from = { functions: [{ id: 'function:y:190:199', kind: 'function', source: { file: SRC, start: 190, end: 199 }, name: 'onClick', text_sha256: 'c' }] };
  const h8 = remapFunctionId(from, two, 'function:y:190:199');
  assert.equal(h8.status, 'unmapped'); assert.equal(h8.basis, 'unmapped'); assert.equal(h8.candidates, 2);
  assert.equal(h8.reason, '2 functions named onClick in file; no unique match');
  // Text disambiguates only when exactly one same-named candidate matches it (the file has another identical-text function under another name).
  const withText = { functions: [...two.functions, { id: 'function:x:300:310', kind: 'function', source: { file: SRC, start: 300, end: 310 }, name: 'other', text_sha256: 'b' }] };
  const fromText = { functions: [{ ...from.functions[0], text_sha256: 'b' }] };
  const picked = remapFunctionId(fromText, withText, 'function:y:190:199');
  assert.equal(picked.basis, 'text_match'); assert.equal(picked.mapped_id, 'function:x:200:210');
  const bothText = { functions: [{ ...two.functions[0], text_sha256: 'b' }, two.functions[1]] };
  assert.equal(remapFunctionId(fromText, bothText, 'function:y:190:199').candidates, 2, 'two same-named candidates with the same text: still unmapped');
  // Through compare_chains, a multi-candidate name is unmapped_revision (a path change).
  const leftH8 = { functions: [{ ...from.functions[0], id: fid(H('e'), 190, 199), source: { file: SRC, start: 190, end: 199 } }] };
  const rightH8 = { functions: [{ ...two.functions[0], id: fid(H('f'), 0, 10) }, { ...two.functions[1], id: fid(H('f'), 200, 210) }] };
  const h8Store = createStore({ records: [
    ...submitRows({ actionId: 'action:h8:1', page: 'q5', build: 'b-h8a', run: 'r5', functionId: leftH8.functions[0].id }).rows,
    ...submitRows({ actionId: 'action:h8:2', page: 'q6', build: 'b-h8b', run: 'r6', functionId: rightH8.functions[1].id }).rows,
  ], manifests: new Map([['b-h8a', leftH8], ['b-h8b', rightH8]]), now: () => clock + 60_000 });
  const h8Result = callTool(h8Store, 'compare_chains', { before_action_id: 'action:h8:1', after_action_id: 'action:h8:2' });
  const h8Entry = h8Result.stops.find(stop => stop.stop === 'entry_handler');
  assert.equal(h8Entry.change_kind, 'unmapped_revision'); assert.equal(h8Entry.change_basis, 'unmapped'); assert.equal(h8Entry.remap.candidates, 2);
  assert.equal(h8Result.path_changed, true);
  // A rebinding to the added helper is still a different handler under name_match.
  const store = createStore({ records: [
    ...submitRows({ actionId: 'action:n:1', page: 'q3', build: 'b-1', run: 'r1', functionId: left.functions[1].id }).rows,
    ...submitRows({ actionId: 'action:n:2', page: 'q4', build: 'b-3', run: 'r3', functionId: right.functions[1].id }).rows,
  ], manifests: new Map([['b-1', left], ['b-3', right]]), now: () => clock + 60_000 });
  const entry = callTool(store, 'compare_chains', { before_action_id: 'action:n:1', after_action_id: 'action:n:2' }).stops.find(stop => stop.stop === 'entry_handler');
  assert.equal(entry.change_kind, 'different_handler'); assert.equal(entry.change_basis, 'name_match');
});

test('an entered function missing from its build manifest is reported unmapped, never replaced by the next registered function (doctored manifest)', () => {
  // The submit enters handleUpdate (b2.update), which calls a registered helper (b2.remove). Build b-two's manifest is doctored to drop handleUpdate.
  const doctored = new Map(manifests); doctored.set('b-two', { ...manifests.get('b-two'), functions: manifests.get('b-two').functions.filter(row => row.id !== b2.update) });
  const make = (actionId, page, build, run, entryId) => {
    const { rows } = submitRows({ actionId, page, build, run, functionId: entryId });
    const request = rows.find(row => row.kind === 'network.request');
    const inner = `continuation:${actionId}:function:3`;
    // A registered helper entered inside the handler owns the request (a neighbour the old code credited).
    rows.splice(rows.indexOf(request), 0, { ...request, sequence: 2.5, kind: 'function.enter', function_id: b2.remove, invoked_by: 'event', entry_hint: false, continuation_kind: 'function',
      parent_continuation_id: `continuation:${actionId}:function:2`, continuation_id: inner, method: undefined, url: undefined });
    Object.assign(request, { parent_continuation_id: inner, terminal_owner_continuation_id: inner });
    return rows;
  };
  const records = [...make('action:a:1', 'p1', 'b-one', 'r1', b1.update), ...make('action:m:1', 'p2', 'b-two', 'r2', b2.update)];
  const doctoredStore = createStore({ records, manifests: doctored, now: () => clock + 60_000 });
  const chain = callTool(doctoredStore, 'action_chain', { action_id: 'action:m:1' });
  const entry = chain.stops.find(stop => stop.stop === 'entry_handler');
  assert.equal(entry.function_id, b2.update, 'the entered function, not a registered neighbour');
  assert.equal(entry.resolution, 'unmapped'); assert.equal(entry.status, 'not_found'); assert.equal(entry.build, 'b-two');
  assert.match(chain.summary, new RegExp(`not_found: entry handler ${b2.update} is not in build b-two's manifest`));
  assert.ok(!chain.stops.some(stop => stop.function_id === b2.remove), 'no neighbour credited');
  assert.equal(doctoredStore.elementIndex.entries.has(`handler:${b2.remove}|submit`), false, 'the element index does not place the action under the neighbour');
  // The same function registered in another build's manifest: stale_build.
  const elsewhere = new Map(doctored); elsewhere.set('b-one', { ...manifests.get('b-one'), functions: [...manifests.get('b-one').functions, { ...manifests.get('b-two').functions[1] }] });
  const stale = callTool(createStore({ records, manifests: elsewhere, now: () => clock + 60_000 }), 'action_chain', { action_id: 'action:m:1' }).stops.find(stop => stop.stop === 'entry_handler');
  assert.equal(stale.status, 'stale_build'); assert.deepEqual(stale.found_in_builds, ['b-one']);
  // compare_chains: the after build's manifest lacks the handler, so the remap abstains → unmapped_revision, a path change.
  const compared = callTool(doctoredStore, 'compare_chains', { before_action_id: 'action:a:1', after_action_id: 'action:m:1' });
  const stop = compared.stops.find(value => value.stop === 'entry_handler');
  assert.equal(stop.after.resolution, 'unmapped'); assert.equal(stop.change_kind, 'unmapped_revision');
  assert.equal(compared.path_changed, true);
  // Undoctored: the handler itself is credited.
  const clean = callTool(createStore({ records, manifests, now: () => clock + 60_000 }), 'action_chain', { action_id: 'action:m:1' }).stops.find(value => value.stop === 'entry_handler');
  assert.equal(clean.function_id, b2.update); assert.equal(clean.resolution, undefined);
});
