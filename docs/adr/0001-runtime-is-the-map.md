# 1. Runtime is the map

Status: accepted.

Enumerating every possible path through an app ahead of time (static maps, library dictionaries, crawlers) never gets close to complete on a real app, and what it can't prove it tends to guess. Attributing the executions that actually ran is both tractable and exact.

Decision: producttrace explains what ran, not what could run. Static analysis is only used to name things (functions, controls) that the runtime then observes.

Consequence: don't build a crawler or path enumerator. Coverage is reported as what was observed, never as a percentage of a predicted universe.
