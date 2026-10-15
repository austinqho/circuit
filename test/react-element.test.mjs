import test from 'node:test';import assert from 'node:assert/strict';import ts from 'typescript';
import {compileReactSources} from '../analysis/react-compiler.mjs';import {createReactRuntimeIntegration} from '../analysis/runtime-join.mjs';
import {getReactBehavior} from '../analysis/react-behavior.mjs';import {validateReactExecutionRule,planElementConstruction} from '../analysis/react-execution-rule.mjs';
const packages={react:{version:'18.3.1',verified:true,verification_sha256:'fixture'}};
const rule=getReactBehavior({surface:'react',exportName:'createElement',version:'18.3.1'}).execution;
function fixture(){const source=`import * as React from 'react';function Child({label}){const click=React.useCallback(()=>send(label),[label]);return <button type="button" onClick={click}>Run</button>;}function App(){return React.createElement(Child,{label:'chat'});}`;
 const map=compileReactSources({'element.tsx':source},{packages}),integration=createReactRuntimeIntegration(map);return {source,map,integration};}
test('element construction stores inputs and avoids getters or user key coercion',()=>{
 assert.equal(validateReactExecutionRule(rule).valid,true);assert.equal(validateReactExecutionRule({...rule,extra:1}).valid,false);
 assert.equal(planElementConstruction({kind:'element_construction'},[]).status,'unresolved');let calls=0;function Child(){calls++;}Child.defaultProps={children:'default'};
 const plan=planElementConstruction(rule,[Child,{children:'config',key:1},'positional']);assert.equal(plan.props.children,'positional');assert.equal(plan.key,'1');assert.equal(calls,0);
 assert.equal(planElementConstruction(rule,[Child,{get value(){calls++;}}]).status,'unresolved');assert.equal(calls,0);
});
test('createElement type rule reaches a single component placement with explicit props',()=>{
 const {source,map,integration}=fixture();assert.equal(map.controls.length,1);assert.equal(integration.candidates.length,1);
 const application=map.react_semantics.find(row=>row.export==='createElement');assert.ok(map.controls[0].conditions.some(row=>row.node_id===application.call_id&&row.runtime_observed===false));
 const transformed=integration.instrumentSource('element.tsx',source);assert.deepEqual(transformed.diagnostics,[]);assert.ok(transformed.code.includes('.elementCall('));
 const compiled=ts.transpileModule(transformed.code,{reportDiagnostics:true,compilerOptions:{jsx:ts.JsxEmit.React}});assert.deepEqual(compiled.diagnostics.map(row=>ts.flattenDiagnosticMessageText(row.messageText,' ')),[]);
 const unresolved=compileReactSources({'element.tsx':source.replace("{label:'chat'}",'{...window.props}')},{packages});assert.equal(unresolved.controls.length,0);assert.ok(unresolved.diagnostics.some(row=>row.code==='element_component_properties_unresolved'));
});
test('native createElement controls use immutable tag aliases and stamp the explicit config',()=>{
 const source=`import * as React from 'react';const Tag='button';function App(){return React.createElement(Tag,{id:'run',onClick:()=>send('chat')},'Run');}`;
 const map=compileReactSources({'native.tsx':source},{packages}),integration=createReactRuntimeIntegration(map);
 assert.equal(map.controls.length,1);assert.equal(map.controls[0].tag,'button');assert.equal(map.controls[0].event,'click');
 assert.equal(integration.candidates.length,1);assert.equal(integration.candidates[0].stamp_mode,'create_element');
 const transformed=integration.instrumentSource('native.tsx',source);assert.deepEqual(transformed.diagnostics,[]);
 assert.match(transformed.code,/"data-producttrace-control-click":"[^"]+",id:'run'/);
 assert.ok(transformed.applied.some(row=>row.transform==='source_stamp'&&row.node_id===map.controls[0].source_node_id));
 const compiled=ts.transpileModule(transformed.code,{reportDiagnostics:true,compilerOptions:{target:ts.ScriptTarget.ES2020}});
 assert.deepEqual(compiled.diagnostics.map(row=>ts.flattenDiagnosticMessageText(row.messageText,' ')),[]);

 const unknown=`import * as React from 'react';function App({Tag,config}){return React.createElement(Tag,{...config,onClick:()=>send('x')});}`;
 const unresolved=compileReactSources({'unknown.tsx':unknown},{packages});assert.equal(unresolved.controls.length,0);
 assert.ok(unresolved.diagnostics.some(row=>['element_component_input_unresolved','element_native_config_unresolved'].includes(row.code)));
});
test('observed element descriptions require original type identity and preserve result/exception behavior',()=>{
 const {integration}=fixture(),entry=integration.bindings.react_lifecycle.entries.find(row=>row.element_rule),records=[];
 const api=integration.createApiRuntime({session:'s',onObservation:row=>records.push(row)});function Child(){};
 const props={label:'chat'},result={$$typeof:Symbol.for('react.element'),type:Child,props,key:null,ref:null,_owner:null};
 const call=()=>api.elementCall(entry.key,()=>{api.elementArgument(entry.key,0,Child);api.elementArgument(entry.key,1,props);return result;});assert.equal(call(),result);
 const valid=records[0],joined=integration.joinElement(valid);assert.equal(joined.status,'resolved');assert.equal(joined.runtime.host_commit_proven,false);
 assert.equal(joined.runtime.property_input_relations_proven,true);assert.equal(joined.runtime.property_input_relations[0].name,'label');
 assert.equal(integration.joinElement(valid).reason,'duplicate_element_observation');
 for(const changed of [{session:'other'},{marker:'react.portal'},{inputs:{}},{fields:{...valid.fields,type:valid.fields.props}},
  {fields:{...valid.fields,type:{...valid.fields.type,kind:'object'}}},{property_inputs:[]},
  {property_inputs:[{...valid.property_inputs[0],source_id:'wrong'}]},{runtime_observed:false}])
  assert.equal(createReactRuntimeIntegration(fixture().map).joinElement({...valid,...changed}).status,'unresolved');
 const error=Error('argument');assert.throws(()=>api.elementCall(entry.key,()=>{throw error;}),value=>value===error);assert.equal(integration.joinElement(records.at(-1)).reason,'element_call_or_argument_threw');
});
test('unknown configuration objects are never enumerated or inspected for property lineage',()=>{
 const source=`import * as React from 'react';export function make(config){return React.createElement('i',config);}`;
 const map=compileReactSources({'unknown.ts':source},{packages}),integration=createReactRuntimeIntegration(map);
 const entry=integration.bindings.react_lifecycle.entries.find(row=>row.element_rule);assert.deepEqual(entry.element_property_inputs,[]);
 const records=[],api=integration.createApiRuntime({session:'s',onObservation:row=>records.push(row)});
 const revoked=Proxy.revocable({},{});revoked.revoke();
 const result={$$typeof:Symbol.for('react.element'),type:'i',props:{},key:null,ref:null,_owner:null};
 assert.doesNotThrow(()=>api.elementCall(entry.key,()=>{api.elementArgument(entry.key,0,'i');api.elementArgument(entry.key,1,revoked.proxy);return result;}));
 const joined=integration.joinElement(records[0]);assert.equal(joined.status,'resolved');
 assert.equal(joined.runtime.property_input_relations_proven,false);assert.deepEqual(joined.runtime.property_input_relations,[]);
});
