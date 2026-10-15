# Smoke: merged harness on bulletproof-react (bridge off, stamps on)

Purpose: prove that the harness rebased onto main `a1807189` (G5), with the conflict resolution in `test/browser/build-fresh-repo.mjs`, still reproduces the graded bridge-off run `../g2-bulletproof-react-2026-09-23-bridgeoff/`. This run is not independently graded.

- Tracer: `g2-bridge-off` rebased onto `a1807189`; `npm run build` was run first. Package code is main's.
- Command: `node test/browser/build-fresh-repo.mjs --repo /Users/austinho/dev/fixtures/bulletproof-react --session test/browser/sessions/bulletproof-react.mjs --out docs/evidence/g2-bulletproof-react-2026-09-23-bridgeoff-smoke --port 4200 --plugin-options '{"requestBridge":false,"stamps":true}' --expect-commit 9506629e --work /Users/austinho/dev/fixtures/.g2-smoke-work`. The private `--work` dir was used so the shared `.g2-work` was not removed; it was deleted after the run.
- The wrapper is banked as `vite.g2.config.mjs` (main's name).
- Fixture `9506629e`: clean before and after, commit unchanged.

| measure | graded run | smoke |
|---|---|---|
| requests Tracer = Playwright | 12 = 12 | **12 = 12** |
| path | runtime wrappers, no bridge served | same |
| capture | lossless, 858 + 146 stamp rows | **lossless, drained, 0 unsequenced**; 858 runtime rows (1..858) + 146 stamp rows (1..146) in `records.jsonl`, emitted 1004 = received 1004 |
| `capture.limit` | none | none |
| marker gate / parity / smoke | pass | pass (301 = 301; 29 lines) |
| credits | 13 = 12 correct + 1 route_loader (`router.tsx:49`) | **13 = 12 correct + 1 route_loader**, the same 10 functions with the same counts |
| abstentions at `entry_handler` | 2 | 2 |
| attributed / unattributed requests | 9 / 3 | 9 / 3 (auth/me load, 2 hover prefetches) |
| interactive hosts stamped | 83/83 | **83/83** |
| stamp placements verified | 84/84 | 84/84 (sample 10/10) |

Layout change from the graded run: stamp rows are now inside `records.jsonl`, ordered by (page, kind, counter), following main's design. There is no separate `stamps.jsonl`, and `g2-stamps-check.mjs` reads either layout.

Raw rows: `records.jsonl.gz`, `joined-backend.jsonl.gz`; checksums in `RAW-SHA256.txt`.
