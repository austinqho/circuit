// fix/middleware-reads: every database operation in a request's server trace
// is attributed to that request and named by the server code that issued it;
// never dropped. Synthetic span records (the shape backend/register.js ships).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { attachBackendSpans } from '../analysis/runtime-attribution.mjs';
import { actionOutcome, chainFrontier } from '../analysis/causal-chain.mjs';

const TRACE = 'a'.repeat(32);
const span = (span_id, parent_span_id, fields = {}) => ({ schema: 'producttrace.backend-span.v1', trace_id: TRACE, span_id, parent_span_id,
  kind: 'internal', name: span_id, attributes: {}, start_time: [1000, 0], end_time: [1000, 5_000_000], instrumentation: null, ...fields });
const server = (id = 'srv', parent = 'browser', method = 'GET') => span(id, parent, { kind: 'server', attributes: { 'http.method': method, 'http.route': '/api/x', 'http.status_code': 200 } });
const middleware = (id, parent, name) => span(id, parent, { instrumentation: { name: '@opentelemetry/instrumentation-express' }, attributes: { 'express.type': 'middleware', 'express.name': name } });
const handler = (id, parent, name) => span(id, parent, { instrumentation: { name: 'producttrace-express-handlers' }, attributes: { 'producttrace.express.handler.name': name, 'producttrace.express.handler.kind': 'route' } });
const db = (id, parent, operation = 'find', collection = 'items') => span(id, parent, { kind: 'client', instrumentation: { name: '@opentelemetry/instrumentation-mongodb' },
  attributes: { 'db.system': 'mongodb', 'db.operation': operation, 'db.mongodb.collection': collection } });
const skeleton = (id, parent, name) => span(id, parent, { name, attributes: { 'producttrace.span.skeleton': true }, instrumentation: { name: 'app' } });
const request = (method = 'GET') => ({ kind: 'network.request', action_id: 'a1', request_occurrence_id: 'r1', sequence: 1, timestamp: 1, method, url: '/api/x', trace_context: { trace_id: TRACE, span_id: 'browser' } });
const ops = (spans, method = 'GET') => attachBackendSpans([request(method)], spans).filter(row => row.kind === 'db.operation');

test('a database call inside an app span (shipped as a skeleton) reaches its real issuer', () => {
  const [op] = ops([server(), handler('h', 'srv', 'loadThings'), skeleton('app', 'h', 'loadStats'), db('d', 'app')]);
  assert.equal(op.issued_by, 'handler: loadThings (in app span loadStats)');
  assert.deepEqual(op.issuer.via_app_spans, ['loadStats']);
});

test('an app span with no naming code above it is the issuer', () => {
  const [op] = ops([server(), skeleton('app', 'srv', 'cronish'), db('d', 'app')]);
  assert.equal(op.issued_by, 'app span: cronish');
});

test('a database span whose parent was never recorded is listed, never dropped (the trace has one server span)', () => {
  const rows = ops([server(), handler('h', 'srv', 'loadThings'), db('d1', 'h'), db('d2', 'missing-parent', 'aggregate')]);
  assert.deepEqual(rows.map(row => row.span_id), ['d1', 'd2']);
  assert.equal(rows[1].issued_by, 'issuer: unknown (parent missing-parent not recorded)');
  assert.equal(rows[1].ancestry_broken_at, 'missing-parent');
});

test('with two server spans in the trace a broken-ancestry span cannot be placed: abstain', () => {
  const rows = ops([server(), server('srv2', 'elsewhere'), db('d2', 'missing-parent')]);
  assert.deepEqual(rows, []);
});

test('ruling 2026-09-24: app-level middleware reads are preconditions; a safe request with only those is responded, named', () => {
  const joined = attachBackendSpans([request()], [server(), middleware('m', 'srv', 'requireAuth'), db('d', 'm', 'find', 'users'), handler('h', 'srv', 'show')]);
  const record = { chain: joined, terminal: {} };
  const outcome = actionOutcome(record);
  assert.equal(outcome.status, 'responded');
  assert.equal(outcome.label, 'Responded 200: no database work after the preconditions (find users by middleware requireAuth)');
  const frontier = chainFrontier(record);
  assert.equal(frontier.stopped_at, 'handler');
  assert.equal(frontier.stop_reason, 'preconditions_only');
});

test('ruling 2026-09-24: a handler read after the preconditions completes the safe request; a middleware write still counts, named', () => {
  const read = actionOutcome({ chain: attachBackendSpans([request()], [server(), middleware('m', 'srv', 'requireAuth'), db('d', 'm', 'find', 'users'), handler('h', 'srv', 'show'), db('d2', 'h', 'find', 'items')]), terminal: {} });
  assert.equal(read.label, 'Completed 200: find items');
  const write = actionOutcome({ chain: attachBackendSpans([request('POST')], [server('srv', 'browser', 'POST'), middleware('m', 'srv', 'audit'), db('d', 'm', 'insert', 'activity'), handler('h', 'srv', 'show')]), terminal: {} });
  assert.equal(write.label, 'Completed 200: insert activity (middleware: audit)');
});
