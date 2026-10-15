import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
import { readLibraryImplementation } from '../../authoring/library-implementation.mjs';
import { portableImplementation, admitCatalogProgram } from '../../authoring/library-program-catalog.mjs';
import { createLibraryProgramBank, programHash } from '../../analysis/library-program-bank.mjs';
import { createLibraryBoundary } from '../../analysis/library-boundary.mjs';
import { instrumentLibraryPrograms } from '../../analysis/library-program-integration.mjs';
const directory = path.dirname(fileURLToPath(import.meta.url));
const repository = path.join(directory, 'fixtures');
const implementation = readLibraryImplementation({ repository, specifier: 'react18', exportName: 'startTransition' });
assert.equal(implementation.context.source_status, 'ready_for_scoped_proposal', implementation.context.source_reason);
const scope = { callbackArguments: [0], resultPaths: null,
  description: 'React 18 synchronous startTransition scope invocation with exact arguments, return/throw and callback source. Priority assignment, queued updates, scheduler decisions and eventual commits require separate host evidence.' };
// Manually transcribed from the exact installed implementation. The shared
// interpreter and source transformer have no startTransition special case.
const program = { schema: 'producttrace.library-program.v1', body: { op: 'sequence', steps: [
  { op: 'call', target: { op: 'arg', index: 0 }, receiver: { op: 'undefined' }, args: { op: 'array', items: [] } },
  { op: 'undefined' },
] } };
async function check({ implementation, program }) {
  const boundary = createLibraryBoundary({ producer: implementation.producer, program, ...scope });
  let count = 0;
  const callback = function (...args) { assert.equal(this, undefined); assert.deepEqual(args, []); count++; return { ignored: count }; };
  assert.equal(boundary.invoke([callback]), undefined);
  assert.equal(count, 1);
  assert.equal(boundary.invoke([callback, { name: 'optional scope' }]), undefined);
  const failure = new Error('scope failure');
  assert.throws(() => boundary.invoke([() => { count++; throw failure; }]), error => error === failure);
  assert.equal(boundary.invoke([callback]), undefined); // Recovery after throw.
  assert.equal(count, 4);
  const report = boundary.checkpoint();
  return { status: report.status === 'observed_agreement' ? 'passed' : 'rejected', reason: report.failures[0]?.reason, report };
}
const source = portableImplementation(implementation.context);
const catalogPath = path.resolve(directory, '../../authoring/banks/react-transition-programs.json');
let skeleton;
if (process.argv.includes('--write-catalog')) {
  skeleton = { schema: 'producttrace.library-program-skeleton.v1', package: 'react', export_name: 'startTransition', scope, program,
    versions: [{ version: '18.3.1', base_sha256: programHash(program), overrides: [], program_sha256: programHash(program),
      implementation_sha256: programHash(source), implementation: source,
      verification: { origin: 'manual_exact_source', scope: scope.description } }] };
} else skeleton = JSON.parse(fs.readFileSync(catalogPath)).skeletons[0];
const bank = createLibraryProgramBank({ check });
assert.equal((await admitCatalogProgram({ skeleton, implementation, bank })).status, 'admitted');
const wrongs = [
  { schema: program.schema, body: { op: 'undefined' } },
  { schema: program.schema, body: program.body.steps[0] },
  { schema: program.schema, body: { op: 'sequence', steps: [program.body.steps[0], ...program.body.steps] } },
];
for (const wrong of wrongs) assert.equal((await check({ implementation, program: wrong })).status, 'rejected');
const integration = instrumentLibraryPrograms({ source: "import {startTransition} from 'react18'; export const result = startTransition(() => { effects.push('one actual effect'); return 19; });", file: 'transition.ts', bank });
const exports = {}, effects = [];
vm.runInNewContext(ts.transpileModule(integration.code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
  { exports, effects, require: () => ({ startTransition: implementation.producer }), [integration.runtimeKey]: integration.runtime });
assert.deepEqual(effects, ['one actual effect']); assert.equal(exports.result, undefined);
const evidence = integration.runtime.checkpoint(); assert.equal(evidence[0].status, 'observed_agreement');
assert.equal(evidence[0].evidence.length, 1);
// Different versions must not inherit the rule. React 19 changes error and
// thenable handling; its missing host globals remain an explicit source frontier.
const other = readLibraryImplementation({ repository, specifier: 'react19', exportName: 'startTransition' });
const otherAdmission = await admitCatalogProgram({ skeleton, implementation: other, bank });
assert.equal(otherAdmission.status, 'rejected');
if (process.argv.includes('--write-catalog')) fs.writeFileSync(catalogPath, JSON.stringify({schema:'producttrace.library-program-catalog.v1', skeletons:[skeleton]},null,2)+'\n');
const report = { passed: true, origin: 'manual_exact_source', model_requests: 0, wrong_rules_rejected: wrongs.length,
  source_sha256: programHash(source), implementation_source: implementation.context.implementation,
  integration: evidence, react19_frontier: { source_status: other.context.source_status, source_reason: other.context.source_reason, admission: otherAdmission }, scope: scope.description };
fs.writeFileSync(path.join(directory, 'react-transition-results.json'), JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
