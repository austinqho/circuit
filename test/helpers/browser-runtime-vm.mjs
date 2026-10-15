// Evaluate the browser attribution runtime in an isolated V8 context with
// minimal DOM/transport stubs. No browser, no network.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const runtimeSource = fs.readFileSync(path.resolve(import.meta.dirname, '../../src/runtime-attribution-browser.js'), 'utf8');

export function fakeElement(tagName, attributes = {}, parent = null) {
  const element = {
    nodeType: 1, tagName: tagName.toUpperCase(), parentElement: parent, isConnected: true,
    _attrs: new Map(Object.entries(attributes)),
    get attributes() { return [...this._attrs].map(([name, value]) => ({ name, value })); },
    getAttribute(name) { return this._attrs.has(name) ? this._attrs.get(name) : null; },
    hasAttribute(name) { return this._attrs.has(name); },
    setAttribute(name, value) { this._attrs.set(name, String(value)); },
    removeAttribute(name) { this._attrs.delete(name); },
    matches(selector) { return selector.split(',').some(part => matchesSimple(this, part.trim())); },
    closest(selector) { let node = this; while (node) { if (node.matches?.(selector)) return node; node = node.parentElement; } return null; },
    contains(other) { let node = other; while (node) { if (node === this) return true; node = node.parentElement; } return false; },
    querySelector() { return null; }, querySelectorAll() { return []; },
  };
  return element;
}

// Enough of CSS for the runtime's own selectors: tag, [attr], [attr="v"], a[href].
function matchesSimple(element, part) {
  const match = part.match(/^([a-z]*)((?:\[[^\]]+\])*)(?::not\(.*\))?$/u);
  if (!match) return false;
  if (match[1] && element.tagName.toLowerCase() !== match[1]) return false;
  for (const attr of match[2].match(/\[[^\]]+\]/gu) || []) {
    const [, name, value] = attr.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/u) || [];
    if (!name || !element._attrs.has(name)) return false;
    if (value !== undefined && element._attrs.get(name) !== value) return false;
  }
  return true;
}

// A browser exposes its event kinds as on* handler accessors and its events as
// instances of their interfaces; the runtime discovers the first and records
// by the second (D-G1-21). This is the minimum of both a test page needs.
class FakeEvent { constructor(init = {}) { Object.assign(this, init); } }
class FakeUIEvent extends FakeEvent {}
class FakeMouseEvent extends FakeUIEvent {}
class FakePointerEvent extends FakeMouseEvent {}
class FakeKeyboardEvent extends FakeUIEvent {}
class FakeFocusEvent extends FakeUIEvent {}
class FakeInputEvent extends FakeUIEvent {}
const EVENT_CLASS = { click: [FakePointerEvent, { button: 0, buttons: 0, pointerId: 1, pointerType: 'mouse', detail: 1 }], keydown: [FakeKeyboardEvent, {}],
  focusin: [FakeFocusEvent, {}], input: [FakeInputEvent, {}] };
function fakeHTMLElement() {
  function HTMLElement() {}
  for (const type of ['click', 'input', 'change', 'submit', 'keydown']) Object.defineProperty(HTMLElement.prototype, `on${type}`, { get() { return null; }, set() {}, configurable: true, enumerable: true });
  return HTMLElement;
}

export function loadBrowserRuntime({ withDocument = true, extraGlobals = {} } = {}) {
  const listeners = new Map();
  const fetchCalls = [], xhrCalls = [];
  const document = withDocument ? {
    addEventListener(type, listener) { const values = listeners.get(type) || []; values.push(listener); listeners.set(type, values); },
    documentElement: null, activeElement: null,
  } : undefined;
  class FakeXMLHttpRequest {}
  FakeXMLHttpRequest.prototype.open = function open(method, url) { this._request = { method, url, headers: {} }; };
  FakeXMLHttpRequest.prototype.setRequestHeader = function setRequestHeader(name, value) { this._request.headers[name.toLowerCase()] = value; };
  FakeXMLHttpRequest.prototype.send = function send() { xhrCalls.push({ ...this._request }); };
  const context = vm.createContext({
    setTimeout, clearTimeout, queueMicrotask, Headers, crypto: globalThis.crypto, console,
    fetch: async (input, init) => { fetchCalls.push({ input: String(input), headers: Object.fromEntries(new Headers(init?.headers || {})) }); return { ok: true, status: 204 }; },
    XMLHttpRequest: FakeXMLHttpRequest,
    Event: FakeEvent, UIEvent: FakeUIEvent, MouseEvent: FakeMouseEvent, PointerEvent: FakePointerEvent, KeyboardEvent: FakeKeyboardEvent, FocusEvent: FakeFocusEvent,
    InputEvent: FakeInputEvent, HTMLElement: fakeHTMLElement(),
    ...(document ? { document } : {}),
    ...extraGlobals,
  });
  vm.runInContext(runtimeSource, context, { filename: 'runtime-attribution-browser.js' });
  const runtime = context.__productTraceRuntime;
  // `during` runs while the event is still being dispatched (window.event is
  // the event when the context defines `event`), then the dispatch ends.
  const dispatch = (type, target, extra = {}, during = null) => {
    const [EventClass, defaults] = EVENT_CLASS[type] || [FakeEvent, {}];
    const event = new EventClass({ type, target, isTrusted: true, composedPath: () => [target], ...defaults, ...extra });
    const observable = 'event' in context; const previous = observable ? context.event : undefined;
    if (observable) context.event = event;
    try { for (const listener of listeners.get(type) || []) listener(event); if (during) during(event); }
    finally { if (observable) context.event = previous; }
    return event;
  };
  return { context, runtime, dispatch, fetchCalls, xhrCalls, evaluate: code => vm.runInContext(code, context) };
}
