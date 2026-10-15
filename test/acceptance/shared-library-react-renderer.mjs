import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { readLibraryImplementation, admitCatalogProgram } from '../../authoring/index.mjs';
import { createLibraryProgramBank, instrumentLibraryPrograms } from '../../analysis/index.mjs';
import { checkCase } from '../../evaluation/shared-rules/check-case.mjs';

// Reuse a real LibreChat installation. No generated program or fixture package
// is substituted for its React/ReactDOM implementation.
const repository = path.resolve(process.argv[2] || '/tmp/producttrace-librechat-autonomous');
const require = createRequire(path.join(repository, 'package.json'));
const catalog = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../../authoring/banks/initial-library-programs.json', import.meta.url))));
const implementations = new Map(['memo', 'forwardRef'].map(exportName => [exportName,
  readLibraryImplementation({ repository, specifier: 'react', exportName })]));
const profiles = { memo: 'memo_descriptor', forwardRef: 'render_descriptor' };
const bank = createLibraryProgramBank({ check: ({ implementation, program }) => checkCase({ profile: profiles[implementation.context.export_name] }, implementation, program) });
for (const [exportName, implementation] of implementations) {
  const skeleton = catalog.skeletons.find(row => row.package === 'react' && row.export_name === exportName);
  const result = await admitCatalogProgram({ skeleton, implementation, bank });
  assert.equal(result.status, 'admitted', JSON.stringify(result));
}
const React = require('react'), { JSDOM } = require('jsdom');
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
globalThis.window = dom.window; globalThis.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = require('react-dom/client');
const { act } = React;
const events = [], renders = [], comparisons = [];
const source = `import { memo, forwardRef } from 'react';
  function Card(props) {
    renders.push(props.label);
    return React.createElement('button', { id: 'memo-button', onClick: props.onPress }, props.label);
  }
  function compare(before, after) {
    comparisons.push([before.label, after.label]);
    return before.label === after.label && before.onPress === after.onPress;
  }
  function Input(props, ref) {
    return React.createElement('button', { id: 'ref-button', ref, onClick: props.onPress }, 'ref');
  }
  export const MemoCard = memo(Card, compare);
  export const RefInput = forwardRef(Input);
  export const originals = { Card, compare, Input };`;
const integrated = instrumentLibraryPrograms({ source, file: 'real-react-consumer.ts', bank });
assert.equal(integrated.frontiers.length, 0);
const exports = {};
vm.runInNewContext(ts.transpileModule(integrated.code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
  { exports, require, React, renders, comparisons, [integrated.runtimeKey]: integrated.runtime });
assert.equal(exports.MemoCard.type, exports.originals.Card);
assert.equal(exports.MemoCard.compare, exports.originals.compare);
assert.equal(exports.RefInput.render, exports.originals.Input);
const root = createRoot(document.getElementById('root')), ref = React.createRef();
const onPress = () => events.push('memo'), onRef = () => events.push('ref');
const tree = label => React.createElement(React.Fragment, null,
  React.createElement(exports.MemoCard, { label, onPress }), React.createElement(exports.RefInput, { ref, onPress: onRef }));
try {
  await act(async () => root.render(tree('first')));
  assert.equal(ref.current, document.getElementById('ref-button'));
  await act(async () => {
    document.getElementById('memo-button').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    document.getElementById('ref-button').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
  await act(async () => root.render(tree('first')));
  assert.deepEqual(renders, ['first']); // Original comparator still controls the real bailout.
  await act(async () => root.render(tree('changed')));
  assert.deepEqual(renders, ['first', 'changed']);
  assert.deepEqual(events, ['memo', 'ref']);
  assert.equal(comparisons.length, 2);
  const reports = integrated.runtime.checkpoint();
  assert(reports.every(row => row.status === 'observed_agreement'), JSON.stringify(reports));
  assert(reports.every(row => row.observation_mode === 'references'));
  assert.equal(reports.flatMap(row => row.evidence).filter(row => row.kind === 'callback_reference').length, 3);
  await act(async () => root.unmount());
  assert.equal(ref.current, null);
  console.log(JSON.stringify({ passed: true, installed_react: React.version, controls_clicked: events,
    renders, comparison_calls: comparisons.length, exact_callback_identities: 3,
    catalog_reused_across_npm_alias: true, source_bindings: integrated.bindings, reports,
    scope: 'Real ReactDOM renders, memo bailout, ref attachment/unmount, and DOM clicks remain correct. Shared rules prove stored callback references; later lifecycle execution is witnessed by this test, not yet emitted as shared-rule execution evidence.' }, null, 2));
} finally { dom.window.close(); }
