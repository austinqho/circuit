import assert from 'node:assert/strict';
import fs from 'node:fs';import http from 'node:http';import os from 'node:os';import path from 'node:path';
import {createRequire} from 'node:module';import ts from 'typescript';
import {analyzeReact,createReactRuntimeIntegration} from '../../analysis/index.mjs';
const repository=path.resolve(process.argv[2]||'/tmp/producttrace-librechat-autonomous');
const require=createRequire(path.join(repository,'package.json'));const {chromium}=require('playwright');
const build=process.env.PRODUCTTRACE_REACT_BUILD==='production'?'production':'development';
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'react-scope-runtime-'));
const source=`import * as React from 'react';import * as DOM from 'react-dom';
function send(value){window.effects.push(value);return value;}
function Buttons({label}) {const [count,setCount]=React.useState(0);const [,start]=React.useTransition();return <section>
<button id="transition" type="button" onClick={()=>React.startTransition(()=>{setCount(value=>value+1);send(label+':transition');})}>transition</button>
<button id="flush" type="button" onClick={()=>DOM.flushSync(()=>{setCount(value=>value+10);send(label+':flush');})}>flush</button>
<button id="batch" type="button" onClick={()=>DOM.unstable_batchedUpdates(value=>{setCount(count=>count+100);return send(value.tag);},{tag:label+':batch'})}>batch</button>
<button id="nested" type="button" onClick={()=>React.startTransition(()=>{DOM.flushSync(()=>{setCount(value=>value+10000);send(label+':inner');});send(label+':outer');})}>nested</button>
<button id="hook-transition" type="button" onClick={()=>start(()=>{setCount(value=>value+1000);send(label+':hook');})}>hook transition</button>
<output id="scope-state">{count}</output>
</section>;}
window.mount=()=>DOM.flushSync(()=>window.root.render(<Buttons label="one"/>));
function NamedButtons({id,name,pickLeft,old=false}) {
  const [,start]=React.useTransition();
  const left=()=>send(name+':left');
  function right(){return send(name+':right');}
  const choice=pickLeft?left:right;
  const selected=old?window.savedNamed[id]:choice;
  let reassigned=left;
  if(!pickLeft)reassigned=right;
  if(!window.savedNamed[id])window.savedNamed[id]=choice;
  return <section>
    <button id={id+'-named-transition'} type="button" onClick={()=>React.startTransition(selected)}>named transition</button>
    <button id={id+'-named-flush'} type="button" onClick={()=>DOM.flushSync(selected)}>named flush</button>
    <button id={id+'-named-batch'} type="button" onClick={()=>DOM.unstable_batchedUpdates(batched,7)}>named batch</button>
    <button id={id+'-reassigned-transition'} type="button" onClick={()=>React.startTransition(reassigned)}>reassigned transition</button>
    <button id={id+'-reassigned-hook'} type="button" onClick={()=>start(reassigned)}>reassigned hook transition</button>
    <button id={id+'-reassigned-flush'} type="button" onClick={()=>DOM.flushSync(reassigned)}>reassigned flush</button>
    <button id={id+'-reassigned-batch'} type="button" onClick={()=>DOM.unstable_batchedUpdates(reassigned)}>reassigned batch</button>
  </section>;
  function batched(value){return send(name+':batch:'+value);}
}
window.mountNamed=(pickLeft,old=false)=>DOM.flushSync(()=>window.root.render(<>
  <NamedButtons id="a" name={old?'changed-a':'original-a'} pickLeft={pickLeft} old={old}/>
  <NamedButtons id="b" name={old?'changed-b':'original-b'} pickLeft={!pickLeft} old={old}/>
</>));
window.runErrors=()=>{
  const error=window.error;
  for(const invoke of [()=>React.startTransition(()=>{throw error;}),()=>DOM.flushSync(()=>{throw error;}),()=>DOM.unstable_batchedUpdates(()=>{throw error;})]) {
    try{invoke();}catch(actual){if(actual!==error)throw Error('original error replaced');}
  }
  DOM.flushSync();DOM.flushSync(false);
  try{React.startTransition(undefined);}catch(error){}
  const callback=()=>send('named');React.startTransition(callback);React.startTransition(window.externalCallback);
};`;
try {
  fs.mkdirSync(path.join(temporary,'src'));fs.mkdirSync(path.join(temporary,'node_modules'));
  fs.writeFileSync(path.join(temporary,'src/App.tsx'),source);
  const pkg={name:'scope-acceptance',private:true,dependencies:{react:'18.3.1','react-dom':'18.3.1'}};
  fs.writeFileSync(path.join(temporary,'package.json'),JSON.stringify(pkg));
  const lock=JSON.parse(fs.readFileSync(path.join(repository,'package-lock.json')));
  fs.writeFileSync(path.join(temporary,'package-lock.json'),JSON.stringify({name:pkg.name,lockfileVersion:3,packages:{'':pkg,
    'node_modules/react':lock.packages['node_modules/react'],'node_modules/react-dom':lock.packages['node_modules/react-dom']}}));
  for(const name of ['react','react-dom'])fs.symlinkSync(path.join(repository,'node_modules',name),path.join(temporary,'node_modules',name));
  const map=analyzeReact({repository:temporary});const integration=createReactRuntimeIntegration(map);
  assert.ok(map.react_semantics.filter(row=>row.behavior?.execution?.kind==='synchronous_scope').every(row=>row.package_verification_sha256));
  const transformed=integration.instrumentSource('src/App.tsx',source);assert.deepEqual(transformed.diagnostics,[]);
  const application=ts.transpileModule(transformed.code.replace("import * as React from 'react';",'const React=window.React;')
    .replace("import * as DOM from 'react-dom';",'const DOM=window.ReactDOM;'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.None,jsx:ts.JsxEmit.React}}).outputText;
  const assets={'/runtime.js':fs.readFileSync(new URL('../../dist/producttrace-runtime.js',import.meta.url)),
    '/react.js':fs.readFileSync(path.join(temporary,`node_modules/react/umd/react.${build}.min.js`).replace('.development.min.js','.development.js')),
    '/dom.js':fs.readFileSync(path.join(temporary,`node_modules/react-dom/umd/react-dom.${build}.min.js`).replace('.development.min.js','.development.js'))};
  const html=`<!doctype html><div id="app"></div><script src="/runtime.js"></script><script>
    window.records=[];window.effects=[];window.savedNamed={};window.error={sentinel:true};window.externalCallback=()=>effects.push('unresolved');
    window.recorder=ProductTrace.start(${JSON.stringify(integration.bindings)},{outputMode:'evidence',onRecord:record=>records.push(record)});
    </script><script src="/react.js"></script><script src="/dom.js"></script><script>
    window.root=ReactDOM.createRoot(document.getElementById('app'));${application}mount();</script>`;
  const server=http.createServer((request,response)=>{if(assets[request.url])response.end(assets[request.url]);else{response.setHeader('content-type','text/html');response.end(html);}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
  try {
    browser=await chromium.launch({headless:true,...(process.env.PRODUCTTRACE_BROWSER_EXECUTABLE
      ?{executablePath:process.env.PRODUCTTRACE_BROWSER_EXECUTABLE}:{})});
    const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    for(const [control,value] of [['transition','1'],['flush','11'],['batch','111'],['nested','10111'],['hook-transition','11111']]) {
      await page.click('#'+control);await page.waitForFunction(expected=>document.getElementById('scope-state').textContent===expected,value);
    }
    const clicks=await page.evaluate(()=>({all:records,records:records.filter(row=>row.kind==='react_api' && row.scope),effects}));
    assert.deepEqual(errors,[]);assert.deepEqual(clicks.effects,['one:transition','one:flush','one:batch','one:inner','one:outer','one:hook']);
    for(const record of clicks.all)integration.onRecord(record);
    const joins=clicks.records.map(row=>integration.joinApi(row));assert.deepEqual(joins.filter(row=>row.status!=='resolved'),[]);
    const paths=clicks.records.filter(row=>row.scope.action_occurrence_id);
    assert.equal(paths.length,6,'five actual clicks invoke six scope callbacks');
    for(const record of paths) {
      const callback=record.scope.callbacks[0];assert.ok(callback.source_id);
      const joined=integration.joinApi(record),edges=joined.source.callback_paths;
      assert.ok(edges.length>0,'the observed callback must be reachable through the rule-driven source path');
      assert.ok(edges.some(edge=>map.edges.some(row=>row.scenario_id===edge.scenario_id && ['call','callback_forward'].includes(row.relation)
        && map.nodes.find(node=>node.id===row.to)?.text.startsWith('function send'))));
      const proof=joined.runtime.scope_proof;
      assert.equal(proof.scheduling.commit_observed,true,JSON.stringify(proof));
      assert.ok(proof.scheduling.state_requests_observed>=1);assert.ok(proof.scheduling.committed_state_updates.length>=1);
      assert.equal(proof.scheduling.priority_effect_proven,false);
      assert.equal(proof.action_link.status,'resolved',JSON.stringify(clicks.all.filter(row=>row.kind!=='react_api')));
    }
    const nested=paths.find(row=>row.scope.parent_scope_id);assert.ok(nested);
    assert.ok(paths.some(row=>row.scope.scope_id===nested.scope.parent_scope_id));
    const different=paths.find(row=>row.scope.scope_id!==paths[0].scope.scope_id
      && row.scope.callbacks[0].invocation_id!==paths[0].scope.callbacks[0].invocation_id);assert.ok(different);
    const borrowedScope=structuredClone(paths[0]);borrowedScope.scope.scope_id=different.scope.scope_id;
    assert.equal(integration.joinApi(borrowedScope).runtime.scope_proof.scheduling.commit_observed,false);
    const borrowedCallback=structuredClone(paths[0]);borrowedCallback.scope.callbacks[0].invocation_id=different.scope.callbacks[0].invocation_id;
    assert.equal(integration.joinApi(borrowedCallback).runtime.scope_proof.scheduling.commit_observed,false);
    const impossibleOrder=structuredClone(paths[0]);impossibleOrder.seq=0;
    assert.equal(integration.joinApi(impossibleOrder).runtime.scope_proof.scheduling.commit_observed,false);
    const batch=paths.find(row=>row.export==='unstable_batchedUpdates');
    assert.equal(batch.scope.inputs[1].identity,batch.scope.callbacks[0].arguments[0].identity);
    const broken=structuredClone(batch);broken.scope.callbacks[0].arguments[0].identity='foreign';
    assert.equal(integration.joinApi(broken).reason,'scope_callback_argument_mismatch');
    const foreign=structuredClone(batch);foreign.scope.action_occurrence_id=paths.find(row=>row.export==='startTransition').scope.action_occurrence_id;
    assert.equal(integration.joinApi(foreign).runtime.scope_proof.action_link.status,'unresolved');
    const dynamicStart=await page.evaluate(()=>records.length);
    await page.evaluate(()=>mountNamed(true));
    for(const selector of ['a-named-transition','b-named-transition','a-named-flush','b-named-flush','a-named-batch','b-named-batch'])await page.click('#'+selector);
    await page.evaluate(()=>mountNamed(false));
    await page.click('#a-named-transition');await page.click('#b-named-transition');
    await page.evaluate(()=>mountNamed(true,true));
    await page.click('#a-named-transition');await page.click('#b-named-flush');
    const dynamic=await page.evaluate(start=>({records:records.slice(start),effects:effects.slice(6)}),dynamicStart);
    assert.deepEqual(dynamic.effects,['original-a:left','original-b:right','original-a:left','original-b:right',
      'original-a:batch:7','original-b:batch:7','original-a:right','original-b:left','original-a:left','original-b:right']);
    for(const record of dynamic.records)integration.onRecord(record);
    const dynamicScopes=dynamic.records.filter(row=>row.kind==='react_api' && row.scope);
    const mountScopes=dynamicScopes.filter(row=>map.nodes.find(node=>node.id===row.source_call_id)?.text.includes('window.root.render'));
    assert.equal(mountScopes.length,3,'three test-driven mounts are separate from the ten clicks');
    for(const record of mountScopes)assert.notEqual(integration.joinApi(record).runtime.scope_proof.action_link.status,'resolved',
      'a still-visible browser stamp must not attribute an unrelated mount to a click');
    const dynamicCalls=dynamicScopes.filter(row=>!mountScopes.includes(row));
    assert.equal(dynamicCalls.length,10);
    const origins=dynamic.records.filter(row=>row.kind==='react_callback_source');assert.ok(origins.length>=6);
    for(const record of dynamicCalls) {
      const joined=integration.joinApi(record);assert.equal(joined.status,'resolved',JSON.stringify({joined,record}));
      assert.equal(joined.runtime.scope_proof.action_link.status,'resolved');
      assert.ok(joined.runtime.scope_proof.observed_callback_edge.source_observation_id);
      assert.equal(joined.runtime.scope_proof.observed_callback_edge.to,record.scope.callbacks[0].source_id);
    }
    assert.equal(dynamicCalls[0].scope.callbacks[0].callback_identity_id,dynamicCalls[8].scope.callbacks[0].callback_identity_id,
      'the escaped old function retains its own identity after rerender');
    assert.ok(dynamicCalls[8].scope.callbacks[0].captured_values.some(row=>row.value==='original-a'));
    assert.equal(integration.joinApi(dynamicCalls[8]).runtime.scope_proof.argument_branch,'unproven',
      'the actual tagged callback is known even when its argument branch is unresolved');
    const swapped=structuredClone(dynamicCalls[0]);swapped.scope.callbacks[0].source_id=dynamicCalls[1].scope.callbacks[0].source_id;
    assert.equal(integration.joinApi(swapped).reason,'scope_callback_origin_required');
    const noOrigins=createReactRuntimeIntegration(map);
    assert.equal(noOrigins.joinApi(dynamicCalls[0]).reason,'scope_callback_origin_required');
    const reassignedStart=await page.evaluate(()=>({records:records.length,effects:effects.length}));
    for(const suffix of ['reassigned-transition','reassigned-hook','reassigned-flush','reassigned-batch'])
      for(const id of ['a','b'])await page.click(`#${id}-${suffix}`);
    const reassigned=await page.evaluate(start=>({records:records.slice(start.records),effects:effects.slice(start.effects)}),reassignedStart);
    assert.deepEqual(reassigned.effects,['changed-a:left','changed-b:right','changed-a:left','changed-b:right',
      'changed-a:left','changed-b:right','changed-a:left','changed-b:right']);
    for(const record of reassigned.records)integration.onRecord(record);
    const reassignedCalls=reassigned.records.filter(row=>row.kind==='react_api'&&row.scope);assert.equal(reassignedCalls.length,8);
    for(const record of reassignedCalls) {
      const joined=integration.joinApi(record);assert.equal(joined.status,'resolved',JSON.stringify({joined,record}));
      assert.equal(joined.runtime.scope_proof.argument_branch,'source_candidates');
      assert.ok(joined.runtime.scope_proof.observed_callback_edge.source_observation_id);
      assert.equal(joined.runtime.scope_proof.action_link.status,'resolved');
    }
    assert.equal(new Set(reassignedCalls.map(row=>row.scope.callbacks[0].source_id)).size,2,
      'the reassigned binding selects the exact left or right source definition');
    const beforeErrors=await page.evaluate(()=>records.filter(row=>row.kind==='react_api' && row.scope).length);
    await page.evaluate(()=>runErrors());assert.deepEqual(errors,[]);
    const extra=await page.evaluate(count=>records.filter(row=>row.kind==='react_api' && row.scope).slice(count),beforeErrors);
    for(const record of await page.evaluate(()=>records))integration.onRecord(record);
    const extraJoins=extra.map(row=>integration.joinApi(row));
    assert.equal(extra.filter(row=>row.operation==='threw').length,4);
    const unresolved=extraJoins.filter(row=>row.status!=='resolved');
    assert.deepEqual(unresolved.map(row=>row.reason),['scope_callback_source_unproven']);
    assert.equal(extraJoins.filter(row=>row.runtime?.scope_proof.error_origin==='callback').length,3);
    const beforeStop=await page.evaluate(()=>records.filter(row=>row.scope).length);
    await page.evaluate(()=>{recorder.stop();runErrors();});assert.deepEqual(errors,[]);
    assert.equal(await page.evaluate(()=>records.filter(row=>row.scope).length),beforeStop);
    assert.equal(await page.evaluate(()=>effects.at(-1)),'unresolved','the original callback still executes after recording stops');
    console.log(JSON.stringify({build,installed_source_attested:true,click_callback_paths:paths.length,
      apis:['react/useTransition/18.3.1','react/startTransition/18.3.1','react-dom/flushSync/18.3.1','react-dom/unstable_batchedUpdates/18.3.1'],
      named_and_conditional_callbacks:true,old_callback_captures:true,wrong_known_candidate_rejected:true,
      reassigned_local_callbacks:reassignedCalls.length,
      callback_source_observations:origins.length,nested_scope_identity:true,argument_identity:true,exception_identity:true,wrong_argument_rejected:true,
      scoped_state_commits:paths.filter(row=>integration.joinApi(row).runtime.scope_proof.scheduling.commit_observed).length,
      cross_scope_commit_mutants_rejected:3,
      unknown_callback_frontier:true,stopped_recording_transparent:true,scope_path_verified:true},null,2));
  } finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
} finally {fs.rmSync(temporary,{recursive:true,force:true});}
