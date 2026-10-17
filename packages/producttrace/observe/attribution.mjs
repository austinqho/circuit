/**
 * Observe mode's join rules: which user action caused a request, from
 * identifiers only (ADR 0002). Pure; observer.mjs feeds it what the browser
 * reported.
 *
 * An action is one trusted user event dispatch. The browser runs one task at
 * a time, and the observer sees where each dispatch starts and ends in the
 * same ordered stream as the requests, so a request names its action by one of:
 *  - `dispatch`: it was sent while that action's dispatch was running (between
 *    its start and end, microtasks included). Nothing else can run then.
 *  - `only_run_of_handler`: its stack, followed through its async parents,
 *    passes through a handler the app declared for exactly one recorded
 *    dispatch, and that handler was called by library code (React's event
 *    dispatch) with no app code around it. A function that also runs from a
 *    shortcut, an effect or a timer is called by the app's own code there, or
 *    by the browser directly, so it does not count.
 * Anything else is `unknown`: the async stack names where a request started,
 * but Chrome keeps no id per dispatch, so when several dispatches ran that
 * handler the request goes to none of them. The candidates are listed
 * (`could_be`), never chosen by time. A frame is in a handler when it is in
 * the same script, inside the handler function's source range.
 */
export function createAttribution() {
  const actions = [];
  const byId = new Map();
  let nextAction = 0;
  let open = null;

  const inRange = (frame, range) =>
    frame.script_id === range.script_id && range.start <= frame.offset && frame.offset < range.end;

  return {
    actions,
    /** A trusted dispatch started; one that was still open has ended. */
    startDispatch({ event, target = null }) {
      const action = {
        action_id: `observe:action:${++nextAction}`,
        sequence: nextAction,
        event,
        target,
        handlers: [],
      };
      actions.push(action);
      byId.set(action.action_id, action);
      open = action;
      return action;
    },
    endDispatch(actionId) {
      if (open?.action_id === actionId) open = null;
    },
    /** The dispatch running now, if any. */
    running: () => open?.action_id ?? null,
    get: (actionId) => byId.get(actionId),
    /**
     * The cause of a request: `in_dispatch` is the dispatch that was running
     * when it was sent (or null); `stack` every frame, innermost first, sync
     * then async parents, as { script_id, offset, app, segment, link }
     * (`segment` numbers each synchronous stretch, `link` how it leads to the
     * one before: 'await', 'setTimeout', ...); `truncated` when the
     * async chain was cut short; `started_in` the outermost first-party
     * function, for the report.
     */
    causeOf({ in_dispatch = null, stack = [], truncated = false, started_in = null } = {}) {
      if (in_dispatch && byId.has(in_dispatch)) return { action_id: in_dispatch, via: 'dispatch' };
      const unknown = (reason, extra = {}) => ({
        action_id: null,
        via: 'unknown',
        started_in,
        reason,
        ...extra,
      });
      if (truncated) return unknown('the async stack was cut short before where it started');
      // Outermost first: the first frame inside any recorded handler.
      const outerFirst = [...stack].reverse();
      const at = outerFirst.findIndex((frame) =>
        actions.some((action) => action.handlers.some((h) => h.range && inRange(frame, h.range))),
      );
      if (at < 0)
        return unknown(
          started_in
            ? 'started outside every recorded handler'
            : 'no first-party code on the stack',
        );
      const frame = outerFirst[at];
      // Its callers: the rest of its synchronous stretch, or, for an async
      // function resumed after `await`, the stretch that first called it.
      let segment = frame.segment;
      let callers = outerFirst.slice(0, at).filter((outer) => outer.segment === segment);
      while (
        !callers.length &&
        stack.some((outer) => outer.segment === segment + 1 && outer.link === 'await')
      ) {
        segment += 1;
        callers = stack.filter((outer) => outer.segment === segment);
      }
      // Library only, and at least one.
      if (callers.some((outer) => outer.app))
        return unknown(
          "a recorded handler ran, but called from the app's own code, not from an event",
        );
      if (!callers.length)
        return unknown(
          'a recorded handler ran, called by the browser directly, not by an event dispatch',
        );
      const range = actions
        .flatMap((action) => action.handlers)
        .find((h) => h.range && inRange(frame, h.range)).range;
      const candidates = actions.filter((action) =>
        action.handlers.some(
          (h) => h.range && h.range.script_id === range.script_id && h.range.start === range.start,
        ),
      );
      // One dispatch ever ran that handler, so no other could have started it.
      if (candidates.length === 1)
        return { action_id: candidates[0].action_id, via: 'only_run_of_handler', started_in };
      return unknown(
        `${candidates.length} actions ran this handler; the browser keeps no id that says which`,
        {
          could_be: candidates.map((action) => action.action_id),
        },
      );
    },
  };
}
