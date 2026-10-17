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

// CIRCUIT_BROWSER=firefox or webkit runs the bench in that engine instead
// (listen mode and verify's comparison work there; debugger mode and script
// timings need Chromium).
const ENGINE = process.env.CIRCUIT_BROWSER || 'chromium';

async function browser() {
  if (!browserPromise) {
    browserPromise = import('playwright').then(async (playwright) => {
      const { chromium } = playwright;
      if (ENGINE !== 'chromium') {
        if (!['firefox', 'webkit'].includes(ENGINE))
          throw new Error(`CIRCUIT_BROWSER must be chromium, firefox or webkit, not "${ENGINE}"`);
        return playwright[ENGINE].launch({ headless: process.env.CIRCUIT_HEADED !== '1' });
      }
      const launch = () =>
        chromium.launch({
          executablePath: chromiumPath(),
          headless: process.env.CIRCUIT_HEADED !== '1',
          // Only the machine's own hosts resolve: external fonts and analytics
          // fail at once instead of hanging in sandboxes (see BrowserSession).
          args: [
            '--no-proxy-server',
            '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1',
          ],
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
    case 'drag':
      return `Dragged across ${t} (${value})`;
    case 'wait':
      return `Waited ${value} ms`;
    case 'back':
      return 'Went back';
    default:
      return `${action} ${t}`;
  }
}

export class BrowserSession {
  // `intercept: false` leaves every request to the browser itself. Routing
  // requests through Playwright changes how they behave: a cross-origin request
  // the server's CORS policy refuses goes through anyway. The read-only check
  // needs the browser's own behavior.
  constructor(baseUrl, { ignoreOrigins = [], intercept = true } = {}) {
    this.baseUrl = baseUrl;
    this.ignoreOrigins = ignoreOrigins;
    this.intercept = intercept;
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
    this.input = null;
    const origin = new URL(this.baseUrl).origin;
    // Only the app itself loads; external fonts and analytics hang in sandboxes.
    if (this.intercept)
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
    const sentAt = (request) => {
      const { startTime } = request.timing();
      return startTime > 0 ? Math.round(startTime) : Date.now();
    };
    this.page.on('requestfinished', (request) => {
      if (!['fetch', 'xhr'].includes(request.resourceType())) return;
      const url = new URL(request.url());
      if (this.ignoreOrigins.includes(url.origin)) return;
      request.response().then(
        (response) =>
          this.requests.push({
            // When the browser sent it, so it lands in the step that caused it.
            at: sentAt(request),
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

  /**
   * Input at a person's pace: each event goes out `paceMs` after the last
   * through the DevTools Protocol, without waiting for the page to handle the
   * one before, as a real mouse or keyboard would. Playwright's own click and
   * type wait for each, which hides input a busy or paused page drops.
   */
  async paced(page, events, paceMs) {
    this.input ??= await this.context.newCDPSession(page);
    const sent = [];
    await new Promise((resolve) => {
      events.forEach((group, index) =>
        setTimeout(() => {
          sent.push(...group.map(([method, params]) => this.input.send(method, params)));
          if (index === events.length - 1) resolve();
        }, index * paceMs),
      );
    });
    await Promise.all(sent);
  }

  async act({ action, target = null, value = null, timeout = 8000, repeat = 1, pace_ms = null }) {
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
          if (pace_ms) {
            const box = await locate(page, target).boundingBox({ timeout });
            if (!box) throw new Error('click target is not visible');
            const at = {
              x: box.x + box.width / 2,
              y: box.y + box.height / 2,
              button: 'left',
              clickCount: 1,
            };
            const click = [
              ['Input.dispatchMouseEvent', { type: 'mousePressed', ...at }],
              ['Input.dispatchMouseEvent', { type: 'mouseReleased', ...at }],
            ];
            await this.paced(
              page,
              Array.from({ length: Math.max(1, repeat) }, () => click),
              pace_ms,
            );
          } else await locate(page, target).click({ timeout });
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
          if (pace_ms) {
            if (target) await locate(page, target).click({ timeout });
            const keys = [...String(value ?? '')].map((key) => [
              ['Input.dispatchKeyEvent', { type: 'keyDown', key, text: key }],
              ['Input.dispatchKeyEvent', { type: 'keyUp', key }],
            ]);
            await this.paced(page, keys, pace_ms);
          } else if (target)
            await locate(page, target).pressSequentially(String(value ?? ''), {
              timeout,
              delay: 30,
            });
          else await page.keyboard.type(String(value ?? ''), { delay: 30 });
          break;
        case 'drag': {
          // value "x1,y1 x2,y2": pixels from the target's top-left corner. Canvas apps
          // (whiteboards, editors) only draw on a pointer drag.
          const points = String(value ?? '')
            .trim()
            .split(/\s+/u)
            .map((pair) => pair.split(',').map(Number));
          if (points.length < 2 || points.flat().some((n) => !Number.isFinite(n)))
            throw new Error('drag needs value "x1,y1 x2,y2" (pixels from the target\'s top-left)');
          const box = await locate(page, target).boundingBox({ timeout });
          if (!box) throw new Error('drag target is not visible');
          const [first, ...rest] = points;
          await page.mouse.move(box.x + first[0], box.y + first[1]);
          await page.mouse.down();
          for (const [x, y] of rest) await page.mouse.move(box.x + x, box.y + y, { steps: 8 });
          await page.mouse.up();
          break;
        }
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
            `unknown action "${action}" (goto, click, dblclick, hover, fill, type, press, select, check, uncheck, drag, wait, back)`,
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
    this.input = null;
    this.steps = [];
    this.errors = [];
    this.requests = [];
  }
}
