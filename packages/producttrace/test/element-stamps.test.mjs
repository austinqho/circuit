import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { instrumentPostTransformedSource } from '../integrations/runtime-attribution.mjs';
import { indexElementStamps, resolveElement } from '../analysis/element-index.mjs';
import { fakeElement, loadBrowserRuntime } from './helpers/browser-runtime-vm.mjs';
import { BUTTON, KEYED_ROW, PLAIN_ROW, runRootsAndIndexScenario, runStableKeysScenario } from './helpers/stable-keys-scenario.mjs';

const plain = value => JSON.parse(JSON.stringify(value));

test('OAI metadata validator implements handoff §4.3 exactly', () => {
  const { runtime, evaluate } = loadBrowserRuntime();
  const check = expression => plain(evaluate(`globalThis.__productTraceRuntime.validateAnnotationMetadata(${expression})`));
  assert.deepEqual(check(`{ tracer_el: 'p_0123456789ab:1-2#n1', tracer_build: null, tracer_session: 's_1', component: 'Save', source: 'a.tsx:1', tracer_last_action: null }`), { ok: true, errors: [] });
  assert.equal(check(`{ 'key with space': 1, 'dash-key': true, Key_2: 2.5 }`).ok, true);
  assert.equal(check(`{ a: 1, b: 1, c: 1, d: 1, e: 1, f: 1, g: 1 }`).ok, false);
  for (const bad of [`{ '1a': 1 }`, `{ 'a  b': 1 }`, `{ 'a ': 1 }`, `{ 'a.b': 1 }`, `{ '': 1 }`]) assert.equal(check(bad).ok, false, bad);
  assert.ok(check(`JSON.parse('{"__proto__": 1}')`).errors.includes('reserved_key'));
  assert.ok(check(`{ constructor: 1 }`).errors.includes('reserved_key'));
  assert.ok(check(`{ prototype: 1 }`).errors.includes('reserved_key'));
  assert.ok(check(`{ ['k'.repeat(65)]: 1 }`).errors.includes('key_too_long'));
  assert.equal(check(`{ ['k'.repeat(64)]: 1 }`).ok, true);
  assert.equal(check(`{ s: 'x'.repeat(256) }`).ok, true);
  assert.equal(check(`{ s: 'x'.repeat(257) }`).ok, false);
  assert.equal(check(`{ s: 'tab\\there' }`).ok, false, 'control character');
  assert.equal(check(`{ s: 'zero\\u200bwidth' }`).ok, false, 'format character');
  assert.equal(check(`{ s: 'lone\\ud800' }`).ok, false, 'lone surrogate');
  assert.equal(check(`{ s: 'pair\\ud83d\\ude00' }`).ok, true, 'a paired surrogate is a valid code point');
  assert.equal(check(`{ s: 'line\\u2028sep' }`).ok, false);
  assert.equal(check(`{ n: NaN }`).ok, false);
  assert.equal(check(`{ n: Infinity }`).ok, false);
  assert.equal(check(`{ nested: { a: 1 } }`).ok, false);
  assert.equal(check(`{ list: [1] }`).ok, false);
  assert.equal(check(`{ u: undefined }`).ok, false);
  assert.equal(check(`[1, 2]`).ok, false);
  assert.equal(check(`new (class Meta { constructor() { this.a = 1; } })()`).ok, false);
  assert.equal(check(`Object.defineProperty({}, 'a', { get() { return 1; }, enumerable: true })`).ok, false);
  assert.equal(check(`{ [Symbol('s')]: 1 }`).ok, false);
  assert.equal(check(`Object.assign(Object.create(null), { a: 1 })`).ok, true);
  // 2048 UTF-8 bytes: six 256-unit strings of a 2-byte character exceed it.
  assert.ok(check(`{ a: 'é'.repeat(256), b: 'é'.repeat(256), c: 'é'.repeat(256), d: 'é'.repeat(256), e: 'x' }`).errors.includes('too_large'));
  assert.equal(runtime.validateAnnotationLabel('SaveButton (Form.tsx:88)'), true);
  assert.equal(runtime.validateAnnotationLabel('   '), false);
  assert.equal(runtime.validateAnnotationLabel('x'.repeat(129)), false);
});

function transpile(repository, file, source) {
  const absolute = path.join(repository, file);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, source);
  const output = ts.transpileModule(source, { fileName: absolute, compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, sourceMap: true, inlineSources: true } });
  const map = JSON.parse(output.sourceMapText);
  map.sources = [absolute];
  return { code: output.outputText.replace(/\/\/# sourceMappingURL=.*$/mu, ''), map, absolute };
}

test('JSX element-factory calls are wrapped with their exact original placement and stay identity-preserving', () => {
  const repository = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'producttrace-placements-')));
  try {
    const source = `export function Save({ onSave }) {\n  return <button type="button" onClick={onSave}>Save</button>;\n}\nexport const Page = () => (<section>{[1, 2].map(n => <Save key={n} onSave={() => n} />)}<></></section>);\n`;
    const { code, map, absolute } = transpile(repository, 'src/Page.tsx', source);
    const rows = [];
    const result = instrumentPostTransformedSource(code, absolute, { repository, map, indexForId: id => id, indexForPlacement: placement => { rows.push(placement); return rows.length - 1; } });
    assert.deepEqual(rows.map(row => [row.tag, row.line, row.component, source.slice(row.start, row.start + 1 + row.tag.length)]),
      [['button', 2, 'Save', '<button'], ['section', 4, 'Page', '<section'], ['Save', 4, 'Save', '<Save']]);
    for (const row of rows) {
      assert.match(row.id, /^placement:[0-9a-f]{64}:\d+:\d+$/u);
      assert.equal(source.slice(row.start, row.end).endsWith('>'), true);
    }
    assert.equal((result.code.match(/__productTracePlace\|\|__ptIdentity/gu) || []).length, 3, 'fragments are not placements');
    // Span neutrality: the same function ids with and without placement/await edits.
    const plainRun = instrumentPostTransformedSource(code, absolute, { repository, map, indexForId: id => id });
    assert.deepEqual(result.manifest.map(row => row.id), plainRun.manifest.map(row => row.id));
    // With the runtime absent, the identity fallback returns the same element.
    const element = { type: 'button', props: {} };
    assert.equal(vm.runInNewContext('function __ptIdentity(v){return v}; (globalThis.__productTracePlace||__ptIdentity)(element, 0)', { element }), element);
  } finally { fs.rmSync(repository, { recursive: true, force: true }); }
});

// Minimal committed fiber tree: App > [Save (component) > button], [div(handler) > span], [ul > li x2 keyed]
function fiberTree(runtime, context, handlers) {
  const fiber = (tag, extra = {}) => ({ tag, key: null, child: null, sibling: null, return: null, alternate: null, memoizedProps: {}, ...extra });
  const link = (parent, children) => { parent.child = children[0] || null; children.forEach((child, i) => { child.return = parent; child.sibling = children[i + 1] || null; }); return parent; };
  const place = (props, index) => { context.__productTracePlace({ props }, index); return props; };
  const main = fakeElement('main');
  const button = fakeElement('button', { type: 'button' }, main);
  const div = fakeElement('div', {}, main);
  const span = fakeElement('span', {}, div);
  const ul = fakeElement('ul', {}, main);
  const li1 = fakeElement('li', {}, ul), li2 = fakeElement('li', {}, ul);
  const buttonFiber = fiber(5, { stateNode: button, memoizedProps: place({ onClick: handlers.save }, 0) });
  const saveFiber = link(fiber(0, { memoizedProps: place({ onSave: handlers.save }, 1) }), [buttonFiber]);
  const spanFiber = fiber(5, { stateNode: span, memoizedProps: {} });
  const divFiber = link(fiber(5, { stateNode: div, memoizedProps: place({ onClick: handlers.open }, 2) }), [spanFiber]);
  const liFibers = [li1, li2].map((node, i) => fiber(5, { stateNode: node, key: ['a1', 'b 2'][i], memoizedProps: place({ onClick: handlers.open }, 3) }));
  const ulFiber = link(fiber(5, { stateNode: ul, memoizedProps: {} }), liFibers);
  const mainFiber = link(fiber(5, { stateNode: main, memoizedProps: {} }), [saveFiber, divFiber, ulFiber]);
  const appFiber = link(fiber(0, { memoizedProps: {} }), [mainFiber]);
  const rootFiber = link(fiber(3), [appFiber]);
  return { root: { current: rootFiber }, nodes: { main, button, div, span, ul, li1, li2 } };
}

function stampRun({ oai = false, stamps = true } = {}) {
  const loaded = loadBrowserRuntime({ extraGlobals: stamps ? {} : { __PRODUCTTRACE_STAMPS__: false } });
  const { runtime, context, evaluate, dispatch } = loaded;
  if (oai) context.document.oai = { annotation: { request() { return { accepted: false }; } } };
  runtime.registerManifest([{ index: 0, id: 'function:aa:1:2' }, { index: 1, id: 'function:bb:3:4' }]);
  evaluate(`globalThis.__save = globalThis.__productTraceRuntime.tag(function save() {}, 0); globalThis.__open = globalThis.__productTraceRuntime.tag(function open() {}, 1);`);
  runtime.registerBuild('b0123456789a');
  runtime.registerPlacements([
    { index: 0, id: 'placement:' + 'c'.repeat(64) + ':10:60', key: 'p_cccccccccccc:10-60', file: 'src/Save.tsx', line: 2, tag: 'button', component: 'Save' },
    { index: 1, id: 'placement:' + 'd'.repeat(64) + ':5:40', key: 'p_dddddddddddd:5-40', file: 'src/Form.tsx', line: 88, start: 5, end: 40, tag: 'Save', component: 'Save' },
    { index: 2, id: 'placement:' + 'd'.repeat(64) + ':50:90', key: 'p_dddddddddddd:50-90', file: 'src/Form.tsx', line: 90, tag: 'div', component: 'Form' },
    { index: 3, id: 'placement:' + 'd'.repeat(64) + ':95:120', key: 'p_dddddddddddd:95-120', file: 'src/Form.tsx', line: 92, tag: 'li', component: 'Form' },
  ]);
  const tree = fiberTree(runtime, context, { save: context.__save, open: context.__open });
  context.__REACT_DEVTOOLS_GLOBAL_HOOK__.onCommitFiberRoot(1, tree.root);
  // A second commit with unchanged props must not emit duplicate rows.
  context.__REACT_DEVTOOLS_GLOBAL_HOOK__.onCommitFiberRoot(1, tree.root);
  dispatch('click', tree.nodes.button);
  dispatch('click', tree.nodes.span);
  return { ...loaded, tree };
}

test('commit stamping: placement choice, element keys, stamp rows on their own counter', () => {
  const { runtime, tree } = stampRun();
  const { button, div, span, li1, li2, main, ul } = tree.nodes;
  // The button's own JSX site wins; the <Save onSave> placement in Form.tsx is the binding site.
  assert.equal(button.getAttribute('data-tracer-el'), 'p_cccccccccccc:10-60#n1');
  assert.equal(div.getAttribute('data-tracer-el'), 'p_dddddddddddd:50-90#n1');
  assert.equal(li1.getAttribute('data-tracer-el'), 'p_dddddddddddd:95-120@a1');
  assert.equal(li2.getAttribute('data-tracer-el'), 'p_dddddddddddd:95-120@b%202', 'React key is percent-escaped');
  assert.equal(span.getAttribute('data-tracer-el'), null, 'no handler, not interactive, not a component host');
  assert.equal(main.getAttribute('data-tracer-el'), null);
  assert.equal(ul.getAttribute('data-tracer-el'), null);
  const records = plain(runtime.records);
  const stamps = records.filter(row => row.kind === 'element.stamp');
  assert.equal(stamps.length, 4);
  assert.deepEqual(stamps.map(row => row.stamp_sequence), [1, 2, 3, 4]);
  assert.ok(stamps.every(row => row.sequence === undefined && row.annotation === 'absent' && row.build === 'b0123456789a'));
  const save = stamps.find(row => row.element_key === 'p_cccccccccccc:10-60#n1');
  assert.deepEqual([save.file, save.line, save.url, save.component, save.host_tag, save.placement_via], ['src/Save.tsx', 2, null, 'Save', 'button', 'self']);
  assert.deepEqual([save.binding_placement.file, save.binding_placement.line], ['src/Form.tsx', 88]);
  assert.ok(stamps.every(row => /^[\x21-\x7e]{1,256}$/u.test(row.element_key)));
  assert.deepEqual(save.handlers.map(row => [row.event, row.function_id]).sort(), [['click', 'function:aa:1:2'], ['save', 'function:aa:1:2']]);
  const actions = records.filter(row => row.kind === 'dom.action');
  assert.equal(actions[0].target.element_key, 'p_cccccccccccc:10-60#n1');
  assert.equal(actions[1].target.element_key, 'p_dddddddddddd:50-90#n1', 'target climbs to the stamped ancestor');
  // capture.page is sequence 1; the two actions follow it with no gap.
  assert.deepEqual(actions.map(row => row.sequence), [2, 3], 'stamp rows never consume the attribution sequence');
  const sequenced = records.filter(row => row.kind !== 'element.stamp').map(row => row.sequence);
  assert.deepEqual(sequenced, sequenced.map((_, index) => index + 1), 'attribution rows are contiguous');
  const index = indexElementStamps(records);
  assert.deepEqual(resolveElement(index, { element_key: 'p_cccccccccccc:10-60#n1' }).source, { file: 'src/Save.tsx', line: 2 });
  assert.equal(resolveElement(index, { element_key: 'p_cccccccccccc:10-60#n9' }).status, 'not_found');
  assert.equal(resolveElement(index, { element_key: 'p_cccccccccccc:10-60#n1', build: 'other' }).status, 'stale_build');
  assert.equal(resolveElement(index, { element_key: '<script>' }).status, 'invalid');
});

test('OAI attributes only with document.oai.annotation (stub), validated, with the live last action', () => {
  const without = stampRun();
  assert.equal(without.tree.nodes.button.getAttribute('oai-annotatable'), null);
  assert.equal(without.tree.nodes.button.getAttribute('oai-annotation-metadata'), null);
  const withOai = stampRun({ oai: true });
  const { button } = withOai.tree.nodes;
  assert.equal(button.getAttribute('oai-annotatable'), 'Save (Save.tsx:2)');
  const metadata = JSON.parse(button.getAttribute('oai-annotation-metadata'));
  const action = plain(withOai.runtime.records).find(row => row.kind === 'dom.action');
  assert.deepEqual(metadata, { tracer_el: 'p_cccccccccccc:10-60#n1', tracer_build: 'b0123456789a', tracer_session: withOai.runtime.session,
    component: 'Save', source: 'src/Save.tsx:2', tracer_last_action: action.action_id });
  assert.equal(withOai.evaluate(`globalThis.__productTraceRuntime.validateAnnotationMetadata(${JSON.stringify(metadata)}).ok`), true);
  assert.ok(plain(withOai.runtime.records).filter(row => row.kind === 'element.stamp').every(row => row.annotation === 'written'));
});

test('stamps off: identical attribution rows, no stamp rows, no attributes', () => {
  const on = stampRun(), off = stampRun({ stamps: false });
  const strip = records => plain(records).filter(row => row.kind !== 'element.stamp').map(row => {
    if (row.target) for (const field of ['element_key', 'key_kind', 'instances', 'stamp_sequence']) delete row.target[field];
    const { timestamp, action_id, continuation_id, parent_continuation_id, spine, page_id, ...rest } = row;
    return rest;
  });
  assert.deepEqual(strip(on.runtime.records), strip(off.runtime.records));
  assert.equal(plain(off.runtime.records).some(row => row.kind === 'element.stamp'), false);
  assert.equal(off.tree.nodes.button.getAttribute('data-tracer-el'), null);
});

test('a host passed as a render prop element is stamped at its own JSX site (render_prop), not the wrapper', () => {
  const loaded = loadBrowserRuntime({});
  const { runtime, context, evaluate } = loaded;
  runtime.registerManifest([{ index: 0, id: 'function:aa:1:2' }]);
  evaluate(`globalThis.__edit = globalThis.__productTraceRuntime.tag(function edit() {}, 0);`);
  runtime.registerBuild('b0123456789a');
  runtime.registerPlacements([
    { index: 0, id: 'placement:' + 'e'.repeat(64) + ':190:260', key: 'p_eeeeeeeeeeee:190-260', file: 'src/EditMessage.tsx', line: 190, tag: 'button', component: 'EditMessage' },
    { index: 1, id: 'placement:' + 'f'.repeat(64) + ':160:200', key: 'p_ffffffffffff:160-200', file: 'src/Tooltip.tsx', line: 160, tag: 'Anchor', component: 'Anchor' },
  ]);
  const fiber = (tag, extra = {}) => ({ tag, key: null, child: null, sibling: null, return: null, alternate: null, memoizedProps: {}, ...extra });
  const link = (parent, children) => { parent.child = children[0] || null; children.forEach((child, i) => { child.return = parent; child.sibling = children[i + 1] || null; }); return parent; };
  const place = (props, index) => { context.__productTracePlace({ props }, index); return props; };
  const main = fakeElement('main');
  const button = fakeElement('button', { type: 'button' }, main);
  // First-party `<Anchor render={<button onClick={edit} />} />`: the library
  // clones the render element, so the host's props are a new object.
  const renderElement = { type: 'button', key: null, props: place({ onClick: context.__edit }, 0) };
  const hostFiber = fiber(5, { type: 'button', stateNode: button, memoizedProps: { onClick: context.__edit, 'data-merged': true } });
  const anchorFiber = link(fiber(11, { type: { render() {} }, memoizedProps: place({ render: renderElement }, 1) }), [hostFiber]);
  const mainFiber = link(fiber(5, { type: 'main', stateNode: main, memoizedProps: {} }), [anchorFiber]);
  const rootFiber = link(fiber(3), [link(fiber(0, { memoizedProps: {} }), [mainFiber])]);
  context.__REACT_DEVTOOLS_GLOBAL_HOOK__.onCommitFiberRoot(1, { current: rootFiber });
  assert.equal(button.getAttribute('data-tracer-el'), 'p_eeeeeeeeeeee:190-260#n1');
  const stamp = JSON.parse(JSON.stringify(runtime.records)).find(row => row.kind === 'element.stamp');
  assert.deepEqual([stamp.file, stamp.line, stamp.placement_via], ['src/EditMessage.tsx', 190, 'render_prop']);
});

test('stable element keys: a React-keyed row keeps its key across a removal; an unkeyed row is an honest ordinal', () => {
  const { records, clicks, keyedButton, plainButton } = runStableKeysScenario();
  const stamps = records.filter(row => row.kind === 'element.stamp');
  const actions = records.filter(row => row.kind === 'dom.action');
  // 1. React keys first: `<placement>@<key>`, same key before and after row 2 is removed.
  assert.deepEqual(clicks.filter(click => click.list === 'keyed').map(click => click.key), [`${BUTTON.key}@r4`, `${BUTTON.key}@r4`]);
  assert.equal(keyedButton('r5').getAttribute('data-tracer-el'), `${BUTTON.key}@r5`, 'removal does not shift a React key');
  const keyedRows = stamps.filter(row => row.element_key.startsWith(`${BUTTON.key}@`));
  assert.equal(keyedRows.length, 5, 'keyed rows are not re-emitted when nothing they name changed');
  const r4 = keyedRows.find(row => row.element_key === `${BUTTON.key}@r4`);
  assert.deepEqual([r4.key_kind, r4.react_key, r4.react_key_path, r4.react_key_site, r4.instances], ['react_key', 'r4', ['r4'], KEYED_ROW.id, undefined]);
  assert.deepEqual([r4.binding_placement.placement_id, r4.binding_placement.line], [KEYED_ROW.id, 12]);
  // 2. Ordinal keys are honest: key_kind + instances on every row and action.
  assert.deepEqual(clicks.filter(click => click.list === 'plain').map(click => click.key), [`${BUTTON.key}#n4`, `${BUTTON.key}#n3`]);
  assert.equal(plainButton('r4').getAttribute('data-tracer-el'), `${BUTTON.key}#n3`, 'the unkeyed row 4 moved to ordinal 3');
  const ordinalRows = stamps.filter(row => row.element_key.includes('#n'));
  assert.ok(ordinalRows.every(row => row.key_kind === 'ordinal' && Number.isInteger(row.instances) && row.binding_placement.placement_id === PLAIN_ROW.id));
  assert.deepEqual(ordinalRows.map(row => [row.element_key.slice(BUTTON.key.length), row.instances, row.commit]),
    [['#n1', 5, 1], ['#n2', 5, 1], ['#n3', 5, 1], ['#n4', 5, 1], ['#n5', 5, 1], ['#n1', 4, 3], ['#n2', 4, 3], ['#n3', 4, 3], ['#n4', 4, 3]]);
  assert.deepEqual(stamps.map(row => row.stamp_sequence), stamps.map((row, i) => i + 1), 'stamp rows keep their own contiguous counter');
  // dom.action carries the key's state and the stamp row that held when it fired.
  const bySequence = new Map(stamps.map(row => [row.stamp_sequence, row]));
  assert.deepEqual(actions.map(row => [row.target.element_key.slice(BUTTON.key.length), row.target.key_kind, row.target.instances ?? null]),
    [['@r4', 'react_key', null], ['#n4', 'ordinal', 5], ['@r4', 'react_key', null], ['#n3', 'ordinal', 4]]);
  for (const action of actions) {
    const row = bySequence.get(action.target.stamp_sequence);
    assert.equal(row.element_key, action.target.element_key);
    assert.equal(row.instances, action.target.instances);
  }
  assert.deepEqual(actions.map(row => row.sequence - actions[0].sequence), [0, 1, 2, 3], 'stamp rows never consume the attribution sequence');
  // 3. The G3 resolver: the placement is exact either way; the element only for the React key.
  const index = indexElementStamps(records);
  const keyed = resolveElement(index, { element_key: `${BUTTON.key}@r4` });
  assert.deepEqual([keyed.status, keyed.key_kind, keyed.instances, keyed.element_confidence, keyed.source.file], ['exact', 'react_key', 1, 'exact', 'src/Row.jsx']);
  const ordinal = resolveElement(index, { element_key: `${BUTTON.key}#n3` });
  assert.deepEqual([ordinal.status, ordinal.key_kind, ordinal.instances, ordinal.element_confidence, ordinal.reason], ['exact', 'ordinal', 5, 'ambiguous', 'ordinal key; 5 instances of this placement']);
});

test('stable element keys: escaping, a key path through nested keyed lists, and a shared key path falls back to ordinals', () => {
  const loaded = loadBrowserRuntime({});
  const { runtime, context, evaluate } = loaded;
  runtime.registerManifest([{ index: 0, id: 'function:aa:1:2' }]);
  evaluate(`globalThis.__save = globalThis.__productTraceRuntime.tag(function save() {}, 0);`);
  runtime.registerPlacements([{ index: 0, id: `placement:${'c'.repeat(64)}:10:60`, key: 'p_cccccccccccc:10-60', file: 'src/Cell.jsx', line: 2, tag: 'button', component: 'Cell' }]);
  const fiber = (tag, extra = {}) => ({ tag, key: null, child: null, sibling: null, return: null, alternate: null, memoizedProps: {}, ...extra });
  const link = (parent, children) => { parent.child = children[0] || null; children.forEach((child, i) => { child.return = parent; child.sibling = children[i + 1] || null; }); return parent; };
  const main = fakeElement('main');
  const cell = (key, node) => link(fiber(0, { key, memoizedProps: {} }), [fiber(5, { type: 'button', stateNode: node, memoizedProps: (() => { const props = { onClick: context.__save }; context.__productTracePlace({ props }, 0); return props; })() })]);
  const nodes = Array.from({ length: 6 }, () => fakeElement('button', { type: 'button' }, main));
  // Two keyed groups with the same item keys (g/1 vs h/1), one item whose key needs escaping,
  // and two unkeyed groups whose keyed items share the path "x".
  const tree = link(fiber(5, { type: 'main', stateNode: main }), [
    link(fiber(0, { key: 'g' }), [cell('1', nodes[0]), cell('a/b c', nodes[1])]),
    link(fiber(0, { key: 'h' }), [cell('1', nodes[2])]),
    link(fiber(0), [cell('x', nodes[3])]),
    link(fiber(0), [cell('x', nodes[4])]),
    link(fiber(0, { key: 'long' }), [cell('z'.repeat(250), nodes[5])]),
  ]);
  context.__REACT_DEVTOOLS_GLOBAL_HOOK__.onCommitFiberRoot(1, { current: link(fiber(3), [tree]) });
  const keys = nodes.map(node => node.getAttribute('data-tracer-el').slice('p_cccccccccccc:10-60'.length));
  assert.deepEqual(keys.slice(0, 5), ['@g/1', '@g/a%2Fb%20c', '@h/1', '#n1', '#n2']);
  assert.match(keys[5], /^@%h[0-9a-f]{16}$/u, 'an over-long key path is hashed');
  const stamps = JSON.parse(JSON.stringify(runtime.records)).filter(row => row.kind === 'element.stamp');
  assert.deepEqual(stamps.filter(row => row.key_kind === 'ordinal').map(row => row.instances), [2, 2], 'a key path shared by two hosts of one placement is not a unique key');
  assert.ok(stamps.every(row => /^[\x21-\x7e]{1,256}$/u.test(row.element_key)));
});

test('stable element keys: a key held in two React roots falls back to ordinals counted across roots', () => {
  const { records, aloneKeys, sharedKeys, afterUnmount } = runRootsAndIndexScenario();
  assert.deepEqual(aloneKeys, [`${BUTTON.key}@w1`, `${BUTTON.key}@w2`], 'one root: React keys');
  assert.deepEqual(sharedKeys, [1, 2, 3, 4].map(i => `${BUTTON.key}#n${i}`), 'two roots: page-unique ordinals, root A first');
  assert.deepEqual(afterUnmount, [`${BUTTON.key}@w1`, `${BUTTON.key}@w2`], 'root B gone: React keys again');
  const click = records.find(row => row.kind === 'dom.action');
  assert.deepEqual([click.target.element_key, click.target.key_kind, click.target.instances], [`${BUTTON.key}#n4`, 'ordinal', 4]);
  const index = indexElementStamps(records);
  const resolved = resolveElement(index, { element_key: `${BUTTON.key}#n4` });
  assert.deepEqual([resolved.element_confidence, resolved.instances], ['ambiguous', 4]);
});

test('stable element keys: an index key names another item after a reorder; the content signature records it', () => {
  const { records, beforeReverse, nodesC } = runRootsAndIndexScenario();
  assert.equal(beforeReverse[1], `${BUTTON.key}@1`);
  assert.equal(nodesC[1].getAttribute('data-tracer-el'), `${BUTTON.key}@1`, 'the index key is positional');
  const rows = records.filter(row => row.kind === 'element.stamp' && row.element_key === `${BUTTON.key}@1`);
  assert.equal(rows.length, 2, 'a new row when the content under the key changed');
  assert.notEqual(rows[0].content_sig, rows[1].content_sig);
  assert.ok(rows.every(row => /^[0-9a-f]{16}$/u.test(row.content_sig)));
  const resolved = resolveElement(indexElementStamps(records), { element_key: `${BUTTON.key}@1` });
  assert.deepEqual([resolved.key_kind, resolved.element_confidence, resolved.reason], ['react_key', 'ambiguous', 'key content changed between observations (index-like key)']);
  assert.equal(resolveElement(indexElementStamps(records), { element_key: `${BUTTON.key}@2` }).element_confidence, 'ambiguous');
});

test('stable element keys: the hashed key path is the JSON-encoded path (no join collision)', () => {
  const loaded = loadBrowserRuntime({});
  const { runtime, context } = loaded;
  runtime.registerPlacements([BUTTON]);
  const fiber = (tag, extra = {}) => ({ tag, key: null, child: null, sibling: null, return: null, alternate: null, memoizedProps: {}, ...extra });
  const link = (parent, children) => { parent.child = children[0] || null; children.forEach((child, i) => { child.return = parent; child.sibling = children[i + 1] || null; }); return parent; };
  const nodes = [fakeElement('button'), fakeElement('button')];
  const host = node => { const props = { type: 'button' }; context.__productTracePlace({ props }, 0); return fiber(5, { type: 'button', stateNode: node, memoizedProps: props }); };
  const tree = link(fiber(3), [
    link(fiber(0, { key: '\uD800' }), [link(fiber(0, { key: 'x' }), [host(nodes[0])])]),
    link(fiber(0, { key: '\uD800\u0000x' }), [host(nodes[1])]),
  ]);
  context.__REACT_DEVTOOLS_GLOBAL_HOOK__.onCommitFiberRoot(1, { current: tree });
  const [left, right] = nodes.map(node => node.getAttribute('data-tracer-el'));
  assert.match(left, /@%h[0-9a-f]{16}$/u);
  assert.match(right, /@%h[0-9a-f]{16}$/u);
  assert.notEqual(left, right);
});
