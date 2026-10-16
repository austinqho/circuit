import test from 'node:test';import assert from 'node:assert/strict';
import {compileReactSources} from '../analysis/react-compiler.mjs';
import {createReactRuntimeIntegration} from '../analysis/runtime-join.mjs';
import {getReactBehavior} from '../analysis/react-behavior.mjs';
import {validateReactExecutionRule,planDebugValue} from '../analysis/react-execution-rule.mjs';
const packages={react:{version:'18.3.1',verified:true,verification_sha256:'fixture'}};
const rule=getReactBehavior({surface:'react',exportName:'useDebugValue',version:'18.3.1'}).execution;
test('debug value program separates renderer no-op from external dispatcher behavior',()=>{
 assert.equal(validateReactExecutionRule(rule).valid,true);assert.equal(validateReactExecutionRule({...rule,extra:1}).valid,false);
 assert.equal(planDebugValue(rule).reason,'debug_build_required');
 const value={},formatter=()=>{throw Error('must not invoke');};
 const normal=planDebugValue(rule,{args:[value,formatter],build:'development',dispatcher:'standard_renderer'});
 assert.equal(normal.value,undefined);assert.deepEqual(normal.callbacks,[]);
 const inspect=planDebugValue(rule,{args:[value,formatter],build:'development'});
 assert.equal(inspect.operation,'delegate');assert.deepEqual(inspect.arguments,[value,formatter]);assert.equal(inspect.formatter_invocation,'dispatcher_defined');
 assert.equal(planDebugValue(rule,{args:[value,formatter],build:'production'}).operation,'return');
});
test('Tracer preserves the original debug formatter and does not infer inspection from an API return',()=>{
 const source=`import * as React from 'react';function App(){React.useDebugValue('label',value=>format(value));return <button onClick={()=>send()}>Send</button>;}`;
 const map=compileReactSources({'debug.tsx':source},{packages}),integration=createReactRuntimeIntegration(map);
 const entry=integration.bindings.react_lifecycle.entries.find(row=>row.debug_value_rule);
 assert.ok(entry);assert.equal(integration.bindings.react_lifecycle.entries.filter(row=>row.source_call_id===entry.source_call_id && row.kind==='callback').length,0);
 const result=integration.instrumentSource('debug.tsx',source);assert.deepEqual(result.diagnostics,[]);assert.ok(result.code.includes("'label',value=>format(value)"));
 const rows=[],runtime=integration.createApiRuntime({session:'s',onObservation:row=>rows.push(row)});
 assert.equal(runtime.apiResult(entry.key,undefined),undefined);let joined=integration.joinApi(rows[0]);
 assert.equal(joined.status,'resolved');assert.equal(joined.runtime.debug_value_proof.selected_execution_context,null);
 assert.equal(joined.runtime.debug_value_proof.formatter_execution_proven,false);
 assert.deepEqual(joined.runtime.debug_value_proof.standard_renderer.callbacks,[]);
 // An external dispatcher may return an arbitrary value: do not turn a normal
 // renderer contract into an unconditional result validator.
 assert.equal(runtime.apiResult(entry.key,42),42);joined=integration.joinApi(rows[1]);assert.equal(joined.status,'resolved');
 assert.equal(joined.runtime.debug_value_proof.observed_result_kind,'number');assert.equal(joined.runtime.debug_value_proof.selected_execution_context,null);
 for(const changed of [{semantic_id:'wrong'},{map_fingerprint:'wrong'},{source_call_id:'wrong'},{runtime_observed:false}])assert.equal(integration.joinApi({...rows[0],...changed}).status,'unresolved');
 const unknown=createReactRuntimeIntegration(compileReactSources({'debug.tsx':source},{packages:{react:{version:'19.0.0',verified:true,verification_sha256:'other'}}}));
 assert.ok(!unknown.bindings.react_lifecycle.entries.some(row=>row.debug_value_rule));
});
