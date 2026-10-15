# Run 3: `fix/server-outbound` after the regrade, rebased onto `main` `dca34f90` (2026-09-24)

This run follows the regrade section of `GRADE.md` (graded at `94af88e6`, verdict "merge with changes"; committed by the grader as `6f87b0f4`, now `184a6905` after the rebase). It then rebases onto `origin/main` `dca34f90`, where `fix/middleware-reads` (#15) merged. `RUN.md` and `RUN-2.md` are unchanged. New raw evidence is in `fixture-3/`, produced on the rebased tree. The implementer wrote this file; it is not a grade.

## Regrade changes

**1. A forwarded incoming `traceparent` is a pass-through (code).**
- The rule: an outbound request whose `traceparent` equals the value that the nearest server span of this process received is not an app-set header. This is the proxy pattern: forwarding `req.headers`, or `traceparent: req.headers.traceparent`.
- Tracer removes the forwarded trace headers, injects its own client span's value (as `main` did for `http`), and marks the span `producttrace.outbound.traceparent_forwarded: true`. This applies to `http`/`https` and to `fetch` (undici: the request's header entries are removed in `requestHook`, before the instrumentation injects).
- Any other app value keeps the app-set rule from RUN-2.
- "The value the current server span received" is tracked per server span: the http instrumentation's incoming `requestHook` records the received `traceparent` per server span id. A span processor records every span's parent id. The client span's ancestry is walked to its nearest server span. Both maps are bounded at 50,000 entries.
  - A per-process set of received values was tried first. It was wrong: a second request that reused a value the same process had received on another request was taken as forwarded. The register test for app-set headers caught it.
- **Probes.**
  - `test/backend-register.test.mjs`: forwarded `fetch` and `http.get` on the ESM and CJS apps. Each checks one outbound span marked forwarded and not app-set; exactly one server span claims the caller's span; the downstream server span is the child of Tracer's client span.
  - Fixture step (h), `proxyProject`: `http.request` to the peer with the incoming headers forwarded, and `fetch` to itself with `traceparent: req.headers.traceparent`.
    - R13: exactly one server span claims the browser request; both calls are marked forwarded; each has exactly one receiving server span.
    - M14: the browser request joins; both hops are `exact_parent`; nothing escaped; terminal effect observed.
    - The control run (fetch adapter off) states, as C4, what `main` did for `fetch`: the uninstrumented `fetch` forwards the header as is, and two server spans claim the browser request.

**2. Disclosures (docs).** `README.md`, `plugin/README.md` and G4 §3.4 ("Second revision after the regrade") state both cases plainly. Neither is fixed:
- (a) An app that calls `req.setHeader('traceparent', …)` after the request was created overwrites Tracer's value, and the span is not marked. The receiver is listed as an unlinked root, and the hop reads "no incoming span for this traceparent (not instrumented, or not reached)".
- (b) An app with a second OpenTelemetry SDK: its undici instrumentation uses Tracer's provider and propagator. One `fetch` then sends two `traceparent` headers and produces two client spans, and the call renders as two escaped hops.

I chose to disclose (b) rather than detect it. The second instrumentation's injection is indistinguishable from Tracer's at propagation time (same scope name, a fresh carrier), and its duplicate header is already on the wire when undici's `sendHeaders` channel fires. I found no way to mark a span `double_instrumented` without guessing by URL or time.

**3. Wording.** The escape clause counts hops per join kind: `a further server-side hop may have escaped: N hop(s) not followed: M with no receiving span, K with more than one (…)`. `… with a receiving span of another method` appears when that case occurs. Zero counts are omitted. The unit test checks an abstained twin claimant.

## Rebase onto `dca34f90` (fix/middleware-reads)

- **One span filter** (`backend/register.js`). Server, Express, handler, database and outbound HTTP client spans (the http and undici adapters) ship in full. Every other span of a trace that holds a server span ships as a skeleton (main's rule). Tracer's own delivery runs with tracing suppressed, so it makes no span in any trace. `backend/index.js` runs both span processors: Tracer's ancestry recorder (for pass-through detection) and main's `onSpanStart` watcher.
- **Ownership × "every op under the server span".**
  - `serverSubtree` (main) now takes the spans the server span owns: descendants whose nearest server ancestor it is. A hop's work stays with the hop's receiving server.
  - The receiving server's work is computed by the same `serverSubtree`. A hop's database operations therefore carry issuers (`db insert notifications (handler: notify)`; `(issuer: unknown)` for a receiver with no naming code). This replaces RUN-2's `db_issuer: "unknown"` rendering.
  - The outbound call itself names its issuer through `nearestIssuer` (`from handler …`, `from middleware …`).
  - `isPrecondition` is false for a hop's operation.
  - `headlineOp` prefers the request's own operations and falls back to a hop's. `dbOpText` names the hop.
- **One segment builder.** `requestSegmentCore` (main) takes `server.hop` steps and returns `hops`, `escaped_hops` and `hops_text`; its `db_ops` are the request's own server's. The MCP and exported action chains (`requests[].hops`, plus a hop's writes marked `hop`) read it.
- **Escaped hops and preconditions coexist.** A request whose own reads are only preconditions keeps main's stop: `stopped_at: "handler"` or `"route"`, with `because: "no database work after the preconditions (…)"`. The escaped hops are additional stops. A request that reached its effect but lost a hop reads `stopped_at: "server_hop"`. Unit test: "preconditions and an escaped hop coexist".
- `src/` and `dist/` are unchanged by the branch (`git diff origin/main -- src dist` is empty), so there was no rebuild.
- **History.** The grader's commits are kept (rebased: `1bb4d2f3`, `184a6905`). I resolved the rebase conflicts in `analysis/causal-chain.mjs`, `analysis/runtime-attribution.mjs`, `mcp/tools.mjs` and `test/browser/fiber-demo.js` once, in the replay of the first analysis commit (`dcd97f2e`), by a three-way merge of `main` with the pre-rebase branch tip `cee6e330`. The later commits `3679980e`, `d064b14f` and `aaa01205` therefore carry only their test changes; their analysis and MCP changes are in `dcd97f2e`. Intermediate commits of the rebased branch were not tested individually; the head was.

## Commands and counts (the rebased head; Node v26.7.0 unless stated)

```sh
node test/browser/server-outbound.mjs --runs 3 --control --out docs/evidence/pr-server-outbound-2026-09-24/fixture-3   # 170/170; S1 stable over 3 runs
npm test                                                  # 721 tests, 720 pass, 1 fail (known react-context-ref-semantics)
node --test test/backend-register.test.mjs test/backend-adapter.test.mjs test/server-hops.test.mjs test/middleware-reads.test.mjs   # 28/28
docker run … node:20-alpine … (same four files, PRODUCTTRACE_TEST_MONGO_HOST=host.docker.internal)                         # v20.20.2, 28/28 (Express 5 esm/cjs + Express 4 tripwire included)
node test/browser/middleware-reads.mjs                    # 343/343
node test/g4-grader.mjs docs/evidence/m1-2026-09-22-final7 --manifest docs/evidence/g4-mcp-2026-09-23/manifest.json   # 81/81
g6-compare (6 pairs, fully gunzipped store) + g6-grader   # 6/6; compare/index.json byte-identical to the one regenerated from `git archive origin/main`; pair files differ only by empty hop fields
node test/browser/d12-stamp-neutrality.mjs                # 23/23
node test/browser/continuations-neutral.mjs               # ok
node test/browser/outcome-labels.mjs                      # 160/160
node test/browser/mcp-gaps.mjs                            # 35/35
node test/browser/body-capture.mjs                        # 51/51
```

Before the rebase, the regrade changes alone passed on `cee6e330` with: fixture 170/170, `npm test` 713/712 + 1 known, register/hop tests 20/20 on Node 26 and 20/20 on Node 20, G4 81/81, G6 6/6 (index identical), D12 23/23, outcome-labels 160/160, mcp-gaps 35/35, body-capture 51/51, continuations ok. That tree is not kept as evidence.

## Residual risks (added)

1. **Pass-through detection depends on this process having recorded the incoming server span.** A request whose server span came from another tracer, or whose entries fell out of the 50,000-entry maps, is treated as app-set: headers are left as they are, and the hop follows by value or is stated as unlinked.
2. **A handler that deliberately continues the caller's span id** (rather than forwarding by accident) is now given Tracer's value. That is the intended rule, but it changes the wire for that app.
3. **(a) and (b) above are disclosed, not fixed.**
4. **Commit-level fidelity after the rebase** is as described under History.
