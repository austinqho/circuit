import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CASES, DOMAINS } from './cases.mjs';
import { checkCase } from './check-case.mjs';
import { integrationCheck } from './run.mjs';
import { readLibraryImplementation } from '../../authoring/library-implementation.mjs';
import { portableImplementation, programOverrides, admitCatalogProgram, libraryImportSubpath } from '../../authoring/library-program-catalog.mjs';
import { createLibraryProgramVerifier } from '../../authoring/library-program-verifier.mjs';
import { programHash, createLibraryProgramBank } from '../../analysis/library-program-bank.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const files = fs.readdirSync(directory).filter(file => /^paid-.*\.json$/.test(file) && file !== 'paid-stop.json');
const reports = files.map(file => JSON.parse(fs.readFileSync(path.join(directory, file))));
const groups = new Map(), checks = [];
const originalCases = new Set(JSON.parse(fs.readFileSync(path.join(directory, 'frozen.json'))).cases.map(row => row.id));
const extensionsOnly = process.argv.includes('--extensions-only');
const selectedCases = extensionsOnly ? CASES.filter(row => !originalCases.has(row.id))
  : process.argv.includes('--include-extensions') ? CASES : CASES.filter(row => originalCases.has(row.id));
for (const spec of selectedCases) {
  const report = reports.filter(row => row.case_id === spec.id && row.passed).sort((a, b) => a.output.localeCompare(b.output)).at(-1);
  if (!report) throw new Error(`missing_admitted_model_proposal:${spec.id}`);
  const implementation = readLibraryImplementation({ repository: path.join(directory, 'fixtures'), ...spec });
  const installedIdentity = context => programHash({ runtime: context.runtime, packages: context.packages,
    files: context.files, implementation: context.implementation });
  if (installedIdentity(implementation.context) !== installedIdentity(report.implementation))
    throw new Error(`installed_implementation_changed:${spec.id}`);
  // Source-reader fixes can add evidence without changing installed bytes.
  // Keep the original model report and explicitly record the richer context;
  // the saved proposal must still pass all current independent checks below.
  const sourceMetadataChanged = implementation.sha256 !== report.implementation_sha256;
  const program = report.result.program, source = portableImplementation(implementation.context);
  const subpath=libraryImportSubpath(spec.specifier);
  const key = `${source.runtime.entry.name}:${subpath}:${spec.exportName}`, version = source.runtime.entry.version;
  let skeleton = groups.get(key);
  if (!skeleton) {
    skeleton = { schema: 'producttrace.library-program-skeleton.v1', package: source.runtime.entry.name,
      export_name: spec.exportName, ...(subpath!=='.'?{import_subpath:subpath}:{}), scope: DOMAINS[spec.profile], program, versions: [] };
    groups.set(key, skeleton);
  }
  skeleton.versions.push({ version, base_sha256: programHash(skeleton.program), overrides: programOverrides(skeleton.program, program),
    program_sha256: programHash(program), implementation_sha256: programHash(source), implementation: source,
    verification: { model_report: report.output, model: report.model, source_and_behavior: 'rechecked_on_catalog_build' } });
  const bank = createLibraryProgramBank({ check: createLibraryProgramVerifier({ scope: DOMAINS[spec.profile],
    behavior: ({ implementation, program }) => checkCase(spec, implementation, program),
    integration: async ({ implementation, program }) => {
      const result = await integrationCheck(spec, implementation, program);
      return { ...result, status: result.passed ? 'passed' : 'rejected' };
    },
  }) });
  const admitted = await admitCatalogProgram({ skeleton, implementation, bank });
  const integration = admitted.report?.integration;
  if (admitted.status !== 'admitted' || !integration?.passed) throw new Error(`catalog_recheck_failed:${spec.id}:${admitted.reason}`);
  checks.push({ case_id: spec.id, admitted: admitted.status, integration_passed: integration.passed,
    model_report: report.output, override_count: skeleton.versions.at(-1).overrides.length,
    source_metadata_changed: sourceMetadataChanged, original_context_sha256: report.implementation_sha256,
    checked_context_sha256: implementation.sha256 });
}
const output = path.resolve(directory, extensionsOnly ? '../../authoring/banks/extension-library-programs.json' : '../../authoring/banks/initial-library-programs.json');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify({ schema: 'producttrace.library-program-catalog.v1',
  scope: 'Exact installed CJS versions and declared boundary domains; re-admission required before tracing. React descriptors do not imply renderer or lifecycle coverage.',
  skeletons: [...groups.values()] }, null, 2) + '\n');
const attempts = reports.flatMap(row => row.result?.attempts || []);
const report = { passed: true, skeletons: groups.size, exact_function_versions: checks.length,
  completed_at: new Date().toISOString(), checks,
  model_requests: attempts.length, known_reported_model_cost_usd: attempts.reduce((sum, row) => sum + (row.cost_usd || 0), 0),
  unknown_charges: 'See the cumulative ledger; missing report cost is not treated as free.',
  recheck_model_requests: 0 };
fs.writeFileSync(path.join(directory, extensionsOnly ? 'extension-catalog-results.json' : 'catalog-results.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
