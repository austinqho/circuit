# Limits (g1-2026-09-23f)

- **Grading.** Headless Chromium only. The pass was checked by script and by `mongosh`; no independent grader has reviewed it.
- **Await rewrite.** The rewrite changes microtask interleaving relative to native `await`, not just the timing. In the grader's probe the same code logs `baca2d` instrumented and `aba2cd` native. Values, exceptions, `this`, `arguments` and `finally` are preserved. Code that depends on the exact interleaving of independent promise chains can behave differently. `PRODUCTTRACE_AWAIT_CONTINUATIONS=0` turns the rewrite off.
- **React versions.** Receipts and render detection are verified on React 18.3.1 and 19.2.4 only. Any other layout of `currentDispatcherRef` is reported as a `capture.limit` row and receipts abstain. Render detection (D-G1-15) is also off in that case, so renders may inherit the action they are flushed on; the warning states this.
- **Recall timing.** Receipts are consumed by the first commit after them, including an unrelated commit. `gen_title` was unattributed in one run of four for that reason.
- **Parity gate.** The gate is flaky without the chat fixture: the default model name differs between loads. Both LibreChat runs here used the already-built client, started by a scratch copy of `m1-live.sh` with the build line skipped (see RUN.md).
- **The 173 new ids.** They are initializer arrows (for example `AuthLayout = () => (…)`, `apiKeys = () => …`). Some of them are components, so the function rows emitted per action can differ from round five.
- **Evidence not rerun.** G3 survey, D12 and span neutrality were not rerun in this pass. The stamper is unchanged; the runtime change touches attribution only.
