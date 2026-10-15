import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {createHostEventBoundary} from '../../analysis/library-host-events.mjs';
import {createReactEffectEventHost} from '../../analysis/library-react-effect-host.mjs';
import {createLibraryProgramBank,programHash} from '../../analysis/library-program-bank.mjs';
import {instrumentLibraryPrograms} from '../../analysis/library-program-integration.mjs';
import {createLibraryProgramVerifier} from '../../authoring/library-program-verifier.mjs';
import {readCatalogImplementation,portableImplementation,admitCatalogProgram} from '../../authoring/library-program-catalog.mjs';
import {imperativeCallbackProgram,imperativeCallbackLayout} from './react-imperative-program.mjs';

const directory=path.dirname(fileURLToPath(import.meta.url)),repository=path.join(directory,'react-runtime/18');
const mode=process.env.NODE_ENV==='production'?'production':'development',writing=process.argv.includes('--write-catalog');
const require=createRequire(path.join(repository,'package.json')),{JSDOM}=require('jsdom'),dom=new JSDOM('<main></main>');
globalThis.window=dom.window;globalThis.document=dom.window.document;
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const host_dependencies=[{specifier:'react-dom/client',export_name:'createRoot'}];
const implementation=readCatalogImplementation({repository,specifier:'react',exportName:'useImperativeHandle',skeleton:{host_dependencies}});
const React=require('react'),{createRoot}=require('react-dom/client'),{flushSync}=require('react-dom');
assert.equal(React.version,'18.3.1');
const act=mode==='development'?React.act:async work=>{let result;flushSync(()=>{result=work()});await result;await new Promise(resolve=>setImmediate(resolve));};
const program=imperativeCallbackProgram(),scope={protocol:'host_event_boundary',hostProtocol:'react_effect_lifecycle',hostPhase:'layout',
  callbackArguments:[0,1],eventLayout:imperativeCallbackLayout,resultPaths:null,
  description:'React 18.3.1 imperative handle creation, callback-ref invocation and exact object-ref current writes at layout commits/disconnects. Includes changed ref identity, dependencies and null/undefined refs. Plain own writable current cells only; accessor/proxy refs and effect errors require an explicit frontier.'};

async function scenario(candidate,{strict=false,adapter=false,baseline=false}={}){
  const boundary=createHostEventBoundary({program:candidate,...imperativeCallbackLayout}),host=createReactEffectEventHost(React,{phase:'layout'});
  let invoke=args=>host.invoke({boundary,producer:implementation.producer,args}),checkpoint=()=>boundary.checkpoint(),transformed;
  if(baseline){invoke=args=>Reflect.apply(implementation.producer,undefined,args);checkpoint=()=>null;}
  if(adapter){
    const probe=createLibraryProgramBank({check:()=>({status:'passed',reason:'private_integration_probe'})});
    assert.equal((await probe.admit({implementation,program:candidate,scope})).status,'admitted');
    transformed=instrumentLibraryPrograms({source:"import {useImperativeHandle} from 'react';export function useObserved(ref,create,deps){return useImperativeHandle(ref,create,deps)}",file:'imperative.ts',bank:probe,hostEventHost:host});
    assert.equal(transformed.bindings.length,1);assert.equal(transformed.frontiers.length,0);
    const exports={};vm.runInNewContext(ts.transpileModule(transformed.code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
      {exports,require:()=>React,[transformed.runtimeKey]:transformed.runtime});
    invoke=args=>exports.useObserved(...args);checkpoint=()=>transformed.runtime.checkpoint()[0];
  }
  const log=[],labels=new WeakMap(),objectA=React.createRef(),objectB={current:null};
  const label=value=>value===null?'null':value===undefined?'undefined':labels.get(value)??'unlabeled';
  const callbackA=value=>{log.push('ref-a:'+label(value));return ()=>log.push('must-not-run-ref-cleanup')};
  const callbackB=value=>{log.push('ref-b:'+label(value))};
  const container=document.createElement('section');document.querySelector('main').append(container);let root=createRoot(container),suspend=false;
  const pending=new Promise(()=>{});
  function Probe({name,reference,deps,stamp}){
    invoke([reference,()=>{log.push('create:'+name+':'+stamp);const value=name==='function'?function(){throw Error('handle must remain data')}:{};labels.set(value,name+':'+stamp);return value;},deps]);
    if(suspend&&name==='object')throw pending;
    return React.createElement('span',null,name);
  }
  const tree=(dep,stamp,swap=false)=>React.createElement(strict?React.StrictMode:React.Fragment,null,
    React.createElement(React.Suspense,{fallback:React.createElement('i',null,'waiting')},
      React.createElement(Probe,{key:'object',name:'object',reference:swap?objectB:objectA,deps:[dep],stamp}),
      React.createElement(Probe,{key:'function',name:'function',reference:swap?callbackB:callbackA,deps:[dep],stamp}),
      React.createElement(Probe,{key:'null',name:'null',reference:null,deps:[],stamp}),
      React.createElement(Probe,{key:'undefined',name:'undefined',reference:undefined,deps:undefined,stamp})));
  const render=async(dep,stamp,swap=false)=>{await act(async()=>root.render(tree(dep,stamp,swap)));log.push('cells:'+label(objectA.current)+':'+label(objectB.current));};
  try{
    await render(1,'mount');await render(1,'unchanged');await render(2,'changed');await render(2,'new-ref',true);
    await render(NaN,'nan',true);await render(NaN,'nan-again',true);await render(0,'zero',true);await render(-0,'negative-zero',true);
    suspend=true;await render(3,'abandoned',true);suspend=false;await render(4,'revealed',true);
    await act(async()=>root.unmount());assert.equal(objectA.current,null);assert.equal(objectB.current,null);
    root=createRoot(container);await render(1,'remounted');await act(async()=>root.unmount());
    assert(!log.some(value=>value.startsWith('create:null')||value.startsWith('create:undefined')||value==='must-not-run-ref-cleanup'));
    const report=checkpoint(),execution=transformed?.runtime.execution();
    if(report){
      for(const [index,row] of report.evidence.entries())if(row.kind==='host_ref_write'&&row.value.identity)
        assert(report.evidence.slice(0,index).some(previous=>previous.kind==='host_callback_execution'&&previous.result?.identity===row.value.identity),'Written handle must join its actual creator return');
      assert(report.evidence.some(row=>row.kind==='host_ref_write'));assert(report.evidence.some(row=>row.kind==='host_callback_execution'));}
    if(execution)assert.equal(execution.status,'observed_execution');
    return {status:!report||report.status==='observed_agreement'?'passed':'rejected',reason:report?.failures[0]?.reason,log,report,execution};
  }finally{container.remove();}
}
const baselines=new Map();for(const strict of [false,true])baselines.set(strict,(await scenario(program,{strict,baseline:true})).log);
const check=adapter=>async({program:candidate})=>{const results=[];for(const strict of [false,true]){
  const result=await scenario(candidate,{strict,adapter});assert.deepEqual(result.log,baselines.get(strict),'Instrumentation changed actual React behavior');results.push(result);
}return {status:results.every(row=>row.status==='passed')?'passed':'rejected',reason:results.find(row=>row.reason)?.reason,results};};
const catalogPath=path.resolve(directory,'../../authoring/banks/react-imperative-programs.json');
const saved=fs.existsSync(catalogPath)?JSON.parse(fs.readFileSync(catalogPath)):null;
const skeleton=saved?.skeletons[0]??{schema:'producttrace.library-program-skeleton.v1',package:'react',export_name:'useImperativeHandle',scope,program,host_dependencies,
  versions:[{version:'18.3.1',base_sha256:programHash(program),overrides:[],source_variants:[]}]};
if(writing){const source=portableImplementation(implementation.context),row=skeleton.versions[0];row.source_variants=row.source_variants.filter(item=>item.implementation.runtime.mode!==mode);
  row.source_variants.push({scope,overrides:[],program_sha256:programHash(program),implementation_sha256:programHash(source),implementation:source,
    verification:{kind:'manual_installed_react_18_imperative_handle',build:mode}});}
const bank=createLibraryProgramBank({check:createLibraryProgramVerifier({scope,behavior:check(false),integration:check(true)})});
const admission=await admitCatalogProgram({skeleton,implementation,bank});assert.equal(admission.status,'admitted',JSON.stringify(admission));
const wrongs=[imperativeCallbackProgram({refCleanup:true}),{schema:program.schema,body:{op:'fn',this_mode:'strict',body:{op:'undefined'}}}];
const wrongWrite=structuredClone(program);const corrupt=node=>{if(!node||typeof node!=='object')return;
  if(node.op==='call'&&node.target?.op==='get'&&node.target.key==='write'&&node.args.items[0]?.op==='literal'&&node.args.items[0].value===null)node.args.items[0].value='wrong-detach';
  Object.values(node).forEach(corrupt);
};corrupt(wrongWrite);wrongs.push(wrongWrite);
for(const wrong of wrongs)assert.equal((await check(false)({program:wrong})).status,'rejected');
if(writing)fs.writeFileSync(catalogPath,JSON.stringify({schema:'producttrace.library-program-catalog.v1',skeletons:[skeleton]},null,2)+'\n');
fs.writeFileSync(path.join(directory,`react-imperative-${mode}-results.json`),JSON.stringify({passed:true,version:React.version,build:mode,admission,wrong_rules_rejected:wrongs.length},null,2)+'\n');
dom.window.close();console.log(JSON.stringify({passed:true,version:React.version,build:mode,wrong_rules_rejected:wrongs.length}));
