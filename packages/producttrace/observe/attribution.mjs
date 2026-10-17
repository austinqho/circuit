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
 *    When the app hid where the dispatch ended (the end came only as the
 *    next task), a timer could have run in between, so it is `unknown`.
 *  - `only_run_of_handler`: its stack, followed through its async parents,
 *    passes through a handler the app declared for exactly one recorded
 *    dispatch, and React's event dispatch called that handler with no app
 *    code around it. A handler on the request's own synchronous stack, sent
 *    outside every dispatch, was not run by an event (it would have been
 *    sent inside one). A function that also runs from a shortcut, an effect
 *    or a timer is called there by the app's own code, by React's commit, or
 *    by the browser directly, so it does not count. React's event dispatch is
 *    told from its commit by function name; a minified build has none, so
 *    there it abstains.
 * Anything else is `unknown`: the async stack names where a request started,
 * but Chrome keeps no id per dispatch, so when several dispatches ran that
 * handler the request goes to none of them. The candidates are listed
 * (`could_be`), never chosen by time. A frame is in a handler when it is in
 * the same script, inside the handler function's source range.
 */
// React's event dispatch, from the root listener to the handler call (React 17-19).
const REACT_EVENT =
  /^(dispatchDiscreteEvent|dispatchContinuousEvent|dispatchEvent|dispatchEventForPluginEventSystem|dispatchEventsForPlugins|processDispatchQueue\w*|executeDispatch\w*)$/u;
// React running effects or committing, which can also happen inside an event.
const REACT_COMMIT =
  /^(commit\w*|flush\w*Effects\w*|recursivelyTraverse\w*|invokePassiveEffect\w*|invokeLayoutEffect\w*)$/u;

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
    /**
     * An event that is not a user action of its own (a hover, a focus, a
     * scroll, an event the app dispatched) but may have run a handler. It
     * opens no window. `times` counts repeats on the same nodes.
     */
    noteRun({ event, trusted = true }) {
      const run = {
        action_id: `observe:action:${++nextAction}`,
        sequence: nextAction,
        event,
        target: null,
        handlers: [],
        run: true,
        trusted,
        times: 1,
      };
      actions.push(run);
      byId.set(run.action_id, run);
      return run;
    },
    /** `late`: the end came only as the next task, so where it ended is not known. */
    endDispatch(actionId, { late = false } = {}) {
      const action = byId.get(actionId);
      if (action && !action.done) Object.assign(action, { done: true, late });
      if (open?.action_id === actionId) open = null;
    },
    /** The dispatch running now, if any. */
    running: () => open?.action_id ?? null,
    get: (actionId) => byId.get(actionId),
    /**
     * The cause of a request: `in_dispatch` is the dispatch that was running
     * when it was sent (or null); `stack` every frame, innermost first, sync
     * then async parents, as { script_id, offset, name, app, segment, link }
     * (`segment` numbers each synchronous stretch, `link` how it leads to the
     * one before: 'await', 'setTimeout', ...); `before` how many actions
     * were recorded when it was sent; `truncated` when the
     * async chain was cut short; `started_in` the outermost first-party
     * function, for the report.
     */
    causeOf({
      in_dispatch = null,
      before = Infinity,
      stack = [],
      truncated = false,
      started_in = null,
    } = {}) {
      // Only events recorded before the request was sent could have caused it.
      const earlier = actions.slice(0, before);
      const unknown = (reason, extra = {}) => ({
        action_id: null,
        via: 'unknown',
        started_in,
        reason,
        ...extra,
      });
      if (in_dispatch && byId.has(in_dispatch)) {
        if (!byId.get(in_dispatch).late) return { action_id: in_dispatch, via: 'dispatch' };
        return unknown(
          'sent before the end of an event the app stopped, which the observer saw only on the next task; a timer could have sent it',
          { could_be: [in_dispatch] },
        );
      }
      if (truncated) return unknown('the async stack was cut short before where it started');
      // Outermost first: the first frame inside any recorded handler.
      const outerFirst = [...stack].reverse();
      const at = outerFirst.findIndex((frame) =>
        earlier.some((action) => action.handlers.some((h) => h.range && inRange(frame, h.range))),
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
      // Called on the request's own synchronous stack, outside every
      // dispatch: had an event run this handler, the request would have been
      // sent inside it.
      if (segment === 1 && callers.length)
        return unknown(
          'a recorded handler sent it outside every recorded event, so no event ran it',
        );
      // Library only, and at least one.
      if (callers.some((outer) => outer.app))
        return unknown(
          "a recorded handler ran, but called from the app's own code, not from an event",
        );
      if (!callers.length)
        return unknown(
          'a recorded handler ran, called by the browser directly, not by an event dispatch',
        );
      if (
        callers.some((outer) => REACT_COMMIT.test(outer.name || '')) ||
        !callers.some((outer) => REACT_EVENT.test(outer.name || ''))
      )
        return unknown(
          "a recorded handler ran, but not from React's event dispatch (an effect, or a build without names)",
        );
      const range = earlier
        .flatMap((action) => action.handlers)
        .find((h) => h.range && inRange(frame, h.range)).range;
      const candidates = earlier.filter((action) =>
        action.handlers.some(
          (h) => h.range && h.range.script_id === range.script_id && h.range.start === range.start,
        ),
      );
      const runs = candidates.reduce((sum, action) => sum + (action.times ?? 1), 0);
      const people = candidates.filter((action) => action.trusted !== false);
      const couldBe = people.length ? { could_be: people.map((action) => action.action_id) } : {};
      // An event whose handlers could not be read may have run this one too.
      if (earlier.some((action) => action.described === false))
        return unknown(
          "an event's handlers could not be read (its element was gone), and it may have run this handler",
          couldBe,
        );
      // Every event React handles is counted: when only one ran this handler,
      // no other could have started the request.
      if (runs === 1 && people.length === 1)
        return { action_id: people[0].action_id, via: 'only_run_of_handler', started_in };
      if (runs === 1) return unknown('only an event the app dispatched itself ran this handler');
      return unknown(
        `${runs} events ran this handler; the browser keeps no id that says which`,
        couldBe,
      );
    },
  };
}
