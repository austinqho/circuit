import test from 'node:test';
import assert from 'node:assert/strict';
import { compileReactSources } from '../analysis/react-compiler.mjs';

const packages = { react: { version: '18.3.1', verified: true, verification_sha256: 'fixture' } };

// Shapes real apps write every day: a boolean shorthand `value` on a context
// provider, and a comment-only JSX child `{/* ... */}` next to a hook result.
test('a valueless JSX attribute and a comment-only JSX child are read, not thrown on', () => {
  const source = `import * as React from 'react';
const Open = React.createContext(false);
export function Search({ input }) {
  const shown = React.useDeferredValue(input);
  const id = React.useId();
  return (
    <Open.Provider value>
      <label htmlFor={id}>Query</label>
      <input id={id} />
      <output>{/* results follow the typed query */}{shown}</output>
      <p>{/* empty */}</p>
    </Open.Provider>
  );
}`;
  const map = compileReactSources({ 'search.tsx': source }, { packages });
  assert.ok(map.react_semantics.some((row) => row.export === 'useDeferredValue'));
});
