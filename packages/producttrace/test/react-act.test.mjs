import test from 'node:test';
import assert from 'node:assert/strict';
import {getReactBehavior} from '../analysis/react-behavior.mjs';
import {validateReactExecutionRule,planReactTestScope} from '../analysis/react-execution-rule.mjs';
import {compileReactSources} from '../analysis/react-compiler.mjs';
import {createReactRuntimeIntegration} from '../analysis/runtime-join.mjs';
const rule=getReactBehavior({surface:'react',exportName:'act',version:'18.3.1'}).execution;
const packages={react:{version:'18.3.1',verified:true,verification_sha256:'fixture'}};
const source=`import * as React from 'react';function send(value){return value;}
function App(){return <button type="button" onClick={()=>React.act(()=>send('work'))}>Run</button>;}`;

test('act planning requires a build and keeps queue completion separate from callback invocation',()=>{
  let calls=0;const callback=()=>calls++;
  assert.equal(validateReactExecutionRule(rule).valid,true);
  assert.equal(validateReactExecutionRule({...rule,extra:1}).valid,false);
  assert.equal(validateReactExecutionRule({...rule,callback_arguments:[-1]}).valid,false);
  assert.equal(planReactTestScope(rule,{args:[callback]}).reason,'test_scope_build_required');
  const dev=planReactTestScope(rule,{args:[callback],build:'development'});
  assert.equal(dev.callback,callback);assert.deepEqual(dev.arguments,[]);assert.equal(dev.queue_drain_observed,false);
  assert.equal(planReactTestScope(rule,{args:[callback],build:'production'}).operation,'throw_before_callback');
  assert.equal(calls,0);
  assert.deepEqual(getReactBehavior({surface:'react',exportName:'unstable_act',version:'18.3.1'}).execution,rule);
});

test('act source paths carry the development invocation guard',()=>{
  const map=compileReactSources({'act.tsx':source},{packages});
  const forward=map.edges.find(row=>row.relation==='callback_forward');assert.ok(forward);
  assert.ok(forward.conditions.some(row=>row.text==='Development act invoked its callback'&&row.runtime_observed===false));
  const integration=createReactRuntimeIntegration(map),transformed=integration.instrumentSource('act.tsx',source);
  assert.deepEqual(transformed.diagnostics,[]);assert.ok(transformed.code.includes('.scopeCall('));
});

test('act joins observed callbacks without claiming await or queue completion',()=>{
  const map=compileReactSources({'act.tsx':source},{packages}),integration=createReactRuntimeIntegration(map),records=[];
  const api=integration.createApiRuntime({session:'s',onObservation:row=>records.push(row)});
  const entry=integration.bindings.react_lifecycle.entries.find(row=>row.scope_rule);
  let reads=0;const result={get then(){reads++;throw Error('do not inspect');}};
  const run=callback=>api.scopeCall(entry.key,()=>{const fn=api.scopeArgument(entry.key,0,callback);fn();return result;});
  assert.equal(run(()=>17),result);assert.equal(reads,0);
  const valid=records[0],joined=integration.joinApi(valid);assert.equal(joined.status,'resolved',JSON.stringify(joined));
  assert.equal(joined.runtime.scope_proof.await_completion_observed,false);
  assert.equal(integration.joinApi({...valid,session:'other'}).reason,'scope_session_identity_mismatch');
  const contradictory=structuredClone(valid);contradictory.scope.result.identity=contradictory.scope.inputs[0].identity;
  assert.equal(integration.joinApi(contradictory).reason,'scope_value_identity_conflict');
  const mutations=[row=>{row.scope.callbacks=[];},row=>{row.scope.callbacks.push(row.scope.callbacks[0]);},
    row=>{row.scope.callbacks[0].source_id='other';},row=>{row.scope.callbacks[0].arguments=[row.scope.result];},
    row=>{row.scope.result=row.scope.callbacks[0].result;row.result_kind=row.scope.result.kind;}];
  for(const mutate of mutations){const row=structuredClone(valid);mutate(row);assert.equal(integration.joinApi(row).status,'unresolved');}
  const error={sentinel:true};assert.throws(()=>api.scopeCall(entry.key,()=>api.scopeArgument(entry.key,0,()=>{throw error;})()),value=>value===error);
  assert.equal(integration.joinApi(records.at(-1)).status,'resolved');
  // Without build evidence a pre-callback exception does not prove why it failed.
  assert.throws(()=>api.scopeCall(entry.key,()=>{api.scopeArgument(entry.key,0,()=>17);throw error;}),value=>value===error);
  assert.equal(integration.joinApi(records.at(-1)).reason,'scope_callback_count_mismatch');
});
