import { getReactBehavior } from './react-behavior.mjs';
const VERSION = '18.3.1';

const references = Object.freeze({
  react: 'https://18.react.dev/reference/react',
  hooks: 'https://18.react.dev/reference/react/hooks',
  dom: 'https://18.react.dev/reference/react-dom',
  client: 'https://18.react.dev/reference/react-dom/client',
  server: 'https://18.react.dev/reference/react-dom/server',
});

const packageForSurface = surface => surface === 'react' ? 'react' : 'react-dom';

function records(surface, disposition, names, details = {}) {
  return names.map(exportName => ({
    id: `${surface}/${exportName}/${VERSION}`,
    surface,
    package: packageForSurface(surface),
    export: exportName,
    versions: [VERSION],
    disposition,
    ...details,
    behavior: getReactBehavior({ surface, exportName, version: VERSION }),
  }));
}

const inventory = [
  ...records('react', 'modeled', ['useCallback'], {
    semantic_kind: 'retained_callback',
    condition: 'An inline callback has stable source identity, but React may retain an older function and its older render captures while dependencies are unchanged. Runtime invocation and captured values remain unproved.',
    reference: 'https://18.react.dev/reference/react/useCallback',
  }),
  ...records('react', 'modeled', ['useMemo'], {
    semantic_kind:'memo_value',
    condition:'A straight-line calculator return exposes callback or object shape. Retained value identity, calculator execution, and old render captures require occurrence evidence.',
    reference:'https://18.react.dev/reference/react/useMemo',
  }),
  ...records('react', 'modeled', ['useTransition'], {
    semantic_kind:'transition_hook',
    condition:'Immutable tuple destructuring exposes the returned start function. Direct calls with inline, named or finite conditional callbacks retain candidate source paths; actual function provenance and callback invocation require runtime evidence. Direct pending-boolean conditions select source branches; other pending consumers, priority and commit attribution remain frontiers.',
    reference:'https://18.react.dev/reference/react/useTransition',
  }),
  ...records('react', 'modeled', ['useDeferredValue'], {
    semantic_kind:'deferred_value',
    condition:'The selected value may be the current input or a previous committed value. Direct immutable native JSX reads are indexed; selection, owner and prior-result identity require runtime evidence. Runtime urgency and commit attribution remain unproved.',
    reference:'https://18.react.dev/reference/react/useDeferredValue',
  }),
  ...records('react', 'modeled', ['useState', 'useReducer'], {
    semantic_kind: 'state_pair',
    condition: 'A top-level two-element binding is modeled as an occurrence-specific state/reducer value and stable queue function. Scheduling, batching, reducer execution, and committed DOM outcome remain unproved.',
    reference: references.hooks,
  }),
  ...records('react', 'modeled', ['createContext', 'useContext'], {
    semantic_kind: 'context_value',
    condition: 'An exact context object connects a statically nested Provider value to consumers below it and expands one immutable Consumer source callback. Dynamic topology, callback choices, invocation, and committed runtime values remain unproved.',
    reference: 'https://18.react.dev/reference/react/useContext',
  }),
  ...records('react', 'modeled', ['createRef', 'useRef'], {
    semantic_kind: 'ref_cell',
    condition: 'The ref object and live current-cell read remain distinct. Source analysis identifies the cell; attachments, writes, reads, and mounted object identity require occurrence evidence.',
    reference: 'https://18.react.dev/reference/react/useRef',
  }),
  ...records('react', 'modeled', ['forwardRef', 'memo'], {
    semantic_kind: 'component_wrapper',
    condition: 'An inline component argument preserves its source component identity. Ref delivery, memo comparison, render skipping, and runtime occurrence remain unproved.',
    reference: references.react,
  }),
  ...records('react', 'modeled', ['Component', 'PureComponent'], {
    semantic_kind: 'class_component',
    condition: 'Class lifecycle and setState/forceUpdate member sources are inventoried per class. Mounted instance, accepted render, commit, callback, error, and unmount remain occurrence evidence.',
    reference: 'https://18.react.dev/reference/react/Component',
  }),
  ...records('react', 'modeled', ['startTransition'], {
    semantic_kind: 'synchronous_scope',
    condition: 'Invokes the supplied scope synchronously; only its synchronously scheduled React 18 updates receive transition priority. Commit and asynchronous continuation remain separate.',
    reference: 'https://18.react.dev/reference/react/startTransition',
  }),
  ...records('react-dom', 'modeled', ['flushSync', 'unstable_batchedUpdates'], {
    semantic_kind: 'synchronous_scope',
    condition: 'Invokes the supplied scope synchronously; flush/batch behavior follows the attached exact-version contract. Other pending effects are not attributed to this callback without runtime evidence.',
    reference: 'https://18.react.dev/reference/react-dom/flushSync',
  }),
  ...records('react', 'unsupported', ['useDebugValue'], {
    reason: 'DevTools may invoke the optional formatter; inspection-triggered execution is not yet joined to runtime evidence.',
    reference: 'https://18.react.dev/reference/react/useDebugValue',
  }),
  ...records('react', 'no_relevant_tracing_effect', ['version'], {
    reason: 'The exported version string carries package metadata only.',
    reference: references.react,
  }),
  ...records('react', 'unsupported', [
    'Children', 'Fragment', 'Profiler', 'StrictMode', 'Suspense',
    'act', 'cloneElement', 'createElement', 'createFactory',
    'isValidElement', 'lazy', 'useEffect',
    'useId', 'useImperativeHandle', 'useInsertionEffect', 'useLayoutEffect',
    'useSyncExternalStore', 'unstable_act',
  ], {
    reason: 'This public export can affect render topology, lifecycle timing, callback execution, mutable identity, or control flow, but Tracer has no admitted React 18.3.1 tracing semantic for it.',
    reference: references.react,
  }),
  ...records('react-dom', 'no_relevant_tracing_effect', ['version'], {
    reason: 'The exported version string carries package metadata only.',
    reference: references.dom,
  }),
  ...records('react-dom', 'unsupported', [
    'createPortal', 'findDOMNode', 'hydrate', 'render',
    'unmountComponentAtNode', 'unstable_renderSubtreeIntoContainer',
  ], {
    reason: 'This DOM export can affect rendered topology, lifecycle timing, or DOM identity, but Tracer has no admitted React DOM 18.3.1 tracing semantic for it.',
    reference: references.dom,
  }),
  ...records('react-dom', 'modeled', ['createRoot', 'hydrateRoot'], {
    semantic_kind: 'root_handle',
    condition: 'The returned root render/unmount members retain their producer source identity. Scheduling is source-predicted; commit, hydration, and cleanup need exact runtime evidence.',
    reference: references.dom,
  }),
  ...records('react-dom/client', 'modeled', ['createRoot', 'hydrateRoot'], {
    semantic_kind: 'root_handle',
    condition: 'The returned root render/unmount members retain their producer source identity. Scheduling is source-predicted; commit, hydration, and cleanup need exact runtime evidence.',
    reference: references.client,
  }),
  ...records('react-dom/server', 'no_relevant_tracing_effect', ['version'], {
    reason: 'The exported version string carries package metadata only.',
    reference: references.server,
  }),
  ...records('react-dom/server', 'unsupported', [
    'renderToNodeStream', 'renderToStaticMarkup', 'renderToStaticNodeStream', 'renderToString',
  ], {
    reason: 'Server rendering can determine emitted markup, callbacks, hydration identity, and stream lifecycle, but Tracer has no admitted server-render semantic for React DOM 18.3.1.',
    reference: references.server,
  }),
  ...records('react-dom/server', 'unsupported', ['renderToPipeableStream'], {
    environment: 'node',
    reason: 'Node stream rendering can determine emitted markup, callbacks, hydration identity, and stream lifecycle, but Tracer has no admitted Node server-render semantic for React DOM 18.3.1.',
    reference: 'https://18.react.dev/reference/react-dom/server/renderToPipeableStream',
  }),
  ...records('react-dom/server', 'unsupported', ['renderToReadableStream'], {
    environment: 'browser',
    reason: 'Web-stream rendering can determine emitted markup, callbacks, hydration identity, and stream lifecycle, but Tracer has no admitted browser server-render semantic for React DOM 18.3.1.',
    reference: 'https://18.react.dev/reference/react-dom/server/renderToReadableStream',
  }),
];

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
}

export const REACT_API_INVENTORY = freeze(inventory);

export const REACT_PACKAGE_ATTESTATIONS = freeze([
  {
    id: `react/source/${VERSION}`,
    package: 'react',
    version: VERSION,
    integrity: 'sha512-wS+hAgJShR0KhEvPJArfuPVN1+Hz1t0Y6n5jLrGQbkb4urgPE/0Rve+1kMB1v/oWgHgm4WIcV+i7F2pTVj+2iQ==',
    source: 'https://github.com/facebook/react/tree/v18.3.1/packages/react',
    verification: {
      method: 'exact_installed_package_source',
      installations: [{
        package: 'react', version: VERSION,
        integrity: 'sha512-wS+hAgJShR0KhEvPJArfuPVN1+Hz1t0Y6n5jLrGQbkb4urgPE/0Rve+1kMB1v/oWgHgm4WIcV+i7F2pTVj+2iQ==',
        files: {
          'package.json': 'd4e68a5c96babb20cad1daafea8b78822eae45b341552cf5418d06a5304fa64c',
          'index.js': 'a216c390bf956cbb906c66d29fdb2e2ad6999464a5ca83e476533a6f25ad0ef3',
          'cjs/react.development.js': '1ff3a1d9861a87984329584fa1172aea920855d79eb57dae0d1cebe54093d7e3',
          'cjs/react.production.min.js': '4b35e378f469c4f492c7514bb106b5833746dbbae80496bd4aa9acc6e9ac4b42',
          'umd/react.development.js': '28348fef6cb0ed8b2ceeb22deaf824428fd13875d84c73d38f77dd216fc24e7f',
          'umd/react.production.min.js': 'd949f1c3687aedadcedac85261865f29b17cd273997e7f6b2bfc53b2f9d4c4dd',
        },
      }],
    },
  },
  {
    id: `react-dom/source/${VERSION}`,
    package: 'react-dom',
    version: VERSION,
    integrity: 'sha512-5m4nQKp+rZRb09LNH59GM4BxTh9251/ylbKIbpe7TpGxfJ+9kv6BLkLBXIjjspbgbnIBNqlI23tRnTWT0snUIw==',
    source: 'https://github.com/facebook/react/tree/v18.3.1/packages/react-dom',
    verification: {
      method: 'exact_installed_package_source',
      installations: [{
        package: 'react-dom', version: VERSION,
        integrity: 'sha512-5m4nQKp+rZRb09LNH59GM4BxTh9251/ylbKIbpe7TpGxfJ+9kv6BLkLBXIjjspbgbnIBNqlI23tRnTWT0snUIw==',
        files: {
          'package.json': 'd2f29e31bd48b833e48cd7bbf41f192e8ee4ff8da249fdbe10d4ac4114b8b12e',
          'index.js': 'f26fcb81b5d1dc32c6edea34645c75b60d259916293d3208c8be48ac33e882e4',
          'client.js': 'a510041dfc40d69b3aa574e5e111864186c711fbeb3db41aa2f27196b27c429f',
          'server.node.js': 'a0f7a56527b73f95ac283578815fad4a4e5e849f451267fb7a0d7b347453727c',
          'server.browser.js': '25b2a8fbe5dbf5e38f32fb11db0af0c67f6c61abb3ef22a7c71473202cabf653',
          'cjs/react-dom.development.js': '1459b808bc6991de5a1ec3a86d8beee32dbb6c14282cf13f84e00dfebfbdc025',
          'cjs/react-dom.production.min.js': 'cbf7fe6b9726ee65f8bcd5715289cc5161c8dacf74d0b8aaa0d29412516f5f47',
          'umd/react-dom.development.js': 'f9044a5e9c39db8bb1a204dff924e526ec0a621e695bb69de1035811be8709e4',
          'umd/react-dom.production.min.js': '35f4f974f4b2bcd44da73963347f8952e341f83909e4498227d4e26b98f66f0d',
          'umd/react-dom.profiling.min.js': '2daedab06b577dc0674514e9fa738b9cce256741735451cadff6ee26aee0ff41',
          'cjs/react-dom-server.node.development.js': '6979be97ff88b4959a02c7af65a83f37084e1dd91cb59f95d9a6e8c3e039fbb6',
          'cjs/react-dom-server.node.production.min.js': '967e9ceae29baf904e504b102061ca072015678e4e07121f212d5da23a1400af',
          'cjs/react-dom-server.browser.development.js': '3515afa33dc9a1420d013be553c4e8a86cf128d83a47e70173d23c8163aa86bb',
          'cjs/react-dom-server.browser.production.min.js': '89bde1aa0fb045330419c7d8900e33d43e693ae33a5baae5fdb6b126160fe292',
          'cjs/react-dom-server-legacy.node.development.js': 'a1ece181be0c98e5449cfd6c89f27f4d0b8ace7745566fb09ece37d79f1084d4',
          'cjs/react-dom-server-legacy.node.production.min.js': '570b36574af19640e243c8296257f3bad0fb41d84cc7f273bf752ccdf86b5b60',
          'cjs/react-dom-server-legacy.browser.development.js': '5acee43203eac80a9e45284d3e98ffeeac57de2a925299b0c70af639d14fc28e',
          'cjs/react-dom-server-legacy.browser.production.min.js': '55f08e1c365fa1525359467e68f72bf50f901a7c0b59685df168fdceb01593cb',
        },
      }],
    },
  },
]);

export function reactSemanticPackages() {
  return [...new Set(REACT_PACKAGE_ATTESTATIONS.map(row => row.package))].sort();
}

export function reactPackageAttestation(packageName, version) {
  return REACT_PACKAGE_ATTESTATIONS.find(row => row.package === packageName && row.version === version) || null;
}

/**
 * Return the exact-version tracing disposition for one public React export.
 * A null result means the surface, export, version, or environment has not been inventoried.
 */
export function getReactApiRecord({ surface, exportName, version, environment }) {
  const candidates = REACT_API_INVENTORY.filter(row => row.surface === surface
    && row.export === exportName && row.versions.includes(version)
    && (!row.environment || !environment || row.environment === environment));
  return candidates.length === 1 ? candidates[0] : null;
}
