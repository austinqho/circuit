// Build a one-file Vite + React fixture with both Tracer plugins (headless tests).
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { productTraceVitePlugin } from '../../integrations/vite.mjs';
import { runtimeAttributionPlugin } from '../../integrations/runtime-attribution.mjs';

// `publicFiles` are copied verbatim (Vite public/: never transformed or
// instrumented); `bodyHtml` is inserted before the app's module script.
// `mode` is Vite's build mode (default 'production', as `vite build`).
// `instrument: false` builds the same app without Tracer (a parity baseline).
// `resolve` is passed to Vite as-is (e.g. an alias to a library installed in
// the Tracer checkout rather than the dependency root, with React deduped).
export async function buildReactFixture({ dependencyRoot, appSource, name = 'fixture', pluginOptions = {}, minify = false, extraFiles = {}, publicFiles = {}, bodyHtml = '', mode = undefined, instrument = true, resolve = undefined }) {
  const nodeModules = path.join(dependencyRoot, 'node_modules');
  const repository = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `producttrace-${name}-`)));
  const clientRoot = path.join(repository, 'client');
  fs.mkdirSync(path.join(clientRoot, 'src'), { recursive: true });
  fs.writeFileSync(path.join(repository, 'package.json'), JSON.stringify({ name, private: true, type: 'module' }));
  fs.symlinkSync(nodeModules, path.join(repository, 'node_modules'));
  fs.writeFileSync(path.join(clientRoot, 'src/main.jsx'), appSource);
  for (const [file, content] of Object.entries(extraFiles)) { fs.mkdirSync(path.dirname(path.join(clientRoot, 'src', file)), { recursive: true }); fs.writeFileSync(path.join(clientRoot, 'src', file), content); }
  for (const [file, content] of Object.entries(publicFiles)) { fs.mkdirSync(path.dirname(path.join(clientRoot, 'public', file)), { recursive: true }); fs.writeFileSync(path.join(clientRoot, 'public', file), content); }
  fs.writeFileSync(path.join(clientRoot, 'index.html'), `<!doctype html><html><head><meta charset="utf-8"><title>${name}</title></head><body><div id="root"></div>${bodyHtml}<script type="module" src="/src/main.jsx"></script></body></html>`);
  const { build } = await import(pathToFileURL(path.join(nodeModules, 'vite/dist/node/index.js')).href);
  const react = (await import(pathToFileURL(path.join(nodeModules, '@vitejs/plugin-react/dist/index.js')).href)).default;
  const manifestPath = path.join(repository, 'attribution-manifest.json');
  await build({
    root: clientRoot, logLevel: 'warn', configFile: false, ...(mode ? { mode } : {}), ...(resolve ? { resolve } : {}),
    plugins: instrument ? [
      productTraceVitePlugin({ repository, service: name, requestBridge: false, ...pluginOptions }),
      runtimeAttributionPlugin({ repository, manifestPath }),
      react(),
    ] : [react()],
    build: { outDir: path.join(clientRoot, 'dist'), emptyOutDir: true, sourcemap: true, minify,
      rollupOptions: { output: { manualChunks: id => (id.includes('node_modules') ? 'vendor' : undefined) } } },
  });
  return { repository, distRoot: path.join(clientRoot, 'dist'), manifest: instrument ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : null,
    cleanup: () => fs.rmSync(repository, { recursive: true, force: true }) };
}

// `streams` maps "METHOD /path" to { chunks, intervalMs }: a text/plain body
// written in timed chunks (a streamed response).
export async function serveFixture(distRoot, routes = {}, streams = {}) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://fixture');
    const stream = streams[`${req.method} ${url.pathname}`];
    if (stream) {
      res.writeHead(200, { 'content-type': 'text/plain' }); res.flushHeaders(); let sent = 0;
      const timer = setInterval(() => { res.write(`chunk ${sent}\n`); sent += 1; if (sent >= stream.chunks) { clearInterval(timer); res.end(); } }, stream.intervalMs);
      return;
    }
    const handler = routes[`${req.method} ${url.pathname}`];
    if (handler) { req.resume(); req.on('end', () => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(handler())); }); return; }
    const relative = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const file = path.resolve(distRoot, relative);
    if (!file.startsWith(`${distRoot}${path.sep}`) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': file.endsWith('.js') ? 'text/javascript' : file.endsWith('.html') ? 'text/html' : 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { origin: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => server.close(resolve)) };
}
