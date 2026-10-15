# Limits and frontiers (bulletproof-react, bridge off, stamps on)

Format: reached / stopped at / because.

1. **Frontend-only.** All 9 attributed requests stop at the network because the backend is the repository's uninstrumented mock API.
2. **Unattributed requests: 3.**
   - 1 is the initial page load (`GET /api/auth/me`).
   - 2 are hover prefetches: `onMouseEnter` on the discussion "View" link calls `queryClient.prefetchQuery`, and hover is not a runtime action.
   - The 4 async-loss requests from the bridge-on run are attributed now; see RUN.md.
3. **Route loaders.**
   - Two `<Link>` clicks abstain at `entry_handler`: Register (`router.tsx:32`) and View (`router.tsx:56`). No element-bound handler ran, and the loader ran as a global.
   - The Discussions `<NavLink>` click is still **credited to its route loader** (`router.tsx:49`), because that loader owns a request (`GET /api/discussions`). The runtime credits a request-owning frame whatever bound it. Under the amended categories this is `unrooted_global/route_loader`: a known credit defect that the abstention rule does not yet cover when the loader issues a request.
4. **pointerdown is not an action.** Radix `DropdownMenu` opens on `pointerdown`, so the trailing click lands on `<html>` with no credit.
5. **Form fields.** react-hook-form owns the field handlers (library code), so keystroke and field rows have no credit. This is correct abstention.
6. **Rows carrying an earlier action's id.** 9 event-invoked `function.enter` rows fire after a later dispatch began but carry an earlier action's id. The grader found all 9 are legitimate request continuations. This differs from anything-llm's stale window-listener ownership.
7. **Build cost.** Enabled build 54 s vs 2.4 s disabled. A trial build of the same configuration took 153 s, so timing varies with machine load.
8. **The 3 sourcemap warnings** from the hidden-map build are the same as in the bridge-on run (see `../g2-bulletproof-react-2026-09-23-r2/ERRATA.md`).
9. **Marker gate not re-runnable.** The build output is not kept (`--keep-builds` not used), so the gate cannot be recomputed from disk. `observed-requests.json` now records the Playwright request list.
