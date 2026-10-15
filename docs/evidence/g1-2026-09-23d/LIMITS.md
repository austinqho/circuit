# Limits (g1-2026-09-23d)

- Headless Chromium only. Checks were done by script: `g1-grade.mjs`, `g1-chains.mjs` and raw-row recomputation with python. I also read Mongo directly with `mongosh`. No independent agent grader has reviewed this directory.
- **Regressions not fixed.** RUN.md lists four; no engine work was done in this pass:
  - submit-driven requests are unattributed;
  - 14 later-flow requests are misattributed to the send click;
  - capture was not drained at the snapshot;
  - the handler scorecard fell to 4/9.

  The causes given there are hypotheses and have not been proven.
- **Capture tail.** 69,700 (off) and 83,141 (on) emitted rows were still queued at the snapshot. They are not in `records.jsonl`. The received rows are contiguous from sequence 1. The missing rows are the tail after the last received sequence. The page counter's "expected N+1, received N" off-by-one also persists, on both the row counter and the stamp counter (767 vs 766).
- **Telemetry-on build reuse.** The telemetry-on build was made by the previous agent (10:01:41 PDT) from the head commit. I verified it by the build id and function set (identical to my telemetry-off rebuild) and by the absence of later file changes. I did not rebuild it myself.
- **Spans file.** With the bridge withheld, the viewer's in-memory span list stays empty. `spans.jsonl` is therefore the viewer's append-only file log, truncated before the session, as in round three. Any span that arrived after the copy is missing. None is expected: the last span was written at the end of step 10.
- **Feedback** still does not write with the deterministic chat fixture: `PUT /api/messages/new/<id>_/feedback` has a placeholder id. This is a harness limit, as in round three.
- **Test-account residue** was not deleted. This run added 1 agent, "Barista 1790185092090", and 1 conversation, "Tracer M1" (`8e305bc9`), for `tracer-m1@example.test`. The telemetry-off run added the same kinds. The query and cleanup procedure are in `../g1-2026-09-23c/LIMITS.md`.
- **Drift.** "Missing real functions" uses my own rule (`drift-real-functions-missing.mjs`), not the grader's; the grader's 38 are not listed in the grade. By my rule, round three had 40 and this build has 22. None of the 22 is a state updater.
- **No node-level receipt test.** State receipts and await resumption are tested only in the browser suite (`test/browser/continuations-neutral.mjs`), which `npm test` does not run.
- **Receipts cover passive effects only.** Render and layout effects run before React reports the commit. Library await continuations carry context only.
- **Programmatic focus.** On the neutral fixture, a `focusin` from a programmatic `focus()` inside an effect no longer displaces the effect's frame (`/api/after-focus` → `mount_effect`). On LibreChat no request is credited to a focus action, but this was not examined beyond that.
