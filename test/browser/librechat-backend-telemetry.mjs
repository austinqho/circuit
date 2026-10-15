import http from 'node:http';
import { startNodeBackendTelemetry } from '../../backend/index.js';

const endpoint = new URL(process.env.PRODUCTTRACE_BACKEND_SPAN_ENDPOINT
  || 'http://127.0.0.1:8123/api/demo/backend-spans');

function relevant(span) {
  return span.kind === 'server'
    || span.instrumentation?.name === '@opentelemetry/instrumentation-express'
    || span.instrumentation?.name === 'producttrace-express-handlers'
    || span.instrumentation?.name === '@opentelemetry/instrumentation-mongodb';
}

function send(span) {
  if (!relevant(span)) return;
  const body = JSON.stringify(span);
  const request = http.request(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body),
    },
  });
  request.on('error', error => {
    console.error(`[ProductTrace backend] span delivery failed: ${error.message}`);
  });
  request.end(body);
}

globalThis.__productTraceBackendTelemetry = startNodeBackendTelemetry({
  serviceName: process.env.PRODUCTTRACE_SERVICE_NAME || 'librechat-api',
  adapters: ['http', 'express', 'mongodb'],
  onSpan: send,
});

console.log(`[ProductTrace backend] OpenTelemetry adapters active for ${
  globalThis.__productTraceBackendTelemetry.instrumentations.map(row => row.name).join(', ')}`);
