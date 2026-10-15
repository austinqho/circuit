import type {ReactLifecycleObservation, ReactLifecycleJoin, ReactWrapperJoin} from './react-lifecycle-evidence.mjs';
import type { LibraryEffect, ReactMap, SourceCondition } from './react-compiler.mjs';

export interface ReactPredicateUseObservation {
  schema:'producttrace.react-predicate-use.v1';kind:'react_predicate_use';runtime_observed:true;
  session:string;map_fingerprint:string;observation_id:string;occurrence_id:string;evidence_ids:string[];
  manifest_key:string;source_call_id:string;condition_source_id:string;source_scope_id:string|null;
  source_frame_id:string;value:boolean|null;action_occurrence_id:string|null;frontier?:string|null;
}

export interface ReactProfilerObservation {
  schema:'producttrace.react-profiler.v1';
  kind:'react_profiler';
  operation:'callback_started'|'callback_finished'|'committed_callback';
  session:string;
  map_fingerprint:string;
  observation_id:string;
  occurrence_id:string;
  evidence_ids:string[];
  manifest_key:string;
  callback_source_id:string;
  callback_identity:string;
  invocation_id?:string;
  outcome?:'returned'|'threw';
  runtime_observed:true;
  [field:string]:unknown;
}

export interface ReactFrontendOutboundRequest {
  contract_application_id: string;
  contract_id: string;
  invocation_call_id: string;
  placement_id: string;
  package: string;
  version: string;
  package_verification_sha256: string;
  effect: LibraryEffect & { kind: 'http_request' };
  conditions: SourceCondition[];
  evidence_ids: string[];
}

export interface ReactRuntimeJoin {
  schema: 'producttrace.react-runtime-join.v1';
  status: 'resolved' | 'unresolved';
  reason: 'missing_runtime_occurrence' | 'missing_runtime_evidence' | 'missing_source_action' | 'unknown_source_action' | 'runtime_source_control_mismatch' | 'runtime_event_mismatch' | 'invalid_react_runtime_identity' | 'invalid_react_lifecycle_identity' | null;
  map_fingerprint: string;
  runtime: {
    event_id: string | null;
    /** Canonical captured action identity. Workflow producers must propagate it explicitly. */
    action_occurrence_id: string | null;
    workflow_id: string | null;
    session: string | null;
    seq: number | null;
    evidence_ids: string[];
    react_identity?: { root_id:string; instance_id:string; mount_id:string; commit_id:string;
      render_id:null; render_observed:false; runtime_observed:true; basis:'react-devtools-commit.v1' } | null;
    react_lifecycle_identity?: { session:string; root_id:string; instance_id:string; mount_id:string; render_id:string;
      source_call_id:string; semantic_id:string; owner_source_id:string|null; status:'committed';
      runtime_observed:true; basis:'react-lifecycle-render.v1' } | null;
  };
  source: null | {
    control_id: string; scenario_id: string; placement_id: string; handler_ids: string[];
    conditions: SourceCondition[];
    path: {
      /** Direct scenario-tagged edges. Global React reaction/render edges require a separate closure step. */
      scenario_edges: ReactMap['edges'];
      /** Verified library redirects and effects for this source scenario. */
      library_contracts: ReactMap['library_contracts'];
      /** Unresolved library boundaries for this source scenario. */
      library_backlog: ReactMap['library_backlog'];
      /** Convenience view of verified HTTP request contracts; these are possible, not observed requests. */
      outbound_requests: ReactFrontendOutboundRequest[];
    };
    owner: { id: string; name: string; file: string } | null;
    node: { node_id: string; file: string; start: number; end: number } | null;
  };
  evidence?: { basis: 'instrumented_source_control'; selector: Record<string, string>; source_action: string };
}

export interface ReactCallbackObservation {
  schema: 'producttrace.react-callback-observation.v1';
  kind: 'react_callback';
  map_fingerprint: string;
  observation_id: string;
  occurrence_id: string;
  evidence_ids: string[];
  control_id: string;
  binding_id: string;
  event: string;
  action_occurrence_id: string;
  candidate_source_ids: string[];
  selected_source_id: string | null;
  selected_scenario_id: string | null;
  memo_observation_id?: string | null;
  /** Actual function object called by this event wrapper. */
  callee_identity_id?: string | null;
  session?: string;
  status: 'resolved' | 'unresolved';
  reason: string | null;
  runtime_observed: true;
  react_identity?: Record<string, unknown> | null;
}

/** Original named body entry. Owner proof additionally requires an accepted hook
 * selection, source action, live mount, and the matching event callee identity. */
export interface ReactSharedCallbackObservation {
  schema:'producttrace.react-shared-callback.v1'; kind:'react_shared_callback';
  map_fingerprint:string; manifest_key:string; session:string;
  observation_id:string; occurrence_id:string; evidence_ids:string[]; runtime_observed:true;
  callback_source_id:string; callback_identity_id:string; selection_observation_id:string|null;
  action:{action_occurrence_id:string;callback_observation_id:string}|null;
  reason:string|null; arguments_observed:boolean; arguments:Array<{value_id:string;value:{encoding:string;value:unknown}}>|null;
  captured_values:Array<{binding_id:string;encoding:string;value:unknown}>;
}
export interface ReactSharedCallbackJoin {
  schema:'producttrace.react-shared-callback-join.v1'; status:'resolved'|'unresolved';reason:string|null;
  observation_id?:string;runtime_observed:boolean;source:Record<string,unknown>|null;runtime:Record<string,unknown>|null;
}

export interface ReactElementObservation extends Record<string,unknown> {
  schema:'producttrace.react-element-observation.v1';kind:'react_element';session:string;
  map_fingerprint:string;manifest_key:string;source_call_id:string;semantic_id:string;
  observation_id:string;occurrence_id:string;evidence_ids:string[];runtime_observed:true;
  operation:'returned'|'threw'|'loader_returned'|'loader_threw'|'loader_fulfilled'|'loader_rejected';inputs?:Record<string,unknown>;fields?:Record<string,unknown>;
  property_inputs?:Array<{input_index:number;name:string;target:'props'|'key'|'ref';source_id:string;
    argument_value?:boolean;value:Record<string,unknown>|null}>;
  property_outputs?:Record<string,Record<string,unknown>|null>;
}
export interface ReactElementJoin {
  schema:'producttrace.react-element-join.v1';status:'resolved'|'unresolved';reason:string|null;
  observation_id?:string;runtime_observed:boolean;source:Record<string,unknown>|null;runtime:Record<string,unknown>|null;
}
export interface ReactLazyCommitObservation extends Record<string,unknown> {
  schema:'producttrace.react-lazy-commit.v1';kind:'react_lazy_commit';session:string;
  map_fingerprint:string;manifest_key:string;source_call_id:string;semantic_id:string;
  observation_id:string;occurrence_id:string;evidence_ids:string[];runtime_observed:true;
  allocation_observation_id:string;loader_observation_id:string|null;settlement_observation_id:string|null;
  lazy_identity:string;thenable_identity:string|null;module_identity:string|null;component_identity:string|null;
  fallback_boundary_commit_observation_id:string|null;reveal_boundary_commit_observation_id:string|null;
  renderer:Record<string,unknown>;frontier:string|null;
}
export interface ReactLazyCommitJoin {
  schema:'producttrace.react-lazy-commit-join.v1';status:'resolved'|'unresolved';reason:string|null;
  runtime_observed:boolean;source?:Record<string,unknown>;runtime?:Record<string,unknown>;
}

/** A class render body is not a committed output or proof of its scheduling cause. */
export interface ReactClassUpdateObservation extends Record<string,unknown> {
  schema:'producttrace.react-class-update-observation.v1';kind:'react_class_update';session:string;
  map_fingerprint:string;manifest_key:string;source_call_id:string;semantic_id:string;
  observation_id:string;occurrence_id:string;evidence_ids:string[];runtime_observed:true;
  operation:'returned'|'threw'|'callback_returned'|'callback_threw';
}
export interface ReactClassUpdateJoin {
  schema:'producttrace.react-class-update-join.v1';status:'resolved'|'unresolved';reason:string|null;
  runtime_observed:boolean;source:Record<string,unknown>|null;runtime:Record<string,unknown>|null;
}
export interface ReactClassObservation extends Record<string,unknown> {
  schema:'producttrace.react-class-observation.v1';kind:'react_class';session:string;
  map_fingerprint:string;manifest_key:string;source_call_id:string;semantic_id:string;
  observation_id:string;occurrence_id:string;evidence_ids:string[];runtime_observed:true;
  operation:'registered'|'returned'|'threw';
}
export interface ReactClassJoin {
  schema:'producttrace.react-class-join.v1';status:'resolved'|'unresolved';reason:string|null;
  runtime_observed:boolean;source:Record<string,unknown>|null;runtime:Record<string,unknown>|null;
}

export interface ReactHostObservation extends Record<string,unknown> {
  schema:'producttrace.react-host-observation.v1';kind:'react_host';session:string;
  map_fingerprint:string;manifest_key:string;source_call_id:string;semantic_id:string;
  observation_id:string;occurrence_id:string;evidence_ids:string[];runtime_observed:true;
  operation:'returned'|'threw';inputs:Record<string,unknown>;input:Record<string,unknown>;
}
export interface ReactHostJoin {
  schema:'producttrace.react-host-join.v1';status:'resolved'|'unresolved';reason:string|null;
  runtime_observed:boolean;source:Record<string,unknown>|null;runtime:Record<string,unknown>|null;
}

/** Synchronous server-render observations do not establish browser hydration. */
export interface ReactServerObservation extends Record<string,unknown> {
  schema:'producttrace.react-server-observation.v1';kind:'react_server';session:string;
  map_fingerprint:string;manifest_key:string;source_call_id:string;semantic_id:string;
  observation_id:string;occurrence_id:string;evidence_ids:string[];runtime_observed:true;
  operation:'returned'|'threw'|'component_entered'|'promise_fulfilled'|'pipe_started'|'pipe_failed'|'stream_completed'|'stream_errored'|'stream_closed'|'consumer_failed';
  creation_observation_id?:string;consumer_manifest_key?:string;consumer_source_id?:string;consumer_kind?:string;async_context_basis?:string;inputs?:Record<string,unknown>;invocations?:Array<Record<string,unknown>>;
}
export interface ReactServerJoin {
  schema:'producttrace.react-server-join.v1';status:'resolved'|'unresolved';reason:string|null;
  runtime_observed:boolean;source:Record<string,unknown>|null;runtime:Record<string,unknown>|null;
}

/** Root-handle and original-method observations; returning from render does not
 * establish that React committed the requested tree. */
export interface ReactRootObservation extends Record<string,unknown> {
  schema:'producttrace.react-root-observation.v1';kind:'react_root';session:string;
  map_fingerprint:string;manifest_key:string;source_call_id:string;semantic_id:string;
  observation_id:string;occurrence_id:string;evidence_ids:string[];runtime_observed:true;
  method:'create'|'render'|'unmount';operation:'returned'|'threw';inputs:Record<string,unknown>;
}
export interface ReactRootJoin {
  schema:'producttrace.react-root-join.v1';status:'resolved'|'unresolved';reason:string|null;
  runtime_observed:boolean;source:Record<string,unknown>|null;runtime:Record<string,unknown>|null;
}
export interface ReactRootCommitObservation extends Record<string,unknown> {
  schema:'producttrace.react-root-commit.v1';kind:'react_root_commit';session:string;
  map_fingerprint:string;manifest_key:string;source_call_id:string;semantic_id:string;
  observation_id:string;origin_observation_id:string;occurrence_id:string;evidence_ids:string[];runtime_observed:true;
  input_identity:string;renderer_root_id:string;commit_id:string;empty_tree:false;
}
export interface ReactRootCommitJoin {
  schema:'producttrace.react-root-commit-join.v1';status:'resolved'|'unresolved';reason:string|null;
  runtime_observed:boolean;source?:Record<string,unknown>;runtime?:Record<string,unknown>;
}
export interface ReactRootRecoveryObservation extends Record<string,unknown> {
  schema:'producttrace.react-root-recovery.v1';kind:'react_root_recovery';session:string;
  map_fingerprint:string;manifest_key:string;source_call_id:string;semantic_id:string;
  observation_id:string;origin_observation_id:string;occurrence_id:string;evidence_ids:string[];runtime_observed:true;
  callback_source_id:string;renderer_root_id:string;operation:'returned'|'threw';
}
export interface ReactRootRecoveryJoin {
  schema:'producttrace.react-root-recovery-join.v1';status:'resolved'|'unresolved';reason:string|null;runtime_observed:boolean;
  source?:Record<string,unknown>;runtime?:Record<string,unknown>;
}

export interface ReactPortalObservation extends Record<string,unknown> {
  schema:'producttrace.react-portal-observation.v1';kind:'react_portal';session:string;
  map_fingerprint:string;manifest_key:string;source_call_id:string;semantic_id:string;
  observation_id:string;occurrence_id:string;evidence_ids:string[];runtime_observed:true;
  operation:'returned'|'threw';inputs:Record<string,unknown>;fields?:Record<string,unknown>;
}
export interface ReactPortalJoin {
  schema:'producttrace.react-portal-join.v1';status:'resolved'|'unresolved';reason:string|null;
  observation_id?:string;runtime_observed:boolean;source:Record<string,unknown>|null;runtime:Record<string,unknown>|null;
}
export interface ReactPortalCommitObservation extends Record<string,unknown> {
  schema:'producttrace.react-portal-commit.v1';kind:'react_portal_commit';session:string;
  map_fingerprint:string;manifest_key:string;source_call_id:string;semantic_id:string;
  observation_id:string;occurrence_id:string;evidence_ids:string[];runtime_observed:true;
  operation:'committed'|'unmounted';origin_observation_id:string;renderer:Record<string,unknown>;
}
export interface ReactPortalCommitJoin {
  schema:'producttrace.react-portal-commit-join.v1';status:'resolved'|'unresolved';reason:string|null;
  runtime_observed:boolean;source?:Record<string,unknown>|null;runtime?:Record<string,unknown>|null;
}

export interface ReactCallbackJoin {
  schema: 'producttrace.react-callback-join.v1';
  status: 'resolved' | 'unresolved';
  reason: string | null;
  runtime_observed: boolean;
  map_fingerprint: string;
  observation_id: string | null;
  source: Record<string, unknown> | null;
  runtime?: Record<string, unknown> | null;
}

/** A source tag observed on the exact function object passed to a scope.
 * The tag proves source identity; it does not prove a render was committed. */
export interface ReactCallbackSourceObservation {
  schema: 'producttrace.react-callback-source.v1';
  kind: 'react_callback_source';
  map_fingerprint: string;
  source_id: string;
  callback_identity_id: string;
  observation_id: string;
  occurrence_id: string;
  evidence_ids: string[];
  runtime_observed: true;
  session: string;
}

export interface ReactCallbackSourceJoin {
  schema: 'producttrace.react-callback-source-join.v1';
  status: 'resolved' | 'unresolved';
  reason: string | null;
  runtime_observed: boolean;
  source: {source_id: string} | null;
  runtime: {observation_id: string; callback_identity_id: string} | null;
}

export interface ReactContextOriginObservation extends Record<string,unknown> {
  schema:'producttrace.react-context-origin.v1';kind:'react_context_origin';map_fingerprint:string;source_call_id:string;
  source_context_id:string;semantic_id:string;session:string;observation_id:string;runtime_observed:true;
}
export interface ReactContextOriginJoin {
  schema:'producttrace.react-context-origin-join.v1';status:'resolved'|'unresolved';reason:string|null;runtime_observed:boolean;
  origin?:Record<string,unknown>;
}
export interface ReactFrontierJoin {
  schema:'producttrace.react-frontier-join.v1';status:'unresolved';reason:string;runtime_observed:boolean;
  source:{source_call_id:string;callback_source_id:string}|null;
  runtime:{observation_id:string;operation:string;owner_proven:false}|null;
}
export interface ReactRefObservation {
  schema: 'producttrace.react-ref-observation.v1';
  kind: 'react_ref';
  map_fingerprint: string;
  manifest_key: string;
  source_call_id: string;
  source_access_id: string | null;
  semantic_id: string;
  surface: string;
  export: string;
  observation_id: string;
  occurrence_id: string;
  evidence_ids: string[];
  session: string;
  operation: 'returned' | 'threw' | 'read' | 'write' | 'invoke' | 'host_attached' | 'hook_committed';
  runtime_observed: true;
  [key: string]: unknown;
}

export interface ReactRefJoin {
  schema: 'producttrace.react-ref-join.v1';
  status: 'resolved' | 'unresolved';
  reason: string | null;
  runtime_observed: boolean;
  source: Record<string, unknown> | null;
  runtime: Record<string, unknown> | null;
}

export interface ReactApiObservation {
  schema: 'producttrace.react-api-observation.v1';
  kind: 'react_api';
  map_fingerprint: string;
  manifest_key: string;
  observation_id: string;
  occurrence_id: string;
  evidence_ids: string[];
  source_call_id: string;
  semantic_id: string;
  surface: string;
  export: string;
  operation: 'invoked' | 'read' | 'threw' | 'element_created';
  boundary_value?:{usage:string;reason?:string;value_type?:string;marker?:string|null;element_marker?:string|null};
  scope?: Record<string,unknown>;
  predicate_result?: {encoding:'primitive'|'redacted';value:unknown};
  result_kind: string;
  export_build?: 'development' | 'production' | null;
  export_value?: {encoding:'primitive'|'redacted'|'opaque_identity';value:unknown};
  runtime_observed: true;
  session?: string;
  seq?: number;
  react_lifecycle_identity?: Record<string, unknown> | null;
}

export interface ReactApiJoin {
  schema: 'producttrace.react-api-join.v1';
  status: 'resolved' | 'unresolved';
  reason: string | null;
  runtime_observed: boolean;
  map_fingerprint: string;
  observation_id: string | null;
  source: Record<string, unknown> | null;
  runtime: Record<string, unknown> | null;
}

export interface ReactLifecycleManifest {
  schema: 'producttrace.react-lifecycle-manifest.v1';
  map_fingerprint: string;
  frontiers: Array<{source_call_id:string;semantic_id:string;reason:string}>;
  entries: Array<{ key: string; kind: 'api_call' | 'api_value' | 'api_boundary' | 'component_render' | 'callback' | 'callback_tag' | 'callback_source_tag' |
    'retained_callback' | 'retained_result' | 'memo_result' | 'state_result' | 'state_dispatch' | 'context_create' | 'context_read' | 'context_provider' | 'context_consumer_callback' |
    'server_component' | 'server_consumer' | 'event_callback' | 'ref_access' | 'wrapper_return' | 'wrapper_callback'; [key: string]: unknown }>;
}

export interface ReactRuntimeIntegration {
  schema: 'producttrace.react-runtime-integration.v1';
  map_fingerprint: string;
  bindings: { name: string; identity: Record<string, never>; react_lifecycle: ReactLifecycleManifest; actions: Array<{
    event: string; component: string; sourceControl: string; action: string;
  }> };
  diagnostics: Array<{ code: string; control_id: string; competing_control_ids?: string[]; message: string }>;
  candidates: Array<Record<string, unknown>>;
  request_bridge: null | {
    schema: 'producttrace.browser-request-bridge-manifest.v1';
    map_fingerprint: string;
    actions: Array<{ action: string; event: string; source_control: string;
      requests: Array<{ contract_application_id: string; invocation_call_id: string; method: string }> }>;
  };
  instrumentSource(file: string, source: string): {
    code: string;
    applied: Array<{ file: string; node_id: string; event: string; control_id: string | null;
      transform?: 'source_stamp' | 'request_bridge_handler' | 'request_bridge_request' |
        'react_component_render' | 'react_callback' | 'react_callback_tag' |
        'react_context_create' | 'react_context_read' | 'react_context_provider' |
        'react_context_consumer_callback' | 'react_event_callback' | 'react_callback_source_tag' |
        'react_host_call' | 'react_host_argument' | 'react_server_call' | 'react_server_argument' | 'react_server_component' | 'react_server_pipe' | 'react_server_event' | 'react_server_async_iteration' | 'react_server_promise_fulfilled' | 'react_root_call' | 'react_root_argument' | 'react_root_method' | 'react_root_recovery_source' | 'react_element_call' | 'react_portal_call' | 'react_shared_retained_result' | 'react_shared_retained_body' | 'react_shared_retained_factory' | 'react_ref_call' | 'react_ref_argument' | 'react_ref_access' | 'react_scope_call' | 'react_scope_argument' | 'react_api_call' | 'react_api_value' | 'react_retained_callback' | 'react_retained_result' | 'react_memo_result' | 'react_state_result' | 'react_state_dispatch' }>;
    diagnostics: Array<{ code: string; file: string; node_id?: string; message: string }>;
  };
  join(record: Record<string, unknown>): ReactRuntimeJoin | null;
  joinCallback(record: ReactCallbackObservation): ReactCallbackJoin;
  joinClassUpdate(record:ReactClassUpdateObservation):ReactClassUpdateJoin;
  joinClass(record:ReactClassObservation):ReactClassJoin;
  joinHost(record:ReactHostObservation):ReactHostJoin;
  joinServer(record:ReactServerObservation):ReactServerJoin;
  joinRoot(record: ReactRootObservation): ReactRootJoin;
  joinRootCommit(record:ReactRootCommitObservation):ReactRootCommitJoin;
  joinRootRecovery(record:ReactRootRecoveryObservation):ReactRootRecoveryJoin;
  joinElement(record: ReactElementObservation): ReactElementJoin;
  joinLazyCommit(record:ReactLazyCommitObservation):ReactLazyCommitJoin;
  joinIdCommit(record:Record<string,unknown>):{schema:'producttrace.react-id-commit-join.v1';status:'resolved'|'unresolved';reason:string|null;runtime_observed:boolean;runtime?:Record<string,unknown>};
  joinPredicateUse(record:ReactPredicateUseObservation):{schema:'producttrace.react-predicate-use-join.v1';status:'resolved'|'unresolved';reason:string|null;runtime_observed:boolean;runtime?:Record<string,unknown>};
  joinBoundaryCommit(record:Record<string,unknown>):{schema:'producttrace.react-boundary-commit-join.v1';status:'resolved'|'unresolved';reason:string|null;runtime_observed:boolean;runtime?:Record<string,unknown>};
  joinPortalCommit(record:ReactPortalCommitObservation):ReactPortalCommitJoin;
  joinStrictReplay(record:Record<string,unknown>):{schema:'producttrace.react-boundary-commit-join.v1';status:'resolved'|'unresolved';reason:string|null;runtime_observed:boolean;runtime?:Record<string,unknown>};
  joinPortal(record:ReactPortalObservation):ReactPortalJoin;
  joinSharedCallback(record:ReactSharedCallbackObservation):ReactSharedCallbackJoin;
  joinCallbackSource(record: ReactCallbackSourceObservation): ReactCallbackSourceJoin;
  joinContextOrigin(record: ReactContextOriginObservation): ReactContextOriginJoin;
  joinFrontier(record: Record<string, unknown>): ReactFrontierJoin;
  joinRef(record: ReactRefObservation): ReactRefJoin;
  joinApi(record: ReactApiObservation): ReactApiJoin;
  joinWrapper(record:Record<string,unknown>):ReactWrapperJoin;
  joinLifecycle(record: ReactLifecycleObservation): ReactLifecycleJoin;
  createApiRuntime(options?: { session?: string; onObservation?(record: ReactPredicateUseObservation | ReactProfilerObservation | ReactClassUpdateObservation | ReactClassObservation | ReactHostObservation | ReactServerObservation | ReactRootObservation | ReactRootCommitObservation | ReactRootRecoveryObservation | ReactElementObservation | ReactPortalObservation | ReactApiObservation | ReactCallbackSourceObservation | ReactContextOriginObservation | ReactRefObservation): void }): {
    schema: 'producttrace.react-api-runtime.v1'; session: string;
    tagSource<T>(sourceId: string, value: T, readers?: () => Array<[string, () => unknown]>, inferredName?: string): T;
    registerContext<T>(key: string, value: T): T;
    contextCall<T>(key: string, run: () => T): T;
    contextArgument<T>(key: string, index: number, value: T): T;
    contextReadEvidence(context: unknown, value: unknown, provider: {status:string;raw_value?:unknown}|null): Record<string,unknown>|null;
    hostCall<T>(key:string,run:()=>T):T;
    hostArgument<T>(key:string,index:number,value:T):T;
    classUpdateCall<T>(key:string,receiver:unknown,run:()=>T):T;
    classUpdateMethod(key:string,receiver:unknown,callee:Function):Function;
    classUpdateArgument<T>(key:string,index:number,value:T):T;
    classUpdateCallback<T>(key:string,index:number,factory:(observe:Function)=>T):T;
    classRegister<T>(key:string,value:T,ownerRef:unknown):T;
    classRender<T>(key:string,receiver:unknown,run:()=>T):T;
    classRead<T>(key:string,sourceId:string,field:string,value:T):T;
    serverCall<T>(key:string,run:()=>T):T;
    serverArgument<T>(key:string,index:number,value:T):T;
    serverComponent(sourceId:string,self:Function,args:IArguments):void;
    serverPromiseFulfilled<T>(key:string,promise:PromiseLike<T>,value:T):T;
    serverPipe<T,R>(key:string,resource:T,destination:R,invoke:(resource:T,destination:R)=>unknown):unknown;
    serverEvent(key:string,resource:unknown,event:'end'|'finish'|'error'|'close'):void;
    serverIteration(key:string,resource:unknown,outcome:'completed'|'consumer_failed'):void;
    rootCall<T>(key:string,run:()=>T):T;
    rootArgument<T>(key:string,index:number,value:T):T;
    rootMethod(key:string,receiver:object,name:'render'|'unmount'):(...args:unknown[])=>unknown;
    rootRecovery<T extends Function>(key:string,sourceId:string,callback:T):T;
    elementTarget<T>(key:string,value:T):T;
    elementCall<T>(key:string,run:()=>T):T;
    elementArgument<T>(key:string,index:number,value:T):T;
    portalCall<T>(key:string,run:()=>T):T;
    portalArgument<T>(key:string,index:number,value:T):T;
    refCall<T>(key: string, run: () => T): T;
    refArgument<T>(key: string, index: number, value: T): T;
    refMethod(key: string, target: object): (...args: unknown[]) => unknown;
    refRead<T = unknown>(key: string, target: object): T;
    refWrite<T>(key: string, target: object, value: T): T;
    scopeCall<T>(key: string, run: () => T): T;
    scopeArgument<T>(key: string, index: number, value: T, readers?: () => Array<[string, () => unknown]>): T;
    predicateFrame():object;
    predicateCall<T>(key:string,frame:object,run:()=>T):T;
    predicateUse<T>(key:string,frame:object,value:T):T;
    profilerDefine<T extends (...args:any[])=>any>(key:string,factory:(observe:<R>(args:ArrayLike<unknown>,body:()=>R)=>R)=>T,name?:string):T;
    boundaryResult(key:string,value:unknown):unknown;
    apiResult(key: string, value: unknown): unknown;
    apiValue(key: string, value: unknown): unknown;
  };
  onRecord(record: Record<string, unknown>): void | Promise<void>;
}

export declare function createReactRuntimeIntegration(
  map: ReactMap,
  options?: { name?: string; requestBridge?: boolean;
    onJoin?: (join: ReactHostJoin | ReactServerJoin | ReactRootJoin | ReactRootCommitJoin | ReactRootRecoveryJoin | ReactElementJoin | ReactPortalJoin | ReactPortalCommitJoin | ReactSharedCallbackJoin | ReactRuntimeJoin | ReactCallbackJoin | ReactCallbackSourceJoin | ReactFrontierJoin | ReactContextOriginJoin | ReactRefJoin | ReactApiJoin | ReactLifecycleJoin | ReactWrapperJoin, record: Record<string, unknown>) => void | Promise<void> },
): ReactRuntimeIntegration;
