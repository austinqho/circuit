// One target app: an open-source React repository (Vite or Next.js), cloned,
// installed, run with producttrace's one install line, and served next to a
// collector.
//
// The repository's own source is never edited. For Vite the plugin line lives
// in a wrapper config outside the checkout that imports the original config.
// Next.js only reads next.config.* from the app folder, so in the throwaway
// clone the original moves to next.config.circuit-original.* and a wrapper
// that imports it takes its name. The only other file the bench rewrites in
// its clone is the lockfile's registry host (mirror registries such as
// npmmirror are rewritten to registry.npmjs.org), so installs work behind
// restricted networks.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const VITE_CONFIGS = ['vite.config.ts', 'vite.config.mts', 'vite.config.js', 'vite.config.mjs'];
const NEXT_CONFIGS = ['next.config.ts', 'next.config.mjs', 'next.config.js'];
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'e2e',
  'test',
  'tests',
  'examples',
  'docs',
  '.storybook',
]);

/** Turns "owner/repo", a github.com URL or a local path into { url, name }. */
export function parseRepo(input) {
  const text = String(input || '').trim();
  if (!text) throw new Error('repo is required');
  if (fs.existsSync(text))
    return { url: path.resolve(text), name: path.basename(path.resolve(text)), local: true };
  const short = text.match(/^([\w.-]+)\/([\w.-]+)$/u);
  if (short)
    return {
      url: `https://github.com/${short[1]}/${short[2]}`,
      name: short[2].replace(/\.git$/u, ''),
    };
  const parsed = new URL(text);
  const parts = parsed.pathname
    .replace(/^\/|\/$/gu, '')
    .replace(/\.git$/u, '')
    .split('/');
  // github.com/owner/repo/tree/<ref>/<dir> is accepted and split into ref and app dir.
  const tree =
    parts[2] === 'tree' ? { ref: parts[3], appDir: parts.slice(4).join('/') || undefined } : {};
  return { url: `${parsed.origin}/${parts[0]}/${parts[1]}`, name: parts[1], ...tree };
}

/** Every directory holding a Vite or Next.js config, best React candidate first. */
export function findApps(root, { maxDepth = 4 } = {}) {
  const found = [];
  const walk = (dir, depth) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const has = (name) => entries.some((entry) => entry.isFile() && entry.name === name);
    const nextConfig = NEXT_CONFIGS.find(has);
    const config = nextConfig || VITE_CONFIGS.find(has);
    if (config) {
      let pkg = {};
      try {
        pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
      } catch {}
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      const rel = path.relative(root, dir) || '.';
      let score = 0;
      if (deps.react) score += 10;
      if (deps['@vitejs/plugin-react'] || deps['@vitejs/plugin-react-swc'] || deps.next) score += 5;
      if (/(^|\/)(web|client|frontend|app|react)/iu.test(rel)) score += 1;
      score -= depth;
      found.push({
        dir: rel,
        config,
        framework: nextConfig ? 'next' : 'vite',
        react: Boolean(deps.react),
        score,
      });
    }
    if (depth >= maxDepth) return;
    for (const entry of entries) {
      if (entry.isDirectory() && !SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.'))
        walk(path.join(dir, entry.name), depth + 1);
    }
  };
  walk(root, 0);
  return found.sort((a, b) => b.score - a.score);
}

/** The app config in one folder, for an app_dir deeper than the search goes. */
function configIn(root, dir) {
  const has = (name) => fs.existsSync(path.join(root, dir, name));
  const next = NEXT_CONFIGS.find(has);
  return { dir, config: next || VITE_CONFIGS.find(has), framework: next ? 'next' : 'vite' };
}

/** The lockfile that governs appDir (searching up to root) and the install command for it. */
export function detectInstall(root, appDir) {
  for (let dir = path.resolve(root, appDir); ; dir = path.dirname(dir)) {
    const has = (name) => fs.existsSync(path.join(dir, name));
    if (has('pnpm-lock.yaml'))
      return {
        dir,
        lockfile: 'pnpm-lock.yaml',
        command: 'pnpm',
        args: ['install', '--frozen-lockfile', '--ignore-scripts'],
      };
    if (has('yarn.lock')) {
      const berry = fs.readFileSync(path.join(dir, 'yarn.lock'), 'utf8').includes('__metadata:');
      return berry
        ? {
            dir,
            lockfile: 'yarn.lock',
            command: 'corepack',
            args: ['yarn', 'install', '--mode=skip-build'],
          }
        : {
            dir,
            lockfile: 'yarn.lock',
            command: 'yarn',
            args: [
              'install',
              '--frozen-lockfile',
              '--ignore-scripts',
              '--network-timeout',
              '120000',
            ],
          };
    }
    if (has('bun.lockb') || has('bun.lock'))
      // bun when it is installed (workspaces and its lockfile); npm otherwise.
      return onPath('bun')
        ? { dir, lockfile: 'bun.lock', command: 'bun', args: ['install', '--ignore-scripts'] }
        : {
            dir,
            lockfile: 'bun.lock',
            command: 'npm',
            args: ['install', '--ignore-scripts', '--no-audit', '--no-fund'],
          };
    if (has('package-lock.json'))
      return {
        dir,
        lockfile: 'package-lock.json',
        command: 'npm',
        args: ['ci', '--ignore-scripts', '--no-audit', '--no-fund'],
      };
    if (dir === path.resolve(root) || dir === path.dirname(dir)) break;
  }
  return {
    dir: path.resolve(root, appDir),
    lockfile: null,
    command: 'npm',
    args: ['install', '--ignore-scripts', '--no-audit', '--no-fund'],
  };
}

/** Whether a command is on PATH. */
export function onPath(command) {
  return (process.env.PATH || '')
    .split(path.delimiter)
    .some((dir) => dir && fs.existsSync(path.join(dir, command)));
}

const MIRRORS =
  /https:\/\/(registry\.npmmirror\.com|registry\.yarnpkg\.com|registry\.npm\.taobao\.org|r\.cnpmjs\.org)\//gu;
export function rewriteLockfileRegistry(file) {
  if (!file || !fs.existsSync(file)) return 0;
  const text = fs.readFileSync(file, 'utf8');
  let count = 0;
  const next = text.replace(MIRRORS, () => {
    count += 1;
    return 'https://registry.npmjs.org/';
  });
  if (count) fs.writeFileSync(file, next);
  return count;
}

/**
 * Example env files give an app the variables it needs to boot: VITE_* only for
 * Vite, every variable for Next.js (its server code reads them too).
 */
export function exampleEnv(appRoot, { all = false } = {}) {
  const env = {};
  for (const name of [
    '.env',
    '.env.example',
    '.env.sample',
    '.env.local.example',
    '.env.development',
  ]) {
    const file = path.join(appRoot, name);
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const match = line.match(
        all
          ? /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/u
          : /^\s*(?:export\s+)?(VITE_[A-Z0-9_]+)\s*=\s*(.*)\s*$/u,
      );
      if (match && !(match[1] in env)) env[match[1]] = match[2].replace(/^(['"])(.*)\1$/u, '$2');
    }
  }
  return env;
}

export function wrapperConfig({ originalConfig, outDir, pluginOptions }) {
  return `// Generated by circuit-web. Wraps ${originalConfig} unchanged and adds the one producttrace line.
import original from ${JSON.stringify(originalConfig)};
import { producttrace } from 'producttrace/vite';

export default async env => {
  const base = typeof original === 'function' ? await original(env) : await original;
  return {
    ...base,
    base: '/',
    // The bench is headless: an app that opens a browser tab on start would crash without one.
    server: { ...(base.server || {}), open: false },
    build: { ...(base.build || {}), outDir: ${JSON.stringify(outDir)}, emptyOutDir: true },
    plugins: [
      ...(process.env.CIRCUIT_PRODUCTTRACE === '0' ? [] : producttrace(${JSON.stringify(pluginOptions)})),
      ...(base.plugins || []),
    ],
  };
};
`;
}

/**
 * The Next.js config the bench puts in the clone: the app's own config (moved
 * beside it) wrapped in withProducttrace, in the same file type.
 */
export function nextWrapperConfig({ originalConfig, nextModule, options, commonjs }) {
  const original = `./${path.basename(originalConfig).replace(/\.ts$/u, '')}`;
  const header = `// Generated by circuit-web. Wraps ${path.basename(originalConfig)} unchanged with withProducttrace.\n`;
  if (commonjs)
    return `${header}const original = require(${JSON.stringify(original)});
const { withProducttrace } = require(${JSON.stringify(nextModule)});
module.exports = withProducttrace(original.default ?? original, ${JSON.stringify(options)});
`;
  return `${header}import original from ${JSON.stringify(original)};
import { withProducttrace } from ${JSON.stringify(nextModule)};
export default withProducttrace(original, ${JSON.stringify(options)});
`;
}

// A package.json above the clone (say ~/package.json) can pin a package manager
// through corepack, which then refuses to run the app's own; the clone decides.
const TOOL_ENV = { COREPACK_ENABLE_STRICT: '0' };

function run(command, args, { cwd, env, logFile, timeoutMs = 20 * 60 * 1000 }) {
  return new Promise((resolve, reject) => {
    fs.appendFileSync(logFile, `\n$ ${command} ${args.join(' ')}   (in ${cwd})\n`);
    const out = fs.openSync(logFile, 'a');
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...TOOL_ENV, ...env },
      stdio: ['ignore', out, out],
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('error', (error) => {
      clearTimeout(timer);
      fs.closeSync(out);
      reject(error);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      fs.closeSync(out);
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args[0]} exited ${code}; see the build log`));
    });
  });
}

const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain',
};

/** The app on its dev server (Vite with the wrapper config, or next dev); resolves once it answers. */
export async function serveDev(
  { framework = 'vite', viteBin, nextBin, wrapper, appRoot, env },
  port,
  logFile,
) {
  const out = fs.openSync(logFile, 'a');
  const args =
    framework === 'next'
      ? [nextBin, 'dev', '--hostname', '127.0.0.1', '--port', String(port)]
      : [
          viteBin,
          '--config',
          wrapper,
          '--host',
          '127.0.0.1',
          '--port',
          String(port),
          '--strictPort',
        ];
  const child = spawn(process.execPath, args, {
    cwd: appRoot,
    env: { ...process.env, ...TOOL_ENV, NODE_ENV: 'development', ...env },
    stdio: ['ignore', out, out],
  });
  fs.closeSync(out);
  const exited = new Promise((resolve) => child.once('exit', resolve));
  // Large apps take a while: the plugin reads the whole client source before Vite listens.
  const up = await Promise.race([
    waitForHttp(`http://127.0.0.1:${port}/`, 300000),
    exited.then(() => false),
  ]);
  if (!up) {
    child.kill('SIGTERM');
    throw new Error(
      `the ${framework === 'next' ? 'Next.js' : 'Vite'} dev server did not start; see the build log`,
    );
  }
  return { close: () => child.kill('SIGTERM') };
}

/** Static server with SPA fallback to index.html. */
export function serveStatic(root, port) {
  const server = http.createServer((req, res) => {
    let file = path.join(root, decodeURIComponent(new URL(req.url, 'http://local').pathname));
    if (
      !file.startsWith(root + path.sep) ||
      !fs.existsSync(file) ||
      fs.statSync(file).isDirectory()
    )
      file = path.join(root, 'index.html');
    res.writeHead(200, {
      'content-type': TYPES[path.extname(file)] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

export async function waitForHttp(url, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fetch(url);
      return true;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return false;
}

/**
 * Clone (once), install (once), then build with the plugin. `rebuild` skips the
 * clone and install, so a package change is tested with one build.
 */
export async function buildTarget(app, { packageDir, log, rebuild = false }) {
  const work = app.work;
  const src = path.join(work, 'src');
  const logFile = path.join(work, 'build.log');
  fs.mkdirSync(work, { recursive: true });
  if (!rebuild) fs.writeFileSync(logFile, '');
  const step = (name) => {
    app.phase = name;
    log(name);
    fs.appendFileSync(logFile, `\n== ${name}\n`);
  };

  if (!rebuild || !fs.existsSync(src)) {
    step('cloning');
    fs.rmSync(src, { recursive: true, force: true });
    if (app.local)
      fs.cpSync(app.url, src, {
        recursive: true,
        filter: (file) => !/\/node_modules(\/|$)/u.test(file),
      });
    else
      await run(
        'git',
        ['clone', '--depth', '1', ...(app.ref ? ['--branch', app.ref] : []), app.url, src],
        { cwd: work, logFile },
      );

    const apps = findApps(src);
    app.candidates = apps.map((candidate) => candidate.dir);
    const chosen = app.appDir
      ? apps.find((candidate) => candidate.dir === app.appDir) || configIn(src, app.appDir)
      : apps[0];
    if (!chosen?.config)
      throw new Error(
        `no Vite or Next.js config found${app.appDir ? ` in ${app.appDir}` : ''}; candidates: ${apps.map((c) => c.dir).join(', ') || 'none'}. This bench supports Vite + React and Next.js apps.`,
      );
    app.appDir = chosen.dir;
    app.framework = chosen.framework;
    if (chosen.framework === 'next') app.nextConfig = chosen.config;
    else app.viteConfig = chosen.config;

    step('installing dependencies');
    const install = detectInstall(src, app.appDir);
    const rewritten = install.lockfile
      ? rewriteLockfileRegistry(path.join(install.dir, install.lockfile))
      : 0;
    if (rewritten)
      fs.appendFileSync(
        logFile,
        `rewrote ${rewritten} mirror registry URL(s) in ${install.lockfile} to registry.npmjs.org\n`,
      );
    app.install = {
      dir: path.relative(src, install.dir) || '.',
      command: [install.command, ...install.args].join(' '),
    };
    const [command, args] = onPath(install.command)
      ? [install.command, install.args]
      : // A machine without yarn or pnpm still installs: npx fetches the tool once.
        ['npx', ['--yes', install.command === 'pnpm' ? 'pnpm@9' : 'yarn@1', ...install.args]];
    await run(command, args, {
      cwd: install.dir,
      logFile,
      env: { PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1', CYPRESS_INSTALL_BINARY: '0', HUSKY: '0' },
    });
  }

  step(app.mode === 'build' ? 'building with producttrace' : 'attaching producttrace');
  const appRoot = path.join(src, app.appDir);
  if (app.framework === 'next') return attachNext(app, { packageDir, appRoot, src });
  const consumer = path.join(work, 'consumer');
  fs.mkdirSync(path.join(consumer, 'node_modules'), { recursive: true });
  fs.writeFileSync(
    path.join(consumer, 'package.json'),
    JSON.stringify({ name: 'circuit-consumer', private: true, type: 'module' }),
  );
  const link = path.join(consumer, 'node_modules', 'producttrace');
  fs.rmSync(link, { force: true, recursive: true });
  fs.symlinkSync(packageDir, link);
  const outDir = path.join(work, 'dist');
  // A production build turns control labels and bodies off by default; a test
  // bench wants both, in either mode.
  const pluginOptions = {
    requestBridge: false,
    bodies: 'always',
    labels: 'always',
    collector: { url: `http://127.0.0.1:${app.ports.collector}`, force: true },
    ...(app.pluginOptions || {}),
  };
  const wrapper = path.join(consumer, 'vite.circuit.config.mjs');
  fs.writeFileSync(
    wrapper,
    wrapperConfig({ originalConfig: path.join(appRoot, app.viteConfig), outDir, pluginOptions }),
  );
  fs.rmSync(path.join(appRoot, 'node_modules', '.producttrace'), { recursive: true, force: true });
  const viteBin = [appRoot, src]
    .map((dir) => path.join(dir, 'node_modules', 'vite', 'bin', 'vite.js'))
    .find((file) => fs.existsSync(file));
  if (!viteBin) throw new Error('vite is not installed in the target app');
  const env = { ...exampleEnv(appRoot), ...(app.env || {}) };
  if (app.mode !== 'build') {
    // Dev mode: nothing to build; start() runs the Vite dev server with the wrapper.
    app.serve = { viteBin, wrapper, appRoot, env };
    app.buildMs = 0;
    app.builtAt = new Date().toISOString();
    return;
  }
  const started = Date.now();
  await run(process.execPath, [viteBin, 'build', '--config', wrapper], {
    cwd: appRoot,
    logFile,
    env: {
      NODE_ENV: 'production',
      NODE_OPTIONS: '--max-old-space-size=8192',
      ...env,
    },
  });
  app.buildMs = Date.now() - started;
  app.builtAt = new Date().toISOString();
}

/** Next.js: wrap the config in the clone with withProducttrace; start() runs next dev. */
function attachNext(app, { packageDir, appRoot, src }) {
  // withProducttrace instruments next dev; a production build is served untouched.
  if (app.mode === 'build')
    throw new Error('Next.js apps run on next dev in the bench; add them without mode "build"');
  const wrapper = path.join(appRoot, app.nextConfig);
  const extension = path.extname(app.nextConfig);
  const originalConfig = path.join(appRoot, `next.config.circuit-original${extension}`);
  // A rebuild finds the original already moved and only rewrites the wrapper.
  if (!fs.existsSync(originalConfig)) fs.renameSync(wrapper, originalConfig);
  let commonjs = false;
  if (extension === '.js') {
    try {
      commonjs =
        JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8')).type !== 'module';
    } catch {
      commonjs = true;
    }
  }
  const options = {
    bodies: true,
    labels: true,
    collector: { url: `http://127.0.0.1:${app.ports.collector}`, force: true },
    ...(app.pluginOptions || {}),
  };
  fs.writeFileSync(
    wrapper,
    nextWrapperConfig({
      originalConfig,
      nextModule: path.join(packageDir, 'next.mjs'),
      options,
      commonjs,
    }),
  );
  fs.rmSync(path.join(appRoot, 'node_modules', '.producttrace'), { recursive: true, force: true });
  const nextBin = [appRoot, src]
    .map((dir) => path.join(dir, 'node_modules', 'next', 'dist', 'bin', 'next'))
    .find((file) => fs.existsSync(file));
  if (!nextBin) throw new Error('next is not installed in the target app');
  const env = { ...exampleEnv(appRoot, { all: true }), ...(app.env || {}) };
  app.serve = { framework: 'next', nextBin, wrapper, appRoot, env };
  app.buildMs = 0;
  app.builtAt = new Date().toISOString();
}
