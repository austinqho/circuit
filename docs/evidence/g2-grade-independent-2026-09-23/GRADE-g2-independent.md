# G2 independent grade (2026-09-23)

Grader: separate agent. I did not read or use the implementer's `GRADE.md` files or grader script, and I did not import from the package. Every count below comes from the raw `records.jsonl` / `spans.jsonl` / `attribution-manifest.json` on disk, from the fixture sources, from the fixture SQLite file (opened read-only), or from reading harness/package code. I ran no builds or servers.

- Worktree: `.claude/worktrees/agent-a67969b12d569f0c6`, branch `g2-generality`, HEAD `4f92fd05` (evidence commit on top of `682fbd5a`).
- Evidence graded: `docs/evidence/g2-anything-llm-2026-09-23-r3/`, `docs/evidence/g2-bulletproof-react-2026-09-23-r2/`.
- Fixtures: `anything-llm@ad97bc8d`, `bulletproof-react@9506629e` (HEADs confirmed).
- Raw file integrity: on-disk sha256 of `records.jsonl` (`27454490…acd8`) and `spans.jsonl` (`77c8aecc…d4`) match anything-llm `RUN.md`. **But `*.jsonl` is gitignored (`.gitignore:4`), so `records.jsonl`, `spans.jsonl` and `joined-backend.jsonl` are not in commit `4f92fd05`.** The raw rows exist only on this disk. The committed evidence has the sha256 values, not the rows.

## Per-item table

| # | check | anything-llm | bulletproof-react | verdict |
|---|---|---|---|---|
| 1 | Source untouched | `git status --porcelain` is empty. `git diff --stat` and `--cached` are empty. Ignored files present: `frontend/bundleinspector.html` (written by the fixture's own `rollup-plugin-visualizer` in `vite.config.js:32-37`, in both builds, not mentioned in RUN.md), `frontend/node_modules/`, `server/node_modules/`, `server/storage/{anythingllm.db,comkey,models/*,push-notifications}` (server runtime; the session deletes and re-migrates the DB, documented). The plugin's default cache `frontend/node_modules/.producttrace/` (documented in RUN.md) is gone now. The harness work dir `/Users/austinho/dev/fixtures/.g2-work/` (wrapper, tarball, dist-enabled/disabled) sits outside both repos and has been deleted | `git status --porcelain` is empty. diff is empty. The only ignored path is `apps/react-vite/node_modules/`. `mocked-db.json` is removed after the run (documented) | **PASS** on both repos. No tracked change. Everything written is gitignored or outside the repo. One ignored artifact (`bundleinspector.html`) is not documented |
| 2 | One plugin line, installed from a tarball | The wrapper is generated from `test/browser/build-fresh-repo.mjs:97-114`: it imports the original `frontend/vite.config.js` unchanged. Its `plugins` holds `...(process.env.G2_PRODUCTTRACE === "0" ? [] : producttrace()),` followed by `...base.plugins`. The wrapper also overrides `build.outDir`/`emptyOutDir` so the build stays out of the fixture. `build-gates.json → install.plugin_line` matches. The wrapper file itself was deleted with `.g2-work` | same template, `apps/react-vite/vite.config.ts` | **PASS.** The only integration is one `producttrace()` spread. Tarball: the harness runs `npm pack` and extracts the tarball into `install/node_modules/producttrace`. Dependencies are symlinked from the Tracer checkout, not installed from npm. I recomputed `npm pack --dry-run --json --ignore-scripts` at HEAD and got integrity `sha512-gPpuTe55…BuhN7Q==` with 140 files, identical to `build-gates.json → package` for both runs. The tarball itself is no longer on disk |
| 3a | Sequence contiguity | page `…dvao`: 6,647 rows, seq 1..6647 contiguous, 0 duplicates. Page `…egkb`: 83 rows, 1..83. No `capture.dropped` rows | 1 page, 2,718 rows, 1..2718 contiguous | **PASS.** Caveat: page 1 of anything-llm was navigated away, so it was flushed by `sendBeacon` on pagehide. Contiguity only proves there are no interior gaps. A lost tail on page 1 would not be detected, because only the live page's emitted count is compared (`coverage.json → live_page_emitted 83 = received 83`). The last page-1 rows do include the delete-workspace action and its DELETE request |
| 3b | Requests: wrapper vs Playwright | 83 `network.request` rows, of which 12 are internal (`/__producttrace/bridge`) and **71 non-internal**, with 71 distinct (page, occurrence) and 71 distinct trace ids | 32 rows, 20 internal, **12 non-internal** (xhr) | Wrapper counts recomputed and they match. **The Playwright side exists only as an aggregate** (`coverage.json → transports.playwright: 71 / 12`, `reconciliation: []`). The harness keeps the `observed[]` array in memory (`build-fresh-repo.mjs:304-310`) and never writes it out, so the method+path reconciliation cannot be re-run independently. It is accepted on the harness's word |
| 4 | Handler credit (see detailed table below) | 42 credited: **23 correct / 0 wrong / 19 justified-global**. No element-own handler ran at depth 0 (invoked_by=event) in any of the 19 | 15 credited: **12 correct / 0 wrong / 3 justified-global by the stated test**, but the 3 are **route `lazy` loaders, not listeners** (see notes) | Pass under the grader rubric. Under the gate's literal verdict set {correct, wrong, none}, the 19 + 3 are not `correct` |
| 5 | Uncredited click/submit/change | 4 actions (2 click, 2 change). Each has **0** `function.enter` rows of any kind under its action id | 20 actions (12 click, 8 change). Each has **0** `function.enter` rows | **PASS**, 0 missed credits. (Uncredited focusins with enters: anything-llm seq 246 has 6 enters and bulletproof seq 1983 has 30. None is invoked_by=event, so they are render/effect frames, not missed handlers) |
| 6 | Writes → exact server chain → handler frontier | 6/6 write requests each have exactly one `server` span with the same trace_id and `parent_span_id ==` the request's span_id. 49/49 attributed requests do (0 multi, 0 missing). Under each: registered-handler spans with the right `http.route`, ending at the terminal `<anonymous>` handler. 0 DB spans anywhere (`db_spans: 0`). ACTIONS reports "stopped at handler: database client not instrumented". SQLite (read-only): `workspaces` 0 rows and `workspace_threads` 0 rows (both deleted by the session, as expected). `event_logs`: `workspace_created {"workspaceName":"Tracer G2"}` @…833246 (POST /workspace/new @…833236), `workspace_thread_created` @…834867 (POST thread/new @…834863), `workspace_deleted {"workspaceName":"Tracer G2 renamed"}` @…843079 (DELETE @…843002). The last one also confirms the rename landed. Thread rename and delete are not logged by the app | n/a (frontend-only). 5 writes stop at network. `join_diagnostics.no_exact_parent_server: 5`, and no backend stop is invented | **PASS.** Exact joins. Frontier is explicit, no invented DB stop. The DB writes that the app logs are corroborated by timestamp |
| 7 | Marker gate real or tautological | `test/browser/marker-sites.mjs` parses every served `.js` with the TypeScript AST. It counts `enter(N,{entry_hint})` and `tag(fn,N,true,…)` (including the `.call` / `(m=…)==null?void 0:m.enter` down-levelled forms). It skips the `registerManifest([...])` prefix. It passes iff every manifest index has an executable site and no site index is outside the manifest | same | **Real, not tautological**: it reads what survived minification rather than comparing the manifest with itself. **It cannot be recomputed now**: `dist-enabled` was deleted (`--keep-builds` not used; `.g2-work` gone). Limits of the gate itself: it checks index-set equality, not identity (it does not prove that site N wraps the function the manifest calls N, since both come from the same plugin pass). Independent corroboration I ran: manifest spans on exact TS function boundaries **5101/5101** and **301/301**. The content hash in every id matches the fixture file (5101/5101, 301/301). No manifest path under node_modules/dist/build/vendor. 0 runtime `function.enter` rows with an unmanifested index (363 and 101 distinct indexes executed) |
| 8 | Parity | Landing `/` only, after networkidle + 1.5 s. `document.body` is serialized with `data-producttrace-*` attributes removed and origin/blob URLs normalized. Both builds are served on the same port with the same backend. I ran `cmp` on `parity-dom-disabled.txt` vs `-enabled.txt`: byte-identical (115 lines). Control identical, page errors [] both | identical (29 lines) | **Supported for the landing route only.** No evidence on post-interaction DOM, other routes, or behavior. The enabled build differs by design in stamp attributes (6 stamped elements on anything-llm, 0 on bulletproof). The plugin also forces `build.sourcemap: 'hidden'` when the project has none. On bulletproof this adds 3 rollup "Error when using sourcemap" warnings to the enabled build log (0 in disabled). Harmless but a build difference, not documented |
| 9 | Package changes | See section below | | No repo-specific strings added. Several changes alter attribution semantics (intended, generic). The first-party rule has latent monorepo false-exclusions |
| 10 | Claims not supported by raw rows | See section below | | 9 items, none of which changes a gate outcome except the labelling in #4 |

## Item 4: every credited action, against the fixture source

Method: for each `dom.action`, I computed from `records.jsonl` the `function.enter` rows whose `parent_continuation_id` is the action's own continuation (depth 0), filtered to `invoked_by=event`, and mapped each through the manifest to the fixture file:span. I compared this with the credit in `actions.json` and read the source at that span.

### anything-llm (42 credits)

| step | action (count) | credited file:line | what the source is | depth-0 event frames | grade |
|---|---|---|---|---|---|
| 1 | click sidebar "+" (1) | `Modals/NewWorkspace.jsx:72` `showModal` | `Sidebar/index.jsx:198 onClick={showNewWsModal}` → `useNewWorkspaceModal().showModal` | only this | correct |
| 2 | keydown on `#name` (9) | `…/MicButton/index.jsx:33` `onKey` | `document.addEventListener("keydown")`; acts only on Ctrl+M | MicButton:33, `utils/keyboardShortcuts.js:108` (window), `SidebarToggle:38` (window), `useModalEscape.js:11` (window). All global. `ModalInput` has no own handler | justified-global (9) |
| 2 | submit (1) | `Modals/NewWorkspace.jsx:21` `handleCreate` | `<form onSubmit={handleCreate}>` | only this | correct |
| 2 | focusin prompt (1) | `PromptInput/index.jsx:362` | `onFocus={() => setFocused(true)}` on the textarea (programmatic autofocus) | + `resetTextAreaHeight` | correct |
| 3 | click New Thread (1) | `ThreadContainer/index.jsx:194` `onClick` | `onClick={onClick}` (line 215) | only this | correct |
| 3 | focusin prompt (1) | `PromptInput:362` | as above | | correct |
| 4 | click Thread options (1) | `ThreadItem/index.jsx:139` | `onClick={() => setShowOptions(!showOptions)}` on `aria-label="Thread options"` | + `WorkspaceChat:192`, `ThreadItem:178` (document listeners) | correct |
| 4 | click Rename (1) | `ThreadItem:209` `renameThread` | `onClick={renameThread}` (line 265) | only this | correct |
| 5 | click Thread options (1) | `ThreadItem:139` | as above | | correct |
| 5 | click Delete Thread (1) | `ThreadItem:235` `handleDelete` | `onClick={handleDelete}` (line 273) | only this | correct |
| 5 | focusin prompt (1) | `PromptInput:362` | | | correct |
| 6 | click gear (1) | `Sidebar/ActiveWorkspaces/index.jsx:187` | inline `onClick` on `aria-label="General appearance settings"` | only this | correct |
| 7 | click on name input (1) | `WorkspaceChat/index.jsx:192` | `document?.addEventListener("click", …)` code-snippet copy | + `ThreadItem:178` outside-click (document). The input has only `onChange` | justified-global (1) |
| 7 | keydown on name input (9) | `ThreadContainer/hooks.js:33` `handleKeyDown` | `window.addEventListener("keydown")`; returns early unless hovering | `keyboardShortcuts:108`, `SidebarToggle:38`, hooks.js:33 (+ keyup listeners on the first). All global. The input has no `onKeyDown` | justified-global (9) |
| 7 | input on name input (8) | `WorkspaceName/index.jsx:25` | `onChange={() => setHasChanges(true)}` on that input | + CTAButton render on the first | correct (8) |
| 7 | click Update Workspace (1) | `lib/CTAButton/index.jsx:10` | `<button onClick={() => onClick?.()}>`. The parent passes no `onClick`, so this is the element's own (no-op) JSX handler | + 2 document listeners | correct |
| 7 | submit (1) | `GeneralAppearance/index.jsx:26` `handleUpdate` | `<form onSubmit={handleUpdate}>` | only this | correct |
| 8 | click Delete Workspace (1) | `DeleteWorkspace/index.jsx:13` `deleteWorkspace` | `onClick={deleteWorkspace}` (line 45) | only this | correct |
| 8 | focusin prompt (1) | `PromptInput:362` | | | correct |

Totals: correct 23 (1+1+1+1+1+2+2+1+1+8+1+1+1+1), wrong 0, justified-global 19 (9+1+9). In none of the 19 actions did an element-own handler run at depth 0 with invoked_by=event. It did not run at any depth either: the full event-invoked set was {966, 968, 2985, 3040, 4621} and {966, 968, 3040, 4353, 4354, 4366} and {1124, 4365}, all window/document listeners or their helpers.

Quality note on the 19: when several global listeners run, the runtime picks the one with `entry_hint=true` (MicButton, hooks.js:33) over the one that ran first (`keyboardShortcuts.handleKeyDown`, hint=false). Both credited functions are no-ops for these keys: MicButton acts only on Ctrl+M, and hooks.js:33 returns early unless the sidebar is hovered. A developer would say "typing in the name field has no handler". Under the doctrine "abstain over guess", these would be better as `none` (global listeners only). The LIMITS.md #4 disclosure is accurate.

### bulletproof-react (15 credits)

| step | action | credited file:line | source | grade |
|---|---|---|---|---|
| 1 | click Get started | `app/routes/landing.tsx:13` `handleStart` | `onClick={handleStart}` (line 34) | correct |
| 2 | click Register `<a>` | `app/router.tsx:32` | `lazy: () => import('./routes/auth/register')…` | route loader (see below) |
| 3 | submit register | `features/auth/components/register-form.tsx:30` | `<Form onSubmit={(values) => registering.mutate(values)}>` | correct |
| 4 | click Discussions `<a>` | `app/router.tsx:49` | discussions route `lazy` | route loader |
| 5 | click Create Discussion trigger | `components/ui/form/form-drawer.tsx:42` | `<Drawer onOpenChange={…}>` wrapping `DrawerTrigger asChild` | correct (library-wrapped) |
| 5 | submit discussion | `features/discussions/components/create-discussion.tsx:49` | `<Form onSubmit={…mutate}>` | correct |
| 6 | click View `<a>` | `app/router.tsx:56` | discussion route `lazy` (the Link's own first-party prop is only `onMouseEnter` prefetch) | route loader |
| 7 | click Create Comment trigger | `form-drawer.tsx:42` | as above | correct |
| 7 | submit comment | `features/comments/components/create-comment.tsx:53` | `<Form onSubmit={…mutate}>` | correct |
| 8 | click Delete Comment trigger | `components/ui/dialog/confirmation-dialog/confirmation-dialog.tsx:48` | `<Dialog onOpenChange={…}>` + `DialogTrigger asChild` | correct (library-wrapped) |
| 8 | click confirm | `features/comments/components/delete-comment.tsx:48` | `confirmButton … onClick={() => deleteCommentMutation.mutate({ commentId: id })}` | correct |
| 9 | click toast Close ×3 | `components/ui/notifications/notification.tsx:39` | `onClick={() => { onDismiss(id); }}` | correct (3) |
| 10 | click Sign Out menuitem | `components/layouts/dashboard-layout.tsx:192` | `DropdownMenuItem onClick={() => logout.mutate({})}` | correct |

Totals: correct 12. The 3 route-loader credits pass the stated test for "justified-global": no element-own first-party handler ran, because the `<Link>` click handler belongs to react-router. **But they are not global listeners.** The credited function is the destination route's `lazy` import thunk, which react-router's `Link.onClick` → `navigate` called synchronously. It does point at the right route. It is not "the JSX prop value bound to the element … or the submit handler of its form". The implementer's label "global-listener" is wrong for these 3. An honest output is `none` with a "library-owned control (react-router Link)" frontier, or a gate amendment that explicitly accepts route-loader credit.

**Counts under the grader rubric:** anything-llm 23 / 0 / 19; bulletproof 12 / 0 / 3.
**Counts under the gate's literal verdicts (correct / wrong / none):** anything-llm 23 correct, 19 not-correct. bulletproof 12 correct, 3 not-correct. Under that reading all 22 are `wrong`, and the gate fails on both repos.

## Item 9: package diff vs `5cdcc54a`

Files: `integrations/runtime-attribution.mjs` (+201), `integrations/vite.mjs` (+52), `backend/express-handler-instrumentation.js` (+10), `package.json` (+5: `./runtime-attribution` export, `@jridgewell/sourcemap-codec` dep), `scripts/build.mjs` (+9: copy `src/runtime-attribution-browser.js` → `dist/`; `cmp` confirms they are byte-identical), `dist/runtime-attribution-browser.js` (new), `.d.mts` files. `analysis/` and `src/` are unchanged.

- **Repo-specific strings:** none added. `grep -i "anything|bulletproof|librechat|radix|ariakit|mintplex|alan2207"` over the added lines of `integrations backend package.json scripts analysis src dist` finds nothing. Pre-existing matches remain in unchanged `analysis/library-contracts.mjs` and `analysis/react-compiler.mjs` (acknowledged in the gate text). The matches in `react-behavior.mjs` and `react-execution-rule.mjs` are the numeric `radix`, a false positive. The only machine-specific path is in the harness (`build-fresh-repo.mjs:49`, the LibreChat Playwright fallback), not the package.
- **Packaging/ids only:** `src/` → `dist/` runtime; `runtimeAttributionPlugin` exported; output dir from `outputOptions.dir` instead of the hardcoded `client/dist`; the chunk map is composed onto the original map and the emitted `.map` asset replaced; hidden sourcemaps forced when the project has none, then removed from the bundle (worker maps excepted, disclosed in LIMITS #8); the `producttrace()` one-liner (repository = nearest `.git` ancestor of cwd; cache in `<cwd>/node_modules/.producttrace/`); Express 4 `express.Route` patched as well as Express 5 `Router.Route`.
- **Changes attribution semantics:**
  1. `firstPartySpan`: chunk-pass functions whose original source is under an excluded path are no longer instrumented. Library frames can no longer be depth-0 entry handlers (manifest 16,968 → 5,101 per gate doc).
  2. `originalSpan` returns `null` (abstain) when no exact original function boundary exists. Before, it fell back to the raw mapped span.
  3. New boundary heuristic: an original function whose start is within **8 chars** of the mapped start (or of the end of its type-parameter list) and whose end ≥ mapped end − 2; the innermost wins. This is a tolerance heuristic, not an exact rule. Only boundaries starting at or before the mapped start qualify, so a curried `a => b => …` outer node cannot take the inner id. Mis-assignment is still possible in principle when the map lands a few chars inside a different function. The 5101/301 exact-boundary result does not rule it out, because a mis-assigned span would also be an exact boundary.
  4. `embeddedRow`: the chunk pass reuses the index the module pass embedded (`tag(...,N,b,b)` or `enter(N,{entry_hint:` in the first two statements, including `4e3` form) instead of re-deriving it from the chunk map.
  5. `moduleRowsBySite`: a regex `,(\d+(?:e\d+)?),(true|false|!0|!1),(true|false|!0|!1)\)` over chunk code adds module rows to the chunk's manifest/registration. Any app or library code that happens to match `,N,!0,!1)` with N a live module index would add a spurious (harmless for crediting) manifest row. This loose textual match should be tied to the AST like the marker gate.
  6. Manifest rows now accumulate across repeated transforms of one module.
  7. Pre-existing, not changed, but visible here: Express handler `index` gives every member of an array-registered middleware list the array's start index. For example, on `/workspace/:slug/thread/new`, `validatedRequest`, the anonymous `flexUserRoleValid(...)` and `validWorkspaceSlug` all report index 0 while the terminal handler reports 3. So "route pattern + handler index identifies them" (RUN.md) holds only for the terminal handler.
- **"Instrument only first-party functions"**: first-party means the path relative to `repository` (default: nearest ancestor of `process.cwd()` containing `.git`) does not start with `..`, contains **no path segment named `node_modules`, `vendor`, `dist`, `build` or `.git`**, and ends in `.[cm]?[jt]sx?`. Module-pass ids are realpath'd, so symlinked workspace packages resolve to their real source. Monorepo false-exclusion risks:
  1. Any first-party directory named `build`, `dist` or `vendor` (for example `src/build/`, `packages/build-tools/` is fine but `packages/build/` is not, and `src/vendor/` for vendored-but-owned code) is silently excluded.
  2. Workspace packages consumed through their compiled `dist/` entry are excluded, so their code gets no credit.
  3. If the Vite app lives in a nested git repo or submodule, or `.git` is not an ancestor of cwd (e.g. built from a copied dir), `repository` becomes cwd, and sibling workspace packages outside it (`../packages/ui`) are excluded as `..`.

  Neither fixture has such directories (`find … -name build -o -name dist -o -name vendor` under both `src/` trees: none), and 0 manifest paths match the exclusion, so this did not affect G2. It is untested.

## Item 10: claims in RUN.md / ACTIONS.md / LIMITS.md / gate Results not supported (or overstated) by the raw rows

1. The evidence is not immutable in git. Raw `records.jsonl`, `spans.jsonl` and `joined-backend.jsonl` are gitignored and absent from `4f92fd05`. Only their sha256 values are committed. The on-disk copies match the sha256 today.
2. "transports wrapper 71 = Playwright 71" (and 12 = 12): the wrapper side is recomputed and correct. The Playwright side has no raw log, only the harness's aggregate.
3. "67 dom.action rows (…16 focusin…)": raw has 68 (17 focusin). The extra row is a pre-session autofocus (`seq 12`, page 1, outside every step window). It is disclosed only in `harness-stdout.json` (`outside_steps: 1`), not in RUN.md.
4. LIMITS #6 "11 before the first action" on page 1: 10 are before the first `dom.action`. One (`GET /api/setup-complete`) follows the pre-session autofocus action but precedes step 1. "All page loads" is still plausible (load-time continuations).
5. bulletproof LIMITS #3 / Results table "global-listener" for the 3 `<Link>` credits: they are route `lazy` loaders, not listeners (item 4).
6. RUN.md "the route pattern + handler index identifies them": index is not unique for array middleware (item 9.7).
7. "capture lossless" for anything-llm page 1: contiguity yes, but tail completeness of the navigated-away page is not provable from the rows (item 3a).
8. Gate text says the wrapper is generated "under the evidence/scratch dir". It was actually `/Users/austinho/dev/fixtures/.g2-work/…` (outside the repo, since deleted along with the wrapper, tarball and bundles). The marker gate therefore cannot be re-run from disk. The tarball integrity is reproducible.
9. Undocumented build side effects: the plugin's forced hidden sourcemaps add 3 rollup sourcemap warnings on bulletproof, and the fixture's own visualizer writes the ignored `frontend/bundleinspector.html`.

Everything else I checked matched the raw rows or the fixture:
- anything-llm counts: 42 credited, 26 rooted, 15 distinct functions, 25 none, 49 attributed, 22 unattributed, 1,156 spans (104 server, 220 handler), 134 handler.enter, 49 route.dispatch.
- bulletproof counts: 336 actions, 15 credited, 12 distinct, 321 none, 5 attributed / 7 unattributed with the stated causes.
- The step-7 "third listener" claim.
- Six of six writes and five of five writes credited to the developer-named handler.

## Commands run (read-only)

```
git -C <worktree> log --oneline 5cdcc54a..HEAD; git ls-files docs/evidence/g2-*; git check-ignore -v …/records.jsonl
git -C <fixture> rev-parse HEAD; status --porcelain; status --porcelain --ignored; diff --stat; diff --cached --stat; check-ignore -v
shasum -a 256 records.jsonl spans.jsonl
python3 (inline): row kinds; per-page sequence contiguity/duplicates; network.request internal/non-internal/unique; dom.action by event
python3 scratchpad/g2/per_action.py + compare.py: per-action depth-0 invoked_by=event function.enter → manifest → fixture source; credited vs depth-0; uncredited click/submit/change enter counts
python3 (inline): write requests → spans.jsonl server span by (trace_id, parent_span_id) → handler descendants → db spans
python3 (inline): unattributed request timing vs first action and step windows; joined-backend kinds
node scratchpad/g2/spans.cjs (worktree's typescript only): manifest span exact-boundary, id hash vs fixture sha256, runtime indexes ⊆ manifest
sqlite3 -readonly file:…/anythingllm.db?mode=ro: .tables; workspaces; count(workspace_threads); event_logs
npm pack --dry-run --json --ignore-scripts (writes nothing): integrity + file count
cmp parity-dom-disabled.txt parity-dom-enabled.txt; cmp src/ vs dist/ runtime-attribution-browser.js
git diff 5cdcc54a HEAD -- integrations backend package.json scripts (+ grep for repo-specific strings)
sed/grep of fixture sources at every credited span and the element's JSX binding
```

No `.env` file or secret was opened or printed. `system_settings` in the SQLite DB was not queried.

## Verdict

**anything-llm: PASS with caveats.** Proven from raw rows and source:
- The tracked source is untouched.
- A single `producttrace()` spread from a tarball whose integrity I reproduced.
- Contiguous capture.
- 71 wrapper requests.
- 23 credits correct against source.
- 0 wrong. 19 global-listener credits, where no element-own handler ran.
- 0 missed credits on click/submit/change.
- All 6 writes credited to the handler a developer would name and joined by exact trace and parent to their Express route and handler spans, with an explicit Prisma/SQLite frontier. The app's own `event_logs` corroborate create, thread-create, rename (via the name) and delete at matching timestamps.

**bulletproof-react: PASS with caveats under the grader rubric.** 12 correct, 0 wrong, 0 missed credits, 5/5 writes to the developer-named handler with explicit network frontiers, and every other gate recomputed where possible. The 3 remaining credits are route `lazy` loaders, not listeners and not the element's handler; they are mislabelled "global-listener".

**Under the gate's literal verdict set** (correct / wrong / none, with no global-listener category), those 3 credits and anything-llm's 19 global-listener credits would be `wrong`, and G2 would **fail on both repos**. Both runs need the gate text to explicitly accept "global-listener / route-loader" credit, or the runtime to abstain (`none`) when no listener bound to the element or its form ran.

**Not proven:**
- The marker gate cannot be recomputed: bundles are deleted, and the gate checks index sets, not site-to-function identity.
- Playwright request counts exist only as an aggregate.
- Page-1 tail completeness on anything-llm.
- Parity beyond the landing route.
- The raw rows are not committed.
- The first-party rule on monorepos with `build/`, `dist/` or `vendor/` source directories, or with apps outside the git root.
- The tolerance-based boundary heuristic on other bundles.
