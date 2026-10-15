# fix/function-names: run evidence, round 2 (2026-09-24)

This round applies the independent grade's three required changes (`GRADE.md` at ed31ae99, the grader's commit, kept). The branch is then rebased onto `main` 9ad0f210 (#16 client-aborts, #17 server-outbound). Written by the implementing agent. RUN.md is unchanged. The fixture report for this round is `function-names-report-2.json`.

## Changes

1. **Callback names resolve through bindings, not names alone** (grade item 1; `integrations/function-names.mjs`).
   - Every binding in the file is recorded: function declarations, `var`/`let`/`const` (object and array patterns included), parameters (destructured included), imports (default, named, namespace, `import =`), class, enum and namespace names, catch and loop variables, and function-expression names.
   - A callback takes the callee's parameter name only if all three hold:
     - the callee's name has exactly one binding in the file;
     - that binding is a function (a declaration or `const/let/var f = fn`);
     - the binding's scope (its block, or its function for `var` and hoisted declarations) encloses the call.
   - Anything else abstains: `name: null`, `<callback of f>`.
   - The grader's four shapes are in the fixture (`src/callees.ts`: imported callee, destructured variable, destructured prop, local-plus-destructured `update`) and in `test/function-names.test.mjs`, together with an out-of-scope callee and the positive cases. On the grader's `probe-app/src/probes.ts`, the build rule now gives `<callback of runLater>` and `<callback of schedule>`, where it used to give `misnamed` and `wrongParam`.
   - Newly strict: a file with two functions of the same name (e.g. two components' local `update`) names neither one's callbacks.
2. **Remap ignores the export decoration** (grade item 2; `collector/store.mjs`).
   - `name_match` compares the qualified display name without ` (exported as …)`.
   - The grader's `remap-probe.mjs` now maps both ways by `name_match`.
   - New unit test: adding or removing `export default handleUpdate`.
3. **`inferred` has one meaning** (grade item 3; `collector/store.mjs`, skill, G4 revision).
   - `inferred` always means no name of its own: the function was passed to a call whose result is bound. `name` is null, `bound_to` holds the binding, and the label is unchanged.
   - Old-store text-rule names that are the function's own are now `inferred_from_source_text`: a usable name, not verified by a build.
   - On final7, the 213 via-call rows (`confirmDelete (via useCallback)`) now have `name: null` and `bound_to: "confirmDelete"`. Their labels are unchanged.
   - The skill says how to report both statuses.
4. **Disclosures** (G2 revision): instrumented builds keep unused first-party classes and their imports (grader: +576 B fixture, +178 B anything-llm). Two boundary gaps leave functions uninstrumented, on `main` too, and need their own claim:
   - type-argument calls (`forwardRef<A, B>(…)`, `useMemo<T>(() => …)`; LibreChat 86 + ~52 sites);
   - `export default () => …`.

   The module comment no longer lists `export default () => …` as an `export_alias` example.

## Rebase onto 9ad0f210

Conflicts were in `analysis/causal-chain.mjs` and `analysis/runtime-attribution.mjs`. Main's `input`/`mergeRequestFacts`, server hops and `hopSegments` were kept, and the `errorClassName` option was added to both. `mcp/tools.mjs` merged cleanly. `npm run build` + `cmp src/dist runtime`: identical.

## Checks (sequential, on the rebased head)

| check | result |
|---|---|
| `function-names.mjs` (dev, prod, dev server) | **263/263**. Production vs development: 75/75 shared ids with identical names. Production vs dev server: 75/75. Marker gate passes on both builds. Production `ApiError` reads `{minified:"Lt", source:"ApiError"}`. |
| `npm test` | 731 tests, 730 pass. The one failure is the known `react-context-ref-semantics`. |
| G4 grader | 81/81 |
| G6 compare regenerated (6 pairs) + `g6-grader.mjs` | 6/6. Compare JSON vs `main` 9ad0f210 is identical once the name fields and `server_args` are ignored (7/7 files). |
| D12 | pass (23/23) |
| `continuations-neutral` | **flaky, and it fails on `main` too.** In the sequential run it failed `/api/cross-timer ran after action B started`. Two reruns on the branch: 1 pass, 1 same failure. Four runs of `main` 9ad0f210 (git archive): 2 pass, 2 the same failure. A timing assertion, not this branch. |
| `episode-focus` | ok, 3 runs, stable |
| `outcome-labels` | 169/169 |
| `mcp-gaps` | 35/35 |
| `body-capture` | 51/51 |
| `middleware-reads` | 343/343 |
| `client-aborts` | 245/245 |
| `server-outbound` | 154/154 |

## Banked stores vs `main` 9ad0f210 (reader only; `banked-names.mjs`)

| store | functions | name changed | label changed | status moves | action texts changed |
|---|---|---|---|---|---|
| final7 | 1,640 | 213 (via-call bindings → `null`, kept in `bound_to`) | 0 | 433 `source`→`inferred_from_source_text`, 213 `source_via_call`→`inferred` | 0 / 54 |
| G5 23c | 5,101 | 0 | 0 | 1,807 `manifest`→`inferred_from_source_text` | 13 / 151: only the listener line |
| G5 codex part B | 5,101 | 0 | 0 | 1,807 `manifest`→`inferred_from_source_text` | 19 / 78: only the listener line |
| G6 | 5,109 | 0 | 0 | 1,811 `manifest`→`inferred_from_source_text` | 0 / 408 |

No label and no printed text changed apart from the listener line. The 213 final7 `name` values that became null were bindings of a call's result (`confirmDelete = useCallback(fn)`), never the function's own name. The binding is still printed in the label and kept in `bound_to`.
