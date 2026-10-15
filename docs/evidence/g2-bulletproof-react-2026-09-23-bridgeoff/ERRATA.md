# Errata (bulletproof-react bridge-off)

1. **`credited: 13` in `summary.json` includes 1 `unrooted_global/route_loader` credit.** It is the Discussions NavLink → `app/router.tsx:49`. The runtime credits a request-owning frame without the binding check (`analysis/runtime-attribution.mjs:111-129`). Under the amended categories it is 12 correct + 1 unrooted_global.
2. **`bound_handlers` is over-inclusive.** It counts every `on*` prop of a component ancestor as bound, whatever the event; for example, the discussion link's `onMouseEnter` appears in a click's bound list. This caused no wrong credit in this run (grader).
3. **3 rollup sourcemap warnings** in `build-enabled.log`, from the hidden-map build. They are the same as in the bridge-on runs.
4. **Wrapper file name.** RUN.md says the wrapper config is banked as `wrapper-vite.config.mjs`, which is this directory's file. After the rebase onto main (`a1807189`), the merged harness banks it only under main's name, `vite.g2.config.mjs`, and keeps stamp rows inside `records.jsonl` instead of a separate `stamps.jsonl` (see `../g2-bulletproof-react-2026-09-23-bridgeoff-smoke/`). This directory keeps its files as recorded.
