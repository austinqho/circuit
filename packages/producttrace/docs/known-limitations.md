# Known limitations

Edge cases producttrace knows about and does not handle yet. Each one is reported honestly at runtime (a frontier, an abstention or a disclosed gap) rather than producing a wrong answer.

## Engine and capture
- WebSocket-pushed requests: a request issued from a `message` listener is credited to the action that opened the socket (registration ownership), not the action that caused the push.
- `page_requests` session window: the server-span window of the last page still ends at collector shutdown, so page l can list spans from a later page k.
- A request that leaves through a replaced `fetch` makes the action read "issued no request from instrumented code"; coverage names the replacement and lists the span as unlinked, but the label should say "no recorded request".
- Nested incoming requests (a server calling itself) are folded into the outer request's summary without being named; the "who responded" answer is empty when two handlers write.
- A same-trace db op whose parent span was never shipped (an older backend) is not listed on any surface when the trace has two server spans; disclosed only in docs.
- An aborted streamed request's Express layer span never ends, so its handler and hops are not attributed (stated frontier, no false claim).
- Cross-request reuse of a `traceparent` by the app makes the earlier request's chain abstain (three claimants).
- A second OpenTelemetry SDK in the app: one `fetch` sends two `traceparent` headers and renders as two escaped hops; disclosed, not fixed.
- `req.setHeader('traceparent', …)` after the request object exists overwrites producttrace's value unmarked; disclosed.
- Which action caused an abort is never recorded (the Cancel click reads `no_request`).
- Radix/library layout effects (scroll lock, injected `<style>`, `aria-hidden`) land under no action because layout effects are not covered by state-update tracking.
- `el.style.x =`, `dataset`, reflected properties and `execCommand` are not wrapped for direct-write ownership (`unwrapped_write`).
- Hover-heavy pages: script time during pointer movement is 2–5× an uninstrumented page's after coalescing (rows are fixed; per-event classification and dispatch frames remain).
- Untrusted `setFiles`/`selectOption` (buffer-based) leave requests with no user action; now disclosed as `dom.untrusted` and a coverage reason.
- `export default () => …` and `export default class extends Error {}` are not instrumented / registered.
- Receipt rows could be coalesced (one row per action and continuation listing receipt ids) without losing identifiers; changes the row schema the drivers read.
- React 19 development builds are not supported.

## MCP and rendering
- Body capture off (the production default): a 304 the browser saw as 200 cannot be explained; the rows hold nothing.
- The same request can show different discriminating fields in different tools, because fields are chosen relative to the requests listed alongside.
- A status-like key holding an object is shown by shape only.
- Keystroke-heavy `element_history` replies exceed the MCP client's 10 MB limit (17 MB on the G6 store).
- A partial visible-text description cannot match an element because only a hash of the text is recorded.

## Tests and tooling
- `test/browser/continuations-neutral.mjs` fails a timing precondition (`/api/cross-timer ran after action B started`) in about 2 of 4 runs under machine load; attribution assertions never fail. Needs a robust precondition.
- The LibreChat parity gate is flaky without the chat fixture (default model name varies); the feedback flow's write is blocked by the fixture's placeholder id.
