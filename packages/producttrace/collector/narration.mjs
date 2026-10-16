/**
 * Narration: the levels of the story above one action line.
 *
 *   valuesOf(bodies, …)      the non-secret values a request or response carried
 *   segmentsOf(lines, …)     lines grouped into goals, each titled as an observation
 *                            ("In Discussions, the user is creating a new discussion, “Q3 plan”.")
 *   narrativeOf(segments)    the visit in a sentence or two
 *
 * Deterministic. Lines join a segment only through an identifier they share
 * with it (a form, an entity id, the page a navigation reached); time only
 * orders them and gives durations. Titles come from `facts` (verb, object,
 * qualifiers), all read from recorded rows; `titleOf` can replace the
 * wording, never the grouping.
 */

const WRITE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const REGISTER = new Set(['register', 'signup', 'sign-up', 'join']);
const LOGIN = new Set(['login', 'signin', 'sign-in', 'session', 'sessions', 'token', 'authenticate']);
const LOGOUT = new Set(['logout', 'signout', 'sign-out']);
const PERSON = new Set(['user', 'author', 'member', 'person', 'profile', 'owner', 'account', 'customer', 'creator', 'assignee']);
// Keys whose values must never be read, even if the runtime let them through.
const SECRET_KEY = /pass(?:word|code)?|secret|token|jwt|otp|cvv|cvc|ssn|credential|api_?key|card_?number/iu;
const PERSONAL_KEY = /email|^(?:first|last|full|given|family|middle|nick|user)_?name$|phone|tel$|address|street|zip|postal|dob|birth/iu;
const LONG_KEY = /^(?:body|description|comment|message|content|text|bio|notes?|summary|html|markdown)$/iu;
const CONTENT_KEY = /^(?:title|name|label|subject|slug|status|role|heading|caption)$|(?:Name|Title|Label|_name|_title)$/u;
const ID_KEY = /^(?:id|_id|uuid)$|(?:Id|_id|ID)$/u;
const LONG_TEXT = 80;
const singular = word => (/ies$/u.test(word) ? `${word.slice(0, -3)}y` : /(?:ss|us)$/u.test(word) ? word : word.replace(/s$/u, ''));
const lower = text => (text ? `${text[0].toLowerCase()}${text.slice(1)}` : text);
const upper = text => (text ? `${text[0].toUpperCase()}${text.slice(1)}` : text);
const quote = text => `“${text}”`;

/** The resource type a URL names: `/discussions/abc` → discussion, `/auth/register` → register. */
export function resourceOf(path, looksLikeId) {
  const parts = String(path || '').split('?')[0].split('/').filter(Boolean);
  const named = parts.filter(part => !looksLikeId(part));
  const last = parts.at(-1);
  return { type: named.length ? singular(named.at(-1)) : null, verb: named.at(-1)?.toLowerCase() ?? null, id: last && looksLikeId(last) ? last : null };
}

function classify(key, value, owner) {
  if (value === '[redacted]' || SECRET_KEY.test(key)) return null;
  if (ID_KEY.test(key) && (typeof value === 'string' || typeof value === 'number')) return 'id';
  if (typeof value !== 'string' || !value.trim()) return null;
  if (PERSONAL_KEY.test(key) || /^[^@\s]+@[^@\s]+\.[^@\s]+$/u.test(value) || (key === 'name' && PERSON.has(owner))) return 'personal';
  if (LONG_KEY.test(key) || value.length > LONG_TEXT) return 'long';
  if (CONTENT_KEY.test(key)) return 'content';
  return null;
}

function mask(value, key) {
  if (/@/u.test(value)) { const [name, domain] = value.split('@'); return `${name[0] || ''}•••@${domain}`; }
  if (/name$/iu.test(key) || key === 'name') return value.split(/\s+/u).map(part => `${part[0]}.`).join(' ');
  return '•••';
}

/**
 * The values one body carried, flattened to `owner.key` with a class:
 * personal (an email, a person's name), content (a short title or name),
 * long (only its length), id. Secrets are never read. Lists are counted by
 * the caller, not read item by item.
 */
export function valuesOf(json, { from, type, show = {} } = {}) {
  const out = [];
  const personal = show.personal ?? 'show';
  const content = show.content ?? 'show';
  const walk = (node, path, owner, depth) => {
    if (!node || typeof node !== 'object' || Array.isArray(node) || depth > 3) return;
    for (const [key, value] of Object.entries(node)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) { walk(value, [...path, key], singular(key), depth + 1); continue; }
      const kind = classify(key, value, owner);
      if (!kind) continue;
      const entry = { key: [...path, key].join('.'), owner, class: kind, from };
      if (kind === 'long') entry.length = String(value).length;
      else if (kind === 'personal' && personal === 'drop') continue;
      else if (kind === 'personal' && personal === 'mask') { entry.value = mask(String(value), key); entry.masked = true; }
      else if (kind === 'content' && content === 'length') entry.length = String(value).length;
      else entry.value = kind === 'id' ? String(value) : value;
      out.push(entry);
    }
  };
  // `{ data: {...} }` is an envelope: its fields belong to the request's type.
  const root = json && typeof json === 'object' && !Array.isArray(json) && json.data && typeof json.data === 'object' && !Array.isArray(json.data) && Object.keys(json).every(key => ['data', 'meta'].includes(key)) ? json.data : json;
  walk(root, [], type, 0);
  return out;
}

/** Entities a body names: `{ id }` of the request's type, `{ user: { id } }`, `teamId` (a reference). */
export function entitiesOfValues(values, { type, from }) {
  const out = [];
  for (const entry of values) {
    if (entry.class !== 'id') continue;
    const key = entry.key.split('.').at(-1);
    if (/^(?:id|_id|uuid)$/u.test(key)) { if (entry.owner) out.push({ type: entry.owner, id: entry.value, from, ...(entry.owner === type && !entry.key.includes('.') ? {} : { reference: true }) }); continue; }
    const named = key.replace(/(?:_id|Id|ID)$/u, '');
    if (named) out.push({ type: named.toLowerCase(), id: entry.value, from, reference: true });
  }
  return out;
}

/** A list a response carried: `[...]` or `{ data: [...] }`, with the total the server gave. */
export function listOf(json, { type, truncated, show = {} }) {
  const items = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : Array.isArray(json?.items) ? json.items : Array.isArray(json?.results) ? json.results : null;
  if (!items) return null;
  const total = [json?.meta?.total, json?.total, json?.count, json?.meta?.count].find(Number.isFinite);
  // What the list called its items, so a later delete or open can name one ("the discussion “Gamma topic”").
  const names = {};
  if ((show.content ?? 'show') === 'show') for (const item of items.slice(0, LIST_NAMES)) {
    const id = item && (typeof item.id === 'string' || typeof item.id === 'number') ? String(item.id) : null;
    const name = id ? ['title', 'name', 'subject', 'label'].map(key => item[key]).find(value => typeof value === 'string' && value.trim() && value.length <= LONG_TEXT) : null;
    if (name) names[id] = name;
  }
  return { type, count: items.length, ...(Number.isFinite(total) ? { total } : {}), ...(truncated ? { at_least: true } : {}), ...(Object.keys(names).length ? { names } : {}) };
}
const LIST_NAMES = 100;

const ok = request => request.state === 'done' && request.status >= 200 && request.status < 400;
const failed = request => request.state === 'no_response' || request.state === 'aborted' || (request.state === 'done' && request.status >= 400);
const writesOf = line => (line.requests || []).filter(request => WRITE.has(request.method));
const formOf = line => line.form ?? null;
const idsOf = line => new Set((line.entities || []).map(entity => `${entity.type}:${entity.id}`));
// Where the person is after a line: the last page it reached, else where it happened.
const placeAfter = line => line.navigations?.at(-1)?.to?.split('?')[0] ?? line.page ?? null;
const CLICK = new Set(['click', 'auxclick', 'dblclick']);
const effectful = line => (line.requests?.length || 0) > 0 || (line.navigations?.length || 0) > 0;

/**
 * Lines grouped into segments, in order. A line joins the open segment when it
 * shares the segment's form, an entity id, or the page the segment is on (and
 * the segment has not finished a write). After a write succeeds, the next line
 * that does something starts a new segment unless it is the same form or
 * writes to the same entity.
 */
export function groupLines(lines) {
  const groups = [];
  let open = null;
  const start = line => {
    // The click that opened what comes next (a form, a confirm dialog) leads the goal it opened, not the one before.
    const previous = open?.lines;
    const opener = previous?.at(-1);
    const leads = open && open.session === line.session && previous.length > 1 && line.kind !== 'open' && opener.kind === 'act' && CLICK.has(opener.event)
      && !effectful(opener) && !formOf(opener) && opener.page === line.page
      // It opened the form being filled in, or its control is keyed by the entity the next line acts on (a row's "Delete", then its confirm).
      && (formOf(line) !== null || (line.entities || []).some(entity => String(entity.id).length > 3 && opener.element?.key?.includes(String(entity.id))));
    if (leads) previous.pop();
    open = { lines: [], forms: new Set(), unsent: new Set(), ids: new Set(), place: placeAfter(line), wrote: false, scrolledOn: null, session: line.session };
    if (leads) { open.lines.push(opener); note(opener); }
    open.lines.push(line); note(line); groups.push(open);
  };
  const note = line => {
    if (formOf(line)) open.forms.add(formOf(line));
    if (line.kind === 'type' && formOf(line)) open.unsent.add(formOf(line));
    if (line.kind === 'submit' || writesOf(line).length) open.unsent.delete(formOf(line));
    for (const id of idsOf(line)) open.ids.add(id);
    open.place = placeAfter(line) ?? open.place;
    // A write that was answered, accepted or not, ends the goal; a retry in the same form still joins.
    if (writesOf(line).some(request => ok(request) || failed(request))) open.wrote = true;
    if (line.kind === 'scroll') open.scrolledOn = line.page;
  };
  for (const line of lines) {
    if (!open || open.session !== line.session || line.kind === 'open' || open.lines[0].kind === 'open') { start(line); continue; }
    const sameForm = formOf(line) !== null && open.forms.has(formOf(line));
    const sharesId = [...idsOf(line)].some(id => open.ids.has(id));
    const writesSame = writesOf(line).some(request => request.entities?.some(entity => !entity.created && open.ids.has(`${entity.type}:${entity.id}`)));
    // A form that starts on a page the segment has been browsing (scrolling) is a new goal.
    const otherForm = formOf(line) !== null && (open.forms.size > 0 || (open.scrolledOn !== null && open.scrolledOn === line.page)) && !sameForm;
    const here = line.kind !== 'navigate' && line.page !== null && line.page === open.place;
    // Where a write left the person: a navigation of its own that leaves the very page the write was sent from,
    // with nothing in between (the redirect after signing up, when the app makes it from an effect).
    const previous = open.lines.at(-1);
    const landing = line.kind === 'navigate' && writesOf(previous).some(request => ok(request)) && !previous.navigations?.length
      && line.navigations?.[0]?.via !== 'popstate' && pathKey(line.navigations?.[0]?.from ?? '') === pathKey(previous.page ?? '\u0000');
    // A form typed in and not sent ends when the person does something outside it (the draft was left).
    const leaves = open.unsent.size > 0 && effectful(line) && !(formOf(line) && open.unsent.has(formOf(line)));
    // Leaving the page that was being scrolled, for a page about nothing the segment showed (a menu link), is a goal of its own.
    const leavesBrowsing = open.scrolledOn !== null && !open.forms.size && !open.wrote && CLICK.has(line.event) && !(line.entities || []).length
      && line.navigations?.length && pathKey(line.navigations.at(-1).to) !== pathKey(open.scrolledOn);
    let joins;
    if (landing) joins = true;
    else if (leavesBrowsing) joins = false;
    else if (leaves) joins = false;
    else if (open.wrote) joins = sameForm || writesSame || (!effectful(line) && here && !otherForm);
    else joins = !otherForm && (sameForm || sharesId || here);
    if (joins) { open.lines.push(line); note(line); } else start(line);
  }
  return groups.map(group => group.lines);
}

const pathKey = url => String(url || '').split('?')[0].split('#')[0];
const AUTH_VERBS = new Set(['registered', 'logged_in', 'logged_out']);

/**
 * What a session's lines say about names, read once before grouping:
 * an entity's title (from a body that carried both its id and its title),
 * a page's name (the label of the link that led there), and the person's
 * name (only from what the server returned for an auth write or a `/me` read).
 */
export function namesOf(lines, { looksLikeId, pageTitles: titleRows = [] }) {
  const titles = new Map();
  const pages = new Map();
  // What each entity's fields were as the server returned them, line by line (for "renaming it to …").
  const fields = [];
  // Every title the server returned, in order, so a goal after a rename uses the new one.
  const named = [];
  let person = null;
  let personLine = null;
  lines.forEach((line, index) => {
    for (const request of line.requests || []) {
      const values = request.values || [];
      for (const [id, name] of Object.entries(request.list?.names || {})) {
        if (!request.list.type) continue;
        if (!titles.has(`${request.list.type}:${id}`)) titles.set(`${request.list.type}:${id}`, name);
        named.push({ index, key: `${request.list.type}:${id}`, title: name });
      }
      if (ok(request)) for (const [key, entity] of fieldsOf(values.filter(entry => entry.from === 'response_body'))) fields.push({ index, key, fields: entity });
      for (const entry of values) {
        if (entry.class !== 'content' || !entry.value || !/(?:^|\.)(?:title|name|subject|label)$/u.test(entry.key)) continue;
        const prefix = entry.key.split('.').slice(0, -1).join('.');
        const id = values.find(other => other.class === 'id' && other.key === (prefix ? `${prefix}.id` : 'id'));
        if (!id || !entry.owner) continue;
        if (!titles.has(`${entry.owner}:${id.value}`)) titles.set(`${entry.owner}:${id.value}`, entry.value);
        if (entry.from === 'response_body' && ok(request)) named.push({ index, key: `${entry.owner}:${id.value}`, title: entry.value });
      }
      const resource = resourceOf(request.path, looksLikeId);
      const auth = REGISTER.has(resource.verb) || LOGIN.has(resource.verb) || (request.method === 'GET' && resource.verb === 'me');
      if (auth && ok(request) && !person) {
        const returned = values.filter(entry => entry.from === 'response_body' && entry.class === 'personal' && entry.value && !entry.masked && !/@/u.test(entry.value));
        const first = returned.find(entry => /first_?name$|given_?name$/iu.test(entry.key));
        const last = returned.find(entry => /last_?name$|family_?name$/iu.test(entry.key));
        const full = returned.find(entry => /(?:^|\.)(?:full_?name|name)$/iu.test(entry.key));
        person = first ? [first.value, last?.value].filter(Boolean).join(' ') : full?.value ?? null;
        if (person) personLine = line.id;
      }
    }
    for (const nav of line.navigations || []) if (line.element?.tag === 'a' && line.element.label && !pages.has(pathKey(nav.to))) pages.set(pathKey(nav.to), line.element.label);
  });
  const order = new Map(lines.map((line, index) => [line.id, index]));
  /** An entity's fields as last returned before a line. */
  const knownBefore = (key, lineId) => {
    const until = order.get(lineId) ?? Infinity;
    const known = {};
    for (const entry of fields) if (entry.key === key && entry.index < until) Object.assign(known, entry.fields);
    return known;
  };
  /** An entity's title as the server last returned it before a line; else the first one seen. */
  const titleAt = (key, lineId) => {
    const until = order.get(lineId) ?? Infinity;
    return named.filter(entry => entry.key === key && entry.index < until).at(-1)?.title ?? titles.get(key) ?? null;
  };
  const titledPages = pageTitles(lines, titleRows);
  return { titles, pages, titled: titledPages.names, pageTitle: titledPages.raw, person, personLine, knownBefore, titleAt };
}

/**
 * A page's own name from the document titles the session saw: the part of
 * each title that is not shared by all of them ("Dashboard | Acme" and
 * "Discussions | Acme" → Dashboard, Discussions). One distinct title says
 * nothing about which part is the app's name, so it names no page.
 */
function pageTitles(lines, rows = []) {
  // Titles the app set (page.title rows) say which page they belong to; a click's title only fills in a page they don't cover.
  // The last title seen on a page wins (an app may set it a moment after the route changes), and a
  // title first seen on another page is that page's, not this one's (it had not changed yet).
  const owner = new Map();
  const byPath = new Map();
  for (const row of rows) if (row.page) { const key = pathKey(row.page); if (!owner.has(row.title)) owner.set(row.title, key); if (owner.get(row.title) === key) byPath.set(key, row.title); }
  const set = new Set(byPath.keys());
  for (const line of lines) {
    if (!line.page || !line.page_title || set.has(pathKey(line.page))) continue;
    const key = pathKey(line.page);
    if (!owner.has(line.page_title)) owner.set(line.page_title, key);
    if (owner.get(line.page_title) === key) byPath.set(key, line.page_title);
  }
  const parts = title => title.split(/\s+[|·–—-]\s+|\s*::\s*/u).map(part => part.trim()).filter(Boolean);
  const distinct = [...new Set(byPath.values())];
  const out = new Map();
  if (distinct.length < 2) return { names: out, raw: byPath };
  const shared = parts(distinct[0]).filter(part => distinct.every(title => parts(title).includes(part)));
  for (const [path, title] of byPath) {
    const name = parts(title).filter(part => !shared.includes(part)).join(' ');
    if (name && !/@/u.test(name)) out.set(path, name);
  }
  return { names: out, raw: byPath };
}

/** Fields per entity in one body: `{ id, title }` → discussion:id → { title }; nested owners by their own id. */
function fieldsOf(values) {
  const out = new Map();
  for (const id of values.filter(entry => entry.class === 'id' && /(?:^|\.)id$/u.test(entry.key) && entry.owner)) {
    const prefix = id.key.split('.').slice(0, -1).join('.');
    const entity = {};
    for (const entry of values) {
      if (entry.class === 'id' || entry.key.split('.').slice(0, -1).join('.') !== prefix) continue;
      entity[entry.key.split('.').at(-1)] = entry.value ?? `#${entry.length}`;
    }
    out.set(`${id.owner}:${id.value}`, entity);
  }
  return out;
}

/** "In Discussions", "In “Notes on the engine”", "On the Register page", "On /app". */
function placePhrase(path, { names, looksLikeId, auth = false }) {
  if (!path) return null;
  const key = pathKey(path);
  const resource = resourceOf(key, looksLikeId);
  if (resource.id && names.titles.has(`${resource.type}:${resource.id}`)) return `In ${quote(names.titles.get(`${resource.type}:${resource.id}`))}`;
  const label = names.titled?.get(key) ?? names.pages.get(key);
  if (label) return auth ? `On the ${label} page` : `In ${label}`;
  return `On ${pageName(key, looksLikeId)}`;
}

/** A page with no link label: "the home page", "/auth/register" → "the Register page". */
function pageName(path, looksLikeId) {
  const key = pathKey(path);
  if (key === '/' || !key) return 'the home page';
  const named = key.split('/').filter(part => part && !looksLikeId(part)).at(-1);
  return named ? `the ${upper(named.replace(/[-_]+/gu, ' '))} page` : key;
}

const thing = (type, id, title) => (title ? `the ${type} ${quote(title)}` : id ? `${type} ${id}` : `a ${type}`);
// "an 8-character", "an 11-character", "a 12-character": the article by how the number is said.
const articleFor = number => { const digits = String(number); return digits[0] === '8' || (/^1[18]/u.test(digits) && digits.length % 3 === 2) ? 'an' : 'a'; };
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

/** "the Discussions page", "“Notes on the engine”", "the home page": how a step or a title names a page. */
function pagePhrase(path, names, looksLikeId, lineId = null) {
  if (!path) return 'the page';
  const key = pathKey(path);
  const resource = resourceOf(key, looksLikeId);
  const title = resource.id ? (lineId && names.titleAt?.(`${resource.type}:${resource.id}`, lineId)) || names.titles?.get(`${resource.type}:${resource.id}`) : null;
  if (title) return `the ${resource.type} ${quote(title)}`;
  // A page's own title is quoted when it is more than a word ("the “Log in to your account” page").
  const titled = names.titled?.get(key);
  if (titled) return `the ${/\s/u.test(titled) ? quote(titled) : titled} page`;
  const label = names.pages?.get(key);
  return label ? `the ${label} page` : pageName(key, looksLikeId);
}

const NOUN = { a: 'link', button: 'button', input: 'field', textarea: 'field', select: 'menu' };

/**
 * One sub-action under a segment, in the voice of NAPsack's action captions
 * (spec §7): past tense, verb first, no subject, the app's labels and the sent
 * value quoted, and "to …" only when this line's own requests or navigation
 * show the result.
 */
export function stepOf(line, { sent = [], names, looksLikeId, first = false }) {
  const label = line.element?.label;
  const noun = NOUN[line.element?.tag] ?? 'element';
  const named = label ? `the ${quote(label)} ${noun}` : `a ${noun}`;
  const page = path => pagePhrase(path, names, looksLikeId, line.id);
  const titleOf = (type, id) => (type && id ? names.titleAt?.(`${type}:${id}`, line.id) ?? names.titles?.get(`${type}:${id}`) ?? null : null);
  const requests = line.requests || [];
  const writes = requests.filter(request => WRITE.has(request.method));
  const purposes = [];
  const problems = [];
  for (const request of requests) {
    if (failed(request)) problems.push(request.state === 'done' ? `the server returned ${request.status}` : 'the server never answered');
  }
  for (const request of writes.filter(ok)) {
    const resource = resourceOf(request.path, looksLikeId);
    const made = (request.entities || []).filter(entity => entity.created);
    const returned = (request.entities || []).filter(entity => entity.from === 'response_body');
    if (made.length) purposes.push(`create ${made.map(entity => `${entity.type} ${entity.id}`).join(' and ')}`);
    else if (REGISTER.has(resource.verb)) purposes.push(returned.length ? `create ${returned.map(entity => `${entity.type} ${entity.id}`).join(' and ')}` : 'sign up');
    else if (LOGIN.has(resource.verb)) purposes.push('log in');
    else if (LOGOUT.has(resource.verb)) purposes.push('log out');
    else if (request.method === 'DELETE' && resource.id) purposes.push(`delete ${thing(resource.type, resource.id, titleOf(resource.type, resource.id))}`);
    else if ((request.method === 'PUT' || request.method === 'PATCH') && resource.id) {
      const before = titleOf(resource.type, resource.id);
      const renamed = (request.values || []).find(entry => entry.from === 'request_body' && entry.class === 'content' && /^(?:title|name|subject)$/u.test(entry.key) && entry.value && before && entry.value !== before);
      purposes.push(renamed ? `rename ${thing(resource.type, resource.id, before)} to ${quote(renamed.value)}` : `save ${thing(resource.type, resource.id, before)}`);
    }
    else purposes.push(`send ${request.method} ${pathKey(request.path)}`);
  }
  // Nothing written: what the click read (one list or one entity), else where it went.
  if (!writes.length && line.kind !== 'open') {
    const read = requests.find(request => ok(request) && (request.list || resourceOf(request.path, looksLikeId).id));
    if (read?.list?.type) purposes.push(`view the ${read.list.type} list${(read.list.total ?? read.list.count) === 0 && !read.list.at_least ? ', which was empty' : ''}`);
    else if (read) {
      const resource = resourceOf(read.path, looksLikeId);
      const own = (read.values || []).find(entry => entry.class === 'content' && /^(?:data\.)?(?:title|name|subject)$/u.test(entry.key) && entry.value);
      purposes.push(`open ${thing(resource.type, resource.id, own?.value ?? titleOf(resource.type, resource.id))}`);
    } else if (line.navigations?.length && line.kind !== 'type') purposes.push(`open ${page(line.navigations.at(-1).to)}`);
  }
  const landed = writes.length && line.navigations?.length ? `, then landed on ${page(line.navigations.at(-1).to)}` : '';
  const where = first ? ` on ${page(line.page)}` : '';
  const tail = `${where}${purposes.length ? ` to ${purposes.join(' and ')}` : ''}${landed}${problems.length ? `, but ${problems.join(' and ')}` : ''}.`;
  switch (line.kind) {
    case 'open': return `Opened ${page(line.page)}${problems.length ? `, but ${problems.join(' and ')}` : ''}.`;
    case 'navigate': return line.text.startsWith('Went back') ? `Went back or forward to ${page(line.page)}.` : `Landed on ${page(line.page)}.`;
    case 'scroll': return `Scrolled ${line.direction || 'through the page'}${line.screens ? ` about ${plural(line.screens, 'screen')}` : ''} on ${page(line.page)}.`;
    case 'type': {
      const into = `into ${named}${where}.`;
      if (line.secret) return `Typed a password ${into}`;
      const value = sent.find(entry => line.field && entry.key === line.field);
      if (value?.class === 'long') return `Typed ${articleFor(value.length)} ${value.length}-character ${label ? label.toLowerCase() : 'text'} ${into}`;
      if (value?.value !== undefined) return `Typed ${quote(value.value)} ${into}`;
      return `Typed ${into}`;
    }
    case 'submit': return label ? `Clicked the ${quote(label)} button${tail}` : `Submitted the form${tail}`;
    default: {
      const verb = line.event === 'change' ? 'Changed' : line.event === 'dblclick' ? 'Double-clicked' : HOVERS.has(line.event) || line.kind === 'hover' ? 'Hovered over' : 'Clicked';
      return `${verb} ${named}${tail}`;
    }
  }
}
const HOVERS = new Set(['mouseover', 'mouseout', 'mouseenter', 'mouseleave', 'pointerover', 'pointerenter']);

/**
 * What was there when a line happened (NAPsack's dense caption): who was
 * signed in, what loaded and what the server made, never what was done.
 */
export function stepFactsOf(line, { names, looksLikeId }) {
  const out = [];
  // Where a page's name came from: the title the app gave the page this line reached.
  const reached = line.kind === 'navigate' ? line.page : line.navigations?.at(-1)?.to;
  if (reached && names.titled?.has(pathKey(reached))) out.push(`Page title ${quote(names.pageTitle.get(pathKey(reached)))} at ${pathKey(reached)}`);
  const titleOf = (type, id) => names.titleAt?.(`${type}:${id}`, line.id) ?? names.titles?.get(`${type}:${id}`) ?? null;
  for (const request of line.requests || []) {
    const resource = resourceOf(request.path, looksLikeId);
    if (failed(request)) { out.push(`${request.method} ${pathKey(request.path)} ${request.state === 'done' ? `returned ${request.status}` : 'got no response'}`); continue; }
    if (!ok(request)) continue;
    const made = (request.entities || []).filter(entity => entity.created);
    if (resource.verb === 'me' || ((REGISTER.has(resource.verb) || LOGIN.has(resource.verb)) && !made.length)) {
      const user = (request.entities || []).find(entity => entity.from === 'response_body' && !entity.reference) || (request.entities || []).find(entity => entity.from === 'response_body');
      if (user) out.push(`Signed in as ${user.type} ${user.id}${names.person ? ` (${names.person})` : ''}`);
    }
    for (const entity of made) out.push(`New ${entity.type}${titleOf(entity.type, entity.id) ? ` ${quote(titleOf(entity.type, entity.id))}` : ''} (${entity.id})`);
    if (request.list?.type) {
      const count = request.list.total ?? request.list.count;
      const titles = Object.values(request.list.names || {}).slice(0, 3).map(quote);
      out.push(`${request.list.at_least ? 'At least ' : ''}${plural(count, request.list.type)}${titles.length ? `: ${titles.join(', ')}${count > titles.length ? ', …' : ''}` : ''}`);
    } else if (request.method === 'GET' && resource.id && resource.verb !== 'me') {
      const own = (request.values || []).find(entry => entry.class === 'content' && /^(?:data\.)?(?:title|name|subject)$/u.test(entry.key) && entry.value);
      const title = own?.value ?? titleOf(resource.type, resource.id);
      out.push(`${upper(resource.type)}${title ? ` ${quote(title)}` : ''} (${resource.id})`);
    }
  }
  return out;
}

/** Everything a title can say about a segment, read from its lines and the session's names. */
export function factsOf(lines, { looksLikeId, names = { titles: new Map(), pages: new Map(), person: null }, earlier = [] }) {
  const requests = lines.flatMap(line => line.requests || []);
  const writes = requests.filter(request => WRITE.has(request.method));
  const values = lines.flatMap(line => line.values || []);
  const created = new Set(earlier.flatMap(segment => segment.entities.filter(entity => entity.created).map(entity => `${entity.type}:${entity.id}`)));
  // Titles as they stood when the goal began (a goal after a rename uses the new one).
  const titleAt = key => names.titleAt?.(key, lines[0].id) ?? names.titles.get(key) ?? null;
  const facts = { verb: null, subject: names.person, place: null, object: null, who: null, qualifiers: [], failed: null, opened: null, lands: null, list: null, scrolled: null, typed: [], fields: [], first: false };
  const write = writes.find(ok) || null;
  const bad = write ? null : writes.find(failed) || null;
  // A write whose answer was not recorded (body capture off) still says what was attempted, less surely.
  const unanswered = write || bad ? null : writes[0] || null;
  const target = write || bad || unanswered;
  if (unanswered) facts.unconfirmed = true;
  const main = target ? lines.find(line => line.requests?.includes(target)) : null;
  if (target) {
    const resource = resourceOf(target.path, looksLikeId);
    const auth = REGISTER.has(resource.verb) ? 'registered' : LOGIN.has(resource.verb) ? 'logged_in' : LOGOUT.has(resource.verb) ? 'logged_out' : null;
    const made = target.entities?.find(entity => entity.created);
    facts.verb = auth || (target.method === 'DELETE' ? 'deleted' : target.method === 'POST' && made ? 'created' : target.method === 'POST' ? 'sent' : 'edited');
    if (bad) facts.failed = { status: bad.state === 'done' ? bad.status : null };
    const sent = (target.values || []).filter(entry => entry.from === 'request_body');
    if (auth) {
      facts.who = sent.find(entry => entry.class === 'personal' && /email/iu.test(entry.key) && entry.value)?.value ?? null;
      // "for the team Acme": a short name sent for something other than the person.
      for (const entry of sent) {
        const match = /^(.+?)(?:Name|_name)$/u.exec(entry.key.split('.').at(-1));
        if (entry.class === 'content' && entry.value && match && !/^(?:first|last|full|user|nick|given|family)$/iu.test(match[1])) facts.qualifiers.push({ kind: 'for', type: lower(match[1]), value: entry.value });
      }
    } else {
      const type = made?.type ?? resource.type;
      const id = made?.id ?? resource.id;
      facts.object = { type, id: id ?? null, title: type && id ? titleAt(`${type}:${id}`) : null, created: Boolean(made) };
      const parent = (target.entities || []).find(entity => entity.reference && entity.from === 'request_body' && entity.type !== type);
      if (parent) facts.qualifiers.push({ kind: 'on', type: parent.type, id: parent.id, title: titleAt(`${parent.type}:${parent.id}`) });
      if (facts.verb === 'edited' && id) {
        // Only fields that differ from what the server last returned for this entity; none known, none claimed.
        const known = names.knownBefore ? names.knownBefore(`${type}:${id}`, main.id) : {};
        const changed = sent.filter(entry => entry.class !== 'id' && !entry.key.includes('.')).filter(entry => entry.key in known && known[entry.key] !== (entry.value ?? `#${entry.length}`));
        facts.fields = changed.map(entry => entry.key);
        const renamed = changed.find(entry => /^(?:title|name|subject)$/u.test(entry.key) && entry.value);
        if (renamed) facts.renamed_to = renamed.value;
      }
      // "its first comment": the list of that type, read in this segment before the write, was empty.
      const before = lines.slice(0, lines.indexOf(main)).flatMap(line => line.requests || []).filter(request => request.list?.type === type);
      if (made && before.length && before.every(request => (request.list.total ?? request.list.count) === 0 && !request.list.at_least)) {
        facts.first = true;
        facts.first_evidence = lines.filter(line => line.requests?.some(request => before.includes(request))).map(line => line.id);
      }
    }
    const after = lines.slice(lines.indexOf(main)).flatMap(line => line.navigations || []).filter(nav => nav.via !== 'popstate');
    if (after.length && !facts.failed) facts.lands = pagePhrase(after.at(-1).to, names, looksLikeId);
    // A delete later in the same goal (a comment posted, then removed) is said after it.
    facts.then_deleted = writes.filter(request => request !== target && ok(request) && request.method === 'DELETE' && lines.findIndex(line => line.requests?.includes(request)) > lines.indexOf(main))
      .map(request => resourceOf(request.path, looksLikeId)).filter(resource => resource.id)
      .map(resource => ({ type: resource.type, id: resource.id, title: titleAt(`${resource.type}:${resource.id}`) }));
    // The page the person went to on the way to the write ("Opened the Discussions page and created …").
    const into = lines.slice(0, lines.indexOf(main)).flatMap(line => line.navigations || []).filter(nav => nav.via !== 'popstate');
    if (into.length) facts.entered = pagePhrase(into.at(-1).to, names, looksLikeId);
  }
  // Opened: a page or a single entity reached by a click or a hover.
  const openedEntity = lines.flatMap(line => (line.navigations || []).flatMap(nav => idsOfPath(nav.to, looksLikeId)))[0]
    // A GET of one entity is an open only from a line that wrote nothing, before any write: the app's refetch after a save is not.
    || lines.slice(0, main ? lines.indexOf(main) : lines.length).filter(line => !writesOf(line).length).flatMap(line => line.requests || [])
      .filter(request => request.method === 'GET' && resourceOf(request.path, looksLikeId).id).map(request => resourceOf(request.path, looksLikeId))[0];
  if (openedEntity && !(facts.object?.created && facts.object.id === openedEntity.id) && !AUTH_VERBS.has(facts.verb)) {
    facts.opened = { type: openedEntity.type, id: openedEntity.id, title: titleAt(`${openedEntity.type}:${openedEntity.id}`), just_created: created.has(`${openedEntity.type}:${openedEntity.id}`) };
  }
  const lists = requests.map(request => request.list).filter(Boolean);
  if (lists.length) facts.list = lists.at(-1);
  const scrolls = lines.filter(line => line.kind === 'scroll');
  if (scrolls.length) facts.scrolled = { screens: scrolls.reduce((sum, line) => sum + (line.screens || 0), 0) };
  const submitted = new Set(lines.filter(line => line.kind === 'submit').map(formOf).filter(Boolean));
  facts.typed = [...new Set(lines.filter(line => line.kind === 'type' && !submitted.has(formOf(line))).map(line => line.element?.label).filter(Boolean))];
  const navigated = lines.flatMap(line => line.navigations || []);
  if (!facts.verb) {
    if (lines[0].kind === 'open') facts.verb = 'opened_app';
    else if (facts.typed.length) facts.verb = 'drafting';
    else if (facts.opened) facts.verb = 'opened';
    else if (facts.scrolled) facts.verb = 'scrolled';
    else if (facts.list) facts.verb = 'browsed';
    else if (navigated.length) facts.verb = 'navigated';
  }
  // Where it happens: the page of the main action, else where the segment ends up (a list), else where it started.
  const auth = AUTH_VERBS.has(facts.verb);
  // A navigation of its own (back/forward, a redirect) happened where it started from.
  const start = lines[0].kind === 'navigate' ? lines[0].navigations?.[0]?.from ?? lines[0].page : lines[0].page;
  const page = main?.page ?? (facts.verb === 'opened' ? (lines.find(line => line.navigations?.length || line.kind === 'hover')?.page ?? start)
    : facts.verb === 'scrolled' ? scrolls.at(-1).page
    : ['browsed', 'drafting'].includes(facts.verb) ? placeAfter(lines.at(-1)) : start);
  facts.page = page ? pathKey(page) : null;
  facts.place = placePhrase(page, { names, looksLikeId, auth });
  facts.where = page ? pagePhrase(page, names, looksLikeId, lines[0].id) : null;
  // What a left draft was, in the app's own words: the button that opened its form ("Create Comment" → comment).
  const opener = lines.map(line => /^(?:create|new|add|write|post|reply|start)\s+(?:a\s+|new\s+)?(\w+)$/iu.exec(line.element?.label ?? '')).find(Boolean);
  if (opener && facts.verb === 'drafting') facts.draft = opener[1].toLowerCase();
  if (facts.verb === 'navigated') { facts.destination = pagePhrase(navigated.at(-1).to, names, looksLikeId); facts.history = navigated.every(nav => nav.via === 'popstate'); }
  return facts;
}

function idsOfPath(url, looksLikeId) {
  const resource = resourceOf(pathKey(url), looksLikeId);
  return resource.id && resource.type ? [{ type: resource.type, id: resource.id }] : [];
}
const placeName = (path, names, looksLikeId) => {
  const resource = resourceOf(path, looksLikeId);
  if (resource.id && names.titles.has(`${resource.type}:${resource.id}`)) return quote(names.titles.get(`${resource.type}:${resource.id}`));
  return names.pages.get(path) ?? pageName(path, looksLikeId);
};

/**
 * The deterministic title, in the voice of NAPsack's task captions (spec §7):
 * past tense, verb first, no subject, named things and sent values quoted,
 * one step joined with "and" where the goal had two parts.
 */
export function defaultTitle(facts, { open = false } = {}) {
  const object = facts.object;
  const said = entry => entry.id && facts.opened?.id === entry.id;
  const qualifiers = facts.qualifiers.map(entry => (entry.kind === 'for' ? ` for the ${entry.type} ${quote(entry.value)}` : entry.kind === 'on' && !said(entry) ? ` on ${thing(entry.type, entry.id, entry.title)}` : '')).join('');
  const as = facts.who ? ` as ${facts.who}` : '';
  // Acting on what was just opened: "it".
  const onOpened = object?.id && facts.opened?.id === object.id;
  const objectPhrase = () => {
    if (!object?.type) return 'something';
    if (onOpened) return 'it';
    if (!object.created) return thing(object.type, object.id, object.title);
    // "its first comment" when it belongs to what was just opened.
    const parent = facts.qualifiers.find(entry => entry.kind === 'on');
    const its = parent && facts.opened && parent.id === facts.opened.id;
    return `${its ? 'its' : facts.first ? 'the' : 'a'} ${facts.first ? 'first ' : ''}${object.type}${object.title ? ` titled ${quote(object.title)}` : ''}`;
  };
  const others = facts.fields.filter(key => !facts.renamed_to || !/^(?:title|name|subject)$/u.test(key));
  const action = {
    registered: ['registered', 'register'], logged_in: ['logged in', 'log in'], logged_out: ['logged out', 'log out'],
    // Made under something else (a comment on a discussion): posted.
    created: facts.qualifiers.some(entry => entry.kind === 'on') ? [`posted ${objectPhrase()}`, `post ${objectPhrase()}`] : [`created ${objectPhrase()}`, `create ${objectPhrase()}`],
    deleted: [`deleted ${objectPhrase()}`, `delete ${objectPhrase()}`],
    edited: facts.renamed_to ? [`renamed ${objectPhrase()} to ${quote(facts.renamed_to)}${others.length ? `, changing ${onOpened ? 'its' : 'the'} ${others.join(' and ')}` : ''}`, `rename ${objectPhrase()}`]
      : others.length ? [`changed ${onOpened ? 'its' : 'the'} ${others.join(' and ')}${onOpened ? '' : ` of ${objectPhrase()}`}`, `edit ${objectPhrase()}`]
      : [`edited ${objectPhrase()}`, `edit ${objectPhrase()}`],
    sent: [`sent ${objectPhrase()}`, `send ${objectPhrase()}`],
  }[facts.verb];
  const justMade = facts.opened?.just_created;
  const opened = facts.opened ? (justMade ? (facts.opened.title ? `${quote(facts.opened.title)}, the ${facts.opened.type} they just created,` : `the ${facts.opened.type} they just created`) : thing(facts.opened.type, facts.opened.id, facts.opened.title)) : null;
  // What the person opened on the way: the entity, else the page they went to.
  const lead = opened ? `opened ${opened} and ` : facts.entered && !AUTH_VERBS.has(facts.verb) ? `opened ${facts.entered} and ` : '';
  let text;
  if (action) {
    const [done, infinitive] = action;
    if (facts.failed) text = `${lead}tried to ${infinitive}${as}${qualifiers}, but ${facts.failed.status ? `the server returned ${facts.failed.status}` : 'got no response'}`;
    else text = `${lead}${done}${as}${qualifiers}${facts.lands ? ` and landed on ${facts.lands}` : ''}${(facts.then_deleted || []).map(entry => `, then deleted ${object?.created && object.id === entry.id ? 'it' : thing(entry.type, entry.id, entry.title)}`).join('')}`;
  } else {
    const list = facts.list ? `the ${facts.list.type} list (${facts.list.at_least ? 'at least ' : ''}${plural(facts.list.total ?? facts.list.count, facts.list.type)})` : null;
    switch (facts.verb) {
      case 'opened_app': text = `opened ${facts.where ?? 'the app'}${facts.subject ? `, signed in as ${facts.subject}` : ''}`; break;
      case 'opened': text = `opened ${opened}`; break;
      case 'drafting': {
        const what = facts.draft ? `started a ${facts.draft}${facts.where ? ` on ${facts.where}` : ''}` : `filled in ${facts.typed.map(quote).join(' and ')}${facts.where ? ` on ${facts.where}` : ''}`;
        text = open ? what : `${what} but left without sending it`;
        break;
      }
      case 'scrolled': text = `scrolled ${facts.scrolled.screens > 1 ? `about ${facts.scrolled.screens} screens ` : ''}through ${list ?? facts.where ?? 'the page'}${list && !open ? ' without opening one' : ''}`; break;
      case 'browsed': text = facts.list.count || facts.list.total ? `viewed ${list}` : `viewed the empty ${facts.list.type} list`; break;
      case 'navigated': text = `${facts.history ? 'went back or forward to' : 'went to'} ${facts.destination}`; break;
      default: return null;
    }
  }
  return `${upper(text)}.`;
}

// How sure the title is: 10 shown outright, lower as it leans on less.
const CONFIDENCE = { registered: 9, logged_in: 9, logged_out: 9, created: 9, deleted: 9, edited: 8, sent: 7, opened_app: 10, opened: 8, navigated: 9, browsed: 8, scrolled: 7, drafting: 6 };

/**
 * Segments over a story's lines, in order. `titleOf(facts, segment)` may
 * return different wording (an annotator); null or a throw keeps the
 * deterministic title, and the grouping never changes.
 */
export function segmentsOf(lines, { looksLikeId, titleOf = null, closedSessions = new Set(), pageTitles = new Map() }) {
  const segments = [];
  const groups = groupLines(lines);
  const namesBySession = new Map();
  for (const line of lines) namesBySession.set(line.session, [...(namesBySession.get(line.session) || []), line]);
  for (const [session, list] of namesBySession) namesBySession.set(session, namesOf(list, { looksLikeId, pageTitles: pageTitles.get(session) || [] }));
  groups.forEach((group, index) => {
    const session = group[0].session;
    const names = namesBySession.get(session);
    const earlier = segments.filter(segment => segment.session === session);
    // The person is named from the segment where the server first said who they are.
    if (names.personLine && group.some(line => line.id === names.personLine)) names.known = true;
    const facts = factsOf(group, { looksLikeId, names: { ...names, person: names.known ? names.person : null }, earlier });
    const open = !closedSessions.has(session) && !groups.slice(index + 1).some(next => next[0].session === session);
    const first = group[0], last = group.at(-1);
    const entities = [];
    for (const entity of group.flatMap(line => line.entities || [])) {
      const seen = entities.find(other => other.type === entity.type && other.id === entity.id);
      if (!seen) entities.push({ type: entity.type, id: entity.id, ...(entity.created ? { created: true } : {}) });
      else if (entity.created) seen.created = true;
    }
    const values = [];
    for (const entry of group.flatMap(line => line.values || [])) if (entry.class !== 'id' && !values.some(seen => seen.key === entry.key && seen.value === entry.value && seen.length === entry.length)) values.push(entry);
    const sent = group.flatMap(line => (line.kind === 'submit' || line.requests?.some(request => WRITE.has(request.method))) ? (line.values || []).filter(entry => entry.from === 'request_body') : []);
    const ids = new Set(entities.map(entity => `${entity.type}:${entity.id}`));
    const related = earlier.filter(segment => segment.entities.some(entity => entity.created && ids.has(`${entity.type}:${entity.id}`))).map(segment => segment.id);
    const ended = last.at_end ?? last.at ?? null;
    const segment = { schema: 'producttrace.story.v1', id: `seg:${first.id}`, session, verb: facts.verb, title: null, title_source: 'template', page: facts.page,
      lines: group.map(line => line.id), steps: group.map((line, at) => ({ line: line.id, text: stepOf(line, { sent, names, looksLikeId, first: at === 0 }), facts: stepFactsOf(line, { names: { ...names, person: names.known ? names.person : null }, looksLikeId }) })),
      entities, values, started_at: first.at ?? null, ended_at: ended, duration_ms: first.at != null && ended != null ? Math.max(0, ended - first.at) : null,
      confidence: facts.verb ? Math.min(CONFIDENCE[facts.verb] ?? 7, facts.unconfirmed ? 6 : 10) : 4, open, related, facts };
    segment.title = defaultTitle(facts, { open }) ?? fallbackTitle(segment);
    if (typeof titleOf === 'function') {
      try { const custom = titleOf(facts, segment); if (typeof custom === 'string' && custom.trim()) { segment.title = custom.trim(); segment.title_source = 'custom'; } } catch {}
    }
    segments.push(segment);
  });
  return segments;
}

// No verb matched: the first sub-action that sent something, else the first, flagged `verb: null` so a bench can count it.
function fallbackTitle(segment) {
  return (segment.steps.find(entry => / to (?:create|save|send|delete)/u.test(entry.text)) || segment.steps[0]).text;
}

/**
 * The session as a handful of observations, one per goal that says something
 * (a page load or a navigation the next goal starts from is left out), and
 * `text`, the goals joined with ", then" for the whole visit.
 */
export function narrativeOf(segments) {
  const bySession = new Map();
  for (const segment of segments) bySession.set(segment.session, [...(bySession.get(segment.session) || []), segment]);
  return [...bySession.entries()].map(([session, list]) => {
    const kept = list.filter((segment, index) => {
      if (segment.verb === 'opened_app') return list.length === 1;
      // Going somewhere is said by the next goal; on its own it is not a goal worth a sentence.
      return segment.verb !== 'navigated' || list.length === 1;
    });
    // Repeats merge (NAPsack rule 9): a run of plain creates of one type after the first reads as a count.
    const parts = [];
    for (let index = 0; index < kept.length; index += 1) {
      const segment = kept[index];
      const plain = other => other.verb === 'created' && other.title_source === 'template' && !other.facts.opened && !other.facts.entered && other.facts.object?.type === segment.facts.object?.type && !other.facts.qualifiers.length;
      let end = index + 1;
      if (segment.verb === 'created' && segment.title_source === 'template') while (end < kept.length && plain(kept[end])) end += 1;
      parts.push((parts.length ? lower(segment.title) : segment.title).replace(/\.$/u, ''));
      const more = kept.slice(index + 1, end);
      if (more.length > 1) {
        const named = more.map(other => other.facts.object.title).filter(Boolean);
        parts.push(`created ${more.length} more ${segment.facts.object.type}s${named.length ? ` (${named.slice(0, 3).map(quote).join(', ')}${named.length > 3 ? ', …' : ''})` : ''}`);
        index = end - 1;
      }
    }
    const text = parts.join(', then ');
    return { session, text: text ? `${text}.` : '', observations: kept.map(segment => ({ text: segment.title, cites: [segment.id], confidence: segment.confidence })), source: 'template' };
  });
}
