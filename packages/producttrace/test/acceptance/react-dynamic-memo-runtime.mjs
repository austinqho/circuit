import assert from 'node:assert/strict';
import fs from 'node:fs';import http from 'node:http';import os from 'node:os';import path from 'node:path';
import {createRequire} from 'node:module';import ts from 'typescript';
import {analyzeReact,createReactRuntimeIntegration} from '../../analysis/index.mjs';
const repository=path.resolve(process.argv[2]||'/tmp/producttrace-librechat-autonomous');
const require=createRequire(path.join(repository,'package.json')),{chromium}=require('playwright');
const build=process.env.PRODUCTTRACE_REACT_BUILD||'development',strict=process.env.PRODUCTTRACE_REACT_STRICT==='1';
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'react-dynamic-memo-'));
const source=`import * as React from 'react';
function Item({name,value,pick,revision}){
 const first=()=>({send:()=>window.calls.push(name+':first:'+value)});
 const second=()=>({send:()=>window.calls.push(name+':second:'+value)});
 let calculator=first;
 if(pick)calculator=second;
 const cached=React.useMemo(calculator,[revision]);
 window.values[name]=cached;
 return <button data-name={name} onClick={cached.send}>{name}</button>;
}
function Gap({revision}){
 const known=()=>window.sharedValue;
 const cached=React.useMemo(window.unknown?window.unknownCalculator:known,[revision]);
 window.gapValue=cached;
 return null;
}
window.Item=Item;window.Gap=Gap;`;
try{
 fs.mkdirSync(path.join(temporary,'node_modules'));fs.mkdirSync(path.join(temporary,'src'));fs.writeFileSync(path.join(temporary,'src/App.tsx'),source);
 const pkg={name:'dynamic-memo-acceptance',private:true,dependencies:{react:'18.3.1','react-dom':'18.3.1'}},lock=JSON.parse(fs.readFileSync(path.join(repository,'package-lock.json')));
 fs.writeFileSync(path.join(temporary,'package.json'),JSON.stringify(pkg));
 fs.writeFileSync(path.join(temporary,'package-lock.json'),JSON.stringify({name:pkg.name,lockfileVersion:3,packages:{'':pkg,
  'node_modules/react':lock.packages['node_modules/react'],'node_modules/react-dom':lock.packages['node_modules/react-dom']}}));
 for(const name of ['react','react-dom'])fs.symlinkSync(path.join(repository,'node_modules',name),path.join(temporary,'node_modules',name));
 const map=analyzeReact({repository:temporary}),integration=createReactRuntimeIntegration(map),transform=integration.instrumentSource('src/App.tsx',source);
 assert.deepEqual(transform.diagnostics,[]);
 const semantic=map.react_semantics.find(row=>row.export==='useMemo'&&map.nodes.find(n=>n.id===row.call_id)?.text==='React.useMemo(calculator,[revision])');
 assert.equal(semantic.causal_bindings.callbacks[0].candidates.length,2);
 assert.equal(map.controls[0].callback_selection,'runtime_required');
 const compile=code=>ts.transpileModule(code.replace("import * as React from 'react';",'const React=window.React;'),{
  compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.None,jsx:ts.JsxEmit.React}}).outputText;
 const assets={'/runtime.js':fs.readFileSync(new URL('../../dist/producttrace-runtime.js',import.meta.url)),
  '/react.js':fs.readFileSync(path.join(repository,`node_modules/react/umd/react.${build}.min.js`).replace('.development.min.js','.development.js')),
  '/dom.js':fs.readFileSync(path.join(repository,`node_modules/react-dom/umd/react-dom.${build}.min.js`).replace('.development.min.js','.development.js'))};
 const server=http.createServer((req,res)=>{
  if(assets[req.url])return res.end(assets[req.url]);const observed=req.url==='/observed';res.setHeader('content-type','text/html');
  res.end(`<!doctype html><div id="app"></div><div id="gap"></div><script>window.calls=[];window.records=[];window.values={};window.sharedValue={};window.unknownCalculator=()=>sharedValue;</script>
${observed?`<script src="/runtime.js"></script><script>window.recorder=ProductTrace.start(${JSON.stringify(integration.bindings)},{outputMode:'evidence',onRecord:r=>records.push(r)});</script>`:''}
<script src="/react.js"></script><script src="/dom.js"></script><script>${compile(observed?transform.code:source)}
window.root=ReactDOM.createRoot(document.getElementById('app'));window.gapRoot=ReactDOM.createRoot(document.getElementById('gap'));
window.mount=(value,pick,revision,key=0)=>ReactDOM.flushSync(()=>root.render(React.createElement(${strict?'React.StrictMode':'React.Fragment'},null,
React.createElement(Item,{name:'a',value,pick,revision,key:'a'+key}),React.createElement(Item,{name:'b',value:99,pick:false,revision:0,key:'b'}))));
window.mountGap=revision=>ReactDOM.flushSync(()=>gapRoot.render(React.createElement(Gap,{revision})));
</script>`);
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
 try{
  browser=await chromium.launch({headless:true,...(process.env.PRODUCTTRACE_BROWSER_EXECUTABLE
    ?{executablePath:process.env.PRODUCTTRACE_BROWSER_EXECUTABLE}:{})});
  async function scenario(mode){
   const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(`http://127.0.0.1:${server.address().port}/${mode}`);
   await page.evaluate(()=>mount(1,false,0));await page.click('[data-name=a]');await page.click('[data-name=b]');
   await page.evaluate(()=>{window.old=values.a;mount(2,true,0);});assert.equal(await page.evaluate(()=>values.a===old),true);await page.click('[data-name=a]');
   await page.evaluate(()=>mount(2,true,1));assert.equal(await page.evaluate(()=>values.a===old),false);await page.click('[data-name=a]');await page.click('[data-name=b]');
   await page.evaluate(()=>mount(3,false,0,1));await page.click('[data-name=a]');
   await page.evaluate(()=>{mountGap(0);window.unknown=true;mountGap(1);});assert.equal(await page.evaluate(()=>gapValue===sharedValue),true);
   const records=await page.evaluate(()=>window.records.slice());
   if(mode==='observed')await page.evaluate(()=>recorder.stop());
   await page.evaluate(()=>mount(4,true,2,1));await page.click('[data-name=a]');
   const calls=await page.evaluate(()=>window.calls.slice());assert.deepEqual(errors,[]);await page.close();return {records,calls};
  }
  const baseline=await scenario('baseline'),observed=await scenario('observed');assert.deepEqual(observed.calls,baseline.calls);
  assert.deepEqual(observed.calls,['a:first:1','b:first:99','a:first:1','a:second:2','b:first:99','a:first:3','a:second:4']);
  function replay(records){const joins=new Map(),reader=createReactRuntimeIntegration(map,{onJoin:(result,record)=>joins.set(record.observation_id,result)});for(const row of records)reader.onRecord(row);return joins;}
  const joins=replay(observed.records),events=observed.records.filter(r=>r.kind==='react_callback');
  assert.equal(events.length,6);for(const row of events)assert.equal(joins.get(row.observation_id)?.status,'resolved',JSON.stringify({row,join:joins.get(row.observation_id)}));
  const selected=events.map(r=>joins.get(r.observation_id).runtime.memo_callback.runtime);
  assert.equal(selected[0].production_id,selected[2].production_id);assert.notEqual(selected[2].production_id,selected[3].production_id);
  assert.equal(selected[1].production_id,selected[4].production_id);assert.notEqual(selected[0].production_id,selected[5].production_id);
  const calculations=observed.records.filter(r=>r.kind==='react_lifecycle'&&r.operation==='callback_invoked'&&r.source_call_id===semantic.call_id);
  assert.ok(calculations.length>=4);assert.ok(calculations.every(r=>joins.get(r.observation_id)?.status==='resolved'));
  const gaps=observed.records.filter(r=>r.memo_source_frontier);assert.equal(gaps.length,1);
  assert.equal(joins.get(gaps[0].observation_id)?.reason,'memo_calculator_source_unobserved');
  // The proposing rule cannot mint a source receipt or transfer one between
  // callback objects, sources or sessions. Reject before retaining production.
  const first=calculations[0],origin=first.memo_callback_origin;
  for(const change of [undefined,{...origin,source_observation_id:'missing'},{...origin,callback_identity_id:'foreign'},
   {...origin,source_id:'foreign'}]){
   const altered=observed.records.map(r=>r===first?{...r,memo_callback_origin:change}:r),mutant=replay(altered);
   assert.equal(mutant.get(first.observation_id)?.status,'unresolved',JSON.stringify(change));
  }
  const noSources=replay(observed.records.filter(r=>r.kind!=='react_callback_source'));
  assert.ok(calculations.every(r=>noSources.get(r.observation_id)?.status==='unresolved'));
  assert.ok(events.every(r=>noSources.get(r.observation_id)?.status==='unresolved'));
  console.log(JSON.stringify({schema:'producttrace.react-dynamic-memo-acceptance.v1',build,strict,passed:true,events:events.length,
   calculations:calculations.length,negative_checks:5,unknown_source_abstentions:gaps.length,baseline_parity:true}));
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
}finally{fs.rmSync(temporary,{recursive:true,force:true});}
