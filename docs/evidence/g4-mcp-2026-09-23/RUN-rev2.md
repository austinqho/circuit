# G4 revision 2 (2026-09-23): request comparison ruling applied

Supersedes one line of `RUN.md` (left unchanged because an independent grader was reading this directory): "send vs agent-chat unchanged (request `parameters_only`)" is no longer the behaviour.

Change (coordinator ruling): `compare_chains` compares request paths literally except id-shaped segments (24-hex ObjectId, UUID, 8+ hex, all digits). `openAI` vs `agents` under `/api/agents/chat/:endpoint` is a literal segment, so send (`action:mud8sc1x:9`) vs agent-chat (`action:mud8tqrr:34`) is now a `changed` request stop (`different_value`) and `path_changed: true`. `parameters_only` remains only for differences confined to id-shaped segments.

Also in this revision: `resolve_element` uses `element.stamp.url` (origin + path, literal) to narrow no-key lookups; the plugin launcher resolves the store from `--store`, `TRACER_STORE`, `TRACER_PROJECT_ROOT/.tracer`, then walk-up from cwd to a repository root; the README makes the `config.toml` install primary.

- `GRADE-g4-rev2.md`: `node test/g4-grader.mjs docs/evidence/m1-2026-09-22-final7 --manifest docs/evidence/g4-mcp-2026-09-23/manifest.json` after the change, with the grader's expectation for send vs agent-chat updated to `path_changed=true` and its signature now including the id-normalized request path: 81/81.
- `test/mcp.test.mjs`: 13/13. `npm test`: 551/552, the one failure is the known `react-context-ref-semantics` test.
