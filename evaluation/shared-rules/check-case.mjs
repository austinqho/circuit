import {createLibraryExperimentChecks} from '../../authoring/library-program-experiments.mjs';
import {EXPERIMENTS} from './experiments.mjs';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {checkReactChildrenTraversal} from './children-traversal-check.mjs';
import assert from 'node:assert/strict';
import { createLibraryBoundary } from '../../analysis/library-boundary.mjs';
import { validateLibraryProgram } from '../../analysis/library-program.mjs';
import { DOMAINS } from './cases.mjs';

export async function checkCase(spec, implementation, program) {
  const format = validateLibraryProgram(program);
  if (!format.valid) return { status: 'rejected', stage: 'format', reason: format.errors[0] };
  if (!implementation.unchanged()) return { status: 'rejected', stage: 'source', reason: 'implementation_changed' };
  if(spec.experiment)return createLibraryExperimentChecks({repository:fileURLToPath(new URL('./fixtures/',import.meta.url)),scope:DOMAINS[spec.profile],makeExperiments:EXPERIMENTS[spec.experiment]}).behavior({implementation,program});
  const boundary = createLibraryBoundary({ producer: implementation.producer, program, ...DOMAINS[spec.profile], diagnosticInputs: true });
  let actualCalls = 0;
  const callback = function (...values) { actualCalls++; return values[0]; };
  const values = [undefined, null, false, true, 0, -0, NaN, 7, '', 'payload', Object.freeze({ identity: 1 }), [null, 3], Symbol('private')];
  try {
    switch (spec.profile) {
      case 'constant_value': {
        const fn=()=>{actualCalls++;throw Error('input function is data')},receiver={id:'receiver'},inputs=[...values,0n,1n,fn,{nested:fn}];
        for(const value of inputs){
          const first=boundary.invoke([value]),second=boundary.invoke([value]),different=boundary.invoke(['different']);
          assert.notEqual(first,second);
          for(const args of [[],[null],[fn,'ignored'],[{id:'other'}]]){
            assert(Object.is(Reflect.apply(first,receiver,args),value));assert(Object.is(Reflect.apply(second,null,args),value));
            assert.equal(different(...args),'different');
          }
        }
        assert.equal(actualCalls,0);break;
      }
      case 'negated_callback': {
        const marker={id:'argument'},receiver={id:'receiver'},otherReceiver={id:'other'},inputs=[[],[marker],[marker,null],[marker,null,false],[marker,null,false,marker,7]];
        const results=[...values,0n,1n,()=>42];
        for(const value of results){
          let expectedArgs,expectedReceiver;
          const predicate=function(...args){actualCalls++;assert.deepEqual(args,expectedArgs);assert.equal(this,expectedReceiver);return value};
          const first=boundary.invoke([predicate]),second=boundary.invoke([predicate]);
          assert.notEqual(first,second);
          for(const target of [first,second])for(const args of inputs)for(const self of [receiver,otherReceiver,null,undefined]){
            expectedArgs=args;expectedReceiver=self??globalThis;assert.equal(Reflect.apply(target,self,args),!value);
          }
        }
        assert.equal(actualCalls,results.length*2*inputs.length*4);
        const error=new Error('predicate failed');const throwing=boundary.invoke([()=>{actualCalls++;throw error}]);
        assert.throws(()=>throwing(),caught=>caught===error);assert.throws(()=>throwing(),caught=>caught===error);
        for(const value of values.filter(value=>typeof value!=='function'))assert.throws(()=>boundary.invoke([value]),error=>error instanceof TypeError&&error.message==='Expected a function');
        break;
      }
      case 'react_children_count':
      case 'react_children_for_each': {
        const method=spec.profile==='react_children_count'?'count':'forEach';
        const React=createRequire(new URL('./fixtures/package.json',import.meta.url))(spec.specifier);
        assert.equal(React.Children[method],implementation.producer,'The input factory must use the same installed React namespace');
        const result=checkReactChildrenTraversal({React,producer:implementation.producer,program,method,scope:DOMAINS[spec.profile],diagnosticInputs:true});
        return result;
      }
      case 'column_helper': {
        const first=boundary.invoke([]),second=boundary.invoke([]);assert.notEqual(first,second);
        const fn=()=>{actualCalls++;throw Error('accessor must remain data')},other=()=>null,marker={id:'exact'};
        const columns=[undefined,null,{},Object.freeze({id:'name',header:marker}),{accessorFn:other,accessorKey:'old',nested:[marker]}];
        for(const helper of [first,second]) {
          const methods=Object.fromEntries(['accessor','display','group'].map(key=>[key,helper[key]]));
          for(const column of columns) {
            for(const accessor of [fn,'name','nested.name',0,undefined,null]) {
              const invoke=boundary.prepareMember(helper,'accessor',helper.accessor);
              assert.equal(typeof invoke,'function');const result=invoke(accessor,column);
              assert.deepEqual(result,{...column,...(typeof accessor==='function'?{accessorFn:accessor}:{accessorKey:accessor})});
              assert.notEqual(result,column);if(typeof accessor==='function')assert.equal(result.accessorFn,accessor);
            }
            for(const key of ['display','group'])assert.equal(boundary.prepareMember(helper,key,helper[key])(column),column);
          }
          for(const key of Object.keys(methods))assert.equal(helper[key],methods[key]);
        }
        assert.equal(actualCalls,0);break;
      }
      case 'boolean_or_callback': {
        for(const value of values)assert.equal(boundary.invoke([value,[]]),Boolean(value));
        const marker=Object.freeze({id:'exact'}),expectedReceiver=undefined;
        const inputs=[[],[undefined],[null,false],[marker,'second',marker]];
        for(const input of inputs){
          const output=boundary.invoke([function(...args){actualCalls++;assert.deepEqual(args,input);assert.equal(this,expectedReceiver);return args.at(-1)},input]);
          assert.equal(output,input.at(-1));
        }
        const error=new Error('query callback failure');
        assert.throws(()=>boundary.invoke([()=>{actualCalls++;throw error},[marker]]),caught=>caught===error);
        assert.equal(actualCalls,inputs.length+1);
        break;
      }
      case 'tree_traversal': {
        const leaf = Object.freeze({ label: 'leaf' }), right = Object.freeze({ label: 'right' });
        const parent = Object.freeze({ label: 'parent', children: [leaf, right] });
        const spare = []; spare.length = 3; spare[1] = parent;
        const holder = Object.freeze({ label: 'sparse-children', children: spare });
        const samples = [
          [[], []], [[leaf], [leaf]], [[parent, leaf], [parent, leaf, right, leaf]],
          [spare, [parent, leaf, right]], [[holder], [holder, parent, leaf, right]],
        ];
        for (const [forest, expected] of samples) {
          const seen = [], receivers = [];
          const result = boundary.invoke([forest, function (node) { actualCalls++; seen.push(node); receivers.push(this); return node?.children; }]);
          assert.deepEqual(result, expected); assert.notEqual(result, forest);
          assert.deepEqual(seen, expected); assert(receivers.every(value => value === undefined));
          for (let index = 0; index < result.length; index++) assert.equal(result[index], expected[index]);
        }
        boundary.invoke([[leaf], function () { actualCalls++; return null; }]);
        const error = new Error('independent child lookup failure');
        assert.throws(() => boundary.invoke([[leaf], function () { actualCalls++; throw error; }]), caught => caught === error);
        break;
      }
      case 'reference': {
        const a = boundary.invoke([]), b = boundary.invoke([]);
        assert.notEqual(a, b); assert.equal(a.current, null); assert.equal(b.current, null);
        break;
      }
      case 'element_predicate':
        for (const value of [...values, {}, { $$typeof: Symbol.for('react.element') },
          { $$typeof: Symbol.for('react.transitional.element') }, { $$typeof: Symbol('react.element') },
          { $$typeof: Symbol.for('react.memo') }, { $$typeof: undefined }]) boundary.invoke([value]);
        break;
      case 'render_descriptor': {
        function Render(_props, _ref) { actualCalls++; return null; }
        const first = boundary.invoke([Render]), second = boundary.invoke([function () { actualCalls++; }]);
        assert.notEqual(first, second); assert.equal(actualCalls, 0);
        break;
      }
      case 'memo_descriptor': {
        const component = function Component() { actualCalls++; };
        const compare = function compare() { actualCalls++; return true; };
        boundary.invoke([component]); boundary.invoke([component, compare]);
        assert.equal(actualCalls, 0);
        break;
      }
      case 'value_or_callback': {
        for (const value of values) { assert.equal(boundary.invoke([callback, value]), value); boundary.invoke([value, { other: true }]); }
        const error = new Error('independent callback throw');
        assert.throws(() => boundary.invoke([() => { actualCalls++; throw error; }, {}]), e => e === error);
        assert.equal(actualCalls, values.length + 1);
        break;
      }
      case 'partial_callback':
      case 'retained_callback': {
        const prefix = spec.profile === 'partial_callback' ? [Object.freeze({ prefix: 1 }), 'preset'] : [];
        const returned = boundary.invoke([callback, ...prefix], { callbackIds: { 0: 'first-source' } });
        const second = boundary.invoke([callback, ...prefix], { callbackIds: { 0: 'second-source' } });
        assert.equal(actualCalls, 0);
        const receiver = {};
        for (const value of values) { returned.call(receiver, value, false); second.call(undefined, value); }
        const error = new Error('retained throw');
        const throws = boundary.invoke([() => { actualCalls++; throw error; }, ...prefix]);
        assert.throws(() => throws('first'), e => e === error);
        // Repeating after a throw distinguishes cache-before-call from
        // cache-after-success. A returned exception is never rethrown by replay.
        try { throws('second'); } catch (caught) { assert.equal(caught, error); }
        if (spec.profile === 'partial_callback') {
          const marker = {late:'exact'}, thrown = new Error('late callback throw');
          let outer=0, inner=0;
          const late = boundary.invoke([function (...args) {
            outer++; actualCalls++; const done=args.at(-1); return done(args[0]);
          }, marker]);
          const done = value => {inner++; actualCalls++; return value};
          for (let position=0;position<4;position++) {
            const args=Array(position).fill('plain');args.push(done);
            assert.equal(late(...args),marker);
          }
          assert.equal(outer,4);assert.equal(inner,4);
          assert.throws(()=>late(()=>{inner++;actualCalls++;throw thrown}), caught=>caught===thrown);
          assert.equal(late(done),marker);assert.equal(outer,6);assert.equal(inner,6);
          const asynchronous=boundary.invoke([function(value,done){actualCalls++;queueMicrotask(()=>done(value))},marker]);
          const observed=[];
          asynchronous(value=>{actualCalls++;observed.push(['first',value])});
          asynchronous(value=>{actualCalls++;observed.push(['second',value])});
          assert.equal(observed.length,0);
          await new Promise(resolve=>queueMicrotask(resolve));
          assert.deepEqual(observed,[['first',marker],['second',marker]]);
        }
        break;
      }
      case 'scheduled_callback': {
        boundary.invoke([() => { actualCalls++; }], { callbackIds: { 0: 'first-source' } });
        boundary.invoke([() => { actualCalls++; }], { callbackIds: { 0: 'second-source' } });
        assert.equal(actualCalls, 0);
        break;
      }
      case 'memoized_callback': {
        const result = function () { actualCalls++; return Object.freeze({ result: actualCalls }); };
        const cached = boundary.invoke([result]), second = boundary.invoke([result]);
        const receiver = {}, otherReceiver = {}, value = {};
        for (const args of [[], [], [0], [-0], [NaN], [NaN], [value], [value], [{}], [1, 2], [1], [undefined], []]) {
          cached.apply(receiver, args); second.apply(otherReceiver, args);
        }
        cached.call(otherReceiver, 1); cached.call(receiver, 1);
        cached.call(0, 1); cached.call(-0, 1);
        for (const comparison of [() => true, () => false, () => 'truthy', () => 0]) {
          const custom = boundary.invoke([result, comparison]);
          custom.call(receiver, 1); custom.call(receiver, 2); custom.call(receiver, 2);
        }
        const error = new Error('independent memoized failure'); let throws = true;
        const retry = boundary.invoke([function () { if (throws) throw error; return result(); }]);
        assert.throws(() => retry(), caught => caught === error);
        throws = false; const afterFailure = retry(); assert.equal(retry(), afterFailure);
        let compareThrows = true;
        const compareFailure = boundary.invoke([result, function () { if (compareThrows) throw error; return true; }]);
        const before = compareFailure(1);
        assert.throws(() => compareFailure(2), caught => caught === error);
        compareThrows = false; assert.equal(compareFailure(3), before);
        break;
      }
      default: throw new Error('independent_profile_missing');
    }
    await new Promise(resolve => setTimeout(resolve, 5));
    const result = boundary.checkpoint();
    if (!implementation.unchanged()) return { status: 'rejected', stage: 'source', reason: 'new_or_modified_runtime_dependency' };
    return { status: result.status === 'observed_agreement' ? 'passed' : 'rejected', stage: 'behavior_and_boundary_replay',
      reason: result.failures[0]?.reason ?? null, scope: DOMAINS[spec.profile].description,
      calls: result.calls, actual_callbacks: actualCalls, evidence: result.evidence, failures: result.failures };
  } catch (error) { return { status: 'rejected', stage: 'independent_experiment', reason: error.message }; }
}
