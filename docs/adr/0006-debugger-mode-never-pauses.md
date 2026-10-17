# 6. Debugger mode never pauses the page

Status: accepted.

Decision: `producttrace/observe` reads an app through Chrome's DevTools Protocol and never pauses it: no breakpoints, and every pause the page could hit (a `debugger` statement, an exception) is skipped. Nothing in the app is rewritten and no browser API is replaced. What it adds is one listener per user event type on `window`, at the start and the end of each dispatch, in an isolated world the app's scripts cannot see; each reports through a binding into the same ordered stream as the network events. Only trusted events are recorded, so clicks the app dispatches itself are ignored.

A request joins an action only by identity:

- `dispatch`: it was sent between that event's start and end. The page runs one task at a time, so nothing else could have sent it.
- `only_run_of_handler`: its async stack passes through a handler React called for exactly one recorded event, and nothing but library code called that handler.

Anything else is `unknown`, with the actions it `could_be`. A function the app also calls from a shortcut, an effect or a timer abstains, and so do two events on the same handler.

Why: Chrome drops input that arrives while a page is paused. Pausing only inside the user's own dispatches is not enough: with clicks 150 ms apart sent the way a mouse sends them (without waiting for the page), a pause-based observer lost 1 of 10 clicks, and typing at 30 ms per key lost half the letters. Any pause can land while the next real input arrives, so no pause-based design is read-only. Without pauses there is no point at which to read a running request's Event or React fiber, so more requests abstain; that is the price, and ADR 0002 prefers it to a guess. Chrome's async stacks name the handler that started a request but carry no id per click, so overlapping runs of one handler cannot be told apart either way.

`verify --observe` drives the probe page at a person's pace (`pace_ms` steps) so a design that drops input shows up as DIFFERENT.
