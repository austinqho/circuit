// Neutral fixture for "Tracer never claims more coverage or completeness than
// its rows prove" (fix/honest-coverage). No product names. The page has:
//   - a plain save (request → handler → one DB write, nothing further);
//   - a Radix Dialog rendered in a portal whose confirm button sends a request
//     whose server handler calls a second route with Node's fetch (not
//     instrumented: the second route starts a new root trace, an escaped hop);
//   - an export whose handler calls an external service over node:http (an
//     outbound client span no server span continues);
//   - a panel toggle that sends nothing, while an uninstrumented script
//     (public/vendor.js) fetches from a listener for an event kind the
//     runtime does not listen to (chosen at run time by the driver);
//   - two iframes (same origin, and a different port) and a Web Worker;
//   - a sendBeacon on pagehide (public/vendor.js);
//   - a frame inserted 50 ms after a click (another origin) and removed 400 ms
//     later (a realm that exists only between check points);
//   - a WebSocket message sent by a click; the socket server then writes
//     through the API with no trace context.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as Dialog from '@radix-ui/react-dialog';

const worker = new Worker('/worker.js');
worker.onmessage = () => {};
const socket = new WebSocket(`${location.origin.replace(/^http/u, 'ws')}/ws`);

function showFrameBriefly() {
  setTimeout(() => {
    const frame = document.createElement('iframe');
    frame.title = 'Brief frame'; frame.src = `${globalThis.__externalOrigin}/frame.html`;
    document.body.appendChild(frame);
    setTimeout(() => frame.remove(), 400);
  }, 50);
}
function pingSocket() { socket.send('go'); }

async function post(path, body) {
  const response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return response.status;
}

function SyncDialog({ onDone }) {
  const [open, setOpen] = useState(false);
  async function confirmSync() {
    const status = await post('/api/sync', { scope: 'all' });
    onDone(`sync ${status}`);
    setOpen(false);
  }
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild><button type="button">Sync</button></Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.2)' }} />
        <Dialog.Content aria-describedby={undefined} style={{ position: 'fixed', top: 40, left: 40, background: 'white', padding: 16 }}>
          <Dialog.Title>Sync everything?</Dialog.Title>
          <button type="button" onClick={confirmSync}>Confirm sync</button>
          <Dialog.Close asChild><button type="button">Cancel</button></Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function App() {
  const [status, setStatus] = useState('idle');
  const [panelOpen, setPanelOpen] = useState(false);
  async function saveNote() { setStatus(`save ${await post('/api/notes', { text: 'hello' })}`); }
  async function exportAll() { setStatus(`export ${await post('/api/export', { format: 'csv' })}`); }
  function togglePanel() { setPanelOpen(value => !value); }
  return (
    <main>
      <p role="status">{status}</p>
      <button type="button" onClick={saveNote}>Save note</button>
      <SyncDialog onDone={setStatus} />
      <button type="button" onClick={exportAll}>Export</button>
      <button type="button" onClick={async () => setStatus(`batch ${await post('/api/batch', {})}`)}>Batch</button>
      <button type="button" onClick={async () => setStatus(`seq ${await post('/api/seq', {})}`)}>Seq</button>
      <button type="button" onClick={showFrameBriefly}>Show frame</button>
      <button type="button" onClick={pingSocket}>Ping socket</button>
      <button type="button" onClick={togglePanel}>Open panel</button>
      <section id="notes-panel" aria-label="Notes panel" style={{ marginTop: 40, width: 300, height: 120, border: '1px solid #999' }}>
        {panelOpen ? <p>Panel open</p> : <p>Panel closed</p>}
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
