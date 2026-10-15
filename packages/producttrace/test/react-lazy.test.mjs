import test from 'node:test';import assert from 'node:assert/strict';
import {getReactBehavior} from '../analysis/react-behavior.mjs';import {validateReactExecutionRule,planReactLazyStep} from '../analysis/react-execution-rule.mjs';
import {compileReactSources} from '../analysis/react-compiler.mjs';import {createReactRuntimeIntegration} from '../analysis/runtime-join.mjs';
import {createReactElementObserver} from '../analysis/react-element-runtime.mjs';
const packages={react:{version:'18.3.1',verified:true,verification_sha256:'fixture'}};
const rule=getReactBehavior({surface:'react',exportName:'lazy',version:'18.3.1'}).execution;
test('lazy programs separate creation, loading, settlement and module reads',()=>{
 assert.equal(validateReactExecutionRule(rule).valid,true);assert.equal(validateReactExecutionRule({...rule,extra:1}).valid,false);
 const loader=()=>{throw Error('planner must not call');},state={status:'uninitialized',value:loader};
 assert.equal(planReactLazyStep(rule,{state,event:'initialize'}).callback,loader);
 assert.equal(planReactLazyStep(rule,{state,event:'unknown'}).reason,'lazy_event_unmodeled');
 assert.equal(planReactLazyStep(rule,{state:{status:'resolved',value:{get default(){throw Error('must not read');}}},event:'initialize'}).operation,'read_module_property');
});
test('lazy loader records require allocation and exact original source, and preserve a thrown value',()=>{
 const source=`import * as React from 'react';const Lazy=React.lazy(()=>window.pending);`;
 const map=compileReactSources({'lazy.tsx':source},{packages}),integration=createReactRuntimeIntegration(map),records=[];
 const entry=integration.bindings.react_lifecycle.entries.find(row=>row.element_rule?.kind==='lazy_component');assert.ok(entry.lazy_loader_source_id);
 assert.ok(map.edges.some(row=>row.callback_source_id===entry.lazy_loader_source_id&&row.conditions.some(condition=>condition.runtime_observed===false)));
 const api=integration.createApiRuntime({session:'s',onObservation:row=>records.push(row)}),original={error:true};let stored;
 const lazy=api.elementCall(entry.key,()=>{stored=api.elementArgument(entry.key,0,()=>{throw original;});return {$$typeof:Symbol.for('react.lazy'),_payload:{_status:-1,_result:stored}};});
 assert.equal(records.length,1);assert.throws(()=>stored(),value=>value===original);assert.equal(records.length,2);
 assert.equal(integration.joinElement(records[1]).reason,'lazy_loader_origin_unobserved');assert.equal(integration.joinElement(records[0]).status,'resolved');
 const joined=integration.joinElement(records[1]);assert.equal(joined.status,'resolved');assert.equal(joined.runtime.outcome,'threw');assert.equal(joined.runtime.thenable_settlement_observed,false);
 assert.equal(integration.joinElement(records[1]).reason,'duplicate_element_observation');
 const check=()=>{const fresh=createReactRuntimeIntegration(map);fresh.joinElement(records[0]);return fresh;};
 for(const change of [{source_id:'wrong'},{creation_observation_id:'s:wrong'},{lazy_identity:'s:other'},{loader_identity:'s:other'},{arguments:[records[1].result]},{session:'wrong'}])assert.equal(check().joinElement({...records[1],...change}).status,'unresolved');
 assert.ok(lazy);
});
test('lazy loaders retained across recording restarts execute without borrowing the old allocation',()=>{
 let context='first',sequence=0,invocations=0;const records=[];
 const observer=createReactElementObserver({entry:()=>({element_rule:rule,lazy_loader_source_id:'source'}),context:()=>context,enabled:()=>true,
  id:kind=>context+':'+kind+':'+(++sequence),encode:()=>({encoding:'redacted',value:null}),observe:row=>records.push(row)});
 let stored;observer.elementCall('key',()=>{stored=observer.elementArgument('key',0,()=>++invocations);return {$$typeof:Symbol.for('react.lazy'),_payload:{_status:-1,_result:stored}};});
 assert.equal(records.length,1);context='second';assert.equal(stored(),1);assert.equal(records.length,1);
});
test('lazy native Promise settlement retains the exact allocation, loader and settled value',async()=>{
 const source=`import * as React from 'react';const Lazy=React.lazy(()=>window.pending);`;
 const map=compileReactSources({'lazy.tsx':source},{packages}),integration=createReactRuntimeIntegration(map),records=[];
 const entry=integration.bindings.react_lifecycle.entries.find(row=>row.element_rule?.kind==='lazy_component');
 const api=integration.createApiRuntime({session:'s',onObservation:row=>records.push(row)});let stored,resolve;
 const pending=new Promise(done=>{resolve=done;});
 api.elementCall(entry.key,()=>{stored=api.elementArgument(entry.key,0,()=>pending);return {$$typeof:Symbol.for('react.lazy'),_payload:{_status:-1,_result:stored}};});
 assert.equal(stored(),pending);assert.equal(records[1].thenable_protocol,'native_promise.v1');
 const module={default:function Ready(){}};resolve(module);await pending;await new Promise(done=>queueMicrotask(done));
 assert.equal(records.length,3);assert.equal(records[2].operation,'loader_fulfilled');
 assert.equal(records[2].loader_observation_id,records[1].observation_id);
 assert.equal(records[2].thenable_identity,records[1].result.identity);
 const check=createReactRuntimeIntegration(map);for(const row of records)assert.equal(check.joinElement(row).status,'resolved');
 const proof=check.joinElement(records[2]);assert.equal(proof.reason,'duplicate_element_observation');
 const fresh=()=>{const next=createReactRuntimeIntegration(map);next.joinElement(records[0]);next.joinElement(records[1]);return next;};
 for(const change of [{loader_observation_id:'s:wrong'},{thenable_identity:'s:wrong'},
  {result:{...records[2].result,identity:records[1].result.identity}}])
  assert.equal(fresh().joinElement({...records[2],...change}).status,'unresolved');
});
test('lazy custom thenables remain an explicit settlement frontier',async()=>{
 let sequence=0,stored;const records=[],thenable={then(){throw Error('Tracer must not subscribe');}};
 const observer=createReactElementObserver({entry:()=>({element_rule:rule,lazy_loader_source_id:'source'}),context:()=> 's',enabled:()=>true,
  id:kind=>'s:'+kind+':'+(++sequence),encode:()=>({encoding:'redacted',value:null}),observe:row=>records.push(row)});
 observer.elementCall('key',()=>{stored=observer.elementArgument('key',0,()=>thenable);return {$$typeof:Symbol.for('react.lazy'),_payload:{_status:-1,_result:stored}};});
 assert.equal(stored(),thenable);await new Promise(done=>queueMicrotask(done));assert.equal(records.length,2);
 assert.equal(records[1].settlement_frontier,'lazy_thenable_not_exact_native_promise');
});
