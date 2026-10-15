# Limits

- Headless Chromium only. Script-graded (independent recomputation from raw rows plus direct `mongosh`); no independent agent grader has reviewed this directory yet.
- The session harness is `test/browser/m1-session-headless.mjs`, not the uncommitted final7 script; flows are grouped by timestamp windows between step notes.
- **Test-account residue was not deleted.** Deleting documents is a permanent data deletion I did not perform on an agent's instruction. Instead, the harness now names each agent uniquely, which made agent chat and delete run again. The deletion the coordinator described, for Austin to run himself if wanted (harness-created agents and harness-titled conversations of the test user only):
  ```js
  // mongosh mongodb://127.0.0.1:27017/LibreChat
  const u = db.users.findOne({ email: 'tracer-m1@example.test' });
  db.agents.find({ author: u._id, name: { $regex: /^(Barista( \d+)?|Live evidence agent.*)$/ } }).count();
  db.conversations.find({ user: String(u._id), title: { $in: ['Tracer M1', 'A flat white is espresso with a thin layer of velvety steamed milk.'] } }).count();
  // then deleteMany with the same filters
  ```
  Counts after this run: 9 agents named `Barista` / `Barista <ms>`, 10 `Live evidence agent <ms>`, 9 conversations titled `Tracer M1`, 3 titled with the flat-white fixture reply.
- Unattributed requests rose from 30 (first pass) to 57/59 because the async-frame leak that used to attribute react-query refetches after login, agent create and delete is closed. Those refetches come from newly mounted or invalidated queries whose fibers own no state receipt, so under the receipt rule they are not attributed. This is recorded, not counted as a regression of the frontier criterion.
- State receipts cover passive effects only. Render and layout effects run before React reports the commit and are not covered (explicit frontier). Receipts are cleared at every commit of any root.
- Await continuations cover first-party async functions (not async generators and not `for await`). Library async code keeps native resumption.
- 176 actions per run abstain as "no element-bound handler ran". The most frequent unbound frames are in `packages/client/src/hooks/useInputModality.ts`, `client/src/components/Chat/Input/QuoteButton.tsx`, `client/src/hooks/Generic/useShiftKey.ts`, `client/src/hooks/Input/useAutoSave.ts`, `ChatForm.tsx` (two functions) and `packages/client/src/components/ThemeSelector.tsx`; that each is a document/window or native listener was not verified function by function. The binding is defined only by React props and the functions written inside them at the placement, so a native `addEventListener` on the element itself also counts as unbound.
- Feedback does not write with the deterministic fixture (placeholder response id); final7 reached the write with the same fixture under a different harness. Not re-investigated further.
- 8 final7 function ids were lost to the G2 boundary logic (listed in RUN.md); flagged, not fixed on this branch.
- Chunk-level placements (1,566) are fewer than the first pass's module-level ones (7,467), because minified maps land exactly on fewer JSX elements. More stamps therefore fall back to `placement_via: "ancestor"`.
- Raw records are stored gzipped; sha256 and row counts are in RUN.md.
