# Independent grade: `fix/no-cross-control-merge` (2026-09-24)

Branch `fix/no-cross-control-merge` at `e3ae71a6` (commits `29ca8ada`, `e3ae71a6`), rebased on `main` `ff9210ee`. Worktree `/Users/austinho/dev/tracer-pr4`. This file is the only change I made. Scratch work (a `git archive main` tree, decompressed stores, replay scripts, a regression fixture) lives in a session scratchpad and is not committed. I did not read `/Users/austinho/dev/fixtures/` or `studio-desk`. The Playwright root `/Users/austinho/dev/trace-consolidated/.live-demo/librechat-m1` was used read-only, as a dependency root.

**Claim under test.** An action's chain is never printed under an action on a different control. Episodes fold only actions on the same control or inside the same form. A click that opens a dialog (portal or not) is its own episode with no request. The Enter in the dialog is its own episode and carries the request with `key: Enter`. Typing and then submitting in one form still folds. Repeated request-sending submits still split. Trailing keystrokes with no effect still join the form's latest episode.

**Verdict: merge with changes (docs only; see the end).** The code does what the implementer says, and I found no regression. On the banked stores and on my own fixtures, no episode spans two controls outside one form. One claim is overstated. The "opener is its own episode with no request" part holds only for openers outside a form. An opener inside a form is a member of that form's episode. When the form later sends a request, the opener's chain prints that request, even though a different control sent it. That follows from the same-form rule and main does it too, but G4 §2.1 and G5 §15 state it without the exception.

## Per-item results

| # | Item | Result | Evidence (below) |
|---|------|--------|------------------|
| 1 | Diff; remaining and removed fold rules; `dist` = `src` | PASS | §1 |
| 2 | Targeted tests on branch; new tests fail on main's indexer | PASS: 36/36 on the branch; 7 fail with main's `analysis/runtime-attribution.mjs` (as claimed) | §2 |
| 3 | Neutral headless fixture; raw rows | PASS. The harness also fails on main (first assertion: beta form episode holds the portal focusin) | §3 |
| 4 | G4 81/81, G6 6/6, G5 `action_chain` replay before/after | PASS. G4 report identical except its path header. G6 compare JSON identical except `store.episodes` 72→90. G5 opener now `dom_mutation`, no request; rename 200/422/200 identical | §4 |
| 5 | Regression: click mounts a form, then type + submit; dialog with its own form | PASS for both. Found a claim gap: an opener inside a form prints the form's later request | §5 |
| 6 | `npm test` | PASS: 645 tests, 644 pass, 1 fail (the known `different context objects never borrow a Provider value…`) | §6 |
| 7 | Docs G5 §15, G4 §2.1 | PARTIAL: accurate for openers outside a form; overstated for openers inside a form; stale main hash | §7 |

## 1. Diff and fold rules

`git diff main...HEAD --stat`: 9 files, +358/−56 (`analysis/runtime-attribution.mjs`, `src/` and `dist/runtime-attribution-browser.js`, `docs/gates/G4-mcp.md`, `docs/gates/G5-demo.md`, `test/browser/fixtures/confirm-dialog-app/main.jsx`, `test/browser/no-cross-control-neutral.mjs`, `test/browser/server.mjs` (comment only), `test/runtime-attribution.test.mjs`).

`npm run build` printed `built byte-identical runtime (304724 bytes)`, and `cmp src/runtime-attribution-browser.js dist/runtime-attribution-browser.js` found no difference. The build left the working tree clean (`git status` shows only the untracked `node_modules`).

**Removed (confirmed in the diff of `indexWorkflowEpisodes`):**
1. `added_controls` owner: `addedControlOwners`. A later action on a control that an earlier action's mutation added inherited that action's form, or became its transient child. Removed.
2. `added_forms`: the loop that did `addToForm(form.ref, action)` for every form in an action's mutation receipt, which pulled the opener, and even a submit that rendered the next page's form, into that form. Removed.
3. The 2000 ms `activeFormPortal` window: after a form control with `role=combobox` or `aria-haspopup ∈ {dialog, listbox, menu}`, any unformed click/focusin/input/change/keydown within 2000 ms joined that form. Removed.
4. The runtime's portal-inherited `form_ref`. `src` L413–415: `formDescription = describeForm(form)` only. The opener's form now goes to `portal_opener_form_ref` (L428), and is set only when the target has no real form ancestor. `portalFormRefs` is still maintained, but only for that evidence field. The `dom.mutation` `form_ref` uses the same `formDescription`, so portal mutations no longer carry the opener's form either.

**Remaining rules (the whole list):**
- **Same form:** every action whose `form_ref` (or `form.ref`) is X groups under X. The group is cut after each submit that has a non-internal `network.request` on its own `action_id` (§12.1 split). This rule does fold different controls, but only ones inside the same form.
- **Trailing no-effect segment:** after the last request-sending submit, a segment with no effect and no submit joins the previous segment (§14.1). Same form only.
- **Focus to next, same control:** a `focusin` with no `form_ref`, followed immediately by the next action on the same `target_ref` within 1000 ms, becomes that action's transient parent. This is the only time-based rule left, and both actions must be on the same control. The parent chain is built only from this rule, so it cannot reach another control.
- **Standalone:** every other non-context dispatch is its own episode. Context actions outside a form with no effect are not episodes; the store returns a standalone single-action chain for them.

No time-based fold across controls remains. The same-form rule is the only one that can fold two different controls, which the claim allows. §5 shows what it means for an opener inside a form.

## 2. Targeted tests, and the new tests against main's indexer

```
node --test test/runtime-attribution.test.mjs test/mcp.test.mjs test/g5-store-attempts.test.mjs
ℹ tests 36  ℹ pass 36  ℹ fail 0
```
Then in a `git archive HEAD` copy with `analysis/runtime-attribution.mjs` replaced by `git show main:analysis/runtime-attribution.mjs`, I ran the same command:
```
ℹ pass 29  ℹ fail 7
✖ one form episode keeps typing, a rejected submit, and a later successful submit; the button that rendered the form is its own episode
✖ a portaled control is its own episode, not the episode of the form control that opened it
✖ an unmarked control shortly after a form combobox is not folded into the form by time
✖ a menu opener and the request-bearing option it rendered are two episodes; focus folds into the click on the same control
✖ a click that opens a portal dialog and the Enter that confirms it are two episodes (opener outside a form)
✖ a click that opens a portal dialog and the Enter that confirms it are two episodes (opener inside a form)
✖ a dialog that renders its own form: the opener is not folded in by added_forms
```
The negative control (typing then submit in one form is one episode) passes on both, as it should.

## 3. Neutral headless fixture

`node test/browser/no-cross-control-neutral.mjs --rows <scratch>/neutral-rows.json` gave `status: ok`, `headless: true`, and no page errors. For every episode, the harness asserts "all actions share one form_ref, or all share one target_ref".

From the raw rows (`dom.action` / `dom.mutation` / `network.request`, by sequence):

| Case | Opener rows | Opener episode | Confirm rows | Confirm episode |
|---|---|---|---|---|
| alpha (no form) | focusin+click `object:1`, `aria-haspopup=dialog`, no `form_ref`; mutations with `added_controls=1`, no request | `episode:action:…:2` = [focusin, click], no request, `stopped_at: dom_mutation` | `keydown` `{key:"Enter"}` on the `role=dialog` `object:2`; `DELETE /api/items/alpha` on that `action_id` | [focusin, keydown:Enter], carrier `keydown`, request `DELETE /api/items/alpha` |
| beta (opener in form `object:3`) | focusin+click `object:4`, `form_ref=object:3` | `episode:form:default:object%3A3` = [focusin, click], no request, `dom_mutation` | Enter keydown on dialog `object:5`: **no `form_ref`**, `portal_opener_form_ref=object:3`; `DELETE /api/items/beta` | [focusin, keydown:Enter], `DELETE /api/items/beta` |
| gamma (dialog has its own form `object:7`) | focusin+click `object:6`, no form; mutation `added_forms=1`, `added_controls=2` | `episode:action:…:10` = [focusin, click], no request, `dom_mutation` | typing, `keydown Enter`, change, implicit-submit click, submit, all `form_ref=object:7`; `DELETE /api/items/gamma` on the submit | form episode `object%3A7` (15 actions), carrier `submit`, `DELETE /api/items/gamma` |
| add item (negative) | none | none | focusin, click, 3× keydown/input, change, focusin, click, submit, all `form_ref=object:10`; `POST /api/items` | one episode, 12 actions, carrier `submit` |

Gamma's request is carried by the submit that the Enter caused. The Enter keydown is inside that episode. That is correct for the same-form rule.

On main (copied the harness and fixture into the `git archive main` tree, so main's runtime and indexer are used), the harness fails at its first invariant: `AssertionError: episode:form:default:object%3A3: focusin is inside the episode's form`. The beta dialog's actions rode into the opener's form.

## 4. Banked stores

**G4 (final7):** `node test/g4-grader.mjs docs/evidence/m1-2026-09-22-final7 --manifest docs/evidence/g4-mcp-2026-09-23/manifest.json --out <scratch>` gives `result: 81/81 checks pass` (81 PASS, 0 FAIL). I ran the same on main: the two reports differ only in the `store:`/`manifest:` path header lines. Episode membership on final7 is 46 → 46, and 0 actions change episode. final7 has no `form_ref` actions.

**G6:** I decompressed `docs/evidence/g6-anything-llm-2026-09-23/store` to scratch and ran `test/browser/g6-compare.mjs` (without `--source-root`, to stay out of the fixtures directory) with the six committed pairs, once with branch code and once with main code. `test/g6-grader.mjs` gives `Overall: PASS (6/6 pairs)` on both. All 6 compare JSONs and `index.json` are identical between main and branch once the `store` stats block is removed. That block differs only in `episodes: 72 → 90`. `AGENT-READS.md` is byte-identical.

**Episode-level diff of the stores (my own script calling both trees' `indexWorkflowEpisodes`):**

| Store | actions | episodes main → branch | actions whose episode changed | cross-control episodes, main → branch |
|---|---|---|---|---|
| final7 | 54 | 46 → 46 | 0 | 0 → 0 |
| G6 | 408 | 72 → 90 | 228 | 30 → 0 |
| G5 (`…-23c`) | 151 | 9 → 9 | 26 | 3 → 0 |

A "cross-control episode" is an episode with a `form_ref` whose actions are not all in that form, or an episode without a form that has more than one `target_ref`.

**G5 `action_chain` replay.** Store `g5-anything-llm-2026-09-23c/store`, decompressed; `mcp/server.mjs --store` over stdio, once per tree:

| action | main | branch |
|---|---|---|
| `action:muen72vm:3`, create-workspace opener (button, no form) | `episode:form:…:object%3A4` (26 actions), 9 requests; printed `NewWorkspace.jsx@693-1438 → GET …/is-agent-command-available → 500`, `stopped_at: handler` | `episode:action:muen72vm:3` = [focusin, click], 0 requests, `NewWorkspace.jsx@2399-2432`, `stopped_at: dom_mutation` ("the dispatch made no request") |
| rename attempt 1 click/submit (`…76jn:67/68`) | `object%3A41`, 1 request, 200 | identical JSON |
| rename attempt 2 (`…787d:107`/`…787e:108`) | `object%3A41#2`, 1 request, 422 | identical JSON |
| rename attempt 3 (`…79uv:145/146`) | `object%3A41#3`, 1 request, 200 | identical JSON |
| create-workspace submit `…73s5:27` | `episode:form:…:object%3A28`, **1 action** (pulled into the next page's form via `added_forms`) | `object%3A4`, 24 actions (its own form) |

The opener no longer prints the modal form's handler or request. The rename attempts are unchanged. The create-workspace submit also moves back into its own form, which the docs mention.

I did not check the portal-`form_ref` limitation (§7) on these stores. Every `form_ref` click, keydown or submit in the G5 and G6 stores is a genuine name input or submit button, and no `role=option/menuitem/dialog` target carries a `form_ref`, so the limitation does not show up in these two stores.

## 5. Regression cases (my own fixture, built with `test/browser/fixture-build.mjs`, headless, branch vs main)

The fixture has three components:
- R1: a no-form button mounts a form inline (no portal); the user types in it and submits `POST /api/projects`.
- R2: an `aria-haspopup=dialog` button inside an outer form opens a portal dialog with its own form (`stopPropagation` in its submit); the user types, presses Enter, and `PATCH /api/tags/1` is sent; then "Save outer" submits `POST /api/outer`.
- R3: a `role=combobox` in a form opens a portal listbox; the user clicks an option (no request), then submits twice (`POST /api/pick` ×2), then types 2 keystrokes.

Branch results:

| Case | Episode | Actions | Request | Verdict |
|---|---|---|---|---|
| R1 opener | `episode:action:…:2` | focusin, click | none, `dom_mutation` | separate ✓ |
| R1 new form | `form object:2` | focusin, click, 2×(keydown, input), change, focusin, click, submit | `POST /api/projects` | folds, correct request ✓ |
| R2 dialog's own form | `form object:8` | focusin, click, keydown, input, keydown:Enter, change, click, submit | `PATCH /api/tags/1` | folds within the dialog form ✓ |
| R2 outer form | `form object:5` | outer typing + **"Rename tag" opener focusin/click** + Save outer focusin/click/submit | `POST /api/outer` | see gap below |
| R3 option (portal) | `episode:action:…:34` | focusin, click on `li[role=option]`; `portal_opener_form_ref=object:12`, no `form_ref` | none, `dom_mutation` | separate ✓ |
| R3 segment 1 | `form object:12` | **combobox focusin/click** + Pick click/submit | `POST /api/pick` | split ✓ |
| R3 segment 2 | `form object:12#2` | Pick click/submit + trailing focusin, click, 2×(keydown, input) | `POST /api/pick` | trailing typing joins ✓ |

On main, the same fixture showed the defects: the R1 opener was inside the new form's episode; the R2 dialog-form episode included the outer field's `change` and the opener; the R3 option was inside the picker form.

**Gap.** `buildEpisodeChain` for the "Rename tag" click (`aria-haspopup=dialog`, `form_ref=object:5`) gives carrier = the Save outer submit and request `POST /api/outer`. The R3 combobox click likewise prints `POST /api/pick`. So the chain of an opener inside a form is printed under a request sent by a different control in the same form. This follows from the stated same-form rule, and main did the same (or worse), so it is not a regression. It does contradict the unqualified sentences in the docs (§7). The branch's unit test and headless case "opener inside a form" pass only because the beta form never submits.

Before I added `stopPropagation`, R2 also showed React's synthetic submit bubbling from the portal form to the outer form's `onSubmit`: one Enter caused both `PATCH /api/tags/1` and `POST /api/outer` on the same `action_id`, and the chain showed the later `POST`. That is real app behaviour, not an attribution error, but the "latest request" choice in `describeEpisodeEvidence` hides the `PATCH`. That choice predates this PR.

## 6. Full suite

`npm test` in the worktree gives `ℹ tests 645  ℹ pass 644  ℹ fail 1`. The only failure is `different context objects never borrow a Provider value and exact Consumer callbacks receive their value` (`actual: 'a'`, `expected: 'b'`), the known failure. The same test also fails in my `git archive main` copy. That copy has 9 other failures that come from running outside a git checkout, so I did not use it as a baseline for the count.

## 7. Docs

- G5 §15 describes defects (a)–(d) correctly and matches the diff. The rule bullets, the "Unchanged" list, the evidence effects (G4 identical, G5 26 actions move and the rename attempts are unchanged, G6 72→90 with graders 6/6) and the disclosed limit all match what I recomputed. The limit reads: stores recorded before this change keep portal-inherited `form_ref`, so rule (d) applies only to new captures, while (a)–(c) apply to every store.
- **Overstated:** G5 §15 bullet 2 says "A click that opens a dialog, menu, listbox or form is its own episode (… no request it stops at `dom_mutation`)". G4 §2.1 says "A control that opened a menu, dialog or form … [is a] separate episode, so an action's chain is never printed under another action on a different control." Neither holds for an opener inside a form that later sends a request in the same segment (§5, R2/R3).
- Minor: §15 says the harness fails "on main at `39955b93`". The branch is rebased on `ff9210ee`. I confirmed that it also fails there.

## Residual risks

1. **An opener inside a form shares the form's episode.** A `combobox` or `aria-haspopup` button inside a form (a model picker in a chat form, "Rename tag" inside settings) prints the form's next request. Whether that is intended ("the form is the unit") or should change (a click with no request whose only effect is a portal or popup mount stays its own episode even inside a form) is a design decision. Either way, it should be written down.
2. **Pre-change stores** (G1/G2/G5/G6, LibreChat runs) keep portal-inherited `form_ref`. The analysis cannot tell it from real ancestry. It did not occur in the G5/G6 stores I checked (§4). The G1/G2 stores also change episode counts, and their graders were not rerun (disclosed).
3. **Losing context:** a menu option or dialog action that sends no request is now a standalone episode that stops at `dom_mutation`. In the G6 store these are the 30 former cross-control episodes. The UX change is deliberate. The M1 viewer shows more cards (72 → 90 on G6).
4. **Request choice inside one episode** (`requests.at(-1)`, or the latest request with a DB write) can hide an earlier request on the same action (§5 bubbling case). This predates the PR.
5. The unit tests and the neutral fixture have no case with an in-form opener followed by a submit of that form. The behaviour in residual 1 is untested either way.

## Verdict

**Merge with changes (docs only; the code needs no change):**
1. In G5 §15 bullet 2 and G4 §2.1, limit "a click that opens a dialog/menu/form is its own episode" to openers **outside a form**. State that an opener inside a form is a member of that form's episode and, until the form's next request-sending submit, its chain is that submit's chain. Or, if that is not the intended rule, open a follow-up to exclude such clicks from form episodes.
2. Add a unit or headless case that pins down that behaviour, for example the beta opener followed by a submit of the beta form.
3. Fix the stale main hash (`39955b93` → `ff9210ee`) in §15.

## Commands (reproduction)

```
cd /Users/austinho/dev/tracer-pr4
git diff main...HEAD --stat; npm run build; cmp src/runtime-attribution-browser.js dist/runtime-attribution-browser.js
node --test test/runtime-attribution.test.mjs test/mcp.test.mjs test/g5-store-attempts.test.mjs
# main indexer: git archive HEAD | tar -x -C $S/x; git show main:analysis/runtime-attribution.mjs > $S/x/analysis/runtime-attribution.mjs; (cd $S/x && node --test …)
node test/browser/no-cross-control-neutral.mjs --rows $S/neutral-rows.json
node test/g4-grader.mjs docs/evidence/m1-2026-09-22-final7 --manifest docs/evidence/g4-mcp-2026-09-23/manifest.json --out $S/g4-branch.md
# G6: gunzip store to $S/g6-store; node test/browser/g6-compare.mjs --store $S/g6-store --out $S/g6-branch --pair A-baseline:B-seeded-422 --pair B-seeded-422:C-fix-r2 --pair A-baseline:C-fix-r2 --pair A-baseline:D-noop-refactor --pair A-baseline:E-frontend-early-return --pair B-seeded-422:C-fix
node test/g6-grader.mjs $S/g6-store --compare $S/g6-branch --out $S/g6-branch/GRADE.md
# G5: gunzip store; MCP client calling action_chain on each action id against <tree>/mcp/server.mjs --store <store>, main tree vs branch
npm test
```

---

## Regrade at `884cc506` (2026-09-24)

This regrades the author's fix for the gap in §5. `indexWorkflowEpisodes` now puts only field events and actions that can submit the form into a form episode:
- field events: `input`, `change`, `keydown`/`keyup`, focus, and clicks on fields;
- `submit`;
- clicks on a `<button>` with no type or `type="submit"`, or on `<input type="submit|image">`.

Any other click inside a form is its own episode. That covers `type="button"`/`"reset"`, any control with `aria-haspopup` or `aria-expanded`, `div role=button`, and `<a>`. Focus on a control that is not a field joins the form only if the next action on that control does. Otherwise it folds into the next action on the same control within 1000 ms, as before.

| Check | Result |
|---|---|
| My fixture R2: "Rename tag" (`aria-haspopup=dialog`, inside the outer form), then "Save outer" | PASS. The opener is `episode:action:…:19` = [focusin, click], no request, `dom_mutation`. The outer form's episode is only outer typing + Save outer focusin/click/submit, with `POST /api/outer`. The POST no longer appears on the opener. |
| My fixture R3: `role=combobox` + `aria-haspopup=listbox` inside a form, then two Pick submits | PASS. The combobox is its own episode = [focusin, click], no request, `dom_mutation`. The Pick submits still split into `object:12` and `#2`, trailing typing joins `#2`, and the portal option is its own episode. |
| New R4: `<button>` with no type (recorded `attributes: {}`) inside a form, focus+click+submit | PASS. The focusin, click and submit of `object:20` are in the form episode with the typing, carrying `POST /api/rename`. A button with no type counts as able to submit. |
| New R4: `<button type="button">` inside the same form that sends `GET /api/check` | PASS. It is its own episode = [focusin, click], carrying `GET /api/check`, `stopped_at: network`. It is not in the form episode. |
| R1 (form mounted inline) and the dialog with its own form | Unchanged, PASS. |
| G5 rename button, focus+click+submit, one attempt | PASS. `muen76jn:66` focusin, `:67` click, `:68` submit (all `button {}`) are the last four members of `object%3A41` along with `…65`. The `action_chain` replay for the opener, the 3 rename attempts (200/422/200) and the create-workspace submit is byte-identical to the first branch version. |
| Targeted tests | 42/42 pass (`runtime-attribution`, `mcp`, `g5-store-attempts`) |
| Neutral headless fixture | `status: ok`. Beta now also sends `POST /api/beta` from its own submit after the opener was used, and the beta opener still has no request. |
| G4 on final7 | `result: 81/81 checks pass`. Apart from the two path header lines, the report is identical to the first grade's. |
| G6 | `Overall: PASS (6/6 pairs)`. All 6 compare JSONs and `index.json` are identical to main's once the `store` block is removed (episodes 90). `AGENT-READS.md` is identical. |
| Episode diff of the stores | Same numbers as the first version: final7 46→46 (0 moved), G6 72→90 (30 cross-control episodes → 0), G5 9→9 (3 → 0). |
| `npm test` | 651 tests, 650 pass, 1 fail (the known `different context objects never borrow a Provider value…`) |
| Docs (G4 §2.1, G5 §15) | They now state the form-member rule, the exceptions for openers inside a form, and that a control with its own request keeps it. The main hash is corrected to `ff9210ee`. Accurate against what I observed. |

**Remaining residual risks (small, for later):**
- A `<button>` with no type that also has `aria-expanded` or `aria-haspopup` is not a form member when clicked. If it does submit the form, the `submit` event joins the form episode but the click does not. That control's `action_chain` on the click then shows no request. This is rare, because such toggles normally `preventDefault` or declare `type="button"`.
- A click on a `<label>` or other non-field element inside a form that causes a DOM change now makes its own card, where before it was absorbed into the form. The viewer shows more cards; attribution is not wrong.
- The rule reads `type`, `aria-haspopup` and `aria-expanded` from the attributes recorded at dispatch. If the runtime stops recording an attribute, the classification changes quietly. No test pins the attribute capture from end to end, apart from the neutral fixture.
- Stores recorded before this change still carry the `form_ref` inherited from a portal (disclosed). The G1/G2 graders were not rerun (disclosed).

**Final verdict: merge.** The gap from the first grade is closed, and the three requested doc changes are made. No banked grader or answer regresses, and the full suite is at its known baseline.
