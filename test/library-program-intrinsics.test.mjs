import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {resolveLibraryProgram} from '../authoring/library-program-resolver.mjs';
import {readLibraryImplementation} from '../authoring/library-implementation.mjs';
import {createLibraryExperimentVerifier} from '../authoring/library-program-experiments.mjs';
import {createLibraryProgramBank} from '../analysis/library-program-bank.mjs';
import {EXPERIMENTS} from '../evaluation/shared-rules/experiments.mjs';
import {DOMAINS} from '../evaluation/shared-rules/cases.mjs';

const repository=fileURLToPath(new URL('../evaluation/shared-rules/fixtures/',import.meta.url));
const scope=DOMAINS.plain_value;
const makeBank=(makeExperiments=EXPERIMENTS.plain_values)=>createLibraryProgramBank({
  check:createLibraryExperimentVerifier({repository,scope,makeExperiments}),
});

test('real native Lodash exports reuse an existing primitive only after behavior and integration checks',async()=>{
  for(const specifier of ['lodash417/isArray','lodash/isArray']){
    const bank=makeBank();let requests=0;
    const options={repository,specifier,exportName:'default',scope,bank,provider:()=>{requests++;throw Error('must not spend')}};
    const result=await resolveLibraryProgram(options);
    assert.equal(result.status,'admitted',JSON.stringify(result));assert.equal(result.origin,'host_intrinsic');
    assert.equal(result.report.behavior.status,'passed');assert.equal(result.report.integration.status,'passed');
    assert.equal(requests,0);assert.equal(result.catalog_extension.skeletons[0].import_subpath,'./isArray');
    const reloaded=await resolveLibraryProgram({...options,bank:makeBank(),catalogs:[result.catalog_extension]});
    assert.equal(reloaded.status,'admitted');assert.equal(reloaded.origin,'catalog');
  }
});

test('native candidates cannot bypass missing inputs, incorrect rules or unfamiliar evaluation isolation',async()=>{
  const options={repository,specifier:'lodash417/isArray',exportName:'default'};
  assert.equal((await resolveLibraryProgram({...options,bank:makeBank()})).reason,'independent_input_domain_required');
  const insufficient=makeBank(()=>[{id:'only-negative',roots:[{args:[null]},{args:[{}]}]}]);
  const result=await resolveLibraryProgram({...options,scope,bank:insufficient});
  assert.notEqual(result.status,'admitted');assert.equal(insufficient.lookup(options.specifier,'default'),null);
  const implementation=readLibraryImplementation(options);
  for(const value of [true,false]){
    const wrong=await makeBank().admit({implementation,scope,program:{schema:'producttrace.library-program.v1',body:{op:'literal',value}}});
    assert.notEqual(wrong.status,'admitted');
  }
  let requests=0;
  const unfamiliar=await resolveLibraryProgram({...options,scope,bank:makeBank(),mode:'unfamiliar_only',
    catalogs:new Proxy([],{get(){throw Error('bank answers leaked')}}),provider:()=>{requests++;throw Error('native source unavailable')}});
  assert.equal(unfamiliar.status,'frontier');assert.equal(requests,0);
});
