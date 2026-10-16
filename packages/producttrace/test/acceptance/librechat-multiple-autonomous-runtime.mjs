import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  createReactLifecycleEvidenceSession,
  createReactRuntimeIntegration,
} from '../../analysis/index.mjs';

const configPath=path.resolve(process.argv[2]||'/tmp/producttrace-librechat-pr8-final.json');
const origin=process.env.PRODUCTTRACE_VIEWER_ORIGIN||'http://127.0.0.1:8134';
const config=JSON.parse(fs.readFileSync(configPath,'utf8'));
assert.equal(config.schema,'producttrace.autonomous-installation.v1');
assert.ok(config.request_bridge.actions.length>=2,
  'multiple analyzer-discovered request controls are required');
const frozenRevision=execFileSync('git',['rev-parse','HEAD'],{cwd:config.repository,encoding:'utf8'}).trim();
assert.equal(execFileSync('git',['status','--porcelain=v1','--untracked-files=no'],{
  cwd:config.repository,encoding:'utf8'}).trim(),'','the frozen checkout has tracked changes');

const [entriesResponse,spansResponse,observationsResponse]=await Promise.all([
  fetch(`${origin}/api/demo/bridge/latest`),
  fetch(`${origin}/api/demo/backend-spans/latest`),
  fetch(`${origin}/api/demo/react-observations`),
]);
assert.equal(entriesResponse.status,200);
assert.equal(spansResponse.status,200);
assert.equal(observationsResponse.status,200);
const entries=await entriesResponse.json();
const spans=await spansResponse.json();
const observations=await observationsResponse.json();
const integration=createReactRuntimeIntegration(config.react_map);
const candidates=new Map(integration.candidates.map(candidate=>[candidate.action,candidate]));
const bindings=new Map(config.request_bridge.actions.map(binding=>[binding.action,binding]));

const executed=[];
for(const binding of bindings.values()){
  const matching=entries.filter(entry=>entry.action?.action===binding.action
    && entry.action?.target?.source_control===binding.source_control
    && entry.result?.handler?.backend_execution==='confirmed');
  assert.ok(matching.length>0,`discovered control did not reach confirmed backend evidence: ${binding.source_control}`);
  const entry=matching[0];
  const candidate=candidates.get(binding.action);
  assert.ok(candidate,'runtime action no longer has its generated source candidate');
  assert.equal(entry.frontend_join.status,'resolved');
  assert.equal(entry.result.status,'resolved');
  assert.ok(binding.requests.some(request=>request.contract_application_id
    ===entry.result.request.contract_application_id));
  const evidence=entry.result.handler.backend_evidence;
  const traceSpans=spans.filter(span=>span.trace_id===evidence.trace_id);
  assert.ok(traceSpans.some(span=>span.span_id===evidence.server_span_id));
  assert.ok(traceSpans.some(span=>evidence.handler_span_ids.includes(span.span_id)));
  assert.ok(traceSpans.some(span=>evidence.database_span_ids.includes(span.span_id)));
  assert.ok(entry.action.react_lifecycle_identity,
    'the click has no committed source lifecycle identity');
  executed.push({binding,entry,candidate});
}
assert.equal(new Set(executed.map(row=>row.binding.source_control)).size,bindings.size);
assert.equal(new Set(executed.map(row=>row.candidate.source.file)).size>=2,true,
  'multiple controls must not be aliases of one source occurrence');

const lifecycle=observations.filter(record=>record.kind==='react_lifecycle')
  .sort((left,right)=>(left.session||'').localeCompare(right.session||'')||(left.seq||0)-(right.seq||0));
assert.ok(lifecycle.length>0,'the ordinary LibreChat integration recorded no lifecycle evidence');
const session=createReactLifecycleEvidenceSession(config.react_map);
const lifecycleJoins=lifecycle.map(record=>session.join(record));
const rejected=lifecycleJoins.map((join,index)=>({join,record:lifecycle[index]}))
  .filter(row=>row.join.status!=='resolved');
assert.deepEqual(rejected,[],'runtime lifecycle records failed their independent source join');
for(const {entry} of executed){
  const identity=entry.action.react_lifecycle_identity;
  assert.ok(lifecycle.some(record=>record.operation==='render_committed'
    && record.session===identity.session
    && record.root_id===identity.root_id && record.instance_id===identity.instance_id
    && record.mount_id===identity.mount_id && record.render_id===identity.render_id
    && record.source_call_id===identity.source_call_id && record.semantic_id===identity.semantic_id),
  'the click lifecycle identity has no matching committed render observation');
}

const callbackObservations=observations.filter(record=>record.kind==='react_callback');
const callbackJoins=callbackObservations.map(record=>integration.joinCallback(record));
assert.deepEqual(callbackJoins.filter(join=>join.status!=='resolved'),[],
  'a runtime-selected callback failed its exact source join');
const apiObservations=observations.filter(record=>record.kind==='react_api');
assert.ok(apiObservations.length>0,'the ordinary LibreChat integration recorded no React API evidence');
const apiJoins=apiObservations.map(record=>integration.joinApi(record));
assert.deepEqual(apiJoins.filter(join=>join.status!=='resolved'),[],
  'an observed React API occurrence failed its exact source join');
const operations=lifecycle.reduce((counts,record)=>(counts[record.operation]=(counts[record.operation]||0)+1,counts),{});
const contextReads=lifecycle.filter(record=>record.operation==='value_read'
  && record.semantic_id==='react/useContext/18.3.1');
const contextStatuses=contextReads.reduce((counts,record)=>(
  counts[record.context_provider_status]=(counts[record.context_provider_status]||0)+1,counts),{});
assert.deepEqual([...new Set(contextReads.filter(record=>record.context_provider_status==='source_unresolved')
  .map(record=>record.context_provider_unresolved_reason))],['provider_source_uninstrumented']);

console.log(JSON.stringify({
  schema:'producttrace.librechat-multiple-autonomous-runtime-acceptance.v1',
  status:'passed',repository:config.repository,frozen_revision:frozenRevision,
  map_fingerprint:config.react_map.fingerprint,
  supplied_path_hints:[],
  discovered_request_actions:bindings.size,
  executed_paths:executed.map(({binding,entry,candidate})=>({
    source_control:binding.source_control,source:candidate.source,owner:candidate.owner,
    request:{method:entry.result.route_join.match.method,
      path_template:entry.result.route_join.match.path_template,
      occurrence_id:entry.result.request.request_occurrence_id},
    handler_labels:entry.result.handler.entry_handler_labels,
    lifecycle_identity:entry.action.react_lifecycle_identity,
  })),
  lifecycle:{observations:lifecycle.length,joined:lifecycleJoins.length,operations,
    mounted_instances:new Set(lifecycle.map(record=>record.mount_id)).size,
    source_occurrences:new Set(lifecycle.map(record=>`${record.source_call_id}\0${record.semantic_id}`)).size},
  contexts:{source_resolved:contextStatuses.source_resolved||0,default:contextStatuses.default||0,
    source_unresolved:contextStatuses.source_unresolved||0,
    source_unresolved_reason:'provider_source_uninstrumented'},
  dynamic_callbacks:{observed:callbackObservations.length,joined:callbackJoins.length},
  react_apis:{observed:apiObservations.length,joined:apiJoins.length,
    semantic_ids:[...new Set(apiObservations.map(record=>record.semantic_id))].sort()},
  unsupported:{react_frontiers:config.frontiers.react.length,
    runtime_frontiers:config.frontiers.runtime.length,backend_frontiers:config.frontiers.backend.length,
    transform_frontiers:config.frontiers.transforms.length,
    application_identity_frontiers:config.frontiers.application_identity.length},
},null,2));
