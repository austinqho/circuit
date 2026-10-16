import type { ReactFrontendOutboundRequest, ReactRuntimeJoin } from './runtime-join.mjs';
import type { BackendRouteMap } from './backend-routes.mjs';
import type { RequestRouteJoin } from './request-route-match.mjs';

export interface HttpRequestObservation {
  schema: 'producttrace.http-request-observation.v1';
  basis: 'runtime_observation';
  /** Unique even when one source call runs repeatedly during one action. */
  request_occurrence_id: string;
  /** Exact captured action identity propagated from the listener. */
  action_occurrence_id: string;
  /** Source map active when the outbound call was instrumented. */
  map_fingerprint: string;
  /** Exact outbound contract application stamped at the call site. */
  contract_application_id: string;
  method: string;
  url: string;
  service?: string;
  application_id?: string;
  evidence_ids?: string[];
  trace_context?: {
    schema: 'producttrace.trace-context.v1';
    trace_id: string;
    span_id: string;
    trace_flags: string;
    traceparent: string;
  };
}

export interface RequestHandlerBridge {
  schema: 'producttrace.request-handler-bridge.v1';
  status: 'resolved' | 'ambiguous' | 'unresolved';
  reason: 'source_request_to_route' | 'frontend_join_unresolved' | 'invalid_request_observation'
    | 'source_map_mismatch' | 'action_occurrence_mismatch' | 'unknown_source_request_identity'
    | 'duplicate_source_request_identity' | 'request_method_mismatch'
    | 'route_match_ambiguous' | 'route_match_unresolved';
  frontend: null | { map_fingerprint: string; action_occurrence_id: string | null;
    control_id: string | null; scenario_id: string | null };
  request: HttpRequestObservation | null;
  source_request: ReactFrontendOutboundRequest | null;
  route_join: RequestRouteJoin | null;
  handler: null | {
    route_id: string;
    entry_handler_ids: string[];
    entry_handler_labels: Array<string | null>;
    middleware_ids: string[];
    middleware_resolution: { status: string; reason: string | null; evidence_ids: string[] };
    implementation: { status: string; reason: string | null; evidence_ids: string[] };
    /** OpenTelemetry or equivalent backend evidence must upgrade this later. */
    backend_execution: 'unconfirmed' | 'confirmed';
    backend_evidence?: {
      status: 'unresolved' | 'ambiguous' | 'confirmed';
      reason: string;
      trace_id: string | null;
      server_span_id: string | null;
      handler_span_ids: string[];
      database_span_ids: string[];
      database_operations: Array<{
        span_id: string;
        system: string;
        operation: string;
        namespace: unknown | null;
        collection: unknown | null;
        instrumentation: string | null;
      }>;
      evidence_ids: string[];
    };
  };
}

export declare function connectRequestToHandler(
  frontendJoin: ReactRuntimeJoin,
  observation: HttpRequestObservation,
  backendMap: BackendRouteMap,
): RequestHandlerBridge;

export declare const REQUEST_HANDLER_BRIDGE_SCHEMA: 'producttrace.request-handler-bridge.v1';
