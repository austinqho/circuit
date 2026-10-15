/**
 * Session story: what each user did, as plain sentences with the IDs the
 * recorded evidence carries. One small interface over the whole engine:
 *
 *   storyOf(store, { session })  →  { sessions, lines }
 *
 * Deterministic and model-free: every sentence is built from rows in the
 * store (dom.action, network.request, network.body, function spans). Labels
 * come from the control's visible name (runtime `labels`), IDs only from
 * request URLs and bodies, never from typed text. A line says what the
 * person did and what it visibly caused (requests, navigations); focus moves
 * and gesture noise are left out, and engine diagnostics go in `detail`.
 */
import { chainStops, isIdSegment } from '../mcp/tools.mjs';
import { fileFingerprint, loadStore, storePaths } from './store.mjs';
import { entitiesOfValues, listOf, narrativeOf, resourceOf, segmentsOf, valuesOf } from './narration.mjs';

export const STORY_SCHEMA = 'producttrace.story.v1';

// Focus moving is bookkeeping: a line only when it caused something ("Left the … field → PUT …").
const FOCUS = new Set(['focus', 'blur', 'focusin', 'focusout', 'DOMFocusIn', 'DOMFocusOut']);
const LEAVING = new Set(['blur', 'focusout', 'DOMFocusOut']);
// Silent unless they caused something: gestures, and the key events around text entry.
const QUIET = new Set(['DOMActivate', 'pointerdown', 'pointerup', 'pointermove', 'pointerover', 'pointerout',
  'pointerenter', 'pointerleave', 'mousedown', 'mouseup', 'mousemove', 'scroll', 'scrollend', 'wheel', 'select', 'selectionchange', 'touchstart', 'touchend', 'touchmove',
  'compositionstart', 'compositionupdate', 'compositionend', 'beforeinput', 'animationend', 'animationstart', 'transitionend', 'transitionrun', 'transitionstart', 'gotpointercapture', 'lostpointercapture',
  'keydown', 'keypress', 'keyup', 'textInput']);
const HOVER = new Set(['mouseover', 'mouseout', 'mouseenter', 'mouseleave']);
// Text entry: one line per field however the text arrived (fill, key by key, paste).
const TEXT_ENTRY = new Set(['input', 'paste', 'cut', 'drop']);
// How long a request without a status reads as pending before it reads as never answered.
export const PENDING_MS = 30_000;
const FIELD_TAGS = new Set(['input', 'textarea', 'select']);
const HISTORY = new Set(['popstate', 'hashchange']);
const CLICKS = new Set(['click', 'auxclick', 'dblclick']);

// Engine ids (hex, uuid, numeric, prefix_…) plus opaque random ids such as
// nanoid/cuid: 10+ URL-safe characters mixing letters and digits, or 16+ mixing cases.
const looksLikeId = segment => isIdSegment(segment)
  || (/^[A-Za-z0-9_-]{10,}$/u.test(segment) && /\d/u.test(segment) && /[A-Za-z]/u.test(segment))
  || (/^[A-Za-z0-9_-]{16,}$/u.test(segment) && /[a-z]/u.test(segment) && /[A-Z]/u.test(segment));
const pageOf = row => row.capture_page_id || row.session_id || 'default';
const quote = text => `“${text}”`;
const singular = word => (/ies$/u.test(word) ? `${word.slice(0, -3)}y` : /(?:ss|us)$/u.test(word) ? word : word.replace(/s$/u, ''));

function pathOf(url) {
  try { const parsed = new URL(url, 'http://local.invalid'); return `${parsed.pathname}${parsed.search}`; } catch { return String(url || ''); }
}

/** IDs in a request or page URL: `/discussions/abc` → discussion abc, `?discussionId=abc` → discussion abc. */
export function idsInUrl(url, from) {
  const out = [];
  let parsed;
  try { parsed = new URL(url, 'http://local.invalid'); } catch { return out; }
  const segments = parsed.pathname.split('/').filter(Boolean);
  segments.forEach((segment, index) => {
    if (index > 0 && looksLikeId(segment) && !looksLikeId(segments[index - 1])) out.push({ type: singular(segments[index - 1]), id: segment, from });
  });
  for (const [key, value] of parsed.searchParams) {
    const match = /^(.+?)_?id$/iu.exec(key);
    if (match && value && looksLikeId(value)) out.push({ type: match[1].toLowerCase(), id: value, from });
  }
  return out;
}

/** The id of the entity a write returned: `{ id }`, `{ data: { id } }` or `{ <type>: { id } }`. */
function returnedId(json, type) {
  if (!json || typeof json !== 'object') return null;
  for (const candidate of [json, json.data, type ? json[type] : null]) {
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate) && (typeof candidate.id === 'string' || typeof candidate.id === 'number')) return String(candidate.id);
  }
  return null;
}

function elementPhrase(target) {
  if (!target) return 'the page';
  const tag = target.tag || 'element';
  const label = target.label;
  const role = target.attributes?.role;
  const kind = tag === 'a' || role === 'link' ? 'link' : tag === 'button' || role === 'button' ? 'button' : FIELD_TAGS.has(tag) ? 'field' : role || tag;
  if (label) return `the ${quote(label)} ${kind}`;
  // Generated ids (React useId, Radix: `radix-:r3:`) name nothing a person would recognise.
  const id = target.attributes?.id && !/[:]/u.test(target.attributes.id) ? target.attributes.id : null;
  const name = target.attributes?.name || target.attributes?.['data-testid'] || id;
  return name ? `the ${kind} ${quote(name)}` : `a ${kind}`;
}

function verbFor(row) {
  if (row.event === 'submit') return 'Submitted the form with';
  if (row.event === 'click' || row.event === 'auxclick' || row.event === 'dblclick') return row.event === 'dblclick' ? 'Double-clicked' : 'Clicked';
  if (row.event === 'contextmenu') return 'Right-clicked';
  if (HOVER.has(row.event)) return 'Hovered';
  // The runtime writes the key under `key` (printable keys fold to "Printable" unless inputText is on).
  if (row.event === 'keydown') return `Pressed ${row.key?.key && row.key.key !== 'Printable' ? row.key.key : 'a key'} on`;
  if (TEXT_ENTRY.has(row.event)) return 'Typed in';
  if (row.event === 'change') return 'Changed';
  if (LEAVING.has(row.event)) return 'Left';
  if (FOCUS.has(row.event)) return 'Focused';
  return `${row.event[0].toUpperCase()}${row.event.slice(1)} on`;
}

function requestFacts(store, request, requestRows, closed, now, show) {
  const row = requestRows.get(request.request_occurrence_id) || request;
  const bodies = typeof store.bodiesFor === 'function' ? store.bodiesFor(row) : null;
  const status = Number.isFinite(Number(bodies?.response?.status)) ? Number(bodies.response.status) : (Number.isFinite(Number(row.status)) ? Number(row.status) : null);
  const path = pathOf(request.url);
  const entities = idsInUrl(request.url, 'request_url');
  const method = String(request.method || 'GET').toUpperCase();
  if (method === 'POST') {
    let pathname = ''; try { pathname = new URL(request.url, 'http://local.invalid').pathname; } catch {}
    const type = singular(pathname.split('/').filter(Boolean).filter(part => !looksLikeId(part)).pop() || '');
    const id = returnedId(bodies?.response?.json, type);
    if (id && type) entities.push({ type, id, from: 'response_body', created: true });
  }
  // What the bodies said: values sent with a write, values and ids returned for one entity, the size of a list.
  // `/me` is the signed-in user.
  const resource = resourceOf(path, looksLikeId);
  const type = resource.verb === 'me' ? 'user' : resource.type;
  const values = [];
  let list = null;
  if (bodies?.request?.json && method !== 'GET') values.push(...valuesOf(bodies.request.json, { from: 'request_body', type, show }));
  if (bodies?.response?.json) {
    list = listOf(bodies.response.json, { type, truncated: bodies.response.truncated === true, show });
    if (!list) values.push(...valuesOf(bodies.response.json, { from: 'response_body', type, show }));
  }
  for (const from of ['request_body', 'response_body']) {
    for (const entity of entitiesOfValues(values.filter(entry => entry.from === from), { type, from })) {
      if (!entities.some(seen => seen.type === entity.type && seen.id === entity.id)) entities.push(entity);
    }
  }
  // No status yet: still in flight while its page is open (when bodies, and so statuses, are recorded).
  // A page that died without closing (crashed tab, killed browser) never says so: past PENDING_MS, stop waiting.
  const bodiesOn = typeof store.coverageFor === 'function' ? store.coverageFor(pageOf(row))?.bodies === 'on' : false;
  const waited = Number.isFinite(row.timestamp) && now - row.timestamp > PENDING_MS;
  const state = row.aborted ? 'aborted' : status !== null ? 'done' : !bodiesOn ? 'not_recorded' : closed.has(pageOf(row)) || waited ? 'no_response' : 'pending';
  return { method, path, status, state, aborted: Boolean(row.aborted), entities, request_occurrence_id: request.request_occurrence_id, sequence: row.sequence ?? null, ...(list ? { list } : {}), ...(values.length ? { values } : {}) };
}

function requestPhrase(facts) {
  const created = facts.entities.find(entity => entity.created);
  const status = { done: facts.status, aborted: 'aborted', pending: 'pending', no_response: 'no response recorded', not_recorded: 'status not recorded' }[facts.state];
  return `${facts.method} ${facts.path} (${status}${created ? `, created ${created.type} ${created.id}` : ''})`;
}

/**
 * What else is known about an action, in plain words, for a reader who opens
 * the line: never part of the line itself.
 */
function detailOf(chain, requests, navigations) {
  const notes = [];
  const handler = handlerOf(chain);
  if (handler?.name) notes.push(`Handled by ${handler.name}${handler.file ? ` in ${handler.file}` : ''}.`);
  const did = chain.outcome?.did;
  if (!requests.length && !navigations.length && did) {
    if (!did.functions_entered) notes.push('None of the app\'s own code ran.');
    else {
      const changed = [did.dom_mutations && `${did.dom_mutations} page update${did.dom_mutations === 1 ? '' : 's'}`, did.state_effects && `${did.state_effects} state change${did.state_effects === 1 ? '' : 's'}`].filter(Boolean);
      notes.push(`The app's code ran${changed.length ? ` and made ${changed.join(' and ')},` : ''} and sent no request.`);
    }
  }
  return notes.length ? notes.join(' ') : null;
}

/** "/app/discussions/d1 (discussion d1)": a page path with the ids it carries. */
function navPhrase(to) {
  const ids = idsInUrl(to, 'page_url');
  return `${to}${ids.length ? ` (${ids.map(entity => `${entity.type} ${entity.id}`).join(', ')})` : ''}`;
}

const pathOnly = url => String(url || '').split('?')[0].split('#')[0];

function handlerOf(chain) {
  const stop = chain.stops.find(entry => entry.stop === 'entry_handler');
  // Only a function bound to the element as a handler is "the handler": the
  // first code to run can also be a router loader or another continuation.
  if (!stop || !stop.binding) return null;
  // `<not in manifest>` and similar placeholders are not names.
  const name = [stop.display_name, stop.name].find(value => typeof value === 'string' && value && !/^<(?:not |anonymous>)/u.test(value)) || null;
  return { name, file: stop.source?.file ?? null, line: stop.source?.line ?? null };
}

/**
 * The story of one session (capture page), or of every session when none is
 * given, oldest first. `lines[].id` is stable across calls and unique (the
 * action id; for a navigation of its own, `nav:<page load>:<sequence>`), so a
 * live reader can append only new ones.
 */
export function storyOf(store, { session, now = Date.now(), titleOf = null, values: show = {} } = {}) {
  // Pages that have closed (capture.summary on pagehide): a request still without a status there never got one.
  const closed = new Set(store.records.filter(row => row?.kind === 'capture.summary').map(row => row.page_id || pageOf(row)));
  const requestRows = new Map(store.records.filter(row => row?.kind === 'network.request' && row.request_occurrence_id).map(row => [row.request_occurrence_id, row]));
  // Client-side navigations (page.navigate rows): owned by the action whose
  // continuation called pushState/replaceState, or by none (back/forward, timers).
  const navigations = store.records.filter(row => row?.kind === 'page.navigate' && (session === undefined || pageOf(row) === session));
  const navsByAction = new Map();
  for (const nav of navigations) if (nav.action_id) navsByAction.set(nav.action_id, [...(navsByAction.get(nav.action_id) || []), nav]);
  const recordsNavigation = new Set(navigations.map(pageOf));
  const sessions = new Map();
  const lines = [];
  const lastPage = new Map();
  let typing = null;
  const navLine = (nav, at) => {
    // Sequence numbers restart on every page load: the load is part of the id.
    return { schema: STORY_SCHEMA, id: `nav:${pageOf(nav)}:${nav.sequence ?? nav.to}`, kind: 'navigate', session: pageOf(nav), at, page: nav.to,
      text: `${nav.via === 'popstate' ? 'Went back/forward to' : 'Went to'} ${navPhrase(nav.to)}`, entities: idsInUrl(nav.to, 'page_url'),
      navigations: [{ to: nav.to, from: nav.from ?? null, via: nav.via ?? null }] };
  };
  const unowned = navigations.filter(nav => !nav.action_id);
  const actions = store.actionRows.filter(row => session === undefined || pageOf(row) === session);
  const mine = row => session === undefined || pageOf(row) === session;
  // Page loads: one "Opened" line each, carrying the requests no action caused before the first action.
  const loads = store.records.filter(row => row?.kind === 'capture.page' && row.page_id).map(row => ({ ...row, capture_page_id: row.page_id })).filter(mine);
  // Scrolls: recorded as ranges (first and last position); told when they moved at least a screen.
  const scrolls = store.records.filter(row => row?.kind === 'dom.action.range' && (row.event === 'scroll' || row.event === 'scrollend') && row.scroll?.first && row.scroll?.last).filter(mine);
  // Sequence numbers are per page load: order within a page by sequence, pages by when they started.
  const pageStart = new Map();
  for (const entry of [...loads, ...actions, ...unowned]) { const key = pageOf(entry); pageStart.set(key, Math.min(pageStart.get(key) ?? Infinity, entry.timestamp ?? Infinity)); }
  const timeline = [...loads.map(load => ({ load })), ...actions.map(row => ({ row })), ...unowned.map(nav => ({ nav })), ...scrolls.map(range => ({ range }))].sort((a, b) => {
    const x = a.load || a.row || a.nav || a.range, y = b.load || b.row || b.nav || b.range;
    const byPage = (pageStart.get(pageOf(x)) - pageStart.get(pageOf(y))) || (pageOf(x) < pageOf(y) ? -1 : pageOf(x) > pageOf(y) ? 1 : 0);
    return byPage || (x.sequence ?? 0) - (y.sequence ?? 0);
  });
  const opens = new Map();
  const firstTold = new Map();
  const typed = new Set();
  const loadRequests = store.records.filter(row => row?.kind === 'network.request' && !row.action_id && row.request_occurrence_id && String(row.method || 'GET').toUpperCase() !== 'CONNECT');
  const sessionOf = (page, row) => {
    if (!sessions.has(page)) sessions.set(page, { session: page, started_at: row.timestamp ?? null, actions: 0, first_page: row.page ?? null });
    return sessions.get(page);
  };
  for (const { row, nav, load, range } of timeline) {
    if (nav) { lines.push(navLine(nav, nav.timestamp ?? null)); lastPage.set(pageOf(nav), pathOnly(nav.to)); typing = null; continue; }
    if (load) {
      const page = pageOf(load);
      const path = load.url ? pathOnly(pathOf(load.url)) || '/' : null;
      sessionOf(page, { ...load, page: path });
      // Its requests are filled in once the first told action of this load is known (a hover over the page is not one).
      const line = { schema: STORY_SCHEMA, id: `open:${page}`, kind: 'open', session: page, at: load.timestamp ?? null, page: path, text: null, requests: [], navigations: [], entities: [] };
      lines.push(line); opens.set(page, line);
      if (path) lastPage.set(page, path);
      typing = null;
      continue;
    }
    if (range) {
      const page = pageOf(range);
      // Only movement within a range counts: a jump between ranges (scrollIntoView, focus, the app resetting
      // the page on a navigation) is a single event that moves without the person scrolling.
      const moved = range.scroll.last[1] - range.scroll.first[1];
      const travel = Math.abs(moved);
      const previous = lines.at(-1);
      if (previous?.kind === 'scroll' && previous.session === page && previous.target_ref === (range.target_ref ?? null)) {
        previous.travel += travel; previous.net += moved; if (!previous.first_move) previous.first_move = moved; previous.at_end = range.last_timestamp ?? range.timestamp ?? null;
        continue;
      }
      lines.push({ schema: STORY_SCHEMA, id: range.action_id || `scroll:${page}:${range.sequence}`, kind: 'scroll', session: page, at: range.first_timestamp ?? range.timestamp ?? null, at_end: range.last_timestamp ?? null,
        page: lastPage.get(page) ?? null, target_ref: range.target_ref ?? null, viewport: range.scroll.viewport ?? null, whole_page: range.scroll.page ?? null, travel, net: moved, first_move: moved });
      continue;
    }
    const page = pageOf(row);
    const info = sessionOf(page, row);
    info.ended_at = row.timestamp ?? info.ended_at;
    const owned = navsByAction.get(row.action_id) || [];
    // Navigations of an action that is not told still happened: each gets its own line.
    const orphan = () => { for (const entry of owned) lines.push(navLine(entry, entry.timestamp ?? row.timestamp ?? null)); if (owned.length) typing = null; };
    if (!owned.length && typeof store.contextOnly === 'function' && store.contextOnly(row.action_id)) continue;
    // Back/forward is told by its navigation ("Went back/forward to …"), not as an event on the window.
    if (HISTORY.has(row.event)) { orphan(); continue; }
    let chain;
    try { chain = chainStops(store, row.action_id); } catch { orphan(); continue; }
    const requests = (chain.requests || []).map(request => requestFacts(store, request, requestRows, closed, now, show));
    const key = row.target?.element_key || row.target?.ref || row.target?.attributes?.name || null;
    // Typing that only rewrites the query of the same page (a search box synced to the URL) is still typing.
    const urlOnly = owned.length > 0 && !requests.length && owned.every(entry => entry.via === 'replaceState' && pathOnly(entry.to) === pathOnly(entry.from));
    const quietUrl = urlOnly && (TEXT_ENTRY.has(row.event) || QUIET.has(row.event) || row.event === 'change');
    const effect = requests.length > 0 || (owned.length > 0 && !quietUrl);
    const caused = effect || (chain.outcome?.stage && !['no_request', 'dispatch'].includes(chain.outcome.stage) && chain.stops.some(stop => stop.stop === 'entry_handler'));
    if (quietUrl && typing && typing.key === key && typing.session === page) typing.line.navigations = owned.map(entry => ({ to: entry.to, from: entry.from ?? null, via: entry.via ?? null }));
    if (!effect && (QUIET.has(row.event) || HOVER.has(row.event) || FOCUS.has(row.event))) continue;
    // A change that ends typing in the same field says nothing new; a change on its own (a select, a checkbox) is a choice.
    if (row.event === 'change' && !effect && key !== null && typed.has(`${page}\u0000${key}`)) continue;
    // A click on a submit button that did nothing itself is told by its submit.
    if (row.event === 'click' && !caused && row.target?.attributes?.type === 'submit') continue;
    // Runtimes without page.navigate rows: a page change between two actions is its own line.
    if (!recordsNavigation.has(page) && row.page && lastPage.get(page) && lastPage.get(page) !== row.page) {
      lines.push(navLine({ to: row.page, action_id: null, sequence: row.sequence, capture_page_id: page }, row.timestamp ?? null));
      typing = null;
    }
    if (row.page) lastPage.set(page, row.page);
    // Where the person is now: a navigation this action made moves them (a scroll after it is on the new page).
    if (owned.length && !quietUrl) lastPage.set(page, pathOnly(owned.at(-1).to));
    // Text entry into one field with no effect is one line, however many events it took.
    if (TEXT_ENTRY.has(row.event) && !effect) {
      const urlNavs = quietUrl ? owned.map(entry => ({ to: entry.to, from: entry.from ?? null, via: entry.via ?? null })) : null;
      // Without a key, two fields cannot be told apart: never merge.
      if (key !== null && typing && typing.key === key && typing.session === page) {
        typing.line.at_end = row.timestamp ?? null; typing.line.count += 1;
        if (urlNavs) typing.line.navigations = urlNavs;
        continue;
      }
      const secret = row.input?.credential_field === true || row.target?.attributes?.type === 'password';
      const line = { schema: STORY_SCHEMA, id: row.action_id, kind: 'type', session: page, at: row.timestamp ?? null, page: row.page ?? null, count: 1,
        text: secret ? `Typed a password in ${elementPhrase(row.target)}` : `Typed in ${elementPhrase(row.target)}`,
        element: { tag: row.target?.tag ?? null, label: row.target?.label ?? null, key: row.target?.element_key ?? null }, action_id: row.action_id, ...(urlNavs ? { navigations: urlNavs } : {}),
        form: row.form_ref ?? null, field: row.target?.attributes?.name ?? null, ...(secret ? { secret: true } : {}) };
      lines.push(line); info.actions += 1;
      if (!firstTold.has(page)) firstTold.set(page, row.sequence ?? Infinity);
      if (key !== null) typed.add(`${page}\u0000${key}`);
      typing = { key, session: page, line };
      continue;
    }
    typing = null;
    const handler = handlerOf(chain);
    const pageIds = owned.flatMap(entry => idsInUrl(entry.to, 'page_url'));
    const entities = [];
    for (const entity of [...requests.flatMap(request => request.entities), ...pageIds]) if (!entities.some(seen => seen.type === entity.type && seen.id === entity.id && seen.from === entity.from)) entities.push(entity);
    // Leaving one element is entering another: a mouseout's hover is on its related target.
    const subject = (row.event === 'mouseout' || row.event === 'mouseleave') && row.related_target ? row.related_target : row.target;
    // A hover that only prefetched for the control then clicked is part of that click.
    let prefetched = null;
    // Scrolls in between (bringing the control into view) don't separate them.
    let at = lines.length - 1;
    while (at >= 0 && lines[at].kind === 'scroll' && lines[at].session === page) at -= 1;
    const last = lines[at];
    // Same control by its key, or (when the hover's element had none) the same label naming the same entity the click opens.
    const reaches = new Set([...owned.flatMap(entry => idsInUrl(entry.to, 'page_url')), ...requests.flatMap(request => request.entities)].map(entity => `${entity.type}:${entity.id}`));
    const sameControl = last?.element?.key ? last.element.key === subject?.element_key
      : last?.element?.label && last.element.label === subject?.label && last.element.tag === subject?.tag && (last.entities || []).some(entity => reaches.has(`${entity.type}:${entity.id}`));
    if (CLICKS.has(row.event) && last?.kind === 'hover' && last.session === page && sameControl && !last.navigations.length) {
      prefetched = lines.splice(at, 1)[0]; info.actions -= 1;
      requests.unshift(...prefetched.requests);
    }
    // What it caused, in the order it happened: consecutive requests read as one list.
    const effects = [...requests.map(request => ({ sequence: request.sequence, request })), ...owned.map(entry => ({ sequence: entry.sequence, to: entry.to }))]
      .map((entry, order) => ({ ...entry, order })).sort((a, b) => ((a.sequence ?? Infinity) - (b.sequence ?? Infinity)) || a.order - b.order);
    const parts = [`${verbFor(row)} ${elementPhrase(subject)}`];
    for (const entry of effects) {
      if (entry.request && Array.isArray(parts.at(-1))) parts.at(-1).push(requestPhrase(entry.request));
      else parts.push(entry.request ? [requestPhrase(entry.request)] : `went to ${navPhrase(entry.to)}`);
    }
    lines.push({ schema: STORY_SCHEMA, id: row.action_id, kind: row.event === 'submit' ? 'submit' : HOVER.has(row.event) ? 'hover' : 'act', session: page, at: row.timestamp ?? null, page: row.page ?? null,
      text: parts.map(part => Array.isArray(part) ? part.join(', ') : part).join(' → '), event: row.event,
      element: { tag: subject?.tag ?? null, label: subject?.label ?? null, key: subject?.element_key ?? null },
      handler, requests, navigations: owned.map(entry => ({ to: entry.to, from: entry.from ?? null, via: entry.via ?? null })), entities, detail: detailOf(chain, requests, owned), action_id: row.action_id,
      form: row.form_ref ?? null, ...lineValues(requests), ...(prefetched ? { prefetched_on_hover: prefetched.id } : {}) });
    info.actions += 1;
    if (!firstTold.has(page)) firstTold.set(page, row.sequence ?? Infinity);
  }
  // Each page load's opening requests: what no action caused before the first action that is told.
  for (const [page, line] of opens) {
    const before = firstTold.get(page) ?? Infinity;
    // Request occurrence ids repeat across page loads: read this load's rows, not the shared index.
    line.requests = loadRequests.filter(request => pageOf(request) === page && (request.sequence ?? 0) < before)
      .map(request => requestFacts(store, request, new Map([[request.request_occurrence_id, request]]), closed, now, show));
    line.entities = line.requests.flatMap(request => request.entities);
    line.text = [`Opened ${line.page ?? 'the page'}`, line.requests.map(requestPhrase).join(', ')].filter(Boolean).join(' → ');
    Object.assign(line, lineValues(line.requests));
  }
  // Scrolls that moved less than a screen say nothing; the rest say how far.
  const told = lines.filter(line => {
    if (line.kind !== 'scroll') return true;
    const screen = line.viewport || FALLBACK_SCREEN;
    if (line.travel < screen) return false;
    line.screens = Math.max(1, Math.round(line.travel / screen));
    // Ending about where it started: down and back up (or the other way).
    const returned = Math.abs(line.net) < screen / 2;
    const way = move => (move > 0 ? 'down' : 'up');
    line.direction = returned ? (line.first_move ? `${way(line.first_move)} and back ${way(-line.first_move)}` : null) : way(line.net);
    line.text = `Scrolled ${line.direction ? `${line.direction} ` : ''}${line.whole_page === false ? 'a section of the page' : 'the page'} (≈${line.screens} screen${line.screens === 1 ? '' : 's'})`;
    delete line.travel; delete line.net; delete line.whole_page; delete line.first_move;
    return true;
  });
  const segments = segmentsOf(told, { looksLikeId, titleOf, closedSessions: closed });
  return { schema: STORY_SCHEMA, sessions: [...sessions.values()], lines: told, segments, narrative: narrativeOf(segments) };
}

// A screen when the runtime did not record one (older runtimes).
const FALLBACK_SCREEN = 800;

/** The values a line's requests carried, de-duplicated (ids are on `entities`). */
function lineValues(requests) {
  const values = [];
  for (const entry of requests.flatMap(request => request.values || [])) if (!values.some(seen => seen.key === entry.key && seen.from === entry.from && seen.value === entry.value)) values.push(entry);
  return values.length ? { values } : {};
}

/**
 * A live story over a store directory: re-reads the store only when its files
 * change, so a page can poll it or subscribe without re-running the engine.
 */
export function createStoryFeed({ dir, sourceRoot = null, titleOf = null, values = {} }) {
  let cached = null;
  let key = null;
  let loading = null;
  // One load at a time, shared by every caller (several open streams tick together).
  const load = fingerprint => {
    if (!loading) loading = loadStore({ dir, sourceRoot }).then(store => { cached = store; key = fingerprint; cached.__story = new Map(); }).finally(() => { loading = null; });
    return loading;
  };
  return async function current({ session } = {}) {
    const paths = storePaths({ dir });
    let fingerprint;
    try { fingerprint = fileFingerprint(paths); } catch { fingerprint = null; }
    if (!cached || fingerprint === null || fingerprint !== key) {
      try { await load(fingerprint); } catch (error) { if (error.code === 'STORE_NOT_FOUND') return { schema: STORY_SCHEMA, sessions: [], lines: [], segments: [], narrative: [] }; throw error; }
    }
    const memo = session ?? '\u0000all';
    // A story with pending requests changes as time passes (pending becomes "no response"), so re-tell it each second.
    const hit = cached.__story.get(memo);
    if (hit && (!hit.pending || Date.now() - hit.at < 1000)) return hit.story;
    const story = storyOf(cached, { session, titleOf, values });
    cached.__story.set(memo, { story, at: Date.now(), pending: story.lines.some(line => line.requests?.some(request => request.state === 'pending')) });
    return story;
  };
}
