import { trace } from '@opentelemetry/api';
import { createRequire } from 'node:module';
import { NodeTracerProvider, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-node';
import { isWrapped, registerInstrumentations } from '@opentelemetry/instrumentation';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { MongooseInstrumentation } from '@opentelemetry/instrumentation-mongoose';
import { MongoDBInstrumentation } from '@opentelemetry/instrumentation-mongodb';
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici';
import { ProductTraceExpressHandlerInstrumentation } from './express-handler-instrumentation.js';

const SCHEMA = 'producttrace.backend-span.v1';

/**
 * The official HTTP instrumentation, patched once per process. With both the
 * require hook and the ESM loader hook active, `node:http`/`node:https` were
 * patched twice, and one outbound `http.get` produced two nested client spans:
 *  - ESM hook after require hook: the namespace's `request`/`get` are the
 *    already-wrapped functions (unwrapping is a no-op on the loader's proxy),
 *    so they were wrapped again and written into the default export, which is
 *    the CommonJS module object;
 *  - require hook after ESM hook: the functions the ESM patch wrote into the
 *    module object unwrap onto a copy, so they were wrapped again.
 * Rule: a module object's `request`/`get` are wrapped from the original exactly
 * once. The ESM patch reuses the module object's wrapped functions when they
 * exist; the require patch first restores the originals. `Server.prototype.emit`
 * is shared and was already patched once either way.
 */
// ---- App-set trace headers ------------------------------------------------
// Rule: when the app already set `traceparent` or `tracestate` on an outbound
// request, Tracer leaves the request's headers untouched (no second value, no
// overwrite) and marks the outbound span `producttrace.outbound.traceparent_set_by_app`
// (plus `producttrace.outbound.app_traceparent`, the app's W3C value, when it
// is one) so the analysis can follow the hop by the app's own identifiers or
// say it could not. A header equal to one Tracer injected itself (a library
// re-sending the headers on a redirect) is not the app's and is replaced.
export const APP_TRACEPARENT_ATTRIBUTE = 'producttrace.outbound.traceparent_set_by_app';
export const APP_TRACEPARENT_VALUE_ATTRIBUTE = 'producttrace.outbound.app_traceparent';
export const FORWARDED_TRACEPARENT_ATTRIBUTE = 'producttrace.outbound.traceparent_forwarded';
const TRACE_HEADERS = new Set(['traceparent', 'tracestate']);
const W3C_TRACEPARENT = /^[\da-f]{2}-[\da-f]{32}-[\da-f]{16}-[\da-f]{2}$/u;
const injected = new Set();
const rememberInjected = value => { if (typeof value !== 'string') return; injected.add(value); if (injected.size > 10_000) injected.delete(injected.values().next().value); };
const appSetSpans = new WeakSet();
// Pass-through: a traceparent equal to one this process's server spans
// received (a handler forwarding the incoming headers, the proxy pattern) is
// not the app's own context. Forwarding it would make the downstream server
// span a second child of the caller's span, so Tracer injects its own client
// span's value instead and marks the span `traceparent_forwarded`.
// Span id -> parent span id for this process's spans, and server span id ->
// the traceparent it received (null when none); both bounded.
const LIMIT = 50_000;
const parents = new Map();
const serverReceived = new Map();
const bounded = (map, key, value) => { map.set(key, value); if (map.size > LIMIT) map.delete(map.keys().next().value); };
const ancestry = { onStart(span) { const own = span.spanContext?.().spanId; if (own) bounded(parents, own, span.parentSpanContext?.spanId ?? span.parentSpanId ?? null); },
  onEnd() {}, forceFlush: async () => {}, shutdown: async () => {} };
/** The traceparent the nearest server span above `span` received, if that server span is this process's. */
function receivedByNearestServer(span) {
  const seen = new Set();
  for (let id = span?.spanContext?.().spanId; id && !seen.has(id); id = parents.get(id)) {
    seen.add(id);
    if (serverReceived.has(id)) return serverReceived.get(id);
  }
  return null;
}
const OUTBOUND_SCOPES = new Set(['@opentelemetry/instrumentation-http', '@opentelemetry/instrumentation-undici']);
const headerValue = value => (Array.isArray(value) ? value.map(String).join(',') : value == null ? null : String(value));

/** The app's trace headers among [name, value] pairs, ignoring ones Tracer injected itself; `forwarded` when the traceparent is the one the current server span received. */
function appTraceHeaders(entries, span = null) {
  const found = entries.filter(([name]) => TRACE_HEADERS.has(String(name).toLowerCase()))
    .map(([name, value]) => [String(name).toLowerCase(), headerValue(value)]);
  if (!found.length) return null;
  const parent = found.find(([name]) => name === 'traceparent')?.[1] ?? null;
  if (parent != null && injected.has(parent)) return null;
  if (parent != null && parent.trim().toLowerCase() === receivedByNearestServer(span)) return { traceparent: parent, forwarded: true };
  return { traceparent: parent };
}
function markAppSet(span, headers) {
  if (!span || typeof span.setAttribute !== 'function') return;
  appSetSpans.add(span);
  span.setAttribute(APP_TRACEPARENT_ATTRIBUTE, true);
  const value = headers.traceparent?.trim().toLowerCase();
  if (value && W3C_TRACEPARENT.test(value)) span.setAttribute(APP_TRACEPARENT_VALUE_ATTRIBUTE, value);
}
function markForwarded(span) { if (span && typeof span.setAttribute === 'function') span.setAttribute(FORWARDED_TRACEPARENT_ATTRIBUTE, true); }
/** Remove trace headers from an undici request before Tracer injects its own. */
function dropUndiciTraceHeaders(request) {
  if (Array.isArray(request.headers)) {
    for (let i = request.headers.length - 2; i >= 0; i -= 2) if (TRACE_HEADERS.has(String(request.headers[i]).toLowerCase())) request.headers.splice(i, 2);
  } else if (typeof request.headers === 'string') {
    request.headers = request.headers.split('\r\n').filter(line => !TRACE_HEADERS.has(line.slice(0, Math.max(0, line.indexOf(':'))).trim().toLowerCase())).join('\r\n');
  }
}
/** undici `request.headers`: [k, v, …] (undici >= 6) or a raw "k: v\r\n" string (undici 5). */
function undiciHeaderEntries(headers) {
  if (Array.isArray(headers)) { const out = []; for (let i = 0; i + 1 < headers.length; i += 2) out.push([String(headers[i]), headers[i + 1]]); return out; }
  if (typeof headers === 'string') return headers.split('\r\n').filter(Boolean).map(line => { const at = line.indexOf(':'); return [line.slice(0, at).trim(), line.slice(at + 1).trim()]; });
  return [];
}

/** Wraps the SDK's default propagator; inject leaves app-set trace headers alone. */
class AppHeadersFirstPropagator {
  constructor(inner) { this.inner = inner; }
  inject(context, carrier, setter) {
    const span = trace.getSpan(context);
    if (span && appSetSpans.has(span)) return;
    if (carrier && typeof carrier === 'object' && !Array.isArray(carrier)) {
      const app = appTraceHeaders(Object.entries(carrier), span);
      if (app?.forwarded) {
        for (const key of Object.keys(carrier)) if (TRACE_HEADERS.has(key.toLowerCase())) delete carrier[key];
        markForwarded(span);
      } else if (app) { markAppSet(span, app); return; }
    }
    this.inner.inject(context, carrier, setter);
    // Only the outbound instrumentations' own injections count as Tracer's
    // (a library re-sending them on a redirect); a value the app injected
    // itself through the global propagator API stays the app's.
    if (carrier && typeof carrier === 'object' && span?.kind === 2 && OUTBOUND_SCOPES.has(span.instrumentationScope?.name ?? span.instrumentationLibrary?.name)) rememberInjected(carrier.traceparent);
  }
  extract(context, carrier, getter) { return this.inner.extract(context, carrier, getter); }
  fields() { return this.inner.fields(); }
}
// The SDK's own default (W3C trace context + baggage), from the copy of
// @opentelemetry/core that @opentelemetry/sdk-trace-node depends on.
function defaultPropagator() {
  const core = createRequire(createRequire(import.meta.url).resolve('@opentelemetry/sdk-trace-node'))('@opentelemetry/core');
  return new core.CompositePropagator({ propagators: [new core.W3CTraceContextPropagator(), new core.W3CBaggagePropagator()] });
}

const OUTGOING = ['request', 'get'];
const originalOf = fn => { let value = fn; while (isWrapped(value) && typeof value.__original === 'function') value = value.__original; return value; };
class ProductTraceHttpInstrumentation extends HttpInstrumentation {
  init() {
    const definitions = super.init();
    for (const definition of definitions) {
      const patch = definition.patch;
      if (typeof patch !== 'function') continue;
      definition.patch = (moduleExports, version) => {
        const esm = moduleExports?.[Symbol.toStringTag] === 'Module';
        const shared = esm ? moduleExports.default : null;
        if (shared && OUTGOING.every(name => isWrapped(shared[name]))) {
          for (const name of OUTGOING) Object.defineProperty(moduleExports, name, { value: shared[name] });
          return moduleExports;
        }
        if (!esm && moduleExports) for (const name of OUTGOING) if (isWrapped(moduleExports[name])) moduleExports[name] = originalOf(moduleExports[name]);
        return patch(moduleExports, version);
      };
    }
    return definitions;
  }
}

const constructors = {
  http: ProductTraceHttpInstrumentation,
  express: ExpressInstrumentation,
  mongoose: MongooseInstrumentation,
  mongodb: MongoDBInstrumentation,
  undici: UndiciInstrumentation,
};

function jsonValue(value) {
  if (value === undefined) return null;
  if (typeof value === 'bigint') return String(value);
  if (Array.isArray(value)) return value.map(jsonValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonValue(item)]));
  }
  return value;
}

const PRIVATE_DATABASE_ATTRIBUTES = new Set([
  'db.connection_string',
  'db.query.text',
  'db.statement',
]);

function safeSpanAttributes(attributes, captureContent) {
  return Object.fromEntries(Object.entries(attributes || {}).filter(([name]) => {
    if (name === 'db.connection_string') return false;
    if (captureContent) return true;
    return !PRIVATE_DATABASE_ATTRIBUTES.has(name)
      && !name.startsWith('db.operation.parameter.')
      && name !== 'producttrace.db.result';
  }).map(([name, value]) => [name, jsonValue(value)]));
}

// MongoDB's command instrumentation reports findAndModify against `$cmd`.
// Preserve only the collection name from the command document; never export
// the command or statement itself.
function mongoCommandCollection(attributes) {
  if (!attributes || attributes['db.mongodb.collection'] !== '$cmd') return null;
  const candidates = [
    attributes['db.mongodb.command'], attributes['mongodb.command'],
    attributes['db.command'], attributes['db.statement'],
  ];
  for (const candidate of candidates) {
    let value = candidate;
    if (typeof value === 'string') { try { value = JSON.parse(value); } catch { continue; } }
    if (value && typeof value === 'object' && typeof value.findAndModify === 'string' && value.findAndModify) {
      return value.findAndModify;
    }
  }
  return null;
}

function spanKind(kind) {
  return ['internal', 'server', 'client', 'producer', 'consumer'][kind] || 'unknown';
}

/**
 * Convert an OpenTelemetry ReadableSpan into the stable, JSON-safe record used
 * by ProductTrace. Keeping this boundary small lets an application supply spans
 * from its existing OTel SDK instead of starting a second tracer provider.
 */
export function normalizeOpenTelemetrySpan(span, { serviceName, captureContent = false } = {}) {
  if (!span || typeof span.spanContext !== 'function') {
    throw new TypeError('span must be an OpenTelemetry ReadableSpan');
  }
  const context = span.spanContext();
  const resourceAttributes = span.resource?.attributes || {};
  const attributes = safeSpanAttributes(span.attributes, captureContent);
  const commandCollection = mongoCommandCollection(span.attributes);
  if (commandCollection) attributes['producttrace.mongo.command_collection'] = commandCollection;
  return {
    schema: SCHEMA,
    source: 'opentelemetry',
    service_name: serviceName || resourceAttributes['service.name'] || 'unknown_service',
    name: span.name,
    trace_id: context.traceId,
    span_id: context.spanId,
    parent_span_id: span.parentSpanContext?.spanId || null,
    kind: spanKind(span.kind),
    status: jsonValue(span.status || { code: 0 }),
    attributes,
    start_time: jsonValue(span.startTime),
    end_time: jsonValue(span.endTime),
    instrumentation: span.instrumentationScope ? {
      name: span.instrumentationScope.name,
      version: span.instrumentationScope.version || null,
    } : null,
  };
}

/** Create an OTel SpanExporter for applications that already own their SDK. */
export function createProductTraceSpanExporter({ onSpan, serviceName, captureContent = false } = {}) {
  if (typeof onSpan !== 'function') throw new TypeError('onSpan callback is required');
  if (typeof serviceName !== 'string' || !serviceName.trim()) {
    throw new TypeError('serviceName is required');
  }
  const normalizedServiceName = serviceName.trim();
  return {
    export(spans, done) {
      try {
        for (const span of spans) onSpan(normalizeOpenTelemetrySpan(span,
          { serviceName: normalizedServiceName, captureContent }));
        done({ code: 0 });
      } catch (error) {
        done({ code: 1, error });
      }
    },
    shutdown: async () => {},
  };
}

function recordResult(span, value, mongoWireResponse = false) {
  try {
    const result = mongoWireResponse && typeof value?.toObject === 'function' ? value.toObject() : value;
    const serialized = JSON.stringify(result);
    if (serialized === undefined) return;
    if (serialized.length > 262_144) {
      span.setAttribute('producttrace.db.result_status', 'over_capture_limit');
      return;
    }
    span.setAttribute('producttrace.db.result', serialized);
    span.setAttribute('producttrace.db.result_status', 'captured');
  } catch {
    span.setAttribute('producttrace.db.result_status', 'unserializable');
  }
}

function instrumentationConfig(name, captureContent) {
  if (name === 'mongoose' && captureContent) {
    return {
      dbStatementSerializer: (_operation, payload) => JSON.stringify(payload),
      responseHook: (span, { response }) => recordResult(span, response),
    };
  }
  if (name === 'undici') {
    // undici injects into a fresh object, so the app's headers are read here
    // (before injection) from the request itself.
    return { requestHook: (span, request) => {
      const app = appTraceHeaders(undiciHeaderEntries(request?.headers), span);
      if (app?.forwarded) { dropUndiciTraceHeaders(request); markForwarded(span); } else if (app) markAppSet(span, app);
    } };
  }
  if (name === 'http') {
    // Incoming requests: remember the traceparent each server span received (pass-through detection).
    return { requestHook: (span, request) => {
      if (span?.kind !== 1 || !request || typeof request.getHeader === 'function') return;
      const value = headerValue(request.headers?.traceparent);
      bounded(serverReceived, span.spanContext().spanId, value ? value.trim().toLowerCase() : null);
    } };
  }
  if (name === 'mongodb') {
    return {
      // Enable command metadata so the normalizer can extract only the
      // findAndModify collection key. Statement text is still filtered above.
      enhancedDatabaseReporting: true,
      ...(captureContent ? { responseHook: (span, { data }) => recordResult(span, data, true) } : {}),
    };
  }
  return {};
}

/**
 * Start selected official OpenTelemetry Node instrumentations. This must run
 * before the application imports HTTP, Express, database, or Undici modules.
 * Spans stay in-process and are delivered only to the caller-provided callback.
 */
export function startNodeBackendTelemetry({
  onSpan,
  serviceName,
  adapters = DEFAULT_ADAPTERS,
  captureContent = false,
  onSpanStart = null,
} = {}) {
  if (typeof onSpan !== 'function') throw new TypeError('onSpan callback is required');
  if (typeof serviceName !== 'string' || !serviceName.trim()) {
    throw new TypeError('serviceName is required');
  }
  if (!Array.isArray(adapters) || adapters.length === 0) {
    throw new TypeError('adapters must be a nonempty array');
  }
  const names = [...new Set(adapters)];
  const instrumentations = names.map(name => {
    const Constructor = constructors[name];
    if (!Constructor) throw new TypeError(`Unknown backend adapter: ${name}`);
    return new Constructor(instrumentationConfig(name, captureContent));
  });
  if (names.includes('express')) instrumentations.push(new ProductTraceExpressHandlerInstrumentation());
  const exporter = createProductTraceSpanExporter({ onSpan, serviceName, captureContent });
  // `onSpanStart(span)` sees every span as it starts (the SDK span; kind is
  // the numeric OTel SpanKind). register.js uses it to learn which traces hold
  // an incoming server span before that span ends.
  const startWatcher = typeof onSpanStart === 'function' ? {
    onStart(span) { try { onSpanStart(span); } catch { /* never break the app */ } },
    onEnd() {}, forceFlush: async () => {}, shutdown: async () => {},
  } : null;
  const provider = new NodeTracerProvider({
    spanProcessors: [ancestry, ...(startWatcher ? [startWatcher] : []), new SimpleSpanProcessor(exporter)],
  });
  provider.register({ propagator: new AppHeadersFirstPropagator(defaultPropagator()) });
  const disable = registerInstrumentations({ instrumentations, tracerProvider: provider });
  let stopped = false;
  return {
    instrumentations: instrumentations.map(item => ({
      name: item.instrumentationName,
      version: item.instrumentationVersion,
    })),
    async forceFlush() {
      if (!stopped) await provider.forceFlush();
    },
    async shutdown() {
      if (stopped) return;
      stopped = true;
      disable();
      await provider.shutdown();
    },
  };
}

export const BACKEND_SPAN_SCHEMA = SCHEMA;
export const NODE_BACKEND_ADAPTERS = Object.freeze(Object.keys(constructors));
