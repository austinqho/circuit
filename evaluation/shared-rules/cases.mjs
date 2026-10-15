import {childrenTraversalScope} from './children-traversal-scope.mjs';
// Independent experiment selection. Models receive the declared domain but not
// the stimuli, assertions, calibration programs, or mutation tests in this file.
export const CASES = [
  {id:'lodash417-castArray',specifier:'lodash417/castArray',exportName:'default',profile:'plain_value',experiment:'plain_values',calibration:'castArray'},
  {id:'lodash417-identity',specifier:'lodash417/identity',exportName:'default',profile:'plain_value',experiment:'plain_values',calibration:'identityValue'},
  {id:'lodash417-constant',specifier:'lodash417/constant',exportName:'default',profile:'constant_value',calibration:'constantValue'},
  {id:'lodash417-negate',specifier:'lodash417/negate',exportName:'default',profile:'negated_callback',calibration:'negate'},
  {id:'react18-children-count',specifier:'react18',exportName:'Children.count',profile:'react_children_count',calibration:'reactChildrenCount18'},
  {id:'react19-children-forEach',specifier:'react19',exportName:'Children.forEach',profile:'react_children_for_each',calibration:'reactChildrenForEach19'},
  ...['table8old','table8new'].map(specifier=>({id:`${specifier}-createColumnHelper`,specifier,exportName:'createColumnHelper',profile:'column_helper',calibration:'columnHelper'})),
  {id:'query5-shouldThrowError',specifier:'query5',exportName:'shouldThrowError',profile:'boolean_or_callback',calibration:'booleanOrCallback'},
  ...['react18', 'react19'].flatMap(specifier => [
    { id: `${specifier}-createRef`, specifier, exportName: 'createRef', profile: 'reference', calibration: 'createRef' },
    { id: `${specifier}-isValidElement`, specifier, exportName: 'isValidElement', profile: 'element_predicate', calibration: specifier === 'react18' ? 'isValid18' : 'isValid19' },
    { id: `${specifier}-forwardRef`, specifier, exportName: 'forwardRef', profile: 'render_descriptor', calibration: 'forwardRef' },
    { id: `${specifier}-memo`, specifier, exportName: 'memo', profile: 'memo_descriptor', calibration: 'memo' },
  ]),
  ...['table8old', 'table8new'].map(specifier => ({ id: `${specifier}-functionalUpdate`, specifier, exportName: 'functionalUpdate', profile: 'value_or_callback', calibration: 'functionalUpdate' })),
  ...['async2', 'async3'].map(specifier => ({ id: `${specifier}-apply`, specifier, exportName: 'apply', profile: 'partial_callback', calibration: specifier === 'async2' ? 'apply2' : 'apply' })),
  { id: 'once', specifier: 'once', exportName: 'default', profile: 'retained_callback', calibration: 'once' },
  { id: 'queue-microtask', specifier: 'queue-microtask', exportName: 'default', profile: 'scheduled_callback', calibration: 'microtask' },
  { id: 'table8new-flattenBy', specifier: 'table8new', exportName: 'flattenBy', profile: 'tree_traversal', calibration: 'flattenTree' },
  { id: 'memoize-one', specifier: 'memoize-one', exportName: 'default', profile: 'memoized_callback', calibration: 'memoize' },
];

export const DOMAINS = {
  plain_value:{callbackArguments:[],resultPaths:null,
    description:'Finite primitive, plain object, array and function values as data, including missing arguments and additional plain arguments. Compare complete returned values and exact input identities. No supplied function is granted invocation capability. Function properties, proxies, getters and outside writes are excluded.'},
  constant_value:{callbackArguments:[],resultPaths:null,
    description:'One finite primitive, plain object, array or function value. Observe the created function across repeated calls with changed plain arguments and receivers, and interleave independent instances. Input functions are data and must retain their exact identity without invocation. Function properties, proxies, getters, hidden comparisons against the returned library closure, and outside writes are excluded.'},
  negated_callback:{callbackArguments:[0],resultPaths:null,errorObservation:'standard_error_without_stack',
    description:'A supplied predicate function with no custom properties, or finite primitive/plain-data non-function inputs. Invoke the returned function repeatedly with finite argument lists including 0, 1, 2, 3 and more arguments; use plain-object, undefined and null receivers. Predicate results include all primitive truthiness classes and object/function values; include throws, repeated calls and distinct instances. Preserve actual argument identities. Excludes primitive receiver boxing, returned-function properties, proxies, getters and external callback-identity comparisons.'},
  react_children_count:childrenTraversalScope('count'),
  react_children_for_each:childrenTraversalScope('forEach'),
  column_helper:{callbackArguments:[],resultPaths:null,resultMethods:['accessor','display','group'].map(key=>({path:[key],callbackArguments:[]})),
    description:'A factory returning an ordinary object with directly invoked own methods accessor, display and group. Preserve the original object/method identities, accessor function identity without invoking it, fresh spread results and exact pass-through column identities. Accessor inputs are functions or ordinary primitive keys; column definitions are plain enumerable string-keyed own-data objects or nullish. Excludes getters, symbols, reserved prototype keys, extracted method calls and uninstrumented consumers.'},
  boolean_or_callback: {callbackArguments:[0],resultPaths:null,description:'A truthy/falsy ordinary value or callback, followed by an array of plain callback parameters. Observe exact spread arguments, callback receiver/count, returned identity and original throws; non-callable values are coerced to boolean without invoking callbacks. No callback-producing results or arbitrary accessors/proxies.'},
  tree_traversal: { callbackArguments: [1], resultPaths: null, description: 'Finite acyclic forests of ordinary own-data nodes in plain arrays, including empty and sparse arrays. A getChildren callback returns null, undefined or another such array. Check node/reference order, callback count/arguments/receiver, shared nodes, and callback throws. Array accessors, inherited elements, cycles and host-state mutation are outside the domain.' },
  reference: { callbackArguments: [], resultPaths: null, description: 'No arguments; fresh reference object, own data property descriptors and extensibility. No later renderer assignment is claimed.' },
  element_predicate: { callbackArguments: [], resultPaths: null, description: 'Finite primitive values and plain objects with own data properties, including symbol-tagged React elements. Excludes accessors, proxies and inherited properties.' },
  render_descriptor: { observationMode: 'references', callbackArguments: [0], resultPaths: [['$$typeof'], ['render']], description: 'Valid render functions with zero or two declared parameters. Check only the returned marker and stored render identity, and absence of callback execution during construction. Renderer execution and debug displayName behavior are outside this boundary.' },
  memo_descriptor: { observationMode: 'references', callbackArguments: [0, 1], resultPaths: [['$$typeof'], ['type'], ['compare']], description: 'Valid function components, optional comparison callback. Check returned marker and exact stored type/compare identities and no construction callback. Does not claim later renderer bailout behavior or debug displayName setters.' },
  value_or_callback: { callbackArguments: [0], resultPaths: null, description: 'Two arguments: a plain value or callback, and any finite primitive/plain data value. Include callback result identity, receiver, count, and throws.' },
  partial_callback: { callbackArguments: [0], returnedCallbackArguments: [0,1,2,3], resultPaths: null, description: 'A callback and any finite list of preset plain values; invoke the returned function repeatedly with changed values and receivers. Include callback forwarding, results, throws, interleaved instances and no idle calls. Also pass callbacks in returned-call positions 0 through 3 and observe their synchronous invocation inside the original callback, exact identities, results and throws. Observe later descendants only through the exact async context of a verified application callback; they do not become a predicted library schedule. External triggers without context remain unsupported. Returned function custom properties are outside the boundary.' },
  retained_callback: { callbackArguments: [0], resultPaths: null, description: 'A callback with no custom properties. Repeated calls to the returned function, changed arguments and receivers, independent instances, callback returns and throws. Returned function custom properties are outside the boundary.' },
  scheduled_callback: { callbackArguments: [0], resultPaths: null, description: 'One callback, normal return only. Observe immediate return, then callbacks through a host-controlled microtask checkpoint and a bounded idle window. No arbitrary future timing claim.' },
  memoized_callback: { callbackArguments: [0, 1], resultPaths: null, description: 'A result callback and optional custom argument-comparison callback. Invoke the returned function with finite primitive/plain-data arguments, changed lengths, repeated values, NaN, signed zeros, changed receivers, returns and throws, and interleaved instances. Include custom comparator truthiness, arguments, receiver, and failure recovery. Custom properties of the returned function are excluded.' },
};
