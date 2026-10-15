import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import ts from 'typescript';
import { createLibraryProgramVerifier } from '../authoring/library-program-verifier.mjs';
import { authorLibraryProgram } from '../authoring/library-program-author.mjs';
import { createLibraryProgramBank } from '../analysis/library-program-bank.mjs';
import { createLibraryBoundary } from '../analysis/library-boundary.mjs';
import { instrumentLibraryPrograms } from '../analysis/library-program-integration.mjs';
const call={op:'call',target:{op:'arg',index:0},receiver:{op:'undefined'},args:{op:'array',items:[{op:'arg',index:1}]}};
const correct={schema:'producttrace.library-program.v1',body:call};
const wrong={schema:correct.schema,body:{op:'sequence',steps:[call,{op:'undefined'}]}};
const scope={callbackArguments:[0],resultPaths:null,description:'One synchronous callback, forwarded input and original return.'};
const implementation={producer:(cb,value)=>cb(value),sha256:'verifier-fixture',unchanged:()=>true,
  context:{source_status:'ready_for_scoped_proposal',specifier:'fixture',export_name:'run',implementation:'(cb,value)=>cb(value)'}};
const proposal=program=>({schema:'producttrace.library-program-proposal.v1',status:'propose',program_json:JSON.stringify(program),reason:'proposed behavior'});
const behavior=async ({implementation,program})=>{
  const boundary=createLibraryBoundary({producer:implementation.producer,program,...scope});
  boundary.invoke([()=>undefined,1]);
  const report=boundary.checkpoint();return {status:report.status==='observed_agreement'?'passed':'rejected',reason:report.failures[0]?.reason};
};
async function integration(candidate){
  // This bank exists only inside the independent integration probe. Only the
  // outer verifier can publish a usable entry after this probe returns.
  const provisional=createLibraryProgramBank({check:behavior});
  assert.equal((await provisional.admit(candidate)).status,'admitted');
  const transformed=instrumentLibraryPrograms({source:"import {run} from 'fixture'; export const result=run(value=>value+4, 38);",bank:provisional});
  const exports={};
  vm.runInNewContext(ts.transpileModule(transformed.code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
    {exports,require:()=>({run:candidate.implementation.producer}),[transformed.runtimeKey]:transformed.runtime});
  assert.equal(exports.result,42);
  const report=transformed.runtime.checkpoint()[0];
  return {status:report.status==='observed_agreement'?'passed':'rejected',reason:report.failures[0]?.reason,failures:report.failures};
}

test('an integration counterexample reaches automatic repair before a rule is admitted',async()=>{
  const entries=createLibraryProgramBank({check:createLibraryProgramVerifier({scope,behavior,integration})});
  const requests=[];
  const result=await authorLibraryProgram({implementation,scope,bank:entries,provider:{generate:async request=>{
    requests.push(request);assert.equal(entries.lookup('fixture','run'),null);
    return {proposal:proposal(requests.length===1?wrong:correct),cost_usd:0};
  }}});
  assert.equal(result.status,'admitted');assert.equal(requests.length,2);
  assert.equal(result.attempts[0].check.stage,'integration');
  const feedback=JSON.parse(requests[1].input).feedback;
  assert.equal(feedback.stage,'integration');assert.equal(feedback.reason,'result_value_or_identity_mismatch');
  assert(!requests[1].input.includes('value+4'));assert(!requests[1].input.includes('38'));
  assert.equal(result.admission.report.behavior.status,'passed');
  assert.equal(result.admission.report.integration.status,'passed');
  assert(entries.lookup('fixture','run'));
});

test('format failures do not execute gates, and source drift prevents integration',async()=>{
  let behaviorCalls=0,integrationCalls=0,valid=true;
  const check=createLibraryProgramVerifier({scope,behavior:async()=>{behaviorCalls++;valid=false;return {status:'passed'};},integration:async()=>{integrationCalls++;return {status:'passed'};}});
  const source={...implementation,unchanged:()=>valid};
  assert.equal((await check({implementation:source,program:{...correct,body:{op:'invented'}},scope})).stage,'format');
  assert.equal(behaviorCalls,0);
  assert.equal((await check({implementation:source,program:correct,scope})).stage,'source');
  assert.equal(behaviorCalls,1);assert.equal(integrationCalls,0);
});

test('a checker crash or malformed checker result stops generation rather than spending on repair',async()=>{
  for(const integration of [async()=>{throw Error('missing harness input');},async()=>({passed:true})]){
    const entries=createLibraryProgramBank({check:createLibraryProgramVerifier({scope,behavior,integration})});let calls=0;
    const result=await authorLibraryProgram({implementation,scope,bank:entries,provider:{generate:async()=>{calls++;return {proposal:proposal(correct),cost_usd:0};}}});
    assert.equal(result.reason,'checker_failure');assert.equal(calls,1);assert.equal(entries.lookup('fixture','run'),null);
  }
});

test('a no-op passing a quiet behavior case is repaired after integration observes a callback',async()=>{
  const subject={...implementation,producer:(cb,enabled)=>{if(enabled)cb();}};
  const check=async(candidate,enabled)=>{
    const boundary=createLibraryBoundary({producer:subject.producer,program:candidate.program,...scope});boundary.invoke([()=>undefined,enabled]);
    const report=boundary.checkpoint();return {status:report.status==='observed_agreement'?'passed':'rejected',reason:report.failures[0]?.reason,failures:report.failures};
  };
  const entries=createLibraryProgramBank({check:createLibraryProgramVerifier({scope,behavior:candidate=>check(candidate,false),integration:async candidate=>{
    const provisional=createLibraryProgramBank({check:row=>check(row,false)});assert.equal((await provisional.admit(candidate)).status,'admitted');
    const transformed=instrumentLibraryPrograms({source:"import {run} from 'fixture'; run(()=>undefined,true);",bank:provisional});
    vm.runInNewContext(ts.transpileModule(transformed.code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
      {exports:{},require:()=>({run:subject.producer}),[transformed.runtimeKey]:transformed.runtime});
    const report=transformed.runtime.checkpoint()[0];return {status:report.status==='observed_agreement'?'passed':'rejected',reason:report.failures[0]?.reason,failures:report.failures};
  }})});
  let calls=0;const repaired={schema:correct.schema,body:{op:'if',test:{op:'arg',index:1},then:{...call,args:{op:'array',items:[]}},else:{op:'undefined'}}};
  const result=await authorLibraryProgram({implementation:subject,scope,bank:entries,provider:{generate:async request=>{
    calls++;if(calls===2)assert(request.input.includes('unmodeled_callback_invocation'));return {proposal:proposal(calls===1?{schema:correct.schema,body:{op:'undefined'}}:repaired),cost_usd:0};
  }}});
  assert.equal(result.status,'admitted');assert.equal(calls,2);assert.equal(result.admission.report.integration.status,'passed');
});

test('a changed catalog observation scope cannot borrow checks performed for the original scope', async () => {
  let runs = 0;
  const trusted = structuredClone(scope);
  const verify = createLibraryProgramVerifier({ scope: trusted, behavior: () => { runs++; return { status: 'passed' }; }, integration: () => { runs++; return { status: 'passed' }; } });
  trusted.callbackArguments.length = 0;
  const changed = await verify({ implementation, program: correct, scope: { ...scope, callbackArguments: [] } });
  assert.equal(changed.reason, 'checker_failure');
  assert.equal(changed.detail.message, 'independent_scope_mismatch'); assert.equal(runs, 0);
  assert.equal((await verify({ implementation, program: correct, scope })).status, 'passed'); assert.equal(runs, 2);
  assert.throws(() => createLibraryProgramVerifier({ behavior, integration }), /independent_scope_required/);
});

test('owned value scopes reject invalid callback positions and partial result checking',async()=>{
  let checks=0;const entries=createLibraryProgramBank({check:()=>{checks++;return {status:'passed'}}});
  for(const change of [{callbackArguments:[64]},{resultPaths:[['current']]},{resultIdentityPaths:[[]]},{observationMode:'references'}]){
    const result=await entries.admit({implementation,program:correct,scope:{protocol:'owned_call_boundary',callbackArguments:[],resultPaths:null,...change}});
    assert.equal(result.reason,'owned_value_scope_requires_complete_value_replay');
  }
  assert.equal(checks,0);
});
