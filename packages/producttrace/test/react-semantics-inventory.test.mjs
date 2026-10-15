import test from 'node:test';
import assert from 'node:assert/strict';
import { REACT_API_INVENTORY, REACT_PACKAGE_ATTESTATIONS, getReactApiRecord } from '../analysis/react-semantics.mjs';

test('the React 18.3.1 inventory is complete, versioned, and has explicit dispositions', () => {
  const expected = {
    react: ['Children', 'Component', 'Fragment', 'Profiler', 'PureComponent', 'StrictMode', 'Suspense',
      'act', 'cloneElement', 'createContext', 'createElement', 'createFactory', 'createRef', 'forwardRef',
      'isValidElement', 'lazy', 'memo', 'startTransition', 'useCallback', 'useContext', 'useDebugValue',
      'useDeferredValue', 'useEffect', 'useId', 'useImperativeHandle', 'useInsertionEffect',
      'useLayoutEffect', 'useMemo', 'useReducer', 'useRef', 'useState', 'useSyncExternalStore',
      'useTransition', 'version', 'unstable_act'],
    'react-dom': ['createPortal', 'createRoot', 'findDOMNode', 'flushSync', 'hydrate', 'hydrateRoot',
      'render', 'unmountComponentAtNode', 'version', 'unstable_batchedUpdates', 'unstable_renderSubtreeIntoContainer'],
    'react-dom/client': ['createRoot', 'hydrateRoot'],
    'react-dom/server': ['renderToNodeStream', 'renderToPipeableStream', 'renderToReadableStream',
      'renderToStaticMarkup', 'renderToStaticNodeStream', 'renderToString', 'version'],
  };
  for (const [surface, exports] of Object.entries(expected)) {
    assert.deepEqual(REACT_API_INVENTORY.filter(row => row.surface === surface)
      .map(row => row.export).sort(), exports.sort());
  }
  assert.ok(REACT_API_INVENTORY.every(row => row.versions.length === 1 && row.versions[0] === '18.3.1'));
  assert.deepEqual([...new Set(REACT_API_INVENTORY.map(row => row.disposition))].sort(),
    ['modeled', 'no_relevant_tracing_effect', 'unsupported']);
  assert.equal(getReactApiRecord({ surface: 'react', exportName: 'useCallback', version: '18.3.1' })?.semantic_kind,
    'retained_callback');
  assert.equal(getReactApiRecord({ surface: 'react', exportName: 'useCallback', version: '19.0.0' }), null);
  assert.throws(() => { REACT_API_INVENTORY[0].versions.push('19.0.0'); }, TypeError);
  assert.throws(() => { REACT_PACKAGE_ATTESTATIONS[0].verification.installations[0].files['index.js'] = 'changed'; }, TypeError);
});
