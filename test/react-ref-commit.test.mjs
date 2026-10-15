import test from 'node:test';import assert from 'node:assert/strict';
import {createReactRefCommitObserver} from '../analysis/react-ref-commit.mjs';

const renderer={root_id:'root',instance_id:'instance',mount_id:'mount',commit_id:'commit'};
function setup(){let enabled=true,context='session',next=0;const records=[];
 const observer=createReactRefCommitObserver({enabled:()=>enabled,context:()=>context,id:kind=>`session:${kind}:${++next}`,
  snapshot:value=>({identity:value.id,kind:'object',encoding:'redacted',value:null}),observe:record=>records.push(record)});
 const entry={key:'entry',source_call_id:'call',semantic_id:'react/useRef/18.3.1',surface:'react',export:'useRef',hook_owned:true,ref_rule:{property:'current'}};
 const ref={current:null},host={id:'session:host'},origin={operation:'returned',ref_id:'session:ref',observation_id:'session:origin',origin_observation_id:'session:origin'};
 return {observer,entry,ref,host,origin,records,stop:()=>enabled=false,setContext:value=>context=value};}

test('host attachment requires the exact registered ref and exact current host value',()=>{
 const h=setup();h.observer.register(h.entry,h.ref,h.origin);
 h.observer.commit({ref:{current:h.host},stateNode:h.host},renderer);assert.equal(h.records.length,0);
 h.observer.commit({ref:h.ref,stateNode:{}},renderer);assert.equal(h.records.length,0);
 h.ref.current=h.host;h.observer.commit({ref:h.ref,stateNode:h.host},renderer);assert.equal(h.records.length,1);
 assert.equal(h.records[0].origin_observation_id,h.origin.observation_id);assert.equal(h.records[0].value.identity,h.host.id);
 h.observer.commit({ref:h.ref,stateNode:h.host},renderer);assert.equal(h.records.length,1);
 h.observer.commit({ref:h.ref,stateNode:h.host},{...renderer,commit_id:'next'});assert.equal(h.records.length,2);
});

test('hook commitment requires the exact registered render and excludes discarded attempts',()=>{
 const h=setup(),committed={...renderer,render_id:'render'};
 h.origin.owner={root_id:'root',instance_id:'instance',mount_id:'mount',render_id:'render'};
 h.observer.register(h.entry,h.ref,h.origin);
 h.observer.commitOwner({...committed,render_id:'discarded'});assert.equal(h.records.length,0);
 h.observer.commitOwner(committed);assert.equal(h.records.length,1);assert.equal(h.records[0].operation,'hook_committed');
 assert.equal(h.records[0].origin_observation_id,h.origin.observation_id);
 h.observer.commitOwner(committed);assert.equal(h.records.length,1);
 h.observer.commitOwner({...committed,commit_id:'next'});assert.equal(h.records.length,2);
});

test('a retained ref stays joined to its first observed origin after another hook return',()=>{
 const h=setup();h.observer.register(h.entry,h.ref,h.origin);
 h.observer.register(h.entry,h.ref,{...h.origin,observation_id:'session:later',origin_observation_id:h.origin.observation_id});
 h.ref.current=h.host;h.observer.commit({ref:h.ref,stateNode:h.host},renderer);
 assert.equal(h.records[0].origin_observation_id,h.origin.observation_id);
});

test('context changes, accessors, and stopped observers cannot manufacture attachment evidence',()=>{
 const h=setup();let reads=0;const accessor={};Object.defineProperty(accessor,'current',{get(){reads++;return h.host;}});
 h.observer.register(h.entry,accessor,h.origin);h.observer.commit({ref:accessor,stateNode:h.host},renderer);assert.equal(reads,0);assert.equal(h.records.length,0);
 h.observer.register(h.entry,h.ref,h.origin);h.ref.current=h.host;h.setContext('next');h.observer.commit({ref:h.ref,stateNode:h.host},renderer);assert.equal(h.records.length,0);
 h.setContext('session');h.observer.register(h.entry,h.ref,h.origin);h.stop();h.observer.commit({ref:h.ref,stateNode:h.host},renderer);assert.equal(h.records.length,0);
});
