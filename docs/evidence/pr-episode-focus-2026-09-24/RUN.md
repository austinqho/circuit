# fix/episode-focus: run record (2026-09-24)

Claim: a focus that happens as part of one action's work belongs to that action, and an episode member never prints the carrier's chain. Rules: `docs/gates/G5-demo.md` §16; vocabulary: `docs/gates/G4-mcp.md` (amendment before §3.2). Branch `fix/episode-focus`, based on `main` at tag `fixes-2026-09-24` (8a84cfee). The implementer wrote this file; it is not a grade.

## What was built

- **Runtime** (`src/runtime-attribution-browser.js`, `dist/` byte-identical): `beginDomAction` settles the ambient frame before pushing the new action frame. For `focusin` (and `focus`), a live frame with an action and no scheduler lineage adds `gesture: false`, `caused_by_action_id`, `caused_by_continuation_id` and `caused_via` (the frame's root kind). A scheduler-lineage frame or a frame without an action adds `gesture: false`, `caused_by_action_id: null`, `cause_abstained`. No frame: no fields. Every other row is unchanged.
- **Episodes** (`indexWorkflowEpisodes`): a `gesture: false` focus is never a form member, never a fold source, is skipped when finding the next action on a control, never starts an episode; it is listed on the causing action's episode as `caused` / `caused_action_ids` (not `action_ids`).
- **MCP / store** (`chainForAction`, `chainStops`): a non-carrier member's chain is built over its own rows by the same assembler, plus `episode_member`, `episode_carrier_action_id`, `episode_pointer`; `element_history.attempts` use the episode view (unchanged). A caused focus's chain names its cause.
- **Fixture and driver**: `test/browser/fixtures/episode-focus-app/main.jsx`, `test/browser/episode-focus.mjs` (headless Playwright, MCP over stdio). Synthetic `test/episode-focus.test.mjs` under `npm test`.

## Commands and counts

```sh
cd /Users/austinho/dev/tracer-n1-episode-focus
npm run build && cmp src/runtime-attribution-browser.js dist/runtime-attribution-browser.js   # identical
node test/browser/episode-focus.mjs --out docs/evidence/pr-episode-focus-2026-09-24/runs    # status ok, 3 runs, stable
npm test                                                                                      # 693/694; 1 known failure (react-context-ref-semantics)
node test/g4-grader.mjs docs/evidence/m1-2026-09-22-final7 --manifest docs/evidence/g4-mcp-2026-09-23/manifest.json   # 81/81 (g4-grade.md)
node test/browser/d12-stamp-neutrality.mjs                                                    # pass, 17/17 checks
node test/browser/continuations-neutral.mjs                                                   # ok (5 runs)
node test/browser/no-cross-control-neutral.mjs                                                # ok
# G6: store gunzipped to a scratch dir, compare rerun with this branch and with main, then graded
node test/browser/g6-compare.mjs --store <scratch>/g6store --source-root /Users/austinho/dev/fixtures/anything-llm --out <scratch>/g6cmp-new \
  --pair A-baseline:B-seeded-422 --pair B-seeded-422:C-fix-r2 --pair A-baseline:C-fix-r2 --pair A-baseline:D-noop-refactor --pair A-baseline:E-frontend-early-return --pair B-seeded-422:C-fix
node test/g6-grader.mjs <scratch>/g6store --compare <scratch>/g6cmp-new                    # Overall: PASS (6/6 pairs) (g6-grade.md)
```

Also run: `effect-rooted-form-neutral`, `shadow-dom-context`, `stable-element-keys`, `worker-frontier` (all exit 0). `unlinked-coverage-neutral` 12/13: A8 expects `capture.page.worker: false`, stale since the worker PR; it fails identically on `main` at `fixes-2026-09-24`. `runtime-registration-neutral` needs a LibreChat worktree argument and was not run.

Worktree setup notes: `npm test` needs `evaluation/shared-rules/fixtures/node_modules` as a real copy (a symlink resolves outside the worktree and ten library-program tests then fail with `implementation_outside_installed_dependencies`); it was copied from the main checkout (22 MB, untracked).

### The driver, per run (`runs/report.json`, raw rows `runs/run-{1,2,3}.records.jsonl`, 109 rows each)

| case | focus → Enter | mark on the focus row | episode of the Enter | click-window chains mention the request |
|---|---|---|---|---|
| (a) autoFocus in a portal dialog | 504–531 ms | `caused_by` = click, `caused_via: microtask` | `[keydown:Enter]` | none |
| (b) `useEffect` + `ref.current.focus()` | 502–505 ms | `caused_by` = click, `caused_via: mount_effect` | `[keydown:Enter]` | none |
| (c) click handler calls `input.focus()` | 602–604 ms | `caused_by` = click, `caused_via: dispatch` | `[keydown:Enter]` | none |
| (d) Tab into input (control) | 302–303 ms | none | `[focusin, keydown:Enter]` (fold kept) | n/a; the member focus prints only the pointer |
| (f) dialog opened after a GET resolves (scheduler commit) + autoFocus | 518–521 ms | `caused_by: null`, `cause_abstained: scheduler_lineage` | `[keydown:Enter]` | none |

(e) Three runs on fresh pages: identical signature (episode events, caused lists, marks, request owners). Asserted per run from raw rows (marks, episode membership, one control or one form per episode, no caused focus as a member) and through the MCP (every action from the click up to the Enter: `action_chain` and `recent_actions` never mention the Enter's request; the Enter's chain carries it; the focus's chain names `caused_by_action_id` and `caused_by_episode_id`; the click's chain lists it under `caused`; the Tab member carries the exact `episode_pointer`, no request, no segments; `element_history` on the search input keeps one attempt carried by the Enter with the request).

### Before / after (`focus-chains-before-after.txt`, `tools/defect.mjs`)

`main`'s analysis on this branch's run-1 rows: `action_chain` for the focus in (a), (b), (c), (f) prints `/api/items/auto`, `/api/items/effect`, `/api/notes`, `DELETE /api/items/later`; the Tab focus in (d) prints `/api/search`. This branch: none. The driver itself fails on `main` at its first assertion (the focus row has no `gesture: false`). `test/episode-focus.test.mjs` fails 2/2 on `main`.

## Banked outputs under the new rule (`banked-diff.jsonl`, `tools/dump.mjs`, `tools/diff.mjs`)

Every action's `action_chain` and every element key's `element_history` were computed on four banked stores with `main` and with this branch.

| store | actions | episodes (identical?) | `action_chain` changed | all changed are non-carrier members | previously printed a carrier request | element keys, `attempts` changed |
|---|---|---|---|---|---|---|
| final7 | 54 | 46 (yes) | 0 | – | 0 | 35, 0 |
| g5-anything-llm-2026-09-23c | 151 | 9 (yes) | 142 (focusin 11, click 9, keydown 63, input 55, change 4) | yes | 137 | 119, 0 |
| g5-codex-partB-2026-09-23 | 78 | 10 (yes) | 68 (focusin 20, click 13, keydown 18, input 13, change 4) | yes | 53 | 119, 0 |
| g6-anything-llm-2026-09-23 store | 408 | 90 (yes) | 318 (focusin 72, click 24, keydown 108, input 102, change 12) | yes | 278 | 17, 0 |

- **Rule 1 changes no banked episode.** No banked row carries `gesture: false` (the mark is new), so every banked episode keeps its membership and carrier.
- **Rule 3 changes what a member's own chain prints**, on every store with multi-action episodes: the focus/click before a form submit and every keystroke of a form now print their own evidence plus the pointer instead of the carrier's request. No carrier chain changed, no attempt changed.
- **G5 transcripts replayed.** `-23c`: `resolve_element` ×2 and `action_chain` on the carrier identical; `element_history` identical in `attempts` and `summary`, and its six member entries (focusin + click of each of the three rename attempts) now carry the pointer instead of `POST /api/workspace/tracer-g5/update`. Part B (`element_history n:3`, `action_chain action:muepsox4:53`): same result. The answers the agent gave are unaffected.
- **G6.** The compare JSON for all six pairs and `index.json` and `AGENT-READS.md` are identical between `main` and this branch (the compared actions are carriers); G6 grader 6/6.
- Evidence directories were not edited.

## Decisions

1. **Only focus is marked.** The claim is about focus. Other trusted dispatches nested in running code (for example the `submit` from `form.requestSubmit()` inside a click handler) are unchanged.
2. **Scheduler lineage abstains on the cause but still marks `gesture: false`.** A React scheduler message multiplexes updates from several actions, so naming its poster would be a guess; but a frame being current proves app code moved the focus, so it is not a gesture and must not fold. Such a focus is listed nowhere. Receipted mount effects are exact even inside a scheduler message (they run on `applyReceiptFrame`, not the scheduler frame).
3. **Caused focus listed as `caused`, not in `action_ids`.** Keeps "one control or one form" per episode (G5 §15) and keeps carriers, requests and frontiers of the causing episode unchanged; `no-cross-control-neutral` passes unmodified (its dialog focuses now land under the openers as caused).
4. **Member chain = the same assembler over the member's own rows**, not a filtered copy of the carrier's chain, so no carrier evidence can leak through a field that was forgotten. The member's frontier is its own (usually `stopped_at: browser` with the scoped sentence), followed by the pointer.
5. **Attempts keep the episode view** so `element_history.attempts` stay byte-identical on the banked stores; `element_history.actions[]` entries follow the member rule.
6. **The unlinked window** treats an episode's caused ids as its own, so the click's window runs to the next gesture, not to its own autofocus.
7. **`g5-store-attempts.test.mjs` changed deliberately:** it asserted that `action_chain` on the click member shows the carrier's 422 route; it now asserts the pointer names the 422 attempt's carrier, and that the carrier's chain has the 422.

## Residual risks

- **The mark trusts the strict frame stack.** If a frame ever leaked as ambient state (the G1 round-four class of bug), a real Tab or pointer focus would be marked as caused by the leaked action: a wrong `caused_by_action_id`, and a lost fold. The D12 and continuation harnesses pass, but nothing here proves the absence of leaks on large apps.
- **Scheduler-committed autofocus is abstained.** Dialogs opened after a request resolves or inside `startTransition` get `cause_abstained: scheduler_lineage` and are listed under no episode, so the click's chain does not show the focus it eventually caused. The focus stays visible in `recent_actions` (and `action_chain`) with `gesture: false` and the sentence "focus caused by app code committed from React's scheduler; causing action not attributable".
- **Caused focus rows from `autoFocus` have no `element_key`**: React focuses in the layout phase, before the commit hook stamps the new elements. `element_history` on the dialog control therefore does not list the autoFocus row (the `useEffect` and handler cases are stamped).
- **Other nested trusted dispatches are not marked** (coordinator: out of scope for this claim). A trusted event dispatched while another action's code runs, such as the `submit` from `form.requestSubmit()` inside a click handler, is still recorded as an ordinary action of its own with no `caused_by_action_id`.
- **Member outcome label.** A member's own `outcome.status` is usually `incomplete` (no request of its own); only the pointer tells the reader where the request is. The member's own outcome label is owned by the separate branch `fix/outcome-labels` (one outcome-label function); this branch keeps `incomplete` plus the pointer.
- **Not rerun:** the M1 live viewer (`test/browser/server.mjs`). It publishes one card per episode built from the carrier's chain, so rule 3 holds there by construction and its cards gain `caused`. The generic `export-store-window.mjs` is on the unmerged `heldout-fixes` branch; it inherits the rule if it goes through the store/MCP (`chainForAction`/`callTool`), and prints only carrier cards if it builds episode chains directly. Not verified.
- Browser: Chromium headless via the LibreChat fixture's Playwright only; `focus` event semantics in Firefox/WebKit were not tested.

## Open questions, answered by the coordinator (2026-09-24)

1. An abstained caused focus must stay visible: listed in `recent_actions` with `gesture: false`, `cause_abstained: "scheduler_lineage"` and the sentence above; in no episode; never a user attempt. **Applied.**
2. Other nested trusted dispatches: out of scope; listed under residual risks. **Unchanged.**
3. Member outcome label: owned by `fix/outcome-labels`; `incomplete` plus the pointer kept here. **Unchanged.**
4. Caused focuses are not user attempts: excluded from `n` and from `attempts`; listed in `actions` only when the causing action's episode is a kept attempt, which then names them under `caused`. **Applied.**

### Follow-up run (after applying 1 and 4)

`npm test` 695/696 (known `react-context-ref-semantics`); `test/episode-focus.test.mjs` 4/4; G4 81/81; `node test/browser/episode-focus.mjs --out docs/evidence/pr-episode-focus-2026-09-24/runs-r2`: status ok, 3 runs, stable, now also asserting (f) the abstained focus in `recent_actions` with the exact sentence and `standalone: true`, and (b) `element_history` on the dialog key at `n: 1` giving one attempt (the Enter) with the caused focus not listed. Banked outputs: the four-store dump is byte-identical to the previous head (no banked row carries `gesture: false`), so the table above stands. This file was amended in place at the coordinator's request (same unmerged branch); `runs/` is the first run, `runs-r2/` the follow-up.
