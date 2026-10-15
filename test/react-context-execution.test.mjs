import test from 'node:test';import assert from 'node:assert/strict';
import {getReactBehavior} from '../analysis/react-behavior.mjs';
import {planContextBinding,contextValueChanged,validateReactExecutionRule} from '../analysis/react-execution-rule.mjs';
import {compileReactSources} from '../analysis/react-compiler.mjs';import {createReactRuntimeIntegration} from '../analysis/runtime-join.mjs';
const get=api=>getReactBehavior({surface:'react',exportName:api,version:'18.3.1'}).execution;
test('context programs choose the exact nearest identity without invoking function values',()=>{
  const context={},other={},value=()=>{throw Error('not an initializer');};
  const creation=planContextBinding(get('createContext'),{args:[value]});assert.equal(creation.default_value,value);
  const selection=planContextBinding(get('useContext'),{requestedContext:context,providers:[{context:other,value:'wrong'},
    {context,value:undefined},{context,value:'outer'}],defaultValue:value,defaultKnown:true});
  assert.equal(selection.operation,'read_provider');assert.equal(selection.value,undefined);assert.equal(selection.value_known,true);
  const consumer=planContextBinding(get('createContext'),{member:'Consumer',requestedContext:context,providers:[],chainComplete:true,defaultValue:value,defaultKnown:true});
  assert.equal(consumer.value,value);assert.equal(consumer.operation,'read_default');
});
test('context rules require complete ancestry for default selection and keep unknown defaults unknown',()=>{
  const rule=get('useContext'),context={};
  assert.equal(planContextBinding(rule,{requestedContext:context}).reason,'context_ancestry_incomplete');
  assert.equal(planContextBinding({...rule,selection:'farthest'},{requestedContext:context,providers:[{context,value:7}]}).reason,'context_ancestry_incomplete');
  const unknown=planContextBinding(rule,{requestedContext:context,chainComplete:true});
  assert.equal(unknown.operation,'read_default');assert.equal(unknown.value_known,false);assert.equal(Object.hasOwn(unknown,'value'),false);
  assert.equal(contextValueChanged(rule,NaN,NaN),false);assert.equal(contextValueChanged(rule,0,-0),true);
  for(const change of [{default_argument:-1},{matching:'name'},{function_value:'invoke'},{extra:true}])assert.equal(validateReactExecutionRule({...rule,...change}).valid,false);
});
test('Consumer ownership frontiers carry source invocation evidence without claiming a render',()=>{
  const map=compileReactSources({'context.tsx':`import * as React from 'react';const C=React.createContext('default');
    function App(){return <C.Consumer>{value=><button>{value}</button>}</C.Consumer>;}`},
    {packages:{react:{version:'18.3.1',verified:true,verification_sha256:'fixture'}}});
  const integration=createReactRuntimeIntegration(map),entry=integration.bindings.react_lifecycle.entries.find(row=>row.kind==='context_consumer_callback');assert.ok(entry);
  const record={schema:'producttrace.react-frontier.v1',kind:'react_frontier',runtime_observed:true,map_fingerprint:map.fingerprint,
    manifest_key:entry.key,source_call_id:entry.source_call_id,callback_source_id:entry.callback_source_id,session:'s',
    observation_id:'s:1',occurrence_id:'s:1:occurrence',evidence_ids:['s:1'],operation:'callback_invoked',reason:'consumer_render_owner_unobserved'};
  const joined=integration.joinFrontier(record);assert.equal(joined.status,'unresolved');assert.equal(joined.runtime_observed,true);assert.equal(joined.runtime.owner_proven,false);
  for(const change of [{map_fingerprint:'wrong'},{callback_source_id:'wrong'},{operation:'committed'},{session:'other'},{evidence_ids:[]}])
    assert.equal(integration.joinFrontier({...record,...change}).reason,'invalid_react_frontier');
});
