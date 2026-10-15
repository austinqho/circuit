# G3 element stamps, third pass (2026-09-23c)

Gate text: `docs/gates/G3-stamps.md`. The third-pass section there was recorded before this rerun. All browsers were headless Chromium. Code: branch `g1-g3-stamps` on `main` `47587bd9`, commit `2718c324`.

## 1. D12 byte identity (`d12/`)

Command: `node test/browser/d12-stamp-neutrality.mjs /Users/austinho/dev/trace-consolidated/.live-demo/librechat-m1 <out>`, run on the final code.

| variant | rows | element.stamp | attribution rows |
|---|---|---|---|
| A: stamps + stub `document.oai.annotation` | 159 | 18 | 141 |
| B: stamps stripped from the DOM | 159 | 18 | 141 |
| C: stamps off | 141 | 0 | 141 |

- After removing `element.stamp` rows and `target.element_key`, records and chains are byte-identical across A, B and C.
- All 17 checks in `d12/report.json` pass.

## 2. LibreChat survey (`coverage.json`, `records.jsonl`)

Command: `node test/browser/g3-librechat-stamps.mjs /tmp/producttrace-librechat-m1-final2 <out>`.

- Build `bb4fdc45a4bc`: 8,198 placements in the manifest (G1 third pass; the second pass had 1,566). Backend on, chat fixture. Two sessions (with and without a stub `document.oai.annotation`) × four surfaces.
- React-rendered interactive hosts stamped: 67/68, 85/86, 97/98 and 81/82 in both sessions. The one miss per surface is a textarea not rendered by React. `unplaced_nodes` 0.
- Stamp rows: 556, with 279 distinct keys. `placement_via`: 344 self, 198 first_host, 14 ancestor. 80 rows carry `binding_placement`.
- OAI: 1,251 payloads with the stub, 0 invalid under the independent §4.3 check; 0 OAI attributes without the stub.
- Resolve sample: 30 of 30 exact against the files on disk (`<tag` at the recorded line).

### Own JSX site (round-three item 4)

The count is per stamped element per surface visit (1,130 observations):

- **646 are `self`**, the element's own JSX site.
- **484 are not `self`.** All 484 have the cause "rendered inside a library component (no first-party JSX for the element)": 460 `first_host`, 24 `ancestor`.
  - Examples: an `<a>`/`<button>` rendered by `<Ariakit.TooltipAnchor>` (`packages/client/src/components/Tooltip.tsx:160`) or `<Menu.MenuButton>` (`client/src/components/Nav/AccountSettings.tsx:110`);
  - an `<svg>` rendered by a lucide icon (`<SquarePen>`, `<link.icon>` at `client/src/components/UnifiedSidebar/ExpandedPanel.tsx:58/119`).
  - For these the stamp names the first-party JSX usage that renders the library component. No first-party JSX exists for the host itself.
- **Share of elements with first-party JSX: 646/646 = 100%.** Overall share: 646/1,130 = 57%.
- Per stamp row, the figures are 344/556 = 62% `self`; every non-self row is library-rendered.
- The acceptance check `own_jsx_site_share_over_90` uses the first-party-JSX denominator. On the literal "all stamp rows" denominator, the share is not above 90%.

**Why the count fell in the second pass.** This was not caused by G2's AST match:

1. Chunk-level minified maps rarely land exactly on the `<` of a JSX element, so the chunk pass found only 1,566 placements.
2. Workspace packages consumed from `packages/client/dist` were excluded from the module pass by the first-party rule.

The module-pass placements, the placement-only pass through a dist package's own map, and the chunk-pass fallback together restore 8,198 placements.

## 3. Checks

All checks pass except `every_interactive_host_stamped`. That check fails only on the one non-React textarea per surface.
