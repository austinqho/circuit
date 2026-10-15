export interface BackendSourceNode {
  id: string;
  kind: string;
  file: string;
  start: number;
  end: number;
  text: string;
}

export interface BackendRouteMount {
  router_id: string;
  prefix: string;
  source_node_id: string;
  evidence_ids: string[];
}

export interface BackendRoute {
  id: string;
  framework: 'express';
  method: string;
  path_template: string;
  mount_chain: BackendRouteMount[];
  middleware_ids: string[];
  terminal_handler_ids: string[];
  /** Alias of terminal_handler_ids for request-to-route consumers. */
  handler_ids: string[];
  /** Root Express application occurrence that owns this registration. */
  application_id: string;
  service_id: string | null;
  source_node_id: string;
  evidence_ids: string[];
  registration_order: number;
  /** Whether more than one registration could receive the same method/path. */
  ambiguity: null | { code: 'multiple_matching_registrations'; competing_route_ids: string[] };
  middleware_resolution:
    | { status: 'resolved'; reason: null; evidence_ids: [] }
    | { status: 'unresolved'; reason: 'unresolved_handler_implementation'; evidence_ids: string[] };
  /** Route selection and handler-implementation resolution are separate facts. */
  handler_resolution:
    | { status: 'resolved'; reason: null; evidence_ids: [] }
    | { status: 'unresolved'; reason: 'unresolved_handler_implementation'; evidence_ids: string[] };
}

export interface BackendRouteFrontier {
  id: string;
  framework: 'express';
  method: string;
  /** Null means the omitted registration could match any path. */
  path_prefix: string | null;
  application_id: string;
  service_id: string | null;
  owner_id: string;
  mount_chain: BackendRouteMount[];
  source_node_id: string;
  evidence_ids: string[];
  reason: 'unresolved_route_registration';
}

export interface BackendRouteMap {
  schema: 'producttrace.backend-route-map.v1';
  fingerprint: string;
  service_id: string | null;
  files: Array<{ path: string; sha256: string }>;
  source_nodes: BackendSourceNode[];
  routes: BackendRoute[];
  frontiers: BackendRouteFrontier[];
  diagnostics: Array<{
    code: string;
    file: string | null;
    source_node_id?: string;
    message: string;
    router_id?: string;
  }>;
}

export declare function compileBackendRoutes(
  files: Record<string, string>,
  options?: { serviceId?: string },
): BackendRouteMap;
export declare const BACKEND_ROUTE_SCHEMA: 'producttrace.backend-route-map.v1';
