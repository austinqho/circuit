import assert from 'node:assert/strict';import fs from 'node:fs';import http from 'node:http';
import os from 'node:os';import path from 'node:path';import {createRequire} from 'node:module';import ts from 'typescript';
import {analyzeReact,createReactRuntimeIntegration} from '../../analysis/index.mjs';
const repository=path.resolve(process.argv[2]||'/tmp/producttrace-librechat-autonomous');
const require=createRequire(path.join(repository,'package.json'));const {chromium}=require('playwright');
const build=process.env.PRODUCTTRACE_REACT_BUILD==='production'?'production':'development';
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'react-imperative-runtime-'));
const source=`import * as React from 'react';import * as DOM from 'react-dom';
const left=React.createRef(),right=React.createRef(),other=React.createRef();window.refs={left,right,other};
const LabelContext=React.createContext({label:'default'});
function Handle({id,dep,refValue}){const value=React.useContext(LabelContext);React.useImperativeHandle(refValue,()=>{
  const label=value.label;
  window.factoryCalls.push([id,label]);const result={id,label,send(){window.sent.push(id+':'+label);}};
  window.handles.push(result);return label==='shared'?window.sharedHandle:result;
},[dep]);return <span>{value.label}</span>;}
function App({label,dep,refValue,epoch}){return <LabelContext.Provider value={{label}}><section><Handle key={'left'+epoch} id="left" label={label} dep={dep} refValue={refValue}/>
  <Handle key={'right'+epoch} id="right" label={label} dep={dep} refValue={right}/>
  <button id="read-left" onClick={()=>window.reads.push(left.current)}>read left</button>
  <button id="read-right" onClick={()=>window.reads.push(right.current)}>read right</button>
  <button id="read-other" onClick={()=>window.reads.push(other.current)}>read other</button>
  <button id="same" onClick={()=>window.mount('new',0,left)}>same</button>
  <button id="deps" onClick={()=>window.mount('new',1,left)}>deps</button>
  <button id="ref" onClick={()=>window.mount('ref',1,other)}>ref</button>
  <button id="null" onClick={()=>window.mount('off',1,null)}>null</button>
  <button id="remount" onClick={()=>window.mount('remount',1,left,1)}>remount</button>
  <button id="send" onClick={()=>window.activeRef.current.send()}>send</button>
</section></LabelContext.Provider>;}
window.mount=(label,dep=0,refValue=left,epoch=0)=>{window.activeRef=refValue;DOM.flushSync(()=>window.root.render(<App label={label} dep={dep} refValue={refValue} epoch={epoch}/>));};`;
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
  assert.ok(map.react_semantics.filter(row=>['useImperativeHandle'].includes(row.export)).every(row=>row.package_verification_sha256));
  const transform=integration.instrumentSource('src/App.tsx',source);assert.deepEqual(transform.diagnostics,[]);
  const application=ts.transpileModule(transform.code.replace("import * as React from 'react';",'const React=window.React;')
    .replace("import * as DOM from 'react-dom';",'const DOM=window.ReactDOM;'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.None,jsx:ts.JsxEmit.React}}).outputText;
  const assets={'/runtime.js':fs.readFileSync(new URL('../../dist/producttrace-runtime.js',import.meta.url)),
    '/react.js':fs.readFileSync(path.join(temporary,`node_modules/react/umd/react.${build}.min.js`).replace('.development.min.js','.development.js')),
    '/dom.js':fs.readFileSync(path.join(temporary,`node_modules/react-dom/umd/react-dom.${build}.min.js`).replace('.development.min.js','.development.js'))};
  const html=`<!doctype html><div id="app"></div><script src="/runtime.js"></script><script>
    window.records=[];window.factoryCalls=[];window.handles=[];window.sent=[];window.reads=[];window.sharedHandle={label:"shared"};
    window.recorder=ProductTrace.start(${JSON.stringify(integration.bindings)},{outputMode:'evidence',onRecord:record=>records.push(record)});
    </script><script src="/react.js"></script><script src="/dom.js"></script><script>
    window.root=ReactDOM.createRoot(document.getElementById('app'));${application}mount('initial');</script>`;
  const server=http.createServer((request,response)=>{if(assets[request.url])response.end(assets[request.url]);else{response.setHeader('content-type','text/html');response.end(html);}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
  try {
    browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
    const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    assert.equal(await page.evaluate(()=>factoryCalls.length),2);
    await page.click('#read-left');
    await page.click('#same');assert.equal(await page.evaluate(()=>factoryCalls.length),2);
    assert.equal(await page.evaluate(()=>refs.left.current.label),'initial');
    await page.click('#read-left');
    await page.click('#deps');await page.click('#read-left');await page.click('#read-right');assert.equal(await page.evaluate(()=>factoryCalls.length),4);
    await page.click('#ref');await page.click('#read-other');assert.equal(await page.evaluate(()=>factoryCalls.length),5);
    assert.equal(await page.evaluate(()=>refs.left.current),null);assert.equal(await page.evaluate(()=>refs.other.current.label),'ref');
    await page.click('#null');assert.equal(await page.evaluate(()=>factoryCalls.length),5);assert.equal(await page.evaluate(()=>refs.other.current),null);
    await page.click('#remount');await page.click('#send');await page.click('#read-left');assert.deepEqual(await page.evaluate(()=>sent),['left:remount']);
    assert.equal(await page.evaluate(()=>factoryCalls.length),7);
    const all=await page.evaluate(()=>records);for(const record of all)integration.onRecord(record);
    const products=all.filter(row=>row.operation==='handle_produced');assert.equal(products.length,7);
    for(const record of products){const joined=joinedById.get(record.observation_id);assert.equal(joined.status,'resolved',JSON.stringify({joined,record}));
      assert.equal(joined.runtime.handle_factory.factory_argument,1);assert.equal(joined.runtime.handle_factory.phase,'layout');
      assert.equal(joined.runtime.handle_factory.ref_assignment_proven,false);assert.equal(joined.runtime.handle_factory.ref_cleanup_proven,false);}
    assert.equal(new Set(products.map(row=>row.value_id)).size,7);
    assert.equal(new Set(products.map(row=>row.mount_id)).size,4);
    const contextUses=all.filter(row=>row.operation==='context_value_used');assert.equal(contextUses.length,7);
    for(const product of products){const use=contextUses.find(row=>row.caused_by_invocation_id===product.caused_by_invocation_id);
      assert.ok(use);assert.equal(joinedById.get(use.observation_id).status,'resolved');
      assert.equal(use.render_id,product.render_id);assert.equal(use.instance_id,product.instance_id);}
    const handleReads=all.filter(row=>row.kind==='react_ref' && row.operation==='read' && row.value.kind==='object');
    assert.equal(handleReads.length,6);
    for(const record of handleReads){const provenance=joinedById.get(record.observation_id).runtime.handle_provenance;
      assert.equal(provenance.status,'resolved');assert.equal(provenance.claim,'same_observed_handle_object');
      assert.equal(provenance.ref_assignment_proven,false);}
    const ids=handleReads.map(row=>joinedById.get(row.observation_id).runtime.handle_provenance.factory_observation_id);
    assert.equal(ids[0],ids[1]);assert.notEqual(ids[1],ids[2]);assert.notEqual(ids[2],ids[3]);
    const missingHandleJoins=new Map(),missingHandles=createReactRuntimeIntegration(map,{onJoin:(joined,record)=>missingHandleJoins.set(record.observation_id,joined)});
    for(const record of all.filter(row=>row.operation!=='handle_produced'))missingHandles.onRecord(record);
    for(const record of handleReads)assert.equal(missingHandleJoins.get(record.observation_id).runtime.handle_provenance.reason,'handle_result_unobserved');
    const changedKinds=new Map(),kindMismatch=createReactRuntimeIntegration(map,{onJoin:(joined,record)=>changedKinds.set(record.observation_id,joined)});
    for(const record of all)kindMismatch.onRecord(record.operation==='handle_produced'?{...record,value_kind:'function'}:record);
    for(const record of handleReads)assert.equal(changedKinds.get(record.observation_id).runtime.handle_provenance.reason,'handle_result_kind_mismatch');
    const first=products[0],sibling=products[1];
    const replay=(change,omit)=>{let result;const fresh=createReactRuntimeIntegration(map,{onJoin:(joined,record)=>{if(record.observation_id===first.observation_id)result=joined;}});
      for(const record of all){if(omit && record.invocation_id===first.caused_by_invocation_id)continue;
        fresh.onRecord(record.observation_id===first.observation_id?{...record,...change}:record);}return result;};
    assert.equal(replay({},true).reason,'imperative_handle_invocation_required');
    assert.equal(replay({caused_by_invocation_id:sibling.caused_by_invocation_id}).reason,'imperative_handle_invocation_required');
    assert.equal(replay({value_id:null}).reason,'imperative_handle_result_required');
    assert.equal(replay({value_id:'foreign-session:value'}).reason,'imperative_handle_result_required');
    assert.equal(replay({factory_argument_count:1}).reason,'imperative_handle_arguments_mismatch');
    const latest=products.at(-1);
    assert.equal(integration.joinLifecycle({...latest,observation_id:latest.observation_id+':duplicate',occurrence_id:latest.occurrence_id+':duplicate'}).reason,'imperative_handle_invocation_required');
    assert.equal(integration.joinLifecycle({...first,observation_id:first.observation_id+':after-unmount',occurrence_id:first.occurrence_id+':after-unmount'}).reason,'mount_already_unmounted');
    await page.evaluate(()=>mount('shared',2,refs.left,1));await page.click('#read-left');
    const shared=await page.evaluate(()=>records);for(const record of shared.slice(all.length))integration.onRecord(record);
    const sharedRead=shared.findLast(row=>row.kind==='react_ref' && row.operation==='read');
    assert.equal(joinedById.get(sharedRead.observation_id).runtime.handle_provenance.reason,'handle_result_origin_ambiguous');
    const beforeStop=await page.evaluate(()=>records.length);await page.evaluate(()=>recorder.stop());await page.click('#deps');
    assert.equal(await page.evaluate(()=>records.length),beforeStop);assert.equal(await page.evaluate(()=>refs.left.current.label),'new');
    await page.evaluate(()=>DOM.flushSync(()=>root.unmount()));assert.equal(await page.evaluate(()=>refs.left.current),null);
    assert.equal(await page.evaluate(()=>refs.right.current),null);assert.deepEqual(errors,[]);
    console.log(JSON.stringify({api:'react/useImperativeHandle/18.3.1',build,actual_clicks:13,handle_factory_products:products.length,
      factory_path_verified:true,ref_identity_update:true,null_ref_no_factory:true,unchanged_dependencies_retain:true,
      context_read_to_factory_result:true,handle_ref_reads:handleReads.length,handle_object_provenance:true,
      missing_handle_origin_rejected:true,handle_kind_mismatch_rejected:true,shared_handle_origin_ambiguous:true,
      sibling_and_remount_identity:true,missing_invocation_rejected:true,sibling_invocation_rejected:true,
      duplicate_result_rejected:true,wrong_arguments_rejected:true,stopped_recording_transparent:true,
      ref_assignment_evidence:'unproven',ref_cleanup_evidence:'unproven'},null,2));
  } finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
} finally {fs.rmSync(temporary,{recursive:true,force:true});}
