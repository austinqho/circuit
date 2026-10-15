# Trusted user events (D-G1-21): RUN (2026-09-24, branch `fix/trusted-events`, base `main` f9a925d7)

The implementer wrote this file. It is not a grade.

**Claim.** Every trusted user event on the page is recorded as an action row with its full description, and the runtime can prove which event kinds it observes.

**Rule text.** `docs/gates/G1-frontend-only.md`, section D-G1-21.

**Code.**
- The model is `analysis/user-event-model.mjs`: discovery, what is recorded, phase and gesture. `scripts/build.mjs` inlines it into `src/runtime-attribution-browser.js`.
- The runtime is `src/runtime-attribution-browser.js`, with its byte-identical copy in `dist/`.
- Episodes are in `analysis/runtime-attribution.mjs`.
- The MCP code is `collector/store.mjs` and `mcp/tools.mjs`.

## Mechanism, in one paragraph each

**Discovery.** At install the runtime reads every `on*` accessor that has a setter on `Element.prototype`, `HTMLElement.prototype`, `Document.prototype`, `Window.prototype` and `window`. It adds five kinds that the platform dispatches but has no handler property for: focusin, focusout and the three composition events. It registers one passive capture listener per kind at the window, and the same set in every shadow root. In this Chromium that is 142 discovered kinds plus 5 supplemented, 147 in all. They are listed in `capture.page.user_events.listened`, and `sources` gives the count from each prototype. The decision to record is made per dispatch:
- the event must be trusted, and
- it must be an instance of `UIEvent`, `ClipboardEvent`, `SubmitEvent`, `ToggleEvent` or `CommandEvent`, or a plain `Event` whose kind is in `user_plain_kinds`.

Trusted events that are not user events are counted per kind in `capture.summary.user_events.not_user_by_kind`. In these runs those were `load`, `readystatechange`, `pageshow`, `deviceorientation` and similar. Untrusted events are counted in `untrusted_skipped` and are never recorded.

**Coalescing rule.** Interface properties decide whether a kind is continuous:
- PointerEvent `button === -1` with `buttons` unchanged;
- MouseEvent with `detail 0` and buttons unchanged;
- any WheelEvent;
- touchmove, where `touches.length` is unchanged;
- keydown with `repeat`.

A name list (`continuous_kinds`) decides only where no property does: scroll, selectionchange, drag, dragover, dragenter and dragleave. Unknown kinds are discrete.

For each (kind, control, gesture) there is one `dom.action` with `coalesced: true`. Every event in the range runs under that action's dispatch frame. One `dom.action.range` row closes the range, with `count`, first and last timestamp, `bounds`, wheel deltas and the first and last scroll position. A range is closed by the next top-level discrete event, a summary, or `pagehide`.

**Gestures.** A gesture opens at a press on a device that holds nothing and closes at the release that leaves the device holding nothing. Pointers are keyed by pointerId and keys by `code`. Events that are neither a press nor a release take the held gesture. If none is held, they take the gesture released in the current task, which is how a click joins its own pointerdown and pointerup.

## Results at 7dd508c5 plus this commit (all headless)

| run | result | file |
|---|---|---|
| `npm run build`, `cmp` src/dist | identical | `runs/build.txt` |
| `npm test` | 700 tests, 699 pass, 1 known failure (`react-context-ref-semantics`) | `runs/npm-test.txt` |
| **trusted-events driver**, 3 invocations × 3 page loads, then a final invocation after two driver-only fixes (null-safe reads, report printing) | **73/73** each | `runs/trusted-events-{1,2,3,final}.txt` |
| episode-focus, 3 runs | ok ×3 | `runs/episode-focus-{1,2,3}.txt` |
| continuations-neutral (5 page loads) | ok | `runs/continuations-neutral.txt.gz` |
| outcome-labels | 160/160 | `runs/outcome-labels.txt` |
| mcp-gaps | 35/35 | `runs/mcp-gaps.txt` |
| body-capture | 51/51 | `runs/body-capture.txt` |
| shadow-dom-context | ok | `runs/shadow-dom-context.txt` |
| no-cross-control-neutral | ok | `runs/no-cross-control-neutral.txt` |
| D12 stamp neutrality (A, B, C, D) | 23/23, byte-identical | `runs/d12.txt` |
| G4 grader (final7) | 81/81 | `runs/g4.txt` |
| G6: `g6-compare.mjs`, 6 pairs, regenerated on the banked store with main's and this branch's code, then `g6-grader.mjs` | 6/6 PASS. The compare output directories of main and branch are identical | `banked/g6-grade.md`, `banked/g6-compare-diff.txt` |

**Negative control.** The driver was run with main's runtime (f9a925d7) copied into `dist/`. Afterwards `dist/` was rebuilt, and `cmp` confirmed src and dist are identical. Result: **3/25**, in `negative-control/runtime-main-f9a925d7-driver.txt`.

On main, these requests have no owner: `/api/choice?value=banana` (Radix pointerup), `/api/drag` (pointerup), `/api/more` (scroll), `/api/pasted` (paste) and `/api/details?open=true` (toggle), plus the untrusted Ping, which is unowned by design. The shortcut is recorded as `{ key: "Printable" }`, with no code and no modifiers.

One exam defect does not reproduce on main here. With a real file path, Chromium dispatches the file input's `change` as trusted, so main already recorded it and it owned the upload. The case in the defect report cannot be reproduced from a file path; see residual 1. What this branch adds for that flow is the `opened_by_action_id` link to the Upload click, plus `files` (count and types).

## Who owns each request in the fixture (identical in all 3 page loads, every invocation)

| request | owner row |
|---|---|
| `/api/choice?value=banana` | `pointerup` on the portal `role=option` (Radix selects on pointerup). The trigger's `pointerdown` is recorded |
| `/api/archive` | `click` on "Confirm archive" |
| `/api/dialog-dismissed` | `keydown` Escape |
| `/api/drag` | `pointerup` on the canvas (phase release). Its gesture holds pointerdown (buttons 1), `gotpointercapture` and one pointermove range (count 8, x span 88 px) |
| `/api/upload` | trusted `change` on the hidden `input[type=file]`: `files {count: 1, types: [text/plain]}`, `opened_by_action_id` = the Upload click |
| `/api/shortcut` | `keydown` with `{key: "K", code: "KeyK", ctrlKey: true, shiftKey: true, metaKey: false, altKey: false}` |
| `/api/more` | coalesced `scroll` range on the feed. Its close row shows the scroll passing 150 px |
| `/api/pasted` | `paste` (ClipboardEvent, `clipboard.types`) |
| `/api/details?open=true` | `toggle` (ToggleEvent, `closed → open`) |
| `/api/size?value=l` | `change` on the native `<select>` (type-ahead; see the note on untrusted events below) |
| `/api/ping` (first) | trusted `click` |
| `/api/ping` (second) | none: an untrusted `dispatchEvent` click. No row is recorded, and `untrusted_skipped` counts it |

**MCP over stdio.** The `action_chain` line for the pointerup reads `pointerup action:… (mouse pointer 1, button 0, buttons 0; phase release on <canvas aria-label="Board">)`. The keyboard detail is `Ctrl+Shift+K in <button type="button">` (the focused element), with modifiers `[Ctrl, Shift]`. The change carries the opened-by sentence, and the Upload click's chain lists it under `opened`. `page_requests` totals equal the raw rows, with exactly one request not attributed to an action. `recent_actions` reports `context_omitted > 0`, and `include_context: true` lists those actions.

**Volume, per page load of this short session.** 619 rows in all: 284 `dom.action` rows (158 discrete, 126 ranges) and 147 coalesced events. Most ranges are one-event hovers (pointerover and mouseover on each element the mouse crosses). The drag's move range coalesced 8 events into one row. Main records 45 `dom.action` rows for the same session (negative-control store).

## Attribution changes on banked stores

No banked store changes attribution. MCP output from main f9a925d7 and from this branch was compared over every `action_chain`, `recent_actions`, `page_requests` and `element_history` call, over stdio, on four stores:
- final7;
- the G6 store;
- g3-2026-09-23e (stamped, with 8 element keys);
- g2-anything-llm r4.

Rendered text is identical for 599 of 599 calls. Structured output differs only by the added field `context_omitted: 0`, in 4 `recent_actions` calls and 8 `element_history` calls. Details and scripts are in `banked/main-vs-branch.txt`, `banked/mcp-all.mjs` and `banked/diff.mjs`.

## Changes in live runs, every one listed (previously unrecorded events that now own work)

- **continuations-neutral, `/api/pre-armed`.** A document `pointerdown` listener arms a timer, and the timer sends this request. Before, it was unattributed. Now it is owned by the recorded pointerdown in the click's gesture, and never by the click. The assertion was updated to say exactly that.
- **shadow-dom-context, `/api/ping-down`.** A `pointerdown` listener re-added under Bump sends this request. Before, it was unattributed. Now it is owned by the recorded pointerdown, never by Bump.
- **shadow-dom-context, `/api/focused`.** A `focus` listener re-added under Bump, which `el.focus()` inside a click triggers. Before, it was owned by the click. Now it is owned by the recorded `focus` action, which is marked `gesture: false`, `caused_by_action_id` = that click. It is listed in the click's episode under `caused`, because it carries evidence.
- **shadow-dom-context, stat assertion.** `owned_listeners_ui_unowned >= 1` became `owned_listeners_dispatch_won >= 2`: every recorded UI event now starts an action.
- **continuations-neutral, shortcut lookup.** Control+m is now recorded as `key: "m", ctrlKey: true` instead of `"Printable"`, so the test finds it by key and modifier. The abstention assertions are unchanged.
- **outcome-labels.** Gesture-context rows that no episode holds are left out of `recent_actions` and `element_history` by default. The every-action agreement check therefore compares the other surfaces for those rows (action_chain, display, chain outcome, compare_chains, export). All other rows compare every surface, as before.
- **no-cross-control-neutral.** "Every action on the add form is one episode" now reads: every episode-kind action is in that one episode, and no other row on the form is in a different episode.
- **D12 harness.** Keys are pressed as keydown, settle, keyup, settle, as clicks already were. Without that, the browser's queued `selectionchange` races the keyup and the row order differs from run to run.
- **Mutation receipts in live runs.** A receipt window now also ends at the next top-level user dispatch. Before, a keydown's receipt also counted the mutations of the `input` that followed in the same task. It no longer does. No graded assertion changed.

## Residual risks

1. **Untrusted input is not a user event.** Playwright's `setFiles` with buffers, and `selectOption`, dispatch untrusted `input`/`change`. Those are not recorded, and their requests stay unowned. A real user's choice is trusted. The fixture uses a file path and type-ahead so that it drives trusted events.
2. **Lists that remain.** Four lists are data in one module:
   - `user_plain_kinds`: plain-Event kinds that have no interface of their own;
   - `continuous_kinds`: kinds where no property says continuous;
   - `handlerless_kinds`: kinds that are not discoverable;
   - `episode_kinds`: the six kinds the G5 rules were written for.

   A user kind that is neither discoverable nor in `handlerless_kinds` is not observed. `capture.page.listened` is the proof of what was observed.
3. **Typed text.** `data` of InputEvent and CompositionEvent is recorded, except in password and credential fields. Printable keys are still folded unless Ctrl, Alt or Meta is held. Named keys (`ArrowDown`, `Backspace`) are now recorded by name, where they used to read `"Other"`. This is a privacy decision for the owner.
4. **Volume and overhead are unmeasured on long sessions.** Hover ranges are per element. Each discrete event creates a MutationObserver window, as clicks already did. There are 147 capture listeners, all passive.
5. **Gesture bookkeeping.** "Released in the current task" ends at a host `setTimeout(0)`, which is a task boundary, not a clock. A release lost while the window keeps focus leaves the key or pointer held until blur or hide.
6. **`opened_by` link lifetime.** The link lasts until the user presses or activates the element directly, or until another synthetic click replaces it.
7. **Caused context rows without evidence.** A caused blur or focusout that carries no evidence is listed in no episode. It stays in the raw rows.
8. **Realms.** iframes and workers are not observed.
9. **Grader independence.** The negative control and the banked comparison were run by the implementer. An independent grader should rerun both.

## Files

| file | sha256 / note |
|---|---|
| `store/records.jsonl.gz` | `518e76a894c8bc32a93adb65eb1882523918a1e1c8ff99e8ed7f8ef178dad3bd`, 1,857 rows, 3 page loads (the `trusted-events-final` invocation) |
| `store/runs.jsonl` | run label |
| `runs/*` | driver and suite outputs listed above |
| `negative-control/runtime-main-f9a925d7-driver.txt` | 3/25 with main's runtime |
| `banked/*` | G6 grade, g6-compare diff, main-vs-branch MCP comparison and its scripts |
