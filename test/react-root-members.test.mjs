import test from 'node:test';
import assert from 'node:assert/strict';
import { compileReactSources } from '../analysis/react-compiler.mjs';

const packages = {react:{version:'18.3.1',verified:true,verification_sha256:'react'},
  'react-dom':{version:'18.3.1',verified:true,verification_sha256:'react-dom'}};

test('returned concurrent-root members retain their exact producer and remain source predictions', () => {
  const map = compileReactSources({'main.tsx': `
    import {createRoot} from 'react-dom/client';
    const root=createRoot(container,{onRecoverableError:report});
    root.render(tree); root.unmount();
  `}, {packages});
  const semantic = map.react_semantics.find(row => row.export === 'createRoot');
  assert.equal(semantic.disposition, 'modeled');
  assert.deepEqual(map.react_protocols.map(row => row.member).sort(), ['render','unmount']);
  assert.ok(map.react_protocols.every(row => row.producer_call_id === semantic.call_id
    && row.semantic_application_id === semantic.id && row.claim === 'source_contract'
    && row.runtime_observed === false));
});

test('root members from different producers and unsupported dynamic aliases do not contaminate', () => {
  const map = compileReactSources({'main.tsx': `
    import {createRoot} from 'react-dom/client';
    const a=createRoot(one), b=createRoot(two); a.render(first); b.render(second);
    const selected=flag?a:b; selected.unmount();
  `}, {packages});
  const renders = map.react_protocols.filter(row => row.member === 'render');
  assert.equal(renders.length, 2);
  assert.equal(new Set(renders.map(row => row.producer_call_id)).size, 2);
  assert.equal(map.react_protocols.some(row => row.member === 'unmount'), false);
  assert.equal(map.diagnostics.some(row=>row.code==='react_root_receiver_ambiguous'),true);
});

test('immutable API and handle aliases plus literal member access retain the exact root producer',()=>{
  const map=compileReactSources({'main.tsx':`
    import * as DOM from 'react-dom/client';
    const makeRoot=DOM.createRoot;const root=makeRoot(container);const active=root;
    active['render'](tree);active['unmount']();
  `},{packages});
  assert.deepEqual(map.react_protocols.map(row=>row.member).sort(),['render','unmount']);
  assert.equal(new Set(map.react_protocols.map(row=>row.producer_call_id)).size,1);
  assert.equal(map.diagnostics.length,0);
});
