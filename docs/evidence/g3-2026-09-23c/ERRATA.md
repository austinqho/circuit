# Errata for g3-2026-09-23c

This file was added after the independent grade (`docs/evidence/g1g3-grade-independent-2026-09-23/GRADE-g1g3-independent.md`). The rest of this directory is unchanged. The fixes and the rerun are in `docs/evidence/g3-2026-09-23d/`.

1. **Own-JSX share "646/646 = 100%" is wrong.** The classifier counted a host as library-rendered whenever its nearest component was not first-party. It therefore missed hosts that do have first-party JSX:
   - hosts passed as `render={<button …/>}` elements, for example Save & Submit (`EditMessage.tsx:190`), `Fork.tsx:330` and `Feedback.tsx:146/180`, which were stamped at `Tooltip.tsx:160` or the wrapper;
   - JSX returned by a first-party function child of a library component (`Conversations.tsx:59`, `CellMeasurer`).

   The grader's corrected share is about 92.7–96.1% per stamp row (still above 90%, but not 100%). In the fourth pass, render-prop hosts are stamped at their own JSX (`render_prop`), and function-child misses are counted as first-party misses.
2. **OAI validity and interactive coverage were in-page counts only.** Neither the payloads nor the per-element survey were recorded. The grader rebuilt the 279 payloads from the stamp rows (0 invalid). `g3-2026-09-23d` records the payloads as read from the DOM (`oai-payloads.jsonl`) and every surveyed host (`survey-elements.jsonl`, `survey-own-site.jsonl`).
3. **The screenshots are identical.** `g3-oai-stub.png` and `g3-no-oai.png` are byte-identical and evidence nothing. They are no longer produced.
4. **"Every interactive host on both new repos" was not reached.** The G2 repos were not surveyed. On LibreChat the literal check is false: one non-React textarea per surface is unstamped.
