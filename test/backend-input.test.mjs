import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { analyzeBackendRoutes } from '../analysis/index.mjs';

test('repository backend analysis is read-only, bounded, and carries a deployment service identity', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'producttrace-backend-'));
  t.after(async () => { await import('node:fs/promises').then(fs => fs.rm(root, { recursive: true, force: true })); });
  await mkdir(path.join(root, 'server'), { recursive: true });
  await writeFile(path.join(root, 'server', 'app.js'), `const express = require('express'); const app = express();
    function list(req, res) { res.json([]); } app.get('/api/items', list);`);
  await writeFile(path.join(root, 'server', 'ignored.test.js'), `throw new Error('must not execute or analyze');`);
  const map = analyzeBackendRoutes({ repository: root, include: ['server'], serviceId: 'catalog-api' });
  assert.equal(map.schema, 'producttrace.backend-route-map.v1');
  assert.equal(map.service_id, 'catalog-api');
  assert.equal(map.input.complete, true);
  assert.deepEqual(map.files.map(file => file.path), ['server/app.js']);
  assert.equal(map.routes[0].service_id, 'catalog-api');
  assert.equal(map.routes[0].path_template, '/api/items');
});

test('backend snapshot validation and input gaps stay explicit', () => {
  assert.throws(() => analyzeBackendRoutes(), /exactly one/u);
  assert.throws(() => analyzeBackendRoutes({ files: {}, repository: '.' }), /exactly one/u);
  assert.throws(() => analyzeBackendRoutes({ files: { '../escape.js': '' } }), /escapes/u);
  const empty = analyzeBackendRoutes({ files: {} });
  assert.equal(empty.input.complete, false);
  assert.ok(empty.diagnostics.some(row => row.code === 'empty_source_input'));
});
