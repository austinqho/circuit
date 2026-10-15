import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { readLibraryImplementation } from '../../authoring/library-implementation.mjs';
import { portableImplementation, readCatalogImplementation, admitCatalogProgram, programOverrides } from '../../authoring/library-program-catalog.mjs';
import { createLibraryProgramVerifier } from '../../authoring/library-program-verifier.mjs';
import { createLibraryProgramBank, programHash } from '../../analysis/library-program-bank.mjs';
import { createOwnedReferenceBoundary, createReactReferenceOwnerHost } from '../../analysis/library-owned-reference.mjs';
import { instrumentLibraryPrograms } from '../../analysis/library-program-integration.mjs';

const repository = path.resolve(process.argv[2] || '/tmp/producttrace-librechat-autonomous');
const require = createRequire(path.join(repository, 'package.json'));
const implementation = readLibraryImplementation({ repository, specifier: 'react', exportName: 'useCallback' });
const React = require('react'), { JSDOM } = require('jsdom');
const dom = new JSDOM('<main></main>', { url: 'http://localhost/' });
globalThis.window = dom.window; globalThis.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const rendererImplementation = readLibraryImplementation({ repository, specifier: 'react-dom/client', exportName: 'createRoot' });
const createRoot = rendererImplementation.producer;
const act = React.act || require('react-dom/test-utils').act;
const host = createReactReferenceOwnerHost(React);
const arg = index => ({ op: 'arg', index });
const call = (target, value) => ({ op: 'call', target, receiver: { op: 'undefined' }, args: { op: 'array', items: [value] } });
const program = { schema: 'producttrace.library-program.v1', body: { op: 'sequence', steps: [
  call(arg(2), { op: 'get', value: arg(0), key: 0 }), call(arg(3), arg(1)),
] } };

// The exported React wrapper delegates to the renderer. Keep those installed
// helper bodies and bytes with the check, rather than pretending the wrapper
// alone explains retention. This rule only describes returned reference origin.
const rendererFiles = rendererImplementation.context.files.filter(row => row.path.includes('/react-dom/') && row.path.endsWith('.js'));
const matching = rendererFiles.filter(row => fs.readFileSync(path.join(repository, row.path), 'utf8').includes('function mountCallback('));
assert.equal(matching.length, 1, 'installed renderer helper source must be unique');
const rendererFile = path.join(repository, matching[0].path);
const rendererSource = fs.readFileSync(rendererFile, 'utf8');
const rendererAst = ts.createSourceFile(rendererFile, rendererSource, ts.ScriptTarget.Latest, true);
const helpers = [];
let inlineUpdateRef = null;
const visit = node => {
  if (ts.isFunctionDeclaration(node) && ['mountCallback', 'updateCallback', 'areHookInputsEqual', 'mountRef', 'updateRef'].includes(node.name?.text))
    helpers.push({ name: node.name.text, source: node.getText(rendererAst) });
  if (ts.isPropertyAssignment(node) && node.name.getText(rendererAst) === 'useRef'
    && ts.isBinaryExpression(node.parent?.parent)
    && node.parent.parent.left.getText(rendererAst) === 'HooksDispatcherOnUpdateInDEV')
    inlineUpdateRef = { name: 'updateRef', source_location: 'HooksDispatcherOnUpdateInDEV.useRef', source: node.getText(rendererAst) };
  ts.forEachChild(node, visit);
};
visit(rendererAst);
// React 19 inlines the update-ref helper into the dispatcher. Keep the actual
// installed method body as evidence instead of assuming an old helper exists.
if (!helpers.some(row => row.name === 'updateRef') && inlineUpdateRef) helpers.push(inlineUpdateRef);
assert.equal(helpers.length, 5);
const rendererDigest = createHash('sha256').update(rendererSource).digest('hex');
const unchanged = implementation.unchanged;
const attested = { ...implementation, context: { ...implementation.context,
  host_dependencies: [rendererImplementation.context], host_source_selections: helpers,
}, unchanged: () => unchanged() && rendererImplementation.unchanged() };
attested.sha256 = createHash('sha256').update(JSON.stringify(attested.context)).digest('hex');

async function scenario(invoke, checkpoint, strict = false) {
  const container = document.createElement('section'); document.querySelector('main').append(container);
  const root = createRoot(container), selected = new Map(), clicks = [];
  let suspend = false;
  const pending = new Promise(() => {});
  function Child({ name, dep }) {
    const fn = () => `${name}:${dep}`;
    const result = invoke(fn, [dep]); selected.set(name, result);
    if (suspend && name === 'a') throw pending;
    return React.createElement('button', { 'data-name': name, onClick: () => clicks.push(result()) }, name);
  }
  const tree = (a, b) => React.createElement(strict ? React.StrictMode : React.Fragment, null,
    React.createElement(React.Suspense, { fallback: React.createElement('span', null, 'pending') },
      React.createElement(Child, { name: 'a', dep: a }), React.createElement(Child, { name: 'b', dep: b })));
  try {
    await act(async () => root.render(tree(1, 1)));
    const firstA = selected.get('a'), firstB = selected.get('b');
    await act(async () => root.render(tree(1, 2)));
    assert.equal(selected.get('a'), firstA); assert.notEqual(selected.get('b'), firstB);
    suspend = true; await act(async () => root.render(tree(3, 2)));
    suspend = false; await act(async () => root.render(tree(1, 2)));
    assert.equal(selected.get('a'), firstA); // Suspended work must not replace this selected origin.
    await act(async () => container.querySelectorAll('button').forEach(button => button.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))));
    assert.deepEqual(clicks, ['a:1', 'b:2']);
    const beforeUnmount = checkpoint();
    assert.equal(beforeUnmount.status, 'observed_agreement', JSON.stringify(beforeUnmount));
    const oldOwners = new Set(beforeUnmount.evidence.map(row => row.owner));
    await act(async () => root.render(null));
    await act(async () => root.render(tree(1, 2)));
    const afterRemount = checkpoint();
    assert(afterRemount.evidence.slice(beforeUnmount.evidence.length).every(row => !oldOwners.has(row.owner)));
    assert.equal(afterRemount.status, 'observed_agreement', JSON.stringify(afterRemount));
    return { strict, clicks, report: afterRemount };
  } finally { await act(async () => root.unmount()); container.remove(); }
}

async function check(candidate) {
  try {
    const checks = [];
    for (const strict of [false, true]) {
      const boundary = createOwnedReferenceBoundary({ producer: implementation.producer, program: candidate, captureOwner: host.captureOwner });
      checks.push(await scenario((cb, deps) => boundary.invoke([cb, deps], { callbackIds: { 0: 'independent-source' } }), () => boundary.checkpoint(), strict));
    }
    return { status: 'passed', checks };
  } catch (error) { return { status: 'rejected', reason: error.message }; }
}
try {
  const scope = { protocol: 'owned_returned_reference', callbackArguments: [0], resultPaths: null,
    description: 'Actual returned callback identity in an observed mounted slot; excludes commit and invocation claims.' };
  const catalogPath = fileURLToPath(new URL('../../authoring/banks/react-owned-programs.json', import.meta.url));
  const catalog = JSON.parse(fs.readFileSync(catalogPath));
  const skeleton = catalog.skeletons.find(row => row.package === 'react' && row.export_name === 'useCallback');
  const reused = readCatalogImplementation({ repository, specifier: 'react', exportName: 'useCallback', skeleton });
  assert.equal(reused.context.source_status, 'ready_for_catalog_recheck');
  assert.deepEqual(portableImplementation(reused.context), portableImplementation(attested.context));
  if (process.argv.includes('--write-catalog')) {
    const portable = portableImplementation(reused.context);
    const row = { version: React.version, base_sha256: programHash(skeleton.program),
      overrides: programOverrides(skeleton.program, program), program_sha256: programHash(program),
      implementation_sha256: programHash(portable), implementation: portable,
      verification: { origin: 'manual_exact_installed_renderer_source', helpers } };
    skeleton.versions = skeleton.versions.filter(item => item.version !== React.version).concat(row);
  }
  const wrong = structuredClone(program); wrong.body.steps[1].args.items[0] = { op: 'get', value: arg(0), key: 0 };
  assert.equal((await check(wrong)).status, 'rejected');
  const source = "import { useCallback } from 'react'; export function useTraced(cb, deps) { return useCallback(cb, deps); }";
  let integrated, integration;
  const integrationCheck = async ({program}) => {
    // This provisional entry is private to the integration test. The usable
    // bank below admits only after both independent gates have completed.
    const probe = createLibraryProgramBank({check: () => ({status: 'passed', reason: 'isolated_integration_probe'})});
    assert.equal((await probe.admit({implementation: reused, program, scope})).status, 'admitted');
    assert.equal(instrumentLibraryPrograms({ source, bank: probe }).frontiers[0].reason, 'required_owner_host_unavailable');
    integrated = instrumentLibraryPrograms({ source, file: 'owned-hook.ts', bank: probe, ownedReferenceHost: host });
    const exports = {};
    vm.runInNewContext(ts.transpileModule(integrated.code, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
      { exports, require, [integrated.runtimeKey]: integrated.runtime });
    integration = await scenario(exports.useTraced, () => integrated.runtime.checkpoint()[0], true);
    const execution=integrated.runtime.execution();assert.equal(execution.status,'observed_execution');
    assert.equal(execution.events.length,integration.report.calls);
    assert(execution.events.every(row=>row.kind==='library_invocation'&&row.source.file==='owned-hook.ts'));
    const ids=new Set(execution.events.map(row=>row.id));
    assert(integration.report.evidence.every(row=>ids.has(row.execution_id)));
    integration.execution={status:execution.status,api_calls:execution.events.length,callback_execution_claims:0};
    return {status: 'passed', integration};
  };
  const bank = createLibraryProgramBank({check: createLibraryProgramVerifier({scope, behavior: ({program}) => check(program), integration: integrationCheck})});
  const admitted = await admitCatalogProgram({skeleton, implementation: reused, bank});
  assert.equal(admitted.status, 'admitted', JSON.stringify(admitted));
  if (process.argv.includes('--write-catalog')) fs.writeFileSync(catalogPath, JSON.stringify(catalog,null,2)+'\n');
  console.log(JSON.stringify({ passed: true, installed_react: React.version, renderer_sha256: rendererDigest,
    program: bank.lookup('react', 'useCallback').program, implementation: portableImplementation(reused.context), catalog_reused: true,
    helpers, negative_rule_rejected: true, source_binding: integrated.bindings, integration,
    scope: scope.description }, null, 2));
} finally { dom.window.close(); }
