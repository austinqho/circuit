import assert from 'node:assert/strict';import fs from 'node:fs';import http from 'node:http';
import os from 'node:os';import path from 'node:path';import {createRequire} from 'node:module';import ts from 'typescript';
import {analyzeReact,createReactRuntimeIntegration} from '../../analysis/index.mjs';
const repository=path.resolve(process.argv[2]||'/tmp/producttrace-librechat-autonomous');
const require=createRequire(path.join(repository,'package.json'));const {chromium}=require('playwright');
const build=process.env.PRODUCTTRACE_REACT_BUILD==='production'?'production':'development';
const hydrate=process.env.PRODUCTTRACE_REACT_HYDRATE==='1';
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'react-transition-runtime-'));
const source=`import * as React from 'react';import * as DOM from 'react-dom';
function View({name}){const [pending,start]=React.useTransition();const [value,setValue]=React.useState(0);
  const captured=name+':'+value;const named=()=>window.events.push(captured);const other=()=>window.events.push('other:'+captured);
  window.namedStarts[name]=()=>start(window.choose?named:other);window.unknownStarts[name]=()=>start(window.external);
  if(pending)window.branches.push(name+':pending');else window.branches.push(name+':ready');window.starts[name]=start;window.failures[name]=()=>start(()=>{throw window.sentinel;});window.invokes[name]=()=>start(()=>window.events.push(name+':saved'));return <section data-name={name}><output>{name+':'+value+':'+pending}</output><span>{pending?'Busy':'Ready'}</span>
  <button id={name} onClick={()=>start(()=>{window.events.push(name);setValue(x=>x+1);return 'ignored';})}>Start {name}</button></section>;}
function App({tick,epoch}){return <main><View key={'left'+epoch} name="left"/><View key="right" name="right"/>
<button id="update" onClick={()=>window.mount(1,0)}>update</button><button id="remount" onClick={()=>window.mount(1,1)}>remount</button></main>;}
window.mount=(tick=0,epoch=0)=>DOM.flushSync(()=>window.root.render(<App tick={tick} epoch={epoch}/>));`;
try {
  fs.mkdirSync(path.join(temporary,'src'));fs.mkdirSync(path.join(temporary,'node_modules'));
  fs.writeFileSync(path.join(temporary,'src/App.tsx'),source);
  const pkg={name:'ref-acceptance',private:true,dependencies:{react:'18.3.1','react-dom':'18.3.1'}};
  fs.writeFileSync(path.join(temporary,'package.json'),JSON.stringify(pkg));
  const lock=JSON.parse(fs.readFileSync(path.join(repository,'package-lock.json')));
  fs.writeFileSync(path.join(temporary,'package-lock.json'),JSON.stringify({name:pkg.name,lockfileVersion:3,packages:{'':pkg,
    'node_modules/react':lock.packages['node_modules/react'],'node_modules/react-dom':lock.packages['node_modules/react-dom']}}));
  for(const name of ['react','react-dom'])fs.symlinkSync(path.join(repository,'node_modules',name),path.join(temporary,'node_modules',name));
  const map=analyzeReact({repository:temporary}),joinedById=new Map(),integration=createReactRuntimeIntegration(map,{onJoin:(joined,record)=>joinedById.set(record.observation_id,joined)});
  const sources=map.react_semantics.filter(row=>row.export==='useTransition');assert.equal(sources.length,1);
  assert.ok(sources.every(row=>row.package_verification_sha256));
  const transform=integration.instrumentSource('src/App.tsx',source);assert.deepEqual(transform.diagnostics,[]);
  const application=ts.transpileModule(transform.code.replace("import * as React from 'react';",'const React=window.React;')
    .replace("import * as DOM from 'react-dom';",'const DOM=window.ReactDOM;'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.None,jsx:ts.JsxEmit.React}}).outputText;
  const assets={'/runtime.js':fs.readFileSync(new URL('../../dist/producttrace-runtime.js',import.meta.url)),
    '/react.js':fs.readFileSync(path.join(temporary,`node_modules/react/umd/react.${build}.min.js`).replace('.development.min.js','.development.js')),
    '/dom.js':fs.readFileSync(path.join(temporary,`node_modules/react-dom/umd/react-dom.${build}.min.js`).replace('.development.min.js','.development.js'))};
  let serverMarkup='';
  if(hydrate) {
    const serverWindow={React:require('react'),ReactDOM:require('react-dom'),starts:{},failures:{},invokes:{},branches:[],namedStarts:{},unknownStarts:{}};
    const serverProbe={component(){},apiResult:(_key,value)=>value,transitionResult:(_key,value)=>value,transitionPendingUse:(_key,value)=>value,tagSource:(_source,value)=>value,stateResult:(_key,value)=>value,callback:(_key,value)=>value};
    const ServerApp=new Function('window','globalThis',application+';return App;')(serverWindow,{__productTraceReactLifecycle:serverProbe});
    serverMarkup=require('react-dom/server').renderToString(serverWindow.React.createElement(ServerApp,{tick:0,epoch:0}),{identifierPrefix:'test-'});
  }
  const boot=hydrate?`${application}window.root=ReactDOM.hydrateRoot(document.getElementById('app'),React.createElement(App,{tick:0,epoch:0}),{identifierPrefix:'test-',onRecoverableError:error=>window.recoveries.push(error.message)});`
    :`window.root=ReactDOM.createRoot(document.getElementById('app'),{identifierPrefix:'test-'});${application}mount();`;
  const html=`<!doctype html><div id="app">${serverMarkup}</div><div id="other"></div><script src="/runtime.js"></script><script>
    window.records=[];window.recoveries=[];window.starts={};window.branches=[];window.namedStarts={};window.unknownStarts={};window.choose=true;window.external=()=>events.push('external');window.failures={};window.invokes={};window.sentinel={marker:true};window.events=[];window.initialInput=document.querySelector('output');
    window.recorder=ProductTrace.start(${JSON.stringify(integration.bindings)},{outputMode:'evidence',onRecord:record=>records.push(record)});
    </script><script src="/react.js"></script><script src="/dom.js"></script><script>${boot}</script>`;
  const server=http.createServer((request,response)=>{if(assets[request.url])response.end(assets[request.url]);else{response.setHeader('content-type','text/html');response.end(html);}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
  try {
    browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
    const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(()=>document.querySelectorAll('output').length===2);
    if(hydrate){assert.equal(await page.evaluate(()=>initialInput===document.querySelector('output')),true);assert.deepEqual(await page.evaluate(()=>recoveries),[]);}
    await page.evaluate(()=>{window.initialStarts={...starts};window.oldInvoke=invokes.left;});
    await page.click('#left');await page.waitForFunction(()=>document.querySelector('output').textContent==='left:1:false');
    await page.click('#right');await page.waitForFunction(()=>document.querySelectorAll('output')[1].textContent==='right:1:false');
    assert.deepEqual(await page.evaluate(()=>events),['left','right']);
    assert.equal(await page.evaluate(()=>starts.left===initialStarts.left && starts.right===initialStarts.right),true);
    await page.evaluate(()=>{window.savedNamed=namedStarts.left;namedStarts.left();window.choose=false;namedStarts.right();});
    assert.ok(await page.evaluate(()=>events.includes('left:1') && events.includes('other:right:1')));
    await page.click('#update');assert.equal(await page.evaluate(()=>starts.left===initialStarts.left),true);
    await page.click('#remount');assert.equal(await page.evaluate(()=>starts.left!==initialStarts.left && starts.right===initialStarts.right),true);
    await page.click('#left');await page.waitForFunction(()=>document.querySelector('output').textContent==='left:1:false');
    assert.equal(await page.evaluate(()=>{try{failures.right();return false;}catch(error){return error===sentinel;}}),true);
    await page.evaluate(()=>{oldInvoke();savedNamed();unknownStarts.right();});
    assert.equal(await page.evaluate(()=>events.at(-1)),'external');
    assert.ok(await page.evaluate(()=>events.includes('other:left:1')));
    const all=await page.evaluate(()=>records);for(const record of all)integration.onRecord(record);
    const pendingUses=all.filter(row=>row.operation==='transition_pending_used');
    const results=all.filter(row=>row.operation==='transition_result'),allScopes=all.filter(row=>row.scope?.transition_target),scopes=allScopes.filter(row=>row.scope.callbacks[0]?.source_id),unknownScopes=allScopes.filter(row=>!row.scope.callbacks[0]?.source_id);
    fs.writeFileSync('/tmp/pr8-transition-runtime-debug.json',JSON.stringify({all,joins:[...joinedById],manifest:integration.bindings.react_lifecycle},null,2));
    assert.ok(results.length>=6);assert.equal(scopes.length,8);assert.equal(unknownScopes.length,1);assert.equal(pendingUses.length,results.length*2);
    for(const row of [...results,...scopes,...pendingUses])assert.equal(joinedById.get(row.observation_id).status,'resolved',JSON.stringify({row,join:joinedById.get(row.observation_id)}));
    assert.equal(joinedById.get(unknownScopes[0].observation_id).status,'unresolved');
    const namedScopes=scopes.filter(row=>row.scope.callbacks[0].source_observation_id);assert.equal(namedScopes.length,3);
    assert.ok(namedScopes.some(row=>row.scope.callbacks[0].captured_values.some(value=>value.value==='left:1')));
    const namedTarget=namedScopes[0],namedCallback=namedTarget.scope.callbacks[0];
    const alternative=integration.bindings.react_lifecycle.entries.find(row=>row.key===namedTarget.manifest_key).scope_callback_candidates.find(row=>row.source_id!==namedCallback.source_id);
    assert.ok(alternative);
    const replayNamed=(change,omit)=>{let result;const fresh=createReactRuntimeIntegration(map,{onJoin:(join,row)=>{if(row.observation_id===namedTarget.observation_id)result=join;}});
      for(const row of all){if(omit && row.observation_id===namedCallback.source_observation_id)continue;fresh.onRecord(row.observation_id===namedTarget.observation_id?{...row,scope:{...row.scope,callbacks:[{...namedCallback,...change}]}}:row);}return result;};
    assert.equal(replayNamed({source_id:alternative.source_id}).reason,'scope_callback_origin_required');
    assert.equal(replayNamed({},true).reason,'scope_callback_origin_required');

    assert.ok(results.some(row=>joinedById.get(row.observation_id).runtime.transition_proof.retained_from));
    assert.ok(results.some(row=>row.transition_pending===true));
    for(const row of scopes){const proof=joinedById.get(row.observation_id).runtime.scope_proof;
      assert.equal(proof.transition_origin.update_commit_attribution_proven,false);assert.equal(proof.transition_origin.mount_liveness_proven,false);
      assert.ok(proof.observed_callback_edge.to);assert.equal(row.scope.callbacks.length,1);assert.deepEqual(row.scope.callbacks[0].arguments,[]);}
    assert.ok(await page.evaluate(()=>branches.includes('left:pending') && branches.includes('right:pending')));
    for(const row of pendingUses){const proof=joinedById.get(row.observation_id).runtime.transition_proof;
      assert.ok(proof.selected_source_id);assert.equal(proof.selected_branch_execution_proven,false);assert.equal(proof.host_commit_proven,false);}
    const pendingTarget=pendingUses.find(row=>row.transition_pending),pendingSibling=pendingUses.find(row=>row.instance_id!==pendingTarget.instance_id);
    const pendingReplay=(change,omit)=>{let result;const fresh=createReactRuntimeIntegration(map,{onJoin:(join,row)=>{if(row.observation_id===pendingTarget.observation_id)result=join;}});
      for(const row of all){if(omit && row.observation_id===pendingTarget.origin_observation_id)continue;fresh.onRecord(row.observation_id===pendingTarget.observation_id?{...row,...change}:row);}return result;};
    assert.equal(pendingReplay({},true).reason,'transition_pending_origin_mismatch');
    assert.equal(pendingReplay({transition_pending:false}).reason,'transition_pending_origin_mismatch');
    assert.equal(pendingReplay({origin_observation_id:pendingSibling.origin_observation_id}).reason,'transition_pending_origin_mismatch');
    assert.equal(pendingReplay({read_source_id:'foreign'}).reason,'transition_pending_origin_mismatch');
    const target=scopes[0],sibling=scopes[1];
    const replay=(change,omit)=>{let result;const fresh=createReactRuntimeIntegration(map,{onJoin:(join,row)=>{if(row.observation_id===target.observation_id)result=join;}});
      for(const row of all){if(omit && row.observation_id===target.scope.transition_target.observation_id)continue;fresh.onRecord(row.observation_id===target.observation_id?{...row,scope:{...row.scope,transition_target:{...row.scope.transition_target,...change}}}:row);}return result;};
    assert.equal(replay({},true).reason,'transition_start_origin_unobserved');
    assert.equal(replay({start_identity_id:sibling.scope.transition_target.start_identity_id}).reason,'transition_start_origin_unobserved');
    assert.equal(replay({session:'foreign'}).reason,'transition_start_origin_unobserved');
    assert.equal(replay({source_call_id:'foreign'}).reason,'transition_start_origin_unobserved');
    const before=await page.evaluate(()=>records.length);await page.evaluate(()=>recorder.stop());
    await page.click('#left');await page.waitForFunction(()=>document.querySelector('output').textContent==='left:2:false');
    assert.equal(await page.evaluate(()=>records.length),before);assert.deepEqual(errors,[]);
    console.log(JSON.stringify({api:'react/useTransition/18.3.1',build,hydration:hydrate,actual_clicks:6,
      results:results.length,scope_calls:scopes.length,installed_source_attested:true,
      retained_start_to_actual_callback:true,named_conditional_callback_paths:true,old_named_captures:true,unknown_callback_abstained:true,wrong_named_candidate_rejected:true,missing_named_origin_rejected:true,retention_and_remount:true,throw_identity_preserved:true,unmounted_callback_still_invoked:true,sibling_start_mismatch_rejected:true,
      missing_origin_rejected:true,foreign_session_and_source_rejected:true,stop_preserves_behavior:true,
      pending_observed:true,pending_branch_reads:pendingUses.length,pending_boolean_to_source_branch:true,pending_origin_mutants_rejected:true,update_commit_attribution:'unproven',hydration_dom_reused:hydrate},null,2));
  } finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
} finally {fs.rmSync(temporary,{recursive:true,force:true});}
