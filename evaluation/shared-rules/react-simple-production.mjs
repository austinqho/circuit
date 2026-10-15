import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
import {readLibraryImplementation} from '../../authoring/library-implementation.mjs';
import {portableImplementation,programOverrides,admitCatalogProgram} from '../../authoring/library-program-catalog.mjs';
import {createLibraryProgramBank,programHash} from '../../analysis/library-program-bank.mjs';
import {createLibraryBoundary} from '../../analysis/library-boundary.mjs';
import {instrumentLibraryPrograms} from '../../analysis/library-program-integration.mjs';
import {createLibraryProgramVerifier} from '../../authoring/library-program-verifier.mjs';
assert.equal(process.env.NODE_ENV,'production','use a fresh production process');
const directory=path.dirname(fileURLToPath(import.meta.url)),repository=path.join(directory,'fixtures');
const catalogPath=path.resolve(directory,'../../authoring/banks/react-production-scopes.json');
const writing=process.argv.includes('--write-catalog');
const catalog=writing?{schema:'producttrace.library-program-catalog.v1',skeletons:[]}:JSON.parse(fs.readFileSync(catalogPath));
const arg=index=>({op:'arg',index}),u={op:'undefined'},literal=value=>({op:'literal',value});
const rows=[];
for(const [specifier,exportName] of [['react18','useDebugValue'],['react19','useDebugValue'],['react19','cache']]){
  const implementation=readLibraryImplementation({repository,specifier,exportName});
  assert.equal(implementation.context.source_status,'ready_for_scoped_proposal',implementation.context.source_reason);
  const cache=exportName==='cache';
  const program={schema:'producttrace.library-program.v1',body:cache?{op:'bind',name:'callback',value:arg(0),body:{op:'fn',this_mode:'strict',body:{op:'call',target:{op:'local',name:'callback'},receiver:literal(null),args:{op:'args'}}}}:u};
  const scope={callbackArguments:[cache?0:1],resultPaths:null,description:cache?'React 19 client production cache wrapper invokes the supplied callback on every call with null receiver and original arguments; this does not describe server request caching.':'Production useDebugValue returns undefined without invoking its formatter, including outside a render. Development dispatcher and DevTools behavior require different source variants.'};
  const behavior=({program})=>{
    const boundary=createLibraryBoundary({producer:implementation.producer,program,...scope});
    let calls=0;
    if(cache){
      const error=new Error('actual failure');
      function first(...args){assert.equal(this,null);calls++;if(args[0]==='throw')throw error;return {args}}
      function second(value){assert.equal(this,null);calls++;return value}
      const a=boundary.invoke([first]),b=boundary.invoke([second]);
      const marker={id:'same'},one=a(marker),two=a(marker);
      assert.notEqual(one,two);assert.equal(one.args[0],marker);assert.equal(two.args[0],marker);
      assert.equal(b.call({ignored:true},marker),marker);
      assert.deepEqual(a.apply({ignored:true},[1,2,3]).args,[1,2,3]);
      assert.throws(()=>a('throw'),caught=>caught===error);assert.deepEqual(a('recovery').args,['recovery']);
      assert.equal(calls,6);
    }else{
      function formatter(){calls++;throw new Error('formatter must not run')}
      for(const args of [[],[1],[{},formatter],[null,formatter],[undefined,formatter],[function distinctValue(){},formatter]])assert.equal(boundary.invoke(args),undefined);
      assert.equal(calls,0);
      // Preserve the old alias case as a required rejection, rather than
      // letting a callback proxy change identity before the rule is checked.
      const alias=createLibraryBoundary({producer:implementation.producer,program,...scope});
      assert.equal(alias.invoke([formatter,formatter]),undefined);assert.equal(calls,0);
      assert.equal(alias.checkpoint().failures[0]?.reason,'callback_alias_requires_identity_preserving_observer');
    }
    const report=boundary.checkpoint();return{status:report.status==='observed_agreement'?'passed':'rejected',reason:report.failures[0]?.reason,calls,report};
  };
  const integration=async({program})=>{
    const probe=createLibraryProgramBank({check:()=>({status:'passed',reason:'isolated_integration_probe'})});
    assert.equal((await probe.admit({implementation,program,scope})).status,'admitted');
    const source=cache?`import {cache} from '${specifier}'; const wrapped=cache(value=>{events.push(value);return value}); export const first=wrapped(payload);export const second=wrapped(payload);`
      :`import {useDebugValue} from '${specifier}'; export const result=useDebugValue(payload,()=>{events.push('unexpected formatter');});`;
    const transformed=instrumentLibraryPrograms({source,file:'production-scope.ts',bank:probe});assert.equal(transformed.bindings.length,1);
    const exports={},events=[],payload={identity:'integration'};
    vm.runInNewContext(ts.transpileModule(transformed.code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
      {exports,events,payload,require:()=>({[exportName]:implementation.producer}),[transformed.runtimeKey]:transformed.runtime});
    if(cache){assert.equal(exports.first,payload);assert.equal(exports.second,payload);assert.deepEqual(events,[payload,payload]);}
    else{assert.equal(exports.result,undefined);assert.deepEqual(events,[]);}
    const evidence=transformed.runtime.checkpoint();return{status:evidence.every(row=>row.status==='observed_agreement')?'passed':'rejected',reason:evidence.flatMap(row=>row.failures||[])[0]?.reason,evidence};
  };
  const source=portableImplementation(implementation.context),version=source.runtime.entry.version;
  let skeleton=catalog.skeletons.find(row=>row.export_name===exportName);
  if(writing){
    if(!skeleton){skeleton={schema:'producttrace.library-program-skeleton.v1',package:'react',export_name:exportName,scope,program,versions:[]};catalog.skeletons.push(skeleton);}
    skeleton.versions.push({version,base_sha256:programHash(skeleton.program),overrides:programOverrides(skeleton.program,program),program_sha256:programHash(program),implementation_sha256:programHash(source),implementation:source,verification:{origin:'manual_exact_client_production_source',scope:scope.description}});
  }
  const bank=createLibraryProgramBank({check:createLibraryProgramVerifier({scope,behavior,integration})});
  const admitted=await admitCatalogProgram({skeleton,implementation,bank});assert.equal(admitted.status,'admitted',JSON.stringify(admitted));
  const wrongs=cache?[{...program,body:arg(0)},structuredClone(program)]:[{...program,body:arg(0)},{...program,body:{op:'call',target:arg(1),receiver:u,args:{op:'array',items:[arg(0)]}}}];
  if(cache)wrongs[1].body.body.body.receiver={op:'receiver'};
  for(const wrong of wrongs)assert.equal(behavior({program:wrong}).status,'rejected');
  rows.push({export_name:exportName,version,mode:'production',origin:'manual_source_transcription',admission:admitted,wrong_rules_rejected:wrongs.length,implementation_source:implementation.context.implementation});
}
if(writing)fs.writeFileSync(catalogPath,JSON.stringify(catalog,null,2)+'\n');
fs.writeFileSync(path.join(directory,'react-simple-production-results.json'),JSON.stringify({passed:true,model_requests:0,model_spend_usd:0,rows},null,2)+'\n');
console.log(JSON.stringify({passed:true,cases:rows.length,wrong_rules_rejected:rows.reduce((n,row)=>n+row.wrong_rules_rejected,0),model_requests:0}));
