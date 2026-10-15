# M1 — Runtime attribution engine (brief for the Codex task)

Date: 2026-09-21. Repo: `github.com/austinqho/tracer`. Start from `origin/main` (`a88282bd`, PR #17); local `main` is stale, so `git fetch origin && git checkout -b m1-runtime-attribution origin/main`. Open a draft PR when there is something to review. Do not merge. The user tests before any merge.

## Why M1 exists (read this before touching code)

The Sep 4–11 work proved one thing and got stuck on another. Proven: given a clicked control, Tracer can join the click through React, TanStack, Axios, an Express handler, and a MongoDB operation by identifier only, with OpenTelemetry trace-parent confirmation, and abstain when it cannot (PR #4, `docs/pr1-acceptance.md`). Stuck: forecasting every possible path from every control statically. The last whole-app sweep left 0 of 5,667 controls "source complete"; PR #7's blind run admitted 0 of 106 library rules; the React rule bank has 103 open scopes; on Cal.com ~1,950 of 2,143 failures were lost first-party prop callbacks, not libraries.

The decision, agreed with the user on 2026-09-21: **attribute observed executions; stop forecasting all possible executions.** A real user's click produces a dynamic call graph. Record that graph directly and join it, instead of predicting it from source. Static analysis keeps three jobs only: the control inventory (denominator), identity typing (M2), and diff-driven re-verification (M5). None of those are M1.

Therefore, in M1:
- No new library contracts. No new React rules. No Joern, no Jelly. No LLM calls anywhere in the runtime path. No browser crawling for coverage.
- No rule that only works on LibreChat. LibreChat is the exam, not the answer key. Anything LibreChat-specific belongs in the test harness, never in `src/`, `analysis/`, `backend/`, or `integrations/`.
- Tracer must remain read-only to the customer's tracked source: attach at build time (Vite plugin / transform) and at load time (observer before React, backend preload), exactly like `npm run demo:build:librechat-autonomous` does today. `git status` in the LibreChat clone must stay clean after every run.

## What to build

One causal-chain record per user action: `click → first-party handlers → library edges (opaque) → request → route → handler → DB op`, or an explicit stop with the reason. Concretely:

1. **First-party function instrumentation** in the build transform: every first-party function (including compiled workspace packages such as `@librechat/client`, mapped through their source maps) gets a stable id = hash(file content) + source span, and records entry/exit. Arguments are recorded as *identities only*: object identity via WeakMap-issued handles, and id-shaped primitives (uuid/objectid-like strings). Never text, never input values, never printable keys, never props dumps.
2. **Async context propagation** so a later callback still belongs to the click that caused it: promises/await (Vite must transform `.js` too, or native await loses context; the freeze hit this), timers, DOM event listeners, EventSource/SSE and fetch streams, React scheduling (state update → committed render → effects), and library lifecycle callbacks. Use the rule from the freeze: state propagation, timers, stream events, committed effects, and library lifecycle callbacks start a new continuation that inherits the owning action; they never inherit a stale synchronous call stack.
3. **Library boundaries stay opaque**: wrap imported exports at the import site to record call-in and call-out with argument identities; do not analyze the library interior. The first-party callback that a library invokes is observed on entry, which is all attribution needs.
4. **React commits**: keep the existing DevTools-hook observer and control stamps; add the `surface.change` receipt (state cell → committed DOM change, owned by the originating action) from the freeze.
5. **Requests and backend**: existing occurrence id + traceparent on fetch/XHR/Axios; existing vendored OTel adapters (http, express, mongodb/mongoose); handler span per registered callback; DB span descended from the handler span.
6. **The record**: one JSON per action with the chain as an ordered list of `{kind, id, source_ref, evidence_ids}` steps, terminal `{effect | stop_reason}`, the React commit(s) it caused, and `abstained: [...]` where identity or continuity could not be proven. Keep `producttrace.workflow-event.v1` grouping if it is cheap; the chain record is the deliverable.

## Harvest, do not rewrite

Most of this exists in the frozen experimental tree. Read before writing:
- `/Users/austinho/dev/trace-consolidated/` (frozen at `c87555d5` plus the dirty tree captured in `/Users/austinho/dev/producttrace-freeze-2026-09-07/` — `EXTRACTION_INVENTORY.md`, `tracked-changes.patch`, `dirty-manifest.jsonl`).
- Look for: `observed-vite.mjs` (first-party instrumentation, library-boundary wrapping, observer injection, node_modules real-path boundary rule), `runtime-observation-bridge.mjs`, the `surface.change` receipt implementation (commit-phase, instance-scoped), the continuation-splitting rules, `frontend-instrumentation.mjs` (controlled-input stamping fix), the vendored OTel adapters, and the black-box acceptance harness under `evidence/runtime-first-2026-09-04/` and `evidence/source-first-coverage-2026-09-05/`.
- Do NOT harvest: the control-centered mapper, completeness ledger, matched-return summaries, Joern/Jelly adapters, the deterministic narrator, any `tools/map` traversal.
- Current package modules to build on: `src/producttrace-runtime.js`, `integrations/vite.mjs`, `integrations/compiled-request-bridge.mjs`, `analysis/runtime-join.mjs`, `backend/`, `collector/`.

## Fixture setup (do this first, in this order)

- Fresh clone: `git clone /Users/austinho/dev/trace-archive/repositories/telemetry-audits/LibreChat /Users/austinho/dev/trace-consolidated/.live-demo/librechat-m1 && cd $_ && git checkout 45cc53c && git checkout -b m1-fixture`.
- Dependencies: `cp -R /Users/austinho/dev/trace-consolidated/.live-demo/librechat-clean/node_modules node_modules && rm -rf node_modules/posthog-js node_modules/@posthog`. Copy `packages/*/dist` from `librechat-clean` if present; `packages/client/dist` was missing last time and needs `npm run build:client-package` once.
- Env: `grep -v -E '^VITE_POSTHOG' /Users/austinho/dev/trace-consolidated/.live-demo/librechat-posthog-opus/.env > .env` (it contains a working `OPENAI_API_KEY`; never print it, never copy it into any file you write). `MONGO_URI=mongodb://127.0.0.1:27017/LibreChat` is already correct.
- Services: MongoDB is the Docker container `producttrace-librechat-mongo` on 127.0.0.1:27017 (NOT `chat-mongodb`). Meilisearch is unreachable; harmless. `rag_api`/`vectordb` crash-loop; ignore.
- User: `npm run create-user -- tracer-m1@example.test "Tracer M1" tracerm1 "Tracer-M1-2026!" --email-verified=true`.
- Backend: `npm run backend` on 3080. Frontend: build through the Tracer plugin into a detached output (as the autonomous demo build does); serve on its own port; LibreChat's tracked files stay untouched.

## The scripted session (perform it yourself; do not grade it)

Use the computer-use / browser tools available in this session to drive a real browser as user `tracer-m1@example.test`. Every submit, save, and confirm must be a real click on the real control (trusted events). If the only way to enter text is a synthetic value setter, say so per step. If computer use is unavailable, use headed Playwright against the real build and say so.

| # | Action |
|---|---|
| 1 | Log in |
| 2 | New chat, OpenAI endpoint, send: `Give me three names for a coffee shop in one line.` Wait for the reply to finish. |
| 3 | Click the copy button on the assistant reply |
| 4 | Thumbs-down the assistant reply, pick any reason |
| 5 | Regenerate the assistant reply; wait for it to finish |
| 6 | Edit the original user message to `Give me three names for a tea shop in one line.` and resubmit; wait |
| 7 | Rename the conversation to `Tracer M1` |
| 8 | Create an agent named `Barista` with instructions `You only talk about coffee.` and save it |
| 9 | New chat with the `Barista` agent, send `What is a flat white?`; wait |
| 10 | Delete the second conversation |

Then two extra runs: **overlap** (start a regenerate, and while it streams, rename and cancel-rename another conversation) and **negative replays** (re-run the joiner over the captured evidence with the dispatch evidence removed, then the request evidence removed, then the span evidence removed; the corresponding claim must disappear, never be replaced by a guess).

## What to report (write into `docs/evidence/m1-2026-09-21/` on the branch; keep it updated as you go)

- `RUN.md`: timeline with timestamps; for each step exactly what you clicked (control label, testid/aria, screenshot path), what the app showed, and any harness workaround.
- `records.jsonl`: raw Tracer output for the session, unedited. `spans.jsonl`: raw backend spans.
- `chains.md`: for each step, the chain record Tracer produced, printed as it is (ids abbreviated to 8 chars), including stops and abstentions. Do not annotate with "met/partial"; the grader does that against Mongo.
- `coverage.json`: first-party functions instrumented vs skipped (by file), library boundaries wrapped, compiled packages mapped through source maps vs not.
- `overhead.md`: p95 observe cost per event, bundle delta raw/gzip against the existing budgets (+40 KB raw, +10 KB gzip, 0.2 ms p95), Node request latency with and without the preload.
- `negative-replays.md`, `overlap.md`: outputs.
- `LIMITS.md`: what does not work and why, honestly. A path that stops is reported as a stop, never as "mapped".
- Draft PR description: one claim, the gate text, the evidence dir, the test count.

## Rules

- Never print or persist secrets. Never record text, input values, or printable keys.
- No edits to any repository other than `tracer` (this branch) and the disposable `librechat-m1` clone's untracked build outputs.
- No merges, no force-pushes, no deletions outside the two directories above.
- Regression tests must stay green; add tests for every new mechanism against neutral fixtures (not LibreChat).
- Stop and write LIMITS.md rather than loosening a check to make a number go up.
- Loop until the ten-step session, the overlap run, and the negative replays have been executed and reported, or until you hit a blocker you cannot resolve; then stop and report.
