import assert from 'node:assert/strict';import fs from 'node:fs';import http from 'node:http';
import os from 'node:os';import path from 'node:path';import {createRequire} from 'node:module';import ts from 'typescript';
import {analyzeReact,createReactRuntimeIntegration} from '../../analysis/index.mjs';
const repository=path.resolve(process.argv[2]||'/tmp/producttrace-librechat-autonomous');
const require=createRequire(path.join(repository,'package.json'));const {chromium}=require('playwright');
const build=process.env.PRODUCTTRACE_REACT_BUILD==='production'?'production':'development';
const strict=process.env.PRODUCTTRACE_REACT_REF_STRICT==='1';
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'react-ref-runtime-'));
const source=`import * as React from 'react';import * as DOM from 'react-dom';
const permanent=React.createRef();
function send(value){window.effects.push(value);}
function Item({name,initial}) {
  const cell=React.useRef(initial);const host=React.useRef(null);const allocated=React.createRef();
  const read=()=>send(cell.current);
  window.savedReaders[name]=read;
  window.currentRefs[name]={cell,host,allocated};
  return <section>
    <button id={name+'-host'} ref={host}>host</button>
    <button id={name+'-write'} onClick={()=>{cell.current=name+':saved';}}>write</button>
    <button id={name+'-read'} onClick={read}>read</button>
    <button id={name+'-allocated'} onClick={()=>{allocated.current=name+':allocated';send(allocated.current);}}>allocated</button>
    <button id={name+'-permanent'} onClick={()=>{permanent.current=name+':permanent';send(permanent.current);}}>permanent</button>
  </section>;
}
window.mount=(initial,key='same')=>DOM.flushSync(()=>window.root.render(${strict?'React.createElement(React.StrictMode,null,':''}<section key={key}>
  <button id="permanent-host" ref={permanent}>permanent host</button>
  <Item name="a" initial={initial}/><Item name="b" initial={initial}/>
</section>${strict?')':''}));`;
try {
  fs.mkdirSync(path.join(temporary,'src'));fs.mkdirSync(path.join(temporary,'node_modules'));
  fs.writeFileSync(path.join(temporary,'src/App.tsx'),source);
  const pkg={name:'ref-acceptance',private:true,dependencies:{react:'18.3.1','react-dom':'18.3.1'}};
  fs.writeFileSync(path.join(temporary,'package.json'),JSON.stringify(pkg));
  const lock=JSON.parse(fs.readFileSync(path.join(repository,'package-lock.json')));
  fs.writeFileSync(path.join(temporary,'package-lock.json'),JSON.stringify({name:pkg.name,lockfileVersion:3,packages:{'':pkg,
    'node_modules/react':lock.packages['node_modules/react'],'node_modules/react-dom':lock.packages['node_modules/react-dom']}}));
  for(const name of ['react','react-dom'])fs.symlinkSync(path.join(repository,'node_modules',name),path.join(temporary,'node_modules',name));
  const map=analyzeReact({repository:temporary}),integration=createReactRuntimeIntegration(map);
  assert.ok(map.react_semantics.filter(row=>['createRef','useRef'].includes(row.export)).every(row=>row.package_verification_sha256));
  const transform=integration.instrumentSource('src/App.tsx',source);assert.deepEqual(transform.diagnostics,[]);
  const application=ts.transpileModule(transform.code.replace("import * as React from 'react';",'const React=window.React;')
    .replace("import * as DOM from 'react-dom';",'const DOM=window.ReactDOM;'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.None,jsx:ts.JsxEmit.React}}).outputText;
  const assets={'/runtime.js':fs.readFileSync(new URL('../../dist/producttrace-runtime.js',import.meta.url)),
    '/react.js':fs.readFileSync(path.join(temporary,`node_modules/react/umd/react.${build}.min.js`).replace('.development.min.js','.development.js')),
    '/dom.js':fs.readFileSync(path.join(temporary,`node_modules/react-dom/umd/react-dom.${build}.min.js`).replace('.development.min.js','.development.js'))};
  const html=`<!doctype html><div id="app"></div><script src="/runtime.js"></script><script>
    window.records=[];window.effects=[];window.savedReaders={};window.currentRefs={};window.getterReads=0;window.setterWrites=0;
    window.recorder=ProductTrace.start(${JSON.stringify(integration.bindings)},{outputMode:'evidence',onRecord:record=>records.push(record)});
    </script><script src="/react.js"></script><script src="/dom.js"></script><script>
    window.root=ReactDOM.createRoot(document.getElementById('app'));${application}mount('initial');</script>`;
  const server=http.createServer((request,response)=>{if(assets[request.url])response.end(assets[request.url]);else{response.setHeader('content-type','text/html');response.end(html);}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
  try {
    browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
    const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.evaluate(()=>{window.originalRefs={a:currentRefs.a,b:currentRefs.b};});
    for(const name of ['a-write','b-write','a-read','b-read','a-allocated','b-permanent'])await page.click('#'+name);
    const first=await page.evaluate(()=>({records,effects}));assert.deepEqual(errors,[]);
    assert.deepEqual(first.effects,['a:saved','b:saved','a:allocated','b:permanent']);
    for(const record of first.records)integration.onRecord(record);
    const refs=first.records.filter(row=>row.kind==='react_ref');assert.ok(refs.length>=13);
    for(const record of refs)assert.equal(integration.joinRef(record).status,'resolved',JSON.stringify(integration.joinRef(record)));
    const initializedCandidates=refs.filter(row=>row.operation==='returned'&&row.export==='useRef'&&!row.previously_returned);
    const initialized=initializedCandidates.filter(row=>integration.joinRef(row).runtime.initialization_proof==='observed_initial_cell_on_committed_owner');
    assert.equal(initialized.length,4);if(strict&&build==='development')assert.ok(initializedCandidates.length>initialized.length);
    assert.ok(initializedCandidates.filter(row=>!initialized.includes(row)).every(row=>integration.joinRef(row).runtime.initialization_proof==='initial_cell_observed_owner_commit_unproven'));
    const origins=initialized.filter(row=>row.current?.kind==='string');assert.equal(origins.length,2);
    const hookCommits=refs.filter(row=>row.operation==='hook_committed');assert.equal(hookCommits.length,4);
    for(const record of hookCommits){const joined=integration.joinRef(record);assert.equal(joined.runtime.commit_proven,true);assert.equal(joined.runtime.hook_commit_claim,'observed_hook_ref_committed');}
    const wrongHookRenderer=structuredClone(hookCommits[0]);wrongHookRenderer.renderer.render_id='foreign-render';
    assert.equal(integration.joinRef(wrongHookRenderer).reason,'ref_hook_commit_identity_required');
    const wrongHookRef=structuredClone(hookCommits[0]);wrongHookRef.ref_id=hookCommits.find(row=>row.ref_id!==wrongHookRef.ref_id).ref_id;
    assert.equal(integration.joinRef(wrongHookRef).reason,'ref_origin_observation_required');
    const wrongHookValue=structuredClone(hookCommits[0]);wrongHookValue.value=structuredClone(hookCommits.find(row=>row.ref_id!==wrongHookValue.ref_id).value);
    assert.equal(integration.joinRef(wrongHookValue).reason,'ref_hook_commit_identity_required');
    assert.notEqual(origins[0].ref_id,origins[1].ref_id);assert.notEqual(origins[0].owner.instance_id,origins[1].owner.instance_id);
    const accesses=refs.filter(row=>['read','write'].includes(row.operation));assert.equal(accesses.length,8);
    for(const record of accesses)assert.equal(integration.joinRef(record).runtime.action_link.status,'resolved',JSON.stringify({record,joined:integration.joinRef(record)}));
    const wrong=structuredClone(accesses.find(row=>row.export==='useRef'));wrong.ref_id=origins.find(row=>row.ref_id!==wrong.ref_id).ref_id;
    assert.equal(integration.joinRef(wrong).reason,'ref_origin_observation_required');
    const wrongOwner=structuredClone(accesses.find(row=>row.export==='useRef'));
    wrongOwner.owner.instance_id='foreign-instance';assert.equal(integration.joinRef(wrongOwner).reason,'ref_origin_owner_mismatch');
    const wrongPair=structuredClone(accesses.find(row=>row.export==='useRef'));
    const otherOrigin=origins.find(row=>row.ref_id!==wrongPair.ref_id);wrongPair.ref_id=otherOrigin.ref_id;wrongPair.origin_observation_id=otherOrigin.observation_id;
    assert.equal(integration.joinRef(wrongPair).reason,'ref_origin_owner_mismatch','a valid sibling origin cannot replace this cell owner');
    const wrongAction=structuredClone(accesses[0]);wrongAction.action=accesses.find(row=>row.source_access_id!==wrongAction.source_access_id).action;
    assert.equal(integration.joinRef(wrongAction).runtime.action_link.status,'unresolved');
    const noOrigin=createReactRuntimeIntegration(map);assert.equal(noOrigin.joinRef(accesses[0]).reason,'ref_origin_observation_required');
    const wrongInitial=structuredClone(initialized[0]);wrongInitial.current=structuredClone(initialized.find(row=>row.current.identity!==wrongInitial.current.identity).current);
    assert.equal(createReactRuntimeIntegration(map).joinRef(wrongInitial).reason,'ref_initial_cell_mismatch');
    const attachments=refs.filter(row=>row.operation==='host_attached');assert.equal(attachments.length,3);
    assert.equal(attachments.filter(row=>row.export==='useRef').length,2);assert.equal(attachments.filter(row=>row.export==='createRef').length,1);
    for(const record of attachments){const joined=integration.joinRef(record);assert.equal(joined.runtime.commit_proven,true);assert.equal(joined.runtime.attachment_claim,'observed_ref_attached_to_committed_host');}
    const wrongAttachmentRef=structuredClone(attachments[0]);wrongAttachmentRef.ref_id=origins[0].ref_id===wrongAttachmentRef.ref_id?origins[1].ref_id:origins[0].ref_id;
    assert.equal(integration.joinRef(wrongAttachmentRef).reason,'ref_origin_observation_required');
    const wrongAttachmentRenderer=structuredClone(attachments[0]);delete wrongAttachmentRenderer.renderer.commit_id;
    assert.equal(integration.joinRef(wrongAttachmentRenderer).reason,'ref_host_commit_identity_required');
    const wrongAttachmentValue=structuredClone(attachments[0]);wrongAttachmentValue.value=structuredClone(attachments[1].value);
    assert.equal(integration.joinRef(wrongAttachmentValue).reason,'ref_host_attachment_conflict');
    await page.evaluate(()=>mount('changed input'));
    assert.equal(await page.evaluate(()=>currentRefs.a.cell===originalRefs.a.cell && currentRefs.b.cell===originalRefs.b.cell),true);
    assert.equal(await page.evaluate(()=>currentRefs.a.allocated!==originalRefs.a.allocated),true);
    await page.click('#a-read');assert.equal(await page.evaluate(()=>effects.at(-1)),'a:saved');
    await page.evaluate(()=>{window.originalSavedReader=savedReaders.a;});
    await page.evaluate(()=>mount('remount input','new mount'));
    assert.equal(await page.evaluate(()=>currentRefs.a.cell!==originalRefs.a.cell),true);
    await page.click('#a-read');assert.equal(await page.evaluate(()=>effects.at(-1)),'remount input');
    await page.evaluate(()=>originalSavedReader());assert.equal(await page.evaluate(()=>effects.at(-1)),'a:saved');
    const escaped=await page.evaluate(()=>records.filter(row=>row.kind==='react_ref' && row.operation==='read').at(-1));
    assert.equal(escaped.ref_id,origins[0].ref_id,'the escaped reader continues reading its original ref object');assert.equal(escaped.action,null);
    await page.evaluate(()=>{Object.defineProperty(currentRefs.a.cell,'current',{configurable:true,
      get(){getterReads++;return 'getter value';},set(value){setterWrites++;}});});
    await page.click('#a-write');assert.equal(await page.evaluate(()=>getterReads),0);assert.equal(await page.evaluate(()=>setterWrites),1);
    await page.click('#a-read');assert.equal(await page.evaluate(()=>getterReads),1);assert.equal(await page.evaluate(()=>effects.at(-1)),'getter value');
    await page.evaluate(()=>mount('ignored again','new mount'));
    assert.equal(await page.evaluate(()=>getterReads),1,'return observation must not execute the changed property getter');
    const all=await page.evaluate(()=>records);for(const record of all)integration.onRecord(record);
    for(const record of all.filter(row=>row.kind==='react_ref'))assert.equal(integration.joinRef(record).status,'resolved',JSON.stringify({record,joined:integration.joinRef(record)}));
    const returned=all.filter(row=>row.kind==='react_ref' && row.operation==='returned' && row.export==='useRef');
    assert.ok(returned.some(row=>row.previously_returned));assert.ok(returned.some(row=>row.frontier==='ref_data_property_unobserved'));
    assert.ok(returned.filter(row=>row.previously_returned).every(row=>integration.joinRef(row).runtime.initialization_proof==='retained_cell_from_accepted_origin'));
    const beforeStop=await page.evaluate(()=>records.length);await page.evaluate(()=>recorder.stop());await page.click('#a-read');
    assert.equal(await page.evaluate(()=>records.length),beforeStop);assert.equal(await page.evaluate(()=>effects.at(-1)),'getter value');assert.deepEqual(errors,[]);
    console.log(JSON.stringify({apis:['react/createRef/18.3.1','react/useRef/18.3.1'],build,installed_source_attested:true,
      creation_read_write_paths:true,actual_clicks:10,strict,sibling_ref_identity:true,stable_hook_identity:true,new_createRef_each_call:true,
      remount_and_escaped_reader:true,native_click_link:true,wrong_ref_and_action_rejected:true,
      getter_setter_once:true,stopped_recording_transparent:true,host_attachment_and_write_provenance:true,
      host_attachment_mutants_rejected:3,initialization_lifecycle_boundaries:true,wrong_initial_value_rejected:true,
      hook_commit_mutants_rejected:3,
      initialization_and_commit_causality:'committed_initial_cell_and_host_attachment_proven'},null,2));
  } finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
} finally {fs.rmSync(temporary,{recursive:true,force:true});}
