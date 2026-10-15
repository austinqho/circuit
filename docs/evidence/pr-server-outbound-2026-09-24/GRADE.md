# Grade: `fix/server-outbound` (2026-09-24)

Grader: independent (did not write the branch). Head graded: `15ecd7b6` (6 commits on `main` `f9a925d7`). Node v26.7.0 on macOS; Node v20.20.2 in `node:20-alpine`; Mongo `producttrace-librechat-mongo` at 127.0.0.1:27017.

Claim: *a server-to-server request made while handling a traced request is a child of that trace, and its receiving side joins it, so a chain follows every hop or states where it lost one.*

**Verdict: `merge with changes`** (two required changes, listed at the end). The join is correct. I recomputed it from raw spans on 3 fixture runs and on my own probe run, and could not make it cross-join. Two problems remain:
- The headline sentence still reads `stopped at none (terminal effect observed)` when hops escaped.
- An app-set `traceparent` is overwritten (http client) or duplicated (fetch). In the duplicated case Tracer breaks the join, then blames the receiver: "not instrumented".

My probe sources and outputs are in `grader-scratch/` in the worktree. They are uncommitted, not part of the branch.

## Per-rule table

| # | Rule | Verdict | Raw evidence |
|---|---|---|---|
| 1 | Default adapters include undici (global fetch) and the http/https client | PASS | `backend/register.js:38` `['http','undici','express','mongodb']`; backend log in every run: `outbound: http+fetch`. Probe store: 33 outbound client spans (19 undici, 14 http). |
| 2 | Outbound spans are children of the handler span and inject traceparent | PASS | `grader-scratch/raw-hops.mjs` (no package code) over `fixture/run-{1,2,3}/spans.jsonl`: 12/12 outbound spans per run have a `producttrace-express-handlers` span as parent. Run-1 example: client `8aa48518f572e4d7` (undici, POST /internal/notify), parent `c1ba35254e8efc61` (handler archiveProject), nearest server `47fae7c222e4fbdf`. Probe run: 33/33 parents are handler spans. |
| 3 | Receiving server span joins as a child: same trace id, parent = outbound span; never by URL or time | PASS | Run-1 `8aa48518f572e4d7` → server `2bb2d186b19598f9` (parent = client id, trace `d270b980…` shared). Across 3 runs every receiver has `parent_span_id` = client id and the same trace. Join code `analysis/runtime-attribution.mjs:678-680`: `parent_span_id === span.span_id`, then method equality. The only time use is start-order sorting (`:669-670`); the only URL use is display (`outboundUrl`, `:633`). Synthetic decoys (`grader-scratch/synthetic-joins.mjs`) are not joined: a same-URL/same-time root server span, and a correct parent id in another trace. Two claimants give `multiple_exact_parent_servers`; a method mismatch gives `method_mismatch`. |
| 4 | Hops render through one builder on every surface | PASS | The `hopSegments` output (`analysis/causal-chain.mjs:279`) is identical on MCP segments and on exported `buildActionChains` requests: `hops_text` SAME on 11/11 probe actions (`grader-scratch/export-surface.mjs`); escaped counts and outbound additional stops also equal. The viewer (`test/browser/fiber-demo.js`) and `describeServerSpan` also go through `hopSegments`. |
| 5 | A hop with no receiving span is in `escaped_hops` and is a stated frontier | PASS (wording caveat, see R2) | Probe `x`: DNS failure `7eaef7e1701d4465` and closed port `92e6ca7d27190208` read `no response (…ENOTFOUND…/ECONNREFUSED…); not instrumented or not reached (no incoming span for this traceparent)`. The answering uninstrumented host `39f231d49ecfe5e7` reads `not instrumented (no incoming span for this traceparent)`. Each has `additional_stops` `outbound_no_incoming_span`. |
| 6 | `escaped_hops` only when an outbound span has no receiving span | PASS | No joined hop is escaped in probes a, b, c, d, e, g, h, z, or in the fixture. The only escapes are real no-receiver spans (x ×3, y, g's https to a closed port, f's fetch leg). |
| 7 | Parallel calls are sibling hops, callbacks nested | PASS | Probe `a`: two parallel fetches are hops 3 and 4, siblings. Fixture fan-out: siblings 1 and 2. Peer callback: `1.1` (run-1 `92dccf31da5c7a10` → peer `bf3a9af07f6f8c80` → `5b1fccd123beab0c` → `287fc2c5c23a7557`). Caveat: span start has ms resolution. Probe a's parallel pair both start at `…495160.0`, so hop 3 vs 4 falls back to store order. The join is unaffected. |
| 8 | Depth cap and "+N more" | PASS | Probe `d` (8 deep): 3 lines, then `+5 more hops (5 deeper than 3) (see hops)`; JSON `hops` lists all 8 (`1` … `1.1.1.1.1.1.1.1`). The headline names `insert deep_ends (hop 1.1.1.1.1.1.1.1: POST /api/d/deep/0)`. |
| 9 | Older Node: one warning plus a capture-limit attribute | PASS (simulated only, disclosed) | The `<20.6` path is only simulated: `process.versions.node` is redefined to `20.5.1` in a `data:` pre-import (`test/backend-register.test.mjs`, last test). RUN.md discloses this ("Not run on a real Node < 20.6 or 18.19"). I reran the register, adapter and hop tests on v20.20.2 in `node:20-alpine`: 14/14, 0 skipped (the Mongo-backed tests ran through `host.docker.internal`). The control run shows `capture_limit.feature=outbound_fetch` (C2). |
| 10 | Tracer's own span delivery creates no spans | PASS | `send()` runs under `context.with(…SUPPRESS_TRACING…)` (`backend/register.js:137,147`). Zero client spans to `/spans` in all 4 fixture stores and in the probe store (211 spans). |
| 11 | Exactly one client span per `http.get` in ESM (double-wrap fix) | PASS | Probe `g` (ESM app) makes 5 calls: `import http from 'http'` (bare), `import * as` namespace, named `get`, named `request`, and `https.get`. Result: exactly 5 client spans (`b97d4e86…`, `9dde731a…`, `852143d1…`, `ca4bc107…`, `e5236a96…`), none nested. |
| 12 | Root span with no browser parent stays unlinked | PASS | Probe `GET /api/root/direct` (no traceparent): span `683583cd2bc3e5bd` is listed under `page_requests.server_spans_without_request` and joined to nothing. No hop receiver is listed there. |
| 13 | Headline never says "terminal effect observed" for a request with an escaped hop | **FAIL** | Probe `x` headline: `reached db / stopped at none (terminal effect observed) / because database write insert escape_attempts …; also stopped at network because …` ×3. The structured fields say `stopped_at: null`. The fixture's webhook request (RUN.md) says the same. See R1. |
| 14 | Schema additive | PASS | `producttrace.backend-span.v1` is unchanged. New additive fields: row kind `server.hop`, `hop*` on `db.operation`, and fields on segments, stops and chains. G6 compare `index.json` is byte-identical to main; the pair files differ only by empty hop fields (below). |

## Probe results (my probes; `grader-scratch/probe-app/`, driver `grader-scratch/probe-driver.mjs`)

Setup:
- The frontend is an SWR page (`swr/mutation` `useSWRMutation`). No existing fixture uses SWR.
- The backend is an ESM Express + MongoDB app.
- The peer is a plain `node:http` server with Mongo, not Express.
- Both processes run under `node --import producttrace/backend/register`.
- The MCP was driven over stdio as a black box.
- Outputs: `grader-scratch/probe-out/{records,spans}.jsonl`, `mcp.json`, `responses.json`.

- **(a) Same URL twice, 200 then 500, plus a parallel pair.** No cross-join. Every hop's `client_status_code` equals its server's status:
  - `6df8aa8f` → `41cd848a` 200;
  - `f32d1821` → `bfcf59cc` 500;
  - `59ea836d` → `ecd4e96b` 500;
  - `a4b4c861` → `4a644464` 200.

  In the parallel pair, the delayed client (154.8 ms) joins the delayed server (153.4 ms). Note that the outcome still reads `Completed 200: insert flaky_hits (hop 4 …)` although two hops answered 500. That is accurate: the outer handler answered 200.
- **(b) `setTimeout` after `res.end` to the peer.** The rows claim the hop is the request's, joined by ids: client `8b840136b443f392` starts 302 ms after the owning server span ended, and `c5f933de5768d238` is its receiver. Two problems:
  1. Nothing says "after the response": `deferred: null`.
  2. The peer's `mongodb.insert` (parent = peer server span; the peer has no Express handler) is dropped, so the request reads `responded 200; no effect evidence`. No frontier is stated for the hop's missing handler.
- **(c) Deferred call into the same process.** The hop is joined (`bbee3ec6` → `2c140e07`). The outcome reads `completed 200; server work continued 355 ms after the response`, with effect `insert late_self (hop 1 …)`. The deferral is visible only because the hop's DB span is in `dbs`; the hop itself carries no deferral marker.
- **(d) 8 deep.** Passes (rule 8).
- **(e) 302 followed by fetch.** Two hops, each joined to its own receiver: `/internal/redirect` 302, then `/internal/target?from=redirect` 200. `http.get` does not follow redirects, so it gives one 302 hop. This is honest.
- **(f) App sets its own `traceparent`.**
  - `http.request`: Tracer wins silently. The receiver saw Tracer's `00-3099a415…-47e0019b…` and the app's `00-1111…` is gone.
  - `fetch`: undici's `addHeader` appends a second header, so the receiver got `traceparent: 00-1111…-2222…-01, 00-3099a415…-c4966c3b…-01` (2 raw headers). The receiving server is instrumented, but it could not parse the header. It started a new root trace (`aa2f634940dc67e5`, listed as unlinked), and the hop reads `not instrumented (no incoming span for this traceparent)`.
  - That frontier is false, and the malformation is Tracer's. Apps that already run their own OTel or Sentry fetch instrumentation plausibly hit this on every call (untested; inferred from the undici `addHeader` behavior).
- **(g) ESM double-wrap.** One span per call (rule 11).
- **(h) axios.** axios is **not** in the main checkout's `node_modules`, so the test as specified is skipped. The author's fixture resolves axios 1.19.0 from the librechat dependency root. I also ran axios 1.19.0, superagent 10.3.0, node-fetch 2.7.0 and npm `undici` 7.29.0 `request()` from that root: each produced exactly one client span, joined to its receiver.
- **Honesty extras.**
  - (y) An escape-only request reads `stopped at handler …; also stopped at network because … not instrumented`.
  - (z) A hop answered 500 while the outer handler answered 200: the hop line shows `server grader-peer /peer/fail 500`.
  - Synthetic abstention (`multiple_exact_parent_servers`, `method_mismatch`) works.

## Commands and counts

```sh
node test/browser/server-outbound.mjs --runs 3 --control --out grader-scratch/fixture     # 125/125, exit 0 (34 s)
node grader-scratch/raw-hops.mjs grader-scratch/fixture/run-N/spans.jsonl                 # 12 outbound/run, 0 bad parentage, 0 delivery spans; control: 3 (http only), notify etc. root spans
node --test test/backend-register.test.mjs test/backend-adapter.test.mjs test/server-hops.test.mjs   # 14/14 on v26.7.0
docker run --rm -v /Users/austinho/dev:/Users/austinho/dev -w <worktree> -e PRODUCTTRACE_TEST_MONGO_HOST=host.docker.internal node:20-alpine \
  sh -c 'node -v; node --test test/backend-register.test.mjs test/backend-adapter.test.mjs test/server-hops.test.mjs'   # v20.20.2, 14/14, 0 skipped
node grader-scratch/probe-driver.mjs grader-scratch/probe-out                             # 11 clicks, 0 page errors, backend exit 0, 211 spans
node grader-scratch/synthetic-joins.mjs; node grader-scratch/export-surface.mjs grader-scratch/probe-out   # 11/11 SAME
npm test                                        # 707 tests, 706 pass, 1 fail (react-context-ref-semantics, known)
node test/browser/d12-stamp-neutrality.mjs      # 23/23 true
node test/browser/continuations-neutral.mjs     # status ok
node test/browser/outcome-labels.mjs            # 160/160
node test/browser/mcp-gaps.mjs                  # 35/35
node test/browser/body-capture.mjs              # 51/51
node test/browser/episode-focus.mjs             # status ok
node test/browser/no-cross-control-neutral.mjs  # exit 0
node test/browser/unlinked-coverage-neutral.mjs # 12/13, A8 fails (pre-existing, documented in pr-outcome-labels RUN.md)
node test/g4-grader.mjs docs/evidence/m1-2026-09-22-final7 --manifest docs/evidence/g4-mcp-2026-09-23/manifest.json --out grader-scratch/g4/GRADE-g4.md   # 81/81
# G6: gunzip store (records, runs, spans AND manifests) into grader-scratch/g6/store; `git archive f9a925d7` into grader-scratch/g6/main-tree (the main checkout is never touched)
node test/browser/g6-compare.mjs --store <store> --out <out-branch> <6 pairs>; same from main-tree; node test/g6-grader.mjs …   # branch 6/6 PASS, main 6/6 PASS
```

G6 cross-check:
- `compare/index.json` is byte-identical between the branch and main, and so is `AGENT-READS.md`.
- Every differing line in the 6 pair files is either an added `"hops": []`, `"escaped_hops": []` or `"hops_text": null` (11 of each), or the store path, which is relativized differently because the trees live in different directories.
- A note on the command: with `manifests/*.json.gz` left compressed, both main and the branch grade 4/6 (remap basis `content_hash`). The store must be fully gunzipped.

`git diff f9a925d7...HEAD -- src dist` is empty, so src/dist are unchanged.

## Volume and privacy (what a developer might not expect)

- **Every outbound HTTP call a handler makes is now a shipped span**: LLM APIs, payment providers, analytics and telemetry SDKs. Outbound calls outside any request (startup, cron, SDK flushes) are shipped too, as root client spans. Each span is one un-batched HTTP POST to the collector (`SimpleSpanProcessor`).
- **Query strings are stored and re-printed verbatim.** Probe `x` sent `?token=SECRET123&user=alice@example.com`. The secret appears in `url.full` and `url.query` in `spans.jsonl`, and **26 times in the MCP output** (segment summaries, `hops_text`, `escaped_hops`, frontier sentences). APIs that take keys in the query (for example `?key=`) will have those keys in the store and in agent-facing text.
- **Tracer now changes outbound wire traffic.** Every outbound request, including to third parties, carries a `traceparent` that exposes Tracer trace ids to them. An app-set `traceparent` is replaced (http) or duplicated into an unparseable pair (fetch); see probe (f).
- The http instrumentation (0.207.0) and the undici instrumentation (0.19.0) both declare `node: ^18.19.0 || >=20.6.0`, but `package.json` says `>=18`. Only undici is gated.

## Residual risks

1. **Deferred hops are not marked.** Timer-issued hops after the response join the request (correct by identity), but carry no `after_response_ms`, and `deferred` stays null unless a DB span shows up (probe b vs c).
2. **Hop receivers without an Express handler span** (plain `node:http`; likely also Fastify, Koa, Next API routes) lose their DB spans from the hop, and no frontier says so (probe b: the peer's `mongodb.insert` is present in spans but not rendered).
3. **The "not instrumented" wording asserts a cause Tracer does not know.** The same text covers a receiver that is instrumented but ships to another collector, one not yet delivered, or one that rejected a malformed traceparent (probe f).
4. **Parallel hops that start in the same millisecond** are ordered by store order (probe a).
5. **The double-wrap fix depends on OTel internals** (`isWrapped`, `__original`); the author discloses this, and the register test pins it.
6. **No real Node < 20.6 was run** (disclosed).
7. **Cosmetic:** `test/fixtures/backend/esm-app/server.js` has its indentation mangled around the inserted route (harmless).

## Required changes (merge with changes)

1. **R1 — Headline with escaped hops.** When a request or chain has escaped hops, the headline must not read `stopped at none (terminal effect observed)`, and `stopped_at` must not be null with no qualifier. `mcp/tools.mjs:780` renders it from `baseFrontier`, and the additional stops are merely appended.
   - Say, for example, `stopped at network (N outbound hops not followed); terminal effect observed: …`, or set the headline stop to the escaped frontier.
   - Do this on this branch. It is text this branch now produces for hops, independent of the other branch's `coverage.complete`.
   - Pin it with a check on the fixture's webhook request and on an escape-plus-own-write request.
2. **R2 — App-set `traceparent`.** This must be a generic rule, not app-specific:
   - When the outgoing request already carries a `traceparent` header, Tracer must not inject a second one (undici `addHeader` today) and must not overwrite it (http today). The app's header wins, and the wire is unchanged.
   - The client span still ships, marked (for example `producttrace.outbound.traceparent: "app_set"`), and the hop's frontier states that reason instead of `not instrumented`.
   - Add a probe that reproduces (f) for both clients and asserts: one `traceparent` on the wire, equal to the app's value; the hop escaped with the stated reason; the receiver not blamed.
   - Also soften the generic `no_incoming_span` wording so it does not assert "not instrumented" as a fact, for example: `no incoming span for this traceparent (receiver not instrumented, not reporting to this store, or did not accept it)`.

Recommended, not blocking: mark hops whose client span starts after the owning server span ended (`after_response_ms`, feeding `deferred`); state a frontier for a hop's server span that has no handler span; offer opt-in query-string redaction for outbound URLs, and disclose the current behavior in the README next to the adapter list.

---

# Regrade at 94af88e6

Grader: the same independent grader. The head is `94af88e6`, six fix commits on top of `afb9f043`. I read `RUN-2.md` and `fixture-2/` but did not rely on them: my fixture outputs are in `grader-scratch/fixture-r2/`, and my probes in `grader-scratch/probe-out-r2/`, `grader-scratch/second-sdk/` and `grader-scratch/proxy-harness.mjs` (all uncommitted). Node v26.7.0 unless stated.

**Final verdict: `merge with changes`.** R1 and R2 as specified are done and hold. The four recommended items are done. But R2's rule ("the app's header wins") introduces a **regression against `main`**:
- **Where:** an `http` client that forwards the incoming `traceparent`. That is the proxy pattern: `http-proxy-middleware`, `express-http-proxy`, or `{ headers: req.headers }`.
- **Result:** the browser request's own join now abstains, and the request loses its whole backend chain.

This is one required code change, plus one documentation change (below).

## (1) Headline with escaped hops: PASS

- **Rows (fixture, 3 runs).** In `fixture-r2/run-1/spans.jsonl`, recomputed with `raw-hops.mjs` (ids only), the webhook request's outbound spans `a9379d50b1061dde` (undici, answered 200) and `6b3e59b9c2f2aff1` (http, ECONNREFUSED) have no server span with them as parent. Every other hop of the fixture's chains has one; the `forwardTraced` hops join by the app's value.
- **MCP.** The webhook chain reads:

  ```
  [outcome completed 202; a further server-side hop may have escaped]: reached db / stopped at server_hop / because reached db (database write insert webhook_attempts joined by exact span parentage); a further server-side hop may have escaped: 2 outbound call(s) have no receiving span (POST http://…/hooks/project-archived, POST http://…/hooks/mirror); also stopped at network because …
  ```

  "Terminal effect observed" appears only on plain, fetch_self, http_peer_nested, fan_out, chain_depth and after_response, whose hops were all followed (M8b). The fixture passes 154/154 with 0 failed, and S1 is stable over 3 runs.
- **My probe, write plus 3 escapes.** MCP gives `stopped_at: "server_hop"`, outcome label `Completed 200: insert escape_attempts; a further server-side hop may have escaped`, and the headline names all 3 calls.
- **Probe, escape only (y).** It keeps `stopped at handler`, and the escape is an additional stop.
- **Export.** `buildActionChains` (`grader-scratch/export-r2.mjs`) sets `stopped_at: "server_hop"` on webhook and forward in all 3 runs and on probe x. It leaves `null` on every fully followed chain.
- **Minor wording.** The clause always says "N outbound call(s) have no receiving span". For a `multiple_exact_parent_servers` hop this is inaccurate, because it has several receiving spans. That abstention is stated correctly in the hop's own line.

## (2) App-set traceparent

| Probe | Result |
|---|---|
| `http.request` with the app's header (my probe f) | **PASS on the wire.** The receiver got exactly the app's `00-1111…-2222…-01`, `raw 1`. The span `2dbd93645b0d6e05` is marked `traceparent_set_by_app` with `app_traceparent`. |
| `fetch` with the app's header (probe f) | **PASS on the wire.** One header, the app's value, `raw 1` (at 15ecd7b6 it was 2). The span `438bb9ee2836e723` is marked. |
| Join for f | My probe reuses **one** app value for both calls, so both receivers (`a853ecfe2f1ec2bc`, `50f052026d263576`) have parent `2222222222222222`. Both hops are `multiple_exact_parent_servers`, abstained. This is honest and does not guess. With distinct values, the fixture's M12 shows `app_traceparent` joins and the "traceparent set by the app; receiving span not linked by Tracer" sentence for the uninstrumented host. I checked R11 and R12 in `fixture-r2/checks.json`: they pass. |
| axios following a redirect (follow-redirects re-sends the options headers) | **PASS.** Tracer's own injected value is recognized and replaced. The second request carries a fresh Tracer value, is not marked as app-set, and both hops are `exact_parent` (`5955956e9e78a7f4`, `1105af40a0495fd9`). |
| `req.setHeader('traceparent', …)` after `http.request()` returned (f2) | **Confirmed as the author says.** The wire carries the app's value `00-3333…-4444…-01`; Tracer's is overwritten. The span `20d0c4958d36643d` is **not** marked. The receiver `e349a10dddc8826f` (parent `4444444444444444`) is listed as an unlinked root. The hop reads `no incoming span for this traceparent (not instrumented, or not reached)`, which is false: the receiver was instrumented and reached. The case is disclosed only in `RUN-2.md` residual 1, not in the README or G4. |
| A second OpenTelemetry SDK in the app (`@opentelemetry/sdk-node` 0.221 NodeSDK with its own http and undici instrumentations; `grader-scratch/second-sdk/`) | **Fails, not disclosed.** One `fetch` sent **two** `traceparent` headers (`n: 2`) and produced **two** undici client spans in Tracer's store (`2609d51bdf48dc61`, `cf24b7d3ba396777`), because the app SDK's instrumentation uses Tracer's global provider. The receiver started a new root and is listed as unlinked. The one call renders as **two** escaped hops reading `no incoming span … (not instrumented, or not reached)`, and both clauses are false. `http.get` was fine: one span, joined. RUN-2 dismisses this as "not a Tracer-controlled case", but one of the two headers and both spans are Tracer's. |
| **Proxy: the handler forwards the incoming `traceparent`** (my probe p; `grader-scratch/proxy-harness.mjs` on `main` vs the head) | **REGRESSION.** See the details below this table. |

**Proxy regression, in detail.**
- **On the head** (browser probe):
  - `GET /api/p/proxy-http` sends `http.request` with `{ headers: forward }`, where `forward` is the incoming headers without `host`.
  - The downstream received the browser's `…-67a20588f5ae786b-01`, because Tracer left the app's forwarded value alone.
  - Two server spans now have the browser span as parent: `030f09af106bd145` (proxy) and `69cac62d446c8f5e` (downstream).
  - The browser request's join is `multiple_exact_parent_servers`, and the chain reads `GET /api/p/proxy-http → no server span (multiple_exact_parent_servers) … stopped at network`.
  - Both server spans are also dropped from `server_spans_without_request`, because they match the forwarding span's app value. The proxy handler, its route and the downstream's `insert proxied` appear nowhere.
- **On `main` `f9a925d7`** (same backend, harness): the http instrumentation replaced the forwarded value (the downstream got `…-a4562203ae546585-01`), and exactly 1 server span claims the browser span, so the chain joins.
- **The `fetch` variant** abstains on both `main` and the head. It is no worse than main, but R2 did not fix it either.

## (3) Recommended items

- **After-response hops: PASS.**
  - Probe b (peer, `setTimeout` 300 ms after `res.json`): `(from handler deferredPeer; sent 301.2 ms after the response)`, plus the segment's `server work continued 310.2 ms after the response`.
  - Probe c (same process): `sent 301.8 ms after the response`.
  - Fixture M13 recomputes the value from raw start and end times.
- **Non-Express receivers keep their DB ops: PASS.** Probe b's plain `node:http` peer: `server grader-peer /peer/late-write 201 → db insert peer_late (no handler span; issuer unknown)`, and the effect `insert peer_late (hop 1 …)`. This is the fixture-level case the author covered by unit test only.
- **Engines: PASS.** `package.json` `engines.node` is `^18.19.0 || >=20.6.0`, matching both instrumentations. The lockfile changes only the root entry.
- **Docs: PASS, with the gaps below.** The README states the third-party `traceparent` and the query strings. It does not state the two known cases where an app-set header is still mishandled (setHeader after creation; a second SDK), nor the forwarding case.

## (4) Suite at 94af88e6

```text
node test/browser/server-outbound.mjs --runs 3 --control --out grader-scratch/fixture-r2   # 154/154, exit 0
node --test test/backend-register.test.mjs test/backend-adapter.test.mjs test/server-hops.test.mjs   # v26.7.0 17/17, 0 skipped
docker … node:20-alpine … same three files                                                  # v20.20.2 17/17, 0 skipped
npm test                                   # 710 tests, 708 pass, 2 fail:
                                           #   react-context-ref-semantics (known)
                                           #   "packed Node analysis API … isolated consumer": npm ENOTCACHED @jridgewell/sourcemap-codec
                                           #   (offline npm cache). It fails identically on a `git archive` of main f9a925d7 run now,
                                           #   and passed in my first grade, so it is environmental, not this branch. The author's
                                           #   709/710 is plausible with a warm cache.
node test/browser/d12-stamp-neutrality.mjs      # 23/23
node test/browser/continuations-neutral.mjs     # status ok when run alone. It failed once ("/api/cross-timer ran after action B
                                                #   started") while my probe run shared the machine; that is a timing flake under load.
node test/browser/outcome-labels.mjs            # 160/160
node test/browser/mcp-gaps.mjs                  # 35/35
node test/browser/body-capture.mjs              # 51/51
node test/g4-grader.mjs … final7                # 81/81
G6 (fully gunzipped store) at 94af88e6          # 6/6 PASS; compare/index.json byte-identical to main's; AGENT-READS.md identical;
                                                # pair files differ only by the empty "hops": [] / "escaped_hops": [] / "hops_text": null (11 each) and the store path
git diff f9a925d7..94af88e6 -- src dist         # empty
```

No `producttrace_test*` database is left in Mongo.

## Required changes at 94af88e6

1. **Forwarded incoming traceparent (code, generic).** An outbound request whose `traceparent` is the value the current server span *received* is a pass-through, not the app's own context.
   - Tracer must inject its own client-span value, as `main` did for `http`, and may mark the span `producttrace.outbound.traceparent_forwarded: true`.
   - Pass-through means: same trace id, and a parent span id equal to the owning server span's `parent_span_id`.
   - Apply it to both `http` and undici, so the `fetch` proxy also stops abstaining.
   - Add probes for `http.request` with the incoming headers forwarded, and for `fetch` with `traceparent: req.headers.traceparent`. Assert that exactly one server span claims the browser span, that the downstream is a hop, and that neither server span disappears from every listing.
2. **Disclosure (docs).** README (next to "left exactly as the app set it") and G4 §3.4 must state two cases:
   - An app that sets `traceparent` with `setHeader` after the request exists overwrites Tracer's value unmarked, and the hop reads as not followed.
   - An app running its own OpenTelemetry SDK with undici instrumentation sends two `traceparent` headers per `fetch`. The receiver cannot join, and one call appears as two escaped hops.

   Either fix these cases or state them. Softening the wording does not cover them: both frontier clauses are false there.

Recommended, not blocking: detect the `setHeader`-after-injection case at response time (compare `getHeader('traceparent')` with the value Tracer injected, then mark the span); word the escape clause per join kind so that `multiple_exact_parent_servers` is not counted as "no receiving span".

---

# Regrade at 527a7ea9

Grader: the same independent grader. The head is `527a7ea9`, rebased onto `main` `dca34f90` (fix/middleware-reads merged); my earlier grade commits are `1bb4d2f3` and `184a6905`. I tested the head, not the intermediate commits. My probes and outputs are in `grader-scratch/` (uncommitted):
- `probe-out-r3/` and `probe-out-r3b/` (SWR page, ESM Express backend, plain `node:http` peer, 21 clicks);
- `proxy-harness.mjs`;
- `second-sdk/`;
- `fixture-r3/`, `suite3-logs/` and `g6/out-r3/`.

**Final verdict: `merge with changes`, one change.** The proxy regression is fixed, and the rebase integrates cleanly. One new inconsistency comes from integrating with fix/middleware-reads:
- **What happens:** when a hop's only database work is its receiver's `app.use` middleware read, that read becomes the request's headline effect, with "terminal effect observed".
- **Why it is wrong:** the same read in the request's own server is a precondition ("no database work after the preconditions").
- **The change:** see "Required change" at the end.

## (1) Proxy pass-through and the app-set rule

| Probe | Result |
|---|---|
| `http.request` forwarding the incoming headers (`/api/p/proxy-http`) | **PASS.** Exactly 1 server span claims the browser span `0a3f47a66522b04e`: `9d5c678405948d23`. The client span `89af03f0aab05c8b` is marked `traceparent_forwarded: true`, not app-set. The downstream got Tracer's value `…-89af03f0aab05c8b-01`, and its receiver `cf819b5fa3a5f702` is an ordinary `exact_parent` hop: `db insert proxied (handler: proxied)`, terminal effect observed. |
| `fetch` with `traceparent: req.headers.traceparent` (`/api/p/proxy-fetch`) | **PASS.** 1 claimant (`300b5d163b3b8a80`). Client `6dd841a2413ee193` is marked forwarded. The receiver `aed9f3356264e5ce` is an `exact_parent` hop. |
| Same backend under the harness, head vs `main` | Head: http 1 claimant, fetch 1 claimant. On main, fetch had 2 claimants, so fetch is now fixed as well. |
| App-set value (`/api/f/custom-tp`, http and fetch) | **PASS.** One header on the wire, the app's value (`raw 1`). Both spans are marked `traceparent_set_by_app`. The reused value gives two claimants per hop, which is abstained and stated. |
| **Cross-request reuse:** request A (`/api/q/store`) stores its incoming `traceparent`; request B (`/api/q/reuse`) sends it on `fetch` and `http.request` | **PASS as app-set, not forwarded.** Spans `29bee4b77265a6b1` and `5ae39268eb20e1ef` are `app=true`, `fwd=false`. The wire carries A's value, once. B's hops read `more than one server span claims this outbound span; abstained`. **Consequence (the app's doing, stated here):** A's browser span now has 3 claimants (A's own server span plus B's two receivers), so **request A's chain retroactively abstains**: `GET /api/q/store → no server span (multiple_exact_parent_servers)`. A's own server span is also removed from `server_spans_without_request` (the `appTargets` exclusion). It survives only in the join diagnostic's candidate list. This is identifier-honest, but an app that reuses contexts loses the earlier request's chain. See residual risk 1. |
| axios following a redirect | **PASS.** A fresh Tracer value on the second request; both hops `exact_parent`. |

## (2) Disclosures

- **Where they are.** `README.md`, `plugin/README.md` and G4 §3.4 ("Second revision…") each state both cases plainly:
  - a `setHeader` after the request was created overwrites Tracer's value unmarked;
  - a second OpenTelemetry SDK sends two `traceparent` headers per `fetch`, and the call shows as two escaped hops. "Run one SDK."
- **Reproduced at the head.**
  - The second SDK (`second-sdk/`) still gives `n: 2` headers, 2 undici spans, and 2 escaped hops for one call.
  - The late `setHeader` (f2) still reads `no incoming span for this traceparent (not instrumented, or not reached)`.
- **Is it plain enough for an agent reading the hop? No.** The agent-facing text does not carry it. The hop sentence in both cases still asserts "not instrumented, or not reached", and both parts are false there. `plugin/skills/tracer-annotations/SKILL.md`, the agent's guide, does not mention either case. A human installing Tracer is told; an agent reading `action_chain` is not. Recommended (not blocking): add one line to the skill, and a hop-level hint ("…, or the header was replaced or duplicated by the app or a second SDK").

## (3) Wording: PASS

The escape clause counts hops per join kind and omits zero counts:
- `1 hop(s) not followed: 1 with no receiving span (GET …/hook)` (m4);
- `3 hop(s) not followed: 3 with no receiving span (…)` (x);
- `2 hop(s) not followed: 2 with more than one (GET …/internal/echo-tp, …)` (q reuse outcome text).

An abstained hop is no longer called "no receiving span".

## (4) Rebase

- **One span filter: PASS.** `backend/register.js` has a single `relevant`:
  - server, express, handler, db and outbound http/undici client spans ship in full;
  - other spans in a server trace ship as skeletons;
  - delivery is suppressed.

  There are 0 client spans to `/spans` in the fixture and probe stores.
- **`serverSubtree` owns by nearest server ancestor: PASS.** `analysis/runtime-attribution.mjs` `serverSubtree` filters `ownedBy`. A hop's db ops stay with the hop's receiver (for example probe a: every `insert flaky_hits` sits under its own hop).
- **Hop db ops carry issuers: PASS.** `(handler: flakyTarget)`, `(middleware: authMw)`, and `(issuer: unknown)` for the plain `node:http` peer in probe b.
- **Preconditions coexist with escaped hops: PASS.** Probe m4 (`app.use` auth middleware read plus a fetch to an uninstrumented host): `stopped_at: "handler"`, `because: "no database work after the preconditions (find sessions by middleware authMw)"`, the escaped hop as additional stop `outbound_no_incoming_span`, and outcome `Responded 200: no database work after the preconditions …; a further server-side hop may have escaped`. The export gives the same result.
- **A hop whose only db work is its receiver's auth middleware read (m3): FAIL (inconsistent).** `GET /api/m/mw-hop-auth` → hop 1 `/internal/mw-guarded` (`app.use` authMw reads `sessions`; the handler does no db work). The rows claim:

  ```
  [outcome completed 200]: reached db / stopped at none (terminal effect observed) / because database read find sessions (middleware: authMw) (hop 1: GET /internal/mw-guarded) joined by exact span parentage; no write
  ```

  The outcome is `Completed 200: find sessions (middleware: authMw) (hop 1 …)`. The cause is `isPrecondition` (`analysis/runtime-attribution.mjs`, `if (op?.hop) return false`), so every hop op counts as work. The same read in the request's own server gives `no database work after the preconditions` (m4). Route-level middleware (`app.get(path, auth, handler)`) is classed `handler` by main's rule, so it is not a precondition in either place; that is consistent.

## (5) Suite at 527a7ea9

```text
node test/browser/server-outbound.mjs --runs 3 --control --out grader-scratch/fixture-r3   # 170/170 (R13/M14 ×3 and C4 pass)
node --test test/backend-register.test.mjs test/backend-adapter.test.mjs test/server-hops.test.mjs test/middleware-reads.test.mjs
                                                   # v26.7.0 28/28, 0 skipped
docker … node:20-alpine … same four files          # v20.20.2 28/28, 0 skipped
node test/browser/middleware-reads.mjs             # 343/343
npm test                                           # 721 tests, 720 pass, 1 fail (known react-context-ref-semantics)
node test/g4-grader.mjs … final7                   # 81/81
G6 (fully gunzipped store), head vs `git archive dca34f90`   # both 6/6 PASS; compare/index.json byte-identical; AGENT-READS.md identical;
                                                   # pair files differ only by empty hops / escaped_hops / hops_text (11 each) and the store path
node test/browser/d12-stamp-neutrality.mjs         # 23/23
node test/browser/outcome-labels.mjs               # 160/160
node test/browser/mcp-gaps.mjs                     # 35/35
node test/browser/body-capture.mjs                 # 51/51
node test/browser/continuations-neutral.mjs        # status ok
git diff dca34f90..527a7ea9 -- src dist            # empty
```

No `producttrace_test*` database is left in Mongo.

## Residual risks (added)

1. **Cross-request context reuse:** the reusing request's hops abstain, and the earlier request's chain retroactively abstains. Its server span also leaves the unlinked listing (the `hopReceiverSpanIds` `appTargets` rule excludes every server span whose parent equals an app value, including the original request's own span). Honest by identifiers; surprising in a live session.
2. **The disclosed cases** (late `setHeader`, a second SDK) are not visible in agent-facing hop text or in the skill.
3. **Pass-through detection** depends on this process having recorded the incoming server span, with maps bounded at 50,000 entries (author's residual 1).

## Required change at 527a7ea9

1. **Hop preconditions (code).** Decide a hop op's precondition status against the hop's own receiving server, by the same rule as the request's own ops: issuer kind middleware, param or router; a read; not the hop's responder. Remove the blanket `op.hop → false`.
   - A request whose only database work, own and hops', is preconditions must not read "terminal effect observed". Probe m3 should read, for example, `responded 200; no database work after the preconditions (find sessions by middleware authMw in hop 1)` with `stopped_at` at the hop.
   - A hop that did real work after its preconditions keeps that work as the effect.
   - Add the case to the fixture or the unit test.

Recommended: the one-line skill disclosure and hop hint in (2).

---

# Regrade at dd391456

Grader: the same independent grader. The head is `dd391456`, rebased onto `main` `d0b19cb8` (client-aborts merged); my three grade commits are in history. The hops section is now G4 §3.5. My probes and outputs are in `grader-scratch/` (uncommitted): `probe-out-r4/` (23 clicks), `proxy-harness.mjs`, `fixture-r4/`, `suite4-logs/` and `g6/out-r4/`.

**Final verdict: `merge`.** The required change is done and verified, and the recommended items are done. The rebase keeps both sides, and every suite count matches.

## (1) Hop preconditions: PASS

- **m3** (`app.use` auth middleware on the receiver; the receiver's handler does no db work):
  - Outcome: `Responded 200: no database work after the preconditions (find sessions by middleware authMw in hop 1)`, with `stopped_at: "handler"`.
  - Chain: `… → db find sessions (middleware: authMw) [responded 200; no database work after the preconditions] …: reached db / stopped at handler / because no database work after the preconditions (find sessions by middleware authMw in hop 1)`.
  - It no longer says "terminal effect observed".
- **m5** (same middleware, and the receiver's handler then counts documents):
  - Outcome: `Completed 200: aggregate $cmd (hop 1: GET /internal/mw-work)`, terminal effect observed.
  - The hop's middleware read is listed but is not the effect.
- **m4** (the request's own middleware read plus an escaped hop) keeps `stopped at handler / no database work after the preconditions …` and lists the escape as an additional stop.
- **The unit test** "a hop's database operations are judged by its own receiving server's precondition rule" (`test/server-hops.test.mjs:179`) is in the 29/29 below.

## (2) Hint and skill: PASS

- **Hop line.** A hop that got a response but has no receiving span now reads `no incoming span for this traceparent (not instrumented, or not reached); also possible: the app replaced the traceparent after the request was created, or a second OpenTelemetry SDK sent another one`. Seen on probes y, m4 and x hop 3.
- **Hops with no response** (ENOTFOUND, ECONNREFUSED) keep the shorter line. That is correct: neither cause applies to them.
- **Skill.** `plugin/skills/tracer-annotations/SKILL.md:34` now tells the agent to "check the app's outbound code for either before blaming the receiver", and that receiver middleware reads are the hop's preconditions (`… in hop 1`).
- **Verdict.** The disclosure is now in the agent's path.

## (3) Rebase with client aborts, plus proxy and app-set reruns

- **Proxy: PASS.**
  - Browser probe: http gives 1 claimant, client `7a131f2ddc985871` with `fwd=true`; fetch gives 1 claimant, client `a9c4a376477f63fa` with `fwd=true`. Both are `exact_parent` hops ending in `insert proxied (handler: proxied)`.
  - Harness: 1 claimant each.
- **App-set: PASS.** The wire carries the app's value once (`raw 1`), and spans `43724ef93d5b6360` and `cd26597d4cc5193a` are `app=true`.
- **Cross-request reuse** is app-set, not forwarded (`225f7188907adbca` and `3104320f84f7141e` are `app=true, fwd=false`). The reusing request has 1 claimant.
- **Abort fields and hop fields coexist:**
  - The MCP segment carries `outcome: aborted_by_client`, `http_status: null`, and `hops` / `escaped_hops` / `hops_text`.
  - The `page_requests` row carries `server_status: 200` next to `hops` and `hops_text`.
  - The outcome bracket prints main's abort text (`aborted_by_client; server answered 200`). The `escape_text` suffix appears on responded and completed outcomes (m4, x, y).
- **Limit of my live probe.** An abort **with** a hop could not be shown together:
  - My page aborts a streamed body 300 ms after the head. The Express `request handler` layer span of that request (`92925d1cf9ccfbbb`) never reached the store (the connection closed before `finish`, so it never ended).
  - The handler span, and the hop under it, therefore have a broken ancestry. The trace holds two server spans, so they are not attributed.
  - The chain states `stopped at route because the page aborted the request; the server answered 200; no registered handler span …`. That is an honest frontier, not a false claim. The raw hop exists (`f5ca0f999c7ea97e` → `1f9abea890fda9e4`) but is not listed.
  - This comes from the layer span never ending on abort, not from the hop join. I list it as a residual.

## (4) Suite at dd391456

```text
node test/browser/server-outbound.mjs --runs 3 --control --out grader-scratch/fixture-r4   # 170/170
node --test test/backend-register.test.mjs test/backend-adapter.test.mjs test/server-hops.test.mjs test/middleware-reads.test.mjs
                                                   # v26.7.0 29/29, 0 skipped
docker … node:20-alpine … same four files          # v20.20.2 29/29, 0 skipped
node test/browser/middleware-reads.mjs             # 343/343
node test/browser/client-aborts.mjs                # 245/245
npm test                                           # 723 tests, 722 pass, 1 fail (known react-context-ref-semantics)
node test/g4-grader.mjs … final7                   # 81/81
G6, head vs `git archive d0b19cb8`                 # 6/6 PASS; compare/index.json byte-identical; AGENT-READS.md identical;
                                                   # pair files differ only by empty hops / escaped_hops / hops_text (11 each) and the store path
node test/browser/d12-stamp-neutrality.mjs         # 23/23
outcome-labels 169/169 (main's count after client-aborts), mcp-gaps 35/35, body-capture 51/51, continuations-neutral ok
git diff d0b19cb8..dd391456 -- src dist            # empty; cmp src/runtime-attribution-browser.js dist/… identical
```

No `producttrace_test*` database is left in Mongo.

## Residual risks (carried forward)

- **Cross-request context reuse** makes the earlier request's chain abstain (regrade at 527a7ea9).
- **The two disclosed header cases** remain unfixed. They are now hinted in the hop line and the skill.
- **Pass-through detection** is bounded at 50,000 entries.
- **Query strings** in outbound URLs are recorded and printed, as disclosed.
- **One outbound span per call is shipped**, un-batched.
- **An aborted streamed request** loses its Express layer span, so its handler and hops are not attributed. The chain honestly stops at the route.
