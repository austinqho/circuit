import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {REACT_API_INVENTORY} from '../../analysis/react-semantics.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const repository=path.resolve(process.argv[2]||'/tmp/producttrace-librechat-autonomous');
const writeArtifacts=process.argv.includes('--write');
const frozenRevision=execFileSync('git',['rev-parse','HEAD'],{cwd:repository,encoding:'utf8'}).trim();
const trackedChanges=execFileSync('git',['status','--short','--untracked-files=no'],{
  cwd:repository,encoding:'utf8'}).trim();
assert.equal(trackedChanges,'','integration matrix requires a tracked-clean application checkout');
const run=(script,env={})=>JSON.parse(execFileSync(process.execPath,[path.join(root,'test/acceptance',script),repository],{
  cwd:root,encoding:'utf8',env:{...process.env,...env},stdio:['ignore','pipe','inherit'],maxBuffer:20_000_000}));

const oracle=run('react-public-behavior.mjs');
const clientDevelopment=run('react-api-runtime-integration.mjs');
const clientProduction=run('react-api-runtime-integration.mjs',{PRODUCTTRACE_REACT_BUILD:'production'});
const lifecycleDevelopment=run('react-runtime-lifecycle-recording.mjs');
const lifecycleProduction=run('react-runtime-lifecycle-recording.mjs',{PRODUCTTRACE_REACT_BUILD:'production'});
const server=run('react-server-api-runtime-integration.mjs');

const mergeArrays=(...values)=>[...new Set(values.flatMap(value=>value||[]))].sort();
const invocationCount=(id,result)=>result.joined_api_invocations?.[id]||0;
const operationsFor=id=>mergeArrays(clientDevelopment.joined_lifecycle_operations?.[id],
  clientProduction.joined_lifecycle_operations?.[id],lifecycleDevelopment.joined_api_operations?.[id],
  lifecycleProduction.joined_api_operations?.[id]);
const slotsFor=id=>mergeArrays(clientDevelopment.joined_callback_slots?.[id],
  clientProduction.joined_callback_slots?.[id],lifecycleDevelopment.joined_callback_slots?.[id],
  lifecycleProduction.joined_callback_slots?.[id]);

const blockers={
  'react/useCallback/18.3.1':'Inline and local immutable callbacks now join creation, selection, invocation, and original captures in both builds; shared/module callback ownership and escaped abandoned-render callbacks remain unresolved.',
  'react/useState/18.3.1':'State snapshots and requests to inline updaters join with actual inputs, returns, captures, and original dispatcher identity. Initialization lineage, priority/rebase, bailout, and commit attribution remain incomplete.',
  'react/useReducer/18.3.1':'Dispatch requests link to actual inline reducer calls while preserving original actions, including repeated and function actions. Initializer-to-state and dispatch-to-commit causality remain incomplete.',
  'react/createContext/18.3.1':'Provider, Consumer, default, and explicit-undefined paths pass; Providers from uninstrumented/prebuilt code retain unresolved source attribution.',
  'react/useContext/18.3.1':'Exact context reads join; source attribution remains unresolved when the nearest Provider is outside transformed source.',
  'react/createRef/18.3.1':'The createRef call is joined; later attachment, .current writes, replacement, and detach are not attributed to this creation occurrence.',
  'react/useRef/18.3.1':'The hook call is joined; live .current reads/writes and host attachment are not emitted as occurrence-specific ref operations.',
  'react/forwardRef/18.3.1':'The wrapper creation is joined; its later render callback and forwarded-ref delivery are not yet joined back to this creation occurrence.',
  'react/memo/18.3.1':'The memo creation is joined; component render versus comparator bailout decisions are not yet emitted as memo-specific runtime records.',
  'react/Component/18.3.1':'Dedicated class acceptance now joins original render bodies, renderer owners, props/state reads and native callback extent. Constructor, update-cause, commit and lifecycle attribution remain incomplete.',
  'react/PureComponent/18.3.1':'Dedicated class acceptance now joins original render bodies and input reads while preserving PureComponent bailouts. Runtime comparison causes, class lifecycle and queue callbacks remain incomplete.',
  'react/startTransition/18.3.1':'Synchronous callback execution, its return/throw, and matching click source paths are joined. Priority assignment, interruption, and eventual commit are not one occurrence chain.',
  'react/useDebugValue/18.3.1':'The hook call is joined, but the optional formatter cannot be verified without an observed DevTools inspection invocation.',
  'react/version/18.3.1':'No blocker for the tested metadata read; the string itself is deliberately not accepted as installed-source attestation.',
  'react/Children/18.3.1':'map, forEach, count, toArray, and only execute under one joined Children occurrence family; receiver identity and thrown-only edge permutations remain finite-test gaps.',
  'react/Fragment/18.3.1':'The Fragment value read and hostless render pass; keyed replacement and nested reconciliation permutations remain unexhausted.',
  'react/Profiler/18.3.1':'The Profiler value read and real onRender callback pass in the oracle, but Tracer does not yet emit the onRender callback/commit timing as a Profiler-specific join.',
  'react/StrictMode/18.3.1':'The StrictMode value read and React 18 development rehearsal pass; repeated render/effect occurrences are not yet attributed to the StrictMode source occurrence.',
  'react/Suspense/18.3.1':'Fallback, reveal, hidden layout cleanup/restore, transition retention, and abandoned-effect paths pass; boundary/retry events are not yet Suspense-specific runtime records.',
  'react/act/18.3.1':'Development callback scopes now join source and click evidence. Awaited result, queue drain and commit attribution remain unproved; production rejection needs observed build evidence.',
  'react/cloneElement/18.3.1':'The exact call and replacement behavior pass; later reconciliation/commit identity of the cloned element is a separate unjoined step.',
  'react/createElement/18.3.1':'Construction calls and non-rendering behavior pass; later reconciliation and component invocation remain separate lifecycle evidence.',
  'react/createFactory/18.3.1':'Actual returned-factory calls now join their allocation and element type. Runtime prop/ref/owner lineage and descriptor-to-host commits remain unproved.',
  'react/isValidElement/18.3.1':'The call and element/non-element results pass; no remaining blocker for the tested predicate baseline.',
  'react/lazy/18.3.1':'Lazy creation, first-render loader invocation, cache reuse, fallback, and reveal pass; loader/retry/error occurrences are not yet linked to the lazy producer semantic.',
  'react/useDeferredValue/18.3.1':'The hook call and old/new value behavior pass; foreground versus deferred render attempts are not labeled under this hook occurrence.',
  'react/useEffect/18.3.1':'Initial setup, unchanged dependencies, dependency cleanup/setup, interrupted-render non-setup, and unmount cleanup pass; exhaustive scheduler/StrictMode permutations remain untested.',
  'react/useId/18.3.1':'The hook call and per-mount stable/distinct IDs pass; hydration prefix correspondence and cross-root negative permutations are not occurrence-joined.',
  'react/useImperativeHandle/18.3.1':'Object-ref handle creation, dependency replacement, and unmount detach pass; callback-ref replacement/detach is not yet joined.',
  'react/useInsertionEffect/18.3.1':'Initial setup, dependency cleanup/setup, StrictMode behavior, and unmount cleanup pass; exhaustive error/interruption permutations remain untested.',
  'react/useLayoutEffect/18.3.1':'Initial setup, dependency cleanup/setup, Suspense hide/restore, and unmount cleanup pass; exhaustive hydration/error permutations remain untested.',
  'react/useMemo/18.3.1':'Calculator value selection, interrupted cache retention, and cached-callback click consumption pass in both builds; dynamic calculator shapes still need integration.',
  'react/useSyncExternalStore/18.3.1':'Subscribe and client snapshot callbacks join; getServerSnapshot, unsubscribe ancestry, consistency restart, and unchanged-snapshot negatives are not fully joined.',
  'react/useTransition/18.3.1':'The hook call and pending/deferred behavior pass; the returned start callback, priority scope, and update-to-commit chain are not yet emitted.',
  'react/unstable_act/18.3.1':'The development alias shares the tested callback-scope rule. Awaited queue completion and build-attributed production rejection remain unproved.',
  'react-dom/version/18.3.1':'No blocker for the tested metadata read; the string itself is deliberately not accepted as installed-source attestation.',
  'react-dom/createPortal/18.3.1':'Portal creation plus React-tree context/event behavior pass; target placement and propagated event are not retained as portal-specific runtime evidence.',
  'react-dom/findDOMNode/18.3.1':'The call and mounted-host result pass; returned DOM identity and later replacement/unmount validity are not retained by the join.',
  'react-dom/flushSync/18.3.1':'Synchronous callback invocation and returned/thrown values now join the exact source scope. Outside pending work flushed with it is not separately attributed.',
  'react-dom/hydrate/18.3.1':'The legacy call, commit callback, DOM reuse, and unmount pass in React; Tracer currently joins the call but not the commit callback or hydration result.',
  'react-dom/render/18.3.1':'The legacy call, returned instance, commit callback, update, and unmount pass in React; callback and commit identity are not joined to the call.',
  'react-dom/unmountComponentAtNode/18.3.1':'True/false return paths and cleanup pass; descendant cleanup/ref-detach evidence is not linked to this legacy call.',
  'react-dom/unstable_batchedUpdates/18.3.1':'The actual callback, forwarded argument identity, and result are joined to the batching scope and source path. Individual batched commits remain unattributed.',
  'react-dom/unstable_renderSubtreeIntoContainer/18.3.1':'The mounted-parent path and commit callback pass; parent context, callback, and target commit are not joined to the call.',
  'react-dom/createRoot/18.3.1':'Root creation is joined; returned render/unmount member calls, commits, cleanup, and recoverable errors are not one root-producer chain.',
  'react-dom/hydrateRoot/18.3.1':'Hydration creation is joined; replay/recovery, returned members, commit, and cleanup are not one producer chain.',
  'react-dom/client/createRoot/18.3.1':'Root creation is joined; returned render/unmount member calls, commits, cleanup, and recoverable errors are not one root-producer chain.',
  'react-dom/client/hydrateRoot/18.3.1':'Hydration creation, matching reuse, mismatch recovery, and error callback pass; replay, returned members, and cleanup are not one producer chain.',
  'react-dom/server/version/18.3.1':'No blocker for the tested metadata read; the string itself is deliberately not accepted as installed-source attestation.',
  'react-dom/server/renderToNodeStream/18.3.1':'The call and complete installed Node stream output pass; component-body and stream-error listener occurrences are not server-lifecycle joins.',
  'react-dom/server/renderToStaticMarkup/18.3.1':'The call and exact static output pass; server component-body occurrences and suspension/error permutations are not joined.',
  'react-dom/server/renderToStaticNodeStream/18.3.1':'The call and complete static Node stream output pass; component-body and stream-error occurrences are not server-lifecycle joins.',
  'react-dom/server/renderToString/18.3.1':'The call and exact hydratable output pass; server component-body occurrences and suspension/error permutations are not joined.',
  'react-dom/server/renderToPipeableStream/18.3.1':'Shell/all-ready output and abort recovery pass; server component bodies, callbacks, pipe, abort, error, and stream lifetime lack occurrence-specific joins.',
  'react-dom/server/renderToReadableStream/18.3.1':'The installed browser-server call, allReady, and exact Web-stream output pass; signal abort, errors, and server component bodies lack occurrence-specific joins.',
};

// Primary remaining-gap stage. A row is an integration gap whenever any part
// of its encoded behavior is still not occurrence-joined; finite-test gaps are
// reserved for rows whose listed behaviors are connected but not exhaustive.
const testingGapApis=new Set([
  'react/useEffect/18.3.1',
  'react/useInsertionEffect/18.3.1',
  'react/useLayoutEffect/18.3.1',
]);
const noRemainingBaselineGapApis=new Set([
  'react/version/18.3.1',
  'react/isValidElement/18.3.1',
  'react-dom/version/18.3.1',
  'react-dom/server/version/18.3.1',
]);

const rows=REACT_API_INVENTORY.map(record=>{
  const oracleKey=`${record.surface}.${record.export}`;
  const oraclePaths=oracle.api_paths[oracleKey]||[];
  const counts={client_development:invocationCount(record.id,clientDevelopment),
    client_production:invocationCount(record.id,clientProduction),server:invocationCount(record.id,server)};
  const total=Object.values(counts).reduce((sum,value)=>sum+value,0);
  assert.ok(oraclePaths.length>0,`missing installed React behavior path for ${record.id}`);
  assert.ok(total>0,`missing joined Tracer invocation for ${record.id}`);
  assert.ok(blockers[record.id],`missing explicit blocker statement for ${record.id}`);
  const remainingGapCategory=record.behavior?(
    noRemainingBaselineGapApis.has(record.id)?'none':
      testingGapApis.has(record.id)?'testing_gap':'integration_gap'
  ):'missing_rule';
  return {api:record.id,surface:record.surface,export:record.export,
    rule_status:record.behavior?'defined':'missing',inventory_disposition:record.disposition,
    installed_react_paths:oraclePaths,tracer_invocation_counts:counts,
    lifecycle_operations:operationsFor(record.id),callback_slots:slotsFor(record.id),
    status:'baseline_pass',remaining_gap_category:remainingGapCategory,
    exact_remaining_blocker:blockers[record.id]};
});
assert.equal(rows.length,55);
assert.equal(new Set(rows.map(row=>row.api)).size,55);

const gapCounts={missing_rule:rows.filter(row=>row.remaining_gap_category==='missing_rule').length,
  integration_gap:rows.filter(row=>row.remaining_gap_category==='integration_gap').length,
  testing_gap:rows.filter(row=>row.remaining_gap_category==='testing_gap').length,
  none:rows.filter(row=>row.remaining_gap_category==='none').length};
assert.deepEqual(gapCounts,{missing_rule:0,integration_gap:48,testing_gap:3,none:4});

const artifact={schema:'producttrace.react-api-integration-matrix.v1',react:'18.3.1',
  installed_source_attested:true,
  application_frozen_revision:frozenRevision,application_tracked_clean:true,
  inventory_rows:rows.length,baseline_passed:rows.length,
  behavior_specific_lifecycle_rows:rows.filter(row=>row.lifecycle_operations.length>0).length,
  development_and_production_invocation_rows:rows.filter(row=>
    row.tracer_invocation_counts.client_development>0&&row.tracer_invocation_counts.client_production>0).length,
  remaining_gap_counts:gapCounts,rows};

const escape=value=>String(value).replaceAll('|','\\|').replaceAll('\n',' ');
const markdown=[
  '# React 18.3.1 API integration matrix','',
  'Every row below has two independent gates: an installed-React behavior path and an exact Tracer source-occurrence invocation join. `baseline_pass` does not mean every behavior permutation is complete; the final column is part of the result.','',
  `- Inventory rows: ${artifact.inventory_rows}`,
  `- Baseline paths passed: ${artifact.baseline_passed}`,
  `- Frozen application revision: \`${artifact.application_frozen_revision}\` (tracked clean)`,
  `- Rows with behavior-specific lifecycle operations: ${artifact.behavior_specific_lifecycle_rows}`,
  `- Client rows observed in both development and production: ${artifact.development_and_production_invocation_rows}`,
  `- Primary remaining-gap counts: missing rule ${gapCounts.missing_rule}; integration gap ${gapCounts.integration_gap}; testing gap ${gapCounts.testing_gap}; no remaining baseline gap ${gapCounts.none}.`,
  '- Server rows execute against the installed Node or browser server renderer as appropriate.','',
  '| API | Installed React path(s) | Exact Tracer evidence | Status | Gap stage | Exact remaining blocker |',
  '| --- | --- | --- | --- | --- | --- |',
  ...rows.map(row=>{
    const counts=Object.entries(row.tracer_invocation_counts).filter(([,value])=>value>0)
      .map(([name,value])=>`${name}:${value}`).join(', ');
    const lifecycle=row.lifecycle_operations.length?`; lifecycle:${row.lifecycle_operations.join(',')}`:'';
    const callbacks=row.callback_slots.length?`; callbacks:${row.callback_slots.join(',')}`:'';
    return `| \`${escape(row.api)}\` | ${escape(row.installed_react_paths.join('; '))} | ${escape(counts+lifecycle+callbacks)} | ${row.status} | ${row.remaining_gap_category} | ${escape(row.exact_remaining_blocker)} |`;
  }),''];

if(writeArtifacts){
  const evidencePath=path.join(root,'docs/evidence/react-18.3.1-api-integration-matrix.json');
  const documentPath=path.join(root,'docs/react-18.3.1-api-integration-matrix.md');
  fs.mkdirSync(path.dirname(evidencePath),{recursive:true});
  fs.writeFileSync(evidencePath,`${JSON.stringify(artifact,null,2)}\n`);
  fs.writeFileSync(documentPath,markdown.join('\n'));
}
console.log(JSON.stringify({...artifact,rows:undefined,
  artifact_written:writeArtifacts},null,2));
