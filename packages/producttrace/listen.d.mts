export interface ListenOptions {
  /** Where the script sends its rows with navigator.sendBeacon. */
  endpoint: string;
  /** Record what was typed (never for password fields). Off by default. */
  values?: boolean;
  /** How often to send rows; 0 sends only when the page is hidden or closed. Default 5000. */
  flushMs?: number;
  /** Name of the Server-Timing metric that carries the server's request id. Default `rid`. */
  serverTimingName?: string;
  /** Send as soon as this many rows are waiting. Default 200. */
  maxRows?: number;
  /** Also report Chrome's long-animation-frame script entries (slow frames only). Off by default. */
  slowScripts?: boolean;
}

/**
 * The listen-mode browser script as text. It defines no globals, replaces no
 * browser API and writes nothing into the page; it only listens and sends
 * `producttrace.listen.v1` batches to `endpoint`.
 */
export function listenScript(options: ListenOptions): string;

/** The fingerprint listen mode gives a function with this source text: `<fnv1a hex>:<length>`. */
export function fingerprintSource(source: string): string;
