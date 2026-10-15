# fix/episode-focus: rebase onto main with outcome labels (2026-09-24)

This file sits beside `RUN.md`, `RUN-2.md` and `RUN-3.md`; none of them was edited. The grade at `d5492509` was "merge" (`GRADE.md` regrade section, grader commit `e03bb5bd`). Before merging, the coordinator asked for a wording fix and a rebase onto `origin/main` `5e376320`, which includes PR #10 (`fix/outcome-labels`).

## What changed

1. **Wording.** The `stale_frame` pointer now reads: "focus caused by app code running on a frame that suspended code left behind (cause abstained: stale_frame); the causing action could not be proven". The driver asserts it for case (i).
2. **Rebase onto `5e376320`.** The previous head is kept as local branch `backup/episode-focus-pre-rebase`. Every commit was replayed, including the grader's four evidence commits (`GRADE.md`, regrades). Conflicts, all resolved by keeping both sides:
   - `collector/store.mjs`: main passes `backendInstrumented` to `buildEpisodeChain`; my `recordFor` / member scope now pass it too.
   - `mcp/tools.mjs`: `recent_actions` carries main's `outcome` and my pointer fields.
   - `docs/gates/G4-mcp.md`: main's outcome-labels amendments and my episode-focus amendment are both kept, in that order.
   - The runtime merged cleanly (main's `form_invalid` / `threw` / `action.uncaught_error` next to my focus cause and liveness token). `npm run build` rebuilt `dist/`, and `cmp` shows it identical to `src/`.
3. **Member label from the one outcome function.** New helpers `memberScope`, `memberPointer` and `memberOutcome` in `analysis/causal-chain.mjs` are shared by the store (MCP) and `buildActionChains` (export).
   - A member's `outcome` is `actionOutcome` over the member's own steps. Its `sentence` ends with `; <episode_pointer>`, and `outcome.episode_pointer` holds the pointer.
   - The export row for a member carries `episode_member`, `episode_id`, `episode_carrier_action_id` and `episode_pointer`, and the member's own outcome, so the export and the MCP describe a member the same way (main's rule "export builds the same episode as the MCP", applied to the member scope).
   - Carriers and standalone actions keep their episode outcome, as on main.
4. **One check in the outcome-labels driver was adapted to the member rule.** `test/browser/outcome-labels.mjs` "every action prints one status and one label on every surface":
   - It demanded that an action's `element_history` attempt and live-viewer card show the same status as its own `action_chain`. For a non-carrier member that contradicts episode-focus rule 3: the attempt and the card describe the episode, and the member's own chain describes the member.
   - The check now requires the action's own surfaces to agree with each other: `action_chain`, `display_status`, the chain's display, outcome and terminal label, `recent_actions`, the `element_history` action, `compare_chains` before/after, and the export.
   - It also requires the attempt and the viewer card (status and label) to equal the carrier's `action_chain` outcome. For every non-member the carrier is the action itself, so the check is as strict as before. Still 160 checks.

## What label members carry now

`outcome.status` for a non-carrier member is its own label, from the one function: `no_request` when it sent nothing itself. The label reads "No request: …" and the sentence reads "… no request could be attributed to this action from instrumented code (…); this action is part of episode X; its request is attributed to the carrier action Y". It is `stopped` when its own chain stops at `entry_handler` (abstention), and `failed` / `completed` / `responded` / `stopped` only if the member issued a request of its own. It is never the carrier's status. The `incomplete` of the pre-rebase branch is gone.

Banked stores (`member-labels.txt`, `tools-3/labels.mjs`):

| store | members | `no_request` | `stopped` | sentence ends with the pointer |
|---|---|---|---|---|
| final7 | 0 | – | – | – |
| g5c | 142 | 129 | 13 | 142 |
| Part B | 68 | 49 | 19 | 68 |
| G6 | 318 | 318 | 0 | 318 |

## Rerun at this head

```sh
npm run build && cmp src/runtime-attribution-browser.js dist/runtime-attribution-browser.js   # identical
node test/browser/episode-focus.mjs --out docs/evidence/pr-episode-focus-2026-09-24/runs-r5  # ok, 3 runs, stable; (a)-(j) as in RUN-3.md
node --test test/episode-focus.test.mjs                                                     # 5/5 (member label and export view added)
npm test                                                                                    # 698/699; 1 known failure (react-context-ref-semantics); main is 693/694
node test/browser/d12-stamp-neutrality.mjs                                                  # pass, 17/17
node test/browser/continuations-neutral.mjs                                                 # ok
node test/browser/no-cross-control-neutral.mjs                                              # ok
node test/browser/outcome-labels.mjs                                                        # 160/160 (one check adapted, above)
node test/g4-grader.mjs docs/evidence/m1-2026-09-22-final7 --manifest docs/evidence/g4-mcp-2026-09-23/manifest.json   # 81/81 (g4-grade-4.md)
node test/browser/g6-compare.mjs --store <scratch g6store> ... (6 pairs, regenerated) && node test/g6-grader.mjs <scratch g6store> --compare <out>   # PASS 6/6 (g6-grade-4.md)
```

**Banked member-chain diff, `main` `5e376320` vs this head** (`banked-diff-3.jsonl`, `tools-2/dump.mjs`, `tools-2/diff.mjs`):

| store | episodes identical | `action_chain` changed | of those, carriers | `attempts` changed | `element_history` summary changed |
|---|---|---|---|---|---|
| final7 | yes | 0 / 54 | 0 | 0 / 35 keys | 0 |
| g5c | yes | 142 / 151 | 0 (all members; 137 printed a carrier request on main) | 0 / 119 | 0 |
| Part B | yes | 68 / 78 | 0 (53) | 0 / 119 | 0 |
| G6 | yes | 318 / 408 | 0 (278) | 0 / 17 | 0 |

## Residual risks (additions)

- **Changed output for agents.** A member's `outcome.status` in the export and the MCP is now its own (mostly `no_request`), where `main` gave the episode's. A consumer reading an arbitrary action's export row as "what this attempt did" must follow `episode_carrier_action_id`.
- **The adapted check** in `outcome-labels.mjs` now encodes the member rule. A reviewer of `fix/outcome-labels` should confirm that reading.
- **`e03bb5bd` was rewritten.** The grader's commit was replayed by the rebase, so its SHA changed. Its content is unchanged.
