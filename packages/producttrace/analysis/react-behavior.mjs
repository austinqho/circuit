import {planEffectExecution} from './react-execution-rule.mjs';
// These contracts describe public React 18.3.1 behavior, not reconciler internals.
// A callback slot is a relation to application code. It is never an assertion
// that the callback ran: source and runtime evidence use different claim levels.
const callback = (slot, phase, trigger, extra = {}) => ({ slot, phase, trigger, ...extra });
const contract = (owner, callbacks, reads, writes, scheduling, constraints, members = {}) => ({
  schema: 'producttrace.react-behavior.v1', owner, callbacks, reads, writes, scheduling, constraints, members,
});
const hookOwner = 'root + mounted component instance + hook ordinal; reset on remount/key/type change';
const renderRules = [
  'A render attempt may restart or be abandoned; render invocation does not prove a commit.',
  'Development StrictMode may repeat render calculations; each invocation needs its own occurrence ID.',
  'Closure reads belong to the render that created that function; an unchanged source location does not identify its captured values.',
];
const dependencyRules = [
  'Compare a constant-length dependency tuple positionally with Object.is, not deep equality.',
  'Omitted dependencies invalidate every render; an empty tuple has no changing positions.',
  'Dependency equality does not identify a component instance and never joins separate mounts.',
];
const memoRules = [...renderRules, ...dependencyRules,
  'Cache retention is an optimization, not a correctness guarantee; initial suspension or development edits can discard it.'];
const effect = (phase, additional = []) => contract(hookOwner, [
  callback('arguments.0', phase, 'committed mount or dependency change', { returns: 'cleanup', captures: 'setup render' }),
  callback('cleanup', phase, 'before replacement setup or unmount', { captures: 'previous successful setup', requires: 'that setup returned a function' }),
], ['dependency tuple', 'setup/cleanup closure captures'], ['external effects performed by application callbacks'],
['Register during render; invoke only for committed client work.'], [...dependencyRules,
  'Server rendering never invokes setup or cleanup.',
  'Abandoned render attempts do not acquire a cleanup obligation.', ...additional]);
const transition = contract('calling scope; hook form also owns pending state on its mounted component', [
  callback('arguments.0', 'synchronous call', 'startTransition invocation', { arguments: [], returns: 'ignored' }),
], ['current transition scope'], ['update priority; hook pending flag'],
['Only updates scheduled synchronously inside this React 18 scope are marked as transitions.'], [
  'The scope callback runs immediately; rendering its updates may be interrupted or restarted.',
  'Updates after await or in timers are outside this scope in React 18.',
  'A transition does not defer arbitrary callback side effects or make them transactional.',
  'Transition updates cannot control text inputs; overlapping transitions may be batched.',
]);
const component = contract('mounted class instance, identified by root/tree position/key/type', [
  callback('constructor', 'render attempt', 'new instance', { arguments: ['props'] }),
  callback('render', 'render attempt', 'mount or accepted update'),
  callback('componentDidMount', 'layout commit', 'mounted commit'),
  callback('componentDidUpdate', 'layout commit', 'updated commit', { arguments: ['previous props', 'previous state', 'snapshot'] }),
  callback('componentWillUnmount', 'unmount commit', 'instance removal'),
  callback('getSnapshotBeforeUpdate', 'before DOM mutation', 'update about to commit', { returns: 'snapshot for componentDidUpdate' }),
  callback('shouldComponentUpdate', 'render attempt', 'props/state update', { returns: 'render bailout hint' }),
  callback('static getDerivedStateFromProps', 'render attempt', 'mount/update', { returns: 'partial state or null' }),
  callback('static getDerivedStateFromError', 'render recovery', 'descendant render error', { returns: 'fallback state' }),
  callback('componentDidCatch', 'error commit', 'descendant error handled by this boundary'),
  callback('UNSAFE_componentWillMount', 'legacy render', 'mount'),
  callback('UNSAFE_componentWillReceiveProps', 'legacy render', 'incoming props'),
  callback('UNSAFE_componentWillUpdate', 'legacy render', 'update'),
], ['props', 'state', 'contextType', 'instance fields'], ['queued state', 'committed instance fields'],
['setState queues an update; forceUpdate bypasses shouldComponentUpdate.'], [...renderRules,
  'Error boundaries do not catch their own render errors, arbitrary event-handler errors, or ordinary asynchronous errors.',
  'StrictMode can simulate a mount/unmount/mount cycle in development.',
  'Legacy will* aliases have the same unsafe render-phase timing; new lifecycle APIs suppress some legacy callbacks.',
], {
  setState: { callbacks: [callback('arguments.0 if function', 'update calculation', 'queued update', { arguments: ['pending state', 'props'] }), callback('arguments.1', 'commit', 'applied update')], merge: 'shallow partial object; null is no change', identity: 'this instance' },
  forceUpdate: { callbacks: [callback('arguments.0', 'commit', 'forced update')], bypass: 'this.shouldComponentUpdate; descendant bailouts still apply' },
  contextType: { reads: 'nearest matching provider above instance, otherwise context default' },
});
const element = contract('element description; mounted identity determined later by reconciler', [],
  ['type', 'props', 'children', 'key', 'ref'], ['new element description'], [], [
    'Constructing an element does not invoke its component or its event callbacks.',
    'key controls sibling identity; key and ref are reserved and are not ordinary props in React 18.',
    'Omitted/undefined props may receive component defaultProps in React 18.',
  ]);
const root = contract('DOM container + root lifetime', [
  callback('options.onRecoverableError', 'recovery', 'React recovers from an error'),
], ['container', 'element tree', 'identifierPrefix'], ['root ownership and committed DOM'],
['root.render schedules reconciliation; returning from render does not prove a commit.'], [
  'Root instance identity is not the container source location.',
  'Unmount removes handlers/effects/refs and ends this root lifetime; render on an unmounted root throws.',
], {
  render: { callbacks: [], reads: ['arguments.0 element'], schedules: 'reconcile element tree; preserve matching component identities' },
  unmount: { callbacks: [], schedules: 'cleanup effects, detach refs, unmount class instances and event ownership' },
});
const server = (mode, streaming = false) => contract('server render request + boundary/task', [
  callback('element component bodies', 'server render', 'render request', { captures: 'server request render' }),
  ...(streaming ? [callback('options.onError', 'stream error', 'render failure', { returns: 'optional error digest' })] : []),
], ['element tree', 'context', 'server snapshots', 'identifierPrefix'], ['HTML output'],
[`Produce ${mode}; client effects/ref attachments are not executed.`], [
  'Server output does not prove browser hydration, event-handler installation, or client callback execution.',
  'Request/stream identity must not be shared across server renders.',
]);

const react = {
  useCallback: contract(hookOwner, [callback('arguments.0', 'caller invocation', 'returned callback is later called', { retained: true, captures: 'render that produced retained function' })],
    ['dependencies', 'retained function identity'], ['callback cache'], [], [...memoRules, 'useCallback itself does not call its argument.']),
  useMemo: contract(hookOwner, [callback('arguments.0', 'render attempt', 'cache missing or dependencies changed', { arguments: [], returns: 'cached value' })],
    ['dependencies', 'calculator closure'], ['value cache'], [], memoRules),
  useState: contract(hookOwner, [callback('arguments.0 if function', 'initial render calculation', 'new mount', { arguments: [], returns: 'initial state' }),
    callback('return.1.arguments.0 if function', 'update calculation', 'setter queue processing', { arguments: ['pending state'], returns: 'next state' })],
    ['instance state', 'ordered update queue'], ['next state'], ['Setter queues an owner update; React may batch updates and bail out using Object.is.'],
    [...renderRules, 'Setter identity is stable for this mount; setter return does not mean state/DOM already changed.', 'A function argument is an updater/initializer, not a value to store unless wrapped.']),
  useReducer: contract(hookOwner, [callback('arguments.2 if provided', 'initial render calculation', 'new mount', { arguments: ['arguments.1'], returns: 'initial state' }),
    callback('arguments.0', 'update calculation', 'dispatch queue processing', { arguments: ['pending state', 'action'], returns: 'next state' })],
    ['owner state', 'ordered actions', 'reducer closure'], ['next state'], ['Dispatch queues owner rendering; Object.is may suppress committed change.'],
    [...renderRules, 'Dispatch identity is stable for this mount; initialArg is used directly when init is absent.']),
  useEffect: effect('passive commit', ['Development StrictMode performs an extra setup/cleanup rehearsal.', 'Do not assert passive effects always run after paint; interaction timing can differ.']),
  useLayoutEffect: effect('layout commit before paint', ['Development StrictMode performs an extra setup/cleanup rehearsal.', 'Layout effect state updates may flush remaining effects before paint.', 'Suspense hiding committed content cleans up layout effects and recreates them on reveal.']),
  useInsertionEffect: effect('insertion commit before layout effects', ['Do not assume DOM mutation order or attached refs within insertion effects.', 'State updates are forbidden here.', 'Cleanup and setup can interleave per component; React 18 StrictMode does not replay insertion setup like layout/passive effects.']),
  useRef: contract(hookOwner, [], ['initial value on mount', 'mutable current at read time'], ['stable ref object'], [],
    [...renderRules, 'Later initial values are ignored.', 'Writing current does not schedule a render.', 'A ref read in a callback is a live cell read, not a captured snapshot of current.']),
  createRef: contract('each createRef call allocation', [], [], ['new object with current=null'], [], ['Unlike useRef, another createRef call returns another object.']),
  useImperativeHandle: contract(hookOwner, [callback('arguments.1', 'layout commit', 'mount or dependencies/ref changed', { arguments: [], returns: 'handle assigned to ref' }),
    callback('arguments.0 if callback ref', 'layout commit', 'attach new handle or detach old handle', { arguments: ['handle or null'] })],
    ['dependencies', 'ref identity', 'createHandle captures'], ['ref.current or callback-ref assignment'], [],
    [...dependencyRules, 'Previous ref is cleared on replacement and unmount.', 'Handle factory runs on client commit, not server render.', 'Development StrictMode may rehearse attach/detach.']),
  createContext: contract('context object identity', [callback('return.Consumer.props.children', 'render attempt', 'consumer render', { arguments: ['nearest provider value'] })],
    ['default value', 'nearest matching provider value'], ['context object'], [], ['Default is used only when no matching provider exists; an explicit undefined provider remains undefined.', 'Different context objects are never interchangeable.'], {
      Provider: { reads: ['props.value'], schedules: 'Object.is change notifies consumers below this provider, even through memo ancestors' },
      Consumer: { callbacks: [callback('props.children', 'render attempt', 'context subscription', { arguments: ['provider value or default'] })] },
    }),
  useContext: contract(hookOwner, [], ['nearest matching provider above component'], ['context subscription'], ['Provider Object.is change can rerender this consumer independently of memo props.'], ['A provider returned by this component is below this useContext call, not above it.']),
  useSyncExternalStore: contract(hookOwner, [callback('arguments.0', 'client subscription', 'mount or subscribe identity changed', { arguments: ['React store-change callback'], returns: 'unsubscribe' }),
    callback('arguments.1', 'render and consistency checks', 'read/check client snapshot', { returns: 'cached snapshot' }),
    callback('arguments.2', 'server render and initial hydration', 'server/hydration snapshot', { returns: 'matching initial snapshot' }),
    callback('unsubscribe', 'subscription cleanup', 'replace subscription or unmount')],
    ['external store snapshot via Object.is'], ['owner subscription'], ['Store change requests a snapshot check/update; concurrent consistency mismatch can restart work as blocking.'],
    ['Missing getServerSnapshot on server is an error.', 'Unchanged snapshots must retain identity.', 'A subscription event is not proof the snapshot changed.']),
  useTransition: { ...transition, owner:hookOwner,
    callbacks: transition.callbacks.map(callback => ({...callback, slot:'return.1.arguments.0'})),
    members: { startTransition: transition } },
  startTransition: transition,
  useDeferredValue: contract(hookOwner, [], ['current input', 'previous committed deferred value'], ['deferred value'],
    ['Urgent render can retain old value while an interruptible background render tries the new value.'],
    [...renderRules, 'There is no fixed debounce timer.', 'Effects for abandoned deferred renders do not run.', 'Suspension can retain previous content until new content is ready.']),
  useId: contract(hookOwner, [], ['tree identity', 'root identifierPrefix'], ['stable accessibility ID for mount'], [],
    ['Matching server/client trees and prefixes are required for hydration correspondence.', 'An ID is not a list key, database entity ID, or cross-root causal join by itself.']),
  useDebugValue: contract(hookOwner, [callback('arguments.1 if provided', 'DevTools inspection', 'inspected custom hook', { arguments: ['arguments.0'], returns: 'display label' })],
    ['debug value'], ['DevTools label'], [], ['Formatter invocation must not be silently treated as no application callback; it is inspection-triggered, not a product event.']),
  memo: contract('memo component type + each mounted instance', [callback('arguments.0 component', 'render attempt', 'mount or update not skipped'),
    callback('arguments.1 if supplied', 'update comparison', 'compare previous and next props', { arguments: ['previous props', 'next props'], returns: 'true permits bailout' })],
    ['props', 'own state', 'subscribed context'], ['memo component type'], [], [...renderRules,
    'Default comparison checks each prop with Object.is; custom comparison may retain older function props and captures.', 'State/context updates can render despite equal props; memo is not a semantic guarantee.']),
  forwardRef: contract('wrapped component type + mounted instance', [callback('arguments.0', 'render attempt', 'wrapper rendered', { arguments: ['props', 'forwarded ref'] })],
    ['props', 'ref'], ['component description'], [], [...renderRules, 'Wrapper construction does not invoke render; ref delivery depends on commit.']),
  lazy: contract('lazy type object; shared loader cache across its instances', [callback('arguments.0', 'first attempted render of lazy type', 'loader not started', { arguments: [], returns: 'thenable resolving module.default component' }),
    callback('resolved default component', 'render attempt', 'loader fulfilled')],
    ['cached loader status/result'], ['cached thenable/component/error'], ['Pending loader suspends; fulfillment permits retry; rejection propagates to error boundary.'],
    ['Calling lazy does not call its loader.', 'A newly created lazy type has a separate cache and may reset component identity.']),
  Suspense: contract('nearest Suspense boundary instance + render attempt', [], ['descendant suspension', 'fallback', 'transition/deferred update priority'], ['visible fallback/content'],
    ['Pending descendants can select fallback; settlement permits retry; transition/deferred work can retain already revealed content.'],
    ['Initial suspended render state is not committed and is retried from scratch.', 'Layout effects are detached when revealed content is hidden and attached on reveal.', 'Suspense does not detect arbitrary fetching inside effects or event handlers.', 'Streaming/hydration can resolve individual boundaries independently.']),
  StrictMode: contract('marked subtree in development', [], ['development build and subtree'], [], ['Extra render and effect checks may repeat observable application callbacks.'],
    ['Production has no extra StrictMode checks.', 'React 18 replays layout/passive mount effects, not insertion effects.', 'Do not import React 19 callback-ref replay semantics into this version.']),
  Fragment: contract('sibling grouping in React tree', [], ['children', 'optional key'], ['no host DOM wrapper'], [],
    ['Key affects reconciliation identity; Fragment does not invoke children as functions.', 'React 18 Fragment has no supported ref.']),
  Profiler: contract('profiler subtree + commit', [callback('props.onRender', 'commit', 'profiled subtree commits', { arguments: ['id', 'phase', 'actualDuration', 'baseDuration', 'startTime', 'commitTime'] })],
    ['commit timings'], [], [], ['Production profiling requires the profiling build; no callback is promised for abandoned renders.']),
  Component: component,
  PureComponent: { ...component, constraints: [...component.constraints, 'Default shouldComponentUpdate shallowly compares props/state; context changes can still render.'] },
  createElement: element,
  createFactory: { ...element, members: { call: { reads: ['props', 'children'], writes: 'createElement for the captured type' } }, constraints: [...element.constraints, 'Returns an element-construction function for one type; does not render that type.'] },
  cloneElement: { ...element, constraints: [...element.constraints, 'Shallowly replaces supplied props; children arguments replace children; supplied key/ref replace original identities.'] },
  isValidElement: contract('call', [], ['value element marker'], [], [], ['Checks React element descriptions; arrays, strings, and portals may be renderable without being elements.']),
  Children: contract('opaque children traversal call', [], ['children structure'], [], [], ['Traversal does not render components or traverse inside element/Fragment children.'], {
    map: { callbacks: [callback('arguments.1', 'synchronous traversal', 'each traversed child', { arguments: ['child', 'index'], receiver: 'arguments.2' })], returns: 'mapped flattened children with reconciled keys' },
    forEach: { callbacks: [callback('arguments.1', 'synchronous traversal', 'each traversed child', { arguments: ['child', 'index'], receiver: 'arguments.2' })], returns: 'undefined' },
    count: { reads: ['children including empty nodes'], returns: 'number of traversed nodes' },
    toArray: { reads: ['children'], returns: 'flat keyed array excluding null/undefined/booleans' },
    only: { reads: ['children'], returns: 'one element; throws for array even length one or a non-element' },
  }),
  act: contract('test update scope', [callback('arguments.0', 'test scope', 'act call', { returns: 'optional thenable awaited by async act' })],
    ['pending React work'], ['test work queue'], ['Flush related scheduled updates/effects while awaited.'],
    ['Development test helper, unsupported in production builds.', 'Returning from unawaited async act does not prove work has flushed.']),
  version: contract('package metadata', [], [], [], [], ['A version string does not prove installed source integrity.']),
};

const dom = {
  createRoot: root,
  hydrateRoot: { ...root, scheduling: ['Attach React to existing matching server markup and schedule hydration.'], constraints: [...root.constraints,
    'Server and client markup/tree/prefix must agree; mismatches may recover by client rendering.',
    'A root.render before hydration finishes can replace server HTML with client rendering.',
    'Observed pre-hydration events are not by themselves proof of the eventual handler or replay order.'] },
  createPortal: contract('React parent tree + target DOM container/key', [], ['children', 'container', 'key'], ['host placement in another container'], [],
    ['Context and synthetic event propagation follow the React tree, not DOM ancestry.', 'Changing portal container recreates its subtree.']),
  flushSync: contract('synchronous flush scope', [callback('arguments.0', 'synchronous call', 'flushSync invocation')],
    ['pending React updates/effects'], ['committed DOM when flush completes'], ['Flush callback updates synchronously; may flush pending work/effects outside callback.'],
    ['May reveal Suspense fallbacks.', 'Cannot safely force a flush while React is rendering or committing; do not use as a universal completion marker.']),
  findDOMNode: contract('mounted class instance', [], ['committed host descendant'], [], [], ['Returns first host/text node or null; invalid/unmounted instances can throw; portals and later changes need explicit identity.']),
  render: contract('legacy root container', [callback('arguments.2', 'commit', 'legacy render committed')], ['element', 'container'], ['legacy root DOM'], ['Legacy root update semantics in React 18.'], ['Deprecated; returned class instance is not a general function-component handle.']),
  hydrate: contract('legacy root container', [callback('arguments.2', 'commit', 'legacy hydration committed')], ['server markup', 'element'], ['legacy hydrated root'], ['Legacy hydration semantics.'], ['Mismatch can recover; deprecated; not interchangeable with concurrent hydrateRoot.']),
  unmountComponentAtNode: contract('legacy container root', [], ['container root'], ['removed tree'], ['Unmount cleanup and ref detachment.'], ['Returns whether a legacy root accepted an unmount request; removal can finish after return during a render or commit. Does not replace concurrent root.unmount.']),
  version: react.version,
};
// Public legacy/unstable exports are version-specific contracts too. Only secret
// implementation internals are excluded from the public bank.
react.unstable_act = react.act;
dom.unstable_batchedUpdates = contract('legacy batching scope', [callback('arguments.0', 'synchronous call', 'batch invocation', {arguments:['arguments.1'],returns:'forwarded to caller'})],
  ['pending updates'], [], ['Batch updates within the scope; concurrent roots already batch many updates automatically.'],
  ['A batching scope does not delay calling its callback or guarantee one render for all future asynchronous work.']);
dom.unstable_renderSubtreeIntoContainer = contract('mounted parent class instance + legacy target container',
  [callback('arguments.3', 'legacy commit', 'subtree committed')], ['parent legacy context', 'element', 'container'], ['legacy rendered subtree'],
  ['Render into a legacy container using the mounted parent component context.'], ['Requires a mounted parent instance; not equivalent to a modern portal.']);
const nodeStream = { ...server('legacy readable HTML stream'), members: {
  'stream.on(error)': { callbacks: [callback('registered error listener', 'stream error', 'stream failed')] },
} };
const serverApis = {
  renderToString: { ...server('hydratable string'), constraints: [...server('x').constraints, 'Does not wait for suspended content; emits fallback for unresolved boundaries.'] },
  renderToStaticMarkup: { ...server('non-hydratable string'), constraints: [...server('x').constraints, 'Static markup is not intended for hydration; unresolved boundaries emit fallback.'] },
  renderToNodeStream: nodeStream,
  renderToStaticNodeStream: { ...nodeStream, constraints: [...nodeStream.constraints, 'In installed React 18.3.1 this legacy export uses the same hydratable response state as renderToNodeStream; its name does not imply static marker output.'] },
  renderToPipeableStream: { ...server('pipeable HTML stream', true), callbacks: [...server('x', true).callbacks,
    callback('options.onShellReady', 'stream shell ready', 'shell available'),
    callback('options.onShellError', 'stream shell failure', 'shell cannot be produced'),
    callback('options.onAllReady', 'stream ready', 'all render tasks complete')], members: {
      pipe: { writes: 'HTML to writable destination', constraints: ['Shell readiness does not imply all Suspense boundaries completed.'] },
      abort: { schedules: 'abort pending tasks; incomplete boundaries can recover on client' },
    } },
  renderToReadableStream: { ...server('Web ReadableStream', true), members: {
    allReady: { returns: 'promise for completion of pending render tasks' },
    'options.signal': { schedules: 'abort pending rendering on signal' },
  } },
  version: react.version,
};

// React 18 calls these scopes immediately. Priority and flush obligations do
// not imply that every queued update committed or that async work inherited it.
for(const [behavior,scheduling,forward,result,missing] of [
  [react.startTransition,'transition',[],'undefined','required'],
  [dom.flushSync,'sync_flush',[],'callback_result','skip_falsy'],
  [dom.unstable_batchedUpdates,'legacy_batch',[1],'callback_result','required'],
])behavior.execution={schema:'producttrace.react-execution-rule.v1',kind:'synchronous_scope',
  callback_argument:0,callback_arguments:forward,missing_callback:missing,result,
  exceptions:scheduling==='transition'?'propagate':'callback_or_flush_error',scheduling,
  transition_context:scheduling==='transition'?'new':scheduling==='sync_flush'?'clear':'preserve',async_continuation:'outside_scope'};

// Both public names are the same installed function. A returned act thenable
// is not evidence that queued work finished; completion requires awaiting it.
for(const [api,mode,children,options] of [['createRoot','create',null,1],['hydrateRoot','hydrate',1,2]])dom[api].execution={
 schema:'producttrace.react-execution-rule.v1',kind:'dom_root',mode,container_argument:0,children_argument:children,options_argument:options,
 identifier_prefix_option:'identifierPrefix',recoverable_error_option:'onRecoverableError',
 container_node_types:[1,9,11],render_argument:0,render_after_unmount:'throw',unmount_timing:'synchronous',repeat_unmount:'noop'};
react.lazy.execution={schema:'producttrace.react-execution-rule.v1',kind:'lazy_component',loader_argument:0,creation:'store',settlement:'first',
 module_property:'default',pending:'throw',retry_loader_error:true};
react.act.execution={schema:'producttrace.react-execution-rule.v1',kind:'test_scope',callback_argument:0,callback_arguments:[],
 development:'invoke',production:'throw_before_callback',callback_timing:'synchronous',result:'thenable',callback_exceptions:'propagate',completion:'outermost_queue_drain'};
react.cloneElement.execution={schema:'producttrace.react-execution-rule.v1',kind:'element_clone',element_argument:0,config_argument:1,children_start:2,
 reserved_props:['key','ref','__self','__source'],children_policy:'replace',default_policy:'supplied_undefined',ref_owner:'replace_on_ref',marker:'react.element',callbacks_at_creation:'store'};
react.createElement.execution={schema:'producttrace.react-execution-rule.v1',kind:'element_construction',type_argument:0,config_argument:1,children_start:2,
 reserved_props:['key','ref','__self','__source'],children_policy:'replace',default_policy:'undefined',
 owner:{development:'current_render_owner_or_null_outside_renderer',production:'null'},marker:'react.element',callbacks_at_creation:'store'};
react.createFactory.execution={schema:'producttrace.react-execution-rule.v1',kind:'element_factory',type_argument:0,allocation:'per_call',creation_callbacks:'store',
 construction:{...react.createElement.execution}};
react.Children.execution={schema:'producttrace.react-execution-rule.v1',kind:'children_collection',children_argument:0,callback_argument:1,receiver_argument:2,
 normalize_empty:true,leaf_types:['string','number'],leaf_markers:['react.element','react.portal'],traversal:'depth_first',index_start:0,element_children:'opaque',only_marker:'react.element'};
react.useDebugValue.execution={schema:'producttrace.react-execution-rule.v1',kind:'debug_value',value_argument:0,formatter_argument:1,
  development:'delegate',production:'ignore',renderer_formatter:'ignore',renderer_result:'undefined'};
dom.createPortal.execution={schema:'producttrace.react-execution-rule.v1',kind:'portal_description',
  children_argument:0,container_argument:1,key_argument:2,children_field:'children',container_field:'containerInfo',marker:'react.portal',children_at_creation:'store'};

react.version.execution={schema:'producttrace.react-execution-rule.v1',kind:'literal_export',
  values:{development:'18.3.1',production:'18.3.1'},callbacks:'none',scheduling:'none'};
// This installed production renderer exports its embedded next-build label.
// It is distinct from the npm package version and the server export.
dom.version={...react.version,execution:{...react.version.execution,
  values:{development:'18.3.1',production:'18.3.1-next-f1338f8080-20240426'}}};

// This program is consumed by the source transformer and independently checked
// against React. The prose above documents boundaries; it is not interpreted.
react.useCallback.execution = {
  schema:'producttrace.react-execution-rule.v1', kind:'retained_callback',
  callback_argument:0, dependencies_argument:1, owner:'mounted_hook',
  comparison:'Object.is', result:'callback_identity',
};

// ReactElement.isValidElement performs one ordinary marker read after its
// typeof/null guards. A getter or proxy may run user code or throw during it.
// Both synchronous server APIs abort unfinished work instead of waiting. The
// output mode changes boundary/text markers, not whether component bodies run.
for(const api of ['renderToString','renderToStaticMarkup'])serverApis[api].execution={
  schema:'producttrace.react-execution-rule.v1',kind:'server_string',element_argument:0,options_argument:1,
  output:api==='renderToString'?'hydratable':'static',suspension:'fallback',outside_boundary:'throw',
  callback_timing:'synchronous',effects:'none',result:'string'};

for(const name of ['Component','PureComponent'])react[name].execution={schema:'producttrace.react-execution-rule.v1',kind:'class_component',
 props_argument:0,context_argument:1,updater_argument:2,updater_default:'falsy',refs:'shared_empty',pure:name==='PureComponent',render_method:'render',
 props_field:'props',state_field:'state',comparison:'Object.is',custom_should_update:'first',default_update:name==='PureComponent'?'shallow_props_state':'always'};
for(const name of ['Component','PureComponent'])for(const member of ['setState','forceUpdate'])react[name].members[member].execution={
 schema:'producttrace.react-execution-rule.v1',kind:'class_update',member,updater_member:member==='setState'?'enqueueSetState':'enqueueForceUpdate',
 payload_argument:member==='setState'?0:null,completion_argument:member==='setState'?1:0,validate_payload:member==='setState',result:'undefined',
 updater_arguments:member==='setState'?['instance','payload','completion','member']:['instance','completion','member'],
 calculation_arguments:member==='setState'?['state','props']:[],completion_arguments:[],callback_receiver:'instance',merge:'shallow',nullish:'previous',force:member==='forceUpdate'};
serverApis.renderToPipeableStream.execution={schema:'producttrace.react-execution-rule.v1',kind:'pipeable_server_stream',element_argument:0,options_argument:1,
 callback_timing:'asynchronous',result:'object',pipe_count:1,pipe_result:'destination',abort:'forward_reason',shell_callback:'shell',all_callback:'all_tasks',callback_arguments:[],effects:'none'};
serverApis.renderToReadableStream.execution={schema:'producttrace.react-execution-rule.v1',kind:'readable_server_stream',element_argument:0,options_argument:1,
 callback_timing:'synchronous',result:'object',resolve_at:'shell',all_ready:'all_tasks',cancel:'abort',cancel_reason:'ignore',signal:'future_abort_event',preaborted_signal:'ignore',effects:'none'};
// The 18.3.1 legacy Node implementations both pass false to the static-markup
// response-state flag. Their browser entrypoints reject before rendering.
for(const api of ['renderToNodeStream','renderToStaticNodeStream'])serverApis[api].execution={
  schema:'producttrace.react-execution-rule.v1',kind:'legacy_server_stream',element_argument:0,options_argument:1,
  output:'hydratable',ready:'all_tasks',browser:'throw',destroy:'abort',callback_timing:'synchronous',effects:'none',result:'object'};

for(const name of ['render','hydrate','unstable_renderSubtreeIntoContainer']){
 const subtree=name==='unstable_renderSubtreeIntoContainer';
 dom[name].execution={schema:'producttrace.react-execution-rule.v1',kind:'legacy_render',argument:subtree?2:1,element_argument:subtree?1:0,
  callback_argument:subtree?3:2,parent_argument:subtree?0:null,mode:name==='hydrate'?'hydrate':'render',initial_flush:'flush_sync',updates:'schedule',
  result:'first_child_state_node',callback_receiver:'public_instance',callback_arguments:[],parent_context:subtree?'parent_instance':'none'};
}
dom.unmountComponentAtNode.execution={schema:'producttrace.react-execution-rule.v1',kind:'legacy_unmount',argument:0,
 container_node_types:[1,9,11],comment_marker:' react-mount-point-unstable ',root_kind:'legacy',flush:'flush_sync',present_result:true,absent_result:false};
dom.findDOMNode.execution={schema:'producttrace.react-execution-rule.v1',kind:'host_lookup',argument:0,
  nullish:'null',element_node_type:1,instance_source:'current_fiber',host_tags:[5,6],traversal:'depth_first',
  empty:'null',detached:'throw',portals:'include'};

react.isValidElement.execution={schema:'producttrace.react-execution-rule.v1',kind:'element_predicate',
  argument:0,input_kind:'object',exclude_null:true,marker_property:'$$typeof',marker_symbol:'react.element',
  comparison:'strict_equal',result:'boolean',property_access:'ordinary_get'};

for(const api of ['createRef','useRef'])react[api].execution={schema:'producttrace.react-execution-rule.v1',kind:'ref_cell',
  allocation:api==='createRef'?'per_call':'mounted_hook',initial:api==='createRef'?'null':'argument',argument:0,
  property:'current',function_input:'store',write_scheduling:'none',sealed:{development:api==='createRef',production:false}};

for(const api of ['useState','useReducer'])react[api].execution={
  schema:'producttrace.react-execution-rule.v1',kind:'state_queue',
  initial_argument:api==='useState'?0:1,initializer_argument:api==='useState'?0:2,
  initializer_mode:api==='useState'?'if_function':'if_provided',
  update_mode:api==='useState'?'functional_or_replace':'reducer',reducer_argument:api==='useState'?null:0,
  owner:'mounted_hook',comparison:'Object.is',queue_order:'dispatch_order',priority:'lane_rebase',
  dispatch_identity:'stable_per_mount',commit:'successful_render_only',
  calculation_error:'propagate_without_commit',unmounted_dispatch:'ignore_without_commit',
  strict_mode:'development_replay',
};

react.useMemo.execution = {
  schema:'producttrace.react-execution-rule.v1',kind:'memo_value',callback_argument:0,
  dependencies_argument:1,owner:'mounted_hook',comparison:'Object.is',result:'cached_value',
};

react.useImperativeHandle.execution={schema:'producttrace.react-execution-rule.v1',kind:'imperative_handle',
  ref_argument:0,factory_argument:1,dependencies_argument:2,phase:'layout',skip_null_ref:true,
  include_ref_dependency:true,comparison:'Object.is',object_property:'current',cleanup_value:'null',
  strict_mount_rehearsal:true,callback_ref_return:'ignore'};

react.forwardRef.execution={schema:'producttrace.react-execution-rule.v1',kind:'component_wrapper',allocation:'per_call',
  marker:'react.forward_ref',component_argument:0,component_field:'render',compare_argument:null,compare_field:null,
  missing_compare:'null',callbacks_at_creation:'none',render_ref:{argument:1,field:'ref',fiber_tag:11}};
react.memo.execution={schema:'producttrace.react-execution-rule.v1',kind:'component_wrapper',allocation:'per_call',
  marker:'react.memo',component_argument:0,component_field:'type',compare_argument:1,compare_field:'compare',
  missing_compare:'null',callbacks_at_creation:'none',render_ref:null};

react.useDeferredValue.execution={schema:'producttrace.react-execution-rule.v1',kind:'deferred_value',owner:'mounted_hook',
  value_argument:0,comparison:'Object.is',mount:'input',urgent:'previous',nonurgent:'input',schedule_changed:true};

react.useTransition.execution={schema:'producttrace.react-execution-rule.v1',kind:'transition_hook',owner:'mounted_hook',
  pending_index:0,start_index:1,retain_start:true,start_rule:{...react.startTransition.execution}};

react.useId.execution={schema:'producttrace.react-execution-rule.v1',kind:'id_allocation',owner:'mounted_hook',
  retain_on_update:true,client_marker:'r',server_marker:'R',local_marker:'H',separator:':',radix:32};

react.useSyncExternalStore.execution={schema:'producttrace.react-execution-rule.v1',kind:'external_store',
  subscribe_argument:0,snapshot_argument:1,server_snapshot_argument:2,subscription_phase:'passive',
  comparison:'Object.is',resubscribe:'subscribe_identity',strict_mount_rehearsal:true,
  snapshot_throw:'request_update',notification_arguments:'ignored'};

for(const [api,mode] of [['createContext','create'],['useContext','read']])react[api].execution={
  schema:'producttrace.react-execution-rule.v1',kind:'context_binding',mode,default_argument:0,
  matching:'identity',selection:'nearest',undefined_provider:'value',function_value:'store',change_comparison:'Object.is'};

for (const [api,phase,rehearsal] of [['useEffect','passive',true],['useLayoutEffect','layout',true],['useInsertionEffect','insertion',false]]) {
  react[api].execution={schema:'producttrace.react-execution-rule.v1',kind:'commit_effect',
    callback_argument:0,dependencies_argument:1,owner:'mounted_hook',comparison:'Object.is',
    result:'cleanup_or_void',phase,strict_mount_rehearsal:rehearsal};
}

// Construction and renderer consumption are separate steps. Fragment passes
// its children directly to the reconciler; the other boundaries retain props.
// These tags and mode bits are pinned to the attested React DOM 18.3.1 renderer.
for(const [api,marker] of Object.entries({Fragment:'react.fragment',StrictMode:'react.strict_mode',Profiler:'react.profiler',Suspense:'react.suspense'})) {
  react[api].execution={schema:'producttrace.react-execution-rule.v1',kind:'boundary_type',value_type:'symbol',marker,
    element_marker:'react.element',type_property:'type',construction_invokes:false,child_inputs:api==='Suspense'?['children','fallback']:['children'],
    renderer:{tag:{Fragment:7,StrictMode:8,Profiler:12,Suspense:13}[api],input:api==='Fragment'?'children':'props',
      selection:api==='Suspense'?'suspense_state':'children',strict_render_mask:api==='StrictMode'?8:0,strict_effect_mask:api==='StrictMode'?16:0},
    fragment:api==='Fragment'?{key_match:'key_or_index',type_tag:7,ref:'ignore',extra_props:'ignore'}:null,
    profiler:api==='Profiler'?{callback:'onRender',phase:'layout_commit',profile_mask:2,update_mask:4,
      arguments:['id','phase','actualDuration','treeBaseDuration','actualStartTime','commitTime'],
      mount_phase:'mount',update_phase:'update',nested_phase:'nested-update',result:'ignore'}:null};
}

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
export const REACT_BEHAVIORS_18 = freeze({ react, 'react-dom': dom,
  'react-dom/client': { createRoot: dom.createRoot, hydrateRoot: dom.hydrateRoot },
  'react-dom/server': serverApis });

// Export names alone miss behavior supplied by the renderer. These protocols
// belong in the same bank, rather than being mistaken for ordinary JS calls.
export const REACT_IMPLICIT_BEHAVIORS_18 = freeze({
  reconciliation: contract('root + parent position + key + component type', [], ['previous and next element trees'],
    ['retained or replaced component instance'], ['Replacement unmounts old effects/refs/state and initializes a new instance.'],
    ['Keys are scoped to siblings, not global entity IDs.', 'A render attempt and a committed instance are different identities.']),
  hostRef: contract('committed host element + ref identity', [callback('ref if function', 'commit', 'attach or detach', {arguments:['host node or null']})],
    ['element ref'], ['ref.current or callback ref side effects'], [],
    ['Changing callback ref identity detaches the old ref before attaching the new one.', 'React 18 clears refs with null and does not use a returned cleanup function as a React 19 ref cleanup.', 'Server rendering does not attach host refs.']),
  hostEvent: contract('rendered host control + owning React tree + event occurrence', [
    callback('props.onEventCapture', 'event capture', 'supported synthetic event dispatch', {arguments:['synthetic event']}),
    callback('props.onEvent', 'event target/bubble', 'supported synthetic event dispatch', {arguments:['synthetic event']}),
  ], ['handler props from committed tree', 'event target'], ['application callback effects'], ['Updates from handlers may be batched.'],
    ['Propagation follows React ownership through portals.', 'stopPropagation can cut off ancestors; preventDefault affects browser default behavior separately.',
      'Some events do not bubble in the same way; notably onScroll. Do not invent a universal event rule.',
      'Handler source identity alone does not distinguish controls on separate product surfaces.',
      'Hydration/event replay requires the actual committed handler and event occurrence before confirming execution.']),
});

export function getReactBehavior({ surface, exportName, version }) {
  if (version !== '18.3.1') return null;
  return REACT_BEHAVIORS_18[surface]?.[exportName] || null;
}

/** Unknown dependency values never justify borrowing a previous render's value. */
export function compareReactDependencies(previous, next) {
  if (!previous || !next) return 'invalidate';
  if (!Array.isArray(previous) || !Array.isArray(next) || previous.length !== next.length) return 'unknown';
  let unknown = false;
  for (let index = 0; index < next.length; index++) {
    const a = previous[index], b = next[index];
    if (!a || !b || a.known !== true || b.known !== true) { unknown = true; continue; }
    if (!Object.is(a.value, b.value)) return 'invalidate';
  }
  return unknown ? 'unknown' : 'equal';
}

/**
 * Apply the dependency/lifetime rules to supplied observations. This plans
 * obligations, not execution evidence: even a required setup still needs its
 * own recorded invocation before it can confirm a network or database effect.
 * Callers must supply mounted identities, never just a hook's source offset.
 */
export function planReactHookLifecycle({api, version, event, previous = null, next = null,
  environment = 'client', strictDevelopment = false}) {
  const behavior = getReactBehavior({surface:'react', exportName:api, version});
  const effects = ['useEffect','useLayoutEffect','useInsertionEffect'];
  const caches = ['useCallback','useMemo'];
  const result = (operations, frontier = null) => ({claim:'conditional_plan', runtime_observed:false, operations, frontier});
  if (!behavior || ![...effects,...caches].includes(api)) return result([], 'lifecycle_planner_api_unsupported');
  if (!['client','server'].includes(environment)) return result([], 'execution_environment_unproven');
  if (!['render','commit','unmount','abandon'].includes(event)) return result([], 'lifecycle_event_unsupported');
  if (event === 'abandon') return result([]);
  const identity = snapshot => snapshot && ['rootId','instanceId','mountId','slotId','renderId'].every(key =>
    typeof snapshot[key] === 'string' && snapshot[key].length);
  if (previous && !identity(previous) || next && !identity(next) || !previous && !next) return result([], 'mounted_hook_identity_required');
  if (previous && next && ['rootId','instanceId','mountId','slotId'].some(key=>previous[key]!==next[key])) {
    return result([], 'different_hook_lifetimes_require_separate_plans');
  }
  if (effects.includes(api)) return planEffectExecution(behavior.execution, {event,previous,next,
    environment,strictDevelopment,
    dependencyComparison:previous?compareReactDependencies(previous.dependencies,next?.dependencies):'invalidate'});
  if (event !== 'render') return result([]);
  if (!next || typeof next.callbackId !== 'string') return result([], 'next_render_callback_required');
  if (previous && previous.cacheRetained !== true) return result([], 'cache_retention_unproven');
  if (previous && (typeof previous.callbackId !== 'string' || api === 'useMemo' && typeof previous.valueId !== 'string')) return result([], 'previous_cached_value_unproven');
  const comparison = previous ? compareReactDependencies(previous.dependencies,next.dependencies) : 'invalidate';
  if (comparison === 'unknown') return result([], 'dependency_identity_unproven');
  if (comparison === 'equal') return result([{kind:'retain', callbackId:previous.callbackId,
    valueId:previous.valueId, renderId:previous.renderId}]);
  return result([{kind:api==='useMemo'?'calculate':'store',callbackId:next.callbackId,renderId:next.renderId}]);
}
