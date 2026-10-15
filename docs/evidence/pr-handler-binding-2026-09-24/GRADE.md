# GRADE: `fix/handler-binding` (D-G1-22), head 9e6bc610, diff `53eb8882...HEAD`

Independent grader. I did not write this branch. I did not trust RUN.md, the test names or the summaries. Every number below was recomputed from raw `records.jsonl` rows, from the fixture source text, or from the MCP server driven over stdio as a black box. The probes are in `grader-scratch/` in the worktree. They are untracked and are not part of this commit.

**Claim graded.** The handler Tracer credits to a user event is the one React actually invoked during that event's dispatch. It is observed at dispatch time and never inferred from a prop name.

**Verdict: `merge with changes`.** The mechanism is real and it fixes the owner's defect. A checkbox `onChange` on `click` is now bound, and the false "no element-bound handler" abstention on it is gone. The negative control reproduces. No banked store regresses.

The claim as stated is still falsified by four common patterns:
- a function held by two props is reported under the wrong prop, and in one case the wrong holder;
- a global capture listener that sends a request is still credited over the handler observed bound to the dispatch;
- two library-mediated callbacks produce an abstention sentence that is false;
- an `el.click()` from app code produces neither a binding nor an invocation.

The exact changes are listed at the end.

## 1. The author's driver and the negative control

| run | result |
|---|---|
| `TRACER_KEEP_STORE=1 node test/browser/handler-binding.mjs`, 3 invocations × 3 page loads | 97/97, 97/97, 97/97 (`grader-scratch/hb-run-{1,2,3}.txt`) |
| Same driver and fixture on base 53eb8882 (git archive; the branch's `fixture-build.mjs` copied in for its `resolve` option) | **16/97** (`grader-scratch/negative-control-base-full.txt`). The facts table shows base abstaining on the state-only checkbox, naming its own onChange a "global listener", and crediting `audit` with the Subscribe request. |

**Raw-row recomputation.** `grader-scratch/verify-bindings.mjs` checks every `handler.binding` and `handler.invocation` row in invocation 3's store (81 rows, 3 page loads) against the fixture source and the build manifest:
- **Native type.** In 81/81 rows, `native_event_type` equals the `event` of the `dom.action` with the same `action_id` on the same page. The native type is the one that actually dispatched: the checkbox is `click`, text is `input`, `<select>` is `change`, range is `input`, then `dblclick`, `keydown`, `submit`, `pointerup`/`keydown` for Radix Select, and `click`/`keydown`/`pointerdown` for Radix Dialog.
- **Holder.** For every row with a `placement_id`, I parsed that placement's opening tag in `main.jsx`. The `prop_name={…}` expression either contains the function's span (`written inside`) or is an identifier whose `const X =` declaration starts at the function id's start offset. That held for 81/81.
- **Target.** Depth-0 host holders equal the action's `target.element_key` placement. The exceptions: submit, where the target recorded is the submitter while the holder is the `<form>`, which is correct because the submit event's target is the form; and Radix component holders, which have no first-party placement (`SelectProvider@54`, also held by `Select@55`).
- **Credit.** The credited handler per case was taken from `action_chain` over stdio in the driver, with expectations computed from source offsets. I spot-checked it again in my own probes.

## 2. Per-rule table

| rule | verdict | raw evidence |
|---|---|---|
| A first-party function entering at depth zero under a live trusted dispatch frame, and held by an `on*` prop on the fiber chain, is bound (prop, native type, function id, holder, invoked_by) | **PASS, with a prop/holder defect** | 81/81 author rows verified (§1). Probes (a), (c), (f), (g), (i-onPick) and (j) are correct. **Probes (d), (d3) and (e2) fail**: the row takes `prop_name` and `fiber` from the first match in prop-key order. (d) `<button onKeyDown={h} onClick={h}>`: a mouse click writes `prop_name: "onKeyDown", native_event_type: "click"`, and so does the click Enter causes. (d2) is the same button with the props in the other order: `onClick`, which is correct. (d3) `onPointerDown={send} onClick={send}` with a request: the chain line reads `[bound: onPointerDown on click (React)]`. (e2) `<div onClick={h}><button onMouseDown={h}>`: React ran the div's `onClick`, but the row says `onMouseDown`, holder `button@0`. |
| … or in a bare continuation the dispatch created | **PASS** | The author's case 14 passes. Probe (b3), real `react-hook-form` 7.85 `handleSubmit(values => …)` with native `async`/`await` inside the library: the binding survives (`ran: dispatch_continuation, via: written_in_prop`) and the callback is credited. RUN.md residual risk 3 and G1 "Not covered" item 3 say that a native `await` in an uninstrumented library loses the link. For RHF that is not what happens. |
| … or a listener on the event's currentTarget | PASS | `continuations-neutral` asserts that a native element listener is credited (see §5). |
| A prop that never runs is declared, not bound | PASS | The Archive `onContextMenu` has no binding, invocation or enter row. The MCP says "declared, never observed running". |
| Caused dispatches are `handler.invocation` with the cause, never bindings | **PASS for trusted caused dispatches; gap for `el.click()`** | Author rows: `.focus()` from a click gives an invocation with `caused_by_action_id`; from a mount timer, an invocation with `cause_abstained`. Probe (p) `requestSubmit()` from a click, (q) from a mount timer, and (r) `submitButton.click()` all give invocations with the cause. **Probe (h)**: `target.click()` from a timer, armed by a user click and also at mount, dispatches an untrusted click. `observeBinding` returns on `isTrusted !== true`, so `onTargetClick` gets **no binding and no invocation row**. The request ownership is correct: the Schedule click owns `/api/scheduled-click`, and the mount-timer copy is `none: no user action … setTimeout timer armed at page load`. |
| Credit follows the request's continuation lineage, then an observed-bound frame, then `entry_hint` | **FAIL against the claim** (follows the author's Rule 4 literally) | Probe (o) is a document capture `click` listener `track` that POSTs `/api/analytics` on every click, plus a button whose `onClick` POSTs `/api/real`. The branch credits **`track`** as "handler" for the click. The same chain prints "Observed bound to this dispatch: onSaveReal as onClick on click (React)". For a state-only button beside it, `track` is credited too, although the rows bind `onStateOnly`. Base does the same, so this is not a regression. But it is the audit-listener false credit from cycle 2 §5, reached whenever the global listener sends anything. Lineage-first picks the earliest candidate that owns *any* request, and the capture listener always enters first. |
| "No element-bound handler ran" only when none ran | **FAIL in two library-mediated shapes** | Probe (b1), RHF `handleSubmit(onValid)` with a named `onValid`: the rows show `onValid` entered for this submit action (`continuation:…:await:67`), `bound_handlers.library: 1`, and the chain says "no element-bound handler ran …; global listeners: []". Probe (i), a vendor component calling a first-party `callback` prop from its own `onClick`: "no element-bound handler ran …; global listeners: [viaCallback]". `viaCallback` is **not** a global listener: React invoked the library's `onClick` on the button, and that called it. Base abstained in both cases too, but with the weaker "no element-bound handler **observed** in instrumented code". The new wording and SKILL.md ("means the only functions that ran were global listeners") state as a fact something the rows contradict. In both cases the runtime knew a library handler was held by the chain (`library: 1`). |
| No static map; one declared display transform | **PASS** | `EVENT_PROPS` and `on<kind>` matching are gone from `src/`, `dist/`, `analysis/` and `mcp/`. The grep found no prop→event table. The remaining `prop.slice(2).toLowerCase()` is only on `element.stamp.handlers[].event`, and it carries `handlers_basis: "declared"`. The same transform exists in `analysis/react-compiler.mjs`, which predates this branch, is unchanged, and is not imported by `mcp/` or by the credit path. |
| Old stores keep `basis: "declared"` and the old sentence | PASS | Trusted-events store over the author's MCP call set: 57 `handler_abstention.basis: undefined → "declared"` changes, and the abstention text is byte-identical. |

## 3. My probes (`grader-scratch/probe*/main.jsx`, drivers `probe*-driver.mjs`, outputs `probe*-{branch,base}.json`)

| probe | branch result | base 53eb8882 | verdict |
|---|---|---|---|
| (a) `<Card onSave={saveCard}>` → `<Footer onClick={onSave}>` → `<button onClick={onClick}>`, `saveCard` in `outer.js` | binding `onClick@click`, holder `host:button@0`, `also_held_by` `Footer.onClick@2` and `Card.onSave@4`; the function id is from `outer.js`; credited | credited | PASS |
| (b1) RHF 7.85, named `onValid`, state only | no binding; **false abstention**, "no element-bound handler ran; global listeners: []" | abstains ("observed in instrumented code") | FAIL (text) |
| (b2) RHF, named `onValid` that sends | credited by lineage | same | PASS |
| (b3) RHF, inline `onValid` | binding `onSubmit@submit`, `dispatch_continuation`; credited | n/a | PASS (and contradicts the disclosure) |
| (c) `useCallback` whose identity changes every render, 3 clicks | 3 bindings, 3 credits | credited | PASS |
| (d) `onKeyDown={h} onClick={h}`: click, and Enter (keydown + caused click) | `onKeyDown@click` ×2 (**wrong**), `onKeyDown@keydown` | n/a | FAIL |
| (d2) same function, `onClick` first | `onClick@click` | n/a | order-dependent |
| (d3) `onPointerDown={s} onClick={s}`, sends | click: `[bound: onPointerDown on click (React)]` | n/a | FAIL |
| (e) same function on target and ancestor `onClick` | one row, holder `button@0`, `also_held_by div@1`; React ran it twice, and the ancestor's invocation is folded into the first by dedup | credited | PASS for the holder; second invocation not recorded |
| (e2) target `onMouseDown={h}`, ancestor `onClick={h}` | click: `onMouseDown`, holder `button@0` (**wrong**: React ran the div's onClick) | n/a | FAIL |
| (e3) ancestor-only `onClick` | holder `host:div@1` | credited | PASS |
| (f) `<select onChange>` / `<textarea onChange>` | `change` / `input` | same credits | PASS |
| (g) Radix Select by keyboard: Space opens, ArrowDown, Enter; and ArrowDown opens, ArrowDown, Enter | `onValueChange` bound on `keydown` (Enter), holder `SelectProvider@51`, request credited. The ArrowDown keydowns abstain naming only the document listener. | same credits | PASS |
| (h) `el.click()` from a timer armed by a click, and from mount | request owned by the arming click / by no action (correct); **no invocation row** | same | gap |
| (i) vendor component → first-party `onPick` prop | binding `onPick@click`, holder `component:Widget@1` | credited | PASS |
| (i') vendor component → first-party `callback` prop | **"no element-bound handler ran; global listeners: [viaCallback]"** | abstains | FAIL (text) |
| (j) React root inside an open shadow root | binding `onClick@click`, holder `button@0`, credited | credited | PASS |
| (k) first-party component registers its `onShortcut` prop on `document` | with focus inside: bound `onShortcut@keydown (listener on document)` and credited; outside: abstains | same credits | consistent with the Radix Escape model; see risk 3 |
| (n) `onClick={debounce(fn)}` (lodash) | no binding, no credit, no abstention (`stopped at browser`) | same | acceptable (silent, not false) |
| (o) document capture listener that sends, plus a bound `onClick` | **credits the global listener** (both buttons) | same | FAIL against the claim |
| (p)(q)(r) `requestSubmit()` from a click / from a timer; `submitBtn.click()` | `handler.invocation`, `invoked_by: app_code`, with the cause | n/a | PASS |

## 4. Banked stores versus base (the author's call sets, rerun by me)

- **final7**, 58 calls: text and structured output identical.
- **G6**, 421 calls: text and structured output identical.
- **Trusted-events store**, 888 calls: 884 texts identical. The changes are 3 credits (6 `recent_actions` summary entries) plus `basis: "declared"` ×57.
- **The 3 credit changes are right by the rows.** For each Escape keydown (`action:mug1mwdh:75`, `action:mug1n21l:75`, `action:mug1n7pt:75`), `/api/dialog-dismissed` has the continuation lineage `643:692 (send) ← 1786:1854 ← 1786:1854 ← the action`. `1786:1854` is `const onOpenChange = next => {…send('/api/dialog-dismissed')}`. The runtime's `terminal_owner` was `4067:4279`, the Shortcut `document` keydown listener, which sends only on Ctrl+Shift+K. Branch credits `onOpenChange` (correct); base credited the listener (wrong).
- **G6 compare regenerated** with both base and branch code on the same gunzipped store and source root: the directories differ only in the echoed `--store` argument path (`g6-compare-diff.txt`). `g6-grader` over the branch output: 6/6 PASS.

## 5. Suite (branch head, run by me; `grader-scratch/runs/`)

| run | result |
|---|---|
| `npm test` | 700 tests, 699 pass; the only failure is `test/react-context-ref-semantics.test.mjs:63` (known) |
| D12 stamp neutrality | pass, 23/23 |
| continuations-neutral | ok. The changed assertion is stricter, not weaker: it adds `basis === "observed"` and matches the new sentence. The case is a Ctrl+M `document` keydown listener, which is truly global. |
| episode-focus ×3 | ok ×3 |
| trusted-events | 79/79 |
| outcome-labels | 160/160 |
| mcp-gaps | 35/35 |
| body-capture | 51/51 |
| shadow-dom-context | ok |
| stable-element-keys | 19/19 |
| G4 (final7) | 81/81 |
| G6 | 6/6 |
| `cmp src/runtime-attribution-browser.js dist/runtime-attribution-browser.js` after `npm run build` | identical |

## 6. Cost (the per-event fiber-chain walk)

Fixture `grader-scratch/cost/`: 200 nested components, each holding two first-party `on*` props and wrapping a `div` with `onMouseEnter` (about 400 fibers above the button). There were 1,000 trusted Playwright clicks per build, measured in-page from a window capture listener to the handler's first line (`to_handler`) and to a window bubble listener (`whole`). The machine load average was about 14, so treat the absolute values as noisy.

| build | depth | to_handler mean / p95 (ms) | whole dispatch mean / p95 (ms) |
|---|---|---|---|
| branch | 200 | 0.336 / 0.4 (repeat run: 0.328) | 3.93 / 5.2 (repeat: 3.57) |
| base 53eb8882 | 200 | 0.056 / 0.1 | 3.39 / 4.3 |
| uninstrumented | 200 | 0.017 / 0.1 | 0.09 / 0.2 |
| branch | 10 | 0.055 / 0.1 | 0.24 / 0.4 |
| base | 10 | 0.026 / 0.1 | 0.24 / 0.4 |

The walk adds about **0.28 ms per click at depth 200** and about 0.03 ms at depth 10, once per event (cached per event). That is small next to Tracer's existing per-click cost at that depth (about 3.4 ms, dominated by stamps: about 191k `element.stamp` rows for 1,000 clicks, the same on base). Every click action that reached the store carried its binding (951/951 in the kept run). The missing 49 actions were lost at the store tail when the page navigated away, which also happens on base; they were not binding misses.

## 7. Residual risks (not blocking, beyond the required changes)

1. The same function on the target and on an ancestor, both invoked, gives one row: the dedup key uses the first holder, so the ancestor's invocation is not recorded separately.
2. The `react_event_system` label is inferred from the currentTarget being React-marked. This is disclosed.
3. A first-party component that registers its own `on*` prop on `document` is "bound" when focus is inside it and "global" when focus is outside (probe k). This is consistent with treating Radix Dialog's document listeners as bound. The row says `listener on document`, but the header claim ("the one React actually invoked") overstates for these cases.
4. Pre-existing and not this PR, found in passing. In probe 4 the manifest's function spans for inline JSX arrows exceed the source file's length (for example `878-912` and `1107-1138` in a 977-byte file). It is the same on base and with stamps off. `saveCard` exported from a `.js` module is entered twice (nested) per call, on base too.
5. Stores recorded before this pass cannot be re-judged (disclosed).

## Required changes (for `merge`)

1. **Prop and holder by observation, not by first match.** When a function id is held by more than one `(prop, holder)` on the chain, decide which one React invoked from what the dispatch shows at entry: the handler's first argument is React's SyntheticEvent, whose `_reactName` and `currentTarget` are runtime state, not a map. When that is unavailable (a component prop called by library code), write `prop_name: null` with every holder and say it is ambiguous. Never take `matches[0]`. Add probes (d), (d3) and (e2) to the fixture: mouse click and Enter-caused click on `onKeyDown={h} onClick={h}`; `onPointerDown={s} onClick={s}` with a request; target `onMouseDown={h}` with ancestor `onClick={h}`.
2. **An observed-bound frame outranks an unbound frame in the credit.** When the dispatch has a bound frame, a request owned by an unbound depth-zero frame (a global listener) must not make that listener "the handler". Credit the bound frame, whether it owns a request or is state-only, and list the listener's request as issued by a global listener. Add probe (o) to the fixture: a document capture listener that sends on every click, a sending button and a state-only button.
3. **An honest abstention when library-held props are on the chain.** When `bound_handlers.library > 0` and a first-party function ran at depth zero under the dispatch or in its continuation, do not say "no element-bound handler ran" and do not list that function under "global listeners". Say that an uninstrumented handler held by the element chain ran and called it. Alternatively credit it with a distinct, labelled basis. Fix the SKILL.md gloss ("means the only functions that ran were global listeners"). Add probes (b1) (RHF with a named `onValid`) and (i') (a vendor component calling a non-`on*` callback prop).
4. **Rule 2 coverage for `el.click()` / `dispatchEvent`.** Either write `handler.invocation` (`invoked_by: app_code`, with the cause) for untrusted dispatches run under a live frame, or add them to G1's "Not covered". Today the rows hold neither.
5. **Correct the disclosures in a new evidence note.** The directory is immutable: add a file, do not edit RUN.md. The note must:
   - withdraw RUN.md residual risk 3 and G1 "Not covered" item 3 for real react-hook-form (probe b3: the link survives);
   - state residual risk 1 above (one row per function per dispatch; the ancestor's invocation is folded).

## Commands

```sh
cd /Users/austinho/dev/tracer-b-handler-binding
npm run build && cmp src/runtime-attribution-browser.js dist/runtime-attribution-browser.js
for i in 1 2 3; do TRACER_KEEP_STORE=1 node test/browser/handler-binding.mjs > grader-scratch/hb-run-$i.txt; done
node grader-scratch/verify-bindings.mjs <kept store> <kept fixture repo>
git archive 53eb8882 | tar -x -C grader-scratch/base   # plus a node_modules symlink, the driver, fixture and fixture-build.mjs copied in
(cd grader-scratch/base && node test/browser/handler-binding.mjs)                     # 16/97
node grader-scratch/probe-driver.mjs <root> probe-<branch|base>.json                  # probes a-n (plus PROBE_APP=probe2|probe3|probe4 with probe{2,3,4}-driver.mjs)
node grader-scratch/banked/mcp-all.mjs <root> grader-scratch/banked/<final7|g6|te> - <out>.jsonl; node grader-scratch/banked/diff.mjs base.jsonl branch.jsonl
grader-scratch/run-suites.sh                                                        # npm test, D12, continuations-neutral, episode-focus x3, trusted-events, outcome-labels, mcp-gaps, body-capture, shadow-dom-context, stable-element-keys, G4, G6 compare (base and branch) + g6-grader
node grader-scratch/cost/cost-driver.mjs <root|none> <depth> 1000
```

---

# Regrade at 70fbd740

Head 70fbd740 (fast-forwarded from origin; my grade 41196186 is in history). The base is unchanged, 53eb8882. RUN-2.md was read as the author's notes; nothing there was taken on trust. My probes were rerun from `grader-scratch/` and four new probe sets were added: `probe5` (s1–s5), `probe6` (s6, s6b), `probe7` (a body-level listener) and a nested-call cost variant. Raw outputs: `grader-scratch/probe*-branch2.json`, `probe5-{branch,base}.json`, `probe6-branch.json`, `probe7-branch.json`, `runs2/`, `cost-results-2.jsonl`.

**Verdict at 70fbd740: `merge with changes`.**

All five first-round changes are implemented, and every one of my first-round probes now reports correctly. The new probes found four remaining defects:
- a capture-phase prop is reported as its bubble prop, with the strongest resolution label;
- Tracer's own read of a handler's argument can run app code, which is then recorded as app work;
- change 2 is defeated when the global listener sits on `document.body` rather than `document`;
- the ambiguous-binding sentence is false in most of the cases that reach it.

The required changes are listed at the end.

## R1. Prop and holder by observation

| probe | result at 70fbd740 | verdict |
|---|---|---|
| (d) `onKeyDown={h} onClick={h}`, `h` with a nested function (call proxy): click, Enter keydown, and the click Enter causes | `onClick@click`, `onKeyDown@keydown`, `onClick@click`; all `synthetic_event`, holder `button@0` | PASS |
| (d3) `onPointerDown={s} onClick={s}`, sends | `onPointerDown@pointerdown`, `onClick@click`, `synthetic_event` | PASS |
| (e2) target `onMouseDown={h}`, ancestor `onClick={h}` | mousedown → `onMouseDown`, button@0; click → `onClick`, **div@1** | PASS |
| (e) target and ancestor both `onClick={h}` | two rows: button@0 and div@1 | PASS |
| Fixture 15–19 (raw rows, one page of the kept driver store) | 15: ambiguous [onKeyDown/button, onClick/button]; 16: `onClick@click`, `onKeyDown@keydown`; 17: ambiguous on pointerdown and on click, request credited to `sendDual`; 18: `onMouseDown@mousedown` button@0 and `onClick@click` div@1; 19: two rows, button@0 then div@1 | PASS |
| (s1) a vendor component calls `onClick('custom')`; the function is held by that component's `onClick` and `onKeyDown` | ambiguous [onKeyDown/CustomArgButton, onClick/CustomArgButton] | honest (PASS) |
| (s1b) a vendor component forwards its pointerdown SyntheticEvent to the `onClick` prop, where the function is also held by `onKeyDown` | ambiguous (`_reactName` is `onPointerDown`, and neither prop has that name) | honest (PASS) |
| (s2a) destructured first parameter `({ type }) =>`, leaf, two props | ambiguous (no `a0` is passed) | honest (PASS) |
| (s2b) destructured, with a nested function (call proxy) | `onClick@click`, `synthetic_event` | PASS |
| (s3) the same function as ancestor `onClickCapture` and target `onClick`, with an event parameter; React runs it twice | two rows in one dispatch. The bubble call is `onClick`/button@0 via `synthetic_event`. **The capture call is `ambiguous` [onClick/button, onClickCapture/div]**, though the event it received identifies the div. | two rows PASS; capture unresolved |
| **(s6) one div holds the same function as `onClickCapture` and `onClick`; the click lands on a child button** | React ran it twice (the page shows eventPhase `1` then `3`). Tracer writes **one row: `prop_name: "onClick"`, holder div@1, `holder_resolution: "synthetic_event"`.** The `onClickCapture` invocation is reported as `onClick` and folded into the bubble row. | **FAIL** |
| (s6b) ancestor `onClickCapture={h} onKeyDown={h}`, target `onClick={g}` | `h`: ambiguous [onClickCapture, onKeyDown], though React ran `onClickCapture`. `g`: `onClick`. The credit goes to `h`, the first bound frame (the capture handler on the ancestor), over the target's `onClick`. | ambiguous is honest but resolvable |

**Cause of s3, s6 and s6b.** React 18 builds the SyntheticEvent with the bubble name: `_reactName` is `onClick` even while it runs `onClickCapture` listeners. So `named` finds the `onClick` holder. When the same host holds both props (s6), `atTarget` matches and the wrong prop is written with `synthetic_event`, the strongest label.

| probe | result | verdict |
|---|---|---|
| **(s4) Proxy-backed argument.** A vendor component calls `onSelect(store)`, where `store` is a first-party `Proxy` that logs its get/has traps. | The trap log on the branch is `["observable:get:nativeEvent", "observable:get:id", "revoked:get:nativeEvent", "revoked:get:id"]`. On base it is `["observable:get:id", "revoked:get:id"]`. **Tracer's read of `a0.nativeEvent` is observable to app code.** Because the trap is first-party, Tracer's own read also **produced a `handler.via_library` row for the trap function** and its `function.enter` rows. The chain says "5 functions entered", counting the trap. A trap that throws (s4b) is caught: no page error, and the handler ran normally. | **FAIL** (evidence the instrumentation created itself) |
| (s5) `dispatchEvent(new MouseEvent('click'))` from a click handler | untrusted `handler.invocation`, `synthetic_event`, `caused_by_action_id` = the Fire click; that click owns `/api/dispatched?trusted=false` | PASS |

**Where `a0` is read.** RUN-2 and the G1 amendment say that `a0` is read "only while React's own dispatch is invoking … React's SyntheticEvent in practice". The read happens whenever the dispatch's invoker is a React container and the function is held by a prop. That includes a library calling a component prop with any object (s4), not only React invoking a host prop.

## R2. A bound frame outranks an unbound one

- **(o), document capture listener:** `o-real` credits `onSaveReal` and `o-state` credits `onStateOnly`. The headline reads `→ handler … [bound: onClick on click (React)] → 2 requests: (1) <track> → POST /api/analytics …; (2) POST /api/real`, followed by "Requests issued by a frame not bound to this element …: <track> (1 request(s))". The listener's request is still listed, and the headline names what was bound. PASS.
- **Fixture 20:** the same, recomputed from raw rows. PASS.
- **(o′), probe7: the same listener registered on `document.body` instead of `document`.** The listener matches as `element_listener` (currentTarget is body). It is "bound" and entered first, so the headline for both buttons is `→ handler <track> [bound: listener on click (listener on body)]`. `onSaveReal` and `onStateOnly` are listed only under "Observed bound". **FAIL**: change 2 is defeated by moving the global listener one node down. The same holds for a listener on `#root` or `<html>`.

## R3. `handler.via_library`

- **(b1), react-hook-form 7.85 with a named `onValid`, and fixture 21:** a `handler.via_library` row. The abstention reads "no element-bound handler of instrumented code ran; ran through library code on the element chain (not bound to an element prop Tracer can see): [onValid]; global listeners: []", with an extra line "Ran through library code for this dispatch …: onValid". PASS.
- **(i′), a vendor component calling `callback`, and fixture 22:** the same sentence. `viaCallback` is no longer listed as a global listener. PASS.
- **(b2), RHF where `onValid` sends:** `via_library`, and the request is credited by lineage. PASS.
- **(n), lodash `debounce`:** `via_library`. The chain stops at browser with no credit and no false text. PASS.
- **SKILL gloss:** the false "only global listeners" sentence is gone and the library case is explained. However, the ambiguous clause repeats the error in R6.

## R4. Untrusted dispatches

- **(h):** the Schedule click's chain lists "Ran for a dispatch app code caused (not a user event): … as onClick on click (untrusted: el.click() or dispatchEvent)", and that click owns the request. The mount-timer `el.click()` writes `handler.invocation` with `untrusted: true`, `action_id: null`, `cause_abstained: "no_action_on_frame"`. PASS.
- **Fixture 23:** the same from raw rows. PASS.
- **(s5), `dispatchEvent`:** PASS.
- **(p), (q), (r), `requestSubmit()` and a submit button's `.click()`:** invocations with the cause, unchanged. PASS.

## R5. RUN-2 corrections

- **Withdrawal of the native-await claim for RHF:** correct. (b3) binds `onSubmit@submit` in a `dispatch_continuation`, `written_in_prop`.
- **Folded ancestor invocation:** fixed where the event identifies the holder (e, 19). It is still folded for leaf handlers (s3b is one ambiguous row for two invocations), which is disclosed. It is also folded, and mislabelled, for capture/bubble pairs on one host (s6), which is not disclosed.
- **Residual risk 1 (Proxy reads):** disclosed, but it understates two things. The read also happens for library-called component props (s4). A first-party trap then shows up as app work in the rows (R1).

## R6. MCP wording

Every ambiguous binding renders as "one of X/Y (ambiguous: the handler took no event argument to tell which prop React invoked)" (`mcp/tools.mjs:173`). That is false for:
- (s1): the handler took `'custom'`;
- (s1b): it took a pointerdown event;
- (s3) and (s6b): it took the click event, and the capture/bubble naming defeated the lookup.

## R7. Suite and driver at 70fbd740 (my runs, `grader-scratch/runs2/`)

| run | result |
|---|---|
| handler-binding driver, 3 invocations × 3 page loads | 127/127 ×3 |
| negative control on base 53eb8882 (new driver and fixture) | 19/127 |
| verifier over the kept store (126 binding/invocation rows): native type = the dispatching event | holds. The 15 flags are the expected shapes: submit (target is the submitter, holder the form), the `@pro` react-key radio, and untrusted invocations whose action is the causing click or none. |
| `npm test` | 699/700; the only failure is `react-context-ref-semantics.test.mjs:63` |
| D12 ×3 | 23/23, 23/23, 23/23 (no `metaKey` leak in my three runs) |
| continuations-neutral, shadow-dom-context, episode-focus ×3, no-cross-control-neutral, effect-rooted-form-neutral (dependency root argument) | ok |
| trusted-events / outcome-labels / mcp-gaps / body-capture | 79/79, 160/160, 35/35, 51/51 |
| stable-element-keys | 19/19 |
| G4 | 81/81 |
| G6: compare regenerated with base and branch code, then `g6-grader` | 6/6; base and branch output differ only in the echoed store path |
| banked MCP, base vs branch | final7: 58/58 identical. G6: 421/421 identical. Trusted-events: 884/888 texts, the same 3 Escape credits plus `basis: "declared"` ×57. Unchanged from the first grade. |
| `npm run build`; `cmp` src/dist | identical |
| test change `attribution-plugin-passes.test.mjs` | only allows the added `,a0:data`; not weakened |

**Cost.**

| measurement (1,000 clicks unless stated) | branch | base |
|---|---|---|
| depth 200, to handler | 0.225 ms | 0.037 ms |
| depth 200, whole dispatch | 2.43 ms | 2.52 ms |
| depth 10, 500 nested first-party calls per click (200 clicks), whole dispatch | 4.1 / 4.7 ms | 6.1 / 3.7 ms |

At depth 200 the walk still costs about 0.2 ms per click. The new `window.event` read on every non-depth-zero entry is below the noise floor. Both builds lose rows at the store tail under heavy call volume in the same proportion. That is not this PR.

## Required changes (for `merge`)

1. **Capture-phase props.** React's `_reactName` is the bubble name for capture listeners. Never write the bubble prop, and never write `synthetic_event`, for a capture-phase invocation.
   - Use observed phase state to decide `onXCapture` versus `onX`: for example, whether React's root capture listener is the one dispatching. If that cannot be decided, write the row ambiguous.
   - When a function runs twice in one dispatch on one host (s6), write two rows.
   - Add s3, s6 and s6b to the fixture.
2. **Tracer's own read must not create evidence.**
   - While `resolveHolder` reads `a0`, first-party entries it triggers (a getter, a Proxy trap) must not be observed as bindings or `via_library`, and must not be emitted as spine: use a re-entrancy guard.
   - State in G1 that reading `a0` runs app getters/traps. It happens for any object argument of a prop-held function under a React-container dispatch, not only for React's SyntheticEvent.
   - Add s4 to the fixture, asserting that no `handler.*` row and no enter row exists for the trap.
3. **Bound ranking by nearness, not entry order.** A listener on an ancestor element far from the target (`body`, `html`, the React root container) must not outrank the target's own prop-bound handler. Rank bound frames by holder depth from the target: the target's host props and element listeners first, then ancestors. Alternatively, treat listeners on `body`, `html` or a root container as page-level. Either way, unbound request issuers stay listed as now. Add probe7 (the analytics listener on `document.body`) to fixture 20.
4. **Ambiguity text.** Replace "the handler took no event argument" with the reason observed:
   - no argument was seen;
   - the argument was not the dispatching SyntheticEvent;
   - its `_reactName` matched no single holder.

   Fix the same clause in SKILL.md.

## Residual risks after these changes

- Leaf handlers with no parameter held by two props stay ambiguous (disclosed, honest).
- A first-party component that registers its own `on*` prop on `document` is bound or global depending on focus (probe k, unchanged).
- The G1 amendment, the SKILL gloss and my probes are the only coverage of library-called component props with object arguments. The fixture has none until s4 is added.

## Grade at 54886211 (Codex) — 2026-09-24

Independent cross-model grade of `git diff cd91a186...54886211`. I drove the packaged MCP server over stdio, checked raw rows and a separate live fiber walk, and put my scripts and outputs under `grader-scratch/codex/`. The worktree implementation was not edited.

**Verdict: `merge with changes`.** The main claim holds in the exercised dispatches: the checkbox's `onChange` binds to the native `click` that invoked it, and bound credit is observed rather than chosen from a prop-name event table. I found one new reader defect: an unbound page listener's later request is omitted from the explicit unbound-issuer list when the bound handler issued the first request. The request remains visible as a segment, and the credited handler is correct, but the required ownership distinction is missing.

### Raw driver and control

| Run | Result | Independent row check |
|---|---|---|
| Branch driver, three invocations of three page loads | `142/142` each | The third store has 138 `handler.binding` rows. All 138 name the same native event as their trusted `dom.action`, and all 138 have a matching entered function continuation. |
| Fiber walk on an additional headless load of the same fixture | `48/48` driver checks | For 135/138 third-store binding rows, my captured target fiber chain holds the exact function id and listed prop; all nine ambiguous rows list holders found on that chain. The other 3/138 are the inline form callback: the fiber holds the library wrapper, while `placement.bound.onSubmit` contains the callback's exact manifest function index, as the rule permits. Zero missing. |
| Archived `cd91a186` with the branch fixture and driver copied only into my scratch base | `19/142` | State-only checkbox clicks abstain and list their own `onChange` as a global listener. The branch credits `notifyChange` and writes `onChange` on native `click`. |

My raw-row verifier is `grader-scratch/codex/verify-raw.mjs`; its output is `runs/raw-verification.txt`, with the gzipped rows and manifest in `raw/` and the independent event-time fiber snapshots in `fiber-snapshots.json`. The browser snapshots inspect React's actual `__reactFiber$` chain and each prop function through the runtime's exposed `functionIdOf`, rather than trusting the binding row's holder fields.

### Per-rule assessment

| Rule | Result | Raw evidence and black-box check |
|---|---|---|
| Binding comes from function entry under a live trusted dispatch or its bare continuation, with a function id on the target chain | **Pass** | 138/138 action/native-type and continuation matches; 135 direct fiber holders plus 3 inline `placement.bound` callbacks. The driver's checkbox, radio, text, select, range, double click, form submit, Radix pointer/keyboard, Dialog and state-only cases pass across nine page loads. |
| Prop and holder are observed; capture and bubble are separate runs; ambiguity names all candidates | **Pass, with a phase qualification** | My `onClickCapture={h} onClick={h}` child and direct-div clicks each yield two rows. In both, React invokes `h` with native phases `[1,3]`, even when the div itself is the target: React's delegated listener is on the root. A real target-phase path, `onScrollCapture={h} onScroll={h}` on the scrolling div, yields phases `[1,2]`; the phase-2 row is `ambiguous: true`, reason `capture_bubble_undecided`, holders `[onScrollCapture,onScroll]`. Thus the requested click-at-target experiment does not reach phase 2 in this React setup; the target-phase fallback is separately exercised. |
| A non-event library call resolves to the component prop, and Tracer's argument inspection creates no evidence | **Pass** | An uninstrumented vendor click wrapper calls a function held both as component `onChoose` and host `onClick` with a Proxy argument. The first call binds `onChoose` with `holder_resolution: library_call`; React's later call binds `onClick` with `synthetic_event`. The Proxy logs one `getOwnPropertyDescriptor('_reactName')` trap, no getter read and no `function.enter` or `handler.*` trap row. The trap itself is still an app-visible side effect. |
| Declared props never become observed bindings; no element-bound handler means an explicit abstention | **Pass** | The driver's unrun `onContextMenu` is declared only. Its named react-hook-form `onValid` and vendor callback are `handler.via_library`, and MCP states that they ran through library code rather than naming them global listeners. Old stores retain `basis: "declared"`. |
| Bound and nearer handlers outrank page-level listeners; requests from unbound frames are identified | **Fail in one order** | In my ordinary capture case, `document.body`, `document.documentElement` and the React root-container listeners fetch on every click; the button's `onClick` is credited, and their requests appear in `unbound_request_issuers`. In the `Bubble only` case (`action:muggeuzb:118`), the capture listeners return without fetching; sequence 317 binds `save@2922:2955`, 321 requests `/api/save`, 325 enters the unbound `bodyBubble@2125:2171`, and 328 requests `/api/body-bubble`. MCP credits `save` and shows both request segments but omits `unbound_request_issuers` and the “Requests issued by a frame not bound…” line. This follows the reader's conditional computation only when `preferred !== selected`. Raw rows: `raw/probe-bubble-records.jsonl.gz`; black-box result: `probe-results.json`. |
| Caused dispatches are invocations; work stays with the cause | **Pass** | Timer-armed `el.click()` emits `handler.invocation {untrusted:true, invoked_by:"app_code"}` on the arming click, and `/api/programmatic` belongs to that click. A click-caused `focusin` has its own action/invocation id and `caused_by_action_id`, while `/api/focused` belongs to the causing click. |
| Library and keyboard selection | **Pass for dispatch-time invocation** | A controlled Radix Select chosen with Enter emits `onValueChange` as `handler.binding` on native `keydown`, `SelectProvider` on the portal-crossing fiber chain, and MCP credits it. In an uncontrolled Select variant the callback ran later in a state effect: Tracer emitted no binding or false handler credit, while the request remained on the keydown action. React Hook Form's named `onValid` is printed as “Ran through library code”. |
| No static prop-to-native-event map for handler credit | **Pass in the D-G1-22 path; literal repository-wide statement is false** | `EVENT_PROPS` is absent from `src/runtime-attribution-browser.js`; the sole prop-name transform there is `prop.slice(2).toLowerCase()` for a declared stamp display label. The existing `src/producttrace-runtime.js` still uses `click -> onClick` to decide whether a legacy click is meaningful, and `analysis/library-contracts.mjs` has versioned Ariakit callback-prop/activation-event contracts. Neither feeds these `handler.binding` rows or MCP entry-handler credit. The no-map claim should remain explicitly scoped to observed runtime credit. |

### Banked stores and suite

The MCP calls used the same banked rows on an archived `cd91a186` checkout and this branch. Final7: **58/58** text and structured calls identical. G6: **421/421** identical. Trusted-events: **884/888** texts identical; the only changed renderings are three Escape `action_chain`s and their shared `element_history`. The three credits move from document Shortcut `main.jsx@4067-4279` to `onOpenChange@1786-1854`. For each, `/api/dialog-dismissed` is under the `onOpenChange` continuation (`1786:1854 -> 1786:1854 -> send@643:692`); the document listener did not issue it. The other 57 structured changes add `handler_abstention.basis: "declared"` to legacy rows without changing their abstention text. Six G6 compare pairs regenerated from gunzipped records, runs, spans and manifests pass **6/6**; base and branch compare objects differ only in the echoed store path.

| Suite | Result |
|---|---|
| Handler binding | 142/142 ×3; archived-base negative control 19/142 |
| Trusted events | 118/118 |
| D12 | 24/24 ×3, including body-on neutrality; no event-order failure this run |
| Continuations neutral; episode focus | `status: ok`; episode focus stable ×3 |
| Shadow DOM; no-cross-control; effect-rooted form | `status: ok`; effect-rooted passed with the specified LibreChat dependency root (the first invocation used its unavailable default `/tmp` dependency path and failed to load Playwright) |
| Outcome labels; MCP gaps; body capture | 169/169; 35/35; 51/51 |
| Stable element keys; honest coverage; unlinked coverage | 19/19; 45/45; 13/13 |
| Function names; middleware reads; client aborts; server outbound `--runs 3 --control` | 263/263; 343/343; 245/245; 170/170 |
| G4; G6 | 81/81; 6/6 |
| `npm test`; source/dist comparison | 730/731: only `react-context-ref-semantics.test.mjs:63` (`'a' !== 'b'`); `cmp` byte-identical |

### Cost and remaining limits

I reran a depth-200 nested-component fixture with 600 trusted clicks per build, measuring in-page from a window capture listener to the handler's first line. The branch mean was **0.236 ms** (repeat **0.239 ms**), p95 **0.3 ms**; the archived base means were **0.029** and **0.033 ms**, p95 **0.1 ms**. The added dispatch cost is about **0.20–0.21 ms per click** on this run. Whole-dispatch means were 2.45–2.56 ms branch versus 2.13–2.29 ms base; uninstrumented mean was 0.078 ms. These are loaded-machine timings, not a browser-wide budget. The rapid-click harness navigated away with collector work pending (the repeated branch run retained 423 click actions for 600 clicks), so the in-page latency result is not a losslessness test.

Residual limits: a Proxy descriptor trap remains observable to the app; React invoker classification still relies on React's container marker; a callback reached later through a state effect is not a dispatch-time binding; pre-observation stores cannot regain runtime facts. The literal whole-repository no-map wording needs the scope qualification above.

**Required change for `merge`:** compute and print `unbound_request_issuers` for every credited bound frame, including when that frame is already the initial `selected` candidate. Add the “bound request first, body bubble request later” case so both request orders identify the page listener as unbound without changing the credited handler.
