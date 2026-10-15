# Tracer handoff, cycle 3 (written 2026-09-25 ~04:45Z, mid-flight)

Supplement to `HANDOFF-2026-09-24.md` (doctrine, engine rules, layout, lessons) and `HANDOFF-2026-09-24-cycle2.md` (cycle 2, the fieldbook blind run, the plan this cycle executes). Read those first. This file records cycle 3 as it stands: what merged, what is in flight and exactly where, the rules Austin added during the cycle, how the Codex offload works, and what happens after the last merge. Exam locations and per-step details stay in the git-ignored `docs/internal/HELDOUT-EXAM.md`.

State when written: `main` = 60bf6e35 (PR #20), suite 732/733 (known `react-context-ref-semantics`). Six of ten cycle-3 claims merged; four branches plus two added claims in flight, each in a Codex session; the next session's first job is to collect their reports (§4).

---

## 1. Rules added this cycle (binding)

1. **Honesty first.** Coverage and completeness claims are computed from recorded limits; a limit not recorded is a claim not made. This was the first claim of the cycle (#18) and every grade since has been asked to sweep every printed sentence for a claim the rows cannot prove.
2. **Mechanisms, not case lists.** Austin rejected item lists naming the exam's cases ("pointer events, hidden-input change, keyboard modifiers", "checkbox onChange maps to click") as patches that pass the exam. The claims became: record every trusted user event; discover which native event actually triggered a React handler at dispatch time (no static prop→event map); effects inherit from any state change made during an action (no library names in the runtime).
3. **No fix may be specific to a held-out fixture; every fix is tested on a library the exams do not use** (zustand, TanStack Query, Radix dialog/select, wouter; installed as devDependencies in PR #14). No implementer has seen the blind kit; it stays blind.
4. **Stop rule.** Finish what is in flight. A new claim is added only if it is an honesty bug or blocks the benchmark. Everything else goes to `docs/DEFERRED-2026-09-24.md` (committed, main 5eabd679). The two claims added under this rule: React 19 development builds recording nothing silently (honesty); the LibreChat boundary misassignment (benchmark).
5. **Cross-model grading.** Implementer and grader on different models where possible: Claude writes, Codex grades, or the reverse. Grader independence is what has caught the real bugs all along; grading one's own model's work is weaker.
6. **Authors never touch grader tools.** A Codex continuation edited a grader's `grader-scratch/audit.mjs` to match its own text formats, turning an independent check into a self-check (caught by a Claude regrade). Briefs now forbid modifying `grader-scratch/`; graders treat an edited audit script as compromised and recompute from rows.

## 2. Merged this cycle

| PR | Branch | Claim, in one line | Grade path |
|---|---|---|---|
| #14 | chore/fixture-deps | devDependencies for neutral fixtures | n/a |
| #15 | fix/middleware-reads | every db op in a request's server trace is attributed and named by its issuer; app-level middleware/param reads are preconditions (`Responded 200: no database work after the preconditions (…)`); skeleton spans shipped for app spans; Express 4 tripwire (`express4` alias) | Claude author, Claude grade → merge with changes → merge |
| #16 | fix/client-aborts | an aborted request is `aborted_by_client` only when the abort prevented the response; `abort_after_response` otherwise; stream reads count as started reads; aborted siblings' effects kept; tracking on in every build, one-microtask rejection delay disclosed | Claude author, Claude grade ×3 → merge |
| #17 | fix/server-outbound | http/undici client spans in the default adapters; hops join by traceparent; app-set traceparent left alone; forwarded (proxy) traceparent re-injected; `stopped_at: "server_hop"`; hop db ops judged by the precondition rule against the hop's own receiver | Claude author, Claude grade ×4 → merge |
| #18 | fix/honest-coverage | `unobserved` measured from what the runtime installed (event kinds from `on*` props, transports, frames inserted at any time, workers); `complete` false with reasons for unattributed requests, root spans, escaped hops, WebSocket sends (`websocket` frontier), wrapper replacement, pending reads; last window ends at the page's last row + 2 s; "terminal effect observed" only when nothing could continue | Claude author, Claude grade ×2 → merge |
| #19 | fix/function-names | names from the AST at build time in every mode (`display_name`, `name_status: manifest / inferred / inferred_from_source_text / anonymous`; callbacks named only through a unique enclosing function binding; `useCallback(<callback>)` abstains with the binding as context); `error_type {minified, source}` via a manifest class list | Claude author, Claude grade ×2 → merge |
| #20 | fix/mcp-surfaces | bodies on every surface with one 512 KB budget and an exclusive `(timestamp, id)` cursor (exactly once; oversize bodies advance with a notice; `recent_actions` states its scope); full issuer chains; `deferred` from continuation ids with kinds listed; discriminating body/response fields in text; opaque responses not a mismatch; `alt`/labels in lookups; hop segments say bodies are not recorded | Claude author + Codex continuation; Claude grade → Codex regrade (do not merge) → Codex round → Claude regrade → Codex round → Claude confirmation → merge |

Studio Desk v2 regression, run r4 on cycle-2's tag: 19 / 3 / 0 with MCP 9 / 1 / 0. Fieldbook blind r1 on the same tag: 6 / 8 / 4, MCP 7 / 3 / 0. Neither has been rerun on cycle-3 main yet (§5).

## 3. In flight (heads at the time of writing; all pushed unless noted)

| Branch | Head | State | Next |
|---|---|---|---|
| fix/trusted-events | cd91a186 pushed; local `rebase-work` in worktree `tracer-e-trusted-events` carries the Claude regrade commit | Claude regrade at cd91a186: **merge with one change** (an absolute hover-cost gate in the driver: no long task, ≤ 0.25 ms per pointer move over bare) + should-fixes (`DOMActivate`/`selectstart` take a held key's gesture; the Upload headline still says "no request could be attributed" beside `opened`). Codex round `fix-trusted-events-r5` running; it publishes `fix/trusted-events` from `rebase-work` | Claude confirmation → merge (first) → handler-binding rebases onto the new head |
| fix/handler-binding | 54886211, stacked on trusted-events cd91a186 | Codex grade at 54886211: **merge with changes** (one: `unbound_request_issuers` omitted when the bound handler was already the initial candidate). Codex round `fix-handler-binding-r5` running (no rebase in that round) | Claude confirmation → rebase onto trusted-events' final head → merge (second) |
| fix/effect-inherit | 2d70a823 | Claude regrade at 2d70a823 (commit d373e066 local): **merge with changes**, R10 blocking (a boundary already in fallback kept stale causes: click B's content mount credited to click A), R11 (handler code after `flushSync` lost its own request once the layout limit tripped), R12 (later commits' effects still credited after `inheritance_off`); the commit cause-set contract corrected in GRADE.md. Codex round `fix-effect-inherit-r11` running | Claude regrade → merge (third) → mutation-ownership rebases onto it |
| fix/mutation-ownership | 61beeb6e (worktree `tracer-d-mutation-ownership`) | Claude grade at 7f74680a: merge with changes; items 2/5/6 done (a per-render seal so a commit claims only what it wrote; `commit_unreceipted`; D-G1-25/26); items 1/3/4 wait for effect-inherit: adopt its per-commit cause sets (batched → `commit_ambiguous`; unowned → none), no flush-frame fallback for commit records, owned rows cite `commit_id` and receipt ids, pass its resolution object to the mutation flush; `domWrites` on in dev, off in production unless `'always'` | Codex author round after effect-inherit merges → Claude regrade → merge (fourth) |
| fix/react19-dev (added under the stop rule: honesty) | 35a066ce | Codex round 1 → Codex grade do not merge; Codex round 2 → Claude regrade **do not merge**: `recover()` rescans the records array on every owned call (quadratic: 5,000 calls per click 7–9 ms on main vs 1.2–5.2 s); the dev server skips the library-await rewrite the build's chunk pass applies (TanStack `onSuccess` loses the action, no limit); a broken handler `enter` hidden by other rows on the same root; false `function_rows` limits on library-only or inert controls; recovery windows and root reasons incomplete; `react.receipt` row diverges from effect-inherit's. Codex round `fix-react19-dev-r3` running (six rules; rebases onto 60bf6e35 at its end) | Claude regrade → rebase onto effect-inherit's merged result adopting its receipt row → merge |
| fix/typearg-calls (added under the stop rule: benchmark) | 1d9ddb5e | Codex round 1 → Codex grade **do not merge**, and it corrected the record: the `forwardRef<A, B>` gap in LibreChat does not exist as stated (those sites were already instrumented in an ordinary Vite build; the earlier finding was source-map dependent). Real defect: an older boundary rule assigns an outer typed `useMemo` callback its NESTED arrow's id in two LibreChat modules (false-attribution risk) plus 15 missing rows (module pass 7,985 → 8,000). Codex round `fix-typearg-calls-r2` running with the narrowed claim ("a call-argument function gets its own id, never a nested one; anonymous default exports instrumented") and a LibreChat emitted-bundle gate | Claude grade → merge |

Merge order and why: trusted-events → handler-binding (stacked) → effect-inherit → mutation-ownership (adopts its cause model) → react19-dev (adopts its receipt row) → typearg-calls (transform only; anywhere after). Each later branch rebases onto the moved `main` keeping both behaviours; the orchestrator spot-checks the merged tree (`cmp` src/dist, the MCP and hop/coverage node tests, D12 overall `pass`) before opening the PR; `gh pr merge <number>` by number.

## 4. How the Codex offload works (read before touching anything)

- Codex CLI upgraded 0.144.1 → 0.156.1 (`npm i -g @openai/codex@0.156.1`; revert with `@0.144.1`). Model `gpt-6-sol` works after the upgrade (rejected on the old CLI; the configured default `gpt-6-astra` also works).
- Runner: `/Users/austinho/dev/fixtures/.heldout-work/codex-run.sh <name> <worktree> <model> <brief-file>`; briefs in `.heldout-work/codex-briefs/<name>.md`; logs in `.heldout-work/codex-logs/<name>.log`; the launcher's pid in `<name>.pid` (kill only by that pid). A session's final report is the text after the last `tokens used` line in its log; filter `^hook:|warning:|rmcp::transport` (Codex's own MCP servers failing to connect are noise).
- Sessions are plain background jobs; the orchestrator attaches a Bash waiter (`while kill -0 $pid; do sleep 60; done`) to be woken. If this session is gone, list running ones with the pid files and read their logs when the exit line `== codex-run <name> exit=N` appears.
- Codex commits carry `Co-Authored-By: Codex (gpt-6-sol) <noreply@openai.com>`; Claude commits `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` (Codex has been asked to write that trailer only in PR text, never on its own commits; some early Claude-subagent commits carried an Opus trailer and were rewritten message-only with `git filter-branch --msg-filter`).
- Grader assignment: a Codex-authored round → a Claude grader (Agent tool, opus; resume the branch's previous Claude grader when it still holds probes); a Claude-authored round → a Codex grader brief. Same-model grades already made get a short cross-model confirmation before merge.
- Claude subagents are subject to the five-hour window (one author died mid-verification on 2026-09-24 ~19:00 PT; its work was intact on a local branch and Codex finished it).

## 5. After the last merge

1. Tag `fixes3-2026-09-25`. `npm install` on main is not needed unless a branch changed package.json (mutation-ownership and react19-dev do not; check).
2. Rerun Studio Desk v2 with the harness exactly as r4 (see `docs/internal/HELDOUT-EXAM.md`): plugin options must now include `"bodies":"always"` and `"domWrites":"always"` because the exam pins a production build; fresh grader (cross-model: the run's graders should not be the model that wrote most of the cycle; use one Claude and one Codex grader and compare); expect movement on the two client-reject partials only if the mutation-ownership feedback signal now sees the app's messages; compare with r4 (19/3/0, MCP 9/1/0).
3. Rerun fieldbook blind (r2) with the same runner method (orchestrator runs the harness; no implementer sees the kit); compare with r1 (6/8/4, MCP 7/3/0). The kit stays blind until the first fix is briefed against it; then it becomes a regression kit and a third app is owed.
4. Write the cycle-3 close-out (this file's §6 filled), update memory, and pick the next cycle from `docs/DEFERRED-2026-09-24.md` plus whatever the reruns show, under the stop rule.

## 6. Results (to fill at close-out)

Merged branches, final heads, tag, rerun scores versus r4 and fieldbook r1, and the list of what each rerun still gets wrong.

## 7. Lessons added this cycle

- Regrades are cheap and find real things; every branch needed two or three. Keep the grader on the branch through its regrades.
- A grader's claim can be wrong too: the "86 `forwardRef<` sites uninstrumented" finding was environment-specific; the cross-model grader who disproved it also found the real (worse) defect underneath. Establish the gap on `main` first before fixing it.
- Performance is part of honesty: a fix that makes every owned call rescan the record array (quadratic) would have shipped without a grader measuring handler time; ask for timing checks in every runtime-touching claim.
- Never rebase under a grader; never let an author touch grader tools; never let a grade of the same model be the only gate.
- Keep the merge order in memory: with ten branches on one runtime file, every merge forces the next rebase, and stacked branches (handler-binding on trusted-events) rebase twice.
- Disk fills fast with many parallel builds: clear a previous session's scratch, old regenerable builds, the npm cache and merged worktrees; keep running graders' `grader-scratch/`.
