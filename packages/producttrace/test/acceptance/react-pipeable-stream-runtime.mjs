import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {createRequire} from 'node:module';import {PassThrough} from 'node:stream';import ts from 'typescript';
import {createReactServerEvidenceSession} from '../../analysis/react-server-evidence.mjs';
import {analyzeReact,createReactRuntimeIntegration} from '../../analysis/index.mjs';
const repository=path.resolve(process.argv[2]||'/tmp/producttrace-librechat-autonomous'),require=createRequire(path.join(repository,'package.json'));
const build=process.env.NODE_ENV==='production'?'production':'development',api='renderToPipeableStream';

const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'react-pipeable-stream-'));
const source=`import * as React from 'react';import * as Server from 'react-dom/server';
function Inner(props){globalThis.events.push(['inner',props.value]);return <em>{props.value}</em>;}
function App(props){globalThis.events.push(['app',props.value]);if(props.fail)throw globalThis.failure;
 if(props.nested)globalThis.nested=globalThis.start('nested');
 return <article>{props.value}</article>;}
function start(value,nested=false,fail=false){const destination=new globalThis.PassThrough();let html='';destination.setEncoding('utf8');destination.on('data',chunk=>html+=chunk);
 const finished=new Promise((resolve,reject)=>{destination.on('end',()=>resolve(html));destination.on('error',error=>reject(error));});
 const handle=Server.${api}(<App value={value} nested={nested} fail={fail}/>,(App({value:'argument'}),{identifierPrefix:'runtime-',onError:()=>{}}));globalThis.streams.push(handle);handle.pipe(destination);return {handle,finished};}
globalThis.start=start;globalThis.manual=App;`;
try{
 fs.mkdirSync(path.join(temporary,'src'));fs.mkdirSync(path.join(temporary,'node_modules'));fs.writeFileSync(path.join(temporary,'src/server.tsx'),source);
 const pkg={name:'pipeable-stream-acceptance',private:true,dependencies:{react:'18.3.1','react-dom':'18.3.1'}};fs.writeFileSync(path.join(temporary,'package.json'),JSON.stringify(pkg));
 const lock=JSON.parse(fs.readFileSync(path.join(repository,'package-lock.json')));fs.writeFileSync(path.join(temporary,'package-lock.json'),JSON.stringify({name:pkg.name,lockfileVersion:3,packages:{'':pkg,'node_modules/react':lock.packages['node_modules/react'],'node_modules/react-dom':lock.packages['node_modules/react-dom']}}));
 for(const name of ['react','react-dom'])fs.symlinkSync(path.join(repository,'node_modules',name),path.join(temporary,'node_modules',name));
 const map=analyzeReact({repository:temporary}),records=[],joins=new Map(),integration=createReactRuntimeIntegration(map,{onJoin:(result,record)=>joins.set(record.observation_id,result)});
 const semantics=map.react_semantics.filter(row=>row.behavior?.execution?.kind==='pipeable_server_stream');assert.equal(semantics.length,1);assert.ok(semantics.every(row=>row.package_verification_sha256&&row.causal_bindings.server_component));
 assert.equal(map.edges.filter(row=>row.relation==='callback_forward'&&semantics.some(s=>s.semantic_id===row.react_semantic_id)).length,1);
 const transformed=integration.instrumentSource('src/server.tsx',source);assert.deepEqual(transformed.diagnostics,[]);
 const compile=text=>ts.transpileModule(text.replace("import * as React from 'react';",'').replace("import * as Server from 'react-dom/server';",''),{compilerOptions:{jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.None}}).outputText;
 const execute=async text=>{const context={events:[],streams:[],failure:{identity:'original-error'},PassThrough,__productTraceReactLifecycle:integration.createApiRuntime({session:'server:'+build,onObservation:row=>records.push(row)})};
  const actualServer=require('react-dom/server'),returned=[];
  const tracked={...actualServer,renderToPipeableStream(...args){const handle=actualServer.renderToPipeableStream(...args);returned.push({handle,pipe:handle.pipe,abort:handle.abort});return handle;}};
  new Function('React','Server','globalThis',compile(text))(require('react'),tracked,context);
  const first=context.start('first');assert.equal(first.handle,returned.at(-1).handle);const second=context.start('second',true);assert.equal(second.handle,returned.at(-1).handle);
  const rejected=context.start('broken',false,true);assert.equal(rejected.handle,returned.at(-1).handle);context.manual({value:'manual'});
  const errorCheck=assert.rejects(rejected.finished,error=>error===context.failure);
  const outputs=await Promise.all([first.finished,second.finished]);await errorCheck;context.nested=await context.nested.finished;
  assert.equal(context.streams.length,returned.length);assert.ok(context.streams.every((stream,index)=>stream===returned[index].handle));
  for(const row of returned){assert.equal(row.handle.pipe,row.pipe);assert.equal(row.handle.abort,row.abort);}
  return {context,outputs};};
 const original=await execute(source);assert.equal(records.length,0);const actual=await execute(transformed.code);
 assert.deepEqual(actual.outputs,original.outputs);assert.deepEqual(actual.context.events,original.context.events);assert.equal(actual.context.nested,original.context.nested);
 const observations=records.filter(row=>row.kind==='react_server'),allocations=observations.filter(row=>row.operation==='returned'),bodies=observations.filter(row=>row.operation==='component_entered');
 assert.equal(allocations.length,4);assert.ok(allocations.every(row=>row.invocations.length===0),'async bodies must not mutate already-emitted allocation receipts');
 for(const record of records)integration.onRecord(record);for(const row of allocations)assert.equal(joins.get(row.observation_id).reason,'server_component_pending');
 const success=bodies.filter(row=>joins.get(row.observation_id).status==='resolved'),unresolved=bodies.filter(row=>joins.get(row.observation_id).status!=='resolved');
 assert.equal(success.length,4,JSON.stringify(bodies.map(row=>({row,join:joins.get(row.observation_id)}))));
 assert.equal(unresolved.length,0,JSON.stringify(unresolved));
 for(const row of success){const joined=joins.get(row.observation_id);assert.equal(row.invocations.length,1);assert.equal(row.invocations[0].timing,'asynchronous');assert.equal(joined.runtime.async_component_lineage_proven,true);assert.equal(joined.runtime.stream_completion_proven,false);assert.equal(joined.runtime.direct_renderer_dispatch_proven,false);}
 const pipes=observations.filter(row=>row.operation==='pipe_started'),completed=observations.filter(row=>row.operation==='stream_completed'),errored=observations.filter(row=>row.operation==='stream_errored');
 assert.equal(pipes.length,4);assert.equal(completed.length,3);assert.equal(errored.length,1);
 for(const row of pipes)assert.equal(joins.get(row.observation_id).runtime.pipe_started,true);
 for(const row of completed)assert.equal(joins.get(row.observation_id).runtime.stream_completion_proven,true);
 for(const row of errored)assert.equal(joins.get(row.observation_id).runtime.stream_error_proven,true);
 const terminal=completed[0],terminalOrigin=allocations.find(row=>row.observation_id===terminal.creation_observation_id),terminalPipe=pipes.find(row=>row.creation_observation_id===terminal.creation_observation_id),terminalForeign=allocations.find(row=>row.observation_id!==terminal.creation_observation_id&&row.manifest_key===terminalOrigin.manifest_key);
 const terminalMutations=[row=>{row.consumer_manifest_key='wrong';},row=>{row.consumer_source_id='wrong';},row=>{row.creation_observation_id=terminalForeign.observation_id;},
  row=>{row.resource.identity=row.session+':foreign';},row=>{row.event='error';},row=>{row.operation='stream_errored';},row=>{row.seq=terminalOrigin.seq;},
  row=>{row.evidence_ids=[row.observation_id];},row=>{row.consumer_kind='async_iteration';},row=>{row.source_call_id='wrong';},row=>{row.session='wrong';}];
 for(const mutation of terminalMutations){const fresh=createReactRuntimeIntegration(map),bad=structuredClone(terminal);mutation(bad);fresh.joinServer(terminalOrigin);fresh.joinServer(terminalPipe);assert.equal(fresh.joinServer(bad).status,'unresolved');assert.equal(fresh.joinServer(terminal).status,'resolved');}
 const creationIds=new Set(success.map(row=>row.creation_observation_id));assert.equal(creationIds.size,4);
 assert.equal(bodies.some(row=>row.invocations.some(invocation=>!invocation.root_input_match)),false);

 const target=success[0],origin=allocations.find(row=>row.observation_id===target.creation_observation_id),foreign=allocations.find(row=>row.observation_id!==target.creation_observation_id&&row.manifest_key===origin.manifest_key),mutations=[row=>{row.invocations[0].callee.identity=row.session+':foreign';},row=>{row.invocations[0].props.identity=row.session+':foreign';},
  row=>{row.invocations[0].source_id='wrong';},row=>{row.invocations[0].timing='synchronous';},row=>{row.session='wrong';},row=>{row.result.kind='string';},
  row=>{row.invocations=[];},row=>{row.operation='threw';},row=>{row.source_call_id='wrong';},row=>{row.occurrence_id='wrong';},row=>{row.element.type.kind='object';},row=>{row.inputs[0].identity=row.session+':foreign';},row=>{row.invocations[0].observation_id='wrong';},row=>{row.async_context_basis='wrong';},row=>{row.creation_observation_id=foreign.observation_id;}];
 for(const mutation of mutations){const fresh=createReactRuntimeIntegration(map),bad=structuredClone(target);mutation(bad);fresh.joinServer(origin);fresh.joinServer(foreign);assert.equal(fresh.joinServer(bad).status,'unresolved');assert.equal(fresh.joinServer(target).status,'resolved');}
 assert.equal(integration.joinServer(target).reason,'duplicate_server_observation');
 const bounded=createReactServerEvidenceSession({fingerprint:map.fingerprint,entries:integration.bindings.react_lifecycle.entries,maxPending:1});bounded.join(origin);bounded.join(foreign);assert.equal(bounded.join(target).reason,'server_async_allocation_unconfirmed');assert.equal(bounded.join(success.find(row=>row.creation_observation_id===foreign.observation_id)).status,'resolved');
 assert.equal(createReactRuntimeIntegration(map).joinServer(target).reason,'server_async_allocation_unconfirmed');
 const wrongOrigin=JSON.parse(JSON.stringify(origin));wrongOrigin.result.identity=origin.session+':wrong-handle';const wrong=createReactRuntimeIntegration(map);wrong.joinServer(wrongOrigin);assert.equal(wrong.joinServer(target).reason,'server_async_allocation_unconfirmed');
 console.log(JSON.stringify({api:`react-dom/server/${api}/18.3.1`,build,installed_source_attested:true,source_component_edges:1,allocations:allocations.length,async_body_joins:success.length,
  original_handle_and_methods_preserved:true,original_html_and_error_preserved:true,concurrent_and_nested_requests_isolated:true,argument_and_outside_calls_excluded:true,
  allocation_receipts_immutable:true,allocation_receipt_required:true,evicted_allocation_abstains:true,independent_mutants_rejected:mutations.length+terminalMutations.length,
  pipe_operations_joined:pipes.length,completed_streams_joined:completed.length,errored_streams_joined:errored.length,stream_completion_proven:true,direct_renderer_dispatch_proven:false},null,2));
}finally{fs.rmSync(temporary,{recursive:true,force:true});}
