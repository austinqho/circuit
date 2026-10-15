import ts from 'typescript';
import test from 'node:test';import assert from 'node:assert/strict';
import {getReactBehavior} from '../analysis/react-behavior.mjs';import {validateReactExecutionRule,planElementClone} from '../analysis/react-execution-rule.mjs';
import {compileReactSources} from '../analysis/react-compiler.mjs';import {createReactRuntimeIntegration} from '../analysis/runtime-join.mjs';
const rule=getReactBehavior({surface:'react',exportName:'cloneElement',version:'18.3.1'}).execution;
const packages={react:{version:'18.3.1',verified:true,verification_sha256:'fixture'}};
function fixture(){const source=`import * as React from 'react';function Child({label}){const click=React.useCallback(()=>send(label),[label]);return <button type="button" onClick={click}>Run</button>;}function App(){return React.cloneElement(React.createElement(Child,{label:'old'}),{label:'new'});}`;
 const map=compileReactSources({'clone.tsx':source},{packages}),integration=createReactRuntimeIntegration(map);return {source,map,integration};}
test('clone rule preserves original props and changes owner only for an overridden ref',()=>{
 assert.equal(validateReactExecutionRule(rule).valid,true);assert.equal(validateReactExecutionRule({...rule,extra:1}).valid,false);
 function Child(){}Child.defaultProps={label:'default',extra:1};const owner={},base={type:Child,key:'old',ref:null,_owner:owner,props:{label:'old'}};
 assert.deepEqual(planElementClone(rule,[base,{}]).props,{label:'old'});assert.equal(planElementClone(rule,[base,{label:undefined}]).props.label,'default');
 assert.equal(planElementClone(rule,[base,{ref:null}]).reason,'element_owner_required');assert.equal(planElementClone(rule,[base,{ref:null}],{owner:null}).owner,null);
});
test('nested construction and cloning reaches the component without inventing a root',()=>{
 const {source,map,integration}=fixture();assert.equal(map.controls.length,1);assert.equal(integration.candidates.length,1);
 const clone=map.react_semantics.find(row=>row.export==='cloneElement');assert.ok(map.controls[0].conditions.some(row=>row.node_id===clone.call_id));
 assert.deepEqual(integration.instrumentSource('clone.tsx',source).diagnostics,[]);
 const broken=compileReactSources({'clone.tsx':source.replace("{label:'new'}",'{...window.props}')},{packages});assert.equal(broken.controls.length,0);
});
test('immutable original aliases retain native clone controls and stamp clone configuration',()=>{
 const source=`import * as React from 'react';const NativeTag='button';function App(){const original=React.createElement(NativeTag,{id:'old'});const alias=original;return React.cloneElement(alias,{id:'native-clone',onClick:()=>send('native')},'Run');}`;
 const map=compileReactSources({'native-clone.tsx':source},{packages}),integration=createReactRuntimeIntegration(map);
 assert.equal(map.controls.length,1);assert.equal(integration.candidates.length,1);assert.equal(integration.candidates[0].stamp_config_argument,1);
 const transformed=integration.instrumentSource('native-clone.tsx',source);assert.deepEqual(transformed.diagnostics,[]);
 assert.match(transformed.code,/elementArgument\([^\n]+, 1, \{"data-producttrace-control-click":[^\n]+id:'native-clone'/);
 const mutable=compileReactSources({'native-clone.tsx':source.replace('const alias=original','let alias=original;alias=window.other')},{packages});assert.equal(mutable.controls.length,0);
});
test('element source placement refuses prototype-changing config in either nested call',()=>{
 const {source}=fixture();
 for(const original of ["{label:'old'}","{label:'new'}"]){
  for(const name of ['__proto__',"'__proto__'"]){
   const map=compileReactSources({'clone.tsx':source.replace(original,`{${name}:{label:'inherited'}}`)},{packages});
   assert.equal(map.controls.length,0);
   assert.match(JSON.stringify(map),/element_prototype_write_unmodeled/);
  }
 }
});
test('clone evidence needs an accepted original description from the same session',()=>{
 for(const type of [function Child(){},'span',Symbol.for('react.fragment')]){
  const {map,integration}=fixture(),entries=integration.bindings.react_lifecycle.entries;
  const make=entries.find(row=>row.element_rule?.kind==='element_construction'),clone=entries.find(row=>row.element_rule?.kind==='element_clone'),records=[];
  const api=integration.createApiRuntime({session:'s',onObservation:row=>records.push(row)});
  const first={$$typeof:Symbol.for('react.element'),type,props:{label:'old'},key:null,ref:null,_owner:null},second={...first,props:{label:'new'}};
  assert.equal(api.elementCall(make.key,()=>{api.elementArgument(make.key,0,type);api.elementArgument(make.key,1,{label:'old'});return first;}),first);
  assert.equal(api.elementCall(clone.key,()=>{api.elementArgument(clone.key,0,first);api.elementArgument(clone.key,1,{label:'new'});return second;}),second);
  const [original,copied]=records;assert.equal(integration.joinElement(copied).reason,'element_clone_origin_unobserved');assert.equal(integration.joinElement(original).status,'resolved');
  const result=integration.joinElement(copied);assert.equal(result.status,'resolved',JSON.stringify(result));assert.equal(result.runtime.original_description_observation_id,original.observation_id);assert.equal(result.runtime.host_commit_proven,false);
  const other=createReactRuntimeIntegration(map);assert.equal(other.joinElement({...original,session:'wrong'}).status,'unresolved');assert.equal(other.joinElement(copied).status,'unresolved');
  const wrong=structuredClone(copied);wrong.fields.type={...wrong.fields.type,identity:'s:foreign',kind:'function',encoding:'redacted',value:null};
  const check=createReactRuntimeIntegration(map);assert.equal(check.joinElement(original).status,'resolved');assert.equal(check.joinElement(wrong).status,'unresolved');
 }
});

test('instrumented nested calls observe the original before capturing the clone input',()=>{
 const source=`import * as React from 'react';function Child(){return <button type="button" onClick={()=>send()}>Run</button>;}function App(){return React.cloneElement(React.createElement(Child,{label:'old'}),{label:'new'});}`;
 const map=compileReactSources({'nested.tsx':source},{packages}),integration=createReactRuntimeIntegration(map),records=[];
 const api=integration.createApiRuntime({session:'s',onObservation:row=>records.push(row)});
 const transformed=integration.instrumentSource('nested.tsx',source);assert.deepEqual(transformed.diagnostics,[]);
 const code=ts.transpileModule(transformed.code.replace("import * as React from 'react';",''),{compilerOptions:{jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2020}}).outputText;
 const react={createElement(type,props){return {$$typeof:Symbol.for('react.element'),type,props,key:null,ref:null,_owner:null};},cloneElement(original,props){return {...original,props:{...original.props,...props}};}};
 const result=new Function('React','globalThis',code+';return App();')(react,{__productTraceReactLifecycle:api});assert.equal(result.props.label,'new');
 const descriptions=records.filter(row=>row.kind==='react_element');assert.equal(descriptions.length,2);
 assert.equal(descriptions[1].inputs[0].identity,descriptions[0].result.identity);
 for(const row of descriptions)assert.equal(integration.joinElement(row).status,'resolved');
});
