# Selected useMemo calculators

The React 18.3.1 `memo_value` rule now connects a selected source calculator to its actual invocation, returned value, retained cache and clicked callback. This extends the existing React reader; it does not introduce another rule language or an automatic verifier.

The compiler keeps every resolvable immutable calculator alternative. It tags the original function at its definition, where its captures belong. At the hook call, the recorder selects that exact function object and retains its independently observed source receipt. The reader requires that receipt before accepting the invocation or any value derived from it.

React can return an older cached callback even when the currently supplied calculator is different. Tracer follows the recorded value production and commit, rather than choosing a branch using the new render's props. If the selected calculator has no source receipt, Tracer reports the gap and cannot borrow an older production merely because the returned object is identical.

`test/acceptance/react-dynamic-memo-runtime.mjs` runs the installed development and production builds, with and without StrictMode. Each case checks six callback clicks across selected calculators, unchanged dependencies, changed dependencies, sibling components and a keyed remount. It compares actual callback outputs with an uninstrumented page and checks behavior after recording stops. Missing and corrupted source receipts must fail; a rejected receipt must not poison a later valid invocation.

The existing memo rule tests independently reject wrong cache and calculation policies. The new browser tests exercise consumption of those rules. Unknown or mutable calculator sources, asynchronous/generator calculators, and unresolvable return shapes remain explicit source frontiers. Passing these finite tests is not a claim about every possible JavaScript calculator.
