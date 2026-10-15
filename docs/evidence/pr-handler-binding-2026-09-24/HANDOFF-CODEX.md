# Handoff: `fix/handler-binding` (D-G1-22), stopped at the coordinator's request (2026-09-24)

This is a handoff, not a RUN or a grade. RUN.md, RUN-2.md and GRADE.md are unchanged. No RUN-3.md was written, because the keep-green set was not rerun for the regrade changes (see "Not yet verified").

- **Head:** the commit that adds this file. It sits directly on d3caeb3e ← 5c20b944 ← 7d735ace (the regrade).
- **Base:** `origin/fix/trusted-events` 53eb8882. The branch is stacked on it, and it is not rebased onto main.
- **Worktree:** `/Users/austinho/dev/tracer-b-handler-binding`, with `node_modules` symlinked to `/Users/austinho/dev/tracer/node_modules`. `grader-scratch/` is the grader's and is untracked.

## The four regrade items (GRADE.md, "Regrade at 70fbd740")

| # | item | status | commit | evidence (on this head) |
|---|---|---|---|---|
| 1 | Capture-phase props, one row per run | **DONE** | 5c20b944 (runtime `resolveHolder`), d3caeb3e (fixture 24–26, checks C29–C31) | driver, 1 page load: C29 (ancestor `onClickCapture={h}` + target `onClick={h}` → two rows, `onClickCapture`/div and `onClick`/button, both `synthetic_event`); C30 (one div with both props → two rows); C31 (capture-only ancestor binds `onClickCapture`, credit goes to the target's own `onClick`) |
| 2 | Tracer's argument read creates no evidence; G1 note corrected | **DONE** | 5c20b944 (`readSynthetic`, `ownValue`, `inspectingArgument` guard in `enter`), d3caeb3e (fixture 27, C32; G1 second amendment) | C32: the app's Proxy log shows no `get:` of `_reactName`/`nativeEvent` (only `gopd:_reactName`, which is unavoidable on a Proxy); no `function.enter` or `handler.*` row for any trap; the library's call binds the component prop `onSelect` (`library_call`); React's call binds the div's `onClick` (`synthetic_event`) |
| 3 | body/html/root-container listeners are page-level; rank bound frames by nearness | **DONE** | 5c20b944 (`pageLevelNode`, `listenerDistance`, `holder_distance`; terminal-owner tie-break; analysis ranking in `indexEntryHandlerUnits`), d3caeb3e (a `trackBody` listener on `document.body` added to fixture 20; C25 extended) | C25: Save real credits `onSaveReal` and State only credits `onStateOnly`; both `track` (document) and `trackBody` (body) are listed as unbound request issuers; no `handler.*` row for `trackBody` |
| 4 | Ambiguity text states the observed reason | **DONE** | 5c20b944 (`ambiguity_reason` on rows; `AMBIGUITY_REASONS` and `bindingPhrase` in `mcp/tools.mjs`), d3caeb3e (SKILL.md, C33) | C33: cases 15 and 17 print "ambiguous: the handler received no argument"; no text says "took no event argument" |

## Verified on this head

- `npm run build` and `cmp src/runtime-attribution-browser.js dist/runtime-attribution-browser.js`: byte-identical.
- `npm test`: 700 tests, 699 pass. The one failure is the known `react-context-ref-semantics`.
- Handler-binding driver with `TRACER_BINDING_RUNS=1`: 48/48.

## Not yet verified (the next agent must run these, then write RUN-3.md)

- The driver with 3 page loads, run 3 times.
- The negative control.
- The keep-green set: D12 ×3, trusted-events, continuations-neutral, episode-focus ×3, shadow-dom-context, no-cross-control-neutral, effect-rooted-form-neutral, outcome-labels, mcp-gaps, body-capture, stable-element-keys, G4 and G6.
- The grader's probes s1–s6b and probe7: `grader-scratch/probe{5,6,7}-driver.mjs`.
- Banked MCP base-vs-branch.

Expected risk areas, and the reasons for each:

- **Nearness ranking.** Ranking now also changes which bound frame is credited when several ran, and the runtime terminal owner, which feeds `dom.mutation.parent_continuation_id` and the request fallback. Watch continuations-neutral, shadow-dom-context and episode-focus.
- **`pageLevelNode`.** It now drops element-listener bindings on `body`, `html` and React containers. Watch shadow-dom-context (listeners on shadow roots and hosts should be unaffected) and continuations-neutral (the native listener sits on an `<input>`, which is fine).

## Commands

```sh
cd /Users/austinho/dev/tracer-b-handler-binding
npm run build && cmp src/runtime-attribution-browser.js dist/runtime-attribution-browser.js
npm test                                                       # 699/700, known react-context-ref-semantics
# driver (3 page loads; keep the third invocation's store for evidence)
for i in 1 2 3; do TRACER_KEEP_STORE=$([ $i = 3 ] && echo 1 || echo 0) node test/browser/handler-binding.mjs > runs-3/handler-binding-$i.txt; done
# negative control: base worktree at 53eb8882 with this branch's driver, fixture and fixture-build copied in
git worktree add --detach /tmp/hb-base 53eb8882 && ln -s /Users/austinho/dev/tracer/node_modules /tmp/hb-base/node_modules
cp test/browser/handler-binding.mjs test/browser/fixture-build.mjs /tmp/hb-base/test/browser/ && cp -r test/browser/fixtures/handler-binding-app /tmp/hb-base/test/browser/fixtures/
(cd /tmp/hb-base && node test/browser/handler-binding.mjs)     # prints the FACTS table; expect base abstentions/false credits
# keep-green set
for i in 1 2 3; do node test/browser/episode-focus.mjs; done
node test/browser/trusted-events.mjs
node test/browser/continuations-neutral.mjs
node test/browser/outcome-labels.mjs; node test/browser/mcp-gaps.mjs; node test/browser/body-capture.mjs
node test/browser/shadow-dom-context.mjs; node test/browser/stable-element-keys.mjs; node test/browser/no-cross-control-neutral.mjs
node test/browser/effect-rooted-form-neutral.mjs /Users/austinho/dev/trace-consolidated/.live-demo/librechat-m1
for i in 1 2 3; do node test/browser/d12-stamp-neutrality.mjs; done
node test/g4-grader.mjs docs/evidence/m1-2026-09-22-final7 --manifest docs/evidence/g4-mcp-2026-09-23/manifest.json   # 81/81
# G6: gunzip docs/evidence/g6-anything-llm-2026-09-23/store/{*.jsonl.gz,manifests/*.json.gz} into <g6store>, then
node test/browser/g6-compare.mjs --store <g6store> --source-root /Users/austinho/dev/fixtures/anything-llm --out <out> --step rename-workspace --event submit \
  --pair A-baseline:B-seeded-422 --pair B-seeded-422:C-fix-r2 --pair A-baseline:C-fix-r2 --pair A-baseline:D-noop-refactor --pair A-baseline:E-frontend-early-return --pair B-seeded-422:C-fix
node test/g6-grader.mjs <g6store> --compare <out>                                                                       # 6/6
# banked sweeps: scripts in docs/evidence/pr-handler-binding-2026-09-24/banked-2/ (sweep.mjs <baseRoot> <branchRoot> <records...>; mcp-all.mjs; diff.mjs)
```

## Rebase plan

1. **Onto `fix/trusted-events`' next head.** Do this when the coordinator says its nine-item round is pushed. The expected conflicts are in `src/runtime-attribution-browser.js` (the `capture.page` field block next to `input_text`, and `beginDomAction` / `actionFrame`) and in `plugin/skills/tracer-annotations/SKILL.md` (adjacent bullets). Keep both sides. Rebuild `dist` and cmp.
2. **Then onto `origin/main` 39449f7a.** Integration points:
   - **#18, window facts and coverage reasons.** Chains now carry window facts, and `coverage.reasons` / `unobserved` are measured. The abstention objects built in `indexEntryHandlerUnits` (`analysis/runtime-attribution.mjs`: `abstentions.set(... basis: 'observed' ...)`) and the `renderBindings` lines in `mcp/tools.mjs` must sit beside those facts without changing their text. Check that `coverage.unobserved` does not need a new entry for untrusted dispatches, which are now observed as `handler.invocation` rows.
   - **#19, names.** Binding rows carry `function_id` only; the MCP labels them through `store.functionInfo` (`bindingLabel`). With #19's names, the abstention `because` text still lists raw ids in `global listeners: [...]` and in `ran through library code …: [...]`. Decide with the coordinator whether those lists should use names. `SCOPED_ABSENCE.no_bound_handler_ran` and `handler_via_library` are fixed prefixes that tests match with regex (`test/browser/continuations-neutral.mjs`, `test/browser/handler-binding.mjs` C8, C26, C27, M6).

## Known traps

- **The argument-read guard.**
  - `readSynthetic` sets `inspectingArgument`. While it is set, `enter()` returns an unrecorded frame (`suppressed: true`, parent = current), and `exit()` restores it.
  - Never add a read of the argument outside `readSynthetic`, and never use a getter-invoking read: use `ownValue`, which goes through `getOwnPropertyDescriptor`.
  - The read happens only when a host prop on the chain holds the function and React's container is the currentTarget.
  - A Proxy's `getOwnPropertyDescriptor` trap still runs. That is disclosed and cannot be avoided.
  - `a0` is passed by the transform (`firstArgMeta` in `integrations/runtime-attribution.mjs`) for plain-identifier first parameters, and by the call proxy in `tag()` only when it was called with arguments.
- **Capture-phase detection.**
  - React labels the SyntheticEvent with the bubble name (`_reactName: "onClick"`) in the capture pass. The pass is read from the native event's `eventPhase` while React's container is the currentTarget: `1` capture, `3` bubble, `2` undecided.
  - This holds for delegated events. For React's non-delegated events (listened on the element itself: scroll, toggle, invalid, load, media), `eventPhase` is `2` at the target, so both names stay candidates. Expect `capture_bubble_undecided` there.
  - The dedup key includes the prop, so one function run in both passes on one host writes two rows.
- **body/html/root-container listeners.**
  - `pageLevelNode` treats `document.body`, `document.documentElement` and any element React marks as a listening container that React did not render (`_reactListening…` without `__reactFiber$`) as page-level. Listeners there are never bindings and never `handler.via_library`.
  - A portal container that is a React-rendered element is not page-level.
  - A first-party listener on a non-React wrapper element is still element-bound. Its distance is measured on the DOM path, not in fiber hops (`listenerDistance`), so comparisons with prop holders are approximate.
- **Credit ranking** (`indexEntryHandlerUnits`, observed-basis branch):
  - Among bound frames, the first that issued a request by its own continuation lineage wins, nearest first. Otherwise the nearest bound frame owning the evidence, otherwise the nearest. Unbound issuers are listed as `unbound_request_issuers`.
  - The runtime's terminal owner applies the same rule: priority 3 for bound frames, tie-broken by `bound_distance`.
- **`library_call`.** When the argument is seen and is not React's event for the dispatch, host holders are excluded: React always passes its event to host props. A component prop wins if one holds the function; otherwise the row is ambiguous with the reason.
- **Rows before this pass.** Old stores have none of these rows or fields, and the declared-list rule applies to them unchanged. The banked comparisons in `banked-2/` should stay as they are, and must be rerun to confirm.
