# Trusted user events: RUN-5 (final author round, 2026-09-24)

This is author verification, not an independent grade. Code commit `4ee36d62` follows the independent regrade at `05f87fc4`; the grader commits remain ancestors. All browser runs were headless. No existing evidence file or `grader-scratch/` file was changed.

## Changes

- **Gesture rule.** The shared model in `analysis/user-event-model.mjs` assigns a pointer-caused event to the pointer gesture using its event interface, `sourceCapabilities.firesTouchEvents`, or an active pointer press. A held key does not capture that event. Keyboard events stay on the key track. This fixes `DOMActivate` after Shift-click, Meta-click, a click while a keyup remains undelivered, and touch tap, plus `selectstart` during a Shift-held pointer selection, without adding either event name to an attribution list. `npm run build` inlines the model into `src/runtime-attribution-browser.js` and copies it to `dist/`.
- **Opened outcome line.** When an opened element's event issued a request, the `action_chain` headline names the element, event, and request (for example, `opened <input ...>; its change issued POST /api/upload`). The line omits the scoped absence sentence. The structured opened outcome and the explicit related-event pointer remain.
- **Hover gate.** The trusted-events driver builds the same 240-cell page with and without Tracer, then measures three fresh 1,250-move sweeps per build with CDP `Performance.getMetrics` and `PerformanceObserver` long tasks. It fails when median instrumented long-task count exceeds the bare median or when the difference of median `ScriptDuration` values exceeds 0.25 ms per move. The check prints raw samples, medians, long tasks, and cost per move on failure and in the report on success. This is an absolute cost gate; it does not divide one build's time by the other's.
- Removed the stale `user_plain_kinds` description near `capture.page`.

## Hover cost, current head

Every long-task list in the six sweeps of each invocation was empty (threshold: at least 50 ms). Script time is milliseconds across each 1,250-move sweep.

| Driver invocation | Instrumented samples; median | Bare samples; median | Extra script time per move | Runtime-attributable long tasks |
|---|---:|---:|---:|---:|
| 1 | 79.023, 68.269, 98.153; **79.023** | 41.860, 41.548, 42.201; **41.860** | **0.0297 ms** | 0 |
| 2 | 83.024, 87.143, 83.862; **83.862** | 34.419, 32.136, 37.360; **34.419** | **0.0396 ms** | 0 |
| 3 | 87.697, 69.413, 84.308; **84.308** | 49.074, 27.952, 34.963; **34.963** | **0.0395 ms** | 0 |

## Verification

| Check | Result |
|---|---:|
| Trusted-events driver, three invocations of three main page loads each, plus touch, hover-heavy and two `inputText` builds | **126/126 ×3** (118 existing checks plus three `G3` Shift/selection checks, three `G4` Meta and missing-keyup checks, `H2` touch activation, and `V3` hover gate) |
| Main `39449f7a` runtime negative control, isolated archive with this driver, one main page load | **6/48**; completes, exits nonzero; the hover gate passes but the new gesture and attribution checks fail |
| D12 stamp neutrality | **24/24 ×3** |
| Continuations-neutral | **ok** on first run |
| Shadow-dom-context; no-cross-control-neutral | **ok; ok** |
| Episode-focus | **ok ×3** |
| Outcome-labels; mcp-gaps; body-capture | **169/169; 35/35; 51/51** |
| Unlinked-coverage-neutral; honest-coverage; function-names | **13/13; 45/45; 263/263** |
| G4 grader | **81/81** |
| G6, gunzipped records/spans/runs and enriched manifests, regenerated all six comparisons, then graded | **6/6 pairs** |
| `npm test` | **730/731**; only the known `react-context-ref-semantics.test.mjs:63` failure (`'a' !== 'b'`) |
| `npm run build`; `cmp src/runtime-attribution-browser.js dist/runtime-attribution-browser.js`; `git diff --check` | **pass; identical; pass** |

The negative control was a temporary archive of this branch's pre-final head with the driver and app probe copied in and only the packaged browser runtime replaced by the `39449f7a` runtime. Neither the main checkout nor another worktree was changed.

## Banked stores

The current MCP output and the pre-final `05f87fc4` output are **byte-identical** for the four banked stores under the read-only `mcp-all.mjs` call set: final7 (58 calls), G3e D12 A/B/C (72), G2 AnythingLLM r4 (71), and G6 (421). The call set includes `recent_actions`, `page_requests`, every stored `action_chain`, and keyed `element_history`. This final round introduced no banked-store output change.

Against the isolated main `39449f7a` archive, rendered text is identical on all 622 calls. Structured differences are the pre-existing empty `chain.window_evidence.untrusted_followed: []` on action chains and `context_omitted: 0` on the relevant recent/history calls. RUN-4 documented the former; its table did not list the latter. The byte-identical comparison with `05f87fc4` establishes that neither difference comes from this round. This call set does not include RUN-4's separate `include_context` call that main rejects.

## Disclosed recording limit

Media events such as `play`, `pause`, or `volumechange` started by app code or autoplay without a live causing frame are recorded as user events. The model errs toward recording in that case, as the independent regrade described.
