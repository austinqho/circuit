import assert from 'node:assert/strict';import fs from 'node:fs';import http from 'node:http';import os from 'node:os';import path from 'node:path';import {createRequire} from 'node:module';import ts from 'typescript';
import {analyzeReact,createReactRuntimeIntegration} from '../../analysis/index.mjs';
const repository=path.resolve(process.argv[2]||'/tmp/producttrace-librechat-autonomous'),require=createRequire(path.join(repository,'package.json')),{chromium}=require('playwright');
const build=process.env.PRODUCTTRACE_REACT_BUILD==='production'?'production':'development';
const api=process.env.PRODUCTTRACE_LEGACY_API||'render',subtree=api==='unstable_renderSubtreeIntoContainer';
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'react-legacy-render-runtime-'));
const argumentsSource=subtree?'window.parentInstance, window.element, window.renderTarget, window.commitCallback':'window.element, window.renderTarget, window.commitCallback';
const source=`import * as React from 'react';import * as DOM from 'react-dom';
function App(){const click=React.useCallback(()=>{window.results.push(DOM.${api}(${argumentsSource}));},[]);
 return <button type="button" id="render" onClick={click}>Render target</button>;}
window.renderOutside=()=>DOM.${api}(${argumentsSource});
window.mount=()=>DOM.flushSync(()=>window.appRoot.render(<App/>));`;
try{
 fs.mkdirSync(path.join(temporary,'src'));fs.mkdirSync(path.join(temporary,'node_modules'));fs.writeFileSync(path.join(temporary,'src/App.tsx'),source);
 const pkg={name:'legacy-render-acceptance',private:true,dependencies:{react:'18.3.1','react-dom':'18.3.1'}};fs.writeFileSync(path.join(temporary,'package.json'),JSON.stringify(pkg));
 const lock=JSON.parse(fs.readFileSync(path.join(repository,'package-lock.json')));fs.writeFileSync(path.join(temporary,'package-lock.json'),JSON.stringify({name:pkg.name,lockfileVersion:3,packages:{'':pkg,'node_modules/react':lock.packages['node_modules/react'],'node_modules/react-dom':lock.packages['node_modules/react-dom']}}));
 for(const name of ['react','react-dom'])fs.symlinkSync(path.join(repository,'node_modules',name),path.join(temporary,'node_modules',name));
 const map=analyzeReact({repository:temporary}),joins=new Map(),integration=createReactRuntimeIntegration(map,{onJoin:(result,record)=>joins.set(record.observation_id,result)});
 assert.equal(map.controls.length,1);assert.equal(map.react_semantics.filter(row=>row.export===api&&row.package_verification_sha256).length,2);
 const transformed=integration.instrumentSource('src/App.tsx',source);assert.deepEqual(transformed.diagnostics,[]);
 const compiled=ts.transpileModule(transformed.code.replace("import * as React from 'react';",'const React=window.React;').replace("import * as DOM from 'react-dom';",'const DOM=window.ReactDOM;'),{compilerOptions:{jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.None}}).outputText;
 const variant=build==='production'?'production.min':'development',assets={'/runtime.js':fs.readFileSync(new URL('../../dist/producttrace-runtime.js',import.meta.url)),
 '/react.js':fs.readFileSync(path.join(repository,`node_modules/react/umd/react.${variant}.js`)),
 '/dom.js':fs.readFileSync(path.join(repository,`node_modules/react-dom/umd/react-dom.${variant}.js`))};
 const html=`<!doctype html><div id="app"></div><div id="target"><input id="initial"></div><div id="parent"></div><script src="/runtime.js"></script><script>
 window.records=[];window.results=[];window.commits=[];window.recorder=ProductTrace.start(${JSON.stringify(integration.bindings)},{outputMode:'evidence',onRecord:row=>records.push(row)});
 </script><script src="/react.js"></script><script src="/dom.js"></script><script>
 ${compiled}
 window.appRoot=ReactDOM.createRoot(document.getElementById('app'));window.renderTarget=document.getElementById('target');window.originalNode=renderTarget.firstChild;
 class Target extends window.React.Component{render(){return React.createElement('input',{id:this.props.label});}}
 class Parent extends window.React.Component{getChildContext(){return {label:'inherited'};}render(){return React.createElement('b',null,'parent');}}Parent.childContextTypes={label:()=>null};
 window.parentInstance=ReactDOM.render(React.createElement(Parent),document.getElementById('parent'));
 window.commitCallback=function(){'use strict';window.commits.push({receiver:this,argc:arguments.length});};
 window.setElement=kind=>{window.element=kind==='empty'?null:kind==='function'?React.createElement(function Plain(){return React.createElement('i',null,'function');}):kind==='native'?React.createElement('button',null,'native'):React.createElement(Target,{label:kind});};
 mount();setElement('initial');</script>`;
 const server=http.createServer((req,res)=>{if(assets[req.url])res.end(assets[req.url]);else{res.setHeader('content-type','text/html');res.end(html);}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
 try{
  browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.stack));await page.goto(`http://127.0.0.1:${server.address().port}`);assert.deepEqual(errors,[]);
  for(const kind of ['initial','next','native','function','empty']){if(kind!=='initial')await page.evaluate(kind=>{ReactDOM.unmountComponentAtNode(renderTarget);setElement(kind);renderTarget.innerHTML=kind==='empty'?'':kind==='native'?'<button>native</button>':kind==='function'?'<i>function</i>':'<input id="'+kind+'">';},kind);await page.click('#render');
   assert.equal(await page.evaluate(kind=>{const result=results.at(-1),commit=commits.at(-1);return commit.argc===0&&commit.receiver===result&&(kind==='function'||kind==='empty'?result===null:kind==='native'?result===renderTarget.firstChild:result instanceof Target);},kind),true);}
  assert.equal(await page.evaluate(()=>commits.length),5);
  const records=await page.evaluate(()=>records);for(const row of records)integration.onRecord(row);
  const hostRecords=records.filter(row=>row.kind==='react_host');assert.equal(hostRecords.length,5);
  for(const row of hostRecords){const joined=joins.get(row.observation_id);assert.equal(joined.status,'resolved',JSON.stringify({record:row,result:joined}));assert.ok(joined.runtime.action);assert.equal(joined.runtime.callback_completion_proven,false);assert.equal(joined.runtime.hydration_reuse_proven,false);assert.equal(joined.runtime.component_body_execution_proven,false);}
  assert.equal(await page.evaluate(()=>originalNode.isConnected),false);
  const target=hostRecords[0],before=records.slice(0,records.indexOf(target));
  const mutations=[row=>{row.result.identity=row.session+':foreign';},row=>{row.lookup.container_identity=row.session+':foreign';},row=>{row.lookup.after.element.identity=row.session+':foreign';},
   row=>{row.lookup.after.commit_id='react-commit:'+row.lookup.commit_floor;},row=>{row.lookup.after.state='unconfirmed';},row=>{row.lookup.after.root.identity=row.input.identity;},
   row=>{row.action.callback_observation_id='wrong';},row=>{row.action.action_occurrence_id='wrong';},row=>{row.source_call_id='wrong';},row=>{row.session='wrong';},row=>{row.lookup.basis='wrong';}];
  if(subtree)mutations.push(row=>{row.lookup.parent.identity=row.session+':foreign';});
  for(const mutation of mutations){const fresh=createReactRuntimeIntegration(map);before.forEach(row=>fresh.onRecord(row));const bad=structuredClone(target);mutation(bad);assert.equal(fresh.joinHost(bad).status,'unresolved');assert.equal(fresh.joinHost(target).status,'resolved');}
  assert.equal(createReactRuntimeIntegration(map).joinHost(target).reason,'host_action_unconfirmed');
  await page.evaluate(()=>setElement('clicked-update'));await page.click('#render');assert.equal(await page.evaluate(()=>renderTarget.firstChild.id),'clicked-update');assert.equal(integration.joinHost(await page.evaluate(()=>records.filter(row=>row.kind==='react_host').at(-1))).reason,'legacy_render_commit_unconfirmed');
  const deferred=await page.evaluate(()=>{const previous=renderTarget._reactRootContainer.current.child.stateNode;setElement('deferred');let value,record;ReactDOM.unstable_batchedUpdates(()=>{value=renderOutside();record=records.filter(row=>row.kind==='react_host').at(-1);});return {valueWasOld:value===previous,updated:renderTarget.firstChild.id==='deferred',record};});
  assert.equal(deferred.valueWasOld,true);assert.equal(deferred.updated,true);assert.equal(integration.joinHost(deferred.record).reason,'legacy_render_commit_unconfirmed');
  const thrown=await page.evaluate(()=>{let reads=0;const reason={original:true};renderTarget=new Proxy({}, {get(_target,key){if(key==='nodeType'){reads++;throw reason;}return undefined;}});let same=false;try{renderOutside();}catch(error){same=error===reason;}return {same,reads,record:records.filter(row=>row.kind==='react_host').at(-1)};});
  assert.equal(thrown.same,true);assert.equal(thrown.reads,1);assert.equal(integration.joinHost(thrown.record).reason,'host_input_context_unobserved');
  if(subtree){const invalid=await page.evaluate(()=>{renderTarget=document.getElementById('target');const parent=parentInstance;parentInstance={};let threw=false;try{renderOutside();}catch(_){threw=true;}parentInstance=parent;return {threw,record:records.filter(row=>row.kind==='react_host').at(-1)};});assert.equal(invalid.threw,true);assert.equal(integration.joinHost(invalid.record).reason,'host_input_context_unobserved');}
  const nested=await page.evaluate(()=>{renderTarget=document.getElementById('target');setElement('outer');const original=element;let once=false;commitCallback=function(){if(once)return;once=true;setElement('nested');renderOutside();};const result=renderOutside();const output={outer:original,nested:element,records:records.filter(row=>row.kind==='react_host').slice(-2),final:renderTarget.firstChild.id};commitCallback=function(){'use strict';commits.push({receiver:this,argc:arguments.length});};return {records:output.records,final:output.final};});
  assert.equal(nested.final,'nested');for(const row of nested.records)assert.equal(integration.joinHost(row).status,'unresolved');
  await page.evaluate(()=>{renderTarget=document.getElementById('target');setElement('stopped');});const stopped=await page.evaluate(()=>{recorder.stop();return records.length;});await page.click('#render');assert.equal(await page.evaluate(()=>records.length),stopped);assert.equal(await page.evaluate(()=>renderTarget.firstChild.id),'stopped');assert.deepEqual(errors,[]);
  console.log(JSON.stringify({api:'react-dom/'+api+'/18.3.1',build,installed_source_attested:true,actual_clicks:7,host_joins:5,
   input_element_commit_public_result:true,class_native_function_empty:true,action_receipts_required:true,independent_mutants_rejected:mutations.length,
   batched_update_abstains:true,event_update_abstains:true,nested_update_isolation:true,proxy_error_identity_preserved:true,parent_requirement:subtree,stop_preserves_behavior:true,
   callback_completion_proven:false,hydration_reuse_proven:false,component_body_execution_proven:false},null,2));
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
}finally{fs.rmSync(temporary,{recursive:true,force:true});}
