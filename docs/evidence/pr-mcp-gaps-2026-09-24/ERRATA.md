# ERRATA to RUN.md (2026-09-24)

RUN.md is immutable. This file corrects two of its statements, per the independent grade (`GRADE.md`).

## 1. Residual risk 1 is wrong for real builds

RUN.md said that in a real Vite build with stamps, every function in a JSX file with control stamps is `stale_build` and renders `<unnamed> file@start-end`. That is not true of the real pipeline.

- **g5c** (`docs/evidence/g5-anything-llm-2026-09-23c/store`, a real `producttrace({"stamps":true,…})` build, checkout at the build commit `ad97bc8d`):
  - with `--source-root`, 100 `action_chain` calls rendered 960 work frame lines, all with a name (or `<anonymous>`) and `file:line`: 0 `<unnamed>`, 0 offset-only (grader's count);
  - without a source root, names come from the enriched manifest.
- **G6:** the only `<unnamed>` frames (161 lines, 4 function ids) are from builds whose file text differs from the checkout (the seeded B/C/E revisions of `GeneralAppearance/index.jsx`). That is a correct `stale_build`, and the segment lineage shows the same.
- **Where `<unnamed>` actually came from:** the test harness `test/browser/fixture-build.mjs`. It runs `productTraceVitePlugin` (source-level control stamps) and then a separate `runtimeAttributionPlugin`, so the attribution pass hashes the stamped text. The `mcp-gaps` driver still works around that harness artifact by serving the build's own source text as the checkout. This is a harness limitation, not a product one.

## 2. Role-only `resolve_element` lookups that changed from `not_found` to `ambiguous`

RUN.md named only `{role:"button", name:"Save"}`. Every role-only probe of the common ARIA roles was rerun in-process, `main` (`fixes-2026-09-24`) against the branch. Results are `status candidates_total`:

| Store | Probe | main | branch |
|---|---|---|---|
| final7 | `{role:"button"}` | not_found 0 | ambiguous 4 |
| final7 | `{role:"textbox"}` | not_found 0 | ambiguous 7 (5 shown) |
| final7 | `{role:"form"}` | not_found 0 | ambiguous 3 |
| final7 | `{role:"button", name:"Save"}` | not_found 0 | ambiguous 4 |
| G6 | `{role:"button"}` | not_found 0 | ambiguous 5 |
| G6 | `{role:"textbox"}` | not_found 0 | ambiguous 3 |
| G6 | `{role:"button", name:"Save"}` | not_found 0 | ambiguous 5 |

All other probed roles (`link`, `checkbox`, `radio`, `combobox`, `listbox`, `menuitem`, `option`, `dialog`, `heading`, `img`, `searchbox`, `switch`, `tab`) are unchanged. Two unchanged results look like changes, so for the record:
- final7 `{role:"combobox"}` is `ambiguous 1` on both (an explicit `role` attribute);
- G6 `{role:"combobox"}` / `{role:"menuitem"}` are `not_found` on both.

The cause is one rule: the implicit role of `<button>`, `<input>`, `<textarea>` and `<form>` counts as the role. The results are still ranked candidates, with `best: null` in every one.

## 3. RUN-2's "neither banked store has such a run (0)" is wrong about raw rows (added after the regrade)

RUN-2 said neither banked store has a recursion-like run (three or more of the same id at the end of a `function.enter` spine). That is true only of the rendered listing. In the raw rows:
- final7 has **167 `function.enter` rows, in 3 manifest functions (8 actions), whose spine ends in a run of ≥ 3 of the same id**. This was recounted here from `records.jsonl.gz` and matches the grader's count.
- None of them is rendered: they sit below the work listing's depth limit (4) and past its 100-entry JSON cap. So `calls_exact: false` / "not separable" never appears on final7, and the count sentence in RUN-2 should read "0 rendered; 167 raw rows below the depth limit".
- G6 has 0 such raw rows (recounted from its gunzipped `records.jsonl`).
