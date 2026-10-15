# G3 — Element stamps

Gate text written before code (2026-09-23), from `docs/HANDOFF-2026-09-23-agent-annotation-pivot.md` §4.2–4.3, §5.3, §6.1–6.2, §7, and the resolved unknowns in `docs/research/oai-annotation-unknowns-2026-09-23.md` (main checkout; internal only).

## Pass criterion (handoff §7, verbatim)

> **G3 Stamps.** Every interactive host element on both new repos carries `data-tracer-el`; `resolve_element` returns the correct file:line for a random sample graded against source; D12 byte-identity test (§5.3) passes; OAI attributes are emitted only when `document.oai.annotation` exists (test with a stub) and every emitted payload passes a validator implementing §4.3.

§5.3 (verbatim):

> D12 rejected "stamps as selectors." This pivot adds DOM stamps. The distinction that keeps D12 intact: **stamps are lookup keys for external agents, never inputs to attribution.** Attribution still comes only from runtime continuations and exact joins. Enforce with a test: removing all stamps from the DOM must leave `records.jsonl` / `causal-chains.jsonl` for a scripted session byte-identical apart from the stamp-lookup rows.

Scope note: "both new repos" is G2's output and does not exist yet. This gate's evidence (`docs/evidence/g3-2026-09-23/`) is on the LibreChat fixture plus a neutral Vite + React fixture; the two-repo clause stays **not reached** until G2 picks the repos.

## Decisions

### D-G3-1. Placement id (build time, unified with function ids)

A *placement* is one JSX element occurrence in first-party original source. Its id reuses the unified function-id scheme (file content hash + original start:end span, `stableFunctionId`):

```
placement:<sha256(original file content)>:<start>:<end>
```

`start` is the offset of the element's `<`, `end` the offset after its closing tag, both from the TypeScript parse of the original file (the same offsets the analyzer and `stableFunctionId` use). Fragments (`<>`, `<Fragment>`) are not placements (they render no host).

Registration is done by `runtimeAttributionPlugin` at its module transform (post-Vite JS, sourcemap available): a call to the React element factory (`jsx`/`jsxs`/`jsxDEV`/`createElement`, as an identifier or member, after the JSX transform) whose start maps through the combined sourcemap exactly onto the `<` of a JSX element in the original file is wrapped as

```js
(globalThis.__productTracePlace||Object)(<call>, <placement index>)
```

`Object(element)` returns the element itself, so with the runtime absent the application is unchanged; no function syntax is inserted (the chunk-level function pass must not see new functions). The runtime's `place(element, index)` records `WeakMap(element.props → index)` and returns the same element. The fiber of that element carries the same props object (`fiber.memoizedProps === element.props`), which is how a rendered fiber is tied to its placement. Elements whose props are re-created (e.g. `cloneElement`) lose the placement: abstain, no guessed placement.

Each module registers its placements (`registerPlacements([{index, id, file, line, tag, component}])`) where `component` is the JSX tag name for component elements (`SaveButton`) and the nearest enclosing named function/class for intrinsic elements. Placements are written to the attribution manifest under `placements`; the build fails the marker gate if a placement id is emitted twice with different indexes.

`build` = first 12 hex of sha256 over the sorted function ids and placement ids that survive into emitted chunks, injected into each first-party chunk (`registerBuild`). A key from another build is detectable as stale.

### D-G3-2. `element_key`

```
p_<first 12 hex of the file hash>:<start>-<end>#<instance>
instance = k<React key>   when the placement fiber has a key matching /^[A-Za-z0-9_.:-]{1,40}$/ and no other connected node on the page already holds that element_key
         | h<fnv1a32 of the React key>   when the key does not match that pattern (same uniqueness rule)
         | n<ordinal>     otherwise; ordinal = per (page, placement) counter, assigned when a DOM node is first stamped
```

- **Exactly one placement:** the short form is derived from the full placement id; the `element.stamp` row carries the full `placement_id`; the build refuses to emit two placements whose short forms collide (it would fall back to the full hash for both; none observed yet).
- **Instances distinguishable:** by React key when present, else by ordinal.
- **Stable across re-renders within one build:** the key is retained per DOM node (`WeakMap(node → key)`); React reuses the node across re-renders, so the value does not change. If React reuses the same node for a *different* placement (same type at the same position in a conditional), the node receives a new key for the new placement and a new stamp row; a node is never labelled with a placement that no longer renders it.
- Keys are not stable across page loads when they fall back to ordinals. That is a known limit, not a guess.

### D-G3-3. Which host elements are stamped

On every React commit (the runtime's existing `__REACT_DEVTOOLS_GLOBAL_HOOK__.onCommitFiberRoot` observer), walk the committed tree. For each host fiber `H` (`tag === 5`), build its first-host chain `C(H)`: `H`, then each ancestor fiber for which `H` is the first host (the ancestor is not a host/root/portal and the path down to `H` follows only `.child`). `H` is stamped when any of:

- T1: `H`'s props carry a registered first-party handler (`on[A-Z]*` whose value `functionIdOf` resolves);
- T2: the nearest ancestor component fiber of `H` carries a registered first-party handler;
- T3: `C(H)` contains a component placement (`H` is the nearest host of a component placement);
- T4: `H` is an interactive host (`button, input, textarea, select, a[href], [role=button|menuitem|option|checkbox|radio|switch|tab|link], [tabindex]`, the runtime's existing `interactiveFor` list plus `tab`/`link`). Per the research note, Codex's manual annotation climbs to the nearest button/link/input, so the interactive host itself must carry the key, not only a wrapper.

Its placement is the **outermost placement in `C(H)` that carries a registered handler** (where the handler binding was authored, e.g. `<SaveButton onClick={handleSave}>` in `Form.tsx`), else the **innermost placement in `C(H)`**, else the **nearest ancestor fiber with a placement** (`placement_via: "ancestor"`). A host with no placement anywhere above it is not stamped; it is counted in `stampStats().unplaced` (reported in `coverage.json`), never silently dropped.

Stamping never reads or writes application state, never changes `id`/`class`/text, and is skipped entirely when `globalThis.__PRODUCTTRACE_STAMPS__ === false`. Only the attribute `data-tracer-el` (and the OAI attributes below) are written. Shadow-root hosts keep `data-tracer-el` (OAI metadata is dropped there by OpenAI anyway).

### D-G3-4. OAI attributes

Written when **either** `typeof document.oai?.annotation?.request === "function"` **or** the dev-only opt-in `oaiAttributes: "always"` (Vite plugin option → `globalThis.__PRODUCTTRACE_OAI_ATTRIBUTES__ = "always"`) is set. Default is feature detection. Reason (research note §3): the declarative path is enabled by OpenAI's API gate, not by `document.oai`; the imperative object can be absent (frame/secure-context checks) while the declarative read still happens, so an explicit opt-in is allowed for dev builds. `"never"` disables them.

- `oai-annotatable="<component> (<basename>:<line>)"`, non-blank, ≤128 UTF-16 units, same character rules as string values.
- `oai-annotation-metadata='<json>'`, at most 6 entries, in this order: `tracer_el`, `tracer_build`, `tracer_session`, `component`, `source` (`<file>:<line>`), `tracer_last_action` (`null` until an attributed `dom.action` targets this element; then rewritten after each such action, because the attribute is read live when the editor opens).
- Every payload passes `validateAnnotationMetadata` before it is written; an invalid payload is **not** written (the element keeps `data-tracer-el`) and the reason is recorded on the stamp row (`annotation: "rejected:<reason>"`). The validator implements §4.3 exactly:
  - plain object (prototype `Object.prototype` or `null`), no symbol keys, no accessors, not an array;
  - ≤ 6 entries;
  - each key: ≤ 64 UTF-16 units, matches `^[A-Za-z][A-Za-z0-9_-]*(?: [A-Za-z0-9_-]+)*$`, and is not `__proto__`, `constructor`, `prototype`;
  - each value: `string` (≤ 256 units, matches `^[^\p{Cc}\p{Cf}\p{Cs}\u2028\u2029]*$`u, i.e. no control, format, lone-surrogate or line/paragraph-separator characters), finite `number`, `boolean`, or `null`; no nesting;
  - `JSON.stringify(payload)` ≤ 2048 UTF-8 bytes.
- Tested with a stub `document.oai.annotation` and without it.

### D-G3-5. New record rows and fields

- `element.stamp`, one per (page, element_key):
  ```json
  { "schema": "producttrace.runtime-evidence.v1", "kind": "element.stamp", "stamp_sequence": 17, "timestamp": 0,
    "session": "s_…", "element_key": "p_4f2a91c03b7e:18-44#n2", "placement_id": "placement:<sha256>:18:44",
    "file": "src/settings/Form.tsx", "line": 88, "start": 18, "end": 44, "url": "http://localhost:5173/settings",
    "component": "SaveButton", "tag": "SaveButton", "host_tag": "button",
    "placement_via": "first_host", "react_key": null,
    "handlers": [{ "event": "click", "prop": "onClick", "function_id": "function:<sha256>:120:188" }],
    "build": "a1b2c3d4e5f6", "annotation": "absent" | "written" | "rejected:<reason>" }
  ```
  `url` is `location.href` without the hash at stamp time; `start`/`end` are the placement's original-source offsets (amended 2026-09-23 at the G4 MCP's request, before evidence). `element_key` is constrained to printable ASCII without spaces, at most 256 characters; a key outside that is not stamped and is counted in `stampStats().invalid_keys`.
  Stamp rows use their **own contiguous per-page counter `stamp_sequence`** and carry no `sequence`, so emitting them cannot renumber any attribution row. The capture harness verifies contiguity of both counters.
- `dom.action.target.element_key`: added (as the last property of `target`) when `target.closest('[data-tracer-el]')` finds a stamp. Absent otherwise.
- Stamps are **lookup keys only**. No attribution code path (`indexEntryHandlerUnits`, `indexWorkflowEpisodes`, joins, chain building) reads `element_key`, `element.stamp`, or the DOM attributes. The runtime's own mutation receipts ignore attribute mutations on `data-tracer-el`, `oai-annotatable`, `oai-annotation-metadata` (they are Tracer's writes, not application effects).

### D-G3-6. Element index and `resolve_element` (pure function, no MCP yet)

`indexElementStamps(records)` and `resolveElement(index, { element_key })` in `analysis/element-index.mjs` return `{ status: "exact", element_key, placement_id, component, source: {file, line}, handlers, build }`, `{ status: "not_found" }`, or `{ status: "stale_build", build, expected_build }`. No selector/text fallback here (that is G4's `ambiguous` path). The G3 sample grader picks a seeded random sample of stamp rows, resolves each, and checks against the original source file that the text at `start` is `<` followed by the recorded tag and that `line` is the line of `start`.

### D-G3-7. D12 byte-identity test

`test/browser/d12-stamp-neutrality.mjs` builds a neutral Vite + React fixture (a form, a list with keyed and unkeyed items, a component placement wrapping a button, a fetch, a conditional re-render) with both Tracer plugins, and drives one scripted headless session three times:

- **A** stamps on (+ a stub `document.oai.annotation`, so OAI attributes and `tracer_last_action` rewrites are exercised);
- **B** stamps on, and an init-script `MutationObserver` strips `data-tracer-el` / `oai-*` from the DOM as soon as they appear;
- **C** stamps off (`__PRODUCTTRACE_STAMPS__ = false`).

Determinism is enforced by the harness, not by editing records: fixed `Date.now` (Playwright clock), seeded `crypto.getRandomValues`, a local server with fixed responses, and a settle wait after each step. Pass: after deleting `element.stamp` rows and `target.element_key`, the serialized `records.jsonl` of A, B and C are byte-identical, and so are the `causal-chains.jsonl` produced by `buildActionChains` from each (frontend-only). Also asserted: A has ≥1 stamp row and ≥1 `target.element_key`; B has stamp rows but no `target.element_key` and no stamp attribute in the final DOM; C has no stamp rows; every OAI payload in A passed the validator.

LibreChat itself is not byte-deterministic across two runs (server-generated ids in URLs, streaming interleavings), so D12 on LibreChat is not claimed.

## Second pass (2026-09-23, coordinator decisions, recorded before the rerun)

- **Placements at the chunk pass.** Placement wrappers and await continuations are applied in the same chunk pass that resolves function ids, after every id is resolved from the unedited chunk and its map; they are span-neutral by construction. Check: the same build with placements and awaits off has the identical function-id set (LibreChat: 8,364 = 8,364). The wrapper fallback is a chunk-local identity function (`__ptIdentity`), not `Object`.
- **Instance token (supersedes D-G3-2's per-page counter).** React key when present (a repeated key gets `~<n>`), else the DOM-order ordinal among the committed hosts of that placement, recomputed at every commit (commit-tree pre-order). Identical renders give identical keys across reloads.
- **`tracer_last_action`** is kept per DOM node while it renders the same placement.
- **Row contract** (G4): `element.stamp` carries `url`, `start`, `end`; `element_key` is printable ASCII, no spaces, ≤ 256.
- **Handler binding** for the credit rule (G1 D-G1-6) is read from fibers at dispatch and recorded on `dom.action.bound_handlers`, not from the DOM stamps, so D12 still holds with stamps stripped.

## Third pass (2026-09-23, coordinator decisions, recorded before the rerun)

- **Own placement first.** The stamp's placement (and `resolve_element`'s `source`) is the innermost placement of the host, which is the element's own JSX site when first-party JSX wrote it. The outermost placement whose props bind a handler is kept separately as `binding_placement` on `element.stamp`. Acceptance: at least 90% of stamp rows whose host was written by first-party JSX resolve to that JSX site; the rest are listed by cause.
- **Why the own-site share fell in the second pass.** Not G2's AST match. Two causes: (1) chunk-level minified maps rarely land exactly on the `<` of a JSX element, so the chunk pass found 1,566 placements where the module pass had found 7,467; (2) workspace packages consumed from their built output (`packages/client/dist`) are excluded from the module pass by the first-party rule, so their JSX had no placement.
- **Placements at the module pass again**, registered through the module prefix, with `Object` as the wrapper fallback there (the module is not yet a chunk). Modules excluded by the rule that ship a sibling `.map` get a placement-only pass through that map. The chunk pass still adds fallback placements for JSX the module pass did not see, skipping calls already wrapped. The span-neutrality check (same build with placements and awaits off) still applies.
- **One element index.** `analysis/element-index.mjs` holds G4's element index and G3's stamp index; `collector/element-index.mjs` re-exports it.

## Fourth pass (2026-09-23, after the independent grade)

- **Render-prop hosts.** A host element passed as a `render` prop (`render={<button …/>}`) is cloned by the component that renders it, so its props are not the placed props. When a fiber in the host's chain holds a `render` element of the same host type whose props were placed, that JSX is the host's own site: `placement_via: "render_prop"`, counted as own-site.
- **Function-child hosts.** JSX returned by a first-party function child of a library component (a render callback) that is still not placed is counted as a *first-party JSX miss*, not as library-rendered.
- **Recorded per element.** The survey records every interactive host per surface (`survey-elements.jsonl`), the own-site detail per stamped element (`survey-own-site.jsonl`), and every OAI payload as read from the DOM, with the validator's verdict (`oai-payloads.jsonl`). The identical per-variant screenshots are dropped.

## Fifth pass: known limit (recorded after the fifth-pass grade)

- **Component render props resolve to the wrapper.** The `render_prop` rule (fourth pass) matches only a `render` element of the **same host type** as the stamped host.
- A caller that passes a *component* element through a wrapper, as in `render={<Ariakit.MenuButton …/>}` handed to LibreChat's `Tooltip` (e.g. `BookmarkMenu.tsx:178`), is therefore not matched. That host resolves `first_host` to the wrapper's own JSX (`Tooltip.tsx:160`), not to the caller's JSX.
- This is consistent with the `first_host` definition. It is not a first-party-JSX miss, but it is a weaker answer for an agent: in the fifth-pass survey, 6 stamp rows and 4 survey rows per surface (the Bookmarks and Export buttons).
- It is not fixed. Matching component-typed render elements would need the component's own host to be traced through the wrapper's clone.

## Sixth pass: stable element keys (fix/stable-element-keys, 2026-09-24)

The claim: **an element key never resolves to the wrong element.** Before this pass a placement rendered N times got keys `…#n1..n<N>` by DOM-order ordinal, recomputed at every commit, and the store kept only the first element seen under each key. After a reorder or a removal the same ordinal named a different item, so an annotation on item 4's button could resolve to item 3's binding. Supersedes D-G3-2's instance token and D-G3-5's "one row per (page, element_key)".

- **Key format.**
  ```
  p_<12 hex>:<start>-<end>@<key path>    key_kind "react_key"
  p_<12 hex>:<start>-<end>#n<ordinal>    key_kind "ordinal"
  ```
  `<key path>` is the React key of the host fiber and of every keyed ancestor fiber up to the root, outermost first, each escaped with `encodeURIComponent` plus `!'()*~` (an empty key is `%`), joined by `/` (e.g. `@g/1`, `@a%2Fb%20c`). A path longer than 200 characters becomes `%h<16 hex>` (two seeded FNV-1a 32). The whole key stays printable ASCII, no spaces, ≤ 256. Walking every keyed ancestor (not only the nearest) keeps nested keyed lists apart (`@g/1` vs `@h/1`).
- **When a React key is used.** Keys are assigned after the whole committed tree has been walked (the walk only collects hosts). A host gets `@<key path>` when it has a key path and no other host of the same placement has the same path in that commit. Otherwise (no React key anywhere above, or a path shared, e.g. two unkeyed groups with keyed items) it gets `#n<i>`: the document-order ordinal among that placement's ordinal-keyed hosts in the commit.
- **Ordinal keys are honest.** Every ordinal `element.stamp` row carries `key_kind: "ordinal"` and `instances`, the number of that placement's ordinal-keyed hosts in the commit. React-keyed rows carry `key_kind: "react_key"`, `react_key_path` and `react_key_site` (placement id of the nearest keyed fiber, or null). Every `dom.action` whose target is stamped carries, after `target.element_key`, `target.key_kind`, `target.instances` (ordinal only; the count at the latest commit) and `target.stamp_sequence` (the `element.stamp` row that held for that key when the action fired).
- **One row per observation.** A new `element.stamp` row (with `commit`, the page's commit counter) is emitted whenever what a key names changes: placement, key kind, instance count, key path, key site, `binding_placement` or handler set. An identical re-render emits nothing. Removing one row of an unkeyed list of 5 re-emits `#n1..#n4` with `instances: 4`; the keyed list emits nothing.
- **Element index.** Every stamp row is an observation of its key. Each `dom.action` is joined to its observation by `(page, target.stamp_sequence)`, string equality only, never by time. Rows from runtimes before this pass have no `key_kind`: `#n<i>` and `#k…~<i>` are ordinal, `#k…`/`#h…` are React keys, and the highest ordinal of the key's family on the same page is a lower bound on the instance count. Of the 119 stamp keys in the banked G5 store, 10 are now non-exact under that rule. The G5 key (`p_f067e70e6029:117-485#n1`, no sibling) stays exact.
- **G3 resolver (`resolveElement`).** `status: "exact"` still means the placement, which is certain because the key embeds it. The new `key_kind`, `instances` and `element_confidence` fields say whether the key names one element: `element_confidence` is `"ambiguous"` (with `reason: "ordinal key; N instances of this placement"`) for an ordinal key with N > 1.
- **D12.** Unchanged: stamps still never feed attribution. The D12 harness also deletes the new target fields (`key_kind`, `instances`, `stamp_sequence`) along with `element_key`. Rerun on this branch: 17/17 checks pass, and records and causal chains are byte-identical across A/B/C. The fixture's keyed rows are now `…@a1` and `…@c3`, not `#n1`/`#n2`.
- **Evidence.** Unit: `test/element-stamps.test.mjs` (keyed and unkeyed lists through a removal; escaping, nested key paths, a shared path falling back to ordinals). Browser: `test/browser/stable-element-keys.mjs` on `test/browser/fixtures/stable-keys-app/main.jsx`, 11/11 checks.
- **Scope of the claim (after the grade, `docs/evidence/pr-stable-element-keys-grade-2026-09-24/GRADE.md`).** `confidence: "exact"` means: within one page load, the key named exactly one element at the time of every stamp row and every action in scope, that element showed the same content (label or text) at each of those actions, and that content is what the key's latest stamp row on the same page shows (what the key names now). Two cases can still make a key's meaning shift. Neither is prevented; both are downgraded to `ambiguous`, never answered `exact`:

  | Case | What happens | Test |
  |---|---|---|
  | Unkeyed repetition (ordinal `#n<i>`, N > 1) | `ambiguous`, `reason: "ordinal key; N instances of this placement"` | `test/element-stamps.test.mjs` "an unkeyed row is an honest ordinal"; `test/mcp.test.mjs` "an unkeyed row is ambiguous with every instance"; browser `plain_*` checks |
  | Same key in two React roots | Key uniqueness is page-wide: the latest committed hosts of every root are keyed together. A key that two roots would stamp falls back to ordinals numbered across roots (root first-commit order), with `instances` counted across roots, so it is `ambiguous`. After a root unmounts, the survivors get their React keys back. | `test/element-stamps.test.mjs` "a key held in two React roots falls back to ordinals counted across roots"; `test/mcp.test.mjs` "an index key whose content changed…" (two-root part); browser `page_keys_unique`, `two_roots_*` |
  | Index-like React key (`key={i}`) after a reorder or removal | Every stamp row carries `content_sig`: 16 hex of two seeded FNV-1a over the first of `aria-label`, `title`, `name`, `data-testid` (the attributes a `dom.action` target already records), else tag + the first 64 characters of trimmed text. The text itself is never recorded. A new row is emitted when `content_sig` changes. When the content differs between the actions in scope, `resolve_element` and `element_history` return `ambiguous`, `reason: "key content changed between actions (index-like key)"`. When every action showed one content but the key's latest stamp row on that page shows another (clicked at `@3`, then the list was reordered and nothing clicked `@3` again), they return `reason: "key content changed since the action (index-like key)"`. Both come with `labels`, one per action (`element.label`, time, `content_sig`, `current_content_sig`). The G3 resolver compares every stamp row of the key ("…between observations…"), which covers both cases, so the two resolvers agree (regrade case: `test/mcp.test.mjs` `@3` assertions; browser `index_key_moved_since_action_ambiguous`). | `test/element-stamps.test.mjs` "an index key names another item after a reorder"; `test/mcp.test.mjs` "an index key whose content changed between actions is ambiguous with per-action labels"; browser `index_*` checks |
  | React key path under two keyed parent placements | `ambiguous` (`react_key_sites` > 1) | `stampKeyTrust` |

  Residual: an index key whose items show identical content (same label and text) is not detected. It is also, by construction, indistinguishable on the page. The content rule also downgrades a unique element whose own label changed between actions (e.g. "Follow"/"Unfollow"); that is a false `ambiguous`, not a wrong `exact`.
- **Hash input.** The `%h` form hashes `JSON.stringify(path)`, not a NUL-joined string, so `['\uD800','x']` and `['\uD800\u0000x']` differ (test "the hashed key path is the JSON-encoded path").
- **G3 resolver = MCP on legacy rows.** `resolveElement` now uses the same legacy family lower bound, key-site rule and content rule as `stampKeyTrust`. On the G5 demo key `p_f067e70e6029:117-485#n1` both say `exact` with N = 1, and `element_history`'s `element.instances` is 1 too (`test/mcp.test.mjs` "G3 resolver and MCP agree…").
- **G3 resolver vs MCP.** The G3 resolver (`resolveElement` over stamp rows) has no action data, so it flags any change in what a key showed across its stamp rows. It can therefore say `ambiguous` where the MCP says `exact`: `@0`, `@1` and `@4` in the fixture's index list, whose actions all agree with what the key shows now. It errs safe and is used only by graders.
- **Regrade fix (same day).** The first version compared content only between the actions on the key. A key clicked once and then moved to another item stayed `exact` and handed the new item's annotator the old item's history. `stampKeyTrust` now also compares each action's content with the key's latest stamp row on the same page. Checks are ordered: key sites, then instance count, then content.
- **Evidence after the grade.** Browser fixture 19/19 (adds `Index list` with Reverse and a `Widget` mounted in `#root` and `#root2`). D12 17/17, byte-identical. `npm test` 650/651 (the known `react-context-ref-semantics` failure). G4 grader identical. G5 grader identical.
- **Known limits (not fixed).**
  - The instance count behind an ordinal key is the maximum over every stamp and action for that key in the store, across pages and sessions. So a key that once had 5 instances stays ambiguous after the list shrinks to 1, and an element unique on one page can be ambiguous because its placement repeated on another.
  - The legacy lower bound assumes no stamp row was dropped. On a lossy live channel, a lost `#n2` row would leave `#n1` `exact`.
  - Every change in an ordinal placement's instance count re-emits a row for each of its ordinal hosts (a list growing one row at a time emits O(N²) rows). With several roots, every commit re-applies every root's hosts. Neither was measured on a long session.
  - Two sibling lists rendering the same row component with overlapping ids share key paths and both fall back to ordinals (safe, but keys are lost).

### Amendment (2026-09-24, G1 D-G1-18): open shadow roots

- **Key format.** Interactive elements inside an open shadow root of a stamped host are stamped `<host element_key>><tag>#n<ordinal>`. The ordinal counts that root's interactive elements of the same tag, in tree order. The key stays within the printable-ASCII contract.
- **Row contract (same as the sixth pass).** Every row carries `key_kind: "ordinal"`. `instances` is the number of same-tag interactive elements in that root, multiplied by the host's `instances` when the host key is itself an ordinal. Rows also carry `content_sig` and `commit`, and a new row is written only when the observation changes. The key is registered in `lastRowByKey`, so a `dom.action` on it carries `key_kind`, `instances` and `stamp_sequence`. A root with two same-tag controls is therefore `ambiguous` in the resolver, which errs safe.
- **Other row fields.** `tag: null`, `host_tag`, `placement_via: "shadow_root"`, `shadow_host` (the host's key) and `annotation: "skipped:shadow_root"`. `resolveElement` returns `shadow_host`/`host_tag` for these rows.
- **OAI attributes** are not written inside shadow roots.
- **Qualification.** A host qualifies (in addition to T1–T4) when its open root contains an interactive element. Shadow stamps are applied when the host is stamped, after the page-wide key assignment.
- **Target lookup.** `dom.action.target.element_key` is found with a composed `closest` (shadow root → host).
- **Closed roots** are not stamped.
- **D12** also deletes `target.shadow_host.element_key`.

### Amendment (2026-09-24, G1 D-G1-22): stamp handlers are declared

- `element.stamp` rows carry `handlers_basis: "declared"`. `handlers` lists the first-party functions held by `on*` props on the host's chain at that commit; `event` there is the prop name without `on`, lower-cased (a label: a checkbox's `onChange` reads `change` but runs on `click`). What ran on a dispatch is the `handler.binding` / `handler.invocation` rows, never the stamp.
- The second-pass note ("handler binding for the credit rule is read from fibers at dispatch and recorded on `dom.action.bound_handlers`") is superseded: `bound_handlers` is the declared list (`basis: "declared"`, every `on*` prop on the chain, no event filter); the credit reads the observed bindings. Both are read from fibers and listeners, never from the DOM stamps, so D12 still holds (binding rows carry no element key; readers join it from `dom.action.target`).
- `resolve_element` and `element_history` return `observed_bindings` (native event type, prop, invoker, count) before `handlers`, with `handlers_basis`, and the summaries print the observations first.
