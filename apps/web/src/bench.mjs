// The bench: the one module the website and Claude's tools talk to.
//
//   const bench = createBench();
//   const app = await bench.add({ repo: 'alan2207/bulletproof-react' });   // clone, install, build (async)
//   await bench.status(app.id, { waitSeconds: 50 });                        // until ready, failed or 50 s
//   await bench.act(app.id, { action: 'click', target: 'Get started' });    // drive it
//   await bench.report(app.id);                                             // what the package said, step by step
//
// Everything else (where the package lives, ports, processes, the collector,
// the MCP client, the wrapper config) stays inside.
import { execFileSync, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BrowserSession, closeBrowser } from './browser.mjs';
import { findPackageDir, packageBin } from './package.mjs';
import { buildTarget, parseRepo, serveDev, serveStatic, waitForHttp } from './target.mjs';
import { TracerTools, buildReport, readStory } from './tracer.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
// One wait stays under MCP clients' 60 s request timeout; callers poll while building.
export const MAX_WAIT_SECONDS = 50;

export function createBench({
  workRoot = process.env.CIRCUIT_WORK || path.join(here, '..', '.work'),
  packageDir = findPackageDir(),
  basePort = Number(process.env.CIRCUIT_APP_PORT || 4600),
} = {}) {
  fs.mkdirSync(workRoot, { recursive: true });
  const registryFile = path.join(workRoot, 'apps.json');
  const apps = new Map();
  const live = new Map(); // id -> { server, collector, browser, tools }
  const listeners = new Set();

  for (const app of (() => {
    try {
      return JSON.parse(fs.readFileSync(registryFile, 'utf8'));
    } catch {
      return [];
    }
  })()) {
    // A build interrupted by a restart is not resumable; mark it so the user can rebuild.
    if (app.status === 'building') {
      app.status = 'failed';
      app.error = 'interrupted by a restart; rebuild';
    }
    // Apps registered before dev mode existed were production builds.
    app.mode ??= 'build';
    apps.set(app.id, app);
  }
  const save = () => fs.writeFileSync(registryFile, JSON.stringify([...apps.values()], null, 2));
  const emit = (app) => {
    save();
    for (const fn of listeners) fn(summary(app));
  };

  const summary = (app) => ({
    id: app.id,
    repo: app.url,
    ref: app.ref ?? null,
    app_dir: app.appDir ?? null,
    status: app.status,
    mode: app.mode,
    phase: app.phase ?? null,
    error: app.error ?? null,
    url: app.status === 'ready' ? `http://127.0.0.1:${app.ports.app}/` : null,
    collector: `http://127.0.0.1:${app.ports.collector}`,
    build: app.build ?? 0,
    build_ms: app.buildMs ?? null,
    built_at: app.builtAt ?? null,
    candidates: app.candidates ?? [],
    package: packageDir,
    package_commit: app.packageCommit ?? null,
  });

  const get = (id) => {
    const app = apps.get(id);
    if (!app)
      throw Object.assign(new Error(`no app "${id}"; call list or add first`), { status: 404 });
    return app;
  };
  // Which package went into a build: its git commit, marked dirty when it has local edits.
  const packageCommit = () => {
    try {
      const sha = execFileSync('git', ['-C', packageDir, 'rev-parse', '--short', 'HEAD'], {
        encoding: 'utf8',
      }).trim();
      const dirty = execFileSync('git', ['-C', packageDir, 'status', '--porcelain', '--', '.'], {
        encoding: 'utf8',
      }).trim();
      return dirty ? `${sha}+edits` : sha;
    } catch {
      return null;
    }
  };
  const storeDir = (app) => path.join(app.work, 'store', `build-${app.build}`);
  const logTail = (app, lines = 40) => {
    try {
      return fs
        .readFileSync(path.join(app.work, 'build.log'), 'utf8')
        .split('\n')
        .slice(-lines)
        .join('\n');
    } catch {
      return '';
    }
  };

  async function stop(id) {
    const running = live.get(id);
    if (!running) return;
    live.delete(id);
    await running.browser?.reset();
    await running.tools?.close();
    running.server?.close();
    running.collector?.kill('SIGTERM');
  }

  // Callers race to start an app (a build finishing, the page's live feed); one start runs.
  const starting = new Map();
  function start(app) {
    if (live.has(app.id)) return Promise.resolve(live.get(app.id));
    if (!starting.has(app.id))
      starting.set(
        app.id,
        launch(app).finally(() => starting.delete(app.id)),
      );
    return starting.get(app.id);
  }

  /** Serve the app (dev server or built files) and start its collector. */
  async function launch(app) {
    const store = storeDir(app);
    fs.mkdirSync(store, { recursive: true });
    const appRoot = path.join(app.work, 'src', app.appDir);
    const manifest = path.join(
      appRoot,
      'node_modules',
      '.producttrace',
      'runtime-attribution-manifest.json',
    );
    const collector = spawn(
      process.execPath,
      [
        packageBin(packageDir, 'producttrace-collector'),
        '--store',
        store,
        '--port',
        String(app.ports.collector),
        '--source-root',
        appRoot,
        // The collector reads the manifest once, at start. Under the dev server it is
        // written as modules load, so a fresh dev app starts without one.
        ...(fs.existsSync(manifest) ? ['--manifest', manifest] : []),
        '--label',
        `circuit-${app.id}-build-${app.build}`,
      ],
      {
        stdio: [
          'ignore',
          fs.openSync(path.join(app.work, 'collector.log'), 'a'),
          fs.openSync(path.join(app.work, 'collector.log'), 'a'),
        ],
      },
    );
    const server =
      app.mode === 'build'
        ? await serveStatic(path.join(app.work, 'dist'), app.ports.app)
        : await serveDev(app.serve, app.ports.app, path.join(app.work, 'build.log'));
    if (!(await waitForHttp(`http://127.0.0.1:${app.ports.collector}/`, 15000)))
      throw new Error('collector did not start; see collector.log');
    const running = {
      server,
      collector,
      browser: new BrowserSession(`http://127.0.0.1:${app.ports.app}/`, {
        // The package's own traffic to its collector is not app traffic.
        ignoreOrigins: [`http://127.0.0.1:${app.ports.collector}`],
      }),
      seenLines: new Map(),
      tools: new TracerTools({
        mcpBin: packageBin(packageDir, 'producttrace-mcp'),
        storeDir: store,
        sourceRoot: appRoot,
      }),
    };
    live.set(app.id, running);
    return running;
  }

  async function runBuild(app, { rebuild }) {
    // Status flips before the first await so callers see "building" at once.
    app.status = 'building';
    app.error = null;
    app.build = (app.build ?? 0) + 1;
    await stop(app.id);
    app.packageCommit = packageCommit();
    emit(app);
    try {
      await buildTarget(app, { packageDir, rebuild, log: () => emit(app) });
      app.status = 'ready';
      app.phase = null;
      emit(app);
      await start(app);
    } catch (error) {
      app.status = 'failed';
      app.error = String(error.message).slice(0, 1000);
      emit(app);
    }
  }

  /**
   * Keeps one scorecard per build for each distinct list of steps, so the same
   * session run on build after build lines up side by side (oldest first).
   */
  function recordScore(app, steps, scorecard) {
    if (!steps.length) return [];
    const signature = crypto
      .createHash('sha1')
      .update(JSON.stringify(steps.map((s) => [s.action, s.target, s.value])))
      .digest('hex')
      .slice(0, 12);
    const file = path.join(app.work, 'scores.json');
    let rows = [];
    try {
      rows = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {}
    rows = rows.filter((row) => !(row.signature === signature && row.build === app.build));
    rows.push({
      signature,
      build: app.build,
      built_at: app.builtAt,
      package: app.packageCommit ?? null,
      at: new Date().toISOString(),
      scorecard,
    });
    fs.writeFileSync(file, JSON.stringify(rows, null, 2));
    return rows.filter((row) => row.signature === signature).sort((a, b) => a.build - b.build);
  }

  /** Reads the story and remembers every line by id (newest version wins). */
  async function remember(app, running) {
    const story = await readStory({
      collectorUrl: `http://127.0.0.1:${app.ports.collector}`,
    });
    for (const line of story.lines) running.seenLines.set(line.id, line);
    return story;
  }

  const ready = async (id) => {
    const app = get(id);
    if (app.status !== 'ready')
      throw Object.assign(
        new Error(
          `app "${id}" is ${app.status}${app.phase ? ` (${app.phase})` : ''}; wait with status`,
        ),
        { status: 409 },
      );
    return { app, running: await start(app) };
  };

  return {
    packageDir,

    list: () => [...apps.values()].map(summary),

    /** Clone, install and build a repo with the package attached. Returns at once; the build runs in the background. */
    async add({ repo, ref, app_dir: appDir, env, plugin_options: pluginOptions, mode } = {}) {
      if (mode !== undefined && !['dev', 'build'].includes(mode))
        throw Object.assign(new Error('mode is "dev" or "build"'), { status: 400 });
      const parsed = parseRepo(repo);
      const id = `${parsed.name.toLowerCase().replace(/[^a-z0-9]+/gu, '-')}-${crypto
        .createHash('sha1')
        .update(`${parsed.url}#${ref ?? parsed.ref ?? ''}#${appDir ?? parsed.appDir ?? ''}`)
        .digest('hex')
        .slice(0, 6)}`;
      if (apps.has(id)) {
        const existing = apps.get(id);
        if (existing.status === 'failed') {
          Object.assign(existing, {
            env: env ?? existing.env,
            pluginOptions: pluginOptions ?? existing.pluginOptions,
            mode: mode ?? existing.mode,
          });
          runBuild(existing, { rebuild: false });
        }
        return summary(existing);
      }
      const used = new Set([...apps.values()].map((a) => a.ports.app));
      let port = basePort;
      while (used.has(port)) port += 10;
      const app = {
        id,
        url: parsed.url,
        local: Boolean(parsed.local),
        ref: ref ?? parsed.ref,
        appDir: appDir ?? parsed.appDir,
        env,
        pluginOptions,
        mode: mode ?? 'dev',
        work: path.join(workRoot, id),
        ports: { app: port, collector: port + 1 },
        status: 'queued',
        build: 0,
      };
      apps.set(id, app);
      runBuild(app, { rebuild: false });
      return summary(app);
    },

    /** Rebuild with the current package (after a change to it). Skips clone and install. */
    async rebuild(id, { mode } = {}) {
      const app = get(id);
      if (app.status === 'building') return summary(app);
      if (mode !== undefined && !['dev', 'build'].includes(mode))
        throw Object.assign(new Error('mode is "dev" or "build"'), { status: 400 });
      if (mode) app.mode = mode;
      runBuild(app, { rebuild: true });
      return summary(app);
    },

    async status(id, { waitSeconds = 0 } = {}) {
      const app = get(id);
      const deadline = Date.now() + Math.min(waitSeconds, MAX_WAIT_SECONDS) * 1000;
      while (['queued', 'building'].includes(app.status) && Date.now() < deadline)
        await new Promise((r) => setTimeout(r, 1000));
      if (app.status === 'ready') await start(app);
      return { ...summary(app), log_tail: app.status === 'ready' ? undefined : logTail(app) };
    },

    log: (id) => {
      const app = get(id);
      try {
        return fs.readFileSync(path.join(app.work, 'build.log'), 'utf8');
      } catch {
        return '';
      }
    },

    async act(id, step) {
      const { app, running } = await ready(id);
      const result = await running.browser.act(step);
      const snap = await running.browser.snapshot({ maxChars: 6000 });
      const story = await remember(app, running);
      const said = story.lines
        .filter((line) => line.at >= result.started_at - 150)
        .map((line) => line.text);
      return { step: result, package_said: said, page: snap };
    },

    async snapshot(id) {
      const { running } = await ready(id);
      return running.browser.snapshot();
    },
    async screenshot(id) {
      const { running } = await ready(id);
      return running.browser.screenshot();
    },

    /** Close the browser page (ends the page session) and forget the steps. */
    async reset(id) {
      const { running } = await ready(id);
      await running.browser.reset();
      running.seenLines.clear();
      return { ok: true };
    },

    async story(id, { session } = {}) {
      const { app, running } = await ready(id);
      return readStory({
        collectorUrl: `http://127.0.0.1:${app.ports.collector}`,
        session,
      });
    },

    async report(id) {
      const { app, running } = await ready(id);
      const latest = await remember(app, running);
      // Lines seen at earlier steps stay in the report even when a short feed no longer returns them.
      const story = { ...latest, lines: [...running.seenLines.values()] };
      const report = buildReport({
        steps: running.browser.steps,
        browserRequests: running.browser.requests,
        story,
      });
      const history = recordScore(app, running.browser.steps, report.scorecard);
      return {
        app: summary(app),
        ...report,
        history,
        page_errors: running.browser.errors.slice(-10),
      };
    },

    async tools(id) {
      const { running } = await ready(id);
      return running.tools.list();
    },
    async tool(id, name, args) {
      const { running } = await ready(id);
      return running.tools.call(name, args);
    },

    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    async close() {
      for (const id of [...live.keys()]) await stop(id);
      await closeBrowser();
    },
  };
}
