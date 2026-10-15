import { Again } from './Again.jsx';

export function App() {
  function repeat() {
    return repeat();
  }
  return <section><button onClick={repeat}>Repeat</button><Again /></section>;
}
