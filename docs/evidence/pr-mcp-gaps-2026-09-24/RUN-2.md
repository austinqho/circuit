# fix/mcp-gaps: run record 2 (after the grade, 2026-09-24)

These commits sit on top of `1fba0319` (the grader's `GRADE.md`, verdict "merge with changes"). RUN.md stays as written; `ERRATA.md` corrects it.

## Changes, one per required item

1. **"after response N" is now an identifier, not a clock comparison.**
   - **Runtime (`src/runtime-attribution-browser.js`, `dist` rebuilt, `cmp` identical):**
     - The `fetch` wrapper maps the promise it returns to the request's `request_occurrence_id`. The patched `Promise.prototype.then` passes that id to the reaction's continuation and maps the derived promise too, which covers `catch`/`finally` and chains.
     - `await` on such a promise sets it on the resumption.
     - `load`/`loadend`/`readystatechange`/`error`/`abort`/`timeout` listeners added with `addEventListener` on the `XMLHttpRequest` that sent the request run with it.
     - Frames and continuations created inside inherit it, at creation, like ownership. It never gives an owner.
     - `function.enter` gains `response_of` (only when set).
   - **MCP:** `work.entries[].after_response` is set only when a frame's `response_of` equals a segment's occurrence id.
   - **Not recorded, so never marked:** a promise the page wraps itself (`new Promise(r => fetch(u).then(r))`), `xhr.onload =` properties, and the request-bridge path.
   - **Older stores** (rows without `entry`) get `ordered_after_response` / `ordered_after_request`, rendered `ordered after the response 409; not linked: <fn>`. G4 states both skew directions and the unrelated-continuation case as the grader wrote them.
   - **Fixture:** `onLike` now also runs `wait(250).then(noteDelay)`, a sibling that runs after the response but is not chained on it. `noteDelay` has no `response_of` and gets no mark (W1b, W2b).
2. **The issuer never says "uninstrumented" without a recorded limit.**
   - An empty `function_ids` renders `no first-party frame recorded for this request (issued outside any action)`.
   - `function_ids` and `armed_by` collapse consecutive repeats, so a frame is never "called from" itself.
   - The await rewrite now keeps, outside an action, the action-less first-party frame and the unowned task origin across the resumption. It was cheap and safe: neither is ownable (`action_id` null), and owned paths are untouched.
   - **Fixture:** `refreshAfterTick` (`await Promise.resolve(); fetch('/api/refresh')` in a page-load `setInterval`) is named: `issued by refreshAfterTick client/src/main.jsx:23 from a setInterval timer armed at page load …` (P7, P8).
3. **Recursion.**
   - The doubled enter was not proxy + body. The chunk pass re-frames a leaf body that the module pass already framed: `enter(4,{…});try{ const __ptFrame3 = …enter(4, {…})` in the built chunk.
   - The chunk pass now passes `pass: "chunk"` in that `enter` metadata (`integrations/runtime-attribution.mjs`, option `framePass`). The runtime writes `function.enter.entry`: `call` (proxy), `chunk` or `body` (module pass).
   - An enter nested directly under an earlier-ranked enter of the same function is the same call. Anything else counts, recursion included.
   - **Fixture:** `factorial(5)` writes 10 enter rows (5 `chunk` + 5 `body`) and renders `factorial client/src/main.jsx:28 ×5 (recursive)` (W10, W11).
   - Rows without `entry` (older stores) that show a run of three or more of the id render `(N enter rows; repeated or recursive calls are not separable)`. Neither banked store has such a run (0).
   - The duplicate chunk-pass framing itself is left as is (not this claim). Removing it would change row counts in every store.
4. **`ERRATA.md`** corrects RUN.md residual 1: real builds render names; `<unnamed>` came from the `fixture-build.mjs` harness. It also lists every role-only `not_found → ambiguous` flip:
   - final7: `{role:"button"}` 0→4, `{role:"textbox"}` 0→7, `{role:"form"}` 0→3, `{role:"button", name:"Save"}` 0→4;
   - G6: `{role:"button"}` 0→5, `{role:"textbox"}` 0→3, `{role:"button", name:"Save"}` 0→5.
5. **Privacy line** in the G4 amendment and the skill: query strings are recorded and printed as sent, tokens included. The request bridge and worker script URLs still strip the query (the paths disagree; the bridge is unchanged here).

G4 carries a second dated amendment that supersedes the matching bullets of the first. The skill explains the new marks.

## Counts (all rerun after the changes)

| Check | Result |
|---|---|
| `node test/browser/mcp-gaps.mjs` | **32/32** (was 26; added W1b, W2b, W10, W11, P7, P8; W1 now asserts `response_of`) |
| `npm test` | 692 tests, 691 pass, 1 fail (known `react-context-ref-semantics`) |
| `node test/browser/d12-stamp-neutrality.mjs` | pass: true, 17/17 |
| `node test/browser/continuations-neutral.mjs` | status ok |
| `node test/g4-grader.mjs docs/evidence/m1-2026-09-22-final7 --manifest docs/evidence/g4-mcp-2026-09-23/manifest.json` | 81/81 |
| `g6-compare.mjs` (6 pairs) + `node test/g6-grader.mjs <g6store> --compare <out>` | PASS 6/6 |
| worker-frontier, shadow-dom-context, stable-element-keys, no-cross-control-neutral, effect-rooted-form-neutral | exit 0 (all five) |
| unlinked-coverage-neutral | 12/13, A8 only (pre-existing; identical on `main`) |
| `npm run build` + `cmp src/… dist/runtime-attribution-browser.js` | identical |

## Banked diffs against `main`

Files: `diff-2-final7-source-root.txt`, `diff-2-final7-no-source-root.txt` and `diff-2-g6.txt`. Method and tools are the same as RUN.md (`bank-run.mjs`, `bank-diff.mjs`).

Against `main`, the change set is RUN.md's list plus `work.entries[].enter_rows`. `stops`, frontiers, outcomes, `chain`, `recent_actions` and `compare_chains` verdicts are unchanged. The first summary line is unchanged on 54/54 (final7) and 100/100 (G6).

Against this branch's previous head, only these changed:
- **G6:**
  - 63 `after_response` marks became `ordered_after_response`: the old rows carry no `entry`/`response_of`, so only the clock order is shown, now worded as such;
  - their 63 summary lines;
  - the `work_summary` of 130 actions and 55 attempts;
  - `enter_rows` added on 2,892 entries;
  - the `page_requests` interval wording.
- **final7:** only `enter_rows` (2,553 entries) and the `page_requests` interval wording. It has 0 marks of either kind and 0 inexact counts.

The G6 keystroke `element_history` still exceeds the SDK client's 10 MB buffer, on `main` too (1 call, identical on both).

## Residual risks (added or changed)

- `response_of` is inherited by everything created inside a response continuation, including state-receipt effects triggered by a `setState` there. Those are marked only when they are the topmost frame of their path under the requesting lineage. Their descendants are suppressed.
- The chunk-pass double framing is still in every build. It is now labelled (`entry`), not removed.
- The rules for older rows (clock order, recursion guess) remain for stores recorded before this change. They are worded as order and "not separable".
- The await-rewrite change carries an action-less frame across resumptions outside actions. It is never ownable, but rows emitted while it is current (none today outside actions, since action-less function rows are not written) would read it as their parent continuation.
