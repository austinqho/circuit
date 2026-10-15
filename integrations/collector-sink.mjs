/**
 * Browser → collector transport (G5 D-G5-1), dev builds only.
 *
 * The attribution runtime hands every row it records to a host hook,
 * `globalThis.__producttraceHostCapture(text)`. Test harnesses define that hook;
 * a real install had nothing behind it, so no row ever reached a store. With
 * `producttrace({ collector: url })` the injected settings script installs
 * this sink BEFORE the runtime: it chains any hook already present, batches
 * rows, and POSTs them to `<url>/ingest` (a `producttrace-collector --store`).
 *
 * - Rows are sent as a JSON array with `content-type: text/plain`, a CORS-simple
 *   request (no preflight); the collector allows any origin.
 * - The native `fetch`/`setTimeout` are captured here, before the runtime wraps
 *   them, so the sink's own posts never become `network.request` rows and its
 *   timers never carry an action's context.
 * - `capture_page_id` is the runtime's page session (`s_…`, also `tracer_session`
 *   in OAI metadata) when a row has none.
 * - Failed batches are retried, then counted as dropped; `pagehide` asks the
 *   runtime for its `capture.summary` row, then flushes the tail with `sendBeacon`. `globalThis.__productTraceCollectorStats()` reports
 *   queued / sent / batches / dropped / malformed, and the first drop or
 *   malformed row logs one console warning. A malformed host payload (not JSON,
 *   or not an object) is not shipped; a `capture.dropped` row (reason, length,
 *   never the content) is, so the store reports it as `malformed_records`.
 * No repository knowledge; no model.
 */

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
/** True for localhost, *.localhost, 127.0.0.0/8 and ::1. */
export function isLoopbackHost(hostname) {
  const host = String(hostname).toLowerCase();
  return LOOPBACK_HOSTS.has(host) || host.endsWith('.localhost') || /^127(?:\.\d{1,3}){3}$/u.test(host);
}

/**
 * Validate the `collector` option. Accepts a string (the URL) or
 * `{ url, allowRemote = false, force = false }`. Returns
 * `{ url, allowRemote, force }` (url without a trailing slash) or null.
 * - `url`: an absolute http(s) URL, or a root-relative path (the page's own
 *   origin, i.e. the dev server that serves it).
 * - Dev-only and localhost-only by default: an absolute URL whose host is not
 *   loopback is refused unless `allowRemote: true`.
 * - `force: true` keeps the sink in a Vite `production`-mode build (see
 *   `productTraceVitePlugin`); without it such builds ship no sink.
 */
export function normalizeCollectorOption(value) {
  if (value === undefined || value === null || value === false) return null;
  const object = typeof value === 'object' && !Array.isArray(value) ? value : { url: value };
  for (const key of Object.keys(object)) if (!['url', 'allowRemote', 'force'].includes(key)) throw new TypeError(`collector: unknown option ${JSON.stringify(key)}`);
  const { url: raw, allowRemote = false, force = false } = object;
  if (typeof allowRemote !== 'boolean' || typeof force !== 'boolean') throw new TypeError('collector.allowRemote and collector.force must be booleans');
  if (typeof raw !== 'string' || !raw.trim()) throw new TypeError('collector must be a non-empty string (http(s) URL or root-relative path) or { url, allowRemote, force }');
  const text = raw.trim().replace(/\/+$/u, '');
  if (text.startsWith('/') && !text.startsWith('//')) {
    if (!/^\/[\x21-\x7E]*$/u.test(text)) throw new TypeError('collector path must be printable ASCII');
    return { url: text, allowRemote, force };
  }
  let url;
  try { url = new URL(text); } catch { throw new TypeError(`collector must be an http(s) URL or a root-relative path, got ${JSON.stringify(raw)}`); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new TypeError('collector URL must be http or https');
  if (url.search || url.hash) throw new TypeError('collector URL must not carry a query or fragment');
  if (!allowRemote && !isLoopbackHost(url.hostname)) {
    throw new TypeError(`collector ${JSON.stringify(text)} is not a loopback address; the sink is localhost-only unless collector: { url, allowRemote: true }`);
  }
  return { url: text, allowRemote, force };
}

// Kept as a real function so it is syntax-checked and testable; shipped as its source text.
/* eslint-disable no-var */
function installProductTraceCollectorSink(global, endpoint) {
  if (global.__productTraceCollectorStats) return;
  var nativeFetch = typeof global.fetch === 'function' ? global.fetch.bind(global) : null;
  var nativeSetTimeout = global.setTimeout.bind(global);
  var nativeBeacon = global.navigator && typeof global.navigator.sendBeacon === 'function' ? global.navigator.sendBeacon.bind(global.navigator) : null;
  var previous = global.__producttraceHostCapture;
  var url = endpoint + '/ingest';
  var queue = []; var flushing = false; var timer = null; var fallbackPage = null;
  var stats = { received: 0, sent: 0, batches: 0, retries: 0, dropped: 0, beacon: 0, malformed: 0 };
  var warned = false;
  var warnOnce = function (what) {
    if (warned) return; warned = true;
    try { if (global.console && typeof global.console.warn === 'function') global.console.warn('[producttrace] collector sink ' + what + '; see __productTraceCollectorStats()'); } catch (error) { /* no console */ }
  };
  var BATCH = 200; var DELAY = 200;
  var pageId = function () {
    var runtime = global.__productTraceRuntime;
    if (runtime && typeof runtime.session === 'string') return runtime.session;
    if (!fallbackPage) fallbackPage = 'p_' + Math.random().toString(36).slice(2, 10);
    return fallbackPage;
  };
  var take = function (count) {
    var batch = queue.splice(0, count); var page = pageId();
    for (var index = 0; index < batch.length; index += 1) if (batch[index] && batch[index].capture_page_id == null) batch[index].capture_page_id = page;
    return batch;
  };
  var send = function (batch, attempt, done) {
    if (!nativeFetch) { stats.dropped += batch.length; warnOnce('dropped rows (no fetch)'); done(); return; }
    var body = JSON.stringify(batch);
    var retry = function () {
      if (attempt >= 4) { stats.dropped += batch.length; warnOnce('dropped rows after retries'); done(); return; }
      stats.retries += 1;
      nativeSetTimeout(function () { send(batch, attempt + 1, done); }, 50 * Math.pow(2, attempt));
    };
    var request;
    try {
      request = nativeFetch(url, { method: 'POST', body: body, headers: { 'content-type': 'text/plain' }, mode: 'cors', credentials: 'omit', keepalive: body.length < 60000 });
    } catch (error) { retry(); return; }
    request.then(function (response) {
      if (response && response.ok) { stats.sent += batch.length; stats.batches += 1; done(); } else retry();
    }, retry);
  };
  var flush = function () {
    timer = null;
    if (flushing || !queue.length) return;
    flushing = true;
    var next = function () {
      if (!queue.length) { flushing = false; return; }
      send(take(BATCH), 0, next);
    };
    next();
  };
  var schedule = function () {
    if (queue.length >= BATCH) { if (!flushing) nativeSetTimeout(flush, 0); return; }
    if (!timer) timer = nativeSetTimeout(flush, DELAY);
  };
  global.__producttraceHostCapture = function (text) {
    if (typeof previous === 'function') { try { previous(text); } catch (error) { /* the host's hook is not ours to fix */ } }
    var row = null;
    try { var payload = JSON.parse(text); row = payload && payload.row ? payload.row : payload; } catch (error) { row = null; }
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      // Not a row: counted, and reported to the store as a capture.dropped row
      // (its length only, never its content) so the store can say malformed_records.
      stats.malformed += 1; warnOnce('received a malformed row');
      queue.push({ kind: 'capture.dropped', reason: 'malformed_host_payload', count: 1, length: typeof text === 'string' ? text.length : null, timestamp: Date.now() });
      schedule(); return;
    }
    stats.received += 1; queue.push(row); schedule();
  };
  if (typeof global.addEventListener === 'function') {
    global.addEventListener('pagehide', function () {
      // The runtime's capture.summary (rows emitted, last sequence, this
      // sink's dropped / malformed counts) must ship in this same beacon.
      var runtime = global.__productTraceRuntime;
      if (runtime && typeof runtime.captureSummary === 'function') { try { runtime.captureSummary('pagehide'); } catch (error) { /* counted by the runtime */ } }
      if (!queue.length) return;
      var rows = take(queue.length);
      // The summary ships first, in its own beacon: the browser caps what
      // pagehide beacons may carry, and a summary lost behind a long queue
      // leaves the page's coverage unprovable. Rows after it that do not fit
      // are counted as dropped; the summary's last_sequence shows the gap.
      var summaries = []; var others = [];
      for (var at = 0; at < rows.length; at += 1) (rows[at] && rows[at].kind === 'capture.summary' ? summaries : others).push(rows[at]);
      rows = summaries.concat(others);
      var chunk = [];
      var ship = function () {
        if (!chunk.length) return;
        var body = JSON.stringify(chunk);
        var ok = false;
        try { ok = nativeBeacon ? nativeBeacon(url, body) : false; } catch (error) { ok = false; }
        if (ok) { stats.beacon += chunk.length; stats.sent += chunk.length; } else stats.dropped += chunk.length;
        chunk = [];
      };
      for (var index = 0; index < rows.length; index += 1) {
        if (index === summaries.length && summaries.length) ship();
        chunk.push(rows[index]);
        if (JSON.stringify(chunk).length > 60000) { var last = chunk.pop(); ship(); chunk.push(last); }
      }
      ship();
    });
  }
  global.__productTraceCollectorStats = function () {
    return { endpoint: endpoint, queued: queue.length, received: stats.received, sent: stats.sent, batches: stats.batches, retries: stats.retries, dropped: stats.dropped, beacon: stats.beacon, malformed: stats.malformed };
  };
}
/* eslint-enable no-var */

/** Settings-script source that installs the sink for a (validated) collector option. */
export function collectorSinkSource(option) {
  const value = normalizeCollectorOption(option);
  if (!value) return '';
  return `(${installProductTraceCollectorSink.toString()})(typeof globalThis!=='undefined'?globalThis:window,${JSON.stringify(value.url)});`;
}
