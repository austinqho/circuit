# Cycle 8 fiber-driven pattern results

The required runtime enumeration source is the React DevTools Fiber tree, not static stamps. The runtime exposes `functionIdOf`/`tag`/`registerFunction` through the WeakMap registry, but this build did not register first-party inline handler objects (the post-JS transform intentionally leaves concise arrows untouched after the bundler parse failures recorded during the gate repair). Consequently no live `(element,event,handler id)` drive units were available on `/c/new`, and no pattern was silently classified as driven.

| unit | control | event | requests | joined route/handler/db | terminal |
|---|---|---|---|---|---|
| fiber registry on `/c/new` | none observed | none | none | 0 / 0 / 0 | not_encountered (no registered first-party handler object) |

Summary: units driven=0; reached_db=0; reached_backend=0; reached_request=0; correct_stop=0; stop_with_reason=0; not_encountered=1 registry surface; unreachable=0; units with no row=0 (no unit was dispatched). Seeded scripted surfaces and depth-2 crawl were captured by the existing session screenshots, but the fiber final test stops before dispatch because the registry enumeration is empty.
