/**
 * Tracer MCP tools (G4). Pure functions over a store from `collector/store.mjs`.
 *
 * No model runs here: each tool returns structured JSON plus one rendered
 * "reached / stopped at / because" line per result. Every input is untrusted
 * (it arrives from page metadata or an agent's guess): it is validated against
 * the published JSON Schema, compared by string equality only, and never
 * evaluated. Misses are explicit: not_found, stale_build, ambiguous.
 */
import { keyForAction, pageOf, rankTargetCandidates, stampKeyTrust } from '../collector/element-index.mjs';
import { remapFunctionId } from '../collector/store.mjs';
import { abortedBecause, actionOutcome, chainFrontier, dbOpsText, describeServerSpan, hopSegments, issueDeferral, issueDeferralText, joinRequestServer, outcomeText, requestSegmentCore, serverSpansWithoutBrowserParent,
  spanEndMs, spanStartMs, spansByTrace, windowCoverageReasons } from '../analysis/causal-chain.mjs';
import { actionCoverage } from '../collector/coverage.mjs';

const ID = { type: 'string', minLength: 1, maxLength: 256, pattern: '^[\\x21-\\x7E]+$' };
const SESSION = { type: 'string', minLength: 1, maxLength: 128, pattern: '^[\\x21-\\x7E]+$' };

export const TOOL_SCHEMAS = {
  resolve_element: {
    type: 'object', additionalProperties: false,
    properties: {
      element_key: { ...ID, description: 'data-tracer-el value, or tracer_el from annotation metadata. Only this can yield confidence "exact".' },
      build: { type: 'string', minLength: 1, maxLength: 128, pattern: '^[\\x21-\\x7E]+$', description: 'tracer_build from annotation metadata, for stale-key detection.' },
      url: { type: 'string', minLength: 1, maxLength: 2048, description: 'Page URL from the annotation evidence.' },
      selector: { type: 'string', minLength: 1, maxLength: 512, description: 'Target selector from the annotation (may be non-unique; only the last compound is used).' },
      element_path: { type: 'string', minLength: 1, maxLength: 1024, description: 'Target path, tag names only (e.g. "div > form > button").' },
      role: { type: 'string', minLength: 1, maxLength: 64, description: 'Target role attribute.' },
      name: { type: 'string', minLength: 1, maxLength: 256, description: 'Target accessible name (aria-label or leading text).' },
      nearby_text: { type: 'string', minLength: 1, maxLength: 512, description: 'Nearby text from the annotation.' },
    },
  },
  element_history: {
    type: 'object', additionalProperties: false, required: ['element_key'],
    properties: {
      element_key: { ...ID, description: 'A key returned by resolve_element.' },
      session: { ...SESSION, description: 'capture_page_id to restrict to one page load.' },
      n: { type: 'integer', minimum: 1, maximum: 100, default: 10, description: 'Number of attempts (episodes on this element, newest first) to return, with all their actions. Not a count of raw actions.' },
      include_context: { type: 'boolean', default: false, description: 'Also list gesture-context actions no episode holds (pointerdown/up, mousedown/up, keyup, focus/blur, hover and scroll ranges, ...). Default: counted in context_omitted, not listed.' },
    },
  },
  action_chain: {
    type: 'object', additionalProperties: false, required: ['action_id'],
    properties: {
      action_id: { ...ID, description: 'An action_id from element_history or recent_actions.' },
      include_bodies: { type: 'boolean', default: false, description: 'Return stored request and response bodies, newest first through a 512 KB reply budget. Pass bodies_full.next_cursor as until_timestamp and until_id to recover older bodies. Other body fields remain summaries.' },
      until_timestamp: { type: 'integer', minimum: 0, maximum: 100000000000000, description: 'Exclusive body cursor timestamp from bodies_full.next_cursor; use with until_id.' },
      until_id: { type: 'string', description: 'Exclusive body cursor id from bodies_full.next_cursor; use with until_timestamp.' },
    },
  },
  recent_actions: {
    type: 'object', additionalProperties: false,
    properties: {
      session: { ...SESSION, description: 'capture_page_id to restrict to one page load.' },
      n: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
      include_bodies: { type: 'boolean', default: false, description: 'Return unlinked stored bodies in the selected n action windows, newest first through a 512 KB reply budget; pass bodies_full.next_cursor as until_timestamp and until_id for older bodies in those windows. Use page_requests with attribution none and include_bodies true for all unattributed requests.' },
      until_timestamp: { type: 'integer', minimum: 0, maximum: 100000000000000, description: 'Exclusive body cursor timestamp from bodies_full.next_cursor; use with until_id.' },
      until_id: { type: 'string', description: 'Exclusive body cursor id from bodies_full.next_cursor; use with until_timestamp.' },
      include_context: { type: 'boolean', default: false, description: 'Also list gesture-context actions no episode holds (pointerdown/up, mousedown/up, keyup, focus/blur, hover and scroll ranges, ...). Default: counted in context_omitted, not listed.' },
    },
  },
  compare_chains: {
    type: 'object', additionalProperties: false, required: ['before_action_id', 'after_action_id'],
    properties: { before_action_id: { ...ID }, after_action_id: { ...ID } },
  },
  page_requests: {
    type: 'object', additionalProperties: false,
    properties: {
      session: { ...SESSION, description: 'capture_page_id: only requests recorded on this page load.' },
      since: { type: 'integer', minimum: 0, maximum: 100000000000000, description: 'Epoch milliseconds (browser clock): only requests recorded at or after this time.' },
      until: { type: 'integer', minimum: 0, maximum: 100000000000000, description: 'Epoch milliseconds (browser clock): only requests recorded at or before this time.' },
      path: { type: 'string', minLength: 1, maxLength: 512, pattern: '^/[\\x21-\\x7E]*$', description: 'Only requests whose URL path starts with this literal prefix (e.g. /api/status).' },
      attribution: { type: 'string', enum: ['any', 'action', 'none'], default: 'any', description: 'action: only requests attributed to a user action; none: only requests not attributed to any user action (polls, page-load fetches, uninstrumented scripts; the issuer says what the stack showed, not the cause).' },
      n: { type: 'integer', minimum: 1, maximum: 500, default: 100, description: 'Most recent n requests listed (groups count every match).' },
      include_bodies: { type: 'boolean', default: false, description: 'Return listed stored bodies newest first through a 512 KB reply budget; pass bodies_full.next_cursor as until_timestamp and until_id for older requests. Default: summaries only.' },
      until_timestamp: { type: 'integer', minimum: 0, maximum: 100000000000000, description: 'Exclusive cursor timestamp from bodies_full.next_cursor; use with until_id.' },
      until_id: { type: 'string', description: 'Exclusive cursor id from bodies_full.next_cursor; use with until_timestamp.' },
    },
  },
};

export const TOOL_DESCRIPTIONS = {
  resolve_element: 'Resolve a Tracer element key (data-tracer-el / tracer_el) to its source placement and handlers. An ordinal key (`…#n<i>`) of a placement rendered more than once returns confidence "ambiguous" with every instance as a candidate. Without a key, returns ranked candidates from selector/path/role/name/nearby text with confidence "ambiguous"; it never picks silently. Call this first for any annotated element, before reading code.',
  element_history: 'The n most recent attempts (default 10; an attempt is one episode on this element, e.g. focus+click+submit) on an element key, newest first, with all their actions, each with entry handler, request, route, handler spans, DB ops, outcome and the explicit frontier (reached / stopped at / because).',
  action_chain: 'The full observed causal chain for one action: dispatch (with key detail), the named entry handler (file:line) and its spine, then every request as its own segment (named lineage, route, handler spans, every DB operation, outcome, third-party mark, server work after the response), and where the evidence stops and why.',
  recent_actions: 'What just happened: the most recent user actions on any element, newest first, with a one-line frontier each. include_bodies lists, per action, the requests no action owns that were observed in its window, with their bodies.',
  compare_chains: 'Compare the observed chains of two actions (e.g. before and after a fix): per stop same/changed/added/removed, an outcome delta, and whether the runtime path changed.',
  page_requests: 'Every request the page sent in a time window or on one page load, with or without a user action: each with its attribution (the action, or "not attributed to any user action" with every first-party frame the stack showed issuing it, e.g. from a timer armed at page load), route, handler spans, DB ops, outcome and body summaries (what was sent and returned), plus per-endpoint counts and intervals. Use it for background traffic: polls, page-load fetches, uninstrumented scripts.',
};

export const TOOLS = Object.keys(TOOL_SCHEMAS).map(name => ({ name, description: TOOL_DESCRIPTIONS[name], inputSchema: TOOL_SCHEMAS[name] }));

export const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
/** Own keys named __proto__ / constructor / prototype anywhere in a parsed JSON value. */
export function forbiddenKeys(value, found = new Set(), depth = 0) {
  if (!value || typeof value !== 'object' || depth > 16) return [...found];
  for (const key of Object.keys(value)) { if (FORBIDDEN_KEYS.has(key)) found.add(key); forbiddenKeys(value[key], found, depth + 1); }
  return [...found];
}

/** Minimal validator for the schema subset above. Returns a list of violations. */
export function validateInput(schema, input) {
  const errors = [];
  if (input === undefined || input === null) input = {};
  if (typeof input !== 'object' || Array.isArray(input)) return ['arguments must be an object'];
  for (const key of forbiddenKeys(input)) errors.push(`forbidden property name "${key}"`);
  for (const key of Object.keys(input)) if (!FORBIDDEN_KEYS.has(key) && !Object.hasOwn(schema.properties, key)) errors.push(`unknown property "${String(key).slice(0, 64)}"`);
  for (const key of schema.required || []) if (input[key] === undefined) errors.push(`missing required property "${key}"`);
  for (const [key, rule] of Object.entries(schema.properties)) {
    const value = input[key];
    if (value === undefined) continue;
    if (rule.type === 'string') {
      if (typeof value !== 'string') { errors.push(`${key} must be a string`); continue; }
      if (value.length < (rule.minLength ?? 0)) errors.push(`${key} is shorter than ${rule.minLength}`);
      if (rule.maxLength != null && value.length > rule.maxLength) errors.push(`${key} is longer than ${rule.maxLength}`);
      else if (rule.pattern && !new RegExp(rule.pattern, 'u').test(value)) errors.push(`${key} must be printable ASCII without spaces`);
      if (/[\u0000-\u001F\u007F]/u.test(value)) errors.push(`${key} contains control characters`);
      if (rule.enum && !rule.enum.includes(value)) errors.push(`${key} must be one of ${rule.enum.join(', ')}`);
    } else if (rule.type === 'boolean') {
      if (typeof value !== 'boolean') errors.push(`${key} must be a boolean`);
    } else if (rule.type === 'integer') {
      if (!Number.isInteger(value)) { errors.push(`${key} must be an integer`); continue; }
      if (rule.minimum != null && value < rule.minimum) errors.push(`${key} must be >= ${rule.minimum}`);
      if (rule.maximum != null && value > rule.maximum) errors.push(`${key} must be <= ${rule.maximum}`);
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Rendering helpers (deterministic strings, no narration).

const isWrite = operation => /^(?:insert|update|delete|remove|replace|findandmodify|bulk)/iu.test(String(operation || ''));
const where = source => source?.file ? `${source.file}${source.line ? `:${source.line}` : `@${source.start}-${source.end}`}` : null;
const requestPath = url => { try { return new URL(String(url), 'http://tracer.invalid').pathname; } catch { return String(url); } };
/** The query string as recorded (`?a=1`), or '' (runtimes before 2026-09-24 recorded the path only). */
const requestQuery = url => { try { return new URL(String(url), 'http://tracer.invalid').search; } catch { return ''; } };
/** Path plus query, as the page sent it (never the fragment). */
const requestTarget = url => `${requestPath(url)}${requestQuery(url)}`;

function spanInfo(store, spanId) {
  const span = store.spanById.get(spanId);
  const attributes = span?.attributes || {};
  return { span, route: attributes['http.route'] ?? null, method: attributes['http.method'] ?? attributes['http.request.method'] ?? null,
    status_code: attributes['http.status_code'] ?? attributes['http.response.status_code'] ?? null,
    handler_name: attributes['producttrace.express.handler.name'] ?? null, handler_index: attributes['producttrace.express.handler.index'] ?? null };
}

// ---- Observed handler bindings (D-G1-22) ------------------------------------
const bindingIndexCache = new WeakMap();
/** handler.binding / handler.invocation / handler.via_library rows by action_id (raw rows, row order). */
function bindingRowsFor(store, actionId, kinds = ['handler.binding', 'handler.invocation']) {
  if (!bindingIndexCache.has(store)) {
    const index = new Map();
    for (const row of store.records || []) {
      if ((row?.kind !== 'handler.binding' && row?.kind !== 'handler.invocation' && row?.kind !== 'handler.via_library') || !row.action_id) continue;
      const values = index.get(row.action_id) || []; values.push(row); index.set(row.action_id, values);
    }
    bindingIndexCache.set(store, index);
  }
  return (bindingIndexCache.get(store).get(actionId) || []).filter(row => kinds.includes(row.kind));
}
const bindingLabel = (store, row) => {
  const info = store.functionInfo?.(row.function_id) || null;
  return info?.label || where(store.sourceFor(row.function_id)) || row.function_id;
};
// Keep the raw ids in stored evidence. For observed handler abstentions,
// render the exact listed functions with their build-time names.
function namedObservedAbstention(store, record, because) {
  if (record?.handler_abstention?.basis !== 'observed' || typeof because !== 'string') return because;
  const ids = [...new Set([...(record.handler_abstention.global_listeners || []), ...(record.handler_abstention.ran_via_library || [])])];
  return ids.reduce((text, id) => text.replaceAll(id, bindingLabel(store, { function_id: id })), because);
}
/** One observed binding (or app-code invocation), with the handler's name and source. */
function describeBinding(store, row) {
  const kind = row.kind === 'handler.binding' || row.kind === 'binding' ? 'binding' : 'invocation';
  return { kind, function_id: row.function_id, label: bindingLabel(store, row), prop_name: row.prop_name ?? null, native_event_type: row.native_event_type ?? null,
    invoked_by: row.invoked_by ?? null, listener_on: row.listener_on ?? null, holder: row.fiber ? { kind: row.fiber.kind ?? null, name: row.fiber.name ?? null } : (row.holder ?? null),
    ...(row.ran ? { ran: row.ran } : {}), ...(row.count != null ? { count: row.count } : {}),
    ...(row.ambiguous ? { ambiguous: true, ambiguity_reason: row.ambiguity_reason ?? null, holders: (row.holders || []).map(holder => ({ prop: holder.prop ?? null, holder: holder.fiber ? { kind: holder.fiber.kind ?? null, name: holder.fiber.name ?? null } : null })) } : {}),
    ...(row.untrusted ? { untrusted: true } : {}),
    ...(kind === 'invocation' ? { dispatched_by: row.dispatched_by ?? null, ...(row.caused_by_action_id !== undefined ? { caused_by_action_id: row.caused_by_action_id } : {}) } : {}) };
}
const AMBIGUITY_REASONS = Object.freeze({
  no_argument: 'the handler received no argument',
  argument_not_a_react_synthetic_event: 'its argument was not a React synthetic event',
  event_for_a_different_native_event: 'its argument was an event for a different native event',
  argument_not_readable: 'its argument could not be read',
  react_name_matched_no_single_holder: 'the React event name matched no single holder',
  capture_bubble_undecided: 'capture or bubble pass undecided',
  argument_not_read_component_prop: 'only component props hold it (called by component code; its argument is not read)',
  not_invoked_by_react: 'not invoked by React\'s event system',
});
/** "onChange on click (React)" / "listener on document (keydown)". */
function bindingPhrase(binding) {
  const how = binding.invoked_by === 'react_event_system' ? 'React' : binding.invoked_by === 'native_listener' ? `listener on ${binding.listener_on || 'element'}`
    : binding.invoked_by === 'dispatch_continuation' ? 'in a continuation of the dispatch' : binding.invoked_by === 'app_code' ? 'app code' : (binding.invoked_by || 'unknown');
  // The reason is the one the runtime observed (regrade change 4).
  const why = AMBIGUITY_REASONS[binding.ambiguity_reason] || 'which prop React invoked was not observable';
  const prop = binding.ambiguous
    ? (binding.prop_name ? `${binding.prop_name} (holder ambiguous: ${(binding.holders || []).map(holder => holder.holder?.name || '?').join(' or ')}; ${why})`
      : `one of ${[...new Set((binding.holders || []).map(holder => holder.prop))].join('/')} (ambiguous: ${why})`)
    : (binding.prop_name || 'listener');
  return `${prop} on ${binding.native_event_type || '?'} (${how})`;
}
/** The dispatch's handlers: observed (what ran) first, then the declared list; null for rows recorded before observed bindings. */
function dispatchBindings(store, dispatch) {
  if (!dispatch) return null;
  const rows = bindingRowsFor(store, dispatch.action_id);
  if (!rows.length && dispatch.bound_handlers?.basis !== 'declared') return null;
  const declared = dispatch.bound_handlers ? { basis: 'declared', ids: dispatch.bound_handlers.ids || [], library: dispatch.bound_handlers.library ?? null,
    ...(dispatch.bound_handlers.element_listeners ? { element_listeners: dispatch.bound_handlers.element_listeners } : {}) } : null;
  const viaLibrary = bindingRowsFor(store, dispatch.action_id, ['handler.via_library']).map(row => ({ function_id: row.function_id, label: bindingLabel(store, row), ran: row.ran ?? null, invoked_by: row.invoked_by ?? null }));
  return { basis: 'observed', observed: rows.map(row => describeBinding(store, row)), ...(viaLibrary.length ? { via_library: viaLibrary } : {}), declared };
}

/** Stops of one stored chain, in bus-stop order. */
export function chainStops(store, actionId, { episodeView = false, includeBodies = false } = {}) {
  const resolved = store.chainForAction(actionId, { episodeView });
  const { record, frontier, episode, standalone } = resolved;
  // A non-carrier member's chain covers only its own evidence (scope).
  const scope = resolved.scope || episode;
  const dispatch = store.actionsById.get(actionId)?.[0] || null;
  const carrier = store.actionsById.get(record.action_id)?.[0] || dispatch;
  const stops = [];
  stops.push({ stop: 'dispatch', action_id: actionId, session: dispatch ? (dispatch.capture_page_id || dispatch.session_id || 'default') : null,
    sequence: dispatch?.sequence ?? null, event: dispatch?.event ?? null, target: dispatch?.target ?? null, element_key: dispatch ? keyForAction(store.elementIndex, dispatch) : null });
  if (record.entry_handler?.resolution === 'unmapped') {
    // Abstain: the entered function is not in its build's manifest; no neighbour is named.
    const entry = record.entry_handler;
    stops.push({ stop: 'entry_handler', function_id: entry.function_id, resolution: 'unmapped', status: entry.status, build: entry.build,
      found_in_builds: entry.found_in_builds, event: carrier?.event ?? record.event ?? null, unit_id: entry.unit_id, rooted: entry.rooted, source: null, reason: entry.reason });
  } else if (record.entry_handler) {
    const source = store.sourceFor(record.entry_handler.function_id);
    const info = store.functionInfo?.(record.entry_handler.function_id) || null;
    stops.push({ stop: 'entry_handler', function_id: record.entry_handler.function_id, event: carrier?.event ?? record.event ?? null,
      unit_id: record.entry_handler.unit_id, rooted: record.entry_handler.rooted, source,
      name: info?.name ?? null, ...(info?.name_kind ? { name_kind: info.name_kind } : {}), display_name: info?.display_name ?? null, name_status: info?.name_status ?? null, label: info?.label ?? null,
      // D-G1-22: how the credited handler was bound to this dispatch (observed), or null when it ran unbound and owned a request.
      ...(record.entry_handler.binding !== undefined ? { binding: record.entry_handler.binding ? describeBinding(store, record.entry_handler.binding) : null } : {}),
      ...(record.entry_handler.unbound_request_issuers ? { unbound_request_issuers: record.entry_handler.unbound_request_issuers } : {}) });
  }
  const request = record.chain.find(step => step.kind === 'network.request') || null;
  const route = record.chain.find(step => step.kind === 'route.dispatch') || null;
  const routeInfo = route ? spanInfo(store, route.span_id) : null;
  if (request) stops.push({ stop: 'request', method: String(request.method || 'GET').toUpperCase(), url: request.url ?? null, path: requestPath(request.url), query: requestQuery(request.url) || null,
    request_occurrence_id: request.request_occurrence_id ?? null, trace_id: request.trace_context?.trace_id ?? null, action_id: request.action_id ?? null,
    route_template: routeInfo?.route ?? null });
  if (route) stops.push({ stop: 'route', span_id: route.span_id, method: routeInfo.method, route: routeInfo.route, status_code: routeInfo.status_code, admission_reason: route.admission_reason });
  for (const handler of record.chain.filter(step => step.kind === 'handler.enter')) {
    const info = spanInfo(store, handler.span_id);
    stops.push({ stop: 'handler', span_id: handler.span_id, route: info.route, name: info.handler_name, index: info.handler_index });
  }
  for (const db of record.chain.filter(step => step.kind === 'db.operation')) {
    stops.push({ stop: 'db', span_id: db.span_id, operation: db.operation, collection: db.collection, write: isWrite(db.operation),
      ...(db.issuer ? { issuer: db.issuer, issued_by: db.issued_by } : {}), ...(db.hop ? { hop: db.hop } : {}) });
  }
  // Server-to-server hops of the credited request (followed or escaped).
  for (const hop of hopSegments(record.chain.filter(step => step.kind === 'server.hop')).hops) {
    stops.push({ stop: 'outbound', hop: hop.hop, span_id: hop.span_id, method: hop.method, url: hop.url, issued_by: hop.issued_by?.name ?? null, join: hop.join,
      server: hop.server ? { span_id: hop.server.span_id, service_name: hop.server.service_name, route: hop.server.route, status_code: hop.server.status_code } : null,
      ...(hop.because ? { because: hop.because } : {}), summary: hop.summary });
  }
  for (const rejected of record.chain.filter(step => step.kind === 'submit.rejected')) stops.push({ stop: 'validation', action_id: rejected.action_id, admission_reason: rejected.admission_reason });
  // Worker frontier: a post to a Web Worker (worker code is not instrumented).
  for (const post of record.chain.filter(step => step.kind === 'worker.postMessage')) stops.push({ stop: 'worker', worker_id: post.worker_id ?? null,
    worker_kind: post.worker_kind ?? null, script_url: post.script_url ?? null, via: post.via ?? null, message_size_class: post.message_size_class ?? null,
    action_id: post.action_id ?? null, sequence: post.sequence ?? null, instrumented: false });
  // WebSocket messages the action sent (byte size only): no trace context follows them.
  for (const send of record.chain.filter(step => step.kind === 'network.send')) stops.push({ stop: 'websocket_send', url: send.url ?? null, bytes: send.bytes ?? null,
    connection_occurrence_id: send.connection_occurrence_id ?? null, action_id: send.action_id ?? null, sequence: send.sequence ?? null, traceable: false });
  const dbStops = stops.filter(stop => stop.stop === 'db');
  // Outcome labels: the chain's own `outcome` (actionOutcome, the one label
  // function); `display_status` is an alias of `status`, never a second value.
  const label = record.outcome || actionOutcome(record, { backendInstrumented: store.backendInstrumented });
  // An aborted request's server answer is `server_status`, never the action's http_status.
  const outcome = { stage: record.display?.stage ?? null, status: label.status, display_status: label.status,
    http_status: label.status === 'aborted_by_client' ? null : routeInfo?.status_code ?? null,
    // Writes and reads of the action: the credited request's, plus those of its
    // aborted sibling requests (the server did that work; `aborted_request_effects` says which).
    writes: [...new Set([...dbStops.filter(stop => stop.write).map(stop => `${stop.operation} ${stop.collection}`), ...(label.aborted_request_effects || []).flatMap(entry => entry.writes)])].sort(),
    reads: [...new Set([...dbStops.filter(stop => !stop.write).map(stop => `${stop.operation} ${stop.collection}`), ...(label.aborted_request_effects || []).flatMap(entry => entry.reads)])].sort(),
    stop_reason: frontier.stop_reason, stopped_at: frontier.stopped_at,
    // `reached` distinguishes request-less chains that all stop at `browser`
    // (dom_mutation vs entry_handler vs dispatch); compare_chains reads it.
    reached: frontier.reached };
  // Generic HTTP semantics, no product list: an error status on the joined
  // server span is stated in the frontier; stopped_at is unchanged.
  const status = Number(routeInfo?.status_code);
  // A request the page aborted: the frontier says so first, and the server's
  // answer is stated as the server's (never "responded", a label word).
  const shownFrontierRaw = label.status === 'aborted_by_client' && frontier.because ? { ...frontier, because: abortedBecause(routeInfo?.status_code, frontier.because) }
    : Number.isFinite(status) && status >= 400 && frontier.because && !frontier.because.startsWith('server responded')
      ? { ...frontier, because: `server responded ${status}; ${frontier.because}` } : frontier;
  const shownFrontier = record.handler_abstention?.basis === 'observed' && shownFrontierRaw.because
    ? { ...shownFrontierRaw, because: namedObservedAbstention(store, record, shownFrontierRaw.because) } : shownFrontierRaw;
  const requests = scope.action_ids.flatMap(id => (store.requestsByAction.get(id) || []).map(row => ({ action_id: id, method: row.method, url: row.url, request_occurrence_id: row.request_occurrence_id ?? null })));
  const segments = requestSegments(store, record, scope, { includeBodies });
  const entryStop = stops.find(stop => stop.stop === 'entry_handler' && stop.resolution !== 'unmapped');
  const spine = entryStop ? (record.spine?.function_ids || []).map(id => store.functionInfo?.(id) || { function_id: id, label: id }) : [];
  const primary = segments.find(segment => segment.request_occurrence_id && segment.request_occurrence_id === (request?.request_occurrence_id ?? null)) || null;
  outcome.label = label.label; outcome.sentence = label.sentence;
  for (const key of ['reason', 'signals', 'note', 'did', 'clause', 'other_requests', 'also_text', 'effect', 'server_status', 'aborted_at', 'abort_reason', 'body_read_started', 'app_read', 'aborted_request_effects', 'abort_after_response', 'abort_undetermined', 'after_response_text', 'escape_text', 'window_text']) if (label[key] !== undefined) outcome[key] = label[key];
  if (label.status === 'stopped') outcome.because = namedObservedAbstention(store, record, label.because);
  outcome.requests = segments.length;
  outcome.failed_requests = segments.filter(segment => segment.outcome === 'failed').length;
  if (primary?.deferred) outcome.deferred = primary.deferred;
  const keyboard = keyboardDetail(dispatch);
  // A release whose gesture was pressed on another control (a drag) names it.
  const pressedOn = dispatch?.phase === 'release' && dispatch.gesture_id
    ? store.actionRows.find(row => row.gesture_id === dispatch.gesture_id && row.phase === 'press' && pageOf(row) === pageOf(dispatch) && (row.target_ref || null) !== (dispatch.target_ref || null)) || null : null;
  const detail = keyboard ? null : dispatchDetail(dispatch, dispatch?.coalesced ? (store.rangeFor?.(dispatch.action_id) || null) : null, pressedOn);
  // Coverage of the page the action belongs to (capture.* rows only).
  const page = dispatch ? (dispatch.capture_page_id || dispatch.session_id || 'default') : null;
  // Coverage of the page the action belongs to (capture.* rows), plus what the
  // action's own evidence and window withhold (causal-chain windowCoverageReasons,
  // untrusted skips included), plus what the page's runtime observed (user_events).
  const coverage = page != null && typeof store.coverageFor === 'function' ? withUserEvents(store, page, compactCoverage(actionCoverage(store.coverageFor(page), windowCoverageReasons(record)))) : null;
  // Requests sent by the events this action caused or opened (their own rows).
  const related = relatedEvents(store, record);
  // Body capture declared by the page (capture.page.bodies): on | off | production_off, or null (not declared).
  const bodies = page != null && typeof store.coverageFor === 'function' ? (store.coverageFor(page)?.bodies ?? null) : null;
  return { record, frontier: shownFrontier, episode, standalone, stops, outcome, requests, segments, spine, keyboard, dispatch_detail: detail, related, coverage, bodies, unlinked: withUnlinkedBodies(store, record.unlinked ?? null, { includeBodies }),
    carrier_action_id: resolved.carrier_action_id ?? record.action_id, member: Boolean(resolved.member), pointer: resolved.pointer ?? null, caused: resolved.caused ?? null, opened: resolved.opened ?? null, scope,
    bindings: dispatchBindings(store, dispatch) };
}

/**
 * Additive pointer fields (episode-focus rule): a non-carrier member names
 * its episode's carrier; a caused focus names the action that caused it.
 * Absent otherwise, so carriers and standalone gestures answer as before.
 */
function pointerFields(chain) {
  return {
    ...(chain.member ? { episode_member: true, episode_pointer: chain.pointer } : {}),
    ...(chain.caused ? { gesture: false, caused_by_action_id: chain.caused.caused_by_action_id, caused_by_episode_id: chain.caused.caused_by_episode_id,
      caused_via: chain.caused.caused_via, ...(chain.caused.cause_abstained ? { cause_abstained: chain.caused.cause_abstained } : {}), caused_pointer: chain.caused.sentence } : {}),
    ...(chain.opened ? { opened_by_action_id: chain.opened.opened_by_action_id, opened_by_episode_id: chain.opened.opened_by_episode_id, opened_via: chain.opened.opened_via, opened_pointer: chain.opened.sentence } : {}),
    ...(chain.dispatch_detail ? { dispatch_detail: chain.dispatch_detail } : {}),
    ...(chain.related?.length ? { related_events: chain.related } : {}),
  };
}

/** Additive worker-frontier field; absent for chains without a worker post. */
function workerFields(chain) {
  return chain.frontier.additional_stops ? { additional_stops: chain.frontier.additional_stops } : {};
}

/** Counts only (element_history, recent_actions); action_chain lists the rows. */
const unlinkedCounts = unlinked => ({ requests: unlinked.requests_total, server_spans: unlinked.server_spans_total, attribution: unlinked.attribution });

function compactCoverage(value) {
  return value ? { complete: value.complete, reasons: value.reasons, page: value.page, unobserved: value.unobserved, scope: value.scope,
    ...(value.window_reasons ? { window_reasons: value.window_reasons } : {}) } : null;
}
/** List surfaces (element_history, recent_actions) keep every entry but name at most 12 event kinds each. */
const EVENT_NAMES_LISTED = 12;
function listedCoverage(value) {
  if (!value?.unobserved) return value;
  return { ...value, unobserved: value.unobserved.map(entry => (Array.isArray(entry.names) && entry.names.length > EVENT_NAMES_LISTED
    ? { ...entry, names: entry.names.slice(0, EVENT_NAMES_LISTED), names_total: entry.names.length, names_note: 'action_chain lists every name' } : entry)) };
}
/** One line: what the page's rows show its runtime did not observe (never exhaustive). */
export function renderUnobserved(coverage) {
  const entries = coverage?.unobserved;
  if (!Array.isArray(entries) || !entries.length) return '';
  const part = entry => (entry.kind === 'events' ? (entry.count != null ? `${entry.lower_bound ? 'at least ' : ''}${entry.names_total ?? entry.count} event kind(s) that start no action` : 'event kinds not declared by this runtime')
    : entry.kind === 'transport' ? `transport ${entry.name} ${entry.status === 'replaced' ? 'wrapper replaced' : 'not wrapped'}`
      : `${entry.count ?? 1} ${entry.name} realm(s)${entry.name === 'frame' ? ` (${entry.same_origin} same-origin, ${entry.cross_origin} cross-origin)` : ''}`);
  return `Not observed on page ${coverage.page} (from its rows; not exhaustive: navigations and <img>/<form>/<link> loads are never recorded): ${entries.map(part).join('; ')}`;
}
/** Additive field: root server spans in the window that could continue the request (fix/honest-coverage). */
function escapeFields(chain) {
  return chain.frontier.root_escape ? { root_escape: chain.frontier.root_escape } : {};
}

const pageCaches = new WeakMap();
function pageCache(store) {
  if (!pageCaches.has(store)) {
    const requests = new Map(), boundaries = new Map();
    for (const row of store.records) if (row?.kind === 'network.request' && row.internal !== true && row.transport_internal !== true) { const list = requests.get(pageOf(row)) || []; list.push(row); requests.set(pageOf(row), list); }
    // User boundaries: the start of a new user gesture (a press), or any action
    // of a runtime that records no phase. Ranges, caused events and events of
    // the same gesture (mouseup, click, DOMActivate after a pointerdown) do not
    // start a window.
    for (const row of store.actionRows) if (row.gesture !== false && (typeof row.phase === 'string' ? row.phase !== 'continuous' : !row.coalesced)) { const list = boundaries.get(pageOf(row)) || []; list.push(row); boundaries.set(pageOf(row), list); }
    for (const list of [...requests.values(), ...boundaries.values()]) list.sort((left, right) => Number(left.sequence || 0) - Number(right.sequence || 0));
    pageCaches.set(store, { requests, boundaries });
  }
  return pageCaches.get(store);
}
/** Untrusted (synthetic) events the runtime skipped in (from, to) on a page. */
function untrustedIn(store, page, from, to) {
  return (store.untrustedByPage?.get(page) || []).filter(row => Number(row.sequence) > from && Number(row.sequence) < to);
}
/** The page's coverage plus what its runtime observed (D-G1-21 user_events: listened kinds and per-kind counts). */
function withUserEvents(store, page, coverage) {
  if (!coverage) return coverage;
  const userEvents = typeof store.userEventsFor === 'function' ? store.userEventsFor(page) : null;
  return userEvents ? { ...coverage, user_events: userEvents } : coverage;
}
/** Caused and opened events of this action's episode, each with the requests its own action sent. */
function relatedEvents(store, record) {
  const out = [];
  for (const entry of record.opened || []) out.push({ relation: 'opened', action_id: entry.action_id, event: entry.event,
    target: store.actionRows.find(row => row.action_id === entry.action_id)?.target || null, requests: entry.requests || [] });
  for (const entry of record.caused || []) {
    const requests = (store.requestsByAction.get(entry.action_id) || []).map(row => ({ method: String(row.method || 'GET').toUpperCase(), url: row.url ?? null, request_occurrence_id: row.request_occurrence_id ?? null }));
    out.push({ relation: 'caused', action_id: entry.action_id, event: entry.event, requests });
  }
  return out;
}

/**
 * Unlinked evidence under its own heading: a hint for a reader, never a stop.
 * Returns '' when there is nothing to list.
 */
export function renderUnlinked(unlinked, store = null) {
  if (!unlinked || (!unlinked.requests_total && !unlinked.server_spans_total)) return '';
  const lines = [`${unlinked.heading}:`];
  for (const row of unlinked.requests) {
    const server = row.server ? ` → ${renderServerTail(row.server)}` : row.server_join && row.server_join !== 'backend_not_instrumented' ? ` → no server span (${row.server_join})` : '';
    const issuer = store && row.issuer ? `; ${describeIssuer(store, row, pageOf(unlinked.window ? { capture_page_id: unlinked.window.page } : null))}` : '';
    // What the body rows hold (absent when none was recorded).
    const facts = [statusClause(row, row.server?.status_code), ...bodyTail(row)].filter(Boolean).map(text => `; ${text}`).join('');
    lines.push(`- request ${String(row.method || 'GET').toUpperCase()} ${requestTarget(row.url)} (${row.transport || 'transport unknown'}, sequence ${row.sequence}, no action_id)${server} [unlinked]${facts}${issuer}; attribution: ${row.attribution}`);
  }
  if (unlinked.requests_total > unlinked.requests.length) lines.push(`- … ${unlinked.requests_total - unlinked.requests.length} more request(s)`);
  for (const row of unlinked.server_spans) lines.push(`- server span ${row.method || '?'} ${row.route || row.name || '?'}${row.status_code != null ? ` ${row.status_code}` : ''}${serverWork(row)} (span ${row.span_id}, no request with its parent span id) [unlinked]; attribution: ${row.attribution}`);
  if (unlinked.server_spans_total > unlinked.server_spans.length) lines.push(`- … ${unlinked.server_spans_total - unlinked.server_spans.length} more server span(s)`);
  return lines.join('\n');
}

/** ` → server h1,h2 → db find items ×2` for a described server span (same wording as a segment). */
function serverWork(server) {
  const parts = [];
  if (server.handler_spans?.length) parts.push(`server ${server.handler_spans.map(handler => handler.name || '?').join(',')}`);
  if (server.db_ops?.length) parts.push(`db ${collapseDbOps(server.db_ops).join(', ')}`);
  if (server.hops_text) parts.push(server.hops_text);
  return parts.length ? ` → ${parts.join(' → ')}` : '';
}
/** `route R S → server h → db …` for a described server span. */
function renderServerTail(server) {
  return `${`route ${server.route || server.name || '?'} ${server.status_code ?? ''}`.trim()}${serverWork(server)}`;
}

// --- request / response bodies (network.body rows) ---------------------------
// Rendering only. A body row is linked to its request by (page,
// request_occurrence_id); it never creates, alters or ranks a chain. Values
// were redacted in the page; "[redacted]" is rendered like any other string.

const BODY_FIELDS_SHOWN = 12;
const BODY_IDS_SHOWN = 20;
const BODY_STRING_SHOWN = 200;
const BODY_ID_DEPTH = 4;
/** Id-shaped keys: `_id`, `id`, `*Id`, `*_id`. */
export const isIdKey = key => /^(?:_id|id)$|Id$|_id$/u.test(String(key));
const PARTIAL = new WeakSet();

/**
 * Parse the prefix of a JSON text cut at an arbitrary byte (a truncated
 * body). Returns `{ value, complete }`; containers cut short are kept with
 * what they held and remembered in PARTIAL; an incomplete scalar is dropped.
 */
export function parseJsonPrefix(text) {
  let i = 0;
  const INCOMPLETE = Symbol('incomplete');
  const ws = () => { while (i < text.length && /\s/u.test(text[i])) i += 1; };
  const string = () => {
    let j = i + 1;
    while (j < text.length) {
      if (text[j] === '\\') { j += 2; continue; }
      if (text[j] === '"') { try { const value = JSON.parse(text.slice(i, j + 1)); i = j + 1; return value; } catch { return INCOMPLETE; } }
      j += 1;
    }
    return INCOMPLETE;
  };
  const scalar = () => {
    const match = /^(?:-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/u.exec(text.slice(i, i + 64));
    if (!match || i + match[0].length >= text.length) return INCOMPLETE;
    i += match[0].length; return JSON.parse(match[0]);
  };
  const value = () => {
    ws(); if (i >= text.length) return INCOMPLETE;
    if (text[i] === '{') {
      const out = {}; i += 1;
      for (;;) {
        ws(); if (i >= text.length) { PARTIAL.add(out); return out; }
        if (text[i] === '}') { i += 1; return out; }
        if (text[i] === ',') { i += 1; continue; }
        if (text[i] !== '"') { PARTIAL.add(out); return out; }
        const key = string(); if (key === INCOMPLETE) { PARTIAL.add(out); return out; }
        ws(); if (text[i] !== ':') { PARTIAL.add(out); return out; } i += 1;
        const item = value();
        if (item !== INCOMPLETE) Object.defineProperty(out, key, { value: item, enumerable: true, writable: true, configurable: true });
        if (item === INCOMPLETE || (item && typeof item === 'object' && PARTIAL.has(item))) { PARTIAL.add(out); return out; }
      }
    }
    if (text[i] === '[') {
      const out = []; i += 1;
      for (;;) {
        ws(); if (i >= text.length) { PARTIAL.add(out); return out; }
        if (text[i] === ']') { i += 1; return out; }
        if (text[i] === ',') { i += 1; continue; }
        const item = value();
        if (item !== INCOMPLETE) out.push(item);
        if (item === INCOMPLETE || (item && typeof item === 'object' && PARTIAL.has(item))) { PARTIAL.add(out); return out; }
      }
    }
    if (text[i] === '"') return string();
    return scalar();
  };
  const result = value();
  return result === INCOMPLETE ? { value: undefined, complete: false } : { value: result, complete: !(result && typeof result === 'object' && PARTIAL.has(result)) };
}

const shownValue = value => {
  if (Array.isArray(value)) return `[${value.length}${PARTIAL.has(value) ? '+' : ''} items]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).length}${PARTIAL.has(value) ? '+' : ''} keys}`;
  if (typeof value === 'string' && value.length > BODY_STRING_SHOWN) return `${value.slice(0, BODY_STRING_SHOWN)}…`;
  return value;
};

/** Id-shaped keys at any object depth (not through arrays), as dotted paths. */
function bodyIds(value) {
  const ids = {}; let count = 0;
  const walk = (node, prefix, depth) => {
    if (!node || typeof node !== 'object' || Array.isArray(node) || depth > BODY_ID_DEPTH) return;
    for (const key of Object.keys(node)) {
      if (count >= BODY_IDS_SHOWN) return;
      const child = node[key]; const pathKey = prefix ? `${prefix}.${key}` : key;
      if (isIdKey(key) && (child === null || typeof child !== 'object')) { ids[pathKey] = shownValue(child); count += 1; }
      else walk(child, pathKey, depth + 1);
    }
  };
  walk(value, '', 1);
  return ids;
}

/**
 * Summary of one network.body row: top-level fields (id-shaped keys always,
 * then others up to 12 keys; arrays as `[n items]`, objects as `{n keys}`),
 * id-shaped keys at any depth, and `truncated`. `full` adds the recorded
 * content (`json` or `text`) exactly as stored.
 */
export function summarizeBody(row, { full = false, idsOnly = false } = {}) {
  if (!row) return null;
  const base = { direction: row.direction ?? null, content_type: row.content_type ?? null, bytes: row.bytes ?? null, truncated: row.truncated === true,
    captured: row.captured !== false, ...(row.captured === false ? { reason: row.reason ?? null } : {}), format: row.format ?? null,
    ...(row.status != null ? { status: row.status } : {}), redactions: row.redactions ?? 0 };
  if (row.captured === false) return idsOnly ? { direction: base.direction, captured: false, reason: base.reason, truncated: false, ids: {} } : base;
  let value; let complete = true;
  if (row.json !== undefined) value = row.json;
  else if (row.format === 'json' && typeof row.text === 'string') ({ value, complete } = parseJsonPrefix(row.text));
  const ids = value && typeof value === 'object' ? bodyIds(value) : {};
  if (idsOnly) return { direction: base.direction, captured: true, truncated: base.truncated, ids };
  const summary = { ...base, ids };
  if (Array.isArray(value)) { summary.shape = 'array'; summary.items = value.length; if (!complete) summary.items_at_least = true; }
  else if (value && typeof value === 'object') {
    summary.shape = 'object';
    const keys = Object.keys(value);
    const idKeys = keys.filter(isIdKey); const others = keys.filter(key => !isIdKey(key));
    const shown = [...idKeys, ...others.slice(0, Math.max(0, BODY_FIELDS_SHOWN - idKeys.length))];
    summary.fields = Object.fromEntries(shown.map(key => [key, shownValue(value[key])]));
    summary.fields_omitted = keys.length - shown.length;
    if (!complete) summary.fields_partial = true;
  } else if (value !== undefined) { summary.shape = 'scalar'; summary.value = shownValue(value); }
  else if (typeof row.text === 'string') { summary.shape = 'text'; summary.text_preview = shownValue(row.text); }
  if (full) { if (row.json !== undefined) summary.json = row.json; else if (typeof row.text === 'string') summary.text = row.text; }
  return summary;
}

const renderIds = ids => Object.entries(ids || {}).map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`).join(', ');

// --- what a request's body rows say, in words ----------------------------------
// One rule for every surface that prints a request (segments, unlinked
// entries, page_requests, and so every summary built on them): the request
// body's own top-level fields, and the response's status-bearing fields, so
// that two requests to one URL read differently in text, and a statement when
// they still do not. Ids are excluded here because they already print as
// `request ids` / `response ids`.
//  - request_fields: top-level short fields (a scalar, a string of at most 64
//    characters, or an array of at most 6 such scalars), fields whose value
//    differs from a peer's first, then the others in body order; at most 4 in
//    JSON and text, the rest counted in `request_fields_more` ("+N more fields").
//  - response_fields: short fields whose key is status-like (last key segment
//    error, status, state, code, revision, …), then short fields whose value
//    differs from a peer's; at most 4, the rest counted in `response_fields_more`.
//    A status-like key whose value is not short is named by its shape in
//    `response_shapes` (`error: {3 keys}`, `status: <301 chars>`).
//  - request_nested / response_nested: when a peer's body reads the same in
//    those fields and ids but is not the same body, the nested paths whose
//    short values differ (`opts.sort: asc (vs desc)`, at most 4, `+N more`);
//    when none is short, `*_differs_unshown: true` ("… differs … only in fields
//    not shown"). Nothing that differs is dropped without a statement.
// Peers are the other requests to the same METHOD + path in the same scope
// (the episode for segments, the unlinked list for unlinked entries, the
// listing for page_requests). Rendering only: a body never joins anything.
// Text caps each value at 32 characters (`…`); the JSON keeps the value.

const FIELDS_IN_TEXT = 4;
const FIELD_STRING_MAX = 64;
const FIELD_ARRAY_MAX = 6;
const FIELD_TEXT_MAX = 32;
const NESTED_DEPTH = 4;
// Status vocabulary (data, generic HTTP/API words, no app list): error(s),
// status, state, code, reason, result, ok, success, message, outcome, phase,
// stage, detail name the outcome of a call; revision / rev / version name the
// state a write left (optimistic-concurrency tokens: an ETag-like revision,
// `_rev`, `resourceVersion`), which is how two writes to one URL differ.
const STATUS_SEGMENTS = new Set(['error', 'errors', 'status', 'state', 'code', 'revision', 'rev', 'version', 'reason', 'result', 'ok', 'success', 'message', 'outcome', 'phase', 'stage', 'detail']);
const keySegments = key => String(key).replace(/([a-z0-9])([A-Z])/gu, '$1 $2').split(/[^A-Za-z0-9]+/u).map(part => part.toLowerCase()).filter(Boolean);
/** A status-bearing key: its last segment (camelCase, snake_case or kebab-case) is status vocabulary. */
export const isStatusKey = key => STATUS_SEGMENTS.has(keySegments(key).at(-1));
const isShortScalar = value => typeof value === 'number' || typeof value === 'boolean' || (typeof value === 'string' && value.length <= FIELD_STRING_MAX);
const isShortValue = value => isShortScalar(value) || (Array.isArray(value) && !PARTIAL.has(value) && value.length <= FIELD_ARRAY_MAX && value.every(isShortScalar));
const shapeOf = value => (Array.isArray(value) ? `[${value.length} items]` : value && typeof value === 'object' ? `{${Object.keys(value).length} keys}` : typeof value === 'string' ? `<${value.length} chars>` : String(value));

const bodyObjectCache = new WeakMap();
/** The recorded top-level object of a body row (a truncated JSON body through the prefix parser), or null. */
function bodyObject(row) {
  if (!row || row.captured === false) return null;
  if (bodyObjectCache.has(row)) return bodyObjectCache.get(row);
  let value;
  if (row.json !== undefined) value = row.json;
  else if (row.format === 'json' && typeof row.text === 'string') ({ value } = parseJsonPrefix(row.text));
  const object = value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  bodyObjectCache.set(row, object);
  return object;
}
/** Top-level short fields of a body (id-shaped keys excluded), as [key, value] in body order; null without an object body. */
function shortFields(row) {
  const value = bodyObject(row);
  return value ? Object.keys(value).filter(key => !isIdKey(key) && isShortValue(value[key])).map(key => [key, value[key]]) : null;
}
const sameValue = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const differsFromPeers = (key, value, peers) => peers.some(peer => !peer.some(([other, otherValue]) => other === key && sameValue(otherValue, value)));
/** Leaf paths of an object (objects only, to depth 4; arrays and scalars are leaves). */
function leafPaths(value, prefix = '', depth = 1, out = new Map()) {
  if (value && typeof value === 'object' && !Array.isArray(value) && depth <= NESTED_DEPTH) {
    for (const key of Object.keys(value)) leafPaths(value[key], prefix ? `${prefix}.${key}` : key, depth + 1, out);
  } else if (prefix) out.set(prefix, value);
  return out;
}

/** One side (request or response) of a request's body facts. */
function sideFacts(row, peerRows, { response }) {
  const own = shortFields(row);
  if (!own) return {};
  const peers = peerRows.map(shortFields).filter(Boolean);
  const qualifying = response
    ? [...own.filter(([key]) => isStatusKey(key)), ...own.filter(([key, value]) => !isStatusKey(key) && differsFromPeers(key, value, peers))]
    : [...own.filter(([key, value]) => differsFromPeers(key, value, peers)), ...own.filter(([key, value]) => !differsFromPeers(key, value, peers))];
  const shown = qualifying.slice(0, FIELDS_IN_TEXT);
  const out = { fields: shown.length ? Object.fromEntries(shown) : null, more: qualifying.length - shown.length };
  // A long string whose cut text equals a peer's different value would read the same: show where it differs instead.
  const cutText = value => capText(String(value));
  const clipped = {};
  for (const [key, value] of shown) {
    if (typeof value !== 'string' || value.length <= FIELD_TEXT_MAX) continue;
    const others = peers.flatMap(peer => peer.filter(([other, otherValue]) => other === key && typeof otherValue === 'string' && otherValue !== value).map(([, otherValue]) => otherValue));
    if (!others.some(other => cutText(other) === cutText(value))) continue;
    const tail = text => `…${text.slice(-(FIELD_TEXT_MAX - 1))}`;
    clipped[key] = others.every(other => tail(other) !== tail(value)) ? 'tail' : 'inside';
  }
  if (Object.keys(clipped).length) out.clipped = clipped;
  const object = bodyObject(row);
  if (response) {
    const shapes = Object.keys(object).filter(key => !isIdKey(key) && isStatusKey(key) && !isShortValue(object[key]) && object[key] !== null);
    if (shapes.length) out.shapes = Object.fromEntries(shapes.map(key => [key, shapeOf(object[key])]));
  }
  // Peers that read the same in text (the shown fields and every id) but are not the same body.
  const shownKeys = shown.map(([key]) => key);
  const readsAs = value => JSON.stringify([shownKeys.map(key => value?.[key]), bodyIds(value)]);
  const twins = peerRows.map(bodyObject).filter(value => value && readsAs(value) === readsAs(object) && !sameValue(value, object));
  if (twins.length) {
    const mine = leafPaths(object);
    const theirs = twins.map(value => leafPaths(value));
    const paths = [...new Set([...mine.keys(), ...theirs.flatMap(map => [...map.keys()])])]
      .filter(path => !shownKeys.includes(path) && theirs.some(map => !sameValue(map.get(path), mine.get(path))));
    const short = paths.filter(path => mine.has(path) && isShortValue(mine.get(path)) && theirs.every(map => !map.has(path) || isShortValue(map.get(path))));
    if (short.length) {
      out.nested = short.slice(0, FIELDS_IN_TEXT).map(path => ({ path, value: mine.get(path),
        peer_values: [...new Set(theirs.filter(map => !sameValue(map.get(path), mine.get(path))).map(map => JSON.stringify(map.has(path) ? map.get(path) : null)))].slice(0, 3).map(value => JSON.parse(value)) }));
      if (paths.length > out.nested.length) out.nested_more = paths.length - out.nested.length;
    } else out.differs_unshown = true;
  }
  return out;
}

/**
 * What one request's body rows say (`bodies` = `store.bodiesFor(row)`),
 * compared with its peers' body rows: `request_fields`, `response_fields`
 * (plus `*_more`, `response_shapes`, `*_nested` / `*_differs_unshown` when
 * present) and `browser_status`, the status the page's own response object
 * reported (the response body row's `status`), or null when no response body
 * row exists; an opaque response (`reason: "opaque_response"`, status 0) sets
 * `browser_status_hidden: "opaque_response"` instead: the browser does not
 * expose that status.
 */
export function bodyFacts(bodies, peerBodies = []) {
  const request = sideFacts(bodies?.request, peerBodies.map(peer => peer?.request).filter(Boolean), { response: false });
  const response = sideFacts(bodies?.response, peerBodies.map(peer => peer?.response).filter(Boolean), { response: true });
  const row = bodies?.response;
  const status = Number(row?.status);
  const opaque = Boolean(row) && (row.reason === 'opaque_response' || (row.status != null && status === 0));
  return { request_fields: request.fields ?? null, ...(request.more ? { request_fields_more: request.more } : {}), ...(request.clipped ? { request_fields_clipped: request.clipped } : {}),
    ...(request.nested ? { request_nested: request.nested, ...(request.nested_more ? { request_nested_more: request.nested_more } : {}) } : {}),
    ...(request.differs_unshown ? { request_differs_unshown: true } : {}),
    response_fields: response.fields ?? null, ...(response.more ? { response_fields_more: response.more } : {}), ...(response.clipped ? { response_fields_clipped: response.clipped } : {}), ...(response.shapes ? { response_shapes: response.shapes } : {}),
    ...(response.nested ? { response_nested: response.nested, ...(response.nested_more ? { response_nested_more: response.nested_more } : {}) } : {}),
    ...(response.differs_unshown ? { response_differs_unshown: true } : {}),
    browser_status: row?.status != null && Number.isFinite(status) && !opaque ? status : null, ...(opaque ? { browser_status_hidden: 'opaque_response' } : {}) };
}

/**
 * The browser's status (the page's response object) against the server span's
 * status: null when they agree or either is unknown; otherwise both, with the
 * generic reason the rows support. A server 304 read as 200 is a cache
 * revalidation (the browser answers from its cache); anything else is stated,
 * not explained. Status 0 is not a status (an opaque response hides it): never
 * a mismatch; `statusClause` states it instead.
 */
export function statusMismatch(browserStatus, serverStatus) {
  const browser = Number(browserStatus); const server = Number(serverStatus);
  if (browserStatus == null || serverStatus == null || serverStatus === '' || !Number.isFinite(browser) || !Number.isFinite(server) || browser === 0 || browser === server) return null;
  return { browser, server, reason: browser === 200 && server === 304 ? 'server answered 304; the browser reported 200 from its cache'
    : `browser reported ${browser}, server answered ${server}; not the same response, or a proxy between them` };
}
// A full-body page is ordered by (timestamp, page, sequence, occurrence id).
// The opaque id carries the last three tie breakers, so equal timestamps have
// a total, exclusive cursor. The same rule serves all three body surfaces.
export const BODY_BUDGET_BYTES = 512 * 1024;
const fullBytes = summary => (!summary ? 0 : summary.json !== undefined ? Buffer.byteLength(JSON.stringify(summary.json)) : typeof summary.text === 'string' ? Buffer.byteLength(summary.text) : 0);
const withoutFull = (summary, reason = 'budget') => { if (!summary || (summary.json === undefined && summary.text === undefined)) return summary; const { json: _json, text: _text, ...rest } = summary; return { ...rest, full_omitted: reason }; };
const bodyKey = entry => [Number(entry.timestamp || 0), String(entry.session || ''), Number(entry.sequence || 0), String(entry.request_occurrence_id || '')];
const compareBodyKey = (left, right) => left[0] - right[0] || left[1].localeCompare(right[1]) || left[2] - right[2] || left[3].localeCompare(right[3]);
const bodyCursor = entry => { const [until_timestamp, ...id] = bodyKey(entry); return { until_timestamp, until_id: JSON.stringify(id) }; };
function readBodyCursor(args) {
  if (args.until_timestamp === undefined && args.until_id === undefined) return null;
  if (args.until_timestamp === undefined || args.until_id === undefined) return false;
  try {
    const id = JSON.parse(args.until_id);
    return Array.isArray(id) && id.length === 3 && typeof id[0] === 'string' && Number.isFinite(id[1]) && typeof id[2] === 'string'
      ? [args.until_timestamp, ...id] : false;
  } catch { return false; }
}
const beforeBodyCursor = (entry, cursor) => !cursor || compareBodyKey(bodyKey(entry), cursor) < 0;
const bodyBudgetNotice = report => [
  ...(report.truncated_to_budget || []).map(row => `request ${row.request_occurrence_id} had ${row.full_size_bytes} full-body bytes; its body was truncated to the ${BODY_BUDGET_BYTES / 1024} KB budget and the omitted bytes cannot be recovered`),
  ...(report.cut ? [report.next_cursor
    ? `bodies of ${report.cut} older request(s) are summaries (over the ${BODY_BUDGET_BYTES / 1024} KB budget); call again with until_timestamp=${report.next_cursor.until_timestamp} and until_id=${JSON.stringify(report.next_cursor.until_id)} (and the same filters)`
    : `bodies of ${report.cut} older request(s) are summaries and cannot be reached with a body cursor`] : []),
].join('; ');
const truncateFull = (summary, bytes) => {
  if (!summary || (summary.json === undefined && summary.text === undefined)) return summary;
  const content = summary.json === undefined ? summary.text : JSON.stringify(summary.json);
  const fullSize = Buffer.byteLength(content);
  if (fullSize <= bytes) return summary;
  let prefix = Buffer.from(content).subarray(0, bytes).toString('utf8');
  while (Buffer.byteLength(prefix) > bytes) prefix = prefix.slice(0, -1);
  const { json: _json, text: _text, ...rest } = summary;
  return { ...rest, text: prefix, truncated_to_budget: true, full_size_bytes: fullSize };
};
/**
 * Applies the budget to `entries` (newest first), each with `body` / `response_body`.
 * Returns `{ entries (same order, copies where cut), report }`.
 */
function budgetBodies(entries) {
  let spent = 0; let full = 0; let cut = 0; let total = 0; let lastFull = null;
  const truncated = [];
  const out = entries.map(entry => {
    const size = fullBytes(entry.body) + fullBytes(entry.response_body);
    if (!size) return entry;
    total += 1;
    // Strictly newest first: once one is over budget, every older one is a summary.
    if (!cut && spent + size <= BODY_BUDGET_BYTES) { spent += size; full += 1; lastFull = entry; return entry; }
    if (!cut && !lastFull && size > BODY_BUDGET_BYTES) {
      const requestBytes = Math.min(fullBytes(entry.body), BODY_BUDGET_BYTES);
      const body = truncateFull(entry.body, requestBytes);
      const response_body = truncateFull(entry.response_body, BODY_BUDGET_BYTES - requestBytes);
      spent = fullBytes(body) + fullBytes(response_body);
      lastFull = entry;
      truncated.push({ request_occurrence_id: entry.request_occurrence_id, full_size_bytes: size });
      return { ...entry, body, response_body, truncated_to_budget: true };
    }
    cut += 1;
    return { ...entry, body: withoutFull(entry.body), response_body: withoutFull(entry.response_body) };
  });
  const report = { budget_bytes: BODY_BUDGET_BYTES, bytes: spent, with_full_bodies: full, cut, requests_with_bodies: total,
    ...(truncated.length ? { truncated_to_budget: truncated } : {}),
    ...(cut && lastFull ? { next_cursor: bodyCursor(lastFull) } : {}) };
  return { entries: out, report };
}
function bodyRefs(store, entries, session) {
  return entries.map((entry, index) => {
    const row = store.records.find(value => value?.kind === 'network.request' && value.request_occurrence_id === entry.request_occurrence_id
      && pageOf(value) === session) || entry;
    return { entry, index, session, timestamp: row.timestamp, sequence: row.sequence, request_occurrence_id: entry.request_occurrence_id };
  });
}
function budgetRefs(refs, cursor) {
  const ordered = [...refs].sort((left, right) => -compareBodyKey(bodyKey(left), bodyKey(right)));
  const seen = new Set();
  const eligible = ordered.filter(ref => {
    if (!beforeBodyCursor(ref, cursor)) return false;
    const key = JSON.stringify(bodyKey(ref));
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
  const { entries, report } = budgetBodies(eligible.map(ref => ({ ...ref, body: ref.entry.body, response_body: ref.entry.response_body })));
  const byRef = new Map();
  for (let i = 0; i < eligible.length; i += 1) byRef.set(eligible[i], { ...eligible[i].entry, body: entries[i].body, response_body: entries[i].response_body });
  for (const ref of ordered) if (!byRef.has(ref)) byRef.set(ref, { ...ref.entry, body: withoutFull(ref.entry.body, beforeBodyCursor(ref, cursor) ? 'duplicate' : 'cursor'),
    response_body: withoutFull(ref.entry.response_body, beforeBodyCursor(ref, cursor) ? 'duplicate' : 'cursor') });
  return { byRef, report };
}

/** The status sentence of an entry: its mismatch reason, or that the browser hid the status of an opaque response. */
function statusClause(entry, serverStatus) {
  if (entry?.status_mismatch) return entry.status_mismatch.reason;
  if (entry?.browser_status_hidden === 'opaque_response') return `the browser hid the status (opaque response)${serverStatus != null && serverStatus !== '' ? `; server answered ${serverStatus}` : ''}`;
  if (entry?.browser_status_not_recorded && serverStatus != null) return 'browser-side status not recorded (body capture off); cannot check the browser/server status view';
  return null;
}
const bodyCaptureOff = (store, page) => ['off', 'production_off'].includes(store.coverageFor?.(page)?.bodies);

const capText = text => (text.length > FIELD_TEXT_MAX ? `${text.slice(0, FIELD_TEXT_MAX - 1)}…` : text);
const fieldValueText = value => capText(Array.isArray(value) ? `[${value.map(item => fieldValueText(item)).join(', ')}]`
  : typeof value === 'string' ? (value === '' || /[,;[\]]/u.test(value) ? JSON.stringify(value) : value) : JSON.stringify(value));
// `clipped[key]`: 'tail' shows the value's last characters (its start reads the same as a peer's different value);
// 'inside' says the difference lies past the characters shown.
const clippedText = (value, how) => (how === 'tail' ? `…${String(value).slice(-(FIELD_TEXT_MAX - 1))}` : `${fieldValueText(value)} (differs from another request's value past the characters shown)`);
const fieldsText = (fields, more = 0, shapes = null, clipped = null) => [...Object.entries(fields || {}).map(([key, value]) => `${key}: ${clipped?.[key] ? clippedText(value, clipped[key]) : fieldValueText(value)}`),
  ...Object.entries(shapes || {}).map(([key, shape]) => `${key}: ${shape}`), ...(more ? [`+${more} more field${more === 1 ? '' : 's'}`] : [])].join(', ');
const nestedText = (nested, more = 0) => [...nested.map(item => `${item.path}: ${fieldValueText(item.value)} (vs ${item.peer_values.map(value => fieldValueText(value)).join(' / ')})`),
  ...(more ? [`+${more} more`] : [])].join(', ');
/** Clauses every summary prints for a request's bodies: `sent type: pulse`, `answered error: locked`. */
function sentText(facts) {
  const parts = [];
  if (facts?.request_fields || facts?.request_fields_more) parts.push(`sent ${fieldsText(facts.request_fields, facts.request_fields_more, null, facts.request_fields_clipped)}`);
  if (facts?.request_nested) parts.push(`sent ${nestedText(facts.request_nested, facts.request_nested_more)}`);
  if (facts?.request_differs_unshown) parts.push('request body differs from another request to this URL only in fields not shown');
  return parts.length ? parts.join('; ') : null;
}
function answeredText(facts) {
  const parts = [];
  if (facts?.response_fields || facts?.response_fields_more || facts?.response_shapes) parts.push(`answered ${fieldsText(facts.response_fields, facts.response_fields_more, facts.response_shapes, facts.response_fields_clipped)}`);
  if (facts?.response_nested) parts.push(`answered ${nestedText(facts.response_nested, facts.response_nested_more)}`);
  if (facts?.response_differs_unshown) parts.push('response body differs from another response to this URL only in fields not shown');
  return parts.length ? parts.join('; ') : null;
}

/** Unlinked request entries with their body summaries and body facts (peers: the other listed requests to the same endpoint). */
function withUnlinkedBodies(store, unlinked, { includeBodies = false } = {}) {
  if (!unlinked || !Array.isArray(unlinked.requests) || !unlinked.requests.length) return unlinked;
  const page = unlinked.window?.page ?? null;
  const bodiesOf = row => (typeof store.bodiesFor === 'function' && page != null ? store.bodiesFor({ capture_page_id: page, request_occurrence_id: row.request_occurrence_id }) : null);
  const endpoint = row => `${String(row.method || 'GET').toUpperCase()} ${requestPath(row.url)}`;
  const listed = unlinked.requests.map(row => ({ row, bodies: bodiesOf(row) }));
  return { ...unlinked, requests: listed.map(({ row, bodies }) => {
    const peers = listed.filter(other => other.row !== row && endpoint(other.row) === endpoint(row));
    const facts = { ...bodyFacts(bodies, peers.map(other => other.bodies)), fields_compared_with: { scope: 'unlinked_window', peers: peers.length },
      ...(bodyCaptureOff(store, page) && !bodies?.response ? { browser_status_not_recorded: true } : {}) };
    const mismatch = statusMismatch(facts.browser_status, row.server?.status_code);
    return { ...row, ...(row.server?.hops?.length ? { bodies: row.server.bodies } : {}), body: summarizeBody(bodies?.request, { full: includeBodies }), response_body: summarizeBody(bodies?.response, { full: includeBodies }),
      ...facts, ...(mismatch ? { status_mismatch: mismatch } : {}) };
  }) };
}

// --- per-request segments ----------------------------------------------------

const entersCache = new WeakMap();
/** function.enter rows per action_id (issueDeferral finds a continuation's creating frame among them). */
function entersByActionOf(store) {
  if (!entersCache.has(store)) {
    const map = new Map();
    for (const row of store.records || []) if (row?.kind === 'function.enter' && row.action_id) { const list = map.get(row.action_id) || []; list.push(row); map.set(row.action_id, list); }
    entersCache.set(store, map);
  }
  return entersCache.get(store);
}

const SEGMENTS_INLINE = 5;

const spanMs = value => (Array.isArray(value) ? Number(value[0]) * 1000 + Number(value[1]) / 1e6 : (Number.isFinite(Number(value)) ? Number(value) : null));
const rowOrder = (left, right) => Number(left?.timestamp || 0) - Number(right?.timestamp || 0) || Number(left?.sequence || 0) - Number(right?.sequence || 0);

/** Consecutive repeats of one function id (an async resumption) collapse to one hop. */
const dedupeHops = ids => ids.filter((id, index) => typeof id === 'string' && id !== ids[index - 1]);

/**
 * One segment per attributed request of the episode, in dispatch order. Each
 * carries only what its own request_occurrence_id joined (exact parentage via
 * attachBackendSpans): route, handler spans, every DB span, the outcome, a
 * third-party mark, deferred server work, and its own frontier.
 */
export function requestSegments(store, record, episode, { includeBodies = false } = {}) {
  if (!store.joinedEpisodeRows && !store.joinedRowsFor) return [];
  const joined = store.joinedRowsFor ? store.joinedRowsFor(episode) : store.joinedEpisodeRows(episode.action_ids[0]);
  const requests = joined.filter(row => row.kind === 'network.request' && row.action_id && row.internal !== true && row.transport_internal !== true).sort(rowOrder);
  const pending = Boolean(record.terminal?.pending);
  // Body rows of every request first: a request's fields are compared with its same-endpoint peers in this scope.
  const bodiesList = requests.map(request => (typeof store.bodiesFor === 'function' ? store.bodiesFor(request) : null));
  const endpointOf = request => `${String(request.method || 'GET').toUpperCase()} ${requestPath(request.url)}`;
  return requests.map((request, index) => {
    const occurrence = request.request_occurrence_id ?? null;
    // Without an occurrence id a request can only be separated when it is its action's only request.
    const soleOfAction = requests.filter(row => row.action_id === request.action_id).length === 1;
    const own = row => (occurrence ? row.request_occurrence_id === occurrence : (soleOfAction && !row.request_occurrence_id && row.action_id === request.action_id));
    const routes = joined.filter(row => row.kind === 'route.dispatch' && own(row));
    const handlers = joined.filter(row => row.kind === 'handler.enter' && own(row));
    const dbs = joined.filter(row => row.kind === 'db.operation' && own(row));
    const diagnostics = joined.filter(row => row.kind === 'span.join.diagnostic' && own(row));
    const hopRows = joined.filter(row => row.kind === 'server.hop' && own(row));
    // Lineage: the request's own spine, else the spine of the function that owns its continuation.
    const owner = request.terminal_owner_continuation_id ? store.functionEnterByContinuation?.get(request.terminal_owner_continuation_id) : null;
    const lineage = request.spine?.function_ids?.length ? request.spine.function_ids : (owner?.spine?.function_ids || []);
    const firstParty = lineage.filter(id => store.isFirstPartyFunction(id));
    const thirdParty = firstParty.length === 0;
    const path = dedupeHops(lineage).map(id => store.functionInfo(id));
    // The one segment builder (analysis/causal-chain.mjs), on this request's own joined steps.
    const steps = [{ ...request, kind: 'network.request' }, ...routes, ...handlers, ...dbs, ...diagnostics, ...hopRows];
    // Sent on a continuation the action owns (timer, promise, effect): from continuation ids (issueDeferral).
    const issue = issueDeferral(request, { dispatch: store.actionsById?.get(request.action_id)?.[0] || null, enterByContinuation: store.functionEnterByContinuation || null,
      entersByAction: entersByActionOf(store) });
    const core = requestSegmentCore(steps, { backendInstrumented: store.backendInstrumented, pending, entry_handler: record.entry_handler, windowRoots: record.window_roots ?? null, issue,
      spanStart: spanId => spanMs(store.spanById.get(spanId)?.start_time), spanEnd: spanId => spanMs(store.spanById.get(spanId)?.end_time) });
    const route = routes[0] || null;
    // Rows joined by this package carry these fields; read the span for rows that do not.
    const info = route ? spanInfo(store, route.span_id) : null;
    const handlerSpans = handlers.map(row => { const value = spanInfo(store, row.span_id); return { span_id: row.span_id, route: value.route, name: value.handler_name, index: value.handler_index }; });
    const bodies = bodiesList[index];
    const peerBodies = requests.map((other, otherIndex) => (otherIndex !== index && endpointOf(other) === endpointOf(request) ? bodiesList[otherIndex] : undefined)).filter(value => value !== undefined);
    const facts = { ...bodyFacts(bodies, peerBodies), fields_compared_with: { scope: 'episode', peers: peerBodies.length },
      ...(bodyCaptureOff(store, pageOf(request)) && !bodies?.response ? { browser_status_not_recorded: true } : {}) };
    const mismatch = statusMismatch(facts.browser_status, core.http_status);
    const { frontier, label } = core;
    const outcome = label.status;
    const segment = {
      index: index + 1, action_id: request.action_id, request_occurrence_id: occurrence, sequence: request.sequence ?? null,
      method: String(request.method || 'GET').toUpperCase(), url: request.url ?? null, path: requestPath(request.url), query: requestQuery(request.url) || null, trace_id: request.trace_context?.trace_id ?? null,
      third_party: thirdParty, first_party_frames: firstParty.length, lineage: path,
      route: route ? { span_id: route.span_id, method: info.method, route: info.route, status_code: info.status_code } : null,
      http_status: core.http_status, handler_spans: handlerSpans, db_ops: core.db_ops,
      ...(core.responded_by ? { responded_by: core.responded_by } : {}),
      // A request the page aborted: the server's answer is kept, not the request's status.
      ...(outcome === 'aborted_by_client' ? { aborted_by_client: true, server_status: label.server_status, aborted_at: label.aborted_at, abort_reason: label.abort_reason } : {}),
      ...(request.response_read_by_app ? { response_read_by_app: request.response_read_by_app } : {}),
      // Server-to-server hops (exact traceparent joins) and the hops not followed.
      hops: core.hops, escaped_hops: core.escaped_hops, hops_text: core.hops_text, ...(core.bodies ? { bodies: core.bodies } : {}),
      outcome, ...(label.note ? { note: label.note } : {}), outcome_label: label.label, outcome_text: outcomeText(label), deferred: core.deferred, join_diagnostic: core.join_diagnostic,
      body: summarizeBody(bodies?.request, { full: includeBodies }), response_body: summarizeBody(bodies?.response, { full: includeBodies }),
      ...facts, ...(mismatch ? { status_mismatch: mismatch } : {}),
      reached: frontier.reached, stopped_at: frontier.stopped_at, because: frontier.because, ...(frontier.text ? { stopped_text: frontier.text } : {}),
      ...(frontier.additional_stops ? { additional_stops: frontier.additional_stops } : {}),
    };
    segment.summary = renderSegment(segment, record, label);
    return segment;
  });
}

// --- owned work ----------------------------------------------------------

const WORK_DEPTH = 4;
const WORK_SHOWN = 12;
const WORK_JSON = 100;
const AFTER_KINDS = new Set(['promise', 'await']);
const ENTRY_RANK = { call: 0, chunk: 1, body: 2 };
/** Kind of the continuation a frame was entered on (`continuation:<action>:<kind>:<n>`). */
const continuationKind = id => /:([a-z_]+):\d+$/u.exec(String(id || ''))?.[1] ?? null;
const viaOf = id => { const kind = continuationKind(id); return kind === 'function' ? 'call' : kind === 'action' ? 'dispatch' : kind; };
const bySequence = (left, right) => Number(left?.sequence ?? Infinity) - Number(right?.sequence ?? Infinity);
const startsWith = (list, prefix) => prefix.length <= list.length && prefix.every((id, index) => list[index] === id);

/**
 * The episode's owned work: every first-party frame its actions entered
 * (`function.enter` rows carrying one of its action ids; the runtime writes
 * only action-owned frames), grouped by call path (the row's spine), with call
 * counts, in first-seen order, as a tree. Each attributed request hangs off
 * the frame whose spine issued it. A frame entered on a promise/await
 * continuation of the lineage that issued a request, and recorded after that
 * request's server span ended, is marked `after_response` (ids attach the
 * lineage; timestamps only order it after the response). Rendering only: no
 * credit, no join.
 */
const workCache = new WeakMap();
export function actionWork(store, record, episode, segments) {
  if (!store.joinedEpisodeRows && !store.joinedRowsFor) return null;
  if (!workCache.has(store)) workCache.set(store, new Map());
  const cache = workCache.get(store);
  // A member chain's scope is its own actions only: key the cache by the scope's actions.
  const key = `${episode.episode_id}\u0000${(episode.action_ids || []).join(',')}`;
  if (!cache.has(key)) cache.set(key, computeWork(store, episode, segments));
  return cache.get(key);
}

function computeWork(store, episode, segments) {
  const rows = store.joinedRowsFor ? store.joinedRowsFor(episode) : store.joinedEpisodeRows(episode.action_ids[0]);
  const enters = rows.filter(row => row.kind === 'function.enter' && typeof row.function_id === 'string').sort(bySequence);
  const nodes = new Map(); let nonFirstParty = 0;
  const byContinuation = new Map(enters.map(row => [row.continuation_id, row]));
  for (const row of enters) {
    if (!store.isFirstPartyFunction(row.function_id)) { nonFirstParty += 1; continue; }
    const spine = Array.isArray(row.spine?.function_ids) && row.spine.function_ids.length ? row.spine.function_ids : [row.function_id];
    const rawIds = spine.at(-1) === row.function_id ? spine : [...spine, row.function_id];
    // One call can write several enters, nested in a fixed order: the
    // call-site proxy (`entry: "call"`), the chunk pass's frame (`"chunk"`),
    // the module pass's frame (`"body"`). Runtimes from 2026-09-24 mark them:
    // an enter nested directly under an earlier-ranked enter of the same
    // function is the same call; anything else (recursion included) is a call.
    // Older rows carry no marker: an enter whose spine ends in the same id
    // twice, entered synchronously, is taken as the same call, and a run of
    // three or more of the id (recursion) makes the count inexact.
    let sameCall; let recursive = false; let exact = true;
    if (Object.hasOwn(ENTRY_RANK, row.entry)) {
      const parent = byContinuation.get(row.parent_continuation_id);
      sameCall = parent?.function_id === row.function_id && Object.hasOwn(ENTRY_RANK, parent.entry) && ENTRY_RANK[parent.entry] < ENTRY_RANK[row.entry];
      recursive = !sameCall && rawIds.slice(0, -1).includes(row.function_id);
    } else {
      sameCall = rawIds.length > 1 && rawIds.at(-2) === row.function_id && viaOf(row.parent_continuation_id) === 'call';
      exact = !(rawIds.length > 2 && rawIds.at(-2) === row.function_id && rawIds.at(-3) === row.function_id);
    }
    const ids = dedupeHops(rawIds);
    const key = ids.join('\u0000');
    let node = nodes.get(key);
    if (!node) {
      node = { key, ids, function_id: row.function_id, calls: 0, first_sequence: row.sequence ?? null, first_timestamp: Number(row.timestamp) || null,
        action_id: row.action_id ?? null, via: viaOf(row.parent_continuation_id), invoked_by: row.invoked_by ?? null, children: [],
        enter_rows: 0, calls_exact: true, recursive: false, response_of: new Set() };
      nodes.set(key, node);
    }
    node.enter_rows += 1;
    if (!sameCall) node.calls += 1;
    if (recursive) node.recursive = true;
    if (!exact) node.calls_exact = false;
    if (typeof row.response_of === 'string') node.response_of.add(row.response_of);
  }
  // Rows from runtimes that record `entry` also record `response_of`.
  const identified = enters.some(row => Object.hasOwn(ENTRY_RANK, row.entry));
  const parentOf = ids => { for (let length = ids.length - 1; length > 0; length -= 1) { const hit = nodes.get(ids.slice(0, length).join('\u0000')); if (hit) return hit; } return null; };
  const roots = [];
  for (const node of nodes.values()) (parentOf(node.ids)?.children || roots).push({ type: 'frame', node });
  // Requests hang off the frame whose spine issued them (else its nearest recorded ancestor, else the top level).
  const requestRows = rows.filter(row => row.kind === 'network.request' && row.action_id && row.internal !== true && row.transport_internal !== true);
  const requests = segments.map(segment => {
    const row = requestRows.find(value => (segment.request_occurrence_id ? value.request_occurrence_id === segment.request_occurrence_id : value.sequence === segment.sequence)) || null;
    const ids = dedupeHops(row?.spine?.function_ids || []);
    const server = segment.route ? store.spanById.get(segment.route.span_id) : null;
    return { segment, ids, sequence: row?.sequence ?? segment.sequence, response_end_ms: server ? spanEndMs(server) : null };
  });
  for (const request of requests) {
    const exact = request.ids.length ? nodes.get(request.ids.join('\u0000')) : null;
    ((exact || (request.ids.length ? parentOf([...request.ids, '\u0001']) : null))?.children || roots).push({ type: 'request', request, sequence: request.sequence });
  }
  const sequenceOf = item => (item.type === 'frame' ? item.node.first_sequence : item.sequence);
  const entries = []; let omittedDeeper = 0;
  const requestEntry = (request, depth, cut = null) => {
    const { segment } = request;
    const issuer = request.ids.length ? store.functionInfo(request.ids.at(-1)) : null;
    return { type: 'request', depth, index: segment.index, method: segment.method, path: segment.path, query: segment.query ?? null,
      outcome: segment.outcome, outcome_text: segment.outcome_text ?? null, http_status: segment.http_status, third_party: segment.third_party, issued_by: issuer?.label ?? null,
      ...(cut ? { below_depth_limit: true } : {}) };
  };
  const subtreeRequests = item => (item.type === 'request' ? [item.request] : item.node.children.flatMap(subtreeRequests));
  const walk = (items, depth, marked, parent) => {
    for (const item of items.sort((left, right) => Number(sequenceOf(left) ?? Infinity) - Number(sequenceOf(right) ?? Infinity))) {
      if (item.type === 'request') { entries.push({ ...requestEntry(item.request, depth), parent }); continue; }
      const { node } = item;
      if (depth >= WORK_DEPTH) {
        // Deeper frames are counted, never dropped silently; a request issued under them still hangs at the limit.
        omittedDeeper += countFrames(item);
        for (const request of subtreeRequests(item)) entries.push({ ...requestEntry(request, depth, true), parent });
        continue;
      }
      const info = store.functionInfo(node.function_id);
      const entry = { type: 'frame', depth, function_id: node.function_id, name: info?.name ?? null, display_name: info?.display_name ?? null, name_status: info?.name_status ?? null, label: info?.label ?? node.function_id, calls: node.calls,
        first_sequence: node.first_sequence, action_id: node.action_id, via: node.via, invoked_by: node.invoked_by, parent };
      if (identified) {
        // Identifier: the frame runs on a continuation of that request's fetch
        // promise (or a promise derived from it), an await on it, or a
        // load-type listener of its XHR (`response_of`, recorded at creation).
        const linked = marked ? [] : requests.filter(request => request.segment.request_occurrence_id && node.response_of.has(request.segment.request_occurrence_id));
        if (linked.length) entry.after_response = { requests: linked.map(request => request.segment.index), http_status: linked.map(request => request.segment.http_status),
          // A request the page aborted may have no response at all: the frame ran after its promise settled.
          ...(linked.some(request => request.segment.outcome === 'aborted_by_client') ? { aborted_by_client: linked.map(request => request.segment.outcome === 'aborted_by_client') } : {}),
          basis: 'response_of: the frame runs on a continuation of this request\'s fetch promise (or one derived from it), an await on it, or its XHR load listener' };
      } else if (!marked && node.ids.length > 1 && AFTER_KINDS.has(node.via)) {
        // Older rows record no response origin: only an order can be shown.
        const lineage = node.ids.slice(0, -1);
        const before = requests.filter(request => startsWith(request.ids, lineage) && Number(request.sequence) < Number(node.first_sequence));
        const responded = before.filter(request => request.response_end_ms != null && node.first_timestamp != null && request.response_end_ms <= node.first_timestamp);
        if (responded.length) entry.ordered_after_response = { requests: responded.map(request => request.segment.index), http_status: responded.map(request => request.segment.http_status),
          basis: `a ${node.via} continuation of the lineage that issued the request, recorded after its server span ended (browser vs server clock); not linked to the response (this runtime records no response origin)` };
        else if (before.length) entry.ordered_after_request = { requests: before.map(request => request.segment.index),
          basis: `a ${node.via} continuation of the lineage that issued the request, recorded after it; not linked` };
      }
      if (!node.calls_exact) entry.calls_exact = false;
      if (node.recursive) entry.recursive = true;
      entry.enter_rows = node.enter_rows;
      const index = entries.push(entry) - 1;
      walk(node.children, depth + 1, marked || Boolean(entry.after_response || entry.ordered_after_response || entry.ordered_after_request), index);
    }
  };
  const countFrames = item => (item.type === 'frame' ? 1 + item.node.children.reduce((sum, child) => sum + countFrames(child), 0) : 0);
  walk(roots, 0, false, null);
  // Priority for display: requests, frames marked after a request, and the
  // frames on the path to them; then every other frame in first-seen order.
  for (const [index, entry] of entries.entries()) {
    if (entry.type !== 'request' && !entry.after_response && !entry.ordered_after_response && !entry.ordered_after_request) continue;
    entry.important = true;
    for (let parent = entry.parent; parent != null && !entries[parent].important; parent = entries[parent].parent) entries[parent].important = true;
    void index;
  }
  const frames = entries.filter(entry => entry.type === 'frame');
  let budget = WORK_JSON - entries.filter(entry => entry.important).length;
  const kept = entries.filter(entry => entry.important || (budget-- > 0));
  const renumber = new Map(entries.map((entry, index) => [index, kept.indexOf(entry)]));
  return { rule: 'first-party frames entered by this episode\'s actions (function.enter rows), grouped by call path, first-seen order; requests hang off the frame that issued them',
    depth_limit: WORK_DEPTH, frames_entered: enters.length, frames_total: frames.length + omittedDeeper, omitted_deeper: omittedDeeper, non_first_party_frames: nonFirstParty,
    entries: kept.map(({ parent, ...entry }) => ({ ...entry, parent: parent == null ? null : (renumber.get(parent) >= 0 ? renumber.get(parent) : null) })), entries_total: entries.length };
}

/**
 * Indented listing of `actionWork`: every request line (up to 10), the frames
 * on the path to requests and after-response frames, then other frames in
 * first-seen order, at most 12 named frames in all, then `+N more`.
 */
export function renderWork(work) {
  if (!work || !work.entries.length) return '';
  const lines = [`Work (first-party frames this action's episode entered, first-seen order; ×n = calls; depth ≤ ${work.depth_limit}):`];
  const frames = work.entries.filter(entry => entry.type === 'frame');
  const chosen = new Set();
  for (const entry of frames) if (entry.important && chosen.size < WORK_SHOWN) chosen.add(entry);
  for (const entry of frames) if (!chosen.has(entry) && chosen.size < WORK_SHOWN) chosen.add(entry);
  let requestLines = 0; let requestsHidden = 0;
  for (const entry of work.entries) {
    const indent = '  '.repeat(entry.depth);
    if (entry.type === 'request') {
      if (requestLines >= 10) { requestsHidden += 1; continue; }
      requestLines += 1;
      const parentShown = entry.parent != null && chosen.has(work.entries[entry.parent]);
      const from = (!parentShown || entry.below_depth_limit) && entry.issued_by ? ` (issued by ${entry.issued_by}${entry.below_depth_limit ? ', below the depth limit' : ''})` : '';
      lines.push(`${indent}- request (${entry.index}) ${entry.method} ${entry.path}${entry.query || ''} [${entry.outcome_text || (entry.http_status != null ? `${entry.outcome} ${entry.http_status}` : entry.outcome)}]${entry.third_party ? ' (third-party)' : ''}${from}`);
      continue;
    }
    if (!chosen.has(entry)) continue;
    const calls = entry.calls_exact === false ? ` (${entry.enter_rows} enter rows; repeated or recursive calls are not separable)`
      : `${entry.calls > 1 ? ` ×${entry.calls}` : ''}${entry.recursive ? ' (recursive)' : ''}`;
    const responses = mark => { const statuses = mark.http_status || [];
      return mark.requests.length === 1 ? `${statuses[0] ?? ''}`.trim() || `(${mark.requests[0]})` : mark.requests.map((index, i) => `(${index}) ${statuses[i] ?? ''}`.trim()).join(', '); };
    const lead = entry.after_response?.aborted_by_client?.every(Boolean) ? `after request ${entry.after_response.requests.map(index => `(${index})`).join(', ')} settled (aborted by the page): `
      : entry.after_response ? `after response ${responses(entry.after_response)}: `
      : entry.ordered_after_response ? `ordered after the response ${responses(entry.ordered_after_response)}; not linked: `
        : entry.ordered_after_request ? `ordered after request ${entry.ordered_after_request.requests.map(index => `(${index})`).join(', ')}; not linked: ` : '';
    const via = entry.depth > 0 && entry.via && entry.via !== 'call' ? ` (${entry.via} continuation)` : '';
    lines.push(`${indent}- ${lead}${entry.label}${calls}${via}`);
  }
  if (requestsHidden) lines.push(`- … ${requestsHidden} more request(s) (see segments)`);
  const more = work.frames_total - chosen.size;
  if (more > 0) lines.push(`- +${more} more frame path(s)${work.omitted_deeper ? ` (${work.omitted_deeper} deeper than depth ${work.depth_limit})` : ''} (see work.entries)`);
  return lines.join('\n');
}

/** One line naming an entry-handler abstention's listeners (empty when there is none). */
export function renderListeners(listeners) {
  if (!listeners) return '';
  const list = rows => rows.map(row => row.label || row.function_id).join(', ') || 'none';
  const ran = listeners.global_listeners ? `global listeners that ran: ${list(listeners.global_listeners)}` : `handlers that ran: ${list(listeners.handlers_ran || [])}`;
  return `No element-bound handler credited; ${ran}; bound to the element: ${list(listeners.bound_handlers)}`;
}

/** `find items ×3`: repeats collapsed, first-seen order. */
/** `find items ×3 (handler: listItems), find users (middleware: auth)`: the one text (dbOpsText) every summary prints. */
export function collapseDbOps(dbOps) {
  return dbOpsText(dbOps);
}

const LINEAGE_SHOWN = 6;
function renderSegment(segment, record, label) {
  const parts = [];
  if (segment.third_party) parts.push('third-party: issued by uninstrumented code during this action');
  else {
    // The entry handler is named once at the action level; the lineage continues from it.
    const hops = segment.lineage[0]?.function_id === record.entry_handler?.function_id ? segment.lineage.slice(1) : segment.lineage;
    // The summary keeps both ends of a long lineage; the JSON `lineage` lists every hop.
    const labels = hops.map(hop => hop.label);
    parts.push(...(labels.length > LINEAGE_SHOWN ? [...labels.slice(0, 2), `… ${labels.length - 5} more hops …`, ...labels.slice(-3)] : labels));
  }
  parts.push(`${segment.method} ${segment.path}${segment.query || ''}`);
  if (segment.route) parts.push(`route ${segment.route.route || '?'} ${segment.route.status_code ?? ''}`.trim());
  else if (segment.join_diagnostic) parts.push(`no server span (${segment.join_diagnostic})`);
  if (segment.handler_spans.length) parts.push(`server ${segment.handler_spans.map(stop => stop.name || '?').join(',')}`);
  if (segment.db_ops.length) parts.push(`db ${collapseDbOps(segment.db_ops).join(', ')}`);
  if (segment.hops_text) parts.push(segment.hops_text);
  const tail = [outcomeText(label)];
  // The request's terminal handler when middleware, a param callback or an error middleware ended it.
  if (segment.stopped_text) tail.push(segment.stopped_text);
  const statusText = statusClause(segment, segment.http_status ?? segment.server_status ?? null);
  if (statusText) tail.push(statusText);
  const sentLater = issueDeferralText(segment.deferred);
  if (sentLater) tail.push(sentLater);
  if (segment.deferred?.after_response_ms != null) tail.push(`server work continued ${segment.deferred.after_response_ms} ms after the response${segment.deferred.spans.length > 1 ? ` (${segment.deferred.spans.length} spans, last ${segment.deferred.last_after_response_ms} ms)` : ''}`);
  // Body rows (absent when none was recorded): the request's own fields and ids, then the response's status-bearing fields and ids.
  tail.push(...bodyTail(segment));
  return `${parts.join(' → ')} [${tail.join('; ')}]`;
}

/** `sent …; request ids …; answered …; response ids …` for a request with body rows (segments, unlinked entries, page_requests). */
function bodyTail(entry) {
  const out = [];
  const sent = sentText(entry); if (sent) out.push(sent);
  if (entry.body && Object.keys(entry.body.ids || {}).length) out.push(`request ids ${renderIds(entry.body.ids)}`);
  const answered = answeredText(entry); if (answered) out.push(answered);
  if (entry.response_body && Object.keys(entry.response_body.ids || {}).length) out.push(`response ids ${renderIds(entry.response_body.ids)}${entry.response_body.truncated ? ' (truncated body)' : ''}`);
  return out;
}

const MODIFIERS = [['ctrl', 'ctrlKey', 'Ctrl'], ['alt', 'altKey', 'Alt'], ['shift', 'shiftKey', 'Shift'], ['meta', 'metaKey', 'Meta']];
/** `<tag role=… aria-label=…>` from the recorded target attributes only. */
export function describeTarget(target) {
  if (!target) return null;
  const attributes = target.attributes || {};
  const shown = ['role', 'aria-label', 'id', 'name', 'type', 'data-testid'].filter(key => attributes[key] != null).map(key => `${key}=${JSON.stringify(String(attributes[key]))}`);
  return `<${target.tag || '?'}${shown.length ? ` ${shown.join(' ')}` : ''}>`;
}

/** Key and modifiers of a keydown/keyup/keypress dispatch, as recorded (the runtime folds printable text keys to "Printable"; a key pressed with Ctrl, Alt or Meta is recorded as is). */
export function keyboardDetail(dispatch) {
  if (!dispatch || !/^key(?:down|up|press)$/u.test(String(dispatch.event || ''))) return null;
  const recorded = dispatch.key && typeof dispatch.key === 'object' ? dispatch.key : (typeof dispatch.key === 'string' ? { key: dispatch.key } : null);
  const modifiers = recorded ? MODIFIERS.filter(([short, long]) => recorded[short] === true || recorded[long] === true).map(([, , label]) => label) : [];
  const key = recorded?.key ?? null;
  const target = describeTarget(dispatch.target);
  const combo = key ? [...modifiers, key].join('+') : 'key not recorded';
  return { key, code: recorded?.code ?? null, modifiers, repeat: recorded?.repeat === true, target, text: `${combo} in ${target || 'unknown target'}` };
}

/**
 * What a non-keyboard dispatch carried (D-G1-21 rows): pointer type and
 * buttons, a coalesced range, inputType, file count/types, clipboard types,
 * a toggle's new state, the element that lost or gained focus. Null for rows
 * that carry none of it (every row recorded before D-G1-21).
 */
export function dispatchDetail(dispatch, range = null, pressedOn = null) {
  if (!dispatch || typeof dispatch !== 'object') return null;
  const parts = [];
  const pointer = dispatch.pointer || dispatch.mouse || null;
  if (dispatch.pointer) parts.push(`${dispatch.pointer.pointerType || 'pointer'} pointer ${dispatch.pointer.pointerId ?? '?'}, button ${dispatch.pointer.button ?? '?'}, buttons ${dispatch.pointer.buttons ?? '?'}`);
  else if (dispatch.mouse) parts.push(`mouse button ${dispatch.mouse.button ?? '?'}, buttons ${dispatch.mouse.buttons ?? '?'}`);
  if (pointer) { const held = MODIFIERS.filter(([, long]) => pointer[long] === true).map(([, , label]) => label); if (held.length) parts.push(held.join('+')); }
  if (dispatch.touch) parts.push(`${dispatch.touch.touches} touch(es)`);
  if (dispatch.input?.inputType) parts.push(`inputType ${dispatch.input.inputType}`);
  if (dispatch.files) parts.push(`${dispatch.files.count} file(s)${dispatch.files.types?.length ? ` (${dispatch.files.types.map(type => type || 'unknown type').join(', ')})` : ''}`);
  if (dispatch.clipboard) parts.push(`clipboard types [${(dispatch.clipboard.types || []).join(', ')}]`);
  if (dispatch.toggle) parts.push(`${dispatch.toggle.oldState ?? '?'} → ${dispatch.toggle.newState ?? '?'}`);
  if (dispatch.drag) parts.push(`drag types [${(dispatch.drag.types || []).join(', ')}]`);
  if (dispatch.related_target) parts.push(`related ${describeTarget(dispatch.related_target)}`);
  if (dispatch.coalesced) parts.push(range ? `${range.count} events coalesced${range.bounds ? ` over x ${range.bounds.min_x}–${range.bounds.max_x}, y ${range.bounds.min_y}–${range.bounds.max_y}` : ''}${range.wheel ? `, wheel Δy ${range.wheel.delta_y}` : ''}` : 'coalesced range (not closed in these rows)');
  if (dispatch.coalesced && range?.segment) parts.push(`${range.segment} segment across ${range.controls} control(s)${range.first_control ? ` from ${describeTarget(range.first_control)}` : ''}${range.last_control ? ` to ${describeTarget(range.last_control)}` : ''}`);
  if (dispatch.phase && dispatch.phase !== 'discrete') parts.push(`phase ${dispatch.phase}`);
  if (pressedOn) parts.push(`gesture pressed on ${describeTarget(pressedOn.target)} (${pressedOn.event} ${pressedOn.action_id})`);
  if (!parts.length) return null;
  const target = describeTarget(dispatch.target);
  return { phase: dispatch.phase ?? null, gesture_id: dispatch.gesture_id ?? null, interface: dispatch.interface ?? null, ...(range ? { range } : {}), text: `${parts.join('; ')} on ${target || 'unknown target'}` };
}

/**
 * One line per action: dispatch (with key detail), the named entry handler and
 * its spine, then every request as its own segment in dispatch order, then
 * the credited chain's "reached … / stopped at … / because …".
 */
export function renderChainLine(chain) {
  const parts = [];
  const dispatch = chain.stops.find(stop => stop.stop === 'dispatch');
  parts.push(`${dispatch?.event || 'action'} ${dispatch?.action_id || ''}${chain.keyboard ? ` (${chain.keyboard.text})` : (chain.dispatch_detail ? ` (${chain.dispatch_detail.text})` : '')}`.trim());
  const entry = chain.stops.find(stop => stop.stop === 'entry_handler');
  if (entry?.resolution === 'unmapped') parts.push(`${entry.status}: ${entry.reason}`);
  else if (entry) {
    const spine = (chain.spine || []).filter(hop => hop.function_id !== entry.function_id).map(hop => hop.label);
    parts.push(`handler ${entry.label || where(entry.source) || entry.function_id}${entry.binding ? ` [bound: ${bindingPhrase(entry.binding)}]` : ''}`, ...spine);
  }
  const segments = chain.segments || [];
  if (segments.length) {
    const failed = segments.filter(segment => segment.outcome === 'failed').length;
    const third = segments.filter(segment => segment.third_party).length;
    const counts = [failed ? `${failed} failed` : null, third ? `${third} third-party` : null].filter(Boolean);
    const head = `${segments.length} request${segments.length === 1 ? '' : 's'}${counts.length ? ` (${counts.join(', ')})` : ''}`;
    const inline = segments.slice(0, SEGMENTS_INLINE).map(segment => `(${segment.index}) ${segment.summary}`);
    if (segments.length > SEGMENTS_INLINE) inline.push(`… ${segments.length - SEGMENTS_INLINE} more request${segments.length - SEGMENTS_INLINE === 1 ? '' : 's'} (see segments)`);
    parts.push(`${head}: ${inline.join('; ')}`);
  } else {
    const validation = chain.stops.find(stop => stop.stop === 'validation');
    if (validation) parts.push('no request; the same form mutated');
  }
  const workers = [...new Set(chain.stops.filter(stop => stop.stop === 'worker').map(stop => stop.script_url || '?'))];
  if (workers.length) parts.push(`post to worker ${workers.join(', ')}`);
  const socketSends = chain.stops.filter(stop => stop.stop === 'websocket_send');
  if (socketSends.length) parts.push(`send on websocket ${[...new Set(socketSends.map(stop => stop.url || '?'))].join(', ')}${socketSends.length > 1 ? ` ×${socketSends.length}` : ''}`);
  const also = (chain.frontier.additional_stops || []).map(stop => `; also stopped at ${stop.stopped_at || 'none (terminal effect observed)'} because ${stop.because}`).join('');
  const openedWithRequest = chain.outcome?.status === 'opened'
    ? (chain.related || []).find(entry => entry.relation === 'opened' && entry.requests.length) : null;
  const openedHeadline = openedWithRequest
    ? `opened ${describeTarget(openedWithRequest.target)}; its ${openedWithRequest.event} issued ${openedWithRequest.requests.map(request => `${request.method} ${request.url}`).join(', ')}` : null;
  const outcome = openedHeadline ? `outcome ${openedHeadline}` : chain.outcome?.status ? `outcome ${outcomeText(chain.outcome)}` : null;
  const { reached, stopped_at: stoppedAt, because } = chain.frontier;
  // Episode-focus rule: a member names its carrier; a caused focus its cause.
  const relatedText = (chain.related || []).filter(entry => entry.requests.length)
    .map(entry => `${entry.relation === 'opened' ? 'this action opened' : 'this action caused'} ${entry.event} ${entry.action_id} → ${entry.requests.map(request => `${request.method} ${request.url}`).join(', ')}`);
  const pointer = [chain.pointer, chain.caused?.sentence, chain.opened?.sentence, ...relatedText].filter(Boolean).map(text => `; ${text}`).join('');
  return `${parts.join(' → ')}${outcome ? ` [${outcome}]` : ''}: reached ${reached} / stopped at ${stoppedAt || 'none (terminal effect observed)'}${openedHeadline ? '' : ` / because ${because}`}${also}${pointer}`;
}

function compactAction(chain) {
  const find = kind => chain.stops.find(stop => stop.stop === kind) || null;
  const dispatch = find('dispatch');
  return { action_id: dispatch.action_id, session: dispatch.session, sequence: dispatch.sequence, event: dispatch.event, keyboard: chain.keyboard,
    episode_id: chain.episode.episode_id, episode_carrier_action_id: chain.carrier_action_id ?? chain.record.action_id, ...pointerFields(chain),
    entry_handler: find('entry_handler'), spine: chain.spine, request: find('request'), other_requests: chain.requests.filter(row => row.request_occurrence_id !== find('request')?.request_occurrence_id),
    other_requests_total: Math.max(0, chain.requests.length - (find('request') ? 1 : 0)),
    route: find('route'), handler_spans: chain.stops.filter(stop => stop.stop === 'handler'), db_ops: chain.stops.filter(stop => stop.stop === 'db'),
    segments: chain.segments, outcome: chain.outcome, reached: chain.frontier.reached, stopped_at: chain.frontier.stopped_at, because: chain.frontier.because,
    ...(chain.unlinked ? { unlinked_counts: unlinkedCounts(chain.unlinked) } : {}), coverage: listedCoverage(chain.coverage),
    ...workerFields(chain), ...escapeFields(chain), summary: renderChainLine(chain) };
}

// ---------------------------------------------------------------------------
// Tools.

function envelope(store, tool, status, payload, summary) {
  return { status, tool, store: store ? store.stats() : null, ...payload, summary };
}

function lookupAction(store, actionId, tool, label = 'action_id') {
  const rows = store.actionsById.get(actionId) || [];
  if (!rows.length) return envelope(store, tool, 'not_found', { [label]: actionId }, `not_found: no dom.action row has ${label} ${actionId}`);
  const sessions = [...new Set(rows.map(row => row.capture_page_id || row.session_id || 'default'))];
  if (sessions.length > 1) return envelope(store, tool, 'ambiguous', { [label]: actionId, sessions }, `ambiguous: ${actionId} appears in ${sessions.length} page sessions; not picking one`);
  return null;
}

/** Name fields of a function for JSON listings (the manifest's build-time name; see store.functionInfo). */
function handlerName(store, functionId) {
  const info = store.functionInfo?.(functionId) || null;
  return { name: info?.name ?? null, display_name: info?.display_name ?? null, name_status: info?.name_status ?? null, label: info?.label ?? null };
}

/**
 * Named listeners of an entry-handler abstention: the global listeners that ran, and the handlers bound to the
 * element, each with its build-time name and file:line.
 */
function namedAbstention(store, record) {
  const abstention = record?.handler_abstention;
  if (!abstention) return null;
  const named = ids => (Array.isArray(ids) ? ids : []).map(id => ({ function_id: id, ...handlerName(store, id) }));
  return { ...(abstention.global_listeners ? { global_listeners: named(abstention.global_listeners) } : {}),
    ...(abstention.handlers_ran ? { handlers_ran: named(abstention.handlers_ran) } : {}),
    bound_handlers: named(abstention.bound_handlers) };
}

function describeEntry(store, entry) {
  const placement = entry.placements[0] || null;
  return {
    element_key: entry.key, key_kind: entry.key_kind,
    component: placement?.component ?? null,
    source: placement ? { file: placement.file, start: placement.start, end: placement.end, line: placement.line ?? null,
      line_status: placement.line != null ? 'ok' : (entry.key_kind === 'entry_handler' ? store.sourceFor(placement.placement_id)?.line_status ?? null : 'not_recorded') } : null,
    placement_id: placement?.placement_id ?? null,
    // D-G1-22: what ran on this element's dispatches, observed (first), then the declared list.
    ...(entry.bindings_observed ? { observed_bindings: (entry.observed_bindings || []).map(row => describeBinding(store, row)), handlers_basis: entry.key_kind === 'entry_handler' ? 'credited' : 'declared' } : {}),
    handlers: entry.handlers.map(handler => ({ event: handler.event, function_id: handler.function_id, ...handlerName(store, handler.function_id), source: handler.source ?? store.sourceFor(handler.function_id), ...(handler.rooted != null ? { rooted: handler.rooted } : {}) })),
    build: entry.builds.length === 1 ? entry.builds[0] : (entry.builds.length ? entry.builds : null),
    sessions: entry.sessions, actions_observed: entry.actions.length,
    ...(entry.key_kind === 'element_stamp' ? { stamp_key_kind: entry.stamp_key_kind, instances: stampKeyTrust(entry).instances ?? null } : {}),
  };
}

const STAMP_ADVICE = 'This key does not name one element. Annotate a distinguishing child of the element (text or a control unique to the item), '
  + 'or call element_history with this key and pick the action by its time or its element.label: each action there carries the binding that held when it fired.';

/** The instances a non-exact stamp key may name, each with its latest observation and latest action. */
function stampCandidates(store, entry) {
  const index = store.elementIndex;
  const latest = key => {
    const other = index.entries.get(key);
    const observation = other?.observations?.filter(row => entry.sessions.includes(row.session)).at(-1) || other?.observations?.at(-1) || null;
    const action = other?.actions.filter(row => entry.sessions.includes(row.session)).at(-1) || null;
    return { element_key: key, stamp_key_kind: other?.stamp_key_kind ?? null,
      latest: observation ? { session: observation.session, stamp_sequence: observation.stamp_sequence, commit: observation.commit, instances: observation.instances,
        react_key_path: observation.react_key_path, react_key_site: observation.react_key_site, binding_placement: observation.binding_placement, handlers: observation.handlers } : null,
      latest_action: action ? { action_id: action.action_id, session: action.session, event: action.event, label: action.element?.label ?? null } : null };
  };
  if (entry.react_key_sites?.length > 1) {
    // One key, several keyed parents: one candidate per parent site.
    return entry.react_key_sites.map(site => {
      const observation = entry.observations.filter(row => row.react_key_site === site).at(-1);
      return { element_key: entry.key, react_key_site: site, latest: { session: observation.session, stamp_sequence: observation.stamp_sequence, commit: observation.commit,
        react_key_path: observation.react_key_path, binding_placement: observation.binding_placement, handlers: observation.handlers } };
    });
  }
  // Ordinal siblings: `<placement>#n<i>` (or, in older rows, `<token>~<i>` of one repeated React key).
  const familyOf = key => /^(.*#n)\d+$/u.exec(key)?.[1] ?? /^(.*#[kh].*?)(?:~\d+)?$/u.exec(key)?.[1] ?? null;
  const family = familyOf(entry.key);
  const ordinal = key => { const match = /(?:#n|~)(\d+)$/u.exec(key); return match ? Number(match[1]) : 1; };
  const instances = entry.instances_max ?? entry.instances_lower_bound ?? null;
  const keys = (index.byPlacement.get(entry.placements[0]?.placement_id) || [])
    .filter(key => family !== null && familyOf(key) === family)
    .filter(key => index.entries.get(key)?.sessions.some(session => entry.sessions.includes(session)))
    .filter(key => instances === null || ordinal(key) <= instances)
    .sort((left, right) => ordinal(left) - ordinal(right));
  return keys.map(latest);
}

/**
 * D-G1-22: "observed: <handler> as onChange on click (React) ×2; …" for a key
 * whose actions were recorded with observed bindings; declared handlers that
 * never ran on them are named as such. Empty for older stores.
 */
function observedText(store, described) {
  if (!described.observed_bindings) return '';
  const user = described.observed_bindings.filter(row => row.kind === 'binding'), app = described.observed_bindings.filter(row => row.kind === 'invocation');
  const ran = new Set(described.observed_bindings.map(row => row.function_id));
  const never = described.handlers_basis === 'declared' ? [...new Set(described.handlers.filter(handler => !ran.has(handler.function_id)).map(handler => handler.function_id))] : [];
  const parts = [user.length ? `observed: ${user.map(row => `${row.label} as ${bindingPhrase(row)} ×${row.count}`).join('; ')}` : 'observed: no handler of this element ran on its recorded dispatches',
    app.length ? `invoked by app code (not user events): ${app.map(row => `${row.label} as ${row.prop_name || 'listener'} on ${row.native_event_type} ×${row.count}`).join('; ')}` : '',
    never.length ? `declared, never observed running: ${never.map(id => store.functionInfo?.(id)?.label || id).join('; ')}` : ''];
  return parts.filter(Boolean).join('. ');
}

function entrySummary(store, entry, confidence) {
  const described = describeEntry(store, entry);
  const location = where(described.source) || (described.handlers[0] && where(described.handlers[0].source)) || 'unknown source';
  const last = entry.actions.at(-1);
  const tail = last ? renderChainLine(chainStops(store, last.action_id)) : 'no actions observed on this key';
  const observed = observedText(store, described);
  return `${entry.key_kind === 'element_stamp' ? 'element' : 'handler placement'} ${described.component || ''} at ${location} (${confidence}; ${entry.actions.length} actions).${observed ? ` ${observed}.` : ''} Last: ${tail}`.replace(/\s+/gu, ' ');
}

export function resolveElement(store, args) {
  const tool = 'resolve_element';
  const hints = ['selector', 'element_path', 'role', 'name', 'nearby_text'].filter(key => args[key] !== undefined);
  if (args.element_key === undefined && !hints.length) {
    return envelope(store, tool, 'invalid_input', { errors: ['at least one of element_key, selector, element_path, role, name, nearby_text is required'] }, 'invalid_input: nothing to resolve');
  }
  const ignored = [];
  let urlPages = null;
  if (args.url !== undefined) {
    let parsed = null; try { parsed = new URL(args.url); } catch { /* reported below */ }
    if (!parsed) ignored.push({ input: 'url', reason: 'not a valid absolute URL' });
    else {
      // Page URL is only known from element.stamp rows ({..., url}). Compare
      // origin + pathname literally; query and hash are ignored.
      const pageKey = value => { try { const url = new URL(value); return `${url.origin}${url.pathname}`; } catch { return null; } };
      const wanted = pageKey(args.url);
      const pages = new Set(store.records.filter(row => row?.kind === 'element.stamp' && typeof row.url === 'string' && pageKey(row.url) === wanted)
        .map(row => row.capture_page_id || row.session_id || 'default'));
      if (!store.records.some(row => row?.kind === 'element.stamp' && typeof row.url === 'string')) ignored.push({ input: 'url', reason: 'this store records no page URL (no element.stamp rows with url); URL cannot narrow the lookup' });
      else if (!pages.size) ignored.push({ input: 'url', reason: 'no page session in this store was stamped at this URL; lookup not narrowed' });
      else urlPages = pages;
    }
  }
  let keyStatus = null;
  if (args.element_key !== undefined) {
    const entry = store.elementIndex.entries.get(args.element_key);
    if (entry) {
      if (entry.key_kind === 'element_stamp') {
        if (args.build !== undefined && entry.builds.length && !entry.builds.includes(args.build)) {
          return envelope(store, tool, 'stale_build', { ...describeEntry(store, entry), requested_build: args.build, confidence: 'exact', ignored },
            `stale_build: key ${entry.key} exists but was stamped by build(s) ${entry.builds.join(', ')}, not ${args.build}; rebuild or recapture before trusting source lines`);
        }
        if (entry.conflict) {
          return envelope(store, tool, 'ambiguous', { element_key: entry.key, key_kind: entry.key_kind, confidence: 'ambiguous', candidates: entry.placements, ignored },
            `ambiguous: key ${entry.key} maps to ${entry.placements.length} different placements in this store; not picking one`);
        }
        // `exact` means exactly one element: never for an ordinal key whose
        // placement had more than one instance at a stamp or an action.
        const trust = stampKeyTrust(entry);
        if (!trust.exact) {
          const candidates = stampCandidates(store, entry);
          return envelope(store, tool, 'ambiguous', { ...describeEntry(store, entry), confidence: 'ambiguous', reason: trust.reason, instances: trust.instances,
            candidates: candidates.slice(0, 50), candidates_total: candidates.length, ...(trust.labels ? { labels: trust.labels } : {}), advice: STAMP_ADVICE, ignored },
            `ambiguous: ${trust.reason}; placement ${where(describeEntry(store, entry).source) || entry.key}; ${candidates.length} candidate(s). ${STAMP_ADVICE}`);
        }
        const described = describeEntry(store, entry);
        return envelope(store, tool, 'ok', { ...described, confidence: 'exact', ignored }, entrySummary(store, entry, 'exact'));
      }
      const described = describeEntry(store, entry);
      return envelope(store, tool, 'ok', { ...described, confidence: 'handler_placement', ignored }, entrySummary(store, entry, 'handler_placement: identifies a handler placement, not a stamped element'));
    }
    keyStatus = args.build !== undefined && store.elementIndex.builds.length && !store.elementIndex.builds.includes(args.build) ? 'stale_build' : 'not_found';
    if (!hints.length) {
      return envelope(store, tool, keyStatus, { element_key: args.element_key, requested_build: args.build ?? null, store_builds: store.elementIndex.builds, ignored },
        keyStatus === 'stale_build' ? `stale_build: key from build ${args.build}; this store only has build(s) ${store.elementIndex.builds.join(', ')}`
          : `not_found: no element.stamp row, dom.action target, or handler placement has key ${args.element_key}`);
    }
  }
  const keyOf = store.elementIndex.has_stamps ? action => keyForAction(store.elementIndex, action) : null;
  const stamps = keyOf ? stampEvidence(store, urlPages) : null;
  const { candidates, ignored: hintIgnored } = rankTargetCandidates(urlPages ? store.actionRows.filter(row => urlPages.has(row.capture_page_id || row.session_id || 'default')) : store.actionRows, args, { keyOf, stamps });
  ignored.push(...hintIgnored);
  const describeCandidate = candidate => {
    const keys = [...new Set([...candidate.actions.map(action => keyForAction(store.elementIndex, action)), ...(candidate.stamp_only ? [candidate.element_key] : [])].filter(Boolean))];
    return { target: candidate.target, score: candidate.score, matched_on: candidate.matched_on, mismatched: candidate.mismatched,
      actions_observed: candidate.actions.length, sessions: [...new Set(candidate.actions.map(action => action.capture_page_id || 'default'))],
      recent_action_ids: candidate.actions.slice(-5).reverse().map(action => action.action_id),
      ...(candidate.stamp_only ? { stamp_only: true } : {}), ...(candidate.label_out_of_date ? { label_out_of_date: true, out_of_date_keys: candidate.out_of_date_keys } : {}),
      keys: keys.map(key => { const entry = store.elementIndex.entries.get(key); const described = describeEntry(store, entry);
        return { element_key: key, key_kind: entry.key_kind, component: described.component, source: described.source, handlers: described.handlers.map(handler => ({ event: handler.event, function_id: handler.function_id, name: handler.name, display_name: handler.display_name, name_status: handler.name_status, source: handler.source })) }; }) };
  };
  const top = candidates.slice(0, RESOLVE_SHOWN).map(describeCandidate);
  // `best` only when exactly one candidate matches both the supplied role and
  // the supplied name (explicitly or through a stamp's content signature).
  // Still `ambiguous`: raw evidence never yields `exact` (G4 §2.2).
  let best = null;
  if (args.name !== undefined) {
    const both = candidates.filter(candidate => candidate.name_matched && (args.role === undefined || candidate.role_matched));
    // Several match role and name: the nearby text (the element's own label or an enclosing element's, e.g. its row) may single one out.
    const near = both.length > 1 && args.nearby_text !== undefined ? both.filter(candidate => candidate.nearby_matched) : [];
    const only = both.length === 1 ? both[0] : near.length === 1 ? near[0] : null;
    if (only) {
      const described = describeCandidate(only);
      const matchedBy = `${args.role !== undefined ? 'role and name' : 'name'}${both.length > 1 ? ' whose own or enclosing label matches nearby_text' : ''}`;
      best = { element_key: described.keys.length === 1 ? described.keys[0].element_key : null, keys: described.keys.map(key => key.element_key), target: described.target, score: described.score,
        matched_on: described.matched_on, basis: `the only candidate matching ${matchedBy}; not exact (raw evidence); confirm with the live data-tracer-el` };
    }
  }
  // Disclosures: the supplied text matched only an earlier label of a key (index-like key, content changed since);
  // nearby_text singled out nothing (an enclosing element is known only when it is stamped, i.e. carries a handler).
  const outOfDate = [...new Set(candidates.flatMap(candidate => candidate.out_of_date_keys || []))];
  const outOfDateText = outOfDate.length ? ` Label out of date for ${outOfDate.slice(0, 3).join(', ')}${outOfDate.length > 3 ? ` and ${outOfDate.length - 3} more` : ''} (content changed since): the text matches only an earlier label of that key, never its current one, so it is not a match.` : '';
  const nearbyUnused = args.nearby_text !== undefined && !candidates.some(candidate => candidate.nearby_matched);
  if (nearbyUnused) ignored.push({ input: 'nearby_text', reason: 'nearby_text ignored: it matched no candidate\'s own current label and no stamped enclosing element\'s label (an enclosing element is known only when it is stamped, i.e. when it carries a handler)' });
  const nearbyText = nearbyUnused ? ' nearby_text ignored: no candidate\'s own label and no stamped ancestor\'s label matches it (enclosing elements are known only when they carry a handler).' : '';
  const limits = 'dom.action targets record the innermost event target and a fixed attribute subset; element text, classes and ancestry are not recorded (stamp rows keep only a hash of the label or text), so selector/text lookup is weak. A data-tracer-el key is exact.';
  const payload = { element_key: args.element_key ?? null, element_key_status: keyStatus, confidence: 'ambiguous', candidates: top, candidates_total: candidates.length, best, ignored, limits,
    ...(outOfDate.length ? { labels_out_of_date: outOfDate } : {}) };
  if (!top.length) return envelope(store, tool, keyStatus === 'stale_build' ? 'stale_build' : 'not_found', { ...payload, candidates: [] }, `not_found: no observed target matches the annotation evidence${nearbyText ? `.${nearbyText}` : ''}`);
  const bestText = best ? ` Best (${best.basis}): ${best.element_key || best.keys.join(', ') || best.target.tag} with score ${best.score}.` : ' No unique best by role and name.';
  return envelope(store, tool, 'ambiguous', payload,
    `ambiguous: ${candidates.length} observed target(s) match; top ${top[0].target.tag}${top[0].keys.length === 1 ? ` ${top[0].keys[0].element_key}` : ''}${top[0].matched_on.length ? ` (${top[0].matched_on.join(', ')})` : ''} with ${top[0].actions_observed} actions, score ${top[0].score}.${bestText}${outOfDateText}${nearbyText} Not a pick: read data-tracer-el from the live element for an exact key.`);
}

const RESOLVE_SHOWN = 5;
const stampEvidenceCache = new WeakMap();
/**
 * Stamp rows per key: host tags and every content signature the key was
 * stamped with (on the given pages, else all), plus `ancestors`: the stamped
 * keys that enclose it, each with its own tags and signatures. A key encloses
 * another on a page when both stamp rows name the same file, its placement's
 * source span strictly contains the other's (JSX nesting), and they render the
 * same instance: equal React key paths, or a key path that extends the
 * encloser's, or two ordinal keys of one instance each. Identifiers and
 * source offsets only; lookup ranking only.
 */
function stampEvidence(store, pages = null) {
  const build = () => {
    const map = new Map();
    const placements = new Map();
    const latestRow = new Map();
    for (const row of store.records) {
      if (row?.kind !== 'element.stamp' || typeof row.element_key !== 'string') continue;
      if (pages && !pages.has(pageOf(row))) continue;
      const entry = map.get(row.element_key) || { host_tags: new Set(), content_sigs: new Set(), latest_sigs: new Set(), ancestors: [] };
      if (row.host_tag) entry.host_tags.add(String(row.host_tag).toLowerCase());
      if (typeof row.content_sig === 'string') entry.content_sigs.add(row.content_sig);
      map.set(row.element_key, entry);
      // The key's latest stamp row on each page (stamp_sequence, else row order) is what it shows now.
      const slot = `${row.element_key}\u0000${pageOf(row)}`; const prior = latestRow.get(slot);
      if (!prior || !(Number(prior.stamp_sequence) > Number(row.stamp_sequence))) latestRow.set(slot, row);
      if (typeof row.file === 'string' && Number.isInteger(row.start) && Number.isInteger(row.end)) {
        const page = pageOf(row);
        const list = placements.get(`${page}\u0000${row.file}`) || new Map();
        const seen = list.get(row.element_key) || { key: row.element_key, start: row.start, end: row.end, path: Array.isArray(row.react_key_path) ? row.react_key_path.map(String) : typeof row.react_key_path === 'string' ? row.react_key_path.split('/') : null,
          ordinal_single: row.key_kind === 'ordinal' && row.instances === 1 };
        if (row.key_kind === 'ordinal' && row.instances !== 1) seen.ordinal_single = false;
        list.set(row.element_key, seen); placements.set(`${page}\u0000${row.file}`, list);
      }
    }
    // The inner key path equals the outer one or extends it (keyed ancestors, outermost first).
    for (const row of latestRow.values()) if (typeof row.content_sig === 'string') map.get(row.element_key).latest_sigs.add(row.content_sig);
    const sameInstance = (inner, outer) => (inner.path !== null && outer.path !== null ? outer.path.length <= inner.path.length && outer.path.every((part, index) => inner.path[index] === part)
      : inner.ordinal_single && outer.ordinal_single);
    for (const list of placements.values()) {
      const keys = [...list.values()];
      for (const inner of keys) for (const outer of keys) {
        if (inner === outer || outer.start > inner.start || outer.end < inner.end || (outer.start === inner.start && outer.end === inner.end) || !sameInstance(inner, outer)) continue;
        const entry = map.get(inner.key); const other = map.get(outer.key);
        if (entry && other && !entry.ancestors.some(value => value.element_key === outer.key)) entry.ancestors.push({ element_key: outer.key, host_tags: other.host_tags, content_sigs: other.content_sigs, latest_sigs: other.latest_sigs });
      }
    }
    return map;
  };
  if (pages) return build();
  if (!stampEvidenceCache.has(store)) stampEvidenceCache.set(store, build());
  return stampEvidenceCache.get(store);
}

export function elementHistory(store, args) {
  const tool = 'element_history';
  const entry = store.elementIndex.entries.get(args.element_key);
  if (!entry) return envelope(store, tool, 'not_found', { element_key: args.element_key, actions: [] }, `not_found: no key ${args.element_key} in this store`);
  if (args.session !== undefined && !store.sessions.has(args.session)) {
    return envelope(store, tool, 'not_found', { element_key: entry.key, session: args.session, sessions: [...store.sessions.keys()], actions: [] }, `not_found: no session ${args.session} in this store`);
  }
  // `n` counts attempts (episodes on this element), not raw actions: a few
  // keystrokes must not push an earlier attempt out. Every action of the n
  // newest attempts is returned.
  const n = args.n ?? 10;
  const episodeIdOf = actionId => { const id = store.episodes?.byAction?.get(actionId); return id && store.episodes.episodes.has(id) ? id : `episode:standalone:${actionId}`; };
  const inScope = entry.actions.filter(action => args.session === undefined || action.session === args.session);
  // Gesture context no episode holds (D-G1-21) is not an attempt: counted, listed only on request.
  const newestFirst = (args.include_context === true || typeof store.contextOnly !== 'function' ? inScope : inScope.filter(action => !store.contextOnly(action.action_id))).slice().reverse();
  const contextOmitted = inScope.length - newestFirst.length;
  // A caused focus (gesture: false) is not a user attempt: it never counts
  // toward n and never forms an attempt. It is listed among the actions (with
  // its pointer) when the episode of its causing action is a kept attempt,
  // when it is no older than the oldest kept user action, or, on a key with
  // no user action in scope, always: rows that exist are never hidden.
  const dispatchOf = actionId => store.actionsById.get(actionId)?.[0] || null;
  const isCaused = actionId => dispatchOf(actionId)?.gesture === false;
  const causerEpisodeOf = actionId => { const by = dispatchOf(actionId)?.caused_by_action_id; return by ? (store.episodes?.byAction?.get(by) || null) : null; };
  const keptEpisodes = new Set();
  const gestures = newestFirst.filter(action => {
    if (isCaused(action.action_id)) return false;
    const episodeId = episodeIdOf(action.action_id);
    if (keptEpisodes.has(episodeId)) return true;
    if (keptEpisodes.size >= n) return false;
    keptEpisodes.add(episodeId); return true;
  });
  const keptIds = new Set(gestures.map(action => action.action_id));
  const oldestKept = gestures.length ? newestFirst.indexOf(gestures.at(-1)) : Infinity;
  const selected = newestFirst.filter((action, index) => keptIds.has(action.action_id)
    || (isCaused(action.action_id) && (index <= oldestKept || keptEpisodes.has(causerEpisodeOf(action.action_id)))));
  // Per action: the key's state when it fired and the stamp observation
  // (binding) that held then, joined by stamp_sequence.
  // A member's work is its own frames only (its scope); the attempt's is the episode view's.
  // element_history shows only the id-shaped body fields (action_chain has the summaries and, on request, the bodies).
  const idsOnly = body => (body ? { direction: body.direction, captured: body.captured, ...(body.captured ? {} : { reason: body.reason }), truncated: body.truncated, ids: body.ids || {} } : null);
  const idsOnlySegments = segments => (segments || []).map(segment => ({ ...segment, body: idsOnly(segment.body), response_body: idsOnly(segment.response_body) }));
  const actions = selected.map(action => {
    const chain = chainStops(store, action.action_id);
    const compact = compactAction(chain);
    return { ...compact, segments: idsOnlySegments(compact.segments), work_summary: renderWork(actionWork(store, chain.record, chain.scope || chain.episode, chain.segments)) || null,
      ...(entry.key_kind === 'element_stamp' ? { element: action.element ?? null, binding: action.binding ?? null } : {}) };
  });
  // Attempts group by carrier as before: each attempt shows its episode's
  // chain (as seen from its newest listed action), while each listed member
  // action above shows only its own evidence and a pointer.
  const episodeViews = new Map(selected.map(action => {
    const chain = chainStops(store, action.action_id, { episodeView: true });
    const compact = compactAction(chain);
    return [action.action_id, { ...compact, segments: idsOnlySegments(compact.segments), work_summary: renderWork(actionWork(store, chain.record, chain.scope || chain.episode, chain.segments)) || null }];
  }));
  const described = describeEntry(store, entry);
  // Actions in scope: every action on the key (in the requested session).
  const trust = entry.key_kind === 'element_stamp' ? stampKeyTrust(entry, entry.actions.filter(action => args.session === undefined || action.session === args.session)) : null;
  // G5 (additive): one user attempt dispatches several actions on the same
  // element (focusin, click, submit) that share one episode, so the listed
  // actions are also grouped by episode, newest first. Grouping is by the
  // episode id only; every field is the episode chain's, as for its actions.
  const attempts = [];
  for (const action of actions) {
    if (action.gesture === false) continue;
    let attempt = attempts.find(row => row.episode_id === action.episode_id);
    if (!attempt) {
      const view = episodeViews.get(action.action_id) || action;
      attempt = { episode_id: view.episode_id, carrier_action_id: view.episode_carrier_action_id, action_ids: [], events: [],
        entry_handler: view.entry_handler, spine: view.spine, request: view.request, route: view.route, segments: view.segments, outcome: view.outcome,
        reached: view.reached, stopped_at: view.stopped_at, because: view.because, summary: view.summary, work_summary: view.work_summary };
      attempts.push(attempt);
    }
    attempt.action_ids.push(action.action_id); attempt.events.push(action.event);
  }
  // Caused focuses listed above sit in the attempt of their causing action, as caused events.
  for (const action of actions.filter(row => row.gesture === false)) {
    const attempt = attempts.find(row => row.episode_id === action.caused_by_episode_id);
    if (!attempt) continue;
    (attempt.caused ||= []).push({ action_id: action.action_id, event: action.event, caused_by_action_id: action.caused_by_action_id, gesture: false });
  }
  // The headline reads the newest user action's episode view, as attempts do
  // (a member's own chain would report its own `incomplete`, not the attempt).
  const newestGesture = actions.find(action => action.gesture !== false) || null;
  const causedCount = actions.filter(action => action.gesture === false).length;
  const causedNote = causedCount ? `; ${causedCount} caused focus(es) (not user gestures)` : '';
  const observed = observedText(store, described);
  const where_ = `${where(described.source) || entry.key}${observed ? ` (${observed})` : ''}`;
  const on = entry.key_kind === 'element_stamp' ? 'element' : 'handler placement';
  const summary = newestGesture
    ? `${actions.length} action(s) in ${attempts.length} attempt(s)${causedNote} on ${on} ${where_}; newest: ${(episodeViews.get(newestGesture.action_id) || newestGesture).summary}`
    : actions.length
      ? `0 attempts on ${on} ${where_}${causedNote}; newest: ${actions[0].summary}`
      : `no actions on ${entry.key}${args.session ? ` in session ${args.session}` : ''}`;
  return envelope(store, tool, 'ok', { element_key: entry.key, key_kind: entry.key_kind, placement: described, session: args.session ?? null,
    ...(trust ? { element_confidence: trust.exact ? 'exact' : 'ambiguous', ...(trust.exact ? {} : { reason: trust.reason, ...(trust.labels ? { labels: trust.labels } : {}), advice: STAMP_ADVICE }), observations: entry.observations.length } : {}),
    actions, actions_total: entry.actions.length, context_omitted: contextOmitted, summaries: actions.map(action => action.summary), attempts },
    trust && !trust.exact ? `${summary} (${trust.reason}: each action's binding is the stamp observation that held when it fired)` : summary);
}

export function actionChain(store, args) {
  const tool = 'action_chain';
  const miss = lookupAction(store, args.action_id, tool); if (miss) return miss;
  const cursor = readBodyCursor(args);
  if (cursor === false) return envelope(store, tool, 'invalid_input', { errors: ['until_timestamp and until_id must be a pair from bodies_full.next_cursor'] }, 'invalid_input: pass both fields of bodies_full.next_cursor');
  let chain = chainStops(store, args.action_id, { includeBodies: args.include_bodies === true });
  let bodiesFull = null;
  if (args.include_bodies === true) {
    const session = chain.stops[0].session;
    const segments = bodyRefs(store, chain.segments, session);
    const unlinked = bodyRefs(store, chain.unlinked?.requests || [], chain.unlinked?.window?.page || session);
    const { byRef, report } = budgetRefs([...segments, ...unlinked], cursor);
    chain = { ...chain, segments: segments.map(ref => byRef.get(ref)), ...(chain.unlinked ? { unlinked: { ...chain.unlinked, requests: unlinked.map(ref => byRef.get(ref)) } } : {}) };
    bodiesFull = { budget_bytes: report.budget_bytes, bytes: report.bytes, with_full_bodies: report.with_full_bodies, cut: report.cut,
      ...(report.truncated_to_budget ? { truncated_to_budget: report.truncated_to_budget } : {}),
      ...(report.next_cursor ? { next_cursor: report.next_cursor } : {}), ...(bodyBudgetNotice(report) ? { note: bodyBudgetNotice(report) } : {}) };
  }
  const work = actionWork(store, chain.record, chain.scope || chain.episode, chain.segments);
  const listeners = namedAbstention(store, chain.record);
  return envelope(store, tool, 'ok', { action_id: args.action_id, session: chain.stops[0].session, episode_id: chain.episode.episode_id,
    episode_carrier_action_id: chain.carrier_action_id ?? chain.record.action_id, episode_action_ids: chain.episode.action_ids, standalone: chain.standalone,
    ...pointerFields(chain), ...(chain.record.caused?.length ? { caused: chain.record.caused } : {}),
    ...(chain.episode.opened?.length ? { opened: chain.episode.opened } : {}), ...(chain.episode.gesture_action_ids?.length ? { gesture_action_ids: chain.episode.gesture_action_ids } : {}),
    keyboard: chain.keyboard, spine: chain.spine, stops: chain.stops, requests: chain.requests, segments: chain.segments, outcome: chain.outcome, reached: chain.frontier.reached, stopped_at: chain.frontier.stopped_at,
    because: chain.frontier.because, ...(listeners ? { listeners } : {}), ...workerFields(chain), ...escapeFields(chain), work, ...(chain.unlinked ? { unlinked: chain.unlinked } : {}), coverage: chain.coverage, bodies: chain.bodies, ...(bodiesFull ? { bodies_full: bodiesFull } : {}),
    ...(chain.bindings ? { bound_handlers: chain.bindings } : {}), chain: chain.record },
  [renderChainLine(chain), renderBindings(chain.bindings, chain.record.entry_handler?.unbound_request_issuers, store), renderListeners(listeners), renderWork(work), renderUnlinked(chain.unlinked, store), chain.coverage && !chain.coverage.complete ? `Coverage incomplete for page ${chain.coverage.page}: ${chain.coverage.reasons.join('; ')}` : '',
    renderUnobserved(chain.coverage), ...(bodiesFull ? [`Full bodies: ${bodiesFull.with_full_bodies} request(s), ${Math.round(bodiesFull.bytes / 1024)} KB of the ${BODY_BUDGET_BYTES / 1024} KB budget${bodiesFull.note ? `; ${bodiesFull.note}` : ''}`] : [])]
    .filter(Boolean).join('\n'));
}

/** Observed handlers of one dispatch (D-G1-22), user bindings then app-code invocations; empty when none ran. */
function renderBindings(bindings, issuers = null, store = null) {
  if (!bindings?.observed?.length && !bindings?.via_library?.length) return '';
  const user = bindings.observed.filter(row => row.kind === 'binding'), app = bindings.observed.filter(row => row.kind === 'invocation');
  const issued = (issuers || []).map(issuer => `${store?.functionInfo?.(issuer.function_id)?.label || issuer.function_id} (${issuer.request_occurrence_ids.length} request(s))`);
  return [user.length ? `Observed bound to this dispatch: ${user.map(row => `${row.label} as ${bindingPhrase(row)}`).join('; ')}` : '',
    app.length ? `Ran for a dispatch app code caused (not a user event): ${app.map(row => `${row.label} as ${row.prop_name || (row.ambiguous ? 'an ambiguous prop' : 'listener')} on ${row.native_event_type}${row.untrusted ? ' (untrusted: el.click() or dispatchEvent)' : ''} (dispatched by ${row.dispatched_by || 'unknown'})`).join('; ')}` : '',
    bindings.via_library?.length ? `Ran through library code for this dispatch (not bound to an element prop Tracer can see): ${bindings.via_library.map(row => row.label).join('; ')}` : '',
    issued.length ? `Requests issued by a frame not bound to this element (a global listener or library-called code), not by the credited handler: ${issued.join('; ')}` : '']
    .filter(Boolean).join('\n');
}

export function recentActions(store, args) {
  const tool = 'recent_actions';
  if (args.session !== undefined && !store.sessions.has(args.session)) {
    return envelope(store, tool, 'not_found', { session: args.session, sessions: [...store.sessions.keys()], actions: [] }, `not_found: no session ${args.session} in this store`);
  }
  const n = args.n ?? 20;
  const includeBodies = args.include_bodies === true;
  const cursor = readBodyCursor(args);
  if (cursor === false) return envelope(store, tool, 'invalid_input', { errors: ['until_timestamp and until_id must be a pair from bodies_full.next_cursor'] }, 'invalid_input: pass both fields of bodies_full.next_cursor');
  const inSession = store.actionRows.filter(row => args.session === undefined || (row.capture_page_id || row.session_id || 'default') === args.session);
  // Gesture context no episode holds (D-G1-21) is counted, listed only on request.
  const matchingRows = args.include_context === true || typeof store.contextOnly !== 'function' ? inSession : inSession.filter(row => !store.contextOnly(row.action_id));
  const contextOmitted = inSession.length - matchingRows.length;
  const rows = matchingRows.slice(-n).reverse();
  const unlinkedBlocks = [];
  const fullChains = rows.map(row => chainStops(store, row.action_id, { includeBodies }));
  const refsByAction = includeBodies ? fullChains.map(chain => bodyRefs(store, chain.unlinked?.requests || [], chain.unlinked?.window?.page || chain.stops[0].session)) : [];
  const budget = includeBodies ? budgetRefs(refsByAction.flat(), cursor) : null;
  // Count recorded bodies in older action windows, excluding any request also
  // visible in the selected windows. The body cursor cannot enter those windows.
  let bodiesOutside = 0;
  if (includeBodies) {
    const selected = new Set(refsByAction.flat().map(ref => ref.request_occurrence_id));
    const recorded = new Set(store.records.filter(row => row?.kind === 'network.body' && row.captured !== false
      && (row.json !== undefined || typeof row.text === 'string')).map(row => row.request_occurrence_id));
    const selectedWindows = fullChains.map(chain => chain.unlinked?.window).filter(Boolean);
    const windows = matchingRows.slice(0, -n).map(row => store.chainForAction(row.action_id).record.unlinked?.window).filter(Boolean);
    const outside = new Set();
    const inWindow = (row, window) => pageOf(row) === window.page && row.sequence > window.from_sequence
      && (window.until === 'next_dispatch' ? row.sequence < window.until_sequence : row.sequence <= window.until_sequence);
    for (const row of store.records) {
      if (row?.kind !== 'network.request' || row.action_id || row.internal === true || row.transport_internal === true
        || !recorded.has(row.request_occurrence_id) || selected.has(row.request_occurrence_id)) continue;
      if (windows.some(window => inWindow(row, window)) && !selectedWindows.some(window => inWindow(row, window))) outside.add(row.request_occurrence_id);
    }
    bodiesOutside = outside.size;
  }
  const actions = rows.map((row, index) => {
    const full = fullChains[index];
    const chain = includeBodies && full.unlinked ? { ...full, unlinked: { ...full.unlinked, requests: refsByAction[index].map(ref => budget.byRef.get(ref)) } } : full;
    // On request: the requests no action owns that were observed in this action's window, with their bodies.
    if (includeBodies && chain.unlinked?.requests_total) unlinkedBlocks.push(`Action ${row.action_id}: ${renderUnlinked({ ...chain.unlinked, server_spans: [], server_spans_total: 0 }, store)}`);
    return { action_id: row.action_id, session: row.capture_page_id || row.session_id || 'default', sequence: row.sequence ?? null, timestamp: row.timestamp ?? null,
      event: row.event ?? null, target: row.target ?? null, element_key: keyForAction(store.elementIndex, row), episode_id: chain.episode.episode_id,
      standalone: chain.standalone, ...pointerFields(chain), outcome: chain.outcome, reached: chain.frontier.reached, stopped_at: chain.frontier.stopped_at, because: chain.frontier.because,
      ...(chain.unlinked ? { unlinked_counts: unlinkedCounts(chain.unlinked) } : {}), ...(includeBodies && chain.unlinked ? { unlinked: chain.unlinked } : {}), coverage: listedCoverage(chain.coverage),
      ...workerFields(chain), ...escapeFields(chain), summary: renderChainLine(chain) };
  });
  const report = budget?.report;
  const cutActions = includeBodies ? rows.filter((row, index) => refsByAction[index].some(ref => budget.byRef.get(ref).body?.full_omitted === 'budget' || budget.byRef.get(ref).response_body?.full_omitted === 'budget')).map(row => row.action_id) : [];
  const bodiesFull = includeBodies ? { budget_bytes: BODY_BUDGET_BYTES, bytes: report.bytes, with_full_bodies: report.with_full_bodies, cut: report.cut,
    outside_selected_windows: bodiesOutside, ...(report.truncated_to_budget ? { truncated_to_budget: report.truncated_to_budget } : {}),
    ...(report.next_cursor ? { next_cursor: report.next_cursor, cut_in_actions: cutActions } : {}), ...(bodyBudgetNotice(report) ? { note: bodyBudgetNotice(report) } : {}) } : null;
  const scopeNote = includeBodies ? `Bodies outside the selected ${n} action(s)' windows are not included (${bodiesOutside} recorded beyond them); use page_requests {attribution: "none", include_bodies: true} for everything.` : '';
  const omittedNote = contextOmitted ? ` (${contextOmitted} gesture-context action(s) no episode holds are not listed; include_context: true lists them)` : '';
  return envelope(store, tool, 'ok', { session: args.session ?? null, actions, summaries: actions.map(action => action.summary), context_omitted: contextOmitted, ...(bodiesFull ? { bodies_full: bodiesFull } : {}) },
    [actions.length ? `${actions.length} most recent action(s)${omittedNote}; newest: ${actions[0].summary}` : `no actions recorded${omittedNote}`, ...unlinkedBlocks,
      ...(bodiesFull ? [`Full bodies: ${bodiesFull.with_full_bodies} unlinked request(s), ${Math.round(bodiesFull.bytes / 1024)} KB of the ${BODY_BUDGET_BYTES / 1024} KB budget${bodiesFull.note ? `; ${bodiesFull.note}` : ''}`, scopeNote] : [])].join('\n'));
}

// --- compare_chains ------------------------------------------------------

const ID_SEGMENT = /^(?:[0-9a-f]{24}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{8,}|[0-9]+)$/iu;
// Prefixed ids: `<lowercase word>_<8+ base62/-/_ chars>` (agent_…, asst_…, conv_…).
// The suffix must contain a digit or an uppercase letter so plain snake_case
// words (e.g. `effective_all_items`) stay literal.
const PREFIXED_ID_SEGMENT = /^[a-z]+_(?=[A-Za-z0-9_-]*[0-9A-Z])[A-Za-z0-9_-]{8,}$/u;
export const isIdSegment = segment => ID_SEGMENT.test(segment) || PREFIXED_ID_SEGMENT.test(segment);
/** Replace id-shaped path segments with ":id"; every other segment stays literal. */
export function normalizeIdSegments(pathname) {
  return String(pathname).split('/').map(segment => (isIdSegment(segment) ? ':id' : segment)).join('/');
}

function stopMap(chain) {
  const map = new Map();
  const request = chain.stops.find(stop => stop.stop === 'request');
  if (request) map.set('request', { key: `${request.method} ${normalizeIdSegments(request.path)}`, value: `${request.method} ${request.path}`, normalized: `${request.method} ${normalizeIdSegments(request.path)}`, stop: request });
  const route = chain.stops.find(stop => stop.stop === 'route');
  if (route) map.set('route', { key: route.route, value: `${route.method} ${route.route} ${route.status_code}`, stop: route });
  for (const handler of chain.stops.filter(stop => stop.stop === 'handler')) map.set(`handler:${handler.route}#${handler.index}`, { key: `${handler.route}#${handler.index}`, value: handler.name, stop: handler });
  const counts = new Map();
  // The full operation list: one slot per (operation, collection, issuer), so an
  // operation that moved from one piece of server code to another is a change.
  for (const db of chain.stops.filter(stop => stop.stop === 'db')) { const key = collapseDbOps([db])[0]; counts.set(key, (counts.get(key) || 0) + 1); }
  for (const [key, count] of counts) map.set(`db:${key}`, { key, value: key, count });
  for (const worker of chain.stops.filter(stop => stop.stop === 'worker')) if (!map.has(`worker:${worker.script_url}`)) map.set(`worker:${worker.script_url}`, { key: worker.script_url, value: `post to worker ${worker.script_url}`, stop: worker });
  return map;
}

export function compareChains(store, args) {
  const tool = 'compare_chains';
  const miss = lookupAction(store, args.before_action_id, tool, 'before_action_id') || lookupAction(store, args.after_action_id, tool, 'after_action_id');
  if (miss) return miss;
  const before = chainStops(store, args.before_action_id); const after = chainStops(store, args.after_action_id);
  const stops = [];
  const beforeEntry = before.stops.find(stop => stop.stop === 'entry_handler'); const afterEntry = after.stops.find(stop => stop.stop === 'entry_handler');
  if (beforeEntry || afterEntry) {
    let status = 'same'; let changeKind = null; let changeBasis = null; let remap = null;
    if (!beforeEntry) status = 'added'; else if (!afterEntry) status = 'removed';
    else if (beforeEntry.function_id !== afterEntry.function_id) {
      status = 'changed';
      const beforeBuild = store.buildByAction?.get(args.before_action_id) ?? null;
      const afterBuild = store.buildByAction?.get(args.after_action_id) ?? null;
      const beforeManifest = beforeBuild ? store.manifestsByBuild?.get(beforeBuild) : null;
      const afterManifest = afterBuild ? store.manifestsByBuild?.get(afterBuild) : null;
      if (beforeManifest && afterManifest) {
        // G6: both builds are in this store, so remap the before function
        // through the after build's manifest (and back). This replaces the
        // content-hash rule, which cannot tell a rebinding inside an edited
        // file from a pure source move.
        if (beforeBuild === afterBuild) {
          changeBasis = 'same_build';
          changeKind = 'different_handler';
          remap = { from_build: beforeBuild, to_build: afterBuild, status: 'same_build' };
        } else {
          const forward = remapFunctionId(beforeManifest, afterManifest, beforeEntry.function_id);
          const backward = forward.status === 'mapped' ? remapFunctionId(afterManifest, beforeManifest, afterEntry.function_id) : null;
          changeBasis = forward.basis;
          remap = { from_build: beforeBuild, to_build: afterBuild, ...forward, ...(backward ? { reverse_mapped_id: backward.mapped_id ?? null, reverse_basis: backward.basis } : {}) };
          if (forward.status !== 'mapped') changeKind = 'unmapped_revision';
          else changeKind = forward.mapped_id === afterEntry.function_id && backward?.mapped_id === beforeEntry.function_id ? 'source_revision' : 'different_handler';
        }
      } else {
        // Legacy single-manifest store (G4): a pure source move is same file
        // and event, the file's content hash differs (the file was edited
        // between builds), and the stamped component agrees when both sides
        // know it. Two different functions in one unchanged file (same hash)
        // are different handlers.
        changeBasis = 'content_hash';
        const hash = id => /^function:([0-9a-f]{64}):/u.exec(id)?.[1] ?? null;
        const componentOf = chain => { const key = chain.stops[0]?.element_key; const entry = key ? store.elementIndex.entries.get(key) : null;
          return entry?.key_kind === 'element_stamp' ? entry.placements[0]?.component ?? null : null; };
        const leftComponent = componentOf(before); const rightComponent = componentOf(after);
        const sameFile = Boolean(beforeEntry.source?.file) && beforeEntry.source.file === afterEntry.source?.file;
        const moved = sameFile && beforeEntry.event === afterEntry.event && hash(beforeEntry.function_id) !== hash(afterEntry.function_id)
          && (leftComponent == null || rightComponent == null || leftComponent === rightComponent);
        changeKind = moved ? 'source_revision' : 'different_handler';
      }
      if (changeKind === 'source_revision' && beforeEntry.event !== afterEntry.event) changeKind = 'different_handler';
    }
    stops.push({ stop: 'entry_handler', key: 'entry_handler', status, change_kind: changeKind,
      before: beforeEntry ? { function_id: beforeEntry.function_id, event: beforeEntry.event, source: beforeEntry.source, ...(beforeEntry.resolution ? { resolution: beforeEntry.resolution, status: beforeEntry.status, reason: beforeEntry.reason } : {}) } : null,
      after: afterEntry ? { function_id: afterEntry.function_id, event: afterEntry.event, source: afterEntry.source, ...(afterEntry.resolution ? { resolution: afterEntry.resolution, status: afterEntry.status, reason: afterEntry.reason } : {}) } : null,
      ...(changeBasis ? { change_basis: changeBasis } : {}), ...(remap ? { remap } : {}),
      detail: changeKind === 'source_revision' ? (remap?.status === 'mapped'
        ? `same function after remapping through the other build's manifest by ${changeBasis} (position ${remap.ordinal + 1} of ${remap.functions_in_file} functions in ${remap.file}); the file content changed between builds`
        : 'same file, event and component; the file content changed between builds (pure source move)')
        : changeKind === 'unmapped_revision' ? `cannot remap: ${remap.reason}; not claiming the handler is unchanged`
        : changeKind === 'different_handler' && remap ? (remap.status === 'same_build' ? 'two different functions in one build'
          : `remapped id ${remap.mapped_id} (by ${changeBasis}) is not the after handler`) : null });
  }
  const beforeMap = stopMap(before); const afterMap = stopMap(after);
  const order = [...new Set([...beforeMap.keys(), ...afterMap.keys()])];
  const kindOf = key => key.split(':')[0];
  for (const slot of order) {
    const left = beforeMap.get(slot); const right = afterMap.get(slot);
    const status = !left ? 'added' : !right ? 'removed' : left.value === right.value ? 'same' : 'changed';
    // Request paths are compared literally except id-shaped segments (24-hex
    // ObjectId, UUID, 8+ hex, all digits). A difference confined to those is
    // reported as parameters_only and is not by itself a path change; any
    // other differing segment (e.g. a route parameter like openAI vs agents)
    // is a real change.
    const changeKind = status !== 'changed' ? null : (slot === 'request' && left.normalized === right.normalized ? 'parameters_only' : 'different_value');
    stops.push({ stop: kindOf(slot), key: (left || right).key, status, change_kind: changeKind, before: left ? left.value : null, after: right ? right.value : null,
      detail: kindOf(slot) === 'db' && left && right ? `count ${left.count} → ${right.count}`
        : changeKind === 'parameters_only' ? `only id-shaped segments differ (${left.normalized})` : null });
  }
  // `status` and `reason` (fix/outcome-labels): a label change is an outcome change.
  const fields = ['status', 'reason', 'stage', 'http_status', 'stop_reason', 'stopped_at', 'reached'];
  const changed = fields.filter(field => JSON.stringify(before.outcome[field]) !== JSON.stringify(after.outcome[field]));
  if (JSON.stringify(before.outcome.writes) !== JSON.stringify(after.outcome.writes)) changed.push('writes');
  const reasons = [...new Set([
    ...stops.filter(stop => stop.status !== 'same' && stop.change_kind !== 'parameters_only' && stop.change_kind !== 'source_revision').map(stop => stop.stop),
    ...(changed.length ? ['outcome'] : []),
  ])];
  const pathChanged = reasons.length > 0;
  const counts = stops.reduce((acc, stop) => ({ ...acc, [stop.status]: (acc[stop.status] || 0) + 1 }), {});
  const notes = stops.filter(stop => stop.status !== 'same' && (stop.stop === 'entry_handler' || stop.change_kind === 'parameters_only'))
    .map(stop => `${stop.stop} ${stop.status}${stop.change_kind ? ` (${stop.change_kind})` : ''}`);
  const entryNote = notes.length ? `; ${notes.join('; ')}` : '';
  const summary = `${pathChanged ? `runtime path changed (${reasons.join(', ')})` : 'runtime path unchanged'}: ${Object.entries(counts).map(([key, value]) => `${value} ${key}`).join(', ')}${entryNote}`
    + `${changed.length ? `; outcome ${changed.map(field => `${field} ${JSON.stringify(before.outcome[field] ?? null)} → ${JSON.stringify(after.outcome[field] ?? null)}`).join(', ')}` : '; outcome unchanged'}`
    + `. Before: ${renderChainLine(before)}. After: ${renderChainLine(after)}`;
  return envelope(store, tool, 'ok', {
    before: { action_id: args.before_action_id, episode_id: before.episode.episode_id, reached: before.frontier.reached, stopped_at: before.frontier.stopped_at, because: before.frontier.because,
      outcome: before.outcome.status, segments: before.segments, summary: renderChainLine(before) },
    after: { action_id: args.after_action_id, episode_id: after.episode.episode_id, reached: after.frontier.reached, stopped_at: after.frontier.stopped_at, because: after.frontier.because,
      outcome: after.outcome.status, segments: after.segments, summary: renderChainLine(after) },
    same_episode: before.episode.episode_id === after.episode.episode_id,
    stops, outcome_delta: { before: before.outcome, after: after.outcome, changed }, path_changed: pathChanged, path_change_reasons: reasons,
  }, summary);
}

// --- page_requests --------------------------------------------------------

const TASK_API = { setInterval: 'setInterval timer', setTimeout: 'setTimeout timer', requestAnimationFrame: 'animation frame' };
const firstActionCache = new WeakMap();
/** Sequence of the first dom.action on a page (orders a task's arming against the user's actions). */
function firstActionSequence(store, page) {
  if (!firstActionCache.has(store)) {
    const map = new Map();
    for (const row of store.actionRows) { const key = pageOf(row); if (Number.isFinite(row.sequence) && (!map.has(key) || row.sequence < map.get(key))) map.set(key, row.sequence); }
    firstActionCache.set(store, map);
  }
  return firstActionCache.get(store).get(page) ?? null;
}

/**
 * What the rows say issued a request no action owns (`network.request.issuer`,
 * runtimes from 2026-09-24): the first-party frames on the stack and the task
 * it ran in. Never an attribution.
 */
const ISSUER_FRAMES_SHOWN = 6;
/**
 * The first-party frames of an issuer (or of the code that armed its task),
 * innermost first: the row's `function_ids` are the frames live at the call,
 * outermost first; consecutive repeats (a call-site proxy and its body) are
 * one frame. Each `{ function_id, name, display_name, name_status, label }` (the label prints `display_name`, fix/function-names).
 */
export function issuerFrames(store, ids) {
  return dedupeHops(Array.isArray(ids) ? ids.filter(id => typeof id === 'string') : []).reverse()
    .map(id => { const info = store.functionInfo?.(id) || null; return { function_id: id, name: info?.name ?? null, display_name: info?.display_name ?? null, name_status: info?.name_status ?? null, label: info?.label || id }; });
}
/**
 * `X file:1 (called from Y file:2 ← Z file:3)`: every frame, innermost first.
 * Over 6 frames: the innermost 5, `… +N more`, and always the outermost.
 */
function framesText(frames) {
  if (!frames.length) return '';
  const callers = frames.slice(1);
  const shown = callers.length <= ISSUER_FRAMES_SHOWN - 1 ? callers.map(frame => frame.label)
    : [...callers.slice(0, ISSUER_FRAMES_SHOWN - 2).map(frame => frame.label), `… +${callers.length - (ISSUER_FRAMES_SHOWN - 1)} more`, callers.at(-1).label];
  return `${frames[0].label}${shown.length ? ` (called from ${shown.join(' ← ')})` : ''}`;
}

export function describeIssuer(store, row, page) {
  const issuer = row?.issuer;
  if (!issuer || typeof issuer !== 'object') return 'issuer not recorded (runtime before 2026-09-24)';
  // Every first-party frame that was live when the request was sent, innermost first.
  const frames = issuerFrames(store, issuer.function_ids);
  // No recorded frame is not proof of uninstrumented code (e.g. a runtime that
  // could not carry frames across an await outside an action): say only what is recorded.
  // Not a claim about cause (fix/honest-coverage): only that no first-party frame was on the stack at the send.
  const by = frames.length ? `issued by ${framesText(frames)}` : 'no first-party frame recorded for this request (none was on the stack when it was sent)';
  const task = issuer.task && typeof issuer.task === 'object' ? issuer.task : null;
  if (!task) return `${by}; not inside a timer or frame callback armed outside an action (task origin not recorded)`;
  const first = firstActionSequence(store, page);
  const armed = Number(task.armed_sequence);
  const when = Number.isFinite(armed) ? (first === null || armed < first ? 'armed at page load (before the first user action on this page)' : `armed outside every user action (page sequence ${armed})`) : 'armed outside every user action';
  const armedFrames = issuerFrames(store, task.armed_by);
  const armedBy = armedFrames.length ? `, armed by ${framesText(armedFrames)}` : '';
  return `${by} from a ${TASK_API[task.api] || String(task.api || 'task')} ${when}${armedBy}`;
}

export function pageRequests(store, args) {
  const tool = 'page_requests';
  if (args.session !== undefined && !store.sessions.has(args.session) && !store.records.some(row => row?.kind === 'network.request' && pageOf(row) === args.session)) {
    return envelope(store, tool, 'not_found', { session: args.session, sessions: [...store.sessions.keys()], requests: [] }, `not_found: no session ${args.session} in this store`);
  }
  if (args.since !== undefined && args.until !== undefined && args.since > args.until) {
    return envelope(store, tool, 'invalid_input', { errors: ['since must be <= until'] }, 'invalid_input: since must be <= until');
  }
  const cursor = readBodyCursor(args);
  if (cursor === false) return envelope(store, tool, 'invalid_input', { errors: ['until_timestamp and until_id must be a pair from bodies_full.next_cursor'] }, 'invalid_input: pass both fields of bodies_full.next_cursor');
  const mode = args.attribution ?? 'any';
  const n = args.n ?? 100;
  const byTrace = spansByTrace(store.spans);
  const rows = store.records.filter(row => row?.kind === 'network.request' && row.internal !== true && row.transport_internal !== true)
    .filter(row => args.session === undefined || pageOf(row) === args.session)
    .filter(row => args.since === undefined || Number(row.timestamp) >= args.since)
    .filter(row => args.until === undefined || Number(row.timestamp) <= args.until)
    .filter(row => beforeBodyCursor({ ...row, session: pageOf(row) }, cursor))
    .filter(row => args.path === undefined || requestPath(row.url).startsWith(args.path))
    .filter(row => mode === 'any' || (mode === 'action' ? Boolean(row.action_id) : !row.action_id))
    .sort((left, right) => compareBodyKey(bodyKey({ ...left, session: pageOf(left) }), bodyKey({ ...right, session: pageOf(right) })));
  const chains = new Map();
  const includeBodies = args.include_bodies === true;
  // Body rows of every listed request (unattributed requests compare their fields with the same-endpoint requests of this listing).
  const bodiesByRow = new Map(rows.map(row => [row, typeof store.bodiesFor === 'function' ? store.bodiesFor(row) : null]));
  const endpointOf = row => `${String(row.method || 'GET').toUpperCase()} ${requestPath(row.url)}`;
  const listingFacts = row => {
    const peers = rows.filter(other => other !== row && endpointOf(other) === endpointOf(row));
    return { ...bodyFacts(bodiesByRow.get(row), peers.map(other => bodiesByRow.get(other))), fields_compared_with: { scope: 'listing', peers: peers.length },
      ...(bodyCaptureOff(store, pageOf(row)) && !bodiesByRow.get(row)?.response ? { browser_status_not_recorded: true } : {}) };
  };
  const describe = row => {
    const base = { session: pageOf(row), sequence: row.sequence ?? null, timestamp: row.timestamp ?? null, method: String(row.method || 'GET').toUpperCase(), url: row.url ?? null,
      path: requestPath(row.url), query: requestQuery(row.url) || null, transport: row.transport ?? null, request_occurrence_id: row.request_occurrence_id ?? null,
      trace_id: row.trace_context?.trace_id ?? null,
      // The page aborted it (network.abort merged onto the row by the store).
      ...(row.aborted_by_client === true ? { aborted_by_client: true, aborted_at: row.aborted_at ?? null } : {}),
      // The page aborted after the response had reached it (the label stays the server's).
      ...(row.abort_after_response === true ? { abort_after_response: true } : {}),
      ...(row.abort_state === 'undetermined' ? { abort_undetermined: true } : {}) };
    if (row.action_id && store.actionsById.has(row.action_id)) {
      if (!chains.has(row.action_id)) chains.set(row.action_id, chainStops(store, row.action_id, { includeBodies }));
      const chain = chains.get(row.action_id);
      const segment = chain.segments.find(value => (row.request_occurrence_id ? value.request_occurrence_id === row.request_occurrence_id : value.sequence === row.sequence)) || null;
      const dispatch = store.actionsById.get(row.action_id)[0];
      return { ...base, attribution: { kind: 'action', action_id: row.action_id, episode_id: chain.episode.episode_id, event: dispatch.event ?? null, segment_index: segment?.index ?? null,
        text: `action ${row.action_id} (${dispatch.event || 'action'}${segment ? `, request (${segment.index}) of its chain` : ''})` },
      route: segment?.route ?? null, http_status: segment?.http_status ?? null, ...(segment?.aborted_by_client ? { server_status: segment.server_status ?? null } : {}), handler_spans: segment?.handler_spans ?? [], db_ops: segment?.db_ops ?? [],
      hops: segment?.hops ?? [], escaped_hops: segment?.escaped_hops ?? [], hops_text: segment?.hops_text ?? null, ...(segment?.hops?.length ? { bodies: segment.bodies } : {}),
      outcome: segment?.outcome ?? null, outcome_text: segment?.outcome_text ?? null, lineage: segment?.lineage ?? [], third_party: segment?.third_party ?? null, reached: segment?.reached ?? null, stopped_at: segment?.stopped_at ?? null, because: segment?.because ?? null,
      // Body summaries, status and deferral are the segment's; the fields are compared within this listing (its same-endpoint requests),
      // the scope this reply shows, so two same-URL requests listed here never read alike without a statement.
      body: segment?.body ?? null, response_body: segment?.response_body ?? null, ...listingFacts(row),
      ...(segment?.status_mismatch ? { status_mismatch: segment.status_mismatch } : {}), deferred: segment?.deferred ?? null };
    }
    const joined = joinRequestServer(row, byTrace.get(row.trace_context?.trace_id), { backendInstrumented: store.backendInstrumented, allSpans: store.spans });
    const server = joined.server;
    // The one outcome label function, over this request's own exact joins.
    const label = actionOutcome({ chain: joined.steps, terminal: {} }, { backendInstrumented: store.backendInstrumented });
    // An untrusted event skipped since the start of the user act this request fell in, before it: say so.
    const page = pageOf(row), boundaries = pageCache(store).boundaries.get(page) || [];
    const before = boundaries.filter(action => Number(action.sequence) < Number(row.sequence));
    const since = [...before].reverse().find((action, index, list) => !action.gesture_id || list[index + 1]?.gesture_id !== action.gesture_id);
    const skipped = row.action_id ? [] : untrustedIn(store, page, since ? Number(since.sequence) : -Infinity, Number(row.sequence));
    const skippedText = skipped.length ? `; an untrusted (synthetic) ${[...new Set(skipped.map(entry => entry.event))].join('/')} event was skipped before it in this window (never a user action)` : '';
    // Never a claim about cause: the row carries no action_id, so no user action is attributed; the issuer is what the stack showed.
    const text = row.action_id ? `not attributed: action ${row.action_id} has no dom.action row in this store` : `not attributed to any user action; ${describeIssuer(store, row, pageOf(row))}${skippedText}`;
    const bodies = bodiesByRow.get(row);
    const facts = listingFacts(row);
    const httpStatus = Number.isFinite(Number(server?.status_code)) ? Number(server.status_code) : null;
    const mismatch = statusMismatch(facts.browser_status, httpStatus);
    const issuerFields = row.issuer && typeof row.issuer === 'object' ? { issuer_frames: issuerFrames(store, row.issuer.function_ids),
      ...(row.issuer.task && typeof row.issuer.task === 'object' ? { armed_by_frames: issuerFrames(store, row.issuer.task.armed_by) } : {}) } : {};
    return { ...base, attribution: { kind: 'none', action_id: row.action_id ?? null, runtime_reason: row.reason ?? null, issuer: row.issuer ?? null, ...issuerFields, text, note: 'no action_id on the row: attributed to no action (the issuer is what was on the stack, not a join)' },
      route: server ? { span_id: server.span_id, method: server.method, route: server.route, status_code: server.status_code } : null,
      http_status: label.status !== 'aborted_by_client' ? httpStatus : null,
      ...(label.status === 'aborted_by_client' ? { server_status: label.server_status } : {}), handler_spans: server?.handler_spans ?? [], db_ops: server?.db_ops ?? [],
      hops: server?.hops ?? [], escaped_hops: server?.escaped_hops ?? [], hops_text: server?.hops_text ?? null, ...(server?.hops?.length ? { bodies: server.bodies } : {}),
      server_join: joined.server_join, outcome: label.status, outcome_text: outcomeText(label),
      body: summarizeBody(bodies?.request, { full: includeBodies }), response_body: summarizeBody(bodies?.response, { full: includeBodies }),
      ...facts, ...(mismatch ? { status_mismatch: mismatch } : {}), deferred: null };
  };
  const all = rows.map(describe);
  for (const request of all) {
    const tail = [request.outcome_text || request.outcome, statusClause(request, request.http_status ?? request.server_status ?? null), issueDeferralText(request.deferred), ...bodyTail(request)].filter(Boolean);
    const server = request.route ? ` → ${`route ${request.route.route || '?'} ${request.route.status_code ?? ''}`.trim()}${serverWork(request)}` : request.server_join && request.server_join !== 'backend_not_instrumented' ? ` → no server span (${request.server_join})` : '';
    const time = Number.isFinite(Number(request.timestamp)) ? new Date(Number(request.timestamp)).toISOString().slice(11, 23) : '?';
    request.summary = `${time} ${request.method} ${request.path}${request.query || ''} [${request.attribution.text}]${server} [${tail.join('; ')}]`;
  }
  // Per endpoint (method + path): counts and the intervals between consecutive requests on one page.
  const groups = new Map();
  for (const request of all) {
    const key = `${request.method} ${request.path}`;
    const group = groups.get(key) || { endpoint: key, count: 0, attributed: 0, unattributed: 0, statuses: {}, first_timestamp: request.timestamp, last_timestamp: request.timestamp, sessions: new Set(), last_by_page: new Map(), intervals: [] };
    group.count += 1; if (request.attribution.kind === 'action') group.attributed += 1; else group.unattributed += 1;
    const status = request.http_status ?? request.outcome; group.statuses[status] = (group.statuses[status] || 0) + 1;
    group.last_timestamp = request.timestamp; group.sessions.add(request.session);
    const previous = group.last_by_page.get(request.session);
    if (previous != null && Number.isFinite(Number(request.timestamp))) group.intervals.push(Number(request.timestamp) - Number(previous));
    group.last_by_page.set(request.session, request.timestamp);
    groups.set(key, group);
  }
  const median = values => { if (!values.length) return null; const sorted = [...values].sort((a, b) => a - b); const middle = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2; };
  const endpoints = [...groups.values()].sort((left, right) => right.count - left.count || left.endpoint.localeCompare(right.endpoint)).map(group => ({
    endpoint: group.endpoint, count: group.count, attributed: group.attributed, unattributed: group.unattributed, statuses: group.statuses,
    first_timestamp: group.first_timestamp, last_timestamp: group.last_timestamp, sessions: [...group.sessions].sort(),
    interval_ms: group.intervals.length ? { median: median(group.intervals), min: Math.min(...group.intervals), max: Math.max(...group.intervals), samples: group.intervals.length } : null }));
  // Server spans in the window that no browser request's trace context joins (timestamps select them; not page-scoped).
  let serverOnly = null;
  const pageTimes = args.session === undefined ? null : store.records.reduce((range, row) => {
    const time = Number(row?.timestamp);
    if (pageOf(row) !== args.session || !Number.isFinite(time)) return range;
    return [Math.min(range[0], time), Math.max(range[1], time)];
  }, [Infinity, -Infinity]);
  const windowFrom = args.since ?? pageTimes?.[0] ?? null;
  const windowTo = args.until ?? pageTimes?.[1] ?? null;
  if (store.backendInstrumented && Number.isFinite(windowFrom) && Number.isFinite(windowTo)) {
    const contexts = new Set(store.records.filter(row => row?.kind === 'network.request' && row.trace_context?.trace_id).map(row => `${row.trace_context.trace_id}:${row.trace_context.span_id}`));
    // A hop's receiving server span is described under the server span that sent it; a span continued from a
    // recorded backend span is joined by that id (serverSpansWithoutBrowserParent, shared with unlinked evidence).
    const spans = serverSpansWithoutBrowserParent(store.spans, contexts)
      .map(span => ({ span, start: spanStartMs(span) })).filter(({ span, start }) => start != null && start >= windowFrom && start <= windowTo
        && (args.path === undefined || String(span.attributes?.['http.target'] ?? span.attributes?.['url.path'] ?? span.attributes?.['http.route'] ?? '').startsWith(args.path)))
      .sort((left, right) => left.start - right.start);
    serverOnly = { rule: 'server spans starting inside the window (server clock) whose parent span id is no recorded browser request, no recorded backend span and not a hop; listed, never joined; not page-scoped',
      spans: spans.slice(0, 20).map(({ span }) => ({ ...describeServerSpan(span, byTrace.get(span.trace_id), store.spans), attribution: 'none (no browser request carries its parent span id)' })), total: spans.length };
  }
  let listed = all.slice(-n);
  // include_bodies: the newest listed requests keep their stored bodies up to the budget.
  let bodiesFull = null;
  if (includeBodies) {
    const { entries, report } = budgetBodies([...listed].reverse());
    listed = entries.reverse();
    const nextCursor = report.next_cursor || (all.length > listed.length && listed.length ? bodyCursor(listed[0]) : null);
    const listingNotice = !report.cut && nextCursor
      ? `more requests precede this listing; call again with until_timestamp=${nextCursor.until_timestamp} and until_id=${JSON.stringify(nextCursor.until_id)} (and the same filters)` : '';
    const note = [bodyBudgetNotice(report), listingNotice].filter(Boolean).join('; ');
    bodiesFull = { budget_bytes: report.budget_bytes, bytes: report.bytes, with_full_bodies: report.with_full_bodies, cut: report.cut,
      ...(report.truncated_to_budget ? { truncated_to_budget: report.truncated_to_budget } : {}),
      ...(nextCursor ? { next_cursor: nextCursor } : {}), ...(note ? { note } : {}) };
  }
  const window = { session: args.session ?? null, since: args.since ?? null, until: args.until ?? null, path: args.path ?? null, attribution: mode,
    ...(cursor ? { until_timestamp: args.until_timestamp, until_id: args.until_id } : {}) };
  const counts = { total: all.length, attributed: all.filter(request => request.attribution.kind === 'action').length, unattributed: all.filter(request => request.attribution.kind === 'none').length };
  const head = `${counts.total} request(s)${args.session ? ` on page ${args.session}` : ''}${args.since !== undefined || args.until !== undefined ? ` between ${args.since ?? '…'} and ${args.until ?? '…'}` : ''}: ${counts.attributed} attributed to a user action, ${counts.unattributed} not attributed to any user action`;
  const lines = [head, ...endpoints.slice(0, 10).map(group => `- ${group.endpoint} ×${group.count} (${group.attributed} action, ${group.unattributed} not attributed; statuses ${Object.entries(group.statuses).map(([key, value]) => `${key}×${value}`).join(', ')})${group.interval_ms ? `; interval median ${group.interval_ms.median} ms (min ${group.interval_ms.min}, max ${group.interval_ms.max}, ${group.interval_ms.samples} gaps, each within one page)` : ''}`),
    ...(endpoints.length > 10 ? [`- … ${endpoints.length - 10} more endpoint(s)`] : []),
    ...(listed.length ? [`Requests (${listed.length === all.length ? 'all' : `most recent ${listed.length} of ${all.length}`}, oldest first):`, ...listed.slice(-20).map(request => `- ${request.summary}`)] : []),
    ...(listed.length > 20 ? [`- (${listed.length - 20} earlier listed in requests[])`] : []),
    ...(bodiesFull ? [`Full bodies: ${bodiesFull.with_full_bodies} request(s), ${Math.round(bodiesFull.bytes / 1024)} KB of the ${bodiesFull.budget_bytes / 1024} KB budget${bodiesFull.note ? `; ${bodiesFull.note}` : ''}`] : []),
    ...(serverOnly?.total ? [`Server spans with no browser request (${serverOnly.total}; not a join):`, ...serverOnly.spans.slice(0, 5).map(span => `- ${span.method || '?'} ${renderServerTail(span)} (span ${span.span_id})`)] : [])];
  // What each page's runtime observed (D-G1-21): listened kinds and per-kind counts.
  const pagesInScope = [...new Set(all.map(request => request.session).filter(Boolean))];
  const userEvents = typeof store.userEventsFor === 'function' ? Object.fromEntries(pagesInScope.map(page => [page, store.userEventsFor(page)]).filter(([, value]) => value)) : {};
  for (const [page, value] of Object.entries(userEvents)) lines.push(`Observed on page ${page}: ${value.listened_kinds} event kinds listened (capture.page.user_events); ${value.untrusted_skipped ?? '?'} untrusted event(s) skipped; ${Object.values(value.not_user_by_kind || {}).reduce((sum, count) => sum + count, 0)} not-user event(s)`);
  return envelope(store, tool, 'ok', { window, counts, endpoints, requests: listed, requests_total: all.length, ...(Object.keys(userEvents).length ? { user_events: userEvents } : {}), ...(bodiesFull ? { bodies_full: bodiesFull } : {}), ...(serverOnly ? { server_spans_without_request: serverOnly } : {}) }, lines.join('\n'));
}

export const HANDLERS = { resolve_element: resolveElement, element_history: elementHistory, action_chain: actionChain, recent_actions: recentActions, compare_chains: compareChains, page_requests: pageRequests };

/** Validate then dispatch. Never throws on bad input. */
export function callTool(store, name, args) {
  if (!Object.hasOwn(HANDLERS, name)) return envelope(store, String(name).slice(0, 64), 'invalid_input', { errors: ['unknown tool'] }, 'invalid_input: unknown tool');
  const errors = validateInput(TOOL_SCHEMAS[name], args);
  if (errors.length) return envelope(store, name, 'invalid_input', { errors }, `invalid_input: ${errors.join('; ')}`);
  return HANDLERS[name](store, args || {});
}
