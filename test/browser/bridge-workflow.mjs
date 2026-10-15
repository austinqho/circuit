function sourceReference(node) {
  if (!node) return null;
  return {
    node_id: node.id,
    file: node.file,
    start: node.start,
    end: node.end,
    text: node.text,
  };
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

/**
 * Converts the analyzer's detailed bridge result into the compact workflow
 * record used by the live viewer. Every displayed proof fact states what was
 * established and why it is safe to use for learning.
 */
export function buildBridgeWorkflow(result, action, backendMap, frontendJoin) {
  const request = result.request || {};
  const routeJoin = result.route_join || {};
  const route = routeJoin.match;
  const sourceNodes = backendMap?.source_nodes || [];
  const routeNode = sourceNodes.find(node => node.id === route?.source_node_id);
  const handlerId = result.handler?.entry_handler_ids?.[0];
  const handlerNode = sourceNodes.find(node => node.id === handlerId);
  const resolved = result.status === 'resolved';
  const backendConfirmed = result.handler?.backend_execution === 'confirmed';
  const backendEvidence = result.handler?.backend_evidence;
  const databaseOperations = backendEvidence?.database_operations || [];
  const databaseObserved = databaseOperations.length > 0;
  const requestPath = routeJoin.request?.path || request.url;
  const routeLabel = route ? `${route.method} ${route.path_template}` : null;
  const handlerLabel = handlerNode?.text || handlerId || null;
  const caption = backendConfirmed
    ? `Confirmed ${request.method} ${requestPath} ran ${handlerLabel}.`
    : resolved
    ? `Mapped ${request.method} ${requestPath} to ${handlerLabel}.`
    : `Request mapping stopped: ${result.reason}.`;

  const sourcePath = frontendJoin?.source?.path;
  const transport = result.source_request;
  const controlLabel = action.target?.text || action.target?.aria || 'Observed control';
  const redirects = (sourcePath?.library_contracts || []).flatMap(contract => {
    if (contract.effect?.kind === 'http_request') return [];
    if (contract.returned_member && contract.invokes_option) {
      return [`${contract.package}.${contract.returned_member}`, contract.invokes_option];
    }
    return [contract.package].filter(Boolean);
  });
  const frontendChain = [controlLabel, ...redirects,
    transport?.package && `${transport.package}.${transport.effect?.method?.toLowerCase() || 'request'}`]
    .filter(Boolean).join(' → ');

  const proofFacts = [
    {
      kind: 'source_control',
      label: 'Clicked source control',
      value: action.target?.source_control || 'Unavailable',
      reason: 'The browser control carried the exact analyzer-issued source stamp for this rendered control.',
      evidence_ids: unique([action.evidence_id, action.target?.source_control]),
    },
    {
      kind: 'frontend_path',
      label: 'Frontend callback path',
      value: frontendChain || 'Unavailable',
      reason: 'Source call edges plus exact-version library contracts connect this action scenario to one outbound request call.',
      evidence_ids: unique([
        result.frontend?.scenario_id,
        ...(sourcePath?.library_contracts || []).map(contract => contract.id),
        transport?.contract_application_id,
      ]),
    },
    {
      kind: 'runtime_request',
      label: 'Observed browser request',
      value: `${request.method || 'UNKNOWN'} ${request.url || 'Unavailable'}`,
      reason: 'The request was observed at runtime inside the exact outbound call associated with this click occurrence.',
      evidence_ids: unique([request.request_occurrence_id, ...(request.evidence_ids || [])]),
    },
    route && {
      kind: 'route_registration',
      label: 'Matched backend route',
      value: `${routeLabel} · ${routeNode?.text || route.id}`,
      reason: 'The observed method, normalized path, service, application, registration order, and mount chain selected one backend route.',
      source: sourceReference(routeNode),
      evidence_ids: unique([route.id, ...(route.evidence_ids || [])]),
    },
    handlerId && {
      kind: 'handler_reference',
      label: 'Registered handler',
      value: handlerLabel,
      reason: 'This is the callback reference registered on the uniquely matched backend route.',
      source: sourceReference(handlerNode),
      evidence_ids: unique([handlerId]),
    },
    backendEvidence?.server_span_id && {
      kind: 'backend_server_span',
      label: 'Observed backend request',
      value: `${request.method} ${requestPath} · trace ${backendEvidence.trace_id}`,
      reason: 'The OpenTelemetry HTTP server span has the browser request span as its exact W3C parent and agrees on service, method, and route.',
      evidence_ids: unique([backendEvidence.server_span_id, backendEvidence.trace_id]),
    },
    backendConfirmed && {
      kind: 'backend_handler_span',
      label: 'Executed backend handler',
      value: handlerLabel,
      reason: 'A ProductTrace OpenTelemetry callback span recorded this exact registered handler inside the matched server request trace.',
      evidence_ids: unique(backendEvidence.handler_span_ids),
    },
    databaseObserved && {
      kind: 'database_operation_span',
      label: 'Observed database operation',
      value: databaseOperations.map(operation => {
        const target = [operation.namespace, operation.collection].filter(Boolean).join('.');
        return `${operation.system} ${operation.operation}${target ? ` · ${target}` : ''}`;
      }).join('\n'),
      reason: 'Each OpenTelemetry database client span is a descendant of the executed handler in this exact request trace.',
      evidence_ids: unique(backendEvidence.database_span_ids),
    },
  ].filter(Boolean);

  return {
    kind: 'workflow_event', schema: 'producttrace.workflow-event.v1',
    event_type: resolved ? 'product.workflow_completed' : 'product.workflow_incomplete',
    event_id: `${request.request_occurrence_id}:bridge`,
    workflow_id: request.action_occurrence_id,
    session_id: action.session,
    ts: Date.now(),
    properties: {
      caption,
      workflow_label: `Trace ${controlLabel} to its backend handler`,
      workflow_status: resolved ? 'completed' : 'incomplete',
      checkpoint: {
        index: 1, caption, type: 'request_route_bridge',
        action_occurrence_id: request.action_occurrence_id,
        source_action: action.action,
        source_control: action.target?.source_control || null,
        react_identity: action.react_identity || null,
        react_lifecycle_identity: action.react_lifecycle_identity || null,
        trigger: { event: action.event, label: controlLabel },
        control: action.target || {}, entities: {},
        outcome: {
          observed_effects: [{ type: 'network_request',
            surfaces: [{ anchor: { value: `${request.method} ${requestPath}` } }] }],
          business_result: backendConfirmed
            ? databaseObserved
              ? 'Backend invoked the registered handler and issued the observed database operation.'
              : 'Backend received the exact browser request and invoked the registered handler.'
            : 'Request-to-handler path mapped; backend execution remains unconfirmed.',
        },
        evidence: {
          ids: unique(proofFacts.flatMap(fact => fact.evidence_ids || [])),
          count: proofFacts.length,
          omitted: 0,
          facts: proofFacts,
        },
        uncertainty: databaseObserved
          ? ['The database operation ran; returned rows, response contents, and the resulting UI update are not yet proven.']
          : backendConfirmed
          ? ['The handler ran; its downstream database operation and product outcome are not yet proven.']
          : resolved ? ['Backend execution is unconfirmed until backend telemetry arrives.'] : [result.reason],
      },
      summary: {
        reason: result.reason,
        steps: [{ index: 1, caption, type: 'request_route_bridge' }],
        terminal_result_proven: false,
        business_result: backendConfirmed
          ? databaseObserved
            ? 'Backend invoked the registered handler and issued the observed database operation.'
            : 'Backend received the exact browser request and invoked the registered handler.'
          : 'Request-to-handler path mapped; backend execution remains unconfirmed.',
        backend_execution: backendConfirmed ? 'confirmed' : 'unconfirmed',
        database_execution: databaseObserved ? 'observed' : 'unobserved',
        route_id: route?.id || null,
        route: routeLabel,
        route_registration: sourceReference(routeNode),
        handler_reference: handlerLabel,
        handler_source: sourceReference(handlerNode),
      },
      entities: {},
      learning: {
        standalone_training_signal: false,
        use: backendConfirmed
          ? databaseObserved
            ? 'Eligible as evidence for this click-to-request-to-backend-handler-to-database execution; retain the response and UI outcome gap.'
            : 'Eligible as evidence for this click-to-request-to-backend-handler execution; retain the downstream outcome gap.'
          : 'Eligible as evidence for the click-to-request-to-route mapping; not as proof of backend execution or the final business outcome.',
        reason: backendConfirmed
          ? databaseObserved
            ? 'Exact trace ancestry connects the browser request, registered handler callback, and database client operation.'
            : 'Exact browser and backend trace context plus the registered callback span prove this handler invocation.'
          : 'The route and registered handler are source-resolved, while backend runtime telemetry is still absent.',
      },
    },
  };
}

/** An observed DOM click is useful coverage evidence, but proves no source path. */
export function buildClickFrontierWorkflow(frontier) {
  const caption = `Unresolved path for ${String(frontier.label || 'clicked control')}`;
  const reason = 'No verified control-to-request path is available for this click.';
  return {
    kind: 'workflow_event', schema: 'producttrace.workflow-event.v1',
    event_type: 'product.workflow_incomplete', event_id: `${frontier.occurrence}:frontier`,
    workflow_id: frontier.occurrence, session_id: frontier.occurrence, ts: Date.now(),
    properties: {
      caption, workflow_label: caption, workflow_status: 'incomplete',
      checkpoint: { index: 1, caption, type: 'source_frontier',
        evidence: { ids: [frontier.occurrence], count: 1, omitted: 0, facts: [{
          label: 'Observed control click', value: frontier.label,
          reason: 'The browser observed a trusted click; its source callback and downstream effects remain unproved.',
          evidence_ids: [frontier.occurrence],
        }] }, uncertainty: [reason], entities: {},
        outcome: { observed_effects: [], business_result: 'No downstream outcome proven.' } },
      summary: { reason: frontier.reason, terminal_result_proven: false,
        steps: [{ index: 1, caption, type: 'source_frontier' }] },
      entities: {}, learning: { standalone_training_signal: false,
        use: 'Coverage gap only; exclude from successful execution training examples.', reason },
    },
  };
}
