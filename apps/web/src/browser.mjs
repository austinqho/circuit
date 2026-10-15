// Headless Chromium driven for Claude. Every action is logged as a step with
// its time window, so what the package recorded can be lined up against what
// was actually done.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

let browserPromise = null;

function chromiumPath() {
  if (process.env.CIRCUIT_CHROMIUM) return process.env.CIRCUIT_CHROMIUM;
  // Preinstalled browsers (cloud containers); otherwise Playwright's own download.
  const preinstalled = '/opt/pw-browsers/chromium';
  return fs.existsSync(preinstalled) ? preinstalled : undefined;
}

async function browser() {
  if (!browserPromise) {
    browserPromise = import('playwright').then(async ({ chromium }) => {
      const launch = () =>
        chromium.launch({
          executablePath: chromiumPath(),
          headless: process.env.CIRCUIT_HEADED !== '1',
          args: ['--no-proxy-server'],
        });
      try {
        return await launch();
      } catch (error) {
        if (!/Executable doesn't exist|playwright install/u.test(error.message)) throw error;
        // First run on a new machine: fetch Playwright's Chromium once, then retry.
        const cli = path.join(
          path.dirname(createRequire(import.meta.url).resolve('playwright/package.json')),
          'cli.js',
        );
        execFileSync(process.execPath, [cli, 'install', 'chromium'], { stdio: 'inherit' });
        return launch();
      }
    });
    browserPromise.catch(() => {
      browserPromise = null;
    });
  }
  return browserPromise;
}

export async function closeBrowser() {
  if (browserPromise) {
    const b = await browserPromise.catch(() => null);
    browserPromise = null;
    await b?.close();
  }
}

/**
 * Target forms accepted everywhere:
 *   "Get started"                       visible text (exact match first, then substring)
 *   { role: "button", name: "Save" }    accessible role and name
 *   { label: "Email" } { placeholder: "Search" } { text: "..." } { testid: "x" }
 *   { selector: "css=... or any Playwright selector" }
 *   "role=button[name=/save/i]"          a raw Playwright selector string (contains = or starts with css/xpath)
 */
export function locate(page, target) {
  if (target == null) throw new Error('target is required');
  if (typeof target === 'string') {
    if (/^(css|xpath|text|role|id|data-testid|internal:)=|^[#.[]|^\/\//u.test(target))
      return page.locator(target).first();
    return page
      .getByText(target, { exact: true })
      .or(page.getByRole('button', { name: target }))
      .or(page.getByRole('link', { name: target }))
      .first();
  }
  const exact = target.exact ?? false;
  if (target.role)
    return page
      .getByRole(target.role, target.name ? { name: target.name, exact } : {})
      .nth(target.nth ?? 0);
  if (target.label) return page.getByLabel(target.label, { exact }).nth(target.nth ?? 0);
  if (target.placeholder)
    return page.getByPlaceholder(target.placeholder, { exact }).nth(target.nth ?? 0);
  if (target.testid) return page.getByTestId(target.testid).nth(target.nth ?? 0);
  if (target.text) return page.getByText(target.text, { exact }).nth(target.nth ?? 0);
  if (target.selector) return page.locator(target.selector).nth(target.nth ?? 0);
  throw new Error(`unrecognized target ${JSON.stringify(target)}`);
}

export function describe(action, target, value) {
  const t =
    target == null
      ? ''
      : typeof target === 'string'
        ? `"${target}"`
        : target.role
          ? `${target.role}${target.name ? ` "${target.name}"` : ''}`
          : Object.entries(target)
              .filter(([k]) => k !== 'exact' && k !== 'nth')
              .map(([k, v]) => `${k} "${v}"`)
              .join(' ');
  switch (action) {
    case 'goto':
      return `Opened ${value || '/'}`;
    case 'click':
      return `Clicked ${t}`;
    case 'dblclick':
      return `Double-clicked ${t}`;
    case 'hover':
      return `Hovered ${t}`;
    case 'fill':
      return `Typed "${value}" into ${t}`;
    case 'type':
      return `Typed "${value}" key by key into ${t}`;
    case 'press':
      return `Pressed ${value}${t ? ` in ${t}` : ''}`;
    case 'select':
      return `Chose "${value}" in ${t}`;
    case 'check':
      return `Checked ${t}`;
    case 'uncheck':
      return `Unchecked ${t}`;
    case 'wait':
      return `Waited ${value} ms`;
    case 'back':
      return 'Went back';
    default:
      return `${action} ${t}`;
  }
}

export class BrowserSession {
  constructor(baseUrl, { ignoreOrigins = [] } = {}) {
    this.baseUrl = baseUrl;
    this.ignoreOrigins = ignoreOrigins;
    this.steps = [];
    this.page = null;
    this.context = null;
    this.errors = [];
    this.requests = [];
  }

  async ensure() {
    if (this.page && !this.page.isClosed()) return this.page;
    const b = await browser();
    this.context = await b.newContext({ viewport: { width: 1280, height: 800 } });
    const origin = new URL(this.baseUrl).origin;
    // Only the app itself loads; external fonts and analytics hang in sandboxes.
    await this.context.route('**/*', (route) => {
      const url = route.request().url();
      return url.startsWith(origin) ||
        url.startsWith('data:') ||
        url.startsWith('blob:') ||
        /^https?:\/\/(127\.0\.0\.1|localhost)[:/]/u.test(url)
        ? route.continue()
        : route.abort();
    });
    this.page = await this.context.newPage();
    // Ground truth for request recall: what the browser actually sent (fetch/XHR only).
    this.page.on('requestfinished', (request) => {
      if (!['fetch', 'xhr'].includes(request.resourceType())) return;
      const url = new URL(request.url());
      if (this.ignoreOrigins.includes(url.origin)) return;
      request.response().then(
        (response) =>
          this.requests.push({
            at: Date.now(),
            method: request.method(),
            path: url.pathname + url.search,
            status: response?.status() ?? null,
          }),
        () => {},
      );
    });
    this.page.on('pageerror', (error) =>
      this.errors.push({ at: Date.now(), message: String(error.message).slice(0, 500) }),
    );
    return this.page;
  }

  async act({ action, target = null, value = null, timeout = 8000 }) {
    const page = await this.ensure();
    const step = {
      index: this.steps.length,
      action,
      target,
      value,
      description: describe(action, target, value),
      started_at: Date.now(),
      url_before: page.url(),
    };
    try {
      switch (action) {
        case 'goto':
          await page.goto(new URL(value || '/', this.baseUrl).href, {
            waitUntil: 'domcontentloaded',
            timeout: 30000,
          });
          break;
        case 'click':
          await locate(page, target).click({ timeout });
          break;
        case 'dblclick':
          await locate(page, target).dblclick({ timeout });
          break;
        case 'hover':
          await locate(page, target).hover({ timeout });
          break;
        case 'fill':
          await locate(page, target).fill(String(value ?? ''), { timeout });
          break;
        case 'type':
          await locate(page, target).pressSequentially(String(value ?? ''), { timeout, delay: 30 });
          break;
        case 'press':
          if (target) await locate(page, target).press(String(value), { timeout });
          else await page.keyboard.press(String(value));
          break;
        case 'select':
          await locate(page, target).selectOption(String(value), { timeout });
          break;
        case 'check':
          await locate(page, target).check({ timeout });
          break;
        case 'uncheck':
          await locate(page, target).uncheck({ timeout });
          break;
        case 'wait':
          await page.waitForTimeout(Math.min(Number(value) || 1000, 30000));
          break;
        case 'back':
          await page.goBack({ waitUntil: 'domcontentloaded' });
          break;
        default:
          throw new Error(
            `unknown action "${action}" (goto, click, dblclick, hover, fill, type, press, select, check, uncheck, wait, back)`,
          );
      }
      step.ok = true;
    } catch (error) {
      step.ok = false;
      step.error = String(error.message).split('\n')[0].slice(0, 300);
    }
    // Let the page react and its rows reach the collector before the step closes.
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await page.waitForTimeout(600);
    step.ended_at = Date.now();
    step.url_after = page.url();
    this.steps.push(step);
    return step;
  }

  /** The page as Claude should read it: URL, title and the accessibility tree. */
  async snapshot({ maxChars = 12000 } = {}) {
    const page = await this.ensure();
    if (page.url() === 'about:blank')
      return { url: page.url(), title: '', tree: '(no page open: call act with action "goto")' };
    let tree = await page
      .locator('body')
      .ariaSnapshot({ timeout: 5000 })
      .catch((error) => `(snapshot failed: ${error.message})`);
    if (tree.length > maxChars)
      tree = `${tree.slice(0, maxChars)}\n… (${tree.length - maxChars} more characters)`;
    return { url: page.url(), title: await page.title().catch(() => ''), tree };
  }

  async screenshot() {
    const page = await this.ensure();
    return page.screenshot({ type: 'png' });
  }

  async reset() {
    // Closing the context ends the page session; the next act starts a new one.
    if (this.page) await this.page.close({ runBeforeUnload: true }).catch(() => {});
    await this.context?.close().catch(() => {});
    this.page = null;
    this.context = null;
    this.steps = [];
    this.errors = [];
    this.requests = [];
  }
}
