/**
 * Session story: what each user did, as plain sentences with the IDs the
 * recorded evidence carries. One small interface over the whole engine:
 *
 *   storyOf(store, { session })  →  { sessions, lines }
 *
 * Deterministic and model-free: every sentence is built from rows in the
 * store (dom.action, network.request, network.body, function spans). Labels
 * come from the control's visible name (runtime `labels`), IDs only from
 * request URLs and bodies, never from typed text. Gesture noise (focus, blur,
 * pointer moves) that caused nothing is left out.
 */
import { chainStops, isIdSegment } from '../mcp/tools.mjs';
import { fileFingerprint, loadStore, storePaths } from './store.mjs';

export const STORY_SCHEMA = 'producttrace.story.v1';

const NOISE = new Set(['focus', 'blur', 'focusin', 'focusout', 'DOMFocusIn', 'DOMFocusOut', 'DOMActivate', 'pointerdown', 'pointerup', 'pointermove', 'pointerover', 'pointerout',
  'pointerenter', 'pointerleave', 'mousedown', 'mouseup', 'mousemove', 'keyup', 'scroll', 'scrollend', 'wheel', 'select', 'selectionchange', 'touchstart', 'touchend', 'touchmove',
  'compositionstart', 'compositionupdate', 'compositionend', 'beforeinput', 'animationend', 'animationstart', 'transitionend', 'transitionrun', 'transitionstart', 'gotpointercapture', 'lostpointercapture']);
const HOVER = new Set(['mouseover', 'mouseout', 'mouseenter', 'mouseleave']);
const TYPING = new Set(['input', 'change', 'keydown', 'keypress', 'paste', 'cut']);
const FIELD_TAGS = new Set(['input', 'textarea', 'select']);

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
  if (row.event === 'keydown') return `Pressed ${row.keyboard?.key && row.keyboard.key !== 'Printable' ? row.keyboard.key : 'a key'} on`;
  if (TYPING.has(row.event)) return 'Typed in';
  return `${row.event[0].toUpperCase()}${row.event.slice(1)} on`;
}

function requestFacts(store, request, requestRows) {
  const row = requestRows.get(request.request_occurrence_id) || request;
  const bodies = typeof store.bodiesFor === 'function' ? store.bodiesFor(row) : null;
  const status = Number.isFinite(Number(bodies?.response?.status)) ? Number(bodies.response.status) : (Number.isFinite(Number(row.status)) ? Number(row.status) : null);
  const path = pathOf(request.url);
  const entities = idsInUrl(request.url, 'request_url');
  const method = String(request.method || 'GET').toUpperCase();
  if (method === 'POST') {
    const type = singular(new URL(request.url, 'http://local.invalid').pathname.split('/').filter(Boolean).filter(part => !looksLikeId(part)).pop() || '');
    const id = returnedId(bodies?.response?.json, type);
    if (id && type) entities.push({ type, id, from: 'response_body', created: true });
  }
  return { method, path, status, aborted: Boolean(row.aborted), entities, request_occurrence_id: request.request_occurrence_id };
}

function requestPhrase(facts) {
  const created = facts.entities.find(entity => entity.created);
  const status = facts.aborted ? 'aborted' : facts.status ?? 'no response recorded';
  return `${facts.method} ${facts.path} (${status}${created ? `, created ${created.type} ${created.id}` : ''})`;
}

function handlerOf(chain) {
  const stop = chain.stops.find(entry => entry.stop === 'entry_handler');
  if (!stop) return null;
  return { name: stop.display_name || stop.name || null, file: stop.source?.file ?? null, line: stop.source?.line ?? null };
}

/**
 * The story of one session (capture page), or of every session when none is
 * given, oldest first. `lines[].id` is stable across calls (the action id, or
 * `nav:<action id>` for a navigation), so a live reader can append only new ones.
 */
export function storyOf(store, { session } = {}) {
  const requestRows = new Map(store.records.filter(row => row?.kind === 'network.request' && row.request_occurrence_id).map(row => [row.request_occurrence_id, row]));
  const sessions = new Map();
  const lines = [];
  const lastPage = new Map();
  let typing = null;
  const rows = store.actionRows.filter(row => session === undefined || pageOf(row) === session);
  for (const row of rows) {
    const page = pageOf(row);
    if (!sessions.has(page)) sessions.set(page, { session: page, started_at: row.timestamp ?? null, actions: 0, first_page: row.page ?? null });
    const info = sessions.get(page);
    info.ended_at = row.timestamp ?? info.ended_at;
    if (typeof store.contextOnly === 'function' && store.contextOnly(row.action_id)) continue;
    let chain;
    try { chain = chainStops(store, row.action_id); } catch { continue; }
    const requests = (chain.requests || []).map(request => requestFacts(store, request, requestRows));
    const caused = requests.length > 0 || (chain.outcome?.stage && !['no_request', 'dispatch'].includes(chain.outcome.stage) && chain.stops.some(stop => stop.stop === 'entry_handler'));
    if (NOISE.has(row.event) && !requests.length) continue;
    if (HOVER.has(row.event) && !requests.length) continue;
    // A click on a submit button that did nothing itself is told by its submit.
    if (row.event === 'click' && !caused && row.target?.attributes?.type === 'submit') continue;
    // Navigation between actions on the same page load (client-side routing).
    if (row.page && lastPage.get(page) && lastPage.get(page) !== row.page) {
      const ids = idsInUrl(row.page, 'page_url');
      lines.push({ schema: STORY_SCHEMA, id: `nav:${row.action_id}`, kind: 'navigate', session: page, at: row.timestamp ?? null, page: row.page,
        text: `Went to ${row.page}${ids.length ? ` (${ids.map(entity => `${entity.type} ${entity.id}`).join(', ')})` : ''}`, entities: ids });
    }
    if (row.page) lastPage.set(page, row.page);
    // Consecutive typing in one field with no effect is one line.
    if (TYPING.has(row.event) && !requests.length) {
      const key = row.target?.element_key || row.target?.ref || row.target?.attributes?.name || null;
      if (typing && typing.key === key && typing.session === page) { typing.line.at_end = row.timestamp ?? null; typing.line.count += 1; continue; }
      if (row.event === 'change' && typing?.key === key) continue;
      const secret = row.input?.credential_field === true || row.target?.attributes?.type === 'password';
      const line = { schema: STORY_SCHEMA, id: row.action_id, kind: 'type', session: page, at: row.timestamp ?? null, page: row.page ?? null, count: 1,
        text: secret ? `Typed a password in ${elementPhrase(row.target)}` : `Typed in ${elementPhrase(row.target)}`,
        element: { tag: row.target?.tag ?? null, label: row.target?.label ?? null, key: row.target?.element_key ?? null }, action_id: row.action_id };
      lines.push(line); info.actions += 1;
      typing = { key, session: page, line };
      continue;
    }
    typing = null;
    const handler = handlerOf(chain);
    const entities = requests.flatMap(request => request.entities);
    // Leaving one element is entering another: a mouseout's hover is on its related target.
    const subject = (row.event === 'mouseout' || row.event === 'mouseleave') && row.related_target ? row.related_target : row.target;
    const parts = [`${verbFor(row)} ${elementPhrase(subject)}`];
    if (handler?.name) parts.push(handler.name);
    if (requests.length) parts.push(requests.map(requestPhrase).join(', '));
    else if (!caused && row.target?.tag !== 'a') parts.push('nothing else happened');
    lines.push({ schema: STORY_SCHEMA, id: row.action_id, kind: row.event === 'submit' ? 'submit' : HOVER.has(row.event) ? 'hover' : 'act', session: page, at: row.timestamp ?? null, page: row.page ?? null,
      text: parts.join(' → '), event: row.event,
      element: { tag: subject?.tag ?? null, label: subject?.label ?? null, key: subject?.element_key ?? null },
      handler, requests, entities, outcome: chain.outcome?.sentence ?? null, action_id: row.action_id });
    info.actions += 1;
  }
  return { schema: STORY_SCHEMA, sessions: [...sessions.values()], lines };
}

/**
 * A live story over a store directory: re-reads the store only when its files
 * change, so a page can poll it or subscribe without re-running the engine.
 */
export function createStoryFeed({ dir, sourceRoot = null }) {
  let cached = null;
  let key = null;
  return async function current({ session } = {}) {
    const paths = storePaths({ dir });
    let fingerprint;
    try { fingerprint = fileFingerprint(paths); } catch { fingerprint = null; }
    if (!cached || fingerprint === null || fingerprint !== key) {
      try { cached = await loadStore({ dir, sourceRoot }); } catch (error) { if (error.code === 'STORE_NOT_FOUND') return { schema: STORY_SCHEMA, sessions: [], lines: [] }; throw error; }
      key = fingerprint;
      cached.__story = new Map();
    }
    const memo = session ?? '\u0000all';
    if (!cached.__story.has(memo)) cached.__story.set(memo, storyOf(cached, { session }));
    return cached.__story.get(memo);
  };
}
