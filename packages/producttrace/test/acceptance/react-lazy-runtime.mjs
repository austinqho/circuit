import assert from 'node:assert/strict';import fs from 'node:fs';import http from 'node:http';import os from 'node:os';import path from 'node:path';import {createRequire} from 'node:module';import ts from 'typescript';
import {analyzeReact,createReactRuntimeIntegration} from '../../analysis/index.mjs';
const repository=path.resolve(process.argv[2]||'/tmp/producttrace-librechat-autonomous'),require=createRequire(path.join(repository,'package.json')),{chromium}=require('playwright');
const build=process.env.PRODUCTTRACE_REACT_BUILD==='production'?'production':'development';
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'react-lazy-runtime-'));
const source=`import * as React from 'react';import * as DOM from 'react-dom';
const pending=new Promise(resolve=>{window.resolveLazy=resolve;});
function Ready(){return <span id="ready">ready</span>;}
function makeLazy(){return React.lazy(()=>{window.events.push('load');return pending;});}
const Lazy=makeLazy();
function App(){const [tick,setTick]=React.useState(0);return <section>
<button id="refresh" type="button" onClick={()=>setTick(tick+1)}>refresh {tick}</button>
<React.Suspense fallback={<span id="waiting">waiting</span>}><Lazy/></React.Suspense></section>;}
window.reveal=()=>resolveLazy({default:Ready});
window.mount=()=>DOM.flushSync(()=>window.root.render(<App/>));
window.fresh=()=>{const Fresh=makeLazy();DOM.flushSync(()=>window.root.render(<React.Suspense fallback="again"><Fresh/></React.Suspense>));}`;
try {
 fs.mkdirSync(path.join(temporary,'src'));fs.mkdirSync(path.join(temporary,'node_modules'));fs.writeFileSync(path.join(temporary,'src/App.tsx'),source);
 const pkg={name:'lazy-acceptance',private:true,dependencies:{react:'18.3.1','react-dom':'18.3.1'}};fs.writeFileSync(path.join(temporary,'package.json'),JSON.stringify(pkg));
 const lock=JSON.parse(fs.readFileSync(path.join(repository,'package-lock.json')));fs.writeFileSync(path.join(temporary,'package-lock.json'),JSON.stringify({name:pkg.name,lockfileVersion:3,packages:{'':pkg,'node_modules/react':lock.packages['node_modules/react'],'node_modules/react-dom':lock.packages['node_modules/react-dom']}}));
 for(const name of ['react','react-dom'])fs.symlinkSync(path.join(repository,'node_modules',name),path.join(temporary,'node_modules',name));
 const map=analyzeReact({repository:temporary}),joins=new Map(),integration=createReactRuntimeIntegration(map,{onJoin:(result,record)=>joins.set(record.observation_id,result)});
 const element=map.react_semantics.find(row=>row.export==='lazy');assert.ok(element.package_verification_sha256);
 assert.equal(map.controls.length,1);assert.equal(integration.candidates.length,1);
 const entry=integration.bindings.react_lifecycle.entries.find(row=>row.element_rule?.kind==='lazy_component');assert.ok(entry);
 const transformed=integration.instrumentSource('src/App.tsx',source);assert.deepEqual(transformed.diagnostics,[]);
 const compiled=ts.transpileModule(transformed.code.replace("import * as React from 'react';",'const React=window.React;').replace("import * as DOM from 'react-dom';",'const DOM=window.ReactDOM;'),{reportDiagnostics:true,compilerOptions:{jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.None}});
 assert.deepEqual(compiled.diagnostics.map(row=>ts.flattenDiagnosticMessageText(row.messageText,' ')),[]);
 const assets={'/runtime.js':fs.readFileSync(new URL('../../dist/producttrace-runtime.js',import.meta.url)),
 '/react.js':fs.readFileSync(path.join(temporary,`node_modules/react/umd/react.${build==='production'?'production.min':'development'}.js`)),
 '/dom.js':fs.readFileSync(path.join(temporary,`node_modules/react-dom/umd/react-dom.${build==='production'?'production.min':'development'}.js`))};
 const html=`<!doctype html><div id="app"></div><div id="first"></div><div id="second"></div><script src="/runtime.js"></script><script>
 window.records=[];window.events=[];window.recorder=ProductTrace.start(${JSON.stringify(integration.bindings)},{outputMode:'evidence',onRecord:row=>records.push(row)});
 </script><script src="/react.js"></script><script src="/dom.js"></script><script>"use strict";
 window.root=ReactDOM.createRoot(document.getElementById('app'));${compiled.outputText}mount();</script>`;
 const server=http.createServer((req,res)=>{if(assets[req.url])res.end(assets[req.url]);else{res.setHeader('content-type','text/html');res.end(html);}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
 try {
 browser=await chromium.launch({headless:true,executablePath:process.env.PRODUCTTRACE_BROWSER_EXECUTABLE});const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForSelector('#waiting');
 assert.deepEqual(await page.evaluate(()=>events),['load']);
 await page.click('#refresh');assert.deepEqual(await page.evaluate(()=>events),['load']);
 await page.evaluate(()=>reveal());await page.waitForSelector('#ready');
 await page.click('#refresh');assert.deepEqual(await page.evaluate(()=>events),['load']);
 const records=await page.evaluate(()=>records);for(const row of records)integration.onRecord(row);
 const observations=records.filter(row=>row.kind==='react_element'&&row.semantic_id===element.semantic_id);assert.equal(observations.length,3);
 for(const row of observations)assert.equal(joins.get(row.observation_id).status,'resolved',JSON.stringify(joins.get(row.observation_id)));
 const [created,loaded,settled]=observations;assert.equal(loaded.operation,'loader_returned');assert.equal(settled.operation,'loader_fulfilled');
 const proof=joins.get(loaded.observation_id);assert.equal(proof.runtime.creation_observation_id,created.observation_id);
 const settlementProof=joins.get(settled.observation_id);assert.equal(settlementProof.runtime.thenable_settlement_observed,true);
 assert.equal(settlementProof.runtime.thenable_identity,proof.runtime.result.identity);
 const lazyCommits=records.filter(row=>row.kind==='react_lazy_commit');assert.equal(lazyCommits.length,1);
 const lazyCommit=lazyCommits[0],commitProof=joins.get(lazyCommit.observation_id);assert.equal(commitProof.status,'resolved',JSON.stringify(commitProof));
 assert.equal(commitProof.runtime.allocation_observation_id,created.observation_id);
 assert.equal(commitProof.runtime.loader_observation_id,loaded.observation_id);
 assert.equal(commitProof.runtime.settlement_observation_id,settled.observation_id);
 assert.equal(commitProof.runtime.module_property_selected_by_verified_rule,true);
 assert.equal(commitProof.runtime.module_property_read_directly_by_tracer,false);
 const boundaryCommits=records.filter(row=>row.kind==='react_boundary_commit'&&['fallback','children'].includes(row.selection?.selection));
 assert.ok(boundaryCommits.length>=2);assert.notEqual(commitProof.runtime.fallback_boundary_commit_observation_id,commitProof.runtime.reveal_boundary_commit_observation_id);
 assert.ok(map.edges.some(row=>row.callback_source_id===proof.runtime.source_id&&row.conditions.some(condition=>condition.runtime_observed===false)));
 const actions=records.filter(row=>row.kind==='action');assert.equal(actions.length,2);for(const row of actions)assert.equal(integration.join(row).status,'resolved');
 const mutations=[{source_id:'wrong'},{creation_observation_id:created.session+':wrong'},{lazy_identity:created.session+':other'},
  {loader_identity:created.session+':other'},{arguments:[loaded.result]},{session:'wrong'}];
 for(const mutation of mutations){const check=createReactRuntimeIntegration(map);assert.equal(check.joinElement(created).status,'resolved');
  assert.equal(check.joinElement({...loaded,...mutation}).status,'unresolved');assert.equal(check.joinElement(loaded).status,'resolved');}
 assert.equal(createReactRuntimeIntegration(map).joinElement(loaded).reason,'lazy_loader_origin_unobserved');
 const commitMutations=[{module_identity:created.session+':other'},{component_identity:'other'},
  {fallback_boundary_commit_observation_id:created.session+':other'},{reveal_boundary_commit_observation_id:created.session+':other'},
  {renderer:{...lazyCommit.renderer,commit_id:'wrong'}}];
 for(const mutation of commitMutations){const check=createReactRuntimeIntegration(map);for(const row of records)if(row.kind!=='react_lazy_commit')check.onRecord(row);
  assert.equal(check.joinLazyCommit({...lazyCommit,...mutation}).status,'unresolved');}
 const stopped=await page.evaluate(()=>{recorder.stop();return records.length;});await page.evaluate(()=>fresh());await page.waitForSelector('#ready');
 assert.equal(await page.evaluate(()=>records.length),stopped);assert.deepEqual(await page.evaluate(()=>events),['load','load']);assert.deepEqual(errors,[]);
 console.log(JSON.stringify({api:'react/lazy/18.3.1',build,installed_source_attested:true,lazy_observations:observations.length,
 real_renderer_invokes_loader:true,pending_and_resolved_cache_reused:true,allocation_and_source_required:true,
 independent_mutants_rejected:mutations.length+commitMutations.length,stop_preserves_behavior:true,thenable_settlement_observed:true,
 module_selection_through_verified_rule:true,fallback_reveal_retry_commit:true,direct_module_read_by_tracer:false},null,2));
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
}finally{fs.rmSync(temporary,{recursive:true,force:true});}
