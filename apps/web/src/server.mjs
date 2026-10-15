#!/usr/bin/env node
// circuit-web: the website and its HTTP API. One command: `npm start` (port 4500).
//
// API (JSON in, JSON out):
//   GET  /api/apps                         every app on the bench
//   POST /api/apps {repo, ref?, app_dir?, env?, plugin_options?}   add an open-source repo (builds in background)
//   GET  /api/apps/:id?wait=<seconds>      status; waits while it builds
//   GET  /api/apps/:id/log                 full build log (text)
//   POST /api/apps/:id/rebuild             rebuild with the current package
//   POST /api/apps/:id/act {action, target?, value?}   drive the headless browser
//   GET  /api/apps/:id/snapshot            URL, title and accessibility tree of the page
//   GET  /api/apps/:id/screenshot          PNG
//   POST /api/apps/:id/reset               end the browser's page session
//   GET  /api/apps/:id/story               the package's session story
//   GET  /api/apps/:id/report              steps vs what the package said, plus a scorecard
//   GET  /api/apps/:id/tools               the package's MCP tools
//   POST /api/apps/:id/tools/:name {args}  call one
//   GET  /api/events                       server-sent events: app status changes
//   GET  /api/apps/:id/stream              server-sent events: story updates
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBench } from './bench.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || process.argv[2] || 4500);
const bench = createBench();

const readJson = (req) =>
  new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1e6) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(Object.assign(new Error('body is not JSON'), { status: 400 }));
      }
    });
  });
const send = (res, status, value) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(value, null, 2));
};

function sse(req, res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-store',
    connection: 'keep-alive',
  });
  const keepAlive = setInterval(() => res.write(': ping\n\n'), 15000);
  const cleanups = [() => clearInterval(keepAlive)];
  req.on('close', () => cleanups.forEach((fn) => fn()));
  return {
    write: (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
    onClose: (fn) => cleanups.push(fn),
  };
}

// The bench clones and builds whatever repo it is given, and a build runs that
// repo's code. So only this machine's own page and local tools may drive it:
// no CORS, no other origins or sites, a loopback Host (blocks DNS rebinding),
// and JSON bodies only (a cross-site form can't send that without a preflight).
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);
const hostOk = (host) => {
  try {
    const url = new URL(`http://${host}`);
    return LOOPBACK.has(url.hostname) && Number(url.port || 80) === port;
  } catch {
    return false;
  }
};
function refusal(req) {
  if (!hostOk(req.headers.host || '')) return 'host is not this machine';
  const origin = req.headers.origin;
  if (origin !== undefined && !(origin.startsWith('http://') && hostOk(origin.slice(7))))
    return 'requests from other sites are refused';
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none')
    return 'requests from other sites are refused';
  if (req.method !== 'GET' && !/^application\/json\b/u.test(req.headers['content-type'] || ''))
    return 'send JSON with content-type: application/json';
  return null;
}

const routes = [
  ['GET', /^\/api\/apps$/u, async () => bench.list()],
  ['POST', /^\/api\/apps$/u, async (req) => bench.add(await readJson(req))],
  [
    'GET',
    /^\/api\/apps\/([\w-]+)$/u,
    async (req, [id], url) =>
      bench.status(id, { waitSeconds: Number(url.searchParams.get('wait') || 0) }),
  ],
  ['POST', /^\/api\/apps\/([\w-]+)\/rebuild$/u, async (req, [id]) => bench.rebuild(id)],
  [
    'POST',
    /^\/api\/apps\/([\w-]+)\/act$/u,
    async (req, [id]) => bench.act(id, await readJson(req)),
  ],
  ['GET', /^\/api\/apps\/([\w-]+)\/snapshot$/u, async (req, [id]) => bench.snapshot(id)],
  ['POST', /^\/api\/apps\/([\w-]+)\/reset$/u, async (req, [id]) => bench.reset(id)],
  [
    'GET',
    /^\/api\/apps\/([\w-]+)\/story$/u,
    async (req, [id], url) => bench.story(id, { session: url.searchParams.get('session') }),
  ],
  ['GET', /^\/api\/apps\/([\w-]+)\/report$/u, async (req, [id]) => bench.report(id)],
  ['GET', /^\/api\/apps\/([\w-]+)\/tools$/u, async (req, [id]) => bench.tools(id)],
  [
    'POST',
    /^\/api\/apps\/([\w-]+)\/tools\/([\w-]+)$/u,
    async (req, [id, name]) => bench.tool(id, name, (await readJson(req)).args || {}),
  ],
];

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://local');
  try {
    const refused = refusal(req);
    if (refused) return send(res, 403, { error: refused });
    if (url.pathname === '/api/events') {
      const stream = sse(req, res);
      stream.write('apps', bench.list());
      stream.onClose(bench.onChange((app) => stream.write('app', app)));
      return;
    }
    let match = url.pathname.match(/^\/api\/apps\/([\w-]+)\/stream$/u);
    if (match) {
      const stream = sse(req, res);
      let last = '';
      const tick = async () => {
        try {
          const story = await bench.story(match[1]);
          const json = JSON.stringify(story);
          if (json !== last) {
            last = json;
            stream.write('story', story);
          }
        } catch (error) {
          stream.write('wait', { message: error.message });
        }
      };
      const timer = setInterval(tick, 1000);
      tick();
      stream.onClose(() => clearInterval(timer));
      return;
    }
    match = url.pathname.match(/^\/api\/apps\/([\w-]+)\/screenshot$/u);
    if (match) {
      const png = await bench.screenshot(match[1]);
      res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' });
      return res.end(png);
    }
    match = url.pathname.match(/^\/api\/apps\/([\w-]+)\/log$/u);
    if (match) {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end(bench.log(match[1]));
    }
    for (const [method, pattern, handler] of routes) {
      const m = req.method === method && url.pathname.match(pattern);
      if (m) return send(res, 200, await handler(req, m.slice(1), url));
    }
    const asset = url.pathname.match(/^\/assets\/([\w.-]+)$/u);
    if (asset) {
      const file = path.join(here, '..', 'public', 'assets', asset[1]);
      if (!fs.existsSync(file)) return send(res, 404, { error: 'no such asset' });
      res.writeHead(200, {
        'content-type': file.endsWith('.woff2') ? 'font/woff2' : 'application/octet-stream',
        'cache-control': 'max-age=86400',
      });
      return res.end(fs.readFileSync(file));
    }
    if (req.method === 'GET' && !url.pathname.startsWith('/api/')) {
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      });
      return res.end(fs.readFileSync(path.join(here, '..', 'public', 'index.html')));
    }
    send(res, 404, { error: `no route ${req.method} ${url.pathname}` });
  } catch (error) {
    send(res, error.status || 500, { error: error.message });
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`circuit-web: http://127.0.0.1:${port}/`);
  console.log(`  package under test: ${bench.packageDir}`);
  // First start: put an example app on the bench so the page has something to show.
  const example = process.env.CIRCUIT_DEFAULT_REPO ?? 'alan2207/bulletproof-react';
  if (example && !bench.list().length) {
    bench.add({ repo: example }).then(
      (app) =>
        console.log(`  building ${app.id} (first build takes a few minutes; watch it on the page)`),
      (error) => console.error(`  could not add ${example}: ${error.message}`),
    );
  }
});
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, async () => {
    server.close();
    await bench.close();
    process.exit(0);
  });
