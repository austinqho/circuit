# Tracer plugin for Codex (and the same MCP server for Claude Code)

This directory is a Codex plugin: `.codex-plugin/plugin.json` points at `.mcp.json` (a local stdio MCP server) and `skills/` (the `tracer-annotations` skill). The server is `producttrace-mcp` from this package (`mcp/server.mjs`); it reads a Tracer evidence store and runs no model.

Status (2026-09-23, evening): the `config.toml` install registers the server (it appears in `codex mcp list`), but a Codex desktop-app thread did not expose its tools natively (421 tools in that thread's snapshot, none from `tracer`); Codex reached the server by starting the configured command from a shell and speaking MCP over stdio, which the skill now prescribes as the fallback. Keep the `config.toml` entry (it is how Codex finds the command) plus the skill or AGENTS snippet. The plugin path is untested; CLI threads are unverified. The manifest shape follows OpenAI's plugin spec and the locally installed first-party plugins (internal research note, not published). Not yet verified end to end: that Codex starts a stdio server from a locally installed third-party plugin without extra approval, and how `env_vars` reach it. Public distribution of local stdio servers is not supported by OpenAI's packaging docs; use the local marketplace below or the config fallback.

## What the server needs

- A store directory, normally `<app>/.tracer/`, written by `producttrace-collector --store .tracer --manifest node_modules/.producttrace/runtime-attribution-manifest.json --source-root .` while you use a dev build made with `producttrace({ collector: 'http://127.0.0.1:<port>' })` (the page ships its rows to `<collector>/ingest`; backend spans go to `<collector>/spans`). Layout: `records.jsonl` (required), `spans.jsonl` (optional; absent means frontend-only, every chain ends at an explicit network frontier), `manifests/<build>.json` or `manifest.json` (maps function ids to files), `runs.jsonl`. An evidence directory also works.
- Backend spans (Node): start the server with `node --import producttrace/backend/register server.js` (or `NODE_OPTIONS="--import producttrace/backend/register"`). It registers the OpenTelemetry ESM loader hook through `module.register()` (so `"type": "module"` apps that `import express` get route and handler spans, not only bare server spans; CommonJS apps work unchanged), instruments `http,undici,express,mongodb`, and posts span records to `PRODUCTTRACE_BACKEND_SPAN_ENDPOINT` (default `http://127.0.0.1:8787/spans`, the `/spans` route of `producttrace-collector --store`, whose default port is 8787). Override with `PRODUCTTRACE_BACKEND_ADAPTERS` (any of `http,express,mongodb,mongoose,undici`) and `PRODUCTTRACE_SERVICE_NAME` (default `backend`). Needs Node >= 20.6 (or 18.19) for `module.register`; on older Node it prints one warning and you add `--experimental-loader=@opentelemetry/instrumentation/hook.mjs` yourself; server spans then carry `producttrace.capture_limit.feature: "esm_instrumentation"` with the reason. Server-to-server calls join the trace: requests a handler sends with `http.request`/`http.get`/`https.*` (and libraries built on them, such as axios in Node) or with the global `fetch` (undici) are client spans under that handler that carry `traceparent`, so a receiving server started the same way (this process or another) joins as a further hop of the same request; `action_chain` renders it as `→ outbound POST /internal/notify (from handler archiveProject) → server /internal/notify 201 → handler notify → db insert notifications`, and a call with no receiving span as a stated frontier (`→ no incoming span for this traceparent (not instrumented, or not reached)`, listed in the segment's `escaped_hops`; the chain then stops at `server_hop`, never "terminal effect observed"). Global `fetch` capture needs Node >= 20.6 (or 18.19); on older Node the `undici` adapter is left out with one warning, fetch-issued calls start a new trace on the receiving side (listed as unlinked, never joined by time), and server spans carry `producttrace.capture_limit.feature: "outbound_fetch"` (joined with `esm_instrumentation` by a comma when both apply). Every outbound request a handler sends, third parties included, now carries a `traceparent` (Tracer's ids); when the app already set `traceparent`/`tracestate`, the headers are left exactly as the app set them and the hop is followed by the app's value or stated as `traceparent set by the app; receiving span not linked by Tracer`. Outbound URLs are recorded with their query strings (keys passed in a query reach the store and the MCP text). A forwarded incoming `traceparent` (the proxy pattern) is replaced by Tracer's own value. Not handled, disclosed: `req.setHeader('traceparent', …)` after the request exists overwrites Tracer's value unmarked (the hop reads not followed, the receiver shows as an unlinked root); an app running its own OpenTelemetry SDK sends two `traceparent` headers per `fetch` (one call shows as two escaped hops).
- The `collector` option is **dev-only and localhost-only by default**: a URL whose host is not loopback (`localhost`, `*.localhost`, `127.0.0.0/8`, `::1`) is refused at config time unless you pass `collector: { url, allowRemote: true }`; a root-relative path posts to the page's own origin. In a Vite `production`-mode build (`vite build` without `--mode`) the sink is not installed, with a warning, unless `collector: { url, force: true }`. The G5 harness builds in production mode and therefore passes `force: true`.
- The collector listens on loopback only but answers any origin (`access-control-allow-origin: *`): a page open in your browser could post rows to `/ingest`, or post to `/run-info` (`{source, steps, extra}`, recorded in the run row at close). Low risk on a loopback listener; there is no token or `Origin` check.
- **Request and response bodies (`bodies` option, 2026-09-24).** In a dev build (Vite mode other than `production`) the page records each request's body and response body as `network.body` rows, so `action_chain` can name the entity an action acted on. Off in a `production`-mode build (warned if you passed `bodies: true`) unless `producttrace({ bodies: 'always' })`; `producttrace({ bodies: false })` turns it off everywhere; bodies on in any mode other than `development` (production with `'always'`, staging, …) is warned at build time. What is read: only JSON and `text/*` bodies, 4 KB kept (`bytes` is the full size when known, else `null` with `bytes_read`); text of unknown length keeps its first 4 KB and then Tracer stops reading. Binary, streaming (`text/event-stream`, NDJSON), multipart, urlencoded, untyped and blob bodies are recorded as type and size only, never read. The app behaves as without Tracer (same output, same `unhandledrejection`s; a stream it cancels, pipes into an aborting or erroring destination, or stops iterating closes as it would), except that a fetch rejection reaches the app's reactions one microtask later (see G4 §3.3 for both stated differences). Redacted in the page, before the row leaves it, by key segment: values of keys like `password`, `token`, `secret`, `auth…`, `apiKey`/`x-api-key`/`privateKey`, `jwt`, `bearer`, `otp`, `pin`, `card…`, `cvv`, `ssn`, `credentials`, `session` become `"[redacted]"`; keys ending in `id` (`sessionId`), booleans, and numbers except those under `password`/`pin`/`otp`/`cvv`/`card`/`ssn`/`secret`/`credential`/`token` (quantities such as `maxTokenLimit` kept) are kept. No header is recorded except `content-type` (never `Authorization` or `Cookie`). Query strings are recorded as sent on the `network.request` row (path + query, tokens included; never the fragment); body rows carry no URL. Everything else in a body (names, emails, free text, secrets under other key names or inside string values, plain-text bodies) is recorded as sent: this is a dev tool whose rows stay on loopback (`.tracer/` in your checkout, not git-ignored automatically). Do not point it at real user data you would not paste into a local log. Details: `docs/gates/G4-mcp.md` §3.3.
- The G5 demo end to end (fixture, collector, Codex IAB): `docs/G5-RUNBOOK.md`.
- Optionally the instrumented checkout (`--source-root`) so function spans become `file:line`; a checkout whose file hash differs from the build is reported as `stale_build`, never given a line.

Run by hand:
```sh
npx --no-install producttrace-mcp --store .tracer --source-root .
# or, from this repo, against the banked final7 session:
node mcp/server.mjs --store docs/evidence/m1-2026-09-22-final7 --manifest docs/evidence/g4-mcp-2026-09-23/manifest.json
```
`--no-install` matters: it never fetches a package from the registry.

## Codex: recommended install (`~/.codex/config.toml`)

Recommended until we verify which directory Codex starts a plugin's stdio server in: a `config.toml` entry runs the server from the project directory you give it, so `.tracer` and `--source-root .` resolve correctly. Keys: `command`, `args`, `env`, `env_vars`, `cwd`, `startup_timeout_sec`, `tool_timeout_sec`, `enabled`. A project-scoped `<repo>/.codex/config.toml` also works for trusted projects.
```toml
[mcp_servers.tracer]
command = "npx"
args = ["--no-install", "producttrace-mcp", "--store", ".tracer", "--source-root", "."]
cwd = "/path/to/your-vite-app"
startup_timeout_sec = 20
tool_timeout_sec = 60
```
Equivalent CLI: `codex mcp add tracer -- npx --no-install producttrace-mcp --store .tracer --source-root .` (then set `cwd` in the file). Add `plugin/AGENTS-snippet.md` to the app's `AGENTS.md` so Codex knows when to call it (the skill only loads with the plugin). In the desktop app the entry may not surface as native tools (see Status); the skill's stdio fallback covers that case, so the entry is still required.

## Codex: plugin install (secondary, unverified)

The repo root carries `.agents/plugins/marketplace.json` (marketplace `tracer-local`, plugin path `./plugin`).
```sh
codex plugin marketplace add /path/to/tracer        # the repo root that holds .agents/plugins/marketplace.json
codex plugin add tracer@tracer-local
```
The plugin's `.mcp.json` starts `bin/tracer-mcp.mjs` with `cwd: "."`. Whether that is the plugin directory or the active project is not verified, so the launcher resolves the store from, in order: `--store`; `TRACER_STORE` (relative to `TRACER_PROJECT_ROOT`, else cwd); `TRACER_PROJECT_ROOT/.tracer`; the nearest `.tracer/` walking up from the process cwd, stopping at a repository root (a directory containing `.git`). The server is loaded from the nearest `node_modules/producttrace` at or above the project; nothing is downloaded. If Codex does not start plugin servers in the project, export the project before launching Codex:
```sh
export TRACER_PROJECT_ROOT=/path/to/your-vite-app   # must have producttrace in node_modules
```

## Claude Code (`.mcp.json` in the app's root)

The same server, unchanged:
```json
{
  "mcpServers": {
    "tracer": {
      "command": "npx",
      "args": ["--no-install", "producttrace-mcp", "--store", ".tracer", "--source-root", "."]
    }
  }
}
```
Or `claude mcp add tracer -- npx --no-install producttrace-mcp --store .tracer --source-root .`. Put `plugin/AGENTS-snippet.md` in the app's `CLAUDE.md`.

## Tools

`resolve_element`, `element_history`, `action_chain`, `recent_actions`, `compare_chains`. Exact input schemas and the output envelope are in `docs/gates/G4-mcp.md` §3. Every result carries `status` (`ok | not_found | stale_build | ambiguous | invalid_input`), a one-line `summary` in "reached / stopped at / because" form, and the structured JSON.
