# GRADE: fix/honest-coverage (head c28aa99c on main f9a925d7)

Grader: independent. I did not write this branch. Every number below was recomputed from raw `records.jsonl` / `spans.jsonl` or taken from the MCP server driven over stdio as a black box. I did not trust RUN.md, test names or the author's sweeps. Scratch (not committed): `grader-scratch/` in this worktree.

Claim graded: **"Tracer never claims more coverage or completeness than its rows prove."**

## Verdict: **merge with changes**

The branch is a large step up from `main`. `unobserved` is measured, not a constant. Escaped root-trace hops and unfollowed outbound calls withhold "terminal effect observed". Request-less headlines name what left the page. `page_requests` no longer asserts a cause. Every surface agrees.

It does **not** yet meet its claim. Probe (g) makes Tracer print `stopped at none (terminal effect observed)` and `coverage.complete: true` for ordinary handler code whose second outbound call went to a service Tracer never saw. Probes (b2) and (d) produce `complete: true` over traffic the runtime did not observe and did not list as unobserved. Changes 1 to 6 below are required before merge. Change 7 is a merge-order requirement.

## Per-rule table

| # | Rule | Verdict | Raw evidence |
|---|---|---|---|
| 1a | `unobserved` event kinds come from what the runtime installed, never a constant | **PASS as specified, incomplete as claimed** | 3 driver runs: `capture.page.observes.events` has 142 exposed and 6 recorded. `focusin` has no `on*` property, so 137 are unobserved. `coverage.unobserved[events].count` = 137 in all 3 runs, and my recompute (`grader-scratch/recompute.mjs`) finds 0 mismatches. The basis is `on*` properties only, so kinds with no handler property are missing: `focusout` (how React implements `onBlur`), `compositionstart/update/end`, `DOMContentLoaded`, and touch events where `ontouch*` is absent. In probe (a), a React `onBlur` autosave fired through `focusout`. `unobserved` does not list `focusout`, yet the page's "Not observed" line reads as exhaustive ("137 event kind(s) that start no action"). |
| 1b | Transports wrapped / not wrapped / absent | **FAIL (websocket)** | `observes.transports` computes fetch, xhr, eventsource and websocket as `transportStatus(present, present)`. That is tautological: "present" is reported as "wrapped" without checking that the wrapper is still installed. In `src` the WebSocket wrapper records only `CONNECT`. `ws.send(...)` is never recorded, yet it reports `websocket: "wrapped"`. See probe (d). |
| 1c | Child frames and workers are each a limit | **PASS for static frames and workers, FAIL for transient frames** | Driver: 2 `capture.limit{feature:"realm"}` rows (1 same-origin with URL, 1 cross-origin with `url:null`) and 1 `worker_fetch` limit per worker. The summary has `realms {frames_seen:2, frames_now:2, workers_created:1}`, verified in 3 runs. In probe (b)/(b2) an iframe is inserted 50 ms after a click and removed 400 ms later. The result is `frames_seen:0` and no realm row: nothing in the rows discloses it (below). |
| 2 | `complete:false` with reasons in each listed case | **PARTIAL** | Each listed condition fires, and each reason's count matches my recompute: an unknown-issuer request (driver H3; probe c: 3 requests), a root server span in the window (driver F4; probes b, e, i), an unfollowed outbound call (driver F6; probe f Chain2 `hook-from-b`), a capture limit (driver C4), a pending body read (probe h: `bodies_pending:1` → "1 body read(s) still in flight at the last capture.summary"). The rule fails in 3 cases: `complete:true` with an unobserved frame present (b2), with an unrecorded WebSocket send that caused a DB write (d), and with a hidden unfollowed outbound call (g). |
| 3 | "Terminal effect observed" only when nothing could continue the request | **FAIL** | PASS cases: (e) an unrelated curl root span during the request's server span gives `server_hop` "1 server-side request in this window has no browser parent (listed as unlinked)", and the span is never joined into the chain. (f) an outbound call to an instrumented second process is `continued_by` identifier: `stopped_at:null`, and B's handler and DB write appear in the chain ("server chainA,bWork → db insert a_chain, insert b_work"). (f) Chain2, where B's own outbound call is unfollowed, gives `server_hop`. **FAIL case (g) Seq:** a handler calls B, then in B's response callback calls an uninstrumented external service. Raw spans show `client POST …/hook-seq` nested under the `client POST …/b/work` span (OTel http runs the response callback in the client span's context). `outboundSpans` merges them into one call, and B's server span continues that call. The chain reads `reached db / stopped at none`, `Completed 200: insert b_work`, `complete:true`. External hit log: `POST /hook-seq tp=yes`. **FAIL case (g) Batch:** the same outcome when two calls run inside one SDK client span. |
| 4 | A `no_request` headline names what left the page | **PASS, wording overstates** | Driver H1 in 3 runs; probe (c): "3 requests left this page … (POST /api/inline-global, issuer unknown; …)". Probe (d): "(POST /api/ws-triggered, issued by instrumented code outside any action)". The count is of recorded requests only. In the author's own fixture the pagehide beacon also left the page in the Open panel window (its root span is in `window_reasons`), but the headline says "1 request left this page". The clause also *replaces* the old scope caveat ("requests from uninstrumented scripts, workers and third-party code cannot be linked"), so the listed requests read as exhaustive. |
| 5 | `page_requests` never says "no user action" | **PASS** | No occurrence in any stdio output (3 runs, 11 probe pages). The text is `not attributed to any user action; <issuer>`, and the summary reads `N not attributed to any user action`. The string remains only in code comments. |
| 6 | One source of window facts for every surface | **PASS** | Driver S1 ×4 in each of 3 runs: export, `recent_actions`, `display.label` and `action_chain` agree. My recompute: `recent_actions` equals `action_chain` for every action in 3 runs and 11 probe pages (0 mismatches). Banked sweep: export and MCP changes coincide (G5: both change on the same action only). |

## Driver (3 runs)

`node test/browser/honest-coverage.mjs --out grader-scratch/runN` gives 36/36 ×3. Recompute from raw rows (`grader-scratch/recompute.mjs <store>`, MCP over stdio) gives 0 mismatches ×3. Checks per run:
- For every action: the window, the unattributed requests with an unknown issuer, the root server spans in the window, the unmatched outbound calls, and whether `server_hop` is expected. Compared with `coverage.window_reasons` and `stopped_at`.
- `unobserved` compared with `observes`, the realm limits and the workers.

The `server_hop` sentence appears only on Confirm sync (a root span `/api/notify` started after `/api/sync`'s server span started) and on Export (an unfollowed `POST …/hook`). It is absent on Save and on every request-less action.

The driver's O1 "independent enumeration" uses the same algorithm as the runtime (`on*` over the same three prototypes), so it cannot detect the missing kinds in 1a.

## Probes (`grader-scratch/probes.mjs`, `grader-scratch/probe-app/`; output `grader-scratch/probes-out/probes-a_b_b2_c_d_d2_e_f_g_h_i.json`)

The backend runs under `node --import producttrace/backend/register`, a second instrumented process B runs the same way, an external service has no telemetry, and the MCP is driven over stdio.

| probe | what was done | what Tracer said | verdict |
|---|---|---|---|
| a | No iframe, worker or beacon. Save, then type in a field and blur it (React `onBlur` → autosave) | `unobserved`: 137 event kinds, beacon and service_worker not wrapped, no realms. Save is `complete:true` with 0 reasons. The autosave is named in the `change` action's headline as "issued by instrumented code outside any action", with `complete:true` | `complete:true` on Save is earned. `focusout` is absent from `unobserved` (1a) |
| b | Click, then a same-origin iframe is inserted at +50 ms, fetches `/api/frame-ping`, and is removed at +450 ms | No realm row, `frames_seen:0`. Disclosure only by accident: the frame's request reached an instrumented backend as a root span, giving the window reason "1 server span(s) … no browser parent". `unobserved` has no frame. The headline gives the scoped sentence only | Not disclosed as a realm |
| b2 | The same with an other-origin iframe (external, no telemetry) | **`complete:true`, reasons `[]`**, no frame in `unobserved`, and the scope says `unobserved` lists the realms the runtime does not observe | **FAIL**: overclaim |
| c | Inline `<script>` (no issuer) fires 3 fetches in a click's window (global fetch, its early-captured fetch reference, cross-origin no-cors) | The runtime is installed before body inline scripts (`__inlineSawNative:false`), so all 3 are recorded with issuer unknown. The headline names all 3 and gives `complete:false` with "3 request(s) … no known issuer" | PASS |
| d | WebSocket opened by Connect (`onmessage` property). Ping calls `ws.send('go')`, the server pushes, and the page fetches `/api/ws-triggered` (DB write) | Ping: "No request: the handler ran and issued no request from instrumented code; 1 request left this page … (issued by instrumented code outside any action)", **`complete:true`**. `observes.transports.websocket:"wrapped"`. The `ws.send` is in no row | **FAIL**: "wrapped" and `complete:true` overclaim |
| d2 | Same, with `addEventListener('message')` | `/api/ws-triggered` is attributed to **Connect** (the socket creator's frame), not Ping. Connect reads `reached db`, stopped at none, `complete:true`. Ping reads no request, `complete:true` | Pre-existing misattribution (`wrapOwnedCallback(active, listener)` on WS listeners, not changed by this branch). Report separately |
| e | `curl /api/health` directly on the backend during `/api/slow`'s 600 ms server span | Slow: `server_hop` "1 server-side request in this window has no browser parent (listed as unlinked)". The health span is not in the chain | PASS (withheld, says why, never joined) |
| f | Chain calls instrumented B over node:http. Chain2 calls B, and B calls external | Chain: stopped at none, B's handler and DB write shown, `complete:true`. Chain2: `server_hop` "1 outbound call … (POST …/hook-from-b)" | PASS (the continuation by identifier is not `server_hop`) |
| g | Batch: two calls inside one `sdk batch` client span (B, then external). Seq: B, then external from B's response callback | Both: **stopped at none (terminal effect observed), `complete:true`**, no escape. Raw spans show `hook-batch` and `hook-seq` nested under the outer client span. The external server logged both with a traceparent | **FAIL**: the nested-merge rule hides a real hop |
| h | Streamed response still being read when the page navigates away (development build, bodies on) | `bodies_pending:1`. Page reason "1 body read(s) still in flight at the last capture.summary …", `complete:false` | PASS |
| i | Save, then pagehide `sendBeacon` to the API and to external | `beacon: not_wrapped` listed. The API beacon (a 400 root span) turns Save into `server_hop` "a further server-side hop may have escaped". The external beacon is covered only by the transport entry | Honest, but over-withholds: a same-page beacon is labelled a possible server-side hop |

**Additional finding: the page-end window ends at the collector's run close.** `indexUnlinkedEvidence` ends the last episode's window at `entry.last_timestamp`, the maximum over all rows of the page. That includes the collector's `capture.received` row, written once per page at **run close** (`collector/coverage.mjs:10,135`). In my probe run every page's last action, in a, b, b2, c, d, d2, f, g, h and i, picked up root spans from later probe pages (`/api/health` from e, the beacon from i). It became `server_hop` / `complete:false` and listed those spans as "unlinked in this window". Two examples:
- a's last click: "3 server span(s) in this action's window".
- h's window contains i's beacon.

With a long-lived collector (the normal dev set-up), the last action of every page absorbs all root-span traffic until the collector stops. The error direction is withholding, but the counts and listings are false statements about "this window". The author's fixture hides this because its collector closes 1.5 s after the page.

## Backend register vs `fix/server-outbound` (report only)

This branch changes `relevant` to `span.kind === 'server' || express || handlers || db.system || (span.kind === 'client' && !isDelivery(span))`. It ships **every** client span except its own delivery request. The delivery request is matched by the destination URL's host+path, or failing that by `server.address`/`net.peer.name` + port equal to the endpoint. This includes manual client spans such as the `sdk batch` in probe g, and any client span from other instrumentations that lacks `db.system`.

`fix/server-outbound` (afb9f043) changes the same line differently:
- It ships client spans only from `@opentelemetry/instrumentation-http` / `-undici`.
- It suppresses tracing for its own delivery, so no `isDelivery` is needed.
- It fixes the ESM+CJS double patch that produced the two nested client spans per call. This branch's "nested client span = same call" rule exists to paper over that double patch, and it is the rule that hides the Seq hop.
- It models hops as `server.hop` chain steps. An escaped hop becomes an `additional_stops` entry `{reached:'outbound', stopped_at:'network', stop_reason:'outbound_<join>'}`.

Both branches also wrap `chainFrontier`. Merged as a union, one unfollowed outbound call would be stated twice:
- by this branch: `stopped_at:"server_hop"`, the escape clause, a `window_reasons` entry, and the outcome suffix;
- by `fix/server-outbound`: an `additional_stops` "outbound … not joined" entry and its `escaped_hops`.

After the double patch is fixed, the two branches would also disagree on Seq-shaped code: `fix/server-outbound` reports `hook-seq` escaped, while this branch's merge still folds it into the continued B call. Both edit `register.js` `relevant`, `chainFrontier`, the causal-chain imports, `mcp/tools.mjs` and the G4 amendments, so textual conflicts are certain as well.

No span is duplicated at the collector: each span is shipped once whichever filter wins. The double count is in the analysis, not in the rows.

## Test expectation changes

| test | change | judgement |
|---|---|---|
| mcp-gaps P2, P6, P8 | "none: no user action" → "not attributed to any user action", and "N none" → "N not attributed" | Forced by rule 5. Same strictness |
| unlinked-coverage-neutral A2 | exact new headline string | Forced by rule 4. Stricter |
| unlinked-coverage-neutral A7 | the click is `complete:false` with the exact reason, and the other click is still `true` | Forced by rule 2 (verified: the third-party request is `issuer:{function_ids:[]}`) |
| unlinked-coverage-neutral A8 | the constant `['worker','beacon']` → "events count equals `observes`; includes pointerdown; beacon listed; fetch/xhr/worker not listed; no realms" | Forced: main's constant was wrong, since `wrappers.worker` has been true since worker-frontier. The new check is partly self-referential (coverage compared with the page's own `observes`), not an independent measurement. Acceptable |
| unlinked-coverage-neutral B3 | reason length equality → page reasons as prefix plus `window_reasons` as suffix | Forced by rule 2. Same strength |
| no-false-negatives: rewritten "unlinked evidence never changes …" | `plain` and `listed` now both get **all** records, so `rest == plain` compares identical inputs and is close to tautological | **Loosened**, but the added `bare` assertion (chain and reached/stopped_at equal with every unattributed row and span removed) carries the invariant. It does not assert `because`, which rule 4 now changes by design. Acceptable |
| no-false-negatives: coverage | `unobserved: []` on the VM page (no `on*` props, absent APIs), and the first click `complete:false` | Forced by rules 1 and 2 |
| worker-frontier | one `worker_fetch` limit per worker (2) | Forced by rule 1 |

No change hides a regression I could find. The fixture's O1 and the new A8 cannot catch an incomplete event basis (1a).

## Banked stores vs `main` (my own sweep: `grader-scratch/bank-sweep.mjs`)

For every action of each store: `action_chain` on a `git archive` of f9a925d7 vs this branch, plus `buildActionChains` exports on both. Every new window reason was re-derived from raw rows over the episode window.

| store | actions | stopped_at | because / label / sentence / first line | export | complete | reasons changed | new reasons verified from rows |
|---|---|---|---|---|---|---|---|
| final7 (G4 manifest) | 54 | 0 | 0 | 0 | 0 | 5 | 5/5 (counts 4, 2, 2, 2, 2 unattributed requests, no issuer field) |
| G5 | 151 | 0 | 1 (`action:muen73wz:28`: `GET /api/setup-complete, issuer unknown`) | 1 (same action) | 0 | 2 | 2/2 (1 and 6) |
| G6 | 408 | 0 | 0 | 0 | 0 | 0 | n/a |

This matches the author's table exactly. On old runtimes "issuer unknown" means "issuer not recorded". `page_requests` says so ("issuer not recorded (runtime before 2026-09-24)"), but the headline says only "issuer unknown". That is true, but less informative.

## Suite (commands run in this worktree)

| command | result |
|---|---|
| `npm test` | 700 tests, 699 pass, 1 fail: `react-context-ref-semantics` (known) |
| `npm run build && cmp src/runtime-attribution-browser.js dist/runtime-attribution-browser.js` | identical; `git status` clean apart from the `node_modules` symlink |
| `node test/browser/honest-coverage.mjs --out …` ×3 | 36/36 ×3 |
| `node test/browser/d12-stamp-neutrality.mjs` | exit 0, pass true |
| `node test/browser/continuations-neutral.mjs` | exit 0, status ok |
| `node test/browser/outcome-labels.mjs` | 160/160 |
| `node test/browser/mcp-gaps.mjs` | 35/35 |
| `node test/browser/body-capture.mjs` | 51/51 |
| `node test/browser/unlinked-coverage-neutral.mjs` | 13/13 |
| `node test/browser/worker-frontier.mjs` | ok |
| `node test/browser/episode-focus.mjs` ×3 | exit 0, status ok ×3 |
| `node test/g4-grader.mjs docs/evidence/m1-2026-09-22-final7 --manifest docs/evidence/g4-mcp-2026-09-23/manifest.json` | 81 PASS / 0 FAIL |
| G6: gunzip the store **and its manifests**, then run `g6-compare.mjs` (6 pairs, regenerated) and `g6-grader.mjs --compare` | Overall PASS (6/6). With manifests left gzipped, both main and the branch give 4/6 (remap basis `content_hash`), so the procedure note should say to gunzip the manifests |

## Wording audit (every sentence the branch prints)

States more than the rows prove:
1. **Chain headline** `stopped at none (terminal effect observed)` on probe (g) Seq/Batch: false (rule 3).
2. **`no_request` headline** "N request(s) left this page during this action's window": the count covers recorded requests only. Beacons, frames, workers and WebSocket messages also leave the page. The clause also drops the scope caveat it replaces. It should read "N recorded request(s) …" and keep the caveat, or point to `unobserved`.
3. **Label** "No request: the handler ran and issued no request from instrumented code" on probe (d) Ping: the handler sent a WebSocket message that is in no row. The label is scoped to "request", but `websocket: "wrapped"` makes the omission invisible.
4. **`COVERAGE_SCOPE`** "within what it observes (`unobserved` lists the event kinds, transports and realms it does not)": this is false while `unobserved` misses non-`on*` event kinds, WebSocket sends, transient frames, and request paths outside the transport list (`<img>`, `<form>` navigations, `<link rel=prefetch>`, `window.open`, WebTransport, WebRTC).
5. **"Not observed on page …: 137 event kind(s) that start no action"** reads as exhaustive (same cause as 1a).
6. **SKILL.md** "`stopped at none (terminal effect observed)` is printed only when neither holds" is true of the rule as coded, but the rule's call merging makes it false in (g).

States less than the rows prove (over-withholding; acceptable in direction, listed here):
- Any root server span from any client in the window after the request reached the server gives `server_hop` "a further server-side hop may have escaped": curl (e), the page's own pagehide beacon (i), health checks, other tabs.
- **The page-end window extends to collector run close** (above). Every page's last action absorbs unrelated root spans, and they are listed as unlinked "in this window". This is the largest source of over-withholding and false listings in long sessions.
- Old runtimes: "issuer unknown" for rows that simply predate the `issuer` field.

Correct and hedged: the escape clause wording, the outbound clause (it names method and URL), `page_requests` text, realm and worker reasons, and the body-pending reason.

## Required changes (merge with changes)

1. **Rule 3, blocker.** `outboundSpans` must not merge distinct calls. Treat a nested client span as the same call only when it is the direct child with the same method and destination (`url.full`/`http.url`, or peer address and port). Otherwise it is its own call with its own `continued_by`. Better: after `fix/server-outbound` removes the double patch, drop the merge and consume that branch's per-hop identifier joins. Add probe (g) Seq (a call from the response callback of a continued call to an uninstrumented service) and Batch (two calls inside one SDK client span) to the fixture. Both must read `server_hop`.
2. **Rules 1 and 2: transient frames.** Record a realm at insertion time, for example with a MutationObserver on `iframe`/`frame`/`object`/`embed` added anywhere in the document, including portals. A frame that existed only between checks must leave a `capture.limit` and be listed in `unobserved`. Add probe (b2) (an other-origin iframe inserted after a click and removed before the next action) to the fixture.
3. **Rule 1: WebSocket.** Either record `send` (size class only, the same owner model as worker posts) or report `websocket` as something other than `wrapped` (for example `connect_only`) and list "websocket messages not recorded" in `unobserved`. An action whose window holds a socket send must not be `complete:true` unless the send is recorded.
4. **Rule 1: event basis.** Add the dispatched kinds that have no `on*` property. At least `focusout`, the `composition*` kinds and the touch kinds are relevant to React and user input. Alternatively, print the list as a lower bound ("at least N event kinds, by `on*` property") in the reason, the "Not observed" line and the scope. Make the transport statuses measured rather than tautological: check that `global.fetch`/`XMLHttpRequest.prototype.open`/`send`/`WebSocket`/`EventSource` are still the runtime's wrappers at `capture.summary`, and report `replaced` otherwise.
5. **Page-end window.** End the last episode's window at the page's last *runtime* row (a sequenced row, i.e. the pagehide `capture.summary`) plus a stated grace for pagehide beacons. Do not use the collector's run-close `capture.received`. Add a two-page fixture with a long-lived collector.
6. **Wording.** The `no_request` clause says "N recorded request(s) …" and keeps the scope caveat. `COVERAGE_SCOPE` and the "Not observed" line must not imply exhaustiveness until 2 to 4 land. SKILL.md is corrected to match. RUN.md's procedure note should say to gunzip the G6 manifests.
7. **Merge order with `fix/server-outbound`.** Land `fix/server-outbound` first, then rebase this branch. The rebase keeps a single `relevant` filter (that branch's instrumentation allowlist plus suppressed delivery, dropping `isDelivery`). It keeps a single statement per escaped outbound call (either `server_hop` or `additional_stops`, not both). This branch keeps only the root-span candidate rule and the coverage reasons. Rerun probes (f) and (g) on the merged tree.

Not blocking, reported: probe (d2) misattributes a WebSocket-pushed request to the action that created the socket (pre-existing `wrapOwnedCallback(active, listener)` on WS listeners). That is an attribution overclaim for a separate PR.

## Residual risks after the changes

- Order-only candidates over-withhold on busy backends, as the author disclosed.
- Requests that leave through navigation, `<img>`, `<form>` or `<link>` are outside every transport and every row. Only a root span, when one exists, hints at them.
- A library that takes a pristine `fetch` from a short-lived same-origin iframe (a known anti-instrumentation pattern) would be caught only by change 2.
- `observes` is measured once at install. A page that installs a service worker or replaces `fetch` later is detected only through change 4's re-check.

---

# Regrade at 5ba9a5f8 (rebased onto main 9ad0f210: #15 middleware-reads, #16 client-aborts, #17 server-outbound)

Same grader, same method. I recomputed every number from raw rows, ran the MCP over stdio as a black box, and wrote my own probes. Code at the head is identical to RUN-3's "code at 4160c9ee": `git diff 4160c9ee HEAD` outside `docs/` is empty.

Scratch (not committed), all in `grader-scratch/`:
- `probes.mjs` with probes j/k/l added
- `recompute2.mjs`: the recompute under the head's rules, plus export and `recent_actions` against `action_chain`
- `bank-sweep2.mjs`: the sweep against a `git archive` of 9ad0f210
- `wording-sweep.mjs`: every distinct sentence the head prints, normalized

## Verdict: **merge**

Items 1 to 6 of my required changes are met, and item 7 (merge order) is done. On 66 probe actions, 3 × 19 fixture actions and 613 banked actions:
- I found no frontier, label or coverage sentence that claims more than its rows prove.
- Every new window reason matches my count from raw rows.
- Export, `recent_actions` and `action_chain` agree on `stopped_at` and the label.

The remaining findings are pre-existing on main or are wording and documentation follow-ups (below). None blocks the merge.

## 1. One source for escaped hops (item 1, item 7)

- **Branch changes to `backend/register.js`:** none (`git diff 9ad0f210..HEAD -- backend` is empty).
- **The old merge code is gone:** `outboundSpans` and the "nested client span = same call" rule are removed.
- **Where escaped calls come from:** only main's `server.hop` rows (`hops`, `escaped_hops`, `hopFrontierOf`).
- **What this branch keeps:** the order-only root-span candidates (`window_roots`, `root_escape`). They exclude a span with:
  - a browser parent;
  - a recorded backend parent;
  - a hop-receiver role (`serverSpansWithoutBrowserParent`, shared with `page_requests` and the unlinked evidence).
- **Probe g, Batch and Seq:** instrumented B plus an uninstrumented external service; the external server logged both requests with a traceparent.
  - The call to B is followed: chain `hop 1: … → server probe-b /b/work 200 → handler bWork → db insert b_work`.
  - The external call is its own hop 2: `server_hop` "1 hop(s) not followed: 1 with no receiving span (POST …/hook-batch | …/hook-seq)", `complete: false`.
- **Stated once:** each escaped call appears exactly three times, all citing the same span id:
  - the frontier clause;
  - one `additional_stops` entry `{hop:"2", span_id, stop_reason:"outbound_no_incoming_span"}`;
  - one coverage reason, "1 server-side hop(s) not followed (hop 2: POST …, span <id>)".

  `recompute2` checks, for every action, that each unfollowed http/undici client span is cited in the reason and in `additional_stops`: 0 mismatches.
- **Probe f, Chain:** B is followed, `stopped at none (terminal effect observed)`, `complete: true`. That is not `server_hop`, correctly.
- **Probe f, Chain2:** B's own call to the external service is hop `1.1`: `server_hop`, and the reason cites span `2a6d05e3…`.

## 2. Items 2 to 6 (probes on the head; `grader-scratch/probes-out/probes-a_b_b2_c_d_d2_e_f_g_h_i_j_l_k.json`)

| probe | what was done | what the head says | verdict |
|---|---|---|---|
| b | Same-origin iframe inserted at +50 ms, removed at +450 ms | `capture.limit{realm, frame}`, `frames_seen:1`, `frames_now:0`. The click's window reasons: "1 child frame(s) appeared … (1 same-origin, 0 cross-origin)" and the frame's `/api/frame-ping` root span. `complete:false`. `unobserved` lists `realm:frame:1` | PASS |
| b2 | The same with an other-origin frame | The realm row and "(0 same-origin, 1 cross-origin)" window reason. `complete:false` | PASS (was FAIL) |
| d | `ws.send('go')`; the server pushes; the page fetches `/api/ws-triggered` | Ping: `stopped_at:"websocket"`, "sent 1 WebSocket message on ws://…/ws (2 bytes); a message carries no trace context …". The pushed request is named "(POST /api/ws-triggered, issued by instrumented code outside any action)". Window reason "1 WebSocket message(s) sent …", `complete:false` | PASS (was FAIL) |
| j | Save, then Wrap fetch (a later wrapper delegating to Tracer's), then Save, then Pristine fetch (`window.fetch` = a hidden same-origin frame's `fetch`), then Save | Every action on the page reads `complete:false` with "transport wrapper replaced after install: fetch (its requests may not be recorded)". "Not observed" has "transport fetch wrapper replaced". The last Save's request went through the pristine fetch and is in no row. Its server span is listed as unlinked in that Save's window, and a window reason says so | PASS. Over-withholds for the first Save (the page reason is page-wide). Wording follow-up below |
| k | Save, leave the page, then curl a root span at +1.0 s and at +3.0 s after the page's last runtime row | Last window `until_timestamp` = last runtime row + 2000 (`page_end_grace_ms:2000`). Only `/api/late/1` (span `a9772969…`) is in it. `/api/late/3` is not. The collector's `capture.received` no longer extends the window | PASS (was FAIL) |
| l | During a request-less click: one fetch whose signal was already aborted, and one aborted 200 ms after sending | Headline: "1 recorded request left this page during this action's window that Tracer could not attribute (POST /api/abortable, issuer unknown, aborted by the page)". `/api/never` is excluded from the count and the coverage reason, and still listed under `unlinked` | PASS |
| a | React `onBlur` autosave | `unobserved` events `count:145, lower_bound:true`; names include `focusout`, `composition*`, `touch*`. Text: "at least 145 event kind(s) that start no action". The "Not observed" line opens "(from its rows; not exhaustive: navigations and <img>/<form>/<link> loads are never recorded)" | PASS (was incomplete) |
| c, e, h, i | Inline-script requests; curl during a request; a body still being read; a pagehide beacon | Unchanged from the first grade, all consistent with the new wording | PASS |

**No-request headline:** "N recorded request(s) left this page …". It keeps the scope caveat and adds "transports and realms Tracer does not record are listed in coverage.unobserved". Rows from old runtimes read "issuer not recorded by this runtime".

**`page_requests`:** it never says "no user action". I checked 14 probe pages, 3 fixture runs and the banked stores with `recompute2` and `wording-sweep`.

**My recompute from raw rows (`recompute2.mjs`, head rules):** it compared these per action:
- the unknown-issuer count, excluding never-sent requests and deduplicated by page + occurrence;
- root spans in the window;
- frames and sends in the window;
- unfollowed http/undici hops;
- whether `server_hop` is expected;
- the no-request count;
- `recent_actions` equal to `action_chain`;
- export `stopped_at` and label equal to MCP.

Results: 0 mismatches on the probe store (66 actions) and on each of the 3 fixture runs (19 actions each).

## 3. `test/server-hops.test.mjs`

**Forced by the rule, not loosened.** The synthetic `/api/health` span is a root span with no parent. It starts at 1012 ms: after the request's server span started, and inside the action's page-end window. Under the order-only rule it is a continuation candidate, so the frontier must say so. The test still pins:
- the complete old sentence, now with "; also 1 server-side request …";
- `server_hop` without the escaped hops;
- the original `null` once the unrelated span is also removed.

That third assertion is main's invariant, kept. Main's `serverHops(ids.unrelated) = []` assertion is unchanged: the span is never joined.

## 4. Banked stores vs main 9ad0f210 (`bank-sweep2.mjs`, every action, `action_chain` and export)

| store | actions | stopped_at | because / label / first line | export | complete | reasons | new reasons checked against raw rows | last-window `until` +2000 ms | unlinked listing changed |
|---|---|---|---|---|---|---|---|---|---|
| final7 (G4 manifest) | 54 | 0 | 0 | 0 | 0 | 5 | 5/5 | 1 page | 0 |
| G5 | 151 | 0 | 1 (`action:muen73wz:28`, now "issuer not recorded by this runtime") | 1 (same action) | 0 | 2 | 2/2 | 1 page | 0 |
| G6 | 408 | 0 | 0 | 0 | 0 | 0 | n/a | **6 pages** | 0 |

This matches the author's 0/0/5, 0/1/2 and 0/0/0. RUN-3 says the page-end shift affects "2 on G6". A sweep of every action shows 6 G6 pages whose last window moved by +2000 ms: 6 single-focusin pages. RUN-3's diff appears to cover a sample (its `window_evidence` "added 100"). No listed span changes in any store, so this is a documentation miscount only. No banked chain reads `server_hop`.

## 5. Suite (run by me at the head)

| command | result |
|---|---|
| `npm run build && cmp src/… dist/…` | byte-identical (304724 bytes); `git status` clean |
| `npm test` | 723 tests, 722 pass, 1 fail: `react-context-ref-semantics` (known; same on main) |
| `honest-coverage.mjs` ×3 | 45/45 ×3; `recompute2` 0 mismatches ×3 |
| d12-stamp-neutrality · continuations-neutral · worker-frontier | exit 0: pass / ok / ok |
| episode-focus ×3 | exit 0, status ok ×3 |
| outcome-labels · mcp-gaps · body-capture · unlinked-coverage-neutral | 169/169 · 35/35 · 51/51 · 13/13 |
| middleware-reads · client-aborts | 343/343 · 245/245 |
| `server-outbound.mjs --runs 3 --control` | 170/170 |
| G4 grader (final7, G4 manifest) | 81 PASS / 0 FAIL |
| G6: store and manifests gunzipped, `g6-compare` (6 pairs, regenerated) + `g6-grader` | Overall PASS (6/6) |

## 6. Honesty sweep

`wording-sweep.mjs` read every distinct sentence the head prints, normalized, over the fixture run, the probe store, final7, G5 and G6. It covered:
- `because`, the label, the sentence and `additional_stops`;
- the coverage reasons and `window_reasons`;
- the "Not observed" and unlinked lines;
- `page_requests` for each session.

**Every frontier and coverage sentence is either proven by its rows or explicitly scoped or hedged.** Nothing prints "terminal effect observed" past an unfollowed hop, a root candidate or a socket send. `complete:true` never appears with a window reason.

Follow-ups, none blocking (the first three are pre-existing on main or only a matter of wording):
1. **`page_requests` with `{session}` still bounds its server-span window at the collector's run close.** `pageTimes` takes the maximum timestamp over the page's rows, including `capture.received`. In my probe run, page l's listing "Server spans with no browser request (2; not a join)" shows page k's `/api/late/:n` spans, which started after page l ended.

   The code is main's (`mcp/tools.mjs` line 1357 on 9ad0f210), and the listing says "not a join; not page-scoped". But it is the same mis-bounded window that change 5 fixed for `windowOf`. It should use the page's last runtime row + `PAGE_END_GRACE_MS`.
2. **When a transport wrapper was replaced, a request-less action still reads "No request: the handler ran and issued no request from instrumented code"** (probe j, last Save). The handler did send a request, through the replaced `fetch`. The action's coverage says "transport wrapper replaced … its requests may not be recorded" and lists the resulting server span as unlinked, so the reader is told. Still, the label should say "no recorded request" whenever the page reports `wrapper_replaced`.
3. **`page_requests` issuer text "no first-party frame recorded for this request (issued outside any action)"** (main's wording, also in SKILL.md). It means outside any Tracer action context at send time. "(issued outside any recorded action context)" would not read as a statement about cause.
4. **RUN-3's G6 page-end count:** "2 on G6" should be 6 pages (section 4).
5. **Probe d2 (pre-existing):** a `message` listener added with `addEventListener` inherits the socket creator's action. A request pushed by the server is attributed to Connect, not Ping. Ping itself now reads `stopped_at:"websocket"`, `complete:false`, so Ping no longer overclaims. The attribution to Connect is still an overclaim and needs a separate PR.

Residual risks (disclosed in RUN-3, confirmed):
- **Order-only root candidates over-withhold:** curl during a request (e), the page's own pagehide beacon (i), a late root span within the 2 s grace (k).
- **An outbound call no instrumentation sees, to a receiver no instrumentation sees,** leaves no row. "Terminal effect observed" is then printed on what Tracer did observe. No rule based on rows can do better.
- **The page-wide `wrapper_replaced` reason** also withholds `complete` for actions before the replacement.
