// Server-to-server hops (fix/server-outbound), on synthetic spans in the
// adapter's shape. The end-to-end proof is test/browser/server-outbound.mjs;
// this pins the join and rendering rules without Mongo or a browser.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildEpisodeChain, chainFrontier, describeServerSpan, hopSegments, indexUnlinkedEvidence, HOP_DEPTH_SHOWN } from '../analysis/causal-chain.mjs';
import { attachBackendSpans, buildActionChains, serverHops } from '../analysis/runtime-attribution.mjs';

const TRACE = 'a'.repeat(32);
const REQUEST_SPAN = '1'.repeat(16);
let next = 0;
const id = () => (++next).toString(16).padStart(16, '0');
const at = ms => [Math.floor(ms / 1000), (ms % 1000) * 1e6];
const span = (fields, startMs) => ({ schema: 'producttrace.backend-span.v1', source: 'opentelemetry', trace_id: TRACE, span_id: id(), service_name: 'api',
  status: { code: 0 }, start_time: at(startMs), end_time: at(startMs + 1), attributes: {}, ...fields });
const server = (parent, method, route, status, startMs, service = 'api', endMs = startMs + 50) => span({ end_time: at(endMs), kind: 'server', parent_span_id: parent, service_name: service, name: `${method} ${route}`,
  attributes: { 'http.method': method, 'http.route': route, 'http.status_code': status }, instrumentation: { name: '@opentelemetry/instrumentation-http' } }, startMs);
const handler = (parent, name, startMs) => span({ kind: 'internal', parent_span_id: parent, name: `express handler - ${name}`,
  attributes: { 'producttrace.express.handler.name': name, 'producttrace.express.handler.index': 0 }, instrumentation: { name: 'producttrace-express-handlers' } }, startMs);
const db = (parent, operation, collection, startMs) => span({ kind: 'client', parent_span_id: parent, name: `mongodb.${operation}`,
  attributes: { 'db.system': 'mongodb', 'db.operation': operation, 'db.mongodb.collection': collection }, instrumentation: { name: '@opentelemetry/instrumentation-mongodb' } }, startMs);
const outbound = (parent, method, url, startMs, { status = 200, error = null, scope = 'undici' } = {}) => span({ kind: 'client', parent_span_id: parent, name: method,
  status: error ? { code: 2, message: error } : { code: 0 },
  attributes: scope === 'undici' ? { 'http.request.method': method, 'url.full': url, ...(status == null ? {} : { 'http.response.status_code': status }) }
    : { 'http.method': method, 'http.url': url, ...(status == null ? {} : { 'http.status_code': status }) },
  instrumentation: { name: `@opentelemetry/instrumentation-${scope}` } }, startMs);

function fixture() {
  next = 0;
  const root = server(REQUEST_SPAN, 'POST', '/api/things/:id/archive', 200, 1000);
  const h1 = handler(root.span_id, 'archiveThing', 1001);
  const own = db(h1.span_id, 'update', 'things', 1002);
  // Fan-out: the later-started call is listed first in the array.
  const late = outbound(h1.span_id, 'GET', 'http://127.0.0.1:4000/peer/stats/1', 1006, { scope: 'http' });
  const notify = outbound(h1.span_id, 'POST', 'http://127.0.0.1:3000/internal/notify', 1003);
  const s2 = server(notify.span_id, 'POST', '/internal/notify', 201, 1004);
  const h2 = handler(s2.span_id, 'notify', 1004.5);
  const insert = db(h2.span_id, 'insert', 'notifications', 1005);
  const s3 = server(late.span_id, 'GET', '/peer/stats/:id', 200, 1007, 'peer');
  const h3 = handler(s3.span_id, 'peerStats', 1007.5);
  const back = outbound(h3.span_id, 'GET', 'http://127.0.0.1:3000/internal/ping', 1008);
  const s4 = server(back.span_id, 'GET', '/internal/ping', 200, 1009);
  const h4 = handler(s4.span_id, 'ping', 1009.5);
  const escaped = outbound(h1.span_id, 'POST', 'https://api.example.test/hook', 1010);
  const refused = outbound(h1.span_id, 'POST', 'http://127.0.0.1:9/mirror', 1011, { status: null, error: 'connect ECONNREFUSED 127.0.0.1:9', scope: 'http' });
  const unrelated = { ...server(null, 'GET', '/api/health', 200, 1012), trace_id: 'b'.repeat(32) };
  const spans = [root, h1, own, late, notify, s2, h2, insert, s3, h3, back, s4, h4, escaped, refused, unrelated];
  const action = { kind: 'dom.action', action_id: 'a1', event: 'click', sequence: 1, timestamp: 999, capture_page_id: 'p', target: { tag: 'button', attributes: { 'aria-label': 'Archive' } } };
  const request = { kind: 'network.request', action_id: 'a1', method: 'POST', url: '/api/things/1/archive', sequence: 2, timestamp: 1000, capture_page_id: 'p',
    request_occurrence_id: 'r1', trace_context: { trace_id: TRACE, span_id: REQUEST_SPAN } };
  return { spans, records: [action, request], ids: { root, h1, own, notify, s2, insert, late, s3, back, s4, escaped, refused, unrelated } };
}
const episode = records => ({ episode_id: 'e1', carrier_action_id: 'a1', action_ids: ['a1'], actions: [records[0]], coalescing_rule: 'standalone' });

test('a request owns only its own server work; each outbound span is a hop joined by the traceparent it sent', () => {
  const { spans, records, ids } = fixture();
  const joined = attachBackendSpans(records, spans);
  assert.deepEqual(joined.filter(row => row.kind === 'handler.enter').map(row => row.span_id), [ids.h1.span_id]);
  const dbs = joined.filter(row => row.kind === 'db.operation');
  assert.deepEqual(dbs.map(row => [row.span_id, row.hop ?? null]), [[ids.own.span_id, null], [ids.insert.span_id, '1']]);
  const hops = joined.filter(row => row.kind === 'server.hop');
  assert.deepEqual(hops.map(row => [row.hop, row.join, row.server?.span_id ?? null]), [
    ['1', 'exact_parent', ids.s2.span_id], ['2', 'exact_parent', ids.s3.span_id], ['2.1', 'exact_parent', ids.s4.span_id],
    ['3', 'no_incoming_span', null], ['4', 'no_incoming_span', null]]);
  assert.equal(hops[0].issued_by.name, 'archiveThing');
  assert.equal(hops[2].issued_by.name, 'peerStats');
});

test('the one hop builder words hops, escaped hops and the depth cap', () => {
  const { spans, records, ids } = fixture();
  const chain = buildEpisodeChain(episode(records), records, spans, { idle: true });
  assert.equal(chain.hops.length, 5);
  assert.equal(chain.hops[0].summary, 'outbound POST /internal/notify (from handler archiveThing) → server /internal/notify 201 → handler notify → db insert notifications (handler: notify)');
  assert.equal(chain.hops[1].summary, 'outbound GET /peer/stats/1 (from handler archiveThing) → server peer /peer/stats/:id 200 → handler peerStats');
  assert.equal(chain.hops[2].summary, 'outbound GET /internal/ping (from handler peerStats) → server api /internal/ping 200 → handler ping');
  assert.deepEqual(chain.escaped_hops.map(hop => hop.summary), [
    'outbound POST https://api.example.test/hook 200 (from handler archiveThing) → no incoming span for this traceparent (not instrumented, or not reached); also possible: the app replaced the traceparent after the request was created, or a second OpenTelemetry SDK sent another one',
    'outbound POST http://127.0.0.1:9/mirror (from handler archiveThing) → no response (connect ECONNREFUSED 127.0.0.1:9); no incoming span for this traceparent (not instrumented, or not reached)']);
  // The headline effect is the request's own write; the hop's write is named with its hop when it is the only one.
  // The request's own write is still the stated effect; the escaped hops make the headline stop `server_hop`.
  assert.equal(chain.outcome.label, 'Completed 200: update things; a further server-side hop may have escaped');
  const frontier = chainFrontier(chain);
  assert.equal(frontier.stopped_at, 'server_hop');
  assert.equal(frontier.stop_reason, 'server_hop_unfollowed');
  // fix/honest-coverage: the unrelated /api/health root span starts in this action's window after the request reached
  // the server, so it is a possible continuation (order only, never joined): stated once, after the hops.
  assert.equal(frontier.because, 'reached db (database write update things (handler: archiveThing) joined by exact span parentage); a further server-side hop may have escaped: 2 hop(s) not followed: 2 with no receiving span (POST https://api.example.test/hook, POST http://127.0.0.1:9/mirror); also 1 server-side request in this window has no browser parent (listed as unlinked)');
  assert.deepEqual(frontier.additional_stops.map(stop => [stop.hop, stop.stopped_at, stop.stop_reason]), [['3', 'network', 'outbound_no_incoming_span'], ['4', 'network', 'outbound_no_incoming_span']]);
  // Without the escaped hops: terminal effect observed, unless a root span in the window could continue the request.
  const followedOnly = spans => spans.filter(value => value !== ids.escaped && value !== ids.refused);
  assert.equal(chainFrontier(buildEpisodeChain(episode(records), records, followedOnly(spans), { idle: true })).stopped_at, 'server_hop');
  assert.equal(chainFrontier(buildEpisodeChain(episode(records), records, followedOnly(spans).filter(value => value !== ids.unrelated), { idle: true })).stopped_at, null);
  // Depth cap: a chain of hops deeper than HOP_DEPTH_SHOWN renders "+N more hops".
  const deep = Array.from({ length: HOP_DEPTH_SHOWN + 2 }, (_, index) => ({ hop: Array.from({ length: index + 1 }, () => '1').join('.'), depth: index + 1, join: 'exact_parent',
    method: 'POST', url: `http://h/api/chain/${index}`, server: { route: '/api/chain/:n', status_code: 200, handler_spans: [], db_ops: [] } }));
  const rendered = hopSegments(deep);
  assert.equal(rendered.hops.length, HOP_DEPTH_SHOWN + 2);
  assert.match(rendered.text, /; \+2 more hops \(2 deeper than 3\) \(see hops\); bodies: not recorded for server-to-server hops$/u);
  assert.ok(rendered.hops.every(hop => hop.bodies === 'not recorded for server-to-server hops'));
  assert.equal(rendered.text.split('bodies: not recorded for server-to-server hops').length - 1, 1);
});

test('a hop\'s own write is the effect when the request wrote nothing itself; exported chains carry the hops', () => {
  const { spans, records, ids } = fixture();
  const withoutOwn = spans.filter(value => value !== ids.own);
  const chain = buildEpisodeChain(episode(records), records, withoutOwn, { idle: true });
  assert.equal(chain.outcome.label, 'Completed 200: insert notifications (hop 1: POST /internal/notify); a further server-side hop may have escaped');
  const exported = buildActionChains(records, withoutOwn, { backendInstrumented: true });
  const record = exported.find(value => value.action_id === 'a1');
  assert.deepEqual(record.requests[0].hops.map(hop => hop.hop), ['1', '2', '2.1', '3', '4']);
  assert.equal(record.requests[0].escaped_hops.length, 2);
  assert.deepEqual(record.additional_stops.map(stop => [stop.hop, stop.stopped_at]), [['3', 'network'], ['4', 'network']]);
  assert.equal(record.stopped_at, 'server_hop');
  assert.equal(record.outcome.label, chain.outcome.label);
});

test('receiving server spans are never unlinked roots; an unlinked root carries its own hops', () => {
  const { spans, records, ids } = fixture();
  const unlinked = indexUnlinkedEvidence([records[0], { ...records[0], action_id: 'a2', sequence: 9, timestamp: 2000 }], spans).forEpisode(episode(records));
  const listed = unlinked.server_spans.map(value => value.span_id);
  for (const receiver of [ids.s2, ids.s3, ids.s4]) assert.ok(!listed.includes(receiver.span_id));
  assert.ok(listed.includes(ids.root.span_id), 'the root has no browser request row here, so it is listed');
  const described = unlinked.server_spans.find(value => value.span_id === ids.root.span_id);
  assert.equal(described.hops.length, 5);
  assert.deepEqual(describeServerSpan(ids.s3, spans).hops.map(hop => hop.hop), ['1']);
  assert.deepEqual(serverHops(ids.unrelated, spans), []);
});

test('app-set traceparent: followed by the app\'s identifiers when a server continues it, else stated; after-response hops and handler-less receivers', () => {
  const { spans, records, ids } = fixture();
  const appTrace = 'c'.repeat(32); const appSpan = 'd'.repeat(16);
  const mark = (value, traceparent) => ({ ...value, attributes: { ...value.attributes, 'producttrace.outbound.traceparent_set_by_app': true,
    ...(traceparent ? { 'producttrace.outbound.app_traceparent': traceparent } : {}) } });
  const followed = mark(ids.escaped, `00-${appTrace}-${appSpan}-01`);
  const unlinkedApp = mark(ids.refused, null);
  // The receiver continues the app's trace; it has no handler span (a plain node:http server) but owns a DB span.
  const receiver = { ...server(appSpan, 'POST', '/hook', 200, 1010.5, 'third'), trace_id: appTrace };
  const receiverDb = { ...db(receiver.span_id, 'insert', 'hooks', 1010.7), trace_id: appTrace };
  // A hop sent after the owning server span ended (root ends at 1050).
  const late = outbound(ids.h1.span_id, 'GET', 'http://127.0.0.1:3000/internal/late', 1200);
  const lateServer = server(late.span_id, 'GET', '/internal/late', 200, 1201);
  const all = [...spans.filter(value => value !== ids.escaped && value !== ids.refused), followed, unlinkedApp, receiver, receiverDb, late, lateServer];
  const chain = buildEpisodeChain(episode(records), records, all, { idle: true });
  const byHop = Object.fromEntries(chain.hops.map(hop => [hop.hop, hop]));
  assert.equal(byHop['3'].join, 'app_traceparent');
  assert.equal(byHop['3'].summary, 'outbound POST /hook (from handler archiveThing; followed by the traceparent the app set) → server third /hook 200 → db insert hooks (issuer: unknown)');
  assert.equal(byHop['4'].join, 'app_traceparent_unlinked');
  assert.equal(byHop['4'].summary, 'outbound POST http://127.0.0.1:9/mirror (from handler archiveThing) → no response (connect ECONNREFUSED 127.0.0.1:9); traceparent set by the app; receiving span not linked by Tracer');
  assert.equal(byHop['5'].after_response_ms, 150);
  assert.match(byHop['5'].summary, /sent 150 ms after the response/u);
  assert.deepEqual(chain.escaped_hops.map(hop => hop.hop), ['4']);
  // The app-traceparent receiver is not an unlinked root.
  const unlinked = indexUnlinkedEvidence([records[0]], all).forEpisode(episode(records));
  assert.ok(!unlinked.server_spans.some(value => value.span_id === receiver.span_id));
});

test('the escape clause counts hops per join kind (an abstained hop is not "no receiving span")', () => {
  const { spans, records, ids } = fixture();
  // A second server span claims the notify call: hop 1 abstains.
  const twin = server(ids.notify.span_id, 'POST', '/internal/notify', 201, 1004.2);
  const chain = buildEpisodeChain(episode(records), records, [...spans, twin], { idle: true });
  assert.equal(chain.hops[0].join, 'multiple_exact_parent_servers');
  assert.match(chainFrontier(chain).because, /a further server-side hop may have escaped: 3 hop\(s\) not followed: 2 with no receiving span, 1 with more than one \(POST http:\/\/127\.0\.0\.1:3000\/internal\/notify, /u);
});

test('preconditions and an escaped hop coexist: a GET whose only own reads are middleware preconditions keeps that stop and states the lost hop', () => {
  next = 0;
  const root = server(REQUEST_SPAN, 'GET', '/api/things', 200, 1000);
  const auth = span({ kind: 'internal', parent_span_id: root.span_id, name: 'middleware - auth', attributes: { 'express.type': 'middleware', 'express.name': 'auth' },
    instrumentation: { name: '@opentelemetry/instrumentation-express' } }, 1001);
  const read = db(auth.span_id, 'find', 'users', 1002);
  const h = handler(root.span_id, 'listThings', 1003);
  const lost = outbound(h.span_id, 'GET', 'https://api.example.test/things', 1004);
  const records = [{ kind: 'dom.action', action_id: 'a1', event: 'click', sequence: 1, timestamp: 999, capture_page_id: 'p', target: { tag: 'button', attributes: {} } },
    { kind: 'network.request', action_id: 'a1', method: 'GET', url: '/api/things', sequence: 2, timestamp: 1000, capture_page_id: 'p', request_occurrence_id: 'r1',
      trace_context: { trace_id: TRACE, span_id: REQUEST_SPAN } }];
  const chain = buildEpisodeChain(episode(records), records, [root, auth, read, h, lost], { idle: true });
  const frontier = chainFrontier(chain);
  assert.equal(frontier.stopped_at, 'handler');
  assert.match(frontier.because, /^no database work after the preconditions \(find users by middleware auth\)/u);
  assert.deepEqual(frontier.additional_stops.map(stop => [stop.hop, stop.stopped_at, stop.stop_reason]), [['1', 'network', 'outbound_no_incoming_span']]);
});

test('a hop\'s database operations are judged by its own receiving server\'s precondition rule', () => {
  const build = ({ realWork }) => {
    next = 0;
    const root = server(REQUEST_SPAN, 'GET', '/api/things', 200, 1000);
    const h = handler(root.span_id, 'listThings', 1001);
    const call = outbound(h.span_id, 'GET', 'http://127.0.0.1:4000/peer/things', 1002, { scope: 'http' });
    const peer = server(call.span_id, 'GET', '/peer/things', 200, 1003, 'peer');
    const auth = span({ kind: 'internal', parent_span_id: peer.span_id, name: 'middleware - auth', attributes: { 'express.type': 'middleware', 'express.name': 'auth' },
      instrumentation: { name: '@opentelemetry/instrumentation-express' } }, 1004);
    const authRead = db(auth.span_id, 'find', 'sessions', 1005);
    const peerHandler = handler(peer.span_id, 'peerThings', 1006);
    const work = db(peerHandler.span_id, 'find', 'things', 1007);
    const records = [{ kind: 'dom.action', action_id: 'a1', event: 'click', sequence: 1, timestamp: 999, capture_page_id: 'p', target: { tag: 'button', attributes: {} } },
      { kind: 'network.request', action_id: 'a1', method: 'GET', url: '/api/things', sequence: 2, timestamp: 1000, capture_page_id: 'p', request_occurrence_id: 'r1',
        trace_context: { trace_id: TRACE, span_id: REQUEST_SPAN } }];
    return buildEpisodeChain(episode(records), records, [root, h, call, peer, auth, authRead, peerHandler, ...(realWork ? [work] : [])], { idle: true });
  };
  // Only the hop receiver's auth-middleware read: a precondition, so the request did no work after its preconditions.
  const pre = build({ realWork: false });
  assert.equal(pre.outcome.status, 'responded');
  assert.equal(pre.outcome.label, 'Responded 200: no database work after the preconditions (find sessions by middleware auth in hop 1)');
  assert.equal(chainFrontier(pre).stopped_at, 'handler');
  // The hop did real work after its preconditions: that work is the effect.
  const done = build({ realWork: true });
  assert.equal(done.outcome.status, 'completed');
  assert.match(done.outcome.label, /^Completed 200: find things \(hop 1: GET \/peer\/things\)/u);
});
