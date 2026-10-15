# fix/middleware-reads: independent grade (2026-09-24)

The grader did not write this branch. Branch `fix/middleware-reads` at head `5cee6990`, 8 commits on `main` `f9a925d7`. Every number below was recomputed from raw `spans.jsonl` / `records.jsonl` rows by the grader's own scripts, which import nothing from `analysis/` for the expectation. The MCP was driven over stdio as a black box. Scratch scripts and stores are in `grader-scratch/`, which is untracked and not committed: `recompute.mjs`, `probe-server.cjs`, `probe-harness.mjs`, `spanparity.mjs`, `surfaces.mjs`, `surfaces2.mjs`, `ychk.mjs` and `main-tree/` (a `git archive f9a925d7`).

**Claim.** "Every database operation in a request's server trace is attributed to that request and named by the server code that issued it."

**Verdict: merge with changes.** The four required changes are listed at the end.

On every store the branch ships or banks, and on 14 new probes on Express 4.21.2 and Express 5.2.1, every database span under a request's server span is in that request's op list, in every surface, with the issuer the grader derives from the raw parent chain. No op crosses to another request, and none is dropped. The suites match the author's table.

The claim fails in three places:
- **A database span in the request's own trace is silently dropped when an app span sits between it and the handler.** An app span is one the app starts itself, such as a manual OpenTelemetry span. This breaks "never dropped".
- **The flip from `responded` to `completed` on auth-only reads states a terminal effect the evidence does not show.**
- **The Express 4 middleware-span repair has no committed test.**

## Per-rule table

| rule | verdict | raw evidence |
|---|---|---|
| Every DB span under the incoming server span (exact trace id + ancestry) is in the request's op list | **PASS on every store tested; FAIL on probe (y)** | Fixture stores (3 fresh runs, plus the 3 banked `fixture-run/store-*`): 23 of 23 DB spans under the 9 server spans are listed, with 0 mismatches against MCP `action_chain` segments by span id. final7: 507 DB spans under the 68 admitted server spans; all 507 are in the MCP segments with the grader's issuer; 0 missing, 0 extra. Probes e5/e4: 21 of 21 each. **Probe (y):** `countDocuments` span `29fb2c9a3e302592` is in trace `3f982c46…` (the request's trace). Its parent `90deb9ce07f80666` is the app's manual span `loadStats`, which `backend/register.js:84` (`relevant`) does not ship. The span appears in no segment, stop, `unlinked` list or summary of `action_chain` (grep of the full MCP reply for the span id: false). |
| Issuer = nearest enclosing span naming server code, else `issuer: unknown`, never dropped | PASS, with caveat | All listed ops carry the grader-derived issuer. Example: final7 `GET /api/admin/roles`, db `1b9e7ce9f1242ace`, parent is the server span `bbec449b05b5db4f` directly, printed `find users (issuer: unknown)` and kept. Caveat 1: the silent drop in the row above. Caveat 2: route-level middleware (`app.post(path, requireUser, createItem)`) is named `handler: requireUser`. The name is right, but the kind is `handler`, not `middleware`, because it is a route callback (pre-existing handler spans). |
| `completed` considers the whole trace | PASS as implemented; **honesty problem, see §3** | Fixture `summary`: middleware write `fab39279af827fac insert activity (middleware: recordActivity)` gives `Completed 200: insert activity (middleware: recordActivity)`. `ping` (POST, reads only) gives `Responded 200: no write observed`. |
| Middleware that ends the request is the terminal handler (`stopped_at: middleware`, `failed N`) | PASS | Fixture run 1: `guest` 401, writer span `598ca94121c043b7` (middleware authenticate), no handler span, printed `failed 401 … server responded 401 from middleware authenticate; no handler ran`. `explode` 500, writer `d261456614379b41` (error handler reportError), `… after handler explodeProject`. `missing` 404, writer `ee24461d2b57fd19` (param loadProject). Probe (a): writer lateReader, `server responded 200 from middleware lateReader; after handler routeThenNext`. Probe (e1)/(e2): the default finalhandler writes the response in the HTTP server span's context, so `responded_by` is `issuer: unknown` and there is no middleware stop (it abstains; correct). Probe (x3): a timer reply leaves no mark, so null (abstains, as RUN.md says). |
| Deferred ops keep their marking | PASS (rule unchanged) | Fixture `archive`: `8a16957718fde9bf update projects` and `9f5691a36d7d21b2 insert audit` are both deferred (41.1 / 43.1 ms) with `issued_by`. Probe (d): the `finally` write starts 0.55 ms after the server span ends. The 1 ms floor keeps it unmarked, and the label `Completed 200: insert audit` claims completion on a write the client never waited for. That label is pre-existing floor behaviour, not a regression. |
| Other traces never included | PASS | Fixture: 35 / 31 / 31 background-job DB spans. Each is in its own trace, with a root parent missing from the store and no request row in its trace. None is listed. final7: 512 DB spans outside every request's server subtree, 0 of them in a trace that carries a request. Probe (g): three concurrent `GET /g/:id` requests, 2 ops each, none crossed (e4 and e5). |
| One segment builder on every surface | **PARTIAL** | The MCP segments use `requestSegmentCore` (`analysis/causal-chain.mjs:475`). The export does not: `buildActionChains` still computes per-request frontiers in `requestFrontier` (`analysis/runtime-attribution.mjs:794`), sharing only `serverSubtree` and `terminalMiddleware`. Across all 105 requests compared (probes, fixture, final7), export and MCP agree on op span ids, issuers and `stopped_at`. The `because` text still diverges on final7 `GET /health`: export `no span on trace`, MCP `no server span with the exact parent span id arrived in the same trace`. That divergence is pre-existing (main diverges on 9 requests, the branch on 1). |
| `compare_chains` compares the full op list | PASS | Keys are (operation, collection, issuer), counted. The G4 regenerate flip is real in the rows: in `action:mud8smva:4` the `validateConvoAccess` layer span `28cf15bd9e94cd1e` has a `mongodb.find` child. In `action:mud8sys4:17` the same layer span `b9bc046bbde2ffe4` has no child, a cache-style skip. Every other op multiset in the pair is identical. `path_changed: true` is therefore true of the rows. It is a precondition-read difference, and an agent reading "path changed" should see the `db` reason. |
| Tested on something no existing fixture uses | PASS | CommonJS Express 5.2.1, `router.param`, error middleware, TanStack Query 4.44.0. The grader's probes add Express 4.21.2 (`/Users/austinho/dev/dallas/node_modules/express`). The LibreChat fixture's trees all carry express 5.2.1, so no 4.x was reachable there. |

## 1. Driver (3 runs, fresh)

`node test/browser/middleware-reads.mjs --runs 3 --out grader-scratch/driver-run --keep` → 256/256, answers stable across runs.

The grader's `recompute.mjs` on each fresh store and on the 3 banked stores found 9 requests, 23 ops, 0 mismatches and 0 uncovered spans in request traces. The banked `store-{1,2,3}` sha256 values match RUN.md. Per-request ops and writers (run 1) are exactly the fixture table in RUN.md.

## 2. Probes (`grader-scratch/probe-server.cjs`, run under `--import producttrace/backend/register`, synthetic click and request rows with real `traceparent`)

| probe | Express 5.2.1 | Express 4.21.2 | notes |
|---|---|---|---|
| (a) `app.use` registered after the route, reached via `next()` | ops `find items (handler: routeThenNext)`, `aggregate $cmd (middleware: lateReader)`; stopped at middleware lateReader (200) | same | The headline names the handler's read (`Completed 200: find items`) although lateReader wrote the response. Non-blocking. |
| (b) one handler, nested router mounted at /v1 and /v2 | each request: its own `find items (handler: sharedList)` | same | compare b1→b2: route changed, op same |
| (c) `router.param` on two params | `find orgs (param: loadOrg)`, `find teams (param: loadTeam)`, `aggregate $cmd (handler: showTeam)` | same | main drops both param reads |
| (d) DB write in `finally` after the response | `insert audit (handler: respondThenAudit)` | same | not `deferred` (0.55 ms < 1 ms floor), see table |
| (e1) `next(err)` → error handler writes → `next(err)` → default 500 | `insert errors (error handler: logAndForward)`, `Failed 500`, stopped_at null (writer = server span, abstains) | same | |
| (e2) same, error handler calls `next()` → default 404 | same, `Failed 404` | same | |
| (f) async middleware reads, handler writes | `find users (handler: requireUser)`, `insert items (handler: createItem)`, `Completed 201: insert items` | same | issuer names are right; kind is `handler` for route-level middleware |
| (g) 3 concurrent requests, same route | 2 own ops each, no crossing | same | |
| (x1) route callback answers 200 from a cache read | `find items (handler: cacheLayer)` | same | |
| (x2) anonymous route-level middleware | `find users (handler: <anonymous>)` | same | |
| (x3) reply from a timer | op listed; `responded_by` null | same | |
| **(y) DB call inside an app's manual OTel span** | **`aggregate $cmd` span `29fb2c9a3e302592` dropped from every surface** | not run | trace is the request's; parent not shipped by `register.js` |

**Middleware-span parity vs main** (`spanparity.mjs`, same probe app under `main-tree`'s register): the official `express.type` layer spans are identical per request, 14 of 14, on Express 5.2.1 and on Express 4.21.2 (5 layer spans per request on 4.x, including `query`/`expressInit`). The author's parity statement holds on 4.x.

## 3. The HTTP-rule consequence (safe method, auth-only reads)

On final7, `action:mud8t36a:19` now prints `Completed 200: find users (middleware: requireJwtAuth)` and `action:mud8u6q1:35` prints `Completed 304: find users (middleware: requireJwtAuth)`. The login action `:6` loses six `responded 200 GET …` entries for the same reason.

This literally satisfies "safe method: 2xx/304 + any DB span". It is not honest under the frontier vocabulary. The same answer says `stopped at none (terminal effect observed)` and `because database read find users (middleware: requireJwtAuth) … no write`. An auth lookup is not the GET's effect, and on `:35` the server returned 304 without a body. The branch's own `headlineOp` comment calls middleware and param reads "preconditions". Counting a precondition as the only evidence of completion contradicts that.

**What I would print:** `Responded 200: no database work after the preconditions (find users by middleware requireJwtAuth)`, with the op still listed and `reached: db`.

A param read can be the effect, for example `GET /projects/:id` answered from `req.project`. That sentence stays true in that case too, and it leaves the judgement to the reader instead of guessing, as abstain-over-guess requires. `completed` on a safe method should need an op issued by the route handler or by the code that wrote the response (`responded_by`). The alternative is for Austin to rule, in writing in the G4 amendment, that precondition reads count.

## 4. Banked stores vs main (`git archive f9a925d7` → `grader-scratch/main-tree`)

final7, computed by the grader from MCP segments on both trees, keyed by (action, request, span id):
- Branch 507 ops, main 278: **+229, −0**, across **56 requests of 13 actions**.
- Breakdown:
  - `checkBan` 144
  - `requireJwtAuth` 79
  - `<anonymous>` systemgrants 2
  - `optionalJwtAuth` 1
  - `validateConvoAccess` 1
  - `buildEndpointOption` 1
  - `issuer: unknown` 1
- This matches the author's table exactly.
- Every op is under its server span in the raw spans: the grader's recompute gives 507 = 507.
- Label changes are exactly `:6`, `:19` and `:35`.

G6 (unpacked banked store): `g6-compare` run on the branch and on main gives byte-identical `compare/*.json`, except the rendered store path argument (the `<tracer>/…` vs absolute path, from the tree location). There are 0 DB spans. `g6-grader` PASS 6/6.

## 5. Suites (grader-run, this head)

| suite | result |
|---|---|
| `npm test` | 700 tests, 699 pass, 1 fail (`react-context-ref-semantics` "different context objects never borrow…", known), 0 skipped |
| `node test/g4-grader.mjs docs/evidence/m1-2026-09-22-final7 --manifest docs/evidence/g4-mcp-2026-09-23/manifest.json` | 81 PASS, 0 FAIL |
| `test/browser/outcome-labels.mjs` | 160/160 |
| `test/browser/mcp-gaps.mjs` | 35/35 |
| `test/browser/d12-stamp-neutrality.mjs` | pass, 23/23 checks true |
| `test/browser/continuations-neutral.mjs` | status ok |
| g6-compare + `test/g6-grader.mjs` | 6/6 |
| `npm run build`; `diff -r src dist` | identical; working tree clean after build |

**Grader diff.** `test/g4-grader.mjs:77` `gradeIssuer` walks raw parents and reads only adapter-written span attributes: `producttrace.express.handler.kind` / `.name` (written by `backend/express-handler-instrumentation.js`), `express.type` / `express.name` / `http.route` (official instrumentation). It reads no derived field (`issuer`, `issued_by`, `responded_by`). That is acceptable. It shares no code with the package, but it re-implements the same nearest-ancestor rule, so it verifies the implementation, not the rule. The regenerate-pair flip at `test/g4-grader.mjs:196` is supported by the rows (see the table).

## 6. Backend risk

- `use` and `param` are plain overrides on `Router.prototype` (5.x) or `Router` (4.x) (`backend/express-handler-instrumentation.js:131`, `:209`, `:218`). They carry no shimmer `__wrapped` / `__original`, so `isWrapped()` in `@opentelemetry/instrumentation-express` 0.56.0 is false for them. The official patch (`instrumentation.js:47–51`) therefore never unwraps them, and wraps over them if it patches second. Ours is pushed after the official instrumentation (`backend/index.js:183`). Parity was verified on 4.21.2 and 5.2.1 above.
- **Upgrade exposure.** Several changes in a future official release would break issuer names:
  - an `isWrapped` that also accepts `__unwrap`, which ours defines;
  - patching `Layer` or the `router` package instead of `Router.use`;
  - starting to wrap `param` / error middleware itself, which would give a double span (ours is nearest, so harmless).

  In each case the failure is silent. Middleware ops stay attributed, because ancestry still reaches the server span, but their issuer degrades to `issuer: unknown`.
- **No test in `npm test` would catch that.** `test/backend-register.test.mjs` asserts server → route → handler → mongodb only. It asserts no `express.type: middleware` span and no middleware-issued op. The only check is the Mongo + Chromium driver on Express 5, which is not in `npm test`. The Express 4 regression the author found (shimmer unwrap dropping `query` / `expressInit` / `jsonParser`) was verified only by uncommitted scratch smokes.
- The `writeHead` patch is process-global on `ServerResponse.prototype`. It is cheap, and it marks only a recording span. It abstains on ambiguity (more than one mark) and on ended spans.

## Required changes (merge with changes)

1. **Never drop a same-trace DB span with broken ancestry.** Probe (y) shows this with a manual OTel span inside a handler, a common app pattern. Two acceptable fixes:
   - Preferred: have `backend/register.js` ship a skeleton of every span in a trace that carries a server span (id, parent, name, kind), so ancestry walks through app spans to the real issuer.
   - At minimum: list such spans in the owning request's segment, export and summary as `issuer: unknown` with `ancestry_broken_at: <parent id>`.

   Exact trace id stays the join. The background job's own traces stay excluded. Add probe (y) to the neutral fixture.
2. **Safe-method completion.** Either stop counting precondition-only reads (middleware / param, no op from the route handler or from `responded_by`) as `completed` and print `Responded … : no database work after the preconditions (…)` (final7 `:19`, `:35`, login `:6` "also" entries), or record Austin's explicit ruling that auth reads count, in the G4 amendment, before merge.
3. **Tripwire test in `npm test`.** Extend `test/backend-register.test.mjs` (esm and cjs apps): add a named `app.use` middleware with a DB read, then assert an `express.type: middleware` span with its `express.name` and the DB span beneath it. Add the same test on Express 4.x, for example via a devDependency alias `express4@npm:express@^4`, because the 4.x regression is the one this branch fixed.
4. **Claim wording.** The claim says "one segment builder on every surface", but the export still builds its frontier in `requestFrontier`. Either route `buildActionChains` per-request output through `requestSegmentCore`, or restate the claim in a RUN-2.md and in the G4 amendment. Say that ops, issuers and `stopped_at` are shared, and that the export's `because` wording is its own. The `/health` divergence above is pre-existing.

## Non-blocking notes

- Route-level middleware is labelled `handler: <name>` and counts as a handler op for the headline and for "server X,Y". The names are correct.
- Probe (a): when a later middleware writes the response, the headline still prefers the route handler's read. Preferring `responded_by`'s ops would be more faithful.
- A `finally` / after-`res.json` write under 1 ms is not marked deferred, and the label claims completion on it. This is pre-existing floor behaviour; note it in LIMITS.
- `$cmd` collections for `countDocuments` / `aggregate` are pre-existing.

## Commands

```sh
node test/browser/middleware-reads.mjs --runs 3 --out grader-scratch/driver-run --keep
node grader-scratch/recompute.mjs --store <store> [--tree grader-scratch/main-tree] [--manifest m] --json out.json
node grader-scratch/probe-harness.mjs --express <express dir> --label e5|e4|e5y [--tree grader-scratch/main-tree]
node grader-scratch/spanparity.mjs
node grader-scratch/surfaces.mjs grader-scratch/probe-store-e5 e5
node grader-scratch/surfaces2.mjs <store> <recompute json>
npm test; node test/g4-grader.mjs docs/evidence/m1-2026-09-22-final7 --manifest docs/evidence/g4-mcp-2026-09-23/manifest.json
node test/browser/{outcome-labels,mcp-gaps,d12-stamp-neutrality,continuations-neutral}.mjs
node test/browser/g6-compare.mjs --store grader-scratch/g6store --source-root /Users/austinho/dev/fixtures/anything-llm --out grader-scratch/g6-branch --pair … (×6); same from main-tree; diff -r
node test/g6-grader.mjs grader-scratch/g6store --compare grader-scratch/g6-branch
npm run build && diff -r src dist
```

Test databases created by the grader (`producttrace_grader_probe_*`) were dropped. The driver drops `producttrace_test_middleware` itself. No processes were left running.

---

## Regrade at 0cc3e233

This is a targeted regrade by the same independent grader. The branch head is `0cc3e233`. My first grade is in its history as `7167f4d0`. The author's notes are in `RUN-2.md` and the stores in `fixture-run-2/`.

The grader's scripts are in `grader-scratch/` (untracked):
- `recompute.mjs` now applies the grader's own rule for app spans and broken ancestry. A walk passes through non-server, non-DB spans and records them. A same-trace DB span whose ancestry leaves the store belongs to the trace's only server span, and is reported as `UNPLACED` when the trace has more than one.
- The probe server gains probe (w): the handler calls this same server over HTTP, which gives two server spans in one trace, and the inner handler reads inside an app span.
- `opsparity.mjs` compares the export with the MCP.
- `synth-store/` is a synthetic request whose only reads are middleware reads, with no handler span.
- `revert-tree/` is `git archive HEAD` with `c9511e73` reverse-applied.

**Final verdict: merge.** All four required changes are in and hold up. Two follow-ups are listed below; neither blocks.

### Required change 1: never drop a same-trace op (probe y)

| case | result | evidence |
|---|---|---|
| (y) with the new register, Express 5.2.1 | **PASS** | `probe-store-r2new`, action `graderr2new:y`: the op prints `aggregate $cmd (handler: withManualSpan (in app span loadStats))` (span `5aa9cc8682c9a980`). The raw walk from the grader's own rule gives the same string. Skeleton spans carry only `producttrace.span.skeleton: true`. |
| (y) with the new register, Express 4.21.2 | **PASS** | `probe-store-r2e4`, span `abae4de33c81aab2`, same text |
| (y) on my old-register store `probe-store-e5y` | **PASS** | span `29fb2c9a3e302592` now prints `aggregate $cmd (issuer: unknown (parent 90deb9ce07f80666 not recorded))` in the segment, the summary and the export. The first grade found it on no surface. |
| (y) with `main`'s register (`probe-store-r2old`) read by the branch's tools | **PASS** | `8cd0e61956217fa9 aggregate $cmd (issuer: unknown (parent 65886af9ffa24568 not recorded))` |
| Fixture `stats` (neutral fixture, 3 fresh runs) | **PASS** | `aggregate $cmd (handler: projectStats (in app span loadStats))`. One skeleton span, `loadStats`, per run. The background job's root span is absent (0 shipped). |
| (w) two server spans in one trace, parent dropped (`main` register) | **Not listed; disclosed in docs only** | Trace `58387d66…`: `mongodb.aggregate` `fbc3acf24cd4517a`'s parent `6896e8b7e9daeda6` (the app span) was not shipped. The trace holds two server spans, `cb0f66041d9f6f72 GET /w/outer` and `7edec74a361ac343 GET /w/inner`. The op is on no surface: a grep of `action_chain` for its span id is false. The abstention is stated in `RUN-2.md` §1 and in the G4 amendment ("cannot be placed and is not listed (abstain)"), but no MCP, export or viewer sentence tells the reader an op was withheld. This is reachable only with a backend that does not ship parents: an older store, or another exporter. Tracer's own register now ships the skeleton, and then the case resolves (next row). Follow-up F1. |
| (w) with the new register | Listed, with a presentation gap | Both ops are under the outer request: `find users (handler: outerCalls)` and `aggregate $cmd (handler: innerStats (in app span innerSpan))`. The skeleton client span now links the nested `GET /w/inner` server span into the outer server span's subtree, which follows the rule. However, the summary reads `server innerStats,outerCalls`, and the label `Completed 200: aggregate $cmd` names the nested request's op. Neither says that a second incoming request (`GET /w/inner`) ran. `responded_by` abstains because there are two writers, `ef2fd9579e01aa32` and `90adee08bac96eb5`. Follow-up F2. |

Store totals: fixture-run-2 banked and fresh stores, 30/30 ops, 0 mismatches. Probes r2new, r2e4 and r2old, 25/25 each (r2old: 24 placed plus 1 unplaced as above). final7: 507/507, 0 mismatches, 0 DB spans left unlisted in a request trace.

### Required change 2: the owner's ruling (middleware and param reads are preconditions)

- **`action:mud8t36a:19`**
  - main: `Responded 200: no effect evidence; also …`
  - branch: `Responded 200: no database work after the preconditions (find users ×2 by middleware requireJwtAuth, find logs ×4 by middleware checkBan); also completed 200 GET /api/agents/categories, … completed 304 GET /api/models`
  - `stopped_at: handler` on both; `because` is the preconditions sentence. It never says "terminal effect observed".
- **`action:mud8u6q1:35`**
  - main: `Responded 304: no effect evidence; also completed 304 GET /api/projects`
  - branch: `Responded 304: no database work after the preconditions (find logs ×4 by middleware checkBan, find users by middleware requireJwtAuth); also completed 304 GET /api/projects`
  - `stopped_at: handler`.
- **`action:mud8rf23:6`**: the label is byte-identical to `main`, with all six `also responded 200 GET …` entries restored. `because` gains `(handler: loginController)`.
- **The eleven sentence-only changes** are `:9 :3 :4 :11 :16 :17 :29 :30 :34 :38` and the `because` of `:6`. Each differs from `main` only by the added issuer suffix, and names the same operation. That is 13 changed actions in total, matching RUN-2. The totals are unchanged: 507 ops against 278 on `main`, +229, −0.
- **Fixture:**
  - `whoami` (GET, auth read only): `Responded 200: no database work after the preconditions (find users by middleware authenticate)`, stopped at handler.
  - `owner` (route-level `requireOwner` read): `Completed 200: find users`.
  - `ping` (POST, preconditions only): `Responded 200: no write observed`, with the preconditions frontier.
  - Middleware write (`summary`): still `Completed 200: insert activity (middleware: recordActivity)`.
  - Error-middleware read (`explode`): still counted.
- **Synthetic case, no handler span:** the MCP stops at `route`, while the export's per-request frontier says `server` with the same sentence. The G4 amendment states this wording difference, so it is not a defect.
- **Consequence of the ruling, as ruled:** route-level middleware counts as handler work. final7 `GET /api/models` stays `Completed 304: find users` on `find users (handler: requireJwtAuth)`, as it was on `main`. `GET /api/admin/roles` has a `find users (issuer: unknown)` op, and unknown counts as work, as RUN-2 says. Both follow the ruling and are not regressions.
- **G6:** `g6-compare` at this head is byte-identical to `main`'s output and to my round-1 output, apart from the rendered store path. There are 0 DB spans. `g6-grader` PASS 6/6.

### Required change 3: tripwire

- `node --test test/backend-register.test.mjs` passes 4/4 with no skips: esm-app, cjs-app, Express 4 via the `express4` alias (4.22.3), and the no-register case. Each app asserts an `express.type: middleware` span named `authenticate`, parented to the server span, with the `users` read as its child. The Express 4 case also asserts `expressInit`.
- **Trips on the old wrapping:** with `c9511e73` reverse-applied (shimmer `_wrap` of `use` / `param`) in `grader-scratch/revert-tree`, the Express 4 test fails with `no middleware span for authenticate`, and 3 pass. Express 5 still passes under the old wrapping, which matches the bug being 4.x-only.
- **Caveat:** the Express 4 test skips, visibly counted, when `express4` is not installed or Mongo is down.

### Required change 4: "one builder", restated

The G4 amendment and RUN-2 §4 now say precisely what is shared. `requestSegmentCore` supplies ops, issuers, `responded_by` and `deferred` for the MCP, viewer and export. Labels come from `actionOutcome`. The export keeps its own `stopped_at` / `because` wording. Checked:
- Export `requests[].db_ops` against MCP segment ops, by span id and `issued_by`: 0 diffs across fixture store 1 (12 requests), r2new, r2old (16 each) and final7 (68).
- `stopped_at` agrees everywhere except the stated wordings: final7 `/health` `because`, which predates this branch, and `server` against `route` on a request with no handler span.

The restatement is precise.

### Suites (grader-run at 0cc3e233)

| suite | result |
|---|---|
| driver `middleware-reads.mjs --runs 3` | 343/343, stable across runs |
| fixture-run-2 sha256 | matches RUN-2 |
| `npm test` | 707 tests, 706 pass, 1 fail (`react-context-ref-semantics` only), 0 skipped |
| G4 grader on final7 | 81 PASS, 0 FAIL |
| outcome-labels | 160/160 |
| mcp-gaps | 35/35 |
| D12 | pass, 23/23 checks true |
| continuations-neutral | ok |
| g6-compare + g6-grader | byte-identical to main; 6/6 |
| `npm run build`; `diff -r src dist` | identical; tree clean |

### Follow-ups (not blocking)

- **F1.** When a same-trace op cannot be placed, because the trace holds two server spans and the parent is missing, say so on the surfaces. For example, add to each server span's segment: `1 database span in this trace could not be placed (parent <id> not recorded; 2 server spans)`. Today it is withheld silently everywhere except the gate doc.
- **F2.** Nested incoming requests, now linked through skeleton client spans: the issuer walk and the summary should name the nested server span, e.g. `handler: innerStats (in request GET /w/inner)`. The headline should not name a nested request's op as the outer request's effect without saying so. `responded_by` abstains on every such request.
- **Residuals the author states in RUN-2.**
  - Skeleton POST volume is unmeasured.
  - The skeleton carries the app's span name. It carries no attributes, but a name is app-chosen text.
  - Server traces that start in another process are not learnt.
