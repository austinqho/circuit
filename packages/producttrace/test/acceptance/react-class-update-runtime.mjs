import assert from 'node:assert/strict';import fs from 'node:fs';import http from 'node:http';import os from 'node:os';import path from 'node:path';import {createRequire} from 'node:module';import ts from 'typescript';
import {createReactClassUpdateEvidenceSession} from '../../analysis/react-class-update-evidence.mjs';
import {analyzeReact,createReactRuntimeIntegration} from '../../analysis/index.mjs';
const repository=path.resolve(process.argv[2]||'/tmp/producttrace-librechat-autonomous'),require=createRequire(path.join(repository,'package.json')),{chromium}=require('playwright');
const build=process.env.NODE_ENV==='production'?'production':'development',strict=process.env.PRODUCTTRACE_CLASS_STRICT==='1',legacy=process.env.PRODUCTTRACE_CLASS_LEGACY==='1';
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'react-class-update-runtime-'));
const source=`import * as React from 'react';import * as DOM from 'react-dom';
class Normal extends React.Component {state={count:0,keep:true};shouldComponentUpdate(){return false;}
 update(mode){if(mode==='force')return this.forceUpdate(function complete(){window.events.push(['complete',this,arguments.length]);});
 if(mode==='null')return this.setState((state,props)=>{window.events.push(['null',this,state,props]);return null;},()=>{window.events.push(['complete',this,0]);});
 return this.setState(function calculate(state,props){window.events.push(['calculate',this,arguments.length,state,props,calculate]);return {count:state.count+props.step};},function complete(){window.events.push(['complete',this,arguments.length]);});}
 render(){window.bodies.push(this);return <p>{this.state.count}:{this.props.step}</p>;}}
class Pure extends React.PureComponent {state={count:0,keep:true};shouldComponentUpdate(){return false;}
 update(mode){if(mode==='force')return this.forceUpdate(function complete(){window.events.push(['complete',this,arguments.length]);});
 if(mode==='null')return this.setState((state,props)=>{window.events.push(['null',this,state,props]);return null;},()=>{window.events.push(['complete',this,0]);});
 return this.setState(function calculate(state,props){window.events.push(['calculate',this,arguments.length,state,props,calculate]);return {count:state.count+props.step};},function complete(){window.events.push(['complete',this,arguments.length]);});}
 render(){window.bodies.push(this);return <p>{this.state.count}:{this.props.step}</p>;}}
function App(){const click=React.useCallback(()=>{DOM.flushSync(()=>{window.normal.update(window.mode);window.pure.update(window.mode);});},[]);
 return <div><button id="advance" onClick={click}>Advance</button><Normal ref={value=>{if(value)window.normal=value;}} step={2}/><Pure ref={value=>{if(value)window.pure=value;}} step={3}/></div>;}
window.mount=()=>DOM.flushSync(()=>window.root.render(${strict?'<React.StrictMode><App/></React.StrictMode>':'<App/>'}));window.classes=[Normal,Pure];`;
try{
 fs.mkdirSync(path.join(temporary,'src'));fs.mkdirSync(path.join(temporary,'node_modules'));fs.writeFileSync(path.join(temporary,'src/App.tsx'),source);
 const pkg={name:'class-acceptance',private:true,dependencies:{react:'18.3.1','react-dom':'18.3.1'}};fs.writeFileSync(path.join(temporary,'package.json'),JSON.stringify(pkg));
 const lock=JSON.parse(fs.readFileSync(path.join(repository,'package-lock.json')));fs.writeFileSync(path.join(temporary,'package-lock.json'),JSON.stringify({name:pkg.name,lockfileVersion:3,packages:{'':pkg,'node_modules/react':lock.packages['node_modules/react'],'node_modules/react-dom':lock.packages['node_modules/react-dom']}}));
 for(const name of ['react','react-dom'])fs.symlinkSync(path.join(repository,'node_modules',name),path.join(temporary,'node_modules',name));
 const map=analyzeReact({repository:temporary}),joins=new Map(),integration=createReactRuntimeIntegration(map,{onJoin:(result,record)=>joins.set(record.observation_id,result)});
 const semantics=map.react_semantics.filter(row=>row.causal_bindings?.class_mapping);assert.equal(semantics.length,2);assert.ok(semantics.every(row=>row.package_verification_sha256));assert.equal(map.controls.length,1);assert.equal(map.edges.filter(row=>row.class_update_member&&row.relation==='callback_forward').length,10);
 const transformed=integration.instrumentSource('src/App.tsx',source);assert.deepEqual(transformed.diagnostics,[]);
 const compile=text=>ts.transpileModule(text.replace("import * as React from 'react';",'const React=window.React;').replace("import * as DOM from 'react-dom';",'const DOM=window.ReactDOM;'),{compilerOptions:{jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.None}}).outputText;
 
 const variant=build==='production'?'production.min':'development',assets={'/runtime.js':fs.readFileSync(new URL('../../dist/producttrace-runtime.js',import.meta.url)),
 '/react.js':fs.readFileSync(path.join(repository,`node_modules/react/umd/react.${variant}.js`)),'/dom.js':fs.readFileSync(path.join(repository,`node_modules/react-dom/umd/react-dom.${variant}.js`))};
 const html=text=>`<!doctype html><div id="app"></div><script src="/runtime.js"></script><script>window.records=[];window.bodies=[];window.events=[];window.mode='increment';
 window.recorder=ProductTrace.start(${JSON.stringify(integration.bindings)},{outputMode:'evidence',onRecord:row=>records.push(row)});</script><script src="/react.js"></script><script src="/dom.js"></script><script>
 window.root=${legacy?"{render:element=>ReactDOM.render(element,document.getElementById('app')),unmount:()=>ReactDOM.unmountComponentAtNode(document.getElementById('app'))}":"ReactDOM.createRoot(document.getElementById('app'))"};${compile(text)}mount();</script>`;
 const server=http.createServer((req,res)=>{if(assets[req.url])res.end(assets[req.url]);else{res.setHeader('content-type','text/html');res.end(html(req.url==='/original'?source:transformed.code));}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
 try{
  browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});const errors=[];
  const exercise=async location=>{const page=await browser.newPage();page.on('pageerror',error=>errors.push(String(error)+error.stack));await page.goto(`http://127.0.0.1:${server.address().port}/${location}`);assert.deepEqual(errors,[]);
   await page.evaluate(()=>{window.queued=[];for(const instance of [normal,pure]){const original=instance.updater;instance.updater={...original,enqueueSetState(...args){queued.push(args[1]);return original.enqueueSetState(...args);}};}});
   const states=[];for(const mode of ['increment','null','force']){await page.evaluate(mode=>window.mode=mode,mode);await page.click('#advance');states.push(await page.evaluate(()=>({normal:normal.state,pure:pure.state,bodies:bodies.length,text:document.getElementById('app').textContent})));}
   const shape=await page.evaluate(()=>({classes:classes.map(type=>[type.name,type.prototype.update.name,type.prototype.update.length]),callbackShape:events.filter(row=>row[0]==='calculate').map(row=>[row[5].name,row[5].length,queued.includes(row[5])]),
    thisAndArgs:events.filter(row=>row[0]==='calculate'||row[0]==='complete').every(row=>(row[1]===normal||row[1]===pure)&&row[2]===(row[0]==='calculate'?2:0))}));
   const immediate=legacy?await page.evaluate(()=>{const before=records.length;normal.update('increment');return records.slice(before).filter(row=>row.kind==='react_class_update');}):[];
   const records=await page.evaluate(()=>records);
   const custom=await page.evaluate(()=>{normal.setState=function(){return 23;};return {result:normal.update('increment'),record:records.filter(row=>row.kind==='react_class_update').at(-1)};});
   const getter=await page.evaluate(()=>{let reads=0;const error={original:true};Object.defineProperty(normal,'setState',{configurable:true,get(){reads++;throw error;}});let same=false;try{normal.update('increment');}catch(caught){same=caught===error;}delete normal.setState;return {reads,same,record:records.filter(row=>row.kind==='react_class_update').at(-1)};});
   const afterUnmount=await page.evaluate(()=>{ReactDOM.flushSync(()=>root.unmount());const before=records.length;normal.update('increment');return records.slice(before).filter(row=>row.kind==='react_class_update');});
   const stopped=await page.evaluate(()=>{recorder.stop();return records.length;});assert.equal(await page.evaluate(()=>{normal.setState=function(){return this===normal?37:0;};return normal.update('increment');}),37);assert.equal(await page.evaluate(()=>records.length),stopped);
   await page.close();return {states,shape,records,custom,getter,afterUnmount,immediate};};
  const original=await exercise('original'),actual=await exercise('instrumented');assert.deepEqual(actual.states,original.states);assert.deepEqual(actual.shape,original.shape);assert.equal(actual.shape.thisAndArgs,true);assert.ok(actual.shape.callbackShape.every(row=>row[0]==='calculate'&&row[1]===2&&row[2]));
  assert.equal(actual.custom.result,23);assert.equal(actual.getter.reads,1);assert.equal(actual.getter.same,true);assert.equal(original.records.filter(row=>row.kind==='react_class_update').length,0);
  for(const row of actual.records)integration.onRecord(row);
  const rows=actual.records.filter(row=>row.kind==='react_class_update'),requests=rows.filter(row=>row.operation==='returned'),callbacks=rows.filter(row=>row.operation.startsWith('callback_'));
  assert.equal(requests.length,legacy?7:6);assert.equal(callbacks.length,(strict&&build==='development'?14:10)+(legacy?(strict&&build==='development'?3:2):0));
  for(const row of rows){const join=joins.get(row.observation_id);assert.equal(join.status,'resolved',JSON.stringify({row,join}));assert.equal(join.runtime.commit_proven,false);assert.equal(join.runtime.queue_execution_proven,false);if(row.operation==='returned'&&row.action)assert.ok(join.runtime.action);if(row.operation.startsWith('callback_'))assert.ok(map.edges.some(edge=>edge.id===join.source.callback_edge_id&&edge.to===join.source.callback_source_id&&edge.from===join.source.source_call_id));}
  assert.equal(new Set(requests.map(row=>row.receiver.identity)).size,2);assert.equal(new Set(callbacks.map(row=>row.request_id)).size,legacy?7:6);
  assert.equal(requests.filter(row=>row.action).length,6);
  if(legacy){assert.equal(actual.immediate[0].operation,'returned');assert.ok(actual.immediate.slice(1).every(row=>row.timing==='during_method_call'));}
  assert.ok(callbacks.some(row=>row.receiver_basis==='lexical'));assert.ok(callbacks.some(row=>row.arguments_complete));
  assert.equal(integration.joinClassUpdate(actual.custom.record).reason,'class_update_method_unconfirmed');assert.equal(integration.joinClassUpdate(actual.getter.record).reason,'class_update_method_unconfirmed');
  assert.equal(actual.afterUnmount.length,1);assert.equal(actual.afterUnmount[0].operation,'returned');assert.equal(integration.joinClassUpdate(actual.afterUnmount[0]).status,'resolved');
  const call=requests[0],callback=callbacks.find(row=>row.request_id===call.observation_id&&row.receiver_basis==='call'&&row.arguments.length===2),beforeCall=actual.records.slice(0,actual.records.indexOf(call)),beforeCallback=actual.records.slice(0,actual.records.indexOf(callback));
  const callMutations=[row=>{row.instance_origin_id=row.session+':wrong';},row=>{row.registration_id=row.session+':wrong';},row=>{row.receiver.identity=row.session+':wrong';},row=>{row.callee.identity=row.session+':wrong';},row=>{row.inputs[0].identity=row.session+':wrong';},row=>{row.callbacks[0].source_id='wrong';},row=>{row.action.callback_observation_id='wrong';},row=>{row.source_call_id='wrong';},row=>{row.session='wrong';}];
  const callbackMutations=[row=>{row.request_id=row.session+':wrong';},row=>{row.callback.identity=row.session+':wrong';},row=>{row.receiver.identity=row.session+':wrong';},row=>{row.source_id='wrong';},row=>{row.arguments.pop();},row=>{row.arguments_complete=false;},row=>{row.receiver_basis='lexical';},row=>{row.timing='wrong';},row=>{row.session='wrong';}];
  for(const [target,prefix,mutations] of [[call,beforeCall,callMutations],[callback,beforeCallback,callbackMutations]])for(const mutation of mutations){const fresh=createReactRuntimeIntegration(map);prefix.forEach(row=>fresh.onRecord(row));const bad=JSON.parse(JSON.stringify(target));mutation(bad);assert.equal(fresh.joinClassUpdate(bad).status,'unresolved');assert.equal(fresh.joinClassUpdate(target).status,'resolved');}
  // Reuse already accepted real class receipts to isolate the bounded request cache.
  const bounded=createReactClassUpdateEvidenceSession({fingerprint:map.fingerprint,entries:integration.bindings.react_lifecycle.entries,maxPending:1,resolveAction:value=>value,
   resolveInstance:(registrationId,renderId)=>{const registration=actual.records.find(row=>row.observation_id===registrationId),render=actual.records.find(row=>row.observation_id===renderId);return registration&&render&&joins.get(renderId)?.status==='resolved'?{registration,render}:null;}});
  assert.equal(bounded.join(call).status,'resolved');assert.equal(bounded.join(requests[1]).status,'resolved');assert.equal(bounded.join(callback).reason,'class_update_request_required');
  assert.equal(bounded.join(callbacks.find(row=>row.request_id===requests[1].observation_id)).status,'resolved');
  assert.equal(createReactRuntimeIntegration(map).joinClassUpdate(call).reason,'class_update_instance_origin_required');assert.equal(createReactRuntimeIntegration(map).joinClassUpdate(callback).reason,'class_update_request_required');assert.equal(integration.joinClassUpdate(callback).reason,'duplicate_class_update_observation');assert.deepEqual(errors,[]);
  console.log(JSON.stringify({apis:['react/Component/18.3.1','react/PureComponent/18.3.1'],build,strict,legacy,synchronous_callback_receipts_ordered:legacy,installed_source_attested:true,actual_clicks:3,source_callback_edges:10,method_joins:requests.length,callback_joins:callbacks.length,
   original_callback_identity_name_arity:true,original_receiver_arguments_returns:true,normal_arrow_and_function_callbacks:true,sibling_requests_isolated:true,custom_method_abstains:true,getter_error_not_replayed:true,
   unmounted_call_does_not_invent_callback:true,stop_preserves_behavior:true,request_and_instance_receipts_required:true,evicted_request_abstains:true,independent_mutants_rejected:18,queue_execution_proven:false,state_merge_proven:false,commit_proven:false},null,2));
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
}finally{fs.rmSync(temporary,{recursive:true,force:true});}
