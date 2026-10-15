# Body capture: RUN-4 (2026-09-24, rebased onto origin/main 0d6938d9)

This file answers the regrade at 4803c877 (commit 1b342df0, rebased as d8c5b51c; "merge with changes: rebase only") and the coordinator's three items. It adds to `RUN.md`, `RUN-2.md` and `RUN-3.md`; none of them was edited. The implementer wrote this file; it is not a grade.

## Rebase

- **What moved.** `fix/body-capture` was rebased onto `origin/main` 0d6938d9, which contains #10 outcome labels, #11 episode focus and #12 mcp-gaps.
  - All 22 branch commits were replayed, including the grader's three: `941ec21a` = bbfd707b, `19973fa5` = 5b2b3b4a, `d8c5b51c` = 1b342df0.
  - The branch is pushed with `--force-with-lease`.
- **`src/runtime-attribution-browser.js` + `dist` (fetch/XHR wrappers, two commits).**
  - #12's `issuer` on unattributed requests and my body module are both kept.
  - `emitTransport` already returned the occurrence id on main, and #12 records path + query.
  - fetch with bodies off is main's code unchanged: the native promise is returned and registered in `responsePromises` for `response_of`.
  - fetch with bodies on: the native promise **and** the derived promise the app receives are both registered in `responsePromises`, so `.then` / `await` reactions on the app's promise carry `response_of` ("after response N").
  - XHR: `xhrOccurrences.set` (#12) and the body capture's native `load` listener are both kept.
- **`collector/store.mjs`.** `joinedRowsFor` (#11) and `bodiesFor` are both exported.
- **`mcp/tools.mjs`.** The body summaries ride on the new segment shape.
  - `chainStops(store, id, { episodeView, includeBodies })` and `requestSegments(store, record, scope, { includeBodies })` take both options.
  - Segments carry `outcome_label` / `outcome_text` (#10/#12) plus `body` / `response_body`.
  - `action_chain` carries `work` (#12), `bodies`, and `include_bodies`.
  - `element_history` actions and attempts, including #11's episode views, keep ids only.
  - `validateInput` keeps #12's `enum` check and the `boolean` type.
- **Proof that the registration is load-bearing** (negative control, `negative-control/derived-not-registered-driver-4.txt`). With the derived-promise registration removed from `dist`, the driver gives **49/51**:
  - A1 fails: with bodies on, 0 `response_of` rows on the `.then` chain and 0 on the awaited rename, against 5 and 2 with bodies off;
  - M11 fails: the MCP loses both "after response (1)" lines.

## Items

| # | item | change | proof |
|---|---|---|---|
| 1 | rebase | above | reruns below |
| 2 | query-string lines | README, plugin README and G4 §3.3 now say: query strings are recorded as sent on the `network.request` row (path + query, tokens included, never the fragment); body rows carry no URL. RUN-3's privacy section is superseded below. | `grep -n "Query strings" README.md plugin/README.md docs/gates/G4-mcp.md` |
| 3 | suffix rule | renamed "quantity or metadata suffixes". `budget`, `usage` and `total` were added to the kept list; `token` stays strong. | K1: `tokenBudget: 8000`, `tokenUsage: 120` and `cardTotal: 3` are kept. `pin`, `otp`, `cvv`, `cardNumber` and `secretAnswer` numbers are still redacted (21 redactions). |

## Reruns (this head)

| run | result |
|---|---|
| `npm run build`, `cmp` src/dist | identical. `dist/runtime-attribution-browser.js` is 144,479 bytes (main 0d6938d9: 120,513) |
| `npm test` | 700 tests, 699 pass, 1 known failure (`react-context-ref-semantics`). Main has 699 tests; +1 is this branch's `bodies` option / coverage test |
| driver `test/browser/body-capture.mjs` | **51/51** (`fixture-4/`). The new checks: **A1** (`response_of` rows on a `.then` chain and on an `await` of the fetch are identical in dev, dev_off, prod and prod `'always'`: thenchain 5, rename 2) and **M11** (the MCP work listing has the same two "after response (1)" lines with bodies on and off) |
| parity | O2 (page output identical for bodies on, off and uninstrumented, page errors equal) and O5 pass. P1/P2: `pipeTo` lifetimes 200 B / 53–56 ms and 203 B / 51–55 ms in all four builds |
| D12 | **23/23** (`d12-4/report.json`; records 40,841 B, chains 33,366 B for each of A–D). Raw A vs D (my own diff of `records-A/D.jsonl`, `network.body` rows dropped): 87 = 87 rows, kinds in the same order, the only differing path is `capture.page.bodies`. D has 4 body rows |
| continuations-neutral | bodies off: `status ok`, 5 runs. `PRODUCTTRACE_CONTINUATION_BODIES=always`: `status ok`, 5 runs. The grader's counting copy shows 3,554–3,586 body rows per run |
| G4 grader | 81/81 |
| G6 | compare regenerated (`g6-compare.mjs`, 6 pairs) → `g6-grader.mjs` 6/6 |
| `test/browser/mcp-gaps.mjs` | 35/35 |
| `test/browser/episode-focus.mjs --runs 3` | `status ok`, 3 runs, `stable: true` |
| `test/browser/outcome-labels.mjs` | 160/160 |
| final7 MCP, branch vs main 0d6938d9 (`recent_actions` + 54 `action_chain`s over stdio; grader's `mcp-all.mjs`) | The rendered summary text is identical for 55/55 calls. `structuredContent` is identical for 55/55 after removing the added null fields: `bodies: null` ×54, `segments[].body: null` ×68, `segments[].response_body: null` ×68. Nothing else differs. The JSON text item differs only by those fields. Raw outputs: `final7-vs-main-4/*.jsonl.gz` |

The three merged-PR drivers build in production mode, so they ran with bodies `production_off`. Bodies-on coverage of the merged behaviour is A1/M11, D12 variant D, and continuations-neutral with `always`.

## Sizes (fixture dev page, 22 requests)

- 26 body rows, 22,718 bytes: 1,033 bytes per request.
- The page's rows total 228,539 bytes with bodies on against 205,801 off.

## Privacy (supersedes RUN-3's residuals and RUN-2's privacy section on query strings)

**Recorded:**
- JSON bodies up to 4 KB. Secret-key values are redacted by segment, as in G4 §3.3; numbers only under strong segments, and not under a quantity or metadata suffix.
- `text/*` bodies as sent (unknown length: the first 4 KB).
- `content-type`, status, and sizes.
- **Query strings, as sent, on the `network.request` row** (fix/mcp-gaps). Tokens in a URL are recorded; the fragment never is. Body rows carry no URL.

**Not recorded:**
- Secret-key values.
- Headers other than `content-type`: never `Authorization` or `Cookie`.
- `document.cookie`.
- Untyped, binary, streaming, multipart, urlencoded and blob bodies: size only.
- Anything in a `production` build without `'always'`.

**Residuals, unchanged from RUN-3:**
- key-name redaction only;
- a fetch rejection reaches the app one microtask later (P6);
- the connection-lifetime residual paths: an abandoned unknown-length JSON response, and `preventCancel`;
- the stream wrappers are detectable by `toString`;
- rows persist in `.tracer/`, which is not git-ignored.

## Files added

| file | sha256 |
|---|---|
| `fixture-4/report.json` | `dc21db8d31c04e25bcd061f56fcab62db2850f1d707ff34b407c222ba10980e3` |
| `fixture-4/records-body-rows.jsonl` | `56bbcc9a6508b3f748971ca377e5b4066506227658436200caef45151256d512` |
| `fixture-4/server-log.json` | `ad9f9a4cae6a75b7ac07c93dfad33652b960a1fcd4daad16a439e92b4e049c92` |
| `fixture-4-run.txt` | |
| `d12-4/report.json` | `ee51ab074d9df1f17f319c949bd6c43d76be2ce42475c577ccf9af8cca2caefb` |
| `final7-vs-main-4/branch.jsonl.gz` | `d5840e029450e660892d35a46e1b98e31c29897e669aee11180901af9640ce0f` |
| `final7-vs-main-4/main-0d6938d9.jsonl.gz` | `2e2dd614040e80c4a95c35a2a7549951071ad43285e5735fc7fb8ccd988d0073` |
| `negative-control/derived-not-registered-driver-4.txt` | `5a1067c92608bb420c7a2af5923b21cf7719ba32d325d1a9ef5a781bb999c46d` |
