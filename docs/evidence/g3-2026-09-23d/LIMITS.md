# Limits (g3-2026-09-23d)

- Headless Chromium only. This directory was checked by script only; no independent agent grader has reviewed it.
- D12 is shown on the neutral fixture, not on LibreChat, because LibreChat is not byte-deterministic across runs. The fixture is small: 21 keyed actions and 3 requests.
- **The "every interactive host" clause is not reached.**
  - The G2 repos were not surveyed.
  - On LibreChat, one textarea per surface has no React fiber and is not stamped. It is probably the autosize measuring clone; that was not verified.
- **Own-site statistics skip stamped nodes without a stamp row.** `survey-own-site.jsonl` lists 2,502 `[data-tracer-el]` nodes across both sessions. For 1,040 of them (173 distinct keys; 147 of those keys have no stamp row for their placement at all), the key has no `element.stamp` row in `records.jsonl`. Those rows carry `placement_via: null` and are not counted in the own-site share. The cause was not investigated. Candidates are positional keys that move after re-renders, and stamp rows being emitted once per key and session. The own-site share is therefore over 1,462 of 2,502 observations.
- The Save & Submit button (`EditMessage.tsx:190`) is not on a surveyed surface, so its `render_prop` placement is not shown here.
- `element_key` instance tokens are positional. A key can move to another DOM node when an earlier instance unmounts, and ordinals count per commit of one root.
- The runtime reports 8,076 placements registered on the loaded chunks. The build manifest lists 8,198. The 122 missing placements are presumably in chunks that were never loaded; this was not verified.
- The stamp capture counter still reports one more expected row than received. In the G1 telemetry-on run it expected 767 and received 766, with 0 gaps.
