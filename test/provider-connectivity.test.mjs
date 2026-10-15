import test from 'node:test';
import assert from 'node:assert/strict';
import { checkOpenAIConnectivity } from '../authoring/provider-connectivity.mjs';
test('connectivity preflight sends no key or paid model request', async () => {
  let cancelled = false;
  const result = await checkOpenAIConnectivity({ fetchImpl: async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/models');
    assert.equal(options.headers, undefined); assert.equal(options.body, undefined);
    return { status: 401, body: { cancel: async () => { cancelled = true; } } };
  } });
  assert.equal(result.ready, true); assert.equal(cancelled, true);
});
test('DNS errors and unexpected HTTP responses stop before a paid request', async () => {
  assert.equal((await checkOpenAIConnectivity({ fetchImpl: async () => { throw new Error('DNS failure'); } })).ready, false);
  assert.equal((await checkOpenAIConnectivity({ fetchImpl: async () => ({ status: 429 }) })).ready, false);
});
