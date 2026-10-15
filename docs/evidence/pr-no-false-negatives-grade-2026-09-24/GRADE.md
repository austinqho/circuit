# Independent grade: `fix/no-false-negatives` (2026-09-24)

Branch `fix/no-false-negatives` @ `cfb394cd`, 5 commits on `main` `ff9210ee` (merge-base = main tip). Worktree `/Users/austinho/dev/tracer-pr1`. Grader did not modify code. The only file written in the repo is this one. Scratch copies (a `git archive ff9210ee` tree for main, evidence copies, ad-hoc scripts) lived in the session scratchpad.

**Verdict: merge with changes.** The three claims hold on the evidence. One regression and one coverage gap should be fixed before merge (C1, C2). The rest are wording and doc items. The branch conflicts with other in-flight branches in both text and meaning, so merge order matters (see the last section).

## Per-item table

| # | Item | Result | Evidence |
|---|---|---|---|
| 1a | Diff review: `SCOPED_ABSENCE` (`analysis/runtime-attribution.mjs:29`) is the only source of the absence sentences | PASS | Used at `:139` (abstention), `:327` (rejected submit, episode frontier), `:353` (request-less episode frontier), `:596` (`buildActionChains`), and in `causal-chain.mjs` `FRONTIER_BECAUSE` / `chainFrontier:136-137`. No old sentence is left in code (`git grep` for "made no request", "produced no request", "no element-bound handler ran", "only a DOM mutation", "was witnessed for this dispatch" matches only docs and comments). |
| 1b | `unlinked` attach (`causal-chain.mjs:81`) is a listing only; `chainFrontier` never reads `unlinked` | PASS | `chainFrontier` (`:104-138`) reads only `chain`, `terminal`, `handler_abstention` and `entry_handler`. The Node test `unlinked evidence never changes reached, stopped_at, because or the chain` deep-equals the chain with and without the index. On final7, 41 chains gain `unlinked` and `reached` does not change on any of the 54 actions. |
| 1c | Window index (`causal-chain.mjs:140-220`) | PASS, with a doc mismatch (D2) | Requests are selected by `sequence` in (first own dispatch, next non-episode dispatch after the episode's **last** dispatch). Spans are selected by timestamp over the same window. See section 2. |
| 1d | Runtime (`src/runtime-attribution-browser.js` :8, :307, :687, :1010-1036) | PASS | `capture.page` is emitted at install (sequence 1). Per-kind `emittedByKind` is counted in `emit`. A throwing host hook now counts toward `host_errors` instead of being swallowed. `captureSummary` is exposed and a pagehide listener emits it (skipped when the summary is already the last row). |
| 1e | `integrations/collector-sink.mjs:143` asks for the summary before the beacon | PASS | In the browser run, `capture.summary trigger=pagehide` arrives in both pages' stores. |
| 1f | `collector/coverage.mjs`, `collector/index.js`, `collector/store.mjs` :224-227, :264 | PASS, with gap C2 | Coverage is computed only from `capture.*` rows. See section 3 for the one case where it reports `complete: true` wrongly. |
| 1g | `mcp/tools.mjs` :160, :175, :214, :374, :390 | PASS | `action_chain` gets `unlinked`, `coverage` and extra summary lines. `element_history` / `recent_actions` get `coverage` and `unlinked_counts`. Nothing feeds `attempts` or `outcome` (`attempts` are built from explicit fields, `:348-350`). |
| 1h | `dist/` byte-identical | PASS | `npm run build` printed "built byte-identical runtime (304724 bytes)". `shasum dist/*` matched before and after, `cmp src/… dist/…` is identical, and `git status` stayed clean. |
| 1i | Vocabulary change is recoverable from `reached` + `because` | PASS for `action_chain` readers; **FAIL for `compare_chains`** (C1) | `reached` keeps `dom_mutation` / `entry_handler` / `dispatch`, and `stop_reason` keeps submit vs click (`no_request_or_validation_effect_after_submit` vs `no_effect_after_dispatch`). But `compare_chains` compares `outcome.stopped_at` and not `reached`, so a DOM-mutating chain and a dispatch-only chain now compare as "unchanged". Reproduced below. |
| 2a | `node --test test/no-false-negatives.test.mjs` | PASS 8/8 | |
| 2b | `node test/browser/unlinked-coverage-neutral.mjs` | PASS 13/13 | Rerun once more with store retention, and the records were inspected (section 2). |
| 2c | Windowing rule verified independently, including a later-window request | PASS | Section 2, adversarial case 1. |
| 3a | `unlinked` cannot be read as a join | PASS (wording nit W1) | Every entry carries `attribution: "none (observed during this action's window; timestamps only order, not a join)"`. The heading reads "Observed during this action's window, not linked to it (timestamps only order, not a join):". The first summary line (the frontier) does not change. |
| 3b | `unlinked_counts` do not feed attempts or outcomes | PASS | `elementHistory` attempts copy `entry_handler, request, route, outcome, reached, stopped_at, because, summary` only. `compare_chains` does not read `unlinked`. |
| 3c | `complete` cannot be true when `capture.summary` is missing, or when received > emitted | PASS | Summary missing gives `complete:false` with the reason "no capture.summary row: …". Duplicates give `complete:false` with "1 duplicate sequence(s) received" and "emitted 1 dom.action row(s), received 2". |
| 3d | Rows lost after the collector counted them | **FAIL** (C2) | A row removed from the store after `capture.received` still gives `complete: true, reasons: []`. |
| 4a | `test/g4-grader.mjs` | PASS 81/81 | |
| 4b | `test/g6-grader.mjs` | PASS 6/6 | |
| 4c | `action_chain` diff, main vs branch, final7 (all 54 actions; 10 shown) | PASS | `reached` is unchanged on 54/54. `stopped_at` changes only `dispatch`→`browser` (8) and `dom_mutation`→`browser` (33). No key was removed. Added keys are `coverage` (54) and `unlinked` (41; none lists anything). The "Coverage incomplete" line appears on 54/54 with the single "no coverage rows" reason. |
| 4d | `npm test` | 648 pass / 1 fail of 649 | The failure is `different context objects never borrow a Provider value…` (`test/react-context-ref-semantics.test.mjs`). It fails identically on a `main` tree (6 pass / 1 fail). |
| 4e | `g1-grade.mjs` / `g2-report.mjs` string updates (not run by the author) | PASS (run here on copies) | g1: on a copy of `g1-2026-09-23f/frontend-only`, I ran `g1-chains.mjs --backend=off` then `g1-grade.mjs --backend=off`: `pass: true`, 345 actions, 0 mismatches, terminal keys are the new scoped strings. g2: on a copy of `g2-anything-llm-2026-09-23-bridgeoff` (10 abstentions), the report renders and `entry_frontiers` carries the new abstention string. |
| 5 | Docs | PASS with stale text (D1) | `G1-frontend-only.md:135` and `G4-mcp.md:241` carry the amendments and the schemas. The SKILL.md frontier bullet matches the new wording. Older text above the amendments still states the old vocabulary. |

## Commands and outputs

```
$ npm run build
built byte-identical runtime (304724 bytes)          # shasum dist/* unchanged; git status clean

$ node --test --test-reporter=tap test/no-false-negatives.test.mjs
# tests 8  # pass 8  # fail 0

$ node test/browser/unlinked-coverage-neutral.mjs      # dependency root .live-demo/librechat-m1 (read-only)
PASS A0 … A8, PASS B0 … B3
13/13 checks pass

$ node test/g4-grader.mjs docs/evidence/m1-2026-09-22-final7 --manifest docs/evidence/g4-mcp-2026-09-23/manifest.json --out <scratch>/g4.md
Result: 81/81 checks pass

$ node test/g6-grader.mjs docs/evidence/g6-anything-llm-2026-09-23/store --compare docs/evidence/g6-anything-llm-2026-09-23 --out <scratch>/g6.md
Overall: PASS (6/6 pairs).

$ npm test
ℹ tests 649  ℹ pass 648  ℹ fail 1   (react-context-ref-semantics; also fails on main: 6 pass / 1 fail)

$ node test/browser/g1-chains.mjs <copy of g1-2026-09-23f/frontend-only> --backend=off --manifest=<attribution-manifest.json>
$ node test/browser/g1-grade.mjs  <same copy> --backend=off --final7=docs/evidence/m1-2026-09-22-final7/coverage.json
"pass": true, "actions": 345, "mismatches": 0
```

## 2. Browser records, inspected

Rerun of the browser test with the store kept (a copy of the script with absolute imports and no cleanup). Two pages: A (full delivery) and B (first ingest batch aborted 5 times).

Page A `s_2dfdc66d`, 21 rows:
- `seq 1 capture.page`, with `wrappers {fetch, xhr, eventsource, websocket: true; worker, beacon: false}`, `transport_rows: "runtime"`, `build: null`, `react_versions: []`. That is what is known at install; the summary fills them in later.
- `seq 2 focusin`, `seq 3 click` (Toggle), `seq 8/9 dom.mutation`, **`seq 10 network.request action_id=null /api/third-party fetch reason=unattributed_transport`**, `seq 11/12` Other, `seq 17 capture.summary`.
- `capture.summary`: `trigger: "pagehide"`, `emitted_by_kind {capture.page:1, dom.action:4, function.enter:4, function.exit:4, dom.mutation:2, network.request:1, capture.summary:1}`, `last_sequence 17`, `stamps_emitted 3`, `dropped 0`, `host_errors 0`, `build 1f5f95d7ef1d`, `react_versions ["18.3.1-…"]`.
- `capture.received` (collector clock, unsequenced, `run_id`): `received_by_kind` equals `emitted_by_kind`, `unsequenced_by_kind {element.stamp: 3}`, `first 1 / last 17 / distinct 17`, `gaps []`.
- Toggle click, `action_chain`:
  ```
  click … → handler function:ff2c…:305:333: reached dom_mutation / stopped at browser / because no request observed from instrumented code (uninstrumented scripts, workers and third-party code are not seen)
  Observed during this action's window, not linked to it (timestamps only order, not a join):
  - request GET /api/third-party (fetch, sequence 10, no action_id); attribution: none (observed during this action's window; timestamps only order, not a join)
  ```
  The window runs from `from_sequence 2` (focusin, same episode) to `until next_dispatch seq 11`. `coverage {complete: true, reasons: [], unobserved: ["worker","beacon"]}`.
- The Other click has `reached entry_handler / stopped at browser` and `unlinked.requests_total 0`, with a window of seq 11 to `page_end`. It does not inherit seq 10.

Page B `s_3c9d9f1b`: the aborted batch carried `capture.page` and 3 stamps. The sink reported `dropped 4`. `capture.received` has `first_sequence 2`, `gaps [[1,1]]`, `stamps 0`. Coverage is `complete: false` with these reasons, which the `action_chain` summary repeats:
`no capture.page row …; sequence gaps: 1 (1 row(s) emitted but not received); emitted 1 capture.page row(s), received 0; emitted 3 element.stamp row(s), received 0; the page sink dropped 4 row(s) after retries`.

Windowing checks (scratch script, branch code):
1. **Later-window request.** `a1 click seq1, a2 click seq3, unattributed request seq5` gives `a1.unlinked.requests = []` and `a2.unlinked.requests = ["/late"]`. An earlier chain never lists a request that belongs to a later action's window. PASS.
2. **Interleaved foreign dispatch.** Episode `{f1 seq1, f2 seq6}`, with a foreign dispatch `b seq3` and an unattributed request at seq4. The episode's window runs from 1 to the next outside dispatch **after f2** (`c seq9`), so `/during-b` is listed under both the episode and `b`. The doc (G1 amendment, G4 §3.1) says "before the next dispatch on that page outside the episode", which most readers would take as `b`. Both listings carry `attribution: none`, so this is not a false join, but the doc and the code disagree (D2).
3. Spans: membership is `(trace_id, parent_span_id)` not matching any request's `trace_context`, with the start time inside the window. The Node test covers joined, unjoined-in-window and unjoined-after-next-dispatch spans. Spans are **not page-scoped**, so in a multi-page store the same unjoined span can appear under chains on several pages. The `page_end` window runs to the page's last row timestamp, which is the collector's `capture.received` time at run close, not the page's own last row (R2).

## 3. Adversarial

| Case | Result |
|---|---|
| `capture.page` and received present, no summary (page closed without flush) | `complete:false`, "no capture.summary row: the page never reported its emitted totals …" |
| Duplicate batch received (received > emitted) | `complete:false`, "1 duplicate sequence(s) received" and "emitted 1 dom.action row(s), received 2" |
| Rows after the last summary | `complete:false`, "N row(s) emitted after the last capture.summary …" (Node test) |
| Two summaries (sink installed after the runtime, or bfcache) | `complete:true`. Correct: the last summary counts the first. |
| A forged `capture.received` row inside an ingest body | Ignored by the tally (`rows_received` 3, not 999) |
| **A row counted by the collector but missing from the store** (truncated `records.jsonl`, a line dropped as malformed by `loadStore`, manual edit) | **`complete:true, reasons: []`** (C2). `pageCoverage` compares summary against receipt and never against the rows actually loaded. `loadStore` does count `malformed_records`, but coverage does not read that count. |
| Could `unlinked` read as a join? | The `attribution` string, the heading and the counts-only form elsewhere say no. Wording nit W1: the frontier sentence says third-party code is "not seen", while the listing right below it shows a third-party request the wrapper did see. |
| `compare_chains` on two request-less actions (one DOM mutation, one dispatch-only) | **main:** `path_changed: true`, "outcome stopped_at "dom_mutation" → "dispatch"". **branch:** `path_changed: false`, "runtime path unchanged; outcome unchanged". `reached` differs (`dom_mutation` vs `dispatch`) but is not compared (C1). |

## 4. `action_chain` main vs branch, final7

All 54 actions, computed in one process from a `git archive ff9210ee` tree and the branch. `reached` is unchanged on 54/54. The only changed fields are `stopped_at`, `outcome.stopped_at`, `because`, `chain.terminal.because` and `summary`, plus the additive `coverage` / `unlinked` / `chain.unlinked`. `stops`, `requests`, `episode_*` and the rest of `outcome` are identical.

| action | main reached / stopped / because | branch |
|---|---|---|
| `action:mud8rf0f:1` | dispatch / dispatch / no request or DOM mutation was witnessed for this dispatch | dispatch / **browser** / scoped `no_request` |
| `action:mud8rf19:3` | dom_mutation / dom_mutation / only a DOM mutation receipt was witnessed; the dispatch made no request | dom_mutation / **browser** / scoped |
| `action:mud8squl:7` | entry_handler / dispatch / no request or DOM mutation … | entry_handler / **browser** / scoped |
| `action:mud8t518:24` | dom_mutation / dom_mutation / … | dom_mutation / **browser** / scoped |
| `action:mud8u83e:37` | dom_mutation / dom_mutation / … | dom_mutation / **browser** / scoped |
| `action:mud8sc1x:9` | db / null / database write findAndModify messages … | unchanged |
| `action:mud8tqrr:34` | db / null / … | unchanged |
| `action:mud8sw9p:16` | db / null / database write findAndModify conversations … | unchanged |
| `action:mud8smva:4` | db / null / … | unchanged |
| `action:mud8rf0j:2` | dispatch / dispatch / … | dispatch / **browser** / scoped |

Every changed action:
- `dispatch → browser` (reached `dispatch`): `mud8rf0f:1`, `mud8rf0j:2`, `mud8squh:6`, `mud8t53w:25`.
- `dispatch → browser` (reached `entry_handler`): `mud8squl:7`, `mud8squn:8`, `mud8squr:9`, `mud8sw9o:15`.
- `dom_mutation → browser` (reached `dom_mutation`), 33 actions: `mud8rf19:3`, `rf21:4`, `rf22:5`, `s7y1:7`, `sa9i:1`, `samh:2`, `sb15:3`, `sb3w:4`, `sbjd:5`, `sbvl:6`, `sbzf:7`, `sc0n:8`, `skt7:1`, `sl82:2`, `sqoh:5`, `squv:10`, `svht:12`, `sw3a:13`, `sw7f:14`, `szl9:18`, `t3zk:20`, `t450:21`, `t4gi:22`, `t4we:23`, `t518:24`, `t53x:26`, `t56z:27`, `t56z:28`, `tqos:31`, `tqqc:32`, `tqr1:33`, `u7j1:36`, `u83e:37` (all prefixed `action:mud8`).

Every action gets the extra summary line `Coverage incomplete for page <id>: no coverage rows for this page (capture.page, capture.summary, capture.received): recorded before coverage existed, or none were delivered; delivery cannot be proven` (54/54, single reason).

## Full list of vocabulary and string changes

Frontier values (`chainFrontier`, which feeds every MCP tool):
1. `stopped_at: "dom_mutation"`, `because: "only a DOM mutation receipt was witnessed; the dispatch made no request"` → `stopped_at: "browser"`, `because: SCOPED_ABSENCE.no_request`. `reached` stays `dom_mutation`.
2. `stopped_at: "dispatch"`, `because: "no request or DOM mutation was witnessed for this dispatch"` → `browser` + `no_request`. `reached` is `dispatch` or `entry_handler`.
3. `stopped_at: "dispatch"`, `because: "the submit produced no request and no validation mutation"` → `browser` + `no_request`. The distinction now lives only in `stop_reason`.
4. `stopped_at: "dispatch"`, `because: <stop_reason with _ as spaces>` or `"no terminal evidence"` (fallback) → `browser` + `no_request`.
5. `stopped_at: "validation"`, `because: "the submit produced no request and the same form mutated (validation)"` → `"no request observed from instrumented code (uninstrumented scripts, workers and third-party code are not seen) after the submit, and the same form mutated (validation)"`.
6. Abstention `because: "no element-bound handler ran; global listeners: [..]"` → `"no element-bound handler observed in instrumented code (uninstrumented and third-party handlers are not seen); global listeners: [..]"`. This comes from `indexEntryHandlerUnits` and flows to `buildActionChains`, `chainFrontier` and the viewer.

Chain builder and episode evidence:
7. `buildActionChains` request-less `because: "no request observed"` → `SCOPED_ABSENCE.no_request`.
8. `describeEpisodeEvidence` request-less `frontier.because: "no request observed"` → `no_request`. This also changes `chain.terminal.because` and the viewer's display frontier.
9. `describeEpisodeEvidence` rejected `frontier.because: "submit rejected by the app"` → `"submit rejected by the app: no request observed from instrumented code (…) and the same form mutated"`.
10. `submit.rejected` step `admission_reason: "submit produced no request and was followed by a mutation receipt on the same observed form"` → `"no request observed from instrumented code after the submit, and a mutation receipt followed on the same observed form"`. It appears in the `validation` stop of `action_chain` / `compare_chains`.

New strings and fields:
11. `UNLINKED_ATTRIBUTION`, `UNLINKED_HEADING`, `unlinked.window_status` values, and the render lines `- request …` / `- server span …`.
12. The `Coverage incomplete for page <id>: <reasons>` summary line (action_chain only), `COVERAGE_SCOPE`, and the reason templates in `collector/coverage.mjs`.
13. `outcome.stopped_at` (compared by `compare_chains`) inherits items 1-4.

Record-level changes:
14. New row kinds: `capture.page` (sequence 1 on every new page, so **every later sequence shifts by +1**; `element-stamps.test` was updated for this), `capture.summary` (sequenced) and `capture.received` (collector-written, unsequenced, `run_id`). The JSONL (non-store) collector also appends `capture.received` at close (`package.test` expects 2 → 3 lines).
15. The runtime API gains `captureSummary` and `runtimeVersion` (`0.1.0+coverage.1`).

Consumers checked:
- `test/browser/server.mjs` (viewer) calls `buildEpisodeChain` without `unlinked`, so it gets no listing. It only displays `because` text and matches no strings.
- `compare_chains` stop alignment (`stopMap`) uses request, route, handler and db only, so it is unaffected. The **outcome delta** is affected (C1).
- g4 and g6 graders only assert `network`, `handler`, `null` and `db`, so they are unaffected (81/81, 6/6).
- g5-grader asserts `handler` / `route` / `network` / `null` only.
- g1-grade, g2-report, continuations-neutral, frontend-only.test and mcp-entry-handler.test were updated.
- `plugin/AGENTS-snippet.md` is generic.
- No `.d.ts` enumerates `stopped_at`.

## Required changes before merge

- **C1 (regression, `mcp/tools.mjs` `compareChains`).** Add `reached` to the outcome comparison: put `reached` in `outcome` (it is additive) and in `fields`, or compare `frontier.reached` directly. Without this, a frontend change that stops a DOM mutation (or starts one) on a request-less action reports "runtime path unchanged", where main reported `path_changed: true`. Add a Node test for it.
- **C2 (coverage over-claims, `collector/coverage.mjs` / `store.mjs`).** Before saying `complete: true`, check that the rows loaded for the page match `capture.received`: per-kind counts of sequenced rows actually present, `distinct_sequences`, and stamp count. Also add `store.load.malformed_records > 0` as a store-level reason. Today, a truncated or partly unparseable `records.jsonl` still shows `complete: true`, which breaks the claim "coverage is provable from records alone".

## Recommended (can follow)

- **W1 wording.** "uninstrumented scripts, workers and third-party code are not seen" is contradicted by the listing right below it: the runtime's fetch wrapper *did* see the third-party request, it just could not attribute it. A more accurate phrase would be "no request attributed to this action from instrumented code (requests from uninstrumented scripts, workers and third-party code cannot be attributed; see unlinked)". The same applies to `no_bound_handler`.
- **D1 stale docs.** `G1-frontend-only.md:26` (the definitional table still says `because: "no request observed"`), `:77` and `:133`, `G4-mcp.md:237` (the vocabulary line still lists `dom_mutation` / `dispatch` as `stopped_at` values) and `:239`, and `G2-generality.md:126,130`. They are superseded only by a later amendment. Update them in place or strike them.
- **D2 window wording.** Document that the window ends at the next outside dispatch *after the episode's last dispatch*, so a foreign action interleaved inside an episode can have its unattributed requests listed under both. Alternatively, cut the window at the first outside dispatch.
- **R2.** Scope unlinked server spans to the page's window more tightly: end the `page_end` window at the page's own last runtime row, not at `capture.received`. Consider noting in the heading that spans are not page-scoped.
- The collector tally counts a batch before `store.appendRecords`. If the append throws, the rows are counted as received but were never stored. C2's cross-check would catch this.

## Residual risks

- The server-span window compares server-clock start times with browser-clock dispatch timestamps. This is labelled "timestamps only order", but skew can put a span in the wrong action's listing (a hint only, never a join).
- `unlinked` exposes `trace_id` and `request_occurrence_id` per entry. A careless consumer could still treat those as linkage. The attribution string is the only guard.
- Coverage covers runtime rows on `/ingest` only. Spans (`/spans`) and bridge-transport pages (`transport_rows: "bridge"`) always report incomplete or not covered. That is honest, but every bridge store will show "Coverage incomplete".
- Every old store shows "Coverage incomplete" on every `action_chain`. That is intended, but the line is noisy for agents reading pre-coverage evidence.
- `capture.page.wrappers.worker` is hard-coded `false`. That becomes untrue as soon as `fix/worker-frontier` lands (see below).
- The sequence shift (+1 from `capture.page`) breaks any external script that assumes the first action is `sequence: 1`.

## Merge ordering

This branch changes the stop vocabulary that other in-flight branches assert. From `git diff main...<branch>`, all on base `ff9210ee`:

- **`fix/worker-frontier` (tracer-pr6): semantic conflict, must be reconciled.** It adds its own unlinked mechanism in `causal-chain.mjs` / `runtime-attribution.mjs` / `mcp/tools.mjs` / `store.mjs`. It uses different field names (`unlinked_server_spans`, `unlinked_window`), a different string (`UNLINKED_RELATION = 'observed during window; not a join'`), a different membership rule (trace id absent from every request, vs this PR's `(trace_id, parent_span_id)`) and a different window helper (`actionWindow`). It also adds `stopped_at/reached: "worker"` to `chainFrontier`. After both land, one chain could carry two differently-worded unlinked listings, and `capture.page` would still say `worker: false`. Recommendation: **merge this PR first**, then rebase worker-frontier to (a) put the worker stop ahead of the `browser` fallback in `chainFrontier`, (b) feed its spans through `indexUnlinkedEvidence` with one attribution string, and (c) set `wrappers.worker` to reflect the postMessage wrapper (and say what stays unobserved inside the worker). If worker-frontier is ready first, the reverse order works, but this PR must then drop its duplicate span listing.
- **`fix/no-cross-control-merge` (tracer-pr4).** Its grade, docs and G4 §2.1 / G5 §15 text say dialog and menu openers "stop at `dom_mutation`". After this PR they report `reached dom_mutation / stopped at browser`. Its test already accepts both (`['dom_mutation','browser'].includes(...)`), but its evidence prose and doc edits need updating on rebase. Its also touches `runtime-attribution.mjs`, G4 and the runtime source, so expect textual conflicts and a `dist` rebuild.
- **`fix/shadow-dom-context` (tracer-pr5).** Its new test asserts `open.because === 'no request observed'`, which **will fail** after this PR, and `notEqual(lockChain.because, 'no request observed')`, which becomes vacuous. Its closed-shadow abstention sentence should adopt the scoped phrasing. It also touches `causal-chain.mjs`, `runtime-attribution.mjs`, G1 and the runtime source.
- **`fix/mcp-rendering` (tracer-pr2), `fix/stable-element-keys` (tracer-pr3).** Textual conflicts in `mcp/tools.mjs` (`chainStops` / `compactAction` / `actionChain` / `compare_chains` before/after), `collector/store.mjs`, `SKILL.md`, `G4-mcp.md` and the runtime source (`dist` rebuild). There is no vocabulary dependency beyond `validation`. mcp-rendering adds `outcome` to the compare before/after, which is where C1's `reached` fix should land if it merges first.
- **`fix/esm-loader-hook` (tracer-pr7).** No overlap.

Suggested order: this PR (with C1 and C2) → worker-frontier (reconciled as above) → shadow-dom-context and no-cross-control-merge (string and prose updates) → mcp-rendering and stable-element-keys (textual rebases). Each rebase reruns `npm run build` (the byte-identical check), `npm test`, g4 81/81 and g6 6/6.

## Regrade 2026-09-24 (head `550420d9`)

I reran every check from the first grade against `550420d9` ("Grade fixes: …"). I did not modify code. This section is the only change to this file.

| Check | Result | Evidence |
|---|---|---|
| C1 `compare_chains`, dom_mutation (before) vs dispatch-only (after) | **PASS** | main: `changed ["stopped_at"]`, `path_changed true`. Branch: `outcome_delta.changed ["reached"]`, `path_changed true`, "runtime path changed (outcome): ; outcome reached "dom_mutation" → "dispatch"". |
| C1, reverse direction (dispatch-only vs dom_mutation) | **PASS** | `changed ["reached"]`, `path_changed true`. Control (dom_mutation vs dom_mutation): `changed []`, `path_changed false`, so no spurious change. |
| C2, one middle line removed from `records.jsonl` (`network.request`) | **PASS** | `complete:false`, with reasons "the store holds 0 network.request row(s) for this page; the collector received 1" and "the store holds 4 distinct sequence(s) …; the collector received 5". |
| C2, truncated store (2 rows before `capture.received` removed) | **PASS** | `complete:false`: no capture.summary row, a `capture.summary` shortfall 0/1, a `dom.action` shortfall 1/2, and distinct sequences 3/5. |
| C2, one line garbled in place | **PASS** | `complete:false`: the `network.request` shortfall, the distinct-sequence shortfall, and "the store's records.jsonl has 1 malformed line(s) …". |
| C2, garbage line appended to an intact store | **PASS** | `complete:false`, with only the malformed-line reason (every page). The intact store remains `complete:true` with no reasons, so a complete store is still reported as complete. |
| G4 grader | **PASS 81/81** | `node test/g4-grader.mjs docs/evidence/m1-2026-09-22-final7 --manifest docs/evidence/g4-mcp-2026-09-23/manifest.json` |
| G6 grader | **PASS 6/6** | `node test/g6-grader.mjs docs/evidence/g6-anything-llm-2026-09-23/store --compare docs/evidence/g6-anything-llm-2026-09-23` |
| `npm test` | **650/651** | The one failure is the known `react-context-ref-semantics` test (it also fails on main). `test/no-false-negatives.test.mjs` passes 10/10. |
| Browser test | **13/13** | `node test/browser/unlinked-coverage-neutral.mjs` |
| `dist/` | **PASS** | "built byte-identical runtime (304724 bytes)" and a clean tree. `src/` and `dist/` did not change in this commit. |
| Stale doc lines (D1) | **PASS** | `G1-frontend-only.md:26`, `:77`, `:133`, `G4-mcp.md:237`, `:239` and `G2-generality.md:126`, `:130` now state the new vocabulary. G4:237 says "`stopped_at` is never `dom_mutation` or `dispatch`; those remain values of `reached`". |
| Window and span scoping (D2, R2) | **Documented** | G4:255 states that the window ends at the first outside dispatch after the episode's last dispatch, that an interleaved action can be listed under both chains, that spans are not page-scoped, and that `page_end` runs to collector close. The behaviour itself did not change, which is acceptable because it is documented and only lists evidence, never joins it. |
| Wording (W1) | **PASS** | `SCOPED_ABSENCE.no_request` = "no request could be attributed to this action from instrumented code (requests from uninstrumented scripts, workers and third-party code cannot be linked; any seen in this window are listed below as unlinked)". The rejected-submit sentences append it. SKILL.md matches. |

Remaining nits (none blocks the merge):
- `causal-chain.mjs:67`: the `submit.rejected` `admission_reason` still reads "no request observed from instrumented code after the submit, …". This is the old phrasing, not the agreed sentence.
- `SCOPED_ABSENCE.no_bound_handler` still says handlers "are not seen". This is the same over-claim W1 fixed for requests, but it is accurate enough, because uninstrumented handlers produce no `function.enter`.
- "listed below as unlinked" is part of the frontier sentence, so it also appears in:
  - `element_history` / `recent_actions` summaries, where only `unlinked_counts` are shown;
  - chains whose `unlinked` is empty, where nothing is listed below.

  The sentence is still true in these places, but it points to a listing that does not exist there.
- `fix/shadow-dom-context` asserts `because === 'no request observed'`. After this merge it must match the new sentence. The merge-ordering notes above are otherwise unchanged. Reconciling `fix/worker-frontier`'s separate unlinked mechanism is still the main post-merge task.

**Final verdict: merge.** C1 and C2 are fixed and tested. I reproduced both independently, including a garbled-line case and a reverse-direction case that the author's tests do not cover. All regression gates hold (G4 81/81, G6 6/6, `npm test` 650/651 with the known failure, browser 13/13, `dist/` byte-identical). Merge this branch before the other in-flight branches, as recommended above.
