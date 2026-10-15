# G2 bulletproof-react r3 (regression run after the grade closes)

Purpose: confirm the post-grade package changes do not regress G2. Same fixture, command, env and session as r2 (`../g2-bulletproof-react-2026-09-23-r2/RUN.md`). Tracer `a64adeff`, installed from its `npm pack` tarball. **Not independently graded**; r2 is the graded run.

| gate | r2 (graded) | r3 |
|---|---|---|
| source clean before/after | pass | pass |
| marker gate | 301 = 301 | 301 = 301, 0 unmanifested |
| exact function boundaries | 301/301 | 301/301 |
| parity (29 lines) | pass | pass |
| smoke | pass | pass |
| capture lossless | yes | yes (2,718 rows) |
| transports | 12 = 12 | 12 = 12 |
| steps | 10/10 | 10/10 |
| credited / distinct functions | 15 / 12 | 15 / 12 |
| attributed requests: stop at network (frontend-only) | 5 | 5 |
| unattributed | 7 | 7 |

First-party report line (`build-enabled.log`): `[producttrace] first-party: 301 functions instrumented; excluded functions by rule: **/node_modules/** 6083; excluded modules by rule: **/node_modules/** 2290`.

Raw rows: `records.jsonl.gz`, `joined-backend.jsonl.gz`; sha256 and row counts in `RAW-SHA256.txt`. The corrections in `../g2-bulletproof-react-2026-09-23-r2/ERRATA.md` apply here as well: the route_loader labels, the 3 sourcemap warnings, and the builds not being kept.
