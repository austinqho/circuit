# fix/episode-focus: follow-up after the independent grade (2026-09-24)

`RUN.md` is left as it was at `2da99996`. The independent grade (`GRADE.md`, committed as `c9ca4b71`) is "merge with changes", with change 1 blocking. This file records the changes and the full rerun. The fix commits sit on top of `c9ca4b71`.

## Changes

1. **Blocking: focus credit needs a provably live frame** (`fbcdcd96`, `src/runtime-attribution-browser.js`, `dist/` rebuilt, `cmp` identical).
   - The grader's probe: the click reads a streamed body with `for await`, and `for await` is not rewritten, so the click's function frame stayed current while the stream was suspended. A real Tab focus during the stream was then marked `gesture: false`, credited to the click, and lost its fold.
   - I took the grader's **second option**, a liveness mark that suspension clears. I did not extend the await rewrite.
   - How it works: every frame the runtime makes current (`continuationOf` when a wrapped callback runs, and the function frame at `enter`) carries `run`, the token of the current synchronous run. The token dies at the next microtask checkpoint, which is when the JS stack has emptied (a native `queueMicrotask` captured before the runtime wraps it).
   - `focusCause` marks a focus only when the settled frame is a dispatch frame (already live-checked by `settleAmbient`) or carries a live token. Otherwise the row gets no mark, so a Tab or pointer focus keeps its fold.
   - Only the focus cause reads the token. Ownership of every other row is unchanged: code resumed after a `for await` still runs on the frame it ran on before, as on `main`.
   - **Why not the preferred option (extend the await rewrite).** Rewriting `for await` and async generators changes the code emitted for every app: yielded values would need a leave/resume that does not settle promises into outcomes, iterator `return`/`throw` paths would need resumption points, and microtask interleaving would change. That is a G1 engine claim in its own right. It would also not cover the other ways a frame is left behind: unwrapped `ResizeObserver`, `IntersectionObserver` and `requestIdleCallback` callbacks. The liveness token covers every such path for focus with one rule. The residual frontier (continuations across `for await` and generators) is unchanged from `main`.
   - Also removed the dead `'focus'` entry from `FOCUS_EVENTS` (grade change 4).
2. **`element_history` lists keys that only have caused focuses** (`e901c0e4`, `mcp/tools.mjs`). Caused focuses are listed with `gesture: false` and the pointer. They are never attempts and never counted toward `n`. They are listed in any of these cases:
   - the causing action's episode is a kept attempt;
   - the focus is no older than the oldest kept user action;
   - the key has no user action at all.

   The summary for a key with only caused focuses is `0 attempts on element …; N caused focus(es) (not user gestures); newest: …`. It never says "no actions" when rows exist.
3. **The `element_history` headline uses the episode view** (`e901c0e4`). The `newest:` line reads the newest user action's episode view, as `attempts` do. The banked summaries are byte-identical to `main` again (table below).
4. **Tests** (`1e85d543`):
   - Driver cases (g) and (h): the grader's stream probe as neutral fixture sections, `for await` over a streamed body and a first-party async generator. The Tab is pressed while the stream is open. In 3 of 3 runs the Tab focus has no `gesture`/`caused_by_action_id`, folds into the Enter (`[focusin, keydown:Enter]`), and is absent from the click's `caused` in the rows and in MCP `action_chain`. No action between the click and the Enter is credited to the click.
   - Driver case (b) on a store truncated before the Enter: `element_history` on the dialog key lists the caused focus with its pointer, has no attempts, and the summary does not say "no actions".
   - Synthetic: `test/episode-focus.test.mjs` 5/5 (adds the caused-only key).
   - `test/browser/fixture-build.mjs` `serveFixture` gained an optional `streams` map (timed chunked bodies).
   - On the previous head (`2da99996`) the driver fails at `(stream a) the Tab focus during the suspended stream carries no gesture:false`.

## Rerun (this head)

```sh
node test/browser/episode-focus.mjs --out docs/evidence/pr-episode-focus-2026-09-24/runs-r3   # status ok, 3 runs, stable (153 rows per run)
node --test test/episode-focus.test.mjs                                                      # 5/5
npm test                                                                                     # 696/697; 1 known failure (react-context-ref-semantics)
node test/browser/d12-stamp-neutrality.mjs                                                   # pass, 17/17
node test/browser/continuations-neutral.mjs                                                  # ok
node test/browser/no-cross-control-neutral.mjs                                               # ok
node test/g4-grader.mjs docs/evidence/m1-2026-09-22-final7 --manifest docs/evidence/g4-mcp-2026-09-23/manifest.json   # 81/81 (g4-grade-2.md)
node test/browser/g6-compare.mjs --store <scratch g6store> ... <6 pairs> && node test/g6-grader.mjs <scratch g6store> --compare <out>   # PASS 6/6 (g6-grade-2.md); compare JSON, index.json and AGENT-READS.md identical to main
cmp src/runtime-attribution-browser.js dist/runtime-attribution-browser.js                   # identical
```

Also exit 0: `effect-rooted-form-neutral`, `shadow-dom-context`, `stable-element-keys`, `worker-frontier`.

**The grader's own `p12-drive.mjs`, run unmodified except for its import path, 3 runs:** 0 rows marked `gesture: false`. Both Enter episodes are `focusin + keydown:Enter` and no episode has a `caused` list. This matches `main`'s rows as reported in `GRADE.md`.

**Per-run timings (`runs-r3/report.json`):**

| case | focus → Enter / keypress | mark |
|---|---|---|
| (a) | 504–531 ms | `microtask` |
| (b) | 505–507 ms | `mount_effect` |
| (c) | 602–606 ms | `dispatch` |
| (f) | 519–523 ms | `scheduler_lineage` (abstained) |
| (g) stream `for await` | 301–303 ms | none (folded) |
| (h) stream generator | 302–303 ms | none (folded) |
| (d) Tab control | 304 ms | none (folded) |

## Banked outputs (`banked-diff-2.jsonl`, `tools-2/`: the dump now records the `element_history` summary)

| store | episodes identical | `action_chain` changed (all non-carrier members) | `attempts` changed | `element_history` summary changed |
|---|---|---|---|---|
| final7 | yes | 0 / 54 | 0 / 35 keys | 0 |
| g5-anything-llm-2026-09-23c | yes | 142 / 151 | 0 / 119 | 0 |
| g5-codex-partB-2026-09-23 | yes | 68 / 78 | 0 / 119 | 0 |
| G6 store | yes | 318 / 408 | 0 / 17 | 0 |

The G5 transcript replays give identical `resolve_element`, `action_chain` and `element_history` `attempts` and `summary`. The only difference is the member entries inside `element_history.actions`, which carry the pointer (rule 3).

## Residual risks (updated)

- **Supersedes the RUN.md residual "the mark trusts the strict frame stack":** a frame left behind now gives no mark instead of a wrong credit.
- **New risk, too few caused marks:** focus caused by code that runs *after* a native suspension (for example a `focus()` after the `for await` loop ends) is left unmarked, because that code runs on a left-behind frame. It then folds as a user focus would, which is the state `main` was in for every focus.
- **Initial-render autoFocus** (grader): runs outside any frame, so it is unmarked and can fold into a later Enter within 1000 ms. This matches rule 3 as written, but it is app-moved focus.
- **Unchanged from RUN.md:** scheduler-committed autofocus is abstained; autoFocus rows have no `element_key`; other nested trusted dispatches (`requestSubmit`) are unmarked (out of scope); member outcome label (`incomplete` plus pointer) is owned by `fix/outcome-labels`; `compare_chains` between a member and its own carrier reports a path change (expected under rule 3); Chromium headless only.

## Housekeeping

The repository ignores `*.jsonl`, so the raw rows cited in `RUN.md` (`runs/`, `runs-r2/`) and `banked-diff.jsonl` were not in the earlier commits: only the `report.json` files were. This commit adds them, and `runs-r3/` and `banked-diff-2.jsonl`, with `git add -f`. They are small (76–100 KB per run).
