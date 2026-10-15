// G2 per-repository session: Mintplex-Labs/anything-llm (frontend/ Vite +
// React, server/ Express + Prisma/SQLite). Harness code: it may know this
// repository's UI and backend; nothing here is part of the package.
//
// No LLM key is configured, so no chat is sent. Only non-LLM flows are driven.
import { spawn, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { assertPortFree, stopChild } from './process-utils.mjs';

const waitFor = async (url, timeoutMs) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { const response = await fetch(url); if (response.ok) return true; } catch {}
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  return false;
};

export default {
  name: 'anything-llm',
  app: 'frontend',
  // The frontend calls same-origin /api; the harness proxies it to the server.
  apiPrefixes: ['/api'],
  buildEnv: { VITE_API_BASE: '/api' },
  landing: '/',
  databaseFrontier: 'database client not instrumented (Prisma/SQLite has no Tracer adapter)',

  async startBackend({ repo, tracerRoot, spanEndpoint, backendRegister, port, log, out }) {
    const server = path.join(repo, 'server');
    await assertPortFree(port);
    // Fresh, git-ignored SQLite database for every run (server/storage/*.db).
    for (const file of ['anythingllm.db', 'anythingllm.db-journal']) fs.rmSync(path.join(server, 'storage', file), { force: true });
    execFileSync(process.execPath, [path.join(server, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy'], { cwd: server, stdio: 'ignore' });
    const secret = bytes => crypto.randomBytes(bytes).toString('hex'); // never printed
    const logFile = fs.openSync(path.join(out, 'backend.log'), 'w');
    const child = spawn(process.execPath, [
      '--require', path.join(tracerRoot, 'test/browser/sessions/node-compat-slowbuffer.cjs'),
      '--import', backendRegister, // producttrace/backend/register (ESM loader hook + telemetry)
      'index.js',
    ], {
      cwd: server,
      env: {
        PATH: process.env.PATH, HOME: process.env.HOME,
        NODE_ENV: 'development', SERVER_PORT: String(port),
        JWT_SECRET: secret(24), SIG_KEY: secret(24), SIG_SALT: secret(24),
        VECTOR_DB: 'lancedb', DISABLE_TELEMETRY: 'true',
        PRODUCTTRACE_BACKEND_SPAN_ENDPOINT: spanEndpoint,
        PRODUCTTRACE_BACKEND_ADAPTERS: 'http,express',
        PRODUCTTRACE_SERVICE_NAME: 'anything-llm-server',
      },
      stdio: ['ignore', logFile, logFile],
    });
    const origin = `http://127.0.0.1:${port}`;
    if (!(await waitFor(`${origin}/api/ping`, 60000))) { child.kill('SIGKILL'); throw new Error('anything-llm server did not start; see backend.log'); }
    log('anything-llm server up');
    return {
      origin,
      adapters: ['http', 'express'],
      async flush() { await new Promise(resolve => setTimeout(resolve, 500)); },
      async stop() { await stopChild(child); fs.closeSync(logFile); },
    };
  },

  // Eight user actions, trusted input only (Playwright real mouse/keyboard),
  // none of which needs an LLM provider.
  async run({ page, step }) {
    let promptAnswer = null;
    page.on('dialog', dialog => { dialog.type() === 'prompt' ? dialog.accept(promptAnswer ?? '') : dialog.accept(); });
    await page.locator('button[data-tooltip-id="new-workspace-tooltip"]').first().waitFor({ state: 'visible', timeout: 20000 });

    await step('open-new-workspace', 'click the sidebar "+" (New Workspace) button', async () => {
      await page.locator('button[data-tooltip-id="new-workspace-tooltip"]').first().click();
      await page.locator('form input#name').waitFor({ state: 'visible', timeout: 5000 });
    });
    await step('create-workspace', 'type "Tracer G2" into the workspace name field and click Save', async () => {
      const name = page.locator('form input#name');
      await name.click(); await name.pressSequentially('Tracer G2', { delay: 20 });
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await page.waitForURL(/\/workspace\//u, { timeout: 10000 });
    }, { settleMs: 1500 });
    await step('new-thread', 'click "New Thread" under the workspace', async () => {
      await page.getByRole('button', { name: /New Thread/u }).first().click();
      await page.waitForURL(/\/t\//u, { timeout: 10000 });
    }, { settleMs: 1500 });
    await step('rename-thread', 'open the thread options menu, click Rename, answer the prompt "Renamed by Tracer"', async () => {
      const options = page.locator('button[aria-label="Thread options"]').last();
      await options.hover({ force: true }); await options.click({ force: true });
      promptAnswer = 'Renamed by Tracer';
      await page.getByRole('button', { name: 'Rename', exact: true }).click();
    }, { settleMs: 1500 });
    await step('delete-thread', 'open the thread options menu, click Delete Thread, confirm', async () => {
      const options = page.locator('button[aria-label="Thread options"]').last();
      await options.hover({ force: true }); await options.click({ force: true });
      await page.getByRole('button', { name: 'Delete Thread', exact: true }).click();
    }, { settleMs: 1500 });
    await step('open-workspace-settings', 'click the workspace gear (General appearance settings)', async () => {
      await page.locator('button[aria-label="General appearance settings"]').first().click();
      await page.waitForURL(/\/settings\//u, { timeout: 10000 });
      await page.locator('form input[name="name"]').waitFor({ state: 'visible', timeout: 10000 });
    }, { settleMs: 1500 });
    await step('rename-workspace', 'append " renamed" to the workspace name and click Update Workspace', async () => {
      const name = page.locator('form input[name="name"]');
      await name.click(); await page.keyboard.press('End'); await name.pressSequentially(' renamed', { delay: 20 });
      await page.getByRole('button', { name: 'Update Workspace' }).click();
    }, { settleMs: 1500 });
    await step('delete-workspace', 'click Delete Workspace and confirm', async () => {
      await page.getByRole('button', { name: /Delete Workspace/iu }).click();
      await page.waitForURL(url => !/\/workspace\//u.test(url.pathname), { timeout: 10000 });
    }, { settleMs: 2500 });
  },
};
