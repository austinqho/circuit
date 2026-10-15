# fix/client-aborts — independent grade (2026-09-24)

Grader: independent agent. It did not write the branch. Branch `fix/client-aborts` head `33f909ca` on `main` `f9a925d7`. Everything below was recomputed from raw rows or read from the MCP over stdio. The author's RUN.md, test names and check counts were not taken as evidence. The grader's probe app, driver and outputs are untracked in `grader-scratch/` (not committed): `probe-app/{main.jsx,server.mjs}`, `probes.mjs`, `mcp-dump.mjs`, `mcp-call.mjs`, `banked-diff.mjs`, `probes-out/`.

**Verdict: merge with changes.** The mechanism is sound where it has evidence: the signal and the rejection identity, never timing. It works on TanStack Query, a plain `AbortController`, `AbortSignal.timeout`, string reasons, `Request` objects and XHR. Banked stores are byte-identical, and the suite is green. Two defects make a surface state something false, and they must be fixed and regraded before merge:
1. A completed save that the user saw succeed is labelled "Aborted by the page" (probe h). This is a regression from main, which printed `completed 200`.
2. An aborted request's joined database write disappears from the action outcome, which then says `writes: []` and "no write" (the author's own fixture).

## Per-rule table

| rule | verdict | raw evidence |
|---|---|---|
| Recorded from the signal and the rejection identity, never timing | **holds** for the before-headers and mid-read paths. **Fails** in spirit for the after-response path (see rule 2 row). | 3 driver runs: every `network.abort` row has `abort_evidence` ∈ {`fetch_rejected_with_signal_reason`, `signal_aborted_body_unread`, `body_read_rejected_with_abort_error`, `xhr_abort_event`}; the rows are identical in all 3 runs (seq 19,31,54,70,80,89,97,106,116,128). Code: `abortRejection` = `signal.aborted` && (`error === signal.reason` ∥ DOMException name `AbortError`). No clock is read. |
| `aborted_by_client` wins over the server status; `server_status` kept | **holds**, but applied too widely (see next row) | `fail-slow`: server log `status 500`; browser `ERR_ABORTED`; MCP `Aborted by the page: GET /api/fail-slow; the server answered 500`, `http_status: null`, `server_status: 500`, `failed_requests: 0`. |
| Never labelled aborted unless the page aborted it (the claim's other half) | **FAILS (regression)** | Probe **h** (POST /api/save; the app uses `r.ok`, never reads the body, and a cleanup aborts the controller 300 ms later). Browser: `requestfinished 200`. Server: `200`, `insert saves`. Page shows `saved 200`. Raw row: `abort_state: aborted`, `abort_evidence: signal_aborted_body_unread`. MCP: `Aborted by the page: POST /api/save; the server answered 200`, sentence "aborted by the page **before the response was read** … (after the response headers arrived, before the app read the body)". main `f9a925d7` on the same store says `completed 200`. The skill tells agents to say "the page did not use the answer", which is false here: the page used the status. Probe **h2** (the app drops its reference): also `aborted`. The code's WeakRef makes this result depend on GC: after a collection it becomes `undetermined`. |
| An aborted request is never credited while a non-aborted one exists | **holds** | driver `save-reload`: the headline is GET /api/notes. Probe **l** (one click; x, xy aborted; xyz read): `Completed 200: find items; also aborted_by_client GET /api/search (server answered 200) ×2`. |
| The server's answer is kept as a separate fact | **FAILS for effects** | driver `save-reload` (author's own store and report): the aborted POST joined `db insert notes` (segment 1 shows it). But the action outcome has `writes: []`, `because: "database read find notes joined by exact span parentage; no write"`, and the also text `aborted_by_client POST /api/notes (server answered 201)` omits the write. main credited the POST: `completed 201`, `writes insert notes`. An agent asked "did the save write?" reads `writes: []`. |
| Every aborted request listed in "also …" | **holds** (status only; the effect is missing, see above) | probe l `×2`; driver save-reload. |
| One function on every surface | **holds** | Grader's stdio dump (`recent_actions`, `action_chain`, `page_requests`) agrees with the driver's in-process surfaces for all 11 cases plus the grader's probes. |
| Abstain on which response rendered unless a body-read row proves it | **holds, narrowly** | `app_read` appears only when the action itself has an aborted request, and it says "read by the app", not "rendered". Keystroke searches are one action per keystroke, so the final keystroke's chain (`Completed 200`) carries no `app_read`: the rule never fires for the headline defect's shape. That is silence, not a false claim. |
| Coverage unaffected | **holds** | driver and probe pages: `coverage.complete: true`; the probe summary counts `network.abort: 16`, `network.response_read: 4`; delivery is complete. |
| "Pages that abort nothing emit none" (G4 §3.4, RUN rule 1) | **false as written** | probes c and ordf1 (a `Request` object, never aborted) emit `network.response_read`. Every TanStack or `Request`-object body read emits a row in every build. The rows are harmless, but the sentence is wrong. |

## Driver (3 runs)

`node test/browser/client-aborts.mjs --out grader-scratch/run{1,2,3}`: 203/203 ×3, exit 0. Raw-row readout (grader's own script over `store/records.jsonl`):
- Before-headers cases (q=a, q=ap, report, plain, fail-slow, POST notes) give `fetch_rejected_with_signal_reason`. Reason `{AbortError, DOMException}`, or `{name:null, reason_type:"ReadDeadline"}` for the app's Error reason.
- drip gives `signal_aborted_body_unread`, `body_read_started:false`.
- drip?case=reading gives `body_read_rejected_with_abort_error`, `body_read_started:true`. The page's own catch saw `AbortError`, not `ReadDeadline`, which confirms Chromium's fresh AbortError.
- consumed gives `no_effect`, `signal_aborted_after:"body_read"`, after a `network.response_read` (seq 96 < 97). Every surface shows `completed 200`.
- XHR gives `xhr_abort_event`, `ready_state_at_abort:1`, `before_response_headers`.
- fail-slow: see the table.
- The committed store matches RUN.md: 145 rows, 12 requests, 10 aborts, 3 reads, sha256 prefix `a8ef3676f8986e4f`.

## Grader probes (`grader-scratch/probe-app`, TanStack Query 5 + plain fetch/XHR; production build, bodies off)

| probe | browser / server truth | Tracer (raw row → MCP) | verdict |
|---|---|---|---|
| a. `abort('user left')` (string reason) | ERR_ABORTED / 200 | `fetch_rejected_with_signal_reason` (string identity), reason `{name:null, reason_type:null}` → `Aborted by the page…; the server answered 200`. The string is not recorded. | ok |
| b. `AbortSignal.timeout(100)` | ERR_ABORTED / 200 | `aborted`, name `TimeoutError` → `(…; TimeoutError)` | ok (a timeout the page set is the page's abort) |
| c. `fetch(new Request(url))`, never aborted | finished 200 | no abort row; `network.response_read json` → `completed 200`. It is tracked, and its rejection path is delayed (see ordering). | ok. The delay is confirmed. |
| d. signal already aborted at call | no request event in the browser; server nothing | `network.request` row + `aborted`, `signal_aborted_at_call: true` → "aborted … (before the response headers arrived; AbortError); no server span joined" | not false, but it hides that the request **was never sent**. Should say so. |
| e1. socket destroyed, signal present, nothing aborts | ERR_EMPTY_RESPONSE | no abort row; not labelled aborted | ok (see pre-existing issues below for its label) |
| e2. same + `finally { c.abort() }` | ERR_EMPTY_RESPONSE | no abort row (the rejection was TypeError; the listener was removed) | ok |
| e3. socket destroyed mid-body; `text()` rejects TypeError; then `c.abort()` | ERR_CONTENT_LENGTH_MISMATCH | `undetermined`, `undetermined_because: "the app read the body through a stream reader (or a clone)…"` | not aborted (ok). The `undetermined_because` text is false: the app used `text()`, and it had already rejected. |
| f. the app's own coincident AbortError during a body read | — | **Not constructible from app code in this install.** The runtime is a `head-prepend` inline script and wraps native `Response.prototype.*`, so any app patch runs after it and cannot feed it a promise. A fetched body's stream errors only natively. Closest real case: `window.stop()` mid-read, then `c.abort(new RangeError)` in the same turn. Chromium rejects the read with **TypeError**, which gives `undetermined`, not aborted. f2 (window.stop before headers, then abort): TypeError, no row. | the fallback did not misfire. The residual stays theoretical. |
| g. keystrokes a, ap (aborted), apr (completed), then a click on another control 60 ms after the last key, before its response | results "apr: apricot" | a, ap `Aborted…`; apr `Completed 200`; the other click `no_request` with its own 2 mutations (timestamps before the response). The render of the results produced **no dom.mutation row at all**: unowned mutations are not emitted. | Nothing is credited elsewhere in this probe; the render is simply not recorded. The chain text makes no claim about which action rendered. The disclosure (RUN.md, G4 §3.4) is honest; the defect's second half is not fixed. |
| h / h2. status-only save, later cleanup abort | **finished 200** / insert | **`aborted_by_client`** | **FAIL** (see the table) |
| i. XHR stopped by `window.stop()` (no `abort()` call) | ERR_ABORTED / 200 | `xhr_abort_event`, `ready_state_at_abort: null` → "(phase not recorded; **XMLHttpRequest.abort()**)" | The reason is false: `abort()` was never called. The code knows this (no `xhrAbortReadyState` entry). G4 says "fired only by abort()", which is wrong: `window.stop()` fires it. |
| j. `xhr.abort()` after load | finished 200 | no row | ok |
| l. one click, 3 requests, first two aborted | 2 ERR_ABORTED, 1 finished | `Completed 200 … also aborted_by_client GET /api/search (server answered 200) ×2`; `app_read` json | ok |
| n / o. aborted fetch with no catch; `Request` network error with no catch | — | `unhandledrejection` fired for both (AbortError, TypeError) | ok. The PR #13 invariant is kept. |

## Microtask delay (task 3)

Grader's ordering probe: `p.catch(rejected); c.abort(); queueMicrotask(micro); Promise.resolve().then(b)`.

| path | plain build (no Tracer) | instrumented build (production, bodies off) |
|---|---|---|
| fetch with signal, abort before headers | `rejected,micro,b` | `micro,b,rejected` |
| `new Request(url, {signal})` | `rejected,micro,b` | `micro,b,rejected` |
| body read (`text()`) pending, then abort | `read-rejected,micro` | `micro,read-rejected` |
| fulfilment, a tracked vs an untracked `text()` | `tracked,untracked` | `tracked,untracked` (no difference seen) |

Scope: every fetch given a signal **or a `Request` object** (TanStack Query, and most fetch wrappers), in every build including production. It affects the rejection reaction and the rejection of that response's body reads.

**Disclosure.** G4 §3.4 lists it, as the fifth residual and in the runtime paragraph. body-capture P6 is amended honestly: the new assertion matches the grader's probe exactly. **The README is not updated.** Its only statement (README lines ~366–374) sits under body capture, which is dev-only, so it implies production is unaffected. That is now false. The skill needs nothing: it is about reading outputs.

**Could it be avoided?** Only by trading it for a different observable difference. Reacting on the fetch promise marks it handled. The alternatives:
- Attach Tracer's reaction lazily inside the signal's `abort` listener. By spec that listener runs after fetch's abort algorithm has already rejected the promise, so identity checking still works. Non-aborted fetches would get no delay at all, and aborted ones would keep the app's reaction order. But it silences `unhandledrejection` for aborted fetches the app never handles. Deferring the attach to a later task instead produces a spurious `rejectionhandled`.
- Record reads without the derived promise: same trade on `json()` rejections.
- Gate tracking like bodies (dev only): production is unchanged, but production stores stay mislabelled.

**What I would do:** keep the derived promise. Preserving `unhandledrejection` is the stronger invariant, and this is the same class as the already-disclosed native-`await` rewrite (`baca2d` vs `aba2cd`) and the body-capture tick. Disclose it in the README as a production-affecting difference with its real scope ("every fetch given a signal or a `Request`, including TanStack Query"). If Austin wants production to have zero timing difference, make abort tracking follow the `bodies` policy. That is his call, not the author's.

## Suite (task 4), all run by the grader on head `33f909ca`

| command | result |
|---|---|
| `npm test` | tests 701, pass 700, fail 1: `test/react-context-ref-semantics.test.mjs:63` (known) |
| `node test/browser/d12-stamp-neutrality.mjs` | pass true, 23/23 |
| `node test/browser/continuations-neutral.mjs` | status ok, exit 0 |
| `node test/browser/outcome-labels.mjs --out grader-scratch/outcome-labels` | 169/169 |
| `node test/browser/mcp-gaps.mjs` | 35/35 |
| `node test/browser/body-capture.mjs` | 51/51 (51 PASS, 0 FAIL); P6 as amended, honest (see above) |
| `node test/browser/episode-focus.mjs` ×3 | status ok, stable true, exit 0 ×3 |
| `node test/g4-grader.mjs docs/evidence/m1-2026-09-22-final7 --manifest docs/evidence/g4-mcp-2026-09-23/manifest.json --out grader-scratch/g4` | 81/81 |
| G6: gunzip the g6 store; `g6-compare.mjs` (6 pairs) on the branch and on `git archive f9a925d7` in `grader-scratch/main-f9a925d7`; `g6-grader.mjs` | Overall: PASS (6/6 pairs). compare/*.json and AGENT-READS.md byte-identical to main after normalising the store path, which differs only because main's tree lives under the scratch directory. |
| `cmp src/runtime-attribution-browser.js dist/runtime-attribution-browser.js` | identical |

## Banked stores (task 5)

`grader-scratch/banked-diff.mjs` (in-process `callTool` from both trees) runs every `action_chain`, plus `page_requests` and `recent_actions` per session:
- final7: 60 answers.
- G6 store: 432 answers.

Both have **0 differing and 0 new fields**, and 0 fact rows in either store. `mergeRequestFacts` returns the same array for them.

## Required changes (exact list)

1. **After-response aborts must not win over the server's status.** When the signal aborts after the fetch promise fulfilled and the body is unread (`signal_aborted_body_unread`), the response (status, headers) had already reached the app. Tracer cannot tell whether the transfer was still running (drip: ERR_ABORTED) or had finished (probe h: requestfinished). Record the fact (for example `abort_state: "after_response"`, `aborted_by_client: false`) and keep the server-side label. Add a sentence clause such as "the page aborted after the response reached it; its unread body was discarded". Never "before the response was read". This also removes the GC dependence (h vs h2). Update the skill line "the page did not use the answer" so it applies only to before-headers aborts. Add probe h (status-only save, later cleanup abort) to the driver, with browser truth.
2. **An aborted request's server effects stay in the action outcome.**
   - `outcome.writes`/`reads` (or a separate `aborted_request_writes`) must include joined operations of aborted sibling requests.
   - The action-level `because` must not say "no write" when one of them wrote.
   - The also text must carry the effect: `also aborted_by_client POST /api/notes (server answered 201 and wrote insert notes)`.
   - The driver's save-reload case must assert it.
3. **XHR `abort` event without an `abort()` call** (for example `window.stop()`): don't print `XMLHttpRequest.abort()` as the reason. Record that no `abort()` call was seen; the runtime already knows, because there is no `xhrAbortReadyState` entry. Correct G4 §3.4 "fired only by abort()".
4. **Docs.**
   - The README must state the one-tick delay for every build, production included, with its real scope.
   - G4 §3.4 must drop "pages that abort nothing emit none": `network.response_read` is emitted for every body read of a signal- or Request-carrying fetch. The evidence directory is immutable, so correct RUN.md's rule 1 in G4 or an added note, not by editing RUN.md.
   - G4 §3.4 must also state that `Response.prototype.{json,text,…,clone}` are wrapped in every build.

Recommended (not blocking):
- Probe d: state `signal_aborted_at_call` in the sentence ("the signal was already aborted: the request was never sent").
- Probe e3: fix `undetermined_because` when the app's own read already rejected with a non-abort error. Better, classify it as not an abort.
- Record which action aborted a request, when an action frame is current at `abort()` (the cancelQueries and Cancel clicks are `no_request` with no link to the abort they caused). This is not claimed by the PR.

## Residual risks

- Unowned render mutations are not recorded at all, so "which action rendered the last result" stays unanswerable. That is the DOM-mutation ownership follow-up, correctly disclosed.
- `app_read` never fires for per-keystroke searches (one action per keystroke).
- The mid-read AbortError fallback could not be forced from app code in the head-prepend install. A service worker, or a future Chromium change to `window.stop()` errors, could still hit it.
- Pre-existing, not this PR:
  - A socket the server destroyed is reported as `Responded 200: no effect evidence` (e2, e3). The server span records status 200. main does the same.
  - Chromium's automatic retry of a GET after an empty response gives "more than one server span claims the exact parent" (e1).

---

# Regrade at 04d69be8 (2026-09-24)

Scope: the targeted items the coordinator listed. Owner decisions taken as given: abort tracking stays on in every build, and the one-microtask delay is accepted as disclosed. Grader probes rerun from `grader-scratch/probe-app`, which gained two probes: h3 (response dropped, forced `gc()` ×3 before the cleanup abort; Chromium `--js-flags=--expose-gc`) and p (stream reader: `response.body.getReader().read()` pending when the page aborts). Every probe ran twice, into `probes-out-r2-{1,2}`; the raw rows were identical across the two runs.

**Verdict: merge with changes.** All four earlier blocking items are fixed and verified. One new false statement was introduced: a stream-reader read the abort cut off is reported as an "unread body" with the server's label. Three small changes remain.

## (1) Earlier blocking items

| item | verdict | raw evidence |
|---|---|---|
| Status-only save, later cleanup abort (h, h2, h3 with forced GC) | **fixed** | All three, both runs: `abort_state: after_response`, `aborted_by_client: false`, `signal_aborted_after_response`. MCP: `Completed 200: insert saves`, sentence "…; the page aborted the request after the response reached it (status and headers); its unread body was discarded". The browser reports `requestfinished 200`. h3 with `gc` = function gives the same row, so there is no GC dependence: the `WeakRef` is gone and `hasBody` is recorded at fulfilment. Driver case "save whose status the app used" gives the same. |
| Save-then-reload effects | **fixed** | Driver run 1 (grader's): label `Completed 200: find notes; also aborted_by_client POST /api/notes (server answered 201 and wrote insert notes)`, `writes: ["insert notes"]`. Frontier: "database read find notes joined by exact span parentage; no write under this request; an aborted request of this action wrote (insert notes by POST /api/notes)". |
| XHR `window.stop()` | **fixed** | Row: `abort_call_seen: false`, `via: xhr_abort_event_without_abort_call`, `aborted_at: null`. Sentence: "(phase not recorded; the XHR fired abort without an abort() call (e.g. window.stop()))". The `xhr.abort()` case still reads `XMLHttpRequest.abort()`. |
| Signal already aborted at the call | **fixed** | Probe d: "(the signal was already aborted: the request was never sent; AbortError); no server span joined (the request never left the page)". The browser saw no request. Minor: the frontier `because` still reads "no server span with the exact parent span id arrived in the same trace". |

## New defect (blocking, small)

**Probe p, stream reader cut off by the abort.**
- The app calls `r.body.getReader().read()` on `/api/drip` (headers now, body 800 ms later). The page aborts at 150 ms, and the app's `read()` rejects with `AbortError`. The browser reports `ERR_ABORTED`.
- Tracer: `abort_state: after_response`, **`body_read_started: false`**. MCP: `Completed 200: find items … its unread body was discarded`.
- Both facts are false. The app was reading, and by the branch's own rule ("a body read the app had started was pending and then rejected because of the abort") this is `aborted_by_client`, `while_reading_body`.
- At 33f909ca this case was `undetermined`: an honest abstention. It is now a confident wrong statement.
- Stream readers are how streamed chat responses are read, so the "Stop" button of a streaming chat UI hits exactly this path.
- **Fix.** Mark a tracked body as being read when the app takes a reader, pipes, tees or async-iterates it. That means wrapping the `ReadableStream.prototype` entry points for bodies in a `WeakMap` body → track, so there is no live-reference decision. At the abort, a stream read that is open and not finished gives `aborted_by_client` (`while_reading_body`, evidence `signal_aborted_during_stream_read`), or at worst `undetermined`, never "unread". Add probe p to the driver with the browser's truth.

## Other required changes (small)

- **Probe e3 order: the read failed first, then the abort.** The server closes the socket mid-body, `text()` rejects `TypeError`, and a `finally` then aborts. The row has `body_read_started: false` and no `body_read_error_type`, so the sentence says "its unread body was discarded". The app did read, and the read failed. RUN-2 says this was fixed. It is fixed only when the abort lands while the read is pending (probe f gives "the app's body read had already failed (TypeError), not because of the abort", which is correct). Fix: record a failed read in the read's rejection handler even when no abort is pending.
- **The after-response clause must not imply the body had arrived.** See (2).

## (2) The author's `/api/drip` case

- Truth: the browser reports `ERR_ABORTED` (the body was still streaming).
- Tracer: `Completed 200: find items` plus "the page aborted the request after the response reached it (status and headers); its unread body was discarded".
- **Is "label by what reached the app" honest?** Yes, as a rule. The status and headers did reach the app. `completed` is defined by the server's status plus a joined effect. The runtime cannot tell a running transfer from a finished one without timing or reading the body. The rule removes the probe-h false positive.
- **Does the clause say the body was still in flight?** No. "its unread body was discarded" is true, but it reads as if the body had arrived. The clause must say that this is not recorded, for example "its unread body was discarded (whether it had fully arrived is not recorded)".
- **Recommended.** The short `label` (`recent_actions`, `element_history`) and `page_requests` (`outcome_text: "completed 200"`, no flag) do not carry the after-response fact; only the sentence and `outcome.abort_after_response` do. Add `abort_after_response` to `page_requests` entries and a short suffix to `outcome_text`.

## (3) Docs

- **README (new paragraph after body capture).** It states, in bold, that tracking happens in every build, production included. It states that every fetch given an `AbortSignal` **or a `Request` object** is tracked (TanStack Query included), and that `Response.prototype.{arrayBuffer,blob,bytes,formData,json,text,clone}` are wrapped in every build. It states the one-microtask delay on the rejection of the fetch and of its body reads in every build, and that the fulfilment path is unchanged. Confirmed; this matches the grader's ordering probe, rerun at this head with the same orders as before. One gap: `XMLHttpRequest.prototype.abort` is named in G4 but not in the README.
- **G4 §3.4 amendment.** It covers:
  - the after-response rule, and no `WeakRef`;
  - the effects rule and the scoped "no write";
  - `abort_call_seen`;
  - the correction of "pages that abort nothing emit none";
  - the wrapped prototypes, including `XMLHttpRequest.prototype.abort`;
  - the every-build delay.

  Confirmed. Its sentence "a body read the app had started was pending and then rejected because of the abort" is true only for the six body methods, not for stream readers; see probe p.

## (4) Suite at 04d69be8 (grader-run)

| command | result |
|---|---|
| `node test/browser/client-aborts.mjs --out grader-scratch/r2run{1,2,3}` | 209/209 ×3 |
| `node test/browser/outcome-labels.mjs` | 169/169 |
| `node test/browser/body-capture.mjs` | 51/51 |
| `node test/browser/d12-stamp-neutrality.mjs` | pass true, 23/23 |
| `node test/browser/continuations-neutral.mjs` | status ok |
| `npm test` | 701 tests: 699 pass, 2 fail. The known `react-context-ref-semantics`, plus `react-input.test.mjs` "packed … isolated consumer", which failed with `npm error code ENOTCACHED` (offline npm cache, environmental). `node --test test/react-input.test.mjs` rerun alone: 7/7. So effectively 700/701. |
| `node test/g4-grader.mjs docs/evidence/m1-2026-09-22-final7 --manifest docs/evidence/g4-mcp-2026-09-23/manifest.json` | 81/81 |
| G6 (6 pairs, `g6-compare` + `g6-grader` on this head) | Overall PASS (6/6); `compare/*.json` and AGENT-READS.md byte-identical to main's (`git archive f9a925d7`) after normalising the store path |
| `cmp src/runtime-attribution-browser.js dist/runtime-attribution-browser.js` | identical |
| Banked stores (`banked-diff.mjs`, every `action_chain`, plus `page_requests` and `recent_actions` per session; branch vs main) | final7 0/60 differ; G6 store 0/432 differ |

## Required changes (exact list)

1. Stream-reader reads (`getReader`, `pipeTo`/`pipeThrough`, `tee`, async iteration) of a tracked body must count as a started body read. Probe p must give `aborted_by_client` `while_reading_body`, or `undetermined`, never "unread body … discarded". Add it to the driver.
2. A body read that already failed before the abort must be recorded (`body_read_started: true`, `body_read_error_type`), whatever the order (probe e3).
3. The after-response clause must say that whether the body had fully arrived is not recorded.

Recommended: `page_requests` and `outcome_text` should carry the after-response fact; name the `XMLHttpRequest.prototype.abort` wrapper in the README.

---

# Regrade at 9900ca53 (2026-09-24, rebased onto main dca34f90)

Short, targeted regrade. The grader's probe app gained p2 (stream read to its end, then abort), p3 (`tee()` with a branch read pending, then abort), p4 (`pipeThrough(TextDecoderStream)` with a read pending, then abort) and p5 (`for await` over the body, abort mid-stream). All probes ran on a production build (`probes-out-r3`) and again on a **development build with bodies on** (`probes-out-r3-dev`), so the new stream wrappers are checked against body capture's own stream handling. Both builds give identical labels.

**Final verdict: merge.** Every required change from both earlier grades is fixed and verified from raw rows and the MCP. Nothing false was found. Two non-blocking recommendations are below.

## (1) Stream reads

| probe | truth (browser / page) | Tracer | verdict |
|---|---|---|---|
| p: `getReader().read()` pending, page aborts (the Stop button) | ERR_ABORTED / `AbortError` | `Aborted by the page: GET /api/drip; the server answered 200`, "(after the response headers arrived, while the app was reading the body (getReader); AbortError)"; `page_requests` gives `aborted_by_client`, `while_reading_body` | fixed |
| p5: async iteration, abort mid-stream | ERR_ABORTED / `AbortError` | `aborted_by_client`, "(… reading the body (async_iteration); AbortError)" | ok |
| p2: reader read to `done`, then abort | finished 200 | `Completed 200: find items`, no abort clause (`no_effect` after the read) | ok |
| p3: `tee()`, abort while a branch read is pending | ERR_ABORTED / `AbortError` | `Completed 200: find items`; sentence "…the page aborted the request after the response reached it while the app was consuming the body through tee(); whether that finished before the abort is not recorded" | The abstention is stated in the sentence; honest. |
| p4: `pipeThrough()`, same | ERR_ABORTED / `AbortError` | same as p3, with `pipeThrough()` | same |

Recommended (not blocking): p3 and p4 (`undetermined`) carry no suffix on the short `label` or on `page_requests` `outcome_text` (`completed 200`). The after-response case now does ("; aborted by the page after the response"). Give `undetermined` a suffix too, e.g. "; aborted while the body was being consumed (end not recorded)".

## (2) Dropped connection (probe e3: the read fails first, then a cleanup abort)

The sentence reads "…the page aborted the request after the response reached it (status and headers); the app's body read (text) had already failed (TypeError), not because of the abort". The label is `Responded 200: no effect evidence; aborted by the page after the response`. Fixed. The "Responded 200" for a socket the server destroyed is the pre-existing server-span issue, not this branch.

## (3) Clauses, label suffix, page_requests, frontier

- **After-response clause (h, h2, h3 with forced GC, both builds):** "the page aborted the request after the response reached it (status and headers); the app had not started reading the body, and the unread body was discarded (whether the body had fully arrived is not recorded)". Confirmed.
- **Short label:** `Completed 200: insert saves; aborted by the page after the response`. Confirmed.
- **`page_requests`:** entries carry `abort_after_response: true` and `outcome_text: "completed 200; aborted by the page after the response"`. Confirmed.
- **Signal already aborted (d):** the frontier reads "the page aborted the request; the request never left the page (its signal was already aborted when fetch was called)", and the sentence reads "…no server span (the request never left the page)". Confirmed.

## (4) Rebase, issuers, README

- **`requestSegmentCore`** (`analysis/causal-chain.mjs:635`) now holds the abort frontier prefix and `http_status: null` for aborted segments. `mcp/tools.mjs` and `analysis/runtime-attribution.mjs` both build segments through it, so it is one builder.
- **Aborted siblings are named with their issuers.** Driver save-reload: `Completed 200: find notes; also aborted_by_client POST /api/notes (server answered 201 and wrote insert notes (handler: createNote))`. Frontier: "…no write under this request; an aborted request of this action wrote (insert notes (handler: createNote) by POST /api/notes)".
- **README.** It names the wrapped `ReadableStream.prototype.{getReader,pipeTo,pipeThrough,tee,cancel,values,[Symbol.asyncIterator]}`, the reader `read`/`cancel`, and `XMLHttpRequest.prototype.abort`, and says untracked streams pass through. It states the one-tick delay for a tracked fetch's rejection and for every settled read of its body (body methods, `reader.read()`, `pipeTo`, async iteration), in every build.
- **Is the broadened disclosure prominent enough?** It is accurate and complete, and "every build, production included" is in bold. The delay sentence itself sits mid-paragraph. A streaming UI now gets each chunk one microtask later in production, so recommended (not blocking): list it in one place with the other runtime differences (the await rewrite, the body-capture tick) rather than only inside the client-aborts paragraph.

## (5) Suite at 9900ca53 (grader-run)

| command | result |
|---|---|
| `node test/browser/client-aborts.mjs --out grader-scratch/r3run{1,2,3}` | 245/245 ×3 |
| `node test/browser/middleware-reads.mjs` | 343/343 (TanStack Query 4.44.0) |
| `node test/browser/outcome-labels.mjs` | 169/169 |
| `node test/browser/body-capture.mjs` | 51/51 |
| `node test/browser/d12-stamp-neutrality.mjs` | pass true, 23/23 |
| `node test/browser/continuations-neutral.mjs` | status ok |
| `npm test` | 708 tests: 707 pass, 1 fail (the known `react-context-ref-semantics.test.mjs:63`) |
| `node test/g4-grader.mjs docs/evidence/m1-2026-09-22-final7 --manifest docs/evidence/g4-mcp-2026-09-23/manifest.json` | 81/81 |
| G6, six pairs on this head and on `git archive dca34f90` | Overall PASS (6/6); compare/*.json and AGENT-READS.md byte-identical after normalising the store path |
| `cmp src/runtime-attribution-browser.js dist/runtime-attribution-browser.js` | identical |
| Banked stores vs dca34f90 (every `action_chain`, plus `page_requests` and `recent_actions`) | final7 0/60 differ; G6 store 0/432 differ |

## Final verdict

**merge.** Two items stay open and are not blocking:
- a short-label and `page_requests` suffix for `undetermined` (tee/pipeThrough);
- one consolidated README list of runtime timing differences.

Recording which action caused an abort remains unclaimed, and so does the ownership of unowned render mutations.
