# 1. Runtime is the map

Date: 2026-09-21. Status: accepted.

From July to September we tried to enumerate every possible path through an app ahead of time (static maps, a library dictionary, a crawler). It plateaued at under 10% verified paths on LibreChat, twice. Attributing the executions we actually observe got all 8 graded LibreChat flows right with zero false joins.

Decision: producttrace explains what ran, not what could run. Static analysis is only used to name things (functions, controls) the runtime then observes.

Consequence: don't build another crawler or path enumerator. Coverage is reported as what was observed, never as a percentage of a predicted universe.
