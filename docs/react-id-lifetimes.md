# useId consumers and lifetimes

The React 18.3.1 allocation rule already preserves an ID within a mounted hook and distinguishes a remount from an update. The compiler now follows immutable aliases within that same render into native ID and accessibility properties. Each use retains its hook-read receipt; commit evidence requires the original props object and the exact committed component owner. Matching strings alone cannot establish that relationship.

The extended browser acceptance case runs the installed development and production builds, both with client mounting and hydration. It checks label/input relationships, `aria-describedby`, sibling and root isolation, updates, keyed remounts, a suspended transition, synchronous Suspense hide/reveal, and recording shutdown. Deliberately changed source, property, value, owner and root receipts still fail.

Selective hydration can commit reused content more than once, so each host commit retains its own identity. An interrupted render contributes no host commitment. Production withholds render records until it can identify their owner; the test observes the attempted component separately and verifies that Tracer does not credit that attempt with a commit.

This completes the listed finite useId scopes. Composed ID strings, custom-component property forwarding and captures used by later callbacks remain source coverage frontiers. No ID string is treated as product entity identity, and observing committed props does not prove the precise DOM write that applied them.
