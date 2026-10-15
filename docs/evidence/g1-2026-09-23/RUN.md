# G1 frontend-only mode — LibreChat run, 2026-09-23

Gate text: `docs/gates/G1-frontend-only.md`. Headless Chromium only. Code at branch `g1-g3-stamps`, commit `a55cf551` (the grader's Mongo query fix landed in the following commit; it does not touch capture or chains).

## Build

- Fixture `/Users/austinho/dev/trace-consolidated/.live-demo/librechat-m1` (LibreChat `45cc53c`), built into the existing worktree `/tmp/producttrace-librechat-m1-final2` (reused, tracked source clean; disk was at 2.8–3.7 GiB free so no new worktree was created).
- `PRODUCTTRACE_M1_WORKTREE=/tmp/producttrace-librechat-m1-final2 PRODUCTTRACE_M1_BASELINE=/tmp/producttrace-librechat-m1-final2-baseline PRODUCTTRACE_BACKEND_TELEMETRY=0|1 PRODUCTTRACE_OPENAI_FIXTURE=1 scripts/m1-live.sh`
- Build gates: runtime markers 8956/8956; smoke ok; Agent Builder parity true. Build id `1c37d1cea7c2` (identical for the telemetry-off and telemetry-on builds; same function-id set). Manifest: `../g3-2026-09-23/attribution-manifest.json.gz`.
- Chat replies: the deterministic local OpenAI-compatible fixture (`test/browser/openai-compatible-fixture.mjs`, port 8999, `OPENAI_REVERSE_PROXY`); no model was called and the fixture `.env` key was not used.
- Session: `test/browser/m1-session-headless.mjs` (login + scripted flows), `PRODUCTTRACE_EVIDENCE_FORMAT=jsonl`.
- Chains: `node test/browser/g1-chains.mjs <dir> --backend=on|off --manifest=<manifest>`; grade: `node test/browser/g1-grade.mjs <dir> --backend=on|off --final7=docs/evidence/m1-2026-09-22-final7/coverage.json [--mongo=mongodb://127.0.0.1:27017/LibreChat]` (recomputes every terminal from raw rows without importing the analysis package).

## Raw records (stored gzipped, lossless)

Every `records.jsonl` over 20 MB is stored as `records.jsonl.gz` (`gzip -n -9`); `gzip -dc` restores the exact bytes.

| file | raw sha256 | rows |
|---|---|---|
| `records.jsonl.gz` | `40b246e6a313677f65b0c4982361fda2df919f5ccd9202c5ba7a6b8ee1b8af56` | 184,604 |
| `backend-on/records.jsonl.gz` | `38177cfe1ce02eb0f24fa8af7b57f01f344ca1ea997d78dd5ab83244696ccf58` | 216,380 |
| `frontend-only-with-bridge/records.jsonl.gz` | `8a2b05019f490f048a30eec792b244afa33c4e0be4d1f0106d50c209e0b3dc12` | 205,815 |

## Runs

| dir | backend telemetry | request bridge | window (UTC) | steps completed |
|---|---|---|---|---|
| `.` (top level) | off (declared) | withheld (`PRODUCTTRACE_NO_BRIDGE=1`) | 11:37–11:38 | 1–10 |
| `frontend-only-with-bridge/` | off (declared) | served | 11:39–11:40 | 1–8; 9 reply sent, then STOP at the conversation menu; 10 not run |
| `backend-on/` | on | served | 11:43–11:46 | 1–8; 9 reply sent, then STOP at the conversation menu; 10 not run |

## Results (reached / stopped at / because)

### Frontend-only, bridge withheld (top level)

- Capture 184,604/184,604 rows, 0 dropped, 0 gaps; element.stamp rows on their own counter 1,464, 0 gaps.
- Requests: wrapper 83 = Playwright 83, reconciliation 0. The runtime's own wrappers were the only request source.
- 346 actions → 346 chains; grader mismatches 0. Terminals: 337 `browser | no request observed`, 9 `network | backend not instrumented`. Chains with any backend stop: 0. route/handler/db rows in records: 0. **Frontier half of G1: reached.**
- Entry handlers: all nine final7 handler function ids credited (login, send, feedback, regenerate, edit-resubmit, rename, agent-create, agent-chat, delete).
- **Stopped at:** the chat submissions. `POST /api/agents/chat/openAI` (×4) and `POST /api/agents/chat/agents` (×1), and their stream/status GETs, are `unattributed_transport` (30 of 83 requests unattributed, 4 of them pre-login boot). **Because:** without the static-era bridge's handler/request wrappers, the runtime's continuation does not reach LibreChat's chat request, which is issued from a React state → effect path the runtime does not carry. The send/regenerate/edit/agent-chat actions therefore end at `browser | no request observed` — explicit, but the request that did happen is not on the chain. This is the fresh-repo configuration, so it is a real G1/G2 gap, recorded, not fixed (the task said not to change attribution logic).

### Frontend-only, bridge served (`frontend-only-with-bridge/`)

- Capture 205,815/205,815, 0 gaps; requests 73 = 73, reconciliation 0.
- 336 chains, mismatches 0: 323 `browser | no request observed`, 13 `network | backend not instrumented`, 0 backend stops. Send/regenerate/edit-resubmit now end at `network | backend not instrumented`.
- Handlers reproduced for the seven flows that ran. Agent-chat/delete not driven (harness STOP, below). `records.jsonl.gz` (gzip of the raw file).

### Backend on (`backend-on/`)

- Capture 216,380/216,380, 0 gaps; requests 73 = 73, reconciliation 0.
- `spans.jsonl` is the viewer's persisted span log (`.m1-live/backend-spans.jsonl`, 2,092 spans). The harness's `/api/demo/backend-spans/latest` returned 0 because the live viewer admits spans only for traces it has seen on its own live endpoint, and the scripted session captures to its own `/__capture`. Joins are by exact trace id + parent span, so the extra spans in the log cannot join to this session.
- 336 chains, grader mismatches 0: 323 `browser | no request observed`, 12 reached db, 1 `handler | no db span under handler`.
- Final7 reproduction, per flow:

| flow | final7 handler credited | reached | stopped at / because | Mongo (run window, test user) |
|---|---|---|---|---|
| login | yes | db: `insert sessions` | — | session `6ab3bb6d…` created 11:43:41 |
| send | yes | db: `findAndModify messages/conversations`, `insert transactions` | — | messages 9, conversations 2, transactions 14 updated/created in window |
| feedback | yes | server handler | handler / no db span under handler | not applicable (no write) |
| regenerate | yes | db (messages, conversations, transactions) | — | as send |
| edit-resubmit | yes | db (messages, conversations, transactions) | — | as send |
| rename | yes | db: `findAndModify conversations` | — | conversation "Tracer M1" updated 11:43:59 |
| agent-create | yes | db: `insert agents`, `findAndModify aclentries` | — | agent "Barista" created 11:44:03 |
| agent-chat | not driven | — | harness STOP | — |
| delete | not driven | — | harness STOP | — |

**Backend-on half of G1: partially reproduced** — 7/9 handlers identical to final7, 6/8 mutation flows joined to a Mongo-confirmed write; feedback stopped at the handler; agent-chat and delete were not driven in this run.

## Verdict

- G1 "every action yields a chain ending in an explicit frontier, zero inferred backend stops" with backend telemetry off: **reached** (both backend-off runs: 0 backend stops, 0 grader mismatches).
- "ending in an explicit *network* frontier" for every action that issued a request: **stopped at** the chat submissions when the bridge is withheld, **because** their requests are unattributed (above). With the bridge served it holds.
- "With it enabled, final7 results reproduce": **not fully reached** (feedback, agent-chat, delete).
