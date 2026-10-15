import test from 'node:test';import assert from 'node:assert/strict';import ts from 'typescript';
import {getReactBehavior} from '../analysis/react-behavior.mjs';import {validateReactExecutionRule,planReactRootOperation} from '../analysis/react-execution-rule.mjs';
import {compileReactSources} from '../analysis/react-compiler.mjs';import {createReactRuntimeIntegration} from '../analysis/runtime-join.mjs';
import {createReactRootObserver} from '../analysis/react-root-runtime.mjs';
const packages={'react-dom':{version:'18.3.1',verified:true,verification_sha256:'fixture'}};
const source=`import * as DOM from 'react-dom/client';const root=DOM.createRoot(container);
function run(){root.render('next');root.unmount();root.unmount();try{root.render('late');}catch(error){if(error!==original)throw error;}}
run();`;
test('root plans keep scheduling and cleanup separate from observed commits',()=>{
 const rule=getReactBehavior({surface:'react-dom/client',exportName:'createRoot',version:'18.3.1'}).execution;
 assert.equal(validateReactExecutionRule(rule).valid,true);assert.equal(validateReactExecutionRule({...rule,extra:1}).valid,false);
 assert.equal(planReactRootOperation(rule,{operation:'create',args:[{}],containerNodeType:8}).operation,'throw');
 assert.equal(planReactRootOperation(rule,{operation:'render'}).commit_observed,false);
 assert.equal(planReactRootOperation(rule,{operation:'render',state:'unmounted'}).operation,'throw');
 assert.equal(planReactRootOperation(rule,{operation:'unmount',state:'unmounted'}).operation,'noop');
});
test('root execution excludes argument evaluation, other roots, and stopped sessions',()=>{
 let sequence=0,enabled=true,session='s';const records=[],container={};
 const internal={containerInfo:container,current:{child:null,memoizedState:{element:null}}},other={containerInfo:{},current:{child:null,memoizedState:{element:null}}};
 const observer=createReactRootObserver({entry:key=>({root_rule:{},root_method:key==='create'?'create':'unmount'}),
  enabled:()=>enabled,context:()=>session,id:type=>session+':'+type+':'+(++sequence),
  encode:()=>({encoding:'redacted',value:null}),rootId:root=>root===internal?'react-root:one':'react-root:other',observe:row=>records.push(row)});
 class Root{constructor(){this._internalRoot=internal;}render(){}unmount(){
  observer.rootCommitted(other,'react-commit:other');
  assert.equal(observer.rootCleanup('s:foreign',{root_id:'react-root:other'},'foreign'),null);
  observer.rootCommitted(internal,'react-commit:actual');
  observer.rootCleanup('s:cleanup',{root_id:'react-root:one',instance_id:'one',mount_id:'mount'},'effect');
  this._internalRoot=null;
 }}
 const root=observer.rootCall('create',()=>new Root());
 observer.rootCall('unmount',()=>{
  const method=observer.rootMethod('unmount',root,'unmount');
  observer.rootCommitted(internal,'react-commit:argument');
  assert.equal(observer.rootCleanup('s:argument',{root_id:'react-root:one'},'argument'),null);
  return method('ignored argument');
 });
 assert.deepEqual(records[1].commits.map(row=>row.commit_id),['react-commit:actual']);
 assert.deepEqual(records[1].cleanups.map(row=>row.observation_id),['s:cleanup']);
 observer.rootCommitted(internal,'react-commit:later');assert.equal(records[1].commits.length,1);
 enabled=false;observer.rootCall('create',()=>new Root());assert.equal(records.length,2);
 enabled=true;observer.rootCall('create',()=>{session='next';return new Root();});assert.equal(records.length,2);
});
test('root source instrumentation preserves original methods and requires handle lifetime provenance',()=>{
 const map=compileReactSources({'root.tsx':source},{packages}),integration=createReactRuntimeIntegration(map),records=[],original={error:true};
 const api=integration.createApiRuntime({session:'s',onObservation:row=>records.push(row)});
 class Root{constructor(container){this._internalRoot={containerInfo:container};}render(){if(!this._internalRoot)throw original;}unmount(){this._internalRoot=null;}}
 const created=[];const DOM={createRoot(container){const value=new Root(container);created.push(value);return value;}};
 const transformed=integration.instrumentSource('root.tsx',source);assert.deepEqual(transformed.diagnostics,[]);
 const code=ts.transpileModule(transformed.code.replace("import * as DOM from 'react-dom/client';",''),{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
 new Function('DOM','container','original','globalThis',code)(DOM,{},original,{__productTraceReactLifecycle:api});
 assert.equal(created[0].render,Root.prototype.render);assert.equal(created[0].unmount,Root.prototype.unmount);
 const observations=records.filter(row=>row.kind==='react_root');assert.equal(observations.length,5);
 assert.equal(integration.joinRoot(observations[1]).reason,'root_handle_origin_unobserved');
 for(const row of observations){const result=integration.joinRoot(row);assert.equal(result.status,'resolved',JSON.stringify(result));assert.equal(result.runtime.commit_observed,false);}
 const first=observations[0],valid=observations[1],mutations=[row=>{row.receiver.identity='s:foreign';},row=>{row.method_value.identity='s:foreign';},
  row=>{row.before.state='unmounted';},row=>{row.after.renderer_root_id='react-root:foreign';},row=>{row.session='wrong';},row=>{row.source_call_id='wrong';}];
 for(const mutation of mutations){const fresh=createReactRuntimeIntegration(map);assert.equal(fresh.joinRoot(first).status,'resolved');const bad=structuredClone(valid);mutation(bad);assert.equal(fresh.joinRoot(bad).status,'unresolved');assert.equal(fresh.joinRoot(valid).status,'resolved');}
});
