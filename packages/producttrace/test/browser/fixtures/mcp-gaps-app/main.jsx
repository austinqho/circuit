// Neutral fixture (no product names) for "the MCP says everything the records
// already know": an optimistic like whose 409 is rolled back in a .catch, a
// canvas click that hit-tests five shapes and misses, a form that validates
// client side, a status poll armed at page load, a GET with a query string,
// and a flag an uninstrumented inline script watches (see index.html body).
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

const SHAPES = [
  { x: 10, y: 10, w: 20, h: 20 }, { x: 40, y: 10, w: 20, h: 20 }, { x: 70, y: 10, w: 20, h: 20 },
  { x: 100, y: 10, w: 20, h: 20 }, { x: 130, y: 10, w: 20, h: 20 },
];

function hitTest(shape, x, y) {
  return x >= shape.x && x <= shape.x + shape.w && y >= shape.y && y <= shape.y + shape.h;
}

function pollStatus() {
  return fetch('/api/status?client=fixture').then(response => response.json());
}

// A page-load poll that awaits before it fetches (first-party, outside every action).
async function refreshAfterTick() {
  await Promise.resolve();
  return fetch('/api/refresh');
}

function factorial(n) {
  return n <= 1 ? 1 : n * factorial(n - 1);
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function validateForm(values) {
  const errors = [];
  if (!values.title.trim()) errors.push('Title is required');
  if (!values.email.includes('@')) errors.push('Email is invalid');
  return errors;
}

function App() {
  const [liked, setLiked] = useState(false);
  const [notice, setNotice] = useState('');
  const [picked, setPicked] = useState('none');
  const [values, setValues] = useState({ title: '', email: '' });
  const [errors, setErrors] = useState([]);
  const [saved, setSaved] = useState(null);
  const [items, setItems] = useState([]);
  const [flag, setFlag] = useState('off');

  useEffect(() => {
    const timer = setInterval(pollStatus, 300);
    const refresher = setInterval(refreshAfterTick, 700);
    return () => { clearInterval(timer); clearInterval(refresher); };
  }, []);

  function rollbackLike(error) {
    setLiked(false);
    setNotice(error.message);
  }

  function noteDelay() {
    setNotice(value => value);
  }

  function onLike() {
    setLiked(true);
    fetch('/api/items/7/like', { method: 'POST' })
      .then(response => { if (!response.ok) throw new Error(`like failed ${response.status}`); return response.json(); })
      .catch(error => rollbackLike(error));
    // A sibling continuation of onLike that runs after the response but is not chained on it.
    wait(250).then(noteDelay);
  }

  function bodyLoaded() {
    setNotice('body loaded');
  }

  // The nested form bundlers emit from `const r = await fetch(u); await r.json();`.
  async function loadBody() {
    await (await fetch('/api/body')).json();
    bodyLoaded();
  }

  function onFactorial() {
    setNotice(String(factorial(5)));
  }

  function onCanvasClick(event) {
    const box = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - box.left; const y = event.clientY - box.top;
    let hit = -1;
    for (let index = 0; index < SHAPES.length; index += 1) if (hitTest(SHAPES[index], x, y)) hit = index;
    setPicked(hit < 0 ? 'miss' : `shape ${hit}`);
  }

  function showErrors(list) {
    setErrors(list);
  }

  function onSubmit(event) {
    event.preventDefault();
    const list = validateForm(values);
    if (list.length) { showErrors(list); return; }
    setErrors([]);
    fetch('/api/submissions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(values) })
      .then(response => response.json()).then(body => setSaved(body.id));
  }

  function loadItems() {
    fetch('/api/items?ids=1,2,3&view=compact#top').then(response => response.json()).then(body => setItems(body.items));
  }

  function onSync() {
    setFlag(value => (value === 'on' ? 'off' : 'on'));
  }

  return (
    <main>
      <section>
        <button type="button" aria-label="Like" onClick={onLike}>{liked ? '♥' : '♡'}</button>
        <p>{notice}</p>
      </section>
      <section>
        <canvas width="160" height="40" aria-label="Shapes" onClick={onCanvasClick} />
        <p>{picked}</p>
      </section>
      <form onSubmit={onSubmit}>
        <input name="title" value={values.title} onChange={event => setValues({ ...values, title: event.target.value })} />
        <input name="email" value={values.email} onChange={event => setValues({ ...values, email: event.target.value })} />
        <button type="submit">Save entry</button>
        {errors.length ? <ul role="alert">{errors.map(error => <li key={error}>{error}</li>)}</ul> : null}
        {saved ? <p>Saved {saved}</p> : null}
      </form>
      <section>
        <button type="button" onClick={loadItems}>Load items</button>
        <ul>{items.map(item => <li key={item.id}>{item.name}</li>)}</ul>
      </section>
      <section>
        <button type="button" onClick={onSync}>Sync</button>
        <p data-sync-flag={flag}>{flag}</p>
        <button type="button" onClick={onFactorial}>Factorial</button>
        <button type="button" onClick={loadBody}>Load body</button>
        <button type="button" onClick={() => setNotice('first')}>More</button>
        <button type="button" onClick={() => setNotice('second')}>More</button>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
