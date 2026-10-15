import assert from 'node:assert/strict';import fs from 'node:fs';import http from 'node:http';
import os from 'node:os';import path from 'node:path';import {createRequire} from 'node:module';import ts from 'typescript';
import {analyzeReact,createReactRuntimeIntegration} from '../../analysis/index.mjs';
const repository=path.resolve(process.argv[2]||'/tmp/producttrace-librechat-autonomous');
const require=createRequire(path.join(repository,'package.json'));const {chromium}=require('playwright');
const build=process.env.PRODUCTTRACE_REACT_BUILD==='production'?'production':'development';
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'react-context-use-'));
const source=`import * as React from 'react';import * as DOM from 'react-dom';
const initial={label:'initial'};const Context=React.createContext(initial);
function consume(id,value){window.effects.push([id,value.label]);}
function Reader({id}){
  const value=React.useContext(Context);
  const stable=React.useCallback((read=true)=>{if(read)consume(id,value);},[]);
  const current=React.useCallback(()=>{window.objectEffects.push({value});consume(id,value);},[value]);
  window.callbacks[id]={stable,current};
  return <section><button id={id+'-stable'} onClick={()=>stable()}>stable</button>
    <button id={id+'-current'} onClick={current}>current</button></section>;
}
function App({value,epoch}){return <section><Context.Provider value={value}>
  <Reader id="left" key={'left'+epoch}/><Reader id="right" key={'right'+epoch}/>
</Context.Provider></section>;}
window.mount=(value,epoch=0)=>DOM.flushSync(()=>window.root.render(<App value={value} epoch={epoch}/>));
window.initial=initial;`;
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
    window.records=[];window.effects=[];window.objectEffects=[];window.callbacks={};
    window.recorder=ProductTrace.start(${JSON.stringify(integration.bindings)},{outputMode:'evidence',onRecord:record=>records.push(record)});
    </script><script src="/react.js"></script><script src="/dom.js"></script><script>
    window.root=ReactDOM.createRoot(document.getElementById('app'));${application}mount(initial);</script>`;
  const server=http.createServer((request,response)=>{if(assets[request.url])response.end(assets[request.url]);else{response.setHeader('content-type','text/html');response.end(html);}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
  try {
    browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
    const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    for(const id of ['left-stable','right-stable','left-current'])await page.click('#'+id);
    const first=await page.evaluate(()=>records.length);
    await page.evaluate(()=>{window.original=callbacks.left.stable;mount({label:'updated'});});
    for(const id of ['left-stable','right-stable','left-current','right-current'])await page.click('#'+id);
    const beforeSkip=await page.evaluate(()=>records.filter(row=>row.operation==='context_value_used').length);
    await page.evaluate(()=>callbacks.left.stable(false));
    assert.equal(await page.evaluate(()=>records.filter(row=>row.operation==='context_value_used').length),beforeSkip,
      'a potential capture in the skipped branch is not an executed read');
    assert.deepEqual(await page.evaluate(()=>effects),[['left','initial'],['right','initial'],['left','initial'],
      ['left','initial'],['right','initial'],['left','updated'],['right','updated']]);
    assert.equal(await page.evaluate(()=>objectEffects[0].value===initial),true);
    await page.evaluate(()=>mount({label:'remounted'},1));await page.click('#left-stable');
    await page.evaluate(()=>{DOM.flushSync(()=>root.render(null));original();});
    assert.deepEqual(await page.evaluate(()=>effects.slice(-2)),[['left','remounted'],['left','initial']]);
    const all=await page.evaluate(()=>records);for(const record of all)integration.onRecord(record);
    const uses=all.filter(row=>row.operation==='context_value_used');assert.equal(uses.length,12);
    for(const record of uses){const joined=joinedById.get(record.observation_id);assert.equal(joined.status,'resolved',JSON.stringify({joined,record}));
      assert.equal(joined.runtime.context_use.claim,'observed_binding_read');assert.equal(joined.runtime.context_use.downstream_effect_proven,false);}
    const leftOriginal=uses[0],rightOriginal=uses[1];
    assert.notEqual(leftOriginal.instance_id,rightOriginal.instance_id);
    const later=uses.filter(row=>all.indexOf(row)>=first);
    assert.equal(later[0].context_use.read_observation_id,leftOriginal.context_use.read_observation_id);
    assert.equal(later[1].context_use.read_observation_id,rightOriginal.context_use.read_observation_id);
    assert.equal(joinedById.get(uses.at(-1).observation_id).runtime.owner_lifecycle,'unmounted');
    const reject=change=>{let result;const fresh=createReactRuntimeIntegration(map,{onJoin:(joined,record)=>{if(record.observation_id===leftOriginal.observation_id)result=joined;}});
      for(const record of all)fresh.onRecord(record.observation_id===leftOriginal.observation_id?{...record,context_use:{...record.context_use,...change}}:record);return result.reason;};
    assert.equal(reject({read_observation_id:rightOriginal.context_use.read_observation_id}),'context_use_read_origin_required');
    assert.equal(reject({read_observation_id:'missing'}),'context_use_read_origin_required');
    assert.equal(reject({value_identity:'foreign'}),'context_use_value_mismatch');
    assert.equal(reject({read_id:'foreign'}),'context_use_source_mismatch');
    assert.equal(reject({value_matches:false}),'context_use_value_mismatch');
    const beforeStop=await page.evaluate(()=>records.length);
    await page.evaluate(()=>{recorder.stop();original();});
    assert.equal(await page.evaluate(()=>records.length),beforeStop);assert.deepEqual(errors,[]);
    console.log(JSON.stringify({apis:['react/useContext/18.3.1','react/useCallback/18.3.1'],build,
      actual_clicks:8,executed_context_reads:uses.length,retained_context_value_use:true,
      skipped_branch_no_read:true,shorthand_preserved:true,sibling_origin_rejected:true,
      missing_read_rejected:true,substituted_value_rejected:true,remount_and_unmounted_callback:true,
      stopped_recording_transparent:true},null,2));
  } finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
} finally {fs.rmSync(temporary,{recursive:true,force:true});}
