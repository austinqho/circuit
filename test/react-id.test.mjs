import test from 'node:test';import assert from 'node:assert/strict';
import {compileReactSources} from '../analysis/react-compiler.mjs';import {getReactBehavior} from '../analysis/react-behavior.mjs';
import {planReactId,validateReactExecutionRule} from '../analysis/react-execution-rule.mjs';
const rule=getReactBehavior({surface:'react',exportName:'useId',version:'18.3.1'}).execution;
test('ID plans require renderer position evidence and keep mounted owners distinct',()=>{
  assert.equal(validateReactExecutionRule(rule).valid,true);
  assert.equal(validateReactExecutionRule({...rule,globallyUnique:true}).valid,false);
  assert.equal(validateReactExecutionRule({...rule,radix:1}).valid,false);
  assert.equal(planReactId(rule,{owner:'a',clientCounter:32}).value,':r10:');
  assert.equal(planReactId(rule,{owner:'a',environment:'hydrate',prefix:'ui-',treeId:'2',localIndex:32}).value,':ui-R2H10:');
  assert.equal(planReactId(rule,{owner:'b',previous:{owner:'a',value:':r0:'}}).reason,'id_owner_mismatch');
  assert.equal(planReactId(rule,{owner:'a',previous:{owner:'a',value:':r0:'}}).value,':r0:');
  for(const input of [{owner:'a'},{owner:'a',environment:'hydrate'},{owner:'a',clientCounter:-1},{owner:'a',prefix:{toString(){throw Error('must not run');}},clientCounter:0}])
    assert.equal(planReactId(rule,input).status,'unresolved');
});
test('ID property bindings follow immutable aliases but exclude mutation, shadowing and captured inputs',()=>{
  const source=`import * as React from 'react';function App(){const id=React.useId();let mutable=React.useId();const alias=id;
    const later=()=> <input id={id}/>;{const id='shadow';<input id={id}/>;}
    return <main><label htmlFor={id}/><input id={id}/><input id={alias}/><input id={mutable}/><Custom id={id}/></main>;}`;
  const map=compileReactSources({'id.tsx':source},{packages:{react:{version:'18.3.1',verified:true,verification_sha256:'fixture'}}});
  const ids=map.react_semantics.filter(row=>row.export==='useId');assert.equal(ids.length,2);
  const uses=ids.flatMap(row=>row.causal_bindings.id_property_reads||[]);assert.equal(uses.length,3);
  assert.deepEqual(uses.map(row=>row.property).sort(),['htmlFor','id','id']);
});
test('ID aliases preserve binding identity across accessibility references',()=>{
 const source=`import {useId} from 'react';function App(){const id=useId();const alias=id;const second=alias;
   const other=useId();let mutable=id;mutable=other;const fromMutable=mutable;
   const closure=()=> <input aria-describedby={id}/>;
   return <main><input id={second} aria-describedby={alias} aria-labelledby={id}/>
     <input aria-describedby={fromMutable}/><Custom aria-describedby={id}/></main>;}`;
 const map=compileReactSources({'App.tsx':source},{packages:{react:{version:'18.3.1',verified:true,verification_sha256:'fixture'}}});
 const uses=map.react_semantics.filter(s=>s.export==='useId').flatMap(s=>s.causal_bindings.id_property_reads||[]);
 assert.deepEqual(uses.map(s=>s.property).sort(),['aria-describedby','aria-labelledby','id']);
 assert.equal(new Set(uses.map(s=>s.element_source_id)).size,1);
});
