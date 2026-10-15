import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createLibraryProgramVerifier} from '../../authoring/library-program-verifier.mjs';
import {createLibraryProgramBank} from '../../analysis/library-program-bank.mjs';
import {readLibraryImplementation} from '../../authoring/library-implementation.mjs';
import {resolveLibraryProgram} from '../../authoring/library-program-resolver.mjs';
import {CASES, DOMAINS} from './cases.mjs';
import {checkCase} from './check-case.mjs';
import {integrationCheck} from './run.mjs';
const directory=path.dirname(fileURLToPath(import.meta.url));
const ids=new Set(['frozen.json','frozen-extension-1.json','frozen-extension-2.json','frozen-extension-5.json','frozen-extension-6.json','frozen-extension-8.json','frozen-extension-9.json','frozen-extension-10.json','frozen-extension-11.json','frozen-extension-12.json','frozen-extension-13.json'].flatMap(file=>JSON.parse(fs.readFileSync(path.join(directory,file))).cases.map(row=>row.id)));
const catalogs=['initial-library-programs.json','extension-library-programs.json'].map(file=>JSON.parse(fs.readFileSync(path.resolve(directory,'../../authoring/banks',file))));
const rows=[];
for(const spec of CASES.filter(row=>ids.has(row.id))){
  const implementation=readLibraryImplementation({repository:path.join(directory,'fixtures'),...spec});
  const bank=createLibraryProgramBank({check:createLibraryProgramVerifier({ scope: DOMAINS[spec.profile],
    behavior:({implementation,program})=>checkCase(spec,implementation,program),
    integration:async({implementation,program})=>{const result=await integrationCheck(spec,implementation,program);return {...result,status:result.passed?'passed':'rejected'};},
  })});
  assert.equal(bank.lookup(spec.specifier,spec.exportName),null);
  const result=await resolveLibraryProgram({repository:path.join(directory,'fixtures'),specifier:spec.specifier,exportName:spec.exportName,catalogs,bank});
  assert.equal(result.status,'admitted',`${spec.id}: ${JSON.stringify(result)}`);
  assert.equal(result.origin,'catalog');
  assert.equal(result.report.behavior.status,'passed');assert.equal(result.report.integration.status,'passed');
  assert(bank.lookup(spec.specifier,spec.exportName));
  rows.push({case_id:spec.id,source_and_format:'passed',behavior:result.report.behavior.status,integration:result.report.integration.status,admitted:true});
}
const report={passed:true,model_requests:0,model_spend_usd:0,scope:'Saved model-produced candidates are independently re-admitted only after both behavior and source integration pass.',rows};
fs.writeFileSync(path.join(directory,'usable-catalog-results.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({passed:true,cases:rows.length,model_requests:0}));
