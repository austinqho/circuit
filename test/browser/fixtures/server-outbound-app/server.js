// Neutral fixture: a CommonJS Express + MongoDB backend whose handlers call
// other servers. It knows nothing about Tracer; telemetry is attached only by
// `node --import producttrace/backend/register server.js`.
//
//   GET  /api/projects/:id           plain: one read, no outbound call
//   POST /api/projects/:id/archive   (a) global fetch to its own /internal/notify
//   POST /api/projects/:id/sync      (b) http.request to a second Express process,
//                                        which calls back into /internal/ping (nested)
//   POST /api/projects/:id/webhook   (c) fetch to a host that answers but is not
//                                        instrumented, then http.request to a closed port
//   GET  /api/projects/:id/overview  (d) Promise.all: fetch /internal/stats and
//                                        axios (Node http adapter) to the second process
//   POST /api/chain/:depth           (e) recursion: fetch /api/chain/(depth-1) until 0
//   POST /api/projects/:id/forward   (f) the app sets its own traceparent: fetch to
//                                        itself, http.request to the peer, fetch to the
//                                        uninstrumented host, and a fetch whose headers
//                                        the app filled with the OpenTelemetry API's
//                                        propagation.inject (the app's own propagator call)
//   POST /api/projects/:id/touch     (g) responds, then calls /internal/notify 50 ms later
//   GET  /api/projects/:id/proxy     (h) the proxy pattern: http.request to the peer with the
//                                        incoming headers forwarded, and fetch to itself with
//                                        the incoming traceparent forwarded
//
// Environment: PORT (default 0), MONGO_URL, MONGO_DB, PEER_URL, STATIC_DIR,
// UNINSTRUMENTED_URL, UNREACHABLE_URL, AXIOS_MODULE (path; axios-style http
// fallback when absent).
const crypto = require('node:crypto');
const http = require('node:http');
const path = require('node:path');
const express = require('express');
const { MongoClient } = require('mongodb');

const axios = process.env.AXIOS_MODULE ? require(process.env.AXIOS_MODULE) : null;

// An http.request client in the style of axios' Node adapter: an options
// object, a streamed response, one promise.
function requestJson(url, { method = 'GET', body, headers = {} } = {}) {
  const target = new URL(url);
  const payload = body === undefined ? null : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const request = http.request({ protocol: target.protocol, hostname: target.hostname, port: target.port, path: `${target.pathname}${target.search}`, method,
      headers: { accept: 'application/json', ...headers, ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}) } }, response => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { text += chunk; });
      response.on('end', () => { try { resolve({ status: response.statusCode, data: text ? JSON.parse(text) : null }); } catch (error) { reject(error); } });
    });
    request.on('error', reject);
    request.end(payload || undefined);
  });
}

async function main() {
  const client = new MongoClient(process.env.MONGO_URL || 'mongodb://127.0.0.1:27017', { serverSelectionTimeoutMS: 3000 });
  await client.connect();
  const database = client.db(process.env.MONGO_DB);
  await database.collection('projects').replaceOne({ _id: 'p1' }, { name: 'Harbor survey', archived: false }, { upsert: true });

  const app = express();
  app.use(express.json());
  const self = () => `http://127.0.0.1:${server.address().port}`;

  app.get('/api/projects/:id', async function getProject(request, response) {
    response.json(await database.collection('projects').findOne({ _id: request.params.id }));
  });

  app.post('/api/projects/:id/archive', async function archiveProject(request, response) {
    await database.collection('projects').updateOne({ _id: request.params.id }, { $set: { archived: true } });
    const reply = await fetch(`${self()}/internal/notify`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ project: request.params.id, event: 'archived' }) });
    response.json({ archived: true, notified: reply.status });
  });
  app.post('/internal/notify', async function notify(request, response) {
    await database.collection('notifications').insertOne({ project: request.body.project, event: request.body.event });
    response.status(201).json({ ok: true });
  });

  app.post('/api/projects/:id/sync', async function syncProject(request, response) {
    const reply = await requestJson(`${process.env.PEER_URL}/peer/relay`, { method: 'POST',
      body: { project: request.params.id, callback: `${self()}/internal/ping/${encodeURIComponent(request.params.id)}` } });
    response.json({ synced: reply.status === 200, peer: reply.data });
  });
  app.get('/internal/ping/:id', async function ping(request, response) {
    const project = await database.collection('projects').findOne({ _id: request.params.id });
    response.json({ pong: Boolean(project) });
  });

  app.post('/api/projects/:id/webhook', async function sendWebhook(request, response) {
    const answered = (await fetch(process.env.UNINSTRUMENTED_URL, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ project: request.params.id }) })).status;
    const unreachable = await requestJson(process.env.UNREACHABLE_URL, { method: 'POST', body: { project: request.params.id } })
      .then(reply => String(reply.status), error => error.code || 'error');
    await database.collection('webhook_attempts').insertOne({ project: request.params.id, answered, unreachable });
    response.status(202).json({ answered, unreachable });
  });

  app.get('/api/projects/:id/overview', async function overview(request, response) {
    const id = encodeURIComponent(request.params.id);
    const [local, remote] = await Promise.all([
      fetch(`${self()}/internal/stats/${id}`).then(reply => reply.json()),
      axios ? axios.get(`${process.env.PEER_URL}/peer/stats/${id}`).then(reply => reply.data) : requestJson(`${process.env.PEER_URL}/peer/stats/${id}`).then(reply => reply.data),
    ]);
    response.json({ local, remote });
  });
  app.get('/internal/stats/:id', async function stats(request, response) {
    response.json({ notifications: await database.collection('notifications').countDocuments({ project: request.params.id }) });
  });

  app.post('/api/chain/:depth', async function chainStep(request, response) {
    const depth = Number(request.params.depth);
    if (depth > 0) {
      const reply = await fetch(`${self()}/api/chain/${depth - 1}`, { method: 'POST' });
      response.json({ depth, next: await reply.json() });
      return;
    }
    await database.collection('chain_ends').insertOne({ reached: true });
    response.json({ depth: 0 });
  });

  // (f) A W3C traceparent the app made itself (its own trace), logged so the
  // test can compare it with what the receivers saw.
  const appTraceparent = label => {
    const value = `00-${crypto.randomBytes(16).toString('hex')}-${crypto.randomBytes(8).toString('hex')}-01`;
    console.log(`app-traceparent ${label} ${value}`);
    return value;
  };
  app.post('/api/projects/:id/forward', async function forwardTraced(request, response) {
    const id = encodeURIComponent(request.params.id);
    await fetch(`${self()}/internal/notify`, { method: 'POST', headers: { 'content-type': 'application/json', traceparent: appTraceparent('fetch-self') },
      body: JSON.stringify({ project: request.params.id, event: 'forwarded' }) });
    await requestJson(`${process.env.PEER_URL}/peer/stats/${id}`, { headers: { traceparent: appTraceparent('http-peer') } });
    await fetch(`${process.env.UNINSTRUMENTED_URL}/traced`, { method: 'POST', headers: { traceparent: appTraceparent('fetch-uninstrumented') }, body: '{}' });
    // The app's own propagator call (the OpenTelemetry API it would use with its own SDK).
    const { context, propagation } = require('@opentelemetry/api');
    const carried = {};
    propagation.inject(context.active(), carried);
    console.log(`app-traceparent api-inject ${carried.traceparent}`);
    await fetch(`${self()}/internal/stats/${id}`, { headers: carried });
    response.json({ forwarded: true });
  });
  // (g) Work after the response: a timer armed by the handler.
  app.post('/api/projects/:id/touch', function touchProject(request, response) {
    response.json({ touched: true });
    setTimeout(() => {
      fetch(`${self()}/internal/notify`, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ project: request.params.id, event: 'touched' }) }).catch(() => {});
    }, 50);
  });

  app.get('/api/projects/:id/proxy', async function proxyProject(request, response) {
    const id = encodeURIComponent(request.params.id);
    const forward = { ...request.headers };
    for (const name of ['host', 'connection', 'content-length', 'accept-encoding']) delete forward[name];
    const remote = await requestJson(`${process.env.PEER_URL}/peer/stats/${id}`, { headers: forward });
    const local = await (await fetch(`${self()}/internal/stats/${id}`, { headers: { traceparent: request.headers.traceparent } })).json();
    response.json({ remote: remote.data, local });
  });

  if (process.env.STATIC_DIR) {
    app.use(express.static(process.env.STATIC_DIR));
    app.use((request, response) => response.sendFile(path.join(process.env.STATIC_DIR, 'index.html')));
  }
  const server = app.listen(Number(process.env.PORT || 0), '127.0.0.1', () => console.log(`listening ${server.address().port}`));

  process.on('SIGTERM', async () => {
    await database.dropDatabase();
    await client.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
main().catch(error => { console.error(error); process.exit(1); });
