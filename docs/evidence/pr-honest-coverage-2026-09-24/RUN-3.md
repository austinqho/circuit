# fix/honest-coverage, run 3: item 1 and the rebase onto main 9ad0f210 (2026-09-24)

RUN.md and RUN-2.md are unchanged. Outputs are in `run-3/`.

## Rebase

The branch was rebased from 25e026cc onto `origin/main` 9ad0f210 (#15 middleware-reads, #16 client-aborts, #17 server-outbound). The grader's commits (GRADE.md, and RUN/RUN-2 evidence) are kept as they were.

Where this branch's earlier code commits conflicted with main, main's version was taken. This applies in:
- `analysis/causal-chain.mjs`
- `analysis/runtime-attribution.mjs`
- `mcp/tools.mjs`
- `backend/register.js`

As a result, the commits `chains: …`, `mcp: …` and `analysis: page-end window …` no longer carry their analysis/MCP hunks. One commit, `analysis, mcp: port honest coverage onto main's hops`, re-applies them on top of main. The runtime (`src`/`dist`) and `collector/coverage.mjs` commits applied cleanly.

## Converged, not duplicated

- **Register.** This branch's register change is dropped. Main's `backend/register.js` ships the full adapter spans: http and undici clients with traceparent injection, proxy pass-through, and skeleton spans. Main also suppresses Tracer's own delivery.
- **Escaped outbound calls: one source.** Main's `server.hop` rows are the only record of escaped outbound calls (`hops`, `escaped_hops`, `hops_text`, `requestSegmentCore`). This branch's `outboundSpans` and its "nested client span = same call" rule are gone, which completes item 1.
- **Each escaped call is stated once.** Main's `chainFrontier` states it: `stopped_at: "server_hop"`, "a further server-side hop may have escaped: N hop(s) not followed: …", plus one `additional_stops` entry. The action's coverage reason is read from the same unfollowed `server.hop` steps and cites the same hop by hop id and span id: `1 server-side hop(s) not followed (hop 1: POST http://…/hook, span <id>)`.
- **What this branch keeps for rule 3: root continuation candidates** (`window_roots`, renamed from `server_hops`). These are server spans in the window with:
  - no browser parent;
  - no recorded backend parent;
  - no hop-receiver role;

  and that started after a joined server span started. They are stated only when no hop clause covers them, or appended as `also N server-side request(s) in this window have no browser parent (listed as unlinked)`. The additive field is `root_escape`.
- **Aborted and never-sent requests (#16).** Main merges abort rows onto their request rows (`mergeRequestFacts`), so each request is counted once, by occurrence id.
  - A request whose signal was already aborted at the call never left the page. It is counted neither in "N recorded request(s) left this page" nor in the unknown-issuer coverage reason. It is still listed under `unlinked`.
  - An aborted request that did leave is counted once, marked `aborted by the page`.
- **Kept from this branch:**
  - inserted-frame realm rows;
  - WebSocket `network.send` and the `websocket` frontier;
  - `wrapper_replaced`;
  - the page-end grace;
  - the lower-bound event-kind wording;
  - the `no_request` headline wording;
  - `page_requests` wording, now also for main's hop-receiver exclusion, through the shared `serverSpansWithoutBrowserParent`.

## Fixture changes (43 → 45 checks)

- **The escaped root trace.** With main's register, Node's `fetch` is instrumented and injects traceparent, so the old `/api/sync` → `/api/notify` fetch became a followed hop. The call now goes over a raw socket: a client no instrumentation sees, as some SDKs and drivers do. That is a genuine new root trace. F2–F5 read it as `server_hop` with the root-span clause, and `root_escape.span_ids` names the raw `/api/notify` span.
- **Export (F6).** One `node:http` client span (the double patch is fixed on main). The frontier, the single outbound `additional_stops` entry and the coverage reason cite the same span. The escape label appears once in `because`.
- **Grader probe g (G Batch, G Seq).** A second instrumented process B (`ROLE=b`) is added.
  - `Batch`: two calls inside one SDK client span, first to B, then to the external service.
  - `Seq`: a call to B, then a call to the external service from B's response callback.
  - Both read `server_hop` with "1 hop(s) not followed: 1 with no receiving span (POST …/hook-batch | …/hook-seq)" and `complete: false`. The coverage reason names the external call's span. The call to B is followed: a server span continues its client span. The external server logged both requests with a traceparent.

## Commands and counts (code at 4160c9ee)

```sh
npm run build && cmp src/runtime-attribution-browser.js dist/runtime-attribution-browser.js   # identical (run-3/build.txt)
npm test                                            # 723 tests, 722 pass, 1 fail: react-context-ref-semantics (known; main is 722/723)
node test/browser/honest-coverage.mjs ×3            # 45/45 ×3 (run-3/fixture-runs.txt)
node grader-scratch/probes.mjs b,b2,d,g             # run-3/grader-probes-b_b2_d_g.json
d12 ok · continuations ok · outcome-labels 169/169 · mcp-gaps 35/35 · body-capture 51/51 · unlinked-coverage-neutral 13/13 · worker-frontier ok
middleware-reads 343/343 · client-aborts 245/245 · episode-focus ok ×3
node test/browser/server-outbound.mjs --runs 3 --control   # 170/170 (without the flags it runs 154 checks; both pass)
node test/g4-grader.mjs docs/evidence/m1-2026-09-22-final7 --manifest docs/evidence/g4-mcp-2026-09-23/manifest.json   # 81/81
# G6: gunzip the store's records/runs/spans AND every file in store/manifests/, then g6-compare (6 pairs) and g6-grader: Overall PASS (6/6)
```

One test expectation changed on main's side: `test/server-hops.test.mjs` "the one hop builder…".
- Its synthetic fixture has an unrelated root `/api/health` server span that starts during the request's server span, inside the action's window.
- The frontier now appends `; also 1 server-side request in this window has no browser parent (listed as unlinked)`.
- The "without the escaped hops" case now reads `server_hop`, from that root span. It reads `null` once the unrelated span is also removed. Both assertions are pinned.

This is the rule working as specified: order only, withholding a claim, never joining.

## Grader probes (b, b2, d, g) on the rebased tree

| probe | result |
|---|---|
| b, b2 (brief frame) | realm row (`via: inserted`); the click's window reason names the frame; `complete: false` |
| d (socket send) | `stopped_at: websocket`, `complete: false`. The pushed `/api/ws-triggered` is named in the headline as "issued by instrumented code outside any action". |
| g Batch / Seq | `server_hop` "1 hop(s) not followed: 1 with no receiving span (POST …/hook-batch / …/hook-seq)", `complete: false` |

## Banked stores against the new main (`run-3/sweep-*.json`, `run-3/diff-*.txt`)

Per action, compared with main 9ad0f210:

| store | actions | stopped_at | because / label / first line | coverage.complete | coverage reasons |
|---|---|---|---|---|---|
| final7 | 54 | 0 | 0 | 0 | 5 |
| G5 | 151 | 0 | 1 (the same `action:muen73wz:28` headline as RUN.md) | 0 | 2 |
| G6 | 408 | 0 | 0 | 0 | 0 |

These are the same changes, for the same reasons, as RUN.md and RUN-2. Additionally:
- The last window of each page records `page_end_grace_ms: 2000`. Its `until_timestamp` is 2 s later than on main: 1 page on final7, 1 on G5, 2 on G6. The banked stores have no `capture.received`, so the base is the same last runtime row.
- No listed span changed.
- Additive fields: `window_evidence`, `window_roots` (13 / 3 / 12 chains, no candidates), `requests_issuer_unknown`.
- The `page_requests` wording changes.
- No `server_hop` appears on any banked chain. They have no hops, and no root span starts after a joined server span within a window.

## Residual risks (in addition to RUN.md and RUN-2)

- **Root-span candidates are chosen by order.** After an escaped hop they are appended as `also …`. If a hop's receiver is instrumented but the traceparent was replaced (main's disclosed case), its root server span can appear both as that escaped hop and as a root candidate. The two statements are about the same call, and the rows cannot prove it. The sentence says "also", not a second hop.
- **Only the credited request's hops are in the chain.** The coverage hop reason reads the chain's `server.hop` steps, so it covers only the credited request's hops, as main's frontier does. Other requests' escaped hops appear in their segments.
- **The fixture's root trace comes from a hand-written raw-socket client.** Real-world equivalents are clients no instrumentation covers, and queue consumers in other processes.
