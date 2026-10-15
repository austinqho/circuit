import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import {createLibraryProgramBank,programHash} from '../../analysis/library-program-bank.mjs';
import {createLibraryProgramVerifier} from '../../authoring/library-program-verifier.mjs';
import {instrumentLibraryPrograms} from '../../analysis/library-program-integration.mjs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {createHostEventBoundary} from '../../analysis/library-host-events.mjs';
import {createReactEffectEventHost} from '../../analysis/library-react-effect-host.mjs';
import {portableImplementation,admitCatalogProgram} from '../../authoring/library-program-catalog.mjs';
import {readCatalogImplementation} from '../../authoring/library-program-catalog.mjs';
import {effectProgram} from './react-effect-program.mjs';

const mode=process.env.NODE_ENV==='production'?'production':'development';
const directory=path.dirname(fileURLToPath(import.meta.url)),rows=[],skeletons=new Map();
const writing=process.argv.includes('--write-catalog');
const catalogPath=path.resolve(directory,'../../authoring/banks/react-effect-programs.json');
const saved=fs.existsSync(catalogPath)?JSON.parse(fs.readFileSync(catalogPath)):null;
for(const version of ['18.2','18','19']){
  const repository=path.join(directory,'react-runtime',version),require=createRequire(path.join(repository,'package.json'));
  const {JSDOM}=require('jsdom'),dom=new JSDOM('<main></main>',{url:'http://localhost/'});
  globalThis.window=dom.window;globalThis.document=dom.window.document;
  Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});globalThis.IS_REACT_ACT_ENVIRONMENT=true;
  for(const [exportName,phase] of [['useEffect','passive'],['useLayoutEffect','layout'],['useInsertionEffect','insertion']]){
    const implementation=readCatalogImplementation({repository,specifier:'react',exportName,
      skeleton:{host_dependencies:[{specifier:'react-dom/client',export_name:'createRoot'}]}});
    const React=require('react'),{createRoot}=require('react-dom/client'),act=mode==='production'?async work=>{let pending;require('react-dom').flushSync(()=>{pending=work()});await pending;await new Promise(resolve=>setImmediate(resolve));}:React.act||require('react-dom/test-utils').act;
    const scope={protocol:'host_event_boundary',hostProtocol:'react_effect_lifecycle',hostPhase:phase,callbackArguments:[0],resultPaths:null,
      description:'Pinned renderer setup and cleanup at independently observed commits and disconnects. Plain fixed-length dependency arrays or omitted dependencies; synchronous setup may return a cleanup. No effect-event overload, errors, cleanup identity observations, server rendering or browser-host claim.'};
    let skeleton=skeletons.get(exportName);
    if(!skeleton){skeleton=structuredClone(saved?.skeletons.find(row=>row.export_name===exportName))??{schema:'producttrace.library-program-skeleton.v1',package:'react',export_name:exportName,program:effectProgram,scope,
      host_dependencies:[{specifier:'react-dom/client',export_name:'createRoot'}],versions:[]};skeletons.set(exportName,skeleton);}
    async function scenario(program,strict,integration=false){
      const boundary=createHostEventBoundary({program}),host=createReactEffectEventHost(React,{phase});
      let invoke=args=>host.invoke({boundary,producer:implementation.producer,args}),checkpoint=()=>boundary.checkpoint(),transformed;
      if(integration==='baseline'){invoke=args=>Reflect.apply(implementation.producer,undefined,args);checkpoint=()=>null;}
      else if(integration){
        const probe=createLibraryProgramBank({check:()=>({status:'passed',reason:'private_integration_probe'})});
        assert.equal((await probe.admit({implementation,program,scope})).status,'admitted');
        const source=`import {${exportName}} from 'react';export function useObserved(setup,deps){return ${exportName}(setup,deps)}`;
        transformed=instrumentLibraryPrograms({source,file:'effect.ts',bank:probe,hostEventHost:host});
        assert.equal(transformed.bindings.length,1);assert.equal(transformed.frontiers.length,0);
        assert.equal(instrumentLibraryPrograms({source,bank:probe}).frontiers[0].reason,'required_lifecycle_host_unavailable');
        const exports={};vm.runInNewContext(ts.transpileModule(transformed.code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
          {exports,require:()=>React,[transformed.runtimeKey]:transformed.runtime});
        invoke=args=>exports.useObserved(...args);checkpoint=()=>transformed.runtime.checkpoint()[0];
      }
      const log=[],container=document.createElement('section');document.querySelector('main').append(container);let root=createRoot(container);
      let suspended=false;const pending=new Promise(()=>{});
      function Probe({name,deps,stamp,noCleanup=false}){
        invoke([()=>{log.push('setup:'+name+':'+stamp);if(!noCleanup)return ()=>{log.push('cleanup:'+name+':'+stamp)}},deps]);
        if(suspended&&name==='a')throw pending;
        return React.createElement('span',null,name);
      }
      let stamp=0;
      const tree=deps=>React.createElement(strict?React.StrictMode:React.Fragment,null,
        React.createElement(React.Suspense,{fallback:React.createElement('i',null,'pending')},
          React.createElement(Probe,{key:'a',name:'a',deps,stamp:++stamp}),React.createElement(Probe,{key:'b',name:'b',deps:[],stamp}),
          React.createElement(Probe,{key:'c',name:'c',deps:undefined,stamp}),React.createElement(Probe,{key:'d',name:'d',deps,stamp,noCleanup:true})));
      try{
        await act(async()=>root.render(tree([1])));
        await act(async()=>root.render(tree([1])));
        await act(async()=>root.render(tree([2])));
        await act(async()=>root.render(tree([NaN])));
        await act(async()=>root.render(tree([NaN])));
        const object={};for(const value of [0,-0,object,object,{}])await act(async()=>root.render(tree([value])));
        suspended=true;await act(async()=>root.render(tree([3])));
        suspended=false;await act(async()=>root.render(tree([4])));
        await act(async()=>root.unmount());
        root=createRoot(container);await act(async()=>root.render(tree([7])));await act(async()=>root.unmount());
        const report=checkpoint();
        if(!report)return {status:'baseline',log};
        const callbacks=report.evidence.filter(row=>row.kind==='host_callback_execution');assert.equal(callbacks.length,log.length);
        const execution=transformed?.runtime.execution();
        if(execution){assert.equal(execution.status,'observed_execution');assert.equal(execution.events.filter(row=>row.kind==='callback_invocation').length,log.length);}
        return {status:report.status==='observed_agreement'?'passed':'rejected',reason:report.failures[0]?.reason,strict,log,report,execution};
      }finally{container.remove();}
    }
    const baselines=new Map();for(const strict of [false,true])baselines.set(strict,(await scenario(effectProgram,strict,'baseline')).log);
    const checkedScenario=async(program,strict,integration)=>{const result=await scenario(program,strict,integration);assert.deepEqual(result.log,baselines.get(strict),'Observer changed actual React effects');return result;};
    const behavior=async({program})=>{const results=[];for(const strict of [false,true])results.push(await checkedScenario(program,strict));
      return {status:results.every(row=>row.status==='passed')?'passed':'rejected',reason:results.find(row=>row.reason)?.reason,results};};
    const integration=async({program})=>{const results=[];for(const strict of [false,true])results.push(await checkedScenario(program,strict,true));
      return {status:results.every(row=>row.status==='passed')?'passed':'rejected',reason:results.find(row=>row.reason)?.reason,results};};
    const helpers=[];
    // Source labels for the two exact minified renderer builds inspected here.
    // These are authoring evidence, not runtime dispatch rules or assumptions
    // about other patch releases; admission still pins the complete source hash.
    const aliases=mode==='production'?{
      '18.2.0':{mountEffectImpl:'ti',updateEffectImpl:'ui',areHookInputsEqual:'Wh',commitHookEffectListMount:'Rj',commitHookEffectListUnmount:'Qj'},
      '18.3.1':{mountEffectImpl:'ki',updateEffectImpl:'li',areHookInputsEqual:'Mh',commitHookEffectListMount:'Qj',commitHookEffectListUnmount:'Pj'},
    }[React.version]:null;
    const names=new Set(['mountEffectImpl','updateEffectImpl','areHookInputsEqual','commitHookEffectListMount','commitHookEffectListUnmount']);
    for(const file of implementation.context.host_dependencies[0].files.filter(row=>row.path.includes('/react-dom/')&&row.path.endsWith('.js'))){
      const text=fs.readFileSync(path.join(repository,file.path),'utf8'),ast=ts.createSourceFile(file.path,text,ts.ScriptTarget.Latest,true);
      const visit=node=>{if(ts.isFunctionDeclaration(node)){const logical=aliases?Object.keys(aliases).find(name=>aliases[name]===node.name?.text):names.has(node.name?.text)?node.name.text:null;if(logical)helpers.push({file:file.path,name:logical,symbol:node.name.text,source:node.getText(ast)});}ts.forEachChild(node,visit);};visit(ast);
    }
    for(const name of names)assert(helpers.some(row=>row.name===name),'Installed renderer helper missing: '+name);
    if(writing){const source=portableImplementation(implementation.context),hash=programHash(effectProgram);
      let row=skeleton.versions.find(row=>row.version===React.version);
      if(!row){row={version:React.version,base_sha256:hash,overrides:[],source_variants:[]};skeleton.versions.push(row);}
      if(!row.source_variants){const previous={...row,scope:skeleton.scope};delete previous.version;delete previous.base_sha256;row.source_variants=[previous];
        delete row.program_sha256;delete row.implementation_sha256;delete row.implementation;delete row.verification;}
      row.source_variants=row.source_variants.filter(item=>item.implementation.runtime.mode!==mode);
      row.source_variants.push({overrides:[],scope,program_sha256:hash,implementation_sha256:programHash(source),implementation:source,
        verification:{kind:'manual_installed_renderer_effect_protocol',build:mode,helpers}});}
    const bank=createLibraryProgramBank({check:createLibraryProgramVerifier({scope,behavior,integration})});
    const admission=await admitCatalogProgram({skeleton,implementation,bank});assert.equal(admission.status,'admitted',JSON.stringify(admission));
    const wrongs=[{schema:effectProgram.schema,body:{op:'fn',this_mode:'strict',body:{op:'undefined'}}}];
    for(const kind of ['cleanup','equality']){
      const wrong=structuredClone(effectProgram);const visit=node=>{
        if(!node||typeof node!=='object')return;
        if(kind==='cleanup'&&node.op==='call'&&node.target?.op==='local'&&node.target.name==='cleanup'){for(const key of Object.keys(node))delete node[key];node.op='undefined';return;}
        if(kind==='equality'&&node.op==='same')node.op='equal';
        Object.values(node).forEach(visit);
      };visit(wrong);wrongs.push(wrong);
    }
    for(const wrong of wrongs)assert.equal((await behavior({program:wrong})).status,'rejected');
    rows.push({version:React.version,build:mode,exportName,passed:true,wrong_rules_rejected:wrongs.length,admission});
  }
  dom.window.close();
}
if(writing)fs.writeFileSync(catalogPath,JSON.stringify({schema:'producttrace.library-program-catalog.v1',skeletons:[...skeletons.values()]},null,2)+'\n');
fs.writeFileSync(path.join(directory,`react-effect-${mode}-results.json`),JSON.stringify({passed:true,rows},null,2)+'\n');
console.log(JSON.stringify({passed:true,cases:rows.length}));
