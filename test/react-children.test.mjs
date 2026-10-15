import test from 'node:test';import assert from 'node:assert/strict';
import {getReactBehavior} from '../analysis/react-behavior.mjs';import {validateReactExecutionRule,planChildrenTraversal} from '../analysis/react-execution-rule.mjs';
import {compileReactSources} from '../analysis/react-compiler.mjs';import {createReactRuntimeIntegration} from '../analysis/runtime-join.mjs';
const packages={react:{version:'18.3.1',verified:true,verification_sha256:'fixture'}};
const rule=getReactBehavior({surface:'react',exportName:'Children',version:'18.3.1'}).execution;
function setup(){const source=`import * as React from 'react';function App(){return <button onClick={()=>React.Children.forEach(window.items,(child,index)=>send(child,index),window.receiver)}>Run</button>;}`;
 const map=compileReactSources({'children.tsx':source},{packages}),integration=createReactRuntimeIntegration(map);
 return {source,map,integration,entry:integration.bindings.react_lifecycle.entries.find(row=>row.children_rule)};}
test('children traversal rule does not execute callbacks, accessors or iterators',()=>{
 assert.equal(validateReactExecutionRule(rule).valid,true);assert.equal(validateReactExecutionRule({...rule,extra:1}).valid,false);
 let effects=0;const callback=()=>effects++,value=[null,false,['a',1]],plan=planChildrenTraversal(rule,{args:[value,callback,{}],method:'map'});
 assert.equal(plan.callbacks.length,4);assert.equal(effects,0);assert.equal(plan.result_frontier,'mapped_result_flattening_and_keys_unproven');
 const cyclic=[];cyclic.push(cyclic);assert.equal(planChildrenTraversal(rule,{args:[cyclic],method:'count'}).reason,'children_cycle');
 const getter=[];Object.defineProperty(getter,'0',{get(){effects++;return 'x';}});assert.equal(planChildrenTraversal(rule,{args:[getter],method:'count'}).reason,'children_accessor_unobserved');assert.equal(effects,0);
 const iterable={[Symbol.iterator](){effects++;return[][Symbol.iterator]();}};assert.equal(planChildrenTraversal(rule,{args:[iterable],method:'count'}).status,'unresolved');assert.equal(effects,0);
});
test('children call observations select source callbacks and reject contaminated invocation packets',()=>{
 const {source,map,integration,entry}=setup();assert.ok(entry);assert.equal(entry.children_member,'forEach');
 assert.ok(map.edges.some(row=>row.relation==='callback_forward'&&row.from===entry.source_call_id));
 assert.deepEqual(integration.instrumentSource('children.tsx',source).diagnostics,[]);
 const records=[],observer=integration.createApiRuntime({session:'s',onObservation:record=>records.push(record)}),receiver={},seen=[];
 const result=observer.scopeCall(entry.key,()=>{
  observer.scopeArgument(entry.key,0,['a','b']);const callback=observer.scopeArgument(entry.key,1,function(child,index){seen.push([this,child,index]);});observer.scopeArgument(entry.key,2,receiver);
  callback.call(receiver,'a',0);callback.call(receiver,'b',1);
 });assert.equal(result,undefined);assert.deepEqual(seen,[[receiver,'a',0],[receiver,'b',1]]);
 const valid=records.at(-1),joined=integration.joinApi(valid);assert.equal(joined.status,'resolved',JSON.stringify(joined));
 assert.equal(joined.runtime.children_proof.observed_callback_edges.length,2);assert.equal(joined.runtime.children_proof.input_traversal_proven,false);
 const change=fn=>{const row=structuredClone(valid);fn(row);return row;};
 const bad=[change(row=>row.scope.callbacks[1].arguments[1].value=0),change(row=>row.scope.callbacks[0].source_id='foreign'),
 change(row=>row.scope.callbacks[1].invocation_id=row.scope.callbacks[0].invocation_id),change(row=>row.scope.callbacks[0].receiver=row.scope.callbacks[0].arguments[0]),
 change(row=>row.scope.callbacks[0].arguments=[]),change(row=>row.scope.callbacks[0].captured_values=[{binding_id:'foreign',encoding:'primitive',value:1}]),
 change(row=>row.scope.result.kind='number'),change(row=>row.scope.callbacks=null),change(row=>row.session='other')];
 for(const row of bad)assert.equal(integration.joinApi(row).status,'unresolved',JSON.stringify(row));
});

test('try/catch remains an explicit source boundary for traversal-to-action joins',()=>{
 const source=`import * as React from 'react';function App(){return <button onClick={()=>{try{React.Children.forEach(window.items,child=>send(child));}catch(error){report(error);}}}>Run</button>;}`;
 const map=compileReactSources({'caught.tsx':source},{packages});assert.ok(map.diagnostics.some(row=>row.code==='unsupported_control_flow'));
 const call=map.react_semantics.find(row=>row.causal_bindings?.member==='forEach');assert.ok(call);
 assert.ok(!map.edges.some(row=>row.relation==='call_site'&&row.to===call.call_id&&row.scenario_id));
});
