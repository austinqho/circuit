# G3 element stamps, second pass (2026-09-23b)

Gate text: `docs/gates/G3-stamps.md` (amended, see "Second pass" there). Headless Chromium only. Code: branch `g1-g3-stamps` on `main` `2dd6e7a2`, commit `001ed093`.

## 1. D12 byte identity (`d12/`)

`node test/browser/d12-stamp-neutrality.mjs /Users/austinho/dev/trace-consolidated/.live-demo/librechat-m1 <out>`. The fixture is now built on a real path, so the G2 module pass runs as well as the chunk pass.

| variant | rows | element.stamp | attribution rows |
|---|---|---|---|
| A: stamps + stub `document.oai.annotation` | 159 | 18 | 141 |
| B: stamps stripped from the DOM | 159 | 18 | 141 |
| C: stamps off | 141 | 0 | 141 |

- After removing `element.stamp` rows and `target.element_key`: the records are byte-identical (90,593 bytes each) and the chains are byte-identical (9,692 bytes each).
- `dom.action.bound_handlers` (new) is identical in all three, because it is read from fibers, not from stamps.
- All 17 checks pass (`d12/report.json`), including:
  - **new** `stamp_keys_identical_across_loads`: two page loads give the same keys;
  - every interactive host stamped;
  - OAI payloads valid under an independent §4.3 check;
  - `tracer_last_action` names an action that targeted that key;
  - every key resolves to `<tag` at its line on disk.

## 2. LibreChat survey (`coverage.json`, `records.jsonl`)

`node test/browser/g3-librechat-stamps.mjs /tmp/producttrace-librechat-m1-final2 <out>`, the G1 build `550051da4ebe` (1,566 placements, 0 short-key collisions), backend on, chat fixture; two sessions (stub `document.oai.annotation` / none) × four surfaces.

- React-rendered interactive hosts stamped: 67/68, 85/86, 97/98, 81/82 in both sessions. The one miss per surface is a textarea not rendered by React. `unplaced_nodes` 0.
- 325 stamp rows, 188 distinct keys. `placement_via`: 36 self, 108 first_host, 181 ancestor (placements are now chunk-level; see G1 LIMITS).
- OAI:
  - stub session: 710 payloads written, 0 invalid under the independent checker, 0 rejected by the runtime validator;
  - no-stub session: 0 OAI attributes.
- `resolveElement` (pure, no MCP): a seeded random sample of 30 keys resolves 30/30 `exact` to the on-disk `<tag` at the recorded line.

## Verdict against the G3 criterion

- **Interactive hosts on both new repos carry `data-tracer-el`**: not reached. The two G2 repos were not surveyed in this pass.
- **Every React-rendered interactive host on the four LibreChat surfaces is stamped**: reached.
- **`resolve_element` file:line sample**: reached on LibreChat (30/30, script-graded).
- **D12 byte identity**: reached (fixture).
- **OAI attributes only with `document.oai.annotation`, all payloads valid**: reached.
