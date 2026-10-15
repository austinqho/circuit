import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  analyzeReact,
  createBrowserRequestBridgeSource,
  createReactRuntimeIntegration,
} from '../analysis/index.mjs';
import { compileReactSources } from '../analysis/react-compiler.mjs';

const AXIOS_PACKAGE = {
  axios: {
    version: '1.18.1', source: 'package-lock.json', verified: true,
    verification_sha256: 'axios-runtime-join-fixture',
  },
};

function sourceMap(testids = ['compose-send', 'search-send']) {
  const files = {
    'Button.tsx': `import * as React from 'react';
      export const Button = React.forwardRef(({ ...props }, ref) => <button ref={ref} {...props} />);`,
    'App.tsx': `import { Button } from './Button';
      const send = () => {};
      export function App() { return <>
        <section><Button data-testid="${testids[0]}" onClick={send}>Send</Button></section>
        <aside><Button data-testid="${testids[1]}" onClick={send}>Send</Button></aside>
      </>; }`,
  };
  // This unit fixture supplies explicit package evidence; source-only public
  // analysis must not guess a React version. Real installations are covered by acceptance tests.
  return { files, map: compileReactSources(files,{packages:{react:{version:'18.3.1',verified:true,verification_sha256:'runtime-join-react-fixture'}}}) };
}

function workflowRecord(sourceAction, event = 'click', sourceControl, actionOccurrenceId) {
  return {
    kind: 'workflow_event',
    schema: 'producttrace.workflow-event.v1',
    event_type: 'product.workflow_started',
    event_id: 'runtime:event:1',
    workflow_id: 'runtime:workflow:1',
    properties: {
      checkpoint: {
        source_action: sourceAction,
        ...(actionOccurrenceId ? { action_occurrence_id: actionOccurrenceId } : {}),
        control: sourceControl ? { source_control: sourceControl } : {},
        trigger: { event, label: 'Send', component: 'Button' },
        evidence: { ids: ['browser:7'] },
      },
    },
  };
}

test('runtime callback joins one exact source scenario and rejects the same-label sibling', () => {
  const { map, files } = sourceMap();
  const delivered = [];
  const integration = createReactRuntimeIntegration(map, { onJoin: join => delivered.push(join) });
  assert.equal(integration.diagnostics.filter(diagnostic => diagnostic.code === 'ambiguous_runtime_selector').length, 0);
  assert.equal(integration.bindings.actions.length, 2);

  const composeCandidate = integration.candidates.find(candidate => candidate.source.text.includes('compose-send'));
  const searchCandidate = integration.candidates.find(candidate => candidate.source.text.includes('search-send'));
  const compose = integration.bindings.actions.find(action => action.sourceControl.endsWith(`:${composeCandidate.control_id}`));
  const search = integration.bindings.actions.find(action => action.sourceControl.endsWith(`:${searchCandidate.control_id}`));
  assert.ok(compose && search);
  assert.notEqual(compose.action, search.action);
  assert.equal(Object.hasOwn(compose, 'component'), false,
    'an exact generated source stamp must not depend on a minifier-sensitive component name');
  assert.equal(Object.hasOwn(compose, 'text'), false, 'visible labels must not become source-identity evidence');
  assert.equal(Object.hasOwn(compose, 'testid'), false, 'existing app anchors are not treated as the source witness');

  const instrumented = integration.instrumentSource('App.tsx', files['App.tsx']);
  assert.equal(instrumented.diagnostics.length, 0);
  assert.equal(instrumented.applied.length, 2);
  assert.match(instrumented.code, new RegExp(`data-producttrace-control-click="${compose.sourceControl}"`));
  assert.match(instrumented.code, new RegExp(`data-producttrace-control-click="${search.sourceControl}"`));

  const joined = integration.join(workflowRecord(compose.action, 'click', compose.sourceControl, 'browser:action:7'));
  integration.onRecord(workflowRecord(compose.action, 'click', compose.sourceControl, 'browser:action:7'));
  assert.equal(joined.status, 'resolved');
  assert.equal(joined.source.control_id,
    composeCandidate.control_id);
  assert.notEqual(joined.source.control_id,
    searchCandidate.control_id);
  assert.equal(joined.evidence.selector.sourceControl, compose.sourceControl);
  assert.deepEqual(joined.runtime.evidence_ids, ['browser:7']);
  assert.equal(joined.runtime.action_occurrence_id, 'browser:action:7');
  assert.deepEqual(delivered, [joined]);
});

test('runtime callback carries only the selected scenario library path and outbound request', () => {
  const map = compileReactSources({
    'App.tsx': `import axios from 'axios';
      export function App() { return <>
        <button type="button" onClick={() => axios.post('/api/chat', { surface: 'chat' })}>Send</button>
        <button type="button" onClick={() => axios.post('/api/scroll', { surface: 'scroll' })}>Send</button>
      </>; }`,
  }, { packages: AXIOS_PACKAGE });
  map.input = { complete: true };
  const delivered = [];
  const integration = createReactRuntimeIntegration(map, { onJoin: join => delivered.push(join) });
  const chatContract = map.library_contracts.find(row => row.effect?.url_input?.value === '/api/chat');
  const scrollContract = map.library_contracts.find(row => row.effect?.url_input?.value === '/api/scroll');
  assert.ok(chatContract && scrollContract);
  const chatCandidate = integration.candidates.find(row => row.scenario_id === chatContract.scenario_id);
  const chatAction = integration.bindings.actions.find(row => row.action === chatCandidate.action);

  integration.onRecord(workflowRecord(chatAction.action, 'click', chatAction.sourceControl));

  assert.equal(delivered.length, 1);
  const joined = delivered[0];
  assert.equal(joined.status, 'resolved');
  assert.equal(joined.source.path.outbound_requests.length, 1);
  assert.equal(joined.source.path.outbound_requests[0].effect.method, 'POST');
  assert.equal(joined.source.path.outbound_requests[0].effect.url_input.value, '/api/chat');
  assert.equal(joined.source.path.library_contracts.some(row => row.id === chatContract.id), true);
  assert.equal(joined.source.path.library_contracts.some(row => row.id === scrollContract.id), false);
  assert.equal(joined.source.path.scenario_edges.every(row => row.scenario_id === chatContract.scenario_id), true);
  assert.equal(joined.source.path.library_backlog.length, 0);

  joined.source.path.outbound_requests[0].effect.method = 'MUTATED';
  const joinedAgain = integration.join(workflowRecord(chatAction.action, 'click', chatAction.sourceControl));
  assert.equal(joinedAgain.source.path.outbound_requests[0].effect.method, 'POST');
});

test('dynamic event callbacks require runtime selection and reject candidate contamination', () => {
  const files = {'App.tsx': `const left=()=>{};const right=()=>{};
    export function App({pickLeft}){return <button onClick={pickLeft ? left : right}>Run</button>}`};
  const map = analyzeReact({files});
  map.input = {complete:true};
  const integration = createReactRuntimeIntegration(map);
  const control = map.controls.find(row => row.callback_selection === 'runtime_required');
  const scenarios = map.scenarios.filter(row => row.control_id === control.id);
  assert.equal(scenarios.length, 2);
  assert.deepEqual(scenarios.map(row => row.conditions[0].branch).sort(), ['falsy','truthy']);
  assert.equal(integration.bindings.actions.length, 0,
    'source prediction must not choose one runtime callback branch');
  const transformed = integration.instrumentSource('App.tsx', files['App.tsx']);
  assert.ok(transformed.applied.some(row => row.transform === 'react_event_callback'));
  assert.equal(transformed.applied.filter(row => row.transform === 'react_callback_source_tag').length, 2);
  const entry = integration.bindings.react_lifecycle.entries.find(row => row.kind === 'event_callback');
  const selected = entry.scenario_options[0];
  const observation = {
    schema:'producttrace.react-callback-observation.v1',kind:'react_callback',
    map_fingerprint:map.fingerprint,observation_id:'callback-1',occurrence_id:'callback-occurrence-1',
    evidence_ids:['runtime-callback-1'],control_id:entry.control_id,binding_id:entry.binding_id,
    event:entry.event,action_occurrence_id:'browser:action:1',
    candidate_source_ids:entry.scenario_options.map(row => row.handler_source_id),
    selected_source_id:selected.handler_source_id,selected_scenario_id:selected.scenario_id,
    status:'resolved',reason:null,runtime_observed:true,
  };
  assert.equal(integration.joinCallback(observation).status, 'resolved');
  assert.equal(integration.joinCallback({...observation,map_fingerprint:'foreign'}).reason,
    'map_fingerprint_mismatch');
  assert.equal(integration.joinCallback({...observation,candidate_source_ids:[selected.handler_source_id]}).reason,
    'callback_candidate_set_mismatch');
  assert.equal(integration.joinCallback({...observation,selected_scenario_id:entry.scenario_options[1].scenario_id}).reason,
    'callback_source_scenario_mismatch');
  assert.equal(integration.joinCallback({...observation,action_occurrence_id:''}).reason,
    'callback_action_occurrence_required');
});

test('generic React API observations join exact call and value-read occurrences', () => {
  const source=`import * as React from 'react';
    const version=React.version;
    export function Probe(){const value=React.useMemo(()=>1,[]);return <b>{value}</b>}`;
  const map=compileReactSources({'App.tsx':source},{packages:{react:{version:'18.3.1',verified:true,
    verification_sha256:'verified-react'}}});
  const integration=createReactRuntimeIntegration(map);
  const transformed=integration.instrumentSource('App.tsx',source);
  assert.ok(transformed.applied.some(row=>row.transform==='react_api_call'));
  assert.ok(transformed.applied.some(row=>row.transform==='react_api_value'));
  const records=[];
  const runtime=integration.createApiRuntime({session:'api-session',onObservation:record=>records.push(record)});
  const call=integration.bindings.react_lifecycle.entries.find(row=>row.kind==='api_call'
    && row.semantic_id==='react/useMemo/18.3.1');
  const value=integration.bindings.react_lifecycle.entries.find(row=>row.kind==='api_value'
    && row.semantic_id==='react/version/18.3.1');
  assert.equal(runtime.apiResult(call.key,1),1);
  assert.equal(runtime.apiValue(value.key,'18.3.1'),'18.3.1');
  assert.deepEqual(records.map(record=>integration.joinApi(record).status),['resolved','resolved']);
  assert.equal(integration.joinApi({...records[0],map_fingerprint:'foreign'}).reason,
    'map_fingerprint_mismatch');
  assert.equal(integration.joinApi({...records[0],manifest_key:value.key}).reason,
    'api_source_occurrence_mismatch');
  assert.equal(integration.joinApi({...records[0],operation:'read'}).reason,
    'api_source_occurrence_mismatch');
  assert.equal(integration.joinApi({...records[0],semantic_id:'react/useEffect/18.3.1'}).reason,
    'api_source_occurrence_mismatch');
  assert.equal(integration.joinApi({...records[0],surface:'react-dom'}).reason,
    'api_source_occurrence_mismatch');
  assert.equal(integration.joinApi({...records[0],export:'useEffect'}).reason,
    'api_source_occurrence_mismatch');
  assert.equal(integration.joinApi({...records[0],evidence_ids:['borrowed']}).reason,
    'runtime_api_evidence_required');
  assert.equal(integration.joinApi({...records[0],occurrence_id:'borrowed'}).reason,
    'runtime_api_evidence_required');
});

test('request bridge instruments discovered handlers and request calls without a URL hint', () => {
  const files = {
    'request.ts': `import axios from 'axios';
      export function send() { return axios.post('/api/chat', { surface: 'chat' }); }`,
    'App.tsx': `import { send } from './request';
      export function App() { return <button type="button" onClick={() => send()}>Send</button>; }`,
  };
  const map = compileReactSources(files, { packages: AXIOS_PACKAGE });
  map.input = { complete: true };
  const integration = createReactRuntimeIntegration(map, { requestBridge: true });
  assert.equal(integration.request_bridge.actions.length, 1);
  assert.deepEqual(Object.keys(integration.request_bridge.actions[0]).sort(),
    ['action', 'event', 'requests', 'source_control']);
  assert.deepEqual(integration.request_bridge.actions[0].requests.map(request => request.method), ['POST']);

  const app = integration.instrumentSource('App.tsx', files['App.tsx']);
  const request = integration.instrumentSource('request.ts', files['request.ts']);
  assert.equal(app.diagnostics.length, 0);
  assert.equal(request.diagnostics.length, 0);
  assert.match(app.code, /data-producttrace-control-click/u);
  assert.match(app.code, /__productTraceRequestBridge\.begin/u);
  assert.match(request.code, /__productTraceRequestBridge\.request/u);

  const browser = createBrowserRequestBridgeSource(integration, {
    bridgeEndpoint: 'http://127.0.0.1:8123/api/demo/bridge',
    service: 'fixture-api',
    applicationId: 'server.js#app',
  });
  assert.match(browser, /mapped_actions/u);
  assert.match(browser, /retainObservation\(record\)/u,
    'the general installation must retain lifecycle observations for evidence joining');
  assert.match(browser, /react-observations/u);
  assert.match(browser, /server\.js#app/u);
  assert.doesNotMatch(browser, /\/api\/chat/u,
    'the runtime request matcher must observe the URL instead of receiving the expected answer');
});

test('outbound request candidates retain mutually exclusive source branch guards', () => {
  const map = compileReactSources({
    'App.tsx': `import axios from 'axios';
      export function App({ ready }) { return <button type="button" onClick={() => {
        if (ready) axios.post('/api/ready'); else axios.post('/api/not-ready');
      }}>Send</button>; }`,
  }, { packages: AXIOS_PACKAGE });
  map.input = { complete: true };
  const integration = createReactRuntimeIntegration(map);
  const candidate = integration.candidates[0];
  const action = integration.bindings.actions[0];
  const joined = integration.join(workflowRecord(action.action, 'click', action.sourceControl));
  const requests = new Map(joined.source.path.outbound_requests
    .map(request => [request.effect.url_input.value, request]));
  assert.deepEqual(requests.get('/api/ready').conditions.map(row => [row.text, row.branch]),
    [['ready', 'truthy']]);
  assert.deepEqual(requests.get('/api/not-ready').conditions.map(row => [row.text, row.branch]),
    [['ready', 'falsy']]);
  assert.equal(requests.get('/api/ready').contract_application_id,
    map.library_contracts.find(row => row.effect.url_input.value === '/api/ready').id);
  assert.ok(requests.get('/api/ready').evidence_ids.length > 0);
  assert.equal(candidate.path.scenario_edges.every(row => row.scenario_id === candidate.scenario_id), true);
});

test('identical labels, app anchors, and callbacks still receive distinct occurrence stamps', () => {
  const { map, files } = sourceMap(['same-send', 'same-send']);
  const integration = createReactRuntimeIntegration(map);
  assert.equal(integration.bindings.actions.length, 2);
  assert.equal(integration.candidates.length, 2);
  assert.notEqual(integration.candidates[0].control_id, integration.candidates[1].control_id);
  const instrumented = integration.instrumentSource('App.tsx', files['App.tsx']);
  assert.equal(instrumented.applied.length, 2);
  assert.equal(new Set(instrumented.applied.map(stamp => stamp.control_id)).size, 2);
  const joined = integration.join(workflowRecord(undefined));
  assert.equal(joined.status, 'unresolved');
  assert.equal(joined.reason, 'missing_source_action');
  assert.equal(joined.source, null);
});

test('runtime callback preserves missing, foreign, and mismatched evidence as unresolved', () => {
  const { map, files } = sourceMap();
  const integration = createReactRuntimeIntegration(map);
  const action = integration.bindings.actions[0].action;
  assert.equal(integration.join({ kind: 'route' }), null);
  assert.equal(integration.join(workflowRecord(undefined)).reason, 'missing_source_action');
  assert.equal(integration.join(workflowRecord('reviewed-business-action')).reason, 'unknown_source_action');
  assert.equal(integration.join(workflowRecord(action, 'click', 'control:foreign')).reason, 'runtime_source_control_mismatch');
  assert.equal(integration.join(workflowRecord(action, 'keydown', integration.bindings.actions[0].sourceControl)).reason, 'runtime_event_mismatch');
  const raw = integration.join({ kind: 'action', event: 'click', action, session: 'runtime-session', seq: 7,
    target: { source_control: integration.bindings.actions[0].sourceControl } });
  assert.equal(raw.status, 'resolved');
  assert.equal(raw.runtime.event_id, 'runtime-session:action:7');
  assert.equal(raw.runtime.action_occurrence_id, 'runtime-session:action:7');
  assert.deepEqual(raw.runtime.evidence_ids, []);
  assert.equal(integration.join({ kind: 'action', event: 'click', action,
    target: { source_control: integration.bindings.actions[0].sourceControl } }).reason, 'missing_runtime_occurrence');
  const noEvidence = workflowRecord(action, 'click', integration.bindings.actions[0].sourceControl);
  noEvidence.properties.checkpoint.evidence.ids = [];
  assert.equal(integration.join(noEvidence).reason, 'missing_runtime_evidence');
  const drifted = integration.instrumentSource('App.tsx', files['App.tsx'] + '\n// drift');
  assert.equal(drifted.applied.length, 0);
  assert.equal(drifted.diagnostics[0].code, 'source_snapshot_mismatch');
});

test('runtime join consumes recorded React commit identity without inventing a render attempt', () => {
  const { map } = sourceMap();
  const integration = createReactRuntimeIntegration(map);
  const binding = integration.bindings.actions[0];
  const record = workflowRecord(binding.action, binding.event, binding.sourceControl);
  record.properties.checkpoint.react_identity = {root_id:'react-root:1',instance_id:'react-instance:2',
    mount_id:'react-mount:2',commit_id:'react-commit:3',render_id:null,render_observed:false,
    runtime_observed:true,basis:'react-devtools-commit.v1'};
  const joined = integration.join(record);
  assert.equal(joined.status,'resolved');
  assert.deepEqual(joined.runtime.react_identity,record.properties.checkpoint.react_identity);
  const forged=structuredClone(record);forged.properties.checkpoint.react_identity.render_observed=true;
  assert.equal(integration.join(forged).reason,'invalid_react_runtime_identity');
  const lifecycleMap=compileReactSources({'Lifecycle.tsx':`import {useEffect} from 'react';
    export function Lifecycle(){useEffect(()=>{},[]);const run=()=>{};return <button onClick={run}>Run</button>}`},
  {packages:{react:{version:'18.3.1',verified:true,verification_sha256:'verified-react'}}});
  lifecycleMap.input={complete:true};
  const lifecycleIntegration=createReactRuntimeIntegration(lifecycleMap);
  const lifecycleBinding=lifecycleIntegration.bindings.actions[0];
  const lifecycleSource=lifecycleMap.react_semantics.find(row=>row.causal_bindings.owner_source_id);
  const withLifecycle=workflowRecord(lifecycleBinding.action,'click',lifecycleBinding.sourceControl,
    'browser:action:lifecycle');
  withLifecycle.properties.checkpoint.react_identity=record.properties.checkpoint.react_identity;
  withLifecycle.properties.checkpoint.react_lifecycle_identity={session:'runtime-session',root_id:'react-root:1',
    instance_id:'react-instance:parent',mount_id:'react-mount:parent',render_id:'react-render:4',
    source_call_id:lifecycleSource.call_id,semantic_id:lifecycleSource.semantic_id,
    owner_source_id:lifecycleSource.causal_bindings.owner_source_id,status:'committed',
    runtime_observed:true,basis:'react-lifecycle-render.v1'};
  assert.deepEqual(lifecycleIntegration.join(withLifecycle).runtime.react_lifecycle_identity,
    withLifecycle.properties.checkpoint.react_lifecycle_identity);
  const contaminated=structuredClone(withLifecycle);
  contaminated.properties.checkpoint.react_lifecycle_identity.source_call_id='call:foreign';
  assert.equal(lifecycleIntegration.join(contaminated).reason,'invalid_react_lifecycle_identity');
});

test('source stamps bind the map fingerprint and are inserted after spreads without corrupting custom elements', () => {
  const customFiles = { 'App.tsx': `const save = () => {}; export function App(props) { return <>
    <my-button onClick={save}>Save</my-button>
    <button onClick={save} {...{ title: 'later' }}>Save</button>
  </>; }` };
  const custom = createReactRuntimeIntegration(analyzeReact({ files: customFiles }));
  const transformed = custom.instrumentSource('App.tsx', customFiles['App.tsx']);
  assert.equal(transformed.applied.length, 2);
  assert.match(transformed.code, /<my-button onClick=\{save\} data-producttrace-control-click="[^"]+">/);
  assert.match(transformed.code, /<button onClick=\{save\} \{\.\.\.\{ title: 'later' \}\} data-producttrace-control-click="[^"]+">/);
  assert.equal(transformed.code.includes('<my data-producttrace'), false);

  const files = {
    'handler.ts': 'export function save() { return 1; }',
    'App.tsx': "import { save } from './handler'; export function App() { return <button onClick={save}>Save</button>; }",
  };
  const oldMap = analyzeReact({ files });
  const newMap = analyzeReact({ files: { ...files, 'handler.ts': 'export function save() { return 2; }' } });
  const oldIntegration = createReactRuntimeIntegration(oldMap);
  const newIntegration = createReactRuntimeIntegration(newMap);
  assert.equal(oldMap.controls[0].id, newMap.controls[0].id, 'control source identity is intentionally unchanged');
  assert.notEqual(oldMap.fingerprint, newMap.fingerprint);
  const oldStamp = oldIntegration.bindings.actions[0].sourceControl;
  const newAction = newIntegration.bindings.actions[0];
  assert.equal(newIntegration.join(workflowRecord(newAction.action, 'click', oldStamp)).reason,
    'runtime_source_control_mismatch');
});

test('explicit callback forwarding stamps the native host and abstains when that host represents repeated placements', () => {
  const child = `export function Child({ onClick }) { return <button onClick={onClick}>Send</button>; }`;
  const oneFiles = {
    'Child.tsx': child,
    'App.tsx': `import { Child } from './Child'; const save = () => {}; export function App() { return <Child onClick={save} />; }`,
  };
  const one = createReactRuntimeIntegration(analyzeReact({ files: oneFiles }));
  assert.equal(one.candidates.length, 1);
  assert.equal(one.candidates[0].source.file, 'Child.tsx');
  const childTransform = one.instrumentSource('Child.tsx', oneFiles['Child.tsx']);
  const appTransform = one.instrumentSource('App.tsx', oneFiles['App.tsx']);
  assert.equal(childTransform.applied.length, 1);
  assert.match(childTransform.code, /<button onClick=\{onClick\} data-producttrace-control-click=/);
  assert.equal(appTransform.applied.length, 0);

  const repeatedFiles = {
    'Child.tsx': child,
    'App.tsx': `import { Child } from './Child'; const send = () => {}; export function App() { return <><Child onClick={send} /><Child onClick={send} /></>; }`,
  };
  const repeated = createReactRuntimeIntegration(analyzeReact({ files: repeatedFiles }));
  assert.equal(repeated.candidates.length, 0);
  assert.equal(repeated.diagnostics.filter(diagnostic => diagnostic.code === 'ambiguous_source_stamp').length, 2);
});

test('selective object forwarding cannot masquerade as arbitrary source-stamp forwarding', () => {
  const files = {
    'Child.tsx': `export function Child({ onClick }) { return <button {...{ onClick }}>Send</button>; }`,
    'App.tsx': `import { Child } from './Child'; const save = () => {}; export function App() { return <Child onClick={save} />; }`,
  };
  const integration = createReactRuntimeIntegration(analyzeReact({ files }));
  assert.equal(integration.candidates.length, 1);
  assert.equal(integration.candidates[0].stamp_mode, 'native_host');
  assert.equal(integration.instrumentSource('App.tsx', files['App.tsx']).applied.length, 0);
  assert.equal(integration.instrumentSource('Child.tsx', files['Child.tsx']).applied.length, 1);
});

test('an unresolved sibling still makes a shared native host ambiguous', () => {
  const files = {
    'Child.tsx': `export function Child({ onClick }) { return <button onClick={onClick}>Send</button>; }`,
    'App.tsx': `import { Child } from './Child'; const save = () => {}; export function App({ other }) { return <><Child onClick={save} /><Child onClick={other} /></>; }`,
  };
  const integration = createReactRuntimeIntegration(analyzeReact({ files }));
  assert.equal(integration.candidates.length, 0);
  assert.ok(integration.diagnostics.some(diagnostic => diagnostic.code === 'unresolved_source_control'));
  assert.ok(integration.diagnostics.some(diagnostic => diagnostic.code === 'unresolved_render_topology'));
  assert.equal(integration.instrumentSource('Child.tsx', files['Child.tsx']).applied.length, 0);
});

test('an unmapped dynamic placement blocks native-host stamping', () => {
  const files = {
    'Child.tsx': `export function Child({ onClick }) { return <button onClick={onClick}>Send</button>; }`,
    'App.tsx': `import { Child } from './Child'; const save = () => {}; export function App({ other }) { return <><Child onClick={save} />{[1].map(() => <Child onClick={other} />)}</>; }`,
  };
  const integration = createReactRuntimeIntegration(analyzeReact({ files }));
  assert.equal(integration.candidates.length, 0);
  assert.ok(integration.diagnostics.some(diagnostic => diagnostic.code === 'unresolved_render_topology'));
  assert.equal(integration.instrumentSource('Child.tsx', files['Child.tsx']).applied.length, 0);
});

test('any unreturned JSX frontier blocks native-host stamping', () => {
  const files = {
    'Child.tsx': `export function Child({ onClick }) { return <button onClick={onClick}>Send</button>; }`,
    'App.tsx': `import { Child } from './Child'; const save = () => {}; export function App({ other }) { const second = <Child onClick={other} />; return <><Child onClick={save} />{second}</>; }`,
  };
  const integration = createReactRuntimeIntegration(analyzeReact({ files }));
  assert.equal(integration.candidates.length, 0);
  assert.ok(integration.diagnostics.some(diagnostic => diagnostic.code === 'unresolved_render_topology'));
});

test('events absent from the browser listener are rejected explicitly', () => {
  const files = { 'App.tsx': `const save = () => {}; export function App() { return <input onInput={save} onKeyUp={save} />; }` };
  const integration = createReactRuntimeIntegration(analyzeReact({ files }));
  assert.equal(integration.candidates.length, 0);
  assert.equal(integration.diagnostics.filter(diagnostic => diagnostic.code === 'unsupported_runtime_event').length, 2);
});
