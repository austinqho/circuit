# Limits and frontiers (anything-llm, bridge off, stamps on)

Format: reached / stopped at / because.

1. **Database hop.** All 27 attributed requests reach the Express route and a registered-handler span, then stop at the handler because Prisma/SQLite has no Tracer adapter.
2. **In-session requests without an action: 22.**
   - These are follow-up GETs after three navigations; they were attributed in the bridge-on run. They come from React effects re-run by a state change the runtime holds no receipt for:
     - `setWorkspace` after `await Promise.all` in `pages/WorkspaceChat/index.jsx`;
     - the react-router location change after `navigate()`.
   - The chain stops at network with no action. None is inferred.
   - On bulletproof the same machinery attributes all 4 previously lost requests, so this is a repo-specific frontier. No package change.
3. **Page-load requests: 22** (11 per page). They have no action by design.
4. **Stale listener ownership (record level)** (see RUN.md "Findings"). 67 listener `function.enter` rows are attributed to the action that registered the listener, not the dispatch that fired them. Consequences:
   - the 9 step-7 keydown rows report "no first-party function entered" instead of an `entry_handler` abstention;
   - one global listener (`useModalEscape`) is missing from the step-2 abstentions' `global_listeners`.
5. **CTAButton no-op credit.** The step-7 "Update Workspace" click is credited to `CTAButton`'s own `() => onClick?.()`. It is the element's own prop, so `correct`, but it does nothing because no `onClick` is passed. The write comes from the separate `submit` action.
6. **No LLM flows.** No provider key is set.
7. **Build cost.** Enabled build 161 s vs 11 s disabled (stamps add placement registration). The first, invalid attempt took 197 s.
8. **Shared fixture checkout.** Another agent switches branches in `/Users/austinho/dev/fixtures/anything-llm`. Runs are now pinned with `--expect-commit`, and the harness checks the commit did not change, but a switch-and-return in the middle of a run would not be detected.
9. **Marker gate not re-runnable.** The builds are not kept, so the gate cannot be recomputed from disk.
