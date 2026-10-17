export interface ProductTraceNextOptions {
  /** The analyzed repository. Default: nearest ancestor of the working directory containing `.git`. */
  repository?: string;
  /** Repository-relative globs deciding which sources are instrumented (see `producttrace/vite`). */
  firstParty?: { include?: string[]; exclude?: string[] };
  /**
   * Left out, `next dev` runs a collector itself on 127.0.0.1 (store under
   * `node_modules/.producttrace/store`) and prints the live story's URL. `false` records nothing outside the page; a URL sends
   * rows to a collector you run.
   */
  collector?: string | false | { url: string; allowRemote?: boolean; force?: boolean };
  /** Typed text on dom.action rows. Default false; password and credential fields are always redacted. */
  inputText?: boolean;
  /** Control labels (button/link text, field labels). Default true. */
  labels?: boolean;
  /** Request/response bodies, bounded and redacted. Default true. */
  bodies?: boolean;
  /** Element stamps (`data-tracer-el`). Default true. */
  stamps?: boolean;
}

type NextConfigContext = { defaultConfig: object };
type NextConfigFunction<C> = (phase: string, context: NextConfigContext) => C | Promise<C>;

/**
 * `export default withProducttrace(nextConfig)`. Takes the config as an
 * object, a promise of one or a `(phase, context)` function, typed as the app
 * types it (`NextConfig`). Under `next dev` the app is recorded and the live
 * story is at the URL `next dev` prints; every other phase gets the config
 * back untouched.
 */
export function withProducttrace<C extends object>(
  nextConfig?: C | Promise<C> | NextConfigFunction<C>,
  options?: ProductTraceNextOptions,
): (phase: string, context: NextConfigContext) => Promise<C>;
