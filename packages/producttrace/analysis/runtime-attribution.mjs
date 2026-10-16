import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { buildEpisodeChain, episodeForAction, hopEscapeClause, hopSegments, indexUnlinkedEvidence, memberOutcome, memberPointer, memberScope, requestSegmentCore, windowFrontier } from './causal-chain.mjs';
import { USER_EVENT_KINDS } from './user-event-model.mjs';
import { list, spanAttr, spanDbDetails, NO_REQUEST_SCOPED, SCOPED_ABSENCE, WORKER_STOP_REASON, isWorkerPost, workerBecause, evidenceOrder, workerPostsOf, recordedAfter, workerStops, REQUEST_FACT_KINDS, ABORT_FIELDS, factKey, mergeRequestFacts, isClientAborted, indexEntryHandlerUnits, bindingSummary, rowOrder, rejectedSubmitMutation, describeEpisodeEvidence, describeEpisodeEvidenceBase, spanAttribute, spanPath, spanMethod, isDatabaseSpan, spanMsOf, HANDLER_INSTRUMENTATION, NON_ROUTE_HANDLER_KINDS, isRouteHandlerSpan, ISSUER_KIND_LABELS, RESPONSE_STATUS_ATTRIBUTE, spanIssuer, UNKNOWN_ISSUER, issuerText, nearestIssuer, brokenAncestry, serverSubtree, nearestServer, ownedBy, isOutboundSpan, spanStart, outboundUrl, HOP_JOIN_PREDICATE, APP_TRACEPARENT_ATTRIBUTE, APP_TRACEPARENT_VALUE_ATTRIBUTE, hopFollowed, spanEnd, parseTraceparent, traceIndexCache, traceIndex, hopClaims, serverHops, hopReceiverSpanIds, attachBackendSpans, serverSpanDescendants, WRITE_OPERATION, PRECONDITION_KINDS, PRECONDITIONS_NOTE, isPrecondition, preconditionsText, preconditionsOnly, TERMINAL_KINDS, terminalMiddleware } from './evidence-facts.mjs';
export { SCOPED_ABSENCE, WORKER_STOP_REASON, isWorkerPost, workerBecause, workerPostsOf, recordedAfter, workerStops, mergeRequestFacts, isClientAborted, indexEntryHandlerUnits, bindingSummary, rejectedSubmitMutation, describeEpisodeEvidence, ISSUER_KIND_LABELS, RESPONSE_STATUS_ATTRIBUTE, spanIssuer, UNKNOWN_ISSUER, issuerText, nearestIssuer, serverSubtree, isOutboundSpan, HOP_JOIN_PREDICATE, APP_TRACEPARENT_ATTRIBUTE, APP_TRACEPARENT_VALUE_ATTRIBUTE, hopFollowed, serverHops, hopReceiverSpanIds, attachBackendSpans, serverSpanDescendants, PRECONDITIONS_NOTE, isPrecondition, preconditionsText, preconditionsOnly, terminalMiddleware } from './evidence-facts.mjs';


const ID_SHAPED = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|[0-9a-f]{24})$/iu;

export function stableFunctionId(fileContent, start, end) {
  if (typeof fileContent !== 'string') throw new TypeError('fileContent must be a string');
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) {
    throw new TypeError('start/end must be a valid source span');
  }
  const contentHash = createHash('sha256').update(fileContent).digest('hex');
  return `function:${contentHash}:${start}:${end}`;
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

function spanDescends(span, ancestor, byId) {
  const seen = new Set(); let parent = span.parent_span_id;
  while (parent && !seen.has(parent)) { if (parent === ancestor) return true; seen.add(parent); parent = byId.get(parent)?.parent_span_id || null; }
  return false;
}

const FRONTIER_DEPTH = { network: 1, server: 2, handler: 3, db: 4 };

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
