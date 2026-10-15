import assert from 'node:assert/strict';import fs from 'node:fs';import http from 'node:http';import os from 'node:os';import path from 'node:path';import {createRequire} from 'node:module';import ts from 'typescript';
import {analyzeReact,createReactRuntimeIntegration} from '../../analysis/index.mjs';
const repository=path.resolve(process.argv[2]||'/tmp/producttrace-librechat-autonomous'),require=createRequire(path.join(repository,'package.json')),{chromium}=require('playwright');
const build=process.env.PRODUCTTRACE_REACT_BUILD==='production'?'production':'development';
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'react-legacy-unmount-runtime-'));
const source=`import * as React from 'react';import * as DOM from 'react-dom';
function App(){const click=React.useCallback(()=>{window.results.push(DOM.unmountComponentAtNode(window.unmountTarget));},[]);
 return <button type="button" id="unmount" onClick={click}>Unmount target</button>;}
window.unmountOutside=()=>DOM.unmountComponentAtNode(window.unmountTarget);
window.mount=()=>DOM.flushSync(()=>window.appRoot.render(<App/>));`;
try{
 fs.mkdirSync(path.join(temporary,'src'));fs.mkdirSync(path.join(temporary,'node_modules'));fs.writeFileSync(path.join(temporary,'src/App.tsx'),source);
 const pkg={name:'legacy-unmount-acceptance',private:true,dependencies:{react:'18.3.1','react-dom':'18.3.1'}};fs.writeFileSync(path.join(temporary,'package.json'),JSON.stringify(pkg));
 const lock=JSON.parse(fs.readFileSync(path.join(repository,'package-lock.json')));fs.writeFileSync(path.join(temporary,'package-lock.json'),JSON.stringify({name:pkg.name,lockfileVersion:3,packages:{'':pkg,'node_modules/react':lock.packages['node_modules/react'],'node_modules/react-dom':lock.packages['node_modules/react-dom']}}));
 for(const name of ['react','react-dom'])fs.symlinkSync(path.join(repository,'node_modules',name),path.join(temporary,'node_modules',name));
 const map=analyzeReact({repository:temporary}),joins=new Map(),integration=createReactRuntimeIntegration(map,{onJoin:(result,record)=>joins.set(record.observation_id,result)});
 assert.equal(map.controls.length,1);assert.equal(map.react_semantics.filter(row=>row.export==='unmountComponentAtNode'&&row.package_verification_sha256).length,2);
 const transformed=integration.instrumentSource('src/App.tsx',source);assert.deepEqual(transformed.diagnostics,[]);
 const compiled=ts.transpileModule(transformed.code.replace("import * as React from 'react';",'const React=window.React;').replace("import * as DOM from 'react-dom';",'const DOM=window.ReactDOM;'),{compilerOptions:{jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.None}}).outputText;
 const variant=build==='production'?'production.min':'development',assets={'/runtime.js':fs.readFileSync(new URL('../../dist/producttrace-runtime.js',import.meta.url)),
 '/react.js':fs.readFileSync(path.join(repository,`node_modules/react/umd/react.${variant}.js`)),
 '/dom.js':fs.readFileSync(path.join(repository,`node_modules/react-dom/umd/react-dom.${variant}.js`))};
 const html=`<!doctype html><div id="app"></div><div id="target"></div><div id="nested"></div><script src="/runtime.js"></script><script>
 window.records=[];window.results=[];window.cleanups=0;window.recorder=ProductTrace.start(${JSON.stringify(integration.bindings)},{outputMode:'evidence',onRecord:row=>records.push(row)});
 </script><script src="/react.js"></script><script src="/dom.js"></script><script>
 window.appRoot=ReactDOM.createRoot(document.getElementById('app'));
 class Target extends window.React.Component{componentWillUnmount(){window.cleanups++;}render(){return React.createElement('input',{id:'child'});}}
 window.mountTarget=()=>{window.unmountTarget=document.getElementById('target');ReactDOM.render(React.createElement(Target),unmountTarget);};
 ${compiled}
 mount();mountTarget();</script>`;
 const server=http.createServer((req,res)=>{if(assets[req.url])res.end(assets[req.url]);else{res.setHeader('content-type','text/html');res.end(html);}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
 try{
  browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.stack));await page.goto(`http://127.0.0.1:${server.address().port}`);assert.deepEqual(errors,[]);
  await page.click('#unmount');assert.equal(await page.evaluate(()=>results.at(-1)),true);assert.equal(await page.evaluate(()=>cleanups),1);assert.equal(await page.locator('#target').textContent(),'');
  await page.click('#unmount');assert.equal(await page.evaluate(()=>results.at(-1)),false);assert.equal(await page.evaluate(()=>cleanups),1);
  await page.evaluate(()=>mountTarget());await page.click('#unmount');assert.equal(await page.evaluate(()=>results.at(-1)),true);assert.equal(await page.evaluate(()=>cleanups),2);
  const records=await page.evaluate(()=>records);for(const row of records)integration.onRecord(row);
  const hostRecords=records.filter(row=>row.kind==='react_host');assert.equal(hostRecords.length,3);
  for(const row of hostRecords){const joined=joins.get(row.observation_id);assert.equal(joined.status,'resolved',JSON.stringify({record:row,result:joined}));assert.ok(joined.runtime.action);assert.equal(joined.runtime.cleanup_completion_proven,false);}
  assert.deepEqual(hostRecords.map(row=>joins.get(row.observation_id).runtime.claim),['observed_legacy_root_unmount','observed_legacy_unmount_noop','observed_legacy_root_unmount']);
  const target=hostRecords[0],before=records.slice(0,records.indexOf(target));
  const mutations=[row=>{row.result.value=false;},row=>{row.lookup.container_identity=row.session+':foreign';},row=>{row.lookup.after.root.identity=row.session+':foreign';},
   row=>{row.lookup.after.commit_id=row.lookup.before.commit_id;},row=>{row.lookup.after.empty_root=false;},row=>{row.lookup.after.renderer_root_id='react-root:99999';},
   row=>{row.action.callback_observation_id='wrong';},row=>{row.action.action_occurrence_id='wrong';},row=>{row.source_call_id='wrong';},row=>{row.session='wrong';},row=>{row.lookup.basis='wrong';}];
  for(const mutation of mutations){const fresh=createReactRuntimeIntegration(map);before.forEach(row=>fresh.onRecord(row));const bad=structuredClone(target);mutation(bad);assert.equal(fresh.joinHost(bad).status,'unresolved');assert.equal(fresh.joinHost(target).status,'resolved');}
  assert.equal(createReactRuntimeIntegration(map).joinHost(target).reason,'host_action_unconfirmed');
  const concurrent=await page.evaluate(()=>{window.modern=ReactDOM.createRoot(document.getElementById('target'));ReactDOM.flushSync(()=>modern.render(React.createElement('b',null,'modern')));return unmountOutside();});
  assert.equal(concurrent,false);assert.equal(await page.locator('#target').textContent(),'modern');
  assert.equal(integration.joinHost(await page.evaluate(()=>records.filter(row=>row.kind==='react_host').at(-1))).runtime.claim,'observed_legacy_unmount_noop');await page.evaluate(()=>modern.unmount());
  const freshModern=await page.evaluate(()=>{const container=document.createElement('div');document.body.appendChild(container);const root=ReactDOM.createRoot(container);ReactDOM.flushSync(()=>root.render(React.createElement('b',null,'fresh')));unmountTarget=container;const result=unmountOutside(),preserved=container.textContent==='fresh',record=records.filter(row=>row.kind==='react_host').at(-1);root.unmount();container.remove();return {result,preserved,record};});
  assert.equal(freshModern.result,false);assert.equal(freshModern.preserved,true);assert.equal(integration.joinHost(freshModern.record).reason,'host_input_context_unobserved');
  const during=await page.evaluate(()=>{mountTarget();let once=false,value,content;
    function WhileRendering(){if(!once){once=true;value=unmountOutside();content=document.getElementById('target').textContent||document.getElementById('target').childNodes.length;}return React.createElement('i',null,'outer');}
    const nested=ReactDOM.createRoot(document.getElementById('nested'));ReactDOM.flushSync(()=>nested.render(React.createElement(WhileRendering)));nested.unmount();
    return {value,content,record:records.filter(row=>row.kind==='react_host').at(-1),empty:document.getElementById('target').childNodes.length===0};});
  assert.equal(during.value,true);assert.ok(during.content);assert.equal(during.empty,true);assert.equal(integration.joinHost(during.record).reason,'legacy_unmount_commit_unconfirmed');
  const thrown=await page.evaluate(()=>{let reads=0;const reason={original:true};unmountTarget=new Proxy({}, {get(_target,key){if(key==='nodeType'){reads++;throw reason;}return undefined;}});let same=false;try{unmountOutside();}catch(error){same=error===reason;}return {same,reads,record:records.filter(row=>row.kind==='react_host').at(-1)};});
  assert.equal(thrown.same,true);assert.equal(thrown.reads,1);assert.equal(integration.joinHost(thrown.record).reason,'host_input_context_unobserved');
  const accessor=await page.evaluate(()=>{const container=document.createElement('div');let reads=0;const reason={original:true};Object.defineProperty(container,'_reactRootContainer',{get(){reads++;throw reason;}});unmountTarget=container;let same=false;try{unmountOutside();}catch(error){same=error===reason;}return {same,reads,record:records.filter(row=>row.kind==='react_host').at(-1)};});
  assert.equal(accessor.same,true);assert.equal(accessor.reads,1);assert.equal(integration.joinHost(accessor.record).reason,'host_input_context_unobserved');
  await page.evaluate(()=>mountTarget());const stopped=await page.evaluate(()=>{recorder.stop();return records.length;});await page.click('#unmount');assert.equal(await page.evaluate(()=>records.length),stopped);assert.equal(await page.evaluate(()=>results.at(-1)),true);assert.equal(await page.locator('#target').textContent(),'');assert.deepEqual(errors,[]);
  console.log(JSON.stringify({api:'react-dom/unmountComponentAtNode/18.3.1',build,installed_source_attested:true,actual_clicks:4,host_joins:3,
   legacy_root_empty_commit:true,repeated_call_noop:true,action_receipts_required:true,independent_mutants_rejected:mutations.length,
   modern_root_preserved:true,render_phase_true_abstains:true,proxy_error_identity_preserved:true,root_getter_not_replayed:true,stop_preserves_behavior:true,cleanup_completion_proven:false},null,2));
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
}finally{fs.rmSync(temporary,{recursive:true,force:true});}
