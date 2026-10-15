import assert from 'node:assert/strict';import fs from 'node:fs';import http from 'node:http';import os from 'node:os';import path from 'node:path';
import {createRequire} from 'node:module';import ts from 'typescript';import {analyzeReact,createReactRuntimeIntegration} from '../../analysis/index.mjs';
import {selectReactBoundaryCommit} from '../../analysis/react-boundary-commit.mjs';
import {validateReactExecutionRule} from '../../analysis/react-execution-rule.mjs';
const repository=path.resolve(process.argv[2]||'/tmp/producttrace-librechat-autonomous'),require=createRequire(path.join(repository,'package.json'));
const {chromium}=require('playwright'),build=process.env.PRODUCTTRACE_REACT_BUILD==='production'?'production':'development';
const hydration=process.env.PRODUCTTRACE_REACT_HYDRATE==='1',names=['Fragment','StrictMode','Profiler','Suspense'];
const suspending=process.env.PRODUCTTRACE_REACT_SUSPEND==='1';
assert.ok(!suspending || !hydration,'suspended server hydration needs its own acceptance');
const clickedNames=suspending?['Fragment','StrictMode','Profiler','Fallback']:names;
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'react-boundary-'));
const source=`import * as React from 'react';
function Pending(){throw window.pending;}
window.types=[${names.map(name=>`React.${name}`).join(',')}];
function App(){return <main>${names.map(name=>`<React.${name}${name==='Profiler'?' id="timing" onRender={()=>window.profileCalls++}':name==='Suspense'?` fallback={<button id="Fallback" onClick={()=>window.events.push('Fallback')}>Fallback</button>}`:''}>${name==='Suspense' && suspending?'<Pending/>':''}<button id="${name}" onClick={()=>window.events.push('${name}')}>${name}</button></React.${name}>`).join('')}</main>;}
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
  assert.equal(map.react_semantics.filter(row=>row.usage_kind==='jsx_boundary').length,4);
  assert.ok(map.react_semantics.every(row=>row.package_verification_sha256));
  const application=ts.transpileModule(transform.code.replace("import * as React from 'react';",'const React=window.React;'),{
    compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.None,jsx:ts.JsxEmit.React}}).outputText;
  assert.deepEqual(ts.transpileModule(transform.code,{reportDiagnostics:true,compilerOptions:{jsx:ts.JsxEmit.React}}).diagnostics.map(row=>({start:row.start,message:ts.flattenDiagnosticMessageText(row.messageText,' ')})),[],'instrumented JSX must remain valid');
  let markup='';
  if(hydration) {
    const serverWindow={React:require('react'),events:[],profileCalls:0};
    const App=new Function('window','globalThis',application+';return App;')(serverWindow,{__productTraceReactLifecycle:{...integration.createApiRuntime(),callback:(_k,v)=>v}});
    markup=require('react-dom/server').renderToString(serverWindow.React.createElement(App));
  }
  const assets={'/runtime.js':fs.readFileSync(new URL('../../dist/producttrace-runtime.js',import.meta.url)),
    '/react.js':fs.readFileSync(path.join(temporary,`node_modules/react/umd/react.${build}.min.js`).replace('.development.min.js','.development.js')),
    '/dom.js':fs.readFileSync(path.join(temporary,`node_modules/react-dom/umd/react-dom.${build}.min.js`).replace('.development.min.js','.development.js'))};
  const boot=hydration?`window.root=ReactDOM.hydrateRoot(document.getElementById('app'),React.createElement(App),{onRecoverableError:e=>recoveries.push(e.message)});`
    :`window.root=ReactDOM.createRoot(document.getElementById('app'));ReactDOM.flushSync(()=>root.render(React.createElement(App)));`;
  const html=`<!doctype html><div id="app">${markup}</div><script src="/runtime.js"></script><script>
    window.pending=new Promise(()=>{});window.records=[];window.events=[];window.profileCalls=0;window.recoveries=[];window.originalButton=document.querySelector('button');
    window.recorder=ProductTrace.start(${JSON.stringify(integration.bindings)},{outputMode:'evidence',onRecord:r=>records.push(r)});
    </script><script src="/react.js"></script><script src="/dom.js"></script><script>${application}${boot}</script>`;
  const server=http.createServer((req,res)=>{if(assets[req.url])res.end(assets[req.url]);else{res.setHeader('content-type','text/html');res.end(html);}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
  try {
    browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
    const page=await browser.newPage(),errors=[];page.on('pageerror',e=>{errors.push(e.message);process.stderr.write(e.message+'\n');});await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(()=>document.querySelectorAll('button').length===4,null,{timeout:5000});
    assert.equal(await page.evaluate(()=>document.querySelector('main').textContent),clickedNames.join(''));
    for(const name of clickedNames)await page.click('#'+name,{timeout:5000});
    const records=await page.evaluate(()=>records);for(const record of records)integration.onRecord(record);
    const committed=records.filter(row=>row.kind==='react_boundary_commit');assert.ok(committed.length>=4);
    assert.equal(new Set(committed.map(row=>row.origin_observation_id)).size,4);
    assert.equal(new Set(committed.map(row=>row.renderer.commit_id+':'+row.renderer.instance_id)).size,committed.length);
    let rendererMutants=0;
    for(const row of committed){
      const fresh=createReactRuntimeIntegration(map);for(const earlier of records.slice(0,records.indexOf(row)))fresh.onRecord(earlier);
      const joined=fresh.joinBoundaryCommit(row);assert.equal(joined.status,'resolved',JSON.stringify(joined));
      const expected=row.semantic_id.includes('/Suspense/')?(hydration&&row.renderer.dehydrated?'dehydrated':suspending?'fallback':'children'):'children';
      assert.equal(joined.runtime.selection.selection,expected);
      const rule=integration.bindings.react_lifecycle.entries.find(entry=>entry.key===row.manifest_key).boundary_rule;
      for(const tag of [7,8,12,13].filter(tag=>tag!==rule.renderer.tag)){
        const wrong={...rule,renderer:{...rule.renderer,tag}};assert.equal(validateReactExecutionRule(wrong).valid,true);
        assert.equal(selectReactBoundaryCommit(wrong,row.renderer),null);rendererMutants++;
      }
      if(suspending&&row.semantic_id.includes('/Suspense/')){
        const wrong={...rule,renderer:{...rule.renderer,selection:'children'}};
        assert.equal(validateReactExecutionRule(wrong).valid,true);assert.notEqual(selectReactBoundaryCommit(wrong,row.renderer).selection,expected);rendererMutants++;
      }
      for(const mutate of [value=>{value.origin_observation_id='missing';},value=>{value.input_identity='other';},
        value=>{value.renderer.tag=-1;},value=>{value.selection.selection='wrong';}]){
        const checker=createReactRuntimeIntegration(map);for(const earlier of records.slice(0,records.indexOf(row)))checker.onRecord(earlier);
        const bad=structuredClone(row);mutate(bad);assert.equal(checker.joinBoundaryCommit(bad).status,'unresolved');
        assert.equal(checker.joinBoundaryCommit(row).status,'resolved');
      }
    }
    const apiRecords=records.filter(row=>row.kind==='react_api'),joins=apiRecords.map(row=>integration.joinApi(row));
    assert.equal(apiRecords.length,8);assert.ok(joins.every(row=>row.status==='resolved'),JSON.stringify(joins));
    assert.equal(apiRecords.filter(row=>row.operation==='element_created').length,4);assert.equal(apiRecords.filter(row=>row.operation==='read').length,4);
    for(const join of joins){assert.equal(join.runtime.boundary_proof.renderer_execution_proven,false);assert.equal(join.runtime.boundary_proof.host_commit_proven,false);}
    for(const row of apiRecords) {
      assert.equal(integration.joinApi({...row,boundary_value:{...row.boundary_value,marker:'react.other'}}).reason,'boundary_value_mismatch');
      assert.equal(integration.joinApi({...row,boundary_value:undefined}).reason,'boundary_value_mismatch');
    }
    const actions=records.filter(row=>row.kind==='action'),actionJoins=actions.map(row=>integration.join(row));assert.equal(actions.length,4);
    for(const [index,joined] of actionJoins.entries()){
      assert.equal(joined.runtime.boundary_selections.length,1);
      assert.equal(joined.runtime.boundary_selections[0].status,'resolved',JSON.stringify({joined,action:actions[index]}));
      assert.deepEqual(joined.runtime.remaining_conditions,[]);
      const action=actions[index],foreign=actions[(index+1)%actions.length];
      assert.equal(integration.join({...action,react_boundaries:[]}).runtime.boundary_selections[0].reason,'boundary_commit_ancestry_required');
      assert.equal(integration.join({...action,react_boundaries:foreign.react_boundaries}).runtime.boundary_selections[0].status,'unresolved');
      const stale=action.react_boundaries.map(row=>({...row,commit_id:'react-commit:stale'}));
      assert.equal(integration.join({...action,react_boundaries:stale}).runtime.boundary_selections[0].status,'unresolved');
      const missing=createReactRuntimeIntegration(map);for(const record of records.filter(row=>row.kind!=='react_boundary_commit'))missing.onRecord(record);
      assert.equal(missing.join(action).runtime.boundary_selections[0].reason,'boundary_commit_ancestry_required');
    }
    for(const [index,join] of actionJoins.entries())assert.ok(join.source?.conditions.some(condition=>condition.react_boundary_input===(clickedNames[index]==='Fallback'?'fallback':'children') && condition.semantic_id===`react/${clickedNames[index]==='Fallback'?'Suspense':clickedNames[index]}/18.3.1`));
    assert.ok(actionJoins.every(row=>row.source?.conditions.some(condition=>['children','fallback'].includes(condition.react_boundary_input) && condition.runtime_observed===false)));
    assert.ok(actionJoins.every(row=>row.status==='resolved'),JSON.stringify(actionJoins));assert.equal(new Set(actionJoins.map(row=>row.source.control_id)).size,4);
    assert.deepEqual(await page.evaluate(()=>events),clickedNames);assert.deepEqual(await page.evaluate(()=>recoveries),[]);
    if(hydration)assert.equal(await page.evaluate(()=>originalButton===document.querySelector('button')),true);
    const count=await page.evaluate(()=>{recorder.stop();return records.length;});await page.click('#Fragment');assert.equal(await page.evaluate(()=>records.length),count);
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({apis:names.map(name=>`react/${name}/18.3.1`),build,hydration,suspending,installed_source_attested:true,
      symbol_reads:4,element_descriptions:4,actual_clicks:5,source_controls_resolved:4,fallback_control_joined:suspending,wrong_or_missing_marker_rejected:true,
      original_hydration_nodes_preserved:hydration,stop_preserves_behavior:true,renderer_execution_proven:false,
      boundary_inputs_committed:committed.length,renderer_selections_verified:true,incorrect_renderer_rules_rejected:rendererMutants,
      corrupted_commit_receipts_rejected:committed.length*4,click_path_conditions_discharged:4,missing_foreign_stale_boundary_proof_rejected:true,descendant_callbacks_inferred:false},null,2));
  }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
}finally{fs.rmSync(temporary,{recursive:true,force:true});}
