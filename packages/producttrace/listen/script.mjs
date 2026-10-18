// The listen-mode script as text, with its settings baked in, and the
// fingerprint it gives a function (so a build step can compute the same one).
import fs from 'node:fs';

const SOURCE = fs.readFileSync(new URL('./listener.js', import.meta.url), 'utf8');

/** The browser script, ready to put in a <script> tag or a test's init script. */
export function listenScript({
  endpoint,
  values = false,
  flushMs = 5000,
  serverTimingName = 'rid',
  maxRows = 200,
  slowScripts = false,
} = {}) {
  if (typeof endpoint !== 'string' || !endpoint)
    throw new Error('listenScript needs an endpoint URL to send rows to');
  const config = {
    endpoint,
    values: Boolean(values),
    flushMs,
    serverTimingName,
    maxRows,
    slowScripts: Boolean(slowScripts),
  };
  // JSON is a JavaScript expression; escape "<" so the text is safe inside a <script> element.
  // A replacer function, so "$&" or "$'" in a setting is never expanded.
  const literal = JSON.stringify(config).replaceAll('<', '\\u003c');
  return SOURCE.replace('__CIRCUIT_LISTEN_CONFIG__', () => literal);
}

/** The fingerprint listen mode gives a function whose source text is `source`: `<fnv1a hex>:<length>`. */
export function fingerprintSource(source) {
  const text = String(source);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${(hash >>> 0).toString(16)}:${text.length}`;
}
