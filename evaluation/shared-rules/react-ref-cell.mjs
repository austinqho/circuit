import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
import {readCatalogImplementation,portableImplementation,programOverrides,admitCatalogProgram} from '../../authoring/library-program-catalog.mjs';
import {createLibraryProgramVerifier} from '../../authoring/library-program-verifier.mjs';
import {createLibraryProgramBank,programHash} from '../../analysis/library-program-bank.mjs';
import {createOwnedValueBoundary} from '../../analysis/library-owned-value.mjs';
import {createReactReferenceOwnerHost} from '../../analysis/library-owned-reference.mjs';
import {instrumentLibraryPrograms} from '../../analysis/library-program-integration.mjs';
const directory=path.dirname(fileURLToPath(import.meta.url)),catalogPath=path.resolve(directory,'../../authoring/banks/react-ref-cell-programs.json');
const writing=process.argv.includes('--write-catalog');
const scope={protocol:'owned_call_boundary',callbackArguments:[],resultPaths:null,
  description:'Mounted useRef cell identity and initial current value across subsequent invocations in a host-attested slot. Program bootstraps a private closure per owner. Normal data/default-function values only, with no application callback execution. External ref writes, commit claims and scheduling require separate evidence; unexplained writes remain frontiers. Named-import calls have an undefined receiver.'};
const program={schema:'producttrace.library-program.v1',body:{op:'bind',name:'cell',value:{op:'undefined'},body:{op:'fn',this_mode:'strict',body:{
  op:'if',test:{op:'equal',left:{op:'local',name:'cell'},right:{op:'undefined'}},
  then:{op:'set',name:'cell',value:{op:'object',entries:{current:{op:'arg',index:0}}}},else:{op:'local',name:'cell'},
}}}};
let skeleton=writing?{schema:'producttrace.library-program-skeleton.v1',package:'react',export_name:'useRef',program,scope,versions:[],
  host_dependencies:[{specifier:'react-dom/client',export_name:'createRoot',role:'mounted_slot_host'}]}:JSON.parse(fs.readFileSync(catalogPath)).skeletons[0];
const results=[];
for(const major of ['18.2','18','19']){
  const repository=path.join(directory,'react-runtime',major),require=createRequire(path.join(repository,'package.json'));
  const {JSDOM}=require('jsdom'),dom=new JSDOM('<main></main>',{url:'http://localhost/'});
  globalThis.window=dom.window;globalThis.document=dom.window.document;
  Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});globalThis.IS_REACT_ACT_ENVIRONMENT=true;
  const implementation=readCatalogImplementation({repository,specifier:'react',exportName:'useRef',skeleton});
  const React=require('react'),{createRoot}=require('react-dom/client'),host=createReactReferenceOwnerHost(React),act=React.act || require('react-dom/test-utils').act;
  // Retain the actual mounted-cell helper, not just React's dispatcher wrapper.
  const hostContext=implementation.context.host_dependencies[0];
  const rendererFiles=hostContext.files.filter(row=>row.path.includes('/react-dom/')&&row.path.endsWith('.js'));
  const sources=rendererFiles.map(row=>({file:row.path,text:fs.readFileSync(path.join(repository,row.path),'utf8')}));
  const source=sources.find(row=>row.text.includes('function mountRef('));assert(source);
  const ast=ts.createSourceFile(source.file,source.text,ts.ScriptTarget.Latest,true),helpers=[];
  const visit=node=>{
    if(ts.isFunctionDeclaration(node)&&['mountRef','updateRef'].includes(node.name?.text))helpers.push({name:node.name.text,source:node.getText(ast)});
    if(major==='19'&&ts.isPropertyAssignment(node)&&node.name.getText(ast)==='useRef'&&ts.isBinaryExpression(node.parent?.parent)
      &&node.parent.parent.left.getText(ast)==='HooksDispatcherOnUpdateInDEV')helpers.push({name:'updateRef',source:node.getText(ast)});
    ts.forEachChild(node,visit);
  };visit(ast);assert.equal(helpers.length,2);
  async function scenario(invoke,checkpoint,{strict=false,outsideWrite=false}={}){
    const container=document.createElement('section');document.querySelector('main').append(container);let root=createRoot(container);
    const seen=new Map(),initials={a:{label:'first-a'},b:{label:'first-b'},function:()=>{throw Error('default must not be called')},nan:NaN,empty:undefined};
    let suspended=false;const pending=new Promise(()=>{});
    function Probe({name,initial}){
      const value=invoke(initial);seen.set(name,value);
      if(suspended&&name==='a')throw pending;
      return React.createElement('span',{'data-owner':name},name);
    }
    const tree=changed=>React.createElement(strict?React.StrictMode:React.Fragment,null,
      React.createElement(React.Suspense,{fallback:React.createElement('i',null,'pending')},
        ...Object.keys(initials).map(name=>React.createElement(Probe,{key:name,name,initial:changed?{later:name}:initials[name]}))));
    try{
      await act(async()=>root.render(tree(false)));
      const first=new Map(seen);assert.equal(new Set(first.values()).size,5);
      for(const [name,value] of first)assert(Object.is(value.current,initials[name]));
      await act(async()=>root.render(tree(true)));
      for(const [name,value] of first)assert.equal(seen.get(name),value);
      suspended=true;await act(async()=>root.render(tree(true)));
      suspended=false;await act(async()=>root.render(tree(true)));
      for(const [name,value] of first)assert.equal(seen.get(name),value);
      if(outsideWrite){first.get('a').current={outside:true};await act(async()=>root.render(tree(true)));assert.equal(seen.get('a').current.outside,true);}
      await act(async()=>root.unmount());
      root=createRoot(container);await act(async()=>root.render(tree(false)));
      for(const [name,value] of first)assert.notEqual(seen.get(name),value);
      const report=checkpoint();return {status:report.status==='observed_agreement'?'passed':'rejected',reason:report.failures?.[0]?.reason||report.reports?.flatMap(row=>row.failures||[])[0]?.reason,report,strict};
    }finally{await act(async()=>root.unmount());container.remove();}
  }
  const behavior=async({program})=>{
    const rows=[];
    for(const strict of [false,true]){
      const boundary=createOwnedValueBoundary({producer:implementation.producer,program,captureOwner:host.captureOwner});
      rows.push(await scenario(value=>boundary.invoke([value]),()=>boundary.checkpoint(),{strict}));
    }
    return {status:rows.every(row=>row.status==='passed')?'passed':'rejected',reason:rows.find(row=>row.reason)?.reason,rows};
  };
  const integration=async({program})=>{
    const probe=createLibraryProgramBank({check:()=>({status:'passed',reason:'isolated_integration_probe'})});
    assert.equal((await probe.admit({implementation,program,scope})).status,'admitted');
    const source="import {useRef} from 'react'; export function useObserved(initial){return useRef(initial)}";
    const transformed=instrumentLibraryPrograms({source,file:'ref-slot.ts',bank:probe,ownedReferenceHost:host});
    assert.equal(transformed.bindings.length,1);assert.equal(transformed.frontiers.length,0);
    const exports={};vm.runInNewContext(ts.transpileModule(transformed.code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
      {exports,require:()=>React,[transformed.runtimeKey]:transformed.runtime});
    const checked=await scenario(exports.useObserved,()=>transformed.runtime.checkpoint()[0]);
    assert(checked.report.evidence.length>0);assert(checked.report.evidence.every(row=>row.owner&&row.occurrence));
    return checked;
  };
  if(writing){const portable=portableImplementation(implementation.context);skeleton.versions.push({version:React.version,base_sha256:programHash(skeleton.program),overrides:programOverrides(skeleton.program,program),
    program_sha256:programHash(program),implementation_sha256:programHash(portable),implementation:portable,verification:{origin:'manual_installed_mount_and_update_ref_source',helpers}});}
  const bank=createLibraryProgramBank({check:createLibraryProgramVerifier({scope,behavior,integration})});
  const admitted=await admitCatalogProgram({skeleton,implementation,bank});assert.equal(admitted.status,'admitted',JSON.stringify(admitted));
  const wrongs=[{...program,body:{op:'fn',this_mode:'strict',body:{op:'object',entries:{current:{op:'arg',index:0}}}}},structuredClone(program)];
  wrongs[1].body.body.body.then.value.entries.current={op:'literal',value:null};
  for(const wrong of wrongs)assert.equal((await behavior({program:wrong})).status,'rejected');
  const outside=createOwnedValueBoundary({producer:implementation.producer,program,captureOwner:host.captureOwner});
  const outsideResult=await scenario(value=>outside.invoke([value]),()=>outside.checkpoint(),{outsideWrite:true});assert.equal(outsideResult.status,'rejected');
  const missing=instrumentLibraryPrograms({source:"import {useRef} from 'react';useRef(null)",bank});assert.equal(missing.frontiers[0].reason,'required_owner_host_unavailable');
  results.push({version:React.version,passed:true,wrong_rules_rejected:2,outside_write_frontier:outsideResult.reason,admission:admitted,helpers});dom.window.close();
}
if(writing)fs.writeFileSync(catalogPath,JSON.stringify({schema:'producttrace.library-program-catalog.v1',skeletons:[skeleton]},null,2)+'\n');
fs.writeFileSync(path.join(directory,'react-ref-cell-results.json'),JSON.stringify({passed:true,model_requests:0,model_spend_usd:0,results},null,2)+'\n');
console.log(JSON.stringify({passed:true,versions:results.map(row=>row.version),wrong_rules_rejected:results.length*2,outside_write_frontiers:results.length,model_requests:0}));
