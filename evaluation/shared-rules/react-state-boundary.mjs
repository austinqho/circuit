import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {createReactStateBoundary,createReactStateHost} from '../../analysis/library-react-state.mjs';
import {createLibraryProgramBank,programHash} from '../../analysis/library-program-bank.mjs';
import {instrumentLibraryPrograms} from '../../analysis/library-program-integration.mjs';
import {createLibraryProgramVerifier} from '../../authoring/library-program-verifier.mjs';
import {readCatalogImplementation,portableImplementation,admitCatalogProgram} from '../../authoring/library-program-catalog.mjs';
import {reactStateProgram} from './react-state-program.mjs';
const directory=path.dirname(fileURLToPath(import.meta.url)),repository=path.join(directory,'react-runtime/18');
const mode=process.env.NODE_ENV==='production'?'production':'development',writing=process.argv.includes('--write-catalog');
const require=createRequire(path.join(repository,'package.json')),{JSDOM}=require('jsdom'),dom=new JSDOM('<main></main>');
globalThis.window=dom.window;globalThis.document=dom.window.document;Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const host_dependencies=[{specifier:'react-dom/client',export_name:'createRoot'}];
const implementations=Object.fromEntries(['useState','useReducer'].map(api=>[api,readCatalogImplementation({repository,specifier:'react',exportName:api,skeleton:{host_dependencies}})]));
const React=require('react'),{createRoot}=require('react-dom/client'),{flushSync}=require('react-dom');
assert.equal(React.version,'18.3.1');
const act=mode==='development'?React.act:async work=>{let result;flushSync(()=>{result=work()});await result;await new Promise(resolve=>setImmediate(resolve))};
const catalogPath=path.resolve(directory,'../../authoring/banks/react-state-programs.json');
const saved=fs.existsSync(catalogPath)?JSON.parse(fs.readFileSync(catalogPath)):null,skeletons=[],results=[];
for(const api of ['useState','useReducer']){
 const implementation=implementations[api],program=reactStateProgram(api);
 const scope={protocol:'react_state_queue',api,callbackArguments:api==='useState'?[0]:[0,2],resultPaths:null,
   description:'Actual initialization and update calculations, stable original dispatch identity, owner reads and observed layout commits. Queue priority and update-to-commit attribution require additional evidence.'};
 async function scenario(candidate,{strict=false,adapter=false,baseline=false}={}){
  const boundary=createReactStateBoundary({api,program:candidate}),host=createReactStateHost(React);
  let invoke=args=>host.invoke({boundary,producer:implementation.producer,args}),dispatch=(fn,value)=>boundary.prepareCall(fn)(value),checkpoint=()=>[boundary.checkpoint()];
  let transformed;
  if(baseline){invoke=args=>Reflect.apply(implementation.producer,undefined,args);dispatch=(fn,value)=>fn(value);checkpoint=()=>[];}
  if(adapter){
   const probe=createLibraryProgramBank({check:()=>({status:'passed',reason:'private_integration_probe'})});assert.equal((await probe.admit({implementation,program:candidate,scope})).status,'admitted');
   const source=`import {${api}} from 'react';export function useObserved(args){return ${api}(${api==='useState'?'args[0]':'args[0],args[1],args[2]'});}export function update(setter,value){return setter(value);}`;
   transformed=instrumentLibraryPrograms({source,file:'state.ts',bank:probe,stateHost:host});assert.equal(transformed.bindings.length,1);assert.equal(transformed.frontiers.length,0);
   const exports={};vm.runInNewContext(ts.transpileModule(transformed.code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
    {exports,require:()=>React,[transformed.runtimeKey]:transformed.runtime});
   invoke=args=>exports.useObserved(args);dispatch=exports.update;checkpoint=()=>transformed.runtime.checkpoint();
  }
  const log=[],pairs=new Map(),initialDispatch=new Map(),container=document.createElement('section');document.querySelector('main').append(container);let root=createRoot(container),suspend=false;
  const pending=new Promise(()=>{}),fmt=value=>typeof value==='function'?'function':Number.isNaN(value)?'NaN':Object.is(value,-0)?'-0':value;
  const functionAction=()=>{throw Error('reducer function action must remain data')};
  const reducer=(previous,action)=>{log.push(['reduce',fmt(previous),action===functionAction?'function':action.kind]);return action===functionAction?23:action.kind==='replace'?action.value:previous+action.value};
  function Probe({name,seed}){
   const args=api==='useState'?[()=>{log.push(['initialize',name]);return seed}]:[reducer,seed,value=>{log.push(['initialize',name]);return value}];
   const pair=invoke(args);if(initialDispatch.has(name))assert.equal(pair[1],initialDispatch.get(name));pairs.set(name,pair);
   React.useLayoutEffect(()=>{initialDispatch.set(name,pair[1]);log.push(['commit',name,fmt(pair[0])])});
   if(suspend&&name==='a')throw pending;
   return React.createElement('output',null,String(fmt(pair[0])));
  }
  const tree=seed=>React.createElement(strict?React.StrictMode:React.Fragment,null,React.createElement(React.Suspense,{fallback:React.createElement('i',null,'waiting')},
    React.createElement(Probe,{key:'a',name:'a',seed}),React.createElement(Probe,{key:'b',name:'b',seed:100})));
  const send=(name,value)=>dispatch(pairs.get(name)[1],value),replace=value=>api==='useState'?value:{kind:'replace',value};
  const render=async seed=>{await act(async()=>root.render(tree(seed)));log.push(['dom',container.textContent]);};
  try{
   await render(2);await render(999);
   await act(async()=>{send('a',replace(10));send('a',api==='useState'?previous=>{log.push(['updater',previous]);return previous+2}:{kind:'add',value:2});});
   assert.equal(pairs.get('a')[0],12);assert.equal(pairs.get('b')[0],100);
   for(const value of [12,NaN,NaN,0,-0])await act(async()=>send('a',replace(value)));
   if(api==='useState'){const stored=()=>{throw Error('stored function cannot be invoked')};await act(async()=>send('a',()=>stored));assert.equal(pairs.get('a')[0],stored);}
   else {await act(async()=>send('a',functionAction));assert.equal(pairs.get('a')[0],23);}
   suspend=true;await render(9);suspend=false;await render(10);
   const old=pairs.get('a')[1];await act(async()=>root.unmount());dispatch(old,replace(500));
   initialDispatch.clear();root=createRoot(container);await render(3);assert.notEqual(pairs.get('a')[1],old);await act(async()=>root.unmount());
   const reports=checkpoint();if(reports.length){
    assert(reports.some(row=>row.evidence.some(event=>event.kind==='state_update_requested')));
    assert(reports.some(row=>row.evidence.some(event=>event.kind==='state_calculation'&&event.request)));
    assert(reports.some(row=>row.evidence.some(event=>event.kind==='state_render_committed')));
   }
   return {status:reports.some(row=>row.status!=='observed_agreement')?'rejected':'passed',log,reports};
  }finally{container.remove();}
 }
 const baselines=new Map();for(const strict of [false,true])baselines.set(strict,(await scenario(program,{strict,baseline:true})).log);
 const check=adapter=>async({program:candidate})=>{const checks=[];for(const strict of [false,true]){
  const result=await scenario(candidate,{strict,adapter});assert.deepEqual(result.log,baselines.get(strict),'State instrumentation changed real application behavior');checks.push(result);
 }return {status:checks.every(row=>row.status==='passed')?'passed':'rejected',results:checks};};
 const skeleton=saved?.skeletons.find(row=>row.export_name===api)??{schema:'producttrace.library-program-skeleton.v1',package:'react',export_name:api,scope,program,host_dependencies,
  versions:[{version:'18.3.1',base_sha256:programHash(program),overrides:[],source_variants:[]}]};
 if(writing){const source=portableImplementation(implementation.context),row=skeleton.versions[0];row.source_variants=row.source_variants.filter(item=>item.implementation.runtime.mode!==mode);
  row.source_variants.push({scope,overrides:[],program_sha256:programHash(program),implementation_sha256:programHash(source),implementation:source,verification:{kind:'manual_react_state_calculation',build:mode}});}
 const bank=createLibraryProgramBank({check:createLibraryProgramVerifier({scope,behavior:check(false),integration:check(true)})});
 const admission=await admitCatalogProgram({skeleton,implementation,bank});assert.equal(admission.status,'admitted',JSON.stringify(admission));
 const wrong={schema:program.schema,body:{op:'undefined'}};assert.equal((await check(false)({program:wrong})).status,'rejected');
 const wrongEquality=structuredClone(program);const mutate=node=>{if(!node||typeof node!=='object')return;if(node.op==='same'&&node.left?.op==='get'&&node.right?.op==='get')node.op='equal';Object.values(node).forEach(mutate)};mutate(wrongEquality);
 assert.equal((await check(false)({program:wrongEquality})).status,'rejected');
 skeletons.push(skeleton);results.push({api,admission,wrong_rules_rejected:2});
}
if(writing)fs.writeFileSync(catalogPath,JSON.stringify({schema:'producttrace.library-program-catalog.v1',skeletons},null,2)+'\n');
fs.writeFileSync(path.join(directory,`react-state-${mode}-results.json`),JSON.stringify({passed:true,version:React.version,build:mode,results},null,2)+'\n');
dom.window.close();console.log(JSON.stringify({passed:true,version:React.version,build:mode,apis:results.map(row=>row.api)}));
