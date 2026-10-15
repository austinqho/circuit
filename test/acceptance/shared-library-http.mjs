import assert from 'node:assert/strict';
import http from 'node:http';
import vm from 'node:vm';
import fs from 'node:fs';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
import { createLibraryProgramBank, instrumentLibraryPrograms } from '../../analysis/index.mjs';
import { readLibraryImplementation } from '../../authoring/library-implementation.mjs';
import { checkCase } from '../../evaluation/shared-rules/check-case.mjs';
import { CASES } from '../../evaluation/shared-rules/cases.mjs';
import { admitCatalogProgram } from '../../authoring/library-program-catalog.mjs';

const spec = CASES.find(row => row.id === 'table8old-functionalUpdate');
const implementation = readLibraryImplementation({ repository: fileURLToPath(new URL('../../evaluation/shared-rules/fixtures', import.meta.url)), ...spec });
const bank = createLibraryProgramBank({ check: ({ implementation, program }) => checkCase(spec, implementation, program) });
const catalog = JSON.parse(fs.readFileSync(new URL('../../authoring/banks/initial-library-programs.json', import.meta.url)));
const skeleton = catalog.skeletons.find(row => row.package === '@tanstack/table-core' && row.export_name === 'functionalUpdate');
assert(skeleton, 'the independently admitted model proposal must exist in the reusable bank');
assert.equal((await admitCatalogProgram({ skeleton, implementation, bank })).status, 'admitted');
const requests = [];
const server = http.createServer((req, res) => {
  requests.push({ method: req.method, url: req.url });
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ accepted: req.url }));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
try {
  const base = `http://127.0.0.1:${server.address().port}`;
  const source = `import { functionalUpdate as update } from 'table8old';
    export const response = update(value => fetch(origin + '/items/' + value), 'from-the-callback');`;
  const integration = instrumentLibraryPrograms({ source, file: 'actual-network.ts', bank });
  const exports = {};
  const code = ts.transpileModule(integration.code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(code, { exports, require: () => ({ functionalUpdate: implementation.producer }),
    origin: base, fetch, [integration.runtimeKey]: integration.runtime });
  const response = await exports.response;
  assert.deepEqual(await response.json(), { accepted: '/items/from-the-callback' });
  assert.deepEqual(requests, [{ method: 'GET', url: '/items/from-the-callback' }]);
  const evidence = integration.runtime.checkpoint();
  assert.equal(evidence[0].status, 'observed_agreement');
  assert.equal(evidence[0].evidence.length, 1); // Replay must not send another request.
  assert.equal(evidence[0].evidence[0].outcome, 'return');
  console.log(JSON.stringify({ passed: true, real_http_requests: requests.length,
    source_binding: integration.bindings[0].id, callback_evidence: evidence[0].evidence[0],
    scope: 'Node source integration through an actual callback and HTTP request; no browser, database, or OTel ancestry claim.' }, null, 2));
} finally { await new Promise(resolve => server.close(resolve)); }
