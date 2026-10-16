import test from 'node:test';
import assert from 'node:assert/strict';
import {compileReactSources} from '../analysis/react-compiler.mjs';
import {createReactRuntimeIntegration} from '../analysis/runtime-join.mjs';
import {createReactLifecycleEvidenceSession} from '../analysis/react-lifecycle-evidence.mjs';
import {getReactBehavior} from '../analysis/react-behavior.mjs';
import {validateReactExecutionRule,planStateInitialization,planStateUpdate} from '../analysis/react-execution-rule.mjs';
const packages={react:{version:'18.3.1',verified:true,verification_sha256:'fixture'}};
const files={'App.tsx':`import {useState} from 'react';function send(value){}
 export function App({delta}){const [value,setValue]=useState(0);return <button type="button"
 onClick={()=>setValue(previous=>{send(previous);return previous+delta;})}>{value}</button>;}`};
const map=compileReactSources(files,{packages});

test('state programs plan application callbacks without executing them or claiming commits',()=>{
  const state=getReactBehavior({surface:'react',exportName:'useState',version:'18.3.1'}).execution;
  const reducer=getReactBehavior({surface:'react',exportName:'useReducer',version:'18.3.1'}).execution;
  const forbidden=()=>{throw Error('planning must not execute application code');};
  assert.equal(planStateInitialization(state,{args:[forbidden]}).callback,forbidden);
  assert.equal(planStateUpdate(state,{state:1,action:forbidden}).callback,forbidden);
  assert.equal(planStateInitialization(reducer,{args:[forbidden,2,forbidden]}).callback,forbidden);
  const action=()=>7;
  const plan=planStateUpdate(reducer,{state:1,action,reducer:forbidden});
  assert.equal(plan.callback,forbidden);assert.equal(plan.arguments[1],action);
  assert.deepEqual({queue_order:plan.queue_order,priority:plan.priority,commit:plan.commit,
    calculation_error:plan.calculation_error,unmounted_dispatch:plan.unmounted_dispatch},{
    queue_order:'dispatch_order',priority:'lane_rebase',commit:'successful_render_only',
    calculation_error:'propagate_without_commit',unmounted_dispatch:'ignore_without_commit'});
  for(const bad of [{...state,owner:'global'},{...state,comparison:'equal'},{...state,reducer_argument:0},
    {...state,initial_argument:-1},{...state,queue_order:'completion_order'},{...state,priority:'fifo'},
    {...state,dispatch_identity:'per_render'},{...state,commit:'calculation_return'},
    {...state,calculation_error:'commit_previous'},{...state,unmounted_dispatch:'schedule'},
    {...state,strict_mode:'single_call'},{...state,extra:true}])assert.equal(validateReactExecutionRule(bad).valid,false);
});

test('state source paths use a queue boundary and preserve original dispatcher references',()=>{
  const write=map.edges.find(row=>row.relation==='state_write');
  assert.ok(write.updater_source_id);assert.ok(write.updater_captures.length);
  assert.ok(map.edges.some(row=>row.relation==='state_updater' && row.to===write.updater_source_id));
  assert.ok(map.edges.some(row=>row.relation==='call' && map.nodes.find(node=>node.id===row.to)?.text.startsWith('function send')));
  const integration=createReactRuntimeIntegration(map),transformed=integration.instrumentSource('App.tsx',files['App.tsx']);
  assert.deepEqual(transformed.diagnostics,[]);
  assert.ok(transformed.applied.some(row=>row.transform==='react_state_result'));
  assert.ok(transformed.applied.some(row=>row.transform==='react_state_dispatch'));
  const bad=structuredClone(map);bad.react_semantics[0].behavior.execution.kind='unknown';
  assert.equal(createReactRuntimeIntegration(bad).bindings.react_lifecycle.entries.some(row=>row.kind==='state_result'),false);
});

test('state tuple aliases and indexed access keep the same hook queue identity',()=>{
  for(const [name,body] of Object.entries({
    indexed:`const pair=React.useState(0);return <button type="button" onClick={()=>pair[1](value=>value+1)}>{pair[0]}</button>;`,
    destructured:`const pair=React.useState(0);const [value,setValue]=pair;return <button type="button" onClick={()=>setValue(old=>old+1)}>{value}</button>;`,
  })) {
    const source=`import * as React from 'react';export function App(){${body}}`;
    const aliasMap=compileReactSources({[`${name}.tsx`]:source},{packages});
    assert.equal(aliasMap.states.length,1);assert.equal(aliasMap.edges.filter(row=>row.relation==='state_write').length,1);
    assert.equal(aliasMap.edges.filter(row=>row.relation==='state_read').length,1);
    const transformed=createReactRuntimeIntegration(aliasMap).instrumentSource(`${name}.tsx`,source);
    assert.deepEqual(transformed.diagnostics,[]);assert.ok(transformed.applied.some(row=>row.transform==='react_state_result'));
    assert.ok(transformed.applied.some(row=>row.transform==='react_state_dispatch'));
  }
});

test('state calculation proof requires its exact request, owner, updater source, and actual return',()=>{
  const source=map.react_semantics.find(row=>row.export==='useState'),write=map.edges.find(row=>row.relation==='state_write');
  let id=0;const session=createReactLifecycleEvidenceSession(map);
  const record=(operation,extra={})=>({schema:'producttrace.react-lifecycle-observation.v1',kind:'react_lifecycle',
    observation_id:`o${++id}`,occurrence_id:`c${id}`,evidence_ids:[`e${id}`],map_fingerprint:map.fingerprint,
    source_call_id:source.call_id,semantic_id:source.semantic_id,owner_source_id:source.causal_bindings.owner_source_id,
    root_id:'r',instance_id:'a',mount_id:'a',render_id:'render',hook_slot_id:'h',state_identity_id:'state',operation,...extra});
  const emit=(op,extra)=>session.join(record(op,extra));
  assert.equal(emit('render_attempted').status,'resolved');
  assert.equal(emit('state_read',{value:{encoding:'primitive',value:0}}).status,'resolved');
  assert.equal(emit('render_committed').status,'resolved');
  const request={request_id:'request',update_value_id:'action',update_value:{encoding:'redacted',value:null},update_call_id:write.from,update_kind:'functional',callback_source_id:write.updater_source_id};
  assert.equal(emit('state_requested',{...request,state_identity_id:'foreign'}).reason,'state_dispatch_identity_required');
  assert.equal(emit('state_requested',{...request,update_call_id:'foreign'}).reason,'state_update_source_mismatch');
  assert.equal(emit('state_requested',{...request,request_id:'bad-scope',source_scopes:[{
    scope_id:'foreign',callback_invocation_id:'foreign',scheduling:'transition'}]}).reason,'state_source_scope_invalid');
  assert.equal(emit('state_requested',request).status,'resolved');
  assert.equal(emit('state_requested',request).reason,'duplicate_state_request');
  const call={...request,invocation_id:'invoke',pending_state:{encoding:'primitive',value:0}};
  assert.equal(emit('state_calculated',{...call,next_state:{encoding:'primitive',value:1}}).reason,'state_calculation_lineage_mismatch');
  assert.equal(emit('state_updater_invoked',{...call,request_id:'foreign'}).reason,'state_request_lineage_mismatch');
  assert.equal(emit('state_updater_invoked',{...call,update_value_id:'foreign'}).reason,'state_request_lineage_mismatch');
  assert.equal(emit('state_updater_invoked',{...call,callback_source_id:'foreign'}).reason,'state_updater_source_mismatch');
  assert.equal(emit('state_updater_invoked',{...call,captured_values:[{binding_id:'foreign',encoding:'primitive',value:9}]}).reason,'captured_value_binding_mismatch');
  assert.equal(emit('state_updater_invoked',call).status,'resolved');
  const completed=emit('state_calculated',{...call,next_state:{encoding:'primitive',value:1}});
  assert.equal(completed.status,'resolved');assert.equal(completed.runtime.commit_causality,'unproven');
  assert.equal(emit('state_calculated',{...call,next_state:{encoding:'primitive',value:1}}).reason,'state_calculation_lineage_mismatch');
  assert.equal(emit('render_attempted',{instance_id:'b',mount_id:'b',render_id:'other'}).status,'resolved');
  assert.equal(emit('state_requested',{...request,request_id:'foreign-owner',instance_id:'b',mount_id:'b',render_id:'other'}).reason,'state_owner_identity_mismatch');
});

test('state commit proof requires the exact processed request, calculation, state read, and committed render',()=>{
  const source=map.react_semantics.find(row=>row.export==='useState'),write=map.edges.find(row=>row.relation==='state_write');
  const run=(mutate,{duplicate=false}={})=>{
    let id=0;const session=createReactLifecycleEvidenceSession(map);
    const base={schema:'producttrace.react-lifecycle-observation.v1',kind:'react_lifecycle',map_fingerprint:map.fingerprint,
      source_call_id:source.call_id,semantic_id:source.semantic_id,owner_source_id:source.causal_bindings.owner_source_id,
      root_id:'r',instance_id:'a',mount_id:'a',hook_slot_id:'h',state_identity_id:'state'};
    const emit=(operation,render_id,extra={})=>session.join({...base,observation_id:`commit-${++id}`,
      occurrence_id:`commit-occurrence-${id}`,evidence_ids:[`commit-evidence-${id}`],operation,render_id,...extra});
    emit('render_attempted','initial');emit('state_read','initial',{value:{encoding:'primitive',value:0}});emit('render_committed','initial');
    const request={request_id:'request',request_render_id:'initial',processing_render_id:null,
      update_value_id:'action',update_value:{encoding:'redacted',value:null},update_call_id:write.from,
      update_kind:'functional',callback_source_id:write.updater_source_id};
    emit('state_requested','initial',request);emit('render_attempted','next');
    const calculation={...request,processing_render_id:'next',invocation_id:'invoke'};
    emit('state_updater_invoked','next',{...calculation,pending_state:{encoding:'primitive',value:0}});
    emit('state_calculated','next',{...calculation,next_state:{encoding:'primitive',value:1}});
    emit('state_read','next',{value:{encoding:'primitive',value:1}});emit('render_committed','next');
    const commit=mutate({value:{encoding:'primitive',value:1},selection_basis:'processing_render',
      committed_updates:[{request_id:'request',invocation_id:'invoke'}]});
    const result=emit('state_committed','next',commit);
    return duplicate?emit('state_committed','next',commit):result;
  };
  assert.equal(run(value=>value).status,'resolved');
  assert.equal(run(value=>value,{duplicate:true}).reason,'state_request_already_committed');
  for(const mutate of [
    value=>({...value,value:{encoding:'primitive',value:2}}),
    value=>({...value,selection_basis:'unique_eager_result'}),
    value=>({...value,committed_updates:[]}),
    value=>({...value,committed_updates:[{request_id:'foreign',invocation_id:'invoke'}]}),
    value=>({...value,committed_updates:[{request_id:'request',invocation_id:'foreign'}]}),
    value=>({...value,committed_updates:[...value.committed_updates,...value.committed_updates]}),
  ])assert.equal(run(mutate).status,'unresolved');
});

test('a thrown state calculation is recorded but can never satisfy commit proof',()=>{
  const source=map.react_semantics.find(row=>row.export==='useState'),write=map.edges.find(row=>row.relation==='state_write');
  let id=0;const session=createReactLifecycleEvidenceSession(map);
  const emit=(operation,extra={})=>session.join({schema:'producttrace.react-lifecycle-observation.v1',kind:'react_lifecycle',
    observation_id:`failure-${++id}`,occurrence_id:`failure-occurrence-${id}`,evidence_ids:[`failure-evidence-${id}`],
    map_fingerprint:map.fingerprint,source_call_id:source.call_id,semantic_id:source.semantic_id,
    owner_source_id:source.causal_bindings.owner_source_id,root_id:'r',instance_id:'i',mount_id:'m',render_id:'initial',
    hook_slot_id:'h',state_identity_id:'state',operation,...extra});
  emit('render_attempted');emit('state_read',{value:{encoding:'primitive',value:0}});emit('render_committed');
  const request={request_id:'request',update_value_id:'action',update_value:{encoding:'redacted',value:null},
    update_call_id:write.from,update_kind:'functional',callback_source_id:write.updater_source_id};
  emit('state_requested',request);
  const invocation={...request,invocation_id:'invoke',pending_state:{encoding:'primitive',value:0}};
  emit('state_updater_invoked',invocation);
  assert.equal(emit('state_calculation_failed',{...invocation,error:{encoding:'redacted',value:null}}).status,'resolved');
  assert.equal(emit('state_calculated',{...invocation,next_state:{encoding:'primitive',value:1}}).status,'unresolved');
});

test('calculation-chain commit proof rejects reordering and disconnected intermediate values',()=>{
  const source=map.react_semantics.find(row=>row.export==='useState'),write=map.edges.find(row=>row.relation==='state_write');
  const run=({reverse=false,secondPending=2}={})=>{
    const session=createReactLifecycleEvidenceSession(map);let id=0;
    const emit=(operation,render_id,extra={})=>session.join({schema:'producttrace.react-lifecycle-observation.v1',kind:'react_lifecycle',
      observation_id:`chain-${++id}`,occurrence_id:`chain-occurrence-${id}`,evidence_ids:[`chain-evidence-${id}`],
      map_fingerprint:map.fingerprint,source_call_id:source.call_id,semantic_id:source.semantic_id,
      owner_source_id:source.causal_bindings.owner_source_id,root_id:'r',instance_id:'i',mount_id:'m',render_id,
      hook_slot_id:'h',state_identity_id:'state',operation,...extra});
    emit('render_attempted','old');emit('state_read','old',{value:{encoding:'primitive',value:0}});emit('render_committed','old');
    const request=index=>({request_id:`request-${index}`,request_render_id:'old',processing_render_id:null,
      update_value_id:`action-${index}`,update_value:{encoding:'redacted',value:null},update_call_id:write.from,
      update_kind:'functional',callback_source_id:write.updater_source_id});
    for(const [index,pending,next] of [[1,0,2],[2,secondPending,4]]) {
      const row=request(index);emit('state_requested','old',row);
      emit('state_updater_invoked','old',{...row,invocation_id:`invoke-${index}`,pending_state:{encoding:'primitive',value:pending}});
      emit('state_calculated','old',{...row,invocation_id:`invoke-${index}`,next_state:{encoding:'primitive',value:next}});
    }
    emit('render_attempted','new');emit('state_read','new',{value:{encoding:'primitive',value:4}});emit('render_committed','new');
    const updates=[1,2].map(index=>({request_id:`request-${index}`,invocation_id:`invoke-${index}`}));
    return emit('state_committed','new',{value:{encoding:'primitive',value:4},selection_basis:'observed_calculation_chain',
      committed_updates:reverse?updates.reverse():updates});
  };
  assert.equal(run().status,'resolved');
  assert.equal(run({reverse:true}).reason,'state_commit_queue_order_mismatch');
  assert.equal(run({secondPending:3}).reason,'state_commit_calculation_chain_mismatch');
});


test('initializer returns join only their original source hook, render, and value',()=>{
  const initialMap=compileReactSources({'App.tsx':`import {useState} from 'react';
    export function App({seed}){const [value]=useState(()=>seed+1);return <output>{value}</output>;}`},{packages});
  const source=initialMap.react_semantics.find(row=>row.export==='useState');
  const callback=source.causal_bindings.callbacks.find(row=>row.slot==='arguments.0 if function');
  const invalid=structuredClone(initialMap);invalid.react_semantics[0].behavior.execution.owner='global';
  assert.equal(createReactRuntimeIntegration(invalid).bindings.react_lifecycle.entries.some(row=>row.observes_state_initializer),false);
  const session=createReactLifecycleEvidenceSession(initialMap);let next=0;
  const emit=(operation,extra={})=>session.join({schema:'producttrace.react-lifecycle-observation.v1',kind:'react_lifecycle',
    observation_id:`init-${++next}`,occurrence_id:`occurrence-${next}`,evidence_ids:[`e-${next}`],
    map_fingerprint:initialMap.fingerprint,source_call_id:source.call_id,semantic_id:source.semantic_id,
    owner_source_id:source.causal_bindings.owner_source_id,root_id:'root',instance_id:'instance',mount_id:'mount',
    render_id:'render',hook_slot_id:'slot',operation,...extra});
  assert.equal(emit('render_attempted').status,'resolved');
  const produced={production_id:'product',value_id:'value',value:{encoding:'primitive',value:3},caused_by_invocation_id:'call'};
  assert.equal(emit('value_produced',produced).reason,'memo_calculation_invocation_required');
  assert.equal(emit('callback_invoked',{invocation_id:'call',callback_slot:callback.slot,callback_source_id:callback.source_id}).status,'resolved');
  assert.equal(emit('value_produced',produced).status,'resolved');
  assert.equal(emit('value_produced',{...produced,production_id:'second'}).reason,'value_return_already_observed');
  const read={state_identity_id:'state',value:{encoding:'primitive',value:3},initialization_production_id:'product',
    initialization_value_id:'value',initialization_status:'observed_return'};
  assert.equal(emit('state_read',{...read,initialization_production_id:null}).reason,'state_initialization_production_required');
  for(const extra of [{initialization_production_id:'foreign'},{initialization_value_id:'foreign'},
    {value:{encoding:'primitive',value:4}},{initialization_status:'unobserved'},{hook_slot_id:'foreign-slot'}]) {
    assert.equal(emit('state_read',{...read,...extra}).reason,'state_initialization_lineage_mismatch');
  }
  const joined=emit('state_read',read);
  assert.equal(joined.status,'resolved');assert.equal(joined.runtime.initialization_production_id,'product');
  assert.equal(joined.runtime.commit_causality,'unproven');
  assert.equal(emit('render_attempted',{render_id:'next'}).status,'resolved');
  assert.equal(emit('state_read',{...read,render_id:'next'}).reason,'state_initialization_lineage_mismatch');
});
