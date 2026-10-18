#!/usr/bin/env node
// A real person uses an app with the listen-mode script on it; afterwards they
// say in their own words what they did, and that is saved next to what the
// script recorded, so the two can be compared.
//
//   node apps/web/scripts/listen-session.mjs --repo alan2207/bulletproof-react
//   node apps/web/scripts/listen-session.mjs --url http://localhost:5173/
//
// --repo runs the app on the bench (its own dev server, without the package);
// --url uses an app you already have running. A browser window opens with the
// app in one tab and a short guide in another: use the app as you like, then
// press "I'm done" in the guide and write what you did. No terminal input is
// needed, so a remote session can start it. Saves session.json and
// session.txt under --out (default ./listen-sessions/<time>).
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import net from 'node:net';

// The guide tab: what to do, an "I'm done" button and the question.
const GUIDE_HTML = `<!doctype html>
<meta charset="utf-8">
<title>When you're done, come back here</title>
<style>
  body { font: 16px/1.5 system-ui, sans-serif; max-width: 34rem; margin: 3rem auto; padding: 0 1rem; color: #222; }
  textarea { width: 100%; min-height: 8rem; font: inherit; padding: .5rem; }
  button { font: inherit; padding: .5rem 1rem; }
  .hidden { display: none; }
</style>
<h1>Use the app in the other tab</h1>
<p>Do whatever you like there, the way you normally would. Nothing you do is graded.</p>
<p>When you're finished, come back to this tab.</p>
<button id="done">I'm done</button>
<form id="ask" class="hidden">
  <p><label for="what"><strong>In 2 or 3 sentences, what did you do?</strong></label></p>
  <textarea id="what" required></textarea>
  <p><button type="submit">Send</button></p>
</form>
<p id="thanks" class="hidden">Thanks, that's saved. You can close this window.</p>
<script>
  const show = (id) => document.getElementById(id).classList.remove('hidden');
  document.getElementById('done').onclick = (e) => { e.target.disabled = true; show('ask'); document.getElementById('what').focus(); };
  document.getElementById('ask').onsubmit = async (e) => {
    e.preventDefault();
    await fetch('/done', { method: 'POST', body: JSON.stringify({ description: document.getElementById('what').value }) });
    e.target.classList.add('hidden');
    show('thanks');
  };
</script>`;

process.env.CIRCUIT_HEADED ??= '1';
const { BrowserSession, closeBrowser } = await import('../src/browser.mjs');
const { listenSink, readFootprint, summarizeListened } = await import('../src/verify.mjs');

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (name, fallback = null) =>
  process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback;
const repo = arg('--repo');
let url = arg('--url');
if (!repo && !url) {
  console.error(
    'give --repo owner/name (runs it on the bench) or --url http://... (an app you run)',
  );
  process.exit(2);
}
const out = path.resolve(
  arg('--out', path.join('listen-sessions', new Date().toISOString().replace(/[:.]/gu, '-'))),
);

let stopBench = async () => {};
let id = null;
if (repo) {
  // A bench server of its own, on a free port and in its own folder, stopped
  // at the end: never an older site already running on :4500, never its apps.
  const port = await freePort();
  const bench = spawn(
    process.execPath,
    [path.join(here, '..', 'src', 'server.mjs'), String(port)],
    {
      env: {
        ...process.env,
        CIRCUIT_WORK: process.env.CIRCUIT_WORK || path.join(here, '..', '.work', 'listen'),
        CIRCUIT_APP_PORT: process.env.CIRCUIT_APP_PORT || '4800',
      },
      stdio: 'ignore',
    },
  );
  const base = `http://127.0.0.1:${port}`;
  const api = async (method, route, body) => {
    const res = await fetch(`${base}${route}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || res.statusText);
    return json;
  };
  stopBench = async () => {
    await api('POST', `/api/apps/${id}/plain`, { stop: true }).catch(() => {});
    bench.kill('SIGTERM');
  };
  for (let i = 0; i < 100; i += 1) {
    try {
      await fetch(`${base}/api/apps`);
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  ({ id } = await api('POST', '/api/apps', {
    repo,
    ...(arg('--app-dir') ? { app_dir: arg('--app-dir') } : {}),
  }));
  let status = await api('GET', `/api/apps/${id}?wait=50`);
  while (['queued', 'building', 'starting'].includes(status.status)) {
    console.error(`${id}: ${status.status}${status.phase ? ` (${status.phase})` : ''}`);
    status = await api('GET', `/api/apps/${id}?wait=50`);
  }
  if (status.status !== 'ready') {
    await stopBench();
    throw new Error(`app is ${status.status}: ${status.error}\n${status.log_tail ?? ''}`);
  }
  ({ url } = await api('POST', `/api/apps/${id}/plain`, {}));
}

const sink = await listenSink();
const session = new BrowserSession(url, { ignoreOrigins: [sink.origin], intercept: false });
const page = await session.ensure();
await session.context.addInitScript({ content: sink.script });
const started = new Date();
await page.goto(url);

const guide = await guidePage();
const guideTab = await session.context.newPage();
await guideTab.goto(guide.url);
await page.bringToFront();
console.log(`Session open: the app is in one tab, the guide (${guide.url}) in the other.`);
// Done when the person sends the guide's form, or closes the browser.
const description = await Promise.race([
  guide.done,
  new Promise((resolve) => session.context.on('close', () => resolve(''))),
]);

// What the page can see of circuit: compared with the same page opened without it.
const watched = await readFootprint(page);
const control = new BrowserSession(url, { intercept: false });
const controlPage = await control.ensure();
await controlPage.goto(page.url()).catch(() => {});
await controlPage.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
const plainPage = await readFootprint(controlPage);
await control.reset();
const plainGlobals = new Set(plainPage.globals);
const footprint = {
  globals_added: watched.globals.filter((name) => !plainGlobals.has(name)),
  replaced_browser_apis: watched.replaced.filter((name) => !plainPage.replaced.includes(name)),
  attributes: watched.attributes,
};

await page.goto('about:blank').catch(() => {}); // sends the last batch
// Only the app's own pages: the guide tab shares the browser but isn't the app.
const appOrigin = new URL(url).origin;
const batches = (await sink.collect()).filter((batch) => batch.origin === appOrigin);
await session.reset();

const rows = batches.flatMap((batch) => batch.rows.map((row) => ({ page: batch.page, ...row })));
const summary = summarizeListened(batches);
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(
  path.join(out, 'session.json'),
  JSON.stringify(
    { url, repo, started, ended: new Date(), description, summary, footprint, batches },
    null,
    2,
  ),
);
fs.writeFileSync(
  path.join(out, 'session.txt'),
  timeline({ description, summary, footprint, rows }),
);
console.log(
  `\n${summary.actions} actions and ${summary.requests} requests recorded; circuit measured its own cost at ${summary.cost_ms} ms.`,
);
console.log(
  `Left on the page: ${[...footprint.globals_added, ...footprint.replaced_browser_apis, ...Object.keys(footprint.attributes)].join(', ') || 'nothing'}.`,
);
console.log(`Saved ${path.join(out, 'session.txt')} and session.json`);

await guideTab.close().catch(() => {});
await sink.close();
guide.close();
await stopBench();
await closeBrowser();

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

/** The guide tab: what to do, an "I'm done" button and the question, served on this machine. */
async function guidePage() {
  let finish;
  const done = new Promise((resolve) => (finish = resolve));
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/done') {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        let text = '';
        try {
          text = String(JSON.parse(body).description ?? '').slice(0, 4000);
        } catch {}
        res.writeHead(204);
        res.end();
        finish(text);
      });
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(GUIDE_HTML);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}/`,
    done,
    close: () => server.close(),
  };
}

/** The recorded rows as one readable line each, under the person's own account. */
function timeline({ description, summary, footprint, rows }) {
  const quote = (text) => (text ? `"${text}"` : 'an unlabeled element');
  const line = (row) => {
    const where = row.target
      ? `${quote(row.target.name)} ${row.target.role || row.target.tag}`
      : '';
    const handler = row.handler
      ? `  [${row.handler.prop} ${row.handler.name || row.handler.fingerprint}${row.handler.components?.[0] ? ` in ${row.handler.components.find(Boolean)}` : ''}]`
      : '';
    switch (row.kind) {
      case 'action':
        if (row.type === 'input')
          return `Typed ${row.sensitive ? 'a password' : row.value != null ? `"${row.value}"` : `${row.length} characters`} into ${where}${handler}`;
        if (row.type === 'submit') return `Submitted the form with ${where}${handler}`;
        if (row.type === 'keydown') return `Pressed ${row.key} on ${where}`;
        if (row.type === 'drag')
          return `Dragged on ${where} from ${row.from} to ${row.to}${handler}`;
        if (row.type === 'change')
          return `Changed ${where}${row.checked != null ? ` to ${row.checked ? 'on' : 'off'}` : ''}${handler}`;
        return `Clicked ${where}${handler}`;
      case 'request':
        return `    request ${row.url} ${row.status ?? ''}${row.server_id ? ` (server id ${row.server_id})` : ''}`;
      case 'navigate':
        return `Went to ${row.to}`;
      case 'load':
        return `Opened ${row.path}`;
      default:
        return null;
    }
  };
  return [
    `In their words: ${description || '(no answer)'}`,
    '',
    'What circuit recorded:',
    ...rows.map(line).filter(Boolean),
    '',
    `${summary.actions} actions (${summary.with_handler} with a React handler), ${summary.requests} requests (${summary.started_during_action} started during an action, ${summary.with_server_id} with a server id).`,
    `circuit's own cost: ${summary.cost_ms} ms, ${summary.errors} errors, ${summary.bytes_sent} bytes sent.`,
    `Left on the page: ${[...footprint.globals_added, ...footprint.replaced_browser_apis, ...Object.keys(footprint.attributes)].join(', ') || 'nothing'}.`,
    '',
  ].join('\n');
}
