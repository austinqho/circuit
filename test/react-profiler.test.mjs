import test from 'node:test';import assert from 'node:assert/strict';
import {getReactBehavior} from '../analysis/react-behavior.mjs';
import {validateReactExecutionRule} from '../analysis/react-execution-rule.mjs';
import {interpretReactProfilerCommit,createReactProfilerObserver} from '../analysis/react-profiler-runtime.mjs';
const rule=getReactBehavior({surface:'react',exportName:'Profiler',version:'18.3.1'}).execution;
const value=value=>({encoding:'primitive',value});
const snapshot={tag:12,mode:2,flags:4,fresh:true,profile_state:true,mounted:false,nested:false,
 id:value('panel'),actualDuration:value(3),treeBaseDuration:value(4),actualStartTime:value(10),commitTime:value(14)};

test('Profiler program describes layout invocation and actual argument order',()=>{
 assert.equal(validateReactExecutionRule(rule).valid,true);
 const expected={callback:'onRender',phase:'layout_commit',arguments:['panel','mount',3,4,10,14].map(value),result:'ignore'};
 assert.deepEqual(interpretReactProfilerCommit(rule,snapshot),expected);
 assert.equal(interpretReactProfilerCommit(rule,{...snapshot,mounted:true}).arguments[1].value,'update');
 assert.equal(interpretReactProfilerCommit(rule,{...snapshot,nested:true}).arguments[1].value,'nested-update');
 for(const change of [{fresh:false},{profile_state:false},{flags:0},{mode:0},{tag:13}])assert.equal(interpretReactProfilerCommit(rule,{...snapshot,...change}),null);
 for(const change of [{arguments:[...rule.profiler.arguments].reverse()},{mount_phase:'update'},{phase:'passive_commit'},{result:'forward'},{callback:'onCommit'}]){
  const mutant={...rule,profiler:{...rule.profiler,...change}};assert.equal(validateReactExecutionRule(mutant).valid,true);
  assert.notDeepEqual(interpretReactProfilerCommit(mutant,snapshot),expected);
 }
 assert.equal(validateReactExecutionRule({...rule,profiler:{...rule.profiler,arbitraryCode:'run()'}}).valid,false);
});

test('Profiler observer preserves outcomes and rejects duplicate calls, old flags, wrong renderers and session carryover',()=>{
 let enabled=true,session='s',serial=0;const records=[],identities=new WeakMap();
 const entry={key:'callback',source_call_id:'source',callback_source_id:'body'},boundaryEntry={key:'boundary',source_call_id:'source',boundary_rule:rule};
 const renderer={rendererPackageName:'react-dom',version:'18.3.1',bundleType:1};
 const observer=createReactProfilerObserver({context:()=>session,enabled:()=>enabled,id:kind=>`${session}:${kind}:${++serial}`,value,
  identity:fn=>{if(!identities.has(fn))identities.set(fn,`${session}:fn:${++serial}`);return identities.get(fn);},
  interpret:interpretReactProfilerCommit,observe:r=>records.push(r),fiberIdentity:()=>({root_id:'root',instance_id:'profiler',mount_id:'mount',commit_id:'commit'}),
  boundary:()=>({observation_id:'s:boundary'})});
 let nested=false,fn;const result={},failure={};
 fn=observer.define(entry,observe=>function callback(id,phase,a,b,s,c){return observe(arguments,()=>{
  if(id==='throw')throw failure;if(nested){nested=false;fn(id,phase,a,b,s,c);}return result;
 });},'callback');
 const props={id:'panel',onRender:fn};observer.created(boundaryEntry,{props},'s:origin');
 const fiber={tag:12,mode:2,flags:4,memoizedProps:props,stateNode:{effectDuration:0},alternate:null,actualDuration:3,treeBaseDuration:4,actualStartTime:10};
 const root={current:{child:fiber,alternate:{child:null}}};
 assert.equal(fn('panel','mount',3,4,10,14),result);observer.commit(root,{...renderer,version:'19.0.0'});
 assert.equal(records.filter(r=>r.operation==='committed_callback').length,0);
 observer.commit(root,renderer);assert.equal(records.at(-1).frontier,null);
 // React may keep flags on a fiber that is shared with the preceding tree.
 root.current.alternate.child=fiber;observer.commit(root,renderer);assert.equal(records.filter(r=>r.operation==='committed_callback').length,1);
 root.current.alternate.child=null;nested=true;fn('panel','mount',3,4,10,14);observer.commit(root,renderer);
 assert.equal(records.at(-1).frontier,'profiler_callback_ambiguous');
 fn('panel','mount',3,4,10,14);observer.commit(root,renderer);assert.equal(records.at(-1).frontier,'profiler_callback_ambiguous','ambiguity cannot be erased by consuming the first candidate');
 assert.throws(()=>fn('throw','mount',3,4,10,14),error=>error===failure);assert.equal(records.at(-1).outcome,'threw');
 enabled=false;const count=records.length;assert.equal(fn('panel','mount',3,4,10,14),result);assert.equal(records.length,count);
 enabled=true;session='next';observer.commit(root,renderer);assert.equal(records.length,count,'a new session cannot use old input origins');
 observer.created(boundaryEntry,{props},'next:origin');fn('panel','mount',3,4,10,14);observer.commit(root,renderer);assert.equal(records.at(-1).frontier,null);
});

import vm from 'node:vm';import ts from 'typescript';
import {compileReactSources} from '../analysis/react-compiler.mjs';
import {createReactRuntimeIntegration} from '../analysis/index.mjs';

test('Profiler body instrumentation preserves lexical values, original arguments and callback shape',()=>{
 const packages={react:{version:'18.3.1',verified:true,verification_sha256:'explicit-unit-fixture'}};
 const callbacks=['()=>42','id=>id','(id)=>id','(id,)=>id','(id,phase)=>[id,phase,this.lexical]',
  'function report(id,phase){id="changed";return [arguments[0],phase,this.receiver];}',
  'function report(){"use strict";return [arguments.length,this.receiver];}'];
 for(const callback of callbacks){
  const source=`import * as React from 'react';function App(){return <React.Profiler id="profile" onRender={${callback}}/>;}globalThis.result=App();`;
  const map=compileReactSources({'App.tsx':source},{packages}),integration=createReactRuntimeIntegration(map),transformed=integration.instrumentSource('App.tsx',source);
  assert.deepEqual(transformed.diagnostics,[]);assert.equal(integration.bindings.react_lifecycle.entries.filter(e=>e.kind==='profiler_callback').length,1,callback);
  const run=code=>{
   const context={React:{Profiler:Symbol.for('react.profiler'),createElement:(type,props)=>({type,props})},lexical:'lexical',
    __productTraceReactLifecycle:{component(){},boundaryResult:(_,v)=>v,
     profilerDefine(key,factory,name){const fn=factory((args,body)=>body());if(name&&!fn.name)Object.defineProperty(fn,'name',{value:name,configurable:true});return fn;}}};
   const js=ts.transpileModule(code.replace("import * as React from 'react';",''),{compilerOptions:{jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.None}}).outputText;
   vm.runInNewContext(js,context);return context.result.props.onRender;
  };
  const original=run(source),observed=run(transformed.code),args=['panel','mount',3,4,10,14,99],receiver={receiver:'receiver'};
  assert.equal(observed.length,original.length,callback);assert.equal(observed.name,original.name,callback);
  assert.equal(JSON.stringify(observed.apply(receiver,args)),JSON.stringify(original.apply(receiver,args)),callback);
 }
 for(const callback of ['async(id)=>id','(id="default")=>id','(...args)=>args','({id})=>id','(id,phase)=>{"use strict";return id;}',
  'function report(id){var id="changed";return arguments[0];}']){
  const source=`import * as React from 'react';function App(){return <React.Profiler onRender={${callback}}/>;}`;
  const integration=createReactRuntimeIntegration(compileReactSources({'App.tsx':source},{packages}));
  assert.equal(integration.bindings.react_lifecycle.entries.filter(e=>e.kind==='profiler_callback').length,0,callback);
  assert.ok(integration.bindings.react_lifecycle.frontiers.some(row=>row.reason==='profiler_callback_body_source_unsupported'),callback);
 }
});

test('the Node runtime can construct Profiler callbacks without inventing a renderer commit',()=>{
 const source=`import * as React from 'react';function App(){return <React.Profiler onRender={function report(id){return id;}}/>;}`;
 const packages={react:{version:'18.3.1',verified:true,verification_sha256:'explicit-unit-fixture'}};
 const map=compileReactSources({'App.tsx':source},{packages}),joins=[],integration=createReactRuntimeIntegration(map,{onJoin:result=>joins.push(result)}),records=[];
 const runtime=integration.createApiRuntime({session:'node-profiler',onObservation:record=>{records.push(record);integration.onRecord(record);}});
 const entry=integration.bindings.react_lifecycle.entries.find(e=>e.kind==='profiler_callback'),failure={};
 const fn=runtime.profilerDefine(entry.key,observe=>function report(id){return observe(arguments,()=>{if(id===failure)throw failure;return id;});},'report');
 assert.equal(fn('example'),'example');assert.throws(()=>fn(failure),error=>error===failure);
 assert.equal(records.length,4);assert.ok(joins.every(row=>row.status==='resolved'));
 assert.ok(records.every(row=>row.operation!=='committed_callback'));
});

test('a failed Profiler evidence sink cannot replace callback returns or errors',()=>{
 let serial=0;const failure={},result={};
 const observer=createReactProfilerObserver({context:()=> 's',enabled:()=>true,id:()=>`s:${++serial}`,identity:()=> 's:fn',value,
  observe(){throw new Error('recorder failure');}});
 const fn=observer.define({key:'k',callback_source_id:'source'},observe=>function run(throws){return observe(arguments,()=>{if(throws)throw failure;return result;});},'run');
 assert.equal(fn(false),result);assert.throws(()=>fn(true),error=>error===failure);
});
