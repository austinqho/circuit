import test from 'node:test';
import assert from 'node:assert/strict';
import {createLibraryExecutionContext} from '../analysis/library-execution-context.mjs';
import {createLibraryBoundary} from '../analysis/library-boundary.mjs';

const arg=index=>({op:'arg',index});
const invoke={schema:'producttrace.library-program.v1',body:{op:'call',target:arg(0),receiver:{op:'undefined'},args:{op:'array',items:[arg(1)]}}};
const library=(callback,value)=>callback(value);

test('different boundaries retain the actual enclosing callback without replay events', () => {
  const executionContext=createLibraryExecutionContext({prefix:'chain'});
  const first=createLibraryBoundary({producer:library,program:invoke,callbackArguments:[0],executionContext,executionSource:{binding:'first'}});
  const second=createLibraryBoundary({producer:library,program:invoke,callbackArguments:[0],executionContext,executionSource:{binding:'second'}});
  let observed,called=0;
  assert.equal(first.invoke([value=>second.invoke([inner=>{called++;observed=executionContext.current();return inner},value]),'value']),'value');
  assert.equal(called,1);assert.equal(executionContext.current(),null);
  const events=executionContext.checkpoint().events;
  assert.deepEqual(events.map(row=>row.kind),['library_invocation','callback_invocation','library_invocation','callback_invocation']);
  assert.deepEqual(events.map(row=>row.parent_id),[null,'chain:1','chain:2','chain:3']);
  assert(events.slice(1).every(row=>row.parent_relation==='synchronous'));
  assert.equal(observed.id,'chain:4');assert.equal(observed.outcome,'incomplete');
  assert.equal(first.checkpoint().evidence[0].execution_id,'chain:2');
  assert.equal(second.checkpoint().evidence[0].execution_id,'chain:4');
  assert.equal(first.checkpoint().status,'observed_agreement');assert.equal(second.checkpoint().status,'observed_agreement');
});

test('interleaved asynchronous continuations keep distinct parents and preserve thrown values', async () => {
  const context=createLibraryExecutionContext({prefix:'async'}),errors=[new Error('one'),new Error('two')];
  const work=errors.map((error,index)=>context.run({kind:'library_invocation',occurrence:`request:${index}`},()=>{
    return new Promise(resolve=>setTimeout(()=>{
      assert.equal(context.current().occurrence,`request:${index}`);
      assert.throws(()=>context.run({kind:'library_invocation',occurrence:`child:${index}`},()=>{throw error}),caught=>caught===error);
      resolve();
    },index?0:5));
  }));
  assert.equal(context.current(),null);await Promise.all(work);
  const events=context.checkpoint().events,parents=events.filter(row=>row.occurrence.startsWith('request'));
  for(const row of events.filter(row=>row.occurrence.startsWith('child'))) {
    assert.equal(row.parent_id,parents[Number(row.occurrence.at(-1))].id);
    assert.equal(row.parent_relation,'async_continuation');assert.equal(row.outcome,'throw');
  }
  assert(parents.every(row=>row.outcome==='return'),'Returning promises does not assert their later fulfillment');
  events[0].occurrence='tampered';assert.equal(context.checkpoint().events[0].occurrence,'request:0');
});

test('independent contexts and exhausted observation budgets cannot lend a stale parent', () => {
  const a=createLibraryExecutionContext({prefix:'a',maxEvents:1}),b=createLibraryExecutionContext({prefix:'b'});
  let actual=0;
  a.run({kind:'library_invocation',occurrence:'outer'},()=>{
    assert.equal(b.current(),null);
    b.run({kind:'library_invocation',occurrence:'separate'},()=>assert.equal(b.current().parent_id,null));
    a.run({kind:'library_invocation',occurrence:'overflow'},event=>{actual++;assert.equal(event,null);assert.equal(a.current(),null);});
    assert.equal(a.current(),null);
  });
  assert.equal(actual,1);assert.equal(a.checkpoint().status,'frontier');assert.equal(a.checkpoint().events.length,1);
  assert.equal(b.checkpoint().status,'observed_execution');
});

test('a rejected rule does not erase actual execution or turn ancestry into agreement', () => {
  const executionContext=createLibraryExecutionContext({prefix:'wrong'}),program={schema:invoke.schema,body:{op:'undefined'}};
  const boundary=createLibraryBoundary({producer:library,program,callbackArguments:[0],executionContext});
  assert.equal(boundary.invoke([value=>value,1]),1);
  assert.equal(boundary.checkpoint().status,'frontier');
  assert.equal(executionContext.checkpoint().events.length,2);
  assert.equal(executionContext.checkpoint().status,'observed_execution');
});

test('identity-sensitive bypass remains an observed call with an explicit rule frontier', () => {
  const executionContext=createLibraryExecutionContext({prefix:'alias'}),callback=()=>1;
  let current;
  const boundary=createLibraryBoundary({producer:(a,b)=>{current=executionContext.current();return a===b},program:{schema:invoke.schema,body:{op:'literal',value:false}},callbackArguments:[0],executionContext});
  assert.equal(boundary.invoke([callback,callback]),true);
  assert.equal(current.kind,'library_invocation');assert.equal(executionContext.checkpoint().events.length,1);
  assert.equal(boundary.checkpoint().status,'frontier');assert.equal(boundary.checkpoint().failures[0].reason,'callback_alias_requires_identity_preserving_observer');
});
