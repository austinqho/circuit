// No false negatives (headless, neutral fixture). A first-party click makes no
// request; an uninstrumented <script> (public/, never transformed) sees the
// DOM change on its own load-time interval and fetches. The page ships rows
// through the real collector sink into a real `producttrace-collector` store.
//
//   A. the click's chain stops at `browser`; its headline names the
//      third-party request that left the page in its window (issuer unknown),
//      which is listed under `unlinked` (attribution: none); page delivery is
//      complete (capture.page / summary / received), and the click's own
//      coverage is not (fix/honest-coverage, 2026-09-24: a request with no
//      action and no known issuer in its window);
//   B. a second page whose first sink batch is aborted (every retry): its
//      coverage is incomplete, with the sequence gap and the sink drop as reasons.
//
//   node test/browser/unlinked-coverage-neutral.mjs [dependencyRoot]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { buildReactFixture, serveFixture } from './fixture-build.mjs';
import { createCollector } from '../../collector/index.js';
import { createStore, loadStore } from '../../collector/store.mjs';
import { callTool } from '../../mcp/tools.mjs';
import { SCOPED_ABSENCE } from '../../analysis/runtime-attribution.mjs';
import { UNLINKED_ATTRIBUTION } from '../../analysis/causal-chain.mjs';

const tracerRoot = path.resolve(import.meta.dirname, '../..');
const dependencyRoot = path.resolve(process.argv[2] || '/Users/austinho/dev/trace-consolidated/.live-demo/librechat-m1');
const fixtureDir = path.join(tracerRoot, 'test/browser/fixtures/unlinked-request-app');
const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tracer-unlinked-store-'));
const collector = createCollector({ port: 0, store: { dir: storeDir, manifest: null, label: 'unlinked-coverage-neutral' } });
await collector.ready;
const fixture = await buildReactFixture({ dependencyRoot, name: 'unlinked-coverage',
  appSource: fs.readFileSync(path.join(fixtureDir, 'main.jsx'), 'utf8'),
  publicFiles: { 'third-party.js': fs.readFileSync(path.join(fixtureDir, 'third-party.js'), 'utf8') },
  bodyHtml: '<script src="/third-party.js"></script>',
  pluginOptions: { collector: { url: collector.url, force: true } } });
const server = await serveFixture(fixture.distRoot, { 'GET /api/third-party': () => ({ ok: true }) });
const { chromium } = createRequire(path.join(dependencyRoot, 'package.json'))('playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.PRODUCTTRACE_BROWSER_EXECUTABLE ? { executablePath: process.env.PRODUCTTRACE_BROWSER_EXECUTABLE } : {}) });
const sessions = {};
try {
  const drive = async (label, { abortFirstIngest = 0 } = {}) => {
    const page = await browser.newPage();
    const errors = []; page.on('pageerror', error => errors.push(String(error)));
    let aborted = 0;
    if (abortFirstIngest) await page.route(`${collector.url}/ingest`, route => (aborted < abortFirstIngest ? (aborted += 1, route.abort()) : route.continue()));
    const thirdParty = [];
    page.on('request', request => { if (new URL(request.url()).pathname === '/api/third-party') thirdParty.push(request.url()); });
    await page.goto(server.origin, { waitUntil: 'networkidle' });
    await page.waitForTimeout(abortFirstIngest ? 1500 : 300);
    await page.getByRole('button', { name: 'Toggle' }).click(); await page.waitForTimeout(500);
    await page.getByRole('button', { name: 'Other' }).click(); await page.waitForTimeout(500);
    const session = await page.evaluate(() => globalThis.__productTraceRuntime.session);
    const sink = await page.evaluate(() => globalThis.__productTraceCollectorStats());
    // pagehide: the sink asks the runtime for capture.summary, then beacons the tail.
    await page.goto('about:blank'); await page.waitForTimeout(800);
    await page.close();
    assert.deepEqual(errors, [], `${label}: page errors`);
    sessions[label] = { session, sink, thirdParty, aborted };
  };
  await drive('A');
  await drive('B', { abortFirstIngest: 5 });
} finally {
  await browser.close(); await server.close();
}
await collector.close();

const loaded = await loadStore({ dir: storeDir });
// Idle view of the same rows (they were written moments ago).
const store = createStore({ records: loaded.records, spans: loaded.spans, now: () => Date.now() + 1e6 });
const report = { store: storeDir, sessions, checks: [] };
const check = (name, pass, detail) => { report.checks.push({ name, pass: Boolean(pass), detail }); };

// A. scoped absence + unlinked listing + complete coverage.
{
  const { session, thirdParty } = sessions.A;
  const clicks = store.actionRows.filter(row => row.capture_page_id === session && row.event === 'click');
  const toggle = clicks[0];
  const chain = callTool(store, 'action_chain', { action_id: toggle.action_id });
  const unattributed = store.records.filter(row => row.capture_page_id === session && row.kind === 'network.request' && !row.action_id && row.url === '/api/third-party?state=yes');
  check('A0 the browser made the third-party request and the runtime wrapper saw it unattributed', thirdParty.length === 1 && unattributed.length === 1, { playwright: thirdParty, rows: unattributed.map(row => row.sequence) });
  check('A1 the click has a first-party entry handler and no attributed request', Boolean(chain.stops.find(stop => stop.stop === 'entry_handler')) && !chain.stops.some(stop => stop.stop === 'request'), chain.summary.split('\n')[0]);
  // fix/honest-coverage rule 4 (2026-09-24): the request that left the page in the window is in the headline.
  check('A2 frontier is scoped absence at the browser, naming the request that left the page in its window', chain.stopped_at === 'browser'
    && chain.because === "no request could be attributed to this action from instrumented code (requests from uninstrumented scripts, workers and third-party code cannot be linked; transports and realms Tracer does not record are listed in coverage.unobserved); 1 recorded request left this page during this action's window that Tracer could not attribute (GET /api/third-party, issuer unknown), listed below as unlinked"
    && chain.because.startsWith(SCOPED_ABSENCE.no_request.split(' (')[0]), [chain.reached, chain.stopped_at, chain.because]);
  const listed = chain.unlinked?.requests || [];
  check('A3 the third-party request is listed under unlinked, attribution none', listed.length === 1 && listed[0].url === '/api/third-party?state=yes' && listed[0].attribution === UNLINKED_ATTRIBUTION && listed[0].sequence === unattributed[0]?.sequence,
    { listed, window: chain.unlinked?.window });
  check('A4 the MCP renders them under the unlinked heading', /\nObserved during this action's window, not linked to it \(timestamps only order, not a join\):\n- request GET \/api\/third-party\?state=yes /u.test(chain.summary), chain.summary);
  const other = callTool(store, 'action_chain', { action_id: clicks[1].action_id });
  check('A5 the next click does not inherit the listing (its window starts at its own dispatch)', other.stopped_at === 'browser' && (other.unlinked?.requests || []).length === 0, other.unlinked?.window);
  const coverage = store.coverageFor(session);
  check('A6 coverage complete: every emitted row received, contiguous, no limits', coverage.complete === true && coverage.reasons.length === 0, coverage);
  // fix/honest-coverage rule 2 (2026-09-24): the click's window holds a request with no action and no known issuer.
  const recent = callTool(store, 'recent_actions', { session }).actions;
  check('A7 action_chain carries the page coverage plus its window: not complete for the click whose window holds the unattributed request', chain.coverage?.complete === false
    && JSON.stringify(chain.coverage.reasons) === JSON.stringify(["1 request(s) left this page in this action's window not attributed to any user action and with no known issuer (listed as unlinked)"])
    && recent.find(action => action.action_id === clicks[1].action_id)?.coverage?.complete === true, chain.coverage);
  // fix/honest-coverage rule 1 (2026-09-24; A8 failed on main: it expected the constant ['worker', 'beacon'] while the
  // runtime wraps Worker): unobserved is measured from capture.page.observes. Chromium exposes on* event kinds the
  // runtime does not listen to, and navigator.sendBeacon is present and not wrapped.
  const pageRow = store.records.find(row => row.capture_page_id === session && row.kind === 'capture.page');
  const events = coverage.unobserved?.find(entry => entry.kind === 'events');
  // A runtime that listens for every kind the page exposes (D-G1-21) has no event kinds entry; one that does not names them.
  const allObserved = pageRow?.observes?.events?.unobserved?.length === 0;
  check('A8 unobserved is measured from what the runtime installed (event kinds, transports), never a constant',
    (allObserved ? !events && pageRow.observes.events.recorded.includes('pointerdown')
      : events && events.names.length === pageRow.observes.events.unobserved.length && events.names.includes('pointerdown') && !events.names.some(name => pageRow.observes.events.recorded.includes(name)))
    && coverage.unobserved.some(entry => entry.kind === 'transport' && entry.name === 'beacon')
    && !coverage.unobserved.some(entry => entry.kind === 'transport' && ['fetch', 'xhr', 'worker'].includes(entry.name)) && !coverage.unobserved.some(entry => entry.kind === 'realm'),
    coverage.unobserved?.map(entry => [entry.kind, entry.name, entry.count]));
}
// B. dropped batch → incomplete with the gap as the reason.
{
  const { session, sink, aborted } = sessions.B;
  const coverage = store.coverageFor(session);
  check('B0 the first sink batch was aborted on every attempt and counted as dropped by the sink', aborted === 5 && sink.dropped > 0, { aborted, sink });
  check('B1 coverage incomplete with a sequence gap starting at 1', coverage.complete === false && coverage.reasons.some(reason => /^sequence gaps: 1(?:-\d+)?(?:, [0-9, -]+)? \(\d+ row\(s\) emitted but not received\)$/u.test(reason)), coverage.reasons);
  check('B2 the summary reports the sink drop as a reason', coverage.reasons.some(reason => reason === `the page sink dropped ${sink.dropped} row(s) after retries`), coverage.reasons);
  const click = store.actionRows.find(row => row.capture_page_id === session && row.event === 'click');
  const chain = click ? callTool(store, 'action_chain', { action_id: click.action_id }) : null;
  // The action's coverage is the page's reasons first, then its own window's (fix/honest-coverage rule 2).
  check('B3 action_chain on that page reports complete: false with the reasons', chain?.coverage?.complete === false
    && JSON.stringify(chain.coverage.reasons.slice(0, coverage.reasons.length)) === JSON.stringify(coverage.reasons)
    && JSON.stringify(chain.coverage.reasons.slice(coverage.reasons.length)) === JSON.stringify(chain.coverage.window_reasons || []), chain?.coverage);
}

const failed = report.checks.filter(entry => !entry.pass);
for (const entry of report.checks) console.log(`${entry.pass ? 'PASS' : 'FAIL'} ${entry.name}${entry.pass ? '' : `\n  ${JSON.stringify(entry.detail).slice(0, 1500)}`}`);
console.log(`${report.checks.length - failed.length}/${report.checks.length} checks pass; store ${storeDir}`);
fixture.cleanup();
if (failed.length) process.exitCode = 1; else fs.rmSync(storeDir, { recursive: true, force: true });
