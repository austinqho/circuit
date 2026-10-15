import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SpendLedger } from '../authoring/spend-ledger.mjs';
import { authorLibraryProgram } from '../authoring/library-program-author.mjs';

test('an expired spending deadline never calls the model or creates an unknown charge', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tracer-spending-gate-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'ledger.json');
  fs.writeFileSync(file, JSON.stringify({ cap_usd: 20, deadline_at: '2000-01-01T00:00:00Z', entries: [] }));
  let calls = 0;
  const provider = new SpendLedger(file).wrap({ maximumRequestCostUsd: () => 0.1,
    generate: () => { calls++; throw new Error('provider must not be called'); } }, 'test');
  const result = await authorLibraryProgram({
    implementation: { context: { source_status: 'ready_for_scoped_proposal' }, unchanged: () => true },
    scope: { description: 'local spending gate regression' }, bank: {}, provider,
  });
  assert.equal(result.reason, 'spending_gate_closed');
  assert.equal(result.detail, 'overnight_deadline_reached');
  assert.equal(result.attempts[0].provider_called, false);
  assert.equal(result.attempts[0].cost_usd, 0);
  assert.equal(calls, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(file)).entries, []);
});
