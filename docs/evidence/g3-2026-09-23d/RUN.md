# G3 element stamps, fourth pass (2026-09-23d)

Gate text: `docs/gates/G3-stamps.md` (the "Fourth pass" section was recorded before this rerun). All browsers were headless Chromium. Code: branch `g1-g3-stamps`, head `595b334e` (the five fourth-pass commits `b42ba84f..595b334e`); no engine code was changed while producing this directory.

## Build

- LibreChat fixture `45cc53c`, worktree `/tmp/producttrace-librechat-m1-final2`.
- The LibreChat build served during the survey is `687a51791eb4`. It was built by `scripts/m1-live.sh` (telemetry on, `PRODUCTTRACE_OPENAI_FIXTURE=1`) at 10:01:41 PDT, after the head commit (09:50:07 PDT). No tracked file changed after that build. Manifest: 8,928 functions, 8,198 placements (the runtime reports 8,076 placements registered on the loaded chunks). The manifest is `../g1-2026-09-23d/attribution-manifest.json.gz`.
- `npm run build`: "built byte-identical runtime (304724 bytes)", and `dist/` is unchanged.

## 1. D12 byte identity (`d12/`, `d12.log`)

Command: `node test/browser/d12-stamp-neutrality.mjs /Users/austinho/dev/trace-consolidated/.live-demo/librechat-m1 docs/evidence/g3-2026-09-23d/d12`. Neutral fixture build `712787f9b496`.

| variant | records | element.stamp | keyed actions |
|---|---|---|---|
| A: stamps + stub `document.oai.annotation` | 159 | 18 | 21 |
| B: stamps stripped from the DOM | 159 | 18 | 0 |
| C: stamps off | 141 | 0 | 0 |

- **17 of 17 checks pass** (`d12/report.json`).
- `normalized-{A,B,C}.jsonl` are identical: sha256 `413372b742fd22c9c768341f8bf945bca4d627b2f2eced7afaf6fb8f4f0b42cb`.
- `causal-chains-{A,B,C}.jsonl` are identical: `8811c7ea08adb8ac758701a888f183fc3afa2293db4d493ffc93744b93282ae5`. That is the same chain sha as in round three.
- The normalized-record sha differs from round three (`ecff86e7…`). The fourth-pass runtime emits different attribution rows on the same fixture. Byte identity is judged within one run, across its A/B/C variants.

## 2. LibreChat survey

Command: `node test/browser/g3-librechat-stamps.mjs /tmp/producttrace-librechat-m1-final2 docs/evidence/g3-2026-09-23d`. It ran with the telemetry-on services up (backend on 3080, chat fixture). There are two sessions (stub `document.oai.annotation` / no stub), each visiting four surfaces. Log: `g3-run.log`.

| file | sha256 | rows |
|---|---|---|
| `records.jsonl` | `cb637ea1326097f539e63e1f3fe6588da8400cf267879e04f59a229c274d36af` | 643 |
| `survey-elements.jsonl` (every interactive host, per surface and variant) | `48ca12ed3a5fb57034fd00c00042139a92b4b67af45724cadc9a2bc2bd28bbf6` | 668 |
| `survey-own-site.jsonl` (every `[data-tracer-el]` node, with renderer / function-child flags) | `87afcf26cd0c7b64b0147833f8330717f8297f8d33ef8929b4bf92baa4b944ed` | 2,502 |
| `oai-payloads.jsonl` (every OAI payload read from the DOM, with the validator's verdict) | `bcbff6d3fcaa66d60b09a3dcae37154dba49812e088cb332f6622966e9fd68b8` | 1,251 |

### Interactive coverage

- Stamped/interactive hosts per surface: 67/68, 85/86, 97/98 and 81/82, the same in both sessions. The one miss per surface is a `textarea` with reason `not_rendered_by_react`.
- `unplaced_nodes` 0; `invalid_keys` 0.
- These counts are the same as in round three. The per-element rows are now recorded (`survey-elements.jsonl`: 660 keyed, 8 unkeyed).

### Stamp rows

- 604 `element.stamp` rows with 339 distinct keys. In round three: 556 and 279.
- `placement_via` counts:
  - 356 `self`;
  - **24 `render_prop`** (new);
  - 210 `first_host`;
  - 14 `ancestor`.
- 84 rows carry `binding_placement`.

### Own-JSX site (fourth pass: render-prop hosts, function-child misses)

These are counts over the stamped DOM nodes that have a matching stamp row (1,462 observations):

- **Own site: 902.** Of these, 822 are `self` and **80 are `render_prop`**. The `render_prop` hosts are at:
  - `Fork.tsx:333`;
  - `Feedback.tsx:149/183`;
  - `SendButton.tsx:20`;
  - `AudioRecorder.tsx:110`;
  - `ModelSelector.tsx:72`;
  - `ExpandedPanel.tsx:50`;
  - `ProjectsSection.tsx:520/533`;
  - `Conversations.tsx:130`;
  - `TemporaryChat.tsx:43`;
  - `AgentAvatar.tsx:83`;
  - `FileContext.tsx:152`.
- **Rendered inside a library component, with no first-party JSX for the element: 554** (530 `first_host`, 24 `ancestor`).
- **First-party JSX missed: 6.** All are the `CellMeasurer` function child at `Conversations.tsx:59`, now counted as a miss. In round three they were counted as library-rendered.
- **Share of elements with first-party JSX: 902 / 908 = 99.3%.** Overall share: 902 / 1,462 = 61.7%.
- Per stamp row: 380 own, 218 library, 2 first-party misses, 4 not in the final DOM. That gives 380/382 = **99.5%** on the first-party-JSX denominator, and 380/604 = 62.9% on all rows.
- The grader's corrected round-three figure was about 92.7–96.1%. This pass places the render-prop hosts, so the figure is higher, and the misses are counted rather than hidden.
- **Not covered:** the Save & Submit button (`EditMessage.tsx:190`, the grader's example) is not on any surveyed surface, so this survey does not show its `render_prop` placement.

### OAI

- With the stub: 1,251 payloads read from the DOM, 0 invalid under the harness's independent §4.3 check. Every row has `failure: null`.
- Without the stub: 0 OAI attributes.
- The two identical screenshots of round three are no longer produced.

### Resolve sample

30 of 30 keys resolve exactly: `<tag` at the recorded line of the file on disk (`coverage.json` → `resolve_sample`).

## 3. Checks (`coverage.json` → `checks`)

All checks pass except `every_interactive_host_stamped`, which fails on the one non-React textarea per surface. That is the same as round three.

## Round-four ("must change before merge") items that concern G3

| # | item | what changed | evidence |
|---|---|---|---|
| 4 | Correct the own-JSX figure and the classifier | `e5756a0a`: render-prop hosts resolve to their own JSX (`render_prop`). A function-child host that is not placed counts as a first-party miss. The figure is now 99.3% (observations) / 99.5% (rows) on the first-party denominator, with 6 / 2 misses listed. It is no longer "100%". | §2 above, `coverage.json` → `own_site` |
| 6 | Record OAI payloads and the per-element survey | Done: `oai-payloads.jsonl`, `survey-elements.jsonl`, `survey-own-site.jsonl`. | this directory |
| 6 | Record the off-build manifest for span neutrality | See `../g1-2026-09-23d/RUN.md`. | `../g1-2026-09-23d/` |
| 7 | RUN/LIMITS wording | The duplicate screenshots are dropped. The "100%" claim is replaced by the counted figure. | this file, `LIMITS.md` |

The G1 items (1, 2, 3, 5 and the G1 parts of 7) are in `../g1-2026-09-23d/RUN.md`.
