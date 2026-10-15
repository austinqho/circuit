import test from 'node:test';import assert from 'node:assert/strict';
import {compileReactSources} from '../analysis/react-compiler.mjs';
import {createReactRuntimeIntegration} from '../analysis/runtime-join.mjs';
import {getReactBehavior} from '../analysis/react-behavior.mjs';
import {predictBoundaryType,validateReactExecutionRule} from '../analysis/react-execution-rule.mjs';
const packages={react:{version:'18.3.1',verified:true,verification_sha256:'boundary-fixture'}};
test('JSX boundary descriptions are observed without pretending that their symbol was called',()=>{
  for(const name of ['Fragment','StrictMode','Profiler','Suspense']) {
    const source=`import * as React from 'react';const kind=React.${name};export function App(){return <React.${name}><button onClick={()=>send()}/></React.${name}>;}`;
    const map=compileReactSources({'App.tsx':source},{packages}),integration=createReactRuntimeIntegration(map);
    const transform=integration.instrumentSource('App.tsx',source);assert.deepEqual(transform.diagnostics,[]);
    const entries=integration.bindings.react_lifecycle.entries.filter(row=>row.export===name);
    assert.deepEqual(entries.map(row=>row.kind).sort(),['api_boundary','api_value']);
    assert.match(transform.code,/boundaryResult/);
    const rule=getReactBehavior({surface:'react',exportName:name,version:'18.3.1'}).execution;
    assert.equal(validateReactExecutionRule({...rule,unrecognized:true}).valid,false);
    const prediction=predictBoundaryType(rule);assert.equal(prediction.value_type,'symbol');
    const records=[],runtime=integration.createApiRuntime({onObservation:row=>records.push(row)});
    const boundary=entries.find(row=>row.kind==='api_boundary'),value=entries.find(row=>row.kind==='api_value');
    const element={$$typeof:Symbol.for('react.element'),type:prediction.value,props:{}};
    assert.equal(runtime.boundaryResult(boundary.key,element),element);
    assert.equal(runtime.apiValue(value.key,prediction.value),prediction.value);
    for(const row of records){const joined=integration.joinApi(row);assert.equal(joined.status,'resolved',JSON.stringify({row,joined}));
      assert.equal(joined.runtime.boundary_proof.renderer_execution_proven,false);
      assert.equal(joined.runtime.boundary_proof.callbacks_executed_proven,false);}
    for(const mutation of [{marker:'react.other'},{element_marker:'react.portal'},{value_type:'function'},{usage:'invoked'}])
      assert.equal(integration.joinApi({...records[0],boundary_value:{...records[0].boundary_value,...mutation}}).reason,'boundary_value_mismatch');
    assert.equal(integration.joinApi({...records[0],operation:'invoked'}).status,'unresolved');
    const getter={$$typeof:Symbol.for('react.element'),get type(){throw Error('must not call getter');}};
    assert.equal(runtime.boundaryResult(boundary.key,getter),getter);
    assert.equal(integration.joinApi(records.at(-1)).reason,'boundary_value_mismatch');
    runtime.apiValue(value.key,Symbol(rule.marker));assert.equal(integration.joinApi(records.at(-1)).reason,'boundary_value_mismatch');
  }
});

import ts from 'typescript';
test('adjacent and nested JSX boundaries keep valid syntax and guarded control paths',()=>{
  for(const container of ['main','React.Fragment']) {
    const source=`import * as React from 'react';export function App(){return <${container}><React.Fragment><button onClick={()=>a()}/></React.Fragment><React.StrictMode><React.Suspense fallback={<button onClick={()=>retry()}/> }><button onClick={()=>b()}/></React.Suspense></React.StrictMode></${container}>;}`;
    const map=compileReactSources({'App.tsx':source},{packages}),integration=createReactRuntimeIntegration(map);
    const transformed=integration.instrumentSource('App.tsx',source);assert.deepEqual(transformed.diagnostics,[]);
    const diagnostics=ts.transpileModule(transformed.code,{reportDiagnostics:true,compilerOptions:{jsx:ts.JsxEmit.React}}).diagnostics;
    assert.deepEqual(diagnostics.map(row=>ts.flattenDiagnosticMessageText(row.messageText,' ')),[]);
    assert.equal(map.controls.length,3);
    assert.ok(map.controls.every(row=>row.conditions.some(condition=>condition.react_boundary_input)));
    assert.equal(map.controls.filter(row=>row.conditions.some(condition=>condition.react_boundary_input==='fallback')).length,1);
    const unavailable=compileReactSources({'App.tsx':source},{packages:{react:{version:'19.0.0',verified:true,verification_sha256:'other'}}});
    assert.ok(!createReactRuntimeIntegration(unavailable).bindings.react_lifecycle.entries.some(row=>row.kind==='api_boundary'));
  }
});

test('boundary props obey final assignment and positional-child precedence',()=>{
  const cases=[
    [`<React.Fragment children={<button id="wrong" onClick={()=>bad()}/>}><button id="right" onClick={()=>good()}/></React.Fragment>`,1,null],
    [`<React.Fragment children={<button id="wrong" onClick={()=>bad()}/>} children={<button id="right" onClick={()=>good()}/>}/>`,1,null],
    [`<React.Fragment {...unknown} children={<button id="right" onClick={()=>good()}/>}/>`,1,null],
    [`<React.Fragment children={<button id="wrong" onClick={()=>bad()}/>} {...unknown}/>`,0,'boundary_input_spread_unresolved'],
    [`<React.Fragment children={<button id="wrong" onClick={()=>bad()}/>}> </React.Fragment>`,0,'boundary_children_whitespace_unresolved'],
    [`<React.Suspense fallback={<button id="wrong" onClick={()=>bad()}/>} {...unknown} fallback={<button id="right" onClick={()=>good()}/>}/>`,1,'boundary_input_spread_unresolved'],
  ];
  for(const [jsx,count,frontier] of cases) {
    const source=`import * as React from 'react';export function App({unknown}){return ${jsx};}`;
    const map=compileReactSources({'App.tsx':source},{packages});assert.equal(map.controls.length,count,jsx);
    assert.ok(map.controls.every(control=>map.nodes.find(row=>row.id===control.source_node_id).text.includes('id="right"')));
    if(frontier)assert.ok(map.diagnostics.some(row=>row.code===frontier),jsx);
  }
});

// Retained regression from the keyed-Fragment browser test: construction does
// not by itself establish where a local JSX value is returned. Keep this source
// frontier visible until alias placement and its branch conditions are modeled.
test('local JSX variables do not silently become rendered source controls',()=>{
  const source=`import * as React from 'react';export function App({reverse}){
    const left=<React.Fragment key="left"><button onClick={()=>send()}/></React.Fragment>;
    const right=<React.Fragment key="right"><button onClick={()=>cancel()}/></React.Fragment>;
    return <main>{reverse?[right,left]:[left,right]}</main>;}`;
  const map=compileReactSources({'App.tsx':source},{packages});
  assert.equal(map.controls.length,0);assert.ok(map.diagnostics.some(row=>row.code==='unreturned_jsx'));
});

test('single-use immutable JSX aliases preserve boundary guards at their returned use',()=>{
  for(const body of [
    'const child=<React.Fragment><button onClick={()=>send()}/></React.Fragment>;return child;',
    'const child=<React.Fragment><button onClick={()=>send()}/></React.Fragment>;const alias=child;return <main>{alias}</main>;',
    'const child=show?<React.Fragment><button onClick={()=>send()}/></React.Fragment>:null;return <main>{child}</main>;',
    'const child=<React.Fragment><button onClick={()=>send()}/></React.Fragment>;const list=[child];return <main>{list}</main>;',
  ]){
    const source=`import * as React from 'react';export function App({show}){${body}}`;
    const map=compileReactSources({'App.tsx':source},{packages});assert.equal(map.controls.length,1,JSON.stringify(map.diagnostics));
    assert(map.controls[0].conditions.some(row=>row.react_boundary_input==='children'));
    assert(!map.diagnostics.some(row=>row.code==='unreturned_jsx'));
    const transform=createReactRuntimeIntegration(map).instrumentSource('App.tsx',source);
    assert.deepEqual(transform.diagnostics,[]);assert.match(transform.code,/data-producttrace-control-click/);
  }
});

test('mutable, unused, property-only and multiply-used JSX values remain source frontiers',()=>{
  for(const body of [
    'let child=<React.Fragment><button onClick={()=>send()}/></React.Fragment>;child=other;return child;',
    'const child=<React.Fragment><button onClick={()=>send()}/></React.Fragment>;return null;',
    'const child=<React.Fragment><button onClick={()=>send()}/></React.Fragment>;return child.props.children;',
    'const child=<React.Fragment><button onClick={()=>send()}/></React.Fragment>;return !child;',
    'const child=<React.Fragment><button onClick={()=>send()}/></React.Fragment>;return 2+child;',
    'const child=<React.Fragment><button onClick={()=>send()}/></React.Fragment>;return other===child;',
    'const child=<React.Fragment><button onClick={()=>send()}/></React.Fragment>;return child&&<p>other</p>;',
    'const child=<React.Fragment><button onClick={()=>send()}/></React.Fragment>;return <main>{child}{child}</main>;',
  ]){
    const source=`import * as React from 'react';export function App({other}){${body}}`;
    const map=compileReactSources({'App.tsx':source},{packages});assert.equal(map.controls.length,0,body);
    assert(map.diagnostics.some(row=>row.code==='unreturned_jsx'));
  }
});
