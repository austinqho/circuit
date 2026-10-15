import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {createLibraryBoundary} from '../../analysis/library-boundary.mjs';
import {createLibraryProgramBank,programHash} from '../../analysis/library-program-bank.mjs';
import {instrumentLibraryPrograms} from '../../analysis/library-program-integration.mjs';
import {createLibraryProgramVerifier} from '../../authoring/library-program-verifier.mjs';
import {readCatalogImplementation,portableImplementation,admitCatalogProgram} from '../../authoring/library-program-catalog.mjs';
import {p,arg,array,call,choose,undef} from './programs.mjs';
const directory=path.dirname(fileURLToPath(import.meta.url)),repository=path.join(directory,'react-runtime/18'),require=createRequire(path.join(repository,'package.json'));
const mode=process.env.NODE_ENV==='production'?'production':'development',writing=process.argv.includes('--write-catalog'),{JSDOM}=require('jsdom'),dom=new JSDOM('<main></main>');
globalThis.window=dom.window;globalThis.document=dom.window.document;Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
const host_dependencies=[{specifier:'react-dom/client',export_name:'createRoot'}];
const apis=['flushSync','unstable_batchedUpdates'];
const implementations=Object.fromEntries(apis.map(api=>[api,readCatalogImplementation({repository,specifier:'react-dom',exportName:api,skeleton:{host_dependencies}})]));
const React=require('react'),ReactDOM=require('react-dom'),{createRoot}=require('react-dom/client');assert.equal(React.version,'18.3.1');
const catalogPath=path.resolve(directory,'../../authoring/banks/react-dom-scope-programs.json'),saved=fs.existsSync(catalogPath)?JSON.parse(fs.readFileSync(catalogPath)):null,skeletons=[],results=[];
for(const api of apis){
 const implementation=implementations[api],program=p(api==='flushSync'?choose(arg(0),call(arg(0),array()),undef):call(arg(0),array(arg(1))));
 const scope={callbackArguments:[0],resultPaths:null,description:'React DOM 18.3.1 synchronous scope invocation, exact callback argument and return/throw. Separate actual commit probes check flush timing; pending-work causal ownership is not inferred.'};
 const behavior=async({program:candidate})=>{
  const boundary=createLibraryBoundary({producer:implementation.producer,program:candidate,...scope});let calls=0;
  const input={},output={},callback=function(...args){assert.equal(this,undefined);assert.deepEqual(args,api==='flushSync'?[]:[input]);calls++;return output};
  assert.equal(boundary.invoke([callback,input]),output);assert.equal(calls,1);
  const error=new Error('scope callback failed');assert.throws(()=>boundary.invoke([()=>{calls++;throw error}]),value=>value===error);assert.equal(calls,2);
  if(api==='flushSync')for(const value of [undefined,null,false,0,''])assert.equal(boundary.invoke([value]),undefined);
  else {let args;assert.equal(boundary.invoke([(...values)=>{args=values;return 7}]),7);assert.deepEqual(args,[undefined]);}
  const report=boundary.checkpoint();return {status:report.status==='observed_agreement'?'passed':'rejected',report};
 };
 async function application(candidate,{baseline=false,legacy=false}={}){
  let transformed,invoke=(callback,arg)=>implementation.producer(callback,arg);
  if(!baseline){const probe=createLibraryProgramBank({check:()=>({status:'passed',reason:'private_source_probe'})});assert.equal((await probe.admit({implementation,program:candidate,scope})).status,'admitted');
   transformed=instrumentLibraryPrograms({source:`import {${api}} from 'react-dom';export function run(callback,input){return ${api}(callback,input)}`,file:'dom-scope.ts',bank:probe});
   assert.equal(transformed.bindings.length,1);const exports={};vm.runInNewContext(ts.transpileModule(transformed.code,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports,require:()=>ReactDOM,[transformed.runtimeKey]:transformed.runtime});invoke=exports.run;
  }
  const container=document.createElement('section');document.querySelector('main').append(container);const log=[];let setter;let root;
  function Probe(){const [value,set]=React.useState(0);setter=set;React.useLayoutEffect(()=>{log.push(['commit',value])});return React.createElement('output',null,value)}
  const oldError=console.error;console.error=(message,...rest)=>{if(typeof message==='string'&&/ReactDOM.render is no longer supported|unmountComponentAtNode is deprecated/.test(message))return;oldError(message,...rest)};
  try{
   if(legacy)ReactDOM.render(React.createElement(Probe),container);else{root=createRoot(container);ReactDOM.flushSync(()=>root.render(React.createElement(Probe)));}
   let callbackContext=null;
   const returned=invoke(input=>{callbackContext=transformed?.runtime.currentExecution();log.push(['before',container.textContent,input??null]);setter(1);setter(2);log.push(['inside',container.textContent]);return 42},'input');
   log.push(['after',container.textContent,returned]);
   if(api==='flushSync'||legacy)assert.equal(container.textContent,'2');
   ReactDOM.flushSync(()=>setter(3));assert.equal(container.textContent,'3');
   if(root)ReactDOM.flushSync(()=>root.unmount());else ReactDOM.unmountComponentAtNode(container);
   const reports=transformed?.runtime.checkpoint()??[];
   if(transformed){assert.equal(callbackContext.kind,'callback_invocation');assert(callbackContext.parent_id);}
   return {status:reports.every(row=>row.status==='observed_agreement')?'passed':'rejected',log,reports,execution:transformed?.runtime.execution()};
  }finally{console.error=oldError;container.remove()}
 }
 const baselines=new Map();for(const legacy of [false,true])baselines.set(legacy,(await application(program,{baseline:true,legacy})).log);
 const integration=async({program:candidate})=>{const results=[];for(const legacy of [false,true]){const result=await application(candidate,{legacy});assert.deepEqual(result.log,baselines.get(legacy),'Scope instrumentation changed update/commit ordering');results.push(result)}return {status:results.every(row=>row.status==='passed')?'passed':'rejected',results}};
 const skeleton=saved?.skeletons.find(row=>row.export_name===api)??{schema:'producttrace.library-program-skeleton.v1',package:'react-dom',export_name:api,scope,program,host_dependencies,versions:[{version:'18.3.1',base_sha256:programHash(program),overrides:[],source_variants:[]}]};
 if(writing){const source=portableImplementation(implementation.context),row=skeleton.versions[0];row.source_variants=row.source_variants.filter(item=>item.implementation.runtime.mode!==mode);row.source_variants.push({scope,overrides:[],program_sha256:programHash(program),implementation_sha256:programHash(source),implementation:source,verification:{kind:'manual_exact_react_dom_scope',build:mode}})}
 const bank=createLibraryProgramBank({check:createLibraryProgramVerifier({scope,behavior,integration})});const admission=await admitCatalogProgram({skeleton,implementation,bank});assert.equal(admission.status,'admitted',JSON.stringify(admission));
 const wrongs=[p(undef),p(call(arg(0),api==='flushSync'?array(arg(1)):array()))];for(const wrong of wrongs)assert.equal((await behavior({program:wrong})).status,'rejected');
 skeletons.push(skeleton);results.push({api,admission,wrong_rules_rejected:wrongs.length});
}
if(writing)fs.writeFileSync(catalogPath,JSON.stringify({schema:'producttrace.library-program-catalog.v1',skeletons},null,2)+'\n');
fs.writeFileSync(path.join(directory,`react-dom-scope-${mode}-results.json`),JSON.stringify({passed:true,version:'18.3.1',build:mode,results},null,2)+'\n');
dom.window.close();console.log(JSON.stringify({passed:true,version:'18.3.1',build:mode,apis}));
