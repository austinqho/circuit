import assert from 'node:assert/strict';import fs from 'node:fs';import http from 'node:http';import os from 'node:os';import path from 'node:path';
import {createRequire} from 'node:module';import ts from 'typescript';import {analyzeReact,createReactRuntimeIntegration} from '../../analysis/index.mjs';
import {checkReactStrictReplay} from '../../analysis/react-strict-replay.mjs';
const repository=path.resolve(process.argv[2]||'/tmp/producttrace-librechat-autonomous'),require=createRequire(path.join(repository,'package.json'));
const {chromium}=require('playwright'),build=process.env.PRODUCTTRACE_REACT_BUILD==='production'?'production':'development';
const noMap=process.env.PRODUCTTRACE_STRICT_NO_MAP==='1';
const legacy=process.env.PRODUCTTRACE_STRICT_LEGACY==='1',priorHook=process.env.PRODUCTTRACE_STRICT_PRIOR_HOOK==='1';
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'react-strict-replay-'));
const source=`import * as React from 'react';
function Probe({name,n}){const value=React.useMemo(()=>{window.events.push(['calculate',name,n]);return n;},[n]);
React.useLayoutEffect(()=>{window.events.push(['setup',name,n]);return ()=>window.events.push(['cleanup',name,n]);},[n]);
return <button id={name} onClick={()=>window.events.push(['click',name,value])}>{name}</button>;}
function App({n=0,show=true}){return <main><Probe name="outside" n={n}/><React.StrictMode key="outer"><Probe name="outer" n={n}/>
{show?<React.StrictMode key="inner"><Probe name="inner" n={n}/></React.StrictMode>:null}</React.StrictMode></main>;}
window.App=App;`;
try {
  fs.mkdirSync(path.join(temporary,'node_modules'));fs.mkdirSync(path.join(temporary,'src'));fs.writeFileSync(path.join(temporary,'src/App.tsx'),source);
  const pkg={name:'boundary-acceptance',private:true,dependencies:{react:'18.3.1','react-dom':'18.3.1'}},lock=JSON.parse(fs.readFileSync(path.join(repository,'package-lock.json')));
  fs.writeFileSync(path.join(temporary,'package.json'),JSON.stringify(pkg));
  fs.writeFileSync(path.join(temporary,'package-lock.json'),JSON.stringify({name:pkg.name,lockfileVersion:3,packages:{'':pkg,
    'node_modules/react':lock.packages['node_modules/react'],'node_modules/react-dom':lock.packages['node_modules/react-dom']}}));
  for(const name of ['react','react-dom'])fs.symlinkSync(path.join(repository,'node_modules',name),path.join(temporary,'node_modules',name));
  const map=analyzeReact({repository:temporary}),integration=createReactRuntimeIntegration(map),transform=integration.instrumentSource('src/App.tsx',source);
  assert.deepEqual(transform.diagnostics,[]);
  assert.equal(map.react_semantics.filter(row=>row.usage_kind==='jsx_boundary').length,2);
  assert.ok(map.react_semantics.every(row=>row.package_verification_sha256));
  const compile=code=>ts.transpileModule(code.replace("import * as React from 'react';",'const React=window.React;'),{
    compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.None,jsx:ts.JsxEmit.React}}).outputText;
  const application=compile(transform.code);
  assert.deepEqual(ts.transpileModule(transform.code,{reportDiagnostics:true,compilerOptions:{jsx:ts.JsxEmit.React}}).diagnostics.map(row=>({start:row.start,message:ts.flattenDiagnosticMessageText(row.messageText,' ')})),[],'instrumented JSX must remain valid');
  const assets={'/runtime.js':fs.readFileSync(new URL('../../dist/producttrace-runtime.js',import.meta.url)),
    '/react.js':fs.readFileSync(path.join(temporary,`node_modules/react/umd/react.${build}.min.js`).replace('.development.min.js','.development.js')),
    '/dom.js':fs.readFileSync(path.join(temporary,`node_modules/react-dom/umd/react-dom.${build}.min.js`).replace('.development.min.js','.development.js'))};


  const existing=`window.hookCalls=[];window.previousStrict=function(id,value){hookCalls.push([id,value,this===window.__REACT_DEVTOOLS_GLOBAL_HOOK__]);return 'original';};
window.__REACT_DEVTOOLS_GLOBAL_HOOK__={supportsFiber:true,renderers:new Map(),inject(r){const id=this.renderers.size+1;this.renderers.set(id,r);return id;},
onCommitFiberRoot(){},onCommitFiberUnmount(){},setStrictMode:previousStrict};`;
  const boot=legacy?`window.draw=props=>ReactDOM.render(React.createElement(App,props),document.getElementById('app'));window.dispose=()=>ReactDOM.unmountComponentAtNode(document.getElementById('app'));`
    :`window.root=ReactDOM.createRoot(document.getElementById('app'));window.draw=props=>ReactDOM.flushSync(()=>root.render(React.createElement(App,props)));window.dispose=()=>ReactDOM.flushSync(()=>root.unmount());`;
  const server=http.createServer((req,res)=>{
    if(assets[req.url])return res.end(assets[req.url]);const observed=req.url==='/observed';res.setHeader('content-type','text/html');
    res.end(`<!doctype html><div id="app"></div><script>window.events=[];window.records=[];${priorHook?existing:''}</script>
${observed?`<script src="/runtime.js"></script><script>window.recorder=ProductTrace.start(${JSON.stringify(noMap?{actions:[{event:'click',id:'outside',action:'outside'}]}:integration.bindings)},{outputMode:'evidence',onRecord:r=>records.push(r)});</script>`:''}
<script src="/react.js"></script><script src="/dom.js"></script><script>${observed&&!noMap?application:compile(source)}${boot}draw({});</script>`);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
  try{
    browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
    async function scenario(mode){
      const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/${mode}`);
      for(const name of ['outside','outer','inner'])await page.click('#'+name);
      await page.evaluate(()=>draw({n:1}));await page.evaluate(()=>draw({n:1,show:false}));await page.evaluate(()=>draw({n:2}));
      const result=await page.evaluate(()=>({events:events.slice(),records:records.slice(),hookCalls:window.hookCalls?.slice()}));
      if(mode==='observed'){
        const stoppedCount=await page.evaluate(()=>{recorder.stop();return records.length;});
        if(priorHook)assert.equal(await page.evaluate(()=>__REACT_DEVTOOLS_GLOBAL_HOOK__.setStrictMode===previousStrict),true);
        await page.evaluate(()=>draw({n:3}));assert.equal(await page.evaluate(()=>records.length),stoppedCount);
      }
      await page.evaluate(()=>dispose());assert.deepEqual(errors,[]);await page.close();return result;
    }
    const baseline=await scenario('baseline'),observed=await scenario('observed');assert.deepEqual(observed.events,baseline.events);
    if(priorHook)assert.deepEqual(observed.hookCalls,baseline.hookCalls);
    assert.equal(observed.events.filter(row=>row[0]==='click').length,3,'StrictMode does not replay event callbacks');
    if(noMap){
      const clicks=observed.records.filter(row=>row.kind==='action');assert.equal(clicks.length,3);
      assert.ok(clicks.every(row=>row.react_identity?.root_id),'ordinary recording still observes committed React identities');
      assert.equal(observed.records.some(row=>row.kind==='react_strict_replay'),false);
      assert.equal(observed.records.some(row=>row.kind==='diagnostic'&&row.operation==='react_commit'),false);
      console.log(JSON.stringify({api:'react/StrictMode/18.3.1',build,legacy,prior_hook:priorHook,unmapped_recorder:true,
        baseline_preserved:true,committed_action_identities:clicks.length,stop_preserved:true},null,2));
    }else{
    const joins=new Map(),reader=createReactRuntimeIntegration(map,{onJoin:(result,record)=>joins.set(record.observation_id,result)});
    for(const row of observed.records)reader.onRecord(row);
    const brackets=observed.records.filter(row=>row.kind==='react_strict_replay'),starts=brackets.filter(row=>row.operation==='started');
    if(build==='development')assert.ok(starts.length>=7,JSON.stringify({brackets,records:observed.records.map(r=>[r.kind,r.operation,r.strict_replay_id])}));else assert.equal(brackets.length,0);
    for(const row of brackets)assert.equal(joins.get(row.observation_id).status,'resolved',JSON.stringify({row,result:joins.get(row.observation_id)}));
    assert.equal(brackets.length,starts.length*2);
    const renders=observed.records.filter(row=>row.operation==='render_attempted'&&row.strict_replay_id);
    if(build==='development')assert.equal(renders.length,starts.length);else assert.equal(renders.length,0);
    for(const row of renders)assert.equal(joins.get(row.observation_id).runtime.development_replay.status,'resolved',JSON.stringify({row,result:joins.get(row.observation_id)}));
    let rejected=0;
    if(starts.length){
      assert.equal(new Set(starts.map(row=>row.source_call_id)).size,2,'nested boundaries keep separate source origins');
      const row=starts[0],entry=integration.bindings.react_lifecycle.entries.find(e=>e.key===row.manifest_key),origin=observed.records.find(r=>r.observation_id===row.origin_observation_id);
      for(const change of [{renderer:{...row.renderer,bundle_type:0}},{input_identity:'wrong:input'},{owner:{...row.owner,root_id:'foreign'}},{boundary:{...row.boundary,mode:0}}]){
        assert.equal(checkReactStrictReplay({...row,...change},{fingerprint:map.fingerprint,entry,origin}).status,'unresolved');rejected++;
      }
      for(const change of [{strict_render_mask:0},{tag:13}]){
        assert.equal(checkReactStrictReplay(row,{fingerprint:map.fingerprint,origin,entry:{...entry,boundary_rule:{...entry.boundary_rule,renderer:{...entry.boundary_rule.renderer,...change}}}}).status,'unresolved');rejected++;
      }
      const lifecycle=renders[0];let badResult;const bad=createReactRuntimeIntegration(map,{onJoin:(result,record)=>{if(record.observation_id===lifecycle.observation_id)badResult=result;}});
      for(const r of observed.records)bad.onRecord(r.observation_id===lifecycle.observation_id?{...r,strict_replay_id:'foreign:scope'}:r);
      assert.equal(badResult.runtime?.development_replay?.status,'unresolved');
    }
    console.log(JSON.stringify({api:'react/StrictMode/18.3.1',build,legacy,prior_hook:priorHook,baseline_preserved:true,development_replay_brackets:starts.length,
      render_attempts_joined_to_replay:renders.length,nested_boundary_origins:starts.length?2:0,normal_events_not_replayed:true,
      production_no_replay:build==='production',incorrect_rules_or_receipts_rejected:rejected,prior_hook_preserved:priorHook,stop_preserved:true,
      effect_rehearsal_inferred:false},null,2));
    }
  }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
}finally{fs.rmSync(temporary,{recursive:true,force:true});}
