# Limits and frontiers (bulletproof-react r2, frontend-only)

Reached / stopped at / because. Counts are from `summary.json` and the independent `GRADE.md`.

1. **Frontend-only.** All 5 attributed requests stop at the network because the backend is the repository's uninstrumented mock API. No backend stop is inferred.
2. **Unattributed requests: 7.** 1 initial page load (`GET /api/auth/me`); 2 hover prefetches (`onMouseEnter` on the discussion "View" link; hover is not a runtime action); **4 real follow-ups that lost their action across an async boundary**: the Discussions route loader after its dynamic `import()`, and three react-query refetches after `createDiscussion`, `createComment` and `deleteComment` mutations succeed (invalidation → refetch). This is the known state-update/async continuation frontier being fixed on the G1/G3 branch; not worked around here.
3. **Library-owned controls.** Clicks on react-router `<Link>`/`<NavLink>` (3) credit the route's `lazy` loader in `src/app/router.tsx` (graded `global-listener`): the link has no first-party click handler and the loader is the first first-party frame the navigation runs.
4. **Library-wrapped handlers.** 6 correct credits reach the developer's function through a library: react-hook-form `handleSubmit(onSubmit)` form callbacks and Radix `onOpenChange` callbacks. Graded `correct`; stricter "bound to the element" grading would reclassify them.
5. **pointerdown is not an action.** Radix `DropdownMenu` opens on `pointerdown`; the runtime listens to click/input/change/submit/keydown/focusin, so opening the user menu is not an action (the trailing click lands on `<html>`, no credit). The following Sign Out click is credited correctly.
6. **Form fields.** 321 keystroke/field rows have no credit: react-hook-form owns the field handlers (library), so abstention is correct.
7. **Static analysis is weak on this repo.** The analyzer reads the whole git repository (including the two Next.js apps) and parses `.ts` as TSX, producing 18 React and 84 backend `syntax_error` frontiers (generic arrows read as JSX); it found 2 controls in 385 files, so the source stamper stamps **0** elements on the landing page. Runtime attribution does not depend on it; G3 does.
8. **Fixture quirk (harness).** The mock API port variable is `VITE_APP_APP_MOCK_API_PORT` (see `RUN.md`).
