# Body capture: RUN-2 (2026-09-24, after the independent grade)

This file answers `GRADE.md` (commit bbfd707b, verdict "merge with changes") and the coordinator's nine required changes. `RUN.md` is left as written. Where it is now wrong, this file supersedes it (listed at the end). The implementer wrote this file; it is not a grade.

## Changes (commits on top of bbfd707b)

| # | required change | what the code does now | proof |
|---|---|---|---|
| 1 | never read a body its declared type does not qualify; every read capped; `bytes` right or absent | Only JSON and `text/*` bodies are ever read. A `Request` object's body with any other type, or none, is `captured:false`: `unknown_type`, `binary`, `form`, `form_data` or `streaming`, with `bytes: null`. It is never read, and no type is invented. Every clone read (Request objects and responses) goes through one reader capped at 1 MiB; there is no `text()`. A `content-length` counts as `bytes` only without a `content-encoding`. | driver R1: typeless Blob `Request` gives `unknown_type`, `content_type: null`, `bytes: null`, no text; the server got its 11 bytes |
| 2 | fire-and-forget failures still raise `unhandledrejection` | The app now receives the promise derived from Tracer's fulfilment-only reaction, not the native one. The response is cloned before any app reaction. A rejection passes through unhandled. Cost: one microtask tick. | driver F1: 1 `unhandledrejection` + 1 page error in each of dev (on), dev_off, prod, prod_always and uninstrumented. D12 A = D and continuations-neutral (both modes) unchanged after the tick |
| 3 | cancelled or abandoned streams must not keep the connection open | `text/*` of unknown length keeps the first 4096 bytes, then cancels Tracer's reader. When the app cancels its branch (`ReadableStream.cancel`, a reader's `cancel`, an async-iterator `return`, or any of these on a `pipeThrough` output), Tracer cancels its read at once, so the tee cancels the source when it would without Tracer. Row: `cancelled_by_app`. | driver T1: bytes written by the server at close: dev 200, dev_off 200, uninstrumented 200, prod_always 200. All closed. T2 is the row. L1: a 20,480-byte chunked text keeps 4096 bytes (`bytes: null`, `bytes_read: 8192`), and the app still reads all of it (L2) |
| 4 | `bytes` when the full size is unknown | `bytes: null` plus `bytes_read`, `truncated: true` (or `over_parse_limit` / `cancelled_by_app` / `read_failed` with `bytes_read`). G4 §3.3 now says "full size when known" and lists every basis. | L1, T2 |
| 5 | 204 and untyped responses | 101/103/204/205/304 and HEAD: no row. A body with no content type: `captured:false, reason:"unknown_type"`, exact size, never read. Never `binary`. | N1 (DELETE 204: no response row), U1 |
| 6 | reads in flight at page close | `capture.summary.bodies_pending`. Coverage is incomplete while it is > 0 (`N body read(s) still in flight at the last capture.summary: …`). The coverage object reports `body_rows.pending`. | D15 (`bodies_pending: 0`, coverage complete). Unit test `test/collector-sink.test.mjs` (pending reason) |
| 7 | redaction by key segment | Segments are split at camelCase, snake_case and kebab-case boundaries. The last segment `id`/`ids` is never redacted. Numbers, booleans and null are never redacted. The rule itself (secret segments, `session` alone, `key` after api/private/secret/access, secret endings) is in G4 §3.3. | K1: 26 keys in the probe; 16 redacted exactly as listed (`session`, `apiKey`, `x-api-key`, `privateKey`, `Password`, `access_token`, `accesstoken`, `cardNumber`, `cvv`, `otp`, `pin`, `jwt`, `bearer`, `credentials`, and a `token` and a `password` inside arrays). Kept: `author`, `authorId`, `sessionId`, `cardId`, `scorecard`, `cardinality`, `maxTokenLimit` (number), `requiresAuth` (boolean), `tokenCount` (number), `payload` (JSON-in-string, residual), `note` |
| 8 | warn whenever bodies are on outside development | `[producttrace] body capture ON in a "<mode>"-mode build: …` for any mode except `development` | B1: `staging` and `production` + `'always'` warn once each; dev, dev_off and prod default are silent; prod `bodies:true` says `disabled` |
| 9 | query-string doc lines | README, plugin README and G4 §3.3 now say: body rows carry no URL; query strings are recorded as sent once `fix/mcp-gaps` merges (it records path + query on `network.request`); on this branch alone they are not recorded. RUN.md's privacy line is superseded here, not edited (evidence is immutable). | `grep -n "fix/mcp-gaps" README.md plugin/README.md docs/gates/G4-mcp.md` |

Also changed:
- XHR text rows carry `bytes_basis: "utf8_of_text"`.
- The fixture's rename response now has `session` (redacted) and `sessionId` (kept) instead of a secret under `sessionId`.
- `buildReactFixture` gains `instrument: false` for an uninstrumented parity baseline.

## Negative control

The new driver was run against the previous runtime (e69ebfb4's `dist/runtime-attribution-browser.js`, swapped in temporarily and then restored; `cmp` confirms it was restored): **31/43**. The new probes fail as the grade described:
- T1: the connection stays open;
- T2, L1: no row;
- N1: 204 is labelled `binary`;
- U1: untyped is labelled `binary`;
- R1: a typeless Blob `Request` is read as text;
- F1: no `unhandledrejection` with bodies on;
- K1, D2, D11, M2: substring redaction.

With the current runtime the driver passes 43/43. Output: `negative-control/old-runtime-e69ebfb4-driver.txt`.

## Reruns (current head of this branch)

| run | result |
|---|---|
| `npm run build` + `cmp src/runtime-attribution-browser.js dist/runtime-attribution-browser.js` | byte-identical. **`dist/runtime-attribution-browser.js` is 128,764 bytes** (main at `fixes-2026-09-24`: 107,362; e69ebfb4: 122,156). The "304,724 bytes" in RUN.md is the build script's line for `producttrace-runtime.js`, a different file. |
| `npm test` | 693 tests, 692 pass, 1 known failure (`react-context-ref-semantics`) |
| `node test/browser/body-capture.mjs --out fixture-2` | **43/43** (was 34 checks): B0–B1, D0–D15, K1, T1–T2, L1–L2, N1, U1, R1, F1, O1–O5, M0–M10 |
| parity | O2: page output identical for dev (bodies on), dev_off and **uninstrumented**, and the page errors of dev_off equal the uninstrumented ones. O5: prod `'always'` identical. anything-llm parity gate: 0 diff with bodies on |
| D12 | **23/23**, A = B = C = D after stripping (`records` and `causal-chains`, 40,473 / 13,079 bytes). D has 4 body rows, A–C none. `d12-2/report.json` |
| continuations-neutral, bodies off | `status ok`, 5 runs |
| continuations-neutral, `PRODUCTTRACE_CONTINUATION_BODIES=always` | `status ok`, 5 runs. The grader's counting copy shows 3,556–3,576 body rows per run, mode `on` |
| G4 grader | 81/81 |
| G6 | `g6-compare.mjs` (6 pairs) + `g6-grader.mjs` → 6/6 |
| anything-llm, one-line tarball install, `bodies: "always"` | Marker gate (5,101 functions) and parity gate (0 diff) pass, source clean, 8/8 steps. 71 requests, 74 body rows, all linked, 9 PNG binary size-only. **0 values redacted** (was 334): every secret-named key in anything-llm's settings response carries a boolean or null, which the new rule keeps. No `authorization`/`cookie` key. Writes still name their entity (`response ids workspace.id=1`). Coverage is complete for the first page (63 body rows, `pending: 0`); the live second page still lacks a summary (harness close, as before). `anything-llm-2/` |

## Sizes (fixture dev page, 15 requests)

- 19 body rows, 19,047 bytes in total: **1,270 bytes per request**.
- The largest row is 5,380 bytes (the cut 16 KB report).
- The page's rows total 143,870 bytes with bodies on against 124,803 off (+15.3%).
- anything-llm: 109,353 body bytes over 71 requests, **1,540 bytes per request**, 4.6% of the store.

## Privacy, restated (supersedes RUN.md's privacy section)

**Recorded (dev build, any non-`development` mode with a warning, production only with `'always'`):**
- JSON bodies up to 4 KB, with every value recorded as sent except the values of secret keys by segment (G4 §3.3). That includes secrets under other key names: `OpenAiKey`, `PineConeKey`, `key`, `privateToken`… Note that `privateToken` is caught by `token`, but a bare `Key` after a vendor name is not.
- Secrets inside string values, e.g. a JSON-encoded string or a JWT in free text.
- `text/*` bodies, recorded as sent. Text of unknown length: its first 4 KB. A JSON-looking prefix of such a stream is not recorded (`unredactable_prefix`).
- `content-type`, status, and sizes.

**Not recorded:**
- Secret-key values. Numbers, booleans and null are kept under any key.
- Every header except `content-type`: never `Authorization` or `Cookie`.
- `document.cookie`.
- Bodies without a declared type, binary, streaming, urlencoded, multipart and blob bodies: only their size, when known.
- Anything in a `production` build without `'always'`.
- Query strings on this branch alone. Once `fix/mcp-gaps` merges, the request row records path + query as sent.

**Residual risks:**
- Key-name redaction only (above).
- Rows persist in `.tracer/records.jsonl` in the checkout, which is not git-ignored automatically.
- The loopback collector accepts any origin.
- `'always'` cannot tell a real user from a developer.

## Other residuals

- A JSON response of unknown length is read up to 1 MiB even when the app abandons it without cancelling it. It stops at once if the app cancels.
- A `pipeTo` of the app's branch that the destination aborts is not observed. Tracer's read then ends at its cap or at the end of the body.
- The derived fetch promise adds one microtask tick before the app's reactions. D12 and continuations-neutral show no attribution change; no targeted microtask-order probe beyond those was written.
- Stream cancellation is observed by wrapping `ReadableStream.prototype.cancel/getReader/pipeThrough/[Symbol.asyncIterator]/values` and the readers' `cancel`, only when bodies are on. Only streams Tracer cloned are acted on.
- String request bodies are parsed, redacted and serialized synchronously inside `fetch()` (grade P11: about 1.6 ms at 900 KB).
- Not independently regraded.

## Superseded lines in RUN.md

- "304,724 bytes": that is `producttrace-runtime.js`. The attribution runtime is 128,764 bytes here.
- The privacy section's "Query strings … are not recorded" and its redaction description: see above.
- The "Decisions" item 5, which read unknown-length text through the clone up to 1 MiB: now at most 4 KB, then cancelled.
- The fetch tap "on the native promise … no extra tick": now a derived promise, one tick.
- The anything-llm "334 values redacted": that was over-redaction of booleans and null.

## Files added

| file | sha256 |
|---|---|
| `fixture-2/report.json` | `62f403c9f1f916bdc8b3baac8bc146b9f23081f782f4eda65331b6e6e2c5f677` |
| `fixture-2/records-body-rows.jsonl` | `2f2306f45453f928dd1847646c0d27e2592d573cd0cd8f278eeda4c7fb324394` |
| `fixture-2/server-log.json` (headers dropped) | `5ecb63256e6bc5e76064de2538a4e379a485e80cd092ba8cc313886349b85d63` |
| `fixture-2-run.txt` | |
| `d12-2/report.json` | `15fd6140ed670de94e921e8e474f432b4a53bf97e441af46383e4521a237ab24` |
| `d12-2/body-rows-D.jsonl` | `22d687d4a1c489c93695d88fe93d3bd961131284e53f3302d3d5c2869b695bad` |
| `negative-control/old-runtime-e69ebfb4-driver.txt` | `ff71f10359215b09e5d2ccd8e1f04e62ac52f883ea6d6943282c18749a88a730` |
| `anything-llm-2/` (`build-gates.json`, `harness-log.txt`, `body-analysis.json`, `redacted-keys.txt`, empty because nothing matched) | |

The grader's `grader-scratch/` stays uncommitted, as the grader left it.
