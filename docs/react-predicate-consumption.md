# isValidElement result consumption

The React 18.3.1 predicate rule describes the installed implementation's null, type, and `$$typeof` checks. Tracer now connects the actual returned boolean to the direct `if` or immutable local alias that consumed it. Each synchronous containing-function invocation gets a distinct frame, so two calls returning the same primitive boolean cannot exchange provenance.

The browser acceptance case runs the installed development and production builds. It checks real elements, strings, getters, portals, inherited markers and arrays; direct and negated aliases; opaque exceptions; failed argument evaluation; and recorder shutdown. The reader independently rejects swapped call frames, call scopes, values, source conditions, and action occurrences. Removing the original API call receipts leaves every consumption unresolved.

The claim ends at source-path selection. A consumed `true` or `false` does not itself prove that the selected function completed. Mutable or cross-function aliases, asynchronous containing bodies, dynamic property consumers, and unsupported argument evaluation keep explicit frontiers.
