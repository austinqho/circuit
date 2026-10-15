import { copyFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const targetDist = process.argv[2] ? path.resolve(process.argv[2]) : null;
const endpoint = process.argv[3] || 'http://127.0.0.1:8123/api/demo/events';

if (!targetDist) {
  throw new Error('usage: node test/browser/install-real-app.mjs <target-client-dist> [collector-endpoint]');
}

const indexPath = path.join(targetDist, 'index.html');
const runtimeName = 'producttrace-current-runtime.js';
const loaderName = 'producttrace-current-loader.js';
const runtimePath = path.join(targetDist, runtimeName);
const loaderPath = path.join(targetDist, loaderName);
const serviceWorkerPath = path.join(targetDist, 'sw.js');
const assetVersion = Date.now();

await copyFile(path.join(root, 'dist/producttrace-runtime.js'), runtimePath);
// The pinned demo was previously opened as a PWA. Replace its cache-first
// worker with a pass-through worker so each evaluation loads the installed
// runtime instead of an earlier cached build. This file is outside the npm
// package and only belongs to the local application fixture.
await writeFile(serviceWorkerPath, `
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
`, 'utf8');
await writeFile(loaderPath, `
ProductTrace.start({
  name: 'real-application-live-demo',
  identity: {},
  actions: [],
}, {
  endpoint: ${JSON.stringify(endpoint)},
  outputMode: 'operations',
  operationSettleMs: 250,
  workflowIdleMs: 30000,
});
document.documentElement.style.overscrollBehaviorX = 'none';
if (document.body) document.body.style.overscrollBehaviorX = 'none';
const tracerViewportStyle = document.createElement('style');
tracerViewportStyle.textContent = \`
  html, body, #root { min-width: 100%; min-height: 100%; }
  html { scrollbar-width: none; }
  html::-webkit-scrollbar { width: 0; height: 0; }
\`;
document.head.appendChild(tracerViewportStyle);
const syncTracerViewportBackground = () => {
  const root = document.getElementById('root');
  const candidates = [root, document.body].filter(Boolean).map((node) => getComputedStyle(node).backgroundColor);
  const background = candidates.find((value) => value && value !== 'rgba(0, 0, 0, 0)');
  if (background) document.documentElement.style.backgroundColor = background;
};
syncTracerViewportBackground();
new MutationObserver(syncTracerViewportBackground).observe(document.documentElement, { attributes: true, subtree: true, attributeFilter: ['class', 'style'] });
let tracerSwipeStart = null;
window.addEventListener('wheel', (event) => {
  if (Math.abs(event.deltaX) < 18 || Math.abs(event.deltaX) < Math.abs(event.deltaY)) return;
  event.preventDefault();
  window.parent.postMessage({ source: 'tracer-preview-carousel', direction: event.deltaX > 0 ? 'next' : 'previous' }, '*');
}, { passive: false });
window.addEventListener('pointerdown', (event) => {
  tracerSwipeStart = { x: event.clientX, y: event.clientY };
}, { passive: true });
window.addEventListener('pointerup', (event) => {
  if (!tracerSwipeStart) return;
  const deltaX = event.clientX - tracerSwipeStart.x;
  const deltaY = event.clientY - tracerSwipeStart.y;
  tracerSwipeStart = null;
  if (Math.abs(deltaX) > 55 && Math.abs(deltaX) > Math.abs(deltaY)) {
    window.parent.postMessage({ source: 'tracer-preview-carousel', direction: deltaX < 0 ? 'next' : 'previous' }, '*');
  }
}, { passive: true });
`, 'utf8');

const source = await readFile(indexPath, 'utf8');
const cleaned = source
  .replace(/<script\b[^>]*src="\/live-capture\.js(?:\?[^\"]*)?"[^>]*><\/script>/g, '')
  .replace(/<script\b[^>]*id="vite-plugin-pwa:register-sw"[^>]*><\/script>/g, '')
  .replace(/<script\b[^>]*src="\/producttrace-current-(?:runtime|loader)\.js(?:\?[^\"]*)?"[^>]*><\/script>/g, '');
const directEntry = `<script>if(location.pathname.endsWith('/index.html'))history.replaceState(null,'','/'+location.search)</script>`;
const includes = `${directEntry}<script src="/${runtimeName}?v=${assetVersion}"></script><script src="/${loaderName}?v=${assetVersion}"></script>`;
await writeFile(indexPath, cleaned.replace('</head>', `${includes}</head>`), 'utf8');

console.log(JSON.stringify({ targetDist, indexPath, runtimePath, loaderPath, serviceWorkerPath, endpoint }, null, 2));
