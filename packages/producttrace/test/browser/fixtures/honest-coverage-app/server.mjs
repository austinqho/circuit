// Neutral fixture backend (no product names). It knows nothing about Tracer:
// telemetry is attached only by `node --import producttrace/backend/register`.
// The store is an in-memory Map; each access is wrapped in a client span that
// carries `db.system`, as a database driver's instrumentation would emit.
//   POST /api/notes      one write, nothing further (the plain case)
//   POST /api/sync       one write, then a call to /api/notify on this same
//                        server over a raw socket (a client that no
//                        instrumentation sees, as some SDKs and drivers do):
//                        no trace context is sent and /api/notify starts a new
//                        root trace
//   POST /api/notify     one write
//   POST /api/export     one write, then node:http to EXTERNAL_URL (an
//                        uninstrumented service: a hop with no receiving span)
//   POST /api/batch      one write, then inside one SDK client span (no
//                        destination of its own): a call to the second
//                        process (followed) and a call to EXTERNAL_URL
//   POST /api/seq        one write, a call to the second process, and from
//                        that response's callback a call to EXTERNAL_URL
// ROLE=b (the second, instrumented process): POST /b/work, one write.
//   POST /api/hover-note one write (sent by an uninstrumented script)
//   POST /api/bye        the page's beacon
import http from 'node:http';
import net from 'node:net';
import express from 'express';
import { SpanKind, trace } from '@opentelemetry/api';

const tracer = trace.getTracer('fixture-memory-store');
const store = { notes: [], syncs: [], notifications: [], exports: [], hover_notes: [], ws_writes: [], batches: [], sequences: [] };
const db = (operation, collection, run) => tracer.startActiveSpan(`${operation} ${collection}`, {
  kind: SpanKind.CLIENT, attributes: { 'db.system': 'fixture-memory', 'db.operation.name': operation, 'db.collection.name': collection },
}, span => { try { return run(store[collection]); } finally { span.end(); } });

const external = process.env.EXTERNAL_URL;
const second = process.env.B_URL;
const app = express();
app.use(express.json({ type: () => true }));
if (process.env.ROLE === 'b') {
  store.b_work = [];
  app.post('/b/work', function secondWork(request, response) { db('insert', 'b_work', work => work.push(request.body)); response.json({ ok: true }); });
}
// HTTP/1.1 by hand over a socket: nothing instruments it, so no traceparent is sent.
const rawPost = (port, path, body) => new Promise((resolve, reject) => {
  const socket = net.connect(port, '127.0.0.1', () => socket.end(`POST ${path} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`));
  let reply = ''; socket.on('data', chunk => { reply += chunk; }); socket.on('end', () => resolve(Number(/^HTTP\/1\.1 (\d+)/u.exec(reply)?.[1] ?? 0))); socket.on('error', reject);
});
const post = url => new Promise((resolve, reject) => {
  const outbound = http.request(url, { method: 'POST', headers: { 'content-type': 'application/json' } }, reply => { reply.resume(); reply.on('end', () => resolve(reply.statusCode)); });
  outbound.on('error', reject); outbound.end('{}');
});
app.post('/api/notes', function saveNote(request, response) {
  db('insert', 'notes', notes => notes.push(request.body));
  response.status(201).json({ id: `note-${store.notes.length}` });
});
app.post('/api/sync', async function syncAll(request, response) {
  db('update', 'syncs', syncs => syncs.push(request.body));
  const notified = await rawPost(server.address().port, '/api/notify', '{"reason":"sync"}');
  response.json({ ok: true, notified });
});
app.post('/api/notify', function notify(request, response) {
  db('insert', 'notifications', notifications => notifications.push(request.body));
  response.status(204).end();
});
app.post('/api/export', function exportAll(request, response) {
  db('insert', 'exports', exports => exports.push(request.body));
  const outbound = http.request(external, { method: 'POST', headers: { 'content-type': 'application/json' } }, reply => {
    reply.resume(); reply.on('end', () => response.json({ ok: true, external: reply.statusCode }));
  });
  outbound.on('error', error => response.status(502).json({ error: String(error.message) }));
  outbound.end('{"export":true}');
});
app.post('/api/batch', function batchAll(request, response) {
  db('insert', 'batches', batches => batches.push(request.body));
  tracer.startActiveSpan('sdk batch', { kind: SpanKind.CLIENT, attributes: { 'rpc.system': 'sdk' } }, async span => {
    try { await post(`${second}/b/work`); await post(`${external.replace(/\/hook$/u, '')}/hook-batch`); } finally { span.end(); }
    response.json({ ok: true });
  });
});
app.post('/api/seq', function sequence(request, response) {
  db('insert', 'sequences', sequences => sequences.push(request.body));
  const first = http.request(`${second}/b/work`, { method: 'POST', headers: { 'content-type': 'application/json' } }, reply => {
    reply.resume();
    reply.on('end', () => {
      const then = http.request(`${external.replace(/\/hook$/u, '')}/hook-seq`, { method: 'POST' }, last => { last.resume(); last.on('end', () => response.json({ ok: true })); });
      then.end('{}');
    });
  });
  first.end('{}');
});
app.post('/api/hover-note', function hoverNote(request, response) {
  db('insert', 'hover_notes', notes => notes.push(request.body));
  response.status(201).json({ ok: true });
});
app.post('/api/bye', function bye(request, response) { response.status(204).end(); });
app.post('/api/ws-write', function socketWrite(request, response) {
  db('insert', 'ws_writes', writes => writes.push(request.body));
  response.status(201).json({ ok: true });
});
const server = app.listen(0, '127.0.0.1', () => console.log(`listening ${server.address().port}`));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
