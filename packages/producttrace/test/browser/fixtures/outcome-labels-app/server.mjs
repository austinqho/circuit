// Neutral fixture backend (no product names). It knows nothing about Tracer:
// telemetry is attached only by `node --import producttrace/backend/register`.
// The store is an in-memory Map; each access is wrapped in a client span that
// carries `db.system` (a DB-like effect span), exactly what a database driver's
// instrumentation would emit.
import express from 'express';
import { SpanKind, trace } from '@opentelemetry/api';

const tracer = trace.getTracer('fixture-memory-store');
const store = { items: new Map(), seats: new Map([['A', 'taken']]) };
const db = (operation, collection, run) => tracer.startActiveSpan(`${operation} ${collection}`, {
  kind: SpanKind.CLIENT, attributes: { 'db.system': 'fixture-memory', 'db.operation.name': operation, 'db.collection.name': collection },
}, span => { try { return run(store[collection]); } finally { span.end(); } });

const app = express();
app.use(express.json());
app.post('/api/items', function createItem(request, response) {
  const id = `item-${store.items.size + 1}`;
  db('insert', 'items', items => items.set(id, request.body));
  response.status(201).json({ id });
});
app.get('/api/ping', function ping(request, response) { response.json({ ok: true }); });
app.post('/api/seats/:seat/claim', function claimSeat(request, response) {
  const holder = db('find', 'seats', seats => seats.get(request.params.seat));
  if (holder) { response.status(409).json({ error: 'seat already taken' }); return; }
  db('update', 'seats', seats => seats.set(request.params.seat, 'taken'));
  response.json({ ok: true });
});
app.post('/api/lookup', function lookupSeat(request, response) {
  response.json({ holder: db('find', 'seats', seats => seats.get(request.body?.seat)) ?? null });
});
app.get('/api/seats', function listSeats(request, response) { response.json(db('find', 'seats', seats => [...seats.keys()])); });
app.post('/api/slow-items', async function createSlowItem(request, response) {
  const id = `item-${store.items.size + 1}`;
  db('insert', 'items', items => items.set(id, request.body));
  await new Promise(resolve => setTimeout(resolve, 400));
  response.status(201).json({ id });
});
app.post('/api/profile', function saveProfile(request, response) { response.status(422).json({ error: 'name is required' }); });
app.post('/api/reports', function buildReport(request, response) { response.status(500).json({ error: 'report failed' }); });
const server = app.listen(0, '127.0.0.1', () => console.log(`listening ${server.address().port}`));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
