# G1 frontend-only mode, second pass (2026-09-23b)

Gate text: `docs/gates/G1-frontend-only.md` (amended, see "Second pass" there). Headless Chromium only. Code: branch `g1-g3-stamps` rebased onto `main` at `2dd6e7a2` (G2 and G4 merged). Evidence produced at commit `001ed093` plus the grader change in the commit that adds this directory.

## Build

- Fixture `/Users/austinho/dev/trace-consolidated/.live-demo/librechat-m1` (LibreChat `45cc53c`), built into the reused worktree `/tmp/producttrace-librechat-m1-final2`. The parity baseline was regenerated without `npm ci` by rebuilding the clean worktree `/tmp/producttrace-librechat-m1-final` with the plugin disabled (`PRODUCTTRACE_REUSE_WORKTREE=1 PRODUCTTRACE_DISABLE_PLUGIN=1`).
- `scripts/m1-live.sh` with `PRODUCTTRACE_BACKEND_TELEMETRY=0|1 PRODUCTTRACE_OPENAI_FIXTURE=1`. Build gates, both builds: runtime markers 8364/8364, smoke ok (includes the pre-armed poll negative), Agent Builder parity true. Build id `550051da4ebe`; the telemetry-off and telemetry-on builds have identical function-id sets. Manifest: `attribution-manifest.json.gz`.
- Chat replies: the deterministic local OpenAI-compatible fixture (`test/browser/openai-compatible-fixture.mjs`); no model call.
- Session: `test/browser/m1-session-headless.mjs`, `PRODUCTTRACE_NO_BRIDGE=1` (static-era request bridge withheld: the runtime's own wrappers are the only request source), `PRODUCTTRACE_EVIDENCE_FORMAT=jsonl`. Harness changes since the first pass: unique agent name per run (`Barista <ms>`), wait for a server conversation id in the URL before feedback and delete.
- Chains: `node test/browser/g1-chains.mjs <dir> --backend=on|off --manifest=<manifest>`. Grade: `node test/browser/g1-grade.mjs <dir> --backend=on|off --final7=docs/evidence/m1-2026-09-22-final7/coverage.json [--mongo=mongodb://127.0.0.1:27017/LibreChat]`; it recomputes every terminal, including the handler abstention, from raw rows without importing the analysis package.

## Raw records (stored gzipped, lossless; `gzip -dc` restores the bytes)

| file | raw sha256 | rows |
|---|---|---|
| `frontend-only/records.jsonl.gz` | `2d03999ab47dce572cfa82734c7a7ce89918c81ad1043321a6574510e5fa8472` | 221,501 |
| `backend-on/records.jsonl.gz` | `96af7390fba7bcf746736af8e5a7280711b14f0fa8468307049ce52bc9710447` | 218,216 |

`backend-on/spans.jsonl` is the viewer's span log (`.m1-live/backend-spans.jsonl`), truncated immediately before the session, 2,346 spans.

## Diagnosis: why the bridge attributed the chat POST and the runtime did not

From the first-pass bridge-served records (`docs/evidence/g1-2026-09-23/frontend-only-with-bridge/records.jsonl.gz`, action `mue16dtj:193`, chat submit):

- The chat POST row's `parent_continuation_id` is the bare dispatch frame `continuation:action:mue16dtj:193:action:35607`, spine empty, 124 ms after the submit, inside the same dispatch task.
- The functions entered just before it (`request.ts:7584:7817` `getBearerToken`, `request.ts:9186:9417` `withAuthorization`) have that bare frame as parent, while the calls before `await refreshBeforeRequest(url)` in `_authenticatedFetch` ran under the effect frame `…:function:36984` (`d7455ef…:2385:3736`).
- So the context was lost at a native `await` resumption (V8 resumes awaits without calling the patched `Promise.prototype.then`). The resumed code ran on whatever frame was ambient, here the still-open bare dispatch frame.
- The bridge read the owner with `context()`, which includes bare dispatch frames. The runtime wrapper excludes them (`!current.action`), so without the bridge the request was unattributed. The bridge's attribution was ambient, not a continuation.
- The passive effect that starts the chat ran in the dispatch task in this flow (React flushes discrete-event passive effects synchronously), so a state-update receipt alone does not recover it; the await continuation does. Receipts cover effects committed in a later scheduler task (fixture test).

## Results (reached / stopped at / because)

Session steps 1–10 all completed in both runs (login, send, copy, thumbs-down, regenerate, edit-and-resubmit, rename, agent create, agent chat, delete). Capture lossless in both (221,501/221,501 and 218,216/218,216 rows; 0 gaps; 0 drops). Requests: wrapper = Playwright, 82/82 and 83/83, reconciliation 0.

### Backend telemetry off (`frontend-only/`)

- 346 actions, 346 chains, independent grader mismatches 0.
- Terminals:
  - 14 `network | backend not instrumented`;
  - 176 `handler | no element-bound handler ran; global listeners: [...]`;
  - 156 `browser | no request observed`.
- 0 backend stops; 0 route/handler/db rows.
- **The chat submissions now end at the network frontier**: send (`POST /api/agents/chat/openAI`, `state_effect`), regenerate and edit-and-resubmit (same POST, `direct` via an `await` continuation), agent chat (`POST /api/agents/chat/agents`, `state_effect`). Each flow's frontiers are listed in `frontend-only/GRADE-g1.json`.
- Linkage of the 82 requests: 21 `direct`, 4 `state_effect`, 57 unattributed. The unattributed set now includes the follow-on GETs after login, agent create and delete (react-query refetches of newly mounted or invalidated queries). The first pass attributed them only through a leaked async frame; this pass closes that leak, and those fibers own no receipt.

### Backend telemetry on (`backend-on/`)

- 346 chains, grader mismatches 0:
  - 12 reached db;
  - 1 `handler | no db span under handler` (feedback);
  - 176 handler abstentions;
  - 157 `browser | no request observed`.

| flow | final7 handler credited | reached | Mongo (window 13:07:27–13:09:27 UTC, test user) |
|---|---|---|---|
| login | yes (`LoginForm.tsx:3870:3894`) | db `insert sessions` | session `6ab3cf11…` at 13:07:29 |
| send | yes | db `findAndModify messages/conversations`, `insert transactions` | 7 messages created in window |
| feedback | **no**: credited `Feedback.tsx:3347:3559`, final7 `3324:3559` (see below) | server handler, **stopped at** handler, **because** no db span under handler | no message with feedback in window |
| regenerate | yes | db (messages, conversations, transactions) | as send |
| edit-and-resubmit | yes | db (messages, conversations, transactions) | as send |
| rename | yes | db `findAndModify conversations` | conversation `e4701999…` "Tracer M1" updated 13:07:46.982 |
| agent create | yes | db `insert agents`, `findAndModify aclentries` | agent "Barista 1790168847757" created 13:07:49.500 |
| agent chat | yes | db (messages, conversations, transactions) | conversation created, then deleted by step 10 |
| delete | yes | db `delete conversations/messages/sharedlinks/toolcalls/agent_checkpoints/agent_checkpoint_writes` | 2 conversations created in window, 1 remains |

- **Feedback credit**: `onClick={handleDownOption(tag)}`. `handleDownOption` (`3324:3559`) runs during render and returns the click handler `(e) => {…}` (`3347:3559`), which is what runs on the click. The new credit is the function that ran; final7's credit of the outer factory looks like a boundary artifact.
- **Feedback write**: the PUT goes to `/api/messages/new/<id>_/feedback`. With the deterministic chat fixture, the optimistic response keeps its placeholder id (`<uuid>_`) and conversation `new`. The same happens on the plugin-disabled baseline build (checked headless), so this is app/fixture behaviour, not instrumentation.
- **Scorecard**: 8 of 9 handlers identical to final7 (the 9th is the correction above); 7 of 8 mutation flows reached a Mongo-confirmed write.

## Function-id stability (`drift-vs-final7.json.gz`, `span-neutrality.json`)

- **Span neutrality**: the same source built with placements and await continuations off (`PRODUCTTRACE_PLACEMENTS=0 PRODUCTTRACE_AWAIT_CONTINUATIONS=0`) has the identical 8,364 function ids, zero drift. Placements: 1,566 on, 0 off.
- **Against final7** (`node test/browser/manifest-drift.mjs`, classified against the files on disk):
  - 6,558 ids shared. Every one of the 8,364 new ids is an exact function node on disk (final7: 74%).
  - 886 final7 ids replaced by a boundary correction. Examples: `bootstrap.js` 1072:1125 `queuedEvent) => …` → 1071:1143 `(queuedEvent) => …`; `i18n.ts` 5868:6019 `module) => {…` → 5867:6037 `(module) => {…`; `i18n.ts` 6053:6176 `error): SupportedLocale => …` → 6052:6188.
  - 1,436 final7 spans that were not functions on disk, now abstained.
  - 64 removed by the first-party rule.
  - 8 not explained. These are exact small callbacks inside `.map(...)` etc. that the G2 boundary logic now resolves to their enclosing function: `RouteErrorBoundary.tsx:497:561`, `MessageNav.tsx:14130:14192`, `schemas.ts:26054:26072`, `Favorites.ts:642:701`, `useUpdateTagsInConvo.ts:1220:1526`, `mutations.ts:3869:4093`, `Assistants.tsx:1292:1355`, `SubagentCall.tsx:14541:14571`.
  - 939 functions newly instrumented beyond the replacements.
- All nine final7 flow-handler ids are present.

## Continuation fixture (`continuations-neutral.json`)

`node test/browser/continuations-neutral.mjs`, a neutral React fixture:

- state effect committed in a later scheduler task: `state_effect`;
- reducer effect plus awaits: `state_effect`;
- fetch after an rAF `await`: attributed to its click;
- pre-armed poll timer: never attributed;
- effect of a child with no receipt: never attributed;
- controls: receipts off leaves the state effect unattributed; await continuations off leaves the post-await fetch unattributed;
- a document `keydown` listener abstains with the handler frontier, while a bound `onClick` is credited.

## Verdict

- Every action ends in an explicit frontier, with zero inferred backend stops, with backend telemetry off: **reached**. Chat submissions end at `network | backend not instrumented` without the bridge: **reached** (send, regenerate, edit-and-resubmit, agent chat).
- "With it enabled, final7 results reproduce": **reached for 8/9 handlers and 7/8 write flows**. **Stopped at** feedback's DB write, **because** the fixture's placeholder response id is not replaced. The ninth handler differs because the credit moved to the function that actually runs (argued above).
