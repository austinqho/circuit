import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
import {readCatalogImplementation,portableImplementation,admitCatalogProgram} from '../../authoring/library-program-catalog.mjs';
import {createLibraryProgramVerifier} from '../../authoring/library-program-verifier.mjs';
import {createLibraryProgramBank,programHash} from '../../analysis/library-program-bank.mjs';
import {createOwnedValueBoundary} from '../../analysis/library-owned-value.mjs';
import {createReactReferenceOwnerHost} from '../../analysis/library-owned-reference.mjs';
import {instrumentLibraryPrograms} from '../../analysis/library-program-integration.mjs';
const mode=process.env.NODE_ENV==='production'?'production':'development';
const directory=path.dirname(fileURLToPath(import.meta.url)),catalogPath=path.resolve(directory,'../../authoring/banks/react-context-read-programs.json');
const writing=process.argv.includes('--write-catalog');
const scope={protocol:'owned_call_boundary',callbackArguments:[],resultPaths:null,dataReadEvidence:true,accessorObservation:'opaque_descriptors',
  description:'Actual useContext reads in a host-attested mounted slot of the pinned primary React DOM renderer. The executed program reads the exact current context value, retaining input-path and owner evidence. Provider identity, commit status and which update scheduled a render require additional evidence; this program does not claim those facts. Ordinary own-data values and functions are supported; accessor reads, proxies and other renderers are outside this scope; unaccessed warning descriptors remain opaque.'};
// Manual source transcription, not a model proposal or a model prompt answer.
const program={schema:'producttrace.library-program.v1',body:{op:'fn',this_mode:'strict',body:{op:'get',value:{op:'arg',index:0},key:'_currentValue'}}};
let skeleton=writing?{schema:'producttrace.library-program-skeleton.v1',package:'react',export_name:'useContext',scope,program,versions:[],
  host_dependencies:[{specifier:'react-dom/client',export_name:'createRoot',role:'primary_renderer_context_reader'}]}:JSON.parse(fs.readFileSync(catalogPath)).skeletons[0];
if(writing&&fs.existsSync(catalogPath)){const previous=JSON.parse(fs.readFileSync(catalogPath)).skeletons[0];assert.equal(programHash(previous.program),programHash(program));skeleton.versions=previous.versions;skeleton.versions.forEach(row=>{if(!row.source_variants)row.source_variants=[{...row}];});}
const results=[];
for(const fixture of ['18.2','18','19']) {
  const repository=path.join(directory,'react-runtime',fixture),require=createRequire(path.join(repository,'package.json'));
  const {JSDOM}=require('jsdom'),dom=new JSDOM('<main></main>',{url:'http://localhost/'});
  globalThis.window=dom.window;globalThis.document=dom.window.document;
  Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
  const implementation=readCatalogImplementation({repository,specifier:'react',exportName:'useContext',skeleton});
  const React=require('react'),{createRoot}=require('react-dom/client'),{flushSync}=require('react-dom'),host=createReactReferenceOwnerHost(React);
  const helpers=[];
  for(const row of implementation.context.host_dependencies[0].files.filter(row=>row.path.includes('/react-dom/')&&row.path.endsWith('.js'))) {
    const text=fs.readFileSync(path.join(repository,row.path),'utf8'),ast=ts.createSourceFile(row.path,text,ts.ScriptTarget.Latest,true),decls=new Map(),entries=[];
    const collect=node=>{if(ts.isFunctionDeclaration(node)&&node.name)decls.set(node.name.text,node);if(ts.isPropertyAssignment(node)&&node.name.getText(ast)==='useContext')entries.push(node.initializer);ts.forEachChild(node,collect)};collect(ast);
    const seen=new Set();
    const follow=(entry,depth=0)=>{
      const node=ts.isIdentifier(entry)?decls.get(entry.text):entry;if(!node||seen.has(node)||depth>4)return;seen.add(node);
      const source=node.getText(ast);
      if(source.includes('_currentValue')){helpers.push({file:row.path,source});return;}
      const visit=child=>{if(ts.isCallExpression(child)&&ts.isIdentifier(child.expression))follow(child.expression,depth+1);ts.forEachChild(child,visit)};visit(node);
    };
    entries.forEach(entry=>follow(entry));
  }
  assert(helpers.length,'Exact dispatcher path reaches a renderer context read');
  function scenario(invoke,checkpoint,{rollback=false,strict=false}={}) {
    const container=document.createElement('section');document.querySelector('main').append(container);const root=createRoot(container);
    const defaultValue={label:'default'},otherDefault={label:'other'},context=React.createContext(defaultValue),other=React.createContext(otherDefault);
    const seen=new Map(),counts=new Map();let suspend=false,retry=0;const pending=new Promise(()=>{}),functionValue=()=>{throw Error('context function is data')};
    const Reader=React.memo(function Reader({name,selected}){
      const value=invoke(selected);seen.set(name,value);counts.set(name,(counts.get(name)||0)+1);
      if(suspend&&name==='outer')throw pending;
      return React.createElement('span',null,name);
    });
    const child=(name,selected=context)=>React.createElement(Reader,{name,selected,key:name,retry});
    const nested={label:'nested'};
    const tree=value=>React.createElement(strict?React.StrictMode:React.Fragment,null,
      React.createElement(context.Provider,{value},React.createElement(React.Suspense,{fallback:React.createElement('i',null,'pending')},
        child('outer'),React.createElement(context.Provider,{value:nested},child('nested')),child('other',other))),child('outside'));
    try {
      const supplied={label:'supplied'};flushSync(()=>root.render(tree(supplied)));
      assert.equal(seen.get('outer'),supplied);assert.equal(seen.get('nested'),nested);assert.equal(seen.get('other'),otherDefault);assert.equal(seen.get('outside'),defaultValue);
      const initialCounts=new Map(counts),renderMultiplier=strict&&mode==='development'?2:1;
      let updateChecks=0;
      if(rollback) {
        suspend=true;flushSync(()=>root.render(tree({label:'abandoned'})));
        // An abandoned read is not a committed value. Force a new consumer
        // invocation instead of assuming memoized consumers must rerender.
        suspend=false;retry++;flushSync(()=>root.render(tree(supplied)));
        assert.equal(seen.get('outer'),supplied);assert.equal(context._currentValue,defaultValue);updateChecks=2;
      } else {
        for(const value of [supplied,undefined,null,NaN,NaN,-0,0,functionValue,functionValue]) {
          const previous=seen.get('outer'),before=counts.get('outer');flushSync(()=>root.render(tree(value)));
          assert(Object.is(seen.get('outer'),value));assert.equal(counts.get('outer'),before+(Object.is(previous,value)?0:renderMultiplier));
          for(const name of ['nested','other','outside'])assert.equal(counts.get(name),initialCounts.get(name));
          assert.equal(context._currentValue,defaultValue);updateChecks++;
        }
      }
      const report=checkpoint();return {status:report.status==='observed_agreement'?'passed':'rejected',reason:report.failures?.[0]?.reason||report.reports?.flatMap(row=>row.failures||[])[0]?.reason,report,updateChecks,rollback,strict};
    } finally {flushSync(()=>root.unmount());container.remove()}
  }
  const behavior=({program})=>{
    const checks=[false,true].flatMap(strict=>[false,true].map(rollback=>{
      const boundary=createOwnedValueBoundary({producer:implementation.producer,program,captureOwner:host.captureOwner,dataReadEvidence:true,accessorObservation:scope.accessorObservation});
      return scenario(context=>boundary.invoke([context]),()=>boundary.checkpoint(),{rollback,strict});
    }));
    return {status:checks.every(row=>row.status==='passed')?'passed':'rejected',reason:checks.find(row=>row.reason)?.reason,checks};
  };
  const integration=async({program})=>{
    const bank=createLibraryProgramBank({check:()=>({status:'passed',reason:'isolated_integration_probe'})});assert.equal((await bank.admit({implementation,program,scope})).status,'admitted');
    const source="import {useContext} from 'react';export function useObserved(context){return useContext(context)}";
    const transformed=instrumentLibraryPrograms({source,file:'context-value.ts',bank,ownedReferenceHost:host});assert.equal(transformed.bindings.length,1);assert.equal(transformed.frontiers.length,0);
    const exports={};vm.runInNewContext(ts.transpileModule(transformed.code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:()=>React,[transformed.runtimeKey]:transformed.runtime});
    const checked=scenario(exports.useObserved,()=>transformed.runtime.checkpoint()[0]);
    const reads=checked.report.evidence.filter(row=>row.kind==='rule_data_read');assert(reads.length>=4);
    assert.equal(new Set(reads.map(row=>row.owner)).size,4);
    for(const read of reads){assert(read.input_paths.some(path=>JSON.stringify(path)===JSON.stringify([0,'_currentValue'])));assert(read.input_paths.every(path=>path.at(-1)==='_currentValue'));assert(read.matches_predicted_result);assert(read.owner);assert(checked.report.evidence.some(value=>value.kind==='returned_value'&&value.boundary_occurrence===read.occurrence&&value.owner===read.owner));}
    return checked;
  };
  if(writing){
    const source=portableImplementation(implementation.context),variant={overrides:[],scope,program_sha256:programHash(program),implementation_sha256:programHash(source),implementation:source,verification:{origin:'manual_exact_primary_renderer_context_read',build:mode,helpers}};
    let row=skeleton.versions.find(row=>row.version===React.version);
    if(!row){row={version:React.version,base_sha256:programHash(program),overrides:[],source_variants:[]};skeleton.versions.push(row);}
    row.source_variants=row.source_variants.filter(previous=>previous.implementation.runtime.mode!==source.runtime.mode);row.source_variants.push(variant);
  }
  const bank=createLibraryProgramBank({check:createLibraryProgramVerifier({scope,behavior,integration})}),admitted=await admitCatalogProgram({skeleton,implementation,bank});
  assert.equal(admitted.status,'admitted',JSON.stringify(admitted));
  const wrongs=[structuredClone(program),structuredClone(program),structuredClone(program)];
  wrongs[0].body.body.key='_currentValue2';wrongs[1].body.body={op:'arg',index:0};wrongs[2].body.body={op:'undefined'};
  for(const wrong of wrongs)assert.equal(behavior({program:wrong}).status,'rejected');
  results.push({version:React.version,passed:true,wrong_rules_rejected:wrongs.length,admission:admitted,helpers});dom.window.close();
}
if(writing)fs.writeFileSync(catalogPath,JSON.stringify({schema:'producttrace.library-program-catalog.v1',skeletons:[skeleton]},null,2)+'\n');
fs.writeFileSync(path.join(directory,`react-context-read-${mode}-results.json`),JSON.stringify({passed:true,mode,model_requests:0,results},null,2)+'\n');
console.log(JSON.stringify({passed:true,versions:results.map(row=>row.version),wrong_rules_rejected:results.length*3,model_requests:0}));
