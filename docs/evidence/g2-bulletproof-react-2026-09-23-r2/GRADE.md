# G2 independent grade: bulletproof-react (r2)

Grader: independent re-computation from `records.jsonl`, `attribution-manifest.json` and the fixture source at
`/Users/austinho/dev/fixtures/bulletproof-react` @ `9506629ed003a561c6627735480cce4994244bb4` (HEAD matches, working tree clean).
`actions.json` was used only as the list of claims to check. Source paths below are relative to
`apps/react-vite/src/` unless given in full. One capture page (`mue2k2kl-07yvt5ba84sd`); `#n` = record sequence.

## Summary

| measure | count |
|---|---|
| dom.action rows (raw = actions.json) | 336 |
| credited rows (entry != null) | 15 in 13 groups |
| function id = `function:<sha256(file)>:<start>:<end>`, recomputed | 12/12 distinct functions match. Each span, read as UTF-16 offsets, is exactly one function expression (checked with `vm.Script('(' + text + ')')`). The manifest `source` equals the entry file/start/end in every case. |
| **correct** | **12 rows / 10 groups**: 6 rows / 4 groups are a direct JSX event prop, and 6 rows / 6 groups are library-mediated (see the note below) |
| **global-listener** | **3 rows / 3 groups** (react-router route `lazy` loaders) |
| **wrong** | **0** |
| click/submit/change rows with no entry | 20 |
| **miss** | **0** |
| **none-justified** | **20** |
| request joins | not applicable. The backend is the repository's mock API server, so there is no `spans.jsonl`. `joined-backend.jsonl` holds 5 `span.join.diagnostic` rows, all with `candidate_spans: []`. |
| attributed requests | 5, each on the expected action: POST /api/auth/register (step 3 submit), POST /api/discussions (step 5 submit), POST /api/comments (step 7 submit), DELETE /api/comments/:id (step 8 confirm), POST /api/auth/logout (step 10 menuitem) |
| unattributed non-internal requests | 7 (1 page load, 1 hover prefetch, 5 async continuations after an action) |

A library-mediated row is still graded correct, as the first-party callback a developer would name for that control, but it is not the DOM listener itself. There are two kinds:
- a `<Form onSubmit>` callback that `form.handleSubmit(onSubmit)` wraps (react-hook-form, `components/ui/form/form.tsx:198`);
- a Radix Dialog `onOpenChange` callback that the Radix `*Trigger asChild` onClick calls.

If the gate needs strictly "the function bound to the element", reclassify these 6 rows. They are listed separately below.

## A. Credited entry handlers (grouped by step, event, function)

| step | event, target | rows | credited function | verdict | evidence |
|---|---|---|---|---|---|
| 1 | click `<button>` "Get started" | 1 | `app/routes/landing.tsx:13` `handleStart` | correct | `<Button onClick={handleStart}>` at `landing.tsx:34` |
| 2 | click `<a>` "Register" | 1 | `app/router.tsx:32` register route `lazy: () => import(...)` | global-listener (route lazy loader) | The link is a react-router `<Link>` (`features/auth/components/login-form.tsx:55-60`) with no first-party onClick. The router's navigation calls the route's `lazy` during the click. |
| 3 | submit (register form) | 1 | `features/auth/components/register-form.tsx:30` `(values) => registering.mutate(values)` | correct (library-mediated) | `<Form onSubmit={...}>` at `register-form.tsx:29-32` is wrapped by `onSubmit={form.handleSubmit(onSubmit)}` (`components/ui/form/form.tsx:198`) |
| 4 | click `<a>` "Discussions" | 1 | `app/router.tsx:49` discussions route `lazy` | global-listener (route lazy loader) | `<NavLink>` at `components/layouts/dashboard-layout.tsx:103-123`, with no onClick |
| 5 | click `<button aria-haspopup=dialog>` "Create Discussion" | 1 | `components/ui/form/form-drawer.tsx:42` `onOpenChange` | correct (library-mediated) | `<Drawer onOpenChange={...}>` (a Radix Dialog, `components/ui/drawer/drawer.tsx:1`). The trigger is `<DrawerTrigger asChild>{triggerButton}</DrawerTrigger>` (`form-drawer.tsx:50`), and `triggerButton` (`features/discussions/components/create-discussion.tsx:31-33`) has no onClick of its own. |
| 5 | submit (create-discussion form) | 1 | `features/discussions/components/create-discussion.tsx:49` | correct (library-mediated) | `<Form id="create-discussion" onSubmit={...}>` (`:47-51`) goes through `form.tsx:198`. The Submit button sits outside the form with `form="create-discussion"` (`:38`). |
| 6 | click `<a>` "View" | 1 | `app/router.tsx:56` discussion route `lazy` | global-listener (route lazy loader) | `<Link>` at `features/discussions/components/discussions-list.tsx:62-71` has only `onMouseEnter` (a prefetch) and no onClick |
| 7 | click `<button aria-haspopup=dialog>` "Create Comment" | 1 | `form-drawer.tsx:42` `onOpenChange` | correct (library-mediated) | trigger at `features/comments/components/create-comment.tsx:34-36`, wrapped at `form-drawer.tsx:50` |
| 7 | submit (create-comment form) | 1 | `features/comments/components/create-comment.tsx:53` | correct (library-mediated) | `<Form onSubmit={...}>` at `:51-57`, then `form.tsx:198` |
| 8 | click `<button aria-haspopup=dialog>` "Delete Comment" | 1 | `components/ui/dialog/confirmation-dialog/confirmation-dialog.tsx:48` `onOpenChange` | correct (library-mediated) | `<Dialog onOpenChange>` at `:46-54`, `<DialogTrigger asChild>` at `:56`. The trigger `Button` (`features/comments/components/delete-comment.tsx:35-41`) has no onClick. |
| 8 | click `<button type=button>` confirm "Delete Comment" | 1 | `features/comments/components/delete-comment.tsx:48` `() => deleteCommentMutation.mutate(...)` | correct | `<Button type="button" onClick={...}>` at `delete-comment.tsx:44-48` |
| 9 | click `<button>` (notification Close) | 3 | `components/ui/notifications/notification.tsx:39` `() => onDismiss(id)` | correct | `<button onClick={...}>` at `notification.tsx:37-42` |
| 10 | click `<div role=menuitem>` "Sign Out" | 1 | `components/layouts/dashboard-layout.tsx:192` `() => logout.mutate({})` | correct | `<DropdownMenuItem onClick={...}>` at `dashboard-layout.tsx:190-195` |

## B. click/submit/change rows with no credited entry (20, all none-justified)

| step | actions | event, target | reason |
|---|---|---|---|
| 3 | `:6`, `:21`, `:32`, `:79`, `:110` | click on the firstName, lastName, email, password and teamName inputs | `Input` (`components/ui/form/input.tsx:15-26`) spreads only the react-hook-form `registration` and has no onClick. |
| 3 | `:19`, `:30`, `:77`, `:108`, `:133` | change on the same five inputs | The only handler is react-hook-form's `register()` onChange, which is library-owned and runs on React's `input` event, not on native `change`. |
| 3 | `action:mue2k5jm:135` | click `<button type=submit>` Register | There is no onClick. It performs a native submit, and the next row (`:136`) credits the submit. |
| 5 | `action:mue2k9hg:142`, `action:mue2k9p8:185` | click the title input and the body textarea | no onClick (`input.tsx`, `textarea.tsx:15-25`) |
| 5 | `action:mue2k9p6:183`, `action:mue2k9wc:252` | change on title and body | react-hook-form `register` (library) |
| 5 | `action:mue2k9wd:254` | click `<button type=submit>` Submit | There is no onClick (`create-discussion.tsx:37-44`). It performs a native submit through `form=`, and the submit is credited in `:255`. |
| 7 | `action:mue2ke2i:262`, `action:mue2ke7u:315`, `action:mue2ke7u:317` | click body, change body, click Submit | same reasons (`create-comment.tsx:40-48`, 67-71) |
| 10 | `action:mue2kjdw:333` | click `<html>` (opening the user menu) | The trigger `Button` (`dashboard-layout.tsx:172-181`, inside `<DropdownMenuTrigger asChild>`) has no first-party onClick. Radix DropdownMenu opens on pointerdown, and the resulting click lands on `<html>`, most likely because the open modal menu disables pointer events on body. The raw records show no function entered. |

## C. Request joins

Not applicable: this repository's backend is a mock API server with no OpenTelemetry instrumentation. The actions.json requests correctly carry `route: null`, `handlers: []`, and the stop reason "backend not instrumented".

## D. Unattributed requests (7)

| seq | request | when | likely cause |
|---|---|---|---|
| #1 | GET /api/auth/me | page load, before the first dom.action (#2) | `lib/auth.tsx:13-14` `getUser` (react-query-auth `useUser`) |
| #1076 | GET /api/discussions | 16 ms after the step 4 click (`action:mue2k74z:138`, #1061) | The discussions route `clientLoader` (`app/routes/app/discussions/discussions.tsx:10-21`, `fetchQuery`) runs after the route's `lazy` `import()` promise resolves. The action is lost across that promise (parent `continuation:null:promise:1165`). |
| #1598 | GET /api/discussions | 833 ms after the attributed POST /api/discussions (#1447, step 5), and 8 ms after that POST's response interceptor resumed still under the action (`lib/api-client.ts:553`, #1594-1597, action `:255`) | The mutation `onSuccess` calls `invalidateQueries` (`features/discussions/api/create-discussion.ts:37-38`). The react-query refetch continuation lost the action (`continuation:null:promise:1852`). |
| #1600, #1601 | GET /api/discussions/:id, GET /api/comments | 1 ms before step 6's focusin and click (#1602, #1603) | A hover prefetch from the View link's `onMouseEnter` (`discussions-list.tsx:62-67`) and `onDiscussionPrefetch` (`app/routes/app/discussions/discussions.tsx:34-38`, `prefetchInfiniteQuery` of comments). mouseenter is not a captured dom.action, so there is no action to attribute it to. |
| #1982 | GET /api/comments | 1004 ms after the attributed POST /api/comments (#1865, step 7) | `invalidateQueries` in `onSuccess` (`features/comments/api/create-comment.ts:39-40`); async continuation lost |
| #2222 | GET /api/comments | 458 ms after the attributed DELETE /api/comments/:id (#2138, step 8) | `invalidateQueries` in `onSuccess` (`features/comments/api/delete-comment.ts:26-27`); async continuation lost |

The 25 other network.request rows are 20 internal (`/__producttrace/bridge`) and 5 attributed.

## Discrepancies and observations about the harness output

1. The harness does not distinguish a direct DOM-bound handler from a library-mediated callback. Six of its 15 credits are react-hook-form `onSubmit` or Radix `onOpenChange` callbacks. They are correct in intent but are not the listener on the element.
2. The three route-`lazy` credits (steps 2, 4 and 6) are shown in ACTIONS.md as though they were the entry handler of the link click. They are router internals running first-party config code, and no first-party click handler exists on those links.
3. Four of the unattributed GETs (#1076, #1598, #1982, #2222) are real follow-ups of the preceding user action, lost across promise continuations (dynamic import then loader, and react-query invalidation after a mutation). They are a known attribution gap, not a harness miscount.
4. All counts in `summary.json` match the recomputation: 336 actions, 15 credited, 12 distinct functions, 5 attributed, and 7 unattributed.
