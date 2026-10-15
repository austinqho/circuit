import { useState } from 'react';

export function ShadowedHook({ useState }) {
  const [open, setOpen] = useState(false);
  return <button onClick={() => setOpen(true)}>Shadowed hook</button>;
}

export function ReassignedHandler() {
  function original() {
    return 'original';
  }
  function replacement() {
    return 'replacement';
  }
  let handler = original;
  handler = replacement;
  return <button onClick={handler}>Reassigned handler</button>;
}
