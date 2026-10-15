import test from 'node:test';import assert from 'node:assert/strict';
import {compileReactSources} from '../analysis/react-compiler.mjs';
import {createReactRuntimeIntegration} from '../analysis/runtime-join.mjs';
import {getReactBehavior} from '../analysis/react-behavior.mjs';
import {validateReactExecutionRule,planElementPredicate} from '../analysis/react-execution-rule.mjs';
const packages={react:{version:'18.3.1',verified:true,verification_sha256:'fixture:react'}};
const source=`import * as React from 'react';function accept(){}function reject(){}
export function App(){return <button onClick={()=>{if(React.isValidElement(value)){accept();}else{reject();}}}>check</button>}`;

test('element predicate plans expose an ordinary property read without performing it',()=>{
  const rule=getReactBehavior({surface:'react',exportName:'isValidElement',version:'18.3.1'}).execution;
  let reads=0;const input={get $$typeof(){reads++;throw Error('do not run predictions on app getters');}};
  const plan=planElementPredicate(rule,{args:[input]});assert.equal(plan.status,'planned');assert.equal(plan.property,'$$typeof');
  assert.equal(plan.target,input);assert.equal(reads,0);
  assert.equal(planElementPredicate(rule,{args:[null]}).value,false);
  assert.equal(planElementPredicate(rule,{args:[input],propertyRead:{outcome:'returned',value:Symbol.for('react.element')}}).value,true);
  const error={};assert.equal(planElementPredicate(rule,{args:[input],propertyRead:{outcome:'threw',value:error}}).value,error);
  assert.equal(reads,0);
  for(const change of [{extra:true},{argument:-1},{comparison:'loose_equal'},{property_access:'own_descriptor'},
    {result:'object'},{marker_symbol:''}])assert.equal(validateReactExecutionRule({...rule,...change}).valid,false);
});

test('observed predicate results discharge only the exact source condition',()=>{
  const map=compileReactSources({'App.tsx':source},{packages}),integration=createReactRuntimeIntegration(map),records=[];
  const entry=integration.bindings.react_lifecycle.entries.find(row=>row.predicate_rule);assert.ok(entry);
  const runtime=integration.createApiRuntime({session:'predicate',onObservation:row=>records.push(row)});
  assert.equal(runtime.apiResult(entry.key,true),true);assert.equal(runtime.apiResult(entry.key,false),false);
  for(const [index,name] of ['accept','reject'].entries()) {
    const joined=integration.joinApi(records[index]);assert.equal(joined.status,'resolved');
    const proof=joined.runtime.predicate_proof;assert.equal(proof.frontier,null);
    assert.ok(proof.candidates.some(edge=>map.nodes.find(node=>node.id===edge.to)?.text.startsWith('function '+name)));
    assert.ok(!proof.candidates.some(edge=>map.nodes.find(node=>node.id===edge.to)?.text.startsWith('function '+(index?'accept':'reject'))));
    assert.ok(proof.candidates.every(edge=>edge.target_execution_observed===false));
  }
  for(const predicate_result of [undefined,{encoding:'redacted',value:null},{encoding:'primitive',value:'true'}])
    assert.equal(integration.joinApi({...records[0],predicate_result}).reason,'predicate_boolean_result_required');
  assert.equal(integration.joinApi({...records[0],map_fingerprint:'other'}).reason,'map_fingerprint_mismatch');
});

test('nested guards remain conditional and mutable or captured aliases do not select a source branch',()=>{
  for(const [body,frontier] of [
    ['if(ready){if(React.isValidElement(value))accept();}',false],
    ['let valid=React.isValidElement(value);valid=other;if(valid)accept();',true],
    ['const valid=React.isValidElement(value);const later=()=>{if(valid)accept();};later();',true],
  ]) {
    const map=compileReactSources({'App.tsx':`import * as React from 'react';function accept(){}export function App(){return <button onClick={()=>{${body}}}>check</button>}`},{packages});
    const integration=createReactRuntimeIntegration(map),entry=integration.bindings.react_lifecycle.entries.find(row=>row.predicate_rule),records=[];
    integration.createApiRuntime({onObservation:row=>records.push(row)}).apiResult(entry.key,true);
    const proof=integration.joinApi(records[0]).runtime.predicate_proof;
    assert.equal(Boolean(proof.frontier),frontier);
    if(!frontier)assert.ok(proof.candidates.every(edge=>edge.remaining_conditions.some(condition=>condition.text==='ready')));
  }
});

test('local immutable result aliases and boolean negation retain the correct branch polarity',()=>{
  for(const expression of ['valid','!valid','!!valid']) {
    const map=compileReactSources({'App.tsx':`import * as React from 'react';function accept(){}function reject(){}
      export function App(){return <button onClick={()=>{const original=React.isValidElement(value);const valid=original;
        if(${expression})accept();else reject();}}>check</button>}`},{packages});
    const integration=createReactRuntimeIntegration(map),entry=integration.bindings.react_lifecycle.entries.find(row=>row.predicate_rule),records=[];
    const runtime=integration.createApiRuntime({onObservation:row=>records.push(row)});
    for(const value of [true,false]) {
      runtime.apiResult(entry.key,value);const proof=integration.joinApi(records.at(-1)).runtime.predicate_proof;
      const selected=(expression==='!valid'?!value:value)?'accept':'reject';
      assert.equal(proof.frontier,null);
      assert.ok(proof.candidates.some(edge=>map.nodes.find(node=>node.id===edge.to)?.text.startsWith('function '+selected)));
      assert.ok(!proof.candidates.some(edge=>map.nodes.find(node=>node.id===edge.to)?.text.startsWith('function '+(selected==='accept'?'reject':'accept'))));
    }
  }
});

test('predicate call outcomes preserve errors and require completed argument evidence',()=>{
  const map=compileReactSources({'App.tsx':source},{packages}),integration=createReactRuntimeIntegration(map),records=[];
  const entry=integration.bindings.react_lifecycle.entries.find(row=>row.predicate_rule);
  const runtime=integration.createApiRuntime({session:'predicate-errors',onObservation:row=>records.push(row)});
  const run=(input,invoke)=>runtime.scopeCall(entry.key,()=>invoke(runtime.scopeArgument(entry.key,0,input)));
  assert.equal(run(null,()=>false),false);
  const guard=records.at(-1);assert.equal(integration.joinApi(guard).runtime.predicate_proof.marker_read_required,false);
  const wrongGuard=structuredClone(guard);wrongGuard.scope.result.value=true;wrongGuard.scope.result.truthy=true;wrongGuard.predicate_result.value=true;
  assert.equal(integration.joinApi(wrongGuard).reason,'predicate_guard_outcome_mismatch');
  const error={original:true};assert.throws(()=>run({},()=>{throw error;}),value=>value===error);
  const thrown=records.at(-1),proof=integration.joinApi(thrown).runtime.predicate_proof;
  assert.equal(proof.outcome,'threw');assert.deepEqual(proof.candidates,[]);assert.equal(proof.exception.identity,thrown.scope.result.identity);
  assert.equal(integration.joinApi({...thrown,scope:undefined}).reason,'predicate_call_completion_required');
  assert.equal(integration.joinApi({...thrown,operation:'invoked'}).reason,'predicate_call_outcome_mismatch');
  assert.throws(()=>runtime.scopeCall(entry.key,()=>{throw error;}),value=>value===error);
  assert.equal(integration.joinApi(records.at(-1)).reason,'predicate_argument_evaluation_failed');
  assert.equal(run({},()=>true),true);
  const returned=records.at(-1),wrongResult=structuredClone(returned);wrongResult.predicate_result.value=false;
  assert.equal(integration.joinApi(wrongResult).reason,'predicate_boolean_result_required');
  const wrongInput=structuredClone(returned);wrongInput.scope.inputs[2]=wrongInput.scope.inputs[0];
  assert.equal(integration.joinApi(wrongInput).reason,'predicate_inputs_required');
  const revoked=Proxy.revocable({},{});revoked.revoke();
  assert.throws(()=>run({},()=>{throw revoked.proxy;}),error=>error===revoked.proxy);
  assert.equal(integration.joinApi(records.at(-1)).runtime.predicate_proof.outcome,'threw');
});

test('predicate await and spread inputs retain ordinary results with an explicit error-observation frontier',()=>{
  for(const argument of ['await value','...values']) {
    const code=`import * as React from 'react';export async function run(){return React.isValidElement(${argument});}`;
    const integration=createReactRuntimeIntegration(compileReactSources({'input.ts':code},{packages}));
    assert.ok(integration.bindings.react_lifecycle.frontiers.some(row=>row.reason==='predicate_argument_evaluation_unsupported'));
    const transformed=integration.instrumentSource('input.ts',code);
    assert.ok(transformed.applied.some(row=>row.transform==='react_api_call'));
    assert.ok(!transformed.applied.some(row=>row.transform==='react_scope_call'));
  }
});
