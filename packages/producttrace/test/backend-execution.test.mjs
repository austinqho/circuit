import assert from 'node:assert/strict';
import { test } from 'node:test';
import { confirmBackendExecution } from '../analysis/index.mjs';

const trace = {
  schema: 'producttrace.trace-context.v1',
  trace_id: '12345678901234567890123456789012',
  span_id: '1234567890123456',
  trace_flags: '01',
  traceparent: '00-12345678901234567890123456789012-1234567890123456-01',
};
const bridge = {
  schema: 'producttrace.request-handler-bridge.v1',
  status: 'resolved',
  reason: 'source_request_to_route',
  frontend: { map_fingerprint: 'map', action_occurrence_id: 'action:1', control_id: 'control', scenario_id: 'scenario' },
  request: { schema: 'producttrace.http-request-observation.v1', basis: 'runtime_observation',
    request_occurrence_id: 'request:1', action_occurrence_id: 'action:1', map_fingerprint: 'map',
    contract_application_id: 'contract:1', method: 'GET', url: '/api/projects?cursor=next',
    service: 'fixture-api', trace_context: trace },
  source_request: {},
  route_join: { request: { path: '/api/projects' }, match: { path_template: '/api/projects', service_id: 'fixture-api' } },
  handler: { route_id: 'route:1', entry_handler_ids: ['source:1'], entry_handler_labels: ['handlers.listProjects'],
    middleware_ids: [], middleware_resolution: {}, implementation: {}, backend_execution: 'unconfirmed' },
};
const server = { schema: 'producttrace.backend-span.v1', source: 'opentelemetry', service_name: 'fixture-api',
  name: 'GET /api/projects', trace_id: trace.trace_id, span_id: 'aaaaaaaaaaaaaaaa',
  parent_span_id: trace.span_id, kind: 'server', status: { code: 0 },
  attributes: { 'http.request.method': 'GET', 'http.route': '/api/projects' }, instrumentation: { name: '@opentelemetry/instrumentation-http' } };
const dispatch = { ...server, name: 'request handler - /api/projects', span_id: 'bbbbbbbbbbbbbbbb',
  parent_span_id: server.span_id, kind: 'internal', attributes: { 'http.route': '/api/projects', 'express.type': 'request_handler' },
  instrumentation: { name: '@opentelemetry/instrumentation-express' } };
const handler = { ...server, name: 'express handler - listProjects', span_id: 'cccccccccccccccc',
  parent_span_id: dispatch.span_id, kind: 'internal', attributes: { 'http.route': '/api/projects',
    'producttrace.express.handler.method': 'GET', 'producttrace.express.handler.name': 'listProjects' },
  instrumentation: { name: 'producttrace-express-handlers' } };
const database = { ...server, name: 'mongodb.find', span_id: 'dddddddddddddddd',
  parent_span_id: handler.span_id, kind: 'client', attributes: { 'db.system': 'mongodb',
    'db.operation': 'find', 'db.name': 'LibreChat', 'db.mongodb.collection': 'chatprojects' },
  instrumentation: { name: '@opentelemetry/instrumentation-mongodb' } };

test('exact W3C parent and exact registered handler confirm backend execution', () => {
  const result = confirmBackendExecution(bridge, [server, dispatch, handler]);
  assert.equal(result.handler.backend_execution, 'confirmed');
  assert.deepEqual(result.handler.backend_evidence, {
    status: 'confirmed', reason: 'exact_request_and_registered_handler_observed', trace_id: trace.trace_id,
    server_span_id: server.span_id, handler_span_ids: [handler.span_id],
    database_span_ids: [], database_operations: [],
    evidence_ids: [server.span_id, handler.span_id],
  });
});

test('database operations are retained only below the executed handler', () => {
  const unrelated = { ...database, span_id: 'eeeeeeeeeeeeeeee', parent_span_id: dispatch.span_id };
  const result = confirmBackendExecution(bridge, [server, dispatch, handler, database, unrelated]);
  assert.deepEqual(result.handler.backend_evidence.database_span_ids, [database.span_id]);
  assert.deepEqual(result.handler.backend_evidence.database_operations, [{
    span_id: database.span_id,
    system: 'mongodb',
    operation: 'find',
    namespace: 'LibreChat',
    collection: 'chatprojects',
    instrumentation: '@opentelemetry/instrumentation-mongodb',
  }]);
  assert.ok(!result.handler.backend_evidence.evidence_ids.includes(unrelated.span_id));
});

test('same route cannot borrow a different request occurrence', () => {
  const unrelated = { ...server, trace_id: '99999999999999999999999999999999', parent_span_id: trace.span_id };
  const result = confirmBackendExecution(bridge, [unrelated, dispatch, handler]);
  assert.equal(result.handler.backend_execution, 'unconfirmed');
  assert.equal(result.handler.backend_evidence.reason, 'exact_server_span_missing');
});

test('route dispatch alone does not claim the terminal handler ran', () => {
  const result = confirmBackendExecution(bridge, [server, dispatch]);
  assert.equal(result.handler.backend_execution, 'unconfirmed');
  assert.equal(result.handler.backend_evidence.reason, 'registered_handler_span_missing');
  assert.equal(result.handler.backend_evidence.server_span_id, server.span_id);
});

test('duplicate server spans abstain instead of choosing by timing', () => {
  const duplicate = { ...server, span_id: 'ffffffffffffffff' };
  const result = confirmBackendExecution(bridge, [server, duplicate, handler]);
  assert.equal(result.handler.backend_evidence.status, 'ambiguous');
  assert.equal(result.handler.backend_evidence.reason, 'multiple_exact_server_spans');
});

test('a parameterized route accepts its template while retaining the concrete request path', () => {
  const parameterBridge = structuredClone(bridge);
  parameterBridge.request.url = '/api/projects/project-1';
  parameterBridge.route_join.request.path = '/api/projects/project-1';
  parameterBridge.route_join.match.path_template = '/api/projects/:projectId';
  const parameterServer = { ...server, attributes: { 'http.request.method': 'GET',
    'http.route': '/api/projects/:projectId', 'url.path': '/api/projects/project-1' } };
  const parameterDispatch = { ...dispatch, attributes: { 'http.route': '/api/projects/:projectId' } };
  const parameterHandler = { ...handler, attributes: { ...handler.attributes,
    'http.route': '/api/projects/:projectId' } };
  const result = confirmBackendExecution(parameterBridge,
    [parameterServer, parameterDispatch, parameterHandler]);
  assert.equal(result.handler.backend_execution, 'confirmed');
});

test('duplicate same-named handler spans abstain', () => {
  const duplicateHandler = { ...handler, span_id: '1111111111111111' };
  const result = confirmBackendExecution(bridge, [server, dispatch, handler, duplicateHandler]);
  assert.equal(result.handler.backend_execution, 'unconfirmed');
  assert.equal(result.handler.backend_evidence.status, 'ambiguous');
  assert.equal(result.handler.backend_evidence.reason, 'multiple_registered_handler_spans');
});
