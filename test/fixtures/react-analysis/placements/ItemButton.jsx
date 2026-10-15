export function ItemButton({ itemId, onCommit }) {
  return <button onClick={() => onCommit(itemId)}>Apply</button>;
}
