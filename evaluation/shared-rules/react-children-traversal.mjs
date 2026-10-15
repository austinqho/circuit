import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
import {readLibraryImplementation} from '../../authoring/library-implementation.mjs';
import {portableImplementation,programOverrides,admitCatalogProgram} from '../../authoring/library-program-catalog.mjs';
import {createLibraryProgramVerifier} from '../../authoring/library-program-verifier.mjs';
import {createLibraryProgramBank,programHash} from '../../analysis/library-program-bank.mjs';
import {childrenTraversalCases,checkReactChildrenTraversal} from './children-traversal-check.mjs';
import {instrumentLibraryPrograms} from '../../analysis/library-program-integration.mjs';
import {childrenTraversalProgram,childrenTraversalScope} from './react-children-traversal-program.mjs';
const directory=path.dirname(fileURLToPath(import.meta.url)),catalogPath=path.resolve(directory,'../../authoring/banks/react-children-traversal-programs.json');
const writing=process.argv.includes('--write-catalog'),mode=process.env.NODE_ENV==='production'?'production':'development';
const skeletons=fs.existsSync(catalogPath)?JSON.parse(fs.readFileSync(catalogPath)).skeletons:[],results=[];
for(const fixture of ['18.2','18','19']) {
  const repository=path.join(directory,'react-runtime',fixture),require=createRequire(path.join(repository,'package.json'));
  const implementations=new Map(['count','forEach'].map(method=>[method,readLibraryImplementation({repository,specifier:'react',exportName:'Children.'+method})]));
  const React=require('react');
  const {element,fragment}=childrenTraversalCases(React);
  for(const method of ['count','forEach']) {
    const exportName='Children.'+method,implementation=implementations.get(method);
    assert.equal(implementation.context.source_status,'ready_for_scoped_proposal',implementation.context.source_reason);
    const program=childrenTraversalProgram(React.version,method),scope=childrenTraversalScope(method);
    const behavior=({program})=>checkReactChildrenTraversal({React,producer:implementation.producer,program,method,scope});
    const integration=async({program})=>{
      const bank=createLibraryProgramBank({check:()=>({status:'passed',reason:'isolated_integration_probe'})});assert.equal((await bank.admit({implementation,program,scope})).status,'admitted');
      const source=`import {Children} from 'react';export function run(children,callback,context){return Children.${method}(children,callback,context)}`;
      const transformed=instrumentLibraryPrograms({source,file:`children-${method}.ts`,bank});assert.equal(transformed.bindings.length,1);assert.equal(transformed.frontiers.length,0);
      const exports={};vm.runInNewContext(ts.transpileModule(transformed.code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:()=>React,[transformed.runtimeKey]:transformed.runtime});
      const seen=[],context={surface:'children'},input=[element,[false,'text'],fragment];
      const result=exports.run(input,function(child,index){seen.push([child,index,this])},context);
      if(method==='count')assert.equal(result,4);else {assert.equal(result,undefined);assert.deepEqual(seen,[[element,0,context],[null,1,context],['text',2,context],[fragment,3,context]]);}
      const reports=transformed.runtime.checkpoint();assert.equal(reports.length,1);if(method==='forEach')assert.equal(reports[0].evidence.filter(row=>row.kind==='callback_invocation').length,4);
      return {status:reports.every(row=>row.status==='observed_agreement')?'passed':'rejected',reason:reports.flatMap(row=>row.failures)[0]?.reason,reports};
    };
    let skeleton=skeletons.find(row=>row.export_name===exportName);
    if(writing) {
      if(!skeleton){skeleton={schema:'producttrace.library-program-skeleton.v1',package:'react',export_name:exportName,scope,program,versions:[]};skeletons.push(skeleton);}
      let row=skeleton.versions.find(row=>row.version===React.version);
      if(!row){row={version:React.version,base_sha256:programHash(skeleton.program),overrides:programOverrides(skeleton.program,program),source_variants:[]};skeleton.versions.push(row);}
      const source=portableImplementation(implementation.context);
      row.source_variants=row.source_variants.filter(variant=>variant.implementation.runtime.mode!==source.runtime.mode);
      row.source_variants.push({overrides:[],scope,implementation:source,implementation_sha256:programHash(source),program_sha256:programHash(program),verification:{origin:'manual_exact_installed_traversal',build:mode,implementation:implementation.context.implementation}});
    }
    assert(skeleton,'Write the independently checked catalog first');
    const bank=createLibraryProgramBank({check:createLibraryProgramVerifier({scope,behavior,integration})}),admitted=await admitCatalogProgram({skeleton,implementation,bank});assert.equal(admitted.status,'admitted',JSON.stringify(admitted));
    const swapped=childrenTraversalProgram(React.version.startsWith('19.')?'18.3.1':'19.1.1',method);
    const skippedKey=structuredClone(program),wrongValue=method==='count'?{schema:program.schema,body:{op:'literal',value:0}}:structuredClone(program);
    const replace=(node,predicate,replacement)=>{
      if(!node||typeof node!=='object')return;
      for(const [key,value] of Object.entries(node)){if(predicate(value))node[key]=replacement(value);else replace(value,predicate,replacement);}
    };
    replace(skippedKey,node=>node?.op==='bind'&&node.name==='key',()=>({op:'undefined'}));
    if(method==='forEach')replace(wrongValue,node=>node?.op==='call'&&node.target?.name==='callback',node=>({...node,receiver:{op:'undefined'}}));
    const keyFailure=behavior({program:skippedKey});
    assert.deepEqual(keyFailure.failures.filter(row=>row.detail?.input_kind).map(row=>row.detail.input_kind),['key_getter','key_coercion']);
    assert(keyFailure.failures.filter(row=>row.detail?.input_kind).every(row=>row.detail.actual_effect_count>0));
    for(const wrong of [swapped,skippedKey,wrongValue])assert.equal(behavior({program:wrong}).status,'rejected');
    results.push({version:React.version,export_name:exportName,passed:true,wrong_rules_rejected:3,admission:admitted});
  }
}
if(writing)fs.writeFileSync(catalogPath,JSON.stringify({schema:'producttrace.library-program-catalog.v1',skeletons},null,2)+'\n');
fs.writeFileSync(path.join(directory,`react-children-traversal-${mode}-results.json`),JSON.stringify({passed:true,mode,model_requests:0,results},null,2)+'\n');
console.log(JSON.stringify({passed:true,mode,api_versions:results.length,wrong_rules_rejected:results.length*3,model_requests:0}));
