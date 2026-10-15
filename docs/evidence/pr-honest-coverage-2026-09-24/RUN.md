# fix/honest-coverage: run record (2026-09-24)

Claim: **Tracer never claims more coverage or completeness than its rows prove.** Branch `fix/honest-coverage` from `main` f9a925d7. The rules as implemented are in `docs/gates/G4-mcp.md` §3.4. This directory is immutable; later notes go in `RUN-2.md`.

## Defects addressed (stated generically)

| | Defect | Rule | Mechanism |
|---|---|---|---|
| a | `coverage.unobserved` was the constant `["beacon"]` | 1 | `capture.page.observes`: the runtime enumerates the browser's `on*` handler kinds at install and compares them with the one list it installs its action listeners from. Each transport is recorded as wrapped, not wrapped or absent. One `capture.limit` per child frame (with its origin status; content never read) and per worker. `unobservedOf` reads only these rows. |
| b | `complete: true` + "stopped at none (terminal effect observed)" past an escaped server-to-server hop | 2, 3 | `server_hops` on the chain record. Outbound client spans under the joined server span are matched to a continuing server span by identifier. Server spans with no browser parent that start in the window after the joined server span are candidates, chosen by order only, never joined. When there is an escape: `stopped_at: "server_hop"`, with the reason in `because`, `coverage.window_reasons` and the outcome label. |
| c | a click said `no_request` while an unattributed request left the page in its window | 2, 4 | `window_evidence` on the chain record. The headline `because`, label, sentence and bracket name each such request: method, path, and the issuer, or "issuer unknown". |
| d | `page_requests` "none: no user action" | 5 | `not attributed to any user action; <issuer>` |

## Commands and counts (HEAD before this file: cd882dbc)

```sh
npm run build && cmp src/runtime-attribution-browser.js dist/runtime-attribution-browser.js   # identical (build.txt)
npm test                                           # 700 tests, 699 pass, 1 fail: the known react-context-ref-semantics (npm-test.txt)
node test/browser/honest-coverage.mjs --out fixture   # 36/36 (fixture-run.txt, fixture/honest-coverage-report.json)
node test/browser/d12-stamp-neutrality.mjs         # pass: true
node test/browser/continuations-neutral.mjs        # status ok
node test/browser/outcome-labels.mjs               # 160/160
node test/browser/mcp-gaps.mjs                     # 35/35 (wording expectations updated)
node test/browser/body-capture.mjs                 # 51/51
node test/browser/unlinked-coverage-neutral.mjs    # 13/13 (A8 failed on main; see below)
node test/browser/worker-frontier.mjs              # ok
node test/browser/episode-focus.mjs  ×3            # ok ×3  (browser-suite.txt)
node test/g4-grader.mjs docs/evidence/m1-2026-09-22-final7 --manifest docs/evidence/g4-mcp-2026-09-23/manifest.json   # 81/81 (g4-grade.md)
# G6: gunzip docs/evidence/g6-anything-llm-2026-09-23/store into <g6>, then
node test/browser/g6-compare.mjs --store <g6> --out <cmp> --pair A-baseline:B-seeded-422 --pair B-seeded-422:C-fix-r2 \
  --pair A-baseline:C-fix-r2 --pair A-baseline:D-noop-refactor --pair B-seeded-422:C-fix --pair A-baseline:E-frontend-early-return
node test/g6-grader.mjs <g6> --compare <cmp>      # Overall: PASS (6/6 pairs) (g6-grade.md)
```

## The fixture (`test/browser/fixtures/honest-coverage-app`, `test/browser/honest-coverage.mjs`)

The fixture uses a library no other fixture uses: `@radix-ui/react-dialog`, rendered in a portal. It is resolved from the build's dependency root, the default LibreChat root, which has 1.0.2. Its API runs under `node --import producttrace/backend/register` (real OTel, Express). A front server proxies it. An "external" server on another port has no telemetry.

Driver order:
1. Save note: one write. This is the plain case.
2. Sync opens the Radix dialog.
3. Confirm sync: the handler writes, then calls `/api/notify` on the same server with Node's `fetch`. undici is not instrumented, so this starts a new root trace.
4. Export: the handler writes, then calls the external server over `node:http`. That produces a client span, which no server span continues.
5. Open panel: sends nothing. Then the pointer enters the panel. An uninstrumented public script listens there on an event kind chosen at run time. The driver took the page's own `observes.events.unobserved`, probed which of those kinds a trusted hover fires, and picked the first one (this run: `mouseenter`). That listener POSTs `/api/hover-note`, and the issuer is unknown.
6. Leaving the page: `sendBeacon('/api/bye')`.

The page also has a same-origin iframe, an iframe on another port, and a Worker.

What the checks prove: each is computed from raw `records.jsonl` / `spans.jsonl` first. The package's answers are then compared in process, over the MCP server's stdio, in `buildActionChains` exports, and in the chain `display` label.
- **O1–O6 (rows).**
  - `observes.events.unobserved` equals an independent in-page enumeration minus `recorded` (137 kinds in Chromium).
  - The chosen kind started no action.
  - Transports: every transport is `wrapped` except beacon and service_worker, which are `not_wrapped`.
  - Two frame `capture.limit` rows: one same-origin with its URL, one cross-origin with URL null.
  - One `worker_fetch` limit.
  - The beacon reached the server with no request row and no parent span.
- **C1–C4 (coverage).**
  - `unobserved` names exactly those kinds, the two transports, 2 frames (1/1) and 1 worker, each with a reason.
  - Page coverage is incomplete, with the capture limits and one reason per unobserved realm. Delivery itself is contiguous.
- **F1 (plain case).** `stopped at none (terminal effect observed)`, with no window reason.
- **F2–F5 (escaped hop).**
  - `reached db / stopped at server_hop / because reached db (database write update syncs joined by exact span parentage); a further server-side hop may have escaped: 1 server-side request in this window has no browser parent (listed as unlinked)`.
  - The root span is listed under the sync action (same span id as the raw `/api/notify` span).
  - The outcome reads `Completed 200: update syncs; a further server-side hop may have escaped`.
  - Coverage is incomplete with the window reason. The segment says the same.
- **F6–F7 (unfollowed outbound call, by identifier).**
  - `… 1 outbound call from the joined server span has no server span continuing it (POST http://127.0.0.1:<port>/hook)`.
  - The OTel http instrumentation wrote two nested client spans for that one call. They are counted as one call (the rule: a client span nested under an outbound client span is the same call).
  - The escaped root span is not listed under the later Export action.
- **H1–H4 (request-less headline).**
  - Open panel: `no request could be attributed to this action from instrumented code; 1 request left this page during this action's window that Tracer could not attribute (POST /api/hover-note, issuer unknown), listed below as unlinked`, in `because`, label, sentence and bracket.
  - Its coverage is incomplete: the unknown-issuer request, and the beacon's root span, which falls in its window at page end.
  - The dialog opener (nothing left the page in its window) keeps the plain scoped sentence.
- **P1 (`page_requests`).** The text starts `not attributed to any user action; no first-party frame recorded …`. The string "no user action" appears nowhere in the output.
- **S1 ×4 (one source).** The export, `recent_actions`, the chain display and `action_chain` agree on `stopped_at`, the escape clause or headline, and the outcome label. The export keeps `because: null` for a joined DB stop, as before.
- **M1–M3 (stdio).** The MCP over stdio answers identically. The summary carries the escape sentence, the headline, the `Coverage incomplete` line and `Not observed on page …: 137 event kind(s) that start no action; transport beacon not wrapped; transport service_worker not wrapped; 2 frame realm(s) (1 same-origin, 1 cross-origin); 1 worker realm(s)`.

## Test edits (expectation updates, each forced by a rule)

- `test/no-false-negatives.test.mjs`:
  - The request-less headline now names `GET /api/third-party, issuer unknown`.
  - "unlinked evidence never changes …" became "never changes the chain or its joins; the window only withholds a claim or states what left the page". It now builds the plain chain from all rows, since the window is computed from the rows given when no index is passed. It asserts the chain equals a chain built without the unattributed rows.
  - The first click's coverage is now incomplete: its window holds the script's fetch with an unknown issuer. Page delivery is still complete.
  - `unobserved` is `[]` on the VM page: no `on*` properties, and every other transport is absent.
- `test/worker-frontier.test.mjs`: two workers now give two `worker_fetch` limits.
- `test/browser/unlinked-coverage-neutral.mjs`:
  - A2: the headline.
  - A7: the click's coverage is incomplete for the same reason as in the unit test.
  - A8: **it failed on main** (it expected the constant `["worker","beacon"]`, but the runtime has wrapped Worker since the worker-frontier PR). It now checks that `unobserved` is measured: the events entry equals `observes`, beacon is listed, nothing wrapped is listed, and there are no realms. It passes.
  - B3: the action's reasons are the page's reasons followed by its `window_reasons`.
- `test/browser/mcp-gaps.mjs`: P2, P6 and P8 wording ("not attributed to any user action", "N not attributed").

## Banked stores: what changed and why (`banked/`)

Method:
- `docs/evidence/pr-mcp-gaps-2026-09-24/bank-run.mjs` spawns the MCP server over stdio for a `git archive` of `main` f9a925d7 and for this branch. It calls recent_actions (n 100), action_chain for each listed action, element_history for each listed key, 7 resolve_element probes, the graded compare_chains pairs, and page_requests.
- `bank-diff.mjs` diffs the two runs. Output: `banked/diff-*.txt`.
- `banked/sweep.mjs` additionally compares every action of each store in process. For each action it compares `stopped_at`, `because`, the outcome label, sentence and status, coverage `complete` and `reasons`, and the first summary line. Output: `banked/sweep-*.json`.
- Stores: final7 (with the G4 manifest), G5 (`g5-anything-llm-2026-09-23c/store`) and G6 (`g6-anything-llm-2026-09-23/store`). The G5 and G6 stores were gunzipped copies.

| store | actions | stopped_at | because / label / first line | coverage.complete | coverage.reasons |
|---|---|---|---|---|---|
| final7 | 54 | 0 changed | 0 | 0 (all already false: no coverage rows) | 5 gain a window reason |
| G5 | 151 | 0 | 1 | 0 (all already false) | 2 gain a window reason |
| G6 | 408 | 0 | 0 | 0 | 0 |

Why each change is right:
- **final7, 5 actions** gain `N request(s) left this page in this action's window not attributed to any user action and with no known issuer`. The requests are real: unattributed `network.request` rows whose sequence falls in the window. They have no `issuer` field, because the runtime predates it, so the issuer is unknown. These actions are request-bearing, so their frontier is unchanged. Their coverage was already incomplete ("no coverage rows"); the added reason is true.
- **G5 `action:muen73wz:28`** (a focusin, `no_request`): one `GET /api/setup-complete` without an action left the page in its window. The headline now says so: `…; 1 request left this page during this action's window that Tracer could not attribute (GET /api/setup-complete, issuer unknown), listed below as unlinked`. Main's sentence was only the scoped parenthetical, which is defect c. `action:muen73s5:27` (request-bearing) gains the coverage reason for 6 such requests.
- **No frontier moved to `server_hop` on any banked store.** No banked backend emitted client spans: the register used to drop them, which this PR changes for new runs. None has a root server span in a request-bearing window after its server start. So "terminal effect observed" stands where it stood. 13 / 3 / 12 chains carry the additive `server_hops`, with nothing unfollowed.
- **Everywhere:**
  - `coverage.scope` has the new text.
  - `window_evidence` is added to chain records, and `unlinked.requests_issuer_unknown` is added.
  - page_requests text changes: 166 final7, 36 G5 and 165 G6 requests read `not attributed to any user action; issuer not recorded (runtime before 2026-09-24)`.
  - `coverage.unobserved` stays `null`: none of the banked stores has a `capture.page` row.
- G4 81/81 and G6 6/6 are unchanged.

## Other changes worth knowing

- `backend/register.js` now ships `client` spans, i.e. outbound calls, except its own span-delivery request (matched by destination = the span endpoint). Without them rule 3's identifier branch could never fire under the default entrypoint. Node's global `fetch` is still not instrumented by default (undici adapter off), so such calls appear only as root spans. Joining them is follow-up #6 of the cycle-2 handoff.
- `serverSpansWithoutBrowserParent`: a server span whose parent is a recorded backend span is joined by that id and is no longer listed as unlinked (in `unlinked` or `page_requests`). No banked store had such a span.
- Runtime version is `0.1.0+coverage.2`. `capture.page` adds `observes`; `capture.summary` adds `realms`. There is a new row kind, `capture.realm`, emitted only when a frame's origin status changes.

## Residual risks

- **Continuation candidates are chosen by order.** Any root server span that starts in an action's window after its request reached the server is a candidate, even an unrelated one (another client, a health check, a worker's fetch). On a busy shared backend this withholds "terminal effect observed" more often than necessary. It errs toward withholding, never toward claiming.
- **Frames are checked only at install, load, each action, each request and each summary.** A frame inserted and removed between two checks is missed. A frame first seen on its initial about:blank and navigated cross-origin later is corrected by a `capture.realm` row only at the next check.
- **The unobserved events list is long** (137 in Chromium) and includes kinds no user causes (e.g. `load`, `animationend`). It is "exposed and not recorded", not "user-caused". The runtime still records only six kinds; recording pointer events is follow-up #1.
- **Nested client spans are treated as one call** (the rule for OTel http double-wrapping). If a client library issues two separate calls from inside one outer client span, they count as one call. The call is still continued only if a server span has any of its spans as parent.
- **The export's `because` stays `null` for a joined DB stop**, as before this PR. An escaped export chain therefore reads `reached db; a further …` without the DB sentence.
- **The fixture uses LibreChat's Radix 1.0.2**, not the 1.1.23 in this repo's devDependencies: the build resolves from the dependency root.
- **Chromium exposes `navigator.serviceWorker` on 127.0.0.1**, so `service_worker: not_wrapped` is listed on every such page even when none is registered. That is true (a registration would not be observed), but noisy.
