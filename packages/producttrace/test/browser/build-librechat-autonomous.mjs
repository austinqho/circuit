import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const tracerRoot = path.resolve(import.meta.dirname, '../..');
const sourceRepository = fs.realpathSync(path.resolve(process.argv[2]
  || '/Users/austinho/dev/trace-consolidated/.live-demo/librechat-clean'));
const worktree = path.resolve(process.argv[3] || '/tmp/producttrace-librechat-autonomous');
const configPath = path.resolve(process.argv[4] || '/tmp/producttrace-librechat-autonomous.json');
const attributionManifestPath = `${configPath}.attribution.json`;
const bridgeEndpoint = process.env.PRODUCTTRACE_BRIDGE_ENDPOINT
  || 'http://127.0.0.1:8123/api/demo/bridge';
const revision = '45cc53c40b47645b887c3bb996168e06aaa83f4c';
const reuseWorktree = process.env.PRODUCTTRACE_REUSE_WORKTREE === '1';
const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

if (git(sourceRepository, ['rev-parse', `${revision}^{commit}`]) !== revision) {
  throw new Error('Pinned LibreChat revision is unavailable');
}
if (!reuseWorktree) {
  if (fs.existsSync(worktree)) {
    try { execFileSync('git', ['worktree', 'remove', '--force', worktree], { cwd: sourceRepository }); }
    catch { fs.rmSync(worktree, { recursive: true, force: true }); }
  }
  execFileSync('git', ['worktree', 'prune'], { cwd: sourceRepository });
  execFileSync('git', ['worktree', 'add', '--detach', worktree, revision],
    { cwd: sourceRepository, stdio: 'inherit' });
  if (git(worktree, ['status', '--porcelain=v1'])) throw new Error('Fresh LibreChat worktree is not clean');
  execFileSync('npm', ['ci', '--ignore-scripts', '--prefer-offline', '--no-audit', '--no-fund'], {
    cwd: worktree, stdio: 'inherit',
  });
  for (const script of ['build:data-provider', 'build:data-schemas', 'build:api', 'build:client-package']) {
    execFileSync('npm', ['run', script], { cwd: worktree, stdio: 'inherit' });
  }
} else {
  if (!fs.existsSync(worktree) || git(worktree, ['status', '--porcelain=v1'])) throw new Error('Reusable worktree must exist and be clean');
}

const clientRoot = path.join(worktree, 'client');
const wrapper = path.join(os.tmpdir(), `producttrace-librechat-vite-${process.pid}.mjs`);
const originalConfigPath = path.join(clientRoot, `.producttrace-original-vite-${process.pid}.ts`);
const originalSource = fs.readFileSync(path.join(clientRoot, 'vite.config.ts'), 'utf8');
const importLines = [...originalSource.matchAll(/^import[^;]+;$/gmu)];
if (!importLines.length) throw new Error('LibreChat Vite configuration imports could not be located');
const insertAt = importLines.at(-1).index + importLines.at(-1)[0].length;
const pwaSafeSource = originalSource.replace(/globIgnores:\s*\[/u, 'globIgnores: ["producttrace-request-bridge.js",');
fs.writeFileSync(originalConfigPath, `${pwaSafeSource.slice(0, insertAt)}\nconst __dirname = ${JSON.stringify(clientRoot)};${pwaSafeSource.slice(insertAt)}`);
const originalConfig = pathToFileURL(originalConfigPath).href;
const pluginModule = pathToFileURL(path.join(tracerRoot, 'integrations/vite.mjs')).href;
const attributionModule = pathToFileURL(path.join(tracerRoot, 'integrations/runtime-attribution.mjs')).href;
fs.writeFileSync(wrapper, `
import originalConfig from ${JSON.stringify(originalConfig)};
import { productTraceVitePlugin } from ${JSON.stringify(pluginModule)};
import { runtimeAttributionPlugin } from ${JSON.stringify(attributionModule)};

const productTrace = productTraceVitePlugin({
  repository: ${JSON.stringify(worktree)},
  service: 'librechat-api',
  backendEntrypoint: 'api/server/index.js',
  bridgeEndpoint: ${JSON.stringify(bridgeEndpoint)},
  configPath: ${JSON.stringify(configPath)},
  attributionManifestPath: ${JSON.stringify(attributionManifestPath)},
});

export default async environment => {
  const base = typeof originalConfig === 'function' ? await originalConfig(environment) : originalConfig;
  const attribution = process.env.PRODUCTTRACE_DISABLE_RUNTIME_ATTRIBUTION
    ? []
    : [runtimeAttributionPlugin({ repository: ${JSON.stringify(worktree)}, manifestPath: ${JSON.stringify(attributionManifestPath)} })];
  const productTracePlugins = process.env.PRODUCTTRACE_DISABLE_PLUGIN ? [] : [productTrace, ...attribution];
  return { ...base, build: { ...(base.build || {}), sourcemap: true }, plugins: [...productTracePlugins, ...(base.plugins || [])] };
};
`);

const vite = path.join(worktree, 'node_modules/vite/bin/vite.js');
try {
  execFileSync(process.execPath, [vite, 'build', '--config', wrapper, '--configLoader', 'runner'], {
    cwd: clientRoot,
    env: { ...process.env, NODE_ENV: 'production', NODE_OPTIONS: '--max-old-space-size=8192' },
    stdio: 'inherit',
  });
  execFileSync(process.execPath, [path.join(worktree, 'client/scripts/post-build.cjs')], {
    cwd: clientRoot, env: { ...process.env, NODE_ENV: 'production' }, stdio: 'inherit',
  });
} finally {
  fs.rmSync(wrapper, { force: true });
  fs.rmSync(originalConfigPath, { force: true });
}

const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : { coverage: {} };
const productTraceEnabled = !process.env.PRODUCTTRACE_DISABLE_PLUGIN;
const attributionEnabled = productTraceEnabled && !process.env.PRODUCTTRACE_DISABLE_RUNTIME_ATTRIBUTION;
let runtimeSmoke = null;
let parityGate = null;
const trackedChanges = git(worktree, ['status', '--porcelain=v1', '--untracked-files=no']);
if (trackedChanges) throw new Error(`Instrumentation changed tracked LibreChat files:\n${trackedChanges}`);
if (productTraceEnabled && !fs.existsSync(path.join(worktree, 'client/dist/producttrace-request-bridge.js'))) {
  throw new Error('Instrumented browser bridge asset was not emitted');
}
const builtIndex = fs.readFileSync(path.join(worktree, 'client/dist/index.html'), 'utf8');
if (productTraceEnabled && !/\/producttrace-runtime\.js\?v=[a-f0-9]{16}/u.test(builtIndex)) {
  throw new Error('Instrumented runtime asset is not content-addressed in the built HTML');
}
if (productTraceEnabled && !/\/producttrace-request-bridge\.js\?v=[a-f0-9]{16}/u.test(builtIndex)) {
  throw new Error('Instrumented request bridge asset is not content-addressed in the built HTML');
}
if (attributionEnabled) {
  if (!fs.existsSync(attributionManifestPath)) throw new Error('Runtime attribution manifest was not emitted');
  const attributionManifest = JSON.parse(fs.readFileSync(attributionManifestPath, 'utf8'));
  const jsFiles = [];
  const walk = directory => { for (const entry of fs.readdirSync(directory, { withFileTypes: true })) { const absolute = path.join(directory, entry.name); if (entry.isDirectory()) walk(absolute); else if (entry.isFile() && /\.js$/u.test(entry.name)) jsFiles.push(absolute); } };
  walk(path.join(worktree, 'client/dist'));
  const bundle = jsFiles.map(file => fs.readFileSync(file, 'utf8')).join('\n');
  const markerCount = new Set(attributionManifest.functions.map(row => row.id).filter(id => bundle.includes(id))).size;
  if (!attributionManifest.functions.length) throw new Error('Runtime attribution emitted zero first-party function markers');
  if (markerCount !== attributionManifest.functions.length) throw new Error(`Only ${markerCount} of ${attributionManifest.functions.length} runtime attribution function markers are present in the served bundle`);
  runtimeSmoke = JSON.parse(execFileSync(process.execPath, [path.join(tracerRoot, 'test/browser/runtime-attribution-smoke.mjs'), worktree, attributionManifestPath], {
    cwd: tracerRoot, encoding: 'utf8', env: { ...process.env, PRODUCTTRACE_BROWSER_EXECUTABLE: process.env.PRODUCTTRACE_BROWSER_EXECUTABLE || '' },
  }));
  config.coverage.runtime_attribution_functions = attributionManifest.functions.length;
  config.coverage.runtime_attribution_marker_count = markerCount;
  config.coverage.runtime_smoke = runtimeSmoke;
  const paritySource = process.env.PRODUCTTRACE_PARITY_DISABLED_ROOT;
  if (paritySource) {
    const parityOutput = process.env.PRODUCTTRACE_PARITY_OUTPUT || `${configPath}.parity.json`;
    const parityScript = path.join(tracerRoot, 'test/browser/agent-builder-parity.mjs');
    parityGate = JSON.parse(execFileSync(process.execPath, [parityScript, paritySource, worktree, parityOutput], {
      cwd: tracerRoot, encoding: 'utf8', env: { ...process.env, PRODUCTTRACE_PARITY_OUTPUT: parityOutput },
    }).trim().split('\n').at(-1));
    if (!parityGate.parity) throw new Error(`Agent Builder parity gate failed; see ${parityOutput}`);
    config.coverage.parity_gate = JSON.parse(fs.readFileSync(parityOutput, 'utf8'));
  }
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}
console.log(JSON.stringify({
  schema: 'producttrace.librechat-autonomous-build.v1',
  status: 'ready', producttrace_enabled: productTraceEnabled, attribution_enabled: attributionEnabled, revision, sourceRepository, worktree, configPath,
  bridgeEndpoint,
  tracked_source_clean: true,
  coverage: {
    source_files: config.coverage.source_files,
    controls: config.coverage.controls,
    runtime_candidates: config.coverage.runtime_candidates,
    request_actions: config.coverage.request_actions,
    source_requests: config.coverage.source_requests,
    backend_routes: config.coverage.backend_routes,
    transformed_files: config.coverage.transformed_files.length,
    request_source_nodes: config.coverage.request_source_nodes,
    instrumented_request_source_nodes: config.coverage.instrumented_request_source_nodes,
    request_action_handlers: config.coverage.request_action_handlers,
    instrumented_request_action_handlers: config.coverage.instrumented_request_action_handlers,
    runtime_attribution_functions: config.coverage.runtime_attribution_functions,
    runtime_attribution_marker_count: config.coverage.runtime_attribution_marker_count,
    runtime_smoke: runtimeSmoke,
    parity_gate: parityGate,
  },
  frontiers: {
    react: config.frontiers.react.length,
    runtime: config.frontiers.runtime.length,
    backend: config.frontiers.backend.length,
    transforms: config.frontiers.transforms.length,
    application_identity: config.frontiers.application_identity.length,
  },
  attribution_manifest_path: attributionManifestPath,
  supplied_path_hints: [],
}, null, 2));
