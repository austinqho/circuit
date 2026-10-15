import { persistItem } from './actions.js';

export function App() {
  function dismiss() {
    console.info('dismissed');
  }

  return (
    <section>
      <button onClick={persistItem}>Save item</button>
      <button onClick={dismiss}>Dismiss</button>
    </section>
  );
}
