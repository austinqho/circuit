# G1 frontend-only mode, fourth pass (2026-09-23d)

Gate text: `docs/gates/G1-frontend-only.md`. The "Fourth pass" section there (D-G1-10 to D-G1-13) was recorded before this rerun. All browsers were headless Chromium.

Code: branch `g1-g3-stamps`, head `595b334e`. The fourth-pass commits are `b42ba84f`, `669fc476`, `e5756a0a`, `05b1e13f` and `595b334e`. No engine code was changed while producing this directory.

**Summary: the neutral fixture passes, but LibreChat regressed against round three.**
- The four-core-flow criterion fails.
- The telemetry-on handler scorecard fell from 9/9 to 4/9.
- A new deterministic misattribution appeared.
- The capture no longer drains before the snapshot.

See "Regressions versus round three" below.

## Build

- LibreChat fixture `45cc53c`, worktree `/tmp/producttrace-librechat-m1-final2`, parity baseline `/tmp/producttrace-librechat-m1-final`.
- Services were run with `scripts/m1-live.sh`:
  - `PRODUCTTRACE_M1_WORKTREE=/tmp/producttrace-librechat-m1-final2`;
  - `PRODUCTTRACE_M1_BASELINE=/tmp/producttrace-librechat-m1-final`;
  - `PRODUCTTRACE_OPENAI_FIXTURE=1`;
  - `PRODUCTTRACE_BACKEND_TELEMETRY=1`, then `=0`.
- **Telemetry on.** The build that served this run was made by the previous agent at 10:01:41 PDT, after the head commit (09:50:07 PDT), and no tracked file changed since. I reused it and did not rebuild.
- **Telemetry off.** Rebuilt by `m1-live.sh start` at 10:46 PDT.
- Both builds: build id `687a51791eb4`, 8,928 functions, 8,198 placements, identical function-id sets, Agent Builder parity true. Manifest: `attribution-manifest.json.gz`.
- `npm run build`: "built byte-identical runtime (304724 bytes)", and `git status dist/` is clean.
- Session: `PRODUCTTRACE_NO_BRIDGE=1 PRODUCTTRACE_EVIDENCE_FORMAT=jsonl node test/browser/m1-session-headless.mjs /tmp/producttrace-librechat-m1-final2 <dir>`. The request bridge is withheld.
  - Telemetry on: 17:38:06Z–17:44:16Z.
  - Telemetry off: 18:34:55Z–18:40:59Z.
- `backend-on/spans.jsonl` is the viewer's span log `.m1-live/backend-spans.jsonl`, truncated immediately before the session (2,321 spans). The viewer's `/backend-spans/latest` endpoint returns `[]` when the bridge is withheld, because spans are admitted only against bridge-posted requests. The session therefore wrote an empty `spans.jsonl`, and the file log was copied in its place. Round three used the same file log.
- Chains: `node test/browser/g1-chains.mjs <dir> --backend=on|off --manifest=<manifest>`.
- Grade: `node test/browser/g1-grade.mjs <dir> --backend=on|off --final7=docs/evidence/m1-2026-09-22-final7/coverage.json [--mongo=mongodb://127.0.0.1:27017/LibreChat]`.
- Other outputs:
  - `*/requests-attribution.txt`: every non-internal request, with its action, linkage and trigger;
  - `*/contiguity.json`: sequence contiguity recomputed from raw rows;
  - `backend-on/mongo-by-hand.json`: a direct `mongosh` read of the run window for the test user.

## Raw records (gzipped, lossless)

| file | raw sha256 | rows |
|---|---|---|
| `frontend-only/records.jsonl.gz` | `e8ad2f1d52909ac4577876079bb9427b4980b505fcaf271102c9a51966a262ed` | 570,995 |
| `backend-on/records.jsonl.gz` | `2435bbc794a0c1cc7813346b5edde72314175e51e503d39fe207f229b5ee20cd` | 556,548 |

- Rows roughly doubled against round three (289,454 / 259,762).
- Almost all of the increase is `function.enter` / `function.exit` (backend on: 129,109 → 277,525 enters).

## Step 1: `npm test` (`npm-test.log`)

- 607 tests: **606 pass, 1 fail**.
- The failure is the known one, `test/react-context-ref-semantics.test.mjs:63`. It also fails on main.
- Round three had 605 tests (604 pass). The two new tests are in `element-stamps.test.mjs` and `function-boundary.test.mjs`.
- **No node-level state-receipt test was added to `npm test`.** The grade asked for one. Receipts are tested only in the browser suite.

## Step 2: neutral continuations (`continuations-neutral.out.json`, `continuations-neutral-summary.json`)

`node test/browser/continuations-neutral.mjs`: **exit 0, status ok, 5 of 5 page loads.** Results were identical in every run:

| request | linkage (every run) | fired after an action (per run) |
|---|---|---|
| `/api/mounted` | `mount_effect` | |
| `/api/state-effect`, `/api/submit` | `state_effect` | |
| `/api/after-await` | `direct` | |
| `/api/after-reject` (catch after a rejected await) | `direct` to its click | |
| `/api/after-throw` (catch after an awaited callee throws) | `direct` to its click | |
| `/api/after-focus` (programmatic focus inside an effect) | `mount_effect` to its click | |
| `/api/p2-a` (P2's own effect) | `state_effect` | |
| `/api/p1-tick` (no-op setter, then unrelated re-render) | unattributed, 519–520 per run | 519–520 |
| `/api/p2-tick` (two setters, then later commit) | unattributed, 444–446 | 444–446 |
| `/api/sibling` | unattributed, 588–590 | 588–590 |
| `/api/poll` (timer armed before the click) | unattributed, 40–45 | 40–45 |
| `/api/late-mount` | unattributed, 1 | 1 |
| `/api/unrelated` (child of the receipted component) | unattributed, 2 | |

- The ticker fired 1,294 times per run, 589 of those inside an action window.
- With receipts disabled, `/api/state-effect` is unattributed. With awaits disabled, `/api/after-await` is unattributed.
- The global-listener case stops at `entry_handler`.

## Step 4: LibreChat, request bridge withheld

### Capture and requests

| | telemetry off | telemetry on |
|---|---|---|
| `capture_page_id` | 1 | 1 |
| `sequence` contiguous 1..N, file order, no dups | yes, N = 570,229 | yes, N = 555,782 |
| `stamp_sequence` contiguous | yes, 766 | yes, 766 |
| emitted / received | **640,634 / 570,995** | **639,642 / 556,548** |
| `queued_at_snapshot` | **69,700** | **83,141** |
| Playwright requests = Tracer requests | 83 = 83, reconciliation 0 | 82 = 82, reconciliation 0 |
| session script exit | **1** (capture criterion) | **1** (capture criterion) |

The received rows are contiguous. However, 69,700 and 83,141 emitted rows were still queued in the page when the evidence was snapshotted. They are missing from the tail of the capture. In round three, emitted equalled received. The session script exits 1 on this criterion.

### Telemetry off (`frontend-only/`)

- 337 actions, 337 chains. The grader (`GRADE-g1.json`) reports 0 mismatches, 0 extra chains and `pass: true`.
- Terminals:
  - 10 `network | backend not instrumented`: every action that made a request;
  - 116 `entry_handler | no element-bound handler ran; global listeners: [...]`;
  - 211 `browser | no request observed`.
- 0 `route` / `handler` / `db` stops and 0 backend steps. The credit abstention now uses `entry_handler` (D-G1-13), so the literal "0 handler stops" claim holds.
- Request linkage: 39 `direct`, 0 `state_effect`, 5 `mount_effect`, **39 unattributed**.

### Four core flows' chat POST (both runs identical)

| flow | request | attributed? |
|---|---|---|
| send | `POST /api/agents/chat/openAI` @39909 (the `submit` action is @39908) | **no, unattributed** |
| regenerate | `POST /api/agents/chat/openAI` @82651 | yes, `direct` to the `regenerate-generation-button` click |
| edit-and-resubmit | `POST /api/agents/chat/openAI` @139511 | **no, unattributed** |
| agent chat | `POST /api/agents/chat/agents` @337919 | **no, unattributed** |

**The criterion fails: 1 of 4.** In round three, all 4 were attributed. The login POST and the agent-create `POST /api/agents` are also unattributed. The same pattern holds in the telemetry-on run: 39909, 141335, 344313, 246 and 242001 are all unattributed.

### Unattributed requests (`unattributed-requests.json`)

- There are 39 in each run: 36 XHR and 3 fetch, all with reason `unattributed_transport`. Round three had 25 (off) and 42 (on).
- Of the 39:
  - 4 are pre-login boot requests;
  - 1 is the login POST;
  - 27 are the post-login batch: `/api/banner` … `/api/agents` and `/health`;
  - the rest are the submit-driven chat POSTs with their streams (send, edit, agent chat) and `POST /api/agents`.
- In this pass the count is the same in both runs.

### Telemetry on (`backend-on/`)

- 337 chains; the grader found 0 mismatches.
- Terminals:
  - 9 reached db;
  - 1 `handler | no db span under handler` (the feedback PUT);
  - 116 `entry_handler`;
  - 211 `browser`.
- The grader's `pass` is **false**, because 5 flows do not reproduce their handler.
- Linkage: 38 `direct`, 0 `state_effect`, 5 `mount_effect`, 39 unattributed.

**Backend joins (recomputed from `spans.jsonl`).** All 11 mutating requests join to a server span, including the unattributed ones:

- 7 writing flows reach Mongo writes:
  - login: insert sessions;
  - send, regenerate, edit, regenerate #2 and agent chat: findAndModify messages/conversations + insert transactions;
  - rename: findAndModify conversations;
  - agent create: insert agents + findAndModify aclentries;
  - delete: 6 deletes.
- Feedback stops at `validateMessageReq` with 0 db spans.

**Mongo, read by hand** (`backend-on/mongo-by-hand.json`, test user, 17:38:06–17:44:16Z):

- session `6ab40e85…` at 17:38:13;
- conversation `8e305bc9…`: created 17:38:15.597, title "Tracer M1", updated 17:38:31.568, 7 messages;
- agent "Barista 1790185092090" at 17:38:34.135;
- aclentries `agent` and `remoteAgent`, permBits 15, at 17:38:34.139;
- transactions: 10 for `8e305bc9`, and 4 for the agent-chat conversation `ecdb8388`, which was deleted in step 10. Only those transactions confirm the agent-chat write;
- 0 feedback writes.

**The writes exist, but Tracer attributes them to the action for only 3 of 7 writing flows.** Regenerate, rename and delete are attributed. Login, send, edit, agent create and agent chat are not, because their POSTs are unattributed.

**Credited handlers against final7 `HANDLERS.md`, with the feedback correction** (`GRADE-g1.json` → `flows`):

| flow | expected | reproduced |
|---|---|---|
| login | `3870:3894` | **no** (credited `5bffa2fd…:6368:6437`) |
| send | `17345:18011` | **no** |
| feedback | corrected `Feedback.tsx:3347:3559` | credited `3347:3559` (plus `3040:3236`); the grader compares with final7's `3324`, so it reports false |
| regenerate | `3465:3490` | yes |
| edit-resubmit | `1759:3526` | **no** |
| rename | `1876:1902` | yes |
| agent create | `13140:14819` | **no**. The flow's "reached db" belongs to regenerate #2 (action `…:243`), which falls in the flow window. |
| agent chat | `17345:18011` | **no** |
| delete | `2331:2656` | yes |

**Scorecard: 4 of 9** (3 identical to final7, plus the feedback correction). Round three had 9 of 9.

## Regressions versus round three (not fixed; no engine work in this pass)

1. **Submit-driven requests are unattributed.**
   - Affected: send, edit-and-resubmit, agent chat, login, agent create.
   - `state_effect` linkage is 0 on LibreChat. It was 9 (off) / 14 (on).
   - The neutral fixture's `state_effect` and `submit` cases still pass, and its submit handler has no library `await`.
   - Likely cause, **not proven**: D-G1-11 makes the bare `dom.action` dispatch frame non-inheritable. LibreChat's submit path runs the first-party `onSubmit` from a form library's async `handleSubmit`, after a library `await`. No first-party frame is open when that continuation is created, so nothing is inherited. Round three inherited the bare frame.
2. **New deterministic misattribution.** In both runs, 16 requests are attributed `direct` to the send click (`…:191`). Only the first two (`chat/status` and `convos/gen_title` right after send) plausibly belong to it. The other 14 belong to later flows:
   - `share/link`, `messages`, `tools/calls` after regenerate;
   - `chat/status` @109074 / 160687 / 217795 after edit and regenerate #2;
   - `GET /api/agents/<new agent>`, `/api/agents/actions`, 4 × `/api/permissions/...` and `/expanded` after agent create.

   In round three these were unattributed (an abstention). Now they are wrong. The mechanism was not investigated.
3. **Capture does not drain before the snapshot**: 69,700 / 83,141 rows were queued at snapshot, and the session script exits 1. Row volume doubled with the 159 extra functions and the fourth-pass runtime.
4. **Handler scorecard 9/9 → 4/9, and the four-core-flow criterion 4/4 → 1/4.**
5. What improved or stayed the same:
   - request-less actions end `browser` or `entry_handler` (no backend stop name);
   - unattributed requests are the same count in both runs (39 / 39). Round three had 25 / 42, which was non-deterministic;
   - Tracer requests = Playwright requests;
   - the grader reports 0 mismatches.

## Drift against final7 (`drift-vs-final7.json.gz`)

Command: `node test/browser/manifest-drift.mjs /tmp/producttrace-librechat-m1-final7.json.attribution.json <manifest> /tmp/producttrace-librechat-m1-final2`.

- Final7 had 8,952 ids; this build has 8,928 (8,769 in round three).
- Categories:
  - 6,566 shared;
  - 972 boundary-corrected (945 in round three);
  - 1,350 `abstained_not_a_function` (1,377);
  - 64 removed by the first-party rule;
  - 0 `unexplained`.
- Every one of the 8,928 ids is an exact function node on disk.

**The "38 updater functions".** I did not have the grader's exact list or rule. My own rule (`drift-real-functions-missing.mjs`) selects abstained final7 ids whose span lies inside a real function node that starts at most 3 characters before it. By that rule:
- **Round three: 40 real functions missing.** 18 of them are state-updater arrows (`(prev) => !prev`, `(value) => !value`, …).
- **This build: all 18 updaters are kept.**
- **22 real functions are still missing** (`drift-real-functions-missing.json`):
  - 14 are top-level or exported functions in `packages/data-provider/src/parsers.ts`, which has 1 id now against 18 in final7;
  - 8 are in `client/src/utils/artifacts.ts`, which has 13 ids against 23.
  - None of them is an updater. The cause was not determined; they may be tree-shaken or reached only through a workspace package's `dist/`.
- So "0 unexplained" still overstates the result: 22 real functions are filed as "not a function".
- The round-three ERRATA says the updaters were "added to the regression list". They were not: `manifest-regression.json` still checks the same 12 ids, all present.

## Span neutrality (`span-neutrality.json`, `attribution-manifest-placements-await-off.json.gz`)

Command: `PRODUCTTRACE_PLACEMENTS=0 PRODUCTTRACE_AWAIT_CONTINUATIONS=0 PRODUCTTRACE_REUSE_WORKTREE=1 node test/browser/build-librechat-autonomous.mjs /Users/austinho/dev/trace-consolidated/.live-demo/librechat-m1 /tmp/producttrace-librechat-m1-final2 /tmp/pt-neutral-d.json` (log: `neutral-build.log`).

- Off build `75fc652de7fb`: 8,928 functions, 0 placements. On build `687a51791eb4`: 8,928 functions, 8,198 placements.
- **Identical function-id sets** (`only_on` = `only_off` = empty).
- The off-build manifest is recorded this time: `attribution-manifest-placements-await-off.json.gz`, raw sha256 `1ec3f35c87bf65a50228f6332282e3ddfa3253d66ab71f58271fa978abc19fdd`. The on-build manifest `attribution-manifest.json.gz` has raw sha256 `71804039ca688926f78880d7377becd07d9e402d51dcd3ccdc7fdc62aa25d46f`.
- This build was run last. It overwrote `/tmp/producttrace-librechat-m1-final2/client/dist`, so that worktree now holds the placements/await-off build. Running `scripts/m1-live.sh start` rebuilds it.

## "Must change before merge" (independent grade), item by item

| # | item | what changed (commit) | evidence | status |
|---|---|---|---|---|
| 1 | Fix receipts: rendered only when consumed, consume all receipts at the applying commit, refuse bare frames | `b42ba84f`: receipts per (action, fiber), consumed by the first commit, attribute only a rendered state change; bare frames never inherited. `05b1e13f`: nested programmatic focus. | `continuations-neutral-*`: P1 and P2 are never attributed in 5 of 5 runs while firing after actions | **fixed on the neutral fixture; on LibreChat, submit-driven flows are now unattributed and a new misattribution appeared** (Regressions 1–2) |
| 2 | Real negatives: tickers and polls through the clicks; P1, P2 and rejected await as asserted tests; a node-level receipt test in `npm test` | `b42ba84f` (fixture and asserts) | overlap counts in `continuations-neutral-summary.json`; the after-reject and after-throw cases are attributed | **done, except the node-level receipt test, which was not added** |
| 3 | Rename the frontend abstention | `669fc476`: `entry_handler`; gate docs G1/G4 amended | 116 `entry_handler` terminals, 0 `handler` stops with telemetry off | done |
| 4 | G3 own-JSX figure and classifier | `e5756a0a` | `../g3-2026-09-23d/RUN.md` | done (99.3% / 99.5%, misses listed) |
| 5 | Correct the drift report (38 dropped real functions) | `e5756a0a`: updater callbacks mapped from the setter call are kept | this RUN, "Drift" | **partly done**: 18 updaters are kept; 22 real non-updater functions are still dropped; the regression list is not extended |
| 6 | Record OAI payloads, the per-element survey and the off-build manifest | `e5756a0a` (survey) | `../g3-2026-09-23d/*.jsonl`; off manifest below | done |
| 7 | RUN/LIMITS wording; add the rejected-await gap and the autofocus pseudo-action to LIMITS | the round-three ERRATA files (`595b334e`); this RUN/LIMITS | `../g1-2026-09-23c/ERRATA.md`, `LIMITS.md` | done in wording. The rejected-await gap is fixed (D-G1-12). The autofocus pseudo-action is handled by D-G1-11 on the fixture (`/api/after-focus`). On LibreChat, no request is attributed to a `focus`/`focusin` action in either run (the round-three `GET /api/agents` credited to a focusin is now in the unattributed post-login batch). |
