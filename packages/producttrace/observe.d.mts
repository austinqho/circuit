/** A Chrome DevTools Protocol session for one page, such as Playwright's `context.newCDPSession(page)`. */
export interface CdpSession {
  send(method: string, params?: Record<string, unknown>): Promise<any>;
  on(event: string, listener: (params: any) => void): unknown;
  off?(event: string, listener: (params: any) => void): unknown;
}

export interface ObserveOptions {
  /** Scripts served from this origin are the app's own code; others are libraries. */
  appOrigin?: string | null;
}

export interface ObservedFunction {
  name: string | null;
  file: string | null;
  line: number | null;
  app?: boolean;
}

export interface ObserveAction {
  schema: 'producttrace.observe.v1';
  sequence: number;
  kind: 'observe.action';
  action_id: string;
  event: string;
  /** For key events: the key with its modifiers, such as `Control+s`. */
  key?: string;
  target: {
    tag: string;
    role: string | null;
    name: string | null;
    label: string | null;
    input_type: string | null;
  } | null;
  handlers: ObservedFunction[];
}

export interface ObserveRequest {
  schema: 'producttrace.observe.v1';
  sequence: number;
  kind: 'observe.request';
  url: string;
  method: string;
  /** The action that caused it, or null when the browser gives no identifier that says which. */
  action_id: string | null;
  /**
   * `dispatch`: sent while that action's event was being dispatched.
   * `only_run_of_handler`: its async stack passes through a handler React called for that one action only.
   * `unknown`: no identifier says which; `could_be` lists the candidates when there are some.
   */
  via: 'dispatch' | 'only_run_of_handler' | 'unknown';
  reason?: string;
  could_be?: string[];
  started_in?: ObservedFunction | null;
  handler: ObservedFunction | null;
  api_function: ObservedFunction | null;
  call_site: ObservedFunction | null;
}

export interface ObserveStats {
  /** Action rows written. */
  actions: number;
  /** Times the page paused. Always 0: every pause is skipped. */
  pauses: number;
  /** Trusted user events seen. */
  dispatches: number;
  requests: number;
  errors: number;
  last_error?: string;
}

export interface Observer {
  records(): Array<ObserveAction | ObserveRequest>;
  stats(): ObserveStats;
  stop(): Promise<void>;
}

/**
 * Watch a page through the debugger without pausing it: no rewrite and no
 * replaced browser API. It adds event listeners in an isolated world the
 * app's scripts cannot see.
 */
export function observePage(cdp: CdpSession, options?: ObserveOptions): Promise<Observer>;
