# Run 2: `fix/outcome-labels` after the independent grade (2026-09-24)

This run follows `GRADE.md` (`2f10174f`, "merge with changes") and the coordinator's list of 7 changes. RUN.md is unchanged; corrections to it are in `ERRATA.md`. Commits on top of `2f10174f`:
- `6fbb8ce6`: runtime, `form_invalid` scope;
- `05258115`: one episode outcome, mixed statuses, HTTP rule, compare status;
- `38f0cd51`: driver probes, and a rejected submit needs its own receipt;
- `c13e6612`: G4 and skill;
- this evidence commit.

## Changes, by item

1. **`form_validation` only when the browser validated.** `src/runtime-attribution-browser.js` records `form_invalid` only in these cases:
   - a click on a submit button, or Enter in a text field of a form with a default button;
   - the form has no `novalidate`;
   - the submitter has no `formnovalidate`;
   - the form matches `:invalid`.

   It is never recorded on a `submit` dispatch. `dist` was rebuilt (`cmp` identical). Analysis also ignores a `form_invalid` dispatch that a submit on the same form followed.

   The driver adds the grader's two probes. Both are `no_request` on every surface:
   - "Save draft", a `formnovalidate` submitter;
   - "Next", a `noValidate` multi-step form.

   Adding them exposed a second false-reject source in the G5 rule. The driver focused and typed into the draft form after its submit, and that later focus (the `focus_moved_to_invalid_field` receipt of another action) was taken as the submit's validation feedback. `rejectedSubmitMutation` now requires the mutation receipt of the submit's own action. The banked stores are unchanged (G6 rejects 23 → 23).
2. **One label per episode on every surface.** `buildActionChains` (the export) now calls `buildEpisodeChain` on the action's episode, which calls `actionOutcome`. It uses the same episode rule as the store (`episodeForAction`, shared) with `idle: true` and the same `registeredFunctionIds` and `backendInstrumented`. Members get the episode's status, as the MCP gives them today; no member-specific status is invented. The driver checks every action of every kind for one status and one label across all surfaces, the export included. The last run had focusin 18, click 17, submit 3, keydown 1, input 1.
3. **Mixed statuses are stated.** The credited request decides the headline: the engine's latest request with a joined write, else the last. Every other request with a different status, and every other failure, appears as `also <status> <http> <METHOD> <path>` in the label, the sentence, `display.label`, `terminal.label`, the export and the `[outcome …]` bracket, and is listed in `outcome.other_requests`. The rule is documented in the G4 amendment.
4. **`compare_chains`.** `outcome_delta.changed` now includes `status` and `reason`. The driver checks `no_request → rejected_client_side` (changed includes both, and "outcome unchanged" is never printed).
5. **"also" next to a response** lists crash signals only, deduplicated. `form_validation` never appears there.
6. **HTTP semantics.**
   - Safe method (GET/HEAD/OPTIONS/TRACE) with 2xx, or 304, and any joined DB span → `completed`.
   - Unsafe method with 2xx: a joined write → `completed`; reads only → `responded` (`no write observed`).
   - Other 3xx, or any 3xx on an unsafe method → `responded`.

   Written in the G4 amendment and SKILL.md, with a synthetic unit test (`test/mcp.test.mjs`).
7. **Evidence.** Both runs' raw stores are committed gzipped (`git add -f`), and `ERRATA.md` makes the disclosures.

## Commands and counts (all rerun on this head's code)

```sh
node test/browser/outcome-labels.mjs --out docs/evidence/pr-outcome-labels-2026-09-24/run-2   # 145/145 checks pass
npm test                                   # tests 693, pass 692, fail 1 (react-context-ref-semantics, known)
node test/browser/d12-stamp-neutrality.mjs # 17/17 checks true, exit 0
node test/browser/continuations-neutral.mjs  # status ok, runs 5, exit 0
node test/g4-grader.mjs docs/evidence/m1-2026-09-22-final7 --manifest docs/evidence/g4-mcp-2026-09-23/manifest.json --out <scratch>   # result: 81/81
node test/browser/g6-compare.mjs --store <g6store gunzipped> --out <g6out> --pair A-baseline:B-seeded-422 --pair B-seeded-422:C-fix-r2 \
  --pair A-baseline:C-fix-r2 --pair A-baseline:D-noop-refactor --pair A-baseline:E-frontend-early-return --pair B-seeded-422:C-fix
node test/g6-grader.mjs <g6store> --compare <g6out> --out <g6out>/GRADE.md   # Overall: PASS (6/6 pairs)
node grader-scratch/surfaces.mjs --tree . --store <store> [--manifest m] --out <json>   # the grader's black-box surface collector, reused
node grader-scratch/compare-banked.mjs <main.json> <branch.json>
```

The `npm test` count covers the worktree after the grader copied `evaluation/shared-rules/fixtures/node_modules`. Without that copy, the 9 worktree-only `library-program-*` failures of RUN.md return.

**G6 `compare/index.json` vs `main` (`9a8496fb`).** The only difference is `status` (and `reason`) added to `outcome_changed`:
- `A-baseline__B-seeded-422`: `[status, http_status]`
- `B-seeded-422__C-fix-r2`: `[status, http_status]`
- `A-baseline__E-frontend-early-return`: `[status, reason, stage, …]`

`path_changed` and `reasons` are identical for all 6 pairs.

**Banked labels vs `main`.** Every surface was collected by the grader's `surfaces.mjs` (MCP over stdio, viewer record, export).

| store | transitions (main `action_chain\|display` → branch) | MCP/viewer disagreements | export ≠ action_chain | actions with a ≥ 400 in the episode | …whose label states the failure |
|---|---|---|---|---|---|
| final7 (54) | `incomplete\|incomplete→no_request` 41; `completed→completed` 11; `responded\|incomplete→responded\|responded` 2 | 0 | 0 (was 2) | 1 | 1 (`Completed 201: delete conversations; also failed 404 GET /api/messages/…`) |
| G6 (408) | `incomplete→no_request` 54; `responded\|incomplete→responded` 279; `failed\|incomplete→failed` 52; `rejected\|incomplete→rejected` 23 | 0 | 0 (was 300) | 196 | 196 (e.g. `Responded 304: no effect evidence; also failed 500 GET /api/workspace/…/is-agent-command-available`) |

On final7, the grader's raw recompute allows only `completed` for 2 actions that print `responded`:
- `action:mud8t36a:19`, credited `GET /api/agents/tools 200`;
- `action:mud8u6q1:35`, credited `GET /api/agents/chat/active 304`.

The recompute counts DB spans under **any** descendant of the server span. The engine joins only DB spans under a registered handler span (G4 §3.2: reads in Express middleware are not stops). These requests' reads are middleware reads, so `responded` ("no effect evidence") is the engine's rule, unchanged from `main`. Their other requests' `completed` statuses are listed under "also".

**Grader probes rerun** (`grader-scratch/probe-run.mjs` on this code, 39 actions). There are 0 surface disagreements. Labels:

| probe | label |
|---|---|
| redirect | `Stopped at network: more than one server span claims the exact parent; abstained` |
| GET 304 read | `Completed 304: find seats` |
| POST read | `Responded 200: no write observed` |
| write-then-fail and fail-then-write | `Completed 201: insert items; also failed 500 POST /api/reports` |
| fail-then-ok and fast-fail-slow-ok | `Responded 200: no effect evidence; also failed 500 POST /api/reports` |
| throw-string | `no_request` (abstains) |
| throw-object | `handler_threw (Object)` |
| network error | `Stopped at network …; also promise_rejected (TypeError)` |
| formnovalidate and wizard-next (click and submit) | `no_request` |
| invalid-sends (click and submit) | `Completed 201: insert items`, with no validation word |

## Driver cases (run 2), status and label on every surface

| case | status | label |
|---|---|---|
| 2xx + DB-like insert | completed | Completed 201: insert items |
| 2xx, no effect | responded | Responded 200: no effect evidence |
| 409 after a read | failed | Failed 409: POST /api/seats/A/claim |
| 422 / 500 | failed | Failed 422: POST /api/profile / Failed 500: POST /api/reports |
| request, no server span | stopped | Stopped at network: no server span with the exact parent span id arrived in the same trace |
| hit-test early return | no_request | No request: the handler ran and issued no request from instrumented code |
| handler throws / async rejects | rejected_client_side | Rejected by the app: handler_threw (TypeError) / promise_rejected (RangeError); no request |
| error caught by the app | no_request | (as above) |
| app validation (novalidate form, error rendered in the form) | rejected_client_side | Rejected by the app: form_validation; no request (signal: submit's own same-form mutation only) |
| `required` blocks the submit (no submit event) | rejected_client_side | Rejected by the app: form_validation; no request (signal: `form_invalid` on the click) |
| formnovalidate "Save draft" | no_request | No request: the handler ran … |
| noValidate multi-step "Next" | no_request | No request: the handler ran … |
| POST items 201 + POST reports 500 | completed | Completed 201: insert items; also failed 500 POST /api/reports |
| POST that only read | responded | Responded 200: no write observed |
| GET read | completed | Completed 200: find seats |

## Raw stores (gzipped, `git add -f`)

| file | rows | sha256 |
|---|---|---|
| `store/records.jsonl.gz` (run 1, session `s_0528419f`) | 154 | `012c53350bb87239a63c7a6085b6cbfa59c5cefbd607c3568498bccd03aebcd4` |
| `store/spans.jsonl.gz` | 22 | `5b251c2d426d33088c598abf71f0495a265179b0e9d7a0e063c4349eb8d09eb5` |
| `store/runs.jsonl.gz` | 1 | `616626eaa12474dc9f1ae3e45269f368a31829674d94bf56a782f8d9282fbece` |
| `run-2/store/records.jsonl.gz` (run 2, session `s_6056f585`) | 239 | `86310708c58876696d01ec1fdd0a91857220e10cea1741a6db66b3ffc64c7afc` |
| `run-2/store/spans.jsonl.gz` | 41 | `3c666bc2aa819c57bddc97e1236a8dabeac41b35fcc37f2c7fd6bf63e1458e5f` |
| `run-2/store/runs.jsonl.gz` | 1 | `53caf4ada3b771175434a451a9ebc5eac91dd62050df6967b75d7fabc63fbaf0` |

`run-2/outcome-labels-report.json` and `run-2/attribution-manifest.json` go with the run-2 store.

## Residual risks (in addition to GRADE.md's)

- **The same-form-mutation rule can still mislabel a step change.** A request-less submit whose own handler renders validation-like changes inside the same form (for example a multi-step form rendering step 2 inside it) is `rejected_client_side; form_validation`. The driver's "Next" probe renders step 2 outside the form.
- **A redirect never reads completed.** Post-redirect-get writes are `responded` (or `stopped` when the followed redirect puts two server spans on one parent), by the HTTP rule chosen.
- **Middleware reads are not effect evidence.** On a GET whose reads happen in Express middleware, the label is `responded`, not `completed` (the engine's handler-descendant rule).
- **The export assumes a finished store** (`idle: true`). An export taken mid-episode would label a still-arriving episode as final.
- **Members use the carrier's label.** Non-carrier members (focus, keystrokes) carry the episode's label, which names the carrier's request. A member-specific wording waits for `fix/episode-focus`.
