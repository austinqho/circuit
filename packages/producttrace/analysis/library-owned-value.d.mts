import type {LibraryExecutionContext} from './library-execution-context.mjs';
import type { LibraryProgram } from './library-program.mjs';
export interface OwnedValueReport {
  status: 'observed_agreement' | 'frontier'; observation_mode: 'owned_values'; calls: number; owners: number; generations: number;
  failures: Array<{ occurrence: string; reason: string }>;
  reports: Array<Record<string, unknown>>; evidence: Array<Record<string, unknown>>;
}
export function createOwnedValueBoundary(options: {
  producer: Function; program: LibraryProgram; executionContext?: LibraryExecutionContext; executionSource?: Record<string,unknown>; captureOwner(args: unknown[]): object | null;
  captureGeneration?(args: unknown[]): object | null; callbackArguments?: number[]; dataReadEvidence?: boolean; accessorObservation?: 'reject' | 'opaque_descriptors'; occurrencePrefix?: string;
}): {
  invoke(args: unknown[], options?: { receiver?: unknown }): unknown;
  checkpoint(): OwnedValueReport;
};
