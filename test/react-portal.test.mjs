import test from 'node:test';import assert from 'node:assert/strict';import ts from 'typescript';
import {getReactBehavior} from '../analysis/react-behavior.mjs';import {validateReactExecutionRule,planPortalDescription} from '../analysis/react-execution-rule.mjs';
import {compileReactSources} from '../analysis/react-compiler.mjs';import {createReactRuntimeIntegration} from '../analysis/runtime-join.mjs';
const packages={react:{version:'18.3.1',verified:true,verification_sha256:'fixture'},'react-dom':{version:'18.3.1',verified:true,verification_sha256:'dom-fixture'}};
const rule=getReactBehavior({surface:'react-dom',exportName:'createPortal',version:'18.3.1'}).execution;
test('portal program stores children and leaves application key coercion to the library',()=>{
 assert.equal(validateReactExecutionRule(rule).valid,true);assert.equal(validateReactExecutionRule({...rule,extra:true}).valid,false);
 const children=()=>{throw Error('must not invoke');},container={};const plan=planPortalDescription(rule,{args:[children,container,1]});
 assert.equal(plan.status,'planned');assert.equal(plan.fields.children,children);assert.equal(plan.fields.containerInfo,container);
 assert.equal(plan.key,'1');assert.equal(plan.children_operation,'store');assert.equal(plan.renderer_execution_proven,false);
 let coerced=0;assert.equal(planPortalDescription(rule,{args:[children,container,{toString(){coerced++;return 'key';}}]}).reason,'portal_key_coercion_required');assert.equal(coerced,0);
});
function fixture(){const source=`import * as React from 'react';import {createPortal} from 'react-dom';export function App(){return createPortal(<button type="button" onClick={()=>send()}>Portal</button>,window.target);}`;
 const map=compileReactSources({'portal.tsx':source},{packages}),integration=createReactRuntimeIntegration(map);return {source,map,integration};}
test('portal child rule reaches the guarded control and only instruments matching source',()=>{
 const {source,map,integration}=fixture();assert.equal(map.controls.length,1);assert.ok(map.controls[0].conditions.some(row=>row.react_portal_input===0 && row.runtime_observed===false));
 assert.equal(integration.candidates.length,1);const transformed=integration.instrumentSource('portal.tsx',source);assert.deepEqual(transformed.diagnostics,[]);
 assert.ok(transformed.code.includes('.portalCall('));assert.ok(transformed.code.includes('.portalArgument('));
 const compiled=ts.transpileModule(transformed.code,{reportDiagnostics:true,compilerOptions:{jsx:ts.JsxEmit.React}});
 assert.deepEqual(compiled.diagnostics.map(row=>ts.flattenDiagnosticMessageText(row.messageText,' ')),[]);
 const unsupported=compileReactSources({'portal.tsx':source},{packages:{...packages,'react-dom':{version:'19.0.0',verified:true,verification_sha256:'other'}}});
 assert.equal(unsupported.controls.length,0);
});
test('portal observer preserves exceptions and rejects incorrect descriptors without invoking their getters',()=>{
 const {integration}=fixture(),entry=integration.bindings.react_lifecycle.entries.find(row=>row.portal_rule),records=[];
 const observer=integration.createApiRuntime({session:'s',onObservation:row=>records.push(row)}),child={},container={};
 const run=value=>observer.portalCall(entry.key,()=>{observer.portalArgument(entry.key,0,child);observer.portalArgument(entry.key,1,container);return value;});
 const portal={$$typeof:Symbol.for('react.portal'),children:child,containerInfo:container,key:null,implementation:null};
 assert.equal(run(portal),portal);const valid=records.at(-1),joined=integration.joinPortal(valid);assert.equal(joined.status,'resolved');assert.equal(joined.runtime.host_commit_proven,false);
 assert.equal(integration.joinPortal(valid).reason,'duplicate_portal_observation');
 let reads=0;const getter={...portal,get children(){reads++;return child;}};assert.equal(run(getter),getter);assert.equal(reads,0);assert.equal(integration.joinPortal(records.at(-1)).status,'unresolved');
 const error=Error('descriptor');const proxy=new Proxy(portal,{getOwnPropertyDescriptor(){throw error;}});assert.equal(run(proxy),proxy);assert.equal(integration.joinPortal(records.at(-1)).reason,'portal_descriptor_unobserved');
 assert.throws(()=>observer.portalCall(entry.key,()=>{throw error;}),value=>value===error);assert.equal(integration.joinPortal(records.at(-1)).reason,'portal_call_or_argument_threw');
 for(const mutation of [{marker:'wrong'},{session:'other'},{manifest_key:'wrong'},{runtime_observed:false},
 {fields:{...valid.fields,children:valid.fields.containerInfo}}, {fields:{...valid.fields,children:{...valid.fields.children,kind:'function'}}}, {inputs:{}}, {fields:{...valid.fields,key:{...valid.fields.key,kind:'string',value:'changed'}}}]){
 const check=createReactRuntimeIntegration(fixture().map);assert.equal(check.joinPortal({...valid,...mutation}).status,'unresolved',JSON.stringify(mutation));assert.equal(check.joinPortal(valid).status,'resolved');}
});
