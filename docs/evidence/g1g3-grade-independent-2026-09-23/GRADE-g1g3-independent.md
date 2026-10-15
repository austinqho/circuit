# Independent grade: G1 (frontend-only) and G3 (element stamps), third pass

- Grader: independent agent. Read-only apart from this file. No LibreChat build and no LibreChat services were run.
- Branch `g1-g3-stamps`, head `582810ae` (evidence produced at `2718c324`), rebased on main `47587bd9`.
- Evidence graded: `docs/evidence/g1-2026-09-23c/` and `docs/evidence/g3-2026-09-23c/`.
- Gate text: `docs/gates/G1-frontend-only.md` and `docs/gates/G3-stamps.md`, all three passes.
- The implementer's graders (`g1-grade.mjs`, `g3-librechat-stamps.mjs` summary, `d12-stamp-neutrality.mjs` verdict) were not used as truth. Every number below was recomputed from raw rows with python3, or with node plus the fixture's own TypeScript parser. Nothing was imported from `analysis/`, `src/` or `integrations/`.
- Exception: my probes build the neutral fixture through `test/browser/fixture-build.mjs`, which loads the plugins under test.
- Raw record integrity: I decompressed both `records.jsonl.gz` files. The sha256 and row counts match RUN.md exactly:
  - `c673eb07…` has 289,454 rows;
  - `c53720a2…` has 259,762 rows.

## Verdict summary

| gate / item | verdict |
|---|---|
| G1 frontier criterion (backend off) | **pass, with a vocabulary defect.** 14/14 request actions end `network \| backend not instrumented`, with 0 backend steps. But 175 chains end `stopped_at: "handler"`, which reuses the backend stop name. |
| G1 backend on reproduces final7 | **pass.** Joins were recomputed from spans and Mongo was checked by hand. Handlers are 9/9: 8 identical to final7, plus the feedback correction, which I verified. |
| G1 engine changes (receipts, awaits) | **fail.** Two deterministic misattribution paths in state receipts. The neutral negative controls never overlap an action. |
| G3 D12 byte identity | **pass.** Recomputed from the recorded files, and rerun by me with byte-identical output. |
| G3 resolve_element file:line | **pass.** 10/10 random keys match. |
| G3 OAI attributes | **pass on what can be checked.** Recorded LibreChat payloads are not in the evidence (counts only). |
| G3 own-JSX-site claim (100%) | **fail as stated.** The classifier cannot see render-prop, cloned or function-child hosts. The true share is about 93–96%. |
| G3 "every interactive host on both new repos" | **not reached.** G2 repos are not in scope. The literal check is false on LibreChat (1 non-React textarea per surface). |
| npm test | 605 tests, 604 pass, 1 fail. The failure is known and also fails on main `47587bd9`. |

## Per-item table

| # | claim | what I recomputed | result |
|---|---|---|---|
| 1a | Backend off: every action with a first-party request ends `network / backend not instrumented` | 346 `dom.action` = 346 chains, no extras. Every action with ≥1 non-internal request (14) ends `network \| backend not instrumented`. Every per-request frontier matches, and each chain's request set equals the rows with that `action_id`. | pass (0 mismatches) |
| 1b | Zero route/handler/db stops | 0 `route` / `server_handler` / `db` / `server` steps in any `reached`. However, **175 chains carry `stopped_at: "handler"`** (the D-G1-6 credit abstention, `because: "no element-bound handler ran…"`), none of which has a request. D-G1-1 defines `stopped_at: "handler"` as the backend stop, and the gate's evidence plan says every non-request action ends with the `browser` frontier. A consumer filtering on `stopped_at` cannot tell the two apart without parsing `because`. | literal gate text not met; defect in naming, not in the frontier mechanism |
| 1c | Four core flows attribute their chat POST | Backend off, by `sequence`: <br>• send: `POST /api/agents/chat/openAI` @98762 → action @89468 `submit` "Send message", `state_effect`<br>• regenerate: @111831 → @104915 click `regenerate-generation-button`, `direct`<br>• edit-resubmit: @125278 → @115360 click (the Save & Submit button; see 5b), `direct`<br>• agent chat: `POST /api/agents/chat/agents` @240302 → @230528 `submit`, `state_effect`<br>Backend on has the same four. | pass |
| 1d | Capture lossless, contiguous | One `capture_page_id` per run. `sequence` is 1..288,673 and 1..258,974: contiguous, in file order, no duplicates. `stamp_sequence` is 1..781 and 1..788, also contiguous. No row carries both counters. | pass |
| 1e | Tracer requests = Playwright requests | The raw Playwright list is in `coverage.json` → `request_coverage.observed_requests` (method, url, resource type). The (method, path) multiset equals the `network.request` rows: 82 = 82 and 83 = 83, empty difference. | pass |
| 1f | "one more expected row than received" (LIMITS) | Confirmed in the capture summary. The same off-by-one exists on the stamp counter (expected 782 vs 781 received; 789 vs 788), which LIMITS does not mention. | cosmetic omission |
| 2a | 8 mutation flows: 7 reach a DB write, feedback stops at the handler | I joined each request's `trace_context` (trace id, span id) to a `server` span with `parent_span_id` equal to the request's span id, then walked descendants. Handler = span with `producttrace.express.handler.name`. Write = insert / update / findAndModify / delete under a handler.<br>82/83 requests join; `/health` has no span.<br>Writes found:<br>• send, regenerate, edit, regenerate #2 and agent chat: findAndModify messages/conversations + insert transactions (`controller`)<br>• rename: findAndModify conversations<br>• agent create: insert agents + findAndModify aclentries (`createAgentHandler`)<br>• delete: deletes on conversations, messages, sharedlinks, toolcalls, agent_checkpoint(_writes)<br>• login: insert sessions<br>Feedback PUT: handler `validateMessageReq`, 0 DB spans under it. | pass |
| 2b | Mongo (window 15:25:17–15:26:17Z, user `tracer-m1@example.test`) | Read with `mongosh`:<br>• session `6ab3ef5e…` at 15:25:18Z;<br>• conversation `fa1b0fc1…`: createdAt 15:25:20.513, title "Tracer M1", updatedAt 15:25:36.459;<br>• agent "Barista 1790177116869" at 15:25:39.041;<br>• aclentries `agent` + `remoteAgent`, permBits 15, at 15:25:39.046;<br>• 7 messages in `fa1b0fc1`;<br>• conversation `3a9eeeb1` (agent chat) absent, with 0 messages (delete confirmed);<br>• 4 transactions for `3a9eeeb1` in the window;<br>• 0 feedback writes.<br>Note: RUN's table says "messages in window" for agent chat. Those messages were deleted by step 10. Only the 4 transactions confirm the agent-chat write. | pass (RUN wording slightly off) |
| 2c | Credited handler per flow vs final7 `HANDLERS.md` | Both runs credit the same ids as final7's "after" column for login, send, regenerate (×2), edit-resubmit, rename, agent create, agent chat and delete. Feedback is credited `Feedback.tsx:3347:3559`. On disk, `handleDownOption = useCallback((tag) => (e) => {…})` is used as `onClick={handleDownOption(tag)}` (offset 5814). So 3347 (the returned closure) is what runs on click, and the correction is right. In the click action's rows, 3347 is the root frame and 3324 appears only nested under it (a re-render inside the click), which is consistent. | pass (correction accepted) |
| 3a | Receipts attribute only work caused by the action | Code: `src/runtime-attribution-browser.js`. Receipts are recorded in `receiptSetter` (lines 104–115), marked `rendered` in the dispatcher wrapper (131–133), applied in `applyReceipts` from `rememberFiberFunctions` (45–65, 93) and aged at line 98. My probe found **two deterministic misattribution paths**; see "Engine findings". The shipped negative controls are **vacuous**: all 40 `/api/sibling`, all 6 `/api/poll` and `/api/late-mount` fire *before* the first click (checked by rerunning the fixture and comparing sequences). | fail |
| 3b | Await continuations | Rewrite: `await E` → `__ptAwR(__ptAw=__ptAwS(__ptAw), await __ptAwL(__ptAw, E))` plus `var __ptAw=__ptAwB(); try{…} finally{__ptAwE(__ptAw)}` (`integrations/runtime-attribution.mjs` 507–518, 631–639).<br>Resume restores the frame captured at suspend. That is correct on the fulfilled path.<br>Semantics are preserved; probed in a browser: `this` in async methods, thrown errors, return values, `finally` order, `arguments`, concise arrows.<br>**Gap:** on a rejected await, `__ptAwR` never runs, so the `catch` block runs on whatever ambient frame exists. Probe: fetches after `catch` of a rejected await, and after a callee that throws, are both unattributed. The fulfilled control is attributed `direct`. | semantics ok; rejection path not covered, and not listed in LIMITS |
| 3c | No timers or ambient fallbacks; no library/repo names | Library/repo names: `git diff main..HEAD` over `src integrations analysis collector mcp` adds none (ariakit, radix, react-hook-form, recoil, librechat, lucide, tanstack). Existing ones are in `analysis/library-contracts.mjs` on main.<br>Timers: the M1 `hostSetTimeout` action-clear (line 351) and `wrapOwnedCallback`'s `owner \|\| previous` ambient fallback (line 664) are both pre-existing on main, and both are still live.<br>New code adds two issues:<br>• `receiptSetter` accepts a bare action frame (`owner?.action_id`, with no `!owner.action` check);<br>• `applyReceiptFrame` sets `action: false`. A receipt taken from a bare frame therefore becomes an attributable frame, which bypasses the transport's bare-frame refusal.<br>Probe: an unowned 1 ms interval calling a first-party fetch was attributed to a click in 3 of 5 runs. A sibling driven by an unowned ticker was attributed in 2 of 5 runs, linkage `direct`, together with the other tick effects. | ambient window still misattributes (pre-existing), and receipts extend it |
| 3d | `!current.action` rule | The fetch/XHR/EventSource/WebSocket wrappers use `active = current && current.action_id && !current.action ? current : null`. A bare action frame gives an unattributed row with `reason: "unattributed_transport"`. The bridge guard (`__PRODUCTTRACE_BRIDGE_TRANSPORT__`) only suppresses the wrapper's duplicate row. The rule is weak in practice: any first-party function entered under a bare frame creates a non-bare frame, and so does a receipt. | as described; weak |
| 4 | Unattributed requests | Backend off: 25. Backend on: 42. My list matches `unattributed-requests.json`.<br>For every unattributed send I tracked the enter/exit stack: **0 first-party frames were open at send**. None looks like a transport-wrapper miss; each is a continuation gap after the frame exited. Ten judged by hand:<br>• boot `/api/config` @1 and `/api/auth/refresh` @2: no action, correctly unattributed;<br>• `/api/tags` @4616: downstream of login (frontier);<br>• `/api/agents/chat/status` @102598: after send (frontier);<br>• `/api/share/link`, `/api/messages`, `/api/agents/tools/calls` @113746–8: after regenerate, query invalidation (frontier);<br>• `/api/agents/<id>` @170911 and `/api/permissions/agent/<id>/effective` @171741: after Create (frontier);<br>• `/api/agents/chat/status` @244089: after agent chat (frontier).<br>Run-to-run variability **is visible** in the recorded runs. The post-login batch (`/api/endpoints` … `/api/search/enable`, `/api/keys` … `/api/endpoints/token-config`, `/health`, `/api/agents`) is `mount_effect` to login in the backend-off run but unattributed at @1173–1181, @4484, @9974–9980 and @11912 in the backend-on run. | frontiers, not wrapper misses; attribution of the same flow is non-deterministic |
| 4b | Side finding | In the backend-off run, `GET /api/agents` @28480 is credited `direct` to action @21386, a `focusin` on the message textarea 373 ms after login with no user input. That is a programmatic autofocus, which dispatches trusted focus events. `beginDomAction` overwrites `current` (login's mount-effect frame) and does not restore it, so the rest of the login effect's work moves to a pseudo-action. This is pre-existing M1 behaviour, but it produces attributions to non-user "actions". | noted |
| 5a | G3 stamp coverage | Not recomputable from raw rows: the DOM survey is recorded as counts and examples only. The harness's in-page counts are 67/68, 85/86, 97/98 and 81/82 in both sessions. The one miss per surface is a textarea with no React fiber (likely the autosize measuring clone; not verified). So coverage is 100% of React-rendered interactive hosts per those counts.<br>`every_interactive_host_stamped` is false, and the two-repo clause is not reached. | counts only; not independently reproducible |
| 5b | `element_key` → file:line, 10 random keys (seed 20260924) | For each key I checked:<br>• placement hash = sha256 of the file on disk;<br>• `src[start:]` starts with `<tag`;<br>• the line of `start` equals the row's `line`;<br>• the span ends at a closing `>`.<br>Result 10/10. Across all 556 rows: every key maps to exactly one `placement_id` (0 conflicts), and every key prefix is derived from its placement id. | pass |
| 5c | Own-JSX share: "100% of elements with first-party JSX" | 20 random non-`self` rows, classified against source:<br>• **18 correct** (lucide `<svg>`, Ariakit or Radix default hosts, Radix Switch bubble `<input>`).<br>• **2 misclassified:**<br>  – `Fork.tsx:330`: `Ariakit.PopoverAnchor render={<button onClick=…>}`. The button's own JSX is first-party.<br>  – `Conversations.tsx:59`: `CellMeasurer` with the child `{({registerChild}) => (<div data-testid="convo-list-row">…)}`. First-party JSX, but not placed.<br>Whole-population scan of the 212 non-self rows:<br>• 8 rows have a `render={<host…>}` on the placement itself (Fork.tsx:330, Feedback.tsx:146/180);<br>• 6 are the CellMeasurer function child;<br>• 13 are `Tooltip.tsx:160` wrapper rows, whose callers pass `render={<button>}` in 96 of the usages found.<br>The Save & Submit button clicked in G1 (EditMessage.tsx:190, `render={<button…>}`) is stamped as `Tooltip.tsx:160 Ariakit.TooltipAnchor`.<br>The harness classifier ("nearest component fiber is not first-party → library-rendered") cannot see these cases.<br>Per stamp row, the corrected share is 344/(344+14…27) ≈ **92.7–96.1%**. That still clears 90%, but it is not 100%. | claim false; acceptance probably still met |
| 5d | OAI payloads valid; none without the stub | The LibreChat payloads themselves are **not recorded**. Only `annotation: "written"` (279 rows, stub session) and `"absent"` (277 rows, no-stub session) are recorded, plus in-page counts.<br>(i) I captured live attributes on the neutral fixture with my own Python §4.3 validator (plain object, ≤ 6 entries, key regex / ≤ 64 units / reserved names, value types, strings ≤ 256 units without Cc/Cf/Cs/U+2028/9, ≤ 2048 UTF-8 bytes, label ≤ 128):<br>  • stub: 11/11 stamped nodes carry valid payloads and labels;<br>  • no stub: 0 attributes;<br>  • stub without a `request` function: 0 attributes.<br>(ii) I rebuilt all 279 LibreChat payloads from the stamp rows using the longest action id seen: 0 invalid, max 261 bytes, max label 54.<br>Note: `g3-no-oai.png` and `g3-oai-stub.png` are byte-identical (sha `931ee156…`) and evidence nothing. | pass (fixture live; LibreChat reconstructed) |
| 6 | D12 byte identity | The `normalize` in `d12-stamp-neutrality.mjs` removes only `kind === "element.stamp"` rows and `dom.action.target.element_key`. `binding_placement` exists only on stamp rows (0 occurrences elsewhere). One build (`af60016a4d45`) serves all three variants.<br>From the recorded files:<br>• A, B and C normalize to the same sha (`ecff86e7…`); chains share `8811c7ea…`;<br>• field diff A vs C with stamp rows removed = only `target.element_key` (21 rows);<br>• stamp rows carry no `sequence`.<br>I reran the test myself: pass, and `normalized-A.jsonl` is byte-identical to the recorded one.<br>Caveat: the fixture is small (21 actions, 3 requests). | pass |
| 7a | Function-id drift "0 unexplained" | I parsed the fixture sources (commit `45cc53c`) with the fixture's TypeScript. All 8,769 new ids are exact function nodes with matching file hash.<br>15 random dropped final7 ids: 14 agree with the implementer's category. The 15th, `McpOAuthDialog.tsx:4925:4937`, is labelled "abstained_not_a_function", but a real function `(value) => !value` exists at 4924:4941 and is **absent from the new manifest**.<br>Across the whole category: **38 of 1,377** "abstained_not_a_function" ids sit on a real function missing from the new manifest (mostly state-updater arrows nested in inline handlers, e.g. `(prev) => !prev`). | "0 unexplained" overstated (38 real functions lost, 0.4%) |
| 7b | Span neutrality | Only the summary `span-neutrality.json` is recorded (8,769 = 8,769, empty `only_on` / `only_off`). The off-build manifest is not in the evidence or in `.scratch/`, so I cannot recompute it. | unverified beyond summary |
| 8 | `npm test` | 605 tests, 604 pass, 1 fail: `react-context-ref-semantics.test.mjs`. It also fails on main `47587bd9`, and the branch does not touch it.<br>No test passes only because of a hardcoded expectation. The new unit tests use synthetic inputs. `attribution-plugin-passes.test.mjs:56` pins the exact rewritten code string (brittle, not fake).<br>No unit test covers receipts or await rejection; those exist only in the browser test, which is not in `npm test`. | pass (known failure) |
| 9 | RUN/LIMITS honesty | See "Claims not supported by raw rows". | several corrections needed |

## Engine findings (probes, neutral fixture)

The probe app and runner were written to my scratchpad, not to the repo. The fixture was built with both Tracer plugins through `test/browser/fixture-build.mjs`, using `.live-demo/librechat-m1/node_modules` for react, vite and playwright. The run is headless. The unowned tickers start *after* load and run through the clicks.

- **P1, no-op setter.** The click calls `setOpen(false)` while `open` is already false. React bails out eagerly and no render happens. A later unowned tick re-renders the same component. The dispatcher wrapper marks the old receipt `rendered`, and the tick commit's effect `useEffect(() => { if (tick) fetch('/api/p1-tick') }, [tick])` is attributed `state_effect` to the click.
  - Reproduced in 5/5 runs.
  - The parent frame is exactly that effect (`app.jsx:1050:1092`).
- **P2, two setters in one action.** `applyReceipts` stops at the first receipted hook of a fiber and deletes only that receipt. The second one stays `rendered: true` and applies at the *next* commit of that fiber, whatever caused it. The tick-driven `/api/p2-tick` effect is attributed `state_effect` to the click in 5/5 runs.
  - `/api/p2-a`, the real effect, is correctly attributed.
- **Control: own effect.** `/api/p4-own` is attributed 16/16, correct.
- **Control: sibling under receipts.** The sibling was attributed 0 times in 3/5 runs.
- **Ambient window (pre-existing).** Unowned timer work that fires between a click and the `hostSetTimeout` clear runs under the bare action frame:
  - the first-party poll fetch is attributed `direct` in 3/5 runs;
  - the ticker's sibling, P1 and P2 effects are all attributed `direct` to an unrelated click in 2/5 runs.
- **Latent path.** `wrapPassiveEffects` mutates `effect.create` in place and never unwraps it. Fibers with `alternate === null` that were mounted in an *earlier* commit and never cloned also match the mount-effect walk. Their mount effects still carry `HasEffect`, so they get wrapped. React reruns stored effect objects on Activity or Offscreen reconnect, so such a wrapper could fire later under an old action. Not observed; by code reading only.

## Claims not supported by raw rows (RUN/LIMITS)

1. **G1 RUN, "0 route/handler/db stops".** True only if the 175 `stopped_at: "handler"` frontend abstentions are excluded. The gate's evidence plan also says every non-request action ends `browser`.
2. **G1 RUN, round-three item 1.** It describes `/api/unrelated` as "a sibling re-rendering in the same commit". It is a *child* of the receipted `Delayed`. The actual sibling (`/api/sibling`) is not in the recorded summary. All sibling, late-mount and poll negatives fire before the first action, so they test nothing about receipts.
3. **G1 RUN drift, "0 unexplained".** 38 real functions on disk were dropped and filed as "not a function".
4. **G1 RUN, agent chat "messages in window".** Those messages were deleted by step 10; only transactions remain.
5. **G1 LIMITS, receipt lifetime.** It omits the no-op-setter and leftover-receipt misattribution paths, and the rejected-await gap.
6. **G3 RUN, own-JSX "646/646 = 100%".** The classifier excludes render-prop, cloned and function-child hosts that do have first-party JSX. The correct figure is about 93–96%.
7. **G3 RUN, OAI validity and interactive coverage.** These are in-page counts. Neither the payloads nor the per-element survey are in the evidence.
8. **Span neutrality.** Only a summary is recorded.
9. **G3 screenshots.** The two screenshots are identical files.

## Commands (run by me)

```
# integrity + G1 recomputation (scratchpad copies of the gunzipped records)
gunzip -c docs/evidence/g1-2026-09-23c/{frontend-only,backend-on}/records.jsonl.gz > $S/<run>.jsonl; shasum -a 256
python3 $S/item1.py <evidence> frontend-only|backend-on    # chains vs rows, contiguity, terminals, backend steps
python3 $S/reqlist.py <run>                               # each request -> owning or preceding action
python3 $S/join.py <evidence>                             # exact trace/parent span joins, handler + DB writes
python3 $S/unattr.py <run>                                # open first-party frames at each unattributed send
python3 (inline)                                          # Playwright observed_requests multiset == Tracer rows
mongosh --quiet mongodb://127.0.0.1:27017/LibreChat --eval '…'   # sessions, conversations, agents, aclentries, messages, transactions
# engine
node test/browser/continuations-neutral.mjs               # passes (exit 0)
node $S/probe/timing.mjs                                  # negatives fire before the first click
node $S/probe/run.mjs  (x5)                               # P1/P2/P3/P4 receipt + ambient probes
node $S/probe/await-run.mjs                               # await semantics + rejection-path attribution
# G3
python3 (inline)                                          # 10-key resolution, 20-row own-site sample, population scan
node $S/probe/oai.mjs + python3 validator                 # live OAI attributes stub / none / stub-without-request
node test/browser/d12-stamp-neutrality.mjs /Users/austinho/dev/trace-consolidated/.live-demo/librechat-m1 $S/d12-mine   # pass, identical to recorded
python3 (inline)                                          # recorded d12 files: normalize, sha, field diff
# drift
node $S/drift.cjs, $S/drift2.cjs                          # TypeScript parse of /tmp/producttrace-librechat-m1-final2 vs final7 + new manifest
npm test                                                  # 605 / 604 pass / 1 known fail
```

Here `$S` is this session's scratchpad. The probe sources are not committed. The core of P1 and P2, for reproduction:

```jsx
function P1(){const[open,setOpen]=useState(false);const[tick,setTick]=useState(0);
  useEffect(()=>{hooks.p1=v=>{if(window.__p1)setTick(v)}},[]);useEffect(()=>{if(tick)fetch('/api/p1-tick')},[tick]);
  return <button onClick={()=>{setOpen(false);window.__p1=true}}>P1</button>}
function P2(){const[a,setA]=useState(0);const[b,setB]=useState(0);const[tick,setTick]=useState(0);
  useEffect(()=>{hooks.p2=v=>{if(window.__p2)setTick(v)}},[]);useEffect(()=>{if(a)fetch('/api/p2-a')},[a]);
  useEffect(()=>{if(tick)fetch('/api/p2-tick')},[tick]);
  return <button onClick={()=>{setA(x=>x+1);setB(x=>x+1);window.__p2=true}}>P2</button>}
// an unowned setInterval(…,30) calls hooks.p1/p2 after load; click each button once
```

## Final assessment

### G1: frontier criterion passes; the engine changes it carries fail. Not mergeable as is.

**Proven, from raw rows:**
- With backend telemetry declared off, every action that made a request ends at `network / backend not instrumented`, and no chain contains a backend step.
- Capture is contiguous and lossless on one page per run. Tracer's requests equal Playwright's, 82/82 and 83/83.
- The four chat POSTs are attributed to their submit or click.
- With telemetry on, exact span joins reach Mongo writes for 7 of 8 mutation flows, and feedback stops at `validateMessageReq`. Mongo confirms the session, conversation plus rename, the agent and its two aclentries, the messages, and (through transactions) the deleted agent chat.
- The nine handlers match final7, with the feedback correction verified against source.

**Not proven, or disproven:**
- The state-update receipts attribute work the action did not cause, in two simple and common patterns: a no-op setter followed by an unrelated re-render, and two setters in one handler. They also accept and "un-bare" ambient bare action frames.
- The shipped negative controls never overlap an action.
- The await rewrite preserves semantics, but it drops the continuation on the rejection path.
- Attribution of the same LibreChat flow varies between runs (post-login batch: 1 vs 18 unattributed).
- "0 unexplained drift" hides 38 real functions that were dropped.

### G3: not passable as a gate (two-repo clause not reached); the parts claimable on LibreChat and the neutral fixture mostly pass.

**Proven:**
- D12 byte identity: recomputed, and rerun deterministically.
- Stamp keys resolve to the exact `<tag` at the recorded file:line (10/10 random keys, 0 key/placement conflicts across 556 rows).
- OAI attributes appear only when `document.oai.annotation.request` exists, and live payloads pass an independent §4.3 validator.

**Not proven:**
- Per-element interactive coverage on LibreChat (only in-page counts are recorded).
- LibreChat's actual payloads (not recorded).
- The "100% own JSX site" figure is wrong: render-prop and cloned hosts such as Save & Submit, Fork and Feedback resolve to the wrapper's JSX.

### Must change before merge

1. **Fix the receipts:**
   - Mark a receipt `rendered` only when the render actually consumed that update. For example, record the update object and check that the hook's queue processed it, or drop receipts whose setter bailed out eagerly.
   - Consume or delete every receipt of a fiber at the commit that applies it.
   - Refuse bare action frames in `receiptSetter`, or restore `current` after dispatch instead of relying on the timer.
2. **Make the continuation negatives real:**
   - Tickers and polls must run *through* the clicks.
   - Add the P1, P2 and rejected-await cases as asserted tests.
   - Put a node-level receipt test in `npm test`.
3. **Rename the frontend credit abstention** so it cannot be read as a backend handler stop (for example a separate `entry_handler` frontier), or amend the gate text. Then restate the "0 handler stops" claim.
4. **Correct G3 RUN's own-JSX figure** and the classifier. Either place render-prop and cloned elements, or count them as a first-party miss.
5. **Correct the drift report:** 38 dropped real functions.
6. **Record in evidence:**
   - the OAI payloads;
   - the per-element DOM survey;
   - the off-build manifest for span neutrality.
7. **Fix the RUN/LIMITS wording** listed above. Add the rejected-await gap and the autofocus pseudo-action / `current`-overwrite behaviour to LIMITS.

---

## Regrade, fifth pass (2026-09-23, branch head `2e0fee9f`; evidence `g1-2026-09-23e/`, `g3-2026-09-23e/`)

The rules were the same as the first grade:

- Everything is recomputed from raw rows with python3, or with node plus the fixture's TypeScript.
- I did not use `g1-grade.mjs`, `g1-unattributed.mjs` or the harness summaries as truth. Package code ran only inside the neutral suite, `npm test`, and my own probes, which build the neutral fixture through `fixture-build.mjs`.
- No fixture or evidence was modified.

Integrity:

- Both `records.jsonl.gz` files match RUN.md:
  - `c11d5a4d…`, 140,476 rows;
  - `024af320…`, 134,917 rows.
- Both manifests match RUN.md: `b7ed23f3…` (on) and `53f698bc…` (placements and awaits off).
- All four G3 per-element files match their RUN.md sha256 values.

### Per-item table

| # | item | recomputed | result |
|---|---|---|---|
| 1a | Receipts: my third-pass probes | I reran my own probe app (not the suite's copy) 5 times. The 30 ms unowned ticker and the 1 ms first-party poll run through every click.<br>• P1 (no-op `setOpen(false)`, then an unrelated re-render): 0 attributed in 5/5 runs.<br>• P2 (two setters, then a later commit): `/api/p2-tick` 0/5; `/api/p2-a` attributed `state_effect` 5/5.<br>• Sibling: 0/5. Poll: 0/5.<br>• P4 (own effect): 16/16 `state_effect`. | fixed |
| 1a′ | **New receipt misattribution** | Variant P1f: the click calls a **functional** no-op updater, `setOpen(o => false)`, while `open` is already false. React bails out eagerly, so nothing renders.<br>The next commit is the ticker re-rendering the same fiber. Because `receipt.functional` short-circuits the `Object.is` check (`src/runtime-attribution-browser.js`, `applyReceipts`), the ticker's `/api/p1-tick` effect is attributed `state_effect` to the click, **5 of 5 runs**.<br>A captured value exists here, so the functional exception is not needed to decide "changed". Common real-world case: `setX(prev => cond ? prev : next)`. | **fail (narrow)** |
| 1a″ | New neutral cases | `node test/browser/continuations-neutral.mjs`: exit 0, 5/5 page loads. I read its assertions:<br>• the negatives now overlap the actions (`overlap` counts, e.g. poll 70, sibling 902);<br>• form-library submit is `direct`;<br>• the timer armed at pointerdown and firing after the click is `null`;<br>• cross-action timer and promise are credited to A;<br>• nested-focus strict-stack spine is asserted;<br>• the `MessageChannel` leak probe is `null`;<br>• the `setInterval` armed at mount is never attributed.<br>My rejected-await probe: the catch path, and a callee that throws, are now both `direct`. `this`, return values, `finally`, `arguments` and concise arrows are unchanged. | pass |
| 1a‴ | Await rewrite semantics (new) | D-G1-12 routes every awaited object through `NativePromise.resolve(v).then(...)`, which adds a microtask tick. Probe, same code instrumented vs `new Function` (not instrumented): microtask order is **`baca2d` instrumented vs `aba2cd` native**.<br>Program semantics for values and exceptions are preserved; **interleaving is not**. The gate mentions "one extra microtask tick"; LIMITS does not call it an observable ordering change. | documented cost, under-stated |
| 1a⁗ | Node-level receipt test | `test/action-context.test.mjs`: 8 tests, 8 pass, inside `npm test`. They cover no-op refusal, P2 consumption, bare-frame receipts, render non-inheritance, creation-time ownership and A-after-B. They do not cover the functional no-op case (1a′). | present |
| 1b | `entry_handler` rename end to end | • Chains: 0 `stopped_at: "handler"` in backend-off chains; 113 `entry_handler`.<br>• `analysis/runtime-attribution.mjs:127`: abstention `stopped_at: 'entry_handler'`.<br>• `analysis/causal-chain.mjs:124` `chainFrontier`: new `entry_handler` frontier (`stop_reason: no_element_bound_handler`).<br>• `mcp/tools.mjs`: passes `chain.frontier.stopped_at` and `renderChainLine` prints it verbatim. `handler` stays the backend span stop.<br>• `test/frontend-only.test.mjs:62` covers the builder.<br>Gap: **no test exercises `chainFrontier`/MCP with an abstention**. That path was checked only by reading the code. | pass (untested MCP path) |
| 1c | Drift, regression, own-JSX | • 15 random drifted ids (seed 5923) classified against source: 15/15 agree with the implementer's category.<br>• Whole-category scan of the 1,327 "abstained_not_a_function": 0 sit on a real function missing from the manifest (was 38).<br>• 8,954/8,954 new ids are exact function nodes with matching hash.<br>• Regression: 34/34 ids present in the manifest.<br>• In `parsers.ts` and `artifacts.ts`, 40 of the 49 function nodes on disk are in the manifest. Of the 9 absent, 8 in `parsers.ts` have no sourcemap mapping in any chunk (tree-shaken, legitimately absent).<br>• **`artifacts.ts:310` `lookupOwn = <T>(record, key) =>`** has mapped lines in `hooks.*.js.map` (it ships) but is absent from the manifest. It is a generic arrow in `.ts`, the case the fix targeted. One real shipped function is missing; it was not in final7 either, so "0 unexplained vs final7" still holds.<br>• Own-JSX: see 5. | pass, 1 residual |
| 1d | Recorded now: payloads, survey, off-build manifest | • `oai-payloads.jsonl`: 1,268 rows, all from the stub session. My own §4.3 validator: 0 invalid, 0 bad labels, `tracer_el` = stamp key on every row. There are 0 no-stub rows.<br>• `survey-elements.jsonl`: recomputed per surface. Stamped / interactive is 68/69, 86/87, 98/99, 81/82 in both variants; **React-rendered: 68/68, 86/86, 98/98, 81/81**. All 8 unstamped hosts are `textarea` with `react: false`.<br>• **Span neutrality recomputed from the two manifests:** 8,954 = 8,954 ids, identical sets and identical source spans; placements 8,198 vs 0; builds `5ff8a34ee267` / `a0ce15c2137b`. | pass |
| 1e | RUN/LIMITS wording | • Round-three wording defects fixed: the agent-chat Mongo line now says transactions; capture now uses an explicit drain; the rejected-await and focus cases are covered.<br>• **New defect:** `unattributed-notes.json` says `/health` is "a timer armed before any action (correctly unowned)". In source (`client/src/data-provider/connection.ts`, via `Root.tsx:48 useHealthCheck(isAuthenticated)`), the timer is armed in an effect when `isAuthenticated` flips after login. It is a recall abstention, not a correctly unowned pre-armed timer.<br>• LIMITS understates two things: the microtask reordering (1a‴) and the React 19 failure mode (6). | minor corrections needed |
| 2 | G1 backend off | • 345 actions = 345 chains; 0 mismatches under my recomputation.<br>• 13/13 request actions end `network \| backend not instrumented`; 0 backend steps; 113 `entry_handler`, 219 `browser`.<br>• Core POSTs:<br>  – send @18220 `state_effect` → submit @15726;<br>  – regenerate @32240 `direct` → @30402;<br>  – edit @47639 `direct` → @44711 (target key `p_289ebfafc16d:6176-6450#n1` = `EditMessage.tsx:190` `<button`, verified on disk);<br>  – agent chat @102255 `state_effect` → @99781.<br>• **Created inside the action:** each POST's spine starts with that action's own entry handler (`ChatForm 17345:18011`, `ContentRender 3465:3490`, `EditMessage 1759:3526`). The `terminal_owner_continuation_id` is the `function.enter` row immediately after the `dom.action` row (seq +1). No request's parent is an exited frame (see 5).<br>• Capture: one page; `sequence` 1..139,684 and `stamp_sequence` 1..792 contiguous; drain `queued 0, inflight 0, dropped 0, rows_after_drain 0, lossless`. (The per-page "expected" in `coverage.json` is still N+1; the drain block is authoritative.)<br>• Playwright raw list = Tracer rows as a (method, path) multiset: 82 = 82. | pass |
| 3 | G1 backend on | • Exact trace/parent joins recomputed: 82/83 requests join (`/health` @1071 does not).<br>• Writes under the handler span:<br>  – login: insert sessions;<br>  – send, regenerate, edit, regenerate #2, agent chat: findAndModify + insert transactions;<br>  – rename: findAndModify;<br>  – agent create: `createAgentHandler` insert agents + findAndModify;<br>  – delete: 6 collections.<br>• Feedback PUT stops at `validateMessageReq` with 0 DB spans under it. **7 writing flows plus feedback at the handler.**<br>• Mongo by hand (20:26:20–20:28:30Z, test user):<br>  – session `6ab435f3…` at 20:26:27;<br>  – conversation `e7ef87f6…` "Tracer M1", created 20:26:29.745, updated 20:26:46.059, 7 messages, 10 transactions;<br>  – agent "Barista 1790195185989" at 20:26:49.267, with aclentries `agent` and `remoteAgent` (permBits 15);<br>  – 4 transactions for `dea356ac…`, whose conversation no longer exists (deleted);<br>  – 0 feedback writes.<br>• Credited handlers equal the corrected table 9/9 in both runs. | pass |
| 4 | 39 unattributed | For each unattributed send I tracked the enter/exit stack: **0 first-party frames open at any send**, so there are no transport-wrapper misses. Ten judged against LibreChat semantics:<br>• boot `/api/config` @1: correct;<br>• `/api/roles/USER` @446, `/api/endpoints` @605, `/api/tags` @686, `/api/keys` @792: downstream of login;<br>• `/health` @1044: downstream of login; the note's reason is wrong (1e);<br>• `/api/messages` @44251: downstream of regenerate; the same stream's earlier follow-ups @35323–25 *are* credited `direct`;<br>• `/api/agents/<id>` @83228 and `/api/permissions/…/effective` @83230: new-agent queries after create;<br>• `/api/agents/chat/status` @117688: after agent chat.<br>All ten except the boot request are **causally downstream abstentions** under the rule. I found none that the creation-time rule itself should have credited: the agent-create `onSuccess` only `setQueryData`s and invalidates marketplace queries, and the new-agent queries come from observers mounting on a re-render.<br>Structural recall hazard: `pendingReceipts.clear()` runs at the end of *any* commit walk. A receipt recorded before an unrelated commit (another lane, another root) is discarded before the owning render, which makes recall timing-dependent (the two runs differ by one `permissions` request). | abstentions, not misses |
| 5 | Leak mechanism | Round four (`g1-2026-09-23d/frontend-only`):<br>• rows @39360–39373 show click 191 → `handleContainerClick` frames 75465/75466 → nested `focusin` 192 → both handler exits;<br>• **7,196 `function.enter` rows have exited frame `75466` as direct parent** (= 14,392 enter + exit rows, matching RUN);<br>• all 16 requests credited to 191 have spine prefix `[ChatForm 6016:6189 ×2]`.<br>Round four also had 4 other leaked frames, including 22,339 children of `319:function:313865` (agent-chat send). RUN mentions only 75466; those credits were to the right action.<br>**Round five, both runs: 0 `function.enter` whose parent function frame had already exited, and 0 requests parented on an exited frame.** | verified |
| 6 | D-G1-15 guard | Code: `effectFlushFrame` (non-bare, non-scheduler), `reactRendering()` from the hooks-dispatcher shape, `reactEventTarget()` from the `_reactListening*` / `__reactEvents$*` keys.<br>**Neutral-fixture recall probe:** click-driven effects in fibers *without* a receipt are credited `direct` when React flushes them on the discrete-event microtask (prop-driven child, context consumer, `useSyncExternalStore` store). The same patterns are **unattributed** when the update is flushed on the scheduler (setter from a timer continuation: child prop effect; `startTransition`: child; context set after an await: consumer). The receipted parent's own effect stays `state_effect`. This is lane-dependent recall loss; no wrong credit observed.<br>**React 19 brittleness, checked against a local `react-dom@19.2.3`:**<br>• React 19 injects `currentDispatcherRef: ReactSharedInternals` and installs dispatchers at `.H` (`ReactSharedInternals.H = ContextOnlyDispatcher`).<br>• `installDispatcherHook` redefines `ref.current`, which React 19 never writes. On React 19, receipts would never be recorded (no `state_effect`/`mount_effect`: the send and agent-chat POSTs would go unattributed) and `reactRendering()` would never fire ("renders never inherit" silently off). Nothing warns.<br>• The listener markers (`_reactListening`, `__reactEvents$`) are unchanged in 19.<br>• Fresh Vite + React templates now ship React 19, so this blocks G2/G5 generality, not LibreChat. | guard ok on 18; **silently inert on React 19** |
| 7 | `npm test` / D12 | • `npm test`: 616 tests, 615 pass, 1 known failure (also fails on main).<br>• D12, recomputed from the recorded files: A/B/C normalize to `b4b14fa7…`, chains `de7d64a6…`; the A-vs-C diff is only `target.element_key` (21 rows).<br>• I reran D12: 17/17, and `normalized-A` is byte-identical to the recorded file.<br>• The 3 fixture requests remain `direct` to their actions. | pass |

G3 own-JSX, item 1c in detail:

- 20 random non-`self` stamp rows (seed 5923):
  - 17 are library-rendered hosts (lucide svg, Ariakit/Radix default hosts);
  - 1 is `render_prop`, `Feedback.tsx:149` `<button>`, correct;
  - 1 is the acknowledged `CellMeasurer` function child;
  - 1 is a `Tooltip.tsx:160` row.
- The Tooltip rows are callers that pass `render={<Ariakit.MenuButton …/>}`, for example `BookmarkMenu.tsx:178`. That is a *component* render prop, not a host one. The `render_prop` rule matches host-type elements only. The Bookmarks and Export buttons therefore resolve to the shared wrapper `Tooltip.tsx:160`, not to the caller's JSX.
- This is consistent with how `first_host` is defined. It is not a host-JSX miss, but it is a weaker answer for an agent: 6 stamp rows, 4 survey rows per surface.
- Population scan of the non-self rows: 3 function-child rows, 0 unmarked host render-prop rows.
- The corrected figure (98.4% of observations, 99.2% of rows) is consistent with what I found.

### Final verdict (fifth pass)

**G1: the gate criterion passes; the engine is close but not merge-clean.**

Proven from raw rows:

- Backend off: every request action ends at `network / backend not instrumented`; 0 backend stops; capture drained losslessly; Tracer = Playwright.
- 4/4 core chat POSTs, each rooted in its own action's entry handler.
- Backend on: 7 writes by exact join, feedback at the handler, and Mongo confirmed by hand.
- 9/9 handlers against the corrected table.
- The round-four leak mechanism is confirmed, and no frame outlives its exit in round five.
- My third-pass misattribution probes no longer reproduce.

Remaining before merge:

1. **Functional no-op updater misattribution** (1a′), 5/5 reproducible. Decide "changed" by `Object.is(rendered, captured)` whenever a captured value exists; add the case to `action-context.test.mjs` and to the neutral suite.
2. **React 19** (6). Hook `ReactSharedInternals.H` when `currentDispatcherRef` has no `current`, or at least detect the mismatch and report `receipts: unavailable` instead of degrading silently. This is required before G2 on any fresh Vite template.
3. Fix the `/health` note, and state the await microtask reordering in LIMITS.
4. Optional: a test of `chainFrontier`/MCP rendering of `entry_handler`; a look at the `lookupOwn` generic-arrow miss.

Items 1 and 2 are small. Once item 1 is fixed and tested, and item 2 is at least guarded with an explicit frontier, I would accept a G1 merge.

**G3: mergeable for what it claims on LibreChat and the neutral fixture; the gate itself is still not reached** (two-repo clause, G2).

- D12 holds (recomputed and rerun).
- The survey, the OAI payloads and span neutrality are now recorded and independently verified.
- The own-JSX figure is corrected and consistent with my sample.
- `every_interactive_host_stamped` is still literally false: one non-React textarea per surface.
- Wrapper-forwarded component render props resolve to the wrapper.

---

## Final focused regrade, sixth pass (2026-09-23, head `b7adfb6e`, evidence `g1-2026-09-23f/`, `ERRATA-e.md`)

Same rules: raw rows only, black box, no implementer graders. Integrity:

- Records match RUN.md: `98bb768d…` (138,688 rows) and `bbffe2a4…` (128,038 rows).
- The manifest matches RUN.md: `7907fc76…`.

| # | check | recomputed | result |
|---|---|---|---|
| 1 | Functional no-op updater (P1f) | My probe (`setOpen(o => false)`, then an unrelated 30 ms ticker re-render), 5 runs: `/api/p1-tick` attributed **0/5** (was 5/5).<br>Controls in the same runs: P2 own effect `state_effect` 5/5; P4 functional `x => x + 1` 16/16 `state_effect`; sibling and poll 0.<br>My original probe: 0 misattributions.<br>The neutral suite (with the new P1f case): exit 0, 5/5; `/api/p1f-tick` fires 835–836 times per run, all unattributed. | fixed |
| 2 | React 18 / 19 | I ran `react-versions-receipts.mjs` against LibreChat's 18.3.1 and the scratch 19.2.4 root. The loaded renderers report `18.3.1-next-…` and `19.2.4`. On both:<br>• `/api/state-effect` is `state_effect`;<br>• `/api/mounted` is `mount_effect`;<br>• `/api/form-submit` is `direct`;<br>• P1f is 0 attributed (148–149 fires);<br>• the no-dispatcher stub (injected twice) gives exactly one `capture.limit` `{state_receipts, "dispatcher not found", "99.0.0"}`.<br>Code (`src/runtime-attribution-browser.js:222–257`): the dispatcher key comes from the renderer's version (≥19 `H`, 16–18 `current`) **and** must exist on the ref (`key in ref`); otherwise one limit row and one warning, and receipts abstain. That is explicit rather than silent.<br>Residual brittleness:<br>• it keys on the major version, so a future React that moves the dispatcher again but keeps `H` present-but-unused would not be detected;<br>• a failing `defineProperty` is swallowed without a limit row;<br>• only the first failing renderer on a page is reported. | pass (19.2.4 accepted) |
| 3 | LibreChat f runs | Both runs:<br>• actions = chains (345 / 346), 0 mismatches;<br>• backend off: 13 `network \| backend not instrumented`, 0 backend steps;<br>• `sequence` 1..137,898 / 1..127,247 and `stamp_sequence` 1..790 / 1..791, contiguous, one page each;<br>• drain `queued 0, inflight 0, dropped 0, rows_after_drain 0, lossless`;<br>• Playwright = Tracer 82 = 82 as a (method, path) multiset;<br>• 0 `capture.limit` rows;<br>• 0 `function.enter` or requests parented on an exited frame.<br>**Core POSTs 4/4 in both** (off: send @18514 `state_effect`, regenerate @32671 `direct`, edit @47832 `direct`, agent chat @101645 `state_effect`; on: @18450 / @29655 / @44852 / @98709, same kinds).<br>**Handlers 9/9 in both** against the corrected table.<br>Backend on:<br>• the exact trace/parent join gives the 7 writing flows at DB, and feedback at `validateMessageReq` with no write;<br>• Mongo by hand (21:34:40–21:36:55Z): session `6ab445f5…`; "Tracer M1" `6f618dc7…` with 7 messages and 10 transactions; "Barista 1790199283710" with aclentries `agent` and `remoteAgent` (15); 4 transactions for the deleted agent-chat conversation.<br>**`gen_title` @23321** (backend on) is an unattributed row with `parent_continuation_id: null`, so it is not a wrong credit. The rows just before it belong to action 193 (a scheduler message and a `state_effect` of `families.ts`), and all of them exited before the send. The only "open" frame is the long-running async `useResumableSSE` stream function (entered @22096, exits @23468). That is an async body, not the synchronous caller, so this is not a wrapper miss.<br>The same request is `state_effect` in the off run: this is the timing-dependent receipt recall I flagged. | pass |
| 4 | 173 new manifest ids | e → f: 8,954 → 9,127 ids, **+173 added, 0 lost**. All 173 are exact function nodes on disk with matching file hash (TypeScript parse by extension).<br>10 random (seed 424242) are all initializer arrows bound to a name, e.g. `api-endpoints.ts:336 textToSpeechVoices = () => …`, `data-service.ts:561 getExpandedAgentById = ({agent_id}) => …`, `useResumableSSE.ts:3406 isCurrentEffect = () => …`. 10/10 exact.<br>Spread: 82 in `api-endpoints.ts`, 31 in `data-service.ts`, 9 in `react-query-service.ts`, …<br>`lookupOwn` (`artifacts.ts:11471:11610`) is present. | pass |
| 5 | `npm test` | 623 tests, 622 pass, 1 known failure (`react-context-ref-semantics`, also failing on main). | pass |

Process note, not a code defect:

- Both f runs were served by a scratch copy of `m1-live.sh` that skips the rebuild. The two scripted starts failed the parity gate on the default model name.
- The recorded parity is one of three manual runs; the other results were one false and one true.
- The build served is the one those starts produced (9,127 functions, consistent with the fix). The parity gate itself is flaky without the chat fixture, and that should be fixed in the harness.

### Verdict

**Merge G1 and G3.**

- G1's pass criterion holds on raw rows in both runs: explicit network frontier and no backend stops with telemetry off; 7 writes plus feedback at the handler, and Mongo, with telemetry on; 4/4 core POSTs; 9/9 handlers; lossless drained capture.
- Every misattribution I produced across four rounds of probes (P1, P2, P1f, the ambient poll and sibling, the nested-focus leak, the rejected await) no longer reproduces. The React 19 dispatcher is handled, with an explicit limit row otherwise.
- G3 merges for what it claims on LibreChat and the neutral fixture (D12 17/17, survey, payloads, resolution). The gate's two-repo clause remains open for G2.

Residual (non-blocking; carry into G2):

1. **Recall is timing- and lane-dependent.** Receipts are cleared at the end of any commit (the `gen_title` flip), and scheduler-flushed downstream effects without a receipt abstain. That leaves 39–40 unattributed per run, none of them wrong credits.
2. **The await rewrite changes microtask interleaving** (documented in the sixth-pass LIMITS).
3. **React internals.** The dispatcher is found by version plus field presence. Listener detection uses `_reactListening` / `__reactEvents$` (present in 18.3.1 and 19.2.4). Recheck on each React major.
4. **Parity flake.** The LibreChat parity gate fails without the chat fixture.
5. **G3 limits.**
   - One non-React textarea per surface is not stamped.
   - The `CellMeasurer` function child is not placed.
   - Wrapper-forwarded component render props (`TooltipAnchor render={<Ariakit.MenuButton/>}`) resolve to the wrapper.
