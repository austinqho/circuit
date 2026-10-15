import assert from 'node:assert/strict';import fs from 'node:fs';import http from 'node:http';
import os from 'node:os';import path from 'node:path';import {createRequire} from 'node:module';import ts from 'typescript';
import {analyzeReact,createReactRuntimeIntegration} from '../../analysis/index.mjs';
const repository=path.resolve(process.argv[2]||'/tmp/producttrace-librechat-autonomous');
const require=createRequire(path.join(repository,'package.json'));const {chromium}=require('playwright');
const build=process.env.PRODUCTTRACE_REACT_BUILD==='production'?'production':'development';
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'react-context-effects-'));
const source=`import * as React from 'react';import * as DOM from 'react-dom';
const initial={label:'initial'};const Context=React.createContext(initial);
function consume(phase,id,value){window.effects.push([phase,id,value.label]);}
function Reader({id,skip}){const value=React.useContext(Context);
  React.useInsertionEffect(()=>{if(!skip)consume('insertion',id,value);return ()=>{if(!skip)consume('cleanup-insertion',id,value);};},[value,skip]);
  React.useLayoutEffect(()=>{if(!skip)consume('layout',id,value);return ()=>{if(!skip)consume('cleanup-layout',id,value);};},[value,skip]);
  React.useEffect(()=>{if(!skip)consume('passive',id,value);return ()=>{if(!skip)consume('cleanup-passive',id,value);};},[value,skip]);
  const label=React.useMemo(()=>{if(skip)return 'skipped';consume('memo',id,value);return value.label;},[value,skip]);
  return <span>{label}</span>;}
function App({value,skip}){return <Context.Provider value={value}><Reader id="left" skip={skip}/><Reader id="right" skip={skip}/>
  <button id="update" onClick={()=>window.mount({label:'updated'},false)}>update</button>
  <button id="skip" onClick={()=>window.mount({label:'skipped'},true)}>skip</button>
</Context.Provider>;}
window.mount=(value,skip=false)=>DOM.flushSync(()=>window.root.render(<App value={value} skip={skip}/>));`;
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
  assert.ok(map.react_semantics.filter(row=>['createContext','useContext'].includes(row.export)).every(row=>row.package_verification_sha256));
  const transform=integration.instrumentSource('src/App.tsx',source);assert.deepEqual(transform.diagnostics,[]);
  const application=ts.transpileModule(transform.code.replace("import * as React from 'react';",'const React=window.React;')
    .replace("import * as DOM from 'react-dom';",'const DOM=window.ReactDOM;'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.None,jsx:ts.JsxEmit.React}}).outputText;
  const assets={'/runtime.js':fs.readFileSync(new URL('../../dist/producttrace-runtime.js',import.meta.url)),
    '/react.js':fs.readFileSync(path.join(temporary,`node_modules/react/umd/react.${build}.min.js`).replace('.development.min.js','.development.js')),
    '/dom.js':fs.readFileSync(path.join(temporary,`node_modules/react-dom/umd/react-dom.${build}.min.js`).replace('.development.min.js','.development.js'))};
  const html=`<!doctype html><div id="app"></div><script src="/runtime.js"></script><script>
    window.records=[];window.effects=[];
    window.recorder=ProductTrace.start(${JSON.stringify(integration.bindings)},{outputMode:'evidence',onRecord:record=>records.push(record)});
    </script><script src="/react.js"></script><script src="/dom.js"></script><script>
    window.root=ReactDOM.createRoot(document.getElementById('app'));${application}mount(initial);</script>`;
  const server=http.createServer((request,response)=>{if(assets[request.url])response.end(assets[request.url]);else{response.setHeader('content-type','text/html');response.end(html);}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
  try {
    browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
    const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(()=>effects.filter(row=>row[0]==='passive').length===2);
    await page.click('#update');await page.waitForFunction(()=>effects.filter(row=>row[0]==='passive').length===4);
    assert.equal(await page.locator('span').first().textContent(),'updated');
    const beforeSkip=await page.evaluate(()=>records.filter(row=>row.operation==='context_value_used').length);
    await page.click('#skip');await page.waitForFunction(()=>document.querySelector('span').textContent==='skipped');
    assert.equal(await page.evaluate(()=>records.filter(row=>row.operation==='context_value_used').length),beforeSkip+6,
      'only the six previous-value cleanup reads should execute during the skipped update');
    assert.equal(await page.evaluate(()=>effects.some(row=>row[2]==='skipped')),false);
    const all=await page.evaluate(()=>records);for(const record of all)integration.onRecord(record);
    const uses=all.filter(row=>row.operation==='context_value_used');assert.equal(uses.length,32);
    const apis=new Set();
    for(const record of uses){const joined=joinedById.get(record.observation_id);
      assert.equal(joined.status,'resolved',JSON.stringify({joined,record}));apis.add(joined.source.export);
      assert.ok(record.caused_by_invocation_id);assert.equal(joined.runtime.context_use.claim,'observed_binding_read');}
    assert.deepEqual([...apis].sort(),['useEffect','useInsertionEffect','useLayoutEffect','useMemo']);
    const cleanupUses=uses.filter(row=>row.callback_slot==='cleanup');assert.equal(cleanupUses.length,12);
    for(const record of cleanupUses){const setup=all.find(row=>row.invocation_id===all.find(row=>row.invocation_id===record.caused_by_invocation_id).caused_by_invocation_id);
      assert.equal(record.render_id,setup.render_id);}
    const target=uses.find(row=>row.semantic_id.includes('/useEffect/'));
    const replay=(change,omit,selected=target)=>{let result;const fresh=createReactRuntimeIntegration(map,{onJoin:(joined,record)=>{if(record.observation_id===selected.observation_id)result=joined;}});
      for(const record of all){if(omit && record.invocation_id===selected.caused_by_invocation_id)continue;
        fresh.onRecord(record.observation_id===selected.observation_id?{...record,...change}:record);}return result;};
    assert.equal(replay({},true).reason,'context_use_callback_invocation_required');
    const other=uses.find(row=>row.instance_id!==target.instance_id && row.semantic_id===target.semantic_id);
    assert.equal(replay({caused_by_invocation_id:other.caused_by_invocation_id}).reason,'context_use_callback_invocation_required');
    assert.equal(replay({context_use:{...target.context_use,read_observation_id:other.context_use.read_observation_id}}).reason,'context_use_read_origin_required');
    assert.equal(replay({context_use:{...target.context_use,value_matches:false}}).reason,'context_use_value_mismatch');
    const cleanupTarget=cleanupUses.find(row=>row.source_call_id===target.source_call_id && row.instance_id===target.instance_id);
    assert.equal(replay({},true,cleanupTarget).reason,'context_use_callback_invocation_required');
    assert.equal(replay({caused_by_invocation_id:target.caused_by_invocation_id},false,cleanupTarget).reason,'context_use_callback_invocation_required');
    const newerRead=all.find(row=>row.operation==='value_read' && row.source_call_id===cleanupTarget.context_use.source_call_id
      && row.instance_id===cleanupTarget.instance_id && row.render_id!==cleanupTarget.render_id);
    assert.equal(replay({context_use:{...cleanupTarget.context_use,read_observation_id:newerRead.observation_id}},false,cleanupTarget).reason,'context_use_read_origin_required');
    assert.deepEqual(await page.evaluate(()=>effects.filter(row=>row[0].startsWith('cleanup-')).map(row=>row[2])),
      [...Array(6).fill('initial'),...Array(6).fill('updated')]);
    const entry=integration.bindings.react_lifecycle.entries.find(row=>row.source_call_id===target.source_call_id && row.kind==='callback');
    const beforeOutside=await page.evaluate(()=>records.length);
    assert.equal(await page.evaluate(({key,read})=>{const value={private:true};
      return globalThis.__productTraceReactLifecycle.contextValue(key,read,value)===value;
    },{key:entry.key,read:target.context_use.read_id}),true);
    assert.equal(await page.evaluate(()=>records.length),beforeOutside,'a completed callback cannot lend its invocation to unrelated code');
    const beforeStop=await page.evaluate(()=>records.length);await page.evaluate(()=>recorder.stop());await page.click('#update');
    await page.waitForFunction(()=>document.querySelector('span').textContent==='updated');
    assert.equal(await page.evaluate(()=>records.length),beforeStop);assert.deepEqual(errors,[]);
    console.log(JSON.stringify({build,apis:[...apis].sort(),actual_clicks:2,executed_context_reads:uses.length,
      callback_invocation_link:true,cleanup_reads:cleanupUses.length,cleanup_keeps_setup_render:true,
      cleanup_missing_invocation_rejected:true,cleanup_newer_read_rejected:true,skipped_branch_no_read:true,sibling_invocation_rejected:true,
      missing_invocation_rejected:true,sibling_read_rejected:true,wrong_value_rejected:true,
      inactive_invocation_no_evidence:true,
      stopped_recording_transparent:true},null,2));
  } finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
} finally {fs.rmSync(temporary,{recursive:true,force:true});}
