# fix/client-aborts, RUN-3: after the regrade, rebased onto main (2026-09-24)

This file responds to the regrade section in `GRADE.md` (at 04d69be8: "merge with changes").

- The branch is rebased onto `origin/main` dca34f90, which merged `fix/middleware-reads` as #15.
- The grader's commits stay in history, rebased: `d2c02537` (grade) and `783016c1` (regrade).
- `RUN.md` and `RUN-2.md` are unchanged. Where they differ from this file, this file wins.
- The contract is G4 §3.4 plus its three dated amendments.
- The implementing agent wrote this file. A regrade should recompute from `run-3/store/`.

## Regrade item 1 (blocking): any tracked body consumption is a started read

**Wrappers.** Every build wraps these prototypes. Each wrapper acts only on the body of a tracked fetch; a `WeakMap` maps body, reader and iterator to the track, so no decision depends on a live reference.

| Prototype | Wrapped members |
|---|---|
| `ReadableStream.prototype` | `getReader`, `pipeTo`, `pipeThrough`, `tee`, `cancel`, `values`, `[Symbol.asyncIterator]` |
| `ReadableStreamDefaultReader.prototype`, `ReadableStreamBYOBReader.prototype` | `read`, `cancel` |

`clone()` re-registers both tee'd bodies.

**How each consumption is decided when the signal aborts after the response reached the app:**
- **A reader, `pipeTo` or async iteration that is open and has not seen its end.** Recorded as `aborted_by_client`, `while_reading_body`, `body_read_started: true`, `body_read_via`, with `abort_evidence: "signal_aborted_during_stream_read"`.
- **`tee` or `pipeThrough`.** Their end is not followed. Recorded as `abort_state: "undetermined"`, with `undetermined_because` naming the method. The label stays the server's, and the sentence says "whether that finished before the abort is not recorded".
- **A reader that saw `done`, or a `pipeTo` that resolved.** Recorded as `no_effect`, plus `network.response_read` with `via: getReader | pipeTo | async_iteration`.

**New driver cases, with the browser's own result as truth:**
- **"stream reader cut off by an abort (a Stop button)"** (the grader's probe p). The app does `getReader().read()` on a body that streams 800 ms after the headers, and the page aborts at 150 ms. The browser reports ERR_ABORTED and the app's `read()` rejects with AbortError. Tracer: `Aborted by the page: GET /api/drip; the server answered 200`, sentence "…(after the response headers arrived, while the app was reading the body (getReader); AbortError); the server answered 200 and read find items (handler: dripBody)". No "unread" appears anywhere.
- **"stream read to its end, then aborted".** The browser finishes the request. The raw row is `no_effect`, and the read row has `via: getReader`. Every surface prints `Completed 200: find items`, with no abort flag.

## Regrade item 2 (blocking): a read that failed before the abort

The read's own rejection handler now records the failure (`readFailed`, `readVia`) whatever the order. A later abort gives `after_response` with `body_read_started: true`, `body_read_via` and `body_read_error_type`. This holds for body methods and stream reads alike.

**New driver case, "body read failed before a cleanup abort"** (the grader's probe e3):
- **Server:** answers 200 with `content-length: 200`, writes part of the body, then drops the socket.
- **App:** `text()` rejects with TypeError, then `finally { controller.abort() }`.
- **Truth:** the browser reports the request failed, and the server logs the drop.
- **Tracer:** `Completed 200: find items; aborted by the page after the response`. The sentence ends "the app's body read (text) had already failed (TypeError), not because of the abort". It never says "unread".

## Regrade item 3: wording and flags

- **After-response clause.** Now reads "…(status and headers); the app had not started reading the body, and the unread body was discarded (whether the body had fully arrived is not recorded)". There are failed-read and cancelled-read variants.
- **Short label.** The label and `outcomeText` carry `; aborted by the page after the response`.
- **`page_requests`.** Entries add `abort_after_response: true`, or `abort_undetermined`.
- **Never-sent requests.** The frontier is now `stop_reason: "never_sent"`, with because "the request never left the page (its signal was already aborted when fetch was called)". The MCP prefix makes it "the page aborted the request; the request never left the page (…)".
- **README.** Names the `XMLHttpRequest.prototype.abort` wrapper and the stream wrappers. States that every settled read of a tracked body (body methods, `reader.read()`, `pipeTo`, iterator `next()`) is one microtask later, in every build.

## Rebase onto dca34f90 (`fix/middleware-reads`)

Both behaviours are kept.
- **One segment builder.** The abort frontier sentence (`abortedBecause`, now in `analysis/causal-chain.mjs`) and the aborted segment's `http_status: null` live in `requestSegmentCore`, the one segment builder. So the MCP, the export and the viewer share them.
- **Issuers on aborted work.** The aborted outcome's sentence, the "also" text, `server_writes` / `server_reads` and the scoped "no write" frontier all name each operation with its issuer (`dbOpText`, `headlineOp`). Example: `also aborted_by_client POST /api/notes (server answered 201 and wrote insert notes (handler: createNote))`.
- **`aborted_request_effects[].ops`.** Each entry carries its issuer; the driver checks `issued_by: "handler: createNote"`.
- **Conflicts resolved:** the import line, the MCP outcome key list (now `effect` plus the abort keys), the segment builder, and the skill's honesty rules (main's middleware wording plus the abort rule).
- **Changed expectation.** The dropped-connection case prints `Completed 200` on main, not `Responded 200`. Main's rule now counts every op under the server span; that is the server's label, and the abort facts are unchanged.
- **Commit that reconciles the two:** `dfd2e627`.

## Commands and counts (at `dfd2e627`, before this file)

```sh
node test/browser/client-aborts.mjs      # 245/245 ×3 (run-1..3), and 245/245 --out run-3 (this directory)
node test/browser/outcome-labels.mjs     # 169/169
node test/browser/body-capture.mjs       # 51/51
node test/browser/middleware-reads.mjs --runs 3   # 343/343, stable across 3 runs
node test/browser/d12-stamp-neutrality.mjs        # pass: true
node test/browser/continuations-neutral.mjs       # status ok
npm test                                 # tests 708, pass 707, fail 1 (known react-context-ref-semantics)
node test/g4-grader.mjs docs/evidence/m1-2026-09-22-final7 --manifest docs/evidence/g4-mcp-2026-09-23/manifest.json   # 81/81
# G6 (fresh gunzip of the g6 store; six pairs) on this branch and on `git archive dca34f90`: g6-grader Overall PASS (6/6);
# compare/*.json and AGENT-READS.md byte-identical to main dca34f90
npm run build && cmp src/runtime-attribution-browser.js dist/runtime-attribution-browser.js   # identical
```

**Two environmental notes from the pre-rebase round.**
- **G6 scratch store.** My earlier scratch copy of the G6 store had its three manifests rewritten on disk by another process: all three had the same size, and the rewrite was not mine. The G6 comparison above uses a fresh gunzip from the evidence directory.
- **Flaky worker-frontier test.** In the pre-rebase full `npm test`, `worker-frontier.test.mjs` "MCP … stopped at worker" failed once. It passed 7/7 when rerun alone and passed in the post-rebase full run. I read it as load-related; it is not in the code this branch touches.

## Raw rows (`run-3/store/`)

| file | rows | sha256 (prefix) |
|---|---|---|
| records.jsonl.gz | 204. Abort rows: 11 `aborted`, 3 `after_response`, 2 `no_effect`, 0 `undetermined`. Evidence: 7 `fetch_rejected_with_signal_reason`, 1 `body_read_rejected_with_abort_error`, 1 `signal_aborted_during_stream_read`, 3 `signal_aborted_after_response`, 2 `xhr_abort_event` | f07af7b4facc2d42 |
| spans.jsonl.gz | 84 | d542c45351597c47 |
| runs.jsonl.gz | 1 | 6cb7b79e1b573ca1 |

## Residuals, updated

- **Unobserved stream paths.** A stream the app reaches through an unwrapped path is not observed, and neither is a reader it took before the response was tracked (not possible for a fetch's own body). Such an abort falls back to "not started reading", with the not-recorded clause.
- **The `done` race.** A reader whose final `done` result resolves in the same microtask checkpoint as the abort, before Tracer's reaction runs, would be labelled `aborted`.
- **The one-microtask delay** now covers every settled read of a tracked body in every build (see README). Making abort tracking follow the `bodies` policy remains Austin's call.
- **Which action aborted a request is not recorded.** That was a recommendation, not a claim.
- **Render mutations are still not attributed.** The defect's second half is not fixed.
