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
    location: { origin: 'http://app.test', pathname: '/', search: '' },
    performance: { now: () => Date.now() },
    setInterval(fn, ms) {
      intervals.push({ fn, ms });
      return intervals.length;
    },
  };
  const document = { ...target('document'), visibilityState: 'visible', getElementById: () => null };
  const navigator = { sendBeacon: (url, body) => (beacons.push({ url, body: JSON.parse(body) }), true) };
  const context = vm.createContext({ window, document, navigator, Math, JSON, Object, String, WeakMap, Function });
  return { context, window, listeners, beacons, intervals, element };
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
  vm.runInContext(listenScript({ endpoint: 'http://collector.test/listen', flushMs: 0 }), page.context);
  function handleStart() {
    return 'go';
  }
  function Landing() {}
  const button = page.element('button', { text: 'Get started' }, {
    __reactProps$abc: { onClick: handleStart },
    __reactFiber$abc: { type: 'button', return: { type: Landing, return: null } },
  });
  const fire = (type, phaseCapture) =>
    page.listeners
      .filter((l) => l.on === 'window' && l.type === type && Boolean(l.options.capture) === phaseCapture)
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
  const email = page.element('input', { type: 'email', 'aria-label': 'Email' }, { type: 'email', value: '' });
  const password = page.element('input', { type: 'password', 'aria-label': 'Password' }, { type: 'password', value: '' });
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
  vm.runInContext(listenScript({ endpoint: 'http://collector.test/listen', flushMs: 0 }), page.context);
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
  vm.runInContext(listenScript({ endpoint: 'http://collector.test/listen', flushMs: 0 }), page.context);
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
    assert.doesNotThrow(() => l.fn({ type: 'click', isTrusted: true, target: hostile, timeStamp: 1 }));
  page.listeners.filter((l) => l.type === 'pagehide').forEach((l) => l.fn({}));
  assert.ok(page.beacons.length === 0 || page.beacons[0].body.errors >= 1);
});

test('listenScript needs an endpoint and keeps its settings safe inside a script tag', () => {
  assert.throws(() => listenScript({}), /endpoint/);
  const source = listenScript({ endpoint: 'http://x.test/</script><b>' });
  assert.equal(source.includes('</script>'), false);
});
