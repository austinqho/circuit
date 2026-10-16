import test from 'node:test';
import assert from 'node:assert/strict';
import {createOwnedValueBoundary} from '../analysis/library-owned-value.mjs';
const program={schema:'producttrace.library-program.v1',body:{op:'bind',name:'saved',value:{op:'undefined'},body:{op:'fn',this_mode:'strict',body:{
  op:'if',test:{op:'equal',left:{op:'local',name:'saved'},right:{op:'undefined'}},then:{op:'set',name:'saved',value:{op:'object',entries:{current:{op:'arg',index:0}}}},else:{op:'local',name:'saved'},
}}}};
function fixture(candidate=program){
  const a={},b={},cache=new WeakMap();let owner=a,calls=0;
  const boundary=createOwnedValueBoundary({program:candidate,captureOwner:()=>owner,producer:value=>{calls++;if(!cache.has(owner))cache.set(owner,{current:value});return cache.get(owner)}});
  return {a,b,boundary,setOwner:value=>owner=value,calls:()=>calls};
}
test('stateful value replay retains each host slot independently and never invokes function values',()=>{
  const f=fixture(),callback=()=>{throw Error('a value must not execute')};
  const first=f.boundary.invoke([callback]);assert.equal(first.current,callback);
  assert.equal(f.boundary.invoke(['ignored']),first);
  f.setOwner(f.b);const second=f.boundary.invoke(['second']);assert.notEqual(second,first);
  f.setOwner(f.a);assert.equal(f.boundary.invoke(['still ignored']),first);
  const report=f.boundary.checkpoint();assert.equal(report.status,'observed_agreement',JSON.stringify(report));
  assert.equal(report.calls,4);assert.equal(f.calls(),4);assert.equal(report.owners,2);
  assert.equal(report.evidence[0].value.identity,report.evidence[1].value.identity);
  assert.notEqual(report.evidence[0].value.identity,report.evidence[2].value.identity);
});
test('reallocating a retained cell or forgetting its original value rejects',()=>{
  for(const body of [
    {op:'fn',this_mode:'strict',body:{op:'object',entries:{current:{op:'arg',index:0}}}},
    {op:'bind',name:'saved',value:{op:'object',entries:{current:{op:'literal',value:null}}},body:{op:'fn',this_mode:'strict',body:{op:'local',name:'saved'}}},
  ]){
    const f=fixture({...program,body});const first=f.boundary.invoke([1]);assert.equal(f.boundary.invoke([2]),first);
    assert.equal(f.boundary.checkpoint().status,'frontier');assert.equal(f.calls(),2);
  }
});
test('an outside write stays unresolved and a missing owner preserves the real call',()=>{
  const f=fixture(),ref=f.boundary.invoke([1]);ref.current=3;
  assert.equal(f.boundary.invoke([2]),ref);assert.equal(ref.current,3);
  assert.equal(f.boundary.checkpoint().status,'frontier');
  let calls=0;const error=new Error('original');
  const missing=createOwnedValueBoundary({program,captureOwner:()=>null,producer:()=>{calls++;throw error}});
  assert.throws(()=>missing.invoke([]),caught=>caught===error);assert.equal(calls,1);
  assert.equal(missing.checkpoint().failures[0].reason,'mounted_owner_unavailable');
});

test('owner replay privately snapshots its program before the first slot exists',()=>{
  const supplied=structuredClone(program),f=fixture(supplied);
  supplied.body.body.body.then.value.entries.current={op:'literal',value:'changed'};
  assert.equal(f.boundary.invoke([1]).current,1);
  assert.equal(f.boundary.checkpoint().status,'observed_agreement');
  assert.throws(()=>createOwnedValueBoundary({producer:()=>{},captureOwner:()=>({}),program:{...program,body:{op:'unknown'}}}),/instruction_shape/);
});

test('owned callback replay keeps function results identical and emits their observed invocation',()=>{
  const program={schema:'producttrace.library-program.v1',body:{op:'fn',this_mode:'strict',body:{op:'call',target:{op:'arg',index:0},receiver:{op:'undefined'},args:{op:'array',items:[]}}}};
  const owner={};let calls=0;const result=()=>42;
  const boundary=createOwnedValueBoundary({program,captureOwner:()=>owner,callbackArguments:[0],producer:cb=>cb()});
  assert.equal(boundary.invoke([()=>{calls++;return result}]),result);
  assert.equal(boundary.invoke([()=>{calls++;return result}]),result);
  assert.equal(calls,2);const report=boundary.checkpoint();
  assert.equal(report.status,'observed_agreement',JSON.stringify(report));
  assert.equal(report.evidence.filter(row=>row.kind==='callback_invocation').length,2);
  assert(report.evidence.every(row=>row.owner));
  const wrong=structuredClone(program);wrong.body.body={op:'fn',this_mode:'strict',body:{op:'literal',value:42}};
  const rejected=createOwnedValueBoundary({program:wrong,captureOwner:()=>owner,callbackArguments:[0],producer:cb=>cb()});
  assert.equal(rejected.invoke([()=>result]),result);assert.equal(rejected.checkpoint().status,'frontier');
});

test('host generations restore earlier private state without joining different owners',()=>{
  const firstOwner={},secondOwner={},firstGeneration={},secondGeneration={};
  let owner=firstOwner,generation=firstGeneration;const actual=new WeakMap();
  const producer=value=>{let generations=actual.get(owner);if(!generations){generations=new WeakMap();actual.set(owner,generations)}
    if(!generations.has(generation))generations.set(generation,{current:value});return generations.get(generation)};
  const boundary=createOwnedValueBoundary({program,producer,captureOwner:()=>owner,captureGeneration:()=>generation});
  const first=boundary.invoke([1]);generation=secondGeneration;const second=boundary.invoke([2]);assert.notEqual(first,second);
  generation=firstGeneration;assert.equal(boundary.invoke([3]),first);
  owner=secondOwner;assert.notEqual(boundary.invoke([4]),first);
  const report=boundary.checkpoint();assert.equal(report.status,'observed_agreement');assert.equal(report.owners,2);assert.equal(report.generations,3);
  assert.equal(report.evidence[0].generation,report.evidence[2].generation);
  assert.notEqual(report.evidence[0].owner,report.evidence[3].owner);
  assert(report.evidence.every(row=>typeof row.boundary_occurrence==='string'));
  const missing=createOwnedValueBoundary({program,producer,captureOwner:()=>owner,captureGeneration:()=>null});
  assert.equal(missing.invoke([5]),producer(5));assert.equal(missing.checkpoint().failures[0].reason,'cache_generation_unavailable');
});

test('owned calls join downstream execution without emitting private bootstrap events',async()=>{
  const {createLibraryExecutionContext}=await import('../analysis/library-execution-context.mjs');
  const {createLibraryBoundary}=await import('../analysis/library-boundary.mjs');
  const executionContext=createLibraryExecutionContext({prefix:'owned-test'}),owner={};
  const call={op:'call',target:{op:'arg',index:0},receiver:{op:'undefined'},args:{op:'array',items:[]}};
  const next=createLibraryBoundary({producer:cb=>cb(),program:{schema:program.schema,body:call},callbackArguments:[0],executionContext});
  const owned=createOwnedValueBoundary({producer:cb=>cb(),program:{schema:program.schema,body:{op:'fn',this_mode:'strict',body:call}},captureOwner:()=>owner,callbackArguments:[0],executionContext,executionSource:{file:'hook.ts'}});
  let seen;
  assert.equal(owned.invoke([()=>next.invoke([()=>{seen=executionContext.current();return 7}])]),7);
  const events=executionContext.checkpoint().events;
  assert.equal(events.length,4);assert.deepEqual(events.map(row=>row.kind),['library_invocation','callback_invocation','library_invocation','callback_invocation']);
  assert.equal(events[0].occurrence,'owned-value:1');assert.equal(events[0].source.file,'hook.ts');
  assert.deepEqual(events.map(row=>row.parent_id),[null,events[0].id,events[1].id,events[2].id]);assert.equal(seen.id,events[3].id);
  const report=owned.checkpoint();assert.equal(report.status,'observed_agreement');
  assert.equal(report.evidence.find(row=>row.kind==='returned_value').execution_id,events[0].id);
  assert.equal(report.evidence.find(row=>row.kind==='callback_invocation').execution_id,events[1].id);
});

test('owned execution preserves interleaved async descendants and original throws',async()=>{
  const {createLibraryExecutionContext}=await import('../analysis/library-execution-context.mjs');
  const executionContext=createLibraryExecutionContext({prefix:'owned-async'}),owner={};
  const call={op:'call',target:{op:'arg',index:0},receiver:{op:'undefined'},args:{op:'array',items:[]}};
  const owned=createOwnedValueBoundary({producer:cb=>cb(),program:{schema:program.schema,body:{op:'fn',this_mode:'strict',body:call}},captureOwner:()=>owner,callbackArguments:[0],executionContext});
  const observed=[];
  for(let i=0;i<2;i++)owned.invoke([()=>{queueMicrotask(()=>observed.push(executionContext.current().id));return i}]);
  await new Promise(resolve=>queueMicrotask(resolve));
  const events=executionContext.checkpoint().events;
  assert.deepEqual(observed,[events[1].id,events[3].id]);assert.notEqual(events[1].occurrence,events[3].occurrence);
  const error=new Error('unchanged');assert.throws(()=>owned.invoke([()=>{throw error}]),caught=>caught===error);
  assert.deepEqual(executionContext.checkpoint().events.slice(-2).map(row=>row.outcome),['throw','throw']);
  assert.equal(owned.checkpoint().status,'observed_agreement');
});

test('an unavailable owner and a rejected rule preserve observed execution without agreement',async()=>{
  const {createLibraryExecutionContext}=await import('../analysis/library-execution-context.mjs');
  const executionContext=createLibraryExecutionContext({prefix:'owned-frontier'});
  const missing=createOwnedValueBoundary({producer:()=>3,program,captureOwner:()=>null,executionContext});
  assert.equal(missing.invoke([]),3);assert.equal(missing.checkpoint().status,'frontier');assert.equal(executionContext.checkpoint().events.length,1);
  const wrong=createOwnedValueBoundary({producer:()=>3,program,captureOwner:()=>({}),executionContext});
  assert.equal(wrong.invoke([]),3);assert.equal(wrong.checkpoint().status,'frontier');assert.equal(executionContext.checkpoint().events.length,2);
});

test('a later owned callback retains its originating call after the synchronous frame ends',async()=>{
  const {createLibraryExecutionContext}=await import('../analysis/library-execution-context.mjs');
  const executionContext=createLibraryExecutionContext({prefix:'owned-deferred'}),owner={};
  const deferred={schema:program.schema,body:{op:'fn',this_mode:'strict',body:{op:'defer',body:{op:'call',target:{op:'arg',index:0},receiver:{op:'undefined'},args:{op:'array',items:[]}}}}};
  let current;
  const boundary=createOwnedValueBoundary({producer:cb=>queueMicrotask(cb),program:deferred,captureOwner:()=>owner,callbackArguments:[0],executionContext});
  boundary.invoke([()=>{current=executionContext.current()}]);
  await new Promise(resolve=>queueMicrotask(resolve));
  const events=executionContext.checkpoint().events;
  assert.equal(events.length,2);assert.equal(events[1].parent_id,events[0].id);assert.equal(events[1].parent_relation,'async_continuation');
  assert.equal(events[1].occurrence,events[0].occurrence);assert.equal(current.id,events[1].id);
  assert.equal(boundary.checkpoint().status,'observed_agreement');
});
