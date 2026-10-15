# Grade: fix/stable-element-keys (2026-09-24)

This is an independent grade. It is read-only apart from this file.
- Branch: `fix/stable-element-keys` at `7b428701`, 5 commits on `main` `ff9210ee`. The last commit, `7b428701`, is the skill and G5 runbook commit, and it is included here.
- Worktree: `/Users/austinho/dev/tracer-pr3`.
- Scratch outputs are in the grader's session scratchpad and are not committed.

**Verdict: merge with changes.** The mechanism is sound. Within one React root I could not make a key resolve `exact` to more than one simultaneous element. The headline claim ("an element key never resolves to the wrong element") is stronger than what ships, for two reasons. I reproduced both:
- (a) Two React roots that mount the same component get the same keys, and every one of those keys resolves `exact`.
- (b) Index keys (`key={i}`) resolve `exact` but drift across a reorder in exactly the way this PR fixes for ordinals.

The required changes are docs-only (scope the claim and disclose). The recommended changes are small.

## Per-item table

| # | Item | Result | Evidence |
|---|---|---|---|
| 1a | `dist/` byte-identical | PASS | `npm run build` → "built byte-identical runtime (304724 bytes)". `git status` is clean. dist md5 `fec03046…` before and after. |
| 1b | Key-path escaping cannot collide | PASS (one pathological exception) | `escapeKey` is injective. `encodeURIComponent` escapes `%` and `/`, the extra set covers `!'()*~`, and `''` → bare `%`, which no non-empty key can produce. Joining by `/` is injective. `%h` cannot come from escaping, because `h` is not an uppercase hex digit. Browser check: `a/b`→`@a%2Fb`, `a%2Fb`→`@a%252Fb`, `''`→`@%`, `x~y`→`@x%7Ey`, `a b`→`@a%20b`, all distinct. The exception is the hash branch, which joins raw keys with `\u0000`: `['\uD800','x']` and `['\uD800\u0000x']` both → `%he50f09efdf736149`. That needs a lone surrogate plus NUL in a React key. |
| 1c | `%h<16hex>` only when >200 chars | PASS | The branch fires on escaped token length > 200 (200 x `x` → 200-char token; 201 → 18-char `%h…`). It also fires when `encodeURIComponent` throws (a lone surrogate), even for short keys. The measure is the escaped length, so 67 `/` (201 escaped) are hashed. |
| 1d | Ordinal fallback when two hosts share a key path in one commit | PASS | `finishStampCommit` counts `(placement_index, token)` and uses `@` only when the count is 1. Browser check: a list with a duplicated key `r2` gives both rows `#n…`. The uniqueness scope is the whole root, not the list. Two sibling lists that render the same row component with overlapping ids both fall back to ordinals (scratch: the keyed list's `r4` became `#n3` because another list also had `r4`). That is safe, but keys are lost more often than the docs suggest. |
| 1e | `instances` = max ever seen per key | PASS for safety; the cost is disclosed only in part | `stampKeyTrust` takes the max over every observation and action, store-wide: all pages and sessions, not only the list's lifetime. A truly unique element can therefore be `ambiguous` forever. That happens when the placement once rendered more than one instance anywhere in the store (another route, another session, a transition that briefly had two). This is the right default for a key-only query, and `ambiguous` still returns candidates plus a `binding` for each action. G3 discloses the "shrinks to 1" case but not the cross-page or cross-session case. For legacy rows the lower bound is actually tight: the old runtime emitted one row per key it ever stamped. That holds only if no stamp row was dropped. With a lossy live channel, a lost `#n2` row would make `#n1` wrongly `exact`. |
| 1f | Per-root scoping | **FAIL against the headline claim** (reachable, only half-disclosed) | Reproduced with a scratch fixture: `createRoot(#root)` plus `createRoot(#root2)`, both mounting `KeyedList` and `Widget`. The DOM then holds 2 nodes each for `…302-403@r4`, `…584-636#n1`, `…243-413@r4`, `…270-295@r4` and `…471-550#n1`. `resolve_element` returns `exact` for both keys. The click on root 2's "Save Other" is recorded as `@r4` with `stamp_sequence: 14`, which is root 1's Delta row: only one row exists, because the signatures are identical and `lastRowByKey` is page-global. So `element_history @r4` would merge the two elements. G3's "Known limits" does mention per-root scope, but only as "can both stamp `#n1`". It does not say that the result is `exact` on the wrong element, and neither G4 nor SKILL.md mentions it. It is reachable in practice: islands architectures, server-rendered pages that mount several widgets, embedded widgets. It does not affect the two demo apps as far as the evidence shows. |
| 2a | Fixture `stable-element-keys.mjs` | PASS 11/11 | The keyed row keeps `…514-615@r4` before and after the removal (both actions `stamp_sequence: 13`). The unkeyed Delta is `#n4` (instances 5, seq 28), then `#n3` (instances 4, seq 41). After the removal, `#n4` names Epsilon (`dom_after`). `resolve_element(#n4)` → `ambiguous`, `instances: 5`, 5 candidates, advice present. The stamp rows are one row per key at commit 1 (seq 4–31), then `#n1..#n4` are re-emitted at commit 4 with `instances: 4` (seq 35–44). Each action's `stamp_sequence` equals the row that held (13/28/13/41). |
| 2b | Reorder (the fixture has none, so I added one in a scratch copy) | PASS for React keys (id keys); **index keys drift under `exact`** | A keyed row with a unique id (`@r3` Gamma) keeps its key through `reverse()` and a removal. Unkeyed Delta goes `#n8` → `#n6`, while the key it had names a different row, and it is `ambiguous`. With `key={i}`, Delta is `@3`, then `@1` after the reverse. Before the reverse, `@1` was Beta. Both resolve `exact`, `element_history @1` has 1 observation, and both Delta clicks bind to seq 38. A reorder changes no signature, so no new row is emitted and the binding cannot distinguish the items. Only `element.label` (aria-label) tells them apart. |
| 3 | D12 | PASS 17/17 | `node test/browser/d12-stamp-neutrality.mjs <librechat-m1> <scratch>`: records A=B=C and chains A=B=C, all `first_difference` null. The normalization drops `element.stamp` rows and deletes `target.{element_key,key_kind,instances,stamp_sequence}`, nothing else. The union of the target keys in A's stamped actions is exactly `attributes, element_key, instances, key_kind, ref, stamp_sequence, tag`. `binding_placement` exists only on stamp rows, which are dropped whole. `shadow_host.element_key` does not exist in this runtime (grep finds nothing). Chains are built from the normalized rows. |
| 4a | G5 demo key over stdio | PASS | `p_f067e70e6029:117-485#n1` → `status ok, confidence exact, stamp_key_kind ordinal, instances 1`. Why N = 1: these are legacy rows (no `key_kind`). The key has exactly 1 stamp row and 9 action targets, and no `117-485#n2` exists on the page, so the family's highest ordinal is 1. |
| 4b | 5 of the 10 ambiguous keys | PASS 5/5 | The 10 are 3 families: `a9fb790cc834:1321-1339` (ToastContainer, `#n1` div at `/` plus `#n2`,`#n3` buttons on the settings page), `8f206ef3a432:1526-1809` (QuickActionButton ×3, `QuickActions/index.jsx:49`) and `7b026da57f59:4699-5033` (NavLink ×4, `WorkspaceSettings/index.jsx:136`). I sampled `1321-1339#n1`, `1321-1339#n3`, `1526-1809#n2`, `4699-5033#n1` and `4699-5033#n4`. Each returns `ambiguous` with instances 3/3/3/4/4, candidates = the whole family, and advice. Under the old runtime a `#n<i>` row exists only if i hosts of the placement existed in one commit. So `#n3`/`#n4` existing on the same page (`s_8b4e57f5`) shows that the JSX site had 3 or 4 simultaneous instances. None of the 10 has actions. |
| 4c | `element_history` binding per action | PASS | For the demo key: `element_confidence exact`, `observations 1`, 9 actions. Each carries `element {key_kind: ordinal, instances: null, stamp_sequence: null}` and `binding {basis: only_observation, stamp_sequence: 117, placement_id …117:485}`. One small inconsistency: `element.instances` is null here while `resolve_element` says `instances: 1` (the lower bound). |
| 5a | `test/g4-grader.mjs` | PASS 81/81 | The output is identical to `main`'s (diff empty after stripping timestamps). |
| 5b | `test/g5-grader.mjs` without `--source-root` | PASS (identical) | 16 PASS / 6 FAIL on both branch and main. The 6 are the file-hash and file:line checks that need the fixture checkout. Main differs from the branch only in the "source root:" path line. By construction this grader reads the banked transcript, not the live MCP. |
| 5c | `node --test test/element-stamps.test.mjs test/mcp.test.mjs` | PASS 26/26 | |
| 5d | `npm test` | PASS 645/646 | The 1 failure is `react-context-ref-semantics.test.mjs` "different context objects never borrow a Provider value…", which also fails on a `git archive main` export. 646 = main's 641 + 5 new tests. The skill commit adds no test. |
| 6 | Docs tell the agent what to do with `ambiguous` | PASS, with gaps | G3's sixth pass, G4 §2.2 and §3.1, SKILL.md step 2 and the G5 runbook all state what an ordinal key means, `ambiguous` + `instances` + candidates, and the advice: annotate a distinguishing child, or pick by time in `element_history` using `binding`/`label`, and never present the top candidate. The gaps: none of them mentions index keys (`@<i>`, see 2b), or that a React key or an N=1 ordinal is `exact` only within one React root (see 1f). G3 does not mention that the G3 stamp-row resolver returns `element_confidence: ambiguous` ("instance count not recorded") for the legacy G5 key, while the MCP says `exact`. |

## Commands

```
cd /Users/austinho/dev/tracer-pr3
npm run build                      # built byte-identical runtime (304724 bytes); git status clean
node test/browser/stable-element-keys.mjs /Users/austinho/dev/trace-consolidated/.live-demo/librechat-m1 <scratch>/sek   # pass: true, 11/11
node <scratch>/rx/driver.mjs  …    # scratch copy: + reverse, index keys, duplicate key, odd keys
node <scratch>/rx/driver2.mjs …    # scratch copy: two React roots mounting the same components
node test/browser/d12-stamp-neutrality.mjs /Users/austinho/dev/trace-consolidated/.live-demo/librechat-m1 <scratch>/d12  # 17/17
# G5 store gunzipped to <scratch>/g5store; stdio JSON-RPC client -> mcp/server.mjs --store <scratch>/g5store
node test/g4-grader.mjs docs/evidence/m1-2026-09-22-final7 --manifest docs/evidence/g4-mcp-2026-09-23/manifest.json --out <scratch>/g4-branch.md   # 81/81
node test/g5-grader.mjs docs/evidence/g5-anything-llm-2026-09-23c --out <scratch>/g5-branch.md   # same as main
node --test test/element-stamps.test.mjs test/mcp.test.mjs   # 26/26
npm test                                                     # 646 tests, 645 pass, 1 known fail
```

Key outputs (fixture actions):
```
@r4   react_key            seq 13   (before removal)     @r4  react_key          seq 13  (after)
#n4   ordinal instances 5  seq 28   (before)             #n3  ordinal instances 4 seq 41 (after)
dom_after Unkeyed: Save Epsilon -> #n4   (the old key now names another row)
```
Two roots (scratch): `DOM keys on >1 node: {…302-403@r4: 2, …584-636#n1: 2, …}`, both resolve `exact`. The root 2 click → `@r4 stamp_sequence 14` (root 1's row).

## Code notes (diff read)

- `src/runtime-attribution-browser.js`:
  - The walk collects hosts. `finishStampCommit` assigns keys after the whole root tree has been seen, so the ordinal totals are right (no subtree pruning).
  - `key_path` walks to HostRoot and includes every keyed ancestor. The render_prop clone key is prepended before the reverse, so it ends up innermost. That is correct.
  - `stampFieldsFor` reads the key's latest row at dispatch, before handlers run, so it is the pre-action state.
- `analysis/element-index.mjs`:
  - Observations join by `(page, stamp_sequence)`. The legacy family lower bound and `react_key_sites > 1` → non-exact are both correct.
  - The G3 `resolveElement` ignores `react_key_sites` and has no legacy lower bound. It is grader-only.
- `mcp/tools.mjs`:
  - The trust check runs after the multi-placement conflict check.
  - Candidates are drawn from the family on the same sessions and capped at `instances`, up to 50, with `candidates_total`.

## Residual risks

1. **Multiple React roots** (1f): the same key is on two elements at once and resolves `exact`, and the action binding points at the other root's row. This is the one real "wrong element" path. The G3 limits mention it, but G4 and SKILL.md do not.
2. **Index keys** (2b): `@<i>` is `exact` but names whichever item is at position i. Reorder and removal drift is invisible to the binding (no new row). Frequency in the two demo apps is unknown: the G5 store has zero React-keyed stamp rows.
3. **`instances` is store-wide max**: false `ambiguous` for elements that are unique now. The legacy lower bound assumes no dropped stamp rows.
4. **Row volume and per-commit cost**: every instance-count change re-emits a row for every ordinal host of that placement (a list that grows by 1 each step → O(N²) rows over a session). Every commit now also builds a `JSON.stringify` signature for every stamped host, including unchanged ones. Neither was measured. The D12 run is tiny (18 stamp rows).
5. The hash-branch join collision (1b) is pathological.
6. Sibling lists that share a row component and ids lose React keys and fall back to ordinals (1d). This is safe but degrades.

## Verdict: merge with changes

Required (docs only):
1. Scope the claim in G3's sixth pass, G4 §2.2 and SKILL.md: "an element key never names two elements at once **within one React root**". Say plainly that on a page with several React roots mounting the same component, a React key or an N=1 ordinal can be `exact` on the wrong element.
2. Disclose index keys in G3 Known limits and SKILL.md: `@<i>` from `key={index}` is positional. The agent should check `element.label` in `element_history` before attributing an action to the annotated item.

Recommended (can follow up):
3. Runtime: detect cross-root duplicates. Keep a page-level `element_key → root` map, and on a second root either suffix the key (e.g. `~r2`) or mark the rows so that `stampKeyTrust` returns non-exact.
4. Add a reorder case and a two-root case to `test/browser/fixtures/stable-keys-app` (the scratch copies above are enough).
5. Hash `JSON.stringify(path)` instead of `path.join('\u0000')`.
6. Align the G3 `resolveElement` legacy handling with `stampKeyTrust` (or document the difference). Make `element_history`'s `element.instances` match `resolve_element`'s `instances` for legacy keys.
7. Optionally scope `instances_max` to the `session` argument when one is given. Cache the signature on the stamp to avoid per-commit stringify on unchanged hosts, and measure the row count on a long LibreChat session.

## Regrade at head 9c77b4ed (2026-09-24)

The author's fix commits are `ed34619e` (runtime, index, MCP, tests) and `9c77b4ed` (docs). I reran my scratch cases against the new runtime unchanged, apart from two additions:
- The results now print `labels` and the `element_history` confidence.
- The two-root fixture exposes `window.__root2` so it can be unmounted.

| Check | Result | Evidence |
|---|---|---|
| `dist/` byte-identical | PASS | `npm run build` → "built byte-identical runtime (304724 bytes)", tree clean. |
| Two roots: never `exact` | PASS | No key is on more than one DOM node any more (was 5 duplicated keys). Root 1 Delta and root 2 "Save Other" become `302-403#n1` / `#n2`, both `ambiguous` with `instances: 2`, 2 candidates. `Widget` is `584-636#n2`, `ambiguous`, `instances: 2`. The root 2 click is recorded as `#n2`, ordinal, instances 2, seq 28, its own row. |
| Root unmount restores keys | PASS | After `__root2.unmount()`, root 1's Delta is `302-403@r4` again, with no duplicate DOM keys and `@r4` `exact`. As disclosed, `584-636#n1` stays `ambiguous` in the store (store-wide max 2). |
| Index key: clicks before and after a reorder | PASS (the author's fixture case) | Covered by the author's 18/18 fixture (`Index list` + Reverse). |
| **Index key: the key now names a different item than every action on it** | **FAIL: `exact` on the wrong element** | Scratch reorder fixture (`key={i}`, click Delta at `@3`, Reverse, click Delta at `@1`, Remove row 2). `302-403@3` has stamp rows seq 44 (`f5b1…` = Delta), 164 (`97ea…` = Beta) and 205 (`19e1…` = Alpha). Its only actions are the first Delta click and focusin, both bound to seq 44. Today `@3` is on Alpha's button. MCP `resolve_element(@3)` → `ok` / `exact`, and `element_history(@3)` → `exact` with the Delta actions. A user who annotates Alpha's Save gets Delta's history as `exact`. `stampKeyTrust` compares content only between the actions in scope (here there is one content), not with the key's latest observation. The G3 stamp-row resolver on the same records says `ambiguous`, "key content changed between observations (index-like key)", so the two resolvers disagree again. `@1` (Beta, then Delta; all 4 actions on Delta) is also `exact`. That one is right now, but the history cannot show that `@1` named Beta earlier. |
| `content_sig` stores no text | PASS | All 220 stamp rows in the scratch run have `content_sig` matching `^[0-9a-f]{16}$`. No stamp row contains any item text (Alpha…Other), inside or outside `annotation`. In source, the hash is over `name=value` or `tag:text[0..64]`. Only the hash is emitted, and `textSummary` is capped at 256 nodes and 96 chars. |
| Toggle-label false-`ambiguous` residual is disclosed | PASS | G3 sixth pass: "downgrades a unique element whose own label changed between actions (e.g. "Follow"/"Unfollow"); that is a false `ambiguous`, not a wrong `exact`". Identical-content index keys are also disclosed as undetected. |
| Browser fixture | PASS 18/18 | `node test/browser/stable-element-keys.mjs …` |
| D12 | PASS 17/17 | All `first_difference` null. The target keys in A are still exactly `attributes, element_key, instances, key_kind, ref, stamp_sequence, tag`. `content_sig` is only on stamp rows, which are dropped whole. |
| G4 grader | PASS 81/81 | |
| G5 grader (no `--source-root`) | identical | Byte-identical to the first-grade run, which matched main's apart from the source-root line. Over stdio: the demo key `…117-485#n1` is `exact`, N = 1, and `…4699-5033#n2` is `ambiguous`, 4. |
| `npm test` | PASS 650/651 | Only the known `react-context-ref-semantics` failure. |

### Final verdict: merge with one change

The two-root case is fixed in code and I verified the unmount restore. Hashing the JSON-encoded path, aligning the G3 resolver, and the docs' limits all hold. One wrong-`exact` path remains for index keys. It is exactly the scenario the claim targets: the annotated item is not the one the key's actions were on.

Required:
1. In `stampKeyTrust`, add the key's latest observation `content_sig` to the content set, on the same page as the actions in scope. The G3 resolver already uses every observation. A key whose current content differs from the content at any of its actions is then `ambiguous`, with `labels`. Add the scratch case to the fixture: click at `@3`, reorder so that `@3` shows another item, and resolve `@3` with no new action. Update G3/G4 "Scope of the claim". It currently says an index key after a reorder is "downgraded … never answered `exact`", but the downgrade only compares actions with each other.

Then merge. The remaining residuals (store-wide `instances`, the legacy lower bound on a lossy channel, row volume, identical-content index keys, toggle-label false `ambiguous`) are disclosed in G3 and are safe: they give `ambiguous`, never a wrong `exact`.

## Final regrade at head 5f5a50cf (2026-09-24)

`5f5a50cf` changes `stampKeyTrust` and the docs. The checks now run in this order: two keyed parents, then ordinal instances, then content between actions, then each action's content against the key's latest stamp row on the same page. I reran my scratch reorder case (index list, `Reverse`, `Remove row 2`) and the two-root case against this head without modification.

| Check | Result | Evidence |
|---|---|---|
| `dist/` byte-identical | PASS | `npm run build` → byte-identical (304724 bytes), tree clean. |
| The key now names another item than its actions (`302-403@3`) | PASS in both resolvers | MCP: `ambiguous`, "key content changed since the action (index-like key)", with `labels` for each action (`label: "Save Delta"`, `content_sig f5b1…`, `current_content_sig 19e1…` = Alpha). G3 `resolveElement`: `ambiguous`, "key content changed between observations (index-like key)". |
| Ordinal keys keep the instance-count reason | PASS | All 17 ordinal keys in the reorder run give "ordinal key; N instances of this placement" (15 for the Row button, 2 for the two-root Widget) in both resolvers. No ordinal key gets a content reason. The two-root run is unchanged: `#n1`/`#n2` are `ambiguous` with 2 instances, and `@r1..@r5` are `exact` after the unmount. |
| Remaining `exact` React keys | correct | `@1` shows Delta now and all 4 of its actions were on Delta. `@2`, `@r2` and `@r3` never changed content. `@0` and `@4` changed content but have no actions. The two resolvers still disagree on `@0`, `@1` and `@4`: the G3 resolver has no actions, so it says `ambiguous` whenever the observations differ. The difference only makes G3 stricter (it is grader-only), and none of the MCP's `exact` answers attributes an action to the wrong item. "G3 resolver agrees" therefore holds for every key where the MCP says `ambiguous`, not for every key. |
| Browser fixture | PASS 19/19 | |
| D12 | PASS 17/17 | Byte-identical, all `first_difference` null. |
| G4 grader | PASS 81/81 | |
| G5 grader (no `--source-root`) | identical | Same output as the earlier runs and as main. Over stdio, the demo key `…117-485#n1` is still `exact`, N = 1. |
| `npm test` | PASS 650/651 | Only the known `react-context-ref-semantics` failure. |

### Final verdict: merge

In everything I could construct, no key resolves `exact` to the wrong element within a page load: unkeyed lists, duplicate keys, index keys across a reorder and a removal, a key that moved since its actions, two React roots and a root unmount. The remaining limits are disclosed in G3's sixth pass and all resolve `ambiguous`, never a wrong `exact`:
- store-wide `instances`
- the legacy lower bound on a lossy channel
- false `ambiguous` when an element's own label toggles
- identical-content index keys
- unmeasured row volume and per-commit cost

Optional follow-up: note in G3 that the G3 resolver is stricter than the MCP for React keys whose content changed without actions.
