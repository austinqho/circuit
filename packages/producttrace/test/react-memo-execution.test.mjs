import test from 'node:test';
import assert from 'node:assert/strict';
import {compileReactSources} from '../analysis/react-compiler.mjs';
import {createReactLifecycleEvidenceSession} from '../analysis/react-lifecycle-evidence.mjs';
import {createReactRuntimeIntegration} from '../analysis/runtime-join.mjs';
const packages={react:{version:'18.3.1',verified:true,verification_sha256:'fixture'}};

test('selected memo calculators keep source alternatives and actual event-consumption transforms',()=>{
  for(const select of ['pick ? first : second','chosen']){
    const source=`import {useMemo} from 'react';function send(v){}function other(v){}
      function Child({pick,value}){const first=()=>()=>send(value);const second=()=>()=>other(value);
        const chosen=pick?first:second;const cached=useMemo(${select},[value]);return <button onClick={cached}/>;}
      export function App(){return <Child pick={true} value="CURRENT"/>;}`;
    const map=compileReactSources({'App.tsx':source},{packages}),slot=map.react_semantics[0].causal_bindings.callbacks[0];
    assert.equal(slot.dynamic_source,true);assert.equal(slot.candidates.length,2);
    assert.ok(slot.candidates.every(c=>c.captures.some(v=>map.nodes.find(n=>n.id===v.read_id)?.text==='value')));
    assert.equal(map.controls[0].callback_selection,'runtime_required');assert.equal(map.controls[0].handler_ids.length,2);
    assert.equal(JSON.stringify(map.edges.filter(e=>e.relation==='call')).includes('CURRENT'),false);
    const runtime=createReactRuntimeIntegration(map),transform=runtime.instrumentSource('App.tsx',source);
    assert.deepEqual(transform.diagnostics,[]);
    assert.equal(runtime.bindings.react_lifecycle.entries.filter(e=>e.kind==='dynamic_memo').length,1);
    assert.equal(runtime.bindings.react_lifecycle.entries.filter(e=>e.kind==='event_callback').length,1);
    assert.ok(transform.code.includes('.dynamicMemo('));assert.ok(transform.code.includes('.memoResult('));
  }
  for(const select of ['unknown ? external : first','async()=>()=>send()','()=>{while(true){}return ()=>send();}']){
    const source=`import {useMemo} from 'react';function send(){}export function App({unknown,external}){
      const first=()=>()=>send();const cached=useMemo(${select},[]);return <button onClick={cached}/>;}`;
    const map=compileReactSources({'App.tsx':source},{packages});
    assert.equal(map.controls[0].status,'unresolved');assert.ok(map.react_backlog.some(r=>r.reason.startsWith('memo_calculator_')));
  }
});

test('dynamic memo source verification precedes invocation and cached-value admission',()=>{
  const map=compileReactSources({'App.tsx':`import {useMemo} from 'react';export function App(){
    const calculator=()=>1;const cached=useMemo(calculator,[]);return null;}`},{packages});
  const source=map.react_semantics[0],slot=source.causal_bindings.callbacks[0],candidate=slot.candidates[0];let sequence=0;
  const origin={session:'s',source_id:candidate.source_id,callback_identity_id:'fn'};
  const reader=createReactLifecycleEvidenceSession(map,{resolveCallbackSource:id=>id==='receipt'?origin:null});
  const record=(operation,extra={})=>({schema:'producttrace.react-lifecycle-observation.v1',kind:'react_lifecycle',
    observation_id:`o${++sequence}`,occurrence_id:`c${sequence}`,evidence_ids:[`e${sequence}`],session:'s',map_fingerprint:map.fingerprint,
    source_call_id:source.call_id,semantic_id:source.semantic_id,owner_source_id:source.causal_bindings.owner_source_id,
    root_id:'root',instance_id:'a',mount_id:'a',render_id:'r',hook_slot_id:'hook',operation,...extra});
  assert.equal(reader.join(record('render_attempted')).status,'resolved');
  const invoke=record('callback_invoked',{callback_slot:slot.slot,callback_source_id:candidate.source_id,invocation_id:'calculation',
    memo_callback_origin:{source_observation_id:'receipt',source_id:candidate.source_id,callback_identity_id:'fn'}});
  for(const change of [{session:'foreign'},{memo_callback_origin:null},
    {memo_callback_origin:{...invoke.memo_callback_origin,source_id:'wrong'}},
    {memo_callback_origin:{...invoke.memo_callback_origin,callback_identity_id:'wrong'}}])
    assert.equal(reader.join({...invoke,...change}).reason,'memo_calculator_source_receipt_required');
  assert.equal(reader.join(invoke).status,'resolved','bad receipts must not poison the invocation cache');
  const product=record('value_produced',{production_id:'p',value_id:'v',value:{encoding:'primitive',value:1},caused_by_invocation_id:'calculation'});
  assert.equal(reader.join({...product,memo_source_frontier:true}).reason,'memo_calculator_source_unobserved');
  assert.equal(reader.join(product).status,'resolved');
  const isolated=createReactLifecycleEvidenceSession(map);isolated.join(record('render_attempted'));
  assert.equal(isolated.join(invoke).reason,'memo_calculator_source_receipt_required','direct readers must not trust embedded origin claims');
});

test('cached callback and object shapes expose their source path without current-render captures',()=>{
  for(const [calculate,handler] of [['()=>()=>send(value)','cached'],['()=>({send:()=>send(value)})','cached.send']]) {
    const map=compileReactSources({'App.tsx':`import {useMemo} from 'react';function send(value){}
      export function App({value}){const cached=useMemo(${calculate},[value]);return <button type="button" onClick={${handler}}>Send</button>;}`},{packages});
    assert.equal(map.controls.length,1);assert.equal(map.controls[0].status,'resolved');
    assert.ok(map.edges.some(row=>row.relation==='react_callback_value' && row.react_semantic_id==='react/useMemo/18.3.1'));
    assert.ok(map.edges.some(row=>row.relation==='call' && map.nodes.find(node=>node.id===row.to)?.text.startsWith('function send')));
    assert.ok(map.diagnostics.some(row=>row.code==='memoized_value_capture_unresolved'));
    assert.equal(map.diagnostics.some(row=>row.code==='unsupported_hook'),false);
  }
});

test('exceptional and asynchronous memo calculator results remain explicit frontiers',()=>{
  for(const calculate of ['()=>{try{return ()=>send();}catch{return ()=>other();}}','async()=>()=>send()']) {
    const map=compileReactSources({'App.tsx':`import {useMemo} from 'react';function send(){}function other(){}
      export function App({value}){const cached=useMemo(${calculate},[value]);return <button type="button" onClick={cached}>Send</button>;}`},{packages});
    assert.equal(map.controls.some(row=>row.status==='resolved'),false);
    assert.ok(map.react_backlog.some(row=>['memo_calculator_source_unresolved','memo_calculator_return_unresolved'].includes(row.reason)));
  }
});

test('memo values require their real calculation, owner, source hook, value token, and committed cache origin',()=>{
  const map=compileReactSources({'App.tsx':`import {useMemo} from 'react';export function App(){const value=useMemo(()=>1,[]);return null;}`},{packages});
  const semantic=map.react_semantics[0],callback=semantic.causal_bindings.callbacks[0];let id=0;
  const session=createReactLifecycleEvidenceSession(map);
  const record=(operation,extra={})=>({schema:'producttrace.react-lifecycle-observation.v1',kind:'react_lifecycle',
    observation_id:`o${++id}`,occurrence_id:`c${id}`,evidence_ids:[`e${id}`],map_fingerprint:map.fingerprint,
    source_call_id:semantic.call_id,semantic_id:semantic.semantic_id,owner_source_id:semantic.causal_bindings.owner_source_id,
    root_id:'root',instance_id:'a',mount_id:'a',render_id:'old',hook_slot_id:'h',operation,...extra});
  const emit=(operation,extra)=>session.join(record(operation,extra));
  assert.equal(emit('render_attempted').status,'resolved');
  const product={production_id:'p',value_id:'v',value:{encoding:'primitive',value:1},caused_by_invocation_id:'calculator'};
  assert.equal(emit('value_produced',product).reason,'memo_calculation_invocation_required');
  assert.equal(emit('callback_invoked',{callback_slot:callback.slot,callback_source_id:callback.source_id,invocation_id:'calculator'}).status,'resolved');
  assert.equal(emit('value_produced',product).status,'resolved');
  assert.equal(emit('value_produced',product).reason,'duplicate_value_production');
  assert.equal(emit('render_attempted',{render_id:'next'}).status,'resolved');
  const selection={production_id:'p',value_id:'v',value:{encoding:'primitive',value:1},render_id:'next',origin_render_id:'old'};
  assert.equal(emit('value_selected',selection).reason,'memo_cache_commit_required');
  assert.equal(emit('render_committed').status,'resolved');
  assert.equal(emit('value_selected',{...selection,value_id:'other'}).reason,'memo_value_lineage_mismatch');
  assert.equal(emit('value_selected',{...selection,value:{encoding:'primitive',value:2}}).reason,'memo_value_lineage_mismatch');
  assert.equal(emit('value_selected',{...selection,origin_render_id:'other'}).reason,'memo_value_origin_mismatch');
  assert.equal(emit('value_selected',selection).status,'resolved');
  assert.equal(emit('render_attempted',{instance_id:'b',mount_id:'b',render_id:'next'}).status,'resolved');
  assert.equal(emit('value_selected',{...selection,instance_id:'b',mount_id:'b'}).reason,'memo_value_lineage_mismatch');
});

test('cached return shapes never borrow concrete props from a newer render',()=>{
  const map=compileReactSources({'App.tsx':`import {useMemo} from 'react';function send(value){}
    function Child({value}){const callback=useMemo(()=>()=>{send(value);send('fixed');},[value]);return <button type="button" onClick={callback}>Send</button>;}
    export function App(){return <Child value="NEW_RENDER_VALUE"/>;}`},{packages});
  const sends=map.edges.filter(row=>row.relation==='call' && map.nodes.find(node=>node.id===row.to)?.text.startsWith('function send'));
  assert.equal(sends.length,2);
  assert.equal(JSON.stringify(sends.flatMap(row=>row.arguments)).includes('NEW_RENDER_VALUE'),false);
  assert.ok(JSON.stringify(sends.flatMap(row=>row.arguments)).includes('fixed'));
});


test('memo callback consumption rejects foreign production, callback, capture, owner, and action evidence',()=>{
  const map=compileReactSources({'App.tsx':`import {useMemo} from 'react';
    export function App({value}){const cached=useMemo(()=>({send:()=>value}),[value]);
      return <button type="button" onClick={cached.send}>Send</button>;}`},{packages});
  const semantic=map.react_semantics[0],calculator=semantic.causal_bindings.callbacks[0];
  const binding=semantic.causal_bindings.result_callbacks[0];
  const session=createReactLifecycleEvidenceSession(map);let id=0;
  const record=(operation,extra={})=>({schema:'producttrace.react-lifecycle-observation.v1',kind:'react_lifecycle',
    observation_id:`o${++id}`,occurrence_id:`c${id}`,evidence_ids:[`e${id}`],map_fingerprint:map.fingerprint,
    source_call_id:semantic.call_id,semantic_id:semantic.semantic_id,owner_source_id:semantic.causal_bindings.owner_source_id,
    root_id:'root',instance_id:'a',mount_id:'a',render_id:'old',hook_slot_id:'h',operation,...extra});
  const emit=(operation,extra)=>session.join(record(operation,extra));
  assert.equal(emit('render_attempted').status,'resolved');
  assert.equal(emit('callback_invoked',{callback_slot:calculator.slot,callback_source_id:calculator.source_id,invocation_id:'calculate'}).status,'resolved');
  const product={production_id:'p',value_id:'v',value:{encoding:'redacted',value:null},caused_by_invocation_id:'calculate',
    result_callbacks:[{path:binding.path,source_id:binding.source_id,callback_value_id:'fn'}]};
  assert.equal(emit('value_produced',{...product,result_callbacks:[{...product.result_callbacks[0],path:['foreign']}]}).reason,'memo_callback_result_mismatch');
  assert.equal(emit('value_produced',product).status,'resolved');
  assert.equal(emit('render_committed').status,'resolved');
  const invocation={production_id:'p',value_id:'v',callback_source_id:binding.source_id,callback_result_path:binding.path,
    callback_value_id:'fn',invocation_id:'call',action_occurrence_id:'action',captured_values:binding.captures.map(row=>
      ({binding_id:row.binding_id,encoding:'primitive',value:1}))};
  for(const change of [{production_id:'foreign'},{value_id:'foreign'},{render_id:'foreign'},{mount_id:'foreign'}]) {
    assert.equal(emit('memo_callback_invoked',{...invocation,...change}).reason,'memo_callback_lineage_mismatch');
  }
  for(const change of [{callback_source_id:'foreign'},{callback_value_id:'foreign'},{callback_result_path:['foreign']}]) {
    assert.equal(emit('memo_callback_invoked',{...invocation,...change}).reason,'memo_callback_result_mismatch');
  }
  assert.equal(emit('memo_callback_invoked',{...invocation,action_occurrence_id:null}).reason,'callback_action_occurrence_required');
  assert.equal(emit('memo_callback_invoked',{...invocation,captured_values:[{binding_id:'foreign',encoding:'primitive',value:1}]}).reason,'captured_value_binding_mismatch');
  assert.equal(emit('memo_callback_invoked',invocation).status,'resolved');
  assert.equal(emit('unmounted').status,'resolved');
  const escaped=emit('memo_callback_invoked',{...invocation,invocation_id:'after-unmount'});
  assert.equal(escaped.status,'resolved');assert.equal(escaped.runtime.owner_lifecycle,'unmounted');
  assert.equal(escaped.runtime.committed_execution,false);
});


test('conditional memo returns index both callback paths without choosing from current props',()=>{
  for(const [calculate,handler] of [
    ['()=>value ? ()=>send(value) : ()=>other(value)','cached'],
    ['()=>{if(value)return ()=>send(value);return ()=>other(value);}','cached'],
    ['()=>{if(value){return {send:()=>send(value)};}else{return {send:()=>other(value)};}}','cached.send'],
  ]) {
    const map=compileReactSources({'App.tsx':`import {useMemo} from 'react';function send(value){}function other(value){}
      function Child({value}){const cached=useMemo(${calculate},[value]);return <button type="button" onClick={${handler}}>Send</button>;}
      export function App(){return <Child value="CURRENT"/>;}`},{packages});
    assert.equal(map.controls[0].status,'resolved');assert.equal(map.controls[0].callback_selection,'runtime_required');
    assert.equal(map.controls[0].handler_ids.length,2);assert.equal(map.scenarios.length,2);
    assert.equal(map.react_semantics[0].causal_bindings.result_callbacks.length,2);
    assert.deepEqual(map.scenarios.map(row=>row.conditions.at(-1).branch).sort(),['falsy','truthy']);
    assert.equal(JSON.stringify(map.edges.filter(row=>row.relation==='call').map(row=>row.arguments)).includes('CURRENT'),false);
  }
  for(const calculate of ['()=>{if(value)return ()=>send();}','()=>{while(value)return ()=>send();return ()=>other();}',
    '()=>{if(value){const local=1;return ()=>send(local);}return ()=>other();}']) {
    const map=compileReactSources({'App.tsx':`import {useMemo} from 'react';function send(){}function other(){}
      export function App({value}){const cached=useMemo(${calculate},[value]);return <button type="button" onClick={cached}/>;}`},{packages});
    assert.equal(map.controls[0].status,'unresolved');
    assert.ok(map.react_backlog.some(row=>row.reason==='memo_calculator_return_unresolved'));
  }
});
