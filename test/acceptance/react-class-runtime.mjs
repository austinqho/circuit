import assert from 'node:assert/strict';import fs from 'node:fs';import http from 'node:http';import os from 'node:os';import path from 'node:path';import {createRequire} from 'node:module';import ts from 'typescript';
import {analyzeReact,createReactRuntimeIntegration} from '../../analysis/index.mjs';
const repository=path.resolve(process.argv[2]||'/tmp/producttrace-librechat-autonomous'),require=createRequire(path.join(repository,'package.json')),{chromium}=require('playwright');
const build=process.env.NODE_ENV==='production'?'production':'development',strict=process.env.PRODUCTTRACE_CLASS_STRICT==='1';
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'react-class-runtime-'));
const source=`import * as React from 'react';import * as DOM from 'react-dom';
class Normal extends React.Component {state={suffix:'normal'};render(){window.bodies.push([this,this.props,this.state]);return <p>{this.props.value}:{this.state.suffix}</p>;}}
class Pure extends React.PureComponent {state={suffix:'pure'};render(){window.bodies.push([this,this.props,this.state]);return <p>{this.props.value}:{this.state.suffix}</p>;}}
function App(){const [count,setCount]=React.useState(0);const click=React.useCallback(()=>{DOM.flushSync(()=>setCount(value=>value+1));},[]);
 return <div><button id="advance" onClick={click}>Advance</button><Normal key={window.generation} ref={value=>{if(value)window.normal=value;}} value={count}/><Pure key={window.generation} ref={value=>{if(value)window.pure=value;}} value={count}/><Pure value="sibling"/></div>;}
window.manual=()=>normal.render();window.mount=()=>DOM.flushSync(()=>window.root.render(${strict?'<React.StrictMode><App/></React.StrictMode>':'<App/>'}));
window.sameRender=()=>DOM.flushSync(()=>window.root.render(${strict?'<React.StrictMode><App/></React.StrictMode>':'<App/>'}));
window.classes=[Normal,Pure];`;
try{
 fs.mkdirSync(path.join(temporary,'src'));fs.mkdirSync(path.join(temporary,'node_modules'));fs.writeFileSync(path.join(temporary,'src/App.tsx'),source);
 const pkg={name:'class-acceptance',private:true,dependencies:{react:'18.3.1','react-dom':'18.3.1'}};fs.writeFileSync(path.join(temporary,'package.json'),JSON.stringify(pkg));
 const lock=JSON.parse(fs.readFileSync(path.join(repository,'package-lock.json')));fs.writeFileSync(path.join(temporary,'package-lock.json'),JSON.stringify({name:pkg.name,lockfileVersion:3,packages:{'':pkg,'node_modules/react':lock.packages['node_modules/react'],'node_modules/react-dom':lock.packages['node_modules/react-dom']}}));
 for(const name of ['react','react-dom'])fs.symlinkSync(path.join(repository,'node_modules',name),path.join(temporary,'node_modules',name));
 const map=analyzeReact({repository:temporary}),joins=new Map(),integration=createReactRuntimeIntegration(map,{onJoin:(result,record)=>joins.set(record.observation_id,result)});
 const semantics=map.react_semantics.filter(row=>row.causal_bindings?.class_mapping);assert.equal(semantics.length,2);assert.ok(semantics.every(row=>row.package_verification_sha256));assert.equal(map.controls.length,1);
 const transformed=integration.instrumentSource('src/App.tsx',source);assert.deepEqual(transformed.diagnostics,[]);
 const compile=text=>ts.transpileModule(text.replace("import * as React from 'react';",'const React=window.React;').replace("import * as DOM from 'react-dom';",'const DOM=window.ReactDOM;'),{compilerOptions:{jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.None}}).outputText;
 
 const variant=build==='production'?'production.min':'development',assets={'/runtime.js':fs.readFileSync(new URL('../../dist/producttrace-runtime.js',import.meta.url)),
 '/react.js':fs.readFileSync(path.join(repository,`node_modules/react/umd/react.${variant}.js`)),'/dom.js':fs.readFileSync(path.join(repository,`node_modules/react-dom/umd/react-dom.${variant}.js`))};
 const html=text=>`<!doctype html><div id="app"></div><script src="/runtime.js"></script><script>window.records=[];window.bodies=[];window.generation=0;
 window.recorder=ProductTrace.start(${JSON.stringify(integration.bindings)},{outputMode:'evidence',onRecord:row=>records.push(row)});</script><script src="/react.js"></script><script src="/dom.js"></script><script>
 window.root=ReactDOM.createRoot(document.getElementById('app'));${compile(text)}mount();</script>`;
 const server=http.createServer((req,res)=>{if(assets[req.url])res.end(assets[req.url]);else{res.setHeader('content-type','text/html');res.end(html(req.url==='/original'?source:transformed.code));}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
 try{
  browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});const errors=[];
  const exercise=async location=>{const page=await browser.newPage();page.on('pageerror',error=>errors.push(String(error)+error.stack));await page.goto(`http://127.0.0.1:${server.address().port}/${location}`);assert.deepEqual(errors,[]);
   const originalShape=await page.evaluate(()=>classes.map(type=>({name:type.name,arity:type.length,renderName:type.prototype.render.name,renderArity:type.prototype.render.length,instance:normal instanceof classes[0]&&pure instanceof classes[1]})));
   const initial=await page.evaluate(()=>({text:document.getElementById('app').textContent,bodies:bodies.length}));
   await page.click('#advance');await page.click('#advance');
   const clicked=await page.evaluate(()=>({text:document.getElementById('app').textContent,bodies:bodies.length}));
   const same=await page.evaluate(()=>{const before=bodies.length;sameRender();return bodies.slice(before).map(row=>row[0].constructor.name);});
   const beforeRemount=await page.evaluate(()=>records.length);await page.evaluate(()=>{generation++;sameRender();});await page.click('#advance');
   const records=await page.evaluate(()=>records);
   const outside=await page.evaluate(()=>{const result=manual();return {type:result.type,record:records.filter(row=>row.kind==='react_class').at(-1)};});
   const stopped=await page.evaluate(()=>{recorder.stop();return records.length;});await page.click('#advance');assert.equal(await page.evaluate(()=>records.length),stopped);
   const after=await page.evaluate(()=>document.getElementById('app').textContent);await page.close();return {initial,clicked,same,originalShape,records,beforeRemount,outside,after};};
  const original=await exercise('original'),actual=await exercise('instrumented');
  for(const key of ['initial','clicked','same','originalShape','after'])assert.deepEqual(actual[key],original[key],key);
  assert.ok(actual.same.length>0&&actual.same.every(name=>name==='Normal'),'PureComponent bailout must survive instrumentation');
  assert.equal(original.records.filter(row=>row.kind==='react_class').length,0);
  for(const row of actual.records)integration.onRecord(row);
  const classRows=actual.records.filter(row=>row.kind==='react_class'),registrations=classRows.filter(row=>row.operation==='registered'),renders=classRows.filter(row=>row.operation!=='registered');
  assert.equal(registrations.length,2);assert.ok(renders.length>=10);
  for(const row of renders){const joined=joins.get(row.observation_id);assert.equal(joined.status,'resolved',JSON.stringify({row,joined}));assert.ok(row.reads.length>=4);assert.equal(joined.runtime.commit_proven,false);assert.equal(joined.runtime.update_cause_proven,false);}
  const actions=renders.filter(row=>row.action);assert.ok(actions.length>=6,JSON.stringify(actual.records.filter(row=>['action','react_callback'].includes(row.kind))));assert.equal(new Set(actions.map(row=>row.action.action_occurrence_id)).size,3);
  const before=renders.filter(row=>actual.records.indexOf(row)<actual.beforeRemount),after=renders.filter(row=>actual.records.indexOf(row)>=actual.beforeRemount);
  for(const registration of registrations){const old=new Set(before.filter(row=>row.registration_id===registration.observation_id).map(row=>row.receiver.identity)),fresh=after.filter(row=>row.registration_id===registration.observation_id).map(row=>row.receiver.identity);assert.ok(fresh.some(id=>!old.has(id)));}
  const pureRegistration=registrations.find(row=>row.pure);assert.ok(new Set(before.filter(row=>row.registration_id===pureRegistration.observation_id).map(row=>row.receiver.identity)).size>=2);
  assert.equal(integration.joinClass(actual.outside.record).reason,'class_renderer_owner_unobserved');
  const target=actions[0],prefix=actual.records.slice(0,actual.records.indexOf(target)),mutations=[row=>{row.registration_id=row.session+':foreign';},row=>{row.class_type.identity=row.session+':foreign';},row=>{row.source_call_id='wrong';},row=>{row.semantic_id='wrong';},row=>{row.session='wrong';},row=>{row.occurrence_id='wrong';},row=>{row.owner.basis='wrong';},row=>{row.owner.instance_id='wrong';},row=>{row.inputs.props.identity=row.session+':foreign';},row=>{row.reads[0].source_id='wrong';},row=>{row.reads[0].value.identity=row.session+':foreign';},row=>{row.reads[0].input_match=false;},row=>{row.action.callback_observation_id='wrong';},row=>{row.action.action_occurrence_id='wrong';}];
  for(const mutation of mutations){const fresh=createReactRuntimeIntegration(map);prefix.forEach(row=>fresh.onRecord(row));const bad=JSON.parse(JSON.stringify(target));mutation(bad);assert.equal(fresh.joinClass(bad).status,'unresolved',JSON.stringify(bad));assert.equal(fresh.joinClass(target).status,'resolved');}
  assert.equal(createReactRuntimeIntegration(map).joinClass(target).reason,'class_registration_required');assert.equal(integration.joinClass(target).reason,'duplicate_class_observation');assert.deepEqual(errors,[]);
  console.log(JSON.stringify({apis:['react/Component/18.3.1','react/PureComponent/18.3.1'],build,strict,installed_source_attested:true,class_registrations:2,render_joins:renders.length,actual_clicks:4,click_linked_renders:actions.length,
   original_class_method_receiver_and_output_preserved:true,pure_bailout_preserved:true,sibling_and_remount_isolation:true,original_input_reads:true,registration_and_action_receipts_required:true,
   manual_calls_abstain:true,stop_preserves_behavior:true,independent_mutants_rejected:mutations.length,commit_proven:false,update_cause_proven:false,direct_renderer_dispatch_proven:false},null,2));
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
}finally{fs.rmSync(temporary,{recursive:true,force:true});}
