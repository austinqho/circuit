import test from 'node:test';
import assert from 'node:assert/strict';
import {createReactStateBoundary,createReactStateHost} from '../analysis/library-react-state.mjs';
import {reactStateProgram} from './fixtures/programs/react-state-program.mjs';
import {createLibraryProgramBank} from '../analysis/library-program-bank.mjs';
import {instrumentLibraryPrograms} from '../analysis/library-program-integration.mjs';
import ts from 'typescript';
import vm from 'node:vm';

// Unit hosts exercise rejection and identity handling. Actual installed React,
// not these hosts, supplies the separate behavior/admission acceptance oracle.
function stateHost(){let value,initialized=false;const dispatch=action=>{value=typeof action==='function'?action(value):action};
 return {producer(initial){if(!initialized){value=typeof initial==='function'?initial():initial;initialized=true;}return [value,dispatch]},dispatch};}

test('state replay consumes original callbacks once, follows returned dispatch aliases and leaves other functions alone',async()=>{
 const owner={},native=stateHost(),program=reactStateProgram('useState'),scope={protocol:'react_state_queue',api:'useState',callbackArguments:[0],resultPaths:null};
 const implementation={producer:native.producer,unchanged:()=>true,sha256:'unit-host',context:{source_status:'ready_for_catalog_recheck',specifier:'react',export_name:'useState'}};
 const bank=createLibraryProgramBank({check:async()=>({status:'passed'})});assert.equal((await bank.admit({implementation,program,scope})).status,'admitted');
 const adapterHost={protocol:'react_state_queue',invoke({boundary,producer,args,receiver}){const result=boundary.invoke(owner,args,producer,receiver);boundary.commit(owner,boundary.render(owner));return result;}};
 const run=source=>{const compiled=instrumentLibraryPrograms({source,bank,stateHost:adapterHost});const exports={};vm.runInNewContext(ts.transpileModule(compiled.code,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports,require:()=>({useState:native.producer}),[compiled.runtimeKey]:compiled.runtime});return {exports,compiled};};
 const first=run("import {useState} from 'react';export function read(value){return useState(value)}");
 let initialCalls=0,updates=0;const pair=first.exports.read(()=>{initialCalls++;return 2});assert.equal(pair[1],native.dispatch);
 const second=run('export function write(alias, action){return alias(action)}');
 second.exports.write(pair[1],previous=>{updates++;assert.equal(previous,2);return 5});assert.equal(first.exports.read(99)[0],5);
 assert.equal(initialCalls,1);assert.equal(updates,1);
 const third=run('export function write(holder,action){return holder.send(action)}');third.exports.write({send:pair[1]},9);assert.equal(first.exports.read(99)[0],9);
 const other=value=>value*2;assert.equal(second.exports.write(other,8),16);
 const report=second.compiled.runtime.checkpoint()[0];assert.equal(report.status,'observed_agreement');
 const calculation=report.evidence.find(row=>row.operation==='update');assert(calculation.request);assert.equal(calculation.arguments[0].value,2);assert.equal(calculation.value.value,5);
 assert.equal(instrumentLibraryPrograms({source:"import {useState} from 'react';useState(0)",bank}).frontiers[0].reason,'required_state_host_unavailable');
});

test('wrong callback count, arguments and comparison rules fail without changing original behavior',()=>{
 const original=reactStateProgram('useState');
 const twice=structuredClone(original);const walk=node=>{if(!node||typeof node!=='object')return;Object.values(node).forEach(walk);if(node.op==='call'){const call=structuredClone(node);Object.keys(node).forEach(key=>delete node[key]);Object.assign(node,{op:'sequence',steps:[call,structuredClone(call)]});}};walk(twice);
 for(const program of [twice,{schema:original.schema,body:{op:'undefined'}}]){
  let calls=0;const native=stateHost(),boundary=createReactStateBoundary({program,api:'useState'}),owner={};
  assert.equal(boundary.invoke(owner,[()=>{calls++;return 4}],native.producer)[0],4);assert.equal(calls,1);assert.equal(boundary.checkpoint().status,'frontier');
 }
 const native=stateHost(),boundary=createReactStateBoundary({program:original,api:'useState'}),owner={};
 const pair=boundary.invoke(owner,[0],native.producer);const failure=new Error('application failure');let calls=0;
 assert.throws(()=>boundary.prepareCall(pair[1])(()=>{calls++;throw failure}),error=>error===failure);assert.equal(calls,1);
 assert.equal(boundary.checkpoint().status,'observed_agreement');
 assert.equal(boundary.checkpoint().evidence.find(row=>row.kind==='state_calculation').outcome,'throw');
});

test('state owner and version boundaries reject contamination and unsupported proxies',()=>{
 const program=reactStateProgram('useState'),boundary=createReactStateBoundary({program,api:'useState'}),a=stateHost(),b=stateHost(),oa={},ob={};
 const pa=boundary.invoke(oa,[1],a.producer),pb=boundary.invoke(ob,[20],b.producer);boundary.prepareCall(pa[1])(previous=>previous+1);
 assert.equal(boundary.invoke(oa,[99],a.producer)[0],2);assert.equal(boundary.invoke(ob,[99],b.producer)[0],20);assert.notEqual(pa[1],pb[1]);
 assert.equal(boundary.checkpoint().owners,2);assert.equal(boundary.checkpoint().status,'observed_agreement');
 assert.throws(()=>createReactStateHost({version:'19.1.0'}),/state_host_version/);
 let calls=0;const proxy=new Proxy(()=>{calls++;return 9},{}),native=stateHost();boundary.invoke({},[proxy],native.producer);assert.equal(calls,1);
 assert(boundary.checkpoint().failures.some(row=>row.reason==='state_initializer_unsupported'));
});
