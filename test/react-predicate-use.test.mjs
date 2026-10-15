import test from 'node:test';import assert from 'node:assert/strict';
import {createReactPredicateUseObserver,checkReactPredicateUse} from '../analysis/react-predicate-use.mjs';
import {compileReactSources} from '../analysis/react-compiler.mjs';
import {createReactRuntimeIntegration} from '../analysis/runtime-join.mjs';
import ts from 'typescript';

test('predicate instrumentation preserves directives, avoids names and consumes after the call returns',()=>{
 const prefix="import * as React from 'react';function yes(){}function no(){}function App(){return <button onClick={";
 const collision=`__productTracePredicateFrame${prefix.length}`;
 const source=prefix+`()=>{'use strict';const ${collision}=1;if(React.isValidElement(window.value))yes();else no();}}/>;}`;
 const packages={react:{version:'18.3.1',verified:true,verification_sha256:'fixture'}};
 const map=compileReactSources({'App.tsx':source},{packages}),integration=createReactRuntimeIntegration(map),output=integration.instrumentSource('App.tsx',source);
 assert.deepEqual(output.diagnostics,[]);assert.ok(output.code.includes(`const ${collision}_=`));
 const parsed=ts.createSourceFile('App.tsx',output.code,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);assert.deepEqual(parsed.parseDiagnostics,[]);
 let condition,callback;const scan=n=>{if(ts.isIfStatement(n))condition=n.expression;if(ts.isArrowFunction(n)&&ts.isBlock(n.body))callback=n;ts.forEachChild(n,scan);};scan(parsed);
 assert.equal(callback.body.statements[0].expression.text,'use strict');
 assert.equal(condition.expression.name.text,'predicateUse');assert.equal(condition.arguments[2].expression.name.text,'predicateCall');
 const unsafe=source.replace("'use strict';","'use strict';eval('1');");
 const unsafeRuntime=createReactRuntimeIntegration(compileReactSources({'App.tsx':unsafe},{packages}));
 assert.equal(unsafeRuntime.bindings.react_lifecycle.entries.some(e=>e.kind==='predicate_frame'),false);
 assert.ok(unsafeRuntime.bindings.react_lifecycle.frontiers.some(e=>e.reason==='predicate_containing_body_unobserved'));
});

test('predicate frames retain occurrences rather than matching equal booleans',()=>{
  let context='s',enabled=true,seq=0;const records=[];
  const entry={kind:'predicate_use',predicate_origin_key:'call',source_call_id:'source',condition_source_id:'condition',inverted:false};
  const observer=createReactPredicateUseObserver({context:()=>context,enabled:()=>enabled,entry:()=>entry,id:kind=>`${context}:${kind}:${++seq}`,
    observe:r=>records.push(r),scopeCall:(_key,run,done)=>{
      let value;try{value=run();done({scope_id:`${context}:call:${++seq}`,outcome:'returned',result:{kind:typeof value,value}});return value;}
      catch(e){done({scope_id:`${context}:call:${++seq}`,outcome:'threw',result:{kind:typeof e}});throw e;}
    }});
  const a=observer.predicateFrame(),b=observer.predicateFrame();
  assert.equal(observer.predicateCall('call',a,()=>true),true);
  assert.equal(observer.predicateCall('call',b,()=>true),true);
  observer.predicateUse('use',a,true);observer.predicateUse('use',b,true);
  assert.notEqual(records[0].source_scope_id,records[1].source_scope_id);
  observer.predicateUse('use',observer.predicateFrame(),true);assert.equal(records.at(-1).frontier,'predicate_call_occurrence_unobserved');
  const error={original:true};assert.throws(()=>observer.predicateCall('call',a,()=>{throw error;}),e=>e===error);
  observer.predicateUse('use',a,true);assert.equal(records.at(-1).frontier,'predicate_call_occurrence_unobserved');
  const length=records.length;context='next';observer.predicateUse('use',b,true);assert.equal(records.length,length);
  enabled=false;assert.equal(observer.predicateCall('call',observer.predicateFrame(),()=>false),false);assert.equal(records.length,length);
});

test('consumption requires the exact accepted predicate call, condition and value',()=>{
 const entry={kind:'predicate_use',source_call_id:'source',condition_source_id:'condition',inverted:false};
 const record={schema:'producttrace.react-predicate-use.v1',kind:'react_predicate_use',runtime_observed:true,
   map_fingerprint:'map',session:'s',observation_id:'s:use',occurrence_id:'s:use:occurrence',evidence_ids:['s:use'],
   source_call_id:'source',condition_source_id:'condition',source_scope_id:'s:call',source_frame_id:'s:frame',value:true,action_occurrence_id:'s:action'};
 const origin={status:'resolved',observation_id:'s:origin',source:{source_call_id:'source'},runtime:{session:'s',predicate_proof:{
   outcome:'returned',value:true,call:{scope_id:'s:call',source_frame_id:'s:frame',action_occurrence_id:'s:action'},
   candidates:[{predicate_condition:{node_id:'condition'}}]}}};
 const check=(r=record,o=origin,e=entry)=>checkReactPredicateUse(r,o,{fingerprint:'map',entry:e});
 assert.equal(check().status,'resolved');assert.equal(check().runtime.target_execution_observed,false);
 for(const change of [{session:'other'},{map_fingerprint:'other'},{source_scope_id:'s:other'},{value:false},
   {condition_source_id:'other'},{source_call_id:'other'},{action_occurrence_id:'s:other'},
   {frontier:'predicate_call_occurrence_unobserved'},{observation_id:'foreign'}])assert.equal(check({...record,...change}).status,'unresolved');
 assert.equal(check(record,null).status,'unresolved');
 assert.equal(check({...record,value:false},origin,{...entry,inverted:true}).status,'resolved');
 assert.equal(check(record,{...origin,status:'unresolved'}).status,'unresolved');
 assert.equal(check(record,{status:'resolved'}).status,'unresolved');
 assert.equal(check(record,origin,{...entry,inverted:'false'}).status,'unresolved');
});
