import test from 'node:test';
import assert from 'node:assert/strict';
import {getReactBehavior} from '../analysis/react-behavior.mjs';
import {validateReactExecutionRule, predictRetainedCallback} from '../analysis/react-execution-rule.mjs';
import {compileReactSources} from '../analysis/react-compiler.mjs';
import {createReactRuntimeIntegration} from '../analysis/runtime-join.mjs';
import {createReactLifecycleEvidenceSession} from '../analysis/react-lifecycle-evidence.mjs';

const rule=getReactBehavior({surface:'react',exportName:'useCallback',version:'18.3.1'}).execution;
test('executable rule format rejects unknown or contradictory semantics',()=>{
  assert.deepEqual(validateReactExecutionRule(rule),{valid:true,reason:null});
  for(const mutant of [null,{...rule,kind:'unknown'},{...rule,comparison:'deep_equal'},
    {...rule,owner:'global'},{...rule,callback_argument:1},{...rule,dependencies_argument:-1},
    {...rule,notes:'ignore failures'},{...rule,schema:'future'}]) assert.equal(validateReactExecutionRule(mutant).valid,false);
  const a=()=>0,b=()=>1;
  assert.equal(predictRetainedCallback(rule,{args:[b,[NaN]],previous:{callback:a,dependencies:[NaN]}}).callback,a);
  assert.equal(predictRetainedCallback(rule,{args:[b,[0]],previous:{callback:a,dependencies:[-0]}}).callback,b);
  assert.equal(predictRetainedCallback(rule,{args:[b,[]],previous:{callback:a,dependencies:[]},cacheAvailable:false}).callback,b);
  assert.equal(predictRetainedCallback(rule,{args:[b,[0]],previous:{callback:a,dependencies:[]}}).reason,'dependency_arity_changed');
});

const packages={react:{version:'18.3.1',verified:true,verification_sha256:'fixture-source'}};
const files={'App.tsx':`import {useCallback} from 'react';
  export function App({value}) {const retained=useCallback(()=>value,[value]);return <button onClick={retained}>Run</button>;}`};
const map=compileReactSources(files,{packages});
const semantic=map.react_semantics.find(row=>row.export==='useCallback');
const slot=semantic.causal_bindings.callbacks[0];

test('source transformation consumes a valid rule and fails closed on an unknown instruction',()=>{
  const integration=createReactRuntimeIntegration(map);
  assert.ok(integration.bindings.react_lifecycle.entries.some(row=>row.kind==='retained_callback'));
  const mutated=structuredClone(map);
  mutated.react_semantics.find(row=>row.export==='useCallback').behavior.execution.kind='unknown';
  assert.equal(createReactRuntimeIntegration(mutated).bindings.react_lifecycle.entries.some(row=>row.kind==='retained_callback'),false);
  assert.match(integration.instrumentSource('App.tsx',files['App.tsx']).code,/defineCallback/);
});

test('retained invocation must use its creation render and owning mount',()=>{
  let sequence=0;
  const observation=(operation,extra={})=>({schema:'producttrace.react-lifecycle-observation.v1',kind:'react_lifecycle',
    observation_id:`o${++sequence}`,occurrence_id:`c${sequence}`,evidence_ids:[`e${sequence}`],
    map_fingerprint:map.fingerprint,source_call_id:semantic.call_id,semantic_id:semantic.semantic_id,
    owner_source_id:semantic.causal_bindings.owner_source_id,root_id:'r',instance_id:'a',mount_id:'a',render_id:'old',
    hook_slot_id:'h',operation,...extra});
  const session=createReactLifecycleEvidenceSession(map);
  const binding={callback_slot:slot.slot,callback_source_id:slot.source_id,callback_identity_id:'retained-a'};
  for(const extra of [{},{instance_id:'b',mount_id:'b'},{render_id:'new'}]) {
    assert.equal(session.join(observation('render_attempted',extra)).status,'resolved');
    assert.equal(session.join(observation('render_committed',extra)).status,'resolved');
  }
  assert.equal(session.join(observation('callback_created',binding)).status,'resolved');
  assert.equal(session.join(observation('callback_selected',{...binding,render_id:'new',origin_render_id:'old'})).status,'resolved');
  const invocation={...binding,invocation_id:'i'};
  assert.equal(session.join(observation('callback_invoked',{...invocation,render_id:'new'})).reason,'callback_origin_render_mismatch');
  assert.equal(session.join(observation('callback_invoked',{...invocation,instance_id:'b',mount_id:'b'})).reason,'callback_identity_lineage_mismatch');
  assert.equal(session.join(observation('callback_selected',{...binding,origin_render_id:'new'})).reason,'callback_origin_render_mismatch');
  assert.equal(session.join(observation('callback_invoked',{...invocation,captured_values:[{binding_id:'foreign',encoding:'primitive',value:1}]})).reason,'captured_value_binding_mismatch');
  assert.equal(session.join(observation('callback_invoked',{...invocation,callback_identity_id:undefined})).reason,'callback_identity_required');
  assert.equal(session.join(observation('callback_invoked',invocation)).status,'resolved');
  assert.equal(session.join(observation('callback_created',binding)).reason,'duplicate_callback_identity');
});


test('reassigned callbacks retain explicit ownership frontiers',()=>{
  for (const [body,reason] of [
    ["let callback=()=>value;callback=other;const a=useCallback(callback,[]);",'retained_callback_source_shape_unsupported'],
  ]) {
    const sources={'App.tsx':`import {useCallback} from 'react';export function App({value,other}){${body}return null;}`};
    const integration=createReactRuntimeIntegration(compileReactSources(sources,{packages}));
    assert.equal(integration.bindings.react_lifecycle.entries.some(row=>row.kind==='retained_callback'),false);
    assert.ok(integration.bindings.react_lifecycle.frontiers.some(row=>row.reason===reason));
  }
});


test('escaped retained callbacks do not turn abandoned or unmounted owners into commits',()=>{
  for(const phase of ['abandoned','unmounted']) {
    const session=createReactLifecycleEvidenceSession(map);let id=0;
    const emit=(operation,extra={})=>session.join({schema:'producttrace.react-lifecycle-observation.v1',kind:'react_lifecycle',
      observation_id:`${phase}:${++id}`,occurrence_id:`o${id}`,evidence_ids:[`e${id}`],
      map_fingerprint:map.fingerprint,source_call_id:semantic.call_id,semantic_id:semantic.semantic_id,
      owner_source_id:semantic.causal_bindings.owner_source_id,root_id:'r',instance_id:'a',mount_id:'a',render_id:'attempt',
      hook_slot_id:'h',operation,...extra});
    const binding={callback_slot:slot.slot,callback_source_id:slot.source_id,callback_identity_id:'escaped'};
    assert.equal(emit('render_attempted').status,'resolved');
    assert.equal(emit('callback_created',binding).status,'resolved');
    if(phase==='unmounted') assert.equal(emit('render_committed').status,'resolved');
    assert.equal(emit(phase==='abandoned'?'render_abandoned':'unmounted').status,'resolved');
    const invoked=emit('callback_invoked',{...binding,invocation_id:'late'});
    assert.equal(invoked.status,'resolved');
    assert.equal(invoked.runtime.owner_lifecycle,phase);
    assert.equal(invoked.runtime.committed_execution,false);
  }
});

test('effect programs have explicit, validated phase and rehearsal instructions',()=>{
  for(const api of ['useEffect','useLayoutEffect','useInsertionEffect']) {
    const effect=getReactBehavior({surface:'react',exportName:api,version:'18.3.1'}).execution;
    assert.equal(validateReactExecutionRule(effect).valid,true);
    assert.equal(validateReactExecutionRule({...effect,phase:'whenever'}).valid,false);
    assert.equal(validateReactExecutionRule({...effect,strict_mount_rehearsal:'yes'}).valid,false);
    assert.equal(predictRetainedCallback(effect,{args:[()=>0,[]]}).reason,'wrong_rule_kind');
  }
});


test('literal export programs describe a checked read without invented callbacks or scheduling',()=>{
  const rule={schema:'producttrace.react-execution-rule.v1',kind:'literal_export',values:{development:'18.3.1',production:'18.3.1'},callbacks:'none',scheduling:'none'};
  assert.equal(validateReactExecutionRule(rule).valid,true);
  for(const wrong of [{...rule,scheduling:'render'},{...rule,callbacks:['execute']},{...rule,values:{development:()=>1,production:()=>1}},{...rule,extra:1}]) {
    assert.equal(validateReactExecutionRule(wrong).valid,false);
  }
});
