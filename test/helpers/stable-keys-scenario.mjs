// Scenario for fix/stable-element-keys, driven through the real browser
// runtime in a VM with a hand-built committed fiber tree (the shape React
// commits for test/browser/fixtures/stable-keys-app/main.jsx):
//
//   main > ul.keyed > Row key=<id> > button "Save <title>"   (Row placement 1)
//        > ul.plain > Row (no key) > button "Save <title>"   (Row placement 2)
//
// Both lists render the same <button> placement (0). Rows r1..r5 in each list.
// 1. commit; click row 4's Save in each list.
// 2. remove row 2 from both lists; commit (React keeps the keyed nodes and, for
//    the unkeyed list, updates the first four nodes in place and drops the last).
// 3. click row 4's Save in each list again.
import { fakeElement, loadBrowserRuntime } from './browser-runtime-vm.mjs';

export const BUTTON = { index: 0, id: `placement:${'a'.repeat(64)}:120:210`, key: 'p_aaaaaaaaaaaa:120-210', file: 'src/Row.jsx', line: 4, start: 120, end: 210, tag: 'button', component: 'Row' };
export const KEYED_ROW = { index: 1, id: `placement:${'b'.repeat(64)}:400:470`, key: 'p_bbbbbbbbbbbb:400-470', file: 'src/Lists.jsx', line: 12, start: 400, end: 470, tag: 'Row', component: 'Row' };
export const PLAIN_ROW = { index: 2, id: `placement:${'b'.repeat(64)}:520:580`, key: 'p_bbbbbbbbbbbb:520-580', file: 'src/Lists.jsx', line: 15, start: 520, end: 580, tag: 'Row', component: 'Row' };

export function runStableKeysScenario({ stamps = true } = {}) {
  const loaded = loadBrowserRuntime({ extraGlobals: stamps ? {} : { __PRODUCTTRACE_STAMPS__: false } });
  const { runtime, context, evaluate, dispatch } = loaded;
  runtime.registerManifest([{ index: 0, id: 'function:aa:1:2' }, { index: 1, id: 'function:bb:3:4' }]);
  evaluate(`globalThis.__save = globalThis.__productTraceRuntime.tag(function save() {}, 0); globalThis.__onSave = globalThis.__productTraceRuntime.tag(function onSave() {}, 1);`);
  runtime.registerBuild('b0123456789a');
  runtime.registerPlacements([BUTTON, KEYED_ROW, PLAIN_ROW]);
  const place = (props, index) => { context.__productTracePlace({ props }, index); return props; };
  const fiber = (tag, extra = {}) => ({ tag, key: null, child: null, sibling: null, return: null, alternate: null, memoizedProps: {}, ...extra });
  const link = (parent, children) => { parent.child = children[0] || null; children.forEach((child, i) => { child.return = parent; child.sibling = children[i + 1] || null; }); return parent; };

  const main = fakeElement('main');
  const keyedList = fakeElement('ul', {}, main), plainList = fakeElement('ul', {}, main);
  const keyedNodes = new Map(); // item id -> button node (React keeps it while the key lives)
  const plainNodes = [];        // position -> button node (React reuses by position)
  const items = ['r1', 'r2', 'r3', 'r4', 'r5'].map((id, i) => ({ id, title: `Row ${i + 1}` }));
  let current = items;
  const fiberRoot = { current: null };

  const commit = () => {
    const row = (item, node, rowPlacement, key) => {
      node.setAttribute('aria-label', `Save ${item.title}`);
      const button = fiber(5, { type: 'button', stateNode: node, memoizedProps: place({ type: 'button', 'aria-label': `Save ${item.title}`, onClick: context.__save }, BUTTON.index) });
      return link(fiber(0, { key, memoizedProps: place({ item, onSave: context.__onSave }, rowPlacement.index) }), [button]);
    };
    const keyedRows = current.map(item => {
      if (!keyedNodes.has(item.id)) keyedNodes.set(item.id, fakeElement('button', { type: 'button' }, keyedList));
      return row(item, keyedNodes.get(item.id), KEYED_ROW, item.id);
    });
    plainNodes.length = Math.min(plainNodes.length, current.length);
    const plainRows = current.map((item, i) => {
      if (!plainNodes[i]) plainNodes[i] = fakeElement('button', { type: 'button' }, plainList);
      return row(item, plainNodes[i], PLAIN_ROW, null);
    });
    const ulKeyed = link(fiber(5, { type: 'ul', stateNode: keyedList }), keyedRows);
    const ulPlain = link(fiber(5, { type: 'ul', stateNode: plainList }), plainRows);
    const mainFiber = link(fiber(5, { type: 'main', stateNode: main }), [ulKeyed, ulPlain]);
    const rootFiber = link(fiber(3), [link(fiber(0), [mainFiber])]);
    fiberRoot.current = rootFiber; // React keeps one FiberRoot per root
    context.__REACT_DEVTOOLS_GLOBAL_HOOK__.onCommitFiberRoot(1, fiberRoot);
  };
  const keyedButton = id => keyedNodes.get(id);
  const plainButton = id => plainNodes[current.findIndex(item => item.id === id)];

  commit();
  commit(); // an identical re-render emits no new stamp rows
  const clicks = [];
  const click = (list, node) => { dispatch('click', node); clicks.push({ list, node, key: node.getAttribute('data-tracer-el') }); };
  click('keyed', keyedButton('r4'));
  click('plain', plainButton('r4'));
  current = items.filter(item => item.id !== 'r2');
  commit();
  click('keyed', keyedButton('r4'));
  click('plain', plainButton('r4'));
  const records = JSON.parse(JSON.stringify(runtime.records)).map(row => ({ ...row, capture_page_id: 'page-1' }));
  return { ...loaded, records, clicks, keyedButton, plainButton };
}

// Grade follow-ups (2026-09-24): two React roots mounting the same keyed
// widget, and an index-keyed list (`key={i}`) that is reversed between clicks.
export function runRootsAndIndexScenario() {
  const loaded = loadBrowserRuntime({});
  const { runtime, context, evaluate, dispatch } = loaded;
  runtime.registerManifest([{ index: 0, id: 'function:aa:1:2' }]);
  evaluate(`globalThis.__save = globalThis.__productTraceRuntime.tag(function save() {}, 0);`);
  runtime.registerBuild('b0123456789a');
  runtime.registerPlacements([BUTTON, KEYED_ROW]);
  const fiber = (tag, extra = {}) => ({ tag, key: null, child: null, sibling: null, return: null, alternate: null, memoizedProps: {}, ...extra });
  const link = (parent, children) => { parent.child = children[0] || null; children.forEach((child, i) => { child.return = parent; child.sibling = children[i + 1] || null; }); return parent; };
  const place = (props, index) => { context.__productTracePlace({ props }, index); return props; };
  const row = (key, node, label) => {
    node.setAttribute('aria-label', label);
    return link(fiber(0, { key, memoizedProps: place({ label }, KEYED_ROW.index) }), [fiber(5, { type: 'button', stateNode: node, memoizedProps: place({ 'aria-label': label, onClick: context.__save }, BUTTON.index) })]);
  };
  const commit = (fiberRoot, rows) => {
    fiberRoot.current = link(fiber(3), rows.length ? [link(fiber(5, { type: 'ul', stateNode: fakeElement('ul') }), rows)] : []);
    context.__REACT_DEVTOOLS_GLOBAL_HOOK__.onCommitFiberRoot(1, fiberRoot);
  };
  // Two roots, the same widget with ids w1, w2 in each.
  const rootA = { current: null }, rootB = { current: null };
  const nodesA = [fakeElement('button'), fakeElement('button')], nodesB = [fakeElement('button'), fakeElement('button')];
  commit(rootA, [row('w1', nodesA[0], 'Save one'), row('w2', nodesA[1], 'Save two')]);
  const aloneKeys = nodesA.map(node => node.getAttribute('data-tracer-el'));
  commit(rootB, [row('w1', nodesB[0], 'Save one'), row('w2', nodesB[1], 'Save two')]);
  commit(rootA, [row('w1', nodesA[0], 'Save one'), row('w2', nodesA[1], 'Save two')]);
  const sharedKeys = [...nodesA, ...nodesB].map(node => node.getAttribute('data-tracer-el'));
  dispatch('click', nodesB[1]);
  commit(rootB, []); // root B unmounts
  const afterUnmount = nodesA.map(node => node.getAttribute('data-tracer-el'));
  commit(rootA, []);
  // Index keys: titles at positions 0..3; React reuses the node at each index.
  const rootC = { current: null };
  const nodesC = [0, 1, 2, 3].map(() => fakeElement('button'));
  let titles = ['Alpha', 'Beta', 'Gamma', 'Delta'];
  const indexCommit = () => commit(rootC, titles.map((title, i) => row(String(i), nodesC[i], `Save ${title}`)));
  indexCommit();
  const beforeReverse = nodesC.map(node => node.getAttribute('data-tracer-el'));
  dispatch('click', nodesC[1]); // Save Beta at index 1
  dispatch('click', nodesC[3]); // Save Delta at index 3; after the reverse @3 shows Beta and gets no new click
  titles = [...titles].reverse(); indexCommit();
  dispatch('click', nodesC[0]); // Save Delta, now at index 0
  dispatch('click', nodesC[1]); // Save Gamma, now at index 1
  const records = JSON.parse(JSON.stringify(runtime.records)).map(row => ({ ...row, capture_page_id: 'page-1' }));
  return { ...loaded, records, aloneKeys, sharedKeys, afterUnmount, beforeReverse, nodesC };
}
