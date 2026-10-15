# Gate G2: Generality (two fresh Vite + React repos)

Written before code, 2026-09-23. Branch `g2-generality` from `main` (= tag `m1`, `5cdcc54a`).

## Pass criteria (verbatim from `docs/HANDOFF-2026-09-23-agent-annotation-pivot.md` §7)

> **G2 Generality.** Run the pipeline unchanged on 2 fresh Vite + React repos Tracer has never seen (one chosen by Austin). Build gates pass (markers = manifest, parity). Report per repo: actions driven, entry handlers credited correctly (grader checks against source), frontiers. Fix analyzer gaps and React→native event-name normalization (`onChange`→`input`, the 13 join defects) only as they block these repos. **No Next.js yet** (separate bundler + server components; would consume the timeline; the M2 suggestion of `vercel/ai-chatbot` is postponed).

Binding doctrine (handoff §5.2 and HANDOFF-2026-09-22 §8): no repo-specific rules in the package; abstain over guess; explicit frontiers ("reached / stopped at / because"); headless only; evidence dirs immutable; independent grader for every claim.

## Repositories

| role | repo | commit | shape | clone |
|---|---|---|---|---|
| primary | `Mintplex-Labs/anything-llm` | `ad97bc8dfcb6919f34f7d6d0c722efdda64d66d9` | Vite 4.5 + React 18.3 JSX `frontend/`, Express 4 `server/`, Prisma + SQLite | `/Users/austinho/dev/fixtures/anything-llm` |
| secondary (frontend-only) | `alan2207/bulletproof-react` `apps/react-vite` | `9506629ed003a561c6627735480cce4994244bb4` | Vite 5.2 + React 18.3 TSX, react-query 5, react-hook-form, react-router 7, axios, MSW mock API | `/Users/austinho/dev/fixtures/bulletproof-react` |
| third | **pending Austin's pick** | | | |

Both were cloned shallow on 2026-09-23 and have never been built by Tracer. `bulletproof-react` was chosen over a "realworld" app because it was the first candidate listed and is a Vite + React app with a real mock API server; it is frontend-only for Tracer's purposes (its mock API is `@mswjs/http-middleware`, not first-party handlers), so its chains must end at an explicit network frontier.

Known constraints recorded up front:
- anything-llm needs an LLM provider key to answer chats. **No key is set.** Only non-LLM flows are driven (onboarding/auth, workspace create/rename/delete, thread create, settings). Chats are not driven.
- anything-llm's `vite.config.js` defines `process.env` into the bundle; the harness builds it with a minimal environment so no host secret is embedded.
- The machine has only Node 26. anything-llm's server depends (via `jsonwebtoken → jwa → buffer-equal-constant-time`) on `buffer.SlowBuffer`, removed in Node 25. The harness preloads a Node-compat shim (`test/browser/sessions/node-compat-slowbuffer.cjs`) into the fixture server. Harness-only, not package.
- anything-llm persists to Prisma/SQLite. Tracer has no Prisma or SQLite span instrumentation, so an anything-llm chain can reach at most the Express handler span; the DB hop is an explicit frontier (`stopped_at: "handler", because: "database client not instrumented (prisma/sqlite)"`).

## "One plugin line, zero source edits"

The fixture's source must stay byte-identical: `git status --porcelain` is empty before and after every build and session. The harness never writes into the fixture's tracked tree:
- A wrapper Vite config is generated **outside** the fixture (under the evidence/scratch dir). It imports the fixture's own `vite.config.*` by absolute path and adds exactly one line: `plugins: [...producttrace({ ... }), ...original.plugins]`.
- `build.outDir` is redirected to a directory outside the fixture (so the package must not assume any output layout; see packaging defects below).
- The package is consumed as an **installed tarball** (`npm pack` → install into a temp project), and the wrapper imports `producttrace/vite` from that install, not from the Tracer working tree. This is what exposes the packaging defects.

## Packaging defects this gate must fix (verified before fixing)

1. `package.json` `files` omits `src/`, yet `integrations/vite.mjs` reads `src/runtime-attribution-browser.js` at import time → an npm-installed package crashes on import.
2. `runtimeAttributionPlugin` is not reachable through the `exports` map.
3. `integrations/runtime-attribution.mjs` hardcodes the output layout `path.resolve(repository, 'client', 'dist', chunk.fileName)`; any other `outDir` silently instruments nothing (source-map sources resolve against the wrong directory). The chunk's source map is also discarded after edits, so emitted `.map` files no longer describe the served code.
4. Instrumentation requires chunk source maps; a repo whose config leaves `build.sourcemap` off gets zero markers. The plugin must enable maps itself (hidden, and not emitted if the user did not ask for them).
5. Static library contracts (`analysis/library-contracts.mjs`, exact LibreChat lockfile versions) and the Radix dialog transparency list (`analysis/react-compiler.mjs`) run on every build. Decision rule: acceptable if on a fresh repo they only produce static frontiers and do not block the build or runtime attribution; they are **not** expanded here.

Packaging acceptance test: `npm pack` the package, install the tarball into a fresh temp project, and `import { producttrace, productTraceVitePlugin, runtimeAttributionPlugin } from 'producttrace/vite'` succeeds (plus `producttrace/runtime-attribution`).

## Generic harness design (`test/browser/build-fresh-repo.mjs`)

Input: `--repo <fixture root> --app <app dir relative to root> --out <evidence dir> --session <test/browser/sessions/<name>.mjs>` plus harness env for the fixture (API origin, ports 4xxx). The harness knows nothing about a specific repo; the per-repo session script may.

1. **Source-clean check** before: `git status --porcelain` in the fixture must be empty.
2. **Two builds** with the fixture's own Vite (`node_modules/vite/bin/vite.js build --config <wrapper>`), cwd = app dir, minimal env:
   - `disabled`: wrapper with the plugin line removed (same outDir policy, same env);
   - `enabled`: wrapper with the plugin line.
3. **Marker gate (real, not tautological).** In the served `enabled` bundle (every `.js` under outDir, excluding Tracer's own emitted runtime assets), parse the executable instrumentation sites: `__productTraceRuntime?.enter(N,`, `tag?.((…),N,…)` and `registerFunction?.(fn,N)`. Pass iff the set of indices with ≥1 site equals the set of manifest `functions[].index`, no site references an index missing from the manifest, and the manifest is non-empty. The `registerManifest([...])` JSON prefix is excluded from the count (it is what the old gate compared against itself).
4. **Parity gate.** Serve both builds (same backend), load the landing route headless, wait for network idle, serialize `document.body` (tags, attributes, text) with Tracer's own `data-producttrace-*` stamp attributes removed; pass iff identical. Also compare the set of visible texts. Diffs are written to the evidence dir.
5. **Runtime smoke** (`test/browser/runtime-attribution-smoke.mjs`, generalized to take the dist dir).
6. **Scripted session**: serve the `enabled` build on a 4xxx port with `/__capture` (lossless, sequence-checked like M1) and a proxy to the fixture's API; run `sessions/<repo>.mjs` headless (Playwright Chromium, trusted input events, `serviceWorkers: 'block'`), 5–10 real user actions.
7. **Source-clean check** after.
8. **Evidence**: `RUN.md`, `LIMITS.md`, `records.jsonl`, `spans.jsonl` (if backend instrumented), `coverage.json`, `ACTIONS.md` (per-action table), build gate JSON.

Backend (anything-llm only): the fixture server runs with `node --import producttrace/backend/register` from the installed tarball (the package's default entrypoint: ESM loader hook via `module.register()`, then `startNodeBackendTelemetry`; the session sets `PRODUCTTRACE_BACKEND_ADAPTERS=http,express`) and ships spans to the harness. (Runs before 2026-09-24 used a harness preload, `test/browser/fresh-repo-backend-telemetry.mjs`, which registered no ESM hook.) Requires Node >= 20.6 (or 18.19) for `module.register`; on older Node add `--experimental-loader=@opentelemetry/instrumentation/hook.mjs` before `--import` (the entrypoint prints one warning naming it). Spans join only by exact trace/parent (`attachBackendSpans`).

## Honest measure reported per repo

For each driven user action (a scripted step → its `dom.action` rows):
- **Entry handler credited** = the unit chosen by `indexEntryHandlerUnits` (effect-rooted), mapped through the attribution manifest to `file:start-end`, with the source snippet read from the fixture at that span. The grader (a separate pass, not the session script) checks the snippet against the fixture's source: is it the handler a developer would name for that control (the JSX prop value bound to the element the user acted on, or the submit handler of its form)? Verdicts: `correct`, `wrong`, `none` (no credit; the reason is reported).
- **Requests**: wrapper-recorded `network.request` rows for the action vs Playwright-observed requests (reconciliation must be 0).
- **Backend**: route / handler span (exact joins only), then DB or the frontier with reason.
- **Frontiers by reason**, counted: `backend not instrumented`, `database client not instrumented`, `no terminal evidence`, `no first-party frame`, static-analysis frontiers (library contracts, etc.).
- Which transport path carried `network.request` rows (static-era bridge vs runtime wrappers).

Fails the gate for a repo: tracked source changed; marker gate or parity gate fails; capture gaps/drops; request reconciliation ≠ 0; any credited handler graded `wrong`. `none` is not a failure if it is reported with a reason, but it is counted.

Gap policy: a gap that blocks credit on **both** repos is fixed in the package, generically. A gap on one repo is documented as a frontier unless it is plainly a Tracer bug with a generic cause.

## Out of scope

Stamps (G3), MCP (G4), Next.js, LLM chats on anything-llm, a crawler, identity (M2).

## Results (2026-09-23, Tracer `682fbd5a`)

Evidence (final): `docs/evidence/g2-anything-llm-2026-09-23-r3/`, `docs/evidence/g2-bulletproof-react-2026-09-23-r2/`. Superseded but kept: `g2-anything-llm-2026-09-23` and `-r2` (marker gate failed on one minifier exponent-form index, `3e3`/`4e3`; fixed), `g2-bulletproof-react-2026-09-23` (passed; rerun on the final commit). Each has `RUN.md`, `LIMITS.md`, `ACTIONS.md` (per-action table), `summary.json`, `GRADE.md` (independent grader, final runs), raw `records.jsonl` (+ `spans.jsonl` for anything-llm), `coverage.json`, `build-gates.json`, manifest, parity DOM dumps, build logs, screenshots.

| measure | anything-llm | bulletproof-react |
|---|---|---|
| source byte-identical (`git status --porcelain` before/after) | pass | pass |
| installed from `npm pack` tarball, one plugin line `...producttrace()` | yes | yes |
| marker gate (executable sites in served JS = manifest) | 5,101 = 5,101, 0 unmanifested | 301 = 301, 0 unmanifested |
| manifest spans exact function boundaries | 5,101/5,101 | 301/301 |
| parity (landing body DOM, stamps removed; control identical) | pass (115 lines) | pass (29 lines) |
| runtime smoke | pass | pass |
| capture lossless | 6,730 rows, 2 pages, 0 gaps/drops | 2,718 rows, 0 gaps/drops |
| transports wrapper = Playwright | 71 = 71 | 12 = 12 |
| scripted user actions (steps) completed | 8/8 | 10/10 |
| dom.action rows | 67 | 336 |
| credited (grader: correct / unrooted_global / wrong) | 42 (23 / 19 / **0**) | 15 (12 / 3 as `route_loader` / **0**) |
| click/submit/change without credit (grader: miss / justified) | 4 (**0** / 4) | 20 (**0** / 20) |
| writes credited to the developer-named handler | 6/6 | 5/5 |
| backend | 49/49 requests joined exactly to server + handler spans; stop at handler: Prisma/SQLite not instrumented | none: stop at network, backend not instrumented |
| unattributed requests | 22, all page loads | 7: 1 load, 2 hover prefetch, **4 lost across async (route loader after `import()`, react-query refetch after mutation)** |
| `network.request` carried by | static-era request bridge (maps 0 plans; transport recorder only) | same |

**Verdict:** the build gates and the honest per-repo measure pass on both repositories with the pipeline unchanged apart from the shared fixes below. Third repository: pending Austin's pick.

### Shared gaps fixed in the package (both repos hit them)

1. Chunk pass instrumented dependency functions bundled into first-party chunks (react-dom, react-router, i18next…): 16,968 → 5,101 manifest rows on anything-llm; a library frame could become the depth-zero entry handler. Now first-party sources only.
2. Function span recovery from minified maps: 91/314 bulletproof spans (and e.g. `() => o` for anything-llm's `CTAButton`) were not function boundaries, so ids were unjoinable and snippets wrong. Now innermost-containing boundary with start tolerance (incl. type-parameter head), before the wholly-inside fallback; abstain when no original function exists (preload thunks, enum IIFEs).
3. Chunk pass re-derived identity from a map that can land on a nested function (anything-llm `DnDWrapper`: outer arrow tagged with the inner arrow's index). Now reuses the index the module pass embedded (`tag`/`enter`), including minifier exponent form.
4. Module-pass sites whose function the chunk pass could not map had no manifest row (unresolvable `function-index:N` enter rows). Manifest and registration now include surviving module-pass rows.
5. Packaging: `src/` read at import time, `runtimeAttributionPlugin` not exported, `client/dist` output layout hardcoded, chunk maps discarded, no maps when the project has none.

### Repository-specific gaps (documented, not fixed)

Express 4 handler spans (fixed anyway: plainly a Tracer bug with a generic cause, `>=4 <6` was declared but only Express 5's `Router.Route` was patched); Prisma/SQLite DB hop; anonymous backend handler names; Radix `pointerdown` menus; react-router `<Link>` crediting the route loader; hover prefetch; web-worker bundles; static analyzer parsing `.ts` as TSX and analyzing the whole monorepo (0 stamps on bulletproof: a G3 blocker). React→native event-name normalization (`onChange`→`input`) did **not** block crediting on either repo: crediting is runtime-rooted, not a static prop-name join.

Implementation note: the marker gate as built (`test/browser/marker-sites.mjs`) is stricter than step 3 above. It parses the served JS with TypeScript and requires every manifest index to have an **executable** site (a framed `enter(N,{entry_hint:…})` or an entry proxy `tag(fn,N,true,…)`), recognizing minifier down-levelled forms (`(m=rt)==null?void 0:m.enter(…)`, `x.call(rt,fn,N,!0,!1)`, `4e3`); registration-only sites do not count, and any site index absent from the manifest fails the gate.

## Amendments after the independent grade (2026-09-23)

Source: `docs/evidence/g2-grade-independent-2026-09-23/GRADE-g2-independent.md`. The evidence directories stay as recorded; each now has an added `ERRATA.md`, `RAW-SHA256.txt` and gzipped raw rows (`*.jsonl.gz`; `*.jsonl` is gitignored).

### Credit categories

Every `dom.action` gets exactly one verdict:

- **`correct`**: the credited function is element-bound or form-bound. It is the JSX event prop value on the element acted on (or on an ancestor, for that event), or the submit handler of the element's form. This includes handlers that reach the developer's function through a library wrapper bound to that element or form (react-hook-form `handleSubmit(onSubmit)`, Radix `onOpenChange` on the trigger's root).
- **`unrooted_global`**: no element-bound handler ran (in current wording: no element-bound handler observed in instrumented code (uninstrumented and third-party handlers are not seen)). A first-party function was credited only because it ran for the event: a `document`/`window` listener, or a router's route loader. The **`route_loader`** subtype covers a route `lazy`/loader thunk that a library `<Link>` click ran. Such a credit should be marked `rooted: false`.
- **`wrong`**: the credited function did not handle this event.
- **`none`**: no credit; the reason is reported.

**`unrooted_global` is a known credit defect, not an accepted credit.** When no element-bound handler ran, the runtime should abstain and emit a frontier instead of crediting a listener. As shipped in G1, and reworded on 2026-09-24, that frontier is `stopped_at: entry_handler, because: no element-bound handler observed in instrumented code (uninstrumented and third-party handlers are not seen); global listeners: [...]`. That needs to know, per placement, which handlers are bound to the element, which the stamp rows will carry. The fix is scheduled on the G3 branch.

Today's recorded `rooted` flag does not encode the category. It means "this frame's continuation owns terminal evidence", and a DOM mutation receipt counts. So 10 of anything-llm's 19 `unrooted_global` rows carry `rooted: true`, as do bulletproof's 3 `route_loader` rows. Seven `correct` keystroke rows carry `rooted: false` because they caused no new mutation.

G2 counts under these categories:
- anything-llm: 23 correct, 19 unrooted_global, 0 wrong, 0 misses;
- bulletproof-react: 12 correct, 3 unrooted_global (route_loader), 0 wrong, 0 misses.

G2 passes on `wrong = 0` and misses = 0. The `unrooted_global` count is reported as a defect to drive to 0 on the G3 branch.

### First-party rule (what gets instrumented)

`producttrace({ firstParty: { include: [globs], exclude: [globs] } })`, also accepted by `runtimeAttributionPlugin` (`integrations/runtime-attribution.mjs`, `createFirstPartyRule`). Globs are matched against paths relative to `repository`.

A file is first-party when all of these hold:
- it is inside `repository`;
- it has a `.[cm]?[jt]sx?` extension;
- it matches an `include` glob, or matches no `exclude` glob.

The default `exclude` is `**/node_modules/**, **/vendor/**, **/dist/**, **/build/**, **/.git/**` (the previous folder-name heuristic). A user `exclude` list replaces it. `include` defaults to `[]` and overrides `exclude`.

Consequences to know:
- **Workspace packages consumed through their built `dist/` are excluded by default.** Include them with `firstParty: { include: ['packages/<name>/dist/**'] }`. A source directory literally named `build/`, `dist/` or `vendor/` is excluded too.
- Sources outside `repository` are never first-party. `repository` defaults to the nearest ancestor of the working directory that contains `.git`. Set it explicitly when the app is built from a copy, or when sibling packages live outside that root.

Every build prints one line, and the manifest gets a `first_party` block with the same counts:

```
[producttrace] first-party: N functions instrumented; excluded functions by rule: **/node_modules/** M, …; excluded modules by rule: …; include=[…] exclude=[…]
```

Tests: `test/first-party-and-boundaries.test.mjs` (rule semantics; a chunk that mixes a workspace `dist/` package with app code is excluded by default, reported per rule, and included on request).

### Tolerances

**The 8-character boundary tolerance** (`exactOriginalFunctionBoundary`, `integrations/runtime-attribution.mjs`).

- *Problem.* A minified chunk's source map gives, for an emitted function, a mapped original start and end. These rarely coincide with the original function's boundaries. The start often lands just after `(`, `async ` or a dropped type-parameter list; the end lands on the last mapped token, not the closing `}`.
- *Rule.* Exact matches are tried first:
  1. same start (within 8) and same end;
  2. an original function wholly inside the mapped range ending exactly at the mapped end.
- *Tolerance.* Only then does it take the **innermost** original function that satisfies both of these, and otherwise abstain (no id):
  - its start is at most 8 characters before the mapped start, or its type-parameter head (`<T,>(`) is;
  - its end is at or after the mapped end − 2.
- *Why 8.* 8 covers the offsets observed on both repos: 1 for `(`, 6 for `async `, and a small head gap after `<T,>` is dropped. A *sibling* function cannot be matched, because it would also have to contain the mapped end. Only enclosing functions compete, and the innermost one wins.
- *What it can mismatch.* When the map's start lands within the first 8 characters of an enclosing function *before* a nested function begins, and the mapped end is not exact, the enclosing function is returned for the nested one.
- *Bound.* Every function the module pass already registered takes its id from the embedded site (`tag`/`enter` index), not from this path. On the final runs, 5,101/5,101 and 301/301 manifest spans are exact function boundaries whose content hash matches the fixture file.
- *Tests.* `function-boundary recovery…` in `test/first-party-and-boundaries.test.mjs` pins exact spans, curried arrows, 1-character offsets, the `<T,>` head, abstention past 8 characters, and the known enclosing-function limit.

**Manifest rows for module-pass sites.**

- *Problem.* The chunk pass must add a manifest row for every module-pass instrumentation site that survived into the chunk; otherwise its `enter` rows cannot resolve.
- *Change.* This was a loose text regex (`,N,!0,!1)` / `enter(N,{entry_hint:`), which could match application code that merely looks like that. It is now an AST match (`embeddedSiteIndexes`, `enterSiteIndex`, `tagSite`). Recognized shapes:
  - `enter`: a call named `enter` (directly, or as the `whenFalse` branch of `(m=rt)==null?void 0:m.enter(…)`) with exactly two arguments, a numeric literal (including exponent form `4e3`) and an object literal with an `entry_hint` property;
  - `tag`: a call named `tag`, or `.call` with the receiver first, whose last four arguments are `fn, <numeric literal>, <boolean>, <boolean>` (booleans as `true/false/!0/!1`).
- *What it can mismatch.* Only application code that calls a function named `enter` with `(literal, {entry_hint: …})`, or `tag`/`.call` with exactly that argument shape. Even then, a row is added only when the index is a module-pass index, and the extra row does not affect crediting.
- *Tests.* `embedded module-pass sites are AST shapes, not text matches`: `foo(a,5,!0,!1)` and a string containing `enter(5,{entry_hint:` are not sites; `x.call(rt,fn,5,!0,!1)` and `m.enter(5e0,{entry_hint:!1})` are. The marker gate recomputes the same shapes independently over the served JS.

### Express handler identity

`producttrace.express.handler.index` is now the handler's position in the route's **flattened** handler stack (`backend/express-handler-instrumentation.js`, `wrapHandler(…, position)`). Route pattern + method + index therefore identifies one handler even when middleware is registered as (nested) arrays. Previously every member of an array reported the array's start index. Test: `handler index is the position in the flattened stack…` (`test/backend-adapter.test.mjs`, fixture `test/fixtures/backend/express-array-runtime.mjs`: `[validatedRequest, [roleValid], validSlug], createThread` → 0, 1, 2, 3).

### Harness facts corrected

The wrapper, tarball and builds are generated under `/Users/austinho/dev/fixtures/.g2-work/<session>-<id>/`, outside both the fixture and the evidence directory, and are deleted after each run unless `--keep-builds` is passed. The marker gate is therefore recomputable only while that directory exists.

### Regression runs after the closes (Tracer `a64adeff`, not regraded)

`docs/evidence/g2-anything-llm-2026-09-23-r4/` and `docs/evidence/g2-bulletproof-react-2026-09-23-r3/` reproduce the graded runs exactly:
- the same gate results, credited counts, distinct functions, request stops and unattributed counts;
- the new first-party report line;
- unique handler indexes on anything-llm (0 repeats across 104 route traces).

## Rerun with the request bridge off and stamps on (2026-09-23, main `da8575e7` = G1+G3)

The one plugin line is `...producttrace({ requestBridge: false, stamps: true })`, installed from the `npm pack` tarball. Package code is unchanged; the harness changes are in `7cf682b3`.

Evidence:
- `docs/evidence/g2-anything-llm-2026-09-23-bridgeoff/` (valid, `--expect-commit ad97bc8d`);
- `docs/evidence/g2-bulletproof-react-2026-09-23-bridgeoff/`;
- `docs/evidence/g2-anything-llm-2026-09-23-bridgeoff-invalid/` (built another agent's `g5-scenario` branch; kept, not used).

Each valid directory has an independent `GRADE.md`.

| measure | anything-llm | bulletproof-react |
|---|---|---|
| path carrying `network.request` | runtime wrappers (no bridge asset served; `productTraceRuntimeFetch`/`Send` on the page) | same |
| requests: Tracer = Playwright | 71 = 71 | 12 = 12 |
| capture drained, contiguous (`sequence` and `stamp_sequence`), 0 dropped | yes (2 pages) | yes |
| React version / `capture.limit` rows | 18.3.1 / none | 18.3.1 / none |
| marker gate, parity, smoke, source clean | pass | pass |
| credits: correct / unrooted_global / wrong / misses | 23 / **0** / 0 / 0 | 12 / **1** route_loader / 0 / 0 |
| abstentions at `entry_handler` (justified) | 10 | 2 |
| writes credited to the developer-named handler | 6/6, joined to route + handler; stop at handler (Prisma) | 5/5; stop at network |
| attributed / unattributed requests | 27 / 44 (22 page load, **22 in-session**; the bridge-on run attributed these 22) | 9 / 3 (1 load, 2 hover); **all 4 earlier async-loss requests now attributed, correctly** |
| interactive hosts stamped (post-step snapshots) | 190/190 | 83/83 |
| stamp placements verified against source / sample keys | 132/132, 10/10 (grader 12/12) | 84/84, 10/10 (grader 12/12) |

Open items (frontiers, no package change):
- **unrooted_global remains when a route loader owns a request.** The binding check is skipped for request-owning frames, so bulletproof's Discussions link still credits `router.tsx:49`.
- **22 in-session anything-llm GETs lost their action.** They come from effects re-run by `setWorkspace` after an `await` and by react-router location changes. This happens on one repo only.
- **Stale window/document listener ownership (anything-llm).** Listener frames carry the action that registered them, not the dispatch that fired them. This changes no credit, but it degrades the reason recorded on 9 keydowns.

## Body capture through the one-line install (2026-09-24, branch `fix/body-capture`)

New plugin option, `producttrace({ bodies })`: `true` (the default) records request and response bodies as `network.body` rows in a dev build (Vite mode other than `production`) and none in a `production`-mode build (`capture.page.bodies: "production_off"`; an explicit `bodies: true` in such a build logs `body capture disabled: Vite mode is "production" (pass bodies: 'always' …)`). `'always'` keeps capture in a production build and logs `body capture ON in a production-mode build`. `false` turns it off everywhere (`"off"`). This mirrors the collector sink's `force` rule. The plugin writes `globalThis.__PRODUCTTRACE_BODIES__` into its settings script; an unset value means off. Rows, bounds and redaction: `docs/gates/G4-mcp.md` §3.3.

Because this harness builds in production mode, a fresh-repo run needs `"bodies":"always"` in `--plugin-options` to exercise capture. Run on anything-llm `ad97bc8d` with `--plugin-options '{"stamps":true,"requestBridge":false,"bodies":"always"}' --collector` from the `npm pack` tarball (evidence: `docs/evidence/pr-body-capture-2026-09-24/anything-llm/`):
- marker gate pass (5101 functions), **parity gate pass with bodies on** (115 lines, 0 diff), source clean, 8/8 steps;
- 71 requests, 74 `network.body` rows, every row linked to a `network.request` by `(page, request_occurrence_id)`; 0 truncated; 9 binary (PNG) type-and-size only; 334 values redacted across 20 key names (`JWTSecret`, `MilvusPassword`, `*AuthToken`, and over-matches such as `*TokenLimit`, `RequiresAuth`); no `authorization`/`cookie` key in the store;
- the MCP names the entity for each write, e.g. `POST /api/workspace/tracer-g2/update … [responded 200; no effect evidence; response ids workspace.id=1, workspace.router_id=null]`, with `request_fields: { name: "Tracer G2 renamed" }`;
- 1,577 body-row bytes per request on average (4.7% of the store's bytes);
- the first page's coverage is complete and declares `bodies: "on"` with 63 body rows. The second (live) page has no `capture.summary` because the harness closes the run without a `pagehide` on the live page. This is the harness's existing behaviour, not a body-capture effect.

### Revision after the independent grade (2026-09-24, same branch)

- **Warning rule.** The plugin now warns whenever body capture is on in a build whose Vite mode is not `development`: `body capture ON in a "<mode>"-mode build: …`. That covers `production` with `'always'`, `staging` and any other custom mode. The explicit `bodies: true` production warning (`disabled`) is unchanged.
- **Runtime changes.** The app's own behaviour is unchanged with bodies on: the same `unhandledrejection` events, streams it cancels close as before, and bodies whose type does not qualify are never read. The key redaction is by segment. Details and the rerun counts, including the anything-llm one-line run: G4 §3.3 and `docs/evidence/pr-body-capture-2026-09-24/RUN-2.md`.

## Amendment 2026-09-24: function names recorded at build time (`fix/function-names`)

The transform now records each instrumented function's source name in the manifest, next to its id, from the original file's AST that it already parses to find the function's exact boundary (`integrations/function-names.mjs`). Each `functions[]` row gains `name`, `name_kind` (`declaration | binding | property | method | export_alias | callback | inferred | anonymous`), `display_name`, and optionally `export_names`, `via`, `bound_to`, `accessor`, `static`. The build also writes `classes[]`: every first-party class bound to a name, keyed by its original span's id (the same `function:<content hash>:<start>:<end>` scheme) with its source name and `extends`, and registers the class object after its definition (`registerClass?.(Class, "<id>")`), so the runtime can say which instrumented class a thrown object was built by after minification renamed it.

- **Function ids do not change.** Names are additive fields computed from the same original span. The build id (`build`) is still computed over function and placement ids only.
- **Every build mode gives the same names.** `test/browser/function-names.mjs` builds one fixture with `vite build --mode development` (unminified), `vite build` (minified) and the dev server's module transform. It compares every shared function id's name fields: 54 of 54 are identical in each pair, and the three builds record identical class ids.
- **Marker gate unchanged.** `registerClass` is not a function site (its second argument is a string id). The marker gate passes on both fixture builds.
- **Found while building the fixture (not fixed here; a boundary rule, not a name rule).** When a call has explicit TypeScript type arguments, `forwardRef<A, B>((props, ref) => …)`, the source map puts the arrow's first token on the callee. The `valueOfToken` separator in `exactOriginalFunctionBoundary` does not accept `<…>` between the callee and `(`, so the boundary abstains and the arrow is not instrumented at all. The fixture therefore writes that `forwardRef` call without type arguments. Fixing it would change the boundary rule, and any function it newly resolves would get a new id, so it belongs in its own claim with its own drift check.

### Revision after the independent grade (2026-09-24, same branch)

- **Instrumented builds keep unused first-party classes.** `registerClass?.(X, id)` references every named first-party class, so the bundler can no longer tree-shake one that nothing else uses. The class's imports stay in the bundle too. Measured by the grader:
  - The fixture's production build grows by 576 B. Three unused test classes that `main` dropped are now kept.
  - anything-llm's production frontend grows by 178 B (one class).

  This is the same trade `registerFunction` already makes for function declarations. A lazier registration is possible later: from the class's own constructor, or only in modules whose classes are referenced.
- **Two boundary gaps: those functions are not instrumented at all.** Both predate this branch and are true on `main`. Neither is fixed here.
  - A function passed to a call with explicit type arguments: `forwardRef<A, B>((p, r) => …)`, `useMemo<T>(() => …)`, `useState<T>(() => …)`. LibreChat has 86 `forwardRef<` sites and about 52 other type-argument calls with a function argument.
  - `export default () => …`.

  Such a chain says "no instrumented function ran". This needs its own claim, with a drift check, because any function it newly resolves gets a new id.
- `export default class extends Error {}` is never registered. A thrown instance prints `runtime type <name>` with `source: null`.
