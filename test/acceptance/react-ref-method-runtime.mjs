import assert from 'node:assert/strict';import fs from 'node:fs';import http from 'node:http';
import os from 'node:os';import path from 'node:path';import {createRequire} from 'node:module';import ts from 'typescript';
import {analyzeReact,createReactRuntimeIntegration} from '../../analysis/index.mjs';
const repository=path.resolve(process.argv[2]||'/tmp/producttrace-librechat-autonomous');
const require=createRequire(path.join(repository,'package.json'));const {chromium}=require('playwright');
const build=process.env.PRODUCTTRACE_REACT_BUILD==='production'?'production':'development';
const named=process.env.PRODUCTTRACE_REACT_REF_NAMED==='1';
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'react-ref-method-runtime-'));
const reactImport=named?"import {createRef,useRef} from 'react';":"import * as React from 'react';";
const createRefCall=named?'createRef':'React.createRef',useRefCall=named?'useRef':'React.useRef';
const source=`${reactImport}import * as DOM from 'react-dom';
const plain=${createRefCall}();const plainAlias=plain;
function plainCallback(value){window.effects.push(['plain',value,this===plain]);}
plain.current=plainCallback;
function Plain(){return <button id="plain-invoke" onClick={()=>(plainAlias['current'])('plain button')}>plain</button>;}
function Item({name}) {
  function first(value){window.effects.push([name,'first',value,this===box]);return value;}
  function second(value){window.effects.push([name,'second',value,this===box]);return value;}
  const box=${useRefCall}(first);const boxAlias=box;window.boxes[name]=box;window.functions[name]={first,second};
  return <section>
    <button id={name+'-invoke'} onClick={()=>boxAlias.current('button')}>invoke</button>
    <button id={name+'-replace'} onClick={()=>{boxAlias['current']=second;}}>replace</button>
    <button id={name+'-argument'} onClick={()=>(boxAlias.current)((box.current=second,'swap'))}>argument</button>
    <button id={name+'-failure'} onClick={()=>{try{box.current(window.argument());}catch(error){window.caught=error;}}}>failure</button>
  </section>;
}
window.mount=()=>DOM.flushSync(()=>window.root.render(<section><Item name="a"/><Item name="b"/><Plain/></section>));`;
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
    .replace("import {createRef,useRef} from 'react';",'const {createRef,useRef}=window.React;')
    .replace("import * as DOM from 'react-dom';",'const DOM=window.ReactDOM;'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.None,jsx:ts.JsxEmit.React}}).outputText;
  const assets={'/runtime.js':fs.readFileSync(new URL('../../dist/producttrace-runtime.js',import.meta.url)),
    '/react.js':fs.readFileSync(path.join(temporary,`node_modules/react/umd/react.${build}.min.js`).replace('.development.min.js','.development.js')),
    '/dom.js':fs.readFileSync(path.join(temporary,`node_modules/react-dom/umd/react-dom.${build}.min.js`).replace('.development.min.js','.development.js'))};
  const html=`<!doctype html><div id="app"></div><script src="/runtime.js"></script><script>
    window.records=[];window.effects=[];window.boxes={};window.functions={};window.getterReads=0;window.argument=()=>7;
    window.recorder=ProductTrace.start(${JSON.stringify(integration.bindings)},{outputMode:'evidence',onRecord:record=>records.push(record)});
    </script><script src="/react.js"></script><script src="/dom.js"></script><script>
    window.root=ReactDOM.createRoot(document.getElementById('app'));${application}mount();</script>`;
  const server=http.createServer((request,response)=>{if(assets[request.url])response.end(assets[request.url]);else{response.setHeader('content-type','text/html');response.end(html);}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
  try {
    browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
    const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.click('#a-invoke');await page.click('#b-argument');await page.click('#b-invoke');
    await page.click('#a-replace');await page.click('#a-invoke');
    assert.deepEqual(await page.evaluate(()=>effects),[
      ['a','first','button',true],['b','first','swap',true],['b','second','button',true],['a','second','button',true]]);
    const initial=await page.evaluate(()=>records);for(const record of initial)integration.onRecord(record);
    const calls=initial.filter(row=>row.kind==='react_ref' && row.operation==='invoke');assert.equal(calls.length,4);
    for(const record of calls) {
      const joined=integration.joinRef(record);assert.equal(joined.status,'resolved',JSON.stringify(joined));
      assert.equal(joined.runtime.action_link.status,'resolved',JSON.stringify(joined));
      assert.equal(joined.runtime.callback_path.status,'resolved',JSON.stringify(joined));
      assert.ok(joined.runtime.callback_path.source_edge_ids.length>0);
      const target=map.nodes.find(row=>row.id===joined.runtime.callback_path.source_id);
      assert.ok(target.text.startsWith(record===calls[0] || record===calls[1]?'function first':'function second'));
    }
    assert.notEqual(calls[0].ref_id,calls[1].ref_id);
    const substituted={...calls[0],callback:calls[3].callback};
    assert.equal(integration.joinRef(substituted).reason,'ref_method_callee_source_mismatch');
    // A different valid source origin must not replace the function identified
    // by the read. The observer records both identities for the exact callee.
    assert.equal(integration.joinRef({...calls[0],read_observation_id:calls[1].read_observation_id}).reason,'ref_method_read_required');
    assert.equal(integration.joinRef({...calls[0],callback:{...calls[0].callback,callback_identity_id:'foreign'}}).reason,'ref_method_callee_source_mismatch');
    await page.evaluate(()=>{Object.defineProperty(boxes.a,'current',{configurable:true,get(){getterReads++;return functions.a.first;}});});
    await page.click('#a-invoke');assert.equal(await page.evaluate(()=>getterReads),1);
    await page.evaluate(()=>{window.boom={bad:true};window.argument=()=>{throw boom;};});
    const beforeArgument=await page.evaluate(()=>records.filter(row=>row.operation==='invoke').length);
    await page.click('#a-failure');assert.equal(await page.evaluate(()=>caught===boom),true);
    assert.equal(await page.evaluate(()=>records.filter(row=>row.operation==='invoke').length),beforeArgument);
    assert.equal(await page.evaluate(()=>getterReads),2);
    await page.evaluate(()=>{Object.defineProperty(boxes.a,'current',{get(){getterReads++;throw boom;},configurable:true});window.argument=()=>7;});
    await page.click('#a-failure');assert.equal(await page.evaluate(()=>caught===boom),true);
    assert.equal(await page.evaluate(()=>records.filter(row=>row.operation==='invoke').length),beforeArgument);
    await page.evaluate(()=>{Object.defineProperty(boxes.a,'current',{value:null,writable:true,configurable:true});});
    await page.click('#a-failure');assert.equal(await page.evaluate(()=>caught instanceof TypeError),true);
    await page.evaluate(()=>{boxes.a.current=function(value){effects.push(['external',value,this===boxes.a]);};});
    await page.click('#a-invoke');assert.deepEqual(await page.evaluate(()=>effects.at(-1)),['external','button',true]);
    await page.click('#plain-invoke');assert.deepEqual(await page.evaluate(()=>effects.at(-1)),['plain','plain button',true]);
    const all=await page.evaluate(()=>records);for(const record of all)integration.onRecord(record);
    const plainCall=all.find(row=>row.kind==='react_ref' && row.operation==='invoke' && row.export==='createRef');
    assert.equal(integration.joinRef(plainCall).runtime.callback_path.status,'resolved');
    assert.equal(integration.joinRef(plainCall).runtime.action_link.status,'resolved');
    const unknown=all.filter(row=>row.kind==='react_ref' && row.operation==='invoke' && row.export==='useRef').slice(-2);
    for(const record of unknown)assert.equal(integration.joinRef(record).runtime.callback_path.reason,'ref_callable_source_unobserved');
    const missingSource=createReactRuntimeIntegration(map);for(const record of initial.filter(row=>row.kind!=='react_callback_source'))missingSource.onRecord(record);
    assert.equal(missingSource.joinRef(calls[0]).reason,'ref_callable_origin_required');
    const beforeStop=await page.evaluate(()=>records.length);await page.evaluate(()=>recorder.stop());await page.click('#a-invoke');
    assert.equal(await page.evaluate(()=>records.length),beforeStop);assert.deepEqual(errors,[]);
    console.log(JSON.stringify({apis:['react/useRef/18.3.1','react/createRef/18.3.1'],build,installed_source_attested:true,actual_clicks:11,
      import_form:named?'named':'namespace',immutable_ref_aliases:true,dot_bracket_and_parenthesized_reference_calls:true,
      ref_callback_source_path:true,receiver_and_argument_order:true,getter_argument_failures:true,
      unknown_target_abstention:true,missing_source_rejected:true,sibling_identity:true,stopped_recording_transparent:true},null,2));
  } finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
} finally {fs.rmSync(temporary,{recursive:true,force:true});}
