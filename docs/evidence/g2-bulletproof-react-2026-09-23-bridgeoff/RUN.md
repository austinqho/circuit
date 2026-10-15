# G2 bulletproof-react, bridge off + stamps on (frontend-only)

Headless, scripted. The session is the same 10 steps as `g2-bulletproof-react-2026-09-23-r2` (bridge on, graded).

- Tracer: worktree `/Users/austinho/dev/tracer-g2b`, branch `g2-bridge-off` from main `da8575e7`. Package code is unchanged from main. It was installed from its `npm pack` tarball (147 files, integrity `sha512-j2wFSzkL…MukpZw==`).
- One plugin line: `...producttrace({"requestBridge":false,"stamps":true})`, banked as `wrapper-vite.config.mjs`.
- Fixture: `bulletproof-react@9506629ed003a561c6627735480cce4994244bb4` (`apps/react-vite`), clean before and after.
- Environment: React 18.3.1, Vite 5.2.11. The API is the repository's mock server (not instrumented).
- Command: `node test/browser/build-fresh-repo.mjs --repo /Users/austinho/dev/fixtures/bulletproof-react --session test/browser/sessions/bulletproof-react.mjs --out docs/evidence/g2-bulletproof-react-2026-09-23-bridgeoff --port 4200 --plugin-options '{"requestBridge":false,"stamps":true}'`. This run was made before `--expect-commit` existed. `source.commit` in `build-gates.json` is `9506629e`, and nothing else uses this checkout.

## Gates

| gate | result |
|---|---|
| source byte-identical | pass |
| marker gate | 301 = 301 (291 framed, 10 proxies), 0 missing, 0 unmanifested |
| parity (29 lines, stamps removed) | pass; control identical |
| smoke | pass |
| **served transport** | no bridge asset or reference; runtime wrappers inlined. The page shows `productTraceRuntimeFetch` / `productTraceRuntimeSend`, and there is no bridge object |
| **requests: runtime wrappers vs Playwright** | 12 = 12, reconciliation 0 |
| **capture** | drained. One page: `sequence` 1..858 and `stamp_sequence` 1..146. 0 dropped, 0 gaps, emitted 1004 = received 1004 |
| `capture.limit` rows | none |

## Handler credits (independent grade in `GRADE.md`)

| | bridge on (r2, graded) | bridge off (this run) |
|---|---|---|
| correct | 12 | **12** |
| unrooted_global | 3 (route_loader) | **1** (route_loader: the Discussions `<NavLink>` → `router.tsx:49`, credited because it owns `GET /api/discussions`) |
| abstained at `entry_handler` (justified) | 0 | **2** (Register link → `router.tsx:32`, View link → `router.tsx:56`) |
| wrong / misses | 0 / 0 | **0 / 0** |

All 5 writes are credited to the same developer-named handlers. They stop at the network because the backend is not instrumented.

## The 4 async-loss requests from the bridge-on run: all attributed now

| request | bridge on | bridge off |
|---|---|---|
| `GET /api/discussions` after the Discussions link (route loader after `import()`) | unattributed | Discussions link click, `direct` |
| `GET /api/discussions` refetch after the create-discussion mutation | unattributed | create-discussion submit, `direct` |
| `GET /api/comments` refetch after the create-comment mutation | unattributed | create-comment submit, `direct` |
| `GET /api/comments` refetch after the delete-comment mutation | unattributed | delete-comment confirm click, `direct` |

The grader confirmed that each is the correct owner. 9 requests are attributed and 3 are unattributed: the initial `GET /api/auth/me` and 2 hover prefetches (`mouseenter` is not a captured event).

## Stamps (G3 two-repo clause)

- Interactive hosts stamped, summed over 10 post-step snapshots: **83/83** (visible: 76/76).
- 146 `element.stamp` rows, 146 keys, 84 placements. All **84/84** placements verify against source.
- 10 acted-on keys resolved to file:line in `STAMPS.md` (10/10). The grader verified 12/12.
- Shared primitives (`Button`, `Input`, `Link`) resolve to their own JSX, e.g. `button.tsx:62`. The call site is carried as `binding_placement`, e.g. `landing.tsx:33 <Button onClick={handleStart}>`.
- 335 of 336 `dom.action` rows carry `target.element_key`.

Raw rows: `records.jsonl.gz` (858 rows), `stamps.jsonl.gz` (146), `joined-backend.jsonl.gz`. Checksums are in `RAW-SHA256.txt`.
