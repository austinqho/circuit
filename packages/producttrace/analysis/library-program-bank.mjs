import {validateHostEventLayout} from './library-host-events.mjs';
import { createHash } from 'node:crypto';
import { validateLibraryProgram, requiresInvocationObservation } from './library-program.mjs';

export const programHash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** The host supplies the independent oracle once; a proposed rule cannot replace it. */
export function createLibraryProgramBank({ check }) {
  if (typeof check !== 'function') throw new TypeError('independent_checker_required');
  const entries = new Map();
  const verify = async ({ implementation, program, scope }) => {
      if (scope?.protocol !== undefined && !['owned_returned_reference','owned_call_boundary','host_event_boundary','react_state_queue'].includes(scope.protocol))
        return { status: 'rejected', stage: 'format', reason: 'unsupported_scope_protocol' };
      if (scope?.ownerGeneration !== undefined && (scope.ownerGeneration !== 'host' || scope.protocol !== 'owned_call_boundary'))
        return {status:'rejected',stage:'format',reason:'unsupported_owner_generation_scope'};
      if(scope?.protocol && scope.resultMethods?.length)return {status:'rejected',stage:'format',reason:'owned_protocol_result_methods_unsupported'};
      if (scope?.protocol && scope.returnedCallbackArguments?.length)
        return { status: 'rejected', stage: 'format', reason: 'owned_protocol_returned_callback_scope_unsupported' };
      if (scope?.protocol === 'owned_call_boundary' && (!Array.isArray(scope.callbackArguments) || scope.callbackArguments.some(index=>!Number.isInteger(index)||index<0||index>63) || scope.resultPaths !== null
        || scope.resultIdentityPaths?.length || scope.observationMode === 'references' || scope.nestedReferences))
        return { status: 'rejected', stage: 'format', reason: 'owned_value_scope_requires_complete_value_replay' };
      if(scope?.protocol==='host_event_boundary'&&(scope.hostProtocol!=='react_effect_lifecycle'||!['passive','layout','insertion'].includes(scope.hostPhase)
        ||!Array.isArray(scope.callbackArguments)||scope.resultPaths!==null||scope.resultIdentityPaths?.length||scope.observationMode==='references'||scope.nestedReferences))
        return {status:'rejected',stage:'format',reason:'host_event_scope_unsupported'};
      if(scope?.protocol==='host_event_boundary'){
        try {const layout=validateHostEventLayout(scope.eventLayout);if(JSON.stringify(layout.callbackArguments)!==JSON.stringify(scope.callbackArguments))throw Error('layout_callback_scope_mismatch');}
        catch(error){return {status:'rejected',stage:'format',reason:error.message};}
      }
      if(scope?.protocol==='react_state_queue'&&(!['useState','useReducer'].includes(scope.api)||scope.resultPaths!==null||scope.nestedReferences||scope.resultMethods?.length||scope.resultIdentityPaths?.length
        ||JSON.stringify(scope.callbackArguments)!==JSON.stringify(scope.api==='useState'?[0]:[0,2])))return {status:'rejected',stage:'format',reason:'state_scope_unsupported'};
      const format = validateLibraryProgram(program);
      if (!format.valid) return { status: 'rejected', stage: 'format', reason: format.errors[0] };
      if ((scope?.observationMode === 'references' || scope?.nestedReferences === true) && requiresInvocationObservation(program))
        return { status: 'rejected', stage: 'format', reason: 'reference_scope_cannot_predict_execution' };
      if (!implementation || !['ready_for_scoped_proposal', 'ready_for_catalog_recheck'].includes(implementation.context?.source_status)
        || typeof implementation.unchanged !== 'function' || !implementation.unchanged())
        return { status: 'rejected', stage: 'source', reason: 'implementation_not_attested' };
      const candidate = structuredClone(program), before = programHash(candidate), checkedScope = structuredClone(scope);
      const report = await check({ implementation, program: structuredClone(candidate), scope: structuredClone(checkedScope) });
      if (report.status !== 'passed') return { status: 'rejected', stage: report.stage || 'behavior', reason: report.reason, report };
      if (!implementation.unchanged()) return { status: 'rejected', stage: 'source', reason: 'implementation_changed_during_verification' };
      const context = implementation.context;
      const key = JSON.stringify([context.specifier, context.export_name]);
      const entry = { program: candidate, program_sha256: before, implementation,
        scope: checkedScope, report: structuredClone(report), id: `library-program:${programHash({ program: candidate, implementation: implementation.sha256, scope: checkedScope })}` };
      return { status: 'verified', entry, key };
  };
  const publicResult = (checked, status) => {
    if (checked.status !== 'verified') return checked;
    const entry = checked.entry;
    return {status,id:entry.id,program_sha256:entry.program_sha256,
      implementation_sha256:entry.implementation.sha256,scope:structuredClone(entry.scope),report:structuredClone(entry.report)};
  };
  return Object.freeze({
    /** Verification has no live-bank side effect. Compatibility checks may
     * compare candidates, but none becomes usable until explicit admission. */
    async verify(candidate) { return publicResult(await verify(candidate), 'verified'); },
    async admit(candidate) {
      const checked = await verify(candidate);
      if (checked.status !== 'verified') return checked;
      const {entry,key} = checked;
      const previous = entries.get(key);
      if (previous && previous.id !== entry.id) return { status: 'rejected', stage: 'bank', reason: 'ambiguous_verified_rule' };
      entries.set(key, entry);
      return publicResult(checked, 'admitted');
    },
    lookup(specifier, exportName) {
      const entry = entries.get(JSON.stringify([specifier, exportName]));
      if (!entry || !entry.implementation.unchanged()) return null;
      // No mutable bank answer is returned to the caller or proposer.
      return { id: entry.id, program: structuredClone(entry.program), scope: structuredClone(entry.scope),
        producer: entry.implementation.producer, program_sha256: entry.program_sha256,
        implementation_sha256: entry.implementation.sha256 };
    },
  });
}

/** Overrides replace existing instruction data only; they cannot add a host capability. */
export function resolveVersionedProgram(skeleton, version) {
  if (!skeleton || skeleton.schema !== 'producttrace.library-program-skeleton.v1'
    || !Array.isArray(skeleton.versions)) return { status: 'frontier', reason: 'skeleton_schema' };
  const matches = skeleton.versions.filter(row => row.version === version);
  if (matches.length !== 1) return { status: 'frontier', reason: matches.length ? 'ambiguous_version' : 'version_not_verified' };
  const selected = matches[0];
  if (selected.base_sha256 !== programHash(skeleton.program)) return { status: 'frontier', reason: 'skeleton_changed' };
  const program = structuredClone(skeleton.program);
  if (!Array.isArray(selected.overrides) || selected.overrides.length > 64) return { status: 'frontier', reason: 'override_shape' };
  for (const override of selected.overrides) {
    if (!override || Object.keys(override).sort().join(',') !== 'path,value' || !Array.isArray(override.path)
      || !override.path.length || override.path.length > 32
      || override.path.some(key => typeof key !== 'string' && !Number.isSafeInteger(key)
        || ['__proto__', 'prototype', 'constructor', 'schema'].includes(key))) return { status: 'frontier', reason: 'override_path' };
    let owner = program;
    for (const key of override.path.slice(0, -1)) {
      if (!owner || typeof owner !== 'object' || !Object.hasOwn(owner, key)) return { status: 'frontier', reason: 'override_target_missing' };
      owner = owner[key];
    }
    const key = override.path.at(-1);
    if (!owner || typeof owner !== 'object' || !Object.hasOwn(owner, key)) return { status: 'frontier', reason: 'override_target_missing' };
    owner[key] = structuredClone(override.value);
  }
  const format = validateLibraryProgram(program);
  if (!format.valid) return { status: 'frontier', reason: 'override_invalid_program', errors: format.errors };
  return { status: 'resolved_program', program, sha256: programHash(program),
    // Resolution is deliberately distinct from behavior or integration admission.
    verification: selected.verification ?? null };
}
