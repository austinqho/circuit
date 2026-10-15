// Grader audit: drive the MCP as a black box over stdio and justify every
// body/deferral/status/issuer clause of every rendered request line from the raw rows.
// Independent recomputation: nothing from analysis/, collector/ or mcp/ is imported.
//   node audit.mjs --store DIR [--manifest M] [--source-root S] [--server path/to/mcp/server.mjs] [--out file.json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const argv = process.argv.slice(2);
const opt = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
const storeDir = opt('--store');
const server = opt('--server') || path.join(repoRoot, 'mcp/server.mjs');
import zlib from 'node:zlib';
const readRows = file => (fs.existsSync(file) ? (file.endsWith('.gz') ? zlib.gunzipSync(fs.readFileSync(file)).toString('utf8') : fs.readFileSync(file, 'utf8')).split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : []);
const records = readRows(opt('--records') || path.join(storeDir, 'records.jsonl'));
const spans = readRows(opt('--spans') || path.join(storeDir, 'spans.jsonl'));

const isIdKey = key => /^(?:_id|id)$|Id$|_id$/u.test(key);
const STATUS = new Set(['error', 'errors', 'status', 'state', 'code', 'revision', 'rev', 'version', 'reason', 'result', 'ok', 'success', 'message', 'outcome', 'phase', 'stage', 'detail']);
const seg = key => String(key).replace(/([a-z0-9])([A-Z])/gu, '$1 $2').split(/[^A-Za-z0-9]+/u).map(p => p.toLowerCase()).filter(Boolean);
const isStatus = key => STATUS.has(seg(key).at(-1));
const shortScalar = v => typeof v === 'number' || typeof v === 'boolean' || (typeof v === 'string' && v.length <= 64);
const shortValue = v => shortScalar(v) || (Array.isArray(v) && v.length <= 6 && v.every(shortScalar));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const fmtV = v => (Array.isArray(v) ? `[${v.map(fmtV).join(', ')}]` : typeof v === 'string' ? (v === '' || /[,;[\]]/u.test(v) ? JSON.stringify(v) : v) : JSON.stringify(v));
const cap = text => text.length > 32 ? `${text.slice(0, 31)}…` : text;
const shownValue = v => cap(fmtV(v));
const shownFields = (f, more = 0, shapes = null, clipped = null) => [...Object.entries(f || {}).map(([k, v]) => {
  const how = clipped?.[k];
  const value = how === 'tail' ? `…${String(v).slice(-31)}` : how === 'inside'
    ? `${shownValue(v)} (differs from another request's value past the characters shown)` : shownValue(v);
  return `${k}: ${value}`;
}), ...Object.entries(shapes || {}).map(([k, v]) => `${k}: ${v}`), ...(more ? [`+${more} more field${more === 1 ? '' : 's'}`] : [])].join(', ');
const nestedText = (items, more = 0) => [...(items || []).map(item => `${item.path}: ${shownValue(item.value)} (vs ${item.peer_values.map(shownValue).join(' / ')})`), ...(more ? [`+${more} more`] : [])].join(', ');
const shapeOf = v => Array.isArray(v) ? `[${v.length} items]` : v && typeof v === 'object' ? `{${Object.keys(v).length} keys}` : typeof v === 'string' ? `<${v.length} chars>` : String(v);
const rawIds = value => {
  const ids = {}; let count = 0;
  const walk = (node, prefix, depth) => {
    if (!node || typeof node !== 'object' || Array.isArray(node) || depth > 4) return;
    for (const key of Object.keys(node)) {
      if (count >= 20) return;
      const child = node[key]; const name = prefix ? `${prefix}.${key}` : key;
      if (isIdKey(key) && (child === null || typeof child !== 'object')) { ids[name] = typeof child === 'string' && child.length > 200 ? `${child.slice(0, 200)}…` : child; count += 1; }
      else walk(child, name, depth + 1);
    }
  };
  walk(value, '', 1); return ids;
};
const idsText = ids => Object.entries(ids).map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`).join(', ');
const bodyRows = records.filter(r => r.kind === 'network.body');
const bodyOf = (req, dir) => bodyRows.find(r => r.request_occurrence_id === req.request_occurrence_id && (r.capture_page_id ?? r.session) === (req.capture_page_id ?? req.session) && r.direction === dir) || null;
function prefixObject(text) { // grader's own lenient prefix parse: longest prefix that closes as an object at a top-level comma
  let depth = 0, inStr = false, esc = false, best = null;
  for (let i = 0; i < text.length; i += 1) { const ch = text[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true; else if (ch === '{' || ch === '[') depth += 1; else if (ch === '}' || ch === ']') depth -= 1;
    else if (ch === ',' && depth === 1) { try { best = JSON.parse(`${text.slice(0, i)}}`); } catch {} } }
  return best; }
const objOf = row => { if (!row || row.captured === false) return null; const v = row.json !== undefined ? row.json : row.format === 'json' && typeof row.text === 'string' ? prefixObject(row.text) : null; return v && typeof v === 'object' && !Array.isArray(v) ? v : null; };
const shortFields = row => { const o = objOf(row); return o ? Object.keys(o).filter(k => !isIdKey(k) && shortValue(o[k])).map(k => [k, o[k]]) : null; };
const differs = (k, v, peers) => peers.some(p => !p.some(([ok, ov]) => ok === k && same(ov, v)));
function expectFacts(req, peers) {
  const rq = shortFields(bodyOf(req, 'request')); const rs = shortFields(bodyOf(req, 'response'));
  const rqP = peers.map(p => shortFields(bodyOf(p, 'request'))).filter(Boolean); const rsP = peers.map(p => shortFields(bodyOf(p, 'response'))).filter(Boolean);
  const pick = e => (e.length ? Object.fromEntries(e.slice(0, 4)) : null);
  const request = rq ? [...rq.filter(([k, v]) => differs(k, v, rqP)), ...rq.filter(([k, v]) => !differs(k, v, rqP))] : [];
  const response = rs ? [...rs.filter(([k]) => isStatus(k)), ...rs.filter(([k, v]) => !isStatus(k) && differs(k, v, rsP))] : [];
  const responseObj = objOf(bodyOf(req, 'response'));
  const shapes = responseObj ? Object.fromEntries(Object.entries(responseObj).filter(([k, v]) => !isIdKey(k) && isStatus(k) && !shortValue(v) && v !== null).map(([k, v]) => [k, shapeOf(v)])) : {};
  const responseRow = bodyOf(req, 'response');
  const opaque = responseRow && (responseRow.reason === 'opaque_response' || responseRow.status === 0);
  return {
    request_fields: rq ? pick(request) : null, request_fields_more: Math.max(0, request.length - 4),
    response_fields: rs ? pick(response) : null, response_fields_more: Math.max(0, response.length - 4),
    response_shapes: Object.keys(shapes).length ? shapes : null,
    browser_status: opaque ? null : responseRow?.status ?? null,
    browser_status_hidden: opaque ? 'opaque_response' : null,
  };
}
const enters = new Map(); for (const r of records) if (r.kind === 'function.enter' && typeof r.continuation_id === 'string' && !enters.has(r.continuation_id)) enters.set(r.continuation_id, r);
const walk = req => { let id = req.parent_continuation_id; const seen = new Set(); while (typeof id === 'string' && !seen.has(id)) { seen.add(id); const kind = /:([a-z_]+):\d+$/u.exec(id)?.[1]; if (!kind || kind === 'action') return null; if (kind !== 'function') return { kind, id }; const e = enters.get(id); if (!e) return null; id = e.parent_continuation_id; } return null; };
const actions = records.filter(r => r.kind === 'dom.action');
const dispatchOf = id => actions.find(a => a.action_id === id) || null;
const serverSpanOf = req => spans.find(s => s.kind === 'server' && s.trace_id === req.trace_context?.trace_id && s.parent_span_id === req.trace_context?.span_id) || null;
const spanStatus = s => { const v = s?.attributes?.['http.response.status_code'] ?? s?.attributes?.['http.status_code']; return v == null ? null : Number(v); };
const dedupe = ids => ids.filter((id, i) => id !== ids[i - 1]);
const requests = records.filter(r => r.kind === 'network.request' && r.internal !== true && r.transport_internal !== true);
const reqByOcc = new Map(requests.map(r => [`${r.capture_page_id ?? r.session}|${r.request_occurrence_id}`, r]));

const args = [...(opt('--records') ? ['--records', opt('--records'), '--spans', opt('--spans')] : ['--store', storeDir]), ...(opt('--manifest') ? ['--manifest', opt('--manifest')] : []), ...(opt('--source-root') ? ['--source-root', opt('--source-root')] : [])];
const client = new Client({ name: 'grader-audit', version: '1' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [server, ...args], stderr: 'ignore' }));
const call = async (name, a) => { const r = await client.callTool({ name, arguments: a }); return { ...r.structuredContent, text: r.content[0].text }; };

const findings = []; let clauses = 0; let lines = 0;
const flag = (where, msg, detail) => findings.push({ where, msg, detail });
const VIA = { timer: 'a timer', promise: 'a promise continuation', effect: 'an effect', animation_frame: 'an animation frame', callback: 'a callback' };
const ISSUE_VIA = { timer: 'timer', animation_frame: 'animation_frame', promise: 'promise', await: 'promise', microtask: 'promise', state_effect: 'effect', mount_effect: 'effect', callback: 'callback', stream: 'callback' };
function auditEntry(where, entry, req, peers, summary, { attributed }) {
  lines += 1;
  if (!req) { flag(where, 'no raw request row for entry', entry.request_occurrence_id); return; }
  const exp = expectFacts(req, peers);
  for (const key of ['request_fields', 'response_fields', 'browser_status', 'browser_status_hidden', 'response_shapes'])
    if (!same(entry[key] ?? null, exp[key])) flag(where, `${key} differs from recomputation`, { mcp: entry[key], raw: exp[key], summary });
  for (const key of ['request_fields_more', 'response_fields_more'])
    if ((entry[key] || 0) !== exp[key]) flag(where, `${key} differs from recomputation`, { mcp: entry[key], raw: exp[key] });
  // each field value must exist in the raw body at top level
  for (const [dir, key] of [['request', 'request_fields'], ['response', 'response_fields']]) for (const [k, v] of Object.entries(entry[key] || {})) { clauses += 1; const o = objOf(bodyOf(req, dir)); if (!o || !same(o[k], v)) flag(where, `${key}.${k} not in raw ${dir} body`, { v, raw: o?.[k] }); }
  for (const [dir, key, label] of [['request', 'body', 'request'], ['response', 'response_body', 'response']]) {
    const raw = objOf(bodyOf(req, dir));
    const ids = raw ? rawIds(raw) : {};
    if (entry[key] && !same(entry[key].ids || {}, ids)) flag(where, `${label} ids differ from raw body`, { got: entry[key].ids, raw: ids });
    if (Object.keys(ids).length) {
      clauses += 1;
      const expected = `${label} ids ${idsText(ids)}`;
      if (!summary.includes(expected)) flag(where, `${label} ids missing/different in text`, { expected, summary });
    }
  }
  const bodyText = (side, fields, more, shapes, clipped, nested, nestedMore, differsUnshown) => {
    if (fields || more || shapes) {
      clauses += 1;
      const expected = `${side} ${shownFields(fields, more, shapes, clipped)}`;
      if (!summary.includes(expected)) flag(where, `${side} clause missing/different in text`, { expected, summary });
    }
    if (nested) {
      clauses += nested.length;
      const expected = `${side} ${nestedText(nested, nestedMore)}`;
      if (!summary.includes(expected)) flag(where, `${side} nested clause missing/different in text`, { expected, summary });
      const object = objOf(bodyOf(req, side === 'sent' ? 'request' : 'response'));
      const peerObjects = peers.map(p => objOf(bodyOf(p, side === 'sent' ? 'request' : 'response'))).filter(Boolean);
      for (const item of nested) {
        const at = value => item.path.split('.').reduce((v, part) => v?.[part], value);
        if (!same(at(object), item.value)) flag(where, `${side} nested value not in raw body`, item);
        for (const value of item.peer_values) if (!peerObjects.some(p => same(at(p), value))) flag(where, `${side} nested peer value not in raw peer`, item);
      }
    }
    if (differsUnshown) {
      clauses += 1;
      const expected = side === 'sent' ? 'request body differs from another request to this URL only in fields not shown' : 'response body differs from another response to this URL only in fields not shown';
      if (!summary.includes(expected)) flag(where, `${side} unshown difference missing in text`, { expected, summary });
      const object = objOf(bodyOf(req, side === 'sent' ? 'request' : 'response'));
      if (!peers.some(p => { const peer = objOf(bodyOf(p, side === 'sent' ? 'request' : 'response')); return peer && !same(peer, object); })) flag(where, `${side} unshown difference has no raw peer`, summary);
    }
  };
  bodyText('sent', entry.request_fields, entry.request_fields_more, null, entry.request_fields_clipped, entry.request_nested, entry.request_nested_more, entry.request_differs_unshown);
  bodyText('answered', entry.response_fields, entry.response_fields_more, entry.response_shapes, entry.response_fields_clipped, entry.response_nested, entry.response_nested_more, entry.response_differs_unshown);
  // status mismatch
  const srv = spanStatus(serverSpanOf(req)); const br = exp.browser_status;
  const aborted = entry.outcome === 'aborted_by_client';
  const wantMismatch = br != null && srv != null && br !== srv && !aborted;
  if (wantMismatch !== Boolean(entry.status_mismatch)) flag(where, 'status_mismatch presence differs from rows', { br, srv, got: entry.status_mismatch, aborted });
  if (entry.status_mismatch) { clauses += 1; if (!summary.includes(entry.status_mismatch.reason)) flag(where, 'mismatch reason not in text', summary); if (entry.status_mismatch.browser !== br || entry.status_mismatch.server !== srv) flag(where, 'mismatch numbers wrong', { entry: entry.status_mismatch, br, srv }); }
  if (entry.browser_status_hidden) { clauses += 1; const expected = `the browser hid the status (opaque response)${srv != null ? `; server answered ${srv}` : ''}`; if (!summary.includes(expected)) flag(where, 'opaque-status text missing', { expected, summary }); }
  // deferral
  const w = attributed ? walk(req) : null;
  const d = entry.deferred;
  if (w) {
    const disp = dispatchOf(req.action_id); const ms = disp ? req.timestamp - disp.timestamp : null;
    if (!d || d.via !== (ISSUE_VIA[w.kind] || w.kind) || d.continuation_id !== w.id || d.ms_after_dispatch !== ms) flag(where, 'deferred differs from continuation walk', { d, w, ms });
    else {
      clauses += 1;
      const when = ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;
      const list = d.continuations || [];
      const words = via => VIA[via] || `a ${via} continuation`;
      const clock = value => value >= 1000 ? `${(value / 1000).toFixed(1)} s` : `${Math.round(value)} ms`;
      const earlier = list.slice(0, -1).map(c => `${words(c.via)}${c.ms_after_dispatch != null ? ` at ${clock(c.ms_after_dispatch)}` : ''}`);
      const tail = [earlier.length ? `earlier: ${earlier.join(', then ')}` : null,
        d.reached_dispatch === false ? `${earlier.length ? 'before that' : 'earlier ones'} not identified` : null].filter(Boolean);
      const head = `sent ${when} after the ${disp.event || 'action'}`;
      const t = list.length <= 1 && d.reached_dispatch !== false ? `${head} via ${words(d.via)}`
        : `${head} (nearest continuation: ${words(d.via)}${tail.length ? `; ${tail.join('; ')}` : ''})`;
      if (!summary.includes(t)) flag(where, 'deferral text missing', { t, summary });
      if (d.basis !== 'nearest_continuation' || !list.length || !same(list.at(-1), { kind: d.continuation_kind, via: d.via, continuation_id: d.continuation_id, ms_after_dispatch: list.at(-1).ms_after_dispatch })) flag(where, 'nearest continuation metadata inconsistent', d);
      for (const c of list) {
        if (!c.continuation_id.includes(`:${req.action_id}:`)) flag(where, 'listed continuation names another action', c);
        const rawFirst = enters.get(c.continuation_id);
        if (rawFirst && c.ms_after_dispatch !== rawFirst.timestamp - disp.timestamp) flag(where, 'listed continuation time differs from first frame', { c, raw: rawFirst.timestamp - disp.timestamp });
      }
      // continuation must belong to the same action (id carries the action id)
      if (!w.id.includes(`:${req.action_id}:`)) flag(where, 'continuation id names another action', { id: w.id, action: req.action_id });
      if (ms !== null && ms < 0) flag(where, 'negative ms_after_dispatch', ms);
    }
  } else if (d?.via) flag(where, 'deferred.via claimed but walk finds none', { d });
  if (!w && / after the \w+ via /u.test(summary)) flag(where, 'deferral text without walk', summary);
  // issuer frames for unattributed
  if (!attributed && entry.attribution?.issuer_frames) {
    const expFrames = dedupe((req.issuer?.function_ids || []).filter(x => typeof x === 'string')).reverse();
    if (!same(entry.attribution.issuer_frames.map(f => f.function_id), expFrames)) flag(where, 'issuer_frames differ', { got: entry.attribution.issuer_frames.map(f => f.function_id), expFrames });
  }
}

// ---- page_requests (all pages)
const sessions = [...new Set(requests.map(r => r.capture_page_id ?? r.session))];
const pr = {};
for (const session of sessions) {
  const all = await call('page_requests', { session, n: 500 });
  pr[session] = all;
  const listed = all.requests || [];
  // peers of unattributed = other rows of the listing (same endpoint)
  const path_ = url => { try { return new URL(url, 'http://x').pathname; } catch { return url; } };
  const ep = r => `${String(r.method || 'GET').toUpperCase()} ${path_(r.url)}`;
  const rows = listed.map(e => reqByOcc.get(`${e.session}|${e.request_occurrence_id}`));
  for (const [i, e] of listed.entries()) {
    const req = rows[i];
    const peers = rows.filter((r, j) => j !== i && r && req && ep(r) === ep(req));
    auditEntry(`page_requests ${session} seq ${e.sequence}`, e, req, peers, e.summary, { attributed: e.attribution?.kind === 'action' });
  }
}
// ---- action_chain per action
const chainOut = {};
for (const a of actions) {
  const c = await call('action_chain', { action_id: a.action_id });
  chainOut[a.action_id] = c;
  const segs = c.segments || [];
  const scopeReqs = segs.map(s => reqByOcc.get(`${a.capture_page_id ?? a.session}|${s.request_occurrence_id}`));
  const path_ = url => { try { return new URL(url, 'http://x').pathname; } catch { return url; } };
  const ep = r => `${String(r.method || 'GET').toUpperCase()} ${path_(r.url)}`;
  for (const [i, s] of segs.entries()) {
    const req = scopeReqs[i];
    const peers = scopeReqs.filter((r, j) => j !== i && r && req && ep(r) === ep(req));
    auditEntry(`action_chain ${a.action_id} seg ${s.index}`, s, req, peers, s.summary, { attributed: true });
    if (i < 5 && !c.text.includes(s.summary)) flag(`action_chain ${a.action_id}`, 'segment summary not in text', s.summary);
  }
  const unl = c.unlinked?.requests || [];
  const urows = unl.map(u => reqByOcc.get(`${a.capture_page_id ?? a.session}|${u.request_occurrence_id}`));
  for (const [i, u] of unl.entries()) {
    const req = urows[i];
    const peers = urows.filter((r, j) => j !== i && r && req && ep(r) === ep(req));
    const line = c.text.split('\n').find(l => l.includes(`sequence ${u.sequence}, no action_id`)) || '';
    auditEntry(`unlinked ${a.action_id} seq ${u.sequence}`, u, req, peers, line, { attributed: false });
  }
}
// Attribution and status do not change between surfaces. Body fields may:
// page_requests compares against the listing; a chain compares its episode.
for (const session of sessions) for (const e of pr[session].requests || []) {
  if (e.attribution?.kind !== 'action') continue;
  const c = chainOut[e.attribution.action_id];
  const s = c?.segments?.find(x => x.request_occurrence_id === e.request_occurrence_id);
  if (s && !['browser_status', 'deferred', 'status_mismatch'].every(k => same(e[k] ?? null, s[k] ?? null))) flag(`page_requests seq ${e.sequence}`, 'attributed status or deferral differs from its segment', { e: e.request_fields, s: s.request_fields });
}
const lengths = [];
for (const c of Object.values(chainOut)) for (const s of c.segments || []) lengths.push(s.summary.length);
for (const s of Object.values(pr)) for (const e of s.requests || []) lengths.push(e.summary.length);
lengths.sort((x, y) => x - y);
const out = { store: storeDir, lines, clauses, findings, max_line: lengths.at(-1), p95_line: lengths[Math.floor(lengths.length * 0.95)] };
if (opt('--out')) fs.writeFileSync(opt('--out'), JSON.stringify({ ...out, pr, chainOut }, null, 1));
console.log(JSON.stringify({ ...out, findings: findings.slice(0, 40), findings_total: findings.length }, null, 1));
await client.close();
if (findings.length) process.exitCode = 1;
