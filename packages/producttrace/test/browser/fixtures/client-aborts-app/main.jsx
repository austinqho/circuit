// Neutral fixture: a page that aborts its own requests. No product names.
//  - a TanStack Query search box whose query key changes per keystroke (the
//    previous query's fetch is aborted through the `signal` TanStack passes);
//  - a plain AbortController with a Cancel button;
//  - an abort after the response headers, before the app reads the body;
//  - an abort (with an Error of the app's own as the reason) while the app
//    is reading the body;
//  - an abort after the app already read the body (has no effect);
//  - queryClient.cancelQueries on a slow query;
//  - an aborted request the server answers 500 (the app's own Error as the reason);
//  - one click with an aborted write and then a read it did not abort;
//  - an XMLHttpRequest aborted with xhr.abort();
//  - a save whose status the app used (body never read), aborted later by a
//    cleanup: the response had reached the app, so it is not an aborted request;
//  - a fetch whose signal was already aborted (never sent);
//  - an XMLHttpRequest stopped by window.stop() (no abort() call);
//  - a body read through a stream reader, cut off by a Stop (abort) mid-stream;
//  - a body read through a stream reader to its end, then aborted (no effect);
//  - a body read that failed (the server dropped the connection) before a cleanup abort.
import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
class ReadDeadline extends Error {}

async function searchItems({ queryKey, signal }) {
  const response = await fetch(`/api/search?q=${encodeURIComponent(queryKey[1])}`, { signal });
  return response.json();
}

function SearchBox() {
  const [term, setTerm] = useState('');
  const results = useQuery({ queryKey: ['search', term], queryFn: searchItems, enabled: term.length > 0 });
  return (
    <section aria-label="Search">
      <input aria-label="Search items" data-testid="search" value={term} onChange={event => setTerm(event.target.value)} />
      <output data-testid="search-results">{results.data ? `${results.data.term}: ${results.data.items.join(', ') || 'none'}` : results.isFetching ? 'searching' : ''}</output>
    </section>
  );
}

async function loadReport({ signal }) {
  const response = await fetch('/api/report', { signal });
  return response.json();
}

function Report() {
  const client = useQueryClient();
  const [wanted, setWanted] = useState(false);
  const report = useQuery({ queryKey: ['report'], queryFn: loadReport, enabled: wanted });
  return (
    <section aria-label="Report">
      <button type="button" data-testid="report-load" onClick={() => setWanted(true)}>Load report</button>
      <button type="button" data-testid="report-cancel" onClick={() => client.cancelQueries({ queryKey: ['report'] })}>Cancel report</button>
      <output data-testid="report-status">{`${report.status}/${report.fetchStatus}`}</output>
    </section>
  );
}

function Requests() {
  const [status, setStatus] = useState('idle');
  const plain = useRef(null);

  async function startPlain() {
    plain.current = new AbortController();
    setStatus('plain loading');
    try {
      const response = await fetch('/api/slow?case=plain', { signal: plain.current.signal });
      const body = await response.json();
      setStatus(`plain done ${body.case}`);
    } catch (error) { setStatus(`plain ${error.name}`); }
  }
  function cancelPlain() { plain.current?.abort(); }

  async function headersThenAbort() {
    const controller = new AbortController();
    const response = await fetch('/api/drip', { signal: controller.signal });
    setStatus(`drip headers ${response.status}`);
    controller.abort();
    try { await response.text(); setStatus('drip read'); } catch (error) { setStatus(`drip body ${error.name}`); }
  }

  async function abortWhileReading() {
    const controller = new AbortController();
    const response = await fetch('/api/drip?case=reading', { signal: controller.signal });
    setTimeout(() => controller.abort(new ReadDeadline('read took too long')), 150);
    try { await response.text(); setStatus('reading done'); } catch (error) { setStatus(`reading ${error instanceof ReadDeadline ? 'deadline' : error.name}`); }
  }

  async function readThenAbort() {
    const controller = new AbortController();
    const response = await fetch('/api/fast?case=consumed', { signal: controller.signal });
    const body = await response.json();
    setStatus(`consumed ${body.case}`);
    controller.abort();
  }

  async function failThenAbort() {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new ReadDeadline('answer took too long')), 120);
    try { await fetch('/api/fail-slow', { signal: controller.signal }); setStatus('fail answered'); } catch (error) { setStatus(`fail ${error instanceof ReadDeadline ? 'deadline' : error.name}`); }
  }

  async function saveAndReload() {
    const save = new AbortController();
    const saving = fetch('/api/notes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'draft' }), signal: save.signal })
      .then(() => 'saved', error => error.name);
    await wait(150);
    save.abort();
    const saved = await saving;
    const reload = new AbortController();
    const response = await fetch('/api/notes', { signal: reload.signal });
    const notes = await response.json();
    setStatus(`save ${saved}; notes ${notes.count}`);
  }

  async function saveThenCleanup() {
    const controller = new AbortController();
    const response = await fetch('/api/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'kept' }), signal: controller.signal });
    if (response.ok) setStatus(`saved ${response.status}`);
    setTimeout(() => controller.abort(), 300);
  }

  async function alreadyAborted() {
    const controller = new AbortController();
    controller.abort();
    try { await fetch('/api/slow?case=pre', { signal: controller.signal }); setStatus('pre sent'); } catch (error) { setStatus(`pre ${error.name}`); }
  }

  function xhrStopped() {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', '/api/slow?case=stop');
    xhr.addEventListener('abort', () => setStatus('stop abort event'));
    xhr.addEventListener('load', () => setStatus(`stop ${xhr.status}`));
    xhr.send();
    setTimeout(() => window.stop(), 120);
  }

  async function streamThenStop() {
    const controller = new AbortController();
    const response = await fetch('/api/drip?case=stream', { signal: controller.signal });
    const reader = response.body.getReader();
    setTimeout(() => controller.abort(), 150);
    try { for (;;) { const { done } = await reader.read(); if (done) break; } setStatus('stream done'); } catch (error) { setStatus(`stream ${error.name}`); }
  }

  async function streamThenAbort() {
    const controller = new AbortController();
    const response = await fetch('/api/fast?case=stream-consumed', { signal: controller.signal });
    const reader = response.body.getReader();
    let bytes = 0;
    for (;;) { const { done, value } = await reader.read(); if (done) break; bytes += value.byteLength; }
    setStatus(`streamed ${bytes > 0 ? 'bytes' : 'nothing'}`);
    controller.abort();
  }

  async function brokenThenAbort() {
    const controller = new AbortController();
    try {
      const response = await fetch('/api/broken', { signal: controller.signal });
      await response.text(); setStatus('broken read');
    } catch (error) { setStatus(`broken ${error.name}`); } finally { controller.abort(); }
  }

  function xhrThenAbort() {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', '/api/slow?case=xhr');
    xhr.addEventListener('abort', () => setStatus('xhr aborted'));
    xhr.addEventListener('load', () => setStatus(`xhr ${xhr.status}`));
    xhr.send();
    setTimeout(() => xhr.abort(), 120);
  }

  return (
    <section aria-label="Requests">
      <button type="button" data-testid="plain-start" onClick={startPlain}>Start</button>
      <button type="button" data-testid="plain-cancel" onClick={cancelPlain}>Cancel</button>
      <button type="button" data-testid="drip" onClick={headersThenAbort}>Headers then abort</button>
      <button type="button" data-testid="drip-reading" onClick={abortWhileReading}>Abort while reading</button>
      <button type="button" data-testid="consumed" onClick={readThenAbort}>Read then abort</button>
      <button type="button" data-testid="fail-slow" onClick={failThenAbort}>Slow failure</button>
      <button type="button" data-testid="save-reload" onClick={saveAndReload}>Save and reload</button>
      <button type="button" data-testid="xhr" onClick={xhrThenAbort}>XHR</button>
      <button type="button" data-testid="save-cleanup" onClick={saveThenCleanup}>Save then clean up</button>
      <button type="button" data-testid="pre-aborted" onClick={alreadyAborted}>Already aborted</button>
      <button type="button" data-testid="xhr-stop" onClick={xhrStopped}>XHR stopped</button>
      <button type="button" data-testid="stream-stop" onClick={streamThenStop}>Stream then stop</button>
      <button type="button" data-testid="stream-consumed" onClick={streamThenAbort}>Stream to the end then abort</button>
      <button type="button" data-testid="broken" onClick={brokenThenAbort}>Broken body then abort</button>
      <output data-testid="status">{status}</output>
    </section>
  );
}

function App() {
  return (<QueryClientProvider client={queryClient}><SearchBox /><Report /><Requests /></QueryClientProvider>);
}

createRoot(document.getElementById('root')).render(<App />);
