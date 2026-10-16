import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {createRequire} from 'node:module';import ts from 'typescript';
import {analyzeReact,createReactRuntimeIntegration} from '../../analysis/index.mjs';
const repository=path.resolve(process.argv[2]||'/tmp/producttrace-librechat-autonomous'),require=createRequire(path.join(repository,'package.json'));
const build=process.env.NODE_ENV==='production'?'production':'development',api=process.env.PRODUCTTRACE_SERVER_API||'renderToNodeStream';
assert.ok(['renderToNodeStream','renderToStaticNodeStream'].includes(api));
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'react-legacy-stream-'));
const source=`import * as React from 'react';import * as Server from 'react-dom/server';
function Inner(props){globalThis.events.push(['inner',props.value]);return <em>{props.value}</em>;}
function App(props){globalThis.events.push(['app',props.value]);if(props.fail)throw globalThis.failure;
 if(props.nested)globalThis.nested=Server.renderToStaticMarkup(<Inner value="nested"/>);
 return <article>{props.value}</article>;}
async function run(value,nested=false,fail=false){const stream=Server.${api}(<App value={value} nested={nested} fail={fail}/>,(App({value:'argument'}),{identifierPrefix:'runtime-'}));globalThis.streams.push(stream);let html='';for await(const chunk of stream)html+=chunk;return html;}
globalThis.run=run;`;
try{
 fs.mkdirSync(path.join(temporary,'src'));fs.mkdirSync(path.join(temporary,'node_modules'));fs.writeFileSync(path.join(temporary,'src/server.tsx'),source);
 const pkg={name:'legacy-stream-acceptance',private:true,dependencies:{react:'18.3.1','react-dom':'18.3.1'}};fs.writeFileSync(path.join(temporary,'package.json'),JSON.stringify(pkg));
 const lock=JSON.parse(fs.readFileSync(path.join(repository,'package-lock.json')));fs.writeFileSync(path.join(temporary,'package-lock.json'),JSON.stringify({name:pkg.name,lockfileVersion:3,packages:{'':pkg,'node_modules/react':lock.packages['node_modules/react'],'node_modules/react-dom':lock.packages['node_modules/react-dom']}}));
 for(const name of ['react','react-dom'])fs.symlinkSync(path.join(repository,'node_modules',name),path.join(temporary,'node_modules',name));
 const map=analyzeReact({repository:temporary}),records=[],joins=new Map(),integration=createReactRuntimeIntegration(map,{onJoin:(result,record)=>joins.set(record.observation_id,result)});
 const semantics=map.react_semantics.filter(row=>['server_string','legacy_server_stream'].includes(row.behavior?.execution?.kind));assert.equal(semantics.length,2);assert.ok(semantics.every(row=>row.package_verification_sha256&&row.causal_bindings.server_component));
 assert.equal(map.edges.filter(row=>row.relation==='callback_forward'&&semantics.some(s=>s.semantic_id===row.react_semantic_id)).length,2);
 const transformed=integration.instrumentSource('src/server.tsx',source);assert.deepEqual(transformed.diagnostics,[]);
 const compile=text=>ts.transpileModule(text.replace("import * as React from 'react';",'').replace("import * as Server from 'react-dom/server';",''),{compilerOptions:{jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.None}}).outputText;
 const execute=async text=>{const libraryStreams=[],Server=require('react-dom/server'),observedServer={...Server,[api](...args){const stream=Reflect.apply(Server[api],Server,args);libraryStreams.push(stream);return stream;}};const context={streams:[],events:[],failure:{identity:'original-error'},__productTraceReactLifecycle:integration.createApiRuntime({session:'server:'+build,onObservation:row=>records.push(row)})};
  new Function('React','Server','globalThis',compile(text))(require('react'),observedServer,context);
  const outputs=[await context.run('first'),await context.run('second',true)];await assert.rejects(()=>context.run('broken',false,true),error=>error===context.failure);
  assert.equal(context.streams.length,libraryStreams.length);assert.ok(context.streams.every((stream,index)=>stream===libraryStreams[index]));
  return {context,outputs};};
 const original=await execute(source);assert.equal(records.length,0);
 const actual=await execute(transformed.code);
 assert.deepEqual(actual.outputs,original.outputs);assert.deepEqual(actual.context.events,original.context.events);assert.equal(actual.context.nested,original.context.nested);
 const observations=records.filter(row=>row.kind==='react_server'),allocations=observations.filter(row=>row.operation==='returned');assert.equal(allocations.length,4);for(const record of records)integration.onRecord(record);
 const success=allocations.slice(0,3);assert.equal(success.length,3);
 for(const row of success){const result=joins.get(row.observation_id);assert.equal(result.status,'resolved',JSON.stringify(result));assert.equal(row.invocations.length,1,'argument evaluation and nested requests cannot become root component invocations');
  assert.equal(row.result.encoding,'redacted');assert.equal(row.result.value,null);assert.equal(result.runtime.hydration_proven,false);assert.equal(result.runtime.direct_renderer_dispatch_proven,false);}
 const failed=allocations[3];assert.equal(failed.operation,'returned');assert.equal(failed.result.kind,'object');const failureJoin=joins.get(failed.observation_id);if(failureJoin.status==='resolved')assert.equal(failureJoin.runtime.stream_completion_proven,false);else assert.equal(failureJoin.reason,'server_component_input_mismatch');
 const completed=observations.filter(row=>row.operation==='stream_completed'),consumerFailures=observations.filter(row=>row.operation==='consumer_failed');
 assert.equal(completed.length,2);assert.equal(consumerFailures.length,1);
 for(const row of completed)assert.equal(joins.get(row.observation_id).runtime.stream_completion_proven,true);
 assert.equal(joins.get(consumerFailures[0].observation_id).reason,'server_stream_consumer_failed');
 const target=success[0],mutations=[row=>{row.invocations[0].callee.identity=row.session+':foreign';},row=>{row.invocations[0].props.identity=row.session+':foreign';},
  row=>{row.invocations[0].source_id='wrong';},row=>{row.invocations[0].timing='deferred';},row=>{row.session='wrong';},row=>{row.result.kind='string';},
  row=>{row.invocations=[];},row=>{row.operation='threw';},row=>{row.source_call_id='wrong';},row=>{row.occurrence_id='wrong';},row=>{row.element.type.kind='object';},row=>{row.inputs[0].identity=row.session+':foreign';},row=>{row.invocations[0].observation_id='wrong';}];
 for(const mutation of mutations){const fresh=createReactRuntimeIntegration(map),bad=structuredClone(target);mutation(bad);assert.equal(fresh.joinServer(bad).status,'unresolved');assert.equal(fresh.joinServer(target).status,'resolved');}
 assert.equal(integration.joinServer(target).reason,'duplicate_server_observation');
 console.log(JSON.stringify({api:`react-dom/server/${api}/18.3.1`,build,installed_source_attested:true,source_component_edges:2,server_observations:4,
  successful_input_component_return_joins:3,original_stream_objects_preserved:true,argument_evaluation_excluded:true,nested_requests_isolated:true,original_html_and_error_preserved:true,
  independent_mutants_rejected:mutations.length,html_not_retained:true,failed_stream_creation_status:failureJoin.status,
  completed_streams_joined:completed.length,consumer_failures_abstained:consumerFailures.length,stream_completion_proven:true,async_component_lineage_proven:false,direct_renderer_dispatch_proven:false,hydration_proven:false},null,2));
}finally{fs.rmSync(temporary,{recursive:true,force:true});}
