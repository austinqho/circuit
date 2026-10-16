export interface ProductTraceNextOptions {
  /** The analyzed repository. Default: nearest ancestor of the working directory containing `.git`. */
  repository?: string;
  /** Repository-relative globs deciding which sources are instrumented (see `producttrace/vite`). */
  firstParty?: { include?: string[]; exclude?: string[] };
  /**
   * Left out, `next dev` runs a collector itself (store under
   * `node_modules/.producttrace/store`) and shows the live story at
   * `/__producttrace/`. `false` records nothing outside the page; a URL sends
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

type NextConfigLike = Record<string, unknown>;
type NextConfigFunction = (
  phase: string,
  context: { defaultConfig: NextConfigLike },
) => NextConfigLike | Promise<NextConfigLike>;

/**
 * `export default withProducttrace(nextConfig)`. Under `next dev` the app is
 * recorded and narrated at `/__producttrace/`; every other phase gets the
 * config back untouched.
 */
export function withProducttrace(
  nextConfig?: NextConfigLike | NextConfigFunction,
  options?: ProductTraceNextOptions,
): NextConfigFunction;
