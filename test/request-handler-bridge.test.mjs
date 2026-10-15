import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compileBackendRoutes } from '../analysis/backend-routes.mjs';
import { connectRequestToHandler } from '../analysis/request-handler-bridge.mjs';

const sourceRequest = (id, method = 'GET') => ({
  contract_application_id: id,
  contract_id: 'axios/get.httpRequest/1.18.1',
  invocation_call_id: `call:${id}`,
  placement_id: 'placement:projects',
  package: 'axios', version: '1.18.1', package_verification_sha256: 'verified',
  effect: { kind: 'http_request', method,
    url_input: { kind: 'source', text: 'endpoints.projects(params)' } },
  conditions: [], evidence_ids: [`source:${id}`],
});

function frontend(requests = [sourceRequest('request:projects')]) {
  return {
    schema: 'producttrace.react-runtime-join.v1', status: 'resolved', reason: null,
    map_fingerprint: 'map:librechat',
    runtime: { event_id: 'workflow:event:1', action_occurrence_id: 'action:1', workflow_id: 'workflow:1',
      session: 'session:1', seq: null, evidence_ids: ['browser:1'] },
    source: { control_id: 'control:load-more', scenario_id: 'scenario:load-more', placement_id: 'placement:projects',
      handler_ids: ['handler:load-more'], conditions: [], owner: null, node: null,
      path: { scenario_edges: [], library_contracts: [], library_backlog: [], outbound_requests: requests } },
  };
}

function observation(overrides = {}) {
  return {
    schema: 'producttrace.http-request-observation.v1', basis: 'runtime_observation',
    request_occurrence_id: 'request-occurrence:1', action_occurrence_id: 'action:1',
    map_fingerprint: 'map:librechat', contract_application_id: 'request:projects',
    method: 'GET', url: '/api/projects?cursor=two', service: 'librechat-api',
    evidence_ids: ['network:1'], ...overrides,
  };
}

function backend() {
  return compileBackendRoutes({
    'server.js': `const express = require('express'); const projects = require('./projects');
      const app = express(); app.use('/api/projects', projects);`,
    'projects.js': `const express = require('express'); const router = express.Router();
      const handlers = createProjectHandlers(); router.get('/', handlers.listProjects);
      router.post('/', handlers.createProject); module.exports = router;`,
  }, { serviceId: 'librechat-api' });
}

test('an exact request-call stamp admits a dynamic source URL and predicts one backend entry reference', () => {
  const result = connectRequestToHandler(frontend(), observation({ service: 'librechat-api' }), backend());
  assert.deepEqual([result.status, result.reason], ['resolved', 'source_request_to_route']);
  assert.equal(result.source_request.contract_application_id, 'request:projects');
  assert.equal(result.route_join.request.path, '/api/projects');
  assert.equal(result.route_join.request.query[0].name, 'cursor');
  assert.equal(result.handler.backend_execution, 'unconfirmed');
  assert.equal(result.handler.implementation.status, 'unresolved');
  const handlerText = backend().source_nodes.find(node => node.id === result.handler.entry_handler_ids[0])?.text;
  assert.equal(handlerText, 'handlers.listProjects');
  assert.deepEqual(result.handler.entry_handler_labels, ['handlers.listProjects']);
});

test('two requests from one click keep distinct request occurrences and exact source call identities', () => {
  const join = frontend([sourceRequest('request:projects'), sourceRequest('request:audit', 'POST')]);
  const projects = connectRequestToHandler(join, observation(), backend());
  const audit = connectRequestToHandler(join, observation({ request_occurrence_id: 'request-occurrence:2',
    contract_application_id: 'request:audit', method: 'POST', url: '/api/projects' }), backend());
  assert.equal(projects.source_request.contract_application_id, 'request:projects');
  assert.equal(audit.source_request.contract_application_id, 'request:audit');
  assert.notEqual(projects.request.request_occurrence_id, audit.request.request_occurrence_id);
  assert.notEqual(projects.handler.entry_handler_ids[0], audit.handler.entry_handler_ids[0]);
});

test('background and stale requests cannot borrow a clicked source path', () => {
  const map = backend();
  assert.equal(connectRequestToHandler(frontend(), observation({ action_occurrence_id: 'background:7' }), map).reason,
    'action_occurrence_mismatch');
  assert.equal(connectRequestToHandler(frontend(), observation({ map_fingerprint: 'stale-map' }), map).reason,
    'source_map_mismatch');
  assert.equal(connectRequestToHandler(frontend(), observation({ contract_application_id: 'request:unknown' }), map).reason,
    'unknown_source_request_identity');
  assert.equal(connectRequestToHandler(frontend(), observation({ method: 'POST' }), map).reason,
    'request_method_mismatch');
  assert.equal(connectRequestToHandler(frontend(), { method: 'GET', url: '/api/projects' }, map).reason,
    'invalid_request_observation');
});

test('backend route gaps remain unresolved after the frontend request is proven', () => {
  const map = compileBackendRoutes({
    'server.js': `const express = require('express'); const app = express(); const route = process.env.ROUTE;
      function unknown(req, res) {} function known(req, res) {}
      app.get(route, unknown); app.get('/api/projects', known);`,
  }, { serviceId: 'librechat-api' });
  const result = connectRequestToHandler(frontend(), observation(), map);
  assert.deepEqual([result.status, result.reason, result.route_join.reason],
    ['unresolved', 'route_match_unresolved', 'backend_inventory_gap']);
  assert.equal(result.handler, null);
});
