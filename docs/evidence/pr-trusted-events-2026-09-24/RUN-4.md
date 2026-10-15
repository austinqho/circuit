# Trusted user events: RUN-4 (post-rebase verification, 2026-09-24)

The implementer wrote this file. It is not an independent grade. This run is on `rebase-work` at `ea4e39ba`, based on `origin/main` `39449f7a`. The grader's `1312f427` is an ancestor. No existing evidence file was changed.

## Branch and nine-item audit

The seven commits above `39449f7a` are `3d8cdcc1` (G1 rule), `503696e9` (grader's grade), `dbf9b35a` (the nine required changes), `49f06ae0` (RUN-3), `19bac829` (#18 integration), `b300d1f4` (drivers accept either runtime's observed-event list), and `ea4e39ba` (D-G1-21a rebase note). All nine required items in `GRADE.md` §9 are present in the code and covered by the rebased driver's 118 checks: Alt/AltGr privacy; incremental range close and independent summary beacon; hover segment volume; `opened_by` lifetime; pointer/key/touch/drag gesture identity; inverted recording decision and handlerless kinds; MCP observation and skipped-untrusted proof; visible caused/opened evidence; and a negative-control-safe driver. No item was found missing or half-applied.

The #18 integration uses `observedEventKinds(capture.page)` in `collector/coverage.mjs` and `collector/store.mjs`; the runtime's `observes.events.recorded` and `user_events.listened` both come from `actionListeners`. `dom.untrusted` rows in an episode window are selected by `windowOf`, and a later unattributed request there yields `window_evidence.untrusted_followed` and a coverage reason. The window boundary respects the action's gesture and the 2-second page-end grace. Open ranges close at summary/pagehide; the heavy-page driver checks complete delivery and range counts against the summary.

## Headless verification

| Check | Result | Evidence |
|---|---:|---|
| trusted-events, 3 invocations × 3 main page loads, plus touch, hover and inputText builds in each | 118/118 ×3 | `runs-4/trusted-events-{1,2,3}.txt` |
| negative control: isolated branch archive with `39449f7a` runtime in `dist`, 1 main load | 5/44 (expected failure; driver completes) | `runs-4/negative-control-main-39449f7a.txt` |
| `npm test` | 730/731; only known `react-context-ref-semantics` failure | `runs-4/npm-test.txt` |
| D12 stamp neutrality, 3 invocations | 24/24 ×3, byte-identical variants | `runs-4/d12-{1,2,3}.txt` |
| continuations-neutral | ok, 5 runs | `runs-4/continuations-neutral.txt.gz` |
| shadow-dom-context | ok, 3 runs | `runs-4/shadow-dom-context.txt` |
| no-cross-control-neutral | ok | `runs-4/no-cross-control-neutral.txt` |
| episode-focus, 3 invocations | ok ×3 | `runs-4/episode-focus-{1,2,3}.txt` |
| outcome-labels | 169/169 | `runs-4/outcome-labels.txt` |
| mcp-gaps | 35/35 | `runs-4/mcp-gaps.txt` |
| body-capture | 51/51 | `runs-4/body-capture.txt` |
| unlinked-coverage-neutral | 13/13 | `runs-4/unlinked-coverage-neutral.txt` |
| honest-coverage | 45/45 | `runs-4/honest-coverage.txt` |
| function-names | 263/263 | `runs-4/function-names.txt` |
| middleware-reads | 343/343 | `runs-4/middleware-reads.txt` |
| client-aborts | 245/245 | `runs-4/client-aborts.txt` |
| server-outbound `--runs 3 --control` | 170/170 | `runs-4/server-outbound.txt` |
| G4 grader, final7 | 81/81 | `runs-4/g4.txt` |
| G6 compare regenerated from gunzipped banked store, then grader | 6/6; main/branch output equal after removing only `server_args`' archive-dependent store path | `runs-4/g6-{main,branch}-compare.txt`, `g6-grade.txt`, `g6-normalized-diff.json` |
| `cmp src/runtime-attribution-browser.js dist/runtime-attribution-browser.js` | identical | `runs-4/build.txt` and final check |

The prior body-capture attempt was interrupted with a closed Playwright page; the complete rerun passed 51/51. The neutral suites above were run on the unchanged `ea4e39ba` head. No product code change was needed after the rebase.

## Banked comparison against main `39449f7a`

Main was obtained with `git archive` into `grader-scratch/main-39449f7a`; its checkout was not touched. The grader's `banked.mjs` called the main and branch MCP servers over stdio on the same store. It compares `recent_actions`, `page_requests`, every `action_chain`, `element_history`/`resolve_element`, and consecutive `compare_chains` calls.

| Store | Calls | Identical rendered text | Structured differences |
|---|---:|---:|---|
| final7 | 101 | 100 | 54 `action_chain` objects add empty `chain.window_evidence.untrusted_followed`; one `include_context` call differs as previously documented |
| G6 | 473 | 472 | 408 action chains add the same empty field; one `include_context` call differs |
| G2 AnythingLLM r4 | 113 | 112 | 68 action chains add the same empty field; one `include_context` call differs |
| G3e committed D12 A/B/C rows | 120 | 119 | 63 action chains add the same empty field; one `include_context` call differs |

There are no MCP errors and no other rendered-text differences. The added empty field is the D-G1-21a/#18 window fact: these older stores contain no `dom.untrusted` rows. The `include_context` difference is the documented old-runtime rejection of that option. The G3e comparison here uses the 225 committed `docs/evidence/g3-2026-09-23e/d12/records-{A,B,C}.jsonl` rows. The 582-row temporary G3e bank used in RUN-3 was not preserved, so that exact 97-call comparison was not repeated; the committed G3e rows were compared instead.

## Hover cost

Measured with the grader's `perf.mjs`: CDP `ScriptDuration` over a 10-row, about 1,250-move sweep; two invocations × three reps per mode and build. The exact six samples per cell are in `perf-4/summary.json`.

| Build | Plain hover, instrumented | Hover over buttons with `onMouseEnter`, instrumented | Bare controls |
|---|---:|---:|---|
| main `39449f7a` | 27–36 ms; median 29.5 | 28–48 ms; median 33.5 | plain 27–30 ms; buttons 26–61 ms |
| this head | 78–131 ms; median 95.5 | 87–192 ms; median 117.5 | plain 28–49 ms; buttons 24–45 ms |

The instrumented median ratio is 3.24× on plain hover and 3.51× over buttons. Bare controls also varied between invocations, so these are session measurements rather than a fixed cost estimate. Volume stayed bounded on the driver's heavy page: 4,733 coalesced events, 74 rows, 6 `dom.action` rows and 6 range closes. The RUN-3 residual (2–5× main script time) remains.

## Residual risks

- The G3e 582-row temporary bank is unavailable; the committed G3e D12 rows were compared instead.
- Hover script time is 3.24–3.51× main by median in this measurement; long real sessions remain unmeasured.
- D-G1-21a's remaining limits still apply: events outside the listened kinds or page realm are not observed; classification lists are conservative data; `inputText` lengths and named keys remain visible; and hover listeners doing uninstrumented work can leave only a segment count.
