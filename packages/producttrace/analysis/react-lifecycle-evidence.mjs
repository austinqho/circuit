import {createReactWrapperEvidenceSession} from './react-wrapper-evidence.mjs';
import {validateReactExecutionRule,planContextBinding} from './react-execution-rule.mjs';
import {createReactContextEvidenceSession} from './react-context-evidence.mjs';
const SCHEMA = 'producttrace.react-lifecycle-observation.v1';
const JOIN_SCHEMA = 'producttrace.react-lifecycle-join.v1';
const SESSION_SCHEMA = 'producttrace.react-lifecycle-session.v1';
const OPERATIONS = new Set([
  'render_attempted', 'render_committed', 'render_abandoned',
  'callback_invoked', 'cleanup_invoked', 'callback_created', 'callback_selected', 'shared_callback_selected',
  'callback_completed','cleanup_completed',
  'value_read', 'value_written', 'value_produced', 'value_selected', 'memo_callback_invoked', 'work_scheduled',
  'hydration_replayed_event', 'error_observed', 'unmounted',
  'state_read','state_requested','state_updater_invoked','state_calculated','state_calculation_failed','state_committed',
  'wrapper_callback_invoked','wrapper_callback_completed','context_value_used',
  'deferred_selected','deferred_used','transition_result','transition_pending_used','id_read','id_used','handle_produced','store_listener_invoked','store_cleanup_invoked','store_snapshot_observed',
]);

const nonempty = value => typeof value === 'string' && value.length > 0;
const copy = value => JSON.parse(JSON.stringify(value));
const validEncodedValue = value => value && ['primitive', 'opaque_identity', 'redacted'].includes(value.encoding)
  && (value.encoding !== 'primitive' || ['string', 'number', 'boolean'].includes(typeof value.value)
    || value.value === null);

function requireMap(map) {
  if (!map || map.schema !== 'producttrace.react-map.v1' || !nonempty(map.fingerprint)
      || !Array.isArray(map.react_semantics)) {
    throw new TypeError('Expected a producttrace.react-map.v1 source map with React semantics');
  }
}

function unresolved(map, record, reason) {
  return {
    schema: JOIN_SCHEMA,
    status: 'unresolved',
    reason,
    claim: 'runtime_observation_rejected',
    runtime_observed: false,
    map_fingerprint: map.fingerprint,
    observation_id: nonempty(record?.observation_id) ? record.observation_id : null,
    source: null,
    runtime: null,
  };
}

function callbackSlot(record, source, protocol) {
  const slots = protocol
    ? source.behavior?.members?.[protocol.member]?.callbacks || []
    : source.causal_bindings?.callbacks || [];
  if (!nonempty(record.callback_slot)) return null;
  const slot = slots.find(value => value.slot === record.callback_slot);
  if (!slot) return null;
  if(slot.dynamic_source){
    const choices=slot.candidates?.filter(value=>value.source_id===record.callback_source_id)||[];
    return choices.length===1?{...slot,...choices[0]}:null;
  }
  const binding = protocol?.callback_bindings?.find(value => value.slot === slot.slot);
  return {...slot, ...(binding ? {source_id:binding.source_id} : {})};
}

function mountedIdentity(record) {
  return ['root_id', 'instance_id', 'mount_id'].every(key => nonempty(record[key]));
}

function supportsOperation(source, protocol, operation, hookOwned) {
  const behavior = protocol ? source.behavior?.members?.[protocol.member] : source.behavior;
  const populated = value => Array.isArray(value) ? value.length > 0
    : typeof value === 'string' ? value.length > 0 : Boolean(value);
  if(['callback_completed','cleanup_completed'].includes(operation))return validateReactExecutionRule(behavior?.execution).valid
    && behavior.execution.kind==='commit_effect';
  if (operation === 'context_value_used') return validateReactExecutionRule(behavior?.execution).valid
    && ['retained_callback','commit_effect','memo_value','imperative_handle'].includes(behavior.execution.kind);
  if(operation==='shared_callback_selected')return validateReactExecutionRule(behavior?.execution).valid && behavior.execution.kind==='retained_callback';
  if(['wrapper_callback_invoked','wrapper_callback_completed'].includes(operation))return validateReactExecutionRule(behavior?.execution).valid && behavior.execution.kind==='component_wrapper';
  if(operation.startsWith('deferred_'))return validateReactExecutionRule(behavior?.execution).valid && behavior.execution.kind==='deferred_value';
  if (operation==='transition_result' || operation==='transition_pending_used') return validateReactExecutionRule(behavior?.execution).valid && behavior.execution.kind==='transition_hook';
  if (operation==='id_read' || operation==='id_used') return validateReactExecutionRule(behavior?.execution).valid && behavior.execution.kind==='id_allocation';
  if (operation.startsWith('store_')) return validateReactExecutionRule(behavior?.execution).valid && behavior.execution.kind==='external_store';
  if (operation==='handle_produced') return validateReactExecutionRule(behavior?.execution).valid
    && behavior.execution.kind==='imperative_handle';
  if (['value_produced','value_selected','memo_callback_invoked'].includes(operation)) return validateReactExecutionRule(behavior?.execution).valid
    && (behavior.execution.kind === 'memo_value' || operation==='value_produced' && behavior.execution.kind==='state_queue');
  if(operation.startsWith('state_'))return validateReactExecutionRule(behavior?.execution).valid && behavior.execution.kind==='state_queue';
  if (operation === 'value_read') return populated(behavior?.reads);
  if (operation === 'value_written') return populated(behavior?.writes);
  if (operation === 'work_scheduled') return populated(behavior?.scheduling || behavior?.schedules);
  if (operation === 'hydration_replayed_event') return source.export === 'hydrateRoot';
  if (operation === 'error_observed') return /error/u.test(JSON.stringify(behavior || {}));
  if (operation === 'unmounted') return hookOwned
    || validateReactExecutionRule(behavior?.execution).valid && behavior.execution.kind==='component_wrapper' && Boolean(source.causal_bindings?.wrapper_render?.source_id)
    || ['Component','PureComponent'].includes(source.export)
    || ['unmount','Consumer','Provider'].includes(protocol?.member)
    || /unmount/u.test(JSON.stringify(behavior || {}));
  if (operation.startsWith('render_')) return hookOwned
    || ['Component','PureComponent','createRoot','hydrateRoot'].includes(source.export)
    || (behavior?.callbacks || []).some(callback => /render/u.test(callback.phase || ''));
  if (['callback_created','callback_selected'].includes(operation)) {
    return (behavior?.callbacks || []).some(slot => slot.retained === true);
  }
  return operation === 'callback_invoked' || operation === 'cleanup_invoked';
}

/**
 * Consume occurrence-specific React observations without promoting a source
 * contract, lifecycle plan, or source offset into execution evidence.
 */
export function createReactLifecycleEvidenceSession(map, {wrapperEntries=[],resolveCallbackSource=()=>null}={}) {
  requireMap(map);
  const sourceByOccurrence = new Map(map.react_semantics.map(source => [
    `${source.call_id}\0${source.semantic_id}`, source,
  ]));
  const protocols = Array.isArray(map.react_protocols) ? map.react_protocols : [];
  const observations = new Map();
  const renders = new Map();
  const mounts = new Map();
  const hooks = new Map();
  const invocations = new Map();
  const callbackIdentities = new Map();
  const callbackSelections=new Map(),sharedCallbackSelections=new Map();
  const valueProductions = new Map();
  const valueProductionInvocations = new Set();
  const stateIdentities=new Map(),stateRequests=new Map(),stateInvocations=new Map(),stateReads=new Map();
  let stateRequestOrder=0;
  const contextEvidence=createReactContextEvidenceSession(map);
  const wrapperEvidence=createReactWrapperEvidenceSession(map,wrapperEntries);
  const handleProductions=new Set();
  const idReads=new Map(),transitionResults=new Map(),deferredSelections=new Map();
  const storeResults=new Set(),storeCleanups=new Set();
  const pendingRenderReplacements=new Map();

  function join(record) {
    if (!record || record.schema !== SCHEMA || record.kind !== 'react_lifecycle') {
      return unresolved(map, record, 'invalid_observation_schema');
    }
    if (record.map_fingerprint !== map.fingerprint) return unresolved(map, record, 'map_fingerprint_mismatch');
    if (!nonempty(record.observation_id) || !nonempty(record.occurrence_id)) {
      return unresolved(map, record, 'runtime_occurrence_required');
    }
    if (!Array.isArray(record.evidence_ids) || record.evidence_ids.length === 0
        || record.evidence_ids.some(id => !nonempty(id))) {
      return unresolved(map, record, 'runtime_evidence_required');
    }
    if (observations.has(record.observation_id)) return unresolved(map, record, 'duplicate_observation_id');
    if (!OPERATIONS.has(record.operation)) return unresolved(map, record, 'unsupported_lifecycle_operation');
    if (!nonempty(record.source_call_id) || !nonempty(record.semantic_id)) {
      return unresolved(map, record, 'source_occurrence_required');
    }
    const source = sourceByOccurrence.get(`${record.source_call_id}\0${record.semantic_id}`);
    if (!source) return unresolved(map, record, 'source_occurrence_mismatch');
    if (source.version !== '18.3.1' || !nonempty(source.package_verification_sha256)) {
      return unresolved(map, record, 'source_attestation_required');
    }
    if (!mountedIdentity(record) || !nonempty(record.render_id)) {
      return unresolved(map, record, 'mounted_render_identity_required');
    }
    const sourceOwner=source.causal_bindings?.owner_source_id || source.causal_bindings?.wrapper_render?.source_id;
    if (sourceOwner && record.owner_source_id !== sourceOwner) {
      return unresolved(map, record, 'owner_source_mismatch');
    }
    const hookOwned = source.behavior?.owner?.includes('hook ordinal') === true;
    if (hookOwned && !nonempty(record.hook_slot_id)) {
      return unresolved(map, record, 'hook_slot_identity_required');
    }
    let protocol = null;
    let acceptedStateCommitRequests=[];
    if (record.protocol_member !== undefined || record.source_member_call_id !== undefined) {
      if (!nonempty(record.protocol_member) || !nonempty(record.source_member_call_id)) {
        return unresolved(map, record, 'protocol_source_occurrence_required');
      }
      const matches = protocols.filter(value => value.semantic_application_id === source.id
        && value.producer_call_id === source.call_id && value.member_call_id === record.source_member_call_id
        && value.member === record.protocol_member);
      if (matches.length !== 1) return unresolved(map, record, 'protocol_source_occurrence_mismatch');
      protocol = matches[0];
    }
    if (!supportsOperation(source, protocol, record.operation, hookOwned)) {
      return unresolved(map, record, 'operation_not_supported_by_source_contract');
    }
    // Check construction before caching any render or invocation state. A caller
    // using this session directly must supply and replay the same origin evidence.
    const wrapper=record.operation==='wrapper_callback_invoked'?wrapperEvidence.checkCallback(record):null;
    if(wrapper && wrapper.status!=='resolved')return unresolved(map,record,wrapper.reason);
    const contextOperation = record.operation === 'value_read'
      || record.operation === 'callback_invoked' && protocol?.member === 'Consumer';
    const sourceContextId = protocol?.context_id || source.causal_bindings?.context_id || null;
    let contextProviderEvidence = null;
    let contextRuleSelection = null;
    if (contextOperation && sourceContextId) {
      const rule=source.behavior?.execution;
      if(!validateReactExecutionRule(rule).valid || rule.kind!=='context_binding')return unresolved(map,record,'context_executable_rule_required');
      if (record.context_id !== sourceContextId || !validEncodedValue(record.context_value)) {
        return unresolved(map, record, 'context_identity_or_value_required');
      }
      if (record.context_default_used === true) {
        if (record.provider_protocol_application_id != null
            || record.provider_source_member_call_id != null || record.provider_value != null) {
          return unresolved(map, record, 'context_default_provider_contamination');
        }
        if (record.context_provider_status != null && record.context_provider_status !== 'default'
            || record.context_provider_unresolved_reason != null) {
          return unresolved(map, record, 'context_default_provider_contamination');
        }
        contextProviderEvidence = {status:'default',reason:null};
      } else if (record.context_default_used === false) {
        const providerMatches = protocols.filter(value => value.member === 'Provider'
          && value.context_id === sourceContextId
          && value.id === record.provider_protocol_application_id
          && value.member_call_id === record.provider_source_member_call_id);
        const explicitlyUnresolved = record.context_provider_status === 'source_unresolved'
          && record.context_provider_unresolved_reason === 'provider_source_uninstrumented'
          && record.provider_protocol_application_id == null
          && record.provider_source_member_call_id == null
          && validEncodedValue(record.provider_value);
        if (providerMatches.length !== 1 && !explicitlyUnresolved
            || providerMatches.length === 1 && !validEncodedValue(record.provider_value)) {
          return unresolved(map, record, 'context_provider_occurrence_mismatch');
        }
        if (providerMatches.length === 1
            && record.context_provider_status != null
            && record.context_provider_status !== 'source_resolved') {
          return unresolved(map, record, 'context_provider_occurrence_mismatch');
        }
        if (providerMatches.length === 1 && record.context_provider_unresolved_reason != null) {
          return unresolved(map, record, 'context_provider_occurrence_mismatch');
        }
        if (providerMatches.length === 1
            && record.context_value.encoding === 'primitive' && record.provider_value.encoding === 'primitive'
            && !Object.is(record.context_value.value, record.provider_value.value)) {
          return unresolved(map, record, 'context_provider_value_mismatch');
        }
        contextProviderEvidence = providerMatches.length === 1
          ? {status:'source_resolved',reason:null,
            protocol_application_id:record.provider_protocol_application_id,
            source_member_call_id:record.provider_source_member_call_id}
          : {status:'source_unresolved',reason:record.context_provider_unresolved_reason};
      } else return unresolved(map, record, record.context_provider_status==='unresolved'
        && ['provider_ancestry_unobserved','provider_ancestry_limit'].includes(record.context_provider_unresolved_reason)
        ?'context_ancestry_incomplete':'context_provider_status_required');
      const plan=planContextBinding(rule,{member:protocol?.member,requestedContext:sourceContextId,
        providers:record.context_default_used?[]:[{context:sourceContextId,value:record.provider_value}],
        chainComplete:record.context_default_used===true});
      if(plan.status!=='planned' || !['read_default','read_provider'].includes(plan.operation))return unresolved(map,record,'context_rule_selection_unresolved');
      contextRuleSelection={operation:plan.operation,selection_evidence:'observed_nearest_provider_search',
        default_value_proven:false,object_value_identity_proven:false,notification_causality_proven:false};
      if(record.context_value_proof) {
        const valueProof=contextEvidence.joinRead(record.context_value_proof,{session:record.session,sourceContextId,
          defaultUsed:record.context_default_used,observedValue:record.context_value,providerValue:record.provider_value});
        if(valueProof.status!=='resolved')return unresolved(map,record,valueProof.reason);
        Object.assign(contextRuleSelection,valueProof);
      }
    } else if (record.context_id !== undefined) {
      return unresolved(map, record, 'unexpected_context_evidence');
    }
    // React root/instance/render counters restart for each instrumented document. Keep
    // lifecycle state occurrence-specific across reloads instead of conflating two
    // browser recording sessions that happen to reuse the same local counters.
    const runtimeSession = nonempty(record.session) ? record.session : 'legacy-session';
    const mountKey = `${runtimeSession}\0${record.root_id}\0${record.instance_id}\0${record.mount_id}`;
    const renderKey = `${mountKey}\0${record.render_id}`;
    if(record.render_position_id!==undefined&&(!nonempty(record.render_position_id)
      ||nonempty(record.session)&&!record.render_position_id.startsWith(record.session+':')))
      return unresolved(map,record,'render_position_identity_required');
    const positionKey=nonempty(record.render_position_id)
      ?`${runtimeSession}\0${record.owner_source_id||record.source_call_id}\0${record.render_position_id}`:mountKey;
    const replacementOwner=record.owner_source_id||record.source_call_id;
    const replacementKey=`${runtimeSession}\0${replacementOwner}\0${record.render_id}`;
    const expectedReplacements=pendingRenderReplacements.get(replacementKey)||[];
    if(record.operation==='render_abandoned'
      &&(record.replacement_render_id!==undefined||record.abandonment_cause!==undefined)){
      if(!nonempty(record.replacement_render_id)||record.replacement_render_id===record.render_id
        ||record.abandonment_cause!=='superseded_by_render_attempt')
        return unresolved(map,record,'render_replacement_identity_required');
    }
    if(record.operation==='render_attempted'){
      const supplied=record.replaces_render_ids;
      if((supplied!==undefined||expectedReplacements.length)
        &&(!Array.isArray(supplied)||supplied.length===0||new Set(supplied).size!==supplied.length
          ||supplied.some(value=>!nonempty(value)||value===record.render_id)
          ||JSON.stringify([...supplied].sort())!==JSON.stringify(expectedReplacements.map(value=>value.render_id).sort())
          ||expectedReplacements.some(value=>value.render_position_id!==record.render_position_id
            &&!(value.suspense_origin&&value.suspense_origin===record.suspense_boundary?.origin_observation_id
              &&value.suspense_input===record.suspense_boundary?.input_identity))))
        return unresolved(map,record,'render_supersession_evidence_mismatch');
    }else if(record.replaces_render_ids!==undefined){
      return unresolved(map,record,'unexpected_render_supersession_evidence');
    }
    let hookKey = null, hookSourceIdentity = null;
    if (hookOwned) {
      hookKey = `${mountKey}\0${record.hook_slot_id}`;
      hookSourceIdentity = `${source.call_id}\0${source.semantic_id}`;
      if (hooks.has(hookKey) && hooks.get(hookKey) !== hookSourceIdentity) {
        return unresolved(map, record, 'hook_slot_source_mismatch');
      }
    }
    const mount = mounts.get(mountKey);
    const retainedInvocation = record.operation === 'memo_callback_invoked' || ['callback_invoked','context_value_used'].includes(record.operation)
      && callbackSlot(record, source, protocol)?.retained === true;
    // A JavaScript callback can escape a render and run after abandonment or
    // unmount. Its invocation is real; that does not revive a component commit.
    if (mount?.unmounted && record.operation !== 'unmounted' && !retainedInvocation && !['state_requested','state_updater_invoked','state_calculated'].includes(record.operation)) {
      return unresolved(map, record, 'mount_already_unmounted');
    }
    const priorRender = renders.get(renderKey);
    if (record.operation === 'render_attempted' && priorRender) {
      return unresolved(map, record, 'duplicate_render_identity');
    }
    if (record.operation === 'render_committed'
        && (!priorRender || priorRender.status !== 'attempted')) {
      return unresolved(map, record, 'render_attempt_required');
    }
    if (record.operation === 'render_abandoned'
        && (!priorRender || priorRender.status !== 'attempted')) {
      return unresolved(map, record, 'abandonable_render_required');
    }
    if (record.operation === 'unmounted' && (!mount || mount.unmounted)) {
      return unresolved(map, record, 'active_mount_required');
    }

    if(wrapper && (!priorRender || priorRender.status==='abandoned'))return unresolved(map,record,'wrapper_render_attempt_required');
    if(wrapper && invocations.has(record.invocation_id))return unresolved(map,record,'duplicate_wrapper_invocation');

    let wrapperOutcome=null;
    if(record.operation==='wrapper_callback_completed') {
      const parent=invocations.get(record.caused_by_invocation_id);
      if(!parent || parent.operation!=='wrapper_callback_invoked' || parent.render_key!==renderKey
        || parent.source_call_id!==record.source_call_id || parent.manifest_key!==record.manifest_key)
        return unresolved(map,record,'wrapper_outcome_invocation_required');
      if(parent.wrapper_completed)return unresolved(map,record,'duplicate_wrapper_outcome');
      const checked=wrapperEvidence.checkOutcome(record,parent.wrapper);
      if(checked.status!=='resolved')return unresolved(map,record,checked.reason);
      wrapperOutcome=checked.runtime;
    }

    if(record.operation==='shared_callback_selected') {
      const binding=callbackSlot(record,source,protocol);
      if(!binding?.retained || !(binding.shared_body || binding.named_body) || binding.source_id!==record.callback_source_id)
        return unresolved(map,record,'shared_callback_source_mismatch');
      if(!nonempty(record.session) || !nonempty(record.callback_identity_id)
        || !record.callback_identity_id.startsWith(record.session+':') || record.callback_identity_id===record.session+':'
        || !record.observation_id.startsWith(record.session+':') || record.occurrence_id!==record.observation_id+':occurrence'
        || !record.evidence_ids.includes(record.observation_id) || record.runtime_observed!==true)
        return unresolved(map,record,'shared_callback_identity_required');
      if(!priorRender || priorRender.status==='abandoned')return unresolved(map,record,'shared_callback_render_required');
      if(sharedCallbackSelections.has(`${renderKey}\0${record.source_call_id}\0${record.hook_slot_id}`))
        return unresolved(map,record,'duplicate_shared_callback_selection');
    }

    const retainedOperation = ['callback_created','callback_selected'].includes(record.operation);
    const identityKey = `${runtimeSession}\0${record.callback_identity_id}`;
    if (retainedOperation || ['callback_invoked','context_value_used'].includes(record.operation)
        && (record.callback_identity_id !== undefined || callbackSlot(record, source, protocol)?.retained)) {
      const binding = callbackSlot(record, source, protocol);
      if (!binding?.retained || !nonempty(binding.source_id)
          || binding.source_id !== record.callback_source_id) return unresolved(map, record, 'retained_callback_source_mismatch');
      if (!nonempty(record.callback_identity_id)) return unresolved(map, record, 'callback_identity_required');
      if (!priorRender) return unresolved(map, record, 'callback_render_identity_unobserved');
      const origin = callbackIdentities.get(identityKey);
      if (record.operation === 'callback_created') {
        if (origin) return unresolved(map, record, 'duplicate_callback_identity');
      } else {
        if (!origin || origin.mount_key !== mountKey || origin.source_call_id !== record.source_call_id
            || origin.hook_slot_id !== record.hook_slot_id) return unresolved(map, record, 'callback_identity_lineage_mismatch');
        if (record.operation === 'callback_selected' && origin.render_id !== record.origin_render_id
            || ['callback_invoked','context_value_used'].includes(record.operation) && origin.render_id !== record.render_id) {
          return unresolved(map, record, 'callback_origin_render_mismatch');
        }
      }
    }

    let slot = retainedOperation || ['context_value_used','handle_produced','callback_completed','cleanup_completed'].includes(record.operation) ? callbackSlot(record, source, protocol) : null;
    let effectOutcome=null;
    if(['callback_completed','cleanup_completed'].includes(record.operation)){
      if(record.invocation_id!==undefined||!nonempty(record.session)||!record.observation_id.startsWith(record.session+':')
        ||record.occurrence_id!==record.observation_id+':occurrence'||!record.evidence_ids.includes(record.observation_id)
        ||record.runtime_observed!==true)return unresolved(map,record,'effect_outcome_receipt_required');
      const parent=invocations.get(record.caused_by_invocation_id);
      const expected=record.operation==='cleanup_completed'?'cleanup_invoked':'callback_invoked';
      if(!parent||parent.operation!==expected||parent.render_key!==renderKey||parent.source_call_id!==source.call_id
        ||parent.hook_slot_id!==record.hook_slot_id||parent.callback_slot!==record.callback_slot
        ||!slot?.source_id||slot.source_id!==record.callback_source_id)return unresolved(map,record,'effect_outcome_invocation_required');
      if(parent.effect_outcome)return unresolved(map,record,'duplicate_effect_outcome');
      if(!['returned','threw'].includes(record.outcome)||!validEncodedValue(record.value)
        ||!['undefined','null','boolean','string','number','bigint','symbol','object','function'].includes(record.value_kind)
        ||!nonempty(record.value_id)||!record.value_id.startsWith(runtimeSession+':')||record.value_id===runtimeSession+':')
        return unresolved(map,record,'effect_outcome_value_required');
      if(record.value.encoding==='primitive'&&(record.value_kind==='null'?record.value.value!==null
        :!['boolean','string','number'].includes(record.value_kind)||typeof record.value.value!==record.value_kind))
        return unresolved(map,record,'effect_outcome_value_mismatch');
      effectOutcome={claim:'observed_effect_callback_outcome',invocation_id:record.caused_by_invocation_id,
        outcome:record.outcome,value_id:record.value_id,value:copy(record.value),value_kind:record.value_kind,
        cleanup_returned:expected==='callback_invoked'&&record.outcome==='returned'&&record.value_kind==='function',
        asynchronous_completion_proven:false,downstream_effect_proven:false};
    }
    let handleFactory=null,externalStore=null,storeCallbackInput=null,idProof=null,transitionProof=null,deferredProof=null;
    if(record.operation==='deferred_selected' || record.operation==='deferred_used') {
      if(!priorRender || priorRender.status==='abandoned' || !validEncodedValue(record.value)
        || !nonempty(record.value_id) || !record.value_id.startsWith(`${runtimeSession}:`))return unresolved(map,record,'deferred_value_required');
      if(record.operation==='deferred_selected') {
        const previous=deferredSelections.get(record.previous_observation_id);
        const latest=[...deferredSelections.values()].findLast(row=>row.hook_key===hookKey && row.render_key!==renderKey && renders.get(row.render_key)?.status==='committed');
        if(!validEncodedValue(record.input_value) || !nonempty(record.input_value_id) || !record.input_value_id.startsWith(`${runtimeSession}:`)
          || typeof record.matches_input!=='boolean' || typeof record.matches_previous!=='boolean')return unresolved(map,record,'deferred_input_required');
        if(record.previous_observation_id && (!previous || previous.hook_key!==hookKey || previous!==latest || renders.get(previous.render_key)?.status!=='committed'))return unresolved(map,record,'deferred_previous_unobserved');
        if(record.matches_input && JSON.stringify(record.value)!==JSON.stringify(record.input_value)
          || record.matches_previous && previous && JSON.stringify(record.value)!==JSON.stringify(previous.value)
          || record.matches_input!==(record.value_id===record.input_value_id)
          || record.matches_previous!==Boolean(previous && previous.value_id===record.value_id))return unresolved(map,record,'deferred_selection_identity_mismatch');
        if(!record.matches_input && !record.matches_previous)return unresolved(map,record,'deferred_selection_unproven');
        deferredProof={claim:'observed_deferred_selection',selection:record.matches_input?(record.matches_previous?'input_and_previous':'input'):'previous',
          previous_observation_id:record.previous_observation_id||null,render_urgency_proven:false,update_commit_attribution_proven:false};
      } else {
        const origin=deferredSelections.get(record.origin_observation_id);
        if(!origin || origin.hook_key!==hookKey || origin.render_key!==renderKey || origin.value_id!==record.value_id
          || JSON.stringify(record.value)!==JSON.stringify(origin.value) || record.matches_selected!==true || !source.causal_bindings.deferred_reads?.some(row=>row.read_id===record.read_source_id))return unresolved(map,record,'deferred_use_origin_mismatch');
        deferredProof={claim:'observed_deferred_jsx_read',origin_observation_id:record.origin_observation_id,read_source_id:record.read_source_id,host_commit_proven:false};
      }
    }
    if(record.operation==='transition_pending_used') {
      const origin=transitionResults.get(record.origin_observation_id);
      const read=source.causal_bindings.pending_branch_reads?.find(row=>row.read_id===record.read_source_id);
      if(!origin || origin.hook_key!==hookKey || origin.render_key!==renderKey || !read
        || typeof record.transition_pending!=='boolean' || record.transition_pending!==origin.pending
        || record.transition_pending_matches!==true)return unresolved(map,record,'transition_pending_origin_mismatch');
      transitionProof={claim:'observed_pending_branch_selection',origin_observation_id:record.origin_observation_id,
        read_source_id:record.read_source_id,pending:record.transition_pending,
        selected_source_id:record.transition_pending?read.truthy_source_id:read.falsy_source_id,
        selected_branch_execution_proven:false,host_commit_proven:false,update_commit_attribution_proven:false};
    }
    if(record.operation==='transition_result') {
      if(!priorRender || priorRender.status==='abandoned' || typeof record.transition_pending!=='boolean'
        || !nonempty(record.start_identity_id) || !record.start_identity_id.startsWith(`${runtimeSession}:`))return unresolved(map,record,'transition_result_required');
      const previous=[...transitionResults.values()].findLast(row=>row.hook_key===hookKey && renders.get(row.render_key)?.status==='committed');
      if(previous && source.behavior.execution.retain_start && previous.start_identity_id!==record.start_identity_id)return unresolved(map,record,'transition_start_changed_within_mount');
      transitionProof={claim:'observed_transition_tuple',start_identity_id:record.start_identity_id,pending:record.transition_pending,
        retained_from:previous?.observation_id||null,update_commit_attribution_proven:false};
    }
    if(record.operation==='id_read' || record.operation==='id_used') {
      if(!priorRender || priorRender.status==='abandoned' || !validEncodedValue(record.id_value)
        || record.id_value.encoding!=='primitive' || typeof record.id_value.value!=='string')return unresolved(map,record,'id_value_required');
      if(record.operation==='id_read') {
        const previous=[...idReads.values()].findLast(row=>row.hook_key===hookKey && renders.get(row.render_key)?.status==='committed');
        if(previous && previous.value!==record.id_value.value)return unresolved(map,record,'id_changed_within_mount');
        idProof={claim:'observed_hook_id',value:record.id_value.value,
          retained_from:previous?.observation_id||null,allocation_position_proven:false,entity_identity_proven:false};
      } else {
        const origin=idReads.get(record.id_read_observation_id);
        const site=source.causal_bindings.id_property_reads?.find(row=>row.read_id===record.id_read_source_id && row.property===record.id_property);
        if(!site || !origin || origin.hook_key!==hookKey || origin.render_key!==renderKey
          || origin.value!==record.id_value.value || record.id_value_matches!==true)return unresolved(map,record,'id_property_origin_mismatch');
        idProof={claim:'observed_jsx_id_property',value:origin.value,property:record.id_property,
          read_source_id:record.id_read_source_id,origin_observation_id:origin.observation_id,host_commit_proven:false,entity_identity_proven:false};
      }
    }
    if(record.operation==='callback_invoked' && source.behavior?.execution?.kind==='external_store') {
      const packet=record.store_callback_origin;
      if(packet!=null) {
        const origin=callbackIdentities.get(`${runtimeSession}\0${packet.callback_identity_id}`);
        const producer=sourceByOccurrence.get(`${packet.producer_source_call_id}\0react/useCallback/18.3.1`);
        const producerCallback=producer?.causal_bindings?.callbacks?.find(row=>row.slot==='arguments.0');
        const consumerCallback=callbackSlot(record,source,protocol);
        if(!origin || origin.mount_key!==mountKey || origin.source_call_id!==packet.producer_source_call_id
          || origin.render_id!==packet.origin_render_id || origin.hook_slot_id!==packet.producer_hook_slot_id
          || !producerCallback?.source_id || consumerCallback?.retained_producer_call_id!==packet.producer_source_call_id
          || callbackSelections.get(`${renderKey}\0${packet.producer_source_call_id}\0${packet.producer_hook_slot_id}`)!==packet.callback_identity_id)
          return unresolved(map,record,'store_retained_callback_selection_required');
        storeCallbackInput={status:'resolved',claim:'observed_retained_callback_input',...copy(packet),function_source_id:producerCallback.source_id,selection_render_id:record.render_id};
      } else storeCallbackInput={status:'unobserved',reason:'retained_callback_input_unobserved'};
    }
    if(record.operation.startsWith('store_')) {
      const rule=source.behavior.execution;
      slot=callbackSlot(record,source,protocol);
      const parent=invocations.get(record.caused_by_invocation_id);
      if(!priorRender || !slot || record.callback_source_id!==slot.source_id || !parent
        || parent.operation!=='callback_invoked' || parent.mount_key!==mountKey || parent.render_key!==renderKey
        || parent.source_call_id!==source.call_id || parent.callback_slot!==record.callback_slot
        || parent.hook_slot_id!==record.hook_slot_id)return unresolved(map,record,'store_callback_invocation_required');
      if(record.operation==='store_snapshot_observed') {
        const expected=record.snapshot_role==='snapshot'?rule.snapshot_argument:record.snapshot_role==='server_snapshot'?rule.server_snapshot_argument:null;
        if(expected===null || slot.slot!==`arguments.${expected}` || !['returned','threw'].includes(record.outcome)
          || record.argument_count!==0 || !validEncodedValue(record.value) || !nonempty(record.value_id)
          || !record.value_id.startsWith(`${runtimeSession}:`) || storeResults.has(record.caused_by_invocation_id))return unresolved(map,record,'store_snapshot_result_required');
        if(record.notification_invocation_id!=null) {
          const notification=invocations.get(record.notification_invocation_id);
          if(!notification || notification.operation!=='store_listener_invoked' || notification.mount_key!==mountKey
            || notification.source_call_id!==source.call_id || notification.hook_slot_id!==record.hook_slot_id
            || notification.store_listener_id!==record.store_listener_id || record.snapshot_role!=='snapshot')return unresolved(map,record,'store_notification_lineage_mismatch');
        } else if(record.store_listener_id!=null)return unresolved(map,record,'store_notification_lineage_mismatch');
        externalStore={claim:'observed_snapshot_callback_outcome',outcome:record.outcome,value:copy(record.value),value_id:record.value_id,
          callback_invocation_id:record.caused_by_invocation_id,notification_invocation_id:record.notification_invocation_id||null,
          notification_link:record.notification_invocation_id?'synchronous_listener_call':'unobserved',commit_proven:false};
      } else {
        if(slot.slot!==`arguments.${rule.subscribe_argument}` || !nonempty(record.store_listener_id)
          || !record.store_listener_id.startsWith(`${runtimeSession}:`) || parent.store_listener_id!==record.store_listener_id
          || !nonempty(record.invocation_id) || !record.invocation_id.startsWith(`${runtimeSession}:`)
          || invocations.has(record.invocation_id))return unresolved(map,record,'store_subscription_lineage_required');
        externalStore={claim:record.operation==='store_listener_invoked'?'observed_subscription_listener_call':'observed_subscription_cleanup_call',
          subscription_invocation_id:record.caused_by_invocation_id,listener_id:record.store_listener_id,
          cleanup_previously_invoked:storeCleanups.has(record.store_listener_id),commit_proven:false,
          unsubscribe_success_proven:false,callback_input:parent.store_callback_input || {status:'unobserved'}};
      }
    }
    if (record.operation==='handle_produced') {
      const rule=source.behavior.execution,invocation=invocations.get(record.caused_by_invocation_id);
      if (!invocation || invocation.operation!=='callback_invoked' || invocation.render_key!==renderKey
          || invocation.source_call_id!==source.call_id || invocation.callback_slot!==`arguments.${rule.factory_argument}`
          || record.callback_slot!==invocation.callback_slot || slot?.source_id!==record.callback_source_id
          || handleProductions.has(record.caused_by_invocation_id)) return unresolved(map,record,'imperative_handle_invocation_required');
      if (!nonempty(record.value_id) || !record.value_id.startsWith(runtimeSession+':')
          || !validEncodedValue(record.value))return unresolved(map,record,'imperative_handle_result_required');
      if (record.factory_argument_count!==0)return unresolved(map,record,'imperative_handle_arguments_mismatch');
      if (!['undefined','null','boolean','number','string','object','function','bigint','symbol'].includes(record.value_kind))
        return unresolved(map,record,'imperative_handle_result_kind_required');
      handleFactory={invocation_id:record.caused_by_invocation_id,value_id:record.value_id,value:copy(record.value),
        value_kind:record.value_kind,factory_argument:rule.factory_argument,factory_argument_count:0,phase:rule.phase,ref_assignment_proven:false,ref_cleanup_proven:false};
    }
    let contextUse = null;
    if (record.operation === 'context_value_used') {
      if (!slot?.retained) {
        const invocation=invocations.get(record.caused_by_invocation_id);
        if (!invocation || invocation.operation!==(record.callback_slot==='cleanup'?'cleanup_invoked':'callback_invoked') || invocation.render_key!==renderKey
            || invocation.source_call_id!==record.source_call_id || invocation.callback_slot!==record.callback_slot
            || slot?.source_id!==record.callback_source_id) return unresolved(map,record,'context_use_callback_invocation_required');
      }
      const use = record.context_use;
      const site = slot?.context_reads?.find(read => read.read_id === use?.read_id
        && read.binding_id === use.binding_id && read.source_call_id === use.source_call_id);
      if (!site) return unresolved(map,record,'context_use_source_mismatch');
      const read = observations.get(use.read_observation_id);
      const readSource = read && map.react_semantics.find(row => row.call_id === read.source.call_id);
      if (!read || read.runtime.operation !== 'value_read' || read.source.call_id !== site.source_call_id
          || readSource?.causal_bindings.context_result_binding_id !== site.binding_id
          || ['session','root_id','instance_id','mount_id','render_id'].some(key => read.runtime[key] !== record[key])) {
        return unresolved(map,record,'context_use_read_origin_required');
      }
      const selection = read.runtime.context_rule_selection;
      if (use.value_matches !== true || !nonempty(use.value_identity)
          || selection?.status !== 'resolved' || selection.value_identity !== use.value_identity) {
        return unresolved(map,record,'context_use_value_mismatch');
      }
      contextUse = {...copy(use),context_object_id:selection.context_object_id,
        creation_observation_id:selection.origin_observation_id,claim:'observed_binding_read',
        downstream_effect_proven:false};
    }
    if (record.operation === 'callback_invoked' || record.operation === 'cleanup_invoked') {
      if (!nonempty(record.invocation_id)) return unresolved(map, record, 'callback_invocation_required');
      if (invocations.has(record.invocation_id)) return unresolved(map, record, 'duplicate_callback_invocation');
      slot = callbackSlot(record, source, protocol);
      if (!slot) return unresolved(map, record, 'callback_slot_mismatch');
      if (!nonempty(slot.source_id) || record.callback_source_id !== slot.source_id) {
        return unresolved(map, record, 'callback_source_mismatch');
      }
      if(slot.dynamic_source){
        const selected=record.memo_callback_origin,origin=resolveCallbackSource(selected?.source_observation_id);
        if(!origin||origin.session!==record.session||origin.source_id!==record.callback_source_id
          ||selected?.source_id!==origin.source_id
          ||origin.callback_identity_id!==selected?.callback_identity_id)return unresolved(map,record,'memo_calculator_source_receipt_required');
      }
      if (!priorRender) return unresolved(map, record, 'callback_render_identity_unobserved');
      if (priorRender.status === 'abandoned' && !retainedInvocation && !['state_requested','state_updater_invoked','state_calculated'].includes(record.operation)) {
        return unresolved(map, record, 'callback_from_abandoned_render');
      }
      const renderPhase = slot.retained === true
        || /render|calculation|comparison|synchronous call/u.test(slot.phase || '');
      if (!renderPhase && priorRender.status !== 'committed') {
        return unresolved(map, record, 'callback_commit_required');
      }
      if (record.operation === 'cleanup_invoked' && slot.slot !== 'cleanup' && !/unsubscribe/u.test(slot.slot)) {
        return unresolved(map, record, 'cleanup_slot_required');
      }
      if (record.operation === 'cleanup_invoked') {
        if (!nonempty(record.caused_by_invocation_id)
            || !invocations.has(record.caused_by_invocation_id)) {
          return unresolved(map, record, 'setup_invocation_required');
        }
        const setup = invocations.get(record.caused_by_invocation_id);
        if (setup.operation !== 'callback_invoked' || setup.mount_key !== mountKey
            || setup.render_key !== renderKey
            || setup.source_call_id !== record.source_call_id
            || setup.callback_slot === record.callback_slot
            || renders.get(setup.render_key)?.status !== 'committed') {
          return unresolved(map, record, 'cleanup_lineage_mismatch');
        }
        if(setup.effect_outcome&&!setup.effect_outcome.cleanup_returned)return unresolved(map,record,'setup_did_not_return_cleanup');
      }
    }

    if (['value_produced','value_selected'].includes(record.operation)) {
      if(record.memo_source_frontier)return unresolved(map,record,'memo_calculator_source_unobserved');
      if (!priorRender || priorRender.status === 'abandoned') return unresolved(map,record,'memo_render_identity_required');
      if (!nonempty(record.production_id) || !nonempty(record.value_id) || !validEncodedValue(record.value)) {
        return unresolved(map,record,'memo_value_identity_required');
      }
      const productionKey=`${runtimeSession}\0${record.production_id}`;
      if (record.operation === 'value_produced') {
        if (valueProductions.has(productionKey))return unresolved(map,record,'duplicate_value_production');
        if(valueProductionInvocations.has(`${runtimeSession}\0${record.caused_by_invocation_id}`))return unresolved(map,record,'value_return_already_observed');
        const invocation=invocations.get(record.caused_by_invocation_id);
        if(!invocation || invocation.operation!=='callback_invoked' || invocation.mount_key!==mountKey
          || invocation.render_key!==renderKey || invocation.source_call_id!==record.source_call_id
          || invocation.callback_slot!==(source.behavior.execution.kind==='state_queue'
            ?`arguments.${source.behavior.execution.initializer_argument} ${source.behavior.execution.initializer_mode==='if_function'?'if function':'if provided'}`
            :`arguments.${source.behavior.execution.callback_argument}`)) {
          return unresolved(map,record,'memo_calculation_invocation_required');
        }
      } else {
        const origin=valueProductions.get(productionKey);
        if(!origin || origin.mount_key!==mountKey || origin.source_call_id!==record.source_call_id
          || origin.hook_slot_id!==record.hook_slot_id || origin.value_id!==record.value_id
          || JSON.stringify(origin.value)!==JSON.stringify(record.value))return unresolved(map,record,'memo_value_lineage_mismatch');
        if(origin.render_id!==record.origin_render_id)return unresolved(map,record,'memo_value_origin_mismatch');
        if(origin.render_key!==renderKey && renders.get(origin.render_key)?.status!=='committed') {
          return unresolved(map,record,'memo_cache_commit_required');
        }
      }
    }

    if (record.operation === 'value_produced') {
      const declared=source.causal_bindings?.result_callbacks || [];
      const observed=record.result_callbacks || [];
      if(!Array.isArray(observed) || observed.some(binding => !binding || !nonempty(binding.callback_value_id)
        || !declared.some(row=>row.source_id===binding.source_id && JSON.stringify(row.path)===JSON.stringify(binding.path)))
        || new Set(observed.map(row=>JSON.stringify(row.path))).size!==observed.length) {
        return unresolved(map,record,'memo_callback_result_mismatch');
      }
    }
    if (record.operation === 'memo_callback_invoked') {
      if (!nonempty(record.invocation_id) || invocations.has(record.invocation_id)) return unresolved(map,record,'callback_invocation_required');
      if (!nonempty(record.action_occurrence_id)) return unresolved(map,record,'callback_action_occurrence_required');
      const origin=valueProductions.get(`${runtimeSession}\0${record.production_id}`);
      if(!priorRender || !origin || origin.mount_key!==mountKey || origin.render_key!==renderKey
        || origin.source_call_id!==record.source_call_id || origin.hook_slot_id!==record.hook_slot_id
        || origin.value_id!==record.value_id) return unresolved(map,record,'memo_callback_lineage_mismatch');
      const matches=origin.result_callbacks.filter(row=>row.source_id===record.callback_source_id
        && row.callback_value_id===record.callback_value_id
        && JSON.stringify(row.path)===JSON.stringify(record.callback_result_path));
      if(matches.length!==1)return unresolved(map,record,'memo_callback_result_mismatch');
      slot=source.causal_bindings.result_callbacks.find(row=>row.source_id===record.callback_source_id
        && JSON.stringify(row.path)===JSON.stringify(record.callback_result_path));
    }

    if(record.operation.startsWith('state_')) {
      if(!priorRender || !nonempty(record.state_identity_id))return unresolved(map,record,'state_owner_identity_required');
      const stateKey=`${runtimeSession}\0${record.state_identity_id}`;
      const state=stateIdentities.get(stateKey);
      if(state && (state.mount_key!==mountKey || state.source_call_id!==source.call_id || state.hook_slot_id!==record.hook_slot_id)) {
        return unresolved(map,record,'state_owner_identity_mismatch');
      }
      if(record.operation==='state_read') {
        if(!validEncodedValue(record.value))return unresolved(map,record,'state_value_required');
        if(record.initialization_status!=null && !['observed_return','ambiguous','unobserved'].includes(record.initialization_status))return unresolved(map,record,'state_initialization_status_invalid');
        if(record.initialization_production_id!=null) {
          const origin=valueProductions.get(`${runtimeSession}\0${record.initialization_production_id}`);
          if(!origin || origin.mount_key!==mountKey || origin.render_key!==renderKey
            || origin.source_call_id!==source.call_id || origin.hook_slot_id!==record.hook_slot_id
            || origin.value_id!==record.initialization_value_id || record.initialization_status!=='observed_return'
            || JSON.stringify(origin.value)!==JSON.stringify(record.value))return unresolved(map,record,'state_initialization_lineage_mismatch');
        } else if(record.initialization_value_id!=null || record.initialization_status==='observed_return') {
          return unresolved(map,record,'state_initialization_production_required');
        }
      } else if(record.operation==='state_committed') {
        if(priorRender.status!=='committed')return unresolved(map,record,'state_commit_render_required');
        if(!validEncodedValue(record.value))return unresolved(map,record,'state_commit_value_required');
        if(!['processing_render','observed_calculation_chain','unique_replacement'].includes(record.selection_basis)
          || !Array.isArray(record.committed_updates) || !record.committed_updates.length
          || record.committed_updates.length>256)return unresolved(map,record,'state_commit_selection_required');
        const read=stateReads.get(`${renderKey}\0${record.state_identity_id}`);
        if(!read || read.source_call_id!==source.call_id || read.hook_slot_id!==record.hook_slot_id
          || JSON.stringify(read.value)!==JSON.stringify(record.value))return unresolved(map,record,'state_commit_read_required');
        const seenRequests=new Set(),seenInvocations=new Set();let processingCount=0;
        const selected=[];
        for(const update of record.committed_updates) {
          if(!update || !nonempty(update.request_id) || seenRequests.has(update.request_id))
            return unresolved(map,record,'state_commit_update_identity_invalid');
          seenRequests.add(update.request_id);
          const requestKey=`${runtimeSession}\0${update.request_id}`,request=stateRequests.get(requestKey);
          if(!request || request.mount_key!==mountKey || request.state_identity_id!==record.state_identity_id
            || request.source_call_id!==source.call_id || request.hook_slot_id!==record.hook_slot_id)
            return unresolved(map,record,'state_commit_request_lineage_mismatch');
          const committedInvocation=update.invocation_id||null;
          if(request.committed_invocations.has(committedInvocation))return unresolved(map,record,'state_request_already_committed');
          acceptedStateCommitRequests.push({request,committedInvocation});
          selected.push({request,invocation:null});
          if(update.invocation_id==null) {
            if(request.update_kind!=='value' || record.selection_basis!=='unique_replacement')
              return unresolved(map,record,'state_commit_calculation_required');
          } else {
            if(!nonempty(update.invocation_id) || seenInvocations.has(update.invocation_id))
              return unresolved(map,record,'state_commit_update_identity_invalid');
            seenInvocations.add(update.invocation_id);
            const invocation=stateInvocations.get(`${runtimeSession}\0${update.invocation_id}`);
            if(!invocation || !invocation.completed || invocation.outcome!=='returned' || invocation.request_key!==requestKey)
              return unresolved(map,record,'state_commit_calculation_lineage_mismatch');
            selected[selected.length-1].invocation=invocation;
            if(invocation.processing_render_id!=null) {
              if(invocation.render_key!==renderKey || invocation.processing_render_id!==record.render_id)
                return unresolved(map,record,'state_commit_processing_render_mismatch');
              processingCount++;
            }
          }
        }
        if(selected.some((row,index)=>index>0&&row.request.order<=selected[index-1].request.order))
          return unresolved(map,record,'state_commit_queue_order_mismatch');
        const sameValue=(left,right)=>left?.encoding==='primitive'&&right?.encoding==='primitive'
          ?Object.is(left.value,right.value):true;
        for(let index=1;index<selected.length;index++) {
          const previous=selected[index-1].invocation?.next_state
            || selected[index-1].request.update_kind==='value'&&selected[index-1].request.update_value;
          const pending=selected[index].invocation?.pending_state;
          if(previous&&pending&&!sameValue(previous,pending))return unresolved(map,record,'state_commit_calculation_chain_mismatch');
        }
        const last=selected.at(-1),lastValue=last.invocation?.next_state
          || last.request.update_kind==='value'&&last.request.update_value;
        if(lastValue&&!sameValue(lastValue,record.value))return unresolved(map,record,'state_commit_final_value_mismatch');
        if(record.selection_basis==='processing_render' && processingCount===0
          || record.selection_basis==='observed_calculation_chain' && processingCount!==0
          || record.selection_basis==='unique_replacement' && record.committed_updates.length!==1)
          return unresolved(map,record,'state_commit_selection_mismatch');
      } else {
        if(!state || !nonempty(record.request_id))return unresolved(map,record,'state_dispatch_identity_required');
        const candidates=map.edges.filter(edge=>edge.relation==='state_write' && edge.hook_call_id===source.call_id
          && edge.from===record.update_call_id);
        if(!candidates.length)return unresolved(map,record,'state_update_source_mismatch');
        const update=candidates[0];
        const requestKey=`${runtimeSession}\0${record.request_id}`;
        const request=stateRequests.get(requestKey);
        if(record.operation==='state_requested') {
          if(request)return unresolved(map,record,'duplicate_state_request');
          if(!nonempty(record.update_value_id) || !validEncodedValue(record.update_value))return unresolved(map,record,'state_update_value_required');
          if(!['functional','value','reducer'].includes(record.update_kind))return unresolved(map,record,'state_update_kind_required');
          const sourceScopes=record.source_scopes||[];
          if(!Array.isArray(sourceScopes) || sourceScopes.length>32
            || new Set(sourceScopes.map(scope=>scope?.scope_id)).size!==sourceScopes.length
            || sourceScopes.some(scope=>!scope || Object.keys(scope).sort().join(',')!=='callback_invocation_id,scheduling,scope_id'
              || !nonempty(scope.scope_id) || !scope.scope_id.startsWith(`${runtimeSession}:`)
              || !nonempty(scope.callback_invocation_id) || !scope.callback_invocation_id.startsWith(`${runtimeSession}:`)
              || !['transition','sync_flush','legacy_batch','test_queue'].includes(scope.scheduling)))
            return unresolved(map,record,'state_source_scope_invalid');
          if((source.behavior.execution.update_mode==='reducer')!==(record.update_kind==='reducer')
            || update.updater_source_id && record.update_kind!=='functional'
            || record.update_kind==='value' && record.callback_source_id)return unresolved(map,record,'state_update_kind_mismatch');
          const expectedReducer=source.causal_bindings.callbacks.find(row=>row.slot==='arguments.0')?.source_id;
          const expectedUpdaters=[update.updater_source_id,...(update.updater_source_candidates||[]).map(row=>row.source_id)].filter(Boolean);
          if(record.callback_source_id && (source.behavior.execution.update_mode==='reducer'
            ?record.callback_source_id!==expectedReducer:!expectedUpdaters.includes(record.callback_source_id)))return unresolved(map,record,'state_updater_source_mismatch');
        } else {
          if(!request || request.mount_key!==mountKey || request.state_identity_id!==record.state_identity_id
            || request.update_call_id!==record.update_call_id || request.update_value_id!==record.update_value_id
            || JSON.stringify(request.update_value)!==JSON.stringify(record.update_value)
            || JSON.stringify(request.source_scopes)!==JSON.stringify(record.source_scopes||[])
            || !['functional','reducer'].includes(request.update_kind))return unresolved(map,record,'state_request_lineage_mismatch');
          if(record.request_render_id!==request.request_render_id
            || record.processing_render_id!=null && record.processing_render_id!==record.render_id
            || record.processing_render_id==null && request.render_key!==renderKey)
            return unresolved(map,record,'state_processing_render_lineage_mismatch');
          const expectedReducer=source.causal_bindings.callbacks.find(row=>row.slot==='arguments.0')?.source_id;
          const expectedUpdaters=[update.updater_source_id,...(update.updater_source_candidates||[]).map(row=>row.source_id)].filter(Boolean);
          if(!request.callback_source_id || request.callback_source_id!==record.callback_source_id
            || (source.behavior.execution.update_mode==='reducer'
              ?request.callback_source_id!==expectedReducer:!expectedUpdaters.includes(request.callback_source_id)))return unresolved(map,record,'state_updater_source_mismatch');
          if(!nonempty(record.invocation_id))return unresolved(map,record,'state_invocation_identity_required');
          const invocation=stateInvocations.get(`${runtimeSession}\0${record.invocation_id}`);
          slot={source_id:request.callback_source_id,captures:source.behavior.execution.update_mode==='reducer'
            ?source.causal_bindings.callbacks.find(row=>row.slot==='arguments.0')?.captures||[]
            :update.updater_source_candidates?.find(row=>row.source_id===request.callback_source_id)?.captures||update.updater_captures||[]};
          if(record.operation==='state_updater_invoked') {
            if(invocation || !validEncodedValue(record.pending_state))return unresolved(map,record,'state_invocation_input_required');

          } else if(record.operation==='state_calculated') {
            if(!invocation || invocation.request_key!==requestKey || invocation.completed
              || !validEncodedValue(record.next_state))return unresolved(map,record,'state_calculation_lineage_mismatch');
          } else if(!invocation || invocation.request_key!==requestKey || invocation.completed
            || !validEncodedValue(record.error))return unresolved(map,record,'state_calculation_failure_lineage_mismatch');
        }
      }
    }

    if (Array.isArray(record.captured_values)) {
      const allowed = new Set((slot?.captures || []).map(value => value.binding_id));
      if (record.captured_values.some(value => !value || !nonempty(value.binding_id)
          || !allowed.has(value.binding_id)
          || !validEncodedValue(value))) {
        return unresolved(map, record, 'captured_value_binding_mismatch');
      }
    } else if (record.captured_values !== undefined) {
      return unresolved(map, record, 'captured_values_invalid');
    }

    if(effectOutcome)invocations.get(record.caused_by_invocation_id).effect_outcome=effectOutcome;
    if(wrapperOutcome)invocations.get(record.caused_by_invocation_id).wrapper_completed=true;
    if(record.operation==='state_read')stateIdentities.set(`${runtimeSession}\0${record.state_identity_id}`,{
      mount_key:mountKey,source_call_id:source.call_id,hook_slot_id:record.hook_slot_id});
    if(record.operation==='state_read')stateReads.set(`${renderKey}\0${record.state_identity_id}`,{
      source_call_id:source.call_id,hook_slot_id:record.hook_slot_id,value:copy(record.value)});
    if(record.operation==='state_requested')stateRequests.set(`${runtimeSession}\0${record.request_id}`,{
      mount_key:mountKey,render_key:renderKey,state_identity_id:record.state_identity_id,update_call_id:record.update_call_id,
      request_render_id:record.request_render_id,source_call_id:source.call_id,hook_slot_id:record.hook_slot_id,
      update_kind:record.update_kind,callback_source_id:record.callback_source_id,
      update_value_id:record.update_value_id,update_value:copy(record.update_value),source_scopes:copy(record.source_scopes||[]),
      action_occurrence_id:record.action_occurrence_id||null,request_id:record.request_id,
      committed_invocations:new Set(),order:++stateRequestOrder});
    if(record.operation==='state_updater_invoked')stateInvocations.set(`${runtimeSession}\0${record.invocation_id}`,{
      request_key:`${runtimeSession}\0${record.request_id}`,render_key:renderKey,
      processing_render_id:record.processing_render_id||null,pending_state:copy(record.pending_state),completed:false});
    if(record.operation==='state_calculated' || record.operation==='state_calculation_failed') {
      const invocation=stateInvocations.get(`${runtimeSession}\0${record.invocation_id}`);
      invocation.completed=true;invocation.outcome=record.operation==='state_calculated'?'returned':'threw';
      if(record.next_state)invocation.next_state=copy(record.next_state);
    }
    if(record.operation==='state_committed')for(const {request,committedInvocation} of acceptedStateCommitRequests)
      request.committed_invocations.add(committedInvocation);
    if(record.operation==='value_produced')valueProductionInvocations.add(`${runtimeSession}\0${record.caused_by_invocation_id}`);
    if(record.operation==='value_produced')valueProductions.set(`${runtimeSession}\0${record.production_id}`,{
      mount_key:mountKey,render_key:renderKey,render_id:record.render_id,source_call_id:record.source_call_id,
      hook_slot_id:record.hook_slot_id,value_id:record.value_id,value:copy(record.value),
      result_callbacks:copy(record.result_callbacks || []),
    });
    if(record.operation==='shared_callback_selected')sharedCallbackSelections.set(`${renderKey}\0${record.source_call_id}\0${record.hook_slot_id}`,record.callback_identity_id);
    if(record.operation==='callback_selected')callbackSelections.set(`${renderKey}\0${record.source_call_id}\0${record.hook_slot_id}`,record.callback_identity_id);
    if (record.operation === 'callback_created') callbackIdentities.set(identityKey, {
      mount_key: mountKey, source_call_id: record.source_call_id,
      hook_slot_id: record.hook_slot_id, render_id: record.render_id,
    });
    if (record.operation === 'render_attempted') {
      renders.set(renderKey, { status: 'attempted', source_call_id: record.source_call_id });
      pendingRenderReplacements.delete(replacementKey);
      if (!mounts.has(mountKey)) mounts.set(mountKey, { unmounted: false });
    } else if (record.operation === 'render_committed') {
      renders.set(renderKey, { ...priorRender, status: 'committed' });
      mounts.set(mountKey, { ...mount, unmounted: false, committed: true });
    } else if (record.operation === 'render_abandoned') {
      renders.set(renderKey, { ...priorRender, status: 'abandoned' });
      if(nonempty(record.replacement_render_id)){
        const key=`${runtimeSession}\0${replacementOwner}\0${record.replacement_render_id}`,rows=pendingRenderReplacements.get(key)||[];
        rows.push({render_id:record.render_id,render_key:renderKey,source_call_id:record.source_call_id,
          render_position_id:record.render_position_id,
          suspense_origin:record.suspense_boundary?.origin_observation_id||null,
          suspense_input:record.suspense_boundary?.input_identity||null});
        pendingRenderReplacements.set(key,rows);
      }
    } else if (record.operation === 'unmounted') {
      if (!mount.committed) return unresolved(map, record, 'committed_mount_required');
      mounts.set(mountKey, { ...mount, unmounted: true });
    }
    if (nonempty(record.invocation_id) && !record.operation.startsWith('state_')) invocations.set(record.invocation_id, {
      mount_key: mountKey,
      render_key: renderKey,
      source_call_id: record.source_call_id,
      operation: record.operation,wrapper:wrapper?.runtime || null,manifest_key:record.manifest_key || null,
      callback_slot: record.callback_slot || null,
      hook_slot_id:record.hook_slot_id || null,store_listener_id:record.store_listener_id || null,store_callback_input:storeCallbackInput,
    });
    if (hookKey) hooks.set(hookKey, hookSourceIdentity);

    const runtime = {
      observation_id: record.observation_id,
      occurrence_id: record.occurrence_id,
      ...(nonempty(record.session) ? { session: record.session } : {}),
      ...(Number.isSafeInteger(record.seq) ? { seq: record.seq } : {}),
      operation: record.operation,
      ...(wrapperOutcome?{wrapper_outcome:wrapperOutcome}:{}),
      ...(effectOutcome?{effect_outcome:effectOutcome}:{}),
      root_id: record.root_id,
      instance_id: record.instance_id,
      mount_id: record.mount_id,
      render_id: record.render_id,
      ...(nonempty(record.render_position_id)?{render_position_id:record.render_position_id}:{}),
      ...(record.operation==='render_abandoned'&&nonempty(record.replacement_render_id)
        ?{abandonment:{cause:record.abandonment_cause,replacement_render_id:record.replacement_render_id,
          replacement_attempt_observed:false}}:{}),
      ...(record.operation==='render_attempted'&&expectedReplacements.length
        ?{supersession:{claim:expectedReplacements.every(value=>value.render_position_id===record.render_position_id)
          ?'observed_same_render_position_replacement_attempt':'observed_same_suspense_source_replacement_attempt',
          superseded_render_ids:expectedReplacements.map(value=>value.render_id)}}:{}),
      ...(retainedInvocation ? { owner_lifecycle:mount?.unmounted ? 'unmounted' : priorRender.status,
        committed_execution:priorRender.status === 'committed' && !mount?.unmounted } : {}),
      ...(record.operation.startsWith('state_')&&mount?.unmounted
        ?{owner_lifecycle:'unmounted',committed_execution:false}:{}),
      ...(record.operation.startsWith('state_')?{state_identity_id:record.state_identity_id,
        request_render_id:record.operation==='state_read'?null:record.render_id,
        initialization_production_id:record.initialization_production_id||null,
        initialization_status:record.initialization_status||'unobserved',
        request_id:record.request_id||null,update_call_id:record.update_call_id||null,update_kind:record.update_kind||null,
        update_value_id:record.update_value_id||null,update_value:record.update_value?copy(record.update_value):null,
        value:record.value?copy(record.value):null,pending_state:record.pending_state?copy(record.pending_state):null,
        next_state:record.next_state?copy(record.next_state):null,error:record.error?copy(record.error):null,
        calculation_outcome:record.operation==='state_calculated'?'returned':record.operation==='state_calculation_failed'?'threw':null,
        action_occurrence_id:record.action_occurrence_id||null,
        source_scopes:copy(record.source_scopes||[]),
        frontier:record.frontier||null,
        request_render_id:record.request_render_id||null,processing_render_id:record.processing_render_id||null,
        selection_basis:record.selection_basis||null,
        committed_updates:Array.isArray(record.committed_updates)?copy(record.committed_updates):null,
        commit_causality:record.operation==='state_committed'?'proven':'unproven'}:{}),
      ...(nonempty(record.hook_slot_id) ? { hook_slot_id: record.hook_slot_id } : {}),
      ...(nonempty(record.protocol_member) ? { protocol_member: record.protocol_member } : {}),
      ...(nonempty(record.source_member_call_id) ? { source_member_call_id: record.source_member_call_id } : {}),
      ...(nonempty(record.callback_slot) ? { callback_slot: record.callback_slot } : {}),
      ...(nonempty(record.callback_source_id) ? { callback_source_id: record.callback_source_id } : {}),
      ...(nonempty(record.production_id) ? {production_id:record.production_id,value_id:record.value_id,...(record.value ? {value:copy(record.value)} : {})} : {}),
      ...(record.operation==='memo_callback_invoked' ? {callback_value_id:record.callback_value_id,
        callback_result_path:copy(record.callback_result_path),action_occurrence_id:record.action_occurrence_id} : {}),
      ...(record.operation==='shared_callback_selected'?{claim:'observed_hook_return',creation_render_proven:false,body_execution_proven:false}:{}),
      ...(nonempty(record.callback_identity_id) ? { callback_identity_id: record.callback_identity_id } : {}),
      ...(nonempty(record.origin_render_id) ? { origin_render_id: record.origin_render_id } : {}),
      ...(nonempty(record.invocation_id) ? { invocation_id: record.invocation_id } : {}),
      ...(nonempty(record.caused_by_invocation_id) ? { caused_by_invocation_id: record.caused_by_invocation_id } : {}),
      evidence_ids: Array.isArray(record.evidence_ids) ? [...record.evidence_ids] : [record.observation_id],
      captured_values: Array.isArray(record.captured_values) ? copy(record.captured_values) : [],
      ...(nonempty(record.context_id) ? { context_id: record.context_id,
        context_value: copy(record.context_value),
        context_default_used: record.context_default_used,
        provider_protocol_application_id: record.provider_protocol_application_id || null,
        provider_source_member_call_id: record.provider_source_member_call_id || null,
        provider_value: record.provider_value == null ? null : copy(record.provider_value),
        provider_resolution: copy(contextProviderEvidence) } : {}),
      ...(contextRuleSelection?{context_rule_selection:contextRuleSelection}:{}),
      ...(contextUse?{context_use:contextUse}:{}),
      ...(handleFactory?{handle_factory:handleFactory}:{}),
      ...(externalStore?{external_store:externalStore}:{}),
      ...(storeCallbackInput?{retained_callback_input:storeCallbackInput}:{}),
      ...(idProof?{id_proof:idProof}:{}),
      ...(transitionProof?{transition_proof:transitionProof}:{}),
      ...(deferredProof?{deferred_proof:deferredProof}:{}),
      ...(wrapper?{wrapper:wrapper.runtime}:{}),
    };
    const result = {
      schema: JOIN_SCHEMA,
      status: 'resolved',
      reason: null,
      claim: 'runtime_observed',
      runtime_observed: true,
      map_fingerprint: map.fingerprint,
      observation_id: record.observation_id,
      source: {
        call_id: source.call_id,
        semantic_id: source.semantic_id,
        semantic_application_id: source.id,
        surface: source.surface,
        export: source.export,
        version: source.version,
        package_verification_sha256: source.package_verification_sha256,
        owner_source_id: sourceOwner || null,
        callback_source_id: slot?.source_id || wrapper?.runtime.callback_source_id || null,
        ...(record.operation.startsWith('state_')?{update_call_id:record.update_call_id||null}:{}),
        protocol_application_id: protocol?.id || null,
        claim: 'source_contract',
        runtime_observed: false,
      },
      runtime,
    };
    observations.set(record.observation_id, result);
    if (handleFactory) handleProductions.add(record.caused_by_invocation_id);
    if(record.operation==='deferred_selected')deferredSelections.set(record.observation_id,{hook_key:hookKey,render_key:renderKey,value_id:record.value_id,value:copy(record.value)});
    if(record.operation==='transition_result')transitionResults.set(record.observation_id,{hook_key:hookKey,render_key:renderKey,start_identity_id:record.start_identity_id,pending:record.transition_pending,observation_id:record.observation_id});
    if(record.operation==='id_read')idReads.set(record.observation_id,{hook_key:hookKey,render_key:renderKey,value:record.id_value.value,observation_id:record.observation_id});
    if(record.operation==='store_snapshot_observed')storeResults.add(record.caused_by_invocation_id);
    if(record.operation==='store_cleanup_invoked')storeCleanups.add(record.store_listener_id);
    return copy(result);
  }

  return {
    schema: SESSION_SCHEMA,
    map_fingerprint: map.fingerprint,
    join,
    joinWrapper:wrapperEvidence.join,
    joinContextOrigin:record=>({schema:'producttrace.react-context-origin-join.v1',...contextEvidence.joinOrigin(record)}),
    snapshot() {
      return {
        schema: SESSION_SCHEMA,
        map_fingerprint: map.fingerprint,
        observations: [...observations.values()].map(copy),
        counts: {
          resolved: observations.size,
          mounts: mounts.size,
          hooks: hooks.size,
          renders: renders.size,
          invocations: invocations.size,
        },
      };
    },
  };
}

export const REACT_LIFECYCLE_OBSERVATION_SCHEMA = SCHEMA;
export const REACT_LIFECYCLE_JOIN_SCHEMA = JOIN_SCHEMA;
