# G2 anything-llm (final run r3)

Headless, scripted, no LLM key. Pipeline unchanged from LibreChat M1 except the G2 package fixes on branch `g2-generality`.

- Tracer: branch `g2-generality` at `682fbd5a`, installed from its own `npm pack` tarball (`producttrace-0.1.0.tgz`, 140 files, integrity `sha512-gPpuTe55…BuhN7Q==`) into a temp consumer; the wrapper imports `producttrace/vite`.
- Fixture: `Mintplex-Labs/anything-llm@ad97bc8dfcb6919f34f7d6d0c722efdda64d66d9`, `frontend/` (Vite 4.5.3, React 18.3.1, JSX), `server/` (Express 4.22.1, Prisma 5.3.1 + SQLite). Server deps installed with `yarn --frozen-lockfile --production --ignore-scripts`, `prisma generate`, fresh SQLite via `prisma migrate deploy` each run.
- Command: `node test/browser/build-fresh-repo.mjs --repo /Users/austinho/dev/fixtures/anything-llm --session test/browser/sessions/anything-llm.mjs --out docs/evidence/g2-anything-llm-2026-09-23-r3 --port 4100`
- The one line: `...producttrace()` in the `plugins` of a wrapper config that imports `frontend/vite.config.js` unchanged (`build-gates.json` → `install`). No options: repository = nearest `.git` ancestor, manifest under `frontend/node_modules/.producttrace/`.
- Backend: `node --require test/browser/sessions/node-compat-slowbuffer.cjs --import test/browser/fresh-repo-backend-telemetry.mjs index.js` (Node 26 lacks `buffer.SlowBuffer`; the shim is harness-only). Adapters `http,express` from the installed package's `producttrace/backend`. Random JWT/SIG secrets per run, never written anywhere.
- Browser: Playwright 1.62.1 Chromium headless shell, trusted input, service workers blocked, viewport 1440×1000. Ports: app 4100, server 4101.

## Gates

| gate | result |
|---|---|
| fixture source clean before/after (`git status --porcelain`) | PASS (empty both times) |
| marker gate (AST over served JS vs manifest) | PASS: 5,101 manifest functions, 5,101 with an executable site (4,934 framed `enter`, 167 entry proxies), 0 missing, 0 unmanifested; disabled build has 0 sites |
| manifest spans on an exact source function boundary | 5,101 / 5,101 |
| parity (body DOM, stamps removed, landing `/`) | PASS: 115 lines identical; control (disabled vs disabled) identical |
| runtime smoke | PASS |
| capture | lossless: 6,730 rows over 2 page documents (delete-workspace reloads the page), sequences 1..N contiguous per page, 0 dropped |
| transports | wrapper 71 = Playwright 71, reconciliation 0 |

## Session (8 user actions, all completed)

open New Workspace modal → create workspace "Tracer G2" (type + Save) → New Thread → thread options → Rename (prompt) → thread options → Delete Thread (confirm) → workspace gear → append " renamed" + Update Workspace → Delete Workspace (confirm, page reloads).

67 `dom.action` rows (12 click, 2 submit, 17 input, 18 keydown, 16 focusin, 2 change). 42 credited to an entry handler (15 distinct first-party functions), 25 none ("no first-party function entered": uncontrolled inputs, native submit buttons whose effect is the separate `submit` action). Every write the script performed was credited to its developer-named handler and joined to its backend route + handler span:

| step | credited handler | request | backend (exact joins) |
|---|---|---|---|
| create-workspace (submit) | `frontend/src/components/Modals/NewWorkspace.jsx:21` `handleCreate` | POST /api/workspace/new | route `/api/workspace/new` 200 → handler span → **stopped at handler: Prisma/SQLite not instrumented** |
| new-thread (click) | `…/ThreadContainer/index.jsx:194` `NewThreadButton.onClick` | POST /api/workspace/tracer-g2/thread/new | `/api/workspace/:slug/thread/new` 200 → handler → stop (db) |
| rename-thread (click) | `…/ThreadItem/index.jsx:209` `renameThread` | POST …/thread/:threadSlug/update | 200 → handler → stop (db) |
| delete-thread (click) | `…/ThreadItem/index.jsx:235` `handleDelete` | DELETE …/thread/:threadSlug | 200 → handler → stop (db) |
| rename-workspace (submit) | `pages/WorkspaceSettings/GeneralAppearance/index.jsx:26` `handleUpdate` | POST /api/workspace/tracer-g2/update | 200 → handler → stop (db) |
| delete-workspace (click) | `…/DeleteWorkspace/index.jsx:13` `deleteWorkspace` | DELETE /api/workspace/tracer-g2 | 200 → handler → stop (db) |

Full per-action table: `ACTIONS.md` (from `actions.json`); counts: `summary.json`. Independent grade: `GRADE.md`.

Backend: 1,156 span records (104 server, 220 registered-handler); 49 attributed requests all joined to exactly one server span by trace id + parent span + method; 134 handler.enter rows; 0 DB spans (Prisma has no Tracer adapter), so every chain ends at the handler with an explicit frontier. Handler names are `<anonymous>` (anything-llm registers inline arrow handlers); the route pattern + handler index identifies them.

## Which path carried `network.request`

The static-era request bridge (`analysis/browser-request-bridge.mjs`, injected by `integrations/vite.mjs`) wraps fetch/XHR outermost (`window.fetch.name === 'productTraceFetch'`) and emits the rows; the runtime wrappers are suppressed by `__PRODUCTTRACE_BRIDGE_TRANSPORT__`. On this repo the bridge maps 0 action plans (static analysis found no request actions), so it acts only as a transport recorder.

## Raw files

- `records.jsonl`: 6,730 rows, sha256 `27454490f00bdb9363e6160f6ab3e1b19d26855149851d13ab8655ae7959acd8`
- `spans.jsonl`: 1,156 rows, sha256 `77c8aecccbd25b286b835ba177d6342118af4488730b0b2c158fb25d76c1e8d4`
- `attribution-manifest.json`, `build-gates.json`, `coverage.json`, `installation-coverage.json`, `joined-backend.jsonl`, `parity-dom-*.txt`, build logs, `backend.log`, step screenshots.
