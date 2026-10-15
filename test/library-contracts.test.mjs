import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { analyzeReact } from '../analysis/index.mjs';
import { compileReactSources } from '../analysis/react-compiler.mjs';

const PACKAGE = {
  '@tanstack/react-query': {
    version: '4.36.1',
    source: 'package-lock.json',
    integrity: 'sha512-y7ySVHFyyQblPl3J3eQBWpXZkliroki3ARnBKsdJchlgt7yJLRDUcf4B8soufgiYt3pEQIkBWBx1N9/ZPIeUWw==',
    verified: true,
    verification_sha256: 'fixture-verification',
  },
};

const RECOIL_PACKAGE = {
  recoil: {
    version: '0.7.7', source: 'package-lock.json',
    integrity: 'sha512-8Og5KPQW9LwC577Vc7Ug2P0vQshkv1y3zG3tSSkWMqkWSwHmE+by06L8JtnGocjW6gcCvfwB3YtrJG6/tWivNQ==',
    verified: true, verification_sha256: 'recoil-fixture-verification',
  },
};

const FORM_PACKAGE = {
  'react-hook-form': {
    version: '7.50.0', source: 'package-lock.json',
    integrity: 'sha512-AOhuzM3RdP09ZCnq+Z0yvKGHK25yiOX5phwxjV9L7U6HMla10ezkBnvQ+Pk4GTuDfsC5P2zza3k8mawFwFLVuQ==',
    verified: true, verification_sha256: 'form-fixture-verification',
  },
};

const ROUTER_PACKAGE = {
  'react-router-dom': {
    version: '7.18.2', source: 'package-lock.json',
    integrity: 'sha512-AIKJ/jgGlFb3EbfCXk5Gzshiwt+l3mqbCrNjmEWMMjqQxNJ3svBa6bgzFyCC2Sw3RA0VWF1kg3uQf2OFhxb8hw==',
    verified: true, verification_sha256: 'router-fixture-verification',
  },
};

const ARIAKIT_PACKAGE = {
  '@ariakit/react': {
    version: '0.4.29', source: 'package-lock.json',
    integrity: 'sha512-SLXlsddWHSwfUol4Yi0zULlalNWjzWjpS3zg7B7aaPd64saONQ5ktWf9KMxqBklcpjMLeF2dB9BAHAvpPVdCIQ==',
    verified: true, verification_sha256: 'ariakit-fixture-verification',
  },
};

const TABLE_PACKAGE = {
  '@tanstack/react-table': {
    version: '8.11.7', source: 'package-lock.json',
    integrity: 'sha512-ZbzfMkLjxUTzNPBXJYH38pv2VpC9WUA+Qe5USSHEBz0dysDTv4z/ARI3csOed/5gmlmrPzVUN3UXGuUMbod3Jg==',
    verified: true, verification_sha256: 'table-fixture-verification',
  },
};

const AXIOS_PACKAGE = {
  axios: {
    version: '1.18.1', source: 'package-lock.json',
    integrity: 'sha512-3nTvFlvpn9Zu/RkHUqtc7/+al4UpRW5az71ap5zccp6e8RAYEzhMTecX8Dz1wWDYrPpUoB1HAQEGEAEvUr7S9g==',
    verified: true, verification_sha256: 'axios-fixture-verification',
  },
};

function compile(files, packages = PACKAGE) {
  return compileReactSources(files, { packages });
}

function source(map, id) {
  return map.nodes.find(node => node.id === id)?.text || '';
}

test('TanStack infinite-query handles invoke only their own queryFn through one wrapper', () => {
  const map = compile({
    'App.tsx': `import { useA, useB } from './queries';
      export function App() {
        const { fetchNextPage: nextA } = useA();
        const { fetchNextPage: nextB } = useB();
        return <><button onClick={() => nextA()}>A</button><button onClick={() => nextB()}>B</button></>;
      }`,
    'queries.ts': `import { useInfiniteQuery } from '@tanstack/react-query';
      function queryA({ pageParam }) { return requestA(pageParam); }
      function queryB({ pageParam }) { return requestB(pageParam); }
      export const useA = () => useInfiniteQuery({ queryKey: ['a'], queryFn: queryA });
      export const useB = () => useInfiniteQuery({ queryKey: ['b'], queryFn: queryB });`,
  });
  assert.equal(map.library_contracts.length, 2);
  const applications = new Map(map.library_contracts.map(row => [source(map, row.invocation_call_id), row]));
  assert.match(source(map, applications.get('nextA()').callback_id), /function queryA/u);
  assert.match(source(map, applications.get('nextB()').callback_id), /function queryB/u);
  assert.notEqual(applications.get('nextA()').scenario_id, applications.get('nextB()').scenario_id);
  assert.notEqual(applications.get('nextA()').placement_id, undefined);
  assert.deepEqual(applications.get('nextA()').wrapper_call_ids.map(id => source(map, id)), ['useA()']);
  assert.deepEqual(applications.get('nextB()').wrapper_call_ids.map(id => source(map, id)), ['useB()']);
  const aTargets = map.edges.filter(edge => edge.relation === 'library_callback'
    && source(map, edge.from) === 'nextA()').map(edge => source(map, edge.to));
  assert.equal(aTargets.some(text => /queryB/u.test(text)), false);
  assert.deepEqual(map.library_backlog, []);
});

test('a known later wrapper option overrides queryFn, while an unknown spread abstains', () => {
  const files = config => ({
    'App.tsx': `import { usePaged } from './queries';
      function overrideQuery() { return requestOverride(); }
      function getConfig() { return window.config; }
      export function App() {
        const { fetchNextPage } = usePaged(${config});
        return <button onClick={() => fetchNextPage()}>Next</button>;
      }`,
    'queries.ts': `import { useInfiniteQuery } from '@tanstack/react-query';
      function defaultQuery() { return requestDefault(); }
      export function usePaged(config) {
        return useInfiniteQuery({ queryFn: defaultQuery, ...config });
      }`,
  });
  const known = compile(files('{ queryFn: overrideQuery }'));
  assert.equal(known.library_contracts.length, 1);
  assert.match(source(known, known.library_contracts[0].callback_id), /function overrideQuery/u);
  assert.equal(known.edges.some(edge => edge.relation === 'library_callback'
    && /defaultQuery/u.test(source(known, edge.to))), false);

  const unknown = compile(files('getConfig()'));
  assert.equal(unknown.library_contracts.length, 0);
  assert.equal(unknown.edges.some(edge => edge.relation === 'library_callback'), false);
  assert.ok(unknown.library_backlog.some(row => row.reason === 'contract_callback_ambiguous'));
});

test('TanStack wrappers preserve destructured shorthand options without crashing', () => {
  const map = compile({
    'App.tsx': `import { usePaged } from './queries';
      export function App() { const { fetchNextPage } = usePaged({ sortBy: 'name' });
        return <button type="button" onClick={() => fetchNextPage()}>Next</button>; }`,
    'queries.ts': `import { useInfiniteQuery } from '@tanstack/react-query';
      export function usePaged(params = {}, config) {
        const { sortBy } = params;
        return useInfiniteQuery({ queryKey: ['items', { sortBy }],
          queryFn: ({ pageParam }) => request(sortBy, pageParam), ...config });
      }`,
  });
  assert.equal(map.library_contracts.length, 1);
  assert.match(source(map, map.library_contracts[0].callback_id), /request\(sortBy, pageParam\)/u);
});

test('unverified versions, local lookalikes, and branching wrappers cannot borrow the contract', () => {
  const sourceFiles = {
    'App.tsx': `import { usePaged } from './queries';
      export function App() { const { fetchNextPage } = usePaged();
        return <button onClick={() => fetchNextPage()}>Next</button>; }`,
    'queries.ts': `import { useInfiniteQuery } from '@tanstack/react-query';
      const a = () => requestA(); const b = () => requestB();
      export function usePaged(flag) {
        if (flag) return useInfiniteQuery({ queryFn: a });
        return useInfiniteQuery({ queryFn: b });
      }`,
  };
  const branching = compile(sourceFiles);
  assert.equal(branching.library_contracts.length, 0);
  assert.equal(branching.edges.some(edge => edge.relation === 'library_callback'), false);

  const unverified = compile({
    'App.tsx': `import { useInfiniteQuery } from '@tanstack/react-query';
      export function App() { const { fetchNextPage } = useInfiniteQuery({ queryFn: () => request() });
        return <button onClick={() => fetchNextPage()}>Next</button>; }`,
  }, { '@tanstack/react-query': { ...PACKAGE['@tanstack/react-query'], verified: false,
    reason: 'installed_dependency_source_mismatch' } });
  assert.equal(unverified.library_contracts.length, 0);
  assert.ok(unverified.library_backlog.some(row => row.reason === 'installed_dependency_source_mismatch'));

  const local = compile({
    'App.tsx': `function useInfiniteQuery({ queryFn }) { return { fetchNextPage: queryFn }; }
      export function App() { const { fetchNextPage } = useInfiniteQuery({ queryFn: () => requestWrong() });
        return <button onClick={() => fetchNextPage()}>Next</button>; }`,
  });
  assert.equal(local.library_contracts.length, 0);
  assert.equal(local.edges.some(edge => edge.relation === 'library_callback'), false);

  const reassigned = compile({
    'App.tsx': `import { useInfiniteQuery } from '@tanstack/react-query';
      function local() { return requestWrong(); }
      export function App() { let { fetchNextPage } = useInfiniteQuery({ queryFn: () => requestRight() });
        fetchNextPage = local;
        return <button onClick={() => fetchNextPage()}>Next</button>; }`,
  });
  assert.equal(reassigned.library_contracts.length, 0);
  assert.equal(reassigned.edges.some(edge => edge.relation === 'library_callback'), false);

  const mutatingWrapper = compile({
    'App.tsx': `import { usePaged } from './queries';
      export function App() { const { fetchNextPage } = usePaged({});
        return <button onClick={() => fetchNextPage()}>Next</button>; }`,
    'queries.ts': `import { useInfiniteQuery } from '@tanstack/react-query';
      const a = () => requestA(); const b = () => requestB();
      export function usePaged(config) {
        const ignored = (config.queryFn = b);
        return useInfiniteQuery({ queryFn: a, ...config });
      }`,
  });
  assert.equal(mutatingWrapper.library_contracts.length, 0);
  assert.equal(mutatingWrapper.edges.some(edge => edge.relation === 'library_callback'), false);

  const mutatingDefault = compile({
    'App.tsx': `import { usePaged } from './queries';
      export function App() { const { fetchNextPage } = usePaged({});
        return <button onClick={() => fetchNextPage()}>Next</button>; }`,
    'queries.ts': `import { useInfiniteQuery } from '@tanstack/react-query';
      const a = () => requestA(); const b = () => requestB();
      export function usePaged(config, ignored = (config.queryFn = b)) {
        return useInfiniteQuery({ queryFn: a, ...config });
      }`,
  });
  assert.equal(mutatingDefault.library_contracts.length, 0);
  assert.equal(mutatingDefault.edges.some(edge => edge.relation === 'library_callback'), false);
});

test('repeated component placements keep separate contract applications', () => {
  const map = compile({
    'App.tsx': `import { useInfiniteQuery } from '@tanstack/react-query';
      function Pager({ id }) {
        const { fetchNextPage } = useInfiniteQuery({ queryKey: [id], queryFn: () => request(id) });
        return <button onClick={() => fetchNextPage()}>{id}</button>;
      }
      export function App() { return <><Pager id="a"/><Pager id="b"/></>; }`,
  });
  assert.equal(map.library_contracts.length, 2);
  assert.equal(new Set(map.library_contracts.map(row => row.scenario_id)).size, 2);
  assert.equal(new Set(map.library_contracts.map(row => row.placement_id)).size, 2);
  assert.equal(new Set(map.library_contracts.map(row => row.invocation_call_id)).size, 1);
  assert.equal(map.edges.filter(edge => edge.relation === 'library_callback').length, 2);
});

test('ambiguous first-party barrels do not select the first matching wrapper', () => {
  const map = compile({
    'App.tsx': `import { usePaged } from './barrel';
      export function App() { const { fetchNextPage } = usePaged();
        return <button onClick={() => fetchNextPage()}>Next</button>; }`,
    'barrel.ts': `export * from './a'; export * from './b';`,
    'a.ts': `import { useInfiniteQuery } from '@tanstack/react-query';
      export const usePaged = () => useInfiniteQuery({ queryFn: () => requestA() });`,
    'b.ts': `import { useInfiniteQuery } from '@tanstack/react-query';
      export const usePaged = () => useInfiniteQuery({ queryFn: () => requestB() });`,
  });
  assert.equal(map.library_contracts.length, 0);
  assert.equal(map.edges.some(edge => edge.relation === 'library_callback'), false);
});

test('package evidence participates in deterministic graph identity', () => {
  const files = {
    'App.tsx': `import { useInfiniteQuery } from '@tanstack/react-query';
      export function App() { const { fetchNextPage } = useInfiniteQuery({ queryFn: () => request() });
        return <button onClick={() => fetchNextPage()}>Next</button>; }`,
  };
  const accepted = compile(files);
  const rejected = compile(files, { '@tanstack/react-query': { ...PACKAGE['@tanstack/react-query'],
    version: '5.0.0', verified: false, reason: 'contract_version_unavailable' } });
  assert.notEqual(accepted.fingerprint, rejected.fingerprint);
  assert.equal(accepted.library_contracts.length, 1);
  assert.equal(rejected.library_contracts.length, 0);
});

test('the public snapshot API cannot fabricate trusted package evidence', () => {
  assert.throws(() => analyzeReact({
    files: { 'App.tsx': 'export const App = () => null;' },
    packages: PACKAGE,
  }), /packages is not a public input/u);
});

test('repository admission resolves the package from the importing file', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'producttrace-importer-package-'));
  try {
    fs.mkdirSync(path.join(root, 'client', 'src'), { recursive: true });
    fs.mkdirSync(path.join(root, 'client', 'node_modules', '@tanstack', 'react-query'), { recursive: true });
    fs.mkdirSync(path.join(root, 'node_modules', '@tanstack', 'react-query'), { recursive: true });
    fs.writeFileSync(path.join(root, 'client', 'src', 'App.tsx'), `
      import { useInfiniteQuery } from '@tanstack/react-query';
      export function App() { const { fetchNextPage } = useInfiniteQuery({ queryFn: () => request() });
        return <button onClick={() => fetchNextPage()}>Next</button>; }
    `);
    fs.writeFileSync(path.join(root, 'client', 'node_modules', '@tanstack', 'react-query', 'package.json'),
      JSON.stringify({ name: '@tanstack/react-query', version: '5.0.0' }));
    fs.writeFileSync(path.join(root, 'node_modules', '@tanstack', 'react-query', 'package.json'),
      JSON.stringify({ name: '@tanstack/react-query', version: '4.36.1' }));
    fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({ packages: {
      'client/node_modules/@tanstack/react-query': { version: '5.0.0', integrity: 'nested-v5' },
      'node_modules/@tanstack/react-query': { version: '4.36.1', integrity: PACKAGE['@tanstack/react-query'].integrity },
    } }));
    const map = analyzeReact({ repository: root, include: ['client/src/App.tsx'] });
    const evidence = map.resolution.packages.find(row => row.name === '@tanstack/react-query');
    assert.equal(evidence.install_path, 'client/node_modules/@tanstack/react-query');
    assert.equal(evidence.version, '5.0.0');
    assert.equal(evidence.verified, false);
    assert.equal(map.library_contracts.length, 0);
    assert.equal(map.edges.some(edge => edge.relation === 'library_callback'), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('different importer-resolved installations cannot borrow each other\'s verification', () => {
  const map = compileReactSources({
    'client/App.tsx': `import { useInfiniteQuery } from '@tanstack/react-query';
      export function App() { const { fetchNextPage } = useInfiniteQuery({ queryFn: () => requestClient() });
        return <button onClick={() => fetchNextPage()}>Client</button>; }`,
    'packages/ui/App.tsx': `import { useInfiniteQuery } from '@tanstack/react-query';
      export function App() { const { fetchNextPage } = useInfiniteQuery({ queryFn: () => requestUi() });
        return <button onClick={() => fetchNextPage()}>UI</button>; }`,
  }, { packages: { '@tanstack/react-query': {
    version: 'multiple', verified: false, reason: 'multiple_resolved_installations', installations: [
      { ...PACKAGE['@tanstack/react-query'], install_path: 'node_modules/@tanstack/react-query',
        importers: [{ importer: 'client/App.tsx', install_path: 'node_modules/@tanstack/react-query' }] },
      { version: '5.0.0', verified: false, reason: 'contract_version_unavailable',
        install_path: 'packages/ui/node_modules/@tanstack/react-query',
        importers: [{ importer: 'packages/ui/App.tsx', install_path: 'packages/ui/node_modules/@tanstack/react-query' }] },
    ],
  } } });
  assert.equal(map.library_contracts.length, 1);
  assert.match(source(map, map.library_contracts[0].callback_id), /requestClient/u);
  assert.ok(map.library_backlog.some(row => row.version === '5.0.0'));
  assert.equal(map.edges.some(edge => edge.relation === 'library_callback' && /requestUi/u.test(source(map, edge.to))), false);
});

test('Recoil callback factories redirect each control to only their returned callback', () => {
  const map = compileReactSources({
    'App.tsx': `import { useRecoilCallback } from 'recoil';
      export function App() {
        const toggleA = useRecoilCallback(({ set }) => (id) => writeA(set, id), []);
        const toggleB = useRecoilCallback(({ set }) => (id) => writeB(set, id), []);
        return <><button onClick={() => toggleA('a')}>A</button><button onClick={() => toggleB('b')}>B</button></>;
      }`,
  }, { packages: RECOIL_PACKAGE });
  const applications = map.library_contracts.filter(row => row.package === 'recoil');
  assert.equal(applications.length, 2);
  const a = applications.find(row => source(map, row.invocation_call_id) === "toggleA('a')");
  const b = applications.find(row => source(map, row.invocation_call_id) === "toggleB('b')");
  assert.match(source(map, a.callback_id), /writeA/u);
  assert.match(source(map, b.callback_id), /writeB/u);
  const aEdge = map.edges.find(edge => edge.relation === 'library_callback'
    && edge.from === a.invocation_call_id);
  assert.equal(aEdge.callback_arguments[0].kind, 'literal');
  assert.equal(aEdge.callback_arguments[0].value, 'a');
  assert.equal(map.edges.some(edge => edge.relation === 'library_callback'
    && edge.from === a.invocation_call_id && /writeB/u.test(source(map, edge.to))), false);
});

test('Recoil callback redirects abstain for unverified installs and reassigned handles', () => {
  const files = { 'App.tsx': `import { useRecoilCallback } from 'recoil';
    function wrong() { return requestWrong(); }
    export function App() { let run = useRecoilCallback(() => () => requestRight(), []); run = wrong;
      return <button onClick={run}>Run</button>; }` };
  const reassigned = compileReactSources(files, { packages: RECOIL_PACKAGE });
  assert.equal(reassigned.library_contracts.filter(row => row.package === 'recoil').length, 0);
  assert.equal(reassigned.edges.some(edge => edge.relation === 'library_callback'), false);

  const unverified = compileReactSources({ 'App.tsx': `import { useRecoilCallback } from 'recoil';
    export function App() { const run = useRecoilCallback(() => () => request(), []);
      return <button onClick={run}>Run</button>; }` }, { packages: { recoil: {
        ...RECOIL_PACKAGE.recoil, verified: false, reason: 'installed_dependency_source_mismatch' } } });
  assert.equal(unverified.library_contracts.filter(row => row.package === 'recoil').length, 0);
  assert.ok(unverified.library_backlog.some(row => row.reason === 'installed_dependency_source_mismatch'));
});

test('a transparent first-party hook preserves the Recoil callback and wrapper call', () => {
  const map = compileReactSources({
    'App.tsx': `import { useUpdate } from './store';
      export function App() { const update = useUpdate(); return <button onClick={() => update('conv-a')}>Update</button>; }`,
    'store.ts': `import { useRecoilCallback } from 'recoil';
      export function useUpdate() { const update = useRecoilCallback(({ set }) => id => save(set, id), []); return update; }`,
  }, { packages: RECOIL_PACKAGE });
  assert.equal(map.library_contracts.filter(row => row.package === 'recoil').length, 1);
  const application = map.library_contracts.find(row => row.package === 'recoil');
  assert.deepEqual(application.wrapper_call_ids.map(id => source(map, id)), ['useUpdate()']);
  assert.match(source(map, application.callback_id), /save/u);
});

test('React Hook Form submit handlers retain valid and invalid callbacks per form instance', () => {
  const map = compileReactSources({ 'App.tsx': `import { useForm } from 'react-hook-form';
    function FormA() { const { handleSubmit } = useForm(); const valid = data => saveA(data); const invalid = errors => failA(errors);
      return <form onSubmit={handleSubmit(valid, invalid)} />; }
    function FormB() { const { handleSubmit } = useForm(); const valid = data => saveB(data);
      return <form onSubmit={handleSubmit(valid)} />; }
    export function App() { return <><FormA/><FormB/></>; }` }, { packages: FORM_PACKAGE });
  const applications = map.library_contracts.filter(row => row.package === 'react-hook-form');
  assert.equal(applications.length, 3);
  const callbacks = applications.map(row => source(map, row.callback_id));
  assert.equal(callbacks.filter(text => /saveA/u.test(text)).length, 1);
  assert.equal(callbacks.filter(text => /failA/u.test(text)).length, 1);
  assert.equal(callbacks.filter(text => /saveB/u.test(text)).length, 1);
  const edges = map.edges.filter(edge => edge.relation === 'library_callback' && edge.package === 'react-hook-form');
  assert.equal(edges.length, 3);
  assert.equal(map.edges.some(edge => edge.relation === 'event_handler'
    && callbacks.some(text => text === source(map, edge.to))), false);
  assert.ok(edges.some(edge => edge.conditions.some(condition => condition.text.endsWith('.valid'))));
  assert.ok(edges.some(edge => edge.conditions.some(condition => condition.text.endsWith('.invalid'))));
  const invalid = edges.find(edge => edge.conditions.some(condition => condition.text.endsWith('.invalid')));
  assert.equal(invalid.callback_arguments[0].text, 'react-hook-form.handleSubmit.formErrors');
  assert.equal(applications.find(row => row.callback_id === invalid.to).contract_branch, 'invalid');
  assert.deepEqual(applications.find(row => row.callback_id === invalid.to).callback_arguments,
    invalid.callback_arguments);
  const formBScenario = applications.find(row => /saveB/u.test(source(map, row.callback_id))).scenario_id;
  assert.equal(applications.some(row => row.scenario_id === formBScenario && /failA/u.test(source(map, row.callback_id))), false);
});

test('React Hook Form does not admit an unverified submit redirect', () => {
  const map = compileReactSources({ 'App.tsx': `import { useForm } from 'react-hook-form';
    export function App() { const { handleSubmit } = useForm(); return <form onSubmit={handleSubmit(data => save(data))}/>; }` },
  { packages: { 'react-hook-form': { ...FORM_PACKAGE['react-hook-form'], verified: false,
    reason: 'installed_dependency_source_mismatch' } } });
  assert.equal(map.library_contracts.filter(row => row.package === 'react-hook-form').length, 0);
  assert.equal(map.edges.some(edge => edge.relation === 'library_callback' && edge.package === 'react-hook-form'), false);
});

test('React Router navigate calls retain exact destinations and control scenarios', () => {
  const map = compileReactSources({ 'App.tsx': `import { useNavigate } from 'react-router-dom';
    function Agents() { const navigate = useNavigate(); return <button onClick={() => navigate('/agents')}>Agents</button>; }
    function Back() { const navigate = useNavigate(); return <button onClick={() => navigate(-1)}>Back</button>; }
    export function App() { return <><Agents/><Back/></>; }` }, { packages: ROUTER_PACKAGE });
  const applications = map.library_contracts.filter(row => row.package === 'react-router-dom');
  assert.equal(applications.length, 2);
  const byCall = new Map(applications.map(row => [source(map, row.invocation_call_id), row]));
  assert.equal(byCall.get("navigate('/agents')").effect.target.value, '/agents');
  assert.equal(byCall.get('navigate(-1)').effect.target.value, -1);
  assert.notEqual(byCall.get("navigate('/agents')").scenario_id, byCall.get('navigate(-1)').scenario_id);
  assert.equal(map.edges.filter(edge => edge.relation === 'library_effect' && edge.package === 'react-router-dom').length, 2);
});

test('React Router lookalikes and unverified installs do not create navigation effects', () => {
  const local = compileReactSources({ 'App.tsx': `function useNavigate(){ return value => request(value); }
    export function App(){ const navigate=useNavigate(); return <button onClick={()=>navigate('/wrong')}>Wrong</button>; }` },
  { packages: ROUTER_PACKAGE });
  assert.equal(local.edges.some(edge => edge.relation === 'library_effect'), false);
  const unverified = compileReactSources({ 'App.tsx': `import { useNavigate } from 'react-router-dom';
    export function App(){ const navigate=useNavigate(); return <button onClick={()=>navigate('/wrong')}>Wrong</button>; }` },
  { packages: { 'react-router-dom': { ...ROUTER_PACKAGE['react-router-dom'], verified: false,
    reason: 'installed_dependency_source_mismatch' } } });
  assert.equal(unverified.edges.some(edge => edge.relation === 'library_effect'), false);
  assert.ok(unverified.library_backlog.some(row => row.reason === 'installed_dependency_source_mismatch'));
});

test('Ariakit component events retain the exact component placement and callback prop', () => {
  const map = compileReactSources({ 'App.tsx': `import * as Ariakit from '@ariakit/react';
    function MenuA() { const open = event => openA(event); return <Ariakit.MenuButton onClick={open}>A</Ariakit.MenuButton>; }
    function MenuB() { return <Ariakit.MenuItem onClick={() => pickB('b')}>B</Ariakit.MenuItem>; }
    function Toggle() { return <Ariakit.MenuItemCheckbox onChange={event => toggle(event, 'server-a')}>T</Ariakit.MenuItemCheckbox>; }
    export function App() { return <><MenuA/><MenuB/><Toggle/></>; }` }, { packages: ARIAKIT_PACKAGE });
  const applications = map.library_contracts.filter(row => row.package === '@ariakit/react');
  assert.equal(applications.length, 3);
  assert.equal(new Set(applications.map(row => row.scenario_id)).size, 3);
  assert.equal(new Set(applications.map(row => row.placement_id)).size, 3);
  assert.equal(map.controls.filter(control => control.tag.startsWith('@ariakit/react.')).length, 3);
  assert.equal(map.edges.filter(edge => edge.relation === 'library_callback'
    && edge.package === '@ariakit/react').length, 3);
  assert.equal(map.edges.some(edge => edge.relation === 'event_handler'
    && applications.some(row => row.callback_id === edge.to)), false);
  assert.ok(applications.some(row => /openA/u.test(source(map, row.callback_id))));
  assert.ok(applications.some(row => /pickB/u.test(source(map, row.callback_id))));
  assert.ok(applications.some(row => /toggle/u.test(source(map, row.callback_id))));
  assert.deepEqual(map.library_backlog, []);
});

test('Ariakit callbacks are not borrowed by local lookalikes or unverified installations', () => {
  const local = compileReactSources({ 'App.tsx': `const Ariakit = { MenuItem: ({ children }) => children };
    export function App() { return <Ariakit.MenuItem onClick={() => wrong()}>Wrong</Ariakit.MenuItem>; }` },
  { packages: ARIAKIT_PACKAGE });
  assert.equal(local.edges.some(edge => edge.package === '@ariakit/react'), false);

  const unverified = compileReactSources({ 'App.tsx': `import { MenuItem } from '@ariakit/react';
    export function App() { return <MenuItem onClick={() => wrong()}><button onClick={() => nestedWrong()}>Nested</button></MenuItem>; }` },
  { packages: { '@ariakit/react': { ...ARIAKIT_PACKAGE['@ariakit/react'], version: '0.4.37', verified: false,
    reason: 'lockfile_install_version_mismatch' } } });
  assert.equal(unverified.edges.some(edge => edge.package === '@ariakit/react'), false);
  assert.equal(unverified.library_contracts.some(row => row.package === '@ariakit/react'), false);
  assert.equal(unverified.controls.some(row => source(unverified, row.source_node_id).includes('Nested')), false);
});

test('an unresolved importer does not erase a separately resolved installation', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'producttrace-partial-package-resolution-'));
  try {
    fs.mkdirSync(path.join(root, 'client', 'node_modules', '@tanstack', 'react-query'), { recursive: true });
    fs.mkdirSync(path.join(root, 'packages', 'ui'), { recursive: true });
    fs.writeFileSync(path.join(root, 'client', 'App.tsx'), `import { useInfiniteQuery } from '@tanstack/react-query';
      export function App(){ const { fetchNextPage }=useInfiniteQuery({queryFn:()=>null}); return <button onClick={fetchNextPage}>A</button>; }`);
    fs.writeFileSync(path.join(root, 'packages', 'ui', 'App.tsx'), `import { useInfiniteQuery } from '@tanstack/react-query';
      export function App(){ const { fetchNextPage }=useInfiniteQuery({queryFn:()=>null}); return <button onClick={fetchNextPage}>B</button>; }`);
    fs.writeFileSync(path.join(root, 'client', 'node_modules', '@tanstack', 'react-query', 'package.json'),
      JSON.stringify({ name: '@tanstack/react-query', version: '4.36.1' }));
    fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({ packages: {
      'client/node_modules/@tanstack/react-query': { version: '4.36.1', integrity: PACKAGE['@tanstack/react-query'].integrity },
    } }));
    const map = analyzeReact({ repository: root, include: ['client/App.tsx', 'packages/ui/App.tsx'] });
    const evidence = map.resolution.packages.find(row => row.name === '@tanstack/react-query');
    assert.equal(evidence.reason, 'one_or_more_importers_unresolved');
    assert.equal(evidence.installations.length, 1);
    assert.deepEqual(evidence.installations[0].importers.map(row => row.importer), ['client/App.tsx']);
    assert.deepEqual(evidence.unresolved_importers.map(row => row.importer), ['packages/ui/App.tsx']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('TanStack flexRender mounts the exact renderer with its exact props', () => {
  const map = compileReactSources({ 'App.tsx': `import { flexRender } from '@tanstack/react-table';
    function Cell({ id }) { return <button onClick={() => openRow(id)}>Open {id}</button>; }
    function Other() { return <button onClick={() => wrong()}>Wrong</button>; }
    export function App() { return <section>{flexRender(Cell, { id: 'row-a' })}</section>; }` },
  { packages: TABLE_PACKAGE });
  const applications = map.library_contracts.filter(row => row.package === '@tanstack/react-table');
  assert.equal(applications.length, 1);
  assert.match(source(map, applications[0].callback_id), /function Cell/u);
  assert.equal(map.edges.filter(edge => edge.relation === 'library_render').length, 1);
  const control = map.controls.find(row => row.tag === 'button'
    && map.placements.find(placement => placement.id === row.placement_id)?.parent_id);
  assert.ok(control);
  const placement = map.placements.find(row => row.id === control.placement_id);
  assert.equal(placement.props.id.value, 'row-a');
  assert.equal(map.edges.some(edge => edge.relation === 'library_render'
    && /function Other/u.test(source(map, edge.to))), false);
});

test('TanStack flexRender preserves an exact surrounding React context', () => {
  const map = compileReactSources({ 'App.tsx': `
    import { createContext, useContext } from 'react';
    import { flexRender } from '@tanstack/react-table';
    const Mode = createContext('default');
    function openMode(value) {}
    function Cell() { const mode=useContext(Mode); return <button onClick={() => openMode(mode)}>Open</button>; }
    export function App() { return <Mode.Provider value="nested">{flexRender(Cell, {})}</Mode.Provider>; }` },
  { packages: { ...TABLE_PACKAGE, react: {
    version: '18.3.1', verified: true, verification_sha256: 'react-fixture-verification',
  } } });
  const calls = map.edges.filter(edge => edge.relation === 'call'
    && /openMode/u.test(source(map, edge.to)));
  assert.ok(calls.some(call => call.arguments[0]?.value === 'nested'));
});

test('TanStack flexRender keeps dynamic renderers and unverified installs unresolved', () => {
  const dynamic = compileReactSources({ 'App.tsx': `import { flexRender } from '@tanstack/react-table';
    export function App({ cell }) { return <section>{flexRender(cell.column.columnDef.cell, cell.getContext())}</section>; }` },
  { packages: TABLE_PACKAGE });
  assert.equal(dynamic.edges.some(edge => edge.relation === 'library_render'), false);
  assert.ok(dynamic.library_backlog.some(row => row.reason === 'contract_render_argument_ambiguous'));

  const unverified = compileReactSources({ 'App.tsx': `import { flexRender } from '@tanstack/react-table';
    function Cell(){ return <button onClick={() => wrong()}>Wrong</button> }
    export function App() { return <>{flexRender(Cell, {})}</>; }` },
  { packages: { '@tanstack/react-table': { ...TABLE_PACKAGE['@tanstack/react-table'], verified: false,
    reason: 'installed_dependency_source_mismatch' } } });
  assert.equal(unverified.edges.some(edge => edge.relation === 'library_render'), false);
  assert.ok(unverified.library_backlog.some(row => row.reason === 'installed_dependency_source_mismatch'));
});

test('Axios request effects retain method, URL, body, wrapper call, and scenario', () => {
  const map = compileReactSources({
    'App.tsx': `import request from './request';
      export function App() { return <button onClick={() => request.post('/api/items/a', { title: 'A' })}>Save</button>; }`,
    'request.ts': `import axios from 'axios';
      async function post(url, body) { return await axios.post(url, body, { headers: { 'x-test': 'a' } }); }
      export default { post };`,
  }, { packages: AXIOS_PACKAGE });
  const application = map.library_contracts.find(row => row.package === 'axios');
  assert.ok(application);
  assert.equal(application.effect.kind, 'http_request');
  assert.equal(application.effect.method, 'POST');
  assert.equal(application.effect.url_input.value, '/api/items/a');
  assert.equal(application.effect.body.properties.title.value, 'A');
  assert.equal(application.scenario_id, map.scenarios[0].id);
  assert.equal(map.edges.filter(edge => edge.relation === 'library_effect' && edge.package === 'axios').length, 1);
});

test('workspace namespace barrels carry one control through request wrappers to Axios', () => {
  const map = compileReactSources({
    'App.tsx': `import { dataService } from 'workspace-data';
      export function App({ enabled }) {
        return <><button onClick={() => { if (enabled) dataService.listProjects({ cursor: 'next-a' }); }}>Load A</button>
          <button onClick={() => dataService.deleteProject('project-b')}>Delete B</button></>;
      }`,
    'packages/data/index.ts': `export { dataService }; import * as dataService from './data-service';`,
    'packages/data/data-service.ts': `import request from './request';
      export function listProjects(params) { return request.get('/api/projects', { params }); }
      export function deleteProject(id) { return request.delete('/api/projects/' + id); }`,
    'packages/data/request.ts': `import axios from 'axios';
      async function get(url, options) { const response = await axios.get(url, options); return response.data; }
      async function remove(url) { return await axios.delete(url); }
      export default { get, delete: remove };`,
  }, {
    moduleAliases: { 'workspace-data': { file: 'packages/data/index.ts' } },
    packages: AXIOS_PACKAGE,
  });

  const requests = map.library_contracts.filter(row => row.effect?.kind === 'http_request');
  assert.equal(requests.length, 2);
  const get = requests.find(row => row.effect.method === 'GET');
  const remove = requests.find(row => row.effect.method === 'DELETE');
  assert.equal(get.effect.url_input.value, '/api/projects');
  assert.equal(get.effect.options.properties.params.properties.cursor.value, 'next-a');
  assert.match(source(map, remove.effect.url_input.node_id), /'\/api\/projects\/' \+ id/u);
  assert.notEqual(get.scenario_id, remove.scenario_id);
  assert.equal(get.placement_id, map.scenarios.find(row => row.id === get.scenario_id).placement_id);
  assert.equal(remove.placement_id, map.scenarios.find(row => row.id === remove.scenario_id).placement_id);

  const getEdge = map.edges.find(edge => edge.relation === 'library_effect'
    && edge.scenario_id === get.scenario_id && edge.effect?.method === 'GET');
  assert.deepEqual(getEdge.conditions.map(condition => [condition.text, condition.branch]), [['enabled', 'truthy']]);
  const serviceCall = map.edges.find(edge => edge.relation === 'call' && edge.scenario_id === get.scenario_id
    && source(map, edge.from).startsWith('dataService.listProjects('));
  const requestCall = map.edges.find(edge => edge.relation === 'call' && edge.scenario_id === get.scenario_id
    && source(map, edge.from).startsWith('request.get('));
  assert.equal(serviceCall.arguments[0].properties.cursor.value, 'next-a');
  assert.equal(requestCall.arguments[1].properties.params.properties.cursor.value, 'next-a');
  assert.deepEqual(requestCall.conditions, getEdge.conditions);
  assert.equal(map.edges.some(edge => edge.relation === 'library_effect'
    && edge.scenario_id === get.scenario_id && edge.effect?.method === 'DELETE'), false);
  assert.equal(map.edges.some(edge => edge.relation === 'library_effect'
    && edge.scenario_id === remove.scenario_id && edge.effect?.method === 'GET'), false);
});

test('workspace object traversal abstains at ambiguous, reassigned, effectful, and missing exports', () => {
  const ambiguous = compileReactSources({
    'App.tsx': `import { dataService } from 'workspace-data';
      export function App() { return <button onClick={() => dataService.listProjects()}>Load</button>; }`,
    'packages/data/index.ts': `export * as dataService from './barrel';`,
    'packages/data/barrel.ts': `export * from './a'; export * from './b';`,
    'packages/data/a.ts': `import axios from 'axios'; export function listProjects() { return axios.get('/a'); }`,
    'packages/data/b.ts': `import axios from 'axios'; export function listProjects() { return axios.get('/b'); }`,
  }, { moduleAliases: { 'workspace-data': { file: 'packages/data/index.ts' } }, packages: AXIOS_PACKAGE });
  assert.equal(ambiguous.library_contracts.some(row => row.package === 'axios'), false);

  const reassigned = compileReactSources({
    'App.tsx': `import { dataService } from 'workspace-data'; dataService.listProjects = wrong;
      export function App() { return <button onClick={() => dataService.listProjects()}>Load</button>; }`,
    'packages/data/index.ts': `export * as dataService from './service';`,
    'packages/data/service.ts': `import axios from 'axios'; export function listProjects() { return axios.get('/right'); }`,
  }, { moduleAliases: { 'workspace-data': { file: 'packages/data/index.ts' } }, packages: AXIOS_PACKAGE });
  assert.equal(reassigned.library_contracts.some(row => row.package === 'axios'), false);

  const effectful = compileReactSources({
    'App.tsx': `import request from './request';
      export function App() { return <button onClick={() => request.get('/unsafe')}>Load</button>; }`,
    'request.ts': `import axios from 'axios'; function build() { recordConstruction(); return { get: axios.get }; }
      export default build();`,
  }, { packages: AXIOS_PACKAGE });
  assert.equal(effectful.library_contracts.some(row => row.package === 'axios'), false);

  const missing = compileReactSources({
    'App.tsx': `import { dataService } from './index';
      export function App() { return <button onClick={() => dataService.listProjects()}>Load</button>; }`,
    'index.ts': `export * from './known'; export * from './missing';`,
    'known.ts': `export * as dataService from './service';`,
    'service.ts': `import axios from 'axios'; export function listProjects() { return axios.get('/unproven'); }`,
  }, { packages: AXIOS_PACKAGE });
  assert.equal(missing.library_contracts.some(row => row.package === 'axios'), false);
  assert.ok(missing.diagnostics.some(row => row.code === 'dynamic_callback'));
});

test('Axios method identity is exact and unverified installs do not produce request effects', () => {
  const methods = compileReactSources({ 'App.tsx': `import axios from 'axios';
    export function App(){ return <><button onClick={() => axios.get('/a')}>A</button>
      <button onClick={() => axios.delete('/b')}>B</button></>; }` }, { packages: AXIOS_PACKAGE });
  assert.deepEqual(methods.library_contracts.filter(row => row.package === 'axios')
    .map(row => [row.effect.method, row.effect.url_input.value]).sort(), [['DELETE', '/b'], ['GET', '/a']]);

  const local = compileReactSources({ 'App.tsx': `const axios = { post: () => wrong() };
    export function App(){ return <button onClick={() => axios.post('/wrong')}>Wrong</button>; }` },
  { packages: AXIOS_PACKAGE });
  assert.equal(local.edges.some(edge => edge.package === 'axios'), false);

  const unverified = compileReactSources({ 'App.tsx': `import axios from 'axios';
    export function App(){ return <button onClick={() => axios.post('/wrong')}>Wrong</button>; }` },
  { packages: { axios: { ...AXIOS_PACKAGE.axios, verified: false,
    reason: 'installed_dependency_source_mismatch' } } });
  assert.equal(unverified.edges.some(edge => edge.package === 'axios'), false);
  assert.ok(unverified.library_backlog.some(row => row.reason === 'installed_dependency_source_mismatch'));
});
