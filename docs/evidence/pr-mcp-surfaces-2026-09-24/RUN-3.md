# fix/mcp-surfaces: third author run (2026-09-24)

This follows the independent regrade appended to `GRADE.md`. It is an author execution record, not an independent grade. Base: `main` `39449f7a`; starting head: `aa60bb2c` (including both grader commits). All work and headless checks used this worktree. `node_modules` remained a symlink; no install ran. The earlier `RUN.md`, `RUN-2.md`, and `GRADE.md` were not edited.

## Rules implemented

1. **Full bodies page by a total, exclusive cursor.** The three `include_bodies` surfaces use the same 512 KB budget and order stored bodies newest first by `(timestamp, page, sequence, request_occurrence_id)`. `bodies_full.next_cursor` is `{until_timestamp, until_id}`; `until_id` encodes the page, sequence, and occurrence id. Both input fields are required together. `page_requests` excludes all rows at or after that cursor. `action_chain` and `recent_actions` retain their action/segment summaries, but omit full bodies at or after the cursor; a request repeated in overlapping action windows gets a full body once per reply. The notice names the two inputs to pass with the same filters or action id. `action_chain` now has the same body budget and notice as the other tools. The legacy time-window `until` remains an inclusive time filter, not a paging cursor.
2. **Every hop states its body coverage.** `server.hop` and escaped-hop objects, request segments, described server spans, `page_requests` entries, and unlinked request entries with hops carry `bodies: "not recorded for server-to-server hops"`. The common `hops_text` appends that sentence once per request, including when some hops are hidden by the text cap. Segment, page, and unlinked renderers consume that text; no browser body is assigned to a server hop.

When a page declares body capture `off` or `production_off` and a joined server status exists without a response body row, the request text now says that the browser-side status was not recorded and the browser/server view cannot be checked. This adds no inferred status or mismatch.

## Direct proof

| Check | Result |
|---|---|
| Fresh neutral `mcp-surfaces` driver, `--runs 3 --keep` | 122/122 (116 existing checks plus two new paging checks per run), stable text |
| Grader's tied-timestamp construction, adapted only to pass the new cursor pair | 320 distinct recorded 4 KB responses at one millisecond: full bodies by page **128, 128, 64**; **320 unique, 0 duplicate, 0 missing**; two distinct advancing cursors |
| Driver `action_chain include_bodies` over the 150-body click | Multiple 512 KB pages; every body returned once; no cursor left after recovery |
| `test/mcp.test.mjs` synthetic recent-actions check | 600 unlinked 4 KB bodies recovered exactly once through advancing cursors, within 512 KB per reply |
| Fresh `server-outbound --runs 3 --control` | 186/186; each normal run has 19 hops across eight request segments, every hop and enclosing segment has the coverage field, each segment and `page_requests` line says it once; control run checks the remaining HTTP hops |
| Unlinked-hop replay from one fresh server-outbound store | Removing only the browser request's `action_id` makes its exact joined server hop appear under `action_chain.unlinked`; the request, described server, and hop each carry the body-coverage field, and the unlinked text says it once |
| Bodies-off grader probe | Raw `capture.page.bodies: off`; both `/api/config` server 200 and 304 list `browser_status_not_recorded: true` and the same explicit inability to compare browser status |

The grader's raw-row audit found zero discrepancies on the three fresh driver stores (1,498/563, 1,494/562, 1,498/563 checked clauses/request lines), its bodies-on probe (1,726/426), final7 (126/233), both bodies-on AnythingLLM stores (173/100 each), and G6 (0/718, which has no relevant body/deferral/ID clauses). The separate semantic audit of driver run 1 found 0 problems over 534 entries and 719 new-text markers. The no-CORS and manual-redirect probes still report opaque status 0 with no false mismatch.

## Banked replay against `39449f7a`

The same black-box MCP calls ran against an archived main server and this branch: final7 with and without its source root (108 calls each), G6 (156), and two bodies-on AnythingLLM stores (97 each). The projection of stops, frontiers, outcomes, compare verdicts, lookup best/scores, request counts, and attribution has **zero differences or transport errors**. No banked store contains the new tied burst or a rendered server hop, and no banked request declared body capture off with a joined server status, so this round adds **no banked text changes beyond `RUN-2.md`**:

| Store | Changed lines versus main | Insertions, each backed by rows |
|---|---:|---|
| final7, with source root | 41 | 95 continuation renderings; one ignored-nearby-text disclosure |
| final7, without source root | 41 | Same |
| G6 | 1 | Ignored-nearby-text disclosure |
| AnythingLLM bodies-on, run 1 | 47 | 11 request-field, 53 cache-status, 46 continuation, 15 response-ID, five response-field, one unshown-response-difference renderings |
| AnythingLLM bodies-on, run 2 | 47 | Same categories and counts |

Deleting only those added clauses reconstructs every main text line; zero unexplained lines. Counts of insertions include repeat renderings of one request across tools.

## Requested suite

| Check | Result |
|---|---|
| `npm test` | 732 tests: 731 pass; sole failure is the pre-existing `react-context-ref-semantics` Provider-value assertion (`'a' !== 'b'`) |
| G4 grader | 81/81 |
| G6 copied store, all `*.gz` including manifests expanded, six comparisons regenerated, G6 grader | 6/6 |
| D12 | pass; no first difference |
| continuations-neutral | ok |
| episode-focus `--runs 3` | ok |
| outcome-labels | 169/169 |
| mcp-gaps | 35/35 after updating two exact-string assertions to require the new bodies-off sentence |
| body-capture | 51/51 |
| middleware-reads `--runs 3` | 343/343, stable |
| client-aborts | 245/245 |
| honest-coverage | 45/45 |
| function-names | 263/263 |
| `npm run build`; source/dist `cmp` | build succeeded; byte-identical |

The earlier `mcp-gaps` pass failed 33/35 solely because two exact-string expectations omitted the new bodies-off sentence. The revised checks assert the explicit flag and text; rerun: 35/35. `test/server-hops.test.mjs` likewise now asserts the shared hop text ends with the new sentence and occurs once.

## Limits

- The 512 KB cap applies to stored full bodies; metadata and summaries can make the whole structured reply larger. A many-segment action can still have a long text line.
- Body capture off still cannot reveal whether the browser reported 200 for a server 304. The reply states that gap.
- `recent_actions` still selects its most recent `n` actions; its body cursor recovers bodies within that selected action set. A request can appear as an unlinked observation in overlapping windows, but is returned in full once per reply.
- The React context/ref test failure remains outside this branch's changed product code.
