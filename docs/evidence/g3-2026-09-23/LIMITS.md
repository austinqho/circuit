# Limits

- Headless Chromium only. Script-graded; no independent grader has reviewed this directory yet.
- The "two new repos" clause of G3 depends on G2 and is not reached.
- D12 is shown on a neutral fixture, not on LibreChat. LibreChat runs differ in server-generated ids and streaming interleavings, so byte identity is not a meaningful test there.
- The D12 harness must settle after every input event. Without that, the runtime's mutation-receipt timers (`setTimeout(…, 0)` per action) race fast typing and the receipt counts differ run to run, with or without stamps. This is a pre-existing capture nondeterminism, not a stamp effect, and it is not fixed here.
- Interactive-host coverage is measured on four LibreChat surfaces only, at the moment of the survey; hosts that mount later (e.g. other dialogs) are not counted.
- Stamp rows are one per (page, element_key); with ordinal instances they scale with mounted element instances, not with actions.
- Element keys fall back to ordinals when the placement fiber has no React key, so such keys are not stable across page loads.
- `placement_via: "ancestor"` (74 LibreChat rows) labels a host with the nearest first-party placement above it (e.g. a library-rendered menu item under a first-party `<DropdownPopup>`); it is the nearest authored site, not the host's own JSX.
- T2 ("nearest ancestor component has a registered handler") stamps every host directly rendered by such a component, which is broader than interaction targets strictly.
- Function ids in files that receive the static-era `data-producttrace-control-*` source stamps are hashed from the stamped text, not the file on disk (pre-existing; placements pair against the on-disk file instead). Flagged as a separate task.
- The LibreChat survey's `records.jsonl` holds only `element.stamp` and `dom.action` rows (by design of the survey harness).
