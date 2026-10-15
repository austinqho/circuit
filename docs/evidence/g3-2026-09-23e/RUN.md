# G3 element stamps, fifth pass (2026-09-23e)

Gate text: `docs/gates/G3-stamps.md`. All browsers were headless Chromium. Engine head: `08c509c2` (branch `g1-g3-stamps`).

This pass changed the G1 attribution runtime, not the stamper. D12 and the survey are rerun to show that stamps stay neutral under the new runtime. Outputs made on `999deea4` are in `superseded-999deea4/`.

## Build

- The survey ran against the LibreChat build served for the G1 telemetry-on run: `/tmp/producttrace-librechat-m1-final2`, build `5ff8a34ee267`.
- The manifest has 8,954 functions and 8,198 placements. The runtime reports 8,076 placements registered on the loaded chunks.
- Manifest: `../g1-2026-09-23e/attribution-manifest.json.gz`.

## 1. D12 byte identity (`d12/`, `d12.log`)

Command: `node test/browser/d12-stamp-neutrality.mjs /Users/austinho/dev/trace-consolidated/.live-demo/librechat-m1 docs/evidence/g3-2026-09-23e/d12`. Neutral fixture build `712787f9b496`.

| variant | records | element.stamp |
|---|---|---|
| A: stamps + stub `document.oai.annotation` | 81 | 18 |
| B: stamps stripped from the DOM | 81 | 18 |
| C: stamps off | 63 | 0 |

- **17 of 17 checks pass** (`d12/report.json`).
- `normalized-{A,B,C}.jsonl` are identical: `b4b14fa71b3f3946b905de5b8329df05fef19e23687990643b48c34f34f8fbec`.
- `causal-chains-{A,B,C}.jsonl` are identical: `de7d64a66ee68e1e667bf990607b7b665abf54e09072fb215b87a7ca2ab923fb`.
- Both shas differ from round four, whose runs had 159/141 records. The new runtime no longer lets renders inherit the action, so fewer function rows are emitted. Identity is judged within one run, across its A/B/C variants.

## 2. LibreChat survey

Command: `node test/browser/g3-librechat-stamps.mjs /tmp/producttrace-librechat-m1-final2 docs/evidence/g3-2026-09-23e`. It ran with the telemetry-on services up (backend on 3080, chat fixture), in two sessions (stub / no stub) × four surfaces. Log: `g3-run.log`.

| file | sha256 | rows |
|---|---|---|
| `records.jsonl` | `f19c9874366e16dc96e655f5b338fd47765f3695e37f1672388b46b0f3463c8f` | 582 |
| `survey-elements.jsonl` | `7e8a8966290a7728decc46dd8ed017edcfb839b5065e770f96befa8b63642f64` | 674 |
| `survey-own-site.jsonl` | `5bb7bda42d18ab9242cb21adfee400d39352b87169494b2aedec220fb9979e61` | 2,536 |
| `oai-payloads.jsonl` | `b8253686530f97340f0d6498b63807ef59be21819546cab0b0ea37e05a22484a` | 1,268 |

- **Interactive coverage.** Stamped/interactive hosts per surface: 68/69, 86/87, 98/99 and 81/82, the same in both sessions. The one miss per surface is a `textarea` with reason `not_rendered_by_react`, as in rounds three and four.
- `unplaced_nodes` 0; `invalid_keys` 0.
- **Stamp rows.** 544 rows with 279 distinct keys (round four: 604 / 339).
  - `placement_via`: 330 `self`, 180 `first_host`, 20 `render_prop`, 14 `ancestor`.
  - 79 rows carry `binding_placement`.
- **Own-JSX site.** Over the observations:
  - own site: 728 (674 `self`, 54 `render_prop`);
  - library-rendered with no first-party JSX: 432;
  - **first-party JSX missed: 12**. All are the `CellMeasurer` function child at `Conversations.tsx:59` (round four: 6).
  - Share on the first-party-JSX denominator: 728/740 = **98.4%**.
  - Per stamp row: 350 own, 187 library, 3 missed, 4 not in the final DOM, which gives 350/353 = **99.2%**.
- **OAI.**
  - With the stub: 1,268 payloads read from the DOM, 0 invalid.
  - Without the stub: 0 OAI attributes.
- **Resolve sample.** 30 of 30 keys resolve exactly.
- **Checks** (`coverage.json` → `checks`): all pass except `every_interactive_host_stamped`, which fails on the one non-React textarea per surface, as before.

## Worse than round three / four

- The own-JSX figure is 98.4% / 99.2%, against 99.3% / 99.5% in round four. There are more `CellMeasurer` rows on the surveyed surfaces (the conversation list rendered more rows); this is the same known miss.
- Distinct keys and rows are lower than round four (279 vs 339). The survey visits the same four surfaces, but the conversation content differs between runs.
