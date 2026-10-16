import type {LibraryExecutionContext} from './library-execution-context.mjs';
import type { LibraryProgram } from './library-program.mjs';
export interface LibraryBoundaryEvidence {
  schema: 'producttrace.library-boundary-evidence.v1'; execution_id?: string; occurrence: string; callback?: string; value?: string;
  kind: 'callback_reference' | 'callback_invocation' | 'result_identity' | 'rule_data_read' | 'returned_method_invocation';
  registered_occurrence?: string; invocation_source?: Record<string, unknown> | null;
  program_path?: string; operation?: 'get' | 'lookup'; input_paths?: Array<Array<string | number>>;
  value_kind?: string; matches_predicted_result?: boolean;
  ordinal?: number; parent_ordinal?: number | null; parent_relation?: 'synchronous' | 'async_continuation' | null; timing?: 'synchronous' | 'deferred'; status: 'frontier' | 'observed_agreement';
  outcome?: 'return' | 'throw' | 'incomplete'; result_path?: Array<string | number>; input_path?: Array<string | number>; reason: string;
}
export interface LibraryBoundaryReport {
  status: 'frontier' | 'observed_agreement'; scope: 'observations_through_checkpoint'; observation_mode: 'references' | 'invocations'; calls: number;
  error_observation: 'identity' | 'standard_error_without_stack';
  accessor_observation: 'reject' | 'opaque_descriptors';
  failures: Array<{ reason: string; occurrence: string | null; detail?: Record<string, unknown> }>; evidence: LibraryBoundaryEvidence[];
}
export function createLibraryBoundary(options: {
  executionContext?: LibraryExecutionContext | null; executionSource?: Record<string, unknown> | null;
  producer: Function; program: LibraryProgram; callbackArguments?: number[];
  /** Positions on subsequently invoked returned functions, controlled by the checker. */
  returnedCallbackArguments?: number[];
  /** Direct own methods on returned objects; requires instrumented member calls. */
  resultMethods?: Array<{path: Array<string | number>; callbackArguments: number[]}>;
  resultPaths?: Array<Array<string | number>> | null;
  /** Opaque result-object aliases; does not inspect unprojected fields. */
  resultIdentityPaths?: Array<Array<string | number>>; onEvidence?: (evidence: LibraryBoundaryEvidence) => void;
  maxSteps?: number; occurrencePrefix?: string; observationMode?: 'references' | 'invocations';
  errorObservation?: 'identity' | 'standard_error_without_stack';
  accessorObservation?: 'reject' | 'opaque_descriptors';
  nestedReferences?: boolean;
  /** Record executed input data reads without storing their values. */
  dataReadEvidence?: boolean;
  /** Opt-in synthetic-test counterexamples; ordinary runtime evidence omits input values. */
  diagnosticInputs?: boolean;
  /** Value mode preserves function-valued results of the private returned-call protocol. */
  returnedResultMode?: 'invoke' | 'value';
  onOccurrence?: (event: {occurrence: string; label: string}) => void;
}): { markMemberAmbiguous(receiver: object, key: string | number): void;
  prepareMember(receiver: unknown, key: string | number, producer: unknown, source?: Record<string, unknown> | null): ((...args: unknown[]) => unknown) | null;
  invoke(args: unknown[], options?: { receiver?: unknown; callbackIds?: Record<number, string> }): unknown;
  checkpoint(): LibraryBoundaryReport };
