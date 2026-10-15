# fix/function-names: rebase onto main 3123791c (2026-09-24)

After the merge grade (regrade at b3879adc, kept as a commit), the branch is rebased onto `main` 3123791c (#18 honest-coverage). Written by the implementing agent. No behaviour change is intended. RUN.md and RUN-2.md are unchanged.

## Conflicts and how both sides were kept

- `analysis/causal-chain.mjs`: main's window facts (`windowIndex`, `windowEvidence`, `windowRoots`) are kept, and `appEvidence(…, { errorClassName })` is added.
- `analysis/runtime-attribution.mjs` (`buildActionChains`): main's shared `windows` index, `sendsByAction` and `record` on outcomes are kept, and `errorClassName` is added next to `unlinked: windows`.
- `collector/store.mjs`: the unrestricted chain keeps main's `unlinked` and adds `errorClassName`.
- `mcp/tools.mjs` (`actionChain`): main's `escapeFields` and `renderUnobserved` are kept. The named `listeners` field and the `renderListeners` line are added.
- `test/browser/mcp-gaps.mjs` P2: main's new wording (`not attributed to any user action; …`) is kept, with the build-time name of the effect arrow (`armed by <callback of useEffect>`).
- `plugin/skills/tracer-annotations/SKILL.md`: main's new bullets (`coverage.unobserved`, `server_hop`, `websocket`, request-less headline) are kept. The names bullet follows them in its RUN-2 wording (`inferred` vs `inferred_from_source_text`).

`npm run build` + `cmp src/dist runtime`: identical.

## Checks (sequential, on the rebased head)

| check | result |
|---|---|
| `function-names.mjs` | 263/263. Production vs development: 75/75 shared ids with identical names. Production vs dev server: 75/75. Marker gate: 75 = 75 on both builds, 0 unmanifested. Production `ApiError` reads `{minified:"Lt", source:"ApiError"}`. |
| `npm test` | 731 tests, 730 pass. The one failure is the known `react-context-ref-semantics`. `main` has 723 tests. The 8 extra are this branch's. |
| G4 grader | 81/81 |
| G6 compare regenerated + `g6-grader.mjs` | 6/6. Compare JSON vs `main` 3123791c is identical apart from the name fields (7/7 files). |
| D12 | pass (23/23) |
| `episode-focus` | ok, stable |
| `outcome-labels` | 169/169 |
| `mcp-gaps` | 35/35 |
| `body-capture` | 51/51 |
| `middleware-reads` | 343/343 |
| `client-aborts` | 245/245 |
| `server-outbound` | 154/154 |
| `honest-coverage` | 45/45 |
