# G4 MCP run against the final7 scripted session (2026-09-23)

Gate text: `docs/gates/G4-mcp.md`. Branch `g4-mcp` (from `main` = tag `m1`). Headless only; no browser was driven: the store is the immutable final7 evidence (`docs/evidence/m1-2026-09-22-final7`), read in place.

Files in this directory:
- `manifest.json`: final7's attribution manifest (`/tmp/producttrace-librechat-m1-final7.json.attribution.json`, 8,952 functions, volatile) filtered to the 1,640 function ids referenced by final7 rows; `generated` paths dropped. Needed so handler ids resolve to files after `/tmp` is cleaned.
- `GRADE-g4.md`: output of `node test/g4-grader.mjs docs/evidence/m1-2026-09-22-final7 --manifest docs/evidence/g4-mcp-2026-09-23/manifest.json`. 81/81 checks pass.

What the grader checked (it imports nothing from `analysis/`, `collector/` or `mcp/`; it drives `mcp/server.mjs` over stdio and recomputes from raw JSONL):
- 9 flows × 7 checks: entry handler equals `HANDLERS.md`; the chain's request belongs to the episode; route span = the unique server span with the same trace id, `parent_span_id == trace_context.span_id` and the same method; handler and DB span-id sets equal; write set equal and non-empty; frontier is the terminal effect.
- `recent_actions` order equals `dom.action` rows sorted by `(timestamp, page, sequence)`.
- `element_history` on each flow's handler key lists the credited action(s).
- `resolve_element` from selector / path / role / name / nearby text never returns `exact` (4 probes).
- `compare_chains`: regenerate vs overlap-regenerate unchanged; send vs agent-chat unchanged (request `parameters_only`); send vs rename changed; DB stop statuses agree with graded signatures.
- Frontend-only (same records, empty `spans.jsonl`): 13 request-bearing actions, 0 backend stops, every one ends `stopped_at: network, because: backend not instrumented`.

Also verified (not in the grade file):
- Lift parity: `buildEpisodeChain` against the pre-lift `liveEpisodeRecord` code on all 46 final7 episodes, idle and not idle: 92/92 byte-identical JSON (scratch script, not committed).
- `test/mcp.test.mjs`: 11/11 pass (includes the stdio SDK-client test, the synthetic G3 stamp path, input validation, and the D12 check that injecting stamps leaves every chain unchanged apart from `control.element_key`).
- `npm test`: 549/550; the one failure is the known `react-context-ref-semantics` test. In a fresh worktree, `evaluation/shared-rules/fixtures` needs `npm ci` first or 9 library-program tests fail on missing `lodash417`/`react18` (environment, not code).

Independence caveat: the grader and the implementation were written by the same agent. They share no code, but the gate should not be declared passed until a separate agent reruns the grader.
