# G5 rehearsal rerun after the coordinator decisions (2026-09-23b)

Same scenario, commands and fixture seed as `docs/evidence/g5-anything-llm-2026-09-23/RUN.md` (unchanged). The package was packed from commit `7f91a252`, which includes gate §12:
- the episode split now lives in the shared `indexWorkflowEpisodes`;
- the collector sink is localhost-only and off in Vite production mode unless `force: true`;
- the collector records `source` and `steps` via `POST /run-info`.

```sh
git -C /Users/austinho/dev/fixtures/anything-llm checkout -b g5-scenario
git -C /Users/austinho/dev/fixtures/anything-llm -c user.name=g5 -c user.email=g5@local am docs/evidence/g5-anything-llm-2026-09-23/fixture-seed.patch   # → dc06bc04
node test/browser/g5-rehearsal.mjs --repo /Users/austinho/dev/fixtures/anything-llm --out docs/evidence/g5-anything-llm-2026-09-23b --port 4100
git -C /Users/austinho/dev/fixtures/anything-llm checkout master && git -C /Users/austinho/dev/fixtures/anything-llm branch -D g5-scenario
node test/g5-grader.mjs docs/evidence/g5-anything-llm-2026-09-23b --source-root /Users/austinho/dev/fixtures/anything-llm --out docs/evidence/g5-anything-llm-2026-09-23b/GRADE-g5.md
```

## Result

- Rehearsal: 7/7 PASS (`REHEARSAL.md`).
- Grader: 22/22 PASS (`GRADE-g5.md`).
- The answers match the first run: same key `p_f067e70e6029:117-485#n1`, same component and file:line, same entry handler, attempts 200 / 422 / 200. Only the ids differ.
- Episode ids now come from the shared indexer: `episode:form:<page>:object%3A41` for the first attempt, then `#2` (the 422) and `#3`.
- The plugin line as built: `...producttrace({"stamps":true,"requestBridge":false,"collector":{"url":"http://127.0.0.1:4102","force":true}})`.
- The store's run row now carries `source` (fixture commit `dc06bc049d3d1c618fd5d1c403c8e56cae942981`, clean) and all seven step windows (`store/runs.jsonl.gz`).

## Gates

| gate | result |
|---|---|
| store = harness capture | 0 missing, 0 extra; spans 465 = 465 |
| sink | received 3,303, sent 3,303, 1 retry, 0 dropped |
| tracked source | clean (store path `.tracer` excluded) |
| build gates | marker, parity and smoke pass (`run/build-gates.json`) |
| tarball | `producttrace-0.1.0.tgz`, 149 files, integrity `sha512-00fRCC3fl5jlWQqynAX+ebzqZWwZzF8aLmknzm7LmzyJfDGMznusuM51IxPUiMYdQDe1qRBPsErwj1LNReilxg==` |
| fixture restored | `ad97bc8d` on `master`; empty `git status --porcelain`; empty diff; branch deleted (`fixture-state-restored.json`) |

## Raw rows (`store-files.json`, `RAW-SHA256.txt`)

| file | raw bytes | rows | raw sha256 |
|---|---|---|---|
| `store/records.jsonl.gz` | 3,524,626 | 3,303 | `38e7c57406f1cf8e0250ffe024ec5c75f58b665c072130148c8523c54329883e` |
| `store/spans.jsonl.gz` | 316,423 | 465 | `bde88a265d278af5376439256233f56d8613eb1c32295c201422eb3b24f2f7e0` |
| `store/runs.jsonl.gz` | 1,192 | 1 | `c7f60e5a56a737baff7a7bd8a0dd3dce6b688a028fa496090ec09ff40afbd138` |
| `store/manifests/e061322a6809.json.gz` | 4,131,155 | 5,101 functions | `e544eff364517af4a7161711e5f5c36bbfd3e5cfab570a7105ba1acb46cf8498` |

## Limits

`docs/evidence/g5-anything-llm-2026-09-23/LIMITS.md` applies, except for two items:
- Item 8 no longer holds: the run row now records `source` and `steps`.
- Item 7 changes: the episode split is now in the shared indexer, so the M1 viewer also shows one episode per request-bearing submit.
