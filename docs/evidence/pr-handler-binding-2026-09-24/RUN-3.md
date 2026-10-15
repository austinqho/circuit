# Handler binding: RUN-3 (2026-09-24, head `ec85c780` before this note)

Implementer verification after the independent regrade at `70fbd740`. This is not an independent grade. The base is still `53eb8882` (`fix/trusted-events`); this branch was not rebased. `RUN.md`, `RUN-2.md` and `GRADE.md` were left unchanged. All browser runs were headless.

**Verdict.** The four regrade fixes pass the expanded driver, the grader's s1–s6b and probe7, and the keep-green suite. No code repair was needed in this pass. The known `react-context-ref-semantics` unit failure remains the only `npm test` failure. The base negative control reproduces the old false credits/abstentions.

## Commands and results

Working directory: `/Users/austinho/dev/tracer-b-handler-binding`. `node_modules` was the existing symlink; no install was run. A `git archive 53eb8882` was unpacked only under the untracked `grader-scratch/base/`, with a symlink to the existing dependencies and copies of this branch's `handler-binding.mjs`, `fixture-build.mjs` and `handler-binding-app` fixture. It was not a rebase or another worktree edit. Browser tests ran serially.

```sh
npm run build
cmp src/runtime-attribution-browser.js dist/runtime-attribution-browser.js
for i in 1 2 3; do TRACER_KEEP_STORE=1 node test/browser/handler-binding.mjs; done
(cd grader-scratch/base && node test/browser/handler-binding.mjs)
for i in 1 2 3; do node test/browser/d12-stamp-neutrality.mjs; done
node test/browser/trusted-events.mjs
node test/browser/continuations-neutral.mjs
for i in 1 2 3; do node test/browser/episode-focus.mjs; done
node test/browser/shadow-dom-context.mjs
node test/browser/no-cross-control-neutral.mjs
node test/browser/effect-rooted-form-neutral.mjs /Users/austinho/dev/trace-consolidated/.live-demo/librechat-m1
node test/browser/outcome-labels.mjs
node test/browser/mcp-gaps.mjs
node test/browser/body-capture.mjs
node test/browser/stable-element-keys.mjs
node test/g4-grader.mjs docs/evidence/m1-2026-09-22-final7 --manifest docs/evidence/g4-mcp-2026-09-23/manifest.json
npm test
```

| Check | Result |
|---|---|
| Build; source/dist `cmp` | pass; byte-identical runtime |
| Handler-binding driver, 3 separate invocations × 3 page loads | **142/142 ×3**; C25 and C29–C33 passed on every page load |
| Base `53eb8882` negative control with the same driver/fixture, 3 page loads | **19/142**; expected failure, including old abstentions and capture-listener credit |
| D12 stamp neutrality, 3 invocations | **23/23 ×3**; A/B/C/D byte identity, no hover `metaKey` leak |
| Trusted-events | **79/79** |
| Continuations-neutral | pass on first run; no timing-precondition retry needed |
| Episode-focus | pass ×3 |
| Shadow-dom-context; no-cross-control-neutral; effect-rooted-form-neutral | pass; pass; pass |
| Outcome-labels; mcp-gaps; body-capture | **160/160; 35/35; 51/51** |
| Stable-element-keys | **19/19** (`pass: true`, 19 true checks) |
| G4 grader on final7 | **81/81** |
| G6 regenerated compare and grader | **6/6 pairs**; base/branch compare objects identical after normalizing the echoed store path |
| `npm test` | **699/700**; only `test/react-context-ref-semantics.test.mjs:63`, `'a' !== 'b'`, the pre-existing failure |

The kept third driver store is `store-3/records.jsonl.gz` (`sha256 522ec5f370ed1626c667c83ab091411a9d8c8ff20d480f584d8a976ac24e34ab`), with its manifest in `store-3/attribution-manifest.json` (`sha256 b6578f3393d79617a2eff8e183894d18d936e21f59f1f00de244b61cabdd8736`). It has 5,168 rows across 3 page loads: 1,906 `dom.action`, 138 `handler.binding`, 12 `handler.invocation`, and 6 `handler.via_library`. All 138 trusted binding rows' `native_event_type` matches their own action's event. The grader's `verify-bindings.mjs` reported 150 binding/invocation rows and 15 flags: per page, one radio target-key difference, two submitter-versus-form targets, and two untrusted invocations (one with no action). These are the expected shapes of that verifier, not native-event mismatches in a trusted binding.

## Grader probes, rerun on this head

Commands: `PROBE_APP=probe5 node grader-scratch/probe5-driver.mjs "$PWD" <out.json>` (likewise `probe6` and `probe7`). All three exited zero with no page errors. The JSON outputs remain in the local untracked `grader-scratch/runs3/`.

| Probe | Observed result |
|---|---|
| s1, s1b | Component function held by two props remains ambiguous when given a custom value or a forwarded event whose React name matches neither holder. Both holders are listed. |
| s2a, s2b | Destructured leaf parameter stays ambiguous; call-proxy case resolves `onClick@click` from the SyntheticEvent. |
| s3, s3b | Ancestor `onClickCapture` and target `onClick` each produce their own row, including when the leaf has no event parameter. |
| s4, s4b | The app's Proxy log has only its own `get:id` reads (`observable` and `revoked`); no Tracer `get:nativeEvent` or `get:_reactName`. No handler row was produced for an argument-inspection trap. The `onSelect` call binds the component prop. |
| s5 | App `dispatchEvent` produces an untrusted `handler.invocation`; the originating click owns `/api/dispatched?trusted=false`. |
| s6 | One div holding the same function as `onClickCapture` and `onClick` produces two rows, one per pass, both `synthetic_event`; the page observed phases `1` then `3`. |
| s6b | Capture-only ancestor binds `onClickCapture`; target binds `onClick` and wins the credit because its holder is nearer. |
| probe7 | A body capture listener sends `/api/analytics` on both clicks but gets no binding. Save real credits its button's `onClick` (which also sends `/api/real`); State only credits its own state-only `onClick`. The analytics requests remain visible as unbound issuers. |

The expanded driver independently checks the same regrade items on each of nine page loads: C29/C30 separate capture/bubble rows, C31 nearer target credit, C32 no evidence generated by argument inspection and `library_call` versus React's `synthetic_event`, and C33 observed ambiguity reasons.

## Banked comparison with the archived base

The existing `banked-2/sweep.mjs`, `banked-2/mcp-all.mjs` and `banked-2/diff.mjs` were run with the archived base root and this branch root. G6's `records.jsonl.gz`, `runs.jsonl.gz`, `spans.jsonl.gz` and manifest files were gunzipped into untracked `grader-scratch/banked/g6`. The six G6 compare pairs were regenerated with each checkout's `test/browser/g6-compare.mjs`, the same banked store and `/Users/austinho/dev/fixtures/anything-llm` source root, then graded with `node test/g6-grader.mjs <g6-store> --compare <branch-compare>`. The six pair JSON objects differ only in the echoed `server_args[1]` store path (`<tracer>/...` versus the absolute path); after normalizing that field they are identical. The grader passed 6/6.

The MCP script called `recent_actions`, each `page_requests` session, every `action_chain`, and `element_history`/`resolve_element` for each action target over stdio. The manifest argument was `-` in both checkouts.

| Banked store | MCP result, base versus branch | Credit sweep |
|---|---|---|
| final7 | **58/58** text and structured identical | 54 actions, 0 changed |
| G6 | **421/421** text and structured identical | 408 actions, 0 changed |
| Trusted-events | **884/888** texts identical; **826/888** structured identical | 852 actions, exactly 3 changed |
| Other 9 stores in the 12-store sweep (G2 variants, G3e, both G1f modes, G5 variants, outcome-labels) | MCP not rerun for these | 0 changed; abstention counts unchanged |

The three changed trusted-events actions are `action:mug1mwdh:75`, `action:mug1n21l:75`, and `action:mug1n7pt:75`, all Escape keydowns. Credit moves from the Shortcut document listener at `main.jsx:4067-4279`, which did not send on Escape, to `onOpenChange` at `main.jsx:1786-1854`, whose continuation issued `/api/dialog-dismissed`. The four changed MCP texts are those three `action_chain` calls and their shared `element_history`. Structured output also adds `handler_abstention.basis: "declared"` for 57 legacy abstentions. No other credit, abstention count, final7 text, or G6 text changed.

## Decision and residual risks

The only ownership moves observed in the new probes are required by D-G1-22: a bound frame outranks the body-level unbound issuer; among bound frames, the nearer target wins unless another bound frame issued the request by its own lineage. The named analytics request remains attributed to its issuer in the evidence. Continuations-neutral, shadow-dom-context and episode-focus passed without a new mover requiring repair. No app- or fixture-specific code was added in this verification pass.

- A leaf function with no available event argument can remain ambiguous when several props hold it. For non-delegated React events with native `eventPhase === 2`, capture versus bubble can also remain undecided. Both are reported as ambiguity, not guessed.
- Inspecting a Proxy argument can call its `getOwnPropertyDescriptor` trap. Recording is suppressed during that read, but app-visible trap execution itself cannot be prevented. The fixture verifies it leaves no Tracer evidence.
- Page-level listeners on `body`, `html` or a React root/portal container are intentionally unbound even if first-party code registered them. Shadow-root and React-rendered portal holders still bind; `shadow-dom-context` passed. A feature implemented solely by a page-level listener will therefore have no bound handler credit.
- Older banked stores have no observed binding rows and cannot be re-judged. Their declared-basis abstentions remain as recorded. The known context-ref unit failure remains unresolved on this branch.
