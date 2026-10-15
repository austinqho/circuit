# Limits

- Headless Chromium only. Script-graded; no independent agent grader yet.
- The "both new repos" clause was not run in this pass (the G2 repos were not surveyed).
- D12 is shown on a neutral fixture, not LibreChat (LibreChat is not byte-deterministic across runs). The D12 harness settles after every input event; without that the runtime's mutation-receipt timers race fast typing regardless of stamps (pre-existing capture nondeterminism).
- `element_key` instance tokens are positional: the React key when present (a repeated key gets `~<n>`), else the DOM-order ordinal among the committed hosts of that placement, recomputed at every commit. They are identical across reloads for identical renders. A key can move to another DOM node when an earlier instance unmounts. Ordinals count per commit of one root, so two React roots rendering the same placement could collide (not observed).
- `tracer_last_action` is per DOM node while it renders the same placement. After an ordinal shift it follows the node, not the key; after a placement change on a reused node it resets to null.
- Chunk-level placements are fewer than module-level would be (1,566 vs 7,467 on LibreChat), so 181 of 325 stamp rows use `placement_via: "ancestor"`: the nearest authored placement above the host, not the host's own JSX.
- The G4 collector has its own element index (`collector/element-index.mjs`). This branch's `analysis/element-index.mjs` is the minimal resolver the G3 graders use; the two should be deduplicated.
