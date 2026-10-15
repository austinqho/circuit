# Handler binding observed at dispatch (D-G1-22): RUN (2026-09-24, branch `fix/handler-binding`, base `origin/fix/trusted-events` 53eb8882)

The implementer wrote this file. It is not a grade.

**Claim.** The handler Tracer credits to a user event is the one React actually invoked during that event's dispatch, observed at dispatch time, never inferred from a prop name.

**Rule text.** `docs/gates/G1-frontend-only.md`, D-G1-22; `docs/gates/G3-stamps.md`, amendment of 2026-09-24 (stamp handlers are declared).

**Code.**
- Runtime: `src/runtime-attribution-browser.js` (`observeBinding`, `chainPropsFor`, `invokerOf`; `EVENT_PROPS` deleted; declared list in `boundHandlersFor`), byte-identical copy in `dist/`.
- Credit and abstention: `analysis/runtime-attribution.mjs` (`indexEntryHandlerUnits`, `bindingSummary`), `analysis/causal-chain.mjs`.
- Readers: `analysis/element-index.mjs` (`observed_bindings`), `mcp/tools.mjs` (`describeBinding`, `dispatchBindings`, `renderBindings`, `observedText`).

## The rule as implemented

At every first-party function entry the runtime checks whether the new frame sits at depth zero directly under a live trusted dispatch frame (React's root listener, a library listener or a native listener called it while the browser dispatched that event), or under a bare continuation created by that dispatch (a library that validated in a promise continuation first). If so, it looks the function up among what the dispatch target's element chain holds:
- the values of every `on*` prop on every fiber from the target's fiber up to the root (host and component fibers, current props and alternate props, across portals as React walks);
- the first-party functions written inside those props at each placement (build-time `bound`);
- the first-party listeners added with `addEventListener` for this event type on the event's `currentTarget` element.

Matching is by function identity (the source function's id), never by name. A match writes one `handler.binding` row per (action, function, prop, holder), with the native event type that was dispatching, the prop, the holder fiber (kind, name, depth), the placement, how it ran (`during_dispatch` or `dispatch_continuation`) and the invoker label. When the dispatch was caused by live code (the D-G1-21 `gesture: false` mark), the same fact is a `handler.invocation` with `invoked_by: "app_code"`; it is never a binding to a user event.

The analysis credits a request to the depth-zero frame whose continuation lineage issued it, and falls back to the runtime's terminal owner. The terminal owner now ranks a frame observed bound above `entry_hint`. A request-less action credits a bound handler that ran. It abstains ("no element-bound handler ran") only when none ran.

## Static maps

- **Deleted:** `EVENT_PROPS`, the runtime's prop-name-to-event map, and the `on<kind>` name matching that `boundHandlersFor` used for other kinds. Nothing decides from a prop name.
- **Remaining, display only, declared:** the element.stamp `handlers[].event` label (`prop.slice(2).toLowerCase()`). It is a name transform on the declared list, not a map. The stamp row says so (`handlers_basis: "declared"`), and so do G3 and the element-index doc comment. The MCP shows it under `handlers` with `handlers_basis: "declared"`, after `observed_bindings`.
- **Legacy rows:** stores recorded before this pass carry a `bound_handlers` list that the old runtime filtered with the map. It cannot be re-observed. Their abstentions keep the old sentence and are labelled `basis: "declared"` in JSON.

## Results (all headless; branch head after rebase onto 53eb8882)

| run | result | file |
|---|---|---|
| `npm run build`, `cmp` src/dist | identical | (checked after every runtime change) |
| `npm test` | 700 tests, 699 pass, 1 known failure (`react-context-ref-semantics`) | `runs/npm-test.txt` |
| **handler-binding driver** (3 page loads each), 3 invocations | **97/97** each | `runs/handler-binding-{1,2,3}.txt` |
| episode-focus, 3 runs | ok ×3 | `runs/episode-focus-{1,2,3}.txt` |
| trusted-events driver (base branch's gate) | 79/79 | `runs/trusted-events.txt` |
| continuations-neutral (5 page loads) | ok | `runs/continuations-neutral.txt.gz` |
| outcome-labels | 160/160 | `runs/outcome-labels.txt` |
| mcp-gaps | 35/35 | `runs/mcp-gaps.txt` |
| body-capture | 51/51 | `runs/body-capture.txt` |
| shadow-dom-context | ok | `runs/shadow-dom-context.txt` |
| stable-element-keys | 19/19 | `runs/stable-element-keys.txt` |
| no-cross-control-neutral | ok | `runs/no-cross-control-neutral.txt` |
| effect-rooted-form-neutral | ok (submitHandler credited, validator spine-only) | `runs/effect-rooted-form-neutral.txt` |
| D12 stamp neutrality (A, B, C, D) | 23/23, byte-identical | `runs/d12.txt` |
| G4 grader (final7) | 81/81 | `runs/g4.txt` |
| G6: `g6-compare.mjs`, 6 pairs, regenerated on the banked store with base 53eb8882 and branch code, then `g6-grader.mjs` | 6/6 PASS; the base and branch compare directories are identical | `banked/g6-grade.md`, `banked/g6-compare-diff.txt` |

The handler-binding lines in `runs/summary.txt` come from the rerun after the lookup fix described below.

**Run history, stated in full.**
1. The first full green run on the pre-rebase head failed continuations-neutral on the native-element-listener assertion. The failure was real: React marks every `<input>` with `__reactEvents$` (it listens for `invalid` there), so the invoker check labelled the input a React container and skipped the element-listener match. Fixed in e19f5123: a first-party listener registered on the `currentTarget` element now decides the invoker. The same run's continuations-neutral also asserted the old abstention sentence, and was updated to the observed one.
2. One later continuations-neutral run failed with page errors "TypeError: Failed to fetch". That was on a busy machine, with other agents' builds running. The immediate rerun and the final run passed. It is recorded here and not explained.
3. In the final run, the handler-binding driver failed C19 in all 9 page loads, and the raw rows held the binding. The driver's lookup was wrong: a submit's `target` is its submitter, and the form's label is on `form`. After the driver fix, 97/97 ×3. The failing outputs are not committed.
4. `effect-rooted-form-neutral` needs the LibreChat dependency root as its argument; its default path does not exist on this machine.

## The fixture and what each case shows (identical in all 9 page loads)

Fixture: `test/browser/fixtures/handler-binding-app/`. The driver is `test/browser/handler-binding.mjs`; its tiny backend logs every `/api/*` call. It uses:
- React 18.3.1 from the LibreChat dependency root;
- Radix Select 2.x and Radix Dialog 1.0.x;
- zustand 5, resolved from this checkout with React deduped;
- a stand-in form library under `vendor/`, which the first-party rule excludes, so it is not instrumented.

A document capture-phase `click` listener (`audit`) runs before every React click handler.

| case | native event observed | prop | credited (branch) | base 53eb8882 |
|---|---|---|---|---|
| checkbox, state only (mouse click, and the click Space causes) | click | onChange (host `input`, React) | its onChange | **abstains**: "no element-bound handler observed … global listeners: [audit, onChange]" |
| its native `change` events, and the Space keydown/keyup | none ran | | nothing | nothing |
| checkbox and radio with requests | click | onChange | onSubscribe / onPlan | **credits `audit`** (the capture listener entered first and was the terminal owner) |
| text input | input | onChange | onTitle | onTitle |
| `<select>` (type-ahead) | change | onChange | onColor | onColor |
| range (ArrowRight) | input (the later `change` ran nothing) | onChange | onVolume | onVolume |
| double-click, state only | dblclick | onDoubleClick | onDoubleClick | **abstains**, naming onDoubleClick as a global listener |
| the two clicks of that double-click | none ran | | abstains "no element-bound handler ran; global listeners: [audit]" | abstains (old sentence) |
| Enter in a form | keydown / submit | onKeyDown / onSubmit | both | both |
| Radix Select, pointer / keyboard | pointerup / keydown | onValueChange (component fiber, reached through the portal, React) | onValueChange | onValueChange |
| Radix Dialog: open, Escape, overlay | click (React) / keydown and pointerdown (Radix's document listeners: `native_listener`, `listener_on: document`) | onOpenChange | onOpenChange | onOpenChange |
| zustand store-writing onClick | click | onClick | the onClick. Its subscriber effect's request was owned by that click | fact not found (the click could not be identified without bindings) |
| Archive (onContextMenu declared, never run) | click | onClick | onClick. onContextMenu is in the declared list and in no binding, invocation or function.enter row. The MCP names it "declared, never observed running" | onClick |
| `.focus()` in a click handler | focusin (caused) | onFocus | `handler.invocation`, `invoked_by: app_code`, `dispatched_by: react_event_system`, caused by that click; never a binding | no rows |
| `.focus()` from a mount timer | focusin (caused) | onFocus | `handler.invocation`, `cause_abstained: no_action_on_frame`; never a binding | no rows |
| prop called from a component's timer (`onTick`) | none | | neither binding nor invocation | n/a |
| contenteditable | input | onInput | onInput | onInput |
| Ping behind the capture listener | click | onClick | Ping's onClick (audit entered first at depth zero) | Ping's onClick (its inline arrow carries `entry_hint`) |
| form library, validation in a promise continuation | submit (`ran: dispatch_continuation`, `via: written_in_prop`) | onSubmit | the callback | **no credit, no abstention** |

The prop/event pairs observed in every page load were: `onChange@click`, `onChange@input`, `onChange@change`, `onClick@click`, `onDoubleClick@dblclick`, `onInput@input`, `onKeyDown@keydown`, `onSubmit@submit`, `onValueChange@pointerup`, `onValueChange@keydown`, `onOpenChange@click`, `onOpenChange@keydown` and `onOpenChange@pointerdown`. None of them is written in Tracer.

**Negative control.** The same driver and fixture were run against base 53eb8882 with 3 page loads: 16/97 checks pass. The output, with its facts table, is `negative-control/base-53eb8882-driver.txt`. It shows the false abstention for the state-only checkbox (mouse click and Space) and for the double-click, and the capture listener credited with the checkbox and radio requests.

**MCP over stdio (black box).** Every check was recomputed from the raw rows:
- `resolve_element` on the Notify checkbox lists `observed_bindings` before `handlers` (`handlers_basis: "declared"`). The summary starts with `observed: <handler> as onChange on click (React) ×6`; that count is the raw store-wide count over 3 page loads.
- `element_history` prints the observation before `newest:`.
- `action_chain` shows:
  - `bound_handlers {observed, declared}`;
  - the entry stop's `binding`;
  - `[bound: onChange on click (React)]` in the chain line;
  - an "Observed bound to this dispatch:" line.
- A caused focusin's chain says "Ran for a dispatch app code caused (not a user event)".
- The double-click's second click stops at `entry_handler` with "no element-bound handler ran".

**Volume.** The kept store (run 3 of invocation 3, 3 page loads) has 2,634 rows, including 75 `handler.binding` and 6 `handler.invocation` rows: about 25 bindings per page load for 24 user steps. Bindings are written only for functions matched to the chain, deduplicated per (action, function, prop, holder).

## Banked stores: what changed and why

**Entry-handler credit and abstention.** Both analyses (base 53eb8882 and branch) were imported and run over the raw rows of 12 banked stores; the script is `banked/sweep.mjs` and the output `banked/credit-sweep.jsonl`.

| store | actions | abstentions base → branch | credits changed |
|---|---|---|---|
| m1-2026-09-22-final7 | 54 | 0 → 0 | 0 |
| g6-anything-llm-2026-09-23 | 408 | 0 → 0 | 0 |
| g2-anything-llm bridgeoff / r4 | 68 / 68 | 10 → 10 / 0 → 0 | 0 |
| g2-bulletproof-react bridgeoff | 336 | 2 → 2 | 0 |
| g3-2026-09-23e | 38 | 0 → 0 | 0 |
| g1-2026-09-23f frontend-only / backend-on | 345 / 346 | 113 → 113 each | 0 |
| g5-codex-partB, g5-anything-llm-c | 78 / 151 | 19 → 19 / 13 → 13 | 0 |
| pr-outcome-labels store | 25 | 0 → 0 | 0 |
| **pr-trusted-events store** | 852 | 57 → 57 | **3** |

**The three changes are right.** They are the three Radix Dialog Escape keydowns in the trusted-events store, one per page load. Base credited the Shortcut component's `document` keydown listener (`main.jsx:4067-4279`). That listener is a global listener, and it sent nothing on Escape. The branch credits `onOpenChange` (`main.jsx:1786-1854`), the function whose continuation issued `/api/dialog-dismissed`. The request's own lineage names it; base had used the runtime's terminal owner, which was the listener that entered first.

That store predates observed bindings, so the new credit rests only on the lineage-first rule. None of these stores has binding rows. Their 113 + 113 + 10 + 2 + 19 + 13 + 57 abstentions are still judged from the declared list that the old runtime filtered with its map. They are unchanged, and some may be false in exactly the way this PR fixes. That cannot be decided from those rows.

**MCP output, base vs branch, over stdio.** The output is `banked/base-vs-branch-mcp.txt` (scripts `banked/mcp-all.mjs`, `banked/diff.mjs`). It covers every `action_chain`, `recent_actions`, `page_requests`, `element_history` and `resolve_element` call.
- final7, 58 calls: text and structured output identical.
- G6, 421 calls: text and structured output identical.
- g3-2026-09-23e, 57 calls, 8 element keys: text and structured output identical.
- trusted-events store, 888 calls: 884 texts identical. The 4 that differ are the three Escape credits above, which appear in `action_chain`, `recent_actions` and `element_history`. Structured output also gains `handler_abstention.basis: "declared"` on the 57 legacy abstentions.

## Residual risks

1. **The invoker label.** `react_event_system` means the event's `currentTarget` was an element React marks as a listening container. A non-React listener on such an element could be mislabelled, for example on `document.body` when a portal targets it. A first-party listener registered on the element is recognised and labelled `native_listener`. The binding decision never reads this label.
2. **Handlers reached only through library code.** Suppose a prop's value is a library function that calls a first-party function not written inside the prop, for example a callback passed to a hook rather than to JSX. Then the first-party function is held by no prop: no binding is recorded, and a request-less action abstains. That is safe, but it is an abstention.
3. **Continuation reach.** A binding in a continuation requires a continuation the runtime created: a wrapped `then`, a timer, or a rewritten first-party `await`, made while the dispatch frame was current with nothing first-party in between. A native `await` inside uninstrumented library code loses the link, and the callback then runs unbound. The fixture's form library uses `.then`; react-hook-form's native `async` was not tested.
4. **Rows before this pass** cannot be re-judged; see Banked stores.
5. **Identity is per source function.** Two closures of one source function are the same id. When a prop holds a different closure of the same function, it still matches. That is correct for credit, but it is not closure identity.
6. **Cost.** The first depth-zero entry under a dispatch walks the target's fiber chain once per event, and the result is cached per event. It was not measured on a long session or a deep tree, and hover and move ranges with first-party handlers walk once per event.
7. **Grader independence.** The negative control, the banked sweeps and the G6 regrade were run by the implementer. An independent grader should rerun them.

## Files

| file | sha256 / note |
|---|---|
| `store/records.jsonl.gz` | `8dd1b18e12c21ac3978d630ffd60d7b46074cde1d3c81ff8747974f5518efa09`, 2,634 rows, 3 page loads (invocation 3) |
| `store/attribution-manifest.json` | the fixture build's manifest (function ids → source spans) |
| `runs/*` | the suite and driver outputs listed above; `summary.txt` has exit codes |
| `negative-control/base-53eb8882-driver.txt` | 16/97 on base, with the facts table |
| `banked/*` | G6 grade and compare diff, credit sweep, MCP base-vs-branch diff, and the scripts |
