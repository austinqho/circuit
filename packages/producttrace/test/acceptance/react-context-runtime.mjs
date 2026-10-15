import assert from 'node:assert/strict';import fs from 'node:fs';import http from 'node:http';
import os from 'node:os';import path from 'node:path';import {createRequire} from 'node:module';import ts from 'typescript';
import {analyzeReact,createReactRuntimeIntegration} from '../../analysis/index.mjs';
const repository=path.resolve(process.argv[2]||'/tmp/producttrace-librechat-autonomous');
const require=createRequire(path.join(repository,'package.json'));const {chromium}=require('playwright');
const build=process.env.PRODUCTTRACE_REACT_BUILD==='production'?'production':'development';
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'react-context-runtime-'));
const source=`import * as React from 'react';import * as DOM from 'react-dom';
const Context=React.createContext('default');const Other=React.createContext('other default');
const objectDefault={same:true};const ObjectContext=React.createContext(objectDefault);
function ObjectReader(){const value=React.useContext(ObjectContext);window.objectRead=value;return <button id="object-read">object</button>;}
window.objectMount=(value,provided)=>DOM.flushSync(()=>window.root.render(provided?<ObjectContext.Provider value={value}><ObjectReader/></ObjectContext.Provider>:<ObjectReader/>));
function emit(id,value){window.effects.push([id,value===undefined?'undefined':value]);}
function Reader({id}){const value=React.useContext(Context);return <button id={id} onClick={()=>React.startTransition(()=>emit(id,value))}>{id}</button>;}
function Parent(){const value=React.useContext(Context);return <section>
  <button id="parent" onClick={()=>emit('parent',value)}>parent</button>
  <Context.Provider value="below"><Reader id="below"/></Context.Provider>
</section>;}
function App({value}){return <section>
  <Context.Provider value={value}><Reader id="outer"/>
    <Context.Provider value="inner"><Reader id="inner"/></Context.Provider>
    <Other.Provider value="wrong context"><Reader id="foreign"/></Other.Provider>
    <Context.Consumer>{selected=><button id="consumer" onClick={()=>emit('consumer',selected)}>consumer</button>}</Context.Consumer>
  </Context.Provider>
  <Reader id="default"/><Parent/>
</section>;}
window.deep=()=>{let child=<Reader id="deep"/>;for(let i=0;i<210;i++)child=<div>{child}</div>;DOM.flushSync(()=>window.root.render(<Context.Provider value="deep value">{child}</Context.Provider>));};
window.mount=value=>DOM.flushSync(()=>window.root.render(<App value={value}/>));`;
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
    window.root=ReactDOM.createRoot(document.getElementById('app'));${application}mount('outer');</script>`;
  const server=http.createServer((request,response)=>{if(assets[request.url])response.end(assets[request.url]);else{response.setHeader('content-type','text/html');response.end(html);}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
  try {
    browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
    const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    for(const id of ['outer','inner','foreign','consumer','default','parent','below'])await page.click('#'+id);
    assert.deepEqual(await page.evaluate(()=>effects),[['outer','outer'],['inner','inner'],['foreign','outer'],
      ['consumer','outer'],['default','default'],['parent','default'],['below','below']]);
    const first=await page.evaluate(()=>records);for(const record of first)integration.onRecord(record);
    const creations=first.filter(row=>row.kind==='react_context_origin');assert.ok(creations.length>=3);
    for(const record of creations)assert.equal(joinedById.get(record.observation_id).status,'resolved');
    const reads=first.filter(row=>row.kind==='react_lifecycle' && (row.operation==='value_read' || row.protocol_member==='Consumer' && row.operation==='callback_invoked'));
    assert.ok(reads.length>=(build==='development'?7:6));
    for(const record of reads) {
      const joined=joinedById.get(record.observation_id);assert.equal(joined.status,'resolved',JSON.stringify(joined));
      assert.equal(joined.runtime.context_rule_selection.operation,record.context_default_used?'read_default':'read_provider');
      assert.equal(joined.runtime.context_rule_selection.notification_causality_proven,false);
      if(record.context_default_used)assert.equal(joined.runtime.context_rule_selection.default_value_proven,true);
    }
    assert.ok(reads.some(row=>row.context_value.value==='inner'));
    assert.ok(reads.some(row=>row.context_default_used && row.context_value.value==='default'));
    const consumerObserved=reads.some(row=>row.protocol_member==='Consumer');
    const frontier=first.find(row=>row.kind==='react_frontier');
    if(build==='development')assert.equal(consumerObserved,true);
    else {assert.equal(consumerObserved,false);assert.equal(joinedById.get(frontier.observation_id).reason,'consumer_render_owner_unobserved');
      assert.equal(joinedById.get(frontier.observation_id).runtime.owner_proven,false);
      assert.equal(integration.joinFrontier({...frontier,callback_source_id:'foreign'}).reason,'invalid_react_frontier');}
    const provided=reads.find(row=>!row.context_default_used && row.context_value.value==='outer');
    const rejected=change=>{let result;const fresh=createReactRuntimeIntegration(map,{onJoin:(joined,record)=>{if(record.observation_id===provided.observation_id)result=joined;}});
      for(const record of first)fresh.onRecord(record===provided?{...record,...change}:record);
      return result.reason;};
    assert.equal(rejected({context_default_used:true}),'context_default_provider_contamination');
    assert.equal(rejected({provider_value:{encoding:'primitive',value:'wrong'}}),'context_provider_value_mismatch');
    assert.equal(rejected({context_id:'different'}),'context_identity_or_value_required');
    assert.equal(rejected({context_default_used:null}),'context_provider_status_required');
    await page.evaluate(()=>mount(undefined));
    for(const id of ['outer','inner','consumer','default'])await page.click('#'+id);
    assert.deepEqual(await page.evaluate(()=>effects.slice(-4)),[['outer','undefined'],['inner','inner'],['consumer','undefined'],['default','default']]);
    const all=await page.evaluate(()=>records);for(const record of all.slice(first.length))integration.onRecord(record);
    const next=all.slice(first.length).filter(row=>row.kind==='react_lifecycle' && row.operation==='value_read');
    assert.ok(next.some(row=>row.context_value.encoding==='redacted' && row.context_default_used===false));
    for(const record of next)assert.equal(joinedById.get(record.observation_id).status,'resolved',JSON.stringify(joinedById.get(record.observation_id)));
    let offset=all.length;const objectReads=[];
    for(const mode of ['default','provided','default','function']) {
      await page.evaluate(mode=>objectMount(mode==='function'?function storedFunction(){throw Error('must not invoke');}:{same:true},mode==='provided'||mode==='function'),mode);
      const objectRecords=await page.evaluate(()=>records);for(const record of objectRecords.slice(offset))integration.onRecord(record);
      const read=objectRecords.slice(offset).find(row=>row.kind==='react_lifecycle' && row.operation==='value_read');assert.ok(read);
      const proof=joinedById.get(read.observation_id);assert.equal(proof.status,'resolved',JSON.stringify(proof));
      assert.equal(proof.runtime.context_rule_selection.object_value_identity_proven,true);
      assert.equal(proof.runtime.context_rule_selection.default_value_proven,mode==='default');objectReads.push(read);offset=objectRecords.length;
    }
    assert.notEqual(objectReads[0].context_value_proof.observed_value.identity,objectReads[1].context_value_proof.observed_value.identity);
    assert.equal(objectReads[0].context_value_proof.observed_value.identity,objectReads[2].context_value_proof.observed_value.identity);
    const recorded=await page.evaluate(()=>records),target=objectReads[1];
    const replay=change=>{let result;const fresh=createReactRuntimeIntegration(map,{onJoin:(joined,record)=>{if(record.observation_id===target.observation_id)result=joined;}});
      for(const record of recorded)fresh.onRecord(record.observation_id===target.observation_id?{...record,context_value_proof:{...record.context_value_proof,...change}}:record);return result;};
    assert.equal(replay({context_object_id:'foreign'}).reason,'context_creation_origin_required');
    assert.equal(replay({observed_value:objectReads[0].context_value_proof.observed_value}).reason,'context_selected_value_mismatch');
    let missingResult;const missing=createReactRuntimeIntegration(map,{onJoin:(joined,record)=>{if(record.observation_id===target.observation_id)missingResult=joined;}});
    for(const record of recorded.filter(row=>row.kind!=='react_context_origin'))missing.onRecord(record);
    assert.equal(missingResult.reason,'context_creation_origin_required');
    const beforeDeep=recorded.length;await page.evaluate(()=>{deep();deep();});
    const deepRecords=await page.evaluate(()=>records);for(const record of deepRecords.slice(beforeDeep))integration.onRecord(record);
    const deepRead=deepRecords.slice(beforeDeep).find(row=>row.kind==='react_lifecycle' && row.operation==='value_read');
    assert.equal(deepRead.context_default_used,null);assert.equal(joinedById.get(deepRead.observation_id).reason,'context_ancestry_incomplete');
    const beforeStop=await page.evaluate(()=>records.length);await page.evaluate(()=>recorder.stop());await page.click('#deep');
    assert.equal(await page.evaluate(()=>records.length),beforeStop);assert.deepEqual(errors,[]);
    console.log(JSON.stringify({apis:['react/createContext/18.3.1','react/useContext/18.3.1'],build,installed_source_attested:true,
      actual_clicks:11,context_origins_verified:creations.length,context_rule_provider_selection:true,nested_and_foreign_providers:true,explicit_undefined:true,
      below_provider_not_ancestor:true,consumer_callback:consumerObserved,consumer_owner_frontier:!consumerObserved,
      incomplete_ancestry_rejected:true,wrong_provider_evidence_rejected:true,
      stopped_recording_transparent:true,default_and_object_value_identity:'verified_scoped',missing_creation_rejected:true,wrong_value_identity_rejected:true,notification_causality:'unproven'},null,2));
  } finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
} finally {fs.rmSync(temporary,{recursive:true,force:true});}
