import test from 'node:test';
import assert from 'node:assert/strict';
import { compileReactSources } from '../analysis/react-compiler.mjs';

const REACT_18 = {
  react: {
    version: '18.3.1', source: 'fixture', verified: true,
    verification_sha256: 'react-18.3.1-fixture',
  },
};

const compile = source => compileReactSources({ 'App.tsx': source }, { packages: REACT_18 });
const calls = map => map.edges.filter(edge => edge.relation === 'call')
  .map(edge => map.nodes.find(node => node.id === edge.to)?.text || '');

test('inline useCallback preserves source occurrence but not current render captures', () => {
  const map = compile(`import React, { useCallback as memo } from 'react';
    function send(value) {} function fallback() {}
    function Button({ value, onSend }) {
      const first = memo(() => send(value), []);
      const second = React.useCallback(() => onSend(), [onSend]);
      return <><button onClick={first}>First</button><button onClick={second}>Second</button></>;
    }
    export function App() { return <Button value="current" onSend={fallback}/>; }`);
  assert.equal(map.controls.length, 2);
  assert.ok(map.controls.every(control => control.status === 'resolved'));
  assert.equal(map.react_semantics.length, 2);
  assert.equal(new Set(map.react_semantics.map(row => row.call_id)).size, 2);
  assert.equal(new Set(map.edges.filter(edge => edge.relation === 'event_handler')
    .map(edge => edge.producer_call_id)).size, 2);
  const send = map.edges.find(edge => edge.relation === 'call'
    && map.nodes.find(node => node.id === edge.to)?.text.includes('function send'));
  assert.ok(send);
  assert.equal(send.arguments[0].kind, 'source');
  assert.equal(send.arguments[0].value, undefined);
  assert.ok(!JSON.stringify(send.arguments[0]).includes('current'));
  assert.ok(!calls(map).some(text => text.includes('function fallback')));
  assert.ok(map.diagnostics.some(row => row.code === 'memoized_callback_capture_unresolved'));
});

test('one immutable non-inline callback resolves while choices and unattested lookalikes remain frontiers', () => {
  const named = compile(`import { useCallback } from 'react'; function run() { work(); }
    export function App() { const retained = useCallback(run, []); return <button onClick={retained}/>; }`);
  assert.equal(named.controls[0].status, 'resolved');
  assert.ok(named.edges.some(edge => edge.relation === 'event_handler'
    && named.nodes.find(node => node.id === edge.to)?.text.includes('function run')));
  assert.ok(named.diagnostics.some(row => row.code === 'memoized_callback_capture_unresolved'));

  const source = `import { useCallback } from 'react'; function a() {} function b() {}
    export function App({ flag }) { const run = useCallback(flag ? a : b, []);
      return <button onClick={run}/>; }`;
  const nonInline = compile(source);
  assert.equal(nonInline.controls[0].status, 'unresolved');
  assert.ok(nonInline.react_backlog.some(row => row.reason === 'memoized_callback_identity_unresolved'));

  for (const packages of [{}, { react: { ...REACT_18.react, version: '19.0.0' } },
    { react: { ...REACT_18.react, verified: false, reason: 'installed_dependency_source_mismatch' } }]) {
    const map = compileReactSources({ 'App.tsx': `import { useCallback } from 'react';
      export function App() { const run=useCallback(()=>work(), []); return <button onClick={run}/>; }` },
    { packages });
    assert.equal(map.controls[0].status, 'unresolved');
    assert.equal(map.react_semantics.length, 0);
    assert.ok(map.react_backlog.length > 0);
  }

  const lookalike = compileReactSources({
    'fake.ts': 'export function useCallback(fn) { return () => {}; }',
    'App.tsx': `import { useCallback } from 'react'; export function App() {
      const run=useCallback(()=>work(), []); return <button onClick={run}/>; }`,
  }, { moduleAliases: { react: 'fake.ts' }, packages: REACT_18 });
  assert.equal(lookalike.controls[0].status, 'unresolved');
  assert.ok(lookalike.react_backlog.some(row => row.reason === 'workspace_module_named_like_react'));
});

test('unresolved execution remains explicit, including the DevTools formatter', () => {
  const map = compile(`import { useDebugValue, useEffect } from 'react';
    export function App() { useDebugValue('App'); useEffect(() => subscribe(), []);
      return <button onClick={() => work()}/>; }`);
  assert.ok(map.react_semantics.some(row => row.export === 'useDebugValue'
    && row.behavior.callbacks[0].phase === 'DevTools inspection'));
  assert.ok(map.react_semantics.some(row => row.export === 'useEffect' && row.disposition === 'unsupported'));
  assert.ok(map.react_backlog.some(row => row.export === 'useEffect'
    && row.reason === 'react_api_explicitly_unsupported'));
  assert.ok(map.diagnostics.some(row => row.code === 'unsupported_hook'));
  assert.ok(map.react_backlog.some(row => row.export === 'useDebugValue'));
});
