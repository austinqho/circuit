import assert from 'node:assert/strict';
import { access, readFile, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { createCollector } from '../collector/index.js';

test('install allowlist excludes source, build tooling, and developer tests', async () => {
  const packageRoot = resolve(import.meta.dirname, '..');
  const manifest = JSON.parse(await readFile(resolve(packageRoot, 'package.json'), 'utf8'));
  assert.deepEqual(manifest.files, [
    'analysis', 'backend', 'collector', 'dist', 'integrations', 'mcp', 'plugin', '.agents',
    'index.js', 'index.d.ts', 'vite.mjs', 'vite.d.mts', 'collector.js', 'collector.d.ts', 'backend.js', 'backend.d.ts',
    'backend-register.js', 'analysis.mjs', 'analysis.d.mts', 'runtime-attribution.mjs', 'runtime-attribution.d.mts',
    'mcp.mjs', 'mcp-annotation-lookup.mjs', 'observe', 'observe.mjs', 'observe.d.mts', 'listen', 'listen.mjs', 'listen.d.mts', 'LICENSE', 'README.md',
  ]);
  assert.equal(manifest.files.some((entry) => /^(src|scripts|test)(\/|$)/.test(entry)), false);

  const shippedEntrypoints = [
    manifest.main,
    manifest.browser,
    manifest.types,
    manifest.bin['producttrace-collector'],
    manifest.exports['./collector'].import,
    manifest.exports['./collector'].types,
    manifest.exports['./analysis'].import,
    manifest.exports['./analysis'].types,
    manifest.exports['./backend'].import,
    manifest.exports['./backend'].types,
    manifest.exports['./vite'].import,
    manifest.exports['./vite'].types,
    manifest.exports['./runtime-attribution'].import,
    manifest.exports['./runtime-attribution'].types,
    manifest.bin['producttrace-mcp'],
    manifest.exports['./mcp'].import,
    manifest.exports['./observe'].import,
    manifest.exports['./observe'].types,
    manifest.exports['./listen'].import,
    manifest.exports['./listen'].types,
  ];
  await Promise.all(shippedEntrypoints.map((entry) => access(resolve(packageRoot, entry))));
});

// Each entry point is a deliberate interface. Adding a name here is a public API
// change; internals belong in the package's subfolders.
test('entry points expose exactly their intended names', async () => {
  const expected = {
    'vite.mjs': ['productTraceVitePlugin', 'producttrace', 'runtimeAttributionPlugin'],
    'analysis.mjs': ['analyzeBackendRoutes', 'analyzeReact', 'confirmBackendExecution', 'connectRequestToHandler', 'createReactRuntimeIntegration', 'matchRequestToRoute'],
    'runtime-attribution.mjs': ['runtimeAttributionPlugin'],
    'backend.js': ['BACKEND_SPAN_SCHEMA', 'NODE_BACKEND_ADAPTERS', 'createProductTraceSpanExporter', 'normalizeOpenTelemetrySpan', 'startNodeBackendTelemetry'],
    'mcp.mjs': ['createTracerServer', 'main'],
    'mcp-annotation-lookup.mjs': ['lookupSnippet'],
    'observe.mjs': ['observePage'],
    'listen.mjs': ['fingerprintSource', 'listenScript'],
  };
  const packageRoot = resolve(import.meta.dirname, '..');
  for (const [file, names] of Object.entries(expected)) {
    const module = await import(resolve(packageRoot, file));
    assert.deepEqual(Object.keys(module).sort(), names, file);
  }
});

test('packaged attribution runtime is byte-identical to its source', async () => {
  const packageRoot = resolve(import.meta.dirname, '..');
  const [canonical, packaged] = await Promise.all([
    readFile(resolve(packageRoot, 'src/runtime-attribution-browser.js')),
    readFile(resolve(packageRoot, 'dist/runtime-attribution-browser.js')),
  ]);
  assert.deepEqual(packaged, canonical);
});

test('packaged IIFE is byte-identical to the canonical runtime', async () => {
  const packageRoot = resolve(import.meta.dirname, '..');
  const [canonical, packaged] = await Promise.all([
    readFile(resolve(packageRoot, 'src/producttrace-runtime.js')),
    readFile(resolve(packageRoot, 'dist/producttrace-runtime.js')),
  ]);
  assert.deepEqual(packaged, canonical);
});

test('collector appends JSONL and exposes counts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'producttrace-collector-'));
  const outputPath = join(directory, 'records.jsonl');
  await writeFile(outputPath, '');
  const collector = createCollector({ port: 0, outputPath });
  await collector.ready;
  const response = await fetch(`${collector.url}/ingest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify([
      { kind: 'action', action: 'message.copy', step_id: 'message-1' },
      { kind: 'route', trajectory_id: 'conversation-1' },
    ]),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(collector.status(), {
    received: 2,
    errors: 0,
    file: outputPath,
  });
  await collector.close();
  const written = (await readFile(outputPath, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.equal(written.length, 3);
  // At close the collector appends one capture.received row per page (coverage).
  assert.equal(written[2].kind, 'capture.received');
  assert.equal(written[2].page_id, 'default');
  assert.equal(written[2].rows_received, 2);
});
