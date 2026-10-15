import assert from 'node:assert/strict';import fs from 'node:fs';import http from 'node:http';import os from 'node:os';import path from 'node:path';import {createRequire} from 'node:module';import ts from 'typescript';
import {analyzeReact,createReactRuntimeIntegration} from '../../analysis/index.mjs';
const repository=path.resolve(process.argv[2]||'/tmp/producttrace-librechat-autonomous'),require=createRequire(path.join(repository,'package.json')),{chromium}=require('playwright');
const build=process.env.PRODUCTTRACE_REACT_BUILD==='production'?'production':'development';
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'react-debug-runtime-'));
const source=`import * as React from 'react';import * as DOM from 'react-dom';
function App({tick}){React.useDebugValue(tick,window.formatter);const click=React.useCallback(()=>window.events.push(tick),[tick]);
 return <button type="button" id="debug-button" onClick={click}>{tick}</button>;}
window.mount=(tick=0)=>DOM.flushSync(()=>window.root.render(<App tick={tick}/>));`;
try {
 fs.mkdirSync(path.join(temporary,'src'));fs.mkdirSync(path.join(temporary,'node_modules'));fs.writeFileSync(path.join(temporary,'src/App.tsx'),source);
 const pkg={name:'debug-acceptance',private:true,dependencies:{react:'18.3.1','react-dom':'18.3.1'}};fs.writeFileSync(path.join(temporary,'package.json'),JSON.stringify(pkg));
 const lock=JSON.parse(fs.readFileSync(path.join(repository,'package-lock.json')));fs.writeFileSync(path.join(temporary,'package-lock.json'),JSON.stringify({name:pkg.name,lockfileVersion:3,packages:{'':pkg,'node_modules/react':lock.packages['node_modules/react'],'node_modules/react-dom':lock.packages['node_modules/react-dom']}}));
 for(const name of ['react','react-dom'])fs.symlinkSync(path.join(repository,'node_modules',name),path.join(temporary,'node_modules',name));
 const map=analyzeReact({repository:temporary}),joins=new Map(),integration=createReactRuntimeIntegration(map,{onJoin:(result,record)=>joins.set(record.observation_id,result)});
 const debug=map.react_semantics.find(row=>row.export==='useDebugValue');assert.ok(debug.package_verification_sha256);
 assert.equal(map.controls.length,1);assert.equal(integration.candidates.length,1);
 const entry=integration.bindings.react_lifecycle.entries.find(row=>row.debug_value_rule);assert.ok(entry);
 assert.equal(integration.bindings.react_lifecycle.entries.filter(row=>row.source_call_id===debug.call_id && row.kind==='callback').length,0);
 const transformed=integration.instrumentSource('src/App.tsx',source);assert.deepEqual(transformed.diagnostics,[]);
 const compiled=ts.transpileModule(transformed.code.replace("import * as React from 'react';",'const React=window.React;').replace("import * as DOM from 'react-dom';",'const DOM=window.ReactDOM;'),{reportDiagnostics:true,compilerOptions:{jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.None}});
 assert.deepEqual(compiled.diagnostics.map(row=>ts.flattenDiagnosticMessageText(row.messageText,' ')),[]);
 const assets={'/runtime.js':fs.readFileSync(new URL('../../dist/producttrace-runtime.js',import.meta.url)),
 '/react.js':fs.readFileSync(path.join(temporary,`node_modules/react/umd/react.${build==='production'?'production.min':'development'}.js`)),
 '/dom.js':fs.readFileSync(path.join(temporary,`node_modules/react-dom/umd/react-dom.${build==='production'?'production.min':'development'}.js`))};
 const html=`<!doctype html><div id="app"></div><div id="first"></div><div id="second"></div><script src="/runtime.js"></script><script>
 window.records=[];window.events=[];window.formats=[];window.formatter=value=>{formats.push(value);return 'label:'+value;};window.originalFormatter=window.formatter;window.recorder=ProductTrace.start(${JSON.stringify(integration.bindings)},{outputMode:'evidence',onRecord:row=>records.push(row)});
 </script><script src="/react.js"></script><script src="/dom.js"></script><script>"use strict";
 window.root=ReactDOM.createRoot(document.getElementById('app'));${compiled.outputText}mount();</script>`;
 const server=http.createServer((req,res)=>{if(assets[req.url])res.end(assets[req.url]);else{res.setHeader('content-type','text/html');res.end(html);}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
 try {
 browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForSelector('#debug-button',{timeout:5000});
 await page.click('#debug-button');await page.evaluate(()=>mount(1));await page.click('#debug-button');
 assert.deepEqual(await page.evaluate(()=>events),[0,1]);assert.deepEqual(await page.evaluate(()=>formats),[]);
 assert.equal(await page.evaluate(()=>formatter===originalFormatter),true);
 const records=await page.evaluate(()=>records);for(const record of records)integration.onRecord(record);
 const debugRecords=records.filter(row=>row.kind==='react_api' && row.export==='useDebugValue');assert.equal(debugRecords.length,2);
 for(const row of debugRecords){const joined=joins.get(row.observation_id);assert.equal(joined.status,'resolved',JSON.stringify(joined));
  assert.equal(joined.runtime.debug_value_proof.selected_execution_context,null);
  assert.equal(joined.runtime.debug_value_proof.formatter_execution_proven,false);
  assert.deepEqual(joined.runtime.debug_value_proof.standard_renderer.callbacks,[]);}
 const actions=records.filter(row=>row.kind==='action');assert.equal(actions.length,2);
 for(const row of actions)assert.equal(integration.join(row).status,'resolved');
 const callbacks=records.filter(row=>row.operation==='callback_invoked');assert.equal(callbacks.length,2);
 assert.ok(callbacks.every(row=>row.semantic_id!=='react/useDebugValue/18.3.1'));
 for(const row of callbacks)assert.equal(joins.get(row.observation_id).status,'resolved');
 const mutations=[{semantic_id:'wrong'},{map_fingerprint:'wrong'},{source_call_id:'wrong'},{runtime_observed:false}];
 for(const mutation of mutations)assert.equal(integration.joinApi({...debugRecords[0],...mutation}).status,'unresolved');
 // A later manual formatter call is not an observed product callback merely
 // because that function was supplied to useDebugValue during an earlier render.
 assert.equal(await page.evaluate(()=>formatter('manual')),'label:manual');
 assert.equal(await page.evaluate(()=>records.length),records.length);
 const stopped=await page.evaluate(()=>{recorder.stop();return records.length;});await page.evaluate(()=>mount(2));await page.click('#debug-button');
 assert.equal(await page.evaluate(()=>records.length),stopped);assert.deepEqual(await page.evaluate(()=>events),[0,1,2]);assert.deepEqual(errors,[]);
 console.log(JSON.stringify({api:'react/useDebugValue/18.3.1',build,installed_source_attested:true,normal_render_observations:debugRecords.length,
 actual_clicks:3,source_callback_path_unchanged:true,normal_renderer_did_not_call_formatter:true,formatter_identity_preserved:true,
 manual_formatter_not_product_callback:true,execution_context_not_inferred:true,independent_mutants_rejected:mutations.length,stop_preserves_behavior:true,
 official_devtools_inspection_tested:false},null,2));
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
}finally{fs.rmSync(temporary,{recursive:true,force:true});}
