import { useState } from 'react';
import { createRoot } from 'react-dom/client';

// Neutral fixture for the G3 D12 stamp-neutrality test. Covers: a form with
// a submit request, keyed and unkeyed lists, a component placement wrapping a
// button, a conditional re-render that reuses a host node, and a plain fetch.

function SaveButton({ onSave, label }) {
  return <button type="button" className="save" onClick={onSave}>{label}</button>;
}

function Row({ item, onRemove }) {
  return (
    <li className="row">
      <span>{item.title}</span>
      <button type="button" aria-label={`Remove ${item.title}`} onClick={() => onRemove(item.id)}>Remove</button>
    </li>
  );
}

function Panel() {
  const [open, setOpen] = useState(false);
  const toggle = () => setOpen(value => !value);
  return open
    ? <div role="button" tabIndex={0} className="panel" onClick={toggle}>Close panel</div>
    : <div role="button" tabIndex={0} className="panel" onClick={toggle}>Open panel</div>;
}

function App() {
  const [items, setItems] = useState([{ id: 'a1', title: 'Alpha' }, { id: 'b2', title: 'Beta' }, { id: 'c3', title: 'Gamma' }]);
  const [name, setName] = useState('');
  const [saved, setSaved] = useState(null);
  const [tags] = useState(['red', 'green']);
  const handleSubmit = async event => {
    event.preventDefault();
    const response = await fetch('/api/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
    const body = await response.json();
    setSaved(body.id);
  };
  const removeItem = id => {
    fetch(`/api/items/${id}`, { method: 'DELETE' }).then(() => setItems(current => current.filter(item => item.id !== id)));
  };
  const refresh = () => fetch('/api/items').then(response => response.json()).then(body => setSaved(`refreshed:${body.count}`));
  return (
    <main>
      <form aria-label="Profile" onSubmit={handleSubmit}>
        <input name="name" aria-label="Name" value={name} onChange={event => setName(event.target.value)} />
        <button type="submit">Submit</button>
      </form>
      <ul>{items.map(item => <Row key={item.id} item={item} onRemove={removeItem} />)}</ul>
      <p>{tags.map(tag => <a href={`#${tag}`}>{tag}</a>)}</p>
      <SaveButton label="Refresh" onSave={refresh} />
      <Panel />
      <output>{saved || 'nothing saved'}</output>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
