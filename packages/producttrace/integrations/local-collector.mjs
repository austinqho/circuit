/**
 * The collector a one-line install runs for itself.
 *
 * `producttrace()` with no `collector` option adds this plugin. When Vite
 * serves the app (`vite` or `vite preview`) it starts a store-mode collector on
 * a free loopback port and mounts it on the app's own origin under
 * `/__producttrace/`:
 *
 * - `/__producttrace/ingest`, `/spans`, `/story`, `/story/stream`, `/status`:
 *   the collector's routes, proxied (the page's sink posts to the first one);
 * - `/__producttrace/`: a live view of the story, one goal per row with its
 *   steps underneath.
 *
 * The store lives under `node_modules/.producttrace/store` next to Vite's own
 * cache, so the app's source tree is never written. `withProducttrace()` for
 * Next.js mounts the same collector behind rewrites (see next.mjs). The collector stops when
 * the server closes. No repository knowledge; no model.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCollector } from '../collector/index.js';

export const LOCAL_COLLECTOR_BASE = '/__producttrace';

const ROUTES = new Set(['/', '/ingest', '/spans', '/run-info', '/story', '/story/stream', '/status']);
const viewerFile = path.join(path.dirname(fileURLToPath(import.meta.url)), 'local-viewer.html');

/**
 * A store-mode collector on a free loopback port, started on first use, plus
 * the request handler that mounts it under `/__producttrace/`. Shared by the
 * Vite plugin (dev-server middleware) and the Next.js wrapper (its own
 * loopback server that the app's rewrites point at).
 */
export function localCollector({ storeDir, manifestFile, sourceRoot, label }) {
  let collector = null;
  let starting = null;
  const start = () => {
    if (!starting) {
      fs.mkdirSync(storeDir, { recursive: true });
      collector = createCollector({ port: 0, store: { dir: storeDir, manifestFile, sourceRoot, label } });
      starting = collector.ready.then(() => collector);
    }
    return starting;
  };
  const stop = async () => {
    const running = collector;
    collector = null;
    starting = null;
    if (running) await running.ready.then(() => running.close(), () => {});
  };
  // `request.url` is the app's own path (`/__producttrace/story`). Returns false for anything else under the prefix.
  const handle = (request, response) => {
    const url = request.url || '';
    if (url !== LOCAL_COLLECTOR_BASE && !url.startsWith(`${LOCAL_COLLECTOR_BASE}/`) && !url.startsWith(`${LOCAL_COLLECTOR_BASE}?`)) return false;
    const rest = url.slice(LOCAL_COLLECTOR_BASE.length) || '/';
    const route = rest.split('?')[0];
    // Only the collector's own routes: anything else under the prefix (the request bridge) is the app's.
    if (!ROUTES.has(route)) return false;
    // The story carries every session's pages, values and IDs: only this machine may read or write it,
    // even when the dev server listens on the network. A proxy in front (Next.js rewrites) names the
    // original client in x-forwarded-for.
    const forwarded = String(request.headers?.['x-forwarded-for'] || '').split(',').map((value) => value.trim()).filter(Boolean);
    if (!isLoopback(request.socket?.remoteAddress) || forwarded.some((address) => !isLoopback(address))) {
      response.statusCode = 403;
      response.end('producttrace: only this machine can reach /__producttrace');
      return true;
    }
    if (request.method === 'GET' && route === '/') {
      response.setHeader('content-type', 'text/html; charset=utf-8');
      response.setHeader('cache-control', 'no-store');
      response.end(fs.readFileSync(viewerFile, 'utf8'));
      return true;
    }
    start().then((running) => proxy(running.url, route === '/status' ? '/' : rest, request, response), (error) => {
      response.statusCode = 503;
      response.end(`producttrace collector did not start: ${error.message}`);
    });
    return true;
  };
  return { start, stop, handle };
}

export function localCollectorPlugin({ storeDir, manifestFile, sourceRoot }) {
  const local = localCollector({ storeDir, manifestFile, sourceRoot, label: 'vite' });
  const mount = (server) => {
    local.start();
    server.middlewares.use((request, response, next) => {
      if (!local.handle(request, response)) next();
    });
    server.httpServer?.once('close', local.stop);
    // Print where the narration is, under Vite's own URLs.
    const printUrls = server.printUrls?.bind(server);
    if (printUrls) {
      server.printUrls = () => {
        printUrls();
        const url = server.resolvedUrls?.local?.[0];
        if (url) server.config.logger.info(`  ➜  producttrace: ${new URL(`${LOCAL_COLLECTOR_BASE}/`, url).href}`);
      };
    }
  };

  return {
    name: 'producttrace-local-collector',
    configureServer: mount,
    configurePreviewServer: mount,
    async closeBundle() {
      // Dev servers close their plugin container; builds never started a collector.
      await local.stop();
    },
  };
}

function isLoopback(address) {
  return typeof address === 'string' && (address === '::1' || /^(?:::ffff:)?127\./u.test(address));
}

function proxy(target, pathname, request, response) {
  const upstream = http.request(`${target}${pathname}`, { method: request.method, headers: { ...request.headers, host: new URL(target).host } }, (reply) => {
    response.writeHead(reply.statusCode || 502, reply.headers);
    reply.pipe(response);
  });
  upstream.on('error', (error) => {
    if (!response.headersSent) response.statusCode = 502;
    response.end(String(error.message || error));
  });
  response.on('close', () => upstream.destroy());
  request.pipe(upstream);
}
