// A stand-in for an uninstrumented dependency component (vendor/ is outside
// the first-party rule). Its own onClick calls a callback prop whose name is
// not on*: React invokes the library's handler, which calls the app's code.
import { createElement, useState } from 'react';
export function Widget({ callback, label }) {
  const [n, setN] = useState(0);
  return createElement('button', { type: 'button', 'aria-label': label, onClick: () => { setN(n + 1); callback(n + 1); } }, `${label} ${n}`);
}
// Calls onSelect with the store object it was given (an observable-style Proxy in the fixture).
export function ProxyPicker({ store, onSelect, label }) {
  return createElement('button', { type: 'button', 'aria-label': label, onClick: () => onSelect(store) }, label);
}
