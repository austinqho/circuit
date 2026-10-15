import test from 'node:test';
import assert from 'node:assert/strict';
import { authorLibraryProgram } from '../authoring/library-program-author.mjs';
import { createLibraryProgramBank } from '../analysis/library-program-bank.mjs';
import { createLibraryBoundary } from '../analysis/library-boundary.mjs';
import { LIBRARY_PROGRAM_SCHEMA } from '../analysis/library-program.mjs';

const body = { op: 'call', target: { op: 'arg', index: 0 }, receiver: { op: 'undefined' }, args: { op: 'array', items: [{ op: 'arg', index: 1 }] } };
const correct = { schema: LIBRARY_PROGRAM_SCHEMA, body };
const wrong = { ...correct, body: { op: 'literal', value: null } };
const response = program => ({ schema: 'producttrace.library-program-proposal.v1', status: 'propose', program_json: JSON.stringify(program), reason: 'source-derived claim' });
const implementation = { producer: (cb, value) => cb(value), sha256: 'unit-test-source', unchanged: () => true,
  context: { source_status: 'ready_for_scoped_proposal', specifier: 'test-library', export_name: 'invoke', implementation: 'function invoke(cb,value) { return cb(value); }' } };
const scope = { callbackArguments: [0], resultPaths: null, description: 'One callback and one data value, synchronous boundary.' };
function bank() {
  return createLibraryProgramBank({ check: async ({ implementation, program }) => {
    const boundary = createLibraryBoundary({ producer: implementation.producer, program, callbackArguments: [0] });
    boundary.invoke([v => v, Object.freeze({ private_stimulus: 17 })]);
    const report = boundary.checkpoint();
    return { ...report, status: report.status === 'observed_agreement' ? 'passed' : 'rejected',
      reason: report.failures[0]?.reason ?? null, stage: 'behavior_and_integration' };
  } });
}

test('automatic repair receives an independent failure and then admits a usable program', async () => {
  const requests = [];
  const provider = { generate: async request => {
    requests.push(request);
    return { proposal: response(requests.length === 1 ? wrong : correct), cost_usd: 0, usage: {}, latency_ms: 0 };
  } };
  const entries = bank();
  const result = await authorLibraryProgram({ implementation, scope, bank: entries, provider });
  assert.equal(result.status, 'admitted');
  assert.equal(result.attempts.length, 2);
  assert.equal(JSON.parse(requests[1].input).phase, 'repair');
  assert.equal(JSON.parse(requests[1].input).feedback.reason, 'result_value_or_identity_mismatch');
  assert(!requests.some(request => request.input.includes('private_stimulus')));
  assert.deepEqual(entries.lookup('test-library', 'invoke').program, correct);
});

test('bad format is checked before behavior, and repeated failure stops the loop', async () => {
  let checks = 0, calls = 0;
  const entries = createLibraryProgramBank({ check: async () => { checks++; return { status: 'passed' }; } });
  const result = await authorLibraryProgram({ implementation, scope, bank: entries, provider: {
    generate: async () => { calls++; return { proposal: response({ ...correct, body: { op: 'invented' } }), cost_usd: 0 }; },
  } });
  assert.equal(result.reason, 'repeated_failed_proposal');
  assert.equal(calls, 2);
  assert.equal(checks, 0);
});

test('missing source stops before generation; an LLM abstention is not automatically justified', async () => {
  let calls = 0;
  const provider = { generate: async () => { calls++; return { proposal: { schema: 'producttrace.library-program-proposal.v1',
    status: 'abstain', program_json: null, reason: 'missing event source' } }; } };
  const missing = await authorLibraryProgram({ implementation: { ...implementation, context: { ...implementation.context, source_status: 'frontier' } }, scope, bank: bank(), provider });
  assert.equal(missing.reason, 'source_unavailable'); assert.equal(calls, 0);
  const abstained = await authorLibraryProgram({ implementation, scope, bank: bank(), provider });
  assert.equal(abstained.reason, 'model_abstained_requires_independent_diagnosis');
  assert.equal(calls, 1);
});

test('resumption rechecks the saved failed proposal and sends result types without grading answers', async () => {
  const nested = { schema: LIBRARY_PROGRAM_SCHEMA, body: { op: 'fn', this_mode: 'strict', body: correct.body } };
  let request;
  const result = await authorLibraryProgram({ implementation, scope, bank: bank(), previousProposal: response(nested), provider: {
    generate: async value => { request = value; return { proposal: response(correct), cost_usd: 0 }; },
  } });
  assert.equal(result.status, 'admitted');
  const input = JSON.parse(request.input);
  assert.equal(input.phase, 'repair');
  assert.equal(input.feedback.failures[0].detail.predicted_type, 'function');
  assert.equal(input.feedback.failures[0].detail.observed_type, 'object');
  assert(!request.input.includes('private_stimulus'));
});

test('incomplete provider replies retain accounting and finish reason instead of disappearing', async () => {
  const result = await authorLibraryProgram({ implementation, scope, bank: bank(), provider: {
    generate: async () => { throw Object.assign(new Error('provider_response_text_missing'), {
      attempt_metadata: { cost_usd: 0.01, finish_reason: 'max_output_tokens', usage: { output_tokens: 5000 }, latency_ms: 3 },
    }); },
  } });
  assert.equal(result.reason, 'provider_failure');
  assert.equal(result.attempts.length, 1);
  assert.equal(result.attempts[0].cost_usd, 0.01);
  assert.equal(result.attempts[0].finish_reason, 'max_output_tokens');
});

test('malformed JSON gets parser feedback and changing only its explanation cannot prolong spending', async () => {
  let calls = 0, checks = 0;
  const malformed = { ...response(correct), program_json: JSON.stringify(correct) + '}' };
  const entries = createLibraryProgramBank({ check: async () => { checks++; return { status: 'passed' }; } });
  const result = await authorLibraryProgram({ implementation, scope, bank: entries, provider: {
    generate: async request => {
      calls++;
      if (calls === 2) assert.match(JSON.parse(request.input).feedback.detail, /JSON|position/);
      return { proposal: { ...malformed, reason: `different explanation ${calls}` }, cost_usd: 0 };
    },
  } });
  assert.equal(result.reason, 'repeated_failed_proposal');
  assert.equal(calls, 2); assert.equal(checks, 0);
});

test('a saved malformed proposal can be repaired without hand-editing its program', async () => {
  const malformed = { ...response(correct), program_json: JSON.stringify(correct) + '}' };
  const result = await authorLibraryProgram({ implementation, scope, bank: bank(), previousProposal: malformed,
    provider: { generate: async request => {
      const input = JSON.parse(request.input);
      assert.equal(input.previous_proposal.program_json, malformed.program_json);
      assert.equal(input.feedback.reason, 'program_json_parse');
      assert.match(input.feedback.detail, /JSON|position/);
      return { proposal: response(correct), cost_usd: 0 };
    } },
  });
  assert.equal(result.status, 'admitted');
  assert.equal(result.attempts.length, 1);
});

test('authoring receives the exact host frame and refuses unsupported protocols before spending', async () => {
  let calls = 0;
  const provider = { generate: async request => {
    calls++;
    const input = JSON.parse(request.input);
    assert.equal(input.execution_protocol, 'owned_returned_reference');
    assert.match(input.protocol_definition, /0 = argument array with every object\/function replaced by a stable opaque identity handle/);
    assert.match(input.protocol_definition, /user callbacks must not execute/);
    return { proposal: { schema: 'producttrace.library-program-proposal.v2', status: 'abstain', program: null, reason: 'test-only provider' } };
  } };
  const owned = await authorLibraryProgram({ implementation, scope: { ...scope, protocol: 'owned_returned_reference' }, bank: bank(), provider });
  assert.equal(owned.reason, 'model_abstained_requires_independent_diagnosis');
  assert.equal(calls, 1);
  const unsupported = await authorLibraryProgram({ implementation, scope: { ...scope, protocol: 'invented' }, bank: bank(), provider });
  assert.equal(unsupported.reason, 'unsupported_execution_protocol'); assert.equal(calls, 1);
});

test('catalog-only source attestation cannot start a new model proposal', async () => {
  const result = await authorLibraryProgram({ implementation: { ...implementation, context: {
    ...implementation.context, source_status: 'ready_for_catalog_recheck', source_reason: 'host implementation still needs source selection',
  } }, scope, bank: bank(), provider: { generate: () => { throw new Error('must not spend'); } } });
  assert.equal(result.status, 'frontier');
  assert.equal(result.reason, 'host implementation still needs source selection');
  assert.equal(result.attempts.length, 0);
});

test('repair feedback retains distinct defects when repeated occurrences fail for the same reason', async () => {
  let calls = 0;
  const entries = createLibraryProgramBank({ check: async () => ({ status: 'rejected', stage: 'behavior', reason: 'count', failures: [
    { reason: 'count', occurrence: 'first' }, { reason: 'count', occurrence: 'second' },
    { reason: 'receiver', occurrence: 'third' }, { reason: 'result', occurrence: 'fourth' },
    { reason: 'extra', occurrence: 'fifth' },
  ] }) });
  const result = await authorLibraryProgram({ implementation, scope, bank: entries, previousProposal: response(wrong), provider: {
    generate: async request => {
      calls++;
      assert.deepEqual(JSON.parse(request.input).feedback.failures.map(row => row.occurrence), ['first', 'third', 'fourth']);
      return { proposal: { schema: 'producttrace.library-program-proposal.v2', status: 'abstain', program: null, reason: 'test' } };
    },
  } });
  assert.equal(calls, 1);
  assert.equal(result.reason, 'model_abstained_requires_independent_diagnosis');
});

test('automatic format repair receives the missing variable and its lexical location', async () => {
  let calls=0;
  const missing={schema:'producttrace.library-program.v1',body:{op:'local',name:'unboundNode'}};
  const result=await authorLibraryProgram({implementation,scope,bank:bank(),previousProposal:response(missing),provider:{
    generate:async request=>{
      calls++;
      const feedback=JSON.parse(request.input).feedback;
      assert.equal(feedback.reason,'unbound_local');
      assert.deepEqual(feedback.detail.diagnostics,[{reason:'unbound_local',path:'/body',name:'unboundNode',in_scope:[]}]);
      return {proposal:response(correct)};
    },
  }});
  assert.equal(calls,1);assert.equal(result.status,'admitted');
});

test('repair retains different unsupported input kinds under the same rejection reason', async () => {
  const entries=createLibraryProgramBank({check:async()=>({status:'rejected',reason:'unsupported_input_was_not_a_frontier',failures:[
    {reason:'unsupported_input_was_not_a_frontier',detail:{input_kind:'key_getter',actual_effect_count:1}},
    {reason:'unsupported_input_was_not_a_frontier',detail:{input_kind:'key_coercion',actual_effect_count:1}},
  ]})});
  const result=await authorLibraryProgram({implementation,scope,bank:entries,previousProposal:response(wrong),provider:{generate:async request=>{
    assert.deepEqual(JSON.parse(request.input).feedback.failures.map(row=>row.detail.input_kind),['key_getter','key_coercion']);
    return {proposal:{schema:'producttrace.library-program-proposal.v2',status:'abstain',program:null,reason:'test'}};
  }}});
  assert.equal(result.reason,'model_abstained_requires_independent_diagnosis');
});
