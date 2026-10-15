import test from 'node:test';import assert from 'node:assert/strict';
import {getReactBehavior} from '../analysis/react-behavior.mjs';
import {createReactBoundaryCommitObserver,selectReactBoundaryCommit,checkReactBoundaryCommit,predictReactFragmentIdentity} from '../analysis/react-boundary-commit.mjs';
const rules=Object.fromEntries(['Fragment','StrictMode','Profiler','Suspense'].map(name=>[name,getReactBehavior({surface:'react',exportName:name,version:'18.3.1'}).execution]));

test('boundary rules interpret observed selection and mode without inventing callbacks',()=>{
 const snapshot={tag:13,mode:1,has_state:false,dehydrated:false};
 assert.equal(selectReactBoundaryCommit(rules.Suspense,snapshot).selection,'children');
 assert.equal(selectReactBoundaryCommit(rules.Suspense,{...snapshot,has_state:true}).selection,'fallback');
 assert.equal(selectReactBoundaryCommit(rules.Suspense,{...snapshot,has_state:true,dehydrated:true}).selection,'dehydrated');
 assert.equal(selectReactBoundaryCommit(rules.Fragment,snapshot),null);
 const strict=selectReactBoundaryCommit(rules.StrictMode,{...snapshot,tag:8,mode:25});
 assert.equal(strict.strict_render_mode,true);assert.equal(strict.strict_effect_mode,true);
 assert.equal(selectReactBoundaryCommit(rules.StrictMode,{...snapshot,tag:8,mode:8}).strict_effect_mode,false);
});

test('boundary matching keeps source input identity, keys, ambiguous origins and sessions',()=>{
 let context='s',enabled=true,seq=0;const records=[];
 const observer=createReactBoundaryCommitObserver({context:()=>context,enabled:()=>enabled,id:()=>context+':'+(++seq),select:selectReactBoundaryCommit,observe:row=>records.push(row)});
 const entry={key:'source',boundary_rule:rules.Fragment},child={};
 const element=key=>({$$typeof:Symbol.for('react.element'),type:Symbol.for('react.fragment'),props:{children:child},key});
 const first=observer.created(entry,element('a'),'s:first');observer.created(entry,element('b'),'s:second');
 const fiber={tag:7,mode:1,memoizedProps:child,memoizedState:null,key:'a'},identity={root_id:'root',instance_id:'instance',mount_id:'mount',commit_id:'commit'};
 observer.begin('root','commit');
 observer.commit({...fiber,memoizedProps:{}},identity);observer.commit({...fiber,key:'unknown'},identity);assert.equal(records.length,0);
 observer.commit(fiber,identity);assert.equal(records.length,1);assert.equal(records[0].origin_observation_id,'s:first');assert.equal(records[0].input_identity,first.identity);
 observer.commit(fiber,identity);assert.equal(records.length,1);
 assert.equal(observer.ancestry({return:fiber}).length,1);
 observer.begin('root','later');assert.equal(observer.ancestry({return:fiber}).length,0);
 observer.created(entry,element('a'),'s:duplicate');observer.commit(fiber,{...identity,commit_id:'later'});
 assert.equal(records.length,3);assert(records.slice(1).every(row=>row.frontier==='boundary_input_origin_ambiguous'));
 assert.equal(observer.created(entry,{...element(null),props:{children:'text'}},'s:text').frontier,'boundary_reference_input_required');
 context='new';observer.commit(fiber,{...identity,commit_id:'new'});assert.equal(records.length,3);
 enabled=false;observer.created(entry,element('a'),'new:stopped');observer.commit(fiber,identity);assert.equal(records.length,3);
 let getter=0;enabled=true;observer.created(entry,{...element(null),get props(){getter++;return {}; }},'new:getter');assert.equal(getter,0);
});

test('render attempts resolve the exact nearest Suspense source before it commits',()=>{
 let context='s',seq=0;const observer=createReactBoundaryCommitObserver({context:()=>context,enabled:()=>true,
  id:()=>`s:${++seq}`,select:selectReactBoundaryCommit,identify:()=>({root_id:'root',instance_id:'boundary',mount_id:'boundary-mount'}),observe:()=>{}});
 const entry={key:'suspense-source',source_call_id:'suspense-call',semantic_id:'react/Suspense/18.3.1',boundary_rule:rules.Suspense};
 const child={},props={children:child,fallback:'waiting'};
 const element={$$typeof:Symbol.for('react.element'),type:Symbol.for('react.suspense'),props,key:null};
 const created=observer.created(entry,element,'s:created');
 const boundary={tag:13,key:null,pendingProps:props,memoizedProps:props,return:null};
 const attempt={tag:0,return:boundary};
 const found=observer.renderBoundary(attempt);
 assert.deepEqual({...found,fiber:undefined},{fiber:undefined,origin_observation_id:'s:created',manifest_key:'suspense-source',
  source_call_id:'suspense-call',semantic_id:'react/Suspense/18.3.1',input_identity:created.identity,
  renderer:{root_id:'root',instance_id:'boundary',mount_id:'boundary-mount'},previous_commit:null});
 const nested={tag:13,key:null,pendingProps:{children:{}},return:boundary};
 assert.equal(observer.renderBoundary({return:nested}).frontier,'suspense_render_origin_unresolved');
 assert.equal(observer.renderBoundary({return:null}),null);
 observer.created(entry,element,'s:duplicate');
 assert.equal(observer.renderBoundary(attempt).frontier,'suspense_render_origin_unresolved');
});

test('boundary joins require an admitted original input and rule-consistent renderer receipt',()=>{
 const entry={key:'source',source_call_id:'call',semantic_id:'react/Suspense/18.3.1',boundary_rule:rules.Suspense};
 const origin={session:'s',observation_id:'s:created',manifest_key:'source',operation:'element_created',boundary_input:{identity:'s:input',field:'props'}};
 const renderer={root_id:'root',instance_id:'instance',mount_id:'mount',commit_id:'commit',tag:13,mode:1,has_state:true,dehydrated:false};
 const row={schema:'producttrace.react-boundary-commit.v1',kind:'react_boundary_commit',runtime_observed:true,map_fingerprint:'map',session:'s',
  observation_id:'s:commit',occurrence_id:'s:commit:occurrence',evidence_ids:['s:commit'],manifest_key:'source',source_call_id:'call',semantic_id:entry.semantic_id,
  origin_observation_id:'s:created',input_identity:'s:input',renderer,selection:selectReactBoundaryCommit(rules.Suspense,renderer)};
 const check=(value,previous=origin)=>checkReactBoundaryCommit(value,previous,entry,{fingerprint:'map'});
 assert.equal(check(row).status,'resolved');assert.equal(check(row).runtime.descendant_callback_execution_proven,false);
 for(const mutate of [value=>value.session='other',value=>value.input_identity='s:other',value=>value.renderer.tag=8,
  value=>value.renderer.has_state=false,value=>value.selection.selection='children',value=>value.source_call_id='other']){
  const bad=structuredClone(row);mutate(bad);assert.equal(check(bad).status,'unresolved');
 }
 assert.equal(check(row,null).status,'unresolved');
});

test('Fragment identity rules require the same parent, type and keyed or unkeyed slot',()=>{
 const row={root_id:'r',parent_instance_id:'p',parent_mount_id:'m',tag:7,key:'a',index:0};
 const predict=(before,after)=>predictReactFragmentIdentity(rules.Fragment,before,after)?.retains;
 assert.equal(predict(row,{...row,index:1}),true);
 for(const change of [{key:'b'},{tag:8},{parent_mount_id:'new'},{parent_instance_id:'other'},{root_id:'other'}])assert.equal(predict(row,{...row,...change}),false);
 assert.equal(predict({...row,key:null},{...row,key:null,index:1}),false);
 assert.equal(predict({...row,key:null},{...row,key:null}),true);
 assert.equal(predict(null,row),undefined);
});
