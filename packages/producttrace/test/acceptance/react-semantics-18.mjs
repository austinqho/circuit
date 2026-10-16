import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { analyzeReact, REACT_API_INVENTORY } from '../../analysis/index.mjs';

const repository = path.resolve(process.argv[2] || '/tmp/producttrace-librechat-autonomous');
const git = args => execFileSync('git', args, { cwd: repository, encoding: 'utf8' }).trim();
assert.equal(git(['rev-parse', 'HEAD']), '45cc53c40b47645b887c3bb996168e06aaa83f4c');
assert.equal(git(['status', '--porcelain', '--untracked-files=no']), '');

const require = createRequire(path.join(repository, 'package.json'));
const React = require('react');
const ReactDOM = require('react-dom');
const ReactDOMClient = require('react-dom/client');
const ReactDOMServerNode = require('react-dom/server');
const ReactDOMServerBrowser = require('react-dom/server.browser');
assert.equal(React.version, '18.3.1');
assert.equal(require('react-dom/package.json').version, '18.3.1');

const nonPublic = new Set(['__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED']);
const publicKeys = module => Object.keys(module).filter(key => !nonPublic.has(key)).sort();
const inventoryKeys = surface => REACT_API_INVENTORY.filter(row => row.surface === surface)
  .map(row => row.export).sort();
assert.deepEqual(publicKeys(React), inventoryKeys('react'));
assert.deepEqual(publicKeys(ReactDOM), inventoryKeys('react-dom'));
assert.deepEqual(publicKeys(ReactDOMClient), inventoryKeys('react-dom/client'));
assert.deepEqual(publicKeys(ReactDOMServerNode), inventoryKeys('react-dom/server')
  .filter(name => name !== 'renderToReadableStream'));
assert.deepEqual(publicKeys(ReactDOMServerBrowser), inventoryKeys('react-dom/server')
  .filter(name => name !== 'renderToPipeableStream'));

const started = performance.now();
const map = analyzeReact({ repository });
const reactEvidence = map.resolution.packages.find(row => row.name === 'react');
const reactDomEvidence = map.resolution.packages.find(row => row.name === 'react-dom');
assert.equal(reactEvidence.version, '18.3.1');
assert.equal(reactEvidence.verified, true);
assert.equal(reactEvidence.react_semantics_verification.verified, true);
assert.equal(reactEvidence.source_attestations.length, 6);
assert.equal(reactDomEvidence.version, '18.3.1');
assert.equal(reactDomEvidence.verified, true);
assert.equal(reactDomEvidence.react_semantics_verification.verified, true);
// The DOM package has one independently attested entrypoint for each accepted
// browser/server surface. Concurrent root support added the client production
// entrypoint, so keep this count aligned with the actual attestation set.
assert.equal(reactDomEvidence.source_attestations.length, 18);
assert.ok(map.react_semantics.some(row => row.export === 'useCallback'));

const tamperFixture = fs.mkdtempSync(path.join(os.tmpdir(), 'producttrace-react-attestation-'));
try {
  fs.mkdirSync(path.join(tamperFixture, 'src'), { recursive: true });
  fs.mkdirSync(path.join(tamperFixture, 'node_modules'), { recursive: true });
  fs.cpSync(path.dirname(require.resolve('react/package.json')),
    path.join(tamperFixture, 'node_modules/react'), { recursive: true });
  fs.writeFileSync(path.join(tamperFixture, 'src/App.tsx'), `import { useCallback } from 'react';
    export function App() { const run = useCallback(() => work(), []);
      return <button onClick={run}>Run</button>; }`);
  fs.writeFileSync(path.join(tamperFixture, 'package-lock.json'), JSON.stringify({
    lockfileVersion: 3,
    packages: {
      '': {},
      'node_modules/react': {
        version: '18.3.1',
        integrity: 'sha512-wS+hAgJShR0KhEvPJArfuPVN1+Hz1t0Y6n5jLrGQbkb4urgPE/0Rve+1kMB1v/oWgHgm4WIcV+i7F2pTVj+2iQ==',
      },
    },
  }));
  const admitted = analyzeReact({ repository: tamperFixture });
  assert.equal(admitted.react_semantics.filter(row => row.export === 'useCallback').length, 1);
  fs.appendFileSync(path.join(tamperFixture, 'node_modules/react/cjs/react.development.js'), '\n// altered fixture\n');
  const rejected = analyzeReact({ repository: tamperFixture });
  assert.equal(rejected.react_semantics.filter(row => row.export === 'useCallback').length, 0);
  assert.ok(rejected.react_backlog.some(row => row.export === 'useCallback'
    && row.reason === 'installed_dependency_source_mismatch'));
} finally {
  fs.rmSync(tamperFixture, { recursive: true, force: true });
}

const { JSDOM } = require('jsdom');
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const root = ReactDOMClient.createRoot(document.getElementById('root'));
const lifecycle = [];
let latest;
function Example({ value, dependency }) {
  latest = React.useCallback(() => lifecycle.push(`callback:${value}`), [dependency]);
  React.useEffect(() => {
    lifecycle.push(`setup:${value}`);
    return () => lifecycle.push(`cleanup:${value}`);
  }, [dependency]);
  return React.createElement('button', { onClick: latest }, 'Run');
}
try {
  await React.act(async () => root.render(React.createElement(Example, { value: 'first', dependency: 0 })));
  const first = latest;
  await React.act(async () => root.render(React.createElement(Example, { value: 'second', dependency: 0 })));
  assert.equal(latest, first);
  document.querySelector('button').click();
  assert.deepEqual(lifecycle, ['setup:first', 'callback:first']);
  await React.act(async () => root.render(React.createElement(Example, { value: 'third', dependency: 1 })));
  assert.notEqual(latest, first);
  document.querySelector('button').click();
  assert.deepEqual(lifecycle, ['setup:first', 'callback:first', 'cleanup:first', 'setup:third', 'callback:third']);
} finally {
  await React.act(async () => root.unmount());
  dom.window.close();
}
assert.deepEqual(lifecycle, ['setup:first', 'callback:first', 'cleanup:first', 'setup:third',
  'callback:third', 'cleanup:third']);
assert.equal(git(['status', '--porcelain', '--untracked-files=no']), '');

console.log(JSON.stringify({
  react: React.version,
  inventory_entries: REACT_API_INVENTORY.length,
  inventory_surfaces: [...new Set(REACT_API_INVENTORY.map(row => row.surface))],
  verified_source_files: reactEvidence.source_attestations.length + reactDomEvidence.source_attestations.length,
  analyzed_controls: map.controls.length,
  admitted_use_callback_occurrences: map.react_semantics.filter(row => row.export === 'useCallback').length,
  rerender_retained_callback: true,
  dependency_change_replaced_callback: true,
  stale_closure_observed: true,
  dependency_cleanup_before_setup: true,
  unmount_cleanup_observed: true,
  tampered_source_rejected: true,
  elapsed_ms: Math.round(performance.now() - started),
  limitation: 'Static source identity and exact package provenance only; lifecycle execution remains runtime evidence and unsupported APIs remain frontiers.',
}, null, 2));
