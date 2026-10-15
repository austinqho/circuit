// Neutral fixture backend (no product names), CommonJS on purpose. It knows
// nothing about Tracer: telemetry is attached only by
// `node --import producttrace/backend/register server.cjs`.
//
// Shapes it exercises (every database call goes through the real `mongodb`
// driver to the local Mongo):
//  - an app-level auth middleware that reads `users` on every request and
//    answers 401 itself when the caller is unknown;
//  - a Router mounted under a prefix, with `router.param` reading `projects`
//    (and answering 404 itself when the project is missing);
//  - route handlers that write, that only read, and that do no database work;
//  - a path-scoped middleware that writes (`activity`) before a read-only handler;
//  - a route mounted before the auth middleware (the plain case: only the
//    handler touches the database);
//  - a handler that answers 202 and keeps working after the response;
//  - a four-argument error-handling middleware that reads `incidents` and
//    answers 500;
//  - a handler whose database call runs inside the app's own OpenTelemetry
//    span; a route-level middleware that reads; a GET whose only database work
//    is the auth middleware's read (a precondition);
//  - a background job on a timer, in its own trace (a root span of its own,
//    as any instrumented job runner would start), reading `projects`.
const express = require('express');
const { MongoClient } = require('mongodb');
const { trace } = require('@opentelemetry/api');

const url = process.env.FIXTURE_MONGO_URL || 'mongodb://127.0.0.1:27017';
const dbName = process.env.FIXTURE_MONGO_DB || 'producttrace_test_middleware';
const client = new MongoClient(url, { serverSelectionTimeoutMS: 3000 });

async function main() {
  await client.connect();
  const db = client.db(dbName);
  await db.collection('users').insertOne({ _id: 'u1', token: 'token-u1', name: 'Member' });
  await db.collection('projects').insertOne({ _id: 'p1', name: 'First project', owner: 'u1' });
  await db.collection('tasks').insertMany([{ _id: 't1', projectId: 'p1', title: 'Draft' }, { _id: 't2', projectId: 'p1', title: 'Review' }]);

  const app = express();
  app.use(express.json());

  // Plain case: mounted before the auth middleware; only the handler reads.
  app.get('/api/public/task-count', async function countTasks(request, response) {
    response.json({ count: await db.collection('tasks').countDocuments() });
  });

  app.use(async function authenticate(request, response, next) {
    const token = request.get('x-user-token') || null;
    const user = await db.collection('users').findOne({ token });
    if (!user) { response.status(401).json({ error: 'unauthorized' }); return; }
    request.user = user;
    next();
  });

  // A path-scoped middleware that writes, in front of a read-only handler.
  app.use('/api/projects/:projectId/summary', async function recordActivity(request, response, next) {
    await db.collection('activity').insertOne({ user: request.user._id, path: request.originalUrl, at: new Date() });
    next();
  });

  // Only the app-level middleware touches the database (a precondition).
  app.get('/api/whoami', function whoAmI(request, response) {
    response.json({ name: request.user.name });
  });

  const projects = express.Router();
  projects.param('projectId', async function loadProject(request, response, next, projectId) {
    const project = await db.collection('projects').findOne({ _id: projectId });
    if (!project) { response.status(404).json({ error: 'no such project' }); return; }
    request.project = project;
    next();
  });
  projects.get('/:projectId/tasks', async function listTasks(request, response) {
    response.json(await db.collection('tasks').find({ projectId: request.project._id }).toArray());
  });
  projects.patch('/:projectId/tasks/:taskId', async function renameTask(request, response) {
    await db.collection('tasks').updateOne({ _id: request.params.taskId, projectId: request.project._id }, { $set: { title: String(request.body?.title || '') } });
    response.json({ ok: true, taskId: request.params.taskId });
  });
  // A database call inside the app's own OpenTelemetry span (a common pattern).
  const appSpans = trace.getTracer('fixture-app');
  projects.get('/:projectId/stats', async function projectStats(request, response) {
    const open = await appSpans.startActiveSpan('loadStats', async span => {
      try { return await db.collection('tasks').countDocuments({ projectId: request.project._id }); } finally { span.end(); }
    });
    response.json({ open });
  });
  // Middleware registered on the route itself is part of the route's handler.
  projects.get('/:projectId/owner', async function requireOwner(request, response, next) {
    request.owner = await db.collection('users').findOne({ _id: request.project.owner });
    next();
  }, function showOwner(request, response) {
    response.json({ owner: request.owner?.name ?? null });
  });
  projects.post('/:projectId/summary', async function summarizeProject(request, response) {
    response.json({ tasks: await db.collection('tasks').countDocuments({ projectId: request.project._id }) });
  });
  projects.post('/:projectId/ping', function pingProject(request, response) {
    response.json({ ok: true, project: request.project._id });
  });
  projects.post('/:projectId/archive', function archiveProject(request, response) {
    response.status(202).json({ queued: true });
    // Server work that continues after the response was sent.
    setTimeout(async () => {
      await db.collection('projects').updateOne({ _id: request.project._id }, { $set: { archived: true } });
      await db.collection('audit').insertOne({ project: request.project._id, action: 'archive', at: new Date() });
    }, 40);
  });
  projects.post('/:projectId/explode', async function explodeProject(request, response, next) {
    next(new Error('explode failed'));
  });
  app.use('/api/projects', projects);

  app.use(async function reportError(error, request, response, next) {
    const open = await db.collection('incidents').countDocuments({ open: true });
    response.status(500).json({ error: 'internal', open });
  });

  const jobs = trace.getTracer('fixture-jobs');
  const job = setInterval(() => jobs.startActiveSpan('job - count open projects', span => {
    db.collection('projects').countDocuments({ archived: { $ne: true } }).finally(() => span.end());
  }), 150);

  const server = app.listen(Number(process.env.FIXTURE_PORT || 0), '127.0.0.1', () => console.log(`listening ${server.address().port}`));
  process.on('SIGTERM', () => { clearInterval(job); server.close(() => client.close().then(() => process.exit(0))); });
}

main().catch(error => { console.error(error); process.exit(1); });
