# Grade: `fix/shadow-dom-context` (head 12feafb8, base `main` ff9210ee)

Independent grade, 2026-09-24. No code was modified. Probes ran in scratch copies of the tree made with `git archive`, with the runtime swapped in. They did not use worktrees. Dependency root: `/Users/austinho/dev/trace-consolidated/.live-demo/librechat-m1`, used read-only.

**Verdict: merge with changes.** The changes are to the docs. Code follow-ups are listed below and do not block the merge. Every probe result on this branch is equal to or better than `main`, and none regresses. The D-G1-19 wording ("a trusted dispatch wins") claims more than the code does: trusted events that do not start a Tracer action still take the registration owner (see item 3a′).

## Per-item table

| # | Item | Result | Evidence |
|---|------|--------|----------|
| 1a | `dom.action` target via `composedPath()[0]`, `composed` / `shadow_host` | PASS | L447-475. Gate run: target `button`, `composed: true`, `shadow_host {tag: share-chip, element_key}`. On `main`: `share-chip` |
| 1b | attachShadow record, closed-root detection | PASS (edge noted) | L337-352, L456. Edge case: a closed root nested inside an open root is not flagged, because `closedHost` tests `event.target` only when there is no retargeting. It should test `dispatchTarget` |
| 1c | Bound listeners on shadow nodes; composed bound-handler walk (L700-715) | PASS (limit noted) | `bound_handlers.ids` = [inner listener], `element_listeners: 1`. The walk uses `parentNode` and `host`, not `assignedSlot`, so shadow-internal listeners around a `<slot>` are not counted for slotted light-DOM targets. This is not disclosed |
| 1d | `bareFrameLive` tightening (eventPhase) | PASS | L416-421. `continuations-neutral` (5 runs): `/api/nested-after-focus` direct to the click, `/api/nested-leak` null, `/api/pre-armed` null. The D-G1 strict-stack case for programmatic focus inside a click is intact: a trusted nested focus never used the untrusted branch, so its behavior did not change |
| 1e | No ambient inheritance introduced | PASS | `listenerEvent` is scoped to the call (try/finally). Liveness needs the frame's own event `eventPhase !== 0`, which holds only during a synchronous dispatch. Negatives after the actions (untrusted inner click, programmatic `share`) are unattributed in 3/3 runs. A re-dispatched stale event gets `isTrusted=false`, and task callbacks start from `current = owner` or `null`, so no stale frame is reached |
| 1f | Dispatch-wins walk (L1103-1121) picks the right dispatch when two nest | PASS | Probe (a): 2 runs each. The fetch goes to the click in both cases (details below) |
| 1g | Per-listener stack walk: performance | LOW RISK | One `settleAmbient()` plus a parent walk that stops at the first non-function frame (cap 256). Applies to owned listeners only. `stampShadow` runs `querySelectorAll` per open root of each stamped host per commit, which scales with custom-element count on design-system-heavy pages. Not measured |
| 1h | Stamps (L742-890): stamped inside the root, no `oai-*` there | PASS (limit noted) | Inner key `<host>>button#n1`, `annotation: "skipped:shadow_root"`, `innerOai=false`, host `chipOai=true`. Limit: a root that is filled asynchronously (Lit style, in a microtask after connect) gets no stamp on the host or inner nodes until a later React commit revisits the host (probe below). Not disclosed |
| 1i | Analysis: `runtime-attribution.mjs` L111-120, L616; `causal-chain.mjs` L74, L125; `element-index.mjs` | PASS | Closed-root abstention applies only when there are no requests, and a request owner keeps credit (node test). `stop_reason: closed_shadow_target`. `resolveElement` returns `shadow_host` / `host_tag` |
| 1j | `dist/` byte-identical | PASS | `npm run build` printed "built byte-identical runtime (304724 bytes)". `cmp src dist` shows them identical. `git status` is clean |
| 2 | Gate `shadow-dom-context.mjs` on branch | PASS 3/3 | See outputs below |
| 2′ | Same test with `main`'s runtime | FAILS at first assertion, as claimed | `real target is the inner button`: actual `share-chip` |
| 2″ | `/api/reshare` credited to Bump before the fix | CONFIRMED on both `main` and 3e85eee7 | On `main`, `/api/ping` also went to Bump. The wrong credit comes from D-G1-14 and was already on `main`; the shadow fix did not introduce it (see doc note) |
| 3a | Probe: nested trusted dispatch (focus, then composed event, reaching an older-action listener) | PASS | Light-DOM case: `/api/p-nested` direct to the Nested click, not Bump. Shadow-root case (the inner listener focuses an inner input, which starts a nested `focusin` action, then dispatches composed `fshare`): `/api/p-fshare` direct to the Go click. `dispatch_won` +1 each |
| 3a′ | Probe: trusted non-action event reaching a Bump-owned listener | WRONG CREDIT (pre-existing, contradicts D-G1-19 wording) | A `focus` listener re-added under Bump and fired by `el.focus()` inside the Nested click: `/api/p-focus` goes to **Bump** (`state_effect`). A `pointerdown` listener re-added under Bump, user presses Ping: `/api/p-pointerdown` goes to **Bump**. `main` gives the same result |
| 3b | Probe: timer armed under Bump dispatches programmatic `share` | Credited to Bump. **Correct** | Detail and the related wrong credits are below |
| 3c | Probe: React's delegated root listener is not element-bound | PASS | A second React root was mounted inside an open shadow root during an action: `owned_listeners` +0. The click's `bound_handlers.ids` holds only the first-party `onClick`. `/api/p-inner-react` is direct to the click. On `main` it is **null** (the branch fixes this too) |
| 4 | `continuations-neutral`, `d12-stamp-neutrality`, node tests, `npm test` | PASS | cont: `status ok`, 5 runs. d12: `pass: true`, all 17 checks true. `node --test frontend-only action-context`: 21/21. `npm test`: 642 tests, 641 pass, 1 fail (`react-context-ref-semantics`, which also fails on a clean `main` archive) |
| 5 | Docs | ACCURATE WITH CORRECTIONS NEEDED | See the docs section |

## Commands and outputs

```
git diff main...HEAD --stat        # 11 files, +703 -34; 4 commits 02db11bc c67ab3d5 3e85eee7 12feafb8
npm run build                      # built byte-identical runtime (304724 bytes); tree clean
node test/browser/shadow-dom-context.mjs   # exit 0, status ok, runs 3
```

Per-run attribution in the gate test (identical in all 3 runs):

```
/api/refresh     -> refresh-click (direct)
/api/share       -> share-click   (direct)
/api/share-count -> share-click   (direct)
/api/refresh     -> refresh-click (direct)
/api/reshare     -> reshare-click (direct)          # click B, not Bump
/api/ping        -> ping-click    (direct)
/api/reshare     -> bumpA3        (state_effect)    # programmatic share outside a dispatch -> registration owner
/api/share, /api/share-count -> null  x2            # untrusted inner click; programmatic share on alpha
owned_listeners 6, dispatch_won 2
lock chain: stopped_at entry_handler, because "target inside a closed shadow root: the inner target and its element-bound handlers are not observable"
share chain: entry_handler = inner listener (1619:1652, rooted), stopped_at network, target_frontier {closed_shadow:false, host:share-chip, target:button}
```

The same click sequence was run with three runtimes (scratch `gate-dump.mjs`):

| request | `main` ff9210ee | 3e85eee7 (shadow fix, no D-G1-19) | HEAD 12feafb8 |
|---|---|---|---|
| target of the share click | `share-chip` | `button composed` | `button composed` |
| `/api/share`, `/api/share-count` | null | ShareAlpha direct | ShareAlpha direct |
| `/api/reshare` (click B) | **Bump1** state_effect | **Bump1** state_effect | ShareBeta(B) direct |
| `/api/ping` | **Bump2** state_effect | **Bump2** state_effect | Ping direct |
| lock chain | `browser` / "no request observed" | `entry_handler` / closed-root text | `entry_handler` / closed-root text |

`node test/browser/shadow-dom-context.mjs` against `main`'s runtime fails with: `AssertionError: real target is the inner button, not the retargeted host` (actual `'share-chip'`, expected `'button'`).

Own probes (scratch fixture, reproduced in the appendix). Sequence: Bump#1, Nested, FocusChip Go, Ping, Later, BumpArm, load-timer fire, Mount, InnerReact, Bump#2.

| request | HEAD | `main` |
|---|---|---|
| `/api/p-nested` (click handler: `span.focus()`, then composed `nested`, listener owned by Bump#1) | **Nested click, direct** | Bump#1 |
| `/api/p-fshare` (shadow inner listener: `input.focus()` (nested focusin action), then composed `fshare`, listener owned by Bump#1) | **Go click, direct** | Bump#1 |
| `/api/p-focus` (`focus` listener owned by Bump#1, fired by `span.focus()` inside the Nested click) | Bump#1 (state_effect) | Bump#1 |
| `/api/p-pointerdown` (listener owned by Bump#1, user presses Ping) | Bump#1 (state_effect) | Bump#1 |
| `/api/p-share?src=later-timer` (timer armed by the "Later" click in another component; listener owned by Bump#1) | Bump#1 | Bump#1 |
| `/api/p-share?src=bumparm-timer` (timer armed by BumpArm; listener re-added in BumpArm's commit) | BumpArm | BumpArm |
| `/api/p-share?src=load-timer` (interval armed at load, fired after BumpArm) | BumpArm (registration owner) | BumpArm |
| `/api/p-inner-react` (React root mounted in an open shadow root during Mount) | **InnerReact click, direct** | null |
| `owned_listeners` delta on Mount | 0 | 0 |

A first version of the probe put the `focus` listener on a React-rendered `<input>`. That listener was never owned. `reactEventTarget` (L1093) matches any element carrying `__reactEvents$`, and React sets that on inputs for non-delegated events. This over-match is on `main` too and is out of scope, but it means owned-listener coverage silently excludes React-rendered inputs, forms and media elements.

Async shadow render (scratch `async-app.jsx`):

```
after load     sync-chip {host: ...#n1, inner: ...#n1>button#n1}   async-chip {host: null, inner: null}
after rerender async-chip {host: ...715-751#n1, inner: ...>button#n1}   (only because the React commit touched the host)
```

## Probe 3b decision: timer armed under Bump dispatches programmatic `share`

The fetch goes to Bump. **I consider this correct.** The timer is a continuation created under Bump (creation-time ownership), so the dispatcher's owner and the listener's registrant are the same action. Both doctrines give the same answer. This case is not the load-time timer case.

Two neighbouring cases are **wrong credits** under the doctrine that continuations created under an action belong to it:

- **Later timer (`later-timer`).** The dispatch is caused by a continuation of "Later", but credit goes to the listener's registrant, Bump. The cause is observable (the current frame at `dispatchEvent` is Later's timer continuation), and it loses to registration because the walk stops at any continuation.
- **Load-time interval (`load-timer`).** The dispatch belongs to nothing, but D-G1-14 hands it to BumpArm. D-G1-14/19 state this outcome as intended, so it is disclosed, not a bug in this PR. I would still class it as a wrong credit.

These cases were already the same on `main`, so none of them is a regression.

## Docs (item 5)

- **D-G1-14 amendment and D-G1-19** say "When a trusted dispatch invokes the listener … the dispatching action wins." The code only honours this when the nearest dispatch frame is a Tracer action frame (`click`, `input`, `change`, `submit`, `keydown`, `focusin`) and `window.event` / the invoking event is that event or an untrusted event nested in it. Trusted events that are not actions (`pointerdown`/`mouse*`/`keyup`/`wheel`, and `focus`/`blur` from `el.focus()` inside a click) keep the registration owner. Probe 3a′ shows the resulting wrong credits. **Change:** narrow the wording to "the dispatch of a Tracer action event, or an untrusted event dispatched synchronously under it", and list 3a′ and the Later-timer case as known wrong credits.
- **D-G1-19 first paragraph** says the wrong credit arises "without this rule, the shadow-root fix could produce a wrong credit". On `main`, `/api/reshare` and `/api/ping` were already credited to Bump. **Change:** say that the wrong credit came from D-G1-14 and predates this PR.
- **D-G1-18 gate-test paragraph** cites "`main` 39955b93". The branch is rebased on ff9210ee, and the first assertion also fails there. **Change:** update the hash.
- **Limits line (L250):** `onclick` properties, `handleEvent` objects, declarative closed roots and unstamped nested roots are all present and accurate. **Add:** (1) roots filled asynchronously after connect (Lit, Stencil, etc.) are not stamped until a later commit touches the host; (2) the bound-handler walk does not follow `assignedSlot` for slotted targets; (3) a closed root nested inside an open root is not flagged `closed_shadow`.
- **G3-stamps.md L141 amendment:** accurate against the code (L867-890) and the `element.stamp` row shape.

## Residual risks

1. Trusted non-action events and owned listeners (3a′): wrong credit to the registering action. Pre-existing, and now contradicted by the doc wording. A code follow-up could check whether the invoking event is a trusted `UIEvent` (pointer/mouse/key/focus/touch/wheel/input). If it is, never apply the registration owner: run under a live dispatch frame found by the walk (liveness = `frame.event.eventPhase !== 0`), or else under `null`. Restricting this to `UIEvent` leaves XHR, WebSocket and `<img>` `load` ownership intact, since those are trusted too and do need the registration owner.
2. A programmatic dispatch from a continuation owned by action X credits the listener's registrant, not X (the Later timer).
3. Async-rendered shadow roots are unstamped at first, so hosts miss `data-tracer-el` until a re-commit.
4. A closed root nested inside an open root is recorded as open-composed with no frontier (L456 should use `dispatchTarget`).
5. Slotted targets: shadow-internal listeners (on the slot or its wrappers) are not counted as bound handlers.
6. `stampShadow` / `shadowControls` query cost on pages with many shadow hosts was not measured.
7. `reactEventTarget` over-matches React inputs and forms, so listeners on them are never owned (pre-existing).

## Appendix: probe fixture (scratch, not committed)

The key parts of `probe-app.jsx`. It is built with `test/browser/fixture-build.mjs` and driven by a Playwright runner that clicks in the sequence above and records `stampStats()` deltas per step.

```jsx
class FocusChip extends HTMLElement {            // open root: <input> <button>Go</button>
  connectedCallback() { /* once */ this.shadowRoot.querySelector('button').addEventListener('click', () => this.go()); }
  go() { this.shadowRoot.querySelector('input').focus(); this.dispatchEvent(new CustomEvent('fshare', { composed: true, bubbles: true })); }
}
function Probe() {   // every effect has a per-render dep, so it is re-added (owned) in each Bump commit
  useEffect(() => { chip.addEventListener('share', onShare); ... }, [onShare]);
  useEffect(() => { fchip.addEventListener('fshare', onFshare); ... }, [onFshare]);
  useEffect(() => { nestedDiv.addEventListener('nested', onNested); ... }, [onNested]);
  useEffect(() => { focusSpan.addEventListener('focus', onFocus); ... }, [onFocus]);      // <span tabIndex=0>
  useEffect(() => { pingButton.addEventListener('pointerdown', onPd); ... }, [onPd]);
  const nested = () => { focusSpan.focus(); nestedDiv.dispatchEvent(new CustomEvent('nested', { composed: true, bubbles: true })); };
  const bumpArm = () => { setN(v => v + 1); setTimeout(() => chip.dispatchEvent(new CustomEvent('share', { ..., detail: { src: 'bumparm-timer' } })), 50); };
}
function Other() {   // separate component: its clicks do not re-add Probe's listeners
  const later = () => setTimeout(() => chip.dispatchEvent(new CustomEvent('share', { ..., detail: { src: 'later-timer' } })), 50);
  const mount = () => { /* host.attachShadow({mode:'open'}) + createRoot(containerInsideRoot).render(<button onClick={() => fetch('/api/p-inner-react')}>) */ };
}
const loadTimer = setInterval(() => { if (window.__fireLoadTimer) { /* dispatch share, src 'load-timer' */ } }, 20);
```

## Regrade 2026-09-24: head 1450760c (D-G1-20, docs per grade)

The runtime change (`src/runtime-attribution-browser.js` L1094-1140) sets what an owned listener runs under, based on the invoking event:

- **Untrusted event:** the dispatcher's settled frame.
- **Trusted UI event (`UI_EVENT` regex):** the current frame if the synchronous stack reaches a trusted dispatch frame with `eventPhase !== 0`, otherwise `null`.
- **Other trusted event:** the D-G1-19 walk, then the registration owner.

I reran my probes on a fresh `git archive` of 1450760c. The fixture is the one in the appendix plus Xhr, Img and Ws buttons. It ran 2 loads on HEAD and 1 on `main` for comparison.

| case | expected | HEAD 1450760c | `main` |
|---|---|---|---|
| (a) `focus` from `span.focus()` inside the Nested click, listener owned by Bump | the click | **Nested click, direct** | Bump |
| (a) composed `nested` after the focus | the click | Nested click, direct | Bump |
| (a) shadow case: the inner listener focuses an input (nested `focusin` action), then composed `fshare` | the Go click | Go click, direct | Bump |
| (b) `pointerdown` on Ping, listener owned by Bump | unattributed | **null** (`ui_unowned` +1) | Bump |
| (b) `share` from a timer armed by Later | Later | **Later, direct** (`dispatcher` +1) | Bump |
| (b) `share` from a timer armed by BumpArm | BumpArm | BumpArm, direct | BumpArm |
| (b) `share` from the load-time interval | unattributed | **null** | BumpArm |
| XHR `load` listener added in the Xhr click, fired in its own task | Xhr (ownership kept) | Xhr, direct (`owned` +1) | Xhr |
| `<img>` `load` listener added in the Img click | Img | Img, direct | Img |
| WebSocket `error` listener added in the Ws click | Ws | Ws, direct | Ws |
| React root in a shadow root (c) | click; root listener not owned | click, direct; `owned` +0 on Mount | null |

The XHR, image and WebSocket rows show that registration ownership is intact for trusted non-UI events. Their results are the same as on `main`.

**Ambient inheritance: none introduced.**

- **Untrusted events.** The listener runs under whatever frame is current when `dispatchEvent` is called, after `settleAmbient()` has popped ended dispatch frames. That is the same frame a direct function call would run under, and the strict stack restores `current` in `finally`.
- **UI events.** The listener wins only through a dispatch frame whose own event still has `eventPhase !== NONE`. That can only be true synchronously inside that dispatch. A re-dispatched event object becomes `isTrusted=false`, so it fails the trust check.
- **Stale frames.** A stale frame reached through a leaked parent chain has `eventPhase === 0`, so the listener runs under `null`, not under that frame.
- **Tests.** Negatives hold: `pointerdown`, the `page.evaluate` share and the load-timer share are all null. `continuations-neutral` passes 5/5, with `nested-leak` null and `pre-armed` null.

**Suite:**

- `npm run build`: byte-identical. `src` and `dist` runtime match (`cmp`). The tree is clean apart from this file.
- `shadow-dom-context.mjs`: exit 0, 3 runs. The new assertions for `pointerdown`, `evaluate`, the load timer, Later and "no request credited to Bump" pass.
- `continuations-neutral.mjs`: ok, 5 runs.
- D12: `pass: true`.
- `node --test test/frontend-only.test.mjs test/action-context.test.mjs`: 21/21.
- `npm test`: 642 tests, 641 pass, 1 fail (the known `react-context-ref-semantics` failure, also on `main`).

**Docs.** D-G1-14 and D-G1-19 are narrowed, D-G1-20 is added, the `main` hash is corrected, and the note that the wrong credit predates this PR is present. All three new limits are listed, plus the `reactEventTarget` note. The docs match the code and the probe results.

**Residual risks (new or remaining):**

1. User-caused trusted events outside `UI_EVENT` still take the registration owner: `drag*`, `drop`, `paste`, `copy`, `cut`, `select`, `scroll`, `composition*`, `gotpointercapture`. They are not probed. The fix is to extend the regex or test `event instanceof UIEvent`.
2. An untrusted re-emit from code with no owner now runs under no action. An example is a library that forwards a native callback set before the action through `dispatchEvent`. Earlier this took the registration owner. The change trades a possible credit for an abstention, never for a wrong credit, and I judge that the right trade.
3. The earlier limits (async-rendered roots, slots, a closed root nested in an open root, `stampShadow` cost, the `reactEventTarget` over-match) are disclosed and unchanged.
4. The `focus`-inside-click case is verified only by this probe, not by a gate test. Adding it as a fixture case is recommended.

**Final verdict: merge.** All requested changes are applied. Every probe gives the expected attribution. Nothing regresses against `main`, and ownership for trusted non-UI events is preserved. Items 1 and 4 above are small follow-ups and do not block the merge.

## Rebase onto 3c83e5b3 (2026-09-24)

The branch was rebased onto `main` 3c83e5b3. That base contains PR #5 (fix/mcp-rendering), PR #2 (fix/worker-frontier) and PR #6 (fix/stable-element-keys). No behaviour was dropped from either side.

**What conflicted and how it was resolved:**

- **`src/runtime-attribution-browser.js` and `dist/`.**
  - **`stampStats`** (in 3 commits): the union of both key sets. It keeps main's `worker_posts_unowned` and the branch's shadow and owned-listener counters.
  - **`beginDomAction`**: main's `target.element_key` plus `stampFieldsFor` (`key_kind` / `instances` / `stamp_sequence`) are kept. The branch's `composed`, `shadow_host` and `closed_shadow` fields follow them.
  - **Stamping**: main's model is kept as is: collect hosts, then page-wide key assignment in `finishStampCommit`, then `applyStamp`, with one row per observation and `content_sig`. Shadow stamping now runs from `applyStamp` after the host's key is set.
  - **`stampShadow` rewritten to main's row contract**:
    - rows carry `key_kind: "ordinal"`, `instances`, `content_sig` and `commit`;
    - `instances` is the number of same-tag controls in the root, multiplied by the host's `instances` when the host key is itself an ordinal;
    - a new row is written only when the observation changes;
    - keys register in `lastRowByKey`, so a `dom.action` on an inner element carries `key_kind`, `instances` and `stamp_sequence`;
    - the old `emittedStampKeys` set (removed on main) is no longer used.
  - Main's worker wrappers and coverage code are untouched.
  - `dist/` was rebuilt at every step, and `cmp` confirms it is identical to `src`.
- **`analysis/element-index.mjs`**: main's `key_kind` / `instances` / `element_confidence` return is kept, and `shadow_host` / `host_tag` are added to it.
- **`test/browser/d12-stamp-neutrality.mjs`**: main's deletion of `element_key`, `key_kind`, `instances` and `stamp_sequence` is kept, plus the branch's deletion of `shadow_host.element_key`.
- **`docs/gates/G3-stamps.md`**: main's sixth-pass section is kept, and the shadow-root amendment is restated against the new row contract.
- **`analysis/runtime-attribution.mjs`**: auto-merged. `SCOPED_ABSENCE` holds both `closed_shadow` and main's `worker`.
- **`mcp/tools.mjs`**: no conflict. PR #5's version stands, and `target.shadow_host` / `composed` pass through as target fields.

**New gate assertions.** `test/browser/shadow-dom-context.mjs` now checks that the inner stamp is `key_kind: "ordinal"`, `instances: 1`, has a 16-hex `content_sig`, and resolves with `element_confidence: "exact"`. It also checks that the shadow click's `target.key_kind`, `instances` and `stamp_sequence` equal the inner key's latest row.

**Runs on the rebased tree:**

- `shadow-dom-context.mjs`: ok, 3 runs.
- `stable-element-keys.mjs`: `pass: true`, 19/19 checks.
- `node --test test/worker-frontier.test.mjs`: 7/7.
- `continuations-neutral.mjs`: ok, 5 runs.
- D12: `pass: true`.
- `npm test`: 692 tests, 691 pass, 1 fail (the known `react-context-ref-semantics` failure). Main is 690/691; this branch adds one node test.
