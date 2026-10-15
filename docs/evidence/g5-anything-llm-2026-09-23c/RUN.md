# G5 rehearsal after the rebase onto main `da8575e7` (2026-09-23c)

Same scenario and fixture seed as `docs/evidence/g5-anything-llm-2026-09-23/RUN.md`. The package was packed from the working tree at `c36b1740`, i.e. `g5-demo` rebased onto `main` (`da8575e7`, tag `g1g3`), plus the `--work-root` option in `test/browser/g5-rehearsal.mjs`, which is committed with this evidence. Main brings creation-time action context, receipts with value comparison, the React 19 dispatcher and the `stopped_at: "entry_handler"` frontier.

```sh
git -C /Users/austinho/dev/fixtures/anything-llm checkout -b g5-scenario
git -C /Users/austinho/dev/fixtures/anything-llm -c user.name=g5 -c user.email=g5@local am docs/evidence/g5-anything-llm-2026-09-23/fixture-seed.patch   # → 3a8fcfb5 (same patch; the hash differs by commit time)
mkdir -p /Users/austinho/dev/fixtures/.g5-work
node test/browser/g5-rehearsal.mjs --repo /Users/austinho/dev/fixtures/anything-llm --out docs/evidence/g5-anything-llm-2026-09-23c --port 4100 --work-root /Users/austinho/dev/fixtures/.g5-work
git -C /Users/austinho/dev/fixtures/anything-llm checkout master && git -C /Users/austinho/dev/fixtures/anything-llm branch -D g5-scenario
node test/g5-grader.mjs docs/evidence/g5-anything-llm-2026-09-23c --source-root /Users/austinho/dev/fixtures/anything-llm --out docs/evidence/g5-anything-llm-2026-09-23c/GRADE-g5.md
```

The first two attempts without `--work-root` failed with ENOENT on `.g2-work/g5-*/dist-disabled`. At the same time, another session's `build-fresh-repo.mjs` run (bulletproof-react) recreated `/Users/austinho/dev/fixtures/.g2-work` twice, which removed this run's build output between the two builds. Those attempts left no evidence and are not part of this directory.

## Result

- Rehearsal: 7/7 PASS (`REHEARSAL.md`).
- Grader: 22/22 PASS (`GRADE-g5.md`).
- The answers equal the `23b` run:
  - key `p_f067e70e6029:117-485#n1`, `CTAButton/index.jsx:8`;
  - entry handler `GeneralAppearance/index.jsx:26` for all three attempts;
  - attempts, newest first: `…object%3A41#3` 200, `#2` 422, `…object%3A41` 200;
  - each stops at `handler`, "no database span descends from the admitted handler span", with the 422 prefixed "server responded 422;".
- **Generated wrapper config** is saved as `run/vite.g2.config.mjs` (sha256 `47a1c21066278ce4ea8e996e2e5d1c355dec7edf8d58d459e6a0455750e5172d`). Its plugin line is `...producttrace({"stamps":true,"requestBridge":false,"collector":{"url":"http://127.0.0.1:4102","force":true}})`.
- **Store run row**: source commit `3a8fcfb5e38e40397804457f2db119f87dea9f0e` (clean), seven steps, 2,644 records, 465 spans.

## Items asked for

- **`capture.limit` rows: none.** anything-llm's installed React is 18.3.1 (`frontend/node_modules/react/package.json`). The runtime found the React 16-18 dispatcher (`currentDispatcherRef.current`), so it wrote no `state_receipts` limit row and logged no warning.
- **`stopped_at: "entry_handler"`: nowhere.**
  - It is not in any tool result in `mcp-transcript.json`.
  - Over all 151 actions in the store, `action_chain` frontiers are `handler` for 144 and `dom_mutation` for 7. So none of this scenario's actions was a no-element-bound-handler abstention.
  - The string "entry_handler" appears in the transcript only as the `entry_handler` field.
- **Record counts vs `23b`** (same scenario, pre-rebase engine):

  | kind | 23b | 23c |
  |---|---|---|
  | `function.enter` / `function.exit` | 1,452 each | 1,123 each |
  | `element.stamp` | 120 | 119 |

  `dom.action` (151), `dom.mutation` (87) and `network.request` (41) are equal. The answers are unaffected. I did not trace which change on main reduces function rows.

## Gates

| gate | result |
|---|---|
| store = harness capture | 0 missing, 0 extra; spans 465 = 465 |
| sink | received 2,644, sent 2,644, 0 retries, 0 dropped, 0 malformed |
| store stats | malformed_records 0, dropped_in_page 0 |
| build gates | marker, parity and smoke pass (`run/build-gates.json`) |
| tarball | `producttrace-0.1.0.tgz`, 149 files, integrity `sha512-A2AbdLgXRNr2wHGyBKpIab0pfJ8O+29AwjuufI1fztLGc5WfqT3UdZs7oxmsfjvUIgHWnQQNxX3IKnrzcDObPQ==` |
| fixture restored | `ad97bc8d` on `master`; empty `git status --porcelain`; empty diff; branch deleted (`fixture-state-restored.json`) |

Raw rows: `store-files.json` and `RAW-SHA256.txt` (the run's `records.jsonl`, `spans.jsonl`, `joined-backend.jsonl` and `attribution-manifest.json` are gzipped; the hashes are of the raw files).

## Limits

`docs/evidence/g5-anything-llm-2026-09-23/LIMITS.md` applies, with the changes noted in `../g5-anything-llm-2026-09-23b/RUN.md`.
