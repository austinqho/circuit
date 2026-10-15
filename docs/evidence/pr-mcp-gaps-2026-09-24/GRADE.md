# GRADE: fix/mcp-gaps (independent grader, 2026-09-24)

Branch `fix/mcp-gaps` at `916b20ad` (8 commits on tag `fixes-2026-09-24` = `8a84cfee`). `main` is now `9a8496fb` (PRs #8 and #9, packaging only). `git merge-tree` shows the branch merges into it cleanly.

The claim under test: "The MCP says everything the records already know about an action's work and its surroundings."

Method:
- I did not use the author's RUN.md, test names or checks as evidence.
- Every number below is recomputed from raw `records.jsonl` / `spans.jsonl` rows.
- The MCP was driven over stdio as a black box, with the SDK client or with raw JSON-RPC for the oversized reply.
- My probes are in `grader-scratch/` in the worktree (untracked, not committed):
  - `probe/main.jsx` and `probe/inline.html`: a neutral fixture;
  - `probe/drive.mjs`: builds it, drives it headless, and writes spans from a tiny backend, with an optional server-clock skew;
  - `probe/ask.mjs` and `probe/bank.mjs`: stdio clients;
  - `probe/diff.mjs`: diffs `main` against the branch;
  - `probe/rawsize.mjs`: measures one reply's size without the SDK's buffer limit.
- Probe store (no skew): `grader-probe-store-txNPfN`, page `s_e71df3d5`. The author's fixture store is `tracer-mcp-gaps-store-kBQiYT`. Both are under `$TMPDIR` and kept.

## Verdict: **merge with changes** (4 required, listed at the end)

None of the defects moves an attribution, a join or a credit. Every banked-store field the author said was unchanged is unchanged. The defects are:
- one silent miscount (recursion);
- two sentences that state more than the rows show (`issuer` "uninstrumented code", and the `after response` mark read as a response handler);
- one self-referential issuer label;
- a wrong residual-risk statement in RUN.md.

## Per-gap table

| # | Gap | Verdict | Raw evidence |
|---|---|---|---|
| 1 | **Owned work: listing and cap** | PASS | The author's fixture: `hitTest` rows seq 27/28, 31/32, 35/36, 39/40 and 43/44 come in pairs. Each pair is the call-site proxy (spine `[…,hitTest]`, `function:30`) and the body (spine `[…,hitTest,hitTest]`). That is 5 calls, and the MCP prints `hitTest …:14 ×5`. Probe `Many` (action `mufthbhw:2`, 30 enter rows seq 12–67 = onMany + s01…s14, each entered twice): 12 frames are printed, then `+3 more frame path(s)`, with `frames_total` 15. Probe `Deep` (seq 79–92): printed to `d4` (depth 3), then `+3 more frame path(s) (3 deeper than depth 4)` (d5, d6, d7). |
| 1 | **Owned work: one function called from two callers** | PASS | Probe `Recurse`: `fmt` under `callerA` is rows 138/139 and 142/143, which is 2 calls, printed `×2`. `fmt` under `callerB` is rows 150/151, 1 call. The listing groups by call path, as documented. |
| 1 | **Owned work: recursion** | **FAIL (silent miscount)** | `fact(5)` = 5 calls = 10 enter rows (seq 116–125). The spine grows `[…,fact]` → `[…,fact×10]`, all entered on `function` continuations, and each row's parent continuation is the previous row's continuation. `mcp/tools.mjs:378` (`sameCall`) marks every row after the first as "the same call", and `dedupeHops` (:379) merges them into one path. So `work.entries` has `fact` with `calls: 1`, printed as a bare `fact client/src/main.jsx:17` (no ×). The rows carry no field that separates a proxy enter from a body enter (`continuation_kind`, `invoked_by`, `entry_hint` and `function_index` are identical), so an exact count needs either a runtime marker or an honest "recursive" rendering. RUN residual 4 discloses this. The listing does not, and reads as one call. |
| 1 | **Owned work: request segments hang off the issuing frame** | PASS | Probe `Two` (action `mufthcpu:8`): request seq 169 has spine `[onTwo,onTwo,sendA,sendA]` and is printed under `sendA`. Request seq 176 has spine `[onTwo,onTwo,helper,helper,sendB,sendB]` and is printed under `helper → sendB`. The fixture's 409 is printed under `onLike`. |
| 1 | **Owned work: `after response 409` marks** | **PARTIAL (ids attach the lineage; the "response" is a cross-clock timestamp comparison)** | Code: `mcp/tools.mjs:430` compares `request.response_end_ms` (the server span `end_time`, server clock) with `node.first_timestamp` (browser clock). The only identifier test is "the frame's spine without itself is a prefix of the request's spine", plus a `promise`/`await` continuation kind. Nothing ties the continuation to that request's promise. Fixture: the like POST (seq 8) server span ended at 1790271426140.1; the `.catch` arrow enter is seq 16 at …426172 (+31.9 ms), so the 409 mark is right there. Probe `Sibling` (action `mufthf0o:18`): `fetch('/api/fast')` (seq 247, server delay 120 ms), then `wait(250).then(unrelated)` and `Promise.resolve().then(early)`. **Without skew**, `unrelated` (seq 260, a continuation of the timer promise, not of the fetch) prints `after response 200: unrelated`. **With the server clock 500 ms behind** (`SKEW_MS=-500`, `out-skewneg`), `early` ran in the same millisecond as the send, about 120 ms before the server answered, and prints `after response 200: early`: a false order. **With the server clock 500 ms ahead** (`out-skewpos`), the true after-response frame loses the mark (`after request (1)`). When it mislabels: a false "after response" whenever server clock − browser clock ≤ (enter − true server end) < 0. A lost mark whenever the skew is larger than a positive gap. At any skew, "after response N" is shown for any promise/await continuation of a lineage-prefix frame recorded later, whether or not it was chained on that response. The `basis` string says "timestamps only order", but the rendered line `after response 409: <fn>`, nested under the requesting frame, reads as the response handler. |
| 1 | **Owned work: validation** | PASS | Fixture W7/W8 recomputed: the empty submit's enter rows include `validateForm` and `showErrors`, and it has no request row. |
| 2 | **Unlinked spans rendered with route / handler / DB, never joined** | PASS | Probe `Toggle` (action `mufthemc:16`): the inline script's `GET /api/inline?x=1&y=two#hidden` is row seq 238, `action_id: null`, issuer `{function_ids: [], task: {setInterval, armed_sequence 1}}`. It is listed as `→ route /api/inline 200 → server inlineHandler → db insert inline [unlinked] …; attribution: none`. The route, handler and DB equal the raw server span with parent = that row's span id and its descendants. The action stays `stopped at browser`. On final7 and G6, `unlinked`, `stops` and `chain` are byte-equal to `main` on 54/54 and 100/100 actions. The join goes through `joinRequestServer` (`analysis/causal-chain.mjs:220`), which calls `attachBackendSpans` on a copy under the placeholder `unlinked:<id>`, and that result is never written back. |
| 3 | **`page_requests`** | PASS, with two wording defects | Page-load poll → first-party fn: rows seq 2/5/7 carry issuer `[t1,t1,refresh,refresh,loadData,loadData]` and task setInterval@1 armed by the effect. The MCP prints `issued by loadData …:26 (called from t1 (via setInterval) …:39) from a setInterval timer armed at page load`. That is correct. A poll armed inside a handler (`StartPoll`) sends rows seq 194/199/206 with `action_id = mufthd46:10`, and page_requests prints `3 attributed to a user action, 0 with no action`. That is correct: it is not "none". Same URL from an action and a poll: 20 `/api/same?q=1` rows, and only seq 227 has an action. The MCP prints `1 action, 19 none`, and the action's chain holds only seq 227. Totals recomputed: final7 165/68/97 and G6 425/293/132, both equal the raw rows. **Defect A:** `asyncLoad` (first-party, instrumented; `await Promise.resolve(); fetch(...)` inside a page-load `setInterval`) sends rows seq 4, 9, … with issuer `{function_ids: [], task: null}`. The await rewrite's `awaitSuspend` uses `captureOwner()`, which is null outside an action, and resumes through the native `then`. So both the frames and the task origin are lost. The MCP then says `issued by uninstrumented code (no first-party frame on the stack)` (`mcp/tools.mjs:1022`), which is false: the code is instrumented. **Defect B:** poll rows seq 3/6/8 carry `[t3,t3]` (proxy + body), and the MCP prints `issued by t3 … (called from t3 …)`. Frames are not de-duplicated the way lineage is. |
| 4 | **Query string kept, fragment dropped** | PASS | Row seq 216 is `/api/frag?a=1` (sent `?a=1#frag`). Seq 217 is `/api/frag2` (sent `#onlyfrag`). Seq 238 is `/api/inline?x=1&y=two` (sent `…#hidden`). Rendered as-is in the segments, the work lines, the unlinked lines and `page_requests`. `src/runtime-attribution-browser.js:1043` does `split('#')[0]`. `dist` equals `src` (`cmp`, before and after `npm run build`). `compare_chains` still keys by path: the verdicts on 3 final7 and 6 G6 pairs are identical to `main`. |
| 5 | **`resolve_element`: top 5, `best` only when unique, never `exact`** | PASS (with a scope note) | `{role:button, name:Dup}` (two buttons with the same aria-label, rows seq 269/277): `best: null`, both listed, status `ambiguous`. `{name:Go}` and `{role:button, name:Go}`: best is the Go key, still `ambiguous`. `{role:button, name:Stop}` (stamped, never clicked): best is set on a stamp-only candidate with 0 actions. **`nearby_text` never sets `best`:** `{role:button, name:Dup, nearby_text:"Alpha"}` still gives `best: null`. The records hold no nearby text, only a hash of the element's own first label attribute or its text, so "only one matches the nearby text" cannot be known from rows. Abstaining is the doctrine-correct answer, but the brief's expected "best set" is not achievable. `{role:button, name:Open}` (the visible text of the Dup buttons) gives `not_found`, because `content_sig` hashes the aria-label first. That is not a regression: `main` is also `not_found`. |

## Fresh-repo check (item 3): RUN.md residual 1 does not reproduce on the real pipeline

- **g5c** (`docs/evidence/g5-anything-llm-2026-09-23c/store`, built with `producttrace({"stamps":true,…})`; 119 `element.stamp` rows). The anything-llm checkout is at `ad97bc8d`, the build commit, and clean (read-only; nothing built).
  - With `--source-root`, 100 `action_chain` calls give **960 work frame lines, 0 `<unnamed>`, 0 offset-only**. Every line has a name or `<anonymous>` and `file:line`.
  - The segment lineage renders the same labels. Example: submit `muen79uv:146` shows `handleUpdate …/GeneralAppearance/index.jsx:26 → update models/workspace.js:26 → request (1) …`, then `after response 200: showToast utils/toast.js:24 (await continuation)`.
  - Without `--source-root`, work and lineage both render `name file@start-end` (names from the enriched manifest). No stale_build.
- **G6** (`g6store`, manifests carry no names: `enrichment: {}`). With `--source-root` at the baseline `ad97bc8d`:
  - 2,892 work frames: 2,731 named with lines, **161 `<unnamed>`**;
  - those 161 are 4 function ids, all in `GeneralAppearance/index.jsx`, from the seeded B/C/E builds whose text differs from the checkout (`stale_build`, pre-existing);
  - the lineage shows the same `stale_build` (47 hops);
  - for the 25 function ids that appear in both work and lineage, the labels are identical (0 differences).
- **Where `<unnamed>` does appear:** only in the author's harness (`test/browser/fixture-build.mjs`, source-stamp plugin before the attribution plugin), given the real checkout. There, my probe also renders `handler <unnamed> client/src/main.jsx@2108-2147` in the chain line and in the work block alike.
- **Conclusion:**
  - On real stores, `work` renders exactly as well as the segments. It does not say less than the manifest knows, so this is not a defect of the claim.
  - RUN.md residual 1 ("on a real Vite build … every function in such a JSX file is `stale_build` and renders `<unnamed>`") is wrong as stated, because it is a harness artifact. It needs an erratum (required change 4).

## Banked stores against `main` (item 4)

Method: `git archive fixes-2026-09-24` goes to `grader-scratch/main`. `probe/bank.mjs` makes these calls on both trees:
- `recent_actions {n:100}`;
- `action_chain` for every action;
- `element_history` for every key;
- 10 `resolve_element` probes;
- `compare_chains` on the G4 grader pairs (final7) and the 6 G6 pairs.

`probe/diff.mjs` compares the fields with `query`, `work`, `work_summary`, `best`, `component` and `limits` stripped.

- **final7** (`--records/--spans`, G4 manifest, `--source-root` LibreChat `45cc53c`): 54/54 actions are identical in all of these:
  - `stops`, `reached`, `stopped_at`, `because`, `outcome`, `chain`, `episode_id`, `episode_action_ids`, `spine`, `unlinked`, `coverage`, `segments`;
  - the first summary line, and every summary line outside the Work block.

  Also identical: `recent_actions` (fields and text); 35/35 `element_history`; `compare_chains` on 3/3 pairs (stops, `path_changed`, `outcome_delta`, summary text).
- **G6** (`--source-root` anything-llm): 100/100 actions identical on the same fields, 15/15 `element_history`, and 6/6 compare pairs identical.
- **Changed behaviours, confirmed:**
  - `{element_path:"div > div > button", nearby_text:"Save"}` on final7 lists 6 → 5 candidates, and `candidates_total` stays 6;
  - `{role:"button", name:"Save"}` goes `not_found` → `ambiguous`: final7 4 candidates, G6 5, `best: null`.
- **Also changed (the author did not list these):** role-only probes flip the same way:
  - `{role:"button"}`: final7 not_found → 4, G6 not_found → 5;
  - `{role:"textbox"}`: final7 not_found → 5 of 7, G6 not_found → 3.

  Same cause (implicit roles). Acceptable, but RUN.md should say it.
- **Keystroke `element_history` size (G6 key `handler:…1181:1319|keydown`), raw JSON-RPC, no SDK limit:**
  - `main` 17,247,712 bytes;
  - branch 17,565,552 bytes: **+317,840 bytes (+1.8%)**, of which `work_summary` is 141,460 characters over 54 actions + 6 attempts.

  It is over the SDK's 10 MB limit on both, so the connection closes identically. This branch makes it slightly worse, not categorically worse. A per-tool size budget is still owed.

## Tests and commands (item 5)

| Command | Result |
|---|---|
| `npm test` | 692 tests, 691 pass, 1 fail: `react-context-ref-semantics` (`'a' !== 'b'`, known) |
| `node test/browser/mcp-gaps.mjs` (`TRACER_KEEP_STORE=1`) | 26/26 (the author's checks; their raw-row claims were recomputed above) |
| `node test/browser/d12-stamp-neutrality.mjs` | pass: true, 17/17 checks true |
| `node test/browser/continuations-neutral.mjs` | status ok |
| `node test/g4-grader.mjs docs/evidence/m1-2026-09-22-final7 --manifest docs/evidence/g4-mcp-2026-09-23/manifest.json` | 81 PASS / 0 FAIL |
| `node test/browser/g6-compare.mjs --store grader-scratch/g6store --out grader-scratch/g6cmp <6 pairs>`, then `node test/g6-grader.mjs grader-scratch/g6store --compare grader-scratch/g6cmp` | Overall: PASS (6/6 pairs) |
| `worker-frontier`, `shadow-dom-context`, `stable-element-keys`, `no-cross-control-neutral`, `effect-rooted-form-neutral` | all ok / pass |
| `unlinked-coverage-neutral` | 12/13, A8 fails. **On a `main` archive it is also 12/13, with the same A8 failure**: pre-existing, as claimed |
| `cmp src/runtime-attribution-browser.js dist/runtime-attribution-browser.js`, before and after `npm run build` | identical; `built byte-identical runtime (304724 bytes)`; `git status` clean apart from untracked scratch |
| `git merge-tree --write-tree main HEAD` | clean against `main` `9a8496fb` |
| Probes: `grader-scratch/probe/drive.mjs` (`SKEW_MS` 0, −500, +500), `q.sh`, `bank.mjs`, `diff.mjs`, `rawsize.mjs` | as reported above |

## Privacy (item 6)

From this runtime on, query strings reach dev stores as sent: `network.request.url` is path plus query, and only the fragment is dropped (`src/runtime-attribution-browser.js:1043`).
- Tokens, codes or e-mails in query strings (OAuth callbacks, signed URLs, `?token=`) will sit in `records.jsonl` and be printed to agents by `action_chain`, `page_requests` and `element_history`.
- Nothing redacts them.
- The request bridge (`analysis/browser-request-bridge.mjs`) and worker URLs (`:1249`) still strip the query, so the two capture paths now disagree.
- G4 §3 and RUN say "recorded as-is (dev tool)". That is a disclosure, not a control.

## Residual risks (not blocking)

1. `work` is episode-scoped. A submit's listing opens with keystroke and global-shortcut frames. On G6, `handleKeyDown ×9` and `toggleSidebar ×9` come before the handler's own work. This is disclosed.
2. `page_requests` intervals mix attributed and unattributed requests to one endpoint. In the same-URL probe the median stays 450 ms, but the minimum is 110 ms (poll to click).
3. `nearby_text` only matches the element's own label or text hash (+2). It cannot tell two same-name elements apart, and `best` ignores it.
4. `after_request` / `after_response` with several earlier requests on one lineage lists them all. This is disclosed.
5. An issuer with no `task` reads "not inside a timer … (task origin not recorded)" for every task started by a native `await`, `MessageChannel`, a listener or a worker.

## Required changes (for `merge`)

1. **`after_response`.** The rendered mark must say that it is an order and not a relation.
   - One option: `later (recorded after (1) ended, server clock): <fn>`.
   - Otherwise, derive it from an identifier: the runtime records which request's promise a reaction settled from.
   - G4 §3 and RUN must say that any promise/await continuation of a lineage-prefix frame qualifies (probe: `unrelated`), and must state both skew directions.
   - Add a fixture check with a sibling continuation that is not chained on the fetch.
2. **`describeIssuer`** (`mcp/tools.mjs:1022`).
   - An empty `function_ids` must not assert "uninstrumented code". Say "no first-party frame recorded on the stack (uninstrumented code, or first-party code resumed after an `await` in a task no action owns)". Better still, have the await rewrite carry the unowned task's frames and origin across the resumption.
   - De-duplicate consecutive repeated ids in `function_ids` and `armed_by` before labelling, so "called from" never names the issuer itself.
   - Add the `async` poll case to the fixture.
3. **Recursion in `work`.** A path whose last id repeats beyond the proxy/body pair must not print as a bare single call. Either count exactly, which needs a runtime proxy/body marker on `function.enter`, or render `fact … (recursive: 10 enter rows; calls not separable)`. Add the fixture case.
4. **RUN.md residual 1 is wrong for real builds.** On g5c (a real `producttrace()` build with stamps), 960/960 work lines have names and lines. `<unnamed>` appears only in the `fixture-build.mjs` harness and for files edited after the build (G6: 4 ids, identical to the lineage). Add an `ERRATA.md` to this evidence directory (it is immutable), and list the role-only `not_found → ambiguous` flips (`{role:"button"}`, `{role:"textbox"}`).

Grader: independent. I did not write the branch and imported no package code for any expectation. The one direct-import tool is `probe/drive.mjs`, which uses the repo's fixture builder and collector only to produce a store.

---

## Regrade at ead93888 (2026-09-24, same grader)

This regrade covers the head `ead93888`: five commits on top of `1fba0319`, read with RUN-2.md, ERRATA.md and the second G4 amendment.

Method:
- The probe fixture (`grader-scratch/probe/main.jsx`) was extended. Every store was rebuilt with the head's own plugin and runtime.
- Probe stores (under `$TMPDIR`, all kept):
  - `out2` (no skew), `out2-neg` (server clock −500 ms), `out2-pos` (+500 ms);
  - `out3` adds the non-nested await and `.then` chain cases;
  - the old-runtime stores `out-skewneg` and `out-skewpos` from the first grade serve as "old stores".
- The row dumps come from `probe/rows2.mjs` and do not use package code.

### Verdict: **merge with changes**

One undisclosed miss (1b) and one inaccurate count sentence in RUN-2 (3c). Everything else the coordinator listed holds.

### 1. "after response" is now an identifier (`response_of`)

| Probe | Raw rows (`out2` unless noted) | MCP | Verdict |
|---|---|---|---|
| Sibling (`wait(250).then(unrelated)`, `Promise.resolve().then(early)`, next to `fetch('/api/fast')`) | enters 270/271 (`early`) and 277/278 (`unrelated`) have no `response_of` | both listed plain, with no mark | PASS (was a false mark) |
| The same, with the server clock −500 / +500 ms | same rows | work blocks sha1 `62c493e8…` identical across `out2`, `out2-neg` and `out2-pos`: 1 mark (the XHR), 0 `ordered` | PASS: skew no longer matters |
| `Promise.all([fetch(a), fetch(b)]).then(cbAll)` | `cbAll` enters 295/296 have no `response_of` (the `Promise.all` result is not a derived promise) | `cbAll … (promise continuation)` with no mark | PASS: honestly none |
| `x.addEventListener('load', xhrDone)` | enters 326/327 have `response_of = …:request:84` (request seq 323) | `after response 200: xhrDone … (listener continuation)` | PASS |
| `fetch(u).then(r => r.json()).then(cbAll)` (`out3`) | enters 356/358/359 have `response_of = …:request:96` | marked | PASS |
| `const r = await fetch(u); const b = await r.json(); cb(b, r.status)` (`out3`, `r` used twice) | `cbJson` enters 340/341 have `response_of = …:request:90` | marked | PASS |
| **1b.** `const r = await fetch('/api/json'); await r.json(); cbJson();` (the coordinator's exact case) | `cbJson` enters 307/308 (`await:481`) have **no `response_of`** | `cbJson … (await continuation)`, no mark | **MISS (undisclosed)** |

Cause of 1b:
- The bundler inlined `r`, so the built code is `__ptAwR(__ptAw=__ptAwS(__ptAw), await __ptAwL(__ptAw, (__ptAwR(__ptAw=__ptAwS(__ptAw), await __ptAwL(__ptAw, fetch(u)))).json()))`.
- The outer `__ptAwS` runs before the inner await resumes, so the outer slot's `frame` is the pre-fetch frame, which has no `response_of`.
- The outer resumption then restores that frame (`src/runtime-attribution-browser.js` `awaitSuspend`/`awaitResume`, which share one `__ptAw` slot per function).
- `await (await fetch(u)).json()` written by hand behaves the same.

It is an abstention, not a false mark. But G4's second amendment says only "code resumed from an await on a non-derived promise, unless its frame already carried the origin" is unmarked, and here the frame did carry the origin when the inner await resumed. The nested and inlined form is the most common body-read idiom.

Old stores:
- New MCP on the old-runtime store `out-skewneg` prints `ordered after the response 200; not linked: early …` and `…: unrelated …`.
- G6 at head has 63 `ordered after the response` lines and 0 `after response` lines. `after_response` is not a substring of the new wording, so the 63 are all relabelled.
- final7 has 0 of either.

### 2. Issuer and the await-rewrite engine change

- **A page-load poll that awaits, then fetches** (`slowPoll`: `await wait(300); fetch('/api/slowpoll?p=1')`, every 350 ms). All 32 rows have `action_id: null` and issuer `{f: [t4, t4, slowPoll, slowPoll], task: setInterval}`. The MCP names it: `issued by slowPoll client/src/main.jsx:36 (called from t4 …) from a setInterval timer armed at page load …`. The first grade's `asyncLoad` case is now `issued by asyncLoad …` (16/16).
- **A click during that await.** Twelve `Own` clicks came at about 100 ms intervals while the poll was awaiting 300 of every 350 ms. Each `/api/own` row is owned by exactly its own click (12 distinct `action_id`s, 12/12, `page_requests` `12 action, 0 none`). No slowpoll row gained an action (32/32 none).
- **Action-less frames.** There are 0 `function.enter` rows with a null `action_id`, so no loose frame was written. Unattributed issuer shapes are 5, all as expected. `/api/inline` still has `f: []` with a setInterval task.
- **Code.** `ownable = frame => Boolean(frame && frame.action_id)` (src line 84), and the loose await continuation copies `action_id: null`, so it can never be captured as an owner by a timer, promise, listener or focus handler.
- **Tests.** D12 17/17. continuations-neutral ok.
- **Wording.** "uninstrumented code" is gone. An empty frame list reads `no first-party frame recorded for this request (issued outside any action)`, and `called from t3 (…t3)` no longer happens (frames are de-duplicated).

### 3. Call counts (`entry: call|chunk|body`)

- **3a. Fixture rows (`out2`).** One call writes a `chunk` enter plus a `body` enter.
  - Plain calls: `sendA` 174/175 and `helper` 179/180 are 1 call each.
  - Two callers: `fmt` under `callerA` is 144/145 + 148/149, printed ×2; `fmt` under `callerB` is 156/157, printed ×1.
  - Recursion: `fact` rows 122–131 alternate chunk and body at a growing depth, which is 5 calls. The MCP prints `fact client/src/main.jsx:17 ×5 (recursive)`.
  - Some frames have a single `body` row (e.g. `onChain` 353, `wait` 264), and each counts 1.
  - The author's driver has 32/32 checks, including W10/W11 for `factorial ×5 (recursive)`.
- **3b. Old stores.** On the old-runtime probe, new MCP prints `fact client/src/main.jsx:17 (10 enter rows; repeated or recursive calls are not separable)`.
- **3c. final7 (old rows, no `entry`).** Plain and paired counts use the old rule and are unchanged against the first grade. Across 2,553 rendered entries there are 0 `calls_exact: false` and 0 "not separable". But RUN-2's "Neither banked store has such a run (0)" is not true of the raw rows. final7 has **167 `function.enter` rows, in 3 manifest functions, whose spine ends in a run of ≥ 3 of the same id**, all inside listed episodes (e.g. seq 32165, `action:mud8rf23:6`, spine length 15). They are never rendered because they sit below depth 4 and past the 100-entry JSON cap (`entries_total` 103). The sentence should read "0 rendered" or "0 within the depth limit".
- **Does the double framing change anything elsewhere?** No. The chunk and body double framing is pre-existing and unchanged in every store, and this branch only adds the additive `entry` and `response_of` fields to `function.enter`. So no join and no other count moves:
  - `test/g4-grader.mjs` reads no `function.enter` rows;
  - `test/g6-grader.mjs` reads only the first depth-zero enter;
  - G4 is 81/81, G6 6/6, and D12 is byte-neutral at 17/17.

### 4. ERRATA, banked stores, suite

- **ERRATA.md role-only table**, confirmed by my own runs of `main` against the head: final7 `button` 0→4, `textbox` 0→7, `form` 0→3, `{button, Save}` 0→4, `combobox` ambiguous 1 on both, `menuitem` ambiguous 2 on both, `link` and `checkbox` not_found on both. G6: `button` 0→5, `textbox` 0→3, `{button, Save}` 0→5, and `form`/`combobox`/`menuitem`/`link`/`checkbox` not_found on both. ERRATA §1 matches my first-grade counts.
- **Banked stores against `main` at head** (`probe/bank.mjs` + `probe/diff.mjs`): unchanged on final7 54/54 and G6 100/100 in `stops`, `reached`, `stopped_at`, `because`, `outcome`, `chain`, `episode_*`, `spine`, `unlinked`, `coverage`, `segments`, the first line and every non-Work line. Also unchanged: `recent_actions`, `element_history` minus `work_summary` (35/35 and 15/15), and `compare_chains` stops/verdicts/summary (3/3 and 6/6). The only differences are the `resolve_element` changes listed above.
- **Suite:**
  - `npm test`: 692 tests, 691 pass, 1 fail (`react-context-ref-semantics`);
  - `mcp-gaps.mjs` 32/32; D12 17/17; continuations-neutral ok;
  - G4 81 PASS / 0 FAIL; G6 PASS 6/6;
  - worker-frontier, shadow-dom-context, stable-element-keys, no-cross-control-neutral and effect-rooted-form-neutral all exit 0;
  - unlinked-coverage-neutral 12/13, A8 only (the same on `main`);
  - `cmp` of `src` and `dist` identical before and after `npm run build`, and the working tree is clean.

### Required changes (for `merge`)

1. **Nested awaits and `response_of` (1b).** Either fix it, or disclose it and test it.
   - A fix: in `awaitLeave`, when the slot's `frame` was captured before an inner await in the same operand resumed, refresh `w.frame` / `response_of` from the current frame. Rerun D12 and continuations-neutral afterwards, because this touches ownership capture timing.
   - Or: add the case to G4 "not recorded, so never marked", with the exact shape `await (await fetch(u)).json()`, and say that bundlers emit it from `const r = await fetch(u); await r.json()` when `r` is used once.

   Either way, add the fixture check (the coordinator's case), asserting the chosen behaviour.
2. **RUN-2 count sentence (3c).** Correct it in an errata note: final7 has 167 raw run rows (3 functions), none rendered.

Neither changes an attribution, a join or a credit.

---

## Regrade at 9c291b06 (2026-09-24, same grader)

This regrade covers the head `9c291b06`: three commits on `0f332d05`, read with RUN-3.md, ERRATA §3 and the G4 nested-await note.

The runtime change is `awaitLeave` in `src/runtime-attribution-browser.js`:
- It sets `w.carry = w.resumed ? current?.response_of : null`.
- The resumption then applies `w.response || w.carry`.
- Only the response id is carried. `w.frame` (ownership capture) is untouched.

Probe store: `grader-scratch/probe/out4` (head plugin and runtime, no skew). The raw rows were dumped with `probe/rows2.mjs`.

### Verdict: **merge**

### 1. Nested await and the break attempts (raw rows, then MCP)

| Probe | Raw rows | MCP work line | Verdict |
|---|---|---|---|
| `await (await fetch('/api/n/one')).json(); cbN1()` | request seq 370, occ `…:request:101`. `cbN1` enters 371/372 (`await:615`) have `response_of = …:request:101` | `after response 200: cbN1 client/src/main.jsx:33 (await continuation)` | PASS (was the 1b miss) |
| Two-statement `const r = await fetch('/api/n/two'); await r.json(); cbN2()` | request seq 386, `…:107`. `cbN2` enters 387/388 have `response_of = …:107` | `after response 200: cbN2 … (await continuation)` | PASS |
| Sequential: `await (await fetch(a)).json(); await (await fetch(b)).json(); cbSeq()` | request a seq 401 (`…:112`), b seq 402 (`…:113`). `cbSeq` enters 403/404 have `response_of = …:113` (b) | `after response 200: cbSeq`, with `after_response.requests = [2]` (b), not a | PASS |
| Inner await is not a fetch: `await (await later(20)).x; cbNot()` | `cbNot` enters 425/426 have no `response_of`, and no request row | `cbNot … (await continuation)`, no mark | PASS: no id invented |
| Inner await in another function: `async getJson(u) { return (await fetch(u)).json() }`, then `await getJson(u); cbCross()` | request seq 441 (issued by `getJson`). `cbCross` enters 444/445 have no `response_of` | `cbCross … (await continuation)`, no mark; the request hangs under `getJson` | PASS: no cross-function leak. It is an abstention (the async function's own promise is not a derived promise) |

Code reading:
- The sequential case is right because the inner `awaitLeave` of the second statement sets `w.response` from the new fetch. The inner resumption uses `w.response` first, and the outer leave then carries b.
- `w.carry` is recomputed on every leave and cleared on every resume, so no stale id survives.
- `carry` reads `current`, the frame of this function's own slot at leave time. Another function's slot never writes this `w`.

### 2. Suite at 9c291b06

- `npm test`: 692 tests, 691 pass, 1 fail (`react-context-ref-semantics`, known).
- `node test/browser/mcp-gaps.mjs`: 34/34.
- D12: pass, 17/17. continuations-neutral: status ok.
- G4: 81 PASS / 0 FAIL. G6: PASS 6/6.
- worker-frontier, shadow-dom-context, stable-element-keys, no-cross-control-neutral and effect-rooted-form-neutral: all exit 0.
- unlinked-coverage-neutral: 12/13, A8 only (the same on `main`).
- `cmp` of `src` and `dist` is identical before and after `npm run build`. The working tree is clean.

### 3. Banked outputs identical to ead93888

`probe/bank.mjs` was run at `9c291b06` and compared call by call, fields and text, with the `store` stats block ignored:
- final7 (G4 manifest, LibreChat source root): 103/103 identical;
- G6 (anything-llm source root): 133/133 identical, including the same single keystroke `element_history` transport error.

Old rows carry no `response_of`, so the change cannot reach them.

### 4. Earlier required changes

- The ead93888 item 1 (nested await) is fixed and covered by fixture W12/W13.
- Item 2 (the RUN-2 count) is corrected by ERRATA §3, which says "167 raw rows (3 functions, 8 actions) below the depth limit; 0 rendered" and matches my count.

Nothing is outstanding.

### Residual risks carried forward (non-blocking)

- `await asyncHelper()` where the helper awaits a fetch leaves the caller's continuation unmarked (abstention, the `cbCross` probe).
- `Promise.all` over fetches is unmarked.
- Page-wrapped promises and `xhr.onload =` are unmarked, as disclosed.
- Query strings reach dev stores as sent (the privacy note stands).
- `element_history` on keystroke-heavy keys exceeds the MCP client's 10 MB buffer on `main` and on the branch (the branch adds about 1.8%).
- The `work` listing is episode-scoped.
