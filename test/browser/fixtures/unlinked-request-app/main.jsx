// Neutral fixture (no product names): a first-party handler that makes no
// request, and a page-level flag an uninstrumented script watches.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';

function App() {
  const [on, setOn] = useState(false);
  const toggle = () => setOn(value => !value);
  const other = () => {};
  return (
    <main>
      <button type="button" onClick={toggle}>Toggle</button>
      <p data-toggled={on ? 'yes' : 'no'}>{on ? 'on' : 'off'}</p>
      <button type="button" onClick={other}>Other</button>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
