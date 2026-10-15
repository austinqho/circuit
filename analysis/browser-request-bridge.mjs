const SCHEMA = 'producttrace.browser-request-bridge-manifest.v1';

function requiredString(value, name) {
  if (typeof value !== 'string' || !value) throw new TypeError(`${name} must be a nonempty string`);
  return value;
}

function lifecycleEndpointFor(bridgeEndpoint) {
  const absolute = /^[a-z][a-z\d+.-]*:/iu.test(bridgeEndpoint);
  const leadingSlash = bridgeEndpoint.startsWith('/');
  const endpoint = new URL(bridgeEndpoint, 'http://producttrace.invalid/');
  endpoint.pathname = /\/bridge\/?$/u.test(endpoint.pathname)
    ? endpoint.pathname.replace(/\/bridge\/?$/u, '/react-observations')
    : endpoint.pathname.replace(/[^/]*$/u, 'react-observations');
  if (absolute) return endpoint.href;
  const relative = `${endpoint.pathname}${endpoint.search}${endpoint.hash}`;
  return leadingSlash ? relative : relative.replace(/^\//u, '');
}

/**
 * Generate the browser half of the occurrence bridge from analyzer output.
 * The generated code receives every admissible action/request pairing; it is
 * never told a control label, URL, route, or backend handler.
 */
export function createBrowserRequestBridgeSource(integration, options = {}) {
  const manifest = integration?.request_bridge;
  if (!manifest || manifest.schema !== SCHEMA || !Array.isArray(manifest.actions)) {
    throw new TypeError('Expected a request-bridge-enabled React runtime integration');
  }
  const bridgeEndpoint = requiredString(options.bridgeEndpoint, 'bridgeEndpoint');
  const service = requiredString(options.service, 'service');
  const applicationId = options.applicationId === undefined ? null
    : requiredString(options.applicationId, 'applicationId');
  const browserManifest = {
    ...manifest,
    bindings: integration.bindings,
    bridge_endpoint: bridgeEndpoint,
    lifecycle_endpoint: lifecycleEndpointFor(bridgeEndpoint),
    service,
    application_id: applicationId,
  };

  return `
(() => {
  const manifest = ${JSON.stringify(browserManifest)};
  const actionPlans = new Map(manifest.actions.map(plan => [plan.action, plan]));
  let lastAction = null;
  let activeAction = null;
  let requestContext = null;
  let requestSequence = 0;
  let clickAttempt = null;
  let frontierSequence = 0;
  const pendingRequests = new Map();
  const observations = [];
  let observationBatch = [];
  let observationFlushTimer = null;

  const randomHex = bytes => {
    const value = new Uint8Array(bytes);
    crypto.getRandomValues(value);
    return Array.from(value, byte => byte.toString(16).padStart(2, '0')).join('');
  };
  const createTraceContext = () => {
    const trace_id = randomHex(16);
    const span_id = randomHex(8);
    const trace_flags = '01';
    return { schema: 'producttrace.trace-context.v1', trace_id, span_id, trace_flags,
      traceparent: '00-' + trace_id + '-' + span_id + '-' + trace_flags };
  };
  const parseTraceparent = value => {
    const match = String(value || '').trim().match(/^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i);
    if (!match || /^0+$/.test(match[1]) || /^0+$/.test(match[2])) return null;
    return { schema: 'producttrace.trace-context.v1', trace_id: match[1].toLowerCase(),
      span_id: match[2].toLowerCase(), trace_flags: match[3].toLowerCase(),
      traceparent: match[0].toLowerCase() };
  };
  const internalTransport = url => { const value = String(url || ''); return Boolean(globalThis.__PRODUCTTRACE_INTERNAL_FETCH__) || value.includes('/react-observations') || value.includes('/__capture') || value.includes('producttrace'); };
  const runtimeOwner = () => window.__productTraceRuntime?.context?.() || null;
  const runtimeSpine = owner => ({ action_id: owner?.action_id || null, function_ids: [...(owner?.spine || [])] });
  const linkageKind = owner => owner?.action_id
    ? (owner.react_commit_receipt ? 'mount_effect' : 'direct')
    : null;
  const emitTransport = (method, url, trace_context, transport) => {
    const internal = internalTransport(url); const owner = runtimeOwner(); const action_id = owner?.action_id || null;
    const request_occurrence_id = (action_id || 'unattributed') + ':request:' + (++requestSequence);
    window.__productTraceRuntime?.emit({ schema: 'producttrace.runtime-evidence.v1', kind: 'network.request',
      action_id, action_occurrence_id: action_id, request_occurrence_id, method: String(method || 'GET').toUpperCase(),
      url: String(url || '').split('?')[0], traceparent: trace_context?.traceparent || null, trace_context,
      transport, internal, ...(action_id ? { spine: runtimeSpine(owner) } : { reason: 'unattributed_transport' }),
      parent_continuation_id: owner?.continuation_id || null,
      linkage_kind: linkageKind(owner),
      evidence_ids: [request_occurrence_id] });
  };
  const withTransportGuard = fn => { const previous = globalThis.__PRODUCTTRACE_BRIDGE_TRANSPORT__; globalThis.__PRODUCTTRACE_BRIDGE_TRANSPORT__ = true; try { return fn(); } finally { globalThis.__PRODUCTTRACE_BRIDGE_TRANSPORT__ = previous; } };
  const methodMatches = (actual, expected) =>
    String(actual || 'GET').toUpperCase() === String(expected || '').toUpperCase();

  const nativeFetch = window.fetch.bind(window);
  const internalFetch = (...args) => {
    const previous = globalThis.__PRODUCTTRACE_INTERNAL_FETCH__;
    globalThis.__PRODUCTTRACE_INTERNAL_FETCH__ = true;
    try { return nativeFetch(...args); } finally { globalThis.__PRODUCTTRACE_INTERNAL_FETCH__ = previous; }
  };
  const flushObservations = () => {
    observationFlushTimer = null;
    if (!observationBatch.length) return;
    const batch = observationBatch.splice(0, observationBatch.length);
    internalFetch(manifest.lifecycle_endpoint, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(batch),
    }).catch(error => console.error('[ProductTrace lifecycle evidence]', error));
  };
  const retainObservation = record => {
    observations.push(record);
    if (observations.length > 20000) observations.splice(0, observations.length - 20000);
    observationBatch.push(record);
    if (observationBatch.length >= 100) flushObservations();
    else if (!observationFlushTimer) observationFlushTimer = setTimeout(flushObservations, 100);
  };
  const reportFrontier = (reason, label) => {
    const occurrence = 'frontier:' + randomHex(8) + ':' + (++frontierSequence);
    internalFetch(manifest.bridge_endpoint, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ frontier: { schema: 'producttrace.click-frontier.v1',
        occurrence, reason, label, map_fingerprint: manifest.map_fingerprint } }),
    }).catch(error => console.error('[ProductTrace frontier]', error));
  };
  const report = (method, url, context) => {
    const requestId = context.action.session + ':request:' + (++requestSequence);
    const request = {
      schema: 'producttrace.http-request-observation.v1',
      basis: 'runtime_observation',
      request_occurrence_id: requestId,
      action_occurrence_id: context.action.session + ':action:' + context.action.seq,
      map_fingerprint: manifest.map_fingerprint,
      contract_application_id: context.source_request.contract_application_id,
      method: String(method || context.source_request.method || 'GET').toUpperCase(),
      url: String(url),
      service: manifest.service,
      ...(manifest.application_id ? { application_id: manifest.application_id } : {}),
      evidence_ids: [requestId],
      trace_context: context.trace_context,
    };
    internalFetch(manifest.bridge_endpoint, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: context.action, request }),
    }).then(response => response.json()).then(entry => {
      console.info('[ProductTrace autonomous bridge]', entry.result || entry);
    }).catch(error => console.error('[ProductTrace autonomous bridge]', error));
  };

  window.fetch = function productTraceFetch(input, init) {
    const incomingHeaders = new Headers(init?.headers || input?.headers || {});
    const context = pendingRequests.get(incomingHeaders.get('traceparent')) || requestContext;
    const method = init?.method || input?.method || 'GET';
    const url = input?.url || input;
    const internal = internalTransport(url);
    const matched = context && !context.reported && methodMatches(method, context.source_request.method);
    let nextInit = init;
    const transportContext = context?.trace_context || createTraceContext();
    if (!internal) {
      const headers = new Headers(init?.headers || input?.headers || {});
      const existing = parseTraceparent(headers.get('traceparent'));
      if (existing && context) context.trace_context = existing;
      else headers.set('traceparent', transportContext.traceparent);
      nextInit = { ...(init || {}), headers };
    }
    emitTransport(method, url, transportContext, 'fetch');
    const result = withTransportGuard(() => nativeFetch(input, nextInit));
    if (matched) { context.reported = true; report(method, url, context); }
    return result;
  };

  const xhrOpen = XMLHttpRequest.prototype.open;
  const xhrSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
  const xhrSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function productTraceOpen(method, url, ...rest) {
    this.__productTraceRequest = { method, url, traceparent: null };
    return withTransportGuard(() => xhrOpen.call(this, method, url, ...rest));
  };
  XMLHttpRequest.prototype.setRequestHeader = function productTraceSetRequestHeader(name, value) {
    if (this.__productTraceRequest && String(name).toLowerCase() === 'traceparent') {
      this.__productTraceRequest.traceparent = String(value);
    }
    return xhrSetRequestHeader.call(this, name, value);
  };
  XMLHttpRequest.prototype.send = function productTraceSend(...args) {
    const request = this.__productTraceRequest;
    const context = pendingRequests.get(request?.traceparent) || requestContext;
    const matched = context && request && !context.reported
      && methodMatches(request.method, context.source_request.method);
    const transportContext = context?.trace_context || createTraceContext();
    if (request && !internalTransport(request.url)) {
      const existing = parseTraceparent(request.traceparent);
      if (existing && context) context.trace_context = existing;
      else this.setRequestHeader('traceparent', transportContext.traceparent);
    }
    if (request) emitTransport(request.method, request.url, transportContext, 'xhr');
    const result = withTransportGuard(() => xhrSend.apply(this, args));
    if (matched) { context.reported = true; report(request.method, request.url, context); }
    return result;
  };

  window.__productTraceRequestBridge = {
    configureRequest(config) {
      if (!requestContext) return config;
      const headers = new Headers(config?.headers?.toJSON?.() || config?.headers || {});
      // Preserve caller-owned tracing. An existing parent cannot prove this
      // source invocation owns a later transport, so do not register it here.
      if (headers.has('traceparent')) return config;
      const parent = requestContext.trace_context.traceparent;
      headers.set('traceparent', parent);
      pendingRequests.set(parent, requestContext);
      return { ...config, headers: Object.fromEntries(headers.entries()) };
    },
    begin(metadata, invoke) {
      const stamp = window.__PRODUCTTRACE_ACTION_STAMP__;
      const plan = actionPlans.get(metadata?.action);
      if (!plan || !lastAction || lastAction.action !== metadata.action || stamp !== lastAction.seq) {
        console.info('[ProductTrace autonomous bridge] action frontier', {
          reason: !plan ? 'unknown_action_plan' : !lastAction ? 'missing_runtime_action' :
            lastAction.action !== metadata?.action ? 'runtime_action_mismatch' : 'runtime_stamp_mismatch',
        });
        return invoke();
      }
      if (clickAttempt) clickAttempt.entered = true;
      const context = { action: lastAction, plan, metadata, reported: false };
      const previousAction = activeAction;
      activeAction = context;
      try {
        const result = invoke();
        return result;
      } finally {
        // Browser globals cannot prove async ancestry. End the scope when the
        // callback returns; deferred work must report a frontier.
        activeAction = previousAction;
      }
    },
    request(metadata, invoke) {
      const context = activeAction;
      const requests = Array.isArray(metadata?.requests) ? metadata.requests : [];
      const matches = context ? requests.filter(request => request.action === context.action.action
        && context.plan.requests.some(planned => planned.contract_application_id
          === request.contract_application_id && methodMatches(request.method, planned.method))) : [];
      if (matches.length !== 1) {
        console.info('[ProductTrace autonomous bridge] request frontier', {
          reason: !context ? 'missing_action_context' : matches.length ? 'ambiguous_source_request' : 'source_request_mismatch',
        });
        return invoke();
      }
      const requestScope = { ...context, source_request: matches[0],
        trace_context: createTraceContext(), reported: false };
      const previousRequest = requestContext;
      requestContext = requestScope;
      try {
        const result = invoke();
        const cleanup = () => pendingRequests.delete(requestScope.trace_context.traceparent);
        Promise.resolve(result).then(cleanup, cleanup);
        return result;
      } catch (error) {
        pendingRequests.delete(requestScope.trace_context.traceparent);
        throw error;
      } finally {
        requestContext = previousRequest;
      }
    },
  };

  ProductTrace.start(manifest.bindings, {
    outputMode: 'evidence',
    onRecord(record) {
      if (record.kind === 'action' && actionPlans.has(record.action)) lastAction = record;
      if (record.kind === 'react_lifecycle' || record.kind === 'react_callback'
          || record.kind === 'react_api') {
        retainObservation(record);
      }
    },
  });
  // A control outside the accepted request graph must be visible as a gap,
  // rather than disappearing from the evidence viewer or borrowing a path.
  if (typeof document !== 'undefined') document.addEventListener('click', event => {
    if (!event.isTrusted) return;
    const control = event.target?.closest?.('button, a, input, [role="button"]');
    if (!control) return;
    const attempt = { entered: false };
    clickAttempt = attempt;
    const label = (control.getAttribute('aria-label') || control.textContent || control.tagName).trim().slice(0, 100);
    setTimeout(() => {
      if (!attempt.entered) reportFrontier('no_verified_control_to_request_path', label);
      if (clickAttempt === attempt) clickAttempt = null;
    }, 0);
  }, true);
  window.__productTraceAutonomousBridge = { manifest, observations };
  console.info('[ProductTrace autonomous bridge] initialized', {
    mapped_actions: manifest.actions.length,
    source_requests: manifest.actions.reduce((sum, action) => sum + action.requests.length, 0),
  });
})();
`;
}

export const BROWSER_REQUEST_BRIDGE_SCHEMA = SCHEMA;
