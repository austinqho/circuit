import test from 'node:test';
import assert from 'node:assert/strict';
import {getReactBehavior} from '../analysis/react-behavior.mjs';
import {createReactLazyCommitObserver,checkReactLazyCommit} from '../analysis/react-lazy-commit.mjs';

const rule=getReactBehavior({surface:'react',exportName:'lazy',version:'18.3.1'}).execution;
const entry={key:'lazy-entry',source_call_id:'lazy-call',semantic_id:'react/lazy/18.3.1',element_rule:rule};

test('lazy commit observer retains exact Promise settlement and Suspense retry identities',()=>{
 let seq=0;const records=[],lazy={},thenable=Promise.resolve(),module={};function Ready(){}
 const boundary={tag:13},fallback={observation_id:'s:fallback',selection:{selection:'fallback'}},reveal={observation_id:'s:reveal',selection:{selection:'children'}};
 let current=fallback;
 const observer=createReactLazyCommitObserver({context:()=> 's',enabled:()=>true,id:kind=>`s:${kind}:${++seq}`,
  identity:value=>value===Ready?'s:component':'s:value',boundary:()=>current,observe:row=>records.push(row)});
 observer.register(entry,lazy,{operation:'returned',observation_id:'s:allocation',result:{identity:'s:lazy'}});
 observer.loader(entry,lazy,thenable,{observation_id:'s:loader',creation_observation_id:'s:allocation',lazy_identity:'s:lazy',
  result:{identity:'s:promise'},thenable_protocol:'native_promise.v1'},{return:boundary});
 observer.boundaryCommit(boundary,fallback);
 observer.settle(entry,lazy,module,{operation:'loader_fulfilled',observation_id:'s:settlement',creation_observation_id:'s:allocation',
  loader_observation_id:'s:loader',lazy_identity:'s:lazy',thenable_identity:'s:promise',result:{identity:'s:module'}});
 current=reveal;
 observer.commit({elementType:lazy,type:Ready,return:boundary},{root_id:'s:root',instance_id:'s:lazy-fiber',mount_id:'s:lazy-mount',commit_id:'commit-2'});
 assert.equal(records.length,1);assert.equal(records[0].frontier,null);
 assert.equal(records[0].fallback_boundary_commit_observation_id,'s:fallback');
 assert.equal(records[0].reveal_boundary_commit_observation_id,'s:reveal');
 assert.equal(records[0].component_identity,'s:component');
});

test('lazy commit checker requires allocation, loader, settlement and two exact boundary commits',()=>{
 const renderer={root_id:'s:root',instance_id:'s:lazy-fiber',mount_id:'s:lazy-mount',commit_id:'commit-2'};
 const record={schema:'producttrace.react-lazy-commit.v1',kind:'react_lazy_commit',runtime_observed:true,map_fingerprint:'map',session:'s',
  observation_id:'s:commit',occurrence_id:'s:commit:occurrence',evidence_ids:['s:commit'],manifest_key:entry.key,
  source_call_id:entry.source_call_id,semantic_id:entry.semantic_id,allocation_observation_id:'s:allocation',loader_observation_id:'s:loader',
  settlement_observation_id:'s:settlement',lazy_identity:'s:lazy',thenable_identity:'s:promise',module_identity:'s:module',component_identity:'s:component',
  fallback_boundary_commit_observation_id:'s:fallback',reveal_boundary_commit_observation_id:'s:reveal',renderer,frontier:null};
 const allocation={status:'resolved',observation_id:'s:allocation',runtime:{claim:'observed_lazy_allocation',lazy_identity:'s:lazy'}};
 const loader={status:'resolved',observation_id:'s:loader',runtime:{claim:'observed_lazy_loader_completion',outcome:'returned',creation_observation_id:'s:allocation',result:{identity:'s:promise'}}};
 const settlement={status:'resolved',observation_id:'s:settlement',runtime:{claim:'observed_lazy_loader_settlement',outcome:'fulfilled',loader_observation_id:'s:loader',thenable_identity:'s:promise',result:{identity:'s:module'}}};
 const boundary=(observation_id,selection,commit_id)=>({status:'resolved',source:{semantic_id:'react/Suspense/18.3.1'},runtime:{claim:'observed_boundary_input_in_committed_tree',session:'s',observation_id,
  selection:{selection},renderer:{root_id:'s:root',instance_id:'s:boundary',mount_id:'s:boundary-mount',commit_id,tag:13}}});
 const inputs={fingerprint:'map',entry,allocation,loader,settlement,fallback:boundary('s:fallback','fallback','commit-1'),reveal:boundary('s:reveal','children','commit-2')};
 assert.equal(checkReactLazyCommit(record,inputs).status,'resolved');
 const mutations=[
  value=>value.module_identity='s:wrong',value=>value.component_identity='other',value=>value.fallback_boundary_commit_observation_id='s:wrong',
  value=>value.renderer.commit_id='commit-1',value=>value.frontier='lazy_native_promise_settlement_unobserved',
 ];
 for(const mutate of mutations){const bad=structuredClone(record);mutate(bad);assert.equal(checkReactLazyCommit(bad,inputs).status,'unresolved');}
 assert.equal(checkReactLazyCommit(record,{...inputs,settlement:null}).status,'unresolved');
 assert.equal(checkReactLazyCommit(record,{...inputs,reveal:{...inputs.reveal,source:{semantic_id:'react/StrictMode/18.3.1'}}}).status,'unresolved');
});

test('lazy commit observer exposes unsupported and incomplete paths as frontiers',()=>{
 let seq=0;const records=[],lazy={},boundary={tag:13};function Ready(){}
 const observer=createReactLazyCommitObserver({context:()=> 's',enabled:()=>true,id:kind=>`s:${kind}:${++seq}`,
  identity:()=> 's:component',boundary:()=>({observation_id:'s:reveal',selection:{selection:'children'}}),observe:row=>records.push(row)});
 observer.register(entry,lazy,{operation:'returned',observation_id:'s:allocation',result:{identity:'s:lazy'}});
 observer.loader(entry,lazy,{}, {observation_id:'s:loader',creation_observation_id:'s:allocation',lazy_identity:'s:lazy',
  result:{identity:'s:thenable'},settlement_frontier:'lazy_thenable_not_exact_native_promise'},{return:boundary});
 observer.commit({elementType:lazy,type:Ready,return:boundary},{root_id:'s:root',instance_id:'s:fiber',mount_id:'s:mount',commit_id:'commit'});
 assert.equal(records[0].frontier,'lazy_thenable_settlement_unobserved');
});
