# G2 anything-llm, bridge off + stamps on

Headless, scripted, no LLM key. The session is the same 8 steps as `g2-anything-llm-2026-09-23-r3` (bridge on, graded).

- Tracer: worktree `/Users/austinho/dev/tracer-g2b`, branch `g2-bridge-off` from main `da8575e7` (G1+G3). `npm run build` was run first. The run used harness commit `7cf682b3`; package code is unchanged from main. It was installed from its own `npm pack` tarball (147 files, integrity `sha512-j2wFSzkL…MukpZw==`).
- The one plugin line: `...producttrace({"requestBridge":false,"stamps":true})`. The wrapper config is banked as `wrapper-vite.config.mjs`.
- Fixture: `anything-llm@ad97bc8dfcb6919f34f7d6d0c722efdda64d66d9`. Run with `--expect-commit ad97bc8d`. The commit was unchanged at the end (`build-gates.json → source.commit_unchanged: true`) and the tree was clean before and after. An earlier attempt built another agent's `g5-scenario` branch; see `../g2-anything-llm-2026-09-23-bridgeoff-invalid/`.
- Command: `node test/browser/build-fresh-repo.mjs --repo /Users/austinho/dev/fixtures/anything-llm --session test/browser/sessions/anything-llm.mjs --out docs/evidence/g2-anything-llm-2026-09-23-bridgeoff --port 4100 --plugin-options '{"requestBridge":false,"stamps":true}' --expect-commit ad97bc8d`
- Environment: React 18.3.1, Vite 4.5.3, Playwright 1.62.1 Chromium headless shell. Backend adapters `http,express`, using the Node 26 `SlowBuffer` shim (harness only).

## Gates

| gate | result |
|---|---|
| source byte-identical, commit pinned | pass |
| marker gate (AST over served JS) | 5,101 = 5,101 (4,934 framed, 167 proxies), 0 missing, 0 unmanifested |
| parity (landing body DOM; `data-tracer-el`/`oai-*` removed) | pass, 115 lines; control identical |
| smoke | pass |
| **served transport** | no `producttrace-request-bridge*` asset, `index.html` does not reference one, runtime wrappers inlined. On the page, `fetch.name === 'productTraceRuntimeFetch'`, `XMLHttpRequest.prototype.send.name === 'productTraceRuntimeSend'`, and no `__productTraceAutonomousBridge` |
| **requests: runtime wrappers vs Playwright** | 71 = 71, reconciliation 0 (`observed-requests.json` now kept) |
| **capture** | drained (queue 0). Page 1: `sequence` 1..1645 and `stamp_sequence` 1..140. Page 2 (after the Delete Workspace reload): 1..19 and 1..52. 0 dropped, 0 gaps. Live page emitted 71 = received 71 |
| `capture.limit` rows | none (React 18.3.1 dispatcher found) |

## Handler credits (amended categories; independent grade in `GRADE.md`)

| | bridge on (r3, graded) | bridge off (this run) |
|---|---|---|
| correct | 23 | **23** (12 distinct functions) |
| unrooted_global | 19 | **0** |
| abstained at `entry_handler` (none, justified) | 0 | **10**: 9 step-2 keystrokes (only Ctrl+M / shortcut / sidebar window listeners ran); 1 click on the workspace-name input (document listeners ran) |
| wrong / misses | 0 / 0 | **0 / 0** |

All 6 writes (create workspace, new thread, rename thread, delete thread, rename workspace, delete workspace) are credited to the same developer-named handlers as r3. Each is joined exactly to its route and handler span. Each stops at the handler because Prisma/SQLite is not instrumented.

## Requests

27 attributed (7 `direct`, 18 `mount_effect`, 2 `state_effect`), all joined exactly to one server span (27/27). 44 unattributed:
- **22 are page loads**: 11 on each page before its first action.
- **22 are in-session follow-up GETs that the bridge-on run attributed and this run does not.** They cluster at three navigations: create workspace, new thread, delete thread. The chat-history effect (`frontend/src/components/WorkspaceChat/index.jsx:52-72`) re-runs without an owning action: in step 2 through `setWorkspace` after an `await Promise.all(…)`, in steps 3 and 5 through the react-router location change after `navigate()`. Everything it mounts is unowned too (parsed-files, model-picker `bySlug` + `/setup-complete`, document-processing-status). This is the state-update/async-continuation frontier on this repo; see LIMITS.md.

## Stamps (G3 two-repo clause)

- Interactive hosts (G3 T4 list) carrying `data-tracer-el`, summed over the 8 post-step snapshots: **190/190** (visible: 184/184). The landing page has 49 stamped elements.
- 192 `element.stamp` rows, 140 keys, 132 placements. All **132/132** placements verify against source: file hash matches, `<tag` at start, line correct, `>` before end.
- 10 acted-on keys resolved to file:line in `STAMPS.md` (10/10 verified). The grader independently verified 12/12 acted-on keys.
- On shared primitives the key resolves to the element's own JSX. When a different outer placement binds the handler, the stamp row carries that call site as `binding_placement`, e.g. `ThreadContainer/index.jsx:214` → binding `:183`.
- 67 of 68 `dom.action` rows carry `target.element_key`.

## Findings

- **Stale listener ownership (record level).** 67 `function.enter` rows from window/document listeners fire during a later dispatch but carry the action that was active when the listener was registered. Example: the step-7 keydown listeners carry the step-6 click. No credit or request attribution changed, because these frames are never depth 0. But the 9 step-7 keydowns then read "no first-party function entered" instead of an `entry_handler` abstention, and the step-2 abstention's global-listener list omits `useModalEscape`. Bulletproof has 9 rows of the same shape, all legitimate request continuations. This is a defect of the runtime's owned-listener rule on this repo only, so no package change was made.

Raw rows: `records.jsonl.gz`, `stamps.jsonl.gz`, `spans.jsonl.gz`, `joined-backend.jsonl.gz`; sha256 and rows in `RAW-SHA256.txt` (records 1,664, stamps 192, spans 1,156). Tables: `ACTIONS.md`, `summary.json`, `STAMPS.md`, `stamp-check.json`.
