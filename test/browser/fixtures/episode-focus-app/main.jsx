import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';

// Neutral fixture for the episode-focus rule: a focus that happens as part of
// one action's work belongs to that action, never to a later keypress on the
// focused control; a user's own focus (Tab) still folds into the next action
// on the same control.

// (a) "Remove" opens a portal confirm dialog whose button takes focus on mount
// through React's autoFocus; Enter in the dialog sends the DELETE.
function AutoFocusDialog({ label, onConfirm, onClose }) {
  const onKeyDown = event => {
    if (event.key === 'Enter') { event.preventDefault(); onConfirm(); onClose(); }
    if (event.key === 'Escape') onClose();
  };
  return createPortal(
    <div role="dialog" aria-label={label} onKeyDown={onKeyDown}>
      <p>Remove this item? Press Enter to confirm.</p>
      <button type="button" autoFocus>Confirm {label}</button>
    </div>, document.body);
}

function RemoveAuto() {
  const [open, setOpen] = useState(false);
  return (
    <section>
      <span>Item auto</span>
      <button type="button" onClick={() => setOpen(true)}>Remove auto</button>
      {open && <AutoFocusDialog label="auto" onConfirm={() => { fetch('/api/items/auto', { method: 'DELETE' }); }} onClose={() => setOpen(false)} />}
    </section>
  );
}

// (b) The same, but the dialog focuses itself from a mount effect.
function EffectFocusDialog({ label, onConfirm, onClose }) {
  const ref = useRef(null);
  useEffect(() => { ref.current.focus(); }, []);
  const onKeyDown = event => {
    if (event.key === 'Enter') { event.preventDefault(); onConfirm(); onClose(); }
    if (event.key === 'Escape') onClose();
  };
  return createPortal(
    <div role="dialog" aria-label={label} tabIndex={-1} ref={ref} onKeyDown={onKeyDown}>
      <p>Remove this item? Press Enter to confirm.</p>
    </div>, document.body);
}

function RemoveEffect() {
  const [open, setOpen] = useState(false);
  return (
    <section>
      <span>Item effect</span>
      <button type="button" onClick={() => setOpen(true)}>Remove effect</button>
      {open && <EffectFocusDialog label="effect" onConfirm={() => { fetch('/api/items/effect', { method: 'DELETE' }); }} onClose={() => setOpen(false)} />}
    </section>
  );
}

// (c) A click on control A moves focus to input B inside its handler; a later
// Enter in B sends B's own request.
function MoveFocus() {
  const inputRef = useRef(null);
  const onKeyDown = event => {
    if (event.key === 'Enter') { event.preventDefault(); fetch('/api/notes', { method: 'POST', body: event.currentTarget.value }); }
  };
  return (
    <section>
      <button type="button" onClick={() => { inputRef.current.focus(); }}>Jump to note</button>
      <input aria-label="Note" ref={inputRef} onKeyDown={onKeyDown} />
    </section>
  );
}

// (d) Control: the user Tabs from a button into a search input and presses
// Enter; the trusted focus has no owning action, so it folds into the Enter.
function TabSearch() {
  const onKeyDown = event => {
    if (event.key === 'Enter') { event.preventDefault(); fetch('/api/search', { method: 'POST', body: event.currentTarget.value }); }
  };
  return (
    <section>
      <button type="button">Before search</button>
      <input aria-label="Search" onKeyDown={onKeyDown} />
    </section>
  );
}

// (e) The dialog opens only after a request resolves (a non-discrete update,
// rendered by React's scheduler, not in the click's own microtask), and its
// button takes focus through autoFocus; Enter sends the DELETE.
function RemoveLater() {
  const [open, setOpen] = useState(false);
  const onClick = () => { fetch('/api/items/later/check').then(() => setOpen(true)); };
  return (
    <section>
      <span>Item later</span>
      <button type="button" onClick={onClick}>Remove later</button>
      {open && <AutoFocusDialog label="later" onConfirm={() => { fetch('/api/items/later', { method: 'DELETE' }); }} onClose={() => setOpen(false)} />}
    </section>
  );
}

// (g) A click starts reading a streamed response with `for await` (a native
// suspension the await rewrite does not cover); while the stream is open the
// user Tabs into an input and presses Enter. The click's code is suspended,
// not running: the Tab focus is the user's and must fold into the Enter.
function StreamTab() {
  const onClick = async () => {
    const res = await fetch('/api/stream/a');
    let size = 0;
    for await (const chunk of res.body) size += chunk.length;
    document.title = `read ${size}`;
  };
  const onKeyDown = event => { if (event.key === 'Enter') { event.preventDefault(); fetch('/api/stream/a/search', { method: 'POST' }); } };
  return (
    <section>
      <button type="button" onClick={onClick}>Stream a</button>
      <button type="button">Before stream a</button>
      <input aria-label="Stream a input" onKeyDown={onKeyDown} />
    </section>
  );
}

// (h) The same through a first-party async generator consumed with for await.
async function* chunksOf(body) { for await (const chunk of body) yield chunk; }
function StreamGeneratorTab() {
  const onClick = async () => { const res = await fetch('/api/stream/b'); for await (const chunk of chunksOf(res.body)) void chunk; };
  const onKeyDown = event => { if (event.key === 'Enter') { event.preventDefault(); fetch('/api/stream/b/search', { method: 'POST' }); } };
  return (
    <section>
      <button type="button" onClick={onClick}>Stream b</button>
      <button type="button">Before stream b</button>
      <input aria-label="Stream b input" onKeyDown={onKeyDown} />
    </section>
  );
}

// (i) An idle-callback poll armed at mount (by no action) calls a
// first-party helper that focuses an input when a page flag is set. While a
// stream click has left its frame behind (for await), the flag is set from
// outside the app: the poll's code runs now, but its action would only come
// from the left-behind frame, so the focus is not credited to the click.
// (i-control) the same flag with no stream open.
function focusField(element) { element.focus(); }
function IdlePoll() {
  const input = useRef(null);
  useEffect(() => {
    let handle = 0;
    const poll = () => { if (window.__episodeFocusPoll) { window.__episodeFocusPoll = false; focusField(input.current); } handle = requestIdleCallback(poll, { timeout: 50 }); };
    handle = requestIdleCallback(poll, { timeout: 50 });
    return () => cancelIdleCallback(handle);
  }, []);
  const onClick = async () => { const res = await fetch('/api/stream/i'); for await (const chunk of res.body) void chunk; };
  const onKeyDown = event => { if (event.key === 'Enter') { event.preventDefault(); fetch('/api/poll/search', { method: 'POST' }); } };
  return (
    <section>
      <button type="button" onClick={onClick}>Stream i</button>
      <input aria-label="Poll input" ref={input} onKeyDown={onKeyDown} />
    </section>
  );
}

// (j) After a for-await loop ends, the click's own code focuses through the
// same first-party helper. It runs on the frame the loop left behind, which
// the runtime cannot tell apart from (i): not a gesture, cause abstained.
function AfterStream() {
  const input = useRef(null);
  const onClick = async () => { const res = await fetch('/api/stream/j'); for await (const chunk of res.body) void chunk; focusField(input.current); };
  const onKeyDown = event => { if (event.key === 'Enter') { event.preventDefault(); fetch('/api/after/search', { method: 'POST' }); } };
  return (
    <section>
      <button type="button" onClick={onClick}>Stream j</button>
      <input aria-label="After input" ref={input} onKeyDown={onKeyDown} />
    </section>
  );
}

createRoot(document.getElementById('root')).render(<main><RemoveAuto /><RemoveEffect /><MoveFocus /><TabSearch /><RemoveLater /><StreamTab /><StreamGeneratorTab /><IdlePoll /><AfterStream /></main>);
