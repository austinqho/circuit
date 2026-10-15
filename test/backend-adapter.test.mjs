import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { normalizeOpenTelemetrySpan } from '../backend/index.js';

function databaseReadableSpan() {
  return {
    name: 'mongodb.find', kind: 2, status: { code: 0 },
    attributes: {
      'db.system': 'mongodb', 'db.operation': 'find', 'db.name': 'LibreChat',
      'db.mongodb.collection': 'chatprojects', 'db.statement': '{"user":"private"}',
      'db.connection_string': 'mongodb://user:password@database.example/LibreChat',
      'db.operation.parameter.0': 'private', 'producttrace.db.result': '[{"private":true}]',
    },
    startTime: [1, 0], endTime: [1, 1],
    instrumentationScope: { name: '@opentelemetry/instrumentation-mongodb', version: '0.60.0' },
    spanContext: () => ({ traceId: '12345678901234567890123456789012', spanId: 'aaaaaaaaaaaaaaaa' }),
  };
}

test('Node and Express adapters retain an incoming trace and exact handler invocation', () => {
  const output = execFileSync(process.execPath, ['test/fixtures/backend/express-runtime.mjs'], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
    timeout: 20_000,
  });
  const spans = JSON.parse(output);
  assert.ok(spans.length >= 3, JSON.stringify(spans));
  assert.ok(spans.every(span => span.schema === 'producttrace.backend-span.v1'
    && span.source === 'opentelemetry' && span.service_name === 'fixture-api'));
  const server = spans.find(span => span.kind === 'server');
  assert.equal(server.trace_id, '12345678901234567890123456789012');
  assert.equal(server.parent_span_id, '1234567890123456');
  assert.equal(server.attributes['http.request.method'] || server.attributes['http.method'], 'GET');
  assert.equal(server.attributes['http.route'], '/api/projects');
  const handler = spans.find(span => span.instrumentation?.name === 'producttrace-express-handlers'
    && span.attributes['producttrace.express.handler.name'] === 'listProjects');
  assert.ok(handler, JSON.stringify(spans, null, 2));
  assert.equal(handler.trace_id, server.trace_id);
  assert.equal(handler.attributes['http.route'], '/api/projects');
  assert.equal(handler.attributes['producttrace.express.handler.method'], 'GET');
});

test('database spans retain operation identity while private content stays opt-in', () => {
  const safe = normalizeOpenTelemetrySpan(databaseReadableSpan(), { serviceName: 'fixture-api' });
  assert.deepEqual(safe.attributes, {
    'db.system': 'mongodb', 'db.operation': 'find', 'db.name': 'LibreChat',
    'db.mongodb.collection': 'chatprojects',
  });

  const content = normalizeOpenTelemetrySpan(databaseReadableSpan(), {
    serviceName: 'fixture-api', captureContent: true,
  });
  assert.equal(content.attributes['db.statement'], '{"user":"private"}');
  assert.equal(content.attributes['db.operation.parameter.0'], 'private');
  assert.equal(content.attributes['producttrace.db.result'], '[{"private":true}]');
  assert.ok(!('db.connection_string' in content.attributes));
});

test('handler instrumentation patches Express 4 (express.Route) as well as Express 5 (Router.Route)', async () => {
  const { ProductTraceExpressHandlerInstrumentation } = await import('../backend/express-handler-instrumentation.js');
  for (const shape of ['express4', 'express5']) {
    class Route { constructor(path) { this.path = path; this.stack = []; } get(...handlers) { this.stack.push(...handlers.flat(Infinity)); return this; } }
    const exportsShape = shape === 'express4' ? { Route, Router: function Router() {} } : { Router: Object.assign(function Router() {}, { Route }) };
    const instrumentation = new ProductTraceExpressHandlerInstrumentation();
    instrumentation.disable();
    const [definition] = [instrumentation.init()].flat();
    definition.patch(exportsShape, shape === 'express4' ? '4.22.1' : '5.2.1');
    function listWorkspaces() {}
    const route = new Route('/api/workspaces');
    route.get([function validate(_request, _response, next) { next(); }], listWorkspaces);
    assert.equal(route.stack.length, 2, shape);
    assert.ok(route.stack.every(handler => handler.__productTraceExpressHandler === true), shape);
    assert.equal(route.stack[1].name, 'listWorkspaces', shape);
  }
});

test('handler index is the position in the flattened stack, unique for array-registered middleware', () => {
  const output = execFileSync(process.execPath, ['test/fixtures/backend/express-array-runtime.mjs'], {
    cwd: new URL('..', import.meta.url), encoding: 'utf8',
  });
  const handlers = JSON.parse(output).filter(span => span.instrumentation?.name === 'producttrace-express-handlers')
    .map(span => [span.attributes['producttrace.express.handler.name'], span.attributes['producttrace.express.handler.index'], span.attributes['http.route']]);
  assert.deepEqual(handlers, [
    ['validatedRequest', 0, '/api/workspace/:slug/thread/new'],
    ['roleValid', 1, '/api/workspace/:slug/thread/new'],
    ['validSlug', 2, '/api/workspace/:slug/thread/new'],
    ['createThread', 3, '/api/workspace/:slug/thread/new'],
  ]);
  assert.equal(new Set(handlers.map(([, index]) => index)).size, handlers.length);
});
