# Deferred claims (cycle 3 stop rule, 2026-09-24)

Cycle 3's stop rule: finish what is in flight; add a new claim only if it is an honesty bug or blocks the benchmark. Everything else the graders surfaced goes here, with where it was found. None of these is scheduled.

## Engine and capture
- WebSocket-pushed requests: a request issued from a `message` listener is credited to the action that opened the socket (registration ownership), not the action that caused the push. Found grading fix/honest-coverage (probe d2); pre-existing.
- `page_requests` session window: the server-span window of the last page still ends at collector shutdown, so page l can list spans from a later page k (main's code; the action windows got the last-row + 2 s bound in #18). Found regrading fix/honest-coverage.
- A request that leaves through a replaced `fetch` makes the action read "issued no request from instrumented code"; coverage names the replacement and lists the span as unlinked, but the label should say "no recorded request". Found regrading fix/honest-coverage.
- Nested incoming requests (a server calling itself) are folded into the outer request's summary without being named; the "who responded" answer is empty when two handlers write. Found grading fix/middleware-reads (F2).
- A same-trace db op whose parent span was never shipped (an older backend) is not listed on any surface when the trace has two server spans; disclosed only in docs. Found grading fix/middleware-reads (F1).
- An aborted streamed request's Express layer span never ends, so its handler and hops are not attributed (stated frontier, no false claim). Found regrading fix/server-outbound.
- Cross-request reuse of a `traceparent` by the app makes the earlier request's chain abstain (three claimants). Found regrading fix/server-outbound.
- A second OpenTelemetry SDK in the app: one `fetch` sends two `traceparent` headers and renders as two escaped hops; disclosed, not fixed. Found regrading fix/server-outbound.
- `req.setHeader('traceparent', …)` after the request object exists overwrites Tracer's value unmarked; disclosed. Same source.
- Which action caused an abort is never recorded (the Cancel click reads `no_request`). Found grading fix/client-aborts.
- The render mutation of the last search result is unattributed (the mutation-ownership claim covers the mechanism; the specific case is unverified until that branch merges). Found grading fix/client-aborts.
- Radix/library layout effects (scroll lock, injected `<style>`, `aria-hidden`) land under no action because layout effects are not covered by state-update tracking. Found grading fix/mutation-ownership.
- `el.style.x =`, `dataset`, reflected properties and `execCommand` are not wrapped for direct-write ownership (`unwrapped_write`). Same source.
- Hover-heavy pages: script time during pointer movement is 2–5× main's after coalescing (rows are fixed; per-event classification and dispatch frames remain). Found grading fix/trusted-events.
- Untrusted `setFiles`/`selectOption` (buffer-based) leave requests with no user action; now disclosed as `dom.untrusted` and a coverage reason. Same source.
- `export default () => …` and `export default class extends Error {}` are not instrumented / registered (the typearg-calls claim covers the call-argument case; default exports partly). Found grading fix/function-names.
- Receipt rows could be coalesced (one row per action and continuation listing receipt ids) without losing identifiers; changes the row schema the drivers read. Found regrading fix/effect-inherit.
- React 19 development builds (see fix/react19-dev): whatever remains after that claim lands.

## MCP and rendering
- Body capture off (the production default): a 304 the browser saw as 200 cannot be explained; the rows hold nothing. Found grading fix/mcp-surfaces.
- The same request can show different discriminating fields in different tools, because fields are chosen relative to the requests listed alongside. Same source.
- A status-like key holding an object is shown by shape only. Same source.
- Keystroke-heavy `element_history` replies exceed the MCP client's 10 MB limit (17 MB on the G6 store); pre-existing.
- A partial visible-text description cannot match an element because only a hash of the text is recorded. Found grading fix/mcp-gaps.

## Tests and tooling
- `test/browser/continuations-neutral.mjs` fails a timing precondition (`/api/cross-timer ran after action B started`) in about 2 of 4 runs under machine load; attribution assertions never fail. Needs a robust precondition.
- `test/browser/unlinked-coverage-neutral.mjs` A8 expected the constant `unobserved` list; fixed in #18 (kept here only as the record of the fix).
- The G1 grader (`test/browser/g1-grade.mjs`) reports 1 frontend-only and 3 backend-on mismatches on main since #18/#19, byte-identical across branches; it predates those merges and needs updating, not the engine.
- The LibreChat parity gate is flaky without the chat fixture (default model name varies); the feedback flow's write is blocked by the fixture's placeholder id.
- The M1 live viewer (`test/browser/server.mjs`) has not been rerun since the episode and vocabulary changes.
