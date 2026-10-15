# G2 bridge-off rerun: independent grade (2026-09-23)

Grader: separate agent, the same one that wrote `trace-consolidated/.claude/worktrees/agent-a67969b12d569f0c6/docs/evidence/g2-grade-independent-2026-09-23/GRADE-g2-independent.md` for the bridge-on runs.

I did not read or use the implementer's `GRADE.md`, `g2-report.mjs` or `g2-stamps-check.mjs` output as evidence; I read the stamps-check script only to see what it tests. Nothing was imported from the package. Every count below was recomputed from `records.jsonl.gz`, `stamps.jsonl.gz`, `spans.jsonl.gz`, `observed-requests.json` and `attribution-manifest.json`, from the fixture sources, and from the fixture SQLite file (opened read-only). No builds or servers were run. `npm test` was run once, as requested.

- **Worktree:** `/Users/austinho/dev/tracer-g2b`, branch `g2-bridge-off`, HEAD `96529377` (`7cf682b3` harness, `96529377` evidence) on `da8575e7`.
- **Package code changed vs `da8575e7`:** none. `git diff --stat da8575e7 HEAD -- . ':!docs/evidence'` touches only `docs/gates/G2-generality.md`, `test/browser/build-fresh-repo.mjs`, `test/browser/g2-report.mjs` and `test/browser/g2-stamps-check.mjs`.
- **Raw rows are committed now** as `*.jsonl.gz`. For every file in both dirs, `gunzip | sha256` equals `RAW-SHA256.txt` and equals the sha256 of the uncompressed on-disk copy: anything-llm records 1,664 / stamps 192 / spans 1,156 / joined 110; bulletproof records 858 / stamps 146 / joined 9. This fixes residual #1 of my bridge-on grade.

## Per-item table

| # | check | anything-llm | bulletproof-react | verdict |
|---|---|---|---|---|
| 1a | Bridge off, runtime wrapper carries requests | `wrapper-vite.config.mjs`: `producttrace({"requestBridge":false,"stamps":true})`, identical to `build-gates.json → install.plugin_line/plugin_options`. `served_transport`: `bridge_assets: []`, `index_references_bridge: false`, `index_inlines_runtime_wrappers: true`. Page state: `fetch.name = productTraceRuntimeFetch`, `XHR.send.name = productTraceRuntimeSend`, `bridge_installed: false`. Rows: 71 `network.request`, **0 internal** (bridge-on had 12 `/__producttrace/bridge` posts), transport `fetch` ×71 | same config. 12 rows, 0 internal (bridge-on: 20), transport `xhr` ×12 | **PASS.** Request rows carry no explicit "recorder" field. The runtime-wrapper origin rests on the served-asset scan (harness `build-fresh-repo.mjs:202-209`, which checks `dist-enabled`, since deleted), the on-page wrapper names, and the absence of any bridge post. Those three agree |
| 1b | Requests: Tracer = Playwright | `observed-requests.json` has 71 entries. The (METHOD, path) multiset equals the 71 non-internal rows, diff = ∅. Types: fetch ×71 | 12 = 12, diff ∅, xhr ×12 | **PASS**, now independently re-run from the saved Playwright list (my bridge-on residual #2 closed) |
| 2 | Capture contiguous and drained, stamps, React, capture.limit | page `…h56i`: `sequence` 1..1645 contiguous, `stamp_sequence` 1..140. Page `…61kai`: 1..19 and 1..52. `drained: true`, `queued_after_drain: 0`, `unsequenced_rows: 0`, live page emitted 71 = 19 + 52 received. No `capture.*` / `*limit*` rows. `react_version` 18.3.1, matching `frontend/node_modules/react{,-dom}/package.json` | 1..858 and 1..146, emitted 1004 = 858 + 146, drained, 0 limit rows. React 18.3.1 on disk | **PASS.** Caveat unchanged: anything-llm page 1 was navigated away, so only its interior contiguity is provable, not its tail |
| 3a | Handler credits vs source | 23 credits, **23 correct**: 9 clicks, 8 inputs, 4 focusins, 2 submits (table below). Same functions and spans as r3, which I checked against source before; the snippets were re-read from the fixture | 13 credits: **12 correct + 1 `route_loader`** (Discussions `<NavLink>` → `app/router.tsx:49`) | Correct = 35. Under the amended categories in `docs/gates/G2-generality.md:126-138`, unrooted_global is a disclosed defect and wrong = 0. **Under the gate's original verdict set the NavLink credit is `wrong`** (a route loader is not the element's handler) |
| 3b | `entry_handler` abstentions (10 + 2) | 9 step-2 keydowns on `#name`: the depth-0 event frames are only `MicButton:33` (document), `keyboardShortcuts.js:108` (window) and `SidebarToggle:38` (window). The listed `bound` handler `NewWorkspace.jsx:75` (the Modal's `onClose`) did not run. 1 step-7 click on the name input: only `WorkspaceChat/index.jsx:192` and `ThreadItem:178` (document listeners); `bound: []` | Register link (seq 27): only `router.tsx:32` ran; `bound` lists `login.tsx:15`, which did not run. View link (seq 495): only `router.tsx:56` ran; the `bound` handlers listed (`discussions.tsx:34`, the list `onMouseEnter`) did not run | **12/12 justified**: in each, no element-bound handler entered. Note: `bound_handlers` is over-inclusive (it includes ancestor props for other events), as ERRATA says. The loader behaviour is inconsistent: two loaders abstain and one is credited, because that loader owns a request |
| 3c | Uncredited click/submit/change | 2 clicks + 2 changes, each with 0 `function.enter` rows | 12 clicks + 8 changes, each with 0 enters | 0 missed credits in scope. **One miss outside the step windows**: page-1 pre-session `focusin` (seq 12). Its bound `onFocus` (`PromptInput/index.jsx:362`) ran at depth 0 with invoked_by=event, yet the verdict is `none`. The same row existed in r3 (I missed it there). ERRATA #1 mentions the handler ran but does not call it a miss |
| 3d | The 4 formerly lost bulletproof requests | chains below | | **PASS.** All 4 are `linkage_kind: direct` on the correct action, with a first-party spine from handler to issuer |
| 4 | anything-llm in-session unattributed GETs | Recount: 44 unattributed = 22 before the first `dom.action` of each page + **22 in-session** (step 2: 7, step 3: 8, step 5: 7). All 22 have `action_id: null`, `parent_continuation_id: null` and an empty spine, so there is **no wrong credit by construction**. Sample of 6 (seq 603 `/chats`, 617 `/workspace/tracer-g2`, 620 `/parsed-files`, 696 `/thread/…/chats`, 705 `/document-processing-status`, 887 `/chats`): the preceding rows show the credited action's `await Promise.all` resumption still owned. At seq 591-598 the `.then` callbacks of `models/workspace.js:320/324/572` (suggested-messages, is-agent-command) carry action 27. After that the `setWorkspace`-triggered effect `components/WorkspaceChat/index.jsx:52-72` (`[workspace, loading, threadSlug]` → `Workspace.chatHistory` / `threads.chatHistory`) and its mounts issue the GETs with no owner. In steps 3 and 5 they follow the thread-list GET of the credited click (`/threads`, owned) and a `navigate()` | n/a | **Confirmed as abstentions** at the state-update/async frontier, not wrong credits. They are a regression in coverage vs bridge-on (22 requests lost their action), disclosed |
| 5 | Stamps | Per-step snapshots: interactive 190 / stamped 190 (visible 184/184), 0 unstamped samples. 140 keys, 132 placements. My 10 keys (below) all verify: hash, `<tag` at start, line, `>` at end | 83/83 (visible 76/76). 146 keys, 84 placements, 10/10 verify | Presence and placement **PASS**. **Key-identity defect found (bulletproof)**, see below |
| 6 | `--expect-commit` guard; fixture state | The harness throws before any work if `rev-parse HEAD` does not start with the prefix (`build-fresh-repo.mjs:79`). After the run it records `commit_after` and `commit_unchanged`, and `source.pass` requires both a clean tree and an unchanged commit. The run recorded `ad97bc8d…`, unchanged. Fixture now at `ad97bc8d` on master, clean. The SQLite `event_logs` show `workspace_created "Tracer G2"` @…895072, `thread_created` @…896719 and `workspace_deleted "Tracer G2 renamed"` @…904908, 20 / 7 / 82 ms after this run's POST/DELETE rows. 27/27 attributed requests have exactly one server child by (trace_id, parent_span_id). 0 DB spans | fixture at `9506629e`, clean. This run predates `--expect-commit` (disclosed) | **PASS.** Guard limits: an empty `--expect-commit ''` silently disables it, and a switch-and-return mid-run is not detected (disclosed, LIMITS #8). The `-invalid` dir is disclosed correctly (`source.commit 3a8fcfb5`) |
| 7 | `npm test` | `node --test test/*.test.mjs`: **tests 623, pass 622, fail 1**. The failure is `test/react-context-ref-semantics.test.mjs:70` "different context objects never borrow a Provider value…" (`'a' !== 'b'`). The branch changes no `test/*.test.mjs`, `src/` or `analysis/` file, so the failure is inherited from `da8575e7`, not introduced here | | **Matches the claim (622/623).** The failing static-analysis test is a pre-existing residual |

## 3a: credited actions, bulletproof (anything-llm's 23 as in my bridge-on table: same 12 functions and spans)

| step | action | credited | source binding | grade |
|---|---|---|---|---|
| 1 | click Get started | `app/routes/landing.tsx:13` `handleStart` | `onClick={handleStart}` (l.34) | correct |
| 3 | submit register | `features/auth/components/register-form.tsx:30` | `<Form onSubmit={(values)=>registering.mutate(values)}>`. It entered via the `await` inside react-hook-form's `handleSubmit` (invoked_by async then event), not at depth 0 | correct |
| 4 | click Discussions NavLink | `app/router.tsx:49` (route `lazy`) | no first-party click handler on the NavLink | **route_loader**: not the element's handler |
| 5 | click Create Discussion | `components/ui/form/form-drawer.tsx:42` `onOpenChange` | `<Drawer onOpenChange>` + `DrawerTrigger asChild` | correct |
| 5 | submit discussion | `features/discussions/components/create-discussion.tsx:49` | `<Form onSubmit>` | correct |
| 7 | click Create Comment | `form-drawer.tsx:42` | as above | correct |
| 7 | submit comment | `features/comments/components/create-comment.tsx:53` | `<Form onSubmit>` | correct |
| 8 | click Delete Comment trigger | `confirmation-dialog.tsx:48` `onOpenChange` | `<Dialog onOpenChange>` + `DialogTrigger asChild` | correct |
| 8 | click confirm | `features/comments/components/delete-comment.tsx:48` | `confirmButton … onClick={() => deleteCommentMutation.mutate(…)}` | correct |
| 9 | toast Close ×3 | `components/ui/notifications/notification.tsx:39` | `onClick={() => { onDismiss(id); }}` | correct (3) |
| 10 | Sign Out | `components/layouts/dashboard-layout.tsx:192` | `DropdownMenuItem onClick={() => logout.mutate({})}` | correct |

## 3d: the four formerly lost requests (spine resolved to source; terminal owner = credited handler row)

| request (seq) | action | chain |
|---|---|---|
| GET /api/discussions (295) | Discussions NavLink click (seq 264), `direct` | `router.tsx:49` lazy (terminal owner, row 265) → `routes/app/discussions/discussions.tsx:11/12` `clientLoader` → `features/discussions/api/get-discussions.ts:25` queryFn → `:7` `getDiscussions` → `lib/api-client.ts:7` interceptor → XHR |
| GET /api/discussions (475) | create-discussion submit (seq 431), `direct` | `create-discussion.tsx:49` onSubmit (owner, row 432) → `features/discussions/api/create-discussion.ts:37` `useMutation.onSuccess` → `queryClient.invalidateQueries` → `get-discussions.ts:25` → `:7` → interceptor → XHR |
| GET /api/comments (668) | create-comment submit (seq 614), `direct` | `create-comment.tsx:53` (owner, row 615) → `features/comments/api/create-comment.ts:39` onSuccess/invalidate → `get-comments.ts:25` → `:7` → XHR |
| GET /api/comments (759) | delete confirm click (seq 707), `direct` | `delete-comment.tsx:48` (owner, row 708) → `features/comments/api/delete-comment.ts:26` onSuccess/invalidate → `get-comments.ts:25` → `:7` → XHR |

Each owner is the action whose mutation caused the refetch, or whose navigation ran the loader. These are correct owners.

## 5: stamp keys I resolved (distinct placements; 8 of 10 per repo overlap the implementer's sample, because the acted-on set is small: 12 and 19 keys)

anything-llm (all verified):
- `DeleteWorkspace/index.jsx:43 <button onClick={deleteWorkspace}>`
- `lib/CTAButton/index.jsx:8 <button onClick={() => onClick?.()}>`
- `PromptInput/index.jsx:352 <textarea>` (onChange/onKeyDown/onPaste/onFocus/onBlur)
- `WorkspaceName/index.jsx:15 <input>` (onChange)
- `Sidebar/ActiveWorkspaces/index.jsx:186 <button>` (gear)
- `ThreadItem/index.jsx:272 <button onClick={handleDelete}>`
- `ThreadItem:136 <button>` (options)
- `ThreadItem:264 <button onClick={renameThread}>`
- `ThreadContainer/index.jsx:214 <button onClick={onClick}>`, binding `:183 <NewThreadButton onNewThread=…>`
- `lib/Modal/index.jsx:293 <button {...props}>` (Save, no handler)

bulletproof (all verified):
- `ui/button/button.tsx:62 <Comp>`
- `ui/form/input.tsx:18 <input>`
- `ui/dropdown/dropdown.tsx:86 <DropdownMenuPrimitive.Item>`, binding `layouts/dashboard-layout.tsx:190 <DropdownMenuItem …onClick={() => logout.mutate({})}>`
- `dropdown.tsx:65 Portal`
- `notifications/notification.tsx:37 <button>`
- `ui/drawer/drawer.tsx:59 <DrawerPortal>`
- `ui/form/textarea.tsx:18 <textarea>`
- `ui/link/link.tsx:7 <RouterLink>`, binding `discussions-list.tsx:62 <Link onMouseEnter=…>`
- `layouts/dashboard-layout.tsx:103 <NavLink>`
- `auth/components/login-form.tsx:55 <Link>`

`binding_placement` on the three shared-component cases:
1. **Dropdown item → `dashboard-layout.tsx:190`: correct.** That is where the Sign Out `onClick` is authored.
2. **RouterLink → `discussions-list.tsx:62`: correct.** That call site binds the `onMouseEnter` prefetch.
3. **NewThreadButton `:214` → binding `:183`: imprecise.** The binding site binds `onNewThread`, not the click. The click handler `onClick` is the element's own prop at `:214`. The row lists both, so a reader must not take the binding site as "where the click handler is".

**Key-identity defect (new, bulletproof).** Element keys for a shared primitive are `placement#nN` ordinals. The runtime emits one `element.stamp` row per key per page, on first sight. Ordinals are reused after route changes and on re-render, so a later element with the same key inherits the first element's stamp row. From the raw rows:

| dom.action | element acted on | key | the only stamp row for that key | effect |
|---|---|---|---|---|
| seq 199/200 | Register submit `<Button type="submit">` | `p_ce24901c7a71:1821-2142#n1` | landing "Get started" | **wrong binding**: `landing.tsx:33 <Button onClick={handleStart}>`, handlers `[onClick]` |
| 547 | Create Comment trigger | `#n4` | a different /app/discussions Button | binding missing (should be `form-drawer.tsx:40`, as `#n3` shows for the identical Create Discussion trigger) |
| 696 | Delete Comment trigger | `#n5` | the create-discussion submit | binding missing |
| 707 | confirm "Delete Comment" | `#n6` | the create-comment submit | binding missing. The confirm button's own row was emitted under `#n7` with `confirmation-dialog.tsx:81` (the ordinal shifted between stamp time and click time) |

`file:line` is still correct: every one is `button.tsx:62`, so the "verified" placement checks cannot see this. But **key → element is not stable over a session**, and `binding_placement` is wrong for 1 and absent for 3 acted-on elements. anything-llm shows no instance of this among its 12 acted-on keys: no key has two distinct placement/binding/handler rows, and its acted-on keys are unique elements. This does not affect G2 handler credits, which come from function rows, not stamps. It does undercut the G3 claim that a stamp key resolves an acted-on element to where its handler is authored.

## Other observations

- **Stale listener ownership (anything-llm).** I count 69 event-invoked `function.enter` rows at depth 0 that carry an action other than the latest dispatched one. The implementer's 67 excludes 2 on the step-5 click, which are plausibly its own continuation. They land on 4 earlier actions:
  - step-1 click: `useModalEscape` ×9;
  - step-2 submit: 4 rows;
  - step-5 click: 2 rows;
  - step-6 gear click: 54 keydown-listener rows from step 7.

  All four keep their correct own credit, so no credit changed. The disclosure is accurate.
- **Bulletproof continuations.** The 9 such rows are request continuations (api-client interceptor, `get-comments` queryFn) on the actions that own those requests. They are legitimate.
- **Merge mechanics.** `git merge-tree --write-tree main HEAD`, against main now at `a1807189`, 12 commits past `da8575e7`, reports a **content conflict in `test/browser/build-fresh-repo.mjs`**, because main changed the harness since the branch point. Harness-only, but the merge needs a hand resolution. The branch's own `g2-stamps-check.mjs` and gate section do not conflict.

## Commands run

```
git -C /Users/austinho/dev/tracer-g2b log / diff --stat da8575e7 HEAD [-- non-evidence paths] / merge-base --is-ancestor / merge-tree --write-tree --name-only main HEAD
gunzip -c *.jsonl.gz | shasum -a 256; shasum -a 256 *.jsonl; cat RAW-SHA256.txt; cat wrapper-vite.config.mjs
python3: row kinds, request internal/transport, (METHOD,path) multiset vs observed-requests.json, per-page sequence and stamp_sequence contiguity, capture.limit search
python3 scratchpad/g2/bo.py <evidence> <fixture>: per dom.action depth-0 invoked_by=event function.enter → manifest → fixture source vs actions.json credit/abstention
python3: submit-action continuation rows; request spine/terminal-owner resolution; unattributed in-session GET context rows; stale-owner count; stamp key resolution (hash, <tag, line, >), binding_placement resolution, key reuse per dom.action
sed/grep of fixture sources (WorkspaceChat/index.jsx, pages/WorkspaceChat/index.jsx, models/workspace.js, create-discussion.ts, delete-comment.ts, discussions.tsx, form-drawer.tsx, delete-comment.tsx)
sqlite3 -readonly file:…/anythingllm.db?mode=ro "select … from event_logs"
git -C <fixture> rev-parse HEAD / status --porcelain
npm test (in tracer-g2b)  →  623 tests, 622 pass, 1 fail
```

No `.env` file or secret was opened.

## Merge verdict

**Merge: yes, harness and evidence only, after resolving the `build-fresh-repo.mjs` conflict with current main.** Proven on raw rows:

- The request bridge is off and the runtime wrappers carry all requests: 71 = 71 and 12 = 12 against the saved Playwright list.
- Capture is contiguous and drained, including stamp rows, on React 18.3.1, with no `capture.limit` rows.
- 35 credits are correct against source.
- 1 route-loader credit is disclosed as unrooted_global (it counts as `wrong` under the original gate wording).
- 12/12 abstentions are justified.
- 0 missed credits on in-scope click/submit/change.
- The 4 formerly lost bulletproof requests now reach the right action through handler → `onSuccess`/loader → queryFn chains.
- All 6 anything-llm writes join exactly and are corroborated by the app's `event_logs`.
- Stamps are present on 190/190 and 83/83 interactive hosts, with placements verified.
- The commit guard works.
- Raw rows are committed with matching hashes.

**Residuals:**
1. Discussions NavLink → `router.tsx:49` credit: a request-owning loader skips the binding check.
2. 22 anything-llm in-session GETs lost their action after `setWorkspace`-after-`await` and `navigate()`. This is coverage lost relative to bridge-on, but abstention, not wrong credit.
3. **New: stamp `element_key` ordinals are reused, and only the first row per key is emitted.** On bulletproof this gives 1 wrong and 3 missing `binding_placement` for acted-on elements. It needs a fix before G3 relies on key → handler site.
4. NewThreadButton `binding_placement` points at a site that binds a different handler (`onNewThread`) than the one clicked.
5. The pre-session `focusin` whose bound `onFocus` ran is not credited (miss outside the step windows; also in r3).
6. Stale window/document listener ownership: 67-69 rows, no credit effect.
7. `bound_handlers` is over-inclusive.
8. `--expect-commit ''` disables the guard, and a mid-run switch-and-return is undetectable.
9. The marker gate is not re-runnable, because builds are not kept.
10. One inherited failing test (`react-context-ref-semantics.test.mjs:70`).
