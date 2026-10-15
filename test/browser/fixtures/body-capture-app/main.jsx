// Neutral fixture for request/response body capture (no product names).
// Each button exercises one body shape: a JSON POST carrying an entity id and
// credentials, a large JSON response, a text/plain response, a binary
// response, a streamed response the app reads itself, an XHR POST, a
// multipart upload, and JSON posted as text/plain with no content type.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';

// A cookie the page holds; Tracer must never record it.
document.cookie = 'sid=cookie-secret-123; path=/';
// Unhandled rejections the page sees (a fire-and-forget fetch must still raise one).
window.__unhandled = [];
window.addEventListener('unhandledrejection', event => { window.__unhandled.push(String(event.reason)); });

// Key-name redaction probe: which keys are secrets is decided by key segments.
const KEYS_BODY = {
  author: 'Ada', authorId: 'u_author', sessionId: 'sess_123', session: 'sess-secret', apiKey: 'apikey-secret', 'x-api-key': 'xapikey-secret',
  privateKey: 'private-secret', Password: 'Password-secret', access_token: 'access-secret', accesstoken: 'lower-secret', cardNumber: '4111111111111111',
  cardId: 'card_7', scorecard: 'A+', cardinality: 'high', cvv: '123-secret', otp: 'otp-secret', pin: 'pin-secret', jwt: 'jwt-secret', bearer: 'bearer-secret',
  maxTokenLimit: 4096, requiresAuth: true, tokenCount: 12, credentials: { user: 'cred-user', pass: 'cred-secret' },
  items: [{ itemId: 'it_1', token: 'arr-secret' }, [{ password: 'deep-arr-secret' }]],
  payload: JSON.stringify({ orderId: 'o_inner' }), note: 'plain note',
  numeric: { pin: 1234, otp: 482913, cvv: 123, cardNumber: 4111111111111111, secretAnswer: 42, passwordLength: 12, maxTokenLimit: 4096, tokenCount: 7, cardId: 7, requiresPin: false, tokenBudget: 8000, tokenUsage: 120, cardTotal: 3 },
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function App() {
  const [status, setStatus] = useState({});
  const show = (key, value) => setStatus(current => ({ ...current, [key]: value }));

  const rename = async () => {
    const response = await fetch('/api/projects/p_42/rename', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer secret-bearer-xyz' },
      body: JSON.stringify({ projectId: 'p_42', name: 'Renamed', password: 'hunter2-secret', owner: { userId: 'u_7', apiToken: 'tok_abc_secret' }, tags: ['a', 'b'] }),
    });
    const body = await response.json();
    show('rename', `saved ${body._id}`);
  };
  const loadReport = async () => {
    const body = await (await fetch('/api/report')).json();
    show('report', `${body.reportId}: ${body.rows.length} rows`);
  };
  const loadNotes = async () => show('notes', await (await fetch('/api/notes')).text());
  const loadAvatar = async () => {
    const blob = await (await fetch('/api/avatar')).blob();
    show('avatar', `${blob.type} ${blob.size} bytes`);
  };
  const streamLog = async () => {
    const response = await fetch('/api/stream');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let text = ''; let chunks = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks += 1; text += decoder.decode(value, { stream: true });
    }
    show('stream', `${text.trim().split('\n').length} lines (${chunks} chunks): ${text}`);
  };
  const xhrSave = () => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/items/i_9');
    xhr.setRequestHeader('content-type', 'application/json');
    xhr.onload = () => show('xhr', `xhr ${JSON.parse(xhr.responseText).id}`);
    xhr.send(JSON.stringify({ itemId: 'i_9', secretKey: 'xhr-secret-value', note: 'plain note' }));
  };
  const upload = async () => {
    const form = new FormData();
    form.append('label', 'photo-label');
    form.append('file', new Blob([new Uint8Array(1000).fill(7)], { type: 'application/octet-stream' }), 'photo.bin');
    const body = await (await fetch('/api/upload', { method: 'POST', body: form })).json();
    show('upload', `uploaded ${body.uploadId}`);
  };
  const postNote = async () => {
    // No content-type: fetch sends text/plain;charset=UTF-8.
    const body = await (await fetch('/api/notes', { method: 'POST', body: JSON.stringify({ noteId: 'n_3', authToken: 't_zz_secret', text: 'hello' }) })).json();
    show('note', `note ${body.noteId}`);
  };

  const postKeys = async () => {
    const body = await (await fetch('/api/keys', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(KEYS_BODY) })).json();
    show('keys', `echoed ${body.echoed}`);
  };
  const tickerCancel = async () => {
    const reader = (await fetch('/api/ticker')).body.getReader();
    let got = 0;
    for (let i = 0; i < 2; i += 1) { const { value } = await reader.read(); got += value.byteLength; }
    await reader.cancel();
    show('ticker', `read ${got} then cancelled`);
  };
  const longText = async () => { const text = await (await fetch('/api/longtext')).text(); show('longtext', `${text.length} chars ${text.slice(0, 3)}…${text.slice(-3)}`); };
  const deleteEntry = async () => { const response = await fetch('/api/entries/e_1', { method: 'DELETE' }); show('delete', `status ${response.status}`); };
  const untyped = async () => { const body = await (await fetch('/api/untyped')).json(); show('untyped', `untyped ${body.untypedId}`); };
  const blobRequest = async () => {
    // A Request object whose body is a typeless Blob: no content-type is sent.
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 255, 254, 0x41, 0x42]);
    const body = await (await fetch(new Request('/api/blob', { method: 'PUT', body: new Blob([bytes]) }))).json();
    show('blob', `server got ${body.received}`);
  };
  const pipeText = async () => {
    // The destination aborts through its signal after ~150 bytes.
    const response = await fetch('/api/pipe-text'); const controller = new AbortController(); let got = 0;
    const destination = new WritableStream({ write(chunk) { got += chunk.byteLength; if (got > 150) controller.abort(); } });
    try { await response.body.pipeTo(destination, { signal: controller.signal }); } catch { /* aborted */ }
    show('pipetext', 'aborted');
  };
  const pipeJson = async () => {
    // The destination errors after ~150 bytes of a JSON stream of unknown length.
    const response = await fetch('/api/pipe-json'); let got = 0;
    const destination = new WritableStream({ write(chunk, controller) { got += chunk.byteLength; if (got > 150) controller.error(new Error('destination full')); } });
    try { await response.body.pipeTo(destination); } catch { /* errored */ }
    show('pipejson', 'destination errored');
  };
  const orderProbe = async () => {
    // Microtask order around fetch settlement (kept out of the page output on purpose).
    const runs = {};
    { const order = []; const p = fetch('/api/quick').then(() => order.push('a')); Promise.resolve().then(() => order.push('b')); await p; runs.race = order.join(','); }
    { const order = []; const p = fetch('/api/quick'); await sleep(200); p.then(() => order.push('a')); Promise.resolve().then(() => order.push('b')); await sleep(10); runs.settled = order.join(','); }
    { const order = []; const p = fetch('/api/quick'); p.then(() => { order.push('a1'); Promise.resolve().then(() => order.push('a1-micro')); }); p.then(() => order.push('a2')); await p; await sleep(10); runs.same = order.join(','); }
    { const order = []; const controller = new AbortController();
      const p = fetch('/api/slow', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' }, signal: controller.signal });
      p.catch(() => order.push('fetch-rejected'));
      controller.signal.addEventListener('abort', () => Promise.resolve().then(() => order.push('listener-micro')));
      controller.abort(); Promise.resolve().then(() => order.push('b')); await sleep(20); runs.abort = order.join(','); }
    window.__order = runs;
    show('order', 'done');
  };
  // A .then chain on the fetch (response_of / "after response" marking must survive bodies on).
  const thenChain = () => fetch('/api/quick').then(function readQuick(response) { return response.json(); }).then(function showQuick(body) { show('thenchain', `quick ${body.quickId}`); });
  const fireAndForget = () => { fetch('http://127.0.0.1:9/refused'); show('fire', 'fired'); };

  return (
    <main>
      <button type="button" onClick={rename}>Rename project</button>
      <button type="button" onClick={loadReport}>Load report</button>
      <button type="button" onClick={loadNotes}>Load notes</button>
      <button type="button" onClick={loadAvatar}>Load avatar</button>
      <button type="button" onClick={streamLog}>Stream log</button>
      <button type="button" onClick={xhrSave}>XHR save</button>
      <button type="button" onClick={upload}>Upload</button>
      <button type="button" onClick={postNote}>Post note</button>
      <button type="button" onClick={postKeys}>Post keys</button>
      <button type="button" onClick={tickerCancel}>Ticker cancel</button>
      <button type="button" onClick={longText}>Long text</button>
      <button type="button" onClick={deleteEntry}>Delete entry</button>
      <button type="button" onClick={untyped}>Untyped</button>
      <button type="button" onClick={blobRequest}>Blob request</button>
      <button type="button" onClick={pipeText}>Pipe text</button>
      <button type="button" onClick={pipeJson}>Pipe JSON</button>
      <button type="button" onClick={orderProbe}>Order probe</button>
      <button type="button" onClick={thenChain}>Then chain</button>
      <button type="button" onClick={fireAndForget}>Fire and forget</button>
      <ul>
        {Object.entries(status).map(([key, value]) => <li key={key} data-status={key}>{value}</li>)}
      </ul>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
