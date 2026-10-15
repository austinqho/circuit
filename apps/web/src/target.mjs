// One target app: an open-source Vite + React repository, cloned, installed,
// built with producttrace's one plugin line, and served next to a collector.
//
// The repository's own source is never edited. The plugin line lives in a
// wrapper Vite config outside the checkout that imports the original config.
// The only file the bench rewrites in its throwaway clone is the lockfile's
// registry host (mirror registries such as npmmirror are rewritten to
// registry.npmjs.org), so installs work behind restricted networks.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const VITE_CONFIGS = ['vite.config.ts', 'vite.config.mts', 'vite.config.js', 'vite.config.mjs'];
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

/** Every directory holding a Vite config, best React candidate first. */
export function findViteApps(root, { maxDepth = 4 } = {}) {
  const found = [];
  const walk = (dir, depth) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const config = VITE_CONFIGS.find((name) =>
      entries.some((entry) => entry.isFile() && entry.name === name),
    );
    if (config) {
      let pkg = {};
      try {
        pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
      } catch {}
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      const rel = path.relative(root, dir) || '.';
      let score = 0;
      if (deps.react) score += 10;
      if (deps['@vitejs/plugin-react'] || deps['@vitejs/plugin-react-swc']) score += 5;
      if (/(^|\/)(web|client|frontend|app|react)/iu.test(rel)) score += 1;
      score -= depth;
      found.push({ dir: rel, config, react: Boolean(deps.react), score });
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
      return {
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

/** Example env files give an app the variables it needs to boot (VITE_* only). */
export function exampleEnv(appRoot) {
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
      const match = line.match(/^\s*(?:export\s+)?(VITE_[A-Z0-9_]+)\s*=\s*(.*)\s*$/u);
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
    build: { ...(base.build || {}), outDir: ${JSON.stringify(outDir)}, emptyOutDir: true },
    plugins: [
      ...(process.env.CIRCUIT_PRODUCTTRACE === '0' ? [] : producttrace(${JSON.stringify(pluginOptions)})),
      ...(base.plugins || []),
    ],
  };
};
`;
}

function run(command, args, { cwd, env, logFile, timeoutMs = 20 * 60 * 1000 }) {
  return new Promise((resolve, reject) => {
    fs.appendFileSync(logFile, `\n$ ${command} ${args.join(' ')}   (in ${cwd})\n`);
    const out = fs.openSync(logFile, 'a');
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
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

    const apps = findViteApps(src);
    app.candidates = apps.map((candidate) => candidate.dir);
    const chosen = app.appDir
      ? apps.find((candidate) => candidate.dir === app.appDir) || {
          dir: app.appDir,
          config: VITE_CONFIGS.find((name) => fs.existsSync(path.join(src, app.appDir, name))),
        }
      : apps[0];
    if (!chosen?.config)
      throw new Error(
        `no Vite config found${app.appDir ? ` in ${app.appDir}` : ''}; candidates: ${apps.map((c) => c.dir).join(', ') || 'none'}. This bench supports Vite + React apps.`,
      );
    app.appDir = chosen.dir;
    app.viteConfig = chosen.config;

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

  step('building with producttrace');
  const appRoot = path.join(src, app.appDir);
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
  // The bench builds in production mode (the app as users get it), where the
  // package turns control labels and bodies off by default; a test bench wants both.
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
  const started = Date.now();
  await run(process.execPath, [viteBin, 'build', '--config', wrapper], {
    cwd: appRoot,
    logFile,
    env: {
      NODE_ENV: 'production',
      NODE_OPTIONS: '--max-old-space-size=8192',
      ...exampleEnv(appRoot),
      ...(app.env || {}),
    },
  });
  app.buildMs = Date.now() - started;
  app.builtAt = new Date().toISOString();
}
