# fix/mcp-surfaces: handoff to the next agent (2026-09-24)

Stopped on the coordinator's instruction (usage). Branch `fix/mcp-surfaces`. The head is the commit that adds this file, and its parent `bc697d0f` is the last code commit. Base: `origin/main` **39449f7a** (#19 function-names, on top of #18 honest-coverage, #17 server-outbound, #16 client-aborts). The grader's commit (`GRADE.md`, originally 4f14e58e) is kept as `a0680e78`. `RUN.md` is immutable. **`RUN-2.md` is not written yet**: the G4 §3.7 post-grade amendment already points to it, so it must be created. Worktree: `/Users/austinho/dev/tracer-n2-mcp-surfaces` (`node_modules` symlinked to the main checkout; untracked `grader-scratch/` holds the grader's probes, which are not committed).

## Grade items (GRADE.md §9)

| item | state | commit(s) | evidence |
|---|---|---|---|
| R1: no `best` from a superseded label | DONE | 6da85961 (`analysis/element-index.mjs` `rankTargetCandidates`: `sigHit` against `latest_sigs`; `mcp/tools.mjs` `stampEvidence` records each key's latest stamp row per page; `resolveElement` prints `Label out of date for <key> (content changed since)`, `labels_out_of_date`) | driver G1a/G1b (index-keyed list, first row removed) |
| R2: opaque responses are not mismatches | DONE | 6da85961 (`bodyFacts` → `browser_status_hidden: "opaque_response"`; `statusMismatch` ignores 0; `statusClause` text "the browser hid the status (opaque response); server answered 302") | driver G2 (`redirect: 'manual'` → 302) |
| R3: nested differences | DONE | 6da85961 + 6591244e (`sideFacts`: `*_nested` [{path,value,peer_values}], `*_differs_unshown`; text `sent opts.sort: asc (vs desc)` / "…only in fields not shown"; SKILL sentence fixed) | driver G3a/G3b; grader probe (a) now reads `sent opts.sort: asc (vs desc)` |
| R4: disclose the nearest continuation | DONE | 6da85961 + 79dda8cd (`analysis/causal-chain.mjs` `issueDeferral`: `basis: "nearest_continuation"`, `continuations` outermost first, `reached_dispatch`, `continuations_stopped`, `basis_text`; the creating frame is the one `function.enter` row of the action with the continuation's spine; `issueDeferralText`) | driver G4a/G4b; grader probe (c) reads "sent 205 ms after the click (nearest continuation: an effect; earlier: a promise continuation at 0 ms, then a timer at 202 ms)" |
| R5: bounded lines | DONE | 6da85961 + 6591244e (32-char value cap, `+N more fields`, `response_shapes` `error: {2 keys}`; a cut value that would read like a peer's shows its tail, `*_fields_clipped`) | driver G5; grader probe (h): 1,013 → 813 chars, and the two same-URL lines now differ (the tails show) |
| R6: `include_bodies` budget | DONE | 6da85961 (`BODY_BUDGET_BYTES` 512 KB, `budgetBodies`, strictly newest first; `bodies_full {budget_bytes, bytes, with_full_bodies, cut, next_until, note}`; `recent_actions` the same with `cut_in_actions`) | driver G6 (150 × ~4 KB; `until=next_until` pages); `test/mcp.test.mjs` "reply budget" (`recent_actions`, 600 × 4 KB) |
| R7: disclose unused `nearby_text` | DONE | 6da85961 (`ignored[] {input: "nearby_text"}` + text "nearby_text ignored: no candidate's own label and no stamped ancestor's label matches it …"; SKILL step 3 caveat) | driver G7 (unstamped lane rows) |
| Extra: status-like object values | DONE | 6da85961 (`response_shapes`) | G5; probe (b) prints `status: <301 chars>, error: {3 keys}, state: {1 keys}` |
| Extra: outermost issuer frame always shown | DONE | 6da85961 (`framesText`: innermost 5, `… +N more`, outermost) | `test/mcp.test.mjs` "reply budget … issuer over 6 frames" |
| Extra: justify `revision`/`rev`/`version` | DONE in code comment (`STATUS_SEGMENTS` in `mcp/tools.mjs`) | 6da85961 | still owed in RUN-2.md prose |
| Extra: `response ids` on page_requests/unlinked lines listed | NOT STARTED (a RUN-2.md item only) | | |
| Extra: M10 regex per segment | DONE | 584bd509 (`test/browser/body-capture.mjs`) | body-capture 51/51 |
| Extra: fields scope stated | DONE | 6591244e (`fields_compared_with {scope: episode \| unlinked_window \| listing, peers}`; page_requests now compares attributed requests within the listing too) | |

## Rebase and integration points (all done; keep them on the next rebase)
- **#18 honest-coverage.** `page_requests` wording is main's (`not attributed to any user action; <issuer>`). The issuer text keeps #18's prefix `no first-party frame recorded for this request`. The old cause-claiming parenthetical `(issued outside any action)` is replaced by `(none was on the stack when it was sent)` (a0c8e603). #18's `honest-coverage.mjs` P1 passes, and `mcp-gaps.mjs` U4 is updated. Bodies on unlinked entries decorate #18's window listing in `chainStops` (`withUnlinkedBodies`) without changing the listing. `requestSegmentCore` takes both `windowRoots` (#18) and `issue` (this branch).
- **#19 function-names.** Issuer chains and the work listing print `functionInfo().label`, which is `display_name file:line`. `issuer_frames` entries add `display_name` and `name_status` (bc697d0f).
- **#17 server-outbound.** Hop segments carry no body fields, because no hop body rows are recorded. This is stated in G4 §3.7. If hop bodies ever exist, pass them through `bodyFacts`/`summarizeBody`.
- G4: this branch's amendment is **§3.7** (after #17 §3.5 and #18 §3.6), with the post-grade amendment appended.

## Verification state
- **On base 3123791c (before the #19 rebase, same code minus bc697d0f and 79dda8cd):**

  | check | result |
  |---|---|
  | npm test | 724, 1 known fail (`react-context-ref-semantics`) |
  | G4 | 81/81 |
  | G6 | 6/6 |
  | D12 | pass |
  | continuations-neutral | ok |
  | episode-focus ×3 | ok |
  | outcome-labels | 169/169 |
  | mcp-gaps | 35/35 |
  | body-capture | 51/51 |
  | middleware-reads ×3 | 343/343 |
  | client-aborts | 245/245 |
  | server-outbound | 154/154 |
  | honest-coverage | 45/45 |
  | grader probe drivers (probe, probe2) | exit 0 |
  | mcp-surfaces ×3 | 115/116 |

  The one mcp-surfaces failure was a driver bug, not a product bug: G4b used the creating frame's time instead of the first frame on the timer continuation (call-site proxy 1 ms earlier). It is fixed in 79dda8cd, and that run then passed 8 single runs.
- **On 39449f7a (this head):** only `npm test` has run: 732 tests, 1 known fail. **The rest of the set is owed on this head** (commands below). `npm run build` and `cmp` show dist identical to src.
- **Banked diffs vs main** (final7, G6, anything-llm bodies-on ×2) were run on the 3123791c head.
  - Invariants are unchanged: stops, frontiers, outcome labels, compare verdicts, `best`.
  - resolve_element text changes only by `nearby_text ignored: …` on the one `{element_path, nearby_text: "Save"}` probe (final7, G6).
  - Deferral text on final7:
    - 63 segments;
    - 33 read `via a promise continuation`;
    - 30 read `(nearest continuation: a promise continuation; earlier: …)` or `(… earlier ones not identified)`;
    - `continuations_stopped` is "N recorded frames could have created the promise continuation" for 15 of them.
  - Redo the banked diffs on 39449f7a for RUN-2.md.
- The grader's `audit.mjs` (untracked, grader-scratch) reports 18 "findings" on the probe store. All are format differences from the new clause shapes, not unbacked clauses: nested `(vs …)`, `+N more`, the `…` cap, `{n keys}` shapes, and the new deferral format. It needs its clause parser updated before it can serve as a regression check.

## Commands
```sh
cd /Users/austinho/dev/tracer-n2-mcp-surfaces
node test/browser/mcp-surfaces.mjs --runs 3            # 116 checks (38 per run + 2 stability); --keep keeps stores
npm test                                              # 1 known failure: react-context-ref-semantics
node test/g4-grader.mjs docs/evidence/m1-2026-09-22-final7 --manifest docs/evidence/g4-mcp-2026-09-23/manifest.json   # 81/81
# G6: copy docs/evidence/g6-anything-llm-2026-09-23/store to <g6store>, gunzip *.gz AND manifests/*.gz, then
node test/browser/g6-compare.mjs --store <g6store> --source-root /Users/austinho/dev/fixtures/anything-llm --out <cmp> --pair A-baseline:B-seeded-422 --pair B-seeded-422:C-fix-r2 --pair A-baseline:C-fix-r2 --pair A-baseline:D-noop-refactor --pair A-baseline:E-frontend-early-return --pair B-seeded-422:C-fix
node test/g6-grader.mjs <g6store> --compare <cmp>     # 6/6
for t in d12-stamp-neutrality continuations-neutral outcome-labels mcp-gaps body-capture client-aborts server-outbound honest-coverage function-names; do node test/browser/$t.mjs; done
node test/browser/episode-focus.mjs --runs 3; node test/browser/middleware-reads.mjs --runs 3
node grader-scratch/probe-driver.mjs; node grader-scratch/probe2-driver.mjs   # grader probes (untracked)
npm run build && cmp src/runtime-attribution-browser.js dist/runtime-attribution-browser.js
# banked text diffs: docs/evidence/pr-mcp-surfaces-2026-09-24/bank-run.mjs + bank-diff.mjs, main from `git archive origin/main`
```
The bodies-on anything-llm stores used for the banked diffs are not in the repo. Copies are in the orchestrator's scratchpad (`…/scratchpad/allm-store`, `allm2-store`).

## Known traps
- `gunzip` the G6 manifests too (`manifests/*.json.gz`). Without them, g6-grader fails D and E (remap basis `content_hash`).
- The machine load was about 40 (other agents), so fixture timings are slow. The driver waits 1.5 s after Star (the burst of 140 PUTs) and 2.5 s after Load many.
- The driver builds a merged dependency root: LibreChat `node_modules` symlinks plus *copies* of wouter, regexparam and TanStack Query v5 from the main checkout. This yields one React. Do not symlink those packages.
- Playwright selectors in the driver must stay unique (`getByRole('listitem', { name: 'Task Beta' })`): the page has two lists with Beta rows.
- `test/no-false-negatives.test.mjs` compares the chain record's unlinked listing with the MCP's minus the body keys (`BODY_FIELDS`). Add any new unlinked key there.
- Never rebase while a grader is on the branch. Keep the grader's GRADE.md commit.
- Commit trailer used after the coordinator's rewrite: `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## What remains
1. Run the full keep-green set on this head (39449f7a base). Redo the banked diffs.
2. Write `RUN-2.md`. It must include:
   - the seven items with evidence;
   - the `revision`/`rev`/`version` justification;
   - the new `response ids` / `sent` / `answered` / status clauses on `page_requests` and unlinked lines on the bodies-on stores;
   - the banked text changes above;
   - the 1/13 flaky run and its fix (79dda8cd);
   - the audit-parser note.
3. Optionally, update `grader-scratch/audit.mjs` for the new clause shapes and rerun it (0 unbacked expected).
