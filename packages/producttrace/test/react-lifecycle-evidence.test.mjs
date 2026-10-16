import test from 'node:test';
import assert from 'node:assert/strict';
import { compileReactSources } from '../analysis/react-compiler.mjs';
import { createReactLifecycleEvidenceSession } from '../analysis/react-lifecycle-evidence.mjs';

const packages = Object.fromEntries(['react', 'react-dom'].map(name => [name, {
  version: '18.3.1', verified: true, verification_sha256: `verified-${name}`,
}]));
const map = compileReactSources({'App.tsx': `
  import {useEffect} from 'react';
  export function App({value}) {
    useEffect(() => { consume(value); return () => dispose(value); }, [value]);
    return null;
  }
`}, {packages});
const semantic = map.react_semantics.find(row => row.export === 'useEffect');
const [setup, cleanup] = semantic.causal_bindings.callbacks;
const base = {
  schema: 'producttrace.react-lifecycle-observation.v1', kind: 'react_lifecycle',
  map_fingerprint: map.fingerprint, source_call_id: semantic.call_id,
  semantic_id: semantic.semantic_id, owner_source_id: semantic.causal_bindings.owner_source_id,
  occurrence_id: 'occurrence-1', root_id: 'root-1', instance_id: 'instance-1',
  mount_id: 'mount-1', render_id: 'render-1', hook_slot_id: 'hook-0', evidence_ids: ['runtime-1'],
};
const record = (observation_id, operation, extra = {}) => ({...base, observation_id, operation, ...extra});

test('recorded React lifecycle identities remain separate from source predictions', () => {
  const session = createReactLifecycleEvidenceSession(map);
  assert.equal(session.join(record('attempt', 'render_attempted')).status, 'resolved');
  assert.equal(session.join(record('commit', 'render_committed')).status, 'resolved');
  const invocation = session.join(record('setup', 'callback_invoked', {
    callback_slot: setup.slot, callback_source_id: setup.source_id, invocation_id: 'setup-call',
    captured_values: setup.captures.map(capture => ({binding_id: capture.binding_id, encoding: 'redacted'})),
  }));
  assert.equal(invocation.claim, 'runtime_observed');
  assert.equal(invocation.runtime_observed, true);
  assert.equal(invocation.source.claim, 'source_contract');
  assert.equal(invocation.source.runtime_observed, false);
  const cleanupResult = session.join(record('cleanup', 'cleanup_invoked', {
    callback_slot: cleanup.slot, callback_source_id: cleanup.source_id,
    invocation_id: 'cleanup-call', caused_by_invocation_id: 'setup-call',
  }));
  assert.equal(cleanupResult.status, 'resolved');
  assert.equal(session.join(record('unmount', 'unmounted')).status, 'resolved');
  assert.equal(session.snapshot().counts.resolved, 5);
});

test('lifecycle evidence rejects contamination and impossible lineage', () => {
  const fresh = () => createReactLifecycleEvidenceSession(map);
  assert.equal(fresh().join(record('bad-map', 'render_attempted', {map_fingerprint:'other'})).reason,
    'map_fingerprint_mismatch');
  assert.equal(fresh().join(record('bad-source', 'render_attempted', {source_call_id:'call:other'})).reason,
    'source_occurrence_mismatch');
  assert.equal(fresh().join(record('bad-owner', 'render_attempted', {owner_source_id:'function:other'})).reason,
    'owner_source_mismatch');
  assert.equal(fresh().join(record('no-evidence', 'render_attempted', {evidence_ids:[]})).reason,
    'runtime_evidence_required');
  assert.equal(fresh().join(record('wrong-operation', 'hydration_replayed_event')).reason,
    'operation_not_supported_by_source_contract');
  assert.equal(fresh().join(record('commit-first', 'render_committed')).reason,
    'render_attempt_required');
  const session = fresh();
  session.join(record('attempt', 'render_attempted'));
  assert.equal(session.join(record('early-setup', 'callback_invoked', {
    callback_slot:setup.slot, callback_source_id:setup.source_id, invocation_id:'early-setup-call'})).reason,
  'callback_commit_required');
  assert.equal(session.join(record('commit', 'render_committed')).status, 'resolved');
  assert.equal(session.join(record('wrong-slot', 'callback_invoked', {
    callback_slot:'arguments.9', invocation_id:'wrong-slot-call'})).reason, 'callback_slot_mismatch');
  assert.equal(session.join(record('wrong-callback', 'callback_invoked', {
    callback_slot:setup.slot, callback_source_id:'function:other', invocation_id:'wrong-callback-call'})).reason,
    'callback_source_mismatch');
  assert.equal(session.join(record('orphan-cleanup', 'cleanup_invoked', {
    callback_slot:cleanup.slot, callback_source_id:cleanup.source_id,
    invocation_id:'orphan', caused_by_invocation_id:'missing'})).reason, 'setup_invocation_required');
  session.join(record('unmount', 'unmounted'));
  assert.equal(session.join(record('after', 'value_read')).reason, 'mount_already_unmounted');

  const abandoned = fresh();
  abandoned.join(record('abandoned-attempt', 'render_attempted'));
  abandoned.join(record('abandoned', 'render_abandoned'));
  assert.equal(abandoned.join(record('abandoned-callback', 'callback_invoked', {
    callback_slot:setup.slot, callback_source_id:setup.source_id,
    invocation_id:'abandoned-callback-call'})).reason, 'callback_from_abandoned_render');
  assert.equal(fresh().join(record('missing-hook', 'render_attempted', {hook_slot_id:undefined})).reason,
    'hook_slot_identity_required');
});

test('abandoned renders require a matching later attempt before supersession is proven',()=>{
 const sequence=(replacement={},prior={})=>{
  const session=createReactLifecycleEvidenceSession(map);
  assert.equal(session.join(record('first-attempt','render_attempted',{session:'s',render_id:'render-1',...prior})).status,'resolved');
  const abandoned=session.join(record('first-abandoned','render_abandoned',{session:'s',render_id:'render-1',
    replacement_render_id:'render-2',abandonment_cause:'superseded_by_render_attempt',...prior}));
  const next=session.join(record('next-attempt','render_attempted',{session:'s',render_id:'render-2',
    replaces_render_ids:['render-1'],...replacement}));
  return {abandoned,next};
 };
 const valid=sequence();
 assert.equal(valid.abandoned.status,'resolved');
 assert.equal(valid.abandoned.runtime.abandonment.replacement_attempt_observed,false);
 assert.equal(valid.next.status,'resolved');
 assert.deepEqual(valid.next.runtime.supersession,{claim:'observed_same_render_position_replacement_attempt',
  superseded_render_ids:['render-1']});
 const boundary={status:'source_resolved',origin_observation_id:'s:boundary',input_identity:'s:input'};
 const shifted=sequence({render_position_id:'s:position-2',suspense_boundary:boundary},
  {render_position_id:'s:position-1',suspense_boundary:boundary});
 assert.equal(shifted.next.status,'resolved');
 assert.equal(shifted.next.runtime.supersession.claim,'observed_same_suspense_source_replacement_attempt');
 assert.equal(sequence({render_position_id:'s:position-2',suspense_boundary:{...boundary,origin_observation_id:'s:other'}},
  {render_position_id:'s:position-1',suspense_boundary:boundary}).next.reason,'render_supersession_evidence_mismatch');
 for(const replacement of [{replaces_render_ids:undefined},{replaces_render_ids:['render-other']},
   {replaces_render_ids:['render-1','render-1']},{replaces_render_ids:['render-2']}])
  assert.equal(sequence(replacement).next.reason,'render_supersession_evidence_mismatch');
 const invalid=createReactLifecycleEvidenceSession(map);
 invalid.join(record('attempt','render_attempted',{session:'s',render_id:'render-1'}));
 assert.equal(invalid.join(record('bad-abandon','render_abandoned',{session:'s',render_id:'render-1',
  replacement_render_id:'render-1',abandonment_cause:'superseded_by_render_attempt'})).reason,
 'render_replacement_identity_required');
});

test('the same source hook keeps separate runtime identities for separate mounted instances', () => {
  const session = createReactLifecycleEvidenceSession(map);
  const rows = ['a', 'b'].flatMap(instance => [
    record(`${instance}-attempt`, 'render_attempted', {instance_id:instance, mount_id:`mount-${instance}`}),
    record(`${instance}-commit`, 'render_committed', {instance_id:instance, mount_id:`mount-${instance}`}),
  ]);
  for (const row of rows) assert.equal(session.join(row).status, 'resolved');
  assert.equal(session.snapshot().counts.mounts, 2);
  assert.equal(session.snapshot().counts.renders, 2);
});

test('document sessions isolate React counters that restart after navigation', () => {
  const session = createReactLifecycleEvidenceSession(map);
  for (const browserSession of ['browser-a', 'browser-b']) {
    assert.equal(session.join(record(`${browserSession}-attempt`, 'render_attempted', {
      session:browserSession, seq:1,
    })).status, 'resolved');
    const committed = session.join(record(`${browserSession}-commit`, 'render_committed', {
      session:browserSession, seq:2,
    }));
    assert.equal(committed.status, 'resolved');
    assert.equal(committed.runtime.session, browserSession);
  }
  assert.equal(session.snapshot().counts.mounts, 2);
  assert.equal(session.snapshot().counts.renders, 2);
});

test('returned member observations require the exact source member occurrence', () => {
  const rootMap=compileReactSources({'main.tsx':`import {createRoot} from 'react-dom/client';
    const root=createRoot(container);root.render(tree);`},{packages});
  const semantic=rootMap.react_semantics.find(row=>row.export==='createRoot');
  const protocol=rootMap.react_protocols[0];
  const session=createReactLifecycleEvidenceSession(rootMap);
  const observation={schema:'producttrace.react-lifecycle-observation.v1',kind:'react_lifecycle',
    observation_id:'root-schedule',occurrence_id:'root-occurrence',map_fingerprint:rootMap.fingerprint,
    source_call_id:semantic.call_id,semantic_id:semantic.semantic_id,
    operation:'work_scheduled',root_id:'root',instance_id:'root',mount_id:'mount',render_id:'render',
    protocol_member:'render',source_member_call_id:protocol.member_call_id,evidence_ids:['root-runtime']};
  assert.equal(session.join(observation).status,'resolved');
  const other=createReactLifecycleEvidenceSession(rootMap);
  assert.equal(other.join({...observation,source_member_call_id:'call:other'}).reason,
    'protocol_source_occurrence_mismatch');
});

test('context reads require one exact provider occurrence or an explicit default', () => {
  const contextMap=compileReactSources({'context.tsx':`import {createContext,useContext} from 'react';
    const C=createContext('default');
    function Child(){const value=useContext(C);return <span>{value}</span>}
    export function App(){return <C.Provider value="provided"><Child /></C.Provider>}`},{packages});
  const source=contextMap.react_semantics.find(row=>row.export==='useContext');
  const provider=contextMap.react_protocols.find(row=>row.member==='Provider');
  assert.ok(source?.causal_bindings.context_id && provider?.context_id);
  const contextBase={schema:'producttrace.react-lifecycle-observation.v1',kind:'react_lifecycle',
    map_fingerprint:contextMap.fingerprint,source_call_id:source.call_id,semantic_id:source.semantic_id,
    owner_source_id:source.causal_bindings.owner_source_id,occurrence_id:'context-occurrence',
    root_id:'root',instance_id:'instance',mount_id:'mount',render_id:'render',hook_slot_id:'hook-0',
    evidence_ids:['runtime-context'],context_id:source.causal_bindings.context_id,
    context_value:{encoding:'primitive',value:'provided'},context_default_used:false,
    provider_protocol_application_id:provider.id,provider_source_member_call_id:provider.member_call_id,
    provider_value:{encoding:'primitive',value:'provided'}};
  const fresh=()=>createReactLifecycleEvidenceSession(contextMap);
  const attempted=observation_id=>({schema:'producttrace.react-lifecycle-observation.v1',kind:'react_lifecycle',
    map_fingerprint:contextMap.fingerprint,source_call_id:source.call_id,semantic_id:source.semantic_id,
    owner_source_id:source.causal_bindings.owner_source_id,occurrence_id:`${observation_id}-occurrence`,
    observation_id,operation:'render_attempted',root_id:'root',instance_id:'instance',mount_id:'mount',
    render_id:'render',hook_slot_id:'hook-0',evidence_ids:['runtime-context']});
  const resolved=fresh();
  assert.equal(resolved.join(attempted('attempt')).status,'resolved');
  assert.equal(resolved.join({...contextBase,observation_id:'read',operation:'value_read'}).status,'resolved');
  const wrongProvider=fresh();
  wrongProvider.join(attempted('attempt-wrong'));
  assert.equal(wrongProvider.join({...contextBase,observation_id:'read-wrong',operation:'value_read',
    provider_protocol_application_id:'protocol:foreign'}).reason,'context_provider_occurrence_mismatch');
  const wrongValue=fresh();
  wrongValue.join(attempted('attempt-value'));
  assert.equal(wrongValue.join({...contextBase,observation_id:'read-value',operation:'value_read',
    provider_value:{encoding:'primitive',value:'other'}}).reason,'context_provider_value_mismatch');
  const defaulted=fresh();
  const defaultRecord={...contextBase,context_value:{encoding:'primitive',value:'default'},
    context_default_used:true,provider_protocol_application_id:null,
    provider_source_member_call_id:null,provider_value:null};
  assert.equal(defaulted.join(attempted('attempt-default')).status,'resolved');
  assert.equal(defaulted.join({...defaultRecord,observation_id:'read-default',operation:'value_read'}).status,'resolved');
  const uninstrumented=fresh();
  assert.equal(uninstrumented.join(attempted('attempt-uninstrumented')).status,'resolved');
  const unresolvedProvider=uninstrumented.join({...contextBase,
    observation_id:'read-uninstrumented',operation:'value_read',
    provider_protocol_application_id:null,provider_source_member_call_id:null,
    provider_value:{encoding:'redacted',value:null},context_provider_status:'source_unresolved',
    context_provider_unresolved_reason:'provider_source_uninstrumented'});
  assert.equal(unresolvedProvider.status,'resolved');
  assert.deepEqual(unresolvedProvider.runtime.provider_resolution,
    {status:'source_unresolved',reason:'provider_source_uninstrumented'});
  const forgedUnresolved=fresh();
  forgedUnresolved.join(attempted('attempt-forged-unresolved'));
  assert.equal(forgedUnresolved.join({...contextBase,
    observation_id:'read-forged-unresolved',operation:'value_read',
    provider_protocol_application_id:'protocol:foreign',provider_source_member_call_id:null,
    context_provider_status:'source_unresolved',
    context_provider_unresolved_reason:'provider_source_uninstrumented'}).reason,
  'context_provider_occurrence_mismatch');
  const contaminatedDefault=fresh();
  contaminatedDefault.join(attempted('attempt-contaminated-default'));
  assert.equal(contaminatedDefault.join({...defaultRecord,
    observation_id:'read-contaminated-default',operation:'value_read',
    context_provider_status:'source_unresolved',
    context_provider_unresolved_reason:'provider_source_uninstrumented'}).reason,
  'context_default_provider_contamination');
});

test('effect outcomes require the exact invocation and distinguish a return from a throw',()=>{
  const fresh=()=>{
    const session=createReactLifecycleEvidenceSession(map);
    for(const [id,operation] of [['attempt','render_attempted'],['commit','render_committed']])
      assert.equal(session.join(record(id,operation,{session:'s'})).status,'resolved');
    assert.equal(session.join(record('invoke','callback_invoked',{session:'s',invocation_id:'s:setup',
      callback_slot:setup.slot,callback_source_id:setup.source_id})).status,'resolved');
    return session;
  };
  const outcome=record('s:outcome','callback_completed',{session:'s',runtime_observed:true,
    occurrence_id:'s:outcome:occurrence',evidence_ids:['s:outcome'],caused_by_invocation_id:'s:setup',
    callback_slot:setup.slot,callback_source_id:setup.source_id,outcome:'returned',
    value_id:'s:cleanup-function',value_kind:'function',value:{encoding:'redacted',value:null}});
  const mutations=[{caused_by_invocation_id:'s:missing'},{render_id:'different'},
    {hook_slot_id:'other'},{callback_source_id:'different'},{callback_slot:cleanup.slot},
    {value_id:'foreign:value'},{value_kind:'null',value:{encoding:'primitive',value:'not null'}},
    {outcome:'settled'},{invocation_id:'s:setup'},{runtime_observed:false}];
  for(const mutation of mutations){const session=fresh();assert.equal(session.join({...outcome,...mutation}).status,'unresolved');
    const valid=session.join(outcome);assert.equal(valid.status,'resolved',JSON.stringify(valid));
    assert.equal(valid.runtime.effect_outcome.cleanup_returned,true);assert.equal(valid.runtime.effect_outcome.asynchronous_completion_proven,false);
    assert.equal(session.join({...outcome,observation_id:'s:again',occurrence_id:'s:again:occurrence',evidence_ids:['s:again']}).reason,'duplicate_effect_outcome');}
  for(const [kind,outcomeKind] of [['undefined','returned'],['object','threw']]){
    const session=fresh();const checked=session.join({...outcome,value_kind:kind,outcome:outcomeKind});
    assert.equal(checked.status,'resolved');assert.equal(checked.runtime.effect_outcome.cleanup_returned,false);
    assert.equal(session.join(record('cleanup','cleanup_invoked',{session:'s',invocation_id:'s:cleanup',
      caused_by_invocation_id:'s:setup',callback_slot:cleanup.slot,callback_source_id:cleanup.source_id})).reason,'setup_did_not_return_cleanup');
  }
  const session=fresh();session.join(outcome);
  assert.equal(session.join(record('cleanup','cleanup_invoked',{session:'s',invocation_id:'s:cleanup',
    caused_by_invocation_id:'s:setup',callback_slot:cleanup.slot,callback_source_id:cleanup.source_id})).status,'resolved');
  const result=session.join({...outcome,observation_id:'s:cleanup-outcome',occurrence_id:'s:cleanup-outcome:occurrence',
    evidence_ids:['s:cleanup-outcome'],operation:'cleanup_completed',caused_by_invocation_id:'s:cleanup',
    callback_slot:cleanup.slot,callback_source_id:cleanup.source_id,outcome:'threw',value_kind:'object'});
  assert.equal(result.status,'resolved');assert.equal(result.runtime.effect_outcome.outcome,'threw');
});
