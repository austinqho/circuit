export function persistItem() {
  return fetch('/items', { method: 'POST' });
}
