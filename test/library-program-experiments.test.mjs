import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createLibraryExperimentVerifier} from '../authoring/library-program-experiments.mjs';
import {readLibraryImplementation} from '../authoring/library-implementation.mjs';
import {createLibraryProgramBank} from '../analysis/library-program-bank.mjs';
import {PROGRAMS,p,lit} from '../evaluation/shared-rules/programs.mjs';
import {DOMAINS} from '../evaluation/shared-rules/cases.mjs';
const repository=fileURLToPath(new URL('../evaluation/shared-rules/fixtures/',import.meta.url));
const fixture=(specifier,exportName)=>readLibraryImplementation({repository,specifier,exportName});
const values=(fn=()=>99)=>[undefined,null,false,true,0,-0,NaN,17,'',{id:'value'},[1,2],fn];
const retained=({dataFunction})=>values(dataFunction()).map((value,index)=>({id:'value-'+index,roots:[{args:[value]},{args:[value]}],
  calls:[{root:0,args:[]},{root:1,args:['ignored']},{root:0,args:[null,{id:'different'}]}]}));
const predicates=({dataFunction})=>values(dataFunction(99)).map((value,index)=>({id:'predicate-'+index,roots:[{args:[function(){return value}]}],
  calls:[{root:0,args:[]},{root:0,args:[1]},{root:0,args:[1,2,3,4],receiver:{id:'receiver'}}]}));

test('one independent experiment runner verifies different real-library behaviors through source integration',async()=>{
  for(const [specifier,exportName,program,scope,makeExperiments] of [
    ['lodash417/constant','default',PROGRAMS.constantValue,DOMAINS.constant_value,retained],
    ['lodash417/negate','default',PROGRAMS.negate,DOMAINS.negated_callback,predicates],
    ['table8new','functionalUpdate',PROGRAMS.functionalUpdate,DOMAINS.value_or_callback,({dataFunction})=>values(dataFunction()).map((value,index)=>({id:'update-'+index,roots:[{args:[value,{id:'input'}]},{args:[v=>v,value]}]}))],
  ]){
    const implementation=fixture(specifier,exportName),bank=createLibraryProgramBank({check:createLibraryExperimentVerifier({repository,scope,makeExperiments})});
    const result=await bank.admit({implementation,program,scope});assert.equal(result.status,'admitted',JSON.stringify(result));
    assert.equal(result.report.behavior.status,'passed');assert.equal(result.report.integration.status,'passed');
    assert(result.report.integration.bindings.length>0);
  }
});

test('wrong rules fail independently without supplying expected answers to experiments',async()=>{
  const implementation=fixture('lodash417/negate','default'),scope=DOMAINS.negated_callback;
  const check=createLibraryExperimentVerifier({repository,scope,makeExperiments:predicates});
  const wrong=structuredClone(PROGRAMS.negate);wrong.body.then.body.body=wrong.body.then.body.body.value;
  for(const program of [wrong,p(lit(false))]){
    const result=await check({implementation,program,scope});assert.equal(result.status,'rejected');assert(result.failures.length);
  }
});

test('bad input plans and unusable constructor inputs stop instead of admitting vacuous agreement',async()=>{
  const implementation=fixture('lodash417/negate','default'),scope=DOMAINS.negated_callback;
  for(const makeExperiments of [()=>[],()=>[{id:'invalid',roots:[{args:[null]}]}],()=>[{id:'invalid',roots:[{args:[null]}],calls:[{root:0,args:[]}]}],()=>[{id:'bad-root',roots:[{args:[()=>1]}],calls:[{root:2,args:[]}]}]]){
    const result=await createLibraryExperimentVerifier({repository,scope,makeExperiments})({implementation,program:PROGRAMS.negate,scope});
    assert.equal(result.status,'frontier');assert.equal(result.reason,'checker_failure');assert.equal(result.detail.gate,'independent_inputs');
  }
});

test('plans are recreated independently and source integration rejects unsupported call receivers',async()=>{
  const implementation=fixture('lodash417/constant','default'),scope=DOMAINS.constant_value;let created=0;
  const check=createLibraryExperimentVerifier({repository,scope,makeExperiments:()=>{created++;return [{id:'identity',roots:[{args:[{id:created}]}],calls:[{root:0,args:[]}]}]}});
  assert.equal((await check({implementation,program:PROGRAMS.constantValue,scope})).status,'passed');assert.equal(created,2);
  const unsupported=createLibraryExperimentVerifier({repository,scope,makeExperiments:()=>[{id:'receiver',roots:[{args:[3],receiver:{}}]}]});
  const result=await unsupported({implementation,program:PROGRAMS.constantValue,scope});assert.equal(result.status,'frontier');assert.equal(result.detail.message,'source_import_call_requires_undefined_receiver');
});

test('hidden calls to function-valued data reject even when the returned value agrees',async()=>{
  const implementation=fixture('lodash417/identity','default'),scope=DOMAINS.plain_value;
  for(const producer of [value=>{value();return value},value=>{queueMicrotask(()=>value());return value}]){
    const altered={...implementation,producer};
    const check=createLibraryExperimentVerifier({repository,scope,makeExperiments:({dataFunction})=>[{id:'data',roots:[{args:[dataFunction()]}]}]});
    const result=await check({implementation:altered,program:PROGRAMS.identityValue,scope});
    assert.equal(result.status,'rejected');assert.equal(result.reason,'ungranted_data_function_invoked');
  }
  const callbackScope={callbackArguments:[0],resultPaths:null};
  const sneaky={...implementation,producer:callback=>{const result=callback();result();return result}};
  const check=createLibraryExperimentVerifier({repository,scope:callbackScope,makeExperiments:({dataFunction})=>{
    const data=dataFunction();return [{id:'callback-result',roots:[{args:[()=>data]}]}];
  }});
  const result=await check({implementation:sneaky,program:p({op:'call',target:{op:'arg',index:0},receiver:{op:'undefined'},args:{op:'array',items:[]}}),scope:callbackScope});
  assert.equal(result.status,'rejected');assert.equal(result.reason,'ungranted_data_function_invoked');
});

test('unobserved input functions, including symbol fields, require valid independent fixtures',async()=>{
  const implementation=fixture('lodash417/identity','default'),scope=DOMAINS.plain_value;
  for(const value of [()=>1,{[Symbol('hidden')]:()=>1},{get hidden(){throw Error('must not read')}}]){
    const check=createLibraryExperimentVerifier({repository,scope,makeExperiments:()=>[{id:'unobserved',roots:[{args:[value]}]}]});
    const result=await check({implementation,program:PROGRAMS.identityValue,scope});assert.equal(result.status,'frontier');assert.equal(result.reason,'checker_failure');
  }
});

test('a predicate cannot pass vacuously when the independent inputs never exercise a positive case',async()=>{
  const implementation=fixture('react18','isValidElement'),scope=DOMAINS.element_predicate;
  const check=createLibraryExperimentVerifier({repository,scope,makeExperiments:()=>[{id:'only-invalid-elements',roots:[{args:[null]},{args:[{}]},{args:[false]}]}]});
  for(const program of [PROGRAMS.isValid18,p(lit(false))]){
    const result=await check({implementation,program,scope});assert.equal(result.status,'frontier');assert.equal(result.detail.message,'independent_inputs_do_not_distinguish_boolean_outcomes');
  }
  const discriminate=createLibraryExperimentVerifier({repository,scope,makeExperiments:()=>[{id:'both-outcomes',roots:[{args:[null]},{args:[{$$typeof:Symbol.for('react.element')}]}]}]});
  assert.equal((await discriminate({implementation,program:PROGRAMS.isValid18,scope})).status,'passed');
  assert.equal((await discriminate({implementation,program:p(lit(false)),scope})).status,'rejected');
});
