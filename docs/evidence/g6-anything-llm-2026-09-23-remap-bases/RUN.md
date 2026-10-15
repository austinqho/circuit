# G6 supplementary: remap bases on the real builds (2026-09-23)

Purpose: rerun the six G6 comparisons after the coordinator's remap amendment (`docs/gates/G6-verification.md` §9: `text_match`, then `name_match`, then `ordinal`, then `unmapped`), on manifests that carry the new keys. This adds evidence only. `../g6-anything-llm-2026-09-23/` is unchanged.

No new browser runs. The rows are exactly `../g6-anything-llm-2026-09-23/store/{records,spans,runs}.jsonl.gz` (sha256 in that RUN.md). Only the manifests differ. Each build's manifest was enriched with `text_sha256` and `name` by `test/browser/g6-enrich-manifests.mjs`. That script reads each build's source from the fixture's git objects at the run's recorded commit (`git show <commit>:<file>`); the fixture working tree was not touched (`git status --porcelain` stayed empty, HEAD `ad97bc8d`). Only rows whose blob hash equals the function id's hash were enriched.

| build | commit | rows | enriched | with a name |
|---|---|---|---|---|
| b-2dc9ecff4d63b25e | ad97bc8d | 5,101 | 5,101 | 1,807 |
| b-a33d446fe91e8701 | 857ab360 | 5,101 | 5,101 | 1,807 |
| b-492209beb3a2e901 | 879685d1 | 5,101 | 5,101 | 1,807 |

Most unnamed functions are inline JSX callbacks and wrapped arrows (`useEffect(() => …)`). For those, `name_match` cannot help and `ordinal` remains the fallback.

## Result (MCP stdio server, `compare/*.json`; grader `GRADE-g6.md`: 6/6 PASS)

| pair | path_changed | entry handler | change_basis |
|---|---|---|---|
| A → B | true (route, outcome) | same | |
| B → C-fix-r2 | true (route, outcome) | same | |
| A → C-fix-r2 | false | same | |
| A → D (no-op refactor) | **false** | source_revision | **name_match** (`handleUpdate`; text differs because `data` → `payload`; reverse also `name_match`) |
| A → E (frontend early return) | true (request, route, handler, outcome) | source_revision | **name_match** (text differs because of the added line) |
| B → C-fix (control) | false | same | |

Only the entry-handler basis moved relative to the original evidence: `manifest_remap`/ordinal became `name_match`. Every `path_changed` verdict and every stop status is unchanged. `text_match` does not fire on real data here: both frontend edits change the handler's own text. It is exercised by the unit test in which a function is added above an unchanged handler.

## Reproduce
```
mkdir -p /tmp/st2/manifests
for f in records spans runs; do gzcat docs/evidence/g6-anything-llm-2026-09-23/store/$f.jsonl.gz > /tmp/st2/$f.jsonl; done
for f in docs/evidence/g6-anything-llm-2026-09-23-remap-bases/manifests/*.gz; do gzcat $f > /tmp/st2/manifests/$(basename $f .gz); done
node test/browser/g6-compare.mjs --store /tmp/st2 --source-root /Users/austinho/dev/fixtures/anything-llm \
  --out <new dir> --pair A-baseline:B-seeded-422 --pair B-seeded-422:C-fix-r2 --pair A-baseline:C-fix-r2 \
  --pair A-baseline:D-noop-refactor --pair A-baseline:E-frontend-early-return --pair B-seeded-422:C-fix
node test/g6-grader.mjs /tmp/st2 --compare <new dir>
```
The enriched manifests can also be regenerated from the fixture's git objects with `test/browser/g6-enrich-manifests.mjs --store docs/evidence/g6-anything-llm-2026-09-23/store --repo <fixture> --out /tmp/st2/manifests`. This works as long as the scenario commits (`857ab360`, `879685d1`) have not been garbage-collected: the branch was deleted, so they are now unreachable objects.

| file | sha256 (.gz) | sha256 (uncompressed) |
|---|---|---|
| manifests/b-2dc9ecff4d63b25e.json.gz | 6e8151fbf89213bfa28aba1ed030beb986a6d260062ebb4b289ab31012bd501c | 255fdcd4cad18f5814457b49b09ec2322b4b49166e8196b0e258cd181ca7d538 |
| manifests/b-a33d446fe91e8701.json.gz | f90de26ce4f3902f3e5f31d785c10f8c791462ee83bec57efc468051fd9ae8d0 | a0063d88692fe1c595b7c580aa81917c87f2175f9865065c87c5d1e7af0077cd |
| manifests/b-492209beb3a2e901.json.gz | c5c5eab03b11fa36eb7ec28b249e086f25c78467a2ea8647ef6c283019112639 | 0d572292009388a9fa9ce803a272b8d2278cc30a253ddcc95a006f536c6f485c |

These manifests keep the bundle-local `index` inherited from the original store (see `../g6-anything-llm-2026-09-23/ERRATA.md` item 2).
