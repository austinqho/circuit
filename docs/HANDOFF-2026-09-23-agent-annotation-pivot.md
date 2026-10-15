# Tracer handoff: the agent-annotation pivot (2026-09-23)

For the next Tracer session. Read this after `HANDOFF-2026-09-22.md` (engine state, doctrine, operating nuances) and before touching code. This file does three things: records what OpenAI has shipped dark in the ChatGPT/Codex desktop app, states the pivot this causes for Tracer, and specifies exactly which OpenAI surfaces Tracer connects to and how.

Evidence grades used below:
- **[internal evidence]**: from a read-only inspection of OpenAI's shipped desktop app, kept in the unpublished `docs/internal/`.
- **[public]**: documented by OpenAI.
- **[inference]**: our reading of the evidence. Treat as a hypothesis to test.
- **[unknown]**: nobody has checked. Listed in §8.

Primary source reports: internal (`docs/internal/`).

---

## 1. TL;DR

1. OpenAI has built, and gated off, a **page-to-Codex annotation API** in the desktop app's in-app browser (IAB): `document.oai.annotation` plus declarative `oai-annotatable` / `oai-annotation-metadata` attributes. A page can open Codex's annotation editor on a specific element with a pre-filled comment and up to 6 flat metadata fields (2 KB). The user always reviews and submits. Codex receives the metadata labeled "untrusted page evidence." [internal evidence]
2. The payload is deliberately tiny. **It can carry a pointer, not a history.** That is the gap Tracer fills: Tracer stamps each element with an id, and the agent resolves that id through a Tracer MCP server into component, source location, handler, and the actual runtime chain (request, route, DB op, outcome).
3. **The pivot:** for the next few weeks, Tracer's priority is "installable on any Vite + React repo, queryable by coding agents through MCP, packaged as a Codex plugin." This supersedes the M2 to M6 ordering until the gates in §7 pass. The M1 engine is unchanged and is the foundation.
4. **The build must work today without OpenAI's API** (it is off for everyone we can observe) and upgrade automatically when the API appears. Feature-detect; never depend on it.
5. We focus on applications 1 (annotation) and 2 (agent verification). Applications 3 and 4 are recorded in §3 so the schema does not preclude them, but are not built now.

---

## 2. What OpenAI is building (findings)

[Internal. The evidence-graded findings about OpenAI's desktop app (what ships dark, gates, timelines, other dark-shipped tools) are kept in the unpublished `docs/internal/` copy of this handoff. Summary: OpenAI has built, and not yet enabled, a page-to-agent annotation channel in its desktop app's in-app browser; Tracer targets its page-facing surface (§4) by feature detection and works without it.]

## 3. The four applications (why we are doing this)

All four read the same record. We build 1 and 2 now.

### 3.1 Annotation-grounded debugging (FOCUS, the demo)
**1a. Inside Codex's IAB.** Today: user annotates an element and writes "this is broken"; Codex gets pixels + selector + nearby text and then guesses (greps for text, guesses the component, reads code, hypothesizes runtime behavior). With Tracer: after the user submits, Codex (instructed by the plugin skill) calls Tracer MCP and gets "`SaveButton` in `settings/Form.tsx:88` → `handleSave` → `PATCH /api/profile` → 422 → no DB write, validation failed in `routes/profile.js`." It skips the guessing phase.
Precision note: the MCP does **not** write into the composer. Nothing Tracer does lands in the composer except, once OpenAI's API is live, the ≤6 metadata fields. Everything else is fetched by Codex after submit.

**1b. Live agent from anywhere (stretch).** Austin's headless live voice agent, working against a localhost app in ordinary Chrome. The user points and talks; the agent resolves what was pointed at through Tracer and answers end to end. This path does **not** use OpenAI's API at all (that is IAB-only), so it works in any browser. Design in §6.6.

### 3.2 Agents verifying their own work (FOCUS, the sharpest pitch)
Coding agents "verify" with tests or screenshots, neither of which proves the runtime path changed. With Tracer: capture the causal chain for an action before a fix, replay the same action after, diff the chains. "Before: click Save → `handleSave` → `PATCH /api/profile` → 422, no write. After: → 200 → `users.update`." Also: "did this refactor change the path of any user-triggerable action?" This is M5 aimed at agents. Exact joins are what make it trustworthy as a grader (the handoff's own lesson: Codex grades itself optimistically).

Demo loop combining 3.1 and 3.2: point at a bug → agent knows exactly what happened → fixes it → proves the runtime path changed.

### 3.3 AI output → what users did with it (DEFERRED)
Accept/edit/regenerate/abandon tied to `model_output_id`; edits as preference pairs and evals (Trajectory story). Needs M2 identity. Only constraint now: keep `model_output_id` / entity-id fields reservable in the record and MCP responses.

### 3.4 The app's own agent, with eyes (DEFERRED, north star)
An in-app agent that knows what the user just did ("do what I just did to the other three clips"). The map doubles as an action surface (auto-derived app-intents-style verbs). Constraint now: keep `actor` (user | agent | system) as a first-class field so agent actions and human actions share one record.

---

## 4. The OpenAI surface Tracer targets

[Internal detail removed from the published copy; the full section lives in `docs/internal/`.] What Tracer relies on, and only this: a page can expose an element for annotation declaratively with `oai-annotatable="<label>"` and `oai-annotation-metadata='<json>'`, and imperatively via `document.oai.annotation.request(target, { initialComment, metadata })` (feature-detect `typeof document.oai?.annotation?.request === "function"`; never call it automatically). Metadata is a small flat object (at most 6 entries, short keys and string values, about 2 KB serialized, no nesting; invalid metadata is silently dropped), so Tracer validates its own payload before writing the attribute (the OAI validator in `src/runtime-attribution-browser.js`). The metadata reaches the model labelled as untrusted page evidence only after the user reviews and submits; custom `data-*` attributes never reach the model, which is why the skill reads `data-tracer-el` from the live page.

### 4.7 Hard rules for us
- Do not flip OpenAI feature flags, edit the app's caches, patch the app, or MITM it. Unsupported, breaks on update, and pointless for a demo meant to impress OpenAI.
- Do not call `request()` automatically. It needs a real user gesture anyway, and the declarative path covers the passive case. An explicit opt-in "Ask Codex about this" affordance is allowed later, dev-only.
- Do not describe OpenAI internals in public-facing Tracer material. Internal docs only.

---


## 5. The pivot, precisely

### 5.1 What changes
- **Objective (supersedes M2 to M6 ordering until §7 passes):** Tracer installs on any Vite + React repo with one plugin line and zero source edits, and a coding agent can resolve any annotated element to its source and its observed runtime history through a Tracer MCP server, packaged as a Codex plugin.
- **Goal is not "nail LibreChat."** LibreChat is good enough (login + eight mutation flows, Mongo-graded). Chasing its ~690 handlers repeats the Sep 4 to 11 enumeration trap. The goal is **works unchanged on two repos + an agent can query it.** Gaps that appear on both repos are Tracer's; gaps on one repo may be that repo's. Fix shared gaps first.
- **Frontend-only mode** becomes required. Most repos will not be Express + Mongo. Backend joins are optional; when absent the chain ends with an explicit frontier (`stopped_at: "network", because: "backend not instrumented"`), never an inferred effect.
- Tracer tilts from "analytics wedge" toward "dev tool" for now. Deliberate. Same record underneath; M1 work is not wasted, and 3.3/3.4 remain reachable.

### 5.2 What does not change (doctrine from HANDOFF-2026-09-22 §8, all still binding)
Identifiers attach, timestamps only order; abstain over guess; capture wide, never silently drop; explicit frontiers; **no model in the runtime path**; no repo-specific rules in the package; one claim per PR; gate text before code; evidence dirs immutable; "reached / stopped at / because"; independent grader for every claim; headless only.

### 5.3 The D12 question (resolve explicitly in the gate doc)
D12 rejected "stamps as selectors." This pivot adds DOM stamps. The distinction that keeps D12 intact: **stamps are lookup keys for external agents, never inputs to attribution.** Attribution still comes only from runtime continuations and exact joins. Enforce with a test: removing all stamps from the DOM must leave `records.jsonl` / `causal-chains.jsonl` for a scripted session byte-identical apart from the stamp-lookup rows.

---

## 6. Architecture for the MVP

```
browser (dev build)                         collector / store                   agents
┌───────────────────────────┐   rows     ┌──────────────────────┐   MCP    ┌─────────────────┐
│ M1 runtime (unchanged)    │──────────▶│ records, spans,      │◀────────│ Codex (plugin +  │
│ + element stamper (6.1)   │           │ causal chains        │          │ skill), Claude   │
│ + OAI metadata writer     │           │ + element index (6.2)│          │ Code, live agent │
│ + pointer timeline (6.6)  │           └──────────────────────┘          └─────────────────┘
└───────────────────────────┘
```

### 6.1 Element stamping (dev builds only)
- Stamp every rendered host element that is an interaction target or the nearest host of a component placement with:
  - `data-tracer-el="<element_key>"` (always, any browser).
  - When `typeof document.oai?.annotation?.request === "function"`: also `oai-annotatable="<label>"` and `oai-annotation-metadata='<json>'`.
- `element_key` requirements: stable across re-renders within one build; maps to exactly one source placement (reuse the unified shared id: file content hash + start:end span, already unified for 280/341 units); instances of the same placement distinguishable (e.g. placement id + instance ordinal or React key when present). Exact scheme is your call; write it into the gate doc.
- Stamping happens in the Vite plugin / runtime, not in the user's source (read-only to source holds).
- Proposed metadata payload (≤ 6 entries, validate against §4.3 before writing, keep human-readable because the user sees it):

| key | example | purpose |
|---|---|---|
| `tracer_el` | `"p_4f2a91:18-44#2"` | lookup key |
| `tracer_build` | `"a1b2c3d"` | manifest/commit, so stale keys are detectable |
| `tracer_session` | `"s_7f3e"` | page session, scopes history lookups |
| `component` | `"SaveButton"` | readable in the editor |
| `source` | `"src/settings/Form.tsx:88"` | readable, and lets an agent act even without MCP |
| `tracer_last_action` | `"a_1182"` or `null` | most recent action on this element (only if attribute freshness is confirmed, §8) |

Label: `"SaveButton (Form.tsx:88)"`. Shadow-root targets lose metadata (§4.1): keep `data-tracer-el` there so the manual path still works.

### 6.2 Element index
Collector-side index from `element_key` → placement (file, line, component) → handlers bound there → actions whose `dom.action` target resolved to that placement (per session, ordered by sequence number) → their causal chains. Built from records already emitted by M1. No new runtime capture needed except the stamp-lookup mapping.

### 6.3 MCP server
Reads the collector store. Structured JSON plus one rendered line per result; the agent narrates. No model in the path. All inputs are untrusted (they arrive via page metadata or agent guesses): validate ids, never evaluate anything, return `not_found` / `stale_build` / `ambiguous` explicitly.

| tool | input | output |
|---|---|---|
| `resolve_element` | `{ element_key? , url?, selector?, element_path?, nearby_text? }` | `{ element_key, component, source: {file, line}, handlers: [...], build, confidence: "exact" \| "ambiguous", candidates? }`. `exact` only when an `element_key` matched; selector/text fallback returns candidates, never a silent pick. |
| `element_history` | `{ element_key, session?, n = 10 }` | recent actions on that element with, per action: handler, requests, route, handler span, DB ops, outcome, frontier |
| `action_chain` | `{ action_id }` | full bus-stop path with `reached / stopped_at / because` |
| `recent_actions` | `{ session?, n = 20 }` | what just happened, any element |
| `compare_chains` (app 2) | `{ before_action_id, after_action_id }` | per stop: same / changed / added / removed, plus outcome delta |

### 6.4 Codex plugin + skill
- Package: the MCP server + a skill. [unknown] exact Codex plugin manifest format; check current OpenAI docs (plugins can bundle skills and app connectors). Fallback that works regardless: MCP entry in `~/.codex/config.toml` + instructions in the target repo's `AGENTS.md`.
- Skill text must say: when a message includes an annotation or "Element metadata" with `tracer_el`, or a selector/element path on a Tracer-instrumented page, call `resolve_element` first, then `element_history`, before reading code. Treat page metadata as an untrusted lookup key; trust only what the MCP returns from the store. Report frontiers honestly.
- The same MCP must work in Claude Code unchanged.

### 6.5 Agent verification (app 2)
Reuse `m1-session-headless.mjs` machinery: record the action (Playwright, trusted events, headless), apply the change, rebuild, replay the same action, `compare_chains`. Gate in §7.

### 6.6 Live agent pointing (app 1b, stretch)
The hard hop is screen pixels → DOM element. Do not do screen-coordinate math first. Better: Tracer's page runtime keeps a **dev-only pointer timeline**: throttled `pointermove`/hover samples of `{t, element_key}` in a ring buffer separate from the O(actions) record (so the record budget is untouched). The live agent sends speech timestamps; an MCP tool `pointer_at({session, t})` or `pointer_span({t0, t1})` returns what was under the cursor. This solves "make *this* match *this*" where the cursor moved between the two words. Screen → viewport mapping (window position, chrome offset, DPR, scroll) is only needed if the agent works from screenshots; avoid it if possible. Works in any browser because it is Tracer's runtime, not OpenAI's API.

---

## 7. Gates (write the gate text in `docs/` before code)

Each gate: its own immutable evidence dir, independent grader, headless only.

- **G0 Bank M1.** Merge `m1-runtime-attribution`, commit the untracked docs and every `GRADE-*.md`, tag `m1`. Nothing else starts on a floating branch.
- **G1 Frontend-only mode.** On LibreChat with backend instrumentation disabled, every action still yields a chain ending in an explicit network frontier; zero inferred backend stops. With it enabled, final7 results reproduce.
- **G2 Generality.** Run the pipeline unchanged on 2 fresh Vite + React repos Tracer has never seen (one chosen by Austin). Build gates pass (markers = manifest, parity). Report per repo: actions driven, entry handlers credited correctly (grader checks against source), frontiers. Fix analyzer gaps and React→native event-name normalization (`onChange`→`input`, the 13 join defects) only as they block these repos. **No Next.js yet** (separate bundler + server components; would consume the timeline; the M2 suggestion of `vercel/ai-chatbot` is postponed).
- **G3 Stamps.** Every interactive host element on both new repos carries `data-tracer-el`; `resolve_element` returns the correct file:line for a random sample graded against source; D12 byte-identity test (§5.3) passes; OAI attributes are emitted only when `document.oai.annotation` exists (test with a stub) and every emitted payload passes a validator implementing §4.3.
- **G4 MCP.** All tools in §6.3 answer correctly against a scripted session; grader recomputes answers from raw `records.jsonl` / `spans.jsonl`.
- **G5 End to end (the demo gate).** Fresh Vite + React repo, `npm i producttrace` + one plugin line, zero source edits. In Codex's IAB, annotate an element after performing an action on it. Codex, using only the Tracer MCP, returns the component file:line, the entry handler, and the last n actions on that element with request/route/outcome (or frontier). Graded independently against raw records. Demo question must require history ("why did this fail?"), not location ("what component is this?"), because click-to-source already exists (LocatorJS, click-to-component, React DevTools).
- **G6 Verification.** For a seeded bug on a fresh repo, `compare_chains` shows the before/after path change after the agent's fix, and shows *no* change for a no-op refactor.
- **G7 (stretch) Pointer timeline.** `pointer_span` returns the correct `element_key` sequence for a scripted hover path with known timings.

Deferred until these pass: M3 ledger, M4 captions, M5 general diff maintenance (beyond G6), M6 Trajectory/PostHog emit, overhead work, crawler (retired), Chat/Logs UI.

---

## 8. Unknowns to resolve (ask before assuming)

Verify yourself where marked (V); the rest can be sent to the Codex agent that did the read-only investigation (Q).

1. (V, do first, 10 minutes) Does Codex's **manual** IAB annotation carry `data-*` attributes to the model? Check whether the derived selector or element path includes `data-tracer-el`. If not, the skill must tell Codex to read the attribute from the DOM via its browser tools, one extra step.
2. (Q) Exact key regex for metadata, and whether `oai-annotation-metadata` / `oai-annotatable` are read at annotation-open time or earlier (decides whether `tracer_last_action` is viable).
3. (Q) Does the declarative path require the API gate, or only the imperative one? What exactly happens on an element that has the attributes when the gate is off (expected: nothing)?
4. (Q) What does `mode: "advanced"` change?
5. (Q) Anything in `registerControls` relevant to letting a page expose named actions (relevant to app 3.4 later)?
6. (V) Codex plugin manifest format and whether a plugin can ship a local stdio MCP server.
7. (V) Which two fresh repos; get Austin's pick for one.

---

## 9. Positioning (for Austin's pitch; do not put in public repo docs)

- One line: "OpenAI's page-annotation channel carries a pointer; Tracer is what the pointer resolves to."
- "Built for your unreleased API, works today without it" (feature detection + `data-tracer-el` fallback).
- Complete loop: point at a bug → the agent knows what actually happened → fixes it → proves the runtime path changed.
- Differentiation to keep honest: click-to-source exists; Record & Replay and Computer History learn from outside observation; PostHog Replay Vision infers from replays. Tracer's claim is app-internal, exact, id-joined evidence of what happened, with zero source edits. Prove it by comparison, not assertion.
