# Errata (anything-llm bridge-off)

Written with the run and after reading `GRADE.md`. The generated files (`summary.json`, `ACTIONS.md`, `actions.json`) stay as generated; this file corrects them.

1. **68 `dom.action` rows, not 67.** One page-load `focusin` on the prompt textarea happens before step 1, outside the step windows. `summary.json` counts only rows inside steps; `harness-stdout.json` shows `outside_steps: 1`. Its bound `onFocus` ran.
2. **"44 unattributed" is 22 before the first action on each page plus 22 in-session.** `summary.json` lists them without that split. RUN.md and LIMITS.md give it.
3. **9 step-7 keydowns are reported as "no first-party function entered".** Global listeners did run, but their `function.enter` rows carry the earlier step-6 action (stale listener ownership), so no candidate is recorded under the keydowns. The verdict is `none` either way. The accurate reason would be an `entry_handler` abstention.
4. **`frontend/bundleinspector.html`** is written by the fixture's own visualizer in both builds. The path is repo-ignored.
5. **Wrapper file name.** RUN.md says the wrapper config is banked as `wrapper-vite.config.mjs`, which is this directory's file. After the rebase onto main (`a1807189`), the merged harness banks it only under main's name, `vite.g2.config.mjs` (see `../g2-bulletproof-react-2026-09-23-bridgeoff-smoke/`). This directory keeps the file as recorded.
