import assert from 'node:assert/strict';import fs from 'node:fs';import http from 'node:http';import os from 'node:os';import path from 'node:path';import {createRequire} from 'node:module';import ts from 'typescript';
import {analyzeReact,createReactRuntimeIntegration} from '../../analysis/index.mjs';
const repository=path.resolve(process.argv[2]||'/tmp/producttrace-librechat-autonomous'),require=createRequire(path.join(repository,'package.json')),{chromium}=require('playwright');
const build=process.env.PRODUCTTRACE_REACT_BUILD==='production'?'production':'development';
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'react-host-runtime-'));
const source=`import * as React from 'react';import * as DOM from 'react-dom';
function App(){const click=React.useCallback(()=>{const found=DOM.findDOMNode(window.lookupTarget);window.found.push(found);if(found&&found.focus)found.focus();},[]);
 return <button type="button" id="lookup" onClick={click}>Find host</button>;}
window.lookupOutside=()=>DOM.findDOMNode(window.lookupTarget);
window.mount=()=>DOM.flushSync(()=>window.appRoot.render(<App/>));`;
try{
 fs.mkdirSync(path.join(temporary,'src'));fs.mkdirSync(path.join(temporary,'node_modules'));fs.writeFileSync(path.join(temporary,'src/App.tsx'),source);
 const pkg={name:'host-acceptance',private:true,dependencies:{react:'18.3.1','react-dom':'18.3.1'}};fs.writeFileSync(path.join(temporary,'package.json'),JSON.stringify(pkg));
 const lock=JSON.parse(fs.readFileSync(path.join(repository,'package-lock.json')));fs.writeFileSync(path.join(temporary,'package-lock.json'),JSON.stringify({name:pkg.name,lockfileVersion:3,packages:{'':pkg,'node_modules/react':lock.packages['node_modules/react'],'node_modules/react-dom':lock.packages['node_modules/react-dom']}}));
 for(const name of ['react','react-dom'])fs.symlinkSync(path.join(repository,'node_modules',name),path.join(temporary,'node_modules',name));
 const map=analyzeReact({repository:temporary}),joins=new Map(),integration=createReactRuntimeIntegration(map,{onJoin:(result,record)=>joins.set(record.observation_id,result)});
 assert.equal(map.controls.length,1);assert.equal(map.react_semantics.filter(row=>row.export==='findDOMNode'&&row.package_verification_sha256).length,2);
 const transformed=integration.instrumentSource('src/App.tsx',source);assert.deepEqual(transformed.diagnostics,[]);
 const compiled=ts.transpileModule(transformed.code.replace("import * as React from 'react';",'const React=window.React;').replace("import * as DOM from 'react-dom';",'const DOM=window.ReactDOM;'),{compilerOptions:{jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.None}}).outputText;
 const variant=build==='production'?'production.min':'development',assets={'/runtime.js':fs.readFileSync(new URL('../../dist/producttrace-runtime.js',import.meta.url)),
 '/react.js':fs.readFileSync(path.join(repository,`node_modules/react/umd/react.${variant}.js`)),
 '/dom.js':fs.readFileSync(path.join(repository,`node_modules/react-dom/umd/react-dom.${variant}.js`))};
 const html=`<!doctype html><div id="app"></div><div id="class"></div><div id="portal"></div><input id="native"><script src="/runtime.js"></script><script>
 window.records=[];window.found=[];window.recorder=ProductTrace.start(${JSON.stringify(integration.bindings)},{outputMode:'evidence',onRecord:row=>records.push(row)});
 </script><script src="/react.js"></script><script src="/dom.js"></script><script>
 window.appRoot=ReactDOM.createRoot(document.getElementById('app'));window.classRoot=ReactDOM.createRoot(document.getElementById('class'));
 class Target extends window.React.Component{render(){return this.props.tree;}}
 window.setTree=(kind)=>{let tree=kind==='empty'?null:kind==='text'?'text':kind==='portal'?ReactDOM.createPortal(React.createElement('input',{id:'portalled'}),document.getElementById('portal')):React.createElement('input',{id:kind});
 ReactDOM.flushSync(()=>classRoot.render(React.createElement(Target,{ref:value=>{if(value)window.lookupTarget=value;},tree})));};
 ${compiled}
 mount();setTree('first');</script>`;
 const server=http.createServer((req,res)=>{if(assets[req.url])res.end(assets[req.url]);else{res.setHeader('content-type','text/html');res.end(html);}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
 try{
  browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.stack));await page.goto(`http://127.0.0.1:${server.address().port}`);assert.deepEqual(errors,[]);
  for(const kind of ['first','next','text','portal','empty']){if(kind!=='first')await page.evaluate(kind=>setTree(kind),kind);await page.click('#lookup');
   assert.equal(await page.evaluate(kind=>{const node=found.at(-1);return kind==='empty'?node===null:kind==='text'?node?.nodeType===3&&node.nodeValue==='text':document.activeElement===node&&node.id===(kind==='portal'?'portalled':kind);},kind),true);}
  await page.evaluate(()=>lookupTarget=document.getElementById('native'));await page.click('#lookup');assert.equal(await page.evaluate(()=>document.activeElement.id),'native');
  await page.evaluate(()=>lookupTarget=null);await page.click('#lookup');assert.equal(await page.evaluate(()=>found.at(-1)),null);
  const records=await page.evaluate(()=>records);for(const row of records)integration.onRecord(row);
  const hostRecords=records.filter(row=>row.kind==='react_host');assert.equal(hostRecords.length,7);
  for(const row of hostRecords){const joined=joins.get(row.observation_id);assert.equal(joined.status,'resolved',JSON.stringify({record:row,result:joined}));assert.ok(joined.runtime.action,JSON.stringify(records.filter(record=>['action','react_callback'].includes(record.kind))));assert.equal(joined.runtime.host_effect_proven,false);}
  assert.equal(hostRecords.filter(row=>row.lookup.kind==='current_class').length,5);
  const target=hostRecords[0],before=records.slice(0,records.indexOf(target));
  const mutations=[row=>{row.result.identity=row.session+':foreign';},row=>{row.lookup.input_identity=row.session+':foreign';},row=>{row.lookup.tree.children[0].value.identity=row.session+':foreign';},
   row=>{row.action.callback_observation_id='wrong';},row=>{row.action.action_occurrence_id='wrong';},row=>{row.source_call_id='wrong';},row=>{row.session='wrong';},row=>{row.lookup.basis='wrong';}];
  for(const mutation of mutations){const fresh=createReactRuntimeIntegration(map);before.forEach(row=>fresh.onRecord(row));const bad=structuredClone(target);mutation(bad);assert.equal(fresh.joinHost(bad).status,'unresolved');assert.equal(fresh.joinHost(target).status,'resolved');}
  assert.equal(createReactRuntimeIntegration(map).joinHost(target).reason,'host_action_unconfirmed');
  const unknown=await page.evaluate(()=>{let reads=0;const value={get nodeType(){reads++;return 1;}};lookupTarget=value;const same=lookupOutside()===value;return {same,reads,record:records.filter(row=>row.kind==='react_host').at(-1)};});
  assert.equal(unknown.same,true);assert.equal(unknown.reads,1);assert.equal(integration.joinHost(unknown.record).reason,'host_input_context_unobserved');
  const thrown=await page.evaluate(()=>{let reads=0;const reason={original:true};lookupTarget=new Proxy({}, {get(_target,key){if(key==='nodeType'){reads++;throw reason;}return undefined;}});let same=false;try{lookupOutside();}catch(error){same=error===reason;}return {same,reads,record:records.filter(row=>row.kind==='react_host').at(-1)};});
  assert.equal(thrown.same,true);assert.equal(thrown.reads,1);assert.equal(integration.joinHost(thrown.record).reason,'host_input_context_unobserved');
  const stopped=await page.evaluate(()=>{recorder.stop();return records.length;});await page.evaluate(()=>lookupTarget=document.getElementById('native'));await page.click('#lookup');assert.equal(await page.evaluate(()=>records.length),stopped);assert.equal(await page.evaluate(()=>document.activeElement.id),'native');assert.deepEqual(errors,[]);
  console.log(JSON.stringify({api:'react-dom/findDOMNode/18.3.1',build,installed_source_attested:true,actual_clicks:8,host_joins:7,current_class_snapshots:5,
   current_host_text_portal_and_empty:true,native_passthrough:true,action_receipts_required:true,independent_mutants_rejected:mutations.length,
   unknown_getter_not_replayed:true,proxy_error_identity_preserved:true,stop_preserves_behavior:true,host_effect_proven:false},null,2));
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
}finally{fs.rmSync(temporary,{recursive:true,force:true});}
