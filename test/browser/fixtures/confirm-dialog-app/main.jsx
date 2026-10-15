import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';

// Neutral fixture for the no-cross-control rule: a button that only opens a
// confirmation dialog (rendered in a portal) and a keyboard action inside
// that dialog that sends the request. The opener and the dialog are different
// controls, so they must be different episodes. The negative control is an
// ordinary form: typing then submitting is one episode.

// (A) Opener outside any form; the dialog handles Enter itself.
function KeyDialog({ onConfirm, onClose, label }) {
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); }, []);
  const onKeyDown = event => {
    if (event.key === 'Enter') { event.preventDefault(); onConfirm(); onClose(); }
    if (event.key === 'Escape') onClose();
  };
  return createPortal(
    <div role="dialog" aria-label={label} tabIndex={-1} ref={ref} onKeyDown={onKeyDown}>
      <p>Remove this item? Press Enter to confirm.</p>
    </div>, document.body);
}

function RemoveAlpha() {
  const [open, setOpen] = useState(false);
  return (
    <section>
      <span>Alpha</span>
      <button type="button" aria-haspopup="dialog" onClick={() => setOpen(true)}>Remove alpha</button>
      {open && <KeyDialog label="Confirm alpha" onConfirm={() => { fetch('/api/items/alpha', { method: 'DELETE' }); }} onClose={() => setOpen(false)} />}
    </section>
  );
}

// (B) Opener inside a form; the dialog (portal) is not inside that form.
// The form's own submit (Save beta) later sends a request of its own.
function RemoveBeta() {
  const [open, setOpen] = useState(false);
  return (
    <form aria-label="Beta settings" onSubmit={event => { event.preventDefault(); fetch('/api/beta', { method: 'POST' }); }}>
      <input aria-label="Beta title" name="title" />
      <button type="button" aria-haspopup="dialog" onClick={() => setOpen(true)}>Remove beta</button>
      <button type="submit">Save beta</button>
      {open && <KeyDialog label="Confirm beta" onConfirm={() => { fetch('/api/items/beta', { method: 'DELETE' }); }} onClose={() => setOpen(false)} />}
    </form>
  );
}

// (C) Opener outside any form; the dialog (portal) holds its own form and
// Enter in its field submits it.
function RemoveGamma() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => { if (open) ref.current?.focus(); }, [open]);
  return (
    <section>
      <span>Gamma</span>
      <button type="button" onClick={() => setOpen(true)}>Remove gamma</button>
      {open && createPortal(
        <div role="dialog" aria-label="Confirm gamma">
          <form aria-label="Confirm gamma form" onSubmit={event => { event.preventDefault(); fetch('/api/items/gamma', { method: 'DELETE' }); setOpen(false); }}>
            <input aria-label="Type gamma to confirm" ref={ref} />
            <button type="submit">Delete</button>
          </form>
        </div>, document.body)}
    </section>
  );
}

// Negative control: typing then submitting one form is one episode.
function AddItem() {
  const onSubmit = event => { event.preventDefault(); fetch('/api/items', { method: 'POST', body: new FormData(event.currentTarget).get('name') }); };
  return (
    <form aria-label="Add item" onSubmit={onSubmit}>
      <input aria-label="Item name" name="name" />
      <button type="submit">Add</button>
    </form>
  );
}

createRoot(document.getElementById('root')).render(<main><RemoveAlpha /><RemoveBeta /><RemoveGamma /><AddItem /></main>);
