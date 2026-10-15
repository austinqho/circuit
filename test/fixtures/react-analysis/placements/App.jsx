import { ItemButton } from './ItemButton.jsx';

export function App() {
  function saveItem(itemId) {
    return fetch('/items/' + itemId, { method: 'POST' });
  }
  function removeItem(itemId) {
    return fetch('/items/' + itemId, { method: 'DELETE' });
  }

  return (
    <main>
      <ItemButton itemId="item-a" onCommit={saveItem} />
      <ItemButton itemId="item-b" onCommit={removeItem} />
    </main>
  );
}
