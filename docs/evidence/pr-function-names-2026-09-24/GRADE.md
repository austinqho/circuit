# fix/function-names: independent grade (2026-09-24)

Grader: independent agent. I did not write this branch. I did not rely on RUN.md, the test names or the author's summaries: every number below was recomputed from manifests, rows and MCP output I produced myself.
Branch `fix/function-names`, head 3477dcb1, rebased on `main` dca34f90. Worktree `/Users/austinho/dev/tracer-n1-function-names`.
Grader scripts and probe sources are in `grader-scratch/` in that worktree. They are untracked and not committed. Builds and stores were deleted after the run.

**Claim under test.** Every instrumented function has the name the source gives it, recorded at build time, in every build mode, and error types are named as the source names them.

## Verdict: `merge with changes`

The build-time naming works as claimed:

- **Names:** correct on the fixture, on my TypeScript probes and on two real checkouts.
- **Modes:** the three build modes agree.
- **Stability:** ids and build ids do not change.
- **Error types:** the production error type is fixed.
- **Banked stores:** they lose no name and no label.

Two rules are wrong in ways that print a wrong answer. A third problem is one misleading sentence of agent guidance. All three changes are small.

Required changes, the exact list:

1. **The callback-parameter rule resolves the callee by name, not by binding** (`integrations/function-names.mjs`, `visitScope` / `visibleCallee`). Only these names are registered:
   - function declarations;
   - `const x = <fn>` with an identifier name;
   - plain identifier parameters.

   Imports, destructured variables (`const { update } = useStore()`), destructured parameters (`function List({ setItems })`), array patterns (`const [v, setV] = useState()`), class names, and `catch`/`for` bindings are never registered. As a result, a call to an imported or destructured function is named after the parameter of an unrelated same-named function declared anywhere else in the file. The wrong name is recorded as `name_kind: "callback"` and printed with `name_status: "manifest"`. See probes P24–P27 below. It reproduced in a real headless production build: the MCP work listing printed `misnamed (callback of runLater) … [manifest]`.

   Fix: register every binding identifier of the file, so that any second binding makes the name a duplicate. The simplest form counts import specifiers, binding-pattern elements, destructured parameters, class and enum names, and catch/for-of variables as declarations. Better, and stricter, is to resolve the call's identifier through the enclosing scopes and name the callback only when that resolves to the declaration. Add the four probe shapes to `test/function-names.test.mjs`.
2. **Remap compares `display_name`, which carries the export decoration** (`collector/store.mjs` `remapFunctionId`, `nameKey`). Take a function `handleUpdate` whose revision adds or removes `export default handleUpdate` (or `export { handleUpdate as x }`). Its display is `handleUpdate` in one manifest and `handleUpdate (exported as default)` in the other. `name_match` then fails with the false reason `name_match: no function named handleUpdate` and falls to `ordinal`/`unmapped`. `grader-scratch/remap-probe.mjs` shows the result `unmapped`. Without the export change the same function maps by `name_match`. On `main` (text-rule `name`) this case maps. For build-time manifests it is a regression, and it breaks exactly the G6 "no-op refactor" shape. Fix: compare the owner-qualified name without the ` (exported as …)` suffix, for example a separate `qualified_name` field or `display_name` with the suffix stripped. Add a unit test.
3. **Agent guidance conflates the two meanings of `inferred`** (`plugin/skills/tracer-annotations/SKILL.md` and the G4 amendment). The skill says an `inferred` function "has no name of its own … say it that way, not 'the function handleSave'". On every banked store, however, `inferred` also covers text-rule names that are real declarations. On final7, `resubmitMessage` is a `function resubmitMessage` declaration and now reads `name_status: "inferred"` with a non-null `name`. An agent following the skill would refuse to call it by its name. Fix: state that when `name` is non-null and `name_basis` is a text rule, the name is the checkout's declaration read by the old text rule. Alternatively, give old-store names their own status, e.g. `text_rule`. This is doc-only, or a one-line vocabulary change with the tests that pin it.

Everything else below is a pass, a disclosed limit, or a recommendation. None of it blocks the merge.

## Per-rule table

| # | rule | verdict | evidence (recomputed) |
|---|---|---|---|
| R1 | Names come from the AST at instrumentation time, with `name_kind` and `display_name` on every row | PASS | Every manifest row of every build I made carries both fields: fixture 54/54, probe app 50/50, anything-llm production build 5,101/5,101. I read the fixture's 54 rows against the source by hand (list in §Fixture). All are correct. |
| R2 | Abstain rather than guess: computed keys, JSX attribute values, array elements, conditionals, returned functions, IIFEs | PASS | Probes P5, P7, P13, P19–P22. Each is `name: null`, and each display names the position (`<computed key>`, `<button onClick>`, `<anonymous>`). A named IIFE keeps its own name (`boot`), which is correct. |
| R3 | A function passed as the first argument of a call whose result is bound keeps the binding only as context | PASS | `const slugs = items.map((x) => …)` gives `name: null`, `inferred`, `slugs = items.map(<callback>)`, not `slugs` (P14). `const handleSave = useCallback(…)` gives `name: null`, `name_status: "inferred"`, and `handleSave = useCallback(<callback>)` in the entry stop, the work listing, the label and the text line (P15). An agent still sees `handleSave`, marked as context. `Object.assign(fn, {…})` also abstains (P6). Object.assign returns the function itself, so the binding would be the name. The abstention is conservative, not wrong. |
| R4 | Callbacks are named by the callee's parameter only when the callee is declared in the same file under a unique name | **FAIL** | Required change 1. P24–P27: the callee is imported, destructured or a destructured prop, and an unrelated same-named function elsewhere in the file supplies the name. The status is `manifest`. On the real checkouts the rule names 4 callbacks on anything-llm (`handler (callback of stop)` in JobRow.jsx). I checked all 4 by hand and they are correct. It names none on LibreChat final7, so the live impact today is small. The rule is still wrong. |
| R5 | The runtime never infers names | PASS | The runtime diff adds only `registerClass` (a WeakMap from class object to id, by identity) and `error_builtin` (`global[ctor.name] === ctor`, identity). `error_type` is the unchanged `constructor.name`, and readers relabel it `minified`. |
| R6 | Error types go through the manifest `classes[]` keyed by span id, `error_builtin` marks platform constructors, and a minified name is never printed as the source name | PASS, with a disclosed gap | Production `AppError` gives `{minified:"pe", source:"AppError", source_basis:"manifest"}` and the text `handler_threw (AppError)`. `class MyCancel extends CancelledError` (library base) gives `{me, MyCancel, manifest}`. `const E = class extends Error {}` gives `{fe, E, manifest}`. `new TypeError()` gives `{TypeError, TypeError, builtin}`. A library `CancelledError` thrown directly gives `{b, null, not_recorded}` and the text `runtime type b`. The last is honest but useless to an agent. `export default class extends Error {}` is not registered in any mode: production `runtime type ne`, dev `runtime type errDefault_default` (a bundler-made name, marked as runtime). RUN.md discloses this. In no case was a minified name printed as a source name. |
| R7 | Dev, production and dev-server builds give identical names | PASS | Fixture: production vs development vs dev server, 54/54 shared ids with identical name fields in each pair, and identical `classes[]` (4). Probe app: 50/50 in each pair, identical `classes[]` (7). |
| R8 | Function ids are unchanged | PASS | I built from a `git archive` of dca34f90 with the same fixture and the same paths. Fixture production and development: the same 54 ids, the same placements, the same build id `12a913e59e5d`. Probe app: the same 50 ids, build `1adc6b1e68c9`. anything-llm full production build, main vs branch: the same 5,101 ids, and build id `e061322a6809` is equal on both and equal to the banked G5c manifest. The `index` values differ between builds, but main-vs-main differs too (38 of 54): pre-existing nondeterminism, not this branch. |
| R9 | Every reader uses the manifest name with `name_status: manifest \| inferred \| anonymous` | PASS, with a doc issue | Through MCP over stdio on my production and development probe stores, the entry stop, the work entries, the labels, the `resolve_element` handlers and the chain text all print `display_name` with a status. Old manifests fall back to the text rule as `inferred` with `name_basis`. Required change 3 covers the guidance text. |
| R10 | Remap compares build-time names | **FAIL (regression)** | Required change 2. |
| R11 | Banked stores: no name or label change, only statuses | PASS | Table below. |
| R12 | Build rule vs old text rule on real checkouts: never conflicts | PASS | Reproduced exactly, 0 conflicts. 40 samples judged (§Real checkouts). |
| R13 | The `mcp-gaps` expectation change | PASS | `<callback of fetch().then().catch>` has `name: null` and `name_status: "anonymous"`. It is an abstention with position context, not a name. `<callback of useEffect>` is the same. |

## Fixture (driver rerun, manifests read by hand)

`node test/browser/function-names.mjs --out grader-scratch/driver-out --keep`: **248/248**, 24 s.

I dumped the production manifest and read each row against `test/browser/fixtures/function-names-app/src/*`. JSX files are stamped, so their offsets index the stamped text, and I matched those rows by display and order.

All 54 rows are correct. They include:

- `ApiError.constructor`
- `ApiClient.{constructor, baseUrl (getter), baseUrl (setter), count, get, post, send}`
- `describeStatus`
- `formatTitle (exported as titleCase)`
- `<callback of text.trim().replace>`
- `withRetry`
- `default (helpers.ts)`
- `renderBadge`
- `handlers.onPing`
- `<callback of fetch().then>`
- `handlers.describe`
- `Tally.{constructor,bump}`
- `<callback of Object.values().forEach>`
- `Shell`
- `<button onClick>` ×3
- `Greeter.greet`
- `About`
- `onGreet`
- `Row`
- `TextField = forwardRef(<callback>)`
- `runLater`
- `explode`
- `Home (exported as default)`
- `todos/addTodo/removeTodo = useTodos(<callback>)`
- `saveTodo`
- `useMutation({ onSuccess })`
- `useMutation({ mutationFn })`
- `handleAdd`
- `job (callback of runLater)`: correct here, because `runLater` really is the only binding of that name
- `handleRemove`
- `handleFail`
- `count = withRetry(<callback>)`: `withRetry` is imported, so the callback correctly gets no parameter name
- `<callback of todos.map>` ×2
- `ApiClient_count`
- `useTodos = create()(<callback>)`
- `useTodos.{addTodo, removeTodo, clear}`
- `<callback of set>` ×2
- `todos: state.todos.filter(<callback>)`
- `<computed key>`

Classes: `ApiError extends Error`, `ApiClient`, `Greeter`, `Tally`.

The fixture never exercises a shadowed callee, so it cannot catch R4.

## My probes (TypeScript fixture `grader-scratch/probe-app/`)

I built the probe app in production, development and dev-server modes with the branch's plugins, then drove the production and development builds headless through the real collector. I read the result through `mcp/server.mjs` over stdio (`grader-scratch/probe-drive.mjs`). The manifests are identical in all three modes (50/50, classes 7/7).

| # | source | manifest (identical in all modes) | runtime / MCP | verdict |
|---|---|---|---|---|
| P1 | `export default async function () {}` | `default`, export_alias, `default (defaultAsync.ts)` | | pass |
| P2 | `export default async function loadAll() {}` | `loadAll`, declaration, `loadAll (exported as default)` | | pass |
| P3 | three overload signatures plus an implementation of `over` | one row, `over`, declaration | work: `over … [manifest]` | pass |
| P4 | `export const ident = <T,>(x: T) => x` (tsx) | `ident`, binding | `ident … [manifest]` | pass |
| P5 | `forwardRef<HTMLButtonElement, P>((props, ref) => …)` | **absent from the manifest** | clicking inside it gives "no instrumented function ran for this action" | confirmed: not instrumented at all. The disclosure (RUN.md residual risks, G2 amendment) is accurate and correctly scoped as a boundary rule. It is common, though: LibreChat has 86 `forwardRef<` sites and about 52 other type-argument calls with a function argument (`useMemo<T>(() => …)`, `useState<T>(() => …)`), all uninstrumented. It needs its own claim soon. |
| P6 | `Object.assign(() => 'meta', {…})`, `Object.assign(function () {…}, {…})` | `null`, inferred, `withMeta = Object.assign(<callback>)` | `[inferred]` | acceptable abstention |
| P7 | `function makeHandler(l) { return () => l }`; `const onFactory = makeHandler('x')` | returned arrow: `null`, anonymous, `<anonymous>` | `<anonymous> … [anonymous]` | pass. Not named `onFactory`. The display could say "returned by makeHandler". |
| P8 | `const { a = () => 7 } = props` | `a`, binding | `a … [manifest]` | pass |
| P9 | `const E = class extends Error {}` | class `E`, binding, `extends: Error` | prod `{fe, E, manifest}` | pass |
| P10 | `export default class extends Error {}` | not in `classes[]` in any mode | prod `runtime type ne`, dev `runtime type errDefault_default`, `source: null` | honest abstention (disclosed). A source name `default (errDefault.ts)` was available. |
| P11 | decorated method `@logged run()` | `run`, method, `Svc.run` | the bundle does not run: Vite 8 leaves `@he run()` unlowered and Chromium throws `SyntaxError`, identically on `main` (not this branch) | names: pass |
| P12 | `{ onA: () => 1 } satisfies …`; `(() => 2) satisfies …`; `{ go: () => 3, stop() {} } as const` | `handlersS.onA`, `fnS`, `table.go`, `table.stop` | `[manifest]` | pass |
| P13 | `<button onClick={() => setN(n + 1)}>` | `null`, anonymous, `<button onClick>` | entry `<button onClick> [anonymous]` | pass |
| P14 | `const slugs = items.map((x) => …)` | `null`, inferred, `slugs = items.map(<callback>)` | | pass: not named `slugs` |
| P15 | `const handleSave = useCallback(() => …, [])` | `null`, inferred, `bound_to: handleSave` | entry stop `display_name: "handleSave = useCallback(<callback>)"`, `name_status: "inferred"`. Text: `→ handler handleSave = useCallback(<callback>) src/App.tsx@733-768` | pass. The agent sees `handleSave`, marked as context. |
| P16 | thrown `class AppError extends Error` (production) | class `AppError` | `{minified:"pe", source:"AppError", source_basis:"manifest"}`, `handler_threw (AppError)` | pass |
| P17 | thrown `class MyCancel extends CancelledError` (TanStack library base) | class `MyCancel`, `extends: CancelledError` | `{me, MyCancel, manifest}` | pass |
| P18 | thrown `new TypeError('t')` | | `{TypeError, TypeError, builtin}`, `handler_threw (TypeError)` | pass |
| P18b | thrown library `new CancelledError()` directly | | prod `{b, null, not_recorded}`, `runtime type b`; dev `runtime type CancelledError` | honest, never passed off as a source name |
| P19 | `cond ? () => 'a' : () => 'b'` | anonymous ×2 | | pass |
| P20 | `globalThis.cb ?? (() => 0)` | anonymous | | pass |
| P21 | `(() => 5)()`; `(function boot() {})()` | anonymous; `boot` declaration | | pass |
| P22 | `[() => 1, () => 2]`; `{ ['k' + 1]: () => 1 }` | anonymous; `<computed key>` | | pass |
| P23 | `this.onTick = () => {}` in a constructor | `onTick`, property, `Wire.onTick` | `[manifest]` | pass |
| **P24** | `import { runLater } from './lib'`; `runLater(() => …)`; and an unrelated `function unrelated() { function runLater(misnamed) {} }` in the same file | **`misnamed`, callback, `misnamed (callback of runLater)`** | MCP work: `runLater src/lib.ts@0-50 [manifest]` then **`misnamed (callback of runLater) src/probes.ts@1425-1472 [manifest]`** | **FAIL**: the callee is the import; the name comes from an unrelated function |
| **P25** | `const { schedule } = api`; `schedule(() => 1)`; and an unrelated nested `function schedule(wrongParam) {}` | **`wrongParam (callback of schedule)`** | MCP work: **`wrongParam (callback of schedule) … [manifest]`** | **FAIL** |
| **P26** | the React shape: `Editor` has `const { update } = useStore(); update(() => ({ saved: true }))`; the same file's `Preview` has `const update = (patch) => …` | **`patch (callback of update)`** (checked through `buildNameIndex`, the same function the build calls) | | **FAIL** |
| **P27** | `function List({ setItems }) { setItems((prev) => …) }` plus another component's local `function setItems(nextList) {}` | **`nextList (callback of setItems)`** | | **FAIL** |
| P28 | `export default () => 'anon default'` | **not instrumented in any mode** (the dev-server transform too). Identical on `main`. | | pre-existing boundary gap, outside this claim. Not disclosed: the module comment lists `export default () => …` as an `export_alias` example that cannot currently occur. |

## Banked stores vs main (reader only)

`grader-scratch/banked.mjs` is my own extractor. For every manifest function it records `functionInfo`. For every action it records the full `action_chain` summary, the entry stop, the work entries, the outcome label and the signals' `error_type`. I ran it with a `git archive` of dca34f90 and with the branch. `banked-diff.mjs` compares the two runs.

- G5 manifests were gunzipped into scratch copies.
- For G6, the store's rows were combined with the remap-bases manifests, as that run's RUN.md reproduces it.

| store | functions | name changed | label changed | status moves | actions | text changed | of which only the added listener line | entry / work / outcome / signal changed |
|---|---|---|---|---|---|---|---|---|
| final7 + G4 manifest + LibreChat checkout | 1,640 | 0 | 0 | 433 `source`→`inferred`, 213 `source_via_call`→`inferred` | 54 | 0 | n/a | 0 / 0 / 0 / 0 |
| G5 23c + anything-llm | 5,101 | 0 | 0 | 1,807 `manifest`→`inferred` | 151 | 13 | 13 | 0 / 0 / 0 / 0 |
| G5 codex part B + anything-llm | 5,101 | 0 | 0 | 1,807 `manifest`→`inferred` | 78 | 19 | 19 | 0 / 0 / 0 / 0 |
| G6 + remap-bases manifests | 5,109 | 0 | 0 | 1,811 `manifest`→`inferred` | 408 | 0 | n/a | 0 / 0 / 0 / 0 |

- The 32 G5 abstention texts (13 + 19) each gained exactly one line and lost none. The line reads `No element-bound handler credited; global listeners that ran: onKey …MicButton/index.jsx:33, handleKeyDown …keyboardShortcuts.js:108, toggleSidebar …; bound to the element: hideModal …NewWorkspace.jsx:75`. Nothing else changed. The line prints labels without a status marker. On these stores those names are all text-rule (`inferred`) names.
- **"Old error rows print `runtime type TypeError`".** The mechanism is true: `errorTypeOf` returns `source: null` for a row without `error_class_id` or `error_builtin`, and `errorTypeText` prints `runtime type <name>`. It is not exercised by any banked store in scope, though. final7, both G5 stores and G6 contain **zero** `error_type` rows and zero `action.uncaught_error` rows, and no banked text changed because of it. The statement is honest as a description of the code. It is not evidence, and it is a mild readability regression for old rows whose builtin name was already right. A reader could treat a runtime name that is also a platform global (`TypeError`, `DOMException`) as `builtin` for old rows too. That is a recommendation, not a requirement.

## Real checkouts: build rule vs old text rule

I reran the author's `rule-vs-text.mjs` with the branch code, read-only against the checkouts. Both checkouts were at the recorded commits (LibreChat 45cc53c, anything-llm ad97bc8), and `git status --porcelain` was empty before and after.

| checkout (manifest) | rows matched | agree | build only | text only | **conflicts** |
|---|---|---|---|---|---|
| LibreChat (G4 manifest) | 1,640 | 1,243 | 157 (all `declaration`) | 240 (210 inferred, 30 anonymous) | **0** |
| anything-llm (G5c manifest `e061322a6809`) | 5,101 | 4,191 | 668 (610 declaration, 53 property, 1 method, 4 callback) | 242 (232 inferred, 10 callback) | **0** |
| anything-llm (G6 build `b-2dc9ecff…`) | 5,101 | identical to the row above | | | **0** |

These numbers equal the committed `rule-vs-text-*.json` stats exactly.

Caveats on reading the comparison:

- "Agree" includes both rules abstaining.
- The text rule never names a callback, so a wrong callback-parameter name (R4) can never show up as a conflict. I therefore listed every callback-parameter name the build rule gives on both checkouts (`grader-scratch/cb-named.mjs`). There are 4 on anything-llm, `handler (callback of stop)` at JobRow.jsx:62/70/78/89, and `const stop = (handler) => …` is the only `stop` binding in that file, so all 4 are correct. There are none on LibreChat.

**20 build-only names** (seeded random, 10 per checkout). All 20 are correct: they are exported declarations and default exports the text rule missed, plus one object-literal member.

- LibreChat:
  - `ModelSelector (exported as default)`
  - `getRole`
  - `mapAttachments`
  - `mapAgents`
  - `buildIndex`
  - `getLocalStorageItems`
  - `resolveShortcutBindings`
  - `getMessageCacheIds`
  - `reconcileMessageContentLayout`
  - `useAdaptiveSSE (exported as default)`
- anything-llm:
  - `useAppVersion (exported as default)`
  - `DefaultSystemPrompt (exported as default)`
  - `EditEmbedModal (exported as default)`
  - `ChatRow (exported as default)`
  - `useSilenceDetector (exported as default)`
  - `EditPresetModal (exported as default)`
  - `Memory.demoteToWorkspace` (`demoteToWorkspace: async function (…)` in `const Memory = {…}`)
  - `BaiduSearchOptions`
  - `VisibilityIcon`
  - `SystemPrompt (exported as default)`

**20 text-only names that the rule now leaves null** (seeded random, 10 per checkout). All 20 are correct abstentions:

- **18 are `x = useMemo/useCallback/memo/.filter(<callback>)` shapes.** The binding holds the call's result, so it is not the function's name, and the display keeps it as context. Examples: `agentProvider = useMemo(<callback>)`, `handleLineCountChange = useCallback(<callback>)`, `MessageIcon = memo(<callback>)`, `downloadedModels = customModels.filter(<callback>)`, `copyTimeoutRef.current = setTimeout(<callback>)`.
- **1 is the old final7 span that starts at the callee.** At `data?.authTypes?.some(([, authType]) => …)`, the text rule said `some`. The rule gives `<anonymous>`, because the old span does not match a function node. This case is disclosed.
- **The anything-llm `callback` text-only rows are real improvements** (10 listed, 10 correct). The text rule named chained-call callbacks after the chain's result: `slugs` for `threads.filter((t) => …).map(…)`, `providerName` for `….find(…)?.name`, `count` for `ids.filter(…).length`. The rule gives `<callback of threads.filter>` and similar.

The real anything-llm production build (below) has the same `name_kind` distribution as the script's count on the checkout: declaration 1,365, binding 464, property 586, callback 1,689, anonymous 715, inferred 275, method 7. The build and the script agree.

## Cost and safety of class registration

Measured by building with `main` (dca34f90 archive) and with the branch, same inputs, production and minified unless stated.

| build | main JS bytes | branch JS bytes | delta | classes registered |
|---|---|---|---|---|
| fixture, production | 598,406 | 598,982 | +576 (+0.10%) | 4 |
| fixture, development | 1,036,307 | 1,036,935 | +628 | 4 |
| probe app, production | 255,300 | 256,285 | +985 | 7 |
| anything-llm frontend, full production build | 15,246,832 | 15,247,010 | **+178** (+0.001%) | 1 (`PiperTTSClient`) |

**Behaviour change: dead classes are kept.** I added a module to the probe app with an unused exported class, an unused local class and an unused `export const X = class {}`, each with a unique marker string in a method. `main` tree-shakes all three (0 markers in the bundle). The branch keeps all three, because `registerClass?.(X, id)` references each one.

Classes with `static {}` blocks were kept by `main` as well: the bundler already treats static blocks as side effects. So "static blocks run" is not new in what I measured. The new cost is dead-class retention, and with it anything those classes import.

Judgement: **acceptable.** Instrumented builds already keep every function declaration through `registerFunction`, and the measured cost on a real app is 178 bytes. React apps rarely declare many classes. The G2 amendment should still say it plainly ("instrumented builds keep unused first-party classes, and their imports"), and the one-line install docs should mention it.

A lazier design would keep tree-shaking and is worth considering later: register from the class's own constructor path, or emit the registration only in modules whose classes are referenced.

No other safety issue found:

- The inserted statement follows a class declaration, or the `const X = class` statement.
- The marker gate passes on both fixture builds.
- The minified anything-llm bundle builds.
- D12, continuations, body-capture and middleware-reads are all green.

## Keep-green (run sequentially by me)

| check | result |
|---|---|
| `npm test` | 713 tests, **712 pass, 1 fail (`react-context-ref-semantics`, `'a' !== 'b'`, known)**. The first full run also failed `backend-register … esm-app` once. It passed 3/3 alone and the full rerun was clean. The branch does not touch `backend/`: a flake. |
| function-names driver | 248/248 (marker gate passes on production and development) |
| `test/g4-grader.mjs` final7 + G4 manifest | **81/81** |
| G6 `g6-compare.mjs` regenerated (6 pairs) on main and branch, then `g6-grader.mjs` | **6/6 PASS**. Compare JSON main vs branch: the only differences are `name_status` (22, `manifest`→`inferred`), `display_name` (22, null → name), `name_basis` (22, added), and `server_args` (6, the store path's spelling, because main ran from another cwd). `AGENT-READS.md` is identical. |
| D12 `d12-stamp-neutrality.mjs` | pass, 23/23 |
| `continuations-neutral.mjs` | ok |
| `episode-focus.mjs` ×3 | ok, stable, 3/3 |
| `outcome-labels.mjs` | 160/160 |
| `mcp-gaps.mjs` | 35/35 |
| `body-capture.mjs` | 51/51 |
| `middleware-reads.mjs` | 343/343 |
| `npm run build` + `cmp src/… dist/runtime-attribution-browser.js` | byte-identical (304,724 bytes). Worktree clean afterwards. |
| `node --test test/function-names.test.mjs` | 6/6 |

## Residual risks (after the required changes)

- Type-argument calls (`forwardRef<A,B>(…)`, `useMemo<T>(() => …)`, `useState<T>(() => …)`) leave the function uninstrumented. The chain then says "no instrumented function ran". This is pre-existing and disclosed as a boundary rule, but it is frequent in TypeScript React code (LibreChat: 86 + ~52 sites). It should be the next boundary claim.
- `export default () => …` is uninstrumented (pre-existing, undisclosed). `export default class extends Error {}` is never registered, so its type prints as a runtime name only.
- Library error classes thrown directly print `runtime type <minified>` in production (`runtime type b`). The label is honest, but it gives an agent nothing to go on. Walking the prototype chain to the nearest registered class, or to a builtin, would at least give `extends Error`.
- Dead first-party classes are no longer tree-shaken (see Cost).
- The dev-server check covers only the module transform, as disclosed. I did not drive a browser session on the dev server either.
- Function `index` order is nondeterministic across builds on `main` as well. The build id is stable.
- Old-store error rows now print `runtime type TypeError`. This is untested on banked data, because no banked store in scope has an error row.

## Commands

```sh
W=/Users/austinho/dev/tracer-n1-function-names; S=$W/grader-scratch
node test/browser/function-names.mjs --out $S/driver-out --keep
git archive dca34f90 | tar -x -C $S/main && ln -s /Users/austinho/dev/tracer/node_modules $S/main/node_modules
node $S/build-fixture.mjs <tracerRoot main|branch> <fixture> <out> production|development   # ids, build id, bundle bytes
node $S/cmp-modes.mjs <manifestA> <manifestB>; node $S/cmp-ids.mjs <main manifest> <branch manifest>
node $S/probe-drive.mjs $W $S/drive            # probe app: prod+dev build, headless, collector, MCP stdio
node $S/serve-manifest.mjs $W $S/probe-app $S/p-serve
node $S/shadow-probe.mjs; node $S/remap-probe.mjs
node $S/banked.mjs <main|branch root> <store> <out.json> [manifest|-] [sourceRoot]; node $S/banked-diff.mjs <main.json> <branch.json>
node docs/evidence/pr-function-names-2026-09-24/rule-vs-text.mjs $W <manifest> <checkout> <out.json>
node $S/cb-named.mjs $W <manifest> <checkout>; node $S/sample.mjs <rvt.json> <checkout> build_only|text_only 10 <seed>
node $S/build-allm.mjs <main|branch root> <out>   # anything-llm frontend full production build (≈6–8 min each)
npm test; node test/g4-grader.mjs docs/evidence/m1-2026-09-22-final7 --manifest docs/evidence/g4-mcp-2026-09-23/manifest.json
node test/browser/g6-compare.mjs --store <g6 store + remap-bases manifests, gunzipped> --source-root /Users/austinho/dev/fixtures/anything-llm --out <dir> --pair … (6 pairs); node test/g6-grader.mjs <store> --compare <dir>
node test/browser/{d12-stamp-neutrality,continuations-neutral,outcome-labels,mcp-gaps,body-capture,middleware-reads}.mjs; episode-focus.mjs ×3
npm run build && cmp src/runtime-attribution-browser.js dist/runtime-attribution-browser.js
```

---

## Regrade at b3879adc (2026-09-24)

This is a targeted regrade of the three required changes, the disclosures and the rebase onto `main` 9ad0f210. Same grader. Everything was recomputed on the new head. The `main` baseline is a `git archive` of 9ad0f210 with the same inputs.

### Final verdict: `merge`

All three required changes are made correctly. The disclosures are in G2 and G4. The rebase keeps main's request-fact merging and hops. The suite is green apart from the known unit failure and a timing assertion that fails more often on `main` than on the branch. No required changes remain.

### 1. Callback names now resolve through the file's bindings: PASS

`integrations/function-names.mjs` now records every value binding in the file:

- declarations;
- `var`/`let`/`const`, including object and array patterns;
- parameters, including destructured ones;
- imports: default, named, namespace and `import =`;
- class, enum and namespace names;
- catch and loop variables;
- function-expression names.

A callback takes the callee's parameter name only when all three hold:

- the callee's name has exactly one binding;
- that binding is a function;
- the binding's scope encloses the call.

I checked the probes two ways. First, `grader-scratch/shadow-probe2.mjs` calls `buildNameIndex` directly. Second, I ran a real production and development build of `probe-app`, headless, and read it through MCP over stdio (`keep/probe-results-2.json`).

| probe | before (ed31ae99 grade) | now |
|---|---|---|
| P24 imported `runLater` plus an unrelated nested `runLater(misnamed)` | `misnamed (callback of runLater)` [manifest] | `<callback of runLater>`, `name: null`, [anonymous], in both builds' MCP work listing |
| P25 `const { schedule } = api` plus a nested `schedule(wrongParam)` | `wrongParam (callback of schedule)` [manifest] | `<callback of schedule>`, null, [anonymous] |
| P26 destructured `update` in `Editor` plus `const update = (patch) =>` in `Preview` | `patch (callback of update)` | `<callback of update>`, null |
| P27 destructured prop `setItems` plus another component's `function setItems(nextList)` | `nextList (callback of setItems)` | `<callback of setItems>`, null |
| new: two same-named local functions (`A` and `B` each declare `function update(…)` and call it) | | neither callback is named: `<callback of update>` ×2 |
| new: the callee is shadowed by a parameter of the caller (`function caller(runLater) { runLater(() => …) }` plus a top-level `function runLater(job)`) | | both calls abstain (two bindings), including the top-level call |
| new: an import under an alias (`import { run as later }`, plus a local `function run(job)`) | | `later(() => …)` gives `<callback of later>`, null. `run(() => …)` gives `job (callback of run)`. Correct: the local `run` is the only binding of that name. |
| new: callee out of scope (`helper` declared inside `outer`, called at top level) | | `<callback of helper>`, null |
| positives | | a unique top-level function gives `job (callback of runLater)`. An in-scope `const each = (item) =>` gives `item (callback of each)`. `const fe = function named(step) {}` gives `step (callback of fe)`. |

**Disclosure of the same-named case.** RUN-2 §1 says "a file with two functions of the same name … names neither one's callbacks". The G4 revision lists "any second function of the same name" among the abstentions. The module comment says "any second binding of the name abstain". It is adequately disclosed. The rule is deliberately strict: it abstains, never misnames.

The grader's four shapes are now in the neutral fixture (`src/callees.ts`, checked through the driver) and in the unit test `callback by callee parameter: only a unique function binding whose scope encloses the call`.

### 2. Remap ignores the export suffix: PASS

- `remap-probe.mjs`: adding `export default handleUpdate` now maps by `name_match`. It was `unmapped` before.
- `remap-probe2.mjs`: removing the default export maps, adding it maps, and changing `export default` to `export { handleUpdate as hu }` maps, all by `name_match`.
- Unit test present: `remap: adding or removing an export does not change a function's name`.
- The implementation strips ` (exported as …)` from the qualified display name before comparing.

### 3. `inferred` vs `inferred_from_source_text`: PASS

I compared banked stores between `main` 9ad0f210 and the branch with my own extractor (`banked.mjs`, now also recording `bound_to`):

| store | functions | name changed | label changed | status moves | action texts changed | entry / work JSON changed |
|---|---|---|---|---|---|---|
| final7 | 1,640 | 213 | **0** | 433 `source`→`inferred_from_source_text`, 213 `source_via_call`→`inferred` | 0 / 54 | 18 / 36: in every one the only change is `name` → null, and the label is identical |
| G5 23c | 5,101 | 0 | 0 | 1,807 `manifest`→`inferred_from_source_text` | 13 / 151: the listener line only | 0 / 0 |
| G5 codex part B | 5,101 | 0 | 0 | 1,807 `manifest`→`inferred_from_source_text` | 19 / 78: the listener line only | 0 / 0 |
| G6 + remap bases | 5,109 | 0 | 0 | 1,811 `manifest`→`inferred_from_source_text` | 0 / 408 | 0 / 0 |

- **The 213 changed final7 names.** All 213 were checked individually. Each old `name` was the via-call binding (status `source_via_call`). Each new row has `name: null`, `bound_to` equal to the old name, status `inferred`, and the same label (e.g. `confirmDelete (via useCallback) …`).
- **`resubmitMessage` on final7.** The entry stop reads `name: "resubmitMessage"`, `name_status: "inferred_from_source_text"`, `name_basis: "checkout_text_rule"`, and the chain text reads `→ handler resubmitMessage client/src/components/Chat/Messages/Content/EditMessage.tsx:54`.
- **The skill** now explains both statuses. For `inferred` it says "has no name of its own (`name` is null) … say it that way, not 'the function handleSave'". For `inferred_from_source_text` it says `name` is "a real name read from the source text … usable as the function's name but not verified by the build". An agent following it would still call the function `resubmitMessage`, and would caveat it only "if it matters".
- **The G4 revision** states the same split and the final7 and G5/G6 counts. Those counts equal mine.

One minor point, not blocking. The JSON entry stop does not carry `bound_to`; `functionInfo` does. On old stores the label still shows the binding (`confirmDelete (via useCallback)`), so nothing is lost.

### 4. G2 disclosures: PASS

The G2 revision now covers:

- **Kept classes:** unused first-party classes and their imports stay in instrumented builds, with my measurements (+576 B on the fixture, +178 B on anything-llm, 3 dead classes kept).
- **Boundary gaps:** type-argument calls (`forwardRef<A, B>`, `useMemo<T>`, `useState<T>`; LibreChat 86 + ~52 sites) and `export default () => …`. Both are uninstrumented on `main` too, and both are marked as needing their own claim.
- **Default-exported class:** `export default class extends Error {}` is never registered.

The module comment no longer claims `export default () => …` as an `export_alias` example.

### 5. Rebase: PASS

- `analysis/causal-chain.mjs` keeps main's `mergeRequestFacts(input)`, `serverHops` and `hopSegments`.
- `buildEpisodeChain` gains only the `errorClassName` option and passes it to `appEvidence`, which converts `uncaught_errors[].error_type` through `errorTypeOf`.
- `analysis/runtime-attribution.mjs` `buildActionChains` passes `errorClassName` to both of its `buildEpisodeChain` calls, next to main's hop and escape logic.
- No other raw `error_type` print remains in `analysis/`, `mcp/` or `collector/`.
- **Ids.** Built against `main` 9ad0f210, the ids are unchanged:
  - fixture: 75 = 75, build `8fd95e4a9506` in production and development;
  - probe app: 50 = 50, build `397ddc6228e5`.
- **Modes.** The probe app's production and development manifests have identical names (50/50) and identical classes (7).
- **Error types at runtime** are unchanged from the first grade:

  | thrown | production | development |
  |---|---|---|
  | `AppError` | `pe` → source `AppError` | source `AppError` |
  | `MyCancel` | `me` → source `MyCancel` | source `MyCancel` |
  | `E` | `fe` → source `E` | source `E` |
  | `TypeError` | builtin `TypeError` | builtin `TypeError` |
  | library `CancelledError` | `runtime type b` | `runtime type CancelledError` |
  | default-exported class | `runtime type ne` | `runtime type errDefault_default` |

### 6. Suite (sequential, on b3879adc)

| check | result |
|---|---|
| `function-names.mjs` driver | **263/263**. Production vs development 75/75 identical, production vs dev server 75/75 identical, classes identical in all three, marker gate passes on production and development. |
| `npm test` | 731 tests, **730 pass, 1 fail**: the known `react-context-ref-semantics` |
| G4 grader final7 | 81/81 |
| G6 compare regenerated on the branch and on `main` 9ad0f210, then `g6-grader.mjs` | 6/6 PASS. Branch vs main compare JSON differs only in `name_status` (22, `manifest`→`inferred_from_source_text`), `display_name` (22, added), `name_basis` (22, added) and `server_args` (6, the store-path spelling). `AGENT-READS.md` is identical. |
| D12 | pass, 23/23 |
| `episode-focus` ×3 | ok, stable ×3 |
| `outcome-labels` | 169/169 |
| `mcp-gaps` | 35/35 |
| `body-capture` | 51/51 |
| `middleware-reads` | 343/343 |
| `client-aborts` | 245/245 |
| `server-outbound` | 154/154 |
| `continuations-neutral` | branch 3/4 pass, `main` 9ad0f210 **1/4** pass. Every failure on both is the same assertion, `/api/cross-timer ran after action B started`: a timing flake that predates this branch, not a regression. |
| `npm run build` + `cmp` src/dist runtime | byte-identical. Worktree clean. |

### Residual risks (unchanged, all disclosed)

- The type-argument-call and `export default () =>` boundary gaps.
- Unused classes are retained in instrumented builds.
- Library errors thrown directly print `runtime type <minified>` in production.
- Callbacks of a callee whose name has any second binding in the file are never named. This is by design.
- The dev-server check covers the module transform only.

### Regrade commands

```sh
S=grader-scratch
node test/browser/function-names.mjs --out $S/driver-out2
node $S/shadow-probe2.mjs; node $S/remap-probe.mjs; node $S/remap-probe2.mjs
node $S/build-fixture.mjs <main2|branch> <fixture|probe-app> <out> production|development   # ids and build ids vs 9ad0f210
node $S/probe-drive.mjs $PWD $S/drive2
node $S/banked.mjs <root> <store> <out> [manifest|-] [sourceRoot]; node $S/banked-diff.mjs <main.json> <branch.json>
bash $S/r2/run.sh   # npm test, G4, G6 (branch + main), D12, outcome-labels, mcp-gaps, body-capture, middleware-reads, client-aborts, server-outbound, episode-focus x3, continuations x4 branch + x4 main, build + cmp
```
