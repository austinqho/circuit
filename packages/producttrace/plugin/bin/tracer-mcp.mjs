#!/usr/bin/env node
/**
 * Plugin launcher for the Tracer MCP server.
 *
 * Whether Codex starts a plugin's stdio server in the active project is not
 * verified, so the store is resolved from, in order:
 *   1. --store <dir>                     (argument)
 *   2. TRACER_STORE                      (relative paths resolve against TRACER_PROJECT_ROOT, else cwd)
 *   3. TRACER_PROJECT_ROOT/.tracer
 *   4. the nearest .tracer/ walking up from process.cwd(), stopping at a git root
 * Optional: TRACER_MANIFEST, TRACER_SOURCE_ROOT (default: the project root).
 *
 * It never downloads anything: the server is loaded from the nearest
 * node_modules/producttrace above the project (or the store). Diagnostics go
 * to stderr; stdout is the MCP protocol.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const fail = message => { process.stderr.write(`tracer plugin: ${message}\n`); process.exit(2); };
const isDir = file => { try { return fs.statSync(file).isDirectory(); } catch { return false; } };

/** Walk up from `start`; return the first dir for which `test(dir)` holds. Stop after a git root. */
export function findUp(start, test, { stopAtGitRoot = true } = {}) {
  let dir = path.resolve(start);
  for (;;) {
    if (test(dir)) return dir;
    if (stopAtGitRoot && fs.existsSync(path.join(dir, '.git'))) return null;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function resolveLaunch(argv = process.argv.slice(2), env = process.env, cwd = process.cwd()) {
  const flag = argv.indexOf('--store');
  const envRoot = env.TRACER_PROJECT_ROOT ? path.resolve(env.TRACER_PROJECT_ROOT) : null;
  let store = null; let source = null;
  if (flag !== -1 && argv[flag + 1]) { store = path.resolve(cwd, argv[flag + 1]); source = '--store'; }
  else if (env.TRACER_STORE) { store = path.resolve(envRoot || cwd, env.TRACER_STORE); source = 'TRACER_STORE'; }
  else if (envRoot) { store = path.join(envRoot, '.tracer'); source = 'TRACER_PROJECT_ROOT'; }
  else {
    const found = findUp(cwd, dir => isDir(path.join(dir, '.tracer')));
    if (found) { store = path.join(found, '.tracer'); source = 'walk-up from cwd'; }
  }
  if (!store) return { error: `no store found: pass --store, set TRACER_STORE or TRACER_PROJECT_ROOT, or start in a project containing .tracer/ (searched up from ${cwd} to the git root)` };
  const projectRoot = envRoot || (path.basename(store) === '.tracer' ? path.dirname(store) : cwd);
  const packageDir = findUp(projectRoot, dir => fs.existsSync(path.join(dir, 'node_modules', 'producttrace', 'mcp', 'server.mjs')), { stopAtGitRoot: false });
  if (!packageDir) return { error: `producttrace is not installed at or above ${projectRoot}; run npm i -D producttrace there` };
  const args = ['--store', store, '--source-root', path.resolve(projectRoot, env.TRACER_SOURCE_ROOT || '.')];
  if (env.TRACER_MANIFEST) args.push('--manifest', path.resolve(projectRoot, env.TRACER_MANIFEST));
  return { store, source, projectRoot, server: path.join(packageDir, 'node_modules', 'producttrace', 'mcp', 'server.mjs'), args };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const launch = resolveLaunch();
  if (launch.error) fail(launch.error);
  process.stderr.write(`tracer plugin: store ${launch.store} (from ${launch.source})\n`);
  const { main } = await import(pathToFileURL(launch.server).href);
  await main(launch.args);
}
