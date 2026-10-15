# G3 element stamps — runs, 2026-09-23

Gate text: `docs/gates/G3-stamps.md`. Headless Chromium only. Branch `g1-g3-stamps`, code at commit `a55cf551`.

## 1. D12 byte-identity (`d12/`)

`node test/browser/d12-stamp-neutrality.mjs /Users/austinho/dev/trace-consolidated/.live-demo/librechat-m1 <out>` (the argument only supplies vite, react 18.3.1, @vitejs/plugin-react and playwright from that `node_modules`). Neutral Vite + React fixture (`test/browser/fixtures/stamp-neutral-app/main.jsx`) built with both plugins (`requestBridge: false`); 18 placements, 18 functions, build `e84888599e6e`. One scripted session (focus + type "Ada" key by key, submit with fetch, remove a keyed row with fetch, toggle a conditional panel twice, a component-wrapped Refresh button with fetch, an unkeyed link), three variants:

| variant | stamps | DOM | rows | element.stamp | attribution rows | dom.action with `target.element_key` |
|---|---|---|---|---|---|---|
| A | on, stub `document.oai.annotation` | stamped + OAI attributes | 184 | 19 | 165 | 21 of 21 |
| B | on | every stamp attribute stripped as it appears | 184 | 19 | 165 | 0 |
| C | off | untouched | 165 | 0 | 165 | 0 |

After deleting `element.stamp` rows and `target.element_key`: `normalized-{A,B,C}.jsonl` are byte-identical (104,276 bytes each) and `causal-chains-{A,B,C}.jsonl` (`buildActionChains`, frontend-only) are byte-identical (9,692 bytes each). All 16 checks in `d12/report.json` pass, including: every interactive host in A stamped; every OAI payload in A valid under an independent §4.3 checker; `tracer_last_action` equals the last attributed action on each clicked element; every stamp key resolves to the exact `<tag` at its line in the original source; `stamp_sequence` contiguous. Passed on three consecutive runs this session (this directory holds the third).

Determinism is enforced by the harness only: fixed `Date.now`, seeded `crypto.getRandomValues`/`Math.random`, fixed server responses, and a settled window after every key press and between mousedown and mouseup. The first attempt without per-event settling differed across variants **and** between B and C (stamps off) — a timer race in the runtime's mutation-receipt window under fast typing, present regardless of stamps; recorded in LIMITS.

## 2. LibreChat stamp survey (`coverage.json`, `records.jsonl`)

`node test/browser/g3-librechat-stamps.mjs /tmp/producttrace-librechat-m1-final2 <out>` against the G1 build (build `1c37d1cea7c2`, 7,467 placements, 0 short-key collisions; `attribution-manifest.json.gz`), backend on, chat fixture. Two sessions (stub `document.oai.annotation`, and none), four surfaces each (`/c/new`, an existing conversation, the conversation menu, the agent builder).

- Interactive hosts stamped: 65/66, 77/78, 89/90, 82/83 per surface (both variants). The one unstamped host on every surface is a `<textarea>` not rendered by React (no fiber). Reason `react_host_without_first_party_placement`: 0. `stampStats().unplaced_nodes`: 0.
- 575 stamp rows (324 distinct keys across both sessions); `placement_via`: 212 self, 289 first_host, 74 ancestor.
- OAI: stub session wrote 1,157 payloads on the surveyed surfaces, 0 invalid under the independent checker, 0 rejected by the runtime validator; no-stub session wrote 0 OAI attributes.
- `resolve_element` (pure `resolveElement`, no MCP): seeded random sample of 30 keys, 30/30 resolve `exact` to a file whose on-disk text at the placement start is `<tag` on the recorded line.

## Verdict against the G3 criterion

- "Every interactive host element on both new repos carries `data-tracer-el`": **not reached** — the two new repos (G2) do not exist yet. On LibreChat: every React-rendered interactive host on the four surveyed surfaces is stamped; one non-React textarea per surface is not.
- "`resolve_element` returns the correct file:line for a random sample graded against source": **reached on LibreChat** (30/30), script-graded.
- "D12 byte-identity test passes": **reached** on the neutral fixture; not claimed on LibreChat (not byte-deterministic across runs).
- "OAI attributes only when `document.oai.annotation` exists (stub), every payload passes a §4.3 validator": **reached** (fixture and LibreChat).
