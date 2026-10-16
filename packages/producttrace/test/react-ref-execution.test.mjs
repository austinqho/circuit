import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import ts from 'typescript';import fs from 'node:fs';
import {compileReactSources} from '../analysis/react-compiler.mjs';import {createReactRuntimeIntegration} from '../analysis/runtime-join.mjs';
import {getReactBehavior} from '../analysis/react-behavior.mjs';import {validateReactExecutionRule,planRefCell} from '../analysis/react-execution-rule.mjs';
import {createReactRefEvidenceSession} from '../analysis/react-ref-evidence.mjs';
import {createReactRefObserver} from '../analysis/react-ref-runtime.mjs';
const packages={react:{version:'18.3.1',verified:true,verification_sha256:'fixture:react'}};
const source=`import * as React from 'react';const box=React.createRef();const before=box.current;
box.current='next';const alias=box;globalThis.result=[before,alias['current']];`;
function setup(code=source) {
  const map=compileReactSources({'refs.ts':code},{packages}),integration=createReactRuntimeIntegration(map),records=[];
  const runtime=integration.createApiRuntime({session:'ref-test',onObservation:record=>records.push(record)});
  const transform=integration.instrumentSource('refs.ts',code);assert.deepEqual(transform.diagnostics,[]);
  const context={React:{createRef:()=>Object.seal({current:null}),useRef:current=>({current})},__productTraceReactLifecycle:runtime};vm.createContext(context);
  vm.runInContext(ts.transpileModule(transform.code.replace("import * as React from 'react';",''),{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText,context);
  return {map,integration,records,runtime,transform,context};
}
test('ref rule plans preserve function values, cell retention, and mounted ownership boundaries',()=>{
  const rule=getReactBehavior({surface:'react',exportName:'useRef',version:'18.3.1'}).execution;
  const fn=()=>{throw Error('must not be called');};const plan=planRefCell(rule,{args:[fn],owner:'first'});
  assert.equal(plan.operation,'allocate');assert.equal(plan.initial_value,fn);
  const reference={current:17};assert.equal(planRefCell(rule,{args:[18],owner:'first',previous:{owner:'first',reference}}).reference,reference);
  assert.equal(planRefCell(rule,{args:[],owner:'second',previous:{owner:'first',reference}}).reason,'ref_hook_owner_mismatch');
  assert.equal(planRefCell(rule,{args:[]}).reason,'ref_hook_owner_required');
  for(const change of [{argument:-1},{function_input:'invoke'},{write_scheduling:'render'},{property:''},{extra:true}])
    assert.equal(validateReactExecutionRule({...rule,...change}).valid,false);
});
test('instrumented ref creation, writes, and reads join the exact returned object',()=>{
  const {integration,records,context}=setup();assert.deepEqual(Array.from(context.result),[null,'next']);
  const refs=records.filter(record=>record.kind==='react_ref');assert.deepEqual(refs.map(row=>row.operation),['returned','read','write','read']);
  for(const record of refs)assert.equal(integration.joinRef(record).status,'resolved',JSON.stringify(record));
  assert.equal(new Set(refs.map(row=>row.ref_id)).size,1);
  assert.ok(refs.slice(1).every(row=>row.origin_observation_id===refs[0].observation_id));
  assert.equal(integration.joinRef(refs.at(-1)).runtime.value_origin,'unproven','matching values cannot prove absence of unobserved writes');
  const original=vm.runInContext('box',context);assert.equal(Object.isSealed(original),true);assert.equal(original.current,'next');
  assert.ok(records.some(row=>row.kind==='react_api' && integration.joinApi(row).status==='resolved'));
});
test('ref accesses reject missing origins, wrong cells, foreign sessions, and changed source occurrences',()=>{
  const {map,integration,records}=setup(),refs=records.filter(row=>row.kind==='react_ref'),origin=refs[0],read=refs.at(-1);
  assert.equal(integration.joinRef(read).reason,'ref_origin_observation_required');
  assert.equal(integration.joinRef(origin).status,'resolved');assert.equal(integration.joinRef(read).status,'resolved');
  for(const change of [{ref_id:'ref-test:other'},{origin_observation_id:'ref-test:other'},{origin_source_call_id:'other'}])
    assert.equal(integration.joinRef({...read,...change}).reason,'ref_origin_observation_required');
  assert.equal(integration.joinRef({...read,source_access_id:'other'}).reason,'ref_source_occurrence_mismatch');
  assert.equal(integration.joinRef({...read,map_fingerprint:'other'}).reason,'map_fingerprint_mismatch');
  assert.equal(integration.joinRef({...read,session:'other'}).reason,'ref_observation_identity_required');
  const rejectOrigin=change=>createReactRuntimeIntegration(map).joinRef({...origin,...change}).reason;
  assert.equal(rejectOrigin({previously_returned:true}),'ref_per_call_allocation_reused');
  assert.equal(rejectOrigin({sealed:false}),'ref_sealing_mismatch');
  assert.equal(rejectOrigin({descriptor:{writable:true,enumerable:true}}),'ref_sealing_mismatch');
  assert.equal(rejectOrigin({current:{...origin.current,value:17,kind:'number'}}),'ref_initial_cell_mismatch');
});
test('committed host attachment joins only an accepted exact ref origin and renderer identity',()=>{
  const {integration,records}=setup(),origin=records.find(row=>row.kind==='react_ref'&&row.operation==='returned');
  assert.equal(integration.joinRef(origin).status,'resolved');
  const observation_id='ref-test:ref_commit:1';
  const attachment={schema:'producttrace.react-ref-observation.v1',kind:'react_ref',runtime_observed:true,
    map_fingerprint:origin.map_fingerprint,session:'ref-test',manifest_key:origin.manifest_key,
    source_call_id:origin.source_call_id,source_access_id:null,semantic_id:origin.semantic_id,surface:origin.surface,export:origin.export,
    observation_id,occurrence_id:observation_id+':occurrence',evidence_ids:[observation_id],operation:'host_attached',
    ref_id:origin.ref_id,origin_observation_id:origin.observation_id,origin_source_call_id:origin.source_call_id,
    value:{identity:'ref-test:host:1',kind:'object',encoding:'redacted',value:null},
    renderer:{root_id:'root',instance_id:'host-instance',mount_id:'host-mount',commit_id:'commit',render_id:null,
      render_observed:false,runtime_observed:true,basis:'react-devtools-commit.v1'}};
  const joined=integration.joinRef(attachment);assert.equal(joined.status,'resolved');assert.equal(joined.runtime.commit_proven,true);
  assert.equal(joined.runtime.attachment_claim,'observed_ref_attached_to_committed_host');
  assert.equal(integration.joinRef({...attachment,ref_id:'ref-test:other'}).reason,'ref_origin_observation_required');
  assert.equal(integration.joinRef({...attachment,renderer:{...attachment.renderer,commit_id:null}}).reason,'ref_host_commit_identity_required');
  assert.equal(integration.joinRef({...attachment,value:{...attachment.value,identity:'ref-test:host:2'}}).reason,'ref_host_attachment_conflict');
});
test('ref observer uses original property operations and preserves behavior after recording stops',()=>{
  let enabled=true,next=0,reads=0,writes=0;const records=[];
  const observer=createReactRefObserver({enabled:()=>enabled,context:()=> 'session',id:kind=>'session:'+kind+':'+(++next),
    entry:key=>key==='call'?{source_call_id:'source',ref_rule:{property:'current'}}:{ref_property:'current',ref_access:{mode:key}},
    encode:value=>({encoding:'primitive',value}),observe:record=>records.push(record)});
  const cell={current:null};assert.equal(observer.refCall('call',()=>cell),cell);
  Object.defineProperty(cell,'current',{configurable:true,get(){reads++;return 7;},set(value){writes++;}});
  assert.equal(observer.refWrite('write',cell,17),17);assert.equal(reads,0);assert.equal(writes,1);
  assert.equal(observer.refRead('read',cell),7);assert.equal(reads,1);
  const before=records.length;enabled=false;assert.equal(observer.refWrite('write',cell,19),19);assert.equal(observer.refRead('read',cell),7);
  assert.equal(records.length,before);assert.equal(writes,2);assert.equal(reads,2);
  const runtime=fs.readFileSync(new URL('../src/producttrace-runtime.js',import.meta.url),'utf8');
  assert.ok(runtime.includes(createReactRefObserver.toString().replaceAll('\n','\n  ')));
});

test('ref reference-sensitive expressions remain unchanged with explicit frontiers',()=>{
  for(const expression of ['box.current?.()','box?.current()','new (box.current)()',
    'delete (box.current)','(box.current)++','[box.current]=values','[...box.current]=values','box.current+=1','box?.current']) {
    const code=`import * as React from 'react';const box=React.createRef();${expression};`;
    const integration=createReactRuntimeIntegration(compileReactSources({'refs.ts':code},{packages}));
    assert.ok(integration.bindings.react_lifecycle.frontiers.some(row=>row.reason.startsWith('ref_') || row.reason.startsWith('optional_ref')));
    const transform=integration.instrumentSource('refs.ts',code);
    assert.ok(transform.code.includes(expression));assert.ok(!transform.applied.some(row=>row.transform==='react_ref_access'));
  }
});

test('a new ref observation session gets fresh identities and recorder failures preserve application errors',()=>{
  let context='first',next=0,fail=false;const records=[];
  const observer=createReactRefObserver({enabled:()=>true,context:()=>context,id:kind=>context+':'+kind+':'+(++next),
    entry:key=>key==='call'?{source_call_id:'source',ref_rule:{property:'current'}}:{ref_property:'current',ref_access:{mode:key}},
    encode:value=>value===null?{encoding:'primitive',value:null}:{encoding:'redacted',value:null},
    observe:record=>{if(fail)throw Error('recorder failure');records.push(record);}});
  const cell={current:null};assert.equal(observer.refCall('call',()=>cell),cell);const first=records.at(-1);
  observer.refCall('call',()=>cell);assert.equal(records.at(-1).ref_id,first.ref_id);assert.equal(records.at(-1).previously_returned,true);
  context='second';observer.refCall('call',()=>cell);assert.notEqual(records.at(-1).ref_id,first.ref_id);assert.equal(records.at(-1).previously_returned,false);
  const error={original:true};Object.defineProperty(cell,'current',{get(){throw error;},set(){throw error;}});
  fail=true;assert.throws(()=>observer.refRead('read',cell),actual=>actual===error);
  assert.throws(()=>observer.refWrite('write',cell,17),actual=>actual===error);
  assert.throws(()=>observer.refCall('call',()=>{throw error;}),actual=>actual===error);
});

test('instrumentation preserves nested ref expressions and assignment results',()=>{
  const {context,records,integration}=setup(`import * as React from 'react';
    const first=React.createRef(),second=React.createRef();second.current=7;
    const assigned=first.current=second.current;globalThis.result=[assigned,first.current,React.createRef().current];`);
  assert.deepEqual(Array.from(context.result),[7,7,null]);
  for(const record of records.filter(row=>row.kind==='react_ref'))assert.equal(integration.joinRef(record).status,'resolved');
});


test('ref method calls retain the exact receiver and callee before evaluating arguments',()=>{
  for(const expression of ['box.current','(box.current)','(box.current!)',"box['current']"]) {
    const {integration,records,context}=setup(`import * as React from 'react';
      const box=React.createRef();const original=function(value){return [this===box,value];};
      const replacement=()=>['wrong'];box.current=original;
      const mutate=()=>{box.current=replacement;return 7;};globalThis.result=${expression}(mutate());`);
    assert.deepEqual(Array.from(context.result),[true,7]);
    for(const record of records)integration.onRecord(record);
    const invoked=records.find(row=>row.kind==='react_ref' && row.operation==='invoke');assert.ok(invoked);
    const joined=integration.joinRef(invoked);assert.equal(joined.status,'resolved');assert.equal(joined.runtime.callback_path.status,'resolved');
    assert.equal(joined.runtime.body_execution_proven,false);
    const source=records.find(row=>row.kind==='react_callback_source');assert.equal(joined.runtime.callback_path.source_id,source.source_id);
    assert.equal(integration.joinRef({...invoked,read_observation_id:'ref-test:missing'}).reason,'ref_method_read_required');
    assert.equal(integration.joinRef({...invoked,callee:{...invoked.callee,identity:'ref-test:other'}}).reason,'ref_method_read_required');
    assert.equal(integration.joinRef({...invoked,callback:{...invoked.callback,callback_identity_id:'ref-test:other'}}).reason,'ref_method_callee_source_mismatch');
    const clean=createReactRuntimeIntegration(compileReactSources({'refs.ts':`import * as React from 'react';`},{packages}));
    assert.equal(clean.joinRef(invoked).reason,'map_fingerprint_mismatch');
  }
});

test('ref method getter and argument failures cannot become successful callback evidence',()=>{
  const {integration,records,context}=setup(`import * as React from 'react';
    const box=React.useRef(null);const events=[];const boom={bad:true};
    const fn=function(value){events.push(this===box);return value;};
    Object.defineProperty(box,'current',{get(){events.push('get');return fn;}});
    const argument=()=>{events.push('argument');throw boom;};
    try {box.current(argument());}catch(error){events.push(error===boom);}
    globalThis.result=events;`);
  assert.deepEqual(Array.from(context.result),['get','argument',true]);
  assert.equal(records.filter(row=>row.operation==='invoke').length,0);
  for(const record of records)integration.onRecord(record);
  const read=records.find(row=>row.kind==='react_ref' && row.operation==='read');assert.equal(integration.joinRef(read).status,'resolved');
  const failed=setup(`import * as React from 'react';const box=React.useRef(null);const boom={bad:true};
    Object.defineProperty(box,'current',{get(){throw boom;}});try {box.current();}catch(error){globalThis.result=error===boom;}`);
  assert.equal(failed.context.result,true);assert.equal(failed.records.filter(row=>row.operation==='invoke').length,0);
});

test('unknown ref call targets remain unresolved and stopped method wrappers preserve original exceptions',()=>{
  const {integration,records,context}=setup(`import * as React from 'react';const box=React.createRef();
    let evaluations=0;try {box.current(++evaluations);}catch(error){globalThis.result=[evaluations,error.name];}`);
  assert.deepEqual(Array.from(context.result),[1,'TypeError']);for(const record of records)integration.onRecord(record);
  const invoked=records.find(row=>row.operation==='invoke');assert.equal(integration.joinRef(invoked).runtime.callback_path.reason,'ref_callable_source_unobserved');
  let enabled=true,reads=0;const error={original:true},cell={get current(){reads++;return function(){assert.equal(this,cell);throw error;};}};
  const observer=createReactRefObserver({entry:()=>({ref_property:'current',ref_access:{mode:'invoke'}}),enabled:()=>enabled,
    id:()=> 'session:1',encode:()=>({encoding:'redacted',value:null}),observe:()=>{}});
  const method=observer.refMethod('call',cell);enabled=false;
  assert.throws(()=>method(),actual=>actual===error);assert.equal(reads,1);
});


test('ref evidence rejects invalid executable programs and property substitutions',()=>{
  const {map,integration,records}=setup(),entries=integration.bindings.react_lifecycle.entries;
  const origin=records.find(row=>row.kind==='react_ref' && row.operation==='returned');
  const read=records.find(row=>row.kind==='react_ref' && row.operation==='read');
  const badRule=entries.map(entry=>entry.ref_rule?{...entry,ref_rule:{...entry.ref_rule,write_scheduling:'invented'}}:entry);
  assert.equal(createReactRefEvidenceSession({fingerprint:map.fingerprint,entries:badRule}).join(origin).reason,'ref_rule_invalid');
  const altered=entries.map(entry=>entry.ref_access?{...entry,ref_property:'other'}:entry);
  const session=createReactRefEvidenceSession({fingerprint:map.fingerprint,entries:altered});session.join(origin);
  assert.equal(session.join(read).reason,'ref_source_property_mismatch');
});
