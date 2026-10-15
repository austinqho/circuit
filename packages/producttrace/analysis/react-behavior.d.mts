import type {ReactExecutionRule} from './react-execution-rule.mjs';
export interface ReactCallbackBehavior {
  readonly slot: string;
  readonly phase: string;
  readonly trigger: string;
  readonly arguments?: readonly string[];
  readonly returns?: string;
  readonly captures?: string;
  readonly retained?: boolean;
  readonly requires?: string;
  readonly receiver?: string;
}
export interface ReactBehavior {
  readonly schema: 'producttrace.react-behavior.v1';
  readonly execution?: ReactExecutionRule;
  readonly owner: string;
  readonly callbacks: readonly ReactCallbackBehavior[];
  readonly reads: readonly string[];
  readonly writes: readonly string[];
  readonly scheduling: readonly string[];
  readonly constraints: readonly string[];
  readonly members: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}
export declare const REACT_BEHAVIORS_18: Readonly<Record<string, Readonly<Record<string, ReactBehavior>>>>;
export declare const REACT_IMPLICIT_BEHAVIORS_18: Readonly<Record<string, ReactBehavior>>;
export declare function getReactBehavior(input: {surface: string; exportName: string; version: string}): ReactBehavior | null;
export declare function compareReactDependencies(previous: readonly {known: boolean; value?: unknown}[] | null | undefined,
  next: readonly {known: boolean; value?: unknown}[] | null | undefined): 'equal' | 'invalidate' | 'unknown';
export interface ReactHookSnapshot {
  rootId: string; instanceId: string; mountId: string; slotId: string; renderId: string;
  callbackId?: string; cleanupId?: string; valueId?: string;
  cleanupStatus?: 'none';
  committed?: boolean; cacheRetained?: boolean;
  dependencies?: readonly {known: boolean; value?: unknown}[] | null;
}
export declare function planReactHookLifecycle(input: {api:string; version:string;
  event:'render'|'commit'|'unmount'|'abandon'; previous?:ReactHookSnapshot|null; next?:ReactHookSnapshot|null;
  environment?:'client'|'server'; strictDevelopment?:boolean}): {
    claim:'conditional_plan'; runtime_observed:false; operations: Record<string,unknown>[]; frontier:string|null;
  };
