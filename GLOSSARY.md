# Glossary

The words this project uses. Use them exactly in code, tests, issues and PRs.

**Action**: one thing a user did in the page: a click, a submit, a keypress on a control. The unit producttrace explains. _Avoid_: event (too low-level), interaction.

**Row** (or record): one fact the runtime recorded, such as `network.request` or `element.stamp`, with a contiguous sequence number. Rows are evidence; actions are built from them.

**Episode**: everything one action caused, followed by identifiers: the functions it ran, the work it scheduled, the requests it sent and what those requests did on the server.

**Action chain**: the episode written as a path of hops, from the control to the last thing observed, e.g. `Save button → handleSave → PATCH /api/projects/p_81 → 200 → projects.update`.

**Hop**: one link in an action chain whose join is proved by an identifier (a stamp, an action context, a `traceparent`).

**Reached / stopped at / because**: how every chain ends. What it reached, where it stopped, and the reason. A chain never claims more than the evidence. _Avoid_: mapped, covered.

**Frontier**: a stated point past which producttrace has no evidence, e.g. an uninstrumented service (`escaped_hops`) or a Web Worker. A frontier is reported, never guessed through.

**Unlinked**: evidence that no identifier connects to an action. Listed separately; never attached to the nearest action by time.

**Stamp**: the build-time attribute on a JSX element that names its source location and the build's manifest fingerprint. How a recorded click is tied to source.

**Manifest**: the build's map from stamps and function ids to files and lines.

**Store**: the directory the collector writes (`.tracer/` by default): `records.jsonl`, `spans.jsonl`, `manifests/`, `runs.jsonl`.

**Collector**: the local process that receives rows from the page and spans from the backend and writes the store.

**Entity**: a product object an action touched, named by its real ID (`ws_12`, `t_2`), taken only from recorded URLs or bodies.

**Session story**: one page session rendered as a timeline of sentences, one per episode. The v1 output.

**Segment**: one goal in a session story, such as signing up or creating a discussion: consecutive lines joined by a form, an entity id or the page a navigation reached, titled as an observation ("In Discussions, the user is creating …") with each line as a step under it.
