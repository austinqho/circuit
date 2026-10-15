# Independent grade: `fix/mcp-rendering` (2026-09-24)

Branch `fix/mcp-rendering` in `/Users/austinho/dev/tracer-pr2`, rebased on `main` `ff9210ee`. Commits `e2e716a2`, `2004f45a`, `6fd7691e`. Files changed: `mcp/tools.mjs` (+199/−27), `collector/store.mjs` (+68), `test/mcp.test.mjs` (+223), `docs/gates/G4-mcp.md` (+20/−4).

The claim under test is that the MCP says everything the records already know. The change is rendering only, with no engine, join or credit change.

**Method.** Everything was checked black-box over stdio. A small JSON-RPC client, written for this grade (`scratchpad/rpc.mjs`), spawns `node mcp/server.mjs --store … [--manifest …] [--source-root …]`, sends `initialize` and then `tools/call`, and records `structuredContent` and `content[0].text`. `main` ran from a `git archive main` snapshot in scratch, so no other worktree was touched. Expected values come from raw `records.jsonl[.gz]` and `spans.jsonl[.gz]` through an independent Python checker (`scratchpad/work/verify.py` and `verify2.py`), which imports no Tracer code. The G6 store was gunzipped into scratch and served from there. No code was modified. This file is the only one written in the worktree.

## Verdict: **merge with changes**

Required before merge:

1. **Wrong function names appear in rendered output.** The claim says names are never invented, and this breaks it. At read time the renderer names functions with `functionNameAt` from `collector/store-writer.mjs`. That function is unchanged, but its output was not rendered before this change. Its assignment regex has an optional type-annotation group, `(?::\s*[^=;{}()]*?)?`. That group can span earlier object-literal properties, so the leftmost identifier wins instead of the property that holds the function. Reproduced:
   - `register('text', { required: true, onChange: (e) => … })` gives `"required"`.
   - `{ enabled: false, onSuccess: () => … }` gives `"enabled"`.

   Wrong names in the final7 output from this branch:
   - Segments (4) and (7) of the graded **agent-create** action show `queryKey packages/data-provider/src/react-query/react-query-service.ts:488`. The function at that position is the `queryFn` arrow.
   - `queryKey client/src/data-provider/SSE/queries.ts:222`, in the login and `:35` actions.
   - `store packages/client/dist/index.mjs:6002`, as the entry handler of `action:mud8t450:21`. The real property is `children`.
   - `required …/EditMessage.tsx:158`, as the entry handler of `action:mud8squr:9`.
   - Two more `queryKey` hops in the login action.

   A scan of every function in the G4 manifest that has a hash-matching checkout flags 36 of 433 named functions. At least 9 of the 36 are correct `const X: React.FC = …` names, so at most 27 are wrong names of this kind.

   Fix: stop the annotation clause from crossing `,` or a newline, or require the identifier to sit directly before `:` or `=`. Alternatively, render these frames as `<anonymous>`. `functionNameAt` also feeds store-writer enrichment and the G6 `name_match` remap on `main`. A fix inside it therefore needs `test/g6-grader.mjs` rerun. A read-time-only guard in `functionInfo` avoids that.

Recommended (not blocking):

2. **`outcome.status` changes meaning.** The docs state the change, but it is not additive. A 2xx or 3xx credited request now makes `status` read `completed` even when the engine says `incomplete` (`stage: stopped`, `stop_reason: no_database_effect_before_idle`). This happens for 2 final7 actions (`:35`, `:19`) and 45 G6 actions. One of them is the G6 A-baseline rename submit, which stopped at `handler` with no DB evidence. An agent reading `completed` may conclude the write happened. Options: use `completed` only when `stage` is `effect`, or put the HTTP label in its own field.
3. **Sub-millisecond deferred work.** 8 G6 segments (304 GETs) are marked deferred at 0.0–0.2 ms, including `server work continued 0 ms after the response`. The arithmetic is correct, but that is below clock resolution. Add a floor such as ≥ 1 ms, or at least drop results that round to 0.
4. **Summary length.** On final7 the action `summary` reaches **17,809 chars** for the login action with 37 requests, against a maximum of 479 on main. The median is 272. Cap the number of segments rendered in the line, and keep the JSON complete.

## Per-item results

| # | Check | Result | Evidence |
|---|---|---|---|
| 1a | agent-create `action:mud8t56z:29`: segment count | **PASS** | 9 segments = 9 attributed requests (`request:60`…`request:68`), in dispatch order (sequence 57585 → 80090) |
| 1b | delete `action:mud8u8jo:38`: segment count | **PASS** | 6 segments (`request:76`…`request:81`) |
| 1c | each segment's route, handler and DB spans belong to its own request (trace_id, plus `server.parent_span_id == request.trace_context.span_id`) | **PASS** | all 68 unique final7 segments, across all 50 actions: route span = the raw exact-parent server span; handler set = raw `producttrace-express-handlers` descendants; 0 span ids shared between segments of one action; trace_id equal |
| 1d | regenerate: JSON `db_ops` = raw joined DB spans, every one present, order kept | **PASS** | `mud8smva:4` 17/17 and `mud8sys4:17` 17/17. The raw joined set is the mongodb spans under handler spans (the engine's `attachBackendSpans` rule), sorted by `start_time`. Across final7, 278 DB ops matched. One tie (`request:68`: two spans both starting at `…951000000` ns, ms clock) is kept in join order. Same set, valid order. |
| 1e | summary `×N` equals the JSON count | **PASS** | every `op collection` group in all 68 segment summaries matches `Counter(db_ops)` (e.g. regenerate `findAndModify messages ×4`, delete `find conversations ×2`) |
| 1f | the 404 inside delete renders `failed` | **PASS** | segment (5) `GET /api/messages/f5671dfe-… → route /api/messages/:conversationId 404 … [failed 404]`; header `6 requests (1 failed)`; `because` has the `server responded 404; ` prefix |
| 1g | credited handlers render the HANDLERS.md names with `--source-root` | **PASS** | `resubmitMessage EditMessage.tsx:54` (`source`); `handleRegenerateMessage (via useCallback) ContentRender.tsx:108`; `confirmDelete (via useCallback) DeleteButton.tsx:79`; `handleDownOption (via useCallback) Feedback.tsx:133`; `onSubmit (via useCallback) AgentPanel.tsx:423` (`source_via_call`) |
| 1h | inline arrows render `<anonymous> file:line` | **PASS** | `<anonymous> LoginForm.tsx:95` (login), `<anonymous> RenameForm.tsx:68` (rename), `<anonymous> ChatForm.tsx:474` (send, agent-chat) |
| 1i | without `--source-root`: `<unnamed>`, never invented | **PASS** | all 14 entry handlers are `not_recorded` / `<unnamed> file@start-end`; every lineage and spine hop is `not_recorded`; 0 names |
| 1j | no names invented anywhere (with `--source-root`) | **FAIL** | see required item 1 (`queryKey` for `queryFn`, `store`, `required`) |
| 2a | G6: every 422 attempt renders `failed` | **PASS** | both 422 actions (`mue4cr85:65`, `mue4g90c:65`): segment `failed 422`, `outcome.status: failed`, summary `[outcome failed 422]`, no `completed`; also the 6×500 and 6×503 segments render `failed` (14 in total = the raw server spans ≥ 400) |
| 2b | G6: deferred timings equal a recompute from spans | **PASS** | 293 unique G6 segments (53 actions) checked: min and max of (handler or DB span `start_time` − server span `end_time`), rounded to 0.1 ms, match `after_response_ms` and `last_after_response_ms`; no spurious marks. Note: G6 has **no DB spans**, so G6 deferred work is handler spans only. DB deferral was checked on final7 (e.g. regenerate: 17 DB spans, 0.8 → 194.8 ms). |
| 2c | deferred never affects `reached` / `stopped_at` | **PASS** | `reached`, `stopped_at`, `because`, `chain`, `requests` and `episode_id` are identical to main on all 53 G6 and 50 final7 actions |
| 3a | synthetic `key: "Enter"` + ctrl → rendered | **PASS** | own store (`ctrlKey`/`shiftKey` long form): `keydown action:s:1 (Ctrl+Shift+Enter in <textarea aria-label="Composer" name="msg">)`, `keyboard.modifiers: ["Ctrl","Shift"]`; real-runtime shape `key:{key:"Escape"}` → `Escape in <div role="dialog">` |
| 3b | request with no first-party frame → `third_party: true` + wording | **PASS** | beacon with no spine → `(2) third-party: issued by uninstrumented code during this action → GET /collect → no server span (no_exact_parent_server) [no_server_span]`; lineage of one unregistered frame → third-party, `first_party_frames: 0`; header `3 requests (1 failed, 2 third-party)`. With no manifest, that frame counts as first-party, as documented. |
| 3c | client-side reject → `rejected_client_side` | **PASS** | `submit action:r:1 → no request; the same form mutated [outcome rejected_client_side]: reached validation …` (main: `status: incomplete`); real case: G6 `A-baseline__E-frontend-early-return` after = `rejected_client_side` |
| 4a | `test/g4-grader.mjs` | **PASS 81/81** | `node test/g4-grader.mjs docs/evidence/m1-2026-09-22-final7 --manifest docs/evidence/g4-mcp-2026-09-23/manifest.json --out <scratch>` → `result: 81/81 checks pass` |
| 4b | `test/g6-grader.mjs` | **PASS 6/6** | compare JSONs regenerated with **the branch server** into scratch (same 6 pairs, `--store` only, since the fixture source root is off-limits) → `Overall: PASS (6/6 pairs)`; the same with main → 6/6; `compare_chains.stops`, `path_changed`, `path_change_reasons` and `outcome_delta.changed` identical main vs branch for all 6 |
| 4c | `stops` and frontier identical main vs branch (≥ 10 final7 actions) | **PASS** | all **50** final7 actions: 0 differences in `stops` (ignoring the added entry-handler `name`/`name_status`/`label`), `chain`, `requests`, `episode_*`, `standalone`, `reached`/`stopped_at`/`because`; `outcome` differs only by added keys, plus `status` (moved to `display_status`, see recommended item 2) |
| 4d | `mcp/tools.mjs` rendering-only; no change to `attachBackendSpans` inputs, `indexEntryHandlerUnits`, `indexWorkflowEpisodes` | **PASS** | `analysis/`, `src/` and `dist/` untouched. `collector/store.mjs` also changes, with additions only: `functionInfo` (a cache, never writes manifest rows), `isFirstPartyFunction`, `functionEnterByContinuation`, `joinedEpisodeRows`. The last is a **second** `attachBackendSpans(rows, spans)` call used only for segments; `attachBackendSpans` copies its rows (`records.map(row => ({...row}))`) and does not mutate spans. The chain path is untouched (4c). |
| 4e | `wrappedAssignmentAt` "via useCallback" never feeds the `compare_chains` remap | **PASS** | only caller: `functionInfo` in `collector/store.mjs:204`; `remapFunctionId` reads `row.name` from `manifestsByBuild` rows, which `functionInfo` never writes; `enrichManifest` (store-writer) does not call it |
| 4f | `element_history`, `compare_chains` and `recent_actions` use the same renderer | **PASS** | final7 regenerate element: `element_history.actions[i].summary` = `action_chain` text, and `segments` are deep-equal; `compare_chains.before/after.summary` = `action_chain` text; `recent_actions` summary = `action_chain` text for 50/50 |
| 5a | `npm test` | **PASS (as expected)** | `tests 648, pass 647, fail 1`; the one failure is the known `react-context-ref-semantics.test.mjs:70` ("different context objects never borrow a Provider value…") |
| 5b | `docs/gates/G4-mcp.md` §3.1 shapes vs output (spot-check) | **PASS** | segment keys exactly `index … summary` as documented; `keyboard` = `{key, code, modifiers, repeat, target, text}`; `outcome` adds `display_status, requests, failed_requests, deferred?`; `element_history` action and attempt keys and `compare_chains.before` keys match |

## Commands (reproducible)

```sh
S=<scratchpad>; W=$S/work; F=docs/evidence; SR=/Users/austinho/dev/trace-consolidated/.live-demo/librechat-m1
git archive main mcp collector analysis package.json | tar -x -C $S/main   # main snapshot, node_modules symlinked
# final7, branch vs main, 50 actions (ids from recent_actions n=50)
node $S/rpc.mjs <repo> all.json -- --store $F/m1-2026-09-22-final7 --manifest $F/g4-mcp-2026-09-23/manifest.json --source-root $SR > all-br.jsonl
node $S/rpc.mjs $S/main all.json -- (same args) > all-main.jsonl
node $S/rpc.mjs <repo> calls.json -- --store … --manifest …            # no --source-root → br-nosrc.jsonl
python3 verify.py f7-records.jsonl $F/m1-2026-09-22-final7/spans.jsonl all-br.jsonl
#   → segments 68 db ops 278 failed 1 span reused across segments of one action: 0 OK
# G6 (gunzipped into $W/g6store), all 53 actions with attributed requests
python3 verify2.py g6store/records.jsonl g6store/spans.jsonl g6-br.jsonl
#   → segments 413 db ops 0 failed 14 span reused across segments of one action: 0 OK
node test/g6-grader.mjs $W/g6store --compare $W/g6cmp-br   # → Overall: PASS (6/6 pairs)
node test/g4-grader.mjs docs/evidence/m1-2026-09-22-final7 --manifest docs/evidence/g4-mcp-2026-09-23/manifest.json --out $W/g4grade-br.md   # → 81/81
npm test   # → tests 648, pass 647, fail 1 (react-context-ref-semantics, known)
```

## Before and after, reproduced here (final7 delete, `action_chain action:mud8u8jo:38`, same store, manifest and source root)

**main `ff9210ee`:**

```
click action:mud8u8jo:38 → handler client/src/components/Conversations/ConvoOptions/DeleteButton.tsx:79 → DELETE /api/convos → route /api/convos 201 → server <anonymous>,configMiddleware → db writes delete agent_checkpoint_writes, delete agent_checkpoints, delete conversations, delete messages, delete sharedlinks, delete toolcalls: reached db / stopped at none (terminal effect observed) / because database write delete conversations joined by exact span parentage
```

**branch `6fd7691e`** (abridged at the `…`; each segment is complete in the JSON):

```
click action:mud8u8jo:38 → handler confirmDelete (via useCallback) client/src/components/Conversations/ConvoOptions/DeleteButton.tsx:79 → 6 requests (1 failed):
 (1) <anonymous> client/src/data-provider/mutations.ts:510 → <anonymous> packages/data-provider/src/data-service.ts:851 → _deleteWithOptions packages/data-provider/src/request.ts:53 → DELETE /api/convos → route /api/convos 201 → server <anonymous>,configMiddleware → db find configs, find conversations ×2, delete conversations, find messages, delete messages, delete agent_checkpoints, delete agent_checkpoint_writes, delete toolcalls, find sharedlinks, delete sharedlinks [completed 201];
 (2) … onSuccess client/src/data-provider/mutations.ts:521 → queryFn client/src/data-provider/queries.ts:96 → … → GET /api/convos → route /api/convos 200 → server <anonymous> → db find conversations [completed 200];
 (3) … GET /api/projects → route /api/projects 304 → server listProjects → db find chatprojects [completed 304];
 (4) … GET /api/tags → route /api/tags 304 → server <anonymous> → db find conversationtags [completed 304];
 (5) <anonymous> client/src/data-provider/mutations.ts:510 → <anonymous> packages/data-provider/src/data-service.ts:851 → … 3 more hops … → <anonymous> client/src/data-provider/Messages/queries.ts:101 → … → GET /api/messages/f5671dfe-05e8-56bb-9f02-6aea011ec4a5 → route /api/messages/:conversationId 404 → server <anonymous>,prepareMessageRequestValidation → db find conversations, find messages [failed 404];
 (6) … GET /api/agents/agent_YAQ8Y1HJYBF3MirpqmkeZ → route /api/agents/:id 304 → server getAgentHandler,<anonymous>,<anonymous> → db find systemgrants, aggregate $cmd ×2, find aclentries, find users [completed 304]
 [outcome completed 201]: reached db / stopped at none (terminal effect observed) / because database write delete conversations joined by exact span parentage
```

Main showed one request, the writes only, and no handler name. It dropped the 5 follow-up requests, including the 404. The branch shows all 6 requests, each joined only to its own trace. The segment spans were checked against raw `spans.jsonl`.

## Residual risks

- **Wrong names.** See required item 1. The same regex runs in the store writer's `enrichManifest` and in `remapFunctionId`'s `name_match` on `main`, so this is also a latent G6 remap risk outside this PR.
- **`<unnamed>` when manifests lack names.** The G4 manifest has 0 `name` fields (1640 functions), so every name depends on `--source-root` with a hash-matching checkout. Without one, all frames render `<unnamed> file@start-end`, which is correct but uninformative. The G6 store served without its fixture shows `<unnamed>` everywhere. With no manifest at all, every frame renders `<not in manifest> function:<hash>:…`, which is noisy.
- **`(via useCallback|useMemo|memo)` labels.** They are correct as "the function passed to `X = useCallback(…)`". But `isUserProvided (via useMemo)` credited as a click handler (`action:mud8samh:2`) names a memo factory, and an agent may read that as the handler. That is a credit question, not a rendering one.
- **Summary length.** 17.8k chars for 37 requests. Long lineages are trimmed to 6 hops, but the number of segments is not capped.
- **Action-level vs segment-level wording.** On `:35` and `:19`, the action tail says `stopped at handler / because no database span descends…` for the credited request, while other segments in the same line list DB ops. This is correct but easy to misread.
- **Third-party wording.** In the synthetic check, a same-origin request whose frontend lineage holds only unregistered frames, but which reached a first-party server span (`/api/other 500`), is worded "issued by uninstrumented code". That is accurate for the frontend but may confuse. final7 and G6 have 0 third-party segments, so this path is exercised only synthetically.
- **Keyboard modifiers.** The current runtime (`src/runtime-attribution-browser.js:407`) records only `key: {key}` on `keydown` (`Enter`/`Escape`/`Tab`/`Printable`/`Other`), with no modifiers. `Ctrl+…` therefore appears only when a row carries `ctrl`/`ctrlKey`, which today is only synthetic data. final7 keydown rows have no `key` and render `key not recorded`.
- **Clock resolution.** final7 spans have ms `start_time`. Ties keep join order, and deferral below 1 ms is noise (recommended item 3).
- **Fallback join without an occurrence id.** Segments of requests without `request_occurrence_id` fall back to "sole request of its action". The fallback was not exercised here, because every final7 and G6 request has an occurrence id.

## Regrade at `5092270d` (2026-09-24)

This is a short regrade after the author's fix commit `5092270d`. The fix changes `functionNameAt` (`collector/store-writer.mjs`) and the matching `wrappedAssignmentAt` rule in `collector/store.mjs`. It also adds a `responded` outcome, a 1 ms floor for deferred work, and a cap of 5 requests shown inline in the summary. The method is the same as above: black-box stdio calls on the same stores and the same raw-span checker. The checker now expects `completed` only when a 2xx/3xx request also has a joined DB span, otherwise `responded`, and it applies the 1 ms floor.

### Verdict: **merge**

The required item (wrong names) is fixed, and the three recommended items are handled. One thing stays **unverified**, not passed. The name-based remap in `compare_chains` (`remapFunctionId` `name_match`) reads `name` from manifest rows. Every manifest in the banked stores has 0 `name` and 0 `text_sha256` fields: 0 of 1640 in the G4 manifest, and 0 of 5101 in each of the 3 G6 build manifests. So the changed `functionNameAt` never reaches the remap on the banked evidence. On G6 the remap resolves by `ordinal`, not by name. The fix will reach the remap only once a store is written with enrichment (a checkout plus `enrichManifest`). Grade that path on such a store before relying on name-based remaps.

| # | Check | Result | Evidence |
|---|---|---|---|
| R1 | The previously wrong names now render correctly | **PASS** | `queryFn …react-query-service.ts:488` (was `queryKey`); `queryFn …react-query-service.ts:502`; `queryFn client/src/data-provider/SSE/queries.ts:222`; `queryFn …FavoritesList.tsx:251`; `children packages/client/dist/index.mjs:6002` (was `store`); `onChange …EditMessage.tsx:158` (was `required`). All `name_status: source`. |
| R2 | No new wrong names | **PASS** | Random sample of 15 named frames from the final7 output (seed 20260924), each read against the source at its offset. All 15 are the binding or key that directly holds the function: e.g. `mutationFn`/`onMutate` `Auth/mutations.ts:40/42`, `queryFn queries.ts:96`, `handleRenameSubmit Convo.tsx:78`, `getAvailableTools data-service.ts:380`, `_put request.ts:41`, and `confirmDelete`/`handleClick`/`handleTextareaBlur`/`updateConversation (via useCallback)`. The earlier manifest-wide scan (433 named) now flags 17, down from 36, and all 17 are correct `const X: Type = …` bindings, which the scan flags by construction. Answer-key names unchanged: `resubmitMessage`, `handleRegenerateMessage`, `confirmDelete`, `handleDownOption`, `onSubmit`. Without `--source-root`, every name is still `not_recorded` / `<unnamed>`. |
| R3 | The G6 rename submit renders `responded` | **PASS** | A-baseline `action:mue48zaw:65`: `… route /api/workspace/:slug/update 200 → server validatedRequest,<anonymous>,<anonymous> [responded 200; no effect evidence] [outcome responded 200; no effect evidence]: reached handler / stopped at handler …`. The C-fix-r2 run `action:mue4jjss:65` renders the same way. The 422 run stays `failed 422`. |
| R4 | `completed` never shown where the engine status is not completed | **PASS** | final7, 50 actions: (engine status → rendered) completed→completed 11, incomplete→incomplete 37, incomplete→responded 2. G6, 53 actions: incomplete→responded 45, incomplete→failed 8. 0 actions with `outcome.status` or `[outcome completed` while the engine status ≠ `completed`. For each request: `completed` only with `stopped_at: null`, meaning a DB span was joined (final7: 58); every `responded` carries `note: "no effect evidence"` (final7 8, G6 399). |
| R5 | Joins, DB lists, `×N`, deferred values match the raw spans | **PASS** | `verify4.py`: final7 68 requests, 278 DB ops, 1 failed, 0 spans shared between requests: OK. G6 413 requests, 14 failed: OK. The deferred floor holds: G6 now has 0 deferred requests (it had 8 marks under 1 ms before). final7 has 5, the smallest 1.3 ms. |
| R6 | `stops`, frontier and `compare_chains` unchanged vs main | **PASS** | 0 differences on all 50 final7 and 53 G6 actions. On all 6 G6 pairs, `stops`, `path_changed`, `path_change_reasons` and `outcome_delta.changed` are identical to main. |
| R7 | Summary length | **PASS** | Longest summary: 2,881 chars on final7 (was 17,809) and 3,128 on G6. The login summary ends with `… 32 more requests (see segments)`, and the JSON keeps all 37. |
| R8 | `test/g4-grader.mjs` | **PASS 81/81** | `result: 81/81 checks pass` |
| R9 | `test/g6-grader.mjs` | **PASS 6/6** | Compare results regenerated with the `5092270d` server into scratch, then `Overall: PASS (6/6 pairs)`. |
| R10 | `npm test` | **PASS (650/651)** | `tests 651, pass 650, fail 1`. The failure is the known `react-context-ref-semantics` test ("different context objects never borrow a Provider value…"). |
| R11 | Name-based remap (`compare_chains`, `name_match`) under the new rule | **UNVERIFIED** | Not exercised by the banked stores (no `name` fields in any manifest; see the verdict above). |

Residual risks from the first grade still stand, apart from those fixed here: names depend on `--source-root`, the runtime records no keyboard modifiers, the third-party label is decided from the frontend call stack alone, and the no-occurrence-id fallback is unexercised. One addition: `responded` is now the most common G6 outcome (45 of 53). That is correct because the G6 backend has no DB instrumentation, but it means G6 can never show `completed`.
