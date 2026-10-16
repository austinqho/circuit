import test from 'node:test';import assert from 'node:assert/strict';
import {compileReactSources} from '../analysis/react-compiler.mjs';import {getReactBehavior} from '../analysis/react-behavior.mjs';
import {planComponentWrapper,validateReactExecutionRule} from '../analysis/react-execution-rule.mjs';
const packages={react:{version:'18.3.1',verified:true,verification_sha256:'fixture'}};
test('wrapper plans store the component and comparator without executing either',()=>{
  const render=()=>{throw Error('must not invoke');},compare=()=>{throw Error('must not invoke');};
  for(const api of ['forwardRef','memo']){const rule=getReactBehavior({surface:'react',exportName:api,version:'18.3.1'}).execution;
    assert.equal(validateReactExecutionRule(rule).valid,true);assert.equal(validateReactExecutionRule({...rule,renderNow:true}).valid,false);
    const plan=planComponentWrapper(rule,{args:[render,compare]});assert.equal(plan.status,'planned');assert.equal(plan.fields[rule.component_field],render);assert.deepEqual(plan.callback_operations,[]);
    if(api==='memo'){assert.equal(plan.fields.compare,compare);assert.equal(planComponentWrapper(rule,{args:[render]}).fields.compare,null);}}
});
test('memo cannot mistake an inline comparator for its component',()=>{
  const source=`import * as React from 'react';const Unknown=window.Component;
    const Wrong=React.memo(Unknown,(a,b)=><button onClick={()=>fetch('/wrong')}/>);
    export function App(){return <Wrong/>;}`;
  const map=compileReactSources({'wrapper.tsx':source},{packages});
  assert.ok(!map.components.some(row=>row.name==='Wrong'));
  assert.ok(!map.controls.some(row=>map.nodes.find(node=>node.id===row.source_node_id)?.text.includes('/wrong')));
});
test('nested memo and forwardRef resolve the encoded component input across immutable source bindings',()=>{
  const source=`import * as React from 'react';const render=function(props,ref){return <button onClick={()=>fetch('/correct')}/>;};
    const Forward=React.forwardRef(render);const Memo=React.memo(Forward,(a,b)=>true);export function App(){return <Memo/>;}`;
  const map=compileReactSources({'wrapper.tsx':source},{packages});assert.ok(map.controls.some(row=>map.nodes.find(node=>node.id===row.source_node_id)?.text.includes('/correct')));
  const wrongVersion=compileReactSources({'wrapper.tsx':source},{packages:{react:{version:'19.0.0',verified:true,verification_sha256:'other'}}});
  assert.ok(!wrongVersion.components.some(row=>row.name==='Memo'||row.name==='Forward'));
});

// These records exercise rejection independently of the browser probe. The
// acceptance fixture separately obtains the records from the actual renderer.
import {createReactRuntimeIntegration} from '../analysis/runtime-join.mjs';
import {createReactLifecycleEvidenceSession} from '../analysis/react-lifecycle-evidence.mjs';
function wrapperFixture(api='forwardRef') {
  const source=`import * as React from 'react';const Wrapped=React.${api}(function Render(props,ref){return <button onClick={()=>send(props.value)}/>;});export function App(){return <Wrapped/>;}`;
  const map=compileReactSources({'wrapper.tsx':source},{packages});
  const integration=createReactRuntimeIntegration(map),entries=integration.bindings.react_lifecycle.entries;
  const returned=entries.find(row=>row.kind==='wrapper_return'),callback=entries.find(row=>row.kind==='wrapper_callback');
  const occurrence=(id,extra)=>({map_fingerprint:map.fingerprint,session:'session',observation_id:`session:${id}`,
    occurrence_id:`session:${id}:occurrence`,evidence_ids:[`session:${id}`],runtime_observed:true,...extra});
  const creation=occurrence('creation',{schema:'producttrace.react-wrapper-observation.v1',kind:'react_wrapper',operation:'created',
    manifest_key:returned.key,source_call_id:returned.source_call_id,callback_source_id:returned.callback_source_id,
    wrapper_id:'session:wrapper',component_identity_id:'session:function'});
  const lifecycle=(id,operation)=>occurrence(id,{schema:'producttrace.react-lifecycle-observation.v1',kind:'react_lifecycle',operation,
    manifest_key:callback.key,source_call_id:callback.source_call_id,semantic_id:callback.semantic_id,
    callback_source_id:callback.callback_source_id,owner_source_id:callback.owner_source_id,
    root_id:'root',instance_id:'instance',mount_id:'mount',render_id:'render'});
  const attempt=lifecycle('attempt','render_attempted'),body={...lifecycle('body','wrapper_callback_invoked'),
    wrapper_origin_observation_id:creation.observation_id,wrapper_id:creation.wrapper_id,component_identity_id:creation.component_identity_id,
    renderer_wrapper_matched:true,invocation_id:'session:invocation',arguments:[{value_id:'session:props',value:{encoding:'redacted',value:null}}]};
  return {map,entries,creation,attempt,body,lifecycle};
}
test('wrapper body evidence requires accepted construction and render context even in a standalone reader',()=>{
  for(const api of ['memo','forwardRef']) {
    const {map,entries,creation,attempt,body,lifecycle}=wrapperFixture(api);
    const withoutManifest=createReactLifecycleEvidenceSession(map);
    assert.equal(withoutManifest.join(body).status,'unresolved');
    const session=createReactLifecycleEvidenceSession(map,{wrapperEntries:entries});
    assert.equal(session.join(attempt).status,'resolved');
    assert.equal(session.join(body).reason,'wrapper_callback_origin_unobserved');
    assert.equal(session.joinWrapper(creation).status,'resolved');
    const joined=session.join(body);assert.equal(joined.status,'resolved');
    assert.equal(joined.runtime.wrapper.claim,'observed_stored_component_body');
    assert.equal(joined.runtime.wrapper.direct_renderer_dispatch_proven,false);
    assert.equal(joined.runtime.wrapper.callback_completion_proven,false);
    assert.equal(session.join({...body,...lifecycle('duplicate','wrapper_callback_invoked')}).reason,'duplicate_wrapper_invocation');
    assert.equal(session.join(lifecycle('commit','render_committed')).status,'resolved');
    assert.equal(session.join(lifecycle('unmount','unmounted')).status,'resolved');
    assert.equal(session.join({...body,...lifecycle('after-unmount','wrapper_callback_invoked'),invocation_id:'session:after'}).reason,'mount_already_unmounted');
    const missingRender=createReactLifecycleEvidenceSession(map,{wrapperEntries:entries});
    missingRender.joinWrapper(creation);assert.equal(missingRender.join(body).reason,'wrapper_render_attempt_required');
    missingRender.join(attempt);missingRender.join(lifecycle('abandon','render_abandoned'));
    assert.equal(missingRender.join(body).reason,'wrapper_render_attempt_required');
  }
});
test('wrapper evidence rejects cross-origin substitutions and malformed arguments without poisoning the valid record',()=>{
  const {map,entries,creation,attempt,body}=wrapperFixture();
  for(const mutation of [
    {wrapper_origin_observation_id:'session:missing'}, {wrapper_id:'session:sibling-wrapper'},
    {component_identity_id:'session:sibling-function'}, {callback_source_id:'wrong-source'},
    {owner_source_id:'wrong-owner'}, {source_call_id:'wrong-call'}, {session:'different'},
    {map_fingerprint:'different'}, {renderer_wrapper_matched:false}, {runtime_observed:false},
    {invocation_id:'outside:invocation'}, {invocation_id:'session:'}, {arguments:undefined},
    {arguments:[{value_id:'other:value',value:{encoding:'primitive',value:1}}]},
    {arguments:[{value_id:'session:value',value:{encoding:'primitive',value:{hidden:true}}}]},
    {arguments:[{value_id:'session:value',value:{encoding:'redacted',value:'not-redacted'}}]},
  ]) {
    const session=createReactLifecycleEvidenceSession(map,{wrapperEntries:entries});
    session.joinWrapper(creation);session.join(attempt);
    assert.equal(session.join({...body,...mutation}).status,'unresolved',JSON.stringify(mutation));
    assert.equal(session.join(body).status,'resolved','a rejected record must not change accepted state');
  }
  const session=createReactLifecycleEvidenceSession(map,{wrapperEntries:entries});
  assert.equal(session.joinWrapper({...creation,component_identity_id:'outside:function'}).status,'unresolved');
  assert.equal(session.joinWrapper(creation).status,'resolved');
  assert.equal(session.joinWrapper(creation).reason,'duplicate_wrapper_observation');
  assert.equal(session.joinWrapper({...creation,observation_id:'session:second',occurrence_id:'session:second:occurrence',evidence_ids:['session:second']}).reason,'wrapper_allocation_identity_reused');
});
test('body probes abstain when bindings can shadow the original function or arguments',()=>{
  for(const parametersAndBody of [
    '({Render}) {return <button/>;}', '(props) {var {x:Render}=props;return <button/>;}',
    '(arguments) {return <button/>;}', '(props) {function Render(){} return <button/>;}',
    '(props) {class Render {} return <button/>;}', '(props) {eval("var x=1");return <button/>;}',
  ]) {
    const source=`import * as React from 'react';const Wrapped=React.memo(function Render${parametersAndBody});export function App(){return <Wrapped/>;}`;
    const map=compileReactSources({'wrapper.tsx':source},{packages});
    assert.ok(map.react_semantics.filter(row=>row.export==='memo').every(row=>!row.causal_bindings.wrapper_render));
    assert.ok(!createReactRuntimeIntegration(map).bindings.react_lifecycle.entries.some(row=>row.kind==='wrapper_callback'));
  }
});

test('forwarded ref evidence checks the exact renderer input and keeps attachment separate',()=>{
  const {map,entries,creation,attempt,body}=wrapperFixture();
  const ref={value_id:'session:ref',value:{encoding:'redacted',value:null}};
  const valid={...body,arguments:[...body.arguments,ref],forwarded_ref:{status:'resolved',reason:null,
    argument:1,field:'ref',fiber_tag:11,snapshot:'body_entry',value_id:ref.value_id,
    renderer_value_id:ref.value_id,identity_matched:true}};
  const session=()=>{const value=createReactLifecycleEvidenceSession(map,{wrapperEntries:entries});value.joinWrapper(creation);value.join(attempt);return value;};
  const proof=session().join(valid).runtime.wrapper.forwarded_ref;
  assert.equal(proof.claim,'observed_renderer_ref_argument');assert.equal(proof.value_id,ref.value_id);
  assert.equal(proof.ref_attachment_proven,false);assert.equal(proof.ref_cleanup_proven,false);
  assert.equal(session().join({...valid,forwarded_ref:{...valid.forwarded_ref,snapshot:'committed_render'}}).status,'resolved');
  for(const change of [{argument:0},{field:'stateNode'},{fiber_tag:14},{snapshot:'guessed'},
    {value_id:'session:other'},{renderer_value_id:'session:sibling'},{identity_matched:false},{status:'claimed'}]) {
    const value=session();assert.equal(value.join({...valid,forwarded_ref:{...valid.forwarded_ref,...change}}).status,'unresolved',JSON.stringify(change));
    assert.equal(value.join(valid).status,'resolved');
  }
  const missing=session().join(body);assert.equal(missing.status,'resolved');
  assert.equal(missing.runtime.wrapper.forwarded_ref.reason,'forwarded_ref_renderer_input_unconfirmed');
  assert.equal(session().join({...valid,arguments:body.arguments}).reason,'forwarded_ref_input_mismatch');
  const memo=wrapperFixture('memo'),reader=createReactLifecycleEvidenceSession(memo.map,{wrapperEntries:memo.entries});
  reader.joinWrapper(memo.creation);reader.join(memo.attempt);
  assert.equal(reader.join({...memo.body,forwarded_ref:valid.forwarded_ref}).reason,'unexpected_forwarded_ref_input');
});
test('wrapper ref instruction format rejects incomplete or executable-looking proposals',()=>{
  const rule=getReactBehavior({surface:'react',exportName:'forwardRef',version:'18.3.1'}).execution;
  for(const render_ref of [{argument:1},{argument:-1,field:'ref',fiber_tag:11},
    {argument:1,field:'callback()',fiber_tag:11},{argument:1,field:'ref',fiber_tag:999},
    {argument:1,field:'ref',fiber_tag:11,execute:'anything'}])assert.equal(validateReactExecutionRule({...rule,render_ref}).valid,false);
});

test('component outcomes require the exact accepted invocation and reject duplicate or cross-owner results',()=>{
  const {map,entries,creation,attempt,body,lifecycle}=wrapperFixture();
  const outcome={...lifecycle('result','wrapper_callback_completed'),wrapper_origin_observation_id:creation.observation_id,
    wrapper_id:creation.wrapper_id,component_identity_id:creation.component_identity_id,caused_by_invocation_id:body.invocation_id,
    outcome:'returned',value_id:'session:result',value:{encoding:'primitive',value:'rendered'}};
  const fresh=(includeBody=true)=>{const session=createReactLifecycleEvidenceSession(map,{wrapperEntries:entries});
    session.joinWrapper(creation);session.join(attempt);if(includeBody)session.join(body);return session;};
  assert.equal(fresh(false).join(outcome).reason,'wrapper_outcome_invocation_required');
  const joined=fresh().join(outcome);assert.equal(joined.status,'resolved');
  assert.equal(joined.runtime.wrapper_outcome.claim,'observed_component_body_outcome');
  assert.equal(joined.runtime.wrapper_outcome.render_commit_proven,false);
  assert.equal(joined.runtime.wrapper_outcome.renderer_result_consumed_proven,false);
  const thrown=fresh().join({...outcome,outcome:'threw'});assert.equal(thrown.runtime.wrapper_outcome.error_boundary_proven,false);
  for(const change of [{caused_by_invocation_id:'session:missing'},{wrapper_id:'session:sibling'},
    {component_identity_id:'session:other'},{wrapper_origin_observation_id:'session:other'},
    {callback_source_id:'other'},{render_id:'other'},{mount_id:'other'},{manifest_key:'other'},
    {outcome:'committed'},{value_id:'other:result'},{value:{encoding:'primitive',value:{secret:true}}},
    {value:{encoding:'redacted',value:'secret'}},{value:{encoding:'primitive',value:Infinity}},
    {runtime_observed:false},{session:'other'},{invocation_id:'session:unexpected'}]) {
    const session=fresh();assert.equal(session.join({...outcome,...change}).status,'unresolved',JSON.stringify(change));
    assert.equal(session.join(outcome).status,'resolved');
  }
  const session=fresh();session.join(outcome);
  assert.equal(session.join({...outcome,observation_id:'session:again',occurrence_id:'session:again:occurrence',evidence_ids:['session:again']}).reason,'duplicate_wrapper_outcome');
});

test('wrapper result scopes preserve directives, this, arguments, function identity, returns and throws',()=>{
  const source=`import * as React from 'react';import * as DOM from 'react-dom';
    const Wrapped=React.memo(function Named(props){'use strict';DOM.flushSync(()=>{});
      if(props.fail)throw props.error;
      return {receiver:this,argc:arguments.length,value:props.value,self:Named};});window.Wrapped=Wrapped;`;
  const map=compileReactSources({'wrapper.js':source},{packages:{...packages,'react-dom':{version:'18.3.1',verified:true,verification_sha256:'fixture'}}});
  const transformed=createReactRuntimeIntegration(map).instrumentSource('wrapper.js',source);assert.deepEqual(transformed.diagnostics,[]);
  let active=false;const observed=[],helper={apiResult:(_key,value)=>value,wrapperReturn:(_key,value)=>value,
    component(){active=true;},wrapperCallback(_key,callback,args,run){assert.equal(active,true,'owner must be established before wrapper scope');active=false;
      try{const value=run();observed.push({callback,args:Array.from(args),outcome:'returned',value});return value;}
      catch(value){observed.push({callback,args:Array.from(args),outcome:'threw',value});throw value;}},
    scopeCall:(_key,run)=>run(),scopeArgument:(_key,_index,value)=>value,tagSource:(_id,value)=>value,callback:(_key,value)=>value};
  const target={},React={memo:callback=>({type:callback})},DOM={flushSync:callback=>callback()};
  new Function('React','DOM','window','globalThis',transformed.code.replace(/import[^;]+;/g,''))(React,DOM,target,{__productTraceReactLifecycle:helper});
  const fn=target.Wrapped.type,receiver={},input={value:{identity:1}},result=Reflect.apply(fn,receiver,[input,'extra']);
  assert.equal(fn.name,'Named');assert.equal(fn.length,1);assert.equal(result.self,fn);assert.equal(result.receiver,receiver);
  assert.equal(result.argc,2);assert.equal(result.value,input.value);assert.equal(observed[0].value,result);
  const error={original:true};assert.throws(()=>fn({fail:true,error}),value=>value===error);assert.equal(observed[1].value,error);
});
