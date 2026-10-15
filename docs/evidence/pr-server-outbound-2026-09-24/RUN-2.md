# Run 2: `fix/server-outbound` after the independent grade (2026-09-24)

This run follows `GRADE.md` (graded at `15ecd7b6`, verdict "merge with changes") and applies its changes on top of `afb9f043`. `RUN.md` is unchanged, as required. The new raw evidence is in `fixture-2/`; `fixture/` is the first run's evidence and has not been modified. The implementer wrote this file; it is not a grade.

## Required changes

**R1: the headline with escaped hops.**
- The rule: a chain says "terminal effect observed" (`stopped_at: null`) only when no hop escaped.
- A chain or request segment that reached its effect but has an unfollowed hop now reports:
  - `stopped_at: "server_hop"`, with `stop_reason: "server_hop_unfollowed"`. The value and wording are the ones `fix/honest-coverage` uses (`origin/fix/honest-coverage`, `analysis/causal-chain.mjs` and G4), so the two branches converge.
  - `reached` unchanged.
  - `because: "reached db (<the DB sentence>); a further server-side hop may have escaped: N outbound call(s) have no receiving span (POST http://…, …)"`.
- The database write is still stated as an effect.
- The outcome status stays the request's own response. Its `label`, `sentence`, `escape_text` and the `[outcome …]` bracket gain `; a further server-side hop may have escaped`.
- Each escaped hop is still an additional stop.
- `buildActionChains` exports apply the same rule.
- A chain whose headline already stops earlier (for example at `handler`) keeps that stop and lists the escaped hops as additional stops.
- Code: `chainFrontier` and `actionOutcome` in `analysis/causal-chain.mjs`; `buildActionChains` in `analysis/runtime-attribution.mjs`; `escape_text` carried into the MCP action outcome in `mcp/tools.mjs`.
- Checks: fixture M8 (the webhook request: exact `because`, `/ stopped at server_hop /`, no "terminal effect observed" on the chain line, the bracket, the label) and M8b (fully followed requests still read `stopped at none (terminal effect observed)`). Also `test/server-hops.test.mjs`, which covers an escape plus the request's own write, with and without the escaped hops.

Before and after, same request (`fixture/run-1` vs `fixture-2/run-1`, webhook):
```
before: … [outcome completed 202]: reached db / stopped at none (terminal effect observed) / because database write insert webhook_attempts joined by exact span parentage; also stopped at network because … → not instrumented (no incoming span for this traceparent); …
after:  … [outcome completed 202; a further server-side hop may have escaped]: reached db / stopped at server_hop / because reached db (database write insert webhook_attempts joined by exact span parentage); a further server-side hop may have escaped: 2 outbound call(s) have no receiving span (POST http://127.0.0.1:65346/hooks/project-archived, POST http://127.0.0.1:65347/hooks/mirror); also stopped at network because … → no incoming span for this traceparent (not instrumented, or not reached); …
```

**R2: an app-set `traceparent`.**
- **Wire rule.** If the app already set `traceparent` or `tracestate` on an outbound request, Tracer leaves the headers untouched.
  - `backend/index.js`: `AppHeadersFirstPropagator` wraps the SDK default (W3C trace context and baggage from the `@opentelemetry/core` copy that `sdk-trace-node` depends on). It skips injection when the carrier already holds an app trace header. That covers `http`, whose carrier is the request's headers.
  - undici injects into a fresh object, so its `requestHook` reads the request's own headers first.
- **The outbound span** carries `producttrace.outbound.traceparent_set_by_app: true`, plus `producttrace.outbound.app_traceparent` when the value is valid W3C.
- **Redirects.** A value Tracer's own outbound instrumentation injected (a client span of the http or undici instrumentation, re-sent by a library on a redirect) is not the app's and is still replaced. A value the app injected itself through the OpenTelemetry API stays the app's.
- **The hop join follows the app's identifiers.** The hop joins the one server span whose trace id and parent span id equal the app's value, with the same method (`join: "app_traceparent"`, rendered `(…; followed by the traceparent the app set)`). Otherwise the join is `app_traceparent_unlinked`: the hop is escaped and rendered `→ traceparent set by the app; receiving span not linked by Tracer`. Receivers followed this way are not listed as unlinked.
- **Softer wording.** A hop with no receiving span now reads `no incoming span for this traceparent (not instrumented, or not reached)`, prefixed by `no response (<error>); ` when there was no response. It never asserts "not instrumented".
- **Probes:**
  - `test/backend-register.test.mjs` (new; ESM and CJS; `fetch` and `http.get` with an app-set header): exactly one undici or http client span, marked, with the app's value. No server span continues Tracer's client span id. Both receiving server spans continue the app's trace and parent. A receiver can only do that if it parsed exactly one `traceparent`, the app's; the old duplicated fetch header made the receiver start a new root.
  - Fixture step (f), `forwardTraced`, makes four calls:
    1. `fetch` to itself, with an app header;
    2. `http.request` to the peer, with an app header;
    3. `fetch` to the uninstrumented host, with an app header;
    4. `fetch` whose headers the app filled with `@opentelemetry/api` `propagation.inject(context.active(), headers)` (the app's own propagator call).

    R11 checks that the four spans are marked with the app's logged values. R12 checks that the receivers continued exactly those values, including the API-inject value, which equals the handler span. R12 also checks that the uninstrumented host received exactly one `traceparent` on the wire (`rawHeaders`), the app's. M12 checks the joins `app_traceparent, app_traceparent, app_traceparent_unlinked, app_traceparent`, the "traceparent set by the app; receiving span not linked by Tracer" sentence for the third call, one escaped hop, and `stopped_at: "server_hop"`.
  - **Not probed:** an app running a second, separate OpenTelemetry SDK. Both SDKs would compete for the global propagator, which is not a Tracer-controlled case. The `propagation.inject` probe covers apps that set the header through the API.

## Recommended changes (all done)

- **Hops made after the response.** A client span that starts at least 1 ms after its owning server span ended carries `after_response_ms`. It renders `(from handler touchProject; sent 50.8 ms after the response)`. Checked in fixture step (g) `touchProject` (a `setTimeout` after `res.json`), M13, where the value is recomputed from the raw client start minus the server end, and in the unit test.
- **A receiving server with no handler span** (plain `node:http`, other frameworks) keeps the database spans it owns: `db_issuer: "unknown"`, rendered `db insert hooks (no handler span; issuer unknown)`. This is covered by the unit test only; the fixture's receivers are Express.
- **`package.json` `engines.node`** is now `^18.19.0 || >=20.6.0`, the range both instrumentations declare. The lockfile's root entry was changed to match; no dependency changed.
- **Docs** (README, `plugin/README.md`, the skill, and the dated G4 revision paragraph): every outbound request, third parties included, now carries a `traceparent` with Tracer's ids. App-set headers are left alone. Outbound URLs are recorded with their query strings, so API keys passed in a query reach `spans.jsonl` and the MCP text. Opt-in query redaction was not built.

## Commands and counts (Node v26.7.0 unless stated; Mongo `producttrace-librechat-mongo`)

```sh
node test/browser/server-outbound.mjs --runs 3 --control --out docs/evidence/pr-server-outbound-2026-09-24/fixture-2   # 154/154, S1 stable over 3 runs
npm test                                                                                   # 710 tests, 709 pass, 1 fail (known react-context-ref-semantics); +3 vs RUN.md (2 register, 1 hop)
node --test test/backend-register.test.mjs test/backend-adapter.test.mjs test/server-hops.test.mjs        # 17/17
docker run … node:20-alpine … (same three files, PRODUCTTRACE_TEST_MONGO_HOST=host.docker.internal)       # v20.20.2, 17/17
node test/g4-grader.mjs docs/evidence/m1-2026-09-22-final7 --manifest docs/evidence/g4-mcp-2026-09-23/manifest.json   # 81/81
g6-compare (6 pairs, fully gunzipped store) + g6-grader                                    # 6/6; compare/index.json byte-identical to main's; pair files differ only by empty hop fields
node test/browser/d12-stamp-neutrality.mjs    # 23/23
node test/browser/continuations-neutral.mjs   # ok
node test/browser/outcome-labels.mjs          # 160/160
node test/browser/mcp-gaps.mjs                # 35/35
node test/browser/body-capture.mjs            # 51/51
```

Fixture control run: step (f) and step (g) also call `/internal/notify`, so C1 and C3 now check every root `/internal/notify` span. In the control, none is in the archive request's trace, and each is listed only under `server_spans_without_request`.

## Incident

During a one-run fixture iteration, the Mongo container `producttrace-librechat-mongo` exited with code 133, a mongod fatal error while it ran an ordinary `insert` into `producttrace_test_outbound.chain_ends`. The container log's head did not show the assertion text. Data volume free space was 825 G, and host disk had 4 GiB free. I restarted it with `docker start producttrace-librechat-mongo`. Every run after that was clean, and the database is dropped after each run (R10). I did not find the cause. It did not recur in the 14 fixture sessions run after the restart.

## Residual risks (in addition to RUN.md and GRADE.md)

1. **Headers set after injection.** An app that sets `traceparent` on the `ClientRequest` after creating it (`req.setHeader(...)`) overwrites Tracer's value itself. That span is not marked `traceparent_set_by_app`, so the hop reads as an ordinary escaped hop with the softened wording.
2. **Redirect detection keeps a memory.** Tracer remembers the last 10,000 values its outbound instrumentation injected, so that a library re-sending them on a redirect is not taken for the app. A very old re-send beyond that window would be treated as app-set: headers left alone, and the hop followed by that value.
3. **Joining into another trace.** The `app_traceparent` join can join a server span in another trace (the app's). It is an identifier join, the same predicate on the app's value. A grader has to recompute it from `producttrace.outbound.app_traceparent`, not from the client span id.
4. **Handler-less receivers are rule-tested only.** `db_issuer: "unknown"` is covered by the unit test; no fixture exercises a non-Express receiver.
5. **Same-millisecond starts.** Parallel hops that start in the same millisecond still fall back to store order (GRADE.md probe a).
