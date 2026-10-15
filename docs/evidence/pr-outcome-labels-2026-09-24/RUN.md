# Run: `fix/outcome-labels` (2026-09-24)

Claim (one PR, one claim): **every outcome label Tracer prints tells the truth about the response and about the app's own decision.**

Branch `fix/outcome-labels`, based on `main` at tag `fixes-2026-09-24` (`8a84cfee`). Gate text: `docs/gates/G4-mcp.md`, amendment "2026-09-24, `fix/outcome-labels`" (committed before the code). This directory is new and immutable once committed; nothing in another evidence directory was touched.

## What changed

- **One label function.** `actionOutcome(record, { backendInstrumented })` in `analysis/causal-chain.mjs` computes the label set from a chain's own steps. Its callers:
  - `buildEpisodeChain`: sets `chain.outcome`, `chain.display.status`, `chain.display.label` and `chain.terminal.label`. The live viewer (`test/browser/server.mjs` → `fiber-demo.js`) prints these, and the MCP returns them as `chain`.
  - The MCP (`mcp/tools.mjs`): `outcome` on `action_chain`, on every `element_history` action and attempt, on `recent_actions` rows (new) and on `compare_chains` `before`/`after`. Each request segment's `outcome` uses the same function on that request's own steps.
  - `buildActionChains`: exported `producttrace.action-chain.v1` rows gain `outcome`.

  Every summary bracket is rendered by `outcomeText`. `outcome.display_status` is an alias of `status` and can no longer disagree with it. `route.dispatch` rows now carry the joined server span's `status_code`, so the label is computed from the chain alone.
- **Label set**: `pending | rejected_client_side | failed | completed | responded | stopped | no_request`. The full definitions are in the G4 amendment.
- **Reject signals, recorded by the runtime.** Every signal field is additive and is written only when true:
  - `function.exit` gains `threw: true` and `error_type` (the constructor name, never the message). The transform adds `catch(e){threw(frame,e);throw e}` to each instrumented function's existing `try/finally`.
  - `action.uncaught_error` `{action_id, via: uncaught_exception | unhandled_rejection, error_type, function_id, continuation_id}`. It is written when the page's own `error` or `unhandledrejection` event carries an error object that an action-owned first-party frame threw. The join is by object identity, never by time.
  - `dom.action.form_invalid` is written when a submit-capable dispatch's form matches `:invalid` at dispatch. This is a CSS match, so no `invalid` events fire.

  `dist/` was rebuilt, and `cmp src/runtime-attribution-browser.js dist/runtime-attribution-browser.js` shows the two files are identical.
- **Live viewer adapter** (`test/browser/fiber-demo.js`): a card counts as "terminal result proven" only when the outcome is `completed`. A 409 is no longer a completed effect card. The outcome sentence appears as a fact.
- **Skill** (`plugin/skills/tracer-annotations/SKILL.md`): a new honesty rule for each status word.

## Commands and counts

```sh
node test/browser/outcome-labels.mjs --out docs/evidence/pr-outcome-labels-2026-09-24   # 105/105 checks pass (this directory)
npm test                                  # tests 692, pass 682, fail 10: identical set to the base (see below)
node test/g4-grader.mjs docs/evidence/m1-2026-09-22-final7 --manifest docs/evidence/g4-mcp-2026-09-23/manifest.json --out <scratch>   # result: 81/81
node test/browser/d12-stamp-neutrality.mjs    # 17/17 checks true, exit 0
node test/browser/continuations-neutral.mjs   # status ok, 5 runs, exit 0
# G6: gunzip docs/evidence/g6-anything-llm-2026-09-23/store/{*.jsonl.gz,manifests/*} into <g6store>, then
node test/browser/g6-compare.mjs --store <g6store> --out <g6out> --pair A-baseline:B-seeded-422 --pair B-seeded-422:C-fix-r2 \
  --pair A-baseline:C-fix-r2 --pair A-baseline:D-noop-refactor --pair A-baseline:E-frontend-early-return --pair B-seeded-422:C-fix
node test/g6-grader.mjs <g6store> --compare <g6out> --out <g6out>/GRADE.md   # Overall: PASS (6/6 pairs)
```
The G6 grader needs `<store> --compare <dir>`. The handoff's bare `node test/g6-grader.mjs` form throws a usage error. The regenerated `compare/index.json` is byte-identical to the one produced the same way by the `main` checkout (`9a8496fb`), so `path_changed`, the reasons and `outcome_delta.changed` did not change. It differs from the committed G6 `index.json` only by `reached` in one `outcome_changed` list, which is PR #4's addition and not this branch's.

About `npm test`: the base (`8a84cfee` in this worktree) also fails the same 10. One is the known `react-context-ref-semantics` failure. The other nine are `library-program-experiments` (7) and `library-program-intrinsics` (2), and they fail only in worktrees: `evaluation/shared-rules/fixtures/node_modules` is untracked and exists only in the main checkout, and a symlink to it is rejected as `implementation_outside_installed_dependencies`. Both files pass in `/Users/austinho/dev/tracer`. This branch touches none of their code.

Other headless browser checks run on this branch:
- Pass: `worker-frontier`, `no-cross-control-neutral`, `effect-rooted-form-neutral`, `shadow-dom-context`, `stable-element-keys`.
- `unlinked-coverage-neutral` passes 12/13. It fails A8 exactly as on `main` (`9a8496fb`): the check still expects the worker transport to be unobserved, but the worker-frontier PR wraps `Worker`. That failure predates this branch and is out of scope.

## The fixture and what it proves

- `test/browser/fixtures/outcome-labels-app/main.jsx`: a neutral React app with one control per outcome.
- `server.mjs`: an Express backend run under `node --import producttrace/backend/register`. Its "database" is a `Map` wrapped in client spans that carry `db.system`.
- The driver (`test/browser/outcome-labels.mjs`):
  - builds the app with both plugins;
  - ships rows through the real collector sink into a real store, and ships spans to the same store;
  - proxies `/api/*` with every header, and answers `/api/untraced` itself, so that request has no server span;
  - checks every surface against the rows.

  Its output is in `outcome-labels-report.json`. The raw store and the build's attribution manifest are in `store/` and `attribution-manifest.json`, for independent recomputation.

Same rows, base code (`8a84cfee`, MCP `action_chain`) vs this branch:

| case | base: `outcome.status` / `chain.display` | branch: status / label | branch summary bracket |
|---|---|---|---|
| 2xx + DB-like insert span | completed / completed "Effect: insert items" | completed / Completed 201: insert items | `[outcome completed 201]` |
| 2xx, no effect | responded / **incomplete** "Stopped: no database effect…" | responded / Responded 200: no effect evidence | `[outcome responded 200; no effect evidence]` |
| **409 after a DB read** | failed / **completed "Effect: find seats"** | failed / Failed 409: POST /api/seats/A/claim | `[outcome failed 409]` |
| 422 | failed / incomplete | failed / Failed 422: POST /api/profile | `[outcome failed 422]` |
| 500 | failed / incomplete | failed / Failed 500: POST /api/reports | `[outcome failed 500]` |
| request, no server span | incomplete / incomplete | stopped / Stopped at network: no server span with the exact parent span id arrived in the same trace | `[outcome stopped at network]` |
| hit-test early return ("Seat B is taken" in the DOM) | **incomplete** "Stopped: no effect after dispatch" | no_request / No request: the handler ran and issued no request from instrumented code | `[outcome no_request; the handler ran … (2 functions entered, 1 DOM mutation, 0 state effects)]` |
| handler throws `TypeError` | incomplete / incomplete | rejected_client_side / Rejected by the app: handler_threw (TypeError); no request | `[outcome rejected_client_side; handler_threw (TypeError)]` |
| async handler rejects `RangeError` | incomplete / incomplete | rejected_client_side / … promise_rejected (RangeError) … | `[outcome rejected_client_side; promise_rejected (RangeError)]` |
| error thrown and caught by the app | incomplete / incomplete | no_request (a frame's `function.exit` says `threw: SyntaxError`, but nothing escaped, so no reject is claimed) | `[outcome no_request; …]` |
| submit stopped by app validation (noValidate) | rejected_client_side / incomplete | rejected_client_side / Rejected by the app: form_validation; no request | `[outcome rejected_client_side; form_validation]` |
| submit blocked by `required` (no submit event) | incomplete / incomplete | rejected_client_side (signal: `form_invalid` on the click) | `[outcome rejected_client_side; form_validation]` |

The driver also checks the following:
- The status is identical on `action_chain`, `display_status`, `chain.display`, `chain.outcome`, `recent_actions`, `element_history` (action and attempt), `compare_chains` (before and after), the live viewer record (`buildEpisodeChain`, idle) and the exported action chain.
- The viewer label equals the MCP label.
- For every ≥ 400 and every reject, "completed" appears nowhere in the full JSON of those surfaces.
- "incomplete" appears nowhere.
- Every `rejected_client_side` has a recorded signal.
- Every ≥ 400 segment is `failed` with its status.
- No row contains the error messages.
- The page errors are exactly the two uncaught ones.
- With the same rows loaded as a frontend-only store (no spans), all 6 request-bearing episodes are `stopped` at network with `backend not instrumented`.

Banked stores, base vs branch (`action_chain` for every action, `outcome.status | chain.display.status`):
- final7: base `incomplete|incomplete` 41, `completed|completed` 11, `responded|incomplete` 2 → branch `no_request|no_request` 41, `completed|completed` 11, `responded|responded` 2.
- G6: base `incomplete|incomplete` 54, `responded|incomplete` 279, `failed|incomplete` 52, `rejected_client_side|incomplete` 23 → branch `no_request` 54, `responded` 279, `failed` 52, `rejected_client_side` 23. In every case the display agrees with the status. All 23 rejects carry a `submit_rejected` signal. No action or segment with status ≥ 400 is anything but `failed`.

## Decisions

- **`stopped` is the frontier label.** A request that left the page and stopped without an HTTP status (no exact-parent server span, backend not instrumented, a server span with no status) carries `stopped_at` and `because` in the frontier's own words. So do a request-less `worker` stop and an `entry_handler` abstention. The old segment words `no_server_span`, `backend_not_instrumented` and `no_status` became `stopped`, with `stopped_at` saying where.
- **`no_request` covers every other request-less action.** It never says `incomplete` or `completed`. When at least one action-owned `function.enter` row exists, the sentence says "the handler ran and issued no request from instrumented code". Otherwise it says "no instrumented function ran for this action", because the app's decision cannot be claimed there either. The counts are `functions_entered`, `dom_mutations` (the sum of the receipt counts) and `state_effects` (action-owned `function.enter` rows with `invoked_by: "effect"`, i.e. effects run under a state-update receipt; the runtime writes no separate receipt row).
- **The response decides a request-bearing action.** An uncaught error after a request is listed in `signals` and in the bracket (`; also handler_threw (TypeError)`), but it never replaces `failed` or `completed`.
- **Reason order.** When several signals exist, `reason` is `handler_threw`, then `promise_rejected`, then `form_validation`, because a crash is what the reader most needs to see. `signals` keeps all of them.
- **`outcome.status` is not in `compare_chains` `outcome_delta.changed`.** The field list stays `stage, http_status, stop_reason, stopped_at, reached, writes`, so G6 path verdicts are unchanged. `before.outcome` and `after.outcome` show the new words.
- **`describeEpisodeEvidence` keeps its engine state.** Its `status` and `label` still exist as internal state (tests use them), but no reader prints them. `display.stage` stays the engine stage (e.g. `effect` for the 409 whose handler read the database) and is not a label.
- **The store passes `backendInstrumented` to `buildEpisodeChain`.** Previously only `chainFrontier` got it, so a frontend-only store's `chain.display` said "no exact-parent server span" while its frontier said "backend not instrumented". Now both say the latter.
- **Cycle-safe import.** `analysis/runtime-attribution.mjs` imports `actionOutcome` from `causal-chain.mjs`, which imports runtime-attribution back. `FRONTIER_BECAUSE` became lazy (`FRONTIER_BECAUSE_OF()`) so that nothing imported is read while either module evaluates.

## Residual risks

- **`form_validation` from a same-form mutation is the G5 rule, unchanged.** A request-less submit followed by a validation-shaped mutation on the same form is labelled rejected. A multi-step form whose "next" submits, renders step 2 in the same `<form>` and sends nothing would therefore read `rejected_client_side; form_validation`. It is recorded evidence, but it is not proof of a rejection. `form_invalid` (`:invalid` at dispatch) sees only constraint validity, so a JS-only validator that never calls `setCustomValidity` is seen only through the mutation rule.
- **`handler_threw` needs an object error that passed through an instrumented frame and reached the page's `error` event.** Three cases are missed:
  - `throw "string"`, which cannot be keyed by identity;
  - an error thrown and escaping only through uninstrumented code;
  - an `unhandledrejection` that fires after the page has gone.

  In each case the label falls back to `no_request` (abstain). Tested on React 18.3.1, production build. React 19 reports handler errors through `reportError`, which also fires `error`, but this was not run.
- **Instrumented code changed shape.** Each instrumented function gains a `catch` that rethrows the same object. Control flow, stack and identity are unchanged. A debugger set to "pause on caught exceptions" will stop there, and an async arrow with an expression body (`async () => expr`) does not see a rejection of `expr` (abstain).
- **`no_request` is now the most common final7 label (41 of 54).** That includes focus and dispatch-only actions whose sentence is "no instrumented function ran". Those actions are correct, but they are many.
- **Older surfaces still print their own words.** They are not routed through `actionOutcome`:
  - the legacy bridge workflow path (`src/producttrace-runtime.js` workflow `completed`/`incomplete` statuses, `test/browser/bridge-workflow.mjs`);
  - the LibreChat live harness scripts that read `workflow_status` (`m1-live-*`).

  They describe product workflows, not causal-chain outcomes. They were not run here, because they need the LibreChat stack.
- **The superseded definitions are still in the gate doc.** `docs/gates/G4-mcp.md` §3.1 still carries the `fix/mcp-rendering` text for `outcome.status` and `display_status`. The new amendment states that it supersedes those lines instead of editing them.
- **No independent grade yet.** This run was written by the implementer. The fixture assertions share `HANDLER_RAN_NO_REQUEST`, `SCOPED_ABSENCE` and `OUTCOME_STATUSES` with the code. The raw store is here, so a grader can recompute every label from `records.jsonl` and `spans.jsonl`.
