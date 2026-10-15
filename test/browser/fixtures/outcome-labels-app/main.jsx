// Neutral fixture (no product names) for outcome labels: one control per
// outcome the rows can evidence. Nothing here knows about Tracer.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';

const TAKEN = new Set(['B']);

function parseStrict(text) {
  if (!text) throw new SyntaxError('empty input');
  return JSON.parse(text);
}

function App() {
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const send = (url, init) => fetch(url, init).then(response => { setStatus(`${url} answered ${response.status}`); });
  const post = (url, body = {}) => send(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  const createItem = () => { post('/api/items', { title: 'first' }); };
  const ping = () => { send('/api/ping'); };
  const claimSeat = () => { post('/api/seats/A/claim'); };
  const saveProfile = () => { post('/api/profile', {}); };
  const buildReport = () => { post('/api/reports'); };
  const untraced = () => { send('/api/untraced'); };
  const writeThenFail = () => { post('/api/items', { batch: 1 }); post('/api/reports'); };
  const lookup = () => { post('/api/lookup', { seat: 'A' }); };
  const readSeats = () => { send('/api/seats'); };
  // The page gives up on a slow write after 100 ms (the server still writes and answers 201).
  const abandonWrite = () => {
    const controller = new AbortController();
    send('/api/slow-items', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slow: true }), signal: controller.signal })
      .catch(() => setStatus('write abandoned'));
    setTimeout(() => controller.abort(), 100);
  };
  // Both submit with nothing sent; neither is a rejection (no browser validation ran).
  const saveDraft = event => { event.preventDefault(); setStatus('draft kept locally'); };
  const nextStep = event => { event.preventDefault(); setStatus('step 2'); };
  // The grader's inner-step probes: the next step renders inside the same form.
  const [innerStep, setInnerStep] = useState(1);
  const [innerStepValidated, setInnerStepValidated] = useState(1);
  const nextInside = event => { event.preventDefault(); setInnerStep(2); };
  const nextInsideValidated = event => { event.preventDefault(); setInnerStepValidated(2); };
  // Hit-test: the seat under the pointer is already taken, so nothing is sent.
  const pickSeat = event => {
    const cell = event.target.closest('[data-seat]');
    const seat = cell ? cell.getAttribute('data-seat') : null;
    if (!seat || TAKEN.has(seat)) { setStatus(`Seat ${seat} is taken`); return; }
    post(`/api/seats/${seat}/claim`);
  };
  const throwNow = () => {
    const rows = null;
    setStatus(`rows: ${rows.length}`);
  };
  const rejectLater = async () => {
    await Promise.resolve();
    throw new RangeError('rejected later');
  };
  const caughtByApp = () => {
    try { parseStrict(''); } catch { setStatus('could not parse'); }
  };
  const submitProfile = event => {
    event.preventDefault();
    if (!name.trim()) { setError('Name is required'); return; }
    post('/api/items', { name });
  };
  const subscribe = event => { event.preventDefault(); post('/api/items', { subscribe: true }); };

  return (
    <main>
      <button type="button" data-testid="create" onClick={createItem}>Create item</button>
      <button type="button" data-testid="ping" onClick={ping}>Ping</button>
      <button type="button" data-testid="claim" onClick={claimSeat}>Claim seat A</button>
      <button type="button" data-testid="profile" onClick={saveProfile}>Save profile</button>
      <button type="button" data-testid="report" onClick={buildReport}>Build report</button>
      <button type="button" data-testid="untraced" onClick={untraced}>Untraced</button>
      <button type="button" data-testid="write-then-fail" onClick={writeThenFail}>Write then fail</button>
      <button type="button" data-testid="lookup" onClick={lookup}>Look up seat</button>
      <button type="button" data-testid="read-seats" onClick={readSeats}>Read seats</button>
      <button type="button" data-testid="abandon" onClick={abandonWrite}>Abandon slow write</button>
      <div role="grid" aria-label="Seats" data-testid="seats" onClick={pickSeat}>
        <span role="gridcell" data-seat="B">Seat B</span>
      </div>
      <button type="button" data-testid="throw" onClick={throwNow}>Throw</button>
      <button type="button" data-testid="reject" onClick={rejectLater}>Reject</button>
      <button type="button" data-testid="caught" onClick={caughtByApp}>Caught</button>
      <form aria-label="Profile" noValidate onSubmit={submitProfile}>
        <input aria-label="Name" required value={name} onChange={event => setName(event.target.value)} />
        <button type="submit" data-testid="profile-submit">Submit profile</button>
        {error ? <p role="alert">{error}</p> : null}
      </form>
      <form aria-label="Subscribe" onSubmit={subscribe}>
        <input aria-label="Email" type="email" required />
        <button type="submit" data-testid="subscribe">Subscribe</button>
      </form>
      <form aria-label="Draft" onSubmit={saveDraft}>
        <input aria-label="Title" required />
        <button type="submit" formNoValidate data-testid="save-draft">Save draft</button>
      </form>
      <form aria-label="Wizard" noValidate onSubmit={nextStep}>
        <input aria-label="Later field" required />
        <button type="submit" data-testid="wizard-next">Next</button>
      </form>
      <form aria-label="Inner wizard" noValidate onSubmit={nextInside}>
        <input aria-label="Step one field" defaultValue="x" />
        {innerStep === 2 ? <input aria-label="Step two field" /> : null}
        <button type="submit" data-testid="inner-next">Next inside</button>
      </form>
      <form aria-label="Inner wizard validated" onSubmit={nextInsideValidated}>
        <input aria-label="Step one filled" defaultValue="y" required />
        {innerStepValidated === 2 ? <p>Step 2 of 3</p> : null}
        <button type="submit" data-testid="inner-next-validated">Next inside validated</button>
      </form>
      <p role="status">{status}</p>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
