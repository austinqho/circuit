import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as Select from '@radix-ui/react-select';
import * as Dialog from '@radix-ui/react-dialog';

// Neutral fixture for D-G1-21 (every trusted user event is recorded). Each
// control's request is issued from the event kind a real app would use; none
// of it is shaped for Tracer. Radix Select and Dialog render in portals and
// drive selection with pointer events; the canvas drag, the hidden file
// input, the document shortcut, the scroll list, clipboard, <details> and a
// plain native <select> each own one request.

const send = (path, init) => fetch(path, init).catch(() => {});

// (1) Radix Select: the trigger opens on pointerdown; an item is chosen on
// pointerup inside the portal listbox.
function FruitSelect() {
  const [value, setValue] = useState('');
  return (
    <section>
      <Select.Root value={value} onValueChange={next => { setValue(next); send(`/api/choice?value=${encodeURIComponent(next)}`); }}>
        <Select.Trigger aria-label="Fruit"><Select.Value placeholder="Pick a fruit" /></Select.Trigger>
        <Select.Portal>
          <Select.Content position="popper" sideOffset={4}>
            <Select.Viewport>
              {['apple', 'banana', 'cherry'].map(fruit => <Select.Item key={fruit} value={fruit}><Select.ItemText>{fruit}</Select.ItemText></Select.Item>)}
            </Select.Viewport>
          </Select.Content>
        </Select.Portal>
      </Select.Root>
    </section>
  );
}

// (2) Radix Dialog: opened by its trigger, confirmed by a button inside the
// portal, dismissed with Escape (Radix listens for keydown on the document).
function ArchiveDialog() {
  const [open, setOpen] = useState(false);
  const onOpenChange = next => { setOpen(next); if (!next) send('/api/dialog-dismissed'); };
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Trigger>Archive…</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content aria-describedby={undefined}>
          <Dialog.Title>Archive this project?</Dialog.Title>
          <button type="button" onClick={() => send('/api/archive', { method: 'POST' })}>Confirm archive</button>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// (3) Canvas drag with pointer capture; the request is sent on pointerup by
// a window listener registered in an effect (the drag's own release).
function DragCanvas() {
  const ref = useRef(null);
  const drag = useRef(null);
  useEffect(() => {
    function onPointerUp(event) {
      const start = drag.current; if (!start) return;
      drag.current = null;
      send('/api/drag', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dx: Math.round(event.clientX - start.x), dy: Math.round(event.clientY - start.y) }) });
    }
    window.addEventListener('pointerup', onPointerUp);
    return () => window.removeEventListener('pointerup', onPointerUp);
  }, []);
  const onPointerDown = event => { event.currentTarget.setPointerCapture(event.pointerId); drag.current = { x: event.clientX, y: event.clientY }; };
  return <canvas ref={ref} aria-label="Board" width={240} height={120} style={{ border: '1px solid #999', touchAction: 'none' }} onPointerDown={onPointerDown} />;
}

// (4) A visible button clicks a hidden file input; its change uploads.
function Upload() {
  const input = useRef(null);
  const onChange = event => {
    const file = event.target.files?.[0]; if (!file) return;
    const body = new FormData(); body.append('file', file);
    send('/api/upload', { method: 'POST', body });
  };
  return (
    <section>
      <button type="button" onClick={() => input.current.click()}>Upload file</button>
      <input ref={input} type="file" aria-label="File" style={{ display: 'none' }} onChange={onChange} />
    </section>
  );
}

// (5) A document keyboard shortcut with modifiers.
function Shortcut() {
  const [saved, setSaved] = useState(0);
  useEffect(() => {
    function onKeyDown(event) {
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'k') { event.preventDefault(); setSaved(count => count + 1); send('/api/shortcut', { method: 'POST' }); }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);
  return <p>Saved with shortcut: {saved}</p>;
}

// (6) A scrolling list that loads more once scrolled past a threshold.
function Feed() {
  const [loaded, setLoaded] = useState(false);
  const onScroll = event => { if (!loaded && event.currentTarget.scrollTop > 150) { setLoaded(true); send('/api/more'); } };
  return (
    <div role="list" aria-label="Feed" onScroll={onScroll} style={{ height: 120, overflow: 'auto', border: '1px solid #ccc' }}>
      {Array.from({ length: 60 }, (_, index) => <div role="listitem" key={index}>Row {index}</div>)}
    </div>
  );
}

// (7) Clipboard: copy from one field, paste into another.
function Clipboard() {
  const [copied, setCopied] = useState(false);
  return (
    <section>
      <input aria-label="Source" defaultValue="ticket-42" onCopy={() => setCopied(true)} />
      <input aria-label="Target" onPaste={() => send('/api/pasted', { method: 'POST' })} />
      {copied ? <span>copied</span> : null}
    </section>
  );
}

// (8) <details>: toggling it open records the state.
function Disclosure() {
  return (
    <details onToggle={event => send(`/api/details?open=${event.currentTarget.open}`)}>
      <summary>More options</summary>
      <p>Hidden options</p>
    </details>
  );
}

// (9) Plain cases: a native <select> and a text field (no library).
function Plain() {
  return (
    <section>
      <select aria-label="Size" defaultValue="m" onChange={event => send(`/api/size?value=${event.target.value}`)}>
        <option value="s">S</option><option value="m">M</option><option value="l">L</option>
      </select>
      <input aria-label="Note" />
      <input aria-label="Secret" type="password" />
      <button type="button" onClick={() => send('/api/ping')}>Ping</button>
    </section>
  );
}

// (10) A synthetic click by live code on another visible control; the user
// later reaches that control with Tab (the link must not survive).
function Opener() {
  const target = useRef(null);
  return (
    <section>
      <button type="button" onClick={() => target.current.click()}>Open B</button>
      <button type="button" ref={target} onClick={() => send('/api/b')}>Target B</button>
    </section>
  );
}

// (11) A click whose meaning depends on a held modifier.
function ShiftTarget() {
  return <button type="button" onClick={event => send(`/api/shift?shift=${event.shiftKey}`)}>Shift target</button>;
}

// (12) Hover work: entering the card prefetches (work runs under the hover).
function HoverCard() {
  return <div role="note" aria-label="Hover card" style={{ padding: 8, border: '1px dashed #999' }} onMouseEnter={() => send('/api/prefetch')}>Hover card</div>;
}

// (13) Touch: a button that acts on touchend.
function TouchButton() {
  return <button type="button" onTouchEnd={() => send('/api/touchend')}>Tap me</button>;
}

// (14) HTML drag and drop.
function DragDrop() {
  return (
    <section>
      <div draggable aria-label="Drag card" role="button" tabIndex={0} onDragStart={event => event.dataTransfer.setData('text/plain', 'card')}>Drag card</div>
      <div aria-label="Drop zone" role="region" style={{ width: 160, height: 60, border: '1px solid #999' }}
        onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); send('/api/drop'); }}>Drop zone</div>
    </section>
  );
}

// (15) Kinds with no UIEvent interface: history, hash, validity; React
// onBeforeInput (dispatched from textInput).
function Navigation() {
  useEffect(() => {
    const onPop = () => send('/api/popstate');
    const onHash = () => send('/api/hash');
    window.addEventListener('popstate', onPop); window.addEventListener('hashchange', onHash);
    return () => { window.removeEventListener('popstate', onPop); window.removeEventListener('hashchange', onHash); };
  }, []);
  return (
    <section>
      <button type="button" onClick={() => history.pushState({ step: 2 }, '', '?step=2')}>Next step</button>
      <a href="#section">Section</a>
      <form aria-label="Required form" onSubmit={event => event.preventDefault()}>
        <input aria-label="Required field" required onInvalid={() => send('/api/invalid')} />
        <button type="submit">Check</button>
      </form>
      <input aria-label="Tagged" onBeforeInput={() => send('/api/beforeinput')} />
    </section>
  );
}

// (16) Work run by code a click calls: el.focus() fires a native focus
// listener; requestSubmit() fires the form's submit.
function CausedWork() {
  const field = useRef(null), form = useRef(null);
  useEffect(() => {
    const node = field.current; const onFocus = () => send('/api/native-focused');
    node.addEventListener('focus', onFocus); return () => node.removeEventListener('focus', onFocus);
  }, []);
  return (
    <section>
      <input aria-label="Focus target" ref={field} />
      <button type="button" onClick={() => field.current.focus()}>Focus field</button>
      <form aria-label="Programmatic form" ref={form} onSubmit={event => { event.preventDefault(); send('/api/submitted', { method: 'POST' }); }}>
        <button type="button" onClick={() => form.current.requestSubmit()}>Submit by code</button>
      </form>
    </section>
  );
}

// (17) ?grid=1: 240 plain cells for the hover-heavy measurement.
function Grid() {
  if (!new URLSearchParams(location.search).has('grid')) return null;
  return <div aria-label="Grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(24, 40px)' }}>{Array.from({ length: 240 }, (_, index) => <div key={index} style={{ height: 20, border: '1px solid #eee' }}>{index}</div>)}</div>;
}

function SelectableText() {
  return <div aria-label="Selection probe" style={{ width: 280, padding: 8, userSelect: 'text' }}>Select these words with the pointer to test gesture ownership.</div>;
}

function App() {
  return (
    <main>
      <Grid />
      <FruitSelect />
      <ArchiveDialog />
      <DragCanvas />
      <Upload />
      <Shortcut />
      <Feed />
      <Clipboard />
      <Disclosure />
      <Plain />
      <Opener />
      <ShiftTarget />
      <SelectableText />
      <HoverCard />
      <TouchButton />
      <DragDrop />
      <Navigation />
      <CausedWork />
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
