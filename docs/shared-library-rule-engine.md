# Shared library rule engine

This branch starts from main at `294e7bb3`. It reuses the lessons and evidence
from PRs 7 and 8 without treating their test-only contracts as tracing support.
Nothing on this branch is approved for merging.

The acceptance path is:

```
frozen unfamiliar installed implementation (no bank answers)
  → structured program in a fixed vocabulary
  → strict format validation
  → independently chosen real-library experiments
  → automatic counterexample repair
  → version-attested entry consumed by the same tracing interpreter
     or an explicit, evidence-backed frontier
```

The first engineering gate freezes the interpreter before adding held-out
programs. A new supported function must require program data and source/version
attestation, not another function-specific transformer or evidence reader.
Tests control the stimuli, result projection, callback identities and expected
failure cases. The proposing model controls none of those assertions.

## Meaning of a program

A program is a bounded description of values and calls across a library
boundary. Its primitives include argument/property access, identity comparison,
branches, local bindings, closure creation, callback invocation and scheduling.
The interpreter must never execute generated JavaScript or silently skip an
unsupported operation. Model execution is separate from application execution:
the real application callback must run exactly once, and replay must use its
recorded result, not run it a second time.

One skeleton can serve several exact versions. Every admitted version retains
its own installed-source hashes and behavior/integration results. An override
changes named program data, followed by revalidation; semver similarity alone
does not grant support. Unknown versions and unavailable owner/lifecycle facts
remain frontiers. Finite experiments establish agreement on tested cases,
not correctness for every input or schedule.

React render ownership, commit, cleanup and scheduling still require observable
host facts. The shared language must not guess those facts from a callback name
or infer execution from a static graph. Pure helpers and lifecycle operations
will have different explicit host requirements, even when they share primitives.

## Work and spending controls

- Fix and test locally before paid proposals. Stop a failed paid batch, diagnose
  and pass regressions before targeted retries. Do not repeat broad sweeps.
- Reuse the cumulative ledger at
  `/Users/austinho/dev/tracer-pr2-library-eval/evaluation/overnight-spend-ledger.json`.
  Starting measured spend is $3.01206575, with $0.041612 retained for an uncertain
  charge, against the existing $20 cap. Do not create a fresh budget.
- No merges or recovery schedules. At most one usage reset is authorized, only
  after available usage is exhausted. No reset has been used for this goal.
- Report measured denominators; 90% library coverage is a hypothesis, not an
  acceptance number that can be inferred from a few successful functions.

## Reuse experiments

Exa's anonymous MCP search was used to inspect the upstream
[Jelly repository](https://github.com/cs-au-dk/jelly). Jelly 0.13.0 is already
installed locally. A bounded three-function callback-wrapper fixture completed
in 11 ms of analysis, finding all three static call edges without errors.
This is useful ordinary-JavaScript candidate discovery, not runtime evidence.
The earlier LibreChat graph excluded dependencies and consequently had no edge
through `fetchNextPage`; that result cannot establish that Jelly understands
TanStack. Further experiments will compare a dependency-included slice.

## First frozen evaluation and reusable catalog

The initial frozen set contains 14 function/version cases across React 18.3.1
and 19.1.1, TanStack table-core 8.11.7 and 8.21.3, async 2.6.4 and 3.2.6,
once 1.4.0, and queue-microtask 1.2.3. All 14 have a model-produced program
that passes strict format, actual-library observations, and source integration.
They form eight function skeletons in
`authoring/banks/initial-library-programs.json`. Exact versions have independent
source digests and replacement-only overrides. A catalog entry must be checked
again in the destination installation; a saved success flag grants no authority.

This is a measured boundary result. React memo/forwardRef entries describe
construction and stored function identities, not subsequent renders or bailouts.
Reference-only integration preserves those original identities and emits a
`callback_reference` edge. An invocation requires separate observed evidence.
The Node invocation probe wraps functions and is not a universal transparent
observer for arbitrary identity-sensitive code. Browser ownership, committed
hook state, effects and unmounting still need integration with the existing
React host before this engine can replace the broader React implementation.

The model did not see calibration programs or test code. Initial failures and
local repairs are retained, including an extra wrapper, an incorrect abstention,
malformed JSON, and a network interruption. Therefore this is not a claim that
the original 14-case run completed without engineering intervention. Recursive
structured output replaced JSON inside strings after repeated syntax failures;
the interpreter's accepted operations did not change for those successful rules.

The local gate now checks source fingerprints and all regression exits before
paid requests. It was added after one targeted network retry mistakenly ran
while a package-file-list assertion was failing; that event is retained in
`network-failure-diagnosis.json`. The failed network request's full reservation
remains in the cumulative spend ledger. No charges were removed.

Jelly was also tested with actual dependency code: 35 modules, five packages,
1,059 functions, 290 ms, and 180 warnings. It found callback candidates through
async.apply and TanStack functionalUpdate, but not the final callback edge
through once. `jelly-results.json` records this experiment. Its graph helps
locate candidate code; it does not admit a rule or prove runtime execution.

To reproduce without model spending:

```
npm ci
npm ci --prefix evaluation/shared-rules/fixtures
npm ci --prefix evaluation/shared-rules/react-runtime/18.2
npm ci --prefix evaluation/shared-rules/react-runtime/18
npm ci --prefix evaluation/shared-rules/react-runtime/19
node evaluation/shared-rules/local-gate.mjs
node evaluation/shared-rules/build-catalog.mjs
NODE_ENV=production node evaluation/shared-rules/react-production-catalog.mjs --write-catalog
```

`frozen.json` preserves the original experiment. `engine-revisions.json` records
changes made after failures. Paid reports preserve original proposals and costs;
new check results do not overwrite the old reports.

## Mounted callback references and build variants

The shared interpreter now also accepts a host-backed reference protocol. The
host supplies an opaque mounted slot and the actual API result. The program
remembers a supplied callback and resolves the returned reference in that same
slot. It cannot invoke application callbacks or fabricate an evidence token.
`react-owned-programs.json` uses one program for `useCallback` in React 18.3.1
and 19.1.1, with pinned React DOM and scheduler dependencies. Real React DOM tests
exercise independent instances, unchanged/changed dependencies, suspended work,
StrictMode and remounting. Wrong callback selection and missing ownership reject.
The TypeScript adapter consumes these admitted entries. This establishes returned
callback origin, not a render commit or a later callback invocation.

The owner host uses one private `useRef` marker per instrumented call. It must be
attached consistently at build time; enabling it halfway through a mounted tree
would change the hook layout. The exact host versions are tested rather than
assuming React internals or different renderers have equivalent ownership.

Eight production variants of the four initial React helper APIs are separately
source-pinned and behavior/integration checked. Six reuse their saved program;
the two `createRef` variants have manually reviewed overrides because production
does not seal the fresh object. These overrides are not blind model results.
Unknown build or peer-dependency source combinations still reject. Rebuilding
the initial development catalog replaces it; run the production command above
to rebuild its production variants as the next explicit step.

The source reader now records native bound scheduler identity and recognizes
only a whole-file, side-effect-free NODE_ENV require selector. Arbitrary dynamic
conditions, shadowed selectors, lazy imports and cached environment changes
remain frontiers. This repaired missing evidence in the original queue-microtask
source report; the original report is preserved and its saved rule was rechecked.

The separately frozen memoize-one extension motivated bounded array iteration,
indexed reads and strict equality. Its local real-library and deliberately wrong
rule tests pass. Its model proposal is still pending: the paid ledger's 9AM
cutoff blocked the attempt before any reservation or provider call. Cumulative
accounted spending remains $3.43854825, including uncertain prior charges. A
deadline failure is now reported as a spending gate, not as a model failure.

These additions do not complete the all-55 React acceptance. Lifecycle, value,
commit, subscription and browser-host integration gaps remain; the 14 initial
model cases, eight production variants and two owned-reference version checks
must not be added together and described as 24 fully modeled React APIs.

## Nested APIs and observable errors

The import adapter now follows nested own-data exports, including
`Children.only` and named/default namespace aliases. Member preparation reads
the receiver and method once before evaluating arguments. Getter side effects,
argument scope, shadowing, optional chains and changed runtime functions have
independent regression checks. A default namespace candidate must still match
the exact admitted runtime function before it gains any evidence.

React 18 `startTransition` has a manually transcribed synchronous scope rule;
it reuses the existing callback instructions. Its actual return/throw behavior
and source callback integration pass, while three incorrect rules reject. Its
priority/commit effects remain outside this entry, and React 19 does not inherit
it: error and thenable handling differ and need host evidence.

React 18 and 19 `Children.only` now have source-pinned rules that either retain
the actual element identity or throw the standard error. This exposed a missing
shared operation, so the language gained explicit error creation and throwing.
Eight wrong rules reject across the two installed versions. Error comparison
remains identity-based by default. The checker must explicitly permit standard
errors without stacks; class, message and other own properties still have to
agree. Callback-thrown objects retain exact identity checking.

React 19 elements contain an unread debug-stack accessor. The independently
declared Children domain treats such fields as opaque getter/setter descriptor
identities. It never evaluates them; a proposed accessor read or a replaced
descriptor remains a frontier. Tests assert zero unrelated getter calls by
both the actual library and replay. Unknown proxy inputs/results are rejected
before graph inspection or replay can cause additional traps.

These two catalogs are manual source-derived additions, not new blind model
results. Their checks run in the local gate. The actual HTTP acceptance now
uses the saved model-produced TanStack catalog entry, re-admitted against the
installed source, rather than the local calibration program.

For the earlier frozen LibreChat `lodash.map` shape, Jelly analyzed 693
functions in 1,124 ms and found `arrayMap`, but produced 185 possible incoming
callback callers and 168 warnings. This cannot establish a narrow implementation
closure. The shared reader still reports `captured_parameter:context` and its
declaration limit after selecting 117 declarations (21,559 source bytes).
`jelly-lodash-map-results.json` retains the candidate set and setup failures.

An additional negative test caught a result-graph comparison bug before adding
stateful object rules: an already paired output identity bypassed later field
comparison. The comparator now checks fields on each observation even when the
object identity was paired previously. A library that increments a retained
object cannot pass a rule that merely keeps returning the unchanged object.
This is distinct from mutable-heap replay, which remains unsupported.

## Integration participates in admission and repair

`createLibraryProgramVerifier` composes independent behavior and source
integration gates before the live bank admits a program. The paid authoring
runner now uses it: an integration counterexample reaches the same bounded
repair loop as a behavior failure. Previously the runner checked integration
after authoring returned, so it could reject the batch but could not ask for a
repair at that stage. Original run reports are preserved with that limitation.

A local regression makes the first candidate pass the behavior probe and fail
the independent source integration, then verifies that repair precedes admission.
All 14 saved model-produced candidates also pass re-admission through the new
combined gate without a new model request. A missing/crashed/malformed checker
stops the authoring loop instead of spending on further proposals. Low-level
test boundaries and provisional probe banks are still test scaffolding; the
application bank must use both gates.

## Element data and nested callback paths

The source audit now resolves 27 of the 55 React public inventory rows to a
loaded export implementation, versus 24 before recognizing standard Reflect,
numeric globals and labels. Twenty retain source frontiers; eight are not
callable exports. A resolved React dispatcher wrapper is still only source
availability, not a complete hook implementation or admitted behavior.

The production `createElement` and `cloneElement` rules use shared operations
for own-key enumeration, computed data reads, writes to newly allocated
predicted objects, primitive string conversion, freezing and explicit scoped
frontiers. No React branch was added to the interpreter. The exact React
18.3.1 and 19.1.1 sources differ in ref props and clone default handling; one
skeleton per API plus version overrides captures those differences. The scope
checks type, key, ref, all props, nested callback identities, child precedence
and own-data defaults. It does not claim render ownership, commits, private
metadata or development builds.

`react-element-boundary.mjs` requires both independent behavior checks and
source integration before live admission. The integration renders two real
buttons with React DOM, dispatches eight DOM clicks across the four version/API
cases, and checks their distinct payloads. It also requires occurrence-specific
reference evidence, for example:

```
argument 1 → onClick → returned element.props.onClick
```

This is callback transport evidence. The separate real DOM assertion proves
which callback ran; the reference record itself does not claim invocation or
component ownership. Nested paths are a trusted boundary option, not permission
for the rule to inspect getters or run callbacks. Twenty deliberately incorrect
rules reject, including version swaps, dropped callbacks, wrong keys and wrong
children. Unsupported getter inputs preserve the actual library's number of
reads and produce a frontier. React 18 clone reads that getter twice; the
negative test now compares against the uninstrumented library instead of
incorrectly assuming one read.

Further local negative tests prevent prototype mutation from hiding behind
unchanged object identity. Array-copy instructions use own data descriptors,
not an input's `slice`, inherited getters or species constructors. Predicted
array length writes cannot run an application object's coercion hook.

To recheck these saved production rules without changing the catalog:

```
NODE_ENV=production node evaluation/shared-rules/react-element-boundary.mjs
```

These are manually transcribed additions, not blind model results. The shared
engine still needs lifecycle/state/commit host integration, broader source
resolution and the held-out automatic proposal run; none of these counts
establishes the requested all-55 or 90-percent acceptance.

Three additional production boundaries reuse existing instructions: React 18
and 19 `useDebugValue` are no-ops, and React 19's client `cache` wrapper calls its
callback each time with a null receiver. The latter is not the server cache
contract. Their separate source/build entries pass behavior and TypeScript
integration, with six deliberately wrong rules rejected. The cache integration
exposed a cross-realm issue: Proxy callback argument lists and replay's rest
parameter list can have different array prototypes. The checker now compares
those observer-created lists by argument slots, while retaining strict identity
checks for application values. A copied-but-equal application argument still
rejects.

Inputs with hidden native or private class state (for example Map, Set, Date
or a class instance) now require host evidence rather than passing based on
unchanged identity. Symbol-keyed ordinary state participates in mutation checks;
symbol-keyed callback reference paths need an explicit identity representation
and currently remain frontiers. This is a stricter input domain, not a claim to
have implemented native collection or class-state replay.

## One resolver for bank reuse and unfamiliar functions

`resolveLibraryProgram` now chooses a source-matching catalog entry for the
installed package/version, independently re-admits it, and makes it available
to the TypeScript adapter. It recognizes package aliases using the installed
manifest. Conflicting entries are rejected before either can populate the
live bank. With no supplied provider it cannot make a model request.

When a function, version or library is absent, a caller may supply a trusted
input domain, independent bank checker and spending-wrapped provider. The same
resolver then runs proposal, format, behavior, integration and bounded repair.
It never sends adjacent or stale bank answers to the model. The explicit
`unfamiliar_only` mode does not even inspect supplied catalogs and enforces the
frozen implementation digest when one is supplied. The targeted paid runner
uses this path; all requests share the existing cumulative spending ledger.

All 14 saved model-produced cases now pass through automatic catalog selection
and combined re-admission. Local provider-stub tests cover both a new function
in a known library and a completely absent library, including an integration
counterexample and automatic repair. They verify pipeline control, not a new
paid model's accuracy. The subsequent frozen memoize-one run is documented below.

The instruction shapes now come from one immutable syntax definition shared by
the format validator and model's recursive output schema. A consistency check
also compares interpreter handlers, public TypeScript types and authoring
instructions against that vocabulary. This prevents the proposer and reader
from silently drifting apart as operations are added. It does not replace
independent semantic tests or claim a finite number of possible programs.

A further negative integration test exposed an observer-selection flaw: the
adapter previously inferred reference-only observation when a candidate had no
call instructions. A wrong no-op could consequently disable callback probes.
Observation mode now comes exclusively from the independent domain and defaults
to invocation observation. The two identity-sensitive descriptor domains opt
into reference observation explicitly. Execution instructions in such a domain
reject at format checking, before any behavior probe runs. A no-op that passes
a quiet behavior input now fails an active integration input, reaches automatic
repair and admits only after the callback is modeled. Existing paid reports are
preserved; all saved candidates are rechecked under the corrected observer.


## Frozen memoization repair and observer hardening

The frozen `memoize-one@5.2.1` case now has a model-produced program that passes
format, real-library behavior and source integration. It is in
`authoring/banks/extension-library-programs.json`; rechecking the two catalogs
admits all 15 frozen cases without model calls. The extension did not replace
the original catalog or its separately tested production variants.

Two failed paid batches remain recorded. The model repeatedly confused
`Object.is` with strict equality when detecting NaN, then introduced a receiver
coercion error. Local diagnostic edits isolated those defects but were never
admitted or sent as answers. Synthetic test feedback now includes the proposed
program's actual comparison operands, results and instruction locations, and
selects distinct failures instead of duplicate occurrences of the first error.
With that feedback, the model repaired its original candidate in one request:
`paid-memoize-one-1789074246708.json`, $0.034775 and 11.81 seconds. This is an
automatic final repair, not a claim that the entire engineering campaign needed
no intervention. These observations establish tested-case agreement only.

The design of execution diagnostics was cross-checked through Exa against
[TraceFixer](https://arxiv.org/abs/2304.12743). Our feedback is computed by the
independent checker and interpreter; it includes no manually supplied correct
program or desired internal state. Diagnostics are opt-in for synthetic checks,
use opaque object identities, and are absent from ordinary application evidence.

A negative test also exposed a false-agreement risk: comparing two freshly
created functions by type alone could accept a wrong function passed into an
application callback, because replay reused that callback's observed result.
Those nested function bodies and returned-object methods now require a dedicated
observer. Root returned functions still have an invocation observer, and original
input callback references still retain their exact identities. Both correct and
incorrect unobservable nested bodies abstain until that protocol is implemented.

The earlier 09:00 cutoff was an inherited runner setting. Continued targeted
work under the user's standing authorization was recorded in the existing ledger;
its current cutoff is 2026-09-11 16:00 UTC. Cumulative accounted spending after
the admitted memoization repair is $3.74917325, including retained unknown costs,
against the original $20 cap. No reset, schedule, merge or broad paid sweep was
used. Original failed reports and the archived stop markers remain unchanged.

## Recursive traversal without a function-specific interpreter

`@tanstack/table-core@8.21.3` `flattenBy` was frozen as an unfamiliar case in
`frozen-extension-2.json`. Sparse-array tests exposed a missing distinction
between an absent slot and an explicitly stored `undefined`. The new `has_own`
operation checks presence without reading a getter; its positive, deliberately
wrong and inherited-property cases are tested independently. The traversal uses
existing closures, lexical cells, bounded iteration and private array writes.
The source and the [ECMAScript forEach algorithm](https://tc39.es/ecma262/2025/multipage/indexed-collections.html#sec-array.prototype.foreach)
were checked through Exa; the declared domain excludes inherited array entries,
accessors, mutation and cycles rather than claiming those are covered.

The first small-model attempt falsely claimed that array accumulation needed a
new operation. Local calibration proved otherwise and identified contradictory
author guidance about private helper closures. After correcting that generic
language documentation, a fresh targeted batch repaired two rejected programs
and admitted the third without intervention within the batch. Its errors were
callback ordering/count and a nullish property read. The final report is
`paid-table8new-flattenBy-1789074632662.json`: $0.02885325 over three attempts,
with no bank answer or grading program supplied. The earlier abstention cost
$0.005802 and remains recorded, rather than counted as a justified abstention.

The two catalogs now contain 16 model-produced function/version cases that
re-admit through behavior and source integration without model requests. Total
accounted external-model spending is $3.78382850. This extends executable rule
coverage; it does not complete React's renderer/lifecycle protocols or establish
whole-repository coverage.

## Context creation: object relationships and versioned observation scope

A creation-only `createContext` skeleton now covers the pinned React 18.3.1 and
19.1.1 development implementations. The program builds its predicted graph with
existing object, property-write and identity primitives. Version overrides encode
React 18's separate Provider object and React 19's Provider alias, plus their
Consumer marker difference. The installed implementations were read directly;
Exa also located the official [createContext reference](https://react.dev/reference/react/createContext).

The boundary's new checker-owned `resultIdentityPaths` projection observes opaque
object relationships independently of data projections. This makes cycles such
as `Consumer._context === context` useful without reading unrelated warning
getters or pretending to model renderer metadata. Evidence carries source call
occurrence, result path and an opaque identity ID; shared IDs describe aliases,
not later execution. Negative tests reject copied defaults, wrong context links,
aliased distinct objects, input substitution and proxy inspection.

Catalog versions and exact source variants may explicitly override observation
scope as well as program data. The composed verifier now requires an independently
configured scope and rejects any mismatch before running its behavior/integration
gates. A catalog cannot remove callback or identity observations and borrow a
passing report from the original scope. Source/version checks remain required.

`react-context-boundary.mjs` independently checks both renderer default slots,
exact Provider/Consumer links and unused function defaults. TypeScript-instrumented
creation is then used by the actual matching ReactDOM renderer: two contexts stay
separate, a provided value reaches its reader, an explicit undefined stays
undefined, and an outside Consumer retains the default. Eight renderer value
checks and six wrong-rule rejections pass across the two versions. These rules
were manually transcribed; no model request was made. They prove creation
relationships and renderer compatibility, not complete context update, ownership,
scheduling or lifecycle semantics.

## Persistent value cells in observed owner slots

`owned_call_boundary` adds a reusable host protocol for stateful value APIs. A
program creates one private closure for each attested owner slot, then receives
that slot's real API arguments on every invocation. The protocol reuses the
ordinary closure interpreter and boundary checker through a private bootstrap
factory. No alternate evaluator or React opcode was added, and the application
receives the original API result. Bootstrap calls are accounted separately from
real API calls. This protocol grants no application callback capabilities and
requires complete value-graph checking; partial projections reject at admission.

The first source-derived entry is `useRef` on React/ReactDOM 18.3.1 and 19.1.1.
The catalog pins the renderer dependency and retains the installed mount/update
helper bodies, including React 19's inlined update helper. A private marker hook
supplies the mounted slot; the transform must be installed consistently before
mounting. Named-import calls with ordinary data defaults are the tested scope.

Actual renderer tests cover separate instances, changed initial arguments,
function defaults that must not execute, NaN/undefined, StrictMode, suspended
updates and remounts. The rule retains the same cell per slot and initializes
`current` once. Four wrong rules reject across the two versions. An outside
assignment to `ref.current` is preserved for the application but produces an
explicit value-replay frontier: explaining first-party writes needs separate
heap evidence. Neither a successful hook call nor a suspended render is labeled
as a commit. These are manually transcribed rules, with no new model spending.

The complete local gate now passes 221 regression tests and 13 acceptance checks.
The shared integration remains Node-hosted; browser installation, lifecycle
observations and the remaining React surface are still separate required work.

## Maintained upstream summaries: useful input, different semantics

An Exa-guided audit of React Compiler's `HIR/Globals.ts` at commit
`00f48cecfc34b371a03f3c601819439cb16e2e96` found 15 React API signatures. The
retained audit is `upstream-react-compiler-audit.json`. These provide maintained
static mutation/alias vocabulary and may help identify candidate behaviors.
They are not runtime contracts: compiler `Freeze` and frozen value kinds are
analysis abstractions, not observations that React called `Object.freeze`.
They do not supply owner/commit evidence or the version-specific scheduling
behavior required here. No bank entry was admitted from this audit.

## Independently checked React 18.2 compatibility

The existing creation-context, mounted ref-cell and returned-callback-origin
programs now re-admit against React/ReactDOM 18.2.0 and scheduler 0.23.0. No
program override was necessary for these three 18.2 scopes. Their exact source
and renderer bytes remain separate catalog rows; this does not authorize any
other 18.x patch automatically. React 18.2 uses its matching test-utils `act`
because the public `React.act` export was added later.

Across 18.2.0, 18.3.1 and 19.1.1, context tests now include twelve renderer value
checks and nine wrong-rule rejections. Ref-cell tests reject six wrong rules and
retain three unexplained-write frontiers, as well as checking StrictMode,
suspension, separate owners and remounts. Callback-origin tests use the canonical
scope/behavior/integration verifier before writing a new catalog row; the actual
DOM button invocation and source evidence both pass. No model request was used.
The full local gate passes 221 regressions and fourteen acceptance checks.

## Callbacks supplied to returned functions

The boundary now accepts checker-owned `returnedCallbackArguments`. These are
capabilities for later invocations, separate from the producer's input callbacks.
A private host method grants their shadow probes to the existing interpreter;
there is no new rule opcode or library-specific transformer. Probe identity is
keyed to the actual callback, so a cached older callback cannot be mistaken for
a new callback merely because both arrived in argument position zero.

Synchronous callback ancestry is retained in evidence. If an observed application
callback invokes another observed callback, replay consumes the parent's recorded
outcome and its observed descendants without running application code twice.
A separate call made by the library is still independently required. Delayed
children after their parent returns remain an explicit observer frontier, and
unobserved library-created function bodies remain unsupported. This observer
is scoped instrumentation and may change function identity through proxies; it
is not a universal transparent membrane for identity-sensitive APIs.

The existing model-produced `async.apply` rules for 2.6.4 and 3.2.6 pass expanded
independent tests and source integration without program changes. Positions zero
through three receive later callbacks, including repeated callbacks, identity
changes, exact results and throws. Wrong callback identities, missing capabilities,
extra library calls and delayed descendants have regression coverage. The scope
extension is recorded in `frozen-extension-3.json`; paid testing now requires a
frozen scope match as well as exact implementation bytes.

A fresh bank-blind gpt-5.4-mini proposal for async 3.2.6 passed format, the expanded
real-library checks and source integration on its first attempt in 5.22 seconds,
costing $0.00488625 (`paid-async3-apply-1789076437778.json`). No bank answer or
calibration program was provided. Existing catalog programs were re-admitted
under the expanded scope; unrelated source variants were preserved. Cumulative
accounted model spend is $3.78871475. The full gate passes 226 regressions and
fourteen acceptance checks. No merge or usage reset was performed.

## Production memo values and observable cache generations

`owned_call_boundary` now grants only its independently declared callback
positions and preserves function-valued API results without replacing them with
another proxy. Callback invocation evidence is carried into the owned report;
`boundary_occurrence` joins the returned/thrown value to that exact callback
execution, with owner and generation identities retained separately.

A manually transcribed `useMemo` program now passes on the production React DOM
18.2.0, 18.3.1 and 19.1.1 builds. It uses the existing vocabulary for retained
cells, callback invocation and dependency comparison. The exact production
helper compares overlapping dependency prefixes; the program does not silently
invent a length-equality guard. Each catalog version retains the actual mount
and update dispatcher bodies, including their minified forms.

An owner-only control fails after a suspended update is discarded: the real
renderer restores its committed memo, while naive replay retains the abandoned
value. The generic owned protocol therefore accepts an additional host cache
generation identity. `createReactMemoOwnerHost` supplies it through an adjacent
private `useMemo` with the same dependencies, alongside the existing private
owner marker. In these pinned renderers the private and observed memo hooks
retain/discard their caches together. This adds instrumentation hooks and must
be installed consistently before mounting. It is not a commit event or a claim
about untested renderers/builds. Catalog scope explicitly requires the generation
host; the source adapter rejects a missing one.

The same program now passes five independently exercised renderer scenarios per
version: ordinary rendering, production StrictMode, suspended-update rollback,
initial suspension/retry, and render-phase rerendering. Tests cover separate
instances, dependency changes, NaN/signed zero, nullish dependencies, original
function results and remounts. Nine wrong rules reject across the three versions;
three owner-only control experiments retain their expected rollback failures.
The TypeScript integration emits twelve callback events per version and joins
each to the exact returned value occurrence. Development double invocation and
other React APIs are not covered by this production memo scope.

This addition made no model requests. The complete local gate now passes 228
regressions and fifteen acceptance checks; cumulative accounted model spending
remains $3.78871475. Nothing was merged and no usage reset was used.

## Async application callback ancestry

The observer now retains parentage through Node AsyncLocalStorage continuations.
An application callback's later descendants are accounted only after the shared
program has verified the ancestor invocation. They are observed application
execution, not predictions that the library scheduled those calls. A later call
scheduled by the library outside that callback has no such parent and must still
be described by the rule. A rule that tries to replay an already accounted
application descendant as an extra scheduled call rejects.

Independent tests cover interleaved async completions in real async 2.6.4 and
3.2.6, exact completion values, missing/extra calls and source-integration
parentage. The existing bank programs again pass unchanged. An external trigger
with no occurrence context preserves the actual callback result and explicitly
abstains; this also repairs an undefined-parent access in that previously
unsupported path. `frozen-extension-4.json` retains the expanded independent
scope. No new model request was needed. All 231 regressions and fifteen acceptance
checks pass, with cumulative accounted spend unchanged at $3.78871475.

## Exact compiler forwarding exports

The authoring reader can now resolve pure compiler-generated export getters
without invoking those getters. It checks the installed source and lexical
binding through Node/V8 inspection; effectful getters, proxies, globals and
cycles remain rejected. Descriptor or live-binding changes invalidate the
attestation. This is a Node authoring capability, not browser runtime code.

The frozen TanStack Query 5.90.16 `shouldThrowError` case previously stopped at
`export_requires_own_data_property`. It now resolves four forwarding getters
and reaches the exact implementation. Independent checks cover boolean coercion,
callback argument spreading, result identity and original exceptions; deliberately
incorrect rules reject. Source integration imports the actual installed package
namespace, so a synthetic export object cannot hide an import failure.

A bank-blind gpt-5.4-mini proposal passed on its first attempt in 6.37 seconds,
costing $0.00573075. The resulting catalog entry passes format, actual-library
behavior and Tracer integration. The cumulative accounted total is $3.79444550.
This is a separately installed Query version, not the older LibreChat version.
All 234 regressions passed before spending. No merge or reset was performed.

## Executed data reads and React context

The shared interpreter can report executed `get` and `lookup` instructions to a
trusted observer. This adds no rule opcode and gives the proposer no new host
capability. With checker-owned `dataReadEvidence`, the boundary records the exact
input-object paths and instruction location without storing application values.
Aliases are retained. Equal primitives do not establish a unique causal origin,
and failed replay keeps these rows marked as frontiers. Deferred reads without
a snapshot at their execution time remain unsupported.

A manually transcribed `useContext` rule now uses the existing owned-call
protocol and reads the primary renderer's current context value. One skeleton
passes on React 18.2.0, 18.3.1 and 19.1.1; each version has separate exact-source
development and production variants. Unaccessed development warning descriptors
remain opaque. The rule is connected through the TypeScript import adapter to
the actual renderer. Each read joins an observed returned value and component
slot; no API-specific code was added to that adapter.

Independent scenarios cover nested providers, separate contexts and consumers,
explicit undefined, function-valued context without invocation, NaN/signed zero,
updates through memoized consumers, StrictMode, and suspended render attempts.
An abandoned read is retained as a read rather than mislabeled as committed
state. Eighteen deliberately wrong rules reject across the six version/build
combinations. Provider source identity and scheduling/commit causality still
require separate evidence; this rule does not claim them. No model request was
used for this addition.

During this work a returned-call replay bug was reproduced: a pass-through
application function could run twice before a mismatch was rejected. Returned
replay now uses the same private capability check as a call instruction. Both
constant-result and changing-result regressions prove one actual invocation and
an explicit ungranted-call frontier. All 239 regressions and seventeen acceptance
checks pass. Cumulative paid spending remains $3.79444550.

## Direct methods on returned objects

Checker-owned `resultMethods` now selects own methods on a returned object for
observation. The source adapter resolves the original receiver and method before
evaluating arguments and then invokes the real method once. The boundary replays
the corresponding program closure through the same capability checks. It never
replaces the result object or method, including when the result is frozen. A
bank-scoped registry follows the object across instrumented source files.

Method evidence retains the factory occurrence, method path and invocation
source. Replacement methods and ambiguous factory ownership become frontiers;
the application still receives its real result. Extracted functions, inherited
methods, optional/spread member calls and uninstrumented consumers are outside
this first method scope. No React- or TanStack-specific dispatch was added to
the interpreter or source adapter.

`createColumnHelper` from TanStack Table 8.11.7 and 8.21.3 now passes as a frozen
bank-blind case. Independent checks exercise accessor/display/group, nullish
column definitions, fresh copies, conflicting fields, retained function identity,
separate factory results and no accessor execution. Wrong bodies reject. The
actual installed-package integration follows all three method calls.

The newer version required three automatic proposals: nullish-copy handling and
an extra factory wrapper failed before the third rule passed. The older version
first falsely abstained about missing object-copy operations. Paid work stopped;
local diagnosis found existing operations sufficient and corrected contradictory
mutation wording plus omitted method capabilities in the authoring context. After
247 regressions and seventeen acceptance checks passed, a targeted fresh proposal
passed on its first attempt. The original failure and diagnosis remain recorded.
No checker was loosened and neither accepted rule was edited by a developer.
Cumulative accounted model spending is $3.83693720, including retained unknown
charges. No merge, schedule or usage reset was performed.

## Children counting and callback traversal

`Children.count` and `Children.forEach` now use two shared programs on React
18.2.0, 18.3.1 and 19.1.1, with independently checked development and production
source variants. The existing recursion, private arrays, property reads and
callback instructions were sufficient; no interpreter or source-adapter edit
was needed. React 19's bigint handling is a version override, and swapping the
18/19 rules fails the independent checks.

The tests cover nested arrays and holes, top-level versus nested empty nodes,
exact callback indices/receivers/throws, ignored callback results, repeated
elements and fragments as leaves, and portal data. Key reads still matter even
when the output only counts children: the programs validate those reads and
primitive coercions so a getter or custom coercion cannot disappear behind a
matching count. Unsupported iterators, getters and key coercion become frontiers
without replaying their effects. Thirty-six wrong-rule checks reject across the
twelve API/version/build combinations. Full owner Fiber graphs, lazy/thenable
children and iterator protocols are explicitly outside this scope.

Both functions pass the actual installed namespace import integration. All 247
regressions and nineteen acceptance checks pass. This manual addition used no
model requests; cumulative accounted spending remains $3.83693720.

## Model-driven language and observer corrections

Frozen `Children.forEach` proposals exposed two useful missing operations:
primitive-only `number_add` and the actual `is_array` brand check. Numeric
addition preserves Number behavior for signed zero, NaN and infinities without
coercing application objects. Array checks distinguish real arrays, including
cross-realm arrays, from length-shaped objects without reading their getters;
a revoked proxy remains a frontier. Independent negative rules still reject.

Format repair now identifies an unbound variable's lexical location and the
available bindings. These bounded diagnostics contain proposed-program text,
not a grading answer. Synthetic behavior diagnostics can identify the failed
input kind and actual effect count. Neither changes the acceptance predicate.

A separate observer defect was reproduced: `(a, b) => a === b` returned true
without tracing but false when the same function occupied a callback slot and
an ordinary argument slot. The observer previously reported agreement on that
altered execution. Known input aliases now bypass callback replacement, preserve
the actual result or throw, and emit
`callback_alias_requires_identity_preserving_observer`. Tests cover repeated
slots, nested data, receivers and later returned-function calls without reading
unrelated getters. The production `useDebugValue` test retains its alias case
as a required frontier, alongside a distinct-function positive case.

This protects known input aliases; it does not claim that callback proxies are
transparent to every identity comparison against hidden library state or
intrinsic function graphs. Such protocols still need identity-preserving source
observation. All 256 regression tests and nineteen acceptance checks passed
after these changes. The unfamiliar React proposal remains subject to its own
separate admission result; a passing manual calibration is not model success.

## Bank-blind React traversal admission

React 19.1.1 `Children.forEach` now has an admitted model-generated program.
The exact installed source and independent input scope were frozen before paid
requests; the manual traversal program and catalogs were not proposal context.
Extension 8 clarifies that the already-existing cases include function children
and removes expected-output hints from the domain description. Extension 7 and
all failed reports remain intact.

This was not a first-attempt success: sixteen requests across six targeted
batches cost $0.53029115. Each failed batch stopped spending for local diagnosis.
The cheaper model produced wrong branches and unbound variables; the stronger
model exposed missing array recognition and hidden-effect diagnostics. After
local fixes and regression checks, the final three-attempt repair batch rejected
an oversized program and an unexplained coercion case before admitting the
unaltered third proposal. No developer edited that admitted program.

Admission requires ordinary traversal agreement, rejection of unsupported getter,
coercion and iterator inputs, and the actual installed namespace import passing
through the shared Tracer adapter. Catalog construction independently rechecks
the saved proposal. There are now twenty saved model-derived function/version
cases, with six in the extension catalog. This does not mean all React APIs or
all inputs are covered. Cumulative accounted spending is $4.36722835, including
retained unknown charges; no usage reset or merge was performed.

## Composing independently admitted library rules

Ordinary Node library boundaries now share an installation-scoped execution
context. A real callback carries its observed parent into another instrumented
library call, including across application modules and async continuations.
Replay creates no execution events. Callback evidence points to an exact event
ID; request instrumentation can capture that current ID without reading values.
The execution graph is separate from rule agreement: a rejected rule cannot
erase a real call or acquire an agreement claim from observed ancestry.

A new acceptance path uses the saved model proposals for React 19.1.1
`Children.forEach` and TanStack Table 8.21.3 `functionalUpdate`. Across two
application modules, two React callback occurrences each enter TanStack and
initiate one real HTTP request. Seven execution events retain both complete
observed library/callback chains; exactly two requests reach the test server.
The application-module import remains an explicit static frontier rather than
being mislabeled a library contract. This is Node execution evidence, not a
browser-button, Express, OTel or database claim.

Tests cover interleaved async parents, thrown values, independent installation
contexts, bounded observation overflow, rejected rules, alias bypasses and
identical source text in different files. Source-site hashing now includes the
file identity. Returning a Promise is reported only as a return, not successful
resolution. Owner-backed React protocols and browser instrumentation still need
their own connection to this context; the new graph does not imply those links.
All 262 regression tests and twenty acceptance checks pass. No additional model
spending was used for this integration step.

## Fresh function after stabilizing the checker

React 18.3.1 `Children.count` was then frozen as a new function/version case on
the existing traversal domain. The model saw installed source and the rule
language, with no catalog answer. One automatic three-attempt run rejected an
unexplained hidden-effect domain and an incorrect child-type branch, then
admitted the third proposal. There were no developer edits or interpreter
changes between those attempts. Behavior, namespace/source integration and
saved-catalog re-admission all pass. The run cost $0.155962; cumulative accounted
spending is $4.52319035. The model-derived catalog now contains twenty-one
function/version cases. This is the repeatable acceptance path demonstrated on
a fresh case, not a claim of arbitrary-library or all-React completion.

## Independently verified version reuse

The resolver has an opt-in `compatibility: 'verify'` path for an installed
version or source variant that is absent from the catalog. It compares at most
four distinct existing programs/scopes, with at most 128 source candidates.
Each candidate must pass the same independent behavior and source-integration
checks against the current installed implementation. Candidates are verified
without populating the live bank; exactly one passing candidate can then be
admitted and exported as a new source-pinned catalog extension. Edited program
hashes, invalid overrides, unresolved source/checker evidence, no passing rule,
and competing passing rules all stop before admission or spending. The default
remains exact-source rejection, and unfamiliar-only experiments bypass this
path completely, including supplied catalog getters.

The real React 18.2.0 experiment starts with only the model-derived 18.3.1 and
19.1.1 candidates. `isValidElement`, `forwardRef`, and `memo` pass behavior,
actual-namespace source integration, and re-admission of the generated version
entries. The React 19 element-tag candidate fails on React 18. `createRef`
remains an explicit ambiguity: two structurally different sealed-object
programs pass, and the resolver does not infer universal equivalence from those
tests. Its live bank remains empty. This is three verified version reuses and
one justified frontier, separately counted from the twenty-one model cases.
All 268 regressions and twenty-one acceptance checks pass. Model spending stays
at $4.52319035; no paid request, reset or merge was used here.

## Hook execution joins the shared trail

Owner-backed reference and value boundaries now participate in the same
installation-scoped execution context as ordinary library rules. A real
`useMemo` calculation can parent a later instrumented library call. Returned
value/reference records carry the exact observed API execution ID; observed
callback records carry their own child execution ID. Tracer's private bootstrap
closure and marker hooks contribute no application execution events. Deferred
callbacks retain their original occurrence after the synchronous host frame
ends. Missing owners and rejected replay still preserve real execution while
retaining separate agreement frontiers.

Installed React 18.2.0, 18.3.1 and 19.1.1 renderer checks retain all previous
memo, suspension, rollback and remount assertions, and now require exact
API/callback joins without bootstrap events. The twelve real memo callbacks in
each source integration run match twelve distinct execution events. Existing
`useCallback` checks require API/reference joins and explicitly zero callback
execution claims from storing those references. Unit checks cover downstream
library composition, interleaved async parents, throws and failed ownership.
All 273 regressions and twenty-one acceptance checks pass. This supplies Node
ancestry for the existing hook scopes, not browser wiring, returned-callback
invocation attribution or complete hook lifecycle semantics. No new model
spending, reset or merge occurred.

## A common skeleton for equivalent local aliases

The React 18.2 `createRef` ambiguity is now resolved through two conservative,
library-independent structural rewrites: returning a just-bound value, and
sealing/freezing a just-bound value immediately before returning that same
value. Normalization preserves one evaluation of the initializer and never
removes intervening code. Original program/source hashes are checked first;
normalized candidates still pass the real-library and source-integration gates.
The output records each original version/hash and applied rewrite. Arbitrary
program equivalence is not inferred, and competing non-normalized passing
programs still produce an empty-bank ambiguity frontier.

Local tests preserve descriptors, object freshness, callback count, throws and
outer lexical captures, and retain deliberately different effects/results.
All four React 18.2.0 API compatibility cases now pass and their generated
entries re-admit independently. The original frozen model banks are unchanged.
The full gate passes 276 regressions and twenty-one acceptance checks with no
new model spending. This follows the conservative compiler principle that
canonicalization is optional simplification rather than a substitute for
correctness checks ([MLIR canonicalization](https://mlir.llvm.org/docs/Canonicalization/),
consulted through Exa).

## Unfamiliar Lodash, then deterministic version expansion

Lodash 4.17.21 `negate` was frozen with no bank answer available to its proposer.
The checker independently exercises argument-list lengths, receiver identity,
primitive/object/function truthiness, distinct closures, repeated calls,
callback throws and invalid predicate inputs. The positive calibration performs
642 real predicate calls; four wrong candidates reject for missing negation,
wrong receiver, dropped arguments and duplicate invocation. No interpreter or
source-adapter opcode was added for this API.

After the full local gate passed, `gpt-5.4-mini` proposed one rule and passed
format, behavior and actual-namespace source integration on its first attempt:
11.112 seconds and $0.0119175. Cumulative accounted spending is $4.53510785.
The saved proposal re-admits into the catalog. The compatibility path then tests
that same rule against installed Lodash 4.18.1, admits an exact version/source
extension and rechecks the generated entry, all without another model request.

Catalog identity now includes the public import subpath separately from npm
alias and package name. `lodash/negate` cannot borrow a `lodash/identity` default
export entry merely because both exports are named `default`. Original source
hashes and entry-point paths remain intact; subpath mismatches reject before
checking or spending. Root-entry catalogs retain their existing identities.
There are twenty-two model-derived function/version cases and five separately
verified version reuses. All 278 regressions and twenty-one acceptance checks
pass; none of this is an all-library or all-React coverage claim. No reset or
merge was used.

## Function values are not automatically callbacks

A local `constant(functionValue)` probe exposed a false-agreement bug: invoking
the created closure returned a new observer Proxy instead of the exact supplied
function. The boundary now preserves an already identical function value and
records its precise input-reference origin. It does not grant an invocation
capability or claim that later application execution was observed. Only a new
library-produced closure remains subject to the returned-call observer.
Immediate identity returns and retained/interleaved closure returns preserve
the original function; the application executes it once, and replay never does.

After that local fix, Lodash 4.17.21 `constant` was frozen as another unfamiliar
function. Independent checks make 255 observations over primitive, object,
array and function data, distinct closures and changed later arguments, with
zero executions of supplied function values. Wrong immediate returns, later
argument substitution and value replacement reject. Source integration also
requires the exact retained input-reference records. The first mini-model
proposal passed all gates in 2.367 seconds for $0.00212805. The saved rule then
passed independently against Lodash 4.18.1 without another model request.

All 279 regressions and twenty-one acceptance checks pass. The usable model
catalog contains twenty-three function/version cases, plus six separately
verified version reuses. Cumulative accounted spending is $4.53723590. Public
resolver types now expose the compatibility option. No reset or merge occurred.
This supplies value transport evidence, not an execution claim for a function
merely stored or returned as data.

## Shared independent experiments instead of one checker per function

`createLibraryExperimentVerifier` accepts checker-owned, freshly constructed
inputs and follow-up calls. One runner compares actual installed libraries with
their proposed programs and generates source-adapter calls for the required
arities. The same runner checks retained values, predicate callbacks and
TanStack updates. Experiments contain inputs and calls, not expected library
answers; neither the proposing model nor its rule can change them. An empty
plan, all-throwing inputs, a missing callable result or unsupported source
receiver produces an explicit input frontier instead of a vacuous admission.

Function-valued data is created with an independent body counter before it is
passed to the library, preserving the input's original identity. The runner
rejects hidden calls even if a library catches their errors or returns the
expected value. Callback capabilities apply only inside the relevant root or
returned-call context, including microtasks; the same function can be a granted
callback in one experiment and data in another. Unobserved data functions,
accessors and proxy inputs require better fixtures. A classifier whose tested
terminal results are all the same boolean also requires better inputs: an
always-false candidate cannot pass an element predicate merely because the
suite omitted valid elements. This conservative guard also leaves truly
constant boolean APIs unresolved unless a different independent checker proves
their intended scope. The bounded microtask and zero-delay-timer checkpoints do
not cover arbitrary future external triggers.

A fresh Lodash 4.17.21 `identity` case used only the generic value experiments,
with no function-specific outcome assertions. Its first mini-model proposal
passed format, behavior and generated source integration in 1.556 seconds for
$0.00158955. Saved re-admission and reuse on Lodash 4.18.1 pass without more
model requests. All 286 regressions and twenty-one acceptance checks pass.
There are twenty-four model-derived function/version cases and seven separately
verified version reuses; cumulative accounted spending is $4.53882545.

This removes repeated checker mechanics, not the need for representative input
construction or renderer-specific host observations. The original all-55 React
and browser integration gaps remain. The experiment design was checked against
[fast-check's model-based testing documentation](https://fast-check.dev/docs/advanced/model-based-testing/)
through Exa; no claim of exhaustive correctness follows from finite tests.

## Unfamiliar array wrapping uses the same generic checker

Lodash 4.17.21 `castArray` was frozen separately from the saved bank and passed
its first model proposal in 4.016 seconds for $0.00339405. The unchanged generic
value experiments distinguish missing arguments, explicit undefined, existing
arrays, scalars, objects and function data. Incorrect missing-argument behavior
and rewrapping an existing array reject locally. No interpreter operation or
function-specific checker was added. Saved re-admission and independent reuse
on Lodash 4.18.1 also pass.

All 286 regressions and twenty-one acceptance checks pass. The model-derived
catalog now has twenty-five function/version cases, with eight separately
verified version reuses. Cumulative accounted spending is $4.54221950, including
retained unknown charges. This expands tested value behavior, not React
lifecycle coverage. No reset or merge occurred.

## Native exports reuse host primitives without model spending

Exact `Array.isArray` exports now produce a source-pinned host identity hint.
The reader labels them catalog-recheck-only; it does not claim their native
implementation is readable JavaScript. The bank-first resolver offers the
existing `is_array` operation to the caller's independent verifier and returns
a portable entry only after behavior and source integration pass. The Node
version and installed package bytes remain part of the identity, and changing
the host function invalidates the attestation. Unfamiliar-only evaluation never
loads this candidate or spends on unavailable native source.

Lodash 4.17.21 and 4.18.1 `isArray` pass both gates and saved-catalog re-admission
with zero model requests. Bound variants, unrelated native functions, wrong
predicates, missing domains and nondiscriminating inputs still reject. These
two host-contract cases are separate from the twenty-five model-derived cases
and eight version reuses. All 289 regressions and twenty-one acceptance checks
pass. Cumulative spending remains $4.54221950. No reset or merge occurred.

## React effect lifecycle through shared event programs

A new host-event boundary lets an ordinary shared-IR closure retain pending
registration, committed dependencies and cleanup across independently observed
host events. No interpreter instruction was added. React marker hooks observe
commit/disconnect separately from the application's setup and cleanup; callback
wrappers record the real calls, and shadow capabilities consume their outcomes
during replay without invoking application code again. Marker hooks must be
installed consistently before mount. Cleanup identity observation and errors
remain outside this scoped contract.

`useEffect` and `useLayoutEffect` now pass exact-source manual bank admission on
React 18.2.0, 18.3.1 and 19.1.1 development renderers. The catalog retains the
installed mount/update, dependency comparison and commit helper source. The
same program is checked both directly and through the TypeScript source
adapter. Independent scenarios compare the complete application setup/cleanup
log with uninstrumented React, including separate owners, captured render
values, omitted/empty dependencies, NaN, signed zero, retained/replaced object
references, absent cleanup, Strict Mode, suspension and remounting.

Across six API/version entries, three wrong programs per entry reject: omitted
effects, omitted cleanup, and strict equality substituted for Object.is.
Missing lifecycle hosts, cross-owner calls, extra or wrong-argument callbacks,
accessor dependency inputs and unfinished host observations remain frontiers.
Actual cleanup exceptions propagate once. Source integration records real
callback executions separately from lifecycle checks and registration identity.

The full local gate passes, including the added lifecycle acceptance. These
are six manual scoped entries, not six model proposals or all-React completion.
Production builds, effect errors, imperative handles, state dispatch and
browser integration remain separate gaps. External model spending remains
$4.54221950. No reset or merge occurred. The lifecycle design was cross-checked
against [React's effect documentation](https://react.dev/reference/react/useEffect)
using Exa and tested against installed renderer behavior.

`useInsertionEffect` passes through the same event program and observer on all
three development versions. Only the host phase selects React's insertion
marker hook; there is no new interpreter instruction or behavior rule. Its
per-component cleanup/setup interleaving matches the uninstrumented baseline,
including Strict Mode and suspended trees. There are now nine scoped manual
effect API/version entries and twenty-seven wrong-rule checks. All 292
regressions and twenty-two acceptance checks pass. This does not assert that
DOM refs are attached during insertion effects or that insertion effects may
schedule state updates; those are outside this callback-lifecycle scope.

## Effect programs checked in both renderer builds

The three effect APIs now pass the same independent checks in production as
well as development on React 18.2.0, 18.3.1 and 19.1.1: eighteen exact API/build/
version variants, using one shared event program. Each build retains its own
installed-source fingerprint and must pass re-admission. The two React 18
minified renderer helper names were inspected directly and retained as
version-specific source labels; they are not runtime lookup logic or a
compatibility claim for unseen builds. Source variants preserve the original
development evidence.

Production scenarios use the real renderer's flushSync plus a task checkpoint
and compare against the same uninstrumented baseline. Fixed dependency arity
is enforced by the observer, and changed arity leaves an explicit frontier
while preserving the actual registration. All 292 regressions and twenty-three
acceptance checks pass. Fifty-four deliberately wrong API/build/version rules
reject across the lifecycle checks. Model spending remains $4.54221950; no
reset or merge occurred.
