import { useState } from 'react';
import { createRoot } from 'react-dom/client';

// Neutral fixture for fix/stable-element-keys: the same Row component rendered
// in a keyed list and in an unkeyed list, each row with its own Save button,
// and a control that removes row 2 from both lists. Grade follow-ups: an
// index-keyed list (`key={i}`) with a Reverse control, and a Widget with its
// own keyed items mounted in two React roots (#root and #root2).

const initial = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon'].map((title, i) => ({ id: `r${i + 1}`, title }));

function Row({ item, onSave }) {
  return (
    <li className="row">
      <span>{item.title}</span>
      <button type="button" aria-label={`Save ${item.title}`} onClick={() => onSave(item.id)}>Save</button>
    </li>
  );
}

function Widget({ name }) {
  const [clicked, setClicked] = useState('');
  return (
    <section aria-label={name}>
      <ul>{['w1', 'w2'].map(id => <li key={id}><button type="button" aria-label={`Widget ${id}`} onClick={() => setClicked(id)}>Save</button></li>)}</ul>
      <output>{clicked}</output>
    </section>
  );
}

function IndexList() {
  const [items, setItems] = useState(initial);
  const [saved, setSaved] = useState('');
  return (
    <section aria-label="Index list">
      <ul>{items.map((item, i) => <Row key={i} item={item} onSave={id => setSaved(id)} />)}</ul>
      <button type="button" onClick={() => setItems(current => [...current].reverse())}>Reverse</button>
      <output>{saved}</output>
    </section>
  );
}

function App() {
  const [items, setItems] = useState(initial);
  const [saved, setSaved] = useState([]);
  const save = (list, id) => {
    fetch(`/api/save/${list}/${id}`, { method: 'POST' }).then(response => response.json()).then(body => setSaved(current => [...current, body.saved]));
  };
  const removeSecond = () => setItems(current => current.filter(item => item.id !== 'r2'));
  return (
    <main>
      <section aria-label="Keyed list">
        <ul>{items.map(item => <Row key={item.id} item={item} onSave={id => save('keyed', id)} />)}</ul>
      </section>
      <section aria-label="Unkeyed list">
        <ul>{items.map(item => <Row item={item} onSave={id => save('plain', id)} />)}</ul>
      </section>
      <button type="button" onClick={removeSecond}>Remove row 2</button>
      <IndexList />
      <Widget name="Widget root 1" />
      <output>{saved.join(',') || 'nothing saved'}</output>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
createRoot(document.getElementById('root2')).render(<Widget name="Widget root 2" />);
