# fix/mcp-gaps: run record 3 (after the regrade, 2026-09-24)

These commits sit on top of `0f332d05`, the grader's regrade section at `ead93888` (verdict "merge with changes", two items). RUN.md and RUN-2.md stay as written.

## 1. Nested await: fixed, not just disclosed

**The bug.** Bundlers emit `await (await fetch(u)).json()`, including from the two-statement form, and the two awaits share one rewrite slot. The built code is:

```js
__ptAwR(__ptAw=__ptAwS(__ptAw), await __ptAwL(__ptAw, (__ptAwR(__ptAw=__ptAwS(__ptAw), await __ptAwL(__ptAw, fetch("/api/body")))).json()))
```

The outer suspend captured its frame before the inner await resumed, so the outer resumption had no `response_of`.

**The fix** (`src/runtime-attribution-browser.js`, `dist` rebuilt, `cmp` identical):
- When `awaitLeave` sees that an inner await of the same slot has resumed (`w.resumed`), it records the resumed frame's `response_of` (`w.carry`) before restoring.
- `awaitResume` applies `w.response || w.carry`.
- Only the response origin is carried. The captured owner frame (`w.frame`), and so ownership capture timing, is unchanged.

**The fixture** has the exact form, `async function loadBody() { await (await fetch('/api/body')).json(); bodyLoaded(); }`. The built chunk above confirms the nested shape.
- W12 (raw): `bodyLoaded`'s enter row has `response_of` = the `/api/body` request.
- W13 (MCP): it prints `after response 200: bodyLoaded client/src/main.jsx:<line> (await continuation)`.

G4 has a short dated amendment saying that nested awaits are covered.

## 2. ERRATA §3

RUN-2 said neither banked store has a recursion-like run. In fact final7 has 167 raw `function.enter` rows (3 functions, 8 actions) whose spine ends in ≥ 3 of the same id. None is rendered: they are below depth 4 and past the 100-entry cap. G6 has 0. Both counts were recomputed here from the raw rows.

## Counts (rerun after the change)

| Check | Result |
|---|---|
| `node test/browser/mcp-gaps.mjs` | **34/34** (adds W12, W13) |
| `npm test` | 692 tests, 691 pass, 1 fail (known `react-context-ref-semantics`) |
| D12 | pass: true, 17/17 |
| continuations-neutral | status ok |
| G4 grader | 81/81 |
| G6 (`g6-compare.mjs` 6 pairs + `g6-grader.mjs`) | PASS 6/6 |
| worker-frontier, shadow-dom-context, stable-element-keys, no-cross-control-neutral, effect-rooted-form-neutral | exit 0 |
| unlinked-coverage-neutral | 12/13, A8 only (pre-existing, same on `main`) |
| `npm run build`; `cmp src/… dist/…` | identical |

## Banked diffs

- **Against `main`:** `diff-3-final7-source-root.txt`, `diff-3-final7-no-source-root.txt` and `diff-3-g6.txt`.
- **Against the previous head (`ead93888`):** identical on all 103 + 103 + 133 calls. The banked rows come from older runtimes with no `response_of`, so the runtime change cannot show there.

## Residual

The carry applies to any await whose operand contains a resumed await of the same function. In that case the code after it runs after the inner await's response by construction, so the mark is sound. An await operand that resumes an inner await on a non-response promise carries nothing: there is nothing to carry.
