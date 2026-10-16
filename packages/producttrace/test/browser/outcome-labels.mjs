// Outcome labels (headless, neutral fixture): every outcome label Tracer
// prints tells the truth about the response and about the app's own decision.
//
// A one-file React app (test/browser/fixtures/outcome-labels-app/main.jsx) is
// built with both Tracer plugins; its rows ship through the real collector
// sink into a real store. Its API runs in a separate Node process under
// `node --import producttrace/backend/register` (fixture server.mjs: Express,
// a Map wrapped in DB-like client spans); spans reach the same store. A small
// front server serves the build, proxies /api/* to that backend, and answers
// /api/untraced itself (no server span: a frontier).
//
// Each control's action is checked against its own rows: the MCP
// (action_chain, element_history, recent_actions, compare_chains), the chain's
// display (what the live viewer prints), exported action chains
// (buildActionChains) and every summary sentence. No `completed` may appear
// anywhere for a >= 400 or a reject, and a reject needs a recorded signal.
//
//   node test/browser/outcome-labels.mjs [dependencyRoot] [--out <dir>]
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { buildReactFixture } from './fixture-build.mjs';
import { createCollector } from '../../collector/index.js';
import { createStore, loadStore } from '../../collector/store.mjs';
import { callTool } from '../../mcp/tools.mjs';
import { SCOPED_ABSENCE, buildActionChains } from '../../analysis/runtime-attribution.mjs';
import { HANDLER_RAN_NO_REQUEST, OUTCOME_STATUSES, buildEpisodeChain } from '../../analysis/causal-chain.mjs';

const tracerRoot = path.resolve(import.meta.dirname, '../..');
const argv = process.argv.slice(2);
const outIndex = argv.indexOf('--out');
const outDir = outIndex >= 0 ? path.resolve(argv[outIndex + 1]) : null;
const positional = argv.filter((value, index) => !value.startsWith('--') && argv[index - 1] !== '--out');
const dependencyRoot = path.resolve(positional[0] || '/Users/austinho/dev/trace-consolidated/.live-demo/librechat-m1');
const fixtureDir = path.join(tracerRoot, 'test/browser/fixtures/outcome-labels-app');
const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tracer-outcome-labels-store-'));

const collector = createCollector({ port: 0, store: { dir: storeDir, manifest: null, label: 'outcome-labels' } });
await collector.ready;

// Backend: its own process, telemetry only through the default entrypoint.
const backend = spawn(process.execPath, ['--import', 'producttrace/backend/register', path.join(fixtureDir, 'server.mjs')], {
  cwd: tracerRoot,
  env: { PATH: process.env.PATH, HOME: process.env.HOME, PRODUCTTRACE_BACKEND_SPAN_ENDPOINT: `${collector.url}/spans`, PRODUCTTRACE_SERVICE_NAME: 'outcome-labels-api' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let backendOutput = '';
backend.stderr.on('data', chunk => { backendOutput += chunk; });
const backendExited = new Promise(resolve => backend.once('exit', code => resolve(code)));
const backendPort = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`backend did not start:\n${backendOutput}`)), 20_000);
  backend.stdout.on('data', chunk => { backendOutput += chunk; const match = /listening (\d+)/u.exec(backendOutput); if (match) { clearTimeout(timer); resolve(Number(match[1])); } });
  backend.once('exit', code => { clearTimeout(timer); reject(new Error(`backend exited ${code}:\n${backendOutput}`)); });
});

const fixture = await buildReactFixture({ dependencyRoot, name: 'outcome-labels', appSource: fs.readFileSync(path.join(fixtureDir, 'main.jsx'), 'utf8'),
  pluginOptions: { collector: { url: collector.url, force: true } } });

// Front server: the build, /api/untraced answered here (no span), /api/* proxied with every header (traceparent included).
const front = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://front');
  if (url.pathname === '/api/untraced') { req.resume(); req.on('end', () => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}'); }); return; }
  if (url.pathname.startsWith('/api/')) {
    const upstream = http.request({ host: '127.0.0.1', port: backendPort, method: req.method, path: req.url, headers: req.headers }, response => {
      res.writeHead(response.statusCode, response.headers); response.pipe(res);
    });
    upstream.on('error', error => { res.writeHead(502); res.end(String(error)); });
    req.pipe(upstream); return;
  }
  const relative = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  const file = path.resolve(fixture.distRoot, relative);
  if (!file.startsWith(`${fixture.distRoot}${path.sep}`) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': file.endsWith('.js') ? 'text/javascript' : file.endsWith('.html') ? 'text/html' : 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(resolve => front.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${front.address().port}`;

const { chromium } = createRequire(path.join(dependencyRoot, 'package.json'))('playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.PRODUCTTRACE_BROWSER_EXECUTABLE ? { executablePath: process.env.PRODUCTTRACE_BROWSER_EXECUTABLE } : {}) });
const observed = { page_errors: [], dom: {}, responses: {} };
let session = null;
try {
  const page = await browser.newPage();
  page.on('pageerror', error => observed.page_errors.push(`${error.name}: ${error.message}`));
  page.on('response', response => { const pathname = new URL(response.url()).pathname; if (pathname.startsWith('/api/')) (observed.responses[pathname] ||= []).push(response.status()); });
  await page.goto(origin, { waitUntil: 'networkidle' });
  const settle = () => page.waitForTimeout(600);
  const click = async testid => { await page.getByTestId(testid).click(); await settle(); };
  await click('create'); await click('ping'); await click('claim'); await click('profile'); await click('report'); await click('untraced');
  await click('write-then-fail'); await click('lookup'); await click('read-seats');
  await click('abandon'); observed.dom.abandon = await page.getByRole('status').textContent();
  await page.getByText('Seat B').click(); await settle();
  observed.dom.seat_status = await page.getByRole('status').textContent();
  await click('throw'); await click('reject'); await click('caught');
  await click('profile-submit');
  observed.dom.profile_alert = await page.getByRole('alert').textContent().catch(() => null);
  await click('subscribe');
  observed.dom.subscribe_valid = await page.evaluate(() => document.querySelector('form[aria-label="Subscribe"]').checkValidity());
  // Grader probes: a formnovalidate submitter, and a noValidate multi-step "Next" (step 2 is outside the form).
  await click('save-draft'); observed.dom.draft_status = await page.getByRole('status').textContent();
  await click('wizard-next'); observed.dom.wizard_status = await page.getByRole('status').textContent();
  await click('inner-next'); observed.dom.inner_step_two = await page.getByLabel('Step two field').count();
  await click('inner-next-validated'); observed.dom.inner_validated_step_two = await page.getByText('Step 2 of 3').count();
  // Focus and keyboard actions too: a Tab into the title field and a keypress in it.
  await page.getByLabel('Title').focus(); await page.keyboard.press('a'); await settle();
  session = await page.evaluate(() => globalThis.__productTraceRuntime.session);
  await page.goto('about:blank'); await page.waitForTimeout(800);
  await page.close();
} finally {
  await browser.close();
  await new Promise(resolve => front.close(resolve));
  backend.kill('SIGTERM'); await backendExited;
}
await new Promise(resolve => setTimeout(resolve, 300));
await collector.close();

const loaded = await loadStore({ dir: storeDir });
// The build's attribution manifest and checkout name the handlers; stores are viewed idle.
const storeOptions = { manifest: fixture.manifest, sourceRoot: fixture.repository, now: () => Date.now() + 1e6 };
const store = createStore({ records: loaded.records, spans: loaded.spans, ...storeOptions });
const frontendOnly = createStore({ records: loaded.records, spans: [], ...storeOptions });
const exports = new Map(buildActionChains(loaded.records.filter(row => row.kind !== 'element.stamp'), loaded.spans, { backendInstrumented: true }).map(row => [row.action_id, row]));
const report = { store: storeDir, session, observed, checks: [], cases: {} };
const check = (name, pass, detail) => { report.checks.push({ name, pass: Boolean(pass), detail }); };

const actions = store.actionRows.filter(row => row.capture_page_id === session);
const byTestId = (testid, event = 'click') => actions.filter(row => row.event === event && row.target?.attributes?.['data-testid'] === testid).at(-1) || null;
const rowsOf = actionId => store.records.filter(row => row.action_id === actionId);

/** Every place Tracer prints this action's status, gathered once. */
function surfaces(actionId) {
  const chain = callTool(store, 'action_chain', { action_id: actionId });
  const recent = callTool(store, 'recent_actions', { session, n: 100 }).actions.find(row => row.action_id === actionId) || null;
  const key = chain.stops[0]?.element_key || null;
  const history = key ? callTool(store, 'element_history', { element_key: key, session, n: 100 }) : null;
  const historyAction = history?.actions?.find(row => row.action_id === actionId) || null;
  const attempt = history?.attempts?.find(row => row.action_ids.includes(actionId)) || null;
  const compared = callTool(store, 'compare_chains', { before_action_id: actionId, after_action_id: actionId });
  const exported = exports.get(actionId) || null;
  // The live viewer's record: the same assembler over the same rows (idle).
  const episode = store.episodes.episodes.get(store.episodes.byAction.get(actionId)) || null;
  const live = episode ? buildEpisodeChain(episode, store.records, store.spans, { idle: true }) : null;
  return { chain, recent, history, historyAction, attempt, compared, exported, live };
}

/** The statuses and sentences every surface prints for one action. */
function printed(s) {
  return {
    action_chain: s.chain.outcome.status, display_status: s.chain.outcome.display_status, chain_display: s.chain.chain.display.status, chain_outcome: s.chain.chain.outcome.status,
    recent_actions: s.recent?.outcome?.status ?? null, element_history: s.historyAction?.outcome?.status ?? null, attempt: s.attempt?.outcome?.status ?? null,
    compare_before: s.compared.before.outcome, compare_after: s.compared.after.outcome, live_viewer: s.live?.display?.status ?? null,
  };
}

function expectOutcome(name, actionId, expected) {
  if (!actionId) { check(`${name}: action recorded`, false, null); return null; }
  const s = surfaces(actionId);
  const statuses = printed(s);
  const values = Object.values(statuses);
  report.cases[name] = { action_id: actionId, statuses, outcome: s.chain.outcome, export_outcome: s.exported?.outcome ?? null, summary: s.chain.summary.split('\n')[0],
    live_label: s.live?.display?.label ?? null, reached: s.chain.reached, stopped_at: s.chain.stopped_at, because: s.chain.because };
  check(`${name}: every surface prints ${expected.status}`, values.every(value => value === expected.status), statuses);
  check(`${name}: status is in the documented label set`, OUTCOME_STATUSES.includes(s.chain.outcome.status), s.chain.outcome.status);
  check(`${name}: live viewer label = MCP label`, s.live?.display?.label === s.chain.outcome.label && s.chain.chain.display.label === s.chain.outcome.label, [s.live?.display?.label, s.chain.outcome.label]);
  // `text` is the whole bracket, or its start when it ends in counts (`…)`).
  const bracket = expected.open ? `[outcome ${expected.text}` : `[outcome ${expected.text}]`;
  check(`${name}: summary lines carry ${bracket}`, [s.chain.summary, s.recent?.summary, s.historyAction?.summary, s.compared.before.summary].every(line => line?.includes(bracket)),
    s.chain.summary.split('\n')[0]);
  if (expected.exportStatus !== null) check(`${name}: exported action chain says ${expected.exportStatus || expected.status}`, s.exported?.outcome?.status === (expected.exportStatus || expected.status), s.exported?.outcome);
  if (expected.http != null) check(`${name}: http_status ${expected.http} on the outcome and the export`, s.chain.outcome.http_status === expected.http && (expected.exportStatus === null || s.exported?.outcome?.http_status === expected.http), [s.chain.outcome.http_status, s.exported?.outcome?.http_status]);
  if (expected.http >= 400 || expected.status === 'rejected_client_side') {
    const everything = JSON.stringify({ chain: s.chain, recent: s.recent, history: s.historyAction, attempt: s.attempt, compared: [s.compared.before, s.compared.after, s.compared.summary], exported: s.exported, live: s.live });
    check(`${name}: no "completed" anywhere (JSON, display, summaries, export, viewer)`, !/completed/u.test(everything), (everything.match(/.{60}completed.{60}/u) || [])[0]);
  }
  check(`${name}: never "incomplete"`, !/"incomplete"|\bincomplete\b/u.test(JSON.stringify([s.chain.outcome, s.chain.chain.display, s.chain.chain.terminal, s.exported?.outcome, s.chain.summary])), null);
  return s;
}

// --- responses (the backend answered what the rows say) ---
const created = expectOutcome('2xx with a DB-like effect span', byTestId('create')?.action_id, { status: 'completed', text: 'completed 201', http: 201 });
check('2xx with effect: the label names the joined write', created?.chain.outcome.label === 'Completed 201: insert items' && created.chain.stopped_at === null, created?.chain.outcome.label);
const pinged = expectOutcome('2xx without effect evidence', byTestId('ping')?.action_id, { status: 'responded', text: 'responded 200; no effect evidence', http: 200 });
check('2xx without effect: note "no effect evidence"', pinged?.chain.outcome.note === 'no effect evidence' && pinged.chain.stopped_at === 'handler', [pinged?.chain.outcome.note, pinged?.chain.stopped_at]);
const conflict = expectOutcome('409 after a database read', byTestId('claim')?.action_id, { status: 'failed', text: 'failed 409', http: 409 });
check('409: the engine did join the read (the old "Effect: find seats" / completed case)', conflict?.chain.chain.display.stage === 'effect' && conflict.chain.stops.some(stop => stop.stop === 'db' && stop.operation === 'find'),
  conflict?.chain.stops.filter(stop => stop.stop === 'db'));
check('409: label and frontier state the status', conflict?.chain.outcome.label === 'Failed 409: POST /api/seats/A/claim' && /^server responded 409; /u.test(conflict.chain.because), [conflict?.chain.outcome.label, conflict?.chain.because]);
expectOutcome('422', byTestId('profile')?.action_id, { status: 'failed', text: 'failed 422', http: 422 });
expectOutcome('500', byTestId('report')?.action_id, { status: 'failed', text: 'failed 500', http: 500 });
const frontier = expectOutcome('request that stops at a frontier (no server span)', byTestId('untraced')?.action_id, { status: 'stopped', text: 'stopped at network' });
check('frontier: stopped_at network with the frontier sentence', frontier?.chain.outcome.stopped_at === 'network' && frontier.chain.outcome.because === 'no server span with the exact parent span id arrived in the same trace', frontier?.chain.outcome);
check('responses the browser saw match the backend statuses', JSON.stringify(observed.responses['/api/seats/A/claim']) === '[409]' && JSON.stringify(observed.responses['/api/profile']) === '[422]'
  && JSON.stringify(observed.responses['/api/reports']) === '[500,500]' && JSON.stringify(observed.responses['/api/items']) === '[201,201]', observed.responses);

// --- the app's own decisions ---
const seatAction = actions.filter(row => row.event === 'click' && row.target?.attributes?.role === 'gridcell').at(-1);
const seat = expectOutcome('hit-test returns early (seat taken)', seatAction?.action_id, { status: 'no_request', text: `no_request; ${HANDLER_RAN_NO_REQUEST} (`, open: true });
check('hit-test: the DOM shows the app\'s status message', observed.dom.seat_status === 'Seat B is taken', observed.dom.seat_status);
check('hit-test: counts of what the handler did (functions entered, DOM mutations) and the scoped sentence', seat?.chain.outcome.did?.functions_entered >= 1 && seat.chain.outcome.did.dom_mutations >= 1
  && seat.chain.outcome.sentence.startsWith(HANDLER_RAN_NO_REQUEST) && seat.chain.outcome.sentence.endsWith(SCOPED_ABSENCE.no_request) && !seat.chain.outcome.reason, seat?.chain.outcome);
check('hit-test: frontier unchanged (browser, scoped absence)', seat?.chain.stopped_at === 'browser' && seat.chain.because === SCOPED_ABSENCE.no_request, [seat?.chain.stopped_at]);

const throwAction = byTestId('throw');
const threw = expectOutcome('handler throws', throwAction?.action_id, { status: 'rejected_client_side', text: 'rejected_client_side; handler_threw (TypeError)' });
const throwRows = throwAction ? rowsOf(throwAction.action_id) : [];
check('throw: signal recorded (action.uncaught_error via uncaught_exception, TypeError) and reason handler_threw',
  throwRows.some(row => row.kind === 'action.uncaught_error' && row.via === 'uncaught_exception' && row.error_type === 'TypeError') && threw?.chain.outcome.reason === 'handler_threw',
  throwRows.filter(row => row.kind === 'action.uncaught_error'));
check('throw: function.exit carries threw + error_type, never the message', throwRows.some(row => row.kind === 'function.exit' && row.threw === true && row.error_type === 'TypeError')
  && !JSON.stringify(loaded.records).includes('Cannot read properties of null'), throwRows.filter(row => row.kind === 'function.exit').map(row => [row.threw, row.error_type]));
const rejectAction = byTestId('reject');
const rejected = expectOutcome('async handler rejects', rejectAction?.action_id, { status: 'rejected_client_side', text: 'rejected_client_side; promise_rejected (RangeError)' });
check('reject: signal recorded via unhandled_rejection (RangeError), reason promise_rejected', rowsOf(rejectAction?.action_id).some(row => row.kind === 'action.uncaught_error' && row.via === 'unhandled_rejection' && row.error_type === 'RangeError')
  && rejected?.chain.outcome.reason === 'promise_rejected' && !JSON.stringify(loaded.records).includes('rejected later'), rejected?.chain.outcome);
const caughtAction = byTestId('caught');
const caught = expectOutcome('error caught by the app itself', caughtAction?.action_id, { status: 'no_request', text: `no_request; ${HANDLER_RAN_NO_REQUEST} (`, open: true });
check('caught: a frame threw (SyntaxError) but nothing escaped, so no reject is claimed', rowsOf(caughtAction?.action_id).some(row => row.kind === 'function.exit' && row.threw === true && row.error_type === 'SyntaxError')
  && !rowsOf(caughtAction?.action_id).some(row => row.kind === 'action.uncaught_error') && !caught?.chain.outcome.reason, caught?.chain.outcome);

const profileSubmit = byTestId('profile-submit', 'submit') || actions.filter(row => row.event === 'submit' && row.form?.attributes?.['aria-label'] === 'Profile').at(-1);
const validation = expectOutcome('form submit stopped by the app\'s validation', profileSubmit?.action_id, { status: 'rejected_client_side', text: 'rejected_client_side; form_validation' });
check('app validation (novalidate form): the DOM shows the app\'s message; the only signal is the same-form mutation (never form_invalid: the browser did not validate)',
  observed.dom.profile_alert === 'Name is required' && validation?.chain.outcome.reason === 'form_validation'
  && validation.chain.outcome.signals.length > 0 && validation.chain.outcome.signals.every(signal => signal.via === 'submit_rejected'),
  [observed.dom.profile_alert, validation?.chain.outcome.signals]);
const subscribeClick = byTestId('subscribe');
const nativeInvalid = expectOutcome('submit blocked by the form\'s declared constraints (required)', subscribeClick?.action_id, { status: 'rejected_client_side', text: 'rejected_client_side; form_validation' });
check('native validation: no submit dispatched, the click carries form_invalid, no request', observed.dom.subscribe_valid === false && subscribeClick?.form_invalid === true
  && !actions.some(row => row.event === 'submit' && row.form?.attributes?.['aria-label'] === 'Subscribe') && nativeInvalid?.chain.outcome.signals.every(signal => signal.via === 'form_invalid_at_dispatch'),
  { valid: observed.dom.subscribe_valid, form_invalid: subscribeClick?.form_invalid });

// --- grader probes: submits the browser did not validate are never rejects ---
const draftSubmit = actions.filter(row => row.event === 'submit' && row.form?.attributes?.['aria-label'] === 'Draft').at(-1);
const draftClick = byTestId('save-draft');
const draft = expectOutcome('formnovalidate "Save draft" (submit, nothing sent)', draftSubmit?.action_id, { status: 'no_request', text: `no_request; ${HANDLER_RAN_NO_REQUEST} (`, open: true });
check('formnovalidate: no form_invalid on the click or the submit, and the click is no_request too', observed.dom.draft_status === 'draft kept locally' && draftClick && !draftClick.form_invalid && !draftSubmit?.form_invalid
  && callTool(store, 'action_chain', { action_id: draftClick.action_id }).outcome.status === 'no_request' && !draft?.chain.outcome.reason, { click: draftClick?.form_invalid, submit: draftSubmit?.form_invalid });
const wizardSubmit = actions.filter(row => row.event === 'submit' && row.form?.attributes?.['aria-label'] === 'Wizard').at(-1);
const wizardClick = byTestId('wizard-next');
const wizard = expectOutcome('noValidate multi-step "Next" (submit, nothing sent)', wizardSubmit?.action_id, { status: 'no_request', text: `no_request; ${HANDLER_RAN_NO_REQUEST} (`, open: true });
check('noValidate: no form_invalid, click and submit are no_request', observed.dom.wizard_status === 'step 2' && wizardClick && !wizardClick.form_invalid && !wizardSubmit?.form_invalid
  && callTool(store, 'action_chain', { action_id: wizardClick.action_id }).outcome.status === 'no_request' && !wizard?.chain.outcome.reason, { click: wizardClick?.form_invalid, submit: wizardSubmit?.form_invalid });

// Inner-step forms (the next step renders inside the same form): a bare
// same-form mutation is not validation feedback, so never a rejection.
for (const [label, formName, domKey] of [['inner-step "Next inside" (noValidate, step 2 input rendered in the form)', 'Inner wizard', 'inner_step_two'],
  ['inner-step "Next inside validated" (valid form, "Step 2 of 3" rendered in the form)', 'Inner wizard validated', 'inner_validated_step_two']]) {
  const submit = actions.filter(row => row.event === 'submit' && row.form?.attributes?.['aria-label'] === formName).at(-1);
  const inner = expectOutcome(label, submit?.action_id, { status: 'no_request', text: `no_request; ${HANDLER_RAN_NO_REQUEST} (`, open: true });
  const receipt = submit ? rowsOf(submit.action_id).find(row => row.kind === 'dom.mutation') : null;
  check(`${label}: the step rendered, the receipt is a bare same-form mutation (no feedback), and nothing is called rejected`,
    observed.dom[domKey] === 1 && receipt?.validation?.same_form === true && !receipt.validation.feedback_mutations && !receipt.validation.aria_invalid_changed
      && !receipt.validation.focus_moved_to_invalid_field && !inner?.chain.outcome.reason && inner?.chain.stopped_at === 'browser',
    { dom: observed.dom[domKey], validation: receipt?.validation, stopped_at: inner?.chain.stopped_at });
}
check('app validation keeps its reject: the submit\'s own receipt shows validation feedback', rowsOf(profileSubmit?.action_id).some(row => row.kind === 'dom.mutation' && row.validation?.feedback_mutations > 0), null);

// --- mixed statuses and HTTP semantics ---
const mixed = expectOutcome('write then a 500 in the same action', byTestId('write-then-fail')?.action_id, { status: 'completed', text: 'completed 201; also failed 500 POST /api/reports', http: 201 });
const mixedLabel = 'Completed 201: insert items; also failed 500 POST /api/reports';
check('mixed: the credited request (latest with a write) decides; the 500 is stated on the label, display, terminal label, viewer and export',
  mixed?.chain.outcome.label === mixedLabel && mixed.chain.chain.display.label === mixedLabel && mixed.chain.chain.terminal.label === mixedLabel && mixed.live?.display?.label === mixedLabel
  && mixed.exported?.outcome?.label === mixedLabel && mixed.chain.outcome.other_requests?.length === 1 && mixed.chain.outcome.other_requests[0].http_status === 500,
  [mixed?.chain.outcome.label, mixed?.live?.display?.label, mixed?.exported?.outcome?.label]);
const lookup = expectOutcome('POST that only read (2xx, unsafe method)', byTestId('lookup')?.action_id, { status: 'responded', text: 'responded 200; no write observed', http: 200 });
check('POST read only: responded, note "no write observed", never completed', lookup?.chain.outcome.note === 'no write observed' && lookup.chain.outcome.label === 'Responded 200: no write observed', lookup?.chain.outcome);
const readSeats = expectOutcome('GET with a read (2xx, safe method)', byTestId('read-seats')?.action_id, { status: 'completed', text: 'completed 200', http: 200 });
check('GET read: completed with the read named', readSeats?.chain.outcome.label === 'Completed 200: find seats', readSeats?.chain.outcome.label);

// --- a request the page aborted (fix/client-aborts): abort wins over the server's 201 ---
{
  const abandoned = expectOutcome('write the page aborted (the server still wrote and answered 201)', byTestId('abandon')?.action_id, { status: 'aborted_by_client', text: 'aborted_by_client; server answered 201' });
  check('aborted write: the app saw its abort; the browser got no response', observed.dom.abandon === 'write abandoned' && !observed.responses['/api/slow-items'], [observed.dom.abandon, observed.responses['/api/slow-items']]);
  check('aborted write: server_status 201 kept, http_status null, label and sentence state both facts', abandoned?.chain.outcome.server_status === 201 && abandoned.chain.outcome.http_status === null
    && abandoned.chain.outcome.label === 'Aborted by the page: POST /api/slow-items; the server answered 201'
    && abandoned.chain.outcome.sentence.startsWith('aborted by the page before the response was read: POST /api/slow-items (before the response headers arrived; AbortError); the server answered 201 and wrote insert items')
    && abandoned.exported?.outcome?.server_status === 201, abandoned?.chain.outcome);
  const printedText = JSON.stringify([abandoned?.chain.outcome, abandoned?.chain.chain.display, abandoned?.chain.summary, abandoned?.exported?.outcome, abandoned?.live?.display]);
  check('aborted write: no "completed" anywhere it prints a status', !/completed|Completed/u.test(printedText), (printedText.match(/.{60}[Cc]ompleted.{40}/u) || [])[0]);
}

// --- compare_chains states a label change ---
{
  const before = seat?.chain.action_id; const after = threw?.chain.action_id;
  const compared = before && after ? callTool(store, 'compare_chains', { before_action_id: before, after_action_id: after }) : null;
  check('compare_chains: no_request → rejected_client_side is an outcome change (status and reason in changed), never "outcome unchanged"',
    compared && compared.outcome_delta.changed.includes('status') && compared.outcome_delta.changed.includes('reason') && !/outcome unchanged/u.test(compared.summary),
    compared?.outcome_delta?.changed);
}

// --- one status per action_id, for every action kind (focus, keydown, input, click, submit) ---
{
  const kinds = {}; const disagree = [];
  for (const row of actions) {
    const s = surfaces(row.action_id);
    kinds[row.event] = (kinds[row.event] || 0) + 1;
    // Episode-focus rule 3 (fix/episode-focus): a non-carrier episode member's
    // own surfaces describe its own evidence; the episode surfaces (its
    // attempt, the live viewer's card) describe the episode, so they must say
    // what the carrier's own chain says. For every other action both are the same.
    const { attempt: attemptStatus, live_viewer: liveStatus, ...own } = printed(s);
    // D-G1-21: gesture-context rows no episode holds (pointer phases, hover
    // ranges, keyup, blur, ...) are not listed by recent_actions or
    // element_history unless include_context is passed; every other surface
    // prints them and must agree.
    if (store.contextOnly(row.action_id)) { delete own.recent_actions; delete own.element_history; }
    const values = { ...own, export: s.exported?.outcome?.status ?? null };
    const labels = [s.chain.outcome.label, s.chain.chain.display.label, s.chain.chain.terminal.label, s.exported?.outcome?.label];
    const carrier = s.chain.episode_member ? callTool(store, 'action_chain', { action_id: s.chain.episode_carrier_action_id }) : s.chain;
    const episodeValues = { attempt: attemptStatus, live_viewer: liveStatus };
    const episodeAgrees = Object.values(episodeValues).every(value => value === null || value === carrier.outcome.status)
      && (s.live?.display?.label == null || s.live.display.label === carrier.outcome.label);
    if (new Set(Object.values(values)).size !== 1 || new Set(labels).size !== 1 || !episodeAgrees)
      disagree.push({ action_id: row.action_id, event: row.event, member: Boolean(s.chain.episode_member), values, episodeValues, carrier: carrier.outcome.status, labels });
  }
  report.action_kinds = kinds;
  check(`every action (${actions.length}: ${Object.entries(kinds).map(([kind, count]) => `${kind} ${count}`).join(', ')}) prints one status and one label on every surface, export included (a member's attempt and viewer card say its carrier's)`,
    disagree.length === 0 && ['focusin', 'keydown', 'click', 'submit'].every(kind => kinds[kind] > 0), disagree.slice(0, 5));
}

// --- abstain over guess: every reject has a recorded signal; no other action is a reject ---
const all = actions.map(row => callTool(store, 'action_chain', { action_id: row.action_id }));
check('every rejected_client_side has a recorded signal from its own rows', all.filter(chain => chain.outcome.status === 'rejected_client_side').every(chain => chain.outcome.signals?.length > 0), null);
check('every >= 400 is failed with its status, on the action and on each segment', all.every(chain => (chain.outcome.http_status >= 400 ? chain.outcome.status === 'failed' : true)
  && chain.segments.every(segment => (segment.http_status >= 400 ? segment.outcome === 'failed' && /\[failed \d{3}/u.test(segment.summary) : true))), null);
check('no action anywhere prints "incomplete"', !all.some(chain => /\bincomplete\b/u.test(JSON.stringify([chain.outcome, chain.chain.display, chain.summary]))), null);
check('display_status never disagrees with status', all.every(chain => chain.outcome.display_status === chain.outcome.status && chain.chain.display.status === chain.outcome.status), null);
check('page errors are exactly the two uncaught ones', observed.page_errors.length === 2 && observed.page_errors.some(text => text.startsWith('TypeError')) && observed.page_errors.some(text => text.startsWith('RangeError')), observed.page_errors);

// --- the same rows, backend declared off: every request stops at the network frontier ---
const offAll = actions.map(row => callTool(frontendOnly, 'action_chain', { action_id: row.action_id })).filter(chain => chain.stops.some(stop => stop.stop === 'request'));
const onEpisodes = new Set(all.filter(chain => chain.stops.some(stop => stop.stop === 'request')).map(chain => chain.episode_id));
// A request the page aborted stays aborted_by_client without spans (the abort is a browser fact); the server's answer is then not recorded.
const offAborted = offAll.filter(chain => chain.stops.some(stop => stop.stop === 'request' && callTool(frontendOnly, 'page_requests', { session }).requests.find(row => row.request_occurrence_id === stop.request_occurrence_id)?.aborted_by_client));
check('frontend-only store: every request-bearing action is stopped at network / backend not instrumented, never completed/responded/failed (the aborted one: aborted_by_client, server answer not recorded)',
  onEpisodes.size === 10 && new Set(offAll.map(chain => chain.episode_id)).size === onEpisodes.size && offAborted.length === 1
  && offAborted.every(chain => chain.outcome.status === 'aborted_by_client' && chain.outcome.server_status === null && chain.outcome.sentence.endsWith("the server's answer is not recorded (backend not instrumented)"))
  && offAll.filter(chain => !offAborted.includes(chain)).every(chain => chain.outcome.status === 'stopped' && chain.outcome.stopped_at === 'network' && chain.because === 'backend not instrumented' && chain.chain.display.status === 'stopped'),
  offAll.map(chain => [chain.action_id, chain.outcome.status, chain.because]));

const failed = report.checks.filter(entry => !entry.pass);
for (const entry of report.checks) console.log(`${entry.pass ? 'PASS' : 'FAIL'} ${entry.name}${entry.pass ? '' : `\n  ${JSON.stringify(entry.detail).slice(0, 1500)}`}`);
console.log(`${report.checks.length - failed.length}/${report.checks.length} checks pass; store ${storeDir}`);
if (outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'outcome-labels-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  // The raw store (rows, spans, run) and the build's manifest, for independent recomputation.
  fs.cpSync(storeDir, path.join(outDir, 'store'), { recursive: true });
  fs.writeFileSync(path.join(outDir, 'attribution-manifest.json'), `${JSON.stringify(fixture.manifest, null, 2)}\n`);
}
fixture.cleanup();
if (failed.length) process.exitCode = 1; else fs.rmSync(storeDir, { recursive: true, force: true });
