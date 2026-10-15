import assert from 'node:assert/strict';
import test from 'node:test';
import { buildBridgeWorkflow, buildClickFrontierWorkflow } from './browser/bridge-workflow.mjs';

test('bridge workflow retains the frontend path, runtime request, route, handler, and reasons', () => {
  const action = {
    session: 'session-1',
    event: 'click',
    action: 'source-action-1',
    target: { text: 'Load more', source_control: 'control-1' },
  };
  const result = {
    status: 'resolved',
    reason: 'source_request_to_route',
    frontend: { scenario_id: 'scenario-1' },
    request: {
      method: 'GET',
      url: '/api/projects?cursor=next',
      request_occurrence_id: 'request-1',
      action_occurrence_id: 'action-1',
      evidence_ids: ['request-1'],
    },
    source_request: {
      contract_application_id: 'axios-application-1',
      package: 'axios',
      effect: { method: 'GET' },
    },
    route_join: {
      request: { path: '/api/projects' },
      match: {
        id: 'route-1', method: 'GET', path_template: '/api/projects',
        source_node_id: 'route-source', evidence_ids: ['route-source', 'handler-source'],
      },
    },
    handler: { entry_handler_ids: ['handler-source'], backend_execution: 'unconfirmed' },
  };
  const frontendJoin = {
    source: { path: { library_contracts: [{
      id: 'tanstack-application-1', package: '@tanstack/react-query',
      returned_member: 'fetchNextPage', invokes_option: 'queryFn',
    }] } },
  };
  const backendMap = { source_nodes: [
    { id: 'route-source', file: 'routes/projects.js', start: 10, end: 50,
      text: "router.get('/', handlers.listProjects)" },
    { id: 'handler-source', file: 'routes/projects.js', start: 26, end: 47,
      text: 'handlers.listProjects' },
  ] };

  const workflow = buildBridgeWorkflow(result, action, backendMap, frontendJoin);
  const facts = workflow.properties.checkpoint.evidence.facts;

  assert.deepEqual(facts.map(fact => fact.kind), [
    'source_control', 'frontend_path', 'runtime_request', 'route_registration', 'handler_reference',
  ]);
  assert.equal(facts[1].value, 'Load more → @tanstack/react-query.fetchNextPage → queryFn → axios.get');
  assert.match(facts[2].value, /^GET \/api\/projects\?cursor=next$/);
  assert.match(facts[3].value, /GET \/api\/projects/);
  assert.equal(facts[3].source.file, 'routes/projects.js');
  assert.equal(facts[4].value, 'handlers.listProjects');
  assert.ok(facts.every(fact => fact.reason.length > 20));
  assert.equal(workflow.properties.checkpoint.evidence.count, 5);
  assert.match(workflow.properties.learning.use, /click-to-request-to-route mapping/);
  assert.equal(workflow.properties.summary.backend_execution, 'unconfirmed');
});

test('confirmed backend and database spans become explicit evidence without claiming a response outcome', () => {
  const action = { session: 'session-1', event: 'click', action: 'load-more',
    target: { text: 'Load more', source_control: 'control-1' } };
  const result = {
    status: 'resolved', reason: 'source_request_to_route', frontend: { scenario_id: 'scenario-1' },
    request: { method: 'GET', url: '/api/projects?cursor=next', request_occurrence_id: 'request-1',
      action_occurrence_id: 'action-1', evidence_ids: ['request-1'] },
    source_request: { contract_application_id: 'axios-1', package: 'axios', effect: { method: 'GET' } },
    route_join: { request: { path: '/api/projects' }, match: { id: 'route-1', method: 'GET',
      path_template: '/api/projects', source_node_id: 'route-source', evidence_ids: ['route-source'] } },
    handler: { entry_handler_ids: ['handler-source'], backend_execution: 'confirmed', backend_evidence: {
      status: 'confirmed', reason: 'exact_request_and_registered_handler_observed',
      trace_id: '12345678901234567890123456789012', server_span_id: 'server-span',
      handler_span_ids: ['handler-span'], database_span_ids: ['database-span'],
      database_operations: [{ span_id: 'database-span', system: 'mongodb', operation: 'find',
        namespace: 'LibreChat', collection: 'chatprojects',
        instrumentation: '@opentelemetry/instrumentation-mongodb' }],
      evidence_ids: ['server-span', 'handler-span', 'database-span'],
    } },
  };
  const backendMap = { source_nodes: [
    { id: 'route-source', file: 'routes/projects.js', text: "router.get('/', handlers.listProjects)" },
    { id: 'handler-source', file: 'routes/projects.js', text: 'handlers.listProjects' },
  ] };
  const workflow = buildBridgeWorkflow(result, action, backendMap, { source: { path: {} } });
  const facts = workflow.properties.checkpoint.evidence.facts;
  assert.deepEqual(facts.slice(-3).map(fact => fact.kind),
    ['backend_server_span', 'backend_handler_span', 'database_operation_span']);
  assert.equal(facts.at(-1).value, 'mongodb find · LibreChat.chatprojects');
  assert.match(workflow.properties.caption, /Confirmed GET \/api\/projects ran handlers\.listProjects/);
  assert.equal(workflow.properties.summary.backend_execution, 'confirmed');
  assert.match(workflow.properties.learning.use, /backend-handler-to-database execution/);
  assert.match(workflow.properties.checkpoint.uncertainty[0], /returned rows/);
  assert.equal(workflow.properties.summary.database_execution, 'observed');
  assert.equal(workflow.properties.summary.terminal_result_proven, false);
});


test('an unsupported click stays incomplete and cannot become training success', () => {
  const row = buildClickFrontierWorkflow({ occurrence: 'click:1', label: 'New project',
    reason: 'no_verified_control_to_request_path' });
  assert.equal(row.properties.workflow_status, 'incomplete');
  assert.equal(row.properties.learning.standalone_training_signal, false);
  assert.deepEqual(row.properties.checkpoint.outcome.observed_effects, []);
  assert.match(row.properties.checkpoint.evidence.facts[0].reason, /unproved/);
});
