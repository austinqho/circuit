# G2 grade: bulletproof-react, bridge-off rerun (independent)

Grader: independent recomputation from `records.jsonl`, `stamps.jsonl`, `attribution-manifest.json`, `observed-requests.json` and fixture source at `9506629ed003a561c6627735480cce4994244bb4` (fixture HEAD = that commit at grading time; sources read with `git show <commit>:<path>`). Manifest and stamp offsets are UTF-16/character offsets, not byte offsets. The harness's `actions.json`, `summary.json`, `ACTIONS.md` and `STAMPS.md` were used only to find the harness's claims and then checked against the evidence.

## Summary

| Item | Result |
|---|---|
| dom.action rows (all in steps) | 336 |
| Credits: correct | **12** |
| Credits: unrooted_global | **1** (subtype `route_loader`) |
| Credits: wrong | **0** |
| Abstentions (`stopped_at: entry_handler`) | 2, both **justified** |
| Misses (element-bound handler ran, not credited) | **0** |
| Requests: records (non-internal) vs Playwright | 12 = 12, method+path multisets identical |
| Requests attributed / unattributed | 9 / 3 (1 before first action, 2 hover prefetches) |
| Capture | 1 page, `sequence` 1..858 contiguous, 0 duplicates; `stamp_sequence` 1..146 contiguous; 0 `capture.dropped` / `capture.limit` rows; React 18.3.1 |
| Transport | runtime wrappers only: `requestBridge:false` in wrapper config and build-gates; `served_transport.bridge_assets=[]`, `index_references_bridge=false`; no bridge fields on request rows (all `transport: xhr`) |
| Stamps sampled | 12 acted-on element keys checked: hash, key, `<tag` at start, line: 12/12. All 146 stamp rows pass hash/tag/line |
| Async-loss (item D) | all 4 previously lost requests are now attributed, to the right actions |
| Stale-action listener rows (item G) | 9 rows. All are legitimate promise continuations of the earlier action's own requests. 0 credits or requests affected |

Compared with the G2 doc's bridge-on count (12 correct, 3 route_loader): this run has 12 correct and 1 route_loader. The other two route-loader clicks (Register link, discussion "View" link) now abstain. Credited drops from 15 to 13, and attributed requests rise from 5 to 9.

## A. Requests

- `network.request` rows: 12, all `internal:false`. None match `/__capture`, `/__producttrace/` or `/__spans`. `observed-requests.json`: 12.
- The method+path multisets are identical: GET /api/auth/me, POST /api/auth/register, GET /api/discussions ×2, POST /api/discussions, GET /api/discussions/:id, GET /api/comments ×3, POST /api/comments, DELETE /api/comments/:id, POST /api/auth/logout.
- Row fields are the runtime-evidence set only (`transport`, `trace_context`, `linkage_kind`, `spine`, ...). There is no bridge-origin field, and the string `bridge` does not occur in records.jsonl. `wrapper-vite.config.mjs` passes `producttrace({"requestBridge":false,"stamps":true})`. `coverage.json`: `bridge_posts: 0`, `transports.carried_by: runtime wrappers`.
- Backend: the mock API is not instrumented, so there are no spans. All 9 attributed requests stop at `network`, as reported.

## B. Capture

One page (`muen33gh-dkwj9b93uo`): 858 rows, `sequence` 1..858, contiguous, no duplicates. Stamps: 146 rows, `stamp_sequence` 1..146, contiguous. There are no `capture.dropped` or `capture.limit` rows, and `coverage.capture_limits = []`. React is 18.3.1 (`apps/react-vite/node_modules/react/package.json`).

## C. Handler credits (per group)

Method: for each dom.action, I took the depth-0 `function.enter` rows (`invoked_by=event`, spine length 1) under that action_id, mapped them through the manifest to the fixture source, and compared them with the JSX binding and the recorded `bound_handlers`.

| # | Step | Event / target | Credited function (file:line) | JSX binding | Actions | Grade |
|---|---|---|---|---|---|---|
| 1 | 1 | click `<button>` Get started | `handleStart` apps/react-vite/src/app/routes/landing.tsx:13 | `<Button onClick={handleStart}>` landing.tsx:34 | 1 | correct |
| 2 | 3 | submit (register form) | `(values)=>{registering.mutate(values)}` features/auth/components/register-form.tsx:30 | `onSubmit=` register-form.tsx:30 → `form.handleSubmit(onSubmit)` components/ui/form/form.tsx:198 (RHF wrapper bound to the form) | 1 | correct |
| 3 | 4 | click `<a>` NavLink "Discussions" | route `lazy` thunk app/router.tsx:49 (`import('./routes/app/discussions/discussions')`) | none. NavLink has only a library onClick, and `bound_handlers.ids=[]` | 1 | **unrooted_global / route_loader** (credited because it owns GET /api/discussions; `rooted:true`) |
| 4 | 5, 7 | click `<button>` drawer trigger | `onOpenChange` components/ui/form/form-drawer.tsx:42 | Radix `onOpenChange` on the drawer root (form-drawer.tsx:42) | 2 | correct |
| 5 | 5 | submit create-discussion | features/discussions/components/create-discussion.tsx:49 | `onSubmit=` create-discussion.tsx:49 via RHF | 1 | correct |
| 6 | 7 | submit create-comment | features/comments/components/create-comment.tsx:53 | `onSubmit=` create-comment.tsx:53 via RHF | 1 | correct |
| 7 | 8 | click `<button>` delete trigger | `onOpenChange` components/ui/dialog/confirmation-dialog/confirmation-dialog.tsx:48 | Radix root `onOpenChange` confirmation-dialog.tsx:48 | 1 | correct |
| 8 | 8 | click `<button>` confirm delete | features/comments/components/delete-comment.tsx:48 | `onClick=` delete-comment.tsx:48 | 1 | correct |
| 9 | 9 | click `<button>` dismiss ×3 | components/ui/notifications/notification.tsx:39 | `onClick=` notification.tsx:39 | 3 | correct |
| 10 | 10 | click `<div role=menuitem>` Sign out | components/layouts/dashboard-layout.tsx:192 | `onClick={() => logout.mutate({})}` dashboard-layout.tsx:192 | 1 | correct |

Totals: 12 correct, 1 unrooted_global (route_loader), 0 wrong.

### Abstentions

| Step | Action | Ran at depth 0 | Element-bound handlers | Verdict |
|---|---|---|---|---|
| 2 | click `<a>` Register link (seq 27) | router.tsx:32 `lazy: () => import('./routes/auth/register')` | none for click. `bound_handlers` lists login.tsx:15, the `onSuccess` component prop of LoginForm, which is not a click handler and did not run | justified |
| 6 | click `<a>` discussion "View" link (seq 495) | router.tsx:56 `lazy: () => import('./routes/app/discussions/discussion')` | none for click. `bound_handlers` lists the `onMouseEnter` prefetchers (discussions-list.tsx:63, discussions.tsx:34), which did not run under this action | justified |

### Uncredited click/submit/change actions

I checked every uncredited click/submit/change action: 8 input/textarea clicks, all 8 `change` events (RHF-driven), 3 submit-button clicks that precede their `submit`, and 1 click whose target is `<html>` (step 10: the Radix dropdown opens on pointerdown). None has a first-party depth-0 enter, so there are **0 misses**. No keydown/input/focusin action has an uncredited depth-0 first-party enter either.

Observation, not a grading error: `boundHandlersFor` (src/runtime-attribution-browser.js ~645) adds every `on*` prop of every non-host ancestor fiber regardless of event type. For example, `onMouseEnter` appears in a click's `bound_handlers`. So the bound set is over-inclusive. It did not produce a wrong credit here, but it could let a component-prop function that ran as a global listener pass the binding check.

## D. The four previously lost requests (bridge-on async loss)

| Request (seq) | Now attributed to | linkage_kind | Spine (first-party) | Correct? |
|---|---|---|---|---|
| GET /api/discussions (295) after Discussions link | step 4 click `action:muen387w:138` | direct | discussions.tsx:557 `clientLoader` > get-discussions.ts | Yes, the right action. The handler credit for that action is the route_loader (unrooted_global), see C#3 |
| GET /api/discussions (475) refetch after create | step 5 submit `action:muen3aj9:255` | direct | create-discussion.tsx:49 > create-discussion.ts `onSuccess` invalidateQueries > get-discussions.ts | Yes |
| GET /api/comments (668) refetch after create-comment | step 7 submit `action:muen3et6:318` | direct | create-comment.tsx:53 > create-comment.ts `onSuccess` > get-comments.ts | Yes |
| GET /api/comments (759) refetch after delete | step 8 click `action:muen3gw6:324` | direct | delete-comment.tsx:48 > delete-comment.ts `onSuccess` > get-comments.ts | Yes |

The remaining unattributed requests:
- GET /api/auth/me (seq 1): initial load, before the first action.
- GET /api/discussions/:id (seq 492) and GET /api/comments (seq 493): fired 1 ms before the step-6 focusin/click. They come from the `onMouseEnter` prefetchers during Playwright's hover: `queryClient.prefetchQuery(getDiscussionQueryOptions(id))` at features/discussions/components/discussions-list.tsx:63, and `onDiscussionPrefetch` → `prefetchInfiniteQuery` at app/routes/app/discussions/discussions.tsx:34. `mouseenter` is not a captured action event, so there is no action to attribute them to. The bridge-on runs (`g2-bulletproof-react-2026-09-23`, `-r3`) also left these two unattributed, so this is not async loss.

## E. n/a (anything-llm only)

## F. Stamps

The first 12 distinct acted-on element keys were checked independently. The script recomputes sha256 of the file at the commit and compares it with the placement id hash and the key prefix, checks that `<tag` starts at `start`, and checks that the line number is correct. Result: 12/12. Across all 146 rows, 0 fail.

| Key | File:line | tag → host | Renders acted-on element? |
|---|---|---|---|
| p_ce24901c7a71:1821-2142#n1/#n3/#n5 | components/ui/button/button.tsx:62 | Comp → button | yes (the shared `Button` primitive; the call site is only in stamp-check `binding`) |
| p_fcba878f5720:1479-1662#n1 | features/auth/components/login-form.tsx:55 | Link → a (first_host) | yes (Register link) |
| p_7c750b8a5a4a:598-1108#n1..n5 | components/ui/form/input.tsx:18 | input | yes (shared Input) |
| p_0f58eb5dc4e3:3020-3745#kDiscussions | components/layouts/dashboard-layout.tsx:103 | NavLink → a | yes |
| p_7a4442137e65:605-1023#n1 | components/ui/form/textarea.tsx:18 | textarea | yes |
| p_639452b5c1b5:184-324#n2 | components/ui/link/link.tsx:7 | RouterLink → a | yes (shared Link; the call site is discussions-list.tsx `<Link onMouseEnter>`) |

On primitives (Button/Input/Link), the stamp points at the shared component's JSX, not the call site.

`coverage.json` `stamps.per_step` records interactive elements stamped as 83/83 and visible interactive as 76/76, 100% at every step. I cannot recompute this without the DOM. It is the harness's live-page count.

## G. Stale action_id on later listener dispatches

There are 9 `function.enter` rows with `invoked_by=event` whose `sequence` is after a later dom.action on the same page while they carry an earlier action_id. None is depth-0. They are api-client.ts response-interceptor, get-comments.ts and paths.ts frames inside the earlier action's own request continuations (steps 5, 7, 8, 10), which resolved after a later focusin. They are legitimately owned by the earlier action, and none is a listener dispatched by the later event. **No credit or request attribution was affected.**

## Discrepancies with actions.json / summary.json

- None in the counts: credited 13 (12 + 1), abstained 2, attributed 9, unattributed 3. All match.
- The summary does not separate the route_loader credit from correct credits. By the G2 categories, 1 of the 13 credits is `unrooted_global/route_loader`. It is credited because the design rule ("a frame that owns a request is credited whatever bound it", analysis/runtime-attribution.mjs:111-129, `if (!requests.length && binding ...)`) bypasses the binding check.
