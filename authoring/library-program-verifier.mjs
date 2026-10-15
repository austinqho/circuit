import { isDeepStrictEqual } from 'node:util';
import { validateLibraryProgram } from '../analysis/library-program.mjs';

/** Compose checker-owned gates before a candidate enters the live bank.
 * Integration may use a private provisional bank to exercise the source
 * adapter. That probe bank must not be exposed as the application's bank.
 * The proposing model receives failures, never these callbacks or fixtures. */
export function createLibraryProgramVerifier({ scope, behavior, integration }) {
  if (typeof behavior !== 'function' || typeof integration !== 'function') throw new TypeError('independent_behavior_and_integration_required');
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) throw new TypeError('independent_scope_required');
  const checkedScope = structuredClone(scope);
  return async candidate => {
    const format = validateLibraryProgram(candidate.program);
    if (!format.valid) return { status: 'rejected', stage: 'format', reason: format.errors[0] };
    if (!isDeepStrictEqual(candidate.scope, checkedScope))
      return { status: 'frontier', stage: 'checker', reason: 'checker_failure', detail: { gate: 'scope', message: 'independent_scope_mismatch' } };
    const reports = {};
    for (const [stage, check] of [['behavior', behavior], ['integration', integration]]) {
      if (!candidate.implementation.unchanged()) return { status: 'rejected', stage: 'source', reason: 'implementation_changed_during_verification' };
      let result;
      try { result = await check(candidate); }
      catch (error) { return { status: 'frontier', stage: 'checker', reason: 'checker_failure', detail: { gate: stage, message: String(error.message).slice(0, 300) } }; }
      if (!result || !['passed', 'rejected', 'frontier'].includes(result.status))
        return { status: 'frontier', stage: 'checker', reason: 'checker_failure', detail: { gate: stage, message: 'checker_report_shape' } };
      if (result.status !== 'passed') return { ...result, stage };
      reports[stage] = result;
    }
    if (!candidate.implementation.unchanged()) return { status: 'rejected', stage: 'source', reason: 'implementation_changed_during_verification' };
    return { status: 'passed', stage: 'behavior_and_integration', ...reports };
  };
}
