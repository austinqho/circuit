import assert from 'node:assert/strict';import fs from 'node:fs';import http from 'node:http';
import os from 'node:os';import path from 'node:path';import {createRequire} from 'node:module';import ts from 'typescript';
import {analyzeReact,createReactRuntimeIntegration} from '../../analysis/index.mjs';
const repository=path.resolve(process.argv[2]||'/tmp/producttrace-librechat-autonomous');
const require=createRequire(path.join(repository,'package.json'));const {chromium}=require('playwright');
const build=process.env.PRODUCTTRACE_REACT_BUILD==='production'?'production':'development';
const hydrate=process.env.PRODUCTTRACE_REACT_HYDRATE==='1';
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'react-deferred-runtime-'));
const source=`import * as React from 'react';import * as DOM from 'react-dom';
function View({value}){const selected=React.useDeferredValue(value);return <output>{selected}</output>;}
function App({tick,epoch}){return <main><View key={'left'+epoch} value={'left'+tick}/><View key="right" value={'right'+tick}/>
<button id="update" onClick={()=>{window.mount(1,0);window.immediate=[...document.querySelectorAll('output')].map(el=>el.textContent);}}>update</button>
<button id="remount" onClick={()=>window.mount(2,1)}>remount</button></main>;}
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
  const sources=map.react_semantics.filter(row=>row.export==='useDeferredValue');assert.equal(sources.length,1);
  assert.ok(sources.every(row=>row.package_verification_sha256));
  const transform=integration.instrumentSource('src/App.tsx',source);assert.deepEqual(transform.diagnostics,[]);
  const application=ts.transpileModule(transform.code.replace("import * as React from 'react';",'const React=window.React;')
    .replace("import * as DOM from 'react-dom';",'const DOM=window.ReactDOM;'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.None,jsx:ts.JsxEmit.React}}).outputText;
  const assets={'/runtime.js':fs.readFileSync(new URL('../../dist/producttrace-runtime.js',import.meta.url)),
    '/react.js':fs.readFileSync(path.join(temporary,`node_modules/react/umd/react.${build}.min.js`).replace('.development.min.js','.development.js')),
    '/dom.js':fs.readFileSync(path.join(temporary,`node_modules/react-dom/umd/react-dom.${build}.min.js`).replace('.development.min.js','.development.js'))};
  let serverMarkup='';
  if(hydrate) {
    const serverWindow={React:require('react'),ReactDOM:require('react-dom')};
    const serverProbe={component(){},apiResult:(_key,value)=>value,deferredInput:(_key,value)=>value,deferredResult:(_key,value)=>value,deferredUse:(_key,value)=>value};
    const ServerApp=new Function('window','globalThis',application+';return App;')(serverWindow,{__productTraceReactLifecycle:serverProbe});
    serverMarkup=require('react-dom/server').renderToString(serverWindow.React.createElement(ServerApp,{tick:0,epoch:0}),{identifierPrefix:'test-'});
  }
  const boot=hydrate?`${application}window.root=ReactDOM.hydrateRoot(document.getElementById('app'),React.createElement(App,{tick:0,epoch:0}),{identifierPrefix:'test-',onRecoverableError:error=>window.recoveries.push(error.message)});`
    :`window.root=ReactDOM.createRoot(document.getElementById('app'),{identifierPrefix:'test-'});${application}mount();`;
  const html=`<!doctype html><div id="app">${serverMarkup}</div><div id="other"></div><script src="/runtime.js"></script><script>
    window.records=[];window.recoveries=[];window.initialInput=document.querySelector('output');
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
    await page.click('#update');assert.deepEqual(await page.evaluate(()=>immediate),['left0','right0']);
    await page.waitForFunction(()=>document.querySelector('output').textContent==='left1');
    assert.deepEqual(await page.locator('output').allTextContents(),['left1','right1']);
    await page.click('#remount');await page.waitForFunction(()=>document.querySelectorAll('output')[1].textContent==='right2');
    assert.deepEqual(await page.locator('output').allTextContents(),['left2','right2']);
    await page.evaluate(()=>{window.otherRoot=ReactDOM.createRoot(document.getElementById('other'));ReactDOM.flushSync(()=>otherRoot.render(React.createElement(View,{value:'foreign'})));});
    const all=await page.evaluate(()=>records);for(const record of all)integration.onRecord(record);
    const selected=all.filter(row=>row.operation==='deferred_selected'),uses=all.filter(row=>row.operation==='deferred_used');
    fs.writeFileSync('/tmp/pr8-deferred-runtime-debug.json',JSON.stringify({all,joins:[...joinedById],manifest:integration.bindings.react_lifecycle},null,2));
    assert.ok(selected.length>=9);assert.equal(selected.length,uses.length);
    for(const row of [...selected,...uses])assert.equal(joinedById.get(row.observation_id).status,'resolved',JSON.stringify({row,join:joinedById.get(row.observation_id)}));
    assert.ok(selected.some(row=>joinedById.get(row.observation_id).runtime.deferred_proof.selection==='previous'));
    assert.equal(new Set(selected.map(row=>row.root_id)).size,2);
    for(const row of uses)assert.equal(joinedById.get(row.observation_id).runtime.deferred_proof.host_commit_proven,false);
    const target=uses[0],sibling=uses.find(row=>row.instance_id!==target.instance_id);
    const replay=(change,omit)=>{let result;const fresh=createReactRuntimeIntegration(map,{onJoin:(join,row)=>{if(row.observation_id===target.observation_id)result=join;}});
      for(const row of all){if(omit && row.observation_id===target.origin_observation_id)continue;fresh.onRecord(row.observation_id===target.observation_id?{...row,...change}:row);}return result;};
    assert.equal(replay({},true).reason,'deferred_use_origin_mismatch');
    assert.equal(replay({origin_observation_id:sibling.origin_observation_id}).reason,'deferred_use_origin_mismatch');
    assert.equal(replay({value_id:sibling.value_id}).reason,'deferred_use_origin_mismatch');
    assert.equal(replay({value:{encoding:'primitive',value:'forged'}}).reason,'deferred_use_origin_mismatch');
    assert.equal(replay({read_source_id:'foreign'}).reason,'deferred_use_origin_mismatch');
    const old=selected.find(row=>joinedById.get(row.observation_id).runtime.deferred_proof.selection==='previous');
    const tamper=new Map(),tamperJoin=createReactRuntimeIntegration(map,{onJoin:(join,row)=>tamper.set(row.observation_id,join)});
    for(const row of all)tamperJoin.onRecord(row.observation_id===old.observation_id?{...row,previous_observation_id:selected.find(value=>value.instance_id!==old.instance_id && value.root_id===old.root_id).observation_id}:row);
    assert.equal(tamper.get(old.observation_id).reason,'deferred_previous_unobserved');
    const before=await page.evaluate(()=>records.length);await page.evaluate(()=>recorder.stop());await page.evaluate(()=>mount(3,1));
    await page.waitForFunction(()=>document.querySelector('output').textContent==='left3');assert.equal(await page.evaluate(()=>records.length),before);assert.deepEqual(errors,[]);
    console.log(JSON.stringify({api:'react/useDeferredValue/18.3.1',build,hydration:hydrate,actual_clicks:2,
      selections:selected.length,jsx_reads:uses.length,installed_source_attested:true,previous_value_to_jsx:true,current_input_to_jsx:true,
      sibling_and_root_isolation:true,missing_origin_rejected:true,wrong_value_and_source_rejected:true,sibling_previous_rejected:true,
      stop_preserves_behavior:true,hydration_dom_reused:hydrate,render_urgency:'unproven',update_commit_attribution:'unproven',host_commit_attribution:'unproven'},null,2));
  } finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
} finally {fs.rmSync(temporary,{recursive:true,force:true});}
