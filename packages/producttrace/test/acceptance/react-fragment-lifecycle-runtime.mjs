import assert from 'node:assert/strict';import fs from 'node:fs';import http from 'node:http';import os from 'node:os';import path from 'node:path';
import {predictReactFragmentIdentity} from '../../analysis/react-boundary-commit.mjs';
import {getReactBehavior} from '../../analysis/react-behavior.mjs';
import {validateReactExecutionRule} from '../../analysis/react-execution-rule.mjs';
import {createRequire} from 'node:module';import ts from 'typescript';import {analyzeReact,createReactRuntimeIntegration} from '../../analysis/index.mjs';
const repository=path.resolve(process.argv[2]||'/tmp/producttrace-librechat-autonomous'),require=createRequire(path.join(repository,'package.json'));
const {chromium}=require('playwright'),build=process.env.PRODUCTTRACE_REACT_BUILD==='production'?'production':'development';
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'react-fragment-lifetime-'));
const localValue=process.env.PRODUCTTRACE_FRAGMENT_LOCAL==='1';
let source=`import * as React from 'react';
function Child({name}){const token=React.useRef(null);if(token.current===null)token.current=++window.allocations;
React.useEffect(()=>{window.events.push(['mount',name,token.current]);return ()=>window.events.push(['unmount',name,token.current]);},[]);
return <output data-name={name}>{token.current}</output>;}
function App({reverse=false,epoch=0,show=true}){return <main>{reverse?<React.Fragment key="right"><button id="right" onClick={()=>window.clicks.push('right')}>right</button><Child name="right"/></React.Fragment>:show?<React.Fragment key={'left'+epoch} extra="ignored" ref={window.fragmentRef}><button id="left" onClick={()=>window.clicks.push('left')}>left</button><Child name="left"/></React.Fragment>:null}{reverse?(show?<React.Fragment key={'left'+epoch} extra="ignored" ref={window.fragmentRef}><button id="left" onClick={()=>window.clicks.push('left')}>left</button><Child name="left"/></React.Fragment>:null):<React.Fragment key="right"><button id="right" onClick={()=>window.clicks.push('right')}>right</button><Child name="right"/></React.Fragment>}</main>;}
window.App=App;`;
if(localValue)source=source.replace('}){return <main>','}){const view=<main>').replace('</main>;}','</main>;return view;}');
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
  const assets={'/runtime.js':fs.readFileSync(new URL('../../dist/producttrace-runtime.js',import.meta.url)),
    '/react.js':fs.readFileSync(path.join(temporary,`node_modules/react/umd/react.${build}.min.js`).replace('.development.min.js','.development.js')),
    '/dom.js':fs.readFileSync(path.join(temporary,`node_modules/react-dom/umd/react-dom.${build}.min.js`).replace('.development.min.js','.development.js'))};

  const html=`<!doctype html><div id="app"></div><script src="/runtime.js"></script><script>
window.records=[];window.clicks=[];window.events=[];window.allocations=0;window.refCalls=[];window.fragmentRef=v=>refCalls.push(v);
window.recorder=ProductTrace.start(${JSON.stringify(integration.bindings)},{outputMode:'evidence',onRecord:r=>records.push(r)});
</script><script src="/react.js"></script><script src="/dom.js"></script><script>${application}
window.root=ReactDOM.createRoot(document.getElementById('app'));window.draw=props=>ReactDOM.flushSync(()=>root.render(React.createElement(App,props)));draw({});</script>`;
  const server=http.createServer((req,res)=>{if(assets[req.url])res.end(assets[req.url]);else{res.setHeader('content-type','text/html');res.end(html);}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
  try{
    browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
    const page=await browser.newPage(),errors=[],warnings=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',msg=>{if(msg.type()==='error')warnings.push(msg.text());});
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const snapshots=[];
    async function snapshot(){
      await page.click('#left');await page.click('#right');
      snapshots.push(await page.evaluate(()=>({tokens:Object.fromEntries([...document.querySelectorAll('output')].map(e=>[e.dataset.name,e.textContent])),records:records.slice()})));
    }
    await snapshot();await page.evaluate(()=>{window.leftNode=document.querySelector('#left');draw({reverse:true});});await snapshot();
    assert.equal(await page.evaluate(()=>leftNode===document.querySelector('#left')),true);
    assert.deepEqual(await page.locator('button').allTextContents(),['right','left'],'the test must actually reorder the keyed siblings');
    assert.deepEqual(snapshots[0].tokens,snapshots[1].tokens,'keyed siblings retain state across reorder');
    await page.evaluate(()=>draw({epoch:1}));await snapshot();
    assert.notEqual(snapshots[1].tokens.left,snapshots[2].tokens.left,'changed key remounts left child');
    assert.equal(snapshots[1].tokens.right,snapshots[2].tokens.right);
    assert.equal(await page.evaluate(()=>leftNode===document.querySelector('#left')),false);
    await page.evaluate(()=>draw({show:false,epoch:1}));assert.equal(await page.locator('#left').count(),0);
    await page.evaluate(()=>draw({epoch:1}));await snapshot();
    assert.notEqual(snapshots[2].tokens.left,snapshots[3].tokens.left,'removed then reinserted key starts a fresh mount');
    assert.equal(snapshots[2].tokens.right,snapshots[3].tokens.right);
    const all=await page.evaluate(()=>records),joined=new Map();
    const reader=createReactRuntimeIntegration(map,{onJoin:(result,record)=>joined.set(record.observation_id||record.id,result)});
    for(const record of all)reader.onRecord(record);
    const committed=all.filter(row=>row.kind==='react_boundary_commit');
    for(const row of committed)assert.equal(joined.get(row.observation_id).status,'resolved',JSON.stringify({row,joined:joined.get(row.observation_id)}));
    const actions=all.filter(row=>row.kind==='action');
    const joins=actions.map(row=>reader.join(row));
    // The source branch and current renderer ancestry must meet inside Tracer.
    for(const value of joins){assert.equal(value.status,'resolved',JSON.stringify(value));assert.ok(value.runtime.boundary_selections.length>0,JSON.stringify(value));
      assert.ok(value.runtime.boundary_selections.every(row=>row.status==='resolved'));}
    const boundaryAt=(snapshot,name)=>{
      const action=snapshot.records.filter(row=>row.kind==='action').findLast(row=>row.target?.id===name);
      assert.ok(action,'clicked control receipt '+name);const ref=action.react_boundaries[0];return snapshot.records.find(row=>row.observation_id===ref.observation_id).renderer;
    };
    const left=snapshots.map(s=>boundaryAt(s,'left')),right=snapshots.map(s=>boundaryAt(s,'right'));
    assert.equal(left[0].instance_id,left[1].instance_id);assert.equal(left[0].mount_id,left[1].mount_id);
    assert.notEqual(left[1].instance_id,left[2].instance_id);assert.notEqual(left[2].instance_id,left[3].instance_id);
    assert.ok(right.every(row=>row.instance_id===right[0].instance_id&&row.mount_id===right[0].mount_id));
    const rule=getReactBehavior({surface:'react',exportName:'Fragment',version:'18.3.1'}).execution;
    const check=program=>{assert.equal(validateReactExecutionRule(program).valid,true);
      assert.equal(predictReactFragmentIdentity(program,left[0],left[1]).retains,true);
      assert.equal(predictReactFragmentIdentity(program,left[1],left[2]).retains,false);
      assert.equal(program.fragment.ref,'ignore');assert.equal(program.fragment.extra_props,'ignore');};
    check(rule);let mutants=0;
    for(const change of [{key_match:'index_only'},{type_tag:8},{ref:'attach'},{extra_props:'forward'}]){
      assert.throws(()=>check({...rule,fragment:{...rule.fragment,...change}}));mutants++;
    }
    const retained=committed.filter(row=>row.previous_observation_id);assert.ok(retained.length>=5);
    for(const row of retained)assert.equal(joined.get(row.observation_id).runtime.identity_relation.claim,'observed_retained_fragment_identity');
    const sample=retained[0];
    for(const change of [{previous_observation_id:'foreign:commit'},{identity_prediction:{...sample.identity_prediction,retains:false}},
      {renderer:{...sample.renderer,key:'different'}},{renderer:{...sample.renderer,parent_instance_id:'another-parent'}}]){
      let result;const fresh=createReactRuntimeIntegration(map,{onJoin:(joined,record)=>{if(record.observation_id===sample.observation_id)result=joined;}});
      for(const row of all)fresh.onRecord(row.observation_id===sample.observation_id?{...row,...change}:row);
      assert.equal(result.status,'unresolved',JSON.stringify({change,result}));
    }

    assert.equal(await page.evaluate(()=>refCalls.length),0,'Fragment ref is never attached');
    assert.equal(await page.evaluate(()=>document.querySelector('[extra]')),null,'extra Fragment props are not forwarded to a host');
    await page.evaluate(()=>ReactDOM.flushSync(()=>root.unmount()));
    assert.equal(await page.evaluate(()=>refCalls.length),0,'Fragment ref is not detached either');
    assert.equal(build==='development',warnings.some(text=>text.includes('Invalid prop')));
    assert.equal(build==='development',warnings.some(text=>text.includes('Invalid attribute')));
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({api:'react/Fragment/18.3.1',build,local_jsx_value:localValue,keyed_reorder_retains_state_and_fiber:true,key_change_remounts:true,removed_key_reinsertion_remounts:true,
      sibling_identity_isolated:true,click_branch_proofs:joins.length,ignored_props_not_forwarded:true,ref_never_attached:true,development_only_validation:true,
      boundary_commits:committed.length,retained_identity_joins:retained.length,wrong_rules_rejected:mutants,corrupted_lineage_rejected:4},null,2));
  }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
}finally{fs.rmSync(temporary,{recursive:true,force:true});}
