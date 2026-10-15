# Handler binding: RUN-2 (2026-09-24, after the independent grade)

The implementer wrote this file. It is not a grade. `RUN.md` and `GRADE.md` are unchanged.

**Graded head:** 9e6bc610; the grade was committed as 41196186 ("merge with changes").
**Base:** unchanged, `origin/fix/trusted-events` 53eb8882. The branch has not been rebased onto main 3123791c, as instructed.
**Commits on top of 41196186:**

| commit | what it does |
|---|---|
| 5f707807 | runtime: holder by observation; `handler.via_library`; untrusted invocations |
| d8522fc1 | analysis and MCP |
| 4517c5dc | fixture cases 15–23 |
| cdda6357 | G1 amendment and SKILL |
| 412d4363 | holder identity fix and driver R6 |

The rule text is in `docs/gates/G1-frontend-only.md`, "Amendment to D-G1-22 (2026-09-24, after the independent grade)".

## The five required changes

### 1. Prop and holder by observation, never by prop order

The build now passes a handler's first argument to `enter()` as `a0`. This happens when the function's first parameter is a plain identifier. A function behind the call proxy (one with a nested function) passes its first call argument whether or not it declares a parameter.

The runtime reads `a0` only while React's own dispatch is invoking, and never stores or emits it. When `a0` is React's SyntheticEvent for the dispatching native event (`nativeEvent === event`), two fields decide the holder:
- `_reactName` is the prop React invoked;
- `currentTarget` is the host holding it.

The row then gets `holder_resolution: "synthetic_event"`. Without that evidence:
- when React is the invoker, only host holders are candidates;
- a single candidate is `"unique"`;
- one prop passed down through component props is `"passed_down"`;
- anything else is `"ambiguous"`: `ambiguous: true` with every holder under `holders`, and `prop_name` null (or the one shared prop name).

A function React runs on two holders in one dispatch writes one row per holder.

**New fixture cases.**

| case | result |
|---|---|
| (15) `onKeyDown={h} onClick={h}`, `h` a leaf with no parameter | ambiguous, both props listed; never "onKeyDown on click" |
| (16) the same, `h` takes the event | mouse click binds `onClick`; Enter's keydown binds `onKeyDown` |
| (17) `onPointerDown={s} onClick={s}`, `s` sends, leaf | ambiguous on pointerdown and on click; the click credits `s`; no "[bound: onPointerDown on click" |
| (18) target `onMouseDown={h}`, ancestor `onClick={h}` | click binds the div's `onClick`; mousedown binds the button's `onMouseDown` |
| (19) target and ancestor both `onClick={h}` | two rows, button then div |

**Rerun of the grader's own probes against this head** (`grader-scratch/probe*-driver.mjs`; outputs in `probes-2/`):
- (d) click → `onClick`, holder `button@0`, `also_held_by` `onKeyDown`; Enter keydown → `onKeyDown`; Enter's click → `onClick`. The grader's `h` has a nested function, so it goes through the call proxy and resolves.
- (d3) pointerdown → `onPointerDown`, click → `onClick`.
- (e2) click → the div's `onClick`, mousedown → `onMouseDown`.
- (e) two rows.

**A defect found and fixed during this round** (412d4363). The first full run of this round showed 24 ambiguous rows where 9 were expected. An inline arrow written in a prop matched that prop twice, once as `prop_value` and once as `written_in_prop`, and was counted as two holders. A holder is now one (prop, fiber).

That run's outputs were superseded, and the whole suite was rerun on 412d4363. The new driver rule R6 checks that every ambiguous row lists at least two distinct (prop, holder) pairs, and that the single-prop inline handlers are resolved.

### 2. An observed-bound frame outranks an unbound one

When a frame observed bound to the dispatch ran, the credit is a bound frame: the first bound frame that owns the evidence, else the first bound frame. This holds even when an unbound depth-zero frame, such as a document capture listener posting analytics, owns the request. The credited entry carries `unbound_request_issuers`. `action_chain` prints "Requests issued by a frame not bound to this element (a global listener or library-called code), not by the credited handler: …".

- **Fixture (20):** `track` is a document capture listener that posts `/api/analytics` for clicks in its section. Save real credits `onSaveReal`, and State only credits `onStateOnly`. `track`'s request is owned by the same click and listed as unbound.
- **Grader probe (o):** `o-real` credits `onSaveReal` and `o-state` credits `onStateOnly`.
- **Base 53eb8882** credits `track` for Save real, and also for the Dual send click (`negative-control/base-53eb8882-driver-2.txt`).

### 3. An honest abstention when library code called the app's function

The runtime writes `handler.via_library` for a first-party function that meets all of these:
- it entered at depth zero for the dispatch;
- no prop holds it;
- it was called neither by a document nor by a window listener. It was called by a library's prop handler that React invoked, by a library's listener on an element, or in a bare continuation of the dispatch.

When no bound handler ran, the abstention reads: "no element-bound handler of instrumented code ran; ran through library code on the element chain (not bound to an element prop Tracer can see): [ids]; global listeners: [...]". It carries `stop_reason: "handler_via_library"` and `ran_via_library`. Those functions are never listed as global listeners.

- **Fixture (21):** real react-hook-form 7.85, `handleSubmit(onValid)` with a named `onValid` (probe b1).
- **Fixture (22):** a vendor component that calls a `callback` prop (probe i').
- The grader's probes b1 and i' give the same sentence on this head.
- The SKILL.md gloss that said "the only functions that ran were global listeners" is replaced.

### 4. `el.click()` and `dispatchEvent` from app code

An untrusted dispatch opens no action frame. When a first-party function held by the untrusted event's target chain runs during that dispatch, and React or an element listener is invoking, the runtime writes one `handler.invocation` per (event, function). The row carries:
- `untrusted: true`, `invoked_by: "app_code"`, `ran: "during_untrusted_dispatch"`;
- the holder resolution from change 1;
- `action_id` and `caused_by_action_id` set to the calling frame's action, or `cause_abstained`.

The row is listed on the causing action's chain ("untrusted: el.click() or dispatchEvent"). It is not joined to the clicked element's key, and it is not counted as a binding.

- **Fixture (23):** a timer armed by the Schedule click calls `target.click()`, and a mount timer does the same. The first gives an invocation caused by the Schedule click, which also owns the request. The second gives `cause_abstained: "no_action_on_frame"`.
- **Grader probe (h):** the Schedule click's rows include the invocation.

### 5. Corrections to RUN.md

These are corrections only; RUN.md itself is not edited.

- **RUN.md residual risk 3 is withdrawn for react-hook-form 7.85.** It said "a native `await` inside uninstrumented library code loses the link"; G1's "Not covered" item 3 said the same. With RHF's native `async`/`await`, an inline callback's binding survives as `dispatch_continuation, via: written_in_prop` (grade probe b3, reproduced in `probes-2/probe2-branch2.json`). The statement still holds for a library that schedules through a channel the runtime does not wrap. None is known.
- **RUN.md was incomplete on one point.** At 9e6bc610, when the same function ran on the target and on an ancestor, one row was written and the ancestor's invocation was folded into it. That is fixed where the synthetic event is available: one row per holder (fixture 19, probe e). When it is not available (a leaf handler with no parameter), the invocations in one dispatch are one ambiguous row.

## Results (head 412d4363; all headless; `runs-2/`)

| run | result |
|---|---|
| `npm run build`, `cmp` src/dist | identical |
| `npm test` | 700 tests, 699 pass, 1 known failure (`react-context-ref-semantics`) |
| **handler-binding driver** (3 page loads each), 3 invocations | **127/127** each |
| negative control, base 53eb8882, same driver and fixture | 19/127 (`negative-control/base-53eb8882-driver-2.txt`) |
| trusted-events | 79/79 |
| continuations-neutral | ok |
| episode-focus ×3 | ok ×3 |
| D12 | 23/23, byte-identical |
| outcome-labels | 160/160 |
| mcp-gaps | 35/35 |
| body-capture | 51/51 |
| shadow-dom-context | ok |
| stable-element-keys | 19/19 |
| no-cross-control-neutral | ok |
| effect-rooted-form-neutral | ok |
| G4 (final7) | 81/81 |
| G6: compare regenerated with base and branch code on the banked store, then g6-grader | 6/6; base and branch compare output identical (`banked-2/g6-compare-diff.txt`, `banked-2/g6-grade.md`) |

**Flaky runs in the superseded pass** (the pass before 412d4363, on a machine at load average 25–28):
- continuations-neutral failed twice on its harness precondition "/api/cross-timer ran after action B started". The fixture arms a 250 ms timer, and the driver waits 60 ms and then clicks. It passed on the third attempt.
- D12 attempt 1 differed from B/C/D only in one `pointerover` and one `mouseover` row, where `metaKey` was `true`: a keyboard modifier state leaking from Playwright between sessions. It is not in any binding row, and attempt 2 was byte-identical.

In the final pass on 412d4363, every run passed on its first attempt.

**Store:** `store-2/records.jsonl.gz`, sha256 `b8df0078dc27ef72e23f135791c95957d134ae8c3f68babee76633ba8b2cbda5`, 4,244 rows, 3 page loads.

| row kind | count |
|---|---|
| `handler.binding` | 114 |
| `handler.invocation` | 12 |
| `handler.via_library` | 6 |

`holder_resolution` across those rows: `synthetic_event` 72, `unique` 39, `passed_down` 6, `ambiguous` 9. The 9 ambiguous rows are 3 per page: case 15's click and case 17's pointerdown and click.

## Banked stores (`banked-2/`)

- **Credit sweep** over the same 12 stores, base analysis vs branch analysis: the result is unchanged from RUN.md. There are 3 changes, all Radix Dialog Escape keydowns in the trusted-events store, where the Shortcut document listener is replaced by `onOpenChange`. No other store changes.
- **MCP over stdio, base vs branch:**
  - final7: 58/58 identical, text and structured;
  - G6: 421/421 identical;
  - g3-2026-09-23e: 57/57 identical;
  - trusted-events store: 884/888 texts identical. The differences are the same 3 credits and `basis: "declared"`, as in RUN.md.

Old stores carry no binding, via-library or untrusted rows, so the new rules never apply to them.

## Pre-existing, not this PR (from the grade, recorded as asked)

- Manifest spans for inline JSX arrows can run past the end of the source file (grade probe 4: `878-912` and `1107-1138` in a 977-byte file). This is the same on base and with stamps off.
- A function exported from a `.js` module is entered twice (nested) per call: the known module pass plus chunk pass.
- 1,000 clicks on a 200-deep tree produced about 191k `element.stamp` rows, the same on base. Stamps dominate the per-click cost at that depth. The binding walk adds about 0.28 ms per click at depth 200 (grade §6).

## Residual risks (this round)

1. **Reading `a0`.** It is read only under React's dispatch. An app object passed as the first argument to a function React invokes gets read for `nativeEvent` and `_reactName`. A Proxy-backed object (MobX, Immer) would observe those reads.
2. **Leaf handlers with no parameter.** When one is held by two props or two hosts, it stays ambiguous: the prop is not observable.
3. **"Bound outranks unbound."** A bound handler that did nothing still gets the credit over a global listener that did the action's real work, for example a document listener implementing the feature. The listener's requests are listed as unbound, so nothing is hidden. The headline, however, names the bound handler.
4. **`handler.via_library` is labelled by who called.** A first-party function called by a library's listener on an element, or by React's container, with no prop holding it, is "through library code". A first-party listener on an element that `addEventListener` did not register through the wrapped prototype would also land there.
5. **Untrusted invocations need `window.event`.** They are not detected inside shadow-tree listeners, where `window.event` is not set.
6. **Grader independence.** The negative control, probes, sweeps and the G6 regrade were rerun by the implementer.
