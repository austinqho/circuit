import assert from 'node:assert/strict';import fs from 'node:fs';import http from 'node:http';import os from 'node:os';import path from 'node:path';import {createRequire} from 'node:module';import ts from 'typescript';
import {analyzeReact,createReactRuntimeIntegration} from '../../analysis/index.mjs';
const repository=path.resolve(process.argv[2]||'/tmp/producttrace-librechat-autonomous'),require=createRequire(path.join(repository,'package.json')),{chromium}=require('playwright');
const build=process.env.PRODUCTTRACE_REACT_BUILD==='production'?'production':'development';
const surface=process.env.PRODUCTTRACE_ROOT_SURFACE==='react-dom'?'react-dom':'react-dom/client';
const hydrate=process.env.PRODUCTTRACE_ROOT_HYDRATE==='1';
const mismatch=process.env.PRODUCTTRACE_ROOT_MISMATCH==='1';
const aliases=process.env.PRODUCTTRACE_ROOT_ALIASES==='1';
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'react-root-runtime-'));
const source=`import * as React from 'react';import * as DOM from '${surface}';
const never={then(){}};
function App({label}){if(label==='blocked')throw never;const click=React.useCallback(()=>window.events.push(label),[label]);React.useEffect(()=>()=>window.cleanups++,[]);
 return <button type="button" id="root-button" onClick={click}>{label}</button>;}
function recover(error,info){window.recoveries.push([error,info]);}
window.serverElement=()=> <App label="initial"/>;
${aliases?`const makeRoot=DOM.${hydrate?'hydrateRoot':'createRoot'};`:''}
const root = ${aliases?'makeRoot':'DOM.'+(hydrate?'hydrateRoot':'createRoot')}(${hydrate?'document.getElementById("app"),<App label="initial"/>,{identifierPrefix:"root-",onRecoverableError:recover}':'document.getElementById("app"),{identifierPrefix:"root-",onRecoverableError:recover}'});
const activeRoot=root;
window.rootHandle=root;window.originalMethods=[root.render,root.unmount];
window.mount=label=>window.ReactDOM.flushSync(()=>${aliases?'activeRoot["render"]':'root.render'}(<App label={label}/>));
window.block=()=>React.startTransition(()=>${aliases?'activeRoot["render"]':'root.render'}(<App label="blocked"/>));
window.dispose=()=>${aliases?'activeRoot["unmount"]':'root.unmount'}();
window.late=()=>${aliases?'activeRoot["render"]':'root.render'}(<App label="late"/>);
window.restart=()=>{const fresh=DOM.createRoot(document.getElementById('app'));window.ReactDOM.flushSync(()=>fresh.render(<App label="stopped"/>));};
${hydrate?'':'window.mount("initial");'}`;
try {
 fs.mkdirSync(path.join(temporary,'src'));fs.mkdirSync(path.join(temporary,'node_modules'));fs.writeFileSync(path.join(temporary,'src/App.tsx'),source);
 const pkg={name:'root-acceptance',private:true,dependencies:{react:'18.3.1','react-dom':'18.3.1'}};fs.writeFileSync(path.join(temporary,'package.json'),JSON.stringify(pkg));
 const lock=JSON.parse(fs.readFileSync(path.join(repository,'package-lock.json')));fs.writeFileSync(path.join(temporary,'package-lock.json'),JSON.stringify({name:pkg.name,lockfileVersion:3,packages:{'':pkg,'node_modules/react':lock.packages['node_modules/react'],'node_modules/react-dom':lock.packages['node_modules/react-dom']}}));
 for(const name of ['react','react-dom'])fs.symlinkSync(path.join(repository,'node_modules',name),path.join(temporary,'node_modules',name));
 const map=analyzeReact({repository:temporary}),joins=new Map(),integration=createReactRuntimeIntegration(map,{onJoin:(result,record)=>joins.set(record.observation_id,result)});
 const rootSource=map.react_semantics.find(row=>row.export===(hydrate?'hydrateRoot':'createRoot'));assert.ok(rootSource.package_verification_sha256);
 assert.equal(map.controls.length,1);assert.equal(integration.candidates.length,1);
 const entry=integration.bindings.react_lifecycle.entries.find(row=>row.root_rule);assert.ok(entry);
 const transformed=integration.instrumentSource('src/App.tsx',source);assert.deepEqual(transformed.diagnostics,[]);
 const compiled=ts.transpileModule(transformed.code.replace("import * as React from 'react';",'const React=window.React;').replace(`import * as DOM from '${surface}';`,surface==='react-dom'?'const DOM=window.ReactDOM;':'const DOM=window.ReactDOMClient;'),{reportDiagnostics:true,compilerOptions:{jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.None}});
 assert.deepEqual(compiled.diagnostics.map(row=>ts.flattenDiagnosticMessageText(row.messageText,' ')),[]);
 const ReactServer=require('react'),DOMServer=require('react-dom/server');
 const serverWindow={React:ReactServer,ReactDOM:{},ReactDOMClient:{}};
 const prefix=compiled.outputText.slice(0,compiled.outputText.indexOf('const root ='));
 assert.ok(prefix.includes('serverElement'));
 // Build matching SSR markup only; these pass-throughs do not supply browser
 // evidence. The browser below uses the shipped recorder and actual callbacks.
 const serverProbe={component(){},callback:(_key,value)=>value,apiResult:(_key,value)=>value,apiValue:(_key,value)=>value,
   retainedResult:(_key,value)=>value,eventCallback:(_key,value)=>value,defineCallback:(_key,factory)=>factory(()=>{})};
 new Function('window','globalThis',prefix)(serverWindow,{__productTraceReactLifecycle:serverProbe});
 const serverHtml=DOMServer.renderToString(serverWindow.serverElement());
 const clientSource=fs.readFileSync(path.join(repository,'node_modules/react-dom/client.js'),'utf8');
 const assets={'/runtime.js':fs.readFileSync(new URL('../../dist/producttrace-runtime.js',import.meta.url)),
 '/react.js':fs.readFileSync(path.join(temporary,`node_modules/react/umd/react.${build==='production'?'production.min':'development'}.js`)),
 '/dom.js':fs.readFileSync(path.join(temporary,`node_modules/react-dom/umd/react-dom.${build==='production'?'production.min':'development'}.js`))};
 const hydrationHtml=mismatch?serverHtml.replace('initial','server'):serverHtml;
 const html=`<!doctype html><div id="app">${hydrate?hydrationHtml:""}</div><script src="/runtime.js"></script><script>
 window.records=[];window.events=[];window.cleanups=0;window.recoveries=[];window.serverNode=document.getElementById("app").firstChild;window.recorder=ProductTrace.start(${JSON.stringify(integration.bindings)},{outputMode:'evidence',onRecord:row=>records.push(row)});
 </script><script src="/react.js"></script><script src="/dom.js"></script><script>"use strict";
 {const exports={};(function(exports,require,process){${clientSource}})(exports,()=>ReactDOM,{env:{NODE_ENV:${JSON.stringify(build)}}});window.ReactDOMClient=exports;}
 ${compiled.outputText}</script>`;
 const server=http.createServer((req,res)=>{if(assets[req.url])res.end(assets[req.url]);else{res.setHeader('content-type','text/html');res.end(html);}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
 try {
 browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForSelector('#root-button');
 if(mismatch)await page.waitForFunction(()=>recoveries.length>0);
 await page.click('#root-button');await page.evaluate(()=>mount('next'));await page.click('#root-button');
 await page.evaluate(()=>block());await page.waitForTimeout(20);await page.evaluate(()=>mount('final'));await page.click('#root-button');
 assert.deepEqual(await page.evaluate(()=>events),['initial','next','final']);
 if(hydrate)assert.equal(await page.evaluate(()=>serverNode===document.getElementById('root-button')),!mismatch);
 assert.equal(await page.evaluate(()=>originalMethods[0]===rootHandle.render&&originalMethods[1]===rootHandle.unmount),true);
 await page.evaluate(()=>dispose());assert.equal(await page.locator('#root-button').count(),0);assert.equal(await page.evaluate(()=>cleanups),1);
 await page.evaluate(()=>dispose());assert.equal(await page.evaluate(()=>{try{late();return false;}catch(e){return e instanceof Error;}}),true);
 const records=await page.evaluate(()=>records);for(const row of records)integration.onRecord(row);
 const rootRecords=records.filter(row=>row.kind==='react_root');assert.equal(rootRecords.length,hydrate?7:8);
 for(const row of rootRecords){const joined=joins.get(row.observation_id);assert.equal(joined.status,'resolved',JSON.stringify({joined,row,node:map.nodes.find(node=>node.id===row.source_call_id)}));assert.equal(joined.runtime.commit_observed,row.method==='unmount'&&row.before?.state==='active');}
 assert.equal(joins.get(rootRecords[0].observation_id).runtime.recovery_callback_registered,true);
 const rootCommitRecords=records.filter(row=>row.kind==='react_root_commit');assert.equal(rootCommitRecords.length,3);
 for(const row of rootCommitRecords){const joined=joins.get(row.observation_id);assert.equal(joined.status,'resolved',JSON.stringify(joined));
  const origin=rootRecords.find(candidate=>candidate.observation_id===row.origin_observation_id);assert.ok(origin);
  assert.equal(origin.inputs[origin.method==='create'?1:0].identity,row.input_identity);assert.equal(joined.runtime.renderer_root_id,row.renderer_root_id);}
 const rootCommitMutants=[row=>{row.origin_observation_id=row.session+':foreign';},row=>{row.input_identity=row.session+':foreign';},
  row=>{row.renderer_root_id='react-root:foreign';},row=>{row.commit_id='foreign';},row=>{row.empty_tree=true;},row=>{row.source_call_id='foreign';}];
 for(const mutate of rootCommitMutants){const target=rootCommitRecords.at(-1),check=createReactRuntimeIntegration(map);
  for(const row of records.slice(0,records.indexOf(target)))check.onRecord(row);const bad=structuredClone(target);mutate(bad);
  assert.equal(check.joinRootCommit(bad).status,'unresolved');assert.equal(check.joinRootCommit(target).status,'resolved');}
 const blockedCall=map.nodes.find(row=>row.kind==='call'&&row.text.includes('<App label="blocked"')&&!row.text.includes('startTransition'));assert.ok(blockedCall);
 const blockedOperation=rootRecords.find(row=>row.source_call_id===blockedCall.id);assert.ok(blockedOperation,JSON.stringify({blockedCall,rootSources:rootRecords.map(row=>row.source_call_id),frontiers:integration.bindings.react_lifecycle.frontiers}));
 assert.equal(rootCommitRecords.some(row=>row.origin_observation_id===blockedOperation.observation_id),false);
 const recoveryRecords=records.filter(row=>row.kind==='react_root_recovery');assert.equal(recoveryRecords.length>0,mismatch);
 for(const row of recoveryRecords)assert.equal(joins.get(row.observation_id).status,'resolved',JSON.stringify(joins.get(row.observation_id)));
 const recoveryMutants=[row=>{row.origin_observation_id=row.session+':foreign';},row=>{row.callback_source_id='foreign';},
  row=>{row.callback_identity.identity=row.session+':foreign';},row=>{row.renderer_root_id='react-root:foreign';},row=>{row.source_call_id='foreign';}];
 if(recoveryRecords.length)for(const mutate of recoveryMutants){const target=recoveryRecords[0],check=createReactRuntimeIntegration(map);
  for(const row of records.slice(0,records.indexOf(target)))check.onRecord(row);const bad=structuredClone(target);mutate(bad);
  assert.equal(check.joinRootRecovery(bad).status,'unresolved');assert.equal(check.joinRootRecovery(target).status,'resolved');}
 const disposal=rootRecords.find(row=>row.method==='unmount'&&row.before?.state==='active');assert(disposal.commits.length);assert.equal(disposal.cleanups.length,1);
 const disposalProof=joins.get(disposal.observation_id);assert.equal(disposalProof.runtime.cleanup_observed,true);assert.equal(disposalProof.runtime.cleanup_completion_proven,false);
 const disposalMutants=[row=>{row.commits[0].renderer_root_id='react-root:other';},row=>{row.commits[0].empty_tree=false;},row=>{row.cleanups[0].observation_id=row.session+':other';},row=>{row.cleanups[0].instance_id='other';}];
 for(const mutate of disposalMutants){const check=createReactRuntimeIntegration(map);for(const row of records.slice(0,records.indexOf(disposal)))check.onRecord(row);const bad=structuredClone(disposal);mutate(bad);assert.equal(check.joinRoot(bad).status,'unresolved');assert.equal(check.joinRoot(disposal).status,'resolved');}
 const creation=rootRecords[0],rendererId=creation.after.renderer_root_id;assert.ok(rendererId);
 const actions=records.filter(row=>row.kind==='action');assert.equal(actions.length,3);for(const row of actions){assert.equal(integration.join(row).status,'resolved');assert.equal(row.react_identity.root_id,rendererId);}
 const callbacks=records.filter(row=>row.operation==='callback_invoked');assert.equal(callbacks.length,4);
 assert.equal(callbacks.filter(row=>row.semantic_id==='react/useCallback/18.3.1').length,3);
 assert.equal(callbacks.filter(row=>row.semantic_id==='react/useEffect/18.3.1').length,1);
 for(const row of callbacks){assert.equal(row.root_id,rendererId);assert.equal(joins.get(row.observation_id).status,'resolved');}
 const render=rootRecords.find(row=>row.method==='render'&&row.operation==='returned');
 const prior=rootRecords.slice(0,rootRecords.indexOf(render));
 const mutations=[row=>{row.receiver.identity=row.session+':foreign';},row=>{row.method_value.identity=row.session+':foreign';},
  row=>{row.before.state='unmounted';},row=>{row.after.renderer_root_id='react-root:foreign';},row=>{row.session='wrong';},row=>{row.source_call_id='wrong';}];
 for(const mutation of mutations){const fresh=createReactRuntimeIntegration(map);for(const row of prior)assert.equal(fresh.joinRoot(row).status,'resolved');
  const bad=structuredClone(render);mutation(bad);assert.equal(fresh.joinRoot(bad).status,'unresolved');assert.equal(fresh.joinRoot(render).status,'resolved');}
 assert.equal(createReactRuntimeIntegration(map).joinRoot(render).reason,'root_handle_origin_unobserved');
 const stopped=await page.evaluate(()=>{recorder.stop();return records.length;});await page.evaluate(()=>restart());await page.click('#root-button');
 assert.equal(await page.evaluate(()=>records.length),stopped);assert.deepEqual(await page.evaluate(()=>events),['initial','next','final','stopped']);assert.deepEqual(errors,[]);
 console.log(JSON.stringify({api:`${surface}/${hydrate?'hydrateRoot':'createRoot'}/18.3.1`,build,hydrate,aliases,installed_source_attested:true,
 root_observations:rootRecords.length,actual_clicks:4,root_handle_to_renderer_identity:true,original_methods_preserved:true,recovery_callback_registered:true,
 lifetime_and_late_render_verified:true,hydration_reused_dom:hydrate&&!mismatch,recovery_scenario:mismatch,recovery_callbacks:recoveryRecords.length,
 recovery_mutants_rejected:recoveryRecords.length?recoveryMutants.length:0,independent_mutants_rejected:mutations.length,stop_preserves_behavior:true,
 render_to_commit_attribution_proven:true,abandoned_render_not_committed:true,root_commit_observations:rootCommitRecords.length,root_commit_mutants_rejected:rootCommitMutants.length,
 unmount_to_empty_root_commit:true,cleanup_invocation_attribution:true,cleanup_completion_proven:false,disposal_mutants_rejected:disposalMutants.length},null,2));
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
}finally{fs.rmSync(temporary,{recursive:true,force:true});}
