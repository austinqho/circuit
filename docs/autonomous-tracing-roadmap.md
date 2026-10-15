# Autonomous Tracing Roadmap

Each feature uses a separate branch from `main` and must pass its own acceptance test before user-approved merge. On September 8 the user approved PR 1 and authorized PR 2 to run asynchronously in the control path mapper task while this task works on whole-repository path coverage. Backend framework expansion remains last priority.

Jelly or Joern may be reused or ported where they improve program analysis. Framework and library additions discovered during this work should be recorded for the relevant later PR instead of expanding the active PR.

## PR 1: Autonomous end-to-end mapping in the wild

**Status:** User approved and merged as PR #4 at `3400b356dce89c31cf8503d22b01aa204e0f0b61`. See [acceptance results](pr1-acceptance.md).

**Goal:** Given a clean LibreChat checkout and a runtime click on an unannounced control, Tracer independently produces:

```text
control -> callbacks -> request -> route -> handler -> database
```

The run must not receive a Load more file list, button label, route hint, contract selection, expected handler, or compiled-bundle string. Tracer may inspect the repository, dependency metadata, build output, and runtime evidence through its normal product interface.

Tracer must attach runtime evidence to the exact control occurrence, select the matching statically discovered path, correlate the outgoing request with the backend route, and confirm downstream handler and database execution. When it cannot prove a link, it must stop at that boundary and report an explicit frontier with the evidence it has and what remains unresolved.

**Validation:** Start from a clean checkout, attach Tracer without path-specific configuration, use computer control to click an unannounced LibreChat control, and grade the emitted evidence against the hidden expected path. Passing requires accurate links or explicit frontiers; plausible guesses fail.

## PR 2: Unseen library proposal and verification

**Status:** Delegated to the existing `control path mapper` task (`01a06ea4-6bf6-7af2-9e11-0f17854d7f39`) on its own isolated worktree. The user authorized parallel implementation and testing, but has not authorized its merge.

**Goal:** Resolve held-out library functions that are absent from the contract bank by asking an LLM to propose a narrow contract and admitting it only after deterministic verification.

The held-out test supplies only the installed package version, verified dependency source, call site, arguments, and unresolved frontier. Verification must check source and type compatibility, symbol identity, control or data-flow behavior, and negative cases before the proposed contract can affect a trace.

**Validation:** Score a fixed held-out library set and record proposal latency, verification latency, end-to-end latency, token usage, cost, acceptance rate, rejection rate, trace accuracy, and false-admission rate. Expected paths remain hidden until scoring. A proposal that cannot be verified remains an explicit frontier.

## PR 3: Measured backend framework expansion

**Goal:** Expand backend tracing beyond Express according to measured repository coverage, while preserving useful evidence for unsupported frameworks.

First define and sample the target repository population, then rank backend frameworks by observed usage. Add the smallest set of adapters that reaches the documented coverage target, with each adapter grounded in framework semantics and validated on a real application. Candidate frameworks are chosen from the measurement rather than assumed in advance.

**Validation:** Report the population, sampling method, observed coverage, adapter results, and remaining unsupported share. Test at least one real repository from the unsupported approximately 10 percent. Tracer must retain the request and HTTP server evidence, stop before any unproved route or handler identity, and emit an explicit unsupported-framework frontier.


## Parallel lane: Whole-repository path coverage

Branch: `repo-wide-path-coverage`, based on merged PR 1. This task owns coverage accounting and first-party path generalization. The delegated task owns unseen-library proposals and verification on its separate branch. Neither task should modify the other's worktree or the shared live acceptance checkout.

Initial audit of the pinned LibreChat installation:

- Lockfile: 3,150 non-link dependency locations representing 2,248 package names, including transitive and development dependencies. This is an inventory, not verified behavioral coverage.
- Contract bank: 13 narrow contracts across 7 packages.
- Analyzer backlog: 268 entries, including 156 Ariakit and 58 React Hook Form boundaries. Entries can repeat a boundary across scenarios; they are not counts of distinct missing functions.
- 13 entries name `~/hooks`; these are first-party aliases and must not be treated as packages needing LLM-authored contracts.
- Current acceptance still proves one complete request path. Do not imply the other controls are handled.

Next gate: classify control frontiers into first-party resolution, external-library contracts, runtime propagation, and backend gaps; then choose the highest-impact generic mechanism and test it across real paths. Evaluate Jelly or Joern against a concrete unresolved first-party call, measuring added correct edges, ambiguity, latency, and memory. A graph candidate must retain symbol/callsite identity and cannot itself prove runtime execution.

The first whole-repository improvement is now implemented: importer-scoped TypeScript aliases. See [coverage results](repo-wide-path-coverage.md). It passes 111 automated tests plus four real LibreChat source-path assertions; full request coverage remains one path. Awaiting separate user review before merge.
