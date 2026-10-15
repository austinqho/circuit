# Handler binding: RUN-5 (unbound request issuer after bound request, 2026-09-24)

This is implementer verification of the required change in the Codex grade at `2ba41753`, not an independent grade. The branch remained stacked on `cd91a186`; no rebase, install, grader-scratch edit, PR, or merge was performed. Browser runs were headless. Logs and the archived base control were written under `/tmp/tracer-run5-*`.

## Rule and regression

`indexEntryHandlerUnits` now collects request issuers from unbound depth-zero frames whenever a bound handler is preferred. The collection no longer depends on whether the preferred bound handler differs from the initially selected candidate. Handler ranking and request lineage are unchanged.

The fixture's **Save then bubble** button issues `/api/save-bubble` from its React `onClick` handler. A `document.body` bubble listener then issues `/api/body-bubble` on the same click. The driver verifies raw request sequence and occurrence identity, bound `saveBubble` credit, no binding row for `bodyBubble`, and the `bodyBubble` unbound issuer and request occurrence ID on the structured `action_chain`, `element_history`, and `buildActionChains` export. The MCP chain text also prints “Requests issued by a frame not bound to this element.” The fixture's exact global-listener-set assertion includes the added listener.

## Results

| Check | Result |
|---|---|
| Handler-binding driver, three invocations × three page loads | **145/145 ×3**; new C34 passed on every load |
| Negative control: `cd91a186` runtime from a temporary `git archive`, with this driver and fixture | **19/145** over three loads; C34 failed on all three |
| Trusted-events | **118/118** |
| D12 stamp neutrality, three invocations | **24/24 ×3** (`pass: true` each) |
| Continuations-neutral | `status: ok` on first run |
| Episode-focus | `status: ok` ×3 |
| Outcome-labels; MCP gaps; body-capture | **169/169; 35/35; 51/51** |
| Function-names; G4 final7 | **263/263; 81/81** |
| G6 | Gunzipped records, runs, spans, and three manifests into `/tmp`; regenerated six `compare_chains` pairs against the banked store; independent grader **6/6** |
| `npm test` | **730/731**; sole failure `react-context-ref-semantics.test.mjs:63` (`'a' !== 'b'`), the known base failure |
| `npm run build`; source/dist comparison | build passed; `cmp src/runtime-attribution-browser.js dist/runtime-attribution-browser.js` identical |

The negative control used an archive rather than another worktree. The existing `node_modules` symlink was reused; no package installation ran. G6 comparison data came from `docs/evidence/g6-anything-llm-2026-09-23/store/*.gz`; no evidence directory was changed.

## Static mapping scope

The “no static prop-to-native-event map” claim applies to **observed handler credit** in the D-G1-22 path. `src/runtime-attribution-browser.js` derives `prop.slice(2).toLowerCase()` only as a declared stamp display label. Two pre-existing mappings elsewhere in the package are outside that claim: `src/producttrace-runtime.js` maps legacy `click` to `onClick` to decide whether a click is meaningful, and `analysis/library-contracts.mjs` declares versioned Ariakit callback-prop/activation-event contracts. Neither supplies an observed `handler.binding` row or chooses this MCP entry-handler credit.
