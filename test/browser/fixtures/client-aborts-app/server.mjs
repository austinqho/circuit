// Neutral fixture backend (no product names) for client aborts. It knows
// nothing about Tracer: telemetry is attached only by
// `node --import producttrace/backend/register`. It answers slowly, so the
// page can abort before the response, and it always finishes its own work
// (the front proxy does not forward the browser's abort). The store is an
// in-memory Map; each access is wrapped in a DB-like client span. Every
// answer is logged as one JSON line (`served …`): the server's own truth.
import express from 'express';
import { SpanKind, trace } from '@opentelemetry/api';

const tracer = trace.getTracer('fixture-memory-store');
const store = { items: new Map(['apple', 'apricot', 'banana', 'cherry'].map(name => [name, { name }])), notes: new Map(), reports: new Map([['r1', { total: 3 }]]) };
const db = (operation, collection, run) => tracer.startActiveSpan(`${operation} ${collection}`, {
  kind: SpanKind.CLIENT, attributes: { 'db.system': 'fixture-memory', 'db.operation.name': operation, 'db.collection.name': collection },
}, span => { try { return run(store[collection]); } finally { span.end(); } });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const served = (request, status, extra = {}) => console.log(`served ${JSON.stringify({ method: request.method, url: request.originalUrl, status, ...extra })}`);

const app = express();
app.use(express.json());
// Search: slow, reads.
app.get('/api/search', async function searchItems(request, response) {
  await wait(400);
  const term = String(request.query.q || '');
  const items = db('find', 'items', items => [...items.keys()].filter(name => name.startsWith(term)));
  served(request, 200); response.json({ term, items });
});
// Slow read (plain AbortController, XHR).
app.get('/api/slow', async function slowRead(request, response) {
  await wait(400);
  const count = db('find', 'items', items => items.size);
  served(request, 200); response.json({ case: request.query.case, count });
});
// Headers at once, then the body 800 ms later.
app.get('/api/drip', async function dripBody(request, response) {
  const count = db('find', 'items', items => items.size);
  response.writeHead(200, { 'content-type': 'application/json' }); response.flushHeaders();
  await wait(800);
  served(request, 200); response.end(JSON.stringify({ count }));
});
// Headers and part of the body, then the server drops the connection.
app.get('/api/broken', async function brokenBody(request, response) {
  db('find', 'items', items => items.size);
  response.writeHead(200, { 'content-type': 'text/plain', 'content-length': '200' }); response.write('partial body ');
  await wait(100);
  served(request, 200, { dropped: true }); response.socket.destroy();
});
// Fast read.
app.get('/api/fast', function fastRead(request, response) {
  const count = db('find', 'items', items => items.size);
  served(request, 200); response.json({ case: request.query.case, count });
});
// Slow failure: the server answers 500 after 400 ms.
app.get('/api/fail-slow', async function failSlow(request, response) {
  await wait(400);
  db('find', 'reports', reports => reports.size);
  served(request, 500); response.status(500).json({ error: 'report failed' });
});
// A write that happens at once; the answer comes 500 ms later.
app.post('/api/notes', async function createNote(request, response) {
  const id = `note-${store.notes.size + 1}`;
  db('insert', 'notes', notes => notes.set(id, request.body));
  await wait(500);
  served(request, 201, { id }); response.status(201).json({ id });
});
// A save that answers at once (the app reads only the status).
app.post('/api/save', function saveItem(request, response) {
  const id = `note-${store.notes.size + 1}`;
  db('insert', 'notes', notes => notes.set(id, request.body));
  served(request, 200, { id }); response.json({ ok: true, id });
});
app.get('/api/notes', function listNotes(request, response) {
  const count = db('find', 'notes', notes => notes.size);
  served(request, 200); response.json({ count });
});
// A slow report query (cancelled from the page with queryClient.cancelQueries).
app.get('/api/report', async function loadReport(request, response) {
  await wait(600);
  const report = db('find', 'reports', reports => reports.get('r1'));
  served(request, 200); response.json(report);
});
const server = app.listen(0, '127.0.0.1', () => console.log(`listening ${server.address().port}`));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
