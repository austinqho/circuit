/** Compare the shipped observer with an uninstrumented React page. The oracle
 * owns the scenarios and records original callback entries/results itself. */
import assert from 'node:assert/strict';
import fs from 'node:fs';import http from 'node:http';import os from 'node:os';import path from 'node:path';
import {createRequire} from 'node:module';import ts from 'typescript';
import {analyzeReact,createReactRuntimeIntegration} from '../../analysis/index.mjs';
const repository=path.resolve(process.argv[2]||'/tmp/producttrace-librechat-autonomous');
const require=createRequire(path.join(repository,'package.json')),{chromium}=require('playwright');
const build=process.env.PRODUCTTRACE_REACT_BUILD==='production'?'production':'development';
const strict=process.env.PRODUCTTRACE_REACT_STRICT==='1';
const hydrate=process.env.PRODUCTTRACE_REACT_HYDRATE==='1';
const apis=['useInsertionEffect','useLayoutEffect','useEffect'];
const source=`import * as React from 'react';import * as DOM from 'react-dom';
function Probe({dep,hidden,fail}){
${apis.map(api=>`React.${api}(()=>{
 window.events.push(['${api}','setup',dep]);
 if(fail==='${api}:setup')throw window.failure;
 return()=>{window.events.push(['${api}','cleanup',dep]);
 if(fail==='${api}')throw window.failure;
 return window.cleanupResult;};
},[dep]);`).join('\n')}
 if(hidden)throw window.pending;
 return <span id="probe">{dep}</span>;
}
class Boundary extends React.Component{
 constructor(props){super(props);this.state={failed:false};}
 static getDerivedStateFromError(){return {failed:true};}
 componentDidCatch(error){window.caught.push(error===window.failure);}
 render(){return this.state.failed?<b>failed</b>:this.props.children;}
}
function tree(dep,hidden=false,fail=null){return ${strict?'<React.StrictMode>':''}<Boundary><React.Suspense fallback={<i>waiting</i>}><Probe dep={dep} hidden={hidden} fail={fail}/></React.Suspense></Boundary>${strict?'</React.StrictMode>':''};}
window.begin=()=>{const host=document.getElementById('app');window.root=${hydrate?"host.firstChild?DOM.hydrateRoot(host,tree('initial')):":''}DOM.createRoot(host);};
window.mount=(dep,hidden=false,fail=null)=>DOM.flushSync(()=>window.root.render(tree(dep,hidden,fail)));
window.dispose=()=>DOM.flushSync(()=>window.root.unmount());`;
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'react-effect-outcomes-'));
let browser,server;
try{
 fs.mkdirSync(path.join(temporary,'src'));fs.mkdirSync(path.join(temporary,'node_modules'));
 fs.writeFileSync(path.join(temporary,'src/App.tsx'),source);
 const pkg={name:'effect-outcome-acceptance',private:true,dependencies:{react:'18.3.1','react-dom':'18.3.1'}};
 fs.writeFileSync(path.join(temporary,'package.json'),JSON.stringify(pkg));
 const lock=JSON.parse(fs.readFileSync(path.join(repository,'package-lock.json')));
 fs.writeFileSync(path.join(temporary,'package-lock.json'),JSON.stringify({lockfileVersion:3,packages:{'':pkg,
  'node_modules/react':lock.packages['node_modules/react'],'node_modules/react-dom':lock.packages['node_modules/react-dom']}}));
 for(const name of ['react','react-dom'])fs.symlinkSync(path.join(repository,'node_modules',name),path.join(temporary,'node_modules',name));
 const map=analyzeReact({repository:temporary}),joins=new Map();
 const integration=createReactRuntimeIntegration(map,{onJoin:(result,record)=>joins.set(record.observation_id,result)});
 for(const api of apis)assert(map.react_semantics.find(row=>row.export===api)?.package_verification_sha256);
 const transformed=integration.instrumentSource('src/App.tsx',source);assert.deepEqual(transformed.diagnostics,[]);
 const compile=input=>ts.transpileModule(input.replace("import * as React from 'react';",'const React=window.React;').replace("import * as DOM from 'react-dom';",'const DOM=window.ReactDOM;'),
  {compilerOptions:{jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.None}}).outputText;
 const assets={'/runtime.js':fs.readFileSync(new URL('../../dist/producttrace-runtime.js',import.meta.url)),
  '/react.js':fs.readFileSync(path.join(repository,`node_modules/react/umd/react.${build==='production'?'production.min':'development'}.js`)),
  '/dom.js':fs.readFileSync(path.join(repository,`node_modules/react-dom/umd/react-dom.${build==='production'?'production.min':'development'}.js`))};
 const React=require('react'),Server=require('react-dom/server');
 const markup=hydrate?Server.renderToString(React.createElement(React.Suspense,{fallback:React.createElement('i',null,'waiting')},React.createElement('span',{id:'probe'},'initial'))):'';
 server=http.createServer((req,res)=>{
  if(assets[req.url])return res.end(assets[req.url]);
  const instrumented=req.url==='/observed';res.setHeader('content-type','text/html');
  res.end(`<!doctype html><div id="app">${markup}</div>${instrumented?'<script src="/runtime.js"></script>':''}<script>
   window.events=[];window.records=[];window.caught=[];window.failure=new Error('intentional cleanup failure');
   window.cleanupResult={returned:true};window.pending=new Promise(()=>{});window.serverNode=document.getElementById('probe');
   ${instrumented?`window.recorder=ProductTrace.start(${JSON.stringify(integration.bindings)},{outputMode:'evidence',onRecord:row=>records.push(row)});`:''}
   </script><script src="/react.js"></script><script src="/dom.js"></script><script>${compile(instrumented?transformed.code:source)}</script>`);
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 async function scenario(mode){
  const page=await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/${mode}`);
  const step=async(fn,arg)=>{await page.evaluate(fn,arg);await page.waitForTimeout(35);};
  await step(()=>begin());
  if(hydrate)assert.equal(await page.evaluate(()=>serverNode===document.getElementById('probe')),true);
  await step(()=>mount('initial'));
  await step(()=>mount('initial'));await step(()=>mount('changed'));
  await step(()=>mount('changed',true));await step(()=>mount('changed'));await step(()=>dispose());
  await step(()=>{begin();mount('abandoned',true);});
  await step(()=>mount('after-abandon'));await step(()=>dispose());
  // Cleanup failures must preserve the original thrown object and must not be
  // mislabeled as successful cleanup. Each case has a fresh root lifetime.
  for(const api of [...apis,...apis.map(api=>api+':setup')]){
   await step(api=>{begin();mount('throwing',false,api);},api);
   await step(()=>mount('replacement'));
   await step(()=>{try{dispose();}catch(error){caught.push(error===failure);}});
  }
  const result=await page.evaluate(()=>({events,caught,records}));await page.close();return result;
 }
 const baseline=await scenario('baseline'),observed=await scenario('observed');
 assert.deepEqual(observed.events,baseline.events,'instrumentation must preserve actual callback order/count');
 assert.equal(observed.events.some(row=>row[2]==='abandoned'),false);
 assert.deepEqual(observed.caught,baseline.caught);assert(observed.caught.length>=3);assert(observed.caught.every(Boolean));
 for(const row of observed.records)integration.onRecord(row);
 const outcomes=observed.records.filter(row=>['callback_completed','cleanup_completed'].includes(row.operation));
 assert(outcomes.length>0);
 const rejected=outcomes.map(row=>({api:row.semantic_id,operation:row.operation,join:joins.get(row.observation_id)})).filter(row=>row.join?.status!=='resolved');
 assert.deepEqual(rejected,[]);
 for(const api of apis){
  const matching=outcomes.filter(row=>row.semantic_id===`react/${api}/18.3.1`);
  assert(matching.some(row=>row.operation==='callback_completed'&&row.value_kind==='function'));
  assert(matching.some(row=>row.operation==='cleanup_completed'&&row.outcome==='returned'&&row.value_kind==='object'));
  assert(matching.some(row=>row.operation==='cleanup_completed'&&row.outcome==='threw'&&row.value_kind==='object'));
  assert(matching.some(row=>row.operation==='callback_completed'&&row.outcome==='threw'&&row.value_kind==='object'));
 }
 const expected=observed.events.map(([api,operation])=>`${api}:${operation}`);
 const actual=outcomes.map(row=>`${row.semantic_id.split('/')[1]}:${row.operation==='callback_completed'?'setup':'cleanup'}`);
 // Deferred delivery may reorder different hooks; every original invocation
 // must nevertheless have exactly one independently joined outcome receipt.
 assert.deepEqual(actual.toSorted(),expected.toSorted());
 console.log(JSON.stringify({react:'18.3.1',build,strict,hydrate,apis,baseline_matches:true,
  actual_callback_outcomes:outcomes.length,
  thrown_cleanup_outcomes:outcomes.filter(row=>row.operation==='cleanup_completed'&&row.outcome==='threw').length,
  thrown_setup_outcomes:outcomes.filter(row=>row.operation==='callback_completed'&&row.outcome==='threw').length,
  suspense_hide_reveal:true,abandoned_render_has_no_effect:true,hydration_reuses_server_node:hydrate,unchanged_dependencies:true,exact_error_identity:true,
  every_original_invocation_has_joined_outcome:true,async_completion_claimed:false},null,2));
}finally{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));fs.rmSync(temporary,{recursive:true,force:true});}
