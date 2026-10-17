import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { withProducttrace } from '../next.mjs';
import { transformNextModule } from '../integrations/next-transform.mjs';
import { fakeElement, loadBrowserRuntime } from './helpers/browser-runtime-vm.mjs';

const DEV = 'phase-development-server';

function tempApp() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'producttrace-next-')));
  fs.mkdirSync(path.join(root, '.git'));
  fs.mkdirSync(path.join(root, 'src', 'app'), { recursive: true });
  return root;
}

function inApp(t, root) {
  const cwd = process.cwd();
  process.chdir(root);
  t.after(() => { process.chdir(cwd); fs.rmSync(root, { recursive: true, force: true }); });
}

test('withProducttrace() hands back the app config untouched outside next dev', async () => {
  const config = { reactStrictMode: true };
  assert.equal(await withProducttrace(config)('phase-production-build', {}), config);
  assert.equal(await withProducttrace(async () => config)('phase-production-server', {}), config);
});

test('withProducttrace() under next dev adds the loader for browser modules and writes the recorder', async (t) => {
  const root = tempApp();
  inApp(t, root);
  const theirs = { loaders: ['their-svg-loader'], as: '*.js' };
  const config = await withProducttrace(async () => ({
    reactStrictMode: true,
    turbopack: { rules: { '*.svg': theirs } },
    webpack: (webpackConfig) => ({ ...webpackConfig, touched: true }),
  }))(DEV, {});

  assert.equal(config.reactStrictMode, true);
  assert.deepEqual(config.turbopack.rules['*.svg'], theirs, "the app's own rules stay");
  const [rule] = config.turbopack.rules['*.{js,jsx,ts,tsx,mjs,mts}'];
  assert.deepEqual(rule.condition, { all: ['browser', 'development', { not: 'foreign' }] });
  assert.match(rule.loaders[0].loader, /next-loader\.cjs$/u);
  assert.equal(rule.loaders[0].options.repository, root);

  // webpack (`next dev --webpack`): client compilation only, the app's own hook still runs.
  const client = config.webpack({ module: { rules: [] } }, { dev: true, isServer: false });
  assert.equal(client.touched, true);
  assert.equal(client.module.rules.length, 1);
  assert.equal(client.module.rules[0].enforce, 'pre');
  assert.equal(config.webpack({ module: { rules: [] } }, { dev: true, isServer: true }).module.rules.length, 0);

  // The recorder lives beside the package cache, never in the source tree.
  const recorder = fs.readFileSync(path.join(root, 'node_modules', '.producttrace', 'next-client.js'), 'utf8');
  assert.match(recorder, /__PRODUCTTRACE_LABELS__/u);
  assert.deepEqual(fs.readdirSync(path.join(root, 'src', 'app')), []);
  // Without NEXT_PRIVATE_WORKER this is the `next dev` CLI process: it serves nothing, so no collector
  // and no sink yet (the server process writes the real recorder).
  assert.doesNotMatch(recorder, /installProductTraceCollectorSink/u);
  assert.equal(config.rewrites, undefined);
});

test('next dev: the server process runs the collector on its own 127.0.0.1 server, outside Next.js routing', async (t) => {
  const root = tempApp();
  const cacheDir = path.join(root, 'node_modules', '.producttrace');
  // Hooks run in order: stop the collector before the directory goes.
  t.after(() => globalThis.__producttraceNextCollectors.get(cacheDir)?.stop());
  inApp(t, root);
  const previous = process.env.NEXT_PRIVATE_WORKER;
  process.env.NEXT_PRIVATE_WORKER = '1';
  t.after(() => { if (previous === undefined) delete process.env.NEXT_PRIVATE_WORKER; else process.env.NEXT_PRIVATE_WORKER = previous; });
  const rewrites = async () => [{ source: '/api/:path*', destination: 'http://localhost:9000/:path*' }];
  const config = await withProducttrace({ rewrites })(DEV, {});

  // No rewrite: middleware (a sign-in redirect) and the app's routes never see the collector.
  assert.equal(config.rewrites, rewrites);
  const recorder = fs.readFileSync(path.join(cacheDir, 'next-client.js'), 'utf8');
  const target = recorder.match(/http:\/\/127\.0\.0\.1:\d+\/__producttrace/u)?.[0];
  assert.ok(target, 'the page posts straight to the loopback collector');

  const row = { schema: 'producttrace.runtime.v1', event: 'capture.summary', capture_page_id: 's_test', timestamp: Date.now() };
  const post = (origin) => fetch(`${target}/ingest`, { method: 'POST', headers: { 'content-type': 'text/plain', origin }, body: JSON.stringify([row]) });
  assert.equal((await post('http://localhost:3000')).status, 200, 'the app on localhost may post');
  const status = await (await fetch(`${target}/status`)).json();
  assert.equal(status.received, 1);
  assert.equal(status.store, path.join(cacheDir, 'store'));
  assert.match(await (await fetch(`${target}/`)).text(), /What the user is doing/u);
  // Another site open in the same browser can neither read the story nor write rows.
  assert.equal((await fetch(`${target}/story`, { headers: { origin: 'https://evil.example' } })).status, 403);
  assert.equal((await post('https://evil.example')).status, 403);
  // Only loopback listens: the address is 127.0.0.1, never the network.
  assert.equal(new URL(target).hostname, '127.0.0.1');

  // Loader workers each write a manifest; the collector follows their union.
  const manifests = path.join(cacheDir, 'next-manifests');
  fs.writeFileSync(path.join(manifests, '101.json'), JSON.stringify({ schema: 'producttrace.runtime-attribution-manifest.v1', functions: [{ index: 7, id: 'function:a:0:1' }], placements: [], classes: [] }));
  fs.writeFileSync(path.join(manifests, '102.json'), JSON.stringify({ schema: 'producttrace.runtime-attribution-manifest.v1', functions: [{ index: 9, id: 'function:b:0:1' }], placements: [], classes: [] }));
  const merged = path.join(cacheDir, 'runtime-attribution-manifest.json');
  for (let attempt = 0; attempt < 40 && !fs.existsSync(merged); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual(JSON.parse(fs.readFileSync(merged, 'utf8')).functions.map((row) => row.id).sort(), ['function:a:0:1', 'function:b:0:1']);

  // Next.js loads the config again on restarts: same collector, same URL.
  await withProducttrace({})(DEV, {});
  assert.match(fs.readFileSync(path.join(cacheDir, 'next-client.js'), 'utf8'), new RegExp(target.replace(/[.]/gu, '\\.'), 'u'));
});

test('the Next.js loader compiles a client module, instruments its functions and imports the recorder first', (t) => {
  const root = tempApp();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cacheDir = path.join(root, 'node_modules', '.producttrace');
  const clientModule = path.join(cacheDir, 'next-client.js');
  const file = path.join(root, 'src', 'app', 'save-button.tsx');
  const source = `'use client';
import { useState } from 'react';
type Props = { projectId: string };
export function SaveButton({ projectId }: Props) {
  const [saving, setSaving] = useState<boolean>(false);
  const onClick = async () => { setSaving(true); await fetch(\`/api/projects/\${projectId}\`, { method: 'PUT' }); };
  return <button onClick={onClick} disabled={saving}>Save</button>;
}
`;
  fs.writeFileSync(file, source);
  const options = { repository: root, cacheDir, clientModule };
  const result = transformNextModule(source, file, options);

  assert.ok(result.code.startsWith(`'use client';\nimport "../../node_modules/.producttrace/next-client.js";\n`), result.code.slice(0, 120));
  assert.match(result.code, /registerManifest/u);
  assert.equal(result.code.match(/'use client'/gu).length, 1, 'one directive, at the top (webpack rejects a late one)');
  const parsed = ts.createSourceFile('out.js', result.code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  assert.equal(parsed.parseDiagnostics.length, 0, 'plain JavaScript: no TypeScript or JSX left');
  assert.equal(result.map.sources[0], file);

  // Indexes come from ids, so modules transformed by different workers never collide.
  const manifest = JSON.parse(fs.readFileSync(path.join(cacheDir, 'next-manifests', `${process.pid}.json`), 'utf8'));
  assert.ok(manifest.functions.length >= 2);
  for (const row of manifest.functions) assert.ok(row.index > 2 ** 32 && Number.isSafeInteger(row.index), `stable index for ${row.id}`);

  // Server actions, libraries and the recorder itself are left alone.
  const action = path.join(root, 'src', 'app', 'actions.ts');
  assert.equal(transformNextModule(`"use server";\nexport async function save() {}\n`, action, options), null);
  assert.equal(transformNextModule('export const x = () => 1;\n', path.join(root, 'node_modules', 'lib', 'index.js'), options), null);
  assert.equal(transformNextModule('', clientModule, options), null);
});

test('one click that drives a long render loop stays bounded in the page', () => {
  const { runtime, dispatch } = loadBrowserRuntime({ extraGlobals: { event: undefined } });
  dispatch('click', fakeElement('button'), {}, () => {
    // An export: a deep recursive render, then thousands of per-frame calls.
    const frames = [];
    for (let depth = 0; depth < 200; depth += 1) frames.push(runtime.enter(depth + 1));
    while (frames.length) runtime.exit(frames.pop());
    for (let call = 0; call < 6000; call += 1) runtime.exit(runtime.enter(1000));
  });
  const enters = runtime.records.filter((row) => row.kind === 'function.enter');
  assert.equal(enters.length, 5000);
  assert.ok(enters.every((row) => row.spine.function_ids.length <= 64), 'spines stay bounded');
  const deepest = enters.find((row) => row.spine.function_ids.length === 64);
  assert.equal(deepest.spine.function_ids[0], 'function-index:1', 'the root (the handler) is kept');
  const limits = runtime.records.filter((row) => row.kind === 'capture.limit' && row.feature === 'function_rows');
  assert.equal(limits.length, 1, 'said once that the rest was counted only');
});

test('next dev with a collector URL: no local collector, the manifest file is still kept for it', async (t) => {
  const root = tempApp();
  const cacheDir = path.join(root, 'node_modules', '.producttrace');
  t.after(() => globalThis.__producttraceNextManifests.get(cacheDir)?.());
  inApp(t, root);
  const previous = process.env.NEXT_PRIVATE_WORKER;
  process.env.NEXT_PRIVATE_WORKER = '1';
  t.after(() => { if (previous === undefined) delete process.env.NEXT_PRIVATE_WORKER; else process.env.NEXT_PRIVATE_WORKER = previous; });
  const config = await withProducttrace({}, { collector: 'http://127.0.0.1:9999' })(DEV, {});

  assert.equal(config.rewrites, undefined);
  assert.equal(globalThis.__producttraceNextCollectors.has(cacheDir), false);
  assert.match(fs.readFileSync(path.join(cacheDir, 'next-client.js'), 'utf8'), /127\.0\.0\.1:9999/u);
  fs.writeFileSync(path.join(cacheDir, 'next-manifests', '101.json'), JSON.stringify({ schema: 'producttrace.runtime-attribution-manifest.v1', functions: [{ index: 7, id: 'function:a:0:1' }], placements: [], classes: [] }));
  const merged = path.join(cacheDir, 'runtime-attribution-manifest.json');
  for (let attempt = 0; attempt < 40 && !fs.existsSync(merged); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual(JSON.parse(fs.readFileSync(merged, 'utf8')).functions.map((row) => row.id), ['function:a:0:1']);
});

test('types: a config typed NextConfig (an interface), a promise of one, under node and bundler resolution', (t) => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'producttrace-next-types-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'node_modules'));
  fs.symlinkSync(path.resolve(import.meta.dirname, '..'), path.join(root, 'node_modules', 'producttrace'));
  const file = path.join(root, 'next.config.ts');
  fs.writeFileSync(file, `import { withProducttrace } from 'producttrace/next';
interface NextConfig { reactStrictMode?: boolean; images?: { domains?: string[] } }
const nextConfig: NextConfig = { reactStrictMode: true };
export const plain = withProducttrace(nextConfig);
export const later = withProducttrace(Promise.resolve(nextConfig), { collector: false });
export const byPhase = withProducttrace(async (phase: string) => ({ ...nextConfig, phase }));
export default withProducttrace(nextConfig);
const check: Promise<NextConfig> = plain('phase-development-server', { defaultConfig: {} });
void check;
`);
  for (const moduleResolution of [ts.ModuleResolutionKind.Node10, ts.ModuleResolutionKind.Bundler]) {
    const program = ts.createProgram([file], { strict: true, noEmit: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution, types: [] });
    const errors = ts.getPreEmitDiagnostics(program).map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
    assert.deepEqual(errors, [], `moduleResolution ${ts.ModuleResolutionKind[moduleResolution]}`);
  }
});

test('a burst of actions (a held-down undo key) shares one page-wide function row budget', () => {
  const { runtime, dispatch } = loadBrowserRuntime({ extraGlobals: { event: undefined } });
  for (let press = 0; press < 80; press += 1) {
    dispatch('keydown', fakeElement('body'), { key: 'z', ctrlKey: true }, () => {
      for (let call = 0; call < 3000; call += 1) runtime.exit(runtime.enter(1000 + press));
    });
  }
  const enters = runtime.records.filter((row) => row.kind === 'function.enter');
  assert.equal(enters.length, 5000, '5,000 function rows per 10 s window, then counted only');
  const limits = runtime.records.filter((row) => row.kind === 'capture.limit' && row.reason === 'page_budget');
  assert.equal(limits.length, 1);
  assert.equal(runtime.records.filter((row) => row.kind === 'dom.action').length, 80, 'every key press is still recorded');
});
