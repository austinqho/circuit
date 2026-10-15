import { useState as makeState } from 'react';

export function Editor() {
  const [open, setOpen] = makeState(false);
  return (
    <section>
      <button onClick={() => setOpen(true)}>Open editor</button>
      {open ? <form><input aria-label="Title" /></form> : null}
    </section>
  );
}

export function Inspector() {
  const [open, setOpen] = makeState(false);
  return (
    <aside>
      <button onClick={() => setOpen(true)}>Open inspector</button>
      {open ? <output>Inspector details</output> : null}
    </aside>
  );
}
