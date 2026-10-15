import assert from 'node:assert/strict';import fs from 'node:fs';import http from 'node:http';import os from 'node:os';import path from 'node:path';import {createRequire} from 'node:module';import ts from 'typescript';
import {analyzeReact,createReactRuntimeIntegration} from '../../analysis/index.mjs';
const repository=path.resolve(process.argv[2]||'/tmp/producttrace-librechat-autonomous'),require=createRequire(path.join(repository,'package.json')),{chromium}=require('playwright');
const build=process.env.PRODUCTTRACE_REACT_BUILD==='production'?'production':'development';
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'react-portal-runtime-'));
const source=`import * as React from 'react';import * as DOM from 'react-dom';const place=DOM.createPortal;
function App({tick,target,pkey}){const click=React.useCallback(()=>window.events.push(tick),[]);
 const view=place(<button type="button" id="portal-button" onClick={click}>{tick}</button>,target,pkey);if(tick===99)throw window.never;return view;}
window.mount=(tick=0,target=window.first,pkey='initial')=>DOM.flushSync(()=>window.root.render(<App tick={tick} target={target} pkey={pkey}/>));
window.interrupt=target=>React.startTransition(()=>window.root.render(<App tick={99} target={target} pkey="interrupted"/>));
window.abandon=target=>DOM.createPortal(<i id="abandoned-portal">unused</i>,target,'abandoned');
window.clearPortal=()=>DOM.flushSync(()=>window.root.render(null));`;
try {
 fs.mkdirSync(path.join(temporary,'src'));fs.mkdirSync(path.join(temporary,'node_modules'));fs.writeFileSync(path.join(temporary,'src/App.tsx'),source);
 const pkg={name:'portal-acceptance',private:true,dependencies:{react:'18.3.1','react-dom':'18.3.1'}};fs.writeFileSync(path.join(temporary,'package.json'),JSON.stringify(pkg));
 const lock=JSON.parse(fs.readFileSync(path.join(repository,'package-lock.json')));fs.writeFileSync(path.join(temporary,'package-lock.json'),JSON.stringify({name:pkg.name,lockfileVersion:3,packages:{'':pkg,'node_modules/react':lock.packages['node_modules/react'],'node_modules/react-dom':lock.packages['node_modules/react-dom']}}));
 for(const name of ['react','react-dom'])fs.symlinkSync(path.join(repository,'node_modules',name),path.join(temporary,'node_modules',name));
 const map=analyzeReact({repository:temporary}),joins=new Map(),integration=createReactRuntimeIntegration(map,{onJoin:(result,record)=>joins.set(record.observation_id,result)});
 const portal=map.react_semantics.find(row=>row.export==='createPortal');assert.ok(portal.package_verification_sha256);
 assert.equal(map.controls.length,1);assert.equal(integration.candidates.length,1);
 const transformed=integration.instrumentSource('src/App.tsx',source);assert.deepEqual(transformed.diagnostics,[]);
 const compiled=ts.transpileModule(transformed.code.replace("import * as React from 'react';",'const React=window.React;').replace("import * as DOM from 'react-dom';",'const DOM=window.ReactDOM;'),{reportDiagnostics:true,compilerOptions:{jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.None}});
 assert.deepEqual(compiled.diagnostics.map(row=>ts.flattenDiagnosticMessageText(row.messageText,' ')),[]);
 const assets={'/runtime.js':fs.readFileSync(new URL('../../dist/producttrace-runtime.js',import.meta.url)),
 '/react.js':fs.readFileSync(path.join(temporary,`node_modules/react/umd/react.${build==='production'?'production.min':'development'}.js`)),
 '/dom.js':fs.readFileSync(path.join(temporary,`node_modules/react-dom/umd/react-dom.${build==='production'?'production.min':'development'}.js`))};
 const html=`<!doctype html><div id="app"></div><div id="first"></div><div id="second"></div><script src="/runtime.js"></script><script>
 window.records=[];window.events=[];window.recorder=ProductTrace.start(${JSON.stringify(integration.bindings)},{outputMode:'evidence',onRecord:row=>records.push(row)});
 </script><script src="/react.js"></script><script src="/dom.js"></script><script>"use strict";
 window.never={then(){}};window.root=ReactDOM.createRoot(document.getElementById('app'));${compiled.outputText}mount();</script>`;
 const server=http.createServer((req,res)=>{if(assets[req.url])res.end(assets[req.url]);else{res.setHeader('content-type','text/html');res.end(html);}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
 try {
 browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForSelector('#first #portal-button',{timeout:5000});
 assert.equal(await page.locator('#app button').count(),0);await page.click('#portal-button');
 await page.evaluate(()=>mount(1,first,'initial'));assert.equal(await page.locator('#portal-button').textContent(),'1');await page.click('#portal-button');
 const beforeInterrupt=await page.evaluate(()=>records.filter(row=>row.kind==='react_portal').length);await page.evaluate(()=>interrupt(first));
 await page.waitForFunction(count=>records.filter(row=>row.kind==='react_portal').length>count,beforeInterrupt);
 await page.evaluate(()=>mount(2,second,'moved'));assert.equal(await page.locator('#first button').count(),0);assert.equal(await page.locator('#second button').count(),1);await page.click('#portal-button');
 assert.deepEqual(await page.evaluate(()=>events),[0,0,0],'retained callback keeps its creating render despite portal moves and key changes');
 await page.evaluate(()=>abandon(first));assert.equal(await page.locator('#abandoned-portal').count(),0,'an allocated portal is not a committed portal');
 await page.evaluate(()=>clearPortal());await page.waitForTimeout(0);assert.equal(await page.locator('#portal-button').count(),0);
 const records=await page.evaluate(()=>records);for(const record of records)integration.onRecord(record);
 const descriptions=records.filter(row=>row.kind==='react_portal'),actions=records.filter(row=>row.kind==='action'),callbacks=records.filter(row=>row.operation==='callback_invoked');
 const commits=records.filter(row=>row.kind==='react_portal_commit'&&row.operation==='committed'),unmounts=records.filter(row=>row.kind==='react_portal_commit'&&row.operation==='unmounted');
 assert.equal(descriptions.length,5);assert.equal(actions.length,3);assert.equal(callbacks.length,3);assert.ok(commits.length>=3);assert.ok(unmounts.length>=2);
 assert.equal(new Set(commits.map(row=>row.origin_observation_id)).size,3,'each rendered portal description acquired commit evidence');
 for(const row of descriptions){const result=joins.get(row.observation_id);assert.equal(result.status,'resolved',JSON.stringify(result));assert.equal(result.runtime.host_commit_proven,false);assert.equal(result.runtime.children_callback_execution_proven,false);}
 for(const row of [...commits,...unmounts])assert.equal(joins.get(row.observation_id).status,'resolved',JSON.stringify(joins.get(row.observation_id)));
 const abandoned=descriptions.find(row=>row.inputs[2]?.value==='abandoned');assert.ok(abandoned);assert.equal(commits.some(row=>row.origin_observation_id===abandoned.observation_id),false);
 const interrupted=descriptions.find(row=>row.inputs[2]?.value==='interrupted');assert.ok(interrupted);assert.equal(commits.some(row=>row.origin_observation_id===interrupted.observation_id),false);
 for(const row of callbacks)assert.equal(joins.get(row.observation_id).status,'resolved');
 for(const row of actions){const result=integration.join(row);assert.equal(result.status,'resolved',JSON.stringify(result));
 assert.ok(result.source.conditions.some(condition=>condition.node_id===portal.call_id && condition.react_portal_input===0 && condition.runtime_observed===false));
 assert.equal(result.runtime.portal_selections.length,1);assert.equal(result.runtime.portal_selections[0].status,'resolved');
 assert.equal(result.runtime.remaining_conditions.some(condition=>condition.react_portal_input===0),false);}
 const initial=descriptions[0],mutants=[{marker:'react.element'},{fields:{...initial.fields,children:initial.fields.containerInfo}},
 {inputs:{}},{map_fingerprint:'other'},{session:'other'},{runtime_observed:false}];
 for(const mutant of mutants){const check=createReactRuntimeIntegration(map);assert.equal(check.joinPortal({...initial,...mutant}).status,'unresolved');assert.equal(check.joinPortal(initial).status,'resolved');}
 const stopped=await page.evaluate(()=>{recorder.stop();return records.length;});await page.evaluate(()=>mount(3,first,'again'));await page.click('#portal-button');assert.equal(await page.evaluate(()=>records.length),stopped);
 assert.deepEqual(await page.evaluate(()=>events),[0,0,0,3],'a remount creates a new retained callback after the prior portal unmounted');assert.deepEqual(errors,[]);
 console.log(JSON.stringify({api:'react-dom/createPortal/18.3.1',build,installed_source_attested:true,actual_clicks:4,source_child_to_native_control:true,
 portal_description_observations:descriptions.length,portal_commit_observations:commits.length,portal_unmount_observations:unmounts.length,
 callback_body_entries:callbacks.length,container_change_and_key_update_preserve_callback:true,
 independent_description_mutants_rejected:mutants.length,stop_preserves_behavior:true,source_guard_retained:true,
 host_commit_lineage_proven:true,portal_description_to_exact_click_occurrence_proven:true,
 react_parent_event_ancestry_proven:true,unmounted_lifetime_proven:true,uncommitted_description_withheld:true,
 interrupted_render_withheld:true,immutable_api_alias_proven:true},null,2));
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
}finally{fs.rmSync(temporary,{recursive:true,force:true});}
