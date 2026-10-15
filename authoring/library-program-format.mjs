import { LIBRARY_PROGRAM_SYNTAX } from '../analysis/library-program-syntax.mjs';
// Provider transport uses a recursive JSON schema. Object properties travel as
// key/value pairs because strict provider schemas require fixed object fields.
// Decoding changes representation only; admission still validates the program.
const instruction = { $ref: '#/$defs/instruction' };
const list = { type: 'array', items: instruction };
const string = { type: 'string' }, integer = { type: 'integer' };
const shape = properties => ({ type: 'object', additionalProperties: false,
  properties, required: Object.keys(properties) });
const kinds = {
  instruction, instructions: list, string, integer,
  literal: { type: ['string', 'number', 'boolean', 'null'] },
  property_key: { type: ['string', 'integer'] },
  entries: { type: 'array', items: shape({ key: string, value: instruction }) },
  receiver_mode: { type: 'string', enum: ['strict', 'sloppy', 'lexical'] },
  error_name: { type: 'string', enum: ['Error', 'TypeError', 'RangeError', 'SyntaxError'] },
};
const operations = Object.fromEntries(Object.entries(LIBRARY_PROGRAM_SYNTAX).map(([op, fields]) => [op,
  Object.fromEntries(Object.entries(fields).map(([key, kind]) => {
    if (!Object.hasOwn(kinds, kind)) throw new Error('unknown_program_field_kind');
    return [key, kinds[kind]];
  })),
]));
export const STRUCTURED_PROGRAM_PROPOSAL_SCHEMA = {
  ...shape({
    schema: { type: 'string', const: 'producttrace.library-program-proposal.v2' },
    status: { type: 'string', enum: ['propose', 'abstain'] },
    program: { anyOf: [shape({ schema: { type: 'string', const: 'producttrace.library-program.v1' }, body: instruction }), { type: 'null' }] },
    reason: string,
  }),
  $defs: { instruction: { anyOf: Object.entries(operations).map(([op, fields]) => shape({ op: { type: 'string', const: op }, ...fields })) } },
};

export function decodeStructuredProgram(program) {
  let count = 0;
  const decode = (node, depth = 0) => {
    if (++count > 4096 || depth > 64) throw new TypeError('transport_size_limit');
    if (node === null || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map(value => decode(value, depth + 1));
    if (node.op === 'object' && Array.isArray(node.entries)) {
      const seen = new Set();
      const entries = node.entries.map(entry => {
        if (!entry || typeof entry.key !== 'string' || seen.has(entry.key)
          || Object.keys(entry).sort().join(',') !== 'key,value') throw new TypeError('transport_object_entries');
        seen.add(entry.key);
        return [entry.key, decode(entry.value, depth + 1)];
      });
      return { ...node, entries: Object.fromEntries(entries) };
    }
    return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, decode(value, depth + 1)]));
  };
  return decode(program);
}
