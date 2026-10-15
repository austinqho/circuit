# Run 4: `fix/server-outbound` after the regrade at `527a7ea9`, rebased onto `main` `d0b19cb8` (2026-09-24)

This run follows the regrade section of `GRADE.md`, committed by the grader as `a3a59521` (verdict "merge with changes, one change"). It then rebases onto `origin/main` `d0b19cb8`, which includes `fix/client-aborts` (#16). RUN.md through RUN-3.md are unchanged. New evidence is in `fixture-4/`, produced on the rebased head. The implementer wrote this file; it is not a grade.

## The required change

**A hop's database operations meet the precondition rule of the hop's own receiving server.**
- I removed the blanket `if (op?.hop) return false` in `isPrecondition` (`analysis/runtime-attribution.mjs`).
- A hop's operation is now judged exactly like the request's own reads. It is a precondition when:
  - its issuer is app-level middleware, a `router.param` callback or a router;
  - it is not a write;
  - its issuer did not write the hop's response. For a hop, "who wrote the response" is taken from the hop's own receiving server: hop database rows carry `hop_responded_by`, which is the receiving server's `responded_by`.
- Precondition text names the hop: `find sessions by middleware auth in hop 1`.

Unit tests in `test/server-hops.test.mjs` ("a hop's database operations are judged by its own receiving server's precondition rule"):
- A GET whose handler calls a peer, where the peer's only database work is its auth middleware's read. Result: `Responded 200: no database work after the preconditions (find sessions by middleware auth in hop 1)`, with `stopped_at: "handler"`.
- The same GET where the peer's handler also reads after its preconditions. Result: `Completed 200: find things (hop 1: GET /peer/things) …`. The hop's work is the effect.

## Recommended changes (both done)

- **The hop line names the two disclosed causes.** A hop that got a response but has no receiving span now reads: `… → no incoming span for this traceparent (not instrumented, or not reached); also possible: the app replaced the traceparent after the request was created, or a second OpenTelemetry SDK sent another one`. A hop that got no response keeps the shorter line, because neither cause applies to a refused connection.
- **Skill.** One addition: check the app's outbound code for `req.setHeader` or a second SDK before blaming the receiver. A hop receiver's middleware reads are that hop's preconditions (`… in hop 1`).
- **G4.** Third revision paragraph added.

## Rebase onto `d0b19cb8` (fix/client-aborts)

Both sides are kept:
- **`requestSegmentCore`.** The abort facts (`http_status: null` for `aborted_by_client`) and the hops (`hops`, `escaped_hops`, `hops_text`) are both present.
- **`actionOutcome`.** Main's `withAppRead` wraps the outcome, which carries the escape fields.
- **`outcomeText`.** The bracket prints main's "aborted by the page after the response" and then this branch's "a further server-side hop may have escaped".
- **MCP.**
  - The outcome keys include both main's abort keys and `escape_text`.
  - Segments carry the abort fields and the hop fields.
  - `page_requests` rows carry `server_status` for aborted requests and the hop fields.
- **Unlinked requests** carry `aborted_by_client` and are joined with every span, which the hop join needs.
- **`fixture-build.mjs`.** Main already had the same `resolve` passthrough, so main's version is kept.
- **G4.** Main added "§3.4 Client aborts"; this branch's section is now §3.5 "Server-to-server hops". Section text is unchanged apart from the number. RUN.md–RUN-3.md still say "§3.4"; read that as §3.5.
- **`src/` and `dist/`.** Main changed them and the branch does not; `cmp` shows the two identical, so there was no rebuild.
- **Method.** I resolved the conflicts once, in the replay of the first analysis commit, by a three-way merge of main with the pre-rebase tip `da0d6878`. I checked that the rebased head's `analysis/*.mjs`, `mcp/tools.mjs` and `test/browser/fiber-demo.js` equal that merge byte for byte. The grader's commits are kept.

## Commands and counts (rebased head; Node v26.7.0 unless stated)

```sh
node test/browser/server-outbound.mjs --runs 3 --control --out docs/evidence/pr-server-outbound-2026-09-24/fixture-4   # 170/170, S1 stable over 3 runs
npm test                                                  # 723 tests, 722 pass, 1 fail (known react-context-ref-semantics)
node --test test/backend-register.test.mjs test/backend-adapter.test.mjs test/server-hops.test.mjs test/middleware-reads.test.mjs   # 29/29
docker run … node:20-alpine … (same four files)            # v20.20.2, 29/29
node test/browser/middleware-reads.mjs                    # 343/343
node test/browser/client-aborts.mjs                       # 245/245
node test/g4-grader.mjs docs/evidence/m1-2026-09-22-final7 --manifest docs/evidence/g4-mcp-2026-09-23/manifest.json   # 81/81
g6-compare (6 pairs) + g6-grader                          # 6/6; compare/index.json byte-identical to one regenerated from `git archive origin/main`; pair files differ only by empty hop fields
node test/browser/d12-stamp-neutrality.mjs                # 23/23
cmp src/runtime-attribution-browser.js dist/runtime-attribution-browser.js   # identical
```

## Residual risks (added)

1. **`hop_responded_by` depends on the receiving server recording who wrote its response** (`producttrace.response.status_code`). Without that record, a middleware read in the hop is a precondition unless it is a write. This is the same rule as for the request itself.
2. **The hint is a list of possibilities, not a diagnosis.** Tracer still cannot tell which cause applies.
