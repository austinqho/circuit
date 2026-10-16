/**
 * Element index: element_key → placement → handlers → actions → (chains, by the caller).
 *
 * Pure functions over runtime-evidence rows. The index is a LOOKUP structure for
 * external agents (D12): it never creates, alters or ranks an attribution.
 * Handler credit comes only from `indexEntryHandlerUnits` (passed in or computed
 * by the caller); membership of an action in a key is by string equality of an
 * identifier, never by time or text similarity.
 *
 * Key kinds, never mixed:
 * - `element_stamp` (G3): `element.stamp` rows and `dom.action.target.element_key`.
 *   Its `stamp_key_kind` says how far the key names one element: `react_key`
 *   (`<placement>@<key path>`, one element) or `ordinal` (`<placement>#n<i>`,
 *   the i-th of `instances` hosts of the placement at that commit; the same
 *   key can name another item after a reorder or removal). Every stamp row is
 *   one observation; an action is joined to the observation that held when it
 *   fired by `target.stamp_sequence` (string equality within a page), never by time.
 * - `source_ref`: `dom.action.source_ref` `{file,start,end}` when the runtime recorded one.
 * - `entry_handler`: fallback. Key `handler:<function_id>|<event>` (the entry-handler unit id).
 *
 * Handlers of a key, two lists never mixed (D-G1-22):
 * - `observed_bindings`: from `handler.binding` rows (the handler ran during
 *   the dispatch of a user's event on this key's element and was held by the
 *   element's chain) and `handler.invocation` rows (it ran for a dispatch live
 *   app code caused, e.g. el.focus(); not a binding to a user event), each
 *   with the native event type that actually ran it and a count of the
 *   dispatches it was observed on. Evidence of what ran then; every dispatch
 *   records its own.
 * - `handlers`: declared (element.stamp `handlers`: on* props at a commit;
 *   `event` there is the prop name without "on", never an observation).
 */

const PRINTABLE = /^[\x21-\x7E]+$/u;
const LABEL_ATTRIBUTES = ['aria-label', 'title', 'name', 'data-testid'];

/**
 * `react_key` or `ordinal` for one stamp row or key. Rows written before
 * fix/stable-element-keys carry no `key_kind`: `#n<i>` is ordinal, `#k…`/`#h…`
 * is a React key, `…~<i>` (a repeated React key) is ordinal.
 */
export function stampKeyKind(row) {
  if (row?.key_kind === 'react_key' || row?.key_kind === 'ordinal') return row.key_kind;
  const key = String(row?.element_key ?? row ?? '');
  if (/#n\d+$/u.test(key) || /#[kh].*~\d+$/u.test(key)) return 'ordinal';
  return /[#@]/u.test(key) ? 'react_key' : 'unknown';
}

/** Legacy key family (same placement, same token, different ordinal) and index within it. */
function legacyFamily(key) {
  let match = /^(.*#n)(\d+)$/u.exec(key);
  if (match) return { family: match[1], index: Number(match[2]) };
  match = /^(.*#[kh].*?)(?:~(\d+))?$/u.exec(key);
  return match ? { family: match[1], index: Number(match[2] || 1) } : null;
}

const labelOf = target => {
  const attributes = target?.attributes || {};
  for (const name of LABEL_ATTRIBUTES) if (typeof attributes[name] === 'string' && attributes[name]) return attributes[name];
  return null;
};
const rowOrder = (left, right) => Number(left?.timestamp || 0) - Number(right?.timestamp || 0)
  || String(left?.capture_page_id || '').localeCompare(String(right?.capture_page_id || ''))
  || Number(left?.sequence || 0) - Number(right?.sequence || 0);

export const pageOf = row => row?.capture_page_id || row?.session_id || 'default';
export const handlerKey = unitId => `handler:${unitId}`;
export const sourceKey = ref => `source:${ref.file}:${ref.start}:${ref.end}`;

function validSourceRef(ref) {
  return ref && typeof ref === 'object' && typeof ref.file === 'string' && ref.file
    && Number.isInteger(ref.start) && Number.isInteger(ref.end) && ref.start >= 0 && ref.end >= ref.start;
}

/**
 * @param {object[]} records runtime-evidence rows
 * @param {object} options
 * @param {{byAction: Map<string,string[]>, units: Map<string,object>}} options.entryIndex result of indexEntryHandlerUnits
 * @param {(functionId: string) => object|null} [options.sourceFor] function id → {file,start,end,...}
 */
export function buildElementIndex(records, { entryIndex, sourceFor = () => null } = {}) {
  if (!Array.isArray(records)) throw new TypeError('records must be an array');
  if (!entryIndex?.byAction || !entryIndex?.units) throw new TypeError('entryIndex (from indexEntryHandlerUnits) is required');
  const entries = new Map();
  const unplaced = [];
  const actionKey = new Map();
  const builds = new Set();
  const entry = (key, keyKind) => {
    let value = entries.get(key);
    if (!value) {
      value = { key, key_kind: keyKind, placements: [], handlers: [], builds: new Set(), sessions: new Set(), actions: [], stamp_rows: 0,
        ...(keyKind === 'element_stamp' ? { stamp_key_kind: stampKeyKind(key), observations: [] } : {}) };
      entries.set(key, value);
    }
    return value;
  };
  const addPlacement = (value, placement) => {
    const signature = JSON.stringify([placement.placement_id ?? null, placement.file ?? null, placement.start ?? null, placement.end ?? null, placement.line ?? null, placement.component ?? null]);
    if (!value.placements.some(existing => existing.signature === signature)) value.placements.push({ ...placement, signature });
  };
  const addHandler = (value, handler) => {
    if (!value.handlers.some(existing => existing.event === handler.event && existing.function_id === handler.function_id)) value.handlers.push(handler);
  };
  // Observed bindings per action (D-G1-22), in row order.
  const bindingsByAction = new Map();
  for (const row of records) {
    // Untrusted invocations (el.click() from app code) carry the causing action's id, not the clicked element's: not joined to a key.
    if ((row?.kind !== 'handler.binding' && row?.kind !== 'handler.invocation') || row.untrusted === true || !row.action_id || typeof row.function_id !== 'string') continue;
    const key = `${pageOf(row)}\u0000${row.action_id}`;
    const values = bindingsByAction.get(key) || []; values.push(row); bindingsByAction.set(key, values);
  }
  const addObserved = (value, action, rows) => {
    value.observed_bindings ||= [];
    for (const row of rows) {
      const kind = row.kind === 'handler.binding' ? 'binding' : 'invocation';
      const id = `${kind}\u0000${row.function_id}\u0000${row.prop_name ?? ''}\u0000${row.native_event_type ?? ''}\u0000${row.invoked_by ?? ''}\u0000${row.ambiguous ? 'ambiguous' : ''}`;
      let entry = value.observed_bindings.find(existing => existing.id === id);
      if (!entry) {
        entry = { id, kind, function_id: row.function_id, prop_name: row.prop_name ?? null, native_event_type: row.native_event_type ?? null, invoked_by: row.invoked_by ?? null,
          listener_on: row.listener_on ?? null, holder: row.fiber ? { kind: row.fiber.kind ?? null, name: row.fiber.name ?? null } : null, placement_id: row.placement_id ?? null,
          ...(row.ambiguous ? { ambiguous: true, ambiguity_reason: row.ambiguity_reason ?? null, holders: row.holders || [] } : {}),
          ...(kind === 'invocation' ? { dispatched_by: row.dispatched_by ?? null } : {}), count: 0, action_ids: [], source: sourceFor(row.function_id) };
        value.observed_bindings.push(entry);
      }
      if (!entry.action_ids.includes(action.action_id)) { entry.action_ids.push(action.action_id); entry.count += 1; }
    }
  };

  // 1. Stamps. One row per observation: a new row whenever what a key names
  // changed (older runtimes: one row per page + element_key).
  const observationBySequence = new Map();
  const legacyFamilies = new Map();
  for (const row of records) {
    if (row?.kind !== 'element.stamp' || typeof row.element_key !== 'string' || !PRINTABLE.test(row.element_key)) continue;
    const value = entry(row.element_key, 'element_stamp');
    value.stamp_rows += 1;
    const observation = { session: pageOf(row), stamp_sequence: Number.isInteger(row.stamp_sequence) ? row.stamp_sequence : null, commit: Number.isInteger(row.commit) ? row.commit : null,
      timestamp: row.timestamp ?? null, key_kind: stampKeyKind(row), key_kind_source: row.key_kind ? 'row' : 'key_syntax', instances: Number.isInteger(row.instances) ? row.instances : null,
      placement_id: row.placement_id ?? null, react_key: row.react_key ?? null, react_key_path: Array.isArray(row.react_key_path) ? row.react_key_path : null,
      react_key_site: row.react_key_site ?? null, binding_placement: row.binding_placement ?? null, content_sig: typeof row.content_sig === 'string' ? row.content_sig : null,
      handlers: (Array.isArray(row.handlers) ? row.handlers : []).filter(handler => typeof handler?.function_id === 'string').map(handler => ({ event: handler.event ?? null, prop: handler.prop ?? null, function_id: handler.function_id })) };
    value.observations.push(observation);
    if (observation.stamp_sequence !== null) observationBySequence.set(`${observation.session}\u0000${observation.stamp_sequence}`, { key: row.element_key, observation });
    if (!row.key_kind) {
      const legacy = legacyFamily(row.element_key);
      if (legacy) { const id = `${observation.session}\u0000${legacy.family}`; legacyFamilies.set(id, Math.max(legacyFamilies.get(id) || 0, legacy.index)); }
    }
    value.sessions.add(pageOf(row));
    if (row.build != null) { value.builds.add(String(row.build)); builds.add(String(row.build)); }
    addPlacement(value, { placement_id: row.placement_id ?? null, file: row.file ?? null, start: row.start ?? null, end: row.end ?? null, line: Number.isInteger(row.line) ? row.line : null, component: row.component ?? null, url: row.url ?? row.page_url ?? null });
    for (const handler of Array.isArray(row.handlers) ? row.handlers : []) {
      if (typeof handler?.function_id !== 'string') continue;
      addHandler(value, { event: handler.event ?? null, function_id: handler.function_id, source: sourceFor(handler.function_id) });
    }
  }

  // 2. Actions, in (timestamp, page, sequence) order. Timestamps only order.
  const actions = records.filter(row => row?.kind === 'dom.action' && row.action_id).sort(rowOrder);
  for (const action of actions) {
    const brief = { action_id: action.action_id, session: pageOf(action), sequence: action.sequence ?? null, timestamp: action.timestamp ?? null, event: action.event ?? null };
    const stampKey = action.target?.element_key;
    let key = null;
    if (typeof stampKey === 'string' && PRINTABLE.test(stampKey)) {
      key = stampKey; const value = entry(key, 'element_stamp');
      // The key's state when the action fired, and the observation that held
      // then (exact join on the page's stamp_sequence). Rows from older
      // runtimes carry no stamp_sequence: the key's only observation on that
      // page is used when there is exactly one, else none.
      const target = action.target;
      brief.element = { key_kind: target.key_kind ?? stampKeyKind(stampKey), instances: Number.isInteger(target.instances) ? target.instances : null,
        stamp_sequence: Number.isInteger(target.stamp_sequence) ? target.stamp_sequence : null, label: labelOf(target) };
      let joined = null, basis = null;
      if (brief.element.stamp_sequence !== null) {
        const hit = observationBySequence.get(`${brief.session}\u0000${brief.element.stamp_sequence}`);
        if (hit && hit.key === key) { joined = hit.observation; basis = 'stamp_sequence'; }
      } else {
        const onPage = value.observations.filter(observation => observation.session === brief.session);
        if (onPage.length === 1) { joined = onPage[0]; basis = 'only_observation'; }
      }
      brief.binding = joined ? { basis, stamp_sequence: joined.stamp_sequence, commit: joined.commit, key_kind: joined.key_kind, instances: joined.instances,
        placement_id: joined.placement_id, react_key_path: joined.react_key_path, binding_placement: joined.binding_placement, handlers: joined.handlers,
        content_sig: joined.content_sig, label: brief.element.label } : null;
    } else if (validSourceRef(action.source_ref)) {
      key = sourceKey(action.source_ref);
      const value = entry(key, 'source_ref');
      addPlacement(value, { placement_id: null, file: action.source_ref.file, start: action.source_ref.start, end: action.source_ref.end, line: null, component: null });
    } else {
      const unitId = entryIndex.byAction.get(action.action_id)?.[0] || null;
      const unit = unitId ? entryIndex.units.get(unitId) : null;
      if (unit) {
        key = handlerKey(unitId);
        const value = entry(key, 'entry_handler');
        const source = sourceFor(unit.function_id);
        addPlacement(value, { placement_id: unit.function_id, file: source?.file ?? null, start: source?.start ?? null, end: source?.end ?? null, line: source?.line ?? null, component: null });
        addHandler(value, { event: unit.event, function_id: unit.function_id, source, rooted: unit.rooted_action_ids.includes(action.action_id) });
      }
    }
    if (!key) { unplaced.push({ ...brief, reason: 'no element_key on the target, no source_ref, and no entry handler credited to this action' }); continue; }
    const value = entries.get(key);
    // D-G1-22: the handlers observed running for this action's dispatch.
    const observedRows = bindingsByAction.get(`${brief.session}\u0000${action.action_id}`) || [];
    if (observedRows.length || action.bound_handlers?.basis === 'declared') {
      value.bindings_observed = true;
      brief.handlers_observed = observedRows.map(row => ({ kind: row.kind === 'handler.binding' ? 'binding' : 'invocation', function_id: row.function_id,
        prop_name: row.prop_name ?? null, native_event_type: row.native_event_type ?? null, invoked_by: row.invoked_by ?? null }));
      addObserved(value, action, observedRows);
    }
    value.actions.push(brief); value.sessions.add(brief.session);
    actionKey.set(`${brief.session}\u0000${action.action_id}`, key);
  }

  for (const value of entries.values()) {
    value.conflict = value.key_kind === 'element_stamp' && value.placements.length > 1;
    if (value.key_kind === 'element_stamp') {
      // Most instances of this key's placement seen at any stamp or action.
      const counts = [...value.observations.map(observation => observation.instances), ...value.actions.map(action => action.element?.instances)].filter(Number.isInteger);
      value.instances_max = counts.length ? Math.max(...counts) : null;
      // Older rows without `instances`: the highest ordinal of the same family on the same page is a lower bound.
      if (value.instances_max === null) {
        const legacy = legacyFamily(value.key);
        const bounds = legacy ? value.sessions.size ? [...value.sessions].map(session => legacyFamilies.get(`${session}\u0000${legacy.family}`) || 0) : [] : [];
        value.instances_lower_bound = bounds.length ? Math.max(...bounds) : null;
        if (value.stamp_key_kind === 'react_key' && value.instances_lower_bound > 1) value.stamp_key_kind = 'ordinal';
        // Same number on every action of the key as resolve_element reports.
        if (value.instances_lower_bound !== null) for (const action of value.actions) if (action.element && action.element.instances === null) action.element.instances = value.instances_lower_bound;
      }
      value.react_key_sites = [...new Set(value.observations.map(observation => observation.react_key_site).filter(site => typeof site === 'string'))];
    }
    if (value.observed_bindings) {
      // User bindings first, then app-code invocations; most-observed first; `id` is internal.
      value.observed_bindings = value.observed_bindings.map(({ id, ...entry }) => ({ ...entry, action_ids: entry.action_ids.slice(-5) }))
        .sort((left, right) => (left.kind === right.kind ? 0 : left.kind === 'binding' ? -1 : 1) || right.count - left.count);
    }
    value.placements = value.placements.map(({ signature, ...placement }) => placement);
    value.builds = [...value.builds].sort();
    value.sessions = [...value.sessions].sort();
  }
  const byPlacement = new Map();
  for (const value of entries.values()) {
    if (value.key_kind !== 'element_stamp') continue;
    for (const placement of value.placements) if (placement.placement_id) byPlacement.set(placement.placement_id, [...(byPlacement.get(placement.placement_id) || []), value.key]);
  }
  return { entries, unplaced, actionKey, byPlacement, builds: [...builds].sort(), has_stamps: [...entries.values()].some(value => value.key_kind === 'element_stamp') };
}

/**
 * How far an element_stamp key names exactly one element:
 * `{ exact: true }` for a React-keyed key seen under one keyed parent, or an
 * ordinal key whose placement had one instance at every stamp and action,
 * provided the key showed one content at every action in scope (`actions`,
 * default all of the key's actions) and that content is what the key's latest
 * stamp row on the same page shows; otherwise `{ exact: false, reason,
 * instances }` (plus `labels`, one per action, when the content changed).
 */
export function stampKeyTrust(value, actions = value?.actions || []) {
  if (value?.key_kind !== 'element_stamp') return { exact: false, reason: 'not an element stamp key' };
  if (value.react_key_sites?.length > 1) return { exact: false, reason: `react key path observed under ${value.react_key_sites.length} different keyed parent placements`, instances: value.react_key_sites.length };
  // Instance count first (an ordinal key of a repeated placement is ambiguous
  // whatever it showed), then content.
  const count = value.stamp_key_kind === 'ordinal' ? (value.instances_max ?? value.instances_lower_bound ?? null) : 1;
  if (value.stamp_key_kind === 'ordinal') {
    const instances = value.instances_max ?? value.instances_lower_bound ?? null;
    if (instances === null) return { exact: false, reason: 'ordinal key; instance count not recorded', instances: null };
    if (instances > 1) return { exact: false, reason: `ordinal key; ${instances} instances of this placement`, instances };
  }
  // What the key showed at each action in scope (the content signature of the
  // stamp row joined to it). Two different contents: the key named different
  // items at different actions, e.g. an index key (`key={i}`) after a reorder.
  // What the key shows now: the latest stamp row's content on each page.
  const latestContent = new Map();
  for (const observation of value.observations || []) if (typeof observation.content_sig === 'string') latestContent.set(observation.session, observation.content_sig);
  const labelsOf = () => actions.map(action => ({ action_id: action.action_id, session: action.session, timestamp: action.timestamp, event: action.event,
    label: action.element?.label ?? null, content_sig: action.binding?.content_sig ?? null, current_content_sig: latestContent.get(action.session) ?? null }));
  const suffix = value.stamp_key_kind === 'react_key' ? ' (index-like key)' : '';
  const contents = [...new Set(actions.map(action => action.binding?.content_sig).filter(sig => typeof sig === 'string'))];
  if (contents.length > 1) return { exact: false, reason: `key content changed between actions${suffix}`, instances: contents.length, content_changed: true, labels: labelsOf() };
  // An action whose element showed other content than the key shows now: the
  // key has moved to another item since (e.g. `key={i}` after a reorder).
  const moved = actions.filter(action => typeof action.binding?.content_sig === 'string' && latestContent.has(action.session) && latestContent.get(action.session) !== action.binding.content_sig);
  if (moved.length) return { exact: false, reason: `key content changed since the action${suffix}`, instances: 2, content_changed: true, labels: labelsOf() };
  return { exact: true, instances: count };
}

/** Key the index assigned to one dom.action row (or null). */
export function keyForAction(index, action) {
  return index.actionKey.get(`${pageOf(action)}\u0000${action.action_id}`) || null;
}

// ---------------------------------------------------------------------------
// Fallback lookup from the evidence a browser annotation carries (selector,
// tag path, role, accessible name, nearby text). Ranking only: the result is
// always a candidate list, never a pick. Nothing here is evaluated; the
// selector is tokenised by a fixed grammar.

const STATE_ATTRIBUTES = new Set(['aria-expanded', 'aria-invalid', 'aria-selected', 'aria-checked', 'aria-pressed', 'aria-activedescendant', 'aria-busy', 'value']);
const NAME_ATTRIBUTES = ['aria-label', 'title', 'placeholder', 'alt', 'name', 'data-testid', 'id'];

/** Split on combinators (descendant, >, >>>, +, ~) outside brackets and quotes. */
function splitCompounds(text) {
  const compounds = []; let current = ''; let quote = null; let depth = 0;
  for (const char of text) {
    if (quote) { current += char; if (char === quote) quote = null; continue; }
    if (char === '"' || char === "'") { quote = char; current += char; continue; }
    if (char === '[' || char === '(') depth += 1;
    if (char === ']' || char === ')') depth = Math.max(0, depth - 1);
    if (depth === 0 && /[\s>+~]/u.test(char)) { if (current) compounds.push(current); current = ''; continue; }
    current += char;
  }
  if (current) compounds.push(current);
  return compounds;
}

/** Parse the last compound of a CSS-ish selector: tag, #id, .class, [attr], [attr=v], :pseudo. */
export function parseSelectorTail(selector) {
  const ignored = [];
  const text = String(selector);
  const compounds = splitCompounds(text);
  const tail = compounds.at(-1) || '';
  if (compounds.length > 1) ignored.push({ input: 'selector', part: compounds.slice(0, -1).join(' > '), reason: 'ancestor steps are not recorded on dom.action targets' });
  const out = { tag: null, id: null, classes: [], attributes: [] };
  const pattern = /([a-zA-Z][a-zA-Z0-9-]*|\*)|#((?:[A-Za-z0-9_-]|\\.)+)|\.([A-Za-z0-9_-]+)|\[\s*([A-Za-z_:][A-Za-z0-9_:.-]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]+)))?\s*\]|:([a-z-]+(?:\([^)]*\))?)/gyu;
  let position = 0;
  while (position < tail.length) {
    pattern.lastIndex = position;
    const match = pattern.exec(tail);
    if (!match || match[0] === '') { ignored.push({ input: 'selector', part: tail.slice(position), reason: 'outside the supported selector grammar' }); break; }
    if (match[1] && match[1] !== '*') out.tag = match[1].toLowerCase();
    else if (match[2]) out.id = match[2].replaceAll('\\', '');
    else if (match[3]) out.classes.push(match[3]);
    else if (match[4]) out.attributes.push({ name: match[4].toLowerCase(), value: match[5] ?? match[6] ?? match[7] ?? null });
    else if (match[8]) ignored.push({ input: 'selector', part: `:${match[8]}`, reason: 'pseudo-classes are not evaluated' });
    position = pattern.lastIndex;
  }
  if (out.classes.length) ignored.push({ input: 'selector', part: out.classes.map(name => `.${name}`).join(''), reason: 'class names are not recorded on dom.action targets' });
  return { ...out, ignored };
}

/** Tag names of a `div > form > button` style path (at most 4 levels). */
export function parseElementPath(elementPath) {
  const tags = String(elementPath).split('>').map(part => part.trim().toLowerCase()).filter(Boolean);
  const valid = tags.every(tag => /^[a-z][a-z0-9-]*$/u.test(tag));
  return { tags: valid ? tags.slice(-4) : [], valid };
}

export function targetSignature(target) {
  const attributes = Object.entries(target?.attributes || {}).filter(([name]) => !STATE_ATTRIBUTES.has(name)).sort(([left], [right]) => left.localeCompare(right));
  return JSON.stringify([String(target?.tag || '').toLowerCase(), attributes]);
}

// Implicit ARIA roles of the host tags a dom.action target or a stamp row can
// carry (HTML-AAM, the common subset). Generic HTML semantics, no product list.
const INPUT_ROLES = { button: 'button', submit: 'button', reset: 'button', image: 'button', checkbox: 'checkbox', radio: 'radio', range: 'slider',
  search: 'searchbox', text: 'textbox', email: 'textbox', tel: 'textbox', url: 'textbox', password: 'textbox', number: 'spinbutton' };
/** Implicit role of a host element from its tag (and input type / href), or null. */
export function implicitRole(tag, attributes = {}) {
  const name = String(tag || '').toLowerCase();
  if (name === 'button' || name === 'summary') return 'button';
  if (name === 'a') return attributes.href != null ? 'link' : null;
  if (name === 'textarea') return 'textbox';
  if (name === 'select') return attributes.multiple != null ? 'listbox' : 'combobox';
  if (name === 'input') return INPUT_ROLES[String(attributes.type || 'text').toLowerCase()] ?? null;
  if (/^h[1-6]$/u.test(name)) return 'heading';
  // A <canvas> has no implicit role (HTML-AAM): it is found by its label or tag, never by a role it does not have.
  return { form: 'form', img: 'img', nav: 'navigation', ul: 'list', ol: 'list', li: 'listitem', table: 'table', dialog: 'dialog', option: 'option', progress: 'progressbar',
    tr: 'row', td: 'cell', th: 'columnheader', thead: 'rowgroup', tbody: 'rowgroup', tfoot: 'rowgroup', article: 'article', figure: 'figure', main: 'main', aside: 'complementary',
    fieldset: 'group', details: 'group', output: 'status', hr: 'separator', meter: 'meter', menu: 'list' }[name] ?? null;
}

// The runtime's stamp-row content signature (src/runtime-attribution-browser.js
// `contentSignature`): the first of aria-label/title/name/data-testid/alt as
// `attr=value`, else `tag:` + the element's collapsed text (64 chars), hashed
// twice with FNV-1a. Recomputed here from the text an agent supplies, so a
// supplied name can be compared with recorded content by string equality of
// hashes; the recorded text itself is never stored.
const fnv1a = (text, seed = 0x811c9dc5) => { let hash = seed; for (let i = 0; i < text.length; i += 1) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 0x01000193) >>> 0; } return hash.toString(16).padStart(8, '0'); };
export const contentSignatureOf = summary => `${fnv1a(summary)}${fnv1a(summary, 0x01000193)}`;
// `alt` from 2026-09-24 (fix/mcp-surfaces); older stamp rows never hashed it, so an alt name simply finds nothing there.
const CONTENT_ATTRIBUTES = ['aria-label', 'title', 'name', 'data-testid', 'alt'];
/** Signatures a stamped element would carry if its label or text were `text`: [{ sig, via }]. */
export function contentSignaturesFor(text, tags = []) {
  const value = String(text ?? '');
  if (!value.trim()) return [];
  const collapsed = value.replace(/\s+/gu, ' ').trim().slice(0, 64);
  return [...CONTENT_ATTRIBUTES.map(attribute => ({ sig: contentSignatureOf(`${attribute}=${value}`), via: attribute })),
    ...[...new Set(tags.filter(Boolean).map(tag => String(tag).toLowerCase()))].map(tag => ({ sig: contentSignatureOf(`${tag}:${collapsed}`), via: `text of <${tag}>` }))];
}

/**
 * Rank observed dom.action targets against annotation evidence.
 * Hard mismatches (an attribute both sides state, with different values)
 * exclude a group; everything else only adds score. Always returns a list.
 * Groups are target signatures, or (signature, element key) pairs when
 * `keyOf` is given (the store passes it whenever stamp rows exist).
 *
 * `stamps` (optional, key → { host_tags, content_sigs, latest_sigs }) adds the stamp rows'
 * evidence: a supplied name or nearby text whose recomputed content signature
 * equals one the key was stamped with scores; a key whose every recorded
 * signature differs from the supplied name is marked mismatched. `ancestors`
 * (per key: the stamped keys enclosing it, each { element_key, host_tags,
 * content_sigs }) scores a name (+3) or nearby text (+2) that is an enclosing
 * element's label, e.g. the row a button sits in. Only a key's latest label
 * (`latest_sigs`: its latest stamp row per page) matches; text equal only to
 * an earlier label is listed in `mismatched` as out of date
 * (`label_out_of_date: true`), never matched. Stamped keys
 * no action touched become candidates too (0 actions observed). Implicit ARIA
 * roles (a <button> is role button) count like explicit ones. Lookup only:
 * nothing here feeds an attribution.
 */
export function rankTargetCandidates(actions, { selector = null, element_path = null, role = null, name = null, nearby_text = null } = {}, { keyOf = null, stamps = null } = {}) {
  const ignored = [];
  const parsed = selector ? parseSelectorTail(selector) : null;
  if (parsed) ignored.push(...parsed.ignored);
  const path = element_path ? parseElementPath(element_path) : null;
  if (path && !path.valid) ignored.push({ input: 'element_path', part: element_path, reason: 'expected tag names separated by >' });
  const wantedTags = new Set([parsed?.tag, path?.tags.at(-1)].filter(Boolean));
  // G5 (D-G5-3): a browser annotation can pick a text-bearing descendant of
  // the control (e.g. the <div> label inside a <button>), while dom.action
  // records the control. The selector's ancestor steps and the path's
  // ancestor tags therefore also name a tag the recorded target may have.
  // Tag names only; never a pick (the result stays a ranked candidate list).
  const ancestorTags = new Set([
    ...(selector ? splitCompounds(String(selector)).slice(0, -1).map(part => /^([a-zA-Z][a-zA-Z0-9-]*)/u.exec(part)?.[1]?.toLowerCase()).filter(Boolean) : []),
    ...(path?.tags.slice(0, -1) || []),
  ].filter(tag => !wantedTags.has(tag)));
  const groups = new Map();
  for (const action of actions) {
    // With stamp rows, `keyOf` gives each action's element key and a candidate
    // is one (target signature, element key) pair: two unrelated elements that
    // happen to record the same tag and attributes are never merged.
    const elementKey = keyOf ? keyOf(action) ?? null : undefined;
    const signature = elementKey === undefined ? targetSignature(action.target) : JSON.stringify([targetSignature(action.target), elementKey]);
    const group = groups.get(signature) || { signature, ...(elementKey === undefined ? {} : { element_key: elementKey }), target: { tag: action.target?.tag ?? null, attributes: Object.fromEntries(Object.entries(action.target?.attributes || {}).filter(([key]) => !STATE_ATTRIBUTES.has(key))) }, actions: [] };
    group.actions.push(action); groups.set(signature, group);
  }
  // Stamped keys that no recorded action touched: their stamp rows are the only evidence.
  if (stamps && keyOf) {
    const keyed = new Set([...groups.values()].map(group => group.element_key).filter(Boolean));
    for (const [key, stamp] of stamps) {
      if (keyed.has(key)) continue;
      const tag = [...(stamp.host_tags || [])][0] ?? null;
      const signature = JSON.stringify([JSON.stringify([tag, []]), key]);
      groups.set(signature, { signature, element_key: key, target: { tag, attributes: {} }, actions: [], stamp_only: true });
    }
  }
  const lower = value => String(value ?? '').toLowerCase();
  const candidates = [];
  groups: for (const group of groups.values()) {
    const attributes = group.target.attributes; const tag = lower(group.target.tag);
    let score = 0; const matched = []; const mismatched = [];
    if (wantedTags.size) {
      if (wantedTags.has(tag)) { score += 1; matched.push(`tag=${tag}`); }
      else if (ancestorTags.has(tag)) { score += 1; matched.push(`ancestor tag=${tag} (the annotated element is inside a recorded <${tag}> target)`); }
      else mismatched.push(`tag ${tag} (the recorded target is the innermost event target; the annotated element may be an ancestor)`);
    }
    // A selector that states an id matches only targets recorded with that id.
    if (parsed?.id) { if (attributes.id === parsed.id) { score += 3; matched.push(`#${parsed.id}`); } else continue groups; }
    for (const attribute of parsed?.attributes || []) {
      if (!Object.hasOwn(attributes, attribute.name)) continue;
      if (attribute.value == null || attributes[attribute.name] === attribute.value) { score += 2; matched.push(`[${attribute.name}]`); } else continue groups;
    }
    let roleMatched = false; let nameMatched = false; let nearbyMatched = false;
    if (role) {
      const implicit = implicitRole(tag, attributes);
      if (attributes.role === role) { score += 2; matched.push(`role=${role}`); roleMatched = true; }
      else if (attributes.role != null) continue groups;
      else if (implicit === role) { score += 2; matched.push(`implicit role=${role} (<${tag}>)`); roleMatched = true; }
      else if (implicit != null) { score -= 2; mismatched.push(`implicit role ${implicit} (<${tag}>), not ${role}`); }
    }
    const stamp = stamps && group.element_key ? stamps.get(group.element_key) : null;
    // A key's label counts only as it is now: its latest stamp row on the page
    // (`latest_sigs`). A supplied text equal only to an earlier label of the
    // key (an index-like key now naming another item) is out of date: stated,
    // never a match (and never `best`).
    const OUT_OF_DATE = 'label out of date for that key (content changed since)';
    const stale = []; const staleKeys = new Set();
    const sigHit = (text, tags, entry) => {
      if (!text || !entry?.content_sigs?.size) return null;
      const signatures = contentSignaturesFor(text, tags);
      const latest = entry.latest_sigs || entry.content_sigs;
      const now = signatures.find(value => latest.has(value.sig));
      if (now) return { ...now, current: true };
      const earlier = signatures.find(value => entry.content_sigs.has(value.sig));
      return earlier ? { ...earlier, current: false } : null;
    };
    const ownTags = [tag, ...(stamp?.host_tags || [])];
    const ownName = stamp ? sigHit(name, ownTags, stamp) : null;
    const ownText = stamp ? sigHit(nearby_text, ownTags, stamp) : null;
    if (name) {
      const hit = NAME_ATTRIBUTES.find(key => attributes[key] != null && lower(attributes[key]) === lower(name).trim());
      // A recorded target attribute is what the element showed at that action; it is superseded when the key's latest label differs.
      if (hit && ownName && !ownName.current) { stale.push(`${hit}=name at an earlier action: ${OUT_OF_DATE}`); staleKeys.add(group.element_key); }
      else if (hit) { score += 3; matched.push(`${hit}=name`); nameMatched = true; }
    }
    if (nearby_text) {
      const needle = lower(nearby_text).trim();
      const hit = needle && NAME_ATTRIBUTES.find(key => attributes[key] != null && lower(attributes[key]).length >= 3 && needle.includes(lower(attributes[key])));
      if (hit && !(ownText && !ownText.current)) { score += 1; matched.push(`${hit} appears in nearby_text`); nearbyMatched = true; }
    }
    if (stamp?.content_sigs?.size) {
      if (ownName?.current) { score += 6; matched.push(`content_sig = name (${ownName.via})`); nameMatched = true; }
      else if (ownName) { stale.push(`content_sig = name (${ownName.via}) only on an earlier stamp row: ${OUT_OF_DATE}`); staleKeys.add(group.element_key); }
      if (name && !nameMatched) { score -= 2; mismatched.push('content_sig: the latest stamp row of this key does not show the supplied name as its label or text'); }
      if (nearby_text && !ownName?.current) {
        if (ownText?.current) { score += 2; matched.push(`content_sig = nearby_text (${ownText.via})`); nearbyMatched = true; }
        else if (ownText) { stale.push(`content_sig = nearby_text (${ownText.via}) only on an earlier stamp row: ${OUT_OF_DATE}`); staleKeys.add(group.element_key); }
      }
    }
    // An enclosing stamped element's label (a list row, a card, a dialog that
    // names the control inside it): the supplied name or nearby text equals
    // an ancestor's latest content signature. Never counts as the element's own name.
    for (const ancestor of stamp?.ancestors || []) {
      const tags = [...(ancestor.host_tags || [])];
      const byName = sigHit(name, tags, ancestor);
      const byText = byName?.current ? null : sigHit(nearby_text, tags, ancestor);
      const hit = byName?.current ? byName : byText?.current ? byText : null;
      if (hit) {
        score += hit === byName ? 3 : 2;
        matched.push(`ancestor ${ancestor.element_key} label = ${hit === byName ? 'name' : 'nearby_text'} (${hit.via})`);
        if (hit === byText) nearbyMatched = true;
        break;
      }
      const old = byName || byText;
      if (old) { stale.push(`ancestor ${ancestor.element_key} label = ${old === byName ? 'name' : 'nearby_text'} (${old.via}) only on an earlier stamp row: ${OUT_OF_DATE}`); staleKeys.add(ancestor.element_key); }
    }
    if (stale.length) mismatched.push(...stale);
    // A candidate whose only link to the supplied text is an out-of-date label is still listed (a lead), never matched.
    if (score <= 0 && !stale.length) continue;
    candidates.push({ ...group, score, matched_on: matched, mismatched, role_matched: role ? roleMatched : null, name_matched: name ? nameMatched : null, nearby_matched: nearby_text ? nearbyMatched : null,
      ...(stale.length ? { label_out_of_date: true, out_of_date_keys: [...staleKeys] } : {}) });
  }
  candidates.sort((left, right) => right.score - left.score || right.actions.length - left.actions.length
    || rowOrder(right.actions.at(-1), left.actions.at(-1)));
  return { candidates, ignored };
}

// ---- Stamp-row resolver (G3): element_key -> placement, used by the G3 graders.

// Printable ASCII, no spaces, <= 256 (the element.stamp row contract).
const ELEMENT_KEY = /^p_[0-9a-f]{12,64}:\d{1,9}-\d{1,9}[#@][\x21-\x7e]{1,200}$/u;

export function isElementKey(value) {
  return typeof value === 'string' && value.length <= 256 && ELEMENT_KEY.test(value);
}

/** element_key -> stamp rows (one per page/session that stamped it). */
export function indexElementStamps(records) {
  if (!Array.isArray(records)) throw new TypeError('records must be an array');
  const byKey = new Map();
  const builds = new Set();
  const legacyFamilies = new Map();
  for (const row of records) {
    if (row?.kind !== 'element.stamp' || !isElementKey(row.element_key)) continue;
    const values = byKey.get(row.element_key) || [];
    values.push(row);
    byKey.set(row.element_key, values);
    if (row.build) builds.add(row.build);
    const legacy = row.key_kind ? null : legacyFamily(row.element_key);
    if (legacy) { const id = `${pageOf(row)}\u0000${legacy.family}`; legacyFamilies.set(id, Math.max(legacyFamilies.get(id) || 0, legacy.index)); }
  }
  return { byKey, builds, legacyFamilies };
}

/**
 * Resolve one element key to its source placement. Returns
 * { status: 'exact' | 'not_found' | 'stale_build' | 'invalid' | 'ambiguous', ... };
 * with `exact`, also `key_kind`, `instances` and `element_confidence`.
 * `ambiguous` only if the same key was stamped for two different placements
 * (not expected: keys embed the placement), never a silent pick.
 */
export function resolveElement(index, { element_key, build = null } = {}) {
  if (!isElementKey(element_key)) return { status: 'invalid', reason: 'element_key does not match the Tracer key syntax' };
  if (build !== null && typeof build !== 'string') return { status: 'invalid', reason: 'build must be a string' };
  const rows = index.byKey.get(element_key) || [];
  if (!rows.length) {
    if (build && index.builds.size && !index.builds.has(build)) return { status: 'stale_build', build, known_builds: [...index.builds] };
    return { status: 'not_found', element_key };
  }
  const placements = [...new Set(rows.map(row => row.placement_id))];
  if (placements.length !== 1) return { status: 'ambiguous', element_key, candidates: placements };
  const row = rows[rows.length - 1];
  if (build && row.build && row.build !== build) return { status: 'stale_build', build, expected_build: row.build };
  const handlers = [];
  const seen = new Set();
  for (const candidate of rows) for (const handler of candidate.handlers || []) {
    const key = `${handler.prop}\0${handler.function_id}`;
    if (!seen.has(key)) { seen.add(key); handlers.push(handler); }
  }
  // `status: exact` is about the placement (the key embeds it). Whether the key
  // names exactly one element is `element_confidence`: an ordinal key of a
  // placement with more than one instance is `ambiguous`.
  // Same rules as the MCP's stampKeyTrust (without actions): rows without
  // `instances` (older runtimes) use the highest ordinal of the key's family
  // on the same page as a lower bound; a React key path seen under two keyed
  // parents, or with two content signatures, is not one element.
  let keyKind = stampKeyKind(row);
  const counts = rows.map(candidate => candidate.instances).filter(Number.isInteger);
  const legacy = counts.length ? null : legacyFamily(element_key);
  const bound = legacy && index.legacyFamilies ? Math.max(0, ...rows.map(candidate => index.legacyFamilies.get(`${pageOf(candidate)}\u0000${legacy.family}`) || 0)) : 0;
  if (keyKind === 'react_key' && bound > 1) keyKind = 'ordinal';
  const instances = keyKind === 'ordinal' ? (counts.length ? Math.max(...counts) : (bound || null)) : 1;
  const sites = new Set(rows.map(candidate => candidate.react_key_site).filter(site => typeof site === 'string'));
  const contents = new Set(rows.map(candidate => candidate.content_sig).filter(sig => typeof sig === 'string'));
  const reason = sites.size > 1 ? `react key path observed under ${sites.size} different keyed parent placements`
    : keyKind === 'ordinal' && instances !== 1 ? (instances === null ? 'ordinal key; instance count not recorded' : `ordinal key; ${instances} instances of this placement`)
    : contents.size > 1 ? (keyKind === 'react_key' ? 'key content changed between observations (index-like key)' : 'key content changed between observations') : null;
  const elementConfidence = reason ? 'ambiguous' : 'exact';
  return { status: 'exact', element_key, placement_id: row.placement_id, component: row.component || null, tag: row.tag || null,
    source: { file: row.file, line: row.line }, handlers, build: row.build || null,
    ...(row.shadow_host ? { shadow_host: row.shadow_host, host_tag: row.host_tag || null } : {}),
    sessions: [...new Set(rows.map(candidate => candidate.session).filter(Boolean))],
    key_kind: keyKind, instances, element_confidence: elementConfidence,
    ...(reason ? { reason } : {}) };
}
