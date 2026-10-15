# Gate G6: agent verification (before/after runtime-path comparison)

Gate text written before code, 2026-09-23. Branch `g6-verification` from `main` at `2dd6e7a2` (G4 MCP + G2 generality merged).
Source: `docs/HANDOFF-2026-09-23-agent-annotation-pivot.md` §3.2, §6.3 (`compare_chains`), §6.5, §7 G6; `docs/gates/G4-mcp.md` §2, §3.2; `docs/gates/G2-generality.md`.

## 1. Pass criteria (verbatim from the handoff §7)

> **G6 Verification.** For a seeded bug on a fresh repo, `compare_chains` shows the before/after path change after the agent's fix, and shows *no* change for a no-op refactor.

§6.5, verbatim: "Reuse `m1-session-headless.mjs` machinery: record the action (Playwright, trusted events, headless), apply the change, rebuild, replay the same action, `compare_chains`."

§3.2 states what the output has to let an agent say: "Before: click Save → `handleSave` → `PATCH /api/profile` → 422, no write. After: → 200 → `users.update`." It also asks: "did this refactor change the path of any user-triggerable action?"

Binding doctrine (handoff §5.2, HANDOFF-2026-09-22 §8): headless Playwright only; no model in the path; identifiers attach, timestamps only order; abstain over guess; explicit frontiers in "reached / stopped at / because" form; no repo-specific rules in the package (the per-repo session script under `test/browser/sessions/` is harness and may know the app); evidence dirs immutable; an independent grader recomputes every verdict from raw rows.

## 2. What G6 must show, made checkable

Fixture: `Mintplex-Labs/anything-llm` at `ad97bc8dfcb6919f34f7d6d0c722efdda64d66d9` (`/Users/austinho/dev/fixtures/anything-llm`, the G2 primary repo). Express `server/`, Vite + React `frontend/`, Prisma/SQLite. No LLM key; non-chat flows only.

Action under test: **workspace rename**. This is G2 session step 7 (`rename-workspace`): type " renamed" after the workspace name, then click *Update Workspace*. The form's `submit` runs `handleUpdate` (`frontend/src/pages/WorkspaceSettings/GeneralAppearance/index.jsx`), which sends `POST /api/workspace/:slug/update`. That request reaches the Express route `/workspace/:slug/update` (`server/endpoints/workspaces.js`) and its handlers, which the spans record as `#0 validatedRequest`, `#1 <anonymous>` (the closure returned by `flexUserRoleValid([...])`) and `#2 <anonymous>` (the update handler). *Corrected after the independent grade; the original text named `flexUserRoleValid`, which the spans never show.* There is no Prisma/SQLite adapter, so the DB hop is always a frontier (`stopped_at: handler`). The chain can never show a DB write. The "missing effect" is therefore observed at the HTTP status and at the handler/request stops, never at a DB stop. This limit is stated in `LIMITS.md`, not papered over.

Each step is one harness run of the unchanged G2 session, all 8 steps, against one build of the fixture. The fixture is changed only on a throwaway branch `g6-scenario` of the fixture repo. Each change is one commit, because the harness refuses a dirty tree. At the end the fixture is restored to `ad97bc8d` on `master` with a clean tree and the branch is deleted. Seeding a bug in the app under test *is* the scenario. Tracer's read-only-to-source rule covers Tracer's instrumentation, and the harness still verifies that no build or session writes the tracked tree (`git status --porcelain` before/after every run, excluding only `.tracer/`, see §3.4).

| run | fixture state (commit on `g6-scenario`) | expected chain for the rename submit |
|---|---|---|
| **A** baseline | `ad97bc8d` unchanged | `submit` → `handleUpdate` → `POST /api/workspace/tracer-g2/update` → route `/workspace/:slug/update` **200** → handlers (validatedRequest, flexUserRoleValid, update) → stopped at handler (DB not instrumented) |
| **B** seeded backend bug | update handler rejects any name containing whitespace with **422** before `Workspace.update` | same up to the route, route status **422** |
| **C** agent's fix | the seed commit reverted (tree byte-identical to `ad97bc8d`) | identical to A |
| **D** no-op refactor | local variable `data` → `payload` inside `handleUpdate` (frontend file content hash changes, behaviour does not) | identical to A except the entry handler's function id |
| **E** (if time) frontend bug | `handleUpdate` returns early when the name contains whitespace, before `Workspace.update` | `submit` → `handleUpdate`, no request |

Comparisons and their pass condition. `compare_chains` is called over the MCP stdio server started as `producttrace-mcp --store <fixture>/.tracer --source-root <fixture>`:

| pair | pass iff |
|---|---|
| `compare_chains(A, B)` | `path_changed: true`; the `route` stop is `changed` (`… 200` → `… 422`); `outcome_delta.changed` contains `http_status` (200 → 422); `path_change_reasons` ⊇ {`route`, `outcome`}; `request` and `entry_handler` stops `same`; after-side frontier reads `stopped_at: handler` with a `because` that names the 422 |
| `compare_chains(B, C)` | `path_changed: true` with the mirror of A→B (422 → 200): the path is restored |
| `compare_chains(A, C)` | `path_changed: false`; every stop `same`; `outcome_delta.changed` empty |
| `compare_chains(A, D)` | `path_changed: false`; `entry_handler` is `changed` with `change_kind: "source_revision"` and `change_basis: "manifest_remap"` (**not** `different_handler`, and not decided by the content-hash fallback); every other stop `same` |
| `compare_chains(A, E)` (stretch) | `path_changed: true`; `request`, `route` and `handler` stops `removed`; `entry_handler` `source_revision` (same function, file edited); after-side frontier stops before the network |

Negative control, so that the remap is not a rubber stamp: a unit test (§5) builds two manifests where the element is rebound to a *different* function in the edited file. That must stay `different_handler`. A file whose function structure changed must yield `change_kind: "unmapped_revision"`, which is a path change: abstain, never claim "unchanged".

"The same action" across runs is selected by a harness rule, never by the package: in run R, the `dom.action` row with `event: "submit"` whose `timestamp` lies in the `rename-workspace` step window recorded in `runs.jsonl`. Exactly one must exist, else the run fails. Timestamps are used only to pick the replayed action, which the harness knows by construction. They never attach evidence to it.

## 3. `.tracer/` store layout (append-only, multi-build)

`collector/store.mjs` `loadStore` defines what the MCP reads. G6 extends it without breaking the G4 single-manifest layout.

```
<project>/.tracer/
  records.jsonl            append-only; producttrace.runtime-evidence.v1 rows, each tagged tracer_run, tracer_build
  spans.jsonl              append-only; producttrace.backend-span.v1 spans, each tagged tracer_run, tracer_build
  runs.jsonl               append-only; one producttrace.store-run.v1 row per run (below)
  manifests/<build>.json   one attribution manifest per build, written once (content-addressed by build id)
  manifest.json            optional, legacy (G4 single-manifest stores); still read
```

### 3.1 Build id
`build = "b-" + sha256(sorted manifest function ids joined by "\n")[0:16]`. It is computed by `buildIdOf(manifest)` in `collector/store-writer.mjs`, or taken from `manifest.build` when the manifest carries one. Function ids are `function:<sha256(file content)>:<start>:<end>`, so the build id changes iff some first-party file that contains a function changed. Consequences:
- A backend-only change (runs A, B, C) keeps the same build id. The frontend bundle's first-party code is the same, and that is true. Runs, not builds, separate those observations.
- A frontend edit (runs D, E) gets a new build id and a new `manifests/<build>.json`. The previous build's manifest stays, so before/after builds coexist.
- Rewriting an existing `manifests/<build>.json` with a different function-id set is refused: that would be a hash collision or a tampered store.
- A first-party file that contains no function (a pure constants module) does not move the build id. This is recorded in `LIMITS.md`.
- **Decision (coordinator, 2026-09-23):** the build id stays **frontend-manifest-based**, so **backend edits do not move it**. Runs are told apart by their run records (`runs.jsonl`: `run_id`, `label`, `source.commit`, `steps`), never by build id. A consumer that needs "which code produced this chain" reads the run's `source.commit`. `tracer_build` answers only "which frontend manifest resolves these function ids".

The stored manifest drops `generated` (build-machine paths into a deleted out dir) and keeps `id`, `kind`, `source`. *Amended after the six runs, before the evidence was committed:* `index` is dropped as well. It is bundle-local: runs A, B and C share build `b-2dc9ecff4d63b25e` (same function-id set), but their runtime indexes differ (counted by function id, 4,139 of 5,101 functions have a different `index` in B than in A; the earlier figure of 4,828 counted array positions, see the evidence ERRATA item 4). So `index` is not a property of the build. Nothing in the store reader uses it, since rows join by `function_id`. The G6 evidence store was written before this change, and its `manifests/*.json` still carry run A's (or D's, or E's) indexes. `LIMITS.md` records this.

### 3.2 Run row (`runs.jsonl`)
```json
{ "schema": "producttrace.store-run.v1", "run_id": "run-…", "build": "b-…", "label": "A-baseline",
  "started": "<iso>", "ended": "<iso>", "source": { "repository": "<abs>", "commit": "<sha>", "status_clean": true },
  "records": 0, "spans": 0, "manifest_functions": 0, "steps": [{ "step": 7, "name": "rename-workspace", "started": 0, "ended": 0, "status": "done" }] }
```

### 3.3 Row tags
Every appended record and span gets `tracer_run` and `tracer_build` as top-level fields. No other field is altered. Rows are appended in the harness's `(capture_page_id, sequence)` order. `capture_page_id` is random per page load and `action_id` embeds a time base, so ids from different runs do not collide. If one ever did, `lookupAction` already returns `ambiguous` rather than picking.

### 3.4 Writers
- `collector/store-writer.mjs`: `openStoreWriter(dir, { manifest, label, source })` → `{ run_id, build, appendRecords(rows), appendSpans(spans), close({ steps }) }`. It is the only code that writes a store.
- Fresh-repo harness: `build-fresh-repo.mjs --store <dir> [--label <text>]` writes the run's rows, spans and manifest through the writer after the session. When `<dir>` is inside the fixture (the intended `<fixture>/.tracer`), the source-clean checks exclude exactly that path (`git status --porcelain -- . ':(exclude).tracer'`). The unfiltered status is also recorded. A real project would gitignore `.tracer/`, which the fixture does not.
- Collector: `producttrace-collector --store <dir> [--manifest <file>] [--label <text>] [--port N]`. It serves `POST /ingest` (records) and `POST /spans` (backend spans), appends through the same writer, and closes the run on SIGINT/SIGTERM. The legacy form `producttrace-collector <port> <file>` is unchanged.

### 3.5 Reading a multi-build store
`loadStore` reads `manifest.json` if present plus every `manifests/*.json`. Function ids are content-derived, so the union of the manifests is a consistent id → source map. That union is also the registered-id set for handler credit. It also exposes `manifestsByBuild` and `runs`. The action → build map is read from the action rows' `tracer_build` tag. Everything else (episodes, credit, chains) is derived as in G4, over all runs at once.

## 4. `compare_chains`: the manifest remap (replaces the content-hash rule when both builds are known)

G4 §3.2 said: "with before/after builds in one store, that remap is the stronger test and should replace the content-hash rule." This section implements it.

For the entry-handler stop, when `before.function_id ≠ after.function_id`:
1. If both actions carry a `tracer_build` whose manifest is in the store (`change_basis: "manifest_remap"`):
   - Take the before function's row in the before build's manifest, giving file F.
   - List F's functions in each build's manifest, ordered by `(start asc, end desc)`, which is pre-order.
   - Compute each list's **shape**: per function, `kind` and nesting depth, from span containment.
   - If F has no functions in the after build, or the two shapes differ: `change_kind: "unmapped_revision"`, `detail` says why. It counts as a path change, since the path cannot be shown to be unchanged.
   - Otherwise the remapped id is the after build's function at the same pre-order ordinal. If it equals `after.function_id`, and the reverse remap (after → before) gives `before.function_id`, the result is `source_revision`. Otherwise it is `different_handler`.
   - If both actions have the same build and different function ids, the result is `different_handler`: one build, two functions.
   - The result carries `remap: { from_build, to_build, file, ordinal, functions_in_file, mapped_id }`.
2. Otherwise (a legacy store with no build tags or per-build manifests), the G4 content-hash rule applies unchanged, with `change_basis: "content_hash"`.

`source_revision` never sets `path_changed`. `different_handler` and `unmapped_revision` do (reason `entry_handler`). All other stop rules (id-segment normalisation of request paths, `parameters_only`, route/handler/db keys, outcome delta) are unchanged from G4 §3.2.

Frontier wording (generic, no product list): when the joined route span's HTTP status is ≥ 400, `because` is prefixed with `server responded <status>; `. The `stopped_at` value and the frontier vocabulary do not change. An agent reading B's chain therefore sees "stopped at handler / because server responded 422; no database span descends from the admitted handler span", not a bare DB-frontier sentence.

## 5. Tests (in `npm test`)
- `test/store-writer.test.mjs`: build id determinism; manifests written once and a conflicting rewrite refused; two runs of two builds appended into one store; rows tagged; `loadStore` reads both builds and the action → build map; the collector CLI `--store` ingests records and spans into a store `loadStore` can read.
- `test/compare-remap.test.mjs`: remap across two builds. It covers: a renamed local, where offsets shift and the result is `source_revision` via `manifest_remap`; rebinding to another function in the edited file, which stays `different_handler`; a changed function structure, which gives `unmapped_revision` and `path_changed: true`; the same build with two functions, which is `different_handler`; and the legacy store fallback (`content_hash`). It also checks that a 4xx route status appears in `because`.

`npm test` must be green except the known `react-context-ref-semantics` failure.

## 6. How a grader recomputes each verdict from raw rows

Script: `test/g6-grader.mjs <store-dir> --compare <dir of compare_chains JSON> [--out GRADE.md]`. Like the G4 grader, it imports nothing from `analysis/`, `collector/` or `mcp/`. From `runs.jsonl`, `records.jsonl`, `spans.jsonl` and `manifests/*.json` it recomputes, per run:
1. **Selected action**: the unique `dom.action` with `event: "submit"`, the run's `tracer_run`, and a timestamp inside the `rename-workspace` step window.
2. **Entry handler**: the first `function.enter` row of that action whose `parent_continuation_id` starts with `continuation:<action_id>:action:` (depth zero under the dispatch). That is the function the browser entered first for the submit.
3. **Request**: `network.request` rows with that `action_id`, not internal. The method plus the path with id-shaped segments normalised is the request key.
4. **Route / handlers / db**:
   - route: the unique span with the request's `trace_id`, `kind: "server"` and `parent_span_id == trace_context.span_id`, giving its `http.route` and status code;
   - handlers: `producttrace-express-handlers` spans descending from it, as (route, index, name);
   - db: spans carrying `db.system` that descend from a handler span.
5. **Remap**: F's functions from the two builds' manifests, pre-order ordinal, and shape equality, reimplemented.
6. **Verdict**: `path_changed` is true iff the request key differs, or the route status differs, or the handler (route#index → name) sets differ, or the db sets differ, or the entry functions differ and are not a `source_revision` under (5). The grader checks the MCP output's `path_changed`, per-stop statuses, `change_kind`, and `outcome_delta.changed ∋ http_status` against its own.

The same agent writes the grader and the implementation. They share no code, but a separate agent should rerun the grader before the gate is declared passed.

## 7. Evidence
`docs/evidence/g6-anything-llm-2026-09-23/` (new, immutable once written):
- `RUN.md`: commands; the exact fixture diff applied at each step; per-run gates; restoration proof (`git -C <fixture> status --porcelain` empty, `git rev-parse HEAD` = `ad97bc8d…`, branch deleted); raw-file sha256 and row counts.
- `LIMITS.md`.
- `store/`: the `.tracer/` store (`*.jsonl.gz`, force-added; `manifests/*.json` gzipped if large).
- `compare/<pair>.json`: the `compare_chains` result as the MCP returned it.
- `AGENT-READS.md`: one paragraph per comparison, rendering what an agent would read.
- `GRADE-g6.md`: the grader output.
- `runs/<label>/`: the harness's per-run gate files and screenshots.

## 8. Results (2026-09-23; not yet independently graded)

Evidence: `docs/evidence/g6-anything-llm-2026-09-23/` (`RUN.md`, `LIMITS.md`, `GRADE-g6.md`, `AGENT-READS.md`, `compare/`, `store/`, `runs/`). Six harness runs, one store, three frontend builds (`b-2dc9ecff4d63b25e` for A/B/C, `b-a33d446fe91e8701` for D, `b-492209beb3a2e901` for E). Every run passed the G2 build gates: marker 5,101 = 5,101, parity, smoke, lossless capture, transports reconciled, 8/8 steps, tracked source clean.

| pair | MCP `compare_chains` | gate |
|---|---|---|
| A → B | `path_changed: true` (route, outcome); route `… 200` → `… 422`; http_status 200 → 422; after: reached handler / stopped at handler / because "server responded 422; no database span descends from the admitted handler span" | pass |
| B → C (`C-fix-r2`) | `path_changed: true` (route, outcome); 422 → 200 | pass |
| A → C (`C-fix-r2`) | `path_changed: false`; 6/6 stops same | pass |
| A → D | `path_changed: false`; entry handler `source_revision`, `change_basis: manifest_remap` (931:1488 → 931:1497, position 4 of 4 in the file, reverse remap agrees) | pass |
| A → E (stretch) | `path_changed: true` (request, route, handler, outcome); request/route/3 handlers `removed`; entry `source_revision`; after: stopped at `validation` | pass |
| B → `C-fix` (control) | `path_changed: false`. The run labelled `C-fix` was executed at the seed commit after a failed revert command; kept append-only as a replay-determinism control (RUN.md) | control |

`test/g6-grader.mjs` recomputes all six from the raw store: 6/6 PASS. Grader independence caveat (§6) applies.

## 9. Amendment (coordinator, 2026-09-23, after the evidence run): remap bases

Replaces the single ordinal rule of §4.1. `unmapped_revision` counting as a path change stays the default: we cannot prove the handler is the same function. The remap now tries harder before giving up. Within the before function's file it tries these in order, and the first unique hit wins:
1. **`text_match`**: equal whitespace-normalised function source text (`text_sha256` on the manifest row). If several functions have identical text, the result is ambiguous and the next rule is tried.
2. **`name_match`**: equal function `name` (a declaration `function NAME`, a method `NAME(`, or the identifier assigned or keyed just before the span: `const NAME =`, `NAME:`). The candidate with the nearest start offset wins; a tie falls through.
3. **`ordinal`**: the §4 rule. It needs the same function count and nesting shape in that file, and takes the same pre-order position.
4. Otherwise `unmapped`, which gives `change_kind: "unmapped_revision"`. The result's `remap.tried` lists why each rule failed.

`source_revision` still also requires the reverse remap (after → before) to return the before id. The entry stop reports `change_basis` as one of `text_match | name_match | ordinal | unmapped`, `same_build` (two ids in one build, `different_handler`), or `content_hash` (legacy stores). This replaces `manifest_remap`; `compare/*.json` in the 2026-09-23 evidence predates the change (see its `ERRATA.md`).

Where the keys come from: the store writer enriches each manifest row with `text_sha256` and `name` when it is given the build's checkout (`openStoreWriter(dir, { sourceRoot })`; the harness passes the fixture; `producttrace-collector --store … --source-root <repo>`). It enriches only rows whose file's current content hash equals the hash in the function id, so a checkout that has moved on is never used. Rows without the keys fall through to `ordinal`.

Tests (`test/compare-remap.test.mjs`):
- (a) A function is added above the handler and the handler is reformatted. The ordinal shifts from position 1 to 2, the count changes 2 → 3, and `text_match` still maps it: `source_revision`, `path_changed: false`.
- (b) A local is renamed so the text differs, and a function is added above: `name_match`. The nearest offset wins among two same-name candidates; an equal-distance tie abstains. A rebinding to the added helper stays `different_handler`.
- The earlier ordinal, unmapped and same-build tests still pass. The grader (`test/g6-grader.mjs`) reimplements the same order.

On the 2026-09-23 evidence store, whose manifests carry no text or name, today's code gives exactly the committed verdicts with `change_basis: "ordinal"`.

## 10. Closes after the independent grade (2026-09-23)

Grade: `docs/evidence/g6-grade-independent-2026-09-23/GRADE-g6-independent.md`, PASS at `9279dd3f`.

1. **No silent pick of a neighbour.** Handler credit is restricted to registered function ids. If the function a submit actually entered was missing from its build's manifest, that restriction named the next registered function as the entry handler (grade item 5, h1/h4). The store now also computes the unrestricted credit. If that credit's function is not registered for the action's build (for a legacy store, the store's manifest), the entry handler is `{function_id, resolution: "unmapped", status, build, found_in_builds, reason}`:
   - `status: "stale_build"` when another build's manifest has the id, else `"not_found"`;
   - the chain summary says `<status>: entry handler <id> is not in build <build>'s manifest`;
   - no neighbour is credited in the chain, the element index or `compare_chains`, where the remap abstains and reports `unmapped_revision`.

   The envelope `status` of `action_chain` stays `ok`, because the rest of the chain is valid evidence. The abstention is on the entry stop and in the summary. The real G6 store and final7 each have 0 such actions, so no committed answer changes. Test: `test/compare-remap.test.mjs`, doctored manifest.
2. **Manifest files.** `loadStore` rejects (`MANIFEST_INVALID`) two cases instead of letting the later file win: a `manifests/*.json` whose `build` field does not match its file name, and two files with the same build key.

## 11. Last fix before merge (after the addendum grade)

1. **No offset pick among same-named functions (grade h8).** This replaces the §9 name rule.
   - `name_match` applies only when exactly one function in the file has the before function's name.
   - When several do, the offset is never used. If exactly one of them also has the before function's normalised text, it is taken with `change_basis: "text_match"`.
   - Otherwise the result is `change_basis: "unmapped"`, `remap.candidates: n`, with reason "`n` functions named `X` in file; no unique match". That is `unmapped_revision`, a path change, with no ordinal fallback.
   - `test/g6-grader.mjs` reimplements the rule.
   - The real enriched store is unaffected: `handleUpdate` is unique in its file, and all six comparisons are identical.
   - Test: "…several same-named functions abstain (h8)" in `test/compare-remap.test.mjs`.
2. **Invalid store envelope.** A store that exists but fails manifest validation (`MANIFEST_INVALID`) is answered with `status: "invalid_store"`, `reason: "store_invalid"`, `error` = the exact loader message, and summary `invalid_store: <message>`. It used to be reported as `not_found` / "nothing was recorded or the path is wrong". Missing or unconfigured stores keep `not_found` / `store_unavailable`.

## 12. Amendment (2026-09-24, `fix/outcome-labels`): scenario E is a silent early return, not a rejection

§8 recorded A → E's after chain as "stopped at `validation`". Scenario E's patch is a silent early return (`setSaving(true); … if (/\s/.test(name)) return;`). It shows no message and marks no field invalid. Its submit's only receipt is `validation: {same_form: true, feedback_mutations: 0, aria_invalid_changed: false, focus_moved_to_invalid_field: false}`, `form_mutation.count: 1` (the "Saving…" state). The rejected-submit rule used to accept any same-form mutation. It now requires the submit's own receipt to show validation feedback (`feedback_mutations > 0`, `aria_invalid_changed`, or `focus_moved_to_invalid_field`); otherwise it abstains (abstain over guess). E's after chain therefore now reads `stopped at browser` / `no_request` ("the handler ran and issued no request from instrumented code"), not `stopped at validation` / `rejected_client_side`.

- **Unchanged:** the verdict. `compare_chains(A, E)` still has `path_changed: true`, with reasons `request, route, handler, outcome`, and the request stop is `removed`.
- **Grader:** `test/g6-grader.mjs` now states the E expectation explicitly (request stop `removed` and a path change on the request, after `stopped_at: browser`). It grades 6/6.
- **Evidence:** the banked evidence (`docs/evidence/g6-anything-llm-2026-09-23/`) is not edited. Its `compare/A-baseline__E-frontend-early-return.json` keeps the old `validation` stop as a record of that run's code.

