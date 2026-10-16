import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {compileReactSources} from '../analysis/react-compiler.mjs';
import {createReactRuntimeIntegration} from '../analysis/runtime-join.mjs';
import {createReactScopeObserver} from '../analysis/react-scope-runtime.mjs';
import {getReactBehavior} from '../analysis/react-behavior.mjs';
import {validateReactExecutionRule,planSynchronousScope} from '../analysis/react-execution-rule.mjs';
const packages=Object.fromEntries(['react','react-dom'].map(name=>[name,{version:'18.3.1',verified:true,verification_sha256:`fixture:${name}`} ]));
const source=`import * as React from 'react';import * as DOM from 'react-dom';
function send(value){};export function App(){return <button onClick={()=>DOM.unstable_batchedUpdates(value=>send(value),7)}>send</button>}`;
const map=compileReactSources({'App.tsx':source},{packages});
test('synchronous scope format drives argument forwarding into real source paths',()=>{
  const rule=getReactBehavior({surface:'react-dom',exportName:'unstable_batchedUpdates',version:'18.3.1'}).execution;
  assert.equal(validateReactExecutionRule(rule).valid,true);
  const forbidden=()=>{throw Error('the interpreter must not invoke this');};
  assert.equal(planSynchronousScope(rule,{args:[forbidden,7]}).callback,forbidden);
  assert.deepEqual(planSynchronousScope(rule,{args:[forbidden,7]}).arguments,[7]);
  assert.equal(validateReactExecutionRule({...rule,callback_arguments:[-1]}).valid,false);
  assert.equal(validateReactExecutionRule({...rule,extra:true}).valid,false);
  const edge=map.edges.find(row=>row.relation==='callback_forward');assert.ok(edge);
  assert.ok(map.edges.some(row=>row.relation==='call' && map.nodes.find(node=>node.id===row.to)?.text.startsWith('function send')));
  const transform=createReactRuntimeIntegration(map).instrumentSource('App.tsx',source);
  assert.deepEqual(transform.diagnostics,[]);assert.ok(transform.applied.some(row=>row.transform==='react_scope_call'));
});

test('scope source transforms reject await/yield and spread argument evaluation without changing it',()=>{
  for(const expression of ['React.startTransition(await callback())','React.startTransition(...callbacks)']) {
    const code=`import * as React from 'react';export async function App(){${expression};return null;}`;
    const map=compileReactSources({'App.tsx':code},{packages}),integration=createReactRuntimeIntegration(map);
    assert.ok(integration.bindings.react_lifecycle.frontiers.some(row=>row.reason==='scope_argument_evaluation_unsupported'));
    assert.equal(integration.instrumentSource('App.tsx',code).applied.some(row=>row.transform==='react_scope_call'),false);
  }
});

test('completed scope evidence must match actual callback source, arguments, return, and count',()=>{
  const integration=createReactRuntimeIntegration(map),records=[];
  const entry=integration.bindings.react_lifecycle.entries.find(row=>row.scope_rule);
  const runtime=integration.createApiRuntime({session:'scope-test',onObservation:row=>records.push(row)});
  const value={message:'private'},fn=callback=>callback(value);
  const result=runtime.scopeCall(entry.key,()=>fn(runtime.scopeArgument(entry.key,0,x=>x)));
  // The source supplied a second argument. Missing its observed identity must fail.
  assert.equal(result,value);assert.equal(integration.joinApi(records[0]).reason,'scope_inputs_required');
  runtime.scopeCall(entry.key,()=>((callback,arg)=>callback(arg))(
    runtime.scopeArgument(entry.key,0,x=>x),runtime.scopeArgument(entry.key,1,value)));
  const record=records[1];assert.equal(integration.joinApi(record).status,'resolved');
  const mutate=fn=>{const copy=structuredClone(record);fn(copy.scope);return integration.joinApi(copy);};
  assert.equal(mutate(scope=>scope.callbacks=[]).reason,'scope_callback_count_mismatch');
  assert.equal(mutate(scope=>scope.callbacks.push(scope.callbacks[0])).reason,'scope_callback_count_mismatch');
  assert.equal(mutate(scope=>scope.callbacks[0].source_id='foreign').reason,'scope_callback_source_unproven');
  assert.equal(mutate(scope=>scope.callbacks[0].arguments[0].identity='foreign').reason,'scope_callback_argument_mismatch');
  assert.equal(mutate(scope=>scope.result.identity='foreign').reason,'scope_result_mismatch');
  assert.equal(mutate(scope=>scope.callbacks[0].captured_values=[{binding_id:'foreign'}]).reason,'scope_capture_binding_mismatch');
  assert.equal(integration.joinApi({...record,operation:'threw'}).reason,'scope_api_result_mismatch');
});

test('browser and node use one observer implementation, preserving app errors even if recording fails',()=>{
  const source=fs.readFileSync(new URL('../src/producttrace-runtime.js',import.meta.url),'utf8');
  assert.ok(source.includes(createReactScopeObserver.toString().replaceAll('\n','\n  ')));
  const original={error:'original'};let next=0;
  const observer=createReactScopeObserver({entry:()=>({scope_rule:{callback_argument:0}}),enabled:()=>true,
    id:()=>String(++next),encode:()=>({encoding:'redacted',value:null}),observe:()=>{throw Error('recording failed');}});
  assert.throws(()=>observer.scopeCall('key',()=>{throw original;}),error=>error===original);
  assert.equal(observer.scopeCall('key',()=>7),7);
});


test('stopping observation during a scope keeps the original return without emitting completion',()=>{
  let enabled=true,records=0,next=0;
  const observer=createReactScopeObserver({entry:()=>({scope_rule:{callback_argument:0}}),enabled:()=>enabled,
    id:()=>String(++next),encode:()=>({encoding:'redacted',value:null}),observe:()=>records++});
  assert.equal(observer.scopeCall('key',()=>{enabled=false;return 9;}),9);
  assert.equal(records,0);
});

test('state work sees exact nested scope callback occurrences only during dynamic execution',()=>{
  let next=0,observer;
  const entries={outer:{scope_rule:{kind:'synchronous_scope',callback_argument:0,scheduling:'transition'}},
    inner:{scope_rule:{kind:'synchronous_scope',callback_argument:0,scheduling:'sync_flush'}}};
  observer=createReactScopeObserver({entry:key=>entries[key],enabled:()=>true,id:kind=>`session:${kind}:${++next}`,
    encode:value=>({encoding:['string','number','boolean'].includes(typeof value)||value===null?'primitive':'redacted',
      value:['string','number','boolean'].includes(typeof value)||value===null?value:null}),observe:()=>{}});
  let seen;
  observer.scopeCall('outer',()=>observer.scopeArgument('outer',0,()=>{
    observer.scopeCall('inner',()=>observer.scopeArgument('inner',0,()=>{seen=observer.currentScopes();})());
  })());
  assert.deepEqual(seen.map(row=>row.scheduling),['sync_flush','transition']);
  assert.equal(seen.length,2);assert.notEqual(seen[0].scope_id,seen[1].scope_id);
  assert.ok(seen.every(row=>row.callback_invocation_id.startsWith('session:scope_callback:')));
  assert.deepEqual(observer.currentScopes(),[],'completed callbacks cannot lend a stale scope to later work');
});

const namedSource=`import * as React from 'react';
export function run(pick) {
  'use strict';
  const left=()=>17;
  const selected=pick?left:right;
  React.startTransition(selected);
  return selected;
  function right(){return 23;}
}`;
const namedMap=compileReactSources({'named.ts':namedSource},{packages});

test('named scope sources preserve hoisting, directives, function identity, and conditional selection',()=>{
  const integration=createReactRuntimeIntegration(namedMap),records=[];
  const runtime=integration.createApiRuntime({session:'named',onObservation:row=>records.push(row)});
  const transform=integration.instrumentSource('named.ts',namedSource);
  assert.deepEqual(transform.diagnostics,[]);
  assert.ok(transform.code.includes("'use strict';;"),'the declaration tag follows the directive');
  const context={React:{startTransition:callback=>{callback();}},__productTraceReactLifecycle:runtime};
  vm.createContext(context);
  const code=ts.transpileModule(transform.code.replace("import * as React from 'react';",'').replace('export function','function'),
    {compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
  vm.runInContext(code,context);
  const left=context.run(true),right=context.run(false);
  assert.equal(left.name,'left');assert.equal(left.length,0);assert.equal(left(),17);
  assert.equal(right.name,'right');assert.equal(right(),23);
  assert.equal(runtime.tagSource('extra',left),left,'tagging returns the original function object');
  const origins=records.filter(row=>row.kind==='react_callback_source');assert.equal(origins.length,2);
  const calls=records.filter(row=>row.kind==='react_api');assert.equal(calls.length,2);
  for(const record of calls)assert.equal(integration.joinApi(record).reason,'scope_callback_origin_required');
  for(const origin of origins)assert.equal(integration.joinCallbackSource(origin).status,'resolved');
  for(const record of calls)assert.equal(integration.joinApi(record).status,'resolved');
  const wrongKnownSource=structuredClone(calls[0]);wrongKnownSource.scope.callbacks[0].source_id=origins[1].source_id;
  assert.equal(integration.joinApi(wrongKnownSource).reason,'scope_callback_origin_required');
  const wrongIdentity=structuredClone(calls[0]);wrongIdentity.scope.callbacks[0].callback_identity_id=origins[1].callback_identity_id;
  assert.equal(integration.joinApi(wrongIdentity).reason,'scope_callback_identity_mismatch');
});

test('callback origins require exact indexed source, map, session, evidence, and nonconflicting identity',()=>{
  const integration=createReactRuntimeIntegration(namedMap),records=[];
  const runtime=integration.createApiRuntime({session:'origin',onObservation:row=>records.push(row)});
  const entry=integration.bindings.react_lifecycle.entries.find(row=>row.scope_rule);
  const [first,second]=entry.scope_callback_candidates;assert.ok(first && second);
  const callback=runtime.tagSource(first.source_id,()=>17);
  runtime.scopeCall(entry.key,()=>{runtime.scopeArgument(entry.key,0,callback)();});
  const origin=records.find(row=>row.kind==='react_callback_source');assert.ok(origin);
  const reject=(changes,reason)=>assert.equal(createReactRuntimeIntegration(namedMap).joinCallbackSource({...origin,...changes}).reason,reason);
  reject({runtime_observed:false},'invalid_callback_source_observation');
  reject({map_fingerprint:'other'},'map_fingerprint_mismatch');
  reject({source_id:'not-indexed'},'callback_source_not_indexed');
  for(const change of [{session:'other'},{callback_identity_id:'foreign'},{observation_id:'foreign'},
    {occurrence_id:'foreign'},{evidence_ids:[]}])reject(change,'callback_source_identity_required');
  assert.equal(integration.joinCallbackSource(origin).status,'resolved');
  assert.equal(integration.joinCallbackSource({...origin,source_id:second.source_id}).reason,'callback_source_identity_conflict');
  const anotherId=origin.observation_id+':another';
  assert.equal(integration.joinCallbackSource({...origin,source_id:second.source_id,observation_id:anotherId,
    occurrence_id:anotherId+':occurrence',evidence_ids:[anotherId]}).reason,'callback_source_identity_conflict');
  assert.equal(integration.joinCallbackSource(origin).status,'resolved','replay of the same observation is idempotent');
});

test('mutable local callback bindings resolve through exact runtime function identity',()=>{
  const source=`import * as React from 'react';
export function run(pick) {
  let selected=()=>17;
  if(pick) selected=function chosen(){return 23;};
  React.startTransition(selected);
  return selected;
}`;
  const map=compileReactSources({'mutable.ts':source},{packages}),integration=createReactRuntimeIntegration(map),records=[];
  const entry=integration.bindings.react_lifecycle.entries.find(row=>row.scope_rule);assert.ok(entry);
  assert.equal(entry.scope_callback_candidates.length,2);
  assert.equal(entry.scope_argument_path_incomplete,false);
  const runtime=integration.createApiRuntime({session:'mutable',onObservation:row=>records.push(row)});
  const transform=integration.instrumentSource('mutable.ts',source);assert.deepEqual(transform.diagnostics,[]);
  const context={React:{startTransition:callback=>{callback();}},__productTraceReactLifecycle:runtime};vm.createContext(context);
  const code=ts.transpileModule(transform.code.replace("import * as React from 'react';",'').replace('export function','function'),
    {compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
  vm.runInContext(code,context);
  const initial=context.run(false),assigned=context.run(true);
  assert.equal(initial(),17);assert.equal(assigned(),23);assert.equal(assigned.name,'chosen');
  for(const record of records)integration.onRecord(record);
  const calls=records.filter(row=>row.kind==='react_api');assert.equal(calls.length,2);
  assert.notEqual(calls[0].scope.callbacks[0].source_id,calls[1].scope.callbacks[0].source_id);
  for(const record of calls){const joined=integration.joinApi(record);assert.equal(joined.status,'resolved',JSON.stringify(joined));assert.equal(joined.runtime.scope_proof.argument_branch,'source_candidates');}
});

test('a mixed local and external assignment resolves only the observed local object',()=>{
  const source=`import * as React from 'react';
export function run(external,useExternal) {
  const local=()=>17;
  let selected=local;
  if(useExternal)selected=external;
  React.startTransition(selected);
}`;
  const map=compileReactSources({'mixed.ts':source},{packages}),integration=createReactRuntimeIntegration(map),records=[];
  const entry=integration.bindings.react_lifecycle.entries.find(row=>row.scope_rule);assert.ok(entry);
  assert.equal(entry.scope_callback_candidates.length,1);assert.equal(entry.scope_argument_path_incomplete,true);
  const runtime=integration.createApiRuntime({session:'mixed',onObservation:row=>records.push(row)});
  const transform=integration.instrumentSource('mixed.ts',source);assert.deepEqual(transform.diagnostics,[]);
  const context={React:{startTransition:callback=>{callback();}},__productTraceReactLifecycle:runtime};vm.createContext(context);
  const code=ts.transpileModule(transform.code.replace("import * as React from 'react';",'').replace('export function','function'),
    {compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;vm.runInContext(code,context);
  context.run(()=>29,false);context.run(()=>29,true);
  for(const record of records)integration.onRecord(record);
  const calls=records.filter(row=>row.kind==='react_api');assert.equal(calls.length,2);
  const local=integration.joinApi(calls[0]);assert.equal(local.status,'resolved');assert.equal(local.runtime.scope_proof.argument_branch,'unproven');
  assert.equal(integration.joinApi(calls[1]).reason,'scope_callback_source_unproven');
});

test('mutated, getter-produced, and external callbacks stay unresolved instead of using a plausible definition',()=>{
  for(const [body,knownCandidates] of [
    ['let selected=()=>17; selected=external; React.startTransition(selected);',1],
    ['const object={get callback(){return ()=>17;}}; React.startTransition(object.callback);',0],
    ['React.startTransition(external);',0],
  ]) {
    const source=`import * as React from 'react';export function run(external){${body}}`;
    const map=compileReactSources({'unknown.ts':source},{packages}),integration=createReactRuntimeIntegration(map),records=[];
    const entry=integration.bindings.react_lifecycle.entries.find(row=>row.scope_rule);assert.ok(entry);
    assert.equal(entry.scope_callback_candidates.length,knownCandidates);
    assert.equal(entry.scope_argument_path_incomplete,true);
    const runtime=integration.createApiRuntime({session:'unknown',onObservation:row=>records.push(row)});
    runtime.scopeCall(entry.key,()=>{runtime.scopeArgument(entry.key,0,()=>17)();});
    assert.equal(integration.joinApi(records.at(-1)).reason,'scope_callback_source_unproven');
  }
});

test('source observations are reused per context, refreshed on restart, and cannot replace app behavior on delivery failure',()=>{
  let context='one',next=0,fail=false;const origins=[],scopes=[];
  const observer=createReactScopeObserver({entry:()=>({scope_rule:{callback_argument:0},scope_callback_candidates:[{source_id:'fn'}]}),
    enabled:()=>true,context:()=>context,id:kind=>context+':'+kind+':'+(++next),encode:()=>({encoding:'redacted',value:null}),
    observeOrigin:row=>{if(fail)throw Error('delivery failed');origins.push(row);},observe:(_key,_value,_operation,scope)=>scopes.push(scope)});
  const callback=()=>29;assert.equal(observer.tagSource('fn',callback),callback);
  const run=()=>observer.scopeCall('key',()=>observer.scopeArgument('key',0,callback)());
  assert.equal(run(),29);assert.equal(run(),29);assert.equal(origins.length,1);
  assert.equal(scopes[0].callbacks[0].callback_identity_id,scopes[1].callbacks[0].callback_identity_id);
  context='two';assert.equal(run(),29);assert.equal(origins.length,2);
  assert.notEqual(origins[0].callback_identity_id,origins[1].callback_identity_id);
  context='three';fail=true;assert.equal(run(),29);
  assert.equal(scopes.at(-1).callbacks[0].source_observation_id,null);
  fail=false;assert.equal(run(),29);assert.equal(origins.length,3,'a failed delivery is retried');
});
