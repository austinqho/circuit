import type { Plugin } from 'vite';

export interface RuntimeAttributionOptions {
  /** Repository whose first-party functions are instrumented. */
  repository: string;
  /** Where the served-function manifest is written. */
  manifestPath?: string;
  /** Which repository-relative sources are first-party (instrumented). */
  firstParty?: FirstPartyOptions;
}

export interface FirstPartyOptions {
  /** Globs that are first-party even when an exclude glob matches. Default []. */
  include?: string[];
  /** Globs that are not first-party. Default: node_modules, vendor, dist, build, .git segments. */
  exclude?: string[];
}

export declare function runtimeAttributionPlugin(options: RuntimeAttributionOptions): Plugin;
