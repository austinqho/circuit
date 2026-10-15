export type RequestBasis = 'source_candidate' | 'runtime_observation';

export interface RequestCandidateOrObservation {
  method: string;
  url: string;
  /** Deployment identity. When supplied, only a route with the same identity may match. */
  service?: string;
  application_id?: string;
  /** Defaults to source_candidate. A runtime observation confirms the request, not handler execution. */
  basis?: RequestBasis;
  evidence_ids?: string[];
}

export interface BackendRouteRecord {
  id: string;
  framework: string;
  method: string;
  path_template: string;
  handler_ids: string[];
  middleware_ids: string[];
  evidence_ids: string[];
  service?: string;
  service_id?: string | null;
  /** Source registration order for frameworks, such as Express, whose dispatch is order-sensitive. */
  registration_order?: number;
  application_id?: string;
  ambiguity?: null | { code: string; [key: string]: unknown };
  handler_resolution?: { status: string; reason: string | null; evidence_ids: string[] };
  middleware_resolution?: { status: string; reason: string | null; evidence_ids: string[] };
}

export interface BackendRouteInventory {
  schema: 'producttrace.backend-route-map.v1';
  service_id?: string | null;
  routes: BackendRouteRecord[];
  frontiers: BackendRouteFrontierRecord[];
}

export interface BackendRouteFrontierRecord {
  id: string;
  framework: string;
  method: string;
  path_prefix: string | null;
  application_id: string;
  service_id?: string | null;
  evidence_ids: string[];
}

export interface NormalizedRequest {
  basis: RequestBasis;
  method: string | null;
  url: string | null;
  path: string | null;
  query: Array<{ name: string; value: string }>;
  service: string | null;
  application_id: string | null;
  evidence_ids: string[];
}

export type RequestRouteJoinReason =
  | 'unique_route_match'
  | 'framework_registration_order'
  | 'path_specificity'
  | 'invalid_request_method'
  | 'invalid_request_service'
  | 'invalid_request_url'
  | 'dynamic_request_url'
  | 'relative_request_url_without_base'
  | 'unsupported_request_protocol'
  | 'empty_route_inventory'
  | 'backend_inventory_gap'
  | 'request_application_required'
  | 'request_service_required'
  | 'invalid_request_application'
  | 'no_service_match'
  | 'no_application_match'
  | 'no_method_match'
  | 'no_path_match'
  | 'unsupported_dynamic_route_template'
  | 'inventory_route_ambiguity'
  | 'mixed_framework_precedence'
  | 'framework_route_order_unavailable'
  | 'framework_precedence_unknown'
  | 'duplicate_route_precedence';

export interface RequestRouteJoin {
  schema: 'producttrace.request-route-join.v1';
  status: 'resolved' | 'ambiguous' | 'unresolved';
  reason: RequestRouteJoinReason;
  request: NormalizedRequest;
  match: BackendRouteRecord | null;
  candidates: Array<BackendRouteRecord | BackendRouteFrontierRecord>;
  /** Route matching predicts a handler. Backend span evidence confirms execution later. */
  handler_confirmation: 'source_route_match_only';
}

export declare function matchRequestToRoute(
  request: RequestCandidateOrObservation,
  routes: BackendRouteRecord[] | BackendRouteInventory,
): RequestRouteJoin;

export declare const REQUEST_ROUTE_JOIN_SCHEMA: 'producttrace.request-route-join.v1';
