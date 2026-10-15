import test from 'node:test';import assert from 'node:assert/strict';import ts from 'typescript';
import {getReactBehavior} from '../analysis/react-behavior.mjs';import {validateReactExecutionRule,planReactClassOperation} from '../analysis/react-execution-rule.mjs';import {createReactClassObserver} from '../analysis/react-class-runtime.mjs';
import {compileReactSources} from '../analysis/react-compiler.mjs';import {createReactRuntimeIntegration} from '../analysis/runtime-join.mjs';
const rule=getReactBehavior({surface:'react',exportName:'PureComponent',version:'18.3.1'}).execution;
const packages=Object.fromEntries(['react','react-dom'].map(name=>[name,{version:'18.3.1',verified:true,verification_sha256:'fixture'}]));
test('class planning requires comparison evidence and never inspects application properties',()=>{
 const value=new Proxy({}, {ownKeys(){throw Error('must not enumerate props');},get(){throw Error('must not read props');}});
 assert.equal(planReactClassOperation(rule,{operation:'update_check',props:value,state:value}).reason,'class_shallow_comparison_evidence_required');
 const plan=planReactClassOperation(rule,{operation:'render',props:value,state:value});assert.equal(plan.inputs.props,value);assert.equal(plan.commit_proven,false);
 assert.equal(planReactClassOperation(rule,{operation:'compare',left:NaN,right:NaN}).equal,true);assert.equal(planReactClassOperation(rule,{operation:'compare',left:0,right:-0}).equal,false);
 assert.equal(validateReactExecutionRule({...rule,extra:true}).valid,false);assert.equal(validateReactExecutionRule({...rule,render_method:'anything'}).valid,false);
 assert.equal(planReactClassOperation(rule,{operation:'unknown'}).status,'unresolved');
 assert.equal(planReactClassOperation(rule,{operation:'update',force:true}).status,'unresolved');
 assert.equal(planReactClassOperation(rule,{operation:'update_check',force:true}).render_execution_proven,false);
});
test('class instrumentation preserves class, method, lexical receiver and original input accesses',()=>{
 const source=`import * as React from 'react';class Example extends React.Component {render(value){'use strict';const read=this.props;return [this,arguments[0],read];}}globalThis.Example=Example;`;
 const map=compileReactSources({'class.tsx':source},{packages}),integration=createReactRuntimeIntegration(map),transformed=integration.instrumentSource('class.tsx',source);assert.deepEqual(transformed.diagnostics,[]);
 const records=[],context={__productTraceReactLifecycle:integration.createApiRuntime({onObservation:row=>records.push(row)})};
 class Component{constructor(props){this.props=props;}}const ownerRef={current:null};
 new Function('React','globalThis',ts.transpileModule(transformed.code.replace("import * as React from 'react';",''),{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText)({Component,__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED:{ReactCurrentOwner:ownerRef}},context);
 const Class=context.Example,method=Class.prototype.render,props={},instance=new Class(props),value={};
 assert.deepEqual(instance.render(value),[instance,value,props]);assert.equal(Class.prototype.render,method);assert.equal(method.name,'render');assert.equal(method.length,1);assert.equal(Class.name,'Example');assert.ok(instance instanceof Component);
 let reads=0;const failure={};Object.defineProperty(instance,'props',{get(){reads++;throw failure;}});assert.throws(()=>instance.render(value),error=>error===failure);assert.equal(reads,1);
 const rows=records.filter(row=>row.kind==='react_class');assert.equal(rows.length,3);assert.equal(rows.at(-1).operation,'threw');assert.equal(rows.at(-1).frontier,'class_renderer_owner_unobserved');
});
test('unsupported class source shapes retain explicit frontiers',()=>{
 for(const text of ["import * as React from 'react';class X extends React.Component {render(){({x:this.props}=value);return null;}}", "import * as React from 'react';class X extends React.Component {render(){for(this.props of []){}return null;}}", "import * as React from 'react';class X extends React.Component {render(){return this.props();}}", "import {Component} from 'react';class X extends Component {render(){return null;}}", "import * as React from 'react';class X extends React.Component {render(){this.props={};return null;}}", "import * as React from 'react';const X=class extends React.Component {render(){return null;}}", "import * as React from 'react';class X extends React.Component {render(){eval('1');return null;}}"]){
  const map=compileReactSources({'class.tsx':text},{packages}),integration=createReactRuntimeIntegration(map);assert.equal(integration.bindings.react_lifecycle.entries.some(row=>row.class_rule),false,text);assert.ok(integration.bindings.react_lifecycle.frontiers.some(row=>row.reason==='class_render_source_unsupported'),text);
 }
 const source="import * as React from 'react';class X extends React.Component {render(){return null;}}",map=compileReactSources({'class.tsx':source},{packages:{react:{...packages.react,verified:false}}});assert.equal(createReactRuntimeIntegration(map).bindings.react_lifecycle.entries.some(row=>row.class_rule),false);
});
test('nested class observations preserve frames and stopping does not change original execution',()=>{
 let enabled=true,id=0;const rows=[],owner={current:null},baseRule=getReactBehavior({surface:'react',exportName:'Component',version:'18.3.1'}).execution;
 class Base{}class A extends Base{}class B extends Base{}const a=new A(),b=new B(),props={},state={};
 const observer=createReactClassObserver({enabled:()=>enabled,context:()=> 's',entry:()=>({class_rule:baseRule}),id:()=>`s:${++id}`,encode:()=>({encoding:'redacted',value:null}),owner:()=>({root_id:'react-root:1'}),observe:row=>rows.push(row)});
 observer.classRegister('a',A,owner);observer.classRegister('b',B,owner);owner.current={tag:1,type:A,stateNode:a,pendingProps:props,memoizedState:state};
 observer.classRender('a',a,()=>{observer.classRead('a','a1','props',props);const previous=owner.current;owner.current={tag:1,type:B,stateNode:b,pendingProps:props,memoizedState:state};observer.classRender('b',b,()=>observer.classRead('b','b1','state',state));owner.current=previous;observer.classRead('a','a2','props',props);});
 assert.deepEqual(rows.at(-1).reads.map(row=>row.source_id),['a1','a2']);assert.deepEqual(rows.at(-2).reads.map(row=>row.source_id),['b1']);
 const before=rows.length;enabled=false;const result={};assert.equal(observer.classRender('a',a,()=>result),result);assert.equal(rows.length,before);
});
test('nested flushSync callbacks and first-statement scope transforms preserve original callback values',()=>{
 for(const body of ['{DOM.flushSync(()=>setCount(value=>value+1));}', 'DOM.flushSync(()=>setCount(value=>value+1))']){
  const source=`import * as React from 'react';import * as DOM from 'react-dom';function App(){const [count,setCount]=React.useState(0);const click=React.useCallback(()=>${body},[]);return <button onClick={click}/>;}globalThis.run=App;`;
  const map=compileReactSources({'App.tsx':source},{packages}),integration=createReactRuntimeIntegration(map),transformed=integration.instrumentSource('App.tsx',source);assert.deepEqual(transformed.diagnostics,[]);
  const context={__productTraceReactLifecycle:{...integration.createApiRuntime(),component(){},stateResult:(_key,value)=>value,stateDispatch:(_key,value)=>value,defineCallback:(_key,factory)=>factory(()=>{}),retainedResult:(_key,value)=>value,eventCallback:(_key,value)=>value}};let count=0;
  const code=ts.transpileModule(transformed.code.replace("import * as React from 'react';",'').replace("import * as DOM from 'react-dom';",''),{compilerOptions:{jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2020}}).outputText;
  new Function('React','DOM','globalThis',code)({useState:()=>[count,update=>{count=update(count);}],useCallback:callback=>{assert.equal(typeof callback,'function');return callback;},createElement:(_type,props)=>props},{flushSync:callback=>callback()},context);
  context.run().onClick();assert.equal(count,1);
 }
});
