import assert from 'node:assert/strict';import fs from 'node:fs';import http from 'node:http';import os from 'node:os';import path from 'node:path';import {createRequire} from 'node:module';import ts from 'typescript';
import {analyzeReact,createReactRuntimeIntegration} from '../../analysis/index.mjs';
const repository=path.resolve(process.argv[2]||'/tmp/producttrace-librechat-autonomous'),require=createRequire(path.join(repository,'package.json')),{chromium}=require('playwright');
const build=process.env.PRODUCTTRACE_REACT_BUILD==='production'?'production':'development';
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'react-element-runtime-'));
const source=`import * as React from 'react';import * as DOM from 'react-dom';
function Child({label,tick}){const click=React.useCallback(()=>window.events.push([label,tick]),[tick]);
 return <button type="button" id="element-button" onClick={click}>{label}:{tick}</button>;}
function App({tick}){return React.createElement(Child,{label:'chat',tick,key:'child'});}
const NativeTag='button',nativeRef=React.createRef();window.readNativeRef=()=>nativeRef.current;
function NativeApp({tick}){return React.createElement(NativeTag,{type:'button',id:'native-element-button',ref:nativeRef,onClick:()=>window.events.push(['native',tick])},'native:'+tick);}
window.makeUnused=()=>React.createElement('i',{id:'unused'});
window.mount=(tick=0)=>DOM.flushSync(()=>{window.root.render(<App tick={tick}/>);window.nativeRoot.render(<NativeApp tick={tick}/>);});`;
try {
 fs.mkdirSync(path.join(temporary,'src'));fs.mkdirSync(path.join(temporary,'node_modules'));fs.writeFileSync(path.join(temporary,'src/App.tsx'),source);
 const pkg={name:'element-acceptance',private:true,dependencies:{react:'18.3.1','react-dom':'18.3.1'}};fs.writeFileSync(path.join(temporary,'package.json'),JSON.stringify(pkg));
 const lock=JSON.parse(fs.readFileSync(path.join(repository,'package-lock.json')));fs.writeFileSync(path.join(temporary,'package-lock.json'),JSON.stringify({name:pkg.name,lockfileVersion:3,packages:{'':pkg,'node_modules/react':lock.packages['node_modules/react'],'node_modules/react-dom':lock.packages['node_modules/react-dom']}}));
 for(const name of ['react','react-dom'])fs.symlinkSync(path.join(repository,'node_modules',name),path.join(temporary,'node_modules',name));
 const map=analyzeReact({repository:temporary}),joins=new Map(),integration=createReactRuntimeIntegration(map,{onJoin:(result,record)=>joins.set(record.observation_id,result)});
 const sourceText=id=>map.nodes.find(row=>row.id===id)?.text||'';
 const elements=map.react_semantics.filter(row=>row.export==='createElement');assert.ok(elements.every(row=>row.package_verification_sha256));
 const componentElement=elements.find(row=>sourceText(row.call_id).includes('React.createElement(Child'));
 const nativeElement=elements.find(row=>sourceText(row.call_id).includes('React.createElement(NativeTag'));
 const unusedElement=elements.find(row=>sourceText(row.call_id).includes("React.createElement('i'"));
 assert.ok(componentElement);assert.ok(nativeElement);assert.ok(unusedElement);assert.equal(map.controls.length,2);assert.equal(integration.candidates.length,2);
 assert.equal(integration.candidates.find(row=>row.native_source_node_id===nativeElement.call_id).stamp_mode,'create_element');
 const entry=integration.bindings.react_lifecycle.entries.find(row=>row.element_rule);assert.ok(entry);
 const transformed=integration.instrumentSource('src/App.tsx',source);assert.deepEqual(transformed.diagnostics,[]);
 const compiled=ts.transpileModule(transformed.code.replace("import * as React from 'react';",'const React=window.React;').replace("import * as DOM from 'react-dom';",'const DOM=window.ReactDOM;'),{reportDiagnostics:true,compilerOptions:{jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.None}});
 assert.deepEqual(compiled.diagnostics.map(row=>ts.flattenDiagnosticMessageText(row.messageText,' ')),[]);
 const assets={'/runtime.js':fs.readFileSync(new URL('../../dist/producttrace-runtime.js',import.meta.url)),
 '/react.js':fs.readFileSync(path.join(temporary,`node_modules/react/umd/react.${build==='production'?'production.min':'development'}.js`)),
 '/dom.js':fs.readFileSync(path.join(temporary,`node_modules/react-dom/umd/react-dom.${build==='production'?'production.min':'development'}.js`))};
 const html=`<!doctype html><div id="app"></div><div id="native"></div><div id="first"></div><div id="second"></div><script src="/runtime.js"></script><script>
 window.records=[];window.events=[];window.recorder=ProductTrace.start(${JSON.stringify(integration.bindings)},{outputMode:'evidence',onRecord:row=>records.push(row)});
 </script><script src="/react.js"></script><script src="/dom.js"></script><script>"use strict";
 window.root=ReactDOM.createRoot(document.getElementById('app'));window.nativeRoot=ReactDOM.createRoot(document.getElementById('native'));${compiled.outputText}mount();</script>`;
 const server=http.createServer((req,res)=>{if(assets[req.url])res.end(assets[req.url]);else{res.setHeader('content-type','text/html');res.end(html);}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
 try {
 browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForSelector('#element-button',{timeout:5000}).catch(error=>{throw new Error(JSON.stringify({errors,message:error.message}));});
 await page.click('#element-button');await page.click('#native-element-button');await page.evaluate(()=>makeUnused());await page.evaluate(()=>mount(1));
 assert.equal(await page.locator('#element-button').textContent(),'chat:1');assert.equal(await page.locator('#native-element-button').textContent(),'native:1');
 await page.click('#element-button');await page.click('#native-element-button');
 assert.deepEqual(await page.evaluate(()=>events),[['chat',0],['native',0],['chat',1],['native',1]]);
 const records=await page.evaluate(()=>records);for(const record of records)integration.onRecord(record);
 const descriptions=records.filter(row=>row.kind==='react_element'&&[componentElement.call_id,nativeElement.call_id].includes(row.source_call_id));assert.equal(descriptions.length,4);
 const committed=records.filter(row=>row.kind==='react_descriptor_commit'&&descriptions.some(description=>description.observation_id===row.description_observation_id));assert.equal(committed.length,4,JSON.stringify(committed));
 const componentCommits=committed.filter(row=>row.source_call_id===componentElement.call_id),nativeCommits=committed.filter(row=>row.source_call_id===nativeElement.call_id);
 assert.equal(componentCommits.length,2);assert.equal(nativeCommits.length,2);
 for(const row of componentCommits){const result=joins.get(row.observation_id);assert.equal(result.status,'resolved',JSON.stringify(result));assert.equal(result.runtime.claim,'observed_descriptor_props_in_committed_tree');assert.equal(result.runtime.descriptor_identity_proven,false);assert(descriptions.some(origin=>origin.observation_id===row.description_observation_id&&origin.fields.props.identity===row.props_identity));}
 for(const row of nativeCommits){const result=joins.get(row.observation_id);if(build==='development'){assert.equal(result.status,'resolved',JSON.stringify(result));assert.equal(result.runtime.owner_lineage_proven,true);assert.equal(result.runtime.owner_parent_distance,1);}else assert.deepEqual(result,{status:'unresolved',reason:'descriptor_committed_owner_required',runtime_observed:false});}
 const nativeDescriptions=descriptions.filter(row=>row.source_call_id===nativeElement.call_id);
 assert(nativeDescriptions.every(row=>row.fields._owner.kind===(build==='development'?'object':'null')));
 const refOrigin=records.find(row=>row.kind==='react_ref'&&row.operation==='returned'&&row.export==='createRef');assert(refOrigin);
 const refCommits=records.filter(row=>row.kind==='react_ref'&&row.operation==='host_attached'&&row.origin_observation_id===refOrigin.observation_id);assert.equal(refCommits.length,2);
 assert.equal(await page.evaluate(()=>readNativeRef()===document.getElementById('native-element-button')),true);
 for(const description of nativeDescriptions){const input=description.property_inputs.find(row=>row.target==='ref');assert(input);assert.equal(input.value.identity,refOrigin.value.identity);assert.equal(description.fields.ref.identity,refOrigin.value.identity);}
 assert.equal(joins.get(refOrigin.observation_id).status,'resolved');for(const commit of refCommits)assert.equal(joins.get(commit.observation_id).status,'resolved');
 const unused=records.find(row=>row.kind==='react_element'&&row.source_call_id===unusedElement.call_id);assert(unused);assert(!committed.some(row=>row.description_observation_id===unused.observation_id));
 const commitTarget=build==='development'?nativeCommits[1]:componentCommits[1];
 const commitMutants=[{props_identity:'foreign'},{description_observation_id:'foreign'},{owner_identity:'foreign'},{renderer:{}},
  ...(build==='development'?[{owner_parent_distance:null},{owner_parent_distance:65},{owner_relation:'foreign'}]:[])];
 for(const patch of commitMutants){const check=createReactRuntimeIntegration(map);for(const row of records)if(row.kind!=='react_descriptor_commit')check.onRecord(row);assert.equal(check.joinElement({...commitTarget,...patch}).status,'unresolved');assert.equal(check.joinElement(commitTarget).status,'resolved');}
 for(const row of descriptions){const joined=joins.get(row.observation_id);assert.equal(joined.status,'resolved',JSON.stringify(joined));
  assert.equal(joined.runtime.host_commit_proven,false);assert.equal(joined.runtime.property_input_relations_proven,true);}
 const actions=records.filter(row=>row.kind==='action');assert.equal(actions.length,4);
 for(const row of actions){const joined=integration.join(row);assert.equal(joined.status,'resolved');
  assert.ok(joined.source.conditions.some(condition=>[componentElement.call_id,nativeElement.call_id].includes(condition.node_id) && condition.runtime_observed===false));}
 const callbacks=records.filter(row=>row.operation==='callback_invoked');assert.equal(callbacks.length,2);for(const row of callbacks)assert.equal(joins.get(row.observation_id).status,'resolved');
 const valid=descriptions[0],mutations=[{semantic_id:'wrong'},{session:'other'},{map_fingerprint:'wrong'},{inputs:{}},{runtime_observed:false},
  {fields:{...valid.fields,type:valid.fields.props}},{property_inputs:[]},
  {property_inputs:valid.property_inputs.map((row,index)=>index?row:{...row,source_id:'wrong'})}];
 for(const mutation of mutations){const check=createReactRuntimeIntegration(map);assert.equal(check.joinElement({...valid,...mutation}).status,'unresolved');assert.equal(check.joinElement(valid).status,'resolved');}
 const stopped=await page.evaluate(()=>{recorder.stop();return records.length;});await page.evaluate(()=>mount(2));await page.click('#element-button');await page.click('#native-element-button');
 assert.equal(await page.evaluate(()=>records.length),stopped);assert.deepEqual(await page.evaluate(()=>events),[['chat',0],['native',0],['chat',1],['native',1],['chat',2],['native',2]]);assert.deepEqual(errors,[]);
 console.log(JSON.stringify({api:'react/createElement/18.3.1',build,installed_source_attested:true,description_observations:descriptions.length,
 actual_clicks:6,component_type_to_source_controls:true,native_type_alias_to_source_control:true,create_element_config_stamped:true,explicit_props_reach_callback:true,independent_mutants_rejected:mutations.length,
 stop_preserves_behavior:true,descriptor_props_to_committed_owner:true,owner_policy_verified:true,
 owner_lineage_to_committed_fiber:build==='development',production_owner_is_null:build==='production',
 ref_input_to_committed_host:true,
 unrendered_description_not_selected:true,commit_lineage_mutants_rejected:commitMutants.length,descriptor_to_exact_host_commit_proven:false,runtime_property_input_relations_proven:true},null,2));
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
}finally{fs.rmSync(temporary,{recursive:true,force:true});}
