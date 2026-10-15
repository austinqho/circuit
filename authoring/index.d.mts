import type { LibraryImplementation, LibraryProgramBank, LibraryProgramScope } from '../analysis/library-program-bank.mjs';
import type { LibraryProgram } from '../analysis/library-program.mjs';
export function createLibraryProgramVerifier(options: {
  scope: LibraryProgramScope;
  behavior(candidate: { implementation: LibraryImplementation; program: LibraryProgram; scope: LibraryProgramScope }): Promise<Record<string, any>>;
  integration(candidate: { implementation: LibraryImplementation; program: LibraryProgram; scope: LibraryProgramScope }): Promise<Record<string, any>>;
}): (candidate: { implementation: LibraryImplementation; program: LibraryProgram; scope: LibraryProgramScope }) => Promise<Record<string, any>>;
export function readLibraryImplementation(options: { repository: string; specifier: string; exportName: string }): LibraryImplementation;
export function resolveLibraryProgram(options: {
  repository: string; specifier: string; exportName: string; catalogs?: any[]; bank: LibraryProgramBank;
  scope?: LibraryProgramScope; provider?: LibraryModelProvider; mode?: 'bank_first' | 'unfamiliar_only'; compatibility?: 'reject' | 'verify';
  maxAttempts?: number; onAttempt?: (attempt: Record<string, unknown>) => void | Promise<void>;
  previousProposal?: unknown; expectedImplementationSha256?: string;
}): Promise<Record<string, any>>;
export interface LibraryModelProvider {
  generate(request: { system: string; input: string; schema: unknown; maxOutputTokens: number; timeoutMs: number }): Promise<{
    proposal: unknown; cost_usd?: number | null; usage?: unknown; latency_ms?: number;
  }>;
  maximumRequestCostUsd?(inputBytes: number, maxOutputTokens: number): number | null;
}
export function authorLibraryProgram(options: {
  implementation: LibraryImplementation; scope: LibraryProgramScope; bank: LibraryProgramBank; provider: LibraryModelProvider;
  maxAttempts?: number; maxOutputTokens?: number; onAttempt?: (attempt: Record<string, unknown>) => void | Promise<void>;
  previousProposal?: unknown;
}): Promise<{ status: 'admitted' | 'frontier'; program?: LibraryProgram; reason?: string; attempts: Array<Record<string, unknown>>; [key: string]: unknown }>;
export const LIBRARY_PROGRAM_AUTHOR_PROMPT: string;
export const LIBRARY_PROGRAM_PROPOSAL_SCHEMA: Record<string, unknown>;
export function portableImplementation(context: Record<string, any>): Record<string, any>;
export function programOverrides(base: LibraryProgram, target: LibraryProgram): Array<{ path: Array<string | number>; value: unknown }>;
export function admitCatalogProgram(options: { skeleton: any; implementation: LibraryImplementation; bank: LibraryProgramBank }): Promise<Record<string, any>>;
export function readCatalogImplementation(options: { repository: string; specifier: string; exportName: string; skeleton: any }): LibraryImplementation;
export function createModelProvider(options: { provider: 'openai' | 'anthropic' | 'gemini'; model: string; apiKey: string;
  reasoningEffort?: string; fetchImpl?: typeof fetch }): LibraryModelProvider;
export function maximumRequestCostUsd(provider: string, model: string, inputBytes: number, maxOutputTokens: number): number | null;
export function usageCostUsd(provider: string, model: string, usage: unknown): number | null;
export class SpendLedger {
  constructor(file: string);
  resume(options: { authorization: string; deadlineAt: string }): void;
  reserve(maximum: number, label: string): string;
  settle(id: string, actual: number | null): void;
  outcome(passed: boolean, reason: string): void;
  wrap(provider: LibraryModelProvider, label: string): LibraryModelProvider;
}

export interface LibraryInputExperiment {
  id: string;
  roots: Array<{args: unknown[]; receiver?: unknown}>;
  calls?: Array<{root: number; args: unknown[]; receiver?: unknown}>;
}
export function createLibraryExperimentVerifier(options: {
  repository: string; scope: LibraryProgramScope; makeExperiments(inputs: {dataFunction(result?: unknown): Function}): LibraryInputExperiment[];
}): ReturnType<typeof createLibraryProgramVerifier>;
