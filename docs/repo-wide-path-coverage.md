# Whole-repository coverage: first isolated fix

Branch: `repo-wide-path-coverage`. The first change resolves TypeScript path aliases per importing file, rather than treating them as repository-global names. No library contracts or backend adapters change.

## Why this matters

LibreChat uses `~/hooks` in both its client application and its client workspace package. Those aliases point to different source directories. The previous global alias map discarded the name as ambiguous and sent 13 application-code boundaries into the external-library backlog. The same problem affected other reused aliases.

The resolver now retains the nearest config and its hash alongside each importer. A nested config cannot borrow a parent config's alias, and sibling packages cannot borrow each other's handlers. Config inheritance and unsupported resolution forms remain outside this narrow change; this does not claim full TypeScript module-resolution parity.

## Measured result

The pinned LibreChat checkout was unchanged throughout the read-only analysis. The analyzer received only the repository path, with no control or source-file selection.

| Measure | Before | After |
| --- | ---: | ---: |
| Indexed controls | 598 | 598 |
| Source edges | 2,404 | 2,441 |
| Runtime-binding candidates | 77 | 77 |
| Complete request candidates | 1 | 1 |
| Library backlog entries | 268 | 255 |
| `~/hooks` library backlog entries | 13 | 0 |

These are graph and backlog counts, not runtime coverage percentages. The additional source edges expose more downstream frontiers; they do not establish another complete execution path.

Validation: 111 automated tests pass, including two workspaces with the same alias and a nested config that deliberately lacks it. A separate real-repository acceptance validates four exact call-to-source targets without supplying them to the analyzer: `clearMessagesCache`, `findConversationInInfinite`, `removeCharIfLast`, and `buildShareLinkUrl`. It also verifies both `~/hooks` resolutions and retention of the existing complete request candidate. The acceptance scan took 4.6 seconds.

Run:

```sh
node test/acceptance/librechat-workspace-aliases.mjs /path/to/pinned/LibreChat /tmp/alias-acceptance.json
```

This is source-analysis validation. The running browser demo remains on the previously validated PR 1 installation; no new browser-to-database path is claimed here.

## Remaining gap categories and ownership

- **First-party code:** alias resolution, returned callbacks, closure bindings, and unsupported control flow belong to this task. Fixing a path means preserving exact symbols, invocation arguments, and branch conditions, not guessing a target by name.
- **External library behavior:** the separate control path mapper task owns held-out proposal and deterministic-verification tests. A package listed in the lockfile is not automatically modeled. The current bank has 13 contracts across seven packages.
- **Runtime propagation:** source reachability alone does not prove a request came from a click. Deferred callbacks without a proven occurrence link remain gaps.
- **Backend coverage:** framework expansion remains a separate, lower-priority PR. Existing database telemetry does not prove response contents or the final product outcome.

## Jelly and Joern decision

The saved September 6 evaluation on the same pinned LibreChat revision reported Jelly's full first-party scan at 12.34 seconds and 2.74 GB, with no focused Rename/Regenerate completion gain. Its unbounded dependency scan exhausted a 4 GB heap. The Joern evaluation reported no added source-verified focused causal facts and incorrect same-name call links. These are historical measurements from the earlier mapper, not new benchmarks of this branch.

Neither tool is needed to resolve config-scoped aliases. Before porting Jelly, require a concrete remaining first-party call that it resolves correctly and the current compiler cannot, with exact source alignment and decoy-target negative tests. Joern requires the same gate; its CPG alone does not prove runtime execution.

Evidence reports remain in the prior workspace under `evidence/jelly-callgraph-evaluation-2026-09-06/report.md` and `evidence/joern-cpg-evaluation-2026-09-06/report.md`.

Do not merge this change without user approval. Keep further tracing mechanisms independently testable.
