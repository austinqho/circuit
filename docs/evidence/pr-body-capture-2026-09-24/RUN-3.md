# Body capture: RUN-3 (2026-09-24, after the regrade at 9b046875)

This file answers the regrade (`GRADE.md`, section "Regrade at 9b046875", commit 5b2b3b4a) and the coordinator's four items. It adds to `RUN.md` and `RUN-2.md`; neither was edited. The implementer wrote this file; it is not a grade.

**Not done here, on purpose:** the rebase onto `main`, and the resolution of the `mcp/tools.mjs` conflict (regrade N1). The coordinator will say when, because two other branches that rewrite `mcp/tools.mjs` merge first. After that rebase, the M-series checks, G4 and the final7 branch-vs-main MCP comparison must be rerun.

## Changes (commits on top of 5b2b3b4a)

| # | item | change | proof (driver `test/browser/body-capture.mjs`) |
|---|---|---|---|
| 1 | `pipeTo` | The wrapper covers `pipeTo` as it already covered `pipeThrough`. For a watched body, the app receives the promise derived from a rejection-only reaction. That reaction cancels Tracer's read, then rethrows, so an unhandled `pipeTo` rejection stays unhandled. `preventCancel: true` is respected. | **P1**, signal abort, `text/plain`: server bytes at close / time to close were dev 200 / 56 ms, dev_off 200 / 54, uninstrumented 200 / 56, prod `'always'` 200 / 56. **P2**, destination error, JSON of unknown length: 203 / 53, 203 / 53, 203 / 52, 203 / 51. **P3**: the row is `cancelled_by_app` (`bytes_read: 203`), `bodies_pending: 0`. With the 9b046875 runtime the same probes gave 4,100 B / 2,048 ms and 7,055 B / 3,668 ms, and one read pending. |
| 1 | wrappers look native | Every stream-prototype wrapper gets its native `name` and `length`. `values` and `[Symbol.asyncIterator]` are one function. | **P4**: `cancel/0 getReader/0 pipeThrough/1 pipeTo/1 values/0 asyncIterator=values/0`, and reader and BYOB `cancel/0`, all identical to uninstrumented. `toString` is still not native (residual). |
| 2 | observable differences | The extra microtask on the fetch rejection path cannot be removed without reacting on the native promise, which silences `unhandledrejection` (grade P18). Two alternatives were considered and rejected. Rejecting from a native `abort` listener fires before the app's own listeners, which is a different order. Rejecting after the event dispatch has no synchronous hook. So the difference is stated, not removed: README "Evidence and privacy" and the opening of G4 §3.3 now name (a) connection lifetime: none known, with the residual paths; and (b) the rejection runs one microtask later, with the probe. | **P5** fulfilment path, unchanged in all five builds: `race b,a`, `settled a,b`, `same a1,a2,a1-micro`. **P6**, the documented difference, asserted as such: abort order `listener-micro,fetch-rejected,b` for uninstrumented, dev_off and prod; `listener-micro,b,fetch-rejected` for dev and prod `'always'`. The probe keeps its result out of the page output, so parity (O2) measures the rest. |
| 3 | numeric secrets | Numbers are redacted under the strong segments `password passwd pwd pin otp cvv card ssn secret credential(s) token`, unless the key's last segment names a quantity (`limit(s) count(s) max min length len size ttl expiry expires expiration at ms seconds version type index`). Numbers under every other key are kept, and so are booleans and null. | **K1** (21 redactions): `numeric.pin 1234`, `otp`, `cvv`, `cardNumber 4111111111111111` and `secretAnswer 42` become `"[redacted]"`. `passwordLength 12`, `maxTokenLimit 4096`, `tokenCount 7`, `cardId 7` and `requiresPin false` are kept. **D11** (no secret string in the store) now includes the numeric card number. |
| 4 | Request-object `ReadableStream` | G4 §3.3 `streaming` line: "never read" applies to a `ReadableStream` passed as `init.body`. Inside a `Request`, a JSON- or `text/*`-typed stream is read (teed, capped at 1 MiB); an untyped or other-typed one is never read. | doc |

## Negative control

The driver was run with the 9b046875 runtime swapped into `dist/` and then restored (`cmp` src = dist afterwards): **42/49**. It fails D11 (numeric card number in the store), D15 (one read pending), K1, P1, P2, P3 and P4. P5 and P6 pass there too: the order difference predates this commit. Output: `negative-control/runtime-9b046875-driver-3.txt`.

## Reruns (this head)

| run | result |
|---|---|
| `npm run build`, `cmp` src/dist | identical. `dist/runtime-attribution-browser.js` is 131,059 bytes |
| `npm test` | 693 tests, 692 pass, 1 known failure (`react-context-ref-semantics`) |
| driver | **49/49** (`fixture-3/`) |
| parity | **O2**: page output identical for dev (bodies on), dev_off and uninstrumented, and page errors equal; **O5**: prod `'always'` identical. The order probe's result is excluded from the output; its difference is P6 |
| D12 | **23/23**; A = B = C = D after stripping (40,473 / 13,079 bytes); D has 4 body rows (`d12-3/report.json`) |
| continuations-neutral | bodies off: `status ok`, 5 runs. `PRODUCTTRACE_CONTINUATION_BODIES=always`: `status ok`, 5 runs. The grader's counting copy shows 3,553–3,568 body rows per run |
| G4 grader | 81/81 |
| G6 | `g6-compare.mjs` (6 pairs) + `g6-grader.mjs` → 6/6 |
| anything-llm one-line run | not rerun. This change touches only the stream wrappers and numeric redaction. The RUN-2 run showed no numeric value under a strong segment in its bodies (every such key held a boolean or null) |

## Sizes (fixture dev page, 21 requests)

- 25 body rows, 22,169 bytes: 1,056 bytes per request.
- The largest row is 5,380 bytes.

## Residuals, updated

- **Connection lifetime:** no exception is known. Residual paths that are not observed:
  - a JSON response of unknown length that the app abandons without cancelling (read to 1 MiB);
  - `pipeTo(…, { preventCancel: true })`;
  - any way of stopping a body other than `cancel`, a reader's `cancel`, `pipeTo`/`pipeThrough` or an async-iterator `return`.
- **Microtask order:** a fetch rejection, and a `pipeTo` settlement on a watched body, reach the app's reactions one microtask later (P6).
- **Detectability:** the wrapped stream prototype methods are detectable by `toString`.
- **Redaction:** by key name only. Secrets under other key names, inside string values, and in plain-text bodies are recorded in clear. A number under a non-strong secret segment (`apiKey: 123456`, `sessionCookie: 42`) is kept.
- **Pending reads:** they are counted per page (`bodies_pending`), not named per request (regrade recommendation, not done).

## Files added

| file | sha256 |
|---|---|
| `fixture-3/report.json` | `908c0f0519e876eaf096049640bcc22050d27b67d5512d0481fb1298f5fe80a2` |
| `fixture-3/records-body-rows.jsonl` | `8b51fc060dd0259abf2af33e41275d60dd5d0ad5c1ae7b7657b21129f8b3fe3d` |
| `fixture-3/server-log.json` | `09439013280c787faa2fc037da27c6d4c823635fbed0e39a4a54368369f28b11` |
| `fixture-3-run.txt` | |
| `d12-3/report.json` | `777f1fccf52939b15707a64f3dc5f638b2f0df2901a88c949ab4d669e518e635` |
| `negative-control/runtime-9b046875-driver-3.txt` | `bad6415cb275bfd434a4cc717809dc7024e1be88e3f718190ba588b892ecfa38` |
