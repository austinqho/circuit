import { matchRequestToRoute } from './request-route-match.mjs';

const SCHEMA = 'producttrace.request-handler-bridge.v1';

function copy(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function outcome(status, reason, frontend, observation, sourceRequest, routeJoin, backendMap) {
  const route = routeJoin?.match || null;
  const sourceNodes = backendMap?.source_nodes || [];
  const entryHandlerLabels = route?.handler_ids?.map(id =>
    sourceNodes.find(node => node.id === id)?.text || null) || [];
  return {
    schema: SCHEMA,
    status,
    reason,
    frontend: frontend ? {
      map_fingerprint: frontend.map_fingerprint,
      action_occurrence_id: frontend.runtime?.action_occurrence_id || null,
      control_id: frontend.source?.control_id || null,
      scenario_id: frontend.source?.scenario_id || null,
    } : null,
    request: observation ? copy(observation) : null,
    source_request: sourceRequest ? copy(sourceRequest) : null,
    route_join: routeJoin ? copy(routeJoin) : null,
    handler: route ? {
      route_id: route.id,
      entry_handler_ids: copy(route.handler_ids),
      entry_handler_labels: entryHandlerLabels,
      middleware_ids: copy(route.middleware_ids),
      middleware_resolution: copy(route.middleware_resolution || {
        status: 'unknown', reason: 'middleware_resolution_unavailable', evidence_ids: [],
      }),
      implementation: copy(route.handler_resolution || {
        status: 'unknown', reason: 'handler_resolution_unavailable', evidence_ids: [],
      }),
      backend_execution: 'unconfirmed',
    } : null,
  };
}

function requireObservation(observation) {
  return observation && observation.schema === 'producttrace.http-request-observation.v1'
    && observation.basis === 'runtime_observation'
    && typeof observation.request_occurrence_id === 'string' && observation.request_occurrence_id
    && typeof observation.action_occurrence_id === 'string' && observation.action_occurrence_id
    && typeof observation.map_fingerprint === 'string' && observation.map_fingerprint
    && typeof observation.contract_application_id === 'string' && observation.contract_application_id
    && typeof observation.method === 'string' && typeof observation.url === 'string';
}

/**
 * Connect one observed browser request to one source request call and then to
 * the backend registration that would receive it. The three occurrence IDs
 * must come from runtime instrumentation; this module never reconstructs them
 * from timing, labels, or URL similarity.
 */
export function connectRequestToHandler(frontendJoin, observation, backendMap) {
  if (!frontendJoin || frontendJoin.schema !== 'producttrace.react-runtime-join.v1') {
    throw new TypeError('frontendJoin must be a producttrace.react-runtime-join.v1 result');
  }
  if (!backendMap || backendMap.schema !== 'producttrace.backend-route-map.v1'
      || !Array.isArray(backendMap.routes)) {
    throw new TypeError('backendMap must be a producttrace.backend-route-map.v1 result');
  }
  if (frontendJoin.status !== 'resolved' || !frontendJoin.source) {
    return outcome('unresolved', 'frontend_join_unresolved', frontendJoin, observation, null, null, backendMap);
  }
  if (!requireObservation(observation)) {
    return outcome('unresolved', 'invalid_request_observation', frontendJoin, observation, null, null, backendMap);
  }
  if (observation.map_fingerprint !== frontendJoin.map_fingerprint) {
    return outcome('unresolved', 'source_map_mismatch', frontendJoin, observation, null, null, backendMap);
  }
  if (!frontendJoin.runtime.action_occurrence_id
      || observation.action_occurrence_id !== frontendJoin.runtime.action_occurrence_id) {
    return outcome('unresolved', 'action_occurrence_mismatch', frontendJoin, observation, null, null, backendMap);
  }
  const candidates = frontendJoin.source.path?.outbound_requests || [];
  const matching = candidates.filter(candidate =>
    candidate.contract_application_id === observation.contract_application_id);
  if (matching.length !== 1) {
    return outcome(matching.length ? 'ambiguous' : 'unresolved',
      matching.length ? 'duplicate_source_request_identity' : 'unknown_source_request_identity',
      frontendJoin, observation, null, null, backendMap);
  }
  const [sourceRequest] = matching;
  const expectedMethod = sourceRequest.effect?.method?.toUpperCase();
  if (!expectedMethod || expectedMethod !== observation.method.trim().toUpperCase()) {
    return outcome('unresolved', 'request_method_mismatch', frontendJoin, observation, sourceRequest, null, backendMap);
  }

  const routeJoin = matchRequestToRoute({
    basis: 'runtime_observation',
    method: observation.method,
    url: observation.url,
    ...(observation.service === undefined ? {} : { service: observation.service }),
    ...(observation.application_id === undefined ? {} : { application_id: observation.application_id }),
    evidence_ids: observation.evidence_ids || [observation.request_occurrence_id],
  }, backendMap);
  if (routeJoin.status !== 'resolved') {
    return outcome(routeJoin.status, routeJoin.status === 'ambiguous' ? 'route_match_ambiguous' : 'route_match_unresolved',
      frontendJoin, observation, sourceRequest, routeJoin, backendMap);
  }
  return outcome('resolved', 'source_request_to_route', frontendJoin, observation, sourceRequest, routeJoin, backendMap);
}

export const REQUEST_HANDLER_BRIDGE_SCHEMA = SCHEMA;
