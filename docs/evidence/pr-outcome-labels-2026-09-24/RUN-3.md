# Run 3: `fix/outcome-labels` after the regrade (2026-09-24)

This run follows the regrade section of `GRADE.md` (`868a1eab`, "merge with changes": one required change and two small fixes). RUN.md, RUN-2.md and ERRATA.md are unchanged. Commits on top of `868a1eab`:
- `90cc1dd7`: rule, tests, gate amendments, G6 grader, and the two small fixes;
- `3f2aca31`: driver probes;
- this evidence commit.

## Changes

1. **Required: a same-form reject needs validation feedback.**
   - **New rule.** `rejectedSubmitMutation` (`analysis/runtime-attribution.mjs`) now admits a rejected submit only when the submit's own same-form receipt shows one of: `validation.feedback_mutations > 0`, `validation.aria_invalid_changed`, or `validation.focus_moved_to_invalid_field`. It no longer admits a bare `form_mutation.count > 0` / `same_form`. Otherwise the submit is `no_request`, and the sentence reads "the handler ran and issued no request from instrumented code".
   - **Unit test.** A new test in `test/runtime-attribution.test.mjs` covers the bare-mutation case, each of the three feedback signals, and another action's feedback. The two synthetic reject rows in the existing tests now carry `feedback_mutations: 1`.
   - **Gate amendments.** G4 has a dated amendment ("same-form reject rule abstains without validation feedback"). G6 has a new §12, which states that scenario E moves from `stopped at validation` to `stopped at browser` / `no_request`, and why: abstain over guess. The banked G6 evidence is not edited.
   - **G6 grader.** `test/g6-grader.mjs` now states E's expectation: the request stop is `removed`, `request` is among the path-change reasons, and the after `stopped_at` is `browser`.
   - **Driver.** Both of the grader's inner-step probes are added and both are `no_request`:
     - "Next inside": a `noValidate` form that renders a step-2 input inside itself.
     - "Next inside validated": a valid, validating form that renders `<p>Step 2 of 3</p>` inside itself.

     Each receipt is `same_form: true` with no feedback. The driver's real validation case (`Profile`, whose receipt has `feedback_mutations > 0`) keeps `rejected_client_side; form_validation`, and the driver checks this.
2. **SKILL.md** now says "a safe method (GET/HEAD/OPTIONS/TRACE) answered 2xx or 304", and states the feedback rule for `form_validation`.
3. **`compare_chains` summary** renders a missing outcome field as `null`. It printed `undefined` before.

## Commands and counts (this head's code)

```sh
node test/browser/outcome-labels.mjs --out docs/evidence/pr-outcome-labels-2026-09-24/run-3   # 160/160 (session s_f9e7cc6e; actions focusin 20, click 19, submit 5, keydown 1, input 1)
npm test                                   # tests 694, pass 693, fail 1 (react-context-ref-semantics, known; fixture deps copied as in RUN-2)
node test/browser/d12-stamp-neutrality.mjs # 17/17, exit 0
node test/browser/continuations-neutral.mjs  # status ok, runs 5, exit 0
node test/g4-grader.mjs docs/evidence/m1-2026-09-22-final7 --manifest docs/evidence/g4-mcp-2026-09-23/manifest.json   # 81/81
node test/browser/g6-compare.mjs --store <g6store> --out <g6out> --pair … (6 pairs) && node test/g6-grader.mjs <g6store> --compare <g6out>   # PASS 6/6
cmp src/runtime-attribution-browser.js dist/runtime-attribution-browser.js   # identical (src not changed in this round)
```

**G6 after the change.**
- `compare_chains(A-baseline, E-frontend-early-return)`: `path_changed: true`, reasons `request, route, handler, outcome`. The request stop `POST /api/workspace/tracer-g2/update` is `removed`. `outcome_delta.changed` is `status, http_status, stop_reason, stopped_at, reached`. The after `stopped_at` is `browser` and the after outcome is `no_request`. The grader's new E expectations pass.
- `compare/index.json` vs `main`:
  - A→B and B→C-fix-r2 gain `status` in `outcome_changed`, as in run 2.
  - A→E's list is now `status, http_status, stop_reason, stopped_at, reached`. It was `status, reason, stage, …` in run 2: `stage` and `reason` are gone because both sides now have stage `stopped` and neither side is a reject.
  - `path_changed` and `reasons` are identical for all 6 pairs.

**Banked labels vs `main`** (grader's `surfaces.mjs` plus `compare-banked.mjs`):
- final7: same as run 2. `no_request` 41, `completed` 11, `responded` 2. 0 surface disagreements, 0 export ≠ MCP. The one episode with a 404 states it.
- G6: `no_request` 54, `responded` 279, `failed` 52. The 23 former `rejected_client_side` actions (all in scenario E's one episode, `action:mue4q5xu:65`) are now `no_request|no_request`. There are 0 surface disagreements, 0 export ≠ MCP, and all 196 actions whose episode has a request ≥ 400 state it.
- The grader's raw recompute still encodes the old any-mutation rule, so it reports those 23 as "not allowed". That is the intended change, not a regression. The 2 final7 middleware-read cases are as in RUN-2.

**Grader probes rerun** (`grader-scratch/probe-run.mjs`, 49 actions): 0 surface disagreements.
- Click and submit are `no_request` (stopped at browser) for `save-draft`, `wizard-next`, `inner-next` and `inner-next-validated`.
- `enter-field` (Enter in an invalid, validating form; no submit fired) keeps `rejected_client_side; form_validation` through `form_invalid`.
- `invalid-sends` stays `completed 201`.

## Raw store (run 3, gzipped, `git add -f`)

| file | rows | sha256 |
|---|---|---|
| `run-3/store/records.jsonl.gz` | 266 | `5b9c5ced022b29e815c3a0deaee4a2b7c71c380317838d8c447fcb33d314468b` |
| `run-3/store/spans.jsonl.gz` | 41 | `cb464c32b3196ff714322607df51816987618658963e3cbc913d305792325794` |
| `run-3/store/runs.jsonl.gz` | 1 | `d9939e9362c19039b0ed18b374dcffb419f2a3c6f01a3ee06e5b2f0bf64a9d76` |

`run-3/outcome-labels-report.json` and `run-3/attribution-manifest.json` go with this store.

## Residual risks

- **Validation messages without accessibility markup are not seen.** An app that shows its message without `role=alert`/`status`/`aria-live`, and without `aria-invalid` or moving focus, now reads `no_request`. That abstains, which is the intended direction, but it understates a real rejection.
- **The rest is unchanged from RUN-2.md and GRADE.md:**
  - the export assumes a finished store;
  - members carry the carrier's label;
  - server spans are trusted as the response;
  - followed redirects abstain;
  - thrown primitives abstain;
  - middleware reads are not effect evidence.
