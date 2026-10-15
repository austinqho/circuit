import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
import {createLibraryProgramBank,instrumentLibraryPrograms} from '../../analysis/index.mjs';
import {resolveLibraryProgram} from '../../authoring/library-program-resolver.mjs';
import {createLibraryProgramVerifier} from '../../authoring/library-program-verifier.mjs';
import {CASES,DOMAINS} from '../../evaluation/shared-rules/cases.mjs';
import {checkCase} from '../../evaluation/shared-rules/check-case.mjs';
import {integrationCheck} from '../../evaluation/shared-rules/run.mjs';

const directory=fileURLToPath(new URL('../../evaluation/shared-rules/',import.meta.url));
const repository=path.join(directory,'fixtures'),require=createRequire(path.join(repository,'package.json'));
const cases=['react19-children-forEach','table8new-functionalUpdate'].map(id=>CASES.find(row=>row.id===id));
assert(cases.every(Boolean));
const catalogs=['initial-library-programs.json','extension-library-programs.json'].map(file=>JSON.parse(fs.readFileSync(new URL('../../authoring/banks/'+file,import.meta.url))));
const bank=createLibraryProgramBank({check:async candidate=>{
  const spec=cases.find(row=>row.specifier===candidate.implementation.context.specifier&&row.exportName===candidate.implementation.context.export_name);
  assert(spec,'Only independently checked installed cases enter the application bank');
  return createLibraryProgramVerifier({scope:DOMAINS[spec.profile],
    behavior:({implementation,program})=>checkCase(spec,implementation,program),
    integration:async({implementation,program})=>{const result=await integrationCheck(spec,implementation,program);return {...result,status:result.passed?'passed':'rejected'};},
  })(candidate);
}});
for(const spec of cases){
  const admitted=await resolveLibraryProgram({repository,...spec,catalogs,bank});
  assert.equal(admitted.status,'admitted',JSON.stringify(admitted));assert.equal(admitted.origin,'catalog');
}
const serverRequests=[],requestObservations=[];
const server=http.createServer((req,res)=>{serverRequests.push(req.url);res.end('received');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
try {
  const origin=`http://127.0.0.1:${server.address().port}`;
  // The callback crosses an application module before entering the second
  // installed library. Both programs come from saved model proposals.
  const sources={
    outer:`import {Children} from 'react19'; import {requestOne} from './inner';
      export async function run(children){const pending=[];Children.forEach(children,(child,index)=>{pending.push(requestOne(child,index));});return Promise.all(pending);}`,
    inner:`import {functionalUpdate} from 'table8new';
      export function requestOne(child,index){return functionalUpdate(value=>request('/items/'+value+'/'+index),child);}`,
  };
  const transformed=Object.fromEntries(Object.entries(sources).map(([name,source])=>[name,instrumentLibraryPrograms({source,file:`composition-${name}.ts`,bank})]));
  // The application's own import is not a claimed library boundary. It stays
  // an explicit static frontier while runtime context crosses its real call.
  assert.equal(transformed.outer.bindings.length,1);assert.equal(transformed.inner.bindings.length,1);
  assert(transformed.outer.frontiers.every(row=>row.specifier==='./inner'));
  const modules={outer:{},inner:{}};
  for(const name of ['inner','outer']) {
    const unit=transformed[name];
    vm.runInNewContext(ts.transpileModule(unit.code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
      exports:modules[name],require:specifier=>specifier==='./inner'?modules.inner:require(specifier),
      request:async pathname=>{
        requestObservations.push({pathname,execution:unit.runtime.currentExecution()});
        const response=await fetch(origin+pathname);return response.text();
      },[unit.runtimeKey]:unit.runtime,
    });
  }
  assert.deepEqual(Array.from(await modules.outer.run(['chat','scroll'])),['received','received']);
  assert.deepEqual(serverRequests,['/items/chat/0','/items/scroll/1']);
  assert.equal(requestObservations.length,2,'Rule replay must not issue requests again');
  const reports=Object.values(transformed).flatMap(unit=>unit.runtime.checkpoint());
  assert(reports.every(row=>row.status==='observed_agreement'),JSON.stringify(reports));
  const execution=transformed.outer.runtime.execution();assert.equal(execution.status,'observed_execution');
  assert.equal(execution.events.length,7,'One React call, two React callbacks, two TanStack calls and two TanStack callbacks');
  const byId=new Map(execution.events.map(row=>[row.id,row]));
  const chains=requestObservations.map(request=>{
    assert(request.execution);let current=byId.get(request.execution.id);const chain=[];
    while(current){chain.push(current);current=current.parent_id?byId.get(current.parent_id):null;}
    assert.deepEqual(chain.map(row=>row.kind),['callback_invocation','library_invocation','callback_invocation','library_invocation']);
    assert.equal(chain[1].source.file,'composition-inner.ts');assert.equal(chain[3].source.file,'composition-outer.ts');
    for(const event of chain.filter(row=>row.kind==='callback_invocation'))
      assert(reports.some(report=>report.evidence.some(row=>row.execution_id===event.id&&row.status==='observed_agreement')));
    return {request:request.pathname,execution_path:chain.reverse().map(row=>row.id)};
  });
  assert.notEqual(chains[0].execution_path[1],chains[1].execution_path[1],'Repeated callback occurrences remain distinct');
  assert.equal(transformed.inner.runtime.currentExecution(),null);
  const report={passed:true,model_requests:0,real_http_requests:serverRequests.length,chains,execution,
    scope:'Two actual installed libraries and two instrumented application modules. Observed request initiation and server receipt; no browser control, Express handler, OTel or database claim.'};
  fs.writeFileSync(path.join(directory,'composition-results.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({passed:true,real_http_requests:serverRequests.length,execution_events:execution.events.length,model_requests:0}));
} finally {await new Promise(resolve=>server.close(resolve));}
