// Minimal CommonJS Express + MongoDB app, identical in behavior to ../esm-app.
// Telemetry is attached only by `node --import producttrace/backend/register`.
const http = require('node:http');
const express = require('express');
const { MongoClient } = require('mongodb');

async function main() {
  const client = new MongoClient(process.env.MONGO_URL || 'mongodb://127.0.0.1:27017', { serverSelectionTimeoutMS: 3000 });
  await client.connect();
  const database = client.db(process.env.MONGO_DB);
  await database.collection('items').replaceOne({ _id: 'item-1' }, { title: 'first' }, { upsert: true });

  const app = express();
  // An app-level middleware that reads the database on every request (the
  // tripwire for middleware spans: its read must sit under a named middleware span).
  app.use(async function authenticate(request, response, next) {
    request.user = await database.collection('users').findOne({ _id: 'user-1' });
    next();
  });
  app.get('/api/items/:id', async function getItem(request, response) {
    response.json(await database.collection('items').findOne({ _id: request.params.id }));
  });
  // Server-to-server: the handler reads the item back from its own server,
  // with the global fetch or with http.get (the receiving span must join).
  app.get('/api/items/:id/relay/:client', async function relayItem(request, response) {
    const url = `http://127.0.0.1:${server.address().port}/api/items/${encodeURIComponent(request.params.id)}`;
    // ?traceparent=<value>: the app sets its own trace header on the call.
    // ?forward=1: the proxy pattern, the handler forwards the traceparent it received.
    const headers = request.query.traceparent ? { traceparent: String(request.query.traceparent) }
      : request.query.forward ? { traceparent: request.headers.traceparent } : {};
    const item = request.params.client === 'fetch'
      ? await (await fetch(url, { headers })).json()
      : await new Promise((resolve, reject) => http.get(url, { headers }, reply => {
        let body = ''; reply.setEncoding('utf8');
        reply.on('data', chunk => { body += chunk; }); reply.on('end', () => resolve(JSON.parse(body)));
      }).on('error', reject));
    response.json(item);
  });
  const server = app.listen(0, '127.0.0.1', () => console.log(`listening ${server.address().port}`));

  process.on('SIGTERM', async () => {
    await database.dropDatabase();
    await client.close();
    server.close(() => process.exit(0));
  });
}
main().catch(error => { console.error(error); process.exit(1); });
