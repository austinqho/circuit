import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import {resolveLibraryProgram} from '../authoring/library-program-resolver.mjs';
import {readLibraryImplementation} from '../authoring/library-implementation.mjs';
import {portableImplementation} from '../authoring/library-program-catalog.mjs';
import {createLibraryProgramVerifier} from '../authoring/library-program-verifier.mjs';
import {createLibraryProgramBank,programHash} from '../analysis/library-program-bank.mjs';
import {createLibraryBoundary} from '../analysis/library-boundary.mjs';
import {instrumentLibraryPrograms} from '../analysis/library-program-integration.mjs';
const program={schema:'producttrace.library-program.v1',body:{op:'call',target:{op:'arg',index:0},receiver:{op:'undefined'},args:{op:'array',items:[{op:'arg',index:1}]}}};
const scope={callbackArguments:[0],resultPaths:null,description:'Independent synchronous callback transport domain.'};
const response=program=>({proposal:{schema:'producttrace.library-program-proposal.v1',status:'propose',program_json:JSON.stringify(program),reason:'source-derived proposal'},cost_usd:0});
function fixture(t){
  const repository=fs.mkdtempSync(path.join(os.tmpdir(),'tracer-bank-resolution-'));
  t.after(()=>fs.rmSync(repository,{recursive:true,force:true}));
  const directory=path.join(repository,'node_modules/alias');fs.mkdirSync(directory,{recursive:true});
  fs.writeFileSync(path.join(repository,'package.json'),'{}');
  fs.writeFileSync(path.join(repository,'package-lock.json'),JSON.stringify({packages:{'node_modules/alias':{name:'actual-package',version:'1.0.0',integrity:'sha512-fixture-only'}}}));
  fs.writeFileSync(path.join(directory,'package.json'),JSON.stringify({name:'actual-package',version:'1.0.0',main:'index.js'}));
  fs.writeFileSync(path.join(directory,'index.js'),'exports.run=function run(cb,value){return cb(value)};exports.other=function other(cb,value){return cb(value)};');
  return {repository,specifier:'alias',exportName:'run'};
}
function catalog(implementation){return {schema:'producttrace.library-program-catalog.v1',skeletons:[{schema:'producttrace.library-program-skeleton.v1',package:'actual-package',export_name:'run',scope,program,
  versions:[{version:'1.0.0',base_sha256:programHash(program),program_sha256:programHash(program),implementation_sha256:programHash(portableImplementation(implementation.context)),overrides:[],verification:{private_answer:'BANK_ANSWER_DO_NOT_SHARE'}}]}]};}
async function behavior(candidate){
  const boundary=createLibraryBoundary({producer:candidate.implementation.producer,program:candidate.program,...candidate.scope});
  boundary.invoke([()=>undefined,1]);const result=boundary.checkpoint();return {status:result.status==='observed_agreement'?'passed':'rejected',reason:result.failures[0]?.reason};
}
async function integration(candidate){
  const probe=createLibraryProgramBank({check:behavior});assert.equal((await probe.admit(candidate)).status,'admitted');
  const {specifier,export_name}=candidate.implementation.context;
  const transformed=instrumentLibraryPrograms({source:`import {${export_name} as execute} from '${specifier}'; export const result=execute(x=>x, value);`,file:'encountered.ts',bank:probe});
  assert.equal(transformed.bindings.length,1);const exports={},value={id:'independent-integration'};
  vm.runInNewContext(ts.transpileModule(transformed.code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
    {exports,value,require:()=>({[export_name]:candidate.implementation.producer}),[transformed.runtimeKey]:transformed.runtime});
  assert.equal(exports.result,value);const report=transformed.runtime.checkpoint()[0];return {status:report.status==='observed_agreement'?'passed':'rejected',reason:report.failures[0]?.reason,failures:report.failures};
}
const bank=()=>createLibraryProgramBank({check:createLibraryProgramVerifier({scope,behavior,integration})});

test('an encountered installed alias selects its exact catalog and reuses the admitted bank without a model',async t=>{
  const spec=fixture(t),implementation=readLibraryImplementation(spec),entries=bank();let calls=0;
  const options={...spec,catalogs:[catalog(implementation)],bank:entries,provider:{generate(){calls++;throw new Error('must not request model')}}};
  const first=await resolveLibraryProgram(options);assert.equal(first.status,'admitted');assert.equal(first.origin,'catalog');assert.equal(first.report.stage,'behavior_and_integration');
  const second=await resolveLibraryProgram(options);assert.equal(second.origin,'live_bank');assert.equal(second.id,first.id);assert.equal(calls,0);
});

test('missing function and entirely missing library both author and repair without receiving bank answers',async t=>{
  for(const entirelyNew of [false,true]){
    const spec=fixture(t),implementation=readLibraryImplementation(spec),catalogs=entirelyNew?[]:[catalog(implementation)],entries=bank();let calls=0;
    const wrong={...program,body:{op:'sequence',steps:[program.body,{op:'undefined'}]}};
    const result=await resolveLibraryProgram({...spec,exportName:'other',catalogs,bank:entries,scope,provider:{generate:async request=>{
      calls++;assert(!request.input.includes('BANK_ANSWER_DO_NOT_SHARE'));assert(!request.input.includes('private_answer'));
      if(calls===2)assert(request.input.includes('result_value_or_identity_mismatch'));
      return response(calls===1?wrong:program);
    }}});
    assert.equal(result.status,'admitted');assert.equal(result.origin,'authoring');assert.equal(calls,2);assert.equal(result.admission.report.integration.status,'passed');
  }
});

test('frozen unfamiliar mode never reads supplied catalog answers, even when the function is known',async t=>{
  const spec=fixture(t);let calls=0;
  const hidden={get schema(){throw new Error('held-out bank was accessed')}};
  const result=await resolveLibraryProgram({...spec,catalogs:[hidden],mode:'unfamiliar_only',bank:bank(),scope,provider:{generate:async()=>{calls++;return response(program)}}});
  assert.equal(result.status,'admitted');assert.equal(result.bank_miss,'catalog_bypassed_for_unfamiliar_evaluation');assert.equal(calls,1);
});

test('unknown versions, conflicting entries, missing domains and source failures stop before spending',async t=>{
  const spec=fixture(t),implementation=readLibraryImplementation(spec),saved=catalog(implementation);let calls=0;
  const provider={generate(){calls++;throw new Error('unexpected model request')}};
  const conflict=await resolveLibraryProgram({...spec,catalogs:[saved,saved],bank:bank(),scope,provider});assert.equal(conflict.reason,'ambiguous_catalog_entry');
  const older=structuredClone(saved);older.skeletons[0].versions[0].version='0.9.0';
  const version=await resolveLibraryProgram({...spec,catalogs:[older],bank:bank()});assert.equal(version.reason,'catalog_version_unverified');
  const missingDomain=await resolveLibraryProgram({...spec,catalogs:[],bank:bank(),provider});assert.equal(missingDomain.reason,'independent_input_domain_required');
  const missing=await resolveLibraryProgram({...spec,exportName:'missing',bank:bank(),scope,provider});assert.equal(missing.stage,'source');
  const changed=await resolveLibraryProgram({...spec,mode:'unfamiliar_only',expectedImplementationSha256:'different_frozen_source',bank:bank(),scope,provider});assert.equal(changed.reason,'frozen_implementation_changed');
  assert.equal(calls,0);
});

test('verification alone does not make a candidate available to tracing',async t=>{
  const spec=fixture(t),implementation=readLibraryImplementation(spec),entries=bank();
  const result=await entries.verify({implementation,program,scope});
  assert.equal(result.status,'verified');assert.equal(entries.lookup(spec.specifier,spec.exportName),null);
  result.scope.callbackArguments.length=0;
  assert.equal((await entries.admit({implementation,program,scope})).status,'admitted');
  assert.deepEqual(entries.lookup(spec.specifier,spec.exportName).scope.callbackArguments,[0]);
});

function olderCatalog(implementation){const saved=catalog(implementation);saved.skeletons[0].versions[0].version='0.9.0';return saved;}
function alternative(saved,body){const next=structuredClone(saved),skeleton=next.skeletons[0];skeleton.program={...program,body};
  skeleton.versions[0].base_sha256=skeleton.versions[0].program_sha256=programHash(skeleton.program);return next;}

test('an unverified version must pass behavior and source integration before a reusable version entry is produced',async t=>{
  const spec=fixture(t),implementation=readLibraryImplementation(spec),saved=olderCatalog(implementation),entries=bank();let calls=0;
  const wrong=alternative(saved,{op:'undefined'});
  const result=await resolveLibraryProgram({...spec,catalogs:[wrong,saved,saved],bank:entries,compatibility:'verify',provider:{generate(){calls++;throw Error('no model')}}});
  assert.equal(result.status,'admitted');assert.equal(result.origin,'verified_compatibility');assert.equal(calls,0);
  assert.equal(result.attempts.length,2);assert.equal(result.attempts[0].status,'rejected');assert.equal(result.attempts[1].status,'verified');
  assert.equal(result.report.integration.status,'passed');assert(entries.lookup(spec.specifier,spec.exportName));
  const row=result.catalog_extension.skeletons[0].versions[0];assert.equal(row.version,'1.0.0');assert.equal(row.verification.kind,'independent_version_recheck');
  const replay=await resolveLibraryProgram({...spec,catalogs:[result.catalog_extension],bank:bank()});assert.equal(replay.origin,'catalog');assert.equal(replay.status,'admitted');
});

test('conflicting passing programs and false candidates leave the live bank empty',async t=>{
  const spec=fixture(t),implementation=readLibraryImplementation(spec),saved=olderCatalog(implementation);
  const equivalent=alternative(saved,{op:'sequence',steps:[{op:'undefined'},program.body]});
  const entries=bank(),ambiguous=await resolveLibraryProgram({...spec,catalogs:[saved,equivalent],bank:entries,compatibility:'verify'});
  assert.equal(ambiguous.reason,'ambiguous_compatible_rules');assert.equal(entries.lookup(spec.specifier,spec.exportName),null);
  const failed=await resolveLibraryProgram({...spec,catalogs:[alternative(saved,{op:'undefined'})],bank:entries,compatibility:'verify'});
  assert.equal(failed.reason,'no_verified_compatible_rule');assert.equal(entries.lookup(spec.specifier,spec.exportName),null);
});

test('invalid catalog hashes, variant edits and excessive candidate sets stop before checking or spending',async t=>{
  const spec=fixture(t),implementation=readLibraryImplementation(spec),saved=olderCatalog(implementation);let checks=0;
  const entries=createLibraryProgramBank({check(){checks++;throw Error('must not check')}});
  const bad=structuredClone(saved);bad.skeletons[0].versions[0].program_sha256='changed';
  assert.equal((await resolveLibraryProgram({...spec,catalogs:[bad],bank:entries,compatibility:'verify'})).reason,'catalog_program_changed');
  const variant=structuredClone(saved);variant.skeletons[0].versions[0].source_variants=[{...variant.skeletons[0].versions[0],overrides:[{path:['body','missing'],value:0}]}];
  assert.equal((await resolveLibraryProgram({...spec,catalogs:[variant],bank:entries,compatibility:'verify'})).reason,'override_target_missing');
  const many=Array.from({length:5},(_,value)=>alternative(saved,{op:'literal',value}));
  assert.equal((await resolveLibraryProgram({...spec,catalogs:many,bank:entries,compatibility:'verify'})).reason,'compatibility_program_candidate_limit');assert.equal(checks,0);
});

test('incomplete source or checker evidence is not treated as a losing compatibility alternative',async t=>{
  const spec=fixture(t),implementation=readLibraryImplementation(spec),saved=olderCatalog(implementation);
  const options={...spec,catalogs:[saved],compatibility:'verify'};
  const entries=createLibraryProgramBank({check:async()=>({status:'frontier',reason:'checker_failure'})});
  assert.equal((await resolveLibraryProgram({...options,bank:entries})).reason,'compatibility_verification_incomplete');
  assert.equal(entries.lookup(spec.specifier,spec.exportName),null);
  const crashed=createLibraryProgramBank({check:async()=>{throw Error('probe process failed')}});
  assert.equal((await resolveLibraryProgram({...options,bank:crashed})).reason,'compatibility_checker_failed');
  assert.equal(crashed.lookup(spec.specifier,spec.exportName),null);
});

test('unfamiliar-only mode never consults compatibility candidates',async t=>{
  const spec=fixture(t);let calls=0;
  const result=await resolveLibraryProgram({...spec,mode:'unfamiliar_only',compatibility:'verify',catalogs:[{get schema(){throw Error('bank exposure')}}],
    bank:bank(),scope,provider:{generate:async()=>{calls++;return response(program)}}});
  assert.equal(result.origin,'authoring');assert.equal(result.status,'admitted');assert.equal(calls,1);
});

test('a subpath candidate is not used for another entry point even when their exports share a name',async t=>{
  const spec=fixture(t),implementation=readLibraryImplementation(spec),saved=olderCatalog(implementation);saved.skeletons[0].import_subpath='./another';
  const entries=createLibraryProgramBank({check:()=>{throw Error('must not test another entry point')}});
  const result=await resolveLibraryProgram({...spec,catalogs:[saved],bank:entries,compatibility:'verify'});
  assert.equal(result.reason,'catalog_entry_missing');assert.equal(entries.lookup(spec.specifier,spec.exportName),null);
});
