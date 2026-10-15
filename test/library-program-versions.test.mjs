import test from 'node:test';
import assert from 'node:assert/strict';
import { programHash, resolveVersionedProgram } from '../analysis/library-program-bank.mjs';
import { LIBRARY_PROGRAM_SCHEMA } from '../analysis/library-program.mjs';
const program = { schema: LIBRARY_PROGRAM_SCHEMA, body: { op: 'symbol', key: 'react.element' } };
const skeleton = () => ({ schema: 'producttrace.library-program-skeleton.v1', program: structuredClone(program), versions: [
  { version: '18.3.1', base_sha256: programHash(program), overrides: [] },
  { version: '19.1.1', base_sha256: programHash(program), overrides: [{ path: ['body', 'key'], value: 'react.transitional.element' }] },
] });
test('only an exact version receives its explicit override; resolution never claims verification', () => {
  const bank = skeleton();
  const result = resolveVersionedProgram(bank, '19.1.1');
  assert.equal(result.program.body.key, 'react.transitional.element');
  assert.equal(result.status, 'resolved_program'); assert.equal(result.verification, null);
  assert.equal(bank.program.body.key, 'react.element');
  assert.equal(resolveVersionedProgram(bank, '19.1.2').reason, 'version_not_verified');
  bank.program.body.key = 'changed';
  assert.equal(resolveVersionedProgram(bank, '19.1.1').reason, 'skeleton_changed');
});
test('ambiguous versions and unsafe, missing, or invalid override targets reject', () => {
  const duplicate = skeleton(); duplicate.versions.push(duplicate.versions[0]);
  assert.equal(resolveVersionedProgram(duplicate, '18.3.1').reason, 'ambiguous_version');
  for (const path of [['__proto__', 'polluted'], ['body', 'absent'], ['body', 'op']]) {
    const bank = skeleton(); bank.versions[1].overrides = [{ path, value: 'bad' }];
    assert.equal(resolveVersionedProgram(bank, '19.1.1').status, 'frontier');
  }
  assert.equal({}.polluted, undefined);
});
