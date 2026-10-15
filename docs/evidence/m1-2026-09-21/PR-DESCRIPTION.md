# Draft PR description

## Claim

M1 adds an observed runtime-attribution engine with stable source-span function IDs, identity-only argument encoding, async action ownership, opaque library boundaries, causal-chain records, and explicit replay stops.

## Gate text

Review the raw evidence in `docs/evidence/m1-2026-09-21/`. The LibreChat fixture session was driven headless; the Vite build and Agent Builder provider setup stopped before a complete end-to-end chain could be emitted. No result is graded in this branch.

## Evidence

- `RUN.md`, `records.jsonl`, `spans.jsonl`, `chains.md`
- `coverage.json`, `overhead.md`, `negative-replays.md`, `overlap.md`, `LIMITS.md`

## Tests

`npm test`: 531 passing, 0 failing.
