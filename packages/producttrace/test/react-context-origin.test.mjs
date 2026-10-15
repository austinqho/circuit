import test from 'node:test';import assert from 'node:assert/strict';
import {createReactContextObserver} from '../analysis/react-context-runtime.mjs';
function setup(){let enabled=true,session='s',next=0;const records=[];
  const observer=createReactContextObserver({enabled:()=>enabled,context:()=>session,id:kind=>session+':'+kind+':'+(++next),
    entry:()=>({context_id:'source-context',source_call_id:'call',context_rule:{default_argument:0}}),
    encode:value=>value===null || ['string','number','boolean'].includes(typeof value)?{encoding:'primitive',value}:{encoding:'redacted',value:null},
    observe:record=>records.push(record)});
  return {observer,records,stop:()=>{enabled=false;},restart:()=>{enabled=true;session='next';}};}
test('context origins preserve stored function/object identity and distinguish identical-looking values',()=>{
  for(const value of [undefined,null,NaN,-0,{same:true},()=>{throw Error('not called');}]) {
    const {observer,records}=setup(),object={};
    assert.equal(observer.contextCall('key',()=>{observer.contextArgument('key',0,value);return object;}),object);
    const origin=records[0],read=observer.contextReadEvidence(object,value,null);
    assert.equal(read.context_object_id,origin.context_object_id);assert.equal(read.selected_from,'default');
    assert.equal(read.observed_value.identity,read.selected_value.identity);
    const other=observer.contextReadEvidence(object,{same:true},null);
    assert.notEqual(other.observed_value.identity,other.selected_value.identity);
    const provided={same:true},providerRead=observer.contextReadEvidence(object,provided,{status:'source_resolved',raw_value:provided});
    assert.equal(providerRead.selected_from,'provider');assert.equal(providerRead.observed_value.identity,providerRead.selected_value.identity);
  }
});
test('context origin recording preserves exceptions, disabled behavior, and session boundaries',()=>{
  const {observer,records,stop,restart}=setup(),object={};
  observer.contextCall('key',()=>object);assert.equal(records[0].default_value.kind,'undefined');
  observer.contextCall('key',()=>object);assert.equal(records[1].previously_returned,true);
  const error={original:true};assert.throws(()=>observer.contextCall('key',()=>{throw error;}),value=>value===error);
  assert.equal(records.at(-1).outcome,'threw');assert.equal(records.at(-1).context_object_id,undefined);
  stop();const before=records.length;assert.equal(observer.contextCall('key',()=>object),object);assert.equal(records.length,before);
  restart();assert.equal(observer.contextReadEvidence(object,undefined,null),null,'an old creation is not evidence in a new session');
});

test('instrumented context creation joins its exact input and rejects substituted origins and values',async()=>{
  const {compileReactSources}=await import('../analysis/react-compiler.mjs');
  const {createReactRuntimeIntegration}=await import('../analysis/runtime-join.mjs');
  const {createReactContextEvidenceSession}=await import('../analysis/react-context-evidence.mjs');
  const {default:vm}=await import('node:vm');const {default:ts}=await import('typescript');
  const source=`import * as React from 'react';const initial={same:true};const C=React.createContext(initial);globalThis.result={C,initial};function Reader(){const value=React.useContext(C);return <button>{value}</button>;}`;
  const map=compileReactSources({'context.tsx':source},{packages:{react:{version:'18.3.1',verified:true,verification_sha256:'fixture'}}});
  const integration=createReactRuntimeIntegration(map),records=[],runtime=integration.createApiRuntime({session:'s',onObservation:record=>records.push(record)});
  const transform=integration.instrumentSource('context.tsx',source);assert.deepEqual(transform.diagnostics,[]);
  const context={React:{createContext:()=>({})},__productTraceReactLifecycle:runtime};vm.createContext(context);
  vm.runInContext(ts.transpileModule(transform.code.replace("import * as React from 'react';",''),{fileName:'context.tsx',compilerOptions:{target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.React}}).outputText,context);
  const origin=records.find(row=>row.kind==='react_context_origin');assert.ok(origin);
  const session=createReactContextEvidenceSession(map);assert.equal(session.joinOrigin(origin).status,'resolved');
  const packet=runtime.contextReadEvidence(context.result.C,context.result.initial,null);
  const request={session:'s',sourceContextId:origin.source_context_id,defaultUsed:true,observedValue:{encoding:'redacted',value:null},providerValue:null};
  assert.equal(session.joinRead(packet,request).default_value_proven,true);assert.equal(session.joinRead(packet,request).object_value_identity_proven,true);
  assert.equal(session.joinRead({...packet,context_object_id:'s:other'},request).reason,'context_creation_origin_required');
  assert.equal(session.joinRead({...packet,observed_value:{...packet.observed_value,identity:'s:other'}},request).reason,'context_selected_value_mismatch');
  assert.equal(session.joinRead(packet,{...request,sourceContextId:'other'}).reason,'context_creation_origin_required');
  const missing=createReactContextEvidenceSession(map);assert.equal(missing.joinRead(packet,request).reason,'context_creation_origin_required');
  assert.equal(missing.joinOrigin({...origin,default_value:{...origin.default_value,identity:'s:changed'}}).reason,'context_default_input_mismatch');
  assert.equal(session.joinOrigin({...origin,observation_id:'s:new',occurrence_id:'s:new:occurrence',evidence_ids:['s:new'],context_object_id:'s:object:new'}).reason,'context_origin_conflict');
});


test('creation inputs with direct eval keep their original scope and an explicit observation frontier',async()=>{
  const {compileReactSources}=await import('../analysis/react-compiler.mjs');const {createReactRuntimeIntegration}=await import('../analysis/runtime-join.mjs');
  const source=`import * as React from 'react';function App(){const C=React.createContext(eval('var created=7; created'));return <C.Provider value={created}><button/></C.Provider>;}`;
  const map=compileReactSources({'eval.tsx':source},{packages:{react:{version:'18.3.1',verified:true,verification_sha256:'fixture'}}});
  const integration=createReactRuntimeIntegration(map),transform=integration.instrumentSource('eval.tsx',source);
  assert.ok(integration.bindings.react_lifecycle.frontiers.some(row=>row.reason==='context_argument_evaluation_unsupported'));
  assert.ok(!transform.code.includes('.contextCall('));assert.ok(transform.code.includes("eval('var created=7; created')"));
});
