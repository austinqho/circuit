# Limits

- Headless Chromium only. The pattern crawler was not run; no coverage percentage is claimed.
- Graded by a script (`test/browser/g1-grade.mjs`) that recomputes terminals from raw rows without the analysis package, plus direct `mongosh` queries. No independent human/agent grader has reviewed this directory yet.
- The session harness is `test/browser/m1-session-headless.mjs`, not the (uncommitted) script that produced final7, so request counts differ from final7 (73–83 here vs 165) and flows are grouped by the harness's timestamp windows between step notes.
- Agent-chat and delete (steps 9–10) completed only in the first run of the day (bridge withheld). In the two later runs the harness timed out finding `Conversation Menu Options` after the agent reply; the account now holds several "Barista" agents from repeated runs and the agent chat request went to the openAI endpoint (`agent_id` null), so step 9 did not select the new agent. Test-account data (agents, conversations) created by these runs was not deleted.
- Feedback in the backend-on run: `PUT /api/messages/new/<id>_/feedback` joined to server and handler spans with no DB span. The URL carries conversation `new` and a placeholder message id, i.e. the click landed before the conversation id resolved; this looks like harness timing, not a join defect, but it was not re-driven.
- Bridge withheld: the chat submissions' requests are unattributed (see RUN.md). This is a known runtime-attribution gap, reported, not fixed here.
- Twelve of 8,952 final7 function ids differ in this build (12 gone, 16 new, in 12 files that also received G3 placement wrappers, e.g. `HoverButtons.tsx`, `Knowledge.tsx`; cause not isolated, most likely sourcemap boundary shifts from the inserted wrapper text; six of the twelve gone ids were zero-width spans). None of the nine flow handler ids changed.
- Disk was at 2.8–3.7 GiB free; the build reused `/tmp/producttrace-librechat-m1-final2` and overwrote its `client/dist`.
- The bridge-served run keeps `records.jsonl.gz` instead of a raw file (disk).
