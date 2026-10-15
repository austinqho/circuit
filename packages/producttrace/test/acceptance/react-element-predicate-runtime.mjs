import assert from 'node:assert/strict';import fs from 'node:fs';import http from 'node:http';
import os from 'node:os';import path from 'node:path';import {createRequire} from 'node:module';import ts from 'typescript';
import {analyzeReact,createReactRuntimeIntegration} from '../../analysis/index.mjs';
const repository=path.resolve(process.argv[2]||'/tmp/producttrace-librechat-autonomous');
const require=createRequire(path.join(repository,'package.json'));const {chromium}=require('playwright');
const build=process.env.PRODUCTTRACE_REACT_BUILD==='production'?'production':'development';
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'react-predicate-runtime-'));
const source=`import * as React from 'react';import * as DOM from 'react-dom';
function accept(){window.effects.push('element');}function reject(){window.effects.push('other');}
function App(){return <section><button id="check" type="button" onClick={()=>{
  if(React.isValidElement(window.candidate)){accept();}else{reject();}
}}>check candidate</button><button id="alias" type="button" onClick={()=>{
  const original=React.isValidElement(window.candidate);const valid=original;
  if(!valid){reject();}else{accept();}
}}>check alias</button></section>;}
window.readThrowing=()=>React.isValidElement(window.throwing);
window.readBadArgument=()=>React.isValidElement(window.badArgument());
window.readBadExtraArgument=()=>React.isValidElement(window.candidate,window.badArgument());
window.readAlias=()=>{const valid=React.isValidElement(window.candidate);if(valid)accept();};
window.mount=()=>DOM.flushSync(()=>window.root.render(<App/>));`;
try {
  fs.mkdirSync(path.join(temporary,'src'));fs.mkdirSync(path.join(temporary,'node_modules'));
  fs.writeFileSync(path.join(temporary,'src/App.tsx'),source);
  const pkg={name:'predicate-acceptance',private:true,dependencies:{react:'18.3.1','react-dom':'18.3.1'}};
  fs.writeFileSync(path.join(temporary,'package.json'),JSON.stringify(pkg));
  const lock=JSON.parse(fs.readFileSync(path.join(repository,'package-lock.json')));
  fs.writeFileSync(path.join(temporary,'package-lock.json'),JSON.stringify({name:pkg.name,lockfileVersion:3,packages:{'':pkg,
    'node_modules/react':lock.packages['node_modules/react'],'node_modules/react-dom':lock.packages['node_modules/react-dom']}}));
  for(const name of ['react','react-dom'])fs.symlinkSync(path.join(repository,'node_modules',name),path.join(temporary,'node_modules',name));
  const map=analyzeReact({repository:temporary}),integration=createReactRuntimeIntegration(map);
  assert.ok(map.react_semantics.filter(row=>row.export==='isValidElement').every(row=>row.package_verification_sha256));
  const transform=integration.instrumentSource('src/App.tsx',source);assert.deepEqual(transform.diagnostics,[]);
  const application=ts.transpileModule(transform.code.replace("import * as React from 'react';",'const React=window.React;')
    .replace("import * as DOM from 'react-dom';",'const DOM=window.ReactDOM;'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.None,jsx:ts.JsxEmit.React}}).outputText;
  const assets={'/runtime.js':fs.readFileSync(new URL('../../dist/producttrace-runtime.js',import.meta.url)),
    '/react.js':fs.readFileSync(path.join(temporary,`node_modules/react/umd/react.${build}.min.js`).replace('.development.min.js','.development.js')),
    '/dom.js':fs.readFileSync(path.join(temporary,`node_modules/react-dom/umd/react-dom.${build}.min.js`).replace('.development.min.js','.development.js'))};
  const html=`<!doctype html><div id="app"></div><script src="/runtime.js"></script><script>
    window.records=[];window.effects=[];window.reads=0;window.error={original:true};
    window.throwing={get $$typeof(){reads++;throw error;}};
    window.badArgument=()=>{throw error;};
    window.recorder=ProductTrace.start(${JSON.stringify(integration.bindings)},{outputMode:'evidence',onRecord:record=>records.push(record)});
    </script><script src="/react.js"></script><script src="/dom.js"></script><script>
    window.root=ReactDOM.createRoot(document.getElementById('app'));${application}mount();</script>`;
  const server=http.createServer((request,response)=>{if(assets[request.url])response.end(assets[request.url]);else{response.setHeader('content-type','text/html');response.end(html);}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
  try {
    browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
    const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    // One source button gets six unknown-at-analysis inputs. No expected answer
    // or candidate property value is placed in the analyzer's source snapshot.
    for(const kind of ['element','text','getter','portal','inherited','array']) {
      await page.evaluate(kind=>{
        const element=React.createElement('i',null,'child');
        window.candidate=kind==='element'?element:kind==='text'?'text':kind==='getter'
          ?{get $$typeof(){reads++;return Symbol.for('react.element');}}:kind==='portal'
          ?ReactDOM.createPortal(element,document.createElement('div')):kind==='inherited'?Object.create({$$typeof:Symbol.for('react.element')}):[element];
      },kind);
      await page.click('#check');
    }
    const observations=await page.evaluate(()=>({records,effects,reads}));assert.deepEqual(errors,[]);
    assert.deepEqual(observations.effects,['element','other','element','other','element','other']);
    assert.equal(observations.reads,1,'instrumentation must not reread the getter');
    const calls=observations.records.filter(row=>row.kind==='react_api' && row.export==='isValidElement');assert.equal(calls.length,6);
    for(const [index,record] of calls.entries()) {
      const joined=integration.joinApi(record);assert.equal(joined.status,'resolved');
      const proof=joined.runtime.predicate_proof,selected=observations.effects[index]==='element'?'accept':'reject';
      assert.equal(proof.value,selected==='accept');assert.equal(proof.frontier,null);
      assert.ok(proof.candidates.some(edge=>map.nodes.find(node=>node.id===edge.to)?.text.startsWith('function '+selected)));
      assert.ok(!proof.candidates.some(edge=>map.nodes.find(node=>node.id===edge.to)?.text.startsWith('function '+(selected==='accept'?'reject':'accept'))));
      assert.equal(proof.target_execution_observed,false,'the value selects a source path; effect completion is separate evidence');
    }
    assert.equal(await page.evaluate(()=>{try{readThrowing();return false;}catch(actual){return actual===error;}}),true);
    assert.equal(await page.evaluate(()=>reads),2);
    assert.equal(await page.evaluate(()=>records.filter(row=>row.export==='isValidElement' && row.operation==='invoked').length),6,'a throwing predicate cannot emit a completed boolean result');
    const thrown=await page.evaluate(()=>records.filter(row=>row.export==='isValidElement').at(-1));
    const thrownJoin=integration.joinApi(thrown);assert.equal(thrownJoin.status,'resolved');
    assert.equal(thrownJoin.runtime.predicate_proof.outcome,'threw');assert.deepEqual(thrownJoin.runtime.predicate_proof.candidates,[]);
    assert.equal(thrownJoin.runtime.predicate_proof.exception.identity,thrown.scope.result.identity);
    assert.equal(thrownJoin.runtime.predicate_proof.marker_read_separately_observed,false);
    for(const name of ['readBadArgument','readBadExtraArgument']) {
      assert.equal(await page.evaluate(name=>{try{window[name]();return false;}catch(actual){return actual===error;}},name),true);
      const argumentFailure=await page.evaluate(()=>records.filter(row=>row.export==='isValidElement').at(-1));
      assert.equal(integration.joinApi(argumentFailure).reason,'predicate_argument_evaluation_failed',
        'argument evaluation errors cannot be credited to execution inside React');
    }
    assert.equal(await page.evaluate(()=>{
      const revoked=Proxy.revocable({},{});revoked.revoke();window.error=revoked.proxy;
      try{readThrowing();return false;}catch(actual){return actual===error;}
    }),true,'even an opaque thrown value is returned to the application unchanged');
    const opaque=await page.evaluate(()=>records.filter(row=>row.export==='isValidElement').at(-1));
    assert.notEqual(opaque.observation_id,thrown.observation_id);
    assert.equal(integration.joinApi(opaque).runtime.predicate_proof.outcome,'threw');
    for(const valid of [true,false]) {
      await page.evaluate(valid=>{candidate=valid?React.createElement('i'):'text';},valid);await page.click('#alias');
      const record=await page.evaluate(()=>records.filter(row=>row.export==='isValidElement').at(-1));
      const proof=integration.joinApi(record).runtime.predicate_proof;assert.equal(proof.value,valid);assert.equal(proof.frontier,null);
      assert.ok(proof.candidates.some(edge=>map.nodes.find(node=>node.id===edge.to)?.text.startsWith('function '+(valid?'accept':'reject'))));
      assert.ok(proof.candidates.every(edge=>edge.predicate_condition.inverted===true));
      assert.equal(await page.evaluate(()=>effects.at(-1)),valid?'element':'other');
    }
    await page.evaluate(()=>{candidate=React.createElement('i');readAlias();});
    const alias=await page.evaluate(()=>records.filter(row=>row.export==='isValidElement').at(-1));
    assert.equal(integration.joinApi(alias).runtime.predicate_proof.frontier,'predicate_result_consumer_unresolved');
    const wrong=structuredClone(calls[0]);delete wrong.predicate_result;
    assert.equal(integration.joinApi(wrong).reason,'predicate_boolean_result_required');
    const all=await page.evaluate(()=>records.slice());
    const replay=rows=>{const results=new Map(),reader=createReactRuntimeIntegration(map,{onJoin:(result,row)=>results.set(row.observation_id,result)});
      for(const row of rows)reader.onRecord(row);return results;};
    const joined=replay(all),consumed=all.filter(row=>row.kind==='react_predicate_use');assert.equal(consumed.length,8);
    for(const row of consumed){const result=joined.get(row.observation_id);assert.equal(result.status,'resolved',JSON.stringify({row,result}));
      assert.equal(result.runtime.claim,'observed_predicate_result_consumption');assert.equal(result.runtime.target_execution_observed,false);
      assert.ok(result.runtime.candidates.length>0);}
    assert.equal(new Set(consumed.map(row=>row.source_frame_id)).size,8,'separate button callbacks need separate value origins');
    const target=consumed[0],other=consumed[2];assert.equal(target.value,other.value);
    const mutations=[{source_scope_id:other.source_scope_id},{source_frame_id:other.source_frame_id},
      {value:!target.value},{condition_source_id:'wrong'},{action_occurrence_id:'wrong'},{source_scope_id:'missing'}];
    for(const change of mutations){const results=replay(all.map(row=>row===target?{...row,...change}:row));
      assert.equal(results.get(target.observation_id)?.status,'unresolved',JSON.stringify(change));}
    const withoutCalls=replay(all.filter(row=>row.kind!=='react_api'||row.export!=='isValidElement'));
    assert.ok(consumed.every(row=>withoutCalls.get(row.observation_id)?.status==='unresolved'));
    const beforeStop=await page.evaluate(()=>records.length);await page.evaluate(()=>recorder.stop());await page.click('#check');
    assert.equal(await page.evaluate(()=>records.length),beforeStop);assert.equal(await page.evaluate(()=>effects.at(-1)),'element');
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({api:'react/isValidElement/18.3.1',build,installed_source_attested:true,
      actual_clicks:8,observed_boolean_source_branches:true,immutable_alias_and_negation:true,getter_reads_preserved:true,exception_identity:true,
      consumed_condition_paths:consumed.length,independent_consumption_mutants_rejected:mutations.length,
      missing_call_receipts_rejected:true,separate_callback_frames:true,
      thrown_call_has_no_false_completion:true,thrown_call_observed:true,opaque_thrown_value_observed:true,
      argument_failure_not_library_execution:true,alias_consumer_frontier:true,missing_result_rejected:true,stopped_recording_transparent:true},null,2));
  } finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
} finally {fs.rmSync(temporary,{recursive:true,force:true});}
