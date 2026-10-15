# React 55 completion checklist

Target: the original **55 React / React DOM 18.3.1 entries**, including namespace, symbols, and metadata. Other libraries, new versions, automatic authoring and merges remain out of scope.

The existing PR 8 React rules and browser readers were brought into this branch from commit `9f76161d`, preserving the shared-program experiments. React completion does not require rewriting every existing React reader in the general-purpose language.

Admission has two explicit levels. A **usable bank entry** must pass the rule-language format checker, an independent oracle against the exact installed React build, and at least one deterministic Tracer source-to-runtime integration path. **Coverage completion** additionally requires every enumerated lifecycle and source-shape scope. The first is the completion criterion for mapping all 55 APIs; the second remains an honest coverage frontier rather than silently disabling a verified rule.

Fresh combined result: **55/55 usable rules admitted**, **25/55 broader scopes complete**, and **30/55 usable rules retain explicit coverage frontiers**. The interrupted-render protocol reduced the enumerated missing scopes from **106 to 103**. The package suite passes **527/527 tests**. The exact installed-source check covers all 55 public entries across React, React DOM, the client surface, and the server surface; it attests 24 implementation files and rejects a deliberately tampered React source file.

- Rules: `analysis/react-behavior.mjs`
- Deterministic language validation and execution: `analysis/react-execution-rule.mjs` and its imported planners
- Browser consumption: `analysis/runtime-join.mjs` and `src/producttrace-runtime.js`
- Exact remaining scopes: `docs/evidence/react-rule-admission.json`
- Additional shared-program evidence and per-entry records: `evaluation/shared-rules/react-55-completion.json`

## Current audit

| API | Format | Behavior / integration | Broader required scope |
| --- | --- | --- | --- |
| react/useCallback/18.3.1 | pass | scoped_pass / scoped_pass | Complete for listed scopes; source frontiers retained |
| react/useMemo/18.3.1 | pass | scoped_pass / scoped_pass | Complete for listed scopes; source frontiers retained |
| react/useTransition/18.3.1 | pass | scoped_pass / scoped_pass | Remaining scopes recorded |
| react/useDeferredValue/18.3.1 | pass | scoped_pass / scoped_pass | Remaining scopes recorded |
| react/useState/18.3.1 | pass | scoped_pass / scoped_pass | Complete for listed scopes; source frontiers retained |
| react/useReducer/18.3.1 | pass | scoped_pass / scoped_pass | Complete for listed scopes; source frontiers retained |
| react/createContext/18.3.1 | pass | scoped_pass / scoped_pass | Remaining scopes recorded |
| react/useContext/18.3.1 | pass | scoped_pass / scoped_pass | Remaining scopes recorded |
| react/createRef/18.3.1 | pass | scoped_pass / scoped_pass | Complete for listed scopes; source frontiers retained |
| react/useRef/18.3.1 | pass | scoped_pass / scoped_pass | Complete for listed scopes; source frontiers retained |
| react/forwardRef/18.3.1 | pass | scoped_pass / scoped_pass | Remaining scopes recorded |
| react/memo/18.3.1 | pass | scoped_pass / scoped_pass | Remaining scopes recorded |
| react/Component/18.3.1 | pass | scoped_pass / scoped_pass | Remaining scopes recorded |
| react/PureComponent/18.3.1 | pass | scoped_pass / scoped_pass | Remaining scopes recorded |
| react/startTransition/18.3.1 | pass | scoped_pass / scoped_pass | Remaining scopes recorded |
| react-dom/flushSync/18.3.1 | pass | scoped_pass / scoped_pass | Remaining scopes recorded |
| react-dom/unstable_batchedUpdates/18.3.1 | pass | scoped_pass / scoped_pass | Remaining scopes recorded |
| react/useDebugValue/18.3.1 | pass | scoped_pass / scoped_pass | Remaining scopes recorded |
| react/version/18.3.1 | pass | scoped_pass / scoped_pass | Complete |
| react/Children/18.3.1 | pass | scoped_pass / scoped_pass | Remaining scopes recorded |
| react/Fragment/18.3.1 | pass | scoped_pass / scoped_pass | Complete for listed scopes; source frontiers retained |
| react/Profiler/18.3.1 | pass | scoped_pass / scoped_pass | Complete for listed scopes; source frontiers retained |
| react/StrictMode/18.3.1 | pass | scoped_pass / scoped_pass | Complete for listed scopes; source frontiers retained |
| react/Suspense/18.3.1 | pass | scoped_pass / scoped_pass | Remaining scopes recorded |
| react/act/18.3.1 | pass | scoped_pass / scoped_pass | Remaining scopes recorded |
| react/cloneElement/18.3.1 | pass | scoped_pass / scoped_pass | Complete for listed scopes; source frontiers retained |
| react/createElement/18.3.1 | pass | scoped_pass / scoped_pass | Complete for listed scopes; source frontiers retained |
| react/createFactory/18.3.1 | pass | scoped_pass / scoped_pass | Complete for listed scopes; source frontiers retained |
| react/isValidElement/18.3.1 | pass | scoped_pass / scoped_pass | Complete for listed scopes; source frontiers retained |
| react/lazy/18.3.1 | pass | scoped_pass / scoped_pass | Remaining scopes recorded |
| react/useEffect/18.3.1 | pass | scoped_pass / scoped_pass | Complete |
| react/useId/18.3.1 | pass | scoped_pass / scoped_pass | Complete for listed scopes; source frontiers retained |
| react/useImperativeHandle/18.3.1 | pass | scoped_pass / scoped_pass | Remaining scopes recorded |
| react/useInsertionEffect/18.3.1 | pass | scoped_pass / scoped_pass | Complete |
| react/useLayoutEffect/18.3.1 | pass | scoped_pass / scoped_pass | Complete |
| react/useSyncExternalStore/18.3.1 | pass | scoped_pass / scoped_pass | Remaining scopes recorded |
| react/unstable_act/18.3.1 | pass | scoped_pass / scoped_pass | Remaining scopes recorded |
| react-dom/version/18.3.1 | pass | scoped_pass / scoped_pass | Complete |
| react-dom/createPortal/18.3.1 | pass | scoped_pass / scoped_pass | Complete for listed scopes; source frontiers retained |
| react-dom/findDOMNode/18.3.1 | pass | scoped_pass / scoped_pass | Remaining scopes recorded |
| react-dom/hydrate/18.3.1 | pass | scoped_pass / scoped_pass | Remaining scopes recorded |
| react-dom/render/18.3.1 | pass | scoped_pass / scoped_pass | Remaining scopes recorded |
| react-dom/unmountComponentAtNode/18.3.1 | pass | scoped_pass / scoped_pass | Remaining scopes recorded |
| react-dom/unstable_renderSubtreeIntoContainer/18.3.1 | pass | scoped_pass / scoped_pass | Remaining scopes recorded |
| react-dom/createRoot/18.3.1 | pass | scoped_pass / scoped_pass | Complete for listed scopes; source frontiers retained |
| react-dom/hydrateRoot/18.3.1 | pass | scoped_pass / scoped_pass | Complete for listed scopes; source frontiers retained |
| react-dom/client/createRoot/18.3.1 | pass | scoped_pass / scoped_pass | Complete for listed scopes; source frontiers retained |
| react-dom/client/hydrateRoot/18.3.1 | pass | scoped_pass / scoped_pass | Complete for listed scopes; source frontiers retained |
| react-dom/server/version/18.3.1 | pass | scoped_pass / scoped_pass | Complete |
| react-dom/server/renderToNodeStream/18.3.1 | pass | scoped_pass / scoped_pass | Remaining scopes recorded |
| react-dom/server/renderToStaticMarkup/18.3.1 | pass | scoped_pass / scoped_pass | Remaining scopes recorded |
| react-dom/server/renderToStaticNodeStream/18.3.1 | pass | scoped_pass / scoped_pass | Remaining scopes recorded |
| react-dom/server/renderToString/18.3.1 | pass | scoped_pass / scoped_pass | Remaining scopes recorded |
| react-dom/server/renderToPipeableStream/18.3.1 | pass | scoped_pass / scoped_pass | Remaining scopes recorded |
| react-dom/server/renderToReadableStream/18.3.1 | pass | scoped_pass / scoped_pass | Remaining scopes recorded |

The additional shared programs verify ordinary imperative refs, effect lifecycles, state calculations and original dispatch calls, and DOM callback scopes. Their Node-level checks do not silently replace the browser admission requirements.

## Latest additional evidence

Suspended and superseded render attempts now retain occurrence-specific ownership. Tracer joins an exact React source call to the exact Suspense boundary input, its fallback or children commit, and a mutually identified replacement attempt; it never treats elapsed time or a missing commit as proof that work was abandoned. Development and production browser fixtures cover `Suspense`, `useDeferredValue`, `useTransition`, `useContext`, and `useImperativeHandle`, reject substituted origin, commit, selection, and replacement facts, isolate a sibling root, and prove that effects and imperative-handle factories do not run for uncommitted work. This closes the required interruption scopes for `Suspense`, `useDeferredValue`, and `useTransition`; it narrows the combined context and imperative-handle scopes while leaving hydration, unmount, errors, nested wrappers, and unsupported boundary sources explicit. See `docs/evidence/react-interrupted-render-18.3.1.json`.

`React.lazy` now carries two additional verified scopes: native-Promise settlement and resolved-component selection. Tracer retains the exact allocated lazy object, inline loader, native Promise, fulfilled module value, and renderer-selected component; it then joins that component to fallback and reveal commits from the same Suspense boundary mount. Development and production fixtures reject eleven substituted source, occurrence, value, boundary, component, and commit facts. Tracer does not read `module.default`; the admitted versioned rule identifies that property, while the renderer supplies the resolved component identity. Custom thenables, rejected-module rendering, repeated suspension, interruption, and broader loader shapes remain explicit frontiers. This closes two of `lazy`'s seven required scopes and supplies shared Suspense retry machinery, but does not mark another public API complete. See `docs/evidence/react-lazy-18.3.1.json`.

`useState` and `useReducer` now connect exact queue requests and independently observed calculations to their committed render, including concurrent priority rebases. A request may appear in a later commit only when React produced a distinct calculation occurrence for that render; replaying the same request/calculation pair still rejects. The development browser fixture resolves all 525 lifecycle records, while failed calculations and updates issued after unmount remain uncommitted. Same-value updates without a commit and mutable, getter-produced, or external updater sources remain explicit frontiers.

The four server stream APIs now join their exact returned resource to application consumption. `renderToReadableStream` connects the original Promise to its fulfilled stream and natural `for await` exhaustion; `renderToNodeStream` and `renderToStaticNodeStream` join natural exhaustion directly; `renderToPipeableStream` connects its original handle to the exact pipe destination and that destination's existing inline completion or error callback. The compiler instruments only immutable local values with exact source provenance. It abstains for helper parameters, mutable aliases, abrupt loops, consumer failures, premature close, shared destinations, cancellation, backpressure, and non-inline listeners, so this improves four partial APIs without declaring any of them fully complete.

`createRef` and `useRef` now retain the exact returned object until a React renderer commit. A host-attachment record is admitted only when the committed fiber contains that exact ref object and React has written the exact host node into its own `current` data property. Development and production tests cover sibling refs, rerenders, remounts, a module-level `createRef`, stopped sessions, accessor safety, and deliberately substituted ref, host, and commit evidence. Repeated `useRef` returns remain joined to the first observed origin. The same acceptance covers named and namespace imports, immutable aliases, dot/bracket/parenthesized references, initial versus retained cells, remounts, and development StrictMode discarded attempts. Both APIs now pass every listed admission scope. Optional and compound operations, callback refs, detachment cleanup, and arbitrary mutable bindings remain explicit source frontiers rather than silently traced paths. See `docs/evidence/react-ref-host-attachment.json`.

The shared element reader now connects compiler-proven direct object-literal properties to the exact returned props for `createElement`, `cloneElement`, and `createFactory`, then requires separate committed-owner evidence. Development and production browser cases reject missing or substituted property and commit receipts. Unknown configuration objects are never enumerated; a revoked proxy passes through untouched and retains an explicit property-lineage frontier. See `docs/evidence/react-element-property-lineage.json`.

`isValidElement` now connects each returned boolean to the exact direct or immutable local condition that consumed it. Eight real clicks pass in each installed browser build, while swapped scopes, frames, values, conditions, action occurrences, and missing original call receipts reject independently. Equal booleans from separate callback invocations cannot exchange provenance. This proves result consumption by a source condition; it does not prove that the selected branch completed. See `docs/evidence/react-predicate-consumption.json`.

`createElement` now passes all seven required scopes. The compiler finds component calls and native-tag calls through immutable aliases, stamps exact explicit configuration objects, and connects real controls to callbacks in both installed builds. Runtime evidence joins direct property inputs to returned props and accepted commits, checks the development owner Fiber separately from the production null-owner rule, and connects the exact `createRef` object to the exact committed host. Dynamic or mutable tags, accessors, prototype writes, arbitrary configuration objects, and unresolved placements remain explicit source frontiers. See `docs/evidence/react-element-18.3.1.json`. All 503 unit tests and the related clone/factory browser regressions pass.

`createFactory` now passes all seven required scopes. Tracer follows immutable aliases from the allocated factory back to its exact bound type, then applies the same element-construction rule to each later call. Component and native factories produce distinct real controls in both builds; native factory calls receive a source stamp in argument zero, development and production owner policies are checked independently, and an exact `createRef` input joins to its committed DOM host. Mutable/runtime-only aliases, arbitrary configuration objects, dynamic arguments, and unresolved consumers remain explicit frontiers. See `docs/evidence/react-factory-18.3.1.json`.

`cloneElement` now passes all seven required scopes. Tracer follows the original description through local immutable aliases, requires the exact observed original at runtime, and then applies the clone precedence rule to explicit overrides. Component and native clones produce distinct source controls; native clone calls are stamped in configuration argument one, ref replacement joins the exact `createRef` object to its committed host, and development/production owner behavior is checked separately. Mutable/runtime-only aliases, unrecorded descriptions, arbitrary configurations, and dynamic properties remain explicit frontiers. See `docs/evidence/react-clone-18.3.1.json`.

`createPortal` now passes all five required scopes. Tracer matches the exact original child and container objects to a committed HostPortal Fiber, carries that portal identity through the logical React ancestry of a real click even though the DOM lives in another container, and records unmounts against an accepted prior commit. Development and production fixtures move the portal, change its key, preserve callback ownership, interrupt a concurrent render, and allocate an abandoned portal; interrupted and abandoned descriptions never acquire commit evidence. Immutable aliases of `createPortal` retain the installed API semantic, while mutable aliases and ambiguous origins remain unresolved. See `docs/evidence/react-portal-18.3.1.json`.

All four concurrent root APIs now join a synchronous `unmount()` occurrence to the actual empty-root commit and independently accepted effect cleanup invocations. All eight browser variants (development/production, both import surfaces, creation/hydration) pass. Negative checks reject foreign roots, unrelated argument work, missing cleanup receipts and mutated owners. This does not claim cleanup completion or asynchronous render-to-commit attribution. See `docs/evidence/react-root-unmount-commit.json`.

The three effect APIs now record and independently join actual setup/cleanup returns and throws. Eight browser variants match uninstrumented React, including StrictMode, hydration, changed/unchanged dependencies, Suspense hide/reveal, abandoned work, and setup/cleanup failures. The admission gate now uses those results for its existing effect lifecycle requirements; the full audit passed with 55 scoped entries and 6 fully admitted entries. An async function returning a Promise is only a synchronous return, never proof the Promise settled. See `docs/evidence/react-effect-outcomes.json`.

`useId` now joins its source expression to the exact props object, native host fiber, and independently accepted committed component owner. Four browser variants pass, including hydration, retained IDs, remounts, sibling/root isolation and five deliberately corrupted commit receipts. Source-transform tests cover adjacent/nested JSX and multiple ID uses on one element. This does not claim DOM attribute write causality or entity identity. See `docs/evidence/react-id-commit.json`.

The four boundary rules now describe their renderer input and selection. Browser evidence matches the original props/children object and key to the committed boundary, then joins its ancestry to the clicked control and discharges the exact source input condition. Six browser variants pass, including hydration and Suspense fallback; missing, foreign and stale receipts abstain. Individual boundary lifecycle gaps remain. See `docs/evidence/react-boundary-commit.json`.

Fragment now passes its listed behavior scopes in both installed builds: keyed reorder retention, changed-key remount, removal/reinsertion, sibling isolation and ignored ref/extra props. Tracer interprets the reuse rule against accepted prior/current commit receipts, rejecting wrong keys, parents, missing receipts and wrong predictions. Four deliberately wrong rules fail independent real-render checks. Local JSX variables and other unresolved source forms remain explicit frontiers. See `docs/evidence/react-fragment-lifecycle.json`.

The compiler now follows a local immutable JSX value at its single rendered use, including alias chains, arrays and conditional initialization. Real Fragment click/reorder/remount tests pass through this path in both builds. Unused values, mutable or multiply-used aliases, property reads and coercions do not become rendered controls. See `docs/evidence/react-jsx-local-values.json`.

StrictMode now uses the renderer’s actual development replay notification to connect a boundary input to the exact component render attempt. Eight browser variants pass across both builds, nested boundaries, concurrent/legacy roots and existing DevTools hooks. Ordinary event callbacks are not labeled replayed; effect rehearsal remains a separate effect rule. Two additional regressions preserve ordinary recording without a React manifest. See `docs/evidence/react-strict-replay.json`.

Profiler now joins an original callback body to its committed subtree using the versioned argument/phase rule. Six real-browser variants cover development, ordinary production and production profiling, with mount/update/nested-update, thrown callbacks and duplicate-call abstention. Eight deliberately wrong behavior programs and nine corrupted rules/receipts reject in each profiling-enabled variant. Server hydration uses the same callback helper without inventing a browser commit. See `docs/react-profiler-rule.md` and `docs/evidence/react-profiler.json`.

`useCallback` now resolves immutable ESM namespace exports, including literal bracket access and re-exports, into the existing exact callback body/owner reader. Eight additional browser variants each join 20 clicks, preserve old closures and function identities, and reject wrong source/owner/value receipts. With the existing 16 shared-callback variants, this satisfies the listed shared-module requirement. Object getters, mutable exports, dynamic keys, missing files and declaration-only modules remain explicit frontiers. See `docs/evidence/react-namespace-callbacks.json`.
