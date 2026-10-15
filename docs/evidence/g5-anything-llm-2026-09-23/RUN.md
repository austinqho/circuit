# G5 on anything-llm (2026-09-23): Part A, the automated rehearsal

Gate: `docs/gates/G5-demo.md` (§5 Part A, §6 grader, §10 amendments). Tracer branch `g5-demo`; the package was packed from the clean worktree at commit `03a22a0b` (only the `node_modules` symlink untracked). Headless Playwright 1.62.1 (Chromium). No model anywhere. Ports 4100 (static + capture + API proxy), 4101 (fixture Express server), 4102 (`producttrace-collector`).

## Result

Rehearsal (`REHEARSAL.md`, `rehearsal.json`): **7/7 PASS** (A1–A6, A7a). Grader (`GRADE-g5.md`, `test/g5-grader.mjs`, imports nothing from `analysis/`, `collector/`, `mcp/`): **22/22 PASS**. A7b (fixture restored): PASS, below. Not reached: the Codex IAB clause (Part B, `docs/G5-RUNBOOK.md`, Austin's run).

What the agent got back for "why did this fail?" on the *Update Workspace* button (`AGENT-READS.md`, verbatim fields in `mcp-transcript.json`):

| | value |
|---|---|
| key read from the live DOM | `p_f067e70e6029:117-485#n1` (via `closest('[data-tracer-el]')` from Codex's pick, the button's inner `<div>`) |
| component, file:line | `CTAButton`, `frontend/src/components/lib/CTAButton/index.jsx:8` (confidence `exact`) |
| entry handler | `frontend/src/pages/WorkspaceSettings/GeneralAppearance/index.jsx:26` (`handleUpdate`, the form's `onSubmit`) |
| attempt 1 (newest) `action:muebdejl:146` | `POST /api/workspace/tracer-g5/update` → route `/api/workspace/:slug/update` **200** → handlers validatedRequest, anonymous, anonymous; stopped at handler |
| attempt 2 `action:muebdcw1:108` | same request and route → **422**; stopped at handler / because "server responded 422; no database span descends from the admitted handler span" |
| attempt 3 (oldest) `action:muebdb7w:68` | same → **200**; stopped at handler |
| no-key fallback | `ambiguous`, 3 candidate targets, the right key among them, no pick |

## Commands

```sh
# fixture: throwaway branch with the G6 seed (fixture-seed.patch), clean tree
git -C /Users/austinho/dev/fixtures/anything-llm checkout -b g5-scenario
git -C /Users/austinho/dev/fixtures/anything-llm -c user.name=g5 -c user.email=g5@local am fixture-seed.patch   # → 825280d8

# Part A (runs build-fresh-repo.mjs, then the MCP client phase, banks the store, removes it from the fixture)
node test/browser/g5-rehearsal.mjs --repo /Users/austinho/dev/fixtures/anything-llm \
  --out docs/evidence/g5-anything-llm-2026-09-23 --port 4100

# restore the fixture
git -C /Users/austinho/dev/fixtures/anything-llm checkout master
git -C /Users/austinho/dev/fixtures/anything-llm branch -D g5-scenario

# independent recompute (fixture at ad97bc8d; the frontend files are unchanged by the seed)
node test/g5-grader.mjs docs/evidence/g5-anything-llm-2026-09-23 \
  --source-root /Users/austinho/dev/fixtures/anything-llm --out docs/evidence/g5-anything-llm-2026-09-23/GRADE-g5.md
```

The exact harness command the rehearsal ran is in `harness-command.txt`; its log is `harness.log`. The MCP server was the tarball's own `producttrace-mcp`: `node <work>/install/node_modules/producttrace/mcp/server.mjs --store /Users/austinho/dev/fixtures/anything-llm/.tracer --source-root /Users/austinho/dev/fixtures/anything-llm` (recorded in `mcp-transcript.json` `server`).

## Install (one plugin line, zero source edits)

- Tarball `producttrace-0.1.0.tgz`, 149 files, integrity `sha512-xRwXlinnpkztd2hvC6ZaoAHEZePf1kvsxR/0QQG7b/GLChGtmdEHmicq5vQABqh0TXHAyKL6uVoFNiJOml+t8A==` (`run/build-gates.json` `package`). Extracted into a consumer directory outside the fixture; dependencies linked from this checkout (no network).
- The line, in a generated wrapper around the fixture's unchanged `frontend/vite.config.js` (`run/build-gates.json` `install.plugin_line`):
  `...producttrace({"stamps":true,"requestBridge":false,"collector":"http://127.0.0.1:4102"})`
- Builds (Vite 4.5.3): disabled 11.7 s, enabled 153.4 s.

## Gates of this run (`run/build-gates.json`, `run/coverage.json`)

| gate | value |
|---|---|
| tracked source clean before/after (store path `.tracer` excluded) | yes / yes; unfiltered after: `?? .tracer/` |
| marker gate | 5,101 = 5,101, 0 missing, 0 unmanifested |
| parity (landing body, Tracer's own attributes removed; control identical) | pass, 115 lines, 49 stamped elements on the enabled page |
| runtime smoke | ok |
| capture lossless (harness `/__capture`) | yes: 3,262 rows, 1 page, `sequence` 1..3,142 and `stamp_sequence` 1..120 contiguous, 0 gaps, 0 drops |
| transports wrapper = Playwright | 41 = 41, carried by the runtime wrappers (`requestBridge: false`) |
| collector sink (page → `http://127.0.0.1:4102/ingest`) | received 3,262, sent 3,262, 37 batches, 1 retry, 0 dropped, 0 by beacon |
| span relay (harness → collector `/spans`) | 465 sent, 0 failed (348 earlier spans from the parity/smoke page loads precede the collector and are not in the store) |
| store = harness capture | per kind equal (dom.action 151, dom.mutation 86, element.stamp 120, function.enter 1,432, function.exit 1,432, network.request 41), 0 missing, 0 extra; spans 465 = 465; run row written; collector exit 0 |
| scripted steps | 7/7 done; Playwright-observed statuses of the three submits 200, 422, 200 (`run/attempts.json`) |

## Fixture state

| when | HEAD | branch | `git status --porcelain` | file |
|---|---|---|---|---|
| before the run | `825280d8069dbd7d4d442f93b140ba844dd7e4a0` (= `ad97bc8d` + seed; `server/endpoints/workspaces.js` +6 lines) | `g5-scenario` | empty | `fixture-state-before.json` |
| after the run (store removed) | `825280d8…` | `g5-scenario` | empty | `fixture-state-after-run.json` |
| restored | `ad97bc8dfcb6919f34f7d6d0c722efdda64d66d9` | `master` | **empty**; `git diff ad97bc8d` empty; branch `g5-scenario` deleted; no `.tracer/` | `fixture-state-restored.json` |

The seed commit's subject still reads "G6 seed …" because it is the G6 patch 1/5 applied unchanged (`fixture-seed.patch`).

## Raw rows

The store `/Users/austinho/dev/fixtures/anything-llm/.tracer` was written only by `producttrace-collector --store` (run `run-20260923t162457776z-a10d62`, build `e061322a6809`, label `g5-demo`), copied here gzipped, then deleted from the fixture (`store-files.json`):

| file | raw bytes | rows | raw sha256 |
|---|---|---|---|
| `store/records.jsonl.gz` | 3,490,211 | 3,262 | `f6731a8de462db9aab9b69eca3e8b8f1c37829a639dfca41831cbff5edf21584` |
| `store/spans.jsonl.gz` | 315,837 | 465 | `bf92061225bb02ec2fccbf44ce20b107a887efd7521a813075b434111bcd5c97` |
| `store/runs.jsonl.gz` | 272 | 1 | `b322874e79ec13ac173c2a7d5e2576861e816c450daddc0db8583cb8bd17b206` |
| `store/manifests/e061322a6809.json.gz` | 4,131,155 | 5,101 functions | `a2530bc7d89f8e55effe2a5ce5efc9620c63d99043b3ab96625f8d34e6a69bc0` |

The harness's own capture (`run/records.jsonl.gz`, `run/spans.jsonl.gz`, `run/joined-backend.jsonl.gz`, `run/attribution-manifest.json.gz`) is listed with raw sha256 and line counts in `RAW-SHA256.txt`. `run/spans.jsonl` has 813 spans: the 465 in the store plus 348 from the parity and smoke page loads. No file exceeded 20 MB; everything jsonl is gzipped anyway because `*.jsonl` is gitignored.

Reproduce the MCP answers from this directory: gunzip `store/*.gz` and `store/manifests/*.gz` into a directory, check out the fixture at `ad97bc8d`, then `node test/browser/g5-rehearsal.mjs --mcp-only --run-dir docs/evidence/g5-anything-llm-2026-09-23/run --store <dir> --source-root <fixture> --out <scratch> --server mcp/server.mjs`.

## Files

- `REHEARSAL.md`, `rehearsal.json`: the seven assertions with details.
- `mcp-transcript.json`: every JSON-RPC line with `producttrace-mcp`, in order (initialize, tools/list, resolve_element, element_history, action_chain, fallback resolve_element).
- `AGENT-READS.md`: the one-page "what the agent reads" rendering.
- `GRADE-g5.md`: the grader's output.
- `run/annotation-prompt.txt`: the prompt block Codex's manual annotation would produce; `run/annotation-anchor.json`: the anchor, the pointer, the ground truth and the skill-step lookup result; `run/annotated-element.html`: the picked element's and the stamped element's `outerHTML` (with `data-tracer-el`).
- Screenshots: `run/step-04-rename-attempt-1.png` (200, "Workspace updated!"), `run/step-05-rename-attempt-2.png` (422, "Error: Invalid workspace name."), `run/step-06-rename-attempt-3.png` (200), `run/annotate-page.png` and `run/annotate-element.png` (the button being annotated), plus steps 1–3 and 7.
- `fixture-seed.patch`, `fixture-state-*.json`, `harness-command.txt`, `harness.log`, `run/backend.log`, `run/build-*.log`.
