import test from 'node:test';
import assert from 'node:assert/strict';
import {createReactDescriptorCommitObserver,checkReactDescriptorCommit} from '../analysis/react-descriptor-commit.mjs';
const identity={root_id:'root',instance_id:'instance',mount_id:'mount',commit_id:'commit'};
function host(){let session='s',enabled=true,n=0;const records=[];
 const observer=createReactDescriptorCommitObserver({context:()=>session,enabled:()=>enabled,id:()=>session+':commit:'+ ++n,observe:record=>records.push({...record,session,map_fingerprint:'map',occurrence_id:record.observation_id+':occurrence',evidence_ids:[record.observation_id]})});
 const props={},owner={},type=function Component(){throw Error('must not execute')},entry={key:'entry',source_call_id:'call',semantic_id:'rule'},element={$$typeof:Symbol.for('react.element'),props,type,_owner:owner};
 const origin={operation:'returned',session:'s',map_fingerprint:'map',manifest_key:'entry',source_call_id:'call',semantic_id:'rule',observation_id:'s:creation',result:{identity:'s:element'},fields:{props:{identity:'s:props'},type:{identity:'s:type'},_owner:{identity:'s:owner'}}};
 return {observer,records,props,owner,type,entry,element,origin,setSession:value=>session=value,stop:()=>enabled=false};
}
test('committed descriptors require exact props and type, with distinct mounted placement and no body execution',()=>{
 const h=host();h.observer.register(h.entry,h.element,h.origin);
 h.observer.commit({memoizedProps:{},elementType:h.type},identity);h.observer.commit({memoizedProps:h.props,elementType:()=>null},identity);assert.equal(h.records.length,0);
 h.observer.commit({memoizedProps:h.props,elementType:h.type,return:h.owner},identity);assert.equal(h.records.length,1);
 h.observer.commit({memoizedProps:h.props,elementType:h.type,return:h.owner},identity);assert.equal(h.records.length,1);
 h.observer.commit({memoizedProps:h.props,elementType:h.type,return:{return:h.owner}},{...identity,instance_id:'sibling'});assert.equal(h.records.length,2);
 const joined=checkReactDescriptorCommit(h.records[0],h.origin,{fingerprint:'map',session:'s'});assert.equal(joined.status,'resolved');assert.equal(joined.runtime.owner_lineage_proven,true);assert.equal(joined.runtime.owner_parent_distance,1);assert.equal(joined.runtime.owner_relation,'direct');
 h.stop();h.observer.commit({memoizedProps:h.props,elementType:h.type},{...identity,commit_id:'next'});assert.equal(h.records.length,2);
});
test('ambiguous descriptions, session changes, missing creation and forged identities cannot prove a commit',()=>{
 const h=host();h.observer.register(h.entry,h.element,h.origin);h.observer.commit({memoizedProps:h.props,elementType:h.type,return:h.owner},identity);const record=h.records[0];
 for(const patch of [{session:'foreign'},{description_observation_id:'s:other'},{element_identity:'s:other'},{props_identity:'s:other'},{owner_identity:'s:other'},{semantic_id:'other'},{renderer:{}},{runtime_observed:false}])
  assert.equal(checkReactDescriptorCommit({...record,...patch},h.origin,{fingerprint:'map',session:'s',rendererKnown:true}).status,'unresolved');
 assert.equal(checkReactDescriptorCommit({...record,owner_parent_distance:null},h.origin,{fingerprint:'map',session:'s'}).status,'unresolved');
 assert.equal(checkReactDescriptorCommit({...record,owner_relation:'foreign'},h.origin,{fingerprint:'map',session:'s'}).status,'unresolved');
 assert.equal(checkReactDescriptorCommit(record,null,{fingerprint:'map',session:'s',rendererKnown:true}).status,'unresolved');
 h.observer.register(h.entry,h.element,{...h.origin,observation_id:'s:second'});h.observer.commit({memoizedProps:h.props,elementType:h.type},{...identity,commit_id:'new'});
 assert(h.records.slice(1).every(row=>row.frontier==='committed_descriptor_ambiguous'));
 h.setSession('next');const count=h.records.length;h.observer.commit({memoizedProps:h.props,elementType:h.type},identity);assert.equal(h.records.length,count);
});
test('inspection never runs an application getter',()=>{
 const h=host();let reads=0;h.observer.register(h.entry,{...h.element,get props(){reads++;throw Error('getter')}},h.origin);
 h.observer.commit({get memoizedProps(){reads++;throw Error('getter')},elementType:h.type},identity);assert.equal(reads,0);assert.equal(h.records.length,0);
});
