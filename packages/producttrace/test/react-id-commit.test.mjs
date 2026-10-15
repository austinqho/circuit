import test from 'node:test';import assert from 'node:assert/strict';
import {createReactIdCommitObserver,checkReactIdCommit} from '../analysis/react-id-commit.mjs';
import ts from 'typescript';
import {compileReactSources} from '../analysis/react-compiler.mjs';
import {createReactRuntimeIntegration} from '../analysis/runtime-join.mjs';

test('ID property wrappers preserve adjacent, nested and multiply used JSX elements',()=>{
 const source=`import {useId,Fragment} from 'react';function App(){const id=useId();return <Fragment><label htmlFor={id}><span id={id}/></label><input id={id} aria-labelledby={id}/><label id={id} htmlFor={id}/></Fragment>;}`;
 const map=compileReactSources({'App.tsx':source},{packages:{react:{version:'18.3.1',verified:true,verification_sha256:'fixture'}}});
 const integration=createReactRuntimeIntegration(map),result=integration.instrumentSource('App.tsx',source);
 assert.deepEqual(result.diagnostics,[]);
 const parsed=ts.createSourceFile('App.tsx',result.code,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 assert.deepEqual(parsed.parseDiagnostics,[]);
 // The final label uses two known properties on one element; it is wrapped
 // once with both source uses, rather than introducing nested JSX expressions.
 assert.equal((result.code.match(/\.idElement\(/g)||[]).length,4);
 const groups=[...result.code.matchAll(/\.idElement\((\[[^\]]+\])/g)].map(match=>JSON.parse(match[1]));
 assert.deepEqual(groups.map(group=>group.length).sort(),[1,1,2,2]);
});

test('ID host commitment requires original props and the exact committed render',()=>{
 let enabled=true,context='s',seq=0;const records=[];
 const observer=createReactIdCommitObserver({enabled:()=>enabled,context:()=>context,id:()=>context+':'+(++seq),observe:row=>records.push(row)});
 const entry={key:'entry',id_property:'id',id_read_source_id:'read'},use={observation_id:'s:use',value:':r1:'};
 const identity={root_id:'root',instance_id:'owner',mount_id:'mount'},render={identity,render_id:'render',status:'attempted'};
 const element={$$typeof:Symbol.for('react.element'),type:'input',props:{id:use.value}},fiber={elementType:'input',memoizedProps:element.props};
 const host={root_id:'root',instance_id:'host',mount_id:'host-mount',commit_id:'commit'},owner={...identity,render_id:'render'};
 assert.equal(observer.element(entry,element,use,render),element);
 observer.commit(fiber,host,owner);assert.equal(records.length,0);
 render.status='committed';observer.commit({...fiber,memoizedProps:{id:use.value}},host,owner);assert.equal(records.length,0);
 observer.commit(fiber,host,{...owner,instance_id:'sibling'});assert.equal(records.length,0);
 element.props.id='mutated';observer.commit(fiber,host,owner);assert.equal(records.length,0);element.props.id=use.value;
 observer.commit(fiber,host,owner);observer.commit(fiber,host,owner);assert.equal(records.length,1);
 observer.commit(fiber,{...host,commit_id:'later'},owner);assert.equal(records.length,2);
 observer.element(entry,element,use,render);observer.commit(fiber,{...host,commit_id:'ambiguous'},owner);
 assert(records.slice(2).every(row=>row.frontier==='id_property_origin_ambiguous'));
 context='new';observer.commit(fiber,{...host,commit_id:'new'},owner);assert.equal(records.length,4);
 enabled=false;observer.element(entry,element,use,render);observer.commit(fiber,host,owner);assert.equal(records.length,4);
 let calls=0;const getter={...element,props:{get id(){calls++;return use.value;}}};
 enabled=true;observer.element(entry,getter,use,render);assert.equal(calls,0);
});

test('ID commit joins reject unknown source uses and owner or session contamination',()=>{
 const origin={status:'resolved',observation_id:'s:use',source:{call_id:'call',semantic_id:'react/useId/18.3.1'},
  runtime:{operation:'id_used',session:'s',root_id:'root',instance_id:'owner',mount_id:'mount',render_id:'render',
    id_proof:{read_source_id:'read',property:'id',value:':r1:'}}};
 const row={schema:'producttrace.react-id-commit.v1',kind:'react_id_commit',runtime_observed:true,map_fingerprint:'map',
  session:'s',observation_id:'s:commit',occurrence_id:'s:commit:occurrence',evidence_ids:['s:commit'],
  source_call_id:'call',semantic_id:'react/useId/18.3.1',use_observation_id:'s:use',id_read_source_id:'read',id_property:'id',value:':r1:',
  host:{root_id:'root',instance_id:'host',mount_id:'host-mount',commit_id:'commit',type:'input'},
  owner:{root_id:'root',instance_id:'owner',mount_id:'mount',render_id:'render'}};
 const check=(record,prior=origin,ownerKnown=true)=>checkReactIdCommit(record,prior,{fingerprint:'map',ownerKnown});
 assert.equal(check(row).status,'resolved');assert.equal(check(row).runtime.entity_identity_proven,false);
 for(const mutate of [value=>value.session='other',value=>value.use_observation_id='s:other',value=>value.source_call_id='other',
  value=>value.value='different',value=>value.id_property='htmlFor',value=>value.owner.render_id='other',value=>value.host.root_id='other']){
  const bad=structuredClone(row);mutate(bad);assert.equal(check(bad).status,'unresolved');
 }
 assert.equal(check(row,null).status,'unresolved');assert.equal(check(row,origin,false).status,'unresolved');
});
