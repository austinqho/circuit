# fix/mcp-surfaces: final author run (2026-09-24)

This follows the independent regrade at `8177d644` in `GRADE.md`. Base: `main` `39449f7a`. This is author evidence. All edits were in this worktree; `grader-scratch/` and other worktrees were not modified. No dependency install ran.

## Rules implemented

1. **A body page advances even when its next body exceeds 512 KB.** The shared budget routine serves `page_requests`, `action_chain`, and `recent_actions`. If the newest remaining request's stored body content alone exceeds the budget, the reply returns a byte-bounded prefix, marks the request and affected body as `truncated_to_budget: true`, reports its original full-body byte count, and states that the omitted bytes cannot be recovered. Any older bodies remain summaries with a total, exclusive `{until_timestamp, until_id}` cursor past the truncated request. `with_full_bodies` excludes the truncated request. Every cut has a notice; the last page has no cursor only when no older listed body remains.
2. **`recent_actions include_bodies` states its selected-window scope.** Its text says that bodies outside the selected `n` actions' windows are not included, counts distinct recorded bodies in older action windows that do not overlap the selected windows, and directs the caller to `page_requests {attribution: "none", include_bodies: true}` for all unattributed requests. The cursor still pages only within the selected action windows.

## Direct checks

| Check | Result |
|---|---|
| Headless `node test/browser/mcp-surfaces.mjs --runs 3` | **128/128**. The existing tied-timestamp probe recovered 320/320 bodies exactly once. A 600,000-byte body inserted mid-sequence also yielded 320 unique, 0 duplicate, 0 missing; every page returned body content, cursors advanced, exactly one body was marked truncated, and the notice named its request, full size, and irrecoverable omitted bytes. The 30-action synthetic store with `n:5` returned 50 selected bodies and stated that 250 recorded bodies lay beyond the selected windows. |
| `node --test test/mcp.test.mjs` | **34/34**. A focused synthetic check exercises an oversized next body through all three `include_bodies` surfaces, including an `action_chain` continuation page. |
| `npm test` | **733 tests: 732 pass, 1 fail**. Sole failure: the pre-existing `react-context-ref-semantics` Provider-value assertion (`'a' !== 'b'`). |
| G4: `node test/g4-grader.mjs docs/evidence/m1-2026-09-22-final7 --manifest docs/evidence/g4-mcp-2026-09-23/manifest.json` | **81/81**. |
| G6: copy the committed store to `/tmp`, gunzip every `*.gz` including manifests, regenerate all six specified comparisons, run `test/g6-grader.mjs` | **6/6**. No compressed files remained in the copy before compare generation. |
| `node test/browser/d12-stamp-neutrality.mjs` | **pass**, all six `first_difference` fields null. |
| `node test/browser/mcp-gaps.mjs` | **35/35**. |
| `node test/browser/body-capture.mjs` | **51/51**. |
| `node test/browser/server-outbound.mjs --runs 3 --control` | **186/186**. |

The page budget is for returned stored body content; summaries and metadata can make the complete structured reply larger than 512 KB. The partial body deliberately cannot be reconstructed by a later cursor page, and the text states that loss.

## Banked replay against `39449f7a`

The same black-box `bank-run.mjs` calls were rerun on this branch for final7 without a source root (108 calls), G6 (156), and two bodies-on AnythingLLM stores (97 calls each). Every output JSONL was **byte-identical** to RUN-3's branch replay. Comparing these outputs with RUN-3's archived `main` replay found no missing or extra calls. Thus the prior changed-line counts remain **41, 1, 47, 47** respectively, with no new differences. The final7-with-source-root replay from RUN-3 (41 changed lines) was not rerun here because that source root is in another worktree. These banked calls do not request `include_bodies`; the new scope sentence appears only when that option is true. The four rerun outputs and comparison logs were written under `/tmp`, leaving `grader-scratch/` unchanged.

The count of bodies outside selected windows is limited to stored body rows. An unrecorded browser body cannot be counted or returned.
