import type { ReactMap } from './react-compiler.mjs';

export type ReactLifecycleOperation = 'render_attempted' | 'render_committed' | 'render_abandoned' |
  'callback_completed' | 'cleanup_completed' |
  'callback_invoked' | 'cleanup_invoked' | 'callback_created' | 'callback_selected' | 'shared_callback_selected' | 'value_read' | 'value_written' | 'value_produced' | 'value_selected' | 'memo_callback_invoked' | 'work_scheduled' |
  'wrapper_callback_invoked' | 'deferred_selected' | 'deferred_used' | 'transition_pending_used' | 'transition_result' | 'id_read' | 'id_used' | 'store_listener_invoked' | 'store_cleanup_invoked' | 'store_snapshot_observed' | 'handle_produced' | 'context_value_used' | 'state_read' | 'state_requested' | 'state_updater_invoked' | 'state_calculated' | 'state_calculation_failed' | 'state_committed' | 'hydration_replayed_event' | 'error_observed' | 'unmounted';

export interface ReactLifecycleObservation {
  schema: 'producttrace.react-lifecycle-observation.v1';
  kind: 'react_lifecycle';
  observation_id: string;
  occurrence_id: string;
  session?: string;
  seq?: number;
  map_fingerprint: string;
  source_call_id: string;
  semantic_id: string;
  owner_source_id?: string;
  operation: ReactLifecycleOperation;
  root_id: string;
  instance_id: string;
  mount_id: string;
  render_id: string;
  render_position_id?: string;
  replacement_render_id?: string | null;
  replaces_render_ids?: string[];
  abandonment_cause?: 'superseded_by_render_attempt' | 'renderer_abandoned';
  suspense_boundary?: {status:'unresolved';reason:'boundary_input_origin_limit'|'suspense_render_origin_unresolved'|'suspense_render_ancestry_incomplete'|'suspense_render_identity_unresolved'} | {
    status:'source_resolved';origin_observation_id:string;manifest_key:string;source_call_id:string;
    semantic_id:'react/Suspense/18.3.1';input_identity:string;commit_observation_id:string|null;
    selection:'children'|'fallback'|'dehydrated'|null;renderer:{root_id:string;instance_id:string;mount_id:string}|null;
    retained_commit_observation_id:string|null;retained_origin_observation_id:string|null;
    retained_selection:'children'|'fallback'|'dehydrated'|null;
  };
  hook_slot_id?: string;
  protocol_member?: string;
  source_member_call_id?: string;
  callback_slot?: string;
  callback_source_id?: string;
  invocation_id?: string;
  runtime_observed?: boolean;
  manifest_key?: string;
  wrapper_origin_observation_id?: string;
  wrapper_id?: string;
  component_identity_id?: string;
  renderer_wrapper_matched?: boolean;
  arguments?: {value_id:string;value:{encoding:'primitive'|'redacted';value:unknown}}[];
  id_value?:{encoding:'primitive'|'opaque_identity'|'redacted';value?:unknown};
  input_value_id?:string;
  input_value?:{encoding:'primitive'|'opaque_identity'|'redacted';value?:unknown};
  matches_input?:boolean;
  matches_previous?:boolean;
  previous_observation_id?:string|null;
  read_source_id?:string;
  origin_observation_id?:string;
  matches_selected?:boolean;
  transition_pending?:boolean;
  transition_pending_matches?:boolean;
  start_identity_id?:string;
  id_read_source_id?:string;
  id_property?:'id'|'htmlFor';
  id_read_observation_id?:string;
  id_value_matches?:boolean;
  store_listener_id?:string|null;
  store_callback_origin?:{callback_identity_id:string;producer_source_call_id:string;producer_hook_slot_id:string;origin_render_id:string}|null;
  snapshot_role?:'snapshot'|'server_snapshot';
  notification_invocation_id?:string|null;
  outcome?:'returned'|'threw';
  argument_count?:number;
  callback_identity_id?: string;
  origin_render_id?: string;
  state_identity_id?: string;
  initialization_production_id?: string | null;
  initialization_value_id?: string | null;
  initialization_status?: 'observed_return' | 'ambiguous' | 'unobserved';
  request_id?: string;
  update_call_id?: string;
  update_value_id?: string;
  update_value?: {encoding:'primitive'|'opaque_identity'|'redacted';value?:unknown};
  update_kind?: 'functional' | 'value' | 'reducer';
  pending_state?: {encoding:'primitive'|'opaque_identity'|'redacted';value?:unknown};
  next_state?: {encoding:'primitive'|'opaque_identity'|'redacted';value?:unknown};
  error?: {encoding:'primitive'|'opaque_identity'|'redacted';value?:unknown};
  request_render_id?: string;
  processing_render_id?: string | null;
  selection_basis?: 'processing_render' | 'observed_calculation_chain' | 'unique_replacement';
  committed_updates?: {request_id:string;invocation_id:string|null}[];
  frontier?: string | null;
  production_id?: string;
  result_callbacks?: {path:string[];source_id:string;callback_value_id:string}[];
  callback_result_path?: string[];
  callback_value_id?: string;
  action_occurrence_id?: string;
  source_scopes?: {scope_id:string;callback_invocation_id:string;scheduling:'transition'|'sync_flush'|'legacy_batch'|'test_queue'}[];
  action?:{action_occurrence_id:string;callback_observation_id:string;scenario_id:string;control_id:string}|null;
  value_id?: string;
  factory_argument_count?:number;
  value_kind?:string;
  value?: {encoding:'primitive'|'opaque_identity'|'redacted';value?:unknown};
  caused_by_invocation_id?: string;
  context_use?: {read_id:string;binding_id:string;source_call_id:string;read_observation_id?:string;value_identity?:string;value_matches:boolean};
  context_id?: string;
  context_value?: { encoding: 'primitive' | 'opaque_identity' | 'redacted'; value?: unknown };
  /** Original creation and value identities; absent evidence does not prove a stored default. */
  context_value_proof?:{context_object_id:string;origin_observation_id:string;source_context_id:string;source_call_id:string;
    observed_value:{identity:string;kind:string;encoding:'primitive'|'redacted';value:unknown};selected_from:'default'|'provider'|'unresolved';
    selected_value?:{identity:string;kind:string;encoding:'primitive'|'redacted';value:unknown}}|null;
  context_default_used?: boolean | null;
  context_provider_status?: 'default' | 'source_resolved' | 'source_unresolved' | 'unresolved';
  context_provider_unresolved_reason?: 'provider_source_uninstrumented' | 'provider_ancestry_unobserved' | 'provider_ancestry_limit' | null;
  provider_protocol_application_id?: string | null;
  provider_source_member_call_id?: string | null;
  provider_value?: { encoding: 'primitive' | 'opaque_identity' | 'redacted'; value?: unknown } | null;
  evidence_ids?: string[];
  captured_values?: { binding_id: string; encoding: 'primitive' | 'opaque_identity' | 'redacted'; value?: unknown }[];
}

export interface ReactLifecycleJoin {
  schema: 'producttrace.react-lifecycle-join.v1';
  status: 'resolved' | 'unresolved';
  reason: string | null;
  claim: 'runtime_observed' | 'runtime_observation_rejected';
  runtime_observed: boolean;
  map_fingerprint: string;
  observation_id: string | null;
  source: Record<string, unknown> | null;
  runtime: Record<string, unknown> | null;
}

export interface ReactWrapperJoin {
  schema: 'producttrace.react-wrapper-join.v1';
  status: 'resolved' | 'unresolved'; reason:string|null; runtime_observed:boolean;
  source:Record<string,unknown>|null; runtime:Record<string,unknown>|null;
}

export declare function createReactLifecycleEvidenceSession(map: ReactMap, options?: {wrapperEntries?: Record<string,unknown>[];resolveCallbackSource?(id:string):{session:string;source_id:string;callback_identity_id:string}|null|undefined}): {
  schema: 'producttrace.react-lifecycle-session.v1';
  map_fingerprint: string;
  join(record: ReactLifecycleObservation): ReactLifecycleJoin;
  joinWrapper(record:Record<string,unknown>):ReactWrapperJoin;
  joinContextOrigin(record:Record<string,unknown>):{schema:'producttrace.react-context-origin-join.v1';status:'resolved'|'unresolved';reason:string|null;runtime_observed:boolean;origin?:Record<string,unknown>};
  snapshot(): { schema: 'producttrace.react-lifecycle-session.v1'; map_fingerprint: string;
    observations: ReactLifecycleJoin[]; counts: {resolved:number; mounts:number; hooks:number; renders:number; invocations:number} };
};
export declare const REACT_LIFECYCLE_OBSERVATION_SCHEMA: 'producttrace.react-lifecycle-observation.v1';
export declare const REACT_LIFECYCLE_JOIN_SCHEMA: 'producttrace.react-lifecycle-join.v1';
