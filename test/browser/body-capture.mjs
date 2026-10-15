// Body capture (headless, neutral fixture): in a dev build Tracer records
// request and response bodies, bounded and redacted, so an agent can answer
// which entity an action acted on.
//
// Five builds of test/browser/fixtures/body-capture-app, one real collector
// store, the MCP over stdio:
//   dev          mode development, default options      -> bodies "on"
//   dev_off      mode development, bodies: false        -> "off", no rows; page output identical to dev
//   prod         mode production, default               -> "production_off", no rows
//   prod_true    mode production, bodies: true          -> "production_off" + the plugin's warning (built only)
//   prod_always  mode production, bodies: 'always'      -> "on" + the plugin's warning
//   staging      mode staging, default                  -> "on" + the plugin's warning (built only)
//   plain        mode development, no Tracer at all     -> the app's own behaviour (parity baseline)
// Every expected body is computed here from the backend's fixed payloads and
// the app's literal request bodies, never from the runtime's code.
//
//   node test/browser/body-capture.mjs [dependencyRoot] [--out <dir>]
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { buildReactFixture } from './fixture-build.mjs';
import { createCollector } from '../../collector/index.js';
import { createStore, loadStore } from '../../collector/store.mjs';
import * as backend from './fixtures/body-capture-app/backend.mjs';

const tracerRoot = path.resolve(import.meta.dirname, '../..');
const argv = process.argv.slice(2);
const outIndex = argv.indexOf('--out');
const outDir = outIndex >= 0 ? path.resolve(argv[outIndex + 1]) : null;
const positional = argv.filter((value, index) => !value.startsWith('--') && argv[index - 1] !== '--out');
const dependencyRoot = path.resolve(positional[0] || '/Users/austinho/dev/trace-consolidated/.live-demo/librechat-m1');
const fixtureDir = path.join(tracerRoot, 'test/browser/fixtures/body-capture-app');
const appSource = fs.readFileSync(path.join(fixtureDir, 'main.jsx'), 'utf8');
const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tracer-body-store-'));
const collector = createCollector({ port: 0, store: { dir: storeDir, manifest: null, label: 'body-capture' } });
await collector.ready;

// ---- builds (the plugin's warnings are captured from Vite's logger) --------
const warnings = {};
const build = async (label, mode, pluginOptions, instrument = true) => {
  const captured = []; const original = console.warn;
  console.warn = (...args) => { captured.push(args.map(String).join(' ')); };
  try {
    return await buildReactFixture({ dependencyRoot, name: `body-${label}`, appSource, mode, instrument,
      pluginOptions: { collector: { url: collector.url, force: true }, ...pluginOptions } });
  } finally { console.warn = original; warnings[label] = captured.filter(line => line.includes('[producttrace] body capture')); }
};
const builds = {
  dev: await build('dev', 'development', {}),
  dev_off: await build('dev_off', 'development', { bodies: false }),
  prod: await build('prod', 'production', {}),
  prod_true: await build('prod_true', 'production', { bodies: true }),
  prod_always: await build('prod_always', 'production', { bodies: 'always' }),
  staging: await build('staging', 'staging', {}),
  plain: await build('plain', 'development', {}, false),
};
const settingsOf = label => { const html = fs.readFileSync(path.join(builds[label].distRoot, 'index.html'), 'utf8'); return /__PRODUCTTRACE_BODIES__=("[a-z_]+")/u.exec(html)?.[1] ?? null; };

// ---- server: the build's dist + the fixture backend -------------------------
const seenByLabel = {};
const serve = async label => {
  const distRoot = builds[label].distRoot; const seen = []; seenByLabel[label] = seen;
  const server = http.createServer((req, res) => {
    if (backend.handleApi(req, res, seen)) return;
    const url = new URL(req.url, 'http://fixture');
    const file = path.resolve(distRoot, url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
    if (!file.startsWith(`${distRoot}${path.sep}`) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': file.endsWith('.js') ? 'text/javascript' : file.endsWith('.html') ? 'text/html' : 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { origin: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => server.close(resolve)) };
};

// ---- one headless session per served build ------------------------------------
const BUTTONS = [['Rename project', 'rename'], ['Load report', 'report'], ['Load notes', 'notes'], ['Load avatar', 'avatar'],
  ['Stream log', 'stream'], ['XHR save', 'xhr'], ['Upload', 'upload'], ['Post note', 'note'],
  ['Post keys', 'keys'], ['Ticker cancel', 'ticker'], ['Long text', 'longtext'], ['Delete entry', 'delete'], ['Untyped', 'untyped'], ['Blob request', 'blob'],
  ['Pipe text', 'pipetext'], ['Pipe JSON', 'pipejson'], ['Order probe', 'order'], ['Then chain', 'thenchain'], ['Fire and forget', 'fire']];
const { chromium } = createRequire(path.join(dependencyRoot, 'package.json'))('playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.PRODUCTTRACE_BROWSER_EXECUTABLE ? { executablePath: process.env.PRODUCTTRACE_BROWSER_EXECUTABLE } : {}) });
const sessions = {};
try {
  for (const label of ['dev', 'dev_off', 'prod', 'prod_always', 'plain']) {
    const server = await serve(label);
    const page = await browser.newPage();
    const errors = []; page.on('pageerror', error => errors.push(String(error)));
    try {
      await page.goto(server.origin, { waitUntil: 'networkidle' });
      await page.waitForTimeout(300);
      for (const [name, key] of BUTTONS) {
        await page.getByRole('button', { name }).click();
        await page.locator(`[data-status="${key}"]`).waitFor({ timeout: 10000 });
        // The ticker and the fire-and-forget fetch settle after the status appears.
        await page.waitForTimeout(['ticker', 'fire', 'pipetext', 'pipejson'].includes(key) ? 1500 : 250);
      }
      const output = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-status]')].map(node => [node.dataset.status, node.textContent])));
      const session = await page.evaluate(() => globalThis.__productTraceRuntime?.session ?? null);
      const bodyStats = await page.evaluate(() => globalThis.__productTraceRuntime?.bodyStats() ?? null);
      const unhandled = await page.evaluate(() => window.__unhandled);
      const order = await page.evaluate(() => window.__order);
      // What a page can see of the stream prototypes Tracer wraps.
      const prototypes = await page.evaluate(() => {
        const describe = fn => (typeof fn === 'function' ? `${fn.name}/${fn.length}` : String(fn));
        const stream = ReadableStream.prototype;
        return { cancel: describe(stream.cancel), getReader: describe(stream.getReader), pipeThrough: describe(stream.pipeThrough), pipeTo: describe(stream.pipeTo),
          values: describe(stream.values), asyncIterator: describe(stream[Symbol.asyncIterator]), iterator_is_values: stream[Symbol.asyncIterator] === stream.values,
          reader_cancel: describe(ReadableStreamDefaultReader.prototype.cancel), byob_cancel: describe(globalThis.ReadableStreamBYOBReader?.prototype.cancel) };
      });
      await page.goto('about:blank'); await page.waitForTimeout(800);
      sessions[label] = { session, output, errors, unhandled, order, prototypes, bodyStats };
    } finally { await page.close(); await server.close(); }
  }
} finally { await browser.close(); }
await collector.close();

// ---- rows ------------------------------------------------------------------------
const loaded = await loadStore({ dir: storeDir });
const store = createStore({ records: loaded.records, spans: loaded.spans, now: () => Date.now() + 1e6 });
const rawRecords = fs.readFileSync(path.join(storeDir, 'records.jsonl'), 'utf8');
const checks = [];
const check = (name, pass, detail) => checks.push({ name, pass: Boolean(pass), detail });
const rowsOf = (label, kind) => store.records.filter(row => row.capture_page_id === sessions[label].session && (!kind || row.kind === kind));
const clicksOf = label => rowsOf(label, 'dom.action').filter(row => row.event === 'click').sort((left, right) => left.sequence - right.sequence);
const requestsOf = (label, actionId) => rowsOf(label, 'network.request').filter(row => row.action_id === actionId && !row.internal);
const bodyOf = (label, request, direction) => rowsOf(label, 'network.body').filter(row => row.request_occurrence_id === request?.request_occurrence_id && row.direction === direction);
const utf8 = text => Buffer.byteLength(text, 'utf8');
// Independent redaction (the owner's segment rule, written here, not imported):
// words of the key (camelCase / snake / kebab), last word id/ids never secret,
// numbers/booleans/null never redacted.
const WORDS = new Set(['password', 'passwd', 'pwd', 'secret', 'token', 'auth', 'authorization', 'bearer', 'jwt', 'cookie', 'credential', 'credentials', 'ssn', 'otp', 'pin', 'card', 'cvv']);
const wordsOf = key => key.replace(/([a-z0-9])([A-Z])/gu, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/gu, '$1 $2').toLowerCase().split(/[^a-z0-9]+/u).filter(Boolean);
const secretKey = key => {
  const words = wordsOf(key); const last = words.at(-1);
  if (!words.length || last === 'id' || last === 'ids') return false;
  if (words.join(' ') === 'session') return true;
  return words.some((word, index) => WORDS.has(word) || (word === 'key' && words.slice(0, index).some(part => ['api', 'private', 'secret', 'access'].includes(part)))
    || ['password', 'passwd', 'secret', 'token', 'apikey', 'privatekey', 'secretkey', 'accesskey', 'credential', 'credentials', 'cookie', 'jwt'].some(end => word.endsWith(end)));
};
// Numbers only under a strong word, and not when the last word names a quantity.
const numericSecret = key => { const words = wordsOf(key); return secretKey(key) && !['limit', 'limits', 'count', 'counts', 'max', 'min', 'length', 'len', 'size', 'ttl', 'expiry', 'expires', 'expiration', 'at', 'ms', 'seconds', 'version', 'type', 'index', 'budget', 'usage', 'total'].includes(words.at(-1))
  && words.some(word => ['password', 'passwd', 'pwd', 'pin', 'otp', 'cvv', 'card', 'ssn', 'secret', 'credential', 'credentials', 'token'].includes(word)); };
const redact = value => (Array.isArray(value) ? value.map(redact) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).map(([key, child]) => [key, secretKey(key) && child !== null && typeof child !== 'boolean' && (typeof child !== 'number' || numericSecret(key)) ? '[redacted]' : redact(child)])) : value);
const cutBytes = (text, max) => { let out = ''; let bytes = 0; for (const character of text) { const size = utf8(character); if (bytes + size > max) break; out += character; bytes += size; } return out; };

{
  const label = 'dev'; const clicks = clicksOf(label);
  const page = rowsOf(label, 'capture.page')[0];
  check('B0 builds inject the body mode the option rules say', settingsOf('dev') === '"on"' && settingsOf('dev_off') === '"off"' && settingsOf('prod') === '"production_off"'
    && settingsOf('prod_true') === '"production_off"' && settingsOf('prod_always') === '"on"' && settingsOf('staging') === '"on"' && settingsOf('plain') === null, Object.fromEntries(Object.keys(builds).map(key => [key, settingsOf(key)])));
  check('B1 warnings: bodies:true in production says disabled; on in any mode but development says ON (production, staging); dev and defaults silent', warnings.prod_true.length === 1 && /disabled: Vite mode is "production"/u.test(warnings.prod_true[0])
    && warnings.prod_always.length === 1 && /ON in a "production"-mode build/u.test(warnings.prod_always[0]) && warnings.staging.length === 1 && /ON in a "staging"-mode build/u.test(warnings.staging[0])
    && !warnings.dev.length && !warnings.prod.length && !warnings.dev_off.length, warnings);
  const onlyFetchFailure = errors => errors.every(error => /Failed to fetch/u.test(error));
  check('D0 dev: 15 clicks, no page errors but the fire-and-forget fetch failure, capture.page declares bodies "on"', clicks.length === BUTTONS.length && onlyFetchFailure(sessions.dev.errors) && page?.bodies === 'on', { clicks: clicks.length, errors: sessions.dev.errors, bodies: page?.bodies });

  // 1. rename: JSON POST with an entity id and credentials.
  const [rename] = requestsOf(label, clicks[0].action_id);
  const sent = { projectId: 'p_42', name: 'Renamed', password: 'hunter2-secret', owner: { userId: 'u_7', apiToken: 'tok_abc_secret' }, tags: ['a', 'b'] };
  const [renameRequest] = bodyOf(label, rename, 'request'); const [renameResponse] = bodyOf(label, rename, 'response');
  check('D1 rename request body: JSON, ids kept, password and nested apiToken redacted, full size, not truncated', renameRequest && renameRequest.content_type === 'application/json'
    && JSON.stringify(renameRequest.json) === JSON.stringify(redact(sent)) && renameRequest.bytes === utf8(JSON.stringify(sent)) && renameRequest.truncated === false && renameRequest.redactions === 2
    && renameRequest.transport === 'fetch', renameRequest);
  check('D2 rename response body: _id recorded, session redacted, sessionId (an identifier) kept, status 200', renameResponse && JSON.stringify(renameResponse.json) === JSON.stringify(redact(backend.RENAME_RESPONSE))
    && renameResponse.json._id === backend.RENAME_RESPONSE._id && renameResponse.json.session === '[redacted]' && renameResponse.json.sessionId === 'sess_42' && renameResponse.status === 200 && renameResponse.bytes === utf8(JSON.stringify(backend.RENAME_RESPONSE)), renameResponse);
  // 2. report: > 4 KB JSON, cut as serialized text.
  const [report] = requestsOf(label, clicks[1].action_id); const [reportBody] = bodyOf(label, report, 'response');
  const reportSerialized = JSON.stringify(redact(backend.REPORT_RESPONSE));
  check('D3 large JSON response: bytes = full size, truncated, text = the first 4096 bytes of the redacted serialization', reportBody && reportBody.truncated === true
    && reportBody.bytes === utf8(JSON.stringify(backend.REPORT_RESPONSE)) && reportBody.json === undefined && reportBody.format === 'json'
    && reportBody.text === cutBytes(reportSerialized, 4096) && utf8(reportBody.text) <= 4096 && !reportBody.text.includes('report-token-secret'), { bytes: reportBody?.bytes, text_bytes: reportBody && utf8(reportBody.text) });
  // 3. text/plain.
  const [notes] = requestsOf(label, clicks[2].action_id); const [notesBody] = bodyOf(label, notes, 'response');
  check('D4 text/plain response recorded as text', notesBody && notesBody.format === 'text' && notesBody.text === backend.NOTES_TEXT && notesBody.content_type === 'text/plain; charset=utf-8', notesBody);
  // 4. binary.
  const [avatar] = requestsOf(label, clicks[3].action_id); const [avatarBody] = bodyOf(label, avatar, 'response');
  check('D5 binary response: type and size only', avatarBody && avatarBody.captured === false && avatarBody.reason === 'binary' && avatarBody.content_type === 'image/png'
    && avatarBody.bytes === backend.AVATAR_BYTES.length && avatarBody.json === undefined && avatarBody.text === undefined, avatarBody);
  // 5. stream: not read by Tracer; the app reads it intact.
  const [stream] = requestsOf(label, clicks[4].action_id); const [streamBody] = bodyOf(label, stream, 'response');
  const streamText = backend.STREAM_CHUNKS.join('');
  check('D6 streamed response: captured false (streaming), content type recorded', streamBody && streamBody.captured === false && streamBody.reason === 'streaming' && streamBody.content_type === 'application/x-ndjson', streamBody);
  check('D7 the app read the streamed body intact with bodies on', sessions.dev.output.stream?.endsWith(streamText) && sessions.dev.output.stream.startsWith(`${backend.STREAM_CHUNKS.length} lines`), sessions.dev.output.stream);
  // 6. XHR.
  const [xhr] = requestsOf(label, clicks[5].action_id);
  const [xhrRequest] = bodyOf(label, xhr, 'request'); const [xhrResponse] = bodyOf(label, xhr, 'response');
  check('D8 XHR POST: request body redacted (secretKey), response read on load', xhr?.transport === 'xhr' && xhrRequest?.transport === 'xhr'
    && JSON.stringify(xhrRequest.json) === JSON.stringify({ itemId: 'i_9', secretKey: '[redacted]', note: 'plain note' })
    && JSON.stringify(xhrResponse?.json) === JSON.stringify(backend.XHR_RESPONSE) && xhrResponse.status === 200, { xhrRequest, xhrResponse });
  // 7. multipart.
  const [upload] = requestsOf(label, clicks[6].action_id); const [uploadRequest] = bodyOf(label, upload, 'request');
  check('D9 FormData body: type and size only (parts total)', uploadRequest && uploadRequest.captured === false && uploadRequest.reason === 'form_data'
    && uploadRequest.content_type === 'multipart/form-data' && uploadRequest.bytes === 1000 + utf8('photo-label') && uploadRequest.json === undefined && uploadRequest.text === undefined, uploadRequest);
  // 8. JSON sent as text/plain.
  const [note] = requestsOf(label, clicks[7].action_id); const [noteRequest] = bodyOf(label, note, 'request');
  check('D10 JSON posted as text/plain is parsed and redacted', noteRequest && noteRequest.content_type === 'text/plain;charset=UTF-8' && noteRequest.format === 'json'
    && JSON.stringify(noteRequest.json) === JSON.stringify({ noteId: 'n_3', authToken: '[redacted]', text: 'hello' }), noteRequest);
  // Privacy over the raw store file.
  const secrets = ['hunter2-secret', 'tok_abc_secret', 'secret-bearer-xyz', 'cookie-secret-123', 'xhr-secret-value', 't_zz_secret', 'report-token-secret', 'sess_resp_secret',
    'sess-secret', 'apikey-secret', 'xapikey-secret', 'private-secret', 'Password-secret', 'access-secret', 'lower-secret', '4111111111111111', '123-secret', 'otp-secret', 'pin-secret',
    'jwt-secret', 'bearer-secret', 'cred-secret', 'arr-secret', 'deep-arr-secret', 'untyped-secret'];
  check('D11 no secret value, Authorization or Cookie header appears anywhere in records.jsonl', secrets.every(secret => !rawRecords.includes(secret)) && !/"authorization"|"cookie"/iu.test(rawRecords),
    secrets.filter(secret => rawRecords.includes(secret)));
  check('D12 the server did receive the Authorization header and the cookie (the capture, not the app, drops them)', seenByLabel.dev.some(entry => entry.headers.authorization === 'Bearer secret-bearer-xyz')
    && seenByLabel.dev.some(entry => /sid=cookie-secret-123/u.test(entry.headers.cookie || '')), null);
  // Linkage and neutrality of the row shape.
  const bodies = rowsOf(label, 'network.body');
  const requestKeys = new Set(rowsOf(label, 'network.request').map(row => row.request_occurrence_id));
  check('D13 every body row links to a network.request row on the same page; no action_id, no sequence, contiguous body_sequence', bodies.length > 0
    && bodies.every(row => requestKeys.has(row.request_occurrence_id) && row.action_id === undefined && row.sequence === undefined)
    && bodies.map(row => row.body_sequence).sort((a, b) => a - b).every((value, index) => value === index + 1), bodies.map(row => [row.body_sequence, row.request_occurrence_id, row.direction]));
  const firstEight = new Set(clicks.slice(0, 8).flatMap(click => requestsOf(label, click.action_id)).map(row => row.request_occurrence_id));
  const ofFirstEight = bodies.filter(row => firstEight.has(row.request_occurrence_id));
  check('D14 first 8 actions: request bodies only for requests with a body; one response row per response with a body', ofFirstEight.filter(row => row.direction === 'request').length === 4
    && ofFirstEight.filter(row => row.direction === 'response').length === 8, ofFirstEight.map(row => `${row.direction}:${row.request_occurrence_id}`));
  const summary = rowsOf(label, 'capture.summary').at(-1);
  const coverage = store.coverageFor(sessions.dev.session);
  check('D15 capture.summary counts body rows, truncations and pending reads; coverage complete and declares bodies on', summary?.bodies === 'on' && summary.bodies_emitted === bodies.length
    && summary.body_truncations === bodies.filter(row => row.truncated).length && summary.body_truncations === 2 && summary.bodies_not_captured === bodies.filter(row => row.captured === false).length
    && summary.bodies_pending === 0 && coverage.complete === true && coverage.bodies === 'on' && coverage.body_rows?.emitted === bodies.length, { summary: summary && { bodies: summary.bodies, emitted: summary.bodies_emitted, truncations: summary.body_truncations, not_captured: summary.bodies_not_captured }, coverage });
}
// The grader's probes (keys, cancelled stream, unknown-length text, 204, untyped, typeless Request body, fire-and-forget).
{
  const label = 'dev'; const clicks = clicksOf(label);
  const byKey = Object.fromEntries(BUTTONS.map(([, key], index) => [key, clicks[index]]));
  const firstRequest = key => requestsOf(label, byKey[key]?.action_id)[0];
  const [keysRow] = bodyOf(label, firstRequest('keys'), 'request');
  const expectedKeys = { author: 'Ada', authorId: 'u_author', sessionId: 'sess_123', session: '[redacted]', apiKey: '[redacted]', 'x-api-key': '[redacted]',
    privateKey: '[redacted]', Password: '[redacted]', access_token: '[redacted]', accesstoken: '[redacted]', cardNumber: '[redacted]',
    cardId: 'card_7', scorecard: 'A+', cardinality: 'high', cvv: '[redacted]', otp: '[redacted]', pin: '[redacted]', jwt: '[redacted]', bearer: '[redacted]',
    maxTokenLimit: 4096, requiresAuth: true, tokenCount: 12, credentials: '[redacted]',
    items: [{ itemId: 'it_1', token: '[redacted]' }, [{ password: '[redacted]' }]], payload: JSON.stringify({ orderId: 'o_inner' }), note: 'plain note',
    numeric: { pin: '[redacted]', otp: '[redacted]', cvv: '[redacted]', cardNumber: '[redacted]', secretAnswer: '[redacted]', passwordLength: 12, maxTokenLimit: 4096, tokenCount: 7, cardId: 7, requiresPin: false, tokenBudget: 8000, tokenUsage: 120, cardTotal: 3 } };
  check('K1 key segments: secrets redacted (apiKey, x-api-key, privateKey, session, cvv, otp, pin, jwt, bearer, accesstoken, nested and in arrays; numeric pin/otp/cvv/card/secret); ids, author, scorecard, cardinality, quantities and booleans kept',
    keysRow && JSON.stringify(keysRow.json) === JSON.stringify(expectedKeys) && keysRow.redactions === 21, keysRow?.json);
  const serverTicker = name => seenByLabel[name].find(entry => entry.route === 'GET /api/ticker');
  const tickers = Object.fromEntries(['dev', 'dev_off', 'plain', 'prod_always'].map(name => [name, { closed: serverTicker(name)?.closed, written: serverTicker(name)?.written_at_close ?? serverTicker(name)?.written }]));
  const [tickerRow] = bodyOf(label, firstRequest('ticker'), 'response');
  check('T1 the app cancels a text/plain stream: the server sees the close as without Tracer (bytes written by the close within 3 ticks of uninstrumented and bodies off)',
    Object.values(tickers).every(entry => entry.closed === true) && Math.abs(tickers.dev.written - tickers.plain.written) <= 300 && Math.abs(tickers.dev.written - tickers.dev_off.written) <= 300
    && Math.abs(tickers.prod_always.written - tickers.plain.written) <= 300, tickers);
  check('T2 the cancelled stream has a row: captured false, cancelled_by_app, bytes null, bytes_read', tickerRow && tickerRow.captured === false && tickerRow.reason === 'cancelled_by_app' && tickerRow.bytes === null
    && Number.isInteger(tickerRow.bytes_read), tickerRow);
  const [longRow] = bodyOf(label, firstRequest('longtext'), 'response');
  const longText = backend.LONG_TEXT_CHUNKS.join('');
  check('L1 text/plain of unknown length: first 4096 bytes kept, then Tracer lets go; bytes null, bytes_read, truncated', longRow && longRow.captured === true && longRow.format === 'text' && longRow.truncated === true
    && longRow.bytes === null && longRow.bytes_read >= 4096 && longRow.bytes_read < utf8(longText) && longRow.text === longText.slice(0, 4096), longRow && { ...longRow, text: longRow.text?.length });
  check('L2 the app read the whole unknown-length text', sessions.dev.output.longtext === `${longText.length} chars ${longText.slice(0, 3)}…${longText.slice(-3)}`, sessions.dev.output.longtext);
  const deleteRequest = firstRequest('delete');
  check('N1 204: no response row (no content)', deleteRequest && bodyOf(label, deleteRequest, 'response').length === 0 && sessions.dev.output.delete === 'status 204', bodyOf(label, deleteRequest, 'response'));
  const [untypedRow] = bodyOf(label, firstRequest('untyped'), 'response');
  check('U1 response with no content-type: captured false, unknown_type, exact size, never read', untypedRow && untypedRow.captured === false && untypedRow.reason === 'unknown_type' && untypedRow.content_type === null
    && untypedRow.bytes === utf8(JSON.stringify(backend.UNTYPED_RESPONSE)) && untypedRow.json === undefined && untypedRow.text === undefined && sessions.dev.output.untyped === 'untyped ut_1', untypedRow);
  const [blobRow] = bodyOf(label, firstRequest('blob'), 'request');
  check('R1 a Request object with a typeless Blob body: type and size only, not read, no invented content type', blobRow && blobRow.captured === false && blobRow.reason === 'unknown_type' && blobRow.content_type === null
    && blobRow.bytes === null && blobRow.text === undefined && blobRow.json === undefined && seenByLabel.dev.find(entry => entry.route === 'PUT /api/blob')?.bytes === 11 && sessions.dev.output.blob === 'server got 11', blobRow);
  const pipes = route => Object.fromEntries(['dev', 'dev_off', 'plain', 'prod_always'].map(name => { const entry = seenByLabel[name].find(row => row.route === route);
    return [name, { closed: entry?.closed, written: entry?.written_at_close ?? entry?.written, open_ms: entry?.open_ms ?? null }]; }));
  const sameLifetime = entries => Object.values(entries).every(entry => entry.closed === true)
    && Object.values(entries).every(entry => Math.abs(entry.written - entries.plain.written) <= 300 && Math.abs(entry.open_ms - entries.plain.open_ms) <= 300);
  const pipeText = pipes('GET /api/pipe-text'); const pipeJson = pipes('GET /api/pipe-json');
  check('P1 pipeTo into a destination aborted by its signal (text/plain): bytes written and time to close as without Tracer', sameLifetime(pipeText), pipeText);
  check('P2 pipeTo into a destination that errors (JSON of unknown length): bytes written and time to close as without Tracer', sameLifetime(pipeJson), pipeJson);
  const [pipeJsonRow] = bodyOf(label, firstRequest('pipejson'), 'response');
  check('P3 the piped JSON has a row (cancelled_by_app); no body read is pending at page close', pipeJsonRow?.reason === 'cancelled_by_app' && sessions.dev.bodyStats.pending === 0, { row: pipeJsonRow, stats: sessions.dev.bodyStats });
  check('P4 the wrapped stream prototypes look native: same name/length as uninstrumented, [Symbol.asyncIterator] === values', JSON.stringify(sessions.dev.prototypes) === JSON.stringify(sessions.plain.prototypes)
    && sessions.dev.prototypes.iterator_is_values === true, { dev: sessions.dev.prototypes, plain: sessions.plain.prototypes });
  const orders = Object.fromEntries(['dev', 'dev_off', 'prod', 'prod_always', 'plain'].map(name => [name, sessions[name].order]));
  const fulfil = order => JSON.stringify({ race: order.race, settled: order.settled, same: order.same });
  check('P5 microtask order on the fulfilment path is unchanged with bodies on', Object.values(orders).every(order => fulfil(order) === fulfil(orders.plain)), orders);
  // Amended (fix/client-aborts): a fetch that carries an AbortSignal is tracked for client
  // aborts in every instrumented build, through the same derived promise, so the one-tick
  // difference on its rejection path no longer depends on the body setting.
  check('P6 documented difference: on the abort path of a signal-carrying fetch the rejection reaction runs one microtask later in every instrumented build (listener-micro,b,fetch-rejected vs listener-micro,fetch-rejected,b without Tracer)',
    orders.plain.abort === 'listener-micro,fetch-rejected,b' && ['dev', 'dev_off', 'prod', 'prod_always'].every(name => orders[name].abort === 'listener-micro,b,fetch-rejected'), orders);
  // response_of ("after response", fix/mcp-gaps) on continuations of the fetch the app received.
  const afterResponse = (name, key) => {
    const click = clicksOf(name)[BUTTONS.findIndex(([, k]) => k === key)];
    const request = requestsOf(name, click?.action_id)[0];
    return rowsOf(name, 'function.enter').filter(row => request && row.response_of === request.request_occurrence_id).length;
  };
  const marks = Object.fromEntries(['dev', 'dev_off', 'prod_always', 'prod'].map(name => [name, { thenchain: afterResponse(name, 'thenchain'), rename: afterResponse(name, 'rename') }]));
  check('A1 response_of marks on a .then chain and an await of the fetch are identical with bodies on and off (thenchain >= 2, rename >= 1)',
    marks.dev.thenchain >= 2 && marks.dev.rename >= 1 && Object.values(marks).every(entry => JSON.stringify(entry) === JSON.stringify(marks.dev_off)), marks);
  const rejections = Object.fromEntries(['dev', 'dev_off', 'prod', 'prod_always', 'plain'].map(name => [name, { unhandled: sessions[name].unhandled.length, pageerrors: sessions[name].errors.filter(error => /Failed to fetch/u.test(error)).length }]));
  check('F1 a fire-and-forget fetch failure raises unhandledrejection and a page error exactly as without Tracer (bodies on, off, production, uninstrumented)',
    Object.values(rejections).every(entry => entry.unhandled === 1 && entry.pageerrors === 1), rejections);
}
// Off and production.
{
  const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
  check('O1 dev_off: capture.page bodies "off", no body rows, coverage complete', rowsOf('dev_off', 'capture.page')[0]?.bodies === 'off' && rowsOf('dev_off', 'network.body').length === 0 && store.coverageFor(sessions.dev_off.session).complete === true, null);
  check('O2 parity: the page output is identical with bodies on, off and without Tracer', same(sessions.dev.output, sessions.dev_off.output) && same(sessions.dev.output, sessions.plain.output)
    && same(sessions.dev_off.errors, sessions.plain.errors), { on: sessions.dev.output, off: sessions.dev_off.output, plain: sessions.plain.output });
  const shape = label => rowsOf(label).filter(row => row.kind !== 'network.body' && row.kind !== 'element.stamp' && Number.isInteger(row.sequence))
    .map(row => `${row.kind}|${row.event || ''}|${row.method || ''}|${row.kind === 'network.request' ? String(row.url).replace(/^http:\/\/127\.0\.0\.1:\d+/u, '') : ''}|${row.action_id ? 'a' : '-'}`);
  check('O3 the attributed rows have the same kinds, order, requests and ownership with bodies on and off', same(shape('dev'), shape('dev_off')), { dev: shape('dev').length, dev_off: shape('dev_off').length });
  check('O4 prod (default): capture.page bodies "production_off", no body rows', rowsOf('prod', 'capture.page')[0]?.bodies === 'production_off' && rowsOf('prod', 'network.body').length === 0 && same(sessions.prod.output, sessions.dev.output), null);
  check('O5 prod with bodies:"always": capture.page bodies "on", body rows present, same output', rowsOf('prod_always', 'capture.page')[0]?.bodies === 'on'
    && rowsOf('prod_always', 'network.body').length === rowsOf('dev', 'network.body').length && same(sessions.prod_always.output, sessions.dev.output), rowsOf('prod_always', 'network.body').length);
}

// ---- MCP over stdio ---------------------------------------------------------------
const client = new Client({ name: 'body-capture', version: '1' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(tracerRoot, 'mcp/server.mjs'), '--store', storeDir], stderr: 'ignore' }));
const mcp = {};
try {
  const call = async (name, args) => (await client.callTool({ name, arguments: args })).structuredContent;
  const { tools } = await client.listTools();
  const schema = tools.find(tool => tool.name === 'action_chain').inputSchema;
  check('M0 action_chain publishes include_bodies (boolean)', schema.properties.include_bodies?.type === 'boolean', schema.properties.include_bodies);
  const clicks = clicksOf('dev');
  const rename = await call('action_chain', { action_id: clicks[0].action_id });
  const segment = rename.segments[0];
  mcp.rename = { summary: rename.summary.split('\n')[0], body: segment.body, response_body: segment.response_body };
  check('M1 rename segment: request body summary with the entity id and the redacted value rendered as a plain string', rename.bodies === 'on' && segment.body.fields.projectId === 'p_42'
    && segment.body.fields.password === '[redacted]' && segment.body.fields.tags === '[2 items]' && segment.body.fields.owner === '{2 keys}'
    && segment.body.ids.projectId === 'p_42' && segment.body.ids['owner.userId'] === 'u_7' && segment.body.truncated === false && segment.body.json === undefined, segment.body);
  check('M2 rename segment: response body summary names the _id and the sessionId; session is "[redacted]"', segment.response_body.ids._id === backend.RENAME_RESPONSE._id && segment.response_body.ids.sessionId === 'sess_42'
    && segment.response_body.fields.session === '[redacted]' && segment.response_body.status === 200, segment.response_body);
  check('M3 the one-line summary names the request and response ids', rename.summary.includes('request ids projectId=p_42, owner.userId=u_7') && rename.summary.includes(`response ids _id=${backend.RENAME_RESPONSE._id}, projectId=p_42`), rename.summary.split('\n')[0]);
  const full = await call('action_chain', { action_id: clicks[0].action_id, include_bodies: true });
  const renameRow = rowsOf('dev', 'network.body').find(row => row.request_occurrence_id === segment.request_occurrence_id && row.direction === 'request');
  check('M4 include_bodies: true returns the stored JSON in full', JSON.stringify(full.segments[0].body.json) === JSON.stringify(renameRow.json)
    && full.segments[0].response_body.json._id === backend.RENAME_RESPONSE._id, full.segments[0].body);
  const report = await call('action_chain', { action_id: clicks[1].action_id });
  mcp.report = report.segments[0].response_body;
  check('M5 truncated JSON: summary from the cut text, truncated true, top-level ids kept, rows as [n+ items]', report.segments[0].response_body.truncated === true
    && report.segments[0].response_body.ids.reportId === 'r_7' && report.segments[0].response_body.ids.ownerId === 'u_7' && report.segments[0].response_body.fields.accessToken === '[redacted]'
    && /^\[\d+\+ items\]$/u.test(report.segments[0].response_body.fields.rows) && report.segments[0].response_body.fields_partial === true, report.segments[0].response_body);
  const avatar = await call('action_chain', { action_id: clicks[3].action_id });
  check('M6 binary response rendered as captured false with its reason and size', avatar.segments[0].response_body.captured === false && avatar.segments[0].response_body.reason === 'binary'
    && avatar.segments[0].response_body.bytes === backend.AVATAR_BYTES.length, avatar.segments[0].response_body);
  const key = clicks[0].target?.element_key;
  const history = await call('element_history', { element_key: key });
  const attemptSegment = history.attempts[0].segments[0];
  mcp.history = attemptSegment.body;
  check('M7 element_history attempts show only the id-shaped fields', JSON.stringify(Object.keys(attemptSegment.body).sort()) === JSON.stringify(['captured', 'direction', 'ids', 'truncated'])
    && attemptSegment.body.ids.projectId === 'p_42' && attemptSegment.response_body.ids._id === backend.RENAME_RESPONSE._id && attemptSegment.body.fields === undefined, attemptSegment);
  const invalid = await client.callTool({ name: 'action_chain', arguments: { action_id: clicks[0].action_id, include_bodies: 'yes' } });
  check('M8 include_bodies must be a boolean', invalid.isError === true && invalid.structuredContent.errors.includes('include_bodies must be a boolean'), invalid.structuredContent.errors);
  const thenIndex = BUTTONS.findIndex(([, key]) => key === 'thenchain');
  const afterLines = async name => (await call('action_chain', { action_id: clicksOf(name)[thenIndex].action_id })).summary.split('\n').filter(line => /after response/u.test(line));
  const afterOn = await afterLines('dev'); const afterOff = await afterLines('dev_off');
  check('M11 the MCP work listing says "after response" for the .then chain, the same lines with bodies on and off', afterOn.length >= 2 && JSON.stringify(afterOn) === JSON.stringify(afterOff), { afterOn, afterOff });
  const off = await call('action_chain', { action_id: clicksOf('dev_off')[0].action_id });
  check('M9 bodies off: segments carry body: null and the chain declares bodies "off"', off.bodies === 'off' && off.segments[0].body === null && off.segments[0].response_body === null, { bodies: off.bodies });
  const offLine = off.summary.split('\n')[0].replace(/action:[^ ]+/gu, 'A');
  const onLine = rename.summary.split('\n')[0].replace(/action:[^ ]+/gu, 'A').replace(/; (?:sent|request ids|answered|response ids|request body differs|response body differs) .*?(?=\](?: \[outcome|; \(\d+\) ))/gu, ''); // the body clauses (ids; fields since fix/mcp-surfaces), per segment, are the only difference
  check('M10 the frontier line is otherwise identical with bodies on and off', offLine === onLine, { offLine, onLine });
} finally { await client.close(); }

// ---- sizes -----------------------------------------------------------------------
const lineBytes = rows => rows.reduce((sum, row) => sum + utf8(JSON.stringify(row)), 0);
const devRequests = rowsOf('dev', 'network.request').filter(row => !row.internal).length;
const devBodies = rowsOf('dev', 'network.body');
const sizes = { requests: devRequests, body_rows: devBodies.length, body_row_bytes: lineBytes(devBodies), bytes_per_request: Math.round(lineBytes(devBodies) / Math.max(1, devRequests)),
  largest_body_row: Math.max(...devBodies.map(row => utf8(JSON.stringify(row)))), all_rows_bytes_dev: lineBytes(rowsOf('dev')), all_rows_bytes_dev_off: lineBytes(rowsOf('dev_off')),
  per_row: devBodies.map(row => ({ direction: row.direction, transport: row.transport, content_type: row.content_type, captured: row.captured, truncated: row.truncated, bytes: row.bytes, row_bytes: utf8(JSON.stringify(row)) })) };

const failed = checks.filter(entry => !entry.pass);
for (const entry of checks) console.log(`${entry.pass ? 'PASS' : 'FAIL'} ${entry.name}${entry.pass ? '' : `\n  ${String(JSON.stringify(entry.detail)).slice(0, 1500)}`}`);
console.log(`${checks.length - failed.length}/${checks.length} checks pass; store ${storeDir}`);
console.log(JSON.stringify({ sizes: { ...sizes, per_row: undefined }, body_stats: sessions.dev.bodyStats }, null, 2));
if (outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ schema: 'producttrace.body-capture-fixture.v1', headless: true, pass: failed.length === 0, checks, sizes, warnings,
    settings: Object.fromEntries(Object.keys(builds).map(key => [key, settingsOf(key)])), sessions, mcp }, null, 2));
  fs.writeFileSync(path.join(outDir, 'records-body-rows.jsonl'), devBodies.map(row => JSON.stringify(row)).join('\n') + '\n');
}
for (const fixture of Object.values(builds)) fixture.cleanup();
if (outDir) fs.writeFileSync(path.join(outDir, 'server-log.json'), JSON.stringify(Object.fromEntries(Object.entries(seenByLabel).map(([label, entries]) => [label, entries.map(({ headers, ...rest }) => rest)])), null, 2));
if (failed.length) process.exitCode = 1; else fs.rmSync(storeDir, { recursive: true, force: true });
