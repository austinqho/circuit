// Does the app behave the same with producttrace attached?
//
//   const result = await verifyReadOnly({ serve, steps });
//
// The same steps run three times, each in a fresh browser: twice on the plain
// app (the control) and once with the package. With `mode: 'observe'` the
// third run is the plain app again with debugger mode watching it
// (producttrace/observe), so the check covers that mode instead. Whatever both plain runs agree
// on and the traced run does not is a divergence: a request sent or not sent,
// a different page after a step, a step that failed, a new error, different
// storage. Whatever the two plain runs already disagree on (random ids, clock
// times) is the app's own noise and is not held against the package.
//
// `serve(variant)` starts the app as 'plain' or 'traced' and resolves to
// { baseUrl, ignoreOrigins, close }. Step values may contain {{run}}, replaced
// by a token unique to each run, so a flow that registers a user works against
// a real backend three times.
import crypto from 'node:crypto';
import { observePage } from 'producttrace/observe';
import { BrowserSession } from './browser.mjs';

// Browser APIs the package may replace. Listed so the report says which ones
// the traced page no longer has in their native form.
const NATIVES = [
  'fetch',
  'setTimeout',
  'setInterval',
  'queueMicrotask',
  'requestAnimationFrame',
  'Promise.prototype.then',
  'EventTarget.prototype.addEventListener',
  'EventTarget.prototype.removeEventListener',
  'XMLHttpRequest.prototype.open',
  'XMLHttpRequest.prototype.send',
  'XMLHttpRequest.prototype.setRequestHeader',
  'History.prototype.pushState',
  'History.prototype.replaceState',
  'history.pushState',
  'history.replaceState',
  'WebSocket.prototype.send',
  'Worker.prototype.postMessage',
  'MessagePort.prototype.postMessage',
];
const FOOTPRINT_ATTRIBUTE = /^(?:data-tracer-|oai-)/u;
// Package and dev-server traffic is not the app's.
const OWN_PATH = /^\/(?:__producttrace|@vite|@fs|@id|__vite)/u;

// Up to 10 s: a slower page that ends up the same is overhead, not a divergence.
const SETTLE_TRIES = 20;
const SETTLE_MS = 500;

/** Text with run tokens, generated ids and clock times replaced by placeholders. */
export function normalizer(token) {
  return (value) =>
    String(value ?? '')
      .replaceAll(token, '{{run}}')
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/giu, '<uuid>')
      .replace(
        /\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d+)?)?(?:Z|[+-]\d\d:?\d\d)?/gu,
        '<timestamp>',
      )
      .replace(/\b\d{1,2}:\d\d(?::\d\d)?(?:\s?[AaPp][Mm])?\b/gu, '<clock>')
      .replace(/\b\d{12,}\b/gu, '<n>')
      .replace(/\b[0-9a-f]{16,}\b/giu, '<hex>')
      // nanoid-style ids: long tokens mixing letters and digits, or mixing case at random.
      .replace(/(?<![\w-])(?=[\w-]*\d)(?=[\w-]*[A-Za-z])[\w-]{10,}(?![\w-])/gu, '<id>')
      .replace(
        /(?<![\w-])(?=(?:[\w-]*?[a-z][A-Z]){3})(?=[\w-]*[A-Z]{2})[\w-]{16,}(?![\w-])/gu,
        '<id>',
      );
}

const shape = (item) => item.replace(/\d+/gu, '<d>');

function counts(items) {
  const map = new Map();
  for (const item of items) map.set(item, (map.get(item) || 0) + 1);
  return map;
}

/**
 * Items of `traced` that neither plain run had (`extra`) and items both plain
 * runs had that `traced` lacks (`missing`). An item whose digits are the only
 * thing that differs from something the plain runs disagreed on is noise.
 */
export function compareItems(plainA, plainB, traced) {
  const a = counts(plainA);
  const b = counts(plainB);
  const c = counts(traced);
  const noisy = new Set();
  for (const [item, n] of a) if (n !== (b.get(item) || 0)) noisy.add(shape(item));
  for (const [item, n] of b) if (n !== (a.get(item) || 0)) noisy.add(shape(item));
  const extra = [];
  const missing = [];
  for (const [item, n] of c) {
    const most = Math.max(a.get(item) || 0, b.get(item) || 0);
    if (n > most && !noisy.has(shape(item))) extra.push(item);
  }
  for (const [item, n] of a) {
    const least = Math.min(n, b.get(item) || 0);
    if ((c.get(item) || 0) < least && !noisy.has(shape(item))) missing.push(item);
  }
  return { extra, missing };
}

const sameItems = (reference, lines) => {
  if (!reference) return true;
  const { extra, missing } = compareItems(reference.a, reference.b, lines);
  return !extra.length && !missing.length;
};

async function metrics(cdp) {
  if (!cdp) return null;
  try {
    const { metrics: rows } = await cdp.send('Performance.getMetrics');
    const value = (name) => rows.find((row) => row.name === name)?.value ?? 0;
    return {
      script: value('ScriptDuration') * 1000,
      task: value('TaskDuration') * 1000,
      heap: value('JSHeapUsedSize'),
    };
  } catch {
    return null;
  }
}

const hash = (text) => crypto.createHash('sha1').update(text).digest('hex').slice(0, 10);
// Digests are added after normalizing: hex reads as a generated id to the normalizer.
const LONG_ROW = 300;

/** A request as a comparable item: method, path, and a hash of the normalized body. */
export function requestItem(norm, method, path, body) {
  return `${norm(`${method} ${path}`)}${body ? ` body:${hash(norm(body))}` : ''}`;
}

/** A storage row, normalized; a long one keeps its start and a hash of the whole. */
export function storageRow(norm, raw) {
  const row = norm(raw);
  return row.length > LONG_ROW ? `${row.slice(0, LONG_ROW - 60)}… #${hash(row)}` : row;
}

export async function readStorage(page) {
  return page
    .evaluate(async () => {
      const rows = [];
      const IDB_RECORDS = 500;
      // JSON, with binary data as its size and a checksum (JSON alone drops it).
      const checksum = (bytes) => {
        let sum = 2166136261;
        for (const byte of bytes) sum = Math.imul(sum ^ byte, 16777619) >>> 0;
        return sum.toString(36);
      };
      const describe = (value) => {
        try {
          return (
            JSON.stringify(value, (key, item) => {
              if (item instanceof ArrayBuffer) item = new Uint8Array(item);
              if (ArrayBuffer.isView(item)) {
                const bytes = new Uint8Array(item.buffer, item.byteOffset, item.byteLength);
                return `<${bytes.length} bytes ${checksum(bytes)}>`;
              }
              if (item instanceof Blob) return `<blob ${item.type} ${item.size} bytes>`;
              if (item instanceof Map) return { map: [...item] };
              if (item instanceof Set) return { set: [...item] };
              return item;
            }) ?? String(value)
          ).slice(0, 20000);
        } catch {
          return String(value);
        }
      };
      const each = (store, prefix) => {
        try {
          for (let i = 0; i < store.length; i += 1) {
            const key = store.key(i);
            rows.push(`${prefix} ${key} = ${store.getItem(key)}`);
          }
        } catch {}
      };
      each(localStorage, 'localStorage');
      each(sessionStorage, 'sessionStorage');
      for (const cookie of document.cookie.split(';').filter(Boolean))
        rows.push(`cookie ${cookie.split('=')[0].trim()}`);
      try {
        for (const { name } of (await indexedDB.databases?.()) || []) {
          const db = await new Promise((resolve, reject) => {
            const request = indexedDB.open(name);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          for (const store of Array.from(db.objectStoreNames)) {
            // Every record's key and value, so a changed value shows, not only a changed count.
            const records = await new Promise((resolve) => {
              const out = [];
              const request = db.transaction(store).objectStore(store).openCursor();
              request.onsuccess = () => {
                const cursor = request.result;
                if (!cursor || out.length >= IDB_RECORDS) return resolve(out);
                out.push(`${describe(cursor.key)} = ${describe(cursor.value)}`);
                cursor.continue();
              };
              request.onerror = () => resolve(out);
            });
            rows.push(`indexedDB ${name}/${store}: ${records.length} records`);
            for (const record of records) rows.push(`indexedDB ${name}/${store} ${record}`);
          }
          db.close();
        }
      } catch {}
      return rows;
    })
    .catch(() => []);
}

async function readFootprint(page) {
  return page
    .evaluate(
      ({ natives, attributePattern }) => {
        const pattern = new RegExp(attributePattern, 'u');
        const attributes = {};
        for (const node of document.querySelectorAll('*'))
          for (const name of node.getAttributeNames())
            if (pattern.test(name)) attributes[name] = (attributes[name] || 0) + 1;
        const replaced = natives.filter((dotted) => {
          let value = globalThis;
          for (const part of dotted.split('.')) value = value?.[part];
          if (typeof value !== 'function') return false;
          try {
            return !/\{\s*\[native code\]\s*\}\s*$/u.test(Function.prototype.toString.call(value));
          } catch {
            return false;
          }
        });
        return { attributes, replaced };
      },
      { natives: NATIVES, attributePattern: FOOTPRINT_ATTRIBUTE.source },
    )
    .catch(() => ({ attributes: {}, replaced: [] }));
}

/** One run of the steps on a fresh browser, with everything the comparison reads. */
async function observe({
  baseUrl,
  ignoreOrigins = [],
  steps,
  token,
  reference = null,
  watch = false,
}) {
  const norm = normalizer(token);
  const origin = new URL(baseUrl).origin;
  const session = new BrowserSession(baseUrl, { ignoreOrigins, intercept: false });
  const page = await session.ensure();
  const cdp = await session.context
    .newCDPSession(page)
    .then(async (s) => (await s.send('Performance.enable'), s))
    .catch(() => null);
  const run = {
    token,
    steps: [],
    requests: [],
    headers: [],
    console: [],
    storage: [],
    footprint: null,
    script_ms: 0,
  };
  let stepIndex = 0;
  page.on('request', (request) => {
    if (!['fetch', 'xhr'].includes(request.resourceType())) return;
    const url = new URL(request.url());
    if (ignoreOrigins.includes(url.origin) || OWN_PATH.test(url.pathname)) return;
    run.requests.push({
      step: stepIndex,
      item: requestItem(norm, request.method(), `${url.pathname}${url.search}`, request.postData()),
    });
    // A header added to another origin's request can fail it (CORS preflight).
    const scope = url.origin === origin ? '' : 'cross-origin ';
    for (const name of Object.keys(request.headers()))
      run.headers.push(norm(`${request.method()} ${scope}${url.pathname}: ${name}`));
  });
  page.on('console', (message) => {
    if (message.type() === 'error')
      run.console.push({ step: stepIndex, item: norm(message.text()).slice(0, 300) });
  });
  // Debugger mode attaches before the first step, on its own DevTools session.
  const watcher = watch
    ? await observePage(await session.context.newCDPSession(page), { appOrigin: origin })
    : null;
  const bake = (value) => (typeof value === 'string' ? value.replaceAll('{{run}}', token) : value);
  let before = await metrics(cdp);
  for (const [index, step] of steps.entries()) {
    stepIndex = index;
    const done = await session.act({ ...step, value: bake(step.value) });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
    // Every run waits until the page stops changing (the same tree three times
    // in a row); the traced run also waits, within the limit, until it matches
    // the plain runs. A slower page that ends up the same is overhead, not a divergence.
    let lines = [];
    let settleMs = 0;
    let unchanged = 0;
    for (let attempt = 0; attempt <= SETTLE_TRIES; attempt += 1) {
      const { tree } = await session.snapshot({ maxChars: 200000 });
      const next = norm(tree)
        .split('\n')
        .map((line) => line.trimEnd())
        .filter(Boolean);
      unchanged = next.join('\n') === lines.join('\n') ? unchanged + 1 : 0;
      lines = next;
      if (attempt === SETTLE_TRIES) break;
      if (unchanged >= 2 && sameItems(reference?.[index], lines)) break;
      await page.waitForTimeout(SETTLE_MS);
      settleMs += SETTLE_MS;
    }
    const after = await metrics(cdp);
    const scriptMs = before && after ? Math.max(0, after.script - before.script) : 0;
    before = after;
    run.script_ms += scriptMs;
    run.steps.push({
      description: done.description,
      ok: done.ok,
      error: done.error ? norm(done.error) : null,
      url: norm(new URL(page.url()).pathname + new URL(page.url()).search),
      lines,
      settle_ms: settleMs,
      script_ms: Math.round(scriptMs),
    });
  }
  for (const error of session.errors)
    run.console.push({ step: null, item: `uncaught: ${norm(error.message).slice(0, 300)}` });
  run.storage = (await readStorage(page)).map((row) => storageRow(norm, row));
  run.footprint = await readFootprint(page);
  if (watcher) {
    run.observed = { stats: watcher.stats(), records: watcher.records() };
    await watcher.stop();
  }
  await session.reset();
  return run;
}

const items = (rows) => rows.map((row) => row.item);

const settled = (run) => run.steps.reduce((sum, step) => sum + step.settle_ms, 0);

/** The verdict from two plain runs and one traced run of the same steps. */
export function compareRuns(plainA, plainB, traced) {
  const divergences = [];
  const add = (kind, step, detail) => divergences.push({ kind, step, ...detail });
  const describeStep = (index) =>
    index == null ? null : { index, description: traced.steps[index]?.description ?? null };

  const shown = { extra: new Set(), missing: new Set() };
  traced.steps.forEach((step, index) => {
    const a = plainA.steps[index];
    const b = plainB.steps[index];
    if (!a || !b) return;
    if (a.ok && b.ok && !step.ok) add('step_failed', describeStep(index), { error: step.error });
    else if (!a.ok && !b.ok && step.ok)
      add('step_passed', describeStep(index), { plain_error: a.error });
    if (a.url === b.url && step.url !== a.url)
      add('url', describeStep(index), { plain: a.url, traced: step.url });
    // A difference stays on the page for the steps after it: each one is
    // reported at the step where it first appeared.
    const page = compareItems(a.lines, b.lines, step.lines);
    const extra = page.extra.filter((line) => !shown.extra.has(line));
    const missing = page.missing.filter((line) => !shown.missing.has(line));
    page.extra.forEach((line) => shown.extra.add(line));
    page.missing.forEach((line) => shown.missing.add(line));
    if (extra.length || missing.length)
      add('page', describeStep(index), {
        only_traced: extra.slice(0, 20),
        only_plain: missing.slice(0, 20),
      });
  });

  const channel = (kind, pick) => {
    const { extra, missing } = compareItems(pick(plainA), pick(plainB), pick(traced));
    if (extra.length || missing.length)
      add(kind, null, { only_traced: extra.slice(0, 30), only_plain: missing.slice(0, 30) });
  };
  channel('requests', (run) => items(run.requests));
  // Headers on requests to other origins: one the server does not allow fails
  // the request. Headers on the app's own origin are listed under footprint.
  channel('request_headers', (run) => run.headers.filter((row) => / cross-origin /u.test(row)));
  channel('console_errors', (run) => items(run.console));
  channel('storage', (run) => run.storage);

  const plainScript = (plainA.script_ms + plainB.script_ms) / 2;
  const perStep = traced.steps.map((step, index) => {
    const plain =
      ((plainA.steps[index]?.script_ms ?? 0) + (plainB.steps[index]?.script_ms ?? 0)) / 2;
    return {
      index,
      description: step.description,
      plain_ms: Math.round(plain),
      traced_ms: step.script_ms,
    };
  });
  const worst = perStep.reduce(
    (top, row) =>
      row.traced_ms - row.plain_ms > (top ? top.traced_ms - top.plain_ms : -Infinity) ? row : top,
    null,
  );

  // What the package adds on purpose, so a reviewer sees it rather than discovers it.
  const plainHeaders = new Set([...plainA.headers, ...plainB.headers]);
  const addedHeaders = [
    ...new Set(
      traced.headers.filter((row) => !plainHeaders.has(row)).map((row) => row.split(': ').at(-1)),
    ),
  ];
  const plainReplaced = new Set([...plainA.footprint.replaced, ...plainB.footprint.replaced]);

  return {
    verdict: divergences.length ? 'different' : 'same',
    steps: traced.steps.length,
    divergences,
    overhead: {
      script_ms: { plain: Math.round(plainScript), traced: Math.round(traced.script_ms) },
      ratio: plainScript > 0 ? Number((traced.script_ms / plainScript).toFixed(2)) : null,
      worst_step: worst,
      // Time spent waiting for pages to stop changing; the traced figure also
      // includes waiting until it matched the plain runs.
      settle_ms: {
        plain: Math.round((settled(plainA) + settled(plainB)) / 2),
        traced: settled(traced),
      },
    },
    footprint: {
      dom_attributes: traced.footprint.attributes,
      request_headers: addedHeaders,
      replaced_browser_apis: traced.footprint.replaced.filter((name) => !plainReplaced.has(name)),
    },
    ...(traced.observed ? { observed: summarizeObserved(traced.observed) } : {}),
  };
}

/** What debugger mode recorded: actions, and how each request was joined to one. */
export function summarizeObserved({ stats, records }) {
  const requests = records.filter((row) => row.kind === 'observe.request');
  const via = {};
  for (const row of requests) via[row.via] = (via[row.via] ?? 0) + 1;
  return {
    actions: records.filter((row) => row.kind === 'observe.action').length,
    requests: requests.length,
    joined: requests.filter((row) => row.action_id).length,
    via,
    pauses: stats.pauses,
    paused_ms: stats.paused_ms,
    errors: stats.errors,
    ...(stats.last_error ? { last_error: stats.last_error } : {}),
  };
}

/**
 * Run the steps plain, plain, then traced and compare. `mode: 'observe'`
 * makes the third run the plain app watched by debugger mode. `onProgress(text)` hears
 * each phase. The traced run settles against what the plain runs showed.
 */
export async function verifyReadOnly({ serve, steps, mode = 'rewrite', onProgress = () => {} }) {
  if (!Array.isArray(steps) || !steps.length) throw new Error('verify needs a list of steps');
  if (!['rewrite', 'observe'].includes(mode)) throw new Error(`unknown verify mode "${mode}"`);
  const runOn = async (variant, label, reference, watch = false) => {
    onProgress(`starting the ${variant} app (${label})`);
    const served = await serve(variant);
    try {
      // The first load after a config change can re-optimize dependencies and
      // reload the page; let that happen before anything is observed.
      const warm = new BrowserSession(served.baseUrl, {
        ignoreOrigins: served.ignoreOrigins,
        intercept: false,
      });
      await warm.act({ action: 'goto', value: '/' });
      await warm.page?.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      await warm.reset();
      onProgress(`running the steps (${label})`);
      return await observe({
        ...served,
        steps,
        token: `r${crypto.randomBytes(3).toString('hex')}`,
        reference,
        watch,
      });
    } finally {
      await served.close();
    }
  };
  const plainA = await runOn('plain', 'plain run 1 of 2');
  const plainB = await runOn(
    'plain',
    'plain run 2 of 2',
    plainA.steps.map((step) => ({ a: step.lines, b: step.lines })),
  );
  const traced = await runOn(
    mode === 'observe' ? 'plain' : 'traced',
    mode === 'observe' ? 'run with debugger mode watching' : 'run with producttrace',
    plainA.steps.map((step, index) => ({ a: step.lines, b: plainB.steps[index]?.lines ?? [] })),
    mode === 'observe',
  );
  return { ...compareRuns(plainA, plainB, traced), runs: { plainA, plainB, traced } };
}
