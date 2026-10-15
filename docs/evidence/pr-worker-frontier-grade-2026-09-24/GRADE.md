# Independent grade: `fix/worker-frontier` (worker frontier)

- Date: 2026-09-24. Grader: a separate agent. It did not change any code. The only file written in the repo is this one.
- Worktree: `/Users/austinho/dev/tracer-pr6`, branch `fix/worker-frontier`, rebased on `main` `ff9210ee`. Commits: `c7af4b72` (runtime), `a180a37a` (chains), `5869ba97` (headless check), `b95be21e` (docs).
- Scratch (outside the repo): `<scratchpad>/pr6-worker-grade/`. It holds a `git archive ff9210ee` copy of main (`main/`), a gunzipped G6 store, the negative harness (`neg/`), and every output quoted below.
- Claim under test: **a request issued inside a Web Worker is a stated frontier, never silence.**

## Verdict: **merge with changes** (docs only; nothing blocks)

Every part of the claim holds, both in the code and in real headless-Chromium rows. Outputs for stores with no workers are byte-identical to main. I checked all 54 final7 actions across 4 tools, and a regenerated G6 compare. The requested changes are disclosures, plus one optional consistency fix:

1. **Disclose these limits in G1 D-G1-3.** None of them is stated today:
   - Service workers are not covered. `ServiceWorker#postMessage` and `navigator.serviceWorker.controller` are not wrapped, and requests a service worker makes itself are not seen.
   - A `Worker` or `SharedWorker` constructed before the runtime installs gets no `workerInfo`. Its posts are recorded nowhere (not even counted), so they are still silence.
   - A post made after a *native* (not build-rewritten) `await` is unowned. It is only counted in `worker_posts_unowned`, the same way a fetch is. Seen headless: `await fetch(); worker.postMessage()` left the click at `network`, and the post was counted as unowned.
   - Worklets and `window.postMessage` to frames are out of scope.
2. **Disclose that a global listener's post now takes the frontier and the credit** (item 1e). A document-level listener that posts (the analytics-worker or Partytown pattern) now wins entry-handler credit over the element-bound handler that made the DOM mutation. It also turns every click's stop into `worker`, and it makes a post an episode effect. This mirrors main's existing rule for a global listener that fetches, so it is consistent, not a new class of error. It does widen that rule to a common pattern. The docs state "a frame that posted is not a credit abstention" but not this consequence.
3. **Disclose how the unlinked window can mislead** (item 3c):
   - The window runs from the action to the next `dom.action` on the page. When the next action comes before the worker's request, the span is listed under the *next* action.
   - Spans are not scoped to the page or session. Any unlinked server span from another tab or user during the window is listed.
   - The wording already says "not a join"; this adds the direction it can go wrong.
4. *(Optional)* For a request followed by a post, `chain.display.label` in `describeEpisodeEvidence` still reads "Stopped: no exact-parent server span arrived…", while `stopped_at` is `worker` (item 2, `reqthenpost`). `outcome.stop_reason` is correct (`worker_not_instrumented`). Only the live-viewer label disagrees.

## Per-item table

| # | Check | Result | Evidence |
|---|---|---|---|
| 1a | Diff scope and `dist/` byte-identical to `src` | PASS | `npm run build` → "built byte-identical runtime (304724 bytes)". `src` and `dist` sha1 are both `30504b84…a893`. `git status` is clean after the build. |
| 1b | No message content or property names in rows | PASS | The size walk (`messageSizeClass`) records only byte counts from `Object.getOwnPropertyDescriptors`: key *lengths*, and `value` only for data descriptors. Headless: every row key set is exactly `schema, sequence, timestamp, parent_continuation_id, kind, worker_id, worker_kind, script_url, via, action_id, action_occurrence_id, terminal_owner_continuation_id, message_size_class, transfer_count, instrumented, spine`. A search of the full record JSON for `secretKeyName`, `SECRETVALUE`, `tokenField`, `NESTEDSECRET`, `LISTSECRET`, `GETTERSECRET`, `trapGetter` found nothing. |
| 1c | The size walk calls no getters | PASS | Headless getter counter: a worker post with an enumerable getter called it **1** time. A bare `MessageChannel` post (native structured clone only, no worker path) also called it **1** time. The single call is the browser's structured clone, not the walk. Residual: a `Proxy` message runs its `ownKeys`/`getOwnPropertyDescriptor` traps, and a Map/Set subclass's iterator is run. Both are theoretical. |
| 1d | Ownership rule: creation-time, frame current at the call | PASS | `recordWorkerPost` calls `captureOwner()` at the `postMessage` call. That is the same function fetch, timers, promises and listeners use, and there is no ambient fallback. See item 3 for runtime proof. |
| 1e | "Latest post" primary-stop rule keeps a real request frontier | PASS | `chainFrontier` and `buildActionChains` put the displaced request frontier in `additional_stops` (with `request_occurrence_id`). The unit test covers both orders. Headless `reqthenpost` (`fetch().then(post)`): `stopped_at: worker`, `additional: ["network"]`, and the request is still in `reached`/`requests`. Headless `postthenreq`: `stopped_at: network`, `additional: ["worker"]`. |
| 1f | Credit rule consistent with the effect-rooted rule; can it wrongly credit a global listener? | PASS with disclosure (change 2) | A post is placed in `requestsByAction`, so it is treated exactly like a request. Synthetic records: an element-bound `F_bound` mutates the DOM and a global `F_global` posts to `/analytics-worker.js`. **main:** credited `F_bound`, `stopped_at: browser`. **branch:** credited `F_global`, `stopped_at: worker`. The same records with a fetch beacon in place of the post credit `F_global` on **main** (`stopped_at: network`), so the rule is consistent. It does now reach analytics-worker listeners. Headless `globalpost`: every click, including the no-op button, reads `stopped at worker /idle-worker.js`. That is truthful (the dispatch did post), but it hides the DOM mutation from the primary stop. |
| 1g | MessagePort handling | PASS | Transferred ports are bound (`partner → workerInfo`), and the transferred port's `inbound` queue is deleted, so no stale owner stays queued. The worker wrapper sits outside the channel wrapper, so a post through a worker-bound port does not push into a dead queue. Unit test: SharedWorker port and MessageChannel port → `via: message_port`, same action. Minor: the row is emitted before the native call, so a post that throws `DataCloneError` still gets a row. |
| 1h | Unowned posts are counted, not rowed | PASS | `stampStats.worker_posts_unowned`. Headless interval scenario: 10 unowned (1 warm post plus 9 ticks); 0 rows. |
| 2a | `node --test test/worker-frontier.test.mjs` | PASS | 6/6 pass (see Commands). |
| 2b | `node test/browser/worker-frontier.mjs` (real Chromium) | PASS | `worker.create` ×2 (`/worker.js`, `/idle-worker.js`), both `action_id: null` (created at load). One `worker.postMessage` under the click, `small`. One `capture.limit {feature: "worker_fetch"}` per page (1 in each of the 8 page loads across my scenarios). Click: `stopped_at: "worker"`, because names `/worker.js`. `/api/x` is under `unlinked_server_spans` with `relation: "observed during window; not a join"`. `reached` is `[action, worker]`, and `requests` has no route, handler or db stop, so the span is not joined. The no-op click reads `browser / no request observed`. The idle worker is named in no chain. |
| 3a | `setInterval` armed at load posting every 300 ms while a click is in flight | PASS | The click's async handler stays in flight for about 1 s across 3 or more ticks. Posts with an `action_id`: exactly 1, the click's own synchronous post (`parent …:action:2`). `worker_posts_unowned = 10`. |
| 3b | Post from a `setTimeout` created in the click handler | PASS | 1 post, `action_id` = the click, `parent_continuation_id …:timer:3`; the chain stops at `worker`. |
| 3c | Two quick clicks (20 ms apart), each posting 150 ms later | PASS (ownership); note (window) | Post 1 → click 1 (`…:2:timer:4`) and post 2 → click 2 (`…:3:timer:5`); no cross-attribution. The unlinked window for click 1 closes at click 2 (+20 ms), before either worker fetch. Click 1 lists 0 unlinked spans and click 2 lists both. This is change 3. |
| 4a | `test/g4-grader.mjs` on final7 | PASS | `result: 81/81 checks pass`. |
| 4b | `test/g6-grader.mjs` | PASS | Committed compares: `Overall: PASS (6/6 pairs)`. I also regenerated all 6 compares with `g6-compare.mjs` against a gunzipped copy of the store, once with **branch** code and once with **main** code: `diff -r` is empty, and grading the branch-regenerated set gives 6/6. |
| 4c | `action_chain` identical main vs branch on final7 | PASS (stronger than asked) | Covers **all 54** final7 actions: `action_chain`, `recent_actions` (limit 50), 10 `compare_chains` pairs, and raw `buildActionChains`, dumped with main code (`git archive ff9210ee`) and branch code. The two 1,737,299-byte dumps are byte-identical, sha256 `500e5927…2d40` for both. |
| 5a | `npm test` | PASS | 647 tests: 646 pass, 1 fail. The failure is `react-context-ref-semantics.test.mjs` "different context objects never borrow a Provider value…", which also fails on main (`node --test` in the main copy: 6 pass, 1 fail, same test). |
| 5b | Docs G1 / G4 | PASS with changes 1–3 | The row schemas match the code, including the absence of `action_occurrence_id` on `worker.create`. The frontier vocabulary, `additional_stops`, `unlinked_*`, the credit and episode effect, and the no-content size class are accurate. Stated: no worker-side instrumentation ("later work"), and worker replies are not attributed. **Missing:** service workers, workers created before the runtime, native-await posts, the global-listener consequence, and how the window can mislead. |

## Commands and outputs

```
$ npm run build
built byte-identical runtime (304724 bytes)
$ shasum src/runtime-attribution-browser.js dist/runtime-attribution-browser.js
30504b84bd5f07d3eafab0017618c1a653eca893  (both)

$ node --test test/worker-frontier.test.mjs
✔ runtime: worker.create and worker.postMessage rows carry creation-time ownership, never message content
✔ a post from a later continuation of the action is owned by it (timer created in the handler)
✔ chains: the click stops at the worker; the backend span is unlinked evidence, not a join
✔ MCP: action_chain, recent_actions and element_history say "stopped at worker"
✔ a request attributed after the post keeps its frontier; the worker is an additional stop (and vice versa)
✔ SharedWorker ports and a MessageChannel port handed to a worker are posts to that worker
ℹ tests 6  ℹ pass 6  ℹ fail 0

$ node test/browser/worker-frontier.mjs
{ "ok": true, "rows": { "worker_create": 2, "worker_postMessage": 1, "capture_limit": ["worker_fetch"] },
  "worker_posts_unowned": 1,
  "click": { "stopped_at": "worker", "because": "message posted to Web Worker /worker.js; worker code is not instrumented, its requests are not seen", "unlinked": 1 },
  "noop": { "stopped_at": "browser", "because": "no request observed" } }

$ node test/g4-grader.mjs docs/evidence/m1-2026-09-22-final7 --manifest docs/evidence/g4-mcp-2026-09-23/manifest.json --out <scratch>/g4-branch.md
result: 81/81 checks pass
$ node test/g6-grader.mjs docs/evidence/g6-anything-llm-2026-09-23/store --compare docs/evidence/g6-anything-llm-2026-09-23 --out <scratch>/g6-committed.md
Overall: PASS (6/6 pairs).
$ node test/browser/g6-compare.mjs --store <scratch>/g6store --out <scratch>/g6-branch --pair … (6 pairs)      # branch code
$ node <scratch>/main/test/browser/g6-compare.mjs --store <scratch>/g6store --out <scratch>/g6-main --pair …  # main code
$ diff -r <scratch>/g6-main <scratch>/g6-branch        # exit 0, no output
$ node test/g6-grader.mjs <scratch>/g6store --compare <scratch>/g6-branch
Overall: PASS (6/6 pairs).

$ node <scratch>/dump.mjs <repo> docs/evidence/m1-2026-09-22-final7 docs/evidence/g4-mcp-2026-09-23/manifest.json  # branch, then main copy
actions 54 raw_chains 54 compares 10
500e59278114c3fd56bd0e4a6363926bc0a87663a8ca53cb5adffa51f1302d40  final7-branch.json
500e59278114c3fd56bd0e4a6363926bc0a87663a8ca53cb5adffa51f1302d40  final7-main.json

$ npm test
ℹ tests 647  ℹ pass 646  ℹ fail 1
✖ different context objects never borrow a Provider value and exact Consumer callbacks receive their value   (fails on main too)
```

### Negative harness (headless Chromium, real `dist/` runtime, real Workers)

`<scratch>/neg/run-neg.mjs` serves a copy of the fixture with `main-neg.js`, which picks a scenario from `?s=`. The fixture server records one server span per `/api/*` request. For each scenario the harness clicks `#load`, then `#noop`. It dumps the records and `stampStats`, runs `buildActionChains`, and calls `action_chain`/`compare_chains` through `createStore`. The load-time part is the same in every scenario: `worker = new Worker('/worker.js')`, `idle = new Worker('/idle-worker.js')`, and `idle.postMessage({op:'warm'})`.

| scenario | click handler | owned posts (action → parent continuation) | unowned | click stop | idle worker in any chain |
|---|---|---|---|---|---|
| interval | `setInterval(post, 300)` armed at load; click posts, then awaits ~1 s | click → `:action:2` (1 post only) | 10 | worker | no |
| timeout | `setTimeout(post, 50)` | click → `:timer:3` | 1 | worker | no |
| twoclicks | two clicks 20 ms apart, each `setTimeout(post, 150)` | click1 → `:timer:4`, click2 → `:timer:5` | 1 | worker, worker | no |
| content | posts a secret-keyed object and an object with a getter | click (×2), sizes `medium`/`small` | 1 | worker | no |
| reqthenpost | `fetch('/api/first').then(post)` | click → `:promise:3` | 1 | worker (+ additional network) | no |
| postthenreq | `post; await fetch('/api/after')` | click → `:action:2` | 1 | network (+ additional worker) | no |
| globalpost | bound handler mutates the DOM; `document` click listener posts to `idle` | each click → its own `:action:N` | 1 | worker (both clicks, including no-op) | yes (it is messaged; expected) |

There were no page errors in any scenario, and no content leaked in any.

## Residual risks

1. **Global analytics posts dominate** (change 2). An app whose document-level listener posts to a worker on every click will read `stopped at worker` for every click, give that listener entry credit, and turn focus-like clicks into effect-bearing episodes. It is consistent with the fetch-beacon rule on main, but more common in practice (Partytown, analytics SDK workers).
2. **Unlinked spans are loosely scoped** (change 3): browser time compared with server wall clock; not scoped to the page; the window can close before the worker's request lands. The listing is labelled "not a join" and changes no stop, so the harm is limited to misreading.
3. **Remaining silence**: service workers; workers constructed before the runtime installs; posts after native awaits in unbuilt code (counted only); worklets. Change 1 discloses these.
4. **Cost**: `unlinkedServerSpans` and `actionWindow` scan and sort every record and span per worker-posting chain (O(A·(R+S)) in `buildActionChains`; the store caches per episode). This is fine at final7 scale. It is worth watching on a long capture where every click posts.
5. **A throwing post still gets a row**: the row is emitted before the native `postMessage`, so a `DataCloneError` post still records a crossing that never happened.
6. **Display label mismatch** (change 4) for request-then-post chains, in the live viewer only.
