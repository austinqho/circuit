# INVALID: anything-llm bridge-off run built from the wrong fixture commit

Kept as recorded; do not use for G2.

- Tracer: `g2-bridge-off` worktree (main `da8575e7` plus harness changes), plugin line `producttrace({"requestBridge":false,"stamps":true})`.
- Fixture HEAD during the run was **`3a8fcfb5`**, the `g5-scenario` branch ("G6 seed: update handler rejects names containing whitespace with 422 (seeded bug)"), not `ad97bc8d`. Another agent shares `/Users/austinho/dev/fixtures/anything-llm` and had checked that branch out. The fixture reflog shows it moved back to `master` (`ad97bc8d`) afterwards. `build-gates.json → source.commit` records `3a8fcfb5…`. The harness at the time checked only that the tree was clean, not which commit it was on.
- Because of this, the harness gained `--expect-commit` and a check that the commit did not change during the run (`source.commit_unchanged`). The valid run is `../g2-anything-llm-2026-09-23-bridgeoff/` (`--expect-commit ad97bc8d`, commit unchanged).
- All six write requests in this run returned 200.

Raw rows: `*.jsonl.gz`; sha256 and row counts in `RAW-SHA256.txt`.
