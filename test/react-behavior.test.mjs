import test from 'node:test';
import assert from 'node:assert/strict';
import { REACT_API_INVENTORY } from '../analysis/react-semantics.mjs';
import { getReactBehavior, compareReactDependencies, planReactHookLifecycle } from '../analysis/react-behavior.mjs';
import { compileReactSources } from '../analysis/react-compiler.mjs';

test('every inventoried export has a frozen causal contract, separate from execution support', () => {
  for (const api of REACT_API_INVENTORY) {
    const behavior = getReactBehavior({surface: api.surface, exportName: api.export, version: '18.3.1'});
    assert.ok(behavior, api.id);
    assert.equal(behavior, api.behavior);
    assert.ok(behavior.owner.length && behavior.constraints.length, api.id);
    for (const field of ['callbacks', 'reads', 'writes', 'scheduling', 'constraints']) assert.ok(Array.isArray(behavior[field]), api.id);
    for (const callback of behavior.callbacks) assert.ok(callback.slot && callback.phase && callback.trigger, api.id);
    assert.ok(Object.isFrozen(behavior.callbacks));
  }
  assert.equal(getReactBehavior({surface:'react', exportName:'useEffect', version:'19.0.0'}), null);
});

test('dependency equality follows Object.is and abstains on unknown identity', () => {
  const known = value => ({known:true, value});
  assert.equal(compareReactDependencies([known(NaN)], [known(NaN)]), 'equal');
  assert.equal(compareReactDependencies([known(-0)], [known(0)]), 'invalidate');
  assert.equal(compareReactDependencies([known({})], [known({})]), 'invalidate');
  const identity = {};
  assert.equal(compareReactDependencies([known(identity)], [known(identity)]), 'equal');
  assert.equal(compareReactDependencies([], []), 'equal');
  assert.equal(compareReactDependencies(null, []), 'invalidate');
  assert.equal(compareReactDependencies([{known:false}], [{known:false}]), 'unknown');
  assert.equal(compareReactDependencies([], [known(1)]), 'unknown');
});

test('contracts are instantiated at top-level, nested callbacks, named members and JSX boundaries', () => {
  const map = compileReactSources({'App.tsx': `
    import React, {Children, useEffect, Suspense} from 'react';
    import {createRoot} from 'react-dom/client';
    import {renderToString} from 'react-dom/server';
    const moduleValue = 4;
    function App({id}) {
      useEffect(() => { consume(id, moduleValue); return () => dispose(id); }, [id]);
      const items = Children.map([], child => child);
      return <Suspense fallback={<p>Wait</p>}><button onClick={() => React.startTransition(() => go(id))}>Go</button></Suspense>;
    }
    createRoot(container); renderToString(<App/>);
  `}, {packages: Object.fromEntries(['react','react-dom'].map(name => [name, {version:'18.3.1', verified:true, verification_sha256:name}]))});
  for (const name of ['useEffect','Children','Suspense','startTransition','createRoot','renderToString']) {
    assert.ok(map.react_semantics.some(row => row.export === name), name);
  }
  const effect = map.react_semantics.find(row => row.export === 'useEffect');
  assert.equal(effect.causal_bindings.callbacks[0].resolution, 'inline_source');
  const captureText = effect.causal_bindings.callbacks[0].captures.map(capture => map.nodes.find(node => node.id === capture.binding_id).text).join('\n');
  assert.match(captureText, /id/);
  assert.match(captureText, /moduleValue/);
  assert.equal(effect.causal_bindings.callbacks[1].resolution, 'inline_source');
  assert.match(effect.causal_bindings.callbacks[1].requires,/setup returned a function/);
  const children = map.react_semantics.find(row => row.export === 'Children');
  assert.equal(children.causal_bindings.member, 'map');
  assert.equal(children.causal_bindings.callbacks[0].resolution, 'inline_source');
  assert.ok(map.react_semantics.every(row => row.runtime_observed === false && row.claim === 'source_contract'));
  assert.equal(map.claims.runtime_observed, false);
});

test('lifecycle planner requires the same mounted hook and keeps old cleanup/capture provenance', () => {
  const previous={rootId:'root',instanceId:'a',mountId:'mount-1',slotId:'effect-1',renderId:'old',callbackId:'old-setup',cleanupId:'old-cleanup',committed:true,dependencies:[{known:true,value:1}]};
  const next={...previous,renderId:'new',callbackId:'new-setup',dependencies:[{known:true,value:2}]};
  const plan = input => planReactHookLifecycle({api:'useEffect',version:'18.3.1',event:'commit',previous,next,...input});
  assert.deepEqual(plan({}).operations.map(row=>[row.kind,row.callbackId,row.renderId]),[['cleanup','old-cleanup','old'],['setup','new-setup','new']]);
  assert.equal(plan({next:{...next,dependencies:previous.dependencies}}).operations.length,0);
  assert.equal(plan({event:'abandon'}).operations.length,0);
  assert.equal(plan({environment:'server'}).operations.length,0);
  assert.equal(plan({next:{...next,instanceId:'b'}}).frontier,'different_hook_lifetimes_require_separate_plans');
  assert.equal(plan({next:{...next,mountId:'mount-2'}}).frontier,'different_hook_lifetimes_require_separate_plans');
  assert.equal(plan({previous:{...previous,cleanupId:undefined}}).frontier,'previous_cleanup_result_unproven');
  assert.equal(plan({next:{...next,dependencies:[{known:false}]}}).frontier,'dependency_identity_unproven');
  assert.equal(plan({}).runtime_observed,false);
  assert.deepEqual(plan({previous:null,strictDevelopment:true}).operations.map(row=>row.kind),['setup','cleanup_returned_by','setup']);
  assert.deepEqual(plan({api:'useInsertionEffect',previous:null,strictDevelopment:true}).operations.map(row=>row.kind),['setup']);
  const retained=plan({api:'useCallback',event:'render',previous:{...previous,cacheRetained:true},next:{...next,dependencies:previous.dependencies}});
  assert.equal(retained.operations[0].renderId,'old');assert.equal(retained.operations[0].callbackId,'old-setup');
  assert.equal(plan({api:'useCallback',event:'render'}).frontier,'cache_retention_unproven');
});

test('source tracing applies synchronous React scope contracts without inventing deferred effect execution', () => {
  const source=`import {startTransition,useEffect} from 'react'; import {flushSync,unstable_batchedUpdates} from 'react-dom';
    function send(x) {} function effectOnly() {}
    export function App(){ useEffect(()=>effectOnly(),[]); return <button onClick={()=>{
      startTransition(()=>send('transition')); flushSync(()=>send('flush')); unstable_batchedUpdates(value=>send(value),'batch');
    }}>Run</button> }`;
  const packages=Object.fromEntries(['react','react-dom'].map(name=>[name,{version:'18.3.1',verified:true,verification_sha256:name}]));
  const map=compileReactSources({'App.tsx':source},{packages});
  const calls=map.edges.filter(edge=>edge.relation==='call'&&map.nodes.find(node=>node.id===edge.to)?.text.startsWith('function send'));
  assert.deepEqual(calls.map(edge=>edge.arguments[0].value).sort(),['batch','flush','transition']);
  assert.equal(map.edges.some(edge=>edge.relation==='call'&&map.nodes.find(node=>node.id===edge.to)?.text.startsWith('function effectOnly')),false);
  assert.equal(map.edges.filter(edge=>edge.callback_timing==='synchronous'&&edge.react_semantic_id).length,3);
  const unknown=compileReactSources({'App.tsx':source});
  assert.equal(unknown.edges.some(edge=>edge.callback_timing==='synchronous'&&edge.react_semantic_id),false);
});

test('later spreads and accessors cannot retain an earlier callback input', () => {
  const map=compileReactSources({'App.tsx':`import {Profiler} from 'react';import {createRoot} from 'react-dom/client';
    createRoot(container,{onRecoverableError:()=>wrong(),...unknownOptions});
    createRoot(container,{onRecoverableError:()=>wrong(),get onRecoverableError(){return other;}});
    function App(){return <Profiler onRender={()=>wrong()} {...unknownProps}/>;}`},
    {packages:Object.fromEntries(['react','react-dom'].map(name=>[name,{version:'18.3.1',verified:true,verification_sha256:name}]))});
  assert.equal(map.react_semantics.length,3);
  assert.ok(map.react_semantics.every(row=>row.causal_bindings.callbacks.every(callback=>callback.source_id===null)));
});
