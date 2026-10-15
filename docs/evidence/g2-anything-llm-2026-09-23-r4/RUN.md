# G2 anything-llm r4 (regression run after the grade closes)

Purpose: confirm that the post-grade package changes do not regress G2. The changes are the configurable first-party rule, the AST site scan and the flattened Express handler index. Same fixture, command and session as r3 (`../g2-anything-llm-2026-09-23-r3/RUN.md`). Tracer `a64adeff`, installed from its `npm pack` tarball. **Not independently graded**; r3 is the graded run.

| gate | r3 (graded) | r4 |
|---|---|---|
| source clean before/after | pass | pass |
| marker gate | 5,101 = 5,101 | 5,101 = 5,101, 0 unmanifested |
| exact function boundaries | 5,101/5,101 | 5,101/5,101 |
| parity (115 lines) | pass | pass |
| smoke | pass | pass |
| capture lossless | yes | yes (6,771 rows) |
| transports | 71 = 71 | 71 = 71 |
| steps | 8/8 | 8/8 |
| credited / distinct functions | 42 / 15 | 42 / 15 |
| attributed requests: stop at handler (Prisma/SQLite) | 49 | 49 |
| unattributed (page loads) | 22 | 22 |

New in this run:
- **First-party report line** (`build-enabled.log`): `[producttrace] first-party: 5101 functions instrumented; excluded functions by rule: **/node_modules/** 11748; excluded modules by rule: **/node_modules/** 5118`. The default rule applies, and nothing first-party is excluded.
- **Unique handler index.** Across the 104 (trace, route, method) groups of the 220 handler spans, no index repeats. Example: `POST /api/workspace/:slug/thread/new` → indexes 0, 1, 2, 3 (r3 recorded 0, 0, 0, 3).

Raw rows: `records.jsonl.gz`, `spans.jsonl.gz`, `joined-backend.jsonl.gz`; sha256 and row counts in `RAW-SHA256.txt`. Per-action table: `ACTIONS.md`. The same corrections as `../g2-anything-llm-2026-09-23-r3/ERRATA.md` items 1–4 and 7 apply (pre-session autofocus row, category labels, visualizer artifact, builds not kept).
