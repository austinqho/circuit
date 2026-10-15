import { createWriteStream } from 'node:fs';
import { once } from 'node:events';
import http from 'node:http';
import { resolve } from 'node:path';
import { openStoreWriter } from './store-writer.mjs';
import { createReceivedTally } from './coverage.mjs';

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

  const server = http.createServer((request, response) => {
    response.setHeader('access-control-allow-origin', '*');
    response.setHeader('access-control-allow-headers', 'content-type');
    if (request.method === 'OPTIONS') {
      response.writeHead(204);
      response.end();
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
