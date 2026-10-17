/**
 * Observe mode's join rules: which user action caused a request, from
 * identifiers only (ADR 0002). Pure; the debugger wiring (observer.mjs)
 * resolves object identity in the page and feeds the results here.
 *
 * An action is one trusted user event, known by its Event object. Code that
 * runs (a request, a React state update) names its action by one of:
 *  - `dispatch`: the event being dispatched when it ran (`window.event`) is the
 *    action's Event, so it ran synchronously inside that dispatch.
 *  - `event_in_scope`: a function on its stack still holds the action's Event
 *    (or a React SyntheticEvent wrapping it) in a local or closure variable.
 *  - `state_effect`: it ran in a React effect committed for a fiber whose
 *    state an action set (the same fiber object joins setState to the effect).
 *  - `only_run_of_handler`: its stack (with async parents) passes through a
 *    handler that exactly one recorded action declared.
 * Anything else is `unknown`. The browser's async stack names the handler it
 * started in, but Chrome keeps no id per dispatch, so when more than one
 * action ran that handler the request goes to none of them. The candidates
 * are listed (`could_be`), never chosen by time. A frame is in a handler when
 * it is in the same script, inside the handler function's source range.
 */
export function createAttribution() {
  const actions = [];
  const byId = new Map();
  let nextAction = 0;

  return {
    actions,
    noteAction({ event, target = null, handlers = [] }) {
      const action = {
        action_id: `observe:action:${++nextAction}`,
        sequence: nextAction,
        event,
        target,
        handlers,
      };
      actions.push(action);
      byId.set(action.action_id, action);
      return action;
    },
    /**
     * The cause of code running now, from what the observer resolved:
     * `dispatching` / `in_scope` / `effect_of` are action ids (or null);
     * `stack` every frame (sync, then async parents) as { script_id, offset };
     * `started_in` the outermost first-party function, for the report.
     */
    causeOf({
      dispatching = null,
      in_scope = null,
      effect_of = null,
      stack = [],
      started_in = null,
    } = {}) {
      if (dispatching && byId.has(dispatching)) return { action_id: dispatching, via: 'dispatch' };
      if (in_scope && byId.has(in_scope)) return { action_id: in_scope, via: 'event_in_scope' };
      if (effect_of && byId.has(effect_of)) return { action_id: effect_of, via: 'state_effect' };
      const inHandler = (handler) =>
        handler.range &&
        stack.some(
          (frame) =>
            frame.script_id === handler.range.script_id &&
            handler.range.start <= frame.offset &&
            frame.offset < handler.range.end,
        );
      const candidates = actions.filter((action) => action.handlers.some(inHandler));
      // One action ever ran that handler, so no other could have started it.
      if (candidates.length === 1)
        return { action_id: candidates[0].action_id, via: 'only_run_of_handler', started_in };
      return {
        action_id: null,
        via: 'unknown',
        started_in,
        reason: candidates.length
          ? `${candidates.length} actions ran this handler; the browser keeps no id that says which`
          : started_in
            ? 'started outside every recorded handler'
            : 'no first-party code on the stack',
        ...(candidates.length ? { could_be: candidates.map((action) => action.action_id) } : {}),
      };
    },
  };
}
