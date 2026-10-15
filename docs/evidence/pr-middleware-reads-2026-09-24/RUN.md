# fix/middleware-reads: run evidence (2026-09-24)

**Claim.** Every database operation in a request's server trace is attributed to that request and named by the server code that issued it.

Branch `fix/middleware-reads`, based on `main` f9a925d7. Written by the implementing agent. This is not an independent grade. Immutable: follow-ups go in RUN-2.md.

## Defect (generic)

Before this change, a request's database operations were collected only under Tracer's route-handler span. An auth middleware that reads `users` on every request therefore had its `find` in every backend trace, and Tracer dropped it from every chain without a note. The same happened to reads in `router.param` callbacks and error middleware. Two consequences:

- A POST whose only write came from middleware printed `responded`.
- A GET whose only reads were the middleware's printed `responded` too. This is PR #10's grade note on final7 `:19` and `:35`.

On the backend of `main`, `router.param` callbacks and four-argument error middleware have no span at all. Their operations hang directly under the HTTP server span; see `span-tree-main-backend.txt` against `span-tree-branch-backend.txt`, both produced by `span-tree.mjs`.

## Rules as implemented

1. **Collection.** A request's database operations are every database span under the admitted server span: exact trace id plus parent ancestry, via `serverSubtree` in `analysis/runtime-attribution.mjs`, shared by `attachBackendSpans` and `serverSpanDescendants`.
   - Each operation carries `issuer {kind, name, span_id}` plus `issued_by`. The issuer is the nearest ancestor below the server span that names server code. Kinds:
     - `handler`: Tracer's route-callback span
     - `param` and `error_handler`: new Tracer spans for `router.param` callbacks and for four-argument `use` error middleware
     - `middleware`, `route`, `router`: the official Express layer spans
   - If no ancestor names server code, the issuer is `issuer: unknown` and the operation is kept.
   - Printed as `find users (middleware: authenticate)`.
2. **Completion.** The HTTP rule for `completed` reads every operation in the trace.
   - Read-only middleware plus a handler write → `Completed 200: update tasks`. The sentence names `handler: renameTask`.
   - A middleware write plus a read-only handler → `Completed 200: insert activity (middleware: recordActivity)`.
   - The operation a label or frontier names is the last write, else the last read, preferring route-handler operations, in row order. On handler-only requests this names the same operation as before.
3. **Terminal middleware.** The backend now marks the span active when the response head is written (`producttrace.response.status_code`, set from `ServerResponse.prototype.writeHead` through the async context). The `route.dispatch` row carries `responded_by`.
   - When that span is a middleware, a param callback or an error middleware, the frontier is `stopped_at: "middleware"`, e.g. `server responded 401 from middleware authenticate; no handler ran`.
   - The segment summary adds `stopped at middleware authenticate (401); no handler ran`.
   - The outcome is still `failed 401`.
   - Backends without the mark (every banked store) never take this branch.
4. **Deferred work.** Operations starting at least 1 ms after the server span ended keep `deferred`, now with `issued_by`. Operations from another trace are never included; the fixture's background job in its own traces checks this.
5. **One builder for every surface.** `requestSegmentCore` in `analysis/causal-chain.mjs` builds the MCP segments. The export (`requests[].db_ops`, `responded_by`) and the live viewer's chain (`db.operation` steps with `issued_by`; `fiber-demo.js` prints it) carry the same rows. `compare_chains` keys db stops by operation, collection and issuer, so the full operation list is compared.

Backend fix found on the way: wrapping `Router.use` with shimmer made the official instrumentation unwrap its own `router.use` patch. That dropped every Express 4 middleware span in an in-process smoke on express 4.22.1 (query, expressInit and jsonParser missing). `use` and `param` are now plain overrides, and middleware spans are at parity with `main` on Express 4.22.1 and 5.2.1. The smoke scripts were scratch files and are not committed. The CommonJS fixture below runs on Express 5.2.1.

## Neutral fixture

The fixture is `test/browser/fixtures/middleware-reads-app/`, driven by `test/browser/middleware-reads.mjs`.

- **Backend:** CommonJS Express 5.2.1 with `mongodb` 6.21.0 on the local Mongo, database `producttrace_test_middleware`, dropped before and after each run.
- **Frontend:** React 18.3.1 with TanStack Query 4.44.0 mutations. That version is the one resolvable from the build's dependency root; the tracer root's 5.x would load a second React.

Nine actions:

| action | what the fixture does |
|---|---|
| `count` | the plain case: a route mounted before auth; only the handler reads |
| `guest` | the auth middleware reads `users`, then answers 401 |
| `tasks` | auth read, `router.param` read, handler read |
| `rename` | auth read, param read, handler write |
| `summary` | auth read, a path-scoped middleware write, param read, handler read |
| `ping` | auth read, param read, handler does nothing |
| `archive` | answers 202, then two deferred writes |
| `explode` | handler calls `next(err)`; the error middleware reads, then answers 500 |
| `missing` | the param callback answers 404 |

The driver recomputes every answer from raw spans in its own code and reads it back through the MCP over stdio (`action_chain`, `compare_chains`), `buildActionChains` and the viewer's `buildEpisodeChain`.

```
node test/browser/middleware-reads.mjs --runs 3 --out docs/evidence/pr-middleware-reads-2026-09-24/fixture-run --keep
→ 256/256 checks pass, per-action answers identical across 3 runs (ms values normalised)
```

Raw stores are kept under `fixture-run/store-{1,2,3}/` as `*.jsonl.gz` (`loadStore` reads them; `*.jsonl` is git-ignored): 107 records and 110 spans each. sha256 of the uncompressed files:

```
527b16f70012c19be459c87f2abe3b4759a724ad2e9d079bd2bc5aff0cd20ca3  fixture-run/store-1/records.jsonl
57a827967d5bb7b87254b93f2a6ed26cbf45bc7b17e21245d4d433f60a820e5b  fixture-run/store-1/runs.jsonl
650a846e0ec3089e8733d08f0cd1e7383962761d5c0efe2d4356c8bab50a058a  fixture-run/store-1/spans.jsonl
ac6131b38e23e46eafbfe92166e450101e0fa1b6bfe7678d1c017023c0ff8acb  fixture-run/store-2/records.jsonl
729ad69bc655a9c601ccc3a67e023d5489a236261a25f40cad2bba68981f3678  fixture-run/store-2/runs.jsonl
c70722d431c1c6dcaeb2f4a2e4b3e77700fb022377f8f5d79a491640794cc6dd  fixture-run/store-2/spans.jsonl
ea13bbc2fbd913bc2d7b34bc27e4f7d946437b286d1191c334719a7ffc3b9b68  fixture-run/store-3/records.jsonl
90e71db9bd1fd0732aad948da4ad5a148064825144a1ab0262b0e5ef0f3a8166  fixture-run/store-3/runs.jsonl
bb4f9f5e5ac3189b954519838568517e2c330b7af1a66d9bec6300fefe5b6ddb  fixture-run/store-3/spans.jsonl
```
 The build's manifest is `fixture-run/attribution-manifest.json`, the report is `fixture-run/middleware-reads-report.json` and the driver output is `fixture-run/driver-output.txt`.

The same store-1 read by `main`'s tools against this branch's tools (`fixture-run/diff-main-vs-branch.json`): 9 operations appear now that did not before, none disappear.
- `find users (middleware: authenticate)` ×8
- `insert activity (middleware: recordActivity)` ×1

The param and error-handler operations were already shown by `main` on these spans only because `main` counts every Tracer handler-instrumentation span as a handler. On `main`'s own backend those spans do not exist, and the operations would be dropped. Changed actions:
- guest: `stopped at route` → `stopped at middleware / server responded 401 from middleware authenticate; no handler ran`
- summary: `Responded 200: no write observed` → `Completed 200: insert activity (middleware: recordActivity)`
- explode: `stopped at none` → `stopped at middleware / server responded 500 from error handler reportError; after handler explodeProject`
- missing: `stopped at none` → `stopped at middleware / server responded 404 from param loadProject; no handler ran`

## Banked stores (main f9a925d7 vs branch; the banked evidence is not edited)

Commands:

```
node banked-surfaces.mjs --tree <main|branch> --store <store> [--manifest m] --out x.json
node banked-diff.mjs main.json branch.json
```

**final7** (`final7-diff-main-vs-branch.json`, table `final7-new-ops-table.md`): 54 actions. **229 operations** appear now that did not before. They belong to 56 requests of 13 actions, and none disappeared.

| operation | count |
|---|---|
| `find logs (middleware: checkBan)` | 144 |
| `find users (middleware: requireJwtAuth)` | 79 |
| `find systemgrants (middleware: <anonymous>)` | 2 |
| `find users (middleware: optionalJwtAuth)` | 1 |
| `find conversations (middleware: validateConvoAccess)` | 1 |
| `find agents (middleware: buildEndpointOption)` | 1 |
| `find users (issuer: unknown)` | 1 |

The `issuer: unknown` operation is on `GET /api/admin/roles`: no naming span encloses it, so it is kept, not dropped. Label and status changes:
- `action:mud8t36a:19` and `action:mud8u6q1:35`: `responded` → `completed`. Their headline requests' only reads are `requireJwtAuth`'s; the labels are `Completed 200/304: find users (middleware: requireJwtAuth)`.
- `action:mud8rf23:6` (login): its `also …` list lost six `responded 200 GET …` entries. Those GETs are now `completed` on the auth read.
- The other 10 changed actions changed `because` only: the issuer suffix was added, the same operation is named.

**G6** (`g6-diff-main-vs-branch.json`): 408 actions, 0 new operations, 0 changes; the MCP surfaces are byte-identical. The store has no database spans (Prisma/SQLite, uninstrumented). g6-compare regenerated on the branch and on `main`: `compare/` byte-identical. g6-grader PASS 6/6. No G6 expectation changed.

## Suites (branch head before this file)

| suite | result |
|---|---|
| `npm test` | tests 700, pass 699, fail 1 (known `react-context-ref-semantics`), skipped 0 (backend register tests ran against Mongo) |
| `test/g4-grader.mjs` on final7 | 81/81 |
| `test/browser/outcome-labels.mjs` | 160/160 |
| `test/browser/mcp-gaps.mjs` | 35/35 |
| `test/browser/d12-stamp-neutrality.mjs` | 23/23 checks true |
| `test/browser/continuations-neutral.mjs` | status ok |
| g6-compare + g6-grader | PASS 6/6 |
| `npm run build` and `cmp src dist` | identical (src untouched) |

Test and grader changes, all to the documented new rule. The G4 gate amendment is dated 2026-09-24, fix/middleware-reads.

- `test/g4-grader.mjs`: its independent recompute now takes every database span under the server span and derives the issuer from raw attributes. Its regenerate pair now expects `path_changed: true`: the first regenerate's `find conversations (middleware: validateConvoAccess)` is absent from the second, and the grader's own signature agrees.
- `test/mcp.test.mjs`:
  - compare keys now carry the issuer;
  - send vs agent-chat adds two middleware reads;
  - send vs rename moves the conversations write from `handler: controller` to `handler: <anonymous>`;
  - `:35` is `completed`;
  - the synthetic summary and `deferred` carry issuers.
- `test/browser/mcp-gaps.mjs`: its three summary regexes now include the issuer.

## Residual risks (stated, not fixed)

- **Broken ancestry.** A database span whose parent chain is broken is not counted: it has a parent span id that is missing from the store (for example a custom app span that `register.js` does not ship). Such a span is not listed anywhere; it is invisible, not guessed. Only `unknown`-issuer spans that do reach the server span are listed.
- **`$cmd` collections.** `countDocuments` / `aggregate` / `distinct` print `$cmd` as their collection (`aggregate $cmd`). This is existing normalisation: only `findAndModify` takes the collection from the command. It is unchanged here.
- **Which code responded.** The mark is set on the span active in the async context at `writeHead`. A handler that ends its span and then responds from a detached context (for example a sync handler that sets a timer, then responds) leaves no mark on a live span, so `responded_by` is null and the frontier falls back to the old rule. Two marks in one subtree also give null (abstain).
- **Stop vocabulary.** `stopped_at: "middleware"` covers middleware, param callbacks and error middleware alike. `because` names which.
- **Safe methods.** A safe method whose only reads are middleware reads is now `completed`, with the middleware named in the label. That follows the HTTP rule as written. Whether an auth read should count as a GET's effect is a policy call for the owner.
- **Headline order.** The operation a headline names follows the rows' span-file order within a class. Collector arrival order is not strictly span end order.
- **Express 4 `lazyrouter`.** The official Express instrumentation, not this change, cannot name the first `app.use` layer of an Express 4 app when its own `router.use` patch is absent. With this change that patch survives, and the in-process 4.22.1 smoke named every layer.
- **Commit trailers.** Commits carry `Co-Authored-By: Claude Opus 5.5 (1M context)` (the model that wrote them), not the trailer named in the brief.
