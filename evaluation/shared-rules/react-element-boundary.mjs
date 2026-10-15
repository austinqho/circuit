import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
import {readLibraryImplementation} from '../../authoring/library-implementation.mjs';
import {portableImplementation,programOverrides,admitCatalogProgram} from '../../authoring/library-program-catalog.mjs';
import {createLibraryProgramBank,programHash} from '../../analysis/library-program-bank.mjs';
import {createLibraryBoundary} from '../../analysis/library-boundary.mjs';
import {instrumentLibraryPrograms} from '../../analysis/library-program-integration.mjs';
import {createLibraryProgramVerifier} from '../../authoring/library-program-verifier.mjs';
import {reactElementProgram} from './react-element-programs.mjs';
assert.equal(process.env.NODE_ENV,'production','use a fresh production process');
const directory=path.dirname(fileURLToPath(import.meta.url));
const catalogPath=path.resolve(directory,'../../authoring/banks/react-element-programs.json');
const writing=process.argv.includes('--write-catalog');
const catalog=writing?{schema:'producttrace.library-program-catalog.v1',skeletons:[]}:JSON.parse(fs.readFileSync(catalogPath));
const rows=[];
for(const major of ['18','19']) {
  const repository=path.join(directory,'react-runtime',major), require=createRequire(path.join(repository,'package.json'));
  const {JSDOM}=require('jsdom'),dom=new JSDOM('<main></main>',{url:'http://localhost/'});
  globalThis.window=dom.window; globalThis.document=dom.window.document;
  Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
  // The implementation reader is the first loader for each entry under test.
  const implementations=Object.fromEntries(['createElement','cloneElement'].map(exportName=>[exportName,readLibraryImplementation({repository,specifier:'react',exportName})]));
  const React=require('react'),{createRoot}=require('react-dom/client'),{flushSync}=require('react-dom');
  for(const exportName of ['createElement','cloneElement']) {
    const implementation=implementations[exportName],version=React.version;
    assert.equal(implementation.context.source_status,'ready_for_scoped_proposal',implementation.context.source_reason);
    const scope={callbackArguments:[],observationMode:'references',nestedReferences:true,resultPaths:[['type'],['key'],['props'],['ref']],errorObservation:'standard_error_without_stack',
      description:'Production React element data: exact type/key/ref, all props and nested callback identities, children precedence and own-data defaultProps. Excludes owner/commit effects and metadata outside these projections. Ordinary data inputs only; getter/proxy/coercion/inherited-default cases must remain frontiers.'};
    const program=reactElementProgram(exportName,version);
    const behavior=({program})=>{
      const a=()=>11,b=()=>22,ref=()=>{}, marker={id:'payload'};
      function WithDefaults(){} WithDefaults.defaultProps={title:'default',onClick:a,children:'default child'};
      const base=React.createElement(WithDefaults,{key:7,onClick:b,ref,title:'original',extra:marker},'old child');
      const cases=exportName==='createElement' ? [
        ['button'],['button',null],['button',{}],['button',{onClick:a,payload:marker}],['button',{onClick:b,children:'prop child'}],
        ['button',{children:'old'},'new'],['button',{},'a','b'],['button',{},undefined],['button',null,null],
        ...[null,0,-0,false,true,'abc',8n].map(key=>['button',{key,ref,onClick:a,__self:marker,__source:marker}]),
        [WithDefaults,{}],[WithDefaults,{onClick:undefined,title:undefined}],[WithDefaults,{onClick:b,title:null}],
        [WithDefaults,{},undefined],[WithDefaults,null,'override'],['button',{ref:undefined,key:undefined}],
        ['button',Object.defineProperty({visible:1},'hidden',{value:2})],
      ] : [
        [base],[base,null],[base,{}],[base,{onClick:a,payload:marker}],[base,{onClick:undefined,title:undefined}],
        [base,{ref:undefined}],[base,{ref:null}],[base,{ref:a}], [base,{children:'new prop'}],
        [base,{children:'ignored'},'arg child'],[base,{},'a','b'],[base,{},undefined],
        ...[null,0,-0,false,true,'abc'].map(key=>[base,{key,__source:marker,__self:marker}]),[null],[undefined],
      ];
      const boundary=createLibraryBoundary({producer:implementation.producer,program,...scope});
      for(const args of cases)try{boundary.invoke(args);}catch(error){if(args[0]!=null)throw error;}
      const report=boundary.checkpoint();
      return {status:report.status==='observed_agreement'?'passed':'rejected',reason:report.failures[0]?.reason,cases:cases.length,report};
    };
    const integration=async({program})=>{
      // This provisional bank belongs only to the independent probe. Nothing
      // reaches the live catalog bank until this real renderer test succeeds.
      const probeBank=createLibraryProgramBank({check:()=>({status:'passed',reason:'isolated_integration_probe'})});
      assert.equal((await probeBank.admit({implementation,program,scope})).status,'admitted');
      const invocation=exportName==='createElement'?"api('button', {onClick: callback, 'data-name': name}, name)":"api(base, {onClick: callback, 'data-name': name}, name)";
      const source=`import {${exportName} as api} from 'react'; export function make(name,payload){const callback=()=>observed.push([name,payload]);return ${invocation};}`;
      const transformed=instrumentLibraryPrograms({source,file:'element-path.ts',bank:probeBank});
      assert.equal(transformed.bindings.length,1);
      const exports={},observed=[];
      vm.runInNewContext(ts.transpileModule(transformed.code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
        {exports,observed,base:React.createElement('button',{onClick:()=>{throw new Error('stale callback')}}),require:()=>React,[transformed.runtimeKey]:transformed.runtime});
      const payloads=[{id:'chat'},{id:'scroll'}],container=document.createElement('section');document.querySelector('main').append(container);
      const root=createRoot(container);
      try{
        flushSync(()=>root.render(React.createElement(React.Fragment,null,exports.make('chat',payloads[0]),exports.make('scroll',payloads[1]))));
        assert.equal(container.querySelectorAll('button').length,2);
        for(const button of container.querySelectorAll('button'))button.dispatchEvent(new window.MouseEvent('click',{bubbles:true}));
        assert.equal(observed.length,2);assert.equal(observed[0][0],'chat');assert.equal(observed[0][1],payloads[0]);assert.equal(observed[1][0],'scroll');assert.equal(observed[1][1],payloads[1]);
        const evidence=transformed.runtime.checkpoint();
        if(evidence.some(row=>row.status!=='observed_agreement')) return {status:'rejected',reason:'element_integration_disagreement',clicks:observed.map(([surface])=>surface),evidence};
        const callbackPaths=evidence.flatMap(row=>row.evidence||[]).filter(row=>row.kind==='callback_reference'&&JSON.stringify(row.input_path)==='[1,"onClick"]'&&JSON.stringify(row.result_path)==='["props","onClick"]');
        assert.equal(callbackPaths.length,2,'each rendered button must have its own input-to-props callback evidence');
        assert.notEqual(callbackPaths[0].occurrence,callbackPaths[1].occurrence);
        return {status:evidence.every(row=>row.status==='observed_agreement')?'passed':'rejected',reason:evidence.flatMap(row=>row.failures||[])[0]?.reason,clicks:observed.map(([surface])=>surface),evidence};
      }finally{flushSync(()=>root.unmount());container.remove();}
    };
    let skeleton=catalog.skeletons.find(row=>row.export_name===exportName);
    if(writing){
      if(!skeleton){skeleton={schema:'producttrace.library-program-skeleton.v1',package:'react',export_name:exportName,program,scope,versions:[]};catalog.skeletons.push(skeleton);}
      const source=portableImplementation(implementation.context);
      // One scope applies to both versions. Program overrides account for the
      // changed ref-in-props and default-prop behavior in the installed code.
      skeleton.versions.push({version,base_sha256:programHash(skeleton.program),overrides:programOverrides(skeleton.program,program),program_sha256:programHash(program),implementation_sha256:programHash(source),implementation:source,verification:{origin:'manual_exact_installed_production_source',scope:scope.description}});
    }
    const bank=createLibraryProgramBank({check:createLibraryProgramVerifier({scope,behavior,integration})});
    const admission=await admitCatalogProgram({skeleton,implementation,bank});
    assert.equal(admission.status,'admitted',`${exportName} ${version} ${JSON.stringify(admission)}`);
    const replacements=[{op:'literal',value:null},reactElementProgram(exportName,major==='18'?'19.1.1':'18.3.1').body];
    const mutate=(program,predicate,replacement)=>{const next=structuredClone(program);const visit=node=>{if(!node||typeof node!=='object')return;if(predicate(node)){for(const key of Object.keys(node))delete node[key];Object.assign(node,structuredClone(replacement));return;}for(const value of Object.values(node))visit(value);};visit(next);return next;};
    const wrong=[...replacements.map(body=>({...program,body})),
      mutate(program,node=>node.op==='string',{op:'literal',value:'wrong key'}),
      mutate(program,node=>node.op==='put'&&node.key?.op==='literal'&&node.key.value==='children',{op:'undefined'}),
      mutate(program,node=>node.op==='lookup'&&node.value?.op==='arg'&&node.value.index===1,{op:'undefined'})];
    for(const candidate of wrong)assert.equal(behavior({program:candidate}).status,'rejected','deliberately incorrect rule must reject');
    // Unsupported inputs still execute only the real library. Replay neither
    // invokes accessors again nor mistakes a partial result for agreement.
    let getterReads=0;const getterConfig={get title(){getterReads++;return 'actual'}};
    const getterArgs=[exportName==='createElement'?'button':React.createElement('button'),getterConfig];
    Reflect.apply(implementation.producer,undefined,getterArgs);
    const baselineReads=getterReads;getterReads=0;
    const unsupported=createLibraryBoundary({producer:implementation.producer,program,...scope});
    unsupported.invoke(getterArgs);
    assert.equal(getterReads,baselineReads);assert.equal(unsupported.checkpoint().status,'frontier');
    rows.push({export_name:exportName,version,mode:'production',status:'admitted_scoped',behavior:admission.report.behavior,integration:admission.report.integration,wrong_rules_rejected:wrong.length,accessor_frontier:true,source_sha256:implementation.sha256});
  }
  dom.window.close();
}
if(writing)fs.writeFileSync(catalogPath,JSON.stringify(catalog,null,2)+'\n');
const report={passed:true,model_requests:0,model_spend_usd:0,origin:'manual_source_transcription',rows};
fs.writeFileSync(path.join(directory,'react-element-results.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({passed:true,boundaries:rows.length,wrong_rules_rejected:rows.reduce((n,row)=>n+row.wrong_rules_rejected,0),real_dom_clicks:rows.reduce((n,row)=>n+row.integration.clicks.length,0)}));
