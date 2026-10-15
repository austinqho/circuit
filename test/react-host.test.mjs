import test from 'node:test';import assert from 'node:assert/strict';import ts from 'typescript';
import {getReactBehavior} from '../analysis/react-behavior.mjs';import {validateReactExecutionRule,planReactHostLookup} from '../analysis/react-execution-rule.mjs';import {createReactHostObserver} from '../analysis/react-host-runtime.mjs';
import {compileReactSources} from '../analysis/react-compiler.mjs';import {createReactRuntimeIntegration} from '../analysis/runtime-join.mjs';
const rule=getReactBehavior({surface:'react-dom',exportName:'findDOMNode',version:'18.3.1'}).execution;
test('host lookup rejects incomplete and cyclic trees without touching an application getter',()=>{
 assert.equal(validateReactExecutionRule(rule).valid,true);assert.equal(validateReactExecutionRule({...rule,extra:1}).valid,false);
 const input={get nodeType(){throw Error('planner must not read the application');}};
 assert.equal(planReactHostLookup(rule,{input}).status,'unresolved');
 const incomplete={tag:1,children:[],complete:false};assert.equal(planReactHostLookup(rule,{input,mounted:true,currentTree:incomplete}).status,'unresolved');
 incomplete.children.push(incomplete);assert.equal(planReactHostLookup(rule,{input,mounted:true,currentTree:incomplete}).status,'unresolved');
 const host={},prefix={tag:1,children:[{tag:5,value:host,children:[],complete:true}],complete:false};
 assert.equal(planReactHostLookup(rule,{input,mounted:true,currentTree:prefix}).value,host);
});
test('host observations preserve original values and retain changed-commit uncertainty',()=>{
 const records=[];let count=0,stable=true,enabled=true;
 const observer=createReactHostObserver({entry:()=>({host_rule:rule,host_argument_count:1}),enabled:()=>enabled,id:()=>`s:${++count}`,encode:()=>({encoding:'redacted',value:null}),
  inspect:()=>({evidence:{kind:'native_node',nodeType:1},unchanged:()=>stable}),observe:record=>records.push(record)});
 const node={};assert.equal(observer.hostCall('call',()=>observer.hostArgument('call',0,node)),node);
 assert.equal(records[0].input.identity,records[0].result.identity);
 stable=false;observer.hostCall('call',()=>observer.hostArgument('call',0,node));assert.equal(records[1].frontier,'host_commit_changed_during_lookup');
 enabled=false;assert.equal(observer.hostCall('call',()=>node),node);assert.equal(records.length,2);
});
test('event source tags surround retained callback factories without changing their return value',()=>{
 const packages=Object.fromEntries(['react','react-dom'].map(name=>[name,{version:'18.3.1',verified:true,verification_sha256:'fixture'}]));
 for(const body of ['{DOM.findDOMNode(null);}', 'DOM.findDOMNode(null)']){
  const source=`import * as React from 'react';import * as DOM from 'react-dom';function App(){const click=React.useCallback(()=>${body},[]);return <button onClick={click}/>;}globalThis.run=App;`;
  const map=compileReactSources({'App.tsx':source},{packages}),integration=createReactRuntimeIntegration(map),transformed=integration.instrumentSource('App.tsx',source);assert.deepEqual(transformed.diagnostics,[]);
  const code=ts.transpileModule(transformed.code.replace("import * as React from 'react';",'').replace("import * as DOM from 'react-dom';",''),{compilerOptions:{jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2020}}).outputText;
  const context={__productTraceReactLifecycle:{...integration.createApiRuntime(),component(){},defineCallback:(_key,factory)=>factory(()=>{}),retainedResult:(_key,value)=>value,eventCallback:(_key,value)=>value}};
  let calls=0;new Function('React','DOM','globalThis',code)({useCallback:callback=>{assert.equal(typeof callback,'function');return callback;},createElement:(_type,props)=>props},{findDOMNode:()=>{calls++;return null;}},context);
  context.run().onClick();assert.equal(calls,1);
 }
});
