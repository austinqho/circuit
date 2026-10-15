# G2 independent grade: anything-llm (r3)

Grader: independent re-computation from `records.jsonl`, `spans.jsonl`, `attribution-manifest.json` and the fixture source at
`/Users/austinho/dev/fixtures/anything-llm` @ `ad97bc8dfcb6919f34f7d6d0c722efdda64d66d9` (HEAD matches, working tree clean).
`actions.json` was used only as the list of claims to check. All source paths are relative to the fixture root and all
lines are 1-based. Record sequence numbers restart on each capture page, so records are cited as `p1#seq` (page
`mue2ijsl-m6m35ddvao`) or `p2#seq` (page `mue2isuw-r851y3jegkb`).

## Summary

| measure | count |
|---|---|
| dom.action rows in actions.json | 67 (the raw file has 68: `action:mue2ijwg:1`, a textarea autofocus at p1#12 before step 1, is left out of actions.json) |
| credited rows (entry != null) | 42 in 19 groups |
| function id = `function:<sha256(file)>:<start>:<end>`, recomputed | 15/15 distinct functions match. Each span, read as UTF-16 offsets, is exactly one function expression (checked with `vm.Script('(' + text + ')')`). The manifest `source` equals the entry file/start/end in every case. |
| **correct** | **23 rows / 16 groups** |
| **global-listener** | **19 rows / 3 groups** |
| **wrong** | **0** |
| click/submit/change rows with no entry | 4 |
| **miss** | **0** |
| **none-justified** | **4** |
| attributed network.request rows checked (non-internal, has action_id) | 49 |
| exact server-span joins (one `kind=server` span with the same trace_id, parent_span_id = request span_id, same method) | **49/49** |
| requests with at least 1 `producttrace-express-handlers` descendant | 49/49 (descendant counts: 1 handler ×15, 2 ×2, 3 ×13, 4 ×19; 134 in total, which matches coverage `handler_enter: 134`) |
| mismatches with actions.json `route` (span_id, route, status) or `handlers` (span-id set) | **0** |
| DB / client spans | **0** (span kinds: 104 server/http, 832 internal/express, 220 internal/producttrace-express-handlers) |
| unattributed non-internal requests | 22: all come from page load (11 on p1 before the first action, 11 on p2 after a full reload). None falls inside the session after an action. |

## A. Credited entry handlers (grouped by step, event, function)

| step | event, target | rows | credited function | verdict | evidence |
|---|---|---|---|---|---|
| 1 | click `<button>` ("+" New Workspace) | 1 | `frontend/src/components/Modals/NewWorkspace.jsx:72` `showModal` | correct | Bound as `onClick={showNewWsModal}` at `components/Sidebar/index.jsx:198` and `components/Sidebar/SearchBox/index.jsx:199`. `showNewWsModal` is `useNewWorkspaceModal().showModal` (`Sidebar/index.jsx:26`). |
| 2 | keydown `<input#name>` | 9 | `.../PromptInput/SpeechToText/MicButton/index.jsx:33` `onKey` | global-listener | `document.addEventListener("keydown", onKey)` at `:37`. This is the Ctrl+M speech-to-text shortcut from the home-page prompt, not bound to the modal input. |
| 2 | submit (form of `<button type=submit>`) | 1 | `frontend/src/components/Modals/NewWorkspace.jsx:21` `handleCreate` | correct | `<form onSubmit={handleCreate}>` at `NewWorkspace.jsx:45` |
| 2 | focusin `<textarea#primary-prompt-input>` | 1 | `.../PromptInput/index.jsx:362` `() => setFocused(true)` | correct | `onFocus` prop on the `<textarea>` (`:352`, `:362`). React onFocus runs on focusin. The focus is a programmatic autofocus after navigation, not a scripted step. |
| 3 | click `<button>` (New Thread) | 1 | `.../ThreadContainer/index.jsx:194` `onClick` | correct | `<button onClick={onClick}>` at `ThreadContainer/index.jsx:215` (`NewThreadButton`) |
| 3 | focusin textarea | 1 | `PromptInput/index.jsx:362` | correct | as above |
| 4 | click `<button aria-label="Thread options">` | 1 | `.../ThreadItem/index.jsx:139` `() => setShowOptions(!showOptions)` | correct | inline `onClick` at `ThreadItem/index.jsx:139`, aria-label at `:140` |
| 4 | click `<button type=button>` (Rename) | 1 | `.../ThreadItem/index.jsx:209` `renameThread` | correct | `onClick={renameThread}` at `:265` |
| 5 | click Thread options | 1 | `ThreadItem/index.jsx:139` | correct | as in step 4 |
| 5 | click `<button type=button>` (Delete Thread) | 1 | `.../ThreadItem/index.jsx:235` `handleDelete` | correct | `onClick={handleDelete}` at `:273` |
| 5 | focusin textarea | 1 | `PromptInput/index.jsx:362` | correct | as above |
| 6 | click `<button aria-label="General appearance settings">` | 1 | `components/Sidebar/ActiveWorkspaces/index.jsx:187` inline arrow | correct | inline `onClick` at `:187`, aria-label at `:199` |
| 7 | click `<input name=name>` | 1 | `components/WorkspaceChat/index.jsx:192` anonymous `function (e)` | global-listener | `document.addEventListener("click", ...)` code-snippet copy delegator (`:189-197`). It is registered once from `WorkspaceChat/index.jsx:118` and never removed. The input (`WorkspaceName/index.jsx:15-26`) has no onClick. |
| 7 | keydown `<input name=name>` | 9 | `.../ThreadContainer/hooks.js:33` `handleKeyDown` | global-listener | `window.addEventListener("keydown", handleKeyDown)` at `hooks.js:49`. This is the Ctrl/Meta hover mode for bulk thread deletion. |
| 7 | input `<input name=name>` | 8 | `pages/WorkspaceSettings/GeneralAppearance/WorkspaceName/index.jsx:25` `() => setHasChanges(true)` | correct | `onChange` prop on the input at `:25`. React onChange runs on native `input`. |
| 7 | click `<button>` (Update Workspace) | 1 | `components/lib/CTAButton/index.jsx:10` `() => onClick?.()` | correct (no-op) | This is the button's own `onClick` prop (`CTAButton/index.jsx:10`), but `GeneralAppearance/index.jsx:55` renders `<CTAButton type="submit">` with no `onClick`, so it does nothing. The real effect is the separate submit action. |
| 7 | submit | 1 | `pages/WorkspaceSettings/GeneralAppearance/index.jsx:26` `handleUpdate` | correct | `<form onSubmit={handleUpdate}>` at `:50` |
| 8 | click `<button type=button>` (Delete Workspace) | 1 | `.../GeneralAppearance/DeleteWorkspace/index.jsx:13` `deleteWorkspace` | correct | `onClick={deleteWorkspace}` at `:45` |
| 8 | focusin textarea (p2, after the reload) | 1 | `PromptInput/index.jsx:362` | correct | as above (p2#12) |

## B. click/submit/change rows with no credited entry

| step | action | event, target | verdict | reason |
|---|---|---|---|---|
| 2 | `action:mue2il2g:5` | click `<input#name>` | none-justified | `ModalInput` (`components/lib/Modal/index.jsx:196-226`) and `NewWorkspace.jsx:50-58` add no onClick. No ancestor in the `Modal` (`Modal/index.jsx:36-72`) has one either. The document click delegator was not yet registered because WorkspaceChat had not mounted. |
| 2 | `action:mue2il8z:24` | change `<input#name>` | none-justified | There is no onChange prop. |
| 2 | `action:mue2il8z:26` | click `<button type=submit>` (Save) | none-justified | `ModalPrimaryButton` (`Modal/index.jsx:291-299`) has no onClick. It performs a native submit, and the separate submit row credits `handleCreate`. |
| 7 | `action:mue2irky:62` | change `<input name=name>` | none-justified | React's `onChange` (`WorkspaceName/index.jsx:25`) already ran on each `input` event (credited there). On a text input the native `change` does not re-dispatch it because the value tracker is unchanged. |

## C. Request to backend joins

- 83 network.request rows: 12 internal (`/__producttrace/bridge`), 49 attributed, 22 unattributed.
- Each of the 49 attributed rows has exactly one `kind=server` span that meets all of these conditions: `trace_id == trace_context.trace_id`, `parent_span_id == trace_context.span_id`, and `http.method` equal to the request method. `http.target` equals the request path once the `http://127.0.0.1:4100` origin is removed.
- For each request, the actions.json `route.span_id`, `route.route` (the span's `http.route`) and `route.status` (the span's `http.status_code`) match the recomputed server span.
- For each request, the set of actions.json `handlers[].span_id` equals the set of `producttrace-express-handlers` spans descended from that server span (a transitive walk over `parent_span_id` within the trace). There are no extras and none missing.
- Every actions.json request has `db: []`, and `spans.jsonl` has 0 spans with `db.*` attributes, a Prisma or SQLite name, or `kind=client`. This matches the harness's stop reason ("Prisma/SQLite has no Tracer adapter").
- The unattributed requests also join exactly: all 22 have one server span each. There are 104 server spans in total. The 11 parented server spans and 22 root server spans that do not join any request in this capture started 3.4 to 7.4 s before the first record, so they belong to warm-up traffic outside the session.

## D. Unattributed requests (22)

| page, seqs | requests | when |
|---|---|---|
| p1#1-11 (ts 1790165831437-488) | GET /api/onboarding, /api/system/logo ×3, /api/setup-complete ×3, /api/system/support-email, /api/workspaces ×2, /api/system/footer-data | Initial page load, before the first dom.action (p1#12, ts ...488). `reason=unattributed_transport` with `continuation:unattributed:*` parents. |
| p2#1-11 (ts 1790165843146-193) | the same set, except that /api/workspace/tracer-g2 replaces /api/system/footer-data | After a full page load, on a new `capture_page_id`. The reload is triggered by step 8's `window.location = paths.home()` (`DeleteWorkspace/index.jsx:32`), 146 ms after the click at p1#6610. All of these come before p2's first action (p2#12). |

None of the unattributed requests occurs within the session after an action, so this session shows no lost async continuation.

## Discrepancies and observations about the harness output

1. Step 7 keydown rows (9): the credited function is `hooks.js:33`, but it was not the first first-party listener to run. `utils/keyboardShortcuts.js:108` `handleKeyDown` (a window keydown listener, `:119`) ran first at p1#6332, followed by `components/Sidebar/SidebarToggle/index.jsx:38` `toggleSidebar` (window keydown, `:55`) at p1#6340. `hooks.js:33` came third at p1#6344. The harness chose it because only that function's enter record has `entry_hint: true`. All three are global listeners, so the verdict is the same, but "entry" here means "first entry_hint function", not "first function invoked by the event".
2. Step 7 Update Workspace click: crediting the `CTAButton` onClick wrapper is technically correct but uninformative, because `onClick` is undefined at the call site.
3. `rooted: false` is reported on 16 credited rows (the 9 MicButton keydowns and 7 of the 8 WorkspaceName input rows) even though they are `invoked_by: event` and are the first entry_hint function of their action. This matches `credited_rooted: 26`. The flag seems to reflect the wrapper's nesting (every function appears as a doubled enter/exit pair) rather than whether the function was really a root.
4. `actions.json` leaves out raw action `action:mue2ijwg:1` (p1#12, focusin on the textarea, the same PromptInput:362 handler). The harness `by_event.focusin: 16` excludes it.
5. The `snippet` fields are whitespace-collapsed and truncated. After normalising whitespace, all of them are prefixes of the exact source span.
6. None of the harness's counts disagree with the recomputation: 49 attributed, 22 unattributed, 0 DB spans, and 134 handler spans.
