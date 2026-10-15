# Errata for g1-2026-09-23c

This file was added after the independent grade (`docs/evidence/g1g3-grade-independent-2026-09-23/GRADE-g1g3-independent.md`). The rest of this directory is unchanged. The fixes and the rerun are in `docs/evidence/g1-2026-09-23d/`.

## Corrections to RUN.md

1. **"0 route/handler/db stops".** True only if the 175 frontend credit abstentions are excluded: those chains carried `stopped_at: "handler"`, the name of the backend handler stop. The evidence plan also says every non-request action ends `browser`.
   - From the fourth pass on, the abstention stops at `entry_handler` (coordinator decision; G1 and G4 gate docs amended).
2. **Round-three item 1 (negative controls).**
   - `/api/unrelated` is a *child* of the receipted `Delayed`, not a sibling.
   - The sibling, late-mount and poll negatives all fired *before* the first click, so they tested nothing about receipts.
   - The receipt mechanism itself misattributed in two patterns, both reproduced by the grader in 5/5 runs:
     - a no-op setter followed by an unrelated re-render;
     - two setters in one handler, followed by a later commit.
   - Fixed in the fourth pass; negatives now overlap every action (see `g1-2026-09-23d`).
3. **Drift "0 unexplained" was overstated.** Final7 ids filed as "abstained_not_a_function" include real functions that the build dropped:
   - the grader counts 38;
   - my own nearest-function scan finds 18, mostly state-updater arrows in inline handlers such as `(prev) => !prev` and `(value) => !value`.

   The boundary rule resolved each updater to its enclosing handler, whose id already existed. Fixed in the fourth pass and added to the regression list.
4. **Agent chat, "messages in window".** Those messages were deleted by step 10 (delete flow). Only the transactions written for that conversation confirm the agent-chat write.
5. **Span neutrality.** Only the summary was recorded; the placements/await-off manifest was not. `g1-2026-09-23d` records it.

## Corrections to LIMITS.md

1. **Receipt lifetime.** LIMITS omitted three gaps. All three are fixed in the fourth pass.
   - A no-op setter left a receipt that a later re-render consumed.
   - A second receipted hook on the same fiber survived to a later commit.
   - A receipt could be taken from a bare dispatch frame.
2. **Rejected awaits.** On a rejected `await`, the resumption helper never ran, so `catch`/`finally` blocks ran on the ambient frame. This was not listed. Fixed in the fourth pass.
3. **Stamp counter off-by-one.** The same one-row difference also exists on the stamp counter (expected 782 vs 781 received; 789 vs 788).
4. **Programmatic focus.** A `focusin` caused by programmatic autofocus is a trusted event and starts an action. It replaced login's frame and produced a pseudo-action (`GET /api/agents` @28480 credited to a focusin 373 ms after login). Not changed; now listed in LIMITS.
