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
import {createReactReferenceOwnerHost,createReactMemoOwnerHost} from '../../analysis/library-owned-reference.mjs';
import {instrumentLibraryPrograms} from '../../analysis/library-program-integration.mjs';
import {reactMemoProgram as program,reactMemoScope as scope} from './react-memo-program.mjs';
assert.equal(process.env.NODE_ENV,'production','This scope requires the actual production renderer.');
const directory=path.dirname(fileURLToPath(import.meta.url)),catalogPath=path.resolve(directory,'../../authoring/banks/react-memo-programs.json');
const writing=process.argv.includes('--write-catalog');
const skeleton=writing?{schema:'producttrace.library-program-skeleton.v1',package:'react',export_name:'useMemo',scope,program,versions:[],
  host_dependencies:[{specifier:'react-dom/client',export_name:'createRoot',role:'mounted_slot_host'}]}:JSON.parse(fs.readFileSync(catalogPath)).skeletons[0];
const results=[];
for(const fixture of ['18.2','18','19']) {
  const repository=path.join(directory,'react-runtime',fixture),require=createRequire(path.join(repository,'package.json'));
  const {JSDOM}=require('jsdom'),dom=new JSDOM('<main></main>',{url:'http://localhost/'});
  globalThis.window=dom.window;globalThis.document=dom.window.document;
  Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
  const implementation=readCatalogImplementation({repository,specifier:'react',exportName:'useMemo',skeleton});
  const React=require('react'),{createRoot}=require('react-dom/client'),{flushSync}=require('react-dom'),host=createReactMemoOwnerHost(React);
  // Resolve the actual dispatcher methods, including minified identifier
  // references, rather than using the exported dispatcher wrapper as evidence.
  const helpers=[];
  for(const row of implementation.context.host_dependencies[0].files.filter(row=>row.path.includes('/react-dom/')&&row.path.endsWith('.js'))) {
    const text=fs.readFileSync(path.join(repository,row.path),'utf8'),ast=ts.createSourceFile(row.path,text,ts.ScriptTarget.Latest,true);
    const declarations=new Map();const collect=node=>{if(ts.isFunctionDeclaration(node)&&node.name)declarations.set(node.name.text,node);ts.forEachChild(node,collect)};collect(ast);
    const visit=node=>{
      if(ts.isPropertyAssignment(node)&&node.name.getText(ast)==='useMemo') {
        const target=ts.isIdentifier(node.initializer)?declarations.get(node.initializer.text):node.initializer;
        if(target&&target.getText(ast).includes('memoizedState'))helpers.push({file:row.path,source:target.getText(ast)});
      }
      ts.forEachChild(node,visit);
    };visit(ast);
  }
  const selected=[...new Map(helpers.map(row=>[row.source,row])).values()];assert.equal(selected.length,2,'mount and update helpers');
  const source="import {useMemo} from 'react';export function useObserved(create,deps){return useMemo(create,deps)}";
  function scenario(invoke,checkpoint,{strict=false,rollback=false,initialSuspension=false,renderPhase=false}={}) {
    const container=document.createElement('section');document.querySelector('main').append(container);
    let root=createRoot(container),suspend=false;
    const pending=new Promise(()=>{}),seen=new Map(),counts={a:0,b:0};
    const functionValue=()=>42;
    function Probe({name,deps}) {
      const [phase,setPhase]=React.useState(0);
      const value=invoke(()=>{counts[name]++;return name==='a'?{owner:name,count:counts[name]}:functionValue},deps);
      seen.set(name,value);if(suspend&&name==='a')throw pending;
      if(renderPhase&&phase===0)setPhase(1);
      return React.createElement('span',null,name);
    }
    const tree=deps=>React.createElement(strict?React.StrictMode:React.Fragment,null,
      React.createElement(React.Suspense,{fallback:React.createElement('i',null,'pending')},
        React.createElement(Probe,{name:'a',deps}),React.createElement(Probe,{name:'b',deps:[77]})));
    try {
      if(initialSuspension) {
        suspend=true;flushSync(()=>root.render(tree([1])));
        suspend=false;flushSync(()=>root.render(tree([1])));
        assert(seen.has('a'));assert.equal(container.textContent,'ab');
      } else if(rollback) {
        flushSync(()=>root.render(tree([1])));const first=seen.get('a');
        suspend=true;flushSync(()=>root.render(tree([2])));
        suspend=false;flushSync(()=>root.render(tree([1])));
        assert.equal(seen.get('a'),first,'React restored its previously committed memo');
      } else {
        const cases=[[[1],1],[[1],1],[[NaN],2],[[NaN],2],[[-0],3],[[0],4],[undefined,5],[undefined,6],[null,7],[null,8],[[],9],[[100],9],[[101],9]];
        let previous;
        for(const [deps,count] of cases) {
          const before=counts.a;flushSync(()=>root.render(tree(deps)));
          assert.equal(counts.a,count);assert.equal(counts.b,1);assert.equal(seen.get('b'),functionValue);
          if(count===before)assert.equal(seen.get('a'),previous);
          previous=seen.get('a');
        }
        flushSync(()=>root.unmount());root=createRoot(container);flushSync(()=>root.render(tree([1])));
        assert.notEqual(seen.get('a'),previous);assert.equal(counts.a,10);assert.equal(counts.b,2);
      }
      const report=checkpoint();return {status:report.status==='observed_agreement'?'passed':'rejected',
        reason:report.failures?.[0]?.reason||report.reports?.flatMap(row=>row.failures||[])[0]?.reason,report,counts,strict,rollback,initialSuspension,renderPhase};
    } finally {flushSync(()=>root.unmount());container.remove()}
  }
  const behavior=({program})=>{
    const checks=[false,true].map(strict=>{const boundary=createOwnedValueBoundary({producer:implementation.producer,program,callbackArguments:scope.callbackArguments,captureOwner:host.captureOwner,captureGeneration:host.captureGeneration});return scenario((...args)=>boundary.invoke(args),()=>boundary.checkpoint(),{strict})});
    for(const options of [{rollback:true},{initialSuspension:true},{renderPhase:true}]) {
    const rollbackBoundary=createOwnedValueBoundary({producer:implementation.producer,program,callbackArguments:[0],captureOwner:host.captureOwner,captureGeneration:host.captureGeneration});
    checks.push(scenario((...args)=>rollbackBoundary.invoke(args),()=>rollbackBoundary.checkpoint(),options));
    }
    return {status:checks.every(row=>row.status==='passed')?'passed':'rejected',reason:checks.find(row=>row.reason)?.reason,checks};
  };
  const integration=async({program})=>{
    const probe=createLibraryProgramBank({check:()=>({status:'passed',reason:'isolated_integration_probe'})});
    assert.equal((await probe.admit({implementation,program,scope})).status,'admitted');
    assert.equal(instrumentLibraryPrograms({source,bank:probe,ownedReferenceHost:createReactReferenceOwnerHost(React)}).frontiers[0].reason,'required_generation_host_unavailable');
    const transformed=instrumentLibraryPrograms({source,file:'memo-slot.ts',bank:probe,ownedReferenceHost:host});
    assert.equal(transformed.bindings.length,1);assert.equal(transformed.frontiers.length,0);
    const exports={};vm.runInNewContext(ts.transpileModule(transformed.code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
      {exports,require:()=>React,[transformed.runtimeKey]:transformed.runtime});
    const callbackExecutions=[];
    const result=scenario((create,deps)=>exports.useObserved(()=>{
      callbackExecutions.push(transformed.runtime.currentExecution());return create();
    },deps),()=>transformed.runtime.checkpoint()[0]);
    const calls=result.report.evidence.filter(row=>row.kind==='callback_invocation');
    assert.equal(calls.length,12);
    const execution=transformed.runtime.execution(),events=execution.events,byId=new Map(events.map(row=>[row.id,row]));
    assert.equal(execution.status,'observed_execution');
    assert.equal(events.length,result.report.calls+calls.length,'Private marker hooks and replay bootstrap are not application execution events');
    assert.deepEqual(callbackExecutions.map(row=>row.id).sort(),calls.map(row=>row.execution_id).sort());
    for(const value of result.report.evidence.filter(row=>row.kind==='returned_value')) {
      const actual=byId.get(value.execution_id);assert(actual);assert.equal(actual.kind,'library_invocation');
      assert.equal(actual.occurrence,value.occurrence);assert.equal(actual.source.file,'memo-slot.ts');
    }
    for(const call of calls){
      const actual=byId.get(call.execution_id),parent=byId.get(actual.parent_id);
      assert.equal(actual.kind,'callback_invocation');assert.equal(parent.kind,'library_invocation');assert.equal(actual.occurrence,parent.occurrence);
    }
    result.execution={status:execution.status,library_calls:result.report.calls,callback_calls:calls.length,events:events.length};
    for(const call of calls)assert(result.report.evidence.some(row=>row.kind==='returned_value'&&row.boundary_occurrence===call.occurrence&&row.owner===call.owner&&row.generation===call.generation));
    return result;
  };
  if(writing) {const portable=portableImplementation(implementation.context);skeleton.versions.push({version:React.version,
    base_sha256:programHash(skeleton.program),overrides:programOverrides(skeleton.program,program),program_sha256:programHash(program),
    implementation_sha256:programHash(portable),implementation:portable,verification:{origin:'manual_exact_installed_production_dispatcher',helpers:selected}})}
  const bank=createLibraryProgramBank({check:createLibraryProgramVerifier({scope,behavior,integration})});
  const admitted=await admitCatalogProgram({skeleton,implementation,bank});assert.equal(admitted.status,'admitted',JSON.stringify(admitted));
  const wrongs=[structuredClone(program),structuredClone(program),structuredClone(program)];
  wrongs[0].body.body.body.body.body.body.test={op:'literal',value:false};
  wrongs[1].body.body.body.body.body.body.test={op:'literal',value:true};
  const wrongEquality=node=>{if(!node||typeof node!=='object')return;if(node.op==='same')node.op='equal';Object.values(node).forEach(wrongEquality)};wrongEquality(wrongs[2]);
  for(const wrong of wrongs)assert.equal(behavior({program:wrong}).status,'rejected');
  const boundary=createOwnedValueBoundary({producer:implementation.producer,program,callbackArguments:[0],captureOwner:host.captureOwner});
  const rollback=scenario((...args)=>boundary.invoke(args),()=>boundary.checkpoint(),{rollback:true});
  assert.equal(rollback.status,'rejected','Owner-only replay must not claim to handle discarded render work');
  results.push({version:React.version,admitted,wrong_rules_rejected:wrongs.length,rollback_frontier:rollback,helpers:selected});
  dom.window.close();
}
if(writing)fs.writeFileSync(catalogPath,JSON.stringify({schema:'producttrace.library-program-catalog.v1',skeletons:[skeleton]},null,2)+'\n');
fs.writeFileSync(path.join(directory,'react-memo-results.json'),JSON.stringify({passed:true,model_requests:0,results},null,2)+'\n');
console.log(JSON.stringify({passed:true,versions:results.map(row=>row.version),wrong_rules_rejected:results.length*3,rollback_frontiers:results.length,model_requests:0}));
