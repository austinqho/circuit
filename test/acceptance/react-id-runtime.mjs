import assert from 'node:assert/strict';import fs from 'node:fs';import http from 'node:http';
import os from 'node:os';import path from 'node:path';import {createRequire} from 'node:module';import ts from 'typescript';
import {analyzeReact,createReactRuntimeIntegration} from '../../analysis/index.mjs';
const repository=path.resolve(process.argv[2]||'/tmp/producttrace-librechat-autonomous');
const require=createRequire(path.join(repository,'package.json'));const {chromium}=require('playwright');
const build=process.env.PRODUCTTRACE_REACT_BUILD==='production'?'production':'development';
const hydrate=process.env.PRODUCTTRACE_REACT_HYDRATE==='1';
const lifetimes=process.env.PRODUCTTRACE_REACT_ID_LIFETIMES==='1';
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'react-id-runtime-'));
let source=`import * as React from 'react';import * as DOM from 'react-dom';
function Field({name}){const id=React.useId();const help=React.useId();return <section><label htmlFor={id}>{name}</label><input id={id}/><small id={help}>Help</small></section>;}
function App({tick,epoch}){return <main><Field key={'left'+epoch} name={'left'+tick}/><Field key="right" name={'right'+tick}/>
<button id="update" onClick={()=>window.mount(1,0)}>update</button><button id="remount" onClick={()=>window.mount(1,1)}>remount</button></main>;}
window.mount=(tick=0,epoch=0)=>DOM.flushSync(()=>window.root.render(<App tick={tick} epoch={epoch}/>));`;
if(lifetimes)source=source.replace('function Field({name}){const id=React.useId();const help=React.useId();return <section><label htmlFor={id}>{name}</label><input id={id}/><small id={help}>Help</small></section>;}\n','function Field({name}){const id=React.useId();const help=React.useId();const alias=id;const described=help;window.attempts?.push(name);if(window.suspended===name)throw window.never;return <section><label htmlFor={alias}>{name}</label><input id={alias} aria-describedby={described}/><small id={help}>Help</small></section>;}\n').replace("<Field key={'left'+epoch} name={'left'+tick}/>","<React.Suspense fallback={<i id=\"fallback\">waiting</i>}><Field key={'left'+epoch} name={'left'+tick}/></React.Suspense>");
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
  const sources=map.react_semantics.filter(row=>row.export==='useId');assert.equal(sources.length,2);
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
    const serverProbe={boundaryResult:(_key,value)=>value,component(){},apiResult:(_key,value)=>value,idResult:(_key,value)=>value,idUse:(_key,value)=>value,idElement:(_keys,value)=>value};
    const ServerApp=new Function('window','globalThis',application+';return App;')(serverWindow,{__productTraceReactLifecycle:serverProbe});
    serverMarkup=require('react-dom/server').renderToString(serverWindow.React.createElement(ServerApp,{tick:0,epoch:0}),{identifierPrefix:'test-'});
  }
  const boot=hydrate?`${application}window.root=ReactDOM.hydrateRoot(document.getElementById('app'),React.createElement(App,{tick:0,epoch:0}),{identifierPrefix:'test-',onRecoverableError:error=>window.recoveries.push(error.message)});`
    :`window.root=ReactDOM.createRoot(document.getElementById('app'),{identifierPrefix:'test-'});${application}mount();`;
  const html=`<!doctype html><div id="app">${serverMarkup}</div><div id="other"></div><script src="/runtime.js"></script><script>
    window.records=[];window.attempts=[];window.never=new Promise(()=>{});window.recoveries=[];window.initialInput=document.querySelector('input');
    window.recorder=ProductTrace.start(${JSON.stringify(integration.bindings)},{outputMode:'evidence',onRecord:record=>records.push(record)});
    </script><script src="/react.js"></script><script src="/dom.js"></script><script>${boot}</script>`;
  const server=http.createServer((request,response)=>{if(assets[request.url])response.end(assets[request.url]);else{response.setHeader('content-type','text/html');response.end(html);}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
  try {
    browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
    const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    assert.deepEqual(errors,[]);
    await page.waitForFunction(()=>document.querySelectorAll('input').length===2);
    if(hydrate){assert.equal(await page.evaluate(()=>initialInput===document.querySelector('input')),true);assert.deepEqual(await page.evaluate(()=>recoveries),[]);}
    const readIds=()=>page.locator('input').evaluateAll(inputs=>inputs.map(input=>input.id));
    const initial=await readIds();assert.equal(new Set(initial).size,2);assert.ok(initial.every(id=>id.startsWith(':test-')));
    await page.locator('label').first().click();assert.equal(await page.evaluate(()=>document.activeElement.id),initial[0]);
    await page.click('#update');assert.deepEqual(await readIds(),initial);
    await page.click('#remount');const remounted=await readIds();assert.notEqual(remounted[0],initial[0]);assert.equal(remounted[1],initial[1]);
    await page.evaluate(()=>{window.otherRoot=ReactDOM.createRoot(document.getElementById('other'),{identifierPrefix:'other-'});
      ReactDOM.flushSync(()=>otherRoot.render(React.createElement(Field,{name:'other'})));});
    assert.equal((await readIds()).length,3);assert.ok((await readIds())[2].startsWith(':other-'));
    const all=await page.evaluate(()=>records);for(const record of all)integration.onRecord(record);
    const reads=all.filter(row=>row.operation==='id_read'),uses=all.filter(row=>row.operation==='id_used');
    const commits=all.filter(row=>row.kind==='react_id_commit');assert.equal(commits.length,lifetimes?(hydrate?32:28):21);
    for(const row of commits){const proof=joinedById.get(row.observation_id);assert.equal(proof.status,'resolved',JSON.stringify(proof));
      assert.equal(proof.runtime.host_commit_proven,true);assert.equal(proof.runtime.entity_identity_proven,false);}
    assert.equal(reads.length,14);assert.equal(uses.length,lifetimes?28:21);
    for(const row of [...reads,...uses])assert.equal(joinedById.get(row.observation_id).status,'resolved',JSON.stringify({row,join:joinedById.get(row.observation_id)}));
    assert.ok(reads.some(row=>joinedById.get(row.observation_id).runtime.id_proof.retained_from));
    assert.equal(new Set(reads.map(row=>row.root_id)).size,2);
    for(const row of uses){const proof=joinedById.get(row.observation_id).runtime.id_proof;
      assert.equal(proof.host_commit_proven,false);assert.equal(proof.entity_identity_proven,false);}
    const target=uses[0],sibling=uses.find(row=>row.instance_id!==target.instance_id);
    const committed=commits[0];
    for(const mutate of [row=>{row.use_observation_id='missing';},row=>{row.owner.instance_id='sibling';},
      row=>{row.host.root_id='other-root';},row=>{row.id_property='other';},row=>{row.value=':wrong:';}]){
      const fresh=createReactRuntimeIntegration(map);for(const row of all.slice(0,all.indexOf(committed)))fresh.onRecord(row);
      const bad=structuredClone(committed);mutate(bad);assert.equal(fresh.joinIdCommit(bad).status,'unresolved');
      assert.equal(fresh.joinIdCommit(committed).status,'resolved');assert.equal(fresh.joinIdCommit(committed).reason,'duplicate_id_commit');
    }
    const replay=(change,omit)=>{let result;const fresh=createReactRuntimeIntegration(map,{onJoin:(join,row)=>{if(row.observation_id===target.observation_id)result=join;}});
      for(const row of all){if(omit && row.observation_id===target.id_read_observation_id)continue;fresh.onRecord(row.observation_id===target.observation_id?{...row,...change}:row);}return result;};
    assert.equal(replay({},true).reason,'id_property_origin_mismatch');
    assert.equal(replay({id_read_observation_id:sibling.id_read_observation_id}).reason,'id_property_origin_mismatch');
    assert.equal(replay({id_value:{encoding:'primitive',value:':wrong:'}}).reason,'id_property_origin_mismatch');
    assert.equal(replay({id_property:'name'}).reason,'id_property_origin_mismatch');
    const retainedRead=reads.find(row=>joinedById.get(row.observation_id).runtime.id_proof.retained_from);
    const wrongRetention=new Map(),retentionReplay=createReactRuntimeIntegration(map,{onJoin:(join,row)=>wrongRetention.set(row.observation_id,join)});
    for(const row of all)retentionReplay.onRecord(row.observation_id===retainedRead.observation_id?{...row,id_value:{encoding:'primitive',value:':changed:'}}:row);
    assert.equal(wrongRetention.get(retainedRead.observation_id).reason,'id_changed_within_mount');
    const foreign=uses.find(row=>row.root_id!==target.root_id),foreignJoins=new Map(),foreignReplay=createReactRuntimeIntegration(map,{onJoin:(join,row)=>foreignJoins.set(row.observation_id,join)});
    for(const row of all)foreignReplay.onRecord(row.observation_id===foreign.id_read_observation_id?{...row,id_value:target.id_value}
      :row.observation_id===foreign.observation_id?{...row,id_read_observation_id:target.id_read_observation_id,id_value:target.id_value}:row);
    assert.equal(foreignJoins.get(foreign.observation_id).reason,'id_property_origin_mismatch');
    let laterCommits=[];
    if(lifetimes){
    const beforeInterrupt=await page.evaluate(()=>records.length);
    const stable=await readIds();
    await page.evaluate(()=>{window.suspended='left2';React.startTransition(()=>root.render(React.createElement(App,{tick:2,epoch:1})));});
    await page.waitForFunction(()=>attempts.includes('left2'));
    assert.deepEqual(await readIds(),stable,'suspended transition retains the committed IDs');
    const interrupted=await page.evaluate(()=>records.slice());
    const attempted=interrupted.slice(beforeInterrupt).filter(r=>r.operation==='render_attempted');
    if(build==='development')assert.ok(attempted.length>0);
    else assert.equal(attempted.length,0,'production buffers render records until it can establish an owner');
    const attemptedIds=new Set(attempted.map(r=>r.render_id));
    assert.equal(interrupted.slice(beforeInterrupt).some(r=>r.kind==='react_id_commit'&&attemptedIds.has(r.owner.render_id)),false,
      'attempted IDs cannot borrow an older committed host');
    assert.equal(interrupted.slice(beforeInterrupt).filter(r=>r.kind==='react_id_commit').length,0,
      'the test observed the suspended component, but none of that work reached a host commit');
    await page.evaluate(()=>{window.suspended=null;mount(3,1);});
    assert.deepEqual(await readIds(),stable);
    // Hide/reveal committed content synchronously; its hook identity survives.
    await page.evaluate(()=>{window.suspended='left4';mount(4,1);});
    await page.waitForSelector('#fallback');
    await page.evaluate(()=>{window.suspended=null;mount(5,1);});
    assert.deepEqual(await readIds(),stable);
    const lifetimeRecords=await page.evaluate(()=>records.slice()),lifetimeJoins=new Map();
    const lifetimeReader=createReactRuntimeIntegration(map,{onJoin:(result,row)=>lifetimeJoins.set(row.observation_id,result)});
    for(const row of lifetimeRecords)lifetimeReader.onRecord(row);
    laterCommits=lifetimeRecords.slice(beforeInterrupt).filter(r=>r.kind==='react_id_commit');
    assert.ok(laterCommits.length>=12);for(const row of laterCommits)
      assert.equal(lifetimeJoins.get(row.observation_id)?.status,'resolved',JSON.stringify({row,join:lifetimeJoins.get(row.observation_id)}));
    assert.equal(await page.evaluate(()=>[...document.querySelectorAll('input')].every(input=>document.getElementById(input.getAttribute('aria-describedby'))?.textContent==='Help')),true);
    }
    const idsBeforeStop=await readIds(),before=await page.evaluate(()=>records.length);await page.evaluate(()=>recorder.stop());
    await page.evaluate(()=>mount(2,1));assert.deepEqual(await readIds(),idsBeforeStop);assert.equal(await page.evaluate(()=>records.length),before);
    assert.equal(await page.evaluate(()=>[...document.querySelectorAll('label')].every(label=>label.control?.id===label.htmlFor)),true);
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({api:'react/useId/18.3.1',build,hydration:hydrate,actual_clicks:3,reads:reads.length,property_uses:uses.length,
      ...(lifetimes?{immutable_aliases:true,aria_relationship:true,interrupted_attempt_not_committed:true,suspense_hide_reveal:true,lifetime_commits:laterCommits.length}:{}),
      installed_source_attested:true,hook_id_to_jsx_property:true,retention_and_remount:true,root_prefix_isolation:true,native_label_control:true,
      missing_origin_rejected:true,sibling_origin_rejected:true,wrong_value_and_property_rejected:true,changed_retained_id_rejected:true,same_value_foreign_root_rejected:true,stop_preserves_ids:true,
      hydration_dom_reused:hydrate,hydration_recovery_errors:0,host_commit_attribution:'observed_original_props',host_commits:commits.length,
      independent_commit_mutants_rejected:5,entity_identity:'unproven'},null,2));
  } finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
} finally {fs.rmSync(temporary,{recursive:true,force:true});}
