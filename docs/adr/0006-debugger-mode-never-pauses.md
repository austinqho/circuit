# 6. Debugger mode never pauses the page

Status: accepted.

Decision: `producttrace/observe` reads an app through Chrome's DevTools Protocol and never pauses it: no breakpoints, and every pause the page could hit (a `debugger` statement, an exception) is skipped. Nothing in the app is rewritten and no browser API is replaced. What it adds, in an isolated world the app's scripts cannot see, is one listener on `window` for each event type React handles, plus, while a user event is dispatched, one on each node of its path to see where the app stops it; each reports through a binding into the same ordered stream as the network events. Trusted user events (clicks, keys, input, ...) are actions; every other event React handles (hover, focus, scroll, media, events the app dispatches itself) is recorded only as a possible run of a handler.

A request joins an action only by identity:

- `dispatch`: it was sent between that event's start and end. The page runs one task at a time, so nothing else could have sent it.
- `only_run_of_handler`: its async stack passes through a handler that React's event dispatch called, with no app code around it, and of every event React handled before the request, only this action could have run that handler. React's event dispatch only runs inside an event, and every event is counted with the handlers React would call for it (read along React's own tree, so portals count), so no other event could have started the request. React's event dispatch is told from its commit (where effects run) by function name, so a minified build abstains. An event whose handlers could not be read, because React removed its element before they were read, may have run any handler, so handler joins after it abstain.

Anything else is `unknown`, with the actions it `could_be`. A function the app also calls from a shortcut, an effect or a timer abstains, and so do two events on the same handler, such as a click and a hover. A dispatch's end is where the event stops: after window's bubble listeners, or after the listeners of the node where the app stopped propagation. When the observer sees the end only on the next task (`stopImmediatePropagation`), a timer could have run first, so requests in that window abstain too.

Why: Chrome drops input that arrives while a page is paused. Pausing only inside the user's own dispatches is not enough: with clicks 150 ms apart sent the way a mouse sends them (without waiting for the page), a pause-based observer lost 1 of 10 clicks, and typing at 30 ms per key lost half the letters. Any pause can land while the next real input arrives, so no pause-based design is read-only. Without pauses there is no point at which to read a running request's Event or React fiber, so more requests abstain; that is the price, and ADR 0002 prefers it to a guess. Chrome's async stacks name the handler that started a request but carry no id per click, so overlapping runs of one handler cannot be told apart either way.

`verify --observe` drives the probe page at a person's pace (`pace_ms` steps) so a design that drops input shows up as DIFFERENT.
