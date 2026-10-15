import {childrenTraversalProgram} from './react-children-traversal-program.mjs';
// Hand-authored local calibration programs. These are grading material and must
// never be included in an unfamiliar-case model prompt.
import { LIBRARY_PROGRAM_SCHEMA as schema } from '../../analysis/library-program.mjs';
export const p = body => ({ schema, body });
export const arg = index => ({ op: 'arg', index });
export const local = name => ({ op: 'local', name });
export const lit = value => ({ op: 'literal', value });
export const undef = { op: 'undefined' };
export const array = (...items) => ({ op: 'array', items });
export const bind = (name, value, body) => ({ op: 'bind', name, value, body });
export const call = (target, args, receiver = undef) => ({ op: 'call', target, args, receiver });
export const same = (left, right) => ({ op: 'same', left, right });
export const choose = (test, then, otherwise) => ({ op: 'if', test, then, else: otherwise });
export const field = (value, key) => ({ op: 'get', value, key });
const object = entries => ({ op: 'object', entries });
export const PROGRAMS = {
  castArray:p(choose(same(field({op:'args'},'length'),lit(0)),array(),choose({op:'is_array',value:arg(0)},arg(0),array(arg(0))))),
  identityValue:p(arg(0)),
  constantValue:p(bind('value',arg(0),{op:'fn',this_mode:'strict',body:local('value')})),
  negate:p(choose(same({op:'type',value:arg(0)},lit('function')),
    bind('predicate',arg(0),{op:'fn',this_mode:'sloppy',body:{op:'not',value:call(local('predicate'),{op:'args'},{op:'receiver'})}}),
    {op:'throw',value:{op:'make_error',name:'TypeError',message:lit('Expected a function')}})),
  booleanOrCallback:p(choose(same({op:'type',value:arg(0)},lit('function')),call(arg(0),arg(1)),{op:'not',value:{op:'not',value:arg(0)}})),
  createRef: p({ op: 'seal', value: object({ current: lit(null) }) }),
  functionalUpdate: p(choose(same({ op: 'type', value: arg(0) }, lit('function')), call(arg(0), array(arg(1))), arg(0))),
  microtask: p({ op: 'defer', body: call(arg(0), array()) }),
  forwardRef: p(object({ $$typeof: { op: 'symbol', key: 'react.forward_ref' }, render: arg(0) })),
  memo: p(object({ $$typeof: { op: 'symbol', key: 'react.memo' }, type: arg(0),
    compare: choose(same(arg(1), undef), lit(null), arg(1)) })),
  isValid18: p(choose(same({ op: 'type', value: arg(0) }, lit('object')),
    choose(same(arg(0), lit(null)), lit(false), same(field(arg(0), '$$typeof'), { op: 'symbol', key: 'react.element' })), lit(false))),
  isValid19: p(choose(same({ op: 'type', value: arg(0) }, lit('object')),
    choose(same(arg(0), lit(null)), lit(false), same(field(arg(0), '$$typeof'), { op: 'symbol', key: 'react.transitional.element' })), lit(false))),
  apply: p(bind('callback', arg(0), bind('prefix', { op: 'slice', value: { op: 'args' }, start: 1 },
    { op: 'fn', this_mode: 'strict', body: call(local('callback'), { op: 'concat', items: [local('prefix'), { op: 'args' }] }) }))),
  once: p(bind('callback', arg(0), bind('called', lit(false), bind('result', undef,
    { op: 'fn', this_mode: 'sloppy', body: choose(local('called'), local('result'), { op: 'sequence', steps: [
      { op: 'set', name: 'called', value: lit(true) },
      { op: 'set', name: 'result', value: call(local('callback'), { op: 'args' }, { op: 'receiver' }) },
    ] }) })))),
};

PROGRAMS.apply2 = structuredClone(PROGRAMS.apply);
PROGRAMS.apply2.body.body.body.body.receiver = lit(null);

const equal = (left, right) => ({ op: 'equal', left, right });
const not = value => ({ op: 'not', value });
const and = (left, right) => choose(left, right, lit(false));
const args = local('newArgs'), receiver = { op: 'receiver' };
const priorItem = { op: 'at', value: local('priorArgs'), index: local('index') };
const defaultCompare = and(same(field(args, 'length'), field(local('priorArgs'), 'length')),
  { op: 'every', items: args, value_name: 'value', index_name: 'index', test:
    choose(equal(local('value'), priorItem), lit(true), and(not(equal(local('value'), local('value'))), not(equal(priorItem, priorItem)))) });
const matches = and(local('called'), and(equal(receiver, local('priorThis')),
  choose(same(local('compare'), undef), defaultCompare, call(local('compare'), array(args, local('priorArgs'))))));
const fresh = bind('next', call(local('resultFn'), args, receiver), { op: 'sequence', steps: [
  { op: 'set', name: 'priorResult', value: local('next') },
  { op: 'set', name: 'called', value: lit(true) },
  { op: 'set', name: 'priorThis', value: receiver },
  { op: 'set', name: 'priorArgs', value: args }, local('priorResult'),
] });
PROGRAMS.memoize = p(bind('resultFn', arg(0), bind('compare', arg(1), bind('priorThis', undef,
  bind('priorArgs', array(), bind('priorResult', undef, bind('called', lit(false),
    { op: 'fn', this_mode: 'strict', body: bind('newArgs', { op: 'args' }, choose(matches, local('priorResult'), fresh)) })))))));


const visitNode = { op: 'sequence', steps: [
  { op: 'put', value: local('flat'), key: field(local('flat'), 'length'), item: local('node') },
  bind('children', call(local('getChildren'), array(local('node'))),
    choose(and(not(equal(local('children'), lit(null))), not(equal(local('children'), undef))),
      call(local('walk'), array(local('children'))), undef)),
  lit(true),
] };
PROGRAMS.flattenTree = p(bind('getChildren', arg(1), bind('flat', array(), bind('walk', undef, { op: 'sequence', steps: [
  { op: 'set', name: 'walk', value: { op: 'fn', this_mode: 'strict', body: {
    op: 'every', items: arg(0), value_name: 'node', index_name: 'index', test: choose({ op: 'has_own', value: arg(0), key: local('index') }, visitNode, lit(true)),
  } } },
  call(local('walk'), array(arg(0))), local('flat'),
] }))));

const copyColumn=choose(same(arg(1),undef),undef,choose(same(arg(1),lit(null)),undef,
  {op:'every',items:{op:'keys',value:arg(1)},value_name:'key',index_name:'index',test:{op:'sequence',steps:[
    {op:'put',value:local('column'),key:local('key'),item:{op:'lookup',value:arg(1),key:local('key')}},lit(true),
  ]}}));
PROGRAMS.columnHelper=p(object({
  accessor:{op:'fn',this_mode:'strict',body:bind('column',object({}),{op:'sequence',steps:[
    copyColumn,{op:'put',value:local('column'),key:choose(same({op:'type',value:arg(0)},lit('function')),lit('accessorFn'),lit('accessorKey')),item:arg(0)},local('column'),
  ]})},
  display:{op:'fn',this_mode:'strict',body:arg(0)},group:{op:'fn',this_mode:'strict',body:arg(0)},
}));

PROGRAMS.reactChildrenForEach19=childrenTraversalProgram('19.1.1','forEach');

PROGRAMS.reactChildrenCount18=childrenTraversalProgram('18.3.1','count');
