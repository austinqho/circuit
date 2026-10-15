// Manually transcribed creation-only programs. These are never proposal context.
const arg = index => ({ op: 'arg', index });
const literal = value => ({ op: 'literal', value });
const symbol = key => ({ op: 'symbol', key });
const object = entries => ({ op: 'object', entries });
const root = { op: 'local', name: 'context' };
const write = (key, item) => ({ op: 'put', value: root, key: literal(key), item });
export function reactContextScope(version) {
  return { callbackArguments: [], resultPaths: [['$$typeof'], ['_currentValue'], ['_currentValue2'], ['Provider','$$typeof'], ['Consumer','$$typeof']],
    resultIdentityPaths: [[], ['Provider'], ['Consumer'], ['Consumer','_context'], ...(version.startsWith('18.') ? [['Provider','_context']] : [])],
    description: 'Context creation only: initial default value identity in both renderer slots, marker tags, and exact context/Provider/Consumer object relationships. Unprojected warning accessors and renderer metadata, later Provider updates and Consumer execution require separate evidence. Defaults are primitives or ordinary own-data values; no callback is executed by creation.' };
}
export function reactContextProgram(version) {
  const old = version.startsWith('18.');
  return { schema: 'producttrace.library-program.v1', body: { op: 'bind', name: 'context', value: object({
    $$typeof: symbol('react.context'), _currentValue: arg(0), _currentValue2: arg(0),
  }), body: { op: 'sequence', steps: [
    write('Provider', old ? object({ $$typeof: symbol('react.provider'), _context: root }) : root),
    write('Consumer', object({ $$typeof: symbol(old ? 'react.context' : 'react.consumer'), _context: root })), root,
  ] } } };
}
