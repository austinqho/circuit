import net from 'node:net';
import { createRequire } from 'node:module';
import { startNodeBackendTelemetry } from '../../../backend/index.js';

// Middleware registered as (nested) arrays, the anything-llm shape:
// router.post(path, [validatedRequest, roleCheck(...), validSlug], handler).
const spans = [];
const telemetry = startNodeBackendTelemetry({ serviceName: 'fixture-api', adapters: ['http', 'express'], onSpan: span => spans.push(span) });
const require = createRequire(import.meta.url);
const express = require('express');
const app = express();
function validatedRequest(_request, _response, next) { next(); }
const roleCheck = () => function roleValid(_request, _response, next) { next(); };
function validSlug(_request, _response, next) { next(); }
function createThread(_request, response) { response.json({ ok: true }); }
app.post('/api/workspace/:slug/thread/new', [validatedRequest, [roleCheck()], validSlug], createThread);
const server = app.listen(0, '127.0.0.1');
await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
await new Promise((resolve, reject) => {
  const socket = net.connect(server.address().port, '127.0.0.1', () => socket.write([
    'POST /api/workspace/w1/thread/new HTTP/1.1', 'Host: 127.0.0.1', 'Connection: close', 'Content-Length: 0',
    'traceparent: 00-12345678901234567890123456789012-1234567890123456-01', '', '',
  ].join('\r\n')));
  socket.resume(); socket.once('end', resolve); socket.once('error', reject);
});
await new Promise(resolve => server.close(resolve));
await telemetry.forceFlush();
await telemetry.shutdown();
process.stdout.write(JSON.stringify(spans));
