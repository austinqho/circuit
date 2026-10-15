# fix/mcp-gaps: run record (2026-09-24)

**Claim (one PR, one claim).** The MCP says everything the records already know about an action's work and its surroundings.

- Branch: `fix/mcp-gaps` in `/Users/austinho/dev/tracer-n3-mcp-gaps`.
- Base: `main` at tag `fixes-2026-09-24` (`8a84cfee`).
- Implementer: one agent. This record is not a grade. An independent grader should recompute everything below from raw rows and drive the MCP as a black box.

## What changed, per gap

| # | Gap (grader, generic) | Where it was | Now | Example line (fixture) |
|---|---|---|---|---|
| 1 | Functions on the action's lineage that lead to no request were dropped. A reject looked like "the handler did nothing". | `action_chain` rendered only the credited handler and its spine. The `function.enter` rows of the episode were never listed. | `work`: every first-party frame the episode's actions entered. Frames are grouped by call path, counted, listed in first-seen order, depth ≤ 4, at most 12 printed then `+N more`. Each request hangs off the frame that issued it. A `.catch` or `.then` after the response is marked `after response <status>:`. `element_history` actions and attempts carry `work_summary`. | `- onLike client/src/main.jsx:49` / `  - request (1) POST /api/items/7/like [failed 409]` / `  - after response 409: <anonymous> client/src/main.jsx:53 (promise continuation)` / `    - rollbackLike client/src/main.jsx:44`. Canvas: `  - hitTest client/src/main.jsx:14 ×5`. Empty submit: `  - validateForm client/src/main.jsx:22` / `  - showErrors client/src/main.jsx:64`. |
| 2 | Unlinked server spans came without their route/handler/DB spans. | `indexUnlinkedEvidence.describeSpan` gave the server span's fields only. An unlinked browser request never got its server span: its trace context excluded the span from the span listing too. | An unlinked request carries its own server span through the one exact join (`attachBackendSpans` under a placeholder action id, never the action). An unlinked server span carries its handler and DB spans (`serverSpanDescendants`, the same parentage rules). Both are rendered like a segment and marked `[unlinked]`. | `- request GET /api/audit?flag=on (fetch, sequence 141, no action_id) → route /api/audit 200 → server auditHandler → db insert audits [unlinked]; issued by uninstrumented code (no first-party frame on the stack) from a setInterval timer armed at page load (before the first user action on this page); attribution: none (…)` and `- server span POST /api/sync 204 → server syncHandler → db update syncs (span …, no request with its parent span id) [unlinked]; attribution: none (…)` |
| 3 | There was no way to ask about background requests. | No tool. The runtime recorded no issuer for a request outside every action. | New tool `page_requests` (session, time window, path prefix, attribution filter): each request with its attribution, route, handlers, DB ops, outcome, and per-endpoint counts and intervals. The runtime adds `issuer {function_ids, task}` to unattributed request rows. | `- GET /api/status ×23 (0 action, 23 none; statuses 200×23); interval median 300 ms (min 299, max 301, 22 gaps, each within one page)` and `17:19:14.397 GET /api/status?client=fixture [none: no user action; issued by pollStatus client/src/main.jsx:18 from a setInterval timer armed at page load (before the first user action on this page), armed by <anonymous> client/src/main.jsx:39] → route /api/status 200 → server getStatus → db find status [completed 200]` |
| 4 | Request URLs lost their query string. | Both places. The runtime row recorded `String(url).split('?')[0]` (`src/runtime-attribution-browser.js` `emitTransport`), and the renderer printed `URL.pathname` only. | The row records the URL minus the fragment, and `dist` is rebuilt (`cmp` identical). Segments and request stops gain `query`, and the summaries print path + query. `compare_chains` still compares path only. The docs say query strings are recorded as-is (dev tool). | `(1) GET /api/items?ids=1,2,3&view=compact → route /api/items 200 → server listItems → db find items [completed 200]` (the page fetched `…&view=compact#top`: the fragment is dropped) |
| 5 | `resolve_element` by raw evidence returned 16–18 candidates for every lookup. | `rankTargetCandidates` ranked on dom.action target attributes only, with no stamp evidence and no implicit roles. It returned the top 10. | The ranking adds content signatures recomputed from the supplied name or text (the stamp rows' `content_sig`) and implicit ARIA roles. Mismatches are penalised. Stamped keys with no action are candidates too. The top 5 are returned with scores. `best` is set only when exactly one candidate matches role + name. The result is still `ambiguous`, never `exact`. | `ambiguous: 1 observed target(s) match; top button p_ca7a41812314:3033-3118#n1 (implicit role=button (<button>), aria-label=name, content_sig = name (aria-label)) with 2 actions, score 11. Best (the only candidate matching role and name; not exact (raw evidence); confirm with the live data-tracer-el): p_ca7a41812314:3033-3118#n1 with score 11.` Two "More" buttons: `best: null`, both listed. |

Full renderings from the fixture store are in `fixture-outputs.txt`, and the driver's check list is in `mcp-gaps-driver.txt`. G4 §3 carries the dated amendment with every field, and the skill (`plugin/skills/tracer-annotations/SKILL.md`) tells an agent to read the work listing and to use `page_requests`.

## Decisions (and why)

- **Work is grouped by call path, not by frame instance.** The rows give `spine.function_ids` (ids), and ids attach. A path's `calls` is its number of enter rows.
  - One call can be entered twice: by the call-site proxy (`tag(fn, i, true)`) and by the body's own enter. The body's row then has spine `[…, f, f]` and a `function` continuation parent, so it is the same call and is not counted again. Without this rule `hitTest` read ×10 for 5 calls; the raw rows show the nesting.
  - Consecutive repeats collapse, as for segment lineage.
- **`after_response` needs identifiers and ordering, both.** The frame was entered on a `promise`/`await` continuation (the kind is in `parent_continuation_id`). Its lineage (spine minus itself) prefixes the spine of a request recorded earlier (by sequence). Its enter timestamp is at or after that request's server span `end_time`. So ids attach the lineage and timestamps only order it after the response. Without a server span end the mark is `after_request`, which claims order only.
- **Display priority.** Requests, `after_*` frames and the frames on the path to them are printed first, then other frames in first-seen order. On LibreChat's delete this shows all six requests under their issuing frames instead of twelve hook frames. The JSON keeps up to 100 entries, with the same priority.
- **The unlinked request's server span comes from the one join.** `joinRequestServer` runs `attachBackendSpans` on a copy of the row under the placeholder action id `unlinked:<occurrence id>`. There is no second join implementation. The result is a listing: `attribution` stays `none`.
- **`issuer` is a runtime field, not a join.** "Issued by X from a timer armed at page load" is only sayable when the rows show it, and before this change they did not: action-less `function.enter` rows are not emitted. The runtime therefore records, on unattributed request rows only:
  - the first-party frames on the synchronous stack (ids);
  - the origin of the task (`setInterval`, `setTimeout` or `requestAnimationFrame` armed outside every action, with the page sequence at arming and the frames that armed it). Promise and microtask callbacks created inside such a task inherit it at creation (the engine's creation-time rule).

  It never gives a callback an owner and changes no attribution. D12 and continuations-neutral are unchanged. "At page load" means the arming sequence precedes the page's first `dom.action` (ordering).
- **`page_requests` intervals** are gaps between consecutive requests to one endpoint on one page, from browser timestamps (a measurement, not an attachment). Server spans with no browser request are listed by server-clock start in the window and are not page-scoped, as for unlinked spans.
- **Query strings in `compare_chains`.** Requests are still keyed and compared by `METHOD path` (id-normalised). A query-only difference is therefore not a path change. That keeps G6 unchanged and avoids calling a cache-buster a path change.
- **`resolve_element` scores:**
  - existing rules unchanged;
  - content signature equal to the name +6, equal to the nearby text +2;
  - explicit or implicit role +2;
  - different implicit role −2;
  - no stamp row showing the supplied name −2;
  - candidates with score ≤ 0 dropped (as before).

  `best` is set only for a unique role+name match (name only when no role is given). A role-only or name-less probe never sets it.

## Commands and counts

```sh
cd /Users/austinho/dev/tracer-n3-mcp-gaps
npm run build                                   # "built byte-identical runtime"; cmp src/… dist/runtime-attribution-browser.js → identical
npm test                                        # tests 692, pass 691, fail 1 (known: react-context-ref-semantics)
node test/browser/mcp-gaps.mjs                  # 26/26 (new neutral fixture; MCP over stdio vs raw rows)
node test/browser/d12-stamp-neutrality.mjs      # pass: true, 17/17 checks
node test/browser/continuations-neutral.mjs     # status ok
node test/g4-grader.mjs docs/evidence/m1-2026-09-22-final7 --manifest docs/evidence/g4-mcp-2026-09-23/manifest.json   # 81/81
# G6: gunzip store/*.jsonl.gz into <g6store> (+ manifests), then
node test/browser/g6-compare.mjs --store <g6store> --out <cmp> --pair A-baseline:B-seeded-422 --pair B-seeded-422:C-fix-r2 \
  --pair A-baseline:C-fix-r2 --pair A-baseline:D-noop-refactor --pair B-seeded-422:C-fix --pair A-baseline:E-frontend-early-return
node test/g6-grader.mjs <g6store> --compare <cmp>   # Overall: PASS (6/6 pairs)
node test/browser/{worker-frontier,shadow-dom-context,stable-element-keys,no-cross-control-neutral,effect-rooted-form-neutral}.mjs   # all ok
node test/browser/unlinked-coverage-neutral.mjs # 12/13: A8 fails identically on main (capture.page wrappers.worker is true since the worker-frontier PR; the test still expects ["worker","beacon"] unobserved). Pre-existing, not touched here.
```

Baseline note: a fresh worktree's `evaluation/shared-rules/fixtures/node_modules` must be a copy, not a symlink. With a symlink, 9 library-program tests fail with `implementation_outside_installed_dependencies`. With a copy, `main` is 691/692.

Test edits, all expectation updates for the query-string change:
- `test/frontend-only.test.mjs`: an XHR to `/api/item?x=1` now records `?x=1`.
- `test/browser/unlinked-coverage-neutral.mjs`: the third-party fetch is `/api/third-party?state=yes`.
- `test/mcp.test.mjs`: the inline-segment cap is asserted on the chain line, because the Work block below it also names `request (6)`.

## Banked stores: tool outputs, main vs branch

Method:
- `bank-run.mjs` spawns `mcp/server.mjs` over stdio (SDK client) from a `git archive` of `main` and from the branch. It calls `tools/list`, `recent_actions {n:100}`, `action_chain` for every listed action, `element_history` for every listed key (default n), 7 `resolve_element` probes, `compare_chains` on the graded pairs, and (branch only) `page_requests`.
- `bank-diff.mjs` diffs `structuredContent` by JSON path and the text summaries by line.
- The outputs are `diff-final7-source-root.txt`, `diff-final7-no-source-root.txt` and `diff-g6.txt`.
- Stores used:
  - final7 (`docs/evidence/m1-2026-09-22-final7`, G4 manifest), run twice: with `--source-root` at the LibreChat checkout and without;
  - G6 (`docs/evidence/g6-anything-llm-2026-09-23/store`, gunzipped copy).

Every change, and why it is right:

| Store | Change | Count | Why |
|---|---|---|---|
| all | `tools/list` gains `page_requests` | 1 | New tool (gap 3). |
| all | `action_chain.work` added | final7 54/54, G6 100/100 | Gap 1. The work is non-empty for 46/54 final7 and 100/100 G6 actions. The 8 empty final7 actions entered no first-party frame, and their summaries are unchanged. |
| all | `action_chain.summary` gains lines after the first | final7 46 (594 lines added), G6 100 (1,757 lines) | The Work block. The first line (chain + frontier) is unchanged on 54/54 and 100/100. The longest summary is 5,630 chars on final7 and 5,746 on G6, capped by 12 frames and 10 request lines. |
| all | `segments[].query`, `stops[request].query`, `element_history…request/segments.query`, `compare_chains.before/after.segments[].query` added, all `null` | final7 68/13, G6 489/65 | Gap 4. The banked rows were recorded by runtimes that stripped the query, so there is nothing to show. |
| all | `element_history.actions[].work_summary`, `.attempts[].work_summary` added | final7 46/46, G6 178/88 | Gap 1, same text as the action's Work block. |
| all | `resolve_element.best` added (null in all 14 probes) | 7 + 7 | Gap 5. No banked probe matches role+name uniquely. final7 and G6 target rows carry no label equal to the probe names, and final7 has no stamps. |
| all | `resolve_element.limits` text | 7 + 7 | It now says that stamp rows keep only a hash of the label or text. |
| all | `resolve_element` summary reworded | final7 6, G6 3 | "top <tag> <key> … score N. No unique best by role and name." replaces "best <tag> …": the word "best" is reserved for the new field. |
| all | `candidates[].keys[].component` added | final7 18, G6 24 | Additive: the stamped component (null for handler-placement keys). |
| final7 | `{element_path:"div > div > button", nearby_text:"Save"}`: 6 candidates listed → 5 | 1 | Gap 5 cap (top 5). `candidates_total` is still 6. |
| final7, G6 | `{role:"button", name:"Save"}`: `not_found` → `ambiguous` with 4 (final7) / 5 (G6) candidates | 1 + 1 | Implicit role: a `<button>` target is role `button` (+2). `main` required an explicit `role` attribute, so every button was excluded. The name matches no recorded label (no stamps, so no content signature), so `best` stays null. The answer is a ranked list of buttons, honestly ambiguous, where it used to be a false "nothing matches". |
| all | `unlinked` entries | 0 changes | The banked request-less chains list 0 unlinked requests and 0 unlinked spans (final7 41 chains with `unlinked`, G6 35, all empty), so the new route/handler/DB fields have nothing to add. They are exercised on the fixture (U1–U4). |
| all | `stops`, `reached`, `stopped_at`, `because`, `outcome`, `chain`, `episode_*`, `recent_actions` (all fields), `compare_chains.stops/path_changed/outcome_delta` | 0 changes | Rendering-only claim. G4 81/81 and G6 6/6 confirm it. |

Transport note: the G6 `element_history` on the keystroke key `…1181:1319|keydown` returns more than 10 MB. That exceeds the MCP SDK client's read buffer (`ReadBuffer exceeded maximum size of 10485760 bytes`), so the connection closes. This happens identically on `main` (pre-existing). The runner records the error for that call on both sides and reconnects. See residual risk 2.

`page_requests` on the banked stores (branch only):
- final7: 165 requests, 68 attributed and 97 with no action. The 97 read `issuer not recorded (runtime before 2026-09-24)`. Each carries its exact server span, handlers and DB ops (e.g. `GET /api/keys … → route /api/keys 304 → server requireJwtAuth,<anonymous> → db find users, find keys`).
- G6: 425 requests, 293 attributed and 132 with no action. `GET /api/setup-complete ×102 (66 action, 36 none)`.

## Residual risks

1. **Names and lines in stamped builds (pre-existing, material for gap 1 on real apps).** The Vite plugin's source-level control stamps (`data-producttrace-control-*` attributes) are inserted before the attribution pass.
   - Function ids therefore hash the stamped text, and offsets after the first inserted attribute are in stamped coordinates.
   - A checkout never hashes equal, so with `--source-root` every function in such a JSX file is `line_status: stale_build` and renders `<unnamed> file@start-end`. Store-writer enrichment fails for the same reason.
   - The fixture driver serves the build's own source text (from its source map `sourcesContent`) as the checkout. Inserted attributes carry no newlines, so lines equal the checkout's. The driver asserts this.
   - Proposed follow-up (its own claim): record `name` and `line` in the attribution manifest at build time, from the exact text that was hashed.
2. **Oversized answers.** `element_history` on keystroke-heavy keys can exceed the SDK client's 10 MB buffer (pre-existing). The `work_summary` strings add a little. A per-tool size budget is still owed.
3. **Clock order in `after_response`.** Browser enter timestamps are compared with server span end times. On one dev machine that holds; with skew, a frame may read `after_request` or lose the mark. It never gains a join.
4. **Lineage is function ids, not frame instances.** If one lineage issued several requests before a continuation, all of them are listed (`after responses (1) 200, (2) 409:`). Direct recursion `f → f` entered on a `function` continuation counts as one call.
5. **Issuer coverage.** Timers armed before the runtime installs (native) carry no `task`. Resumptions of native `await` inside an unowned task, `MessageChannel`, listeners and workers set no origin; the issuer then says `task origin not recorded`. Only first-party frames appear in `function_ids`, so `[]` means uninstrumented code.
6. **"At page load"** means armed before the page's first `dom.action` (sequence order). A timer armed by a non-action event before the first user action also reads "at page load".
7. **Query strings are recorded as-is** (dev tool). Tokens in URLs reach dev stores. The request bridge (`analysis/browser-request-bridge.mjs`, LibreChat viewer path) still strips the query and was not changed. Banked stores hold paths only.
8. **Raw-evidence ranking.** Content signatures cover the first label attribute or the first 64 characters of text exactly: a partial or longer name does not match. The implicit-role table is a common subset. Role-only probes now return button-like candidates where `main` said `not_found` (see the table above).
9. **Work scope.** It is the episode's frames, including field handlers (e.g. `onChange` per keystroke in a form episode), not only the queried action's. At most 12 are printed; `work.entries` holds 100.
10. Unchanged from PR #4: unlinked server spans are selected by timestamp window and are not page-scoped.

## Commits

See `git log fixes-2026-09-24..fix/mcp-gaps`. The attribution trailer follows the session's system instruction (`Claude Opus 5.5 (1M context)`).
