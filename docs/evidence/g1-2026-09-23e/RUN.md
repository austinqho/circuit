# G1 frontend-only mode, fifth pass (2026-09-23e)

Gate text: `docs/gates/G1-frontend-only.md`. The "Fifth pass" section (D-G1-14, D-G1-15) was written during this pass, from the coordinator's rule. All browsers were headless Chromium.

Code: branch `g1-g3-stamps`, engine head `08c509c2`. Engine commits in this pass:

- `83e76d8d`: creation-time ownership and the strict stack;
- `08c509c2`: React work is not a creation site;
- `999deea4`: boundary rule parses `.ts` as TypeScript, plus the drain fix.

Test commits: `a74d08af`, and `522ac004` (the drift checker's `.ts` parse). Every LibreChat, neutral, D12 and G3 figure below was produced on `08c509c2`. Outputs made on `999deea4` before `08c509c2` are kept in `superseded-999deea4/`; see "First attempt" below.

**Summary: every target is met.**

- 4/4 core chat POSTs are attributed.
- 9/9 credited handlers match the corrected HANDLERS table.
- 7 writing flows plus feedback reach the handler.
- There are zero backend stops with telemetry off.
- The capture drained losslessly.
- The 14 round-four misattributions no longer occur.

## Build

- LibreChat fixture `45cc53c`, worktree `/tmp/producttrace-librechat-m1-final2`, parity baseline `/tmp/producttrace-librechat-m1-final`.
- Services were run with `scripts/m1-live.sh start`:
  - `PRODUCTTRACE_OPENAI_FIXTURE=1`;
  - `PRODUCTTRACE_BACKEND_TELEMETRY=0`, then `=1`.
- Each start rebuilt the client. Both builds have build id `5ff8a34ee267`, 8,954 functions and 8,198 placements, and Agent Builder parity is true.
- The build id hashes the function set, not the runtime. I checked that the served `index.html` contains the `08c509c2` runtime (`effectFlushFrame`, `reactEventTarget`).
- Manifest: `attribution-manifest.json.gz`, raw sha256 `b7ed23f3eac1692865490152cd71f66dd7fa42d61d85703891424bc96eb45663`.
- Two earlier `m1-live.sh start` attempts failed the parity gate. The plugin-disabled and plugin-enabled clients showed different default model names (`gpt-5-search-api-2025-10-14` vs `gpt-5.6-terra`); the backend was starting without the chat fixture. I re-ran the parity script twice by hand against the fixture backend: parity was true both times. The third start passed its own gate.
- `npm run build`: "built byte-identical runtime (304724 bytes)"; `dist/runtime-attribution-browser.js` is committed identical to `src/`.
- Session: `PRODUCTTRACE_NO_BRIDGE=1 PRODUCTTRACE_EVIDENCE_FORMAT=jsonl node test/browser/m1-session-headless.mjs /tmp/producttrace-librechat-m1-final2 <dir>`. The request bridge is withheld.
  - Telemetry off: 20:13:38Z–20:14:41Z.
  - Telemetry on: 20:26:25Z–20:27:28Z.
- Chains: `node test/browser/g1-chains.mjs <dir> --backend=on|off --manifest=<manifest>`.
- Grade: `node test/browser/g1-grade.mjs <dir> --backend=on|off --final7=docs/evidence/m1-2026-09-22-final7/coverage.json --corrections=handlers-corrections.json [--mongo=mongodb://127.0.0.1:27017/LibreChat]`.
  - `--corrections` is new. It holds the one documented HANDLERS correction (feedback `3347:3559`, gate doc "Correction to final7").
- Unattributed list: `node test/browser/g1-unattributed.mjs <dir> --notes=unattributed-notes.json` (new).
- `backend-on/spans.jsonl` is the viewer's span file log, truncated before `m1-live.sh start` and copied after the session: 2,350 spans, including 3 `/health` spans from startup. The in-memory endpoint is empty when the bridge is withheld, as in round four.

## Raw records (gzipped, lossless)

| file | raw sha256 | rows |
|---|---|---|
| `frontend-only/records.jsonl.gz` | `c11d5a4d6a5f8bcf70587c17d020f9fd8bd10d5a3a37a23a637df4c58fff6cb9` | 140,476 |
| `backend-on/records.jsonl.gz` | `024af320d244e0e2e36f67a66f1e055a0f24998fff362f28c5ef5113dc9b0587` | 134,917 |

Rows fell from 570,995 / 556,548 in round four, and are below round three's 289,454 / 259,762. The leaked frame in round four made React work emit action-owned function rows. Renders no longer inherit an action.

## Step 1: `npm test` (`npm-test.log`)

- 616 tests: **615 pass, 1 fail**. The failure is the known one, `test/react-context-ref-semantics.test.mjs:63`.
- New in this pass:
  - `test/action-context.test.mjs` (8 tests): the node-level receipt bookkeeping test the round-four grade asked for, plus the stack and ownership rules;
  - one `.ts` boundary test in `function-boundary.test.mjs`.
- Against the round-four runtime, 7 of the 8 `action-context` tests fail, and the new boundary test fails without the fix.

## Step 2: neutral continuations (`continuations-neutral.out.json`, `continuations-neutral-summary.json`)

`node test/browser/continuations-neutral.mjs`: **exit 0, 5 of 5 page loads.** Results were identical in every run.

| request | case | result (every run) |
|---|---|---|
| `/api/form-submit` | (1) react-hook-form submit: library `await` of async validation, then the app's `onSubmit`, then fetch | `direct` to the submit action |
| `/api/pre-armed` | (2) timer armed at the click's pointerdown, firing after the click | unattributed |
| `/api/poll`, `/api/sibling`, `/api/p1-tick`, `/api/p2-tick` | (3) the 1 ms `setInterval` armed at load, ticking through every click (65–69 / 898–903 / 830–833 / 756–759 per run, all after actions) | unattributed |
| `/api/p2-a`, `/api/state-effect`, `/api/submit` | (4) receipts | `state_effect` |
| P1, P2 negatives | (4) | never attributed |
| `/api/after-reject`, `/api/after-throw` | (4) rejected awaits | `direct` to their click |
| `/api/cross-timer`, `/api/cross-promise` | (5) created in action A, run after action B started | attributed to A |
| `/api/nested-after-focus` | (6) the parent's bubbling onClick after a handler that ends right after a programmatic `focus()` | `direct` to the click. Its spine does not contain the returned handler. |
| `/api/nested-leak` | (6) an unowned `MessageChannel` pump's later promise reaction | unattributed |
| `/api/mounted`, `/api/after-focus`, `/api/after-await`, `/api/late-mount`, `/api/unrelated` | unchanged from round four | as in round four |

- With receipts disabled, `/api/state-effect` is unattributed.
- With awaits disabled, `/api/after-await` is unattributed.
- The global-listener case stops at `entry_handler`.

**Against the round-four runtime** (`76935188` dist swapped in, assertions made non-fatal), these fail: form-submit, its linkage, the strict-stack spine and the leak probe. P1, P2 and sibling also fail there: the leaked frame from the nested-focus click contaminates them, which is the LibreChat symptom reproduced on the fixture.

## Step 3: D12

See `../g3-2026-09-23e/RUN.md`: 17 of 17 checks pass.

## Step 4: LibreChat, request bridge withheld

### Capture (the drain fix)

| | telemetry off | telemetry on |
|---|---|---|
| `capture_page_id` | 1 | 1 |
| `sequence` contiguous 1..N | yes, N = 139,684 | yes, N = 134,126 |
| `stamp_sequence` contiguous | yes, 792 | yes, 791 |
| drain: queue empty, no batch in flight | yes (3 ms) | yes (2 ms) |
| rows through the drain instant received | 139,684 / 139,684, stamps 792 / 792 | 134,126 / 134,126, stamps 791 / 791 |
| rows emitted after the drain | 0 | 0 |
| emitted / sent / dropped | 140,476 / 140,476 / 0 | 134,917 / 134,917 / 0 |
| Playwright requests = Tracer requests | 82 = 82, reconciliation 0 | 83 = 83, reconciliation 0 |
| session script exit | 0 | 0 |

- **Session script change.** It now waits until the page queue is empty and no capture batch is in flight. It reads the last emitted sequences in the same evaluation, and fails explicitly ("capture did not drain within N ms") after a hard cap (`PRODUCTTRACE_DRAIN_CAP_MS`, default 600 s).
- The run passes only if every row up to the drain instant was received (`coverage.json` → `capture.drain.lossless`).
- Batches are now up to 1 MB / 4,096 rows and no longer use `keepalive`. `keepalive` bodies share a 64 KB in-flight quota; round four logged 11,114 aborted `/__capture` POSTs.

### Telemetry off (`frontend-only/`)

- 345 actions, 345 chains. `GRADE-g1.json`: 0 mismatches, 0 extra chains, `pass: true`.
- Terminals:
  - 13 `network | backend not instrumented`;
  - 113 `entry_handler | no element-bound handler ran; global listeners: [...]`;
  - 219 `browser | no request observed`.
- **0 route/handler/db stops, 0 backend steps, 0 backend rows.**
- Linkage: 28 `direct`, 10 `state_effect`, 5 `mount_effect`, 39 unattributed. Round four: 39 / 0 / 5 / 39.

### Four core flows' chat POST

| flow | off | on |
|---|---|---|
| send | @18220 `state_effect`, submit `send-button` | @18455 `state_effect`, submit |
| regenerate | @32240 `direct`, `regenerate-generation-button` | @32762 `direct` |
| edit-and-resubmit | @47639 `direct`, Save & Submit (`EditMessage.tsx`, element key `p_289ebfafc16d:6176-6450#n1`) | @48211 `direct` |
| agent chat | @102255 `state_effect`, submit `send-button` | @103918 `state_effect` |

**4/4 in both runs** (round four: 1/4). Login (`POST /api/auth/login`, `direct` to the login submit) and agent create (`POST /api/agents`, `direct` to the Create submit) are also attributed.

### Credited handlers against final7 HANDLERS with the feedback correction (`GRADE-g1.json` → `flows`)

| flow | expected | off | on |
|---|---|---|---|
| login | `3870:3894` | yes | yes |
| send | `17345:18011` | yes | yes |
| feedback | corrected `Feedback.tsx:3347:3559` | yes | yes |
| regenerate | `3465:3490` | yes | yes |
| edit-resubmit | `1759:3526` | yes | yes |
| rename | `1876:1902` | yes | yes |
| agent create | `13140:14819` | yes | yes |
| agent chat | `17345:18011` | yes | yes |
| delete | `2331:2656` | yes | yes |

**9/9** (round four: 4/9).

### Telemetry on (`backend-on/`)

- 346 chains, 0 mismatches, 0 extra chains.
- Terminals:
  - 12 `reached_db`;
  - 1 `handler | no db span under handler` (the feedback PUT);
  - 113 `entry_handler`;
  - 220 `browser`.
- Mutating requests joined to spans (`requests-attribution.txt`, `spans.jsonl`); every one is attributed except the boot `POST /api/auth/refresh`:
  - login: insert sessions;
  - send, regenerate, edit, regenerate #2 and agent chat: findAndModify messages/conversations + insert transactions;
  - rename: findAndModify conversations;
  - agent create: find/findAndModify/insert;
  - delete: deletes on 6 collections;
  - feedback: `find` only, no write.
- **The 7 writing flows reach db, and feedback reaches its handler.**
- The grader's `pass` is false only because its rule requires joined writes for every flow and feedback does not write (harness placeholder id, as in rounds three and four).
- Mongo by hand (`mongo-by-hand.json`, test user, 20:26:25–20:28:30Z):
  - session `6ab435f3` at 20:26:27. Sessions have no `createdAt`; the time comes from the ObjectId;
  - conversation `e7ef87f6` "Tracer M1": 7 messages, 10 transactions;
  - agent "Barista 1790195185989" at 20:26:49.267;
  - aclentries `agent` and `remoteAgent`, permBits 15;
  - 4 transactions for the deleted agent-chat conversation `dea356ac`;
  - 0 feedback writes.

### Unattributed requests (`*/unattributed-requests.json`, one reason per entry)

39 in each run:

- **4 `before_first_action`**: boot, before login.
- **35 `unowned_continuation`**. No action frame was current when each request was created. Each has a note (`unattributed-notes.json`):
  - 25 post-login requests (`/api/roles/*`, `/api/user`, `/api/endpoints` … `/api/agents`) and `/health`. The login response routes to the chat view; react-query observers of the newly rendered view subscribe in effects flushed on React's scheduler without a receipt on their fibers. `/health` is a timer armed before any action.
  - After regenerate / agent chat: `GET /api/messages/:id` and `GET /api/agents/chat/status/:id`, created after the stream ended through a query invalidation flushed on the scheduler.
  - After agent create: `GET /api/agents/:new`, `/api/agents/actions`, 4 × `/api/permissions/...` and `/expanded`. These are queries for the newly selected agent, mounted by the panel re-render with no receipt on those fibers.
- The two runs differ by one entry each way:
  - off has an unattributed `GET /api/permissions/agent/:id`, which on credits `mount_effect` to agent create;
  - on has an extra unattributed `GET /api/balance` in the post-login batch.
- These are abstentions (unowned creation), not wrong credits. They remain the recall gap of the receipt rule.

## The 14 round-four misattributions: mechanism and why it cannot recur

Source: round four's `frontend-only/records.jsonl.gz`. The extract is in `round4-misattribution-mechanism.json`. All 16 requests credited `direct` to the send click `action:mueg0ec6:191` share the same mechanism. That includes the two "plausible" ones (`chat/status`, `gen_title`) and the 14 later-flow ones. I inspected @94742 `GET /api/share/link` (after regenerate), @108936 `GET /api/agents/chat/status` (after edit) and @238051 `GET /api/agents/agent_…` (after agent create).

1. **The send step clicks the chat container.** Rows @39360–39362: the click action 191, then `function.enter` twice for `ChatForm.tsx:6016:6189` (`handleContainerClick`), frames `…:75465` and `…:75466`.
2. **The handler calls `textAreaRef.current.focus()`.** Row @39363 is a nested trusted `focusin` action 192. Commit `05b1e13f` pushed it with `resume` = the handler frame `75466`.
3. **The handler returns right after `focus()`.** Rows @39372–39373 are the two `function.exit` rows. The round-four `exit` popped only `if (current === frame)`. `current` was the focusin frame, so the handler frame was never popped.
4. **Later, `settleAmbient` found the focusin dispatch over and resumed `resume` = frame `75466`.** That is a function frame, which is never "stale", so it stayed `current` for the rest of the session. React's scheduler messages ran unwrapped and saw it as ambient state. Every promise reaction, timer and function entered from them captured it:
   - 14,392 function rows were entered as direct children of the exited frame `75466`;
   - 207,954 rows carry its spine prefix `[6016:6189, 6016:6189]`.
5. **All three inspected requests** (and all 16) have `spine.function_ids` starting with `[ChatForm.tsx:6016:6189 ×2]` and a `promise` parent continuation under action 191. They were created in code that ran under the leaked frame.

**Why it cannot recur:**

- `exit(frame)` now always restores `frame.parent`, the frame current at `enter`. The focusin frame still on top is discarded with the handler that caused it (step 3).
- An ended dispatch frame pops to exactly the frame current when it began. That target can only be a frame that is still on the stack.
- Scheduler messages, timers and animation frames run under their captured owner or under none, and restore `null` when they end. Nothing ambient survives a task.

Evidence in this pass:

- `handleContainerClick` still runs at send (`6016:6189` is credited in the send flow).
- `share/link`, `messages` and `tools/calls` after regenerate are credited to the regenerate click `…:201`.
- `chat/status` after edit is credited to the Save & Submit click `…:211`.
- The post-create agent GETs are unattributed.
- On the fixture, `/api/nested-leak` and the strict-stack spine assertion fail on the round-four runtime and pass now.

## First attempt on `999deea4` (superseded, `superseded-999deea4/`)

The first telemetry-off run used only the creation-time rule (`83e76d8d` + `999deea4`). It attributed send and agent chat (`state_effect`), login and agent create. Regenerate (@26772), edit (@28461) and regenerate #2 were unattributed, so the result was 2/4. The delete flow's `DELETE /api/convos` (@59876) and its follow-up GETs were credited `direct` to the agent-create action `…:267`.

- **Cause of the delete misattribution.** A portal container's delegated React listener was registered while React's scheduler loop ran on a message owned by 267. That listener then ran every later click in the portal (the delete dialog) under 267.
- **Cause of the regenerate/edit loss.** Their effects were flushed on the bare frame and were unreceipted.

`08c509c2` addressed both (D-G1-15). That run's records, grade and chains are kept for this reason. The neutral, D12 and `npm test` outputs from `999deea4` are superseded by the ones in this directory.

## Drift against final7 (`drift-vs-final7.json.gz`, `drift-real-functions-missing.json`)

- Final7 has 8,952 ids; this build has 8,954.
- Categories:
  - 6,583 shared;
  - 978 boundary-corrected;
  - 1,327 abstained_not_a_function;
  - 64 first-party filter;
  - **0 unexplained**.
- All 2,371 new-only ids are exact function nodes on disk (`new_only_not_exact` 0).
- **Real functions missing (round four's rule): 0.** The 22 functions of round four (14 in `packages/data-provider/src/parsers.ts`, 8 in `client/src/utils/artifacts.ts`) are all in the manifest.
  - The cause was the boundary rule parsing every `.ts` file as TSX. A generic arrow (`getFallbackEndpointSchema = <TSchema>(…)` in `parsers.ts`) or a `<T>value` assertion turned the rest of the file into JSX text, so no later function had a boundary. `parsers.ts` kept 3 of 26 function nodes under TSX; `artifacts.ts` kept 13 of 23.
  - Fixed in `exactOriginalFunctionBoundary`, and in `manifest-drift.mjs`, which had the same bug.
- `test/browser/manifest-regression-8.mjs` now checks those 22 ids plus the earlier 12: **34/34 present** (`manifest-regression.json`).
- The span-resolution debug switch used to find the cause is `PRODUCTTRACE_SPAN_DEBUG`.

## Span neutrality (`span-neutrality.json`, `attribution-manifest-placements-await-off.json.gz`)

Command: `PRODUCTTRACE_PLACEMENTS=0 PRODUCTTRACE_AWAIT_CONTINUATIONS=0 PRODUCTTRACE_REUSE_WORKTREE=1 node test/browser/build-librechat-autonomous.mjs /Users/austinho/dev/trace-consolidated/.live-demo/librechat-m1 /tmp/producttrace-librechat-m1-final2 <out>` (log: `neutral-build.log`).

- Off build `a0ce15c2137b`: 8,954 functions, 0 placements. On build `5ff8a34ee267`: 8,954 functions, 8,198 placements.
- **Identical function-id sets** (`only_on` = `only_off` = empty).
- Off manifest: `attribution-manifest-placements-await-off.json.gz`, raw sha256 `53f698bc389a5a7969c7947753e8701f0ff911988d9e2542f593efe6dc703a18`.
- This build ran last and left the placements/await-off build in the worktree.

## Worse than round three

- **Unattributed requests with telemetry off: 39 vs 25.** Round three inherited run-time ambient frames, which the grader rejected. Some of its 25 "attributed" were ambient credits. The post-login batch and the post-create agent queries are now abstentions.
- **G3 own-JSX misses: 12 vs 6** (`../g3-2026-09-23e/RUN.md`). More `CellMeasurer` rows were rendered on the surveyed surfaces; this is the same known miss, not a new one.
- **D12's normalized-record sha changed.** The runtime emits different rows; renders no longer inherit. Identity holds within the run.
- Nothing else is worse than round three: 4/4, 9/9, the 7 writes, 0 backend stops, and a drained capture.
