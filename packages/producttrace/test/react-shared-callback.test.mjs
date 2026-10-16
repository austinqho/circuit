import test from 'node:test';import assert from 'node:assert/strict';import ts from 'typescript';
import {compileReactSources} from '../analysis/react-compiler.mjs';
import {createReactRuntimeIntegration} from '../analysis/runtime-join.mjs';
import {createReactLifecycleEvidenceSession} from '../analysis/react-lifecycle-evidence.mjs';
const packages={react:{version:'18.3.1',verified:true,verification_sha256:'fixture'}};
function fixture(body='function shared(event){send(event);}') {
 const source=`import * as React from 'react';${body}
 export function App(){const first=React.useCallback(shared,[]),second=React.useCallback(shared,[]);
 return <><button onClick={first}>First</button><button onClick={second}>Second</button></>;}`;
 const map=compileReactSources({'shared.tsx':source},{packages}),integration=createReactRuntimeIntegration(map);
 return {source,map,integration,entries:integration.bindings.react_lifecycle.entries};
}
test('shared named callback redirects retain each source hook without replacing the function',()=>{
 const {source,map,integration,entries}=fixture();
 const selected=entries.filter(row=>row.kind==='shared_retained_result');assert.equal(selected.length,2);
 assert.equal(new Set(selected.map(row=>row.callback_source_id)).size,1);
 assert.equal(new Set(selected.map(row=>row.source_call_id)).size,2);
 assert.equal(entries.filter(row=>row.kind==='shared_retained_body').length,1);
 assert.equal(entries.filter(row=>row.kind==='retained_callback').length,0);
 assert.equal(integration.candidates.length,2);
 for(const event of entries.filter(row=>row.kind==='event_callback')){
 assert.equal(event.scenario_options.length,1);assert.equal(event.scenario_options[0].retained_producer_call_ids.length,1);
 assert.ok(selected.some(row=>row.source_call_id===event.scenario_options[0].retained_producer_call_ids[0]));}
 const transformed=integration.instrumentSource('shared.tsx',source);assert.deepEqual(transformed.diagnostics,[]);
 const transpiled=ts.transpileModule(transformed.code,{reportDiagnostics:true,compilerOptions:{jsx:ts.JsxEmit.React}});
 assert.deepEqual(transpiled.diagnostics.map(row=>ts.flattenDiagnosticMessageText(row.messageText,' ')),[]);
 assert.equal((transformed.code.match(/\.sharedRetainedBody\(/g)||[]).length,1);
 assert.equal((transformed.code.match(/\.sharedRetainedResult\(/g)||[]).length,2);
 assert.ok(map.edges.some(row=>row.relation==='event_handler' && row.producer_call_id===selected[0].source_call_id));
});
test('shared callbacks with mutable, async, generator, direct-eval or shadowed source stay outside named body scope',()=>{
 for(const body of [
 'let shared=function named(event){send(event);};shared=window.other;',
 'const shared=(event)=>eval(event);', 'async function shared(event){send(event);}',
 'function* shared(event){yield event;}', 'function shared(arguments){send(arguments);}',
 'function shared(event){function shared(){};send(event);}',
 'function shared(event){var {value:shared}=event;send(event);}',
 ]){const {entries}=fixture(body);assert.equal(entries.filter(row=>row.kind==='shared_retained_body').length,0,body);}
 const {source}=fixture();const map=compileReactSources({'shared.tsx':source},{packages:{react:{version:'19.0.0',verified:true,verification_sha256:'different'}}});
 assert.equal(createReactRuntimeIntegration(map).bindings.react_lifecycle.entries.filter(row=>row.kind==='shared_retained_result').length,0);
});
test('shared selection proves a hook return without inventing a creation render or body entry',()=>{
 const {map,entries}=fixture(),entry=entries.find(row=>row.kind==='shared_retained_result');
 const record=(id,operation,extra={})=>({schema:'producttrace.react-lifecycle-observation.v1',kind:'react_lifecycle',
 map_fingerprint:map.fingerprint,observation_id:'s:'+id,occurrence_id:'s:'+id+':occurrence',evidence_ids:['s:'+id],session:'s',
 runtime_observed:true,operation,source_call_id:entry.source_call_id,semantic_id:entry.semantic_id,owner_source_id:entry.owner_source_id,
 root_id:'root',instance_id:'instance',mount_id:'mount',render_id:'render',hook_slot_id:'hook',...extra});
 const selected=record('selected','shared_callback_selected',{callback_source_id:entry.callback_source_id,
 callback_slot:entry.callback_slot,callback_identity_id:'s:function'});
 for(const mutation of [{callback_source_id:'wrong'}, {callback_identity_id:'outside:function'}, {runtime_observed:false},
 {callback_slot:'arguments.1'}, {owner_source_id:'wrong'}, {render_id:'missing'}, {session:''}]){
 const check=createReactLifecycleEvidenceSession(map);check.join(record('attempt','render_attempted'));
 assert.equal(check.join({...selected,...mutation}).status,'unresolved');
 const result=check.join(selected);assert.equal(result.status,'resolved');assert.equal(result.runtime.claim,'observed_hook_return');
 assert.equal(result.runtime.creation_render_proven,false);assert.equal(result.runtime.body_execution_proven,false);}
 const check=createReactLifecycleEvidenceSession(map);assert.equal(check.join(selected).reason,'shared_callback_render_required');
 check.join(record('attempt','render_attempted'));assert.equal(check.join(selected).status,'resolved');
 assert.equal(check.join({...selected,...record('second','shared_callback_selected'),callback_identity_id:'s:other'}).reason,'duplicate_shared_callback_selection');
 check.join(record('commit','render_committed'));check.join(record('unmount','unmounted'));
 assert.equal(check.join({...selected,...record('after','shared_callback_selected')}).reason,'mount_already_unmounted');
});
test('two JSX placements remain ambiguous until source occurrence can be disambiguated',()=>{
 const {source}=fixture();const expanded=source+'\nfunction Tree(){return <><App/><App/></>;}';
 const map=compileReactSources({'shared.tsx':expanded},{packages}),integration=createReactRuntimeIntegration(map);
 assert.ok(integration.diagnostics.some(row=>row.code==='ambiguous_source_stamp'));
 assert.equal(integration.candidates.length,0,'callback ownership cannot bypass an ambiguous control stamp');
});

test('shared expression factories instrument both concise arrows and anonymous functions',()=>{
 for(const body of ['const shared=(event)=>send(event);','const shared=function(event){return send(event);};']) {
 const {source,integration,entries}=fixture(body);assert.equal(entries.find(row=>row.kind==='shared_retained_body').body_kind,'factory');
 const transformed=integration.instrumentSource('shared.tsx',source);assert.deepEqual(transformed.diagnostics,[]);
 const result=ts.transpileModule(transformed.code,{reportDiagnostics:true,compilerOptions:{jsx:ts.JsxEmit.React}});
 assert.deepEqual(result.diagnostics.map(row=>ts.flattenDiagnosticMessageText(row.messageText,' ')),[]);
 assert.equal((transformed.code.match(/\.sharedRetainedDefine\(/g)||[]).length,1);
 assert.equal((transformed.code.match(/\.sharedRetainedResult\(/g)||[]).length,2);
 }
});

test('shared body reader rejects malformed packets without throwing or accepting nonfinite values',()=>{
 const {map,integration,entries}=fixture(),entry=entries.find(row=>row.kind==='shared_retained_body');
 const base={schema:'producttrace.react-shared-callback.v1',kind:'react_shared_callback',session:'s',runtime_observed:true,
 map_fingerprint:map.fingerprint,manifest_key:entry.key,observation_id:'s:body',occurrence_id:'s:body:occurrence',evidence_ids:['s:body'],
 callback_source_id:entry.callback_source_id,callback_identity_id:'s:callback',arguments_observed:true,arguments:[],captured_values:[]};
 for(const mutation of [{evidence_ids:'s:body'},{evidence_ids:{}},{arguments:[null]},{captured_values:[null]},
 {arguments:[{value_id:'s:arg',value:{encoding:'primitive',value:Infinity}}]}]){
 const result=integration.joinSharedCallback({...base,...mutation});assert.equal(result.status,'unresolved');
 assert.ok(['invalid_shared_callback_observation','shared_callback_values_invalid'].includes(result.reason));}
});

test('imported callbacks follow exact immutable implementations and reexports within the source set',()=>{
 for(const implementation of ['export function original(event){send(event);}', 'export const original=(event)=>send(event);']){
 const files={'callback.ts':implementation,'barrel.ts':"export {original as shared} from './callback';",
 'App.tsx':"import {useCallback} from 'react';import {shared} from './barrel';export function App(){const callback=useCallback(shared,[]);return <button type='button' onClick={callback}>Click</button>; }"};
 const map=compileReactSources(files,{packages}),integration=createReactRuntimeIntegration(map),entries=integration.bindings.react_lifecycle.entries;
 const returned=entries.find(row=>row.kind==='shared_retained_result'),body=entries.find(row=>row.kind==='shared_retained_body');
 assert.ok(returned);assert.equal(returned.callback_source_id,body.callback_source_id);
 assert.equal(map.nodes.find(row=>row.id===body.callback_source_id).file,'callback.ts');
 assert.equal(integration.candidates.length,1);assert.ok(integration.instrumentSource('callback.ts',implementation).code.includes('sharedRetained'));
 assert.ok(integration.instrumentSource('App.tsx',files['App.tsx']).code.includes('sharedRetainedResult'));
 assert.equal(integration.instrumentSource('callback.ts',implementation+'\nchanged();').applied.length,0);
 }
});
test('missing, mutable, declaration-only and cyclic imported implementations keep a frontier',()=>{
 const app="import {useCallback} from 'react';import {shared} from './callback';export function App(){const callback=useCallback(shared,[]);return <button onClick={callback}>Click</button>; }";
 for(const extra of [{}, {'callback.ts':'export let shared=(event)=>send(event);'},
 {'callback.ts':'export function shared(event){send(event);} shared=window.other;'},
 {'callback.d.ts':'export declare function shared(event:unknown):void;'},
 {'callback.ts':"export {shared} from './cycle';",'cycle.ts':"export {shared} from './callback';"}]) {
 const integration=createReactRuntimeIntegration(compileReactSources({'App.tsx':app,...extra},{packages}));
 assert.equal(integration.bindings.react_lifecycle.entries.some(row=>row.kind==='shared_retained_result'),false);
 assert.ok(integration.bindings.react_lifecycle.frontiers.some(row=>row.reason==='retained_callback_source_shape_unsupported'));
 }
});

test('retained callbacks resolve namespace exports without treating object properties as immutable modules',()=>{
 for(const access of ['callbacks.shared',"callbacks['shared']"]){
  const files={'callback.ts':'export function original(event){send(event);}', 'barrel.ts':"export {original as shared} from './callback';",
   'App.tsx':`import {useCallback} from 'react';import * as callbacks from './barrel';function App(){const selected=useCallback(${access},[]);return <button onClick={selected}/>;}`};
  const map=compileReactSources(files,{packages}),integration=createReactRuntimeIntegration(map),entries=integration.bindings.react_lifecycle.entries;
  const selected=entries.find(e=>e.kind==='shared_retained_result'),body=entries.find(e=>e.kind==='shared_retained_body');
  assert.ok(selected,access);assert.equal(selected.callback_source_id,body.callback_source_id);
  assert.equal(integration.candidates.length,1,'the selected namespace callback must reach an actual source control');
  assert.equal(map.nodes.find(n=>n.id===body.callback_source_id).file,'callback.ts');
  assert.ok(integration.instrumentSource('callback.ts',files['callback.ts']).code.includes('sharedRetainedBody'));
  assert.equal(integration.instrumentSource('callback.ts',files['callback.ts']+'\nchanged();').applied.length,0);
 }
 for(const files of [
  {'callback.ts':'export let shared=(event)=>send(event);'},
  {'callback.ts':'export function shared(event){send(event);}shared=window.other;'},
  {'callback.d.ts':'export declare function shared(event:unknown):void;'},
  {'callback.ts':"export {shared} from './cycle';",'cycle.ts':"export {shared} from './callback';"},
  {},
 ]){
  const source="import {useCallback} from 'react';import * as callbacks from './callback';function App(){const selected=useCallback(callbacks.shared,[]);return <button onClick={selected}/>;}";
  const integration=createReactRuntimeIntegration(compileReactSources({'App.tsx':source,...files},{packages}));
  assert.equal(integration.bindings.react_lifecycle.entries.some(e=>e.kind==='shared_retained_result'),false);
 }
 for(const setup of ["const callbacks={get shared(){throw new Error('getter');}};",'const callbacks={shared:()=>send()};']){
  const source=`import {useCallback} from 'react';${setup}function App(){const selected=useCallback(callbacks.shared,[]);return <button onClick={selected}/>;}`;
  const integration=createReactRuntimeIntegration(compileReactSources({'App.tsx':source},{packages}));
  assert.equal(integration.bindings.react_lifecycle.entries.some(e=>e.kind==='shared_retained_result'),false);
 }
});
