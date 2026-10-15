// G2 per-repository session: alan2207/bulletproof-react apps/react-vite.
// Frontend-only for Tracer: its API is the repository's own mock server
// (`mock-server.ts`: Express + @mswjs/http-middleware + @mswjs/data), started
// uninstrumented, the same way its e2e setup runs it. Harness code only.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { assertPortFree, stopChild } from './process-utils.mjs';

const APP_PORT = 4200;
const API_PORT = 4201;
const env = {
  VITE_APP_API_URL: `http://127.0.0.1:${API_PORT}/api`,
  VITE_APP_ENABLE_API_MOCKING: 'false',
  // src/config/env.ts strips the VITE_APP_ prefix and reads APP_MOCK_API_PORT,
  // so the mock server's port variable is VITE_APP_APP_MOCK_API_PORT.
  VITE_APP_APP_MOCK_API_PORT: String(API_PORT),
  VITE_APP_APP_URL: `http://127.0.0.1:${APP_PORT}`,
};

const waitForPort = async (url, timeoutMs) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { await fetch(url); return true; } catch {}
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  return false;
};

export default {
  name: 'bulletproof-react',
  app: 'apps/react-vite',
  appPort: APP_PORT,
  apiPrefixes: [],
  buildEnv: env,
  landing: '/',

  async startBackend({ repo, out, log }) {
    const app = path.join(repo, 'apps/react-vite');
    await assertPortFree(API_PORT);
    fs.rmSync(path.join(app, 'mocked-db.json'), { force: true }); // ignored by the repo; fresh mock DB
    const logFile = fs.openSync(path.join(out, 'backend.log'), 'w');
    const child = spawn(process.execPath, [path.join(app, 'node_modules/vite-node/vite-node.mjs'), 'mock-server.ts'], {
      cwd: app, env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: 'development', ...env }, stdio: ['ignore', logFile, logFile],
    });
    if (!(await waitForPort(`http://127.0.0.1:${API_PORT}/api/healthcheck`, 60000))) { child.kill('SIGKILL'); throw new Error('mock API did not start; see backend.log'); }
    log('bulletproof mock API up');
    return {
      origin: `http://127.0.0.1:${API_PORT}`,
      instrumented: false,
      frontier: 'backend not instrumented (repository mock API server; frontend-only repository)',
      async stop() { await stopChild(child); fs.closeSync(logFile); fs.rmSync(path.join(app, 'mocked-db.json'), { force: true }); },
    };
  },

  async run({ page, step }) {
    await step('get-started', 'click "Get started" on the landing page', async () => {
      await page.getByRole('button', { name: 'Get started' }).click();
      await page.waitForURL(/\/auth\/login/u, { timeout: 10000 });
    });
    await step('open-register', 'click the "Register" link', async () => {
      await page.getByRole('link', { name: 'Register' }).click();
      await page.waitForURL(/\/auth\/register/u, { timeout: 10000 });
    });
    await step('register', 'fill First/Last Name, Email, Password, Team Name and click Register', async () => {
      for (const [label, value] of [['First Name', 'Tracer'], ['Last Name', 'Gate'], ['Email Address', 'tracer-g2@example.test'], ['Password', 'tracer-g2-pass'], ['Team Name', 'Tracer Team']]) {
        const field = page.getByLabel(label); await field.click(); await field.pressSequentially(value, { delay: 10 });
      }
      await page.getByRole('button', { name: 'Register' }).click();
      await page.waitForURL(/\/app$/u, { timeout: 15000 });
    }, { settleMs: 1500 });
    await step('open-discussions', 'click the "Discussions" navigation link', async () => {
      await page.getByRole('link', { name: 'Discussions' }).click();
      await page.waitForURL(/\/app\/discussions/u, { timeout: 10000 });
    }, { settleMs: 1200 });
    await step('create-discussion', 'click "Create Discussion", type Title and Body, click Submit', async () => {
      await page.getByRole('button', { name: 'Create Discussion' }).click();
      const title = page.getByLabel('Title'); await title.click(); await title.pressSequentially('Tracer G2 discussion', { delay: 10 });
      const body = page.getByLabel('Body'); await body.click(); await body.pressSequentially('Created by a headless G2 session.', { delay: 5 });
      await page.getByRole('button', { name: 'Submit' }).click();
      await page.getByLabel('Discussion Created').waitFor({ state: 'visible', timeout: 10000 });
    }, { settleMs: 1200 });
    await step('view-discussion', 'click the discussion\'s "View" link', async () => {
      await page.getByRole('link', { name: 'View' }).first().click();
      await page.getByRole('heading', { name: 'Tracer G2 discussion' }).waitFor({ state: 'visible', timeout: 10000 });
    }, { settleMs: 1200 });
    await step('create-comment', 'click "Create Comment", type Body, click Submit', async () => {
      await page.getByRole('button', { name: 'Create Comment' }).click();
      const body = page.getByLabel('Body'); await body.click(); await body.pressSequentially('First comment from Tracer.', { delay: 5 });
      await page.getByRole('button', { name: 'Submit' }).click();
      await page.getByText('First comment from Tracer.').waitFor({ state: 'visible', timeout: 10000 });
    }, { settleMs: 1200 });
    await step('delete-comment', 'click "Delete Comment", then confirm "Delete Comment"', async () => {
      await page.getByRole('button', { name: 'Delete Comment' }).click();
      await page.getByText('Are you sure you want to delete this comment?').waitFor({ state: 'visible', timeout: 5000 });
      await page.getByRole('button', { name: 'Delete Comment' }).last().click();
      await page.getByRole('heading', { name: 'No Comments Found' }).waitFor({ state: 'visible', timeout: 10000 });
    }, { settleMs: 1200 });
    await step('dismiss-notifications', 'click Close on each visible notification toast', async () => {
      const closes = page.locator('[aria-live] button:has(span.sr-only:text-is("Close")), [role="alert"] button:has-text("Close")');
      for (let i = 0; i < 6 && await closes.count(); i += 1) await closes.first().click();
    }, { settleMs: 800 });
    await step('sign-out', 'open the user menu and click "Sign Out"', async () => {
      await page.getByRole('button', { name: 'Open user menu' }).click();
      await page.getByRole('menuitem', { name: 'Sign Out' }).click();
      await page.waitForURL(/\/auth\/login/u, { timeout: 10000 });
    }, { settleMs: 1500 });
  },
};
