# Limits

- Headless Chromium only. Grading was done by script (independent recomputation from raw rows) plus direct `mongosh` reads. No independent agent grader has reviewed this directory.

## Test-account residue

Residue was not deleted, and cleanup stays with Austin. The query, restricted to the test user and to harness-created names:

```js
// mongosh mongodb://127.0.0.1:27017/LibreChat
const u = db.users.findOne({ email: 'tracer-m1@example.test' });
db.agents.find({ author: u._id, name: { $regex: /^(Barista( \d+)?|Live evidence agent.*)$/ } }).count();
db.conversations.find({ user: String(u._id), title: { $in: ['Tracer M1', 'A flat white is espresso with a thin layer of velvety steamed milk.'] } }).count();
// then deleteMany with the same filters
```

Counts after this run: 15 agents `Barista` / `Barista <ms>`, 10 `Live evidence agent <ms>`, 15 conversations `Tracer M1`, 3 titled with the fixture reply.

## Feedback

Feedback does not write with the deterministic chat fixture. The optimistic response keeps its placeholder id `<uuid>_`, so the PUT goes to `/api/messages/new/<id>_/feedback`. The same happens on the plugin-disabled baseline. This is a documented harness limit.

## Unattributed requests

**Counts vary between runs:**

| run | unattributed | `mount_effect` |
|---|---|---|
| telemetry off | 25 | 25 |
| telemetry on | 42 | 5 |
| earlier telemetry-off run, pre-final build | 24 | 26 |

The difference is mainly the react-query batch after login: 9 GETs at seq 1173–1181 and 7 at 9974–9980 in the telemetry-on run.

- Likely cause (not proven): whether those fetches start on a receipted commit depends on when the login response resolves relative to the render that mounts the query observers.

**Reason for every unattributed request** (`unattributed-requests.json`):

- **Reached:** the XHR `send`.
- **Stopped at:** no active continuation frame at `send`.
- **Because:** not determined.
- The four boot requests before login have no preceding action at all.
- For every other request, the immediately preceding instrumented row is the exit of a function of an action:
  - an effect (`Conversations.tsx`, `useNavScrolling.ts` and others);
  - or an async continuation (`useTokenUsage.ts`, `request.ts`).
- Those functions had exited before the `send`, so something that scheduled the request ran without a frame between the two.
- Candidates, **not proven**:
  - passive effects of fibers outside the receipted subtree in the same commit (D-G1-7 excludes these by design);
  - react-query's `notifyManager` scheduling from such an effect.
- The requests cluster by flow:
  - the chat stream's follow-ups (`/api/agents/chat/status`, `/api/share/link`, `/api/messages`, `/api/agents/tools/calls`);
  - agent-create follow-ups (`/api/agents/<id>`, `/api/permissions/...` × 4, `/expanded`);
  - `/api/tags`;
  - boot.

## Handler abstentions: "global listeners" is too strong a label for some frames

The abstention lists every first-party frame that ran and was not bound:

- **`window` / `document` listeners** (checked in source): `useInputModality.ts:352`, `QuoteButton.tsx:3289`, `useShiftKey.ts:848`, `ThemeSelector.tsx:789`.
- **`ChatForm.tsx:15018`** is the `onChange` passed to a form library's `register(...)`. The library's own function is the bound prop (`bound_handlers.library` > 0), and it calls the first-party one. Frames record first-party functions only, so the runtime cannot tell that this frame ran inside the library-bound handler.
- **`ChatForm.tsx:22658`** is a ref callback. It runs at commit and is not a listener.

In all these cases the credit correctly abstains. Only the `because` wording ("global listeners") overstates what those frames are. A wording change, or tracking library-bound handler invocation, was not made in this pass.

## Other limits

- State receipts cover passive effects only. Render and layout effects run before React reports the commit.
- Receipts live until the first commit after the owning hook re-rendered, bounded at 50 commits.
- Library await continuations carry context only. They register no functions, spans or credit.
- In both runs, the per-page capture counter reports one more expected row than received (288,674 vs 288,673; 258,975 vs 258,974). Emitted equals received and gaps are 0. The cause of the one-row difference was not investigated.
- Raw records are stored gzipped. sha256 and row counts are in RUN.md.
