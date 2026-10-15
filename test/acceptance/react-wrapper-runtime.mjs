import assert from 'node:assert/strict';import fs from 'node:fs';import http from 'node:http';
import os from 'node:os';import path from 'node:path';import {createRequire} from 'node:module';import ts from 'typescript';
import {analyzeReact,createReactRuntimeIntegration} from '../../analysis/index.mjs';
const repository=path.resolve(process.argv[2]||'/tmp/producttrace-librechat-autonomous');
const require=createRequire(path.join(repository,'package.json'));const {chromium}=require('playwright');
const build=process.env.PRODUCTTRACE_REACT_BUILD==='production'?'production':'development';
const hydrate=process.env.PRODUCTTRACE_REACT_HYDRATE==='1';
const siblings=process.env.PRODUCTTRACE_REACT_WRAPPER_SIBLINGS==='1';
const defaultMemo=process.env.PRODUCTTRACE_REACT_WRAPPER_DEFAULT_MEMO==='1';
const strict=process.env.PRODUCTTRACE_REACT_STRICT==='1';
const tree=strict?'<React.StrictMode><App tick={tick} epoch={epoch}/></React.StrictMode>':'<App tick={tick} epoch={epoch}/>';
const comparator=defaultMemo?'':`,(a,b)=>{window.comparisons.push([a.value,b.value]);return a.value===b.value;}`;
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'react-wrapper-runtime-'));
const source=`import * as React from 'react';import * as DOM from 'react-dom';
const Forward=React.forwardRef(function ForwardRender(props,ref){if(props.testOutcome)return props.testValue;window.identities.push(ForwardRender===Forward.render);window.renders.push('forward:'+props.value);return <button id={props.id} ref={ref} onClick={()=>window.events.push('forward:'+props.value)}>Forward</button>;});
const Memo=React.memo(function MemoRender(props){window.identities.push(MemoRender===Memo.type);window.renders.push('memo:'+props.value);return <button id={props.id} onClick={()=>window.events.push('memo:'+props.value)}>Memo</button>;}${comparator});
window.manualRender=()=>Forward.render({value:99},null);
function App({tick,epoch}){return <main><Forward id="forward" value={tick} ref={window.forwardRef}/><Memo id="memo" key={epoch} value={tick}/>${siblings?'<Forward id="forward-sibling" value="sibling" ref={window.siblingRef}/><Memo id="memo-sibling" value="sibling"/>':''}</main>;}
window.mount=(tick=0,epoch=0)=>DOM.flushSync(()=>window.root.render(${tree}));`;
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
  const sources=map.react_semantics.filter(row=>['forwardRef','memo'].includes(row.export));assert.equal(sources.length,2);
  assert.ok(sources.every(row=>row.package_verification_sha256));
  const transform=integration.instrumentSource('src/App.tsx',source);
  assert.deepEqual(transform.diagnostics,[]);
  const application=ts.transpileModule(transform.code.replace("import * as React from 'react';",'const React=window.React;')
    .replace("import * as DOM from 'react-dom';",'const DOM=window.ReactDOM;'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.None,jsx:ts.JsxEmit.React}}).outputText;
  const assets={'/runtime.js':fs.readFileSync(new URL('../../dist/producttrace-runtime.js',import.meta.url)),
    '/react.js':fs.readFileSync(path.join(temporary,`node_modules/react/umd/react.${build}.min.js`).replace('.development.min.js','.development.js')),
    '/dom.js':fs.readFileSync(path.join(temporary,`node_modules/react-dom/umd/react-dom.${build}.min.js`).replace('.development.min.js','.development.js'))};
  let serverMarkup='';
  if(hydrate) {
    const serverWindow={React:require('react'),ReactDOM:require('react-dom'),renders:[],identities:[],comparisons:[],forwardRef:null,siblingRef:null};
    const serverProbe={component(){},apiResult:(_key,value)=>value,callback:(_key,value)=>value,wrapperReturn:(_key,value)=>value,wrapperCallback:(_key,_callback,_args,run)=>run?.(),boundaryResult:(_key,value)=>value};
    const ServerApp=new Function('window','globalThis',application+';return App;')(serverWindow,{__productTraceReactLifecycle:serverProbe});
    serverMarkup=require('react-dom/server').renderToString((strict?serverWindow.React.createElement(serverWindow.React.StrictMode,null,serverWindow.React.createElement(ServerApp,{tick:0,epoch:0})):serverWindow.React.createElement(ServerApp,{tick:0,epoch:0})),{identifierPrefix:'test-'});
  }
  const bootSetup="window.forwardRef=window.React.createRef();window.siblingRef=window.React.createRef();";
  const initialTree=strict?"React.createElement(React.StrictMode,null,React.createElement(App,{tick:0,epoch:0}))":"React.createElement(App,{tick:0,epoch:0})";
  const boot=hydrate?`${application}window.root=ReactDOM.hydrateRoot(document.getElementById('app'),${initialTree},{identifierPrefix:'test-',onRecoverableError:error=>window.recoveries.push(error.message)});`
    :`window.root=ReactDOM.createRoot(document.getElementById('app'),{identifierPrefix:'test-'});${application}mount();`;
  const html=`<!doctype html><div id="app">${serverMarkup}</div><div id="other"></div><script src="/runtime.js"></script><script>
    window.records=[];window.recoveries=[];window.renders=[];window.identities=[];window.comparisons=[];window.events=[];window.initialInput=document.querySelector('button');
    window.recorder=ProductTrace.start(${JSON.stringify(integration.bindings)},{outputMode:'evidence',onRecord:record=>records.push(record)});
    </script><script src="/react.js"></script><script src="/dom.js"></script><script>${bootSetup}${boot}</script>`;
  const server=http.createServer((request,response)=>{if(assets[request.url])response.end(assets[request.url]);else{response.setHeader('content-type','text/html');response.end(html);}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
  try {
    browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
    const page=await browser.newPage(),errors=[],warnings=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')warnings.push(message.text());});
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(count=>document.querySelectorAll('button').length===count,siblings?4:2);
    const selectors=siblings?['#forward','#memo','#forward-sibling','#memo-sibling']:['#forward','#memo'];
    if(hydrate){assert.equal(await page.evaluate(()=>initialInput===document.querySelector('button')),true);assert.deepEqual(await page.evaluate(()=>recoveries),[]);}
    assert.equal(await page.evaluate(()=>forwardRef.current===document.getElementById('forward')),true);
    for(const selector of selectors)await page.click(selector);
    await page.evaluate(()=>mount(1,0));for(const selector of selectors)await page.click(selector);
    const beforeMemo=await page.evaluate(()=>renders.filter(row=>row==='memo:1').length);
    await page.evaluate(()=>mount(1,0));assert.equal(await page.evaluate(()=>renders.filter(row=>row==='memo:1').length),beforeMemo);
    await page.evaluate(()=>mount(1,1));assert.ok(await page.evaluate(()=>renders.filter(row=>row==='memo:1').length)>beforeMemo);
    await page.evaluate(()=>manualRender());
    assert.equal(await page.evaluate(()=>identities.every(Boolean)),true);
    const all=await page.evaluate(()=>records);for(const record of all)integration.onRecord(record);
    const created=all.filter(row=>row.kind==='react_wrapper' && row.operation==='created'),invocations=all.filter(row=>row.operation==='wrapper_callback_invoked');
    const actions=all.filter(row=>row.kind==='action'),constructors=all.filter(row=>row.kind==='react_api' && ['forwardRef','memo'].includes(row.export));
    const actionJoins=actions.map(row=>integration.join(row));
    assert.equal(actions.length,selectors.length*2);assert.equal(constructors.length,2);assert.equal(created.length,2);assert.ok(invocations.length>=6);
    for(const row of [...created,...invocations])assert.equal(joinedById.get(row.observation_id).status,'resolved',JSON.stringify({row,joined:joinedById.get(row.observation_id)}));
    const frontiers=all.filter(row=>row.kind==='react_wrapper' && row.operation==='frontier');
    assert.ok(frontiers.some(row=>row.reason==='wrapper_render_owner_unobserved'));
    for(const row of frontiers)assert.equal(joinedById.get(row.observation_id).status,'unresolved');
    for(const row of invocations) {
      const proof=joinedById.get(row.observation_id).runtime.wrapper;
      assert.equal(proof.claim,'observed_stored_component_body');assert.equal(proof.arguments.length,2);
      assert.equal(proof.direct_renderer_dispatch_proven,false);assert.equal(proof.callback_completion_proven,false);
      if(row.semantic_id==='react/forwardRef/18.3.1') {
        assert.equal(proof.forwarded_ref.claim,'observed_renderer_ref_argument',JSON.stringify(row));
        assert.equal(proof.forwarded_ref.value_id,row.arguments[1].value_id);
        assert.equal(proof.forwarded_ref.ref_attachment_proven,false);
        assert.equal(proof.forwarded_ref.ref_cleanup_proven,false);
      } else assert.equal(proof.forwarded_ref,null);
    }
    for(const row of constructors)assert.equal(integration.joinApi(row).status,'resolved');
    for(const join of actionJoins)assert.equal(join.status,'resolved',JSON.stringify(join));
    assert.equal(new Set(actionJoins.map(row=>row.source.control_id)).size,2);
    const clickedOwners=actionJoins.map((join,index)=>{
      const owner=join.runtime.react_lifecycle_identity;assert.ok(owner,'a source control alone does not prove its mounted owner');
      const api=selectors[index%selectors.length].includes('memo')?'memo':'forwardRef';
      assert.equal(owner.semantic_id,`react/${api}/18.3.1`);
      assert.ok(invocations.some(row=>row.root_id===owner.root_id && row.instance_id===owner.instance_id
        && row.mount_id===owner.mount_id && row.render_id===owner.render_id && row.source_call_id===owner.source_call_id
        && row.seq<actions[index].seq),'the clicked owner must have an earlier body entry in this render');
      return owner.mount_id;
    });
    assert.equal(new Set(clickedOwners.slice(0,selectors.length)).size,selectors.length);
    assert.deepEqual(clickedOwners.slice(selectors.length),clickedOwners.slice(0,selectors.length));
    assert.deepEqual(await page.evaluate(()=>events),siblings?['forward:0','memo:0','forward:sibling','memo:sibling','forward:1','memo:1','forward:sibling','memo:sibling']:['forward:0','memo:0','forward:1','memo:1']);
    if(siblings) {
      for(const api of ['forwardRef','memo']) {
        const rows=invocations.filter(row=>row.semantic_id===`react/${api}/18.3.1`);
        assert.ok(new Set(rows.map(row=>row.mount_id)).size>=2);
        assert.equal(new Set(rows.map(row=>row.wrapper_id)).size,1);
        assert.equal(new Set(rows.map(row=>row.component_identity_id)).size,1);
      }
      assert.equal(await page.evaluate(()=>siblingRef.current===document.getElementById('forward-sibling')),true);
    }
    // Replace the ref without changing props. The component must receive each
    // original callback/object/null input; no observer may dereference the cell.
    const priorCount=all.length;
    await page.evaluate(()=>{window.savedRef=forwardRef;window.refDeliveries=[];
      window.refCallback=value=>{refDeliveries.push(value);return ()=>{throw Error('ignored ref return');};};
      window.forwardRef=refCallback;mount(1,1);});
    assert.equal(await page.evaluate(()=>refDeliveries[0]===document.getElementById('forward')),true);
    await page.evaluate(()=>{window.forwardRef=null;mount(1,1);});
    assert.equal(await page.evaluate(()=>refDeliveries.at(-1)),null);
    await page.evaluate(()=>{window.cellWrites=[];window.hostileRef={get current(){throw Error('unexpected ref read');},
      set current(value){cellWrites.push({value,receiver:this===window.hostileRef});}};
      window.forwardRef=hostileRef;mount(1,1);});
    assert.equal(await page.evaluate(()=>cellWrites.length===1 && cellWrites[0].value===document.getElementById('forward') && cellWrites[0].receiver),true);
    await page.evaluate(()=>{window.forwardRef=savedRef;mount(1,1);});
    assert.equal(await page.evaluate(()=>cellWrites.length===2 && cellWrites[1].value===null && cellWrites[1].receiver),true);
    const later=await page.evaluate(count=>records.slice(count),priorCount);for(const record of later)integration.onRecord(record);
    const refRows=later.filter(row=>row.operation==='wrapper_callback_invoked' && row.semantic_id==='react/forwardRef/18.3.1');
    assert.ok(refRows.length>=3);
    const diagnosticRows=refRows.filter(row=>row.arguments.length===0);
    for(const record of refRows){const join=joinedById.get(record.observation_id);assert.equal(join.status,'resolved',JSON.stringify({record,join,errors}));
      if(record.arguments.length===0)assert.equal(join.runtime.wrapper.forwarded_ref.reason,'forwarded_ref_renderer_input_unconfirmed');
      else assert.equal(join.runtime.wrapper.forwarded_ref.claim,'observed_renderer_ref_argument',JSON.stringify({record,errors,warnings}));}
    if(build==='development'){assert.ok(diagnosticRows.length>0);assert.ok(warnings.some(message=>message.includes('Unexpected return value from a callback ref')));}
    else assert.equal(diagnosticRows.length,0);
    assert.ok(refRows.some(row=>row.arguments[1]?.value.encoding==='primitive' && row.arguments[1].value.value===null));
    const target=refRows.find(row=>row.arguments[1]?.value.encoding==='redacted');
    const mutations=[{argument:0},{field:'stateNode'},{fiber_tag:14},{snapshot:'guessed'},
      {value_id:target.arguments[0].value_id},{renderer_value_id:'wrong-session:ref'},{identity_matched:false},{status:'claimed'}];
    for(const change of mutations){let result;const fresh=createReactRuntimeIntegration(map,{onJoin:(join,record)=>{if(record.observation_id===target.observation_id)result=join;}});
      for(const record of [...all,...later])fresh.onRecord(record.observation_id===target.observation_id?{...record,forwarded_ref:{...record.forwarded_ref,...change}}:record);
      assert.equal(result.status,'unresolved',JSON.stringify(change));}
    // Exercise actual renderer consumption separately from the Tracer receipt.
    // The receipt proves the body outcome, not the downstream DOM commit.
    const beforeOutcomes=priorCount+later.length;
    await page.evaluate(()=>{window.outcomeRoot=ReactDOM.createRoot(document.getElementById('other'));
      window.sharedOutput=React.createElement('i',null,'shared-output');
      window.renderOutput=value=>ReactDOM.flushSync(()=>outcomeRoot.render(React.createElement(Forward,{testOutcome:true,testValue:value})));});
    await page.evaluate(()=>renderOutput('returned-text'));assert.equal(await page.locator('#other').textContent(),'returned-text');
    await page.evaluate(()=>renderOutput(null));assert.equal(await page.locator('#other').textContent(),'');
    await page.evaluate(()=>renderOutput(sharedOutput));await page.evaluate(()=>renderOutput(sharedOutput));
    assert.equal(await page.locator('#other').textContent(),'shared-output');
    const last=await page.evaluate(count=>records.slice(count),beforeOutcomes);for(const record of last)integration.onRecord(record);
    const inputReturns=last.filter(row=>row.operation==='wrapper_callback_completed' && row.outcome==='returned');
    assert.equal(inputReturns.length,4);assert.deepEqual(inputReturns.slice(0,2).map(row=>row.value),[
      {encoding:'primitive',value:'returned-text'},{encoding:'primitive',value:null}]);
    assert.equal(inputReturns[2].value_id,inputReturns[3].value_id,'the unchanged returned object retains its identity');
    const entire=[...all,...later,...last],outcomes=entire.filter(row=>row.operation==='wrapper_callback_completed');
    assert.ok(outcomes.length>=invocations.length+4);
    for(const row of outcomes){const join=joinedById.get(row.observation_id);assert.equal(join.status,'resolved',JSON.stringify({row,join}));
      const proof=join.runtime.wrapper_outcome;assert.equal(proof.invocation_id,row.caused_by_invocation_id);
      assert.equal(proof.outcome,row.outcome);assert.equal(proof.callback_completion_proven,true);
      assert.equal(proof.render_commit_proven,false);assert.equal(proof.renderer_result_consumed_proven,false);}
    for(const row of diagnosticRows)assert.ok(outcomes.some(result=>result.caused_by_invocation_id===row.invocation_id && result.outcome==='threw'));
    const result=outcomes[0],changedOutcomes=[{caused_by_invocation_id:'session:missing'},{wrapper_id:'wrong'},
      {component_identity_id:'wrong'},{wrapper_origin_observation_id:'wrong'},{callback_source_id:'wrong'},
      {render_id:'wrong'},{mount_id:'wrong'},{manifest_key:'wrong'},{outcome:'committed'},
      {value_id:'other:value'},{value:{encoding:'primitive',value:{hidden:true}}},{value:{encoding:'redacted',value:'leak'}},
      {runtime_observed:false},{session:'other'},{invocation_id:'unexpected'},{value:{encoding:'primitive',value:Infinity}}];
    for(const change of changedOutcomes){let joined;const fresh=createReactRuntimeIntegration(map,{onJoin:(join,record)=>{if(record.observation_id===result.observation_id)joined=join;}});
      for(const record of entire)fresh.onRecord(record.observation_id===result.observation_id?{...record,...change}:record);
      assert.equal(joined.status,'unresolved',JSON.stringify(change));}
    const missingJoins=new Map(),missing=createReactRuntimeIntegration(map,{onJoin:(join,record)=>missingJoins.set(record.observation_id,join)});
    for(const record of entire)if(record.operation!=='wrapper_callback_invoked')missing.onRecord(record);
    for(const row of outcomes)assert.equal(missingJoins.get(row.observation_id).reason,'wrapper_outcome_invocation_required');
    assert.equal(integration.joinLifecycle({...result,observation_id:result.observation_id+':repeat',occurrence_id:result.observation_id+':repeat:occurrence',evidence_ids:[result.observation_id+':repeat']}).reason,'duplicate_wrapper_outcome');
    const before=await page.evaluate(()=>{recorder.stop();return records.length;});await page.click('#forward');
    assert.equal(await page.evaluate(()=>records.length),before);assert.deepEqual(errors,[]);
    console.log(JSON.stringify({apis:['react/forwardRef/18.3.1','react/memo/18.3.1'],build,hydration:hydrate,strict_mode:strict,strict_boundary_semantics:strict?'element_description_only':'not_exercised',default_memo:defaultMemo,sibling_owners_verified:siblings,click_to_exact_wrapper_owner:true,actual_clicks:selectors.length*2+1,
      installed_source_attested:true,constructor_observations:constructors.length,source_redirect_to_actual_controls:true,
      rendered_effects_match_selected_component:true,ref_delivery_observed_by_test:true,memo_comparison_and_remount_observed_by_test:true,
      diagnostic_replay_ref_abstained:build==='development'?diagnosticRows.length>0:true,
      forwarded_ref_argument_verified:true,ref_replacement_null_callback_object:true,ref_evidence_mutations_rejected:mutations.length,
      object_ref_getter_not_read:true,original_ref_setter_receiver_preserved:true,ref_attachment_proof:'unproven',ref_cleanup_proof:'unproven',stop_preserves_behavior:true,hydration_dom_reused:hydrate,wrapper_creation_to_body_entries:invocations.length,original_function_identity_preserved:true,
      outside_renderer_call_abstained:true,wrapper_callback_execution_proof:'observed_named_component_body',
      body_outcome_joins:outcomes.length,body_outcome_mutations_rejected:changedOutcomes.length,missing_invocation_outcomes_rejected:true,
      original_output_values_verified:true,diagnostic_throws_joined:diagnosticRows.length,
      direct_renderer_dispatch_proof:'unproven',callback_completion_proof:'observed_body_outcome',comparator_bailout_runtime_proof:'unproven'},null,2));
  } finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
} finally {fs.rmSync(temporary,{recursive:true,force:true});}
