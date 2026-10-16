import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createReactRuntimeIntegration } from '../../analysis/index.mjs';

const configPath = path.resolve(process.argv[2] || '/tmp/producttrace-librechat-pr8.json');
const origin = process.env.PRODUCTTRACE_VIEWER_ORIGIN || 'http://127.0.0.1:8124';
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
assert.equal(config.schema, 'producttrace.autonomous-installation.v1');
assert.equal(config.coverage.request_action_handlers,
  config.coverage.instrumented_request_action_handlers);
assert.equal(config.coverage.request_source_nodes,
  config.coverage.instrumented_request_source_nodes);
assert.ok(config.request_bridge.actions.length > 0, 'no request-capable control was discovered');
assert.equal(execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=no'], {
  cwd: config.repository, encoding: 'utf8',
}).trim(), '', 'the frozen source checkout has tracked changes');

const [bridgeResponse, spansResponse] = await Promise.all([
  fetch(`${origin}/api/demo/bridge/latest`),
  fetch(`${origin}/api/demo/backend-spans/latest`),
]);
assert.equal(bridgeResponse.status, 200, 'isolated ProductTrace bridge is unavailable');
assert.equal(spansResponse.status, 200, 'isolated ProductTrace span store is unavailable');
const entries = await bridgeResponse.json();
const spans = await spansResponse.json();
const requestActions = new Map(config.request_bridge.actions.map(row => [row.action, row]));
const entry = entries.find(row => requestActions.has(row.action?.action)
  && row.result?.handler?.backend_execution === 'confirmed');
assert.ok(entry, 'no discovered request-capable control has confirmed backend evidence');

const binding = requestActions.get(entry.action.action);
const result = entry.result;
assert.equal(entry.action.target?.source_control, binding.source_control);
assert.equal(entry.frontend_join.runtime.action_occurrence_id,
  result.request.action_occurrence_id);
assert.equal(result.request.map_fingerprint, config.react_map.fingerprint);
assert.ok(binding.requests.some(row => row.contract_application_id
  === result.request.contract_application_id));
assert.equal(result.status, 'resolved');
assert.equal(result.reason, 'source_request_to_route');
assert.equal(result.handler.backend_evidence.reason,
  'exact_request_and_registered_handler_observed');

const reactIdentity = entry.action.react_identity;
assert.equal(reactIdentity.runtime_observed, true);
assert.equal(reactIdentity.basis, 'react-devtools-commit.v1');
assert.match(reactIdentity.root_id, /^react-root:/u);
assert.match(reactIdentity.instance_id, /^react-instance:/u);
assert.match(reactIdentity.mount_id, /^react-mount:/u);
assert.match(reactIdentity.commit_id, /^react-commit:/u);
assert.equal(reactIdentity.render_id, null);
assert.equal(reactIdentity.render_observed, false);

const evidence = result.handler.backend_evidence;
const server = spans.find(span => span.span_id === evidence.server_span_id);
const handler = spans.find(span => evidence.handler_span_ids.includes(span.span_id));
const database = spans.find(span => evidence.database_span_ids.includes(span.span_id));
assert.ok(server && handler && database, 'the exact server, handler, and database spans must survive');
assert.equal(server.trace_id, result.request.trace_context.trace_id);
assert.equal(handler.trace_id, server.trace_id);
assert.equal(database.trace_id, server.trace_id);

const integration = createReactRuntimeIntegration(config.react_map);
const candidate = integration.candidates.find(row => row.action === binding.action);
assert.ok(candidate, 'the recorded action no longer resolves to its generated source candidate');
assert.equal(candidate.path.outbound_requests.length, binding.requests.length);

console.log(JSON.stringify({
  schema: 'producttrace.librechat-autonomous-runtime-acceptance.v1',
  status: 'passed',
  repository: config.repository,
  map_fingerprint: config.react_map.fingerprint,
  supplied_path_hints: [],
  discovered_request_actions: config.request_bridge.actions.length,
  clicked_control: {
    action: binding.action,
    source_control: binding.source_control,
    source: candidate.source,
    owner: candidate.owner,
  },
  react_identity: reactIdentity,
  request: {
    occurrence_id: result.request.request_occurrence_id,
    method: result.route_join.match.method,
    path_template: result.route_join.match.path_template,
    contract_application_id: result.request.contract_application_id,
  },
  backend: {
    handler_labels: result.handler.entry_handler_labels,
    execution: result.handler.backend_execution,
    server_span_id: server.span_id,
    handler_span_id: handler.span_id,
    database_span_id: database.span_id,
    database_system: database.attributes?.['db.system'],
    database_operation: database.attributes?.['db.operation'],
  },
  claims: {
    source_scenario_predicted: true,
    browser_click_observed: true,
    react_commit_identity_observed: true,
    request_observed: true,
    registered_handler_observed: true,
    database_operation_observed: true,
  },
  unproven: [
    'the exact React render attempt that produced the clicked host Fiber',
    'hook-slot and effect callback lifecycle occurrences in this general LibreChat build',
    'the other source controls that did not execute in this one-click acceptance',
  ],
}, null, 2));
