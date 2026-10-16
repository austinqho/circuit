# React source analysis

`producttrace/analysis` builds a bounded map of React source relationships without executing the application. It is a Node-only companion to the browser listener, intended to help attribute an observed interaction to the right source scenario before producing continual-learning evidence.

```text
Source files ──> React map: bindings, placements, callbacks, state readers
                              │
Build transform ──> event-specific source-control stamps
                              │
Listener action occurrence ───┴──> exact source-scenario join
                                      │
                               observed effects + feedback
                                      │
                               evaluated learning example
```

This package implements the source map, a conservative source-stamp join to the listener callback, an Express route inventory, and an occurrence-safe observed-request bridge. Backend execution, feedback, and learning-example evaluation remain separate evidence stages.

## Use

```js
import { analyzeReact, createReactRuntimeIntegration } from 'producttrace/analysis';

const map = analyzeReact({ repository: '/path/to/app', include: ['src'] });
// Or analyze an exact, reproducible snapshot:
const snapshot = analyzeReact({
  files: {
    'App.jsx': `
      import { useState } from 'react';
      export function App() {
        const [open, setOpen] = useState(false);
        return <>
          <button type="button" onClick={() => setOpen(true)}>Rename</button>
          {open && <input aria-label="New name" />}
        </>;
      }
    `,
  },
});

const integration = createReactRuntimeIntegration(map, { onJoin(join) {
  store(join);
}});

// Call from a build transform for each exact analyzed input file.
const transformed = integration.instrumentSource('App.jsx', snapshotSource);

// Install the serialized bindings in the browser. Route the listener's
// onRecord output back through integration.onRecord in the Node join process.
writeBindings(integration.bindings);
```

```sh
producttrace-analyze /path/to/app --include src --out react-map.json
producttrace-analyze /path/to/app --include src --strict
```

The output file must not already exist. `--strict` exits with code 2 when diagnostics remain; invalid input or an IO failure at the command boundary exits with code 1. Default output is JSON on stdout.

Repository scanning excludes hidden directories, dependencies, generated output, declarations, and common test paths. External symlinks are not followed. The default limits are 5,000 files and 20 MiB of source; `maxFiles` / `maxBytes` and the corresponding CLI flags can change them. Missing inputs, omitted files, and unreadable paths remain in `diagnostics`.

## Meaning of the output

The schema is `producttrace.react-map.v1`. IDs use repository-relative source positions and content; the map fingerprint covers the analyzed file manifest and schema version. Moving an identical source snapshot to another directory preserves its identities. Consumers must retain the fingerprint and file hashes when storing a source reference.

| Field | Meaning |
| --- | --- |
| `files` | Relative paths and SHA-256 hashes of the analyzed source snapshot |
| `resolution` | Workspace package names, selected source entrypoints, and package-manifest evidence used to resolve them |
| `nodes` | Source evidence with file, text, and half-open UTF-16 character offsets `start` / `end` |
| `components` | Candidate component definitions recognized in the source |
| `placements` | Hypothetical JSX placements, their parents, and source-bound props; these are not runtime mounts |
| `controls` | Explicit native event bindings, exact `binding_id`, placement, handler candidates, and source conditions |
| `scenarios` | Per-control source expansion retaining callback arguments and conditions |
| `states` | Symbol-scoped React state declarations; occurrence context is carried separately by placement IDs on edges |
| `react_semantics` | Exact-version React semantic applications for source occurrences, with package-verification identity |
| `react_values` | Context and ref source identities; live cells are not frozen captures |
| `react_protocols` | Context Provider/Consumer, returned concurrent-root, and class member source occurrences |
| `react_backlog` | React calls whose version, source, callback identity, or explicitly unsupported behavior prevents admission |
| `library_contracts` | Applications of source-attested, exact-version library callback, component-event, render, navigation, or request contracts to one source occurrence |
| `library_backlog` | Library-looking calls for which package, version, callback, or control-flow evidence was insufficient |
| `edges` | Event bindings, call sites, calls, callback forwarding, state writes/readers, guarded rendering, and possible reveals |
| `diagnostics` | Unsupported behavior, ambiguous targets, missing source, and analysis limits |

For the example above, the map relates the Rename binding to its inline callback, the callback's setter call to the exact `open` state, and that state to the guarded input. A `state_write` means a source setter invocation; a `possible_reveal` means a guarded source surface. Neither proves that a user clicked, React committed a new render, or the input appeared.

`control.status: "resolved"` means its handler source was resolved. Calls downstream of that handler can still be unresolved. `input.complete` only means the selected input was read within the input limits. `claims.source_indexed` concerns source parsing; neither field is a coverage or execution certificate. `claims.runtime_observed` and `claims.source_complete` are always false in this version.

## Supported slice and boundaries

The initial slice covers named function/arrow components, `React.forwardRef` and `React.memo` wrappers, JSX native event bindings, direct and relative-imported handlers, workspace-package export barrels and exact tsconfig path aliases, inline callbacks, explicit and rest-prop callback forwarding, separate repeated JSX placements, imported React `useState` bindings, state readers, and basic `if`, ternary, and boolean guards. Exact source-attested React `18.3.1` imports also admit inline `useCallback` source identity without borrowing current-render captures. Repeated placements retain distinct captured props and callback paths. Identically named state variables in different components do not share identity. Known Radix Dialog container contracts preserve rendered children without analyzing the library implementation.

Repository analysis can apply exact-version contracts for TanStack React Query `4.36.1`, Recoil `0.7.7`, React Hook Form `7.50.0`, React Router DOM `7.18.2`, Ariakit React `0.4.29`, TanStack React Table `8.11.7`, and Axios `1.18.1`. These contracts describe specific control or data redirects: query handles to their own `queryFn`, Recoil callback factories to their returned callback, form submission to mutually exclusive valid/invalid callbacks, navigation handles to router effects, selected Ariakit component activations to their callback prop, `flexRender` to its exact source renderer, and Axios methods to HTTP request effects.

Admission resolves every package from the importing file. It requires the expected lockfile version and integrity plus hashes of the installed manifest, public entrypoint, implementation chain, and required dependency implementation. Separate installed copies retain separate evidence. A transparent first-party wrapper retains its call ID; default-exported source objects can retain their exact member function. Unknown spreads, dynamic renderer identities, version conflicts, source tampering, or an unreachable library boundary produce a backlog row rather than a trusted edge.

Each contract application retains its call, placement and scenario when one exists, exact arguments, branch conditions, package evidence, and synchronous or asynchronous timing claim. A contract proves only the stated possible redirect or effect. It does not prove runtime occurrence. Runtime records must still select the matching source occurrence.

Unknown or overriding spreads, dynamic callbacks, reassigned callback aliases, dynamic TanStack cell definitions, unrecognized custom children/render-prop behavior, loops and exception flow, unsupported hooks, external components without contracts, recursive expansion, and native submission semantics remain boundaries. Repository input discovers included workspace entrypoints from package names, conventional `src/index.*` or `index.*` files, and exact non-wildcard tsconfig path aliases used by the included source. It does not resolve arbitrary bundler behavior. The analyzer does not emulate React or prove whole-program effect closure. Source candidates can include hypothetical roots; they are not a list of mounted controls. In-memory `files` snapshots cannot claim installed-package verification and therefore cannot admit a library contract through the public API.

Joern and Jelly are not required or invoked. A later source-graph provider can consume the callback/call-site evidence while preserving these placement and state identities. A provider's candidate edge must not silently become an observed call.

## Listener integration

`createReactRuntimeIntegration(map)` compiles each resolved, single-scenario control into a generated runtime binding. `instrumentSource(file, source)` verifies the analyzed file hash before adding `data-producttrace-control-{event}` to the exact JSX placement. The stamp contains both the map fingerprint and control ID, and is inserted as the final JSX prop so an earlier spread cannot replace it. For a shared wrapper such as `Button`, the stamp is placed at the caller only when the wrapper directly forwards arbitrary props to its native host; selective callback forwarding is not enough. Otherwise the native host is stamped only when its occurrence is unique, the analyzed input is complete, and the analyzer reports no unresolved source frontier. The browser listener reads only the stamp for the current event and requires the mapped owning component in the React Fiber ancestry.

`integration.onRecord(record)` accepts raw action records and grouped `producttrace.workflow-event.v1` checkpoints. A successful result has schema `producttrace.react-runtime-join.v1`, retains the runtime evidence IDs and map fingerprint, and names exactly one control, scenario, placement, handler set, condition set, owning component, and source location. Its `source.path` contains only that scenario's direct tagged edges, verified library contracts, unresolved library backlog, and verified outbound HTTP request candidates with their source branch conditions and evidence IDs. Global React reaction and render edges require a separate occurrence-aware closure step. Missing stamps, foreign actions, mismatched events, unresolved callbacks, and source drift produce diagnostics or `status: "unresolved"`.

The join does not use a DOM label, callback/function name, nearby source location, entity ID, or timestamp. A path selected by a runtime action remains a source-level possibility: its `outbound_requests` do not prove that a request was sent. Network evidence must confirm the request occurrence, and a later route matcher must connect its method and resolved URL to a backend handler. The join also does not prove that a UI change committed or that a backend effect succeeded. Those claims require their own occurrence-linked evidence.

Keep source possibilities, observed actions, committed UI changes, backend effects, and delayed feedback distinct. Retain an explicit unresolved result when a required link is missing. Only downstream evaluation can decide whether the assembled evidence supports a learning example.

## Request and backend route bridge

`analyzeBackendRoutes` reads a repository or source snapshot and compiles Express
registrations into `producttrace.backend-route-map.v1`. Routes retain their root
application, optional deployment service, composed mount path, ordered middleware,
terminal handler reference, registration order, and source evidence. The inventory
also retains unresolved route frontiers so a dropped dynamic registration cannot make
a later literal route look uniquely reachable.

`matchRequestToRoute` normalizes a concrete method and URL, ignores query values for
route selection, and applies framework dispatch semantics. Multiple applications
require an explicit `application_id`; deployment analysis should supply a `serviceId`
and the request observer should carry the matching service. Dynamic request URLs are
not usable as source-only candidates.

`connectRequestToHandler` accepts a resolved React runtime join and a
`producttrace.http-request-observation.v1`. The observation must carry a fresh
request occurrence ID plus the exact action occurrence, source-map fingerprint, and
outbound contract-application ID injected at runtime. Those identities allow the
runtime URL to remain dynamic in source while still proving which request call was
observed. Missing or stale identities, method disagreement, service/application
conflicts, route frontiers, and route ambiguity all produce unresolved or ambiguous
results.

A resolved bridge predicts the registered route and names its entry handler reference.
Factory-created references such as `handlers.listProjects` can remain
`handler_resolution.status: "unresolved"` even when route selection is unique.
Middleware can stop dispatch before that handler, so `backend_execution` remains
`"unconfirmed"` until `confirmBackendExecution()` receives an OpenTelemetry HTTP
server span with the browser request span as its exact W3C parent and a descendant
ProductTrace Express callback span for every registered terminal handler. Service,
method, and route must also agree. Route or timing similarity cannot upgrade this
field.

## Validation

Run `npm test` from the package checkout. Public-interface fixtures cover callback and state identity, repeated placements, source conditions, unsupported behavior, stable IDs, cross-instance isolation, version rejection, contract-specific callback, render, navigation and request semantics, Express route topology, route frontiers, service/application isolation, and occurrence-safe request joins. `node test/acceptance/librechat-request-handler.mjs` exercises the pinned LibreChat source chain with synthetic action/request occurrences. These tests validate the bounded source and join contracts; they do not certify a live browser run, backend execution, or continual-learning quality.
