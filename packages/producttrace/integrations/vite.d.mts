import type { Plugin } from 'vite';

export interface ProductTraceViteOptions {
  repository: string;
  service: string;
  /** Required unless `requestBridge` is false. */
  bridgeEndpoint?: string;
  /**
   * Static-era request bridge. Default true. Set false for frontend-only
   * installs: the attribution runtime's own fetch/XHR/EventSource/WebSocket
   * wrappers then emit every network.request row.
   */
  requestBridge?: boolean;
  /** Element stamps (`data-tracer-el`). Default true. */
  stamps?: boolean;
  /**
   * Declarative OpenAI annotation attributes on stamped elements. 'detect'
   * (default) writes them only when document.oai.annotation exists; 'always'
   * is a dev-only opt-in; 'never' disables them.
   */
  oaiAttributes?: 'detect' | 'always' | 'never';
  /**
   * Dev builds: ship every runtime row to a `producttrace-collector --store`
   * at `<collector>/ingest` (an http(s) URL or a root-relative path). Absent:
   * rows stay in the page (`__productTraceRuntime.records`). Localhost-only
   * unless `allowRemote: true`; no sink in a Vite `production`-mode build
   * unless `force: true`.
   */
  collector?: string | { url: string; allowRemote?: boolean; force?: boolean };
  /**
   * Request/response bodies as `network.body` rows. Default (true): on in dev
   * builds (Vite mode !== 'production'), off in production-mode builds.
   * 'always' keeps them in a production build (with a warning); false turns
   * them off. JSON and text/* only, 4 KB per body, JSON keys matching
   * pass|secret|token|auth|cookie|session|credential|ssn|card redacted in the page.
   */
  bodies?: boolean | 'always';
  /**
   * Typed text on dom.action rows (InputEvent/CompositionEvent `data`, printable
   * key and code). Default false: inputType, data_length and credential_field
   * only; printable keys read "Printable". true: on in non-production builds
   * only (warned at build); password and credential fields always redacted.
   */
  inputText?: boolean;
  /** Deployed backend entrypoint, used only to distinguish multiple server applications. */
  backendEntrypoint?: string;
  name?: string;
  configPath?: string;
  maxFiles?: number;
  maxBytes?: number;
  /** Optional raw runtime-attribution manifest path for first-party functions and imports. */
  attributionManifestPath?: string;
}

export declare function productTraceVitePlugin(options: ProductTraceViteOptions): Plugin;

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

export interface ProductTraceOptions extends Partial<ProductTraceViteOptions> {
  /** Install the post-transform runtime-attribution plugin (default true). */
  runtimeAttribution?: boolean;
  firstParty?: FirstPartyOptions;
}

/** One-line installation: `plugins: [...producttrace(), react()]`. */
export declare function producttrace(options?: ProductTraceOptions): Plugin[];
