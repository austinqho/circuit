import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { CASES, DOMAINS } from './cases.mjs';
import { frozenFiles, integrationCheck } from './run.mjs';
import { checkCase } from './check-case.mjs';
import { readLibraryImplementation } from '../../authoring/library-implementation.mjs';
import { createLibraryProgramBank } from '../../analysis/library-program-bank.mjs';
import { resolveLibraryProgram } from '../../authoring/library-program-resolver.mjs';
import { createLibraryProgramVerifier } from '../../authoring/library-program-verifier.mjs';
import { createModelProvider } from '../../authoring/model-providers.mjs';
import { SpendLedger } from '../../authoring/spend-ledger.mjs';
import { checkOpenAIConnectivity } from '../../authoring/provider-connectivity.mjs';
import { requireLocalGate } from './local-gate.mjs';

// Exactly one explicit case per command. There is deliberately no broad-sweep
// paid mode. No key is printed or written to a report or a source context.
const directory = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(directory, '../..');
const spec = CASES.find(row => row.id === process.argv[2]);
if (!spec) throw new Error('one_frozen_case_id_required');
const localGate = requireLocalGate();
const freezeFiles = ['frozen.json', ...fs.readdirSync(directory).filter(file => /^frozen-extension-\d+\.json$/.test(file)).sort()];
const frozen = freezeFiles.map(file => JSON.parse(fs.readFileSync(path.join(directory,file)))).findLast(snapshot =>
  snapshot.cases.some(row => row.id === spec.id && isDeepStrictEqual(row.scope, DOMAINS[spec.profile])));
if (!frozen) throw new Error('case_and_independent_scope_must_be_frozen_before_spending');
const revisionsPath = path.join(directory, 'engine-revisions.json');
const revisions = fs.existsSync(revisionsPath) ? JSON.parse(fs.readFileSync(revisionsPath)) : [];
const activeEngine = revisions.at(-1)?.files ?? frozen.files;
const local = JSON.parse(fs.readFileSync(path.join(directory, 'offline-results.json')));
if (!local.passed) throw new Error('local_acceptance_required_before_spending');
for (const file of frozenFiles) {
  const hash = createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex');
  if (hash !== activeEngine[file] || hash !== local.engine[file]) throw new Error(`frozen_engine_changed:${file}`);
}
const implementation = readLibraryImplementation({ repository: path.join(directory, 'fixtures'), ...spec });
if (implementation.sha256 !== frozen.cases.find(row => row.id === spec.id)?.implementation_sha256) throw new Error('frozen_implementation_changed');
const stopPath = path.join(directory, 'paid-stop.json');
if (fs.existsSync(stopPath)) throw new Error('failed_batch_requires_local_diagnosis_and_regressions');
const connectivity = await checkOpenAIConnectivity();
if (!connectivity.ready) throw new Error(connectivity.reason);
const ledgerPath = process.env.TRACER_SHARED_SPEND_LEDGER;
if (!ledgerPath) throw new Error('existing_cumulative_spend_ledger_required');
const ledger = new SpendLedger(ledgerPath);
const model = process.env.TRACER_PROPOSAL_MODEL || 'gpt-5.4-mini';
if (!['gpt-5.4-mini', 'gpt-5.4'].includes(model)) throw new Error('unpriced_proposal_model');
const provider = ledger.wrap(createModelProvider({ provider: 'openai', model, reasoningEffort: 'low', apiKey: process.env.OPENAI_API_KEY }), `shared-rule:${spec.id}:${model}`);
const bank = createLibraryProgramBank({ check: createLibraryProgramVerifier({ scope: DOMAINS[spec.profile],
  behavior: ({ implementation, program }) => checkCase(spec, implementation, program),
  integration: async ({ implementation, program }) => {
    const result = await integrationCheck(spec, implementation, program);
    const failures = result.failures ?? result.reports?.flatMap(row => row.failures || []) ?? [];
    return { ...result, failures, status: result.passed ? 'passed' : 'rejected', reason: result.reason || failures[0]?.reason || (result.passed ? null : 'source_integration_failed') };
  },
}) });
const output = path.join(directory, `paid-${spec.id}-${Date.now()}.json`);
const attempts = [];
let previousProposal = null, resumedReport = null;
if (process.env.TRACER_RESUME_REPORT) {
  resumedReport = JSON.parse(fs.readFileSync(path.join(directory, path.basename(process.env.TRACER_RESUME_REPORT))));
  if (resumedReport.case_id !== spec.id || resumedReport.implementation_sha256 !== implementation.sha256)
    throw new Error('resume_case_or_implementation_mismatch');
  previousProposal = resumedReport.result.attempts.findLast(row => row.proposal?.status === 'propose')?.proposal;
  if (!previousProposal) throw new Error('resume_proposal_missing');
}
const resolution = await resolveLibraryProgram({ repository: path.join(directory, 'fixtures'), specifier: spec.specifier, exportName: spec.exportName,
  expectedImplementationSha256: implementation.sha256, mode: 'unfamiliar_only', scope: DOMAINS[spec.profile], bank, provider,
  previousProposal,
  onAttempt(attempt) {
    attempts.push(attempt);
    fs.writeFileSync(output, JSON.stringify({ status: 'running', case_id: spec.id, frozen, attempts }, null, 2) + '\n');
    console.log(JSON.stringify({ case: spec.id, attempt: attempt.number, status: attempt.check.status,
      reason: attempt.check.reason ?? null, cost_usd: attempt.cost_usd, latency_ms: attempt.latency_ms }));
  } });
const { implementation: resolvedImplementation, ...result } = resolution;
result.attempts ??= [];
const integration = result.admission?.report?.integration ?? null;
const passed = result.status === 'admitted' && integration?.passed === true;
const report = { schema: 'producttrace.shared-rule-paid.v1', case_id: spec.id, passed, frozen, active_engine: activeEngine, local_gate: localGate,
  model, reasoning_effort: 'low', resumed_from: resumedReport?.output ?? null,
  implementation_sha256: implementation.sha256, implementation: implementation.context,
  result, integration, output: path.basename(output) };
fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
if (result.reason !== 'spending_gate_closed') ledger.outcome(passed, result.reason || 'integration_failed');
if (!passed) fs.writeFileSync(stopPath, JSON.stringify({ failed_at: new Date().toISOString(), case_id: spec.id,
  report: path.basename(output), reason: result.reason || 'integration_failed' }, null, 2) + '\n');
console.log(JSON.stringify({ case: spec.id, passed, attempts: result.attempts.length, report: output }));
if (!passed) process.exitCode = 1;
