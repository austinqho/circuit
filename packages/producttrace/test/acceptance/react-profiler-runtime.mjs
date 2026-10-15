import assert from 'node:assert/strict';
import fs from 'node:fs';import http from 'node:http';import os from 'node:os';import path from 'node:path';
import {createRequire} from 'node:module';import ts from 'typescript';
import {analyzeReact,createReactRuntimeIntegration} from '../../analysis/index.mjs';
import {checkReactProfilerRecord,interpretReactProfilerCommit} from '../../analysis/react-profiler-runtime.mjs';
const repository=path.resolve(process.argv[2]||'/tmp/producttrace-librechat-autonomous');
const require=createRequire(path.join(repository,'package.json')),{chromium}=require('playwright');
const build=process.env.PRODUCTTRACE_REACT_BUILD||'development',profiling=build!=='production';
const nested=process.env.PRODUCTTRACE_PROFILER_NESTED==='1';
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'react-profiler-'));
const source=`import * as React from 'react';
function Child(){const [n,setN]=React.useState(0);React.useLayoutEffect(()=>{window.events.push(['layout',n]);if(window.nested&&n===0)setN(1);},[n]);
return <button id="update" onClick={()=>setN(n+1)}>{n}</button>;}
function App(){return <React.Profiler id="outer" onRender={function report(id,phase,actual,base,start,commit){
window.events.push(['profile',id,phase,actual,base,start,commit,arguments.length]);
if(window.throwProfile)throw window.failure;
if(window.reenter&&!window.inside){window.inside=true;try{report.apply(this,arguments);}finally{window.inside=false;}}
return window.returnToken;
}}><React.Profiler id="inner" onRender={(id,phase,actual,base,start,commit)=>window.events.push(['profile',id,phase,actual,base,start,commit,6])}>
<Child/></React.Profiler></React.Profiler>;}
window.App=App;`;
try{
 fs.mkdirSync(path.join(temporary,'node_modules'));fs.mkdirSync(path.join(temporary,'src'));fs.writeFileSync(path.join(temporary,'src/App.tsx'),source);
 const pkg={name:'profiler-acceptance',private:true,dependencies:{react:'18.3.1','react-dom':'18.3.1'}},lock=JSON.parse(fs.readFileSync(path.join(repository,'package-lock.json')));
 fs.writeFileSync(path.join(temporary,'package.json'),JSON.stringify(pkg));
 fs.writeFileSync(path.join(temporary,'package-lock.json'),JSON.stringify({name:pkg.name,lockfileVersion:3,packages:{'':pkg,
  'node_modules/react':lock.packages['node_modules/react'],'node_modules/react-dom':lock.packages['node_modules/react-dom']}}));
 for(const name of ['react','react-dom'])fs.symlinkSync(path.join(repository,'node_modules',name),path.join(temporary,'node_modules',name));
 const map=analyzeReact({repository:temporary}),integration=createReactRuntimeIntegration(map),transform=integration.instrumentSource('src/App.tsx',source);
 assert.deepEqual(transform.diagnostics,[]);
 assert.equal(integration.bindings.react_lifecycle.entries.filter(e=>e.kind==='profiler_callback').length,2,JSON.stringify(integration.bindings.react_lifecycle));
 const compile=code=>ts.transpileModule(code.replace("import * as React from 'react';",'const React=window.React;'),{
  compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.None,jsx:ts.JsxEmit.React}}).outputText;
 const reactBuild=build==='profiling'?'production':build;
 const assets={'/runtime.js':fs.readFileSync(new URL('../../dist/producttrace-runtime.js',import.meta.url)),
  '/react.js':fs.readFileSync(path.join(repository,`node_modules/react/umd/react.${reactBuild}.min.js`).replace('.development.min.js','.development.js')),
  '/dom.js':fs.readFileSync(path.join(repository,`node_modules/react-dom/umd/react-dom.${build}.min.js`).replace('.development.min.js','.development.js'))};
 const server=http.createServer((req,res)=>{
  if(assets[req.url])return res.end(assets[req.url]);const observed=req.url==='/observed';res.setHeader('content-type','text/html');
  res.end(`<!doctype html><div id="app"></div><script>window.events=[];window.records=[];window.returnToken={};window.failure=new Error('profiler-original-error');window.nested=${nested};</script>
${observed?`<script src="/runtime.js"></script><script>window.recorder=ProductTrace.start(${JSON.stringify(integration.bindings)},{outputMode:'evidence',onRecord:r=>records.push(r)});</script>`:''}
<script src="/react.js"></script><script src="/dom.js"></script><script>${compile(observed?transform.code:source)}
window.root=ReactDOM.createRoot(document.getElementById('app'));ReactDOM.flushSync(()=>root.render(React.createElement(App)));</script>`);
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
 try{
  browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  async function scenario(mode){
   const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(`http://127.0.0.1:${server.address().port}/${mode}`);
   await page.click('#update');await page.click('#update');
   const valid=await page.evaluate(()=>({events:events.slice(),records:records.slice()}));
   // The same original callback object is called twice during one actual commit.
   // Only the inner Profiler remains unambiguous.
   await page.evaluate(()=>window.reenter=true);await page.click('#update');
   const ambiguous=await page.evaluate(()=>records.slice());
   const originalPreserved=await page.evaluate(()=>{
    const todo=[root._internalRoot.current];let outer;
    while(todo.length){const f=todo.pop();if(f.child)todo.push(f.child);if(f.sibling)todo.push(f.sibling);if(f.tag===12&&f.memoizedProps.id==='outer')outer=f;}
    window.reenter=false;const callback=outer.memoizedProps.onRender;
    const same=callback.name==='report'&&callback.length===6&&callback('manual','update',1,2,3,4)===returnToken;
    return same;
   });
   assert.equal(originalPreserved,true);
   // A thrown callback must keep the exact application error. React's error
   // recovery can remove the boundary, so no successful commit is invented.
   let failures=[];
   if(profiling){
    await page.evaluate(()=>window.throwProfile=true);await page.click('#update');
    failures=await page.evaluate(()=>records.filter(r=>r.kind==='react_profiler'&&r.operation==='callback_finished'&&r.outcome==='threw'));
    assert.ok(errors.length>0);assert.ok(errors.every(e=>e==='profiler-original-error'));errors.length=0;
   }
   const allRecords=await page.evaluate(()=>records.slice());
   if(mode==='observed'){const count=await page.evaluate(()=>{recorder.stop();return records.length;});if(!profiling)await page.click('#update');assert.equal(await page.evaluate(()=>records.length),count);}
   await page.evaluate(()=>ReactDOM.flushSync(()=>root.unmount()));assert.deepEqual(errors,[]);await page.close();return {valid,ambiguous,failures,allRecords};
  }
  const baseline=await scenario('baseline'),observed=await scenario('observed');
  const normalize=events=>events.map(row=>row[0]==='profile'?[...row.slice(0,3),...row.slice(3,7).map(n=>typeof n==='number'&&Number.isFinite(n)),row[7]]:row);
  assert.deepEqual(normalize(observed.valid.events),normalize(baseline.valid.events));
  const joins=new Map(),reader=createReactRuntimeIntegration(map,{onJoin:(result,record)=>joins.set(record.observation_id,result)});
  for(const row of observed.allRecords)reader.onRecord(row);
  for(const row of observed.failures)assert.equal(joins.get(row.observation_id)?.status,'resolved');
  const commits=observed.valid.records.filter(r=>r.kind==='react_profiler'&&r.operation==='committed_callback');
  assert.equal(commits.length,profiling?(nested?8:6):0,JSON.stringify(observed.valid.records.filter(r=>r.kind==='react_profiler')));
  for(const row of commits)assert.equal(joins.get(row.observation_id)?.status,'resolved',JSON.stringify({row,join:joins.get(row.observation_id)}));
  if(profiling){
   assert.equal(observed.valid.events.filter(r=>r[0]==='profile').length,nested?8:6);
   assert.ok(observed.failures.length>0);
   if(nested)assert.equal(observed.valid.events.filter(r=>r[0]==='profile'&&r[2]==='nested-update').length,2);
   for(let i=0;i<observed.valid.events.length;i++)if(observed.valid.events[i][0]==='profile')
    assert.ok(observed.valid.events.slice(0,i).some(r=>r[0]==='layout'),'Profiler callback follows subtree layout work');
   for(const commit of commits){assert.equal(commit.program.phase,'layout_commit');assert.equal(commit.program.result,'ignore');}
   const added=observed.ambiguous.filter(r=>r.kind==='react_profiler'&&r.operation==='committed_callback'&&!commits.some(c=>c.observation_id===r.observation_id));
   assert.equal(added.length,2);assert.equal(added.filter(r=>r.frontier==='profiler_callback_ambiguous').length,1);
   assert.equal(added.filter(r=>joins.get(r.observation_id)?.status==='resolved').length,1);
  }
  let rejected=0;
  let behaviorRejected=0;
  if(commits.length){
   const entry=integration.bindings.react_lifecycle.entries.find(e=>e.key===commits[0].manifest_key),rule=entry.boundary_rule;
   for(const change of [{arguments:[...rule.profiler.arguments].reverse()},{mount_phase:'update'},{update_phase:'mount'},{phase:'passive_commit'},{result:'forward'},{callback:'onCommit'},{profile_mask:8},{update_mask:8}]){
    const mutant={...rule,profiler:{...rule.profiler,...change}};
    const agrees=commits.every(row=>{const expected=interpretReactProfilerCommit(mutant,row.snapshot);
     const actual=observed.valid.events.filter(r=>r[0]==='profile').find(r=>r[1]===row.snapshot.id.value&&r[2]===row.program.arguments[1].value&&r[6]===row.snapshot.commitTime.value);
     return expected&&actual&&expected.callback==='onRender'&&expected.phase==='layout_commit'&&expected.result==='ignore'
      &&JSON.stringify(expected.arguments.map(v=>v.value))===JSON.stringify(actual.slice(1,7));});
    assert.equal(agrees,false);behaviorRejected++;
   }
  }
  if(commits.length){
   const row=commits[0],entry=integration.bindings.react_lifecycle.entries.find(e=>e.key===row.manifest_key),callbackEntry=integration.bindings.react_lifecycle.entries.find(e=>e.key===row.callback_manifest_key);
   const start=observed.valid.records.find(r=>r.observation_id===row.invocation_id),end=observed.valid.records.find(r=>r.invocation_id===row.invocation_id&&r.operation==='callback_finished');
   const context={fingerprint:map.fingerprint,entry,callbackEntry,start,end,boundary:joins.get(row.boundary_observation_id)};
   for(const change of [{callback:'onCommit'},{phase:'passive_commit'},{result:'forward'},{arguments:[...entry.boundary_rule.profiler.arguments].reverse()},{profile_mask:8}]){
    assert.equal(checkReactProfilerRecord(row,{...context,entry:{...entry,boundary_rule:{...entry.boundary_rule,profiler:{...entry.boundary_rule.profiler,...change}}}}).status,'unresolved');rejected++;
   }
   for(const change of [{invocation_id:'foreign:call'},{callback_identity:'foreign:callback'},{renderer:{...row.renderer,root_id:'foreign'}},{boundary_observation_id:'foreign:boundary',frontier:'profiler_callback_ambiguous'}]){
    assert.equal(checkReactProfilerRecord({...row,...change},context).status,'unresolved');rejected++;
   }
  }
  console.log(JSON.stringify({api:'react/Profiler/18.3.1',build,nested_update:nested,baseline_preserved:true,commit_callbacks:commits.length,
   exact_callback_arguments:true,nested_owner_isolation:true,manual_reentry_abstains:profiling,ordinary_production_no_callback:!profiling,
   original_function_name_arity_return_preserved:true,thrown_callback_observed:observed.failures.length,
   incorrect_behavior_programs_rejected:behaviorRejected,incorrect_rules_or_receipts_rejected:rejected,stop_preserved:true},null,2));
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
}finally{fs.rmSync(temporary,{recursive:true,force:true});}
