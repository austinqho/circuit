import { attachBackendSpans, describeEpisodeEvidence, hopFollowed, hopReceiverSpanIds, indexEntryHandlerUnits, isClientAborted, isPrecondition, ISSUER_KIND_LABELS, issuerText, mergeRequestFacts, PRECONDITIONS_NOTE, preconditionsOnly, recordedAfter, SCOPED_ABSENCE, serverHops, serverSpanDescendants,
  terminalMiddleware, WORKER_STOP_REASON, workerBecause, workerPostsOf, workerStops } from './runtime-attribution.mjs';
import { pageOf } from './element-index.mjs';

/**
 * The one `producttrace.causal-chain.v1` assembler for a workflow episode.
 *
 * Lifted verbatim from the live viewer (`test/browser/server.mjs`,
 * `liveEpisodeRecord`) so the viewer, the MCP server, and harnesses share one
 * function. It composes the existing primitives only: exact-parent span joins
 * (`attachBackendSpans`), effect-rooted handler credit
 * (`indexEntryHandlerUnits`), and evidence-derived episode state
 * (`describeEpisodeEvidence`). It adds no join or credit rule of its own.
 *
 * @param {object} episode an entry of `indexWorkflowEpisodes(rows).episodes`
 * @param {object[]} rows runtime-evidence rows (any superset of the episode's rows)
 * @param {object[]} spans `producttrace.backend-span.v1` spans
 * @param {object} [options]
 * @param {Iterable<string>|null} [options.registeredFunctionIds] manifest ids; null admits every id
 * @param {(functionId: string) => object|null} [options.sourceFor] function id → `{file,start,end}`
 * @param {boolean} [options.idle] true once no more evidence can arrive (a stored session)
 * @param {string|null} [options.sessionId]
 * @param {(classId: string) => string|null} [options.errorClassName] class id → the source name the build recorded (manifest `classes`)
 * @param {{ forEpisode(episode: object): object }|null} [options.unlinked] an `indexUnlinkedEvidence` index;
 *   when given, a chain with no attributed request, or with a post to a Web Worker, carries `unlinked`
 *   (listed, never joined)
 */
export function buildEpisodeChain(episode, input, spans, { registeredFunctionIds = null, sourceFor = () => null, idle = false, sessionId = null, backendInstrumented = true, unlinked = null, errorClassName = null, relatedRows = [] } = {}) {
  if (!episode || !Array.isArray(episode.action_ids)) throw new TypeError('episode with action_ids is required');
  if (!Array.isArray(input) || !Array.isArray(spans)) throw new TypeError('rows and spans must be arrays');
  // Abort and body-read facts onto their request rows (fix/client-aborts).
  const rows = mergeRequestFacts(input);
  const registered = registeredFunctionIds == null ? null : [...registeredFunctionIds];
  const actionIds = new Set(episode.action_ids);
  const publicRows = rows.filter(row => actionIds.has(row.action_id) && row?.internal !== true && row?.transport_internal !== true);
  // Backend telemetry is declared by the caller, never inferred from missing spans (G1).
  const joined = backendInstrumented ? attachBackendSpans(publicRows, spans) : publicRows;
  const state = describeEpisodeEvidence(episode, publicRows, joined, { idle, backendInstrumented });
  const requests = state.latest_request ? [state.latest_request] : [];
  const mutations = publicRows.filter(row => row.kind === 'dom.mutation');
  const { posts: workerPosts, latest: latestWorkerPost } = workerPostsOf(publicRows);
  const carrierActionId = state.latest_request?.action_id || state.rejected_submits?.at(-1)?.submit?.action_id || latestWorkerPost?.action_id || mutations.at(-1)?.action_id || episode.carrier_action_id;
  const action = episode.actions.find(row => row.action_id === carrierActionId) || episode.actions.at(-1);
  const trigger = [...episode.actions].reverse().find(row => row.event === 'submit')
    || [...episode.actions].reverse().find(row => row.event === 'click' && row.target?.attributes?.type === 'submit')
    || [...episode.actions].reverse().find(row => row.event === 'keydown' && row.key?.key === 'Enter') || action;
  const index = indexEntryHandlerUnits(publicRows, { registeredFunctionIds: registered });
  const unitId = index.byAction.get(carrierActionId)?.[0] || null;
  const functionId = unitId ? unitId.slice(0, unitId.lastIndexOf('|')) : null;
  const unit = unitId ? index.units.get(unitId) : null;
  const rooted = Boolean(unit?.rooted_action_ids?.includes(carrierActionId));
  // D-G1-22: the credited frame's observed binding to this dispatch (null when
  // it ran unbound but owned a request); absent for rows recorded before
  // bindings were observed.
  const creditedEntry = unit?.entries?.find(entry => entry.action_id === carrierActionId && entry.binding !== undefined) || null;
  // No element- or form-bound handler ran for the carrier: no credit, explicit frontier.
  const handlerAbstention = index.abstentions?.get(carrierActionId) || null;
  const routes = state.routes || [];
  const handlers = state.handlers || [];
  const databases = state.databases || [];
  const diagnostics = joined.filter(row => row.kind === 'span.join.diagnostic'
    && row.request_occurrence_id === state.latest_request?.request_occurrence_id);
  // Server-to-server hops of the credited request (exact traceparent joins).
  const latest = state.latest_request;
  const hopRows = latest ? joined.filter(row => row.kind === 'server.hop' && (latest.request_occurrence_id
    ? row.request_occurrence_id === latest.request_occurrence_id : row.action_id === latest.action_id)) : [];
  const hops = hopSegments(hopRows);
  const appEvidenceRows = appEvidence(publicRows, actionIds, { errorClassName });
  // The episode's window (first dispatch to the next outside dispatch): what
  // left the page, or reached a server, in it that no identifier ties to any
  // action. Ordering selects; nothing here joins. A caller holding only the
  // episode's rows passes the store-wide index; otherwise it is built from
  // the rows given.
  const windowIndex = unlinked || indexUnlinkedEvidence(rows, spans);
  const windowRaw = windowIndex.windowOf ? windowIndex.windowOf(episode) : null;
  const windowEvidence = windowRaw ? windowEvidenceOf(windowRaw) : null;
  // Root server spans in the window that could continue a joined request (order only; hops are main's server.hop rows).
  const windowRoots = backendInstrumented ? windowRootsOf(joined, spans, windowRaw) : null;
  // Events this episode's actions opened by a synthetic click (D-G1-21
  // opened_by): their own requests, listed (never joined into this chain).
  const opened = openedWithRequests(episode, rows, relatedRows);
  const terminal = state.status === 'pending' ? { pending: true, stage: state.stage, label: state.label }
    : (state.status === 'incomplete' ? { stop_reason: state.stop_reason, ...(state.frontier || {}), stage: state.stage, label: state.label }
      : { effect: state.stage, stage: state.stage, label: state.label });
  const control = chainControl(trigger);
  const chain = [
    ...(functionId ? [{ kind: 'function.enter', id: functionId, source_ref: sourceFor(functionId), evidence_ids: unit?.entries?.flatMap(entry => [entry.sequence]) || [] }] : []),
    ...requests.map(row => ({ ...row, id: row.request_occurrence_id || `${row.method} ${row.url}` })),
    ...routes.map(row => ({ ...row, id: row.route_id })),
    ...handlers.map(row => ({ ...row, id: row.handler_id })),
    ...databases.map(row => ({ ...row, id: row.db_id })),
    ...diagnostics.map(row => ({ ...row, id: `span.join.diagnostic:${row.sequence}` })),
    ...hopRows.map(row => ({ ...row, id: row.hop_id })),
    ...(state.rejected_submits || []).map(({ submit, mutation }) => ({ kind: 'submit.rejected', id: `submit.rejected:${submit.action_id}`,
      action_id: submit.action_id, form_ref: episode.form_ref || submit.form_ref || null, mutation,
      evidence_ids: [submit.sequence, mutation.sequence].filter(Number.isFinite),
      admission_reason: 'no request observed from instrumented code after the submit, and a mutation receipt followed on the same observed form' })),
    ...(!requests.length ? mutations.slice(-1).map(row => ({ ...row, id: `dom.mutation:${row.sequence}` })) : []),
    ...workerPosts.map(row => ({ ...row, id: `worker.postMessage:${row.sequence}` })),
    ...publicRows.filter(row => row.kind === 'network.send').map(row => ({ ...row, id: `network.send:${row.sequence}` })),
  ];
  // One label set for every reader (MCP, viewer, exports): computed from the
  // chain's own steps by actionOutcome, never from the engine's episode state.
  const requestSteps = episodeRequestSteps(joined);
  const abortedEffects = abortedRequestEffects(requestSteps, requests[0] || null);
  const outcome = actionOutcome({ chain, terminal, opened, entry_handler: functionId ? { function_id: functionId } : null,
    handler_abstention: handlerAbstention, app_evidence: appEvidenceRows, request_steps: requestSteps,
    ...(abortedEffects.length ? { aborted_request_effects: abortedEffects } : {}), window_evidence: windowEvidence, window_roots: windowRoots }, { backendInstrumented });
  terminal.label = outcome.label;
  return { schema: 'producttrace.causal-chain.v1', action_id: carrierActionId, episode_id: episode.episode_id,
    episode_action_ids: episode.action_ids, coalescing_rule: episode.coalescing_rule,
    // Focuses this episode's actions caused (not gestures, not members): listed only.
    ...(episode.caused?.length ? { caused: episode.caused } : {}),
    ...(opened.length ? { opened } : {}),
    session_id: sessionId, event: action?.event, control,
    display: { stage: state.stage, status: outcome.status, label: outcome.label },
    outcome, app_evidence: appEvidenceRows, ...(abortedEffects.length ? { aborted_request_effects: abortedEffects } : {}),
    entry_handler: functionId ? { unit_id: unitId, function_id: functionId, source: sourceFor(functionId), rooted, ...(creditedEntry ? { binding: creditedEntry.binding } : {}),
      ...(creditedEntry?.unbound_request_issuers ? { unbound_request_issuers: creditedEntry.unbound_request_issuers } : {}) } : null,
    ...(handlerAbstention ? { handler_abstention: handlerAbstention } : {}),
    spine: { action_id: carrierActionId, function_ids: functionId ? [functionId] : [] },
    chain, ...(hopRows.length ? { hops: hops.hops, escaped_hops: hops.escaped_hops, hops_text: hops.text, bodies: HOP_BODIES } : {}), terminal, abstained: [...(state.stop_reason ? [state.stop_reason] : []), ...(handlerAbstention ? [handlerAbstention.closed_shadow ? 'closed_shadow_target' : handlerAbstention.stop_reason || 'no_element_bound_handler'] : [])],
    raw_evidence_ids: publicRows.map(row => row.sequence).filter(Number.isFinite),
    // Counts over the episode's window (never a join): the frontier and the
    // action's coverage read them only to withhold a claim or to state what
    // left the page (fix/honest-coverage).
    ...(windowEvidence ? { window_evidence: windowEvidence } : {}),
    ...(windowRoots ? { window_roots: windowRoots } : {}),
    // A hint for a reader, never an attribution: it does not feed `chain` or
    // `terminal`. A chain that posted to a Web Worker, or whose window holds a
    // root server span that could continue its request, carries it even when
    // a request was attributed.
    ...((!requests.length || workerPosts.length || rootEscape(windowRoots)) && (unlinked || rootEscape(windowRoots)) ? { unlinked: windowIndex.forEpisode(episode) } : {}) };
}

/**
 * The episode a stored action belongs to: its evidence-derived episode, else a
 * standalone single-action episode (never a merge by time). One rule for the
 * store (MCP) and the exported chains, so an action has one outcome.
 */
export function episodeForAction(episodes, actionId, action = null) {
  const episodeId = episodes?.byAction?.get(actionId);
  if (episodeId && episodes.episodes.has(episodeId)) return { episode: episodes.episodes.get(episodeId), standalone: false };
  return { episode: { episode_id: `episode:standalone:${actionId}`, carrier_action_id: actionId, action_ids: [actionId], actions: action ? [action] : [],
    form_ref: null, coalescing_rule: 'standalone: context action outside every evidence-derived episode (no merge by time)' }, standalone: true };
}

/**
 * Episode-focus rule 3: a non-carrier member of an episode is described by its
 * own evidence only. `memberScope` is the one-action episode its own chain is
 * built over (same assembler, same outcome function); `memberPointer` is the
 * sentence naming the carrier. The carrier is the episode chain's own
 * (`buildEpisodeChain(...).action_id`). Shared by the store (MCP) and the
 * exported action chains.
 */
export function memberScope(episode, actionId, action = null) {
  const ownCaused = (episode?.caused || []).filter(entry => entry.caused_by_action_id === actionId);
  const ownOpened = (episode?.opened || []).filter(entry => entry.opened_by_action_id === actionId);
  return { episode_id: episode.episode_id, carrier_action_id: actionId, action_ids: [actionId], actions: action ? [action] : [],
    form_ref: episode.form_ref ?? null, coalescing_rule: episode.coalescing_rule,
    ...(ownCaused.length ? { caused: ownCaused, caused_action_ids: ownCaused.map(entry => entry.action_id) } : {}),
    ...(ownOpened.length ? { opened: ownOpened } : {}) };
}

/** Opened events (episode.opened) with the requests their own actions sent, from any rows given. */
export function openedWithRequests(episode, rows, relatedRows = []) {
  const entries = episode?.opened || [];
  if (!entries.length) return [];
  const ids = new Set(entries.map(entry => entry.action_id));
  const seen = new Set(); const requests = new Map();
  for (const row of [...rows, ...relatedRows]) {
    if (row?.kind !== 'network.request' || !ids.has(row.action_id) || row.internal === true || row.transport_internal === true) continue;
    const key = row.request_occurrence_id || `${row.sequence}`; if (seen.has(key)) continue; seen.add(key);
    const list = requests.get(row.action_id) || []; list.push({ method: String(row.method || 'GET').toUpperCase(), url: row.url ?? null, request_occurrence_id: row.request_occurrence_id ?? null, sequence: row.sequence ?? null });
    requests.set(row.action_id, list);
  }
  return entries.map(entry => ({ ...entry, requests: requests.get(entry.action_id) || [] }));
}
export function memberPointer(episode, fullRecord) {
  const hasRequest = (fullRecord?.chain || []).some(step => step.kind === 'network.request');
  return `this action is part of episode ${episode.episode_id}; its ${hasRequest ? 'request is' : 'evidence is'} attributed to the carrier action ${fullRecord.action_id}`;
}
/** A member's own outcome (actionOutcome over its own steps), with the pointer sentence appended. */
export function memberOutcome(ownOutcome, pointer) {
  return { ...ownOutcome, sentence: `${ownOutcome.sentence}; ${pointer}`, episode_pointer: pointer };
}

/** The control the user acted on, as observed on the dispatch row (no labels invented). */
export function chainControl(action) {
  const observed = action?.event === 'submit' && action?.submitter ? action.submitter : action?.target;
  return { ...(observed || {}), label: observed?.attributes?.['aria-label'] || observed?.attributes?.['data-testid'] || observed?.attributes?.id || observed?.tag || action?.event };
}

// Built on first use: runtime-attribution.mjs imports this module back
// (buildActionChains labels exports with actionOutcome), so nothing imported
// from it may be read while this module is evaluated.
let frontierBecause = null;
const FRONTIER_BECAUSE_OF = () => (frontierBecause ||= {
  no_exact_parent_server_before_idle: 'no server span with the exact parent span id arrived in the same trace',
  no_database_effect_before_idle: 'no database span descends from the admitted handler span',
  // Request-less frontiers are scoped to what Tracer sees (SCOPED_ABSENCE).
  submit_rejected_by_app: `the same form mutated after the submit (validation); ${SCOPED_ABSENCE.no_request}`,
  no_request_or_validation_effect_after_submit: SCOPED_ABSENCE.no_request,
  no_effect_after_dispatch: SCOPED_ABSENCE.no_request,
});

/**
 * Explicit frontier for a stored chain: "reached / stopped at / because".
 * `backendInstrumented: false` (no spans in the store) turns every
 * request-bearing chain into the network frontier; nothing is inferred past it.
 */
export function chainFrontier(record, options = {}) {
  return windowFrontier(hopFrontierOf(record, options), record, options);
}

function hopFrontierOf(record, options = {}) {
  const frontier = workerFrontier(record, options);
  // Every hop that left to a server Tracer has no span for is a stated
  // frontier of its own, whatever the headline stop is.
  const escaped = frontier.stop_reason === 'pending' ? [] : escapedHopStops(record?.chain);
  if (!escaped.length) return frontier;
  const additional = [...(frontier.additional_stops || []), ...escaped];
  // "Terminal effect observed" only when no hop escaped: a chain that reached
  // its effect but lost a hop stops at `server_hop` (shared with
  // fix/honest-coverage), and its sentence keeps the effect it did observe.
  if (frontier.stopped_at == null) return { ...frontier, stopped_at: 'server_hop', stop_reason: SERVER_HOP_STOP_REASON,
    because: `reached ${frontier.reached}${frontier.because ? ` (${frontier.because})` : ''}; ${hopEscapeClause(unfollowedHopSteps(record?.chain))}`, additional_stops: additional };
  return { ...frontier, additional_stops: additional };
}

// ---- Honest coverage (fix/honest-coverage) ---------------------------------
// The window of an action (first dispatch to the next outside dispatch; the
// last one ends at the page's last runtime row + PAGE_END_GRACE_MS) says what
// left the page or reached a server that no identifier ties to any action.
// It never joins: it withholds a claim ("terminal effect observed",
// "complete") or states what left the page.

const NO_REQUEST_HEAD = 'no request could be attributed to this action from instrumented code';
// The headline keeps the scope caveat: the recorded requests it names are not all that can leave a page.
const NO_REQUEST_CAVEATED = `${NO_REQUEST_HEAD} (requests from uninstrumented scripts, workers and third-party code cannot be linked; transports and realms Tracer does not record are listed in coverage.unobserved)`;
export const WEBSOCKET_STOP_REASON = 'websocket_not_traceable';
const socketSendsOf = chain => (Array.isArray(chain) ? chain : []).filter(step => step?.kind === 'network.send');
/** "sent 2 WebSocket messages on ws://…/ws (5 bytes)": what the action sent that no trace context follows. */
function socketText(sends) {
  const urls = [...new Set(sends.map(step => step.url || 'unknown socket'))];
  const bytes = sends.every(step => Number.isFinite(Number(step.bytes))) ? sends.reduce((sum, step) => sum + Number(step.bytes), 0) : null;
  return `sent ${sends.length} WebSocket message${sends.length === 1 ? '' : 's'} on ${urls.join(', ')}${bytes != null ? ` (${bytes} bytes)` : ''}`;
}
const SOCKET_TAIL = 'a message carries no trace context, so what it caused on a server cannot be attributed to this action (server spans seen in this window are listed below as unlinked)';

/**
 * The window facts applied to a frontier (after the hop rule):
 *  - WebSocket messages the action sent: a request-less chain stops at
 *    `websocket`; any other frontier states them;
 *  - request-bearing: a root server span (no browser parent, no backend
 *    parent) in the window that started after a joined server span could be
 *    its continuation: "terminal effect observed" is withheld (`server_hop`),
 *    or the clause is appended; escaped `server.hop`s are main's and are
 *    stated once, by hopFrontierOf;
 *  - request-less: the recorded requests that left the page in the window
 *    are named in the headline, the scope caveat kept.
 */
export function windowFrontier(frontier, record, { backendInstrumented = true } = {}) {
  if (!frontier || frontier.stop_reason === 'pending') return frontier;
  const chain = Array.isArray(record?.chain) ? record.chain : [];
  const hasRequest = chain.some(step => step.kind === 'network.request');
  const sends = socketSendsOf(chain);
  if (sends.length) {
    if (!hasRequest && (frontier.stopped_at === 'browser' || frontier.stopped_at === 'validation')) {
      frontier = { reached: 'websocket', stopped_at: 'websocket', because: `${socketText(sends)}; ${SOCKET_TAIL}`, stop_reason: WEBSOCKET_STOP_REASON,
        ...(frontier.additional_stops ? { additional_stops: frontier.additional_stops } : {}) };
    } else frontier = { ...frontier, because: `${frontier.because}; also ${socketText(sends)}: ${SOCKET_TAIL}` };
  }
  if (hasRequest) {
    const escape = backendInstrumented ? rootEscape(record?.window_roots) : null;
    if (!escape) return frontier;
    const fields = { root_escape: { continuation_candidates: escape.continuation_candidates, span_ids: escape.span_ids } };
    if (frontier.stopped_at == null) return { ...frontier, stopped_at: 'server_hop', because: `reached ${frontier.reached}${frontier.because ? ` (${frontier.because})` : ''}; ${SERVER_HOP_ESCAPE_LABEL}: ${escape.clause}`, stop_reason: SERVER_HOP_STOP_REASON, ...fields };
    return { ...frontier, because: `${frontier.because}; ${frontier.stopped_at === 'server_hop' ? 'also' : `${SERVER_HOP_ESCAPE_LABEL}:`} ${escape.clause}`, ...fields };
  }
  const clause = windowRequestsClause(record?.window_evidence);
  if (!clause) return frontier;
  const because = frontier.because?.includes(SCOPED_ABSENCE.no_request)
    ? frontier.because.replace(SCOPED_ABSENCE.no_request, `${NO_REQUEST_CAVEATED}; ${clause}, listed below as unlinked`)
    : `${frontier.because}; ${clause}, listed below as unlinked`;
  return { ...frontier, because, window_requests: record.window_evidence.requests_total };
}

/** Grace after a page's last runtime row during which a server span still counts as in its last window (pagehide beacons). */
export const PAGE_END_GRACE_MS = 2000;

/**
 * Server spans no browser row is the parent of: `kind: "server"` spans whose
 * (trace id, parent span id) matches no recorded request's trace context, no
 * recorded backend span (continued by that identifier, e.g. an instrumented
 * server-to-server call) and which are not a hop's receiving span. What
 * remains is a root trace or a caller Tracer does not see.
 */
export function serverSpansWithoutBrowserParent(spans, requestContexts, hopReceivers = hopReceiverSpanIds(spans)) {
  const known = new Set((spans || []).filter(span => span?.trace_id && span.span_id).map(span => `${span.trace_id}:${span.span_id}`));
  return (spans || []).filter(span => span?.kind === 'server' && !requestContexts.has(`${span.trace_id}:${span.parent_span_id}`) && !hopReceivers.has(span.span_id)
    && !(span.parent_span_id && known.has(`${span.trace_id}:${span.parent_span_id}`)));
}

/**
 * Whether the rows name what issued an unattributed request: a first-party
 * frame on the stack at send time, or frames that armed the task it ran in.
 * No frame recorded is "issuer unknown", never a guess.
 */
export function issuerKnown(row) {
  const issuer = row?.issuer;
  if (!issuer || typeof issuer !== 'object') return false;
  const frames = Array.isArray(issuer.function_ids) ? issuer.function_ids.filter(id => typeof id === 'string') : [];
  const armed = Array.isArray(issuer.task?.armed_by) ? issuer.task.armed_by.filter(id => typeof id === 'string') : [];
  return frames.length > 0 || armed.length > 0;
}

/** A recorded request that never left the page (its signal was already aborted at the call: fix/client-aborts). */
const neverSent = row => row?.signal_aborted_at_call === true;

const WINDOW_REQUESTS_NAMED = 3;
/** Counts over an episode's raw window (`windowOf`), for the frontier and the action's coverage. */
function windowEvidenceOf(raw) {
  if (!raw || raw.status) return { window: null, window_status: raw?.status ?? 'no window', requests_total: 0, requests_issuer_unknown: 0, requests: [], server_spans_total: 0, socket_sends_total: 0, realms_appeared: [], untrusted_followed: [] };
  // Each recorded request once (by occurrence id), and only if it left the page: an aborted request still left
  // (its abort is a fact on the same row), a request whose signal was aborted before the call never did.
  const seen = new Set();
  const left = raw.requests.filter(row => { if (neverSent(row)) return false; const key = row.request_occurrence_id || `sequence:${row.sequence}`; if (seen.has(key)) return false; seen.add(key); return true; });
  return { window: raw.window, requests_total: left.length, requests_issuer_unknown: left.filter(row => !issuerKnown(row)).length,
    requests: left.slice(0, WINDOW_REQUESTS_NAMED).map(row => ({ sequence: row.sequence ?? null, method: String(row.method || 'GET').toUpperCase(),
      path: pathOf(row.url), transport: row.transport ?? null, issuer_known: issuerKnown(row), issuer_recorded: Boolean(row.issuer && typeof row.issuer === 'object'),
      ...(isClientAborted(row) ? { aborted_by_client: true } : {}) })),
    server_spans_total: raw.servers.length,
    // Every WebSocket message sent in the window (owned by any action or none): a message carries no trace context.
    socket_sends_total: (raw.sends || []).length,
    // Realms that appeared in the window (a frame inserted, a worker created): code there is not recorded.
    realms_appeared: (raw.realms || []).map(row => ({ feature: row.feature, realm_kind: row.realm_kind ?? (row.feature === 'worker_fetch' ? 'worker' : null),
      same_origin: row.same_origin ?? null, url: row.url ?? row.script_url ?? null, sequence: row.sequence ?? null })),
    // Untrusted (synthetic) events the runtime skipped in the window (D-G1-21
    // dom.untrusted rows) that an unattributed request followed: work an
    // untrusted event starts runs under no user action.
    untrusted_followed: (raw.untrusted || []).filter(row => left.some(request => Number(request.sequence) > Number(row.sequence)))
      .map(row => ({ event: row.event ?? null, sequence: row.sequence ?? null, target_ref: row.target_ref ?? null })) };
}

/**
 * Root server spans in the window that could continue a joined request: a
 * server span with no browser parent that started at or after the joined
 * server span started, before the window closed. Order only, never a join:
 * listed as unlinked and only a reason not to claim the terminal effect.
 * (Outbound calls with an identifier are `server.hop` rows: fix/server-outbound.)
 */
function windowRootsOf(joined, spans, raw) {
  const routes = joined.filter(row => row.kind === 'route.dispatch' && row.span_id);
  if (!routes.length) return null;
  const byTrace = spansByTrace(spans);
  const requests = routes.map(route => {
    const server = (byTrace.get(route.trace_id) || []).find(span => span.span_id === route.span_id) || null;
    const start = spanStartMs(server) ?? route.start_ms ?? null;
    const candidates = raw && !raw.status && start != null ? raw.servers.filter(row => row.start_ms >= start) : null;
    return { request_occurrence_id: route.request_occurrence_id ?? null, server_span_id: route.span_id, server_start_ms: start,
      continuation_candidates_total: candidates ? candidates.length : null,
      continuation_candidates: candidates ? candidates.slice(0, 5).map(({ span, start_ms: startMs }) => ({ span_id: span.span_id ?? null, trace_id: span.trace_id ?? null,
        method: span.attributes?.['http.method'] ?? span.attributes?.['http.request.method'] ?? null, route: span.attributes?.['http.route'] ?? null, start_ms: startMs })) : null };
  });
  return { rule: 'server spans with no browser parent (and no backend parent, not a hop receiver) starting in this window at or after the joined server span started; order only, never a join',
    window_checked: Boolean(raw && !raw.status), requests };
}

/** A window's root continuation candidates (all requests, or one by occurrence id), with the clause; null when none. */
export function rootEscape(windowRoots, occurrence = undefined) {
  if (!windowRoots?.requests?.length) return null;
  const requests = occurrence === undefined ? windowRoots.requests : windowRoots.requests.filter(row => row.request_occurrence_id === occurrence);
  // Candidates of the earliest-starting request include every later request's.
  let candidates = 0; const ids = new Set();
  for (const row of requests) { if (row.continuation_candidates_total == null) continue; candidates = Math.max(candidates, row.continuation_candidates_total); for (const span of row.continuation_candidates || []) ids.add(span.span_id); }
  if (!candidates) return null;
  return { continuation_candidates: candidates, span_ids: [...ids],
    clause: `${candidates} server-side request${candidates === 1 ? '' : 's'} in this window ${candidates === 1 ? 'has' : 'have'} no browser parent (listed as unlinked)` };
}

/** The window's root candidates restricted to one request (its own segment). */
export function windowRootsFor(windowRoots, occurrence) {
  if (!windowRoots?.requests) return null;
  const requests = windowRoots.requests.filter(row => row.request_occurrence_id === occurrence);
  return requests.length ? { ...windowRoots, requests } : null;
}

/** The headline clause for unattributed recorded requests that left the page in a request-less action's window. */
export function windowRequestsClause(windowEvidence) {
  const total = windowEvidence?.requests_total || 0;
  if (!total) return null;
  const named = (windowEvidence.requests || []).map(row => `${row.method} ${row.path}, ${row.issuer_known ? 'issued by instrumented code outside any action' : row.issuer_recorded === false ? 'issuer not recorded by this runtime' : 'issuer unknown'}${row.aborted_by_client ? ', aborted by the page' : ''}`);
  return `${total} recorded request${total === 1 ? '' : 's'} left this page during this action's window that Tracer could not attribute (${named.join('; ')}${total > named.length ? `; … ${total - named.length} more` : ''})`;
}

/**
 * Reasons an action's coverage is not complete that come from its own
 * evidence and window (added to the page's delivery reasons): a hop not
 * followed (the same `server.hop` the frontier names, by hop id and span id),
 * an unattributed request with no known issuer, a server span with no
 * browser parent, a frame or worker that appeared, a WebSocket message sent.
 */
export function windowCoverageReasons(record) {
  const reasons = [];
  const lost = unfollowedHopSteps(record?.chain);
  if (lost.length) reasons.push(`${lost.length} server-side hop(s) not followed (${lost.map(hop => `hop ${hop.hop}: ${hop.method || '?'} ${hop.url || '?'}, span ${hop.span_id}`).join('; ')})`);
  const evidence = record?.window_evidence;
  if (evidence?.requests_issuer_unknown > 0) reasons.push(`${evidence.requests_issuer_unknown} request(s) left this page in this action's window not attributed to any user action and with no known issuer (listed as unlinked)`);
  if (evidence?.realms_appeared?.length) {
    const frames = evidence.realms_appeared.filter(row => row.realm_kind === 'frame'); const others = evidence.realms_appeared.filter(row => row.realm_kind !== 'frame');
    if (frames.length) reasons.push(`${frames.length} child frame(s) appeared in this action's window (${frames.filter(row => row.same_origin).length} same-origin, ${frames.filter(row => !row.same_origin).length} cross-origin): code in a frame is not recorded`);
    if (others.length) reasons.push(`${others.length} other realm(s) appeared in this action's window (${[...new Set(others.map(row => row.realm_kind))].join(', ')}): code there is not recorded`);
  }
  if (evidence?.untrusted_followed?.length) reasons.push(`an untrusted (synthetic) event was skipped in this window (${[...new Set(evidence.untrusted_followed.map(row => row.event))].join(', ')}); a request followed it, and work an untrusted event starts runs under no user action`);
  if (evidence?.socket_sends_total > 0) reasons.push(`${evidence.socket_sends_total} WebSocket message(s) sent in this action's window: a message carries no trace context, so what it caused on a server cannot be joined`);
  if (evidence?.server_spans_total > 0) reasons.push(`${evidence.server_spans_total} server span(s) in this action's window have no browser parent (a root trace: a server-side hop Tracer did not follow, or a caller it does not see)`);
  return reasons;
}

function workerFrontier(record, { backendInstrumented = true } = {}) {
  const base = baseFrontier(record, { backendInstrumented });
  const chain = Array.isArray(record?.chain) ? record.chain : [];
  const { posts, latest } = workerPostsOf(chain);
  if (!latest || base.stop_reason === 'pending') return base;
  const request = chain.find(step => step.kind === 'network.request') || null;
  // A first-party request attributed after the latest post keeps its
  // frontier; the worker is listed as an additional stop. Otherwise the chain
  // stops at the worker and any request frontier is the additional stop.
  if (request && recordedAfter(request, latest)) return { ...base, additional_stops: workerStops(posts) };
  const additional = [
    ...(request ? [{ stopped_at: base.stopped_at, because: base.because, stop_reason: base.stop_reason, reached: base.reached, request_occurrence_id: request.request_occurrence_id ?? null }] : []),
    ...workerStops(posts).filter(stop => stop.worker_id !== latest.worker_id),
  ];
  return { reached: 'worker', stopped_at: 'worker', because: workerBecause(latest), stop_reason: WORKER_STOP_REASON, ...(additional.length ? { additional_stops: additional } : {}) };
}

// "no write" is scoped to the credited request when an aborted request of the
// same action wrote (its effect is the action's; fix/client-aborts).
function siblingWrites(record) {
  const writes = (record?.aborted_request_effects || []).filter(entry => entry.writes.length);
  if (!writes.length) return 'no write';
  return `no write under this request; an aborted request of this action wrote (${writes.map(entry => `${[...new Set((entry.ops || []).filter(op => op.write).map(dbOpText))].join(', ') || entry.writes.join(', ')} by ${entry.method} ${entry.path}`).join('; ')})`;
}

function baseFrontier(record, { backendInstrumented = true } = {}) {
  const chain = Array.isArray(record?.chain) ? record.chain : [];
  const has = kind => chain.some(step => step.kind === kind);
  const request = chain.find(step => step.kind === 'network.request') || null;
  const dbs = chain.filter(step => step.kind === 'db.operation');
  const writes = dbs.filter(step => /^(?:insert|update|delete|remove|replace|findandmodify|bulk)/iu.test(String(step.operation || '')));
  // The request's terminal handler when middleware, a param callback or an
  // error middleware ended it (fix/middleware-reads; needs the backend's
  // response-writer mark, so older stores never take this branch).
  const route = chain.find(step => step.kind === 'route.dispatch') || null;
  const ender = route && !record?.terminal?.pending ? terminalMiddleware(route, chain.filter(step => step.kind === 'handler.enter')) : null;
  const reached = dbs.length ? 'db' : has('handler.enter') ? 'handler' : ender ? 'middleware' : has('route.dispatch') ? 'route' : request ? 'request'
    : has('submit.rejected') ? 'validation' : has('dom.mutation') ? 'dom_mutation' : record?.entry_handler ? 'entry_handler' : 'dispatch';
  if (record?.terminal?.pending) return { reached, stopped_at: reached, because: 'evidence still arriving (episode not idle)', stop_reason: 'pending' };
  if (ender) return { reached, stopped_at: 'middleware', because: ender.because, stop_reason: 'ended_by_middleware', responded_by: ender.responded_by, text: ender.text };
  // Reads by app-level middleware / param callbacks alone are preconditions:
  // no terminal effect is claimed (ruling 2026-09-24).
  const preconditions = preconditionsOnly(dbs, route);
  if (preconditions) return { reached, stopped_at: has('handler.enter') ? 'handler' : 'route', because: preconditions.because, stop_reason: 'preconditions_only' };
  if (dbs.length) {
    const last = headlineOp(dbs, route);
    return { reached, stopped_at: null, because: writes.length
      ? `database write ${dbOpText(last)} joined by exact span parentage`
      : `database read ${dbOpText(last)} joined by exact span parentage; ${siblingWrites(record)}`, stop_reason: null };
  }
  if (request && !backendInstrumented) return { reached, stopped_at: 'network', because: 'backend not instrumented', stop_reason: 'backend_not_instrumented' };
  const reason = record?.terminal?.stop_reason || null;
  // A request whose signal was already aborted never left the page.
  if (request && !has('route.dispatch') && request.signal_aborted_at_call === true) return { reached, stopped_at: 'network', because: 'the request never left the page (its signal was already aborted when fetch was called)', stop_reason: 'never_sent' };
  if (request && !has('route.dispatch')) {
    const diagnostic = chain.find(step => step.kind === 'span.join.diagnostic');
    return { reached, stopped_at: 'network', because: diagnostic?.reason === 'multiple_exact_parent_servers'
      ? 'more than one server span claims the exact parent; abstained' : FRONTIER_BECAUSE_OF().no_exact_parent_server_before_idle, stop_reason: diagnostic?.reason || reason };
  }
  if (has('route.dispatch') && !has('handler.enter')) return { reached, stopped_at: 'route', because: 'no registered handler span descends from the server span', stop_reason: reason };
  if (has('handler.enter')) return { reached, stopped_at: 'handler', because: FRONTIER_BECAUSE_OF().no_database_effect_before_idle, stop_reason: reason };
  // Frontend credit abstention (G1 D-G1-6): no element- or form-bound handler
  // ran for an action that made no request. Named `entry_handler` so it can
  // never be read as the backend `handler` stop.
  if (!request && !has('submit.rejected') && record?.handler_abstention) return { reached, stopped_at: 'entry_handler',
    because: record.handler_abstention.because, stop_reason: record.handler_abstention.closed_shadow ? 'closed_shadow_target' : record.handler_abstention.stop_reason || 'no_element_bound_handler' };
  // No request from instrumented code: the frontier is the browser, and the
  // sentence says what Tracer cannot see. `reached` still names the deepest
  // observed stop (dom_mutation, entry_handler or dispatch).
  if (reached === 'validation') return { reached, stopped_at: 'validation', because: FRONTIER_BECAUSE_OF().submit_rejected_by_app, stop_reason: reason };
  return { reached, stopped_at: 'browser', because: SCOPED_ABSENCE.no_request, stop_reason: reason };
}

// ---- Server-to-server hops (fix/server-outbound) ---------------------------
// One builder renders a request's hops for every reader: the MCP segments,
// the episode chain (viewer, exported chains) and described server spans
// (unlinked listings). Hop rows come from `serverHops` (exact traceparent
// joins); this only orders, words and caps them.

/** Hops deeper than this are not rendered inline (they stay in `hops`). */
export const HOP_DEPTH_SHOWN = 3;
/** At most this many hop lines inline, then "+N more hops". */
export const HOP_LINES_SHOWN = 6;
// Tracer cannot tell an uninstrumented receiver from one it never reached
// (or one reporting elsewhere), so the sentence never asserts which.
export const HOP_NO_INCOMING = 'no incoming span for this traceparent (not instrumented, or not reached)';
// The two disclosed cases that also end here (G4 §3.4): named so an agent does not read only "not instrumented".
export const HOP_NO_INCOMING_HINT = 'also possible: the app replaced the traceparent after the request was created, or a second OpenTelemetry SDK sent another one';
export const HOP_APP_TRACEPARENT = 'traceparent set by the app; receiving span not linked by Tracer';
export const HOP_BODIES = 'not recorded for server-to-server hops';

const hopOrder = (left, right) => {
  const a = String(left.hop).split('.').map(Number); const b = String(right.hop).split('.').map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if (a[index] === undefined) return -1; if (b[index] === undefined) return 1;
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
};

/** Why a hop was not followed (a stated frontier), from the client span and the join only. */
export function hopFrontier(hop) {
  if (hopFollowed(hop)) return null;
  if (hop.join === 'multiple_exact_parent_servers') return 'more than one server span claims this outbound span; abstained';
  if (hop.join === 'method_mismatch') return `a server span continues this outbound span but with another method; not joined (method ${hop.method})`;
  const noResponse = hop.client_error && hop.client_status_code == null ? `no response (${hop.client_error}); ` : '';
  if (hop.join === 'app_traceparent_unlinked') return `${noResponse}${HOP_APP_TRACEPARENT}`;
  return `${noResponse}${HOP_NO_INCOMING}${noResponse ? '' : `; ${HOP_NO_INCOMING_HINT}`}`;
}

/** One hop in words: `outbound POST /x (from handler h) → server /x 200 → handler n → db insert c`, or its frontier. */
export function hopText(hop, { label = false } = {}) {
  const joined = hopFollowed(hop);
  const target = joined ? pathOf(hop.url) : (hop.url || '?');
  const issuer = hop.issued_by;
  const notes = [issuer?.name ? `from ${ISSUER_KIND_LABELS[issuer.kind] || issuer.kind || 'handler'} ${issuer.name}` : null,
    hop.after_response_ms != null ? `sent ${hop.after_response_ms} ms after the response` : null,
    joined && hop.join === 'app_traceparent' ? 'followed by the traceparent the app set' : null].filter(Boolean);
  const head = `${label ? `hop ${hop.hop}: ` : ''}outbound ${hop.method || '?'} ${target}${!joined && hop.client_status_code != null ? ` ${hop.client_status_code}` : ''}${notes.length ? ` (${notes.join('; ')})` : ''}`;
  if (!joined) return `${head} → ${hopFrontier(hop) || `not joined (${hop.join})`}`;
  const server = hop.server;
  const service = server.service_name && server.service_name !== hop.parent_service_name ? `${server.service_name} ` : '';
  const parts = [head, `server ${service}${server.route || pathOf(hop.url)}${server.status_code != null ? ` ${server.status_code}` : ''}`];
  if (server.handler_spans?.length) parts.push(`handler ${server.handler_spans.map(handler => handler.name || '?').join(',')}`);
  // Each operation names its issuer, as a request's own do (`db insert x (handler: notify)`, `(issuer: unknown)`).
  if (server.db_ops?.length) parts.push(`db ${dbOpsText(server.db_ops).join(', ')}`);
  return parts.join(' → ');
}

/**
 * The hops of one request (or one described server span), depth-first in
 * start order: `hops` (every hop, each with its `summary`), `escaped_hops`
 * (every hop not followed: no incoming span for its traceparent, or an
 * abstained join) and `text` (the inline rendering: at most HOP_LINES_SHOWN
 * lines no deeper than HOP_DEPTH_SHOWN, then "+N more hops"). Accepts
 * `server.hop` rows or `serverHops` entries.
 */
export function hopSegments(rows) {
  const list = (rows || []).filter(row => row && row.hop != null && (row.kind === undefined || row.kind === 'server.hop')).sort(hopOrder);
  const label = list.length > 1;
  const hops = list.map(row => {
    const { schema: _schema, sequence: _sequence, timestamp: _timestamp, kind: _kind, id: _id, predicate: _predicate, admission_reason: _reason, evidence_ids: _evidence, ...hop } = row;
    return { ...hop, bodies: HOP_BODIES, summary: hopText(hop), ...(hopFollowed(hop) ? {} : { because: hopFrontier(hop) }) };
  });
  const shown = hops.filter(hop => hop.depth <= HOP_DEPTH_SHOWN).slice(0, HOP_LINES_SHOWN);
  const deeper = hops.filter(hop => hop.depth > HOP_DEPTH_SHOWN).length;
  const more = hops.length - shown.length;
  const text = hops.length ? `${shown.map(hop => hopText(hop, { label })).join('; ')}${more
    ? `; +${more} more hop${more === 1 ? '' : 's'}${deeper ? ` (${deeper} deeper than ${HOP_DEPTH_SHOWN})` : ''} (see hops)` : ''}; bodies: ${HOP_BODIES}` : '';
  const escaped = hops.filter(hop => !hopFollowed(hop)).map(hop => ({ hop: hop.hop, span_id: hop.span_id, trace_id: hop.trace_id, method: hop.method, url: hop.url,
    issued_by: hop.issued_by, client_status_code: hop.client_status_code, client_error: hop.client_error, join: hop.join,
    ...(hop.traceparent_set_by_app ? { traceparent_set_by_app: true } : {}), because: hop.because, bodies: HOP_BODIES, summary: hop.summary }));
  return { hops, escaped_hops: escaped, text, total: hops.length, shown: shown.length };
}

const unfollowedHopSteps = chain => (Array.isArray(chain) ? chain : []).filter(step => step?.kind === 'server.hop' && !hopFollowed(step)).sort(hopOrder);
export const SERVER_HOP_STOP_REASON = 'server_hop_unfollowed';
export const SERVER_HOP_ESCAPE_LABEL = 'a further server-side hop may have escaped';
/**
 * "a further server-side hop may have escaped: N hop(s) not followed: M with no
 * receiving span, K with more than one (POST http://…, …)", counted per join kind.
 */
export function hopEscapeClause(steps) {
  const count = predicate => steps.filter(predicate).length;
  const parts = [[count(hop => hop.join === 'no_incoming_span' || hop.join === 'app_traceparent_unlinked'), 'with no receiving span'],
    [count(hop => hop.join === 'multiple_exact_parent_servers'), 'with more than one'],
    [count(hop => hop.join === 'method_mismatch'), 'with a receiving span of another method'],
    [count(hop => !['no_incoming_span', 'app_traceparent_unlinked', 'multiple_exact_parent_servers', 'method_mismatch'].includes(hop.join)), 'not joined']]
    .filter(([n]) => n > 0).map(([n, text]) => `${n} ${text}`);
  return `${SERVER_HOP_ESCAPE_LABEL}: ${steps.length} hop(s) not followed: ${parts.join(', ')} (${steps.map(hop => `${hop.method || '?'} ${hop.url || '?'}`).join(', ')})`;
}
/** Additional frontier stops, one per escaped hop of a chain's `server.hop` steps. */
function escapedHopStops(chain) {
  return unfollowedHopSteps(chain)
    .map(hop => ({ reached: 'outbound', stopped_at: 'network', because: hopText(hop), stop_reason: `outbound_${hop.join}`, hop: hop.hop,
      span_id: hop.span_id, request_occurrence_id: hop.request_occurrence_id ?? null }));
}

const hopNote = row => (row?.hop ? ` (hop ${row.hop}: ${row.hop_method || ''} ${pathOf(row.hop_path)})`.replace(/ {2,}/gu, ' ') : '');

// ---- Outcome labels (fix/outcome-labels) ---------------------------------
// One function computes an action's outcome label set. Every reader prints
// its words: the MCP (action, segments, summaries), the chain's `display`
// (live viewer) and exported action chains. See docs/gates/G4-mcp.md.

export const OUTCOME_STATUSES = Object.freeze(['pending', 'rejected_client_side', 'aborted_by_client', 'failed', 'completed', 'responded', 'stopped', 'opened', 'no_request']);
export const NO_EFFECT_NOTE = 'no effect evidence';
export const HANDLER_RAN_NO_REQUEST = 'the handler ran and issued no request from instrumented code';
export const NOTHING_RAN_NO_REQUEST = 'no instrumented function ran for this action';
// First reason wins; `signals` keeps all of them.
const REASON_ORDER = ['handler_threw', 'promise_rejected', 'form_validation'];
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
const WRITE = /^(?:insert|update|delete|remove|replace|findandmodify|bulk)/iu;
const pathOf = url => { try { return new URL(String(url), 'http://tracer.invalid').pathname; } catch { return String(url); } };

/**
 * What the app itself did during an episode, from its rows only (the counts
 * a `no_request` label reports, and the recorded reject signals).
 *  - functions_entered: action-owned `function.enter` rows (instrumented code)
 *  - dom_mutations: the sum of the actions' DOM mutation receipt counts
 *  - state_effects: action-owned `function.enter` rows invoked by an effect
 *    (effects run under a state-update receipt; renders are never owned)
 *  - uncaught_errors: `action.uncaught_error` rows (joined by error identity)
 *  - invalid_form_dispatches: submit-capable `dom.action` rows with `form_invalid`
 */
/**
 * The type of a thrown value, never a minified name passed off as a source
 * name: `{ minified, source, source_basis }`. `minified` is the runtime
 * constructor name the row recorded (it may have been renamed by a minifier);
 * `source` is the name the source gives the class — from the build's manifest
 * when the row carries the instrumented class's id (`error_class_id`), or the
 * platform's own name when the constructor is that global (`error_builtin`),
 * else null.
 */
export function errorTypeOf(row, errorClassName = null) {
  if (!row || row.error_type == null) return null;
  if (typeof row.error_type === 'object') return row.error_type;
  const fromManifest = typeof row.error_class_id === 'string' && typeof errorClassName === 'function' ? errorClassName(row.error_class_id) : null;
  if (fromManifest) return { minified: row.error_type, source: fromManifest, source_basis: 'manifest' };
  if (row.error_builtin === true) return { minified: row.error_type, source: row.error_type, source_basis: 'builtin' };
  return { minified: row.error_type, source: null, source_basis: typeof row.error_class_id === 'string' ? 'class_not_in_manifest' : 'not_recorded' };
}
/** Text for an error type: the source name, else the runtime name marked as such. */
export const errorTypeText = type => (!type ? null : typeof type === 'string' ? `runtime type ${type}` : type.source || `runtime type ${type.minified}`);

export function appEvidence(rows, actionIds, { errorClassName = null } = {}) {
  const ids = actionIds instanceof Set ? actionIds : new Set(actionIds || []);
  const own = (Array.isArray(rows) ? rows : []).filter(row => row && ids.has(row.action_id));
  const enters = own.filter(row => row.kind === 'function.enter');
  return {
    functions_entered: enters.length,
    dom_mutations: own.filter(row => row.kind === 'dom.mutation').reduce((sum, row) => sum + (Number.isFinite(Number(row.count)) && Number(row.count) > 0 ? Number(row.count) : 1), 0),
    state_effects: enters.filter(row => row.invoked_by === 'effect').length,
    uncaught_errors: own.filter(row => row.kind === 'action.uncaught_error').map(row => ({ action_id: row.action_id, via: row.via ?? null,
      error_type: errorTypeOf(row, errorClassName), function_id: row.function_id ?? null, sequence: row.sequence ?? null })),
    invalid_form_dispatches: own.filter(row => row.kind === 'dom.action' && row.form_invalid === true).map(row => ({ action_id: row.action_id,
      event: row.event ?? null, form_ref: row.form_ref ?? null, sequence: row.sequence ?? null })),
    submit_dispatches: own.filter(row => row.kind === 'dom.action' && row.event === 'submit').map(row => ({ action_id: row.action_id,
      form_ref: row.form_ref ?? null, sequence: row.sequence ?? null })),
  };
}

function rejectSignals(chain, evidence) {
  // form_invalid counts only when the browser validated and nothing was
  // submitted after it on that form (a later submit means validation passed
  // or was bypassed). The runtime already never marks a submit dispatch.
  const submits = evidence?.submit_dispatches || [];
  const invalid = (evidence?.invalid_form_dispatches || []).filter(row => row.event !== 'submit'
    && !submits.some(submit => Number(submit.sequence) > Number(row.sequence) && (!row.form_ref || !submit.form_ref || submit.form_ref === row.form_ref)));
  const signals = [
    ...(evidence?.uncaught_errors || []).map(row => ({ reason: row.via === 'unhandled_rejection' ? 'promise_rejected' : 'handler_threw', via: row.via,
      action_id: row.action_id, error_type: row.error_type, function_id: row.function_id, sequence: row.sequence })),
    ...chain.filter(step => step.kind === 'submit.rejected').map(step => ({ reason: 'form_validation', via: 'submit_rejected', action_id: step.action_id,
      evidence_ids: step.evidence_ids || [] })),
    ...invalid.map(row => ({ reason: 'form_validation', via: 'form_invalid_at_dispatch', action_id: row.action_id,
      event: row.event, sequence: row.sequence })),
  ];
  return signals.sort((left, right) => REASON_ORDER.indexOf(left.reason) - REASON_ORDER.indexOf(right.reason));
}

const signalDetail = signal => signal.reason === 'handler_threw' ? `${errorTypeText(signal.error_type) || 'an error'} thrown by action-owned code escaped uncaught`
  : signal.reason === 'promise_rejected' ? `a promise of action-owned code rejected with ${errorTypeText(signal.error_type) || 'an error'}, unhandled`
    : signal.via === 'submit_rejected' ? 'the same form mutated after the submit'
      : 'the browser validated the form and found it invalid (:invalid, no novalidate/formnovalidate) and no submit followed';
const signalShort = signal => `${signal.reason}${signal.error_type ? ` (${errorTypeText(signal.error_type)})` : ''}`;
/** Signals worth stating next to a response: crashes only (a validation word never sits next to a response), deduplicated. */
const crashTexts = signals => [...new Set(signals.filter(signal => signal.reason !== 'form_validation').map(signalShort))];

/**
 * The operation a label or a frontier names: the last write, else the last
 * read that is not a precondition, else the last read, preferring those issued
 * by a route handler (the code the request was routed to), in the rows' own
 * order. Same rule for every surface.
 */
export function headlineOp(ops, route = null) {
  const all = Array.isArray(ops) ? ops : [];
  // The request's own operations first; a hop's (fix/server-outbound) only when it has none.
  const own = all.filter(op => !op?.hop);
  const list = own.length ? own : all;
  const writes = list.filter(op => WRITE.test(String(op?.operation || '')));
  const pick = rows => rows.filter(op => op?.issuer?.kind === 'handler').at(-1) || rows.at(-1) || null;
  return pick(writes) || pick(list.filter(op => !isPrecondition(op, route))) || pick(list);
}

/**
 * One database operation as every surface prints it: `find users (middleware: auth)`.
 * Rows joined before issuers existed (no `issuer`) print without the suffix.
 */
export function dbOpText(op) {
  const base = `${op?.operation || 'operation'} ${op?.collection || 'unknown collection'}`;
  const issued = op?.issuer || op?.issued_by ? ` (${op.issued_by || issuerText(op.issuer)})` : '';
  return `${base}${issued}${hopNote(op)}`;
}

/** A segment's operations for a summary, grouped by operation, collection and issuer: `find items ×3 (handler: listItems)`. */
export function dbOpsText(ops) {
  const counts = new Map();
  for (const op of ops || []) {
    const base = `${op?.operation} ${op?.collection}`;
    const suffix = op?.issuer || op?.issued_by ? ` (${op.issued_by || issuerText(op.issuer)})` : '';
    const key = `${base}\u0000${suffix}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts].map(([key, count]) => { const [base, suffix] = key.split('\u0000'); return `${base}${count > 1 ? ` ×${count}` : ''}${suffix}`; });
}

// HTTP semantics (generic, RFC 9110): which responses may be called completed.
export const SAFE_METHODS = Object.freeze(['GET', 'HEAD', 'OPTIONS', 'TRACE']);
export const NO_WRITE_NOTE = 'no write observed';
export const NO_WRITE_HERE_NOTE = 'no write observed under this request';
export const NOT_FINAL_3XX_NOTE = 'redirect or not-modified status on this method; completion not claimed';

/**
 * The label of one request from its own joined steps (no signals, no other
 * requests): `aborted_by_client | failed | completed | responded | stopped | pending`.
 *  - aborted by the page (the runtime's network.abort fact): aborted_by_client,
 *    whatever the server answered (kept as server_status).
 *  - >= 400: failed.
 *  - 2xx, safe method (GET/HEAD/OPTIONS/TRACE): completed with any joined
 *    database span (a read is the terminal join), else responded.
 *  - 2xx, unsafe method (POST/PUT/PATCH/DELETE/…): completed only with a joined
 *    write span; reads only → responded "no write observed"; none → responded.
 *  - 304 on a safe method: as a 2xx on a safe method ("Completed 304").
 *    Any other 3xx, and any 3xx on an unsafe method: responded.
 *  - no status: stopped at the frontier.
 */
function responseOutcome(steps, frontier) {
  const outcome = responseOutcomeBase(steps, frontier);
  const request = steps.find(step => step.kind === 'network.request') || null;
  // The page aborted after the response had reached it: its own fact; the label stays the server's.
  if (request?.abort_after_response === true && outcome.status !== 'aborted_by_client') {
    const text = afterResponseText(request);
    return { ...outcome, abort_after_response: true, after_response_text: text, label: `${outcome.label}${AFTER_RESPONSE_LABEL}`, sentence: `${outcome.sentence}; ${text}` };
  }
  // The page aborted after the response reached it while the app consumed the body in a way whose end is not recorded.
  if (request?.abort_state === 'undetermined' && outcome.status !== 'aborted_by_client') {
    const text = `${AFTER_RESPONSE_ABORT} while the app was consuming the body through ${request.body_read_via || 'a stream'}(); whether that finished before the abort is not recorded`;
    return { ...outcome, abort_undetermined: true, after_response_text: text, sentence: `${outcome.sentence}; ${text}` };
  }
  return outcome;
}
export const AFTER_RESPONSE_LABEL = '; aborted by the page after the response';
export const AFTER_RESPONSE_ABORT = 'the page aborted the request after the response reached it';
function afterResponseText(request) {
  if (request.body_read_cancelled_by_app) return `${AFTER_RESPONSE_ABORT} (status and headers); the app had already cancelled its body read${request.body_read_via ? ` (${request.body_read_via})` : ''}`;
  if (request.body_read_started === true) return `${AFTER_RESPONSE_ABORT} (status and headers); the app's body read${request.body_read_via ? ` (${request.body_read_via})` : ''} had already failed${request.body_read_error_type ? ` (${request.body_read_error_type})` : ''}, not because of the abort`;
  return `${AFTER_RESPONSE_ABORT} (status and headers); the app had not started reading the body, and the unread body was discarded (whether the body had fully arrived is not recorded)`;
}
function responseOutcomeBase(steps, frontier) {
  const request = steps.find(step => step.kind === 'network.request') || null;
  const route = steps.find(step => step.kind === 'route.dispatch') || null;
  const dbs = steps.filter(step => step.kind === 'db.operation');
  const code = route && route.status_code != null && route.status_code !== '' ? Number(route.status_code) : NaN;
  const http = Number.isFinite(code) ? code : null;
  const method = String(request?.method || 'GET').toUpperCase(); const path = pathOf(request?.url);
  const safe = SAFE_METHODS.includes(method);
  const writes = dbs.filter(step => WRITE.test(String(step.operation || '')));
  const target = `${method} ${path}`;
  // The page aborted it: that wins over whatever the server answered, which is kept as its own fact.
  if (isClientAborted(request)) return abortedOutcome(request, { http, dbs, writes, method, path, target, route, frontier });
  if (http != null && http >= 400) return { status: 'failed', http_status: http, method, path, label: `Failed ${http}: ${target}`, sentence: `server responded ${http} to ${target}` };
  const success = http != null && ((http >= 200 && http < 300) || (http === 304 && safe));
  if (success) {
    // Safe methods: work after the preconditions (ruling 2026-09-24); any write counts.
    const effectRows = safe ? dbs.filter(op => !isPrecondition(op, route)) : writes;
    if (effectRows.length) {
      const last = headlineOp(effectRows, route);
      // The label names the issuer unless it is the route handler (the
      // default reading of "Completed: insert items"); the sentence always does.
      // A hop's operation always names its hop.
      const effect = `${last.operation || 'operation'} ${last.collection || 'unknown collection'}${hopNote(last)}`;
      const shown = (!last.issuer || last.issuer.kind === 'handler') ? effect : dbOpText(last);
      return { status: 'completed', http_status: http, method, path, label: `Completed ${http}: ${shown}`,
        effect: { operation: last.operation ?? null, collection: last.collection ?? null, write: writes.length > 0, ...(last.issuer ? { issuer: last.issuer, issued_by: last.issued_by ?? issuerText(last.issuer) } : {}), ...(last.hop ? { hop: last.hop } : {}) },
        sentence: `server responded ${http} to ${target}; database ${writes.length ? 'write' : 'read'} ${dbOpText(last)} joined under the request` };
    }
    if (safe && dbs.length) {
      const pre = preconditionsOnly(dbs, route);
      return { status: 'responded', http_status: http, method, path, note: PRECONDITIONS_NOTE, preconditions: pre.text,
        label: `Responded ${http}: ${pre.because}`, sentence: `server responded ${http} to ${target}; ${pre.because}` };
    }
    const note = dbs.length ? NO_WRITE_NOTE : NO_EFFECT_NOTE;
    return { status: 'responded', http_status: http, method, path, note, label: `Responded ${http}: ${note}`,
      sentence: dbs.length ? `server responded ${http} to ${target}; only database reads joined under the request (${NO_WRITE_NOTE})`
        : `server responded ${http} to ${target}; no database span joined under the request (${NO_EFFECT_NOTE})` };
  }
  if (http != null && http >= 300 && http < 400) return { status: 'responded', http_status: http, method, path, note: NOT_FINAL_3XX_NOTE,
    label: `Responded ${http}: ${NOT_FINAL_3XX_NOTE}`, sentence: `server responded ${http} to ${target} (${NOT_FINAL_3XX_NOTE})` };
  return { status: 'stopped', http_status: http, method, path, stopped_at: frontier.stopped_at, because: frontier.because,
    label: stoppedLabel(frontier, steps), sentence: `stopped at ${frontier.stopped_at}: ${frontier.because}` };
}

export const ABORTED_BY_PAGE = 'aborted by the page before the response was read';
const ABORT_PHASE = {
  before_response_headers: 'before the response headers arrived',
  while_reading_body: 'after the response headers arrived, while its body was being read',
};
/** The phase clause of an aborted request, from the recorded fields only. */
function abortPhase(request) {
  if (request.aborted_at === 'while_reading_body') return request.body_read_started === false
    ? 'after the response headers arrived, before the app read the body' : request.body_read_started === true
      ? `after the response headers arrived, while the app was reading the body${request.body_read_via ? ` (${request.body_read_via})` : ''}` : ABORT_PHASE.while_reading_body;
  if (request.signal_aborted_at_call) return 'the signal was already aborted: the request was never sent';
  return ABORT_PHASE[request.aborted_at] || 'phase not recorded';
}
const abortReasonText = reason => {
  if (!reason) return null;
  const parts = [reason.name, reason.reason_type && reason.reason_type !== 'DOMException' ? `reason ${reason.reason_type}` : null].filter(Boolean);
  return parts.length ? parts.join(', ') : reason.via === 'XMLHttpRequest.abort' ? 'XMLHttpRequest.abort()'
    : reason.via === 'xhr_abort_event_without_abort_call' ? 'the XHR fired abort without an abort() call (e.g. window.stop())' : null;
};
/**
 * `aborted_by_client`: the page aborted the request (recorded by the runtime
 * from the signal and the rejection identity). The server's answer, when a
 * server span joined, is kept as `server_status` and stated, never as the
 * action's status.
 */
function abortedOutcome(request, { http, dbs, writes, method, path, target, route, frontier }) {
  // The server's work, named with its issuer (fix/middleware-reads): the same headline op as every surface.
  const last = dbs.length ? headlineOp(dbs, route) : null;
  const effect = last ? ` and ${WRITE.test(String(last.operation || '')) ? 'wrote' : 'read'} ${dbOpText(last)}` : '';
  const server = http != null ? `the server answered ${http}${effect}`
    : frontier?.stop_reason === 'backend_not_instrumented' ? "the server's answer is not recorded (backend not instrumented)"
      : route ? `a server span joined without a status${effect}` : request.signal_aborted_at_call ? 'no server span (the request never left the page)'
        : `no server span joined (${frontier?.because || 'no exact-parent server span'})`;
  const reason = abortReasonText(request.abort_reason);
  return { status: 'aborted_by_client', http_status: null, server_status: http, method, path, aborted_at: request.aborted_at ?? null,
    server_effect: effect.replace(/^ and /u, '') || null,
    server_writes: [...new Set(writes.map(dbOpText))],
    server_reads: [...new Set(dbs.filter(step => !writes.includes(step)).map(dbOpText))],
    abort_reason: request.abort_reason ?? null, body_read_started: request.body_read_started ?? null,
    label: `Aborted by the page: ${target}${http != null ? `; the server answered ${http}` : ''}`,
    sentence: `${ABORTED_BY_PAGE}: ${target} (${abortPhase(request)}${reason ? `; ${reason}` : ''}); ${server}` };
}

/** Other requests of the episode whose status differs from the headline (every failure and every abort is listed), grouped. */
function otherRequests(record, headlineRequest, headlineStatus, backendInstrumented) {
  const groups = new Map();
  for (const steps of record?.request_steps || []) {
    const request = steps.find(step => step.kind === 'network.request');
    const same = headlineRequest && (headlineRequest.request_occurrence_id
      ? request.request_occurrence_id === headlineRequest.request_occurrence_id
      : request.sequence === headlineRequest.sequence && request.action_id === headlineRequest.action_id);
    if (!request || same) continue;
    const own = responseOutcome(steps, chainFrontier({ chain: steps, terminal: {} }, { backendInstrumented }));
    if (own.status === headlineStatus && own.status !== 'failed' && own.status !== 'aborted_by_client') continue;
    // An aborted request's server answer and its effect stay stated (the server did the work).
    const text = own.status === 'aborted_by_client' ? `aborted_by_client ${own.method} ${own.path} (${own.server_status != null ? `server answered ${own.server_status}${own.server_effect ? ` and ${own.server_effect}` : ''}` : 'no server status'})`
      : `${own.status === 'stopped' ? `stopped at ${own.stopped_at}` : `${own.status}${own.http_status != null ? ` ${own.http_status}` : ''}`} ${own.method} ${own.path}`;
    const entry = groups.get(text) || { status: own.status, http_status: own.http_status, ...(own.status === 'aborted_by_client' ? { server_status: own.server_status, aborted_at: own.aborted_at,
      server_writes: own.server_writes, server_reads: own.server_reads } : {}),
      method: own.method, path: own.path, count: 0, request_occurrence_ids: [], text };
    entry.count += 1; entry.request_occurrence_ids.push(request.request_occurrence_id ?? null); groups.set(text, entry);
  }
  return [...groups.values()].map(entry => ({ ...entry, text: entry.count > 1 ? `${entry.text} ×${entry.count}` : entry.text }));
}

/**
 * The outcome label set of one chain (an episode chain or one request
 * segment), from its steps only:
 * `pending | rejected_client_side | aborted_by_client | failed | completed | responded | stopped | no_request`.
 * `aborted_by_client` (a request the page aborted) wins over the server's
 * status for that request, which stays `server_status`; an aborted request is
 * never the credited one while a request the page did not abort exists.
 * `record` = { chain, terminal, entry_handler?, handler_abstention?, app_evidence?, request_steps? }.
 * The chain's credited request (the engine's: the latest request with a joined
 * write, else the last request) decides the headline; every other request in
 * `request_steps` whose status differs (and every other failure) is stated in
 * `label`, `sentence` and `outcomeText` as "also …". Never guesses: a reject
 * needs a recorded signal; `completed` follows the HTTP rule in responseOutcome.
 */
export function actionOutcome(record, { backendInstrumented = true } = {}) {
  const chain = Array.isArray(record?.chain) ? record.chain : [];
  const request = chain.find(step => step.kind === 'network.request') || null;
  const signals = rejectSignals(chain, record?.app_evidence);
  if (record?.terminal?.pending) {
    const route = chain.find(step => step.kind === 'route.dispatch');
    const code = route?.status_code != null && route.status_code !== '' ? Number(route.status_code) : NaN;
    return { status: 'pending', label: record.terminal.label || 'Pending: evidence still arriving', http_status: Number.isFinite(code) ? code : null, sentence: 'evidence still arriving (episode not idle)' };
  }
  const withOthers = (outcome, suffixLabel = '') => {
    const others = otherRequests(record, request, outcome.status, backendInstrumented);
    if (!others.length) return outcome;
    const text = `; also ${others.map(entry => entry.text).join(', ')}`;
    return { ...outcome, other_requests: others, also_text: `${outcome.also_text || ''}${text}`, label: `${outcome.label}${suffixLabel}${text}`, sentence: `${outcome.sentence}${text}` };
  };
  // Never without a recorded signal: the engine's rejected stage always
  // carries its submit.rejected step, and anything else needs a signal row.
  // Recorded requests that left the page in a request-less window: in the
  // headline (label, sentence, bracket), never only in the scoped tail.
  const windowClause = request ? null : windowRequestsClause(record?.window_evidence);
  const windowFields = windowClause ? { window_text: windowClause } : {};
  if ((record?.terminal?.stage === 'rejected' || !request) && signals.length) {
    const first = signals[0];
    const hasOthers = (record?.request_steps || []).length > 0;
    return withOthers({ status: 'rejected_client_side', reason: first.reason, signals, http_status: null, ...windowFields,
      label: `Rejected by the app: ${signalShort(first)}; ${hasOthers ? 'the rejected action sent no request' : 'no request'}${windowClause ? `; ${windowClause}` : ''}`,
      sentence: `rejected by the app (${first.reason}): ${signalDetail(first)}; ${windowClause ? `${NO_REQUEST_CAVEATED}; ${windowClause}` : SCOPED_ABSENCE.no_request}` });
  }
  const frontier = chainFrontier(record, { backendInstrumented });
  if (request) {
    let own = responseOutcome(chain, frontier);
    // The server effects of the action's other, aborted requests are the
    // action's effects too (the server did the work): stated, and a "no write"
    // note is scoped to the credited request when one of them wrote.
    const abortedEffects = abortedRequestEffects(record?.request_steps, request);
    const abortedWrites = [...new Set(abortedEffects.flatMap(entry => entry.writes))];
    if (abortedEffects.length) own = { ...own, aborted_request_effects: abortedEffects };
    if (abortedWrites.length && own.note === NO_WRITE_NOTE) own = { ...own, note: NO_WRITE_HERE_NOTE, label: own.label.replace(`: ${NO_WRITE_NOTE}`, `: ${NO_WRITE_HERE_NOTE}`),
      sentence: own.sentence.replace(`(${NO_WRITE_NOTE})`, `(${NO_WRITE_HERE_NOTE})`) };
    const crashes = crashTexts(signals);
    const crashText = crashes.length ? `; also ${crashes.join(', ')}` : '';
    // The status is the request's own response; an escaped hop is stated next to it.
    const lost = unfollowedHopSteps(chain);
    // Root spans in the window that could continue the request (fix/honest-coverage): one more reason, stated after the hops.
    const roots = backendInstrumented ? rootEscape(record?.window_roots) : null;
    const escapeText = [lost.length ? hopEscapeClause(lost) : null, roots ? `${lost.length ? 'also' : `${SERVER_HOP_ESCAPE_LABEL}:`} ${roots.clause}` : null].filter(Boolean).join('; ');
    const escape = escapeText ? { escape_text: escapeText } : {};
    const escapeLabel = escapeText ? `; ${SERVER_HOP_ESCAPE_LABEL}` : '';
    const { method: _method, path: _path, ...fields } = own;
    const outcome = withOthers({ ...fields, ...(signals.length ? { signals } : {}), ...(crashText ? { also_text: crashText } : {}), ...escape,
      label: `${own.label}${crashText}${escapeLabel}`, sentence: `${own.sentence}${crashText}${escapeText ? `; ${escapeText}` : ''}` });
    return withAppRead(outcome, record);
  }
  if (frontier.stopped_at === 'worker' || frontier.stopped_at === 'entry_handler' || frontier.stopped_at === 'websocket') return { status: 'stopped', http_status: null, ...windowFields,
    stopped_at: frontier.stopped_at, because: frontier.because, label: `${stoppedLabel(frontier, chain)}${windowClause && frontier.stopped_at !== 'entry_handler' ? `; ${windowClause}` : ''}`,
    sentence: `stopped at ${frontier.stopped_at}: ${frontier.because}` };
  // No request of its own, but it opened an element (a synthetic click on a
  // hidden file input) whose own event sent requests: say so, never no_request.
  const openedSent = (record?.opened || []).filter(entry => entry.requests?.length);
  if (openedSent.length) {
    const what = openedSent.map(entry => `its ${entry.event} (${entry.action_id}) sent ${entry.requests.map(request => `${request.method} ${request.url}`).join(', ')}`).join('; ');
    return { status: 'opened', http_status: null, opened: openedSent.map(entry => ({ action_id: entry.action_id, event: entry.event, requests: entry.requests })),
      label: `Opened another control: no request of its own; ${what}`, clause: what,
      sentence: `this action sent no request of its own; it activated another control with a synthetic click, and ${what}` };
  }
  const evidence = record?.app_evidence || { functions_entered: 0, dom_mutations: 0, state_effects: 0 };
  const did = { functions_entered: evidence.functions_entered || 0, dom_mutations: evidence.dom_mutations || 0, state_effects: evidence.state_effects || 0 };
  const ran = did.functions_entered > 0;
  const clause = `${ran ? HANDLER_RAN_NO_REQUEST : NOTHING_RAN_NO_REQUEST} (${plural(did.functions_entered, 'function')} entered, ${plural(did.dom_mutations, 'DOM mutation')}, ${plural(did.state_effects, 'state effect')})`;
  return { status: 'no_request', http_status: null, did, clause, ...windowFields,
    label: `No request: ${ran ? HANDLER_RAN_NO_REQUEST : NOTHING_RAN_NO_REQUEST}${windowClause ? `; ${windowClause}` : ''}`,
    sentence: `${clause}; ${windowClause ? `${NO_REQUEST_CAVEATED}; ${windowClause}` : SCOPED_ABSENCE.no_request}` };
}

/**
 * The joined database operations of an episode's aborted requests other than
 * `headline` (fix/client-aborts): `[{ request_occurrence_id, method, path,
 * server_status, writes, reads }]`, only for requests that joined any.
 */
export function abortedRequestEffects(requestSteps, headline) {
  const out = [];
  for (const steps of requestSteps || []) {
    const request = steps.find(step => step.kind === 'network.request');
    if (!isClientAborted(request) || (headline && request === headline) || (headline?.request_occurrence_id && request.request_occurrence_id === headline.request_occurrence_id)) continue;
    const dbs = steps.filter(step => step.kind === 'db.operation');
    if (!dbs.length) continue;
    const name = step => `${step.operation || 'operation'} ${step.collection || 'unknown collection'}`;
    const route = steps.find(step => step.kind === 'route.dispatch');
    const code = route?.status_code != null && route.status_code !== '' ? Number(route.status_code) : NaN;
    // `writes`/`reads` as the MCP's outcome lists them (operation collection); `ops` with each op's issuer.
    out.push({ request_occurrence_id: request.request_occurrence_id ?? null, method: String(request.method || 'GET').toUpperCase(), path: pathOf(request.url),
      server_status: Number.isFinite(code) ? code : null, writes: [...new Set(dbs.filter(step => WRITE.test(String(step.operation || ''))).map(name))],
      reads: [...new Set(dbs.filter(step => !WRITE.test(String(step.operation || ''))).map(name))],
      ops: dbs.map(step => ({ operation: step.operation ?? null, collection: step.collection ?? null, write: WRITE.test(String(step.operation || '')),
        ...(step.issuer ? { issuer: step.issuer, issued_by: step.issued_by ?? issuerText(step.issuer) } : {}) })) });
  }
  return out;
}

/**
 * Which response the app read, when the episode has aborted requests: stated
 * only from a recorded body read (`network.response_read`, merged onto the
 * request as `response_read_by_app`) of the last request the page did not
 * abort; otherwise the sentence says it is not recorded. Never inferred from
 * order or timing (fix/client-aborts, rule 4).
 */
function withAppRead(outcome, record) {
  const requests = (record?.request_steps || []).map(steps => steps.find(step => step.kind === 'network.request')).filter(Boolean);
  if (!requests.some(isClientAborted)) return outcome;
  const live = requests.filter(row => !isClientAborted(row));
  const last = live.at(-1) || null;
  if (!last) return { ...outcome, app_read: { request_occurrence_id: null, read: false, text: 'every request of this action was aborted by the page' } };
  const target = `${String(last.method || 'GET').toUpperCase()} ${pathOf(last.url)}`;
  const read = Boolean(last.response_read_by_app);
  const text = read ? `the last non-aborted request's response (${target}) was read by the app (${last.response_read_by_app.via || 'body'} read recorded)`
    : `which response the app rendered is not recorded (no body read recorded for ${target})`;
  return { ...outcome, app_read: { request_occurrence_id: last.request_occurrence_id ?? null, read, via: read ? last.response_read_by_app.via ?? null : null, text },
    sentence: `${outcome.sentence}; ${text}` };
}

/**
 * Every attributed request of an episode with its own exact joins (the
 * segment rule: by request_occurrence_id; without one, only an action's sole
 * request), in dispatch order. Feeds `request_steps` for mixed statuses.
 */
export function episodeRequestSteps(joined) {
  const order = (left, right) => Number(left?.timestamp || 0) - Number(right?.timestamp || 0) || Number(left?.sequence || 0) - Number(right?.sequence || 0);
  const requests = joined.filter(row => row.kind === 'network.request' && row.action_id && row.internal !== true && row.transport_internal !== true).sort(order);
  return requests.map(request => {
    const occurrence = request.request_occurrence_id ?? null;
    const sole = requests.filter(row => row.action_id === request.action_id).length === 1;
    const own = row => (occurrence ? row.request_occurrence_id === occurrence : (sole && !row.request_occurrence_id && row.action_id === request.action_id));
    return [request, ...joined.filter(row => row !== request && ['route.dispatch', 'handler.enter', 'db.operation', 'span.join.diagnostic', 'server.hop'].includes(row.kind) && own(row))];
  });
}

/** The frontier sentence of a request the page aborted (fix/client-aborts). */
export const abortedBecause = (code, because) => `the page aborted the request; ${code != null && code !== '' && Number.isFinite(Number(code)) ? `the server answered ${Number(code)}; ` : ''}${because}`;

const DEFERRED_FLOOR_MS = 1;

/** Kind of a runtime continuation id (`continuation:<action>:<kind>:<n>`), or null. */
export const continuationKindOf = id => /:([a-z_]+):\d+$/u.exec(String(id || ''))?.[1] ?? null;
// How a continuation kind reads in words (runtime kinds: timer, animation_frame,
// promise, await, microtask, state_effect, mount_effect, callback, stream).
const ISSUE_VIA = { timer: 'timer', animation_frame: 'animation_frame', promise: 'promise', await: 'promise', microtask: 'promise',
  state_effect: 'effect', mount_effect: 'effect', callback: 'callback', stream: 'callback' };

/**
 * Whether an attributed request was issued synchronously inside its action's
 * dispatch or later, on continuations the action owns (a timer, a promise or
 * await resumption, an effect), from identifiers only.
 *  - From the request row's `parent_continuation_id`, each `function`
 *    continuation is followed through the `function.enter` row that owns it
 *    (`enterByContinuation`) to its parent. Reaching the dispatch
 *    (`…:action:n`) with no other continuation: sent synchronously (null).
 *  - A non-function continuation (timer, promise, …) has no row of its own.
 *    The frame first entered on it (its spine = the creating frame's spine
 *    plus its own id) names the creating frame: the one `function.enter` row
 *    of the same action with exactly that shorter spine, entered before it.
 *    The walk continues from that frame; with none, or several such rows, it
 *    stops and says so (`reached_dispatch: false`, `continuations_stopped`).
 *    Limit: a resumption of that same frame (an `await` inside it) before it
 *    created the next continuation has the same spine and no row, so it is
 *    not listed; the list names the continuations identified, not all of them.
 * `via` names the continuation nearest the request (`basis: "nearest_continuation"`);
 * `continuations` lists every one found, outermost first, each with the time
 * its first frame ran. Times are row times minus the action's `dom.action` row
 * time (one page, one clock): a measure, never a join.
 */
export function issueDeferral(request, { dispatch = null, enterByContinuation = null, entersByAction = null } = {}) {
  if (!request?.action_id) return null;
  const start = Number(dispatch?.timestamp);
  const sameAction = dispatch && dispatch.action_id === request.action_id && Number.isFinite(start);
  const msOf = row => (sameAction && Number.isFinite(Number(row?.timestamp)) ? Number(row.timestamp) - start : null);
  const found = []; // nearest first
  let id = request.parent_continuation_id; let entered = null; let complete = false; let stopped = null;
  const seen = new Set();
  while (typeof id === 'string' && !seen.has(id) && seen.size < 512) {
    seen.add(id);
    const kind = continuationKindOf(id);
    if (kind === 'action') { complete = true; break; }
    if (kind === null) { stopped = 'continuation id not recognised'; break; }
    if (kind === 'function') {
      const enter = enterByContinuation?.get(id);
      if (!enter) { stopped = 'a function continuation has no recorded function.enter row'; break; }
      entered = enter; id = enter.parent_continuation_id; continue;
    }
    found.push({ kind, via: ISSUE_VIA[kind] || kind, continuation_id: id, ms_after_dispatch: msOf(entered || request) });
    // The creating frame's spine: a continuation copies its creator's spine, so it is the spine of the
    // first frame entered on it minus that frame's own id, or, when the request itself ran directly on it
    // (no first-party frame open), the request row's own spine.
    let prefix = null;
    if (entered) {
      const spine = Array.isArray(entered.spine?.function_ids) ? entered.spine.function_ids : null;
      if (spine?.length && spine.at(-1) === entered.function_id) prefix = spine.slice(0, -1);
    } else if (Array.isArray(request.spine?.function_ids)) prefix = request.spine.function_ids;
    if (!prefix) { stopped = `no recorded frame on the ${kind} continuation names its creator`; break; }
    if (!prefix.length) { stopped = `the ${kind} continuation was created with no first-party frame open`; break; }
    const before = Number((entered || request).sequence);
    const creators = (entersByAction?.get(request.action_id) || []).filter(row => Number(row.sequence) < before
      && Array.isArray(row.spine?.function_ids) && row.spine.function_ids.length === prefix.length && row.spine.function_ids.every((value, index) => value === prefix[index]));
    if (creators.length !== 1) { stopped = creators.length ? `${creators.length} recorded frames could have created the ${kind} continuation` : `the frame that created the ${kind} continuation is not recorded`; break; }
    entered = creators[0]; id = creators[0].continuation_id;
  }
  if (!found.length) return null;
  const nearest = found[0];
  const continuations = [...found].reverse();
  const ms = msOf(request);
  return { ms_after_dispatch: ms, via: nearest.via, continuation_kind: nearest.kind, continuation_id: nearest.continuation_id, dispatch_event: dispatch?.event ?? null,
    basis: 'nearest_continuation', continuations, reached_dispatch: complete, ...(stopped ? { continuations_stopped: stopped } : {}),
    basis_text: `via names the continuation nearest the request: its code ran on a ${nearest.kind} continuation of action ${request.action_id} (continuation ids); `
      + `${complete ? `the walk reached the dispatch through ${continuations.map(entry => entry.kind).join(' → ')} (creating frames matched by spine; an await resumption inside one of them would not be listed)` : `continuations before ${found.length > 1 ? 'the earliest listed one' : 'it'} are not identified (${stopped})`}`
      + `${ms === null ? '' : '; ms = row time minus the dispatch row time (browser clock)'}` };
}

const VIA_WORDS = { timer: 'a timer', promise: 'a promise continuation', effect: 'an effect', animation_frame: 'an animation frame', callback: 'a callback' };
const whenText = ms => (Number.isFinite(Number(ms)) ? (Number(ms) >= 1000 ? `${(Number(ms) / 1000).toFixed(1)} s` : `${Math.round(Number(ms))} ms`) : null);
/**
 * `sent 3.0 s after the click via a timer` when the one continuation is known
 * back to the dispatch; otherwise the nearest is named as such:
 * `sent 501 ms after the click (nearest continuation: a promise continuation; earlier: a timer at 500 ms)`,
 * `… (nearest continuation: a promise continuation; earlier ones not identified)`. Null when not deferred.
 */
export function issueDeferralText(deferral) {
  if (!deferral?.via) return null;
  const words = via => VIA_WORDS[via] || `a ${via} continuation`;
  const when = whenText(deferral.ms_after_dispatch) || 'some time';
  const head = `sent ${when} after the ${deferral.dispatch_event || 'action'}`;
  const list = Array.isArray(deferral.continuations) ? deferral.continuations : [];
  if (list.length <= 1 && deferral.reached_dispatch !== false) return `${head} via ${words(deferral.via)}`;
  const earlier = list.slice(0, -1).map(entry => `${words(entry.via)}${whenText(entry.ms_after_dispatch) ? ` at ${whenText(entry.ms_after_dispatch)}` : ''}`);
  const tail = [earlier.length ? `earlier: ${earlier.join(', then ')}` : null, deferral.reached_dispatch === false ? `${earlier.length ? 'before that' : 'earlier ones'} not identified` : null].filter(Boolean);
  return `${head} (nearest continuation: ${words(deferral.via)}${tail.length ? `; ${tail.join('; ')}` : ''})`;
}

const segmentOrder = (left, right) => (left.start ?? Infinity) - (right.start ?? Infinity) || left.order - right.order;

/**
 * The one per-request segment builder (fix/middleware-reads): what one
 * request's own exact joins (`steps`: its `network.request` row first, then
 * its route / handler / database / diagnostic rows from `attachBackendSpans`)
 * say, for every surface (MCP segments, exported action chains, the live
 * viewer's chain). Adds no join: route, handler spans, every database
 * operation under the server span with its issuer, who ended the request,
 * deferred server work (span clocks order spans of one trace; they create no
 * join), the frontier and the one outcome label.
 * `spanStart(spanId)` is an optional fallback for rows joined before rows
 * carried `start_ms` / `end_ms`. `issue` (an `issueDeferral` result, given by
 * callers that hold the action's rows) adds the issue deferral to `deferred`.
 */
export function requestSegmentCore(steps, { backendInstrumented = true, pending = false, entry_handler = null, spanStart = null, spanEnd = null, windowRoots = null, issue = null } = {}) {
  const request = steps.find(step => step.kind === 'network.request') || null;
  const routes = steps.filter(step => step.kind === 'route.dispatch');
  const handlers = steps.filter(step => step.kind === 'handler.enter');
  const dbs = steps.filter(step => step.kind === 'db.operation');
  const diagnostics = steps.filter(step => step.kind === 'span.join.diagnostic');
  // Server-to-server hops (fix/server-outbound): a hop's database spans are
  // listed under the hop; `db_ops` are the request's own server's.
  const hops = hopSegments(steps.filter(step => step.kind === 'server.hop'));
  const route = routes[0] || null;
  const startOf = row => row?.start_ms ?? spanStart?.(row?.span_id) ?? null;
  const status = Number(route?.status_code);
  const handlerSpans = handlers.map(row => ({ span_id: row.span_id, route: row.route ?? null, name: row.name ?? null, index: row.index ?? null }));
  const dbOps = dbs.filter(row => !row.hop).map((row, order) => ({ row, order, start: startOf(row) })).sort(segmentOrder)
    .map(({ row }) => ({ span_id: row.span_id, operation: row.operation, collection: row.collection, write: WRITE.test(String(row.operation || '')),
      ...(row.issuer ? { issuer: row.issuer, issued_by: row.issued_by ?? issuerText(row.issuer) } : {}) }));
  // Deferred server work: a handler or DB span under this request's server
  // span that starts after the server span ended (the response was sent).
  let deferred = null;
  const serverEnd = route ? (route.end_ms ?? spanEnd?.(route.span_id) ?? null) : null;
  if (serverEnd != null) {
    const late = [...handlers.map(row => ({ kind: 'handler', row })), ...dbs.map(row => ({ kind: 'db', row }))]
      .map(({ kind, row }) => ({ kind, span_id: row.span_id, start: startOf(row), issued_by: kind === 'db' ? (row.issued_by ?? null) : null }))
      // 1 ms floor: span clocks are ms-granular, so a smaller gap is not evidence of work after the response.
      .filter(item => item.start != null && item.start - serverEnd >= DEFERRED_FLOOR_MS)
      .sort((left, right) => left.start - right.start)
      .map(item => ({ kind: item.kind, span_id: item.span_id, after_response_ms: Math.round((item.start - serverEnd) * 10) / 10, ...(item.issued_by ? { issued_by: item.issued_by } : {}) }));
    if (late.length) deferred = { after_response_ms: late[0].after_response_ms, last_after_response_ms: late.at(-1).after_response_ms, spans: late };
  }
  // Two independent parts, each present only when the rows show it: the
  // request was sent on a continuation its action owns (`issue`, from
  // issueDeferral), and server work continued after the response.
  if (issue) deferred = { ...issue, ...(deferred || {}) };
  // This request's own root continuation candidates (fix/honest-coverage), from the episode's window.
  const roots = windowRootsFor(windowRoots, request?.request_occurrence_id ?? null);
  const own = { chain: steps, terminal: pending ? { pending: true } : {}, entry_handler, ...(roots ? { window_roots: roots } : {}) };
  let frontier = chainFrontier(own, { backendInstrumented });
  const label = actionOutcome(own, { backendInstrumented });
  // A request the page aborted (fix/client-aborts): the frontier says so first, and the server's answer is the server's.
  if (label.status === 'aborted_by_client' && frontier.because) frontier = { ...frontier, because: abortedBecause(route?.status_code, frontier.because) };
  else if (Number.isFinite(status) && status >= 400 && frontier.because && !frontier.because.startsWith('server responded')) frontier = { ...frontier, because: `server responded ${status}; ${frontier.because}` };
  return { request, route: route ? { span_id: route.span_id, method: route.method ?? null, route: route.route ?? null, status_code: route.status_code ?? null } : null,
    http_status: Number.isFinite(status) && label.status !== 'aborted_by_client' ? status : null, handler_spans: handlerSpans, db_ops: dbOps, responded_by: route?.responded_by ?? null,
    deferred, join_diagnostic: diagnostics[0]?.reason ?? null, frontier, label,
    hops: hops.hops, escaped_hops: hops.escaped_hops, hops_text: hops.text || null,
    ...(hops.total ? { bodies: HOP_BODIES } : {}) };
}

function stoppedLabel(frontier, chain) {
  if (frontier.stopped_at === 'worker') return `Stopped at worker: ${workerPostsOf(chain).latest?.script_url || 'unknown script'} is not instrumented`;
  if (frontier.stopped_at === 'websocket') return `Stopped at websocket: ${socketText(socketSendsOf(chain))}; its server-side effects cannot be traced`;
  return `Stopped at ${frontier.stopped_at}: ${frontier.because}`;
}

/** The bracket every summary prints for an outcome (`[outcome …]`, segment tails). */
export function outcomeText(outcome) {
  if (!outcome?.status) return '';
  const also = `${outcome.abort_after_response ? '; aborted by the page after the response' : ''}${outcome.also_text || ''}${outcome.escape_text ? `; ${SERVER_HOP_ESCAPE_LABEL}` : ''}`;
  const windowText = outcome.window_text ? `; ${outcome.window_text}` : '';
  switch (outcome.status) {
    case 'completed': case 'failed': return `${outcome.status} ${outcome.http_status}${also}`;
    case 'aborted_by_client': return `aborted_by_client; ${outcome.server_status != null ? `server answered ${outcome.server_status}` : 'no server status'}${also}`;
    case 'responded': return `responded ${outcome.http_status}; ${outcome.note || NO_EFFECT_NOTE}${also}`;
    case 'stopped': return `stopped at ${outcome.stopped_at}${outcome.http_status != null ? ` (status ${outcome.http_status})` : ''}${also}${windowText}`;
    case 'no_request': return `no_request; ${outcome.clause}${windowText}`;
    case 'opened': return `opened; ${outcome.clause}${windowText}`;
    case 'rejected_client_side': return `rejected_client_side; ${signalShort(outcome.signals?.[0] || { reason: outcome.reason })}${also}${windowText}`;
    default: return outcome.status;
  }
}

export const UNLINKED_ATTRIBUTION = "none (observed during this action's window; timestamps only order, not a join)";
export const UNLINKED_HEADING = "Observed during this action's window, not linked to it (timestamps only order, not a join)";

/** Span start in epoch ms from an OTel hrtime pair, epoch ns, or epoch ms. */
export function spanStartMs(span) {
  const value = span?.start_time ?? span?.startTime ?? span?.start_time_unix_nano;
  if (Array.isArray(value) && value.length === 2) return Number(value[0]) * 1e3 + Number(value[1]) / 1e6;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return number > 1e14 ? number / 1e6 : number;
}

/** Span end in epoch ms (same encodings as spanStartMs). */
export function spanEndMs(span) {
  return spanStartMs({ start_time: span?.end_time ?? span?.endTime ?? span?.end_time_unix_nano });
}

const WRITE_OPERATION = /^(?:insert|update|delete|remove|replace|findandmodify|bulk)/iu;

/** Backend spans grouped by trace id (each group is what one exact join can ever see). */
export function spansByTrace(spans) {
  const map = new Map();
  for (const span of spans || []) {
    if (!span?.trace_id) continue;
    const list = map.get(span.trace_id) || []; list.push(span); map.set(span.trace_id, list);
  }
  return map;
}

/**
 * A server span with the handler and database spans under it, by the exact
 * parentage rules of `attachBackendSpans` (`serverSpanDescendants`). The same
 * route / handler / DB summary an attributed segment gets; it attaches spans
 * to the server span, never the server span to an action.
 */
export function describeServerSpan(span, traceSpans = [], allSpans = traceSpans) {
  const attributes = span?.attributes || {};
  const { handlers, databases, responded_by: respondedBy } = serverSpanDescendants(span, traceSpans);
  const endMs = spanEndMs(span);
  const byStart = (left, right) => (left.start_ms ?? Infinity) - (right.start_ms ?? Infinity) || left.order - right.order;
  return { span_id: span.span_id ?? null, trace_id: span.trace_id ?? null, parent_span_id: span.parent_span_id ?? null, name: span.name ?? null,
    service_name: span.service_name ?? null, method: attributes['http.method'] ?? attributes['http.request.method'] ?? null,
    route: attributes['http.route'] ?? null, status_code: attributes['http.status_code'] ?? attributes['http.response.status_code'] ?? null,
    start_ms: spanStartMs(span), end_ms: endMs,
    handler_spans: handlers.map((handler, order) => ({ span_id: handler.span_id ?? null, name: handler.attributes?.['producttrace.express.handler.name'] ?? null,
      index: handler.attributes?.['producttrace.express.handler.index'] ?? null, start_ms: spanStartMs(handler), order })).sort(byStart).map(({ order, ...rest }) => rest),
    db_ops: databases.map((db, order) => ({ span_id: db.span.span_id ?? null, operation: db.operation ?? null, collection: db.collection ?? null,
      write: WRITE_OPERATION.test(String(db.operation || '')), issuer: db.issuer, issued_by: db.issued_by, start_ms: spanStartMs(db.span), order })).sort(byStart).map(({ order, ...rest }) => rest),
    responded_by: respondedBy ?? null,
    ...hopFields(serverHops(span, allSpans || traceSpans)) };
}

/** Additive hop fields of a described server span (absent when it sent no outbound request). */
function hopFields(list) {
  if (!list.length) return {};
  const hops = hopSegments(list);
  return { hops: hops.hops, escaped_hops: hops.escaped_hops, hops_text: hops.text, ...(hops.total ? { bodies: HOP_BODIES } : {}) };
}

/**
 * The server span of a request that no action owns, by the one exact join
 * (`attachBackendSpans`: same trace, server parent span id equals the
 * request's span id, method equal, exactly one). The row is joined under a
 * placeholder action id so the shared primitive can run; nothing is
 * attributed to any action.
 */
const withoutSteps = ({ steps, ...rest }) => rest;

export function joinRequestServer(row, traceSpans, { backendInstrumented = true, allSpans = null } = {}) {
  if (!backendInstrumented) return { server: null, server_join: 'backend_not_instrumented', steps: [{ ...row, kind: 'network.request' }] };
  if (!row?.trace_context?.trace_id || !row.trace_context.span_id) return { server: null, server_join: 'no_trace_context', steps: [{ ...row, kind: 'network.request' }] };
  const joined = attachBackendSpans([{ ...row, kind: 'network.request', internal: false, action_id: `unlinked:${row.request_occurrence_id || row.sequence}` }], allSpans || traceSpans || []);
  // `steps`: the joined rows (the request itself first), for the one outcome label function.
  const steps = joined.map(step => (step.kind === 'network.request' ? { ...row, kind: 'network.request' } : step));
  const route = joined.find(step => step.kind === 'route.dispatch');
  if (!route) return { server: null, server_join: joined.find(step => step.kind === 'span.join.diagnostic')?.reason || 'no_exact_parent_server', steps };
  const span = (traceSpans || []).find(value => value.span_id === route.span_id);
  return { server: span ? describeServerSpan(span, traceSpans, allSpans || traceSpans) : null, server_join: 'exact_parent', steps };
}

/**
 * Unlinked evidence for request-less chains: rows Tracer saw but could not
 * tie to any action by an identifier, listed per episode window. Never joined:
 * membership is by order only, so every entry says `attribution: none (...)`.
 *
 *  - requests: `network.request` rows with no `action_id` (the runtime's
 *    wrappers saw them outside every action frame, e.g. an uninstrumented
 *    script), same page, ordered by `sequence` after the episode's first
 *    dispatch and before the next dispatch on that page that is not in the
 *    episode (or the page's last row).
 *  - server_spans: `kind: "server"` spans whose (trace id, parent span id)
 *    matches no `network.request` row's trace context, whose start time falls
 *    in the same window by timestamp (the episode's first dispatch to the next
 *    dispatch, or the page's last row).
 */
export function indexUnlinkedEvidence(input, spans = [], { limit = 20 } = {}) {
  const records = mergeRequestFacts(input);
  const pages = new Map();
  const page = key => { if (!pages.has(key)) pages.set(key, { dispatches: [], requests: [], sends: [], realms: [], untrusted: [], last_sequence: -Infinity, last_timestamp: -Infinity }); return pages.get(key); };
  const requestContexts = new Set();
  for (const row of records || []) {
    if (!row || typeof row !== 'object') continue;
    const entry = page(pageOf(row));
    if (Number.isFinite(row.sequence)) entry.last_sequence = Math.max(entry.last_sequence, row.sequence);
    // The page's last *runtime* row: the collector's run-close tally (capture.received) is written when the
    // collector stops, not when the page ended, so it never extends a window.
    if (row.kind !== 'capture.received' && Number.isFinite(Number(row.timestamp))) entry.last_timestamp = Math.max(entry.last_timestamp, Number(row.timestamp));
    if (row.kind === 'dom.action' && row.action_id) entry.dispatches.push(row);
    if (row.kind === 'network.send') entry.sends.push(row);
    if (row.kind === 'dom.untrusted') entry.untrusted.push(row);
    if (row.kind === 'capture.limit' && (row.feature === 'realm' || row.feature === 'worker_fetch')) entry.realms.push(row);
    if (row.kind === 'network.request') {
      const context = row.trace_context || {};
      if (context.trace_id && context.span_id) requestContexts.add(`${context.trace_id}:${context.span_id}`);
      if (!row.action_id && row.internal !== true && row.transport_internal !== true) entry.requests.push(row);
    }
  }
  const bySequence = (left, right) => Number(left.sequence ?? Infinity) - Number(right.sequence ?? Infinity) || Number(left.timestamp || 0) - Number(right.timestamp || 0);
  for (const entry of pages.values()) { entry.dispatches.sort(bySequence); entry.requests.sort(bySequence); entry.sends.sort(bySequence); entry.realms.sort(bySequence); }
  // A hop's receiving server span is described under the server span that sent it; a span continued from any
  // recorded backend span is joined by that id: neither is unlinked.
  const unjoinedServers = serverSpansWithoutBrowserParent(spans, requestContexts)
    .map(span => ({ span, start_ms: spanStartMs(span) })).filter(row => row.start_ms != null).sort((left, right) => left.start_ms - right.start_ms);
  const byTrace = spansByTrace(spans);
  const backendInstrumented = (spans || []).length > 0;
  // An unlinked request carries the server span its own trace context joins
  // exactly (never the action); an unlinked server span carries its handler
  // and DB spans. Both are the same summary an attributed segment gets.
  const requestCache = new Map();
  const describeRequest = row => {
    if (!requestCache.has(row)) requestCache.set(row, { sequence: row.sequence ?? null, timestamp: row.timestamp ?? null, method: row.method ?? null, url: row.url ?? null,
      transport: row.transport ?? null, request_occurrence_id: row.request_occurrence_id ?? null, trace_id: row.trace_context?.trace_id ?? null,
      runtime_reason: row.reason ?? null, ...(row.issuer ? { issuer: row.issuer } : {}),
      ...(isClientAborted(row) ? { aborted_by_client: true, aborted_at: row.aborted_at ?? null } : {}),
      ...withoutSteps(joinRequestServer(row, byTrace.get(row.trace_context?.trace_id), { backendInstrumented, allSpans: spans })), attribution: UNLINKED_ATTRIBUTION });
    return requestCache.get(row);
  };
  const spanCache = new Map();
  const describeSpan = ({ span }) => {
    if (!spanCache.has(span)) spanCache.set(span, { ...describeServerSpan(span, byTrace.get(span.trace_id), spans), attribution: UNLINKED_ATTRIBUTION });
    return spanCache.get(span);
  };
  /**
   * The raw window of an episode: `{ status, window, requests, servers, sends, realms }`,
   * rows selected by order only (by page sequence; server spans by start
   * time). The last episode's window ends at the page's last runtime row plus
   * PAGE_END_GRACE_MS (pagehide beacons), never at collector shutdown.
   */
  const windowOf = episode => {
    const none = status => ({ status, window: null, requests: [], servers: [], sends: [], realms: [], untrusted: [] });
    const actions = (episode?.actions || []).filter(row => row?.action_id);
    if (!actions.length) return none('no dispatch row for this episode');
    const pageKey = pageOf(actions[0]);
    const entry = pages.get(pageKey);
    if (!entry) return none('no rows for this page');
    // A caused focus is this episode's own work: it does not close the window.
    const ids = new Set([...(episode.action_ids || actions.map(row => row.action_id)), ...(episode.caused_action_ids || [])]);
    const own = entry.dispatches.filter(row => ids.has(row.action_id));
    if (!own.length || own.some(row => !Number.isFinite(row.sequence))) return none('episode dispatches carry no sequence; window not computable');
    const first = own[0]; const last = own.at(-1);
    // The window closes at the next user act: on a runtime that records
    // phases (D-G1-21), a discrete, non-caused dispatch outside the episode's
    // own gestures (a mouseup, click, DOMActivate, hover range or caused
    // event of the same act does not close it); any dispatch on an older runtime.
    const ownGestures = new Set(own.map(row => row.gesture_id).filter(Boolean));
    const boundary = row => (typeof row.phase === 'string'
      ? row.phase !== 'continuous' && row.gesture !== false && !(row.gesture_id && ownGestures.has(row.gesture_id)) : true);
    const next = entry.dispatches.find(row => row.sequence > last.sequence && !ids.has(row.action_id) && boundary(row)) || null;
    const endSequence = next ? next.sequence : Infinity;
    const endTimestamp = next ? Number(next.timestamp) : entry.last_timestamp + PAGE_END_GRACE_MS;
    const startTimestamp = Number(first.timestamp);
    const inWindow = row => Number.isFinite(row.sequence) && row.sequence > first.sequence && row.sequence < endSequence;
    const servers = Number.isFinite(startTimestamp) && Number.isFinite(endTimestamp)
      ? unjoinedServers.filter(row => row.start_ms >= startTimestamp && (next ? row.start_ms < endTimestamp : row.start_ms <= endTimestamp)) : [];
    return { status: null, requests: entry.requests.filter(inWindow), servers, sends: entry.sends.filter(inWindow), realms: entry.realms.filter(inWindow), untrusted: (entry.untrusted || []).filter(inWindow),
      window: { page: pageKey, from_action_id: first.action_id, from_sequence: first.sequence, from_timestamp: first.timestamp ?? null,
        until: next ? 'next_dispatch' : 'page_end', until_action_id: next?.action_id ?? null, until_sequence: next ? next.sequence : entry.last_sequence,
        until_timestamp: Number.isFinite(endTimestamp) ? endTimestamp : null, ...(next ? {} : { page_end_grace_ms: PAGE_END_GRACE_MS }) } };
  };
  return {
    windowOf,
    forEpisode(episode) {
      const raw = windowOf(episode);
      const base = { heading: UNLINKED_HEADING, attribution: UNLINKED_ATTRIBUTION };
      if (raw.status) return { ...base, window: null, requests: [], requests_total: 0, server_spans: [], server_spans_total: 0, window_status: raw.status };
      return { ...base, window: raw.window,
        requests: raw.requests.slice(0, limit).map(describeRequest), requests_total: raw.requests.length,
        requests_issuer_unknown: raw.requests.filter(row => !neverSent(row) && !issuerKnown(row)).length,
        server_spans: raw.servers.slice(0, limit).map(describeSpan), server_spans_total: raw.servers.length };
    },
  };
}
