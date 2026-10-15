import test from 'node:test';import assert from 'node:assert/strict';import ts from 'typescript';
import {getReactBehavior} from '../analysis/react-behavior.mjs';
import {validateReactExecutionRule,planElementFactory} from '../analysis/react-execution-rule.mjs';
import {compileReactSources} from '../analysis/react-compiler.mjs';
import {createReactRuntimeIntegration} from '../analysis/runtime-join.mjs';
const rule=getReactBehavior({surface:'react',exportName:'createFactory',version:'18.3.1'}).execution;
const packages={react:{version:'18.3.1',verified:true,verification_sha256:'fixture'}};
const source=`import * as React from 'react';function Child({label}){return <button type="button" onClick={()=>send(label)}>Run</button>;}
const make=React.createFactory(Child);const alias=make;function App(){return alias({label:'chat'});}`;
test('factory planning captures a type without invoking it and delegates later element construction',()=>{
 let calls=0;function Child(){calls++;}Child.defaultProps={label:'default'};
 assert.equal(validateReactExecutionRule(rule).valid,true);assert.equal(validateReactExecutionRule({...rule,extra:1}).valid,false);
 assert.equal(planElementFactory(rule,{args:[Child]}).type,Child);
 assert.deepEqual(planElementFactory(rule,{args:[Child],invocation:[{}]}).props,{label:'default'});
 assert.equal(calls,0);
});
test('immutable factory aliases reach one component; mutable and spread calls retain frontiers',()=>{
 const map=compileReactSources({'factory.tsx':source},{packages});assert.equal(map.controls.length,1);
 assert.equal(map.placements.find(row=>row.props.label?.value==='chat').props.label.value,'chat');
 assert.equal(map.react_protocols.filter(row=>row.member==='factory').length,1);
 for(const broken of [source.replace('const alias=make','let alias=make;alias=window.foreign'),source.replace("{label:'chat'}",'{...window.props}')]){
  assert.equal(compileReactSources({'factory.tsx':broken},{packages}).controls.length,0);
 }
 assert.doesNotThrow(()=>compileReactSources({'empty.tsx':`import * as React from 'react';const make=React.createFactory();`},{packages}));
});
test('native factories stamp their first configuration argument',()=>{
 const native=`import * as React from 'react';const NativeTag='button';const makeNative=React.createFactory(NativeTag);const alias=makeNative;
 function App(){return alias({type:'button',onClick:()=>send('native')},'Run');}`;
 const map=compileReactSources({'native.tsx':native},{packages}),integration=createReactRuntimeIntegration(map);
 assert.equal(map.controls.length,1);assert.equal(integration.candidates.length,1);
 assert.equal(integration.candidates[0].stamp_config_argument,0);
 const transformed=integration.instrumentSource('native.tsx',native);assert.deepEqual(transformed.diagnostics,[]);
 assert.match(transformed.code,/elementArgument\([^\n]+, 0, \{"data-producttrace-control-click":[^\n]+type:'button'/);
});
test('factory call evidence requires the actual allocated function without touching its type getter',()=>{
 const map=compileReactSources({'factory.tsx':source},{packages}),integration=createReactRuntimeIntegration(map),records=[];
 const api=integration.createApiRuntime({session:'s',onObservation:row=>records.push(row)});
 let reads=0;const react={createFactory(type){const factory=props=>({$$typeof:Symbol.for('react.element'),type,props,key:null,ref:null,_owner:null});
  Object.defineProperty(factory,'type',{get(){reads++;throw Error('must not read');}});return factory;}};
 const transformed=integration.instrumentSource('factory.tsx',source);assert.deepEqual(transformed.diagnostics,[]);
 const code=ts.transpileModule(transformed.code.replace("import * as React from 'react';",''),{compilerOptions:{jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2020}}).outputText;
 const result=new Function('React','globalThis',code+';return App();')(react,{__productTraceReactLifecycle:api});assert.equal(result.props.label,'chat');assert.equal(reads,0);
 const descriptions=records.filter(row=>row.kind==='react_element');assert.equal(descriptions.length,2);
 assert.equal(integration.joinElement(descriptions[1]).reason,'element_factory_origin_unobserved');
 assert.equal(integration.joinElement(descriptions[0]).status,'resolved');assert.equal(integration.joinElement(descriptions[1]).status,'resolved');
 const wrong=structuredClone(descriptions[1]);wrong.target={...wrong.target,kind:'object'};
 const check=createReactRuntimeIntegration(map);assert.equal(check.joinElement(descriptions[0]).status,'resolved');assert.equal(check.joinElement(wrong).reason,'element_factory_origin_unobserved');
});
