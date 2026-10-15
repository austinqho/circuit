import assert from 'node:assert/strict';

const origin = process.env.PRODUCTTRACE_VIEWER_ORIGIN || 'http://127.0.0.1:8123';
const [bridgeResponse, spansResponse] = await Promise.all([
  fetch(`${origin}/api/demo/bridge/latest`),
  fetch(`${origin}/api/demo/backend-spans/latest`),
]);
assert.equal(bridgeResponse.status, 200, 'ProductTrace viewer bridge endpoint is unavailable');
assert.equal(spansResponse.status, 200, 'ProductTrace viewer backend-span endpoint is unavailable');
const entries = await bridgeResponse.json();
const spans = await spansResponse.json();
const entry = entries.find(item => item.result?.handler?.backend_execution === 'confirmed');
assert.ok(entry, 'Click Projects / Load more once; no confirmed backend occurrence was found');

const { result } = entry;
const trace = result.request.trace_context;
const evidence = result.handler.backend_evidence;
assert.equal(result.route_join.match.method, 'GET');
assert.equal(result.route_join.match.path_template, '/api/projects');
assert.deepEqual(result.handler.entry_handler_labels, ['handlers.listProjects']);
assert.equal(evidence.reason, 'exact_request_and_registered_handler_observed');
const server = spans.find(span => span.span_id === evidence.server_span_id);
assert.ok(server, 'confirmed server span was not retained');
assert.equal(server.trace_id, trace.trace_id);
assert.equal(server.parent_span_id, trace.span_id);
assert.equal(server.service_name, 'librechat-api');
const handler = spans.find(span => evidence.handler_span_ids.includes(span.span_id));
assert.ok(handler, 'confirmed handler span was not retained');
assert.equal(handler.trace_id, trace.trace_id);
assert.equal(handler.attributes['producttrace.express.handler.name'], 'listProjects');
const database = spans.find(span => evidence.database_span_ids.includes(span.span_id));
assert.ok(database, 'no database span was retained below the executed handler');
assert.ok(database.instrumentation?.name.includes('mongodb'), database.instrumentation?.name);
assert.ok(evidence.database_operations.some(operation => operation.system === 'mongodb'
  && String(operation.operation).toLowerCase().includes('find')),
  'the exact request trace did not retain its MongoDB find operation');

const byId = new Map(spans.filter(span => span.trace_id === trace.trace_id)
  .map(span => [span.span_id, span]));
let parent = handler.parent_span_id;
const chain = [];
while (parent) {
  chain.push(parent);
  if (parent === server.span_id) break;
  parent = byId.get(parent)?.parent_span_id || null;
}
assert.ok(chain.includes(server.span_id), 'handler span is not a descendant of the exact server span');

console.log(JSON.stringify({
  schema: 'producttrace.librechat-backend-runtime-acceptance.v1',
  status: 'passed',
  request_occurrence_id: result.request.request_occurrence_id,
  trace_id: trace.trace_id,
  route: 'GET /api/projects',
  registered_handler: 'handlers.listProjects',
  server_span_id: server.span_id,
  handler_span_id: handler.span_id,
  database_span_id: database.span_id,
  database_operation: evidence.database_operations.find(operation => operation.span_id === database.span_id),
}, null, 2));
