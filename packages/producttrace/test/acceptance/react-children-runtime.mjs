import assert from 'node:assert/strict';import fs from 'node:fs';import http from 'node:http';import os from 'node:os';import path from 'node:path';import {createRequire} from 'node:module';import ts from 'typescript';
import {analyzeReact,createReactRuntimeIntegration} from '../../analysis/index.mjs';
const repository=path.resolve(process.argv[2]||'/tmp/producttrace-librechat-autonomous'),require=createRequire(path.join(repository,'package.json')),{chromium}=require('playwright');
const build=process.env.PRODUCTTRACE_REACT_BUILD==='production'?'production':'development';
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'react-children-runtime-'));
const source=`import * as React from 'react';import * as DOM from 'react-dom';
function App({tick}){const click=React.useCallback(()=>{const context=window.receiver;
 React.Children.map(window.items,function(child,index){window.calls.push(['map',child,index,this===context]);if(window.fail && index===1)throw window.expectedError;return child;},context);
 React.Children.forEach(window.items,function(child,index){window.calls.push(['forEach',child,index,this===context]);},context);
 window.counts.push(React.Children.count(window.items));window.lengths.push(React.Children.toArray(window.items).length);
 window.only.push(React.Children.only(window.element)===window.element);
},[tick]);window.runClick=click;return <button type="button" id="children-button" onClick={click}>{tick}</button>;}
window.mount=(tick=0)=>DOM.flushSync(()=>window.root.render(<App tick={tick}/>));`;
try {
 fs.mkdirSync(path.join(temporary,'src'));fs.mkdirSync(path.join(temporary,'node_modules'));fs.writeFileSync(path.join(temporary,'src/App.tsx'),source);
 const pkg={name:'children-acceptance',private:true,dependencies:{react:'18.3.1','react-dom':'18.3.1'}};fs.writeFileSync(path.join(temporary,'package.json'),JSON.stringify(pkg));
 const lock=JSON.parse(fs.readFileSync(path.join(repository,'package-lock.json')));fs.writeFileSync(path.join(temporary,'package-lock.json'),JSON.stringify({name:pkg.name,lockfileVersion:3,packages:{'':pkg,'node_modules/react':lock.packages['node_modules/react'],'node_modules/react-dom':lock.packages['node_modules/react-dom']}}));
 for(const name of ['react','react-dom'])fs.symlinkSync(path.join(repository,'node_modules',name),path.join(temporary,'node_modules',name));
 const map=analyzeReact({repository:temporary}),joins=new Map(),integration=createReactRuntimeIntegration(map,{onJoin:(result,record)=>joins.set(record.observation_id,result)});
 const semantics=map.react_semantics.filter(row=>row.export==='Children');assert.ok(semantics.every(row=>row.package_verification_sha256));
 assert.equal(map.controls.length,1);assert.equal(integration.candidates.length,1);
 const entries=integration.bindings.react_lifecycle.entries.filter(row=>row.children_rule);assert.equal(entries.length,5);
 const transformed=integration.instrumentSource('src/App.tsx',source);assert.deepEqual(transformed.diagnostics,[]);
 const compiled=ts.transpileModule(transformed.code.replace("import * as React from 'react';",'const React=window.React;').replace("import * as DOM from 'react-dom';",'const DOM=window.ReactDOM;'),{reportDiagnostics:true,compilerOptions:{jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.None}});
 assert.deepEqual(compiled.diagnostics.map(row=>ts.flattenDiagnosticMessageText(row.messageText,' ')),[]);
 const assets={'/runtime.js':fs.readFileSync(new URL('../../dist/producttrace-runtime.js',import.meta.url)),
 '/react.js':fs.readFileSync(path.join(temporary,`node_modules/react/umd/react.${build==='production'?'production.min':'development'}.js`)),
 '/dom.js':fs.readFileSync(path.join(temporary,`node_modules/react-dom/umd/react-dom.${build==='production'?'production.min':'development'}.js`))};
 const html=`<!doctype html><div id="app"></div><div id="first"></div><div id="second"></div><script src="/runtime.js"></script><script>
 window.records=[];window.calls=[];window.counts=[];window.lengths=[];window.only=[];window.caught=[];window.receiver={};window.items=['a',[null,false,'b']];window.fail=false;window.expectedError=Error('expected');window.recorder=ProductTrace.start(${JSON.stringify(integration.bindings)},{outputMode:'evidence',onRecord:row=>records.push(row)});
 </script><script src="/react.js"></script><script src="/dom.js"></script><script>"use strict";
 window.root=ReactDOM.createRoot(document.getElementById('app'));window.element=window.React.createElement('b',null,'only');${compiled.outputText}mount();</script>`;
 const server=http.createServer((req,res)=>{if(assets[req.url])res.end(assets[req.url]);else{res.setHeader('content-type','text/html');res.end(html);}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
 try {
 browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForSelector('#children-button',{timeout:5000}).catch(error=>{throw new Error(JSON.stringify({errors,message:error.message}));});
 await page.click('#children-button');await page.evaluate(()=>mount(1));await page.click('#children-button');
 assert.deepEqual(await page.evaluate(()=>counts),[4,4]);assert.deepEqual(await page.evaluate(()=>lengths),[2,2]);assert.deepEqual(await page.evaluate(()=>only),[true,true]);
 assert.equal(await page.evaluate(()=>{window.fail=true;try{runClick();return false;}catch(error){return error===expectedError;}}),true);
 const calls=await page.evaluate(()=>calls);assert.equal(calls.length,18);assert.ok(calls.every(row=>row[3]===true));
 const records=await page.evaluate(()=>records);for(const record of records)integration.onRecord(record);
 const childRecords=records.filter(row=>row.kind==='react_api' && row.scope && row.export==='Children');assert.equal(childRecords.length,11);
 for(const row of childRecords){const joined=joins.get(row.observation_id);assert.equal(joined.status,'resolved',JSON.stringify(joined));
  const proof=joined.runtime.children_proof;assert.ok(proof.observed_callback_edges.every(edge=>edge.source_paths.length>0));assert.equal(proof.input_traversal_proven,false);assert.equal(proof.result_keys_proven,false);
  assert.equal(proof.action_link.status,row.scope.action_occurrence_id?'resolved':'not_applicable',JSON.stringify({member:proof.member,action:proof.action_link}));}
 assert.equal(childRecords.filter(row=>row.operation==='threw').length,1);
 const observed=childRecords.flatMap(row=>row.scope.callbacks);assert.equal(observed.length,18);
 const actions=records.filter(row=>row.kind==='action');assert.equal(actions.length,2);for(const row of actions)assert.equal(integration.join(row).status,'resolved');
 const valid=childRecords.find(row=>row.scope.callbacks.length===4),mutations=[{semantic_id:'wrong'},{session:'wrong'},{map_fingerprint:'wrong'},{runtime_observed:false}];
 for(const mutation of mutations)assert.equal(integration.joinApi({...valid,...mutation}).status,'unresolved');
 const changed=structuredClone(valid);changed.scope.callbacks[1].arguments[1].value=0;assert.equal(integration.joinApi(changed).status,'unresolved');
 // API/callback evidence survives without a source action, but the action link
 // must explicitly reject rather than borrowing a previous click.
 const isolated=createReactRuntimeIntegration(map).joinApi(valid);assert.equal(isolated.status,'resolved');assert.equal(isolated.runtime.children_proof.action_link.status,'unresolved');
 const stopped=await page.evaluate(()=>{recorder.stop();return records.length;});await page.evaluate(()=>{window.fail=false;mount(2);});await page.click('#children-button');
 assert.equal(await page.evaluate(()=>records.length),stopped);assert.deepEqual(await page.evaluate(()=>counts),[4,4,4]);assert.deepEqual(errors,[]);
 console.log(JSON.stringify({api:'react/Children/18.3.1',build,installed_source_attested:true,methods:['map','forEach','count','toArray','only'],
 actual_clicks:3,source_callback_paths_verified:true,observed_callbacks:observed.length,receiver_and_indices_verified:true,
 callback_throw_preserved:true,action_occurrences_joined:true,missing_action_rejected:true,independent_mutants_rejected:5,
 stop_preserves_behavior:true,input_traversal_proven:false,result_keys_proven:false},null,2));
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
}finally{fs.rmSync(temporary,{recursive:true,force:true});}
