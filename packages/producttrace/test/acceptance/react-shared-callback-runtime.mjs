import assert from 'node:assert/strict';
import fs from 'node:fs';import http from 'node:http';import os from 'node:os';import path from 'node:path';
import {createRequire} from 'node:module';import ts from 'typescript';
import {analyzeReact,createReactRuntimeIntegration} from '../../analysis/index.mjs';
const repository=path.resolve(process.argv[2]||'/tmp/producttrace-librechat-autonomous');
const require=createRequire(path.join(repository,'package.json')),{chromium}=require('playwright');
const build=process.env.PRODUCTTRACE_REACT_BUILD==='production'?'production':'development';
const namespaceImport=process.env.PRODUCTTRACE_REACT_SHARED_NAMESPACE==='1';
const factory=process.env.PRODUCTTRACE_REACT_SHARED_FACTORY==='1',imported=namespaceImport||process.env.PRODUCTTRACE_REACT_SHARED_IMPORT==='1';
const hydrate=process.env.PRODUCTTRACE_REACT_HYDRATE==='1',strict=process.env.PRODUCTTRACE_REACT_STRICT==='1';
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'react-shared-callback-'));
// Same function objects cross hook and instance boundaries. The local function
// also tests that an old closure and a new closure can coexist after an update.
let source=`import * as React from 'react';import * as DOM from 'react-dom';
${factory?"const shared=(event)=>window.events.push('module:'+event.currentTarget.id);\nconst indirect=function(event){window.receivers.push(this===undefined && arguments[0]===event);shared(event);};":"function shared(event){window.events.push('module:'+event.currentTarget.id); }\nfunction indirect(event){shared(event);}"}
function App({id,tick}){
  const local=${factory?"(event)=>{window.receivers.push(this===undefined && arguments[0].id===id);window.events.push('local:'+id+':'+tick);}":"function retained(event){window.events.push('local:'+id+':'+tick);}"};
  const a=React.useCallback(shared,[]),b=React.useCallback(shared,[tick]);
  const c=React.useCallback(local,[]),d=React.useCallback(local,[tick]);
  const e=React.useCallback(indirect,[]);
  window.selected[id]=[a,b,c,d,e];
  return <section><button id={id+'-a'} onClick={a}>A</button><button id={id+'-b'} onClick={b}>B</button>
  <button id={id+'-c'} onClick={c}>C</button><button id={id+'-d'} onClick={d}>D</button><button id={id+'-e'} onClick={e}>E</button></section>;
}
window.manual=()=>{shared({currentTarget:{id:'manual'}});window.selected.left[2]({});};`;
let callbackSource='';
if(imported){const start=source.indexOf('\n'),end=source.indexOf('\nfunction App');
 callbackSource=source.slice(start,end)+ '\nexport {shared,indirect};';
 source=source.slice(0,start)+"\nimport {shared,indirect} from './callbacks-index.js';"+source.slice(end);}
if(namespaceImport)source=source.replace("import {shared,indirect} from './callbacks-index.js';",
  "import {shared,indirect} from './callbacks-index.js';import * as callbacks from './callbacks-index.js';")
  .replace('useCallback(shared,[])','useCallback(callbacks.shared,[])')
  .replace('useCallback(shared,[tick])',"useCallback(callbacks['shared'],[tick])")
  .replace('useCallback(indirect,[])','useCallback(callbacks.indirect,[])');
try {
 fs.mkdirSync(path.join(temporary,'src'));fs.mkdirSync(path.join(temporary,'node_modules'));
 fs.writeFileSync(path.join(temporary,'src/App.tsx'),source);
 if(imported){fs.writeFileSync(path.join(temporary,'src/callbacks.js'),callbackSource);
 fs.writeFileSync(path.join(temporary,'src/callbacks-index.js'),"export {shared,indirect} from './callbacks.js';");}
 const pkg={name:'shared-callback-test',private:true,dependencies:{react:'18.3.1','react-dom':'18.3.1'}};
 fs.writeFileSync(path.join(temporary,'package.json'),JSON.stringify(pkg));
 const lock=JSON.parse(fs.readFileSync(path.join(repository,'package-lock.json')));
 fs.writeFileSync(path.join(temporary,'package-lock.json'),JSON.stringify({name:pkg.name,lockfileVersion:3,packages:{'':pkg,
 'node_modules/react':lock.packages['node_modules/react'],'node_modules/react-dom':lock.packages['node_modules/react-dom']}}));
 for(const name of ['react','react-dom'])fs.symlinkSync(path.join(repository,'node_modules',name),path.join(temporary,'node_modules',name));
 const map=analyzeReact({repository:temporary}),joins=new Map();
 const integration=createReactRuntimeIntegration(map,{onJoin:(result,record)=>joins.set(record.observation_id,result)});
 const hooks=map.react_semantics.filter(row=>row.export==='useCallback');assert.equal(hooks.length,5);
 assert.ok(hooks.every(row=>row.package_verification_sha256));
 assert.equal(integration.bindings.react_lifecycle.entries.filter(row=>row.kind==='shared_retained_result').length,5);
 const transformed=integration.instrumentSource('src/App.tsx',source);assert.deepEqual(transformed.diagnostics,[]);
 const compiled=ts.transpileModule(transformed.code.replace("import * as React from 'react';",'const React=window.React;')
 .replace("import * as DOM from 'react-dom';",'const DOM=window.ReactDOM;'),{reportDiagnostics:true,compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.React}});
 assert.deepEqual(compiled.diagnostics.map(row=>ts.flattenDiagnosticMessageText(row.messageText,' ')),[]);
 const tree="React.createElement(React.Fragment,null,React.createElement(App,{id:'left',tick}),React.createElement(App,{id:'right',tick}))";
 const mountedTree=strict?`React.createElement(React.StrictMode,null,${tree})`:tree;
 const app=compiled.outputText+`;window.mount=(tick=0)=>ReactDOM.flushSync(()=>window.root.render(${mountedTree}));`,assets={'/runtime.js':fs.readFileSync(new URL('../../dist/producttrace-runtime.js',import.meta.url)),
 '/react.js':fs.readFileSync(path.join(temporary,`node_modules/react/umd/react.${build==='production'?'production.min':'development'}.js`)),
 '/dom.js':fs.readFileSync(path.join(temporary,`node_modules/react-dom/umd/react-dom.${build==='production'?'production.min':'development'}.js`))};
 let callbackCode='';
 if(imported){const transformedCallback=integration.instrumentSource('src/callbacks.js',callbackSource);assert.deepEqual(transformedCallback.diagnostics,[]);
 callbackCode=transformedCallback.code;assets['/callbacks.js']=callbackCode;assets['/callbacks-index.js']="export {shared,indirect} from './callbacks.js';";
 assert.equal(integration.instrumentSource('src/callbacks.js',callbackSource+'\n// changed').applied.length,0);}
 let markup='';
 if(hydrate){const win={React:require('react'),ReactDOM:require('react-dom'),events:[],selected:{}};
 const probe={sharedRetainedDefine:(_key,factory)=>factory(()=>{}),component(){},apiResult:(_key,value)=>value,tagSource:(_id,fn)=>fn,sharedRetainedBody(){},sharedRetainedResult:(_key,fn)=>fn,eventCallback:(_key,fn)=>fn,callback:(_key,fn)=>fn,boundaryResult:(_key,value)=>value};
 const serverApp=imported?callbackCode.replace(/export\s*\{shared,\s*indirect\};?/u,'')+'\n'+app.replace(/import\s*\{[^}]+\}\s*from\s*['"]\.\/callbacks-index\.js['"];?/gu,'')
  .replace(/import\s*\*\s*as\s*callbacks\s*from\s*['"]\.\/callbacks-index\.js['"];?/u,'const callbacks={shared,indirect};'):app;
 const App=new Function('window','globalThis',serverApp+';return App;')(win,{__productTraceReactLifecycle:probe});
 markup=require('react-dom/server').renderToString(win.React.createElement(win.React.Fragment,null,win.React.createElement(App,{id:'left',tick:0}),win.React.createElement(App,{id:'right',tick:0})));}
 const initial=mountedTree.replaceAll('tick}', 'tick:0}');
 const boot=hydrate?`${app}window.root=ReactDOM.hydrateRoot(document.getElementById('app'),${initial},{onRecoverableError:e=>recoveries.push(e.message)});`:
 `window.root=ReactDOM.createRoot(document.getElementById('app'));${app}mount();`;
 const html=`<!doctype html><div id="app">${markup}</div><script src="/runtime.js"></script><script>
 window.records=[];window.events=[];window.receivers=[];window.selected={};window.recoveries=[];window.initial=document.querySelector('button');
 window.recorder=ProductTrace.start(${JSON.stringify(integration.bindings)},{outputMode:'evidence',onRecord:record=>records.push(record)});
 </script><script src="/react.js"></script><script src="/dom.js"></script><script${imported?' type="module"':''}>"use strict";${boot}</script>`;
 const server=http.createServer((req,res)=>{if(assets[req.url]){res.setHeader('content-type','text/javascript');res.end(assets[req.url]);}else{res.setHeader('content-type','text/html');res.end(html);}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
 try {
 browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>document.querySelectorAll('button').length===10,{},{timeout:5000});
 if(hydrate){assert.equal(await page.evaluate(()=>initial===document.querySelector('button')),true);assert.deepEqual(await page.evaluate(()=>recoveries),[]);}
 assert.equal(await page.evaluate(()=>selected.left[0]===selected.right[1] && selected.left[2]===selected.left[3]),true);
 assert.deepEqual(await page.evaluate(()=>selected.left.map(fn=>[fn.name,fn.length])),[['shared',1],['shared',1],[factory?'local':'retained',1],[factory?'local':'retained',1],['indirect',1]]);
 await page.evaluate(()=>window.oldLocal=selected.left[2]);
 for(const tick of [0,1]){if(tick)await page.evaluate(()=>mount(1));for(const id of ['left','right'])for(const suffix of ['a','b','c','d','e'])await page.click('#'+id+'-'+suffix,{timeout:5000});}
 assert.equal(await page.evaluate(()=>selected.left[2]===oldLocal && selected.left[3]!==oldLocal),true);
 await page.evaluate(()=>manual());
 const records=await page.evaluate(()=>records);for(const record of records)integration.onRecord(record);
 const bodies=records.filter(row=>row.kind==='react_shared_callback'),resolved=bodies.filter(row=>joins.get(row.observation_id).status==='resolved');
 assert.equal(resolved.length,20,JSON.stringify(bodies.map(row=>({source:row.callback_source_id,reason:row.reason,join:joins.get(row.observation_id)}))));
 assert.equal(bodies.length,26,'20 direct bodies, four nested calls, two outside-event calls');
 for(const row of bodies.filter(row=>!resolved.includes(row)))assert.equal(joins.get(row.observation_id).reason,'shared_callback_owner_unproven');
 // Replay actual observations with one independent mutation at a time. The
 // proposing rule and browser probe cannot choose which substitutions pass.
 const target=resolved[0],prior=records.slice(0,records.indexOf(target));
 const sibling=records.find(row=>row.operation==='shared_callback_selected' && row.instance_id!==proofOwner(target).instance_id);
 function proofOwner(row){return records.find(other=>other.observation_id===row.selection_observation_id);}
 const mutations=[{callback_identity_id:target.session+':wrong'}, {selection_observation_id:sibling.observation_id},
 {selection_observation_id:target.session+':missing'}, {callback_source_id:'foreign'}, {manifest_key:'missing'},
 {session:'foreign'}, {map_fingerprint:'foreign'}, {runtime_observed:false}, {reason:'shared_callback_owner_ambiguous'},
 {action:{...target.action,callback_observation_id:target.session+':missing'}}, {arguments:[{value_id:'foreign',value:{encoding:'redacted',value:null}}]}];
 for(const mutation of mutations){const check=createReactRuntimeIntegration(map);for(const row of prior)check.onRecord(row);
 assert.equal(check.joinSharedCallback({...target,...mutation}).status,'unresolved',JSON.stringify(mutation));
 assert.equal(check.joinSharedCallback(target).status,'resolved','rejections cannot poison valid evidence');
 assert.equal(check.joinSharedCallback(target).reason,'duplicate_shared_callback_body');}
 for(const omitted of ['react_callback','action','render_committed','shared_callback_selected']){
 const check=createReactRuntimeIntegration(map);for(const row of prior)if(row.kind!==omitted && row.operation!==omitted)check.onRecord(row);
 assert.equal(check.joinSharedCallback(target).status,'unresolved',omitted);}
 const actions=records.filter(row=>row.kind==='action');assert.equal(actions.length,20);
 for(const action of actions)assert.equal(integration.join(action).status,'resolved');
 const expected=[];for(const tick of [0,1])for(const id of ['left','right'])expected.push(`module:${id}-a`,`module:${id}-b`,`local:${id}:0`,`local:${id}:${tick}`,`module:${id}-e`);
 assert.deepEqual(await page.evaluate(()=>events.slice(0,20)),expected);
 const proofs=resolved.map(row=>joins.get(row.observation_id));
 assert.equal(new Set(proofs.map(row=>row.source.source_call_id)).size,5);
 assert.equal(new Set(proofs.map(row=>row.runtime.selection.mount_id)).size,2);
 for(const proof of proofs){assert.equal(proof.runtime.arguments_observed,!factory);assert.equal(proof.runtime.body_execution_proven,true);assert.equal(proof.runtime.callback_completion_proven,false);assert.equal(proof.runtime.creation_render_proven,false);}
 const beforeUnmount=records.length;await page.evaluate(()=>ReactDOM.flushSync(()=>root.unmount()));await page.evaluate(()=>manual());
 const after=await page.evaluate(start=>records.slice(start),beforeUnmount);for(const row of after)integration.onRecord(row);
 assert.equal(after.filter(row=>row.kind==='react_shared_callback').length,2);
 for(const row of after.filter(row=>row.kind==='react_shared_callback'))assert.equal(joins.get(row.observation_id).status,'unresolved');
 if(factory)assert.equal(await page.evaluate(()=>receivers.length>0 && receivers.every(Boolean)),true,'lexical arrow and ordinary function arguments/receivers stay intact');
 const stopped=await page.evaluate(()=>{recorder.stop();return records.length;});await page.evaluate(()=>manual());assert.equal(await page.evaluate(()=>records.length),stopped);
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({api:'react/useCallback/18.3.1',build,hydration:hydrate,strict_mode:strict,shared_expression_factory:factory,imported_through_reexport:imported,namespace_import:namespaceImport,lexical_values_and_function_shape_preserved:true,installed_source_attested:true,
 independent_lineage_mutants_rejected:mutations.length,missing_prerequisites_rejected:4,actual_clicks:20,matched_original_body_entries:resolved.length,source_hooks:5,mounted_owners:2,
 same_function_identity_preserved:true,retained_old_and_new_closures:true,nested_callee_contamination_rejected:true,
 outside_event_and_after_unmount_abstained:true,stop_preserves_behavior:true,hydration_dom_reused:hydrate,
 claim:'observed_selected_callback_body',callback_completion_proven:false,creation_render_proven:false},null,2));
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
}finally{fs.rmSync(temporary,{recursive:true,force:true});}
