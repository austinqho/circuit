# 6. Debugger mode pauses only inside the user's own input

Status: accepted.

Decision: `producttrace/observe` reads an app through Chrome's debugger and changes nothing in it: no rewrite, no injected script, no replaced browser API. The page pauses only while it is dispatching a trusted click, double-click, submit or input event: at the event itself, and at a `fetch`, `XMLHttpRequest#send` or React `setState` that runs inside that dispatch (conditional breakpoints the page checks without pausing). A request sent anywhere else is read from its network event's stack, without a pause. A request joins an action only by identity (the action's Event object, a React fiber the action set state on, or a handler only that action ran); otherwise it is `unknown` and lists the actions it could be.

Why: Chrome drops input that arrives while a page is paused. A pause on every request lost real clicks in testing (a hover prefetch paused the page between Playwright's mouse move and press), so a debugger that pauses in background work would change what the user's input does. Inside a dispatch the page is already busy with that input. Chrome's async stacks name the handler that started a request but carry no id per click, so two clicks on the same handler with overlapping work cannot be told apart; joining them by time would break ADR 0002, so the observer abstains.
