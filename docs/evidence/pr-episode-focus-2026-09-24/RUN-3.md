# fix/episode-focus: follow-up after the regrade (2026-09-24)

This file sits beside `RUN.md` (at `2da99996`) and `RUN-2.md` (at `06db4f56`); neither was edited. The regrade section of `GRADE.md` (`8a721ea7`) is "merge with changes", with one blocking item. The fix commits sit on top of `8a721ea7`.

## The blocking item and the fix

**The regrade's finding** (probe `grader-scratch/p14-app.jsx`, Q7):
- `enter` gave a new function frame a fresh live token but took `action_id` from the current frame, even when that frame had been left behind by a suspended `for await` (dead token).
- So a first-party helper, called from an unwrapped `requestIdleCallback` poll armed at page load, credited its focus to the stream click. This happened in 3/3 runs.

**The fix** (`src/runtime-attribution-browser.js`, `dist/` rebuilt, `cmp` identical). A frame now carries `stale_owner` when its action came from a left-behind frame:
- `enter` sets `stale_owner` on the new function frame when its base is a non-dispatch frame with an action whose run token is dead, or which is itself `stale_owner`.
- `continuationOf` copies `stale_owner` from its owner.
- `captureOwner` marks a *copy* of a left-behind frame (the shared frame object is never mutated), so continuations captured from it (a timer or promise armed inside the poll) carry it too.
- `focusCause`: a live frame with `stale_owner` gives `gesture: false`, `caused_by_action_id: null`, `cause_abstained: "stale_frame"`.
- **Ownership is unchanged.** `action_id`, `spine`, continuation ids and request ownership are exactly as before. Only the focus cause reads `stale_owner`. The banked-store dump is byte-identical to `06db4f56`, and the D12 and continuation harnesses pass.

## One pass condition cannot be met: Q6b

**The conflict.** The coordinator's pass conditions say Q6b stays credited (a helper-function focus after a `for await` loop ends). The rule as stated ("when `enter` runs on a non-dispatch frame whose token is dead, the new frame must not pass that frame's action on as a focus cause") makes Q6b abstain.

**Why the two can't both hold.** At run time the two cases are the same state:
- **Q6b:** the click's own async function resumes natively after its `for await` and calls `focusIt()`.
- **Q7:** an unwrapped idle callback calls `focusIt()`.
- **Same state:** in both, `current` is the await continuation the stream click left behind (dead token), and `enter(focusIt)` runs on it. The only difference is which native task resumed JavaScript, and the runtime does not see that.

**The only way to credit Q6b and not Q7.** Mark every unwrapped entry point: `requestIdleCallback`, `ResizeObserver`, `IntersectionObserver`, `MutationObserver`, and listeners registered with no owner (`message`, `storage`, `visibilitychange`, …). That is a list, it would leak for any entry point not on it, and it touches how those callbacks run.

**What I did.** I followed the rule and the doctrine (abstain over guess, wrong credit is worse than abstention). Q6b and my equivalent case (j) now read `gesture: false`, `cause_abstained: "stale_frame"`, not folded. Before this change, Q6b was a credit that happened to be right. I did not build the entry-point list; I'm leaving that for your decision.

## Tests

**Driver** (`test/browser/episode-focus.mjs`, neutral fixture):
- New case (i): an idle-callback poll armed at mount calls first-party `focusField()` while a stream click's frame is left behind.
- New case (i-control): the same poll with no stream open.
- New case (j): the click's own `focusField()` after its `for await` loop ends (Q6b's shape).
- Fixture change: the stream route now flushes headers at once. Without that, the `fetch` stayed inside a rewritten `await` until the first chunk, so no frame was left behind and (i) did not exercise the leak.
- **On the previous head `06db4f56`**, the driver fails at `(i_stream_poll) never credited (got action:mufuftwp:36)`.

**Driver on this head, `runs-r4/report.json`: status ok, 3 runs, stable.**

| case | result, 3/3 runs |
|---|---|
| (a) autoFocus | caused, `microtask` |
| (b) effect focus | caused, `mount_effect` |
| (c) handler focus | caused, `dispatch` |
| (f) scheduler autoFocus | abstained, `scheduler_lineage` |
| (g) Tab during `for await` | unmarked, folds into the Enter |
| (h) Tab during async generator | unmarked, folds into the Enter |
| (d) Tab control | unmarked, folds into the Enter |
| (i-control) poll, no stream open | `no_action_on_frame` |
| (i) poll during a suspended stream | `stale_frame` |
| (j) helper focus after `for await` | `stale_frame` |

For (i), (i-control) and (j): the Enter's episode holds only the Enter, and the stream click's `caused` list is empty in the rows and through MCP `action_chain`.

**The grader's `p14-drive.mjs`, run unmodified with this head as its root, 3/3 runs:**

| probe | result |
|---|---|
| Q1, Q2, Q3 (observer / idle callbacks) | `no_action_on_frame`, unchanged |
| Q4 (`setTimeout(0)`) | caused, `timer`, unchanged |
| Q5 (Tab during a rewritten `await`) | folds into the Enter, unchanged |
| Q6 (native `.focus()` after `for await`) | unmarked and folds, unchanged |
| Q8 (autoFocus and effect focus) | caused, `microtask` and `mount_effect`, unchanged |
| **Q7** (idle poll during a suspended stream) | **`stale_frame`, not credited, not in the click's `caused`** |
| **Q6b** (helper focus after `for await`) | **`stale_frame`** (see the conflict above) |

## Full rerun (this head)

```sh
node test/browser/episode-focus.mjs --out docs/evidence/pr-episode-focus-2026-09-24/runs-r4   # ok, 3 runs, stable
npm test                                                   # 696/697; 1 known failure (react-context-ref-semantics); includes test/episode-focus.test.mjs 5/5
node test/browser/d12-stamp-neutrality.mjs                 # pass, 17/17
node test/browser/continuations-neutral.mjs                # ok
node test/browser/no-cross-control-neutral.mjs             # ok
node test/g4-grader.mjs docs/evidence/m1-2026-09-22-final7 --manifest docs/evidence/g4-mcp-2026-09-23/manifest.json   # 81/81
node test/browser/g6-compare.mjs ... (6 pairs) && node test/g6-grader.mjs ...   # PASS 6/6; compare JSON identical to main
cmp src/runtime-attribution-browser.js dist/runtime-attribution-browser.js       # identical
```

Also exit 0: `effect-rooted-form-neutral`, `shadow-dom-context`, `stable-element-keys`, `worker-frontier`. The banked-store dump (`RUN-2.md`'s `tools-2/`, four stores) is byte-identical to `06db4f56`, so `RUN-2.md`'s banked table stands.

## Residual risks (additions)

- **Too few caused marks after native suspensions.** A focus moved by the action's own code after a `for await` loop or inside an async generator is never credited: `stale_frame` through a first-party function, unmarked through a direct native call (Q6). This is the honest direction.
- **Unwrapped callbacks.** Observers and idle callbacks created by the action abstain (`no_action_on_frame`), as the regrade recorded.
- **Taint is kept on the copy.** A continuation captured from a left-behind frame carries `stale_owner` for its lifetime, including across rewritten `await`s. That can only turn a credit into an abstention.
- **The token window.** A frame left behind is still "live" for the rest of the microtask checkpoint in which it was made current. No focus path using that window was found, but none is proven absent.
