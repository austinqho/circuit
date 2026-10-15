# Tracer handoff, cycle 2 (2026-09-24, afternoon)

Supplement to `HANDOFF-2026-09-24.md` (read that first: doctrine, engine rules, layout, lessons). This file records what happened after the seven post-exam fixes merged: the v2 regression run, Austin's five-item plan, the four claim PRs of cycle 2, the reruns, and the first blind run on a second held-out app. State at the end: `main` = b26c70bb, tag `fixes2-2026-09-24`, suite 699/700 (known `react-context-ref-semantics`).

Exam locations, protocols and per-step details stay in the git-ignored `docs/internal/HELDOUT-EXAM.md`. Implementers never see them; this file names mechanisms only.

---

## 1. The v2 regression run (r2, before cycle 2)

Austin supplied a v2 of the first exam kit (the r1 design-review fixes applied: consistent vendor verdict, lineage split into required/optional/platform, new must-nots, explicit verdicts, two concurrency steps, graded identity with decoys, production build pinned, request log outside the repo). Run r2 on `fixes-2026-09-24`: 24/24 driver steps, 40 requests, all 39 recorded requests joined exactly, no false or cross joins, no wrong identities. **17 PASS / 4 PARTIAL / 1 FAIL** on 22 steps (r1: 15/2/3 on 20); MCP stage **4 / 6 / 0** (r1: 0 / 9 / 1). r1's three fails were fixed (all DB ops shown; shadow root attributed; worker a stated frontier); both concurrency steps passed.

What remained: a dialog's autofocus `focusin` (fired inside the Remove click's commit) folded into the Enter keypress 509 ms later, so the focus action's chain printed the DELETE (the one FAIL); the 409 like carried `status: failed` but two display fields still said `completed`; client-side rejects labelled `incomplete`; the worker request had no row; the MCP dropped non-request functions (rollback, validation, hit-test), listed unlinked spans without their DB ops, had no way to query background polls, and description lookups came back with 16–18 candidates. Packaging: `plugin/` was not in `package.json` `files`, so an npm install shipped no skill.

## 2. Austin's plan and the decisions

1. S12 focus rule, display labels (409 → failed), a "rejected by app" outcome.
2. MCP rendering gaps (non-request functions, DB children of unlinked spans, a background query).
3. Decide on dev-mode body capture ("biggest single lift for the questions").
4. Fix `files` in package.json.
5. Rerun v2 until green, then the second held-out kit for a blind run.

Decisions taken (all deliberate; revisit only with a reason):
- **Body capture** is on by default in dev builds, off in production unless `bodies: 'always'` (warning for any non-development mode), `bodies: false` off. Bodies live in their own `network.body` rows and attribution never reads them.
- **"Rejected by the app" needs a recorded signal, never a guess.** Signals: validation feedback on the submit's own row (an alert/status/aria-live change, an `aria-invalid` change, or focus moved to an invalid field) after a submit-capable click or Enter in a form the browser validated; the handler or an owned continuation threw (`threw` + `error_type` on `function.exit`, `action.uncaught_error` linked by the error object); a returned promise rejected. A silent early return is `no_request`, and the sentence says "the handler ran and issued no request from instrumented code". The G6 seeded-bug scenario E (a silent `return`) was re-labelled from "stopped at validation" to `no_request`; gate doc §12 and the G6 grader expectation record it.
- **A focus after a suspended `for await` abstains** (`stale_frame`) rather than keeping an entry-point list; the click's own post-stream focus therefore abstains too, because it is the same state at run time.
- **"After response N" is an identifier** (`response_of` set at creation on reactions on the fetch wrapper's promise, derived promises, `await` including the nested `await (await fetch()).json()` form, and XHR load listeners), never a clock comparison; old stores read "ordered after the response; not linked".
- **Every build has always framed each function twice** (module pass and chunk pass). It is now labelled (`entry: call|chunk|body`) so call counts are exact, not removed, because removing it changes every store's row counts.
- **Redaction by key segment**, not substring: ids (keys ending in `id`) are never redacted; booleans and null never; numbers only under strong secret keys (password, pin, otp, cvv, card, ssn, secret, credential, token) with a quantity-or-metadata suffix exception (`maxTokenLimit`, `tokenBudget` kept).

## 3. The four claim PRs (plus packaging)

| PR | Branch | Claim | Grade path |
|---|---|---|---|
| #8, #9 | fix/package-files(-test) | `plugin/` and `.agents/` ship in the tarball; allowlist test updated (#8's body wrongly said "suite unchanged") | n/a |
| #10 | fix/outcome-labels | One `actionOutcome` function feeds MCP, export and viewer; label set `no_request / rejected_client_side (reason) / failed / completed / responded / stopped / pending`; HTTP semantics for `completed` (safe methods: 2xx/304 + any DB span; unsafe: 2xx + a write span, else `responded` "no write observed"); mixed statuses stated as "also …" everywhere; `compare_chains` counts status/reason | merge with changes → 2 regrades → merge |
| #11 | fix/episode-focus | A focus caused by an action's work belongs to that action (liveness token per synchronous run; `stale_owner` for frames entered on a suspended frame; scheduler commits abstain); members never print the carrier's chain (own evidence + pointer, own label) | merge with changes → 3 regrades → merge |
| #12 | fix/mcp-gaps | `work` listing with exact counts; unlinked entries with route/handler/DB; `page_requests`; path + query recorded; ranked raw-evidence lookups with `best`; `response_of`; issuer named for polls (await rewrite keeps the frame outside actions with no ownership and no token) | merge with changes → 2 regrades → merge |
| #13 | fix/body-capture | Bounded, redacted bodies in their own rows; streams and cancellation neutral (server bytes and time-to-close equal across builds, `pipeTo` included); D12 extended; MCP body summaries; one stated observable difference (a fetch rejection reaches the app one microtask later) | merge with changes → 2 regrades → merge |

Merge order was forced by `mcp/tools.mjs`: #10 → #11 → #12 → #13, each rebased after the previous merge with both behaviours kept. Every branch has `GRADE.md` with dated regrade sections and RUN-2/3/4 + ERRATA files under `docs/evidence/pr-<name>-2026-09-24/`.

Grader findings that changed designs (the method working as intended): the form-validation signal fired on `noValidate` forms, `formnovalidate` buttons and `submit` events; export and MCP labelled the same action differently (300 of 408 G6 actions); a suspended `for await` frame credited a real Tab focus to a click, then the same leak through a function `enter`; "after response" was a clock comparison; issuer text called instrumented code uninstrumented; typeless Blob/stream bodies read uncapped (40 MB); fire-and-forget rejections silenced; cancelled streams held open (a streaming chat app would keep generating after "stop"); substring redaction lost ids; numeric secrets in clear (the grader's own earlier advice, withdrawn).

## 4. Reruns

| Run | main | M1 | MCP | Notes |
|---|---|---|---|---|
| r2 | fixes-2026-09-24 | 17 / 4 / 1 | 4 / 6 / 0 | baseline for the cycle |
| r3 | #10 + #11 + #12 | 19 / 3 / 0 | 4 / 6 / 0 | focus fold and 409 display fixed; three of four MCP gaps fixed |
| r4 | fixes2-2026-09-24 (bodies on) | 19 / 3 / 0 | 9 / 1 / 0 | six ids now first-class via bodies; every "from source" answer but the worker's became grounded |

The three remaining PARTIALs are deliberate: two client-side rejects the app shows as plain text (no alert role, no `aria-invalid`, no focus move), which the feedback rule declines to call rejections; and the worker's request, a stated frontier (worker instrumentation deferred by Austin). Unscored defect found by the r3/r4 graders and not yet addressed: **DOM-mutation ownership is wrong in both directions** (mutations after an `await` are never recorded; unowned mutations are copied onto every open action, 29 of 60 rows in r4). Other gaps recorded: `page_requests` returns no bodies (page-load labels unreachable); summary text shows only extracted ids (error/type/revision live in the JSON); a 304 server status beside a 200 browser status is unexplained; description lookup is weak for images, canvases and list rows; README still says input values are not captured (false with bodies on).

## 5. The blind run on the second held-out app

A second held-out kit (different stack: TypeScript, react-router with a lazy route, CommonJS Express with an auth middleware that reads the DB on every request, multipart uploads, a module-level query cache, reducer-plus-effect requests, a command registry, a static iframe, an external truth proxy) was run blind on `fixes2-2026-09-24`: the orchestrator ran the generic harness itself; no Tracer implementer has seen the app, so the kit stays blind until the first fix is briefed against it (then it becomes a regression kit and a third app is owed). The one-line install worked unchanged on the new stack: marker 108/108, parity identical, production build, every one of the 20 requests joined exactly to its server span, no false or cross joins, no wrong identities, end state as expected.

**Score: 6 PASS / 8 PARTIAL / 4 FAIL on 18 steps; MCP 7 / 3 / 0.** Nothing with a request could pass, because the auth middleware's per-request DB read is in every backend trace and Tracer drops it from every chain without a note (a reads-under-middleware rule that PR #10's grader had already flagged as "shows as responded"). Waiving that rule alone gives 9 / 5 / 4.

What broke, by mechanism (details in `docs/internal/HELDOUT-EXAM.md`):
- **Whole kinds of user action are not recorded:** pointer events (pointerdown/pointerup, so a drag's request has no owner) and the `change` event of a hidden file input clicked through a visible button; neither gap, nor an uninstrumented iframe, appears in `coverage.unobserved`, which always says only `["beacon"]`. The visible button's chain says `no_request` while the upload happens in its window.
- **Client aborts read `completed 200`:** per-keystroke requests aborted by the page (the rows even record `threw: true, error_type: DOMException`) are labelled completed, and the mutation that rendered the final results is credited to an earlier submit.
- **Effect-issued requests are unattributed:** requests from a route's mount effects after a router `<Link>` click, and from an effect reacting to a reducer dispatch, are listed only as unlinked (the same pattern IS attributed when navigation starts in app code, via `mount_effect`).
- **React checkbox `onChange` runs on click,** not on the DOM `change` event; the binding map says `change`, so the chain falsely reports "no element-bound handler" and the effect runs outside any action.
- **Server-side `fetch` is not traced:** a server-to-server call starts a new root trace, the archive chain claims "terminal effect observed" with `coverage.complete: true`, and the call surfaces only as unlinked under an unrelated later action.
- **TypeScript `export function` / `export default function` have null names** (`<anonymous>` in listings); production builds minify error type names (`"Nf"`).
- **Keyboard modifiers are dropped** (Ctrl+K recorded with `modifiers: []`).
- **MCP:** bodies of unattributed requests are unreachable through any tool (so the values the effects sent, the drag order, the star count, the attachment metadata all sit in rows the agent cannot see); `page_requests` "called from" keeps only the outermost frame; a deferred DELETE shows `deferred: null` despite its 3 s timer; lookup by visible name returns `not_found`; "none: no user action" reads as a claim about cause.

What held: the deferred delete and its undone twin, the 503-then-200 retry from one click ("Completed 200; also failed 503"), implicit form submission by Enter, the command-palette Enter that archives, navigates and refetches, the rename PATCH plus cache refetch, the optimistic temporary id resolved to the server id from the response body, bodies bounded and redacted (multipart recorded as type and size only, file contents never stored).

## 6. Follow-ups, in the order I would take them

1. **Record every user-caused event kind** (pointer events, `change` on hidden inputs, keyboard modifiers) and make `coverage.unobserved` true: list each event kind and realm (iframes, workers) the runtime does not observe.
2. **Client aborts:** an aborted fetch is `aborted_by_client` with the server's status kept, never `completed`; the abort is already in the rows (`error_type: DOMException`).
3. **Reads under middleware count:** every DB span in the request's trace belongs to the request, including auth middleware reads; say which handler or middleware issued it.
4. **Effect-issued requests inherit the action** (route mount effects after a router navigation; effects reacting to a reducer dispatch) through the state-receipt path; React's `onChange` on checkboxes/radios maps to `click`.
5. **DOM-mutation ownership** (creation-time; abstain when unowned; never copy onto every open action).
6. **Server-side outbound requests** join the incoming trace (instrument Node's global `fetch`/undici in the backend register).
7. **MCP:** bodies for unattributed requests (`page_requests` with bodies); full issuer frames; `deferred` for timer-issued requests; summary text carrying error/type fields; the 304-vs-200 sentence; names for TypeScript exports.
8. Worker instrumentation (Austin: later).

## 7. Lessons added this cycle

- Regrades are cheap and find real things: every branch needed two or three. Keep the grader on the same branch through its regrades; it already knows the probes.
- Never rebase under a grader. Sequence: grade → author fixes → regrade → rebase → orchestrator spot-check on the merged tree → merge.
- Give authors rules, then accept their honest "this pass condition cannot be met and here is why" when the two cases are the same state at run time. Abstain over guess applied to the rule itself.
- A one-line tarball check (`npm pack --dry-run | grep plugin/`) would have caught the packaging gap a day earlier. The allowlist test pins the list; update both together.
- `gh pr merge` with no number merges the current branch's PR, not the one just created; always pass the number.
- Chain `echo ====` in zsh expands `=cmd`; quote it.
