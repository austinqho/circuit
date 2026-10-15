# Handler binding: RUN-4 (rebase onto published trusted-events, 2026-09-24)

This is implementer re-verification, not an independent grade. The branch was rebased with `git rebase --onto origin/fix/trusted-events 53eb8882 fix/handler-binding` onto `cd91a186dc5f92f723e2737b84a6f0eb616c3928` (whose history includes main `39449f7a` and the #18/#19 integrations). All 23 handler-binding commits, including both independent grader commits and their evidence, were replayed. Existing evidence files were not edited. All browser runs were headless, and no dependencies were installed. The published base was unpacked with `git archive cd91a186` under untracked `grader-scratch/base-cd91/` for controls; no other worktree was changed.

## Conflict resolution and integration correction

| Conflict | Resolution |
|---|---|
| Browser runtime: `actionFrame`, bare continuations, and dispatch entry | Kept trusted-events' gesture/range closing, caused-dispatch ownership, pending action liveness, and #18 window behavior. Carried handler-binding's dispatch target, cause, and `origin_dispatch` through those frames. A caused `focusin` now retains two IDs: its own `dispatch_action_id` for its `handler.invocation` row, and the causing click's `action_id` for the handler's work and request. Hover frames keep their pending continuation ID and actual target. |
| Analysis/causal chain and MCP | Kept #18's window evidence, root escape/coverage text, and aborted-request effects; kept observed binding, unbound request issuer, and library-mediated abstention data. Kept #19 function labels alongside binding rows. For observed-basis abstentions, the MCP renders the listed listener/library function IDs with build-time labels; stored raw IDs and legacy banked wording remain unchanged. |
| Gate and plugin skill adjacency | Kept D-G1-21a and its #18 rebase note alongside D-G1-22 and both amendments. Kept the main skill's coverage, server hop, and function-name guidance alongside the binding and observed-ambiguity guidance. |
| Fixture build comment | Kept the shared `resolve` option and one description; no behavior changed. |

The handler-binding driver's C14 assertion was updated for D-G1-21a: a `focusin` caused by a click has its own invocation and `runs_on_action_id`, while `/api/note-focused` belongs to the causing click. C8 also checks that an observed abstention prints names instead of raw function IDs. These are integration assertions, not app-specific attribution rules. `npm run build` passed and `cmp src/runtime-attribution-browser.js dist/runtime-attribution-browser.js` found byte identity.

## Headless re-verification

Raw local logs are under untracked `grader-scratch/runs4/`. The final kept handler store is the third driver invocation (`tracer-handler-binding-store-ARiu3a` in the system temporary directory). It has 4,417 rows across three page loads: 1,697 `dom.action`, 161 `dom.action.range`, 138 `handler.binding`, 12 `handler.invocation`, and 6 `handler.via_library`. Each page's `capture.page` says `handler_bindings: "observed"`; `capture.page.user_events.listened` and `observes.events.recorded` both list 155 kinds. The base negative control uses the final branch driver, fixture, and fixture builder against the archived cd91a186 runtime.

| Check | Result |
|---|---|
| Handler-binding, three invocations × three page loads | **142/142 ×3** |
| cd91a186 negative control, three page loads | **19/142**, expected failure |
| Trusted-events | **118/118** over three page loads, plus touch/hover and inputText builds |
| D12 stamp neutrality | **24/24 ×3** successful runs; one intervening run had **22/24** (A/D `selectionchange` versus `keyup` order; A/B/C identity and row counts held); one rerun passed |
| Continuations-neutral | pass on first run |
| Episode-focus | pass ×3 |
| Shadow-dom-context; no-cross-control-neutral; effect-rooted-form-neutral | pass; pass; pass |
| Outcome-labels; mcp-gaps; body-capture | **169/169; 35/35; 51/51** |
| Stable-element-keys; honest-coverage; unlinked-coverage-neutral | **19/19; 45/45; 13/13** |
| Function-names; middleware-reads; client-aborts | **263/263; 343/343; 245/245** |
| Server-outbound `--runs 3 --control` | **170/170** |
| G4 final7 | **81/81** |
| G6 (gzip records, runs, spans, and manifests unpacked into scratch; six compare pairs regenerated and graded) | **6/6** |
| `npm test` | **730/731**; sole failure `react-context-ref-semantics.test.mjs:63`, the same known failure on the published base |

The D12 failure was event scheduling across separate A and D page loads, not a stamp-dependent change: both loads had the same record totals as the passing runs (A 210, D 214), and its first difference was a `selectionchange` row appearing before a `keyup` in one load. A/B/C were byte-identical. The immediate serial rerun restored A/D byte identity. No code was changed for that timing difference.

## Independent grader probes

`grader-scratch/probe{5,6,7}-driver.mjs` exited zero with no page errors. Outputs are in untracked `grader-scratch/runs4/probe{5,6,7}-branch.json`.

| Probe | Observed result |
|---|---|
| s1, s1b | Component callback held by two props stays ambiguous for custom or mismatched forwarded event arguments; both holders remain candidates. |
| s2a, s2b | Destructured leaf stays ambiguous; call-proxy case resolves `onClick`. |
| s3, s3b | Ancestor `onClickCapture` and target `onClick` have separate rows, including a leaf with no event parameter. |
| s4, s4b | App Proxy log contains only its own `get:id` reads (`observable`, `revoked`); no Tracer `get:nativeEvent`/`get:_reactName`, and no trap `function.enter` or `handler.*`. The library call binds the component's `onSelect`. |
| s5 | App `dispatchEvent` writes an untrusted `handler.invocation`; the originating click owns `/api/dispatched?trusted=false`. |
| s6 | One div holding the same function in `onClickCapture` and `onClick` gets two rows, one per pass. |
| s6b | Capture-only ancestor binds `onClickCapture`; the target's nearer `onClick` wins credit. |
| probe7 | Body capture analytics listener has no binding; Save real credits `onSaveReal`, State only credits `onStateOnly`; both analytics requests remain visible as unbound issuers. |

## Banked base/branch comparison

The archived cd91a186 checkout and this branch served the same stores over stdio: `recent_actions`, every `page_requests` session and `action_chain`, and `element_history`/`resolve_element` for every action target. G6's compressed records, spans, runs, and manifests were unpacked into scratch. Both checkouts regenerated all six `compare_chains` pairs; all six JSON pair objects were identical after normalizing only the echoed `server_args` store path. The branch's independent G6 grader passed 6/6.

| Banked store | MCP base versus branch | Credit sweep |
|---|---|---|
| final7 | **58/58** text and structured identical | 54 actions, 0 changed |
| G6 | **421/421** text and structured identical | 408 actions, 0 changed |
| trusted-events | **884/888** texts and **826/888** structured identical | 852 actions, exactly 3 changed |
| Other nine stores in the 12-store sweep | MCP not rerun | 0 changed; abstention counts unchanged |

The three changed trusted-events actions are `action:mug1mwdh:75`, `action:mug1n21l:75`, and `action:mug1n7pt:75`: Escape keydowns now credit `onOpenChange` at `main.jsx:1786-1854` instead of the Shortcut document listener at `main.jsx:4067-4279`, which sent no Escape request. The four changed MCP texts are those three `action_chain` calls and their shared `element_history`. Structured output also adds `handler_abstention.basis: "declared"` for 57 legacy abstentions. No final7/G6 MCP output or other banked credit changed.

## Residual risks

- A leaf callback held by multiple props remains ambiguous without a readable dispatch argument. React's nondelegated target-phase events can leave capture/bubble undecided (`eventPhase: 2`).
- `Object.getOwnPropertyDescriptor` on a Proxy can still run its trap; the guard prevents that read from creating Tracer evidence. The app can observe the trap.
- The `react_event_system` invoker label remains inferred from React's container marker. Body, html, and unrendered root-container listeners are page-level and never bound; other first-party wrapper listeners use DOM-path distance, which is approximate beside fiber depth.
- Stores recorded before observed binding rows retain declared-basis judgments. The known unit failure remains, and one D12 run exposed page-load event-order sensitivity as described above.
