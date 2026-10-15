import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeLibraryProgram} from '../authoring/library-program-normalize.mjs';
import {createLibraryProgram} from '../analysis/library-program.mjs';
const schema='producttrace.library-program.v1',local=name=>({op:'local',name}),arg=index=>({op:'arg',index});
const bound=(operation,value)=>({schema,body:{op:'bind',name:'value',value,body:{op:'sequence',steps:[{op:operation,value:local('value')},local('value')]}}});

test('local heap aliases normalize without changing property descriptors, freshness or input identity',()=>{
  for(const operation of ['seal','freeze']){
    const source=bound(operation,{op:'object',entries:{current:arg(0)}}),original=structuredClone(source),normal=normalizeLibraryProgram(source);
    assert.equal(normal.status,'normalized');assert.deepEqual(source,original);assert.equal(normal.rewrites.length,1);
    assert.deepEqual(normal.program.body,{op:operation,value:source.body.value});
    assert.equal(normalizeLibraryProgram(normal.program).rewrites.length,0);
    for(const input of [undefined,null,NaN,-0,{},()=>7]){
      const a=createLibraryProgram(source).invoke([input]),b=createLibraryProgram(normal.program).invoke([input]);
      assert.notEqual(a,b);assert(Object.is(a.current,input));assert(Object.is(b.current,input));
      assert.deepEqual(Object.getOwnPropertyDescriptors(a),Object.getOwnPropertyDescriptors(b));
      assert.equal(Object.isFrozen(a),Object.isFrozen(b));assert.equal(Object.isSealed(a),Object.isSealed(b));
    }
  }
});

test('return aliases evaluate callbacks once, preserve throws and retain outer lexical captures',()=>{
  const source={schema,body:{op:'bind',name:'x',value:{op:'call',target:arg(0),receiver:{op:'undefined'},args:{op:'array',items:[]}},body:local('x')}};
  const normalized=normalizeLibraryProgram(source).program;let count=0;const marker={};
  for(const program of [source,normalized])assert.equal(createLibraryProgram(program,{callbacks:[callback]}).invoke([callback]),marker);
  function callback(){count++;return marker}assert.equal(count,2);
  const error=new Error('same');function throwing(){throw error}
  for(const program of [source,normalized])assert.throws(()=>createLibraryProgram(program,{callbacks:[throwing]}).invoke([throwing]),caught=>caught===error);
  const closure={schema,body:{op:'bind',name:'x',value:arg(0),body:{op:'bind',name:'x',value:{op:'fn',this_mode:'strict',body:local('x')},body:local('x')}}};
  for(const program of [closure,normalizeLibraryProgram(closure).program])assert.equal(createLibraryProgram(program).invoke([marker])(),marker);
});

test('normalization does not remove effects, substitute another binding or equate different branches',()=>{
  const base=bound('seal',{op:'object',entries:{}}),variants=[];
  const extra=structuredClone(base);extra.body.body.steps.splice(1,0,{op:'frontier',reason:'required_evidence'});variants.push(extra);
  const result=structuredClone(base);result.body.body.steps[1]={op:'undefined'};variants.push(result);
  const input=structuredClone(base);input.body.body.steps[0].value={op:'object',entries:{}};variants.push(input);
  variants.push({schema,body:{op:'sequence',steps:[{op:'undefined'},{op:'literal',value:1}]}});
  for(const variant of variants){const normalized=normalizeLibraryProgram(variant);assert.equal(normalized.rewrites.length,0);assert.deepEqual(normalized.program,variant)}
  assert.equal(normalizeLibraryProgram({schema,body:{op:'unknown'}}).reason,'normalization_format');
});
