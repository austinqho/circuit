import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import ts from 'typescript';
import { createLibraryProgramBank, instrumentLibraryPrograms, LIBRARY_PROGRAM_SCHEMA } from '../analysis/index.mjs';

const program = { schema: LIBRARY_PROGRAM_SCHEMA, body: { op: 'call', target: { op: 'arg', index: 0 },
  receiver: { op: 'undefined' }, args: { op: 'array', items: [{ op: 'arg', index: 1 }] } } };
const producer = (callback, value) => callback(value);
const implementation = { producer, sha256: 'unit-fixture', unchanged: () => true,
  context: { source_status: 'ready_for_scoped_proposal', specifier: 'fixture-library', export_name: 'update' } };
const scope = { callbackArguments: [0], resultPaths: null };
async function bank() {
  const result = createLibraryProgramBank({ check: async ({ program: proposed }) => {
    assert.deepEqual(proposed, program);
    return { status: 'passed', stage: 'unit-test-trusted-oracle' };
  } });
  assert.equal((await result.admit({ implementation, program, scope })).status, 'admitted');
  return result;
}
function execute(integration, library) {
  const code = ts.transpileModule(integration.code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {}, sandbox = { exports, require: () => library, [integration.runtimeKey]: integration.runtime };
  vm.runInNewContext(code, sandbox);
  return exports;
}

test('source import aliases use the shared rule and source-stamped callback; shadowed locals do not', async () => {
  const integration = instrumentLibraryPrograms({ bank: await bank(), file: 'sample.ts', source: `
    import { update as transform } from 'fixture-library';
    export const result = transform(value => value + 2, 5);
    export function local(transform) { return transform('local'); }
  ` });
  assert.equal(integration.bindings.length, 1);
  const result = execute(integration, { update: producer });
  assert.equal(result.result, 7);
  assert.equal(result.local(value => value), 'local');
  const reports = integration.runtime.checkpoint();
  assert.equal(reports[0].status, 'observed_agreement', JSON.stringify(reports));
  assert(reports[0].evidence[0].callback.startsWith(integration.bindings[0].id));
});

test('unverified imports, optional calls and a shadowed runtime global remain frontiers', async () => {
  const entries = await bank();
  for (const [source, reason] of [
    [`import { other } from 'fixture-library'; other();`, 'unverified_library_program'],
    [`import { update } from 'fixture-library'; update?.(() => 1);`, 'optional_or_spread_call_requires_adapter'],
    [`import { update } from 'fixture-library'; function run(globalThis) { update(() => 1, 2); }`, 'shadowed_runtime_global'],
  ]) {
    const result = instrumentLibraryPrograms({ source, bank: entries });
    assert.equal(result.bindings.length, 0);
    assert.equal(result.frontiers[0].reason, reason);
  }
});

test('changed runtime export runs normally but cannot inherit the admitted rule', async () => {
  const integration = instrumentLibraryPrograms({ bank: await bank(), source: `import { update } from 'fixture-library'; export const result = update(() => 1, 2);` });
  assert.equal(execute(integration, { update: () => 99 }).result, 99);
  assert.equal(integration.runtime.checkpoint()[0].reason, 'library_runtime_export_identity_changed');
});

test('a saved status or a failed behavior check cannot bypass live bank admission', async () => {
  const rejected = createLibraryProgramBank({ check: async () => ({ status: 'rejected', reason: 'wrong_count' }) });
  assert.equal((await rejected.admit({ implementation, program, scope })).status, 'rejected');
  assert.equal(rejected.lookup('fixture-library', 'update'), null);
  let called = false;
  const format = createLibraryProgramBank({ check: async () => { called = true; return { status: 'passed' }; } });
  assert.equal((await format.admit({ implementation, program: { status: 'verified' }, scope })).stage, 'format');
  assert.equal(called, false);
});

test('nested exports preserve receiver, getter evaluation order, and original argument scope', async () => {
  const entries = createLibraryProgramBank({ check: async () => ({ status: 'passed' }) });
  const nestedProducer = function (callback, value) { return callback(value); };
  await entries.admit({ implementation: { ...implementation, producer: nestedProducer,
    context: { ...implementation.context, export_name: 'Group.update' } }, program, scope });
  for (const importSource of ["import {Group as tools} from 'fixture-library';", "import * as library from 'fixture-library';"]) {
    const target = importSource.includes('*') ? 'library.Group' : 'tools';
    const order = [], group = {};
    Object.defineProperty(group, 'update', { get() { order.push('method'); return nestedProducer; } });
    const library = {};
    Object.defineProperty(library, 'Group', { get() { order.push('group'); return group; } });
    const integration = instrumentLibraryPrograms({ source: `${importSource}
      export function run() { let local = 7; return ${target}.update(value => value, eval('local')); }`, bank: entries });
    assert.equal(integration.bindings.length, 1);
    const result = execute(integration, library);
    assert.equal(result.run(), 7);
    assert.deepEqual(order, ['group', 'method']);
    const report = integration.runtime.checkpoint()[0];
    assert.equal(report.status, 'frontier');
    assert.equal(report.failures[0].reason, 'accessor_input_outside_domain');
    // Getters are evaluated faithfully but remain outside the admitted input
    // domain. The same nested binding with a plain namespace is admissible.
    const plain = instrumentLibraryPrograms({ source: `${importSource}
      export const result = ${target}.update(value => value, 9);`, bank: entries });
    assert.equal(execute(plain, { Group: { update: nestedProducer } }).result, 9);
    assert.equal(plain.runtime.checkpoint()[0].status, 'observed_agreement');
  }
});

test('nested optional members and shadowed namespace roots do not borrow a rule', async () => {
  const entries = createLibraryProgramBank({ check: async () => ({ status: 'passed' }) });
  await entries.admit({ implementation: { ...implementation,
    context: { ...implementation.context, export_name: 'Group.update' } }, program, scope });
  const integration = instrumentLibraryPrograms({ bank: entries, source: `import * as library from 'fixture-library';
    library.Group?.update(() => 1, 1);
    function local(library) { return library.Group.update(() => 1, 1); }` });
  assert.equal(integration.bindings.length, 0);
  assert.equal(integration.frontiers.length, 1);
  assert.equal(integration.frontiers[0].reason, 'optional_or_spread_call_requires_adapter');
});

test('default namespace interop reuses a member rule only for its exact runtime function', async () => {
  const entries=await bank();
  const source="import library from 'fixture-library'; export const result = library.update(value=>value+1, 2);";
  for(const [actual, agrees] of [[producer,true],[(callback,value)=>callback(value+10),false]]) {
    const integration=instrumentLibraryPrograms({source,bank:entries});
    assert.equal(integration.bindings.length,1);
    const exports={};
    const code=ts.transpileModule(integration.code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
    vm.runInNewContext(code,{exports,require:()=>({update:actual}),[integration.runtimeKey]:integration.runtime});
    assert.equal(exports.result,agrees?3:13);
    assert.equal(integration.runtime.checkpoint()[0].status,agrees?'observed_agreement':'frontier');
  }
});

test('a no-op candidate cannot turn off integration callback observations',async()=>{
  const candidate={...program,body:{op:'undefined'}};
  const conditional={...implementation,producer:(callback,enabled)=>{if(enabled)callback();}};
  const probe=createLibraryProgramBank({check:async()=>({status:'passed',stage:'isolated_observer_regression'})});
  assert.equal((await probe.admit({implementation:conditional,program:candidate,scope})).status,'admitted');
  const transformed=instrumentLibraryPrograms({bank:probe,source:"import {update} from 'fixture-library'; export let calls=0; export const result=update(()=>{calls++},true);"});
  const actual=execute(transformed,{update:conditional.producer});assert.equal(actual.calls,1);assert.equal(actual.result,undefined);
  const report=transformed.runtime.checkpoint()[0];assert.equal(report.status,'frontier');assert.equal(report.observation_mode,'invocations');
  assert(report.failures.some(row=>row.reason==='unmodeled_callback_invocation'));
});

test('execution instructions outside a reference-only domain reject before the checker runs',async()=>{
  let checks=0;const entries=createLibraryProgramBank({check:async()=>{checks++;return {status:'passed'}}});
  const result=await entries.admit({implementation,program,scope:{...scope,observationMode:'references'}});
  assert.equal(result.stage,'format');assert.equal(result.reason,'reference_scope_cannot_predict_execution');assert.equal(checks,0);
});

test('returned methods cross instrumented modules without changing factory results',async()=>{
  let original;
  const factory=()=>original=Object.freeze({run:callback=>callback('value')});
  const call={op:'call',target:{op:'arg',index:0},receiver:{op:'undefined'},args:{op:'array',items:[{op:'literal',value:'value'}]}};
  const candidate={schema:LIBRARY_PROGRAM_SCHEMA,body:{op:'freeze',value:{op:'object',entries:{run:{op:'fn',this_mode:'strict',body:call}}}}};
  const entries=createLibraryProgramBank({check:()=>({status:'passed',reason:'unit_fixture'})});
  await entries.admit({implementation:{...implementation,producer:factory,context:{...implementation.context,export_name:'make'}},program:candidate,scope:{callbackArguments:[],resultPaths:null,resultMethods:[{path:['run'],callbackArguments:[0]}]}});
  const factoryModule=instrumentLibraryPrograms({bank:entries,file:'factory.ts',source:"import {make} from 'fixture-library';export const helper=make()"});
  const helper=execute(factoryModule,{make:factory}).helper;assert.equal(helper,original);const method=helper.run;
  const consumer=instrumentLibraryPrograms({bank:entries,file:'consumer.ts',source:'export function consume(helper,callback){return helper.run(callback)}'});
  let calls=0;assert.equal(execute(consumer,{}).consume(helper,value=>{calls++;return value}),'value');assert.equal(calls,1);assert.equal(helper.run,method);
  const reports=consumer.runtime.checkpoint();assert.equal(reports.length,1);assert.equal(reports[0].status,'observed_agreement',JSON.stringify(reports));
  assert.equal(reports[0].evidence.find(row=>row.kind==='returned_method_invocation').invocation_source.file,'consumer.ts');
});

test('ordinary member fallthrough preserves getter order and receiver, including getter failures',async()=>{
  const integrated=instrumentLibraryPrograms({bank:await bank(),source:'export function call(target,arg){return target.run(arg())}'}),run=execute(integrated,{}).call;
  const order=[],target={get run(){order.push('getter');return function(value){assert.equal(this,target);order.push('call');return value}}};
  assert.equal(run(target,()=>{order.push('argument');return 7}),7);assert.deepEqual(order,['getter','argument','call']);
  const error=Error('getter failure');let args=0;assert.throws(()=>run({get run(){throw error}},()=>args++),caught=>caught===error);assert.equal(args,0);
});

test('a shared returned object from distinct source factories remains owner-ambiguous',async()=>{
  const object={run:()=>1},factory=()=>object;
  const candidate={schema:LIBRARY_PROGRAM_SCHEMA,body:{op:'object',entries:{run:{op:'fn',this_mode:'strict',body:{op:'literal',value:1}}}}};
  const entries=createLibraryProgramBank({check:()=>({status:'passed',reason:'unit_fixture'})});
  await entries.admit({implementation:{...implementation,producer:factory,context:{...implementation.context,export_name:'make'}},program:candidate,scope:{callbackArguments:[],resultPaths:null,resultMethods:[{path:['run'],callbackArguments:[]}]}});
  const integrated=instrumentLibraryPrograms({bank:entries,source:"import {make} from 'fixture-library';const first=make();const second=make();export const result=first.run()"});
  assert.equal(execute(integrated,{make:factory}).result,1);
  const reports=integrated.runtime.checkpoint();assert.equal(reports.length,2);assert(reports.every(row=>row.status==='frontier'&&row.failures.some(f=>f.reason==='returned_method_owner_ambiguous')));
});

test('same source text in different modules retains distinct sites and bank-scoped execution', async () => {
  const entries=await bank(),source=`import {update} from 'fixture-library';export const value=update(value=>value,1);`;
  const first=instrumentLibraryPrograms({source,file:'first.ts',bank:entries});
  const second=instrumentLibraryPrograms({source,file:'second.ts',bank:entries});
  const separate=instrumentLibraryPrograms({source,file:'first.ts',bank:await bank()});
  assert.notEqual(first.bindings[0].id,second.bindings[0].id);
  assert.notEqual(first.runtimeKey,second.runtimeKey);
  for(const unit of [first,second,separate])assert.equal(execute(unit,{update:producer}).value,1);
  const events=first.runtime.execution().events;
  assert.equal(events.length,4);assert.deepEqual(events.filter(row=>row.kind==='library_invocation').map(row=>row.source.file),['first.ts','second.ts']);
  assert.equal(second.runtime.execution().events.length,4);assert.equal(separate.runtime.execution().events.length,2);
  assert(events.filter(row=>row.kind==='library_invocation').every(row=>row.parent_id===null));
  assert(!events.some(row=>separate.runtime.execution().events.some(other=>other.id===row.id)));
});
