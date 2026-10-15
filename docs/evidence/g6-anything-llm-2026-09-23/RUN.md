# G6 verification on anything-llm (2026-09-23)

Gate: `docs/gates/G6-verification.md`. Tracer branch `g6-verification`. The package code that produced this evidence is commit `accab8bf` plus the uncommitted harness `--store` wiring and the `compare_chains` detail wording, all committed together with this directory. The harness installs Tracer from its own `npm pack` tarball on every run.

Fixture: `/Users/austinho/dev/fixtures/anything-llm` at `ad97bc8dfcb6919f34f7d6d0c722efdda64d66d9`. Headless Playwright 1.62.1 (Chromium). No LLM key; non-chat flows only. Ports 4100 (static + capture + API proxy) and 4101 (fixture Express server).

## Result

| pair | `path_changed` | reasons | entry handler | outcome delta | gate |
|---|---|---|---|---|---|
| A-baseline → B-seeded-422 | **true** | route, outcome | same | http_status 200 → 422 | pass |
| B-seeded-422 → C-fix-r2 | **true** | route, outcome | same | http_status 422 → 200 | pass |
| A-baseline → C-fix-r2 | false | none | same | none | pass |
| A-baseline → D-noop-refactor | false | none | `source_revision` via `manifest_remap` (931:1488 → 931:1497, position 4 of 4 functions in the file, reverse remap agrees) | none | pass |
| A-baseline → E-frontend-early-return | **true** | request, route, handler, outcome | `source_revision` via `manifest_remap` | stage, http_status 200 → null, stop_reason, stopped_at handler → validation | pass (stretch) |
| B-seeded-422 → C-fix (control, see "Operator error") | false | none | same | none | replay determinism |

The independent grader (`test/g6-grader.mjs`, which imports nothing from `analysis/`, `collector/` or `mcp/`) recomputes every row from the raw store: 6/6 pairs PASS (`GRADE-g6.md`). Each `compare_chains` result, exactly as the MCP stdio server returned it, is in `compare/*.json`. The agent-facing rendering is in `AGENT-READS.md`.

## Commands

For each label, in order, the fixture was set to the commit below and this was run:
```
node test/browser/build-fresh-repo.mjs --repo /Users/austinho/dev/fixtures/anything-llm \
  --session test/browser/sessions/anything-llm.mjs \
  --out docs/evidence/g6-anything-llm-2026-09-23/runs/<label> --port 4100 \
  --store /Users/austinho/dev/fixtures/anything-llm/.tracer --label <label>
```
After restoring the fixture to `ad97bc8d` (so `--source-root` resolves the baseline's lines), and with the store still in the fixture:
```
node test/browser/g6-compare.mjs --store /Users/austinho/dev/fixtures/anything-llm/.tracer \
  --source-root /Users/austinho/dev/fixtures/anything-llm --out docs/evidence/g6-anything-llm-2026-09-23 \
  --pair A-baseline:B-seeded-422 --pair B-seeded-422:C-fix-r2 --pair A-baseline:C-fix-r2 \
  --pair A-baseline:D-noop-refactor --pair A-baseline:E-frontend-early-return --pair B-seeded-422:C-fix
node test/g6-grader.mjs docs/evidence/g6-anything-llm-2026-09-23/store \
  --compare docs/evidence/g6-anything-llm-2026-09-23 --out docs/evidence/g6-anything-llm-2026-09-23/GRADE-g6.md
```
`g6-compare.mjs` starts `mcp/server.mjs --store <dir> --source-root <fixture>` over stdio, the same as `producttrace-mcp --store`. It calls `compare_chains` and `action_chain` as an MCP client.

Reproduction from this directory: gunzip `store/*.jsonl.gz` and `store/manifests/*.json.gz` into a directory (same names without `.gz`), then rerun `g6-compare.mjs` against it. This was done once after the store was copied here: all 6 compare results and `index.json` were identical to the committed ones, ignoring the `store` stats block and the server argument paths.

## Fixture changes, step by step

All changes were made on the throwaway branch `g6-scenario` (created from `ad97bc8d`), one commit each, because the harness refuses a dirty tree. The full patch series is in `fixture-scenario.patch`; commit ids and subjects are in `fixture-commits.txt`.

| run label | fixture HEAD | tree vs `ad97bc8d` | frontend build id |
|---|---|---|---|
| A-baseline | `ad97bc8d` | identical | `b-2dc9ecff4d63b25e` |
| B-seeded-422 | `8bc8ae75` | + seed (below) | `b-2dc9ecff4d63b25e` |
| C-fix | `8bc8ae75` | + seed (**not reverted**, see below) | `b-2dc9ecff4d63b25e` |
| C-fix-r2 | `719f1768` (revert of `8bc8ae75`) | identical (`git diff ad97bc8d HEAD` empty) | `b-2dc9ecff4d63b25e` |
| D-noop-refactor | `857ab360` | + rename (below) | `b-a33d446fe91e8701` |
| E-frontend-early-return | `879685d1` (after `8e11b8f1`, the revert of `857ab360`; tree diff was empty before this commit) | + early return (below) | `b-492209beb3a2e901` |

B, the seeded backend bug (`server/endpoints/workspaces.js`, update handler):
```diff
         const data = reqBody(request);
+        if (typeof data?.name === "string" && /\s/.test(data.name)) {
+          response
+            .status(422)
+            .json({ workspace: null, message: "Invalid workspace name." });
+          return;
+        }
         const currWorkspace = multiUserMode(response)
```
C, the agent's fix: `git revert 8bc8ae75`.

D, the no-op refactor (`frontend/src/pages/WorkspaceSettings/GeneralAppearance/index.jsx`, inside `handleUpdate`):
```diff
-    const data = {};
+    const payload = {};
     const form = new FormData(formEl.current);
-    for (var [key, value] of form.entries()) data[key] = castToType(key, value);
+    for (var [key, value] of form.entries()) payload[key] = castToType(key, value);
     const { workspace: updatedWorkspace, message } = await Workspace.update(
       workspace.slug,
-      data
+      payload
     );
```
E, the frontend bug (same file, after `git revert 857ab360`):
```diff
     for (var [key, value] of form.entries()) data[key] = castToType(key, value);
+    if (/\s/.test(String(data.name ?? ""))) return;
     const { workspace: updatedWorkspace, message } = await Workspace.update(
```

### Operator error: run `C-fix` was not a fix
The first attempt at step C ran `git revert --no-edit HEAD -q`. `git revert` rejects `-q`, so it printed usage and changed nothing, and the chained harness run went ahead at the seed commit `8bc8ae75`. So the run labelled `C-fix` is a second replay of B, and its own `runs.jsonl` row says so (`source.commit = 8bc8ae75…`). The store is append-only, so it stays. It is used only as a replay-determinism control: `compare_chains(B, C-fix)` gives `path_changed: false`, as the grader expects. The real fix run is `C-fix-r2`, made after a successful revert (`719f1768`, tree identical to `ad97bc8d`). Every "fix" verdict above uses `C-fix-r2`.

## Per-run gates (from `runs/<label>/build-gates.json`, `coverage.json`, `store-run.json`)

| run | fixture | build | run_id | source clean (tracked, `.tracer` excluded) | marker gate | parity | smoke | capture lossless (rows) | transports wrapper = Playwright | steps | store rows / spans |
|---|---|---|---|---|---|---|---|---|---|---|---|
| A-baseline | ad97bc8d | b-2dc9ecff4d63b25e | run-20260923t130550436z-c45798 | yes | 5,101 = 5,101 | pass | ok | yes (6,729) | 71 = 71 | 8/8 | 6,729 / 1,156 |
| B-seeded-422 | 8bc8ae75 | b-2dc9ecff4d63b25e | run-20260923t130846609z-81efcd | yes | 5,101 = 5,101 | pass | ok | yes (6,731) | 71 = 71 | 8/8 | 6,731 / 1,156 |
| C-fix | 8bc8ae75 | b-2dc9ecff4d63b25e | run-20260923t131129601z-4c9b91 | yes | 5,101 = 5,101 | pass | ok | yes (6,730) | 71 = 71 | 8/8 | 6,730 / 1,156 |
| C-fix-r2 | 719f1768 | b-2dc9ecff4d63b25e | run-20260923t131403619z-eb5304 | yes | 5,101 = 5,101 | pass | ok | yes (6,728) | 71 = 71 | 8/8 | 6,728 / 1,156 |
| D-noop-refactor | 857ab360 | b-a33d446fe91e8701 | run-20260923t131636313z-2d7ae5 | yes | 5,101 = 5,101 | pass | ok | yes (6,769) | 71 = 71 | 8/8 | 6,769 / 1,156 |
| E-frontend-early-return | 879685d1 | b-492209beb3a2e901 | run-20260923t131912210z-854780 | yes | 5,101 = 5,101 | pass | ok | yes (6,704) | 70 = 70 (the update request is not sent) | 8/8 | 6,704 / 1,144 |

The unfiltered `git status --porcelain` after each run was exactly `?? .tracer/` (recorded as `unfiltered_status_after`).

## The selected action per run

Harness rule: the unique `dom.action` with `event: "submit"`, the run's `tracer_run`, and a timestamp inside the `rename-workspace` step window from `runs.jsonl`.

| run | action_id |
|---|---|
| A-baseline | `action:mue48zaw:65` |
| B-seeded-422 | `action:mue4cr85:65` |
| C-fix | `action:mue4g90c:65` |
| C-fix-r2 | `action:mue4jjss:65` |
| D-noop-refactor | `action:mue4mtmf:65` |
| E-frontend-early-return | `action:mue4q5xu:65` |

## Raw rows (the `.tracer/` store, copied here gzipped)

The store was `/Users/austinho/dev/fixtures/anything-llm/.tracer` (88 MB uncompressed). It was copied here, then deleted from the fixture.

| file | rows / functions | sha256 of uncompressed | sha256 of `.gz` |
|---|---|---|---|
| `store/records.jsonl.gz` | 40,391 rows | `ffe3ad93f5c86f93ea9669c6f02ace6a5f2dd4722041d6aa1dd196af7458c74a` | `15e71b921f907129b1c5347d8baa367e4ea28886790a5e68e430585efdf4663b` |
| `store/spans.jsonl.gz` | 6,924 rows | `24de1afb9659230b33f3a1a97ad7c08566617576de5922dc465ad6e06c9f681d` | `f01b095e6d0f1f55948d3271c1ceec595aec780ff06c03025059f7a4ae9c3c4e` |
| `store/runs.jsonl.gz` | 6 rows | `b56298b18659686e99a40fb678e2868e0ab5a83013cc4cb70720b7874140f556` | `367424b2bd4eac311ac60ab4f056bf5df0a2ba74a1a92057e3e42e1edf7e8821` |
| `store/manifests/b-2dc9ecff4d63b25e.json.gz` | 5,101 functions | `5b6276ce40e227dd936b56273df3af5e631720ddc6867c1030fa225664e403a9` | `1bbc8d7bc55b05250731a5db4cfaa86103087f5afa0b54db5c030471196f969a` |
| `store/manifests/b-a33d446fe91e8701.json.gz` | 5,101 functions | `74c0998cf6e4c37975653516f9b29b62be86281c30fe9794e92f5ca8c0210c58` | `8cba554484d612c0ebcd43c0eae259cb883ac7c907ab8b8f7f6e8bebca5391bc` |
| `store/manifests/b-492209beb3a2e901.json.gz` | 5,101 functions | `7157967cc23a7f4cd88a4283969474f9e1762b3b069152c3d6def26c587c5970` | `22940158b4a2bb61bb41831c5a6587c5b22b0c9544ee8d32f7b83b6e11bcbd30` |

The per-run harness directories (`runs/<label>/`) originally also held `records.jsonl`, `spans.jsonl` and `joined-backend.jsonl`. Before deletion, each run's records and spans were checked against the store's rows for that `tracer_run`, with the two tags removed and keys sorted: identical in all six runs. They were then deleted as duplicates. `joined-backend.jsonl` is derived. Each run's own `attribution-manifest.json` (with `generated` paths and that bundle's `index` values) is kept gzipped. For A/B/C it has the same `(id, kind, source)` set as the store manifest of that build.

## Restoration proof (after the last run, store copied out)
```
$ git -C /Users/austinho/dev/fixtures/anything-llm checkout master && git branch -D g6-scenario
Deleted branch g6-scenario (was 879685d).
$ rm -rf /Users/austinho/dev/fixtures/anything-llm/.tracer
$ git -C /Users/austinho/dev/fixtures/anything-llm status --porcelain | wc -l
0
$ git -C /Users/austinho/dev/fixtures/anything-llm rev-parse HEAD
ad97bc8dfcb6919f34f7d6d0c722efdda64d66d9
$ git -C /Users/austinho/dev/fixtures/anything-llm branch --list
* master
```
The harness scratch dirs (`/Users/austinho/dev/fixtures/.g2-work/anything-llm-*`, the installed tarballs) were deleted. The fixture's git-ignored runtime files (`server/storage/anythingllm.db`, `frontend/node_modules/.producttrace/`) are rewritten on every run, as in G2.

## Environment note (worktree test failure, fixed before any code)

`npm test` in this worktree first showed 564/566. The extra failure was `test/installed-package.test.mjs` "npm-packed tarball installs and exposes the Vite plugins", with `ENOENT … /Users/austinho/dev/tracer/node_modules/@modelcontextprotocol`. The worktree's `node_modules` symlink pointed at `/Users/austinho/dev/tracer/node_modules`. That checkout is on the older `m1-runtime-attribution` branch and lacks the G4 dependency `@modelcontextprotocol/sdk`. The test links every `package.json` dependency from `node_modules`, so it failed. The symlink was repointed to the main checkout's `/Users/austinho/dev/trace-consolidated-clean/node_modules`, which has the dependency. After that: 565/566 (the known `react-context-ref-semantics` failure only). The symlink is untracked; no test was changed.
