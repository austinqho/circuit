import assert from 'node:assert/strict';import fs from 'node:fs';import http from 'node:http';
import os from 'node:os';import path from 'node:path';import {createRequire} from 'node:module';import ts from 'typescript';
import {analyzeReact,createReactRuntimeIntegration} from '../../analysis/index.mjs';
const repository=path.resolve(process.argv[2]||'/tmp/producttrace-librechat-autonomous');
const require=createRequire(path.join(repository,'package.json'));const {chromium}=require('playwright');
const build=process.env.PRODUCTTRACE_REACT_BUILD==='production'?'production':'development';
const hydrate=process.env.PRODUCTTRACE_REACT_HYDRATE==='1';
const retained=process.env.PRODUCTTRACE_REACT_STORE_RETAINED==='1';
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'react-external-store-runtime-'));
const source=`import * as React from 'react';import * as DOM from 'react-dom';
function subscribe(listener){const id=++window.nextSubscription;window.subscriptionLog.push(['subscribe',id]);window.listeners.set(id,listener);
  window.oldListeners.push(listener);return ()=>{window.subscriptionLog.push(['cleanup',id]);window.listeners.delete(id);};}
function getSnapshot(){window.getterCalls++;if(window.throwOnce){window.throwOnce=false;throw window.snapshotError;}return window.storeValue;}
function getServerSnapshot(){return 'server';}
function View({id}){${retained?'const listen=React.useCallback(listener=>subscribe(listener),[window.subscriptionVersion]);':''}const value=React.useSyncExternalStore(${retained?'listen':'subscribe'},getSnapshot,getServerSnapshot);window.renderLog.push([id,value]);
  return <output id={id}>{String(value)}</output>;}
function App({epoch,left}){return <main>{left?<View key={'left'+epoch} id="left"/>:null}<View key="right" id="right"/>
    <button id="change-left" onClick={()=>{window.storeValue++;window.listeners.forEach(listener=>listener('unused'));}}>change</button>
    <button id="same-left" onClick={()=>window.listeners.forEach(listener=>listener())}>same</button>
    <button id="throw-right" onClick={()=>{window.throwOnce=true;window.listeners.forEach(listener=>listener());}}>throw</button>
    <button id="change-right" onClick={()=>{window.storeValue++;window.listeners.forEach(listener=>listener());}}>change right</button>
  </main>;}
window.mount=(epoch=0,left=true)=>DOM.flushSync(()=>window.root.render(<App epoch={epoch} left={left}/>));`;
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
  const sources=map.react_semantics.filter(row=>row.export==='useSyncExternalStore');assert.equal(sources.length,1);
  assert.ok(sources.every(row=>row.package_verification_sha256));
  const transform=integration.instrumentSource('src/App.tsx',source);assert.deepEqual(transform.diagnostics,[]);
  const application=ts.transpileModule(transform.code.replace("import * as React from 'react';",'const React=window.React;')
    .replace("import * as DOM from 'react-dom';",'const DOM=window.ReactDOM;'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.None,jsx:ts.JsxEmit.React}}).outputText;
  const assets={'/runtime.js':fs.readFileSync(new URL('../../dist/producttrace-runtime.js',import.meta.url)),
    '/react.js':fs.readFileSync(path.join(temporary,`node_modules/react/umd/react.${build}.min.js`).replace('.development.min.js','.development.js')),
    '/dom.js':fs.readFileSync(path.join(temporary,`node_modules/react-dom/umd/react-dom.${build}.min.js`).replace('.development.min.js','.development.js'))};
  let serverMarkup='';
  if(hydrate) {
    const serverWindow={React:require('react'),ReactDOM:require('react-dom'),renderLog:[]};
    // Render real React server markup with the same static control stamps.
    // These no-op probes provide no server tracing evidence; this fixture tests
    // the real client observer during hydration, including initial snapshot use.
    const serverProbe={component(){},apiResult:(_key,value)=>value,callback:(_key,value)=>value,
      eventCallback:(_key,value)=>value,tagSource:(_key,value)=>value};
    const ServerApp=new Function('window','globalThis',application+';return App;')(serverWindow,{__productTraceReactLifecycle:serverProbe});
    serverMarkup=require('react-dom/server').renderToString(serverWindow.React.createElement(ServerApp,{epoch:0,left:true}));
    assert.match(serverMarkup,/>server</);
  }
  const boot=hydrate?`${application}window.root=ReactDOM.hydrateRoot(document.getElementById('app'),React.createElement(App,{epoch:0,left:true}),{onRecoverableError:error=>window.recoveries.push(error.message)});`
    :`window.root=ReactDOM.createRoot(document.getElementById('app'));${application}mount();`;
  const html=`<!doctype html><div id="app">${serverMarkup}</div><script src="/runtime.js"></script><script>
    window.subscriptionVersion=0;window.records=[];window.listeners=new Map();window.oldListeners=[];window.storeValue=0;window.nextSubscription=0;
    window.recoveries=[];window.initialLeft=document.getElementById('left');window.getterCalls=0;window.subscriptionLog=[];window.renderLog=[];window.snapshotError=Error('snapshot failed');
    window.recorder=ProductTrace.start(${JSON.stringify(integration.bindings)},{outputMode:'evidence',onRecord:record=>records.push(record)});
    </script><script src="/react.js"></script><script src="/dom.js"></script><script>
    ${boot}</script>`;
  const server=http.createServer((request,response)=>{if(assets[request.url])response.end(assets[request.url]);else{response.setHeader('content-type','text/html');response.end(html);}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
  try {
    browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
    const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(()=>listeners.size===2 && document.getElementById('left').textContent==='0');
    if(hydrate){assert.equal(await page.evaluate(()=>initialLeft===document.getElementById('left')),true);assert.deepEqual(await page.evaluate(()=>recoveries),[]);
      assert.ok(await page.evaluate(()=>renderLog.some(row=>row[1]==='server')));}
    const subscriptions=await page.evaluate(()=>nextSubscription);assert.equal(subscriptions,2);
    const initialRenders=await page.evaluate(()=>renderLog.length);
    await page.click('#same-left');assert.equal(await page.evaluate(()=>renderLog.length),initialRenders);
    await page.click('#change-left');await page.waitForFunction(()=>document.getElementById('left').textContent==='1');
    assert.equal(await page.textContent('#right'),'1');assert.equal(await page.evaluate(()=>nextSubscription),2);
    await page.click('#throw-right');assert.ok(await page.evaluate(()=>renderLog.length)>initialRenders);
    await page.evaluate(()=>mount(1));await page.waitForFunction(()=>nextSubscription===3 && listeners.size===2);
    await page.click('#change-left');await page.waitForFunction(()=>document.getElementById('left').textContent==='2');
    await page.evaluate(()=>mount(1,false));await page.waitForFunction(()=>listeners.size===1);
    if(retained){await page.evaluate(()=>{subscriptionVersion=1;mount(1,false);});
      await page.waitForFunction(()=>nextSubscription===4 && listeners.size===1);await page.click('#same-left');}
    const all=await page.evaluate(()=>records);for(const record of all)integration.onRecord(record);
    const storeRecords=all.filter(row=>row.operation?.startsWith('store_'));
    assert.ok(storeRecords.length>10);
    for(const record of storeRecords)assert.equal(joinedById.get(record.observation_id).status,'resolved',JSON.stringify({record,join:joinedById.get(record.observation_id)}));
    if(retained) {
      const setups=all.filter(row=>row.operation==='callback_invoked' && row.semantic_id==='react/useSyncExternalStore/18.3.1' && row.callback_slot==='arguments.0');
      assert.equal(setups.length,4);
      for(const row of setups)assert.equal(joinedById.get(row.observation_id).runtime.retained_callback_input.status,'resolved');
      const first=setups[0],other=setups[1];
      const originReplay=(replacement,omit)=>{let result;const fresh=createReactRuntimeIntegration(map,{onJoin:(join,row)=>{if(row.observation_id===first.observation_id)result=join;}});
        for(const row of all){if(row.operation===omit)continue;fresh.onRecord(row.observation_id===first.observation_id?{...row,store_callback_origin:replacement}:row);}return result;};
      assert.equal(originReplay(first.store_callback_origin,'callback_selected').reason,'store_retained_callback_selection_required');
      assert.equal(originReplay(first.store_callback_origin,'callback_created').reason,'store_retained_callback_selection_required');
      assert.equal(originReplay(other.store_callback_origin).reason,'store_retained_callback_selection_required');
      assert.equal(originReplay({...first.store_callback_origin,producer_hook_slot_id:'wrong'}).reason,'store_retained_callback_selection_required');
      assert.equal(originReplay(null).runtime.retained_callback_input.status,'unobserved');
    }
    const snapshots=storeRecords.filter(row=>row.operation==='store_snapshot_observed');
    const notifications=storeRecords.filter(row=>row.operation==='store_listener_invoked');
    const cleanups=storeRecords.filter(row=>row.operation==='store_cleanup_invoked');
    assert.equal(notifications.length,retained?9:8);assert.equal(cleanups.length,retained?3:2);
    if(hydrate){assert.ok(snapshots.some(row=>row.snapshot_role==='server_snapshot'));assert.ok(snapshots.some(row=>row.snapshot_role==='snapshot'));}
    const linked=snapshots.filter(row=>row.notification_invocation_id);assert.equal(linked.length,retained?9:8);
    assert.equal(linked.filter(row=>row.outcome==='threw').length,1);
    assert.ok(snapshots.some(row=>!row.notification_invocation_id));
    for(const record of linked){const proof=joinedById.get(record.observation_id).runtime.external_store;
      assert.equal(proof.notification_link,'synchronous_listener_call');assert.equal(proof.commit_proven,false);
      assert.equal(proof.action_link.status,'resolved',JSON.stringify(proof));}
    const target=linked[0],sibling=linked[1];
    const replay=(change,omit)=>{let result;const fresh=createReactRuntimeIntegration(map,{onJoin:(joined,record)=>{if(record.observation_id===target.observation_id)result=joined;}});
      for(const record of all){if(omit && record.invocation_id===target.notification_invocation_id)continue;
        fresh.onRecord(record.observation_id===target.observation_id?{...record,...change}:record);}return result;};
    assert.equal(replay({},true).reason,'store_notification_lineage_mismatch');
    assert.equal(replay({notification_invocation_id:sibling.notification_invocation_id,store_listener_id:sibling.store_listener_id}).reason,'store_notification_lineage_mismatch');
    assert.equal(replay({argument_count:1}).reason,'store_snapshot_result_required');
    assert.equal(replay({value_id:'another-session:value'}).reason,'store_snapshot_result_required');
    assert.equal(replay({caused_by_invocation_id:'missing'}).reason,'store_callback_invocation_required');
    const withoutAction=new Map(),actionless=createReactRuntimeIntegration(map,{onJoin:(join,row)=>withoutAction.set(row.observation_id,join)});
    for(const row of all.filter(row=>row.kind!=='react_callback'))actionless.onRecord(row);
    for(const row of linked)assert.equal(withoutAction.get(row.observation_id).runtime.external_store.action_link.status,'unresolved');
    const offClickStart=await page.evaluate(()=>records.length);await page.evaluate(()=>listeners.forEach(listener=>listener()));
    const offClickRecords=(await page.evaluate(()=>records)).slice(offClickStart);
    for(const row of offClickRecords)integration.onRecord(row);
    const offClick=offClickRecords.find(row=>row.operation==='store_listener_invoked');assert.ok(offClick);
    assert.equal(joinedById.get(offClick.observation_id).runtime.external_store.action_link.status,'not_applicable');
    if(retained){const detachedStart=await page.evaluate(()=>records.length);await page.evaluate(()=>oldListeners[1]());
    const detachedRecords=(await page.evaluate(()=>records)).slice(detachedStart);for(const row of detachedRecords)integration.onRecord(row);
    const detached=detachedRecords.find(row=>row.operation==='store_listener_invoked');assert.ok(detached);
    assert.equal(joinedById.get(detached.observation_id).status,'resolved');
    assert.equal(joinedById.get(detached.observation_id).runtime.external_store.cleanup_previously_invoked,true);}
    const staleStart=await page.evaluate(()=>records.length);await page.evaluate(()=>oldListeners[0]());
    const staleRecords=(await page.evaluate(()=>records)).slice(staleStart);
    for(const row of staleRecords)integration.onRecord(row);
    const stale=staleRecords.find(row=>row.operation==='store_listener_invoked');assert.ok(stale);
    assert.equal(joinedById.get(stale.observation_id).reason,'mount_already_unmounted');
    const before=await page.evaluate(()=>records.length),subscriptionsBeforeStop=await page.evaluate(()=>nextSubscription);await page.evaluate(()=>recorder.stop());
    await page.click('#change-right');await page.waitForFunction(()=>document.getElementById('right').textContent==='3');
    assert.equal(await page.evaluate(()=>records.length),before);assert.equal(await page.evaluate(()=>nextSubscription),subscriptionsBeforeStop);await page.evaluate(()=>DOM.flushSync(()=>root.unmount()));
    assert.equal(await page.evaluate(()=>listeners.size),0);assert.deepEqual(errors,[]);
    console.log(JSON.stringify({api:'react/useSyncExternalStore/18.3.1',build,hydration:hydrate,hydration_reused_server_dom:hydrate,hydration_recovery_errors:0,actual_clicks:retained?5:4,retained_callback_dependency_replacement:retained,retained_callback_input_proven:retained,missing_and_sibling_retained_origin_rejected:retained,detached_listener_keeps_cleanup_history:retained,installed_source_attested:true,
      snapshots:snapshots.length,notifications:notifications.length,cleanups:cleanups.length,
      subscription_notification_snapshot_path:true,observed_click_callback_link:true,missing_action_callback_rejected:true,stable_subscription_identity:true,unchanged_snapshot_no_render:true,
      thrown_getter_preserved:true,sibling_remount_lineage:true,missing_notification_rejected:true,sibling_notification_rejected:true,
      missing_callback_rejected:true,wrong_arguments_rejected:true,wrong_session_rejected:true,
      stop_preserves_subscription_cleanup:true,stop_preserves_subscription_identity:true,outside_click_has_no_action:true,stale_unmounted_listener_rejected:true,render_commit_attribution:'unproven'},null,2));
  } finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
} finally {fs.rmSync(temporary,{recursive:true,force:true});}
