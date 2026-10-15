# G2 anything-llm, run 2 (superseded; kept as recorded)

Tracer commit `569dbe83`, same command as run 1 with `--keep-builds` so the failing site could be inspected.

Result: **marker gate FAILED again, unmanifested index 4000**. Inspecting the kept build showed the site as `m.enter(4e3,{entry_hint:!1})` in the body of `reorderWorkspaces` (`frontend/src/components/Sidebar/ActiveWorkspaces/index.jsx`, a function declaration the minifier rewrote into a function expression). The exponent-form literal was invisible to the plugin's `\d+` scans. Fixed in `682fbd5a` (regexes accept `\d+(?:e\d+)?`; test in `test/installed-package.test.mjs`). Passing run: `../g2-anything-llm-2026-09-23-r3/`.
