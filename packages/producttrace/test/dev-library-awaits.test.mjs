import test from 'node:test';
import assert from 'node:assert/strict';
import { rewriteLibraryAwaits } from '../integrations/runtime-attribution.mjs';

test('library awaits under vite dev carry the continuation and keep their values', async () => {
  const code = [
    'async function g() { return 2; }',
    'async function f() { const a = await Promise.resolve(1); return a + await g() + await await Promise.resolve(3); }',
    'const h = async () => await f();',
    'function plain() { return 4; }',
  ].join('\n');
  const out = rewriteLibraryAwaits(code, '/app/node_modules/.vite/deps/lib.js');
  const calls = { begin: 0, suspend: 0, leave: 0, resume: 0, end: 0 };
  globalThis.__productTraceRuntime = {
    awaitBegin: () => (calls.begin += 1, {}), awaitSuspend: w => (calls.suspend += 1, w),
    awaitLeave: (w, v) => (calls.leave += 1, v), awaitResume: (w, v) => (calls.resume += 1, v), awaitEnd: () => { calls.end += 1; },
  };
  try {
    const result = await new Function(`${out.code}\nreturn h();`)();
    assert.equal(result, 6);
    // f has 4 awaits and h has 1; g has none and is left alone.
    assert.deepEqual(calls, { begin: 2, suspend: 5, leave: 5, resume: 5, end: 2 });
  } finally { delete globalThis.__productTraceRuntime; }
  assert.equal(rewriteLibraryAwaits('function plain() { return 1; }', 'x.js'), null);
});
