export interface LibraryExecutionEvent {
  id: string; kind: 'library_invocation' | 'callback_invocation'; occurrence: string;
  parent_id: string | null; parent_relation: 'synchronous' | 'async_continuation' | null;
  callback?: string; ordinal?: number; source?: Record<string, unknown>;
  outcome: 'incomplete' | 'return' | 'throw';
}
export interface LibraryExecutionContext {
  run<T>(event: {kind: LibraryExecutionEvent['kind']; occurrence: string; callback?: string; ordinal?: number; source?: Record<string, unknown>}, work: (event: LibraryExecutionEvent | null) => T): T;
  current(): LibraryExecutionEvent | null;
  checkpoint(): {status: 'frontier' | 'observed_execution'; reason: string | null; scope: string; events: LibraryExecutionEvent[]};
}
export function createLibraryExecutionContext(options?: {prefix?: string; maxEvents?: number}): LibraryExecutionContext;
