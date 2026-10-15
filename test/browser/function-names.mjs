// Function names (headless, neutral fixture): every instrumented function has
// the name the source gives it, recorded at build time, in every build mode,
// and error types are named as the source names them.
//
// The fixture (test/browser/fixtures/function-names-app/) is a TypeScript +
// Vite app with its own vite.config.ts: TanStack Query mutations with a named
// and an anonymous mutationFn, zustand actions defined inside create(), a
// class with methods, getters/setters and a static, `class ApiError extends
// Error`, React.memo and forwardRef wrappers, a callback passed to
// array.map, a computed-key method, `export { a as b }`, an anonymous default
// export, wouter route components, and one plain-JS (.jsx) module.
//
// It is built three ways with Tracer's plugins added to the app's config:
// `vite build --mode development` (unminified), `vite build` (production,
// minified) and the Vite dev server's module transform. The test asserts
// every name and name_kind in the manifest, that the three agree on every
// function id, and then drives the production and development builds
// headless, sends rows through the real collector into a store, and reads
// every rendered name and the thrown ApiError's type through the MCP server
// over stdio (the way an agent calls it).
//
//   node test/browser/function-names.mjs [dependencyRoot] [--out <dir>] [--keep]
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { productTraceVitePlugin } from '../../integrations/vite.mjs';
import { runtimeAttributionPlugin } from '../../integrations/runtime-attribution.mjs';
import { createCollector } from '../../collector/index.js';
import { markerGate } from './marker-sites.mjs';

const tracerRoot = path.resolve(import.meta.dirname, '../..');
const argv = process.argv.slice(2);
const outIndex = argv.indexOf('--out');
const outDir = outIndex >= 0 ? path.resolve(argv[outIndex + 1]) : null;
const keep = argv.includes('--keep');
const positional = argv.filter((value, index) => !value.startsWith('--') && argv[index - 1] !== '--out');
// Vite, @vitejs/plugin-react and Playwright come from a dependency root; the
// app's own libraries (react 19, zustand, TanStack Query, wouter) from this
// package's devDependencies.
const dependencyRoot = path.resolve(positional[0] || '/Users/austinho/dev/trace-consolidated/.live-demo/librechat-m1');
const fixtureDir = path.join(tracerRoot, 'test/browser/fixtures/function-names-app');
const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tracer-function-names-')));

const report = { work, checks: [], manifests: {}, rendered: {} };
const check = (name, pass, detail = null) => { report.checks.push({ name, pass: Boolean(pass), ...(pass ? {} : { detail }) }); };

// --- one node_modules for the fixture: this package's first, then the dependency root's (vite, plugin-react) ---
const modules = path.join(work, 'node_modules');
fs.mkdirSync(modules);
const link = (from, name) => {
  const target = path.join(modules, name);
  if (fs.existsSync(target)) return;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.symlinkSync(fs.realpathSync(path.join(from, name)), target);
};
for (const root of [path.join(tracerRoot, 'node_modules'), path.join(dependencyRoot, 'node_modules')]) {
  for (const entry of fs.readdirSync(root)) {
    if (entry.startsWith('.')) continue;
    if (entry.startsWith('@')) { for (const scoped of fs.readdirSync(path.join(root, entry))) link(root, `${entry}/${scoped}`); }
    else link(root, entry);
  }
}

function copyFixture(name) {
  const repository = path.join(work, name);
  fs.cpSync(fixtureDir, repository, { recursive: true });
  fs.writeFileSync(path.join(repository, 'package.json'), JSON.stringify({ name: `function-names-${name}`, private: true, type: 'module' }));
  fs.symlinkSync(modules, path.join(repository, 'node_modules'));
  return repository;
}

const vite = await import(pathToFileURL(path.join(modules, 'vite/dist/node/index.js')).href);

async function buildMode(mode, collectorUrl) {
  const repository = copyFixture(mode);
  const manifestPath = path.join(repository, 'attribution-manifest.json');
  const log = [];
  const info = console.info; console.info = (...args) => log.push(args.join(' '));
  const tracer = productTraceVitePlugin({ repository, service: `function-names-${mode}`, requestBridge: false, collector: { url: collectorUrl, force: true } });
  try {
    await vite.build({ root: repository, configFile: path.join(repository, 'vite.config.ts'), mode, logLevel: 'warn',
      plugins: [tracer, runtimeAttributionPlugin({ repository, manifestPath })],
      build: { outDir: path.join(repository, 'dist'), emptyOutDir: true, minify: mode === 'production' } });
  } finally { console.info = info; }
  return { mode, repository, distRoot: path.join(repository, 'dist'), manifest: JSON.parse(fs.readFileSync(manifestPath, 'utf8')), log, tracer };
}

async function devServerManifest() {
  const repository = copyFixture('serve');
  const manifestPath = path.join(repository, 'attribution-manifest.json');
  const server = await vite.createServer({ root: repository, configFile: path.join(repository, 'vite.config.ts'), mode: 'development', logLevel: 'warn',
    plugins: [productTraceVitePlugin({ repository, service: 'function-names-serve', requestBridge: false }), runtimeAttributionPlugin({ repository, manifestPath })],
    server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true, include: [] } });
  try {
    for (const file of ['src/main.tsx', 'src/callees.ts', 'src/api.ts', 'src/helpers.ts', 'src/store.ts', 'src/routes/Home.tsx', 'src/routes/About.tsx', 'src/legacy/widgets.jsx']) {
      await server.transformRequest(`/${file}`);
    }
  } finally { await server.close(); }
  return { mode: 'serve', repository, manifest: JSON.parse(fs.readFileSync(manifestPath, 'utf8')) };
}

// --- expected names: [file, text at the function's start, name, name_kind, display_name] ---
const EXPECTED = [
  ['src/api.ts', 'constructor(status: number, message: string)', 'constructor', 'method', 'ApiError.constructor'],
  ['src/api.ts', 'constructor(base: string)', 'constructor', 'method', 'ApiClient.constructor'],
  ['src/api.ts', 'get baseUrl()', 'baseUrl', 'method', 'ApiClient.baseUrl (getter)'],
  ['src/api.ts', 'set baseUrl(value', 'baseUrl', 'method', 'ApiClient.baseUrl (setter)'],
  ['src/api.ts', 'static count()', 'count', 'method', 'ApiClient.count'],
  ['src/api.ts', 'async get<T>(path', 'get', 'method', 'ApiClient.get'],
  ['src/api.ts', 'async post<T>(path', 'post', 'method', 'ApiClient.post'],
  ['src/api.ts', 'private async send<T>', 'send', 'method', 'ApiClient.send'],
  ['src/api.ts', 'export function describeStatus', 'describeStatus', 'declaration', 'describeStatus'],
  ['src/helpers.ts', 'function formatTitle', 'formatTitle', 'declaration', 'formatTitle (exported as titleCase)'],
  ['src/helpers.ts', 'first => first.toUpperCase()', null, 'callback', '<callback of text.trim().replace>'],
  ['src/main.tsx', '(reset) => reset()', null, 'callback', '<callback of Object.values().forEach>'],
  ['src/helpers.ts', 'function withRetry<T>', 'withRetry', 'declaration', 'withRetry'],
  ['src/helpers.ts', 'export default function (items', 'default', 'export_alias', 'default (helpers.ts)'],
  ['src/store.ts', '(set) => ({', null, 'inferred', 'useTodos = create()(<callback>)'],
  ['src/store.ts', '(text: string) => set(', 'addTodo', 'property', 'useTodos.addTodo'],
  ['src/store.ts', 'removeTodo(id: number) {', 'removeTodo', 'property', 'useTodos.removeTodo'],
  ['src/store.ts', '() => set({ todos: [] })', 'clear', 'property', 'useTodos.clear'],
  ['src/store.ts', '[dynamicKey]()', null, 'anonymous', '<computed key>'],
  ['src/routes/Home.tsx', 'function Row({ todo', 'Row', 'declaration', 'Row'],
  ['src/routes/Home.tsx', '() => onRemove(todo.id)', null, 'anonymous', '<button onClick>'],
  ['src/routes/Home.tsx', '(props: { label: string }, ref', null, 'inferred', 'TextField = forwardRef(<callback>)'],
  ['src/routes/Home.tsx', 'function runLater(', 'runLater', 'declaration', 'runLater'],
  ['src/routes/Home.tsx', "() => setStatus('adding')", 'job', 'callback', 'job (callback of runLater)'],
  ['src/routes/Home.tsx', 'function explode()', 'explode', 'declaration', 'explode'],
  ['src/routes/Home.tsx', 'export default function Home()', 'Home', 'declaration', 'Home (exported as default)'],
  ['src/routes/Home.tsx', 'async function saveTodo(', 'saveTodo', 'declaration', 'saveTodo'],
  ['src/routes/Home.tsx', "() => setStatus('saved')", 'onSuccess', 'property', 'useMutation({ onSuccess })'],
  ['src/routes/Home.tsx', 'async (id: number) => client.post', 'mutationFn', 'property', 'useMutation({ mutationFn })'],
  ['src/routes/Home.tsx', 'function handleAdd()', 'handleAdd', 'declaration', 'handleAdd'],
  ['src/routes/Home.tsx', '(id: number) => {\n    removeTodo', 'handleRemove', 'binding', 'handleRemove'],
  ['src/routes/Home.tsx', 'async function handleFail()', 'handleFail', 'declaration', 'handleFail'],
  // withRetry is imported (its declaration is not visible here): no name; the result's binding is context only.
  ['src/routes/Home.tsx', '() => countFilled(', null, 'inferred', 'count = withRetry(<callback>)'],
  ['src/routes/Home.tsx', '(todo) => todo.text', null, 'callback', '<callback of todos.map>'],
  ['src/routes/Home.tsx', '(todo) => <Row', null, 'callback', '<callback of todos.map>'],
  ['src/routes/Home.tsx', '(state) => state.todos', null, 'inferred', 'todos = useTodos(<callback>)'],
  ['src/routes/Home.tsx', 'function ApiClient_count()', 'ApiClient_count', 'declaration', 'ApiClient_count'],
  ['src/routes/About.tsx', '(name: string): string =>', 'greet', 'property', 'Greeter.greet'],
  ['src/routes/About.tsx', '() => {\n  const [text', 'About', 'binding', 'About'],
  ['src/routes/About.tsx', 'async () => {\n    const todos', 'onGreet', 'binding', 'onGreet'],
  ['src/legacy/widgets.jsx', 'export function renderBadge', 'renderBadge', 'declaration', 'renderBadge'],
  ['src/legacy/widgets.jsx', "() => fetch('/api/ping')", 'onPing', 'property', 'handlers.onPing'],
  ['src/legacy/widgets.jsx', 'describe() {', 'describe', 'property', 'handlers.describe'],
  ['src/legacy/widgets.jsx', 'constructor() {', 'constructor', 'method', 'Tally.constructor'],
  ['src/legacy/widgets.jsx', 'bump() {', 'bump', 'method', 'Tally.bump'],
  ['src/main.tsx', 'function Shell()', 'Shell', 'declaration', 'Shell'],
  // Grade 2026-09-24: a callee whose name has another binding in the file (import, destructured
  // variable, destructured parameter, second same-named function) never lends its parameter name.
  ['src/callees.ts', '() => 11)', null, 'callback', '<callback of withRetry>'],
  ['src/callees.ts', '() => 12)', null, 'callback', '<callback of schedule>'],
  ['src/callees.ts', '() => 13)', null, 'callback', '<callback of update>'],
  ['src/callees.ts', '(prev) => prev + 1', null, 'callback', '<callback of setItems>'],
  ['src/callees.ts', 'function withRetry(misnamed', 'withRetry', 'declaration', 'withRetry'],
  ['src/main.tsx', '() => { tally.bump()', null, 'anonymous', '<button onClick>'],
];
const EXPECTED_CLASSES = [['src/api.ts', 'ApiError', 'Error'], ['src/api.ts', 'ApiClient', null], ['src/routes/About.tsx', 'Greeter', null], ['src/legacy/widgets.jsx', 'Tally', null]];

// Function ids hash the text the build's source map carries: for files with
// JSX controls that is the source after Tracer's position-keyed element-stamp
// pre-transform. The test re-derives that text with the plugin's own API and
// proves it by the id's content hash before using any offset.
let stampApi = null;
const contentCache = new Map();
function sourceText(file, idHash = null) {
  const disk = fs.readFileSync(path.join(fixtureDir, file), 'utf8');
  const stamped = stampApi ? stampApi.instrumentSource(file, disk, { stampsOnly: true }) : null;
  const candidates = [disk, ...(stamped?.applied?.length ? [stamped.code] : [])];
  if (!idHash) return candidates.at(-1);
  if (!contentCache.has(idHash)) contentCache.set(idHash, candidates.find(text => createHash('sha256').update(text).digest('hex') === idHash) ?? null);
  return contentCache.get(idHash);
}
function rowFor(manifest, [file, marker]) {
  const hashes = new Set((manifest.functions || []).filter(row => row.source?.file === file).map(row => row.id.split(':')[1]));
  const text = [...hashes].map(hash => sourceText(file, hash)).find(Boolean);
  if (!text) return null;
  const at = text.indexOf(marker);
  return (manifest.functions || []).find(row => row.source?.file === file && row.source.start === at) || null;
}
const nameFields = row => (row ? { name: row.name ?? null, name_kind: row.name_kind ?? null, display_name: row.display_name ?? null, ...(row.export_names ? { export_names: row.export_names } : {}), ...(row.via ? { via: row.via } : {}) } : null);

function checkManifest(label, manifest) {
  const results = EXPECTED.map(expected => {
    const row = rowFor(manifest, expected);
    const [file, marker, name, kind, display] = expected;
    const ok = Boolean(row) && row.name === name && row.name_kind === kind && row.display_name === display;
    check(`${label}: ${file} \`${marker.split('\n')[0]}\` → ${display} (${kind})`, ok, { expected: { name, name_kind: kind, display_name: display }, actual: nameFields(row) });
    return { file, marker, expected: { name, name_kind: kind, display_name: display }, actual: nameFields(row), id: row?.id ?? null };
  });
  check(`${label}: every manifest function has name_kind and display_name`, (manifest.functions || []).every(row => typeof row.name_kind === 'string' && typeof row.display_name === 'string'),
    (manifest.functions || []).filter(row => typeof row.name_kind !== 'string').map(row => row.id));
  const unspelled = (manifest.functions || []).filter(row => {
    if (!row.name || row.name === 'default' || row.name === 'constructor') return false;
    const text = sourceText(row.source.file, row.id.split(':')[1]);
    const spelled = new RegExp(`(?<![\\w$#])${row.name.replace(/[$#]/gu, '\\$&')}(?![\\w$])`, 'u');
    return !text || !spelled.test(text);
  });
  check(`${label}: no manifest name is a runtime or minified name (each name is an identifier spelled in its source file)`, unspelled.length === 0, unspelled.map(row => [row.id, row.display_name]));
  for (const [file, name, base] of EXPECTED_CLASSES) {
    const row = (manifest.classes || []).find(value => value.source?.file === file && value.name === name);
    check(`${label}: class ${name} recorded with its source name${base ? ` (extends ${base})` : ''}`, row && (base ? row.extends === base : true), row);
  }
  return results;
}

// --- collector + builds ---
const stores = {};
const collectors = {};
for (const mode of ['production', 'development']) {
  stores[mode] = path.join(work, `store-${mode}`);
  collectors[mode] = createCollector({ port: 0, store: { dir: stores[mode], manifest: null, label: `function-names-${mode}` } });
  await collectors[mode].ready;
}
const builds = {};
for (const mode of ['production', 'development']) builds[mode] = await buildMode(mode, collectors[mode].url);
stampApi = builds.production.tracer.api.integration;
builds.serve = await devServerManifest();
for (const [mode, build] of Object.entries(builds)) report.manifests[mode] = { functions: build.manifest.functions.length, classes: (build.manifest.classes || []).length, names: checkManifest(mode, build.manifest) };

// --- build modes agree: every function id both builds have carries the same name fields ---
const byId = manifest => new Map(manifest.functions.map(row => [row.id, JSON.stringify(nameFields(row))]));
for (const other of ['development', 'serve']) {
  const left = byId(builds.production.manifest); const right = byId(builds[other].manifest);
  const shared = [...left.keys()].filter(id => right.has(id));
  const differ = shared.filter(id => left.get(id) !== right.get(id));
  report.manifests[`production_vs_${other}`] = { production: left.size, [other]: right.size, shared: shared.length, differing_names: differ.length,
    only_production: [...left.keys()].filter(id => !right.has(id)).length, [`only_${other}`]: [...right.keys()].filter(id => !left.has(id)).length };
  check(`production vs ${other}: identical names on all ${shared.length} shared function ids`, shared.length > 0 && differ.length === 0, differ.slice(0, 5).map(id => [id, left.get(id), right.get(id)]));
  const expectedIds = EXPECTED.map(expected => rowFor(builds.production.manifest, expected)?.id).filter(Boolean);
  check(`production vs ${other}: every expected function is in both manifests with the same id`, expectedIds.length === EXPECTED.length && expectedIds.every(id => right.has(id)), expectedIds.filter(id => !right.has(id)));
}
// The marker gate is unchanged: class registrations are not function sites.
for (const mode of ['production', 'development']) {
  const gate = markerGate(builds[mode].distRoot, builds[mode].manifest);
  report.manifests[`${mode}_marker_gate`] = { pass: gate.pass, manifest_functions: gate.manifest_functions, executable: gate.indexes_with_executable_site, unmanifested: gate.unmanifested_count };
  check(`${mode}: marker gate passes (every manifest index has an executable site; no unmanifested site)`, gate.pass, { missing: gate.missing.slice(0, 5), unmanifested: gate.unmanifested });
}
const classIds = manifest => JSON.stringify((manifest.classes || []).map(row => [row.id, row.name]).sort());
check('classes: identical ids and names in production, development and dev-server manifests', classIds(builds.production.manifest) === classIds(builds.development.manifest)
  && classIds(builds.production.manifest) === classIds(builds.serve.manifest), [classIds(builds.production.manifest), classIds(builds.serve.manifest)]);
check('production build is minified (the ApiError class is renamed in the served code)', (() => {
  const js = fs.readdirSync(path.join(builds.production.distRoot, 'assets')).filter(file => file.endsWith('.js')).map(file => fs.readFileSync(path.join(builds.production.distRoot, 'assets', file), 'utf8')).join('\n');
  report.production_class_registration = (js.match(/registerClass\?\.\([^)]*\)/gu) || []).slice(0, 6);
  return !/class ApiError\b/u.test(js) && report.production_class_registration.length >= 4;
})(), null);

// --- drive both builds headless ---
function serve(distRoot) {
  const todos = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://fixture');
    const json = (status, value) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
    if (url.pathname.startsWith('/api/')) {
      let body = ''; req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        if (url.pathname === '/api/fail') return json(503, { error: 'unavailable' });
        if (url.pathname === '/api/todos' && req.method === 'POST') { todos.push(JSON.parse(body || '{}').text); return json(200, { ok: true }); }
        if (url.pathname === '/api/todos') return json(200, { todos });
        if (url.pathname === '/api/ping') return json(200, { pong: true });
        if (/^\/api\/todos\/\d+\/delete$/u.test(url.pathname)) return json(200, { ok: true });
        return json(404, {});
      });
      return;
    }
    const relative = url.pathname === '/' || url.pathname === '/about' ? 'index.html' : url.pathname.slice(1);
    const file = path.resolve(distRoot, relative);
    if (!file.startsWith(`${distRoot}${path.sep}`) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': file.endsWith('.js') ? 'text/javascript' : file.endsWith('.html') ? 'text/html' : 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ origin: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(done => server.close(done)) })));
}

const { chromium } = createRequire(path.join(dependencyRoot, 'package.json'))('playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.PRODUCTTRACE_BROWSER_EXECUTABLE ? { executablePath: process.env.PRODUCTTRACE_BROWSER_EXECUTABLE } : {}) });
const pageErrors = {};
try {
  for (const mode of ['production', 'development']) {
    const front = await serve(builds[mode].distRoot);
    const page = await browser.newPage();
    pageErrors[mode] = [];
    page.on('pageerror', error => pageErrors[mode].push(`${error.name}: ${error.message}`));
    await page.goto(front.origin, { waitUntil: 'networkidle' });
    const settle = () => page.waitForTimeout(500);
    const click = async name => { await page.getByRole('button', { name, exact: true }).click(); await settle(); };
    await click('add');
    await page.getByRole('button', { name: /^remove / }).first().click(); await settle();
    await click('explode');
    await click('fail');
    await click('ping');
    await click('status');
    await page.getByRole('link', { name: 'about' }).click(); await settle();
    await click('greet');
    await page.goto('about:blank'); await page.waitForTimeout(800);
    await page.close();
    await front.close();
  }
} finally { await browser.close(); }
for (const mode of ['production', 'development']) {
  await new Promise(resolve => setTimeout(resolve, 200));
  await collectors[mode].close();
  // The store reads its build's manifest from manifest.json (as a --manifest would).
  fs.writeFileSync(path.join(stores[mode], 'manifest.json'), JSON.stringify(builds[mode].manifest));
}
report.page_errors = pageErrors;
check('both builds threw exactly the two ApiErrors the fixture throws (page errors seen by the browser)', ['production', 'development'].every(mode => pageErrors[mode].length === 2), pageErrors);

// --- the MCP over stdio, as an agent calls it ---
async function mcpSession(storeDir, sourceRoot) {
  const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(tracerRoot, 'mcp/server.mjs'), '--store', storeDir, ...(sourceRoot ? ['--source-root', sourceRoot] : [])], stderr: 'pipe' });
  const client = new Client({ name: 'function-names-test', version: '0.0.0' });
  await client.connect(transport);
  const call = async (name, args) => { const result = await client.callTool({ name, arguments: args }); return { json: result.structuredContent, text: result.content?.[0]?.text ?? '' }; };
  return { call, close: () => client.close() };
}

for (const mode of ['production', 'development']) {
  const mcp = await mcpSession(stores[mode], null);
  const rendered = report.rendered[mode] = {};
  try {
    const recent = (await mcp.call('recent_actions', { n: 50 })).json;
    const actions = recent.actions || [];
    const clicks = actions.filter(action => action.event === 'click');
    const byText = text => clicks.find(action => (action.element?.label || action.target?.text || action.summary || '').includes(text)) || null;
    const chains = {};
    for (const action of clicks) chains[action.action_id] = await mcp.call('action_chain', { action_id: action.action_id });
    const chainFor = needle => Object.values(chains).find(chain => chain.json.stops?.[0]?.target && JSON.stringify(chain.json.stops[0].target).includes(needle)) || null;
    const entryOf = chain => chain?.json.stops.find(stop => stop.stop === 'entry_handler') || null;
    const labelsOf = chain => [
      ...(chain?.json.spine || []).map(hop => hop.label),
      ...(chain?.json.segments || []).flatMap(segment => (segment.lineage || []).map(hop => hop.label)),
      ...(chain?.json.work?.entries || []).filter(entry => entry.type === 'frame').map(entry => entry.label),
    ];
    const cases = {
      add: { needle: '"data-testid":"add"', entry: ['handleAdd', 'manifest'], shows: ['handleAdd', 'formatTitle (exported as titleCase)', 'useTodos.addTodo', 'saveTodo', 'ApiClient.post', 'ApiClient.send', 'job (callback of runLater)'], jsonOnly: ['job (callback of runLater)'] },
      remove: { needle: '"aria-label":"remove ', entry: [null, 'anonymous', '<button onClick>'], shows: ['handleRemove', 'useTodos.removeTodo', 'useMutation({ mutationFn })', 'ApiClient.post'] },
      explode: { needle: '"data-testid":"explode"', entry: ['explode', 'manifest'], shows: ['explode', 'ApiError.constructor'] },
      fail: { needle: '"data-testid":"fail"', entry: ['handleFail', 'manifest'], shows: ['handleFail', 'ApiClient.post', 'ApiClient.send'] },
      ping: { needle: '"data-testid":"ping"', entry: [null, 'anonymous', '<button onClick>'], shows: ['Tally.bump', 'handlers.onPing'] },
      greet: { needle: '"data-testid":"greet"', entry: ['onGreet', 'manifest'], shows: ['onGreet', 'ApiClient.get', 'Greeter.greet'] },
    };
    for (const [name, expected] of Object.entries(cases)) {
      const chain = chainFor(expected.needle);
      const entry = entryOf(chain);
      const labels = labelsOf(chain);
      const text = chain?.text || '';
      rendered[name] = { action_id: chain?.json.action_id ?? null, entry: entry ? { name: entry.name, name_kind: entry.name_kind, display_name: entry.display_name, name_status: entry.name_status, label: entry.label } : null,
        labels: [...new Set(labels)], summary: text.split('\n')[0] };
      const [entryName, status, display] = expected.entry;
      check(`${mode} MCP: ${name} entry handler is ${display || entryName} (${status})`, entry && entry.name === entryName && entry.name_status === status && (!display || entry.display_name === display)
        && entry.label.startsWith(`${display || entryName} src/`), rendered[name].entry);
      for (const shown of expected.shows) {
        // The text's work listing shows at most 12 frames; the JSON lists every one.
        const inText = !(expected.jsonOnly || []).includes(shown);
        check(`${mode} MCP: ${name} names ${shown} in the chain JSON${inText ? ' and the text' : ''}`, labels.some(label => label.startsWith(`${shown} src/`)) && (!inText || text.includes(`${shown} src/`)), rendered[name].labels);
      }
      check(`${mode} MCP: ${name} prints no <unnamed> and no <not in manifest>`, !/<unnamed>|<not in manifest>/u.test(text), text.split('\n').filter(line => /<unnamed>|<not in manifest>/u.test(line)));
    }
    // Error types: the thrown ApiError is named as the source names it, in both builds.
    for (const name of ['explode', 'fail']) {
      const chain = chainFor(cases[name].needle);
      const signal = chain?.json.outcome?.signals?.[0] || null;
      rendered[name].error_type = signal?.error_type ?? null;
      rendered[name].outcome_label = chain?.json.outcome?.label ?? null;
      check(`${mode} MCP: ${name} error_type.source is ApiError (from the manifest)`, signal?.error_type?.source === 'ApiError' && signal.error_type.source_basis === 'manifest', signal);
      check(`${mode} MCP: ${name} prints ApiError, never the runtime name as the source name`, (chain?.text || '').includes('(ApiError)')
        && (signal?.error_type?.minified === 'ApiError' || !(chain?.text || '').includes(`(${signal?.error_type?.minified})`)), chain?.text.split('\n')[0]);
    }
    if (mode === 'production') check('production: the runtime constructor name of ApiError is minified (the case this rule exists for)', rendered.explode.error_type?.minified && rendered.explode.error_type.minified !== 'ApiError', rendered.explode.error_type);
    else check('development: the runtime constructor name is the source name', rendered.explode.error_type?.minified === 'ApiError', rendered.explode.error_type);
    // resolve_element candidates and the element's handlers carry names.
    const key = chainFor('"data-testid":"greet"')?.json.stops[0]?.element_key;
    const resolved = key ? await mcp.call('resolve_element', { element_key: key }) : null;
    const handlers = resolved?.json.handlers || [];
    rendered.resolve_element_greet = { key, handlers: handlers.map(handler => ({ event: handler.event, display_name: handler.display_name, name_status: handler.name_status })) };
    check(`${mode} MCP: resolve_element lists the greet button's handler by name`, handlers.some(handler => handler.display_name === 'onGreet' && handler.name_status === 'manifest'), rendered.resolve_element_greet);
    const byName = await mcp.call('resolve_element', { role: 'button', name: 'greet' });
    const candidateHandlers = (byName.json.candidates || []).flatMap(candidate => (candidate.keys || []).flatMap(value => value.handlers || []));
    check(`${mode} MCP: resolve_element candidates (by role + name) name their handlers`, candidateHandlers.some(handler => handler.display_name === 'onGreet'), candidateHandlers);
    void byText;
  } finally { await mcp.close(); }
}

// --- report ---
const failed = report.checks.filter(value => !value.pass);
report.summary = { checks: report.checks.length, passed: report.checks.length - failed.length, failed: failed.length };
if (outDir) { fs.mkdirSync(outDir, { recursive: true }); fs.writeFileSync(path.join(outDir, 'function-names-report.json'), JSON.stringify(report, null, 2)); }
for (const value of report.checks) console.log(`${value.pass ? 'ok  ' : 'FAIL'} ${value.name}${value.pass ? '' : `\n     ${JSON.stringify(value.detail).slice(0, 600)}`}`);
console.log(`\n${report.summary.passed}/${report.summary.checks} checks pass`);
if (!keep) fs.rmSync(work, { recursive: true, force: true });
else console.log(`kept ${work}`);
process.exit(failed.length ? 1 : 0);
