export const LIBRARY_PROGRAM_SCHEMA: 'producttrace.library-program.v1';
export type LibraryInstruction =
  | { op: 'literal'; value: string | number | boolean | null }
  | { op: 'undefined' | 'args' | 'receiver' }
  | { op: 'symbol'; key: string }
  | { op: 'arg'; index: number }
  | { op: 'local'; name: string }
  | { op: 'get'; value: LibraryInstruction; key: string | number }
  | { op: 'array' | 'concat'; items: LibraryInstruction[] }
  | { op: 'object'; entries: Record<string, LibraryInstruction> }
  | { op: 'type' | 'is_array' | 'not' | 'seal' | 'freeze' | 'keys' | 'string'; value: LibraryInstruction }
  | { op: 'lookup' | 'has_own'; value: LibraryInstruction; key: LibraryInstruction }
  | { op: 'put'; value: LibraryInstruction; key: LibraryInstruction; item: LibraryInstruction }
  | { op: 'frontier'; reason: string }
  | { op: 'same' | 'equal' | 'number_add'; left: LibraryInstruction; right: LibraryInstruction }
  | { op: 'at'; value: LibraryInstruction; index: LibraryInstruction }
  | { op: 'every'; items: LibraryInstruction; value_name: string; index_name: string; test: LibraryInstruction }
  | { op: 'if'; test: LibraryInstruction; then: LibraryInstruction; else: LibraryInstruction }
  | { op: 'bind'; name: string; value: LibraryInstruction; body: LibraryInstruction }
  | { op: 'set'; name: string; value: LibraryInstruction }
  | { op: 'sequence'; steps: LibraryInstruction[] }
  | { op: 'fn'; this_mode: 'strict' | 'sloppy' | 'lexical'; body: LibraryInstruction }
  | { op: 'call'; target: LibraryInstruction; receiver: LibraryInstruction; args: LibraryInstruction }
  | { op: 'slice'; value: LibraryInstruction; start: number }
  | { op: 'defer'; body: LibraryInstruction }
  | { op: 'make_error'; name: 'Error' | 'TypeError' | 'RangeError' | 'SyntaxError'; message: LibraryInstruction }
  | { op: 'throw'; value: LibraryInstruction };
export interface LibraryProgram { schema: typeof LIBRARY_PROGRAM_SCHEMA; body: LibraryInstruction }
export function validateLibraryProgram(program: unknown): { valid: boolean; errors: string[]; diagnostics?: {reason: string; path: string; name: string | null; in_scope: string[]}[] };
export function requiresInvocationObservation(program: LibraryProgram): boolean;
export class LibraryProgramFrontier extends Error { constructor(reason: string) }
export function isLibraryProgramErrorPrediction(value: unknown): boolean;
export function createLibraryProgram(program: LibraryProgram, options?: {
  callbacks?: Function[]; maxSteps?: number; schedule?: (work: () => void) => void;
  /** Trusted debugging hook. Contains live operands; never enable for untrusted consumers. */
  onRead?: (read: {path: string; op: 'get' | 'lookup'; container: unknown; key: string | number; value: unknown}) => void;
  onDecision?: (decision: { path: string; op: 'same' | 'equal' | 'if'; operands: unknown[]; result: boolean }) => void;
}): { invoke(args: unknown[], receiver?: unknown): unknown; canInvoke(target: unknown): boolean; invokeCallable(target: Function, args: unknown[], receiver?: unknown): unknown; grantCallback(callback: Function): void; readonly remainingSteps: number };
