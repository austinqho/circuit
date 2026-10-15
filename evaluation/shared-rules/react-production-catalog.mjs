import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { readLibraryImplementation } from '../../authoring/library-implementation.mjs';
import { portableImplementation, programOverrides, admitCatalogProgram } from '../../authoring/library-program-catalog.mjs';
import { createLibraryProgramBank, resolveVersionedProgram, programHash } from '../../analysis/library-program-bank.mjs';
import { CASES } from './cases.mjs';
import { checkCase } from './check-case.mjs';
import { integrationCheck } from './run.mjs';

assert.equal(process.env.NODE_ENV, 'production', 'run in a fresh production process to avoid module-cache contamination');
const directory = path.dirname(fileURLToPath(import.meta.url));
const catalogPath = path.resolve(directory, '../../authoring/banks/initial-library-programs.json');
const catalog = JSON.parse(fs.readFileSync(catalogPath));
// This gate rechecks the original production catalog. New frozen cases have
// their own independent admission gate before they can join a saved catalog.
const originalIds = new Set(JSON.parse(fs.readFileSync(path.join(directory, 'frozen.json'))).cases.map(row => row.id));
const checks = [];
for (const spec of CASES.filter(row => originalIds.has(row.id) && row.specifier.startsWith('react'))) {
  const implementation = readLibraryImplementation({ repository: path.join(directory, 'fixtures'), ...spec });
  assert.equal(implementation.context.source_status, 'ready_for_scoped_proposal', implementation.context.source_reason);
  const source = portableImplementation(implementation.context);
  const skeleton = catalog.skeletons.find(row => row.package === 'react' && row.export_name === spec.exportName);
  const version = source.runtime.entry.version;
  const resolved = resolveVersionedProgram(skeleton, version);
  assert.equal(resolved.status, 'resolved_program');
  let program = structuredClone(resolved.program);
  let sourceAdaptation = 'Saved model proposal; no program change.';
  if (spec.exportName === 'createRef') {
    // Both installed production implementations return an ordinary object.
    // This manually reviewed source change is not a blind model proposal.
    assert.match(implementation.context.implementation, /return\s*\{\s*current\s*:\s*null\s*\}/);
    program.body = { op: 'object', entries: { current: { op: 'literal', value: null } } };
    sourceAdaptation = 'Manual installed-source adaptation: production createRef does not seal the fresh object.';
  }
  const row = skeleton.versions.find(row => row.version === version);
  const writing = process.argv.includes('--write-catalog');
  if (writing && !row.source_variants) row.source_variants = [{
    implementation_sha256: row.implementation_sha256, implementation: row.implementation,
    overrides: [], program_sha256: row.program_sha256, verification: row.verification,
  }];
  const variant = { implementation_sha256: programHash(source), implementation: source,
    overrides: programOverrides(resolved.program, program), program_sha256: programHash(program),
    verification: { source_and_behavior: 'real_production_library_and_source_integration', origin: sourceAdaptation } };
  if (writing) {
    row.source_variants = row.source_variants.filter(item => item.implementation.runtime.mode !== 'production');
    row.source_variants.push(variant);
  } else {
    const saved = row.source_variants?.find(item => item.implementation_sha256 === variant.implementation_sha256);
    assert(saved, `missing_saved_production_variant:${spec.id}`);
    assert.equal(saved.program_sha256, variant.program_sha256, `saved_production_program_changed:${spec.id}`);
  }
  const bank = createLibraryProgramBank({ check: ({ implementation, program }) => checkCase(spec, implementation, program) });
  const admitted = await admitCatalogProgram({ skeleton, implementation, bank });
  assert.equal(admitted.status, 'admitted', `${spec.id}: ${JSON.stringify(admitted)}`);
  const integration = await integrationCheck(spec, implementation, program);
  assert(integration.passed, JSON.stringify(integration));
  const wrong = structuredClone(program);
  wrong.body = { op: 'literal', value: 'wrong production result' };
  const negative = await checkCase(spec, implementation, wrong);
  assert.equal(negative.status, 'rejected');
  checks.push({ case_id: spec.id, version, mode: source.runtime.mode, admitted: true,
    integration_passed: true, wrong_rule_rejected: true, source_adaptation: sourceAdaptation,
    source_sha256: variant.implementation_sha256, implementation_source: implementation.context.implementation });
}
if (process.argv.includes('--write-catalog')) fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2) + '\n');
const report = { passed: true, model_requests: 0, model_spend_usd: 0,
  scope: 'Eight exact React function/version production boundaries; renderer lifecycle execution is outside this gate.', checks };
fs.writeFileSync(path.join(directory, 'react-production-results.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
