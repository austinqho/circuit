import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matchRequestToRoute } from '../analysis/request-route-match.mjs';

function route(id, method, pathTemplate, extras = {}) {
  return {
    id,
    framework: 'express',
    method,
    path_template: pathTemplate,
    handler_ids: [`handler:${id}`],
    middleware_ids: [],
    evidence_ids: [`source:${id}`],
    ...extras,
  };
}

test('normalizes an observed URL and matches method plus literal pathname without using query values', () => {
  const joined = matchRequestToRoute({
    basis: 'runtime_observation',
    method: 'get',
    url: 'https://chat.example/api/projects?cursor=two&cursor=one&limit=20#client-only',
    evidence_ids: ['network:7', 'network:7'],
  }, [route('projects', 'GET', '/api/projects')]);

  assert.equal(joined.schema, 'producttrace.request-route-join.v1');
  assert.equal(joined.status, 'resolved');
  assert.equal(joined.reason, 'unique_route_match');
  assert.equal(joined.match.id, 'projects');
  assert.deepEqual(joined.request, {
    basis: 'runtime_observation', method: 'GET',
    url: 'https://chat.example/api/projects?cursor=two&cursor=one&limit=20#client-only',
    path: '/api/projects',
    query: [{ name: 'cursor', value: 'one' }, { name: 'cursor', value: 'two' }, { name: 'limit', value: '20' }],
    service: null, application_id: null, evidence_ids: ['network:7'],
  });
  assert.equal(joined.handler_confirmation, 'source_route_match_only');
});

test('same pathname with a different method does not match', () => {
  const joined = matchRequestToRoute({ method: 'POST', url: '/items' }, [
    route('read-items', 'GET', '/items'),
  ]);
  assert.equal(joined.status, 'unresolved');
  assert.equal(joined.reason, 'no_method_match');
  assert.equal(joined.match, null);
  assert.deepEqual(joined.candidates.map(candidate => candidate.id), ['read-items']);
});

test('literal and required parameter routes match only their respective shapes', () => {
  const routes = [
    route('items', 'GET', '/items'),
    route('item', 'GET', '/items/:id'),
  ];
  assert.equal(matchRequestToRoute({ method: 'GET', url: '/items' }, routes).match.id, 'items');
  assert.equal(matchRequestToRoute({ method: 'GET', url: '/items/42' }, routes).match.id, 'item');
  assert.equal(matchRequestToRoute({ method: 'GET', url: '/items/42/more' }, routes).status, 'unresolved');
});

test('specificity resolves optional parameters and terminal wildcards for a framework that defines it', () => {
  const routes = [
    route('optional', 'GET', '/items/:id?', { framework: 'fastify' }),
    route('literal', 'GET', '/items', { framework: 'fastify' }),
    route('wildcard', 'GET', '/items/*', { framework: 'fastify' }),
    route('parameter', 'GET', '/items/:id', { framework: 'fastify' }),
  ];
  const collection = matchRequestToRoute({ method: 'GET', url: '/items' }, routes);
  const item = matchRequestToRoute({ method: 'GET', url: '/items/42' }, routes);
  const nested = matchRequestToRoute({ method: 'GET', url: '/items/42/history' }, routes);
  assert.deepEqual([collection.status, collection.reason, collection.match.id], ['resolved', 'path_specificity', 'literal']);
  assert.deepEqual([item.status, item.reason, item.match.id], ['resolved', 'path_specificity', 'parameter']);
  assert.equal(nested.match.id, 'wildcard');
});

test('an optional parameter can be skipped or consumed when one route is the only possible receiver', () => {
  const routes = [route('localized-docs', 'GET', '/docs/:language?/intro')];
  assert.equal(matchRequestToRoute({ method: 'GET', url: '/docs/intro' }, routes).match.id, 'localized-docs');
  assert.equal(matchRequestToRoute({ method: 'GET', url: '/docs/en/intro' }, routes).match.id, 'localized-docs');
});

test('Express registration order wins when overlapping routes provide complete order evidence', () => {
  const joined = matchRequestToRoute({ method: 'GET', url: '/users/new' }, [
    route('parameter-first', 'GET', '/users/:id', { registration_order: 3 }),
    route('literal-later', 'GET', '/users/new', { registration_order: 4 }),
  ]);
  assert.equal(joined.status, 'resolved');
  assert.equal(joined.reason, 'framework_registration_order');
  assert.equal(joined.match.id, 'parameter-first');
});

test('duplicate routes remain ambiguous when framework order is absent or tied', () => {
  const absent = matchRequestToRoute({ method: 'GET', url: '/items/42' }, [
    route('first', 'GET', '/items/:id'),
    route('second', 'GET', '/items/:id'),
  ]);
  const tied = matchRequestToRoute({ method: 'GET', url: '/items/42' }, [
    route('first', 'GET', '/items/:id', { registration_order: 1 }),
    route('second', 'GET', '/items/:id', { registration_order: 1 }),
  ]);
  assert.deepEqual([absent.status, absent.reason], ['ambiguous', 'framework_route_order_unavailable']);
  assert.deepEqual([tied.status, tied.reason], ['ambiguous', 'duplicate_route_precedence']);
  assert.deepEqual(absent.candidates.map(candidate => candidate.id), ['first', 'second']);
});

test('an inventory ambiguity is retained even when Express registration order is known', () => {
  const ambiguity = { code: 'multiple_matching_registrations' };
  const joined = matchRequestToRoute({ method: 'GET', url: '/items/42' }, [
    route('first', 'GET', '/items/:id', { registration_order: 4, ambiguity }),
    route('second', 'GET', '/items/:id', { registration_order: 5, ambiguity }),
  ]);
  assert.deepEqual([joined.status, joined.reason], ['ambiguous', 'inventory_route_ambiguity']);
  assert.deepEqual(joined.candidates.map(candidate => candidate.id), ['first', 'second']);
});

test('invalid and base-dependent URLs abstain instead of inventing a pathname', () => {
  const routes = [route('items', 'GET', '/items')];
  assert.equal(matchRequestToRoute({ method: 'GET', url: 'http://[broken' }, routes).reason, 'invalid_request_url');
  assert.equal(matchRequestToRoute({ method: 'GET', url: 'items' }, routes).reason, 'relative_request_url_without_base');
  assert.equal(matchRequestToRoute({ method: 'GET', url: '/items/${id}' }, routes).reason, 'dynamic_request_url');
  assert.equal(matchRequestToRoute({ method: 'GET', url: '/items/:id' }, routes).reason, 'dynamic_request_url');
});

test('unsupported dynamic route templates prevent a false unique match', () => {
  const joined = matchRequestToRoute({ method: 'GET', url: '/items/42' }, [
    route('literal', 'GET', '/items/42'),
    route('computed', 'GET', '/items/${segment}'),
  ]);
  assert.equal(joined.status, 'unresolved');
  assert.equal(joined.reason, 'unsupported_dynamic_route_template');
  assert.deepEqual(joined.candidates.map(candidate => candidate.id), ['computed']);
});

test('explicit service identity prevents cross-service contamination', () => {
  const routes = [
    route('web-projects', 'GET', '/api/projects', { service: 'web' }),
    route('admin-projects', 'GET', '/api/projects', { service: 'admin' }),
    route('unscoped-projects', 'GET', '/api/projects'),
  ];
  const web = matchRequestToRoute({ method: 'GET', url: '/api/projects', service: 'web' }, routes);
  const other = matchRequestToRoute({ method: 'GET', url: '/api/projects', service: 'worker' }, routes);
  const unknown = matchRequestToRoute({ method: 'GET', url: '/api/projects' }, routes);
  assert.equal(web.match.id, 'web-projects');
  assert.deepEqual([other.status, other.reason], ['unresolved', 'no_service_match']);
  assert.deepEqual([unknown.status, unknown.reason], ['ambiguous', 'framework_route_order_unavailable']);
});

test('source candidates and runtime observations never become backend confirmation', () => {
  const routes = [route('items', 'GET', '/items')];
  const source = matchRequestToRoute({ method: 'GET', url: '/items' }, routes);
  const runtime = matchRequestToRoute({
    basis: 'runtime_observation', method: 'GET', url: '/items', evidence_ids: ['browser-request:1'],
  }, routes);
  assert.equal(source.request.basis, 'source_candidate');
  assert.equal(runtime.request.basis, 'runtime_observation');
  assert.equal(source.handler_confirmation, 'source_route_match_only');
  assert.equal(runtime.handler_confirmation, 'source_route_match_only');
  assert.deepEqual(runtime.request.evidence_ids, ['browser-request:1']);
});

test('returned routes are snapshots and malformed inventories fail at the interface', () => {
  const routes = [route('items', 'GET', '/items')];
  const joined = matchRequestToRoute({ method: 'GET', url: '/items' }, routes);
  joined.match.handler_ids.push('mutated');
  assert.deepEqual(routes[0].handler_ids, ['handler:items']);
  assert.throws(() => matchRequestToRoute({ method: 'GET', url: '/items' }, [{}]), /Each route must provide/);
});

test('a full inventory keeps unresolved route frontiers and application boundaries', async () => {
  const { compileBackendRoutes } = await import('../analysis/backend-routes.mjs');
  const blocked = compileBackendRoutes({
    'server.js': `const express = require('express'); const app = express();
      const dynamic = process.env.ROUTE; function unknown(req, res) {} function known(req, res) {}
      app.get(dynamic, unknown); app.get('/items', known);`,
  });
  const blockedJoin = matchRequestToRoute({ method: 'GET', url: '/items' }, blocked);
  assert.equal(blocked.frontiers.length, 1);
  assert.deepEqual([blockedJoin.status, blockedJoin.reason], ['unresolved', 'backend_inventory_gap']);

  const multiple = compileBackendRoutes({
    'server.js': `const express = require('express'); const web = express(); const admin = express();
      function webItems(req, res) {} function adminItems(req, res) {}
      web.get('/items', webItems); admin.get('/items', adminItems);`,
  });
  const unscoped = matchRequestToRoute({ method: 'GET', url: '/items' }, multiple);
  assert.deepEqual([unscoped.status, unscoped.reason], ['unresolved', 'request_application_required']);
  const applicationId = multiple.routes.find(route => route.handler_ids.some(id =>
    multiple.source_nodes.find(node => node.id === id)?.text.includes('webItems'))).application_id;
  const scoped = matchRequestToRoute({ method: 'GET', url: '/items', application_id: applicationId }, multiple);
  assert.equal(scoped.status, 'resolved');
  assert.equal(scoped.match.application_id, applicationId);
});

test('Express default case-insensitive matching and deployment service identity are preserved', async () => {
  const { compileBackendRoutes } = await import('../analysis/backend-routes.mjs');
  const map = compileBackendRoutes({
    'server.js': `const express = require('express'); const app = express();
      function first(req, res) {} function second(req, res) {}
      app.get('/Same', first); app.get('/same', second);`,
  }, { serviceId: 'web-api' });
  const missingService = matchRequestToRoute({ method: 'GET', url: '/same' }, map);
  assert.deepEqual([missingService.status, missingService.reason], ['unresolved', 'request_service_required']);
  const joined = matchRequestToRoute({ method: 'GET', url: '/same', service: 'web-api' }, map);
  assert.deepEqual([joined.status, joined.reason], ['resolved', 'framework_registration_order']);
  assert.equal(joined.registration_order, undefined);
  assert.equal(joined.match.registration_order, 0);
});
