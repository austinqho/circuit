# producttrace

See what people do in your React app, one plain sentence per action, with the real IDs each action touched.

```text
10:02:14  Clicked Rename on workspace ws_12 → PATCH /api/workspace/ws_12 → 200 → workspaces.update
10:02:31  Clicked Delete on thread t_2 → aborted by the page before the response
```

producttrace attaches at build time with one Vite plugin line and never edits your source. It follows each click by identifiers, not timing: through your functions, across `await`s and React scheduling, out through `fetch`, into the Express handler (by W3C `traceparent`) and down to the MongoDB operation. When the evidence can't prove a link, it says where the trail stopped and why instead of guessing.

## Quick start

You need a Vite + React app, and optionally a Node/Express backend.

**1. Install**

```sh
npm install producttrace
```

**2. Add the plugin** in `vite.config.ts`, before `react()`:

```ts
import { producttrace } from 'producttrace/vite';
import react from '@vitejs/plugin-react';

export default {
  plugins: [...producttrace({ requestBridge: false, collector: 'http://127.0.0.1:8787' }), react()],
};
```

**3. Start the collector**, which writes everything the page records into `.tracer/`:

```sh
npx producttrace-collector --store .tracer --port 8787
```

**4. Build and open the app.** Instrumentation runs when the bundle is generated, so use a development-mode build rather than `vite dev`:

```sh
npx vite build --mode development && npx vite preview
```

**5. (Optional) Trace the backend too.** Start your server with:

```sh
node --import producttrace/backend/register server.js
```

Click around. Every action lands in `.tracer/records.jsonl`, and backend spans in `.tracer/spans.jsonl`.

## Reading the results

- **Agents** (Claude Code, Codex): `npx --no-install producttrace-mcp --store .tracer --source-root .` serves the store over MCP with tools such as `recent_actions`, `action_chain` and `element_history`. Setup for each agent is in [plugin/README.md](plugin/README.md).
- **Code**: `producttrace/collector` reads the store directly.

## Entry points

The package's public surface is the set of files at its root. Everything in a subfolder is internal.

| Import                         | File                       | What it is                                                     |
| ------------------------------ | -------------------------- | -------------------------------------------------------------- |
| `producttrace`                 | `index.js`                 | Browser runtime (`start`, `stop`, `status`)                    |
| `producttrace/vite`            | `vite.mjs`                 | The Vite plugin                                                |
| `producttrace/collector`       | `collector.js`             | Local collector and store reader                               |
| `producttrace/backend`         | `backend.js`               | OpenTelemetry span exporter for Node                           |
| `producttrace/backend/register`| `backend-register.js`      | `node --import` hook for Express, http/undici, MongoDB         |
| `producttrace/runtime-attribution` | `runtime-attribution.mjs` | The build-time plugin that names first-party calls (included by `producttrace/vite`) |
| `producttrace/analysis`        | `analysis.mjs`             | Build-time source analysis the plugin uses                     |
| `producttrace/mcp`             | `mcp.mjs`                  | MCP server (also the `producttrace-mcp` bin)                   |
| `producttrace/mcp/annotation-lookup` | `mcp-annotation-lookup.mjs` | Looks up the source snippet for an annotation      |

## Limits

- Vite + React frontends only. Backend capture covers Express, Node `http`/`undici` and MongoDB/Mongoose.
- `vite dev` is not instrumented; use a development-mode build.
- React 19 development builds are not supported yet.
- Not yet published to npm; install from this repo until then.
- The full list of known edge cases is in [docs/known-limitations.md](docs/known-limitations.md).

## Learn more

- [docs/reference.md](docs/reference.md): the full option and data reference (runtime modes, bodies capture, redaction, backend details).
- [analysis/README.md](analysis/README.md): the source analysis contract.
