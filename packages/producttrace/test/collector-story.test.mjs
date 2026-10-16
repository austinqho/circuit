import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCollector } from '../collector.js';

const page = 's_http';
let sequence = 0;
const row = extra => ({ schema: 'producttrace.runtime-evidence.v1', sequence: ++sequence, timestamp: 1_000 + sequence, capture_page_id: page, ...extra });
const click = (id, label) => row({ kind: 'dom.action', action_id: id, event: 'click', continuation_id: `c:${id}`, page: '/app', target: { tag: 'button', attributes: {}, element_key: `k_${id}`, label } });
const enter = id => row({ kind: 'function.enter', action_id: id, function_id: `fn:${id}`, continuation_id: `f:${id}`, parent_continuation_id: `c:${id}`, invoked_by: 'event', spine: { action_id: id, function_ids: [`fn:${id}`] } });
const request = (id, method, url) => row({ kind: 'network.request', action_id: id, request_occurrence_id: `${id}:request:1`, method, url, parent_continuation_id: `f:${id}`,
  terminal_owner_continuation_id: `f:${id}`, trace_context: { trace_id: `t${id}`, span_id: `s${id}` } });

async function post(base, rows) {
  const response = await fetch(`${base}/ingest`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(rows) });
  assert.equal(response.status, 200);
}

/** Reads server-sent events until `until(events)` holds. */
async function readEvents(url, until, { timeoutMs = 5000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const response = await fetch(url, { signal: controller.signal });
  assert.equal(response.headers.get('content-type'), 'text/event-stream');
  const events = []; let buffer = '';
  try {
    for await (const chunk of response.body) {
      buffer += Buffer.from(chunk).toString('utf8');
      let end;
      while ((end = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        const name = /^event: (.*)$/mu.exec(block)?.[1]; const data = /^data: (.*)$/mu.exec(block)?.[1];
        events.push({ event: name, data: data ? JSON.parse(data) : null });
      }
      if (until(events)) break;
    }
  } finally { clearTimeout(timer); controller.abort(); }
  return events;
}

test('the collector serves the story as JSON and as a live stream, readable only by local pages', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'producttrace-story-'));
  const collector = createCollector({ port: 0, store: { dir } });
  t.after(async () => { await collector.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  await collector.ready;
  const base = collector.url;

  await post(base, [click('a1', 'Save'), enter('a1'), request('a1', 'PATCH', 'https://api.example.com/projects/p_81Kx92aa')]);
  const local = await fetch(`${base}/story`, { headers: { origin: 'http://localhost:4500' } });
  assert.equal(local.headers.get('access-control-allow-origin'), 'http://localhost:4500');
  const story = await local.json();
  assert.equal(story.schema, 'producttrace.story.v1');
  assert.deepEqual(story.sessions.map(entry => entry.session), [page]);
  assert.equal(story.lines.length, 1);
  assert.match(story.lines[0].text, /^Clicked the “Save” button → .*PATCH \/projects\/p_81Kx92aa/u);
  assert.deepEqual(story.lines[0].entities, [{ type: 'project', id: 'p_81Kx92aa', from: 'request_url' }]);
  assert.deepEqual(story.segments.map(segment => segment.lines), [['a1']]);
  assert.equal(story.segments[0].title, 'Edited project p_81Kx92aa.');

  const foreign = await fetch(`${base}/story`, { headers: { origin: 'https://example.com' } });
  assert.equal(foreign.headers.get('access-control-allow-origin'), null);
  await foreign.arrayBuffer();

  // The stream sends what exists, then each new line as the store grows.
  const streamed = readEvents(`${base}/story/stream`, events => events.filter(entry => entry.event === 'segment').length >= 2);
  await new Promise(resolve => setTimeout(resolve, 200));
  await post(base, [click('a2', 'Delete'), enter('a2'), request('a2', 'DELETE', 'https://api.example.com/projects/p_81Kx92aa')]);
  const events = await streamed;
  assert.equal(events[0].event, 'sessions');
  const lines = events.filter(entry => entry.event === 'line').map(entry => entry.data);
  assert.deepEqual(lines.map(line => line.id), ['a1', 'a2']);
  assert.match(lines[1].text, /^Clicked the “Delete” button → .*DELETE \/projects\/p_81Kx92aa/u);
  // Segments follow their lines; the open segment is re-sent as it grows (both lines name project p_81Kx92aa).
  const segments = events.filter(entry => entry.event === 'segment').map(entry => entry.data);
  assert.deepEqual(segments.map(segment => [segment.id, segment.lines]), [['seg:a1', ['a1']], ['seg:a1', ['a1', 'a2']]]);
  assert.ok(events.findIndex(entry => entry.event === 'segment') > events.findIndex(entry => entry.event === 'line'));
});

test('the store follows a manifest file that appears and grows after the collector starts', async (t) => {
  const { openStoreWriter } = await import('../collector/store-writer.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'producttrace-follow-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const manifestFile = path.join(dir, 'runtime-attribution-manifest.json');
  const writer = openStoreWriter(path.join(dir, 'store'), { manifestFile });
  assert.equal(writer.build, 'unknown');
  const write = ids => fs.writeFileSync(manifestFile, JSON.stringify({ schema: 'producttrace.runtime-attribution-manifest.v1', build: null, functions: ids.map((id, index) => ({ index, id })) }));
  write(['function:a']);
  writer.appendRecords([{ kind: 'dom.action' }]);
  const first = writer.build;
  assert.notEqual(first, 'unknown');
  await new Promise(resolve => setTimeout(resolve, 20));
  write(['function:a', 'function:b']);
  writer.appendRecords([{ kind: 'dom.action' }]);
  assert.notEqual(writer.build, first);
  const builds = fs.readFileSync(path.join(dir, 'store', 'records.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line).tracer_build);
  assert.deepEqual(builds, [first, writer.build]);
  assert.equal(fs.readdirSync(path.join(dir, 'store', 'manifests')).length, 2);
});
