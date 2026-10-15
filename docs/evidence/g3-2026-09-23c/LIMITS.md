# Limits

- Headless Chromium only. Checked by script only; no independent agent grader has reviewed this directory.
- D12 is shown on a neutral fixture, not LibreChat, because LibreChat is not byte-deterministic across runs.
- **Own-JSX share denominator.** Above 90% (100%) holds only for elements that have first-party JSX. Hosts rendered inside a library component have no first-party JSX site of their own; their stamp names the first-party usage (placement_via `first_host` / `ancestor`). Overall, 57% of observations and 62% of stamp rows are `self`.
- `element_key` instance tokens are positional. A key can move to another DOM node when an earlier instance unmounts, and ordinals count per commit of one root.
- One element index now: `analysis/element-index.mjs`. `collector/element-index.mjs` re-exports it.
