#!/usr/bin/env node
// One command: bulletproof-react (an open-source React app) with producttrace,
// and the live session story beside it.
//
//   npm run demo -w examples/bulletproof-react             # vite dev server (first run clones and installs)
//   npm run demo -w examples/bulletproof-react -- --build  # instrumented build + vite preview (~6–7 min)
//   npm run demo -w examples/bulletproof-react -- --rebuild
//
// The app's source is never edited. A wrapper Vite config imports the app's own
// config and adds the one producttrace() line. By default the app runs on the
// Vite dev server; `--build` builds it in development mode and serves it with
// `vite preview`, the way a deployed build would run.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = 'https://github.com/alan2207/bulletproof-react';
const COMMIT = '9506629ed003a561c6627735480cce4994244bb4';
const APP_PORT = Number(process.env.APP_PORT || 4173);
const COLLECTOR_PORT = Number(process.env.COLLECTOR_PORT || 8787);
const work = path.resolve(
  process.env.WORK ||
    path.join(os.homedir(), '.cache', 'producttrace-examples', 'bulletproof-react'),
);
const app = path.join(work, 'apps', 'react-vite');
const out = path.join(work, '.producttrace-dist');
const store = path.join(work, '.tracer');
const rebuild = process.argv.includes('--rebuild');
const build = rebuild || process.argv.includes('--build');

const log = (...parts) => console.log('[demo]', ...parts);
const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.status !== 0)
    throw new Error(`${command} ${args.join(' ')} failed (${result.status})`);
};

// 1. A pinned checkout of the app.
if (!fs.existsSync(path.join(work, '.git'))) {
  log(`cloning ${REPO} at ${COMMIT.slice(0, 7)} into ${work}`);
  fs.mkdirSync(work, { recursive: true });
  run('git', ['init', '-q'], { cwd: work });
  run('git', ['fetch', '-q', '--depth', '1', REPO, COMMIT], { cwd: work });
  run('git', ['checkout', '-q', 'FETCH_HEAD'], { cwd: work });
}

// 2. Its dependencies. Its yarn.lock pins a mirror registry, so npm resolves from package.json.
if (!fs.existsSync(path.join(app, 'node_modules', 'vite'))) {
  log('installing the app (npm, legacy peer deps)');
  fs.rmSync(path.join(app, 'yarn.lock'), { force: true });
  if (!fs.existsSync(path.join(app, '.env')))
    fs.copyFileSync(path.join(app, '.env.example'), path.join(app, '.env'));
  run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--legacy-peer-deps'], {
    cwd: app,
  });
}

// 3. The one producttrace() line, in a wrapper config outside the app's source.
const plugin = fileURLToPath(import.meta.resolve('producttrace/vite'));
const original = ['vite.config.ts', 'vite.config.mts', 'vite.config.js', 'vite.config.mjs']
  .map((name) => path.join(app, name))
  .find((file) => fs.existsSync(file));
const wrapper = path.join(app, 'node_modules', '.producttrace-demo.vite.config.mjs');
fs.writeFileSync(
  wrapper,
  `import original from ${JSON.stringify(original)};
import { producttrace } from ${JSON.stringify(plugin)};
export default async (env) => {
  const base = typeof original === 'function' ? await original(env) : await original;
  return {
    ...base,
    build: { ...(base.build || {}), outDir: ${JSON.stringify(out)}, emptyOutDir: true },
    plugins: [
      ...producttrace({ requestBridge: false, stamps: true, collector: 'http://127.0.0.1:${COLLECTOR_PORT}' }),
      ...(base.plugins || []),
    ],
  };
};
`,
);
const vite = path.join(app, 'node_modules', 'vite', 'bin', 'vite.js');
if (build && (rebuild || !fs.existsSync(path.join(out, 'index.html')))) {
  log('building with producttrace (development mode; this is the slow step)');
  const started = Date.now();
  run(process.execPath, [vite, 'build', '--mode', 'development', '--config', wrapper], {
    cwd: app,
  });
  log(`built in ${Math.round((Date.now() - started) / 1000)} s`);
}

// 4. Collector (writes the store, serves the story) and the built app.
// The package's `producttrace-collector` bin.
const packageRoot = path.dirname(fileURLToPath(import.meta.resolve('producttrace/package.json')));
const collectorBin = path.join(
  packageRoot,
  JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8')).bin[
    'producttrace-collector'
  ],
);
const children = [
  spawn(
    process.execPath,
    [
      collectorBin,
      '--store',
      store,
      '--manifest',
      path.join(app, 'node_modules', '.producttrace', 'runtime-attribution-manifest.json'),
      '--source-root',
      work,
      '--port',
      String(COLLECTOR_PORT),
    ],
    { stdio: 'inherit' },
  ),
  spawn(
    process.execPath,
    [
      vite,
      ...(build ? ['preview', '--outDir', out] : []),
      '--config',
      wrapper,
      '--host',
      '127.0.0.1',
      '--port',
      String(APP_PORT),
      '--strictPort',
    ],
    { cwd: app, stdio: 'inherit' },
  ),
];
const stop = () => {
  for (const child of children) child.kill('SIGTERM');
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
log(`app:    http://127.0.0.1:${APP_PORT}/`);
log(`story:  http://127.0.0.1:${COLLECTOR_PORT}/story   (live: /story/stream)`);
log(`drive a scripted session: npm run drive -w examples/bulletproof-react`);
