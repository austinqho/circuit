# fix/client-aborts — implementer's run (2026-09-24)

Claim: **a request the page aborted is labelled as aborted on every surface, never as completed, and the server's answer is kept as a separate fact.**

Branch `fix/client-aborts`, base `main` f9a925d7. Written by the implementing agent; not an independent grade. A separate grader should recompute from `store/` (raw rows) and drive the MCP as a black box. Contract: `docs/gates/G4-mcp.md` §3.4 and the dated label-set amendment under the outcome-labels table. Skill: `plugin/skills/tracer-annotations/SKILL.md` (trust and honesty rules).

## The defect, generically

A search box sent a request per keystroke; the page aborted each superseded one (its fetch rejected with an AbortError, and the rows had `threw: true, error_type: "DOMException"` on the query function's exit). The server still answered 200 and the span joined, so every aborted request was labelled `completed 200`. In a multi-request episode, the engine's credited-request rule ("latest with a write") could also pick an aborted request.

## Rules as implemented

1. **Runtime (every build; additive rows, none on pages that abort nothing).** The request row has already left the page when an abort happens, so the facts are rows of their own keyed by `request_occurrence_id`. They are sequenced, carry no `action_id`, and have `parent_continuation_id: null`. `mergeRequestFacts` puts them on the request row for every reader.
   - `network.abort`: `abort_state` (`aborted | no_effect | undetermined`), `aborted_by_client`, `abort_reason` (`via`, DOMException `name`, `reason_type` = constructor name of an Error reason; never a message), `aborted_at` (`before_response_headers | while_reading_body`), `response_received_before_abort`, `body_read_started`, `response_consumed_before_abort`, `abort_evidence`, and XHR `ready_state_at_abort`.
   - The evidence is the signal and the rejection, never timing:
     - A fetch rejected while its signal is aborted, with the signal's reason object (`fetch_rejected_with_signal_reason`) or an AbortError (`…_abort_error`).
     - The signal aborted after the response arrived and the body was unread (`signal_aborted_body_unread`).
     - A body read was pending when the signal aborted and then rejected (`body_read_rejected_with_…`). Chromium rejects a mid-read body with a fresh AbortError, not the reason object; the fixture shows this.
     - An XHR fired its own `abort` event (`xhr_abort_event`).
   - An abort after the app finished reading the body is `no_effect`, and is never labelled aborted.
   - `network.response_read` (`via: json|text|…`) is emitted when the app finishes reading the body of a signal-carrying fetch.
2. **`actionOutcome`.** `aborted_by_client` wins over the server's status for that request. `http_status` is `null`. The server's status is kept as `server_status` and stated. Label: `Aborted by the page: GET /api/search; the server answered 200`. Sentence: `aborted by the page before the response was read: GET /api/search (before the response headers arrived; AbortError); the server answered 200 and read find items`. A 500 to an aborted request is still `aborted_by_client` (with `server_status: 500`). The credited request is never an aborted one while a non-aborted request exists. This holds in `describeEpisodeEvidence` and in the export's ranking. Every aborted request is listed in `also aborted_by_client METHOD path (server answered N)`.
3. **One label everywhere.** The MCP (`action_chain`, `element_history` actions and attempts, `recent_actions`, `compare_chains`, `page_requests`, segments), the export (`buildActionChains`) and the live viewer (`buildEpisodeChain`) all read the merged rows and the one function. The frontier sentence of an aborted request starts `the page aborted the request; the server answered N; `.
4. **Abstain.** The outcome says `the last non-aborted request's response (GET /api/notes) was read by the app (json read recorded)` only when that request's `network.response_read` row exists. Otherwise it says `which response the app rendered is not recorded`.
5. **Coverage.** Abort rows are counted like any row; `coverage.complete` is true on the fixture page.

## Commands and counts (this branch)

```sh
node test/browser/client-aborts.mjs --out docs/evidence/pr-client-aborts-2026-09-24        # 203/203 (this directory; and 3 more runs: 203/203 ×3)
node test/browser/outcome-labels.mjs --out docs/evidence/pr-client-aborts-2026-09-24/outcome-labels   # 169/169 (was 160; +9 for an aborted write)
npm test                                     # tests 701, pass 700, fail 1 (known react-context-ref-semantics); +1 synthetic client-abort test in mcp.test.mjs
node test/browser/d12-stamp-neutrality.mjs   # pass: true, 23/23 checks true
node test/browser/continuations-neutral.mjs  # status ok
node test/browser/episode-focus.mjs          # status ok, stable (3 internal runs) — run 3 times, exit 0 each
node test/browser/mcp-gaps.mjs               # 35/35
node test/browser/body-capture.mjs           # 51/51 after amending P6 (see below)
node test/g4-grader.mjs docs/evidence/m1-2026-09-22-final7 --manifest docs/evidence/g4-mcp-2026-09-23/manifest.json   # 81/81
# G6: gunzip the g6 store to <g6store>; g6-compare with the six pairs (see pr-outcome-labels RUN.md) on this branch and on main f9a925d7
node test/g6-grader.mjs <g6store> --compare <g6out>   # Overall: PASS (6/6 pairs); compare/*.json and AGENT-READS.md byte-identical to main's
npm run build && cmp src/runtime-attribution-browser.js dist/runtime-attribution-browser.js   # identical
```

**body-capture P6 changed deliberately.** P6 pinned "the rejection reaction of an aborted fetch runs one microtask later only with bodies on". A signal-carrying fetch is now tracked in every instrumented build through the same derived promise. So the one-tick delay now also holds with bodies off and in production. P6 now asserts that (plain Tracer-less build: `listener-micro,fetch-rejected,b`; every instrumented build: `listener-micro,b,fetch-rejected`). This is a real observable difference and is disclosed in G4 §3.4.

## Fixture (`test/browser/fixtures/client-aborts-app`, driver `test/browser/client-aborts.mjs`)

TanStack Query **v5.103.2**, resolved from the Tracer checkout (no existing fixture uses it). React 18.3.1 comes from the dependency root, via Vite `resolve.dedupe`, through the new `resolve` option of `fixture-build.mjs`. The backend is Express under `node --import producttrace/backend/register`. It answers slowly, writes DB-like spans, and logs a `served {…}` line per answer. The front proxy never forwards the browser's abort, so the server always finishes. Truth comes from outside Tracer: Playwright `requestfailed` (`net::ERR_ABORTED`) vs `requestfinished`, the server's log lines, and the page's own text.

| case | truth (browser / server) | Tracer |
|---|---|---|
| TanStack key change, q=a and q=ap (per keystroke; previous fetch aborted via `signal`) | ERR_ABORTED / 200 | `aborted_by_client`, before headers, server_status 200 |
| TanStack last key q=apr | finished 200 | `completed 200`, body read (json) recorded |
| `queryClient.cancelQueries` | ERR_ABORTED / 200 | `aborted_by_client`, owned by the Load click |
| plain AbortController (Start, then Cancel) | ERR_ABORTED / 200 | Start click `aborted_by_client`; Cancel click `no_request` |
| abort after headers, before the body was read | ERR_ABORTED / 200 | `aborted_by_client`, `while_reading_body`, `body_read_started: false` |
| abort while the app reads the body, reason = an app Error | ERR_ABORTED / 200 | `aborted_by_client`, `while_reading_body`, `body_read_started: true`, `reason_type: ReadDeadline` (message never recorded) |
| abort after the app consumed the body | finished 200 | `no_effect` row; `completed 200` on every surface |
| server answers 500 to an aborted request (app Error reason) | ERR_ABORTED / 500 | `aborted_by_client`, server_status 500, `failed_requests: 0` |
| one click: POST (writes at once, answers 201 later) aborted, then GET | POST ERR_ABORTED / 201; GET finished 200 | `Completed 200: find notes; also aborted_by_client POST /api/notes (server answered 201)`; the GET is credited although the POST joined an insert; "the last non-aborted request's response (GET /api/notes) was read by the app (json read recorded)" |
| `xhr.abort()` | ERR_ABORTED / 200 | `aborted_by_client`, before headers, `ready_state_at_abort: 1` |

Also checked: the set of requests the browser reports aborted equals the set with `aborted_by_client` rows; coverage complete; no page errors; every case again through the MCP over stdio (`action_chain`, `recent_actions`, `element_history` action + attempt, `page_requests`).

## Raw rows committed

| file | rows | sha256 (prefix) |
|---|---|---|
| store/records.jsonl.gz | 145 (12 `network.request`, 10 `network.abort`, 3 `network.response_read`) | a8ef3676f8986e4f |
| store/spans.jsonl.gz | 60 | 60438dc560756722 |
| store/runs.jsonl.gz | 1 | 61171dba00691d69 |
| outcome-labels/store/records.jsonl.gz | 281 | 5379e6dcb7ba7ecb |
| outcome-labels/store/spans.jsonl.gz | 46 | 0376dc731c56da9c |

The session is `s_8866ee1b`. The report is `client-aborts-report.json`: observed network, served lines, every check with its detail, and per-case statuses.

## Banked stores

final7 and the G6 store contain **0** `network.abort` / `network.response_read` rows (recorded before this runtime), and no `threw` fields. Whether any of their requests were aborted is therefore not recorded. `mergeRequestFacts` returns the same array for them, so their answers are byte-identical: G4 81/81, and the G6 compare is byte-identical to main.

## Residuals (also in G4 §3.4)

- Only fetches that carry an `AbortSignal` are tracked. Every `Request` object has its own signal, so a fetch called with a `Request` is always tracked, and gets the one-tick-later promise.
- A body read through a stream reader or a clone's stream, or a dropped response, gives `undetermined`, never `aborted`.
- The body-phase fallback accepts an AbortError from a read that was pending at the abort. A coincident network error of that exact type would be taken as the abort.
- `network.response_read` exists only for signal-carrying fetches and the body-reading methods. XHR bodies and stream reads are not recorded as read, so `app_read` abstains for them.
- `reached` / `stopped_at` of an aborted chain still describe the server-side evidence ("stopped at none (terminal effect observed)"). Only the `because` sentence and the outcome say the page aborted.
- Which DOM mutation rendered the last result is not addressed; that is the DOM-mutation ownership follow-up. The defect's second half ("the mutation that rendered the last result was credited elsewhere") is not fixed by this PR.
- An abort after the page's final `capture.summary` would be an uncovered row.
