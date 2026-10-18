#!/usr/bin/env node
// A real person uses an app with the listen-mode script on it; afterwards they
// say in their own words what they did, and that is saved next to what the
// script recorded, so the two can be compared.
//
//   node apps/web/scripts/listen-session.mjs --repo alan2207/bulletproof-react
//   node apps/web/scripts/listen-session.mjs --url http://localhost:5173/
//
// --repo runs the app on the bench (its own dev server, without the package);
// --url uses an app you already have running. A browser window opens: use the
// app as you like, then come back to the terminal and press Enter. Saves
// session.json and session.txt under --out (default ./listen-sessions/<time>).
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import net from 'node:net';

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

const ask = terminalQuestions();
await ask(
  `\nA browser window is open on ${url}.\nUse the app however you like. When you are done, come back here and press Enter. `,
);

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
const batches = await sink.collect();
await session.reset();
const description = await ask('\nIn 2-3 sentences, what did you do? ');

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

await sink.close();
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

/**
 * Questions on the terminal. Lines typed (or piped) ahead of a question are
 * kept for it, and an ended input answers ''.
 */
function terminalQuestions() {
  const lines = [];
  const waiting = [];
  let ended = false;
  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', (line) => (waiting.length ? waiting.shift()(line) : lines.push(line)));
  rl.on('close', () => {
    ended = true;
    while (waiting.length) waiting.shift()('');
  });
  return (prompt) => {
    process.stdout.write(prompt);
    if (lines.length) return Promise.resolve(lines.shift());
    if (ended) return Promise.resolve('');
    return new Promise((resolve) => waiting.push(resolve));
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
