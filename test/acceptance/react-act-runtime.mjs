import assert from 'node:assert/strict';
import fs from 'node:fs';import http from 'node:http';import os from 'node:os';import path from 'node:path';
import {createRequire} from 'node:module';import ts from 'typescript';
import {analyzeReact,createReactRuntimeIntegration} from '../../analysis/index.mjs';
const repository=path.resolve(process.argv[2]||'/tmp/producttrace-librechat-autonomous');
const require=createRequire(path.join(repository,'package.json')),{chromium}=require('playwright');
const build=process.env.PRODUCTTRACE_REACT_BUILD==='production'?'production':'development';
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'react-act-runtime-'));
const source=`import * as React from 'react';import * as DOM from 'react-dom';
function send(value){window.events.push(value);return value;}
function App({label}){const [count,setCount]=React.useState(0);return <section>
 <output id="count">{count}</output>
 <button type="button" id="act" onClick={()=>{window.pending=React.act(()=>{setCount(value=>value+1);return send(label);});}}>act</button>
 <button type="button" id="unstable" onClick={()=>{window.pending=React.unstable_act(()=>{setCount(value=>value+1);return send(label+':alias');});}}>alias</button>
 </section>;}
window.mount=()=>DOM.flushSync(()=>window.root.render(<App label="chat"/>));
window.runError=()=>React.act(()=>{throw window.originalError;});
window.runAsync=()=>React.act(async()=>{send('async:start');await Promise.resolve();send('async:end');return window.sentinel;});
window.runNested=()=>React.act(()=>{React.unstable_act(()=>send('nested:inner'));return send('nested:outer');});`;
try{
 fs.mkdirSync(path.join(temporary,'src'));fs.mkdirSync(path.join(temporary,'node_modules'));fs.writeFileSync(path.join(temporary,'src/App.tsx'),source);
 const pkg={name:'act-acceptance',private:true,dependencies:{react:'18.3.1','react-dom':'18.3.1'}};
 fs.writeFileSync(path.join(temporary,'package.json'),JSON.stringify(pkg));
 const lock=JSON.parse(fs.readFileSync(path.join(repository,'package-lock.json')));
 fs.writeFileSync(path.join(temporary,'package-lock.json'),JSON.stringify({name:pkg.name,lockfileVersion:3,packages:{'':pkg,'node_modules/react':lock.packages['node_modules/react'],'node_modules/react-dom':lock.packages['node_modules/react-dom']}}));
 for(const name of ['react','react-dom'])fs.symlinkSync(path.join(repository,'node_modules',name),path.join(temporary,'node_modules',name));
 const map=analyzeReact({repository:temporary}),integration=createReactRuntimeIntegration(map);
 const applications=map.react_semantics.filter(row=>row.behavior?.execution?.kind==='test_scope');
 assert.equal(applications.length,6);assert.ok(applications.every(row=>row.package_verification_sha256));
 const transformed=integration.instrumentSource('src/App.tsx',source);assert.deepEqual(transformed.diagnostics,[]);
 const compiled=ts.transpileModule(transformed.code.replace("import * as React from 'react';",'const React=window.React;').replace("import * as DOM from 'react-dom';",'const DOM=window.ReactDOM;'),{reportDiagnostics:true,compilerOptions:{jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.None}});
 assert.deepEqual(compiled.diagnostics.map(row=>ts.flattenDiagnosticMessageText(row.messageText,' ')),[]);
 const assets={'/runtime.js':fs.readFileSync(new URL('../../dist/producttrace-runtime.js',import.meta.url)),
  '/react.js':fs.readFileSync(path.join(temporary,`node_modules/react/umd/react.${build==='production'?'production.min':'development'}.js`)),
  '/dom.js':fs.readFileSync(path.join(temporary,`node_modules/react-dom/umd/react-dom.${build==='production'?'production.min':'development'}.js`))};
 const html=`<!doctype html><div id="app"></div><script src="/runtime.js"></script><script>
 window.records=[];window.events=[];window.originalError={original:true};window.sentinel={same:true};
 window.recorder=ProductTrace.start(${JSON.stringify(integration.bindings)},{outputMode:'evidence',onRecord:row=>records.push(row)});
 </script><script src="/react.js"></script><script src="/dom.js"></script><script>"use strict";
 window.root=ReactDOM.createRoot(document.getElementById('app'));${compiled.outputText}mount();</script>`;
 const server=http.createServer((req,res)=>{if(assets[req.url])res.end(assets[req.url]);else{res.setHeader('content-type','text/html');res.end(html);}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
 try{
  browser=await chromium.launch({headless:true,executablePath:process.env.PRODUCTTRACE_BROWSER_EXECUTABLE||undefined});
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForSelector('#act');
  for(const id of ['act','unstable']){await page.click('#'+id);if(build==='development')await page.evaluate(async()=>{await pending;});}
  assert.deepEqual(await page.evaluate(()=>events),build==='development'?['chat','chat:alias']:[]);
  assert.equal(await page.textContent('#count'),build==='development'?'2':'0');
  if(build==='development'){
   assert.equal(await page.evaluate(()=>{try{runError();return false;}catch(e){return e===originalError;}}),true);
   assert.equal(await page.evaluate(async()=>await runAsync()===sentinel),true);
   await page.evaluate(async()=>{await runNested();});
   assert.deepEqual(await page.evaluate(()=>events),['chat','chat:alias','async:start','async:end','nested:inner','nested:outer']);
  }
  const records=await page.evaluate(()=>records);for(const row of records)integration.onRecord(row);
  const actions=records.filter(row=>row.kind==='action');assert.equal(actions.length,2);
  for(const row of actions)assert.equal(integration.join(row).status,'resolved');
  const scopes=records.filter(row=>row.kind==='react_api'&&['act','unstable_act'].includes(row.export));
  assert.equal(scopes.length,build==='development'?6:2);
  let rejected=0;
  if(build==='development'){
   for(const row of scopes){const result=integration.joinApi(row);assert.equal(result.status,'resolved',JSON.stringify(result));
    assert.equal(result.runtime.scope_proof.await_completion_observed,false);assert.equal(result.runtime.scope_proof.scheduling.queue_drain_observed,false);}
   const clickScopes=scopes.filter(row=>row.scope.action_occurrence_id);assert.equal(clickScopes.length,2);
   for(const row of clickScopes){const proof=integration.joinApi(row).runtime.scope_proof;
    assert.equal(proof.action_link.status,'resolved');assert.equal(proof.scheduling.state_requests_observed,1);
    assert.equal(proof.scheduling.commit_observed,true);assert.equal(proof.scheduling.committed_state_updates.length,1);
    assert.equal(proof.scheduling.priority_effect_proven,false);}
   assert.ok(scopes.some(row=>row.scope.parent_scope_id&&scopes.some(parent=>parent.scope.scope_id===row.scope.parent_scope_id)));
   const valid=clickScopes[0],mutations=[row=>{row.scope.callbacks=[];},row=>{row.scope.callbacks.push(row.scope.callbacks[0]);},
    row=>{row.scope.callbacks[0].source_id='other';},row=>{row.scope.callbacks[0].arguments=[row.scope.result];},
    row=>{row.scope.result=row.scope.callbacks[0].result;row.result_kind=row.scope.result.kind;},row=>{row.session='other';}];
   for(const mutation of mutations){const bad=structuredClone(valid);mutation(bad);assert.equal(integration.joinApi(bad).status,'unresolved');rejected++;}
   assert.deepEqual(errors,[]);
  }else{
   for(const row of scopes){assert.equal(row.scope.callbacks.length,0);assert.equal(row.operation,'threw');assert.equal(integration.joinApi(row).reason,'scope_callback_count_mismatch');}
   assert.ok(errors.length>=2);assert.ok(errors.every(message=>message.includes('not supported in production')));
  }
  const stopped=await page.evaluate(()=>{recorder.stop();return records.length;});await page.click('#act');
  if(build==='development')await page.evaluate(async()=>{await pending;});
  assert.equal(await page.evaluate(()=>records.length),stopped);
  console.log(JSON.stringify({build,installed_source_attested:true,actual_clicks:3,scope_observations:scopes.length,
   callback_paths_joined:build==='development',production_callback_abstention:build==='production',independent_mutants_rejected:rejected,
   original_error_preserved:build==='development',async_and_nested_calls_preserved:build==='development',stop_preserves_behavior:true,
   synchronous_scoped_state_commits:build==='development'?2:0,
   post_await_state_commit_attribution_proven:false,await_completion_observed:false,queue_drain_observed:false},null,2));
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
}finally{fs.rmSync(temporary,{recursive:true,force:true});}
