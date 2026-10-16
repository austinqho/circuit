import { createWriteStream } from 'node:fs';
import { once } from 'node:events';
import http from 'node:http';
import { resolve } from 'node:path';
import { openStoreWriter } from './store-writer.mjs';
import { createReceivedTally } from './coverage.mjs';
import { createStoryFeed } from './story.mjs';

export function createCollector(options = {}) {
  const host = options.host || '127.0.0.1';
  // `port: 0` means "any free port" — it must not fall through to the default.
  const port = Number(options.port ?? 8787);
  // Store mode (G6): append records and spans into a Tracer store directory
  // through the one store writer, tagged with this run and its build.
  const store = options.store ? openStoreWriter(options.store.dir, options.store) : null;
  const outputPath = store ? resolve(store.dir, 'records.jsonl') : resolve(options.outputPath || 'producttrace-evidence.jsonl');
  const sink = store ? null : createWriteStream(outputPath, { flags: 'a' });
  // Store mode: the run row's `source` / `steps` / `extra` (e.g. from a test
  // harness: fixture commit, clean flag, step windows), set by POST /run-info
  // (JSON object, merged; later posts override) and written when the run closes.
  // Like /ingest it accepts any origin (access-control-allow-origin: *): any
  // page the developer visits could overwrite these fields. The listener binds
  // loopback only, so the risk is low; a token or Origin check would close it.
  // /ingest has the same exposure: any such page can add rows to the store.
  const runInfo = {};
  let received = 0;
  let spansReceived = 0;
  let errors = 0;
  // Coverage (capture.received): per page, what this collector actually
  // received, appended as one row per page when the run closes.
  const tally = createReceivedTally();
  // Store mode: the session story, as JSON (GET /story) and as a live
  // server-sent event stream (GET /story/stream). See collector/story.mjs.
  const story = store ? createStoryFeed({ dir: store.dir, sourceRoot: options.store.sourceRoot ?? null }) : null;
  const streams = new Set();

  const server = http.createServer((request, response) => {
    response.setHeader('access-control-allow-origin', '*');
    response.setHeader('access-control-allow-headers', 'content-type');
    if (request.method === 'OPTIONS') {
      response.writeHead(204);
      response.end();
      return;
    }
    if (story && request.method === 'GET' && (request.url === '/story' || request.url.startsWith('/story?') || request.url.startsWith('/story/stream'))) {
      // Reads expose every session's paths, IDs and labels: only pages served
      // from this machine may read them cross-origin (the write routes stay open).
      response.removeHeader('access-control-allow-origin');
      const origin = request.headers.origin;
      if (origin && /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/u.test(origin)) { response.setHeader('access-control-allow-origin', origin); response.setHeader('vary', 'origin'); }
      const url = new URL(request.url, 'http://collector.invalid');
      const session = url.searchParams.get('session') || undefined;
      if (url.pathname === '/story') {
        story({ session }).then(value => {
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end(JSON.stringify(value));
        }, error => { errors += 1; response.writeHead(500); response.end(String(error.message || error)); });
        return;
      }
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      const client = { response, session, sent: new Map() };
      streams.add(client);
      request.on('close', () => streams.delete(client));
      pushStory(client, true);
      return;
    }
    if (store && request.method === 'POST' && request.url === '/run-info') {
      let body = '';
      request.setEncoding('utf8');
      request.on('data', (chunk) => { body += chunk; });
      request.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('run-info must be a JSON object');
          for (const key of Object.keys(parsed)) if (!['source', 'steps', 'extra'].includes(key)) throw new Error(`run-info: unknown key ${key}`);
          if (parsed.steps !== undefined && !Array.isArray(parsed.steps)) throw new Error('run-info: steps must be an array');
          Object.assign(runInfo, parsed);
          response.writeHead(200);
          response.end('ok');
        } catch (error) {
          errors += 1;
          response.writeHead(400);
          response.end(String(error.message || error));
        }
      });
      return;
    }
    if (request.method === 'POST' && (request.url === '/ingest' || (store && request.url === '/spans'))) {
      let body = '';
      request.setEncoding('utf8');
      request.on('data', (chunk) => { body += chunk; });
      request.on('end', () => {
        try {
          let parsed;
          try { parsed = JSON.parse(body); } catch (error) { if (request.url === '/ingest') tally.unparsed(); throw error; }
          const records = Array.isArray(parsed) ? parsed : [parsed];
          if (request.url === '/ingest') tally.add(records);
          if (store && request.url === '/spans') spansReceived += store.appendSpans(records);
          else if (store) received += store.appendRecords(records);
          else {
            for (const record of records) {
              sink.write(`${JSON.stringify(record)}\n`);
            }
            received += records.length;
          }
          response.writeHead(200);
          response.end('ok');
        } catch (error) {
          errors += 1;
          response.writeHead(400);
          response.end(String(error));
        }
      });
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ received, errors, file: outputPath, ...(store ? { store: store.dir, run_id: store.run_id, build: store.build, spans: spansReceived } : {}) }));
  });

  // Each stream gets every line once (event: line) and again when it changes
  // (typing in one field grows one line); `sessions` carries the session list.
  async function pushStory(client, first = false) {
    let value;
    try { value = await story({ session: client.session }); } catch { return; }
    if (first) client.response.write(`event: sessions\ndata: ${JSON.stringify(value.sessions)}\n\n`);
    let changed = false;
    for (const line of value.lines) {
      const text = JSON.stringify(line);
      if (client.sent.get(line.id) === text) continue;
      client.sent.set(line.id, text); changed = true;
      client.response.write(`event: line\ndata: ${text}\n\n`);
    }
    if (changed && !first) client.response.write(`event: sessions\ndata: ${JSON.stringify(value.sessions)}\n\n`);
  }
  const ticker = story ? setInterval(() => { for (const client of streams) pushStory(client); }, 500) : null;
  ticker?.unref?.();

  server.listen(port, host);

  return {
    get url() {
      const address = server.address();
      const activePort = address && typeof address === 'object' ? address.port : port;
      return `http://${host}:${activePort}`;
    },
    outputPath,
    store: store ? { dir: store.dir, run_id: store.run_id, build: store.build } : null,
    ready: once(server, 'listening'),
    status() { return { received, errors, file: outputPath, ...(store ? { spans: spansReceived, run_id: store.run_id, build: store.build } : {}) }; },
    async close() {
      if (ticker) clearInterval(ticker);
      for (const client of streams) client.response.end();
      streams.clear();
      if (server.listening) {
        server.close();
        await once(server, 'close');
      }
      const receivedRows = tally.rows({ runId: store ? store.run_id : null });
      if (store) { if (receivedRows.length) store.appendRecords(receivedRows); store.close({ steps: runInfo.steps ?? [], extra: runInfo.extra ?? {}, ...(runInfo.source !== undefined ? { source: runInfo.source } : {}) }); return; }
      for (const row of receivedRows) sink.write(`${JSON.stringify(row)}\n`);
      sink.end();
      await once(sink, 'close');
    },
  };
}
export { createStoryFeed } from './story.mjs';
