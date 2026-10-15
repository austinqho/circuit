import ReactDefault from 'react';
import * as ReactNamespace from 'react';

function Panel({ name }) {
  const [visible, setVisible] = ReactDefault.useState(false);
  return (
    <section>
      <button onClick={() => setVisible(true)}>Show panel</button>
      {visible && <output>{name}</output>}
    </section>
  );
}

function NamespacePanel() {
  const [visible, setVisible] = ReactNamespace.useState(false);
  return <button onClick={() => setVisible(!visible)}>Toggle namespace</button>;
}

export function App() {
  return <main><Panel name="left" /><Panel name="right" /><NamespacePanel /></main>;
}
