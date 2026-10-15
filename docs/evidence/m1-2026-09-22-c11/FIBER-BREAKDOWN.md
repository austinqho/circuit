# Cycle 11 unregistered host-handler breakdown

| origin | count |
|---|---:|
| unknown/unknown | 332 |

Pre-ancestor-any baseline: `unknown/unknown` — **376**. The 44-handler difference is the set reclassified as `via_ancestor_any`.

The pre-`via_ancestor_any` walk had 376 unregistered host handlers. The compatible-event ancestor pass reclassified 44 of those, leaving 332 unregistered after the change. Known means the owning source file matches a first-party manifest source file; unknown means no such manifest file match was available in this production build (the relevant fibers did not expose `_debugSource`).
