import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {REACT_API_INVENTORY} from '../../analysis/react-semantics.mjs';
import {validateReactExecutionRule} from '../../analysis/react-execution-rule.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const repository=path.resolve(process.argv[2]||'/tmp/producttrace-librechat-autonomous');
const run=(script,env={})=>JSON.parse(execFileSync(process.execPath,[path.join(root,'test/acceptance',script),repository],{
  cwd:root,encoding:'utf8',env:{...process.env,...env},stdio:['ignore','pipe','inherit'],maxBuffer:20_000_000}));
const behavior=run('react-retained-rule.mjs');
const sharedCallbacks=[];
for(const imported of [false,true])for(const factory of [false,true])for(const build of ['development','production'])for(const hydration of [false,true])sharedCallbacks.push(run('react-shared-callback-runtime.mjs',{
  NODE_ENV:build,PRODUCTTRACE_REACT_SHARED_IMPORT:imported?'1':'0',PRODUCTTRACE_REACT_SHARED_FACTORY:factory?'1':'0',PRODUCTTRACE_REACT_BUILD:build,PRODUCTTRACE_REACT_STRICT:hydration?'1':'0',PRODUCTTRACE_REACT_HYDRATE:hydration?'1':'0'}));
assert.equal(sharedCallbacks.filter(row=>row.imported_through_reexport).length,8);
const sharedCallbackEvidence=row=>row.installed_source_attested && row.actual_clicks===20
  && row.matched_original_body_entries===20 && row.source_hooks===5 && row.mounted_owners===2
  && row.lexical_values_and_function_shape_preserved && row.same_function_identity_preserved && row.retained_old_and_new_closures && row.nested_callee_contamination_rejected
  && row.independent_lineage_mutants_rejected>=11 && row.missing_prerequisites_rejected===4
  && row.outside_event_and_after_unmount_abstained && row.stop_preserves_behavior;
const sharedNamedPass=sharedCallbacks.every(sharedCallbackEvidence);
const namespaceCallbacks=[];
for(const factory of [false,true])for(const build of ['development','production'])for(const hydration of [false,true])
 namespaceCallbacks.push(run('react-shared-callback-runtime.mjs',{PRODUCTTRACE_REACT_SHARED_NAMESPACE:'1',
  PRODUCTTRACE_REACT_SHARED_FACTORY:factory?'1':'0',PRODUCTTRACE_REACT_BUILD:build,
  PRODUCTTRACE_REACT_HYDRATE:hydration?'1':'0',PRODUCTTRACE_REACT_STRICT:hydration?'1':'0'}));
const namespaceCallbacksPass=namespaceCallbacks.length===8&&namespaceCallbacks.every(row=>row.namespace_import
 &&row.imported_through_reexport&&sharedCallbackEvidence(row)&&(!row.hydration||row.hydration_dom_reused));


const effects=run('react-effect-rule.mjs');
const effectOutcomes=[];
for(const build of ['development','production'])for(const strict of [false,true])for(const hydrate of [false,true])
  effectOutcomes.push(run('react-effect-outcome-runtime.mjs',{NODE_ENV:build,PRODUCTTRACE_REACT_BUILD:build,
    PRODUCTTRACE_REACT_STRICT:strict?'1':'0',PRODUCTTRACE_REACT_HYDRATE:hydrate?'1':'0'}));
const effectOutcomePass=effectOutcomes.length===8 && effectOutcomes.every(row=>row.baseline_matches
  && row.every_original_invocation_has_joined_outcome && row.suspense_hide_reveal && row.abandoned_render_has_no_effect
  && row.unchanged_dependencies && row.exact_error_identity && row.thrown_cleanup_outcomes>=3 && row.thrown_setup_outcomes>=3
  && (!row.hydrate||row.hydration_reuses_server_node) && row.async_completion_claimed===false);
const memo=run('react-memo-rule.mjs');
const dynamicMemo=[];
for(const build of ['development','production'])for(const strict of [false,true])
  dynamicMemo.push(run('react-dynamic-memo-runtime.mjs',{PRODUCTTRACE_REACT_BUILD:build,PRODUCTTRACE_REACT_STRICT:strict?'1':'0'}));
const dynamicMemoPass=dynamicMemo.length===4&&dynamicMemo.every(row=>row.passed&&row.events===6
  &&row.calculations>=4&&row.negative_checks>=5&&row.unknown_source_abstentions===1&&row.baseline_parity);
const literal=run('react-literal-rule.mjs');
const state=run('react-state-rule.mjs');
const boundaries=run('react-boundary-rule.mjs'),boundaryProps=run('react-boundary-props.mjs'),boundaryRuntime=[],boundaryFallback=[];
for(const build of ['development','production']) {
  for(const hydration of [false,true])boundaryRuntime.push(run('react-boundary-runtime.mjs',{
    NODE_ENV:build,PRODUCTTRACE_REACT_BUILD:build,PRODUCTTRACE_REACT_HYDRATE:hydration?'1':'0'}));
  boundaryFallback.push(run('react-boundary-runtime.mjs',{NODE_ENV:build,PRODUCTTRACE_REACT_BUILD:build,PRODUCTTRACE_REACT_SUSPEND:'1'}));
}
const fragmentLifecycle=[];
for(const build of ['development','production'])for(const local of [false,true])fragmentLifecycle.push(run('react-fragment-lifecycle-runtime.mjs',{NODE_ENV:build,PRODUCTTRACE_REACT_BUILD:build,PRODUCTTRACE_FRAGMENT_LOCAL:local?'1':'0'}));
const fragmentLifecyclePass=fragmentLifecycle.length===4&&fragmentLifecycle.filter(row=>row.local_jsx_value).length===2&&fragmentLifecycle.every(row=>row.keyed_reorder_retains_state_and_fiber
  &&row.key_change_remounts&&row.removed_key_reinsertion_remounts&&row.sibling_identity_isolated&&row.click_branch_proofs===8
  &&row.ignored_props_not_forwarded&&row.ref_never_attached&&row.development_only_validation&&row.retained_identity_joins>=5
  &&row.wrong_rules_rejected>=4&&row.corrupted_lineage_rejected>=4);
const strictReplay=[];
for(const build of ['development','production'])for(const legacy of [false,true])for(const priorHook of [false,true])
  strictReplay.push(run('react-strict-replay-runtime.mjs',{NODE_ENV:build,PRODUCTTRACE_REACT_BUILD:build,
    PRODUCTTRACE_STRICT_LEGACY:legacy?'1':'0',PRODUCTTRACE_STRICT_PRIOR_HOOK:priorHook?'1':'0'}));
const strictUnmapped=['development','production'].map(build=>run('react-strict-replay-runtime.mjs',{
  NODE_ENV:build,PRODUCTTRACE_REACT_BUILD:build,PRODUCTTRACE_STRICT_NO_MAP:'1'}));
const strictReplayPass=strictReplay.length===8&&strictReplay.filter(row=>row.legacy).length===4
  &&strictReplay.filter(row=>row.prior_hook).length===4&&strictReplay.every(row=>row.baseline_preserved&&row.normal_events_not_replayed
    &&row.stop_preserved&&(!row.prior_hook||row.prior_hook_preserved)&&row.effect_rehearsal_inferred===false
    &&(row.build==='development'?row.development_replay_brackets>=7&&row.render_attempts_joined_to_replay===row.development_replay_brackets
      &&row.nested_boundary_origins===2&&row.incorrect_rules_or_receipts_rejected>=6:row.production_no_replay&&row.development_replay_brackets===0))
  &&strictUnmapped.every(row=>row.unmapped_recorder&&row.baseline_preserved&&row.committed_action_identities===3&&row.stop_preserved);
const profilerRuntime=[];
for(const build of ['development','production','profiling'])for(const nested of [false,true])
  profilerRuntime.push(run('react-profiler-runtime.mjs',{PRODUCTTRACE_REACT_BUILD:build,PRODUCTTRACE_PROFILER_NESTED:nested?'1':'0'}));
const profilerRuntimePass=profilerRuntime.length===6&&profilerRuntime.every(row=>row.baseline_preserved
  &&row.original_function_name_arity_return_preserved&&row.stop_preserved
  &&(row.build==='production'?row.commit_callbacks===0&&row.ordinary_production_no_callback:
    row.commit_callbacks===(row.nested_update?8:6)&&row.exact_callback_arguments&&row.nested_owner_isolation
    &&row.manual_reentry_abstains&&row.thrown_callback_observed>0&&row.incorrect_behavior_programs_rejected>=8
    &&row.incorrect_rules_or_receipts_rejected>=9));
const act=run('react-act-rule.mjs');
const actRuntime=['development','production'].map(build=>run('react-act-runtime.mjs',{PRODUCTTRACE_REACT_BUILD:build,NODE_ENV:build}));
const browserSource=run('react-browser-source.mjs');
assert.equal(browserSource.attested_files,24);assert.equal(browserSource.tampered_browser_files_rejected.length,5);assert.equal(browserSource.restored_source_admitted,true);
const classUpdates=run('react-class-update-rule.mjs'),classUpdateRuntime=[];
for(const build of ['development','production']){
 for(const strict of [false,true])classUpdateRuntime.push(run('react-class-update-runtime.mjs',{NODE_ENV:build,PRODUCTTRACE_CLASS_STRICT:strict?'1':'0'}));
 classUpdateRuntime.push(run('react-class-update-runtime.mjs',{NODE_ENV:build,PRODUCTTRACE_CLASS_STRICT:'1',PRODUCTTRACE_CLASS_LEGACY:'1'}));
}
const classes=run('react-class-rule.mjs'),classRuntime=[];
for(const build of ['development','production'])for(const strict of [false,true])classRuntime.push(run('react-class-runtime.mjs',{NODE_ENV:build,PRODUCTTRACE_CLASS_STRICT:strict?'1':'0'}));
const pipeableStream=run('react-pipeable-stream-rule.mjs'),pipeableStreamRuntime=['development','production'].map(build=>run('react-pipeable-stream-runtime.mjs',{NODE_ENV:build}));
const readableStream=run('react-readable-stream-rule.mjs'),readableStreamRuntime=[];
for(const build of ['development','production'])for(const browser of [false,true])readableStreamRuntime.push(run('react-readable-stream-runtime.mjs',{NODE_ENV:build,PRODUCTTRACE_SERVER_BROWSER:browser?'1':'0'}));
const legacyRender=run('react-legacy-render-rule.mjs'),legacyRenderRuntime=[];
for(const build of ['development','production'])for(const api of ['render','hydrate','unstable_renderSubtreeIntoContainer'])legacyRenderRuntime.push(run('react-legacy-render-runtime.mjs',{NODE_ENV:build,PRODUCTTRACE_REACT_BUILD:build,PRODUCTTRACE_LEGACY_API:api}));
const legacyUnmount=run('react-legacy-unmount-rule.mjs');
const legacyUnmountRuntime=['development','production'].map(build=>run('react-legacy-unmount-runtime.mjs',{NODE_ENV:build,PRODUCTTRACE_REACT_BUILD:build}));
const hostLookup=run('react-host-rule.mjs');
const hostRuntime=['development','production'].map(build=>run('react-host-runtime.mjs',{NODE_ENV:build,PRODUCTTRACE_REACT_BUILD:build}));
const legacyStreams=run('react-legacy-stream-rule.mjs'),legacyStreamRuntime=[];
for(const build of ['development','production'])for(const api of ['renderToNodeStream','renderToStaticNodeStream'])
  legacyStreamRuntime.push(run('react-legacy-stream-runtime.mjs',{NODE_ENV:build,PRODUCTTRACE_SERVER_API:api}));
const serverStrings=run('react-server-string-rule.mjs'),serverStringRuntime=[];
for(const build of ['development','production'])for(const api of ['renderToString','renderToStaticMarkup'])for(const browser of [false,true])
  serverStringRuntime.push(run('react-server-string-runtime.mjs',{NODE_ENV:build,PRODUCTTRACE_SERVER_API:api,PRODUCTTRACE_SERVER_BROWSER:browser?'1':'0'}));
const roots=run('react-root-rule.mjs'),rootRuntime=[];
for(const build of ['development','production'])for(const surface of ['react-dom','react-dom/client'])for(const hydrate of [false,true])
  rootRuntime.push(run('react-root-runtime.mjs',{NODE_ENV:build,PRODUCTTRACE_REACT_BUILD:build,PRODUCTTRACE_ROOT_SURFACE:surface,PRODUCTTRACE_ROOT_HYDRATE:hydrate?'1':'0'}));
const rootAliasRuntime=[];
for(const build of ['development','production'])for(const surface of ['react-dom','react-dom/client'])for(const hydrate of [false,true])
  rootAliasRuntime.push(run('react-root-runtime.mjs',{NODE_ENV:build,PRODUCTTRACE_REACT_BUILD:build,PRODUCTTRACE_ROOT_SURFACE:surface,
    PRODUCTTRACE_ROOT_HYDRATE:hydrate?'1':'0',PRODUCTTRACE_ROOT_ALIASES:'1'}));
const rootRecoveryRuntime=[];
for(const build of ['development','production'])for(const surface of ['react-dom','react-dom/client'])
  rootRecoveryRuntime.push(run('react-root-runtime.mjs',{NODE_ENV:build,PRODUCTTRACE_REACT_BUILD:build,PRODUCTTRACE_ROOT_SURFACE:surface,
    PRODUCTTRACE_ROOT_HYDRATE:'1',PRODUCTTRACE_ROOT_MISMATCH:'1'}));
const lazy=run('react-lazy-rule.mjs');
const lazyRuntime=['development','production'].map(build=>run('react-lazy-runtime.mjs',{PRODUCTTRACE_REACT_BUILD:build,NODE_ENV:build}));
const factory=run('react-factory-rule.mjs');
const factoryRuntime=['development','production'].map(build=>run('react-factory-runtime.mjs',{PRODUCTTRACE_REACT_BUILD:build,NODE_ENV:build}));
const clones=run('react-clone-rule.mjs');
const cloneRuntime=['development','production'].map(build=>run('react-clone-runtime.mjs',{PRODUCTTRACE_REACT_BUILD:build,NODE_ENV:build}));
const elements=run('react-element-rule.mjs');
const elementRuntime=['development','production'].map(build=>run('react-element-runtime.mjs',{PRODUCTTRACE_REACT_BUILD:build,NODE_ENV:build}));
const children=run('react-children-rule.mjs');
const childrenRuntime=['development','production'].map(build=>run('react-children-runtime.mjs',{PRODUCTTRACE_REACT_BUILD:build,NODE_ENV:build}));
const debugValue=run('react-debug-value-rule.mjs');
const debugValueRuntime=['development','production'].map(build=>run('react-debug-value-runtime.mjs',{PRODUCTTRACE_REACT_BUILD:build,NODE_ENV:build}));
const portal=run('react-portal-rule.mjs');
const portalRuntime=['development','production'].map(build=>run('react-portal-runtime.mjs',{PRODUCTTRACE_REACT_BUILD:build,NODE_ENV:build}));
const wrappers=run('react-wrapper-rule.mjs');
const wrapperDevelopment=run('react-wrapper-runtime.mjs');
const wrapperProduction=run('react-wrapper-runtime.mjs',{PRODUCTTRACE_REACT_BUILD:'production'});
const wrapperHydrationDevelopment=run('react-wrapper-runtime.mjs',{PRODUCTTRACE_REACT_HYDRATE:'1'});
const wrapperHydrationProduction=run('react-wrapper-runtime.mjs',{PRODUCTTRACE_REACT_HYDRATE:'1',PRODUCTTRACE_REACT_BUILD:'production',NODE_ENV:'production'});
const wrapperOwnership=[];
for(const build of ['development','production'])for(const hydration of [false,true])wrapperOwnership.push(run('react-wrapper-runtime.mjs',{
  PRODUCTTRACE_REACT_WRAPPER_DEFAULT_MEMO:'1',PRODUCTTRACE_REACT_WRAPPER_SIBLINGS:'1',PRODUCTTRACE_REACT_STRICT:'1',
  PRODUCTTRACE_REACT_BUILD:build,NODE_ENV:build,PRODUCTTRACE_REACT_HYDRATE:hydration?'1':'0'}));
const deferred=run('react-deferred-rule.mjs');
const deferredDevelopment=run('react-deferred-runtime.mjs');
const deferredProduction=run('react-deferred-runtime.mjs',{PRODUCTTRACE_REACT_BUILD:'production'});
const deferredHydrationDevelopment=run('react-deferred-runtime.mjs',{PRODUCTTRACE_REACT_HYDRATE:'1'});
const deferredHydrationProduction=run('react-deferred-runtime.mjs',{PRODUCTTRACE_REACT_HYDRATE:'1',PRODUCTTRACE_REACT_BUILD:'production',NODE_ENV:'production'});
const transition=run('react-transition-rule.mjs');
const transitionDevelopment=run('react-transition-runtime.mjs');
const transitionProduction=run('react-transition-runtime.mjs',{PRODUCTTRACE_REACT_BUILD:'production'});
const transitionHydrationDevelopment=run('react-transition-runtime.mjs',{PRODUCTTRACE_REACT_HYDRATE:'1'});
const transitionHydrationProduction=run('react-transition-runtime.mjs',{PRODUCTTRACE_REACT_HYDRATE:'1',PRODUCTTRACE_REACT_BUILD:'production',NODE_ENV:'production'});
const ids=run('react-id-rule.mjs');
const idLifetimes=[];
for(const build of ['development','production'])for(const hydrate of [false,true])
  idLifetimes.push(run('react-id-lifetime-runtime.mjs',{PRODUCTTRACE_REACT_BUILD:build,NODE_ENV:build,PRODUCTTRACE_REACT_HYDRATE:hydrate?'1':'0'}));
const idLifetimePass=idLifetimes.length===4&&idLifetimes.every(row=>row.immutable_aliases&&row.aria_relationship
  &&row.interrupted_attempt_not_committed&&row.suspense_hide_reveal&&row.lifetime_commits>=12
  &&row.independent_commit_mutants_rejected>=5&&row.sibling_origin_rejected&&row.same_value_foreign_root_rejected
  &&(!row.hydration||row.hydration_dom_reused));
const idDevelopment=run('react-id-runtime.mjs');
const idProduction=run('react-id-runtime.mjs',{PRODUCTTRACE_REACT_BUILD:'production'});
const idHydrationDevelopment=run('react-id-runtime.mjs',{PRODUCTTRACE_REACT_HYDRATE:'1'});
const idHydrationProduction=run('react-id-runtime.mjs',{PRODUCTTRACE_REACT_HYDRATE:'1',PRODUCTTRACE_REACT_BUILD:'production',NODE_ENV:'production'});
const externalStore=run('react-external-store-rule.mjs');
const storeDevelopment=run('react-external-store-runtime.mjs');
const storeProduction=run('react-external-store-runtime.mjs',{PRODUCTTRACE_REACT_BUILD:'production'});
const storeRetainedDevelopment=run('react-external-store-runtime.mjs',{PRODUCTTRACE_REACT_STORE_RETAINED:'1'});
const storeRetainedProduction=run('react-external-store-runtime.mjs',{PRODUCTTRACE_REACT_STORE_RETAINED:'1',PRODUCTTRACE_REACT_BUILD:'production'});
const storeHydrationDevelopment=run('react-external-store-runtime.mjs',{PRODUCTTRACE_REACT_HYDRATE:'1'});
const storeHydrationProduction=run('react-external-store-runtime.mjs',{PRODUCTTRACE_REACT_HYDRATE:'1',PRODUCTTRACE_REACT_BUILD:'production',NODE_ENV:'production'});
const imperative=run('react-imperative-handle-rule.mjs');
const imperativeDevelopment=run('react-imperative-handle-runtime.mjs');
const imperativeProduction=run('react-imperative-handle-runtime.mjs',{PRODUCTTRACE_REACT_BUILD:'production'});
const interruptedRender=['development','production'].map(build=>run('react-interrupted-render-runtime.mjs',{
  NODE_ENV:build,PRODUCTTRACE_REACT_BUILD:build}));
const interruptedRenderPass=interruptedRender.length===2&&interruptedRender.every(row=>row.exact_boundary_source
  &&row.fallback_commit_to_abandoned_attempt&&row.retry_commit_to_children&&row.superseded_transition_attempt
  &&row.sibling_root_isolation&&row.uncommitted_effect_rejected&&row.context_retry_lineage
  &&row.imperative_factory_only_after_commit&&row.corrupt_origin_commit_selection_and_replacement_rejected);
const scopes=run('react-scope-rule.mjs');
const contexts=run('react-context-rule.mjs');
const contextDevelopment=run('react-context-runtime.mjs');
const contextProduction=run('react-context-runtime.mjs',{PRODUCTTRACE_REACT_BUILD:'production'});
const contextUseDevelopment=run('react-context-use-runtime.mjs');
const contextUseProduction=run('react-context-use-runtime.mjs',{PRODUCTTRACE_REACT_BUILD:'production'});
const contextEffectsDevelopment=run('react-context-effects-runtime.mjs');
const contextEffectsProduction=run('react-context-effects-runtime.mjs',{PRODUCTTRACE_REACT_BUILD:'production'});
const refs=run('react-ref-rule.mjs');
const refRuntime=[];
for(const build of ['development','production'])for(const strict of [false,true])refRuntime.push(run('react-ref-runtime-recording.mjs',{
  PRODUCTTRACE_REACT_BUILD:build,PRODUCTTRACE_REACT_REF_STRICT:strict?'1':'0'}));
const refDevelopment=refRuntime.find(row=>row.build==='development'&&!row.strict);
const refProduction=refRuntime.find(row=>row.build==='production'&&!row.strict);
const refMethods=[];
for(const build of ['development','production'])for(const named of [false,true])refMethods.push(run('react-ref-method-runtime.mjs',{
  PRODUCTTRACE_REACT_BUILD:build,PRODUCTTRACE_REACT_REF_NAMED:named?'1':'0'}));
const predicate=run('react-element-predicate-rule.mjs');
const predicateDevelopment=run('react-element-predicate-runtime.mjs');
const predicateProduction=run('react-element-predicate-runtime.mjs',{PRODUCTTRACE_REACT_BUILD:'production'});
const scopeDevelopment=run('react-scope-runtime-recording.mjs');
const scopeProduction=run('react-scope-runtime-recording.mjs',{PRODUCTTRACE_REACT_BUILD:'production'});
const server=run('react-server-api-runtime-integration.mjs');
const serverProduction=run('react-server-api-runtime-integration.mjs',{NODE_ENV:'production'});
const clientDevelopment=run('react-api-runtime-integration.mjs');
const clientProduction=run('react-api-runtime-integration.mjs',{PRODUCTTRACE_REACT_BUILD:'production'});
const development=run('react-runtime-lifecycle-recording.mjs');
const production=run('react-runtime-lifecycle-recording.mjs',{PRODUCTTRACE_REACT_BUILD:'production'});
assert.equal(development.installed_source_attested,true);
assert.equal(production.installed_source_attested,true);
const scopedPass=behavior.format_pass && behavior.behavior_pass && behavior.well_formed_incorrect_rule_rejected
  && development.retained_callback_path_verified && production.retained_callback_path_verified;
assert.equal(scopedPass,true,'the existing scope must continue passing before extending coverage');
const rows=REACT_API_INVENTORY.map(api=>{
  const rule=api.behavior?.execution;
  const format=validateReactExecutionRule(rule);
  const retainedScope=api.id===behavior.api && scopedPass;
  const effectScope=api.surface==='react' && effects.apis.includes(api.export) && effects.behavior_pass
    && effects.independently_rejected_mutants>=5 && [clientDevelopment,clientProduction].every(result=>
      ['callback_invoked','cleanup_invoked'].every(operation=>result.joined_lifecycle_operations?.[api.id]?.includes(operation)));
  const memoScope=api.id===memo.api && memo.format_pass && memo.behavior_pass && memo.incorrect_rule_counterexamples>=4
    && development.memo_value_path_verified && production.memo_value_path_verified;
  const literalScope=literal.apis.includes(api.id) && literal.format_pass && literal.behavior_pass
    && literal.well_formed_incorrect_rules_rejected===6 && clientDevelopment.literal_export_paths_verified
    && clientProduction.literal_export_paths_verified && server.literal_export_paths_verified
    && serverProduction.literal_export_paths_verified;
  const stateBehavior=state.results.find(row=>row.api===api.id);
  const stateScope=stateBehavior && state.format_pass && state.behavior_pass && stateBehavior.wrong_rules_rejected>=2
    && [development,production].every(row=>row.recording_stop_preserves_queued_state && row.state_priority_replay_observed
      && (api.export==='useState'?row.state_updater_path_verified:row.reducer_action_path_verified));
  const stateLifecycleScope=stateScope&&[development,production].every(row=>row.state_initializer_return_path_verified
    &&row.state_commit_attribution_verified&&row.state_remount_identity_verified
    &&row.state_errors_and_unmount_verified&&row.state_dynamic_callback_paths_verified);
  const scopeBehavior=scopes.builds.flatMap(row=>row.rows).filter(row=>row.api===api.id);
  const scopePass=scopeBehavior.length===2 && scopes.format_pass && scopes.behavior_pass
    && scopeBehavior.every(row=>row.incorrect_rules_rejected>=3 && row.scheduling_observed && row.async_continuation_outside)
    && [scopeDevelopment,scopeProduction].every(row=>row.scope_path_verified && row.apis.includes(api.id) && row.unknown_callback_frontier);
  const scopeCommitPass=scopePass&&[scopeDevelopment,scopeProduction].every(row=>row.scoped_state_commits===6
    &&row.cross_scope_commit_mutants_rejected>=3);
  const predicateScope=api.id===predicate.api && predicate.format_pass && predicate.behavior_pass
    && predicate.builds.every(row=>row.incorrect_rules_rejected>=5 && row.getter_proxy_reads_preserved && row.exception_identity)
    && [predicateDevelopment,predicateProduction].every(row=>row.installed_source_attested && row.observed_boolean_source_branches
      && row.immutable_alias_and_negation && row.thrown_call_has_no_false_completion && row.missing_result_rejected
      && row.consumed_condition_paths===8 && row.independent_consumption_mutants_rejected>=6
      && row.missing_call_receipts_rejected && row.separate_callback_frames);
  const refBehavior=refs.builds.flatMap(row=>row.results).filter(row=>row.api===api.id);
  const refScope=refBehavior.length===2 && refs.format_pass && refs.behavior_pass && refBehavior.every(row=>row.incorrect_rules_rejected>=4)
    && [refDevelopment,refProduction].every(row=>row.installed_source_attested && row.creation_read_write_paths
      && row.sibling_ref_identity && row.native_click_link && row.wrong_ref_and_action_rejected && row.getter_setter_once && row.stopped_recording_transparent);
  const refHostScope=refScope && [refDevelopment,refProduction].every(row=>row.host_attachment_and_write_provenance
    && row.host_attachment_mutants_rejected>=3
    && row.initialization_and_commit_causality==='committed_initial_cell_and_host_attachment_proven');
  const refReferenceScope=refScope && refMethods.length===4 && refMethods.every(row=>row.apis.includes(api.id)
    && row.ref_callback_source_path && row.receiver_and_argument_order && row.getter_argument_failures
    && row.unknown_target_abstention && row.missing_source_rejected && row.immutable_ref_aliases
    && row.dot_bracket_and_parenthesized_reference_calls && ['named','namespace'].includes(row.import_form));
  const refInitializationScope=refScope && api.export==='useRef' && refRuntime.length===4 && refRuntime.every(row=>
    row.initialization_lifecycle_boundaries && row.wrong_initial_value_rejected && row.stable_hook_identity
    && row.hook_commit_mutants_rejected>=3 && row.remount_and_escaped_reader
    && row.initialization_and_commit_causality==='committed_initial_cell_and_host_attachment_proven');
  const contextScope=contexts.apis.includes(api.id) && contexts.format_pass && contexts.behavior_pass
    && contexts.builds.every(row=>row.incorrect_programs_rejected>=7)
    && [contextDevelopment,contextProduction].every(row=>row.context_rule_provider_selection && row.explicit_undefined
      && row.nested_and_foreign_providers && row.incomplete_ancestry_rejected && row.wrong_provider_evidence_rejected)
    && contextDevelopment.consumer_callback && contextProduction.consumer_owner_frontier;
  const contextOriginScope=contextScope && [contextDevelopment,contextProduction].every(row=>row.default_and_object_value_identity==='verified_scoped'
    && row.context_origins_verified>=3 && row.missing_creation_rejected && row.wrong_value_identity_rejected);
  const contextUseScope=[contextUseDevelopment,contextUseProduction].every(row=>row.apis.includes(api.id)
    && row.retained_context_value_use && row.skipped_branch_no_read && row.shorthand_preserved
    && row.sibling_origin_rejected && row.missing_read_rejected && row.substituted_value_rejected
    && row.remount_and_unmounted_callback && row.stopped_recording_transparent);
  const contextEffectScope=[contextEffectsDevelopment,contextEffectsProduction].every(row=>
    (row.apis.includes(api.export) || api.export==='useContext') && row.callback_invocation_link
    && row.skipped_branch_no_read && row.sibling_invocation_rejected && row.missing_invocation_rejected
    && row.sibling_read_rejected && row.wrong_value_rejected && row.inactive_invocation_no_evidence
    && row.stopped_recording_transparent);
  const contextCleanupScope=contextEffectScope && [contextEffectsDevelopment,contextEffectsProduction].every(row=>
    row.cleanup_reads===12 && row.cleanup_keeps_setup_render && row.cleanup_missing_invocation_rejected && row.cleanup_newer_read_rejected);
  const imperativeScope=api.id===imperative.api && imperative.format_pass && imperative.behavior_pass
    && imperative.builds.every(row=>row.incorrect_programs_rejected>=7)
    && [imperativeDevelopment,imperativeProduction].every(row=>row.factory_path_verified && row.ref_identity_update
      && row.null_ref_no_factory && row.unchanged_dependencies_retain && row.sibling_and_remount_identity
      && row.missing_invocation_rejected && row.sibling_invocation_rejected && row.duplicate_result_rejected
      && row.wrong_arguments_rejected && row.stopped_recording_transparent && row.context_read_to_factory_result);
  const handleReadScope=imperativeScope && [imperativeDevelopment,imperativeProduction].every(row=>
    row.handle_object_provenance && row.handle_ref_reads===6 && row.missing_handle_origin_rejected
    && row.handle_kind_mismatch_rejected && row.shared_handle_origin_ambiguous);
  const interruptedRenderScope=interruptedRenderPass&&interruptedRender.every(row=>row.apis.includes(api.id));
  const storeScope=api.id===externalStore.api && externalStore.format_pass && externalStore.behavior_pass
    && externalStore.builds.every(row=>row.incorrect_programs_rejected>=6)
    && [storeDevelopment,storeProduction].every(row=>row.subscription_notification_snapshot_path && row.stable_subscription_identity
      && row.unchanged_snapshot_no_render && row.thrown_getter_preserved && row.sibling_remount_lineage
      && row.missing_notification_rejected && row.sibling_notification_rejected && row.missing_callback_rejected
      && row.wrong_arguments_rejected && row.wrong_session_rejected && row.stop_preserves_subscription_cleanup && row.stop_preserves_subscription_identity
      && row.observed_click_callback_link && row.missing_action_callback_rejected
      && row.outside_click_has_no_action && row.stale_unmounted_listener_rejected);
  const storeHydrationScope=storeScope && [storeHydrationDevelopment,storeHydrationProduction].every(row=>
    row.hydration && row.hydration_reused_server_dom && row.hydration_recovery_errors===0 && row.subscription_notification_snapshot_path);
  const storeCompositionScope=[storeRetainedDevelopment,storeRetainedProduction].every(row=>row.retained_callback_input_proven
    && row.retained_callback_dependency_replacement && row.missing_and_sibling_retained_origin_rejected
    && row.detached_listener_keeps_cleanup_history && row.subscription_notification_snapshot_path);
  const idScope=api.id===ids.api && ids.format_pass && ids.behavior_pass && ids.builds.every(row=>row.incorrect_programs_rejected>=6)
    && [idDevelopment,idProduction,idHydrationDevelopment,idHydrationProduction].every(row=>row.hook_id_to_jsx_property
      && row.retention_and_remount && row.root_prefix_isolation && row.native_label_control && row.missing_origin_rejected
      && row.sibling_origin_rejected && row.wrong_value_and_property_rejected && row.stop_preserves_ids
      && row.changed_retained_id_rejected && row.same_value_foreign_root_rejected
      && row.host_commit_attribution==='observed_original_props' && row.host_commits===21 && row.independent_commit_mutants_rejected>=5)
    && [idHydrationDevelopment,idHydrationProduction].every(row=>row.hydration_dom_reused && row.hydration_recovery_errors===0);
  const transitionScope=api.id===transition.api && transition.format_pass && transition.behavior_pass
    && transition.builds.every(row=>row.incorrect_programs_rejected>=6 && row.transition_context_restored && row.async_outside_scope)
    && [transitionDevelopment,transitionProduction,transitionHydrationDevelopment,transitionHydrationProduction].every(row=>
      row.installed_source_attested && row.retained_start_to_actual_callback && row.retention_and_remount
      && row.throw_identity_preserved && row.unmounted_callback_still_invoked && row.missing_origin_rejected
      && row.sibling_start_mismatch_rejected && row.stop_preserves_behavior
      && row.pending_boolean_to_source_branch && row.pending_origin_mutants_rejected && row.named_conditional_callback_paths
      && row.old_named_captures && row.unknown_callback_abstained && row.wrong_named_candidate_rejected && row.missing_named_origin_rejected);
  const transitionCommitScope=transitionScope&&[scopeDevelopment,scopeProduction].every(row=>
    row.apis.includes(api.id)&&row.scoped_state_commits===6&&row.cross_scope_commit_mutants_rejected>=3);
  const deferredScope=api.id===deferred.api && deferred.format_pass && deferred.behavior_pass
    && deferred.builds.every(row=>row.incorrect_programs_rejected>=6 && row.signed_zero_and_nan && row.function_values_not_invoked && row.unknown_urgency_rejected)
    && [deferredDevelopment,deferredProduction,deferredHydrationDevelopment,deferredHydrationProduction].every(row=>
      row.installed_source_attested && row.previous_value_to_jsx && row.current_input_to_jsx && row.sibling_and_root_isolation
      && row.missing_origin_rejected && row.wrong_value_and_source_rejected && row.sibling_previous_rejected && row.stop_preserves_behavior);
  const wrapperScope=wrappers.apis.includes(api.id) && wrappers.format_pass && wrappers.behavior_pass
    && wrappers.builds.every(row=>row.rows.find(value=>value.api===api.id)?.incorrect_programs_rejected>=5)
    && [wrapperDevelopment,wrapperProduction,wrapperHydrationDevelopment,wrapperHydrationProduction].every(row=>
      row.installed_source_attested && row.source_redirect_to_actual_controls && row.rendered_effects_match_selected_component && row.stop_preserves_behavior
      && row.wrapper_creation_to_body_entries>=6 && row.original_function_identity_preserved && row.outside_renderer_call_abstained
      && row.click_to_exact_wrapper_owner)
    && wrapperOwnership.every(row=>row.sibling_owners_verified && row.default_memo && row.strict_mode
      && row.click_to_exact_wrapper_owner && row.original_function_identity_preserved && row.wrapper_creation_to_body_entries>=12
      && row.strict_boundary_semantics==='element_description_only');
  const wrapperOutcomeScope=wrapperScope && [wrapperDevelopment,wrapperProduction,wrapperHydrationDevelopment,wrapperHydrationProduction,...wrapperOwnership].every(row=>
    row.body_outcome_joins>=10 && row.body_outcome_mutations_rejected===16 && row.missing_invocation_outcomes_rejected
    && row.original_output_values_verified && row.callback_completion_proof==='observed_body_outcome'
    && (row.build!=='development' || row.diagnostic_throws_joined>0));
  const forwardedRefScope=wrapperScope && api.export==='forwardRef'
    && wrappers.builds.every(build=>build.rows.find(row=>row.api===api.id)?.ref_input_policy_pass
      && build.rows.find(row=>row.api===api.id)?.incorrect_ref_programs_rejected===5)
    && [wrapperDevelopment,wrapperProduction,wrapperHydrationDevelopment,wrapperHydrationProduction,...wrapperOwnership].every(row=>
      row.forwarded_ref_argument_verified && row.ref_replacement_null_callback_object && row.ref_evidence_mutations_rejected===8
      && row.diagnostic_replay_ref_abstained && row.object_ref_getter_not_read && row.original_ref_setter_receiver_preserved);
  const boundaryScope=boundaries.apis.includes(api.id) && boundaries.format_pass && boundaries.behavior_pass
    && boundaries.builds.every(row=>row.rows.find(value=>value.api===api.id)?.incorrect_programs_rejected>=6)
    && boundaryRuntime.every(row=>row.installed_source_attested && row.element_descriptions===4 && row.source_controls_resolved===4
      && row.wrong_or_missing_marker_rejected && row.stop_preserves_behavior && row.renderer_execution_proven===false)
    && boundaryFallback.every(row=>row.fallback_control_joined && row.source_controls_resolved===4)
    && [...boundaryRuntime,...boundaryFallback].every(row=>row.boundary_inputs_committed>=4&&row.renderer_selections_verified
      && row.incorrect_renderer_rules_rejected>=12&&row.corrupted_commit_receipts_rejected>=16
      && row.click_path_conditions_discharged===4&&row.missing_foreign_stale_boundary_proof_rejected)
    && boundaryProps.installed_source_attested && boundaryProps.prop_precedence_verified && boundaryProps.unknown_spread_abstained;
  const portalScope=api.id===portal.api && portal.format_pass && portal.behavior_pass
    && portal.builds.every(row=>row.incorrect_programs_rejected>=6 && row.children_not_called
      && row.key_coercion_left_to_library && row.invalid_containers_rejected && row.server_portal_render_rejected)
    && portalRuntime.every(row=>row.installed_source_attested && row.source_child_to_native_control
      && row.portal_description_observations===5 && row.portal_commit_observations>=3 && row.portal_unmount_observations>=2 && row.callback_body_entries===3
      && row.container_change_and_key_update_preserve_callback && row.independent_description_mutants_rejected>=6
      && row.stop_preserves_behavior && row.source_guard_retained && row.host_commit_lineage_proven
      && row.portal_description_to_exact_click_occurrence_proven && row.react_parent_event_ancestry_proven
      && row.unmounted_lifetime_proven && row.uncommitted_description_withheld && row.interrupted_render_withheld
      && row.immutable_api_alias_proven);
  const debugValueScope=api.id===debugValue.api && debugValue.format_pass && debugValue.behavior_pass
    && debugValue.builds.reduce((n,row)=>n+row.incorrect_programs_rejected,0)>=5
    && debugValue.builds.every(row=>row.normal_formatter_calls===0 && row.exact_dispatcher_arguments_and_return && row.dispatcher_throw_preserved)
    && debugValueRuntime.every(row=>row.installed_source_attested && row.normal_render_observations===2
      && row.source_callback_path_unchanged && row.normal_renderer_did_not_call_formatter && row.formatter_identity_preserved
      && row.manual_formatter_not_product_callback && row.execution_context_not_inferred
      && row.independent_mutants_rejected>=4 && row.stop_preserves_behavior && row.official_devtools_inspection_tested===false);
  const childrenScope=api.id===children.api && children.format_pass && children.behavior_pass
    && children.builds.every(row=>row.incorrect_programs_rejected>=10 && row.element_and_fragment_children_opaque
      && row.receiver_and_index_verified && row.only_requires_element && row.accessors_and_iterators_abstained && row.callback_throw_preserved)
    && childrenRuntime.every(row=>row.installed_source_attested && row.methods.length===5 && row.observed_callbacks===18
      && row.source_callback_paths_verified && row.receiver_and_indices_verified && row.callback_throw_preserved
      && row.action_occurrences_joined && row.missing_action_rejected && row.independent_mutants_rejected>=5
      && row.stop_preserves_behavior && row.input_traversal_proven===false && row.result_keys_proven===false);
  const elementScope=api.id===elements.api && elements.format_pass && elements.behavior_pass
    && elements.builds.every(row=>row.incorrect_programs_rejected>=8 && row.component_and_callbacks_not_invoked
      && row.own_enumerable_and_reserved_props && row.children_precedence_and_defaults && row.inherited_key_and_ref
      && row.owner_policy_format_rejected && row.accessors_and_coercions_abstained && row.original_throw_preserved)
    && elementRuntime.every(row=>row.installed_source_attested && row.description_observations===4 && row.actual_clicks===6
      && row.component_type_to_source_controls && row.explicit_props_reach_callback && row.independent_mutants_rejected>=8
      && row.native_type_alias_to_source_control && row.create_element_config_stamped && row.owner_policy_verified
      && row.stop_preserves_behavior && row.descriptor_to_exact_host_commit_proven===false && row.runtime_property_input_relations_proven);
  const elementCommitScope=elementScope&&elementRuntime.every(row=>row.descriptor_props_to_committed_owner
    && row.unrendered_description_not_selected && row.commit_lineage_mutants_rejected>=4);
  const elementOwnerScope=elementScope&&elementRuntime.find(row=>row.build==='development')?.owner_lineage_to_committed_fiber
    && elementRuntime.find(row=>row.build==='production')?.production_owner_is_null
    && elementRuntime.every(row=>row.ref_input_to_committed_host);
  const cloneScope=api.id===clones.api && clones.format_pass && clones.behavior_pass
    && clones.builds.every(row=>row.incorrect_programs_rejected>=9 && row.unchanged_props_preserved && row.supplied_undefined_defaults
      && row.positional_undefined_not_defaulted && row.ref_owner_replacement && row.symbol_props_copied && row.component_not_invoked
      && row.unknown_owner_and_accessors_abstained && row.throw_identity_preserved)
    && cloneRuntime.every(row=>row.installed_source_attested && row.description_observations===8 && row.actual_clicks===4 && row.original_description_required
      && row.overridden_props_select_source_path && row.component_type_to_source_controls && row.explicit_props_reach_callback
      && row.immutable_original_aliases && row.native_type_alias_to_source_control && row.clone_config_stamped
      && row.independent_mutants_rejected>=8 && row.stop_preserves_behavior && row.descriptor_to_exact_host_commit_proven===false
      && row.runtime_property_input_relations_proven);
  const cloneCommitScope=cloneScope&&cloneRuntime.every(row=>row.descriptor_props_to_committed_owner
    && row.commit_lineage_mutants_rejected>=4);
  const cloneOwnerScope=cloneScope&&cloneRuntime.find(row=>row.build==='development')?.owner_lineage_to_committed_fiber
    && cloneRuntime.find(row=>row.build==='production')?.production_owner_is_null
    && cloneRuntime.every(row=>row.ref_input_to_committed_host);
  const actScope=act.apis.includes(api.id) && act.format_pass && act.behavior_pass
    && act.builds.every(row=>row.aliases_identical && row.incorrect_programs_rejected>0)
    && act.builds.find(row=>row.build==='development').queue_drain_checked
    && act.builds.find(row=>row.build==='production').production_rejects_before_callback
    && actRuntime.every(row=>row.installed_source_attested && row.actual_clicks===3 && row.stop_preserves_behavior
      && row.await_completion_observed===false && row.queue_drain_observed===false
      && (row.build==='development'?row.callback_paths_joined && row.scope_observations===6 && row.independent_mutants_rejected>=6
        && row.original_error_preserved && row.async_and_nested_calls_preserved && row.synchronous_scoped_state_commits===2
        && row.post_await_state_commit_attribution_proven===false:row.production_callback_abstention && row.scope_observations===2));
  const factoryScope=api.id===factory.api && factory.format_pass && factory.behavior_pass
    && factory.builds.every(row=>row.cases===8 && row.incorrect_programs_rejected>=8 && row.component_not_invoked
      && row.fresh_factories && row.type_property_not_binding && row.original_getter_error_preserved)
    && factoryRuntime.every(row=>row.installed_source_attested && row.description_observations===6 && row.actual_clicks===4 && row.factory_allocation_required
      && row.immutable_alias_selects_source_path && row.explicit_props_reach_callback && row.independent_mutants_rejected>=8
      && row.native_type_alias_to_source_control && row.factory_config_stamped
      && row.stop_preserves_behavior && row.descriptor_to_exact_host_commit_proven===false && row.runtime_property_input_relations_proven);
  const factoryCommitScope=factoryScope&&factoryRuntime.every(row=>row.descriptor_props_to_committed_owner
    && row.commit_lineage_mutants_rejected>=4);
  const factoryOwnerScope=factoryScope&&factoryRuntime.find(row=>row.build==='development')?.owner_lineage_to_committed_fiber
    && factoryRuntime.find(row=>row.build==='production')?.production_owner_is_null
    && factoryRuntime.every(row=>row.ref_input_to_committed_host);
  const lazyScope=api.id===lazy.api && lazy.format_pass && lazy.behavior_pass
    && lazy.builds.every(row=>row.incorrect_programs_rejected>=6 && row.pending_reuses_loader && row.first_settlement_wins
      && row.synchronous_loader_error_retries && row.registration_error_keeps_settlement && row.rejection_cached
      && row.unsettled_registration_error_retries && row.module_getters_not_replayed_by_planner)
    && lazyRuntime.every(row=>row.installed_source_attested && row.lazy_observations===3 && row.real_renderer_invokes_loader
      && row.pending_and_resolved_cache_reused && row.allocation_and_source_required && row.independent_mutants_rejected>=11
      && row.stop_preserves_behavior && row.thenable_settlement_observed && row.module_selection_through_verified_rule
      && row.fallback_reveal_retry_commit && row.direct_module_read_by_tracer===false);
  const rootScope=roots.apis.includes(api.id) && roots.format_pass && roots.behavior_pass
    && roots.builds.every(build=>build.rows.length===4 && build.rows.every(row=>row.incorrect_programs_rejected>=8
      && row.scheduled_not_committed_at_creation && row.identifier_prefix_consumed && row.render_callback_ignored
      && row.recoverable_error_option_checked&&row.format_mutants_rejected>=2
      && row.unmount_cleanup_observed && row.repeat_unmount_noop && row.render_after_unmount_rejected && row.invalid_containers_rejected))
    && rootRuntime.length===8 && rootRuntime.filter(row=>row.api===api.id).length===2
    && rootRuntime.filter(row=>row.api===api.id).every(row=>row.installed_source_attested && row.actual_clicks===4&&row.recovery_callback_registered
      && row.root_observations===(row.hydrate?7:8) && row.root_handle_to_renderer_identity && row.original_methods_preserved
      && row.lifetime_and_late_render_verified && (!row.hydrate || row.hydration_reused_dom)
      && row.independent_mutants_rejected>=6 && row.stop_preserves_behavior
      && row.render_to_commit_attribution_proven && row.abandoned_render_not_committed && row.root_commit_observations===3
      && row.root_commit_mutants_rejected>=6 && row.unmount_to_empty_root_commit && row.cleanup_invocation_attribution
      && row.cleanup_completion_proven===false && row.disposal_mutants_rejected>=4)
    && rootAliasRuntime.filter(row=>row.api===api.id).length===2
    && rootAliasRuntime.filter(row=>row.api===api.id).every(row=>row.aliases&&row.render_to_commit_attribution_proven&&row.abandoned_render_not_committed
      &&row.root_commit_observations===3&&row.root_handle_to_renderer_identity&&row.original_methods_preserved)
    && (!api.id.includes('hydrateRoot')||rootRecoveryRuntime.filter(row=>row.api===api.id).length===2
      &&rootRecoveryRuntime.filter(row=>row.api===api.id).every(row=>row.recovery_scenario&&row.recovery_callbacks>=1&&row.recovery_mutants_rejected>=5));
  const serverStringScope=serverStrings.apis.includes(api.id)&&serverStrings.format_pass&&serverStrings.behavior_pass
    &&serverStrings.builds.every(build=>build.rows.length===2&&build.rows.every(row=>row.incorrect_programs_rejected>=8&&row.synchronous_component
      &&row.client_effects_and_events_not_invoked&&row.prefix_and_escaping&&row.output_markers_verified&&row.pending_fallback_without_waiting
      &&row.outside_boundary_rejected&&row.fatal_error_identity_preserved&&row.option_getter_not_replayed))
    &&serverStringRuntime.length===8&&serverStringRuntime.filter(row=>row.api===api.id).length===4
    &&serverStringRuntime.filter(row=>row.api===api.id).every(row=>row.installed_source_attested&&row.source_component_edges===2&&row.server_observations===4
      &&row.successful_input_component_return_joins===3&&row.argument_evaluation_excluded&&row.nested_requests_isolated
      &&row.original_html_and_error_preserved&&row.independent_mutants_rejected>=13&&row.html_not_retained&&row.thrown_return_abstained
      &&(!row.browser||row.browser_stop_verified)&&row.direct_renderer_dispatch_proven===false&&row.hydration_proven===false);
  const legacyStreamScope=legacyStreams.apis.includes(api.id)&&legacyStreams.format_pass&&legacyStreams.behavior_pass
    &&legacyStreams.builds.every(build=>build.rows.length===2&&build.rows.every(row=>row.incorrect_programs_rejected>=9&&row.synchronous_initial_component
      &&row.hydratable_marker_quirk_verified&&row.all_tasks_before_output&&row.retry_after_resolution&&row.destroy_aborts_pending_work
      &&row.browser_rejected_before_component&&row.prefix_and_escaping&&row.effects_not_invoked))
    &&legacyStreamRuntime.length===4&&legacyStreamRuntime.filter(row=>row.api===api.id).length===2
    &&legacyStreamRuntime.filter(row=>row.api===api.id).every(row=>row.installed_source_attested&&row.source_component_edges===2&&row.server_observations===4
      &&row.successful_input_component_return_joins===3&&row.original_stream_objects_preserved&&row.argument_evaluation_excluded&&row.nested_requests_isolated
      &&row.original_html_and_error_preserved&&row.independent_mutants_rejected>=13&&row.html_not_retained
      &&row.failed_stream_creation_status==='resolved'&&row.completed_streams_joined===2&&row.consumer_failures_abstained===1
      &&row.stream_completion_proven===true&&row.async_component_lineage_proven===false&&row.hydration_proven===false);
  const hostScope=api.id===hostLookup.api&&hostLookup.format_pass&&hostLookup.behavior_pass
    &&hostLookup.builds.every(row=>row.incorrect_programs_rejected>=9&&row.current_host_after_updates&&row.first_host_text_and_portal
      &&row.null_and_empty&&row.unmounted_rejected&&row.ordinary_property_access_and_error_identity)
    &&hostRuntime.every(row=>row.installed_source_attested&&row.actual_clicks===8&&row.host_joins===7&&row.current_class_snapshots===5
      &&row.current_host_text_portal_and_empty&&row.native_passthrough&&row.action_receipts_required&&row.independent_mutants_rejected>=8
      &&row.unknown_getter_not_replayed&&row.proxy_error_identity_preserved&&row.stop_preserves_behavior&&row.host_effect_proven===false);
  const legacyUnmountScope=api.id===legacyUnmount.api&&legacyUnmount.format_pass&&legacyUnmount.behavior_pass
    &&legacyUnmount.builds.every(row=>row.incorrect_programs_rejected>=9&&row.cases===13&&row.legacy_and_empty_root&&row.modern_root_preserved
      &&row.comment_document_fragment_validation&&row.synchronous_cleanup&&row.render_phase_true_before_commit&&row.original_getter_error)
    &&legacyUnmountRuntime.every(row=>row.installed_source_attested&&row.actual_clicks===4&&row.host_joins===3&&row.legacy_root_empty_commit
      &&row.repeated_call_noop&&row.action_receipts_required&&row.independent_mutants_rejected>=11&&row.modern_root_preserved
      &&row.render_phase_true_abstains&&row.proxy_error_identity_preserved&&row.root_getter_not_replayed&&row.stop_preserves_behavior&&row.cleanup_completion_proven===false);
  const legacyRenderScope=legacyRender.apis.includes(api.id)&&legacyRender.format_pass&&legacyRender.behavior_pass
    &&legacyRender.builds.every(build=>build.rows.filter(row=>row.api===api.id).length===1&&build.rows.filter(row=>row.api===api.id).every(row=>row.incorrect_programs_rejected>=11
      &&row.initial_commit_before_return&&row.batched_update_deferred&&row.public_class_host_function_and_empty&&row.callback_receiver_arguments_commit&&row.invalid_containers_and_parent&&row.callback_error_identity))
    &&legacyRenderRuntime.filter(row=>row.api===api.id).length===2&&legacyRenderRuntime.filter(row=>row.api===api.id).every(row=>row.installed_source_attested&&row.actual_clicks===7&&row.host_joins===5
      &&row.input_element_commit_public_result&&row.class_native_function_empty&&row.action_receipts_required&&row.independent_mutants_rejected>=11
      &&row.batched_update_abstains&&row.event_update_abstains&&row.nested_update_isolation&&row.proxy_error_identity_preserved&&row.stop_preserves_behavior
      &&row.callback_completion_proven===false&&row.hydration_reuse_proven===false&&row.component_body_execution_proven===false);
  const readableStreamScope=api.id===readableStream.api&&readableStream.format_pass&&readableStream.behavior_pass
    &&readableStream.builds.every(row=>row.incorrect_programs_rejected>=11&&row.initial_component_synchronous&&row.original_promise_and_web_stream
      &&row.shell_before_all_ready&&row.cancel_reason_ignored&&row.future_abort_reason_forwarded&&row.preaborted_signal_ignored&&row.effects_not_invoked&&row.prefix_escaping_markers&&row.fatal_and_getter_rejections_preserved)
    &&readableStreamRuntime.length===4&&readableStreamRuntime.every(row=>row.installed_source_attested&&row.source_component_edges===1&&row.server_observations===10
      &&row.successful_input_component_return_joins===(row.browser&&row.build==='development'?3:4)&&row.unresolved_body_contexts===(row.browser&&row.build==='development'?1:0)
      &&row.argument_evaluation_excluded&&row.nested_requests_isolated&&row.original_html_and_error_preserved&&row.original_promise_identity_preserved
      &&row.independent_mutants_rejected>=13&&row.html_not_retained&&row.rejected_promise_completion_unproven&&row.unmatched_development_body_abstained
      &&(!row.browser||row.browser_stop_verified)&&row.promise_fulfillments_joined===3&&row.completed_streams_joined===3
      &&row.promise_fulfillment_proven===true&&row.stream_completion_proven===true&&row.direct_renderer_dispatch_proven===false&&row.hydration_proven===false);
  const pipeableStreamScope=api.id===pipeableStream.api&&pipeableStream.format_pass&&pipeableStream.behavior_pass
    &&pipeableStream.builds.every(row=>row.incorrect_programs_rejected>=11&&row.initial_render_deferred&&row.shell_before_all_tasks&&row.callbacks_no_arguments
      &&row.original_destination_and_one_pipe&&row.abort_reason_forwarded&&row.effects_not_invoked&&row.prefix_escaping_markers&&row.fatal_and_getter_identity)
    &&pipeableStreamRuntime.every(row=>row.installed_source_attested&&row.source_component_edges===1&&row.allocations===4&&row.async_body_joins===4
      &&row.original_handle_and_methods_preserved&&row.original_html_and_error_preserved&&row.concurrent_and_nested_requests_isolated&&row.argument_and_outside_calls_excluded
      &&row.allocation_receipts_immutable&&row.allocation_receipt_required&&row.evicted_allocation_abstains&&row.independent_mutants_rejected>=26
      &&row.pipe_operations_joined===4&&row.completed_streams_joined===3&&row.errored_streams_joined===1
      &&row.stream_completion_proven===true&&row.direct_renderer_dispatch_proven===false);
  const classScope=classes.apis.includes(api.id)&&classes.format_pass&&classes.behavior_pass
    &&classes.builds.every(build=>build.apis.some(row=>row.api===api.id&&row.incorrect_programs_rejected>=11&&row.constructor_identity_and_falsy_updater
      &&row.original_updater_arguments&&row.render_input_fields&&row.custom_override_and_force&&row.observed_updates===8))
    &&classRuntime.length===4&&classRuntime.every(row=>row.installed_source_attested&&row.class_registrations===2&&row.render_joins>=(row.strict&&row.build==='development'?24:12)
      &&row.actual_clicks===4&&row.click_linked_renders>=6&&row.original_class_method_receiver_and_output_preserved&&row.pure_bailout_preserved
      &&row.sibling_and_remount_isolation&&row.original_input_reads&&row.registration_and_action_receipts_required&&row.manual_calls_abstain
      &&row.stop_preserves_behavior&&row.independent_mutants_rejected>=14&&row.commit_proven===false&&row.update_cause_proven===false&&row.direct_renderer_dispatch_proven===false);
  const classUpdateScope=classScope&&classUpdates.format_pass&&classUpdates.behavior_pass&&classUpdates.builds.length===2
    &&classUpdates.builds.every(build=>build.rows.filter(row=>row.api===api.id).length===2&&build.rows.filter(row=>row.api===api.id).every(row=>row.rule_sha256===createHash('sha256').update(JSON.stringify(api.behavior.members[row.member].execution)).digest('hex')&&row.incorrect_programs_rejected>=(row.member==='setState'?12:7)
      &&row.actual_method_cases===7&&row.original_updater_argument_identity&&row.original_method_return&&row.callback_receiver_arguments&&row.partial_merge_and_null_noop
      &&row.force_bypasses_custom_bailout&&row.first_strict_replay_result_selected))
    &&classUpdateRuntime.length===6&&classUpdateRuntime.every(row=>row.installed_source_attested&&row.actual_clicks===3&&row.source_callback_edges===10&&row.method_joins===(row.legacy?7:6)
      &&row.callback_joins===(row.strict&&row.build==='development'?14:10)+(row.legacy?(row.strict&&row.build==='development'?3:2):0)
      &&row.original_callback_identity_name_arity&&row.original_receiver_arguments_returns&&row.normal_arrow_and_function_callbacks&&row.sibling_requests_isolated
      &&row.custom_method_abstains&&row.getter_error_not_replayed&&row.unmounted_call_does_not_invent_callback&&row.stop_preserves_behavior&&row.request_and_instance_receipts_required
      &&row.evicted_request_abstains&&row.independent_mutants_rejected>=18&&(!row.legacy||row.synchronous_callback_receipts_ordered)
      &&row.queue_execution_proven===false&&row.state_merge_proven===false&&row.commit_proven===false);
  const knownScope=classScope || pipeableStreamScope || readableStreamScope || legacyRenderScope || legacyUnmountScope || hostScope || legacyStreamScope || serverStringScope || rootScope || lazyScope || factoryScope || actScope || cloneScope || elementScope || childrenScope || debugValueScope || portalScope || boundaryScope || wrapperScope || deferredScope || transitionScope || idScope || storeScope || imperativeScope || contextScope || refScope || predicateScope || retainedScope || effectScope || memoScope || literalScope || stateScope || scopePass;
  const requiredScopes=classes.apis.includes(api.id)?['class-construction-and-update-policy-oracle','registered-render-body-and-input-reads','click-scope-sibling-remount-and-strict-identity','constructor-context-ref-and-update-request-lineage','update-method-and-callback-body-lineage','update-result-merge-lineage','lifecycle-cleanup-and-error-boundaries','render-bailout-commit-and-interruption-attribution','hydration-and-broader-class-source-shapes']:api.id===pipeableStream.api?['pipeable-stream-policy-oracle','handle-allocation-async-component-context','concurrent-nested-and-argument-isolation','shell-allready-and-error-callback-lineage','pipe-destination-backpressure-completion','abort-and-destination-lifetimes','broader-component-and-retry-lineage']:api.id===readableStream.api?['readable-stream-policy-oracle','initial-component-promise-return','nested-and-argument-cause-isolation','promise-fulfillment-shell-stream-lineage','async-retry-and-allready-lineage','stream-consumption-cancel-and-signal-lineage','broader-components-and-failure-origin']:legacyRender.apis.includes(api.id)?['legacy-render-policy-oracle','click-input-element-commit-public-result','batched-and-nested-update-frontiers','callback-receiver-commit-lineage','deferred-update-and-component-body-lineage','initial-mode-hydration-and-parent-context-lineage','validation-and-comment-container-provenance']:api.id===legacyUnmount.api?['legacy-unmount-oracle','click-callback-container-empty-commit','repeat-noop-and-in-render-frontier','cleanup-and-ref-detachment-lineage','deferred-request-commit-attribution','comment-container-and-validation-origin']:api.id===hostLookup.api?['host-selection-oracle','committed-class-to-returned-node','click-callback-lookup-occurrence','host-consumer-effect-lineage','interrupted-and-unmount-time-lookups','unknown-input-and-property-branch-provenance']:legacyStreams.apis.includes(api.id)?['legacy-stream-policy-oracle','initial-component-stream-return','nested-and-argument-cause-isolation','async-retry-component-lineage','stream-consumer-completion-and-errors','cancellation-lifetime-lineage','broader-components-context-and-requests']:serverStrings.apis.includes(api.id)?['server-render-policy-oracle','input-component-body-return','nested-and-argument-cause-isolation','suspense-and-error-path-lineage','rendered-markup-input-lineage','broader-components-context-and-requests']:roots.apis.includes(api.id)?['root-operation-oracle','original-handle-method-lifetime','renderer-root-identity','render-to-commit-lineage','cleanup-attribution','options-errors-and-hydration-recovery','aliased-and-dynamic-root-consumers']:api.id===lazy.api?['initializer-state-machine-oracle','allocated-loader-source-invocation','actual-renderer-cache-reuse','settlement-module-selection-lineage','resolved-component-path','rejection-retry-and-interruption-lineage','broader-loader-source-captures']:api.id===factory.api?['bound-construction-oracle','factory-identity-to-element-type','immutable-alias-source-controls','runtime-property-input-lineage','runtime-owner-ref-lineage','descriptor-host-commit-lineage','native-and-dynamic-factory-consumers']:act.apis.includes(api.id)?['build-callback-result-oracle','observed-callback-source-action-path','nested-and-async-transparent-observation','synchronous-state-request-to-commit-attribution','await-queue-completion-lineage','build-attributed-production-failure','overlap-thenable-and-flush-errors']:api.id===clones.api?['clone-precedence-oracle','original-description-type-lineage','nested-source-component-controls','runtime-property-input-lineage','runtime-ref-owner-lineage','descriptor-host-commit-lineage','broader-original-element-consumers']:api.id===elements.api?['construction-precedence-oracle','component-type-source-controls','observed-description-type','runtime-property-input-lineage','descriptor-host-commit-lineage','native-and-dynamic-construction-consumers','owner-ref-validation-and-coercion']:api.id===children.api?['array-and-element-traversal-oracle','observed-callback-source-action-path','runtime-input-traversal-lineage','mapped-flattening-key-rewriting','iterators-accessors-and-failures','broader-callback-consumers']:api.id===debugValue.api?['normal-renderer-and-entrypoint-dispatch','conditional-return-integration','inspection-dispatcher-lineage','formatter-input-result-and-errors']:api.id===portal.api?['descriptor-input-relations','guarded-child-source-path','descriptor-host-commit-lineage','react-parent-context-event-ancestry','interrupted-and-unmounted-lifetimes']:boundaries.apis.includes(api.id)?['registered-type-and-element-description','guarded-render-input-controls','renderer-selection-lineage',...(api.export==='Suspense'?['suspension-resolution-interruption','streaming-hydration','hidden-layout-lifetimes']:api.export==='StrictMode'?['development-replay-attribution','nested-legacy-root-lifetimes']:api.export==='Profiler'?['commit-callback-lineage','profiling-build-timing']:['keyed-reconciliation-identity','invalid-ref-and-props'])]:wrappers.apis.includes(api.id)?['successful-construction-program','component-source-selection','observed-source-control-path','wrapper-to-callback-runtime-lineage','original-component-body-outcome','validation-and-accessor-errors',...(api.export==='memo'?['default-custom-comparison','state-context-bailout','ref-replacement-suspense']:['forwarded-ref-argument-lineage','forwarded-ref-runtime-lineage','interrupted-render-ref-lifetimes'])]:api.id===deferred.api?['urgency-selection-oracle','selected-value-jsx-read','initial-hydration','runtime-priority-attribution','interrupted-suspense-work','callback-and-other-value-consumers']:api.id===transition.api?['tuple-start-retention','returned-start-callback','initial-hydration','pending-value-consumers','update-to-commit-attribution','priority-attribution','interrupted-suspense-work','additional-callback-shapes']:api.id===ids.api?['allocation-retention','hook-to-jsx-property','hydration-root-prefixes','host-commit-attribution','suspense-interruption-lifetimes','additional-id-consumers']:api.id===externalStore.api?['subscription-notification-snapshot','subscription-replacement-lifecycle','snapshot-selection-consumers','hydration-consistency-recovery','notification-commit-attribution']:api.id===imperative.api?['commit-factory-result','dependency-ref-lifecycle','callback-object-ref-write','cleanup-attribution','interrupted-hydrated-error-work']:contexts.apis.includes(api.id)?(api.export==='createContext'?['allocation-default-identity','provider-selection','consumer-invocation','consumer-production-owner','propagation-lifecycle']:['provider-selection','default-object-provenance','notification-lineage','suspense-hydration-unmount','consumer-value-use']):refs.apis.includes(api.id)?['allocation-retention','cell-read-write','sibling-remount-identity','click-callback-cell',
    'reference-call-and-binding-forms','host-attachment-and-write-provenance',...(api.export==='useRef'?['initialization-lifecycle-boundaries']:[])]:api.id===predicate.api?['guard-marker-read','result-source-branch','throw-observation','result-provenance']:api.id===behavior.api
    ? ['retention-and-captures','shared-module-callbacks','abandoned-callbacks','remount-strictmode']
    : api.surface==='react' && effects.apis.includes(api.export) ? ['dependency-setup-cleanup','strict-phase-order','suspense-hydration','errors-and-interruption']
      : api.id===memo.api ? ['calculator-value-lineage','interrupted-cache-retention','cached-callback-consumers','dynamic-calculators']
      : literal.apis.includes(api.id)?['literal-read','build-variants','wrong-value-rejection']
        : stateBehavior?['requests-calculations','state-snapshots','dispatcher-identity','initialization-lineage','queue-priority-rebase','commit-attribution','remount-strictmode','errors-unmount','dynamic-callbacks']:scopeBehavior.length?['callback-arguments-return','click-source-path','nested-call-identity','scoped-state-request-to-commit-attribution','scheduling-and-flush-lineage','dynamic-callback-source','interrupted-hydrated-work']:['api-causal-behavior'];
  const verifiedScopes=classScope?['class-construction-and-update-policy-oracle','registered-render-body-and-input-reads','click-scope-sibling-remount-and-strict-identity',...(classUpdateScope?['update-method-and-callback-body-lineage']:[])]:pipeableStreamScope?['pipeable-stream-policy-oracle','handle-allocation-async-component-context','concurrent-nested-and-argument-isolation']:readableStreamScope?['readable-stream-policy-oracle','initial-component-promise-return','nested-and-argument-cause-isolation']:legacyRenderScope?['legacy-render-policy-oracle','click-input-element-commit-public-result','batched-and-nested-update-frontiers']:legacyUnmountScope?['legacy-unmount-oracle','click-callback-container-empty-commit','repeat-noop-and-in-render-frontier']:hostScope?['host-selection-oracle','committed-class-to-returned-node','click-callback-lookup-occurrence']:legacyStreamScope?['legacy-stream-policy-oracle','initial-component-stream-return','nested-and-argument-cause-isolation']:serverStringScope?['server-render-policy-oracle','input-component-body-return','nested-and-argument-cause-isolation']:rootScope?['root-operation-oracle','original-handle-method-lifetime','renderer-root-identity','render-to-commit-lineage','cleanup-attribution','options-errors-and-hydration-recovery','aliased-and-dynamic-root-consumers']:lazyScope?['initializer-state-machine-oracle','allocated-loader-source-invocation','actual-renderer-cache-reuse','settlement-module-selection-lineage','resolved-component-path']:factoryScope?['bound-construction-oracle','factory-identity-to-element-type','immutable-alias-source-controls','runtime-property-input-lineage','native-and-dynamic-factory-consumers',...(factoryOwnerScope?['runtime-owner-ref-lineage']:[]),...(factoryCommitScope?['descriptor-host-commit-lineage']:[])]:actScope?['build-callback-result-oracle','observed-callback-source-action-path','nested-and-async-transparent-observation','synchronous-state-request-to-commit-attribution']:cloneScope?['clone-precedence-oracle','original-description-type-lineage','nested-source-component-controls','runtime-property-input-lineage','broader-original-element-consumers',...(cloneOwnerScope?['runtime-ref-owner-lineage']:[]),...(cloneCommitScope?['descriptor-host-commit-lineage']:[])]:elementScope?['construction-precedence-oracle','component-type-source-controls','observed-description-type','runtime-property-input-lineage','native-and-dynamic-construction-consumers',...(elementCommitScope?['descriptor-host-commit-lineage']:[]),...(elementOwnerScope?['owner-ref-validation-and-coercion']:[])]:childrenScope?['array-and-element-traversal-oracle','observed-callback-source-action-path']:debugValueScope?['normal-renderer-and-entrypoint-dispatch','conditional-return-integration']:portalScope?['descriptor-input-relations','guarded-child-source-path','descriptor-host-commit-lineage','react-parent-context-event-ancestry','interrupted-and-unmounted-lifetimes']:boundaryScope?['registered-type-and-element-description','guarded-render-input-controls','explicit-input-precedence','renderer-selection-lineage',...(api.export==='Fragment'&&fragmentLifecyclePass?['keyed-reconciliation-identity','invalid-ref-and-props']:[]),...(api.export==='StrictMode'&&strictReplayPass?['development-replay-attribution','nested-legacy-root-lifetimes']:[]),...(api.export==='Profiler'&&profilerRuntimePass?['commit-callback-lineage','profiling-build-timing']:[]),...(api.export==='Suspense'&&interruptedRenderScope?['suspension-resolution-interruption']:[])]:wrapperScope?['successful-construction-program','component-source-selection','observed-source-control-path','named-component-body-lineage','sibling-default-memo-strict-owners',...(wrapperOutcomeScope?['original-component-body-outcome']:[]),...(forwardedRefScope?['forwarded-ref-argument-lineage']:[])]:deferredScope?['urgency-selection-oracle','selected-value-jsx-read','initial-hydration',...(interruptedRenderScope?['interrupted-suspense-work']:[])]:transitionScope?['tuple-start-retention','returned-start-callback','initial-hydration','pending-boolean-source-branches','named-conditional-callback-provenance',...(transitionCommitScope?['update-to-commit-attribution']:[]),...(interruptedRenderScope?['interrupted-suspense-work']:[])]:idScope?['allocation-retention','hook-to-jsx-property','hydration-root-prefixes','host-commit-attribution',...(idLifetimePass?['suspense-interruption-lifetimes','additional-id-consumers']:[])]:storeScope?['subscription-notification-snapshot','native-click-callback-scope','stable-subscription-identity','server-notification-oracle',...(storeHydrationScope?['hydration-server-to-client-snapshot']:[]),...(storeCompositionScope?['subscription-replacement-lifecycle','retained-callback-input']:[])]:imperativeScope?['commit-factory-result','dependency-ref-oracle','sibling-remount-factory','context-to-handle-factory',...(handleReadScope?['observed-ref-object-provenance']:[]),...(interruptedRenderScope?['interrupted-render-no-factory']:[])]:contextScope?(api.export==='createContext'?['consumer-development-source-path',...(contextOriginScope?['allocation-default-identity']:[])]:['provider-selection','primitive-value-check','incomplete-ancestry-rejection',...(contextOriginScope?['default-object-provenance']:[]),...(contextUseScope?['retained-callback-binding-reads']:[]),...(contextEffectScope?['effect-memo-binding-reads']:[]),...(contextCleanupScope?['cleanup-binding-reads']:[]),...(interruptedRenderScope?['suspense-retry-lineage']:[])]):refScope?['allocation-retention','cell-read-write','sibling-remount-identity','click-callback-cell',
    ...(refHostScope?['host-attachment-and-write-provenance']:[]),
    ...(refReferenceScope?['ordinary-ref-method-calls','reference-call-and-binding-forms']:[]),
    ...(refInitializationScope?['initialization-lifecycle-boundaries']:[])]:predicateScope?['guard-marker-read','result-source-branch','local-immutable-aliases',
    ...([predicateDevelopment,predicateProduction].every(row=>row.thrown_call_observed && row.argument_failure_not_library_execution && row.opaque_thrown_value_observed)?['throw-observation']:[]),
    ...([predicateDevelopment,predicateProduction].every(row=>row.consumed_condition_paths===8 && row.missing_call_receipts_rejected)?['result-provenance']:[])]:retainedScope?['retention-and-captures',...(sharedNamedPass?['shared-named-callbacks','shared-expression-callbacks','shared-imported-callbacks']:[]),...(sharedNamedPass&&namespaceCallbacksPass?['shared-module-callbacks','namespace-export-callbacks']:[]),...(storeCompositionScope?['retained-store-callback-input']:[]),...(contextUseScope?['retained-context-binding-reads']:[]),
    ...(development.strict_remount_verified && production.strict_remount_verified ? ['remount-strictmode'] : []),
    ...(development.escaped_abandoned_callback_verified && production.escaped_abandoned_callback_verified ? ['abandoned-callbacks'] : [])]:effectScope?['dependency-setup-cleanup','strict-phase-order',...(effectOutcomePass?['suspense-hydration','errors-and-interruption','setup-and-cleanup-outcomes']:[]),...(contextEffectScope?['context-binding-reads']:[]),...(contextCleanupScope?['cleanup-context-binding-reads']:[])]
    :memoScope?['calculator-value-lineage','interrupted-cache-retention',...(contextEffectScope?['context-binding-reads']:[]),
      ...(dynamicMemoPass?['dynamic-calculators']:[]),
      ...(development.memo_callback_consumer_path_verified && production.memo_callback_consumer_path_verified ? ['cached-callback-consumers'] : []),
      ...(development.memo_conditional_path_verified && production.memo_conditional_path_verified ? ['conditional-return-selection'] : [])]:literalScope?['literal-read','build-variants','wrong-value-rejection']:stateScope?['requests-calculations','state-snapshots','dispatcher-identity',
      ...(development.state_initializer_return_path_verified && production.state_initializer_return_path_verified && stateBehavior.initializer_call_arguments_verified?['initializer-return-selection','initialization-lineage']:[]),
      ...(stateLifecycleScope?['queue-priority-rebase','commit-attribution','remount-strictmode','errors-unmount','dynamic-callbacks']:[])]:scopePass?['callback-arguments-return','click-source-path','nested-call-identity',
      ...([scopeDevelopment,scopeProduction].every(row=>row.named_and_conditional_callbacks && row.old_callback_captures && row.wrong_known_candidate_rejected)?['named-conditional-source-identity']:[]),...(scopeCommitPass?['scoped-state-request-to-commit-attribution']:[])]:[];
  const missingScopes=requiredScopes.filter(scope=>!verifiedScopes.includes(scope));
  // Admission answers the question the bank and runtime actually need: can we
  // understand this versioned rule, verify it against installed React, and use
  // it in at least one deterministic source-to-runtime path?  Scope completion
  // is a separate, stricter coverage claim.  Keeping the two apart prevents an
  // honest frontier (for example an unsupported dynamic source shape) from
  // making a useful, verified rule look unavailable to Tracer.
  const admitted=format.valid && Boolean(knownScope);
  const scopeComplete=admitted && missingScopes.length===0;
  return {api:api.id,...(rule?.kind==='class_component'?{member_rule_sha256s:Object.fromEntries(Object.entries(api.behavior.members).filter(([,value])=>value.execution).map(([name,value])=>[name,createHash('sha256').update(JSON.stringify(value.execution)).digest('hex')]))}:{}),rule_sha256:rule?createHash('sha256').update(JSON.stringify(rule)).digest('hex'):null,
    format:format.valid?'pass':'pending',behavior:knownScope?'scoped_pass':'pending',
    integration:knownScope?'scoped_pass':'pending',
    required_scopes:requiredScopes,verified_scopes:verifiedScopes,
    admitted,scope_complete:scopeComplete,
    verified_scope:classScope?'Both installed builds check class construction and update policy. Original class render bodies join registered class type, exact renderer instance, original props/state reads and returned values; native click callback receipts retain dynamic extent. Sibling/remount and StrictMode behavior, including PureComponent bailouts, are preserved. Manual calls outside the renderer abstain.'+(classUpdateScope?' Original setState/forceUpdate methods and inline callback bodies now join exact instance, request and source-edge receipts; synchronous legacy callbacks and later concurrent callbacks retain their original identities and values.':''):pipeableStreamScope?'Node async context joins the original handle allocation to the exact component source/type/props in later work. Existing pipe calls connect that exact handle to the original destination; existing end, finish, and error callback bodies establish terminal outcomes without replacing handles, methods, destinations, or listeners. Concurrent and nested requests remain isolated, and corrupted joins reject.':readableStreamScope?'Exact root component type/props join synchronous initial body entry to the original returned promise in Node and browser, both builds. A direct awaited binding connects that exact promise to its stream, and natural for-await exhaustion proves consumption completion without replacing either object. Rejected promises, abrupt loops, and unmatched development body contexts abstain.':legacyRenderScope?'Original click callbacks join the exact supplied element and native container to a legacy renderer commit and the original public result. Class, native, function and empty roots pass both builds. Existing-root event/batch updates and nested replacement retain explicit commit frontiers; no callback or hydration completion is inferred.':legacyUnmountScope?'Original click callbacks join exact native container input to a renderer-observed legacy root and later empty-root commit within the call. Repeated calls prove a no-op. True returns during render retain an unconfirmed-commit frontier. Both builds reject nine wrong programs and eleven evidence mutations.':hostScope?'Actual click and callback receipts join lookup input identity to the first host or text node in a bounded current class subtree, including portals, updates, empty output and native-node passthrough. Unknown getters and proxy exceptions are not replayed. Both builds reject eight corrupted observations.':legacyStreamScope?'Both installed builds verify synchronous initial rendering, all-task output readiness, suspended retries, cancellation and browser rejection. Natural for-await exhaustion now joins the exact returned stream to observed completion; a consumer-side failure remains an explicit frontier rather than being relabeled as a React error.':serverStringScope?'Exact installed Node and browser implementations connect the root element type and props to original synchronous component body entries and a successful string return. Nested requests and argument-time calls stay separate; thirteen corrupted records reject. The oracle checks output mode, prefixes, escaping, fallback and error behavior without client effects.':rootScope?'Installed DOM and client entrypoints verify root creation, render, original unmount and post-unmount behavior. Actual browser root handles join original methods and renderer root identities shared by real source callbacks in both builds; matching hydration reuses server DOM.':lazyScope?'The installed initializer checks pending, first settlement, cached rejection, synchronous loader and registration errors, and module property reads. Actual browser renderer loader invocations require the allocated lazy descriptor and exact inline loader source. Exact native Promise settlement joins the same allocation and loader to the fulfilled module, then the verified rule selects module.default and the renderer joins that component to the same Suspense boundary fallback and reveal commits in both builds.':factoryScope?'Allocated factories and later calls retain function and type identity without reading the deprecated type getter. Exact direct-object values join returned props, descriptions join committed owners, and component controls reach actual callbacks in both builds. Native factories through immutable tag aliases produce separately stamped controls; development owner Fibers and production null owners are checked separately, and ref props join the exact createRef object to its committed host.':actScope?'Both installed builds distinguish development callback execution from production rejection. Development browser callbacks join exact source and click paths, preserve nested/async results and thrown identity, and join synchronous state requests to validated commits while retaining explicit uncertainty about post-await work and queue completion.':cloneScope?'Installed cloning checks precedence, defaults, children, symbol props and ref-owner rules. Runtime clones require an accepted original description; exact override values join returned props and the resulting description joins its committed owner in both builds. Immutable original-element aliases and native clones retain their exact source calls; development owner Fibers and production null owners are checked separately, and an overridden createRef joins its committed host.':elementScope?'Installed construction checks type, key, ref, property selection, positional children and default props. Exact direct-object property values join returned props, and observed descriptions join committed owners. Component-type calls and native createElement calls with immutable tag aliases reach actual source controls and callbacks in both builds. Development owner Fibers and production null owners are checked separately; ref props join the exact createRef object to its committed host.':childrenScope?'Installed React checks leaf normalization, order, callback receiver/index, opaque elements and only-child validation. Recorded map/forEach callbacks join source and click occurrences; all five methods record original returns/errors without retraversing live inputs.':debugValueScope?'Installed renderer and entrypoint oracle verify normal no-op behavior and development dispatcher forwarding, including returned values and thrown errors. Tracer preserves the formatter, keeps actual button callbacks mapped, and reports conditional semantics without inventing an inspection context.':portalScope?'Both installed builds match exact portal child, container, and key identities to committed HostPortal fibers. Click records carry the logical React portal ancestry across DOM containers; interrupted and abandoned descriptions receive no commit, and renderer unmounts refer to an accepted prior commit. Immutable React API aliases retain the same versioned semantic.':boundaryScope?'Original boundary inputs join renderer selection and clicked source conditions in both builds and hydration. Keyed Fragment identity, StrictMode development replay and Profiler commit callbacks have additional runtime readers; a selected subtree does not prove all descendant callbacks executed.':wrapperScope?'Successful wrapper construction is checked against installed React. The compiler consumes the encoded component argument through immutable/nested wrappers; actual browser controls and effects follow that source in both builds and hydration. Comparator-as-component and unverified-version paths reject.':deferredScope?'Installed renderer tests distinguish urgent retained values from nonurgent new values. Actual input/previous identities join selected hook results to direct immutable native JSX reads in both builds, with sibling, remount, root and initial-hydration checks.':transitionScope?'Observed hook tuple and exact retained start identity join direct returned-start calls to their actual inline, named or finite conditional callback. Observed pending booleans select exact source if/ternary branches. Both builds verify sibling ownership, replacement mounts, callback exceptions, post-unmount invocation, shutdown transparency and initial hydration.'+(transitionCommitScope?' Exact state requests inside the returned start callback join later validated commits; priority cause remains separate.':''):idScope?'Allocation and retention program checked against actual renderer IDs; observed hook strings join direct immutable native JSX id/htmlFor uses with exact source, root, mount, hook, and render identity. Both builds preserve hydration IDs and native label relationships.':storeScope?'Independent subscription, snapshot equality, retry, and server oracle. Actual source callbacks connect native click scope to subscription listener and snapshot outcome in both builds, with sibling/remount and shutdown checks.':imperativeScope?'Executable successful-commit/ref/dependency plan checked against both installed React builds. Actual factory invocations and returned handles join exact source, component, render, and zero-argument call evidence; ref assignment and cleanup are not inferred.':contextScope?(api.export==='createContext'?'Independent allocation/default/provider/notification oracle, observed creation/input identities, and development Consumer source invocation. Production Consumer reports its missing render owner explicitly.':'Both builds consume the context rule to select observed nearest-provider/default paths, check primitive provider values, and reject incomplete ancestry. Observed creation evidence now verifies stored defaults and opaque provider/default object identity. Notification causality remains unproven.'):refScope?'Versioned allocation/retention programs, exact returned-cell identities, observed reads/writes and callback/action joins, sibling/remount separation, getter/setter transparency, and recorder shutdown in both builds.':predicateScope?'Installed typeof/null/marker behavior, getter/proxy preservation, and actual boolean source-branch selection, including local immutable aliases and negation. Selected source paths are not downstream execution evidence.':retainedScope?'Inline and local immutable callbacks: retention, replacement, invocation, original captures, and sibling ownership in development and production.':effectScope
      ?'Executable setup/cleanup plans, phase order, StrictMode rehearsal, and exact source callback joins in both builds.':memoScope
      ?'Calculator return, cached value selection, committed cache retention after interruption, and actual cached-callback event consumption in both builds.':literalScope
      ?'Actual exported metadata reads in development/production, including the distinct ReactDOM production label and wrong/missing-value rejection.':stateScope?'Original dispatcher identity, request-to-application-calculation joins, input/output and captures, and separate observed state snapshots.'+(stateLifecycleScope?' Exact queue requests and calculations join only matching committed renders; failures and unmounted requests remain uncommitted.':' No commit attribution is inferred.'):scopePass?'Observed synchronous callback calls, forwarded identities, results/errors, nested call IDs, and matching click source paths.'+(scopeCommitPass?' Exact state requests inside each scope join matching validated commits; priority/flush causation remains separate.':' Scheduling remains a conditional obligation.'):null,
    remaining:classScope?['Constructor/context/ref and lifecycle origins, update-result selection and state merging, shallow-comparison causes, committed output and interrupted/hydrated/error work remain unproved. Non-inline update callbacks and unsupported body/argument shapes retain explicit source frontiers; recorded callback bodies do not prove renderer queue execution or commit. A class body inside a click callback proves dynamic extent, not that this click caused its update or that React committed it. Named-import, inherited, anonymous or mutable classes and unsupported render bodies retain source frontiers.']:pipeableStreamScope?['Shell/allReady callback lineage, backpressure, abort and premature-close lifetimes, non-inline event callbacks, and broader component/retry paths remain unproved. Completion and error are proven only for an exact pipe destination whose existing inline end, finish, or error callback ran; async ancestry does not prove direct renderer dispatch.']:readableStreamScope?['Promise fulfillment and natural for-await completion are proven for direct local bindings. Async retries, allReady, read-by-read lineage, signal/cancel lifetimes, nested or mutable promise consumers, abrupt loops, broader component inputs, and failure origins remain unproved. An unmatched development body invocation retains an explicit input-context frontier.']:legacyRenderScope?['Commit callback arguments/receiver and completion lineage, deferred updates, component-body execution, initial-mode/hydration reuse, legacy parent-context propagation, comment containers and validation errors remain unproved at runtime.']:legacyUnmountScope?['Cleanup and ref-detachment callback lineage, deferred request-to-commit attribution, comment-container runtime provenance and validation error origin remain unproved. Fresh containers with no own root descriptor and accessor/proxy inputs abstain.']:hostScope?['Host-consuming effects, interrupted/render-phase lookups, unmount-time behavior and thrown-result branch provenance remain open. Unknown objects, changing commits and bounded-tree exhaustion abstain. Class renderer snapshots prove the lookup relation, not a downstream DOM effect.']:legacyStreamScope?['Natural for-await exhaustion now proves completion of the exact returned stream. Async component retries, stream-originated versus consumer-originated errors, cancellation, abrupt loops, broader source inputs, request/context lineage, and direct renderer dispatch remain unproved. Browser entrypoint rejection is behavior-tested but not yet joined to observed platform identity.']:serverStringScope?['Direct renderer dispatch, returned markup content and browser hydration are not proven. Suspense/error paths, diagnostic replay, nested or wrapped component selection, context, mutable or dynamic inputs and request-to-render attribution remain open. Thrown renders retain an explicit unresolved outcome.']:rootScope?[]:lazyScope?['Custom thenables, rejected-module rendering, repeated suspension, interruption attribution and broader loader sources or captures remain unproved. The recorder subscribes only to exact native Promises and never reads module.default itself.']:factoryScope?['Mutable or runtime-only factory aliases, arbitrary configuration objects, dynamic arguments, and other unresolved returned-function consumers remain explicit frontiers.']:actScope?['Awaited result, post-await state work, queue drain, effect attribution, overlapping scopes, arbitrary thenables and flush failures still need occurrence-specific integration. Production rejection preserves behavior but abstains without observed build identity; a missing callback record does not prove production execution.']:cloneScope?['Mutable or runtime-only original-element aliases, unrecorded original descriptions, arbitrary configuration objects, and dynamic property inputs remain explicit frontiers.']:elementScope?['Mutable or runtime-only types, accessors, prototype writes, arbitrary configuration objects, and unresolved placements remain explicit frontiers.']:childrenScope?['Runtime input-tree lineage, mapped result flattening and key rewriting, iterators/accessors, named callbacks, rendering consumers and exception-control-flow source paths remain unresolved. Recorded callbacks do not prove an opaque input traversal.']:debugValueScope?['Official DevTools inspection, exact inspection dispatcher identity, formatter invocation/result/error attribution and callback source coverage remain unproven. A returned undefined does not identify the execution context.']:portalScope?[]:boundaryScope?(api.export==='Profiler'&&profilerRuntimePass?['Listed Profiler scopes pass in development and production profiling; ordinary production does not invoke onRender. Exact original callback bodies, arguments, committed input and renderer owner are required. Manual duplicate calls abstain. Inline synchronous simple-parameter callbacks are supported; named/shared inputs, defaults, destructuring, rest and async/generator shapes retain source frontiers. Nested-update is an observed phase, not proof of update priority or downstream effects.']:api.export==='StrictMode'&&strictReplayPass?['Listed StrictMode scopes pass: actual renderer replay brackets join exact component render attempts under nested boundaries in development, including legacy roots; production and ordinary events are not labeled replayed. Effect cleanup/setup rehearsal uses separate effect rules and is never inferred from this render notification. Unsupported boundary source placements remain explicit frontiers.']:api.export==='Fragment'&&fragmentLifecyclePass?['Listed Fragment behavior scopes pass for explicit JSX: keyed reuse/remounts, child selection, ignored props/ref and click-to-commit identity. Multiply-used or mutable JSX variables, primitive/elided Fragment ancestry, spread inputs and anonymous Fragment syntax remain source coverage frontiers; no universal JavaScript source coverage is claimed.']:api.export==='Suspense'&&interruptedRenderScope?['Exact source occurrences now join fallback and children commits, retry attempts, and attempts superseded by a later render. Streaming hydration and hidden layout lifetimes remain open. Spread/aliased inputs require additional source coverage. A committed boundary input does not prove descendant callback execution.']:['Original boundary inputs now join committed fibers and discharge the exact clicked input condition. API-specific replay/profiling, Suspense lifetimes and streaming hydration remain open. Spread/aliased inputs require additional source coverage. A committed input does not prove descendant callback execution.']):wrapperScope?['Module-level inline named component bodies now join to the exact created wrapper and function in an observed renderer context. The exact renderer ref input now joins argument 1, including null, callback and object replacements. Entry-time and committed-render snapshots are distinguished; diagnostic calls without normal arguments abstain. Original named component body outcomes join accepted invocations, preserving returned and thrown values. Renderer consumption of those results, direct renderer dispatch, comparator invocation and ref attachment are not proven. Anonymous/nested wrappers, interrupted production render records and other source shapes remain open. Constructor validation/accessor errors, comparator state/context semantics, ref attachment/cleanup and interrupted/Suspense lifetimes remain open.']:deferredScope?['Runtime lane priority and update-to-commit attribution are unproven. Superseded Suspense attempts now retain exact source, boundary, fallback/retry commit, and replacement lineage. Callback-valued consumers, aliases, mutable bindings, broader JSX consumers and missing/spread/await arguments remain open. Equal input and previous identities are reported as ambiguous, never a unique cause.']:transitionScope?['Pending is only an observed hook snapshot. Superseded Suspense attempts now retain exact source, boundary, retained/final commit, and replacement lineage. Broader pending consumers, priority attribution, external/mutated/getter callback provenance, and broader returned-value access shapes remain open. Historical origin does not prove the owner is still mounted.']:idScope?['Exact JSX props and immutable same-render aliases now join their committed host fiber and accepted component owner, including single-ID accessibility references. Suspense interruption, hide/reveal and selective hydration are tested; production withholds uncommitted render records without a known owner. DOM write causality, composed strings, custom-component properties and captured uses remain source frontiers. ID strings are not entity identity or cross-root joins; renderer counters/tree position cannot be guessed.']:storeScope?['Direct immutable useCallback inputs now prove selection, replacement and cleanup lineage. Aliased or mutable inputs, snapshot-to-rendered-value consumers, concurrent consistency recovery, and notification-to-commit causality remain unfinished. Basic server-to-client hydration passes. An observed cleanup invocation is not proof that unsubscribe succeeded.']:imperativeScope?['Runtime attribution of object/callback ref assignment and cleanup is still unproved. An interrupted Suspense render is now proven not to run the factory before its successful retry commit. Hydration, factory/ref failures, and broader callback-source shapes remain open.']:contextScope?(api.export==='useContext'&&interruptedRenderScope?['Notification-to-render attribution and hydration/unmount coverage remain unfinished. Exact Suspense fallback, retry and committed consumer render lineage is proven. Stored default/object identities require exact observed creation provenance; unsupported await/yield/spread/direct-eval creation arguments retain an explicit origin frontier. Consumer source invocation is connected in development; production records an explicit consumer_render_owner_unobserved frontier. Direct immutable useContext bindings join actual expression reads in retained callbacks, synchronous effect setup and cleanup, and memo calculators. Aliases, mutable bindings, other nested bodies, async continuations, and other consumers remain unproved.']:['Notification-to-render attribution and interruption/hydration/unmount coverage remain unfinished. Stored default/object identities now require exact observed creation provenance; unsupported await/yield/spread/direct-eval creation arguments retain an explicit origin frontier. Consumer source invocation is connected in development; production records an explicit consumer_render_owner_unobserved frontier. Direct immutable useContext bindings now join actual expression reads in retained callbacks, synchronous effect setup and cleanup, and memo calculators. Effect/memo uses also require the exact callback invocation; cleanup preserves its original setup render. Aliases, mutable bindings, other nested bodies, async continuations, and other consumers remain unproved.']):refScope?['Ordinary current-method calls select actual known function objects with exact read provenance; captured values and callback-body execution are not inferred. Optional/compound/destructuring operations, caller-supplied and mutable ref bindings, callback refs, ref cleanup, and write-to-later-read provenance remain incomplete. Exact object refs now join React host attachment writes to committed host fibers; hook initialization timing and broader commit/lifetime attribution remain explicit gaps.']:predicateScope?['Returned and thrown call outcomes are observed without rereading application properties. Argument evaluation failures cannot prove library execution. Mutable/cross-function result provenance and unmapped consumers remain frontiers; await/yield/spread inputs retain ordinary result observations with an explicit error-observation frontier.']:retainedScope?['Mutable exports, ordinary object properties and unavailable callback source shapes; repeated JSX placement identity; ownership outside a proved native event remains unresolved. Named, expression-based and namespace-imported shared callbacks now have exact selection-to-body evidence; expression arguments remain unobserved.',...(verifiedScopes.includes('abandoned-callbacks')?[]:['Escaped abandoned-render invocation lineage']),
      ...(verifiedScopes.includes('remount-strictmode')?[]:['Remount/StrictMode cache identity integration'])]:
      effectScope?(effectOutcomePass?[]:['Suspense/hydration and error/interruption scope must be connected to rule admission.']):
      memoScope?['Finite if/ternary return selection passes. Branch-local computations, loops, exceptions, and async calculator shapes remain source frontiers; shared callback production origins can remain ambiguous.']:
      literalScope?[]:stateScope?(stateLifecycleScope
        ?['Same-value updates without a commit remain requests, not committed effects. Mutable, getter-produced, and externally supplied updater sources retain an explicit source frontier.']
        :['Initializer input provenance and error/interruption boundaries, priority/rebase-to-commit attribution, dynamic callbacks, and full remount/unmount behavior remain incomplete. Unique initializer returns now join their initial state snapshots.']):scopePass?['Named/conditional candidates and retained old function objects pass source-identity joins. External, mutated, and getter-produced callbacks remain unresolved. Scoped state requests now join their exact commits. Priority/flush policy causation and interrupted/hydrated work remain incomplete; await/yield and spread argument evaluation remain transform frontiers.']:['Executable instruction coverage and independent rule-to-runtime acceptance remain to be implemented.']};
});
const report={schema:'producttrace.react-rule-admission.v2',react:'18.3.1',inventory_rows:rows.length,
  admission_definition:'valid rule format + independent exact-installed-library behavior oracle + deterministic Tracer integration path',
  scoped_rules_passed:rows.filter(row=>row.integration==='scoped_pass').length,
  admitted_apis:rows.filter(row=>row.admitted).length,
  scope_complete_apis:rows.filter(row=>row.scope_complete).length,
  complete:rows.every(row=>row.admitted),coverage_complete:rows.every(row=>row.scope_complete),rows};
assert.equal(rows.length,55);
assert.equal(new Set(rows.map(row=>row.api)).size,55);
assert.ok(rows.every(row=>row.rule_sha256 && row.format==='pass' && row.behavior==='scoped_pass'
  && row.integration==='scoped_pass' && row.admitted));
if(process.argv.includes('--write')) {
  fs.writeFileSync(path.join(root,'docs/evidence/react-ref-host-attachment.json'),JSON.stringify({
    schema:'producttrace.react-ref-host-attachment.v1',react:'18.3.1',apis:['react/createRef/18.3.1','react/useRef/18.3.1'],
    runtime:refRuntime,reference_forms:refMethods,format_and_behavior:refs,
    verified_scope:'Exact observed object-ref identity joins the originating React call to a committed host fiber and the exact host node React wrote to current.',
    limit:'This does not prove callback-ref invocation, detachment cleanup, arbitrary ref bindings, or hook initialization timing.'},null,2)+'\n');
  fs.writeFileSync(path.join(root,'docs/evidence/react-effect-outcomes.json'),JSON.stringify({schema:'producttrace.react-effect-outcomes.v1',
    react:'18.3.1',runtime:effectOutcomes,format_and_behavior:effects,scope_complete:effectOutcomePass,
    limit:'Synchronous callback outcomes do not prove asynchronous work or downstream product effects.'},null,2)+'\n');
  fs.writeFileSync(path.join(root,'docs/evidence/react-class-update-18.3.1.json'),JSON.stringify({schema:'producttrace.react-class-update-acceptance.v1',react:'18.3.1',format_and_behavior:classUpdates,runtime:classUpdateRuntime,complete:false,
    sources:[['react/cjs/react.development.js',[[349,355],[376,378]]],['react-dom/cjs/react-dom.development.js',[[14791,14838],[15031,15037]]]].map(([file,implementation_lines])=>({file:'node_modules/'+file,implementation_lines,sha256:createHash('sha256').update(fs.readFileSync(path.join(repository,'node_modules',file))).digest('hex')}))},null,2)+'\n');

  fs.writeFileSync(path.join(root,'docs/evidence/react-class-18.3.1.json'),JSON.stringify({schema:'producttrace.react-class-acceptance.v1',react:'18.3.1',format_and_behavior:classes,runtime:classRuntime,complete:false,
    sources:[['react/cjs/react.development.js',[[312,322],[354,377],[412,429]]],['react-dom/cjs/react-dom.development.js',[[17988,18022]]]].map(([file,implementation_lines])=>({file:'node_modules/'+file,implementation_lines,sha256:createHash('sha256').update(fs.readFileSync(path.join(repository,'node_modules',file))).digest('hex')}))},null,2)+'\n');

  fs.writeFileSync(path.join(root,'docs/evidence/react-pipeable-stream-18.3.1.json'),JSON.stringify({schema:'producttrace.react-pipeable-stream-acceptance.v1',react:'18.3.1',format_and_behavior:pipeableStream,runtime:pipeableStreamRuntime,complete:false,
    source:{file:'node_modules/react-dom/cjs/react-dom-server.node.development.js',implementation_lines:[[77,79],[6978,6982],[7038,7072]],sha256:createHash('sha256').update(fs.readFileSync(path.join(repository,'node_modules/react-dom/cjs/react-dom-server.node.development.js'))).digest('hex')}},null,2)+'\n');
  fs.writeFileSync(path.join(root,'docs/evidence/react-readable-stream-18.3.1.json'),JSON.stringify({schema:'producttrace.react-readable-stream-acceptance.v1',react:'18.3.1',format_and_behavior:readableStream,runtime:readableStreamRuntime,complete:false,
    source:{file:'node_modules/react-dom/cjs/react-dom-server.browser.development.js',implementation_lines:[[76,78],[6959,7014]],sha256:createHash('sha256').update(fs.readFileSync(path.join(repository,'node_modules/react-dom/cjs/react-dom-server.browser.development.js'))).digest('hex')}},null,2)+'\n');
  fs.writeFileSync(path.join(root,'docs/evidence/react-legacy-render-18.3.1.json'),JSON.stringify({schema:'producttrace.react-legacy-render-acceptance.v1',react:'18.3.1',format_and_behavior:legacyRender,runtime:legacyRenderRuntime,complete:false,
    source:{file:'node_modules/react-dom/cjs/react-dom.development.js',implementation_lines:[[28903,28917],[29571,29665],[29709,29746]],sha256:createHash('sha256').update(fs.readFileSync(path.join(repository,'node_modules/react-dom/cjs/react-dom.development.js'))).digest('hex')}},null,2)+'\n');
  fs.writeFileSync(path.join(root,'docs/evidence/react-legacy-unmount-18.3.1.json'),JSON.stringify({schema:'producttrace.react-legacy-unmount-acceptance.v1',react:'18.3.1',format_and_behavior:legacyUnmount,runtime:legacyUnmountRuntime,complete:false,
    source:{file:'node_modules/react-dom/cjs/react-dom.development.js',implementation_lines:[[29496,29498],[29749,29818]],sha256:createHash('sha256').update(fs.readFileSync(path.join(repository,'node_modules/react-dom/cjs/react-dom.development.js'))).digest('hex')}},null,2)+'\n');
  fs.writeFileSync(path.join(root,'docs/evidence/react-host-18.3.1.json'),JSON.stringify({schema:'producttrace.react-host-acceptance.v1',react:'18.3.1',format_and_behavior:hostLookup,runtime:hostRuntime,complete:false},null,2)+'\n');
  fs.writeFileSync(path.join(root,'docs/evidence/react-browser-source-18.3.1.json'),JSON.stringify(browserSource,null,2)+'\n');
  fs.writeFileSync(path.join(root,'docs/evidence/react-legacy-stream-18.3.1.json'),JSON.stringify({schema:'producttrace.react-legacy-stream-acceptance.v1',react:'18.3.1',format_and_behavior:legacyStreams,runtime:legacyStreamRuntime,complete:false},null,2)+'\n');
  fs.writeFileSync(path.join(root,'docs/evidence/react-server-string-18.3.1.json'),JSON.stringify({schema:'producttrace.react-server-string-acceptance.v1',react:'18.3.1',format_and_behavior:serverStrings,runtime:serverStringRuntime,complete:false},null,2)+'\n');
  fs.writeFileSync(path.join(root,'docs/evidence/react-root-18.3.1.json'),JSON.stringify({schema:'producttrace.react-root-acceptance.v1',react:'18.3.1',
    format_and_behavior:roots,runtime:rootRuntime,alias_runtime:rootAliasRuntime,recovery_runtime:rootRecoveryRuntime,complete:true,
    explicit_frontiers:['A conditional choice between multiple root handles requires runtime producer identity.','A detached root method preserves JavaScript receiver behavior and is not rebound by Tracer.']},null,2)+'\n');
  fs.writeFileSync(path.join(root,'docs/evidence/react-lazy-18.3.1.json'),JSON.stringify({schema:'producttrace.react-lazy-acceptance.v1',react:'18.3.1',format_and_behavior:lazy,runtime:lazyRuntime,complete:false},null,2)+'\n');
  fs.writeFileSync(path.join(root,'docs/evidence/react-factory-18.3.1.json'),JSON.stringify({schema:'producttrace.react-factory-acceptance.v1',react:'18.3.1',format_and_behavior:factory,runtime:factoryRuntime,full_api_admission:true,unproven:['Mutable or runtime-only factory aliases','Arbitrary configuration objects','Dynamic arguments','Other unresolved returned-function consumers']},null,2)+'\n');
  fs.writeFileSync(path.join(root,'docs/evidence/react-act-18.3.1.json'),JSON.stringify({schema:'producttrace.react-act-acceptance.v1',react:'18.3.1',format_and_behavior:act,runtime:actRuntime,complete:false},null,2)+'\n');
  fs.writeFileSync(path.join(root,'docs/evidence/react-clone-18.3.1.json'),JSON.stringify({
    schema:'producttrace.react-clone-acceptance.v1',react:'18.3.1',format_and_behavior:clones,runtime:cloneRuntime,
    full_api_admission:true,sources:[['node_modules/react/cjs/react.development.js',[[877,950]]]]
      .map(([file,implementation_lines])=>({file,implementation_lines,sha256:createHash('sha256').update(fs.readFileSync(path.join(repository,file))).digest('hex')})),
    unproven:['Mutable or runtime-only original-element aliases','Unrecorded original descriptions','Arbitrary configuration objects','Dynamic property inputs']},null,2)+'\n');

  fs.writeFileSync(path.join(root,'docs/evidence/react-element-18.3.1.json'),JSON.stringify({
    schema:'producttrace.react-element-acceptance.v1',react:'18.3.1',format_and_behavior:elements,runtime:elementRuntime,
    full_api_admission:true,sources:[['node_modules/react/cjs/react.development.js',[[783,872]]]]
      .map(([file,implementation_lines])=>({file,implementation_lines,sha256:createHash('sha256').update(fs.readFileSync(path.join(repository,file))).digest('hex')})),
    unproven:['Mutable or runtime-only types','Accessors and prototype writes','Arbitrary configuration objects','Unresolved source placements']},null,2)+'\n');

  fs.writeFileSync(path.join(root,'docs/evidence/react-children-18.3.1.json'),JSON.stringify({
    schema:'producttrace.react-children-acceptance.v1',react:'18.3.1',format_and_behavior:children,runtime:childrenRuntime,
    full_api_admission:false,sources:[['node_modules/react/cjs/react.development.js',[[990,1235]]]]
      .map(([file,implementation_lines])=>({file,implementation_lines,sha256:createHash('sha256').update(fs.readFileSync(path.join(repository,file))).digest('hex')})),
    unproven:['Runtime input-tree lineage','Mapped flattening and key rewriting','Iterators and accessors','Named callbacks and rendering consumers','Try/catch source flow']},null,2)+'\n');

  fs.writeFileSync(path.join(root,'docs/evidence/react-debug-value-18.3.1.json'),JSON.stringify({
    schema:'producttrace.react-debug-value-acceptance.v1',react:'18.3.1',format_and_behavior:debugValue,runtime:debugValueRuntime,
    full_api_admission:false,sources:[['node_modules/react/cjs/react.development.js',[[1656,1661]]],
      ['node_modules/react/cjs/react.production.min.js',[[25,25]]],['node_modules/react-dom/cjs/react-dom.development.js',[[16370,16375]]]]
      .map(([file,implementation_lines])=>({file,implementation_lines,sha256:createHash('sha256').update(fs.readFileSync(path.join(repository,file))).digest('hex')})),
    unproven:['Official DevTools inspection','Actual inspection dispatcher identity','Formatter input, result and error lineage']},null,2)+'\n');

  fs.writeFileSync(path.join(root,'docs/evidence/react-portal-18.3.1.json'),JSON.stringify({
    schema:'producttrace.react-portal-acceptance.v1',react:'18.3.1',format_and_behavior:portal,runtime:portalRuntime,
    full_api_admission:true,sources:[['node_modules/react-dom/cjs/react-dom.development.js',[[28726,28745],[29825,29836]]]]
      .map(([file,implementation_lines])=>({file,implementation_lines,sha256:createHash('sha256').update(fs.readFileSync(path.join(repository,file))).digest('hex')})),
    limits:['Mutable or runtime-only API aliases','Object-key coercion internals','Arguments that throw before React is entered','Portals with ambiguous identical origin references']},null,2)+'\n');

  fs.writeFileSync(path.join(root,'docs/evidence/react-shared-callback-18.3.1.json'),JSON.stringify({
    schema:'producttrace.react-shared-callback-acceptance.v1',react:'18.3.1',format_and_behavior:behavior,runtime:sharedCallbacks,
    full_api_admission:false,scope:'Original synchronous named or expression function selected by source hooks and entered within an exact native event callback. Expression-factory arguments remain unobserved.',
    sources:[['node_modules/react/cjs/react.development.js',[1644,1647]],['node_modules/react-dom/cjs/react-dom.development.js',[16377,16402]]]
      .map(([file,implementation_lines])=>({file,implementation_lines,sha256:createHash('sha256').update(fs.readFileSync(path.join(repository,file))).digest('hex')})),
    unproven:['Mutable, namespace-property and unavailable callback source shapes','Repeated JSX placement identity','Hook ownership outside the exact native event scope','Callback completion and creation-render provenance']},null,2)+'\n');

  fs.writeFileSync(path.join(root,'docs/evidence/react-interrupted-render-18.3.1.json'),JSON.stringify({
    schema:'producttrace.react-interrupted-render-acceptance.v1',react:'18.3.1',runtime:interruptedRender,
    closed_required_scopes:{'react/Suspense/18.3.1':['suspension-resolution-interruption'],
      'react/useDeferredValue/18.3.1':['interrupted-suspense-work'],
      'react/useTransition/18.3.1':['interrupted-suspense-work']},
    narrowed_frontiers:{'react/useContext/18.3.1':['hydration','unmount'],
      'react/useImperativeHandle/18.3.1':['hydration','factory/ref failures']},
    verified_scope:'Exact React source occurrences join render attempts to the exact Suspense boundary input, fallback or children commit, and a mutually identified replacement attempt. A render without a commit stays uncommitted.',
    limits:['Absence or elapsed time never proves abandonment.','Production can prove supersession without inventing an unobserved retained boundary mount.','Nested wrappers and unsupported boundary source shapes retain an explicit frontier.']},null,2)+'\n');
  fs.writeFileSync(path.join(root,'docs/evidence/react-rule-admission.json'),JSON.stringify(report,null,2)+'\n');
  fs.writeFileSync(path.join(root,'docs/evidence/react-boundary-18.3.1.json'),JSON.stringify({
    schema:'producttrace.react-boundary-acceptance.v1',react:'18.3.1',format_and_behavior:boundaries,
    runtime:boundaryRuntime,fallback_runtime:boundaryFallback,prop_resolution:boundaryProps,profiler_runtime:profilerRuntime,interrupted_render_runtime:interruptedRender,full_api_admission:false,
    sources:[['node_modules/react/cjs/react.development.js',[[33,44],[2696,2700]]],
      ['node_modules/react-dom/cjs/react-dom.development.js',[[19541,19570],[20379,20425]]]].map(([file,implementation_lines])=>({file,implementation_lines,
        sha256:createHash('sha256').update(fs.readFileSync(path.join(repository,file))).digest('hex')})),
    unproven:['API-specific replay, profiling and reconciliation','Hidden and hydrated Suspense lifetimes','Spread and aliased boundary inputs']},null,2)+'\n');
  const wrapperSource='node_modules/react/cjs/react.development.js';
  fs.writeFileSync(path.join(root,'docs/evidence/react-wrapper-18.3.1.json'),JSON.stringify({
    schema:'producttrace.react-wrapper-acceptance.v1',react:'18.3.1',format_and_behavior:wrappers,
    runtime:[wrapperDevelopment,wrapperProduction,wrapperHydrationDevelopment,wrapperHydrationProduction],ownership_runtime:wrapperOwnership,
    renderer_ref_source:{file:'node_modules/react-dom/cjs/react-dom.development.js',implementation_lines:[[19214,19254]],sha256:createHash('sha256').update(fs.readFileSync(path.join(repository,'node_modules/react-dom/cjs/react-dom.development.js'))).digest('hex')},
    source:{file:wrapperSource,implementation_lines:[[1467,1517],[1547,1588]],sha256:createHash('sha256').update(fs.readFileSync(path.join(repository,wrapperSource))).digest('hex')},
    full_api_admission:false,unproven:['Direct renderer dispatch, comparator invocation, renderer result consumption and interrupted completion','Anonymous and nested wrapper callback source shapes','Interrupted production body observation','Ref attachment and cleanup beyond the observed renderer argument','Default/custom comparison, state and context interactions','Construction validation/accessor errors','Interrupted and Suspense lifetimes']},null,2)+'\n');
  const implementation='node_modules/react-dom/cjs/react-dom.development.js';
  const implementationHash=createHash('sha256').update(fs.readFileSync(path.join(repository,implementation))).digest('hex');
  for(const [name,oracle,runtime,lines,unproven] of [
    ['deferred',deferred,[deferredDevelopment,deferredProduction,deferredHydrationDevelopment,deferredHydrationProduction],[16432,16497],
      ['Runtime lane priority and update-to-commit attribution','Callback-valued and broader application consumers','Host commit attribution']],
    ['transition',transition,[transitionDevelopment,transitionProduction,transitionHydrationDevelopment,transitionHydrationProduction],[16499,16567],
      ['Broader pending-value consumers','Update priority and commit attribution','External, mutable and getter callback provenance','Current liveness of historical owners']]
  ])fs.writeFileSync(path.join(root,`docs/evidence/react-${name}-18.3.1.json`),JSON.stringify({
    schema:`producttrace.react-${name}-acceptance.v1`,react:'18.3.1',format_and_behavior:oracle,runtime,
    source:{file:implementation,implementation_lines:lines,sha256:implementationHash},full_api_admission:false,unproven},null,2)+'\n');
}
console.log(JSON.stringify(report,null,2));
// The command is green only when every public entry has a usable rule: format,
// installed-library behavior, and deterministic integration. coverage_complete
// remains false while any explicitly listed broader scope is still open.
if(!report.complete&&!process.argv.includes('--audit'))process.exitCode=1;
