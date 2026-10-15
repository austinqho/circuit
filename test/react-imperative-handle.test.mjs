import test from 'node:test';import assert from 'node:assert/strict';
import {getReactBehavior} from '../analysis/react-behavior.mjs';
import {validateReactExecutionRule,planImperativeHandle} from '../analysis/react-execution-rule.mjs';
const rule=getReactBehavior({surface:'react',exportName:'useImperativeHandle',version:'18.3.1'}).execution;
test('imperative handle plans describe factory and ref effects without executing user code',()=>{
  let called=0;const callback=()=>{called++;},ref={set current(value){called++;}};
  const plan=planImperativeHandle(rule,{args:[ref,callback,[]]});assert.equal(plan.status,'planned');
  assert.deepEqual(plan.operations,[{operation:'invoke_factory',callback,arguments:[]},
    {operation:'write_ref',target:ref,property:'current',value:{kind:'factory_result'}}]);
  assert.deepEqual(planImperativeHandle(rule,{args:[null,callback,[]]}).operations,[]);
  assert.deepEqual(planImperativeHandle(rule,{event:'unmount',previous:{ref:callback,dependencies:[],attached:true}}).operations,
    [{operation:'callback_ref',target:callback,value:null}]);assert.equal(called,0);
});
test('imperative handle rule rejects malformed input, unknown instructions, and changed dependency arity',()=>{
  assert.equal(validateReactExecutionRule(rule).valid,true);
  assert.equal(validateReactExecutionRule({...rule,unexpected:true}).valid,false);
  assert.equal(validateReactExecutionRule({...rule,factory_argument:rule.ref_argument}).valid,false);
  for(const args of [null,{},[7,()=>{},[]],[{},null,[]],[{},()=>{},'not an array']])
    assert.equal(planImperativeHandle(rule,{args}).status,'unresolved');
  const ref={current:null},factory=()=>{};
  assert.equal(planImperativeHandle(rule,{args:[ref,factory,[1]],previous:{ref,attached:true,dependencies:[]}}).reason,'dependency_arity_changed');
  assert.equal(planImperativeHandle(rule,{args:[ref,factory,[]],previous:{ref:null,attached:true,dependencies:[]}}).status,'unresolved');
  assert.deepEqual(planImperativeHandle(rule,{environment:'server'}).operations,[]);
});
