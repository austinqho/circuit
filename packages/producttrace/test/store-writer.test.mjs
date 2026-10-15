// G6: the append-only, multi-build `.tracer/` store and its two writers (the
// fresh-repo harness via openStoreWriter, and producttrace-collector --store).
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { buildIdOf, openStoreWriter } from '../collector/store-writer.mjs';
import { loadStore } from '../collector/store.mjs';
import { callTool } from '../mcp/tools.mjs';

const root = path.resolve(import.meta.dirname, '..');
const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'producttrace-store-'));
const fn = (hash, start, end, file = 'src/a.jsx') => ({ id: `function:${hash.repeat(64)}:${start}:${end}`, index: start, kind: 'function', source: { file, start, end }, generated: { file: '/tmp/x.js', start: 1, end: 2 } });
const manifestA = { schema: 'producttrace.runtime-attribution-manifest.v1', functions: [fn('a', 0, 50), fn('a', 10, 20)] };
const manifestB = { schema: 'producttrace.runtime-attribution-manifest.v1', functions: [fn('b', 0, 54), fn('b', 10, 24)] };
const action = (id, page, timestamp) => ({ schema: 'producttrace.runtime-evidence.v1', kind: 'dom.action', action_id: id, event: 'click', sequence: 1, timestamp, capture_page_id: page, target: { tag: 'button', attributes: {} } });

test('build id is deterministic over the function-id set and ignores order and generated paths', () => {
  const reordered = { ...manifestA, functions: [...manifestA.functions].reverse().map(row => ({ ...row, generated: null })) };
  assert.equal(buildIdOf(manifestA), buildIdOf(reordered));
  assert.match(buildIdOf(manifestA), /^b-[0-9a-f]{16}$/u);
  assert.notEqual(buildIdOf(manifestA), buildIdOf(manifestB));
  assert.equal(buildIdOf({ build: 'b-explicit', functions: [] }), 'b-explicit');
});

test('two runs of two builds append into one store that loadStore reads with both manifests and the action → build map', async () => {
  const dir = tempDir();
  try {
    const first = openStoreWriter(dir, { manifest: manifestA, label: 'A', source: { commit: 'c1' } });
    first.appendRecords([action('action:x:1', 'p1', 1000)]);
    first.appendSpans([{ schema: 'producttrace.backend-span.v1', trace_id: 't', span_id: 's1', kind: 'server', attributes: {} }]);
    const runA = first.close({ steps: [{ step: 1, name: 'one', started: 900, ended: 1100, status: 'done' }] });
    const second = openStoreWriter(dir, { manifest: manifestB, label: 'D' });
    second.appendRecords([action('action:y:1', 'p2', 2000)]);
    second.close();
    // Same build again: the manifest is reused, not rewritten.
    const third = openStoreWriter(dir, { manifest: manifestA, label: 'C' });
    third.appendRecords([action('action:z:1', 'p3', 3000)]);
    third.close();

    assert.deepEqual(fs.readdirSync(path.join(dir, 'manifests')).sort(), [`${buildIdOf(manifestA)}.json`, `${buildIdOf(manifestB)}.json`].sort());
    const stored = JSON.parse(fs.readFileSync(path.join(dir, 'manifests', `${buildIdOf(manifestA)}.json`), 'utf8'));
    assert.equal(stored.build, buildIdOf(manifestA)); assert.ok(stored.functions.every(row => !('generated' in row) && !('index' in row)));
    const records = fs.readFileSync(path.join(dir, 'records.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert.deepEqual(records.map(row => [row.action_id, row.tracer_build]), [['action:x:1', buildIdOf(manifestA)], ['action:y:1', buildIdOf(manifestB)], ['action:z:1', buildIdOf(manifestA)]]);
    assert.equal(records[0].tracer_run, runA.run_id);
    const runs = fs.readFileSync(path.join(dir, 'runs.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert.deepEqual(runs.map(row => [row.label, row.records, row.build]), [['A', 1, buildIdOf(manifestA)], ['D', 1, buildIdOf(manifestB)], ['C', 1, buildIdOf(manifestA)]]);
    assert.equal(runs[0].spans, 1); assert.equal(runs[0].schema, 'producttrace.store-run.v1');

    const store = await loadStore({ dir });
    assert.deepEqual([...store.manifestsByBuild.keys()].sort(), [buildIdOf(manifestA), buildIdOf(manifestB)].sort());
    assert.equal(store.buildByAction.get('action:y:1'), buildIdOf(manifestB));
    assert.equal(store.stats().manifest_functions, 4); assert.equal(store.stats().runs, 3);
    assert.equal(store.manifestSource(manifestB.functions[1].id).end, 24);
    assert.equal(callTool(store, 'recent_actions', {}).actions.length, 3);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a different manifest under an existing build id is refused', () => {
  const dir = tempDir();
  try {
    openStoreWriter(dir, { manifest: { build: 'b-fixed', functions: [fn('a', 0, 5)] } }).close();
    assert.throws(() => openStoreWriter(dir, { manifest: { build: 'b-fixed', functions: [fn('c', 0, 5)] } }), /refusing to overwrite/u);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('producttrace-collector --store ingests records and spans into a store the MCP can load', async () => {
  const dir = tempDir();
  const manifestFile = path.join(dir, 'm.json'); fs.writeFileSync(manifestFile, JSON.stringify(manifestA));
  const store = path.join(dir, '.tracer');
  const child = spawn(process.execPath, [path.join(root, 'collector/cli.mjs'), '--store', store, '--manifest', manifestFile, '--label', 'cli', '--port', '0'], { stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    const url = await new Promise((resolve, reject) => {
      let out = ''; child.stdout.on('data', chunk => { out += chunk; const match = /collector: (http:\/\/[^/\s]+)\/ingest/u.exec(out); if (match && out.includes('store:')) resolve(match[1]); });
      child.once('exit', code => reject(new Error(`collector exited ${code}`)));
    });
    const post = (route, body) => fetch(`${url}${route}`, { method: 'POST', body: JSON.stringify(body) }).then(response => response.status);
    assert.equal(await post('/ingest', [action('action:q:1', 'p9', 5000)]), 200);
    assert.equal(await post('/spans', { schema: 'producttrace.backend-span.v1', trace_id: 't', span_id: 's9', kind: 'server', attributes: {} }), 200);
    const exited = new Promise(resolve => child.once('exit', resolve));
    child.kill('SIGTERM'); await exited;
    const loaded = await loadStore({ dir: store });
    assert.equal(loaded.records.length, 2); assert.equal(loaded.spans.length, 1);
    assert.deepEqual(loaded.records.map(row => row.kind), ['dom.action', 'capture.received'], 'the run close appends one capture.received row per page');
    assert.equal(loaded.records[1].page_id, 'p9'); assert.equal(loaded.records[1].run_id, loaded.runs[0].run_id);
    assert.equal(loaded.records[0].tracer_build, buildIdOf(manifestA));
    assert.equal(loaded.runs.length, 1); assert.equal(loaded.runs[0].label, 'cli'); assert.equal(loaded.runs[0].spans, 1);
  } finally { child.kill('SIGKILL'); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('with sourceRoot, stored manifest rows carry text_sha256 and name when the checkout matches the build', async () => {
  const { createHash } = await import('node:crypto');
  const dir = tempDir();
  try {
    const repo = path.join(dir, 'repo'); fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
    const content = 'const onSave = (e) => { e.preventDefault(); };\n';
    fs.writeFileSync(path.join(repo, 'src', 'a.jsx'), content);
    const hash = createHash('sha256').update(content).digest('hex');
    const start = content.indexOf('(e)'); const end = content.indexOf(';\n');
    const manifest = { functions: [{ id: `function:${hash}:${start}:${end}`, index: 0, kind: 'function', source: { file: 'src/a.jsx', start, end } }, fn('9', 0, 5)] };
    const writer = openStoreWriter(path.join(dir, '.tracer'), { manifest, sourceRoot: repo }); writer.close();
    const stored = JSON.parse(fs.readFileSync(path.join(dir, '.tracer', 'manifests', `${writer.build}.json`), 'utf8'));
    assert.equal(stored.functions[0].name, 'onSave'); assert.match(stored.functions[0].text_sha256, /^[0-9a-f]{64}$/u);
    assert.ok(!('name' in stored.functions[1]), 'a row whose file hash does not match is not enriched');
    assert.deepEqual(stored.enrichment, { rows: 2, enriched: 1 });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('loadStore rejects two manifest files with the same build key, and a build field that does not match its file name', async () => {
  const dir = tempDir();
  try {
    openStoreWriter(dir, { manifest: { build: 'b-one', functions: [fn('a', 0, 5)] } }).appendRecords([action('action:k:1', 'p1', 1)]);
    fs.writeFileSync(path.join(dir, 'manifests', 'b-copy.json'), JSON.stringify({ build: 'b-one', functions: [fn('c', 0, 5)] }));
    await assert.rejects(loadStore({ dir }), error => error.code === 'MANIFEST_INVALID' && /declares build b-one/u.test(error.message));
    fs.rmSync(path.join(dir, 'manifests', 'b-copy.json'));
    fs.writeFileSync(path.join(dir, 'manifests', 'b-zz.json'), JSON.stringify({ functions: [fn('c', 0, 5)] }));
    fs.writeFileSync(path.join(dir, 'manifests', 'b-one.json.bak.json'), JSON.stringify({ build: 'b-one', functions: [] }));
    await assert.rejects(loadStore({ dir }), error => error.code === 'MANIFEST_INVALID');
    fs.rmSync(path.join(dir, 'manifests', 'b-one.json.bak.json'));
    const store = await loadStore({ dir });
    assert.deepEqual([...store.manifestsByBuild.keys()].sort(), ['b-one', 'b-zz']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the MCP server reports a store that fails manifest validation as invalid_store with the exact loader error', async () => {
  const { createTracerServer } = await import('../mcp/server.mjs');
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
  const dir = tempDir();
  try {
    openStoreWriter(dir, { manifest: { build: 'b-one', functions: [fn('a', 0, 5)] } }).appendRecords([action('action:k:1', 'p1', 1)]);
    fs.writeFileSync(path.join(dir, 'manifests', 'b-copy.json'), JSON.stringify({ build: 'b-one', functions: [] }));
    const server = createTracerServer({ dir });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    const client = new Client({ name: 't', version: '0' }); await client.connect(clientSide);
    const reply = (await client.callTool({ name: 'recent_actions', arguments: {} })).structuredContent;
    assert.equal(reply.status, 'invalid_store');
    assert.equal(reply.error, 'manifest b-copy.json declares build b-one, which does not match its file name');
    assert.equal(reply.summary, 'invalid_store: manifest b-copy.json declares build b-one, which does not match its file name');
    await client.close();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
