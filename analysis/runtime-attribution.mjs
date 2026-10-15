import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
// Cycle-safe: causal-chain.mjs reads nothing from this module at evaluation time.
import { buildEpisodeChain, episodeForAction, hopEscapeClause, hopSegments, indexUnlinkedEvidence, memberOutcome, memberPointer, memberScope, requestSegmentCore, windowFrontier } from './causal-chain.mjs';
import { USER_EVENT_KINDS } from './user-event-model.mjs';

const ID_SHAPED = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|[0-9a-f]{24})$/iu;
const list = value => Array.isArray(value) ? value : [];
const spanAttr = (span, ...names) => { for (const name of names) if (span?.attributes?.[name] !== undefined) return span.attributes[name]; return undefined; };
const spanDbDetails = span => {
  let collection = spanAttr(span, 'db.collection.name', 'db.mongodb.collection') ?? null;
  const operation = spanAttr(span, 'db.operation.name', 'db.operation') || span.name?.match(/(?:^|[. ])([A-Za-z]+)(?:$|[. ])/u)?.[1] || span.name || null;
  if (collection === '$cmd' && String(operation).toLowerCase() === 'findandmodify') {
    const raw = spanAttr(span, 'producttrace.mongo.command_collection', 'db.mongodb.command.findAndModify', 'mongodb.command.findAndModify');
    if (typeof raw === 'string' && raw) collection = raw;
    else {
      for (const candidate of [spanAttr(span, 'db.mongodb.command', 'mongodb.command', 'db.command', 'db.statement')]) {
        let value = candidate; if (typeof value === 'string') { try { value = JSON.parse(value); } catch { value = null; } }
        if (value?.findAndModify) { collection = value.findAndModify; break; }
      }
    }
  }
  return { collection, operation };
};

/**
 * Absence is only ever claimed for what Tracer can see: rows from the build's
 * instrumented code and the runtime's own transport wrappers. Uninstrumented
 * scripts, workers and third-party code are outside that scope, so every
 * frontier that asserts "no X" says so (never "the dispatch made no request").
 */
const NO_REQUEST_SCOPED = 'no request could be attributed to this action from instrumented code (requests from uninstrumented scripts, workers and third-party code cannot be linked; any seen in this window are listed below as unlinked)';
export const SCOPED_ABSENCE = Object.freeze({
  no_request: NO_REQUEST_SCOPED,
  // Closed shadow root (G1 D-G1-18): the target itself is out of scope.
  closed_shadow: `target inside a closed shadow root (the inner target and its element-bound handlers are not observable); ${NO_REQUEST_SCOPED}`,
  // Rows recorded before observed bindings (the runtime's declared list; kept verbatim for those stores).
  no_bound_handler: 'no element-bound handler observed in instrumented code (uninstrumented and third-party handlers are not seen)',
  // D-G1-22: judged from handler.binding / handler.invocation rows observed at dispatch.
  no_bound_handler_ran: 'no element-bound handler ran: no instrumented function held by the target\'s element chain (an on* prop, or a listener on the element) was invoked for this dispatch (uninstrumented and third-party handlers are not seen)',
  // D-G1-22 grade change 3: first-party code ran for this dispatch, called by
  // library code (a library's prop handler React invoked, a library listener on
  // an element, or a continuation the dispatch created); it is not a global
  // listener and not bound to a prop Tracer can see. Followed by ": [ids]".
  handler_via_library: 'no element-bound handler of instrumented code ran; ran through library code on the element chain (not bound to an element prop Tracer can see)',
  submit_rejected: 'submit rejected by the app: the same form mutated; no request could be attributed to this action from instrumented code (requests from uninstrumented scripts, workers and third-party code cannot be linked; any seen in this window are listed below as unlinked)',
  // Worker frontier: follows "message posted to Web Worker <script url>; ".
  worker: 'worker code is not instrumented: requests it makes cannot be attributed to this action (any seen in this window are listed below as unlinked)',
});

// ---- Worker frontier ----------------------------------------------------
// Worker code is not instrumented: a request made inside a Web Worker never
// reaches the page's transport wrappers. The runtime records the crossing
// (`worker.postMessage`, owned by the posting action) and chains state it as
// an explicit frontier instead of "no request".
export const WORKER_STOP_REASON = 'worker_not_instrumented';
export const isWorkerPost = row => row?.kind === 'worker.postMessage' && Boolean(row.action_id);
export const workerBecause = post => `message posted to ${post?.worker_kind === 'shared' ? 'shared Web Worker' : 'Web Worker'} ${post?.script_url || 'unknown script'}; ${SCOPED_ABSENCE.worker}`;
const evidenceOrder = (left, right) => Number(left?.timestamp || 0) - Number(right?.timestamp || 0) || Number(left?.sequence || 0) - Number(right?.sequence || 0);
/** Worker posts in evidence order and the one the frontier names (the latest). */
export function workerPostsOf(rows) {
  const posts = list(rows).filter(isWorkerPost).sort(evidenceOrder);
  return { posts, latest: posts.at(-1) || null };
}
/** True when `request` was recorded after `post` (timestamps order; sequence breaks ties). */
export const recordedAfter = (request, post) => evidenceOrder(request, post) > 0;
/** One worker stop per distinct worker, in first-post order. */
export function workerStops(posts) {
  const seen = new Map();
  for (const post of list(posts)) if (!seen.has(post.worker_id)) seen.set(post.worker_id, post);
  return [...seen.values()].map(post => ({ stopped_at: 'worker', because: workerBecause(post), stop_reason: WORKER_STOP_REASON,
    worker_id: post.worker_id || null, worker_kind: post.worker_kind || null, script_url: post.script_url || null }));
}

/** Stable identity for a first-party function. Function text and names are not used. */
// ---- Client aborts (fix/client-aborts) -----------------------------------
// The runtime records an abort (`network.abort`) and a finished body read by
// the app (`network.response_read`) as rows of their own, keyed by the
// request's request_occurrence_id: the request row has already left the page
// when either happens. `mergeRequestFacts` puts those facts on the request row
// (additive fields, a copy; the fact rows stay in the array, so coverage
// counts are untouched). Every reader calls it before reading requests: the
// store (MCP), exported action chains and the chain assembler (live viewer).
// Idempotent; without fact rows it returns the same array.
const REQUEST_FACT_KINDS = new Set(['network.abort', 'network.response_read']);
const ABORT_FIELDS = ['abort_state', 'aborted_by_client', 'abort_reason', 'aborted_at', 'response_received_before_abort', 'body_read_started',
  'response_consumed_before_abort', 'signal_aborted_after', 'signal_aborted_at_call', 'ready_state_at_abort', 'undetermined_because', 'abort_evidence', 'abort_after_response', 'abort_call_seen', 'body_read_error_type', 'body_read_via', 'body_read_cancelled_by_app'];
const factKey = row => `${row?.capture_page_id || row?.session_id || 'default'}|${row?.request_occurrence_id}`;
export function mergeRequestFacts(rows) {
  if (!Array.isArray(rows)) return rows;
  const aborts = new Map(), reads = new Map();
  for (const row of rows) {
    if (!row || !REQUEST_FACT_KINDS.has(row.kind) || typeof row.request_occurrence_id !== 'string') continue;
    const target = row.kind === 'network.abort' ? aborts : reads;
    const key = factKey(row);
    if (!target.has(key)) target.set(key, row);
  }
  if (!aborts.size && !reads.size) return rows;
  let changed = false;
  const merged = rows.map(row => {
    if (row?.kind !== 'network.request' || typeof row.request_occurrence_id !== 'string') return row;
    const abort = aborts.get(factKey(row)); const read = reads.get(factKey(row));
    if (!abort && !read) return row;
    if ((!abort || row.abort_sequence === (abort.sequence ?? null)) && (!read || row.response_read_by_app?.sequence === (read.sequence ?? null))) return row;
    const next = { ...row };
    if (abort) {
      for (const field of ABORT_FIELDS) if (abort[field] !== undefined) next[field] = abort[field];
      next.abort_sequence = abort.sequence ?? null;
    }
    if (read) next.response_read_by_app = { via: read.via ?? null, sequence: read.sequence ?? null };
    changed = true;
    return next;
  });
  return changed ? merged : rows;
}
/** True when the page aborted this request (network.abort, abort_state "aborted"). */
export const isClientAborted = row => row?.kind === 'network.request' && row.aborted_by_client === true;

export function stableFunctionId(fileContent, start, end) {
  if (typeof fileContent !== 'string') throw new TypeError('fileContent must be a string');
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) {
    throw new TypeError('start/end must be a valid source span');
  }
  const contentHash = createHash('sha256').update(fileContent).digest('hex');
  return `function:${contentHash}:${start}:${end}`;
}

/**
 * Index the first depth-zero registered first-party handler reached by each action.
 *
 * An action's entry handler is selected from its depth-zero first-party frames
 * by terminal evidence, not by temporal proximity. The selected frame is the
 * earliest non-render/effect frame whose continuation subtree contains a
 * request, or (when the action made no request) its DOM mutation receipt.
 * Frames that ran but did not own terminal evidence remain spine-only. An
 * action with no terminal evidence may credit only its earliest event-invoked
 * frame, explicitly marked unrooted.
 */
export function indexEntryHandlerUnits(records, { registeredFunctionIds = null } = {}) {
  if (!Array.isArray(records)) throw new TypeError('records must be an array');
  const registered = registeredFunctionIds == null ? null : new Set(registeredFunctionIds);
  const continuationOwner = new Map();
  const continuationParent = new Map();
  const actions = new Map();
  for (const row of records) {
    if (row?.continuation_id && row.parent_continuation_id && row.continuation_id !== row.parent_continuation_id) {
      continuationParent.set(row.continuation_id, row.parent_continuation_id);
    }
    if (row?.kind === 'dom.action' && row.action_id) {
      actions.set(row.action_id, row);
      if (row.continuation_id) continuationOwner.set(row.continuation_id, row.action_id);
    }
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of records) {
      if (!row?.continuation_id || continuationOwner.has(row.continuation_id)) continue;
      const owner = row.action_id || continuationOwner.get(row.parent_continuation_id);
      if (owner) { continuationOwner.set(row.continuation_id, owner); changed = true; }
    }
  }
  const descendsFrom = (continuationId, ancestorId) => {
    if (!continuationId || !ancestorId) return false;
    const seen = new Set(); let cursor = continuationId;
    while (cursor && !seen.has(cursor)) {
      if (cursor === ancestorId) return true;
      seen.add(cursor); cursor = continuationParent.get(cursor) || null;
    }
    return false;
  };
  const units = new Map();
  const byAction = new Map();
  const candidatesByAction = new Map();
  const requestsByAction = new Map(), mutationsByAction = new Map();
  // Observed bindings (D-G1-22): the handlers that ran for each dispatch and
  // were held by the target's element chain. `handler.binding` for a user's
  // dispatch, `handler.invocation` for a dispatch live code caused; both say
  // the handler is element-bound to that action's own dispatch.
  const bindingsByAction = new Map(), viaLibraryByAction = new Map();
  for (const row of records) {
    if ((row?.kind === 'handler.binding' || row?.kind === 'handler.invocation') && row.action_id && row.continuation_id && row.untrusted !== true) {
      const values = bindingsByAction.get(row.action_id) || []; values.push(row); bindingsByAction.set(row.action_id, values);
    } else if (row?.kind === 'handler.via_library' && row.action_id && row.continuation_id) {
      const values = viaLibraryByAction.get(row.action_id) || []; values.push(row); viaLibraryByAction.set(row.action_id, values);
    }
  }
  for (const row of records) {
    const ownedAction = row?.action_id || continuationOwner.get(row?.continuation_id) || continuationOwner.get(row?.parent_continuation_id);
    if (row?.kind === 'network.request' && !row.internal && ownedAction) {
      const values = requestsByAction.get(ownedAction) || []; values.push(row); requestsByAction.set(ownedAction, values);
    } else if (row?.kind === 'worker.postMessage' && ownedAction) {
      // A post to a worker hands the action's work to uninstrumented code;
      // like a request it is terminal evidence for the frame that made it.
      const values = requestsByAction.get(ownedAction) || []; values.push(row); requestsByAction.set(ownedAction, values);
    } else if (row?.kind === 'dom.mutation' && ownedAction) {
      const values = mutationsByAction.get(ownedAction) || []; values.push(row); mutationsByAction.set(ownedAction, values);
    }
    if (row?.kind !== 'function.enter' || !row.function_id) continue;
    if (registered && !registered.has(row.function_id)) continue;
    const actionId = row.action_id || continuationOwner.get(row.continuation_id) || continuationOwner.get(row.parent_continuation_id);
    const action = actions.get(actionId);
    if (!action) continue;
    const spine = Array.isArray(row.spine?.function_ids) ? row.spine.function_ids : [];
    const enclosing = spine.slice(0, -1).filter(id => !registered || registered.has(id));
    if (enclosing.length) continue;
    if (row.invoked_by === 'render' || row.invoked_by === 'effect') continue;
    const values = candidatesByAction.get(actionId) || [];
    values.push(row); candidatesByAction.set(actionId, values);
  }
  const abstentions = new Map();
  for (const [actionId, action] of actions) {
    const candidates = (candidatesByAction.get(actionId) || []).sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
    const requests = requestsByAction.get(actionId) || [];
    const terminals = requests.length ? requests : (mutationsByAction.get(actionId) || []);
    // Observed basis: this dispatch's handlers were observed (the runtime
    // records bindings: its dom.action carries a declared list with a basis,
    // or a binding row exists). Older rows keep the declared-list rule below.
    const bindings = bindingsByAction.get(actionId) || [];
    const observedBasis = bindings.length > 0 || action.bound_handlers?.basis === 'declared';
    const boundContinuations = new Set(bindings.map(row => row.continuation_id));
    const libraryContinuations = new Set((viaLibraryByAction.get(actionId) || []).map(row => row.continuation_id));
    const isBound = candidate => boundContinuations.has(candidate.continuation_id);
    const bindingOf = candidate => bindings.find(row => row.continuation_id === candidate.continuation_id) || null;
    // Which depth-zero frame owns the terminal evidence: first by the
    // evidence's own continuation lineage (the frame whose continuation
    // subtree issued it), then by the owner the runtime chose while the
    // dispatch ran (`terminal_owner_continuation_id`: the earliest frame
    // observed bound to the dispatch, else entry_hint, else depth zero), for
    // evidence whose lineage is not in the rows (a promise continuation that
    // emitted nothing).
    const ownsByLineage = (terminal, candidate) => descendsFrom(terminal.parent_continuation_id, candidate.continuation_id)
      || (terminal.continuation_id !== terminal.terminal_owner_continuation_id && descendsFrom(terminal.continuation_id, candidate.continuation_id));
    const ownsByOwner = (terminal, candidate) => {
      const continuationId = terminal.terminal_owner_continuation_id || terminal.continuation_id || terminal.parent_continuation_id;
      return descendsFrom(continuationId, candidate.continuation_id)
        || (Array.isArray(terminal.spine?.function_ids) && terminal.spine.function_ids.includes(candidate.function_id));
    };
    const owns = candidate => terminals.some(terminal => ownsByLineage(terminal, candidate) || ownsByOwner(terminal, candidate));
    let selected = (requests.length ? candidates.find(candidate => terminals.some(terminal => ownsByLineage(terminal, candidate))) : null)
      || candidates.find(candidate => terminals.some(terminal => ownsByOwner(terminal, candidate)));
    let rooted = Boolean(selected);
    // Closed shadow root (runtime: target.closed_shadow): composedPath() hid
    // the real target, so no binding can be established for a frame that owns
    // no request. That is the frontier; it is stated instead of "no request"
    // or a global-listener abstention. A frame that owns a request is still
    // credited below.
    if (!requests.length && action.target?.closed_shadow === true) {
      const unresolved = [...new Set(candidates.filter(candidate => candidate.invoked_by === 'event').map(candidate => candidate.function_id))];
      abstentions.set(actionId, { stopped_at: 'entry_handler', because: SCOPED_ABSENCE.closed_shadow,
        closed_shadow: true, shadow_host: action.target.tag || null, handlers_ran: unresolved, bound_handlers: action.bound_handlers?.ids || [], library_bound: action.bound_handlers?.library ?? null });
      continue;
    }
    if (!terminals.length) {
      selected = (observedBasis ? candidates.find(isBound) : null) || candidates.find(candidate => candidate.invoked_by === 'event');
      rooted = false;
    }
    if (!selected) continue;
    if (observedBasis) {
      // D-G1-22. A frame that owns a request is credited whatever bound it
      // (unchanged). Otherwise the credit goes to a handler observed bound to
      // this dispatch: the selected frame when it is bound, else the first
      // bound frame that ran (not rooted unless it owns the evidence). The
      // abstention is stated only when no bound handler ran at all, and only
      // for a target whose binding the runtime could read (a declared list
      // was recorded: React-rendered, or with element listeners).
      // Grade change 2: an observed-bound frame outranks an unbound one,
      // with or without a request. A global listener that sends (analytics
      // on every click) is never "the handler" while the element's own bound
      // handler ran; its requests are listed as issued by an unbound frame.
      // Regrade change 3: bound frames are ranked by nearness to the target
      // (`holder_distance` on the binding row), not by entry order: the
      // bound frame that issued a request (its own lineage) first, else the
      // nearest bound frame owning the evidence, else the nearest.
      const distanceOf = candidate => { const value = bindingOf(candidate)?.holder_distance; return Number.isFinite(value) ? value : Infinity; };
      const bound = candidates.filter(isBound).sort((left, right) => distanceOf(left) - distanceOf(right) || (left.sequence || 0) - (right.sequence || 0));
      const issuer = requests.length ? bound.find(candidate => requests.some(request => ownsByLineage(request, candidate))) : null;
      const preferred = bound.length ? (issuer || bound.find(owns) || bound[0]) : null;
      // Request ownership is independent of whether ranking changes the
      // credited handler. A bound handler can request first, followed by an
      // unbound page listener that issues another request on the same action.
      const unboundIssuers = preferred ? candidates.filter(candidate => !isBound(candidate) && requests.some(request => ownsByLineage(request, candidate) || ownsByOwner(request, candidate)))
        .map(candidate => ({ function_id: candidate.function_id, via_library: libraryContinuations.has(candidate.continuation_id),
          request_occurrence_ids: requests.filter(request => ownsByLineage(request, candidate) || ownsByOwner(request, candidate)).map(request => request.request_occurrence_id || null) })) : [];
      if (preferred && preferred !== selected) {
        const owner = preferred;
        selected = owner; rooted = owns(owner);
      } else if (!requests.length && !isBound(selected) && (action.bound_handlers || bindings.length)) {
        // No bound handler ran. Functions library code called for this
        // dispatch are named as such, never as global listeners (change 3).
        const library = [...new Set(candidates.filter(candidate => libraryContinuations.has(candidate.continuation_id)).map(candidate => candidate.function_id))];
        const globalListeners = [...new Set(candidates.filter(candidate => candidate.invoked_by === 'event' && !libraryContinuations.has(candidate.continuation_id)).map(candidate => candidate.function_id))];
        const because = library.length ? `${SCOPED_ABSENCE.handler_via_library}: [${library.join(', ')}]; global listeners: [${globalListeners.join(', ')}]`
          : `${SCOPED_ABSENCE.no_bound_handler_ran}; global listeners: [${globalListeners.join(', ')}]`;
        abstentions.set(actionId, { stopped_at: 'entry_handler', because, basis: 'observed', stop_reason: library.length ? 'handler_via_library' : 'no_element_bound_handler',
          global_listeners: globalListeners, ran_via_library: library, handlers_ran: [...new Set(candidates.map(candidate => candidate.function_id))],
          bound_handlers: action.bound_handlers?.ids || [], library_bound: action.bound_handlers?.library ?? null });
        continue;
      }
      const event = String(action.event || 'unknown').toLowerCase();
      const unitId = `${selected.function_id}|${event}`;
      const unit = units.get(unitId) || { unit_id: unitId, function_id: selected.function_id, event, action_ids: [], entries: [], rooted_action_ids: [], unrooted_action_ids: [] };
      if (!unit.action_ids.includes(actionId)) unit.action_ids.push(actionId);
      (rooted ? unit.rooted_action_ids : unit.unrooted_action_ids).push(actionId);
      const binding = bindingOf(selected);
      unit.entries.push({ ...selected, rooted, ...(binding ? { binding: bindingSummary(binding) } : { binding: null }), ...(unboundIssuers.length ? { unbound_request_issuers: unboundIssuers } : {}),
        terminal_evidence: terminals.map(row => ({ kind: row.kind, sequence: row.sequence, request_occurrence_id: row.request_occurrence_id || null, continuation_id: row.terminal_owner_continuation_id || row.continuation_id || row.parent_continuation_id || null })) });
      units.set(unitId, unit);
      byAction.set(actionId, [unitId]);
      continue;
    }
    // Element/form binding (recorded by the runtime at dispatch from the
    // target's fiber ancestry: event props, component on* props, and the
    // first-party functions written inside those props at each placement).
    // A frame that owns a request is credited whatever bound it. Otherwise a
    // frame not bound to the element or its form is a global listener (a
    // document/window listener, a router loader): abstain instead of
    // crediting it, and never count a DOM mutation receipt as its root.
    const binding = action.bound_handlers;
    if (!requests.length && binding && Array.isArray(binding.ids) && !binding.ids.includes(selected.function_id)) {
      const globalListeners = [...new Set(candidates.filter(candidate => candidate.invoked_by === 'event' && !binding.ids.includes(candidate.function_id))
        .map(candidate => candidate.function_id))];
      abstentions.set(actionId, { stopped_at: 'entry_handler', because: `${SCOPED_ABSENCE.no_bound_handler}; global listeners: [${globalListeners.join(', ')}]`,
        basis: 'declared', global_listeners: globalListeners, bound_handlers: binding.ids, library_bound: binding.library ?? null });
      continue;
    }
    const event = String(action.event || 'unknown').toLowerCase();
    const unitId = `${selected.function_id}|${event}`;
    const unit = units.get(unitId) || { unit_id: unitId, function_id: selected.function_id, event, action_ids: [], entries: [], rooted_action_ids: [], unrooted_action_ids: [] };
    if (!unit.action_ids.includes(actionId)) unit.action_ids.push(actionId);
    (rooted ? unit.rooted_action_ids : unit.unrooted_action_ids).push(actionId);
    unit.entries.push({ ...selected, rooted, terminal_evidence: terminals.map(row => ({ kind: row.kind, sequence: row.sequence, request_occurrence_id: row.request_occurrence_id || null, continuation_id: row.terminal_owner_continuation_id || row.continuation_id || row.parent_continuation_id || null })) });
    units.set(unitId, unit);
    byAction.set(actionId, [unitId]);
  }
  return { units, byAction, continuationOwner, continuationParent, candidatesByAction, abstentions, bindingsByAction };
}

/** The identifiers of one observed binding row (D-G1-22), as chains and the MCP carry them. */
export function bindingSummary(row) {
  return { kind: row.kind, action_id: row.action_id, function_id: row.function_id, prop_name: row.prop_name ?? null, native_event_type: row.native_event_type ?? null,
    event_kind: row.event_kind ?? null, invoked_by: row.invoked_by ?? null, listener_on: row.listener_on ?? null, ran: row.ran ?? null, via: row.via ?? null,
    fiber: row.fiber ?? null, placement_id: row.placement_id ?? null, continuation_id: row.continuation_id ?? null, holder_resolution: row.holder_resolution ?? null,
    ...(row.ambiguous ? { ambiguous: true, ambiguity_reason: row.ambiguity_reason ?? null, holders: row.holders || [] } : {}),
    ...(Number.isFinite(row.holder_distance) ? { holder_distance: row.holder_distance } : {}),
    ...(row.kind === 'handler.invocation' ? { dispatched_by: row.dispatched_by ?? null, caused_by_action_id: row.caused_by_action_id ?? null } : {}) };
}

/**
 * Coalesce low-level DOM actions into the workflow episode that carries their
 * witnessed effect. Field edits, focus-like clicks, and Enter keydowns stay as
 * context for the next request/submit instead of becoming unresolved cards.
 * A submit-button click and the synchronous submit it causes share one carrier.
 *
 * An episode never spans two controls (G5 §15): it folds only actions on the
 * same control (the dispatch target's identity, `target_ref`) or form members
 * of the same form (`form_ref`, the form the target is a descendant of). A
 * form member is (a) a field event on one of the form's fields (input,
 * change, keydown/keyup, focus, or a click on an input/textarea/select/
 * contenteditable), or (b) a submit-capable action: a `submit`, a click on a
 * control that can submit the form (`<button>` with no type or
 * type="submit", `<input type="submit|image">`), or Enter in a field. A click
 * on type="button"/"reset", on any control with `aria-haspopup` or
 * `aria-expanded`, or on a non-field, non-submit control inside the form is
 * its own episode (with its own request, if it sent one). Focus on a
 * non-field control goes with the next action on that control. A control
 * that opened another UI (a menu, a listbox, a confirmation dialog, a form)
 * and the controls inside that UI are different episodes, even when close in
 * time: a portal is not inside the opener's form, and a mutation receipt's
 * `added_controls` / `added_forms` are evidence of what the opener rendered,
 * never a membership key.
 *
 * A focus caused by another action's work (the runtime's `gesture: false`
 * with `caused_by_action_id`: dispatched while that action's frame was live on
 * the synchronous stack or inside a continuation it created, such as its
 * commit, a mount effect, a timer or a promise) is not a user gesture: it
 * never starts an episode, never folds into a later action and is never a
 * form member. It is listed under the causing action's episode as a caused
 * event (`caused`, `caused_action_ids`), outside `action_ids`, so an episode
 * still holds one control or one form. A focus marked `gesture: false` whose
 * cause was abstained is listed nowhere. A focus with no such mark (Tab,
 * pointer focus, an unowned programmatic focus, and every row of a store
 * recorded before the mark existed) keeps the fold rule: it goes with the next
 * action on the same control within 1000 ms.
 *
 * Gesture context (D-G1-21). The rules above are written for the six kinds
 * the runtime recorded before D-G1-21 (`USER_EVENT_KINDS.episode_kinds`:
 * click, input, change, submit, keydown, focusin) and apply to them
 * unchanged. A row of any other kind recorded with a gesture phase
 * (pointerdown/up, mousedown/up, keyup, keypress, beforeinput, focus, blur,
 * focusout, a coalesced move/wheel/scroll range, copy, paste, toggle, ...)
 * is gesture context: it never breaks or joins the rules above, and
 *  - on the same control and in the same gesture (`gesture_id`) as an
 *    episode-kind row, it belongs to that row's episode: as a member when it
 *    carries evidence (a request, a mutation receipt, a worker post), else
 *    listed under `gesture_action_ids`;
 *  - with no such row, the gesture's context rows on one control are one
 *    episode if any of them carries evidence (a pointer drag: pointerdown,
 *    its move range and the pointerup that sends the request), carried by the
 *    latest with evidence; otherwise they stay raw context (no episode);
 *  - caused by live code (`gesture: false`), it is listed under the causing
 *    episode's `caused` only when it carries evidence.
 * An event dispatched on an element that live action code activated with a
 * synthetic click (`opened_by_action_id`, e.g. a hidden file input's change
 * after the picker closes) keeps its own episode (the user's choice in the
 * picker is a gesture on another control) and is listed under the opener's
 * episode as `opened`.
 */
export function indexWorkflowEpisodes(records) {
  if (!Array.isArray(records)) throw new TypeError('records must be an array');
  const actions = records.filter(row => row?.kind === 'dom.action' && row.action_id)
    .sort((left, right) => Number(left.timestamp || 0) - Number(right.timestamp || 0)
      || Number(left.sequence || 0) - Number(right.sequence || 0));
  const effects = new Map();
  for (const row of records) {
    if (!row?.action_id || !['network.request', 'dom.mutation', 'worker.postMessage'].includes(row.kind) || row.internal === true || row.transport_internal === true) continue;
    const values = effects.get(row.action_id) || []; values.push(row); effects.set(row.action_id, values);
  }
  const pages = new Map();
  for (const action of actions) {
    const page = action.capture_page_id || action.session_id || 'default';
    const values = pages.get(page) || []; values.push(action); pages.set(page, values);
  }
  const episodes = new Map(), byAction = new Map();
  const fieldTag = action => ['input', 'textarea', 'select'].includes(String(action.target?.tag || '').toLowerCase());
  // Not a user gesture: the runtime saw it dispatched on a live action frame.
  const caused = action => action?.gesture === false;
  const causedRows = [];
  const formRef = action => action?.form_ref || action?.form?.ref || null;
  const create = (carrier, members, { episodeId = `episode:${carrier.action_id}`, form = null, segment = null, rule = null } = {}) => {
    const unique = [...new Map(members.map(row => [row.action_id, row])).values()].sort(rowOrder);
    const episode = { episode_id: episodeId, carrier_action_id: carrier.action_id, action_ids: unique.map(row => row.action_id), actions: unique,
      form_ref: form, ...(segment ? { form_segment: segment } : {}), coalescing_rule: rule || (form
        ? 'same observed form: its field events and submit-capable actions, through rejected submits up to and including the next submit that sent a request; openers and other non-submit controls in the form are their own episodes'
        : 'same control (target identity): its focus folds into its next dispatch; never another control') };
    episodes.set(episodeId, episode);
    for (const row of unique) byAction.set(row.action_id, episodeId);
  };
  for (const [page, allPageActions] of pages) {
    // Gesture context rows are placed after the episode-kind rules ran (below).
    const pageActions = allPageActions.filter(action => !gestureContext(action));
    const contextActions = allPageActions.filter(gestureContext);
    const formGroups = new Map();
    const claimed = new Set();
    const transientParents = new Map();
    // Form membership (G5 §15): field events and submit-capable actions only.
    // Everything else inside the form is on its own control.
    const isMember = new Map();
    const direct = action => {
      if (caused(action) || !formRef(action)) return false;
      const event = String(action.event || '');
      if (event === 'submit') return true;
      const target = action.target || {};
      const attributes = target.attributes || {};
      const tag = String(target.tag || '').toLowerCase();
      const type = String(attributes.type || '').toLowerCase();
      const field = (tag === 'input' && !['submit', 'image', 'button', 'reset'].includes(type)) || tag === 'textarea' || tag === 'select'
        || (attributes.contenteditable != null && attributes.contenteditable !== 'false') || attributes.role === 'textbox';
      if (field && ['input', 'change', 'keydown', 'keyup', 'focus', 'focusin', 'click', 'beforeinput'].includes(event)) return true;
      if (event !== 'click') return false;
      if (attributes['aria-haspopup'] != null || attributes['aria-expanded'] != null) return false;
      return (tag === 'button' && (!type || type === 'submit')) || (tag === 'input' && ['submit', 'image'].includes(type));
    };
    for (const action of pageActions) isMember.set(action.action_id, direct(action));
    // The next user gesture after `index`: a caused focus is another action's
    // work, so it is skipped (it neither receives nor breaks a fold).
    const nextGesture = index => { for (let at = index + 1; at < pageActions.length; at += 1) if (!caused(pageActions[at])) return pageActions[at]; return null; };
    // Focus on a non-field control goes with the next action on that control.
    for (let index = 0; index < pageActions.length - 1; index += 1) {
      const action = pageActions[index], next = nextGesture(index);
      if (!next || caused(action) || !['focus', 'focusin'].includes(action.event) || isMember.get(action.action_id) || !formRef(action)) continue;
      const target = action.target_ref || action.target?.ref || null;
      if (target && target === (next.target_ref || next.target?.ref || null) && formRef(next) === formRef(action) && direct(next)) isMember.set(action.action_id, true);
    }
    for (const action of pageActions) {
      if (!isMember.get(action.action_id)) continue;
      const ref = formRef(action);
      const values = formGroups.get(ref) || []; values.push(action);
      formGroups.set(ref, values); claimed.add(action.action_id);
    }
    // Browser focus normally precedes the click on the same control. Treat
    // those as one dispatch episode so focus never becomes a duplicate card.
    // Same target identity only; the next action on another control is never
    // folded. A caused focus never folds (it is not a gesture).
    for (let index = 0; index < pageActions.length - 1; index += 1) {
      const action = pageActions[index], next = nextGesture(index);
      if (!next || caused(action)) continue;
      const target = action.target_ref || action.target?.ref || null;
      const nextTarget = next.target_ref || next.target?.ref || null;
      if (action.event === 'focusin' && target && target === nextTarget
        && Number(next.timestamp || 0) - Number(action.timestamp || 0) <= 1000
        && !isMember.get(action.action_id)) transientParents.set(next.action_id, action.action_id);
    }
    // A form episode closes at each submit that sent a request (G5 D-G5-2):
    // the form's actions up to and including that submit (rejected submits
    // before it stay in it) are one episode, and the next actions on the same
    // form start the next one. Membership by action_id only; timestamps only
    // order. Ids are stable while evidence grows: the first segment keeps the
    // form's id, later ones append `#<ordinal>`.
    const sendsRequest = action => action.event === 'submit' && (effects.get(action.action_id) || []).some(row => row.kind === 'network.request');
    for (const [ref, formMembers] of formGroups) {
      const baseId = `episode:form:${encodeURIComponent(page)}:${encodeURIComponent(ref)}`;
      const ordered = [...formMembers].sort(rowOrder);
      const segments = []; let segment = [];
      for (const action of ordered) { segment.push(action); if (sendsRequest(action)) { segments.push(segment); segment = []; } }
      const hasEffect = members => members.some(action => action.event === 'submit' || (effects.get(action.action_id) || []).length > 0);
      if (segment.length) {
        // Actions after the last request-sending submit with no request, DOM
        // change or submit (e.g. typing after a save) join the form's most
        // recent episode instead of becoming standalone keystrokes. A form
        // with no effect at all still gets no episode, as before the split.
        if (segments.length && !hasEffect(segment)) segments.at(-1).push(...segment);
        else segments.push(segment);
      }
      segments.forEach((members, index) => {
        const effectful = members.filter(action => (effects.get(action.action_id) || []).length > 0);
        const submits = members.filter(action => action.event === 'submit');
        if (!effectful.length && !submits.length) return;
        const carrier = [...effectful, ...submits].sort(rowOrder).at(-1) || members.at(-1);
        create(carrier, members, { episodeId: index === 0 ? baseId : `${baseId}#${index + 1}`, form: ref,
          ...(segments.length > 1 ? { segment: { ordinal: index + 1, of: segments.length } } : {}) });
      });
    }
    const absorbedTransientParents = new Set(transientParents.values());
    const transientMembers = action => {
      const members = [action], seen = new Set([action.action_id]); let parentId = transientParents.get(action.action_id);
      while (parentId && !seen.has(parentId)) {
        const parent = pageActions.find(row => row.action_id === parentId); if (!parent) break;
        members.unshift(parent); seen.add(parentId); parentId = transientParents.get(parentId);
      }
      return members;
    };
    for (const action of pageActions) {
      if (claimed.has(action.action_id)) continue;
      if (absorbedTransientParents.has(action.action_id)) continue;
      // Never an episode of its own, whatever effects it has: listed under
      // the causing action's episode below.
      if (caused(action)) { causedRows.push(action); continue; }
      const actionEffects = effects.get(action.action_id) || [];
      const fieldContext = fieldTag(action) || ['input', 'change', 'keydown', 'focus', 'focusin'].includes(action.event);
      // Context outside an observed form is retained in raw evidence but does
      // not become a standalone card. Every non-context dispatch gets a stable
      // provisional episode immediately, before any effect arrives.
      if (fieldContext && !actionEffects.length) continue;
      create(action, transientMembers(action));
    }
    // Gesture context (D-G1-21): same gesture, same control.
    const hasEffects = action => (effects.get(action.action_id) || []).length > 0;
    const groups = new Map();
    for (const action of contextActions) {
      if (caused(action)) { if (hasEffects(action)) causedRows.push(action); continue; }
      const control = controlOf(action);
      const key = action.gesture_id && control ? `${action.gesture_id}\u0000${control}` : `solo\u0000${action.action_id}`;
      const values = groups.get(key) || []; values.push(action); groups.set(key, values);
    }
    for (const group of groups.values()) {
      const first = group[0], control = controlOf(first);
      const anchors = first.gesture_id && control ? pageActions.filter(row => !caused(row) && row.gesture_id === first.gesture_id && controlOf(row) === control) : [];
      const anchorEpisodeId = [...anchors].reverse().map(row => byAction.get(row.action_id)).find(Boolean) || null;
      const withEvidence = group.filter(hasEffects), quiet = group.filter(action => !hasEffects(action));
      let episode = anchorEpisodeId ? episodes.get(anchorEpisodeId) : null;
      if (episode && withEvidence.length) {
        episode.actions = [...new Map([...episode.actions, ...withEvidence].map(row => [row.action_id, row])).values()].sort(rowOrder);
        episode.action_ids = episode.actions.map(row => row.action_id);
        for (const row of withEvidence) byAction.set(row.action_id, episode.episode_id);
      } else if (!episode && withEvidence.length) {
        const carrier = [...withEvidence].sort(rowOrder).at(-1);
        create(carrier, [...anchors, ...withEvidence], { rule: 'same gesture (gesture_id) on the same control: its press, release, continuous and activation rows are one episode; never another control' });
        episode = episodes.get(`episode:${carrier.action_id}`);
      }
      if (episode && quiet.length) episode.gesture_action_ids = [...new Set([...(episode.gesture_action_ids || []), ...quiet.map(row => row.action_id)])];
    }
  }
  // Caused events are listed under the causing action's episode (following a
  // chain of caused focuses to the first gesture), never as members: they do
  // not change `action_ids`, the carrier or the chain.
  const byId = new Map(actions.map(action => [action.action_id, action]));
  for (const action of causedRows) {
    let causer = action.caused_by_action_id ? byId.get(action.caused_by_action_id) : null;
    for (let depth = 0; causer && caused(causer) && depth < 64; depth += 1) causer = causer.caused_by_action_id ? byId.get(causer.caused_by_action_id) : null;
    const episode = causer ? episodes.get(byAction.get(causer.action_id)) : null;
    if (!episode) continue;
    episode.caused ||= []; episode.caused_action_ids ||= [];
    episode.caused.push({ action_id: action.action_id, event: action.event ?? null, target_ref: action.target_ref || action.target?.ref || null,
      caused_by_action_id: action.caused_by_action_id, caused_via: action.caused_via ?? null, gesture: false });
    episode.caused_action_ids.push(action.action_id);
  }
  // Opened by a synthetic activation: listed under the opener's episode.
  for (const action of actions) {
    if (!action.opened_by_action_id) continue;
    const episode = episodes.get(byAction.get(action.opened_by_action_id));
    if (!episode) continue;
    (episode.opened ||= []).push({ action_id: action.action_id, event: action.event ?? null, target_ref: controlOf(action), opened_by_action_id: action.opened_by_action_id,
      opened_via: action.opened_via ?? null, episode_id: byAction.get(action.action_id) || null });
  }
  return { episodes, byAction };
}

const EPISODE_KINDS = new Set(USER_EVENT_KINDS.episode_kinds);
/** A row recorded with a gesture phase (D-G1-21 runtimes) whose kind is not an episode kind. */
export const gestureContext = action => typeof action?.phase === 'string' && !EPISODE_KINDS.has(String(action?.event || ''));
const controlOf = action => action?.target_ref || action?.target?.ref || null;

const rowOrder = (left, right) => Number(left?.timestamp || 0) - Number(right?.timestamp || 0)
  || Number(left?.sequence || 0) - Number(right?.sequence || 0);

/**
 * The mutation that marks a request-less submit as rejected by the app: the
 * submit's own receipt on the same observed form, at or after the submit,
 * showing validation feedback (amended 2026-09-24, fix/outcome-labels: a bare
 * same-form mutation no longer counts). Shared by the episode state and
 * exported chains.
 */
export function rejectedSubmitMutation(submit, mutations, fallbackFormRef = null) {
  const form = submit?.form_ref || submit?.form?.ref || fallbackFormRef || null;
  // The submit's own receipt only: a later action on the same form (a focus
  // that lands on an invalid field, typing) is not the app's answer to it.
  return (mutations || []).find(row => Number(row.timestamp || 0) >= Number(submit?.timestamp || 0)
    && (!row.action_id || !submit?.action_id || row.action_id === submit.action_id)
    && (!form || row.form_ref === form)
    // Validation feedback only (abstain over guess): an alert/status/aria-live
    // change, an aria-invalid change, or focus moved to an invalid field. A
    // bare same-form mutation ("Saving…", a next step rendered in the form) is
    // not a rejection: the submit is then no_request.
    && (Number(row.validation?.feedback_mutations || 0) > 0 || row.validation?.aria_invalid_changed === true
      || row.validation?.focus_moved_to_invalid_field === true)) || null;
}

/**
 * Derive the live card state entirely from the evidence currently present.
 * Worker frontier: once the state is not pending, an episode whose latest
 * worker post has no request recorded after it stops at the worker (the same
 * rule as `chainFrontier`), so the label always agrees with `stopped_at`. The
 * state it displaces is kept as `displaced` (stop_reason, frontier, label).
 */
export function describeEpisodeEvidence(episode, records, joinedRecords, options = {}) {
  const state = describeEpisodeEvidenceBase(episode, records, joinedRecords, options);
  if (state.status === 'pending') return state;
  const actionIds = new Set(episode.action_ids || []);
  const { latest: workerPost } = workerPostsOf(records.filter(row => actionIds.has(row?.action_id)));
  if (!workerPost || (state.latest_request && recordedAfter(state.latest_request, workerPost))) return state;
  return { ...state, stage: 'stopped', status: 'incomplete', label: `Stopped at worker: ${workerPost.script_url || 'unknown script'} is not instrumented`,
    stop_reason: WORKER_STOP_REASON, frontier: { stopped_at: 'worker', because: workerBecause(workerPost) }, worker_post: workerPost,
    displaced: { stage: state.stage, stop_reason: state.stop_reason ?? null, frontier: state.frontier ?? null, label: state.label } };
}

function describeEpisodeEvidenceBase(episode, records, joinedRecords, { idle = false, backendInstrumented = true } = {}) {
  if (!episode || !Array.isArray(records) || !Array.isArray(joinedRecords)) throw new TypeError('episode and record arrays are required');
  const actionIds = new Set(episode.action_ids || []);
  const rows = records.filter(row => actionIds.has(row?.action_id)).sort(rowOrder);
  const joined = joinedRecords.filter(row => actionIds.has(row?.action_id));
  const requests = rows.filter(row => row.kind === 'network.request' && row.internal !== true).sort(rowOrder);
  // A request the page aborted is never the credited one while a request it
  // did not abort exists (fix/client-aborts); among the rest the rule is unchanged.
  const creditable = requests.some(row => !isClientAborted(row)) ? requests.filter(row => !isClientAborted(row)) : requests;
  const submits = (episode.actions || []).filter(row => row.event === 'submit').sort(rowOrder);
  const mutations = rows.filter(row => row.kind === 'dom.mutation').sort(rowOrder);
  const rejectedSubmits = submits.flatMap(submit => {
    const submitRequests = requests.filter(row => row.action_id === submit.action_id);
    if (submitRequests.length) return [];
    const mutation = rejectedSubmitMutation(submit, mutations, episode.form_ref);
    return mutation ? [{ submit, mutation }] : [];
  });
  const requestWithWrite = [...creditable].reverse().find(request => joined.some(row => row.kind === 'db.operation' && row.request_occurrence_id === request.request_occurrence_id
    && /^(?:insert|update|delete|remove|replace|findandmodify|bulk)/iu.test(String(row.operation || ''))));
  const latestRequest = requestWithWrite || creditable.at(-1) || null;
  const latestRejected = rejectedSubmits.at(-1) || null;
  const requestIsNewer = latestRequest && (!latestRejected
    || Number(latestRequest.timestamp || 0) > Number(latestRejected.submit.timestamp || 0));
  const requestJoin = row => row.request_occurrence_id
    ? row.request_occurrence_id === latestRequest?.request_occurrence_id
    : row.action_id === latestRequest?.action_id;
  const routes = latestRequest ? joined.filter(row => row.kind === 'route.dispatch' && requestJoin(row)) : [];
  const handlers = latestRequest ? joined.filter(row => row.kind === 'handler.enter' && requestJoin(row)) : [];
  const databases = latestRequest ? joined.filter(row => row.kind === 'db.operation' && requestJoin(row)) : [];
  const writes = databases.filter(row => /^(?:insert|update|delete|remove|replace|findandmodify|bulk)/iu.test(String(row.operation || '')));
  const database = writes.at(-1) || databases.at(-1) || null;
  if (latestRejected && !requestIsNewer) return { stage: 'rejected', status: 'incomplete', label: 'Submit rejected by the app',
    stop_reason: 'submit_rejected_by_app', frontier: { stopped_at: 'browser', because: SCOPED_ABSENCE.submit_rejected }, rejected_submits: rejectedSubmits, latest_request: latestRequest, routes, handlers, databases, database };
  if (database) return { stage: 'effect', status: 'completed', label: `Effect: ${database.operation || 'operation'} ${database.collection || 'unknown collection'}`,
    stop_reason: null, rejected_submits: rejectedSubmits, latest_request: latestRequest, routes, handlers, databases, database };
  if (handlers.length || routes.length) {
    const route = routes.at(-1)?.route_id || 'route pending'; const handler = handlers.at(-1)?.handler_id || 'handler pending';
    if (!idle) return { stage: 'backend', status: 'pending', label: `Backend: ${route} / ${handler}`, stop_reason: null,
      rejected_submits: rejectedSubmits, latest_request: latestRequest, routes, handlers, databases, database };
    return { stage: 'stopped', status: 'incomplete', label: 'Stopped: no database effect arrived before the episode became idle',
      stop_reason: 'no_database_effect_before_idle', frontier: handlers.length ? { stopped_at: 'handler', because: 'no db span under handler' } : { stopped_at: 'server', because: 'no handler span under server span' }, rejected_submits: rejectedSubmits, latest_request: latestRequest, routes, handlers, databases, database };
  }
  if (latestRequest) {
    if (!idle) return { stage: 'request', status: 'pending', label: `Request sent: ${latestRequest.method || 'GET'} ${latestRequest.url || 'unknown path'}`,
      stop_reason: null, rejected_submits: rejectedSubmits, latest_request: latestRequest, routes, handlers, databases, database };
    if (backendInstrumented === false) return { stage: 'stopped', status: 'incomplete', label: 'Stopped at network: backend not instrumented',
      stop_reason: 'backend_not_instrumented', frontier: { stopped_at: 'network', because: 'backend not instrumented' }, rejected_submits: rejectedSubmits, latest_request: latestRequest, routes, handlers, databases, database };
    return { stage: 'stopped', status: 'incomplete', label: 'Stopped: no exact-parent server span arrived before the episode became idle',
      stop_reason: 'no_exact_parent_server_before_idle', frontier: { stopped_at: 'network', because: 'no span on trace' }, rejected_submits: rejectedSubmits, latest_request: latestRequest, routes, handlers, databases, database };
  }
  // A generic mutation is a receipt, not by itself a named product effect.
  // Keep the episode waiting while more evidence may arrive; rejected submits
  // are handled above and an idle episode receives a specific stop below.
  if (!idle) return { stage: 'waiting', status: 'pending', label: 'Waiting for effect', stop_reason: null,
    rejected_submits: rejectedSubmits, latest_request: null, routes, handlers, databases, database: null };
  const lastAction = episode.actions?.at(-1);
  const reason = lastAction?.event === 'submit' ? 'no_request_or_validation_effect_after_submit' : 'no_effect_after_dispatch';
  return { stage: 'stopped', status: 'incomplete', label: `Stopped: ${reason.replaceAll('_', ' ')}`, stop_reason: reason,
    frontier: { stopped_at: 'browser', because: SCOPED_ABSENCE.no_request }, rejected_submits: rejectedSubmits, latest_request: null, routes, handlers, databases, database: null };
}

/** Identity-only serialization. Objects receive process-local handles; primitives are limited to IDs. */
export function createIdentityEncoder({ prefix = 'obj' } = {}) {
  const handles = new WeakMap();
  let next = 0;
  return value => {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string') return ID_SHAPED.test(value) ? { kind: 'id', value } : { kind: 'primitive', type: 'string' };
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return { kind: 'primitive', type: typeof value };
    if (typeof value === 'symbol') return { kind: 'primitive', type: 'symbol' };
    if (typeof value === 'function' || typeof value === 'object') {
      let handle = handles.get(value);
      if (!handle) { handle = `${prefix}:${++next}`; handles.set(value, handle); }
      return { kind: 'object', handle };
    }
    return { kind: 'primitive', type: typeof value };
  };
}

function safeArgs(encode, args) { return Array.from(args || [], encode); }

/**
 * Runtime causal recorder. It is deliberately independent of application names,
 * routes and labels: callers supply only observed evidence and source spans.
 */
export function createRuntimeAttributionEngine({ emit = () => {}, sessionId = `session:${Date.now().toString(36)}`, identity = createIdentityEncoder() } = {}) {
  if (typeof emit !== 'function') throw new TypeError('emit must be a function');
  const records = [];
  const chains = new Map();
  const contexts = new AsyncLocalStorage();
  let actionCounter = 0;
  let sequence = 0;
  const now = () => Date.now();
  const context = () => contexts.getStore() || null;
  const add = (row, owner = context()) => {
    const record = { schema: 'producttrace.runtime-evidence.v1', sequence: ++sequence, timestamp: now(), session_id: sessionId, ...row };
    if (owner?.action_id && record.action_id == null) record.action_id = owner.action_id;
    records.push(record); emit(record); return record;
  };
  const beginAction = ({ event = 'unknown', source_ref = null, evidence_ids = [], target = null } = {}) => {
    const actionId = `${sessionId}:action:${++actionCounter}`;
    const owner = { action_id: actionId, event, source_ref, evidence_ids: [...evidence_ids] };
    const action = add({ kind: 'dom.action', action_id: actionId, event, source_ref, evidence_ids: [...evidence_ids], target: identity(target) }, owner);
    chains.set(actionId, { action, steps: [], commits: [], abstained: [] });
    return { ...owner, action };
  };
  const runWithAction = (owner, fn, ...args) => contexts.run(owner, fn, ...args);
  const continuation = (owner, fn) => typeof fn === 'function' ? (...args) => runWithAction(owner, fn, ...args) : fn;
  const step = (kind, fields = {}, owner = context()) => {
    const row = add({ kind, ...fields }, owner);
    const chain = owner?.action_id && chains.get(owner.action_id);
    if (chain) chain.steps.push(row);
    return row;
  };
  const enterFunction = (function_id, { file = null, start = null, end = null, args = [], source_ref = null } = {}) => {
    const owner = context();
    return step('function.enter', { function_id, source_ref: source_ref || (file ? { file, start, end } : null), arguments: safeArgs(identity, args) }, owner);
  };
  const exitFunction = (function_id, { threw = false, result = undefined } = {}) => step('function.exit', { function_id, threw, result: identity(result) });
  const libraryCall = (library, exportName, args = []) => step('library.call', { library, export: exportName, arguments: safeArgs(identity, args), opaque: true });
  const request = (requestId, fields = {}) => step('network.request', { request_id: requestId, ...fields });
  const route = (routeId, fields = {}) => step('route.dispatch', { route_id: routeId, ...fields });
  const handler = (handlerId, fields = {}) => step('handler.enter', { handler_id: handlerId, ...fields });
  const database = (dbId, fields = {}) => step('db.operation', { db_id: dbId, ...fields });
  const commit = (commitId, fields = {}) => { const row = step('surface.change', { commit_id: commitId, ...fields }); const chain = context()?.action_id && chains.get(context().action_id); if (chain) chain.commits.push(row); return row; };
  const abstain = (reason, fields = {}) => { const row = step('stop', { stop_reason: reason, ...fields }); const chain = context()?.action_id && chains.get(context().action_id); if (chain) chain.abstained.push(reason); return row; };
  const finishAction = (owner, terminal = {}) => {
    const chain = chains.get(owner?.action_id);
    if (!chain) return null;
    const effect = terminal.effect || null;
    const stopReason = terminal.stop_reason || (!effect && !chain.steps.some(row => row.kind === 'stop') ? 'no_terminal_effect_observed' : null);
    const requestRow = chain.steps.find(row => row.kind === 'network.request');
    const spine = requestRow?.spine || { action_id: owner.action_id, function_ids: [] };
    const record = { schema: 'producttrace.causal-chain.v1', action_id: owner.action_id, session_id: sessionId, spine,
      chain: chain.steps.map(row => ({ kind: row.kind, id: row.request_id || row.route_id || row.handler_id || row.db_id || row.commit_id || row.function_id || `${row.kind}:${row.sequence}`, source_ref: row.source_ref || null, evidence_ids: row.evidence_ids || [] })),
      commits: chain.commits.map(row => row.commit_id || row.sequence), terminal: effect ? { effect } : { stop_reason: stopReason }, abstained: [...new Set(chain.abstained)],
      raw_evidence_ids: [chain.action, ...chain.steps].map(row => row.sequence) };
    chain.record = record; return record;
  };
  return { sessionId, records, context, add, beginAction, runWithAction, continuation, enterFunction, exitFunction, libraryCall, request, route, handler, database, commit, abstain, finishAction, identity };
}

function spanAttribute(span, ...names) {
  for (const name of names) if (span?.attributes?.[name] !== undefined) return span.attributes[name];
  return undefined;
}

function spanPath(span) {
  const value = spanAttribute(span, 'http.route', 'url.path', 'http.target', 'http.url');
  if (typeof value !== 'string') return null;
  try { return new URL(value, 'http://producttrace.invalid').pathname.replace(/\/{2,}/g, '/').replace(/\/$/u, '') || '/'; } catch { return null; }
}

function spanMethod(span) {
  return String(spanAttribute(span, 'http.request.method', 'http.method') || '').toUpperCase();
}

function spanDescends(span, ancestor, byId) {
  const seen = new Set(); let parent = span.parent_span_id;
  while (parent && !seen.has(parent)) { if (parent === ancestor) return true; seen.add(parent); parent = byId.get(parent)?.parent_span_id || null; }
  return false;
}

function isDatabaseSpan(span) {
  const instrumentation = span?.instrumentation?.name || '';
  return Boolean(spanAttribute(span, 'db.system.name', 'db.system') || instrumentation.includes('mongodb') || instrumentation.includes('mongoose'));
}

const spanMsOf = value => {
  if (Array.isArray(value) && value.length === 2) return Number(value[0]) * 1e3 + Number(value[1]) / 1e6;
  const number = Number(value);
  if (value == null || !Number.isFinite(number)) return null;
  return number > 1e14 ? number / 1e6 : number;
};
const HANDLER_INSTRUMENTATION = 'producttrace-express-handlers';
// Spans of the handler instrumentation that name code other than a route's
// registered callback (fix/middleware-reads): they are issuers, never a
// `handler.enter` step (so "no handler ran" stays true for a request a param
// callback or an error middleware ended).
const NON_ROUTE_HANDLER_KINDS = new Set(['param', 'error_middleware']);
const isRouteHandlerSpan = span => span?.instrumentation?.name === HANDLER_INSTRUMENTATION
  && !NON_ROUTE_HANDLER_KINDS.has(span.attributes?.['producttrace.express.handler.kind']);
export const ISSUER_KIND_LABELS = Object.freeze({ middleware: 'middleware', handler: 'handler', param: 'param', error_handler: 'error handler', route: 'route', router: 'router', app_span: 'app span' });
export const RESPONSE_STATUS_ATTRIBUTE = 'producttrace.response.status_code';

/**
 * The server code a span names, from its own attributes only, or null:
 *  - Tracer's handler spans: `handler` (a route callback), `param`
 *    (`router.param`), `error_handler` (four-argument middleware from `use`);
 *  - the official Express layer spans: `middleware` (`express.type`
 *    middleware, named by `express.name`), `route` (a route's request-handler
 *    layer, named by its `http.route`), `router`.
 * Server, client and database spans name no code.
 */
export function spanIssuer(span) {
  if (!span) return null;
  const attributes = span.attributes || {};
  if (span.instrumentation?.name === HANDLER_INSTRUMENTATION) {
    const kind = attributes['producttrace.express.handler.kind'];
    return { kind: kind === 'param' ? 'param' : kind === 'error_middleware' ? 'error_handler' : 'handler',
      name: attributes['producttrace.express.handler.name'] ?? null, span_id: span.span_id ?? null,
      ...(kind === 'param' && attributes['producttrace.express.param.name'] ? { param: attributes['producttrace.express.param.name'] } : {}) };
  }
  const type = attributes['express.type'];
  if (type === 'middleware') return { kind: 'middleware', name: attributes['express.name'] ?? null, span_id: span.span_id ?? null };
  if (type === 'request_handler') return { kind: 'route', name: attributes['http.route'] ?? attributes['express.name'] ?? null, span_id: span.span_id ?? null };
  if (type === 'router') return { kind: 'router', name: attributes['express.name'] ?? null, span_id: span.span_id ?? null };
  return null;
}

export const UNKNOWN_ISSUER = Object.freeze({ kind: 'unknown', name: null, span_id: null });
/** `middleware: auth`, `handler: updateTask`, `error handler: onError`, or `issuer: unknown`. */
export function issuerText(issuer) {
  if (!issuer || issuer.kind === 'unknown' || !ISSUER_KIND_LABELS[issuer.kind]) {
    return issuer?.broken_at ? `issuer: unknown (parent ${issuer.broken_at} not recorded)` : 'issuer: unknown';
  }
  const base = `${ISSUER_KIND_LABELS[issuer.kind]}: ${issuer.name || '<anonymous>'}`;
  // App spans the walk passed through on its way to the naming code (nearest first).
  return issuer.kind !== 'app_span' && issuer.via_app_spans?.length ? `${base} (in app span ${issuer.via_app_spans.join(' < ')})` : base;
}

/**
 * Nearest ancestor of `span` (itself excluded) that names server code, walking
 * parent ids up to (not past) `stopSpanId`. Spans on the way that name no code
 * and are neither database nor server spans (the app's own manual spans,
 * shipped as skeletons by the backend register) are kept as `via_app_spans`;
 * when no ancestor names code, the nearest app span is the issuer
 * (`app span: <name>`). None at all: `UNKNOWN_ISSUER`, with `broken_at` when
 * the walk stopped at a parent id the store does not hold.
 */
export function nearestIssuer(span, byId, stopSpanId = null) {
  const seen = new Set(); let parent = span?.parent_span_id || null;
  const via = [];
  while (parent && parent !== stopSpanId && !seen.has(parent)) {
    seen.add(parent);
    const ancestor = byId.get(parent);
    if (!ancestor) return via.length ? { kind: 'app_span', name: via[0], span_id: null, via_app_spans: via, broken_at: parent } : { ...UNKNOWN_ISSUER, broken_at: parent };
    const issuer = spanIssuer(ancestor);
    if (issuer) return via.length ? { ...issuer, via_app_spans: via } : issuer;
    if (ancestor.kind !== 'server' && !isDatabaseSpan(ancestor)) via.push(ancestor.name || '<unnamed span>');
    parent = ancestor.parent_span_id || null;
  }
  if (via.length) return { kind: 'app_span', name: via[0], span_id: null, via_app_spans: via };
  return UNKNOWN_ISSUER;
}

/** The parent id at which `span`'s ancestry leaves the store, or null (it reaches a root or a cycle). */
function brokenAncestry(span, byId) {
  const seen = new Set(); let parent = span?.parent_span_id || null;
  while (parent && !seen.has(parent)) { seen.add(parent); const ancestor = byId.get(parent); if (!ancestor) return parent; parent = ancestor.parent_span_id || null; }
  return null;
}

/**
 * Everything under one admitted server span, by exact trace id + parentage
 * (the one rule `attachBackendSpans` and `serverSpanDescendants` share):
 *  - handlers: Tracer's route-callback spans descending from the server span;
 *  - databases: EVERY database span descending from the server span, each
 *    with its issuer (the nearest ancestor naming server code, or `unknown`);
 *    reads in middleware, param callbacks and error middleware included;
 *  - responded_by: the code active when the response head was written (the
 *    one span in the subtree carrying `producttrace.response.status_code`),
 *    named like an issuer; null when no span carries it (older backends) or
 *    when more than one does (abstain).
 */
export function serverSubtree(server, traceSpans) {
  const byId = new Map(traceSpans.map(span => [span.span_id, span]));
  // The spans this server span owns: its descendants whose nearest server
  // ancestor it is (fix/server-outbound). A request it sent to another server
  // (or to itself) is a hop; the receiving server span owns that hop's work.
  const under = traceSpans.filter(span => span !== server && ownedBy(span, server.span_id, byId));
  const handlers = under.filter(isRouteHandlerSpan);
  const databases = under.filter(isDatabaseSpan).map(span => {
    const issuer = nearestIssuer(span, byId, server.span_id);
    return { span, ...spanDbDetails(span), issuer, issued_by: issuerText(issuer) };
  });
  // Never dropped: a database span of this trace whose ancestry leaves the
  // store (a parent span that was never shipped) belongs to this request when
  // this is the trace's only server span (the trace id is the join; backend
  // spans of one trace outside every server span cannot exist). It is listed
  // as `issuer: unknown (parent <id> not recorded)`. With more than one server
  // span in the trace it cannot be placed and is not listed (abstain).
  const servers = traceSpans.filter(span => span.kind === 'server');
  if (servers.length === 1) {
    for (const span of traceSpans) {
      if (span === server || !isDatabaseSpan(span) || under.includes(span)) continue;
      const brokenAt = brokenAncestry(span, byId);
      if (!brokenAt || brokenAt === server.parent_span_id) continue;
      const issuer = nearestIssuer(span, byId, server.span_id);
      databases.push({ span, ...spanDbDetails(span), issuer, issued_by: issuerText(issuer), ancestry_broken_at: brokenAt });
    }
  }
  const writers = [server, ...under].filter(span => span.attributes?.[RESPONSE_STATUS_ATTRIBUTE] != null);
  let respondedBy = null;
  if (writers.length === 1) {
    const writer = writers[0];
    const issuer = spanIssuer(writer) || (writer === server ? UNKNOWN_ISSUER : nearestIssuer(writer, byId, server.span_id));
    respondedBy = { ...issuer, text: issuerText(issuer), status_code: Number(writer.attributes[RESPONSE_STATUS_ATTRIBUTE]), writer_span_id: writer.span_id ?? null };
  }
  return { handlers, databases, responded_by: respondedBy, writers: writers.length };
}

/**
 * The nearest server span above `span` (exclusive), following parent ids
 * through the stored spans of one trace; null when the chain leaves them.
 * A server span owns the spans whose nearest server ancestor it is: a request
 * this server sent to another server (or to itself) is a new hop, and the
 * work under the receiving server span belongs to that hop, not to this one.
 */
function nearestServer(span, byId) {
  const seen = new Set(); let parent = span?.parent_span_id;
  while (parent && !seen.has(parent)) {
    const value = byId.get(parent);
    if (!value) return null;
    if (value.kind === 'server') return value;
    seen.add(parent); parent = value.parent_span_id;
  }
  return null;
}
const ownedBy = (span, serverId, byId) => nearestServer(span, byId)?.span_id === serverId;

/** An outbound HTTP client span (http/https client or undici/global fetch): a client span with an HTTP method that is not a database span. */
export function isOutboundSpan(span) {
  return span?.kind === 'client' && !isDatabaseSpan(span) && spanMethod(span) !== '';
}

function spanStart(span) {
  const value = span?.start_time;
  if (Array.isArray(value) && value.length === 2) return Number(value[0]) * 1e3 + Number(value[1]) / 1e6;
  const number = Number(value);
  return Number.isFinite(number) ? (number > 1e14 ? number / 1e6 : number) : null;
}

function outboundUrl(span) {
  const full = spanAttribute(span, 'url.full', 'http.url');
  if (typeof full === 'string' && full) return full;
  const host = spanAttribute(span, 'server.address', 'net.peer.name', 'http.host');
  const port = spanAttribute(span, 'server.port', 'net.peer.port');
  const target = spanAttribute(span, 'url.path', 'http.target') ?? '';
  return host ? `${spanAttribute(span, 'url.scheme', 'http.scheme') || 'http'}://${host}${port ? `:${port}` : ''}${target}` : (target || null);
}


export const HOP_JOIN_PREDICATE = 'same trace_id; server.parent_span_id == outbound client span id (the traceparent it sent); method equal; exactly one server span. When the app set its own traceparent (producttrace.outbound.app_traceparent), the server span whose trace_id and parent_span_id equal that value instead';
export const APP_TRACEPARENT_ATTRIBUTE = 'producttrace.outbound.traceparent_set_by_app';
export const APP_TRACEPARENT_VALUE_ATTRIBUTE = 'producttrace.outbound.app_traceparent';
/** A join that followed the hop to its receiving server span. */
export const hopFollowed = hop => Boolean(hop?.server) && (hop.join === 'exact_parent' || hop.join === 'app_traceparent');

function spanEnd(span) { return spanStart({ start_time: span?.end_time }); }
function parseTraceparent(value) {
  const match = /^[\da-f]{2}-([\da-f]{32})-([\da-f]{16})-[\da-f]{2}$/u.exec(String(value || '').trim().toLowerCase());
  return match ? { trace_id: match[1], span_id: match[2] } : null;
}

// Spans of the adapter's schema, by trace (cached per span array).
const traceIndexCache = new WeakMap();
function traceIndex(spans) {
  if (traceIndexCache.has(spans)) return traceIndexCache.get(spans);
  const index = new Map();
  for (const span of spans) {
    if (span?.schema !== 'producttrace.backend-span.v1' || !span.trace_id) continue;
    if (!index.has(span.trace_id)) index.set(span.trace_id, { candidates: [], byId: new Map() });
    const entry = index.get(span.trace_id); entry.candidates.push(span); entry.byId.set(span.span_id, span);
  }
  traceIndexCache.set(spans, index);
  return index;
}

/** The server span(s) an outbound span continues into: by its own span id, or by the app's traceparent when the app set one. */
function hopClaims(span, index, candidates) {
  if (span.attributes?.[APP_TRACEPARENT_ATTRIBUTE] === true) {
    const app = parseTraceparent(span.attributes?.[APP_TRACEPARENT_VALUE_ATTRIBUTE]);
    const pool = app ? index.get(app.trace_id)?.candidates || [] : [];
    return { app: true, claims: app ? pool.filter(value => value.kind === 'server' && value.parent_span_id === app.span_id) : [] };
  }
  return { app: false, claims: candidates.filter(value => value.kind === 'server' && value.parent_span_id === span.span_id) };
}

/**
 * The hops of one server span: every outbound HTTP client span it owns (its
 * nearest server ancestor), in start order, depth-first, with a dotted path
 * (`1`, `1.1`, `2`). Each joins the one server span whose parent span id is
 * that client span's id (the traceparent it sent), same trace, method equal;
 * when the app set its own traceparent (Tracer left it untouched), the one
 * server span whose trace id and parent span id equal the app's value
 * (`join: app_traceparent`), or none (`app_traceparent_unlinked`). Then that
 * server's own handlers, database spans and hops, recursively. A client span
 * no server span claims is an escaped hop (`no_incoming_span`), never matched
 * by URL or time. A hop whose client span started after its owning server
 * span ended carries `after_response_ms`. A receiving server with no handler
 * span keeps the database spans it owns, each named `issuer: unknown`.
 */
export function serverHops(server, spans) {
  if (!server?.span_id || !Array.isArray(spans)) return [];
  const index = traceIndex(spans);
  const out = [];
  const visited = new Set([server.span_id]);
  const walk = (owner, prefix, depth) => {
    const { candidates, byId } = index.get(owner.trace_id) || { candidates: [], byId: new Map() };
    const ownerEnd = spanEnd(owner);
    const outbound = candidates.filter(span => isOutboundSpan(span) && ownedBy(span, owner.span_id, byId))
      .map((span, order) => ({ span, order, start: spanStart(span) }))
      .sort((left, right) => (left.start ?? Infinity) - (right.start ?? Infinity) || left.order - right.order);
    outbound.forEach(({ span, start }, index_) => {
      const hop = prefix ? `${prefix}.${index_ + 1}` : `${index_ + 1}`;
      // The code that issued the call (nearest ancestor naming server code), as db ops name theirs.
      const issuerFound = nearestIssuer(span, byId, owner.span_id);
      const issuer = issuerFound && issuerFound.kind !== 'unknown' ? issuerFound : null;
      const method = spanMethod(span);
      const { app, claims } = hopClaims(span, index, candidates);
      const exact = claims.filter(value => spanMethod(value) === method);
      const join = exact.length === 1 ? (app ? 'app_traceparent' : 'exact_parent') : exact.length > 1 ? 'multiple_exact_parent_servers'
        : claims.length ? 'method_mismatch' : (app ? 'app_traceparent_unlinked' : 'no_incoming_span');
      const received = exact.length === 1 && !visited.has(exact[0].span_id) ? exact[0] : null;
      const status = span.status && typeof span.status === 'object' ? span.status : {};
      const code = spanAttribute(span, 'http.response.status_code', 'http.status_code');
      const after = start != null && ownerEnd != null && start - ownerEnd >= 1 ? Math.round((start - ownerEnd) * 10) / 10 : null;
      const entry = { hop, depth, parent_hop: prefix || null, trace_id: span.trace_id, span_id: span.span_id, parent_server_span_id: owner.span_id,
        parent_service_name: owner.service_name ?? null, service_name: span.service_name ?? null,
        issued_by: issuer ? { kind: issuer.kind, name: issuer.name ?? null, span_id: issuer.span_id ?? null, text: issuerText(issuer) } : null,
        method, url: outboundUrl(span), instrumentation: span.instrumentation?.name ?? null,
        client_status_code: code == null || code === '' ? null : Number(code),
        client_error: Number(status.code) === 2 ? (status.message || spanAttribute(span, 'error.type') || 'error') : null,
        ...(app ? { traceparent_set_by_app: true, app_traceparent: span.attributes?.[APP_TRACEPARENT_VALUE_ATTRIBUTE] ?? null } : {}),
        ...(after != null ? { after_response_ms: after } : {}),
        start_ms: start, join, server: null };
      if (received) {
        visited.add(received.span_id);
        const own = index.get(received.trace_id) || { candidates: [], byId: new Map() };
        // The receiving server's own work, by the same rule as a request's (serverSubtree): every database span it owns, named by its issuer.
        const subtree = serverSubtree(received, own.candidates);
        const receivedCode = spanAttribute(received, 'http.status_code', 'http.response.status_code');
        entry.server = { span_id: received.span_id, trace_id: received.trace_id, service_name: received.service_name ?? null, method: spanMethod(received) || null,
          route: spanAttribute(received, 'http.route') ?? null, status_code: receivedCode == null ? null : receivedCode,
          handler_spans: subtree.handlers.map(value => ({ span_id: value.span_id, name: value.attributes?.['producttrace.express.handler.name'] ?? null,
            index: value.attributes?.['producttrace.express.handler.index'] ?? null, start_ms: spanStart(value) }))
            .sort((left, right) => (left.start_ms ?? Infinity) - (right.start_ms ?? Infinity)),
          ...(subtree.responded_by ? { responded_by: subtree.responded_by } : {}),
          db_ops: subtree.databases.map(db => ({ span_id: db.span.span_id, collection: db.collection ?? null, operation: db.operation ?? null, issuer: db.issuer, issued_by: db.issued_by,
            start_ms: spanStart(db.span), write: WRITE_OPERATION.test(String(db.operation || '')) }))
            .sort((left, right) => (left.start_ms ?? Infinity) - (right.start_ms ?? Infinity)) };
      }
      out.push(entry);
      if (received) walk(received, hop, depth + 1);
    });
  };
  walk(server, '', 1);
  return out;
}

/**
 * Server spans that are the receiving side of a hop: their parent is an
 * outbound client span that itself sits under a server span (or they continue
 * the traceparent the app set on such a span). They are described inside that
 * server's hops, so no listing of "server spans with no browser request"
 * repeats them as unlinked roots.
 */
export function hopReceiverSpanIds(spans) {
  const index = traceIndex(spans || []);
  const appTargets = new Set();
  const ids = new Set();
  for (const { byId } of index.values()) for (const span of byId.values()) {
    if (!isOutboundSpan(span) || span.attributes?.[APP_TRACEPARENT_ATTRIBUTE] !== true || !nearestServer(span, byId)) continue;
    const app = parseTraceparent(span.attributes?.[APP_TRACEPARENT_VALUE_ATTRIBUTE]);
    if (app) appTargets.add(`${app.trace_id}:${app.span_id}`);
  }
  for (const { byId } of index.values()) for (const span of byId.values()) {
    if (span.kind !== 'server') continue;
    const parent = byId.get(span.parent_span_id);
    if ((parent && isOutboundSpan(parent) && parent.attributes?.[APP_TRACEPARENT_ATTRIBUTE] !== true && nearestServer(parent, byId))
      || appTargets.has(`${span.trace_id}:${span.parent_span_id}`)) ids.add(span.span_id);
  }
  return ids;
}

/**
 * Attach backend evidence only across exact W3C trace and parent relationships.
 * URL/time similarity never creates a route, handler, or database step.
 * Database steps: every database span under the admitted server span in the
 * same trace (fix/middleware-reads), each naming its issuer.
 */
export function attachBackendSpans(records, spans) {
  if (!Array.isArray(records) || !Array.isArray(spans)) throw new TypeError('records and spans must be arrays');
  const output = records.map(row => ({ ...row }));
  let sequence = 0;
  for (const row of output) sequence = Math.max(sequence, Number(row.sequence) || 0);
  for (const request of output.filter(row => row.kind === 'network.request' && !row.internal && row.action_id && row.trace_context?.trace_id)) {
    const traceId = request.trace_context.trace_id;
    const requestSpanId = request.trace_context.span_id;
    const candidates = spans.filter(span => span?.schema === 'producttrace.backend-span.v1' && span.trace_id === traceId);
    const path = spanPath({ attributes: { 'http.target': request.url } });
    const method = String(request.method || 'GET').toUpperCase();
    // The browser request span is the authoritative edge.  Backend routers
    // commonly expose a parameterized http.route (for example
    // `/api/agents/chat/stream/:streamId`) while the browser carries the
    // concrete path.  Do not require textual URL equality here: exact trace
    // identity, W3C parentage, and method already establish the causal join.
    // URL/time similarity is never used as a fallback.
    const servers = candidates.filter(span => span.kind === 'server' && span.parent_span_id === requestSpanId
      && spanMethod(span) === method);
    if (servers.length !== 1) {
      const candidateSpans = candidates.filter(span => span.kind === 'server').map(span => ({
        span_id: span.span_id, parent_span_id: span.parent_span_id || null, method: spanMethod(span),
        route: spanPath(span), kind: span.kind,
      }));
      const rejected = candidateSpans.map(span => ({ span_id: span.span_id, reasons: [
        ...(span.parent_span_id !== requestSpanId ? ['parent_span_mismatch'] : []),
        ...(spanMethod(span) !== method ? ['method_mismatch'] : []),
      ] }));
      output.push({ schema: 'producttrace.runtime-evidence.v1', sequence: ++sequence, timestamp: request.timestamp,
        kind: 'span.join.diagnostic', action_id: request.action_id, request_occurrence_id: request.request_occurrence_id || null,
        trace_id: traceId, request_span_id: requestSpanId, requested_method: method, requested_path: path,
        candidate_spans: candidateSpans, rejected, predicate: 'same trace_id; server.parent_span_id == request.trace_context.span_id; method equal; exactly one server span',
        reason: servers.length === 0 ? 'no_exact_parent_server' : 'multiple_exact_parent_servers', evidence_ids: [traceId, requestSpanId] });
      continue;
    }
    const server = servers[0];
    const subtree = serverSubtree(server, candidates);
    output.push({ schema: 'producttrace.runtime-evidence.v1', sequence: ++sequence, timestamp: request.timestamp,
      kind: 'route.dispatch', action_id: request.action_id, route_id: `route:${server.span_id}`, trace_id: traceId,
      request_occurrence_id: request.request_occurrence_id || null,
      span_id: server.span_id, source: 'opentelemetry',
      // The joined server span's own HTTP status (outcome labels read it from the chain).
      status_code: spanAttribute(server, 'http.status_code', 'http.response.status_code') ?? null,
      method: spanAttribute(server, 'http.method', 'http.request.method') ?? null, route: spanAttribute(server, 'http.route') ?? null,
      start_ms: spanMsOf(server.start_time), end_ms: spanMsOf(server.end_time),
      // The server code that wrote the response head (null: not recorded, or ambiguous).
      responded_by: subtree.responded_by,
      admission_reason: 'same trace_id; server.parent_span_id equals request.trace_context.span_id; method equal; exactly one server span',
      evidence_ids: [server.span_id, traceId] });
    for (const handlerSpan of subtree.handlers) output.push({ schema: 'producttrace.runtime-evidence.v1', sequence: ++sequence,
      timestamp: request.timestamp, kind: 'handler.enter', action_id: request.action_id,
      request_occurrence_id: request.request_occurrence_id || null,
      handler_id: `handler:${handlerSpan.span_id}`, trace_id: traceId, span_id: handlerSpan.span_id,
      name: handlerSpan.attributes?.['producttrace.express.handler.name'] ?? null, index: handlerSpan.attributes?.['producttrace.express.handler.index'] ?? null,
      route: handlerSpan.attributes?.['http.route'] ?? null, start_ms: spanMsOf(handlerSpan.start_time),
      admission_reason: 'handler span is an exact descendant of the admitted server span in the same trace',
      evidence_ids: [handlerSpan.span_id, traceId] });
    for (const db of subtree.databases) {
      output.push({ schema: 'producttrace.runtime-evidence.v1', sequence: ++sequence, timestamp: request.timestamp,
        kind: 'db.operation', action_id: request.action_id, db_id: `db:${db.span.span_id}`, trace_id: traceId,
        request_occurrence_id: request.request_occurrence_id || null,
        span_id: db.span.span_id, collection: db.collection || null, operation: db.operation || null,
        issuer: db.issuer, issued_by: db.issued_by, ...(db.ancestry_broken_at ? { ancestry_broken_at: db.ancestry_broken_at } : {}), start_ms: spanMsOf(db.span.start_time), end_ms: spanMsOf(db.span.end_time),
        admission_reason: db.ancestry_broken_at ? `database span in the same trace as the admitted server span (its only server span); its ancestry leaves the store at ${db.ancestry_broken_at}; issued by ${db.issued_by}`
          : `database span is an exact descendant of the admitted server span in the same trace; issued by ${db.issued_by}`,
        evidence_ids: [db.span.span_id, traceId] });
    }
    // Server-to-server hops of this request: one `server.hop` row per
    // outbound client span, joined by the traceparent it sent; each joined
    // hop's database spans are this request's `db.operation` rows too (exact
    // span parentage at every edge), marked with the hop they ran in.
    serverHops(server, spans).forEach((hop, order) => {
      output.push({ schema: 'producttrace.runtime-evidence.v1', sequence: ++sequence, timestamp: request.timestamp,
        kind: 'server.hop', action_id: request.action_id, request_occurrence_id: request.request_occurrence_id || null,
        hop_id: `hop:${hop.span_id}`, hop_order: order, ...hop, predicate: HOP_JOIN_PREDICATE,
        admission_reason: 'outbound client span owned by an admitted server span of this request (its nearest server ancestor) in the same trace',
        evidence_ids: [hop.span_id, ...(hop.server ? [hop.server.span_id] : []), traceId] });
      for (const db of hop.server?.db_ops || []) output.push({ schema: 'producttrace.runtime-evidence.v1', sequence: ++sequence, timestamp: request.timestamp,
        kind: 'db.operation', action_id: request.action_id, db_id: `db:${db.span_id}`, trace_id: hop.server.trace_id || traceId,
        request_occurrence_id: request.request_occurrence_id || null, span_id: db.span_id, collection: db.collection || null, operation: db.operation || null,
        issuer: db.issuer, issued_by: db.issued_by, start_ms: db.start_ms ?? null,
        hop: hop.hop, hop_span_id: hop.span_id, hop_method: hop.method, hop_path: hop.url, hop_responded_by: hop.server.responded_by ?? null,
        admission_reason: `database span owned by the server span that received an outbound span of this request (traceparent at every hop); issued by ${db.issued_by}`,
        evidence_ids: [db.span_id, hop.span_id, traceId] });
    });
  }
  return output;
}

/**
 * The handler and database spans under one server span, by the same exact
 * parentage rules as `attachBackendSpans` (`serverSubtree`: handler spans and
 * every database span the server span owns, i.e. whose nearest server ancestor
 * it is, so a hop's work stays with the hop's receiving server span; same
 * trace). Used
 * to describe a server span that no action owns (a listing, never a join to
 * an action).
 */
export function serverSpanDescendants(server, spans) {
  if (!server?.span_id || !Array.isArray(spans)) return { handlers: [], databases: [], responded_by: null };
  const candidates = spans.filter(span => span?.schema === 'producttrace.backend-span.v1' && span.trace_id === server.trace_id);
  const { handlers, databases, responded_by } = serverSubtree(server, candidates);
  return { handlers, databases, responded_by };
}

const FRONTIER_DEPTH = { network: 1, server: 2, handler: 3, db: 4 };
const WRITE_OPERATION = /^(?:insert|update|delete|remove|replace|findandmodify|bulk)/iu;

/**
 * Per-request frontier. Backend evidence is admitted only through the exact
 * joins produced by attachBackendSpans; nothing is inferred from URLs, timing,
 * or the absence of spans. Whether the backend was instrumented is declared by
 * the caller.
 */
function requestFrontier(request, joined, backendInstrumented) {
  const occurrence = request.request_occurrence_id || null;
  const own = row => occurrence && row.request_occurrence_id === occurrence;
  if (!backendInstrumented) return { depth: 'network', stopped_at: 'network', because: 'backend not instrumented', routes: [], handlers: [], databases: [] };
  const routes = joined.filter(row => row.kind === 'route.dispatch' && own(row));
  const handlers = joined.filter(row => row.kind === 'handler.enter' && own(row));
  const databases = joined.filter(row => row.kind === 'db.operation' && own(row));
  const hops = joined.filter(row => row.kind === 'server.hop' && own(row));
  if (!routes.length) {
    const diagnostic = joined.find(row => row.kind === 'span.join.diagnostic' && own(row));
    return { depth: 'network', stopped_at: 'network', because: 'no span on trace', diagnostic_sequence: diagnostic?.sequence ?? null,
      diagnostic_reason: diagnostic?.reason || null, routes, handlers, databases, hops };
  }
  // Code other than a route handler ended the request (fix/middleware-reads):
  // that code is the request's terminal handler.
  const ender = terminalMiddleware(routes[0], handlers);
  if (ender) return { depth: databases.length ? 'db' : 'server', stopped_at: 'middleware', because: ender.because, responded_by: ender.responded_by, routes, handlers, databases, hops };
  // Every database span under the server span belongs to the request; the
  // terminal join needs work after the preconditions (preconditionsOnly).
  const preconditions = preconditionsOnly(databases, routes[0]);
  if (preconditions) return { depth: 'db', stopped_at: handlers.length ? 'handler' : 'server', because: preconditions.because, routes, handlers, databases, hops };
  if (databases.length) return { depth: 'db', stopped_at: null, because: null, routes, handlers, databases, hops };
  if (!handlers.length) return { depth: 'server', stopped_at: 'server', because: 'no handler span under server span', routes, handlers, databases, hops };
  return { depth: 'handler', stopped_at: 'handler', because: 'no db span under handler', routes, handlers, databases, hops };
}

// Ruling 2026-09-24 (G4 amendment, fix/middleware-reads): reads by app-level
// middleware, `router.param` callbacks and routers are the request's
// preconditions, not its effect. Work by the route's handler (including
// middleware registered on the route itself, which runs as a handler span),
// by an error middleware, by the code that wrote the response, by an app span
// or by unknown code is not a precondition. Any write is an effect.
const PRECONDITION_KINDS = new Set(['middleware', 'param', 'router']);
export const PRECONDITIONS_NOTE = 'no database work after the preconditions';
export function isPrecondition(op, route = null) {
  const kind = op?.issuer?.kind;
  if (!PRECONDITION_KINDS.has(kind)) return false;
  if (WRITE_OPERATION.test(String(op.operation || ''))) return false;
  // A hop's operation is judged against that hop's own receiving server (who
  // wrote its response), by the same rule as the request's own reads.
  const by = op?.hop ? op.hop_responded_by : route?.responded_by;
  return !(by?.span_id && by.span_id === op.issuer.span_id);
}
/** `find users by middleware requireJwtAuth, find logs ×4 by middleware checkBan`. */
export function preconditionsText(ops) {
  const counts = new Map();
  for (const op of ops) { const key = `${op.operation} ${op.collection}\u0000${ISSUER_KIND_LABELS[op.issuer?.kind] || 'issuer'} ${op.issuer?.name || '<anonymous>'}${op.hop ? ` in hop ${op.hop}` : ''}`; counts.set(key, (counts.get(key) || 0) + 1); }
  return [...counts].map(([key, count]) => { const [base, by] = key.split('\u0000'); return `${base}${count > 1 ? ` ×${count}` : ''} by ${by}`; }).join(', ');
}
/**
 * When every database operation of one request is a precondition (and there is
 * at least one), `{ ops, text, because }`; else null.
 */
export function preconditionsOnly(databases, route = null) {
  if (!databases?.length || !databases.every(op => isPrecondition(op, route))) return null;
  const text = preconditionsText(databases);
  return { ops: databases, text, because: `${PRECONDITIONS_NOTE} (${text})` };
}

const TERMINAL_KINDS = new Set(['middleware', 'param', 'error_handler']);
/**
 * The request's terminal handler when it is not a route handler: the joined
 * route row's `responded_by` names a middleware, a param callback or an error
 * middleware. Returns `{ because, responded_by }` or null (a route handler or
 * unknown code responded, or the backend did not record who responded).
 */
export function terminalMiddleware(route, handlers = []) {
  const by = route?.responded_by;
  if (!by || !TERMINAL_KINDS.has(by.kind)) return null;
  const status = Number.isFinite(Number(by.status_code)) ? Number(by.status_code) : (route.status_code ?? '?');
  const names = [...new Set(handlers.map(row => row.name).filter(Boolean))];
  const after = handlers.length ? `after handler ${names.join(', ') || '<anonymous>'}` : 'no handler ran';
  return { responded_by: by, because: `server responded ${status} from ${ISSUER_KIND_LABELS[by.kind]} ${by.name || '<anonymous>'}; ${after}`,
    text: `stopped at ${ISSUER_KIND_LABELS[by.kind]} ${by.name || '<anonymous>'} (${status}); ${after}` };
}

/**
 * One chain per dom.action, ending in either the deepest exactly-joined stop
 * or an explicit frontier ({stopped_at, because}). `backendInstrumented` must
 * be declared: an empty span list cannot distinguish "backend off" from a
 * broken exporter, so it is never inferred.
 */
export function buildActionChains(input, spans = [], { backendInstrumented, registeredFunctionIds = null, errorClassName = null } = {}) {
  if (!Array.isArray(input)) throw new TypeError('records must be an array');
  const records = mergeRequestFacts(input);
  if (typeof backendInstrumented !== 'boolean') throw new TypeError('backendInstrumented must be declared true or false');
  if (!Array.isArray(spans)) throw new TypeError('spans must be an array');
  const joined = backendInstrumented ? attachBackendSpans(records, spans) : records;
  const index = indexEntryHandlerUnits(records, { registeredFunctionIds });
  const ownerOf = row => row?.action_id || index.continuationOwner.get(row?.continuation_id) || index.continuationOwner.get(row?.parent_continuation_id) || null;
  const requestsByAction = new Map(), mutationsByAction = new Map(), workerPostsByAction = new Map();
  for (const row of records) {
    const owner = ownerOf(row); if (!owner) continue;
    const target = row.kind === 'network.request' && row.internal !== true ? requestsByAction
      : row.kind === 'dom.mutation' ? mutationsByAction : row.kind === 'worker.postMessage' ? workerPostsByAction : null;
    if (!target) continue;
    const values = target.get(owner) || []; values.push(row); target.set(owner, values);
  }
  const chains = [];
  const sendsByAction = new Map();
  for (const row of records) if (row?.kind === 'network.send' && row.action_id) { const list = sendsByAction.get(row.action_id) || []; list.push(row); sendsByAction.set(row.action_id, list); }
  const episodes = indexWorkflowEpisodes(records);
  const outcomes = new Map();
  // One window index for every episode (the same one the store passes).
  const windows = indexUnlinkedEvidence(records, spans);
  const episodeRecord = episode => {
    if (!outcomes.has(episode.episode_id)) outcomes.set(episode.episode_id, buildEpisodeChain(episode, records, spans,
      { registeredFunctionIds, idle: true, backendInstrumented, unlinked: windows, errorClassName }));
    return outcomes.get(episode.episode_id);
  };
  // Episode-focus rule 3, as in the store: a non-carrier member's outcome is
  // its own (the one label function over its own steps) plus the pointer.
  const episodeOutcome = action => {
    const { episode, standalone } = episodeForAction(episodes, action.action_id, action);
    const full = episodeRecord(episode);
    if (standalone || full.action_id === action.action_id) return { outcome: full.outcome, member: null, record: full };
    const pointer = memberPointer(episode, full);
    const own = buildEpisodeChain(memberScope(episode, action.action_id, action), records, spans, { registeredFunctionIds, idle: true, backendInstrumented, unlinked: windows, errorClassName });
    return { outcome: memberOutcome(own.outcome, pointer), member: { episode_member: true, episode_id: episode.episode_id, episode_carrier_action_id: full.action_id, episode_pointer: pointer }, record: own };
  };
  for (const action of records.filter(row => row?.kind === 'dom.action' && row.action_id)) {
    const unitId = index.byAction.get(action.action_id)?.[0] || null;
    const unit = unitId ? index.units.get(unitId) : null;
    const functionId = unitId ? unitId.slice(0, unitId.lastIndexOf('|')) : null;
    const creditedEntry = unit?.entries?.find(entry => entry.action_id === action.action_id && entry.binding !== undefined) || null;
    const entryHandler = functionId ? { function_id: functionId, unit_id: unitId, rooted: Boolean(unit?.rooted_action_ids?.includes(action.action_id)),
      ...(creditedEntry ? { binding: creditedEntry.binding } : {}), ...(creditedEntry?.unbound_request_issuers ? { unbound_request_issuers: creditedEntry.unbound_request_issuers } : {}) } : null;
    const reached = [{ stop: 'action', event: action.event || null, sequence: action.sequence ?? null }];
    if (entryHandler) reached.push({ stop: 'entry_handler', function_id: functionId, rooted: entryHandler.rooted });
    const requests = requestsByAction.get(action.action_id) || [];
    const perRequest = requests.map(request => ({ request, frontier: requestFrontier(request, joined, backendInstrumented) }));
    for (const { request } of perRequest) reached.push({ stop: 'request', request_occurrence_id: request.request_occurrence_id || null,
      method: request.method || null, url: request.url || null, sequence: request.sequence ?? null, ...(isClientAborted(request) ? { aborted_by_client: true } : {}) });
    let stopped_at, because;
    const abstention = index.abstentions.get(action.action_id) || null;
    const { posts, latest: latestPost } = workerPostsOf(workerPostsByAction.get(action.action_id));
    for (const post of posts) reached.push({ stop: 'worker', worker_id: post.worker_id || null, worker_kind: post.worker_kind || null,
      script_url: post.script_url || null, via: post.via || null, sequence: post.sequence ?? null });
    // The worker is the frontier unless a first-party request was attributed
    // after the latest post; the other frontier is kept as an additional stop.
    const workerPrimary = Boolean(latestPost) && !perRequest.some(({ request }) => recordedAfter(request, latestPost));
    let additional_stops = [];
    if (workerPrimary) {
      additional_stops = workerStops(posts).filter(stop => stop.worker_id !== latestPost.worker_id);
    }
    if (workerPrimary && !perRequest.length) {
      for (const mutation of mutationsByAction.get(action.action_id) || []) reached.push({ stop: 'dom_mutation', sequence: mutation.sequence ?? null });
      stopped_at = 'worker'; because = workerBecause(latestPost);
    } else if (!perRequest.length && abstention) {
      ({ stopped_at, because } = abstention);
    } else if (!perRequest.length) {
      for (const mutation of mutationsByAction.get(action.action_id) || []) reached.push({ stop: 'dom_mutation', sequence: mutation.sequence ?? null });
      stopped_at = 'browser'; because = SCOPED_ABSENCE.no_request;
    } else {
      // Deepest exact stop wins; among equals prefer a joined write, then the
      // latest request. The other requests keep their own frontier below.
      // A request the page aborted ranks after every request it did not abort.
      const ranked = [...perRequest].sort((left, right) => Number(isClientAborted(left.request)) - Number(isClientAborted(right.request))
        || FRONTIER_DEPTH[right.frontier.depth] - FRONTIER_DEPTH[left.frontier.depth]
        || Number(right.frontier.databases.some(row => WRITE_OPERATION.test(String(row.operation || ''))))
          - Number(left.frontier.databases.some(row => WRITE_OPERATION.test(String(row.operation || ''))))
        || Number(right.request.sequence || 0) - Number(left.request.sequence || 0));
      const deepest = ranked[0];
      for (const row of deepest.frontier.routes) reached.push({ stop: 'route', request_occurrence_id: row.request_occurrence_id, span_id: row.span_id });
      for (const row of deepest.frontier.handlers) reached.push({ stop: 'server_handler', request_occurrence_id: row.request_occurrence_id, span_id: row.span_id });
      for (const row of deepest.frontier.databases) reached.push({ stop: 'db', request_occurrence_id: row.request_occurrence_id, span_id: row.span_id,
        operation: row.operation || null, collection: row.collection || null, ...(row.hop ? { hop: row.hop } : {}) });
      ({ stopped_at, because } = deepest.frontier);
      if (workerPrimary) {
        additional_stops.unshift({ stopped_at, because, request_occurrence_id: deepest.request.request_occurrence_id || null });
        stopped_at = 'worker'; because = workerBecause(latestPost);
      } else if (posts.length) additional_stops = workerStops(posts);
    }
    // Outcome labels: the action's episode outcome, from the same episode
    // record the store (MCP) builds (buildEpisodeChain → actionOutcome), so an
    // action_id never carries two statuses. A finished export is idle.
    const { outcome, member, record: view } = episodeOutcome(action);
    // Server-to-server hops per request (the one hop builder); every escaped
    // hop is a stated frontier of its own.
    const hopsByRequest = new Map(perRequest.map(({ request, frontier }) => [request, frontier.hops?.length ? hopSegments(frontier.hops) : null]));
    for (const { request } of perRequest) for (const hop of hopsByRequest.get(request)?.escaped_hops || []) additional_stops.push({ reached: 'outbound', stopped_at: 'network',
      because: hop.summary, stop_reason: `outbound_${hop.join}`, hop: hop.hop, span_id: hop.span_id, request_occurrence_id: request.request_occurrence_id || null });
    // Same rule as chainFrontier: "terminal effect observed" only when no hop escaped.
    const lostHops = perRequest.flatMap(({ request }) => hopsByRequest.get(request)?.escaped_hops || []);
    if (stopped_at == null && lostHops.length) {
      stopped_at = 'server_hop';
      because = `reached db${because ? ` (${because})` : ''}; ${hopEscapeClause(lostHops)}`;
    }
    // The window rule of chainFrontier (causal-chain windowFrontier), on this
    // action's own requests and sends: root spans that could continue a
    // request withhold "terminal effect observed"; a WebSocket send is a stop;
    // a request-less action names the recorded requests that left the page.
    const occurrences = new Set(perRequest.map(({ request }) => request.request_occurrence_id).filter(Boolean));
    const scoped = { chain: [...(perRequest.length ? [{ kind: 'network.request' }] : []), ...(sendsByAction.get(action.action_id) || [])], window_evidence: view?.window_evidence ?? null,
      window_roots: view?.window_roots ? { ...view.window_roots, requests: view.window_roots.requests.filter(row => occurrences.has(row.request_occurrence_id)) } : null };
    const windowed = windowFrontier({ reached: perRequest.length ? 'db' : null, stopped_at, because, stop_reason: null }, scoped, { backendInstrumented });
    ({ stopped_at, because } = windowed);
    chains.push({ schema: 'producttrace.action-chain.v1', action_id: action.action_id, event: action.event || null,
      backend_instrumented: backendInstrumented, entry_handler: entryHandler, reached,
      ...(abstention ? { handler_abstention: abstention } : {}),
      // Where the action's target was resolved across shadow roots (runtime
      // dom.action target): the inner target of an open root, or the closed
      // root's host as a stated frontier.
      ...(action.target?.composed ? { target_frontier: action.target.closed_shadow
        ? { closed_shadow: true, host: action.target.tag || null, because: 'target inside a closed shadow root' }
        : { closed_shadow: false, host: action.target.shadow_host?.tag || null, target: action.target.tag || null } } : {}),
      stopped_at, because, ...(windowed.root_escape ? { root_escape: windowed.root_escape } : {}), outcome, ...(member || {}),
      ...(additional_stops.length ? { additional_stops } : {}),
      requests: perRequest.map(({ request, frontier }) => {
        // Operations, issuers, who responded and deferred work come from the one
        // segment builder (requestSegmentCore) on this request's own joined
        // steps; `stopped_at` / `because` keep this export's own (G1) wording.
        const core = backendInstrumented ? requestSegmentCore([{ ...request, kind: 'network.request' }, ...frontier.routes, ...frontier.handlers, ...frontier.databases, ...(frontier.hops || [])], { backendInstrumented }) : null;
        return { request_occurrence_id: request.request_occurrence_id || null,
          method: request.method || null, url: request.url || null, stopped_at: frontier.stopped_at, because: frontier.because,
          ...(frontier.diagnostic_sequence !== undefined ? { diagnostic_sequence: frontier.diagnostic_sequence, diagnostic_reason: frontier.diagnostic_reason } : {}),
          ...(core?.responded_by ? { responded_by: core.responded_by } : {}),
          // Every database operation under the request's server span, named by its issuer.
          db_ops: (core?.db_ops || []).map(op => ({ ...op, issuer: op.issuer ?? UNKNOWN_ISSUER, issued_by: op.issued_by ?? issuerText(op.issuer) })),
          ...(core?.deferred ? { deferred: core.deferred } : {}),
          writes: [...(core?.db_ops || []).filter(op => op.write).map(op => ({ operation: op.operation, collection: op.collection, span_id: op.span_id, issued_by: op.issued_by ?? issuerText(op.issuer) })),
            // A hop's writes (fix/server-outbound), marked with the hop.
            ...frontier.databases.filter(row => row.hop && WRITE_OPERATION.test(String(row.operation || ''))).map(row => ({ operation: row.operation, collection: row.collection, span_id: row.span_id,
              issued_by: row.issued_by ?? issuerText(row.issuer), hop: row.hop }))],
          ...(core?.hops?.length ? { hops: core.hops, escaped_hops: core.escaped_hops, hops_text: core.hops_text } : {}) };
      }) });
  }
  return chains;
}

/** Replay raw evidence with one evidence class removed; no replacement guesses are introduced. */
export function replayCausalChains(records, { removeKinds = [] } = {}) {
  const removed = new Set(removeKinds);
  const groups = new Map();
  for (const row of list(records)) {
    if (removed.has(row.kind)) continue;
    if (!row.action_id) continue;
    if (!groups.has(row.action_id)) groups.set(row.action_id, []);
    groups.get(row.action_id).push(row);
  }
  return [...groups].map(([action_id, rows]) => {
    const action = rows.find(row => row.kind === 'dom.action');
    const request = rows.find(row => row.kind === 'network.request');
    const routeRow = rows.find(row => row.kind === 'route.dispatch');
    const handlerRow = rows.find(row => row.kind === 'handler.enter');
    const db = rows.find(row => row.kind === 'db.operation');
    const missing = !action ? 'dispatch_evidence_removed' : !request ? 'request_evidence_removed' : !routeRow || !handlerRow ? 'span_evidence_removed' : null;
    return { schema: 'producttrace.causal-chain.v1', action_id, spine: request?.spine || { action_id, function_ids: [] }, chain: rows.map(row => ({ kind: row.kind, id: row.request_id || row.route_id || row.handler_id || row.db_id || `${row.kind}:${row.sequence}`, source_ref: row.source_ref || null, evidence_ids: row.evidence_ids || [] })), terminal: missing ? { stop_reason: missing } : { effect: { request_id: request.request_id, route_id: routeRow.route_id, handler_id: handlerRow.handler_id, db_id: db?.db_id || null } }, abstained: missing ? [missing] : [], raw_evidence_ids: rows.map(row => row.sequence) };
  });
}
