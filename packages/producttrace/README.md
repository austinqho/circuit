# producttrace

See what people do in your React app, one plain sentence per action, with the real IDs each action touched.

```text
10:02:14  Clicked Rename on workspace ws_12 → PATCH /api/workspace/ws_12 → 200 → workspaces.update
10:02:31  Clicked Delete on thread t_2 → aborted by the page before the response
```

producttrace attaches with one line in your Vite or Next.js config and never edits your source. It follows each click by identifiers, not timing: through your functions, across `await`s and React scheduling, out through `fetch`, into the Express handler (by W3C `traceparent`) and down to the MongoDB operation. When the evidence can't prove a link, it says where the trail stopped and why instead of guessing.

## Quick start

You need a React app built with Vite or Next.js.

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

For Next.js, wrap the config you export from `next.config.ts` (or `.js`/`.mjs`):

```ts
import { withProducttrace } from 'producttrace/next';

export default withProducttrace(nextConfig);
```

`next dev` (Turbopack or `--webpack`) prints `- producttrace: http://127.0.0.1:<port>/__producttrace/`. That collector runs on its own server bound to 127.0.0.1, outside Next.js routing, so your middleware (a sign-in redirect) never blocks it and other machines on your network can't reach it, even when `next dev` listens on the network. The port stays the same across restarts of the same app. `next build` and `next start` get your config back untouched. Next.js 15.3 or later.

Open the app in one tab and the printed URL in another. As you click through the app, the second tab narrates each goal in a sentence, with its steps underneath. Everything is recorded into `node_modules/.producttrace/store`; your source tree is never written.

The dev server runs the collector for you. To run your own instead (say, to also trace a backend), pass `collector: 'http://127.0.0.1:8787'` and start `npx producttrace-collector --store .tracer --port 8787`. Backend spans need the server started with `node --import producttrace/backend/register server.js`.

## Reading the results

- **Agents** (Claude Code, Codex): `npx --no-install producttrace-mcp --store node_modules/.producttrace/store --source-root .` serves the store over MCP with tools such as `recent_actions`, `action_chain` and `element_history`. Setup for each agent is in [plugin/README.md](plugin/README.md).
- **Code**: `producttrace/collector` reads the store directly.

## Entry points

The package's public surface is the set of files at its root. Everything in a subfolder is internal.

| Import                         | File                       | What it is                                                     |
| ------------------------------ | -------------------------- | -------------------------------------------------------------- |
| `producttrace`                 | `index.js`                 | Browser runtime (`start`, `stop`, `status`)                    |
| `producttrace/vite`            | `vite.mjs`                 | The Vite plugin                                                |
| `producttrace/next`            | `next.mjs`                 | The Next.js config wrapper (`next dev`)                        |
| `producttrace/collector`       | `collector.js`             | Local collector and store reader                               |
| `producttrace/backend`         | `backend.js`               | OpenTelemetry span exporter for Node                           |
| `producttrace/backend/register`| `backend-register.js`      | `node --import` hook for Express, http/undici, MongoDB         |
| `producttrace/runtime-attribution` | `runtime-attribution.mjs` | The build-time plugin that names first-party calls (included by `producttrace/vite`) |
| `producttrace/analysis`        | `analysis.mjs`             | Build-time source analysis the plugin uses                     |
| `producttrace/mcp`             | `mcp.mjs`                  | MCP server (also the `producttrace-mcp` bin)                   |
| `producttrace/mcp/annotation-lookup` | `mcp-annotation-lookup.mjs` | Looks up the source snippet for an annotation      |

## Limits

- React frontends built with Vite, or with Next.js under `next dev` (client components; server components and server actions are not recorded). Backend capture covers Express, Node `http`/`undici` and MongoDB/Mongoose.
- React 19 development builds are not supported yet.
- Not yet published to npm; install from this repo until then.
- The full list of known edge cases is in [docs/known-limitations.md](docs/known-limitations.md).

## Learn more

- [docs/reference.md](docs/reference.md): the full option and data reference (runtime modes, bodies capture, redaction, backend details).
- [analysis/README.md](analysis/README.md): the source analysis contract.
