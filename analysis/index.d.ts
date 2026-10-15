export { createLibraryExecutionContext } from './library-execution-context.mjs';
export type { LibraryExecutionContext, LibraryExecutionEvent } from './library-execution-context.mjs';
import type { ReactMap } from './react-compiler.mjs';
export { createLibraryProgram, validateLibraryProgram, LIBRARY_PROGRAM_SCHEMA, LibraryProgramFrontier } from './library-program.mjs';
export type { LibraryInstruction, LibraryProgram } from './library-program.mjs';
export { createLibraryProgramBank, resolveVersionedProgram, programHash } from './library-program-bank.mjs';
export type { LibraryProgramBank, LibraryImplementation, LibraryProgramScope } from './library-program-bank.mjs';
export { createLibraryBoundary } from './library-boundary.mjs';
export { instrumentLibraryPrograms } from './library-program-integration.mjs';
export { createOwnedReferenceBoundary, createReactReferenceOwnerHost, createReactMemoOwnerHost } from './library-owned-reference.mjs';
export type { ReactMap } from './react-compiler.mjs';
export type { ReactRuntimeIntegration, ReactRuntimeJoin, ReactClassObservation, ReactClassJoin, ReactClassUpdateObservation, ReactClassUpdateJoin, ReactHostObservation, ReactHostJoin, ReactServerObservation, ReactServerJoin, ReactRootObservation, ReactRootJoin, ReactElementObservation, ReactElementJoin } from './runtime-join.mjs';
export { createReactRuntimeIntegration } from './runtime-join.mjs';
export type { ReactLifecycleObservation, ReactLifecycleJoin, ReactLifecycleOperation } from './react-lifecycle-evidence.mjs';
export { createReactLifecycleEvidenceSession, REACT_LIFECYCLE_OBSERVATION_SCHEMA,
  REACT_LIFECYCLE_JOIN_SCHEMA } from './react-lifecycle-evidence.mjs';
export { createBrowserRequestBridgeSource, BROWSER_REQUEST_BRIDGE_SCHEMA } from './browser-request-bridge.mjs';
export type { BackendRoute, BackendRouteFrontier, BackendRouteMap } from './backend-routes.mjs';
export { compileBackendRoutes, BACKEND_ROUTE_SCHEMA } from './backend-routes.mjs';
export type { RequestCandidateOrObservation, RequestRouteJoin } from './request-route-match.mjs';
export { matchRequestToRoute, REQUEST_ROUTE_JOIN_SCHEMA } from './request-route-match.mjs';
export type { HttpRequestObservation, RequestHandlerBridge } from './request-handler-bridge.mjs';
export { connectRequestToHandler, REQUEST_HANDLER_BRIDGE_SCHEMA } from './request-handler-bridge.mjs';
export { confirmBackendExecution, BACKEND_EXECUTION_SPAN_SCHEMA } from './backend-execution.mjs';
export type { ReactApiRecord, ReactPackageAttestation, ReactSemanticDisposition, ReactSurface } from './react-semantics.mjs';
export { REACT_BEHAVIORS_18, REACT_IMPLICIT_BEHAVIORS_18, getReactBehavior, compareReactDependencies, planReactHookLifecycle } from './react-behavior.mjs';
export type { ReactBehavior, ReactCallbackBehavior } from './react-behavior.mjs';
export { REACT_API_INVENTORY, REACT_PACKAGE_ATTESTATIONS, getReactApiRecord,
  reactPackageAttestation, reactSemanticPackages } from './react-semantics.mjs';

interface Limits {
  /** Maximum source files; default 5000. Omitted files produce diagnostics. */
  maxFiles?: number;
  /** Maximum total source bytes; default 20 MiB. */
  maxBytes?: number;
}

export type AnalyzeReactOptions = Limits & (
  | { files: Record<string, string>; repository?: never; include?: never }
  | { repository: string; files?: never; include?: string[] }
);

export type ReactAnalysis = ReactMap & {
  input: {
    mode: 'snapshot' | 'repository';
    /** Whether the selected input was read without a gap, not React/source completeness. */
    complete: boolean;
    file_count: number;
    byte_count: number;
    limits: { maxFiles: number; maxBytes: number };
    exclusions: string[];
  };
};

/** Read-only, deterministic source analysis. Never executes the target application. */
export function analyzeReact(options: AnalyzeReactOptions): ReactAnalysis;

export type AnalyzeBackendRoutesOptions = Limits & { serviceId?: string } & (
  | { files: Record<string, string>; repository?: never; include?: never }
  | { repository: string; files?: never; include?: string[] }
);

export type BackendRouteAnalysis = import('./backend-routes.mjs').BackendRouteMap & {
  input: {
    mode: 'snapshot' | 'repository'; complete: boolean; file_count: number; byte_count: number;
    limits: { maxFiles: number; maxBytes: number }; exclusions: string[];
  };
};

export function analyzeBackendRoutes(options: AnalyzeBackendRoutesOptions): BackendRouteAnalysis;

export { createOwnedValueBoundary } from './library-owned-value.mjs';

export {createHostEventBoundary} from './library-host-events.mjs';
export {createReactEffectEventHost} from './library-react-effect-host.mjs';
