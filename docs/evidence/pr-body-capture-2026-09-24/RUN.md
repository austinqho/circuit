# Body capture: RUN (2026-09-24, branch `fix/body-capture`, base `main` = tag `fixes-2026-09-24`)

Claim: in a dev build Tracer records request and response bodies, bounded and redacted, so an agent can answer which entity an action acted on.

This file was written by the implementer. It is not an independent grade.

## Commands

```sh
npm run build && cmp src/runtime-attribution-browser.js dist/runtime-attribution-browser.js   # byte-identical (304,724 bytes)
npm test                                                                  # 693 tests: 692 pass, 1 known failure (react-context-ref-semantics)
node test/browser/body-capture.mjs --out docs/evidence/pr-body-capture-2026-09-24/fixture   # 34/34
node test/browser/d12-stamp-neutrality.mjs <deps> <out>                   # 23/23 (variant D = bodies on)
node test/browser/continuations-neutral.mjs                               # status ok, 5 runs
PRODUCTTRACE_CONTINUATION_BODIES=always node test/browser/continuations-neutral.mjs   # status ok, 5 runs, bodies on
node test/g4-grader.mjs docs/evidence/m1-2026-09-22-final7 --manifest docs/evidence/g4-mcp-2026-09-23/manifest.json   # 81/81
node test/g6-grader.mjs <store from g6-anything-llm-2026-09-23 + remap-bases manifests> --compare <fresh g6-compare out>   # 6/6
node test/browser/build-fresh-repo.mjs --repo /Users/austinho/dev/fixtures/anything-llm --session test/browser/sessions/anything-llm.mjs \
  --plugin-options '{"stamps":true,"requestBridge":false,"bodies":"always"}' --collector --store <scratch> --expect-commit ad97bc8d --port 4290 --out <scratch>
```
`<deps>` is the LibreChat fixture dependency root (`/Users/austinho/dev/trace-consolidated/.live-demo/librechat-m1`), the default for every headless script. The worktree needed a copy of `evaluation/shared-rules/fixtures/node_modules` (22 MB, git-ignored) for the suite. A symlink fails 10 library-program tests (`implementation_outside_installed_dependencies`).

## Files

| file | what | sha256 |
|---|---|---|
| `fixture/report.json` | every check with its detail, sizes, the plugin's warnings, the injected settings per build, sessions (page output, `bodyStats()`), MCP samples | `1c7e282d3483f88bf44b4578b62ae46d9a043b5af3c742b606cb017e16d0f267` |
| `fixture/records-body-rows.jsonl` | the 12 `network.body` rows of the dev page | `f716d82b89111ade848035e08b111ee6a75125dc48a20a5a1b381c29e2d69d29` |
| `fixture-run.txt` | driver stdout | |
| `d12/report.json` | D12 report (variants A–D) | `46a92b61821ed0ec9220c5c83a917f797f1837024fefcbb9342a416e58d4ab4b` |
| `d12/body-rows-D.jsonl` | variant D's 4 body rows | `22d687d4a1c489c93695d88fe93d3bd961131284e53f3302d3d5c2869b695bad` |
| `anything-llm/build-gates.json`, `harness-log.txt` | fresh-repo gates (tarball install, marker, parity, source clean) | |
| `anything-llm/body-analysis.json`, `analyze.mjs`, `redacted-keys.txt` | body rows, coverage and MCP samples, recomputed from the store by `analyze.mjs` | |

The anything-llm raw rows are **not** banked on purpose. Its settings response carries the instance's configuration under key names the rule does not match. Summaries only.

## Fixture (`test/browser/fixtures/body-capture-app/`, driver `test/browser/body-capture.mjs`): 34/34

Five builds of one neutral app (eight buttons) are served with a tiny backend (`backend.mjs`). Rows ship through the real collector sink into one store, and the MCP runs over stdio. The driver computes every expected value from the backend's fixed payloads and the app's literal bodies, using its own redaction function. It imports nothing from the runtime.

- **B0–B1, option rules.** Injected `__PRODUCTTRACE_BODIES__` per build: dev `on`, dev `bodies:false` `off`, prod `production_off`, prod `bodies:true` `production_off` (warning: disabled), prod `'always'` `on` (warning: ON). The defaults are silent.
- **D1–D2.** JSON POST `{projectId, name, password, owner:{userId, apiToken}, tags}`. The request row keeps the ids, redacts `password` and the nested `apiToken` (`redactions: 2`), and has `bytes` = the original length. The response keeps `_id`, redacts `sessionId`, and has `status: 200`.
- **D3.** A 16,041-byte JSON response: `truncated: true`, `bytes: 16041`, `text` = exactly the first 4,096 bytes of the redacted serialization; `accessToken` is not present.
- **D4.** `text/plain` recorded as text.
- **D5.** `image/png` recorded as `captured: false, reason: "binary", bytes: 2048`.
- **D6–D7.** NDJSON streamed in 5 chunks: `captured: false, reason: "streaming"`, never read. The app read all 5 lines intact with bodies on.
- **D8.** XHR POST: `secretKey` redacted; the response was read on `load`.
- **D9.** FormData: `captured: false, reason: "form_data", bytes: 1011` (sum of parts).
- **D10.** `JSON.stringify` posted with no content type (`text/plain;charset=UTF-8`) is parsed and `authToken` is redacted.
- **D11–D12.** None of the 8 secret values, and no `authorization` or `cookie` key, appears anywhere in `records.jsonl`. The server did receive the `Authorization` header and the cookie, so the capture drops them, not the app.
- **D13–D15.** Every body row links to a `network.request` row. No body row has an `action_id` or a `sequence`. `body_sequence` is contiguous. There are 4 request rows and 8 response rows. `capture.summary`: `bodies_emitted` 12, `body_truncations` 1, `bodies_not_captured` 3. Coverage is complete, with `bodies: "on"`.
- **O1–O5.** Bodies off: no rows, coverage complete. **Parity: page output identical with bodies on and off.** The sequenced rows have the same kinds, order, requests and ownership on and off. Prod default has no rows. Prod `'always'` has the same 12 rows and the same output.
- **M0–M10 (MCP over stdio).**
  - `include_bodies` is published as a boolean.
  - Segment `body.fields` has `projectId: "p_42"`, `password: "[redacted]"`, `tags: "[2 items]"`, `owner: "{2 keys}"`, and `body.ids` has `projectId` and `owner.userId`. `response_body.ids._id` is present.
  - The summary line reads `… [backend_not_instrumented; request ids projectId=p_42, owner.userId=u_7; response ids _id=65f0c0ffee0000000000abcd, projectId=p_42, sessionId=[redacted]]`.
  - `include_bodies: true` returns the stored JSON.
  - A truncated body gives `ids.reportId`, `ids.ownerId` and `fields.rows: "[79+ items]"` with `fields_partial`.
  - Binary is shown as `captured: false`.
  - `element_history` attempts carry only `{direction, captured, truncated, ids}`.
  - `include_bodies: "yes"` is rejected.
  - With bodies off, `body: null` and `bodies: "off"`, and the frontier line is otherwise identical.

## Neutrality (attribution never reads bodies)

- **D12, 23/23.** Variant D comes from a second build with `bodies: 'always'`, built into the same `client/dist` path. A–C come from the default build (`production_off`). The builds differ only in the settings string: same chunks, same manifest. After stripping `element.stamp` and `network.body` rows, the dom.action stamp fields and `capture.page.bodies`, `records` and `causal-chains` are **byte-identical for A, B, C and D** (40,473 / 13,079 bytes each). D has 4 body rows; A–C have none. D's stamp rows equal A's.
  - Finding on the way: building the second variant into a different `outDir` inside the repository changed every function id's content hash. The build path is an input to the transform. This is not a body effect, but it is worth knowing for any two-build comparison.
- **Mechanism.** Body rows use their own `body_sequence`, draw no randomness, never touch `current` or `sequence`, and read bodies through the native `Promise.prototype.then` and `addEventListener` captured before the runtime wraps them. The fetch response is tapped by a reaction registered on the native promise, which the app still receives unchanged (no extra tick).
- **Suites.** continuations-neutral passes with bodies off and on. The G4 grader gives 81/81 and G6 gives 6/6 (their stores have no body rows).

## anything-llm through the one-line install (tarball, `bodies: "always"`)

- Gates: marker (5,101 functions), **parity (0 diff with bodies on)**, source clean, 8/8 steps.
- 71 requests and 74 body rows (59 JSON responses, 3 text responses, 9 PNG size-only, 3 request bodies posted as `text/plain` JSON), all linked, 0 truncated.
- 334 values redacted under 20 key names. There is no `authorization`/`cookie` key.
- Writes name their entity, e.g. rename workspace: `response ids workspace.id=1`, with `request_fields { name: "Tracer G2 renamed" }`.
- Coverage is complete for the first page (63 body rows). The live second page has no `capture.summary`, which is the harness's existing close behaviour.

## Sizes (bytes added)

- **Fixture dev page.** 8 requests, 12 body rows, 10,972 bytes in total: **1,372 bytes per request** on average.
  - The largest row is 5,380 bytes (the truncated 16 KB report). A small JSON body row is about 500–600 bytes, of which about 430 bytes are row metadata (schema, ids, session, page, content type).
  - The page's rows total 77,303 bytes with bodies on against 66,312 off (+16.6%, on a fixture made of requests).
- **anything-llm.** 111,956 body-row bytes over 71 requests: **1,577 bytes per request**, 4.7% of the store.
- Upper bound per request: two rows of at most 4,096 bytes of body plus metadata, about 9.2 KB.

## Decisions (made here, within the owner's decision)

1. **No `action_id` on body rows.**
   - They link by `(page, request_occurrence_id)`. That id is minted when the request is created, under the request's creation-time ownership.
   - Putting `action_id` on them would have put them into every `rowIndexesByAction` / episode path, where attribution code reads rows.
2. **Truncated JSON is stored as `text` (`format: "json"`)**, the cut serialization, and never a reshaped structure. The MCP summarises it with a prefix parser.
3. **Text that parses as a JSON object/array is treated as JSON whatever its declared type.** Otherwise a `JSON.stringify` body sent as `text/plain` (the fetch default) would leak its `password` unredacted.
4. **Declared JSON that does not parse is not recorded** (`unparseable_json`), for the same reason.
5. **Streaming is decided by content type.** Streaming types are `text/event-stream`, NDJSON/JSONL, `json-seq` and `stream+json`, and they are never read.
   - Other JSON/text responses without `content-length` are read through the clone, and parsing stops at 1 MiB (`over_parse_limit`).
   - A long-lived chunked `text/plain` stream holds one clone reader, buffering at most 1 MiB, until it ends or passes the limit.
6. **Nested ids in the MCP.** Id-shaped keys at object depth ≤ 4, as dotted paths, are listed in `ids`, because real APIs nest the entity (`{workspace:{id}}` on anything-llm). `fields` stays top-level as briefed.
7. **`element_history` shows ids only for actions and attempts**, not only for attempts: an action's segments would otherwise repeat full summaries.
8. **The runtime's default when no plugin sets the mode is off.** Hand-installed runtimes such as the LibreChat harness record no bodies.

## Privacy (first-class residual): exactly what is and is not recorded

**Recorded (dev build, or production with `'always'`), per request made through the runtime's fetch/XHR wrappers:**
- JSON and `text/*` request and response bodies, up to 4,096 UTF-8 bytes each. All values are recorded as sent except redacted keys. This includes names, emails, addresses, free text, prompts, ids, and personal data under any key name not matching the rule.
- Plain-text bodies (`text/plain`, `text/html`, …) that are not JSON, recorded as sent. **Nothing inside plain text is redacted**, including `password=…` in a text body.
- `content-type`, the full body size, the HTTP status, and the type and size of binary, multipart, urlencoded, blob, document and streaming bodies.

**Not recorded:**
- Values of JSON keys matching `/pass(word)?|secret|token|auth|cookie|session|credential|ssn|card/i`, at any depth. They are replaced in the page, before the row reaches the sink.
- Every header except `content-type`; `Authorization` and `Cookie` never.
- `document.cookie`.
- Query strings: `network.request` already strips them and body rows carry no URL. The brief said they were "recorded as-is"; they are not recorded.
- Urlencoded and multipart field values.
- Binary content.
- Streaming bodies.
- Bodies of Tracer's own requests.
- Anything in a `production`-mode build without `'always'`.

**Residual risks:**
- Key-name redaction only. It **misses** secrets under other names (`apiKey`, `key`, `pin`, `otp`, `privateKey`, `bearer`), secrets inside string values (a JWT in `data`), secrets inside text bodies, and PII.
- It **over-redacts** by substring: `author`, `authority`, `TokenLimit`, `RequiresAuth`, `sessionId`, `cardinality`, `scorecard`. Seen on anything-llm. An id under such a key (e.g. `sessionId`) is lost to the agent.
- Rows persist in `.tracer/records.jsonl` inside the developer's checkout. They must not be committed. Nothing here stops that (the store directory is not auto-git-ignored).
- The collector accepts any origin on loopback (unchanged): another page open in the same browser could post rows into the store.
- `'always'` in a production build is a developer's explicit choice and is warned at build time. The runtime cannot tell a real user's session from a developer's.
- Request bodies sent through `navigator.sendBeacon`, Web Workers, service workers, WebSocket frames and EventSource messages are not recorded. Those transports are outside the wrappers or out of scope.

## Other residuals

- A response body read after the page's last `capture.summary` makes the page's body counts differ from what was received. Coverage reports it as incomplete; it is not hidden.
- `bytes` for XHR `responseType: "json"` is the re-serialized length (`bytes_basis: "reserialized"`). For XHR text it is the UTF-8 length of `responseText`, not the wire size (compression, charset).
- Cloning a response tees its stream. If the app never reads its own branch, the tee buffers the response (at most 1 MiB for text/JSON; binary and streaming responses are never cloned).
- The fetch tap adds one native promise reaction per request. It is ordered before the app's reactions, so relative app ordering is unchanged. D12 and continuations-neutral show no attribution difference, but only on those fixtures.
- Not independently graded. The fixture driver and this report were written by the implementer.
