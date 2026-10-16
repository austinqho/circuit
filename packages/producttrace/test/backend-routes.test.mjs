import test from 'node:test';
import assert from 'node:assert/strict';
import { compileBackendRoutes } from '../analysis/backend-routes.mjs';

const byText = (map, id) => map.source_nodes.find(node => node.id === id)?.text || '';

test('Express inventory composes imported and nested router mounts with ordered middleware', () => {
  const files = {
    'server.ts': `import express from 'express';
      import api from './api';
      function session(req, res, next) { next(); }
      const app = express();
      app.use('/api', session, api);`,
    'api.ts': `import { Router } from 'express';
      import projects from './projects';
      const api = Router();
      function authorize(req, res, next) { next(); }
      api.use('/v1', authorize, projects);
      export default api;`,
    'projects.ts': `import { Router } from 'express';
      import { listProjects, createProject } from './handlers';
      const projects = Router();
      function validate(req, res, next) { next(); }
      projects.get('/projects/:projectId', validate, listProjects);
      projects.post('/projects', createProject);
      export default projects;`,
    'handlers.ts': `export function listProjects(req, res) { res.json([]); }
      export function createProject(req, res) { res.status(201).end(); }`,
  };
  const map = compileBackendRoutes(files);
  assert.equal(map.schema, 'producttrace.backend-route-map.v1');
  assert.match(map.fingerprint, /^[a-f0-9]{64}$/u);
  assert.deepEqual(map.diagnostics, []);
  assert.equal(map.routes.length, 2);

  const get = map.routes.find(route => route.method === 'GET');
  assert.equal(get.path_template, '/api/v1/projects/:projectId');
  assert.deepEqual(get.mount_chain.map(mount => mount.prefix), ['/api', '/v1']);
  assert.match(byText(map, get.middleware_ids[0]), /session/u);
  assert.match(byText(map, get.middleware_ids[1]), /authorize/u);
  assert.match(byText(map, get.middleware_ids[2]), /validate/u);
  assert.match(byText(map, get.terminal_handler_ids[0]), /listProjects/u);
  assert.deepEqual(get.handler_ids, get.terminal_handler_ids);
  assert.equal(get.ambiguity, null);
  assert.ok(get.evidence_ids.every(id => map.source_nodes.some(node => node.id === id)));

  const post = map.routes.find(route => route.method === 'POST');
  assert.equal(post.path_template, '/api/v1/projects');
  assert.match(byText(map, post.terminal_handler_ids[0]), /createProject/u);
});

test('CommonJS route tables resolve mounted routers and controller members', () => {
  const map = compileBackendRoutes({
    'server.js': `const express = require('express'); const routes = require('./routes');
      const app = express(); app.use('/api/projects', routes.projects);`,
    'routes/index.js': `const projects = require('./projects'); module.exports = { projects };`,
    'routes/projects.js': `const express = require('express'); const handlers = require('../handlers');
      const router = express.Router(); router.get('/', handlers.listProjects); module.exports = router;`,
    'handlers.js': `const listProjects = (req, res) => res.json([]); module.exports = { listProjects };`,
  });
  assert.deepEqual(map.diagnostics, []);
  assert.equal(map.routes.length, 1);
  assert.equal(map.routes[0].method, 'GET');
  assert.equal(map.routes[0].path_template, '/api/projects');
  assert.deepEqual(map.routes[0].mount_chain.map(row => row.prefix), ['/api/projects']);
  assert.match(byText(map, map.routes[0].terminal_handler_ids[0]), /listProjects/u);
});

test('factory-created handler members retain a selectable route and separate implementation status', () => {
  const map = compileBackendRoutes({
    'server.js': `const express = require('express'); const projects = require('./projects');
      const app = express(); app.use('/api/projects', projects);`,
    'projects.js': `const express = require('express'); const requireJwtAuth = require('./auth');
      const router = express.Router(); const handlers = createProjectHandlers({ db });
      router.use(requireJwtAuth); router.get('/', handlers.listProjects); module.exports = router;`,
    'auth.js': `module.exports = function requireJwtAuth(req, res, next) { next(); };`,
  });
  assert.equal(map.routes.length, 1);
  const route = map.routes[0];
  assert.equal(route.path_template, '/api/projects');
  assert.match(byText(map, route.middleware_ids[0]), /requireJwtAuth/u);
  assert.equal(byText(map, route.terminal_handler_ids[0]), 'handlers.listProjects');
  assert.equal(route.ambiguity, null);
  assert.equal(route.handler_resolution.status, 'unresolved');
  assert.equal(route.handler_resolution.reason, 'unresolved_handler_implementation');
  assert.deepEqual(route.handler_resolution.evidence_ids, route.terminal_handler_ids);
  assert.ok(map.diagnostics.some(row => row.code === 'unresolved_handler_implementation'));
});

test('same paths with different methods and routers under different prefixes do not contaminate', () => {
  const map = compileBackendRoutes({
    'server.ts': `import express from 'express'; import users from './users'; import teams from './teams';
      const app = express(); app.use('/users', users); app.use('/teams', teams);`,
    'users.ts': `import { Router } from 'express'; const router = Router();
      function readUser(req, res) {} function writeUser(req, res) {}
      router.get('/:id', readUser); router.post('/:id', writeUser); export default router;`,
    'teams.ts': `import { Router } from 'express'; const router = Router();
      function readTeam(req, res) {} router.get('/:id', readTeam); export default router;`,
  });
  assert.deepEqual(map.routes.map(route => `${route.method} ${route.path_template}`).sort(),
    ['GET /teams/:id', 'GET /users/:id', 'POST /users/:id']);
  const usersGet = map.routes.find(route => route.method === 'GET' && route.path_template.startsWith('/users'));
  const teamsGet = map.routes.find(route => route.method === 'GET' && route.path_template.startsWith('/teams'));
  assert.match(byText(map, usersGet.terminal_handler_ids[0]), /readUser/u);
  assert.doesNotMatch(byText(map, usersGet.terminal_handler_ids[0]), /readTeam/u);
  assert.match(byText(map, teamsGet.terminal_handler_ids[0]), /readTeam/u);
  assert.ok(map.routes.every(route => route.ambiguity === null));
});

test('one router mounted more than once produces distinct occurrence routes', () => {
  const map = compileBackendRoutes({
    'server.ts': `import express from 'express'; import health from './health';
      const app = express(); app.use('/internal', health); app.use('/public', health);`,
    'health.ts': `import { Router } from 'express'; const health = Router();
      health.get('/health', (_req, res) => res.end()); export default health;`,
  });
  assert.deepEqual(map.routes.map(route => route.path_template).sort(), ['/internal/health', '/public/health']);
  assert.notEqual(map.routes[0].id, map.routes[1].id);
  assert.notEqual(map.routes[0].mount_chain[0].source_node_id, map.routes[1].mount_chain[0].source_node_id);
});

test('duplicate method and composed path retain explicit ambiguity', () => {
  const map = compileBackendRoutes({
    'server.ts': `import express from 'express'; const app = express();
      function first(req, res) {} function second(req, res) {}
      app.get('/items/:id', first); app.get('/items/:id', second);`,
  });
  assert.equal(map.routes.length, 2);
  assert.ok(map.routes.every(route => route.ambiguity?.code === 'multiple_matching_registrations'));
  assert.ok(map.routes.every(route => route.ambiguity.competing_route_ids.length === 1));
});

test('dynamic prefixes, unresolved routers, reassignment, and cycles abstain', () => {
  const dynamic = compileBackendRoutes({
    'server.ts': `import express from 'express'; import missingRouter from './middleware';
      const app = express(); const prefix = process.env.PREFIX;
      function handler(req, res) {} app.get(prefix, handler); app.use('/missing', missingRouter);`,
    'middleware.ts': `export default function missingRouter(req, res, next) { next(); }`,
  });
  assert.deepEqual(dynamic.routes, []);
  assert.ok(dynamic.diagnostics.some(row => row.code === 'dynamic_route_path'));
  assert.ok(dynamic.diagnostics.some(row => row.code === 'unresolved_router_identity'));

  const dynamicMount = compileBackendRoutes({
    'server.ts': `import express from 'express'; import api from './api'; const app = express();
      const prefix = process.env.PREFIX; app.use(prefix, api);`,
    'api.ts': `import { Router } from 'express'; const api = Router();
      function h(req, res) {} api.get('/x', h); export default api;`,
  });
  assert.deepEqual(dynamicMount.routes, []);
  assert.ok(dynamicMount.diagnostics.some(row => row.code === 'dynamic_mount_path'));

  const reassigned = compileBackendRoutes({
    'server.ts': `import express from 'express'; const app = express();
      function handler(req, res) {} app.get('/before', handler); app = express(); app.get('/after', handler);`,
  });
  assert.deepEqual(reassigned.routes, []);
  assert.ok(reassigned.diagnostics.some(row => row.code === 'reassigned_router_identity'));

  const cyclic = compileBackendRoutes({
    'server.ts': `import express from 'express'; import a from './a'; const app = express(); app.use('/api', a);`,
    'a.ts': `import { Router } from 'express'; import b from './b'; const a = Router();
      function handler(req, res) {} a.get('/a', handler); a.use('/b', b); export default a;`,
    'b.ts': `import { Router } from 'express'; import a from './a'; const b = Router();
      b.use('/a', a); export default b;`,
  });
  assert.deepEqual(cyclic.routes, []);
  assert.ok(cyclic.diagnostics.some(row => row.code === 'router_mount_cycle'));
});

test('fingerprints and route identities are stable across input enumeration order', () => {
  const a = `import express from 'express'; const app = express(); function h(req, res) {} app.get('/x', h);`;
  const first = compileBackendRoutes({ 'z.ts': '// unrelated', 'app.ts': a });
  const second = compileBackendRoutes({ 'app.ts': a, 'z.ts': '// unrelated' });
  assert.equal(first.fingerprint, second.fingerprint);
  assert.deepEqual(first, second);
});

test('dynamic route handlers and duplicate lexical router names create explicit gaps', () => {
  const dynamic = compileBackendRoutes({
    'server.js': `const express = require('express'); const app = express();
      function makeHandler() { return (_req, res) => res.end(); } function fallback(_req, res) { res.end(); }
      app.get('/same', makeHandler()); app.get('/same', fallback);`,
  });
  assert.equal(dynamic.routes.length, 1);
  assert.equal(dynamic.frontiers.length, 1);
  assert.equal(dynamic.frontiers[0].path_prefix, '/same');

  const duplicate = compileBackendRoutes({
    'server.js': `const express = require('express');
      { const app = express(); app.get('/a', (_req, res) => res.end()); }
      { const app = express(); app.get('/b', (_req, res) => res.end()); }`,
  });
  assert.deepEqual(duplicate.routes, []);
  assert.ok(duplicate.diagnostics.some(row => row.code === 'ambiguous_router_identity'));
});

test('literal path-scoped middleware applies only to matching later routes', () => {
  const map = compileBackendRoutes({
    'server.js': `const express = require('express'); const app = express();
      function auth(req, res, next) { next(); } function privateHandler(req, res) {} function publicHandler(req, res) {}
      app.use('/private', auth); app.get('/private/items', privateHandler); app.get('/public/items', publicHandler);`,
  });
  const privateRoute = map.routes.find(route => route.path_template === '/private/items');
  const publicRoute = map.routes.find(route => route.path_template === '/public/items');
  assert.equal(privateRoute.middleware_ids.length, 1);
  assert.match(byText(map, privateRoute.middleware_ids[0]), /auth/u);
  assert.deepEqual(publicRoute.middleware_ids, []);
});
