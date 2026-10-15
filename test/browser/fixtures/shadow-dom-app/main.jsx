import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

// Neutral fixture for dispatch context across shadow roots.
//
// <share-chip> is a first-party custom element with an OPEN shadow root. Its
// inner button's click listener is registered by first-party code in
// connectedCallback and dispatches a composed, bubbling `share` CustomEvent
// from the host. The React tree listens for `share` with native listeners
// added in an effect, on the host (ref) and on an ancestor; both fetch.
//
// <lock-chip> has a CLOSED shadow root: composedPath() seen from the document
// stops at the host. Its inner handler makes no request.
//
// "Refresh" is an ordinary React button outside both elements.
//
// Re-registered listeners: <ReshareCard> registers its native listeners in an
// effect whose dependency changes on every render (`[onReshare]`, `[onPing]`).
// "Bump" updates state, so the listeners are removed and re-added inside
// Bump's commit and are owned by Bump (creation time). A later trusted click
// on the second <share-chip> (shadow root) or on "Ping" (light DOM) dispatches
// the event those listeners handle; the dispatching click must win. A
// `pointerdown` listener on Ping, re-added the same way, starts no action and
// must run under none. "Focus it" calls el.focus() inside its click on a
// span whose `focus` listener was re-added under Bump: the click wins.
// "Later" arms a timer that dispatches `share` on that
// chip (credited to Later, the dispatcher); a timer armed at load does the
// same when asked (credited to nothing).

class ShareChip extends HTMLElement {
  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = '<span class="label">Item</span> <button type="button" class="share">Share item</button>';
    this.shareCount = 0;
  }

  connectedCallback() {
    if (this.wired) return;
    this.wired = true;
    this.shadowRoot.querySelector('button').addEventListener('click', event => this.onShareClick(event));
  }

  onShareClick() {
    this.shareCount += 1;
    this.dispatchEvent(new CustomEvent('share', { composed: true, bubbles: true, detail: { item: this.getAttribute('item'), count: this.shareCount } }));
  }
}
customElements.define('share-chip', ShareChip);

class LockChip extends HTMLElement {
  #root;

  constructor() {
    super();
    this.#root = this.attachShadow({ mode: 'closed' });
    this.#root.innerHTML = '<button type="button" class="lock">Lock item</button>';
  }

  connectedCallback() {
    if (this.wired) return;
    this.wired = true;
    this.#root.querySelector('button').addEventListener('click', () => this.toggleLock());
  }

  toggleLock() {
    this.toggleAttribute('locked');
  }
}
customElements.define('lock-chip', LockChip);

function ShareCard({ item }) {
  const chipRef = useRef(null);
  const cardRef = useRef(null);
  useEffect(() => {
    const chip = chipRef.current, card = cardRef.current;
    const sendShare = event => {
      fetch('/api/share', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(event.detail) });
    };
    const countShare = () => { fetch('/api/share-count'); };
    chip.addEventListener('share', sendShare);
    card.addEventListener('share', countShare);
    return () => { chip.removeEventListener('share', sendShare); card.removeEventListener('share', countShare); };
  }, []);
  return (
    <section className="card" ref={cardRef}>
      <h2>{item}</h2>
      <share-chip ref={chipRef} item={item}></share-chip>
      <lock-chip style={{ display: 'inline-block' }}></lock-chip>
    </section>
  );
}

const reshareChip = () => document.querySelector('share-chip[item="beta"]');
const programmaticShare = src => reshareChip()?.dispatchEvent(new CustomEvent('share', { composed: true, bubbles: true, detail: { src } }));
let loadTimerArmed = false;
globalThis.__fireLoadTimer = () => { loadTimerArmed = true; };
setInterval(() => { if (!loadTimerArmed) return; loadTimerArmed = false; programmaticShare('load'); }, 20);

function ReshareCard() {
  const chipRef = useRef(null);
  const pingRef = useRef(null);
  const [bumps, setBumps] = useState(0);
  const onReshare = event => { fetch(`/api/reshare${event.detail?.src ? `-${event.detail.src}` : ''}`, { method: 'POST', body: JSON.stringify(event.detail) }); };
  const onPing = () => { fetch('/api/ping'); };
  const onPingDown = () => { fetch('/api/ping-down'); };
  const focusRef = useRef(null);
  const onFocused = () => { fetch('/api/focused'); };
  useEffect(() => {
    const chip = chipRef.current;
    chip.addEventListener('share', onReshare);
    return () => chip.removeEventListener('share', onReshare);
  }, [onReshare]);
  useEffect(() => {
    const ping = pingRef.current;
    ping.addEventListener('click', onPing);
    return () => ping.removeEventListener('click', onPing);
  }, [onPing]);
  useEffect(() => {
    const ping = pingRef.current;
    ping.addEventListener('pointerdown', onPingDown);
    return () => ping.removeEventListener('pointerdown', onPingDown);
  }, [onPingDown]);
  useEffect(() => {
    const target = focusRef.current;
    target.addEventListener('focus', onFocused);
    return () => target.removeEventListener('focus', onFocused);
  }, [onFocused]);
  return (
    <section className="card">
      <share-chip ref={chipRef} item="beta"></share-chip>
      <button type="button" ref={pingRef}>Ping</button>
      <button type="button" onClick={() => setBumps(value => value + 1)}>Bump</button>
      <span tabIndex={0} ref={focusRef}>Focus target</span>
      <button type="button" onClick={() => focusRef.current.focus()}>Focus it</button>
      <span>bumps {bumps}</span>
    </section>
  );
}

function App() {
  const [refreshed, setRefreshed] = useState(0);
  const refresh = () => { fetch('/api/refresh').then(() => setRefreshed(value => value + 1)); };
  const later = () => { setTimeout(() => programmaticShare('later'), 50); };
  return (
    <main>
      <ShareCard item="alpha" />
      <ReshareCard />
      <button type="button" onClick={refresh}>Refresh</button>
      <button type="button" onClick={later}>Later</button>
      <p>refreshed {refreshed}</p>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
