# Trusted user events: RUN-3 (2026-09-24, the nine required changes from GRADE.md)

This file adds to `RUN.md` and `RUN-2.md`; neither was edited. The implementer wrote it; it is not a grade.

- **Code head:** 0a2d248b, on top of the grader's 1312f427. Base `main` f9a925d7, before the rebase.
- **Rule text:** G1 D-G1-21a.
- **Unchanged rule:** every trusted user event is recorded; lists classify, never decide.
- **Main-side comparisons:** "main" below is a `git archive` of f9a925d7, not the moving `main` checkout.

## The nine items

| # | grade item | change | proof (driver `test/browser/trusted-events.mjs`, 118/118 ×3) |
|---|---|---|---|
| 1 | Alt/AltGr leak | A printable key is recorded as pressed only when Ctrl or Meta is held without Alt and without `getModifierState('AltGraph')`. Every other printable key folds to `Printable` unless `inputText` is on. | **S2**: trusted CDP keys `å` (Alt) and `@` (Ctrl+Alt) in a text field read `Printable` for both key and code, and neither character appears in any `key`. **S1**: Ctrl+Shift+K is still recorded as `K`/`KeyK`. |
| 2 | pagehide loss | Ranges close as they go: at their gesture's release, at another gesture's discrete dispatch, at 1,000 events, or after 1 s idle. The collector sink ships `capture.summary` in its own first pagehide beacon. | **V1**, hover-heavy page (240 cells, 10-row sweep): the summary arrives, every sequence up to it arrives, and per kind the close rows count the summary's coalesced events exactly (3/3). |
| 3 | hover volume | Hover and wheel are one range per pointer segment, across controls. A per-(kind, control) `dom.action` is written only when a row carrying its action id is emitted (work ran under it), and is listed in `with_work`. | **V2**: 74 rows, 60,872 bytes, 6 `dom.action`, 6 ranges (5 hover segments split at the 1,000-event bound) for 4,733 coalesced events. The graded head had 1,405 `dom.action` and 1.37 MB. **W3**: hover segments span several controls, and every per-control row has work. **W4**: the card's `onMouseEnter` prefetch is owned by the per-control row it ran under (the `mouseout` whose `related_target` is the card, which is where React dispatches enter), listed in `with_work`. **W2**: the four wheel ticks are one range. |
| 4 | `opened_by` lifetime | Only non-UIEvents (a picker's input/change/cancel) carry the link. Any trusted UIEvent on the element that live action code did not dispatch clears it. The synthetic click's own trusted `DOMActivate` is caused, so it does not clear the link. | **L1**: after Open B's synthetic click, the user tabs onto Target B 2 s later. No row carries `opened_by`; on 53eb8882, 8 rows did. **U1**: the file input's change still carries it. |
| 5 | gesture ids | Separate pointer and key tracks: click, mouseup, contextmenu and auxclick take their pointer's gesture (held, or released in this task), never a held key's. Boundary kinds never press or release. One touch contact's pointer, touch and compatibility mouse events share a gesture (`sourceCapabilities.firesTouchEvents`). HTML drag events carry the gesture the drag started in. A release names the control its gesture was pressed on (`dispatch_detail`). | **G1**: on Shift+click, click and mouseup share the pointerdown's gesture, not Shift's. **H1**: a touch tap's pointerdown and touchstart are `press`, its pointerup and touchend are `release`, and all its rows (compatibility mouse events and click included) share one gesture. **G2**: every DragEvent carries the dragstart's gesture, and the drop owns `/api/drop`. **D3**: gotpointercapture is never a release. |
| 6 | lists deciding | Inverted. A trusted event of a listened kind dispatched in the document is a user event unless `not_user_interfaces` or `not_user_kinds` classifies it; unknown kinds are recorded. Not-user events leave `dom.event` rows (`user: false`, own `event_sequence` counter, first per kind and target, all counted). `textInput`, `DOMActivate`, `DOMFocusIn` and `DOMFocusOut` are listened. | **N1**: popstate after Back, hashchange and invalid own `/api/popstate`, `/api/hash` and `/api/invalid`. **N2**: React `onBeforeInput` work is owned by `textInput`. **K3**: `dom.event` rows exist, and none is an action. |
| 7 | MCP surfaces | `coverage.user_events` on `action_chain`, `recent_actions` and `element_history` carries listened kinds and counts (recorded, coalesced, untrusted skipped, not user); `page_requests` has `user_events`. An action whose window holds a skipped untrusted event followed by a request gets the coverage reason "an untrusted (synthetic) event was skipped in this window …". An unowned request after one says so in `page_requests`. `coverage.unobserved` was left alone (see "Rebase", below). | **M6**: the Ping click's coverage has `user_events` equal to the raw rows, plus the reason. **M7**: `page_requests` names the skipped untrusted click on the unowned Ping. |
| 8 | hidden evidence | `context_omitted` never hides a row that owns evidence (request, mutation, worker post). A dispatch caused by live code runs on the **causing** action's frame (`runs_on_action_id`), so its listeners' work is the click's, as on main. A chain line names the requests of the events its action caused or opened. An action whose only requests came from a control it opened reads outcome `opened`, never `no_request`. | **F1/F2/M5**: `el.focus()` → `/api/native-focused` and `requestSubmit()` → `POST /api/submitted` are the click's and appear in its chain. **M3**: the Upload click's outcome is `opened`, and its line reads `this action opened change … → POST /api/upload`. **M8**: no omitted row owns a request. `shadow-dom-context` `/api/focused` is back on the click, as on main (its RUN.md amendment is reverted). |
| 9 | driver robustness | Every check is a guarded predicate. The driver runs to completion on any runtime. | **Negative control** (f9a925d7 runtime in `dist/`, then rebuilt; `cmp` identical): 5/44 over 1 load, listed below. |

## Should-fix items

- **Done: drag start named.** A release names the control where its gesture was pressed.
- **Done: `observedEventKinds`** is now used by the store for `coverage.user_events`.
- **Not done: key auto-repeat in a text field** is still count-1 ranges. The following keypress and input are discrete events of the same gesture, so they no longer close the range. It now closes at keyup, which is its own gesture's release. It was not re-measured.

## Other changes this required

- **Mutation receipts.** A receipt is written when it stops (at the next top-level dispatch or at its timer), as on main. A validation window (a submit's 750 ms, or a dispatch the browser is about to validate) is not stopped by a pointer move or by a dispatch of its own gesture, so `invalid` events and the focus move after a rejected click stay in the click's receipt.
- **Windows.** An action's window closes at the next discrete, non-caused dispatch outside its own gestures. This applies to unlinked evidence and untrusted-skip reasons. Before, a click's own `mouseup` or `DOMActivate` closed its window. Older runtimes are unchanged: any dispatch closes the window.
- **D12 harness.**
  - `dom.event` rows are compared as a multiset, because page-lifecycle events arrive in network order on their own counter.
  - Stamp keys are stripped from a range's `first_control`/`last_control`, as they already are from `target`.
- **mcp-gaps harness.** The failure printer is now null-safe.

## Results at 0a2d248b (all headless)

| run | result | file |
|---|---|---|
| build, `cmp` src/dist | identical | `runs-3/build.txt` |
| `npm test` | 700 tests, 699 pass, 1 known failure | `runs-3/npm-test.txt` |
| trusted-events driver: 3 invocations × (3 loads + touch + hover-heavy + 2 inputText builds) | **118/118** each | `runs-3/trusted-events-{1,2,3}.txt` |
| negative control (f9a925d7 runtime) | **5/44**: R0, X2, P1, L1 (vacuous: that runtime writes no `opened_by`) and M5 (main already put that caused work on the click) | `negative-control-3/` |
| episode-focus | ok ×3 | `runs-3/episode-focus-*.txt` |
| continuations-neutral, shadow-dom-context, no-cross-control-neutral | ok | `runs-3/` |
| outcome-labels | 160/160 | `runs-3/outcome-labels.txt` |
| mcp-gaps | 35/35 | `runs-3/mcp-gaps.txt` |
| body-capture | 51/51 | `runs-3/body-capture.txt` |
| D12 | 24/24 (the new check: lifecycle rows equal as multisets) | `runs-3/d12.txt` |
| G4 | 81/81 | `runs-3/g4.txt` |
| G6 | 6/6; `g6-compare` output identical to f9a925d7's | `banked-3/` |
| banked stores, f9a925d7 vs this head (the grader's `banked.mjs`, over stdio) | final7 100/100, g3e 96/96, g2r4 112/112, g6 472/472. Text and structure are identical; the only differences are the `include_context` calls, which f9a925d7 rejects | `banked-3/main-vs-branch.jsonl` |

## Hover cost, re-measured

Measured with the grader's `perf.mjs`: CDP script time over a 10-row, 1,250-move sweep, 2 invocations × 3 reps.

| build | hover (plain divs) | hoverbtn (200 buttons with a first-party `onMouseEnter`) |
|---|---|---|
| bare | 36–56 ms | 35–57 ms |
| f9a925d7 instrumented | 43–62 ms | 43–65 ms |
| this head | 95–263 ms (median about 120) | 151–290 ms |
| graded head 53eb8882 (GRADE.md) | 206–262 ms | not reported |

Volume is fixed: rows fell from 1,405 to 6 `dom.action`. Script time is **not** back to main's.

- On plain divs, the remaining cost is per event: about 7 events per move, each classified, given a dispatch frame and counted. On main no frame was made.
- On hoverbtn, every `onMouseEnter` call now runs under a hover action. It therefore writes `function.enter`/`exit` rows, where main dropped them as unowned. This is the per-control-row-with-work rule doing what it says.

This is a residual.

## Fixture volume (one main-script load, which is now longer)

879 rows: 450 `dom.action` (385 discrete, 65 coalesced) and 64 range closes, 23 of them hover segments. The discrete count grew mainly because `DOMActivate`, `DOMFocusIn`/`Out` and `textInput` are now recorded: one `DOMActivate` per click, for example.

## Residuals (updated)

1. **Hover script time** is 2–5× main's (see above).
2. **Per-click volume.** A click now also writes `DOMActivate`, and focus changes write `DOMFocusIn`/`DOMFocusOut`. They are discrete rows; they fold into the click's gesture as context, and listings omit them unless they own evidence.
3. **Classification lists** (`not_user_interfaces`, `not_user_kinds`, `handlerless_kinds`, `continuous_kinds`, `boundary_kinds`, `episode_kinds`) are data in one module. A new lifecycle kind that no list names is recorded as a user event. That errs toward recording.
4. **`with_work`.** A hover row is written only when a row carrying its action id is emitted. A listener that runs only uninstrumented code and makes no request leaves no per-control row. The segment still counts the event.
5. **Idle and size bounds** (1 s, 1,000 events) split range emission by a clock and a count. They never merge ranges, and never change what owns work within one event's dispatch. Work under a later event after a split belongs to the new range.
6. **Untrusted `setFiles` and `selectOption`** still leave requests with no user action. They now say so (`dom.untrusted`, coverage reasons, `page_requests` text).
7. **Privacy** is unchanged from RUN-2: the lengths of typed text and named keys are recorded. Credential-field redaction is by type and autocomplete only (grade §7).
