# fix/mcp-surfaces: run record (2026-09-24)

Claim: "Every MCP surface says what the rows already hold about a request, wherever the request came from." Gate text: `docs/gates/G4-mcp.md` §3.5. Branch `fix/mcp-surfaces`, rebased onto `origin/main` `d0b19cb8` (PR #16 `fix/client-aborts` merged; both sides kept in `mcp/tools.mjs` and G4, see "Rebase" below). The executor wrote this file; it is not a grade.

## What changed (one rule each; no join, credit, episode, frontier or label rule)

| gap (graders, fresh apps) | rule | where |
|---|---|---|
| (a) bodies of unattributed requests unreachable | `page_requests` requests, `action_chain.unlinked.requests[]` and `recent_actions` (`include_bodies`) carry `body` / `response_body` from the one summariser (`summarizeBody`); `include_bodies: true` on `page_requests` and `recent_actions` returns the stored bodies | `mcp/tools.mjs` `withUnlinkedBodies`, `pageRequests`, `recentActions` |
| (b) issuer keeps only the outermost frame | every first-party frame live at issue, innermost first, `+N more` after 6; `issuer_frames` / `armed_by_frames` in JSON | `issuerFrames`, `describeIssuer` |
| (c) timer DELETE `deferred: null` | `issueDeferral`: request row → `function.enter` rows by continuation id → first non-function continuation names `via`; `ms_after_dispatch` = request row time − dispatch row time; merged into `deferred` by `requestSegmentCore` (`issue` option) | `analysis/causal-chain.mjs` |
| (d) text shows only ids | `bodyFacts`: `request_fields` (short top-level fields, peer-differing first, ≤ 4) and `response_fields` (status-like keys, then peer-differing, ≤ 4); text `sent …` / `answered …` | `bodyFacts`, `bodyTail` |
| (e) 304 beside 200 unexplained | `statusMismatch`: `server answered 304; the browser reported 200 from its cache`, else `browser reported N, server answered M; not the same response, or a proxy between them` | `statusMismatch` |
| (f) img / canvas / list row `not_found` | runtime `content_sig` hashes `alt`; implicit roles for table/landmark tags (none for canvas); enclosing stamped labels score (`ancestors`, identifiers + source spans); `best` may be singled out by `nearby_text` | `src/runtime-attribution-browser.js` (dist rebuilt, `cmp` identical), `analysis/element-index.mjs`, `stampEvidence` |

## Neutral fixture and driver

`test/browser/fixtures/mcp-surfaces-app/` (wouter 3.11.0 route + TanStack Query 5.103.2; React 18.3.1; development build, bodies on), `test/browser/mcp-surfaces.mjs` (tiny backend with spans in the adapter's shape; raw recomputation in the driver; MCP over stdio). Output: `mcp-surfaces-driver.txt`. **86/86 over 3 runs**, per-request texts identical across runs (S0).

One example per surface from run 1 (names and lines from the build's own source text, as in mcp-gaps):
- `page_requests` (mount GET, no action): `GET /api/projects/p1 [none: no user action; issued by getJson …:N (called from loadProject …:N ← queryFn …:N); not inside a timer or frame callback armed outside an action (task origin not recorded)] → route /api/projects/:id 200 → server getProject → db find projects (handler: getProject) [completed 200; answered state: active; response ids id=p1]`, with `response_body.fields {id, name: Apollo, owner, state}` (and `.json` with `include_bodies`).
- `page_requests` (poll): `… GET /api/pulse … [completed 200; answered count: 37]` (count differs between polls).
- `action_chain` (two POSTs, one click): `(1) … POST /api/events … [completed 201; sent type: pulse, source: toolbar; request ids projectId=p1; answered kind: pulse; response ids id=ev_1]; (2) … [completed 201; sent type: follow, …; answered kind: follow; response ids id=ev_2]`.
- `action_chain` (409): `PATCH /api/tasks/t1 → route /api/tasks/:id 409 … [failed 409; sent N ms after the click via a promise continuation; sent done: true; answered error: locked; response ids taskId=t1]`; revision: `[completed 200; …; sent title: Beta, done: true; answered revision: 4, status: done; response ids id=t2]`.
- `action_chain` (timer): `DELETE /api/tasks/t3 … [completed 200; sent 3.0 s after the click via a timer; response ids id=t3]`, `deferred {ms_after_dispatch: 3002, via: "timer", continuation_kind: "timer", continuation_id, …}`.
- `action_chain` (304): `GET /api/config → route /api/config 304 … [completed 304; server answered 304; the browser reported 200 from its cache]`.
- `action_chain.unlinked` / `recent_actions include_bodies` (inline script): `- request PUT /api/prefs (fetch, sequence N, no action_id) → route /api/prefs 200 → server savePrefs → db update prefs (handler: savePrefs) [unlinked]; sent done: true, order: [t2, t1, t3], stars: 42; no first-party frame recorded …`.
- `resolve_element`: `{name: "Team logo"}` → best = the img's key (`content_sig = name (alt)`); `{name: "Burn-down chart"}` → the canvas; `{role: "listitem", name: "Task Beta"}` → the row `…@t2`; `{role: "button", name: "Open", nearby_text: "Task Gamma"}` → the Open button in row `…@t3` (`ancestor …@t3 label = nearby_text (aria-label)`). All `ambiguous`, never `exact`.

## Keep-green (rebased head)

| check | result |
|---|---|
| `npm test` | 708 tests, 707 pass, 1 fail (known `react-context-ref-semantics`) |
| G4 grader (final7) | 81/81 |
| G6 (`g6-compare.mjs` regenerated, 6 pairs; manifests gunzipped) | PASS 6/6 |
| D12 | pass: true, no first difference (A/B/C/D) |
| continuations-neutral | status ok |
| episode-focus `--runs 3` | exit 0 |
| outcome-labels | 169/169 |
| mcp-gaps | 35/35 |
| body-capture | 51/51 (M10 now strips every body clause, ids and fields, before comparing bodies on/off; it was 50/51 with the old regex that stripped ids only) |
| middleware-reads (3 runs) | 343/343 |
| client-aborts | 245/245 |
| mcp-surfaces (3 runs) | 86/86 |
| `npm run build`; `cmp` src/dist | identical |

Test edits: `test/no-false-negatives.test.mjs` compares the chain record's unlinked listing with the MCP's minus the added body fields (and asserts those are `null` there); `test/browser/body-capture.mjs` M10 as above.

## Banked stores: every text change and why it is right

Method: `bank-run.mjs` / `bank-diff.mjs` (copied here from `pr-mcp-gaps-2026-09-24`), main = `git archive origin/main` (`d0b19cb8`), same calls on both sides (tools/list, `recent_actions {n:100}`, `action_chain` per action, `element_history` per key, 7 `resolve_element` probes, `compare_chains` on the graded pairs, `page_requests` twice). Files: `diff-f7-src.txt`, `diff-f7-nosrc.txt`, `diff-g6.txt`, `diff-allm.txt`, `diff-allm2.txt`. The two bodies-on stores are the anything-llm stores of the body-capture runs (`anything-llm`, `anything-llm-2`: 76 `network.body` rows each), which were kept outside the repo (the banked evidence holds their analyses, not the rows).

Unchanged on every store: `stops`, `reached`, `stopped_at`, `because`, `outcome.status` / `label`, `chain`, `compare_chains` stops, verdicts and `path_changed`, `resolve_element` answers. Added everywhere: `null` `browser_status` / `request_fields` / `response_fields` on segments, `null` body fields on `page_requests` and unlinked entries.

- **G6 (anything-llm, 2026-09-23 runtime, no bodies): no text change.** Its requests walk to the dispatch or to a function continuation with no recorded enter row, so no issue deferral is claimed; no body rows, so no fields.
- **final7 (LibreChat, with and without source root): 63 segment lines gain `sent N ms after the <event> via a promise continuation`** (62 under 1 s, 1 over), and so 8 action first lines, 7 `element_history` headlines, 1 `compare_chains` summary and 26 `page_requests` lines (attributed requests). Right because each such request row's `parent_continuation_id` leads through `function.enter` rows to a `promise`/`await` continuation of its own action: the request was not sent synchronously in the handler, and the delay is the two rows' own times. Nothing else in the text moved.
- **anything-llm bodies-on stores: 24 segment lines per store** (and the matching action, attempt, headline and 75 `page_requests` lines) gain, as the rows hold:
  - `sent name: Tracer G2 renamed` (workspace rename POST) and `sent name: Renamed by Tracer` (thread rename): the request body's own short field;
  - `server answered 304; the browser reported 200 from its cache` on every GET whose server span says 304 and whose response body row says 200 (Chromium revalidated and served the cached body);
  - `sent N ms after the <event> via an effect` (15) or `via a promise continuation` (6): the continuation walk;
  - `answered success: true`, `answered workspaces: []`: a status-like key, or a value that differs from another request to the same URL in scope.

## Rebase (onto d0b19cb8, PR #16 client-aborts)

Conflicts in `mcp/tools.mjs` (imports: `abortedBecause` plus `issueDeferral`/`issueDeferralText`; `page_requests` attributed and unattributed entries keep main's `server_status` / aborted `http_status: null` and add the body fields) and G4 (main's §3.4 Client aborts kept; this amendment is §3.5). The body summaries, `deferred` and issuer text ride on the current `requestSegmentCore` (issue deferral is its `issue` option); the status mismatch compares `browser_status` with the segment's `http_status`, which is `null` for an aborted request, so an abort never reads as a mismatch.

## Residual risks

- Only the continuation nearest the request is named: a timer that schedules a promise reads `via a promise continuation` with the full delay. A function continuation without an enter row stops the walk (no claim).
- `ms_after_dispatch` is a browser-clock difference between two rows of one page (a measure, not a join); below 1 s it prints whole ms.
- Response text shows status-like and peer-differing fields only: entity labels (`name: Apollo`) stay in `response_body.fields`; top-level only; ≤ 4 each. Status-like keys are a fixed generic vocabulary; an app that names its status field otherwise shows it only when it differs between same-URL requests.
- `browser_status` exists only with body capture on; a 304 without a body row (bodies off) is printed as before.
- Enclosing labels need both elements stamped (an element with a handler) and the same rendered instance (equal React key paths, or single-instance ordinals); partial visible text still cannot match a hash.
- `alt` joins `content_sig` from this runtime on: images in older stores never match by alt, and an image whose alt changes now emits a new stamp row (index-like-key detection sees it).
- The export (`buildActionChains`) keeps the server-only `deferred`.
