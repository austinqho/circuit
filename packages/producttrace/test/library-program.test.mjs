import test from 'node:test';
import assert from 'node:assert/strict';
import { createLibraryProgram, validateLibraryProgram, LIBRARY_PROGRAM_SCHEMA } from '../analysis/library-program.mjs';

const p = body => ({ schema: LIBRARY_PROGRAM_SCHEMA, body });
const arg = index => ({ op: 'arg', index });
const local = name => ({ op: 'local', name });
const literal = value => ({ op: 'literal', value });
const array = (...items) => ({ op: 'array', items });
const undef = { op: 'undefined' };
const call = (target, args, receiver = undef) => ({ op: 'call', target, receiver, args });

test('one vocabulary describes both conditional value updates and callback wrappers', () => {
  const update = p({ op: 'if', test: { op: 'same', left: { op: 'type', value: arg(0) }, right: literal('function') },
    then: call(arg(0), array(arg(1))), else: arg(0) });
  const double = n => n * 2;
  const engine = createLibraryProgram(update, { callbacks: [double] });
  assert.equal(engine.invoke([double, 4]), 8);
  const value = { result: 5 };
  assert.equal(engine.invoke([value, 4]), value);

  const wrapper = p({ op: 'bind', name: 'callback', value: arg(0), body: { op: 'fn', this_mode: 'strict',
    body: call(local('callback'), { op: 'args' }, { op: 'receiver' }) } });
  const seen = [];
  function observe(...args) { seen.push([this, args]); return args[0]; }
  const second = value => value + 100;
  const wrappers = createLibraryProgram(wrapper, { callbacks: [observe, second] });
  const firstFn = wrappers.invoke([observe]), secondFn = wrappers.invoke([second]);
  const owner = {};
  assert.equal(firstFn.call(owner, 4, null), 4);
  assert.equal(secondFn(4), 104);
  assert.deepEqual(seen, [[owner, [4, null]]]);
});

test('captured cells retain state per produced function without contaminating another', () => {
  const once = p({ op: 'bind', name: 'callback', value: arg(0), body:
    { op: 'bind', name: 'called', value: literal(false), body:
      { op: 'bind', name: 'result', value: undef, body: { op: 'fn', this_mode: 'strict', body:
        { op: 'if', test: local('called'), then: local('result'), else:
          { op: 'sequence', steps: [
            { op: 'set', name: 'called', value: literal(true) },
            { op: 'set', name: 'result', value: call(local('callback'), { op: 'args' }, { op: 'receiver' }) },
          ] } } } } } });
  const seen = [];
  const cb = n => { seen.push(n); return { n }; };
  const engine = createLibraryProgram(once, { callbacks: [cb] });
  const first = engine.invoke([cb]), second = engine.invoke([cb]);
  const result = first(3);
  assert.equal(first(4), result);
  assert.deepEqual(second(8), { n: 8 });
  assert.deepEqual(seen, [3, 8]);
});

test('format validation rejects invented operations, extra fields, scope errors and cycles', () => {
  for (const body of [{ op: 'fetch', url: 'https://example.com' }, { op: 'arg', index: -1 },
    { op: 'literal', value: 3, execute: true }, local('missing'),
    { op: 'get', value: arg(0), key: 'constructor' },
    { op: 'literal', value: { nested: true } }]) assert.equal(validateLibraryProgram(p(body)).valid, false);
  const cycle = { op: 'not' }; cycle.value = cycle;
  assert.equal(validateLibraryProgram(p(cycle)).valid, false);
});

test('ungranted callbacks, accessors, inherited properties and absent schedulers are frontiers', () => {
  let count = 0;
  assert.throws(() => createLibraryProgram(p(call(arg(0), array()))).invoke([() => count++]), /callback_capability_missing/);
  assert.equal(count, 0);
  const read = createLibraryProgram(p({ op: 'get', value: arg(0), key: 'value' }));
  assert.throws(() => read.invoke([{ get value() { count++; return 1; } }]), /accessor_requires_host_evidence/);
  assert.throws(() => read.invoke([Object.create({ value: 1 })]), /inherited_property_requires_host_evidence/);
  assert.equal(count, 0);
  assert.throws(() => createLibraryProgram(p({ op: 'defer', body: literal(3) })).invoke([]), /scheduler_capability_missing/);
});

test('the host controls scheduling and program budgets; instructions are privately snapshotted', () => {
  const queue = [], calls = [];
  const cb = value => calls.push(value);
  const program = p({ op: 'defer', body: call(arg(0), array(arg(1))) });
  const engine = createLibraryProgram(program, { callbacks: [cb], schedule: work => queue.push(work) });
  program.body = literal('tampered');
  assert.equal(engine.invoke([cb, 'payload']), undefined);
  assert.equal(calls.length, 0);
  queue.shift()();
  assert.deepEqual(calls, ['payload']);
  const small = createLibraryProgram(p({ op: 'sequence', steps: [literal(1), literal(2)] }), { maxSteps: 2 });
  assert.throws(() => small.invoke([]), /program_step_limit/);
});

test('sealing applies only to program allocations, and sloppy closures model receiver coercion', () => {
  const input = {};
  assert.throws(() => createLibraryProgram(p({ op: 'seal', value: arg(0) })).invoke([input]), /mutation_of_host_value_forbidden/);
  assert.equal(Object.isExtensible(input), true);
  const ref = createLibraryProgram(p({ op: 'seal', value: { op: 'object', entries: { current: literal(null) } } })).invoke([]);
  assert.equal(Object.isSealed(ref), true);
  const sloppy = createLibraryProgram(p({ op: 'fn', this_mode: 'sloppy', body: { op: 'receiver' } })).invoke([]);
  assert.equal(sloppy(), globalThis);
  assert.equal(sloppy.call(7).valueOf(), 7);
});

test('bounded array comparisons retain identity, distinguish equality modes and reject getters', () => {
  const compare = p({ op: 'bind', name: 'other', value: arg(1), body: { op: 'every', items: arg(0), value_name: 'value', index_name: 'index',
    test: { op: 'same', left: local('value'), right: { op: 'at', value: local('other'), index: local('index') } } } });
  const engine = createLibraryProgram(compare), object = {};
  assert.equal(engine.invoke([[NaN, object], [NaN, object]]), true);
  assert.equal(engine.invoke([[object], [{}]]), false);
  assert.equal(engine.invoke([[0], [-0]]), false);
  assert.equal(engine.invoke([[], []]), true);
  const sparse = Array(2); assert.equal(engine.invoke([sparse, [undefined, undefined]]), true);
  const strict = createLibraryProgram(p({ op: 'equal', left: arg(0), right: arg(1) }));
  assert.equal(strict.invoke([0, -0]), true); assert.equal(strict.invoke([NaN, NaN]), false);
  let called = 0; const getter = [];
  Object.defineProperty(getter, '0', { get() { called++; return 1; } });
  assert.throws(() => engine.invoke([getter, [1]]), /array_index_requires_host_evidence/);
  assert.equal(called, 0);
  assert.throws(() => createLibraryProgram(compare, { maxSteps: 5 }).invoke([[1, 2], [1, 2]]), /program_step_limit/);
  const invalid = structuredClone(compare); invalid.body.body.index_name = 'value';
  assert.equal(validateLibraryProgram(invalid).valid, false);
  assert.equal(validateLibraryProgram(p(local('value'))).valid, false);
});

test('retained functions receive fresh fuel per outer invocation while recursion shares its limit', () => {
  const retained = createLibraryProgram(p({ op: 'fn', this_mode: 'strict', body: arg(0) }), { maxSteps: 2 }).invoke([]);
  for (let i = 0; i < 1000; i++) assert.equal(retained(i), i);
  const recursive = p({ op: 'bind', name: 'recur', value: undef, body: { op: 'sequence', steps: [
    { op: 'set', name: 'recur', value: { op: 'fn', this_mode: 'strict', body: call(local('recur'), array()) } },
    call(local('recur'), array()),
  ] } });
  assert.throws(() => createLibraryProgram(recursive, { maxSteps: 50 }).invoke([]), /program_step_limit/);
});

test('error instructions accept only bounded explicit built-in errors and throw exact values', () => {
  const body = {op:'throw',value:{op:'make_error',name:'TypeError',message:{op:'literal',value:'invalid value'}}};
  const valid = {schema:LIBRARY_PROGRAM_SCHEMA,body};
  assert.equal(validateLibraryProgram(valid).valid,true);
  assert.throws(()=>createLibraryProgram(valid).invoke([]),error=>Object.getPrototypeOf(error)===TypeError.prototype && error.message==='invalid value');
  const invented=structuredClone(valid); invented.body.value.name='CustomError';
  assert.equal(validateLibraryProgram(invented).valid,false);
  const long=structuredClone(valid); long.body.value.message.value='x'.repeat(4097);
  assert.throws(()=>createLibraryProgram(long).invoke([]),/error_message_domain/);
});

test('computed own-data copies preserve key order, identity and exclusions without mutating inputs', () => {
  const copy = p({op:'bind',name:'copy',value:{op:'object',entries:{}},body:{op:'sequence',steps:[
    {op:'every',items:{op:'keys',value:arg(0)},value_name:'key',index_name:'index',test:{op:'sequence',steps:[
      {op:'put',value:local('copy'),key:local('key'),item:{op:'lookup',value:arg(0),key:local('key')}},literal(true)]}},
    {op:'freeze',value:local('copy')}]}});
  const marker={}, callback=()=>marker;
  const input=Object.assign(Object.create({ inherited: 1 }), {'9':marker, z:callback, '2':false});
  Object.defineProperty(input,'hidden',{value:'not enumerable'});
  input[Symbol('ignored')]='symbol';
  const result=createLibraryProgram(copy).invoke([input]);
  assert.deepEqual(Object.keys(result),['2','9','z']);
  assert.equal(result['9'],marker); assert.equal(result.z,callback);
  assert(Object.isFrozen(result)); assert(Object.isExtensible(input));
  assert.throws(()=>createLibraryProgram(copy).invoke([Object.defineProperty({},'getter',{enumerable:true,get(){throw new Error('must not run')}})]),/accessor_requires_host_evidence/);
  assert.throws(()=>createLibraryProgram(p({op:'lookup',value:arg(0),key:literal('inherited')})).invoke([input]),/inherited_property_requires_host_evidence/);
});

test('private object writes reject host mutation, reserved keys, frozen values and excessive keys', () => {
  const write=(value,key,item=literal(1))=>({op:'put',value,key,item});
  const host={};
  assert.throws(()=>createLibraryProgram(p(write(arg(0),literal('x')))).invoke([host]),/mutation_of_host_value_forbidden/);
  assert.deepEqual(host,{});
  for(const key of ['__proto__','constructor','prototype',-1,1.5])
    assert.throws(()=>createLibraryProgram(p(write({op:'object',entries:{}},literal(key)))).invoke([]),/property_key_outside_domain/);
  assert.throws(()=>createLibraryProgram(p(write({op:'freeze',value:{op:'object',entries:{x:literal(0)}}},literal('x')))).invoke([]),/write_to_immutable_prediction/);
  assert.throws(()=>createLibraryProgram(p({op:'keys',value:arg(0)})).invoke([Object.fromEntries(Array.from({length:4097},(_,i)=>['k'+i,i]))]),/object_size_limit/);
  const cycle=createLibraryProgram(p({op:'bind',name:'value',value:{op:'object',entries:{}},body:{op:'sequence',steps:[write(local('value'),literal('self'),local('value')),local('value')]}})).invoke([]);
  assert.equal(cycle.self,cycle);
});

test('primitive coercion never executes object hooks and scoped frontiers cannot count as a result', () => {
  const stringify=createLibraryProgram(p({op:'string',value:arg(0)}));
  for(const value of [null,undefined,true,12,-0,NaN,Infinity,2n,'text']) assert.equal(stringify.invoke([value]),String(value));
  let calls=0;
  for(const value of [Symbol('x'),{toString(){calls++;return 'x'}},()=>{}])
    assert.throws(()=>stringify.invoke([value]),/string_coercion_requires_host_evidence/);
  assert.equal(calls,0);
  assert.throws(()=>createLibraryProgram(p({op:'frontier',reason:'unsupported_input_shape'})).invoke([]),/unsupported_input_shape/);
  assert.equal(validateLibraryProgram(p({op:'frontier',reason:'arbitrary prose and code()'})).valid,false);
});

test('array copies never call replaced methods, accessors, species or coercion hooks', () => {
  let calls=0;const values=[1,,3];
  values.slice=()=>{calls++;return []};
  Object.defineProperty(values,'constructor',{get(){calls++;throw new Error('species must not run')}});
  const slice=createLibraryProgram(p({op:'slice',value:arg(0),start:0}));
  assert.deepEqual(slice.invoke([values]),[1,,3]);
  const concat=createLibraryProgram(p({op:'concat',items:[arg(0)]}));
  assert.deepEqual(concat.invoke([values]),[1,3]);assert.equal(calls,0);
  const inherited=Object.create(Array.prototype);Object.defineProperty(inherited,'1',{get(){calls++;return 2}});
  Object.setPrototypeOf(values,inherited);
  assert.throws(()=>slice.invoke([values]),/array_index_requires_host_evidence/);
  assert.throws(()=>concat.invoke([values]),/array_index_requires_host_evidence/);assert.equal(calls,0);
  const badLength={valueOf(){calls++;return 0}};
  assert.throws(()=>createLibraryProgram(p({op:'put',value:array(literal(1)),key:literal('length'),item:arg(0)})).invoke([badLength]),/array_length_outside_domain/);
  assert.equal(calls,0);
});

test('optional decision observation preserves comparison evaluation order and reports immutable program locations', () => {
  const decisions = [];
  const program = { schema: LIBRARY_PROGRAM_SCHEMA, body: { op: 'if', test: {
    op: 'equal', left: { op: 'arg', index: 0 }, right: { op: 'arg', index: 0 },
  }, then: { op: 'literal', value: 1 }, else: { op: 'literal', value: 2 } } };
  const engine = createLibraryProgram(program, { onDecision: row => decisions.push(row) });
  program.body.test.op = 'same';
  assert.equal(engine.invoke([NaN]), 2);
  assert.deepEqual(decisions.map(row => [row.path, row.op, row.result]), [['/body/test', 'equal', false], ['/body', 'if', false]]);
  assert.throws(() => createLibraryProgram(program, { onDecision: true }), /decision_observer/);
});

test('own-property presence distinguishes holes, undefined and non-enumerable slots without evaluating getters', () => {
  const program = { schema: LIBRARY_PROGRAM_SCHEMA, body: { op: 'has_own', value: { op: 'arg', index: 0 }, key: { op: 'arg', index: 1 } } };
  const engine = createLibraryProgram(program);
  const value = new Array(4); value[1] = undefined;
  Object.defineProperty(value, 2, { value: 'hidden', enumerable: false });
  let reads = 0; Object.defineProperty(value, 3, { get() { reads++; return 'getter'; } });
  assert.deepEqual([0,1,2,3,4].map(index => engine.invoke([value,index])), [false,true,true,true,false]);
  assert.equal(reads, 0);
  const inherited = Object.create({ inherited: undefined });
  assert.equal(engine.invoke([inherited,'inherited']), false);
  assert.throws(() => engine.invoke([value,'__proto__']), /property_key_outside_domain/);
  assert.throws(() => engine.invoke([null,'field']), /property_on_nullish/);
});

test('private lexical helpers can recursively accumulate arrays using the shared operations', () => {
  const arg = index => ({ op: 'arg', index }), local = name => ({ op: 'local', name });
  const call = (target,args) => ({ op: 'call', target, receiver: { op: 'undefined' }, args: { op: 'array', items: args } });
  const leaf = { id: 'same-object' };
  const program = { schema: LIBRARY_PROGRAM_SCHEMA, body: { op: 'bind', name: 'result', value: { op: 'array', items: [] }, body: {
    op: 'bind', name: 'helper', value: { op: 'undefined' }, body: { op: 'sequence', steps: [
      { op: 'set', name: 'helper', value: { op: 'fn', this_mode: 'strict', body: {
        op: 'if', test: { op: 'equal', left: { op: 'type', value: arg(0) }, right: { op: 'literal', value: 'number' } },
        then: call(local('helper'), [{ op: 'arg', index: 1 }]),
        else: { op: 'put', value: local('result'), key: { op: 'get', value: local('result'), key: 'length' }, item: arg(0) },
      } } }, call(local('helper'), [{ op: 'literal', value: 1 }, arg(0)]), local('result'),
    ] },
  } } };
  const result = createLibraryProgram(program).invoke([leaf]);
  assert.deepEqual(result, [leaf]); assert.equal(result[0], leaf);
});

test('numeric addition composes without coercing application values', () => {
  const rule=p({op:'number_add',left:arg(0),right:arg(1)});
  assert.equal(validateLibraryProgram(rule).valid,true);
  const engine=createLibraryProgram(rule);
  for(const left of [0,-0,1,-2,0.1,Number.MAX_SAFE_INTEGER,Number.MAX_VALUE,Number.MIN_VALUE,Infinity,-Infinity,NaN])
    for(const right of [0,-0,1,-2,0.2,Number.MAX_VALUE,Number.MIN_VALUE,Infinity,-Infinity,NaN])
      assert(Object.is(engine.invoke([left,right]),left+right));
  let coerced=0;
  const object={valueOf(){coerced++;return 1},[Symbol.toPrimitive](){coerced++;return 1}};
  const proxy=new Proxy(object,{get(){coerced++;throw Error('unexpected property read')}});
  for(const value of [null,undefined,true,'1',1n,Symbol('one'),object,proxy,()=>1]) {
    assert.throws(()=>engine.invoke([value,1]),/number_add_requires_numbers/);
    assert.throws(()=>engine.invoke([1,value]),/number_add_requires_numbers/);
  }
  assert.equal(coerced,0);
  assert.equal(validateLibraryProgram(p({op:'number_add',left:arg(0)})).valid,false);
  assert.equal(validateLibraryProgram(p({...rule.body,coerce:true})).valid,false);
});

test('numeric counter rules must match independently observed callback indices', async () => {
  const {createLibraryBoundary}=await import('../analysis/library-boundary.mjs');
  const producer=(items,callback)=>{let count=0;for(const item of items)callback(item,count++);return count};
  const make=step=>p({op:'bind',name:'count',value:literal(0),body:{op:'sequence',steps:[
    {op:'every',items:arg(0),value_name:'item',index_name:'index',test:{op:'sequence',steps:[
      call(arg(1),array(local('item'),local('count'))),
      {op:'set',name:'count',value:{op:'number_add',left:local('count'),right:literal(step)}},literal(true),
    ]}},local('count'),
  ]}});
  for(const step of [1,0,2,-1]) {
    const boundary=createLibraryBoundary({producer,program:make(step),callbackArguments:[1],resultPaths:null});
    const seen=[];assert.equal(boundary.invoke([['a','b','c'],(value,index)=>seen.push([value,index])]),3);
    assert.deepEqual(seen,[['a',0],['b',1],['c',2]]);
    assert.equal(boundary.checkpoint().status,step===1?'observed_agreement':'frontier');
  }
});

test('format diagnostics identify unbound variables in nested instructions without admitting them', () => {
  const rule=p({op:'bind',name:'owner',value:literal(1),body:{op:'object',entries:{'a/b~c':{op:'array',items:[local('absent')]}}}});
  const result=validateLibraryProgram(rule);
  assert.equal(result.valid,false);assert.deepEqual(result.errors,['unbound_local']);
  assert.deepEqual(result.diagnostics,[{reason:'unbound_local',path:'/body/body/entries/a~1b~0c/items/0',name:'absent',in_scope:['owner']}]);
  const recursive=p({op:'bind',name:'walk',value:{op:'fn',this_mode:'strict',body:local('walk')},body:undef});
  assert.equal(validateLibraryProgram(recursive).valid,false,'A binding does not exist during its initializer');
  const many=validateLibraryProgram(p({op:'array',items:Array.from({length:64},()=>local('missing'))}));
  assert.equal(many.valid,false);assert.equal(many.diagnostics.length,16);
});

test('array brand checks distinguish arrays from objects without reading their properties', async () => {
  const vm=await import('node:vm');const program=p({op:'is_array',value:arg(0)}),engine=createLibraryProgram(program);
  assert.equal(validateLibraryProgram(program).valid,true);
  let reads=0;
  const fake={get length(){reads++;throw Error('length')},[Symbol.toStringTag]:'Array'};
  const proxied=new Proxy([],{get(){reads++;throw Error('get')},getPrototypeOf(){reads++;throw Error('prototype')}});
  for(const value of [[],new Array(2),vm.runInNewContext('[1,2]'),proxied])assert.equal(engine.invoke([value]),true);
  for(const value of [null,undefined,false,0,'',{},fake,()=>[],new Set(),new Uint8Array(2)])assert.equal(engine.invoke([value]),false);
  const revoked=Proxy.revocable([],{});revoked.revoke();assert.throws(()=>engine.invoke([revoked.proxy]),/array_brand_unavailable/);
  assert.equal(reads,0);
  assert.equal(validateLibraryProgram(p({op:'is_array',value:arg(0),length:1})).valid,false);
});

test('actual array predicates reject shape-based rules while retaining opaque getters', async () => {
  const {createLibraryBoundary}=await import('../analysis/library-boundary.mjs');
  const correct=p({op:'is_array',value:arg(0)}),wrong=p({op:'same',left:{op:'type',value:arg(0)},right:literal('object')});
  let reads=0;const fake={get length(){reads++;throw Error('not an array')}};
  for(const program of [correct,wrong]) {
    const boundary=createLibraryBoundary({producer:Array.isArray,program,accessorObservation:'opaque_descriptors'});
    for(const value of [[],[1],new Array(3),{},fake,null,undefined,0,'text'])assert.equal(boundary.invoke([value]),Array.isArray(value));
    assert.equal(boundary.checkpoint().status,program===correct?'observed_agreement':'frontier');
  }
  assert.equal(reads,0);
});
