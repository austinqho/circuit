import {AsyncLocalStorage} from 'node:async_hooks';
import test from 'node:test';import assert from 'node:assert/strict';
import {getReactBehavior} from '../analysis/react-behavior.mjs';import {validateReactExecutionRule,planReactServerString,planReactLegacyServerStream,planReactReadableStream} from '../analysis/react-execution-rule.mjs';
import {compileReactSources} from '../analysis/react-compiler.mjs';import {createReactRuntimeIntegration} from '../analysis/runtime-join.mjs';import {createReactServerObserver} from '../analysis/react-server-runtime.mjs';
const rule=getReactBehavior({surface:'react-dom/server',exportName:'renderToString',version:'18.3.1'}).execution;
test('server program keeps synchronous rendering distinct from browser execution',()=>{
 assert.equal(validateReactExecutionRule(rule).valid,true);assert.equal(validateReactExecutionRule({...rule,extra:true}).valid,false);
 assert.equal(validateReactExecutionRule({...rule,element_argument:-1}).valid,false);
 const element={},options={get identifierPrefix(){throw Error('the planner must not read options');}};
 const plan=planReactServerString(rule,{args:[element,options]});assert.equal(plan.element,element);assert.equal(plan.options,options);assert.equal(plan.hydration_proven,false);
 assert.equal(planReactServerString(rule,{suspended:true,boundary:true}).operation,'fallback');assert.equal(planReactServerString(rule,{suspended:true}).operation,'throw');
});
test('server body observation excludes argument evaluation and stops at recording context changes',()=>{
 const records=[];let sequence=0,enabled=true,context='a',observer;
 const entry={server_rule:rule,server_argument_count:2,server_component:{source_id:'App'}};
 observer=createReactServerObserver({entry:()=>entry,enabled:()=>enabled,context:()=>context,id:()=>`a:${++sequence}`,encode:()=>({encoding:'redacted',value:null}),observe:record=>records.push(record)});
 function App(props){observer.serverComponent('App',App,arguments);return props.value;}
 const props={value:'original'},element={$$typeof:Symbol.for('react.element'),type:App,props};
 const rendered=observer.serverCall('call',()=>{observer.serverArgument('call',0,element);App(props);observer.serverArgument('call',1,{});return App(props);});
 assert.equal(rendered,'original');assert.equal(records.length,1);assert.equal(records[0].invocations.length,1);assert.equal(records[0].result.value,null);
 observer.serverCall('call',()=>{observer.serverArgument('call',0,element);observer.serverArgument('call',1,{});context='b';return App(props);});assert.equal(records.length,1);
 enabled=false;assert.equal(observer.serverCall('call',()=>App(props)),'original');assert.equal(records.length,1);
});
test('server source selection refuses mutable, dynamic and unverified component paths',()=>{
 const packages={react:{version:'18.3.1',verified:true,verification_sha256:'fixture'},'react-dom':{version:'18.3.1',verified:true,verification_sha256:'fixture'}};
 const prefix="import * as React from 'react';import * as Server from 'react-dom/server';function App(props){return <article>{props.value}</article>;}";
 for(const [tail,resolves] of [["Server.renderToString(<App value='x'/>);",true],["App=other;Server.renderToString(<App/>);",false],["Server.renderToString(element);",false]]){
  const source=prefix+tail,map=compileReactSources({'server.tsx':source},{packages}),entry=map.react_semantics.find(row=>row.export==='renderToString');
  assert.equal(Boolean(entry.causal_bindings.server_component),resolves);
  const integration=createReactRuntimeIntegration(map);assert.equal(integration.bindings.react_lifecycle.entries.some(row=>row.kind==='server_component'),resolves);
  if(!resolves)assert.ok(integration.bindings.react_lifecycle.frontiers.some(row=>row.reason==='server_root_component_source_unresolved'));
 }
 const unverified=compileReactSources({'server.tsx':prefix+'Server.renderToString(<App/>);'},{packages:{...packages,'react-dom':{...packages['react-dom'],verified:false}}});
 assert.equal(createReactRuntimeIntegration(unverified).bindings.react_lifecycle.entries.some(row=>row.server_rule),false);
});

test('server consumers retain only identity-preserving source shapes',()=>{
 const packages={react:{version:'18.3.1',verified:true,verification_sha256:'fixture'},'react-dom':{version:'18.3.1',verified:true,verification_sha256:'fixture'}};
 const source=`import * as React from 'react';import * as Server from 'react-dom/server';
 function App(){return <article/>} function pipe(destination){const handle=Server.renderToPipeableStream(<App/>);destination.on('finish',()=>done());handle.pipe(destination)}
 async function read(){const promise=Server.renderToReadableStream(<App/>);const stream=await promise;for await(const chunk of stream)use(chunk)}
 function unsupported(stream){stream.on('end',done)} async function early(stream){for await(const chunk of stream){break}}
 async function mutable(){const promise=Server.renderToReadableStream(<App/>);let stream=await promise;stream=other;for await(const chunk of stream)use(chunk)}
 function mutableDestination(){let destination=first;const handle=Server.renderToPipeableStream(<App/>);handle.pipe(destination);destination=second}`;
 const map=compileReactSources({'server.tsx':source},{packages});
 assert.deepEqual(map.react_server_consumers.map(row=>row.kind).sort(),['async_iteration','await_binding','event','pipe']);
 const transformed=createReactRuntimeIntegration(map).instrumentSource('server.tsx',source);
 assert.deepEqual(transformed.diagnostics,[]);
 for(const method of ['serverIteration','serverPromiseFulfilled','serverEvent','serverPipe'])assert.match(transformed.code,new RegExp(`\\.${method}\\(`));
 assert.equal((transformed.code.match(/serverEvent\(/gu)||[]).length,1);
 assert.equal((transformed.code.match(/serverIteration\(/gu)||[]).length,2,'one natural loop emits success or consumer failure');
});

test('legacy stream rules preserve platform, readiness and cancellation boundaries',()=>{
 for(const exportName of ['renderToNodeStream','renderToStaticNodeStream']){
  const streamRule=getReactBehavior({surface:'react-dom/server',exportName,version:'18.3.1'}).execution;
  assert.equal(validateReactExecutionRule(streamRule).valid,true);assert.equal(validateReactExecutionRule({...streamRule,ready:'anything'}).valid,false);
  assert.equal(planReactLegacyServerStream(streamRule).status,'unresolved');
  assert.equal(planReactLegacyServerStream(streamRule,{environment:'browser'}).operation,'throw');
  const node=planReactLegacyServerStream(streamRule,{environment:'node'});assert.equal(node.output,'hydratable');assert.equal(node.ready,'all_tasks');assert.equal(node.stream_completion_proven,false);
  assert.equal(planReactLegacyServerStream(streamRule,{environment:'node',operation:'destroy'}).operation,'abort');
 }
});

test('readable stream programs cannot turn promise allocation into fulfillment or inspect options',()=>{
 const streamRule=getReactBehavior({surface:'react-dom/server',exportName:'renderToReadableStream',version:'18.3.1'}).execution;
 assert.equal(validateReactExecutionRule({...streamRule,resolve_at:'sometimes'}).valid,false);assert.equal(validateReactExecutionRule({...streamRule,unknown:true}).valid,false);
 const options={get signal(){throw Error('planner must not inspect options');}},plan=planReactReadableStream(streamRule,{args:[{},options]});
 assert.equal(plan.options,options);assert.equal(plan.promise_fulfillment_proven,false);assert.equal(plan.stream_completion_proven,false);
 assert.equal(planReactReadableStream(streamRule,{operation:'unrecognized'}).status,'unresolved');
});

test('stopping server observation leaves already queued component work intact',async()=>{
 const streamRule=getReactBehavior({surface:'react-dom/server',exportName:'renderToPipeableStream',version:'18.3.1'}).execution;
 const context=new AsyncLocalStorage(),records=[];let enabled=true,count=0,calls=0;
 const observer=createReactServerObserver({entry:()=>({server_rule:streamRule,server_argument_count:1,server_component:{source_id:'App'}}),enabled:()=>enabled,
  context:()=> 'session',asyncContextBasis:'node-async-local-storage.v1',runInContext:(frame,run)=>context.run(frame,run),currentContext:()=>context.getStore(),id:()=>`s:${++count}`,encode:()=>({encoding:'redacted',value:null}),observe:record=>records.push(record)});
 function App(props){observer.serverComponent('App',App,arguments);calls++;return props;}
 const props={},element={$$typeof:Symbol.for('react.element'),type:App,props};let finish;
 const done=new Promise(resolve=>finish=resolve),handle={};
 assert.equal(observer.serverCall('call',()=>{observer.serverArgument('call',0,element);queueMicrotask(()=>finish(App(props)));return handle;}),handle);
 enabled=false;assert.equal(await done,props);assert.equal(calls,1);assert.equal(records.length,1);assert.equal(records[0].invocations.length,0);
});

test('one destination shared by different render occurrences cannot lend terminal ownership',()=>{
 const records=[];let count=0;
 const renderEntry={kind:'api_call',server_rule:{...getReactBehavior({surface:'react-dom/server',exportName:'renderToPipeableStream',version:'18.3.1'}).execution},
  source_call_id:'render',semantic_id:'react-dom/server/renderToPipeableStream/18.3.1'};
 const entries={render:renderEntry,pipe:{kind:'server_consumer',server_consumer_kind:'pipe'},finish:{kind:'server_consumer',server_consumer_kind:'event',server_consumer_event:'finish'}};
 const observer=createReactServerObserver({entry:key=>entries[key],enabled:()=>true,context:()=>'session',id:kind=>`session:${kind}:${++count}`,
  encode:()=>({encoding:'redacted',value:null}),observe:record=>records.push(record)});
 const destination={},first={},second={};
 observer.serverCall('render',()=>first);observer.serverCall('render',()=>second);
 observer.serverPipe('pipe',first,destination,()=>destination);
 observer.serverPipe('pipe',second,destination,()=>destination);
 observer.serverEvent('finish',destination,'finish');
 assert.equal(records.filter(row=>row.operation==='pipe_started').length,2);
 assert.equal(records.some(row=>row.operation==='stream_completed'),false);
});
