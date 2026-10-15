# G4 revision 3 (2026-09-23): fixes from the independent grade

Responds to `GRADE-g4-independent.md` (G4 PASS at `766f27af`; findings F2, F4, F5, F6, F7) and the coordinator's rulings. Earlier files in this directory are unchanged.

1. Id-shaped segments (6c risk): `normalizeIdSegments` also treats `<lowercase word>_<8+ [A-Za-z0-9_-]>` as an id when the suffix has a digit or an uppercase letter. The real final7 agent id `agent_YAQ8Y1HJYBF3MirpqmkeZ` now normalizes to `:id`; `web_search` and similar stay literal.
2. F5: a `different_handler` entry stop sets `path_changed: true` with `path_change_reasons: ["entry_handler"]`. `source_revision` (pure source move) is narrower: same file and event, and the content hash differs, and the stamped component agrees when both sides have one. Two functions in one unchanged file are `different_handler`. Send vs overlap regenerate (identical backend stops, ChatForm vs ContentRender) is now `path_changed: true`.
3. F2: argument keys `__proto__`, `constructor`, `prototype` return `invalid_input` ("forbidden property name"), in-process and over stdio. The stdio transport inspects the raw line before the SDK's zod parse (which drops own `__proto__`). Also F7: `tools/call` without params now returns -32602.
4. F4: a selector `#id` that no recorded target carries returns `not_found`.
5. F6 documented in the gate: middleware DB reads are intentionally not stops.

Results after the change:
- `GRADE-g4-rev3.md`: implementer's grader, 81/81.
- `test/mcp.test.mjs`: 15/15 (new: prefixed-id unit test with the real final7 agent id, handler-change path test, `#id` not_found, raw stdio `__proto__` and -32602 test).
- `npm test`: see the commit report; the only failure is the known `react-context-ref-semantics` test.
