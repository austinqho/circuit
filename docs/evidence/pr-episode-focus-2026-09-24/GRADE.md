# Independent grade: fix/episode-focus (2026-09-24)

Grader: independent agent. It did not write the branch and did not use the author's RUN.md, test names or reports as evidence. Everything below was recomputed from raw rows and from the MCP server driven over stdio as a black box. The one exception is the harness helper `test/browser/fixture-build.mjs`, which was used only to build the fixtures.

- **Head graded:** `2da99996`. The branch log from `fixes-2026-09-24..HEAD` was 8 commits (`8179264b` … `80b75af1`) at start. `7c4ed9f0` and `2da99996` landed during grading, and the head was re-checked before this commit.
- **Base for comparisons:** tag `fixes-2026-09-24` (`8a84cfee`), extracted with `git archive` into a scratch directory. `main` (`9a8496fb`) differs from the tag only in `package.json` and `test/package.test.mjs`, so it has no engine change.
- **Grader probes:** under `grader-scratch/`, untracked and not committed. They cover the fixture, the drivers, the raw rows, the MCP dumps and the diff scripts.

## Verdict: **merge with changes**. Change 1 blocks merging.

Rules 1 and 3 hold on every case the author tested and on every probe I added except one. The exception breaks rule 2 (Tab keeps folding), which the claim depends on. When an action frame is left current by a native suspension (`for await` over a streamed `fetch` body, which the await rewrite does not cover by design), a real Tab focus is marked `gesture: false` with a **wrong** `caused_by_action_id`. The fold into the Enter is lost, and the Tab focus is listed as the click's work. This happens 3 of 3 runs, and `main` gets the same rows right. Doctrine says wrong credit is worse than abstention. The author's residual risk calls this theoretical; it reproduces on a common streaming-read pattern.

## Per-item table

| item | verdict | raw evidence |
|---|---|---|
| **Rule 1: caused focus is marked, never starts or folds into a later episode** | **holds** on all tested and probed causes | Author driver, rerun by me (`grader-scratch/author-runs/run-{1,2,3}`, 3/3 identical signature). Run-1 rows: (a) autoFocus: seq 6 `focusin` `action:muft49fg:3` `gesture:false`, `caused_by_action_id: action:muft49fe:2` (the click, seq 3), `caused_via: microtask`. (b) useEffect focus: seq 28 `action:muft4a65:7` caused by click `action:muft4a63:6`, `mount_effect`. (c) handler `input.focus()`: seq 50 `action:muft4avy:11` caused by click `action:muft4avy:10`, `dispatch`; the Enter seq 53 `action:muft4bcp:12` owns `POST /api/notes`. (f) scheduler: seq 77 `action:muft4cjl:19` `caused_by_action_id: null`, `cause_abstained: scheduler_lineage`. In every case the Enter's episode is `[Enter]` only and the focus is in no episode. |
| **Rule 2: unmarked trusted focus folds (Tab, pointer)** | **fails in one reproducible case**; holds otherwise | Holds: author (d) seq 61 `action:muft4btr:15`, no mark, episode `[focusin, keydown:Enter]` carried by the Enter. Probes P5 and P9 below also hold. **Fails:** probe P12/P13 (`grader-scratch/out-p12/run-{1,2,3}`). The click `action:muftf19z:2` starts `for await (const chunk of res.body)`. During the stream the user Tabs into an input: seq 9 `focusin` `action:muftf255:5` is `gesture:false`, `caused_by_action_id: action:muftf19z:2`, `caused_via: await`, `caused_by_continuation_id: continuation:action:muftf19z:2:await:7`. The Enter seq 10 (`POST /api/p12/search`) gets episode `[Enter]` only, and the click's chain lists the Tab focus under `caused`. P13 (a first-party `async function*` over the body) behaves the same: seq 27 `action:muftf5k9:11`, caused by `action:muftf4pi:8`. Playwright's out-of-app `element.focus()` (seq 7, seq 25) is also credited to the click. Same fixture on base (`out-p12-base/run-1`): every one of these rows is unmarked, and the Tab focus folds into the Enter (`ep#6 = [A4, A5]`, `ep#12 = [A10, A11]`). 3/3 runs on both. |
| **Rule 3: member chains show only own evidence plus a pointer** | **holds** | Author run: every action from each click up to its Enter (A0–A2, A4–A6, A8–A10, A16–A18) was checked in `action_chain` and `recent_actions`. None mentions the Enter's request (exact method+URL match). Each Enter's chain carries its request. Members A0, A4, A8, A14 and A16 carry `episode_member: true`, `episode_carrier_action_id` and `episode_pointer`. Banked stores: 528 members checked across four stores, 0 carrier requests leaked into a member's chain, 0 members without the pointer. `compare_chains` on two G6 members (`action:mue48s1p:4` vs `action:mue48srx:5`): no `POST /api/workspace/new` (the carrier's). |
| **Probes** (`grader-scratch/probe-app.jsx`, `out/run-{1,2,3}`, 3/3 identical) | **8 of 9 hold, 1 recorded out of scope; plus P12/P13 above (fail)** | **P1** timer armed in the click, fires after 1.5 s: seq 19 `action:muft3cr6:5` caused by click `action:muft3blf:4`, `timer`; the Enter (seq 22) owns `POST /api/p1`. Held. **P2** `.then` after fetch resolves: seq 39 caused by click `action:muft3de0:8`, `promise`. Held. **P3** `startTransition` dialog with autoFocus: seq 58 `cause_abstained: scheduler_lineage`, `caused_by_action_id: null`, in no episode, and `recent_actions` gives the sentence. Held; the abstention is honest. **P4** handler focus, then a real click on the same control 75 ms later: the caused focus (seq 72) is standalone; the click (seq 75, `POST /api/p4`) has episode `[click]`. Held. **P5** Tab into input, then a click on a different control 165 ms later: the Tab focus (seq 85) is standalone and unfolded; the click episode is `[focusin(own button), click]`. Held. **P6** `requestSubmit()` from a click handler (out of scope): the `submit` (seq 99) is its own trusted `dom.action`, form episode, carries `POST /api/p6`, and is not marked; the user's click (seq 96) shows no request. Recorded. **P7** two dialogs opened by clicks 217 ms apart: seq 113 caused by click seq 110, seq 120 caused by click seq 117, both `microtask`. Held. **P8** label click: the activation focus (seq 133) is not marked. The existing behaviour, unchanged here, is that it does not fold into the synthetic input click. Recorded. **P9** Tab after an async-generator click that has completed: unmarked, folds (seq 158 into 159). Held. **P10** page-load `useEffect` focus: `cause_abstained: no_action_on_frame`, Enter 703 ms later not folded. Held. **P11** state effect: caused by click seq 168, `state_effect`. Held. |
| **MCP (black box, stdio)** | **holds, with one defect** | `element_history` on the (b) dialog key `p_5bf1afdd9d83:1775-1925#n1` gives 1 attempt (carrier the Enter `action:muft4ak7:8`, `DELETE /api/items/effect`); the caused focus is neither listed nor counted. The same holds for the probe keys P1, P2, P4 and P11. **Defect:** the same key queried on the store cut just before the Enter (`author-runs/trunc.records.jsonl`, `n: 1`) answers `summary: "no actions on p_5bf1afdd9d83:1775-1925#n1"`, with `actions: []` and `attempts: []`, although the key has a recorded focus row (`action:muft4a65:7`). A dialog that has just opened and been annotated reads as never touched. |
| **Banked diffs (base vs branch, every action and every key)** | **carriers, episodes and attempts identical; one unreported change** | See the table below. Member-chain change counts match the author exactly. Unreported: `element_history.summary` (the "newest:" headline) and `summaries` changed on 1 key in g5c, 2 in Part B and 5 in G6, wherever the newest listed action is a member. Example: G6 `handler:function:f067e70e…:166:183|click` goes from `newest: click action:mue4q5xu:64 → … [outcome rejected_client_side]: reached validation / stopped at validation` to `… [outcome incomplete]: reached dom_mutation / stopped at browser …; its evidence is attributed to the carrier action action:mue4q5xu:65`. The G5 transcript replays (`-23c`: element_history n:10, action_chain `action:muen787e:108`, resolve_element; Part B: n:3, action_chain `action:muepsox4:53`, resolve_element) are identical in `attempts`, `summary` and the carrier chain; only `actions`/`summaries` differ, as the author says. |
| **Tests** | **pass** | `npm test`: 696 tests, 695 pass, 1 fail (the known `react-context-ref-semantics`). The 3 episode-focus tests pass. D12: `pass: true`, 17/17 checks. `continuations-neutral`: ok (5 runs). `no-cross-control-neutral`: ok. G4 grader on final7: 81 PASS, 0 FAIL. G6: `g6-compare` rerun with this branch and with base gives output identical in every file except the redacted store path string; `g6-grader` reports PASS 6/6. `cmp src/runtime-attribution-browser.js dist/runtime-attribution-browser.js`: identical. |
| **Code quality** | **mostly sound; the mark lacks a liveness guard** | The mark reads only the frame stack (`src/runtime-attribution-browser.js:462-468`, `focusCause`; `:475-477`). It uses no timing and no app list. The event-type set is the claim's scope, not a heuristic (`'focus'` in `FOCUS_EVENTS` is dead: only `focusin` is listened to, at `:620`). **Leak exposure:** `settleAmbient` (`:440`) pops only stale *dispatch* frames. A function or `await` continuation frame left current by a native suspension is returned as live, and `focusCause` turns it into a credited cause. `integrations/runtime-attribution.mjs:528` documents that `for await` and async generators are not rewritten, so this path exists by design. The scheduler abstention is honest: `caused_by_action_id: null`, a sentence saying "not attributable", listed in no episode. Nothing is app-specific. The record schema is additive: the new fields appear only on `dom.action:focusin` rows (8, 4 and 4 rows in the three stores I inspected), and 0 banked rows carry `"gesture"`. On the MCP side the fields are additive, but a member's `stops`, `requests`, `outcome` and `reached` change meaning, as the G4 amendment discloses. `indexWorkflowEpisodes` (`analysis/runtime-attribution.mjs:254, 291, 362, 376`) is clean: caused rows are skipped by `nextGesture` and attached to the first gesture along a caused-by chain (depth ≤ 64). |

### Banked stores, base vs branch (my dump over MCP stdio, `grader-scratch/bank/`)

| store | actions | episode fields differ | carriers (changed) | members changed | leaks | `recent_actions` carrier entries changed | keys | attempts changed | `summary` changed |
|---|---|---|---|---|---|---|---|---|---|
| final7 | 54 | 0 | 54 (0) | 0 of 0 | 0 | 0 | 35 | 0 | 0 |
| g5-anything-llm-2026-09-23c | 151 | 0 | 9 (0) | 142 of 142 | 0 | 0 | 119 | 0 | 1 |
| g5-codex-partB-2026-09-23 | 78 | 0 | 10 (0) | 68 of 68 | 0 | 0 | 119 | 0 | 2 |
| g6-anything-llm-2026-09-23 | 408 | 0 | 90 (0) | 318 of 318 | 0 | 0 | 17 | 0 | 5 |

Side effect, a good one: on `main`, `element_history` for the G6 key `handler:function:1d3b1fac…:1181:1319|keydown` at n:100 is 8.9 MB of JSON (18.6 MB on the wire), because every keystroke member reprints the carrier's 15 requests. The MCP SDK client lost the connection on it. The branch answers in 1.1 MB.

## Required changes

1. **(Blocking) Stop a leaked frame from marking a user focus.** A `focusin` must be credited to an action only when that action's code is live at dispatch. It must not be credited just because a function or continuation frame is still `current` after a native suspension. The fix must work from the frame or the stack, with no timing or event-type heuristic; the implementer chooses how. Examples: make native suspension points (`for await`, async generators) restore the entry frame the way the await rewrite does; or keep a synchronous-liveness mark on non-dispatch frames that suspension clears. If liveness cannot be proven, abstain (`gesture:false` without `caused_by_action_id`) or leave the row unmarked; never credit. Add probe P12/P13 to the headless driver (`grader-scratch/p12-app.jsx`, `p12-drive.mjs`: click starts `for await` over a streamed `fetch` body, 4 chunks over 3.2 s; Tab into an input 1.1 s later; Enter 300 ms after). Acceptance, 3/3 runs: the Tab focus carries no `caused_by_action_id`, folds into the Enter as on base, and is absent from the click's `caused`.
2. **`element_history` must not say "no actions" for a key that has caused-focus rows.** Show those rows in `actions` with `gesture:false` and `caused_pointer`, but never as attempts and not counted toward `n`, whether or not the causing action's episode is kept. The summary must describe them, for example `0 attempts; 1 caused focus (not a user gesture) …`. Test: the truncated (b) store above.
3. **`element_history.summary` "newest:" must use the episode view, as `attempts` already do**, so the headline for a key whose newest action is a member shows the attempt's outcome, not the member's `incomplete`. Re-run the banked diff: `summary` must be byte-identical to base on all four stores. The alternative is to keep the change and disclose it in RUN.md and G5 §16 with the counts (1/2/5 keys) and the G6 example; the fix is preferred because the current headline misreports a rejected submit as incomplete.
4. (Non-blocking) Remove the dead `'focus'` entry, or add a comment that only `focusin` is captured. Also note that `docs/evidence/pr-episode-focus-2026-09-24/RUN.md` was amended in place (`2da99996`). The coordinator asked for it on an unmerged branch, but doctrine says to add files, not edit them; later changes should go in a new file.

## Residual risks (beyond the author's list)

- The P12 leak is a pre-existing engine frontier (`for await` is not rewritten) that this branch turns into a user-visible wrong credit. On `main` it is invisible for focus. Any other suspension or unwrapped-task path that leaves a frame current has the same exposure: first-party generators driven from unwrapped callbacks, and `ResizeObserver`, `IntersectionObserver` and `requestIdleCallback` callbacks, none of which the runtime wraps. In a busy app, wrapped React scheduler and timer tasks reset `current` often, which narrows the window; a quiet page, like the probe, keeps it open.
- autoFocus on the *initial* render (not probed) runs outside any frame, so it would be unmarked and fold into a later Enter within 1000 ms. That is consistent with rule 2 as written, but it is app-moved focus treated as a gesture.
- A member's own `outcome.status` stays `incomplete`, now also in `recent_actions` and in the `element_history` headline (see change 3). It is owned by `fix/outcome-labels`.
- `compare_chains` between a member and its own carrier now reports "runtime path changed", which is expected under rule 3 but reads oddly.
- Only headless Chromium was tested.

## Commands run

```sh
W=/Users/austinho/dev/tracer-n1-episode-focus; G=$W/grader-scratch
git -C $W log --oneline fixes-2026-09-24..HEAD                      # start: 80b75af1; graded: 2da99996
git -C /Users/austinho/dev/tracer archive fixes-2026-09-24 | tar -x -C <scratch>/ef-grade/base   # base, node_modules symlink
node $W/test/browser/episode-focus.mjs --out $G/author-runs          # status ok, 3 runs, stable
node $G/probe-drive.mjs $G/out 3                                    # P1-P11, 3 runs, identical
node $G/p12-drive.mjs                                               # P12/P13 on branch; same script from the base tree -> out-p12-base
node $G/dumpacts.mjs <records>                                      # raw-row listing (no package code)
node $G/mcpdump.mjs <root> <records> <out> -- <server args>         # recent_actions/session, action_chain every id, element_history every key (n:100)
node $G/histonly.mjs ...                                            # G6 element_history per key (base's 18.6 MB answer via raw stdin pipe)
node $G/bankdiff.mjs {final7,g5c,partB,g6}                           # base vs branch
node $G/one.mjs <root> <tool> <json> -- <server args>               # transcript replays, compare_chains, truncated-store element_history
cd $W && npm test                                                   # 695/696 (react-context-ref-semantics)
node test/browser/d12-stamp-neutrality.mjs                          # pass, 17/17
node test/browser/continuations-neutral.mjs                         # ok
node test/browser/no-cross-control-neutral.mjs                      # ok
node test/g4-grader.mjs docs/evidence/m1-2026-09-22-final7 --manifest docs/evidence/g4-mcp-2026-09-23/manifest.json   # 81 PASS / 0 FAIL
node test/browser/g6-compare.mjs --store $G/g6store --source-root /Users/austinho/dev/fixtures/anything-llm --out $G/g6cmp <6 pairs>   # and from base -> g6cmp-base: identical except redacted path
node test/g6-grader.mjs $G/g6store --compare $G/g6cmp --out $G/g6-GRADE.md                                              # PASS 6/6
cmp src/runtime-attribution-browser.js dist/runtime-attribution-browser.js                                              # identical
```

Housekeeping: while extracting base I overwrote the tracked files of an unrelated pre-existing directory `<scratchpad>/main` (dated 00:16, symlinked to `tracer-pr2`) with the `fixes-2026-09-24` tree. All later work used `<scratchpad>/ef-grade/base`. Whoever owns `<scratchpad>/main` should re-extract it.

---

## Regrade at 06db4f56 (2026-09-24)

Scope: a targeted regrade of the fixes on top of `c9ca4b71`: `fbcdcd96` (runtime liveness token), `e901c0e4` (MCP), `1e85d543` (tests) and `06db4f56` (evidence, RUN-2.md). Same method as before: raw rows plus the MCP server as a black box over stdio. My probes are in `grader-scratch/` (untracked): `p12-*` (unchanged from the first grade) and new `p14-app.jsx`, `p14-drive.mjs` and `p14c-drive.mjs`, each run 3 times on fresh pages unless stated.

### Verdict: **merge with changes**. One blocking change remains.

The token closes the case I reported (a Tab during a suspended `for await`). It does not close the same leak when it enters through a first-party function. `enter` gives the new function frame a *fresh* live token but takes its `action_id` from whatever frame is current, including a frame left behind by a native suspension (`src/runtime-attribution-browser.js:664-667`). So code in an unwrapped callback that calls a first-party function while a stream is open gets the stream click's action and a live token, and its focus is credited to the click. Doctrine says wrong credit is worse than abstention.

### Per-item

| item | verdict | raw evidence |
|---|---|---|
| (1) My p12 probe (for-await stream + Tab), 3 runs | **fixed** | `out-p12/run-{1,2,3}`: 0 rows with `gesture:false`. MCP run-1: the Tab focus `A4` is a member of `[A4 focusin, A5 keydown:Enter]` carried by the Enter; `A10` likewise in `[A10, A11]`. The clicks' `caused` lists are empty. This matches base. |
| (1) Driver cases (g)/(h), 3 runs, my rerun (`author-runs-r3`) | **pass** | Status ok, stable; the per-run action signature hash is identical across runs; 4 marked rows per run ((a), (b), (c), (f)), none on the stream Tabs. MCP run-1: (g) `A24` in `[A24, A25 Enter POST /api/stream/a/search]`; (h) `A30` in `[A30, A31 Enter POST /api/stream/b/search]`. The stream clicks A21 and A27 have no `caused`. |
| (2) Commit microtask and mount effect still marked (token issued on owned continuations) | **holds** | p14 Q8, 3/3: autoFocus seq 384 caused by click seq 381 via `microtask`; `useEffect` focus seq 387, same click, `mount_effect`. Driver (a) and (b) likewise (`microtask`, `mount_effect`). |
| (2) Focus in a ResizeObserver / IntersectionObserver / requestIdleCallback callback created by the action | **abstains, no credit**. Acceptable, recorded | Q1 seq 8, Q2 seq 23, Q3 seq 38 (3/3): `gesture:false`, `caused_by_action_id:null`, `cause_abstained:no_action_on_frame`, in no episode, not folded into the Enter ~500 ms later. The callbacks are not wrapped, so they are not owned; the result is honest and never guesses. |
| (2) `setTimeout(0)` armed by the handler | **holds** | Q4 seq 55 caused by click seq 48, `timer` (3/3). |
| (2) Tab during a rewritten `await` | **holds** | Q5: click seq 67 awaits a 1.5 s `/api/slow`. The Tab focus seq 73 is unmarked and folds into the Enter seq 74 (`POST /api/q5`) as `[focusin, keydown:Enter]` (MCP ep#22). |
| (2) Native `.focus()` after a `for await` loop ends | **unmarked and folds, as the author says; disclosed** | Q6 seq 153 is unmarked; MCP shows it as a member of the Enter's episode `[A24, A25 POST /api/q6]`, i.e. an app-moved focus presented as a user focus. This is the same state as `main`. RUN-2.md "Residual risks" states it explicitly ("New risk, too few caused marks … a `focus()` after the `for await` loop ends … folds as a user focus would"). I accept it as an honest missing mark. Variant Q6b, where the same focus goes through a first-party helper `focusIt()`, is credited to its click via `await` (seq 235). That credit is correct. |
| **(2) Break attempt: first-party function in an unwrapped callback while a stream frame is left behind** | **fails: wrong credit** | Q7: a `requestIdleCallback` poll armed at page load (no action) calls first-party `focusIt(input)` when a flag is set from outside the app. With a stream click open (`Q7 stream`, click seq 249 `action:mufu2kwp:32`), the focus seq 265 is `gesture:false`, `caused_by_action_id: action:mufu2kwp:32`, `caused_via: await` in 3/3 runs. MCP lists it under that click's `caused`, and the Enter seq 318 is not folded. Control (`p14c-drive.mjs`, same page, no stream click): the same poll focus seq 248 is `cause_abstained: no_action_on_frame`. The credit therefore comes only from the left-behind frame. On `main` this row has no mark. |
| (3) Change 2: `element_history` on a key with only caused focuses | **fixed** | Driver store cut before the (b) Enter, key `p_44fcba6fce55:1775-1925#n1`, `n:1`: summary `0 attempts on element client/src/main.jsx:44; 1 caused focus(es) (not user gestures); newest: focusin action:mufu2dxc:7 …`, `attempts: []`, the focus is listed with `gesture:false` and its `caused_pointer`. |
| (3) Change 3: banked `element_history` summaries | **fixed** | My dump, base vs `06db4f56`, every key: `summary` changed on **0** keys on final7 (35), g5c (119), Part B (119) and G6 (17). `attempts` 0 changed; episodes 0 differ; carriers 0 changed; `recent_actions` carrier entries 0 changed. Members changed 0/142/68/318, all with the pointer and 0 carrier-request leaks. The only other top-level `element_history` field that changed is `summaries` (per-member lines, rule 3). |
| (4) dist, npm test, D12, G4, G6 | **pass** | `cmp` src/dist identical. `npm test` 697 tests, 696 pass, 1 fail (`react-context-ref-semantics`). D12 `pass: true`, 17/17. G4 81 PASS / 0 FAIL. G6 compare rerun: identical to base's output apart from the store path; `g6-grader` PASS 6/6. |
| (5) Force-added raw rows | **small, and distinct** | 9 run files: 76,309 B × 6 (109 rows each) and 107,103 B × 3 (153 rows each); plus `banked-diff*.jsonl` 1.4 and 1.5 KB. The whole evidence directory is 935 KB. Blob hashes are all distinct (not copies). |

### Required change (blocking)

1. **Liveness must cover the action a frame inherits, not only the frame itself.**
   - In `enter` (`src/runtime-attribution-browser.js:664-667`), a function frame entered while `current` is a non-dispatch frame with a dead token must not carry that frame's `action_id` as a *focus cause*.
   - One way: record at entry whether the base was provably live (`!current || current.dispatch || current.run?.live`). In `frameLive`/`focusCause` (`:485`), a live frame whose base was not live gives `gesture:false` with `caused_by_action_id: null` and a distinct `cause_abstained` (the code is running now, but its owner is left behind). Leaving the row unmarked is also acceptable.
   - Ownership of other rows can stay as it is (the author's stated scope).
   - Add Q7 (and the control) to the driver. Acceptance, 3/3 runs:
     - the Q7 focus is not credited to the stream click and is absent from its `caused`;
     - Q6b stays credited via `await`;
     - Q1–Q5 and Q8, driver (a)–(h), D12, G4 and G6 are unchanged.

### Residual risks (additions)

- RO/IO/rIC-driven focus is never credited (abstained) even when the action created the observer. That is honest, but a gap if a product moves focus from observers.
- The token dies at the next microtask checkpoint. A leaked frame is still "live" for the rest of the checkpoint in which it was made current. I found no focus path that uses that window, but it is not proven empty.

### Commands (regrade)

```sh
W=/Users/austinho/dev/tracer-n1-episode-focus; G=$W/grader-scratch
git -C $W fetch origin; git -C $W log --oneline c9ca4b71..HEAD      # fbcdcd96 e901c0e4 1e85d543 06db4f56
node $W/test/browser/episode-focus.mjs --out $G/author-runs-r3      # ok, 3 runs, stable
node $G/p12-drive.mjs; node $G/p14-drive.mjs; node $G/p14c-drive.mjs   # probes (3, 3, 1 runs)
node $G/dumpacts.mjs <rows>; node $G/mcpdump.mjs ...; node $G/view.mjs ...; node $G/one.mjs ...   # raw rows and MCP stdio
node $G/bankdiff2.mjs {final7,g5c,partB,g6}                          # base vs 06db4f56
npm test; node test/browser/d12-stamp-neutrality.mjs; node test/g4-grader.mjs ...; node test/browser/g6-compare.mjs ... && node test/g6-grader.mjs ...
cmp src/runtime-attribution-browser.js dist/runtime-attribution-browser.js
git ls-tree -r -l HEAD docs/evidence/pr-episode-focus-2026-09-24
```

---

## Regrade at d5492509 (2026-09-24)

Scope: the three commits on top of `8a721ea7`:
- `7695b4bb`: runtime `stale_owner` / `stale_frame`;
- `221f252c`: driver cases (i), (i-control) and (j), and the stream route flushing headers at once;
- `d5492509`: RUN-3.md and runs-r4.

The runtime change is `staleOwner` (`src/runtime-attribution-browser.js:467`), which is set on function frames at `enter` (`:674`), copied by `continuationOf` (`:468`), and applied to a *copy* in `captureOwner` (`:1127`). `focusCause` reads it and returns `stale_frame` (`:494`). Nothing else reads `stale_owner`, so ownership is unchanged. The banked dumps confirm this.

### Verdict: **merge**

The blocking item is fixed and nothing regressed. Q6b (the click's own helper focus after its `for await` loop) now abstains instead of being credited. This is a missing credit, not a wrong one: at run time it is the same state as Q7, and crediting it would need a list of entry points. RUN-3.md states this plainly, and the coordinator has accepted it.

### Per-item

| item | verdict | raw evidence |
|---|---|---|
| (1) `p14-drive.mjs`, 3/3 runs (`out-p14/`) | **pass** | **Q7** (idle poll during a suspended stream), seq 265: `gesture:false`, `caused_by_action_id:null`, `cause_abstained:stale_frame`. **Q6b**, seq 235: the same. In all three runs neither is in any `caused` list. Through MCP (run-1), the only non-empty `caused` lists are Q4's click and Q8's click. The Q7 Enter (A33, `POST /api/q7`) and the Q6b Enter (A29) each have an episode containing only themselves, so nothing folds wrongly. Unchanged: Q1–Q3 `no_action_on_frame`; Q4 `timer`; Q5 Tab unmarked, folds `[A20, A21]`; Q6 unmarked, folds `[A24, A25]` (the disclosed missing mark); Q8 `microtask` and `mount_effect`. |
| (2) Driver cases (i), (i-control), (j), 3/3 runs (my rerun, `author-runs-r4/`) | **pass** | Status ok, stable. (i-control): "Poll input" seq 975/967/967 is `no_action_on_frame`. (i): seq 1039/1031/1031 is `stale_frame`. (j): "After input" seq 1607/1579/1587 is `stale_frame`. Through MCP (run-1), the Enters A33, A37 and A41 (`POST /api/poll/search`, `POST /api/poll/search`, `POST /api/after/search`) each have a one-action episode, and no stream click lists a `caused` entry. The only `caused` entries are (a), (b) and (c). |
| (3) Banked stores | **pass** | My dump at d5492509 (`action_chain` for every action, `recent_actions`, `element_history` for every key) is **byte-identical** to my 06db4f56 dump on final7, g5c, Part B and G6. Against main: `element_history.summary` changed on 0 keys, and attempts changed on 0 keys, on all four stores. |
| (4) Tests | **pass** | `cmp` src/dist: identical. `npm test`: 697 tests, 696 pass; the one failure is the known `react-context-ref-semantics`. D12: `pass: true`, 17/17. `continuations-neutral` and `no-cross-control-neutral`: exit 0. G4: 81 PASS, 0 FAIL. G6: compare output identical to main except the store path; grader PASS 6/6. |
| (5) RUN-3.md disclosure | **plain and accurate** | RUN-3.md has a section headed "One pass condition cannot be met: Q6b". It explains why Q6b and Q7 are the same state at run time, and names the only way to separate them (a list of unwrapped entry points: rIC, RO, IO, MO, unowned listeners), which it declines to build and leaves to the coordinator. The residual risks list the missing credits after native suspensions. G5 §16 carries the same consequence (`docs/gates/G5-demo.md:270`). |

### Non-blocking notes

1. **The `stale_frame` sentence is inaccurate.** The MCP `caused_pointer` for `stale_frame` reads "focus caused by app code running outside any action (cause abstained: stale_frame); causing action not attributable". For Q6b and case (j), the code is the action's own resumed code, so "outside any action" is wrong. A sentence such as "focus moved by app code running on a frame left behind by suspended code; causing action not provable" would be accurate. The sentence comes from the generic abstention branch of `causedPointer` in `collector/store.mjs`.
2. **runs-r4 raw rows are large.** They are about 1.4 MB per run (4.2 MB in total), compared with 76–107 KB for earlier runs. The idle-callback poll adds 776 `function.enter`/`function.exit` pairs per run. This is under the 20 MB gzip threshold, but gzipping is cheap if size matters.

### Commands (this regrade)

```sh
W=/Users/austinho/dev/tracer-n1-episode-focus; G=$W/grader-scratch
git -C $W fetch origin; git -C $W log --oneline 8a721ea7..HEAD       # 7695b4bb 221f252c d5492509
node $G/p14-drive.mjs                                                # 3 runs
node $W/test/browser/episode-focus.mjs --out $G/author-runs-r4       # ok, 3 runs, stable
node $G/mcpdump.mjs ...; node $G/view.mjs ...                        # MCP stdio on p14 and driver run-1
node $G/mcpdump.mjs / histonly.mjs  (four banked stores) -> $G/bank3; byte-compare with $G/bank2 (06db4f56) and base
npm test; node test/browser/d12-stamp-neutrality.mjs; node test/browser/continuations-neutral.mjs; node test/browser/no-cross-control-neutral.mjs
node test/g4-grader.mjs ...; node test/browser/g6-compare.mjs ... && node test/g6-grader.mjs ...
cmp src/runtime-attribution-browser.js dist/runtime-attribution-browser.js
```
