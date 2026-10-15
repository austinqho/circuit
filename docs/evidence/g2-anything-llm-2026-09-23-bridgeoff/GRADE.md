# G2 grade: anything-llm, bridge-off rerun (independent)

Grader: independent recomputation from `records.jsonl`, `stamps.jsonl`, `spans.jsonl`, `joined-backend.jsonl`, `attribution-manifest.json`, `observed-requests.json` and fixture source at `ad97bc8dfcb6919f34f7d6d0c722efdda64d66d9`. Sources were read with `git show ad97bc8d:<path>`. The fixture's master was also at ad97bc8 when I checked. Manifest and stamp offsets are character offsets, not bytes. Harness files (`actions.json`, `summary.json`, `ACTIONS.md`, `STAMPS.md`) were only used for their claims.

## Summary

| Item | Result |
|---|---|
| dom.action rows | 68 (67 in steps, plus 1 page-load focusin before step 1) |
| Credits: correct | **23** |
| Credits: unrooted_global | **0** |
| Credits: wrong | **0** |
| Abstentions (`stopped_at: entry_handler`) | 10, all **justified** |
| Misses | **0** |
| Requests: records (non-internal) vs Playwright | 71 = 71, method+path multisets identical |
| Requests attributed / unattributed | 27 / 44 (22 before the first action of their page, **22 in-session**) |
| Backend joins | 27/27 attributed requests: exactly one server span in the trace, `parent_span_id == request.trace_context.span_id`, same method, and `joined-backend.jsonl` route.dispatch agrees |
| Capture | page 1: `sequence` 1..1645 contiguous; page 2: 1..19 contiguous; 0 duplicates. Stamps 1..140 and 1..52 contiguous. 0 `capture.dropped` / `capture.limit` rows; React 18.3.1 |
| Transport | runtime wrappers only (`requestBridge:false`; `bridge_assets=[]`; `index_references_bridge=false`; `bridge_posts=0`; all rows `transport: fetch`, no bridge fields) |
| Stamps sampled | 12 acted-on keys: 12/12 pass hash, key, `<tag`, and line. All 192 stamp rows pass |
| Stale-action listener rows (item G) | 69 rows, of which 67 are listener dispatches carrying an earlier action. 0 credits or requests changed; 9 step-7 keydown actions get the wrong "none" reason |

Compared with the G2 doc's bridge-on count (23 correct, 19 unrooted_global): the 23 correct credits are the same, and all 19 former unrooted_global credits are gone. 10 of them are now explicit abstentions. The other 9 (step 7 keydowns) now read "no first-party function entered", because of defect G.

## A. Requests

- 71 `network.request` rows, all `internal:false`; none match `/__capture`, `/__producttrace/` or `/__spans`. `observed-requests.json` has 71. The method+path Counter difference is empty in both directions.
- Row fields are the runtime-evidence set only, and the string `bridge` does not occur in records.jsonl. `build-gates.json`: `plugin_options {requestBridge:false, stamps:true}`, `served_transport {bridge_assets:[], index_references_bridge:false, index_inlines_runtime_wrappers:true, runtime_asset:true}`. `wrapper-vite.config.mjs` passes `producttrace({"requestBridge":false,"stamps":true})`.
- linkage_kind of the 27 attributed requests: direct 7, mount_effect 18, state_effect 2.

## B. Capture

| Page | Rows | sequence | Stamps | stamp_sequence |
|---|---|---|---|---|
| muene1nn-r24vlmh56i | 1645 | 1..1645 contiguous, 0 dup | 140 | 1..140 contiguous |
| mueneaqk-ofioma61kai (after workspace delete) | 19 | 1..19 contiguous, 0 dup | 52 | 1..52 contiguous |

There are no `capture.dropped` or `capture.limit` rows (`coverage.capture_limits = []`, `capture.dropped = 0`). React is 18.3.1 (`frontend/node_modules/react/package.json`).

## C. Handler credits (per group)

Method: I took the depth-0 `function.enter` rows (`invoked_by=event`, spine length 1) under each action, mapped them through the manifest to source, and compared them with the JSX prop and `bound_handlers`. All paths are under `frontend/src/`.

| # | Step(s) | Event / target | Credited function | JSX binding | n | Grade |
|---|---|---|---|---|---|---|
| 1 | 1 | click new-workspace button | `showModal` components/Modals/NewWorkspace.jsx:72 | `onClick={showNewWsModal}` components/Sidebar/SearchBox/index.jsx:199 | 1 | correct |
| 2 | 2 | submit new-workspace form | `handleCreate` components/Modals/NewWorkspace.jsx:21 | `<form onSubmit={handleCreate}>` NewWorkspace.jsx:45 | 1 | correct |
| 3 | 2, 3, 5, 8 | focusin `#primary-prompt-input` | `() => setFocused(true)` components/WorkspaceChat/ChatContainer/PromptInput/index.jsx:362 | `onFocus=` on the textarea, PromptInput/index.jsx:362 | 4 | correct |
| 4 | 3 | click New Thread | `onClick` components/Sidebar/ActiveWorkspaces/ThreadContainer/index.jsx:194 | `onClick={onClick}` ThreadContainer/index.jsx:215 | 1 | correct |
| 5 | 4, 5 | click "Thread options" | `() => setShowOptions(!showOptions)` .../ThreadItem/index.jsx:139 | inline `onClick` ThreadItem/index.jsx:139 | 2 | correct |
| 6 | 4 | click Rename | `renameThread` .../ThreadItem/index.jsx:209 | `onClick={renameThread}` ThreadItem/index.jsx:265 | 1 | correct |
| 7 | 5 | click Delete thread | `handleDelete` .../ThreadItem/index.jsx:235 | `onClick={handleDelete}` ThreadItem/index.jsx:273 | 1 | correct |
| 8 | 6 | click "General appearance settings" | inline handler components/Sidebar/ActiveWorkspaces/index.jsx:187 | inline `onClick` ActiveWorkspaces/index.jsx:187 | 1 | correct |
| 9 | 7 | input workspace name ×8 | `() => setHasChanges(true)` pages/WorkspaceSettings/GeneralAppearance/WorkspaceName/index.jsx:25 | `onChange=` WorkspaceName/index.jsx:25 | 8 | correct (1 rooted, 7 `rooted:false` because they caused no new mutation) |
| 10 | 7 | click Save (CTAButton) | `() => onClick?.()` components/lib/CTAButton/index.jsx:10 | `<button onClick={() => onClick?.()}>` CTAButton/index.jsx:8-10 | 1 | correct by definition (element-bound prop). It is a no-op here: GeneralAppearance/index.jsx:55 passes no `onClick` to `<CTAButton type="submit">` |
| 11 | 7 | submit workspace settings form | `handleUpdate` pages/WorkspaceSettings/GeneralAppearance/index.jsx:26 | `<form onSubmit={handleUpdate}>` GeneralAppearance/index.jsx:50 | 1 | correct |
| 12 | 8 | click Delete Workspace | `deleteWorkspace` pages/WorkspaceSettings/GeneralAppearance/DeleteWorkspace/index.jsx:13 | `onClick={deleteWorkspace}` DeleteWorkspace/index.jsx:45 | 1 | correct |

Totals: 23 correct across 12 distinct functions, matching `summary.credited` = 23 and `distinct_credited_functions` = 12. 0 unrooted_global, 0 wrong.

### Abstentions (10)

| Step | Actions | Ran at depth 0 | Element-bound? | Verdict |
|---|---|---|---|---|
| 2 | 9 keydowns in the NewWorkspace modal `<input name=name>` (components/lib/Modal/index.jsx:228, no onKeyDown) | MicButton/index.jsx:33 `onKey` (`document.addEventListener("keydown")` line 37); utils/keyboardShortcuts.js:107 `handleKeyDown` (window, line ~118); components/Sidebar/SidebarToggle/index.jsx:38 `toggleSidebar` (window, line 55) | no. `bound_handlers` = NewWorkspace.jsx:75 `hideModal`, a component prop, which did not run | justified (9) |
| 7 | click on workspace-name `<input>` (seq 1326) | components/WorkspaceChat/index.jsx:192 (`document.addEventListener("click")`); ThreadItem/index.jsx:178 `outsideClick` (document, line 201) ×2 | no, the input has only `onChange` | justified (1) |

The listener list on the step-2 abstentions omits `useModalEscape.handleEscape` (window keydown, hooks/useModalEscape.js:11). That listener did run on those keydowns but was recorded under the step-1 click; see G.

### Uncredited click/submit/change actions

- Step 2: input click, `change`, and the submit-button click before `submit`.
- Step 7: `change`.

None has a first-party depth-0 enter, so there are **0 misses**. The pre-step focusin (page 1, seq 12) did run the bound `onFocus` (PromptInput:362). It is outside the graded steps and has no credit in actions.json. It is not a graded miss, but the harness excluded it silently.

## E. Unattributed requests and backend joins

### In-session unattributed (22; the 22 others precede their page's first dom.action)

| seq | Request | Last dom.action before it |
|---|---|---|
| 603 | GET /api/workspace/tracer-g2/chats | step 2 submit (seq 244) |
| 617 | GET /api/workspace/tracer-g2 | step 2 submit |
| 618 | GET /api/setup-complete | step 2 submit |
| 619 | GET /api/system/logo | step 2 submit |
| 620 | GET /api/workspace/tracer-g2/parsed-files | step 2 submit |
| 621 | GET /api/setup-complete | step 2 submit |
| 625 | GET /api/setup-complete | step 2 focusin (seq 622) |
| 695 | GET /api/workspace/tracer-g2/parsed-files | step 3 click (seq 637) |
| 696 | GET /api/workspace/tracer-g2/thread/89bbfe22-…/chats | step 3 click |
| 697 | GET /api/workspace/tracer-g2 | step 3 click |
| 698 | GET /api/setup-complete | step 3 click |
| 699 | GET /api/system/logo | step 3 click |
| 700 | GET /api/workspace/tracer-g2/parsed-files | step 3 click |
| 701 | GET /api/setup-complete | step 3 click |
| 705 | GET /api/system/document-processing-status | step 3 focusin (seq 702) |
| 886 | GET /api/workspace/tracer-g2/parsed-files | step 5 click (seq 800) |
| 887 | GET /api/workspace/tracer-g2/chats | step 5 click |
| 897 | GET /api/workspace/tracer-g2 | step 5 click |
| 898 | GET /api/setup-complete | step 5 click |
| 899 | GET /api/system/logo | step 5 click |
| 900 | GET /api/workspace/tracer-g2/parsed-files | step 5 click |
| 901 | GET /api/setup-complete | step 5 click |

The bridge-on runs (`g2-anything-llm-2026-09-23`, `-r2..r4`) attributed 49. The 22 extra unattributed requests here account for the whole drop. They cluster at three navigations (create workspace, new thread, delete thread) and share one cause: the chat view's reload after its route data changes.

### Three traced to source

1. **GET /api/workspace/:slug/chats (seq 603, 887) and /thread/:t/chats (696).**
   - Issued by `Workspace.chatHistory` (models/workspace.js:67-68) and `Workspace.threads.chatHistory` (models/workspaceThread.js:77).
   - Caller: the `getHistory` effect in components/WorkspaceChat/index.jsx:52-72, with deps `[workspace, loading, threadSlug]`.
   - Records: that effect (manifest function 1942-2490) entered only once under the step-2 submit, at seq 501-504, on mount when `workspace` was still null. Its re-run after `setWorkspace` has no `function.enter` row at all, so it ran with no ambient action.
   - That `setWorkspace` is in pages/WorkspaceChat/index.jsx:35-56 `getWorkspace`, after `await Promise.all([getSuggestedMessages, agentCommandAvailable])`. The Promise.all members' `.then` continuations are recorded under the action (models/workspace.js:9826/9962, seq 594-598), but the resumption of `getWorkspace` after the combined promise is not.
   - Plausible cause: the action is lost at the `await Promise.all(...)` resumption, or the state receipt for the `setWorkspace` it calls is refused. Either way the dependent effect runs unowned.
   - In steps 3 and 5 the trigger is instead the `navigate()` in the click handler's await continuation (utils/paths.js, seq 661 under the step-3 click). react-router's own location state update drives the `threadSlug` change, which is library-owned state, so the dependent effect is not linked (`state_receipts_refused` is non-zero in stamp stats).
2. **GET /api/workspace/:slug/parsed-files (620, 695, 700, 886, 900).**
   - Issued by `Workspace.getParsedFiles` (models/workspace.js:292).
   - Called from `fetchFiles` in components/WorkspaceChat/ChatContainer/PromptInput/AttachItem/index.jsx:35-39, run from an effect.
   - `ChatContainer` mounts only after `setLoaded(...)` in the unowned `getHistory` continuation (item 1). Its mount effects therefore inherit no action. This is a cascade of item 1.
3. **GET /api/workspace/:slug + GET /api/setup-complete pairs (617/618, 697/698, 897/898).**
   - Issued by `fetchModelName` in components/WorkspaceChat/ChatContainer/WorkspaceModelPicker/index.jsx:34-40, which calls `Promise.all([Workspace.bySlug(slug), System.keys()])`. `System.keys` is models/system.js:61-62 and fetches `/setup-complete`.
   - LLMSelector/index.jsx:42 has the same `Promise.all` pattern.
   - Same cascade: these components mount inside the `ChatContainer` that the unowned `getHistory` continuation reveals.
   - GET /api/system/document-processing-status (705) comes from components/WorkspaceChat/ChatContainer/DnDWrapper/index.jsx:59 (`System.checkDocumentProcessorOnline`) and is the same cascade.

### Backend joins

For every one of the 27 attributed requests:
- the request's trace_id has exactly one server span in `spans.jsonl`;
- its `parent_span_id` equals `request.trace_context.span_id`;
- `http.method` equals the request method;
- the `route.dispatch` row in `joined-backend.jsonl` names the same span.

All 27 pass. All 44 unattributed requests also have a unique server span, so they are joinable once attributed. There are 104 server spans and 71 request traces; the other 33 server spans do not match any captured request and were not graded.

## F. Stamps

I recomputed the 12 distinct acted-on element keys independently: file sha256 at the commit == placement hash == key prefix, `<tag` at `start`, and `line`. Result: 12/12. Across all 192 rows, 0 fail.

| Key | File:line | tag | Renders acted-on element? |
|---|---|---|---|
| p_bcdfa427f698:11548-12595#n1 | components/WorkspaceChat/ChatContainer/PromptInput/index.jsx:352 | textarea | yes |
| p_25511dc1202f:6108-6564#n1 | components/Sidebar/SearchBox/index.jsx:196 | button | yes (`onClick={showNewWsModal}`) |
| p_ed834b44909a:8620-8805#n1 | components/lib/Modal/index.jsx:228 | input | yes (shared ModalInput) |
| p_ed834b44909a:10547-10746#n1 | components/lib/Modal/index.jsx:293 | button | yes (shared ModalPrimaryButton) |
| p_05d69e9db9b7:6979-8151#n1 | components/Sidebar/ActiveWorkspaces/ThreadContainer/index.jsx:214 | button | yes |
| p_adf13beff628:4816-5262#n1 | .../ThreadItem/index.jsx:136 | button | yes |
| p_adf13beff628:8281-8577#n1 | .../ThreadItem/index.jsx:264 | button | yes (Rename) |
| p_adf13beff628:8584-8897#n1 | .../ThreadItem/index.jsx:272 | button | yes (Delete) |
| p_25b364a91be9:8497-10305#n1 | components/Sidebar/ActiveWorkspaces/index.jsx:186 | button | yes |
| p_97668e7566e7:526-1026#n1 | pages/WorkspaceSettings/GeneralAppearance/WorkspaceName/index.jsx:15 | input | yes |
| p_f067e70e6029:117-485#n1 | components/lib/CTAButton/index.jsx:8 | button | yes (shared CTAButton) |
| p_0631020dadc8:1296-1805#n1 | pages/WorkspaceSettings/GeneralAppearance/DeleteWorkspace/index.jsx:43 | button | yes |

`coverage.json` `stamps.per_step` records interactive elements stamped as 190/190 and visible interactive as 184/184, 100% at every step. I cannot recompute this without the DOM. It is the harness's live-page count.

## G. Stale action_id on later listener dispatches (defect)

69 `function.enter` rows with `invoked_by=event` occur after a later dom.action on the same page but carry an earlier action_id. None is depth-0: their spines, 6 to 26 frames long, chain back through the earlier action's mount/state effects, which is where the listeners were registered.

| Registered under | Dispatched during | Listener | Rows |
|---|---|---|---|
| step 1 click `muene27k:3` | step 2 keydowns | hooks/useModalEscape.js:11 `handleEscape` (window keydown) | 9 |
| step 2 submit `muene34b:27` | later focusin/click (steps 2, 4, 5) | ThreadContainer/hooks.js:19 `handleMouseEnter`, :25 `handleMouseLeave` | 4 |
| step 6 click `muene818:42` | step 7 keydown/input | ThreadContainer/hooks.js:33 `handleKeyDown` (9), :40 `handleKeyUp` (9); SidebarToggle `toggleSidebar` (9); keyboardShortcuts `handleKeyDown` + `getShortcutKey` (27) | 54 |
| step 5 click `muene6u3:39` | step 5 focusin | ThreadContainer/index.jsx:105 timer callback inside `removeThread`, a legitimate continuation | 2 |

That makes 67 stale listener dispatches plus 2 legitimate continuations. The bulletproof-react run has 9 rows of this shape, all legitimate request continuations.

Effect:
- **Credits: none changed.** Every stale row has a non-empty enclosing spine, so `indexEntryHandlerUnits` never makes it a candidate. The step-6 click is still credited to its own depth-0 handler (seq 922).
- **Requests: none changed.** No request is attributed to an action that has a later click/submit/keydown/input/change action before it on the same page.
- **Reasons: 9 wrong.** The 9 step-7 keydown actions get `entry_frontier: "no first-party function entered on this action"`, but the global keydown listeners did run for them. With correct ownership they would be the same `stopped_at: entry_handler` abstention as step 2. The category is `none` either way, so the counts are unaffected. The step-2 abstentions also omit `handleEscape` from `global_listeners`.

The cause is that a listener registered inside an action-owned effect inherits the registration-time action (`owned_listeners` in stamp stats) instead of taking the action of the event that dispatches it.

## Discrepancies with actions.json / summary.json

- `summary.dom_actions` = 67 against 68 dom.action rows. The page-load focusin (page 1 seq 12, bound `onFocus` ran) is counted as `outside_steps` in harness-stdout and absent from actions.json.
- The 9 step-7 keydowns are reported as "no first-party function entered". The correct reason is an abstention with global listeners, as explained in G.
- `summary.unattributed_requests` = 44 includes 22 pre-session requests. The in-session figure is 22.
- All other counts match my recomputation: 23 credited, 16 rooted, 10 abstentions, 27 attributed, 27 exact joins.
