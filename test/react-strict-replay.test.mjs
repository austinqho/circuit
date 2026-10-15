import test from 'node:test';
import assert from 'node:assert/strict';
import {createReactStrictReplayObserver,checkReactStrictReplay} from '../analysis/react-strict-replay.mjs';
import {getReactBehavior} from '../analysis/react-behavior.mjs';

test('renderer replay brackets preserve nesting, unknown scopes and session boundaries',()=>{
  let context='s',enabled=true,current={name:'owner'},serial=0;
  const records=[],owner={root_id:'root',instance_id:'owner',mount_id:'mount'};
  const boundary={entry:{key:'entry',source_call_id:'call',semantic_id:'react/StrictMode/18.3.1'},origin:'s:origin',input_identity:'s:input',identity:owner};
  const renderer={rendererPackageName:'react-dom',bundleType:1,version:'18.3.1',getCurrentFiber:()=>current};
  const observer=createReactStrictReplayObserver({context:()=>context,enabled:()=>enabled,id:label=>`${context}:${label}:${++serial}`,
    renderer:()=>renderer,identity:()=>owner,boundary:fiber=>fiber.unknown?null:boundary,observe:row=>records.push(row)});
  const first=current;observer.signal(1,true);assert.equal(observer.current(first),records[0].observation_id);
  current={unknown:true};observer.signal(1,true);assert.equal(observer.current(first),null);
  observer.signal(1,false);assert.equal(observer.current(first),records[0].observation_id,'an unknown nested bracket must not close the outer one');
  current=first;observer.signal(1,false);assert.equal(observer.current(first),null);assert.equal(records.length,2);
  assert.equal(records[1].replay_id,records[0].observation_id);
  renderer.bundleType=0;observer.signal(1,true);assert.equal(observer.current(first),null);observer.signal(1,false);assert.equal(records.length,2);
  renderer.bundleType=1;observer.signal(1,true);context='next';assert.equal(observer.current(first),null);
  observer.signal(1,false);assert.equal(records.length,3);
  enabled=false;observer.signal(1,true);assert.equal(records.length,3);
});

test('strict replay evidence requires its exact creation, renderer and start receipt',()=>{
  const rule=getReactBehavior({surface:'react',exportName:'StrictMode',version:'18.3.1'}).execution;
  const entry={key:'entry',source_call_id:'call',semantic_id:'react/StrictMode/18.3.1',boundary_rule:rule};
  const origin={session:'s',observation_id:'s:origin',manifest_key:'entry',operation:'element_created',boundary_input:{identity:'s:input',field:'props'}};
  const row={schema:'producttrace.react-strict-replay.v1',kind:'react_strict_replay',runtime_observed:true,map_fingerprint:'map',session:'s',
    observation_id:'s:start',occurrence_id:'s:start:occurrence',evidence_ids:['s:start'],operation:'started',manifest_key:'entry',source_call_id:'call',
    semantic_id:entry.semantic_id,origin_observation_id:'s:origin',input_identity:'s:input',
    owner:{root_id:'root',instance_id:'owner',mount_id:'owner-mount'},boundary:{root_id:'root',instance_id:'boundary',mount_id:'boundary-mount',tag:8,mode:25},
    renderer:{id:1,version:'18.3.1',package:'react-dom',bundle_type:1}};
  const options={fingerprint:'map',entry,origin},start=checkReactStrictReplay(row,options);assert.equal(start.status,'resolved');
  const end={...row,observation_id:'s:end',occurrence_id:'s:end:occurrence',evidence_ids:['s:end'],operation:'finished',replay_id:'s:start'};
  assert.equal(checkReactStrictReplay(end,{...options,start}).status,'resolved');
  assert.equal(checkReactStrictReplay(end,options).status,'unresolved');
  for(const change of [{renderer:{...row.renderer,id:2}},{replay_id:'s:other'},{owner:{...row.owner,instance_id:'other'}}])
    assert.equal(checkReactStrictReplay({...end,...change},{...options,start}).status,'unresolved');
  for(const change of [{session:'other'},{operation:'guessed'},{input_identity:'s:wrong'},{boundary:{...row.boundary,mode:0}},
    {renderer:{...row.renderer,version:'19.0.0'}},{renderer:{...row.renderer,bundle_type:0}}])
    assert.equal(checkReactStrictReplay({...row,...change},options).status,'unresolved');
  assert.equal(start.runtime.effect_rehearsal_proven,false);
});
