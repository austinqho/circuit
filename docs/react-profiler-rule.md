# Profiler: callback to committed subtree

The React 18.3.1 rule describes `onRender` as a layout-commit callback. Tracer
uses the original callback's body observations and the committed Profiler input
to check that relationship. Constructing a Profiler element alone does not prove
that its callback executed.

```text
original JSX props and callback source
    → original callback body, arguments, return or throw
    → fresh committed Profiler fiber
    → interpret the versioned callback rule
    → unique matching invocation, or an explicit frontier
```

The rule's argument list is executable data:

```json
{
  "callback": "onRender",
  "phase": "layout_commit",
  "arguments": [
    "id", "phase", "actualDuration", "treeBaseDuration",
    "actualStartTime", "commitTime"
  ],
  "mount_phase": "mount",
  "update_phase": "update",
  "nested_phase": "nested-update",
  "result": "ignore"
}
```

`interpretReactProfilerCommit` reads this list to construct the expected
arguments. The runtime also requires the pinned renderer's profiling mode,
update flag and profiling state. It rejects old fibers retained by a bailout;
an old update flag does not prove another invocation. Ordinary production does
not execute this callback. Development and the separate production profiling
distribution do; all three browser distributions are source-attested.

Tracer instruments the original function body. The function passed in JSX
keeps its name, arity, receiver, lexical values, return value and thrown error.
It does not substitute another callback object in the Profiler's props.
Nested Profilers keep separate input, callback and committed-owner identities.

If application code also calls the same function, multiple candidate calls
make that function identity ambiguous. Tracer keeps it ambiguous for the rest
of the recording context. It does not discard the extra call and then pretend
the remaining call was caused by React. A thrown callback keeps its body/error
evidence; error recovery that removes the boundary cannot produce a successful
Profiler-commit proof.

The integration claim is `unique_observed_callback_matches_profiler_commit`.
It retains the actual six arguments and owner identity. It does not claim that
the callback's return value changed the product, that its downstream effects
succeeded, or that a `nested-update` phase explains which update caused it.

The browser acceptance compares instrumented behavior with an uninstrumented
baseline, exercises nested updates and errors, and rejects deliberately wrong
argument orders, callback names, phases, return policies and renderer guards.
Receipt tests separately reject missing or foreign callback and boundary
evidence. The Node runtime can record an original callback's manual invocation
but cannot manufacture a browser commit during server rendering.

Supported callback source forms are inline synchronous function expressions
and arrows with simple parameters. Defaults, destructuring, explicit rest
parameters, async/generator bodies, direct eval and unsafe binding changes
retain a source frontier. These limitations are separate from the Profiler
rule's renderer behavior. Experimental `onCommit` and `onPostCommit` props are
not represented as public `onRender` behavior.
