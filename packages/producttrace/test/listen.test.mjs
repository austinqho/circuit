import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';
import { fingerprintSource, listenScript } from '../listen.mjs';

// A small fake page: just enough window, document and DOM for the script to
// run, with every call it makes recorded.
function fakePage() {
  const listeners = [];
  const beacons = [];
  const intervals = [];
  const target = (name) => ({
    addEventListener(type, fn, options) {
      listeners.push({ on: name, type, fn, options });
    },
  });
  const element = (tag, attrs = {}, props = {}) => {
    const el = {
      nodeType: 1,
      tagName: tag.toUpperCase(),
      parentElement: null,
      textContent: attrs.text ?? '',
      getAttribute: (name) => attrs[name] ?? null,
      closest: () => el,
      ...props,
    };
    return el;
  };
  const window = {
    ...target('window'),
    location: { protocol: 'http:', origin: 'http://app.test', pathname: '/', search: '' },
    performance: { now: () => Date.now() },
    setInterval(fn, ms) {
      intervals.push({ fn, ms });
      return intervals.length;
    },
  };
  const document = {
    ...target('document'),
    visibilityState: 'visible',
    getElementById: () => null,
  };
  const navigator = {
    sendBeacon: (url, body) => (beacons.push({ url, body: JSON.parse(body) }), true),
  };
  // PerformanceObserver that hands entries to observers when the test says so.
  const observers = [];
  window.PerformanceObserver = class {
    constructor(fn) {
      this.fn = fn;
    }
    observe(options) {
      observers.push({ type: options.type, fn: this.fn });
    }
  };
  window.PerformanceObserver.supportedEntryTypes = ['resource', 'navigation'];
  const deliver = (type, entries) =>
    observers.filter((o) => o.type === type).forEach((o) => o.fn({ getEntries: () => entries }));
  const context = vm.createContext({
    window,
    document,
    navigator,
    Math,
    JSON,
    Object,
    String,
    WeakMap,
    Function,
    PerformanceObserver: window.PerformanceObserver,
  });
  return { context, window, listeners, beacons, intervals, element, deliver };
}

test('the listen script defines no globals and only adds passive listeners', () => {
  const page = fakePage();
  const before = Object.getOwnPropertyNames(page.context).sort();
  const windowBefore = Object.keys(page.window).sort();
  vm.runInContext(listenScript({ endpoint: 'http://collector.test/listen' }), page.context);
  assert.deepEqual(Object.getOwnPropertyNames(page.context).sort(), before);
  assert.deepEqual(Object.keys(page.window).sort(), windowBefore);
  assert.ok(page.listeners.length > 0);
  for (const { type, options } of page.listeners)
    assert.equal(options?.passive, true, `${type} listener must be passive`);
});

test('a click is recorded with its React handler, fingerprinted the way a build step would', () => {
  const page = fakePage();
  vm.runInContext(
    listenScript({ endpoint: 'http://collector.test/listen', flushMs: 0 }),
    page.context,
  );
  function handleStart() {
    return 'go';
  }
  function Landing() {}
  const button = page.element(
    'button',
    { text: 'Get started' },
    {
      __reactProps$abc: { onClick: handleStart },
      __reactFiber$abc: { type: 'button', return: { type: Landing, return: null } },
    },
  );
  const fire = (type, phaseCapture) =>
    page.listeners
      .filter(
        (l) => l.on === 'window' && l.type === type && Boolean(l.options.capture) === phaseCapture,
      )
      .forEach((l) => l.fn({ type, isTrusted: true, target: button, timeStamp: 1 }));
  fire('click', true);
  fire('click', false);
  // A click a script dispatched is not the user's and is not recorded.
  page.listeners
    .filter((l) => l.type === 'click' && l.options.capture)
    .forEach((l) => l.fn({ type: 'click', isTrusted: false, target: button, timeStamp: 2 }));
  page.listeners.filter((l) => l.type === 'pagehide').forEach((l) => l.fn({}));

  assert.equal(page.beacons.length, 1);
  const { body } = page.beacons[0];
  assert.equal(body.schema, 'producttrace.listen.v1');
  const actions = body.rows.filter((row) => row.kind === 'action');
  assert.equal(actions.length, 1);
  const [click] = actions;
  assert.equal(click.target.name, 'Get started');
  assert.notEqual(click.end, null, 'the dispatch window closed');
  assert.equal(click.handler.prop, 'onClick');
  assert.equal(click.handler.name, 'handleStart');
  assert.equal(click.handler.fingerprint, fingerprintSource(handleStart.toString()));
  assert.deepEqual(click.handler.owners, [fingerprintSource(Landing.toString())]);
  assert.equal(body.errors, 0);
  assert.equal(typeof body.cost_ms, 'number');
});

test('typing is one row per field, and a password is never recorded', () => {
  const page = fakePage();
  vm.runInContext(
    listenScript({ endpoint: 'http://collector.test/listen', values: true, flushMs: 0 }),
    page.context,
  );
  const email = page.element(
    'input',
    { type: 'email', 'aria-label': 'Email' },
    { type: 'email', value: '' },
  );
  const password = page.element(
    'input',
    { type: 'password', 'aria-label': 'Password' },
    { type: 'password', value: '' },
  );
  const type = (field, value) => {
    field.value = value;
    page.listeners
      .filter((l) => l.type === 'input' && l.options.capture)
      .forEach((l) => l.fn({ type: 'input', isTrusted: true, target: field, timeStamp: 1 }));
  };
  for (const prefix of ['a', 'ad', 'ada@x.io']) type(email, prefix);
  type(password, 'hunter2');
  page.listeners.filter((l) => l.type === 'pagehide').forEach((l) => l.fn({}));
  const inputs = page.beacons[0].body.rows.filter((row) => row.type === 'input');
  assert.equal(inputs.length, 2);
  assert.equal(inputs[0].value, 'ada@x.io');
  assert.equal(inputs[1].value, undefined);
  assert.equal(inputs[1].sensitive, true);
  assert.equal(JSON.stringify(page.beacons).includes('hunter2'), false);
});

test('typed values stay out unless asked for', () => {
  const page = fakePage();
  vm.runInContext(
    listenScript({ endpoint: 'http://collector.test/listen', flushMs: 0 }),
    page.context,
  );
  const field = page.element('input', { 'aria-label': 'Name' }, { type: 'text', value: 'Maya' });
  page.listeners
    .filter((l) => l.type === 'input' && l.options.capture)
    .forEach((l) => l.fn({ type: 'input', isTrusted: true, target: field, timeStamp: 1 }));
  page.listeners.filter((l) => l.type === 'pagehide').forEach((l) => l.fn({}));
  const [row] = page.beacons[0].body.rows;
  assert.equal(row.length, 4);
  assert.equal(row.value, undefined);
});

test('an error inside the script is counted, never thrown at the app', () => {
  const page = fakePage();
  vm.runInContext(
    listenScript({ endpoint: 'http://collector.test/listen', flushMs: 0 }),
    page.context,
  );
  const hostile = {
    nodeType: 1,
    get tagName() {
      throw new Error('boom');
    },
    closest() {
      return this;
    },
    getAttribute: () => null,
  };
  for (const l of page.listeners.filter((x) => x.type === 'click' && x.options.capture))
    assert.doesNotThrow(() =>
      l.fn({ type: 'click', isTrusted: true, target: hostile, timeStamp: 1 }),
    );
  page.listeners.filter((l) => l.type === 'pagehide').forEach((l) => l.fn({}));
  assert.ok(page.beacons.length === 0 || page.beacons[0].body.errors >= 1);
});

test('listenScript needs an endpoint and keeps its settings safe inside a script tag', () => {
  assert.throws(() => listenScript({}), /endpoint/);
  const source = listenScript({ endpoint: 'http://x.test/</script><b>' });
  assert.equal(source.includes('</script>'), false);
});

test('a page load is one row, and the tab icon and its own beacons are not app requests', () => {
  const page = fakePage();
  vm.runInContext(
    listenScript({ endpoint: 'http://collector.test/listen', flushMs: 0 }),
    page.context,
  );
  const nav = {
    type: 'navigate',
    domContentLoadedEventEnd: 120,
    serverTiming: [{ name: 'rid', description: 'abc' }],
  };
  // Chrome hands the navigation entry to a buffered observer, then again after load.
  page.deliver('navigation', [nav]);
  page.deliver('navigation', [nav]);
  page.deliver('resource', [
    { name: 'http://app.test/favicon.ico', initiatorType: 'other', startTime: 1, responseEnd: 2 },
    { name: 'http://collector.test/listen', initiatorType: 'beacon', startTime: 1, responseEnd: 2 },
    {
      name: 'http://app.test/api/me',
      initiatorType: 'fetch',
      startTime: 3,
      responseEnd: 9,
      responseStatus: 200,
      serverTiming: [{ name: 'rid', description: 'r-1' }],
    },
  ]);
  page.listeners.filter((l) => l.type === 'pagehide').forEach((l) => l.fn({}));
  const rows = page.beacons[0].body.rows;
  assert.deepEqual(
    rows.map((r) => r.kind),
    ['load', 'request'],
  );
  assert.equal(rows[0].server_id, 'abc');
  assert.deepEqual([rows[1].url, rows[1].status, rows[1].server_id], ['/api/me', 200, 'r-1']);
});

test('a blank tab or browser page gets no listeners and sends nothing', () => {
  const page = fakePage();
  page.window.location = { protocol: 'about:', origin: 'null', pathname: 'blank', search: '' };
  vm.runInContext(listenScript({ endpoint: 'http://collector.test/listen' }), page.context);
  assert.equal(page.listeners.length, 0);
  assert.equal(page.intervals.length, 0);
});

// Helpers for the gesture tests: fire one event through every matching listener.
function dispatcher(page) {
  return (type, event, phase = 'both') => {
    for (const l of page.listeners) {
      if (l.on !== 'window' || l.type !== type) continue;
      const capture = Boolean(l.options.capture);
      if (phase === 'capture' && !capture) continue;
      if (phase === 'bubble' && capture) continue;
      l.fn({ type, isTrusted: true, timeStamp: 1, ...event });
    }
  };
}
function sent(page) {
  page.listeners.filter((l) => l.type === 'pagehide').forEach((l) => l.fn({}));
  return page.beacons.flatMap((b) => b.body.rows);
}
function run(page, options = {}) {
  vm.runInContext(
    listenScript({ endpoint: 'http://collector.test/listen', flushMs: 0, ...options }),
    page.context,
  );
  return dispatcher(page);
}

test('a drag keeps the handler of what was picked up, even after the app removes it', () => {
  const page = fakePage();
  const fire = run(page);
  function startDrag() {}
  const card = page.element(
    'div',
    { role: 'button', 'aria-label': 'Move task' },
    { __reactProps$k: { onPointerDown: startDrag } },
  );
  fire('pointerdown', { target: card, clientX: 10, clientY: 10 });
  // The app moves the card to another column: the old node and its props are gone.
  card.isConnected = false;
  delete card.__reactProps$k;
  fire('pointerup', { target: card, clientX: 200, clientY: 10 });
  const [drag] = sent(page).filter((r) => r.type === 'drag');
  assert.equal(drag.target.name, 'Move task');
  assert.equal(drag.handler.name, 'startDrag');
});

test('picking an option from a menu that closes is named after the option, not the page', () => {
  const page = fakePage();
  const fire = run(page);
  function choose() {}
  const option = page.element(
    'div',
    { role: 'option', text: 'Last month' },
    { __reactProps$k: { onPointerUp: choose } },
  );
  const body = page.element('body');
  fire('pointerdown', { target: option, clientX: 5, clientY: 5 });
  fire('pointerup', { target: option, clientX: 5, clientY: 5 });
  option.isConnected = false;
  fire('click', { target: body });
  const [click] = sent(page).filter((r) => r.type === 'click');
  assert.equal(click.target.name, 'Last month');
  assert.equal(click.target.role, 'option');
  assert.equal(click.handler.name, 'choose');
});

test('a key is a shortcut outside a field and typing inside one; a modifier alone is nothing', () => {
  const page = fakePage();
  const fire = run(page);
  const canvas = page.element('div', { text: 'canvas' });
  const field = page.element('input', { 'aria-label': 'Title' }, { type: 'text', value: '' });
  fire('keydown', { target: canvas, key: 'o' }, 'capture');
  fire('keydown', { target: canvas, key: ' ' }, 'capture');
  fire('keydown', { target: field, key: 'o' }, 'capture');
  fire('keydown', { target: canvas, key: 'Control', ctrlKey: true }, 'capture');
  const keys = sent(page)
    .filter((r) => r.type === 'keydown')
    .map((r) => r.key);
  assert.deepEqual(keys, ['o', ' ']);
});

test('a password stays secret after "show password", and so does a field named as one', () => {
  const page = fakePage();
  const fire = run(page, { values: true });
  const shown = page.element('input', { 'aria-label': 'Secret' }, { type: 'password', value: '' });
  const named = page.element('input', { name: 'password' }, { type: 'text', value: '' });
  const type = (field, value) => {
    field.value = value;
    fire('input', { target: field });
  };
  type(shown, 'a');
  shown.type = 'text'; // the eye icon
  type(shown, '!lovelace123');
  type(named, 'hunter2');
  const rows = sent(page);
  assert.equal(JSON.stringify(rows).includes('lovelace'), false);
  assert.equal(JSON.stringify(rows).includes('hunter2'), false);
  assert.ok(rows.filter((r) => r.type === 'input').every((r) => r.sensitive));
});

test('an editor is never named by what was typed into it', () => {
  const page = fakePage();
  const fire = run(page);
  const editor = page.element(
    'div',
    { contenteditable: 'true', text: 'my private note' },
    { isContentEditable: true },
  );
  fire('click', { target: editor });
  const [click] = sent(page);
  assert.equal(click.target.name, null);
});

test('an icon button takes the name written on its icon', () => {
  const page = fakePage();
  const fire = run(page);
  const icon = page.element('div', { 'aria-label': 'Undo' });
  const button = page.element('button', {}, { querySelector: () => icon });
  fire('click', { target: button });
  assert.equal(sent(page)[0].target.name, 'Undo');
});

test('ticking a checkbox is one row', () => {
  const page = fakePage();
  const fire = run(page);
  const box = page.element(
    'input',
    { type: 'checkbox', 'aria-label': 'Remember me' },
    { type: 'checkbox', checked: true },
  );
  fire('click', { target: box });
  fire('input', { target: box });
  fire('change', { target: box });
  const rows = sent(page);
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].type, rows[0].checked], ['change', true]);
});

test('a field that refuses a keystroke is recorded with the value it kept', () => {
  const page = fakePage();
  const fire = run(page, { values: true });
  const field = page.element('input', { 'aria-label': 'Code' }, { type: 'text', value: '12' });
  field.value = '12x';
  fire('input', { target: field }, 'capture');
  field.value = '12'; // React puts back its own state before the event reaches window
  fire('input', { target: field }, 'bubble');
  const [row] = sent(page);
  assert.deepEqual([row.value, row.length], ['12', 2]);
});

test('a timed send holds back the field still being typed in, so it stays one row', () => {
  const page = fakePage();
  const fire = run(page, { values: true, flushMs: 1000 });
  const field = page.element('input', { 'aria-label': 'Name' }, { type: 'text', value: '' });
  field.value = 'Ad';
  fire('input', { target: field });
  page.intervals[0].fn();
  field.value = 'Ada';
  fire('input', { target: field });
  const inputs = sent(page).filter((r) => r.type === 'input');
  assert.equal(inputs.length, 1);
  assert.equal(inputs[0].value, 'Ada');
});
