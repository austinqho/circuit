import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createLibraryProgramBank} from '../../analysis/library-program-bank.mjs';
import {createLibraryProgramVerifier} from '../../authoring/library-program-verifier.mjs';
import {resolveLibraryProgram} from '../../authoring/library-program-resolver.mjs';
import {DOMAINS} from './cases.mjs';
import {checkCase} from './check-case.mjs';
import {integrationCheck} from './run.mjs';

const directory=path.dirname(fileURLToPath(import.meta.url));
const repository=path.join(directory,'react-runtime/18.2');
const catalog=JSON.parse(fs.readFileSync(path.resolve(directory,'../../authoring/banks/initial-library-programs.json')));
const rows=[],skeletons=[];
for(const [exportName,profile] of [['createRef','reference'],['isValidElement','element_predicate'],['forwardRef','render_descriptor'],['memo','memo_descriptor']]){
  const spec={id:`react182-${exportName}`,specifier:'react',exportName,profile};
  const makeBank=()=>createLibraryProgramBank({check:createLibraryProgramVerifier({scope:DOMAINS[profile],
    behavior:({implementation,program})=>checkCase(spec,implementation,program),
    integration:async({implementation,program})=>{const result=await integrationCheck(spec,implementation,program,repository);return {...result,status:result.passed?'passed':'rejected'}},
  })});
  const options={repository,specifier:'react',exportName,catalogs:[catalog]};
  const initial=await resolveLibraryProgram({...options,bank:makeBank()});assert.equal(initial.reason,'catalog_version_unverified');
  const entries=makeBank();
  const result=await resolveLibraryProgram({...options,bank:entries,compatibility:'verify'});
  assert.equal(result.status,'admitted',`${exportName}: ${JSON.stringify(result)}`);
  assert.equal(result.origin,'verified_compatibility');
  assert.equal(result.report.behavior.status,'passed');assert.equal(result.report.integration.status,'passed');
  assert.equal(result.catalog_extension.skeletons[0].versions[0].version,'18.2.0');
  if(exportName==='createRef')assert(result.attempts.find(row=>row.status==='verified').origins.some(row=>row.normalization.length),'Equivalent alias syntax is structurally normalized before deduplication');
  if(exportName==='isValidElement')assert(result.attempts.some(row=>row.status==='rejected'),'React 19 element semantics must not pass React 18');
  const reloaded=await resolveLibraryProgram({...options,catalogs:[result.catalog_extension],bank:makeBank()});
  assert.equal(reloaded.status,'admitted');assert.equal(reloaded.origin,'catalog');
  skeletons.push(...result.catalog_extension.skeletons);
  rows.push({exportName,version:'18.2.0',status:result.status,source:result.catalog_extension.skeletons[0].versions[0].implementation,
    attempts:result.attempts,reloaded:reloaded.status});
}
// Reuse the independently admitted unfamiliar proposal on another installed
// Lodash version, preserving the public subpath despite npm alias differences.
for(const [name,profile] of [['negate','negated_callback'],['constant','constant_value'],['identity','plain_value'],['castArray','plain_value']]){
  const repository=path.join(directory,'fixtures');
  const spec={id:'lodash-current-'+name,specifier:'lodash/'+name,exportName:'default',profile,...(['identity','castArray'].includes(name)?{experiment:'plain_values'}:{})};
  const catalog=JSON.parse(fs.readFileSync(path.resolve(directory,'../../authoring/banks/extension-library-programs.json')));
  const makeBank=()=>createLibraryProgramBank({check:createLibraryProgramVerifier({scope:DOMAINS[spec.profile],
    behavior:({implementation,program})=>checkCase(spec,implementation,program),
    integration:async({implementation,program})=>{const result=await integrationCheck(spec,implementation,program,repository);return {...result,status:result.passed?'passed':'rejected'}},
  })});
  const options={repository,specifier:spec.specifier,exportName:spec.exportName,catalogs:[catalog]};
  const initial=await resolveLibraryProgram({...options,bank:makeBank()});assert.equal(initial.reason,'catalog_version_unverified');
  const result=await resolveLibraryProgram({...options,bank:makeBank(),compatibility:'verify'});
  assert.equal(result.status,'admitted',JSON.stringify(result));assert.equal(result.origin,'verified_compatibility');
  const skeleton=result.catalog_extension.skeletons[0];assert.equal(skeleton.import_subpath,'./'+name);
  assert.equal(skeleton.versions[0].version,'4.18.1');
  const reloaded=await resolveLibraryProgram({...options,bank:makeBank(),catalogs:[result.catalog_extension]});assert.equal(reloaded.origin,'catalog');
  skeletons.push(skeleton);rows.push({exportName:name,package:'lodash',version:'4.18.1',status:'admitted',attempts:result.attempts,reloaded:reloaded.status});
}
const report={passed:true,model_requests:0,model_spend_usd:0,scope:'Four selected React 18.2.0 APIs and four Lodash 4.18.1 functions, independently verified reuse of existing version/build candidates. No renderer lifecycle or universal version compatibility claim.',rows};
fs.writeFileSync(path.join(directory,'version-compatibility-results.json'),JSON.stringify(report,null,2)+'\n');
// Generated artifact is intentionally separate from frozen model-answer banks.
fs.writeFileSync(path.join(directory,'verified-version-extensions.json'),JSON.stringify({schema:'producttrace.library-program-catalog.v1',skeletons},null,2)+'\n');
console.log(JSON.stringify({passed:true,cases:rows.length,admitted:rows.filter(row=>row.status==='admitted').length,frontiers:rows.filter(row=>row.status==='frontier').length,model_requests:0}));
