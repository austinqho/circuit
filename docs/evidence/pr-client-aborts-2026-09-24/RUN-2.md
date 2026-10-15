# fix/client-aborts — RUN-2 (after the independent grade, 2026-09-24)

This file responds to `GRADE.md` (verdict "merge with changes"; grade of `33f909ca`). The base is `c1ee5281`. `RUN.md` is unchanged. Where this file differs from it, this file wins. The contract is `docs/gates/G4-mcp.md` §3.4 plus its dated post-grade amendment. It was written by the implementing agent; a regrade should recompute from `run-2/store/`.

## Blocking 1: an abort after the response arrived no longer overrides the server's label

- **Rule.** `aborted_by_client` applies only when the abort kept the response from reaching the app. That means one of three things happened:
  - the fetch rejected before the response headers;
  - a body read the app had started was pending and then rejected because of the abort;
  - an XHR fired `abort`.
- **After the response.** A signal aborted after the response (status, headers) reached the app, with no body read in progress, gives a different row: `abort_state: "after_response"`, `aborted_by_client: false`, `abort_after_response: true`, `abort_evidence: "signal_aborted_after_response"`. The request keeps the server's label. The outcome adds `abort_after_response: true` and the sentence clause `the page aborted the request after the response reached it (status and headers); its unread body was discarded`.
- **This replaces RUN.md rule 1's `signal_aborted_body_unread` → aborted.** The fixture's "abort after headers, before the body was read" case (`/api/drip`) now reads `Completed 200: find items` plus the clause. The browser reports that transfer ERR_ABORTED, because it was still streaming. Tracer cannot tell a running transfer from a finished one (the grader's point), so it does not decide on that.
- **No garbage-collection dependence.** The decision is made at the abort, from state recorded when the response arrived (`hasBody`) and from the app's own reads (`reading` / `bodyDone`). The `WeakRef` is gone, and the runtime never emits `undetermined` any more.
- **Grader probe e3.** A read that had already failed for a non-abort reason is now `after_response` with `body_read_started: true` and `body_read_error_type`. The false "stream reader" explanation is gone.
- **New driver case** "save whose status the app used, aborted later by a cleanup". The app POSTs `/api/save`, reads only `response.ok`, and aborts 300 ms later. Truth:

  | source | observed |
  |---|---|
  | browser | `requestfinished` 200 |
  | server log | 200, insert |
  | page | "saved 200" |

  Tracer, on every surface: `Completed 200: insert notes`. Sentence: `server responded 200 to POST /api/save; database write insert notes joined under the request; the page aborted the request after the response reached it (status and headers); its unread body was discarded`.
- **Skill.** "the page did not use the answer" is replaced. Before-headers aborts: the page never received the response. Mid-read aborts: it never received the body. After-response aborts keep the server's label, "the app may well have used the status".

## Blocking 2: an aborted request's database effects stay the action's

- `abortedRequestEffects` (in `analysis/causal-chain.mjs`) lists the joined DB operations of each aborted request other than the credited one.
  - It appears as `outcome.aborted_request_effects`, on the chain record, in the export and in the MCP.
  - MCP `outcome.writes` and `reads` include those operations.
- The "also" text carries the effect.
- When one of those requests wrote, the credited request's "no write" is scoped: the frontier reads `…; no write under this request; an aborted request of this action wrote (insert notes by POST /api/notes)`, and a `no write observed` note becomes `no write observed under this request`.
- Driver `save-reload` now reads:
  - Label: `Completed 200: find notes; also aborted_by_client POST /api/notes (server answered 201 and wrote insert notes)`.
  - `writes: ["insert notes"]`, where it was `[]` before.
  - The frontier no longer ends in a bare `no write`.

## Blocking 3: XHR `abort` without an `abort()` call

The runtime knows whether `xhr.abort()` ran. The `abort` event can also fire without it, for example from `window.stop()`. In that case the row carries `abort_call_seen: false`, `abort_reason.via: "xhr_abort_event_without_abort_call"` and `aborted_at: null`, and the sentence says `the XHR fired abort without an abort() call (e.g. window.stop())`. The new driver case `xhr-stop` checks it, with the browser's ERR_ABORTED as truth. G4 §3.4's "fired only by abort()" is corrected in the amendment.

## Blocking 4: docs

- **README.** A new paragraph after body capture says that client aborts are recorded in every build, production included. It says the runtime tracks every fetch given an `AbortSignal` or a `Request` object (TanStack Query included). It says `Response.prototype.{arrayBuffer,blob,bytes,formData,json,text,clone}` are wrapped in every build. It states the one-microtask delay on the rejection path, for the fetch and for that response's body reads, in every build; the fulfilment path is unchanged.
- **G4 §3.4.** The dated amendment corrects "pages that abort nothing emit none": `network.response_read` appears for every finished body read of such fetches. It also lists the wrapped prototypes, states the every-build delay, and describes the after-response rule, the effects rule and the XHR rule.

## Recommended items, done

- **A signal already aborted at the call.** Sentence: `aborted by the page before the response was read: GET /api/slow (the signal was already aborted: the request was never sent; AbortError); no server span joined (the request never left the page)`. New driver case `pre-aborted`. Truth: the browser saw no request, the server logged none, and the page shows AbortError.
- **The false `undetermined` explanation.** Removed; see Blocking 1.

## Not done (recommended, not blocking)

Recording which action aborted a request: the Cancel and cancelQueries clicks still show `no_request` with no link to the abort they caused. This is not claimed.

## Commands and counts (head after this file's commit)

```sh
node test/browser/client-aborts.mjs --out docs/evidence/pr-client-aborts-2026-09-24/run-2   # 209/209 (this run) and 3 further runs: 209/209 ×3
node test/browser/outcome-labels.mjs          # 169/169
node test/browser/body-capture.mjs            # 51/51
node test/browser/d12-stamp-neutrality.mjs    # pass: true (no false checks)
node test/browser/continuations-neutral.mjs   # status ok
npm test                                      # tests 701, pass 700, fail 1 (known react-context-ref-semantics); the synthetic client-abort test now also checks writes, aborted_request_effects and the after-response clause
node test/g4-grader.mjs docs/evidence/m1-2026-09-22-final7 --manifest docs/evidence/g4-mcp-2026-09-23/manifest.json   # 81/81
# G6: six pairs regenerated on this branch; g6-grader Overall: PASS (6/6); compare/*.json and AGENT-READS.md byte-identical to main f9a925d7's
npm run build && cmp src/runtime-attribution-browser.js dist/runtime-attribution-browser.js   # identical
```

Two changes came after the full keep-green set:
- A wording change in `abortedOutcome` for never-sent requests. It lives in the analysis only, and only for the `signal_aborted_at_call` row.
- This file.

The driver (209/209) and the synthetic unit test were rerun after that change.

## Raw rows (`run-2/store/`)

| file | rows | sha256 (prefix) |
|---|---|---|
| records.jsonl.gz | 176 (abort rows: 10 `aborted`, 2 `after_response`, 1 `no_effect`; 0 `undetermined`) | 550a25caa23905f3 |
| spans.jsonl.gz | 70 | ae8d55d65066c8bc |
| runs.jsonl.gz | 1 | 7905807c806233c4 |

## Residuals, updated

- Where the transfer was still running, the browser's ERR_ABORTED and Tracer's `after_response` differ by design (`/api/drip`). The label follows what reached the app, not the socket.
- A mid-read abort stays `aborted_by_client`: the app had started reading and the body never reached it. This relies on the AbortError fallback for Chromium.
- The one-tick rejection delay now applies in production to every fetch given a signal or a `Request`. That is disclosed. Making it follow the `bodies` policy is Austin's call (see GRADE.md).
- Unowned render mutations are still not recorded. The defect's second half is not fixed.
