# producttrace reference

ProductTrace observes interactions in a React application and records the product entity attached to each action. When the available evidence cannot prove an identity, it records the interaction without inventing one.

The observer runs in the browser. By default it consolidates low-level DOM and React evidence into a live workflow episode: a start event, meaningful checkpoints, and a completed, incomplete, or atomic-action terminal event. Every event in an episode shares one `workflow_id` and `trace_id`. The optional collector writes those events to JSONL. No model runs in the capture loop.

## Install

Until the package is published, install it from a local checkout:

```sh
npm install /path/to/producttrace
```

Load the observer before React:

```html
<script src="/node_modules/producttrace/dist/producttrace-runtime.js"></script>
<script src="/producttrace-bindings.js"></script>
<script src="/your-react-bundle.js"></script>
```

Then start it with a reviewed product map and an explicit sink:

```js
const recorder = ProductTrace.start({
  name: 'my-product',
  identity: {
    trajectoryKey: 'workspaceId',
    stepKey: 'itemId',
    propRules: [{
      path: 'item.id',
      as: 'itemId',
      scope: { component: /Item|Row/ },
      validate: (value) => typeof value === 'string' && value.length > 0,
    }],
  },
  actions: [{
    event: 'click',
    testid: 'copy-item-button',
    action: 'item.copy',
  }],
}, { endpoint: 'http://127.0.0.1:8787/ingest' });

recorder.status();
```

The default `operations` mode is designed for Trajectory-style telemetry. A workflow begins with `product.workflow_started`, receives `product.workflow_checkpoint` events as related work continues, and ends with `product.workflow_completed` or `product.workflow_incomplete`. A single unrelated activation ends as `product.action_observed`. The runtime joins checkpoints only through a shared form, verified product/trajectory identity, or an exact surface anchor exposed by an earlier action; timing alone does not join them. Text values and printable keys are never recorded. Use `outputMode: 'evidence'` only in local analyzer tests that need the individual DOM, React, route, and effect records.

Start the optional local collector with:

```sh
npx producttrace-collector 8787 producttrace-records.jsonl
```

## React source analysis

The optional Node analyzer maps React source relationships before the app runs:

```js
import { analyzeReact } from 'producttrace/analysis';

const map = analyzeReact({ repository: '/path/to/application' });
// Or analyze a source snapshot without reading the filesystem:
// analyzeReact({ files: { 'src/App.tsx': sourceText } });
```

Create the conservative runtime join plan from that exact map:

```js
import { createReactRuntimeIntegration } from 'producttrace/analysis';

const integration = createReactRuntimeIntegration(map, {
  onJoin(join) {
    // Resolved joins contain one observed occurrence and one source scenario.
    // Unresolved joins retain the missing-evidence reason.
  },
});

// In the build transform for each analyzed source file:
const transformed = integration.instrumentSource(relativeFile, sourceText);

// Serialize these generated bindings into the application startup:
ProductTrace.start(integration.bindings, { onRecord: sendRecordToJoiner });
```

`instrumentSource` first verifies the complete file hash from the analyzed map,
then adds an event-specific `data-producttrace-control-*` attribute at each exact
JSX placement. Each stamp contains the map fingerprint and source control ID.
The browser listener carries that evidence through its
reviewed binding and `onRecord`; the joiner accepts it only when it identifies one
map control and scenario. Labels, callback names, and timing are never join keys.

```sh
npx producttrace-analyze /path/to/application --include src --out react-map.json
```

It reports JSX event bindings, component placements, supported callback forwarding,
local state relationships, possible conditional reveals, and unresolved cases.
Source IDs and fingerprints are based on relative paths and source content. The
analyzer does not execute application code, start a browser, or change the target
repository. Its TypeScript dependency is used only by the Node analysis entrypoint.

Repository analysis can apply an exact-version, installed-source-attested callback
contract for `@tanstack/react-query@4.36.1`: invoking the `fetchNextPage` returned
by one `useInfiniteQuery` instance points to that instance's `queryFn`, including
through one transparent application wrapper. The map preserves the exact source
scenario, placement, wrapper call, producer call, and callback. Unsupported versions,
source drift, ambiguous options spreads, and branching wrappers remain in
`library_backlog` rather than producing a guessed edge.

This map describes source possibilities. It does not prove that an action occurred,
that a particular runtime entity was affected, or that a backend operation succeeded.
The source-stamp integration joins supported controls to exact listener observations.
Build-snapshot drift, ambiguous source scenarios, and missing runtime stamps remain
explicit unresolved results. See
[the analysis contract](../analysis/README.md) for supported syntax, diagnostics,
limits, and the listener integration requirements.

### Observed request to backend handler

The Node analyzer can inventory Express registrations and match one observed HTTP
request to the route that would receive it:

```js
import {
  analyzeBackendRoutes,
  connectRequestToHandler,
} from 'producttrace/analysis';

const backend = analyzeBackendRoutes({
  repository: '/path/to/application',
  include: ['server'],
  serviceId: 'application-api',
});

const result = connectRequestToHandler(reactRuntimeJoin, {
  schema: 'producttrace.http-request-observation.v1',
  basis: 'runtime_observation',
  request_occurrence_id: networkRecord.id,
  action_occurrence_id: networkRecord.action_occurrence_id,
  map_fingerprint: networkRecord.map_fingerprint,
  contract_application_id: networkRecord.contract_application_id,
  method: networkRecord.method,
  url: networkRecord.url,
  service: 'application-api',
  evidence_ids: networkRecord.evidence_ids,
}, backend);
```

The request observation must carry identities injected at the outbound source call.
The bridge checks the source-map fingerprint, exact clicked action, exact Axios/fetch
contract application, request occurrence, HTTP method, deployment service, route
frontiers, and framework dispatch rules. It does not join by timing or URL similarity.
This matters when background polling uses the same URL or one click sends several
requests.

The current backend adapter covers Express registrations written with ESM or
CommonJS, including nested mounts, middleware, parameters, and registration order.
Dynamic paths, unresolved mounts, multiple applications without an explicit target,
and duplicate precedence remain unresolved. The result distinguishes three facts:

```text
route registration predicted
  → registered handler reference found (or implementation unresolved)
  → exact backend request and handler execution confirmed by trace context
```

### OpenTelemetry backend evidence

Start the server with the default backend entrypoint:

```sh
node --import producttrace/backend/register server.js
# or: NODE_OPTIONS="--import producttrace/backend/register" npm start
```

`producttrace/backend/register` resolves from the directory `node` starts in, so
start it where `producttrace` is installed (normally the app root). It registers
the OpenTelemetry ESM loader hook through `module.register()` before the app
loads, so a `"type": "module"` app that `import`s Express gets route and handler
spans, not only bare HTTP server spans; CommonJS apps work unchanged. It
instruments `http,undici,express,mongodb` and posts span records to
`PRODUCTTRACE_BACKEND_SPAN_ENDPOINT` (default `http://127.0.0.1:8787/spans`, the
`/spans` route of `producttrace-collector --store <dir>`). Override with
`PRODUCTTRACE_BACKEND_ADAPTERS` (any of `http,express,mongodb,mongoose,undici`)
and `PRODUCTTRACE_SERVICE_NAME` (default `backend`).

Server-to-server calls a handler makes (`http.request`/`http.get`/`https.*` and
libraries built on them, such as axios in Node; the global `fetch` through
`undici`) are client spans under that handler that carry `traceparent`, so a
receiving server started the same way joins the same trace as a further hop of
the request. A call to a host with no span for that traceparent is a stated
frontier (`escaped_hops`). Global `fetch` capture needs Node >= 20.6 (or
18.19); on older Node the `undici` adapter is left out with one warning and
server spans carry `producttrace.capture_limit.feature: "outbound_fetch"`.

Two consequences to know. Every outbound request a handler sends, including to
third parties, now carries a `traceparent` header (Tracer's trace and span ids);
a request on which the app already set `traceparent` or `tracestate` is left
exactly as the app set it. Outbound URLs are recorded as sent, query strings
included (API keys passed in a query end up in `spans.jsonl` and in the MCP's
text).

A handler that forwards the traceparent it received (a proxy passing
`req.headers` on) gets Tracer's own value instead, so the downstream is a hop of
the same request. Two cases are known and not handled: an app that sets
`traceparent` with `req.setHeader` after the request was created overwrites
Tracer's value (the receiver then shows as an unlinked root and the hop reads
"no incoming span for this traceparent (not instrumented, or not reached)");
and an app that runs its own OpenTelemetry SDK with undici instrumentation
sends two `traceparent` headers per `fetch` (the receiver starts a new trace and
the call shows as two escaped hops). Run one SDK.

Requires Node >= 20.6 (or 18.19) for `module.register`. On older Node it prints
one warning and server spans carry `producttrace.capture_limit.feature:
"esm_instrumentation"` with the reason; add the loader yourself:

```sh
node --experimental-loader=@opentelemetry/instrumentation/hook.mjs \
  --import producttrace/backend/register server.js
```

Known limits:

- The fallback flag resolves `@opentelemetry/instrumentation` from the app
  directory. Under pnpm (or any layout that does not hoist it) that may fail;
  pass a direct path to `node_modules/.../@opentelemetry/instrumentation/hook.mjs`.
- Spans still in flight when the process exits are not flushed: each span is
  posted when it ends, and the entrypoint installs no exit or signal handler.

Advanced: if you need your own span sink, write the preload yourself. This path
registers no ESM hook, so for an ESM app add the `--experimental-loader` flag
above (or call `module.register` yourself) before importing it:

```js
// producttrace-backend.mjs
import { startNodeBackendTelemetry } from 'producttrace/backend';

startNodeBackendTelemetry({
  serviceName: 'application-api',
  adapters: ['http', 'express', 'mongodb'],
  onSpan(span) {
    sendToYourProductTraceCollector(span);
  },
});
```

```sh
node --import ./producttrace-backend.mjs server.js
```

The official OpenTelemetry HTTP adapter accepts the browser's W3C `traceparent`
and creates the server span. The official Express adapter records route dispatch.
ProductTrace adds one small Express instrumentation because the upstream adapter
does not emit a separate span for each callback registered on a route. That span
is what proves `handlers.listProjects` ran instead of merely proving that the
`/api/projects` dispatcher was entered.

When a database adapter is enabled, ProductTrace retains an operation only when
its client span is a descendant of that exact registered handler span. The
default record keeps the database system, operation, namespace, and collection;
query text, connection strings, parameters, and returned data are removed.

Applications that already own an OpenTelemetry SDK can use
`createProductTraceSpanExporter()` or `normalizeOpenTelemetrySpan()` rather than
starting another provider. `http` and `express` are the defaults; `mongoose`,
`mongodb`, and `undici` are available explicitly. Database query and result
content stays off unless `captureContent: true` is set; connection strings are
never retained.

After the browser request and backend spans arrive, confirm the occurrence:

```js
import { confirmBackendExecution } from 'producttrace/analysis';

const confirmed = confirmBackendExecution(requestHandlerBridge, backendSpans);
```

Confirmation requires one HTTP server span whose trace ID matches the browser
request and whose parent is the exact browser request span. Service, method, and
route must agree, and every statically registered terminal handler must have its
own descendant callback span. A matching URL, nearby timestamp, or Express route
span without the terminal callback remains unconfirmed.

### Autonomous Vite attachment

The Vite plugin analyzes the repository as a whole and instruments every proven
control-to-request candidate loaded by the browser build:

```js
import { productTraceVitePlugin } from 'producttrace/vite';

productTraceVitePlugin({
  repository: '/path/to/application',
  service: 'application-api',
  backendEntrypoint: 'server/index.js',
  bridgeEndpoint: 'https://collector.example/producttrace/bridge',
  configPath: '/tmp/producttrace-installation.json',
});
```

`backendEntrypoint` identifies the deployed application when one repository
contains several servers. It does not select a route. The plugin receives no
control label, source-file list, library-contract choice, request URL, handler,
or compiled-bundle string. If a workspace dependency runs precompiled code, the
plugin accepts a generated call only when the installed source map contains the
exact analyzed source snapshot and maps its call site to one JavaScript call.

The installation JSON reports repository coverage and explicit React, runtime,
backend, build-transform, and application-identity frontiers. A build with a
discovered request or handler that was never instrumented remains incomplete.

Run the clean LibreChat acceptance build with:

```sh
npm run demo:build:librechat-autonomous
```

The acceptance script creates a detached checkout at the pinned revision,
installs its frozen lockfile, builds its workspace packages, attaches the plugin,
and checks that Tracer changed no tracked application source. Its output includes
the number of discovered and instrumented request nodes and action handlers, plus
an empty `supplied_path_hints` list.

Browser action context is limited to the synchronous callback scope. For an
accepted Axios call, Tracer carries an occurrence-specific trace header through
that call's configuration, including asynchronous interceptors, and only joins
the transport presenting that header. Other deferred callbacks remain a frontier.
The old bundle-string installer is retired.

Run the pinned LibreChat gate with:

```sh
node test/acceptance/librechat-request-handler.mjs
```

It validates the focused `ProjectsView` Load more chain through TanStack, the
workspace data service, Axios, `GET /api/projects`, and the registered
`handlers.listProjects` reference. Its click and request records are deterministic
fixtures; it does not claim that a live browser request or backend execution occurred.

For the development-only live proof, run the clean build and start the viewer
with its generated analysis configuration:

```sh
npm run build
npm run demo:build:librechat-autonomous
PRODUCTTRACE_BRIDGE_CONFIG=/tmp/producttrace-librechat-autonomous.json npm run test:browser
```

Open `http://127.0.0.1:8123/fiber-demo`, choose **All projects**, and click
**Load more**. The evidence panel retains the exact source control, the
React/TanStack/Axios path, the observed request occurrence, the uniquely matched
Express route registration, and its registered handler reference. Each fact states
why it was admitted. Start LibreChat through the backend preload in
`test/browser/librechat-backend-telemetry.mjs` to add the server and registered
handler spans; the same card then changes to **Confirmed** while retaining any
downstream database or product-outcome gap.

After that click, validate the retained cross-process parent/child chain with:

```sh
npm run test:acceptance:librechat:backend
```

## Discovery

Discovery mode records bounded candidate anchors, owning React components, event types, and identity-shaped props from observed interactions:

```js
ProductTrace.discover();
console.log(ProductTrace.discoveryReport());
```

Discovery output is evidence for building a map. It is not automatically trusted as a binding.

## Evidence and privacy

Every grounded record retains how its attachment was proven. Unmatched interactions remain visible, and an unproven entity stays `null`.

ProductTrace does not capture clipboard contents, printable key values, DOM nodes, or live React Fiber objects. It does not capture typed input values as such, but with body capture on (the default in dev builds; see the next paragraph) the values an app sends in JSON or text request bodies are recorded as sent, with secret-named keys redacted; credentials in `Authorization` or `Cookie` headers are never recorded. Records leave memory only through an `endpoint` or `onRecord` sink supplied to `start()`.

Request and response bodies (Vite plugin, 2026-09-24). A dev build made with
`producttrace()` (Vite mode other than `production`) records each request body
and response body as a `network.body` row, so an agent can see which entity an
action acted on. A `production`-mode build records none unless
`producttrace({ bodies: 'always' })`; `bodies: false` turns them off; any mode
other than `development` with bodies on is warned at build time. Only JSON and
`text/*` bodies are read, up to 4 KB kept (text of unknown length: the first
4 KB, then Tracer stops reading); binary, streaming, multipart, untyped and blob
bodies are recorded only as type and size. The app behaves as without Tracer
(same output, same unhandled rejections, and a stream it cancels, pipes into an
aborting or erroring destination, or stops iterating closes as it would), with
two observable differences: (a) connection lifetime: none known; the residual
paths are a JSON response of unknown length the app abandons without cancelling
(Tracer reads it up to 1 MiB) and `pipeTo(…, { preventCancel: true })`; (b) a
fetch *rejection* reaches the app's reactions one microtask later, so after an
`abort()` a microtask the app queued in the same turn can run before its
`catch`. Before a row leaves the page, JSON values are redacted by key segment
(`password`, `token`, `secret`, `auth`, `apiKey`, `otp`, `pin`, `card`, `cvv`,
`session`, …; keys ending in `id`, booleans, and numbers other than those under
`password`/`pin`/`otp`/`cvv`/`card`/`ssn`/`secret`/`credential`/`token` are
kept), and no header
except `content-type` is recorded (never `Authorization` or `Cookie`). Query
strings are recorded as sent on the `network.request` row (path + query,
tokens included; never the fragment); body rows carry no URL. Other
body content, including secrets under other key names, inside string values or
in plain-text bodies, is recorded as sent: this is a development tool whose rows
stay on the loopback collector. Rows and MCP fields: [G4-mcp.md](https://github.com/austinqho/tracer/blob/main/docs/gates/G4-mcp.md) (archived in austinqho/tracer) §3.3.

Client aborts are recorded in **every build, production included**. A request
the page aborted (an `AbortController`, TanStack Query cancelling a superseded
or cancelled query, `xhr.abort()`) is labelled `aborted_by_client`, and the
server's answer is kept as `server_status`. To see the abort, the runtime
tracks every fetch given an `AbortSignal` **or a `Request` object** (every
`Request` carries a signal; TanStack Query passes one to every query), and it
wraps `Response.prototype.{arrayBuffer,blob,bytes,formData,json,text,clone}`,
`ReadableStream.prototype.{getReader,pipeTo,pipeThrough,tee,cancel,values,[Symbol.asyncIterator]}`,
`ReadableStreamDefaultReader`/`ReadableStreamBYOBReader.prototype.{read,cancel}`
and `XMLHttpRequest.prototype.abort` in every build (the stream wrappers act
only on the body of such a fetch; other streams pass straight through). The observable difference, in every build: for those fetches,
a *rejection* of the fetch reaches the app's reactions one microtask later, and
every read of that response's body (the body methods, `reader.read()`,
`pipeTo`, async iteration) settles one microtask later (the same difference as (b) above, no longer
limited to builds with bodies on). The fetch's own fulfilment path is unchanged. Such
fetches also add `network.abort` rows when aborted and `network.response_read`
rows when the app finishes reading a body. Rows and MCP fields:
[G4-mcp.md](https://github.com/austinqho/tracer/blob/main/docs/gates/G4-mcp.md) (archived in austinqho/tracer) §3.4.

## Development

```sh
npm test
npm run build
```

The Node suite tests packaging and collection. The browser fixtures test React attachment, discovery, lifecycle behavior, and host-application parity:

```sh
npm run test:browser
```

Open `http://127.0.0.1:8123/fiber-demo` for the real LibreChat development viewer. It embeds the pinned application beside a live activity panel populated by the current packaged runtime. Install the runtime into the local LibreChat build with `npm run demo:install -- /absolute/path/to/librechat/client/dist`, start the local LibreChat fixture on `127.0.0.1:3081`, then run `npm run test:browser`. The automated browser fixtures remain at `http://127.0.0.1:8123/regression`, `http://127.0.0.1:8123/test/browser/operations.html`, and `http://127.0.0.1:8123/test/browser/parity.html`.

Source files, build scripts, and developer tests are excluded from the installed package. Application-specific acceptance cases run only in ProductTrace development; they are not installed into the target repository.

## Current scope

DOM events, the mounted React tree, Node HTTP, and Express handlers are current
evidence providers. MongoDB, Mongoose, and Undici adapters are available for span
capture, but this release does not yet turn their spans into proven product
outcomes. Canvas, non-React, and native effects require additional providers.
