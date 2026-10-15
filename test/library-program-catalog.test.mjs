import test from 'node:test';
import assert from 'node:assert/strict';
import { portableImplementation, programOverrides, admitCatalogProgram } from '../authoring/library-program-catalog.mjs';
import { programHash, resolveVersionedProgram } from '../analysis/library-program-bank.mjs';
const program = { schema: 'producttrace.library-program.v1', body: { op: 'arg', index: 0 } };
const context = alias => ({ source_status: 'ready_for_scoped_proposal', specifier: alias, export_name: 'update',
  runtime: { host: 'node', mode: 'development', entry: `node_modules/${alias}/index.js` },
  packages: [{ path: `node_modules/${alias}`, name: 'example', version: '1.0.0', integrity: 'pinned', manifest_sha256: 'manifest' }],
  files: [{ path: `node_modules/${alias}/index.js`, sha256: 'source' }],
});
const skeleton = () => ({ schema: 'producttrace.library-program-skeleton.v1', package: 'example', export_name: 'update', program,
  scope: { callbackArguments: [], resultPaths: null }, versions: [{ version: '1.0.0', base_sha256: programHash(program),
    overrides: [], program_sha256: programHash(program), implementation_sha256: programHash(portableImplementation(context('original'))) }] });

test('catalog reuse survives checkout aliases and must run the independent checker again', async () => {
  assert.deepEqual(portableImplementation(context('one')), portableImplementation(context('two')));
  let checked = 0;
  const result = await admitCatalogProgram({ skeleton: skeleton(), implementation: { context: context('new-alias'), unchanged: () => true },
    bank: { admit: async row => { checked++; assert.deepEqual(row.program, program); return { status: 'admitted' }; } } });
  assert.equal(result.status, 'admitted'); assert.equal(checked, 1);
});

test('unknown versions, modified installed bytes, and edited catalog programs reject before checking', async () => {
  for (const change of [
    ({ context }) => { context.packages[0].version = '1.0.1'; },
    ({ context }) => { context.files[0].sha256 = 'changed'; },
    ({ skeleton }) => { skeleton.program = { ...program, body: { op: 'arg', index: 1 } }; },
    ({ skeleton }) => { skeleton.versions[0].program_sha256 = 'forged'; },
  ]) {
    const state = { context: context('same'), skeleton: skeleton() }; change(state);
    const result = await admitCatalogProgram({ skeleton: state.skeleton, implementation: { context: state.context, unchanged: () => true },
      bank: { admit: () => { throw new Error('must not reach checker'); } } });
    assert.equal(result.status, 'rejected');
  }
});

test('version differences round-trip through replacement data without changing the interpreter', () => {
  for (const body of [{ op: 'arg', index: 1 }, { op: 'array', items: [{ op: 'arg', index: 0 }] }]) {
    const target = { ...program, body }, entry = skeleton();
    entry.versions[0].overrides = programOverrides(program, target);
    assert.deepEqual(resolveVersionedProgram(entry, '1.0.0').program, target);
  }
});

test('one version admits only explicitly checked build or dependency variants', async () => {
  const entry = skeleton(), development = context('example'), production = context('example');
  production.runtime.mode = 'production'; production.files[0].sha256 = 'production-source';
  const productionProgram = { ...program, body: { op: 'arg', index: 1 } };
  entry.versions[0].source_variants = [
    { implementation_sha256: programHash(portableImplementation(development)), program_sha256: programHash(program), overrides: [] },
    { implementation_sha256: programHash(portableImplementation(production)), program_sha256: programHash(productionProgram), overrides: programOverrides(program, productionProgram) },
  ];
  for (const [context, expected] of [[development, program], [production, productionProgram]]) {
    let checked = false;
    const result = await admitCatalogProgram({ skeleton: entry, implementation: { context, unchanged: () => true }, bank: { admit: async ({ program }) => {
      checked = true; assert.deepEqual(program, expected); return { status: 'admitted' };
    } } });
    assert.equal(result.status, 'admitted'); assert(checked);
  }
  production.files[0].sha256 = 'unseen-production-source';
  const result = await admitCatalogProgram({ skeleton: entry, implementation: { context: production, unchanged: () => true },
    bank: { admit: () => { throw new Error('unknown source must not run checker'); } } });
  assert.equal(result.reason, 'catalog_installed_source_mismatch');
});

test('host implementation bytes participate in catalog identity', () => {
  const first = context('example'), second = context('alias');
  first.host_dependencies = [context('host')]; second.host_dependencies = [context('host')];
  assert.deepEqual(portableImplementation(first), portableImplementation(second));
  second.host_dependencies[0].files[0].sha256 = 'different-renderer';
  assert.notDeepEqual(portableImplementation(first), portableImplementation(second));
});

test('package aliases preserve subpath identity and different default exports cannot borrow a catalog',async()=>{
  const {libraryImportSubpath}=await import('../authoring/library-program-catalog.mjs');
  assert.equal(libraryImportSubpath('alias/negate'),'./negate');assert.equal(libraryImportSubpath('@scope/alias/negate'),'./negate');
  assert.equal(libraryImportSubpath('@scope/alias'),'.');
  const source=context('alias'),saved=skeleton();source.specifier='alias/negate';saved.import_subpath='./negate';
  const implementation={context:source,unchanged:()=>true};let checks=0;
  const bank={admit:async()=>{checks++;return {status:'admitted'}}};
  assert.equal((await admitCatalogProgram({skeleton:saved,implementation,bank})).status,'admitted');
  for(const specifier of ['alias','alias/identity','@scope/alias/identity']){
    source.specifier=specifier;assert.equal((await admitCatalogProgram({skeleton:saved,implementation,bank})).reason,'catalog_import_subpath_mismatch');
  }
  assert.equal(checks,1);
});
