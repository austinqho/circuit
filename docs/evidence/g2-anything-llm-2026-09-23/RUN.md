# G2 anything-llm, run 1 (superseded; kept as recorded)

Tracer commit `569dbe83` (branch `g2-generality`), fixture `Mintplex-Labs/anything-llm@ad97bc8d`. Command:
`node test/browser/build-fresh-repo.mjs --repo /Users/austinho/dev/fixtures/anything-llm --session test/browser/sessions/anything-llm.mjs --out docs/evidence/g2-anything-llm-2026-09-23 --port 4100`

Result: **marker gate FAILED** (5100 manifest functions, 0 missing, **1 unmanifested executable site, index 3000**). Parity, smoke, capture, transports and all 8 scripted steps passed.

Cause (found in run r2 with the build kept): the minifier printed the round function index 3000 as `3e3`; the plugin's module-site scan and embedded-identity scan matched only `\d+`, so one function per build (whichever received a multiple of 1000 as a module-pass index) had its site but no manifest row. Fixed in `682fbd5a`; see `../g2-anything-llm-2026-09-23-r3/` for the passing run. The per-action results of this run are in `ACTIONS.md`/`summary.json` and match r3 in shape.
