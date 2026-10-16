import test from 'node:test';
import assert from 'node:assert/strict';
import {createReactPortalCommitObserver,checkReactPortalCommit} from '../analysis/react-portal-commit.mjs';
import {getReactBehavior} from '../analysis/react-behavior.mjs';

const rule=getReactBehavior({surface:'react-dom',exportName:'createPortal',version:'18.3.1'}).execution;
function harness(){
 const records=[];let n=0;
 const entry={key:'entry',source_call_id:'call',semantic_id:'react-dom/createPortal/18.3.1',portal_rule:rule};
 const observer=createReactPortalCommitObserver({context:()=> 's',enabled:()=>true,id:kind=>`s:${kind}:${++n}`,observe:record=>records.push({...record,session:'s',map_fingerprint:'map',occurrence_id:record.observation_id+':occurrence',evidence_ids:[record.observation_id]})});
 const children={},container={},description={observation_id:'s:portal:1',operation:'returned',inputs:{0:{identity:'s:child'},1:{identity:'s:container'}}};
 const portal={$$typeof:Symbol.for('react.portal'),children,containerInfo:container,key:'key'};
 const fiber={tag:4,key:'key',memoizedProps:children,stateNode:{containerInfo:container},return:null,alternate:null};
 const identity={root_id:'root',instance_id:'instance',mount_id:'mount',commit_id:'commit'};
 observer.register(entry,portal,description,[children,container,'key']);observer.begin('root','commit');observer.commit(fiber,identity);
 const origin={...description,session:'s',manifest_key:'entry'};
 return {records,observer,entry,origin,fiber,identity};
}

test('portal commit requires the exact children, container, key and description occurrence',()=>{
 const h=harness();assert.equal(h.records.length,1);assert.equal(h.observer.ancestry(h.fiber)[0].observation_id,h.records[0].observation_id);
 const result=checkReactPortalCommit(h.records[0],h.origin,h.entry,{fingerprint:'map'});assert.equal(result.status,'resolved');
 for(const patch of [{children_identity:'s:other'},{container_identity:'s:other'},{operation:'unmounted'},{frontier:'ambiguous'},
   {renderer:{...h.records[0].renderer,tag:5}},{session:'other'},{map_fingerprint:'other'}])
  assert.equal(checkReactPortalCommit({...h.records[0],...patch},h.origin,h.entry,{fingerprint:'map'}).status,'unresolved');
});

test('portal unmount must refer to an accepted prior commit',()=>{
 const h=harness(),commit=checkReactPortalCommit(h.records[0],h.origin,h.entry,{fingerprint:'map'});h.observer.unmount(h.fiber);
 assert.equal(h.records.length,2);const unmount=h.records[1];
 const accepted=checkReactPortalCommit(unmount,h.origin,h.entry,{fingerprint:'map',resolveCommit:id=>id===h.records[0].observation_id?commit:null});
 assert.equal(accepted.status,'resolved');assert.equal(accepted.runtime.claim,'observed_portal_unmounted');
 assert.equal(checkReactPortalCommit(unmount,h.origin,h.entry,{fingerprint:'map'}).status,'unresolved');
});

test('equal looking but different portal values do not acquire commit evidence',()=>{
 const h=harness(),otherChild={},otherContainer={},other={tag:4,key:'key',memoizedProps:otherChild,stateNode:{containerInfo:otherContainer},return:null};
 h.observer.commit(other,{...h.identity,instance_id:'other'});assert.equal(h.records.length,1);
 h.observer.begin('root','later');assert.deepEqual(h.observer.ancestry(h.fiber),[],'a prior commit is not current after a later root commit');
});
