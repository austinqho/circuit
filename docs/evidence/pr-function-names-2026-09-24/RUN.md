# fix/function-names: run evidence (2026-09-24)

**Claim.** Every instrumented function has the name the source gives it, recorded at build time, in every build mode, and error types are named as the source names them.

Branch `fix/function-names`, rebased on `main` dca34f90. Written by the implementing agent. This is not an independent grade. Immutable: follow-ups go in RUN-2.md.

## Defects (generic)

1. **Exported functions had no name.** On a TypeScript app, every `export function foo` and `export default function` had a null name and rendered `<anonymous>`. The name rule ran at read time over the text before the function's span, looking for a binding at the call site. Exported declarations are not preceded by one.
2. **Production builds printed minified error types.** A thrown `ApiError` rendered `error_type: "Nf"`, because the runtime read `error.constructor.name` after minification.

## Rules as implemented

**1. Names come from the build.** `integrations/function-names.mjs` parses the original file. It is the same content, and the same `getStart`/`getEnd` span, that the function id hashes. The transform attaches each function's name fields to its manifest row as the row is created. The fields are `name`, `name_kind`, `display_name`, and optionally `export_names`, `via`, `bound_to`, `accessor`, `static`. The rules, in order:

| name_kind | rule | examples |
|---|---|---|
| `declaration` | A function declaration, exported or not, default or not. A named function expression's own name wins. | `describeStatus`; `Home (exported as default)`; `saveTodo` in `mutationFn: async function saveTodo()` |
| `binding` | The direct value of `const`/`let`/`var`, a parameter default, a destructuring default, or `x = fn`. `as`, `satisfies`, `!` and parentheses are looked through. | `handleRemove`, `About`, `onGreet` |
| `property` | An object-literal key, including shorthand methods, string and numeric keys, a class field, or `a.b = fn`. The display is the path of the value holding the object. | `useTodos.addTodo`, `handlers.onPing`, `useMutation({ mutationFn })`, `Greeter.greet` |
| `method` | A class method, getter, setter, constructor, static or `#private`. | `ApiClient.get`, `ApiClient.baseUrl (getter)`, `ApiError.constructor` |
| `export_alias` | The only name is the export's. | `default (helpers.ts)` |
| `callback` | A call argument. It is named by the callee's parameter at that position only when the callee is declared in the same module under a unique name and the parameter is a plain identifier. Otherwise the name is null and the display is `<callback of callee>`. | `job (callback of runLater)`; `<callback of todos.map>` |
| `inferred` | The first argument of a call whose result is bound. The binding holds the call's result, not the function, so `name` is null. `bound_to` and `via` are kept, and the display is the source shape. | `TextField = forwardRef(<callback>)`; `save = useCallback(<callback>)` |
| `anonymous` | Everything else. The display names the position. | `<computed key>`, `<button onClick>`, array elements, conditionals, returned functions, IIFEs |

`export { a as b }` and `export default a` add `export_names` to `a`'s row, and `a` stays the name. `React.memo(function Row() {})` keeps the inner name `Row`.

**2. Error types.**

- The module pass registers every first-party class that is bound to a name: a declaration, or `const X = class`. It inserts `registerClass?.(X, "<class span id>")` after the definition.
- The manifest gains `classes[]` with each class's `name`, `name_kind`, `extends` and source span.
- The runtime adds `error_class_id` to `function.exit` and `action.uncaught_error` rows when the thrown object's own constructor is registered. It adds `error_builtin: true` when the constructor is the global of that name.
- Readers give `error_type: { minified, source, source_basis }`.
- Text prints `source`, else `runtime type <name>`.

**3. Readers.**

- `store.functionInfo` prints manifest names as recorded. `name_status` is `manifest | inferred | anonymous`, plus the unchanged `not_recorded` and `not_in_manifest`.
- For manifests without `name_kind`, the old text rules (`functionNameAt`, then `wrappedAssignmentAt`) are the fallback. Their names are reported as `inferred` with a `name_basis`.
- `enrichManifest` never overwrites a build-time name.
- The labels in the MCP work listing, segment lineage, spine, entry stop and issuer all use `display_name`.
- `resolve_element` handlers and candidates, and `work.entries`, carry `name`, `display_name` and `name_status`.
- An entry-handler abstention gets a named `listeners` field and a text line.
- The skill tells agents how to read `name_status` and `error_type`.

**4. Build modes.** Names are computed from the original source, so dev, production and dev-server builds agree. Function ids do not change. The build id still covers function and placement ids only.

**5. Remap.** When both manifests carry `name_kind`, `name_match` compares `display_name`. Inferred and abstained names are never compared. Older manifests compare `name` as before.

## Neutral fixture

`test/browser/fixtures/function-names-app/` is a TypeScript app with its own `vite.config.ts`, React 19 and one `.jsx` module. It includes:

- TanStack Query `useMutation` with a named and an anonymous `mutationFn`
- zustand actions inside `create<S>()((set) => …)`
- `class ApiClient` with a constructor, a getter/setter, a static and async methods
- `class ApiError extends Error`
- `React.memo(function Row …)` and `forwardRef((…) => …)`
- `todos.map` callbacks and a computed-key method
- `export { formatTitle as titleCase }` and an anonymous default export
- a local callee (`runLater(job)`)
- wouter routes (`Home`, `About`) and a class-field arrow

The driver is `test/browser/function-names.mjs`:

1. It builds the fixture three ways with Tracer's plugins added to the app's config: `vite build --mode development` (unminified), `vite build` (minified), and the Vite dev server's module transform.
2. It asserts 47 names, kinds and displays in each manifest, plus the four classes.
3. It compares every shared id across the three modes.
4. It runs the marker gate on both builds.
5. It drives both builds headless through the real collector into stores.
6. It reads everything back through `mcp/server.mjs` over stdio: entry handlers, lineage, work, `resolve_element` by key and by role and name, and `error_type`.

Results (`function-names-report.json`): **248/248**.

- Production vs development: 54/54 shared ids with identical names. Production vs dev server: 54/54 identical. Classes are identical across the three modes.
- Marker gate passes on both builds.
- Production `ApiError` reads `{ minified: "Rt", source: "ApiError", source_basis: "manifest" }` and prints `handler_threw (ApiError)` and `also promise_rejected (ApiError)`. Development reads `minified: "ApiError"`.
- Example line: `click … → handler handleAdd src/routes/Home.tsx@1864-2037 → 1 request: (1) saveTodo … → ApiClient.post src/api.ts@638-743 → ApiClient.send src/api.ts@747-1217 → POST /api/todos …`.

Unit tests are in `test/function-names.test.mjs` (6 tests): the TS and JS rules, the store-writer non-overwrite, reader statuses, the display-name remap and error types.

## Banked stores (reader only; their manifests carry no build-time names)

Script: `banked-names.mjs`, run with `main` (dca34f90) and with this branch. For every manifest function it records `functionInfo`, and for every action it records the `action_chain` text.

| store | functions | name changed | label changed | status changes | action texts changed |
|---|---|---|---|---|---|
| final7 (+ G4 manifest, LibreChat checkout) | 1,640 | 0 | 0 | 433 `source`→`inferred`, 213 `source_via_call`→`inferred` | 0 / 54 |
| G5 23c (anything-llm checkout) | 5,101 | 0 | 0 | 1,807 `manifest`→`inferred` | 13 / 151: only the added listener line |
| G5 codex part B | 5,101 | 0 | 0 | 1,807 `manifest`→`inferred` | 19 / 78: only the added listener line |
| G6 (+ remap-bases manifests) | 5,109 | 0 | 0 | 1,811 `manifest`→`inferred` | 0 / 408 |

No banked name got worse. Error types in banked rows now read `runtime type X`, because those rows predate `error_builtin`.

**The build rule against the old text rule on the same checkouts** (`rule-vs-text.mjs`; every function whose file hash matches the id):

| checkout | agree | build only | text only | conflicts |
|---|---|---|---|---|
| final7 (LibreChat) | 1,243 | 157 (157 `export default function X` and other declarations the text rule missed) | 240 | 0 |
| anything-llm | 4,191 | 668 (610 declarations, 53 object members such as `SystemPromptVariable.create`, 1 `#private` method, 4 callbacks) | 242 | 0 |

"Text only" means the build rule records no name where the text rule gave one. The cases are:

- **`via`-call names**, now `inferred` with a null name and the binding kept in `bound_to` and the display. Examples are `x = useCallback(<callback>)` and `slugs = threads.filter().map(<callback>)`, where the old text rule called the function `slugs`.
- **Old final7 spans that start at the callee.** An older transform wrote these spans, and the text rule named them `useEffect`, `map`, `reduce`, `every`, or `MemoizedAvatar (via memo)` for a `memo` comparator.

Full lists are in `rule-vs-text-*.json`.

## Keep-green (final code, sequential run)

| check | result |
|---|---|
| `npm test` | 713 tests, 712 pass, 1 known failure (`react-context-ref-semantics`) |
| `test/g4-grader.mjs` final7 | 81/81 |
| G6: `g6-compare.mjs` regenerated (6 pairs) + `g6-grader.mjs` | 6/6. The compare JSON is identical to `main`'s modulo the added name fields and `manifest`→`inferred` (7/7 files). |
| D12 `d12-stamp-neutrality.mjs` | pass (23/23) |
| `continuations-neutral.mjs` | ok |
| `episode-focus.mjs` | ok, 3 runs, stable |
| `outcome-labels.mjs` | 160/160 |
| `mcp-gaps.mjs` | 35/35. W3 and P2 were updated: the anonymous `.catch` arrow now renders `<callback of fetch().then().catch>` and the effect arrow `<callback of useEffect>`. |
| `body-capture.mjs` | 51/51 |
| `function-names.mjs` | 248/248 |
| `npm run build` + `cmp` src/dist runtime | identical |

In an earlier run, `continuations-neutral` failed one timing assertion (`/api/cross-timer ran after action B started`). The banked-store scripts were running in parallel then. It passed in the sequential run.

## Residual risks

- **Inferred bindings are context, not names.** For callbacks of methods on values (`count = withRetry(<callback>)`, `todos = useTodos(<callback>)`) the display shows the call's result. It is marked `inferred`, and `name` is null.
- **Visible-callee callbacks** resolve by identifier over the whole module and abstain on any duplicate. Imports are never followed, and the parameter name is the callee's, not the caller's.
- **Classes are registered only when bound to a name** (a declaration or `const X = class`). `export default class {}` and anonymous class expressions elsewhere give `source: null`. Library error classes give `source: null`, and their runtime name may be minified. Only the thrown object's own constructor is resolved; its prototype chain is not walked.
- **`registerClass(X, …)` references the class.** A first-party class that a bundler used to tree-shake is now kept, and its `static` blocks run. `registerFunction` already did the same for function declarations.
- **The dev-server check covers only the module transform**, not a browser session on the dev server.
- **Found, not fixed (boundary rule).** A call with explicit TS type arguments, `forwardRef<A, B>((p, r) => …)`, leaves its arrow uninstrumented: the boundary abstains because the map starts on the callee. The fixture avoids this. It is recorded in the G2 amendment.
- Function ids of stamped JSX files hash the stamped text, as before. Names are computed on that same text, so ids and names stay consistent.

## Commands

```sh
npm run build && cmp src/runtime-attribution-browser.js dist/runtime-attribution-browser.js
node test/browser/function-names.mjs --out <dir>
npm test
node test/g4-grader.mjs docs/evidence/m1-2026-09-22-final7 --manifest docs/evidence/g4-mcp-2026-09-23/manifest.json
node test/browser/g6-compare.mjs --store <g6store> --source-root /Users/austinho/dev/fixtures/anything-llm --out <out> --pair A-baseline:B-seeded-422 --pair B-seeded-422:C-fix-r2 --pair A-baseline:C-fix-r2 --pair A-baseline:D-noop-refactor --pair A-baseline:E-frontend-early-return --pair B-seeded-422:C-fix
node test/g6-grader.mjs <g6store> --compare <out>
node test/browser/{d12-stamp-neutrality,continuations-neutral,episode-focus,outcome-labels,mcp-gaps,body-capture}.mjs
node docs/evidence/pr-function-names-2026-09-24/banked-names.mjs <code root> <store> <out.json> [manifest|-] [source root]
node docs/evidence/pr-function-names-2026-09-24/rule-vs-text.mjs <code root> <manifest> <checkout> <out.json>
```
