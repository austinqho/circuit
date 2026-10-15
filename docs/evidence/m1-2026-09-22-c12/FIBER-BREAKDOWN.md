# Cycle 12 fiber-handler breakdown

The authenticated `/c/new` fiber probe saw 573 host event props: 189 direct registry matches, 11 same-name ancestor matches, 44 compatible-event ancestor matches, and 329 unregistered host props. The pre-ancestor-any residual is therefore 373 (329 residual plus the 44 compatible-ancestor cases).

| origin classification | count | evidence |
| --- | ---: | --- |
| direct registered first-party handler | 189 | runtime WeakMap lookup |
| via_ancestor same event name | 11 | return-chain lookup |
| via_ancestor_any compatible category | 44 | pointer/keyboard/form compatibility fallback |
| unregistered residual | 329 | no registered same-name or compatible ancestor |
| first-party-but-unregistered by `fn.toString()` marker | not measured | the c12 production surface probe did not retain unregistered function objects |
| library-internal by `fn.toString()` marker | not measured | same measurement limitation; no invented split |

The neutral registration fixture passed 8/8 forms. The c12 live counts are unchanged before/after the fixture probe (direct 189, same-name 11, compatible 44, residual 329), so this run provides no evidence that a registration gap was fixed in the live bundle. `_debugSource` is not available on these production fibers; source/package attribution is consequently not asserted for the 329 residual rows.

This is a reported measurement stop, not a grade: the next harness revision must retain each unregistered function reference and classify its `fn.toString()` body against the runtime enter/exit marker before claiming library ownership.
