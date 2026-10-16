/**
 * One-line installation for Next.js: `export default withProducttrace(nextConfig)`.
 *
 * Under `next dev` (Turbopack or webpack) the wrapper:
 * - adds a loader for first-party browser modules (next-transform.mjs): the
 *   runtime-attribution pass plus one import of the in-page recorder;
 * - writes that recorder to `node_modules/.producttrace/next-client.js`
 *   (settings, the attribution runtime and the producttrace runtime, run as
 *   classic scripts the first time any instrumented module loads);
 * - runs a store-mode collector on a loopback port and rewrites
 *   `/__producttrace/*` on the app's origin to it, so the live story is at
 *   `/__producttrace/` like the Vite plugin's.
 *
 * Every other phase (`next build`, `next start`, tests) gets the app's config
 * back untouched. Nothing in the app's source tree is written.
 */
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
  const collector = normalizeCollectorOption(own ? LOCAL_COLLECTOR_BASE : options.collector);
  fs.writeFileSync(clientModule, clientSource({ ...options, collector }));

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
  // `next dev` loads the config in its CLI process too; only the server it forks (NEXT_PRIVATE_WORKER) serves the app.
  if (own && process.env.NEXT_PRIVATE_WORKER) {
    const port = await ownCollector({ cacheDir, sourceRoot: repository });
    result.rewrites = withCollectorRewrites(config.rewrites, port);
    const appPort = process.env.PORT || argumentValue(['-p', '--port']) || 3000;
    console.log(`  - producttrace: http://localhost:${appPort}${LOCAL_COLLECTOR_BASE}/`);
  }
  return result;
}

function argumentValue(names) {
  const args = process.argv;
  for (let index = 0; index < args.length; index += 1) {
    if (names.includes(args[index])) return args[index + 1];
    const inline = names.find((name) => args[index].startsWith(`${name}=`));
    if (inline) return args[index].slice(inline.length + 1);
  }
  return null;
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

function withCollectorRewrites(rewrites, port) {
  const target = `http://127.0.0.1:${port}${LOCAL_COLLECTOR_BASE}`;
  const ours = [
    { source: LOCAL_COLLECTOR_BASE, destination: target, basePath: false },
    { source: `${LOCAL_COLLECTOR_BASE}/:path*`, destination: `${target}/:path*`, basePath: false },
  ];
  return async () => {
    const theirs = rewrites ? await rewrites() : [];
    if (Array.isArray(theirs)) return { beforeFiles: ours, afterFiles: theirs, fallback: [] };
    return { ...theirs, beforeFiles: [...ours, ...(theirs.beforeFiles || [])] };
  };
}

// One collector per app directory, reused when Next.js loads the config again in this process.
const running = (globalThis.__producttraceNextCollectors ||= new Map());

function ownCollector({ cacheDir, sourceRoot }) {
  if (running.has(cacheDir)) return running.get(cacheDir).port;
  const manifestDir = path.join(cacheDir, 'next-manifests');
  const manifestFile = path.join(cacheDir, 'runtime-attribution-manifest.json');
  fs.rmSync(manifestDir, { recursive: true, force: true });
  fs.rmSync(manifestFile, { force: true });
  fs.mkdirSync(manifestDir, { recursive: true });
  const local = localCollector({ storeDir: path.join(cacheDir, 'store'), manifestFile, sourceRoot, label: 'next' });
  const server = http.createServer((request, response) => {
    if (!local.handle(request, response)) {
      response.statusCode = 404;
      response.end();
    }
  });
  const merging = setInterval(() => mergeManifests(manifestDir, manifestFile), 500);
  merging.unref();
  const stop = () => { running.delete(cacheDir); clearInterval(merging); server.close(); return local.stop(); };
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, stop);
  const port = new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  }).then((value) => { server.unref(); local.start(); return value; });
  running.set(cacheDir, { port, stop });
  return port;
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
