#!/usr/bin/env node
// G2 generic harness: install the npm-packed producttrace into a fresh Vite +
// React repository with one plugin line in a wrapper config (the repository's
// source is never written), build plugin-disabled and plugin-enabled, run the
// real marker gate, the parity gate and the runtime smoke, then drive a
// per-repository scripted session headless and write immutable evidence.
//
// The harness is repository-agnostic. Everything that knows a repository's UI
// or backend lives in test/browser/sessions/<name>.mjs.
//
// Usage:
//   node test/browser/build-fresh-repo.mjs --repo <fixture root> \
//     --session test/browser/sessions/<name>.mjs --out docs/evidence/<new dir> [--port 4100]
//     [--store <dir> [--label <text>]]
//
// --store (G6): append this run's rows, spans and manifest into a Tracer store
// directory through collector/store-writer.mjs (e.g. <fixture>/.tracer, which
// `producttrace-mcp --store` reads). When the store is inside the fixture, the
// source-clean checks exclude exactly that path; the unfiltered status is also
// recorded.
//
// G5 options:
//   --plugin-options <json>  the object passed in the one plugin line, e.g.
//                            '{"stamps":true,"requestBridge":false}' (default: producttrace())
//   --collector              write the store through the installed package's
//                            `producttrace-collector --store` (port --collector-port,
//                            default port+2) instead of the in-process writer: the
//                            page ships rows itself (`collector` plugin option, added
//                            to the line when absent) and backend spans are relayed.
//                            The harness keeps its own lossless capture and
//                            cross-checks it against the store.
//   --expect-commit <hex>    refuse to run unless the fixture HEAD starts with
//                            this prefix; the run fails (exit 1, source gate
//                            false) if HEAD moves while it runs (shared fixture
//                            checkouts). An empty or non-hex value is an error.
//   --hold                   build, gate, then serve the enabled build + backend
//                            (+ collector) for a human (Part B of G5) until SIGINT;
//                            no scripted session.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { jsFiles, markerGate } from './marker-sites.mjs';

const tracerRoot = path.resolve(import.meta.dirname, '../..');
const { values: args } = parseArgs({ options: {
  repo: { type: 'string' }, session: { type: 'string' }, out: { type: 'string' },
  port: { type: 'string', default: '4100' }, work: { type: 'string' },
  'keep-builds': { type: 'boolean', default: false },
  // Refuse to run unless the fixture HEAD is this commit (prefix), before and after.
  'expect-commit': { type: 'string' },
  store: { type: 'string' }, label: { type: 'string' },
  'plugin-options': { type: 'string' }, collector: { type: 'boolean', default: false },
  'collector-port': { type: 'string' }, hold: { type: 'boolean', default: false },
} });
if (!args.repo || !args.session || !args.out) throw new Error('--repo, --session and --out are required');
const repo = fs.realpathSync(path.resolve(args.repo));
const out = path.resolve(args.out);
if (fs.existsSync(out)) throw new Error(`Evidence directory already exists (evidence is immutable): ${out}`);
fs.mkdirSync(out, { recursive: true });
const session = (await import(pathToFileURL(path.resolve(args.session)).href)).default;
const port = Number(args.port);
if (!(port >= 4000 && port < 5000)) throw new Error('G2 harness ports must be 4xxx');
const collectorPort = Number(args['collector-port'] ?? port + 2);
if (args.collector && !(collectorPort >= 4000 && collectorPort < 5000)) throw new Error('collector port must be 4xxx');
if (args.collector && !args.store) throw new Error('--collector needs --store <dir>');
const collectorOrigin = args.collector ? `http://127.0.0.1:${collectorPort}` : null;
const pluginOptions = (() => {
  const parsed = args['plugin-options'] ? JSON.parse(args['plugin-options']) : null;
  if (parsed !== null && (typeof parsed !== 'object' || Array.isArray(parsed))) throw new Error('--plugin-options must be a JSON object');
  if (!collectorOrigin) return parsed;
  // The harness builds in Vite production mode, where the sink is off unless forced (dev-only by default).
  return { ...(parsed || {}), collector: parsed?.collector ?? { url: collectorOrigin, force: true } };
})();
const appDir = path.join(repo, session.app || '.');
const work = path.resolve(args.work || path.join(path.dirname(repo), '.g2-work', `${session.name}-${Date.now().toString(36)}`));
fs.mkdirSync(work, { recursive: true });
const log = (...parts) => console.error(`[g2:${session.name}]`, ...parts);
const gates = { schema: 'producttrace.g2-build-gates.v1', repository: repo, session: session.name };

// Playwright is harness tooling. Prefer the fixture's own install, else a
// configured one (this machine: the LibreChat fixture's playwright 1.62.1).
function loadPlaywright() {
  const candidates = [process.env.PRODUCTTRACE_PLAYWRIGHT_FROM, appDir, repo,
    '/Users/austinho/dev/trace-consolidated/.live-demo/librechat-m1'].filter(Boolean);
  for (const base of candidates) {
    // Use the first install whose headless browser is actually present.
    try { const require = createRequire(path.join(base, 'package.json')); const module = require('playwright'); const version = require('playwright/package.json').version;
      if (fs.existsSync(module.chromium.executablePath())) return { ...module, version, from: base }; } catch {}
  }
  throw new Error('playwright is not resolvable; set PRODUCTTRACE_PLAYWRIGHT_FROM');
}

// ---------------------------------------------------------------- source guard
const git = (...gitArgs) => execFileSync('git', [`--git-dir=${path.join(repo, '.git')}`, `--work-tree=${repo}`, ...gitArgs], { encoding: 'utf8' }).trim();
const storeDir = args.store ? path.resolve(args.store) : null;
const storeInRepo = storeDir && storeDir.startsWith(repo + path.sep) ? path.relative(repo, storeDir) : null;
// Tracked-source status. A store inside the fixture is Tracer output (a real
// project gitignores it), so exactly that path is excluded, nothing else.
const sourceStatus = () => (storeInRepo ? git('status', '--porcelain', '--', ':(top)', `:(top,exclude)${storeInRepo}`) : git('status', '--porcelain'));
const sourceCommit = git('rev-parse', 'HEAD');
if (args['expect-commit'] !== undefined) {
  // An empty or malformed value must not silently turn the guard off.
  if (!/^[0-9a-f]{4,40}$/u.test(args['expect-commit'])) throw new Error(`--expect-commit must be a 4-40 character hex commit prefix, got ${JSON.stringify(args['expect-commit'])}`);
  if (!sourceCommit.startsWith(args['expect-commit'])) throw new Error(`Fixture HEAD is ${sourceCommit}, expected ${args['expect-commit']}`);
}
const statusBefore = sourceStatus();
if (statusBefore) throw new Error(`Fixture is not clean before the run:\n${statusBefore}`);
gates.source = { commit: sourceCommit, status_before: statusBefore, ...(storeInRepo ? { excluded_store_path: storeInRepo, unfiltered_status_before: git('status', '--porcelain') } : {}) };

// ------------------------------------------------- install the packed package
function installPackedTracer() {
  const install = path.join(work, 'install');
  const packed = JSON.parse(execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', work],
    { cwd: tracerRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  const tarball = path.join(work, packed[0].filename);
  const target = path.join(install, 'node_modules', 'producttrace');
  fs.mkdirSync(target, { recursive: true });
  execFileSync('tar', ['-xzf', tarball, '-C', target, '--strip-components=1']);
  const manifest = JSON.parse(fs.readFileSync(path.join(tracerRoot, 'package.json'), 'utf8'));
  // Dependencies are linked from this checkout (no network); the package's
  // own files come only from the tarball.
  for (const name of Object.keys(manifest.dependencies)) {
    const link = path.join(install, 'node_modules', name);
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(fs.realpathSync(path.join(tracerRoot, 'node_modules', name)), link);
  }
  fs.writeFileSync(path.join(install, 'package.json'), JSON.stringify({ name: 'g2-consumer', private: true, type: 'module' }));
  return { install, tarball: path.basename(tarball), integrity: packed[0].integrity, files: packed[0].files.length,
    packageDir: target };
}
const tracerInstall = installPackedTracer();
gates.package = { tarball: tracerInstall.tarball, integrity: tracerInstall.integrity, files: tracerInstall.files };
log('packed', tracerInstall.tarball);

// ------------------------------------------------------------ wrapper configs
const configCandidates = ['vite.config.ts', 'vite.config.mts', 'vite.config.js', 'vite.config.mjs'];
const originalConfig = configCandidates.map(name => path.join(appDir, name)).find(file => fs.existsSync(file));
if (!originalConfig) throw new Error(`No Vite config in ${appDir}`);
// The ONE line a user adds is `...producttrace()` in `plugins`. The rest of the
// wrapper only redirects outDir outside the fixture (so the source tree is not
// written) and lets the harness build the same config with the line removed.
const PLUGIN_LINE = `...(process.env.G2_PRODUCTTRACE === "0" ? [] : producttrace(${pluginOptions ? JSON.stringify(pluginOptions) : ''})),`;
const wrapper = path.join(tracerInstall.install, 'vite.g2.config.mjs');
fs.writeFileSync(wrapper, `// Generated by build-fresh-repo.mjs. Wraps ${originalConfig} unchanged.
import original from ${JSON.stringify(originalConfig)};
import { producttrace } from 'producttrace/vite';

export default async env => {
  const base = typeof original === 'function' ? await original(env) : await original;
  return {
    ...base,
    build: { ...(base.build || {}), outDir: process.env.G2_OUT_DIR, emptyOutDir: true },
    plugins: [
      ${PLUGIN_LINE}
      ...(base.plugins || []),
    ],
  };
};
`);
// Bank the exact generated wrapper next to the evidence (it lives in a temp install dir otherwise).
fs.mkdirSync(out, { recursive: true });
fs.copyFileSync(wrapper, path.join(out, 'vite.g2.config.mjs'));
gates.install = { original_config: path.relative(repo, originalConfig), wrapper, wrapper_banked: 'vite.g2.config.mjs', plugin_line: PLUGIN_LINE, plugin_options: pluginOptions };

// ------------------------------------------------------------------- builds
const viteBin = path.join(appDir, 'node_modules', 'vite', 'bin', 'vite.js');
const viteVersion = JSON.parse(fs.readFileSync(path.join(appDir, 'node_modules', 'vite', 'package.json'), 'utf8')).version;
// Minimal environment: some configs define process.env into the bundle.
const buildEnv = enabled => ({ PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: os.tmpdir(), NODE_ENV: 'production',
  NODE_OPTIONS: '--max-old-space-size=8192', ...(session.buildEnv || {}),
  G2_PRODUCTTRACE: enabled ? '1' : '0', G2_OUT_DIR: path.join(work, enabled ? 'dist-enabled' : 'dist-disabled') });
const producttraceCache = path.join(appDir, 'node_modules', '.producttrace');
function build(enabled) {
  const label = enabled ? 'enabled' : 'disabled';
  const started = Date.now();
  const result = spawnSync(process.execPath, [viteBin, 'build', '--config', wrapper], { cwd: appDir, env: buildEnv(enabled), encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  fs.writeFileSync(path.join(out, `build-${label}.log`), `${result.stdout || ''}\n${result.stderr || ''}`.replace(/\u001b\[[0-9;]*m/gu, ''));
  if (result.status !== 0) throw new Error(`${label} build failed (see build-${label}.log)`);
  return { label, dir: buildEnv(enabled).G2_OUT_DIR, ms: Date.now() - started };
}
if (fs.existsSync(producttraceCache)) fs.rmSync(producttraceCache, { recursive: true, force: true });
const disabledBuild = build(false);
log('disabled build', disabledBuild.ms, 'ms');
const enabledBuild = build(true);
log('enabled build', enabledBuild.ms, 'ms');
gates.builds = { vite: viteVersion, disabled: disabledBuild, enabled: enabledBuild };
const manifestPath = path.join(producttraceCache, 'runtime-attribution-manifest.json');
const installationPath = path.join(producttraceCache, 'installation.json');
if (!fs.existsSync(manifestPath)) throw new Error('producttrace() did not write its default attribution manifest');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const installation = JSON.parse(fs.readFileSync(installationPath, 'utf8'));
fs.copyFileSync(manifestPath, path.join(out, 'attribution-manifest.json'));
fs.writeFileSync(path.join(out, 'installation-coverage.json'), JSON.stringify({ coverage: installation.coverage,
  frontiers: Object.fromEntries(Object.entries(installation.frontiers).map(([key, rows]) => [key, {
    count: rows.length, by_code: Object.fromEntries(Object.entries(Object.groupBy(rows, row => row.code || 'unknown')).map(([code, list]) => [code, list.length])) }])) }, null, 2));

const statusAfterBuild = sourceStatus();
if (statusAfterBuild) throw new Error(`Build changed the fixture:\n${statusAfterBuild}`);

// ---------------------------------------------------- real marker gate
gates.markers = markerGate(enabledBuild.dir, manifest);
// Span exactness: a manifest id is only joinable with static analysis (and a
// source snippet is only honest) when its span is an exact function boundary
// in the original file. Not a pass/fail gate; reported per repository.
gates.manifest_spans = (() => {
  const ts = createRequire(path.join(tracerRoot, 'package.json'))('typescript');
  const boundaries = new Map(); let exact = 0; const inexact = [];
  for (const row of manifest.functions) {
    const file = row.source.file;
    if (!boundaries.has(file)) {
      const absolute = path.join(repo, file); const set = new Set();
      if (fs.existsSync(absolute)) {
        const content = fs.readFileSync(absolute, 'utf8');
        const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, /\.tsx?$/u.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.JSX);
        const visit = node => { if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node) || ts.isGetAccessor(node) || ts.isSetAccessor(node) || ts.isConstructorDeclaration(node)) && node.body) set.add(`${node.getStart(source)}:${node.getEnd()}`); ts.forEachChild(node, visit); };
        visit(source);
      }
      boundaries.set(file, set);
    }
    if (boundaries.get(file).has(`${row.source.start}:${row.source.end}`)) exact += 1;
    else inexact.push({ index: row.index, file, start: row.source.start, end: row.source.end });
  }
  return { functions: manifest.functions.length, exact_function_boundary: exact, inexact: inexact.length, inexact_sample: inexact.slice(0, 25) };
})();
log('manifest spans', JSON.stringify({ exact: gates.manifest_spans.exact_function_boundary, inexact: gates.manifest_spans.inexact }));
gates.markers_disabled_build_sites = (() => { const count = jsFiles(disabledBuild.dir).reduce((n, file) => n + (fs.readFileSync(file, 'utf8').match(/__productTraceRuntime/gu) || []).length, 0); return count; })();
// Which transport recorder is served: the static-era request bridge is a
// separate asset referenced from index.html; the runtime wrappers are inlined.
gates.served_transport = (() => {
  const html = fs.existsSync(path.join(enabledBuild.dir, 'index.html')) ? fs.readFileSync(path.join(enabledBuild.dir, 'index.html'), 'utf8') : '';
  const bridgeAssets = jsFiles(enabledBuild.dir).filter(file => /producttrace-request-bridge/u.test(path.basename(file))).map(file => path.relative(enabledBuild.dir, file));
  return { bridge_assets: bridgeAssets, index_references_bridge: /producttrace-request-bridge/u.test(html),
    index_inlines_runtime_wrappers: html.includes('productTraceRuntimeFetch'), runtime_asset: /producttrace-runtime\.js/u.test(html) };
})();
log('served transport', JSON.stringify(gates.served_transport));
log('marker gate', JSON.stringify({ pass: gates.markers.pass, functions: gates.markers.manifest_functions, missing: gates.markers.missing_count, unmanifested: gates.markers.unmanifested_count }));

// ---------------------------------------------------- serving + collector
const capture = { rows: [], pages: new Map(), gaps: [], dropped: 0, batches: 0 };
const bridgeRows = []; const lifecycleRows = []; const spans = [];
const readBody = req => new Promise(resolve => { let body = ''; req.setEncoding('utf8'); req.on('data', chunk => { body += chunk; }); req.on('end', () => resolve(body)); });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.webmanifest': 'application/manifest+json' };
function serve(root, listenPort, backendOrigin) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://static');
    if (url.pathname === '/__capture' && req.method === 'POST') {
      try {
        const payload = JSON.parse(await readBody(req)); const pageId = payload.page_id || 'default';
        const state = capture.pages.get(pageId) || { expected: null, received: 0 };
        for (const row of Array.isArray(payload.rows) ? payload.rows : []) {
          // G3 element.stamp rows carry their own per-page counter (stamp_sequence), no sequence.
          if (row?.kind === 'element.stamp' && Number.isFinite(Number(row.stamp_sequence))) {
            const stampSequence = Number(row.stamp_sequence);
            if (state.stampExpected == null) state.stampExpected = stampSequence;
            if (stampSequence > state.stampExpected) capture.gaps.push({ page_id: pageId, counter: 'stamp_sequence', start: state.stampExpected, end: stampSequence - 1 });
            state.stampExpected = Math.max(state.stampExpected, stampSequence + 1); state.received += 1;
            capture.rows.push({ ...row, capture_page_id: pageId });
            continue;
          }
          // A row with neither counter cannot be checked for contiguity; count it
          // (it fails the lossless check) instead of dropping it silently.
          const sequence = Number(row?.sequence); if (!Number.isFinite(sequence)) { capture.unsequenced = (capture.unsequenced || 0) + 1; continue; }
          if (state.expected == null) state.expected = sequence;
          if (sequence > state.expected) capture.gaps.push({ page_id: pageId, start: state.expected, end: sequence - 1 });
          state.expected = Math.max(state.expected, sequence + 1); state.received += 1;
          if (row.kind === 'capture.dropped') capture.dropped += Math.max(0, Number(row.dropped_end) - Number(row.dropped_start) + 1) || 0;
          capture.rows.push({ ...row, capture_page_id: pageId });
        }
        capture.batches += 1; capture.pages.set(pageId, state); res.writeHead(204); res.end();
      } catch { res.writeHead(400); res.end(); }
      return;
    }
    if (url.pathname === '/__spans' && req.method === 'POST') {
      const body = await readBody(req);
      try { spans.push(JSON.parse(body)); res.writeHead(204); } catch { res.writeHead(400); res.end(); return; }
      res.end();
      if (collectorProcess) relaySpan(body);
      return;
    }
    if (url.pathname.startsWith('/__producttrace/')) {
      const body = await readBody(req); try { const value = JSON.parse(body || 'null'); (url.pathname.endsWith('/react-observations') ? lifecycleRows : bridgeRows).push(value); } catch {}
      res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}'); return;
    }
    if (backendOrigin && (session.apiPrefixes || []).some(prefix => url.pathname.startsWith(prefix))) {
      const target = new URL(req.url, backendOrigin);
      const upstream = http.request(target, { method: req.method, headers: { ...req.headers, host: target.host } }, response => { res.writeHead(response.statusCode || 502, response.headers); response.pipe(res); });
      upstream.on('error', error => { res.writeHead(502); res.end(error.message); }); req.pipe(upstream); return;
    }
    let file = path.resolve(root, decodeURIComponent(url.pathname).replace(/^\//u, '') || 'index.html');
    if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      if (path.extname(url.pathname)) { res.writeHead(404); res.end('not found'); return; }
      file = path.join(root, 'index.html'); // SPA history fallback
    }
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' }); fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(listenPort, '127.0.0.1', () => resolve(server)); });
}
const closeServer = server => new Promise(resolve => server ? server.close(() => resolve()) : resolve());

// ---------------------------------------------------- collector (G5, optional)
// The installed package's own CLI, never the working tree's.
let collectorProcess = null; let collectorInfo = null; let spansAtCollectorStart = 0;
const relay = { spans_sent: 0, spans_failed: 0, pending: new Set() };
function relaySpan(body) {
  const pending = fetch(`${collectorOrigin}/spans`, { method: 'POST', body, headers: { 'content-type': 'application/json' } })
    .then(response => { if (response.ok) relay.spans_sent += 1; else relay.spans_failed += 1; }, () => { relay.spans_failed += 1; })
    .finally(() => relay.pending.delete(pending));
  relay.pending.add(pending);
}
async function startCollector() {
  if (!collectorOrigin) return null;
  const cli = path.join(tracerInstall.packageDir, 'collector', 'cli.mjs');
  const cliArgs = [cli, '--store', storeDir, '--manifest', manifestPath, '--source-root', repo, '--port', String(collectorPort), ...(args.label ? ['--label', args.label] : [])];
  spansAtCollectorStart = spans.length; // spans from the parity/smoke page loads precede the store
  collectorProcess = spawn(process.execPath, cliArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  collectorProcess.stdout.on('data', chunk => { output += chunk; });
  collectorProcess.stderr.on('data', chunk => { output += chunk; });
  const deadline = Date.now() + 20000;
  while (!/run (run-[^,]+), build ([^)]+)\)/u.test(output)) {
    if (collectorProcess.exitCode !== null || Date.now() > deadline) throw new Error(`collector did not start:\n${output}`);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const [, runId, build] = /run (run-[^,]+), build ([^)]+)\)/u.exec(output);
  collectorInfo = { command: `node ${path.relative(work, cli)} ${cliArgs.slice(1).join(' ')}`, origin: collectorOrigin, run_id: runId, build, store: storeDir };
  await postRunInfo({ source: { repository: repo, commit: sourceCommit, status_clean: !sourceStatus(), session: session.name } });
  log('collector', collectorOrigin, runId, build);
  return collectorInfo;
}
/** Tell the collector what its run row should record (source, steps, extra). */
async function postRunInfo(info) {
  if (!collectorProcess) return false;
  const response = await fetch(`${collectorOrigin}/run-info`, { method: 'POST', body: JSON.stringify(info), headers: { 'content-type': 'application/json' } }).catch(() => null);
  if (!response?.ok) throw new Error(`collector refused run-info: ${response ? await response.text() : 'unreachable'}`);
  return true;
}
async function stopCollector() {
  if (!collectorProcess) return null;
  await Promise.allSettled([...relay.pending]);
  const exited = new Promise(resolve => collectorProcess.once('exit', code => resolve(code)));
  collectorProcess.kill('SIGTERM');
  const code = await exited;
  collectorProcess = null;
  return code;
}

// ---------------------------------------------------- backend (optional)
let backend = null;
const spanEndpoint = `http://127.0.0.1:${port}/__spans`;
if (session.startBackend) {
  // The installed package's default backend entrypoint, found through its own
  // "exports" map (`producttrace/backend/register`): sessions start the app
  // with `node --import <backendRegister>` and add no loader flag by hand.
  const installedExports = JSON.parse(fs.readFileSync(path.join(tracerInstall.packageDir, 'package.json'), 'utf8')).exports;
  const backendRegister = path.join(tracerInstall.packageDir, installedExports['./backend/register'].import);
  backend = await session.startBackend({ repo, tracerRoot, spanEndpoint, backendRegister, port: port + 1, log, out });
  log('backend', backend.origin);
}

const playwright = loadPlaywright();
gates.playwright = { version: playwright.version, from: playwright.from, headless: true };
const browser = await playwright.chromium.launch({ headless: true });
let enabledServer = null;
try {
  // ---------------------------------------------------- parity gate
  const serializeBody = async (origin, label) => {
    const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage(); const errors = [];
    page.on('pageerror', error => errors.push(String(error.message || error)));
    await page.goto(`${origin}${session.landing || '/'}`, { waitUntil: 'networkidle' }).catch(error => errors.push(String(error.message)));
    if (session.parityReady) await session.parityReady(page).catch(error => errors.push(String(error.message)));
    await page.waitForTimeout(session.paritySettleMs ?? 1500);
    const tree = await page.evaluate(() => {
      // Tracer's own attributes: static-era control stamps, G3 element stamps and the OAI annotation attributes.
      const isTracerAttribute = name => name.startsWith('data-producttrace') || name === 'data-tracer-el' || name === 'oai-annotatable' || name === 'oai-annotation-metadata';
      const lines = [];
      const visit = (node, depth) => {
        if (node.nodeType === Node.TEXT_NODE) { const text = node.textContent.replace(/\s+/gu, ' ').trim(); if (text) lines.push(`${'  '.repeat(depth)}"${text}"`); return; }
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        const tag = node.tagName.toLowerCase(); if (tag === 'script') return;
        // Normalize only values that differ between any two page loads by
        // construction: the serving origin (each build is served on its own
        // port) and object URLs (random per document).
        const normalize = value => value.split(location.origin).join('ORIGIN').replace(/blob:ORIGIN\/[0-9a-f-]{36}/gu, 'blob:ORIGIN/<object-url>');
        const attrs = [...node.attributes].filter(attr => !isTracerAttribute(attr.name)).map(attr => `${attr.name}=${JSON.stringify(normalize(attr.value))}`).sort();
        lines.push(`${'  '.repeat(depth)}<${tag}${attrs.length ? ` ${attrs.join(' ')}` : ''}>`);
        for (const child of node.childNodes) visit(child, depth + 1);
      };
      visit(document.body, 0);
      return { lines, url: location.pathname, stamps: document.querySelectorAll('*').length ? [...document.querySelectorAll('*')].filter(el => [...el.attributes].some(attr => isTracerAttribute(attr.name))).length : 0 };
    });
    await context.close();
    return { label, url: tree.url, lines: tree.lines, stamped_elements: tree.stamps, errors };
  };
  // Both builds are served on the same origin in turn, so origin-scoped app
  // behavior (CORS allowlists, storage) is identical for the comparison.
  const disabledServer = await serve(disabledBuild.dir, port, backend?.origin);
  const disabledA = await serializeBody(`http://127.0.0.1:${port}`, 'disabled');
  const disabledB = await serializeBody(`http://127.0.0.1:${port}`, 'disabled-control');
  await closeServer(disabledServer);
  enabledServer = await serve(enabledBuild.dir, port, backend?.origin);
  const enabledA = await serializeBody(`http://127.0.0.1:${port}`, 'enabled');
  const diffLines = (a, b) => { const out = []; const max = Math.max(a.length, b.length); for (let i = 0; i < max && out.length < 40; i += 1) if (a[i] !== b[i]) out.push({ line: i, a: a[i] ?? null, b: b[i] ?? null }); return out; };
  const controlDiff = diffLines(disabledA.lines, disabledB.lines);
  const parityDiff = diffLines(disabledA.lines, enabledA.lines);
  gates.parity = {
    landing: session.landing || '/', url_disabled: disabledA.url, url_enabled: enabledA.url,
    lines: disabledA.lines.length, identical: JSON.stringify(disabledA.lines) === JSON.stringify(enabledA.lines),
    control_identical: controlDiff.length === 0, diff: parityDiff, control_diff: controlDiff,
    enabled_stamped_elements: enabledA.stamped_elements, errors: { disabled: disabledA.errors, enabled: enabledA.errors },
  };
  gates.parity.pass = gates.parity.identical && disabledA.url === enabledA.url && disabledA.lines.length > 0;
  fs.writeFileSync(path.join(out, 'parity-dom-disabled.txt'), disabledA.lines.join('\n'));
  fs.writeFileSync(path.join(out, 'parity-dom-enabled.txt'), enabledA.lines.join('\n'));
  log('parity gate', JSON.stringify({ pass: gates.parity.pass, lines: gates.parity.lines, diff: parityDiff.length, control_diff: controlDiff.length }));

  // ---------------------------------------------------- runtime smoke
  const smoke = spawnSync(process.execPath, [path.join(tracerRoot, 'test/browser/runtime-attribution-smoke.mjs'), appDir, manifestPath, enabledBuild.dir],
    { cwd: tracerRoot, encoding: 'utf8', env: { ...process.env, PRODUCTTRACE_PLAYWRIGHT_FROM: playwright.from } });
  gates.smoke = smoke.status === 0 ? JSON.parse(smoke.stdout.trim().split('\n').at(-1)) : { status: 'failed', stderr: smoke.stderr.slice(-2000) };
  log('smoke', gates.smoke.status);
  fs.writeFileSync(path.join(out, 'build-gates.json'), JSON.stringify(gates, null, 2));

  // ---------------------------------------------------- hold (G5 Part B)
  if (args.hold) {
    await startCollector();
    const mcpServer = path.join(tracerInstall.packageDir, 'mcp', 'server.mjs');
    const info = { url: `http://127.0.0.1:${port}${session.landing || '/'}`, collector: collectorInfo, store: storeDir,
      mcp: storeDir ? { command: process.execPath, args: [mcpServer, '--store', storeDir, '--source-root', repo] } : null,
      install: tracerInstall.install, plugin_line: PLUGIN_LINE };
    fs.writeFileSync(path.join(out, 'hold.json'), JSON.stringify(info, null, 2));
    console.log(JSON.stringify({ holding: info }, null, 2));
    log('holding: open', info.url, '— Ctrl-C to stop');
    await new Promise(resolve => { process.once('SIGINT', resolve); process.once('SIGTERM', resolve); });
    log('stopping');
    await postRunInfo({ source: { repository: repo, commit: sourceCommit, status_clean: !sourceStatus(), session: session.name }, steps: [], extra: { mode: 'hold', evidence: path.relative(tracerRoot, out) } });
    gates.hold = { ...info, collector_exit: await stopCollector() };
    if (collectorInfo) gates.store = { dir: storeDir, run_id: collectorInfo.run_id, build: collectorInfo.build, via: 'collector' };
    const statusAfterHold = sourceStatus();
    gates.source.status_after = statusAfterHold; gates.source.pass = !statusAfterHold;
    if (storeInRepo) gates.source.unfiltered_status_after = git('status', '--porcelain');
    fs.writeFileSync(path.join(out, 'build-gates.json'), JSON.stringify(gates, null, 2));
    console.log(JSON.stringify({ out, source_clean: !statusAfterHold, store: gates.store ?? null }, null, 2));
  } else {
  // ---------------------------------------------------- scripted session
  await startCollector();
  const origin = `http://127.0.0.1:${port}`;
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const observed = []; const timeline = [];
  const internal = collectorOrigin
    ? new RegExp(`/__capture|/__producttrace/|/__spans|^${collectorOrigin.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}/`, 'u')
    : /\/__capture|\/__producttrace\/|\/__spans/u;
  page.on('request', request => {
    const type = request.resourceType();
    if (!['fetch', 'xhr', 'eventsource', 'websocket'].includes(type) || internal.test(request.url())) return;
    observed.push({ at: Date.now(), method: request.method(), url: request.url().split('?')[0], type });
  });
  page.on('pageerror', error => timeline.push({ kind: 'pageerror', at: Date.now(), message: String(error.message || error).slice(0, 400) }));
  page.on('console', message => { if (message.type() === 'error') timeline.push({ kind: 'console.error', at: Date.now(), text: message.text().slice(0, 300) }); });
  await page.addInitScript(() => {
    const pageId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    const queue = []; let flushing = false; let emitted = 0; let sent = 0;
    const nativeFetch = globalThis.fetch?.bind(globalThis);
    const send = async batch => {
      const body = JSON.stringify({ page_id: pageId, rows: batch });
      for (let attempt = 0; attempt < 5; attempt += 1) {
        try { const response = await nativeFetch('/__capture', { method: 'POST', body, keepalive: body.length < 60000, headers: { 'content-type': 'application/json' } }); if (response.ok) { sent += batch.length; return; } } catch {}
        await new Promise(resolve => setTimeout(resolve, 20 * (2 ** attempt)));
      }
      try { globalThis.__productTraceRuntime?.emit({ kind: 'capture.dropped', dropped_start: batch[0]?.sequence, dropped_end: batch.at(-1)?.sequence, reason: 'capture_chunk_failed' }); } catch {}
    };
    const flush = async () => { if (flushing) return; flushing = true; try { while (queue.length) await send(queue.splice(0, 256)); } finally { flushing = false; } };
    globalThis.__producttraceHostCapture = text => { try { const payload = JSON.parse(text); queue.push(payload.row || payload); emitted += 1; void flush(); } catch {} };
    globalThis.__g2CaptureStats = () => ({ page_id: pageId, emitted, sent, queued: queue.length });
    globalThis.addEventListener('pagehide', () => { const tail = queue.splice(0, queue.length); if (tail.length) navigator.sendBeacon('/__capture', JSON.stringify({ page_id: pageId, rows: tail })); });
  });
  const steps = [];
  const step = async (name, description, fn, { settleMs = 800 } = {}) => {
    const started = Date.now(); let error = null;
    try { await fn(); } catch (caught) { error = String(caught?.message || caught).split('\n')[0]; }
    await page.waitForTimeout(settleMs);
    const entry = { step: steps.length + 1, name, description, started, ended: Date.now(), status: error ? 'stop' : 'done', ...(error ? { error } : {}) };
    entry.stamps = await page.evaluate(() => {
      // G3 T4 interactive-host list; the host itself must carry data-tracer-el.
      const selector = 'button,input,textarea,select,a[href],[role="button"],[role="menuitem"],[role="option"],[role="checkbox"],[role="radio"],[role="switch"],[role="tab"],[role="link"],[tabindex]';
      const all = [...document.querySelectorAll(selector)];
      const visible = all.filter(el => { const box = el.getBoundingClientRect(); return box.width > 0 && box.height > 0; });
      const unstamped = visible.filter(el => !el.hasAttribute('data-tracer-el')).slice(0, 10).map(el => ({ tag: el.tagName.toLowerCase(), role: el.getAttribute('role'), type: el.getAttribute('type'), aria: el.getAttribute('aria-label'), text: (el.textContent || '').trim().slice(0, 40) }));
      return { interactive: all.length, interactive_stamped: all.filter(el => el.hasAttribute('data-tracer-el')).length,
        visible_interactive: visible.length, visible_interactive_stamped: visible.length - visible.filter(el => !el.hasAttribute('data-tracer-el')).length,
        stamped_elements: document.querySelectorAll('[data-tracer-el]').length, unstamped_visible_sample: unstamped,
        stamp_stats: globalThis.__productTraceRuntime?.stampStats?.() || null };
    }).catch(error => ({ error: String(error.message) }));
    steps.push(entry); log('step', entry.step, name, entry.status, error || '');
    await page.screenshot({ path: path.join(out, `step-${String(entry.step).padStart(2, '0')}-${name}.png`) }).catch(() => {});
    return entry;
  };
  const sessionStarted = Date.now();
  await page.goto(`${origin}${session.landing || '/'}`, { waitUntil: 'networkidle' });
  await session.run({ page, step, origin, backend, log, out, packageDir: tracerInstall.packageDir });
  const sessionEnded = Date.now();
  const drainDeadline = Date.now() + 60000;
  while (Date.now() < drainDeadline) { const queued = await page.evaluate(() => globalThis.__g2CaptureStats?.().queued ?? 0).catch(() => 0); if (!queued) break; await page.waitForTimeout(250); }
  // The page's own collector sink (G5): wait until every row it received was sent or counted as dropped.
  let sinkStats = null;
  if (collectorOrigin) {
    while (Date.now() < drainDeadline) {
      sinkStats = await page.evaluate(() => globalThis.__productTraceCollectorStats?.() ?? null).catch(() => null);
      if (!sinkStats || (sinkStats.queued === 0 && sinkStats.sent + sinkStats.dropped === sinkStats.received)) break;
      await page.waitForTimeout(250);
    }
  }
  const pageState = await page.evaluate(() => ({
    emitted: globalThis.__g2CaptureStats?.().emitted ?? null,
    queued_after_drain: globalThis.__g2CaptureStats?.().queued ?? null,
    stamp_stats: globalThis.__productTraceRuntime?.stampStats?.() || null,
    page_id: globalThis.__g2CaptureStats?.().page_id ?? null,
    runtime_records: globalThis.__productTraceRuntime?.records?.length ?? null,
    fetch_wrapper: globalThis.fetch?.name || null,
    xhr_send_wrapper: XMLHttpRequest.prototype.send?.name || null,
    bridge_installed: Boolean(globalThis.__productTraceAutonomousBridge),
    bridge_mapped_actions: globalThis.__productTraceAutonomousBridge?.manifest?.actions?.length ?? null,
  })).catch(() => ({}));
  await page.waitForTimeout(1500); // let backend spans arrive
  await context.close();
  if (backend) await backend.flush?.();
  await postRunInfo({ source: { repository: repo, commit: sourceCommit, status_clean: !sourceStatus(), session: session.name },
    steps: steps.map(({ step: number, name, started, ended, status }) => ({ step: number, name, started, ended, status })),
    extra: { evidence: path.relative(tracerRoot, out) } });
  const collectorExit = await stopCollector();

  // ---------------------------------------------------- analysis (package code)
  const analysis = await import(pathToFileURL(path.join(tracerInstall.packageDir, 'analysis', 'runtime-attribution.mjs')).href);
  // Per page: runtime rows by sequence, then element.stamp rows by their own stamp_sequence.
  const orderKey = row => (row.kind === 'element.stamp' ? [1, Number(row.stamp_sequence)] : [0, Number(row.sequence)]);
  const rows = capture.rows.sort((a, b) => String(a.capture_page_id).localeCompare(String(b.capture_page_id)) || orderKey(a)[0] - orderKey(b)[0] || orderKey(a)[1] - orderKey(b)[1]);
  const stampRows = rows.filter(row => row.kind === 'element.stamp');
  const joined = analysis.attachBackendSpans(rows, spans);
  const units = analysis.indexEntryHandlerUnits(rows);
  const byIndexId = new Map(manifest.functions.map(row => [row.id, row]));
  const sourceCache = new Map();
  const describeFunction = functionId => {
    const entry = byIndexId.get(functionId);
    const match = /^function:([0-9a-f]{64}):(\d+):(\d+)$/u.exec(functionId || '');
    if (!entry || !match) return { function_id: functionId, resolved: false };
    const file = entry.source.file; const absolute = path.join(repo, file);
    if (!sourceCache.has(file)) sourceCache.set(file, fs.existsSync(absolute) ? fs.readFileSync(absolute, 'utf8') : null);
    const content = sourceCache.get(file);
    const start = Number(match[2]); const end = Number(match[3]);
    const hashMatches = content != null && crypto.createHash('sha256').update(content).digest('hex') === match[1];
    const line = content == null ? null : content.slice(0, start).split('\n').length;
    const text = content == null ? null : content.slice(start, end);
    return { function_id: functionId, resolved: true, file, start, end, line, content_hash_matches_fixture: hashMatches,
      snippet: text == null ? null : text.replace(/\s+/gu, ' ').slice(0, 220) };
  };
  const requestRows = rows.filter(row => row.kind === 'network.request' && !row.internal && !internal.test(String(row.url || '')));
  const byAction = new Map();
  for (const row of joined) { if (!row.action_id) continue; const list = byAction.get(row.action_id) || []; list.push(row); byAction.set(row.action_id, list); }
  const actions = rows.filter(row => row.kind === 'dom.action');
  const pathOf = url => { try { return new URL(url, origin).pathname; } catch { return String(url); } };
  const actionReport = action => {
    const related = byAction.get(action.action_id) || [];
    const unitId = units.byAction.get(action.action_id)?.[0] || null;
    const unit = unitId ? units.units.get(unitId) : null;
    const entry = unit ? (unit.entries[unit.action_ids.indexOf(action.action_id)] || null) : null;
    const requests = related.filter(row => row.kind === 'network.request' && !row.internal && !internal.test(String(row.url || '')));
    const perRequest = requests.map(request => {
      const route = related.find(row => row.kind === 'route.dispatch' && row.request_occurrence_id === request.request_occurrence_id);
      const handlers = related.filter(row => row.kind === 'handler.enter' && row.request_occurrence_id === request.request_occurrence_id);
      const dbs = related.filter(row => row.kind === 'db.operation' && row.request_occurrence_id === request.request_occurrence_id);
      const diagnostic = related.find(row => row.kind === 'span.join.diagnostic' && row.request_occurrence_id === request.request_occurrence_id);
      const routeSpan = route && spans.find(span => span.span_id === route.span_id);
      const handlerSpans = handlers.map(row => spans.find(span => span.span_id === row.span_id)).filter(Boolean);
      const terminalHandler = handlerSpans.filter(span => !span.attributes?.['producttrace.express.handler.error_handler']).at(-1);
      let reached = 'network'; let stoppedAt = 'network'; let because;
      if (!backend || backend.instrumented === false) because = backend?.frontier || 'backend not instrumented (frontend-only repository)';
      else if (!route) because = diagnostic ? `no exact backend join: ${diagnostic.reason}` : 'no backend span for this trace';
      else if (!handlers.length) { reached = 'route'; stoppedAt = 'route'; because = 'no registered-handler span under the server span'; }
      else if (!dbs.length) { reached = 'handler'; stoppedAt = 'handler'; because = session.databaseFrontier || 'no database span under the handler'; }
      else { reached = 'db'; stoppedAt = null; because = null; }
      return { method: request.method, path: pathOf(request.url), transport: request.transport, linkage_kind: request.linkage_kind,
        request_occurrence_id: request.request_occurrence_id,
        route: routeSpan ? { span_id: routeSpan.span_id, method: routeSpan.attributes?.['http.request.method'] || routeSpan.attributes?.['http.method'] || null,
          route: routeSpan.attributes?.['http.route'] || null, status: routeSpan.attributes?.['http.response.status_code'] ?? routeSpan.attributes?.['http.status_code'] ?? null } : null,
        handlers: handlerSpans.map(span => ({ span_id: span.span_id, name: span.attributes?.['producttrace.express.handler.name'], route: span.attributes?.['http.route'], index: span.attributes?.['producttrace.express.handler.index'], error: span.status?.code === 2 })),
        terminal_handler: terminalHandler ? terminalHandler.attributes?.['producttrace.express.handler.name'] : null,
        db: dbs.map(row => ({ collection: row.collection, operation: row.operation })),
        reached, stopped_at: stoppedAt, because };
    });
    const mutation = related.find(row => row.kind === 'dom.mutation');
    return { action_id: action.action_id, event: action.event, at: action.timestamp,
      target: action.target ? { tag: action.target.tag, attributes: action.target.attributes } : null,
      entry: unit ? { unit_id: unitId, rooted: entry?.rooted ?? null, invoked_by: entry?.invoked_by ?? null, ...describeFunction(unit.function_id) } : null,
      element_key: action.target?.element_key || null,
      abstention: units.abstentions?.get(action.action_id) ? { stopped_at: units.abstentions.get(action.action_id).stopped_at,
        because: units.abstentions.get(action.action_id).because,
        global_listeners: units.abstentions.get(action.action_id).global_listeners.map(id => { const described = describeFunction(id); return described.resolved ? `${described.file}:${described.line}` : id; }),
        bound_handlers: (units.abstentions.get(action.action_id).bound_handlers || []).map(id => { const described = describeFunction(id); return described.resolved ? `${described.file}:${described.line}` : id; }),
        library_bound: units.abstentions.get(action.action_id).library_bound } : null,
      entry_frontier: unit ? null : units.abstentions?.get(action.action_id) ? `stopped_at entry_handler: ${units.abstentions.get(action.action_id).because}` : ((units.candidatesByAction.get(action.action_id) || []).length ? 'first-party frames ran but none owned terminal evidence' : 'no first-party function entered on this action'),
      mutation: mutation ? { count: mutation.count } : null, requests: perRequest };
  };
  const stepReports = steps.map(entry => {
    const inWindow = actions.filter(action => action.timestamp >= entry.started && action.timestamp <= entry.ended);
    return { ...entry, actions: inWindow.map(actionReport) };
  });
  const outsideSteps = actions.filter(action => !steps.some(entry => action.timestamp >= entry.started && action.timestamp <= entry.ended)).length;

  // Reconcile Playwright-observed requests against wrapper rows (method + path).
  const key = row => `${String(row.method || 'GET').toUpperCase()} ${pathOf(row.url)}`;
  const observedQueue = new Map();
  for (const row of observed) observedQueue.set(key(row), (observedQueue.get(key(row)) || 0) + 1);
  const runtimeQueue = new Map();
  for (const row of requestRows) runtimeQueue.set(key(row), (runtimeQueue.get(key(row)) || 0) + 1);
  const reconciliation = [...new Set([...observedQueue.keys(), ...runtimeQueue.keys()])]
    .map(name => ({ request: name, observed: observedQueue.get(name) || 0, wrapper: runtimeQueue.get(name) || 0 }))
    .filter(row => row.observed !== row.wrapper);

  const received = rows.filter(row => row.kind !== 'capture.dropped').length;
  const coverage = {
    schema: 'producttrace.g2-session-coverage.v1', headless: true, repository: repo, commit: sourceCommit, session: session.name,
    window: { started: new Date(sessionStarted).toISOString(), ended: new Date(sessionEnded).toISOString() },
    capture: (() => {
      // Per page document: sequences must start at 1 and be contiguous (a
      // navigated-away page flushes on pagehide); the live page's emitted
      // count must equal what the collector received for it.
      const perPage = [...capture.pages.keys()].map(pageId => {
        const pageRows = rows.filter(row => row.capture_page_id === pageId);
        const sequences = pageRows.filter(row => row.kind !== 'element.stamp').map(row => row.sequence);
        const stamps = pageRows.filter(row => row.kind === 'element.stamp').map(row => row.stamp_sequence);
        return { page_id: pageId, received: pageRows.length, sequence_rows: sequences.length, first: Math.min(...sequences), last: Math.max(...sequences),
          stamp_rows: stamps.length, stamp_first: stamps.length ? Math.min(...stamps) : null, stamp_last: stamps.length ? Math.max(...stamps) : null };
      });
      const live = perPage.find(page => page.page_id === pageState.page_id);
      const contiguous = perPage.every(page => page.first === 1 && page.last === page.sequence_rows && (page.stamp_rows === 0 || (page.stamp_first === 1 && page.stamp_last === page.stamp_rows)));
      return { received, stamp_rows_received: stampRows.length, unsequenced_rows: capture.unsequenced || 0, dropped: capture.dropped, gaps: capture.gaps, batches: capture.batches, pages: perPage,
        drained: pageState.queued_after_drain === 0,
        live_page_emitted: pageState.emitted, live_page_received: live?.received ?? null,
        lossless: capture.gaps.length === 0 && capture.dropped === 0 && !capture.unsequenced && contiguous && live?.received === pageState.emitted && pageState.queued_after_drain === 0 };
    })(),
    transports: { wrapper: requestRows.length, playwright: observed.length, reconciliation, equal: reconciliation.length === 0,
      served: gates.served_transport,
      carried_by: pageState.bridge_installed && pageState.fetch_wrapper === 'productTraceFetch'
        ? 'static-era request bridge (analysis/browser-request-bridge.mjs) wraps fetch/XHR outermost and emits network.request; the runtime wrappers are suppressed by __PRODUCTTRACE_BRIDGE_TRANSPORT__'
        : pageState.fetch_wrapper === 'productTraceRuntimeFetch' ? 'runtime wrappers (src/runtime-attribution-browser.js)' : 'unknown',
      page_state: pageState, linkage: Object.fromEntries(Object.entries(Object.groupBy(requestRows, row => row.linkage_kind || 'unattributed')).map(([k, v]) => [k, v.length])) },
    backend: backend ? { spans: spans.length, server_spans: spans.filter(span => span.kind === 'server').length,
      handler_spans: spans.filter(span => span.instrumentation?.name === 'producttrace-express-handlers').length,
      db_spans: spans.filter(span => span.attributes?.['db.system'] || span.attributes?.['db.system.name']).length,
      route_dispatch: joined.filter(row => row.kind === 'route.dispatch').length,
      handler_enter: joined.filter(row => row.kind === 'handler.enter').length,
      db_operation: joined.filter(row => row.kind === 'db.operation').length,
      join_diagnostics: Object.fromEntries(Object.entries(Object.groupBy(joined.filter(row => row.kind === 'span.join.diagnostic'), row => row.reason)).map(([k, v]) => [k, v.length])) } : null,
    actions: { total: actions.length, in_steps: actions.length - outsideSteps, outside_steps: outsideSteps,
      by_event: Object.fromEntries(Object.entries(Object.groupBy(actions, row => row.event)).map(([k, v]) => [k, v.length])),
      credited: stepReports.flatMap(entry => entry.actions).filter(row => row.entry).length,
      entry_units: units.units.size },
    steps: stepReports.map(({ actions: list, ...entry }) => ({ ...entry, actions: list.length })),
    bridge_posts: bridgeRows.length, lifecycle_batches: lifecycleRows.length,
    capture_limits: rows.filter(row => row.kind === 'capture.limit').map(row => ({ page: row.capture_page_id, feature: row.feature, reason: row.reason, react_version: row.react_version })),
    react_version: (() => { try { return JSON.parse(fs.readFileSync(path.join(appDir, 'node_modules', 'react', 'package.json'), 'utf8')).version; } catch { return null; } })(),
    stamps: { rows: stampRows.length, distinct_keys: new Set(stampRows.map(row => row.element_key)).size, distinct_placements: new Set(stampRows.map(row => row.placement_id)).size,
      live_page_stats: pageState.stamp_stats, per_step: steps.map(entry => ({ step: entry.step, name: entry.name, ...entry.stamps })),
      actions_with_element_key: actions.filter(action => action.target?.element_key).length, actions_total: actions.length },
    timeline,
  };
  fs.writeFileSync(path.join(out, 'records.jsonl'), rows.map(row => JSON.stringify(row)).join('\n') + '\n');
  fs.writeFileSync(path.join(out, 'observed-requests.json'), JSON.stringify(observed, null, 2));
  if (spans.length) fs.writeFileSync(path.join(out, 'spans.jsonl'), spans.map(row => JSON.stringify(row)).join('\n') + '\n');
  fs.writeFileSync(path.join(out, 'joined-backend.jsonl'), joined.filter(row => ['route.dispatch', 'handler.enter', 'db.operation', 'span.join.diagnostic'].includes(row.kind)).map(row => JSON.stringify(row)).join('\n') + '\n');
  fs.writeFileSync(path.join(out, 'actions.json'), JSON.stringify(stepReports, null, 2));
  fs.writeFileSync(path.join(out, 'coverage.json'), JSON.stringify(coverage, null, 2));
  const statusAfter = sourceStatus();
  gates.source.status_after = statusAfter;
  // Another process can move the fixture HEAD (shared checkout); the run is
  // only valid if the commit did not change while it ran.
  gates.source.commit_after = git('rev-parse', 'HEAD');
  gates.source.commit_unchanged = gates.source.commit_after === sourceCommit;
  if (!gates.source.commit_unchanged) { log(`FIXTURE HEAD MOVED DURING THE RUN: ${sourceCommit} -> ${gates.source.commit_after}`); process.exitCode = 1; }
  gates.source.pass = !statusAfter && gates.source.commit_unchanged;
  if (storeDir && collectorInfo) {
    // G5: the store was written by `producttrace-collector --store` (rows from
    // the page's own sink, spans relayed). Cross-check it against the harness's
    // lossless capture: same rows per kind, same (kind, sequence, action_id) set.
    const stored = fs.readFileSync(path.join(storeDir, 'records.jsonl'), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)).filter(row => row.tracer_run === collectorInfo.run_id);
    const storedSpans = fs.existsSync(path.join(storeDir, 'spans.jsonl')) ? fs.readFileSync(path.join(storeDir, 'spans.jsonl'), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)).filter(row => row.tracer_run === collectorInfo.run_id) : [];
    const runRow = fs.readFileSync(path.join(storeDir, 'runs.jsonl'), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)).find(row => row.run_id === collectorInfo.run_id) || null;
    const triple = row => `${row.kind}|${row.kind === 'element.stamp' ? `stamp:${row.stamp_sequence}` : row.sequence}|${row.action_id ?? ''}`;
    const byKind = list => Object.fromEntries(Object.entries(Object.groupBy(list, row => row.kind)).map(([kind, values]) => [kind, values.length]).sort());
    const harnessSet = new Set(rows.filter(row => row.kind !== 'capture.dropped').map(triple)); const storeSet = new Set(stored.map(triple));
    const missing = [...harnessSet].filter(key => !storeSet.has(key)); const extra = [...storeSet].filter(key => !harnessSet.has(key));
    gates.store = { dir: storeDir, via: 'collector', collector: collectorInfo, collector_exit: collectorExit, sink: sinkStats,
      run_id: collectorInfo.run_id, build: collectorInfo.build, records: stored.length, spans: storedSpans.length, run_row_written: Boolean(runRow),
      span_relay: { sent: relay.spans_sent, failed: relay.spans_failed },
      crosscheck: { harness_rows_by_kind: byKind(rows.filter(row => row.kind !== 'capture.dropped')), store_rows_by_kind: byKind(stored),
        harness_spans: spans.length - spansAtCollectorStart, harness_spans_before_collector: spansAtCollectorStart, store_spans: storedSpans.length, missing_in_store: missing.length, extra_in_store: extra.length,
        missing_sample: missing.slice(0, 10), extra_sample: extra.slice(0, 10), store_pages: [...new Set(stored.map(row => row.capture_page_id))] } };
    gates.store.crosscheck.pass = missing.length === 0 && extra.length === 0 && storedSpans.length === spans.length - spansAtCollectorStart && relay.spans_failed === 0 && Boolean(runRow) && (sinkStats?.dropped ?? 0) === 0;
    if (runRow) fs.writeFileSync(path.join(out, 'store-run.json'), JSON.stringify(runRow, null, 2));
    if (storeInRepo) gates.source.unfiltered_status_after = git('status', '--porcelain');
    log('store crosscheck', JSON.stringify({ pass: gates.store.crosscheck.pass, records: stored.length, spans: storedSpans.length, missing: missing.length, extra: extra.length }));
  } else if (storeDir) {
    // G6: one run in the append-only store, tagged with the manifest build id,
    // written by the installed package's store writer (same as the collector's).
    const { openStoreWriter } = await import(pathToFileURL(path.join(tracerInstall.packageDir, 'collector', 'store-writer.mjs')).href);
    const writer = openStoreWriter(storeDir, { manifest, label: args.label ?? null, sourceRoot: repo,
      source: { repository: repo, commit: sourceCommit, status_clean: !statusAfter, session: session.name } });
    writer.appendRecords(rows); writer.appendSpans(spans);
    const runRow = writer.close({ steps: steps.map(({ step: number, name, started, ended, status }) => ({ step: number, name, started, ended, status })),
      extra: { evidence: path.relative(tracerRoot, out), gates: { markers: gates.markers.pass, parity: gates.parity.pass, smoke: gates.smoke.status, lossless: coverage.capture.lossless, transports_equal: coverage.transports.equal } } });
    gates.store = { dir: storeDir, run_id: runRow.run_id, build: runRow.build, records: runRow.records, spans: runRow.spans };
    fs.writeFileSync(path.join(out, 'store-run.json'), JSON.stringify(runRow, null, 2));
    if (storeInRepo) gates.source.unfiltered_status_after = git('status', '--porcelain');
  }
  fs.writeFileSync(path.join(out, 'build-gates.json'), JSON.stringify(gates, null, 2));
  console.log(JSON.stringify({ out, source_clean: !statusAfter, store: gates.store ?? null, markers: gates.markers.pass, parity: gates.parity.pass, smoke: gates.smoke.status,
    capture: coverage.capture.lossless, transports_equal: coverage.transports.equal, actions: coverage.actions, steps: coverage.steps.map(row => `${row.step}:${row.name}:${row.status}`) }, null, 2));
  }
} finally {
  await stopCollector().catch(() => {});
  await browser.close().catch(() => {});
  await closeServer(enabledServer);
  if (backend) await backend.stop().catch(() => {});
  if (!args['keep-builds']) { for (const dir of [disabledBuild.dir, enabledBuild.dir]) fs.rmSync(dir, { recursive: true, force: true }); }
}
