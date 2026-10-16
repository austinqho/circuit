import test from 'node:test';
import assert from 'node:assert/strict';
import { createOwnedReferenceBoundary } from '../analysis/library-owned-reference.mjs';
const arg = index => ({ op: 'arg', index });
const call = (target, value) => ({ op: 'call', target, receiver: { op: 'undefined' }, args: { op: 'array', items: [value] } });
const rule = { schema: 'producttrace.library-program.v1', body: { op: 'sequence', steps: [
  call(arg(2), { op: 'get', value: arg(0), key: 0 }), call(arg(3), arg(1)),
] } };

test('owned reference rules preserve exact callbacks and distinguish instances without simulating renders', () => {
  let owner = {}, retained;
  const boundary = createOwnedReferenceBoundary({ producer: cb => retained ??= cb, program: rule, captureOwner: () => owner });
  const first = () => 1, second = () => 2;
  assert.equal(boundary.invoke([first], { callbackIds: { 0: 'first-source' } }), first);
  assert.equal(boundary.invoke([second], { callbackIds: { 0: 'second-source' } }), first);
  let report = boundary.checkpoint();
  assert.equal(report.status, 'observed_agreement');
  assert.deepEqual(report.evidence[1].sources, ['first-source']);
  assert.equal(report.evidence[0].value, report.evidence[1].value);
  owner = {}; // An identical result in a different instance has no known origin.
  boundary.invoke([second], { callbackIds: { 0: 'another-instance' } });
  report = boundary.checkpoint();
  assert.equal(report.status, 'frontier');
  assert.equal(report.failures[0].reason, 'returned_callback_origin_unobserved');
});

test('wrong argument, wrong selected value, and fabricated evidence all reject', () => {
  const mutations = [
    value => { value.body.steps[0].args.items[0].key = 1; },
    value => { value.body.steps[1].args.items[0] = { op: 'get', value: arg(0), key: 1 }; },
    value => { value.body.steps[1] = { op: 'object', entries: {} }; },
  ];
  for (const mutate of mutations) {
    const program = structuredClone(rule); mutate(program);
    const boundary = createOwnedReferenceBoundary({ producer: cb => cb, program, captureOwner: () => ({}) });
    const cb = () => 1;
    assert.equal(boundary.invoke([cb, () => 2], { callbackIds: { 0: 'source' } }), cb);
    assert.equal(boundary.checkpoint().status, 'frontier');
  }
});

test('a missing owner leaves the application intact and grants no evidence', () => {
  const cb = () => 1;
  const boundary = createOwnedReferenceBoundary({ producer: value => value, program: rule, captureOwner: () => null });
  assert.equal(boundary.invoke([cb], { callbackIds: { 0: 'source' } }), cb);
  assert.equal(boundary.checkpoint().status, 'frontier');
  assert.equal(boundary.checkpoint().evidence.length, 0);
});

test('rule evaluation sees opaque identities and cannot inspect application proxy callbacks', () => {
  let traps=0,calls=0;
  const callback=new Proxy(()=>{calls++;},{getOwnPropertyDescriptor(target,key){traps++;return Object.getOwnPropertyDescriptor(target,key);}});
  const program=structuredClone(rule);
  program.body.steps.unshift({op:'get',value:{op:'get',value:arg(0),key:0},key:'unused'});
  const boundary=createOwnedReferenceBoundary({producer:cb=>cb,program,captureOwner:()=>({})});
  assert.equal(boundary.invoke([callback],{callbackIds:{0:'callback-source'}}),callback);
  assert.equal(boundary.checkpoint().status,'observed_agreement');
  assert.equal(traps,0);assert.equal(calls,0);
  const invoke=structuredClone(rule);
  invoke.body.steps.unshift(call({op:'get',value:arg(0),key:0},{op:'undefined'}));
  const rejected=createOwnedReferenceBoundary({producer:cb=>cb,program:invoke,captureOwner:()=>({})});
  assert.equal(rejected.invoke([callback],{callbackIds:{0:'callback-source'}}),callback);
  assert.equal(rejected.checkpoint().status,'frontier');assert.equal(calls,0);assert.equal(traps,0);
});

test('reference ownership joins the real API call without claiming stored callback execution',async()=>{
  const {createLibraryExecutionContext}=await import('../analysis/library-execution-context.mjs');
  const executionContext=createLibraryExecutionContext({prefix:'reference-execution'}),owner={};let calls=0;
  const callback=()=>{calls++;};
  const boundary=createOwnedReferenceBoundary({producer:cb=>cb,program:rule,captureOwner:()=>owner,executionContext,executionSource:{file:'callback.ts'}});
  assert.equal(boundary.invoke([callback],{callbackIds:{0:'source'}}),callback);
  const report=boundary.checkpoint(),events=executionContext.checkpoint().events;
  assert.equal(report.status,'observed_agreement');assert.equal(events.length,1);assert.equal(events[0].kind,'library_invocation');assert.equal(calls,0);
  assert.equal(report.evidence[0].execution_id,events[0].id);assert.equal(events[0].source.file,'callback.ts');
  const error=new Error('actual');const throwing=createOwnedReferenceBoundary({producer:()=>{throw error},program:rule,captureOwner:()=>null,executionContext});
  assert.throws(()=>throwing.invoke([]),caught=>caught===error);assert.equal(executionContext.checkpoint().events[1].outcome,'throw');
  assert.equal(throwing.checkpoint().status,'frontier');
});
