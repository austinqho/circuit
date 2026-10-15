import type { LibraryProgram } from './library-program.mjs';
export interface LibraryProgramScope {
  callbackArguments: number[]; returnedCallbackArguments?: number[]; resultPaths: Array<Array<string | number>> | null; description?: string;
  dataReadEvidence?: boolean; resultMethods?: Array<{path: Array<string | number>; callbackArguments: number[]}>;
  ownerGeneration?: 'host';
  eventLayout?: {callbackArguments:number[];nullableCallbackArguments?:number[];callbackReturnArguments?:number[];stableCallbackArguments?:number[];objectRefArguments?:number[];dependencyArgument:number};
  hostProtocol?: 'react_effect_lifecycle';
  hostPhase?: 'passive' | 'layout' | 'insertion';
  protocol?: 'owned_returned_reference' | 'owned_call_boundary' | 'host_event_boundary' | 'react_state_queue';
  api?: 'useState' | 'useReducer';
  errorObservation?: 'identity' | 'standard_error_without_stack';
  accessorObservation?: 'reject' | 'opaque_descriptors';
  nestedReferences?: boolean;
  resultIdentityPaths?: Array<Array<string | number>>;
  observationMode?: 'references' | 'invocations';
}
export interface LibraryImplementation {
  producer: Function; sha256: string; unchanged(): boolean;
  context: { source_status: string; specifier: string; export_name: string; [key: string]: unknown };
}
export interface LibraryProgramCheck { status: string; reason?: string | null; stage?: string; [key: string]: unknown }
export interface LibraryProgramBank {
  verify(options: { implementation: LibraryImplementation; program: LibraryProgram; scope: LibraryProgramScope }): Promise<LibraryProgramCheck>;
  admit(options: { implementation: LibraryImplementation; program: LibraryProgram; scope: LibraryProgramScope }): Promise<LibraryProgramCheck>;
  lookup(specifier: string, exportName: string): null | {
    id: string; program: LibraryProgram; scope: LibraryProgramScope; producer: Function;
    program_sha256: string; implementation_sha256: string;
  };
}
export function createLibraryProgramBank(options: {
  check: (options: { implementation: LibraryImplementation; program: LibraryProgram; scope: LibraryProgramScope }) => Promise<LibraryProgramCheck>;
}): LibraryProgramBank;
export function programHash(value: unknown): string;
export function resolveVersionedProgram(skeleton: unknown, version: string):
  | { status: 'frontier'; reason: string; errors?: string[] }
  | { status: 'resolved_program'; program: LibraryProgram; sha256: string; verification: unknown };
