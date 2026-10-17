/**
 * One-line installation for Next.js: `export default withProducttrace(nextConfig)`.
 *
 * Under `next dev` (Turbopack or webpack) the wrapper:
 * - adds a loader for first-party browser modules (next-transform.mjs): the
 *   runtime-attribution pass plus one import of the in-page recorder;
 * - writes that recorder to `node_modules/.producttrace/next-client.js`
 *   (settings, the attribution runtime and the producttrace runtime, run as
 *   classic scripts the first time any instrumented module loads);
 * - runs a store-mode collector on its own server bound to 127.0.0.1; the
 *   page posts rows to it directly and the live story is at
 *   `http://127.0.0.1:<port>/__producttrace/`. Next.js never routes it, so
 *   the app's middleware (a sign-in redirect) and a dev server listening on
 *   the network cannot reach or block it.
 *
 * Every other phase (`next build`, `next start`, tests) gets the app's config
 * back untouched. Nothing in the app's source tree is written.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectorSinkSource, normalizeCollectorOption } from './collector-sink.mjs';
import { LOCAL_COLLECTOR_BASE, localCollector } from './local-collector.mjs';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const loaderPath = path.join(packageRoot, 'integrations', 'next-loader.cjs');
const DEV_PHASE = 'phase-development-server';
const SOURCES = /\.(?:[cm]?js|jsx|ts|tsx|mts|cts)$/u;

function repositoryRoot(start) {
  let cursor = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(cursor, '.git'))) return cursor;
    const parent = path.dirname(cursor);
    if (parent === cursor) return path.resolve(start);
    cursor = parent;
  }
}

/**
 * @param {object | ((phase: string, context: object) => object | Promise<object>)} nextConfig
 * @param {object} [options] repository, firstParty, collector (false or a URL), inputText, labels, bodies, stamps
 */
export function withProducttrace(nextConfig = {}, options = {}) {
  return async function producttraceNextConfig(phase, context) {
    const config = (await (typeof nextConfig === 'function' ? nextConfig(phase, context) : nextConfig)) || {};
    if (phase !== DEV_PHASE || process.env.NODE_ENV === 'test' || process.env.VITEST) return config;
    return instrumentNextConfig(config, options);
  };
}

async function instrumentNextConfig(config, options) {
  const cwd = process.cwd();
  const repository = fs.realpathSync(options.repository || repositoryRoot(cwd));
  const cacheDir = path.join(cwd, 'node_modules', '.producttrace');
  const clientModule = path.join(cacheDir, 'next-client.js');
  fs.mkdirSync(cacheDir, { recursive: true });

  const own = options.collector === undefined;
  // `next dev` loads the config in its CLI process too; only the server it forks (NEXT_PRIVATE_WORKER) serves the app.
  const server = Boolean(process.env.NEXT_PRIVATE_WORKER);
  if (own && server) {
    const { url, started } = await ownCollector({ cacheDir, sourceRoot: repository });
    fs.writeFileSync(clientModule, clientSource({ ...options, collector: normalizeCollectorOption(url) }));
    if (started) console.log(`  - producttrace: ${url}/`);
  } else if (!own || !fs.existsSync(clientModule)) {
    // The CLI process writes a placeholder (no sink) so the module exists; the server writes the real one.
    fs.writeFileSync(clientModule, clientSource({ ...options, collector: own ? null : normalizeCollectorOption(options.collector) }));
  }
  // A collector given by URL (say a bench's) follows the merged manifest file in the cache directory.
  if (server) followManifests(cacheDir);

  const loaderOptions = JSON.parse(JSON.stringify({ repository, cacheDir, clientModule, firstParty: options.firstParty }));
  const result = { ...config };
  result.turbopack = withTurbopackRule(config.turbopack, loaderOptions);
  const userWebpack = config.webpack;
  result.webpack = (webpackConfig, context) => {
    const resolved = userWebpack ? userWebpack(webpackConfig, context) : webpackConfig;
    if (context?.dev && !context.isServer) {
      resolved.module.rules.push({ test: SOURCES, exclude: /[\\/]node_modules[\\/]/u, enforce: 'pre',
        use: [{ loader: loaderPath, options: loaderOptions }] });
    }
    return resolved;
  };
  return result;
}

/** The in-page recorder: same settings and runtimes the Vite plugin puts in index.html. */
function clientSource({ collector, inputText = false, labels, bodies = true, stamps }) {
  // In a checkout the attribution runtime's source is newer than its dist copy (see vite.mjs).
  const read = (file) => {
    const source = path.join(packageRoot, 'src', file);
    return fs.readFileSync(file !== 'producttrace-runtime.js' && fs.existsSync(source) ? source : path.join(packageRoot, 'dist', file), 'utf8');
  };
  const settings = `globalThis.__PRODUCTTRACE_LABELS__=${JSON.stringify(labels === false ? 'off' : 'on')};`
    + (stamps === false ? 'globalThis.__PRODUCTTRACE_STAMPS__=false;' : '')
    + `globalThis.__PRODUCTTRACE_BODIES__=${JSON.stringify(bodies === false ? 'off' : 'on')};`
    + `globalThis.__PRODUCTTRACE_INPUT_TEXT__=${JSON.stringify(inputText ? 'on' : 'off')};`
    + (collector ? collectorSinkSource(collector) : '');
  // Indirect eval runs each runtime as a classic script in the page's global scope, as a <script> tag would.
  return `// Written by producttrace/next for next dev. Safe to delete.
if (typeof window !== 'undefined' && !globalThis.__producttraceNextClient) {
  globalThis.__producttraceNextClient = true;
  (0, eval)(${JSON.stringify(`${settings}${read('runtime-attribution-browser.js')}\n//# sourceURL=producttrace-attribution.js`)});
  (0, eval)(${JSON.stringify(`${read('producttrace-runtime.js')}\n//# sourceURL=producttrace-runtime.js`)});
}
`;
}

function withTurbopackRule(turbopack = {}, loaderOptions) {
  const rule = {
    loaders: [{ loader: loaderPath, options: loaderOptions }],
    condition: { all: ['browser', 'development', { not: 'foreign' }] },
  };
  const rules = { ...(turbopack.rules || {}) };
  const key = '*.{js,jsx,ts,tsx,mjs,mts}';
  rules[key] = rules[key] === undefined ? [rule] : [...[rules[key]].flat(), rule];
  return { ...turbopack, rules };
}

// One collector per app directory, reused when Next.js loads the config again in this process.
const running = (globalThis.__producttraceNextCollectors ||= new Map());

const following = (globalThis.__producttraceNextManifests ||= new Map());

/** Merge the loader workers' manifests into one file, every 500 ms, once per app directory. */
function followManifests(cacheDir) {
  const manifestFile = path.join(cacheDir, 'runtime-attribution-manifest.json');
  if (following.has(cacheDir)) return manifestFile;
  const manifestDir = path.join(cacheDir, 'next-manifests');
  fs.rmSync(manifestDir, { recursive: true, force: true });
  fs.rmSync(manifestFile, { force: true });
  fs.mkdirSync(manifestDir, { recursive: true });
  const merging = setInterval(() => mergeManifests(manifestDir, manifestFile), 500);
  merging.unref();
  following.set(cacheDir, () => { following.delete(cacheDir); clearInterval(merging); });
  return manifestFile;
}

/**
 * The app's collector on its own server, bound to 127.0.0.1 only. The port is
 * derived from the app folder, so the printed URL stays the same across
 * restarts; a free one is used when that is taken.
 */
async function ownCollector({ cacheDir, sourceRoot }) {
  if (running.has(cacheDir)) return { url: await running.get(cacheDir).url, started: false };
  const manifestFile = followManifests(cacheDir);
  const local = localCollector({ storeDir: path.join(cacheDir, 'store'), manifestFile, sourceRoot, label: 'next' });
  const server = http.createServer((request, response) => {
    if (!local.handle(request, response)) {
      response.statusCode = 404;
      response.end();
    }
  });
  const stop = () => { running.delete(cacheDir); following.get(cacheDir)?.(); server.close(); return local.stop(); };
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, stop);
  const listen = (port) => new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve(server.address().port); });
  });
  const preferred = 30000 + (parseInt(createHash('sha256').update(cacheDir).digest('hex').slice(0, 8), 16) % 20000);
  const url = listen(preferred).catch(() => listen(0)).then((port) => {
    server.unref();
    local.start();
    return `http://127.0.0.1:${port}${LOCAL_COLLECTOR_BASE}`;
  });
  running.set(cacheDir, { url, stop });
  return { url: await url, started: true };
}

const merged = new Map();
/** Loader workers each write their own manifest; the collector follows one file. */
function mergeManifests(directory, target) {
  let files;
  try { files = fs.readdirSync(directory).filter((name) => name.endsWith('.json')).sort(); } catch { return; }
  const stamp = files.map((name) => {
    try { const stat = fs.statSync(path.join(directory, name)); return `${name}:${stat.mtimeMs}:${stat.size}`; } catch { return name; }
  }).join('|');
  if (!files.length || stamp === merged.get(target)) return;
  const functions = new Map(), placements = new Map(), classes = new Map(), boundaries = new Map();
  let base = null;
  for (const name of files) {
    let manifest;
    try { manifest = JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8')); } catch { return; } // mid-write: next tick
    base ||= manifest;
    for (const row of manifest.functions || []) if (!functions.has(row.id)) functions.set(row.id, row);
    for (const row of manifest.placements || []) if (!placements.has(row.index)) placements.set(row.index, row);
    for (const row of manifest.classes || []) if (!classes.has(row.id)) classes.set(row.id, row);
    for (const row of manifest.library_boundaries || []) boundaries.set(JSON.stringify(row), row);
  }
  const next = { ...base, build: null, functions: [...functions.values()], placements: [...placements.values()],
    classes: [...classes.values()], library_boundaries: [...boundaries.values()] };
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(next));
  fs.renameSync(temporary, target);
  merged.set(target, stamp);
}
