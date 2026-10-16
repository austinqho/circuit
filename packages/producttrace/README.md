# producttrace

See what people do in your React app, one plain sentence per action, with the real IDs each action touched.

```text
10:02:14  Clicked Rename on workspace ws_12 → PATCH /api/workspace/ws_12 → 200 → workspaces.update
10:02:31  Clicked Delete on thread t_2 → aborted by the page before the response
```

producttrace attaches with one Vite plugin line and never edits your source. It follows each click by identifiers, not timing: through your functions, across `await`s and React scheduling, out through `fetch`, into the Express handler (by W3C `traceparent`) and down to the MongoDB operation. When the evidence can't prove a link, it says where the trail stopped and why instead of guessing.

## Quick start

You need a Vite + React app.

```sh
npm install -D producttrace
```

Add one line to the plugins in `vite.config.ts`:

```ts
import { producttrace } from 'producttrace/vite';

export default defineConfig({
  plugins: [react(), producttrace()],
});
```

Run the app with its usual command (`npm run dev`). Vite prints one more URL:

```text
  ➜  Local:   http://localhost:5173/
  ➜  producttrace: http://localhost:5173/__producttrace/
```

Open the app in one tab and `/__producttrace/` in another. As you click through the app, the second tab narrates each goal in a sentence, with its steps underneath. Everything is recorded into `node_modules/.producttrace/store`; your source tree is never written.

The dev server runs the collector for you. To run your own instead (say, to also trace a backend), pass `collector: 'http://127.0.0.1:8787'` and start `npx producttrace-collector --store .tracer --port 8787`. Backend spans need the server started with `node --import producttrace/backend/register server.js`.

## Reading the results

- **Agents** (Claude Code, Codex): `npx --no-install producttrace-mcp --store node_modules/.producttrace/store --source-root .` serves the store over MCP with tools such as `recent_actions`, `action_chain` and `element_history`. Setup for each agent is in [plugin/README.md](plugin/README.md).
- **Code**: `producttrace/runtime-attribution` and `producttrace/collector` read the store directly.

## Entry points

The package's public surface is the set of files at its root. Everything in a subfolder is internal.

| Import                         | File                       | What it is                                                     |
| ------------------------------ | -------------------------- | -------------------------------------------------------------- |
| `producttrace`                 | `index.js`                 | Browser runtime (`start`, `stop`, `status`)                    |
| `producttrace/vite`            | `vite.mjs`                 | The Vite plugin                                                |
| `producttrace/collector`       | `collector.js`             | Local collector and store reader                               |
| `producttrace/backend`         | `backend.js`               | OpenTelemetry span exporter for Node                           |
| `producttrace/backend/register`| `backend-register.js`      | `node --import` hook for Express, http/undici, MongoDB         |
| `producttrace/runtime-attribution` | `runtime-attribution.mjs` | Joins recorded rows into attributed actions                 |
| `producttrace/analysis`        | `analysis.mjs`             | Build-time source analysis the plugin uses                     |
| `producttrace/mcp`             | `mcp.mjs`                  | MCP server (also the `producttrace-mcp` bin)                   |

## Limits

- Vite + React frontends only. Backend capture covers Express, Node `http`/`undici` and MongoDB/Mongoose.
- React 19 development builds are not supported yet.
- Not yet published to npm; install from this repo until then.
- The full list of known edge cases is in [docs/known-limitations.md](docs/known-limitations.md).

## Learn more

- [docs/reference.md](docs/reference.md): the full option and data reference (runtime modes, bodies capture, redaction, backend details).
- [analysis/README.md](analysis/README.md): the source analysis contract.
