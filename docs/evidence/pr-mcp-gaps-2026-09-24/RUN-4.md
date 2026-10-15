# fix/mcp-gaps: run record 4 (rebased onto main bb7dd29c, 2026-09-24)

`fix/mcp-gaps` (graded merge at `9c291b06`, grader commit `884bcc7a`) is rebased onto `origin/main` `bb7dd29c`, which includes PR #10 (`fix/outcome-labels`) and PR #11 (`fix/episode-focus`). Every commit is kept, including the grader's `GRADE.md` commits. A pre-rebase backup branch is `backup/mcp-gaps-pre-rebase-4` (local only).

## Conflicts and how each was kept from both sides

- **`mcp/tools.mjs`.**
  - Imports: main's `actionOutcome` / `outcomeText`, plus this branch's span helpers.
  - `element_history`: main's gesture/caused-focus selection and episode views stay. The actions' `work_summary` uses each chain's **scope**: a non-carrier member lists only its own frames, while a carrier or standalone action lists its episode. Each attempt's `work_summary` comes from the episode view.
  - `chainStops` now returns `scope`. `action_chain` builds `work` from it. Work rows use `store.joinedRowsFor(scope)`, and the work cache is keyed by the scope's action ids.
- **`integrations/runtime-attribution.mjs`.** Main's `THREW_CATCH` clause and this branch's `pass: "chunk"` metadata are both in every template (`enter(N,{entry_hint:…,pass:"chunk"})…catch(__ptErr){…threw…}finally{…}`).
- **`src/runtime-attribution-browser.js`.**
  - The function frame carries main's `run: runToken()` / `stale_owner`, plus this branch's `entry` / `response_of`. `continuationOf` carries both.
  - **The action-less `await` resumption (used only for the issuer of unattributed requests) is created with `run: null`.** It therefore never has a live token, and a focus dispatched while it is current can never read as caused. Before this change `current` was `null` there, and `focusCause(null)` is `null`, so the behaviour is exactly main's.
  - Owned resumptions and function frames are unchanged from main.
  - `dist` is rebuilt; `cmp` identical.
- **`docs/gates/G4-mcp.md`.** Both sides' amendments are kept in order (outcome labels, episode focus, then the mcp-gaps amendments), plus a short rebase amendment.
- **`plugin/skills/tracer-annotations/SKILL.md`.** Main's outcome wording ("outcome (`outcome.status` and its `label`)", the `outcome.status` rule, episode and gesture bullets) and this branch's steps (work listing, query and privacy line, `page_requests`) are both kept.

## Follow-up commit (one label function everywhere)

- `page_requests` labels an unattributed request with `actionOutcome` over that request's own exact joins (`joinRequestServer` now also returns the joined `steps`; unlinked entries strip them). `serverOutcome` is removed.
- Segments gain `outcome_text` (`outcomeText(label)`). Work request lines and `page_requests` summaries print it (e.g. `[responded 200; no effect evidence]`, `[failed 409]`).
- **Fixture:** the validation errors now render with `role="alert"`. Main's reject rule (outcome-labels regrade) needs validation feedback in the submit's own receipt; a bare `<ul>` is now `no_request`, which is correct under that rule. A new check, W14, asserts that member chains (the form's `input` events) list only their own frames: every work frame's `action_id` is the member's, and the presence of frames matches the raw `function.enter` rows of that action.

## Counts (rerun on the rebased head)

| Check | Result |
|---|---|
| `node test/browser/mcp-gaps.mjs` | **35/35** (adds W14) |
| `npm test` | 699 tests, 698 pass, 1 fail (known `react-context-ref-semantics`) |
| `node test/browser/episode-focus.mjs <dep> --runs 3` | exit 0 (3 runs) |
| `node test/browser/outcome-labels.mjs <dep>` | **160/160** |
| D12 | pass: true, 17/17 |
| continuations-neutral | status ok |
| worker-frontier, shadow-dom-context, stable-element-keys, no-cross-control-neutral, effect-rooted-form-neutral | exit 0 |
| unlinked-coverage-neutral | 12/13, A8 only (pre-existing) |
| G4 grader | 81/81 |
| G6 (`g6-compare.mjs` regenerated, 6 pairs) | PASS 6/6 |
| `npm run build`; `cmp` src/dist | identical |

## Banked diffs against the new main (`bb7dd29c`)

Files: `diff-4-final7-source-root.txt`, `diff-4-final7-no-source-root.txt` and `diff-4-g6.txt`. The method is `bank-run.mjs` / `bank-diff.mjs`, with `main` taken from `git archive origin/main`.

The change set is the one listed in RUN.md–RUN-3, plus `segments[].outcome_text`. In detail:
- `tools/list` gains `page_requests`.
- `work` is added to every `action_chain` (final7 54, G6 100).
- Summaries gain the Work block, and the first line is unchanged: final7 54/54 (46 with a block, 594 lines), G6 100/100 (70 with a block, 561 lines). G6 members have no own frames, so they have no block.
- `query` is null throughout the banked rows.
- `work_summary` is added to `element_history` actions and attempts.
- `resolve_element` changes as recorded in ERRATA §2 (`best` null in all 14 probes).
- Nothing changed in `stops`, frontiers, `outcome`, `chain`, `recent_actions`, or the `compare_chains` stops and verdicts.

The G6 keystroke `element_history` still exceeds the SDK client's 10 MB buffer on both sides (1 call).
