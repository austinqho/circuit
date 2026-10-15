# Gate G5: end-to-end demo (annotate an element, ask why it failed)

Gate text written before code, 2026-09-23. Branch `g5-demo` from `582810ae` (G1/G3 head, on `main` `47587bd9` with G2/G4/G6).
Sources: `docs/HANDOFF-2026-09-23-agent-annotation-pivot.md` §3.1, §4, §6, §7 G5, §8 item 1; `docs/research/oai-annotation-unknowns-2026-09-23.md` (main checkout, untracked, internal only); `docs/gates/G2-generality.md`, `G3-stamps.md`, `G4-mcp.md`, `G6-verification.md`; `plugin/`.

## 1. Pass criteria (verbatim from the handoff §7)

> **G5 End to end (the demo gate).** Fresh Vite + React repo, `npm i producttrace` + one plugin line, zero source edits. In Codex's IAB, annotate an element after performing an action on it. Codex, using only the Tracer MCP, returns the component file:line, the entry handler, and the last n actions on that element with request/route/outcome (or frontier). Graded independently against raw records. Demo question must require history ("why did this fail?"), not location ("what component is this?"), because click-to-source already exists (LocatorJS, click-to-component, React DevTools).

§8 item 1 (resolved by the research note §1): Codex's manual IAB annotation does **not** carry `data-*` attributes to the model. The prompt carries `Page URL`, `Target` (aria-label or first 80 characters of text), `Target role`, `Target selector` (≤ 4 levels; tag, `#id` where the walk stops, at most the first two classes matching `/^[a-zA-Z0-9_-]+$/`, `:nth-of-type(n)`; joined with `" > "`, shadow hosts with `>>>`; not guaranteed unique), `Target path` (tag names, ≤ 4 levels) and `Nearby text`. The skill's browser-tool step (read `data-tracer-el` from the live DOM) is therefore required, not optional. OAI declarative attributes (`oai-annotatable`, `oai-annotation-metadata`) are read only when OpenAI's API gate is on, which it is not for anyone we can observe.

Binding doctrine (handoff §5.2): headless Playwright only; no model in the path; identifiers attach, timestamps only order; abstain over guess; explicit frontiers ("reached / stopped at / because"); no repo-specific rules in the package (the per-repo session script under `test/browser/sessions/` may know the app); evidence dirs immutable; an independent grader recomputes every answer from raw rows.

## 2. What this gate can and cannot claim

The Codex step itself (a person annotating in Codex's IAB, Codex's model choosing tool calls) cannot run headless and cannot run from this branch: installing anything into Codex or changing `~/.codex` is Austin's call. G5 is therefore split:

- **Part A, automated rehearsal** (`test/browser/g5-rehearsal.mjs`, headless). Everything Codex would do, done by a script that follows the skill literally: perform the actions, derive the annotation evidence exactly as Codex's manual annotation derives it (research §1), run the skill's DOM lookup, then call the real MCP server over stdio (`producttrace-mcp --store`) with `resolve_element` → `element_history` → `action_chain`. The MCP request/response transcript is the "what Codex would read" exhibit. The grader recomputes every answer from the raw store.
- **Part B, the human runbook** (`docs/G5-RUNBOOK.md`). The same demo in the Codex desktop app's IAB, run by Austin.

The gate passes on Part A plus an independent regrade. The clause "In Codex's IAB … Codex returns" is **not reached** until Austin runs Part B and records the transcript; this document says so rather than claiming it.

## 3. Scenario

Fixture: `Mintplex-Labs/anything-llm` at `ad97bc8dfcb6919f34f7d6d0c722efdda64d66d9` (`/Users/austinho/dev/fixtures/anything-llm`, G2 primary). Express `server/`, Vite + React `frontend/`, Prisma/SQLite, no LLM key. Ports 4100 (static + API proxy), 4101 (fixture server), 4102 (collector).

### 3.1 The failing action: survey, then fallback

A genuine app validation failure that returns a 4xx from an Express route and is reachable from the UI without an LLM key was looked for first. Findings (read from the fixture source at `ad97bc8d`):

| candidate | route status on bad input | reachable from the UI? |
|---|---|---|
| create workspace, empty/duplicate name (`POST /workspace/new`) | 200 (`Workspace.new` accepts; errors come back as `message` with 200) or 500 | yes, but no 4xx |
| rename workspace (`POST /workspace/:slug/update`) | 200 (`message` in body); 400 only for an unknown slug | no 4xx from the form |
| slash-command preset with a reserved command (`POST /system/slash-command-presets`) | 400 | **no**: `AddPresetModal` rejects reserved commands before the request |
| memory over the per-scope limit (`POST /workspaces/:slug/memories`) | 400 | **no**: the Add button is disabled at the limit (`LIMITS` in `MemoriesContext.jsx`) |
| system prompt variable, duplicate key (`POST /system/prompt-variables`) | 500 (thrown in `_checkVariableKey`) | yes, but 5xx |
| admin "add user" with an invalid username (`POST /admin/users/new`) | 200 with `error` | multi-user only; no 4xx |
| single-user login with a wrong password (`POST /request-token`) | **401** | yes, genuine; but the login form unmounts on success, so "success → failure → success, then annotate the same element" cannot end with the element on screen |

No candidate fits "succeed, fail with a 4xx, succeed again, then annotate the element". So the **G6 seeded 422** is reused, as the gate brief allows: on a throwaway fixture branch `g5-scenario`, one commit adds to the update handler in `server/endpoints/workspaces.js`

```js
if (typeof data?.name === "string" && /\s/.test(data.name)) {
  response.status(422).json({ workspace: null, message: "Invalid workspace name." });
  return;
}
```

(the exact G6 seed, `docs/evidence/g6-anything-llm-2026-09-23/fixture-scenario.patch` patch 1/5). The frontend is untouched, so the instrumented bundle is byte-for-byte the upstream frontend. After the run the fixture is restored to `ad97bc8d` on `master` with an empty `git status --porcelain`, and the branch is deleted. The wrong-password 401 is recorded as the genuine alternative in `LIMITS.md`.

### 3.2 Actions (session `test/browser/sessions/anything-llm-g5.mjs`, trusted input only)

1. open the "New Workspace" form, type `Tracer G5`, Save (slug `tracer-g5`);
2. open the workspace settings (General appearance);
3. **rename OK**: replace the name with `tracer-g5-first`, click *Update Workspace* → 200;
4. **rename FAILS**: replace the name with `Tracer G5 second` (whitespace), click *Update Workspace* → 422;
5. **rename OK**: replace the name with `tracer-g5-third`, click *Update Workspace* → 200;
6. **annotate**: type one character into the name field so *Update Workspace* is rendered again (the form only shows it while there are unsaved changes), and annotate that button. Nothing is submitted.

The annotated element is the button the user clicked. The question is "why did this fail?", which needs the history (step 4 of three attempts), not the location.

### 3.3 Install: one plugin line, zero source edits

As in G2: the package is `npm pack`ed, the tarball is extracted into a consumer directory outside the fixture, and a generated wrapper config imports the fixture's own `vite.config.js` unchanged and adds one line:

```js
...producttrace({ stamps: true, requestBridge: false, collector: "http://127.0.0.1:4102" }),
```

`stamps: true` is the default (G3), written out for the reader; `requestBridge: false` makes the runtime's own transport wrappers the only request source (G1 D-G1-3).

**D-G5-1. Browser → collector transport (package change).** The runtime today only hands rows to a host hook (`globalThis.__producttraceHostCapture`), which only the test harnesses define. In a real install (and in Codex's IAB) nothing reaches a store. G5 therefore adds a dev-only plugin option `collector: <url>`: the injected settings script installs a sink that chains any existing host hook, batches rows (`capture_page_id` = the runtime's page session `s_…`, the same value as `tracer_session` in OAI metadata), and POSTs them as `text/plain` JSON arrays (a CORS-simple request) to `<collector>/ingest` with the native `fetch` captured before the runtime wraps it, so its own posts never become `network.request` rows. `pagehide` flushes the tail with `sendBeacon`. Failed batches are retried, then counted in `globalThis.__productTraceCollectorStats().dropped`; never silently dropped. Without the option nothing changes. This is generic (no repository knowledge) and is tested in `npm test`.

Backend: the fixture server runs with the package's `startNodeBackendTelemetry({ adapters: ['http', 'express'] })` preload (G2), spans shipped to the harness, which relays each span to the collector's `/spans` and keeps its own copy for the build gates. No DB spans exist (Prisma/SQLite has no adapter), so every chain stops at `handler` (G6 LIMITS 1).

## 4. Store layout

`<fixture>/.tracer/`, written only by `producttrace-collector --store <fixture>/.tracer --manifest <build manifest> --source-root <fixture> --label <label> --port 4102`, started from the installed tarball, exactly the G6 layout (`docs/gates/G6-verification.md` §3):

```
<fixture>/.tracer/
  records.jsonl            producttrace.runtime-evidence.v1 rows (incl. element.stamp), each tagged tracer_run, tracer_build
  spans.jsonl              producttrace.backend-span.v1 spans, tagged the same
  runs.jsonl               one producttrace.store-run.v1 row, written when the collector gets SIGTERM
  manifests/<build>.json   the build's attribution manifest (enriched with text_sha256/name from --source-root)
```

Rows arrive in network order, not sorted; the store reader orders by `(timestamp, page, sequence)`. The harness keeps its own lossless capture (G2 `/__capture`) and cross-checks it against the store: per kind, the same row count, and the same set of `(kind, sequence | stamp_sequence, action_id)` triples. The harness's source-clean check excludes exactly `.tracer` (G6 §3.4). After the run the store is copied gzipped into the evidence dir and deleted from the fixture.

## 5. Part A: the automated rehearsal (`test/browser/g5-rehearsal.mjs`)

1. Runs `build-fresh-repo.mjs` with the G5 session, `--plugin-options` (the line above), `--collector`, `--store <fixture>/.tracer`. All G2 build gates still apply (marker gate, parity with Tracer's own attributes removed, smoke, lossless capture, transports reconciled, source clean).
2. After step 6, **the user's annotation**: the session names the element (the *Update Workspace* button, found by role and text). The rehearsal derives the anchor Codex would send, with a reimplementation of the research note's builders: target = climb from the element under the pointer to the first `a|button|input|textarea|select|label|img` or `[role]` ancestor (gate-off rule `sl`); `Target selector` (≤ 4 levels, tag, `#id` stop, first two regex-passing classes, `:nth-of-type(n)`); `Target path`; `Target` (aria-label or collapsed text ≤ 80); `Nearby text` (own text, else nearest `section,article,main,form,nav,aside,header,footer`). It writes `annotation-anchor.json`, the prompt block as Codex would format it (`annotation-prompt.txt`), a screenshot, and the target's `outerHTML` (with its `data-tracer-el`).
3. **The skill's browser-tool step**, run in the page from the prompt fields only (it never sees the element handle): `resolveAnnotatedKey(document, { selector, target, nearby_text })` from `mcp/annotation-lookup.mjs` matches the selector (its own matcher for the Codex grammar, including `>>>`; cross-checked against `document.querySelectorAll` when there is no `>>>`), keeps the matches whose text agrees with `Target`/`Nearby text`, requires exactly one, then `closest('[data-tracer-el]')`, else the first `[data-tracer-el]` descendant. Pass: exactly one match, a key found, and the key equals the annotated element's own `data-tracer-el`.
4. The store is closed (collector SIGTERM). The rehearsal starts `node <install>/node_modules/producttrace/mcp/server.mjs --store <fixture>/.tracer --source-root <fixture>` (the tarball's `producttrace-mcp`) and speaks MCP over stdio as a client: `initialize`, `tools/list`, then
   - `resolve_element({ element_key })`,
   - `element_history({ element_key, n: 10 })`,
   - `action_chain({ action_id })` for the failing attempt,
   - the no-key fallback: `resolve_element({ url, selector, element_path, name, nearby_text })` (no `element_key`).
   Every request and response is written verbatim to `mcp-transcript.json`; `AGENT-READS.md` renders what the agent reads.

Assertions (each recorded PASS/FAIL in `REHEARSAL.md` with the evidence path):

| id | assertion |
|---|---|
| A1 | DOM step: one selector match after the text filter; key found via `closest`; equals the annotated element's `data-tracer-el` |
| A2 | `resolve_element`: `status: "ok"`, `confidence: "exact"`, `key_kind: "element_stamp"`, `component` and `source.file:line` equal the `element.stamp` row, and at that line of the fixture file the text at the recorded `start` is `<` + the recorded tag (graded against source) |
| A3 | entry handler: every attempt in the history names the same entry-handler function, and it is the developer-named one: the function bound as the form's `onSubmit` (`handleUpdate` in `frontend/src/pages/WorkspaceSettings/GeneralAppearance/index.jsx`), file:line checked against source |
| A4 | `element_history`: the three attempts, newest first (attempt 3, 2, 1), each with request `POST /api/workspace/tracer-g5/update`, route `/workspace/:slug/update`, HTTP status 200 / 422 / 200, and the frontier (`reached handler / stopped at handler / because …`); the 422 attempt's `because` starts `server responded 422;` |
| A5 | `action_chain(failing action)`: `because` names the 422; the route stop has `status_code: 422`; `stopped_at: "handler"` |
| A6 | no-key fallback: `status: "ambiguous"`, `confidence: "ambiguous"`, and the candidates include the annotated key (never a pick) |
| A7 | store cross-check (harness capture = store rows, §4); fixture restored: `git status --porcelain` empty, HEAD `ad97bc8d`, branch deleted |

A dispatch on the button produces two `dom.action` rows (the `click` and the form's `submit`, whose recorded target is the submitter), so the element's history holds two actions per attempt, sharing one episode. "The last n actions" is graded per attempt (episode). If `element_history` lists only raw actions, an additive `attempts` field (distinct episodes among the listed actions, newest first, with their request/route/status/frontier) may be added, recorded here as an amendment; G4 fields do not change.

## 6. How the grader recomputes each answer (`test/g5-grader.mjs`)

Imports nothing from `analysis/`, `collector/`, `mcp/`. Inputs: the raw store (`records.jsonl`, `spans.jsonl`, `manifests/*.json`), `annotation-anchor.json`, `mcp-transcript.json`, the fixture checkout at `ad97bc8d` plus the seed text (for the server file). It recomputes:

1. **Key**: the annotated element's `data-tracer-el` (from the anchor file's `outerHTML`); it must equal the MCP's `element_key` and occur in exactly one placement across the store's `element.stamp` rows.
2. **Component + file:line**: from the `element.stamp` rows for the key: `file`, `start`, `tag`, `component`; the grader reads the fixture file, computes the line of `start` and checks the text at `start` begins with `<` + tag. The MCP's `component` and `source` must equal it.
3. **Actions on the element**: `dom.action` rows whose `target.element_key` equals the key, ordered by `(timestamp, capture_page_id, sequence)`.
4. **Attempt grouping**: a click and a submit are one attempt when the submit's `target.ref` equals the click's `target.ref` and the submit is the next `dom.action` on the page with that `form_ref` (identifier equality; timestamps only order). The MCP's per-attempt answers must match the grader's attempts, newest first.
5. **Request per attempt**: `network.request` rows with the submit's `action_id`, not internal: method + pathname.
6. **Route/status**: the unique span with the request's `trace_context.trace_id`, `kind: "server"`, `parent_span_id == trace_context.span_id`; its `http.route` and status code. Handler spans: `producttrace-express-handlers` spans descending from it. DB spans under a handler: counted (expected 0).
7. **Entry handler**: the first `function.enter` of the submit action at depth zero under the dispatch (`parent_continuation_id` starts with `continuation:<action_id>:action:`), mapped through the build manifest to `file:start-end`; the grader checks in the fixture source that this span is the arrow assigned to `handleUpdate` and that the file contains `onSubmit={handleUpdate}`.
8. **Frontier**: expected `stopped_at: handler` for all three; the 422 attempt's `because` must contain `422`.
9. **Fallback**: the MCP's fallback result must be `ambiguous` and list the key.

Output `GRADE-g5.md`. The same agent writes grader and implementation; a separate agent must rerun the grader before the gate is declared passed.

## 7. Part B: the runbook (`docs/G5-RUNBOOK.md`)

Exact steps for Austin: set up the seeded fixture branch; start the fixture in hold mode (`build-fresh-repo.mjs … --hold`: build with the one line, start backend + collector + static server, print the URL and the MCP command, wait for Ctrl-C); add `[mcp_servers.tracer]` to `~/.codex/config.toml` (recommended) or install the repo-local plugin (secondary); open the URL in the IAB; perform the three renames; type a character; annotate *Update Workspace*; ask "why did this fail?"; the expected answer; restore the fixture. It states that `data-*` never reaches the model (the browser-tool step is required) and that OAI attributes matter only once OpenAI's gate is on (feature-detected; `oaiAttributes: 'always'` is a dev-only test switch with a stub).

## 8. Tests (`npm test`)

- `test/annotation-lookup.test.mjs`: the selector-to-stamp helper on a small in-memory DOM, four selector shapes: (a) `#id` step, (b) tag + two classes + `:nth-of-type`, (c) a 4-level chain whose target is a descendant of the stamped element (`closest` climbs), (d) a non-unique selector disambiguated by text; plus a wrapper whose stamp is on a descendant (descendant fallback), `>>>` shadow joins, zero or several matches → no key (abstain).
- `test/collector-sink.test.mjs`: the `collector` option emits the settings sink; the sink chains an existing host hook, batches with `capture_page_id`, uses the pre-wrap `fetch`, and reports drops.
- `npm test` green except the known `react-context-ref-semantics` failure.

## 9. Evidence

`docs/evidence/g5-anything-llm-2026-09-23/` (new, immutable once written): `RUN.md` (commands, fixture state proof, tarball integrity, sha256 + row counts), `LIMITS.md`, `REHEARSAL.md`, `store/` (gzipped), `mcp-transcript.json`, `annotation-anchor.json`, `annotation-prompt.txt`, `annotated-element.html` (outerHTML with the stamp), screenshots of the three attempts and the annotated element, `AGENT-READS.md`, `GRADE-g5.md`, and the harness's per-run files under `run/`.

## 10. Amendments after code started, before the evidence run (2026-09-23)

Found on a scratch trial run (outside `docs/evidence`), recorded here before the evidence run:

- **D-G5-2. Repeated submits of one form were one episode (G4 defect).** `indexWorkflowEpisodes` keeps every action on a form in one episode "through rejected and successful submits", carried by the last effectful submit. With three request-bearing submits of the rename form, `element_history` gave every attempt the *last* attempt's request and status (the 422 attempt read 200). Fix, in the store only (`collector/store.mjs` `splitRepeatedFormSubmits`; the M1 viewer's grouping is untouched): when a form episode holds two or more submits that own a non-internal request (by `action_id`), it is split at each such submit; rejected submits stay with the next request; actions after the last one form a trailing segment. Episodes with fewer than two such submits keep their id and content. Checked: final7 and the G6 store have no such episode (G4 grader 81/81 unchanged; G6 grader 6/6 unchanged). Test: `test/g5-store-attempts.test.mjs`.
  - *Superseded by §12.1, §14 and §15.* The rule now lives in the shared `indexWorkflowEpisodes` and applies to **any form with actions after a request-sending submit**, not only to forms submitted twice: one submit followed by more actions on the form (other than effect-less ones, §14) already gives two episodes, so "fewer than two such submits keep their id and content" no longer holds. Because the M1 viewer uses the same indexer, its episode cards change the same way: one card per request-sending submit, plus a card for later effectful actions on the form. In the independent regrade this changed the G6 create-workspace submit's chain, for the better; the G6 comparison answers are unchanged.
- **`element_history.attempts` (additive).** One attempt dispatches `focusin`, `click` and `submit` on the button (the submit's recorded target is the submitter), all in one episode. The listed actions are also grouped by episode id, newest first, each with the episode chain's entry handler, request, route, outcome and frontier. No G4 field changes. The A4 assertion reads `attempts`.
- **D-G5-3. No-key fallback and the annotation's pick.** Codex's gate-off pick (research §1, `sl`) stops at the first ancestor that is interactive, has a role, *or has text and is ≥ 24×16 px*: under the pointer on *Update Workspace* that is the button's inner `<div>` label, not the `<button>`. The skill's `closest('[data-tracer-el]')` step handles that (the key is on the button). The no-key fallback, however, compared only the selector's last compound (`div`) with recorded `dom.action` targets (`button`) and returned `not_found`. `rankTargetCandidates` now also accepts a recorded target whose tag is one of the selector's ancestor steps or the path's ancestor tags (`matched_on: "ancestor tag=button (…)"`). Still a ranked list, never a pick; `confidence` stays `ambiguous`.
- **Route value.** The Express span's `http.route` for the update is `/api/workspace/:slug/update` (the app mounts its router under `/api`). A4/§6 compare the route with the span's own `http.route`, not with the literal written in §5.
- **Harness.** `build-fresh-repo.mjs` dropped `element.stamp` rows from its lossless capture (they carry `stamp_sequence`, not `sequence`), so the capture was never lossless with stamps on. It now keeps them, checks both counters for contiguity, and orders them after the page's runtime rows. The span cross-check counts only spans received after the collector started (the parity and smoke page loads precede the store). The parity gate removes `data-tracer-el` and the OAI attributes as Tracer's own attributes, like `data-producttrace-*`.

## 11. Results (2026-09-23; not yet independently graded)

Evidence: `docs/evidence/g5-anything-llm-2026-09-23/` (`RUN.md`, `LIMITS.md`, `REHEARSAL.md`, `GRADE-g5.md`, `AGENT-READS.md`, `mcp-transcript.json`, `store/`, `run/`). Package packed from `03a22a0b`.

| assertion | result |
|---|---|
| A1 DOM step from the prompt fields (Codex picks the button's label `<div>`; `closest()` finds `p_f067e70e6029:117-485#n1`, 1 selector match) | PASS |
| A2 `resolve_element`: exact, `CTAButton`, `frontend/src/components/lib/CTAButton/index.jsx:8`, graded against source | PASS |
| A3 entry handler `GeneralAppearance/index.jsx:26` = `handleUpdate`, the form's `onSubmit`, same for all attempts | PASS |
| A4 `element_history.attempts`: 200, 422, 200 newest first; `POST /api/workspace/tracer-g5/update` → `/api/workspace/:slug/update`; stopped at handler; the 422 in `because` | PASS |
| A5 `action_chain` of the failing attempt: route 422, "server responded 422; …" | PASS |
| A6 no-key fallback: `ambiguous`, 3 candidates, the key among them | PASS |
| A7 store via the collector = harness capture (0 missing, 0 extra, spans 465 = 465); build gates; fixture restored to `ad97bc8d`, clean, branch deleted | PASS |

`test/g5-grader.mjs`: 22/22 PASS. The Codex IAB clause is not reached (Part B, `docs/G5-RUNBOOK.md`).

## 12. Coordinator decisions after the evidence run (2026-09-23)

Applied on `g5-demo` after `docs/evidence/g5-anything-llm-2026-09-23/` was committed; that directory is unchanged, and the recheck is a new directory.

1. **Episode split in the shared indexer.** One implementation for episodes, so the viewer and the MCP agree. `indexWorkflowEpisodes` (`analysis/runtime-attribution.mjs`) now closes a form episode at each submit that sent a request; the next actions on the same form start a new episode (`<form episode id>#<n>`; the first keeps the form's id, so ids are stable as evidence grows). A trailing segment with no effect and no submit is not an episode, as for any form group. The store's own `splitRepeatedFormSubmits` (§10 D-G5-2) is removed; `collector/store.mjs` calls the shared function. Checked: G4 grader on final7 81/81 PASS; final7 has no segmented episode; G6 grader 6/6 PASS and a rerun of `g6-compare.mjs` on the G6 store gives the same `path_changed`, per-stop statuses, outcome deltas and frontiers for all six pairs (the G6 store now has 24 segmented form episodes, none on the compared submits). The M1 viewer (`test/browser/server.mjs`) makes no assertions on episode counts; it already handles episode ids that disappear (reported as absorbed). (§15: a form episode no longer includes the control that rendered the form.) The one line of the G4 grade that differs from the pre-G5 grade is a fallback candidate count (5 → 6) from §10 D-G5-3, still PASS.
2. **Collector sink: dev-only, localhost-only.** `collector` accepts a string or `{ url, allowRemote = false, force = false }`. A non-loopback absolute URL is refused at config time unless `allowRemote: true`. In a Vite `production`-mode build the sink is not injected (a warning is logged) unless `force: true`. The harness builds in production mode, so it passes `{ url, force: true }`. Documented in `plugin/README.md` and the runbook.
3. **Skill and runbook for an unknown browser tool.** The skill says to use the browser or page-inspection tool to read the attribute and, without one, to call `resolve_element` with the raw selector, path and nearby text and report the ambiguity. The runbook's first check (§3b) is whether the model reads `data-tracer-el` at all, and it shows what the ambiguous fallback answer looks like.
4. **Run row.** The collector accepts `POST /run-info {source, steps, extra}` and writes them into the run row at close; the harness posts the fixture commit, clean flag and step windows, so `runs.jsonl` no longer has `source: null, steps: []` (evidence LIMITS 8 applies to the committed run only).

## 13. Closes after the independent grade (2026-09-23)

The independent grade (`docs/evidence/g5-grade-independent-2026-09-23/GRADE-g5-independent.md`) passed Part A at `cca9ac3e`; its non-blocking findings are closed here. Evidence directories are unchanged.

1. **Descendant fallback** (`mcp/annotation-lookup.mjs`, finding 3): an element with no stamp on itself or above, but several distinct stamped descendants, now gives `status: "ambiguous"`, `reason: "several_stamped_descendants"`, `element_key: null` and `candidate_keys` (all of them). One stamped descendant is still `ok` via `descendant`.
2. **`element_history` `n`** (`mcp/tools.mjs`, finding 4): `n` counts attempts (episodes on the element), not actions; default 10; all actions of the n newest attempts are returned. Schema and tool description say so. Test: three attempts, each with twelve keystrokes, all come back at `n: 3` (36 actions), and `n: 1` gives the newest attempt's 12. On the rerun store `n: 5` now returns all 3 attempts (9 actions).
3. **Malformed host payloads** (`integrations/collector-sink.mjs`, finding 2): counted in `__productTraceCollectorStats().malformed`, one console warning on the first drop or malformed row, and shipped as a `capture.dropped` row (`reason`, `length`, never the content). The store adds those to `malformed_records` (and reports `dropped_in_page`). The test that asserted the silent drop now asserts the count and the row.
4. **No-key fallback grouping** (`analysis/element-index.mjs`, finding 5): with stamp rows, candidates are grouped by (target signature, element key), so SearchBox and CTAButton are separate candidates with their own `actions_observed` (2 and 9 on the rerun store, not one of 11). Still `ambiguous`, never a pick.
5. **Harness**: the generated wrapper Vite config is copied into the evidence directory (`vite.g2.config.mjs`) on every future run (finding 6).
6. **Runbook**: §3b step 4 covers a model that can read attributes but not run JS, and how `lookupSnippet` is generated (Node); the fallback answer is updated to the per-key candidates; `codex mcp list` is marked unverified with an alternative check.

The sink's localhost/production guard (finding 1) was already applied in `7f91a252` (§12); the independent grade did not cover it.

## 14. Regrade residuals (2026-09-23)

The regrade (`docs/evidence/g5-grade-independent-2026-09-23/GRADE-g5-independent.md`, second section) passed G5 at `d900f009` and listed residuals.

1. **Effect-less trailing form actions** (residual 1): actions on a form after its last request-sending submit that have no request, no DOM change and no submit (typing after a save) joined no episode, so each keystroke became a standalone episode and `element_history({field, n: 2})` returned single keystrokes. Now such a trailing segment joins the form's most recent episode; its carrier and frontier stay those of the request-sending submit. A form with no effect at all still has no episode, as on main. Test: the regrade's synthetic case in `test/g5-store-attempts.test.mjs` (two saves, then three keystrokes: two episodes, the keystrokes in `#2`, `n: 2` returns both real attempts).
2. **Gate text for the split rule** (residual 2): §10 D-G5-2 now says the rule applies to any form with actions after a request-sending submit, and that the M1 viewer's cards change with it.
3. **`POST /run-info` origin** (residual 3): documented in `collector/index.js` and `plugin/README.md`. The collector sends `access-control-allow-origin: *`, so any page the developer visits could post to `/run-info` and overwrite the run row's `source`/`steps`/`extra`. The listener binds loopback only, so the risk is low. A token or an `Origin` check would close it; that is not done.

## 15. No cross-control episodes (2026-09-24)

**Claim.** An action's chain is never printed under another action on a different control.

**Defect.** `indexWorkflowEpisodes` folded actions on different controls into one episode in four ways: (a) a control added by an action's mutation receipt (`added_controls`) made later actions on it children of that action, so a click that only opened a confirmation dialog shared an episode with the Enter inside the dialog and printed the Enter's handler and DELETE as its own chain; (b) a form rendered by an action (`added_forms`) pulled that action into the form's episode; (c) an unformed action within 2000 ms of a form's `combobox`/`aria-haspopup` control joined that form (a time window); (d) the browser runtime wrote the opener's form as `form_ref` on every action inside a portal (`role=dialog|listbox|menu`) that a form action rendered, so the portal's actions joined the opener's form. On the banked stores this printed, for example, the G5 create-workspace modal's opener click with the form's `GET …/is-agent-command-available` and handler, and each G6 thread-item options click with another control's `POST …/thread/<id>/update`.

**Rule (replaces the "including the action that rendered it" and portal rules).**
- An episode folds only actions on the **same control** (the dispatch target's identity, `target_ref`) or **form members of the same form** (`form_ref`, the form the target is a descendant of).
- A **form member** is either (a) a field event on one of the form's fields: `input`, `change`, `keydown`/`keyup`, focus, or a click on an `input` (other than type submit/image/button/reset), `textarea`, `select`, a contenteditable or `role=textbox`; or (b) a submit-capable action: a `submit` event, a click on a control that can submit the form (`<button>` with no `type` or `type="submit"`, `<input type="submit|image">`), or Enter in a field (a field keydown). Focus on a non-field control is a member only when the next action on that control is. Target attributes come from the `dom.action` row.
- Not a form member, so its own episode even though it is inside the form: a click on `type="button"` or `type="reset"`, a click on any control with `aria-haspopup` or `aria-expanded` (even with no `type`), and a click on a non-field, non-submit control (`<div role=button>`, `<a>`). With a mutation receipt and no request its frontier reads `reached: "dom_mutation", stopped_at: "browser"`. With no mutation it reads `reached: "entry_handler"` or `"dispatch"`, still with `stopped_at: "browser"` (the scoped absence sentence, per main's frontier vocabulary since PR #4). If it sent a request itself, it keeps its own episode and prints that request, never the form submit's. So an opener inside a form never prints the request that the form's submit later sends.
- Actions on different controls are separate episodes, even when close in time and even when one opened the UI the other lives in. A click outside any form that opens a dialog, menu, listbox or form is its own episode. The action inside the dialog that sends the request is its own episode carrying the request.
- A portal is not inside the opener's form. The runtime keeps the opener's form as evidence only (`portal_opener_form_ref` on the `dom.action`) and never writes it as `form_ref`. `added_controls` and `added_forms` stay in mutation receipts as evidence of what an action rendered; they are never a membership key.
- Unchanged: focus followed by the next action on the same control is one episode; repeated request-sending submits on one form split (§12.1); a form's trailing actions with no effect join its most recent episode (§14.1); context actions outside any form with no effect are no episode.

Code: `analysis/runtime-attribution.mjs` `indexWorkflowEpisodes`; `src/runtime-attribution-browser.js` (and its `dist/` copy) `beginDomAction`. The M1 viewer uses the same indexer, so its cards change the same way: an opener's card is no longer retracted as "absorbed" when its dialog or form is used.

Tests: `test/runtime-attribution.test.mjs` covers:
- Remove → portal dialog → Enter → DELETE, with the opener outside and inside a form: two episodes; the opener's chain has no request and reads `reached: "dom_mutation", stopped_at: "browser"`; the Enter's chain carries the DELETE and `key: Enter`.
- An opener inside a form, followed by that form's own submit, for five opener kinds (`aria-haspopup`, `type="button"`, `aria-expanded` with no type, `div role=button`, `<a>`): two episodes, and the opener has no request.
- A `type="button"` control inside a form that sends its own request: it keeps that request.
- A dialog with its own form, and a menu opener and its option.
- The negative: typing then submit in one form is one episode.

Headless: `node test/browser/no-cross-control-neutral.mjs` on the neutral fixture `test/browser/fixtures/confirm-dialog-app`. It covers three dialog variants; the beta form's own submit (`POST /api/beta`) after its opener was used; the negative; and, for every episode, "one control or one form". On main at `ff9210ee` that harness fails: all three openers share the Enter's or the dialog form's episode, and the gamma opener also appears in the beta form's episode through the time window.

Effect on banked evidence (recomputed, evidence directories unchanged):
- G4: `test/g4-grader.mjs` on final7 81/81, report byte-identical before and after; final7's episodes are identical (46 → 46, no membership change).
- G5: replaying the `g5-anything-llm-2026-09-23c` MCP transcript gives the same answers; the only difference is the `coalescing_rule` string. Episodes stay 9, but 26 actions move: the create-workspace modal's opener (focusin + click) leaves the form episode and now reads `reached: "dom_mutation", stopped_at: "browser"` with its own handler. On both stores (and the Part B store `g5-codex-partB-2026-09-23`), the sidebar button that opens the create-workspace modal (`SearchBox/index.jsx:196`) is its own attempt instead of riding in the create-workspace form's episode, another sidebar button no longer rides in that form's second segment, and the create-workspace submit, which rendered the chat form, is no longer listed under the chat form's episode too (via `added_forms`). As a result, `element_history` on the modal's submit button gives one attempt instead of two. The three attempts on the rename button (`CTAButton/index.jsx:8`, 200/422/200) are unchanged.
- G6: `g6-compare.mjs` rerun on the G6 store gives compare results identical to the pre-change rerun except the store's episode count (72 → 90); `test/g6-grader.mjs` 6/6 on both. 48 `action_chain` summaries change, all openers: thread-item options and the create-workspace modal opener now read `reached: "dom_mutation", stopped_at: "browser"`, and sidebar workspace/thread links now carry their own request instead of another control's.
- G1/G2 stores also gain episodes (for example g1-2026-09-23f backend-on 32 → 60, g2 bulletproof-react r3 15 → 18) for the same reason. Their graders were not rerun.

Grade: `docs/evidence/pr-no-cross-control-merge-grade-2026-09-24/GRADE.md` (merge with changes). Its gap: an opener inside a form was still a member of the form's episode and printed the form's later request. The form-member rule above closes that gap. On the banked stores it changes nothing relative to the first version of this change: final7, G5 (`-23c` and Part B) and G6 have identical episode membership. G4 81/81 and G6 6/6 were rerun, and the compare JSON is identical apart from the store block.

Limit: stores recorded before this change carry portal-inherited `form_ref` values that can't be told apart from real form ancestry, so rule (d) applies only to new captures. Rules (a) to (c) apply to every store.


## 16. Episode focus (2026-09-24, `fix/episode-focus`)

Claim: a focus that happens as part of one action's work belongs to that action, and an episode member never prints the carrier's chain.

**Defect.** A click on a "Remove" control opens a portal confirm dialog; the dialog focuses itself on mount (React `autoFocus`, or `useEffect(() => ref.current.focus())`); about 500 ms later the user presses Enter in the dialog and its handler sends a DELETE. The runtime recorded the dialog's autofocus as a `focusin` `dom.action`; the §15 rule "focus folds into the next action on the same control within 1000 ms" attached it to the Enter; and `action_chain` for the focus printed the Enter's handler and the DELETE. A reader of the click's time window was told a delete happened there. Separately, any non-carrier member of an episode (a focus, a click on a submit button, a keystroke in a form) printed the carrier's whole chain as its own.

**Rules.**
1. **Caused focus (runtime).** Creation-time ownership (§4.1 of the handoff; G1) decides who caused a focus. A `focusin` dispatched while a frame with an action is current after the ambient stack is settled (a handler on the synchronous stack, a live trusted dispatch, or a continuation the action created: its commit microtask, a receipted mount effect, a timer, a promise, an await) is that action's work, not a user gesture. The `dom.action` row is still written (capture wide) and gains `gesture: false`, `caused_by_action_id`, `caused_by_continuation_id` and `caused_via` (the root kind of the frame: `dispatch`, `microtask`, `mount_effect`, `state_effect`, `timer`, `promise`, `await`, …). A frame in a React scheduler lineage (a `MessageChannel` loop that multiplexes unrelated updates) or a frame with no action proves only that app code was running: `gesture: false`, `caused_by_action_id: null`, `cause_abstained: "scheduler_lineage" | "no_action_on_frame"`. With no live frame (Tab, pointer focus, `element.focus()` from outside any owned code) nothing is added.
2. **Caused focus (episodes).** A focus marked `gesture: false` never starts an episode, never folds into a later action (it is skipped when looking for the next action on a control, so it neither receives nor breaks a fold) and is never a form member. When it names a causing action that has an episode, it is listed under that episode as `caused: [{action_id, event, target_ref, caused_by_action_id, caused_via, gesture: false}]` and `caused_action_ids`, never in `action_ids`, so every episode still holds one control or one form. An abstained focus is listed nowhere. The chain record carries `caused`; the unlinked-evidence window treats caused ids as the episode's own.
3. **Unmarked focus keeps the §15 rule.** A trusted focus with no live causing action folds into the next action on the same control within 1000 ms. Every banked store predates the mark, so every banked episode is unchanged.
4. **Member chains.** For a non-carrier episode member (`action_chain` for its id, its `recent_actions` entry, its entry in `element_history.actions`, `compare_chains` on it), the chain shows only that member's own evidence (its own rows through the same assembler: its handlers, mutations, and requests it made itself) plus `episode_member: true`, `episode_carrier_action_id` and `episode_pointer`: "this action is part of episode X; its request is attributed to the carrier action Y" ("its evidence is attributed …" when the episode has no request). It never prints the carrier's requests, segments, routes, handlers or DB ops. The carrier is the chain's own carrier (`causal-chain.v1` `action_id`), as `episode_carrier_action_id` always reported. `element_history.attempts` still group by carrier with the episode's chain, exactly as before. A caused focus's `action_chain` is its own single-action chain plus `gesture: false`, `caused_by_action_id`, `caused_by_episode_id`, `caused_via` and `caused_pointer`.

No app-specific rule: the mark reads only the runtime's frame stack; the indexer reads only the mark.

**Code.** `src/runtime-attribution-browser.js` (`focusCause` in `beginDomAction`; `dist/` byte-identical), `analysis/runtime-attribution.mjs` (`indexWorkflowEpisodes`), `analysis/causal-chain.mjs` (`caused` on the record; unlinked window), `collector/store.mjs` (`chainForAction` member scope, `joinedRowsFor`), `mcp/tools.mjs` (`chainStops` scope, pointer fields, `renderChainLine`, attempts via `episodeView`).

**Tests.** Headless `node test/browser/episode-focus.mjs` on the neutral fixture `test/browser/fixtures/episode-focus-app` (autoFocus portal dialog; `useEffect` focus; click handler focusing another input; Tab control; dialog opened after a request resolves, committed by React's scheduler; three runs, identical signatures), asserting from raw rows and through the MCP server over stdio. On `main` at `fixes-2026-09-24` it fails at its first assertion (no mark), and `main`'s analysis on this branch's rows prints the DELETE (or the POST) under the focus in every case. `test/episode-focus.test.mjs` holds the rule on synthetic rows under `npm test`. `test/g5-store-attempts.test.mjs` now asserts the pointer on the click member instead of the carrier's route.

**Banked outputs.** Episodes are identical on final7, `g5-anything-llm-2026-09-23c`, `g5-codex-partB-2026-09-23` and the G6 store; `element_history.attempts` are identical for every element key in all four; the G6 compare JSON is identical for all six pairs; G4 81/81 and G6 6/6. What changes is every non-carrier member's own chain: final7 0 of 54 actions, G5 `-23c` 142 of 151, Part B 68 of 78, G6 318 of 408 (every changed action is a member; none is a carrier). Replaying the G5 transcripts: the answers the agent used (`attempts`, `action_chain` on the carrier, `summary`) are identical; only the member entries inside `element_history.actions` now carry the pointer instead of the carrier's request. Evidence: `docs/evidence/pr-episode-focus-2026-09-24/RUN.md`.

**Coordinator decisions (2026-09-24, same branch).**
- A focus whose cause was abstained stays visible (capture wide, explicit frontier): `recent_actions` and `action_chain` list it with `gesture: false`, `cause_abstained: "scheduler_lineage"` and `caused_pointer: "focus caused by app code committed from React's scheduler; causing action not attributable"` (for `no_action_on_frame`: "focus caused by app code running outside any action (cause abstained: no_action_on_frame); causing action not attributable"). It is in no episode and never a user attempt.
- Caused focuses are not user attempts: `element_history` does not count them toward `n` and never forms an attempt from one. A caused focus is listed among `actions` only when its causing action's episode is one of the kept attempts, and that attempt names it under `caused: [{action_id, event, caused_by_action_id, gesture: false}]`.
- Out of scope: other nested trusted dispatches (the `submit` from `requestSubmit()` inside a handler, and so on) are unchanged. Member chains keep `outcome.status: incomplete` plus the pointer; their own outcome label belongs to `fix/outcome-labels`.

**After the independent grade (2026-09-24, `GRADE.md` in `docs/evidence/pr-episode-focus-2026-09-24/`).**
- *Rule 1 now requires a provably live frame.* A frame left current by a native suspension the await rewrite does not cover (`for await` over a streamed body, async generators) or by an unwrapped callback is not live: the grader's stream probe showed a real Tab focus during a stream marked `gesture: false` and credited to the suspended click. Every frame the runtime makes current (a continuation when its callback runs, a function frame at entry) now carries the token of its synchronous run, and the token dies at the next microtask checkpoint. A focus is marked only when the settled frame is a live dispatch frame or carries a live token; otherwise the row is left unmarked and rule 3 (the fold) applies. Only the focus cause reads liveness; ownership of every other row is unchanged. The await rewrite was not extended to `for await` and async generators in this claim: that changes emitted code for every app (yield values, iterator `return`/`throw` paths, microtask interleaving) and is a G1 engine change of its own, and unwrapped callbacks (observers, idle callbacks) would still leave frames behind; the liveness check covers all of these for focus.
- *`element_history` never hides caused rows.* A key whose only rows are caused focuses lists them (`gesture: false`, pointer), with no attempts, not counted toward `n`, and a summary `0 attempts on element …; N caused focus(es) (not user gestures); newest: …`, never "no actions". A caused focus is also listed when it is no older than the oldest kept user action.
- *The `element_history` headline reads the episode view* of the newest user action, as `attempts` do; on the four banked stores the summary is byte-identical to `main`.

**After the regrade (2026-09-24, `GRADE.md` regrade section).** Liveness covers the inherited action, not only the frame. A function frame entered while the current frame is a non-dispatch frame left behind (dead run token), and a continuation captured from such a frame, keep their action for ownership (unchanged) but carry `stale_owner`; a focus inside them is `gesture: false`, `caused_by_action_id: null`, `cause_abstained: "stale_frame"`. Consequence: code resumed natively after a `for await` loop (for example `focusIt(input)` after the loop) runs on the frame the loop left behind and cannot be told apart at run time from an unwrapped callback (an idle-callback poll) running on the same left-behind frame, so both abstain; neither is credited and neither folds.
