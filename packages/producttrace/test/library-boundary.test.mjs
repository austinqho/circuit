import test from 'node:test';
import assert from 'node:assert/strict';
import { createLibraryBoundary } from '../analysis/library-boundary.mjs';
import { LIBRARY_PROGRAM_SCHEMA } from '../analysis/library-program.mjs';
const p = body => ({ schema: LIBRARY_PROGRAM_SCHEMA, body });
const arg = index => ({ op: 'arg', index });
const u = { op: 'undefined' };
const invoke = { op: 'call', target: arg(0), receiver: u, args: { op: 'array', items: [arg(1)] } };
const wrapper = p({ op: 'bind', name: 'callback', value: arg(0), body: { op: 'fn', this_mode: 'strict', body: {
  op: 'call', target: { op: 'local', name: 'callback' }, receiver: { op: 'receiver' }, args: { op: 'args' },
} } });

test('real callback executes once; interpreter consumes its original result and emits a source callback edge', () => {
  let calls = 0;
  const value = { id: 'value' };
  const boundary = createLibraryBoundary({ producer: (cb, v) => cb(v), program: p(invoke), callbackArguments: [0] });
  assert.equal(boundary.invoke([v => { calls++; return v; }, value], { callbackIds: { 0: 'source:handler' } }), value);
  const result = boundary.checkpoint();
  assert.equal(calls, 1);
  assert.equal(result.status, 'observed_agreement', JSON.stringify(result));
  assert.equal(result.evidence[0].callback, 'source:handler');
});

test('returned callbacks preserve receiver, original throw identity, and interleaved ownership', () => {
  const boundary = createLibraryBoundary({ producer: cb => function (...args) { return Reflect.apply(cb, this, args); },
    program: wrapper, callbackArguments: [0] });
  const seen = [], error = new Error('original');
  const first = boundary.invoke([function (value) { seen.push(this); if (value === 'throw') throw error; return value; }], { callbackIds: { 0: 'first' } });
  const second = boundary.invoke([value => `second:${value}`], { callbackIds: { 0: 'second' } });
  const receiver = {};
  assert.equal(first.call(receiver, 'first'), 'first');
  assert.equal(second('second'), 'second:second');
  assert.throws(() => first('throw'), e => e === error);
  assert.deepEqual(seen, [receiver, undefined]);
  const result = boundary.checkpoint();
  assert.equal(result.status, 'observed_agreement', JSON.stringify(result));
  assert.deepEqual(result.evidence.map(row => row.callback), ['first', 'second', 'first']);
  assert.equal(new Set(result.evidence.map(row => row.occurrence)).size, 3);
});

test('wrong count, value, timing, owner, and return rules cannot become observed agreement', async () => {
  const cases = [
    { producer: (cb, v) => { cb(v); return cb(v); }, body: invoke },
    { producer: (cb, v) => cb({ ...v }), body: invoke },
    { producer: (cb, v) => { queueMicrotask(() => cb(v)); }, body: invoke, wait: true },
    { producer: (cb, v) => cb(v), body: { ...invoke, target: arg(2) }, callbacks: [0, 2] },
    { producer: (cb, v) => { cb(v); return null; }, body: invoke },
  ];
  for (const sample of cases) {
    const boundary = createLibraryBoundary({ producer: sample.producer, program: p(sample.body), callbackArguments: sample.callbacks || [0] });
    boundary.invoke([v => v, { payload: 1 }, v => v]);
    if (sample.wait) await new Promise(resolve => setTimeout(resolve, 2));
    assert.equal(boundary.checkpoint().status, 'frontier');
  }
});

test('deferred invocation uses exact async context rather than a most-recent-call guess', async () => {
  const deferred = p({ op: 'defer', body: { ...invoke, args: { op: 'array', items: [] } } });
  const boundary = createLibraryBoundary({ producer: cb => queueMicrotask(cb), program: deferred, callbackArguments: [0] });
  const calls = [];
  boundary.invoke([() => calls.push('first')], { callbackIds: { 0: 'first' } });
  boundary.invoke([() => calls.push('second')], { callbackIds: { 0: 'second' } });
  await new Promise(resolve => setTimeout(resolve, 2));
  const result = boundary.checkpoint();
  assert.equal(result.status, 'observed_agreement', JSON.stringify(result));
  assert.deepEqual(calls, ['first', 'second']);
  assert.deepEqual(result.evidence.map(row => [row.callback, row.timing]), [['first', 'deferred'], ['second', 'deferred']]);
});

test('the program cannot erase extra real invocations or forge a source callback ID', () => {
  const boundary = createLibraryBoundary({ producer: cb => { cb(); return 42; }, program: p({ op: 'literal', value: 42 }), callbackArguments: [0] });
  boundary.invoke([() => null], { callbackIds: { 0: 'trusted:source' } });
  const result = boundary.checkpoint();
  assert.equal(result.status, 'frontier');
  assert.equal(result.evidence[0].callback, 'trusted:source');
  assert.equal(result.failures[0].reason, 'unmodeled_callback_invocation');
});

test('input identity and a fresh equal object are different claims', () => {
  const program = p({ op: 'object', entries: { id: { op: 'get', value: arg(0), key: 'id' } } });
  const boundary = createLibraryBoundary({ producer: value => value, program });
  boundary.invoke([{ id: 3 }]);
  assert.equal(boundary.checkpoint().status, 'frontier');
});

test('a callback mutation cannot make replay borrow the post-call input as its starting state', () => {
  const boundary = createLibraryBoundary({ producer: (cb, value) => cb(value), program: p(invoke), callbackArguments: [0] });
  const value = { count: 0 };
  assert.equal(boundary.invoke([v => { v.count++; return v; }, value]), value);
  const report = boundary.checkpoint();
  assert.equal(value.count, 1);
  assert.equal(report.status, 'frontier');
  assert(report.failures.some(row => row.reason === 'input_mutation_requires_heap_replay'));
});

test('reference observation preserves callback identity and reports storage without claiming invocation', () => {
  const cb = () => 'same', program = p({ op: 'object', entries: { render: arg(0) } });
  const boundary = createLibraryBoundary({ producer: render => ({ render }), program,
    callbackArguments: [0], resultPaths: [['render']], observationMode: 'references' });
  const first = boundary.invoke([cb], { callbackIds: { 0: 'source:component' } });
  const second = boundary.invoke([cb]);
  assert.equal(first.render, cb); assert.equal(second.render, cb);
  const report = boundary.checkpoint();
  assert.equal(report.status, 'observed_agreement');
  assert.equal(report.observation_mode, 'references');
  assert.equal(report.evidence[0].kind, 'callback_reference');
  assert.deepEqual(report.evidence[0].result_path, ['render']);
  assert.equal(report.evidence[0].callback, 'source:component');
  assert.equal(report.evidence[0].outcome, undefined);
  const identity = createLibraryBoundary({ producer: value => value, program: p(arg(0)), callbackArguments: [0], observationMode: 'references' });
  assert.equal(identity.invoke([cb]), cb);
});

test('reference observation rejects execution programs and wrong stored callback identities', () => {
  assert.throws(() => createLibraryBoundary({ producer: cb => cb(), program: p(invoke), observationMode: 'references' }), /reference_mode_cannot_predict_execution/);
  const boundary = createLibraryBoundary({ producer: render => ({ render }), program: p({ op: 'object', entries: { render: arg(1) } }),
    callbackArguments: [0, 1], resultPaths: [['render']], observationMode: 'references' });
  boundary.invoke([() => 1, () => 2]);
  assert.equal(boundary.checkpoint().status, 'frontier');
});

test('library-created errors require explicit error scope and exact class, message and additional fields', () => {
  const program = p({ op: 'throw', value: { op: 'make_error', name: 'Error', message: { op: 'literal', value: 'one child required' } } });
  const producer = () => { throw new Error('one child required'); };
  const strict = createLibraryBoundary({ producer, program });
  assert.throws(() => strict.invoke([]), /one child required/);
  assert.equal(strict.checkpoint().status, 'frontier');
  for (const [make, accepted] of [
    [() => new Error('one child required'), true],
    [() => new TypeError('one child required'), false],
    [() => new Error('wrong message'), false],
    [() => Object.assign(new Error('one child required'), {code:'EXTRA'}), false],
    [() => ({message:'one child required'}), false],
  ]) {
    const boundary = createLibraryBoundary({ producer: () => { throw make(); }, program, errorObservation: 'standard_error_without_stack' });
    assert.throws(() => boundary.invoke([]));
    assert.equal(boundary.checkpoint().status, accepted ? 'observed_agreement' : 'frontier');
    assert.equal(boundary.checkpoint().error_observation, 'standard_error_without_stack');
  }
});

test('thrown primitives distinguish NaN and signed zeros without weakening callback identity', () => {
  for (const value of [NaN, -0, 0, undefined, 'error']) {
    const boundary = createLibraryBoundary({ producer: x => { throw x; }, program: p({op:'throw',value:arg(0)}) });
    try { boundary.invoke([value]); assert.fail('must throw'); } catch (caught) { assert(Object.is(caught, value)); }
    assert.equal(boundary.checkpoint().status, 'observed_agreement');
  }
  const wrong = createLibraryBoundary({ producer: () => { throw -0; }, program: p({op:'throw',value:{op:'literal',value:0}}) });
  assert.throws(() => wrong.invoke([]));
  assert.equal(wrong.checkpoint().status, 'frontier');
});

test('opaque accessor descriptors are not evaluated and cannot be read or silently replaced', () => {
  let reads = 0;
  const value = { visible: 1 };
  Object.defineProperty(value, 'debug', { get() { reads++; throw new Error('unread debug accessor'); }, configurable: true });
  const identity = createLibraryBoundary({ producer: x => x, program: p(arg(0)), accessorObservation: 'opaque_descriptors' });
  assert.equal(identity.invoke([value]), value);
  assert.equal(identity.checkpoint().status, 'observed_agreement'); assert.equal(reads, 0);
  const wrongRead = createLibraryBoundary({ producer: x => x, program: p({op:'get',value:arg(0),key:'debug'}), accessorObservation: 'opaque_descriptors' });
  assert.equal(wrongRead.invoke([value]), value);
  assert.equal(wrongRead.checkpoint().status, 'frontier'); assert.equal(reads, 0);
  assert.equal(wrongRead.checkpoint().failures[0].reason, 'accessor_requires_host_evidence');
  const mutation = createLibraryBoundary({ producer: x => { Object.defineProperty(x,'debug',{get:()=>3}); return x; }, program:p(arg(0)),accessorObservation:'opaque_descriptors' });
  assert.equal(mutation.invoke([value]),value);
  assert.equal(mutation.checkpoint().status,'frontier');
  assert.equal(mutation.checkpoint().failures[0].reason,'input_mutation_requires_heap_replay');
});

test('unsupported proxies are not inspected by graph seeding or replay', () => {
  let traps=0, calls=0;
  const value=new Proxy({value:1},{ownKeys(target){traps++;return Reflect.ownKeys(target);},getOwnPropertyDescriptor(target,key){traps++;return Object.getOwnPropertyDescriptor(target,key);}});
  const boundary=createLibraryBoundary({producer:x=>{calls++;return x;},program:p({op:'get',value:arg(0),key:'value'})});
  assert.equal(boundary.invoke([value]),value);
  assert.equal(calls,1); assert.equal(traps,0);
  assert.equal(boundary.checkpoint().status,'frontier');
  assert.equal(boundary.checkpoint().failures[0].reason,'proxy_input_outside_domain');
});

test('an unknown proxy result remains opaque even when the rule requests an output projection', () => {
  let traps=0;
  const result=new Proxy({value:1},{getOwnPropertyDescriptor(target,key){traps++;return Object.getOwnPropertyDescriptor(target,key);}});
  const boundary=createLibraryBoundary({producer:()=>result,program:p({op:'object',entries:{value:{op:'literal',value:1}}}),resultPaths:[['value']]});
  assert.equal(boundary.invoke([]),result); assert.equal(traps,0);
  assert.equal(boundary.checkpoint().status,'frontier');
  assert.equal(boundary.checkpoint().failures[0].reason,'proxy_projection_outside_domain');
});

test('a previously matched result identity does not hide later field changes', () => {
  const producer=()=>{const value={count:0};return()=>{value.count++;return value;};};
  const program=p({op:'bind',name:'cached',value:{op:'object',entries:{count:{op:'literal',value:1}}},body:{op:'fn',this_mode:'strict',body:{op:'local',name:'cached'}}});
  const boundary=createLibraryBoundary({producer,program});
  const returned=boundary.invoke([]);
  const first=returned();assert.equal(first.count,1);
  assert.equal(boundary.checkpoint().status,'observed_agreement');
  assert.equal(returned(),first);assert.equal(first.count,2);
  assert.equal(boundary.checkpoint().status,'frontier');
  assert.equal(boundary.checkpoint().failures[0].reason,'result_value_or_identity_mismatch');
});

test('nested callback evidence retains input and output paths per occurrence without invoking callbacks', () => {
  const program=p({op:'object',entries:{props:{op:'arg',index:0}}});
  let calls=0;const first=()=>calls++,second=()=>calls++;
  const boundary=createLibraryBoundary({producer:props=>({props}),program,observationMode:'references',nestedReferences:true,resultPaths:[['props']]});
  const a={onClick:first},b={onClick:second};a.self=a;
  assert.equal(boundary.invoke([a]).props.onClick,first);
  assert.equal(boundary.invoke([b]).props.onClick,second);
  const report=boundary.checkpoint();assert.equal(report.status,'observed_agreement');assert.equal(calls,0);
  assert.equal(report.evidence.length,2);assert.notEqual(report.evidence[0].occurrence,report.evidence[1].occurrence);
  for(const evidence of report.evidence){assert.deepEqual(evidence.input_path,[0,'onClick']);assert.deepEqual(evidence.result_path,['props','onClick']);assert.equal(evidence.kind,'callback_reference');}
});

test('nested callback transport rejects substitution and does not convert getter fields into origins', () => {
  let reads=0;const actual=()=>1,other=()=>2;
  const props={onClick:actual,other};Object.defineProperty(props,'hidden',{get(){reads++;return actual}});
  const wrong=p({op:'object',entries:{props:{op:'object',entries:{onClick:{op:'get',value:arg(0),key:'other'},other:{op:'get',value:arg(0),key:'other'}}}}});
  const boundary=createLibraryBoundary({producer:props=>({props}),program:wrong,observationMode:'references',nestedReferences:true,resultPaths:[['props']],accessorObservation:'opaque_descriptors'});
  boundary.invoke([props]);const report=boundary.checkpoint();
  assert.equal(report.status,'frontier');assert.equal(reads,0);
  assert(!report.evidence.some(row=>row.status==='observed_agreement'));
  assert(!report.evidence.some(row=>row.result_path.includes('hidden')));
  assert.throws(()=>createLibraryBoundary({producer:()=>{},program:p(u),nestedReferences:true}),/nested_reference_mode/);
});

test('prototype changes cannot masquerade as an unchanged input identity', () => {
  const input={},prototype={inherited:'changed'};
  const boundary=createLibraryBoundary({producer:value=>{Object.setPrototypeOf(value,prototype);return value},program:p(arg(0))});
  assert.equal(boundary.invoke([input]),input);assert.equal(Object.getPrototypeOf(input),prototype);
  const report=boundary.checkpoint();assert.equal(report.status,'frontier');assert(report.failures.some(row=>row.reason==='input_mutation_requires_heap_replay'));
});

test('symbol-keyed state is checked for mutation and cannot create ambiguous reference IDs', () => {
  const key=Symbol('state'),input={[key]:{count:0}};
  const boundary=createLibraryBoundary({producer:value=>{value[key].count++;return value},program:p(arg(0))});
  boundary.invoke([input]);assert.equal(boundary.checkpoint().status,'frontier');
  const opaque={[Symbol('callback')]:()=>1};
  const refs=createLibraryBoundary({producer:value=>value,program:p(arg(0)),observationMode:'references',nestedReferences:true,resultPaths:[[]]});
  refs.invoke([opaque]);const report=refs.checkpoint();assert.equal(report.status,'frontier');assert(report.failures.some(row=>row.reason==='symbol_reference_path_requires_host_identity'));
});

test('invisible native and private class state never passes an identity-only rule', () => {
  class Hidden {#count=0;advance(){this.#count++} read(){return this.#count}}
  for(const [value,mutate] of [[new Map(),x=>x.set('x',1)],[new Set(),x=>x.add(1)],[new Date(0),x=>x.setTime(1)],[new Hidden(),x=>x.advance()]]){
    const boundary=createLibraryBoundary({producer:input=>{mutate(input);return input},program:p(arg(0))});
    assert.equal(boundary.invoke([value]),value);const report=boundary.checkpoint();
    assert.equal(report.status,'frontier');assert(report.failures.some(row=>row.reason==='hidden_input_state_requires_host_evidence'));
  }
});

test('cross-realm callback argument transport does not weaken application value identity', async () => {
  const vm=await import('node:vm');
  const callback=vm.runInNewContext('(function(value){"use strict"; return value})');
  const producer=(cb,value)=>cb.apply(null,[value]);
  const exact=p({op:'call',target:arg(0),receiver:{op:'literal',value:null},args:{op:'array',items:[arg(1)]}});
  const input={id:1};
  const boundary=createLibraryBoundary({producer,program:exact,callbackArguments:[0]});
  assert.equal(boundary.invoke([callback,input]),input);assert.equal(boundary.checkpoint().status,'observed_agreement');
  const wrong=structuredClone(exact);wrong.body.args.items[0]={op:'object',entries:{id:{op:'literal',value:1}}};
  const incorrect=createLibraryBoundary({producer,program:wrong,callbackArguments:[0]});
  assert.equal(incorrect.invoke([callback,input]),input);assert.equal(incorrect.checkpoint().status,'frontier');
});

test('opt-in synthetic counterexamples expose NaN/count errors without dumping application objects', () => {
  const scope={producer:()=>undefined,program:p(invoke),callbackArguments:[0]};
  const hidden='input-must-not-appear-by-default';
  const ordinary=createLibraryBoundary(scope);ordinary.invoke([()=>{},hidden]);
  assert(!JSON.stringify(ordinary.checkpoint()).includes(hidden));
  const diagnostic=createLibraryBoundary({...scope,diagnosticInputs:true});diagnostic.invoke([()=>{},NaN]);
  const report=diagnostic.checkpoint(),detail=report.failures[0].detail;
  assert.equal(detail.observed_callback_count,0);assert.equal(detail.predicted_callback_ordinal,1);
  assert.deepEqual(detail.invocation.arguments[1],{type:'number',value:'NaN'});
  assert.deepEqual(detail.predicted_arguments,[{type:'number',value:'NaN'}]);
  assert(!report.failures.some(row=>row.reason==='unmodeled_callback_invocation'),'over-prediction is not an unconsumed actual callback');
  const marker={privateData:'do-not-dump-this-object'};
  const object=createLibraryBoundary({...scope,diagnosticInputs:true});object.invoke([()=>{},marker]);
  assert(!JSON.stringify(object.checkpoint()).includes(marker.privateData));
});

test('a callback-thrown frontier-class error remains the original application exception',async()=>{
  const {LibraryProgramFrontier}=await import('../analysis/library-program.mjs');
  const error=new LibraryProgramFrontier('application_exception');
  const boundary=createLibraryBoundary({producer:cb=>cb(),program:p({...invoke,args:{op:'array',items:[]}}),callbackArguments:[0]});
  assert.throws(()=>boundary.invoke([()=>{throw error}]),caught=>caught===error);
  assert.equal(boundary.checkpoint().status,'observed_agreement');
});

test('a fresh function passed into a callback cannot borrow the callback outcome as proof of its body', () => {
  for (const predicted of [1, 2]) {
    let applicationCalls = 0;
    const boundary = createLibraryBoundary({ producer: cb => cb(() => 1), callbackArguments: [0],
      program: p({ ...invoke, args: { op: 'array', items: [{ op: 'fn', this_mode: 'strict', body: { op: 'literal', value: predicted } }] } }) });
    assert.equal(boundary.invoke([fn => { applicationCalls++; return fn(); }]), 1);
    assert.equal(applicationCalls, 1);
    const report = boundary.checkpoint();
    assert.equal(report.status, 'frontier');
    assert(report.failures.some(row => row.reason === 'nested_function_execution_requires_observer'));
  }
});

test('unobserved returned-object methods remain frontiers, while original input functions retain identity', () => {
  const boundary = createLibraryBoundary({ producer: () => ({ run: () => 'actual' }),
    program: p({ op: 'object', entries: { run: { op: 'fn', this_mode: 'strict', body: { op: 'literal', value: 'wrong' } } } }) });
  assert.equal(boundary.invoke([]).run(), 'actual');
  assert.equal(boundary.checkpoint().failures[0].reason, 'nested_function_execution_requires_observer');
  const original = () => 'original';
  const reference = createLibraryBoundary({ producer: callback => ({ run: callback }), observationMode: 'references',
    program: p({ op: 'object', entries: { run: arg(0) } }) });
  assert.equal(reference.invoke([original]).run, original);
  assert.equal(reference.checkpoint().status, 'observed_agreement');
});

test('synthetic diagnostics report the executed comparison and branch, not an expected rule', () => {
  const actual = (callback, value) => value !== value ? undefined : callback(value);
  const body = { op: 'if', test: { op: 'same', left: arg(1), right: arg(1) }, then: invoke, else: u };
  for (const enabled of [false, true]) {
    const boundary = createLibraryBoundary({ producer: actual, program: p(body), callbackArguments: [0], diagnosticInputs: enabled });
    boundary.invoke([value => value, NaN]);
    const report = boundary.checkpoint();
    assert.equal(report.status, 'frontier');
    const decisions = report.failures[0].detail.predicted_decisions;
    if (!enabled) { assert.equal(decisions, undefined); continue; }
    assert.deepEqual(decisions, [
      { path: '/body/test', op: 'same', operands: [{ type: 'number', value: 'NaN' }, { type: 'number', value: 'NaN' }], result: true },
      { path: '/body', op: 'if', operands: [{ type: 'boolean', value: true }], result: true },
    ]);
  }
});

test('opaque result projections check cyclic aliases without reading excluded metadata', () => {
  let reads = 0;
  const producer = value => {
    const root = { tag: 'root', value };
    root.link = { owner: root };
    Object.defineProperty(root, 'private', { get() { reads++; throw new Error('excluded metadata'); } });
    return root;
  };
  const program = p({ op: 'bind', name: 'root', value: { op: 'object', entries: { tag: { op: 'literal', value: 'root' }, value: arg(0) } }, body: {
    op: 'sequence', steps: [{ op: 'put', value: { op: 'local', name: 'root' }, key: { op: 'literal', value: 'link' },
      item: { op: 'object', entries: { owner: { op: 'local', name: 'root' } } } }, { op: 'local', name: 'root' }],
  } });
  const options = { producer, program, resultPaths: [['tag'], ['value']], resultIdentityPaths: [[], ['link'], ['link','owner']] };
  const boundary = createLibraryBoundary(options), value = { payload: 1 };
  const first = boundary.invoke([value]), second = boundary.invoke([value]);
  assert.notEqual(first, second); assert.equal(first.link.owner, first);
  const report = boundary.checkpoint(); assert.equal(report.status, 'observed_agreement'); assert.equal(reads, 0);
  const identities = report.evidence.filter(row => row.kind === 'result_identity');
  assert.equal(identities.length, 6);
  assert.equal(identities[0].value, identities[2].value); assert.notEqual(identities[0].value, identities[3].value);
  const wrong = structuredClone(program);
  wrong.body.body.steps[0].item.entries.owner = { op: 'object', entries: {} };
  const rejected = createLibraryBoundary({ ...options, program: wrong }); rejected.invoke([value]);
  assert.equal(rejected.checkpoint().failures[0].reason, 'result_reference_relationship_mismatch');
  const wrongData = structuredClone(program); wrongData.body.value.entries.value = { op: 'object', entries: { payload: { op: 'literal', value: 1 } } };
  const copied = createLibraryBoundary({ ...options, program: wrongData }); copied.invoke([value]);
  assert.equal(copied.checkpoint().status, 'frontier');
});

test('opaque identity projections cannot substitute an input, alias distinct results, or inspect proxies', () => {
  const scope = { resultPaths: [], resultIdentityPaths: [[], ['other']] };
  const badAlias = createLibraryBoundary({ ...scope, producer: () => ({ other: {} }), program: p({ op: 'bind', name: 'root', value: { op: 'object', entries: {} }, body: {
    op: 'sequence', steps: [{ op: 'put', value: { op: 'local', name: 'root' }, key: { op: 'literal', value: 'other' }, item: { op: 'local', name: 'root' } }, { op: 'local', name: 'root' }],
  } }) });
  badAlias.invoke([]); assert.equal(badAlias.checkpoint().status, 'frontier');
  const substituted = createLibraryBoundary({ producer: value => value, program: p({ op: 'object', entries: {} }), resultPaths: [], resultIdentityPaths: [[]] });
  substituted.invoke([{}]); assert.equal(substituted.checkpoint().status, 'frontier');
  let traps = 0;
  const proxy = new Proxy({}, { getOwnPropertyDescriptor() { traps++; return undefined; }, ownKeys() { traps++; return []; } });
  const opaque = createLibraryBoundary({ producer: () => proxy, program: p({ op: 'object', entries: {} }), resultPaths: [], resultIdentityPaths: [[]] });
  assert.equal(opaque.invoke([]), proxy); assert.equal(traps, 0);
  assert.equal(opaque.checkpoint().failures[0].reason, 'proxy_result_identity_outside_domain');
});

test('later callback capabilities and their real synchronous descendants are observed once', () => {
  const program = {schema:'producttrace.library-program.v1',body:{op:'bind',name:'target',value:{op:'arg',index:0},body:{op:'fn',this_mode:'strict',body:{op:'call',target:{op:'local',name:'target'},receiver:{op:'undefined'},args:{op:'args'}}}}};
  let outerCalls=0, innerCalls=0;
  const producer=outer=>function(...args){return outer(...args)};
  const boundary=createLibraryBoundary({producer,program,callbackArguments:[0],returnedCallbackArguments:[1]});
  const wrapped=boundary.invoke([function(value,done){outerCalls++;return done(value)}]);
  const done=value=>{innerCalls++;return value};
  const value={exact:true};
  assert.equal(wrapped(value,done),value);
  assert.equal(wrapped(value,done),value);
  assert.equal(outerCalls,2);assert.equal(innerCalls,2);
  const report=boundary.checkpoint();
  assert.equal(report.status,'observed_agreement',JSON.stringify(report));
  assert.deepEqual(report.evidence.map(row=>row.parent_ordinal),[null,0,null,0]);
  assert.equal(new Set(report.evidence.map(row=>row.occurrence)).size,2);
});

test('returned argument position is not a substitute for the exact callback capability', () => {
  const arg=index=>({op:'arg',index}), call=target=>({op:'call',target,receiver:{op:'undefined'},args:{op:'array',items:[]}});
  const program={schema:'producttrace.library-program.v1',body:{op:'fn',this_mode:'strict',body:call(arg(0))}};
  let kept;
  const boundary=createLibraryBoundary({producer:()=>cb=>{kept??=cb;return kept()},program,returnedCallbackArguments:[0]});
  const returned=boundary.invoke([]);
  let first=0,second=0;
  assert.equal(returned(()=>{first++;return 1}),1);
  assert.equal(returned(()=>{second++;return 1}),1);
  assert.equal(first,2);assert.equal(second,0);
  assert.equal(boundary.checkpoint().status,'frontier');
  assert(boundary.checkpoint().failures.some(row=>row.reason==='callback_order_or_count_mismatch'));
});

test('a callback descendant cannot hide another call made by the library itself', () => {
  const arg=index=>({op:'arg',index}),call=(target,args)=>({op:'call',target,receiver:{op:'undefined'},args:{op:'array',items:args}});
  const program={schema:'producttrace.library-program.v1',body:call(arg(0),[arg(1)])};
  let calls=0;
  const boundary=createLibraryBoundary({producer:(outer,inner)=>{outer(inner);return inner()},program,callbackArguments:[0,1]});
  boundary.invoke([done=>done(),()=>{calls++;return 1}]);
  assert.equal(calls,2);
  const report=boundary.checkpoint();assert.equal(report.status,'frontier');
  assert(report.failures.some(row=>row.reason==='unmodeled_callback_invocation'));
});

test('callbacks in an observed parent async continuation retain exact ancestry', async () => {
  const arg=index=>({op:'arg',index});
  const program={schema:'producttrace.library-program.v1',body:{op:'call',target:arg(0),receiver:{op:'undefined'},args:{op:'array',items:[arg(1)]}}};
  const boundary=createLibraryBoundary({producer:(outer,inner)=>outer(inner),program,callbackArguments:[0,1]});
  let calls=0;boundary.invoke([done=>{queueMicrotask(done)},()=>{calls++}]);
  await new Promise(resolve=>queueMicrotask(resolve));assert.equal(calls,1);
  const report=boundary.checkpoint();assert.equal(report.status,'observed_agreement',JSON.stringify(report));
  assert.equal(report.evidence[1].parent_ordinal,0);assert.equal(report.evidence[1].parent_relation,'async_continuation');
  assert.equal(report.evidence[1].timing,'deferred');
});

test('a returned callback argument remains ungranted unless the checker declares its position', () => {
  const program={schema:'producttrace.library-program.v1',body:{op:'fn',this_mode:'strict',body:{op:'call',target:{op:'arg',index:0},receiver:{op:'undefined'},args:{op:'array',items:[]}}}};
  const boundary=createLibraryBoundary({producer:()=>cb=>cb(),program});
  let calls=0;assert.equal(boundary.invoke([])(()=>{calls++;return 1}),1);assert.equal(calls,1);
  assert.equal(boundary.checkpoint().status,'frontier');
  assert.throws(()=>createLibraryBoundary({producer:()=>{},program,returnedCallbackArguments:[0,0]}),/returned_callback_arguments/);
});

test('an unmodeled library-scheduled callback cannot borrow application callback ancestry', async()=>{
  const arg=index=>({op:'arg',index});
  const program={schema:'producttrace.library-program.v1',body:{op:'call',target:arg(0),receiver:{op:'undefined'},args:{op:'array',items:[arg(1)]}}};
  const boundary=createLibraryBoundary({producer:(outer,inner)=>{outer(inner);queueMicrotask(inner)},program,callbackArguments:[0,1]});
  let calls=0;boundary.invoke([done=>{queueMicrotask(done)},()=>{calls++}]);
  await new Promise(resolve=>queueMicrotask(resolve));assert.equal(calls,2);
  const report=boundary.checkpoint();assert.equal(report.status,'frontier');
  assert(report.failures.some(row=>row.reason==='unmodeled_callback_invocation'));
  assert.deepEqual(report.evidence.map(row=>row.parent_ordinal),[null,0,null]);
});

test('a rule cannot replay an application descendant again as its own scheduled call',async()=>{
  const arg=index=>({op:'arg',index}),call=(target,args)=>({op:'call',target,receiver:{op:'undefined'},args:{op:'array',items:args}});
  const program={schema:'producttrace.library-program.v1',body:{op:'sequence',steps:[call(arg(0),[arg(1)]),{op:'defer',body:call(arg(1),[])}]}};
  const boundary=createLibraryBoundary({producer:(outer,inner)=>outer(inner),program,callbackArguments:[0,1]});
  let calls=0;boundary.invoke([done=>{queueMicrotask(done)},()=>{calls++}]);
  await new Promise(resolve=>queueMicrotask(resolve));assert.equal(calls,1);
  const report=boundary.checkpoint();assert.equal(report.status,'frontier');
  assert(report.failures.some(row=>row.reason==='callback_order_or_count_mismatch'));
});

test('an external trigger without occurrence context preserves the callback and abstains',()=>{
  let registered,calls=0;
  const program={schema:'producttrace.library-program.v1',body:{op:'undefined'}};
  const boundary=createLibraryBoundary({producer:cb=>{registered=cb},program,callbackArguments:[0]});
  boundary.invoke([()=>{calls++;return 7}]);
  assert.equal(registered(),7);assert.equal(calls,1);
  assert(boundary.checkpoint().failures.some(row=>row.reason==='callback_trigger_occurrence_unavailable'));
});

test('rule reads retain exact input paths without inspecting accessor values',()=>{
  const program={schema:'producttrace.library-program.v1',body:{op:'get',value:{op:'get',value:{op:'arg',index:0},key:'selected'},key:'value'}};
  let getterCalls=0;const value={marker:true},selected={value},input={selected,alias:selected};
  Object.defineProperty(input,'irrelevant',{get(){getterCalls++;throw Error('not evidence')}});
  const boundary=createLibraryBoundary({producer:arg=>arg.selected.value,program,dataReadEvidence:true,accessorObservation:'opaque_descriptors'});
  assert.equal(boundary.invoke([input]),value);const report=boundary.checkpoint();
  assert.equal(report.status,'observed_agreement',JSON.stringify(report));assert.equal(getterCalls,0);
  const reads=report.evidence.filter(row=>row.kind==='rule_data_read');assert.equal(reads.length,2);
  assert.deepEqual(reads[1].input_paths,[[0,'selected','value'],[0,'alias','value']]);
  assert.equal(reads[1].program_path,'/body');assert.equal(reads[1].matches_predicted_result,true);
  assert.equal(reads[0].matches_predicted_result,false);assert(!JSON.stringify(reads).includes('marker'));
});

test('wrong rule reads remain frontier evidence and do not acquire a result origin by equal type',()=>{
  const program={schema:'producttrace.library-program.v1',body:{op:'get',value:{op:'arg',index:0},key:'other'}};
  const boundary=createLibraryBoundary({producer:arg=>arg.selected,program,dataReadEvidence:true});
  assert.equal(boundary.invoke([{selected:1,other:2}]),1);
  const report=boundary.checkpoint();assert.equal(report.status,'frontier');
  assert(report.evidence.every(row=>row.status==='frontier'));
  assert.deepEqual(report.evidence[0].input_paths,[[0,'other']]);
});

test('data-read evidence is opt-in and cannot execute a proxy to recover an origin',()=>{
  const program={schema:'producttrace.library-program.v1',body:{op:'get',value:{op:'arg',index:0},key:'value'}};
  const ordinary=createLibraryBoundary({producer:arg=>arg.value,program});ordinary.invoke([{value:1}]);assert.equal(ordinary.checkpoint().evidence.length,0);
  let calls=0;const proxy=new Proxy({value:3},{get(target,key){calls++;return target[key]}});
  const boundary=createLibraryBoundary({producer:arg=>arg.value,program,dataReadEvidence:true});assert.equal(boundary.invoke([proxy]),3);assert.equal(calls,1);
  assert.equal(boundary.checkpoint().status,'frontier');assert.equal(boundary.checkpoint().evidence.length,0);
});

test('a deferred rule data read requires an independent input snapshot at that time',async()=>{
  const program={schema:'producttrace.library-program.v1',body:{op:'defer',body:{op:'get',value:{op:'arg',index:0},key:'value'}}};
  const boundary=createLibraryBoundary({producer:()=>undefined,program,dataReadEvidence:true});boundary.invoke([{value:1}]);
  const report=boundary.checkpoint();assert.equal(report.status,'frontier');assert(report.failures.some(row=>row.reason==='deferred_read_requires_input_snapshot'));
});

test('replay cannot execute an ungranted application function returned by a library',()=>{
  for(const stable of [true,false]){
    let calls=0;const original=()=>{calls++;return stable?'unchanged':calls};
    const boundary=createLibraryBoundary({producer:fn=>fn,program:{schema:'producttrace.library-program.v1',body:{op:'arg',index:0}}});
    const returned=boundary.invoke([original]);assert.equal(returned,original);assert.equal(returned(),stable?'unchanged':1);assert.equal(calls,1);
    const report=boundary.checkpoint();assert.equal(report.status,'observed_agreement');assert.equal(report.calls,1);
    assert.equal(report.evidence.filter(row=>row.kind==='callback_invocation').length,0);assert.equal(report.evidence[0].kind,'returned_input_function_reference');
  }
});

test('returned own methods are observed without replacing frozen objects or method identities',()=>{
  let helper,calls=0,seenReceiver;
  const callback=value=>{calls++;return value};
  const producer=cb=>helper=Object.freeze({run:function(value){seenReceiver=this;return cb.call(this,value)}});
  const program=p({op:'bind',name:'callback',value:arg(0),body:{op:'freeze',value:{op:'object',entries:{run:{op:'fn',this_mode:'strict',body:{op:'call',target:{op:'local',name:'callback'},receiver:{op:'receiver'},args:{op:'args'}}}}}}});
  const boundary=createLibraryBoundary({producer,program,callbackArguments:[0],resultMethods:[{path:['run'],callbackArguments:[]}]});
  const returned=boundary.invoke([callback]);assert.equal(returned,helper);const method=returned.run;
  const invoke=boundary.prepareMember(returned,'run',method,{file:'consumer.ts',start:12});
  assert.equal(invoke(9),9);assert.equal(calls,1);assert.equal(seenReceiver,helper);assert.equal(returned.run,method);
  const report=boundary.checkpoint();assert.equal(report.status,'observed_agreement',JSON.stringify(report));
  const row=report.evidence.find(row=>row.kind==='returned_method_invocation');assert.equal(row.registered_occurrence,'library-call:1');assert.deepEqual(row.result_path,['run']);assert.equal(row.invocation_source.file,'consumer.ts');
});

test('returned methods use independently granted later callbacks and reject wrong bodies',()=>{
  const factory=()=>({run:cb=>cb('actual')});
  for(const prediction of ['actual','wrong']){
    const program=p({op:'object',entries:{run:{op:'fn',this_mode:'strict',body:{op:'call',target:arg(0),receiver:u,args:{op:'array',items:[{op:'literal',value:prediction}]}}}}});
    const boundary=createLibraryBoundary({producer:factory,program,resultMethods:[{path:['run'],callbackArguments:[0]}]});
    const object=boundary.invoke([]);let calls=0;const result=boundary.prepareMember(object,'run',object.run)(value=>{calls++;return value});
    assert.equal(result,'actual');assert.equal(calls,1);assert.equal(boundary.checkpoint().status,prediction==='actual'?'observed_agreement':'frontier');
  }
});

test('changed returned methods preserve actual JavaScript behavior and become a frontier',()=>{
  const program=p({op:'object',entries:{run:{op:'fn',this_mode:'strict',body:{op:'literal',value:1}}}});
  const boundary=createLibraryBoundary({producer:()=>({run:()=>1}),program,resultMethods:[{path:['run'],callbackArguments:[]}]});
  const object=boundary.invoke([]);object.run=()=>2;assert.equal(boundary.prepareMember(object,'run',object.run)(),2);
  assert(boundary.checkpoint().failures.some(row=>row.reason==='returned_method_identity_changed'));
});

test('method scopes reject ambiguous paths, accessors and ungranted pass-through function replay',()=>{
  const program=p({op:'object',entries:{run:arg(0)}});
  assert.throws(()=>createLibraryBoundary({producer:()=>{},program,resultMethods:[{path:['run'],callbackArguments:[]},{path:['run'],callbackArguments:[]}]}),/result_method_scope/);
  let calls=0;const original=()=>++calls;
  const boundary=createLibraryBoundary({producer:fn=>({run:fn}),program,resultMethods:[{path:['run'],callbackArguments:[]}]});
  const object=boundary.invoke([original]);assert.equal(object.run,original);assert.equal(boundary.prepareMember(object,'run',object.run),null);assert.equal(calls,0);
  assert(boundary.checkpoint().failures.some(row=>row.reason==='returned_method_replay_capability_missing'));
});

test('a cached result object cannot silently select one of several producer owners',()=>{
  const original={run:()=>1},program=p({op:'object',entries:{run:{op:'fn',this_mode:'strict',body:{op:'literal',value:1}}}});
  const boundary=createLibraryBoundary({producer:()=>original,program,resultMethods:[{path:['run'],callbackArguments:[]}]});
  assert.equal(boundary.invoke([]),original);assert.equal(boundary.invoke([]),original);assert.equal(boundary.prepareMember(original,'run',original.run)(),1);
  assert(boundary.checkpoint().failures.some(row=>row.reason==='returned_method_owner_ambiguous'));
});

test('known callback aliases preserve actual identity and cannot produce false agreement', () => {
  const callback=()=>1,rule=p({op:'same',left:arg(0),right:arg(1)});
  for(const indices of [[0],[0,1]]) {
    const producer=(a,b)=>a===b,boundary=createLibraryBoundary({producer,program:rule,callbackArguments:indices,resultPaths:null});
    assert.equal(producer(callback,callback),true);assert.equal(boundary.invoke([callback,callback]),true);
    const report=boundary.checkpoint();assert.equal(report.status,'frontier');assert.equal(report.calls,1);
    assert.equal(report.failures[0].reason,'callback_alias_requires_identity_preserving_observer');
  }
  let calls=0,getters=0;const box={nested:{callback},get unrelated(){getters++;throw Error('unread')}};
  const producer=(fn,holder)=>{calls++;return fn===holder.nested.callback};
  const boundary=createLibraryBoundary({producer,program:rule,callbackArguments:[0],accessorObservation:'opaque_descriptors'});
  assert.equal(boundary.invoke([callback,box]),true);assert.equal(calls,1);assert.equal(getters,0);
  assert.equal(boundary.checkpoint().status,'frontier');
  const receiver=createLibraryBoundary({producer:function(fn){return fn===this.callback},program:p(arg(0)),callbackArguments:[0]});
  assert.equal(receiver.invoke([callback],{receiver:{callback}}),true);assert.equal(receiver.checkpoint().status,'frontier');
});

test('callback aliases on late invocation preserve the real return and throw', () => {
  const error=new Error('alias throw'),cb=()=>1;
  const producer=()=>function(a,b){if(a===b)throw error;return false};
  const rule=p({op:'fn',this_mode:'strict',body:{op:'literal',value:false}});
  const boundary=createLibraryBoundary({producer,program:rule,returnedCallbackArguments:[0]});
  const returned=boundary.invoke([]);assert.throws(()=>returned(cb,cb),caught=>caught===error);
  assert.equal(boundary.checkpoint().status,'frontier');
});

test('function-valued data keeps original identity through immediate and retained returns',()=>{
  let calls=0;const value=()=>{calls++;return 7};
  const direct=createLibraryBoundary({producer:value=>value,program:p(arg(0)),callbackArguments:[]});
  assert.equal(direct.invoke([value]),value);assert.equal(calls,0);
  const retainedProgram=p({op:'bind',name:'value',value:arg(0),body:{op:'fn',this_mode:'strict',body:{op:'local',name:'value'}}});
  const retained=createLibraryBoundary({producer:value=>()=>value,program:retainedProgram,callbackArguments:[]});
  const first=retained.invoke([value]),second=retained.invoke([value]);
  assert.notEqual(first,second);assert.equal(first(),value);assert.equal(first(123),value);assert.equal(second(),value);assert.equal(calls,0);
  const report=retained.checkpoint();assert.equal(report.status,'observed_agreement');
  const references=report.evidence.filter(row=>row.kind==='returned_input_function_reference');assert.equal(references.length,3);
  assert.deepEqual(references[0].input_origins,[{occurrence:'library-call:1',path:[0]}]);
  assert.deepEqual(references[2].input_origins,[{occurrence:'library-call:2',path:[0]}]);
  value();assert.equal(calls,1);assert.equal(retained.checkpoint().evidence.filter(row=>row.kind==='callback_invocation').length,0);
});
