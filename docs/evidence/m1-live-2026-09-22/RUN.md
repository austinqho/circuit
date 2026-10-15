# M1 live viewer repair

## Result

The live viewer now receives browser rows and backend spans through one endpoint and renders the shared evidence pipeline directly:

```text
browser rows ─┐
              ├─ /api/demo/runtime-attribution
backend spans ┘              │
                             ▼
              workflow episodes → effect-rooted handler
                       → exact-parent backend join → live card updates
```

There is no timer finalization and no viewer-local implementation of attribution. `test/browser/server.mjs` imports `indexWorkflowEpisodes`, `indexEntryHandlerUnits`, and `attachBackendSpans` from `analysis/runtime-attribution.mjs`. Internal transport rows remain out of the displayed path.

## D30 exact user-sequence proof

`node test/browser/m1-live-user-sequence.mjs docs/evidence/m1-live-2026-09-22` replayed the requested sequence in headless Chromium:

1. log in as the M1 test user;
2. send `test`;
3. click thumbs-up and choose `Clear and Well-Written`;
4. open Agent Builder and type a name, description, and instructions;
5. click Create without a model;
6. select the `openAI` provider and a model, then click Create again.

The verifier observed exactly three final workflow cards and no unresolved card. Provisional click/focus cards were retracted when the evidence-derived menu or form episode absorbed them.

- The send card retained one workflow id while its label changed from `Waiting for effect` to `Request sent: POST /api/agents/chat/openAI` and then `Effect: findAndModify conversations`.
- The feedback card contains the `PUT /api/messages/:conversation/:message/feedback` request and `findAndModify messages`.
- The first Agent Builder submit emitted no `POST /api/agents`; its same-form mutation receipt is shown as `Submit rejected by the app`.
- The later successful submit stayed in that same Agent Builder episode and contains `POST /api/agents` plus `insert agents`.
- The form's field, focus, provider, and model actions did not create standalone unresolved cards.

The final expanded viewer is [viewer-user-sequence.png](viewer-user-sequence.png), with the machine-readable request and label history in [viewer-user-sequence.json](viewer-user-sequence.json).

Backend spans are appended as they arrive to `.m1-live/backend-spans.jsonl`; early spans are persisted immediately but admitted to the shared exact-parent join only after their browser request parent is present. At verification time the audit file contained 20,484 rows.

## Headless send proof

`node test/browser/m1-live-verify.mjs docs/evidence/m1-live-2026-09-22` logged in, sent one message, expanded the matching live card, and asserted all of these visible stops:

- control: `Send message`
- effect-rooted entry handler: `client/src/components/Chat/Input/ChatForm.tsx:17345:18011`
- request: `POST /api/agents/chat/openAI`
- route: `route:06fe9bafe432e6d1`
- handler: `handler:459b1cbd8fa69fff`
- MongoDB operations, including `insert transactions`, `findAndModify conversations`, and `findAndModify messages`

The route admission reason was exact trace id, exact request-span parent, equal method, and one server candidate. Handler and database stops were admitted only as exact descendants in the same trace. The expanded live result is [viewer-send.png](viewer-send.png).

## Enter reproduction and fix

Before the fix, pressing Enter kept the outer page at `scrollY=376` but changed the iframe top from `174.875` to `-100.125`: Chromium had scrolled the `overflow:hidden` demo canvas by 275 pixels while focusing the remounted composer. The embedded app did not reload and its textarea retained focus.

The demo canvas now uses `overflow:clip`, which preserves clipping without creating a programmatically scrollable container. The repeated headless probe held `canvas.scrollTop=0`; iframe top changed only from `174.875` to `170.875` as content settled. Evidence: [before](enter-before-fix.png) and [after](enter-after-fix.png).

## Account cleanup

The cleanup selected records by the test user's id plus harness-specific content or naming, then removed 31 `Barista <timestamp>` agents, 62 matching ACL entries, 46 harness/probe conversations, 150 associated messages, and 13 associated shared links. After the final proof, two provisional verification conversations and their four messages were also removed; the final verification conversation was retained. It left zero timestamped Barista agents, preserved the unrelated plain `Barista` agent owned by another user, and did not bulk-delete the user's account.

## Service verification

The autonomous build gates passed, `scripts/m1-live.sh start` returned `M1 live services are already running` on the idempotence check, and all four URLs returned HTTP 200:

- <http://127.0.0.1:3081/>
- <http://127.0.0.1:8123/fiber-demo?productPort=3081>
- <http://localhost:3080/health>
- <http://127.0.0.1:8787/health>
