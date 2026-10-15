# G1 — Frontend-only mode

Gate text written before code (2026-09-23), from `docs/HANDOFF-2026-09-23-agent-annotation-pivot.md` §5.1 and §7.

## Pass criterion (handoff §7, verbatim)

> **G1 Frontend-only mode.** On LibreChat with backend instrumentation disabled, every action still yields a chain ending in an explicit network frontier; zero inferred backend stops. With it enabled, final7 results reproduce.

Supporting text (§5.1, verbatim):

> **Frontend-only mode** becomes required. Most repos will not be Express + Mongo. Backend joins are optional; when absent the chain ends with an explicit frontier (`stopped_at: "network", because: "backend not instrumented"`), never an inferred effect.

## Decisions

### D-G1-1. Frontier vocabulary

Every per-action chain ends in exactly one of:

| terminal | when |
|---|---|
| `stopped_at: null` (reached `db`) | the action's request joined server → handler → DB span by exact trace/parent (the unchanged M1 join, `attachBackendSpans`) |
| `stopped_at: "handler"`, `because: "no db span under handler"` | server and handler spans joined, no DB descendant |
| `stopped_at: "server"`, `because: "no handler span under server span"` | server span joined, no registered-handler span under it (added while implementing; the table above had no row for this case) |
| `stopped_at: "network"`, `because: "backend not instrumented"` | the action made ≥1 non-internal request and the run **declares** backend telemetry off |
| `stopped_at: "network"`, `because: "no span on trace"` | backend telemetry declared on, but no server span joined the request (the existing `span.join.diagnostic` row is kept and referenced by sequence) |
| `stopped_at: "browser"`, `because: "no request could be attributed to this action from instrumented code (requests from uninstrumented scripts, workers and third-party code cannot be linked; any seen in this window are listed below as unlinked)"` | no non-internal request from instrumented code could be attributed to the action. Its DOM mutation receipt, if any, is listed in `reached`, and unattributed requests in its window are listed in `unlinked` (see the 2026-09-24 amendment below) |
| `stopped_at: "worker"`, `because: "message posted to Web Worker <script url>; worker code is not instrumented: requests it makes cannot be attributed to this action (any seen in this window are listed below as unlinked)"` | the action (through any of its continuations) posted to a Web Worker and no first-party request was attributed after its latest post (amendment 2026-09-24, below) |

*Amendment (2026-09-24, worker frontier).* A request issued inside a Web Worker never reaches the page's fetch/XHR wrappers, so before this amendment such an action could only report the scoped `browser` frontier, with nothing in the records showing a worker was involved. The runtime now records `worker.create` and `worker.postMessage` rows (schemas in D-G1-3 below), and the chain builders state the crossing as its own frontier. The vocabulary is the no-false-negatives one (amendment below): `stopped_at` ∈ `null | network | server/route | handler | entry_handler | validation | browser | worker | pending`; `reached` still carries `dispatch` / `dom_mutation` / `entry_handler` for request-less chains without a post, and is `worker` when the worker is the primary stop. The `because` is `"message posted to Web Worker <script url>; " + SCOPED_ABSENCE.worker` (`shared Web Worker` for a SharedWorker), `stop_reason: "worker_not_instrumented"`.

- **Primary vs additional stop.** The worker is the frontier when no first-party request of the action was recorded after the action's latest `worker.postMessage` (timestamps order, sequence breaks ties). Otherwise the request frontier stands. Whichever frontier is not primary is listed under `additional_stops: [{stopped_at, because, …}]` (worker stops carry `worker_id`, `worker_kind`, `script_url`; a request stop carries `request_occurrence_id`). One worker stop per distinct worker. `reached` gains `{stop: "worker", worker_id, worker_kind, script_url, via, sequence}` per post. The field is absent when the action posted to no worker.
- **Unlinked evidence, never a join (one design: PR #4's `unlinked`).** A worker chain uses the same `unlinked` field as a request-less chain (`indexUnlinkedEvidence` in `analysis/causal-chain.mjs`; window = the episode's first dispatch to the next dispatch on the page outside the episode, or page end; server spans whose `(trace_id, parent_span_id)` matches no request row, selected by start time; every entry `attribution: "none (observed during this action's window; timestamps only order, not a join)"`). One extension: `buildEpisodeChain` attaches `unlinked` to a chain that has a `worker.postMessage` step even when a request was also attributed (PR #4 attaches it only when no request was attributed), because a worker's own requests can only ever appear there. `buildActionChains` (`producttrace.action-chain.v1`) carries no unlinked listing, as for request-less chains; the listing is on the stored/MCP chain.
- **Credit.** A `worker.postMessage` is terminal evidence for entry-handler credit exactly like a request (`indexEntryHandlerUnits`): the frame that posted is rooted, and a frame that posted is not a credit abstention. A post is also an effect for episode construction (`indexWorkflowEpisodes`).
- **Credit consequence (read before trusting a `worker` stop on a no-op click).** Because a post roots credit the way a request does, a global (document- or window-level) listener that posts to a worker on every click takes the entry-handler credit and makes the chain stop at `worker` for every click it observes, over an element-bound handler that only mutated the DOM (that mutation stays in `reached`, but is no longer the primary stop). This is the same rule main already applies to a global listener that fetches (e.g. an analytics beacon), now reaching a common pattern: analytics workers such as Partytown. So `stopped at worker` on a click whose own handler does nothing visible most likely means "an analytics worker was messaged", not that the click's work went to a worker.
- **Unlinked window: direction of error.** The window closes at the next dispatch outside the episode. With two quick clicks (two episodes), a span the first click's worker caused can start after the second click and is then listed under the second click, and the first may list none. Server spans are not filtered by page, tab, session or user: any unjoined server span in the time range is listed, including ones another tab or client caused. The listing changes no stop, and every entry says it is not a join; that wording is the safeguard, not the window.
- The live viewer (`describeEpisodeEvidence`) applies the same primary-stop rule once the episode is not pending: when the latest post has no request recorded after it (a request-less episode, or a request followed by a post), it reports `stop_reason: "worker_not_instrumented"`, `frontier: {stopped_at: "worker", because: …}` and label `Stopped at worker: <script url> is not instrumented`, so the label always agrees with `stopped_at`; the displaced state is kept under `displaced: {stage, stop_reason, frontier, label}`. A pending episode stays pending.
- Messages a worker posts back to the page run under no action (worker results are not attributed; that would be a guess). Instrumenting inside workers is later work.

- "Backend telemetry on/off" is an **explicit declaration** by the caller (`backendInstrumented: true|false`), never inferred from the absence of spans. If a caller does not declare it, the chain builder throws. (Abstain over guess: an empty span file cannot distinguish "backend off" from "exporter broken".)
- With backend declared off, the builder never calls the joiner and never emits `route` / `server_handler` / `db` stops, even if spans are passed. Gate check: **zero** chains contain a backend stop or backend-reached step when backend is declared off.
- The live viewer path (`describeEpisodeEvidence`) keeps its existing `stop_reason` values (compatibility) and gains a `frontier` object with the same `{stopped_at, because}` vocabulary; `test/browser/server.mjs` reads the declaration from `PRODUCTTRACE_BACKEND_TELEMETRY` (default on).

### D-G1-2. Chain record

New pure function `buildActionChains(records, spans, { backendInstrumented, registeredFunctionIds? })` in `analysis/runtime-attribution.mjs`; one `producttrace.action-chain.v1` row per `dom.action`:

```json
{ "schema": "producttrace.action-chain.v1", "action_id": "...", "event": "click",
  "entry_handler": { "function_id": "...", "rooted": true },
  "reached": [ {"stop": "action"}, {"stop": "entry_handler", "function_id": "..."},
               {"stop": "request", "request_occurrence_id": "...", "method": "POST", "url": "/api/x"},
               {"stop": "route", "span_id": "..."}, {"stop": "server_handler", "span_id": "..."}, {"stop": "db", "operation": "insert", "collection": "..."} ],
  "stopped_at": "network", "because": "backend not instrumented",
  "requests": [ { "request_occurrence_id": "...", "stopped_at": "network", "because": "...", "diagnostic_sequence": 123 } ] }
```

Per-request frontiers are always listed. The action-level terminal is the deepest stop any of its requests reached (db > handler > network), so an action with one joined write and one unjoined GET reports the write and lists the GET's frontier under `requests`. Entry handler selection is `indexEntryHandlerUnits` unchanged (attribution logic is not touched by this gate).

### D-G1-3. Runtime transport without the bridge

`src/runtime-attribution-browser.js` already emits `network.request` from its own fetch/XHR/EventSource/WebSocket wrappers unless `__PRODUCTTRACE_BRIDGE_TRANSPORT__` is set (the static-era bridge sets it only for the duration of its own synchronous call into the wrapped transport). G1 adds a node test that evaluates the runtime with no bridge and asserts one `network.request` per fetch/XHR carrying `traceparent`, `action_id` and `terminal_owner_continuation_id`, and that the bridge guard suppresses exactly its own duplicate. `productTraceVitePlugin` gains `requestBridge: false`, which omits the bridge asset and script tag (fresh repos; default unchanged). The LibreChat frontend-only run additionally withholds the bridge asset at serve time (`PRODUCTTRACE_NO_BRIDGE=1` in the session harness), so the runtime wrappers are the only request source; request reconciliation against Playwright must still be 0.


*Worker rows (amendment 2026-09-24).* The runtime wraps the `Worker` and `SharedWorker` constructors (a `Proxy`, so `instanceof` and subclassing keep working), `Worker.prototype.postMessage`, and `MessagePort.prototype.postMessage` for ports bound to a worker (a SharedWorker's `port`, or a `MessageChannel` port whose partner was transferred to a worker in any post's transfer list):

```json
{ "kind": "worker.create", "worker_id": "worker:<page session>:<n>", "worker_kind": "dedicated" | "shared", "script_url": "/worker.js",
  "action_id": "<creating action or null>", "parent_continuation_id": "<creating frame or null>", "instrumented": false,
  "spine": { "action_id": "...", "function_ids": [] } }
{ "kind": "worker.postMessage", "worker_id": "...", "worker_kind": "dedicated", "script_url": "/worker.js", "via": "worker" | "message_port",
  "action_id": "...", "action_occurrence_id": "...", "parent_continuation_id": "<frame current at the call>", "terminal_owner_continuation_id": "...",
  "message_size_class": "none" | "small" | "medium" | "large" | "huge" | "unmeasured", "size_bounded": true, "transfer_count": 0,
  "instrumented": false, "spine": { "action_id": "...", "function_ids": [] } }
```

- Ownership is creation-time: the owner is the frame current at the `postMessage` call (`captureOwner`, the same rule as promise/timer/listener continuations), so a post from a timer or promise created in the handler belongs to the action.
- `script_url` drops query and fragment (as request URLs do); a `data:` script is `data:(inline)`.
- `message_size_class` is computed by a bounded walk over own data properties (no accessor is invoked, no content is recorded): `small` < 1 KiB, `medium` < 64 KiB, `large` < 1 MiB, `huge` otherwise, approximating strings as UTF-16. `size_bounded: true` marks a walk that hit its node/byte budget (the class is then a lower bound).
- A post made outside any action is counted in `stampStats().worker_posts_unowned`, not written as a row (a per-frame message loop would otherwise flood the capture). Worker creation is always a row (it is counted in `capture.summary.capture_limit_features` and makes that page's coverage incomplete; `capture.page.wrappers.worker` is `true` once the constructors are wrapped).
- The first worker constructed on a page writes one `{kind: "capture.limit", feature: "worker_fetch", reason: "worker code is not instrumented", worker_id, script_url}` row (it is counted in `capture.summary.capture_limit_features` and makes that page's coverage incomplete; `capture.page.wrappers.worker` is `true` once the constructors are wrapped).
- **Limits (not covered; stated, not silent-by-design):**
  - Service workers are not covered: `ServiceWorker#postMessage` / `navigator.serviceWorker.controller.postMessage` are not wrapped, and requests a service worker makes itself (including ones it proxies for the page) are not seen.
  - A `Worker` or `SharedWorker` constructed before the runtime installs has no worker identity; its posts are neither recorded nor counted, so for that worker the action is still silence.
  - A post made after a plain (native) `await` in code the build did not rewrite (a library, an unrewritten async function) runs with no action frame, so it is only counted in `worker_posts_unowned`, like a fetch in the same position.
  - Worklets (audio, paint, animation) and `window.postMessage` to frames or other windows are out of scope.
  - The row is written before the native call, so a post that then throws (e.g. `DataCloneError`) still has a row (it is counted in `capture.summary.capture_limit_features` and makes that page's coverage incomplete; `capture.page.wrappers.worker` is `true` once the constructors are wrapped).

### D-G1-4. Running LibreChat without backend telemetry

`scripts/m1-live.sh` reads `PRODUCTTRACE_BACKEND_TELEMETRY` (default `1`). With `0` the backend starts without the `--import=test/browser/librechat-backend-telemetry.mjs` preload and without `PRODUCTTRACE_BACKEND_SPAN_ENDPOINT`. `PRODUCTTRACE_OPENAI_FIXTURE=1` starts `test/browser/openai-compatible-fixture.mjs` on 8999 and points the backend at it (`OPENAI_REVERSE_PROXY`, placeholder key in the process environment, which dotenv does not override), so chat replies are deterministic and no model is called.

## Evidence plan

New dir `docs/evidence/g1-2026-09-23/` (never an existing dir): `RUN.md`, `LIMITS.md`, `records.jsonl`, `spans.jsonl` (backend-on run only), `causal-chains.jsonl`, `coverage.json`. Two runs of `test/browser/m1-session-headless.mjs` on one build:

1. **frontend-only**: backend telemetry off, bridge withheld. Pass = every action with ≥1 non-internal request ends `stopped_at: "network", because: "backend not instrumented"`; every other action ends with the explicit `browser` frontier; 0 route/handler/db stops; capture lossless (0 gaps, 0 drops); request reconciliation 0.
2. **backend-on**: telemetry on. Pass = final7 results reproduce: capture lossless, reconciliation 0, the nine final7 entry handlers credited to the same function ids (`m1-2026-09-22-final7/HANDLERS.md`), each of the eight mutation flows joined to a DB write whose Mongo document is confirmed in the run window.

Reported as reached / stopped at / because. Grader: a separate script recomputes the chain terminals from raw `records.jsonl` + `spans.jsonl` and compares with the builder's output.

## Second pass (2026-09-23, coordinator decisions, recorded before the rerun)

### D-G1-5. Continuations the bridge used to paper over

Diagnosis (first-pass records, see `docs/evidence/g1-2026-09-23b/RUN.md`): the bridge attributed the chat POST from a *bare dispatch frame* reached after a native `await` resumption (ambient state); the runtime wrapper correctly refuses bare frames. Two generic mechanisms replace it, no timers and no ambient fallback:

- **State-update receipts.** `useState`/`useReducer` setters (wrapped through the renderer's `currentDispatcherRef`, cached so setter identity is stable) invoked on an action-owned continuation record `{raw dispatch → owner frame}`. At the next commit, a fiber whose hook queue owns a receipted dispatch runs its passive effects (`HasEffect|Passive`) on a `state_effect` continuation of that frame; requests carry `linkage_kind: "state_effect"`. Receipts are cleared at every commit. Render and layout effects are not covered (React reports the commit after they run).
- **Await continuations.** In first-party async functions (not generators, not `for await`), the chunk pass rewrites `await E` as `__ptAwR(w=__ptAwS(w), await __ptAwL(w, E))` with a per-invocation slot and a `finally` release. Suspend captures the frame current at the await; resume continues on an `await` continuation of it; leave/end restore the resumption's ambient frame at the next suspension or settle, and at the first suspension restore the caller's frame (closing the pre-existing leak of an async function's frame into its caller).
- Negative tests: the pre-armed poll timer (build smoke) and a state update from action A plus an effect of a fiber without a receipt (`test/browser/continuations-neutral.mjs`) are never attributed.

### D-G1-6. Handler credit abstains for global listeners

`dom.action.bound_handlers {ids, library}` is recorded at dispatch from the target's fiber ancestry: registered values of the event's DOM props on host fibers, every `on*` prop on component fibers, plus the first-party functions written inside those props at each placement (chunk pass). When the action made no request and the selected frame is not bound, the credit abstains: `stopped_at: "entry_handler", because: "no element-bound handler observed in instrumented code (uninstrumented and third-party handlers are not seen); global listeners: [ids]"` (D-G1-13 and the 2026-09-24 amendment). A frame that owns a request is credited whatever bound it. Records without `bound_handlers` keep the previous behaviour.

## Third pass (2026-09-23, coordinator decisions, recorded before the rerun)

### D-G1-7. Mount effects of a receipted commit

A commit caused by a receipted state update owns the passive mount effects of fibers **newly mounted in that commit inside the receipted fiber's subtree** (`alternate === null` component fibers under it); their requests carry `linkage_kind: "mount_effect"`. Passive effects of the receipted fiber itself stay `state_effect`. Re-renders of fibers outside the subtree get nothing, and a receipt dies at the commit it is applied in.

Receipt lifetime (amends D-G1-5): a receipt is no longer cleared by every commit of any root. It is applied at the first commit after a render in which the owning hook returned that dispatch (the dispatcher wrapper marks the receipt as read), and is dropped after 50 commits without such a render. Before this change an unrelated commit between the setter call and the owning render cleared the receipt.

Negative tests (`test/browser/continuations-neutral.mjs`): an unrelated sibling that re-renders in the same commit (driven by a pre-armed ticker) is not attributed; a component mounted by a later commit that holds no receipt is not attributed.

### D-G1-8. "Bound" includes native element listeners

`dom.action.bound_handlers` = React `on*` props on the target's fiber chain **plus** first-party listeners registered through `addEventListener` on the target element or a DOM ancestor (recorded by a wrapper on `EventTarget.prototype.addEventListener` / `removeEventListener`, DOM elements only; `element_listeners` counts them). Listeners on `window` and `document` stay global.

### D-G1-9. Await continuations in library async functions

`awaitContinuations: 'all'` rewrites awaits in non-first-party async functions too, in chunks outside the first-party set included. These rewrites only carry context; they register no function ids and no spans.

### Correction to final7 `HANDLERS.md` (feedback), not a regression

final7 credited feedback to `client/src/components/Chat/Messages/Feedback.tsx:3324:3559` (`handleDownOption`). That function runs during render and returns the click handler `(e) => {…}` at `3347:3559`, which is the function that runs on the click. The credit `Feedback.tsx:3347:3559` is the correct one; final7's line in `m1-2026-09-22-final7/HANDLERS.md` is corrected here. The scorecard therefore counts 9 of 9 handlers: 8 identical to final7 plus this correction.

### Boundary recovery (G2 pipeline, recorded with the third pass)

When a function's mapped start lies before its original start, the innermost exact function that contains the mapped end is taken in two cases: the gap is at most 8 characters (`map(`), or the gap is only a name plus `:` / `={` / `}>{` (a property value, a JSX attribute value, or a render-prop child). Regression: `test/function-boundary.test.mjs` and `test/browser/manifest-regression-8.mjs` (12 final7 ids).

## Fourth pass (2026-09-23, coordinator decisions after the independent grade)

### D-G1-10. Receipts per (action, fiber), consumed by the first commit (supersedes the receipt lifetime in D-G1-5 and D-G1-7)

- **Recording.** A setter call records a receipt for its hook only when an inheritable frame is open (D-G1-11). The receipt captures the hook's last rendered state at that moment. A second setter call on the same hook keeps the first captured value and refreshes the owner. At the commit, receipts are resolved per fiber: the latest qualifying receipt's owner owns the fiber.
- **Consumption.** The first commit after a receipt is recorded consumes it, whether or not the fiber rendered. No receipt is carried to a later commit, and the 50-commit lifetime is deleted.
- **Attribution.** At that commit, the fiber's passive effects run on a `state_effect` continuation only if both hold:
  - (a) the fiber rendered in that commit (its hook was read by the render);
  - (b) a receipted hook's committed state differs (`Object.is`) from the captured value, or the setter was given a function updater.

  A no-op `setState` therefore never attributes anything later.
- **Mount effects.** Fibers mounted by that commit inside the fiber's subtree run their mount effects on a `mount_effect` continuation. "Mounted by that commit" means no alternate and not seen by any earlier commit walk.
- **Wrapper cleanup.** An effect wrapper restores the original `create` on its first call.

### D-G1-11. Only a first-party function frame is inherited

- Receipts, timers (`setTimeout`, `setInterval`), promise callbacks, `queueMicrotask`, stream listeners and await continuations inherit only from an inheritable frame. That is a first-party function frame, or a continuation created from one, open when the setter is called or the callback is created.
- The bare `dom.action` dispatch frame is never inheritable. It owns only the synchronous dispatch, and it is live only while `window.event` is that event (or a nested untrusted event).
- A bare frame whose dispatch has ended is dropped at the next function entry, owner capture or transport, and the frame current when that dispatch began is resumed. This covers a trusted `focusin` from a programmatic `focus()` inside an effect.
- A passive effect entered on a live bare frame (flushed synchronously inside the dispatch) is not owned by the dispatch; only a receipt can own it.
- Correctness no longer relies on the host clear timer. The timer is kept only where `window.event` is not observable.

### D-G1-12. Rejected awaits

`awaitLeave` settles an awaited object or function into a tagged outcome, so the `await` itself never throws. `awaitResume` restores the frame current at the await, then returns the value or rethrows the rejection. `catch`/`finally` blocks therefore run on that frame. The cost is one extra microtask tick for awaited objects and functions; primitives pass through unchanged.

### D-G1-13. The frontend credit abstention stops at `entry_handler`

The credit abstention (D-G1-6) reports `stopped_at: "entry_handler"`, `because: "no element-bound handler observed in instrumented code (uninstrumented and third-party handlers are not seen); global listeners: [...]"`. `handler` stays the backend handler-span stop. Request-less actions without an abstention stop at `browser` in both the chain builder and `chainFrontier` (`validation` for a rejected submit). `reached` keeps `dom_mutation` / `entry_handler` / `dispatch`. The G4 vocabulary is amended to match; the 2026-09-24 amendment below has the wording.

*Amendment (2026-09-24, no false negatives; supersedes the wording above).* Absence is only claimed for what Tracer sees: rows from instrumented code and the runtime's transport wrappers (fetch, XHR, EventSource, WebSocket). Web Workers, `navigator.sendBeacon`, resource loads and uninstrumented or third-party scripts' requests outside those wrappers are not seen. So:

- Every request-less action (no abstention, no rejected submit), in both the chain builder (`buildActionChains`, `describeEpisodeEvidence`) and `chainFrontier`, reports `stopped_at: "browser"`, `because: "no request could be attributed to this action from instrumented code (requests from uninstrumented scripts, workers and third-party code cannot be linked; any seen in this window are listed below as unlinked)"`. `reached` still names the deepest observed stop (`dom_mutation`, `entry_handler` or `dispatch`). `chainFrontier` no longer emits `stopped_at: "dom_mutation"` or `"dispatch"`, and no chain says "the dispatch made no request".
- The abstention says `because: "no element-bound handler observed in instrumented code (uninstrumented and third-party handlers are not seen); global listeners: [...]"`. `stopped_at: "entry_handler"` and `stop_reason: "no_element_bound_handler"` are unchanged.
- A rejected submit keeps `stopped_at: "validation"` with `because: "the same form mutated after the submit (validation); no request could be attributed to this action from instrumented code (requests from uninstrumented scripts, workers and third-party code cannot be linked; any seen in this window are listed below as unlinked)"`. The episode-level frontier says `"submit rejected by the app: the same form mutated; no request could be attributed to this action from instrumented code (requests from uninstrumented scripts, workers and third-party code cannot be linked; any seen in this window are listed below as unlinked)"`.
- The strings are exported once as `SCOPED_ABSENCE` from `analysis/runtime-attribution.mjs`.
- **Unlinked evidence, listed and never joined.** A chain with no attributed request carries `unlinked: { heading, attribution, window, requests, requests_total, server_spans, server_spans_total }`. The window, as implemented (`indexUnlinkedEvidence`), starts at the episode's first dispatch and ends at the first dispatch on the same page that is outside the episode and comes after the episode's *last* dispatch (`until: "next_dispatch"`). Without one it runs to the page's last row (`until: "page_end"`). A foreign action interleaved between two dispatches of one episode therefore falls inside that episode's window, and an unattributed request in that stretch can be listed under both chains. `requests` are `network.request` rows with no `action_id` on the same page whose `sequence` is inside the window. `server_spans` are `kind: "server"` spans whose `(trace_id, parent_span_id)` matches no request row's trace context and whose start time (server clock) falls inside the window's timestamps. Server spans carry no page, so they are not page-scoped: any unjoined span in that time range is listed, whichever page or client caused it. At `page_end`, the page's last row is its `capture.received` row, whose timestamp is the collector's close, so the span window runs to collector close. Each entry says `"attribution": "none (observed during this action's window; timestamps only order, not a join)"`. The listing never changes `chain`, `terminal`, `reached`, `stopped_at` or `because`: `chainFrontier` does not read it.
- **Coverage from the records alone.** The runtime emits `capture.page` at install and `capture.summary` at pagehide or on `captureSummary()`. The collector appends `capture.received` for each page when the run closes. The store computes coverage for each page from those three kinds only (`collector/coverage.mjs`). See G4 §3.1 for the schemas.
- Tests: `test/no-false-negatives.test.mjs` (Node) and `test/browser/unlinked-coverage-neutral.mjs` (headless, fixture `test/browser/fixtures/unlinked-request-app/`).

### Gate tests for D-G1-10 to D-G1-12

`test/browser/continuations-neutral.mjs` runs 5 page loads by default. A 1 ms unowned ticker, armed at load and gated by pointerdown / pointerup, fires through every click. Asserted in every run:

- the poll fetch, sibling, late mount, P1 (no-op setter, then an unrelated re-render) and P2 (two setters, then a later commit) are never attributed, and each fired after an action;
- P2's own effect is attributed `state_effect`;
- the catch after a rejected await, and after an awaited callee that throws, is attributed to its click;
- the fetch after a nested programmatic focus is attributed `mount_effect` to its click.

Checked against older runtimes:
- Against the third-pass runtime (`582810ae`), the rejected-await assertion fails. With that assertion skipped, P1, P2, the sibling and the poll are each attributed 1–2 times per run.
- The programmatic-focus assertion fails against the runtime before `05b1e13f`.

## Fifth pass (2026-09-23, coordinator rule after round four regressed on LibreChat)

### D-G1-14. Inheritance is decided at creation time; `current` is a strict stack (supersedes D-G1-11)

- **Creation time only.** A continuation created while an action frame is current captures that frame, whether or not a first-party function is open. This covers a promise `then`, a rewritten `await`, `queueMicrotask`, `setTimeout`/`setInterval` armed now, `requestAnimationFrame` requested now, a `MessagePort` message posted now, and an event listener added now. The bare `dom.action` dispatch frame is inheritable at creation. This restores form-library submits: react-hook-form's `handleSubmit` awaits in library code before it calls the app's `onSubmit`.
- **Amended for event listeners (2026-09-24).**
  - D-G1-19: when the dispatch of an action event (`click`, `input`, `change`, `submit`, `keydown`, `focusin`) invokes a listener, directly or through an untrusted event dispatched synchronously under it, the dispatching action wins over the owner captured when the listener was added.
  - D-G1-20 narrows registration ownership further: it no longer applies to trusted UI events or to untrusted events. It remains only for other trusted events (XHR/WebSocket, `load`, `message`, ...).
- **A callback created before the action captures nothing from it.** At run time there is no ambient fallback: a callback runs under its captured owner, or under no action. Task callbacks (timer, animation frame, message) restore `null` when they end.
- **Receipts** may be recorded while a bare frame (or a continuation of one) is current. D-G1-10 is otherwise unchanged: per action and fiber, consumed by the first commit, and attributed only on a rendered state change.
- **Strict stack.** `exit(frame)` always restores the frame that was current at `enter`. A nested dispatch frame that is still on top when its caller returns (a programmatic `focus()` inside a click handler) ends with that caller. An ended dispatch frame is popped lazily to exactly the frame current when it began. Round four's `resume` was the right target, but `exit` skipped the pop when a nested dispatch frame was on top. That left an exited handler frame as permanent ambient state, which produced the 14 misattributions to the send click (`docs/evidence/g1-2026-09-23e/RUN.md`).

### D-G1-15. React work is not a creation site for unrelated work

React multiplexes unrelated updates in one scheduler message and one commit, so the following apply:

- **Renders.** A function running while a component renders (a hooks dispatcher is installed) never inherits an action, and nothing created during a render is owned.
- **Unreceipted effects.** A passive effect, or a layout/insertion effect, without a receipt keeps the continuation React flushes it on only when that continuation is a direct action continuation: not bare, and not in a `MessagePort` (scheduler) lineage. Otherwise it runs under no action.
- **React's own listeners.** React's delegated listeners (a root or portal container, a non-delegated element set) are never owned. A portal container mounted during agent create would otherwise have run every later click in that portal, including the delete dialog, under the agent-create action.

### Gate tests for D-G1-14 and D-G1-15

`test/browser/continuations-neutral.mjs` adds the following cases to every run:

- a react-hook-form submit whose async validation is awaited in library code: the fetch is `direct` to the submit;
- a timer armed at the click's pointerdown and firing after it: unattributed;
- a timer and a promise created in action A that run after action B started: both attributed to A;
- a nested programmatic focus inside a click handler: the parent's bubbling handler runs on the click frame, not on the returned handler;
- an unowned `MessageChannel` pump's later promise reaction: unattributed.

The setInterval ticker, P1, P2, the rejected-await cases and the rest are unchanged. `test/action-context.test.mjs` (in `npm test`) covers receipt bookkeeping and the stack/ownership rules at Node level.

## Sixth pass (2026-09-23, after the fifth-pass grade)

### D-G1-16. A function updater counts as a change only if the state changed (amends D-G1-10)

"Changed" is `!Object.is(rendered state, state captured at the setter call)` for value setters and function updaters alike. A functional no-op, such as `setOpen(o => false)` while `open` is already false, no longer attributes a later unrelated re-render; round five attributed it 5/5. A function updater counts as a change without comparison only when no state was captured, i.e. the hook has not rendered since the runtime installed.

### D-G1-17. Where the hooks dispatcher lives, by React version

- The runtime locates the dispatcher from the renderer registered on the DevTools hook, using its `reconcilerVersion` / `version`:
  - React 16–18: `currentDispatcherRef.current` (ReactCurrentDispatcher);
  - React 19: `currentDispatcherRef.H` (ReactSharedInternals).
- If the version is missing, unknown, or the property is absent, nothing is guessed:
  - one `capture.limit` row `{feature: "state_receipts", reason: "dispatcher not found", react_version}` per page;
  - one console warning;
  - receipts are not recorded, so there is no `state_effect` / `mount_effect` linkage.
  - Render detection (D-G1-15) is also off in that case; this is stated in the warning.
- **Receipts are verified on** (`test/browser/react-versions-receipts.mjs`, evidence `docs/evidence/g1-2026-09-23f/`):
  - React **18.3.1** (LibreChat fixture);
  - React **19.2.4** (the only React 19 available offline; 19.2.3 was not in the npm cache and nothing was downloaded).
- On both, the neutral fixture attributes the form-library submit `direct`, the state effect `state_effect` and the mount effect `mount_effect`, and never attributes the functional no-op. The round-five runtime left the React 19 state effect unattributed.

### Amendment to D-G1-12: the await rewrite changes microtask interleaving

An awaited object or function goes through `Promise.resolve(v).then(...)`, which adds microtask ticks. Values, exceptions, `this`, `arguments` and `finally` are preserved. The **relative order of microtasks is not**: in the grader's probe the same code logs `baca2d` instrumented and `aba2cd` native. Code whose correctness depends on the exact interleaving of independent promise chains can behave differently under the rewrite. `PRODUCTTRACE_AWAIT_CONTINUATIONS=0` turns the rewrite off; span neutrality holds either way.

### Boundary rule: initializer arrows mapped from their binding name

A variable- or default-initializer arrow whose source map starts on the binding name (`const lookupOwn = <T>(…) => …` maps to `lookupOwn`) resolves to the arrow. This was LibreChat `artifacts.ts:310`, missing from the manifest in every earlier round. It was a different cause from the `.ts`-as-TSX parse fixed in the fifth pass.

## Seventh pass (2026-09-24): dispatch context crosses shadow roots

### D-G1-18. Shadow DOM targets, listeners and composed events

Before this pass a click on a button inside an open shadow root of a first-party custom element was recorded on the retargeted host, the element's own handler produced no `function.enter` rows, and the request it caused (through a composed `CustomEvent` handled by a native listener added in a React effect) was recorded unattributed while the chain claimed no request (then `no request observed`). Cause: the browser does not set `window.event` while a listener whose `currentTarget` is in a shadow tree runs, so the bare dispatch frame was judged ended and popped at the handler's first function entry.

- **Target.** When the document listener sees a retargeted event, `event.composedPath()[0]` is the real target. `dom.action.target` describes the inner interactive element and adds `composed: true` and `shadow_host: { tag, element_key? }` (the host's stamp, when stamped). `bound_handlers` is read from the real target.
- **Closed roots.** Shadow roots are recorded when attached (`Element.prototype.attachShadow` wrapper), so a closed root is known even though `composedPath()` stops at its host. The action stays on the host with `target.composed: true, target.closed_shadow: true`. With no request, the chain states that frontier: `stopped_at: "entry_handler"`, `because: SCOPED_ABSENCE.closed_shadow`, which reads "target inside a closed shadow root (the inner target and its element-bound handlers are not observable); " followed by the scoped `SCOPED_ABSENCE.no_request` sentence from PR #4 (`handler_abstention.closed_shadow: true`, `handlers_ran: [...]`; `chainFrontier` reports `stop_reason: "closed_shadow_target"`). It replaces both the plain no-request sentence and the global-listener abstention, because no binding can be checked. A frame that owns a request is still credited. Every chain of a composed action carries `target_frontier` (`{closed_shadow: true, host, because}` or `{closed_shadow: false, host, target}`).
- **Handlers inside custom elements are bound handlers.** Listeners added through `addEventListener` on shadow-tree nodes (and on a `ShadowRoot`) are recorded like element listeners (D-G1-8). The bound-handler walk is composed: target, ancestors inside the root, the root, then the host and its ancestors; React fibers start at the nearest node of that walk React rendered.
- **Dispatch frame inside shadow-tree listeners.** An unowned listener registered on a node outside the document's light tree (inside a shadow root, or not yet attached) is bound to the event it is invoked with: for exactly the duration of that call, the event stands in for `window.event`. The frame is live only while its own event is still dispatching (`eventPhase !== NONE`). This is dispatch-time identity (the same event object), not ambient state; owned listeners (D-G1-14) are unchanged.
- **Composed events are continuations of the action.** A `CustomEvent` dispatched synchronously from that handler runs its listeners on the handler's frame (strict stack), so first-party listeners on the host or ancestors, including native listeners added in a React effect, run under the action and their fetches are `direct`.
- **Tightening (all events).** A nested untrusted event keeps a bare frame live only while the frame's own event is still dispatching. Before, any later programmatic event could revive a stale bare frame that no settle had popped yet.
- **Stamps (G3).** Interactive elements inside an open shadow root of a stamped host get `data-tracer-el = <host key>><tag>#n<ordinal>` (ordinal among the root's interactive elements of that tag, tree order) and an `element.stamp` row with `placement_via: "shadow_root"`, `shadow_host`, `annotation: "skipped:shadow_root"`. OAI attributes are never written inside shadow roots. A host qualifies for a stamp when its open root holds an interactive element. `dom.action.target.element_key` uses a composed `closest`. D12 also removes `target.shadow_host.element_key` before comparing.

### Gate test for D-G1-18

`test/browser/shadow-dom-context.mjs` (fixture `test/browser/fixtures/shadow-dom-app/main.jsx`, 3 page loads by default) asserts on every load:

- `share-chip` (open root) click: target `button`, `composed`, `shadow_host.tag = share-chip`, inner stamp `<host>>button#n1`, no OAI attributes inside the root (host has them);
- the connectedCallback listener is in `bound_handlers`, and it, the method it calls and both effect listeners enter under the click;
- `/api/share` (host listener) and `/api/share-count` (ancestor listener) are `direct` to the click; the chain credits the inner listener (rooted) and lists both requests;
- `lock-chip` (closed root) click: host target with `closed_shadow`, chain `entry_handler` / closed-root frontier;
- negatives: `Refresh` clicks before and after are never attributed to either share request; a later untrusted click on the inner button and a later programmatic `share` event are unattributed.

Against the runtime at `main` ff9210ee the first assertion (real target) fails. `test/frontend-only.test.mjs` covers the closed-root frontier at Node level.

### D-G1-19. Dispatch wins over the listener's registration owner (amends D-G1-14 and D-G1-18)

The wrong credit this rule addresses comes from D-G1-14 and predates this PR. It is present on `main` ff9210ee. The shadow-root fix makes it reachable through shadow-root dispatches as well.

The case: a React effect re-adds a native listener with a dependency that changes on every render (`[onShare]`, recreated each render). Click A updates state, and A's commit re-adds the listener, so under D-G1-14 the listener is owned by A. A later trusted click B dispatches the event, and its fetch was credited to A. Verified before the change, on `main` and on 3e85eee7: `/api/reshare` and `/api/ping` were credited to "Bump".

- **The walk.** An owned listener, when invoked, walks the current frame's synchronous stack (function frames' `parent`) to the nearest dispatch frame. The listener runs on the current frame only if that is the dispatch frame of an **action event** (`click`, `input`, `change`, `submit`, `keydown`, `focusin`) and the frame is live: the invoking event (standing in for `window.event` as in D-G1-18) is that action event, or an untrusted event dispatched synchronously under it.
- **What the walk covers.** The dispatch frame itself, or a handler frame under it. A composed or other synthetic event dispatched synchronously from a handler therefore counts. `stampStats().owned_listeners_dispatch_won` counts these invocations.
- **Otherwise (as of 12feafb8)** the registration owner applied: any continuation on the stack stopped the walk, as did any trusted event that is not an action event.
- Unowned listeners and React's delegated listeners are unchanged.

**Wrong credits remaining under D-G1-19 alone**, reproduced by the grade (`docs/evidence/pr-shadow-dom-context-grade-2026-09-24/GRADE.md`, item 3a′ and probe 3b). All three exist on `main` ff9210ee as well:

1. **Trusted events that are not action events** keep the registration owner:
   - a `focus` fired by `el.focus()` inside a click credits Bump;
   - a user `pointerdown` on Ping credits Bump.
2. **A timer armed by another click** (Later) that dispatches the event credits the listener's registering action (Bump), not Later.
3. **A load-time timer** dispatching the event credits the last Bump.

D-G1-20 closes these paths for listeners owned through D-G1-14.

Gate test (`test/browser/shadow-dom-context.mjs`, every load):
- **Setup:** "Bump" (A) re-renders `ReshareCard`, whose effects re-add a `share` listener on a second `share-chip` and a native `click` listener on a light-DOM "Ping" button, both with per-render dependencies.
- **Shadow-root case:** a trusted click on the chip's shadow button gives `/api/reshare` `direct` to that click.
- **Light-DOM case:** a trusted click on Ping gives `/api/ping` `direct` to Ping, with Ping's listener credited as the entry handler.
- **Bump:** neither request is credited to Bump, and Bump's chains list no request.
- **Outside a dispatch:** at 12feafb8 a later programmatic `share` took the registration owner, the last Bump. D-G1-20 replaces that assertion.

The continuations suite and D12 pass with the rule.

### D-G1-20. Registration ownership never applies to UI events or to programmatic events (amends D-G1-14 and D-G1-19)

An owned listener (one added while an action frame was current) is invoked with an event. What it runs under depends on that event:

- **A trusted UI event** never falls back to the registration owner. That is any `UIEvent` (mouse, pointer, drag, key, focus, input, composition, touch, wheel) or `ClipboardEvent`, plus these types by name: `pointer*`, `mouse*`, `drag*`, `composition*`, `key*`, `focus*`, `touch*`, `click`, `dblclick`, `auxclick`, `contextmenu`, `blur`, `wheel`, `input`, `beforeinput`, `change`, `submit`, `drop`, `paste`, `copy`, `cut`, `select`, `selectstart`, `selectionchange`, `scroll`, `scrollend`, `gotpointercapture`, `lostpointercapture`.
  - It runs on the current frame if the synchronous stack reaches a trusted dispatch frame whose event is still dispatching (`eventPhase !== NONE`). Example: a `focus` from `el.focus()` inside a click handler runs under the click.
  - Otherwise it runs under no action. Example: a `pointerdown`, which starts no Tracer action.
  - Counted in `owned_listeners_dispatch_won` / `owned_listeners_ui_unowned`.
- **An untrusted event** (`dispatchEvent`, which runs its listeners synchronously) runs on the dispatcher's own frame. That is a handler under a live action, a continuation created under some action (a timer armed by Later), or nothing (a load-time timer, a console call). Counted in `owned_listeners_dispatcher`.
- **Any other trusted event** (XHR/WebSocket, `load`, `message`, ...) follows D-G1-19: a live trusted action dispatch on the stack wins, otherwise the registration owner applies. These events are not caused by a user dispatch, so the owner captured when the listener was added is the only evidence.

The untrusted-event rule is needed for the load-time-timer case: `share` is not a UI event, and without the rule it would keep Bump as its owner.

Gate test (`test/browser/shadow-dom-context.mjs`, every load):
- a `pointerdown` listener on Ping re-added under Bump: `/api/ping-down` is unattributed (it previously credited Bump);
- a programmatic `share` from `page.evaluate`: unattributed;
- a programmatic `share` from a timer armed at load: unattributed;
- a programmatic `share` from a timer armed by the "Later" click: credited to Later;
- a `focus` fired by `el.focus()` inside the "Focus it" click, on a listener re-added under Bump: `/api/focused` is credited to that click;
- no request anywhere in the run is credited to Bump, and Bump's chains list no request.

Against the 12feafb8 runtime the `pointerdown` assertion fails.

Remaining listener limits:
- Listeners on React-rendered inputs, forms and media elements are never owned, because `reactEventTarget` over-matches `__reactEvents$`; this is pre-existing.
- A trusted non-UI event (for example an `<img>` `load`) still takes the registration owner by design.

Not covered: `onclick` properties and `handleEvent` objects inside shadow roots (not seen by the `addEventListener` wrapper); declarative closed shadow roots (never pass through `attachShadow`); nested shadow roots are not stamped (the target and listener rules do cross them).

Further limits (from the grade):
- Shadow roots filled after connect (Lit/Stencil style, in a microtask) are not stamped, on the host or inside, until a later React commit touches the host.
- The bound-handler walk follows `parentNode`/`host`, not `assignedSlot`. For a slotted light-DOM target, shadow-internal listeners around the `<slot>` are not counted as bound.
- A closed root nested inside an open root is not flagged `closed_shadow`: `closedHost` (`src/runtime-attribution-browser.js` L456) tests `event.target` only when nothing was retargeted, and should test the real target (`dispatchTarget`).

## Eighth pass (2026-09-24): every trusted user event is recorded (branch `fix/trusted-events`)

### D-G1-21. Record every trusted user event; prove which kinds are observed (amends D-G1-20)

The defects this answers, stated generically: a drag built on pointer events left no rows (pointerdown/pointerup were never recorded), so its request had no owner; a hidden file input's `change`, reached through a visible button, was treated as a separate unexplained action; a keyboard shortcut was recorded with no modifiers. Before this pass the runtime listened for six names (`click`, `input`, `change`, `submit`, `keydown`, `focusin`) on the document.

**Rule 1: kinds are discovered, not listed.** At install the runtime enumerates every `on*` event-handler accessor (a property with a setter) on `Element.prototype`, `HTMLElement.prototype`, `Document.prototype`, `Window.prototype` and the window object. It adds the kinds the platform dispatches with no `on*` property (`focusin`, `focusout`, `compositionstart`, `compositionupdate`, `compositionend`). It registers one passive capture listener per kind at the window and inside every shadow root (attached through the wrapped `attachShadow`, open or closed). Each event is handled once, by the first listener that sees it. `capture.page.user_events.listened` lists these kinds. The Chromium that Playwright 1.62 ships exposes 142 kinds through these accessors; with the 5 handler-less kinds the runtime listens for 147. A kind not in that list is not observed, and the row says so by omission.

**Rule 2: what is recorded is decided per dispatch, by interface.** A dispatch is recorded when:
- it is trusted, and
- it is an instance of `UIEvent` (mouse, pointer, wheel, drag, keyboard, focus, input, composition, touch), `ClipboardEvent`, `SubmitEvent`, `ToggleEvent` or `CommandEvent`, or it is a plain `Event` whose kind is in `user_plain_kinds`.

`user_plain_kinds` covers the kinds that are user-caused state changes but have no interface of their own: change, input, submit, reset, toggle, beforetoggle, select, selectstart, selectionchange, cancel, close, scroll, scrollend, search, fullscreenchange/error, pointerlockchange/error, visibilitychange and command.

No name list decides what is recorded within the UIEvent family. Trusted events that are not user events (load, error, progress, animation, media, message ...) are counted per kind in `capture.summary.user_events.not_user_by_kind`, and no row is written for them. Untrusted events keep today's treatment: they are never recorded, and their listeners run on the dispatcher's frame. `untrusted_skipped` counts them.

The data lives in one place, `analysis/user-event-model.mjs` (`USER_EVENT_KINDS`, `createUserEventModel`). `scripts/build.mjs` inlines that function verbatim into the runtime, so the browser and Node read the same lists. `observedEventKinds(capturePage)` returns the listened kinds for a page; for a page from an older runtime it returns the six legacy kinds, flagged as legacy.

**Rule 3: continuous kinds are coalesced, and properties decide what is continuous.**
- **PointerEvent.** `button === -1` with the pointer's `buttons` unchanged is continuous (move, over, out, enter, leave, rawupdate). A `buttons` bit set is a press; a bit cleared is a release. Any other button event is an activation (click, auxclick, contextmenu).
- **MouseEvent (compatibility events).** A bit set or cleared is a press or release. `detail > 0` is an activation. Anything else is continuous.
- **WheelEvent.** Continuous.
- **TouchEvent.** A change in `touches.length` is a press or release; anything else is continuous.
- **KeyboardEvent.** keydown with `repeat` is continuous; keydown is a press; keyup is a release.
- **Any other kind.** Continuous only if it is in `continuous_kinds` (scroll, selectionchange, drag, dragover, dragenter, dragleave), where no property decides. Unknown kinds default to discrete.

A discrete dispatch writes one `dom.action`. The first continuous dispatch for a given (kind, control, gesture) writes one `dom.action` with `coalesced: true`. Every later event of that range runs under a dispatch frame of the same action, so a scroll or move listener's request is owned by the range. One `dom.action.range` row closes the range. It carries `count`, `first_timestamp`, `last_timestamp`, `bounds` (min/max client x/y, first, last), `wheel` (summed deltas) and `scroll` (first and last scroll position of the target). A range is closed by:
- the next top-level discrete dispatch,
- a capture summary,
- `pagehide`.

A range has no mutation receipt.

**Rule 4: gesture identity is ordering state, never a clock.**
- A gesture opens at a press when the device held nothing. It ends at the release that leaves the device holding nothing.
- Pointer gestures are keyed by pointerId, keys by `code`, touch by touch set.
- Every other event takes the most recently opened gesture that is still held. Failing that, it takes the gesture released in the current task (the host's next task clears it): the click after a pointerup, the compatibility mouseup. Failing that, it takes none.
- Continuous pointer or mouse events with nothing held take the pointer's hover segment. A new segment starts after every press.
- Window `blur`, or the page becoming hidden, resets held state.

Rows carry `gesture_id` and `phase` (`press`, `release`, `continuous`, `activation`, `discrete`).

**Rule 5: each row carries what its event carries.** Every row has:
- `interface`;
- the composed target (as before);
- `key` for any KeyboardEvent: `key`, `code`, `altKey`/`ctrlKey`/`metaKey`/`shiftKey`, `repeat`, `location`, `isComposing`. A printable key pressed without Ctrl, Alt or Meta is text: its key and code are folded to `"Printable"` as before, unless `inputText` is on. With one of those modifiers it is a command and is recorded as pressed (outside credential fields). Named keys are recorded by name; before this pass they were folded to `"Other"`;
- `pointer` (`pointerType`, `pointerId`, `button`, `buttons`, `pressure`, `isPrimary`, `detail`, client x/y, modifiers), `mouse`, `touch` or `drag` (types, file count, effects);
- `input` for InputEvent: `inputType`, `isComposing`, `data_length` and `credential_field`. Typed text (`data`, and the key and code of a printable key pressed without Ctrl, Alt or Meta) is recorded only when the plugin option `inputText: true` is set, and then only in a non-production build (warned at build; a production build reports `production_off`). `capture.page.input_text` states the mode (`off` by default). In password and credential fields (`autocomplete` current-password, new-password, one-time-code, cc-*) text is redacted in every mode: `data_redacted: "credential_field"`, keys folded to `"Printable"`, even with a modifier held. Amended 2026-09-24 (coordinator decision): an earlier head of this branch (96c4d2f2) recorded `data` by default;
- `composition`, same rule as `input`;
- `clipboard.types`: never the data;
- `toggle` (old and new state);
- `related_target` for focus events;
- `files` (count and MIME types, never names or contents) for a file input;
- `form` and `submitter`, as before.

A field's value is never recorded.

**Rule 6: the liveness mark applies to every discrete event, and synthetic activation is linked by identifier.** PR #11's mark (`gesture: false`, `caused_by_action_id`) now applies to any discrete event dispatched while an action's code is provably live, for example:
- `el.focus()` firing focus, focusin, blur and focusout;
- `requestSubmit()` firing submit.

A dispatch frame counts as provably live only where `window.event` is observable.

A file chooser's `input`/`change` does not qualify. It arrives in a later task, after the user picks a file, so the liveness mark cannot and does not claim it. Instead, when live action code dispatches an untrusted `click` on an element (`hiddenInput.click()`), the runtime records a synthetic activation of that element. The element's later trusted events carry `opened_by_action_id`, `opened_by_continuation_id` and `opened_via: "synthetic_click"`. A press or activation by the user on the element clears the link. The change stays a gesture (the user's choice in the picker) with its own episode, and it is listed under the opener's episode as `opened`.

**Mutation receipts.** A receipt's window ends at the host's next task (as before) or at the next top-level user dispatch, whichever comes first. A submit's 750 ms validation window ends at its timer or at the next top-level discrete dispatch; a pointer move does not end it. Before this pass, windows overlapped: a keydown's receipt also held the mutations of the input that followed it in the same task. Now each window holds only its own dispatch's work. A nested (caused) dispatch closes nothing.

**Listener ownership (amends D-G1-20).** "A trusted UI event" in D-G1-20 is now the model's `isUserEvent`; the name regex is gone. Every recorded kind starts an action, so an owned listener invoked by a trusted user event always finds a live dispatch. `owned_listeners_ui_unowned` is reached only by a user kind the runtime does not observe. The D-G1-20 example "a `pointerdown`, which starts no Tracer action" no longer holds: the pointerdown is an action, and its listener's request is owned by it.

**Episodes (G5 rules unchanged for their six kinds).** `indexWorkflowEpisodes` applies the existing rules only to `episode_kinds` (click, input, change, submit, keydown, focusin), so those episodes are built from the same inputs as before. A row of any other kind recorded with a `phase` is gesture context:
- On the same control and gesture as an episode-kind row, it belongs to that row's episode: as a member if it carries evidence (request, mutation receipt, worker post), otherwise listed under `gesture_action_ids`.
- With no such row, the gesture's context rows on one control form an episode only if one of them carries evidence. The latest such row carries it; a drag is pointerdown + move range + pointerup.
- A caused context row is listed under the causer's `caused` only when it carries evidence.

`recent_actions` and `element_history` count context rows that no episode holds (`context_omitted`) and list them only with `include_context: true`.

Gate test: `test/browser/trusted-events.mjs` (neutral fixture `test/browser/fixtures/trusted-events-app/`: Radix Select and Dialog, a pointer-captured canvas drag, a hidden file input, Ctrl+Shift+K, a scroll list, copy/paste, `<details>`, a native `<select>`, a text field, an untrusted `dispatchEvent`), three page loads, raw rows and MCP over stdio. Evidence: `docs/evidence/pr-trusted-events-2026-09-24/`.

Not covered:
- iframes and workers (separate realms);
- kinds with neither an `on*` accessor nor an entry in the handler-less list;
- events a page dispatches before the runtime installs;
- Playwright's buffer-based `setFiles`, which dispatches untrusted input/change (a real user's pick is trusted; the gate test uses a file path, which Chromium dispatches as trusted);
- a gesture that spans a lost release, when the window keeps focus.

### D-G1-21a (2026-09-24, after the independent grade of 53eb8882): amends D-G1-21

The grade (`docs/evidence/pr-trusted-events-2026-09-24/GRADE.md`) found two regressions and seven defects. The rule still holds: record every trusted user event; lists classify, they never decide. Evidence: `RUN-3.md`.

- **Recording is inverted.**
  - A trusted event of a listened kind that is dispatched in the document is a user event unless one documented classification marks it not user-caused: `not_user_interfaces` (Progress, Animation, Transition, Message, Error, page lifecycle, device, gamepad, storage …) or `not_user_kinds` (load, error, readystatechange, media loading and playback progress, online/offline …).
  - Unknown kinds are user events.
  - Not-user events are never actions. The first of each kind per target leaves a `dom.event` row (`user: false`, on its own `event_sequence` counter, because lifecycle events arrive in network order); every one is counted.
  - `textInput`, `DOMActivate`, `DOMFocusIn` and `DOMFocusOut` are listened. React's `onBeforeInput` work is owned by the `textInput` it listens to. popstate, hashchange and invalid are recorded.
  - Untrusted events leave `dom.untrusted` rows (kind, target, and the live action that dispatched them, if any), never actions.
- **Typed characters.** A printable key is recorded as pressed only with Ctrl or Meta held *without* Alt or AltGraph. Alt/Option and AltGr combinations type characters and are folded to `Printable` unless `inputText` is on.
- **Hover and wheel are segments.**
  - Pointer and mouse movement and boundary events with nothing held form one range per pointer segment across controls; wheel joins it. The range is one `dom.action` plus one `dom.action.range`, which records `by_kind`, `controls`, `first_control` and `last_control`.
  - Every (kind, control) crossed still runs its listeners under its own action id. Its `dom.action` row is written only when a row carrying that id is about to be emitted, that is, when work ran under it. Such rows are listed in the close row's `with_work`.
- **Ranges close as they go.** A range closes:
  - at its gesture's release;
  - at a top-level discrete dispatch of another gesture (or any, for a range with no gesture);
  - after 1,000 events;
  - or after 1 s idle (a host timer).

  The last two bounds only split emission. The collector sink ships `capture.summary` in its own first pagehide beacon.
- **Mutation receipts.** A receipt window ends at the host's next task or at the next top-level dispatch. A validation window (a submit's 750 ms, or a dispatch the browser is about to validate) is not ended by a pointer move or by a dispatch of its own gesture.
- **Caused dispatches run on the causer.**
  - A trusted event dispatched while an action's code is provably live (`el.focus()`, `requestSubmit()`) is recorded as before (`gesture: false`, `caused_by_action_id`). It runs on a dispatch frame of the *causing* action (`runs_on_action_id`), so its listeners' work is that action's work, as it was on main. It has no receipt of its own.
  - When the cause is abstained, the dispatch keeps its own frame.
- **`opened_by`.** The link is carried only by events that are not UIEvents (a picker's input, change and cancel). Any trusted UIEvent on the element that live action code did not dispatch clears it.
- **Gestures.**
  - Pointer and keyboard are separate tracks. Activation and compatibility events take their pointer's gesture, never a held key's.
  - Boundary notifications (`boundary_kinds`) never press or release.
  - One touch contact's pointer, touch and compatibility mouse events share a gesture. HTML drag events carry the gesture the drag started in.
- **Windows.** An action's window (unlinked evidence, untrusted-skip reasons) closes at the next discrete, non-caused dispatch outside the action's own gestures; older runtimes close it at any dispatch.
- **MCP.**
  - `coverage.user_events` on `action_chain`, `recent_actions` and `element_history`, and `user_events` on `page_requests`: listened kinds and per-kind counts (recorded, coalesced, untrusted skipped, not user).
  - An action whose window holds a skipped untrusted event followed by a request says so in its coverage reasons. An unowned request says the same in `page_requests`.
  - `context_omitted` never hides a row that owns evidence.
  - A chain line names the requests of the events its action caused or opened. An action whose only requests came from an element it opened reads outcome `opened`, not `no_request`.
  - A release names the control its gesture was pressed on.
  - `coverage.unobserved` is not changed here (it converges with fix/honest-coverage).

**Rebase onto main 3123791c (2026-09-24, with fix/honest-coverage #18).**
- **One source for observed event kinds.** `capture.page.observes.events.recorded` is the dispatch listeners' list, the same kinds as `capture.page.user_events.listened`. #18's independent enumeration (the on* prototype chains of HTMLElement, Document and the window, plus `handlerless_kinds` from `analysis/user-event-model.mjs`, which now includes the touch kinds) gives `unobserved`. On Chromium that list is empty; it stays a lower bound. `coverage.unobserved` reads `observedEventKinds()`.
- **Untrusted skips are a window fact.** An untrusted (synthetic) event skipped in an action's window, followed there by an unattributed request, is `window_evidence.untrusted_followed` and a `windowCoverageReasons` entry.
- **Window boundaries.** The gesture boundary (D-G1-21a "Windows") applies in #18's `windowOf`, and #18's page-end grace is kept for the last window.
- **Range closes stay inside the grace.** Ranges close as they go, and a range still open is closed by the summary at pagehide, so no range row is written after the page's last runtime row.

## Ninth pass (2026-09-24): the credited handler is the one that ran (branch `fix/handler-binding`, stacked on `fix/trusted-events`)

### D-G1-22. Handler binding is observed at dispatch, never inferred from a prop name (amends D-G1-6, D-G1-8, D-G1-13; supersedes the `entry_hint` priority of 4.1 where a binding is observed)

The defect, stated generically: `dom.action.bound_handlers` was built from a static prop-name-to-event map (`click` → `onClick`, `change` → `onChange`, ...). React decides which native event runs a prop: a checkbox's or radio's `onChange` runs on `click`, `onDoubleClick` on `dblclick`, library components call their props from their own handlers. So a React checkbox's click listed no bound handler, the handler that did run was named a "global listener", and a request-less action abstained falsely ("no element-bound handler"). The same heuristic, through `entry_hint`, credited a document capture listener that entered first with a request its element's handler issued.

**Rule 1: binding is observed.** At function entry the runtime records a binding when all of these hold:
- the frame is at depth zero: its parent is a live trusted dispatch frame (nothing first-party between them: React's root listener, a library's listener or a native listener called it while the browser was dispatching that event), or a bare continuation that dispatch created (`ran: "dispatch_continuation"`: a library that awaits before calling the app's handler);
- the function is held by the dispatch target's element chain: it is the value of an `on*` prop of a fiber on the target's fiber chain (host or component, current and alternate props, crossing portals as React does), or a first-party function written inside such a prop at that placement (build-time `bound`), or a first-party listener added with `addEventListener` for this event type on the event's `currentTarget` element.

The row is `handler.binding {action_id, event_kind, native_event_type, prop_name, function_id, continuation_id, parent_continuation_id, ran, via: prop_value | written_in_prop | element_listener, fiber: {kind: host|component, name, depth}, placement_id, invoked_by: react_event_system | native_listener | dispatch_continuation, listener_on, also_held_by}`: one row per (action, function, prop, holder); the matching is by function identity (source-function id), never by name. `target_element_key` is not on the row (it would break D12); readers join it from the action's `target.element_key`. A prop that never runs during any dispatch is declared, never bound. A binding is evidence of what ran on that dispatch only; every dispatch records its own.

**Rule 2: what is not a user binding.** A dispatch caused by live code (the `gesture: false` mark of rule 6 in D-G1-21: `el.focus()` firing `onFocus`, `requestSubmit()`) gives the same fact as `handler.invocation` with `invoked_by: "app_code"`, `dispatched_by` (who called it) and `caused_by_action_id` / `cause_abstained`; it is never a binding to a user event. A prop a component calls from a timer runs with no dispatch frame and is neither.

**Rule 3: the declared list keeps no map.** `dom.action.bound_handlers` is now `{basis: "declared", ids, library, element_listeners}`: every first-party function held by any `on*` prop on the chain, written inside one, or listening for this event type on the target or an ancestor. It says what could run; nothing decides from it on stores that carry bindings. `element.stamp.handlers` carries `handlers_basis: "declared"` (the `event` there is the prop name without `on`, lower-cased: a label, never an observation). `capture.page.handler_bindings: "observed"` marks pages from this runtime. The runtime's `EVENT_PROPS` map is deleted.

**Rule 4: credit and abstention read the observations.** For an action whose dispatch carries bindings (or a declared list with a basis):
- a frame that owns a request is credited whatever bound it (unchanged). Which frame owns it is decided first by the request's own continuation lineage (`parent_continuation_id` up to a depth-zero frame), then by the runtime's terminal owner, which now ranks an observed-bound frame above `entry_hint` above any other depth-zero frame;
- with no request, the credit is a handler observed bound to the dispatch: the frame owning the terminal evidence when it is bound, else the first bound frame that ran (rooted only if it owns the evidence);
- the abstention is stated only when no bound handler ran: `stopped_at: "entry_handler"`, `because: "no element-bound handler ran: no instrumented function held by the target's element chain (an on* prop, or a listener on the element) was invoked for this dispatch (uninstrumented and third-party handlers are not seen); global listeners: [...]"`, `basis: "observed"`, `handlers_ran`.

Rows recorded before this pass keep D-G1-6 unchanged (their declared list was filtered by the old runtime's map and cannot be re-observed); their abstentions carry `basis: "declared"` and the old sentence.

**Rule 5: readers print observations first.** The element index aggregates `handler.binding` / `handler.invocation` per element key (native event type, prop, invoker, count of dispatches). `resolve_element` and `element_history` list `observed_bindings` before the declared `handlers` (`handlers_basis`), print `observed: <handler> as onChange on click (React) ×N` first, and name declared handlers never observed running. `action_chain` carries `bound_handlers {basis, observed, declared}`, the credited handler's `binding` on its stop, `[bound: onChange on click (React)]` in the chain line, and one line each for user bindings and app-code invocations.

Identifiers only: the dispatch frame, the fiber, the function id, the continuation. No timing.

Gate test: `test/browser/handler-binding.mjs` (neutral fixture `test/browser/fixtures/handler-binding-app/`: a state-only checkbox by mouse and by Space, a checkbox and a radio that send requests, text, `<select>`, range, a state-only `onDoubleClick`, Enter in a form, Radix Select by pointer and keyboard in a portal, a controlled Radix Dialog dismissed by Escape and by the overlay, a zustand store-writing `onClick`, a declared `onContextMenu` never run, `.focus()` from a click and from a mount timer, a prop a component calls from a timer, contenteditable `onInput`, and a document capture-phase `click` listener ahead of every React click handler), three page loads, raw rows and MCP over stdio, run three times. Negative control (base 96c4d2f2): the state-only checkbox and the double-click abstain falsely naming their own handler as a global listener, and the checkbox/radio requests are credited to the capture listener. Evidence: `docs/evidence/pr-handler-binding-2026-09-24/`.

Not covered:
- the invoker label (`react_event_system`) is inferred from the `currentTarget` being a React-marked container element; a non-React listener on a React root or portal container (for example `document.body` holding a portal) is labelled React. The binding itself does not read the label;
- a handler reached only through first-party code the transform does not instrument, or a prop value that is a library function which calls a first-party function not written inside the prop (the library's callback is then depth zero but held by no prop): no binding, so a request-less action abstains;
- the continuation case requires the continuation to have been created while the dispatch frame was current and nothing first-party ran in between; a library that schedules through a channel the runtime does not wrap (native `await` inside uninstrumented library code) loses the link, and the handler runs unbound;
- closed shadow roots (D-G1-18): the inner target's chain is not observable; the closed-root frontier is unchanged.

### Amendment to D-G1-22 (2026-09-24, after the independent grade)

**Holder by observation (changes rule 1).** One function can be held by several (prop, holder) pairs on the chain: `onKeyDown={h} onClick={h}`, or `onMouseDown={h}` on a button inside a `<div onClick={h}>`. The row used to take the first match in prop order. The holder is now decided from what the dispatch shows at entry:
- **The handler's first argument.** The build passes it to `enter()` as `a0` when the function's first parameter is a plain identifier; a function behind the call proxy passes its first call argument either way. The runtime reads it only while React's own dispatch is invoking, and never stores or emits it. When it is React's SyntheticEvent for the dispatching native event (`nativeEvent === event`), its `_reactName` is the prop React invoked and its `currentTarget` the host holding it. This is `holder_resolution: "synthetic_event"`, or `"synthetic_event_name"` for a component prop a library called with the event.
- **Otherwise, React's event system invokes host props only.** When React is the invoker, only host holders are candidates. One candidate is `"unique"`. One prop passed down unchanged through component props is `"passed_down"`, with the innermost holder.
- **Otherwise, `"ambiguous"`.** The row says `ambiguous: true` and lists every holder under `holders`. `prop_name` is null, or the one shared prop name when only the host differs. Prop order never decides.

A function React runs on two holders in one dispatch (target and ancestor both `onClick={h}`) writes one row per holder when the synthetic event tells them apart. When it cannot, the invocations are one ambiguous row.

**An observed-bound frame outranks an unbound one (changes rule 4).** When any frame observed bound to the dispatch ran, the credit is a bound frame: the first bound one owning the evidence, else the first bound one. This holds even when an unbound depth-zero frame (a document capture listener that posts analytics) owns the request. The credited entry carries `unbound_request_issuers` (function, request ids). The MCP prints "Requests issued by a frame not bound to this element …". With no bound frame, a request owner is credited whatever bound it, as before.

**Library-mediated code is not a global listener (changes rule 4).** A first-party function can enter at depth zero for a dispatch, held by no prop, called neither by a document nor by a window listener: from a library's prop handler that React invoked, from a library's listener on an element, or in a bare continuation of the dispatch. Such a function writes `handler.via_library`. When no bound handler ran, the abstention names these functions separately: "no element-bound handler of instrumented code ran; ran through library code on the element chain (not bound to an element prop Tracer can see): [ids]; global listeners: [...]", with `stop_reason: "handler_via_library"` and `ran_via_library`. Examples are react-hook-form's `handleSubmit(onValid)` with a named `onValid`, and a vendor component calling a `callback` prop. They are never listed as global listeners.

**Untrusted dispatches (changes rule 2).** `el.click()` and `dispatchEvent` from app code open no action frame. When a first-party function held by the untrusted event's target chain (or a listener on its currentTarget element) runs during that dispatch, and React or an element listener is the invoker, the runtime writes one `handler.invocation` per (event, function). The row carries `untrusted: true`, `invoked_by: "app_code"`, `ran: "during_untrusted_dispatch"`, the holder resolution above, and the calling frame's action as `action_id` and `caused_by_action_id`, or `cause_abstained`. It is never a binding. It is listed on the causing action's chain and not joined to the clicked element's key, because no action exists on that element.

**Corrections to "Not covered".**
- Item 3 is withdrawn for react-hook-form 7.85. With its native `async`/`await`, the inline callback's binding survives as `dispatch_continuation` (grade probe b3).
- Replacing item 1: the `a0` read happens only under React's dispatch. An app object passed as the first argument to a function React invokes is read for `nativeEvent` and `_reactName`. A Proxy-backed object (MobX, Immer) would see those reads.

### Second amendment to D-G1-22 (2026-09-24, after the regrade at 70fbd740)

- **Capture and bubble passes.** React 17–19 names its SyntheticEvent with the bubble name (`_reactName: "onClick"`) even while it runs `onClickCapture`. The pass is read from observed dispatch state instead: the native event's `eventPhase` while React's container is the `currentTarget`. `1` means React's capture listener, which runs the `on<X>Capture` props; `3` means its bubble listener, which runs `on<X>`. `2` (at target) is undecided. React's `Capture` suffix is the only name convention read, and it only splits the two passes. A function React runs in both passes writes one row per pass.
- **The argument read.** Change 1's "only while React's own dispatch is invoking" note is corrected. The read happens for any object argument of a prop-held function, whenever a host prop holds it and React's container is dispatching; that includes a library calling a component prop. Only own data properties are read (`Object.getOwnPropertyDescriptor`, no getters). A Proxy's `getOwnPropertyDescriptor` trap still runs, because no operation on a Proxy is unobservable. App code run by that read is not recorded: `enter()` returns an unrecorded frame while the read is in progress. An argument that is seen and is not React's event for the dispatch marks a library call. Host holders are then not candidates, and the row says `holder_resolution: "library_call"`.
- **Page-level listeners.** A listener on `<body>`, `<html>` or a React root or portal container is never element-bound; it stays a global listener. Bound frames are ranked by nearness to the target (`holder_distance`, in fiber hops). The first bound frame that issued a request by its own lineage wins; otherwise the nearest bound frame that owns the evidence; otherwise the nearest. The runtime's terminal owner applies the same nearness among bound frames.
- **Ambiguity text.** Rows carry `ambiguity_reason`. The possible reasons are `no_argument`, `argument_not_a_react_synthetic_event`, `event_for_a_different_native_event`, `argument_not_readable`, `react_name_matched_no_single_holder`, `capture_bubble_undecided`, `argument_not_read_component_prop` and `not_invoked_by_react`. The MCP prints the reason that was observed.
