import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeStructuredProgram, STRUCTURED_PROGRAM_PROPOSAL_SCHEMA } from '../authoring/library-program-format.mjs';
import { validateLibraryProgram } from '../analysis/library-program.mjs';
import { authorLibraryProgram } from '../authoring/library-program-author.mjs';
const structured = { schema: 'producttrace.library-program.v1', body: { op: 'object', entries: [
  { key: 'value', value: { op: 'arg', index: 0 } },
] } };

test('structured transport preserves nested instructions and rejects duplicate properties', () => {
  const result = decodeStructuredProgram(structured);
  assert.deepEqual(result.body.entries, { value: { op: 'arg', index: 0 } });
  assert.equal(validateLibraryProgram(result).valid, true);
  assert.throws(() => decodeStructuredProgram({ ...structured, body: { op: 'object', entries: [...structured.body.entries, ...structured.body.entries] } }), /transport_object_entries/);
  const malicious = decodeStructuredProgram({ ...structured, body: { op: 'object', entries: [{ key: '__proto__', value: { op: 'literal', value: true } }] } });
  assert.equal(validateLibraryProgram(malicious).valid, false);
  assert.equal({}.polluted, undefined);
});

test('native structured proposals still pass through the independent checker', async () => {
  let checks = 0;
  const result = await authorLibraryProgram({
    implementation: { context: { source_status: 'ready_for_scoped_proposal' }, unchanged: () => true },
    scope: { description: 'local format regression' },
    bank: { admit: async ({ program }) => { checks++; assert.deepEqual(program, decodeStructuredProgram(structured)); return { status: 'admitted' }; } },
    provider: { generate: async ({ schema }) => {
      assert.equal(schema, STRUCTURED_PROGRAM_PROPOSAL_SCHEMA);
      assert(!JSON.stringify(schema).includes('program_json'));
      return { proposal: { schema: 'producttrace.library-program-proposal.v2', status: 'propose', program: structured, reason: 'test' } };
    } },
  });
  assert.equal(result.status, 'admitted'); assert.equal(checks, 1);
});
