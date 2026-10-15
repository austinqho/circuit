# fix/mcp-surfaces: independent grade (2026-09-24)

Grader: independent, did not write the branch. Head graded: `5bd644d2` (rebased on `main` `d0b19cb8`). I did not use the author's RUN.md, test names or summaries as evidence. Every verdict below comes from raw rows (`records.jsonl`, `spans.jsonl`) and from the MCP server driven over stdio as a black box. My own scripts live in `grader-scratch/` (untracked): `audit.mjs`, `probe-app.jsx`, `probe-driver.mjs`, `probe2-app.jsx`, `probe2-driver.mjs`, `q.mjs`, `bankcmp.mjs`, `keys.mjs`, `mkpairs.mjs`. I did not read `fixtures/heldout`, `docs/internal`, `fieldbook` or `studio-desk`.

Claim: "Every MCP surface says what the rows already hold about a request, wherever the request came from."

**Verdict: merge with changes.** The seven required changes are listed at the end.

Where the claim holds:
- Every clause the branch adds is backed by a row: 0 unbacked clauses across about 2,000 checked, on the author's fixture, on my probes and on four banked stores.
- Invariants are unchanged on every banked store: stops, frontiers, outcomes, compare verdicts and lookups.
- The runtime change is neutral: D12 passes, the `cmp` is identical, and no `exact` verdict is downgraded.

What blocks a plain merge:
- One new wrong `best` in `resolve_element`.
- One wrong mismatch reason (opaque responses).
- Three places where the text says less than the rows hold and does not say so: nested differences, the continuation named is only the nearest one, and the field cap.
- One unbounded payload (`page_requests include_bodies`).
- One missing lookup disclosure (an enclosing row with no stamp).

## 1. Per-rule table

| rule | verdict | raw evidence |
|---|---|---|
| Bodies for every request through one summariser (`page_requests` summaries and `include_bodies`, `unlinked`, `recent_actions`) | PASS, with a size defect (R6) | Driver stores ×3 and probe store: every listed entry's `body` / `response_body` and `request_fields` / `response_fields` were recomputed from the `network.body` rows by `audit.mjs`, which has its own selector and its own prefix parser for truncated bodies. Result: 0 findings on 62 + 426 entries. `include_bodies` returns the stored body (≤ 4 KB, `truncated: true` when cut). **But** `page_requests {n:500, include_bodies:true}` over 200 POSTs returns **2,118,055 bytes** with no aggregate cap and no truncation statement. Without the option it returns 473,655 bytes (main: 352,915). |
| Issuer = the full first-party frame chain, innermost first, capped | PASS | Driver I1/I2 recomputed: `issued by getJson …:24 (called from loadProject …:28 ← queryFn …:58)` = `dedupe(issuer.function_ids).reverse()`. A unit check with 9 frames prints 6, then `+3 more`. `armed by` follows the same rule. `issuer_frames` equals the reversed deduped row ids on every unattributed `page_requests` entry (audit: 0 findings). Advisory: when there are more than 6 frames, the outermost frame (which main always printed) is now hidden behind `+N more`. |
| `deferred` from continuation ids, never null when the rows hold the continuation | PASS on data; FAIL on disclosure (R4) | My walk (request `parent_continuation_id` → `function.enter` rows → first non-function continuation) equals `deferred.continuation_id` / `via` / `ms_after_dispatch` on every attributed request in every store: driver (timer DELETE, 3.0 s), probe, final7 (**63 distinct requests, all `promise`, ms 0 to 1,043, every continuation id names the request's own action**), anything-llm bodies-on (21: 13 `mount_effect`, 2 `state_effect`, 6 `await`). There are no claims without a walk and no walks without a claim. **Disclosure:** probe `TimerPromise` (`setTimeout(500)` → `Promise.then` → fetch) reads `sent 501 ms after the click via a promise continuation`: the 500 ms were the timer's. Probe `Chain` (promise → timer(200) → setState → effect → fetch) reads `sent 203 ms after the click via an effect`. Neither the text nor `deferred.basis` says that only the nearest continuation is named. That limit appears only in RUN.md and in the G4 residuals. |
| Text states the discriminating body fields and the status-bearing response fields, found generically | PARTIAL (R3, R5) | Every printed `k: v` equals a top-level value of the raw body (audit: 0 findings; values that come from truncated bodies are checked against my own prefix parse). **Probe (a):** two POSTs to `/api/search` whose bodies differ only in `opts.sort` (nested) both read `[responded 200; no effect evidence; sent kind: filter]`. The JSON summaries are also identical (`opts: "{2 keys}"`). Nothing says the bodies differ. SKILL.md claims "so two posts to one URL read differently", which is false here. **Probe (h):** two agents' worth of fields (4 request fields of 61 characters, 4 status fields of 60 characters, 4 request ids, 2 response ids, a mismatch and a deferral) produce a **1,013-character** segment line. The fifth differing field (`epsilon`) and the fifth status field (`phase`) are dropped with no "+N more". The two lines differ only in the last character of each 61-character value. Fitted vocabulary: the status list includes `revision` / `rev` / `version`. These are counters, not statuses, and `revision` is exactly what driver T4 needs. It is low severity but should be justified or removed. |
| Status-like key with a long string or an object must not be dumped (probe b) | PASS (advisory) | Response `{status: "S"+300×"x", error: {code, message, stack(500)}, state: {phase}, code: 64×"c", message, errors: [e1,e2]}` reads `answered code: ccc…(64), message: short msg, errors: [e1, e2]`. Nothing was dumped. Advisory: the status-bearing `error` object and `status` string are left out silently. Printing their shape (`error: {3 keys}`, `status: <301 chars>`) would tell the agent they exist. |
| Browser-vs-server status mismatch printed with the generic reason | PARTIAL (R2) | Driver S2 and probe: server 304 with browser 200 gives `server answered 304; the browser reported 200 from its cache`. Probe (e), proxy: server span 500, browser 200 gives `[failed 500; browser reported 200, server answered 500; not the same response, or a proxy between them; answered ok: false]`. Probe, gateway: browser 502, server 200, stated the same way. Aborted requests give no mismatch. **Wrong reason:** `fetch(url, {redirect:'manual'})` to a 302 records a body row `{status: 0, captured: false, reason: "opaque_response"}`. The segment then reads `browser reported 0, server answered 302; not the same response, or a proxy between them`. It is the same response: the browser hides the status of an opaque(redirect) response. **Probe (d), bodies off:** there are no body rows, so there is no `browser_status`. The 304 line reads `[responded 304; no effect evidence]`, exactly as on main, and no segment note says the browser status was not recorded. This is consistent with "what the rows hold" (the rows hold nothing), but in production, where bodies are off by default, the original 304-vs-200 gap is still there. |
| Raw-evidence lookups rank by tag, implicit role, alt/title/aria-label hashes and ancestor labels; never `exact` | FAIL on one case (R1); disclosure gap (R7) | Every answer was `ambiguous` or `not_found`, never `exact`. An img with title and no alt: `{name:"Company mark"}` gives best = the img (`content_sig = name (title)`). A canvas with neither: `{name:"Sparkline"}` gives `not_found`, and `{selector:"canvas"}` gives 1 candidate with no best. Correct. **Wrong best (new on this branch; main answers `best: null`):** a list keyed by index (`key={index}`, `aria-label="Item ${name}"`, with handlers). After "Remove first", `li@0` now renders Beta. `{role:"button", name:"Open", nearby_text:"Item Alpha"}` returns **best = `…:4014-4122@0`**, matched via `ancestor …@0 label = nearby_text`, with the historical Alpha signature of a key that now names Beta. No candidate field or basis mentions the superseded signature or the index-like key. (`{role:"listitem", name:"Item Alpha"}` gives best `li@0` on main as well; that is pre-existing, but it is the same rule and should be fixed with it.) **Unstamped row (f):** `<li aria-label="Lane Two">` with no handler around a keyed `Move` button: `{role:"button", name:"Move", nearby_text:"Lane Two"}` gives 2 candidates and `best: null`. It honestly abstains, but nothing in the response says the `nearby_text` matched nothing because the enclosing row has no stamp. SKILL.md tells agents to "pass the row's or card's label as nearby_text" without that caveat. |
| JSON and text agree | PASS within a surface | `audit.mjs` checks every `request_fields` / `response_fields` / `status_mismatch` / `deferred` value against its line on every segment, unlinked entry and `page_requests` entry. 0 findings on the driver ×3, the probe, final7 (233 entries), allm (100) and allm2 (100). Across surfaces, the same poll reads `answered count: 29` in `page_requests` but has `response_fields: null` in an action's `unlinked` listing: peers are scope-relative, and the poll is alone in its window. That follows the rule, but nothing in the JSON says the fields are scope-relative (advisory). |
| No fixture-specific logic | PASS (advisory on `revision`) | The diff to `mcp/`, `analysis/`, `src/` and `collector/` contains no fixture tokens (grep for pulse, prefs, Apollo, toolbar, locked, workspace, wouter, tanstack…). The only hits are in comments. My probes use different names, shapes and libraries and behave by the same rules. |

## 2. Driver (3 runs) and recomputation

`node test/browser/mcp-surfaces.mjs --runs 3 --keep` gives **86/86**. Then `audit.mjs` ran on each kept store: 62 entries and 140 clauses per run, 0 findings, lines ≤ 420 characters.

Every rendered clause is backed by a row:
- `sent` / `answered`: the request/response body row's top-level value.
- `sent 3.0 s after the click via a timer`: the continuation walk plus `request.timestamp − dom.action.timestamp`.
- `server answered 304; …`: the response body row's `status: 200` against the server span's `http.response.status_code: 304`.
- `response ids`: the body row's id-shaped keys.

## 3. Probes (grader-written; `grader-scratch/probe-app.jsx`, `probe2-app.jsx`; plain React 18, synthetic backend spans)

| probe | result |
|---|---|
| a. same-URL bodies that differ only in a nested field | Identical text and identical JSON summaries, with no disclosure. **R3** |
| b. status-like key holding a long string or an object | Nothing dumped. The `error` object and the long `status` are left out silently (advisory). |
| c. promise → timer → effect; timer → promise; fetch → then | The nearest continuation is named (`effect`, `promise`, `promise`). The ms is the full delay from dispatch. "Nearest" is not disclosed in the text or in `basis`. **R4** |
| d. 304 with body capture off | No row, so no mismatch and no note. The line is identical to main's (residual). |
| e. 200 browser / 500 server (constructed proxy) and 502 browser / 200 server | Both stated with the generic reason. The outcome label follows the server (`failed 500`) next to the mismatch sentence. Correct. |
| e′. opaqueredirect (302, `redirect:'manual'`) | False reason: "not the same response, or a proxy". **R2** |
| f. img with title and no alt; canvas with neither; unstamped list row; index-keyed row after removal | Correct for the first three (the unstamped row has no disclosure: **R7**). The index-keyed row gives a **wrong `best`**. **R1** |
| g. `page_requests include_bodies` over 200 requests | 2.1 MB structured reply with no aggregate cap. The text lists 20 lines plus `(180 earlier listed in requests[])`. Per-body truncation is stated; overall truncation is not, because there is none. The pre-existing `action_chain include_bodies` on the same action is 2.18 MB. **R6** |
| h. four discriminating fields plus status fields plus ids | A 1,013-character line. The 5th field is dropped without "+N more". **R5** |

## 4. Runtime change (`alt` in `content_sig`)

- D12: `pass: true`, and `first_difference` is null for A/B, A/C and A/D (records and chains).
- `npm run build` prints "built byte-identical runtime". `cmp src/runtime-attribution-browser.js dist/runtime-attribution-browser.js` shows the files are identical.
- `resolve_element {element_key}` for every stamped key, main against the branch:
  - g5c: 119 keys, 109 `exact`.
  - allm: 191 keys, 182 `exact`.
  - 0 verdicts differ.
- final7 and G6 carry no stamp keys (their runtimes predate stamps). Their 7 bank probes are byte-equal in status, best and candidates.
- Mixed store: I appended a stamp row for the fixture img with the pre-change signature (`sig("img:")`) on a second page. The key still resolves `exact` on both trees, so the resolver does not treat an old-vs-new hash difference as a content change. The `exact` verdicts depend only on stored signatures. The MCP never recomputes them from `alt`.

## 5. Banked stores against main (`git archive d0b19cb8`)

Calls: the author's black-box `bank-run.mjs` (read before use). Pairs: my own (`mkpairs.mjs`: consecutive request-bearing clicks; f7 8, G6 29, allm 4, allm2 4), which cover more pairs than the author's. Comparison: my own `bankcmp.mjs`, which strips only the clauses this branch adds and requires the remainder to equal main's line.

| store | invariants (stops, reached, stopped_at, because, outcome status/label, chain, segment outcomes, compare status / `path_changed` / `outcome_delta.changed`, resolve answers, page_requests counts/attribution) | text |
|---|---|---|
| final7 with and without `--source-root` | unchanged, 108/108 calls | 24 calls and 40 lines changed. Once the deferral clause is stripped, every line equals main's. 63 distinct requests carry `via a promise continuation`, each backed by a walk. `compare_chains` gains `outcome_delta.before/after.deferred` (JSON only). Verdicts are unchanged. |
| G6 | unchanged, 156/156 | 0 text changes |
| anything-llm bodies-on (allm, allm2) | unchanged, 97/97 each | 21 calls and 47 lines. Clauses: 53 × 304/200 cache mismatch, 37 × `via an effect`, 9 × `via a promise continuation`, 11 × `sent`, 4 × `answered`, all backed by rows (audit: 0 findings). **Not itemised in RUN.md:** `page_requests` lines and `unlinked` lines also gain `response ids …` (e.g. `response ids workspace.id=1, workspace.router_id=null`), because `bodyTail` now runs there. It is backed by rows, but RUN.md should list it. |

## 6. Suite (branch head)

| check | result |
|---|---|
| `npm test` | 708 tests, 707 pass, 1 fail: `react-context-ref-semantics.test.mjs`, the known failure |
| G4 grader (final7, G4 manifest) | 81 PASS / 0 FAIL |
| G6: `g6-compare.mjs` regenerated (6 pairs), then `g6-grader.mjs` | Overall: PASS (6/6 pairs) |
| D12 | pass: true, no first difference |
| continuations-neutral | status ok |
| episode-focus `--runs 3` | status ok, exit 0 |
| outcome-labels | 169/169 |
| mcp-gaps | 35/35 |
| body-capture | 51/51 |
| middleware-reads `--runs 3` | 343/343 |
| client-aborts | 245/245 |
| mcp-surfaces `--runs 3` | 86/86 |
| dist | byte-identical (`cmp`) |

**M10 change (body-capture):** the change was forced, not a loosening. The new regex strips from the first `; (sent|request ids|answered|response ids) ` up to `] [outcome`. In `renderSegment` the body clauses are the last items in the tail, so on the compared single-request action only body clauses are removed. A deferral clause also starts with `; sent`. If one were present in both lines, it would make M10 fail, not pass falsely. Caveat: on a multi-request first line, the lazy match would span into later segments. Anchor it per segment (`(?=\])`) if M10 is ever pointed at a multi-request action.

`test/no-false-negatives.test.mjs`: this change was forced too. The chain record is compared with the MCP listing minus the six added keys, and those keys are asserted `null` on a store with no bodies.

## 7. Commands

```sh
cd /Users/austinho/dev/tracer-n2-mcp-surfaces
node test/browser/mcp-surfaces.mjs --runs 3 --keep                        # 86/86
node grader-scratch/audit.mjs --store <kept store> --manifest <fixture manifest> --source-root <src>   # ×3, 0 findings
node grader-scratch/probe-driver.mjs                                      # builds probe app bodies on/off, drives, keeps stores
node grader-scratch/audit.mjs --store grader-scratch/probe-out/store-on --manifest …   # 426 entries, 1,708 clauses, 0 findings
node grader-scratch/q.mjs <store> <manifest> resolve_element '<args>' [server]          # lookups, branch and main
node grader-scratch/probe2-driver.mjs                                     # opaqueredirect
git archive d0b19cb8 | tar -x -C grader-scratch/main
node docs/evidence/pr-mcp-surfaces-2026-09-24/bank-run.mjs <root> <out> <pairs> -- <store args>   # main+branch × f7src, f7nosrc, g6, allm, allm2
node grader-scratch/bankcmp.mjs main-X.jsonl branch-X.jsonl
node grader-scratch/audit.mjs --store … --records final7/records.jsonl.gz --spans final7/spans.jsonl --manifest g4 manifest   # 233 entries, 0 findings
node grader-scratch/keys.mjs <records> <root> <out> <server args>        # exact verdicts per key, main vs branch
npm test; node test/g4-grader.mjs …; node test/browser/g6-compare.mjs … (6 pairs); node test/g6-grader.mjs …
node test/browser/{d12-stamp-neutrality,continuations-neutral,outcome-labels,mcp-gaps,body-capture,client-aborts}.mjs
node test/browser/episode-focus.mjs --runs 3; node test/browser/middleware-reads.mjs --runs 3
npm run build && cmp src/runtime-attribution-browser.js dist/runtime-attribution-browser.js
```

Every build and store I created was deleted afterwards (temp dirs by exact name; no process was killed).

## 8. Residual risks (after the required changes)

- Only the nearest continuation is visible: the rows record no row for a non-function continuation. R4 asks only that this be disclosed.
- Body facts are scope-relative: the same request can show `count` in `page_requests` and nothing in an `unlinked` listing.
- With bodies off (the production default), 304-read-as-200 is still unexplained. There is no row, and the runtime could record `response.status` without the body; that would be a separate claim.
- In a single-page store, the ancestor rule needs both elements stamped. Rows without handlers never help a lookup.
- When there are more than 6 issuer frames, the outermost frame is hidden behind `+N more`.
- `revision` / `rev` / `version` in the status vocabulary look fitted to the fixture.

## 9. Required changes (merge with changes)

1. **R1: no `best` from a superseded signature.** Both the ancestor-label match and the own-label match must use the key's latest `content_sig` on the page. Alternatively: when the matched signature was superseded by a later stamp row of the same key (an index-like key), the candidate cannot be `best`, and `matched_on` / `basis` say "label seen earlier on this key; the key now shows other content". Add the index-keyed-row-after-removal case to the fixture driver.
2. **R2: opaque responses are not mismatches.** When the response body row is `reason: "opaque_response"` (status 0), set no `status_mismatch` and no "not the same response" sentence. State "the browser does not expose the status of an opaque response" instead.
3. **R3: say when bodies differ beyond what the text shows.** When a request's peers have bodies that differ only in non-short or nested fields, name those keys, e.g. `bodies differ from peers in: opts`, in both JSON and text. Fix the SKILL.md sentence "so two posts to one URL read differently" to match.
4. **R4: disclose that the continuation named is the nearest one.** Put it in `deferred.basis`, in a JSON flag, and in the text, e.g. `sent 501 ms after the click; nearest continuation: a promise`. Do not let the delay read as caused by the named continuation. Update SKILL.md.
5. **R5: bound the line.**
   - Cap each displayed field value in text (for example 24 to 32 characters, with an ellipsis; the JSON keeps the full value).
   - Print `+N more fields` when more than 4 qualify, for request and response alike, as the issuer frames already do.
   - Re-measure probe (h) (currently 1,013 characters).
6. **R6: bound `page_requests include_bodies`.** Add an aggregate byte or count budget for full bodies, with the overflow returned as summaries and stated in JSON and text (e.g. `bodies_full: 20 of 200; the rest summarised`). Apply the same to `recent_actions include_bodies`.
7. **R7: disclose unused `nearby_text`.** When `nearby_text` matched no candidate's own or enclosing label, `resolve_element` says so ("enclosing elements are known only when stamped, i.e. when they carry a handler"). Add the same caveat to SKILL.md step 3.

Non-blocking (should be done or recorded in RUN.md):
- Print the shape of status-like keys with non-short values (`error: {3 keys}`).
- List the new `response ids` clause on `page_requests` and `unlinked` lines in RUN.md.
- Justify or drop `revision` / `rev` / `version` as status words.
- Keep the outermost issuer frame visible after `+N more`.
- Anchor the M10 regex per segment.

## Regrade at 04eaaa99 (Codex) — 2026-09-24

Independent regrade of `fix/mcp-surfaces` on `04eaaa99`, against `main` `39449f7a`. I read the requested handoffs, §3.7, diff, neutral fixture and driver, then regenerated browser stores and called the MCP over stdio. I did not use the executor's RUN-2.md as proof. My probes and output are under `grader-scratch/codex/` (untracked). No dependency install was run. Temporary fixture builds were deleted after the run.

**Verdict: do not merge.** The original seven required changes pass their direct probes, but the advertised `next_until` recovery path cannot page a burst whose request timestamps tie, and hop text omits the required disclosure that hop bodies are not recorded. Exact changes required are below.

### Per-item findings

| Item | Regrade | Raw row and black-box evidence |
|---|---|---|
| R1, latest label | PASS | Fresh driver G1: the index-keyed `li@0` has first signature `0301f7b9bf86cbc3` (Item Alpha) and last `c90a723d557dee2f` (Item Beta). The Alpha lookup has no `best` and names the out-of-date key; Beta selects the current button. My synthetic replacement under `codex/adversarial.mjs` stamped a genuinely new `@fresh` row with the earlier Alpha signature. The MCP selected `button@fresh`, still disclosed the old `li@0` as out of date, and never selected that stale key. |
| R2, opaque status | PASS | The rerun manual 302 has a response `network.body` row with `status:0`, `captured:false`, `reason:"opaque_response"`; `page_requests` gives `browser_status:null`, no mismatch, and says the browser hid the status while the server answered 302 (`codex/manual-redirect.json`). A separate live cross-origin `mode:'no-cors'` fetch produced the same raw status-0/opaque row and no mismatch (`codex/no-cors.json`). |
| R3, body differences | PASS | Driver G3 names `opts.sort: asc (vs desc)` and discloses the long nested difference. My two same-URL POST bodies differed only at `items[1].weight` inside an array of objects; neither shown top-level field changed. Each MCP line states `request body differs from another request to this URL only in fields not shown` (`codex/adversarial.json`). This is the permitted disclosure, though the array position is not named. |
| R4, continuations | PASS | Driver G4 walks timer → promise. I extended that recorded action with a synthetic outer `state_effect` continuation and its creating frame. The request row still points through its function continuations to promise; the raw spine walk then reaches timer, effect and dispatch. MCP `deferred.continuations` lists `state_effect` at 1 ms, timer at 501 ms, promise at 502 ms, in that order; the line says `nearest continuation: a promise continuation; earlier: an effect at 1 ms, then a timer at 501 ms` (`codex/adversarial.json`). |
| R5, field cap | PASS | I replaced one raw response body with 40 numeric `slotNStatus` fields. The MCP line prints four values and `+36 more fields`; the raw 40 remain in the JSON body (`codex/adversarial.json`). Driver G5 and the older grader probe also pass. This bounds field clauses, not every multi-request line. |
| R6, full-body budget and paging | **FAIL** | A synthetic store derived from fresh driver rows has 320 distinct `/api/paginate` occurrences, each with a recorded 4 KB response, all at the same millisecond (`1790305299078`). `page_requests {n:500,include_bodies:true}` returns full bodies for occurrences 192–319 (128), cuts 192, and says `next_until:1790305299078`. Repeating with that `until` returns the **same** 128 full bodies and the same cursor. Three calls yield 128 unique full bodies, 256 duplicates, and 192 never recovered. The text's instruction to call again with `until` is false for these rows. The 512 KB full-body budget itself is obeyed; the whole structured reply was about 954 KB due to summaries and metadata. |
| R7, nearby text | PASS | The driver row `Lane Two` has no stamp; `{role:"button",name:"Move",nearby_text:"Lane Two"}` gives no best and explicitly says `nearby_text ignored: no stamped ancestor`. Conversely, the stamped Task Gamma row supplies its ancestor label: `{role:"button",name:"Open",nearby_text:"Task Gamma"}` selects `button@t3` with `matched_on` naming `li@t3`, and `ignored` is empty (`codex/stamped-nearby.json`). |
| #17 hop body disclosure | **FAIL** | The fresh server-outbound run has zero `network.body` rows and its MCP output has 19 hop objects across eight request segments. No hop object invents a body. Zero of the 19 hop summaries and zero of the eight segment summaries say that bodies are not recorded for hops (`codex/hop/run-1/{records.jsonl,mcp.json}`). For example, the `fetch_self` line renders `outbound POST /internal/notify … → server /internal/notify 201` with no body-coverage statement. This violates the regrade's explicit hop-text requirement. |

### Raw-row audits and banked replay

The earlier grader's two browser probes reran without page errors; its revised `audit.mjs` produced **0 findings** with **1,726 clauses / 426 request lines** on the bodies-on probe, **1,498 / 563**, **1,494 / 562**, and **1,494 / 562** on the three fresh driver stores, **126 / 233** on final7, **173 / 100** on each bodies-on AnythingLLM store, and **0 / 718** on G6. The nonzero counts on the body-bearing stores show the parser still recognizes clauses; G6 has no recorded body/deferral/ID clauses to recognize. My separate `codex/semantic-audit.mjs` recomputed request method/path, action ownership, status pairs, opaque wording, nearest continuation IDs and times, and issuer frame order from raw rows: **0 problems over 534 driver entries and 233 final7 entries** (719 and 186 new-text markers respectively). The earlier audit covers the field values, nested peers, IDs, and unlinked request lines as well. I found no invented body value or status in these surfaces; the false paging instruction and missing hop disclosure remain.

I reran the banked MCP calls against archived `39449f7a` and this head: 108 calls on final7 with source, 108 without source, 156 on G6, and 97 on each bodies-on store. Main-versus-branch invariant projections found **0 differences** in stops, frontiers, outcomes, compare verdicts, lookup best/scores, counts or attribution. Exact text comparison found **41 changed lines** on each final7 replay (95 deferral renderings and one nearby-text disclosure), **one** on G6 (nearby text), and **47** on each bodies-on store (11 request-field, 53 cache-status, 46 deferral, 15 response-ID, five response-field and one unshown-response-difference insertions); **zero unexplained line changes**. These category counts count repeated renderings, not unique requests. `codex/bank-*.txt` and the replay JSONL files hold the comparison.

### Suite on this head

| Check | Result |
|---|---|
| Neutral MCP driver, three fresh runs | **116/116**, stable |
| `npm test` | 732 total, 731 pass; sole failure `react-context-ref-semantics` Provider value (`'a' !== 'b'`), the pre-existing failure reported in the handoff |
| G4; G6 with copied store, all `*.gz` including manifests gunzipped and comparisons regenerated | **81/81; 6/6** |
| D12; continuations-neutral twice; episode-focus ×3 | pass; `ok` both times; `ok`, stable |
| outcome-labels; mcp-gaps; body-capture | **169/169; 35/35; 51/51** |
| middleware-reads ×3; client-aborts; server-outbound | **343/343; 245/245; 154/154** |
| honest-coverage; function-names | **45/45; 263/263** |
| `npm run build`; `cmp src/runtime-attribution-browser.js dist/runtime-attribution-browser.js` | pass; byte-identical |

### Required changes before merge

1. Replace `next_until` alone with a stable, exclusive paging cursor that distinguishes equal timestamps (for example timestamp, page and sequence in the exact sort order). Prove on over 300 same-millisecond body-bearing requests that all full bodies are returned exactly once across pages, with no repeated cursor. Update the budget notice and tool schema to name the working recovery input.
2. In every rendered hop summary or its enclosing request segment, state that request/response bodies are not recorded for server-to-server hops. Keep hop body fields absent while no such rows exist; do not infer bodies from browser requests or server spans.

Residuals after those fixes: body capture off still cannot state browser 200 versus server 304 because no browser-status row exists; `action_chain include_bodies` is unbounded; a field cap does not bound an action with many request segments. The existing React context/ref test failure remains outside this branch's changed files.

---

## Regrade at 5993c39b (Claude) — 2026-09-24

Regrade of `fix/mcp-surfaces` at `5993c39b` (Codex's RUN-2 and RUN-3 rounds) against `main` `39449f7a`. My scripts and outputs are in `grader-scratch/claude-r2/` (untracked).

Method:
- I did **not** use `grader-scratch/audit.mjs` as primary evidence. Codex edited it after my first grade, so it is no longer an independent grader tool. I ran it only as a supplement: 0 findings on the three fresh driver stores (563/1,498, 564/1,496 and 562/1,494 entries/clauses) and on my fresh probe store (430/1,730).
- The primary checks are new scripts written for this round, all driving the MCP over stdio as a black box:
  - `contwalk.mjs`: an independent continuation walk from `function.enter` rows and spines.
  - `pager.mjs` + `synth.mjs` + `expect.mjs`: exactly-once paging against raw body rows.
  - `hops.mjs`: counts of the hop body-coverage sentence.
  - `bankcmp2.mjs`: main-vs-branch replay, removing only the clauses this branch adds.
- `grader-scratch/main` was verified byte-equal to `git show 39449f7a` for every file under `mcp/`, `analysis/`, `collector/` and the runtime.

**Verdict: merge with changes.** The seven original items are fixed. The two items from the Codex regrade (paging on equal timestamps, hop body disclosure) are fixed. Invariants on the banked stores hold. There are two small required changes, both on the body-paging contract.

### (1) The seven original items: fresh probe store

The probe store was rebuilt from `claude-r2/probe-app.jsx`, which is my probe app plus a manual-redirect button and a cross-origin `no-cors` button.

| item | verdict | raw rows / MCP evidence |
|---|---|---|
| R1 out-of-date label never gives `best` | PASS | Index-keyed rows after "Remove first": `li@0` stamp rows go Alpha → Beta. `{role:button, name:Open, nearby_text:"Item Alpha"}` gives `best: null`, `mismatched` names the ancestor `@0` label as out of date, and the text says so. `{…,"Item Beta"}` gives best = `button@0` (current). `{role:listitem, name:"Item Alpha"}` (the case that was wrong on main too) now gives no best and an out-of-date disclosure. `{…,"Item Gamma"}` abstains between `@1` (current) and `@2`. |
| R2 opaque 302 and no-cors | PASS | The manual redirect's body row is `status:0, reason:opaque_response`. The line reads `… route /api/redir 302 … the browser hid the status (opaque response); server answered 302`, with no `status_mismatch`. The cross-origin no-cors GET: `no server span (no_exact_parent_server) [stopped at network; the browser hid the status (opaque response)]`. The genuine mismatches still print: proxy 200/500, gateway 502/200, and cache 304/200. |
| R3 nested differences named | PASS | The two `/api/search` POSTs read `sent kind: filter; sent opts.sort: asc (vs desc); answered meta.sorted: asc (vs desc)` and `… desc (vs asc)`. Values match the raw nested bodies. |
| R4 nearest continuation, kinds in order | PASS | Timer→promise: `sent 502 ms after the click (nearest continuation: a promise continuation; earlier: a timer at 502 ms)`. Promise→timer→setState→effect: `(nearest continuation: an effect; earlier: a promise continuation at 0 ms, then a timer at 201 ms)`. A single timer back to dispatch keeps `via a timer`. `contwalk.mjs` recomputed every listed continuation id and `reached_dispatch` independently: 0 differences on the probe store (215 requests), the driver store (165), final7 (68; 63 deferred, 33 short and 30 nearest/earlier), and both bodies-on anything-llm stores (27 each). |
| R5 value and field caps with "+N more" | PASS | Values are cut to 32 characters with `…`. `+1 more field` appears on both sides. Long status-like values show their shape: `status: <301 chars>, error: {3 keys}, state: {1 keys}`. The longest probe segment is 820 characters (was 1,013) and the longest line anywhere is 999, a `page_requests` line with its attribution text. |
| R6 body budget | PASS, with the two contract gaps below | See (2). |
| R7 `nearby_text` ignored notice | PASS | `Lane Two` (row with no stamp) and `Row Two` (static li with no handler): `best: null`, `ignored:[{input:"nearby_text", reason:"… known only when it is stamped, i.e. when it carries a handler"}]`, and the same sentence in text. When the row is stamped (`Item Beta`), `ignored` is empty. |

### (2) Paging: every page followed until `next_cursor` ran out

Exactly-once is measured against raw `network.body` rows that have content.

| scenario | pages (full / cut) | unique / dup / missing | notice every cut page |
|---|---|---|---|
| 320 responses at one millisecond (`page_requests`) | 131/189, 131/58, 58/0 | 320 / 0 / 0 | yes; the two cursors differ and advance |
| 300 bodies over three timestamps; the first cursor lands **mid-timestamp** (`three:1:69`) | 131/169, 131/38, 38/0 | 300 / 0 / 0 | yes |
| 320 tied, `n:100` (the listing cuts, not the budget) | 100, 100, 100, 20 | 320 / 0 / 0 | yes ("more requests precede this listing") |
| a 300 KB body in the middle (`lastover`) | 60/128, 57/71, 71/0 | 188 / 0 / 0 | yes |
| real 200-request click, `action_chain include_bodies` (probe Flood; 4 KB request + 4 KB response each) | 64/136, 64/72, 64/8, 8/0 (exactly 524,288 bytes per full page) | 200 / 0 / 0 | yes |
| `recent_actions include_bodies` n=40 over 30 actions × 10 unlinked bodies | 131/169, 131/38, 38/0 | 300 / 0 / 0 | yes |
| **`recent_actions` n=5 and n=20** (fewer actions than hold bodies) | n=5: 50/0. n=20: 131/69, 69/0 | 50 and 200 of 300; 250 and 100 never reachable | **no**: nothing says older actions hold bodies outside the `n` window. **G1** |
| **newest remaining body alone over the budget** (a synthetic 600 KB body after 5 small ones) | 5/21, then **0/21 with no `next_cursor`** | 5 / 0 / **21 missing** | **no**: page 2 prints `Full bodies: 0 request(s), 0 KB of the 512 KB budget` with `cut: 21` and no cursor or note. The first page's "call again" leads to a dead end. **G2** |

G2 cannot come from the current runtime, where `BODY_CAP` is 4096, so a request carries at most about 8 KB. It is still a silent loss of 21 bodies that `bodies_full.cut` counts but the text does not mention.

Every structured reply over the budget is still about 1.2 MB, because summaries and metadata are outside the 512 KB body budget. RUN-3 discloses this.

### (3) Hops (fresh `server-outbound --runs 3 --control`, run-1 store; `hops.mjs`)

- 9 segments, 8 with hops, 19 hops, 3 escaped. Every hop-bearing segment carries `bodies: "not recorded for server-to-server hops"`, and its summary contains the sentence **exactly once** (8/8). The sentence appears in **0** hop summaries, and segments without hops have 0.
- `page_requests`: 8 hop entries, each with the sentence once; the text holds 8 occurrences in total.
- 0 hop or escaped-hop objects carry `body`, `response_body`, fields or `browser_status`. The store has 0 `network.body` rows (`bodies: production_off`), and no body is invented.
- Unlinked replay: I cleared only one hop request's `action_id` in a copy. Its `page_requests attribution:"none"` line ends `…; bodies: not recorded for server-to-server hops [completed 200; browser-side status not recorded (body capture off); …]`, with count 1 and `bodies` set.
- Bodies off (my probe, `capture.page.bodies: off`): the config 200 and 304 and the proxied 500 each read `browser-side status not recorded (body capture off); cannot check the browser/server status view`, with `browser_status_not_recorded: true`. No status is inferred.

### (4) Suite at 5993c39b

| check | result |
|---|---|
| mcp-surfaces driver `--runs 3` | **122/122** |
| server-outbound `--runs 3 --control` | **186/186** |
| `npm test` | 732 tests, 731 pass; sole failure `react-context-ref-semantics` (known) |
| G4 | 81/81 |
| G6 (regenerated compare, 6 pairs) | PASS 6/6 |
| D12 | pass, all first differences null |
| continuations-neutral / episode-focus ×3 | ok / ok |
| outcome-labels / mcp-gaps / body-capture | 169/169 / 35/35 / 51/51 |
| client-aborts / honest-coverage / function-names | 245/245 / 45/45 / 263/263 |
| middleware-reads ×3 | first run 3 FAIL (unexpected 401s and missing auth reads), then crashed in its own reporter. A Codex `server-outbound` run was using the shared Mongo at the same time (PIDs 22900/23117/23118). Rerun alone: **343/343** |
| `npm run build`; `cmp` src/dist | byte-identical |

Test edits against main:
- M10 is now anchored per segment (the earlier advisory is done).
- mcp-gaps and no-false-negatives now assert the new sentence and fields. They are stricter than before, not looser.

### Banked replay against 39449f7a (own `bankcmp2.mjs`; original scratchpad stores, not Codex's copies)

| store | calls | invariants (stops, frontiers, outcomes, segment outcomes, compare status / `path_changed` / reasons / `changed`, resolve status/best/scores, page counts/attribution) | changed lines | added clauses |
|---|---|---|---|---|
| final7 with source root | 108 | 0 diffs, 0 transport errors | 41 | 54 nearest-continuation, 41 `via`, 1 ignored `nearby_text` |
| final7 without source root | 108 | 0 | 41 | same |
| G6 | 156 | 0 | 1 | 1 ignored `nearby_text` |
| anything-llm bodies-on ×2 | 97 each | 0 | 47 each | 53 cache-304, 11 `sent`, 5 `answered`, 36 nearest, 10 `via`, 15 new `response ids`, 1 unshown-difference |

Removing only these clauses reconstructs main's line every time. My regex left 3 residuals per bodies-on store, all caused by the value `[]` in `answered workspaces: []` / `threads: []`; I checked each line by eye and they are clean. The counts match RUN-3 (41/41/1/47/47). The continuation claims are backed by `contwalk.mjs` (above).

### Required changes (small; both on the body-paging contract)

1. **G2: the paging must always make progress, and any cut must be stated.** When the newest remaining body alone exceeds the budget, either return it anyway (stated as over budget) or skip it with a cursor past it and a sentence that says so. In every surface, whenever `bodies_full.cut > 0`, the text must say how many bodies were cut and how to reach them, or that they cannot be reached. Today, `cut: 21` with no `next_cursor` prints only `Full bodies: 0 request(s)`.
2. **G1: `recent_actions include_bodies` must say its scope.** When actions older than the `n` window exist, add one sentence saying that bodies of requests in older action windows are not included, and pointing to `page_requests {attribution:"none", include_bodies:true}`, which I verified reaches all 320/300 tied or 3-timestamp bodies exactly once.

### Residual risks (not blocking)

- **An unmounted element keeps its last label.** No stamp row records unmounting, so after a removal the removed key `@2` still counts as currently labelled "Gamma". Here that produced an abstention between `@1` and `@2`. If the last row of a list is removed, its old key could be singled out as `best`; the basis still says "confirm with the live data-tracer-el".
- **Structured replies stay large.** A multi-page body reply is still about 1.2 MB of summaries and metadata. The line length is bounded per value, not per action.
- **`audit.mjs` is no longer independent.** It now encodes Codex's text formats, so a later grade should not treat it as independent.

---

## Confirmation at da8c3368 (Claude) — 2026-09-24

Confirmation pass on the one Codex commit (`da8c3368`) that answers the two required changes from my regrade at `8177d644`. I read the `mcp/tools.mjs` diff and RUN-4.md. The probes below are my own (`grader-scratch/claude-r2/{synth,pager,expect}.mjs`, rebuilt from scratch), driving the MCP over stdio as a black box. Exactly-once is measured against raw `network.body` rows that have content.

**Verdict: merge.**

### The two required changes

| item | verdict | evidence |
|---|---|---|
| G2: an oversized next body cannot stall paging | PASS | Synthetic store: 20 small bodies, then a 600 KB body, then 5 newer ones. `page_requests` pages: 5 full with 21 cut and a cursor; then **1 (`ov:big`), 20 cut, and a cursor past it**; then 20 full. Result: **26 unique, 0 duplicates, 0 missing**. The `ov:big` entry and its body are marked `truncated_to_budget: true` with `full_size_bytes: 599983`. The returned text prefix is exactly 524,288 bytes. `bodies_full.truncated_to_budget` names the request, and the text says `request ov:big had 599983 full-body bytes; its body was truncated to the 512 KB budget and the omitted bytes cannot be recovered; bodies of 20 older request(s) are summaries …; call again with …`. Every cut page carries a notice. When a cut cannot be reached, the text now says so (`cannot be reached with a body cursor`) instead of staying silent. The other body shapes, rerun and still exactly-once: tied 320 (131/131/58), three timestamps with the cursor mid-timestamp (131/131/58 → 300), 300 KB body mid-sequence (60/57/71 → 188). |
| G1: `recent_actions include_bodies` states its scope | PASS | 30 actions × 10 unlinked bodies. n=5: 50 bodies returned exactly once, `outside_selected_windows: 250`. n=20: 200 over 2 pages, `outside_selected_windows: 100`. n=40: 300 over 3 pages, 0 outside. Each count equals the raw bodies the pages did not return. The text on every reply: `Bodies outside the selected N action(s)' windows are not included (K recorded beyond them); use page_requests {attribution: "none", include_bodies: true} for everything.` The path it points to (`page_requests {attribution:"none", n:500, include_bodies:true}`) returns **300/300** exactly once over 3 pages. |

### Suite at da8c3368

| check | result |
|---|---|
| mcp-surfaces driver `--runs 3` | **128/128** |
| `node --test test/mcp.test.mjs` | 34/34 |
| `npm test` | 733 tests, 732 pass; sole failure `react-context-ref-semantics` (known) |
| G4 | 81/81 |
| G6 (compare regenerated from the gunzipped store, 6 pairs) | PASS 6/6 |
| D12 | pass, all first differences null |
| mcp-gaps / body-capture | 35/35 / 51/51 |
| server-outbound `--runs 3 --control` | 186/186 |
| `npm run build`; `cmp` src/dist | byte-identical |

### Banked replay

I reran all five replays at this head, **including final7 with `--source-root`**, which RUN-4 skipped. Each output JSONL is **byte-identical** to RUN-3's branch output (`grader-scratch/current/bank/branch-{f7src,f7nosrc,g6,allm,allm2}.jsonl`). Against main `39449f7a` (`bankcmp2.mjs`):
- Changed lines: 41 / 41 / 1 / 47 / 47, with the same clause categories and counts as at 5993c39b.
- Invariants: 0 differences.
- Unexplained residuals: 0. The 3 per bodies-on store are my regex tripping on the literal value `[]`, as before.

### Residual risks (unchanged, not blocking)

- **An unmounted element keeps its last label.** No stamp row records an element leaving the page, so a removed key keeps its final label.
- **Structured replies stay large.** Summaries and metadata sit outside the 512 KB body budget, so a paged reply is still about 1.2 MB.
- **A truncated oversized body loses its tail.** The loss is stated. It cannot occur with the current runtime's 4 KB-per-body cap.
- **`grader-scratch/audit.mjs` is no longer independent.** Codex edited it, so later grades should not treat it as an independent grader tool.
