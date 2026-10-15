const SCHEMA = 'producttrace.backend-span.v1';

function copy(value) {
  return JSON.parse(JSON.stringify(value));
}

function attribute(span, ...names) {
  for (const name of names) if (span.attributes?.[name] !== undefined) return span.attributes[name];
  return undefined;
}

function commandCollection(span) {
  const candidates = [
    attribute(span, 'producttrace.mongo.command_collection',
      'db.mongodb.command.findAndModify', 'mongodb.command.findAndModify'),
    attribute(span, 'db.mongodb.command', 'mongodb.command', 'db.command', 'db.statement'),
  ];
  for (let value of candidates) {
    if (typeof value === 'string') { try { value = JSON.parse(value); } catch { continue; } }
    if (value && typeof value === 'object' && typeof value.findAndModify === 'string' && value.findAndModify) {
      return value.findAndModify;
    }
  }
  // Some exporters put command attributes in span events. Walk only object
  // keys named findAndModify; statement payloads are never copied out.
  const walk = value => {
    if (!value || typeof value !== 'object') return null;
    if (typeof value.findAndModify === 'string' && value.findAndModify) return value.findAndModify;
    for (const child of Object.values(value)) { const found = walk(child); if (found) return found; }
    return null;
  };
  return walk(span.events) || null;
}

function normalizeMethod(value) {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

function normalizePath(value) {
  if (typeof value !== 'string' || !value) return null;
  try {
    const path = new URL(value, 'http://producttrace.invalid').pathname.replace(/\/{2,}/g, '/');
    return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
  } catch {
    return null;
  }
}

function validTraceContext(value) {
  return value?.schema === 'producttrace.trace-context.v1'
    && /^[0-9a-f]{32}$/u.test(value.trace_id)
    && value.trace_id !== '00000000000000000000000000000000'
    && /^[0-9a-f]{16}$/u.test(value.span_id)
    && value.span_id !== '0000000000000000';
}

function isBackendSpan(value) {
  return value?.schema === SCHEMA && value.source === 'opentelemetry'
    && typeof value.trace_id === 'string' && typeof value.span_id === 'string';
}

function matchesRoute(span, actualPath, templatePath) {
  const declared = normalizePath(attribute(span, 'http.route'));
  if (declared) return declared === templatePath || declared === actualPath;
  return normalizePath(attribute(span, 'url.path', 'http.target', 'url.full')) === actualPath;
}

function requestMethod(span) {
  return normalizeMethod(attribute(span, 'http.request.method', 'http.method',
    'producttrace.express.handler.method'));
}

function databaseOperation(span) {
  const instrumentation = span.instrumentation?.name || '';
  const system = attribute(span, 'db.system.name', 'db.system')
    || (instrumentation.includes('mongodb') || instrumentation.includes('mongoose') ? 'mongodb' : null);
  if (!system) return null;
  const operation = attribute(span, 'db.operation.name', 'db.operation')
    || span.name?.match(/(?:^|[. ])(aggregate|count|delete|find|insert|save|update)(?:$|[. ])/iu)?.[1]
    || span.name
    || 'database operation';
  let collection = attribute(span, 'db.collection.name', 'db.mongodb.collection') ?? null;
  // Mongo's command monitoring reports findAndModify against the synthetic
  // `$cmd` collection.  Prefer the command document's operation key when the
  // exporter preserved it, without reading or emitting statement text.
  if (collection === '$cmd' && operation.toLowerCase() === 'findandmodify') {
    const derivedCollection = commandCollection(span);
    if (derivedCollection) collection = derivedCollection;
  }
  return {
    span_id: span.span_id,
    system: String(system),
    operation: String(operation),
    namespace: attribute(span, 'db.namespace', 'db.name') ?? null,
    collection,
    instrumentation: instrumentation || null,
  };
}

function descendantOf(span, ancestorId, byId) {
  const seen = new Set();
  let parent = span.parent_span_id;
  while (parent && !seen.has(parent)) {
    if (parent === ancestorId) return true;
    seen.add(parent);
    parent = byId.get(parent)?.parent_span_id || null;
  }
  return false;
}

function expectedHandlerNames(bridge) {
  return (bridge.handler?.entry_handler_labels || []).map(label => {
    if (typeof label !== 'string') return null;
    return label.match(/([A-Za-z_$][\w$]*)\s*$/u)?.[1] || null;
  }).filter(Boolean);
}

function withEvidence(bridge, status, reason, values = {}) {
  const result = copy(bridge);
  if (result.handler) {
    result.handler.backend_execution = status === 'confirmed' ? 'confirmed' : 'unconfirmed';
    result.handler.backend_evidence = {
      status,
      reason,
      trace_id: values.trace_id || result.request?.trace_context?.trace_id || null,
      server_span_id: values.server_span_id || null,
      handler_span_ids: values.handler_span_ids || [],
      database_span_ids: values.database_span_ids || [],
      database_operations: values.database_operations || [],
      evidence_ids: values.evidence_ids || [],
    };
  }
  return result;
}

/**
 * Upgrade a static request-to-route bridge only when OpenTelemetry proves the
 * exact browser request entered the predicted server route and invoked every
 * statically registered terminal handler. URL or timing similarity is never a
 * substitute for the W3C trace parent relationship.
 */
export function confirmBackendExecution(bridge, spans) {
  if (!bridge || bridge.schema !== 'producttrace.request-handler-bridge.v1') {
    throw new TypeError('bridge must be a producttrace.request-handler-bridge.v1 result');
  }
  if (!Array.isArray(spans)) throw new TypeError('spans must be an array');
  if (bridge.status !== 'resolved' || !bridge.handler || !bridge.route_join?.match) {
    return withEvidence(bridge, 'unresolved', 'request_handler_bridge_unresolved');
  }
  const traceContext = bridge.request?.trace_context;
  if (!validTraceContext(traceContext)) {
    return withEvidence(bridge, 'unresolved', 'request_trace_context_missing');
  }
  const candidates = spans.filter(isBackendSpan).filter(span => span.trace_id === traceContext.trace_id);
  const expectedMethod = normalizeMethod(bridge.request.method);
  const expectedPath = normalizePath(bridge.route_join.request?.path);
  const expectedTemplate = normalizePath(bridge.route_join.match.path_template);
  const expectedService = bridge.request.service || bridge.route_join.match.service_id;
  const servers = candidates.filter(span => span.kind === 'server'
    && span.parent_span_id === traceContext.span_id
    && (!expectedService || span.service_name === expectedService)
    && requestMethod(span) === expectedMethod
    && matchesRoute(span, expectedPath, expectedTemplate));
  if (servers.length !== 1) {
    return withEvidence(bridge, servers.length ? 'ambiguous' : 'unresolved',
      servers.length ? 'multiple_exact_server_spans' : 'exact_server_span_missing', {
        trace_id: traceContext.trace_id,
        evidence_ids: servers.map(span => span.span_id),
      });
  }
  const [server] = servers;
  const byId = new Map(candidates.map(span => [span.span_id, span]));
  const names = expectedHandlerNames(bridge);
  const handlerSpans = candidates.filter(span =>
    span.instrumentation?.name === 'producttrace-express-handlers'
    && descendantOf(span, server.span_id, byId)
    && requestMethod(span) === expectedMethod
    && matchesRoute(span, expectedPath, expectedTemplate)
    && names.includes(attribute(span, 'producttrace.express.handler.name')));
  const observedCounts = new Map();
  for (const span of handlerSpans) {
    const name = attribute(span, 'producttrace.express.handler.name');
    observedCounts.set(name, (observedCounts.get(name) || 0) + 1);
  }
  const expectedCounts = new Map();
  for (const name of names) expectedCounts.set(name, (expectedCounts.get(name) || 0) + 1);
  const missing = [...expectedCounts].filter(([name, count]) => observedCounts.get(name) !== count);
  if (!names.length || missing.length) {
    const duplicate = missing.some(([name, count]) => (observedCounts.get(name) || 0) > count);
    return withEvidence(bridge, duplicate ? 'ambiguous' : 'unresolved', names.length
      ? duplicate ? 'multiple_registered_handler_spans' : 'registered_handler_span_missing'
      : 'registered_handler_identity_missing', {
        trace_id: traceContext.trace_id,
        server_span_id: server.span_id,
        handler_span_ids: handlerSpans.map(span => span.span_id),
        evidence_ids: [server.span_id, ...handlerSpans.map(span => span.span_id)],
      });
  }
  const databaseSpans = candidates.filter(span => databaseOperation(span)
    && handlerSpans.some(handlerSpan => descendantOf(span, handlerSpan.span_id, byId)));
  const databaseOperations = databaseSpans.map(databaseOperation);
  return withEvidence(bridge, 'confirmed', 'exact_request_and_registered_handler_observed', {
    trace_id: traceContext.trace_id,
    server_span_id: server.span_id,
    handler_span_ids: handlerSpans.map(span => span.span_id),
    database_span_ids: databaseSpans.map(span => span.span_id),
    database_operations: databaseOperations,
    evidence_ids: [server.span_id, ...handlerSpans.map(span => span.span_id),
      ...databaseSpans.map(span => span.span_id)],
  });
}

export const BACKEND_EXECUTION_SPAN_SCHEMA = SCHEMA;
