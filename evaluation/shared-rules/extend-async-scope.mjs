import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {CASES,DOMAINS} from './cases.mjs';
import {checkCase} from './check-case.mjs';
import {integrationCheck} from './run.mjs';
import {readLibraryImplementation} from '../../authoring/library-implementation.mjs';
import {admitCatalogProgram} from '../../authoring/library-program-catalog.mjs';
import {createLibraryProgramVerifier} from '../../authoring/library-program-verifier.mjs';
import {createLibraryProgramBank} from '../../analysis/library-program-bank.mjs';
const directory=path.dirname(fileURLToPath(import.meta.url));
const catalogPath=path.resolve(directory,'../../authoring/banks/initial-library-programs.json');
const catalog=JSON.parse(fs.readFileSync(catalogPath));
const skeleton=catalog.skeletons.find(row=>row.package==='async'&&row.export_name==='apply');
const previousScope=structuredClone(skeleton.scope);
skeleton.scope=DOMAINS.partial_callback;
const checks=[];
for(const spec of CASES.filter(row=>row.profile==='partial_callback')) {
  const implementation=readLibraryImplementation({repository:path.join(directory,'fixtures'),...spec});
  const bank=createLibraryProgramBank({check:createLibraryProgramVerifier({scope:skeleton.scope,
    behavior:({program})=>checkCase(spec,implementation,program),
    integration:async({program})=>{const result=await integrationCheck(spec,implementation,program);return {...result,status:result.passed?'passed':'rejected'}}})});
  const admitted=await admitCatalogProgram({skeleton,implementation,bank});
  if(admitted.status!=='admitted')throw Error(JSON.stringify(admitted));
  checks.push({case:spec.id,admitted});
}
// Change only this verified scope. Preserve every unrelated source/build variant
// and the exact existing model-produced programs and version overrides.
if(process.argv.includes('--write-catalog'))fs.writeFileSync(catalogPath,JSON.stringify(catalog,null,2)+'\n');
fs.writeFileSync(path.join(directory,'async-late-callback-results.json'),JSON.stringify({passed:true,model_requests:0,
  previous_scope:previousScope,scope:skeleton.scope,programs_changed:false,checks},null,2)+'\n');
console.log(JSON.stringify({passed:true,versions:checks.length,programs_changed:false,model_requests:0}));
