# Cycle 9 fiber-driven pattern results

The neutral registration fixture enumerated eight registered forms (declaration,
expression, concise and block arrows, object method/property, class method and
class property). The live `/c/new` fiber walk was not available in the c9
headless harness, so the final test stopped before dispatching controls. This is
an explicit stop, not a claim that the units were exercised.

| outcome | count |
|---|---:|
| reached_db | 0 |
| reached_backend | 0 |
| reached_request | 0 |
| correct_stop | 0 |
| stop_with_reason | 1 |
| not_encountered | 1 |
| unreachable | 0 |
| units with no row | 0 |

Stop reason: live React fiber enumeration on `/c/new` was not measured, so no
registered handler/event drive units could be safely mapped to real elements.
The seeded surfaces and depth-2 reveal crawl therefore were not started. The
registration proof and all ten scripted-session raw records remain available in
this directory.
