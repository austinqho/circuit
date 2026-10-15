import { useEffect, useReducer, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useForm } from 'react-hook-form';

// Neutral fixture for G1 continuations: state-update receipts, await
// resumptions, and negative controls that overlap every action.
//
// Unowned work is armed at load and fires *through* each click: a 1 ms
// interval runs from load to the end of the session; every pointerdown (not a
// tracked action event, so it creates no action) opens a 300 ms window in
// which each tick drives the negative controls. The ticks therefore run
// between pointerdown and click, during the click's dispatch task queue, and
// after it.

let windowUntil = 0, pollUntil = 0;
document.addEventListener('pointerdown', () => { windowUntil = performance.now() + 300; }, true);
// A one-shot timer armed BEFORE a click (at the click's pointerdown, which is
// not a tracked action) and firing after the click's dispatch.
let preArm = false;
document.addEventListener('pointerdown', () => { if (!preArm) return; preArm = false; setTimeout(() => { fetch('/api/pre-armed'); }, 60); }, true);
globalThis.__armPreClickTimer = () => { preArm = true; };
// An unowned MessageChannel pump started at load. After the nested-focus click
// it creates a promise reaction from its own (unowned) task: that reaction
// must not pick up anything the click left behind.
let leakProbe = false;
const pump = new MessageChannel();
pump.port1.onmessage = () => {
  if (leakProbe) { leakProbe = false; Promise.resolve().then(() => fetch('/api/nested-leak')); }
  setTimeout(() => pump.port2.postMessage(null), 5);
};
pump.port2.postMessage(null);
// The click follows pointerup in the same input sequence: poll on every tick
// for 25 ms from pointerup, across the click's dispatch and the tasks after it.
document.addEventListener('pointerup', () => { pollUntil = performance.now() + 25; }, true);
function pollOnce() { fetch('/api/poll'); }
const hooks = { sibling: null, p1: null, p1f: null, p2: null };
let ticks = 0, windowTicks = 0;
const ticker = setInterval(() => {
  ticks += 1;
  if (ticks > 20000) clearInterval(ticker);
  if (performance.now() > windowUntil) return;
  windowTicks += 1;
  // A first-party function calling fetch from an unowned timer.
  if (performance.now() <= pollUntil) pollOnce();
  hooks.sibling?.(windowTicks);
  hooks.p1?.(windowTicks);
  hooks.p1f?.(windowTicks);
  hooks.p2?.(windowTicks);
}, 1);
globalThis.__fixtureTicks = () => ({ ticks, windowTicks });

const nextFrame = () => new Promise(resolve => requestAnimationFrame(() => resolve()));

async function authenticatedPost(url) {
  await nextFrame();
  const token = await Promise.resolve('t');
  return fetch(url, { method: 'POST', headers: { authorization: token } });
}

function Unrelated() {
  // No deps: re-runs whenever its parent re-renders; an existing child that
  // re-renders gets nothing from its parent's receipt.
  useEffect(() => { fetch('/api/unrelated'); });
  return <span>child</span>;
}

function Mounted({ url }) {
  // Mount effect of a fiber created by the commit it is part of.
  useEffect(() => { fetch(url); }, [url]);
  return <em>mounted</em>;
}

// A sibling of Delayed driven by the unowned ticker. It re-renders during the
// action windows and mounts a child in a tick commit (no receipt).
function Sibling() {
  const [tick, setTick] = useState(0);
  useEffect(() => { hooks.sibling = setTick; return () => { hooks.sibling = null; }; }, []);
  useEffect(() => { if (tick) fetch('/api/sibling'); }, [tick]);
  return <span>{tick}{tick >= 40 ? <Mounted url="/api/late-mount" /> : null}</span>;
}

function Delayed() {
  const [count, setCount] = useState(0);
  useEffect(() => { if (count > 0) fetch('/api/state-effect'); }, [count]);
  // The update is issued from a timer continuation of the click, so React
  // commits it in a later scheduler task, outside the dispatch.
  return (
    <div>
      <button type="button" onClick={() => setTimeout(() => setCount(value => value + 1), 0)}>Delayed update</button>
      <Unrelated />
      {count > 0 ? <Mounted url="/api/mounted" /> : null}
    </div>
  );
}

// P1: a no-op setter. React bails out and does not render; a later unowned
// tick re-renders the component. Its effect must not be attributed.
function P1() {
  const [open, setOpen] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => { hooks.p1 = value => { if (globalThis.__p1) setTick(value); }; return () => { hooks.p1 = null; }; }, []);
  useEffect(() => { if (tick) fetch('/api/p1-tick'); }, [tick]);
  return <button type="button" onClick={() => { setOpen(false); globalThis.__p1 = true; }}>P1 {String(open)}</button>;
}

// P1f: a functional no-op updater (`setOpen(o => false)` while false). React
// bails out; a later unowned tick re-renders the component. Not attributed.
function P1f() {
  const [open, setOpen] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => { hooks.p1f = value => { if (globalThis.__p1f) setTick(value); }; return () => { hooks.p1f = null; }; }, []);
  useEffect(() => { if (tick) fetch('/api/p1f-tick'); }, [tick]);
  return <button type="button" onClick={() => { setOpen(o => false); globalThis.__p1f = true; }}>Functional no-op {String(open)}</button>;
}

// P2: two setters in one handler. The action's own effect is attributed; a
// later tick-driven commit of the same component is not.
function P2() {
  const [a, setA] = useState(0);
  const [, setB] = useState(0);
  const [tick, setTick] = useState(0);
  useEffect(() => { hooks.p2 = value => { if (globalThis.__p2) setTick(value); }; return () => { hooks.p2 = null; }; }, []);
  useEffect(() => { if (a) fetch('/api/p2-a'); }, [a]);
  useEffect(() => { if (tick) fetch('/api/p2-tick'); }, [tick]);
  return <button type="button" onClick={() => { setA(value => value + 1); setB(value => value + 1); globalThis.__p2 = true; }}>P2</button>;
}

function reducer(state, action) { return action === 'submit' ? { submitted: state.submitted + 1 } : state; }

function Submitter() {
  const [state, dispatch] = useReducer(reducer, { submitted: 0 });
  useEffect(() => {
    if (!state.submitted) return;
    const run = async () => { await authenticatedPost('/api/submit'); };
    run();
  }, [state.submitted]);
  return <button type="button" onClick={() => setTimeout(() => dispatch('submit'), 0)}>Submit via reducer</button>;
}

function Awaiter() {
  const onClick = async () => {
    await nextFrame();
    await fetch('/api/after-await');
  };
  return <button type="button" onClick={onClick}>Await then fetch</button>;
}

async function failLater() {
  await nextFrame();
  throw new Error('rejected on purpose');
}

// Rejected awaits: the catch block runs under the frame current at the await.
function Rejecter() {
  const onClick = async () => {
    await nextFrame();
    try { await Promise.reject(new Error('rejected on purpose')); } catch { fetch('/api/after-reject'); }
    try { await failLater(); } catch { fetch('/api/after-throw'); }
  };
  return <button type="button" onClick={onClick}>Reject then fetch</button>;
}

// A programmatic focus inside a mount effect dispatches a trusted focusin
// (a nested action); the effect's own frame resumes after it.
function AutoFocus() {
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); fetch('/api/after-focus'); }, []);
  return <input aria-label="Autofocus field" ref={ref} />;
}

function Focuser() {
  const [show, setShow] = useState(false);
  return <div><button type="button" onClick={() => setTimeout(() => setShow(true), 0)}>Show autofocus</button>{show ? <AutoFocus /> : null}</div>;
}

function Shortcuts() {
  const [panel, setPanel] = useState(false);
  useEffect(() => {
    // A global (document) listener: not bound to any element the user acts on.
    function onShortcut(event) { if (event.ctrlKey && event.key === 'm') setPanel(value => !value); }
    document.addEventListener('keydown', onShortcut);
    return () => document.removeEventListener('keydown', onShortcut);
  }, []);
  return <section>{panel ? <p>panel open</p> : null}<button type="button" onClick={() => setPanel(value => !value)}>Toggle panel</button></section>;
}

function NativeListener() {
  const ref = useRef(null);
  const [count, setCount] = useState(0);
  useEffect(() => {
    // A native listener on the element itself: element-bound, not global.
    const node = ref.current;
    function onNativeKey() { setCount(value => value + 1); }
    node.addEventListener('keydown', onNativeKey);
    return () => node.removeEventListener('keydown', onNativeKey);
  }, []);
  return <label>Native <input aria-label="Native field" ref={ref} readOnly value={String(count)} /></label>;
}

// Form-library pattern: react-hook-form's handleSubmit (library code, no
// first-party frame open) awaits async validation and only then calls the
// app's onSubmit. The continuation is created while the submit's bare
// dispatch frame is current, so the fetch belongs to the submit.
function LibraryForm() {
  const { register, handleSubmit } = useForm({ defaultValues: { title: 'x' } });
  const onSubmit = async () => { await fetch('/api/form-submit', { method: 'POST' }); };
  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <input aria-label="Form title" {...register('title', { validate: async value => { await new Promise(resolve => setTimeout(resolve, 30)); return Boolean(value); } })} />
      <button type="submit">Library submit</button>
    </form>
  );
}

// A callback created inside action A runs after action B started: it belongs
// to A (timer and promise reaction both).
function CrossActions() {
  return (
    <div>
      <button type="button" onClick={() => {
        setTimeout(() => { fetch('/api/cross-timer'); }, 250);
        new Promise(resolve => setTimeout(resolve, 250)).then(() => fetch('/api/cross-promise'));
      }}>Arm A</button>
      <button type="button" onClick={() => { globalThis.__actionB = (globalThis.__actionB || 0) + 1; }}>Action B</button>
    </div>
  );
}

// Nested dispatch: a programmatic focus inside a click handler dispatches a
// trusted focusin; the click's frame is restored after it, and nothing of it
// survives the dispatch (the pump's later reaction is unowned).
// The button's handler ends right after focus() (as LibreChat's
// ChatForm handleContainerClick does), so the nested focusin frame is still on
// top when the handler returns. The parent's bubbling onClick then runs in the
// same click dispatch and must see the click's own frame, not the handler that
// already returned.
function NestedFocus() {
  const ref = useRef(null);
  const onClick = () => { ref.current?.focus(); leakProbe = true; };
  return (
    <div onClick={() => { fetch('/api/nested-after-focus'); }}>
      <input aria-label="Nested target" ref={ref} onFocus={() => {}} />
      <button type="button" onClick={onClick}>Nested focus</button>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<main><Delayed /><Sibling /><P1 /><P1f /><P2 /><Submitter /><Awaiter /><Rejecter /><Focuser /><Shortcuts /><NativeListener /><LibraryForm /><CrossActions /><NestedFocus /></main>);
