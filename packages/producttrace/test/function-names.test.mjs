// Build-time function names (integrations/function-names.mjs) and their
// readers: the naming rules on a TypeScript and a plain-JS module, the store
// writer never overwriting a build-time name, the remap comparing build-time
// display names, and error types resolved through the manifest.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildNameIndex, classAt } from '../integrations/function-names.mjs';
import { enrichManifest } from '../collector/store-writer.mjs';
import { createStore, remapFunctionId } from '../collector/store.mjs';
import { errorTypeOf } from '../analysis/causal-chain.mjs';

const at = (content, marker) => { const start = content.indexOf(marker); assert.ok(start >= 0, marker); return start; };
const named = (file, content) => {
  const index = buildNameIndex(file, content);
  return marker => { const start = at(content, marker); const hit = [...index.functions].find(([key]) => Number(key.split(':')[0]) === start); assert.ok(hit, `no function at ${marker}`); return hit[1]; };
};

const TS = `import { create } from 'zustand';
export function load(id: string): string { return id; }
export default function (rows: number[]) { return rows.length; }
function helper() { return 1; }
export { helper as tool };
function run(onDone: () => void, ...rest: Array<() => void>) { onDone(); }
run(() => 1, () => 2);
list.filter((row) => row.ok);
export const useStore = create<S>()((set) => ({ nested: { add: (x: number) => set({}) }, reset() { set({}); }, [key]: () => 0, 'quoted-key': () => 1 }));
export class Client { static make() {} get url() { return ''; } set url(v: string) {} constructor() {} async get(path: string) { return path; } handle = (e: Event) => {}; #secret() {} }
export default class {}
const Row = memo(function Row() { return null; });
const Field = memo(forwardRef((props, ref) => null));
const save = useCallback(async () => {}, []);
const m = useMutation({ mutationFn: async function saveIt() {}, onError: () => {} });
const el = <button onClick={() => 1} />;
const pick = flag ? () => 1 : () => 2;
const items = [() => 1];
let later; later = () => 2;
api.routes.home = () => 3;
function withDefault(cb = () => 0, { onMissing = () => 1 } = {}) {}
const typed = ((x: number) => x) as (x: number) => number;
class HttpError extends Error {}
`;

test('TypeScript: every rule names what the source names, and abstains otherwise', () => {
  const name = named('src/mod.tsx', TS);
  const expect = (marker, fields) => { const got = name(marker); for (const [key, value] of Object.entries(fields)) assert.deepEqual(got[key], value, `${marker} ${key}: ${JSON.stringify(got)}`); };
  expect('export function load', { name: 'load', name_kind: 'declaration', display_name: 'load' });
  expect('export default function (rows', { name: 'default', name_kind: 'export_alias', display_name: 'default (mod.tsx)' });
  expect('function helper', { name: 'helper', name_kind: 'declaration', export_names: ['tool'], display_name: 'helper (exported as tool)' });
  expect('() => 1, () => 2', { name: 'onDone', name_kind: 'callback', display_name: 'onDone (callback of run)' });
  expect('() => 2);', { name: null, name_kind: 'callback', display_name: '<callback of run>' }); // rest parameter: no single name
  expect('(row) => row.ok', { name: null, name_kind: 'callback', display_name: '<callback of list.filter>' });
  expect('(set) => ({', { name: null, name_kind: 'inferred', via: 'create()', bound_to: 'useStore', display_name: 'useStore = create()(<callback>)' });
  expect('(x: number) => set', { name: 'add', name_kind: 'property', display_name: 'useStore.nested.add' });
  expect('reset() {', { name: 'reset', name_kind: 'property', display_name: 'useStore.reset' });
  expect('() => 0, \'quoted', { name: null, name_kind: 'anonymous', display_name: '<computed key>' });
  expect('() => 1 }));', { name: 'quoted-key', name_kind: 'property', display_name: 'useStore.quoted-key' });
  expect('static make()', { name: 'make', name_kind: 'method', display_name: 'Client.make', static: true });
  expect('get url()', { name: 'url', name_kind: 'method', display_name: 'Client.url (getter)', accessor: 'get' });
  expect('set url(v', { name: 'url', name_kind: 'method', display_name: 'Client.url (setter)', accessor: 'set' });
  expect('constructor() {}', { name: 'constructor', name_kind: 'method', display_name: 'Client.constructor' });
  expect('async get(path', { name: 'get', name_kind: 'method', display_name: 'Client.get' });
  expect('(e: Event) => {}', { name: 'handle', name_kind: 'property', display_name: 'Client.handle' });
  expect('#secret() {}', { name: '#secret', name_kind: 'method', display_name: 'Client.#secret' });
  expect('function Row()', { name: 'Row', name_kind: 'declaration' });
  expect('(props, ref) => null', { name: null, name_kind: 'inferred', via: 'memo(forwardRef)', bound_to: 'Field', display_name: 'Field = memo(forwardRef(<callback>))' });
  expect('async () => {}, []', { name: null, name_kind: 'inferred', bound_to: 'save', display_name: 'save = useCallback(<callback>)' });
  expect('async function saveIt()', { name: 'saveIt', name_kind: 'declaration' });
  expect('() => {} });', { name: 'onError', name_kind: 'property', display_name: 'useMutation({ onError })' });
  expect('() => 1} />', { name: null, name_kind: 'anonymous', display_name: '<button onClick>' });
  expect('() => 1 : () => 2', { name: null, name_kind: 'anonymous' });
  expect('() => 1];', { name: null, name_kind: 'anonymous' });
  expect('() => 2;\napi', { name: 'later', name_kind: 'binding' });
  expect('() => 3;', { name: 'home', name_kind: 'property', display_name: 'api.routes.home' });
  expect('() => 0, {', { name: 'cb', name_kind: 'binding' });
  expect('() => 1 } = {}', { name: 'onMissing', name_kind: 'binding' });
  expect('(x: number) => x)', { name: 'typed', name_kind: 'binding' });
  const classes = buildNameIndex('src/mod.tsx', TS).classes.map(row => [row.name, row.name_kind, row.extends]);
  assert.deepEqual(classes, [['Client', 'declaration', null], ['default', 'export_alias', null], ['HttpError', 'declaration', 'Error']]);
  // A generated `class` token maps onto the original between the class's start and its name.
  assert.equal(classAt('src/mod.tsx', TS, at(TS, 'class HttpError'))?.name, 'HttpError');
  assert.equal(classAt('src/mod.tsx', TS, at(TS, 'static make')), null, 'a position past the name is not the class head (abstain)');
});

test('callback by callee parameter: only a unique function binding whose scope encloses the call (grade 2026-09-24, P24-P27)', () => {
  const SRC = `import { runLater } from './lib';
function unrelated() { function runLater(misnamed: () => void) { misnamed(); } return runLater; }
export function probe() { runLater(() => 'imported'); }
const { schedule } = api;
function other() { function schedule(wrongParam: () => void) { wrongParam(); } return schedule; }
export function probe2() { schedule(() => 1); }
function Editor() { const { update } = useStore(); update(() => ({ saved: true })); }
function Preview() { const update = (patch: unknown) => patch; return update; }
function List({ setItems }: Props) { setItems((prev: number[]) => prev); }
function Other() { function setItems(nextList: number[]) { return nextList; } return setItems; }
function outer() { function local(cb: () => void) { cb(); } local(() => 'scoped'); }
local(() => 'outside');
function solo(done: () => void) { done(); }
solo(() => 'named');
`;
  const name = named('src/probe.ts', SRC);
  for (const [marker, display] of [["() => 'imported'", '<callback of runLater>'], ['() => 1)', '<callback of schedule>'], ['() => ({ saved', '<callback of update>'],
    ['(prev: number[]) => prev', '<callback of setItems>'], ["() => 'outside'", '<callback of local>']]) {
    const row = name(marker);
    assert.deepEqual([row.name, row.name_kind, row.display_name], [null, 'callback', display], marker);
  }
  assert.deepEqual([name("() => 'scoped'").name, name("() => 'named'").name], ['cb', 'done']);
});

test('plain JavaScript: the same rules on a .jsx module', () => {
  const JS = `export function badge(n) { return n; }\nexport const handlers = { onPing: () => 1, describe() { return 'x'; } };\nexport class Tally { bump() { return 1; } }\nmodule.exports.legacy = function () {};\n`;
  const name = named('src/w.jsx', JS);
  assert.deepEqual([name('export function badge'), name('() => 1'), name('describe()'), name('bump()'), name('function () {}')].map(row => [row.name, row.name_kind, row.display_name]), [
    ['badge', 'declaration', 'badge'], ['onPing', 'property', 'handlers.onPing'], ['describe', 'property', 'handlers.describe'], ['bump', 'method', 'Tally.bump'], ['legacy', 'property', 'module.exports.legacy']]);
});

const fid = (content, snippet) => { const start = at(content, snippet); return `function:${createHash('sha256').update(content).digest('hex')}:${start}:${start + snippet.length}`; };

test('store writer: a build-time name is never overwritten by the text rule; old rows are still enriched', () => {
  const content = 'const x = { a: 1, run: () => 2 };\n';
  const id = fid(content, '() => 2');
  const built = { id, source: { file: 'f.js', start: at(content, '() => 2'), end: at(content, '() => 2') + 7 }, name: 'run', name_kind: 'property', display_name: 'x.run' };
  const old = { id, source: built.source };
  const out = enrichManifest({ functions: [built, old] }, () => content).functions;
  assert.equal(out[0].name, 'run'); assert.equal(out[0].display_name, 'x.run'); assert.ok(out[0].text_sha256);
  assert.equal(out[1].name, 'run'); assert.ok(!('name_kind' in out[1]));
});

test('reader: manifest names print as recorded; old text-rule names are inferred_from_source_text; abstentions keep their position', () => {
  const content = 'class A { get() {} }\nlist.map(() => 1);\nconst h = () => 2;\n';
  const rows = [
    { id: fid(content, 'get() {}'), source: { file: 'a.ts', start: at(content, 'get() {}'), end: at(content, 'get() {}') + 8 }, name: 'get', name_kind: 'method', display_name: 'A.get' },
    { id: fid(content, '() => 1'), source: { file: 'a.ts', start: at(content, '() => 1'), end: at(content, '() => 1') + 7 }, name: null, name_kind: 'callback', display_name: '<callback of list.map>' },
    { id: fid(content, '() => 2'), source: { file: 'a.ts', start: at(content, '() => 2'), end: at(content, '() => 2') + 7 }, name: 'h' },
  ];
  const store = createStore({ records: [], manifest: { functions: rows } });
  const [method, callback, legacy] = rows.map(row => store.functionInfo(row.id));
  assert.deepEqual([method.name, method.name_status, method.label], ['get', 'manifest', 'A.get a.ts@10-18']);
  assert.deepEqual([callback.name, callback.name_status, callback.label.split(' a.ts')[0]], [null, 'anonymous', '<callback of list.map>']);
  assert.deepEqual([legacy.name, legacy.name_status, legacy.name_basis], ['h', 'inferred_from_source_text', 'store_writer_text_rule']);
});

test('remap: build-time manifests compare display names (a method qualified by its class); inferred names are never compared', () => {
  const file = 'src/api.ts';
  const row = (id, start, fields) => ({ id: `function:${id.repeat(64)}:${start}:${start + 5}`, kind: 'function', source: { file, start, end: start + 5 }, ...fields });
  const before = { functions: [row('a', 0, { name: 'get', name_kind: 'method', display_name: 'Client.get' }), row('a', 10, { name: 'get', name_kind: 'method', display_name: 'Server.get' }),
    row('a', 20, { name: 'save', name_kind: 'inferred', display_name: 'save = useCallback(<callback>)' })] };
  const after = { functions: [row('b', 0, { name: 'helper', name_kind: 'declaration', display_name: 'helper' }), row('b', 30, { name: 'get', name_kind: 'method', display_name: 'Server.get' }),
    row('b', 40, { name: 'get', name_kind: 'method', display_name: 'Client.get' }), row('b', 50, { name: 'save', name_kind: 'inferred', display_name: 'save = useCallback(<callback>)' })] };
  const mapped = remapFunctionId(before, after, before.functions[0].id);
  assert.equal(mapped.basis, 'name_match'); assert.equal(mapped.mapped_id, after.functions[2].id, 'Client.get, not the first `get`');
  const inferred = remapFunctionId(before, after, before.functions[2].id);
  assert.notEqual(inferred.basis, 'name_match');
  assert.match(inferred.tried.join('; '), /no name in the manifest/u);
});

test('remap: adding or removing an export does not change a function\'s name (grade 2026-09-24)', () => {
  const content = { A: 'function handleUpdate(data) { return data + 1; }\nfunction other() { return 2; }\n',
    B: 'function handleUpdate(payload) { return payload + 1; }\nfunction other() { return 3; }\nfunction third() {}\nexport default handleUpdate;\n' };
  const manifest = file => ({ functions: [...buildNameIndex('src/a.ts', content[file]).functions].map(([key, fields]) => {
    const [start, end] = key.split(':').map(Number);
    return { id: `function:${createHash('sha256').update(content[file]).digest('hex')}:${start}:${end}`, kind: 'function', source: { file: 'src/a.ts', start, end }, ...fields };
  }) });
  const [a, b] = [manifest('A'), manifest('B')];
  const target = b.functions.find(row => row.name === 'handleUpdate');
  assert.equal(target.display_name, 'handleUpdate (exported as default)');
  for (const [from, to] of [[a, b], [b, a]]) {
    const id = from.functions.find(row => row.name === 'handleUpdate').id;
    const result = remapFunctionId(from, to, id);
    assert.equal(result.basis, 'name_match', JSON.stringify(result));
    assert.equal(result.mapped_id, to.functions.find(row => row.name === 'handleUpdate').id);
  }
});

test('error types: the source name comes from the manifest class id or the platform builtin, never from the runtime name', () => {
  const names = id => (id === 'function:c:1:2' ? 'ApiError' : null);
  assert.deepEqual(errorTypeOf({ error_type: 'Nf', error_class_id: 'function:c:1:2' }, names), { minified: 'Nf', source: 'ApiError', source_basis: 'manifest' });
  assert.deepEqual(errorTypeOf({ error_type: 'TypeError', error_builtin: true }, names), { minified: 'TypeError', source: 'TypeError', source_basis: 'builtin' });
  assert.deepEqual(errorTypeOf({ error_type: 'Nf' }, names), { minified: 'Nf', source: null, source_basis: 'not_recorded' });
  assert.deepEqual(errorTypeOf({ error_type: 'Nf', error_class_id: 'function:x:1:2' }, names), { minified: 'Nf', source: null, source_basis: 'class_not_in_manifest' });
});
