// Each button runs one case where instrumentation could change what the app
// sees, and writes what happened onto the page. The read-only check compares
// the page after every click: a plain app and an instrumented one must show
// the same text.
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

// A listener that removes itself by its own name must run once.
function selfRemove() {
  const target = new EventTarget();
  let count = 0;
  target.addEventListener('ping', function onPing() {
    count += 1;
    const inner = () => 1;
    inner();
    target.removeEventListener('ping', onPing);
  });
  target.dispatchEvent(new Event('ping'));
  target.dispatchEvent(new Event('ping'));
  return `ran ${count} time(s)`;
}

// A `once` listener removed before it fires never fires; added twice, it registers once.
function onceListeners() {
  let fired = 0;
  const listener = () => (fired += 1);
  window.addEventListener('probe-once', listener, { once: true });
  window.removeEventListener('probe-once', listener);
  window.dispatchEvent(new Event('probe-once'));
  let twice = 0;
  const again = () => (twice += 1);
  window.addEventListener('probe-twice', again, { once: true });
  window.addEventListener('probe-twice', again, { once: true });
  window.dispatchEvent(new Event('probe-twice'));
  return `removed once-listener fired ${fired}; added twice fired ${twice}`;
}

// A request to another origin that allows no extra request headers.
async function crossOrigin() {
  const origin = await (await fetch('/probe/cross-origin')).text();
  try {
    const response = await fetch(`${origin}/data`);
    return `ok ${response.status} ${await response.text()}`;
  } catch (error) {
    return `failed: ${error.message}`;
  }
}

// The order of an awaited promise against a then-chain on the same promise.
async function awaitOrder() {
  const log = [];
  const ready = Promise.resolve();
  async function waits() {
    await ready;
    log.push('await');
  }
  ready
    .then(() => log.push('t1'))
    .then(() => log.push('t2'))
    .then(() => log.push('t3'));
  waits();
  await new Promise((resolve) => setTimeout(resolve, 10));
  return log.join(',');
}

// fetch with an invalid header rejects; it never throws where it is called.
async function badHeader() {
  try {
    const pending = fetch('/probe/missing', { headers: { 'bad header': 'x' } });
    return await pending.then(
      () => 'resolved',
      (error) => `rejected ${error.name}`,
    );
  } catch (error) {
    return `threw synchronously ${error.name}`;
  }
}

// What the app can read of its own functions and the platform's.
function shapes() {
  const handler = () => [1, 2].map((x) => x * 2);
  const native = (fn) => /\[native code\]/u.test(Function.prototype.toString.call(fn));
  const request = new XMLHttpRequest();
  request.open('GET', '/probe/missing');
  return [
    `handler source: ${String(handler)}`,
    `Promise.then native: ${native(Promise.prototype.then)}`,
    `setTimeout native: ${native(window.setTimeout)}`,
    `fetch native: ${native(window.fetch)}`,
    `addEventListener native: ${native(EventTarget.prototype.addEventListener)}`,
    `XMLHttpRequest own keys: ${Object.keys(request).join(' ') || 'none'}`,
  ].join('; ');
}

// Many small calls in one click: the result must match; the time is overhead.
function hotLoop() {
  const add = (a, b) => a + b;
  let sum = 0;
  for (let index = 0; index < 200000; index += 1) sum = add(sum, index);
  return `sum ${sum}`;
}

// A request two continuations after the click.
async function delayed() {
  await new Promise((resolve) => setTimeout(resolve, 20));
  const response = await fetch('/probe/items?from=delayed');
  return `status ${response.status}`;
}

const CASES = [
  ['Self-removing listener', selfRemove],
  ['Once listeners', onceListeners],
  ['Cross-origin request', crossOrigin],
  ['Await order', awaitOrder],
  ['Invalid header', badHeader],
  ['Function shapes', shapes],
  ['Hot loop', hotLoop],
  ['Delayed request', delayed],
];

function App() {
  const [results, setResults] = useState({});
  const [loads, setLoads] = useState(0);
  const [items, setItems] = useState(null);
  useEffect(() => {
    if (loads === 0) return;
    fetch('/probe/items')
      .then((response) => response.json())
      .then(setItems);
  }, [loads]);
  const run = async (name, fn) => {
    let result;
    try {
      result = await fn();
    } catch (error) {
      result = `threw ${error?.name}`;
    }
    setResults((previous) => ({ ...previous, [name]: result }));
  };
  return (
    <main>
      <h1>circuit probe</h1>
      {CASES.map(([name, fn]) => (
        <section key={name}>
          <button onClick={() => run(name, fn)}>{name}</button>
          <p aria-label={`${name} result`}>{results[name] ?? 'not run'}</p>
        </section>
      ))}
      <section>
        <button onClick={() => setLoads((value) => value + 1)}>Load items</button>
        <ul>
          {items?.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
