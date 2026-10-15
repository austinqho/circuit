# Gate G4: element index + MCP server (and the G6 tool it ships)

Status: gate text written before code, 2026-09-23. Branch `g4-mcp` (from `main` = tag `m1`).
Source: `docs/HANDOFF-2026-09-23-agent-annotation-pivot.md` §6.2–6.5, §7.

## 1. Pass criteria (verbatim from the handoff §7)

> **G4 MCP.** All tools in §6.3 answer correctly against a scripted session; grader recomputes answers from raw `records.jsonl` / `spans.jsonl`.

> **G6 Verification.** For a seeded bug on a fresh repo, `compare_chains` shows the before/after path change after the agent's fix, and shows *no* change for a no-op refactor.

Scope of this branch: G4 in full against the final7 scripted session (`docs/evidence/m1-2026-09-22-final7`), and the `compare_chains` tool that G6 needs, exercised on final7 pairs. G6 itself cannot pass here: it needs a seeded bug on a fresh repo (G2) and before/after builds. That remains open.

Doctrine that constrains every decision below (HANDOFF-2026-09-22 §8, pivot §5.2): identifiers attach, timestamps only order; abstain over guess; explicit frontiers; no model in the path; no repo-specific rules in the package; all MCP inputs are untrusted; evidence dirs immutable; report "reached / stopped at / because".

D12 stays intact: element stamps and selector/text inputs are **lookup keys for external agents only**. Nothing in the element index or the MCP creates, alters, or ranks an attribution. Handler credit comes only from `indexEntryHandlerUnits`; backend stops come only from `attachBackendSpans` (exact trace + parent + method). Neither module is reimplemented.

## 2. Store layout the MCP reads

A store is a directory. The MCP never writes to it.

| file | required | schema | use |
|---|---|---|---|
| `records.jsonl` | yes | `producttrace.runtime-evidence.v1` rows: `dom.action`, `function.enter/exit`, `network.request`, `dom.mutation`, and (G3, when present) `element.stamp`, and (2026-09-24, dev builds) `network.body` (§3.3), and (2026-09-24, every build) `network.abort` / `network.response_read` (§3.4) | everything browser-side |
| `spans.jsonl` | no | `producttrace.backend-span.v1` | backend stops. **Absent or empty means the backend is not instrumented**: every request-bearing chain ends with the explicit frontier `stopped_at: "network", because: "backend not instrumented"` |
| `manifest.json` | no | `producttrace.runtime-attribution-manifest.v1` (`functions[].id → source {file,start,end}`) | function id → source span; also restricts handler credit to registered first-party ids exactly as the harness does |

CLI overrides: `--records`, `--spans`, `--manifest` (any path), `--source-root <dir>` (checkout of the instrumented repo, used only to turn `start` offsets into line numbers and to detect stale builds by content hash).

Derived at load, never persisted (one implementation, no second copy to drift): episodes (`indexWorkflowEpisodes`), entry-handler units (`indexEntryHandlerUnits`), chains (`buildEpisodeChain`, lifted from the viewer's `liveEpisodeRecord` into `analysis/causal-chain.mjs`; the viewer now calls the same function), element index (`collector/element-index.mjs`).

For final7 the manifest lived in `/tmp/producttrace-librechat-m1-final7.json.attribution.json` (volatile). A subset restricted to the 1,640 function ids referenced by final7 rows, with `generated` paths dropped, is banked in `docs/evidence/g4-mcp-2026-09-23/manifest.json`.

### 2.1 Sessions, ordering, identity
- `session` = `capture_page_id` (one page load). Sequence numbers are per page, so "ordered by sequence" means per page; across pages the order is `(timestamp, page, sequence)`. Timestamps only order; they never attach.
- `action_id` is the join key for everything browser-side. If an `action_id` appears on `dom.action` rows of more than one page the tool returns `ambiguous` rather than picking.
- A chain belongs to an **episode** (the carrier that holds the effect). `action_chain` on a context action (keystroke, field change) with no episode returns a single-action chain whose frontier says so; it is never merged into a neighbour by time.
- An episode never spans two controls (G5 §15). It folds only actions on the same control (`target_ref`) or form members of the same form (`form_ref`). Form members are field events on the form's fields, and submit-capable actions: `submit`, a click on a `<button>` with no type or `type="submit"` or on `<input type="submit|image">`, and Enter in a field. A click on `type="button"`/`"reset"`, on a control with `aria-haspopup` or `aria-expanded`, or on a non-field, non-submit control is its own episode even inside a form, with its own request if it sent one. With no request and a mutation receipt, such an opener reads `reached: "dom_mutation", stopped_at: "browser"`. The controls inside a menu, dialog or form that another control opened are separate episodes from that opener. So an action's chain is never printed under another action on a different control.

### 2.2 Element index (`collector/element-index.mjs`)
`element_key → placement → handlers → actions (per page by sequence) → chains`.

Key kinds, never mixed:
1. `element_stamp` (G3, exact). From `element.stamp` rows `{element_key, placement_id, file, line, start, end, component, handlers:[{event,function_id}], build, url}` and the runtime's `dom.action.target.element_key`. `url` (origin + path, literal) narrows no-key lookups to the page sessions stamped at that URL. An action belongs to a key only by string equality of `target.element_key`.
2. `source_ref`: `source:<file>:<start>:<end>` when the runtime recorded a `dom.action.source_ref` (none in final7).
3. `entry_handler` (fallback when a store has no stamps, e.g. final7). Key = `handler:<function_id>|<event>` (the entry-handler `unit_id`, prefixed). Placement = the handler's manifest source span. Actions belong to it only when `indexEntryHandlerUnits` (run over the whole store, as the harness that produced `HANDLERS.md` does) credited them. Actions with none of the three are listed as unplaced with a reason, not assigned.

`confidence: "exact"` is returned **only** when the caller's `element_key` matched an `element_stamp` key. A fallback key matched by string is `"handler_placement"` (it identifies a handler's source placement, not a DOM element). Selector, element path, role, name, nearby text and URL never yield `exact`.

*Amendment (fix/stable-element-keys, 2026-09-24).* `exact` means exactly one element. G3's sixth pass has the key format and the new row and action fields.
- Each `element_stamp` entry records every stamp row as an observation (`observations`: `stamp_sequence`, `commit`, `key_kind`, `instances`, `react_key_path`, `react_key_site`, `binding_placement`, `handlers`).
- Each action records `element` (`key_kind`, `instances`, `stamp_sequence`, and `label`, the target's already-recorded `aria-label`/`title`/`name`/`data-testid`). It also records `binding`, the observation joined by `(page, target.stamp_sequence)` (`basis: "stamp_sequence"`); for older rows without `stamp_sequence`, the key's only observation on that page (`basis: "only_observation"`), else `null`.
- `stampKeyTrust(entry)` is not exact in two cases. First, an ordinal key whose placement had more than one instance at any stamp or action (older rows: the highest ordinal of its family on the page). Second, a React key path seen under two keyed parent placements. For those, `resolve_element` returns `status` and `confidence` `"ambiguous"`, `reason: "ordinal key; N instances of this placement"`, `instances`, the instances' latest bindings as `candidates` (at most 50, plus `candidates_total`), and `advice`: annotate a distinguishing child, or use `element_history` and pick by action time.
- `exact` remains for React-keyed keys and for ordinal keys with N = 1, provided the key showed one content at every action in scope and that content is what the key's latest stamp row on the same page shows.
- *Scope (after the grade, `docs/evidence/pr-stable-element-keys-grade-2026-09-24/GRADE.md`).* `exact` means one element within one page load, at every stamp row and every action in scope, with the same content at each action as the key shows now (its latest stamp row on that page). Two cases are handled by downgrade, not prevented:
  - The same key in two React roots: key uniqueness is page-wide, so both fall back to ordinals counted across roots and resolve `ambiguous`.
  - An index-like key (`key={i}`) after a reorder: stamp rows carry `content_sig`, and when it differs between the actions in scope, `resolve_element` and `element_history` return `ambiguous` with `reason: "key content changed between actions (index-like key)"` and `labels` (per action: `action_id`, `timestamp`, `event`, `label`, `content_sig`, `current_content_sig`). When the actions agree with each other but not with what the key shows now, the reason is `"key content changed since the action (index-like key)"`.
  - Tests and residual limits are listed in G3's sixth pass.

### 2.3 Source lines and stale builds
- `function_id` = `function:<sha256(file content)>:<start>:<end>`. With `--source-root`, the MCP hashes `<root>/<file>`: equal → `line` computed from `start`; different → the source is marked `stale_build` (the checkout no longer matches the build that produced the evidence) and `line: null`. Without a source root: `line: null, line_status: "source_root_not_configured"`. Stamp rows carry `line` directly.
- `resolve_element` accepts the page's `tracer_build`; if the store has stamps and none carries that build, status is `stale_build`.

## 3. Tool contracts

Amended the same day, after code started, and recorded here rather than silently: (a) `resolve_element` gained `role` and `name` and `element_path` is tag names only, because the research on Codex's manual annotation (`docs/research/oai-annotation-unknowns-2026-09-23.md` §1 in the main checkout) shows those are exactly the fields the model receives and that `data-*` attributes never reach it; (b) `compare_chains` compares request paths literally except id-shaped segments (24-hex ObjectId, UUID, 8+ hex, all digits), per the coordinator's ruling; a difference confined to id-shaped segments is `changed` with `change_kind: "parameters_only"` and does not by itself set `path_changed`, while any other differing segment (e.g. `openAI` vs `agents` under `/api/agents/chat/:endpoint`) is `different_value` and does. An earlier revision keyed on the server route template and wrongly reported send vs agent-chat as unchanged (that revision is what `docs/evidence/g4-mcp-2026-09-23/GRADE-g4.md` graded; `GRADE-g4-rev2.md` grades this one); (c) fallback keys resolve with `confidence: "handler_placement"`.

Every tool returns MCP `structuredContent` (the JSON below) and two text items: the rendered `summary` line in "reached … / stopped at … / because …" form, then the JSON. `isError` is true only for `invalid_input`. Protocol errors: a `tools/call` without `params` returns JSON-RPC -32602 (the guarded transport answers it; the bare SDK would return -32603); an unknown method returns -32601; a non-JSON line is dropped by the SDK without a reply (-32700 is not sent). No model runs anywhere.

Common envelope:
```json
{ "status": "ok | not_found | stale_build | ambiguous | invalid_input",
  "tool": "<name>",
  "store": { "records": 0, "actions": 0, "sessions": 0, "episodes": 0, "spans": 0, "backend_instrumented": true,
             "stamps": false, "builds": [], "manifest_functions": 0, "source_root": null, "malformed_records": 0, "malformed_spans": 0 },
  "summary": "reached … / stopped at … / because …" }
```
A server whose store cannot be loaded answers every call with `status: "not_found", reason: "store_unavailable"` and the load error. *Amendment (G6, 2026-09-23):* a store that exists but fails manifest validation (`MANIFEST_INVALID`: a `manifests/*.json` whose `build` differs from its file name, or duplicate build keys) is instead answered with `status: "invalid_store", reason: "store_invalid"`, the exact loader error in `error`, and summary `invalid_store: <error>`.

Inputs are validated against these schemas (generated from `mcp/tools.mjs` `TOOL_SCHEMAS`; the stdio test asserts the listed schemas equal them) before any lookup: unknown properties (own-property check), argument keys named `__proto__`, `constructor` or `prototype` at any depth (explicit `forbidden property name` errors; over stdio the raw JSON line is inspected before the SDK's schema parse, which would otherwise drop an own `__proto__` key silently), wrong types, out-of-range integers, over-long strings, control characters and non-printable ids yield `invalid_input` with the violated rules. `resolve_element` additionally requires at least one of `element_key`, `selector`, `element_path`, `role`, `name`, `nearby_text` (enforced in code; no top-level `anyOf`, which some MCP clients reject). Ids are compared by string equality only. Selectors are tokenised by a fixed grammar (tag, `#id`, `.class`, `[attr]`, `[attr=value]`, `:pseudo`) on the last compound only; ancestors, classes and pseudo-classes are reported in `ignored` and never evaluated. A stated `#id` must equal the recorded target's `id`; if no recorded target carries it the result is `not_found` (no tag-only fallback candidates).

#### resolve_element
```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "element_key": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256,
      "pattern": "^[\\x21-\\x7E]+$",
      "description": "data-tracer-el value, or tracer_el from annotation metadata. Only this can yield confidence \"exact\"."
    },
    "build": {
      "type": "string",
      "minLength": 1,
      "maxLength": 128,
      "pattern": "^[\\x21-\\x7E]+$",
      "description": "tracer_build from annotation metadata, for stale-key detection."
    },
    "url": {
      "type": "string",
      "minLength": 1,
      "maxLength": 2048,
      "description": "Page URL from the annotation evidence."
    },
    "selector": {
      "type": "string",
      "minLength": 1,
      "maxLength": 512,
      "description": "Target selector from the annotation (may be non-unique; only the last compound is used)."
    },
    "element_path": {
      "type": "string",
      "minLength": 1,
      "maxLength": 1024,
      "description": "Target path, tag names only (e.g. \"div > form > button\")."
    },
    "role": {
      "type": "string",
      "minLength": 1,
      "maxLength": 64,
      "description": "Target role attribute."
    },
    "name": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256,
      "description": "Target accessible name (aria-label or leading text)."
    },
    "nearby_text": {
      "type": "string",
      "minLength": 1,
      "maxLength": 512,
      "description": "Nearby text from the annotation."
    }
  }
}
```
#### element_history
```json
{
  "type": "object",
  "additionalProperties": false,
  "required": [
    "element_key"
  ],
  "properties": {
    "element_key": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256,
      "pattern": "^[\\x21-\\x7E]+$",
      "description": "A key returned by resolve_element."
    },
    "session": {
      "type": "string",
      "minLength": 1,
      "maxLength": 128,
      "pattern": "^[\\x21-\\x7E]+$",
      "description": "capture_page_id to restrict to one page load."
    },
    "n": {
      "type": "integer",
      "minimum": 1,
      "maximum": 100,
      "default": 10
    }
  }
}
```
#### action_chain
```json
{
  "type": "object",
  "additionalProperties": false,
  "required": [
    "action_id"
  ],
  "properties": {
    "action_id": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256,
      "pattern": "^[\\x21-\\x7E]+$",
      "description": "An action_id from element_history or recent_actions."
    },
    "include_bodies": {
      "type": "boolean",
      "default": false,
      "description": "Also return each request's recorded body and response body in full (as stored: redacted in the page, cut to 4 KB). Default: summaries only (top-level fields, id-shaped fields, truncated)."
    }
  }
}
```
#### recent_actions
```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "session": {
      "type": "string",
      "minLength": 1,
      "maxLength": 128,
      "pattern": "^[\\x21-\\x7E]+$",
      "description": "capture_page_id to restrict to one page load."
    },
    "n": {
      "type": "integer",
      "minimum": 1,
      "maximum": 100,
      "default": 20
    }
  }
}
```
#### compare_chains
```json
{
  "type": "object",
  "additionalProperties": false,
  "required": [
    "before_action_id",
    "after_action_id"
  ],
  "properties": {
    "before_action_id": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256,
      "pattern": "^[\\x21-\\x7E]+$"
    },
    "after_action_id": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256,
      "pattern": "^[\\x21-\\x7E]+$"
    }
  }
}
```

### 3.1 Outputs

- `resolve_element`: `{ element_key, key_kind: "element_stamp" | "source_ref" | "entry_handler", component, source: {file, start, end, line, line_status}, placement_id, handlers: [{event, function_id, source}], build, sessions, actions_observed, confidence: "exact" | "handler_placement" | "ambiguous", candidates?, candidates_total?, element_key_status?, ignored, limits? }`. `exact` only for a stamped key. Without a key: ranked candidates `{ target, score, matched_on, mismatched, actions_observed, sessions, recent_action_ids, keys }`, status `ambiguous` (even with one candidate) or `not_found`. A stamp key with a different `build` → `stale_build`; one key with two placements → `ambiguous`. `url` is listed in `ignored` when the store has no page-URL rows (final7 has none).
- `element_history`: `{ element_key, key_kind, placement, actions: [{ action_id, session, sequence, event, keyboard, episode_id, episode_carrier_action_id, entry_handler, spine, request, other_requests, other_requests_total, route, handler_spans, db_ops, segments, outcome, reached, stopped_at, because, summary }], actions_total, summaries, attempts: [{ episode_id, carrier_action_id, action_ids, events, entry_handler, spine, request, route, segments, outcome, reached, stopped_at, because, summary }] }`, newest first. `other_requests` is no longer capped at 20. *Amendment (fix/stable-element-keys):* the output adds `element_confidence` (`reason` and `advice` when it is not `exact`) and `observations` for stamp keys. Each action also carries `element` and `binding`, the stamp observation that held when it fired (§2.2). `resolve_element` on a stamp key also returns `stamp_key_kind` and `instances`.
- `action_chain`: `{ action_id, session, episode_id, episode_carrier_action_id, episode_action_ids, standalone, keyboard, spine, stops: [dispatch, entry_handler?, request?, route?, handler*, db*, validation*], requests, segments, outcome: {stage, status, display_status, http_status, writes, reads, stop_reason, stopped_at, requests, failed_requests, deferred?}, reached, stopped_at, because, chain }`; `chain` is the unmodified `producttrace.causal-chain.v1` record from `buildEpisodeChain`. An action outside every episode gets a standalone single-action chain (`standalone: true`), never a time-based merge.
- `recent_actions`: `{ session, actions: [{ action_id, session, sequence, timestamp, event, target, element_key, episode_id, standalone, reached, stopped_at, because, summary }], summaries }`, newest first by `(timestamp, page, sequence)`.
- `compare_chains`: `{ before: {action_id, episode_id, reached, stopped_at, because, outcome, segments, summary}, after: {…}, same_episode, stops: [{ stop, key, status: "same" | "changed" | "added" | "removed", change_kind, before, after, detail }], outcome_delta: { before, after, changed: [fields] }, path_changed }`.

Frontier vocabulary (`chainFrontier` in `analysis/causal-chain.mjs`): `reached` ∈ `db | handler | route | request | validation | dom_mutation | entry_handler | dispatch | worker`; `stopped_at` is `null` when a database span was joined, else `network` (no exact-parent server span, or `backend not instrumented` when the store has no spans), `route`, `handler`, `entry_handler` (credit abstention), `validation`, `browser` (no request attributed; see the 2026-09-24 amendment below), or `worker` (the action posted to a Web Worker; worker-frontier amendment below). A not-yet-idle episode reports `pending`. `stopped_at` is never `dom_mutation` or `dispatch`; those remain values of `reached`.

*Amendment (2026-09-23, G1 fourth pass, coordinator decision).* A frontend credit abstention (G1 D-G1-6: the action made no request and no element- or form-bound handler ran) reports `stopped_at: "entry_handler"`, `because: "no element-bound handler observed in instrumented code (uninstrumented and third-party handlers are not seen); global listeners: [ids]"`, `stop_reason: "no_element_bound_handler"`. `handler` is reserved for the backend handler span stop. A request-less action without an abstention stops at `browser`, or at `validation` for a rejected submit (2026-09-24 amendment).

*Amendment (2026-09-24, no false negatives; supersedes the request-less stops above).* A chain asserts absence only for what Tracer sees. `stopped_at` ∈ `null | network | route | handler | entry_handler | validation | browser | pending` (plus `worker`, worker-frontier amendment below):
- A request-less action (no abstention, no rejected submit) reports `stopped_at: "browser"`, `because: "no request could be attributed to this action from instrumented code (requests from uninstrumented scripts, workers and third-party code cannot be linked; any seen in this window are listed below as unlinked)"`. `reached` is unchanged: `dom_mutation`, `entry_handler` or `dispatch`. `stopped_at` is never `dom_mutation` or `dispatch` any more.
- An abstention reports `stopped_at: "entry_handler"`, `because: "no element-bound handler observed in instrumented code (uninstrumented and third-party handlers are not seen); global listeners: [ids]"`.
- A rejected submit reports `stopped_at: "validation"`, `because: "the same form mutated after the submit (validation); no request could be attributed to this action from instrumented code (requests from uninstrumented scripts, workers and third-party code cannot be linked; any seen in this window are listed below as unlinked)"`.
- Unchanged: request-bearing frontiers (`network` / `backend not instrumented`, exact-parent, `route`, `handler`) and the `server responded <status>; ` prefix.

Added fields. Chains gain fields and never lose one:
- `action_chain`: `unlinked` (only when the chain has no attributed request; also on `chain.unlinked`) and `coverage`. When `unlinked` lists anything, `summary` gains a heading line, `Observed during this action's window, not linked to it (timestamps only order, not a join):`, followed by one `- request …` / `- server span …` line per entry. When coverage is incomplete, it gains one `Coverage incomplete for page <id>: <reasons>` line. The first line is the unchanged frontier line.
- `element_history.actions[]` and `recent_actions.actions[]`: `coverage`, and `unlinked_counts: { requests, server_spans, attribution }` when the chain is request-less.
- `coverage` = `{ complete, reasons, page, unobserved, scope }` for the page the action belongs to. It comes from `store.coverageFor(page)`, computed only from `capture.page` / `capture.summary` / `capture.received` rows. A store written before these rows existed reports `complete: false` with the missing rows as reasons.

Unlinked entry schemas (`analysis/causal-chain.mjs` `indexUnlinkedEvidence`):
- request: `{ sequence, timestamp, method, url, transport, request_occurrence_id, trace_id, runtime_reason, attribution }`
- server span: `{ span_id, trace_id, parent_span_id, name, service_name, method, route, status_code, start_ms, attribution }`
- window: `{ page, from_action_id, from_sequence, from_timestamp, until: "next_dispatch" | "page_end", until_action_id, until_sequence, until_timestamp }`. The window starts at the episode's first dispatch and ends at the first outside dispatch on the page *after the episode's last dispatch*. An action interleaved inside an episode can therefore have a request listed under both chains. Requests are page-scoped by `sequence`. Server spans are not page-scoped: they are selected by start time only. At `page_end`, the last page row is `capture.received`, so the span window runs to collector close.

Each list is capped at 20 entries; `*_total` gives the full count. `attribution` is always `"none (observed during this action's window; timestamps only order, not a join)"`.

Coverage row schemas (all `schema: "producttrace.runtime-evidence.v1"`):
- `capture.page` (runtime, once at install, sequenced): `{ page_id, runtime_version, build, react_versions, wrappers: { fetch, xhr, eventsource, websocket, worker, beacon: false }, transport_rows: "runtime" | "bridge", url }`. `worker` is `true` when the runtime wrapped the `Worker`/`SharedWorker` constructors (worker-frontier amendment): posts into a worker are recorded, the worker's own requests are not, and the first worker on the page adds a `worker_fetch` `capture.limit`, so `capture.summary.capture_limit_features` includes `"worker_fetch"` and coverage is incomplete for that page. `build` and `react_versions` are what is known at install: usually `null` / `[]`, because the build registers itself at the end of its chunk. `capture.summary` repeats them once they are known.
- `capture.summary` (runtime, at pagehide or `__productTraceRuntime.captureSummary(trigger)`, sequenced): `{ page_id, trigger, runtime_version, build, react_versions, emitted_by_kind (includes this row), rows_emitted, last_sequence (= this row's sequence), stamps_emitted, last_stamp_sequence, capture_limits, capture_limit_features, host_errors, dropped, malformed, sink }`. `dropped` / `malformed` / `sink` come from `__productTraceCollectorStats()`, and are `null` when no sink is installed. The collector sink asks the runtime for this row first in its own pagehide listener, so it ships in the same beacon.
- `capture.received` (collector, one per page at run close, unsequenced): `{ capture_page_id, page_id, run_id, timestamp, rows_received, received_by_kind, unsequenced_by_kind, first_sequence, last_sequence, distinct_sequences, duplicate_sequences, gaps: [[from, to]…] (≤ 50), gap_rows, gaps_truncated, last_stamp_sequence, stamp_gaps, stamp_gap_rows, duplicate_stamp_sequences, collector: { unparsed_bodies, non_object_items } }`.
- *Body capture (2026-09-24, §3.3):* `capture.page` adds `bodies`; `capture.summary` adds `bodies, bodies_emitted, last_body_sequence, body_truncations, bodies_not_captured, bodies_pending, body_redactions, body_errors`; `capture.received` adds `last_body_sequence, body_gaps, body_gap_rows, duplicate_body_sequences`. `complete` additionally requires no body gaps or duplicate body sequences, `bodies_emitted` equal to the `network.body` rows received, and `bodies_pending` 0.

`complete` is true only when all of these hold:
- exactly one `capture.page`, at least one `capture.summary`, and exactly one `capture.received`;
- no sequence or stamp gaps, and no duplicate sequences;
- the received `last_sequence` equals the last summary's, and `emitted_by_kind` equals `received_by_kind`;
- the stamps emitted equal the stamps received;
- the rows the store actually loaded for the page equal what the collector received: per kind (sequenced and unsequenced) and in distinct sequences. This catches a truncated or hand-edited `records.jsonl`, and an append that failed after the collector counted the batch;
- the store's `records.jsonl` has no malformed lines. `load.malformed_records` is store-level: the page of an unparseable line is unknown, so any such line makes every page incomplete;
- `capture_limits`, `dropped`, `malformed`, `host_errors`, the `capture.dropped` rows and the collector's `unparsed_bodies` are all 0.

Each failed check is one reason. `unobserved` lists the transports the runtime did not wrap (always `beacon`; `worker` only where the page has no `Worker` constructor). Coverage is about delivering what the runtime emitted, not about what unwrapped transports did.

*Amendment (2026-09-24, worker frontier; G1 D-G1-1 amendment; reconciled with the no-false-negatives amendment).* `reached` and `stopped_at` gain `worker`, with `because: "message posted to Web Worker <script url>; worker code is not instrumented: requests it makes cannot be attributed to this action (any seen in this window are listed below as unlinked)"` (the tail is `SCOPED_ABSENCE.worker`; `shared Web Worker` for a SharedWorker) and `stop_reason: "worker_not_instrumented"`. `chainFrontier` reports it when the chain has a `worker.postMessage` step and its request (if any) was recorded before the latest post; the displaced request frontier is listed in `additional_stops`. When a request was recorded after the latest post, the request frontier stands and the worker stops are listed in `additional_stops`. A pending episode stays `pending`. `chainStops` appends `{stop: "worker", worker_id, worker_kind, script_url, via, message_size_class, action_id, sequence, instrumented: false}` stops after the existing ones; `renderChainLine` adds `post to worker <url>` to the path and `; also stopped at <x> because <y>` per additional stop. `action_chain`, `element_history` and `recent_actions` add `additional_stops`. Unlinked evidence is the `unlinked` field above (one design); the only extension is that a chain with a worker post carries `unlinked` (and `unlinked_counts`) even when a request was also attributed. `compare_chains` aligns a `worker:<script url>` stop, and since `outcome.reached` is compared, a worker stop vs a request-less `browser` stop differs in `reached` and `stopped_at`. All of these are absent for chains without a worker post, so stores without workers answer byte-for-byte as before.

*Amendment (2026-09-23, G6, accepted by the coordinator as a G4 behaviour change).* If the admitted server span has an HTTP status ≥ 400, the status always appears in `because`, as the prefix `server responded <status>; ` in front of the frontier sentence. For example: `stopped at handler / because server responded 422; no database span descends from the admitted handler span`. `reached`, `stopped_at` and `stop_reason` do not change. The rule is generic HTTP semantics, with no product list. It applies to every tool that returns a chain frontier (`action_chain`, `element_history`, `recent_actions`, `compare_chains` `before`/`after`), and is implemented in `chainStops` (`mcp/tools.mjs`). Chains without an admitted server span (network frontier, frontend-only stores) are unaffected.

*Amendment (2026-09-24, `fix/mcp-rendering`: "the MCP says everything the records already know").* Rendering only; no join or credit rule changed, and `stops` keep their previous meaning (the credited request only), so the G4 and G6 graders are unaffected. Added to every chain the tools return (`action_chain`; each `element_history` action and attempt; `compare_chains` `before`/`after`, which now also carry `outcome` and `summary`); `recent_actions` gets the same `summary` line:

- `entry_handler` gains `name`, `name_status`, `label` (`name file:line`, or `file@start-end` without a matching checkout). The name is the manifest row's `name` (the store writer's enrichment, `functionNameAt`: a declaration or method name, the object property that directly holds the function — the key must follow `{` or `,`, so an earlier member such as `{ required: true, onChange: fn }` or a ternary branch never names it — or a variable / parameter / field / member binding `NAME = fn`, optionally `NAME: Type = fn` with an annotation that cannot cross `,` `:` `(` `{` or a newline; anything else is anonymous. Graded fix 2026-09-24: the earlier rule let the annotation span earlier object members, giving e.g. `queryKey` for `queryFn`; 20 of 1640 final7 names changed, all corrections); a manifest without names is enriched at read time by the same rule, only when the checkout's file hash equals the id's hash (`name_status: "source"`). A function passed as the first argument of an assigned call (`const confirmDelete = useCallback(() => …)`) is labelled `confirmDelete (via useCallback)`, `name_status: "source_via_call"` (display only; never used by the manifest remap). `anonymous` renders `<anonymous> file:line`; with no names and no matching checkout, `not_recorded` renders `<unnamed>`: a name is never guessed.
- `spine`: the carrier's `spine.function_ids`, each `{ function_id, name, name_status, source, label }`.
- `keyboard` (for `keydown`/`keyup`/`keypress` only, else null): `{ key, code, modifiers: ["Ctrl"|"Alt"|"Shift"|"Meta"], repeat, target, text }`, from the dispatch row's `key` and target attributes, e.g. `Ctrl+Enter in <div role="dialog" aria-label="Settings">`. The runtime records printable keys as `Printable`; a row without `key` renders `key not recorded`.
- `segments`: one per attributed (non-internal) `network.request` of the episode, in dispatch order (timestamp, sequence), each joined by its own `request_occurrence_id` through `attachBackendSpans` (the chain's own exact join): `{ index, action_id, request_occurrence_id, sequence, method, url, path, trace_id, third_party, first_party_frames, lineage: [function info], route: {span_id, method, route, status_code} | null, http_status, handler_spans, db_ops: [{span_id, operation, collection, write}] (every joined DB span, in span start order, never truncated), outcome, deferred, join_diagnostic, reached, stopped_at, because, summary }`.
  - `lineage` is the request's own `spine.function_ids`, else the spine of the `function.enter` that owns `terminal_owner_continuation_id`; consecutive repeats (async resumptions) collapse to one hop.
  - `third_party: true` when no lineage frame is registered in a manifest (no manifest: any recorded frame counts); the segment summary then starts `third-party: issued by uninstrumented code during this action`.
  - `outcome` per segment: `completed` (2xx/3xx **and** a DB span joined under this request, i.e. the segment's `stopped_at` is null), `responded` (2xx/3xx without that effect evidence; with `note: "no effect evidence"`), `failed` (≥ 400; `because` gets the `server responded <status>; ` prefix), `no_status`, `no_server_span`, `backend_not_instrumented`, `pending`.
  - `deferred`: `{ after_response_ms, last_after_response_ms, spans: [{kind: "handler"|"db", span_id, after_response_ms}] }` when a handler or DB span joined under this request's server span starts at least 1 ms after that server span ended (a 1 ms floor, since span start clocks are ms-granular; values at 0.1 ms resolution; span clocks order spans of one trace, they create no join); else null. The summary says `server work continued N ms after the response`.
  - The segment `summary` is `lineage → METHOD path → route R S → server h1,h2 → db find items ×3, insert items [outcome S; deferred]`; the entry handler is not repeated, and a lineage over six hops keeps both ends with `… n more hops …` (the JSON keeps every hop). DB repeats collapse to `op collection ×n` only in the summary.
- `outcome.status` is now a label: `completed` (credited request 2xx/3xx **and** the engine reached its terminal join, `display_status: "completed"`), `responded` (2xx/3xx but the engine says incomplete; with `note: "no effect evidence"`, so an agent cannot conclude a write happened), `failed` (≥ 400), `rejected_client_side` (a submit with no request and a same-form mutation), else `incomplete` / `pending`; the engine's display status moves to `outcome.display_status`. Also `outcome.requests`, `outcome.failed_requests`, and `outcome.deferred` for the credited request.
- The action `summary` line: `event action_id (key detail) → handler <label> → spine hops → N requests (k failed, m third-party): (1) <segment summary>; (2) … [outcome S]: reached … / stopped at … / because …`. At most 5 segments are rendered inline, then `… N more requests (see segments)`; the JSON keeps all. `element_history` actions and attempts and `compare_chains` `before`/`after` and its summary use the same renderer.

*Amendment (2026-09-24, `fix/outcome-labels`: "every outcome label Tracer prints tells the truth about the response and about the app's own decision"; supersedes the `outcome.status` / `display_status` / segment `outcome` definitions of the `fix/mcp-rendering` amendment above).*

One function, `actionOutcome(record, { backendInstrumented })` in `analysis/causal-chain.mjs`, computes an action's outcome label set from the chain's own steps. Every place that prints a status word uses it: `buildEpisodeChain` (`chain.outcome`, `chain.display.status`, `chain.display.label`, `chain.terminal.label`, which the live viewer shows), `buildActionChains` (`outcome` on each exported `producttrace.action-chain.v1` row), and the MCP (`outcome` on `action_chain`, every `element_history` action and attempt, `recent_actions` rows, `compare_chains` `before`/`after`; each request segment's `outcome`; every `summary` line through `outcomeText`). `outcome.display_status` is kept only as an alias of `outcome.status` and can never differ from it; the engine's internal episode state (`describeEpisodeEvidence`) is not a label and is no longer printed as one. `route.dispatch` rows now carry the joined server span's `status_code` so the label is computed from the chain alone.

The label set (`outcome.status`), in the order the function decides it:

| status | when | always carries |
|---|---|---|
| `pending` | the episode is not idle (evidence may still arrive) | `label` = the live progress line |
| `rejected_client_side` | the engine found a rejected submit, or the chain has no attributed request **and** the rows hold a reject signal (below) | `reason`, `signals` |
| `failed` | the credited request's joined server span answered ≥ 400 | `http_status` |
| `completed` | the credited request answered 2xx/3xx **and** a database span joined under it (the engine's terminal join, `stopped_at: null`) | `http_status` |
| `responded` | 2xx/3xx without that effect evidence | `http_status`, `note: "no effect evidence"` |
| `stopped` | a request left the page and the evidence stops at a frontier without an HTTP status (no exact-parent server span, `backend not instrumented`, a server span with no status), or a request-less action stops at `worker` or `entry_handler` (abstention) | `stopped_at`, `because` (the frontier's own words) |
| `no_request` | no attributed request, no reject signal, no worker/abstention frontier | `did: { functions_entered, dom_mutations, state_effects }`, `sentence` |

*Amendment (2026-09-24, `fix/client-aborts`).* The label set gains `aborted_by_client` (after `rejected_client_side`, before `failed`): the credited request was aborted by the page. It wins over the server's status for that request, which is kept as `server_status` (the action's `http_status` is `null`). An aborted request is never the credited one while the episode has a request the page did not abort. The full label set is now `pending | rejected_client_side | aborted_by_client | failed | completed | responded | stopped | no_request`. Rules and fields: §3.4.

- `failed` is decided before anything else about the response: a 409 whose handler read the database is `failed 409`, never `completed`, in the JSON, the chain's `display`, the viewer label (`Failed 409: POST /api/…`) and every summary.
- `no_request` sentence: `the handler ran and issued no request from instrumented code (N functions entered, M DOM mutations, K state effects); ` + the scoped-absence sentence, when at least one action-owned `function.enter` row exists; otherwise `no instrumented function ran for this action (…); ` + the scoped-absence sentence. It is never `incomplete` and never `completed`: the app decided, Tracer did not lose it. `state_effects` counts action-owned `function.enter` rows with `invoked_by: "effect"` (effects run under a state-update receipt; renders are never owned).
- Reject signals (generic, recorded, never inferred). `reason` is the first of these present, in this order; `signals` lists all:
  - `handler_threw`: an `action.uncaught_error` row with `via: "uncaught_exception"` (below);
  - `promise_rejected`: an `action.uncaught_error` row with `via: "unhandled_rejection"`;
  - `form_validation`: a `submit.rejected` step (a submit with no request and a same-form mutation, as before), or a submit-capable `dom.action` (a `submit`, a click on a submit button, Enter in a form field) that carries `form_invalid: true`.
  A handler that merely returned early has no signal: it is `no_request`. A thrown error the app caught itself leaves no `action.uncaught_error` row: `no_request`.
- For a request-bearing action the response decides the status; an uncaught error is added to `signals` and to the sentence (`also: handler_threw TypeError`), never replacing `failed` / `completed`.
- Request segments use the same function on each request's own joined steps, so a segment is `completed | responded | failed | stopped | pending`; `no_status`, `no_server_span` and `backend_not_instrumented` are now `stopped` with `stopped_at` and `because` (the segment summary ends `[stopped at network]`; its `because` field says why). Each segment also gains `outcome_label` (the function's `label`). `recent_actions` rows gain `outcome` (the same object as `action_chain.outcome`).
- Labels (`outcome.label`, `chain.display.label`, the viewer card): `Completed 201: insert items`, `Responded 200: no effect evidence`, `Failed 409: POST /api/seats/A/claim`, `Stopped at network: <because>` (`Stopped at worker: <script> is not instrumented`), `No request: the handler ran and issued no request from instrumented code`, `Rejected by the app: handler_threw (TypeError); no request`; a pending episode keeps its live progress label. `outcome.sentence` is the full sentence (with the scoped-absence tail where one applies).
- `outcomeText(outcome)` renders the bracket: `failed 409`, `responded 200; no effect evidence`, `completed 201`, `stopped at network` (the frontier's `because` follows in the line's tail), `no_request; the handler ran and issued no request from instrumented code (…)`, `rejected_client_side; handler_threw (TypeError)`, `pending`.

Runtime evidence added for the signals (additive fields, present only when true, so pages without them emit byte-identical rows):
- `function.exit` gains `threw: true, error_type: "<constructor name>"` (never the message) when the frame's body threw. The build transform adds `catch(e){__productTraceRuntime.threw(frame,e);throw e}` to each instrumented function's existing `try … finally`; the rethrow keeps the app's control flow unchanged.
- `action.uncaught_error` `{ action_id, via: "uncaught_exception" | "unhandled_rejection", error_type, function_id, continuation_id }`: emitted once per error object when the page's own `error` / `unhandledrejection` event carries an object that an action-owned first-party frame threw (joined by object identity, never by time). An error that the app catches never produces it.
- `dom.action` gains `form_invalid: true` when the dispatch is submit-capable and its form matches `:invalid` at dispatch (a CSS match: no `invalid` events are fired, nothing in the app changes).

*Amendment (2026-09-24, `fix/outcome-labels` after the independent grade; supersedes the matching rules of the amendment above where they differ).*

- **One label per episode, on every surface.** An action's outcome is the outcome of its episode (`episodeForAction`: the evidence-derived episode, else a standalone single-action episode; one rule shared by the store and the export). `buildActionChains` builds that episode with `buildEpisodeChain` (idle, the same `registeredFunctionIds` and `backendInstrumented`) and exports its `outcome`, so an `action_id` never carries two statuses. Non-carrier members (focus, keystrokes) carry the episode's status, as the MCP gives them; a member-specific label is left to `fix/episode-focus`.
- **Which request decides.** The credited request is the engine's: the latest request of the episode with a joined database write, else the last request (dispatch order). It decides the headline status and `http_status`. Every other request of the episode whose own status differs, and every other failure, is stated as `also <status> <http> <METHOD> <path>` (grouped with `×n`) in `outcome.label`, `outcome.sentence`, `chain.display.label`, `chain.terminal.label`, the export, and the `[outcome …]` bracket, and listed in `outcome.other_requests`. Example: `Completed 201: insert items; also failed 500 POST /api/reports`. Rationale: the headline answers "did the action's effect happen", and no other response is hidden.
- **HTTP semantics for `completed`** (generic, RFC 9110 safe methods): a safe method (`GET`, `HEAD`, `OPTIONS`, `TRACE`) answered 2xx, or 304, is `completed` when any database span (a read is the terminal join) joined under it, else `responded` ("no effect evidence"). An unsafe method (`POST`, `PUT`, `PATCH`, `DELETE`, anything else) answered 2xx is `completed` only with a joined **write** span; reads only give `responded` with `note: "no write observed"`, none gives `responded` ("no effect evidence"). Any other 3xx, and any 3xx on an unsafe method, is `responded` with `note: "redirect or not-modified status on this method; completion not claimed"`. ≥ 400 is `failed`. Request segments use the same rule.
- **`form_validation` only when the browser validated.** `dom.action.form_invalid` is recorded only for a click on a submit button (or Enter in a text field of a form with a default button) of a form without `novalidate`, whose submitter has no `formnovalidate`, and whose form matches `:invalid`; never on a `submit` dispatch (a submit fires only after validation passed or was bypassed). Analysis also ignores a `form_invalid` dispatch followed by a submit on the same form. The engine's rejected-submit rule now needs a mutation receipt of **the submit's own action** (a later focus onto an invalid field, or typing, is not the app's answer).
- **"also" next to a response** lists crash signals only (`handler_threw`, `promise_rejected`), deduplicated; `form_validation` never appears next to a response.
- **`compare_chains`**: `outcome_delta.changed` ⊆ `status, reason, stage, http_status, stop_reason, stopped_at, reached, writes`. A label change is an outcome change, so "outcome unchanged" is never printed when the statuses differ. On the G6 pairs the status differs only where `path_changed` was already true; no verdict moves.

*Amendment (2026-09-24, `fix/outcome-labels` regrade): the same-form reject rule abstains without validation feedback.* A request-less submit is a rejected submit (`submit.rejected`, `stopped_at: "validation"`, `rejected_client_side; form_validation`) only when **the submit's own** mutation receipt on the same form shows validation feedback: `validation.feedback_mutations > 0` (an alert, status or aria-live change), `validation.aria_invalid_changed`, or `validation.focus_moved_to_invalid_field`. A bare same-form change is otherwise `no_request` with `stopped_at: "browser"`. Examples are a "Saving…" state before a silent early return, or a next step rendered inside the form. The reason is abstain over guess: the receipt already records what a validation answer looks like, and anything less is a guess. Consequence: G6 scenario E (a silent early return, 23 actions in one episode) moves from `stopped at validation` to `stopped at browser` / `no_request`. See G6 §12. The `compare_chains` summary renders a missing outcome field as `null`, never `undefined`.

*Amendment (2026-09-24, `fix/episode-focus`; G5 §16).* Vocabulary for episode members and caused focuses. All fields are additive and absent for carriers and standalone gestures, which answer as before.
- **Member chain.** `action_chain`, each `element_history.actions[]` entry, each `recent_actions.actions[]` entry and `compare_chains` (its `before`/`after` stops, outcome and summary) for a non-carrier member of an episode describe only that member's own evidence (its own rows through `buildEpisodeChain`): `stops`, `requests`, `segments`, `outcome`, `reached`/`stopped_at`/`because` and `chain` never carry the carrier's request, route, handler or DB stops. They add `episode_member: true`, `episode_carrier_action_id` (the episode chain's carrier, as before) and `episode_pointer`: `"this action is part of episode <episode_id>; its request is attributed to the carrier action <carrier_action_id>"` (`"its evidence is attributed"` when the episode chain has no request). The rendered line ends with `; <episode_pointer>`. `episode_id` and `episode_action_ids` still name the whole episode; `chain.evidence_action_ids` is `[action_id]`. To read the episode's effect, call `action_chain` with `episode_carrier_action_id`.
- **Member outcome label (after the rebase onto `fix/outcome-labels`, 2026-09-24).** A member's `outcome` is `actionOutcome` over its own steps (the one label function), so it is usually `no_request` (or `stopped` when its own chain stops at `entry_handler`), and `outcome.sentence` ends with `; <episode_pointer>` (`outcome.episode_pointer` holds it). The exported action chain (`buildActionChains`) builds the same member view: `outcome` as above plus `episode_member`, `episode_id`, `episode_carrier_action_id`, `episode_pointer`. Carriers and standalone actions keep their episode outcome. The episode surfaces (an `element_history` attempt, the live viewer's card) say the episode's, i.e. the carrier's, status.
- **`element_history.attempts`** are unchanged: grouped by episode, each with the episode's chain (as seen from its newest listed action).
- **Caused focus.** A `dom.action` with `gesture: false` is outside every episode: `action_chain` returns its own single-action chain (`standalone: true`) plus `gesture: false`, `caused_by_action_id` (or `null` with `cause_abstained`), `caused_by_episode_id`, `caused_via` and `caused_pointer` (`"this focus was caused by action <id>'s work (<via>), not by a user gesture; it is listed under episode <episode_id>"`, or `"this focus was dispatched while app code ran (cause abstained: <reason>), not by a user gesture"`), also appended to the rendered line. The causing action's chain lists it under `caused`. With the cause abstained the sentence is `"focus caused by app code committed from React's scheduler; causing action not attributable"` (`cause_abstained: "scheduler_lineage"`); the focus is still listed by `recent_actions`.
- **`element_history` and caused focuses.** A `gesture: false` action never counts toward `n` and never forms an attempt. It appears in `actions` (with its pointer) when its causing action's episode is a kept attempt (that attempt then carries `caused: [{action_id, event, caused_by_action_id, gesture: false}]`), when it is no older than the oldest kept user action, or always on a key with no user action in scope; then the summary reads `0 attempts on element <where>; N caused focus(es) (not user gestures); newest: <line>`, never `no actions`. When caused focuses are listed beside attempts, `; N caused focus(es) (not user gestures)` follows the attempt count. The `newest:` line is the newest user action's episode view (as for `attempts`), so it is unchanged from before this amendment for every banked store.

*Amendment (2026-09-24, `fix/mcp-gaps`: "the MCP says everything the records already know about an action's work and its surroundings").* Rendering and one new read-only tool; no join or credit rule changed. `stops`, `reached`, `stopped_at`, `because`, `outcome`, `chain` and the first summary line of `action_chain`, `element_history`, `recent_actions` and `compare_chains` are unchanged on the banked stores (the `resolve_element` summary now names the top candidate's key, its score and `best`) (evidence: `docs/evidence/pr-mcp-gaps-2026-09-24/RUN.md`). Added:

- **`work` (owned work).** `action_chain` gains `work` and prints a `Work (...)` block after the chain line (before the unlinked block). `element_history.actions[]` and `.attempts[]` gain `work_summary` (the same text). `work` = `{ rule, depth_limit: 4, frames_entered, frames_total, omitted_deeper, non_first_party_frames, entries, entries_total }`. Entries are pre-order, capped at 100 in JSON (requests and the frames leading to them are kept first). Each entry is either:
  - `{ type: "frame", depth, function_id, name, label, calls, first_sequence, action_id, via, invoked_by, parent, after_response?, after_request? }`;
  - `{ type: "request", depth, index, method, path, query, outcome, http_status, third_party, issued_by, below_depth_limit?, parent }`.

  How entries are built:
  - Frames come from the episode's `function.enter` rows (the runtime writes only action-owned frames). They are grouped by call path (the row's `spine.function_ids`, consecutive repeats collapsed) and restricted to first-party ids (manifest-registered; every id without a manifest).
  - `calls` counts enter rows, except the body's own enter nested directly under the call-site proxy's enter of the same function (spine ends `[id, id]`, entered on a `function` continuation): one call entered twice counts once.
  - `via` is the kind of continuation the frame was entered on (`call`, `dispatch`, `promise`, `await`, `timer`, `microtask`, …), parsed from `parent_continuation_id`.
  - Each attributed request (a segment) hangs off the frame whose spine equals the request's spine (else its nearest recorded ancestor, else the top level). Requests below the depth limit are kept at the limit with `below_depth_limit: true` and their `issued_by` label.
  - `after_response: { requests, http_status, basis }` marks a frame entered on a `promise`/`await` continuation whose lineage (spine without its last id) is a prefix of an earlier request's spine, and whose enter timestamp is at or after that request's server span `end_time`. The function ids attach the lineage; timestamps only order it after the response. Without a server span end, the mark is `after_request`.
  - The block prints at most 12 named frames (frames on the path to requests and `after_*` frames first), every request line (up to 10), then `+N more frame path(s)`. An `after_response` frame renders as `after response 409: <anonymous> file:line (promise continuation)`, with its children indented below it.
- **Unlinked entries carry what their spans show.**
  - An unlinked request gains `server` (`describeServerSpan` of its own server span, found by the one exact join: `attachBackendSpans` under a placeholder action id, never the action), `server_join` (`exact_parent`, `no_exact_parent_server`, `multiple_exact_parent_servers`, `no_trace_context` or `backend_not_instrumented`), and `issuer` when the row has one.
  - An unlinked server span gains `end_ms`, `handler_spans: [{span_id, name, index, start_ms}]` and `db_ops: [{span_id, operation, collection, write, start_ms}]` by `serverSpanDescendants`, the same parentage rules as `attachBackendSpans`.
  - The lines read `- request GET /api/audit?flag=on (fetch, sequence 141, no action_id) → route /api/audit 200 → server auditHandler → db insert audits [unlinked]; issued by …; attribution: none (…)` and `- server span POST /api/sync 204 → server syncHandler → db update syncs (span …, no request with its parent span id) [unlinked]; attribution: none (…)`.
- **Query strings.** From this runtime on, `network.request.url` is the URL as sent minus the fragment (path + query, recorded as-is: a dev tool; do not ship query secrets to a dev store). Older rows hold the path only. Segments and request stops gain `query` (`?a=1` or null) and summaries print path + query. `compare_chains` still keys and compares requests by path only (id-normalised), so a query-only change is not a path change.
- **`issuer` on unattributed request rows** (runtime; never an attribution): `{ function_ids, task }`.
  - `function_ids`: the first-party frames on the stack at send time, outermost first; `[]` = uninstrumented code.
  - `task`: when the request ran in a timer or animation-frame callback armed outside every action, `{ api: "setInterval" | "setTimeout" | "requestAnimationFrame", armed_sequence, armed_by }`. `armed_sequence` is the page's last sequence at arming; `armed_by` holds the frames that armed it. Promise and microtask callbacks created inside such a task inherit its `task` at creation.
- **`resolve_element` by raw evidence.**
  - At most 5 `candidates` (was 10), each with `score`. `candidates_total` is unchanged in meaning. Candidate `keys[]` gain `component`, and stamp-only candidates carry `stamp_only: true`.
  - Ranking adds the stamp rows' `content_sig`: the runtime's FNV-1a of `aria-label=`/`title=`/`name=`/`data-testid=` + value, else `tag:` + 64 chars of text, recomputed from the supplied `name` or `nearby_text` and compared by string equality. A name hit scores +6 and a nearby-text hit +2. A key none of whose stamp rows shows the supplied name is marked `mismatched` (-2).
  - Implicit ARIA roles count like explicit ones (+2): `<button>` = `button`, `<a href>` = `link`, `<input type=text>` = `textbox`, …. A different implicit role is `mismatched` (-2).
  - Stamped keys that no action touched are candidates too, with 0 `actions_observed`.
  - New field `best`: `{ element_key, keys, target, score, matched_on, basis }`, or null. It is set only when exactly one candidate matches the supplied name (and the role, when a role is given). `status` and `confidence` stay `"ambiguous"`; raw evidence never yields `exact` (§2.2).
- **New tool `page_requests`** (read-only). It lists every non-internal `network.request` on a page (`session`) and/or in a browser-clock window (`since`/`until`, epoch ms). It can filter by `path` (a literal prefix of the URL path) and by `attribution` (`any`, `action` or `none`). The validator now enforces `enum`.
  - Output: `{ window, counts: {total, attributed, unattributed}, endpoints, requests (the most recent n, oldest first), requests_total, server_spans_without_request? }`.
  - `endpoints[]` has one entry per `METHOD path`: `count`, `attributed`, `unattributed`, `statuses`, first and last timestamp, `sessions`, and `interval_ms {median, min, max, samples}` between consecutive requests on one page.
  - Each request: `{ session, sequence, timestamp, method, url, path, query, transport, request_occurrence_id, trace_id, attribution, route, http_status, handler_spans, db_ops, outcome, summary }`.
    - An attributed request's `attribution` is `{kind: "action", action_id, episode_id, event, segment_index, text}`, and its route, handlers and DB come from its own segment.
    - An unattributed request's `attribution` is `{kind: "none", action_id: null, runtime_reason, issuer, text, note}`, where `text` is `none: no user action; issued by <label> from a setInterval timer armed at page load (before the first user action on this page), armed by <label>`. "At page load" means `armed_sequence` is before the page's first `dom.action`. Without a task the text reads `…; not inside a timer or frame callback armed outside an action (task origin not recorded)`. Rows without `issuer` read `issuer not recorded (runtime before 2026-09-24)`. Its server span comes from the same exact join as unlinked requests.
  - `server_spans_without_request` (when the store has spans and a window is known) lists server spans starting in the window whose trace context matches no recorded browser request. It holds at most 20, plus `total`; it is listed, never joined, and not page-scoped.

  Schema:
```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "session": {
      "type": "string",
      "minLength": 1,
      "maxLength": 128,
      "pattern": "^[\\x21-\\x7E]+$",
      "description": "capture_page_id: only requests recorded on this page load."
    },
    "since": {
      "type": "integer",
      "minimum": 0,
      "maximum": 100000000000000,
      "description": "Epoch milliseconds (browser clock): only requests recorded at or after this time."
    },
    "until": {
      "type": "integer",
      "minimum": 0,
      "maximum": 100000000000000,
      "description": "Epoch milliseconds (browser clock): only requests recorded at or before this time."
    },
    "path": {
      "type": "string",
      "minLength": 1,
      "maxLength": 512,
      "pattern": "^/[\\x21-\\x7E]*$",
      "description": "Only requests whose URL path starts with this literal prefix (e.g. /api/status)."
    },
    "attribution": {
      "type": "string",
      "enum": [
        "any",
        "action",
        "none"
      ],
      "default": "any",
      "description": "action: only requests attributed to a user action; none: only requests no action owns (polls, page-load fetches, uninstrumented scripts)."
    },
    "n": {
      "type": "integer",
      "minimum": 1,
      "maximum": 500,
      "default": 100,
      "description": "Most recent n requests listed (groups count every match)."
    }
  }
}
```

*Amendment (2026-09-24, `fix/mcp-gaps` after its grade, `docs/evidence/pr-mcp-gaps-2026-09-24/GRADE.md`; supersedes the matching bullets above).*

- **"after response N" is an identifier.**
  - **What the runtime records.** Two new fields on `function.enter`, and continuations carry the first:
    - `response_of`: the `request_occurrence_id` whose response this code runs after. It is recorded at creation time, never as an owner. It is set when a frame runs on one of these:
      - a reaction (`then`/`catch`/`finally`) on the promise the runtime's `fetch` wrapper returned, or on any promise derived from it by those methods;
      - the resumption of an `await` on such a promise;
      - a `load`/`loadend`/`readystatechange`/`error`/`abort`/`timeout` listener added with `addEventListener` on the `XMLHttpRequest` that sent the request.

      Frames and continuations created inside such a frame inherit it.
    - `entry`: see "Calls" below.
  - **What the MCP renders.** For stores whose rows carry `entry` (runtimes from this change), `work.entries[].after_response` (`basis: "response_of: …"`) is set only when the frame's `response_of` equals a segment's `request_occurrence_id`. Any other continuation, for example a sibling `wait(250).then(fn)` in the same handler, gets no mark, even when it runs later.
  - **Not recorded, so never marked:**
    - reactions on a promise the page builds itself around the response (`new Promise(r => fetch(u).then(r))` hands the outer promise no origin);
    - `xhr.onload =` property handlers;
    - requests sent through the request bridge;
    - code resumed from an `await` on a non-derived promise, unless its frame already carried the origin.
  - **Older stores** (no `entry` field) keep only an order. The mark is `ordered_after_response` / `ordered_after_request`, rendered `ordered after the response 409; not linked: <fn>`, with `basis` naming the clock comparison.
  - **Where that clock order is wrong** (the grader's probes):
    - server clock behind the browser: a continuation that ran before the response can read "ordered after the response";
    - server clock ahead: the true after-response frame loses the mark;
    - any skew: an unrelated promise/await continuation of the same lineage that happens to run later (e.g. a timer-based promise) qualifies. Only the identifier path excludes it.
- **Calls.** `function.enter.entry` says which instrumentation entered. One call can write up to three enters, nested in this order:
  - `call`: the call-site proxy;
  - `chunk`: the chunk pass's frame of a leaf body. The build now passes `pass: "chunk"` in that frame's `enter` metadata;
  - `body`: the module pass's frame.

  An enter nested directly under an earlier-ranked enter of the same function is the same call. Anything else is a call, including recursion. `work.entries[]` gains `enter_rows` and `recursive: true`, rendered `factorial file:line ×5 (recursive)`. For rows without `entry`, a run of three or more of the id sets `calls_exact: false`, rendered `fact file:line (10 enter rows; repeated or recursive calls are not separable)`.
- **Issuer.**
  - An empty `function_ids` renders `no first-party frame recorded for this request (issued outside any action)`, never "uninstrumented code".
  - `function_ids` and `armed_by` collapse consecutive repeats before labelling, so a frame is never "called from" itself.
  - The runtime's `await` rewrite now keeps, outside an action, the action-less first-party frame and the unowned task origin across the resumption. Neither is ownable. So a page-load poll that awaits before fetching is named: `issued by refreshAfterTick file:line from a setInterval timer armed at page load`.
- **Privacy.**
  - Query strings are recorded and printed as sent, tokens included: OAuth codes, signed URLs and `?token=` values reach `records.jsonl` and every tool that prints a request. Nothing redacts them.
  - The request bridge (`analysis/browser-request-bridge.mjs`) and worker script URLs still strip the query, so the two capture paths disagree. Only the runtime's own wrappers keep it.

*Amendment (2026-09-24, `fix/mcp-gaps` regrade).* Nested awaits are covered. In `await (await fetch(u)).json()`, which bundlers also emit from `const r = await fetch(u); await r.json();` when `r` is used once, the two awaits share one rewrite slot, and the outer await captured its frame before the inner one resumed. The outer `awaitLeave` now carries the resumed frame's `response_of` into its own resumption (`w.carry`). Ownership capture is unchanged. So code after the outer await (`bodyLoaded()`) renders `after response 200:` (fixture W12/W13).

*Amendment (2026-09-24, `fix/mcp-gaps` rebased onto `fix/outcome-labels` + `fix/episode-focus`).*
- **One label function.** `page_requests` labels each unattributed request with `actionOutcome` over that request's own exact joins (`joinRequestServer` now also returns the joined `steps`). Attributed requests carry their segment's label. `outcome` is the status, and `outcome_text` / summaries use `outcomeText`. Segments and work request lines add `outcome_text`.
- **Members.** A non-carrier member's `work` (and `work_summary`) lists only its own frames: its chain's scope, the same rows its segments use. `element_history.attempts[].work_summary` is the episode view's.
- **No token on action-less resumptions.** The action-less `await` resumption kept for issuers carries no run token (`run: null`), so it can never mark a focus as caused (`cause_abstained`).

### 3.2 `compare_chains` stop alignment (by kind, never by time)
- `entry_handler`: same `function_id` → `same`. A pure source move → `changed`, `change_kind: "source_revision"`: same file and event, the file's content hash differs (the file was edited between builds, so the span may have moved), and the stamped component agrees when both sides have one. Anything else → `changed`, `change_kind: "different_handler"`, including two different functions in one unchanged file (same content hash). A handler credited on only one side → `added` / `removed`. (Remapping a function id through the other build's manifest is not possible with one store and one manifest; with before/after builds in one store, that remap is the stronger test and should replace the content-hash rule.)
- `request`: key and comparison `METHOD` + browser path with id-shaped segments replaced by `:id`; every other segment literal. Id-shaped (generic, no product list): 24-hex, UUID, 8+ hex, all digits, or a prefixed id `<lowercase word>_<8+ of [A-Za-z0-9_-]>` whose suffix contains a digit or an uppercase letter (e.g. `agent_YAQ8Y1HJYBF3MirpqmkeZ`, `thread_abc123DEF456`); the digit/uppercase requirement keeps snake_case words such as `web_search` or `effective_all_items` literal. Value `METHOD concrete-path`. Only id-shaped segments differ → `changed`, `change_kind: "parameters_only"`; otherwise `different_value`.
- `route`: value `METHOD route status`. `handler`: key `route#index`, value handler name. `db`: key `operation collection`; present in both → `same` (counts in `detail`), else `added` / `removed`.
- `outcome_delta.changed` ⊆ `stage, http_status, stop_reason, stopped_at, reached, writes`. `reached` was added on 2026-09-24: request-less chains all stop at `browser`, and `reached` is what still tells `dom_mutation`, `entry_handler` and `dispatch` apart. `outcome` carries `reached`.
- `path_changed` is true iff any stop, including `entry_handler`, is not `same` (excluding `change_kind` `parameters_only` and `source_revision`), or the outcome delta is non-empty. `path_change_reasons` lists the stop kinds (`entry_handler`, `request`, `route`, `handler`, `db`) and `outcome` that set it. A different credited handler with identical backend stops is therefore a path change (reason `entry_handler`): a fix that rebinds an element to another handler is visible even in a frontend-only store. A pure source move alone does not set it, which is what lets G6's no-op refactor report "no change" while still showing the source moved.
- Not shown as stops, by design: database spans under Express middleware spans (e.g. auth, ban and access checks) rather than under a registered handler span. They are all reads in final7 (36 spans across 8 of 9 flows); the handler-descendant rule keeps them out, so write sets are unaffected. This under-reports reads; it never invents a stop.

*Amendment (2026-09-24, `fix/middleware-reads`: "every database operation in a request's server trace is attributed to that request and named by the server code that issued it"; supersedes the bullet above and the handler-descendant database rule everywhere in this document).*
- **Which operations belong to a request.** Every database span under the admitted server span, by exact trace id and parent ancestry (`serverSubtree` in `analysis/runtime-attribution.mjs`, used by `attachBackendSpans` and `serverSpanDescendants`), not only those under a registered handler span. Reads in auth middleware, `router.param` callbacks and error middleware are the request's. Spans of another trace are never included. A database span whose ancestry does not reach the server span (a parent span missing from the store) is not included (see residuals in `docs/evidence/pr-middleware-reads-2026-09-24/RUN.md`).
- **Issuer.** Each `db.operation` step, segment `db_ops[]` entry, `stops[]` db stop, unlinked `server.db_ops[]` entry and exported `requests[].db_ops[]` entry carries `issuer: {kind, name, span_id}` and `issued_by` text: the nearest ancestor span (below the server span) that names server code. `handler` is Tracer's route-callback span (`producttrace.express.handler.name`); `param` and `error_handler` are Tracer's new `router.param` and four-argument `use` error-middleware spans (`producttrace.express.handler.kind` `param` / `error_middleware`; the official Express instrumentation does not wrap either); `middleware` (`express.name`), `route` (a request-handler layer, `http.route`) and `router` come from the official Express layer spans. None: `{kind: "unknown"}`, printed `issuer: unknown`, never dropped. Text: `find users (middleware: authenticate)`, `update tasks (handler: renameTask)`, `aggregate incidents (error handler: reportError)`. Summaries group by operation, collection and issuer: `find items ×3 (handler: listItems)`. Param and error-middleware spans are issuers, never `handler.enter` steps.
- **`completed` reads the whole trace.** The HTTP rule is unchanged (§ outcome-labels amendments) but counts every operation under the server span: a read-only middleware plus a handler write is `completed`; a middleware write with a read-only handler is `completed` too. The operation a label or frontier names is the last write, else the last read, preferring those issued by a route handler (middleware and param reads are its preconditions), in row order. The label names the issuer unless it is a route handler (`Completed 200: insert activity (middleware: recordActivity)`; `Completed 200: update tasks`); the outcome `sentence`, the frontier `because` and the new `outcome.effect` always name it.
- **Code that ended the request.** The backend now marks the span active when the response head is written (`producttrace.response.status_code`, set in `ServerResponse.prototype.writeHead` on the span of the async context). `route.dispatch` rows carry `responded_by: {kind, name, span_id, text, status_code, writer_span_id}` when exactly one span in the server subtree carries the mark (else null: older backends, or ambiguous). When it names a `middleware`, `param` or `error_handler`, that code is the request's terminal handler: `stopped_at: "middleware"` (new value), `stop_reason: "ended_by_middleware"`, `because: "server responded 401 from middleware authenticate; no handler ran"` (or `…; after handler explodeProject`), and the segment summary tail adds `stopped at middleware authenticate (401); no handler ran`. `reached` gains `middleware` for such a request with no database operation. The outcome is the HTTP one (`failed 401`). Exported chains use the same rule per request.
- **Deferred.** Unchanged rule (an operation starting ≥ 1 ms after the server span ended), now over every operation; `deferred.spans[]` db entries add `issued_by`.
- **`compare_chains`.** A db stop is keyed by operation, collection and issuer (`find users (middleware: requireJwtAuth)`), counts in `detail`: the full operation list is compared, so an operation that appears, disappears or moves to other server code is a change. Consequences on final7 (grader expectation amended in `test/g4-grader.mjs`, banked evidence unchanged): send vs agent-chat adds `find agents (middleware: buildEndpointOption)` and `find systemgrants (middleware: <anonymous>)`; the two regenerates now differ (`find conversations (middleware: validateConvoAccess)` only in the first), so their `path_changed` is `true`; send vs rename shows the conversations write moving from `handler: controller` to `handler: <anonymous>`.
- **One segment builder.** `requestSegmentCore(steps)` in `analysis/causal-chain.mjs` computes route, handler spans, `db_ops` with issuers, `responded_by`, `deferred`, the frontier and the label from one request's own joined steps; the MCP's segments are built on it; the live viewer's chain and exported action chains carry the same issuer fields from the same rows.
- **Grader.** `test/g4-grader.mjs` recomputes database spans under the server span and the issuer from raw attributes (it imports no package code); 81/81 on final7 with the regenerate pair's expectation changed to `path_changed: true` for the reason above.

*Amendment (2026-09-24, `fix/middleware-reads` after the independent grade, `docs/evidence/pr-middleware-reads-2026-09-24/GRADE.md` and `RUN-2.md`; supersedes the matching bullets above).*
- **Ruling (coordinator, 2026-09-24): middleware reads are preconditions, not effects.** Reads issued by app-level middleware (`middleware`), `router.param` callbacks (`param`) and routers are a request's preconditions. A safe-method request is `completed` only when a database operation other than a precondition exists: one issued by the route's handler (Tracer's handler spans, which include middleware registered on the route itself, e.g. `router.get(path, requireOwner, show)`), by an error middleware, by an app span, by unknown code, or by the code that wrote the response (`responded_by`). When its only database work is preconditions it is `responded`, `note: "no database work after the preconditions"`, label `Responded 200: no database work after the preconditions (find users by middleware requireJwtAuth)`, and the frontier claims no terminal effect: `stopped_at: "handler"` (or `"route"` without a handler span), `stop_reason: "preconditions_only"`, `because` = the same sentence. The unsafe-method rule is unchanged: a write by anyone (a middleware write included, named) completes; reads only give `responded` "no write observed", and the frontier for precondition-only reads is the same `preconditions_only` stop. The headline operation is the last write, else the last non-precondition read, preferring the route handler's. Exported chains use the same rule.
- **Never dropped (app spans).** `backend/register.js` ships every span of a trace that holds an incoming server span. Server, Express layer, Tracer handler and database spans ship in full; any other span ships as a skeleton: ids, parent, name, kind, times, scope, and one attribute, `producttrace.span.skeleton: true`. Server traces are learnt at span start (bounded, 20,000 trace ids); traces without a server span (background jobs) ship nothing extra. The issuer walk passes through such app spans to the naming code: `aggregate $cmd (handler: projectStats (in app span loadStats))`, `issuer.via_app_spans`. With no naming code above, the nearest app span is the issuer (`app span: <name>`).
- **Never dropped (broken ancestry).** A database span of the request's trace whose ancestry leaves the store (backends or SDKs that do not ship the parent) is listed on that trace's only server span as `issuer: unknown (parent <id> not recorded)`, with `ancestry_broken_at` on the row. If the trace holds more than one server span it cannot be placed and is not listed (abstain).
- **One builder, precisely.** Database operations with issuers, `responded_by` and `deferred` come from `requestSegmentCore` on every surface: MCP segments, the live viewer's chain (the same joined rows) and exported `requests[]` (which now also carry `deferred`). The frontier `stopped_at` values and the outcome label come from the one frontier and label functions (`chainFrontier`, `actionOutcome`) on MCP and viewer, and the export's `outcome` is `actionOutcome` too. The export's per-request `stopped_at` / `because` keep the export's own G1 wording (`server` / "no handler span under server span", "no db span under handler"); the middleware and precondition rules apply there too, through the shared `terminalMiddleware` and `preconditionsOnly`. The grader's `/health` `because` difference is this wording and predates this branch.
- **Tripwire.** `test/backend-register.test.mjs` asserts, on Express 5 (esm and cjs fixture apps) and on Express 4 (devDependency alias `express4`), a named `express.type: middleware` span with the database read under it, so an instrumentation upgrade that loses middleware spans fails the suite instead of degrading issuers to `issuer: unknown`.

### 3.3 Request and response bodies (amendment 2026-09-24, `fix/body-capture`; revised after the independent grade)

Claim: in a dev build Tracer records request and response bodies, bounded and redacted, so an agent can answer which entity an action acted on. Rendering only: no join, credit, episode or frontier rule reads a body. Stores without `network.body` rows answer exactly as before, except for the added `null` fields below. With bodies on, the app behaves as without Tracer, with two observable differences stated here plainly:
- **Page output, rejections, connections.** The page output is the same, `unhandledrejection` events are the same, and connection lifetimes are the same when the app cancels a stream, aborts or errors a `pipeTo` destination, or breaks an async iteration. Probes: O2, F1, T1, P1 and P2 in `test/browser/body-capture.mjs`.
- **(a) Connection lifetime.** No exception is known. Residual paths that are not observed:
  - a JSON response of unknown length that the app *abandons* without cancelling is still read by Tracer up to 1 MiB (without Tracer the stream would only backpressure);
  - a `pipeTo` called with `preventCancel: true`, where the source is deliberately not cancelled and Tracer's read ends at its cap;
  - a body the app stops reading through a mechanism other than `cancel`, a reader's `cancel`, `pipeTo`/`pipeThrough` or an async-iterator `return`.
- **(b) Microtask order on the rejection path.** The app's fetch promise is derived from Tracer's reaction, so a *rejection* reaction runs one microtask later than without Tracer. Probe P6: `controller.abort()`, then `p.catch(fetch-rejected)`, an abort-listener microtask and `Promise.resolve().then(b)` queued right after `abort()`. The order goes from `listener-micro, fetch-rejected, b` to `listener-micro, b, fetch-rejected`. An app whose output depends on that order sees the difference. On the fulfilment path no order change was found (P5: fetch vs a queued microtask, a reaction registered after settlement, two reactions on one fetch).
- **Detectability.** A page can still tell the stream prototype methods are wrapped by their `toString`. Their `name` and `length` are native, and `[Symbol.asyncIterator] === values` holds (P4).

**Row schema.** Kind `network.body`, schema `producttrace.runtime-evidence.v1`, emitted by the page runtime, unsequenced:
`{ kind: "network.body", body_sequence, timestamp, session, capture_page_id (added by the sink), request_occurrence_id, transport: "fetch" | "xhr", direction: "request" | "response", content_type, bytes, bytes_read?, bytes_basis?, truncated, captured, reason?, format?: "json" | "text", json?, text?, redactions, status? (response) }`.
- **Linkage.** A row links to its `network.request` only by `(page, request_occurrence_id)`. It has no `action_id` and no `sequence`: it has its own contiguous `body_sequence`, like `element.stamp`'s `stamp_sequence`. So no index keyed on `action_id` or `sequence` sees it.
- **Timing.** The request body row is emitted when the request is sent, so it belongs to the request the creation-time rule already owns. The response row is emitted when Tracer's read ends.
- **`captured: true`.**
  - `format: "json"` carries `json`, the redacted value. When the redacted serialization exceeds 4096 UTF-8 bytes, it carries `text` instead: the first 4096 bytes, with `truncated: true`. The serialized text is cut, never the structure.
  - `format: "text"` carries `text`, cut to 4096 bytes on a character boundary, with `truncated: true` when cut.
- **`bytes` is the full size when known, else `null`.**
  - For a completely read body it is the bytes read. For a request string it is its UTF-8 length.
  - A `content-length` is used only when no `content-encoding` other than `identity` is present.
  - When Tracer stopped reading before the end, `bytes` is `null` and `bytes_read` gives the bytes read so far.
  - `bytes_basis` marks the other bases: `parts` (FormData: the sum of the parts, not the wire size), `reserialized` (XHR `responseType: "json"`), `utf8_of_text` (XHR text: the UTF-8 length of `responseText`).
- **`captured: false`** comes with `reason`, and `bytes` where known. The reasons:
  - `unknown_type`: no content type was declared. The body is never read.
  - `binary`: any other non-text, non-JSON type.
  - `streaming`: `text/event-stream`, `application/(x-)ndjson`, `application/(x-)jsonl(ines)`, `application/json-seq`, `application/stream+json`, or a `ReadableStream` passed as `init.body`. Never read. A `ReadableStream` inside a `Request` object cannot be told apart from any other `Request` body (`Request.body` is always a stream): with a JSON or `text/*` content type it **is** read (teed, capped at 1 MiB); with no type or another type it is never read (`unknown_type` / `binary` / …).
  - `form` (urlencoded) and `form_data` (multipart).
  - `blob` and `document`.
  - `opaque_response`.
  - `over_parse_limit`: a JSON or text body over 1 MiB.
  - `unparseable_json`: declared JSON that does not parse. It is not recorded, so it cannot leak unredacted.
  - `unredactable_prefix`: a JSON-looking prefix of an unknown-length text stream. It cannot be parsed, so it is not recorded.
  - `cancelled_by_app`: the app cancelled its branch before Tracer's read ended.
  - `read_failed`, `redaction_failed`, `unsupported_body_type`.
- **No content, no row.** 101, 103, 204, 205 and 304 responses, HEAD responses, and requests without a body produce no row. Empty XHR responses produce no row either.

**Capture rules (runtime, `src/runtime-attribution-browser.js`).**
- **When.** On only when `__PRODUCTTRACE_BODIES__ === "on"`. The Vite plugin's settings script sets it; unset means off. Only for requests the runtime's own wrappers record (`transport_rows: "runtime"`), never for Tracer's internal requests.
- **Read only what the declared type qualifies.** JSON (`application/json`, `application/*+json`) and `text/*` are read; nothing else is.
  - Text that parses as a JSON object or array is treated as JSON, so a `JSON.stringify` body sent as `text/plain` is key-redacted.
  - A string request body with no declared type is recorded as `text/plain;charset=UTF-8`, which is what fetch and XHR send.
  - A `Request` object's body is read only when its declared type is JSON or `text/*`. It is cloned before the native fetch reads it and read through a reader capped at 1 MiB.
  - A typeless `Blob`/`ArrayBuffer` `Request` body is `unknown_type` with `bytes: null`: it is never read, and no type is invented.
- **fetch responses.**
  - The app receives the promise derived from Tracer's fulfilment-only reaction on the native fetch promise. That reaction clones the response before any app reaction runs. A rejection passes through the derived promise unhandled, so `unhandledrejection` and console errors are exactly as without Tracer.
  - Cost: one extra microtask tick before the app's reactions. D12 (A = D byte-identical) and continuations-neutral show no attribution change.
  - The clone is read with the native `Promise.prototype.then` through its own reader: to completion, capped at 1 MiB. For `text/*` of unknown length (no usable `content-length`), only the first 4096 bytes are kept and the reader is then cancelled (`truncated: true, bytes: null, bytes_read`).
  - When the app cancels its branch, Tracer cancels its own read at once. The tee then cancels the source exactly when it would have without Tracer. Cancelling covers: `ReadableStream.cancel`, a reader's `cancel`, the return of an async iterator, any of these on a `pipeThrough` output, and a `pipeTo` whose destination aborts (signal) or errors.
  - For a `pipeTo`, the app receives the promise derived from a rejection-only reaction that cancels Tracer's read and rethrows, so an unhandled `pipeTo` rejection stays unhandled. `preventCancel: true` is respected.
  - The wrapped prototype methods keep their native `name` and `length`.
- **XHR.**
  - The request body is read at `send`.
  - The response is read on the request's own `load`, via the native `addEventListener`: `responseText`, or `response` for `responseType: "json"`. `arraybuffer` and `blob` give size only.
- **Redaction, in the page, before the row leaves it, by key segment, never by substring.**
  - Keys are split into lowercase segments at camelCase, snake_case and kebab-case boundaries.
  - A key whose last segment is `id` or `ids` is an identifier and is never redacted: `authorId`, `sessionId`, `cardId`.
  - Booleans and `null` are never redacted.
  - Numbers are redacted only under a strong segment: `password passwd pwd pin otp cvv card ssn secret credential(s) token`. This catches a numeric `pin: 1234`, `otp`, `cvv`, `cardNumber`, `secretAnswer`. Numbers are kept when the key's last segment is a quantity or metadata suffix (`limit(s) count(s) max min length len size ttl expiry expires expiration at ms seconds version type index budget usage total`), so `maxTokenLimit`, `tokenCount`, `tokenBudget` and `passwordLength` stay. Numbers under every other key (ids, limits, `apiKey: 123`) are kept.
  - Otherwise a key is secret when any segment is one of `password passwd pwd secret token auth authorization bearer jwt cookie credential credentials ssn otp pin card cvv`.
  - A key is also secret when it is exactly `session`.
  - A key is also secret when a `key` segment follows `api`, `private`, `secret` or `access` (`apiKey`, `private_key`, `x-api-key`).
  - A key is also secret when a segment ends in `password passwd secret token apikey privatekey secretkey accesskey credential credentials cookie jwt` (`accesstoken`).
  - A secret key's value is replaced by the string `"[redacted]"`, at any depth including inside arrays; an object or array value is replaced whole. `redactions` counts the replacements.
  - `author`, `requiresAuth` (a boolean), `maxTokenLimit` and `tokenCount` (quantities), `scorecard` and `cardinality` stay.
  - Recorded in clear, a documented residual: secrets under other key names, secrets inside string values (a JSON-encoded string, a JWT inside free text), and the content of plain-text bodies.
- **Headers.** None are recorded except `content-type`; `Authorization` and `Cookie` never are.
- **Query strings.** Body rows carry no URL. Query strings are recorded as sent on the `network.request` row (path + query, tokens included, never the fragment; `fix/mcp-gaps`, merged before this branch).

**Coverage rows.**
- `capture.page.bodies` is `on | off | production_off`.
- `capture.summary` adds `bodies`, `bodies_emitted`, `last_body_sequence`, `body_truncations`, `bodies_not_captured`, `bodies_pending` (reads still in flight), `body_redactions` and `body_errors`.
- `capture.received` adds `last_body_sequence`, `body_gaps`, `body_gap_rows` and `duplicate_body_sequences`.
- Coverage is incomplete in any of these cases, each with its own reason:
  - a body gap;
  - a duplicate body sequence;
  - `bodies_emitted` differs from the `network.body` rows received;
  - `bodies_pending > 0` at the last summary (`N body read(s) still in flight at the last capture.summary: their network.body rows were not recorded`).
- The coverage object gains `bodies` and `body_rows: { emitted, truncated, not_captured, pending }`.

**MCP output.**
- **Segments.** Every segment (in `action_chain`, `element_history` and `compare_chains`) gains `body` (the request body) and `response_body`. Each is `null` when no row was recorded. Otherwise it is a summary: `{ direction, content_type, bytes, truncated, captured, reason?, format, status?, redactions, ids, shape: "object" | "array" | "scalar" | "text", fields?, fields_omitted?, fields_partial?, items?, items_at_least?, value?, text_preview? }`.
  - `fields` holds the top-level keys: every id-shaped key (`_id`, `id`, `*Id`, `*_id`) first and always, then others up to 12 keys in total. Scalars appear as recorded (strings over 200 characters are cut with `…`), arrays as `"[n items]"`, objects as `"{n keys}"`.
  - `ids` holds id-shaped keys with scalar values at any object depth up to 4 (not through arrays), as dotted paths (`owner.userId`), at most 20.
  - A truncated JSON body is summarised from its cut text by a prefix parser. Complete top-level values are kept; a container cut short renders `[n+ items]` / `{n+ keys}` and sets `fields_partial` / `items_at_least`.
  - `"[redacted]"` is an ordinary string value everywhere; it is never rendered differently.
- **`action_chain`.** With `include_bodies: true` it adds `json` or `text` (exactly as stored) to each summary. It also returns `bodies`, the page's declared mode (`on | off | production_off`, or `null` for runtimes before body capture).
- **`element_history`.** Actions and attempts show only `{ direction, captured, reason?, truncated, ids }` per body.
- **Summary line.** The segment summary line gains `; request ids k=v, …` and `; response ids k=v, …` (plus ` (truncated body)`) inside its `[…]` tail, only when id-shaped fields exist. A store without body rows renders byte-identically.

**Residuals (see `docs/evidence/pr-body-capture-2026-09-24/RUN-2.md` and `RUN-3.md`).**
- Recorded in clear:
  - key-name redaction misses secrets under other key names and inside string values;
  - plain-text bodies are recorded as sent.
- A JSON response of unknown length is read up to 1 MiB even if the app abandons it without cancelling. It is cancelled at once if the app cancels.
- `pipeTo` with `preventCancel: true` is not treated as a cancellation, since the source is not cancelled without Tracer either. Tracer's read then ends at its cap or at the end of the body.
- The derived fetch promise, and the derived `pipeTo` promise of a watched body, add one microtask tick to the app's reactions. On the fetch rejection path this is observable, per (b) above.
- The wrapped stream prototype methods are detectable by `toString`.

### 3.4 Client aborts (amendment 2026-09-24, `fix/client-aborts`)

Claim: a request the page aborted is labelled as aborted on every surface, never as completed, and the server's answer is kept as a separate fact. Evidence: `docs/evidence/pr-client-aborts-2026-09-24/RUN.md`; fixture `test/browser/fixtures/client-aborts-app`, driver `test/browser/client-aborts.mjs`.

**Runtime rows (every build, additive; pages that abort nothing emit none).** The request row has already left the page when an abort happens, so each fact is a row of its own keyed by `request_occurrence_id`, sequenced like any row, with no `action_id` and `parent_continuation_id: null`:
- `network.abort` `{ request_occurrence_id, transport: fetch|xhr, abort_state, aborted_by_client, abort_reason: { via: "AbortSignal"|"XMLHttpRequest.abort", name, reason_type }, aborted_at, response_received_before_abort, body_read_started, response_consumed_before_abort, abort_evidence, … }`. `name` is the DOMException name of the signal's reason (`AbortError`, `TimeoutError`) and `reason_type` its constructor name when it is an Error; a message is never recorded.
  - `abort_state: "aborted"`, `aborted_by_client: true`: for a fetch that carries an `AbortSignal`, the signal aborted and the fetch rejected with the signal's own reason object (`abort_evidence: "fetch_rejected_with_signal_reason"`) or with an `AbortError` DOMException (`…_with_abort_error`): `aborted_at: "before_response_headers"`. Or the signal aborted after the response reached the page while its body was unread (`signal_aborted_body_unread`: the abort errors the body, so the app can no longer read it), or while a read of the body (`json/text/arrayBuffer/blob/bytes/formData`) was pending and that read then rejected with the reason or an `AbortError` (`body_read_rejected_with_…`; Chromium errors a body mid-read with a fresh `AbortError`, not the reason object): `aborted_at: "while_reading_body"`, with `body_read_started`. For an XHR, its own `abort` event (fired only by `abort()`), with `ready_state_at_abort` (`xhr_abort_event`).
  - `abort_state: "no_effect"`, `aborted_by_client: false`, `signal_aborted_after: "body_read" | "response_complete"`: the signal aborted after the app finished reading the body (or the response had none). The request completed; it is never labelled aborted.
  - `abort_state: "undetermined"`: the app read the body through a stream reader (or the response was dropped), so whether its read finished before the abort is not recorded (`undetermined_because`). Not labelled aborted.
- `network.response_read` `{ request_occurrence_id, transport: "fetch", via }`: the app finished reading the body of a signal-carrying fetch (the only fetches a page can abort). It is the only evidence Tracer uses to say which response the app read.
- The rules use the signal and the rejection, never timing. Native `then` / `addEventListener` only: no continuation, no owned listener. For signal-carrying fetches, the app receives the promise derived from Tracer's reactions, and so do its body reads (one microtask later, as with body capture; a rejection passes through unhandled exactly as before).

**Analysis.** `mergeRequestFacts(rows)` (`analysis/runtime-attribution.mjs`) copies the facts onto their request rows (`aborted_by_client`, `abort_state`, `abort_reason`, `aborted_at`, …, `abort_sequence`, `response_read_by_app: { via, sequence }`); the fact rows stay in the array, so coverage tallies are unchanged. `createStore` (every MCP tool), `buildActionChains` (export), `buildEpisodeChain` (live viewer) and `indexUnlinkedEvidence` call it; without fact rows it returns the same array, so every banked store answers byte-for-byte as before.
- **Credit.** `describeEpisodeEvidence` and the export's per-action ranking never credit an aborted request while the episode (action) has one the page did not abort; among the rest the rule is unchanged (latest with a write, else the last).
- **`actionOutcome`.** A credited aborted request gives `status: "aborted_by_client"`, `http_status: null`, `server_status` (the joined server span's status, or `null`), `aborted_at`, `abort_reason`, `body_read_started`; label `Aborted by the page: GET /api/search; the server answered 200`; sentence `aborted by the page before the response was read: GET /api/search (before the response headers arrived; AbortError); the server answered 200 and read find items` (`wrote <op> <collection>` for a write; `the server's answer is not recorded (backend not instrumented)`; `no server span joined (…)`). The abort wins over `failed`: a 500 to an aborted request is `aborted_by_client` with `server_status: 500`. Request segments use the same rule (`outcome: "aborted_by_client"`, `server_status`, `http_status: null`).
- **"also".** Every aborted request other than the headline is listed, grouped: `Completed 200: find notes; also aborted_by_client POST /api/notes (server answered 201)`; `other_requests[]` entries carry `server_status` and `aborted_at`.
- **Which response the app read (abstain).** When the episode has an aborted request, `outcome.app_read` and the sentence say `the last non-aborted request's response (GET /api/notes) was read by the app (json read recorded)` only when that request's `network.response_read` row exists; otherwise `which response the app rendered is not recorded (no body read recorded for …)`; when every request was aborted, `every request of this action was aborted by the page`.
- **`outcomeText`**: `aborted_by_client; server answered 200` (`no server status` without one), plus any `also …`.

**MCP.** `action_chain`, every `element_history` action and attempt, `recent_actions`, `compare_chains` `before`/`after` and `page_requests` print the one label. `outcome` adds `server_status`, `aborted_at`, `abort_reason`, `body_read_started`, `app_read`. The frontier `because` of an aborted credited request (and of an aborted segment) starts `the page aborted the request; the server answered <status>; ` in place of the ≥ 400 `server responded <status>; ` prefix. `reached` / `stopped_at` are unchanged: they describe how far the server-side evidence got. Work listings print a frame that ran after an aborted request's promise settled as `after request (i) settled (aborted by the page):`, never `after response`. `page_requests` entries add `aborted_by_client`, `aborted_at` and `server_status`.

**Coverage.** An abort is not a capture limit: the rows are emitted and counted like any row, and `coverage.complete` is unaffected.

**Residuals.**
- Only fetches that carry an `AbortSignal` are tracked (the only fetches a page can abort); an abort of a fetch whose signal the runtime did not see (a fetch captured before the runtime installed) is not recorded. Every `Request` object has a signal of its own, so a fetch called with a `Request` is always tracked (and its promise is the derived one) even when nothing can abort it.
- A body read through a stream reader (`response.body.getReader()`), a clone's stream, or a dropped response gives `undetermined`, never `aborted`.
- The body-phase fallback accepts an `AbortError` DOMException from a read that was pending when the signal aborted (Chromium substitutes it for the reason); a coincident network error of that exact type would be read as the abort.
- Observable difference: for a fetch that carries an `AbortSignal` the rejection reaction reaches the app one microtask later in every instrumented build (before, only with bodies on). `test/browser/body-capture.mjs` P6 is amended to this.
- `network.response_read` is recorded only for signal-carrying fetches and body-reading methods; XHR bodies and stream reads are not recorded as read, so `app_read` abstains for them.
- Which DOM mutation rendered the last result is not attributed by this change (DOM-mutation ownership is a separate follow-up).
- An abort that happens after the page's final `capture.summary` (e.g. from a `pagehide` handler that runs later) would be a row not covered by the summary.

*Amendment (2026-09-24, `fix/client-aborts` after the independent grade, `docs/evidence/pr-client-aborts-2026-09-24/GRADE.md`; supersedes the matching parts of §3.4 above; notes in `RUN-2.md`).*
- **`aborted_by_client` only when the abort kept the response from reaching the app.** That covers three cases: the fetch rejected before the response headers (with `signal_aborted_at_call` when the signal was already aborted, "the signal was already aborted: the request was never sent"); a body read the app had started was pending and then rejected because of the abort; or an XHR fired `abort`. The runtime decides at the abort, never from a live reference that garbage collection could clear (no `WeakRef`; `hasBody` is recorded when the response arrives). The runtime no longer emits `abort_state: "undetermined"`.
- **After the response.** A signal aborted after the response (status, headers) reached the app, with no body read in progress (whether or not the body was ever read), gives `abort_state: "after_response"`, `aborted_by_client: false`, `abort_after_response: true` and `abort_evidence: "signal_aborted_after_response"`. The request keeps the server's label. `outcome.abort_after_response` and the sentence add `the page aborted the request after the response reached it (status and headers); its unread body was discarded`. Case: a save whose status the app used, and a later cleanup abort; the browser reports it finished. The same applies when a started read had already failed for another reason (`body_read_error_type`). This replaces the earlier `signal_aborted_body_unread` → `aborted` rule.
- **Effects of aborted requests stay the action's.** `abortedRequestEffects` lists the joined DB operations of every aborted non-credited request (`outcome.aborted_request_effects`, also on the chain record). The MCP `outcome.writes`/`reads` include them. The "also" text states them: `also aborted_by_client POST /api/notes (server answered 201 and wrote insert notes)`. When one of them wrote, the credited request's "no write" is scoped: the frontier reads `…; no write under this request; an aborted request of this action wrote (insert notes by POST /api/notes)`, and the note `no write observed` becomes `no write observed under this request`.
- **XHR.** The `abort` event also fires without an `abort()` call (`window.stop()`). The row then carries `abort_call_seen: false`, `abort_reason.via: "xhr_abort_event_without_abort_call"` and `aborted_at: null`, and the sentence says "the XHR fired abort without an abort() call (e.g. window.stop())". §3.4's "fired only by abort()" was wrong.
- **Corrections to §3.4.**
  - "Pages that abort nothing emit none" is false. `network.response_read` is emitted for every finished body read of a fetch given a signal or a `Request` object (TanStack Query included), in every build, aborted or not.
  - `Response.prototype.{arrayBuffer,blob,bytes,formData,json,text,clone}` and `XMLHttpRequest.prototype.abort` are wrapped in every build.
  - The one-microtask delay on the rejection path applies in every build, production included, to every fetch given a signal or a `Request`, and to the rejection of that response's body reads. The README states it.
  - The fulfilment path is unchanged.

*Amendment (2026-09-24, `fix/client-aborts` after the regrade at 04d69be8; supersedes the matching parts of the two amendments above; notes in `RUN-3.md`).*
- **Any tracked consumption of the body is a started read.** This covers the body methods and also `getReader()` + `read()`, `pipeTo`, `pipeThrough`, `tee`, async iteration (`values()` / `[Symbol.asyncIterator]`), and `cancel()` on the stream or its reader. `ReadableStream.prototype.{getReader,pipeTo,pipeThrough,tee,cancel,values,[Symbol.asyncIterator]}` and the reader prototypes' `read`/`cancel` are wrapped in every build, and act only on the body of a tracked fetch (a `WeakMap` body/reader/iterator → track; no live-reference decision). When the signal aborts after the response reached the app:
  - A reader, `pipeTo` or iteration that is open and has not seen its end: `aborted_by_client`, `while_reading_body`, `body_read_started: true`, `body_read_via`, `abort_evidence: "signal_aborted_during_stream_read"`. A streaming UI's Stop button is this case.
  - Consumption through `tee`/`pipeThrough`, whose end is not followed: `abort_state: "undetermined"`, with `undetermined_because` naming it. The label stays the server's, and the sentence says it is not recorded.
  - A reader that saw `done`, or a `pipeTo` that resolved: `no_effect` (and a `network.response_read` row `via: getReader | pipeTo | async_iteration`).
  - A body read that had already failed before the abort (for example the server dropped the connection and `text()` rejected with a `TypeError`): `after_response` with `body_read_started: true`, `body_read_via`, `body_read_error_type`. This is recorded in the read's own rejection handler whatever the order, and is never "unread". An app-cancelled read gives `body_read_cancelled_by_app: true`.
- **The after-response clause.** It now reads `the page aborted the request after the response reached it (status and headers); the app had not started reading the body, and the unread body was discarded (whether the body had fully arrived is not recorded)`, or the failed-read and cancelled-read variants. The short label and `outcomeText` add `; aborted by the page after the response` (e.g. `Completed 200: insert notes; aborted by the page after the response`). `page_requests` entries add `abort_after_response: true` (and `abort_undetermined`).
- **Never-sent requests.** A request whose signal was already aborted at the call has frontier `stopped_at: "network"`, `stop_reason: "never_sent"`, `because: "the request never left the page (its signal was already aborted when fetch was called)"`; the MCP prefixes `the page aborted the request; `. It never says a server span failed to arrive.
- **Issuers (rebased onto `fix/middleware-reads`).** The server work of an aborted request is named with its issuer, as on every other surface (`dbOpText`, `headlineOp`). This applies to the sentence ("the server answered 201 and wrote insert notes (handler: createNote)"), to the "also" text, to `server_writes` / `server_reads` of the aborted outcome, and to the scoped "no write" frontier. `aborted_request_effects[]` adds `ops` (`operation`, `collection`, `write`, `issuer`, `issued_by`); `writes` / `reads` stay `operation collection` so that they merge into the MCP `outcome.writes` / `reads`. The abort frontier sentence and the aborted segment's `http_status: null` now live in `requestSegmentCore`, the one segment builder, so the export and the viewer share them.
- **Observable difference.** Every settled read of a tracked body is one microtask later, including each `reader.read()`, `pipeTo` and iterator `next()`. See the README.

### 3.5 Server-to-server hops (amendment 2026-09-24, `fix/server-outbound`)

Claim: a server-to-server request made while handling a traced request is a child of that trace, and its receiving side joins it, so a chain follows every hop or states where it lost one.

**Capture (`backend/register`).** Default adapters `http,undici,express,mongodb`. The `http` adapter already instrumented the client side of `http`/`https` (`http.request`, `http.get`, and libraries built on them such as axios' Node adapter); `undici` instruments Node's global `fetch`. Client spans of those two instrumentations are now shipped (they were filtered out before); each is a child of the active handler span and injects `traceparent`, so the receiving server span, in this process or another instrumented one, has the client span as parent in the same trace. Tracer's own span delivery runs with tracing suppressed (no client span, no traceparent). The `undici` adapter needs Node >= 20.6 or 18.19 (its diagnostics-channel subscriptions are unreliable before); on an older Node it is left out of the defaults, the process prints one warning, and every server span carries `producttrace.capture_limit.feature: "outbound_fetch"` with the reason (several limits are comma/semicolon joined in the same two attributes). The same holds when `PRODUCTTRACE_BACKEND_ADAPTERS` omits `undici`. The http instrumentation is patched once per module object even when both the require hook and the ESM loader hook see `node:http` (before, one `http.get` in an ESM app produced two nested client spans).

**Ownership rule (all readers).** A server span owns the handler and database spans whose nearest server ancestor it is. A request's `route.dispatch` / `handler.enter` / `db.operation` rows are its own server's; a hop's receiving server owns its own work. On stores without shipped outbound client spans (every store before this branch) this equals the old "descends from the server span" rule, since no chain crossed a server boundary.

**Hop join (`serverHops`, `analysis/runtime-attribution.mjs`).** Every outbound client span (a client span with an HTTP method that is not a database span) owned by an admitted server span is a hop, in start order, depth-first, with a dotted path (`1`, `1.1`, `2`). It joins the one server span whose `parent_span_id` is the client span's id (the traceparent it sent), same trace, method equal (`join: "exact_parent"`), then recurses into that server's hops. Zero claims: `join: "no_incoming_span"`; several: `"multiple_exact_parent_servers"` (abstained); another method only: `"method_mismatch"`. Never by URL or time. `attachBackendSpans` writes one `server.hop` row per hop (additive kind; `hop`, `depth`, `parent_hop`, client `span_id`, `issued_by` handler, `method`, `url`, `client_status_code`, `client_error`, `join`, `server{span_id, service_name, route, status_code, handler_spans, db_ops}`), and each joined hop's database spans also as `db.operation` rows of the request marked `hop`, `hop_span_id` (exact parentage at every edge). The headline effect prefers the request's own database step; a hop's is named with its hop: `Completed 200: insert chain_ends (hop 1.1.1.1.1: POST /api/chain/0)`.

**One hop builder (`hopSegments`, `analysis/causal-chain.mjs`)** words hops for the MCP segments, the episode chain (`chain.hops`, `escaped_hops`, `hops_text`: live viewer and `chain` in `action_chain`), exported action chains (`requests[].hops`, `escaped_hops`, `hops_text`) and described server spans (unlinked listings, `page_requests`):
- joined: `outbound POST /internal/notify (from handler archiveProject) → server /internal/notify 201 → handler notify → db insert notifications` (the server's service name is printed when it differs from the caller's);
- escaped, the host answered: `outbound POST https://api.example/hook 200 (from handler h) → not instrumented (no incoming span for this traceparent)`;
- escaped, no response: `… → no response (connect ECONNREFUSED …); not instrumented or not reached (no incoming span for this traceparent)`;
- several hops are labelled `hop 1: …; hop 1.1: …`; inline rendering stops at depth 3 and 6 lines, then `+N more hops (M deeper than 3) (see hops)`; the JSON `hops` lists every hop (depth unbounded).

**MCP.** Each request segment gains `hops`, `escaped_hops`, `hops_text` and `additional_stops`; its `db_ops` are the request's own server's (a hop's are under the hop). `action_chain.stops` gains `{ stop: "outbound", hop, join, server, summary, because? }` and `hop` on hop db stops. Every escaped hop is an additional frontier stop (`reached: "outbound", stopped_at: "network", stop_reason: "outbound_<join>"`) printed as `; also stopped at network because <hop sentence>`, whatever the headline stop is. `escaped_hops` is the list the coverage claim reads (`coverage.complete: false` is that branch's call, not this one's). A hop's receiving server span is never listed as unlinked or under `server_spans_without_request`; an unlinked root server span carries its own hops. An incoming root span with no browser parent stays unlinked and is never joined by time.

**Grader note.** §4's handler/DB recomputation ("descending from") equals the ownership rule on final7 (no outbound client spans; 81/81 unchanged). A grader for a store with hops must stop at the nearest server ancestor.

Evidence: `docs/evidence/pr-server-outbound-2026-09-24/` (`RUN.md`; fixture `test/browser/fixtures/server-outbound-app/`, driver `test/browser/server-outbound.mjs`).

**Revision after the independent grade (2026-09-24, `fix/server-outbound`, `GRADE.md` "merge with changes"; `RUN-2.md`).**
- **Headline with escaped hops.** "Terminal effect observed" (`stopped_at: null`) appears only when no hop escaped. A chain or request segment that reached its effect but has an unfollowed hop reads `stopped_at: "server_hop"`, `stop_reason: "server_hop_unfollowed"`, `reached` unchanged, `because: "reached db (<the DB sentence>); a further server-side hop may have escaped: N outbound call(s) have no receiving span (POST http://…, …)"`. The value and wording are shared with `fix/honest-coverage`. The outcome status stays the request's own; `label` gains `; a further server-side hop may have escaped`, `sentence` gains the clause, `escape_text` holds it, and the bracket reads `completed 202; a further server-side hop may have escaped`. Exported action chains apply the same rule. Each escaped hop remains an additional stop. A chain whose headline already stops earlier (for example at `handler`) keeps that stop and lists the escaped hops as additional stops.
- **App-set trace headers.** When the app already set `traceparent` or `tracestate` on an outbound request, Tracer leaves the request's headers untouched. Before, `http` overwrote the app's value and `fetch` appended a second, unparseable one. The outbound span carries `producttrace.outbound.traceparent_set_by_app: true` and, for a valid W3C value, `producttrace.outbound.app_traceparent`. A value Tracer's own outbound instrumentation injected (re-sent by a library on a redirect) is not the app's and is replaced. Hop join for such a span:
  - the one server span whose trace id and parent span id equal the app's value, method equal: `join: "app_traceparent"`, rendered `(…; followed by the traceparent the app set)`. This is an identifier join, possibly into another trace;
  - otherwise `join: "app_traceparent_unlinked"`, rendered `→ traceparent set by the app; receiving span not linked by Tracer`, and escaped.
  This includes an app that fills headers itself with the OpenTelemetry API (`propagation.inject`).
- **Wording.** A hop with no receiving span reads `no incoming span for this traceparent (not instrumented, or not reached)`, prefixed by `no response (<error>); ` when the client got none. It never asserts "not instrumented" as fact.
- **After the response.** A hop whose client span starts ≥ 1 ms after its owning server span ended carries `after_response_ms` and reads `(…; sent N ms after the response)`.
- **Handler-less receivers.** A receiving server span with no handler span (plain `node:http`, other frameworks) keeps the database spans it owns: `db_issuer: "unknown"`, rendered `db insert x (no handler span; issuer unknown)`.
- **Engines.** `package.json` `engines.node` is `^18.19.0 || >=20.6.0`, the range the http and undici instrumentations declare.

**Second revision after the regrade (2026-09-24, `fix/server-outbound`, `GRADE.md` regrade at `94af88e6`; `RUN-3.md`).**
- **Pass-through (proxy pattern).** An outbound request whose `traceparent` equals the value the nearest server span of this process received is a pass-through, not an app-set header. A handler that forwards the incoming headers, or sets `traceparent: req.headers.traceparent`, is this case. Tracer removes the forwarded trace headers and injects its own client span's value, for both `http` (as `main` did) and `fetch`. The span is marked `producttrace.outbound.traceparent_forwarded: true`, and the downstream is an ordinary hop. Without this, the proxy and the downstream both claimed the browser span, and the join abstained. The rule is per server span: a process records the traceparent each server span received and each span's parent id, both bounded to 50,000 entries. Any other app value keeps the app-set rule.
- **Escape clause per join kind.** `a further server-side hop may have escaped: N hop(s) not followed: M with no receiving span, K with more than one (…)` (plus `… with a receiving span of another method` when that applies). Zero counts are omitted. An abstained hop is no longer called "no receiving span".
- **Known cases, disclosed, not fixed:**
  - (a) **`req.setHeader('traceparent', …)` after the request was created.** Tracer injected at creation. The app's later value overwrites it on the wire, and the span is not marked. The receiver continues the app's value, so it is listed as an unlinked root, and the hop reads `no incoming span for this traceparent (not instrumented, or not reached)` although the receiver was instrumented and reached.
  - (b) **A second OpenTelemetry SDK in the app** (its own undici/http instrumentations). Its instrumentation uses Tracer's global provider and propagator, so one `fetch` sends two `traceparent` headers and produces two undici client spans. The receiver cannot parse the pair and starts a new, unlinked root, and the one call renders as two escaped hops. `http` was one span and joined in the grader's probe. Tracer does not detect a second instrumentation of the same client (no `double_instrumented` mark). Run one SDK, or leave Tracer's backend register off in apps that already run OpenTelemetry.

**Third revision (2026-09-24, regrade at `527a7ea9`; `RUN-4.md`).** A hop's database operations are judged by the precondition rule against that hop's own receiving server: its app-level middleware, `router.param` and router reads are preconditions unless that code wrote the hop's response, and any write is an effect. A request whose only database work, its own and its hops', is preconditions reads `responded 200; no database work after the preconditions (find sessions by middleware auth in hop 1)`. A hop that did work after its preconditions keeps that work as the effect. A hop with a response but no receiving span also names the two disclosed causes: `…; also possible: the app replaced the traceparent after the request was created, or a second OpenTelemetry SDK sent another one`.

### 3.6 Honest coverage (amendment 2026-09-24, `fix/honest-coverage`; supersedes the `unobserved` sentence of the no-false-negatives amendment and the `page_requests` `text` wording of the `fix/mcp-gaps` amendment)

Claim: Tracer never claims more coverage or completeness than its rows prove. Four defects found on a fresh app motivated it: `unobserved` was the constant `["beacon"]`; `complete: true` and "stopped at none (terminal effect observed)" were printed for an action whose handler made a server-to-server call that started a new root trace; a request-less click's chain said `no_request` while a request left the page in its window; `page_requests` said "none: no user action". Rules (generic; no event, app or route names in the package):

1. **What the runtime observes is measured and recorded.** `capture.page` gains `observes`:
   - `events: { recorded, exposed_total, unobserved, basis }`. `recorded` is the list the runtime installs its action listeners from (one constant in the runtime, `click, input, change, submit, keydown, focusin`, used both to install and to report). `unobserved` is every event kind the browser exposes minus `recorded`: every `on*` handler property on the `HTMLElement`, `Document` and `Window` prototype chains, enumerated at install (never hand-listed).
   - `transports: { fetch, xhr, eventsource, websocket, worker, shared_worker, beacon, service_worker }`. Each is `wrapped`, `not_wrapped` (the API is present and not wrapped) or `absent`.
   - `realms_at_install: { frames }`.
   - Realms are checked at install, on `load`, at every action and request, and at every `capture.summary`. Each child browsing context (`window.length` / `window[i]`) gets one `capture.limit {feature: "realm", realm_kind: "frame", realm_id, same_origin, url}` when first seen. `same_origin` is whether its `location` is readable, and `url` is recorded only then; content is never read. A `capture.realm {realm_id, same_origin, url, update: true}` row is written when that status changes later (a frame seen on its initial about:blank, then navigated cross-origin). A service worker controlling the page gets `realm_kind: "service_worker"`.
   - Each Worker/SharedWorker created now gets its own `worker_fetch` capture.limit (was: the first one per page). `capture.summary` adds `realms: { frames_seen, frames_now, workers_created }`. `runtime_version` is `0.1.0+coverage.2`.
   - `coverage.unobserved` (`unobservedOf` in `collector/coverage.mjs`) is a list of `{ kind, name, reason, … }` computed from those rows only:
     - `events`: `names`, `count`, `recorded`;
     - `transport`: one per `not_wrapped`;
     - `realm`: `frame` (`count`, `same_origin`, `cross_origin`, `realms`), `worker` (`count`, `workers` from `worker.create` / `worker_fetch` rows), `service_worker`.
   - A `capture.page` without `observes` (older runtimes) gives one `events` entry saying the event kinds were not declared, plus transports from `wrappers`. No `capture.page` gives `null`. Coverage also gains `observes`.
   - Each unobserved realm is also a coverage reason: `unobserved realm present: <reason>`. A `capture.limit` emitted after the last summary is counted too. The action summary gains one line: `Not observed on page <id>: N event kind(s) that start no action; transport beacon not wrapped; 2 frame realm(s) (1 same-origin, 1 cross-origin); 1 worker realm(s)`. `element_history` and `recent_actions` name at most 12 event kinds per entry (`names_total`); `action_chain` lists every one.
2. **An action's coverage adds its own window** (`windowCoverageReasons` in `analysis/causal-chain.mjs`, merged by `actionCoverage` in `collector/coverage.mjs`; `coverage.window_reasons` lists them). The window is the one unlinked evidence already uses: the episode's first dispatch to the next outside dispatch. `complete` is false when the page's delivery check fails (unchanged: gaps, drops, malformed rows, pending body reads, capture limits), or when any of these holds:
   - an unattributed request left the page in the window with no known issuer. The issuer is known when the row names a first-party frame on the stack, or the frames that armed its task; old rows without `issuer` are unknown;
   - a server span starts in the window with no browser parent. That is a `kind: "server"` span whose parent span id is neither a recorded request's span id nor a recorded backend span's id (`serverSpansWithoutBrowserParent`, also used by `indexUnlinkedEvidence` and `page_requests`). A server span continued from a recorded backend client span is joined by that identifier and is no longer listed as unlinked;
   - an outbound call from a joined server span has no matching incoming server span.
3. **"Terminal effect observed" only when nothing could continue it.**
   - `buildEpisodeChain` records `server_hops` for the episode's joined server spans. `outbound` (`outboundSpans` in `analysis/runtime-attribution.mjs`) is every `client` span that is not a DB span and descends from the joined server span. A client span nested under another is the same call; `continued_by` is the server span whose parent is any span of the call (an identifier). `continuation_candidates` are the server spans with no browser parent that start in the window at or after the joined server span started. That is order only: they are listed, never joined.
   - `chainFrontier` (through `windowFrontier`) keeps `stopped_at: null` only when no outbound call is unfollowed and there is no candidate. Otherwise:
     - a chain that reached its DB step reads `stopped_at: "server_hop"`, `stop_reason: "server_hop_unfollowed"`, `reached` unchanged, `because: "reached db (<the DB sentence>); a further server-side hop may have escaped: 1 server-side request in this window has no browser parent (listed as unlinked)"` and/or `…: 1 outbound call from the joined server span has no server span continuing it (POST http://…)`;
     - any other request-bearing frontier keeps its `stopped_at` and gets the clause appended.
   - `escape: { unmatched_outbound, continuation_candidates }` is added on `action_chain`, `element_history` / `recent_actions` actions and the exported chain. Such a chain carries `unlinked` even though it has a request.
   - The outcome label is unchanged in status. It is about the request's own response. `label` gains `; a further server-side hop may have escaped`, `sentence` gains the clause, `escape_text` holds it, and the bracket reads `completed 200; a further server-side hop may have escaped`. Request segments use their own request's hops.
   - `stopped_at` therefore gains `server_hop`. `compare_chains` compares it like any other `stopped_at`.
4. **A request-less headline states what left the page.** When the window of a request-less chain holds unattributed requests, the frontier's `because` reads `no request could be attributed to this action from instrumented code; N request(s) left this page during this action's window that Tracer could not attribute (<METHOD> <path>, issuer unknown | issued by instrumented code outside any action; …), listed below as unlinked`. It replaces the scoped parenthetical; frontiers that do not contain it (worker, abstention) get the clause appended. The outcome's `label`, `sentence` and bracket say the same (`window_text`). `window_evidence: { window, requests_total, requests_issuer_unknown, requests (≤ 3), server_spans_total }` is on the chain record.
5. **`page_requests` wording.** An unattributed request's `attribution.text` is `not attributed to any user action; <issuer>` (`not attributed: action <id> has no dom.action row in this store` for an orphan action id). Summaries say `N not attributed to any user action` and `(k action, m not attributed; …)`. The `attribution` filter keeps its value `none`.
6. **One source.** `buildEpisodeChain` computes `window_evidence` and `server_hops`. `chainFrontier` and `actionOutcome` read them, and every surface prints from those:
   - the MCP tools and each request segment;
   - the live viewer (`chain.display.label`);
   - the exported `producttrace.action-chain.v1` rows (`buildActionChains` passes the same window index and applies `windowFrontier` to the action's own requests; its `because` stays `null` for a joined DB stop, as before, so an escape reads `reached db; …`).

   A caller that holds only an episode's rows passes the store-wide index (`unlinked`). Without it, the window is computed from the rows given.

Backend register: the default entrypoint now also ships `client` spans (outbound calls), except its own span-delivery request (the one whose destination is the span endpoint). Without them an outbound call's escape could not be stated. Node's global `fetch` (undici) is still not instrumented by default, so a server-to-server call through it sends no trace context and shows up only as a root span (rule 3's candidates).

Residuals, stated:
- Continuation candidates are chosen by order. An unrelated root span, such as a request from another client, that starts during a request's server span is listed as a possible escape. That errs toward withholding a claim, never toward making one.
- Frame realms are counted at the check points above. A frame inserted and removed between two checks is missed.
- A Worker's own requests remain unrecorded. They show up as root spans when they reach an instrumented backend.

Evidence: `docs/evidence/pr-honest-coverage-2026-09-24/RUN.md`, fixture `test/browser/honest-coverage.mjs` (Radix Dialog in a portal, two iframes, a worker, a beacon, an unobserved event kind chosen at run time, the escaped hop, an unfollowed outbound call).

*Amendment (2026-09-24, `fix/honest-coverage` after its independent grade, `docs/evidence/pr-honest-coverage-2026-09-24/GRADE.md` items 2–6; supersedes the matching points of §3.6).*
- **Frames are recorded when inserted.** A native MutationObserver runs on the document and on every shadow root (hooked through `attachShadow`). It records every added navigable container, meaning each HTML element that creates a child browsing context: `iframe`, `frame`, `object` and `embed`. The capture.limit carries `via: "inserted"` and `element`. The origin comes from the element's own `src`/`data`/`srcdoc`/`sandbox` attributes, never its content. A later check does not flip that status on the frame's initial about:blank document. A frame that appears in an action's window (by sequence) is a window reason: `N child frame(s) appeared in this action's window (a same-origin, b cross-origin): code in a frame is not recorded`. A worker created in the window gives the same kind of reason.
- **WebSocket messages are recorded.** Each `WebSocket#send` writes `network.send {transport: "websocket", url, connection_occurrence_id, bytes, action_id | issuer, spine}`. It carries byte size only, never content. The owner is the frame current at the `send()` call, as with worker posts.
  - A request-less chain with its own send stops at `stopped_at: "websocket"`, `reached: "websocket"`, `stop_reason: "websocket_not_traceable"`, `because: "sent N WebSocket message(s) on <url> (B bytes); a message carries no trace context, so what it caused on a server cannot be attributed to this action (…)"`. Its outcome is `stopped`, labelled `Stopped at websocket: …`.
  - Any other frontier appends `also sent …`.
  - Every send in an action's window is a window reason, whoever owns it.
  - `chainStops` adds `websocket_send` stops. The chain line prints `send on websocket <url>`.
  - `websocket: "wrapped"` now means both connect and send are recorded.
- **Event basis.** The enumeration adds, as data, the kinds the platform dispatches with no `on*` property. These are `compositionstart`/`update`/`end`, `focusin`, `focusout` (the same list `fix/trusted-events` uses) and `touchstart`/`move`/`end`/`cancel`. `observes.events.lower_bound: true`. The reason, the `Not observed` line and the skill say "at least N".
- **Replaced wrappers.** At every `capture.summary` the runtime compares each live global with the wrapper it installed: `fetch`, `XMLHttpRequest.prototype.open`/`send`, `EventSource`, `WebSocket`, `WebSocket.prototype.send`, `Worker`, `SharedWorker`. The names that differ are listed in `capture.summary.wrapper_replaced`. Each one becomes a `transport` entry with `status: "replaced"` and a coverage reason, `transport wrapper replaced after install: <name> (its requests may not be recorded)`.
- **Page end.** The last episode's window ends at the page's last runtime row plus `PAGE_END_GRACE_MS` = 2000 ms, for pagehide beacons. The window carries `page_end_grace_ms`. It never ends at the collector's run-close `capture.received`, so a root span after that point is in no window of the page.
- **Wording.**
  - The request-less clause reads `N recorded request(s) left this page …`.
  - It keeps the scope caveat: `no request could be attributed to this action from instrumented code (requests from uninstrumented scripts, workers and third-party code cannot be linked; transports and realms Tracer does not record are listed in coverage.unobserved); …`.
  - A row that predates the `issuer` field reads `issuer not recorded by this runtime`.
  - `COVERAGE_SCOPE` and the `Not observed on page … (from its rows; not exhaustive: …)` line say the list is not exhaustive.
- **Outbound calls (interim, until `fix/server-outbound`).** A nested client span is the same call only when it is a direct child with the same method and destination. A client span with no destination that encloses other outbound spans (an SDK grouping span) is not a call. Every other client span is its own call with its own `continued_by`.

*Amendment (2026-09-24, `fix/honest-coverage` rebased onto `main` 9ad0f210, after `fix/server-outbound` #17, `fix/middleware-reads` #15 and `fix/client-aborts` #16; supersedes the outbound-call parts of §3.6 above and its backend-register paragraph).*
- **One source for escaped outbound calls.** This branch's register change and its `outboundSpans` / "a nested client span is the same call" rule are removed. Outbound calls are `fix/server-outbound`'s `server.hop` rows: `hops`, `escaped_hops`, `hops_text`, `requestSegmentCore`. Main's `chainFrontier` states each escaped hop once: `stopped_at: "server_hop"`, "a further server-side hop may have escaped: N hop(s) not followed: …", and one `additional_stops` entry per hop. The action's coverage reason cites the same hops: `N server-side hop(s) not followed (hop <id>: <METHOD> <url>, span <span_id>; …)`, read from the chain's unfollowed `server.hop` steps (`windowCoverageReasons`).
- **Root continuation candidates** are what this branch adds to rule 3. These are server spans in the action's window with no browser parent: no request context, no recorded backend parent span, and not a hop's receiving span (`serverSpansWithoutBrowserParent`). Each must have started at or after a joined server span started. The record carries them as `window_roots` (renamed from `server_hops`, which now means main's hops). When no hop escaped, the chain reads `stopped_at: "server_hop"` with `…; a further server-side hop may have escaped: N server-side request(s) in this window have no browser parent (listed as unlinked)`. After an escaped-hop clause the same fact is appended as `also N …`. `root_escape: { continuation_candidates, span_ids }` is the additive field. The outcome's `escape_text` joins both clauses. Request segments receive their own request's candidates through `requestSegmentCore({ windowRoots })`. The export (`buildActionChains`) applies the same `windowFrontier` after main's hop rule.
- **Aborted and never-sent requests** (`fix/client-aborts`) are merged onto their request rows by `mergeRequestFacts`, so each request is counted once, by occurrence id. A request whose signal was already aborted at the call (`signal_aborted_at_call`) never left the page, so it counts toward neither "N recorded request(s) left this page" nor the unknown-issuer coverage reason. It is still listed under `unlinked`. An aborted request that left is counted, and the headline says `aborted by the page`.
- **Fixture.** The escaped root span now comes from a raw-socket call that no instrumentation sees. Main instruments `fetch`/undici and injects traceparent, so a `fetch` call is a followed hop. Grader probe g is added: `Batch` makes two calls inside one SDK client span (to the instrumented second process, then to the external service), and `Seq` calls the external service from the second call's response callback. Both read `server_hop` with `complete: false`: the external call is its own escaped hop and the call to the second process is followed.

### 3.7 Every surface says what the rows hold about a request (amendment 2026-09-24, `fix/mcp-surfaces`)

Claim: "Every MCP surface says what the rows already hold about a request, wherever the request came from." Rendering and lookup ranking only: no join, credit, episode, frontier or outcome rule changed, and `stops`, `reached`, `stopped_at`, `because`, `outcome.status` and `chain` are unchanged on every banked store (evidence: `docs/evidence/pr-mcp-surfaces-2026-09-24/RUN.md`). One runtime change: `content_sig` also hashes `alt` (below). The gaps it closes were found by independent graders on fresh apps (`docs/HANDOFF-2026-09-24-cycle2.md` §5, §6 item 7; `pr-mcp-gaps` and `pr-body-capture` GRADE.md).

- **Bodies for every request (one summariser).** `summarizeBody` (§3.3) is the only body summary. Every place a request is listed carries `body` and `response_body`:
  - `page_requests` requests (attributed: the segment's; unattributed: the request's own body rows, joined by `(page, request_occurrence_id)` as in §3.3), plus `include_bodies: true` (schema below) for the stored bodies;
  - `action_chain.unlinked.requests[]` (the body rows of each unlinked request; `include_bodies: true` returns them in full);
  - `recent_actions` with the new `include_bodies: true` adds, per action, `unlinked` (the same entries, bodies in full) and prints them under the header line as `Action <id>: <unlinked block>`. Without the option `recent_actions` answers as before.
  Stores without body rows gain only `null` fields.
- **What the bodies say, in words (`bodyFacts`, `mcp/tools.mjs`).** Every request entry (segment, unlinked request, `page_requests` request) gains `request_fields`, `response_fields` and `browser_status`:
  - `request_fields`: the request body's top-level short fields (a number, a boolean, a string of at most 64 characters, or an array of at most 6 such scalars), id-shaped keys excluded (they print as `request ids`). Fields whose value differs from a peer's come first, then the others in body order; at most 4.
  - `response_fields`: the response body's short fields whose key is status-like (last camelCase/snake_case/kebab-case segment one of `error errors status state code revision rev version reason result ok success message outcome phase stage detail`), then short fields whose value differs from a peer's; at most 4, ids excluded.
  - Peers are the other requests to the same `METHOD` + path in the same scope: the episode (segments), the unlinked list (unlinked entries), the listing (`page_requests` unattributed requests; an attributed request carries its segment's values).
  - `browser_status`: the status the page's own response object reported (the response body row's `status`), else `null`.
  - Text: the segment tail, the unlinked line and the `page_requests` line gain `sent k: v, …` and `answered k: v, …` around the existing `request ids …` / `response ids …`, e.g. `[completed 201; sent type: pulse, source: toolbar; request ids projectId=p1; answered kind: pulse; response ids id=ev_1]` next to `[completed 201; sent type: follow, …; answered kind: follow; …]`, `[failed 409; sent done: true; answered error: locked; response ids taskId=t1]`. A field that is neither status-like nor different from a peer stays in the JSON summary only.
- **Status mismatch (`statusMismatch`).** When `browser_status` and the joined server span's status are both known and differ, the entry gains `status_mismatch: { browser, server, reason }` and the text states `reason`: `server answered 304; the browser reported 200 from its cache` when the browser saw 200 and the server 304 (a cache revalidation), otherwise `browser reported N, server answered M; not the same response, or a proxy between them`. The outcome label still follows the server span (`completed 304`).
- **Issuer frames.** An unattributed request's issuer lists every first-party frame live when it was sent, innermost first (the row's `issuer.function_ids` reversed, consecutive repeats collapsed): `issued by getJson f:3 (called from loadProject f:7 ← queryFn f:40)`, at most 6 frames then `+N more`; `armed by` uses the same rule. JSON: `attribution.issuer_frames` and `attribution.armed_by_frames` (`[{ function_id, name, label }]`). Before this change the text kept the innermost and the outermost frame only.
- **Deferral from identifiers (`issueDeferral`, `analysis/causal-chain.mjs`).** From an attributed request row's `parent_continuation_id`, each `function` continuation is followed to its `function.enter` row's parent until the walk reaches the dispatch (`…:action:n`: sent synchronously, not deferred) or a non-function continuation (the request's code ran later, on that continuation). `deferred` then carries `{ ms_after_dispatch, via, continuation_kind, continuation_id, dispatch_event, basis }` with `via` = `timer` (setTimeout/setInterval), `promise` (promise reaction, await resumption, microtask), `effect` (state or mount effect), `animation_frame`, or `callback`; `ms_after_dispatch` = the request row's time minus its action's `dom.action` row time (one page, one clock: a measure, never a join). The segment tail says `sent 3.0 s after the click via a timer` (ms below 1 s: `sent 12 ms after the click via a promise continuation`). The server part of `deferred` (`after_response_ms`, `last_after_response_ms`, `spans`: server work after the response) is unchanged and independent; `deferred` is `null` only when neither holds. `outcome.deferred` is the credited request's, as before. Limits: only the continuation nearest to the request is named (a continuation has no row of its own, so an outer timer above a promise reads `via a promise continuation`); a function continuation without a recorded enter row stops the walk and claims nothing. The export (`buildActionChains`) is unchanged: its per-request `deferred` stays the server part.
- **Description lookups (`resolve_element` by raw evidence; still never `exact`).**
  - Runtime: `content_sig` hashes the first of `aria-label`, `title`, `name`, `data-testid`, **`alt`**, else tag + text. Only elements with `alt` and none of the first four (images) get a different signature; older stores never hashed `alt`, so an alt name finds nothing there. `dist` rebuilt, `cmp` identical.
  - Implicit roles add `tr` row, `td` cell, `th` columnheader, `thead`/`tbody`/`tfoot` rowgroup, `article`, `figure`, `main`, `aside` complementary, `fieldset`/`details` group, `output` status, `hr` separator, `meter`, `menu` list. A `<canvas>` has no implicit role (HTML-AAM) and none is invented.
  - Enclosing labels: stamp evidence now lists, per key, the stamped keys that enclose it on the same page (same file, strictly containing placement span, and the same rendered instance: equal React key paths or an extending one, or two single-instance ordinal keys). A supplied `name` (+3) or `nearby_text` (+2) equal to an enclosing element's content signature scores, `matched_on: "ancestor <key> label = nearby_text (aria-label)"`. It never counts as the element's own name.
  - `best`: when several candidates match role and name, and exactly one of them also matches `nearby_text` (its own attributes, its own signature, or an enclosing label), that one is `best`, with the basis saying so.
- **Schemas.** `page_requests` and `recent_actions` gain `include_bodies` (`{ "type": "boolean", "default": false }`, described in `TOOL_SCHEMAS`). No other input changed.
- **Residuals.** Text states status-like and differing fields only: an entity label in a response (`name: Apollo`) is in `response_body.fields`, not in the line. Fields are top-level only. Redacted values print as `[redacted]`. `browser_status` exists only with body capture on (no row, no status). A lookup by partial visible text still cannot match a hash (`content_sig` hashes the whole label or the first 64 characters of text).

*Amendment (2026-09-24, `fix/mcp-surfaces` after the independent grade, `docs/evidence/pr-mcp-surfaces-2026-09-24/GRADE.md` and `RUN-2.md`; supersedes the matching bullets of §3.7).*
- **Current labels only (R1).** A key's label is what its latest stamp row on the page shows (`latest_sigs`). A `name` or `nearby_text` equal only to an earlier label of a key (an index-like key that now shows another item), its own or an enclosing element's, is never a match and never `best`; a recorded target attribute superseded by a later label does not match either. The candidate is still listed with `label_out_of_date: true`, `out_of_date_keys` and a `mismatched` entry; the reply adds `labels_out_of_date` and the text `Label out of date for <key> (content changed since): the text matches only an earlier label of that key, never its current one, so it is not a match.`
- **Opaque responses (R2).** A response body row with `reason: "opaque_response"` or status 0 (e.g. `redirect: "manual"`) is not a status: `browser_status: null`, `browser_status_hidden: "opaque_response"`, no `status_mismatch`, and the text `the browser hid the status (opaque response); server answered 302`.
- **Nested differences (R3).** When a peer's body reads the same as this one in the shown fields and every id but is not the same body, the entry adds `request_nested` / `response_nested` (`[{ path, value, peer_values }]`, short leaf paths to depth 4, at most 4, `*_nested_more`), text `sent opts.sort: asc (vs desc)`; when no differing path is short, `request_differs_unshown` / `response_differs_unshown: true`, text `request body differs from another request to this URL only in fields not shown`.
- **Nearest continuation (R4).** `deferred.basis` is `"nearest_continuation"` (the sentence moves to `basis_text`); `deferred.continuations` lists every continuation identified, outermost first (`{ kind, via, continuation_id, ms_after_dispatch }`, the time the first frame on it ran), `reached_dispatch` says whether the walk reached the dispatch, and `continuations_stopped` why not. Past a non-function continuation the walk finds the frame that created it: the one `function.enter` row of the same action, entered earlier, whose spine equals the continuation's (the first frame on it minus its own id, or the request row's spine when no first-party frame ran on it). None or several: the walk stops and says so. Text: `sent 3.0 s after the click via a timer` only when exactly one continuation was found and the walk reached the dispatch; otherwise `sent 501 ms after the click (nearest continuation: a promise continuation; earlier: a timer at 500 ms)` or `… (nearest continuation: a promise continuation; earlier ones not identified)`. Limit: an `await` resumption inside a creating frame has that frame's spine and no row, so it is not listed.
- **Bounded lines (R5).** At most 4 fields per side in JSON and text, then `+N more fields` (`request_fields_more`, `response_fields_more`); each value is cut to 32 characters with `…` in text (the JSON keeps it); a status-like key whose value is not short is named by its shape in `response_shapes` and in text (`error: {2 keys}`, `status: <301 chars>`). Nothing that qualifies is dropped without a count.
- **Reply budget (R6).** `include_bodies` on `page_requests` and `recent_actions` returns stored bodies newest first up to `BODY_BUDGET_BYTES` (512 KB) per reply; once one does not fit, every older one keeps its summary with `full_omitted: "budget"`. `bodies_full: { budget_bytes, bytes, with_full_bodies, cut, next_until?, cut_in_actions?, note? }` and a `Full bodies: …` text line say so; `page_requests` pages with `until = bodies_full.next_until`; `recent_actions` names the actions to call `action_chain … include_bodies` on. (`action_chain include_bodies` is unchanged and unbounded, as before this branch.)
- **Unused nearby_text (R7).** When `nearby_text` matched no candidate's own current label and no stamped enclosing element's label, `ignored` gains `{ input: "nearby_text", reason }` and the text says `nearby_text ignored: no candidate's own label and no stamped ancestor's label matches it (enclosing elements are known only when they carry a handler)`.
- **Issuer frames.** Over 6 frames the text prints the innermost 5, `… +N more`, and always the outermost frame.
- **Server hops (after the rebase onto `fix/server-outbound`).** Hop segments carry no body fields: bodies are recorded only by the page runtime (`network.body`), and the backend records none for server-to-server requests, so `sent …` / `answered …`, `browser_status` and the deferral never appear on a hop. The same `bodyFacts` applies the day hop bodies are recorded.

*Amendment (2026-09-24, `fix/mcp-surfaces` third author round; evidence in `docs/evidence/pr-mcp-surfaces-2026-09-24/RUN-3.md`; supersedes the R6 and server-hop bullets immediately above).*
- **Total body cursor.** `page_requests`, `recent_actions`, and `action_chain` accept the pair `until_timestamp` and `until_id` returned as `bodies_full.next_cursor`. The order is `(timestamp, page, sequence, request_occurrence_id)`, newest first. The cursor is exclusive, including for requests sharing a millisecond. `page_requests` excludes newer requests from the listing; action and recent replies retain the chain/action summary but omit their full bodies at or after the cursor. The same 512 KB budget and `bodies_full` notice apply to all three tools. A repeated unlinked request in overlapping action windows receives a full body once per reply. Older full bodies are recovered by passing both cursor fields with the same filters or action id.
- **Hop body coverage.** Each `server.hop` and escaped hop entry has `bodies: "not recorded for server-to-server hops"`. A request segment, `page_requests` entry, described server span, or unlinked entry with hops has the same field. The inline hop text says `bodies: not recorded for server-to-server hops` once per request, including when hops are capped in text. No body is inferred from the browser request or server span.
- **Bodies off.** When `capture.page.bodies` says `off` or `production_off` and no response body row exists, a request with a server status says `browser-side status not recorded (body capture off); cannot check the browser/server status view`. It does not infer a browser status or a mismatch.

## 4. How the grader recomputes each answer (`test/g4-grader.mjs`)

The grader imports nothing from `analysis/`, `collector/`, or `mcp/`. It reads the raw JSONL and `HANDLERS.md` and recomputes:

- **action_chain**: the action's non-internal `network.request` rows by `action_id`; for the chain's request, the server span = the unique span with the same `trace_id`, `kind: "server"`, `parent_span_id == trace_context.span_id`, same method; handler spans = `producttrace-express-handlers` spans descending from it; DB spans = `mongodb`/`mongoose`/`db.system` spans descending from a handler span (with the `findAndModify` collection taken from the command). The MCP's route/handler/db span-id sets must equal the grader's exactly.
- **Entry handler**: the MCP's `entry_handler.function_id` for each of the nine flows' credited action must equal the `after` id in `HANDLERS.md`, and its manifest file must equal the file in the table.
- **element_history**: for a fallback key `handler:<fid>|<event>`, the grader's action set = actions whose credited unit in `HANDLERS.md`/`causal-chains.jsonl` (`action_ids`) is that unit; the MCP must list each of them. For stamp keys: `dom.action.target.element_key` equality.
- **recent_actions**: `dom.action` rows sorted by `(timestamp, sequence)` descending, first n; ids must match in order.
- **resolve_element**: for selector / path / role / name / text probes without an `element_key`, `confidence` must be `ambiguous` and status `ambiguous` or `not_found` (never a pick). Exact resolution and `stale_build` are exercised on synthetic `element.stamp` rows in `test/mcp.test.mjs`, since final7 has no stamps.
- **compare_chains**: grader computes each action's `{request (id-normalized path), route, status, handlers, db keys, writes}` with its own join and diffs them; the MCP's `path_changed` and DB stop statuses must match.
- **Frontend-only**: with spans removed, no route/handler/db stop may appear anywhere and every request-bearing chain must say `stopped_at: "network"`, `because: "backend not instrumented"`.

Independence caveat: the grader and the implementation are written by the same agent on this branch. They share no code, but a separate agent should rerun the grader before the gate is declared passed.

Evidence: `docs/evidence/g4-mcp-2026-09-23/` (new, immutable once written): `RUN.md`, `GRADE-g4.md` (grader output), `manifest.json` (final7 subset).

## 5. Plugin packaging (§6.4)

`plugin/` is a Codex plugin in the format the research found in OpenAI's spec and in the locally installed first-party plugins: `.codex-plugin/plugin.json` (`mcpServers: "./.mcp.json"`, `skills: "./skills/"`, `interface{…}`), `.mcp.json` (stdio, `cwd: "."`, launcher `bin/tracer-mcp.mjs` that loads the server from the project's own `node_modules/producttrace`, never from the registry), `skills/tracer-annotations/SKILL.md`. A repo-local marketplace is at `.agents/plugins/marketplace.json`. The `~/.codex/config.toml` fallback, the Claude Code `.mcp.json`, and an `AGENTS.md` snippet are in `plugin/README.md` and `plugin/AGENTS-snippet.md`. The launcher resolves the store from `--store`, `TRACER_STORE`, `TRACER_PROJECT_ROOT/.tracer`, then the nearest `.tracer/` above the process cwd (stopping at a repository root). The `config.toml` fallback, which runs from the project cwd, is the recommended install until plugin cwd behaviour is verified. Unverified: that Codex starts a stdio server from a locally installed third-party plugin without extra approval, and how `env_vars` reach it (the plugin was not installed into Codex from this branch: that changes persistent user configuration).

## Amendment 2026-09-24: names from the build; error types (`fix/function-names`)

**Names.** `store.functionInfo` prints the manifest's build-time name as recorded. It never re-derives one. See the G2 amendment of the same date for the rules and the abstentions.

`name_status` vocabulary:

- `manifest`: the name the source gives the function.
- `inferred`: two cases.
  - name_kind `inferred`: the name is null and the display is in source shape, `save = useCallback(<callback>)`. The function was passed to a call whose result is bound, so the binding does not name the function.
  - A manifest without build-time names (every banked store): the text rule's result, `functionNameAt`, then `wrappedAssignmentAt`. `name_basis` says which applied: `store_writer_text_rule`, `checkout_text_rule` or `checkout_text_rule_via_call`.
- `anonymous`: no name. The display still gives the position, for example `<callback of items.map>`, `<button onClick>` or `<computed key>`.
- `not_recorded` and `not_in_manifest`: unchanged.

This replaces `source`, `source_via_call` and the old-manifest `manifest`. The names and labels of banked stores do not change. The statuses do: on final7, 433 `source` and 213 `source_via_call` rows become `inferred`, and on G5 and G6, 1,807–1,811 `manifest` rows become `inferred`.

Rendering changes:

- `label` uses `display_name`.
- `resolve_element` `handlers` (and each candidate's `keys[].handlers`), `work.entries` and the entry-handler stop carry `name`, `display_name` and `name_status`.
- When an entry-handler abstention occurs, `action_chain` adds `listeners`: the global listeners that ran and the handlers bound to the element, named. It also adds the text line `No element-bound handler credited; global listeners that ran: …; bound to the element: …`. The chain's `because` keeps the raw ids.

**Remap.** `remapFunctionId` compares `display_name` when both manifests carry `name_kind`, so a method matches by its class (`ApiClient.get`). Inferred and abstained names are never compared. Older manifests compare `name` as before. The G6 compare regenerated on this branch differs from `main` only by the added name fields and `manifest` → `inferred`. `test/g6-grader.mjs`: 6/6.

**Error types.** The runtime records `error_class_id` when the thrown object's own constructor is an instrumented class, or `error_builtin: true` when the constructor is the platform global of that name. It never records a name beyond the runtime constructor name, which it already kept in `error_type`.

Readers turn the signal's `error_type` into `{ minified, source, source_basis }`:

- `source` comes from the manifest's `classes` (`source_basis: "manifest"`) or is the builtin's own name (`"builtin"`).
- Otherwise `source` is null (`"not_recorded"` or `"class_not_in_manifest"`).

Text prints the source name, else `runtime type <name>`. A minified name is never printed as a source name. On the fixture's production build a thrown `ApiError` reads `{ minified: "Rt", source: "ApiError", source_basis: "manifest" }` and `handler_threw (ApiError)`. Banked rows carry neither field, so they now read `runtime type TypeError` where they read `TypeError`.

### Revision after the independent grade (2026-09-24, same branch)

- **`name_status` for older stores is split.** A text-rule name that is the function's own (a `function resubmitMessage` declaration, a binding or a key) is now `inferred_from_source_text`: a usable name that no build verified. `inferred` has one meaning in both old and new stores: the function was passed to a call whose result is bound, so `name` is null and `bound_to` keeps the binding. The label is unchanged (`confirmDelete (via useCallback)` on old stores, `x = useCallback(<callback>)` on new ones). On final7, 433 `source` rows become `inferred_from_source_text`. 213 `source_via_call` rows become `inferred` with `name: null` and `bound_to` set. No label changes. On G5 and G6, the enriched `manifest` rows become `inferred_from_source_text`.
- **Remap.** `name_match` compares the qualified display name without its ` (exported as …)` suffix. A revision that adds or removes `export default f` still maps `f` by name.
- **Callback names.** A callback is named after the callee's parameter only when the callee's name has exactly one binding in the file, that binding is a function, and its scope encloses the call. Every other case abstains to `<callback of f>` with a null name. That covers imports, destructured variables and parameters, array patterns, class and enum names, catch and loop variables, and any second function of the same name. Before this change, an imported or destructured `update` took the parameter name of an unrelated `update` elsewhere in the file and printed it as `manifest`.
