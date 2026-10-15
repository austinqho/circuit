import test from 'node:test';import assert from 'node:assert/strict';
import {compileReactSources} from '../analysis/react-compiler.mjs';import {createReactRuntimeIntegration} from '../analysis/runtime-join.mjs';
import {getReactBehavior} from '../analysis/react-behavior.mjs';import {planDeferredValue,validateReactExecutionRule} from '../analysis/react-execution-rule.mjs';
const rule=getReactBehavior({surface:'react',exportName:'useDeferredValue',version:'18.3.1'}).execution;
test('deferred plans require owner and renderer urgency instead of guessing from changed values',()=>{
  const value=()=>{throw Error('must not invoke');},owner='root:a';
  assert.equal(validateReactExecutionRule(rule).valid,true);assert.equal(validateReactExecutionRule({...rule,delay:10}).valid,false);
  assert.equal(planDeferredValue(rule,{owner,args:[value]}).value,value);
  assert.equal(planDeferredValue(rule,{owner,args:[2],previous:{owner,value:1}}).reason,'render_urgency_unobserved');
  assert.equal(planDeferredValue(rule,{owner,args:[2],previous:{owner:'other',value:1},urgency:'urgent'}).reason,'deferred_owner_mismatch');
  const previous={owner,value:0};assert.equal(planDeferredValue(rule,{owner,args:[-0],previous,urgency:'urgent'}).schedule_deferred,true);
  assert.equal(planDeferredValue(rule,{owner,args:[0],previous,urgency:'urgent'}).schedule_deferred,false);
  assert.equal(planDeferredValue(rule,{owner,args:[2],previous,urgency:'nonurgent'}).value,2);
});
test('deferred result observations connect only direct immutable native JSX child reads',()=>{
  const source=`import * as React from 'react';function App({input}){const value=React.useDeferredValue(input);const alias=value;let mutable=React.useDeferredValue(input);
    const later=()=> <b>{value}</b>;return <><output>{value}</output><b>{alias}</b><b>{mutable}</b><Custom>{value}</Custom></>;}`;
  const map=compileReactSources({'deferred.tsx':source},{packages:{react:{version:'18.3.1',verified:true,verification_sha256:'fixture'}}});
  const sources=map.react_semantics.filter(row=>row.export==='useDeferredValue');assert.equal(sources.length,2);
  assert.equal(sources.flatMap(row=>row.causal_bindings.deferred_reads||[]).length,1);
  const integration=createReactRuntimeIntegration(map),transformed=integration.instrumentSource('deferred.tsx',source);
  assert.deepEqual(transformed.diagnostics,[]);assert.match(transformed.code,/deferredResult/);assert.match(transformed.code,/deferredInput/);assert.match(transformed.code,/deferredUse/);
});
