# Errata for `g1-2026-09-23e/` (evidence dir left unchanged)

1. **`/health` note.** `g1-2026-09-23e/unattributed-notes.json` says `/health` is "a periodic health poll from a timer armed before any action (correctly unowned)". That is wrong.
   - The timer is armed in `useHealthCheck`'s effect (`client/src/data-provider/connection.ts:12–42`, called from `Root.tsx:48` as `useHealthCheck(isAuthenticated)`) when `isAuthenticated` flips after login.
   - It is therefore a recall abstention downstream of login, like the rest of the post-login batch. It is not a correctly unowned pre-armed timer.
   - Corrected notes: `g1-2026-09-23f/unattributed-notes.json`.
2. **Await rewrite.** `g1-2026-09-23e/LIMITS.md` does not state that the await rewrite changes microtask interleaving relative to native `await`. In the grader's probe the order is `baca2d` instrumented vs `aba2cd` native. See `g1-2026-09-23f/LIMITS.md` and the D-G1-12 amendment in `docs/gates/G1-frontend-only.md`.
3. **Receipts on React 19.** `g1-2026-09-23e/LIMITS.md` does not state that receipts and render detection were silently inert on React 19: the dispatcher is at `ReactSharedInternals.H`, not `.current`. This is fixed in the sixth pass (D-G1-17).
4. **`lookupOwn`.** `g1-2026-09-23e/RUN.md` says "0 real functions missing". That is true by the round-four rule. One shipped real function, `artifacts.ts:310` `lookupOwn`, was absent from the manifest; it was also absent from final7. Its cause was a separate boundary-rule case (an initializer arrow mapped from its binding name), fixed in the sixth pass.
5. **Leaked frames.** `g1-2026-09-23e/RUN.md` names only round four's leaked frame `75466`. The grader found 4 other leaked frames in round four, including `…:319:function:313865` with 22,339 children. Their credits went to the right action, so they caused no misattribution in the lists, but they were the same mechanism.
