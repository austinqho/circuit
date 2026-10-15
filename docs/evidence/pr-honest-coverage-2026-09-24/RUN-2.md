# fix/honest-coverage, run 2: regrade items 2–6 (2026-09-24)

This run applies GRADE.md (73e451c9) items 2–6 on top of 73e451c9. RUN.md is unchanged. Outputs are under `run-2/`. Item 1 (drop the nested-call merge) and the rebase onto `fix/server-outbound` come after that branch merges.

One part of item 1 is already in, because it was small and the grader's probe g needed it: a nested client span is now the same call only when it is a direct child with the same method and destination. A client span that has no destination of its own and encloses other outbound spans (an SDK grouping span) is not a call at all. Probe g now reads `server_hop` in both cases (below). The fixture additions for probe g are deferred to item 1 as instructed.

## What changed, per item

| item | change |
|---|---|
| 2 transient frames | The runtime runs a native MutationObserver on the document and on every shadow root (hooked through `attachShadow`). It records each inserted navigable container (`iframe`, `frame`, `object`, `embed`: the HTML elements that create a child browsing context) as a `capture.limit {feature: realm, via: "inserted"}`. The origin is decided from the element's `src`/`data`/`srcdoc`/`sandbox` attributes; content is never read. A later check no longer flips that status while the frame is on its initial about:blank document. A frame (or worker) that appears in an action's window is a window reason. |
| 3 WebSocket | Every `WebSocket#send` is a `network.send` row: byte size, the connection's occurrence id, and the owner at the call (else `issuer`). Its content is never recorded. A request-less chain with its own send stops at `stopped_at: "websocket"` ("sent 1 WebSocket message on ws://…/ws (2 bytes); a message carries no trace context, so what it caused on a server cannot be attributed to this action …"), with outcome `stopped` / `Stopped at websocket: …`. Every send in a window is a coverage reason. |
| 4 event basis, wrappers | The event list adds the kinds dispatched with no `on*` property: `composition*`, `focusin`/`focusout` (the same list as `fix/trusted-events`) and `touch*`. These are added as data rather than imported, because `analysis/user-event-model.mjs` does not exist on this branch and adding it would be an add/add conflict with that branch. `lower_bound: true` is set, and every text says "at least N". Each `capture.summary` compares every installed wrapper (fetch, XHR open/send, EventSource, WebSocket and its send, Worker, SharedWorker) with the live global and lists any that differ in `wrapper_replaced`. Each one becomes an `unobserved` transport entry with `status: "replaced"` and a coverage reason. |
| 5 page end | The last window ends at the page's last runtime row + 2000 ms (`page_end_grace_ms`), for pagehide beacons. It never ends at the collector's run-close `capture.received`. |
| 6 wording | The request-less headline reads "N recorded request(s) left this page …" and keeps the scope caveat. A row with no `issuer` field reads "issuer not recorded by this runtime". `COVERAGE_SCOPE` and the "Not observed on page … (from its rows; not exhaustive: …)" line say they are not exhaustive. SKILL.md is corrected. G4 §3.4 has a dated regrade amendment. |

## Fixture additions (`test/browser/honest-coverage.mjs`, 36 → 43 checks)

- **E1:** `focusout`, `compositionstart` and `touchstart` are listed, with `lower_bound: true` and "at least N".
- **T1 (probe b2 shape):** a frame from another origin is inserted 50 ms after "Show frame" and removed 400 ms later. It leaves a realm row, and the click's window reason reads `1 child frame(s) appeared in this action's window (0 same-origin, 1 cross-origin)`.
- **W1/W2 (probe d shape):** "Ping socket" sends `go`. The socket server then writes through the API with no trace context. The send is a `network.send` of 2 bytes owned by the click, and the write is a root trace in its window. The chain stops at `websocket`, its label never says "issued no request", and coverage is incomplete: the send and the root span are both reasons.
- **X1:** a late SDK-style `window.fetch` replacement gives `wrapper_replaced: ["fetch"]`, a transport entry with `status: replaced`, and a coverage reason.
- **P2:** a root server span 3 s after the page ended appears in no window. The last window's `until_timestamp` is the last runtime row + 2000.
- **Updated:** O1 (the independent enumeration plus the handlerless data), O4/C3/C4 (3 frames, 4 limits), C2, H1/H2 (the new wording) and M2 (the new "Not observed" line). S1 adds the socket action.

## Commands and counts (code at e4c4a002)

```sh
npm run build && cmp src/runtime-attribution-browser.js dist/runtime-attribution-browser.js   # identical (run-2/build.txt)
npm test          # 700 tests, 698 pass, 2 fail (run-2/npm-test.txt):
                  #   react-context-ref-semantics (known)
                  #   react-input "packed … isolated consumer": npm ENOTCACHED fetching @jridgewell/sourcemap-codec (offline cache; environmental).
                  #     Rerun alone: node --test test/react-input.test.mjs → 7/7 pass.
node test/browser/honest-coverage.mjs ×3            # 43/43 ×3 (run-2/fixture-runs.txt, fixture-N/)
node grader-scratch/probes.mjs b,b2,d,g             # run-2/grader-probes-b_b2_d_g.json (below)
d12 ok · continuations ok · outcome-labels 160/160 · mcp-gaps 35/35 · body-capture 51/51 · worker-frontier ok · episode-focus ok ×3
unlinked-coverage-neutral 12/13 on the first pass: A2 still expected the old wording. Updated → 13/13 (run-2/browser-suite.txt)
node test/g4-grader.mjs docs/evidence/m1-2026-09-22-final7 --manifest docs/evidence/g4-mcp-2026-09-23/manifest.json   # 81/81
```

**G6 procedure:** gunzip the G6 store's `records`, `runs` and `spans` **and every file in `store/manifests/`** into one directory, then run `g6-compare.mjs` with the 6 pairs and `g6-grader.mjs --compare`. Result: Overall PASS (6/6). If the manifests are left gzipped, both main and this branch score 4/6 (remap basis `content_hash`), as the grader found.

## Grader probes after the changes (`run-2/grader-probes-b_b2_d_g.json`)

| probe | before (GRADE.md) | now |
|---|---|---|
| b (same-origin frame +50 ms / −450 ms) | no realm row; disclosed only through a root span | realm row `via: inserted`; window reason "1 child frame(s) appeared … (1 same-origin, 0 cross-origin)" plus the root span; `complete: false` |
| b2 (other-origin frame) | `complete: true`, reasons `[]` | realm row; window reason "(0 same-origin, 1 cross-origin)"; `complete: false` |
| d (Ping sends on a socket) | "No request: … issued no request", `complete: true`, `websocket: "wrapped"` | `stopped_at: websocket`, "Stopped at websocket: sent 1 WebSocket message on ws://…/ws (2 bytes); its server-side effects cannot be traced", `complete: false` ("1 WebSocket message(s) sent in this action's window …") |
| g Batch (two calls in one SDK span) | stopped at none, `complete: true` | `server_hop`: "1 outbound call from the joined server span has no server span continuing it (POST …/hook-batch)"; `complete: false`. The SDK span is not counted as a call; the call to B is continued. |
| g Seq (external call from B's response callback) | stopped at none, `complete: true` | `server_hop` "(POST …/hook-seq)", `complete: false` |

Probe d2 (a WebSocket-pushed request attributed to the socket's creator) is unchanged: it is pre-existing and out of scope, as the grade says.

## Banked stores (run-2/sweep-*.json)

Counts are identical to RUN.md. final7: 5 coverage-reason changes. G5: 1 headline change and 2 coverage-reason changes. G6: 0. No `stopped_at` moved.

The one G5 headline now reads `…; 1 recorded request left this page during this action's window that Tracer could not attribute (GET /api/setup-complete, issuer not recorded by this runtime), listed below as unlinked`, with the scope caveat kept. It says "issuer not recorded by this runtime" because the row predates the issuer field.

No banked store has a `capture.page` row, so none gains a realm, send or wrapper entry.

## Residual risks (added to RUN.md's)

- **Frames:**
  - An element that loads a document without being one of the four navigable containers is not recorded when inserted. A portal element behind an origin trial is one example. Such an element is caught only at the `window.length` check points.
  - A frame whose `src` changes after insertion keeps its insertion status until a check point, where a `capture.realm` row corrects it.
- **WebSocket:**
  - Inbound messages are not rows.
  - Messages sent through a socket created before the runtime installed are still recorded, because `send` is wrapped on the prototype. Their `connection_occurrence_id` is `null`.
  - The d2 misattribution remains.
- **Wrapper check:** runs only at summaries. A wrapper replaced and then restored between two summaries goes unnoticed. A replacement that still calls the runtime's wrapper (the fixture's case) is reported anyway: the rows cannot tell the difference.
- **Page-end grace:** the 2 s grace is a stated constant. A beacon that reaches the server later than that falls outside every window, and is still listed by `page_requests`' server spans.
- **Item 1 is still open:** the interim "direct child, same method and destination" rule remains until the rebase onto `fix/server-outbound`.
