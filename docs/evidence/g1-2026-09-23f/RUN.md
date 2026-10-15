# G1 sixth pass (2026-09-23f)

Engine head `1db04881` (runtime `f17f997a` plus the boundary rule in `1db04881`); docs in `724f7b18`. Headless Chromium. The fifth-pass directories are unchanged; corrections to them are in `ERRATA-e.md`.

## What changed and why this directory exists

1. **Functional no-op updater (D-G1-16).**
   - "Changed" is now `Object.is(rendered, captured)` for function updaters too (`src/runtime-attribution-browser.js:86`).
   - The grader's case, `setOpen(o => false)` while false followed by an unrelated re-render, is now in the neutral fixture (`P1f`) and in `test/action-context.test.mjs`.
2. **React 19 dispatcher (D-G1-17).**
   - The dispatcher is found from the renderer's version: `.current` for React 16–18, `.H` for React 19 (`src/runtime-attribution-browser.js:228–260`).
   - Otherwise the runtime emits one `capture.limit` row and one warning, and receipts abstain.
3. **`lookupOwn`.** This was a different boundary-rule case from the fifth-pass `.ts` fix.
   - The map puts the start of `const lookupOwn = <T>(…) =>` on the binding name, 12 characters before the arrow, and its end on the `undefined` token.
   - `valueOfToken` now accepts a plain `=` separator (`integrations/runtime-attribution.mjs:231`).
   - Effect on the LibreChat build: +173 functions (8,954 → 9,127). All 8,954 earlier ids are kept, and every new id is an exact function node on disk. All 173 are initializer arrows.
4. **MCP.** A test covers `stopped_at: "entry_handler"` (`test/mcp-entry-handler.test.mjs`).

Items 1–3 change LibreChat behaviour, so both LibreChat runs were repeated.

## Checks

- **`npm run build`**: byte-identical runtime; `dist/runtime-attribution-browser.js` equals `src/`.
- **`npm test`** (`npm-test.log`): 623 tests, **622 pass, 1 known failure** (`react-context-ref-semantics.test.mjs:63`).
- **`continuations-neutral.mjs`**: **5/5**. `/api/p1f-tick` is never attributed (830–835 per run, all after actions). Every fifth-pass case is unchanged. On the `2e0fee9f` runtime the P1f assertion fails.
- **`react-versions-receipts.mjs`** (`react-versions-receipts.out.json`): the continuations fixture was built against React **18.3.1** and **19.2.4**.
  - Both versions give the same results:
    - `/api/state-effect` is `state_effect`;
    - `/api/mounted` is `mount_effect`;
    - `/api/form-submit` is `direct` to the submit;
    - P1f is never attributed.
  - An injected renderer whose dispatcher is not where its version says produces one `capture.limit` row `{feature: "state_receipts", reason: "dispatcher not found", react_version: "99.0.0"}` and one warning, even though it was injected twice.
  - On the `2e0fee9f` runtime, the React 19 state effect is unattributed.
  - 19.2.3 was not available offline, so 19.2.4 was used. I downloaded nothing. The React 19 root is a scratch directory: LibreChat's `node_modules` symlinked, with `react`, `react-dom` and `scheduler` copied from a local 19.2.4 install and `react-hook-form` copied so it resolves the same React.

## LibreChat (request bridge withheld)

- **Build.** `fa15c48647d8`: 9,127 functions, 8,198 placements. Manifest `attribution-manifest.json.gz`, raw sha256 `7907fc767cba0cb1f4a48c5e6f726d87acb89cc9b3ed2bb609c972dea0589509`. Regression list: 34/34 (`manifest-regression.json`); `lookupOwn` (`artifacts.ts` 11471) is present.
- **Parity.** Both `m1-live.sh start` attempts built successfully but failed the parity gate on the default model name. Without the chat fixture, the backend's default model differs between page loads.
  - A manual run of `agent-builder-parity.mjs` against that backend returned false once and true twice.
  - I then started the services with a scratch copy of `m1-live.sh` whose only change is to skip the build line and use the already-built client. The copy is at `/private/tmp/claude-501/sp/m1-live-nobuild.sh`, and the diff is those two lines.
  - The recorded parity is the passing manual run.
  - I did not change the gate in the repo.
- **Commands.** Session, chains and grade exactly as in `../g1-2026-09-23e/RUN.md`. Corrected notes are in `unattributed-notes.json`.

| | telemetry off (`frontend-only/`) | telemetry on (`backend-on/`) |
|---|---|---|
| records sha256 (raw) / rows | `98bb768d64e3e3670b82f4db3cce87ca2b13d7bc7d83e1b9fccced98c1db66ce` / 138,688 | `bbffe2a4786c97f79a8ba500122cb49fe4f30c797b38b8357fc80abf921c6095` / 128,038 |
| drain lossless / last sequence | yes / 137,898 | yes / 127,247 |
| Playwright = Tracer | 82 = 82, reconciliation 0 | 82 = 82, reconciliation 0 |
| actions = chains, mismatches | 345, 0 | 346, 0 |
| core chat POSTs | send `state_effect`, regenerate `direct`, edit `direct`, agent chat `state_effect`: **4/4** | same, **4/4** |
| handlers vs corrected table | **9/9** | **9/9** |
| terminals | 13 network / backend not instrumented, 113 `entry_handler`, 219 browser; **0 backend stops** | 12 reached_db, 1 handler (feedback), 113 `entry_handler`, 220 browser |
| writes | n/a | 7 writing flows at db; feedback at its handler, no write |
| linkage | 28 direct, 10 state_effect, 5 mount_effect, 39 unattributed | 28 direct, 9 state_effect, 5 mount_effect, 40 unattributed |
| `capture.limit` rows | 0 | 0 |

**Mongo by hand** (`backend-on/mongo-by-hand.json`, 21:34:43–21:36:50Z):

- session `6ab445f5`;
- conversation `6f618dc7` "Tracer M1", 7 messages, 10 transactions;
- agent "Barista 1790199283710" with aclentries `agent` and `remoteAgent`;
- 4 transactions for the deleted agent-chat conversation;
- 0 feedback writes.

**Unattributed requests** (`*/unattributed-requests.json`): each entry has a reason and a note.

- The telemetry-on run has one more than the telemetry-off run. It adds `GET /api/convos/gen_title/:id` after send. That request was `state_effect` in the telemetry-off run and in both fifth-pass runs.
- It is a recall abstention, not a wrong credit. `pendingReceipts` is cleared at the end of every commit walk, so an unrelated commit can consume the send's receipt first. The grader flagged this as a structural recall hazard.
