import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {createRequire} from 'node:module';import ts from 'typescript';
import {analyzeReact,createReactRuntimeIntegration} from '../../analysis/index.mjs';
const repository=path.resolve(process.argv[2]||'/tmp/producttrace-librechat-autonomous'),require=createRequire(path.join(repository,'package.json'));
const build=process.env.NODE_ENV==='production'?'production':'development',api=process.env.PRODUCTTRACE_SERVER_API||'renderToString';
assert.ok(['renderToString','renderToStaticMarkup'].includes(api));
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'react-server-string-'));
const source=`import * as React from 'react';import * as Server from 'react-dom/server';
function Inner(props){globalThis.events.push(['inner',props.value]);return <em>{props.value}</em>;}
function App(props){globalThis.events.push(['app',props.value]);if(props.fail)throw globalThis.failure;
 if(props.nested)globalThis.nested=Server.renderToStaticMarkup(<Inner value="nested"/>);
 return <article>{props.value}</article>;}
function run(value,nested=false,fail=false){return Server.${api}(<App value={value} nested={nested} fail={fail}/>,(App({value:'argument'}),{identifierPrefix:'runtime-'}));}
globalThis.run=run;`;
try{
 fs.mkdirSync(path.join(temporary,'src'));fs.mkdirSync(path.join(temporary,'node_modules'));fs.writeFileSync(path.join(temporary,'src/server.tsx'),source);
 const pkg={name:'server-string-acceptance',private:true,dependencies:{react:'18.3.1','react-dom':'18.3.1'}};fs.writeFileSync(path.join(temporary,'package.json'),JSON.stringify(pkg));
 const lock=JSON.parse(fs.readFileSync(path.join(repository,'package-lock.json')));fs.writeFileSync(path.join(temporary,'package-lock.json'),JSON.stringify({name:pkg.name,lockfileVersion:3,packages:{'':pkg,'node_modules/react':lock.packages['node_modules/react'],'node_modules/react-dom':lock.packages['node_modules/react-dom']}}));
 for(const name of ['react','react-dom'])fs.symlinkSync(path.join(repository,'node_modules',name),path.join(temporary,'node_modules',name));
 const map=analyzeReact({repository:temporary}),records=[],joins=new Map(),integration=createReactRuntimeIntegration(map,{onJoin:(result,record)=>joins.set(record.observation_id,result)});
 const semantics=map.react_semantics.filter(row=>row.behavior?.execution?.kind==='server_string');assert.equal(semantics.length,2);assert.ok(semantics.every(row=>row.package_verification_sha256&&row.causal_bindings.server_component));
 assert.equal(map.edges.filter(row=>row.relation==='callback_forward'&&semantics.some(s=>s.semantic_id===row.react_semantic_id)).length,2);
 const transformed=integration.instrumentSource('src/server.tsx',source);assert.deepEqual(transformed.diagnostics,[]);
 const compile=text=>ts.transpileModule(text.replace("import * as React from 'react';",'').replace("import * as Server from 'react-dom/server';",''),{compilerOptions:{jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.None}}).outputText;
 const execute=text=>{const context={events:[],failure:{identity:'original-error'},__productTraceReactLifecycle:integration.createApiRuntime({session:'server:'+build,onObservation:row=>records.push(row)})};
  new Function('React','Server','globalThis',compile(text))(require('react'),require('react-dom/server'),context);
  const outputs=[context.run('first'),context.run('second',true)];assert.throws(()=>context.run('broken',false,true),error=>error===context.failure);
  return {context,outputs};};
 const original=execute(source);assert.equal(records.length,0);
 let actual,browserMode=process.env.PRODUCTTRACE_SERVER_BROWSER==='1',browserStopVerified=false;
 if(browserMode){
  const {chromium}=require('playwright'),browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  try{const page=await browser.newPage();await page.addScriptTag({path:new URL('../../dist/producttrace-runtime.js',import.meta.url).pathname});
   await page.evaluate(bindings=>{window.observed=[];window.recorder=ProductTrace.start(bindings,{outputMode:'evidence',onRecord:row=>observed.push(row)});},integration.bindings);
   // Run the very CJS files included in the source attestation, in a browser
   // module wrapper. Do not silently replace them with unverified UMD siblings.
   const variant=build==='production'?'production.min':'development';
   const reactSource=fs.readFileSync(path.join(repository,`node_modules/react/cjs/react.${variant}.js`),'utf8');
   const serverSource=fs.readFileSync(path.join(repository,`node_modules/react-dom/cjs/react-dom-server-legacy.browser.${variant}.js`),'utf8');
   await page.addScriptTag({content:`window.React=(function(){var exports={},process={env:{NODE_ENV:${JSON.stringify(build)}}};${reactSource}\nreturn exports;})();`});
   await page.addScriptTag({content:`window.ReactDOMServer=(function(){var exports={},process={env:{NODE_ENV:${JSON.stringify(build)}}};function require(name){if(name==='react')return window.React;throw Error('unresolved '+name);}${serverSource}\nreturn exports;})();`});
   actual=await page.evaluate(code=>{
    const context={events:[],failure:{identity:'original-error'},__productTraceReactLifecycle:window.__productTraceReactLifecycle};
    new Function('React','Server','globalThis',code)(React,ReactDOMServer,context);
    const outputs=[context.run('first'),context.run('second',true)];let preserved=false;try{context.run('broken',false,true);}catch(error){preserved=error===context.failure;}
    if(!preserved)throw Error('original failure changed');window.serverCase=context;
    return {context:{events:context.events,nested:context.nested},outputs};
   },compile(transformed.code));
   records.push(...await page.evaluate(()=>observed));
   browserStopVerified=await page.evaluate(()=>{recorder.stop();const count=observed.length;return serverCase.run('stopped')==='<article>stopped</article>'&&observed.length===count;});
   assert.equal(browserStopVerified,true);
  }finally{await browser.close();}
 }else actual=execute(transformed.code);
 assert.deepEqual(actual.outputs,original.outputs);assert.deepEqual(actual.context.events,original.context.events);assert.equal(actual.context.nested,original.context.nested);
 const observations=records.filter(row=>row.kind==='react_server');assert.equal(observations.length,4);for(const record of records)integration.onRecord(record);
 const success=observations.filter(row=>row.operation==='returned');assert.equal(success.length,3);
 for(const row of success){const result=joins.get(row.observation_id);assert.equal(result.status,'resolved',JSON.stringify(result));assert.equal(row.invocations.length,1,'argument evaluation and nested requests cannot become root component invocations');
  assert.equal(row.result.encoding,'redacted');assert.equal(row.result.value,null);assert.equal(result.runtime.hydration_proven,false);assert.equal(result.runtime.direct_renderer_dispatch_proven,false);}
 const failed=observations.find(row=>row.operation==='threw');assert.equal(joins.get(failed.observation_id).reason,'server_return_unobserved');
 const target=success[0],mutations=[row=>{row.invocations[0].callee.identity=row.session+':foreign';},row=>{row.invocations[0].props.identity=row.session+':foreign';},
  row=>{row.invocations[0].source_id='wrong';},row=>{row.invocations[0].timing='deferred';},row=>{row.session='wrong';},row=>{row.result.kind='object';},
  row=>{row.invocations=[];},row=>{row.operation='threw';},row=>{row.source_call_id='wrong';},row=>{row.occurrence_id='wrong';},row=>{row.element.type.kind='object';},row=>{row.inputs[0].identity=row.session+':foreign';},row=>{row.invocations[0].observation_id='wrong';}];
 for(const mutation of mutations){const fresh=createReactRuntimeIntegration(map),bad=structuredClone(target);mutation(bad);assert.equal(fresh.joinServer(bad).status,'unresolved');assert.equal(fresh.joinServer(target).status,'resolved');}
 assert.equal(integration.joinServer(target).reason,'duplicate_server_observation');
 console.log(JSON.stringify({api:`react-dom/server/${api}/18.3.1`,build,installed_source_attested:true,source_component_edges:2,server_observations:4,
  successful_input_component_return_joins:3,browser:browserMode,browser_stop_verified:browserStopVerified,argument_evaluation_excluded:true,nested_requests_isolated:true,original_html_and_error_preserved:true,
  independent_mutants_rejected:mutations.length,html_not_retained:true,thrown_return_abstained:true,direct_renderer_dispatch_proven:false,hydration_proven:false},null,2));
}finally{fs.rmSync(temporary,{recursive:true,force:true});}
