# fix/middleware-reads: follow-up run after the independent grade (2026-09-24)

This run applies the four required changes from `GRADE.md` (commit 7167f4d0) and the coordinator's ruling on them. RUN.md is unchanged. Written by the implementing agent; not a grade.

## 1. Never dropped: a database call inside the app's own span (grade probe y)

**Cause.** `backend/register.js` shipped only server, Express, Tracer-handler and database spans. A `countDocuments` call made inside `appTracer.startActiveSpan('loadStats', …)` therefore had a parent the store never received, and the operation appeared on no surface.

**Fix, both options from the grade:**

- **Preferred option (commits 9b217f61, 3153f93e):** `register.js` now ships every other span of a trace that holds an incoming server span as a skeleton.
  - A skeleton carries ids, parent, name, kind, times, scope and one attribute, `producttrace.span.skeleton: true`.
  - Server traces are learnt at span start through a new `onSpanStart` option on `startNodeBackendTelemetry`, and the set is bounded at 20,000.
  - The issuer walk passes through app spans to the naming code, e.g. `aggregate $cmd (handler: projectStats (in app span loadStats))`. With no naming code above it, the issuer is `app span: <name>`.
  - Traces with no server span ship nothing extra. The fixture's background-job root span is absent from the store, and the fixture asserts that.
- **Minimum option (for backends that still do not ship the parent):** a database span of the request's trace whose ancestry leaves the store is listed on the trace's only server span as `issuer: unknown (parent <id> not recorded)`, with `ancestry_broken_at` on the row. With two server spans in the trace the span cannot be placed, so it is not listed (abstain). This is checked on the grader's own probe store, which was recorded with the old register: `grader-scratch/probe-store-e5y`, action `gradere5y:y` now reads `… → db find items (handler: withManualSpan), aggregate $cmd (issuer: unknown (parent 90deb9ce07f80666 not recorded)) [completed 200]`. Synthetic cases are in `test/middleware-reads.test.mjs` (6 tests).

**Probe (y) in the neutral fixture.** New action `stats`: the handler's `countDocuments` runs inside the app span `loadStats`. It prints `aggregate $cmd (handler: projectStats (in app span loadStats))`, and the skeleton span carries no attribute but the marker.

## 2. Ruling: middleware reads are preconditions, not effects

This is written into the G4 amendment dated 2026-09-24.

- **Preconditions** are reads by app-level middleware, `router.param` callbacks and routers.
- A **safe-method request is `completed`** only when some other database operation exists. That means one issued by the route's handler (middleware registered on the route itself is part of the handler), by an error middleware, by an app span, by unknown code, or by the code that wrote the response.
- **Otherwise the request is responded:** `Responded 200: no database work after the preconditions (find users by middleware requireJwtAuth)`, with `stopped_at: handler` (or `route`) and `stop_reason: preconditions_only`. No terminal effect is claimed.
- **The unsafe-method write rule is unchanged:** a middleware write still completes the request and is named.
- **Precondition-only reads on an unsafe method** keep `Responded 200: no write observed`, and their frontier is the same `preconditions_only` stop instead of "terminal effect observed".
- **The export** applies the same rule.

Fixture additions:
- `whoami` (a GET where only the auth middleware reads): `Responded 200: no database work after the preconditions (find users by middleware authenticate)`, stopped at handler.
- `owner` (route-level middleware `requireOwner` reads): `Completed 200: find users`, issuer `handler: requireOwner`.
- `ping` (unsafe method, preconditions only): stopped at handler with the preconditions sentence.

### Banked label changes

These compare `main` f9a925d7 with this head: `final7-diff-main-vs-branch-2.json`; round 1 against round 2 is in `final7-diff-round1-vs-round2.json`.

**final7:** 54 actions, 229 operations newly listed with issuers, none removed; 13 actions changed.

- **Two label changes** against `main`. Both stay `responded`, and `stopped_at` stays `handler`:
  - `action:mud8t36a:19`: `Responded 200: no effect evidence; also …` becomes `Responded 200: no database work after the preconditions (find users ×2 by middleware requireJwtAuth, find logs ×4 by middleware checkBan); also completed 200 GET /api/agents/categories, completed 200 GET /api/skills, completed 200 GET /api/admin/roles, completed 304 GET /api/models`.
  - `action:mud8u6q1:35`: `Responded 304: no effect evidence; also completed 304 GET /api/projects` becomes `Responded 304: no database work after the preconditions (find logs ×4 by middleware checkBan, find users by middleware requireJwtAuth); also completed 304 GET /api/projects`.
  - For both, `reached` goes from `handler` to `db` (the reads are the request's) and `because` is the preconditions sentence.
- **Round 1 against round 2:** `:19` and `:35` return from `completed` to `responded`. Login `action:mud8rf23:6` gets its six `also responded 200 GET …` entries back, so its label is identical to `main`'s again.
- **Frontier sentences:** the other 11 changed actions changed `because` only. The issuer suffix is added, and the named operation is unchanged from `main`.

**G6:** 408 actions, byte-identical MCP surfaces against `main`. The store has no database spans. g6-compare `compare/` is identical to `main`, and g6-grader passes 6/6. No G6 expectation changed.

**Neutral fixture, store 1 against `main`'s tools** (`fixture-run-2/diff-main-vs-branch.json`): 24 actions; 12 operations newly listed (`find users (middleware: authenticate)` ×11, `insert activity (middleware: recordActivity)` ×1); 12 actions changed.

## 3. Tripwire in `npm test`

`test/backend-register.test.mjs`: the esm and cjs fixture apps gain `app.use(async function authenticate…)`, which reads `users`. The test asserts an `express.type: middleware` span named `authenticate` whose child is the mongodb read.

- **Express 4 test:** added through the devDependency alias `"express4": "npm:express@^4.21.2"` (commit 95022af3).
  - `package.json` changed; `package-lock.json` was regenerated with `npm install --package-lock-only --ignore-scripts`, and all 380 lockfile lines are additions: `node_modules/express4` with its nested dependencies, plus six small root packages.
  - **`node_modules` was not touched.** Main must run `npm install` before merge.
- **How the Express 4 test runs:** the instrumentations match modules by directory name, so the test copies the package into a scratch `node_modules/express` and resolves its dependencies through `NODE_PATH`. It skips with a message until `express4` is installed; `PRODUCTTRACE_TEST_EXPRESS4_DIR` overrides the location.
- **Verified here** with `PRODUCTTRACE_TEST_EXPRESS4_DIR=/Users/austinho/dev/fixtures/anything-llm/server/node_modules/express` (4.22.1): 4/4 pass.
- **Verified to trip:** with the pre-fix shimmer-wrapping instrumentation temporarily restored, the Express 4 test fails with `no middleware span for authenticate`.

## 4. One builder, stated precisely

The G4 amendment now states the claim precisely:
- Operations with issuers, `responded_by` and `deferred` come from `requestSegmentCore` on every surface. Exported `requests[]` are now built from it and gain `deferred`.
- Labels come from `actionOutcome` everywhere, and the MCP and viewer frontiers come from `chainFrontier`.
- The export's per-request `stopped_at` / `because` keep the export's own G1 wording. They apply the middleware and precondition rules through the shared `terminalMiddleware` / `preconditionsOnly`.
- I did not route the export's wording through the core: `test/browser/g1-grade.mjs` and `test/frontend-only.test.mjs` pin that vocabulary.
- The grader's `/health` `because` difference is that wording, and it predates this branch.

## Suites (head before the docs commit)

| suite | result |
|---|---|
| driver `test/browser/middleware-reads.mjs --runs 3` | **343/343**, 12 actions × 3 runs, answers identical across runs; stores in `fixture-run-2/store-{1,2,3}/*.jsonl.gz` (140 records, 150 spans each) |
| `npm test` (with `PRODUCTTRACE_TEST_EXPRESS4_DIR`) | tests 707, pass 705, fail 2 |
| `npm test` (without the override) | tests 707, pass 704, fail 2, skipped 1 (the Express 4 test, not installed) |
| backend register tests | 4/4 with the override (Mongo up) |
| G4 grader on final7 | 81/81 |
| outcome-labels | 160/160 |
| mcp-gaps | 35/35 |
| D12 | exit 0 |
| continuations-neutral | status ok |
| g6-compare + g6-grader | PASS 6/6, `compare/` identical to `main` |
| `npm run build` + `cmp src/runtime-attribution-browser.js dist/runtime-attribution-browser.js` | identical |

The two `npm test` failures:
- The known `react-context-ref-semantics` test.
- `test/react-input.test.mjs` "packed Node analysis API … isolated consumer" fails with `npm install --offline`: ENOTCACHED `@jridgewell/sourcemap-codec`.
  - It **fails identically on the main checkout** (`/Users/austinho/dev/tracer` at f9a925d7), so the cause is the environment, not this branch.
  - `~/.npm/_cacache` now holds 4.5 MB and was last modified at 14:45 PDT, and the test passed in the RUN.md run at about 14:10. My `npm install --package-lock-only` ran at about 14:43 PDT. I cannot tell from the rotated npm logs whether that command, or something else on the machine, emptied the cache.
  - Refilling the cache (for example `npm cache add` of the package's dependencies, or one online `npm install`) should restore it. I did not change the user's npm cache.

sha256 of the uncompressed fixture-run-2 files:

```
498251546df2c5eb0c5dd90312a975f3f71dd69c5bafde1d5b7691d535430841  fixture-run-2/store-1/records.jsonl
451befc711e956565c8ff14d65904bb2ca2fe88c850dba68114f1e4eec318629  fixture-run-2/store-1/runs.jsonl
c13d72bebe4605c16e23e74ebdb8d489e952a508491d33aa7d31f514f8b9356a  fixture-run-2/store-1/spans.jsonl
687896575172130ad2b035996b0d3c6046ba75e2789e94695fa6879be5b52052  fixture-run-2/store-2/records.jsonl
501c6282474322023d4f06ad35b4cc4f2879c2a4108c144f104bb627149be351  fixture-run-2/store-2/runs.jsonl
2d56a0d69d4d4072175d06b802f4895bd0e0f0503a3bbbf4cdc320801fe42756  fixture-run-2/store-2/spans.jsonl
6641028a8d69b9ab30a1c46b5875bd1e30ab802a0fc72f1f2a3b457474dc9acb  fixture-run-2/store-3/records.jsonl
fb32cc85c86d205f2de67aed91345001de3f91baed8741a9048ab6e13e81f476  fixture-run-2/store-3/runs.jsonl
41cc61cf832c9e0f9eb7873a2bfb0f34d40e79a7137701ae253501f86b59011e  fixture-run-2/store-3/spans.jsonl
```

## Residuals (in addition to RUN.md's)

- Skeleton shipping adds one POST per extra span in server traces; its volume on busy apps was not measured. The server-trace set is learnt at span start, so a span in a trace whose server span started in another process is not shipped.
- An `issuer: unknown` operation counts as work (not a precondition) for the safe-method rule; a middleware read whose middleware span is missing would therefore complete a GET. The Express 4/5 tripwire guards the common cause.
- A request whose only reads are made by the middleware that also wrote the response counts them as work, since that code is the request's terminal handler.
- A write in a `finally` or after `res.json` that starts less than 1 ms after the response is not marked `deferred`. This is the existing floor, noted by the grader.
- Commit trailers on my new commits read `Claude Opus 5.5 (1M context)`, the model that wrote them.
