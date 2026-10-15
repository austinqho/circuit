import test from 'node:test';import assert from 'node:assert/strict';import ts from 'typescript';
import {getReactBehavior} from '../analysis/react-behavior.mjs';import {validateReactExecutionRule,planReactClassUpdate} from '../analysis/react-execution-rule.mjs';
import {compileReactSources} from '../analysis/react-compiler.mjs';import {createReactRuntimeIntegration} from '../analysis/runtime-join.mjs';
import {createReactClassObserver} from '../analysis/react-class-runtime.mjs';
const parent=getReactBehavior({surface:'react',exportName:'Component',version:'18.3.1'}),rule=parent.members.setState.execution;
const packages=Object.fromEntries(['react','react-dom'].map(name=>[name,{version:'18.3.1',verified:true,verification_sha256:'fixture'}]));
test('class update plans preserve input references without reading partial state',()=>{
 const state=new Proxy({}, {ownKeys(){throw Error('no enumeration');},get(){throw Error('no property reads');}}),instance={},completion=()=>{};
 const plan=planReactClassUpdate(rule,{args:[state,completion],instance});assert.deepEqual(plan.args,[instance,state,completion,'setState']);assert.equal(plan.commit_proven,false);assert.equal(plan.queue_execution_proven,false);
 assert.equal(planReactClassUpdate(rule,{args:[false]}).operation,'throw');assert.equal(validateReactExecutionRule({...rule,unknown:true}).valid,false);assert.equal(validateReactExecutionRule({...rule,calculation_arguments:['anything']}).valid,false);
 assert.equal(planReactClassUpdate(rule,{operation:'unknown'}).status,'unresolved');
});
test('class update source factories preserve nested calls, concise bodies and omitted semicolons',()=>{
 for(const operation of ["this.setState(function calculate(state,props){return {count:state.count+props.step}})","this.setState((state,props)=>({count:state.count+props.step}))","this.setState(state=>this.setState(null))"]){
  const source=`import * as React from 'react';class X extends React.Component{render(){return React.createElement('div')} update(){return ${operation}}}globalThis.X=X;`;
  const map=compileReactSources({'App.tsx':source},{packages}),integration=createReactRuntimeIntegration(map),transformed=integration.instrumentSource('App.tsx',source);assert.deepEqual(transformed.diagnostics,[]);
  assert.ok(map.edges.filter(row=>row.class_update_member).every(row=>row.conditions.length===1&&row.conditions[0].runtime_observed===false&&row.callback_source_id===row.to&&Array.isArray(row.callback_argument_roles)));
  const execute=text=>{let calls=0;class Component{setState(payload){calls++;return typeof payload==='function'?payload.call(this,{count:1},{step:2}):payload;}}
   const context={__productTraceReactLifecycle:integration.createApiRuntime()};new Function('React','globalThis',ts.transpileModule(text.replace("import * as React from 'react';",''),{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText)({Component,createElement:()=>null,__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED:{ReactCurrentOwner:{current:null}}},context);
   const instance=new context.X();return {value:instance.update(),calls,name:instance.update.name,length:instance.update.length};};
  assert.deepEqual(execute(transformed.code),execute(source));
 }
});
test('callback observation preserves synchronous errors, queued callback shutdown and exact original function identity',()=>{
 let enabled=true,id=0;const records=[],entry={class_key:'class',class_update_rule:rule,class_update_callbacks:[{index:0,source_id:'callback',body:{kind:'function'}}]};
 class Base{setState(payload){return payload.call(this,{},{});}}class Owner extends Base{}const instance=new Owner(),current={tag:1,type:Owner,stateNode:instance,pendingProps:{},memoizedState:{}};
 const observer=createReactClassObserver({entry:key=>key==='class'?{class_rule:parent.execution}:entry,context:()=> 's',enabled:()=>enabled,id:()=>`s:${++id}`,encode:()=>({encoding:'redacted',value:null}),owner:()=>({}),observe:()=>{},observeUpdate:row=>records.push(row)});
 observer.classRegister('class',Owner,{current});observer.classRender('class',instance,()=>null);
 const error={};let original;
 assert.throws(()=>observer.classUpdateCall('update',instance,()=>observer.classUpdateMethod('update',instance,instance.setState)(observer.classUpdateArgument('update',0,observer.classUpdateCallback('update',0,observe=>{original=function callback(){return observe(this,arguments,()=>{throw error;});};return original;})))),caught=>caught===error);
 assert.equal(records.length,2);assert.equal(records[0].operation,'threw');assert.equal(records[1].operation,'callback_threw');assert.equal(records[1].request_id,records[0].observation_id);assert.equal(records[1].timing,'during_method_call');assert.equal(original.name,'callback');
 let queued,calls=0;instance.setState=function(callback){queued=callback;};observer.classUpdateCall('update',instance,()=>observer.classUpdateMethod('update',instance,instance.setState)(observer.classUpdateArgument('update',0,observer.classUpdateCallback('update',0,observe=>function callback(){return observe(this,arguments,()=>{calls++;return error;});}))));
 const before=records.length;enabled=false;assert.equal(queued.call(instance,{},{}),error);assert.equal(calls,1);assert.equal(records.length,before);
 assert.equal(observer.classUpdateCall('update',instance,()=>observer.classUpdateMethod('update',instance,function(){return this;})()),instance);
});
test('unsupported update argument and callback shapes stay explicit and source mismatches do not instrument',()=>{
 const source="import * as React from 'react';class X extends React.Component{render(){return null}update(){this.setState(...args);this.setState(async state=>state);this.setState((state={})=>state);this.setState(shared);}}";
 const map=compileReactSources({'App.tsx':source},{packages}),integration=createReactRuntimeIntegration(map),frontiers=integration.bindings.react_lifecycle.frontiers;
 assert.ok(frontiers.some(row=>row.reason==='class_update_arguments_unsupported'));assert.ok(frontiers.filter(row=>row.reason==='class_update_callback_body_unsupported').length>=2);assert.ok(frontiers.some(row=>row.reason==='class_update_callback_source_unresolved'));
 assert.equal(integration.instrumentSource('App.tsx',source+' ').diagnostics[0].code,'source_snapshot_mismatch');
});
