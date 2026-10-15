import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  analyzeBackendRoutes,
  analyzeReact,
  connectRequestToHandler,
  createReactRuntimeIntegration,
  matchRequestToRoute,
} from '../../analysis/index.mjs';

const repository = process.env.LIBRECHAT_REPOSITORY
  || '/Users/austinho/dev/trace-consolidated/.live-demo/librechat-runtime-proof';
const revision = '45cc53c40b47645b887c3bb996168e06aaa83f4c';
const frontendFiles = [
  'client/src/components/Projects/ProjectsView.tsx',
  'client/src/data-provider/index.ts',
  'client/src/data-provider/Projects/index.ts',
  'client/src/data-provider/Projects/queries.ts',
  'packages/client/src/components/Button.tsx',
  'packages/client/src/components/index.ts',
  'packages/client/src/index.ts',
  'packages/data-provider/src/index.ts',
  'packages/data-provider/src/data-service.ts',
  'packages/data-provider/src/request.ts',
  'packages/data-provider/src/api-endpoints.ts',
];
const backendFiles = [
  'api/server/index.js',
  'api/server/routes/index.js',
  'api/server/routes/projects.js',
];
const attestationFiles = [...frontendFiles, ...backendFiles, 'package-lock.json', 'package.json',
  'client/package.json', 'client/tsconfig.json', 'packages/client/package.json',
  'packages/data-provider/package.json'];

const git = args => execFileSync('git', args, { cwd: repository, encoding: 'utf8' }).trim();
assert.equal(git(['rev-parse', 'HEAD']), revision, 'LibreChat fixture revision drifted');
assert.equal(git(['status', '--porcelain=v1', '--untracked-files=no']), '', 'tracked LibreChat fixture is dirty');
const allStatus = git(['status', '--porcelain=v1']).split('\n').filter(Boolean);
assert.deepEqual(allStatus, ['?? client/node_modules'], 'only the reviewed dependency symlink may be untracked');
execFileSync('git', ['diff', '--quiet', 'HEAD', '--', ...attestationFiles], { cwd: repository });

const reactMap = analyzeReact({ repository, include: frontendFiles });
const integration = createReactRuntimeIntegration(reactMap);
const tanstack = reactMap.library_contracts.find(row => row.contract_id
  === 'tanstack-react-query/useInfiniteQuery.fetchNextPage/4.36.1');
assert.ok(tanstack?.scenario_id, 'pinned TanStack redirect was not admitted');
const candidate = integration.candidates.find(row => row.scenario_id === tanstack.scenario_id);
assert.equal(candidate?.owner?.name, 'ProjectsView');
assert.match(candidate.source.text, /fetchNextPage/u);
assert.equal(candidate.stamp_mode, 'forwarded_placement');
const binding = integration.bindings.actions.find(row => row.action === candidate.action);
assert.ok(binding);
const rawAction = { kind: 'action', session: 'librechat:projects', seq: 1,
  action: binding.action, event: 'click', target: { source_control: binding.sourceControl } };
const frontendJoin = integration.join(rawAction);
assert.equal(frontendJoin.status, 'resolved');
assert.equal(frontendJoin.runtime.action_occurrence_id, 'librechat:projects:action:1');
assert.deepEqual(frontendJoin.source.conditions.map(row => [row.text, row.branch]), [['hasNextPage', 'truthy']]);
assert.equal(frontendJoin.source.path.library_backlog.length, 0);
assert.ok(frontendJoin.source.path.library_contracts.some(row => row.contract_id
  === 'tanstack-react-query/useInfiniteQuery.fetchNextPage/4.36.1'));
assert.ok(frontendJoin.source.path.library_contracts.some(row => row.contract_id === 'axios/get.httpRequest/1.18.1'));
assert.equal(frontendJoin.source.path.outbound_requests.length, 1);
const outbound = frontendJoin.source.path.outbound_requests[0];
assert.equal(outbound.effect.method, 'GET');
assert.equal(outbound.effect.url_input.kind, 'source');
const urlNode = reactMap.nodes.find(node => node.id === outbound.effect.url_input.node_id);
assert.equal(urlNode?.text, 'endpoints.projects(params ?? {})');
const axiosCall = reactMap.nodes.find(node => node.id === outbound.invocation_call_id);
assert.match(axiosCall?.text || '', /axios\.get\(url, \{ \.\.\.options \}\)/u);
const edge = (relation, predicate) => frontendJoin.source.path.scenario_edges.find(row =>
  row.relation === relation && predicate(row));
const tanstackEdge = edge('library_callback', row => row.contract_id
  === 'tanstack-react-query/useInfiniteQuery.fetchNextPage/4.36.1');
const queryFnNode = reactMap.nodes.find(node => node.id === tanstackEdge?.to);
assert.equal(queryFnNode?.file, 'client/src/data-provider/Projects/queries.ts');
assert.match(queryFnNode?.text || '', /dataService\.listProjects/u);
const listProjectsEdge = edge('callback_forward', row => row.from === queryFnNode.id);
const listProjectsNode = reactMap.nodes.find(node => node.id === listProjectsEdge?.to);
assert.equal(listProjectsNode?.file, 'packages/data-provider/src/data-service.ts');
assert.match(listProjectsNode?.text || '', /function listProjects/u);
const requestGetEdge = edge('callback_forward', row => row.from === listProjectsNode.id
  && reactMap.nodes.find(node => node.id === row.to)?.file === 'packages/data-provider/src/request.ts');
const requestGetNode = reactMap.nodes.find(node => node.id === requestGetEdge?.to);
assert.match(requestGetNode?.text || '', /async function _get/u);
const axiosEdge = edge('library_effect', row => row.contract_id === 'axios/get.httpRequest/1.18.1'
  && row.from === outbound.invocation_call_id);
assert.ok(axiosEdge, 'selected source scenario must reach the exact Axios effect');
const sourceChain = [
  { stage: 'control', node: reactMap.nodes.find(node => node.id === candidate.source.node_id) },
  { stage: 'tanstack_callback', node: reactMap.nodes.find(node => node.id === tanstackEdge.from) },
  { stage: 'query_fn', node: queryFnNode },
  { stage: 'data_service', node: listProjectsNode },
  { stage: 'request_wrapper', node: requestGetNode },
  { stage: 'axios_request', node: axiosCall },
].map(({ stage, node }) => ({ stage, node_id: node.id, file: node.file,
  start: node.start, end: node.end, text: node.text }));
const packageEvidence = reactMap.resolution.packages.filter(row =>
  ['@tanstack/react-query', 'axios'].includes(row.name));
assert.equal(packageEvidence.length, 2);
assert.ok(packageEvidence.every(row => row.verified === true
  && typeof row.lockfile_sha256 === 'string' && typeof row.verification_sha256 === 'string'
  && row.source_attestations.length > 0));
const uniqueSourceAttestations = rows => [...new Map(rows.map(row => [
  `${row.package}\0${row.version}\0${row.install_path}\0${row.file}\0${row.sha256}`, row,
])).values()];

const backendMap = analyzeBackendRoutes({ repository, include: backendFiles, serviceId: 'librechat-api' });
const observation = {
  schema: 'producttrace.http-request-observation.v1', basis: 'runtime_observation',
  request_occurrence_id: 'librechat:network:projects:1',
  action_occurrence_id: frontendJoin.runtime.action_occurrence_id,
  map_fingerprint: reactMap.fingerprint,
  contract_application_id: outbound.contract_application_id,
  method: 'GET', url: '/api/projects?cursor=cursor-2', service: 'librechat-api',
  evidence_ids: ['fixture:network:projects:1'],
  fixture_provenance: 'deterministic_synthetic',
};
const bridge = connectRequestToHandler(frontendJoin, observation, backendMap);
assert.deepEqual([bridge.status, bridge.reason], ['resolved', 'source_request_to_route']);
assert.deepEqual([bridge.route_join.request.path, bridge.route_join.request.query],
  ['/api/projects', [{ name: 'cursor', value: 'cursor-2' }]]);
assert.deepEqual([bridge.route_join.match.method, bridge.route_join.match.path_template], ['GET', '/api/projects']);
assert.equal(bridge.route_join.match.mount_chain[0].prefix, '/api/projects');
const handlerText = backendMap.source_nodes.find(node => node.id === bridge.handler.entry_handler_ids[0])?.text;
assert.equal(handlerText, 'handlers.listProjects');
assert.equal(bridge.handler.implementation.status, 'unresolved');
assert.equal(bridge.handler.implementation.reason, 'unresolved_handler_implementation');
assert.equal(bridge.handler.backend_execution, 'unconfirmed');
for (const field of ['request_occurrence_id', 'action_occurrence_id', 'map_fingerprint', 'contract_application_id']) {
  assert.equal(bridge.request[field], observation[field], `${field} must survive the bridge`);
}

assert.equal(connectRequestToHandler(frontendJoin,
  { ...observation, action_occurrence_id: 'fixture:background-action' }, backendMap).reason,
'action_occurrence_mismatch');
assert.equal(connectRequestToHandler(frontendJoin,
  { ...observation, map_fingerprint: 'fixture:stale-map' }, backendMap).reason,
'source_map_mismatch');
assert.equal(connectRequestToHandler(frontendJoin,
  { ...observation, contract_application_id: 'fixture:unknown-contract' }, backendMap).reason,
'unknown_source_request_identity');

const post = matchRequestToRoute({ basis: 'runtime_observation', method: 'POST',
  url: '/api/projects', service: 'librechat-api' }, backendMap);
const project = matchRequestToRoute({ basis: 'runtime_observation', method: 'GET',
  url: '/api/projects/project-1', service: 'librechat-api' }, backendMap);
const unknown = matchRequestToRoute({ basis: 'runtime_observation', method: 'GET',
  url: '/api/unknown', service: 'librechat-api' }, backendMap);
assert.equal(backendMap.source_nodes.find(node => node.id === post.match.handler_ids[0])?.text,
  'handlers.createProject');
assert.equal(backendMap.source_nodes.find(node => node.id === project.match.handler_ids[0])?.text,
  'handlers.getProject');
assert.deepEqual([unknown.status, unknown.reason], ['unresolved', 'no_path_match']);

console.log(JSON.stringify({
  schema: 'producttrace.librechat-request-handler-acceptance.v1',
  status: 'passed', revision, frontend_file_count: frontendFiles.length,
  backend_file_count: backendFiles.length,
  fixture_provenance: 'deterministic_synthetic_action_and_request',
  tracked_clean: true,
  allowed_untracked: [{ path: 'client/node_modules', purpose: 'reviewed installed dependency symlink' }],
  source_chain: sourceChain,
  package_attestations: packageEvidence.map(row => ({ name: row.name, version: row.version,
    integrity: row.integrity, lockfile_sha256: row.lockfile_sha256,
    verification_sha256: row.verification_sha256,
    source_attestations: uniqueSourceAttestations(row.source_attestations) })),
  source_request: { id: outbound.contract_application_id, method: outbound.effect.method,
    symbolic_url: urlNode.text },
  request_occurrence: bridge.request,
  normalized_request: bridge.route_join.request,
  backend_route: bridge.route_join.match,
  backend_route_source: (() => {
    const node = backendMap.source_nodes.find(item => item.id === bridge.route_join.match.source_node_id);
    return { id: node.id, file: node.file, start: node.start, end: node.end, text: node.text };
  })(),
  backend_handler_source: (() => {
    const node = backendMap.source_nodes.find(item => item.id === bridge.handler.entry_handler_ids[0]);
    return { id: node.id, file: node.file, start: node.start, end: node.end, text: node.text };
  })(),
  handler: bridge.handler,
  claims: {
    source_path_selected: true,
    request_occurrence_fixture_supplied: true,
    route_registration_predicted: true,
    handler_reference_found: true,
    live_browser_click_observed: false,
    backend_handler_executed: false,
  },
}, null, 2));
