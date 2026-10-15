// Default backend entrypoint: `node --import producttrace/backend/register server.js`.
//
// 1. Registers the OpenTelemetry ESM loader hook (import-in-the-middle, the
//    loader behind `@opentelemetry/instrumentation/hook.mjs`) through
//    `module.register()`, so `import express from 'express'` in a
//    `"type": "module"` app is patched the same way `require('express')` is.
//    CommonJS apps are unaffected: their modules still go through `require`.
// 2. Starts Tracer's backend telemetry and ships each span record to the
//    collector's span endpoint.
// 3. Outbound HTTP (server-to-server) joins the trace: the `http` adapter
//    instruments the client side of `http`/`https` (`http.request`, `http.get`,
//    and every library built on them, such as axios' Node adapter), and the
//    `undici` adapter instruments Node's global `fetch` (undici's diagnostics
//    channels; Node >= 20.6 or 18.19). Each outbound request becomes a client
//    span that is a child of the active server/handler span and carries a W3C
//    `traceparent`, so the receiving server's span (this process or another
//    instrumented one) is a child of that client span in the same trace.
//    On an older Node the fetch adapter is left out: one warning, and every
//    server span carries `producttrace.capture_limit.*` naming it.
//
// Environment (all optional):
//   PRODUCTTRACE_BACKEND_SPAN_ENDPOINT  default http://127.0.0.1:8787/spans
//                                       (`producttrace-collector --store <dir>`)
//   PRODUCTTRACE_BACKEND_ADAPTERS       default http,undici,express,mongodb
//                                       (undici only on Node >= 20.6 / 18.19)
//   PRODUCTTRACE_SERVICE_NAME           default backend
//
// Nothing here names a route, handler, or database: the adapters patch
// library code only, and joins stay by exact trace parent.
import { context, createContextKey } from '@opentelemetry/api';
import * as nodeModule from 'node:module';
import http from 'node:http';
import https from 'node:https';
import { pathToFileURL } from 'node:url';
import { startNodeBackendTelemetry } from './index.js';

export const DEFAULT_SPAN_ENDPOINT = 'http://127.0.0.1:8787/spans';
export const DEFAULT_REGISTER_ADAPTERS = Object.freeze(['http', 'undici', 'express', 'mongodb']);
const LOG = '[ProductTrace backend]';
const FALLBACK = 'node --experimental-loader=@opentelemetry/instrumentation/hook.mjs --import producttrace/backend/register <entry>';

// An operator who already starts Node with the OTel/iitm loader keeps it; a
// second registration would wrap every module twice.
function loaderAlreadyPresent() {
  const argv = [...process.execArgv, ...(process.env.NODE_OPTIONS || '').split(/\s+/)];
  return argv.some(arg => /(^|[/\\@])(instrumentation\/hook\.mjs|import-in-the-middle\/hook\.mjs)$/.test(arg.replace(/^--(experimental-)?loader=/, '')));
}

// Resolve import-in-the-middle from @opentelemetry/instrumentation so the
// message channel and the instrumentations' `Hook` calls share one module copy.
function registerEsmHook() {
  if (loaderAlreadyPresent()) return { registered: true, via: 'operator --experimental-loader' };
  if (typeof nodeModule.register !== 'function') {
    return { registered: false, reason: `node:module.register is unavailable on Node ${process.version} (needs >= 20.6 or 18.19)` };
  }
  try {
    const fromOtel = nodeModule.createRequire(nodeModule.createRequire(import.meta.url).resolve('@opentelemetry/instrumentation'));
    const iitm = fromOtel('import-in-the-middle');
    const hookUrl = pathToFileURL(fromOtel.resolve('import-in-the-middle/hook.mjs')).href;
    const { registerOptions, waitForAllMessagesAcknowledged } = iitm.createAddHookMessageChannel();
    // Node >= 26 marks module.register() deprecated (DEP0205) in favour of
    // registerHooks(), which import-in-the-middle does not support yet. The
    // operator cannot act on that warning, so drop exactly that one, only for
    // this call.
    const emitWarning = process.emitWarning;
    process.emitWarning = function productTraceEmitWarning(warning, ...rest) {
      const code = typeof rest[0] === 'object' ? rest[0]?.code : rest[1];
      if (code === 'DEP0205') return;
      return emitWarning.call(process, warning, ...rest);
    };
    try {
      nodeModule.register(hookUrl, import.meta.url, registerOptions);
    } finally {
      process.emitWarning = emitWarning;
    }
    return { registered: true, via: 'module.register', waitForAllMessagesAcknowledged };
  } catch (error) {
    return { registered: false, reason: `ESM loader hook registration failed: ${error?.message || error}` };
  }
}

// Node's global fetch is undici; its OTel instrumentation subscribes to
// undici's diagnostics channels, which are reliable from Node 18.19 / 20.6
// (the instrumentation's own engine range; earlier 18.x/20.x lose
// subscriptions to a ref-counting bug).
export function outboundFetchSupport(version = process.versions.node) {
  const [major, minor] = String(version).split('.').map(Number);
  const supported = major > 20 || (major === 20 && minor >= 6) || (major === 18 && minor >= 19);
  return supported ? { supported: true } : { supported: false, reason: `outbound fetch (undici) instrumentation needs Node >= 20.6 or 18.19; this is Node v${version}` };
}

const esm = registerEsmHook();
if (!esm.registered) {
  console.warn(`${LOG} ${esm.reason}. Modules the app imports as ESM (express, ...) are not instrumented: `
    + `expect bare HTTP server spans without route or handler spans (database spans only where the driver loads its internals with require). Upgrade Node, or start with: ${FALLBACK}`);
}

const endpoint = new URL(process.env.PRODUCTTRACE_BACKEND_SPAN_ENDPOINT || DEFAULT_SPAN_ENDPOINT);
const transport = endpoint.protocol === 'https:' ? https : http;
const fetchSupport = outboundFetchSupport();
const explicitAdapters = process.env.PRODUCTTRACE_BACKEND_ADAPTERS
  ? process.env.PRODUCTTRACE_BACKEND_ADAPTERS.split(',').map(value => value.trim()).filter(Boolean)
  : null;
const adapters = explicitAdapters
  || DEFAULT_REGISTER_ADAPTERS.filter(name => name !== 'undici' || fetchSupport.supported);
// Outbound fetch is captured only when the undici adapter runs on a Node that
// supports it; otherwise a fetch from a handler starts a new root trace on the
// receiving side, and the spans say so.
const outboundFetch = adapters.includes('undici')
  ? fetchSupport
  : { supported: false, reason: fetchSupport.supported ? 'the undici adapter is not in PRODUCTTRACE_BACKEND_ADAPTERS' : fetchSupport.reason };
if (!outboundFetch.supported) {
  console.warn(`${LOG} ${outboundFetch.reason}. Requests this process sends with the global fetch are not instrumented: `
    + 'no client span, no traceparent, and the receiving server starts a new trace (http.request/https.request are still instrumented).'
    + (fetchSupport.supported ? '' : ' Upgrade Node to capture them.'));
}

const OUTBOUND_INSTRUMENTATIONS = new Set(['@opentelemetry/instrumentation-http', '@opentelemetry/instrumentation-undici']);
// One filter. Server, route, handler, database and outbound HTTP client spans
// (http/https and undici: the adapters) ship in full. This module's own
// delivery requests run with tracing suppressed, so they never produce a
// client span or carry a traceparent.
const relevant = span => span.kind === 'server'
  || span.instrumentation?.name === '@opentelemetry/instrumentation-express'
  || span.instrumentation?.name === 'producttrace-express-handlers'
  || Boolean(span.attributes?.['db.system'] || span.attributes?.['db.system.name'])
  || (span.kind === 'client' && OUTBOUND_INSTRUMENTATIONS.has(span.instrumentation?.name));

// Every other span of a trace that holds an incoming server span (the app's
// own manual spans, outgoing client spans, other libraries' spans) ships as a
// skeleton: ids, parent, name, kind, times and instrumentation scope, no
// attributes. Without it, a database span inside such a span has a parent the
// store never sees, and the walk from the database span to the server span
// breaks (the operation would belong to no request). Traces with no server
// span (background jobs, this module's own delivery requests, which run with
// tracing suppressed) ship nothing extra. The set of server traces is learnt
// at span start (a server span ends after its children) and bounded.
const SERVER_TRACES_KEPT = 20_000;
const serverTraces = new Set();
function noteSpanStart(span) {
  if (span?.kind !== 1) return; // SpanKind.SERVER
  const traceId = span.spanContext?.().traceId;
  if (!traceId) return;
  serverTraces.add(traceId);
  if (serverTraces.size > SERVER_TRACES_KEPT) serverTraces.delete(serverTraces.values().next().value);
}
const skeleton = span => ({ schema: span.schema, source: span.source, service_name: span.service_name, name: span.name,
  trace_id: span.trace_id, span_id: span.span_id, parent_span_id: span.parent_span_id, kind: span.kind,
  status: { code: span.status?.code ?? 0 }, attributes: { 'producttrace.span.skeleton': true },
  start_time: span.start_time, end_time: span.end_time, instrumentation: span.instrumentation });

// Every server span says what this process could not capture
// (capture.limit-style; several limits are comma/semicolon joined).
const limits = [
  ...(esm.registered ? [] : [{ feature: 'esm_instrumentation', reason: esm.reason }]),
  ...(outboundFetch.supported ? [] : [{ feature: 'outbound_fetch', reason: outboundFetch.reason }]),
];
const limit = limits.length ? { feature: limits.map(row => row.feature).join(','), reason: limits.map(row => row.reason).join('; ') } : null;
// The key @opentelemetry/core's suppressTracing() sets (createContextKey is
// Symbol.for(description), so this is the same key without a core import).
const SUPPRESS_TRACING = createContextKey('OpenTelemetry SDK Context Key SUPPRESS_TRACING');

let warnedDelivery = false;
function send(record) {
  const span = relevant(record) ? record : (serverTraces.has(record.trace_id) ? skeleton(record) : null);
  if (!span) return;
  if (limit && span.kind === 'server') {
    span.attributes['producttrace.capture_limit.feature'] = limit.feature;
    span.attributes['producttrace.capture_limit.reason'] = limit.reason;
  }
  const body = JSON.stringify(span);
  context.with(context.active().setValue(SUPPRESS_TRACING, true), () => {
    const request = transport.request(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } });
    request.on('response', response => response.resume());
    request.on('error', error => {
      if (warnedDelivery) return;
      warnedDelivery = true;
      console.error(`${LOG} span delivery to ${endpoint.href} failed: ${error.message}`);
    });
    request.end(body);
  });
}

const telemetry = startNodeBackendTelemetry({
  serviceName: process.env.PRODUCTTRACE_SERVICE_NAME || 'backend',
  adapters,
  onSpan: send,
  onSpanStart: noteSpanStart,
});
// The loader must acknowledge every module the instrumentations asked for
// before the application's first import runs.
if (esm.waitForAllMessagesAcknowledged) await esm.waitForAllMessagesAcknowledged();

globalThis.__productTraceBackendTelemetry = telemetry;
globalThis.__productTraceBackendEsm = esm.registered ? { registered: true, via: esm.via } : { registered: false, feature: 'esm_instrumentation', reason: esm.reason };
globalThis.__productTraceBackendOutbound = { http: adapters.includes('http'), fetch: outboundFetch.supported, ...(outboundFetch.supported ? {} : { reason: outboundFetch.reason }) };
console.log(`${LOG} adapters active: ${telemetry.instrumentations.map(row => row.name).join(', ')}; `
  + `esm hook: ${esm.registered ? esm.via : 'absent'}; outbound: ${[adapters.includes('http') ? 'http' : null, outboundFetch.supported ? 'fetch' : null].filter(Boolean).join('+') || 'none'}; spans -> ${endpoint.href}`);
