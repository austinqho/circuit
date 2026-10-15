# Run: `fix/server-outbound` (2026-09-24)

Claim (one PR, one claim): **a server-to-server request made while handling a traced request is a child of that trace, and its receiving side joins it, so a chain follows every hop or states where it lost one.**

Branch `fix/server-outbound`, based on `main` at `f9a925d7`. Gate text: `docs/gates/G4-mcp.md` §3.4, amendment "2026-09-24, `fix/server-outbound`". This directory is new and immutable once committed; follow-ups go in `RUN-2.md`. Written by the implementer: it is not a grade.

The defect, stated generically: a handler called another route of the same server with Node's global `fetch`. The outbound call was not instrumented, so the receiving handler started a new root trace. The chain claimed "terminal effect observed", and the second hop surfaced only as unlinked under a later, unrelated action. The `control` run below reproduces this.

## Rules as implemented

1. **Capture (`backend/register.js`, `backend/index.js`).**
   - Default adapters are `http,undici,express,mongodb`.
   - Client spans of `@opentelemetry/instrumentation-http` (the client side of `http`/`https`: `http.request`, `http.get`, and libraries built on them, such as axios' Node adapter) and of `@opentelemetry/instrumentation-undici` (the global `fetch`) are now shipped. Before this branch the `relevant` filter dropped every client span. Each is a child of the active handler span and injects `traceparent`.
   - The span delivery request runs under the SDK's suppress-tracing context key, so it produces no client span and sends no traceparent. The key is `createContextKey('OpenTelemetry SDK Context Key SUPPRESS_TRACING')`, which is a `Symbol.for`, so no `@opentelemetry/core` import is needed.
   - **Node range.** The `undici` adapter is enabled on Node >= 20.6 or 18.19, the instrumentation's own engine range: before those versions diagnostics-channel subscriptions are lost to a ref-counting bug. On an older Node, or when `PRODUCTTRACE_BACKEND_ADAPTERS` omits `undici`:
     - the process prints exactly one warning, and the log line reads `outbound: http`;
     - every server span carries `producttrace.capture_limit.feature: "outbound_fetch"` with the reason. Limits are joined into the same two attributes, so `esm_instrumentation,outbound_fetch` appears when both apply;
     - `http.request` and `https.request` are still captured.
   - **Found and fixed while building the fixture.** With both the require hook and the ESM loader hook active, `node:http` was patched twice. One `http.get` in an ESM app then produced two nested client spans. `ProductTraceHttpInstrumentation` now wraps a module object's `request`/`get` once from the original, whichever hook runs first. After the fix, wrap depth is 1 for `default`, the namespace, CJS, and `https`.
2. **Ownership and join (`analysis/runtime-attribution.mjs`).**
   - A server span owns the handler and database spans whose nearest server ancestor it is. On stores without shipped client spans, which is every store before this branch, this rule equals the old "descends from" rule.
   - `serverHops(server, spans)`: every outbound client span the server owns is a hop, ordered by start time, depth-first, with dotted paths. Each hop joins the one server span whose `parent_span_id` is that client span's id, in the same trace, with the same method. Other outcomes of the join:
     - otherwise `no_incoming_span`;
     - `multiple_exact_parent_servers` (abstained);
     - `method_mismatch`.

     Nothing is joined by URL or time.
   - `attachBackendSpans` writes `server.hop` rows. It also writes each joined hop's DB spans as `db.operation` rows of the request, marked with `hop` and `hop_span_id`.
   - The headline effect prefers the request's own DB step. When the step comes from a hop, the hop is named, for example `insert chain_ends (hop 1.1.1.1.1: POST /api/chain/0)`.
3. **One hop builder (`hopSegments` in `analysis/causal-chain.mjs`).** It is used by:
   - MCP request segments: `hops`, `escaped_hops`, `hops_text`, `additional_stops`;
   - `action_chain.stops` (`stop: "outbound"`);
   - the episode chain (`chain.hops`, `escaped_hops`, `hops_text`), which the live viewer (`fiber-demo.js`) prints as facts;
   - exported `producttrace.action-chain.v1` rows (`requests[].hops`, `escaped_hops`, `additional_stops`);
   - described server spans (unlinked listings, `page_requests`).

   Inline rendering stops at depth 3 or 6 lines, then prints `+N more hops (M deeper than 3) (see hops)`. The JSON lists every hop.
4. **Frontiers.** Each escaped hop becomes an additional frontier stop (`reached: "outbound"`, `stopped_at: "network"`, `stop_reason: "outbound_<join>"`). It is printed as `; also stopped at network because <hop sentence>`, whatever the headline is. `escaped_hops` on each segment is the list the coverage claim reads.
5. **Unlinked.** A hop's receiving server span is never listed as unlinked or under `server_spans_without_request`. An unlinked root server span carries its own hops. An incoming root span with no browser parent stays unlinked and is never joined by time; the `control` run shows this.

Spans keep `producttrace.backend-span.v1` unchanged. Every other change is additive: row kind `server.hop`, fields `hop*` on `db.operation`, and fields on segments, chains and stops.

## Commands and counts (Node v26.7.0, macOS; Mongo `producttrace-librechat-mongo` at 127.0.0.1:27017)

```sh
node test/browser/server-outbound.mjs --runs 3 --control --out docs/evidence/pr-server-outbound-2026-09-24/fixture
    # 125/125 checks pass (fixture/checks.json); 3 runs with the same normalized MCP signature (S1)
npm test                                  # tests 707, pass 706, fail 1 (known: react-context-ref-semantics). Base f9a925d7: 700 tests; +3 register, +4 server-hops
node --test test/backend-register.test.mjs test/backend-adapter.test.mjs test/server-hops.test.mjs   # 14/14 on v26.7.0
docker run --rm -v /Users/austinho/dev:/Users/austinho/dev -w <worktree> -e PRODUCTTRACE_TEST_MONGO_HOST=host.docker.internal node:20-alpine \
  node --test test/backend-register.test.mjs test/backend-adapter.test.mjs test/server-hops.test.mjs     # 14/14 on v20.20.2
node test/g4-grader.mjs docs/evidence/m1-2026-09-22-final7 --manifest docs/evidence/g4-mcp-2026-09-23/manifest.json --out <scratch>   # Result: 81/81
# G6: gunzip docs/evidence/g6-anything-llm-2026-09-23/store into <g6store>, then
node test/browser/g6-compare.mjs --store <g6store> --out <g6out> --pair A-baseline:B-seeded-422 --pair B-seeded-422:C-fix-r2 \
  --pair A-baseline:C-fix-r2 --pair A-baseline:D-noop-refactor --pair A-baseline:E-frontend-early-return --pair B-seeded-422:C-fix
node test/g6-grader.mjs <g6store> --compare <g6out> --out <g6out>/GRADE.md   # Overall: PASS (6/6 pairs)
node test/browser/d12-stamp-neutrality.mjs      # 23/23 checks true, exit 0
node test/browser/continuations-neutral.mjs     # status ok, 5 runs, exit 0
node test/browser/outcome-labels.mjs            # 160/160
node test/browser/mcp-gaps.mjs                  # 35/35
node test/browser/body-capture.mjs              # 51/51
node test/browser/episode-focus.mjs             # status ok
node test/browser/no-cross-control-neutral.mjs  # status ok
node test/browser/unlinked-coverage-neutral.mjs # 12/13: A8 fails exactly as on main (worker transport now wrapped; pre-existing, noted in pr-outcome-labels RUN.md)
```

G6 cross-check: I regenerated the compare with the `main` checkout (`f9a925d7`) from the same store. `compare/index.json` is byte-identical to this branch's. The per-pair JSON files differ only by the added `hops: []`, `escaped_hops: []` and `hops_text: null` on segments; I checked every differing line.

## The fixture and what it proves

Files:
- `test/browser/fixtures/server-outbound-app/server.js`: CommonJS Express + MongoDB, database `producttrace_test_outbound`, dropped on SIGTERM. R10 checks the drop after each run.
- `peer.js`: a second Express process.
- `main.jsx`: a wouter page. A `<Link>` route change opens the project page; the buttons' handlers call:
  - **plain:** `GET /api/projects/:id`, one read, no outbound call;
  - **(a)** `archiveProject`: global `fetch` to its own `/internal/notify`;
  - **(b)** `syncProject`: `http.request` (axios-style options object) to the peer's `/peer/relay`, which calls back into the first server's `/internal/ping/:id` with `fetch` (a nested hop);
  - **(c)** `sendWebhook`: `fetch` to a host that answers but is not instrumented (a plain server in the driver), then `http.request` to a closed port;
  - **(d)** `overview`: `Promise.all` of `fetch /internal/stats/:id` and real axios 1.x (Node http adapter, resolved from the dependency root) to the peer's `/peer/stats/:id`;
  - **(e)** `chainStep`: recursion through `fetch` five deep.

Driver `test/browser/server-outbound.mjs`: both backends run under `node --import producttrace/backend/register`. Expectations are recomputed from raw `records.jsonl` / `spans.jsonl` (trace ids and parent span ids; the driver imports no package code for them). The MCP is driven over stdio.

Rendered (`fixture/run-1/mcp.json`, `action_chain` first line, handler names as `<unnamed>` because no `--source-root` was given):

```
… (1) POST /api/projects/p1/archive → route /api/projects/:id/archive 200 → server archiveProject → db update projects → outbound POST /internal/notify (from handler archiveProject) → server /internal/notify 201 → handler notify → db insert notifications [completed 200] …
… (1) POST /api/projects/p1/sync → … → server syncProject → hop 1: outbound POST /peer/relay (from handler syncProject) → server outbound-peer /peer/relay 200 → handler relay; hop 1.1: outbound GET /internal/ping/p1 (from handler relay) → server outbound-main /internal/ping/:id 200 → handler ping → db find projects [responded 200; no write observed] …
… (1) POST /api/projects/p1/webhook → … → db insert webhook_attempts → hop 1: outbound POST http://127.0.0.1:58008/hooks/project-archived 200 (from handler sendWebhook) → not instrumented (no incoming span for this traceparent); hop 2: outbound POST http://127.0.0.1:58009/hooks/mirror (from handler sendWebhook) → no response (connect ECONNREFUSED 127.0.0.1:58009); not instrumented or not reached (no incoming span for this traceparent) [completed 202] …: reached db / stopped at none (terminal effect observed) / because database write insert webhook_attempts joined by exact span parentage; also stopped at network because outbound POST http://127.0.0.1:58008/… → not instrumented (…); also stopped at network because outbound POST http://127.0.0.1:58009/… → no response (…)
… (1) POST /api/chain/5 → … → hop 1: outbound POST /api/chain/4 …; hop 1.1: …; hop 1.1.1: outbound POST /api/chain/2 (from handler chainStep) → server /api/chain/:depth 200 → handler chainStep; +2 more hops (2 deeper than 3) (see hops) [completed 200] … because database write insert chain_ends (hop 1.1.1.1.1: POST /api/chain/0) joined by exact span parentage
```

**Control (the defect).** In `fixture/control`, both processes run with `PRODUCTTRACE_BACKEND_ADAPTERS=http,express,mongodb`, which leaves the fetch adapter off:
- the archive request has no outbound span;
- `/internal/notify` is a root server span in another trace (C1);
- server spans carry `outbound_fetch` (C2);
- `action_chain` renders `… → server archiveProject → db update projects [completed 200] …: reached db / stopped at none (terminal effect observed)` with no hop, and the notify span appears only in `page_requests.server_spans_without_request` (C3).

With the branch's defaults, the same click renders the hop, and M11 checks that no receiving span is listed as unlinked.

**Fan-out order.** Hops are ordered by client span start. In all three runs the `fetch` leg started before the axios leg. The order is the runtime's, so S1 compares the fan-out hops as a set; R7 and M9 check the order against the raw start times in each run.

Raw files per run are in `fixture/{run-1,run-2,run-3,control}/`: `records.jsonl` (71 rows), `spans.jsonl` (98 rows; 89 in the control), `runs.jsonl`, `mcp.json`, `backend.log`. The build's manifest is `fixture/attribution-manifest.json`. `fixture/checks.json` lists every check.

## Node versions

- v26.7.0: everything above.
- v20.20.2 (the local `node:20-alpine` image): the register, adapter and hop tests, 14/14. These include the ESM and CJS fetch and `http.get` hops.
- Not run on a real Node < 20.6 or 18.19. The old-Node path is simulated by redefining `process.versions.node` to `20.5.1` in a pre-import. The test checks one warning, `capture_limit.feature: "outbound_fetch"`, no undici span, and a receiving span that is a new root. The browser fixture ran only on v26.7.

## Residual risks

1. **More spans shipped.** Every outbound HTTP call a handler makes is now a client span, for example LLM APIs or telemetry SDKs that use `http`. Each is posted individually, un-batched. On an app with chatty outbound traffic, span volume and the listed escaped hops grow; the escaped hops are honest but noisy.
2. **Outbound URLs are recorded as the instrumentations report them** (`url.full` / `http.url`), query strings included. This matches browser requests, where query strings are recorded. Credentials in the query are not redacted by Tracer.
3. **Coverage is not changed here.** `escaped_hops` feeds the honesty claim's `coverage.complete: false`; that is the other branch's job. On this branch an escaped hop is an additional stop and a listed field, not a coverage change.
4. **The G4 grader's handler/DB rule is "descends from the server span".** It equals the new nearest-server rule on final7, and 81/81 is unchanged. A grader for a store with hops must stop at the nearest server ancestor; `server-outbound.mjs` does.
5. **The http double-wrap fix relies on OTel internals.** It uses `isWrapped` and `__original`, and on the ESM proxy the property is defined the same way the base class's `_wrap` does it. An OTel upgrade could change this. The register test (`http.get` gives exactly one client span, on ESM and CJS) would catch it.
6. **Hops that are not first-party HTTP are not followed**: message queues, gRPC, database-triggered work, `net` sockets. Only `http`/`https` clients and undici/global `fetch` are captured. An app that bundles its own undici copy is covered only if that copy publishes the same diagnostics channels.
7. **Window.** A hop whose receiving span has not arrived yet (in a live, non-idle session) is listed as escaped until it arrives. In stored sessions this cannot happen.
8. **Handler names in this run's text are `<unnamed> file@span`.** The driver does not pass `--source-root` (see `mcp-gaps.mjs` for that technique). This does not affect hop joins.
