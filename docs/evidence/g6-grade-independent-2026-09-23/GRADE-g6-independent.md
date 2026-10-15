# G6 independent grade (2026-09-23)

The grader is a separate agent from the implementer. This grade does not rely on `GRADE-g6.md`, `test/g6-grader.mjs` or `test/g6-compare.mjs`. No code from `analysis/`, `collector/` or `mcp/` was imported. Every verdict below comes from one of two sources:
- the raw store, decompressed to a scratchpad and recomputed with python3/jq;
- the MCP server, run as a black box (`node mcp/server.mjs --store <scratch store> --source-root <fixture>`) and driven by a throwaway JSON-RPC stdio client, reading `structuredContent`.

Nothing in the fixture, the evidence directory or the code was modified. The only file written is this one.

**What was graded.** The branch `g6-verification` at `9279dd3f`, the evidence commit (4 commits past `2dd6e7a2`). While this grade was running, someone else committed `277c1a84` (ERRATA.md plus gate-text amendments). They also left uncommitted edits in `collector/store.mjs`, `mcp/tools.mjs` and five other files, and created an untracked `docs/evidence/g6-anything-llm-2026-09-23-remap-bases/`. To grade exactly the code that produced the evidence, the MCP server was run from `git archive 9279dd3f`, extracted to the scratchpad with the same `node_modules`. A second run against the live working tree gave the same verdicts. The one difference is vocabulary: it reports `change_basis: "ordinal"` where the evidence says `"manifest_remap"`, which is the change ERRATA item 3 describes. That working tree is uncommitted and is not graded here. `git diff accab8bf 17cc3261 -- mcp collector analysis` shows only two changes: the `detail` wording and the store writer dropping `index`. `17cc3261..9279dd3f` touches no code in those dirs. This matches ERRATA item 1.

## Per-item results

| # | item | result | evidence (recomputed) |
|---|---|---|---|
| 1a | Fixture HEAD / clean / no leftovers | **PASS** | `git -C fixture rev-parse HEAD` = `ad97bc8dfcb6919f34f7d6d0c722efdda64d66d9`. `status --porcelain` has 0 lines. `branch -a` lists only `master` plus the origin refs, so there is no `g6-scenario`. There is no `.tracer/` and no stash, and `worktree list` shows the main checkout only. The reflog shows the exact scenario sequence: checkout `g6-scenario` → `8bc8ae7` seed → `719f176` revert → `857ab36` refactor → `8e11b8f` revert → `879685d` frontend seed → checkout `master`. |
| 1b | Patch series applies and matches RUN.md | **PASS** | `fixture-scenario.patch` (5 patches) `git am`-applies cleanly on `ad97bc8d` in a `--shared` scratch clone. The resulting **tree** hashes equal the fixture's own (unreachable) commit trees: `25037560` (8bc8ae75), `0d17cb45` (719f1768, and also 8e11b8f1), `54ae2618` (857ab360), `a0671d9c` (879685d1). `0d17cb45` is `ad97bc8d^{tree}`, so C-fix-r2 and E's parent are byte-identical to the baseline. The hunks are exactly the three diffs quoted in RUN.md. `runs.jsonl` `source.commit` per label is A `ad97bc8d`, B `8bc8ae75`, C-fix `8bc8ae75`, C-fix-r2 `719f1768`, D `857ab360`, E `879685d1`, which matches the RUN.md table. |
| 1c | Run-C mishap mechanism | **PASS (plausible, partly unverifiable)** | Re-running `git revert --no-edit HEAD -q` in a scratch repo prints usage, exits 129 and creates no commit. The fixture reflog has no entry between `8bc8ae7` and `719f176`, and C-fix's `source.commit` is `8bc8ae75`. Whether the harness was chained with `;` cannot be checked from the files. |
| 2a | `runs.jsonl`: 6 runs with build ids | **PASS** | There are 6 rows: A, B, C-fix, C-fix-r2 (build `b-2dc9ecff4d63b25e`), D (`b-a33d446fe91e8701`) and E (`b-492209beb3a2e901`). The label `C-fix` is kept for a run at the seed commit (the mislabel is disclosed). |
| 2b | One manifest per build; build id | **PASS** | `manifests/` holds exactly 3 files, one per build, each with 5,101 functions and no duplicate ids. Recomputing `"b-"+sha256(sorted ids joined "\n")[:16]` reproduces each file's build id. The union holds 5,109 ids: D and E each re-id the 4 functions of the edited file. The MCP `store.manifest_functions` also reports 5109. |
| 2c | Rows tagged with run and build | **PASS** | 0 of 40,391 records and 0 of 6,924 spans lack a valid `tracer_run`. Each run's rows carry exactly one `tracer_build`, and it equals that run's `build`. Per-run counts equal `runs.jsonl` `records`/`spans`: 6729/1156, 6731/1156, 6730/1156, 6728/1156, 6769/1156, 6704/1144. The sha256 of every decompressed file equals RUN.md's table. |
| 2d | Sequences contiguous per page | **PASS** | Each run has 2 `capture_page_id`s, and each is exactly `1..N` with no gaps (for example A: 6646 + 83). No page id appears in more than one run. |
| 2e | Request counts vs Playwright | **PASS** | The number of non-internal `network.request` rows per run equals `coverage.json` `transports.playwright`: 71 for A–D, 70 for E (E never sends the update). `build-gates.json` has every run with source `pass`, tracked status empty before and after, unfiltered status after = `?? .tracer/`, markers pass (5,101), parity pass and smoke `ok`. |
| 3 | Rename submit chain per run (raw) vs `compare/*.json` vs live `action_chain` | **PASS** | Exactly one `dom.action` `submit` falls in each `rename-workspace` window. The ids are A `action:mue48zaw:65`, B `…mue4cr85:65`, C-fix `…mue4g90c:65`, C-fix-r2 `…mue4jjss:65`, D `…mue4mtmf:65` and E `…mue4q5xu:65`, the same as RUN.md. Each has exactly 1 depth-0 `function.enter`: A/B/C/C2 `c85152dc…:931:1488`, D `18fe3d40…:931:1497`, E `7aef3dca…:931:1540`. A–D: `POST /api/workspace/tracer-g2/update` → exactly 1 server span (same trace, parent = request span id), `http.route /api/workspace/:slug/update`, status A 200 / B 422 / C-fix 422 / C-fix-r2 200 / D 200. Handler spans are `#0 validatedRequest`, `#1 <anonymous>`, `#2 <anonymous>`, identical in all five. There are 0 `db.system` spans in the whole store. E: 0 requests and 0 update server spans in the E run. The live `action_chain` for all 6 matches this field for field (entry id, request, route+status, handler list), and so do the committed summaries. |
| 4 | Six comparisons: own per-stop diff vs server | **PASS (6/6)** | See the table below. The live server output at `9279dd3f` is identical to the committed `compare/*.json` once the `store` stats block is ignored. |
| 5 | Remap hardening on a doctored store | **PASS** | Six doctored copies of D's manifest were tested, each as a scratch store. None yields a silent `source_revision`. See the section below. |
| 6 | Code review: `mcp/tools.mjs` compare, `collector/store.mjs` remap | **PASS with minor notes** | No repo-specific strings or rules (grep for anything/workspace/prisma/tracer-g2 finds nothing). The remap abstains (`unmapped`) on missing files and on count or shape mismatch, and checks both the forward and the reverse mapping. Silent picks exist only in store loading, and none was exercised here (notes below). |
| 7 | LIMITS/RUN honesty | **PASS with corrections** | Most claims are backed by raw rows. One numeric claim is wrong, and some wording is looser than the rows support. See the section below. |

### Item 4 detail (own diff from raw rows; remap reimplemented in python)

| pair | my per-stop diff | my `path_changed` | server (`9279dd3f`) | agree |
|---|---|---|---|---|
| A → B | route changed (200 → 422); entry, request and 3 handlers same; no DB either side | true | `path_changed: true`, reasons [route, outcome], route `different_value`, `outcome_delta.changed` = [http_status] 200 → 422. After frontier: reached handler / stopped at handler / because "server responded 422; no database span descends from the admitted handler span" | yes |
| B → C-fix-r2 | route changed (422 → 200), rest same | true | true, [route, outcome], http_status 422 → 200 | yes |
| A → C-fix-r2 | all 6 same | false | false, 6 same, `changed` [] | yes |
| A → D | entry `c85152dc…:931:1488` → `18fe3d40…:931:1497`; my remap gives `source_revision`; rest same | false | false; entry `changed`/`source_revision`/`manifest_remap`, ordinal 3 (position 4 of 4), reverse id = before id | yes |
| A → E | entry changed (`source_revision` by my remap); request, route and handler #0–#2 **removed**; http 200 → none | true | true, [request, route, handler, outcome]; 1 changed, 5 removed; after reached validation / stopped at validation | yes |
| B → C-fix | all 6 same (422 both) | false | false | yes |

**Independent remap check for A→D and A→E.**
- Same file: `frontend/src/pages/WorkspaceSettings/GeneralAppearance/index.jsx` has 4 functions in all three builds.
- Same pre-order shape: `[f@0, f@1, f@2, f@1]`.
- The handler is ordinal 3 in each build, and the reverse mapping returns the before id.
- The id hashes are real: `sha256(git show <commit>:<file>)` equals the hash in the function id for `ad97bc8d`, `857ab360` and `879685d1`. Each `[start,end)` slice begins `async (e) => {` and ends at the handler's closing brace.
- Normalised text: the whitespace-collapsed handler text is **not** equal across builds (A≠D, A≠E). It becomes equal after one of two edits: replacing `payload`→`data` in D, or deleting the single added `if (/\s/.test(...)) return;` line in E. Functions 2 and 3 in the file have byte-identical normalised text. Function 1 (the component) differs only because it contains the handler.
- So the mapping is correct. It rests on position and shape, and a whitespace-normalised text match would **not** have matched these pairs.

**E's `validation` stop.** Under E's action there is one `dom.mutation` (seq 6582, after the submit at 6561 and the handler's enter/exit):
- `form_ref object:48` equals the submit's `form_ref`;
- `form_mutation {count:1, character_data:1}`;
- `validation {same_form:true, aria_invalid_changed:false, focus_moved_to_invalid_field:false, feedback_mutations:0}`.

This satisfies the G4 admission rule (a submit with no request, followed by a mutation on the same form), so the label is mechanically justified. The screenshot `runs/E-frontend-early-return/step-07-rename-workspace.png` shows the button stuck on "Updating…" and the sidebar still "Tracer G2". The mutation is therefore the saving label, not validation feedback. LIMITS §4 says this. The word "validation" (and `stage: rejected`, `submit_rejected_by_app`) is vocabulary, not evidence that validation UI appeared.

### Item 5 detail (doctored copies of D's manifest; records, spans and runs unchanged)

| case | doctoring | `compare_chains(A, D)` |
|---|---|---|
| h1 | handler `…:931:1497` removed from D's manifest | `path_changed: true`, entry `unmapped_revision` ("function structure … differs between builds (4 vs 3 functions); not claiming the handler is unchanged") |
| h2 | extra nested function `1000:1100` added inside the handler | `true`, `unmapped_revision` (4 vs 5) |
| h3 | extra function `2260:2280` added after the component | `true`, `unmapped_revision` (4 vs 5) |
| h4 | every function of the file removed | `true`, `unmapped_revision` ("… has no functions in the other build") |
| h5 | ids of the handler and the depth-1 `709:896` function swapped | `true`, `different_handler` ("remapped id …:709:896 is not the after handler") |
| h6 | same-shape restructure: 709/721 removed, `1000:1100` (depth 2) and `1600:1700` (depth 1) added | `true`, `different_handler` |

None of these is silently `source_revision`. One observation from h1 and h4: when the after build's manifest lacks the handler id, the after-side `action_chain` entry handler becomes the next *registered* function, `1867c691…:897:1300` in `frontend/src/models/workspace.js`. So the after chain names a different function, with no marker that the real first function was unregistered. `compare_chains` still flags the change, because the remap works from the before function's file. Not a G6 failure. It is worth a frontier note in the future.

### Item 6 notes (code at `9279dd3f`)
- `compare_chains` (tools.mjs L360–425): the remap runs only when both actions carry a build tag with a manifest in the store. It covers several cases:
  - same build with different ids gives `different_handler`;
  - a forward mapping that fails gives `unmapped_revision`;
  - otherwise it requires both forward and reverse agreement;
  - an event mismatch demotes `source_revision`;
  - `source_revision` is the only non-`same` entry status excluded from `path_changed`.

  If either side has no build or manifest, it falls back to `content_hash` and says so in `change_basis`. That fallback is not silent.
- `remapFunctionId` (store.mjs L223–247) sorts by `(start asc, end desc)`, computes the shape from containment plus `kind`, and abstains when a file is absent or when count or shape differ. Nothing in it is specific to this repo.
- Silent picks, none exercised in this evidence:
  1. `readBuildManifests` keys each manifest by its own `build` field, else the filename. It checks neither that the field matches the filename nor that it matches a recomputed id, and if two files share a build key the later one (sorted) wins.
  2. `buildByAction` takes the first `dom.action` row's `tracer_build` per `action_id`. This relies on action ids never colliding across runs, and `lookupAction` guards that case.
- Handler stops compare `(route, index) → name`. `<anonymous>` handlers therefore compare equal whatever their bodies. That is why the seeded bug in B shows only as the status, which LIMITS §1 states.

### Item 7: claims not supported (or imprecise) against raw rows
1. **Wrong index numbers (LIMITS §6, ERRATA §2, gate §3.1).** The docs say "4,828 / 4,857 / 4,909 of 5,101 positions differ from A". Those numbers compare `index` at the same *array position* of the two manifest files, which mixes array reordering with renumbering. Keyed by function id (same function, different `index`), the correct counts are **4,139 / 4,563 / 4,458**. The qualitative claim holds: `index` is bundle-local, and no reader keys on it. Each run's own manifest has the same `(id, kind, source)` set as its build's store manifest, and A, D and E match their store manifests' `index` on 0 of 5,101 differences, which confirms the "first run of the build" claim.
2. **The run-C mishap wording (RUN.md "Operator error").** The mechanism and the facts check out (item 1c). One part is inferred rather than shown by any file: that "the chained harness run went ahead" (`;` rather than `&&`). The label `C-fix` stays wrong in `runs.jsonl`, but it is disclosed, and no fix verdict uses it.
3. **RUN.md first paragraph (commit order).** Wrong as written. ERRATA §1 corrects it, and the code diff confirms the correction.
4. **Gate §2 handler names.** The gate says "`validatedRequest`, `flexUserRoleValid`, and the anonymous update handler". The raw spans name them `validatedRequest`, `<anonymous>`, `<anonymous>`, because `flexUserRoleValid([...])` returns an unnamed closure. The chain never shows the name `flexUserRoleValid`.
5. **E's frontier wording (LIMITS §4).** The claim that the mutation is the "Updating…" label is supported by the screenshot and the source (`setSaving(true)` runs first). The raw row records only one `character_data` mutation and does not record the text. See the item 4 note on the word "validation".
6. **Unverifiable by design.** Three RUN.md claims cannot be checked from the files: that the per-run records and spans equalled the store rows before deletion (the per-run copies were deleted), the "reproduction was done once" statement, and the deleted harness scratch dirs. My own rerun reproduced all 6 compare results exactly at `9279dd3f`.
7. **ERRATA §3** points at `../g6-anything-llm-2026-09-23-remap-bases/`. That directory is untracked, was being written during this grade, and is not graded.

## Commands (abridged; scripts lived in the grader's scratchpad)
```
# fixture
git -C /Users/austinho/dev/fixtures/anything-llm rev-parse HEAD; git -C … status --porcelain | wc -l; git -C … branch -a; git -C … reflog; git -C … worktree list
git clone -q --shared --no-checkout <fixture> fx && git -C fx checkout ad97bc8d && git -C fx am <evidence>/fixture-scenario.patch
git -C fx log --format='%h %T %s' ad97bc8d..HEAD ; git -C <fixture> log -1 --format='%h %T' <each scenario commit>
# store
gunzip -c store/*.jsonl.gz, store/manifests/*.json.gz → $SCRATCH/store ; shasum -a 256 (all equal RUN.md)
python3 integrity.py   # tags, per-run counts, per-page 1..N contiguity, non-internal network.request vs coverage.json playwright, build id recompute
python3 chain.py       # submit in step window → depth-0 function.enter → network.request → server span (trace_id, parent=request span) → producttrace-express-handlers descendants → db.system descendants → dom.mutation on form
python3 remap.py       # pre-order/shape/ordinal remap from manifests + sha256(git show <commit>:<file>) + normalised-text comparison
python3 diff.py        # own per-stop diff per pair vs MCP compare_chains and action_chain
# MCP black box (JSON-RPC over stdio: initialize, notifications/initialized, tools/list, tools/call; reads structuredContent)
git archive 9279dd3f | tar -x -C $SCRATCH/code9279 ; node $SCRATCH/code9279/mcp/server.mjs --store $SCRATCH/store --source-root /Users/austinho/dev/fixtures/anything-llm
# hardening: $SCRATCH/hard/h1..h6 = symlinked jsonl + doctored manifests/b-a33d446fe91e8701.json; compare_chains(action:mue48zaw:65, action:mue4mtmf:65)
```

## Verdict

**G6: PASS.** The G6 pass condition holds on raw rows. For a seeded backend bug on a fresh repo, `compare_chains` reports the before/after path change: A→B changes 200→422 at the route and in the outcome, and B→C-fix-r2 restores it. It reports no change for a no-op refactor: A→D gives `path_changed: false`, with the entry handler a `source_revision` via `manifest_remap`, which I verified by independent remap and by the source text at both commits. My independent recomputation agrees with the server on all six pairs, every stop included. The committed `compare/*.json` reproduce exactly from the committed store and code.

**Proven:**
- fixture restored and clean;
- patch series and run commits consistent with RUN.md;
- store integrity (tags, counts, contiguity, Playwright parity, build ids);
- per-run chains;
- all six verdicts, including the stretch pair A→E (request/route/handlers removed; after-side frontier before the network) and the B→C-fix replay-determinism control;
- the remap abstains (`unmapped_revision` or `different_handler`, never silent `source_revision`) when the handler's function is removed or added, when a sibling is added, when the file is gone, or when the file is restructured.

**Not proven:**
- any DB-level effect ("no write") — there is no Prisma/SQLite instrumentation, so every chain stops at the handler;
- the remap on a real (non-doctored) rebinding or structural edit;
- generality beyond one action on one repo;
- a real coding agent reading the MCP output and making the fix;
- that E's `validation` stop reflects validation UI (it is the saving label);
- the uncommitted working-tree remap (`text_match`/`name_match`/`ordinal`) and `277c1a84`, which were not graded.

**Corrections the docs need:**
- the index-difference numbers, which should be 4,139 / 4,563 / 4,458 by function id;
- the gate's handler-name wording.

## Addendum: grade of `84cc1a27`, `4cb79b72`, `55a7dcf3` (same black-box method)

**Code graded:** `55a7dcf3` ("G6 closes after the independent grade"), the branch head at grading time. The working tree was clean apart from this directory and the `node_modules` symlink. The MCP server was run from `git archive 55a7dcf3`, extracted to the scratchpad, over stdio with my own client. Nothing was imported from `analysis/`, `collector/` or `mcp/`.

**Stores used:**
- The remap-bases store: the original `records/spans/runs` plus the three manifests from `g6-anything-llm-2026-09-23-remap-bases/manifests/*.gz`. Their decompressed sha256 matches that RUN.md.
- The original store.
- Scratch copies with doctored manifests.

| # | check | result | evidence |
|---|---|---|---|
| a | remap-bases store: A→D and A→E resolve by `name_match` both ways; all six verdicts unchanged | **PASS** | A→D and A→E: entry `changed`/`source_revision`, `change_basis: name_match`, `reverse_basis: name_match`; `tried` = ["text_match: no function with the same normalised text"]. All six pairs keep their `path_changed` values (T, T, F, F, T, F), stop statuses and http deltas, the same as at `9279dd3f`. Live output equals the committed `remap-bases/compare/*.json` exactly, except the `store` block. All six `action_chain` results are identical across `9279dd3f`, `55a7dcf3` on the original store, and `55a7dcf3` on remap-bases. On the original store, `55a7dcf3` resolves A→D and A→E by `ordinal` with the same verdicts. I also checked the enrichment independently: `text_sha256` = sha256 of the whitespace-collapsed `[start,end)` slice of `git show <commit>:<file>`, confirmed for 3 functions of the edited file. `name: handleUpdate` matches `const handleUpdate =` in the source. The handler texts differ (A≠D≠E), so `text_match` correctly does not fire. |
| b | doctored manifests never give a silent `source_revision` | **PASS, with one caveat** | **Plain manifests** (no text/name keys; my six cases h1–h6): h1, h2, h3, h4 → `unmapped_revision` (basis `unmapped`, per-rule reasons listed); h5, h6 → `different_handler` (basis `ordinal`). Every one gives `path_changed: true`. **Enriched manifests** (the same six plus h7 and h8): h1 and h4 → `unmapped_revision`; h5 and h7 (name moved to another function) → `different_handler` by `name_match`; h2, h3 and h6 → `source_revision` by `name_match` with `path_changed: false`. In h2, h3 and h6 the doctoring leaves the after handler's id and name in place, so the mapping lands on the real after function and is not a false claim. It does mean an added or removed function *elsewhere in the file* no longer forces abstention, which is the intended amendment. **Caveat (h8):** in h8 I gave a second function in D the name `handleUpdate` (`709:896`). The remap picked the nearest start offset (`931:1497`, distance 0 against 222) and reported `source_revision` / `name_match`. The output does not say that two candidates existed: `tried` lists only text_match. Ties abstain only at exactly equal distance. The pick was correct here, but a multi-candidate name match should be surfaced, for example with a `candidates` count in `remap`. |
| c | handler missing from its manifest: `action_chain` reports unmapped, not a neighbour | **PASS** | With the handler row removed from D's manifest (h1), or the whole file removed (h4), in both plain and enriched variants, the `action_chain(D)` entry stop is `{function_id: …:931:1497, resolution: "unmapped", status: "not_found", build: "b-a33d446fe91e8701", found_in_builds: [], source: null, reason: "entry handler … is not in build b-a33d446fe91e8701's manifest"}`. The summary reads `submit … → not_found: entry handler … is not in build …'s manifest → POST …`. On the `after` side, `compare_chains` carries the same unmapped entry, and the result is `unmapped_revision` / `path_changed: true`. At `9279dd3f` this case named `frontend/src/models/workspace.js` `1867c691…:897:1300`, so the defect is fixed. |
| d | two manifest files with the same `build` key are rejected | **PASS (wording note)** | Three doctored stores were tested: d1, a copy of A's manifest under a second filename; d2, D's manifest under a wrong filename; d3, D's content relabelled `build: b-2dc9…` in a second file. All three are rejected at load time with `manifest <file> declares build <b>, which does not match its file name`. A control copy of the real layout loads `ok`. At `9279dd3f`, d1 and d3 loaded `ok` (later file wins). The explicit duplicate-key branch (`two manifest files declare build …`) cannot be reached from a directory, because filenames are unique and must equal the build key. The filename check alone enforces uniqueness. Notes: the tool envelope reports the rejection as `status: "not_found", reason: "store_unavailable"`, with the summary "nothing was recorded or the path is wrong". The error text is exact, but the envelope wording is misleading for a store that exists and is invalid. The loader also still does not recompute the build id from a manifest's function set. |
| e | the two new test files exist and pass | **PASS** | `test/compare-remap.test.mjs` and `test/store-writer.test.mjs` exist; both were added in `accab8bf`, `git diff --name-status 2dd6e7a2 55a7dcf3 -- test` shows them as `A`, and `55a7dcf3` extends both. `node --test test/compare-remap.test.mjs test/store-writer.test.mjs` in the `55a7dcf3` extract gives 17 tests, 17 pass, 0 fail. The tests include "an entered function missing from its build manifest is reported unmapped, never replaced by the next registered function", "loadStore rejects two manifest files with the same build key, and a build field that does not match its file name", and the text_match, name_match, nearest-start and tie cases. The full `npm test` suite was not run. |

**ERRATA 4–6 and gate §10** (`55a7dcf3`) record the corrections from the main grade accurately: index counts by function id of 4,139 / 4,563 / 4,458, the `<anonymous>` handler names, and the run-C "chained" wording marked as inference. The §10 claim "the real G6 store … 0 such actions, so no committed answer changes" is consistent with the identical `action_chain` and `compare_chains` verdicts above.

**Addendum verdict: PASS.** (a)–(e) hold. What is proven:
- `name_match` resolves the real no-op refactor and the frontend edit in both directions without changing any verdict.
- The neighbour silent pick is gone: an unregistered entered function is reported `unmapped`/`not_found`.
- Ambiguous per-build manifest files are refused.

Not proven or open:
- A name match with several same-named candidates picks the nearest start without saying so (h8). A counted or abstaining rule would close this.
- `text_match` is exercised only by unit tests, never on real builds.
- The store-rejection envelope says `not_found`.
