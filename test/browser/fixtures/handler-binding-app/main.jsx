import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as Select from '@radix-ui/react-select';
import * as Dialog from '@radix-ui/react-dialog';
import { create } from 'zustand';
import { handleSubmit } from './vendor/form-lib.js';
import { Widget, ProxyPicker } from './vendor/widget.js';
import { useForm } from 'react-hook-form';

// Neutral fixture for D-G1-22 (the handler credited to a user event is the
// one that ran during that event's dispatch, observed, never inferred from a
// prop name). Each control is written the way an app would write it; none of
// it is shaped for Tracer. React decides which native event runs each prop:
// a checkbox's or radio's onChange runs on `click`, a text or range input's
// onChange on `input`, a <select>'s on `change`, onDoubleClick on `dblclick`,
// Radix Select's onValueChange on pointerup or keydown inside a portal, Radix
// Dialog's onOpenChange from Radix's own document listeners (Escape, a
// pointerdown on the overlay). A document capture-phase `click` listener
// (an audit hook) runs before every React click handler.

const send = (path, init) => fetch(path, init).catch(() => {});

// A global listener: document, capture phase, first-party, on every click.
const audited = [];
function useClickAudit() {
  useEffect(() => {
    function audit(event) { audited.push(event.target?.tagName || '?'); }
    document.addEventListener('click', audit, true);
    return () => document.removeEventListener('click', audit, true);
  }, []);
}

// (1) Native checkbox whose onChange only writes state (no request).
function NotifyToggle() {
  const [on, setOn] = useState(false);
  return (
    <label>
      <input type="checkbox" aria-label="Notify" checked={on} onChange={event => setOn(event.target.checked)} />
      <span>{on ? 'Notifications on' : 'Notifications off'}</span>
    </label>
  );
}

// (2) Native checkbox and radio group whose onChange send a request.
function Preferences() {
  const [subscribed, setSubscribed] = useState(false);
  const [plan, setPlan] = useState('free');
  const onSubscribe = event => { setSubscribed(event.target.checked); send(`/api/subscribe?checked=${event.target.checked}`, { method: 'POST' }); };
  const onPlan = event => { setPlan(event.target.value); send(`/api/plan?value=${event.target.value}`, { method: 'POST' }); };
  return (
    <fieldset>
      <legend>Preferences</legend>
      <input type="checkbox" aria-label="Subscribe" checked={subscribed} onChange={onSubscribe} />
      {['free', 'pro'].map(value => (
        <label key={value}><input type="radio" name="plan" aria-label={`Plan ${value}`} value={value} checked={plan === value} onChange={onPlan} />{value}</label>
      ))}
    </fieldset>
  );
}

// (3) Text input, <select> and range input: onChange each send a request.
function Fields() {
  const [title, setTitle] = useState('');
  const [volume, setVolume] = useState(5);
  const onTitle = event => { setTitle(event.target.value); send(`/api/title?length=${event.target.value.length}`); };
  const onColor = event => send(`/api/color?value=${event.target.value}`);
  const onVolume = event => { setVolume(Number(event.target.value)); send(`/api/volume?value=${event.target.value}`); };
  return (
    <section>
      <input aria-label="Title" value={title} onChange={onTitle} />
      <select aria-label="Color" defaultValue="red" onChange={onColor}>
        <option value="red">red</option><option value="blue">blue</option><option value="green">green</option>
      </select>
      <input type="range" aria-label="Volume" min={0} max={10} value={volume} onChange={onVolume} />
    </section>
  );
}

// (4) Double-click to edit: onDoubleClick only writes state (no request).
function RenameLabel() {
  const [editing, setEditing] = useState(false);
  return <div role="button" tabIndex={0} aria-label="Project name" onDoubleClick={() => setEditing(true)}>{editing ? 'Editing…' : 'Project Alpha'}</div>;
}

// (5) A search form: Enter in the field (onKeyDown) submits (onSubmit).
function SearchForm() {
  const [lastKey, setLastKey] = useState('');
  const onKeyDown = event => { if (event.key === 'Enter') setLastKey('Enter'); };
  const onSubmit = event => { event.preventDefault(); send(`/api/search?q=${encodeURIComponent(new FormData(event.currentTarget).get('q'))}`); };
  return (
    <form aria-label="Search" onSubmit={onSubmit}>
      <input name="q" aria-label="Query" onKeyDown={onKeyDown} />
      <button type="submit">Search</button>
      <span>{lastKey}</span>
    </form>
  );
}

// (6) Radix Select (controlled): Radix calls onValueChange from its item's
// pointerup or keydown handler, in a portal.
function FruitSelect() {
  const [value, setValue] = useState('');
  const onValueChange = next => { setValue(next); send(`/api/fruit?value=${encodeURIComponent(next)}`); };
  return (
    <Select.Root value={value} onValueChange={onValueChange}>
      <Select.Trigger aria-label="Fruit"><Select.Value placeholder="Pick a fruit" /></Select.Trigger>
      <Select.Portal>
        <Select.Content position="popper" sideOffset={4}>
          <Select.Viewport>
            {['apple', 'banana', 'cherry'].map(fruit => <Select.Item key={fruit} value={fruit}><Select.ItemText>{fruit}</Select.ItemText></Select.Item>)}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}

// (7) Radix Dialog (controlled): Radix calls onOpenChange from the trigger's
// click, and to dismiss from its document keydown (Escape) and document
// pointerdown (outside the content, on the overlay) listeners.
function DeleteDialog() {
  const [open, setOpen] = useState(false);
  const closes = useRef(0);
  const onOpenChange = next => { setOpen(next); if (!next) { closes.current += 1; send(`/api/dialog-closed?n=${closes.current}`, { method: 'POST' }); } };
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Trigger>Delete…</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay data-testid="overlay" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)' }} />
        <Dialog.Content aria-describedby={undefined} style={{ position: 'fixed', top: 20, left: 20, width: 200, background: 'white' }}>
          <Dialog.Title>Delete this item?</Dialog.Title>
          <button type="button">Keep</button>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// (8) zustand: onClick only writes the store; a subscriber's effect syncs it.
const useCart = create(set => ({ count: 0, add: () => set(state => ({ count: state.count + 1 })) }));
function CartButton() {
  const add = useCart(state => state.add);
  return <button type="button" onClick={() => add()}>Add to cart</button>;
}
function CartBadge() {
  const count = useCart(state => state.count);
  useEffect(() => { if (count > 0) send(`/api/cart-sync?count=${count}`, { method: 'POST' }); }, [count]);
  return <span aria-label="Cart count">{count}</span>;
}

// (9) A declared handler that never runs (no context menu is ever opened),
// beside an onClick that does.
function ArchiveButton() {
  const [menu, setMenu] = useState(false);
  return <button type="button" onContextMenu={event => { event.preventDefault(); setMenu(true); }} onClick={() => send('/api/archive', { method: 'POST' })}>{menu ? 'Menu' : 'Archive'}</button>;
}

// (10) onFocus invoked by app code, not by a user: a click handler that calls
// .focus() on another field, and a timer after mount that does the same.
function FocusFields() {
  const noteRef = useRef(null), searchRef = useRef(null);
  const onNoteFocus = () => send('/api/note-focused', { method: 'POST' });
  const onSearchFocus = () => send('/api/autofocus-seen', { method: 'POST' });
  useEffect(() => { const timer = setTimeout(() => searchRef.current?.focus(), 250); return () => clearTimeout(timer); }, []);
  return (
    <section>
      <button type="button" onClick={() => noteRef.current.focus()}>Write a note</button>
      <input ref={noteRef} aria-label="Note" onFocus={onNoteFocus} />
      <input ref={searchRef} aria-label="Quick search" onFocus={onSearchFocus} />
    </section>
  );
}

// (11) A prop a component calls from a timer (no dispatch at all).
function Ticker({ onTick }) {
  useEffect(() => { const timer = setTimeout(() => onTick(1), 150); return () => clearTimeout(timer); }, [onTick]);
  return null;
}
const onTick = count => { document.title = `ticked ${count}`; };

// (12) contenteditable with onInput.
function Scratchpad() {
  const onInput = event => send(`/api/scratch?length=${event.currentTarget.textContent.length}`);
  return <div contentEditable suppressContentEditableWarning role="textbox" aria-label="Scratchpad" onInput={onInput} style={{ border: '1px solid #aaa', minHeight: 20 }} />;
}

// (14) A form library's submit handler (not instrumented) awaits validation,
// then calls the callback written inside onSubmit; it only writes state.
function ProfileForm() {
  const [saved, setSaved] = useState('');
  return (
    <form aria-label="Profile" onSubmit={handleSubmit(values => setSaved(values.name))}>
      <input name="name" aria-label="Name" defaultValue="Ada" />
      <button type="submit">Save profile</button>
      <span>{saved ? `Saved ${saved}` : ''}</span>
    </form>
  );
}

// (15) One function held by two props of one button, a leaf with no event
// parameter (framed in its body, so its arguments are not seen): which prop
// React invoked is not observable, so the binding is ambiguous. (A function
// the build wraps in a call proxy passes its first argument even without a
// parameter, and resolves like (16).)
function DualNoArg() {
  const [hits, setHits] = useState(0);
  const handleDual = () => setHits(hits + 1);
  return <button type="button" onKeyDown={handleDual} onClick={handleDual}>Dual {hits}</button>;
}
// (16) The same, with an event parameter: React's SyntheticEvent names the prop.
function DualEvent() {
  const [hits, setHits] = useState(0);
  const handleDualEvent = event => setHits(count => count + (event.type ? 1 : 0));
  return <button type="button" onKeyDown={handleDualEvent} onClick={handleDualEvent}>Dual event {hits}</button>;
}
// (17) onPointerDown and onClick share a function that sends (no event parameter).
function DualSend() {
  const sendDual = () => send('/api/dual-send', { method: 'POST' });
  return <button type="button" onPointerDown={sendDual} onClick={sendDual}>Dual send</button>;
}
// (18) Target onMouseDown and ancestor onClick hold one function (event parameter).
function NestedMixed() {
  const [c, setC] = useState(0);
  const handleNested = event => setC(x => x + (event.type ? 1 : 0));
  return <div aria-label="Nested mixed" onClick={handleNested}><button type="button" onMouseDown={handleNested}>Nested mixed {c}</button></div>;
}
// (19) Target and ancestor both onClick with one function (event parameter): React runs it twice.
function NestedTwice() {
  const [c, setC] = useState(0);
  const handleTwice = event => setC(x => x + (event.currentTarget ? 1 : 0));
  return <div aria-label="Nested twice" onClick={handleTwice}><button type="button" onClick={handleTwice}>Nested twice {c}</button></div>;
}
// (20) A document capture-phase listener that sends analytics for clicks in
// its section, ahead of a sending button and a state-only button.
function AnalyticsSection() {
  const [n, setN] = useState(0);
  useEffect(() => {
    function track(event) { if (event.target?.closest?.('[data-analytics]')) send(`/api/analytics?tag=${event.target.tagName}`, { method: 'POST' }); }
    // The same kind of listener on document.body (page-level, not the element's).
    function trackBody(event) { if (event.target?.closest?.('[data-analytics]')) send(`/api/analytics-body?tag=${event.target.tagName}`, { method: 'POST' }); }
    document.addEventListener('click', track, true);
    document.body.addEventListener('click', trackBody, true);
    return () => { document.removeEventListener('click', track, true); document.body.removeEventListener('click', trackBody, true); };
  }, []);
  const onSaveReal = () => send('/api/real', { method: 'POST' });
  const onStateOnly = () => setN(x => x + 1);
  return <section data-analytics="yes"><button type="button" onClick={onSaveReal}>Save real</button><button type="button" onClick={onStateOnly}>State only {n}</button></section>;
}
// (20b) The bound handler sends first; a body bubble listener sends later.
function BodyBubbleSection() {
  useEffect(() => {
    function bodyBubble(event) {
      if (event.target?.closest?.('[data-body-bubble]')) send('/api/body-bubble', { method: 'POST' });
    }
    document.body.addEventListener('click', bodyBubble, false);
    return () => document.body.removeEventListener('click', bodyBubble, false);
  }, []);
  const saveBubble = () => send('/api/save-bubble', { method: 'POST' });
  return <section data-body-bubble="yes"><button type="button" onClick={saveBubble}>Save then bubble</button></section>;
}
// (21) react-hook-form with a named callback that only writes state.
function RhfNamed() {
  const { register, handleSubmit: rhfSubmit } = useForm({ defaultValues: { title: 'Draft' } });
  const [saved, setSaved] = useState('');
  const onValid = values => setSaved(values.title);
  return (
    <form aria-label="RHF named" onSubmit={rhfSubmit(onValid)}>
      <input aria-label="Draft name" {...register('title')} />
      <button type="submit">Save RHF</button>
      <span>{saved}</span>
    </form>
  );
}
// (22) An uninstrumented component calling a callback prop (not on*).
function WidgetCallback() {
  const [picked, setPicked] = useState(0);
  const viaCallback = value => setPicked(value);
  return <section><Widget label="Widget callback" callback={viaCallback} /><span>{picked}</span></section>;
}
// (23) el.click() from app code: from a timer a user click armed, and from a mount timer.
function ProgrammaticClick() {
  const target = useRef(null);
  const [n, setN] = useState(0);
  const onTargetClick = event => { setN(x => x + 1); send(`/api/programmatic?trusted=${event.nativeEvent.isTrusted}`, { method: 'POST' }); };
  const schedule = () => { setTimeout(() => target.current.click(), 100); };
  useEffect(() => { const timer = setTimeout(() => target.current.click(), 350); return () => clearTimeout(timer); }, []);
  return <section><button type="button" onClick={schedule}>Schedule click</button><button type="button" ref={target} onClick={onTargetClick}>Click target {n}</button></section>;
}

// (24) The same function as ancestor onClickCapture and target onClick (event parameter): React runs it twice, capture then bubble.
function CaptureAndTarget() {
  const [v, setV] = useState(0);
  const handleTwoPhases = event => setV(x => x + (event.eventPhase ? 1 : 0));
  return <div aria-label="Capture ancestor" onClickCapture={handleTwoPhases}><button type="button" onClick={handleTwoPhases}>Capture and target {v}</button></div>;
}
// (25) One div holds the same function as onClickCapture and onClick; the click lands on a child.
function BothPhasesOneDiv() {
  const [log, setLog] = useState('');
  const handleBothPhases = event => setLog(l => `${l}${event.eventPhase}`);
  return <div aria-label="Both phases" onClickCapture={handleBothPhases} onClick={handleBothPhases}><button type="button">Both phases {log}</button></div>;
}
// (26) Ancestor onClickCapture={h} onKeyDown={h}, target onClick={g}: h binds onClickCapture; the credit is g, the nearer.
function CaptureOnlyAncestor() {
  const [n, setN] = useState(0);
  const handleCaptureOnly = event => setN(x => x + (event.eventPhase ? 1 : 0));
  const handleTargetOwn = event => setN(x => x + (event.type ? 10 : 0));
  return <div aria-label="Capture only" onClickCapture={handleCaptureOnly} onKeyDown={handleCaptureOnly}><button type="button" onClick={handleTargetOwn}>Capture only {n}</button></div>;
}
// (27) A Proxy-backed argument: a vendor component calls onSelect(store) where
// the same function is the ancestor div's onClick. Tracer's read of the
// argument must create no evidence (its trap entries are not recorded).
globalThis.__proxyLog = [];
const proxyStore = new Proxy({ id: 7 }, {
  get(target, key) { globalThis.__proxyLog.push(`get:${String(key)}`); return Reflect.get(target, key); },
  has(target, key) { globalThis.__proxyLog.push(`has:${String(key)}`); return Reflect.has(target, key); },
  getOwnPropertyDescriptor(target, key) { globalThis.__proxyLog.push(`gopd:${String(key)}`); return Reflect.getOwnPropertyDescriptor(target, key); },
});
function ProxyArea() {
  const [picked, setPicked] = useState(0);
  const choose = value => setPicked(p => p + (value ? 1 : 0));
  return <div aria-label="Proxy area" onClick={choose}><ProxyPicker label="Proxy pick" store={proxyStore} onSelect={choose} /><span>{picked}</span></div>;
}

// (13) A plain button whose onClick sends a request (the audit listener runs first).
function Ping() {
  return <button type="button" onClick={() => send('/api/ping', { method: 'POST' })}>Ping</button>;
}

function App() {
  useClickAudit();
  return (
    <main>
      <NotifyToggle />
      <Preferences />
      <Fields />
      <RenameLabel />
      <SearchForm />
      <FruitSelect />
      <DeleteDialog />
      <CartButton /><CartBadge />
      <ArchiveButton />
      <FocusFields />
      <Ticker onTick={onTick} />
      <Scratchpad />
      <Ping />
      <ProfileForm />
      <DualNoArg /><DualEvent /><DualSend /><NestedMixed /><NestedTwice />
      <AnalyticsSection /><BodyBubbleSection /><RhfNamed /><WidgetCallback /><ProgrammaticClick />
      <CaptureAndTarget /><BothPhasesOneDiv /><CaptureOnlyAncestor /><ProxyArea />
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
