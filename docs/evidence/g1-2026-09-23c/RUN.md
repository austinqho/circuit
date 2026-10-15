# G1 frontend-only mode, third pass (2026-09-23c)

Gate text: `docs/gates/G1-frontend-only.md`. The third-pass section there (D-G1-7, D-G1-8, D-G1-9, and the feedback correction to final7 `HANDLERS.md`) was recorded before this rerun. All browsers were headless Chromium. Code: branch `g1-g3-stamps` rebased onto `main` `47587bd9` (G2, G4, G6). Evidence was produced at `2718c324`.

## Build

- Fixture: LibreChat `45cc53c`, reused worktree `/tmp/producttrace-librechat-m1-final2`, parity baseline `/tmp/producttrace-librechat-m1-final`.
- `scripts/m1-live.sh` was run with `PRODUCTTRACE_BACKEND_TELEMETRY=1`, then with `=0`. `PRODUCTTRACE_OPENAI_FIXTURE=1` was set in both runs (deterministic local chat replies, no model call).
- Both builds: 8,769 functions, runtime markers 8,769/8,769, Agent Builder parity true, build id `bb4fdc45a4bc`. The two builds have identical function-id sets.
- Placements: 8,198 in the manifest. Manifest: `attribution-manifest.json.gz`.
- Session: `test/browser/m1-session-headless.mjs` with `PRODUCTTRACE_NO_BRIDGE=1` (request bridge withheld) and `PRODUCTTRACE_EVIDENCE_FORMAT=jsonl`.
- Chains: `node test/browser/g1-chains.mjs <dir> --backend=on|off --manifest=<manifest>`.
- Grade: `node test/browser/g1-grade.mjs <dir> --backend=on|off --final7=docs/evidence/m1-2026-09-22-final7/coverage.json [--mongo=mongodb://127.0.0.1:27017/LibreChat]`.

## Raw records (gzipped, lossless)

| file | raw sha256 | rows |
|---|---|---|
| `frontend-only/records.jsonl.gz` | `c673eb0750c66a16069ccb6adaab5e38a7a4f10207760baa52620092f1f26d23` | 289,454 |
| `backend-on/records.jsonl.gz` | `c53720a2dcc8f0c443141e0a11486dc58680dd5276cdbc11133a753d5564da53` | 259,762 |

`backend-on/spans.jsonl` is the viewer's span log, truncated immediately before the session (2,346 spans).

## Results (reached / stopped at / because)

Both runs completed session steps 1–10. Capture: emitted = received (289,454 and 259,762), 0 gaps, 0 drops. Requests: Playwright = wrapper, 82/82 and 83/83, reconciliation 0.

### Backend telemetry off (`frontend-only/`)

- 346 actions, 346 chains. The independent grader found 0 mismatches and passed.
- Terminals:
  - 14 `network | backend not instrumented`;
  - 175 `handler | no element-bound handler ran; global listeners: [...]`;
  - 157 `browser | no request observed`.
- 0 route/handler/db stops.
- Request linkage: 23 `direct`, 9 `state_effect`, 25 `mount_effect`, 25 unattributed.

### Backend telemetry on (`backend-on/`)

- 345 chains, 0 grader mismatches.
- Terminals:
  - 12 reached db;
  - 1 `handler | no db span under handler` (feedback);
  - 175 handler abstentions;
  - 157 `browser`.
- Request linkage: 22 `direct`, 14 `state_effect`, 5 `mount_effect`, 42 unattributed.
- The grader's `pass` is false only because of the feedback handler. The grader compares with final7's `3324:3559`; this run credits `3347:3559`, which is the correction recorded in the gate doc.

| flow | handler credited | reached | Mongo, read by hand (`mongosh`, test user) |
|---|---|---|---|
| login | final7 id | db `insert sessions` | session `6ab3ef5e…` at 15:25:18 |
| send | final7 id | db messages/conversations/transactions | conversation `fa1b0fc1…` created 15:25:20.513 |
| feedback | `Feedback.tsx:3347:3559` (the correction) | stopped at handler, because no db span under handler | no feedback written (placeholder id; harness limit) |
| regenerate | final7 id | db | messages in window |
| edit-and-resubmit | final7 id | db | messages in window |
| rename | final7 id | db `findAndModify conversations` | `fa1b0fc1…` "Tracer M1", updated 15:25:36.459 |
| agent create | final7 id | db `insert agents`, `findAndModify aclentries` | agent "Barista 1790177116869" 15:25:39.041; aclentries `agent` and `remoteAgent` 15:25:39.046 |
| agent chat | final7 id | db | messages in window |
| delete | final7 id | db deletes (conversations, messages, sharedlinks, toolcalls, checkpoints) | 7 messages created by the user in the window |

The grader's own Mongo counts show 0 for `sessions` and `aclentries`: `sessions` has no `createdAt` field, and the grader's `aclentries` query did not match. The hand reads above supersede those counts.

Scorecard: 9 of 9 handlers (8 identical to final7, plus the feedback correction). 7 of 8 mutation flows reached a Mongo-confirmed write; feedback is a documented harness limit.

## Round-three items

1. **Mount effects (D-G1-7).**
   - `continuations-neutral.json`: `/api/mounted` gets `mount_effect`; `/api/state-effect` and `/api/submit` get `state_effect`; `/api/after-await` gets `direct`.
   - Negatives: `/api/unrelated` (a sibling re-rendering in the same commit), `/api/late-mount` (a mount effect in a later commit without a receipt) and 6 × `/api/poll` are all unattributed.
   - On LibreChat, unattributed requests are 25 (telemetry off) and 42 (telemetry on). Both lists are in `unattributed-requests.json`.
2. **Bound includes native element listeners (D-G1-8).** Handler abstentions went from 176 to 175: `useAutoSave`'s element listener is now bound. The most frequent remaining unbound frames:
   - `packages/client/src/hooks/useInputModality.ts:352` (106 actions);
   - `client/src/components/Chat/Input/QuoteButton.tsx:3289` (91);
   - `client/src/hooks/Generic/useShiftKey.ts:848` (72);
   - `client/src/components/Chat/Input/ChatForm.tsx:15018` and `:22658` (71 each);
   - `packages/client/src/components/ThemeSelector.tsx:789` (37).

   See LIMITS for the two ChatForm frames.
3. **Small callbacks.**
   - `manifest-regression.json`: 12/12 present. These are the 8 from round two plus 4 found in this pass: `AskUserQuestion.tsx:5447`, `Conversations.tsx:1995`, `ProjectChatList.tsx:1662`, `SSE/queries.ts:6568`.
   - The map put their first token on the key or JSX attribute they are the value of, or on the end of the opening tag whose child expression they are.
4. **Drift against final7** (`drift-vs-final7.json.gz`):
   - 6,566 ids shared; 945 replaced by a boundary correction; 1,377 final7 spans that are not functions on disk; 64 removed by the first-party rule; **0 unexplained**.
   - Every one of the 8,769 new ids is an exact function node on disk (final7: 74%).
5. **Span neutrality** (`span-neutrality.json`): with `PRODUCTTRACE_PLACEMENTS=0 PRODUCTTRACE_AWAIT_CONTINUATIONS=0`, the same 8,769 ids, zero drift (placements 8,198 vs 0).
