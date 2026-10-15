# fix/mcp-surfaces: post-grade run (2026-09-24)

This follows `RUN.md` and the independent `GRADE.md`; neither was changed. The comparison base is `main` `39449f7a`, archived into `grader-scratch/main` with `git archive 39449f7a | tar -x`. The branch started this continuation at `b287922d`. This is an executor record, not an independent grade.

## Grade changes and direct checks

| Requirement | Implemented rule | Evidence on this head |
|---|---|---|
| R1, current labels | A target's own or ancestor label scores only while it is the latest stamp for that key on the page. An earlier label is disclosed as out of date and cannot produce `best`. | `mcp-surfaces` G1a/G1b: the index-keyed first row changes Alpha → Beta; the Alpha lookup has no best, the current Beta lookup can single out the target. |
| R2, opaque response | A body row with `reason: opaque_response` or status 0 does not create a status mismatch; the line says the browser hid it. | G2: `redirect: manual` gives raw server 302 and browser status 0, `browser_status: null`, no mismatch, and the opaque explanation. |
| R3, nested differences | When shown fields and IDs would read alike but peer bodies differ, name short nested paths and peer values; otherwise disclose a difference only in fields not shown. Peers are scoped to episode, unlinked window, or page listing and the JSON names that scope. | G3a/G3b: `opts.sort: asc (vs desc)` and the long nested upload value's unshown-difference sentence. The raw-row audit checks shown nested values and peer values. |
| R4, continuation | `deferred.basis` names the nearest continuation, lists identified earlier continuations and says where the walk stopped. A single known continuation reaching dispatch keeps the short `via` sentence. | G4a/G4b: timer → promise is rendered as nearest promise with the earlier timer, with timestamps from the first frame on each continuation. Final7 has 63 request segments with deferral; 33 short and 30 nearest/earlier disclosures. |
| R5, bounded fields | Text values are capped at 32 characters; four shown fields per side have `+N more fields`; long status-like values give their shape. JSON retains full values. | G5: six request fields, five response fields and an error object produce the explicit counts and `error: {2 keys}`; the grader probe's longest segment is 813 characters (formerly 1,013). |
| R6, body budget | `page_requests` and `recent_actions` return full stored bodies newest first through 512 KB, leave summaries for the rest, and report the cut and recovery path. | G6 driver: 150 roughly 4 KB bodies, `bodies_full` and `next_until` verified against raw rows; the `recent_actions` unit budget check passed in `npm test`. |
| R7, unused nearby text | A `nearby_text` that matched neither a current own label nor a stamped ancestor is named in `ignored[]` and in text. | G7: the unstamped lane row cannot supply a label to its stamped button; there is no best, and the ignored input is explained. |

The added `response_shapes` names long strings and objects without dumping them. The issuer cap keeps the innermost five frames, `+N more`, and the outermost frame. The body-capture M10 regex is anchored per segment. `revision`, `rev`, and `version` remain status-bearing response words because they report the state a write left, including optimistic-concurrency versions and ETag-like revisions; they are not treated as HTTP status codes. This is a generic last-key-segment rule, not a fixture-name rule.

The prior handoff reported one G4b timing-precondition failure in thirteen driver runs: its assertion used the creating call-site proxy's time, which can be 1 ms before the first frame on the timer continuation. Commit `79dda8cd` corrected that assertion to the first entered frame. On this continuation's first three-run driver, I2 failed in all three runs because it still expected `queryFn` after main's function-names change rendered `useQuery({ queryFn })`. Commit `1eae6be7` checks that display name and the unchanged raw frame-ID order. The rerun passed **116/116 over three runs**. These were driver assertions; the corresponding raw attribution was unchanged.

## Keep-green commands and results

The browser scripts ran headlessly, sequentially. Logs and temporary stores are under `grader-scratch/current/`; no dependency install was run.

| Command | Result |
|---|---|
| `node test/browser/mcp-surfaces.mjs --runs 3` | 116/116, stable text across runs |
| `npm test` | 732 tests: 731 pass; the sole failure is the known `react-context-ref-semantics.test.mjs` Provider-value assertion (`'a' !== 'b'`) |
| `node test/g4-grader.mjs docs/evidence/m1-2026-09-22-final7 --manifest docs/evidence/g4-mcp-2026-09-23/manifest.json` | 81/81 |
| G6: copy `docs/evidence/g6-anything-llm-2026-09-23/store`, gunzip every `*.gz` including `manifests/*.json.gz`; run `node test/browser/g6-compare.mjs --store grader-scratch/current/g6store --source-root /Users/austinho/dev/fixtures/anything-llm --out grader-scratch/current/g6cmp` with pairs `A-baseline:B-seeded-422`, `B-seeded-422:C-fix-r2`, `A-baseline:C-fix-r2`, `A-baseline:D-noop-refactor`, `A-baseline:E-frontend-early-return`, `B-seeded-422:C-fix`; then `node test/g6-grader.mjs grader-scratch/current/g6store --compare grader-scratch/current/g6cmp` | PASS, 6/6 pairs |
| `node test/browser/d12-stamp-neutrality.mjs` | `pass: true`, all six first-difference fields null |
| `node test/browser/continuations-neutral.mjs` | `status: ok` on first run; no timing-precondition rerun needed |
| `node test/browser/episode-focus.mjs --runs 3` | `status: ok`, 3 runs |
| `node test/browser/outcome-labels.mjs` | 169/169 |
| `node test/browser/mcp-gaps.mjs` | 35/35 |
| `node test/browser/body-capture.mjs` | 51/51 |
| `node test/browser/middleware-reads.mjs --runs 3` | 343/343, stable answers |
| `node test/browser/client-aborts.mjs` | 245/245 |
| `node test/browser/server-outbound.mjs` | 154/154 |
| `node test/browser/honest-coverage.mjs` | 45/45 |
| `node test/browser/function-names.mjs` | 263/263 |
| `npm run build` and `cmp src/runtime-attribution-browser.js dist/runtime-attribution-browser.js` | build succeeded; files byte-identical |

## Banked replay against `39449f7a`

`bank-run.mjs` sent the same black-box MCP calls to the archived main server and this branch's server. Inputs were final7 with and without its source root, the copied and fully gunzipped G6 store, and copies of the two bodies-on AnythingLLM stores named in the handoff. Pairs were the grader's existing bank pair files. `bank-diff.mjs` compared structured replies and text. A separate projection checked stops, frontiers, outcomes, chain segments, compare verdicts/path changes and outcome deltas excluding the newly disclosed `deferred`, resolve status/best/candidate scores, and page counts/attribution. **There were 0 invariant differences and 0 transport errors across every matched call.** The only compare-delta addition is `before/after.deferred` where the request rows support it.

Replay commands (from the worktree root; the `allm-store` copies came from the handoff's scratchpad):

```sh
mkdir -p grader-scratch/main
git archive 39449f7a | tar -x -C grader-scratch/main
mkdir -p grader-scratch/current/bank
for side in main branch; do
  if [ "$side" = main ]; then bank_root=grader-scratch/main; else bank_root=.; fi
  bank_out=grader-scratch/current/bank/$side
  bank_run=docs/evidence/pr-mcp-surfaces-2026-09-24/bank-run.mjs
  node "$bank_run" "$bank_root" "$bank_out-f7src.jsonl" grader-scratch/bank/pairs-f7.json -- --records docs/evidence/m1-2026-09-22-final7/records.jsonl.gz --spans docs/evidence/m1-2026-09-22-final7/spans.jsonl --manifest docs/evidence/g4-mcp-2026-09-23/manifest.json --source-root /Users/austinho/dev/trace-consolidated/.live-demo/librechat-m1
  node "$bank_run" "$bank_root" "$bank_out-f7nosrc.jsonl" grader-scratch/bank/pairs-f7.json -- --records docs/evidence/m1-2026-09-22-final7/records.jsonl.gz --spans docs/evidence/m1-2026-09-22-final7/spans.jsonl --manifest docs/evidence/g4-mcp-2026-09-23/manifest.json
  node "$bank_run" "$bank_root" "$bank_out-g6.jsonl" grader-scratch/bank/pairs-g6.json -- --store grader-scratch/current/g6store --source-root /Users/austinho/dev/fixtures/anything-llm
  node "$bank_run" "$bank_root" "$bank_out-allm.jsonl" grader-scratch/bank/pairs-allm.json -- --store grader-scratch/current/allm-store --source-root /Users/austinho/dev/fixtures/anything-llm
  node "$bank_run" "$bank_root" "$bank_out-allm2.jsonl" grader-scratch/bank/pairs-allm2.json -- --store grader-scratch/current/allm2-store --source-root /Users/austinho/dev/fixtures/anything-llm
done
for bank_name in f7src f7nosrc g6 allm allm2; do
  node docs/evidence/pr-mcp-surfaces-2026-09-24/bank-diff.mjs "grader-scratch/current/bank/main-$bank_name.jsonl" "grader-scratch/current/bank/branch-$bank_name.jsonl" > "grader-scratch/current/bank/diff-$bank_name.txt"
done
```

For every changed text line, deleting only the new clause types listed below reconstructs the main line exactly. No main text was removed, no line count changed, and there were 0 unexplained residuals. Counts of inserted clauses include the same request repeated in action, history, compare and page views; they are not unique-request counts.

| Store | Calls | Changed calls / rendered lines | Every text insertion and row basis |
|---|---:|---:|---|
| final7 with source root | 108 | 25 / 41 | 95 deferral renderings from request/dispatch times and continuation IDs; one `nearby_text ignored` disclosure because the supplied text matches no current stamped label. |
| final7 without source root | 108 | 25 / 41 | The same 95 deferral renderings and one lookup disclosure. Source availability changes labels, not the attribution rule. |
| G6 | 156 | 1 / 1 | Only the unused `nearby_text` disclosure. Its banked runtime has no request-body rows and no newly walkable continuation; request text is otherwise identical. |
| AnythingLLM bodies-on, run 1 | 97 | 21 / 47 | 11 `sent` field clauses from request bodies; 53 server-304/browser-200 cache statements from joined server spans and response body statuses; 46 continuation clauses from request/dispatch rows and continuation walks; 15 visible `response ids` clauses from response body rows; 5 `answered` field clauses; one unshown response-difference disclosure against a same-URL peer. |
| AnythingLLM bodies-on, run 2 | 97 | 21 / 47 | Same categories and counts, independently replayed on the second store. |

In final7, 63 distinct action segments gained deferral (all nearest kind `promise`): 33 walks reach dispatch with one continuation and read `via a promise continuation`; 30 state the nearest promise and earlier continuation(s) or that earlier ones were not identified. Twenty-six `page_requests` entry summaries also gain the corresponding `sent` clause. G6's 0 request text changes are consistent with its older body and continuation rows.

The bodies-on stores each have 24 changed action segment summaries: 21 deferrals (15 nearest effects, 6 nearest promises) and 14 cache mismatches among 27 segments. Each has 75 changed `page_requests` entry summaries across its two overlapping calls (46 distinct request occurrences); 43 of those rendered entries newly say `response ids`, 24 say `sent`, 11 say `answered`, 60 carry the cache mismatch, and 4 disclose a response difference only in fields not shown. These categories overlap within entries. The `page_requests` body/field comparison scope is the listing, so its `response_fields` can differ from the episode-scoped `action_chain` summary for the same request; both are computed from their stated peers.

**The extra `response ids` surfaces owed after `RUN.md`:** each bodies-on store has one unlinked line with `response ids results.ModelRouterId=null`; its raw response `network.body` row has `json.results.ModelRouterId: null`. Example: `- request GET /api/setup-complete … [unlinked]; server answered 304; the browser reported 200 from its cache; response ids results.ModelRouterId=null; attribution: none …`. `page_requests` also prints response IDs from its request's own body row, for example `POST /api/workspace/new … [responded 200; no effect evidence; sent name: Tracer G2; response ids workspace.id=1, workspace.router_id=null]`. These IDs do not imply that the requests were caused by the nearby action; the unlinked line retains `attribution: none`.

## Independent raw-row audit

`grader-scratch/audit.mjs` was updated for capped values and `+N more`, nested `value (vs peer)`, long-field shapes, opaque responses, the nearest/earlier continuation format, listing-scoped page fields, and request/response IDs. It reads raw `network.request`, `network.body`, `dom.action`, `function.enter`, and server span rows independently and calls the MCP over stdio. Its former 18 probe findings were all parser-format mismatches; after the parser update there are **0 findings**:

```sh
node grader-scratch/audit.mjs --store grader-scratch/probe-out/store-on --manifest grader-scratch/probe-out/manifest-on.json
node grader-scratch/audit.mjs --store docs/evidence/m1-2026-09-22-final7 --records docs/evidence/m1-2026-09-22-final7/records.jsonl.gz --spans docs/evidence/m1-2026-09-22-final7/spans.jsonl --manifest docs/evidence/g4-mcp-2026-09-23/manifest.json
node grader-scratch/audit.mjs --store grader-scratch/current/g6store
node grader-scratch/audit.mjs --store grader-scratch/current/allm-store
node grader-scratch/audit.mjs --store grader-scratch/current/allm2-store
```

| Store | Request lines | Checked clauses | Findings |
|---|---:|---:|---:|
| Grader probe, bodies on | 426 | 1,726 | 0 |
| final7 | 233 | 126 | 0 |
| G6 | 718 | 0 | 0 |
| AnythingLLM bodies-on, run 1 | 100 | 173 | 0 |
| AnythingLLM bodies-on, run 2 | 100 | 173 | 0 |

G6 has zero checked body/deferral/ID clauses because those rows are absent; its 718 lines were still traversed. The two bodies-on audits verify the added page and unlinked `response ids` against the raw nested response objects. The audit now exits nonzero if it finds a discrepancy.

## Residual risks

- With body capture off, the browser's reported status is not recorded, so a server 304 read as browser 200 still cannot be stated from rows. No status is inferred.
- A continuation with no recorded creating frame, or several plausible creators, stops the backward walk and is disclosed as unidentified. An `await` resumption within a creating frame has no separate row and is not listed.
- `page_requests` and `recent_actions` full bodies have a reply budget; `action_chain include_bodies` remains unbounded. The field-value cap bounds clauses, not the total size of a multi-request action line.
- Enclosing lookup labels require stamped elements, and older runtimes did not hash image `alt`. A raw-evidence lookup still never claims `exact`.
- The pre-existing React context/ref unit failure remains outside this branch's changes.
