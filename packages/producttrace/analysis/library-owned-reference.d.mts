import type {LibraryExecutionContext} from './library-execution-context.mjs';
import type { LibraryProgram } from './library-program.mjs';
export interface OwnedReferenceReport {
  status: 'frontier' | 'observed_agreement'; observation_mode: 'owned_references'; calls: number;
  failures: Array<{ occurrence: string; reason: string }>;
  evidence: Array<{ schema: 'producttrace.library-owned-reference.v1'; occurrence: string; execution_id: string | null; owner: string; value: string;
    sources: string[]; kind: 'returned_callback_reference'; reason: string }>;
}
export function createOwnedReferenceBoundary(options: { producer: Function; program: LibraryProgram; executionContext?: LibraryExecutionContext; executionSource?: Record<string,unknown>;
  captureOwner(): object; occurrencePrefix?: string }): {
  invoke(args: unknown[], options?: { receiver?: unknown; callbackIds?: Record<number, string> }): unknown;
  checkpoint(): OwnedReferenceReport;
};
export function createReactReferenceOwnerHost(React: { version: string; useRef(value: unknown): object }): { captureOwner(): object };

export function createReactMemoOwnerHost(React: {version: string; useRef: Function; useMemo: Function}): {captureOwner(): object; captureGeneration(args: unknown[]): object};
