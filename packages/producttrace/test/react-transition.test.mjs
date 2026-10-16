import test from 'node:test';import assert from 'node:assert/strict';
import {compileReactSources} from '../analysis/react-compiler.mjs';import {createReactRuntimeIntegration} from '../analysis/runtime-join.mjs';
import {getReactBehavior} from '../analysis/react-behavior.mjs';import {planTransitionResult,validateReactExecutionRule} from '../analysis/react-execution-rule.mjs';
const rule=getReactBehavior({surface:'react',exportName:'useTransition',version:'18.3.1'}).execution;
test('transition tuple checks retain the start identity without executing it or a getter',()=>{
  let calls=0;const start=()=>{calls++;};assert.equal(validateReactExecutionRule(rule).valid,true);
  assert.equal(validateReactExecutionRule({...rule,pending_index:1}).valid,false);
  assert.equal(validateReactExecutionRule({...rule,commit:true}).valid,false);
  assert.equal(planTransitionResult(rule,{tuple:[false,start],owner:'left'}).operation,'store');
  assert.equal(planTransitionResult(rule,{tuple:[true,start],owner:'left',previous:{owner:'left',start}}).operation,'retain');
  assert.equal(planTransitionResult(rule,{tuple:[false,()=>{}],owner:'left',previous:{owner:'left',start}}).reason,'transition_start_changed');
  assert.equal(planTransitionResult(rule,{tuple:[false,start],owner:'right',previous:{owner:'left',start}}).reason,'transition_owner_mismatch');
  const getter=[];Object.defineProperty(getter,'0',{get(){throw Error('must not read');}});
  assert.equal(planTransitionResult(rule,{tuple:getter,owner:'left'}).status,'unresolved');assert.equal(calls,0);
});
test('transition start source resolves a const tuple and keeps unsupported callback shapes explicit',()=>{
  const source=`import * as React from 'react';export function App(){const [pending,start]=React.useTransition();let [p,mutable]=React.useTransition();
    const callback=()=>fetch('/named');return <><button onClick={()=>start(()=>fetch('/inline'))}/>
    <button onClick={()=>mutable(()=>fetch('/mutable'))}/><button onClick={()=>start(callback)}/></>;}`;
  const map=compileReactSources({'transition.tsx':source},{packages:{react:{version:'18.3.1',verified:true,verification_sha256:'fixture'}}});
  const runtime=createReactRuntimeIntegration(map),entries=runtime.bindings.react_lifecycle.entries;
  const starts=entries.filter(row=>row.transition_hook_call_id);assert.equal(starts.length,2);
  assert.equal(starts[0].hook_owned,true);assert.ok(map.nodes.find(row=>row.id===starts[0].scope_callback_source_id).text.includes('/inline'));
  const transformed=runtime.instrumentSource('transition.tsx',source);assert.deepEqual(transformed.diagnostics,[]);
  assert.match(transformed.code,/scopeCall\([^]*?\(\) => \(globalThis\.__productTraceReactLifecycle\.scopeTarget\(/);
  assert.match(transformed.code,/mutable\(\(\)=>fetch\('\/mutable'\)\)/);
  assert.ok(starts.some(row=>!row.scope_callback_source_id && row.scope_callback_candidates.length===1));
  assert.match(transformed.code,/tagSource/);
});
test('pending conditions bind the original hook boolean and exclude aliases and shadowed names',()=>{
  const source=`import * as React from 'react';function App(){const [pending,start]=React.useTransition();const alias=pending;
    if(pending) window.read();const later=()=>pending?'later':'not later';{const pending=false;if(pending)window.shadow();}
    return <span>{pending?'Busy':'Ready'}{alias?'Alias':'Ready'}</span>;}`;
  const map=compileReactSources({'pending.tsx':source},{packages:{react:{version:'18.3.1',verified:true,verification_sha256:'fixture'}}});
  const reads=map.react_semantics.find(row=>row.export==='useTransition').causal_bindings.pending_branch_reads;
  assert.equal(reads.length,2);assert.equal(reads.filter(row=>row.falsy_source_id===null).length,1);
  const transformed=createReactRuntimeIntegration(map).instrumentSource('pending.tsx',source);
  assert.deepEqual(transformed.diagnostics,[]);assert.equal((transformed.code.match(/transitionPendingUse/g)||[]).length,2);
});
