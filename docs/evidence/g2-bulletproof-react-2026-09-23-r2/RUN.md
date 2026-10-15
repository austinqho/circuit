# G2 bulletproof-react (final run r2, frontend-only)

Headless, scripted. Pipeline unchanged from LibreChat M1 except the G2 package fixes on branch `g2-generality`.

- Tracer: branch `g2-generality` at `682fbd5a`, installed from its own `npm pack` tarball (140 files, integrity `sha512-gPpuTe55…BuhN7Q==`); the wrapper imports `producttrace/vite`.
- Fixture: `alan2207/bulletproof-react@9506629ed003a561c6627735480cce4994244bb4`, `apps/react-vite` (Vite 5.2.11, React 18.3.1, TSX, react-query 5, react-hook-form, react-router 7, axios, Radix). Installed with `yarn --frozen-lockfile --ignore-scripts`.
- Command: `node test/browser/build-fresh-repo.mjs --repo /Users/austinho/dev/fixtures/bulletproof-react --session test/browser/sessions/bulletproof-react.mjs --out docs/evidence/g2-bulletproof-react-2026-09-23-r2 --port 4200`
- The one line: `...producttrace()` in a wrapper that imports `apps/react-vite/vite.config.ts` unchanged. Build env: `VITE_APP_API_URL=http://127.0.0.1:4201/api`, `VITE_APP_ENABLE_API_MOCKING=false`, `VITE_APP_APP_URL=http://127.0.0.1:4200` (the repository's own e2e shape; no `.env` file written).
- API: the repository's `mock-server.ts` (Express + `@mswjs/http-middleware` + `@mswjs/data`) via its `vite-node`, **not instrumented** (it is a mock, not first-party handlers). Its port variable is `VITE_APP_APP_MOCK_API_PORT` because `src/config/env.ts` strips `VITE_APP_` and reads `APP_MOCK_API_PORT` (the repo's `.env.example-e2e` name is ineffective). Fresh `mocked-db.json` (repo-ignored) per run, removed after.
- Browser: Playwright 1.62.1 Chromium headless shell, trusted input, service workers blocked. Ports: app 4200, mock API 4201.

## Gates

| gate | result |
|---|---|
| fixture source clean before/after | PASS |
| marker gate (AST over served JS vs manifest) | PASS: 301 manifest functions, 301 executable (291 framed, 10 proxies), 0 missing, 0 unmanifested; disabled build has 0 sites |
| manifest spans on an exact source function boundary | 301 / 301 |
| parity (body DOM, landing `/`) | PASS: 29 lines identical; control identical |
| runtime smoke | PASS |
| capture | lossless: 2,718 rows, one page document, 1..2718 contiguous, 0 dropped |
| transports | wrapper 12 = Playwright 12, reconciliation 0 |

## Session (10 steps, all completed)

Get started → Register link → register (5 fields + Register) → Discussions link → Create Discussion (title, body, Submit) → View link → Create Comment (body, Submit) → Delete Comment (+ confirm) → close notification toasts → user menu → Sign Out.

336 `dom.action` rows (24 click, 3 submit, 136 input, 136 keydown, 29 focusin, 8 change). 15 credited (12 distinct functions), 321 none: every keystroke/field row is owned by react-hook-form's `register` handlers (library, not instrumented), which is correct abstention. Every write was credited to its developer-named handler and ends with an explicit network frontier:

| step | credited handler | request | stop |
|---|---|---|---|
| register (submit) | `features/auth/components/register-form.tsx:30` `onSubmit` | POST /api/auth/register | network: backend not instrumented (mock API; frontend-only) |
| create-discussion (submit) | `features/discussions/components/create-discussion.tsx:49` | POST /api/discussions | network |
| create-comment (submit) | `features/comments/components/create-comment.tsx:53` | POST /api/comments | network |
| delete-comment (confirm click) | `features/comments/components/delete-comment.tsx:48` | DELETE /api/comments/:id | network |
| sign-out (menuitem click) | `components/layouts/dashboard-layout.tsx:192` | POST /api/auth/logout | network |

Full table: `ACTIONS.md`; counts: `summary.json`; independent grade: `GRADE.md`. `coverage.json` → `backend.join_diagnostics.no_exact_parent_server: 5` is expected (the mock API emits no spans); `ACTIONS.md` reports those five as "backend not instrumented".

## Which path carried `network.request`

The static-era bridge (`productTraceFetch`/`productTraceSend` outermost; axios uses XHR). It maps 0 action plans here (the static analyzer found 2 controls in 385 files), so it is only a transport recorder.

## Raw files

- `records.jsonl`: 2,718 rows, sha256 `52c2707231b3dda8957fbe915037218064a2dd74be076dbfef771f1808299612`
- no `spans.jsonl` (frontend-only).
