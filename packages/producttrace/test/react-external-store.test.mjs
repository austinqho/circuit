import test from 'node:test';import assert from 'node:assert/strict';
import {getReactBehavior} from '../analysis/react-behavior.mjs';
import {validateReactExecutionRule,planExternalStore} from '../analysis/react-execution-rule.mjs';
import {compileReactSources} from '../analysis/react-compiler.mjs';
const rule=getReactBehavior({surface:'react',exportName:'useSyncExternalStore',version:'18.3.1'}).execution;
test('external store plans never invoke user callbacks and do not equate notifications with commits',()=>{
  let calls=0;const subscribe=()=>calls++,getSnapshot=()=>calls++,server=()=>calls++;
  assert.equal(validateReactExecutionRule(rule).valid,true);
  const args=[subscribe,getSnapshot,server];
  assert.equal(planExternalStore(rule,{args}).operations[0].callback,getSnapshot);
  assert.equal(planExternalStore(rule,{args,environment:'hydrate'}).operations[0].callback,server);
  assert.deepEqual(planExternalStore(rule,{args,event:'commit',previous:{subscribe,hasCleanup:true}}).operations,[]);
  assert.deepEqual(planExternalStore(rule,{args,event:'notify'}).operations,[{operation:'read_snapshot',callback:getSnapshot,arguments:[]}]);
  const unchanged=planExternalStore(rule,{args,event:'notify',observation:{previousValue:NaN,outcome:'returned',value:NaN}});
  assert.equal(unchanged.request_update,false);assert.equal(unchanged.commit_proven,false);
  assert.equal(planExternalStore(rule,{args,event:'notify',observation:{previousValue:0,outcome:'returned',value:-0}}).request_update,true);
  assert.equal(calls,0);
});
test('external store rejects unknown instructions and incomplete callback or observation inputs',()=>{
  assert.equal(validateReactExecutionRule({...rule,trust_me:true}).valid,false);
  assert.equal(validateReactExecutionRule({...rule,snapshot_argument:0}).valid,false);
  assert.equal(planExternalStore(rule,{args:[()=>{},()=>{}],environment:'server'}).reason,'server_snapshot_callback_required');
  for(const input of [{args:null},{event:'unknown'},{args:[],event:'notify'},
    {args:[()=>{},()=>{}],event:'notify',observation:{outcome:'returned',previousValue:0}},
    {args:[()=>{},()=>{}],event:'commit',previous:{subscribe:()=>{}}}])assert.equal(planExternalStore(rule,input).status,'unresolved');
});

test('store callback producer indexing follows direct immutable bindings without guessing through aliases or shadowing',()=>{
  const source=`import * as React from 'react';function App(){
    const listen=React.useCallback(()=>()=>{},[]);const alias=listen;
    let mutable=React.useCallback(()=>()=>{},[]);
    React.useSyncExternalStore(listen,()=>0);React.useSyncExternalStore(alias,()=>0);
    React.useSyncExternalStore(mutable,()=>0);{const listen=()=>()=>{};React.useSyncExternalStore(listen,()=>0);}
    return <button/>;}`;
  const map=compileReactSources({'store.tsx':source},{packages:{react:{version:'18.3.1',verified:true,verification_sha256:'fixture'}}});
  const stores=map.react_semantics.filter(row=>row.export==='useSyncExternalStore');assert.equal(stores.length,4);
  const producers=stores.map(row=>row.causal_bindings.callbacks[0].retained_producer_call_id).filter(Boolean);
  assert.equal(producers.length,1);assert.ok(map.react_semantics.some(row=>row.export==='useCallback' && row.call_id===producers[0]));
});
