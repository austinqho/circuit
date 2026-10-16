import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import ts from 'typescript';
import {compileReactSources} from '../analysis/react-compiler.mjs';
import {createReactRuntimeIntegration} from '../analysis/runtime-join.mjs';
const compile=source=>compileReactSources({'context.tsx':source},{packages:{react:{version:'18.3.1',verified:true,verification_sha256:'fixture'}}});

test('context use indexing follows immutable bindings and skips nested bodies, property names, and shadowed locals',()=>{
  const source=`import * as React from 'react';const C=React.createContext(null);
  function App(){const value=React.useContext(C);let mutable=React.useContext(C);
    const cb=React.useCallback(()=>{const data={value};const named={value:7};
      function nested(){return value;} {const value=9;console.log(value);}
      console.log(data.value,mutable);return value;},[]);return <button onClick={cb}/>;}`;
  const map=compile(source),callback=map.react_semantics.find(row=>row.export==='useCallback').causal_bindings.callbacks[0];
  assert.equal(callback.context_reads.length,2);
  assert.equal(callback.context_reads.filter(row=>row.shorthand).length,1);
  assert.equal(map.react_semantics.filter(row=>row.export==='useContext' && row.causal_bindings.context_result_binding_id).length,1);
  const transformed=createReactRuntimeIntegration(map).instrumentSource('context.tsx',source);
  assert.deepEqual(transformed.diagnostics,[]);
  assert.ok(transformed.code.includes('function nested(){return value;}'));
  assert.ok(transformed.code.includes('console.log(data.value,mutable)'));
});

test('instrumented reads preserve new, call, shorthand, and skipped expression semantics',()=>{
  const source=`import * as React from 'react';const C=React.createContext(null);
  function App(){const value=React.useContext(C);const cb=React.useCallback((take)=>{
    if(!take)return 'skipped';const instance=new value(7);const called=value(8);return {value,instance,called};
  },[]);globalThis.cb=cb;return <button onClick={cb}/>;}App();`;
  const map=compile(source),transformed=createReactRuntimeIntegration(map).instrumentSource('context.tsx',source),reads=[];
  function Original(x){if(new.target)this.value=x;else return x+1;}
  const observer=()=>{};observer.contextValue=(id,value)=>{reads.push(id);return value;};
  const runtime=new Proxy({defineCallback:(_key,factory)=>factory(observer),component:()=>{},contextCall:(_key,run)=>run()},
    {get:(target,key)=>target[key]||((_key,value)=>value)});
  const context={React:{createContext:()=>({}),useContext:()=>Original,useCallback:value=>value,createElement:()=>null},__productTraceReactLifecycle:runtime};
  vm.createContext(context);
  vm.runInContext(ts.transpileModule(transformed.code.replace("import * as React from 'react';",''),
    {fileName:'context.tsx',compilerOptions:{target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.React}}).outputText,context);
  assert.equal(context.cb(false),'skipped');assert.equal(reads.length,0);
  const result=context.cb(true);assert.ok(result.instance instanceof Original);assert.equal(result.instance.value,7);
  assert.equal(result.called,9);assert.equal(result.value,Original);assert.equal(reads.length,3);
});

test('a concise retained callback keeps its inferred name and original return value',()=>{
  const source=`import * as React from 'react';const C=React.createContext(null);function App(){
    const value=React.useContext(C);const inferred=()=>value;const cb=React.useCallback(inferred,[]);
    globalThis.cb=cb;return <button onClick={cb}/>;}App();`;
  const transformed=createReactRuntimeIntegration(compile(source)).instrumentSource('context.tsx',source);
  const observed=[],original={same:true};const observer=()=>{};observer.contextValue=(id,value)=>{observed.push(id);return value;};
  const runtime=new Proxy({defineCallback:(_key,factory,name)=>{const cb=factory(observer);Object.defineProperty(cb,'name',{value:name});return cb;},
    component:()=>{},contextCall:(_key,run)=>run()},{get:(target,key)=>target[key]||((_key,value)=>value)});
  const context={React:{createContext:()=>({}),useContext:()=>original,useCallback:value=>value,createElement:()=>null},__productTraceReactLifecycle:runtime};
  vm.createContext(context);vm.runInContext(ts.transpileModule(transformed.code.replace("import * as React from 'react';",''),
    {fileName:'context.tsx',compilerOptions:{target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.React}}).outputText,context);
  assert.equal(context.cb.name,'inferred');assert.equal(context.cb(),original);assert.equal(observed.length,1);
});

test('concise memo and effect inputs keep callback return values and expression grouping',()=>{
  const source=`import * as React from 'react';const C=React.createContext(null);function App(){
    const value=React.useContext(C);globalThis.memo=React.useMemo(()=>value,[]);
    React.useEffect(()=>globalThis.seen=value,[]);return <button/>;}App();`;
  const transformed=createReactRuntimeIntegration(compile(source)).instrumentSource('context.tsx',source),reads=[],original={same:true};
  const runtime=new Proxy({component:()=>{},contextCall:(_key,run)=>run(),contextValue:(_key,id,value)=>{reads.push(id);return value;}},
    {get:(target,key)=>target[key]||((_key,value)=>value)});
  const context={React:{createContext:()=>({}),useContext:()=>original,useMemo:fn=>fn(),useEffect:fn=>fn(),createElement:()=>null},__productTraceReactLifecycle:runtime};
  vm.createContext(context);vm.runInContext(ts.transpileModule(transformed.code.replace("import * as React from 'react';",''),
    {fileName:'context.tsx',compilerOptions:{target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.React}}).outputText,context);
  assert.equal(context.memo,original);assert.equal(context.seen,original);assert.equal(reads.length,2);
});
