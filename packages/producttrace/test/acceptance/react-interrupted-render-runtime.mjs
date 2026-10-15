import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import ts from 'typescript';
import {analyzeReact,createReactRuntimeIntegration} from '../../analysis/index.mjs';

const repository=path.resolve(process.argv[2]||'/tmp/producttrace-librechat-autonomous');
const require=createRequire(path.join(repository,'package.json'));
const {chromium}=require('playwright');
const build=process.env.PRODUCTTRACE_REACT_BUILD==='production'?'production':'development';
const executablePath=process.env.PRODUCTTRACE_BROWSER_EXECUTABLE;
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'react-interrupted-render-'));
const source=`import * as React from 'react';import * as DOM from 'react-dom';
const gates={};
function makeGate(name){let resolve;const promise=new Promise(done=>resolve=done);gates[name]={promise,resolve,open:false};}
function DeferredProbe({label,gate}){const selected=React.useDeferredValue(label);if(gate&&!gates[gate].open)throw gates[gate].promise;return <output id="deferred-value">{selected}</output>}
function TransitionProbe({label,gate}){const [pending,start]=React.useTransition();window.transitionStart=start;React.useEffect(()=>{window.effects.push(label);return()=>window.effects.push('cleanup:'+label)},[label]);if(gate&&!gates[gate].open)throw gates[gate].promise;return <output id="transition-value">{label}:{String(pending)}</output>}
const Context=React.createContext('context-value');
function ContextProbe({gate}){const value=React.useContext(Context);if(gate&&!gates[gate].open)throw gates[gate].promise;return <output id="context-value">{value}</output>}
function HandleProbe({gate}){React.useImperativeHandle(window.handleRef,()=>{window.handleFactories++;return {ready:true}},[]);if(gate&&!gates[gate].open)throw gates[gate].promise;return <output id="handle-value">handle</output>}
const deferredRoot=DOM.createRoot(document.getElementById('deferred'));
const transitionRoot=DOM.createRoot(document.getElementById('transition'));
const siblingRoot=DOM.createRoot(document.getElementById('sibling'));
const contextRoot=DOM.createRoot(document.getElementById('context'));
const handleRoot=DOM.createRoot(document.getElementById('handle'));
window.effects=[];window.handleRef={current:null};window.handleFactories=0;
window.startDeferred=()=>{makeGate('deferred');deferredRoot.render(<React.Suspense fallback={<i id="deferred-fallback">deferred waiting</i>}><DeferredProbe label="deferred-ready" gate="deferred"/></React.Suspense>)};
window.resolveDeferred=()=>{gates.deferred.open=true;gates.deferred.resolve()};
window.mountTransition=()=>DOM.flushSync(()=>transitionRoot.render(<React.Suspense fallback={<i id="transition-fallback">transition waiting</i>}><TransitionProbe label="ready"/></React.Suspense>));
window.interruptTransition=()=>{makeGate('transition');transitionStart(()=>transitionRoot.render(<React.Suspense fallback={<i id="transition-fallback">transition waiting</i>}><TransitionProbe label="slow" gate="transition"/></React.Suspense>))};
window.replaceTransition=()=>DOM.flushSync(()=>transitionRoot.render(<React.Suspense fallback={<i id="transition-fallback">transition waiting</i>}><TransitionProbe label="urgent"/></React.Suspense>));
window.mountSibling=()=>DOM.flushSync(()=>siblingRoot.render(<React.Suspense fallback={<i>sibling waiting</i>}><TransitionProbe label="sibling"/></React.Suspense>));
window.startContext=()=>{makeGate('context');contextRoot.render(<React.Suspense fallback={<i id="context-fallback">context waiting</i>}><ContextProbe gate="context"/></React.Suspense>)};
window.resolveContext=()=>{gates.context.open=true;gates.context.resolve()};
window.startHandle=()=>{makeGate('handle');handleRoot.render(<React.Suspense fallback={<i id="handle-fallback">handle waiting</i>}><HandleProbe gate="handle"/></React.Suspense>)};
window.resolveHandle=()=>{gates.handle.open=true;gates.handle.resolve()};`;

try{
 fs.mkdirSync(path.join(temporary,'src'));fs.mkdirSync(path.join(temporary,'node_modules'));
 fs.writeFileSync(path.join(temporary,'src/App.tsx'),source);
 const pkg={name:'interrupted-render-acceptance',private:true,dependencies:{react:'18.3.1','react-dom':'18.3.1'}};
 fs.writeFileSync(path.join(temporary,'package.json'),JSON.stringify(pkg));
 const lock=JSON.parse(fs.readFileSync(path.join(repository,'package-lock.json')));
 fs.writeFileSync(path.join(temporary,'package-lock.json'),JSON.stringify({name:pkg.name,lockfileVersion:3,packages:{'':pkg,
  'node_modules/react':lock.packages['node_modules/react'],'node_modules/react-dom':lock.packages['node_modules/react-dom']}}));
 for(const name of ['react','react-dom'])fs.symlinkSync(path.join(repository,'node_modules',name),path.join(temporary,'node_modules',name));
 const map=analyzeReact({repository:temporary});
 const deferred=map.react_semantics.find(row=>row.export==='useDeferredValue');
 const transition=map.react_semantics.find(row=>row.export==='useTransition');
 const context=map.react_semantics.find(row=>row.export==='useContext');
 const imperative=map.react_semantics.find(row=>row.export==='useImperativeHandle');
 assert.ok([deferred,transition,context,imperative].every(row=>row?.package_verification_sha256));
 const integration=createReactRuntimeIntegration(map,{onJoin:(join,record)=>joined.set(record.observation_id,join)}),joined=new Map();
 const transformed=integration.instrumentSource('src/App.tsx',source);assert.deepEqual(transformed.diagnostics,[]);
 const application=ts.transpileModule(transformed.code.replace("import * as React from 'react';",'const React=window.React;')
  .replace("import * as DOM from 'react-dom';",'const DOM=window.ReactDOM;'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.None,jsx:ts.JsxEmit.React}}).outputText;
 const reactFile=build==='production'?'react.production.min.js':'react.development.js';
 const domFile=build==='production'?'react-dom.production.min.js':'react-dom.development.js';
 const assets={'/runtime.js':fs.readFileSync(new URL('../../dist/producttrace-runtime.js',import.meta.url)),
  '/react.js':fs.readFileSync(path.join(temporary,'node_modules/react/umd',reactFile)),
  '/dom.js':fs.readFileSync(path.join(temporary,'node_modules/react-dom/umd',domFile))};
 const html=`<!doctype html><div id="deferred"></div><div id="transition"></div><div id="sibling"></div><div id="context"></div><div id="handle"></div>
  <script src="/runtime.js"></script><script>window.records=[];window.recorder=ProductTrace.start(${JSON.stringify(integration.bindings)},{outputMode:'evidence',onRecord:record=>records.push(record)});</script>
  <script src="/react.js"></script><script src="/dom.js"></script><script>${application}</script>`;
 const server=http.createServer((request,response)=>{if(assets[request.url])response.end(assets[request.url]);else{response.setHeader('content-type','text/html');response.end(html)}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
 try{
  browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});const page=await browser.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.evaluate(()=>startDeferred());await page.waitForSelector('#deferred-fallback');
  await page.evaluate(()=>resolveDeferred());await page.waitForSelector('#deferred-value');
  await page.evaluate(()=>startContext());await page.waitForSelector('#context-fallback');
  await page.evaluate(()=>resolveContext());await page.waitForSelector('#context-value');
  await page.evaluate(()=>startHandle());await page.waitForSelector('#handle-fallback');
  assert.equal(await page.evaluate(()=>handleFactories),0);
  await page.evaluate(()=>resolveHandle());await page.waitForSelector('#handle-value');
  assert.equal(await page.evaluate(()=>handleFactories),1);
  await page.evaluate(()=>{mountTransition();mountSibling()});await page.waitForSelector('#transition-value');
  await page.evaluate(()=>interruptTransition());
  await page.waitForFunction(sourceCall=>records.some(row=>row.source_call_id===sourceCall&&row.operation==='render_attempted'),transition.call_id);
  await page.evaluate(()=>replaceTransition());await page.waitForFunction(()=>document.getElementById('transition-value').textContent.startsWith('urgent'));
  const all=await page.evaluate(()=>records);for(const record of all)integration.onRecord(record);
  assert.deepEqual(errors,[]);
  const rowsFor=source=>all.filter(row=>row.kind==='react_lifecycle'&&row.source_call_id===source.call_id
    &&['render_attempted','render_committed','render_abandoned'].includes(row.operation));
  const deferredRows=rowsFor(deferred),transitionRows=rowsFor(transition),contextRows=rowsFor(context),imperativeRows=rowsFor(imperative);
  const assertLineage=(rows,{fallback})=>{
   const abandoned=rows.find(row=>row.operation==='render_abandoned'&&(fallback
    ?row.suspense_boundary?.status==='source_resolved'
    :row.suspense_boundary?.selection===null&&(row.suspense_boundary?.retained_selection==='children'
      ||row.suspense_boundary?.renderer===null)));
   assert.ok(abandoned,JSON.stringify(rows,null,2));assert.equal(joined.get(abandoned.observation_id).status,'resolved');
   const fallbackCommit=fallback&&all.find(row=>row.kind==='react_boundary_commit'
    &&row.origin_observation_id===abandoned.suspense_boundary.origin_observation_id
    &&row.selection?.selection==='fallback'&&row.seq<=abandoned.seq);
   if(fallback){assert.ok(fallbackCommit);assert.equal(joined.get(fallbackCommit.observation_id).status,'resolved');}
   assert.equal(joined.get(abandoned.observation_id).runtime.suspense_boundary.status,
    abandoned.suspense_boundary.commit_observation_id?'resolved':'source_resolved');
   if(!fallback&&abandoned.suspense_boundary.retained_commit_observation_id)
    assert.equal(joined.get(abandoned.observation_id).runtime.suspense_boundary.retained_commit.status,'resolved');
   else if(!fallback)assert.equal(joined.get(abandoned.observation_id).runtime.suspense_boundary.boundary_mount_status,'unobserved');
   const replacement=rows.find(row=>row.operation==='render_attempted'&&row.render_id===abandoned.replacement_render_id);
   assert.ok(replacement);const proof=joined.get(replacement.observation_id);
   assert.equal(proof.status,'resolved',JSON.stringify({proof,rows},null,2));assert.ok(proof.runtime.supersession.superseded_render_ids.includes(abandoned.render_id));
   const committed=all.find(row=>row.kind==='react_boundary_commit'
    &&row.origin_observation_id===replacement.suspense_boundary?.origin_observation_id
    &&row.selection?.selection==='children'&&row.seq>replacement.seq);
   assert.ok(committed,JSON.stringify(rows,null,2));assert.equal(joined.get(committed.observation_id).status,'resolved');
   return {abandoned,replacement,committed,fallbackCommit};
  };
  const deferredPath=assertLineage(deferredRows,{fallback:true});
  const contextPath=assertLineage(contextRows,{fallback:true});
  const imperativePath=assertLineage(imperativeRows,{fallback:true});
  const transitionPath=assertLineage(transitionRows,{fallback:false});
  assert.notEqual(deferredPath.abandoned.suspense_boundary.origin_observation_id,
    transitionPath.abandoned.suspense_boundary.origin_observation_id);
  assert.equal(await page.evaluate(()=>effects.includes('slow')),false);
  const siblingOrigins=new Set(transitionRows.filter(row=>row.instance_id!==transitionPath.replacement.instance_id)
    .map(row=>row.suspense_boundary?.origin_observation_id).filter(Boolean));
  assert.equal(siblingOrigins.has(transitionPath.committed.origin_observation_id),false);
  const replay=(target,change)=>{let result;const check=createReactRuntimeIntegration(map,{onJoin:(join,row)=>{if(row.observation_id===target.observation_id)result=join}});
   for(const row of all)check.onRecord(row.observation_id===target.observation_id?change(structuredClone(row)):row);return result};
  const wrongOrigin=replay(deferredPath.abandoned,row=>{row.suspense_boundary.origin_observation_id='foreign';return row});
  assert.equal(wrongOrigin.reason,'suspense_render_origin_required');
  const wrongCommit=replay(deferredPath.abandoned,row=>{row.suspense_boundary.commit_observation_id=transitionPath.committed.observation_id;row.suspense_boundary.selection='fallback';return row});
  assert.equal(wrongCommit.reason,'suspense_render_commit_required');
  const wrongSelection=replay(deferredPath.abandoned,row=>{row.suspense_boundary.commit_observation_id=deferredPath.fallbackCommit.observation_id;row.suspense_boundary.selection='children';return row});
  assert.equal(wrongSelection.reason,'suspense_render_commit_required');
  const missingReplacement=replay(deferredPath.replacement,row=>{delete row.replaces_render_ids;return row});
  assert.equal(missingReplacement.reason,'render_supersession_evidence_mismatch');
  const before=await page.evaluate(()=>records.length);await page.evaluate(()=>recorder.stop());
  await page.evaluate(()=>replaceTransition());assert.equal(await page.evaluate(()=>records.length),before);
  console.log(JSON.stringify({build,installed_source_attested:true,
   apis:['react/Suspense/18.3.1',deferred.semantic_id,transition.semantic_id,context.semantic_id,imperative.semantic_id],
   exact_boundary_source:true,fallback_commit_to_abandoned_attempt:true,retry_commit_to_children:true,
   superseded_transition_attempt:true,sibling_root_isolation:true,uncommitted_effect_rejected:true,
   context_retry_lineage:contextPath.replacement.render_id,imperative_factory_only_after_commit:imperativePath.replacement.render_id,
   corrupt_origin_commit_selection_and_replacement_rejected:true,records:all.length},null,2));
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve))}
}finally{fs.rmSync(temporary,{recursive:true,force:true})}
