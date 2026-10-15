# GRADE: `fix/body-capture` (head e69ebfb4), independent grader, 2026-09-24

Claim: "In a dev build Tracer records request and response bodies, bounded and redacted, so an agent can answer which entity an action acted on."

I did not write this branch. I did not rely on RUN.md, the test names or the author's summaries. I recomputed every value from raw `records.jsonl` rows (Python, no package imports), drove the MCP over stdio as a black box, and wrote my own probe app, backend and drivers. They are in `grader-scratch/` in the worktree and are **not committed**; only this file is.

**Verdict: `merge with changes`.**

The core claim holds on the author's fixture and on my probes:
- ids are recorded;
- key redaction applies at any depth, including inside arrays;
- the 4096-byte cut never splits a code point;
- the mode rules hold on real `vite build`;
- attribution is byte-identical with bodies on and off;
- rendered MCP text is unchanged on stores without body rows.

Six defects must be fixed before merge (list at the end). Three of them change what the app itself does when bodies are on:
- a failed fire-and-forget `fetch` no longer raises `unhandledrejection`;
- a response stream the app cancels keeps its connection open;
- a binary `Request` body with no content type is read whole and recorded as text.

## 1. Per-item results

### 1.1 Author's fixture, recomputed from the raw store

| # | item | verdict | raw evidence |
|---|---|---|---|
| F1 | driver passes | PASS | `node test/browser/body-capture.mjs` → `34/34 checks pass`. A copy that keeps the store (`grader-scratch/body-capture-keep.mjs`, imports repointed, store not deleted) also gives 34/34. |
| F2 | a body row or a stated reason for every request (dev page) | PASS | 8 requests, 12 `network.body` rows. Every row links to a `network.request` by `request_occurrence_id`; `body_sequence` runs 1..12. The 4 GETs have no request row, as intended. |
| F3 | `bytes` = true size | PASS (fixture) | Recomputed from the backend constants and the app's literal bodies. rename req 135, rename resp 140, report 16041, xhr req 67, note req 57; all match. FormData 1011 = the parts only (`bytes_basis:"parts"`); the wire size is larger. |
| F4 | cut at 4096 UTF-8 bytes | PASS | The report row's `text` equals the first 4096 bytes of my own redacted serialization of `REPORT_RESPONSE` (text is 4096 bytes). |
| F5 | exactly the matching keys redacted | PASS | My independent redaction of the sent payloads equals the stored `json` for rename req/resp, xhr req and note req. Counts: 2, 1, 1, 1. |
| F6 | no secret or credential header in the store | PASS | None of the 8 secret strings appears in `records.jsonl`. No `"authorization"` or `"cookie"` key appears. |
| F7 | the app's own reads are intact, and the assertion is real | PASS | Page output is built from the parsed bodies (`saved 65f0c0ffee0000000000abcd`, `r_7: 300 rows`, the 5 NDJSON lines, `xhr x_1`, …). It is identical across dev, dev_off, prod and prod_always, so it is not a constant. Caveat: O2 compares instrumented on against instrumented off. Uninstrumented parity is checked in 1.3. |

### 1.2 Grader probes (`grader-scratch/probe-app`, `probe-backend.mjs`, `probe-driver.mjs`, `probe2.mjs`, `probe3.mjs`)

These are dev-mode builds with the default option (on) and with `bodies:false` (off). The same 22-button session runs on both, and rows go through the real collector sink.

| # | probe | rows say | rule held? | app behaviour change? |
|---|---|---|---|---|
| P1 | app reads a response twice (`clone().json()` + `json()`) | one response row, `json {"orderId":"o_1","total":5}`, bytes 27 | yes | none: `bodyUsed` false on arrival; page text identical |
| P2 | 800 KB JSON the app never reads | `truncated:true`, bytes 819229 (true size) | yes | no hang. The clone reads the whole body anyway. JS heap +1.58 MB on vs −0.05 MB off, measured 400 ms after the click. |
| P3 | 6 MiB chunked `text/plain` the app never reads | `over_parse_limit`, **bytes 2097152**, but the server wrote 6291456 | **no: `bytes` is not the true size** | Chrome pulled the full 6 MiB in both modes, so no network difference was measurable |
| P4 | app reads 2 chunks of an endless `text/plain` stream, then `reader.cancel()` | **no row at all** | **no: nothing recorded, no reason stated** | **YES. Off: the server saw the close after 53 ms and 200 bytes. On: the connection was still open when the session ended (22,300 B written; 15,000–15,100 B in the parity run).** The tee's source is cancelled only when both branches are, and Tracer's branch keeps reading until 1 MiB or page unload. Apps that stop a `text/plain` stream with `reader.cancel()` hit this (the Vercel AI SDK streams as `text/plain`); the server keeps generating. |
| P5 | `fetch(new Request(url,{body: ReadableStream, duplex:'half', content-type json}))` | request row with the stream's content, `password` redacted | redaction yes. "Streams untouched" no: Tracer tees and fully reads the app's upload stream, with **no size cap** (`copy.text()`). | The fetch failed identically on and off (`ERR_ALPN_NEGOTIATION_FAILED`, HTTP/1.1). Not observable here. |
| P6 | `fetch(url,{body: ReadableStream})` | `captured:false, reason:"streaming"` | yes | none |
| P7 | **`new Request(url,{body: Blob([binary])})`, no type** | **`captured:true, format:"text"`, text `"�PNG\u0000\u0001\u0002��AB"`, `content_type:"text/plain;charset=UTF-8"` (never sent), bytes 17 (true 11)** | **no.** The binary content is recorded; the content type is invented; `bytes` is wrong. The same happens for an ArrayBuffer `Request` body. The `init.body` path is correct (`reason:"blob"`, 11). | A 40 MB typeless Blob `Request` is read whole into a string. The fetch round trip took 100 ms on vs 45 ms off; the row says `over_parse_limit`. |
| P8 | FormData via fetch and XHR, URLSearchParams | `form_data` bytes 17/19 (parts; wire 249/248), `form` bytes 33 | yes (parts basis declared) | none |
| P9 | multi-byte at the 4096 boundary | `a×4095+€`: text 4095 bytes. `a×4094+😀`: text 4094 bytes. JSON with € straddling 4096: text 4095 bytes. `bytes` 4100/4100/4110 (true). | yes, no code point split | none |
| P10 | JSON 900 KB / 1.2 MB (content-length) / 1.2 MB chunked | 921627 truncated; 1228828 `over_parse_limit`; 1228829 `over_parse_limit` (true sizes) | yes. But the entity id of a >1 MiB body is lost entirely (no first 4 KB). | page text identical |
| P11 | JSON request 900 KB / 1.2 MB | 921625 truncated; 1228825 `over_parse_limit` | yes | Synchronous cost inside `fetch()` (median of 5): 100 KB 0.4→1.0 ms, 900 KB 2.5→4.1 ms, 5 MB text 11→18.5 ms |
| P12 | `text/event-stream` consumed by the app | `captured:false, reason:"streaming"`, bytes null | yes, not read | app got 3 events, identical |
| P13 | XHR `responseType='json'` / `'arraybuffer'` | json with `secretToken` redacted, bytes 57 `bytes_basis:"reserialized"`; `binary` bytes 3000 | yes (basis declared) | none |
| P14 | 204 (DELETE) | **row `captured:false, reason:"binary"`, content_type null, status 204** | **no.** G4 §3.3 says "Responses with no body (204, 304, HEAD) have no row". Chrome gives a 204 a non-null empty `body`, so the row appears and is mislabelled `binary`. A JSON response with no content-type is also labelled `binary`. | none |
| P15 | abort before the response | request row (`jobId`); no response row | acceptable (no response exists) | none (AbortError both) |
| P16 | abort mid-body | `captured:false, reason:"read_failed"` | yes | none |
| P17 | keys | `author`, `authorId`, `sessionId`, `Password`, `access_token`, `cardNumber`, `maxTokenLimit` (a number), `requiresAuth` (a boolean), `items[0].token` and `items[1][0].password` are redacted (redactions 10). **`apiKey` is recorded in clear.** **A JSON string value `payload:"{\"password\":\"inner-json-secret\"…}"` is recorded in clear**, as is free text `"my password is note-secret"`. | follows the owner's regex exactly; see §3 on the regex | none |
| P18 | fire-and-forget `fetch()` to a refused port | no row | fine | **YES. Off and uninstrumented: `unhandledrejection` fires and a pageerror `TypeError: Failed to fetch` is reported. On (dev and prod `'always'`): neither.** Tracer's `then(…, () => {})` on the native promise marks it handled, so console errors and Sentry-style reporting go silent. |
| P19 | `text/html` containing `password=…` | recorded verbatim | stated in RUN.md | none |

Coverage check on the probe page: `capture.summary` shows `bodies_emitted` 32 and `capture.received` shows 32 `network.body` rows with no gaps. The MCP says `coverage.complete: true` although P4's body read was still pending and was never recorded. Coverage cannot see in-flight body reads.

### 1.3 Mode rules and parity (real Vite CLI, `vite build`)

The project lives in a scratch dir outside any repo: `vite.config.mjs` uses `producttrace({repository, requestBridge:false, bodies?})` from the worktree, and the vite CLI comes from the librechat-m1 `node_modules`.

| build | injected | warning | verdict |
|---|---|---|---|
| `vite build` (default) | `"production_off"` | none | PASS |
| `vite build --mode development` | `"on"` | none | PASS |
| `vite build`, `bodies:'always'` | `"on"` | `body capture ON in a production-mode build…` | PASS |
| `vite build`, `bodies:true` | `"production_off"` | `body capture disabled…` | PASS |
| `--mode development`, `bodies:false` | `"off"` | none | PASS |
| `vite build`, `bodies:false` | `"off"` | none | PASS |
| `vite build --mode staging` | **`"on"`, silently** | none | per the owner's rule, but see R-c |
| `vite` dev server | `"on"` | none | PASS |
| `bodies:'yes'` | `TypeError: bodies must be true, false or 'always'` | | PASS |

**Parity** (`grader-scratch/parity-driver.mjs`, same 22-step session): `document.body.innerText` is identical (503 chars) for uninstrumented, dev-on, dev-off, prod-`'always'` and prod-default. **Page text parity holds.** But the two app-visible differences above (P4, P18) appear only in the builds with bodies on. A text-parity gate does not catch them.

### 1.4 Byte-identity and suites

| item | verdict | evidence |
|---|---|---|
| D12 | PASS 23/23 | Rerun into scratch. A copy that also dumps each variant's raw `runtime.records` (`grader-scratch/d12-raw.mjs`) → my own field-level diff A vs D: after removing only `network.body` rows, 87 = 87 rows, kinds in the same order, and **the only differing path is `capture.page.bodies`** (1 row). A vs B differs only in stamp fields, as before. D has 4 body rows. The stripping is honest. (Its deletion of `capture.summary.bodies` is a no-op, because no summary is in-page at compare time.) |
| dist = src | PASS | `cmp src/runtime-attribution-browser.js dist/runtime-attribution-browser.js` identical (122,156 bytes). RUN.md's "304,724 bytes" is the build script's size for `producttrace-runtime.js`, not this file. |
| `npm test` | PASS (expected) | 693 tests, 692 pass, 1 fail = `react-context-ref-semantics`. |
| continuations-neutral | PASS | Default: `status ok`, 0 body rows (`production_off`). With `PRODUCTTRACE_CONTINUATION_BODIES=always`: `status ok`, and a counting copy shows **3,552–3,583 body rows per run** (mode `on`), so the "on" run really exercises capture. |
| G4 grader | PASS 81/81 | `node test/g4-grader.mjs docs/evidence/m1-2026-09-22-final7 --manifest docs/evidence/g4-mcp-2026-09-23/manifest.json` |
| G6 grader | PASS 6/6 | Store rebuilt per the remap-bases RUN.md; compare files regenerated with `g6-compare.mjs` (6 pairs); `g6-grader.mjs` → `Overall: PASS (6/6 pairs)` |

### 1.5 MCP over stdio

| item | verdict | evidence |
|---|---|---|
| `action_chain` default | PASS, with a privacy note | The keys probe returns `ids {authorId:"[redacted]", sessionId:"[redacted]"}` and `fields` with 12 top-level values. `apiKey:"apikey-secret"`, `payload` (with the inner password) and `note` are **shown by default** (strings up to 200 chars). The summary line: `request ids authorId=[redacted], sessionId=[redacted]; response ids …`. |
| `include_bodies:true` | PASS | Adds `json` exactly as stored. `include_bodies:"yes"` is rejected (author M8, not re-probed). |
| `element_history` | PASS | Actions and attempts carry only `{direction, captured, truncated, ids}` (session `s_5d0e59be`). |
| `"[redacted]"` rendering | PASS | Rendered as an ordinary string in fields, ids and the summary line. |
| over-limit body | note | 1.2 MB response → `captured:false, over_parse_limit`: no ids at all. |
| 204 | FAIL (doc) | `response_body: {captured:false, reason:"binary", status:204}` |
| cancelled stream (P4) | FAIL (silent) | `response_body: null`, indistinguishable from "no body" |
| stores without body rows (final7) vs `main` | PASS for rendered text; additive JSON | `git archive main` (9a8496fb) into scratch. Every `action_chain` (54) plus `recent_actions` over stdio on both servers. **Rendered text is identical for 110/110 content items.** `structuredContent` and the JSON part are identical **after removing** the added `bodies:null` (54), `segments[].body:null` (68) and `segments[].response_body:null` (68); nothing else differs. The raw responses are therefore not byte-identical. That matches G4 §3.3's "except for the added `null` fields". final7 has no element keys, so `element_history` was not exercised on it. |

Merge: `git merge-tree --write-tree main HEAD` is clean. `main` moved 4 commits (package allowlist) past the tag.

## 2. Privacy: what is recorded that a developer might not expect

Recorded in a dev build (and in any non-`production` mode build, including `--mode staging`, with no warning), per fetch/XHR through the wrappers:

- Every JSON value whose key does not match the regex, up to 4 KB per body. This covers emails, names, addresses, prompts, free text, and **API keys under names such as `apiKey`, `key`, `privateKey`** (P17).
- **Secrets inside string values**, including JSON-encoded strings (`payload:"{\"password\":…}"`), JWTs and free text.
- `text/*` bodies verbatim: HTML, plain text, and **any urlencoded or multipart payload a server echoes back as `text/plain`** (P8 echo rows contain `password=urlenc-secret`).
- **Raw binary content of typeless `Blob`/`ArrayBuffer` bodies sent through a `Request` object**, decoded as text (P7).
- The full content of a `ReadableStream` upload sent through a `Request` object with a JSON/text/absent content type (P5).
- By default the MCP puts up to 12 top-level **values** per body into the agent's context (P17's `apiKey` and `payload`). That context is typically sent to a model provider.
- The length of every redacted form part (`bytes`), `content-type`, status and sizes.

Not recorded (verified): `Authorization`, `Cookie`, other headers, `document.cookie`, query strings (the request row cuts at `?`), redacted key values, `init.body` Blob/ArrayBuffer/FormData/URLSearchParams content, streaming-typed responses, and bodies in `production` mode without `'always'`.

## 3. Design points

**(a) Substring redaction.** Confirmed on real rows:
- It over-redacts: `author` and `authorId` (the id is lost; an agent sees `authorId=[redacted]`), `sessionId`, `maxTokenLimit` (a number), `requiresAuth` (a boolean). RUN.md adds `cardinality` and `scorecard`.
- It under-redacts: `apiKey`, `key`, `pin`, `otp`, `privateKey`, `bearer`, `jwt`, and secrets inside string values.

What I would change (owner decision; not a merge blocker, because the branch implements the owner's regex exactly):
1. Match on word tokens (split camelCase, snake and kebab, lowercase) against a set. `auth` then matches `auth`, `authToken` and `requiresAuth`→`[requires, auth]`, but not `author`. `card` matches `cardNumber`, not `cardinality`.
2. Never redact non-string scalars (numbers, booleans, null). They cannot carry a credential worth hiding, and they carry most of the over-match cost.
3. Add `apikey`/`api_key`, `key` as a last token (`apiKey`, `privateKey`, `secretKey`), `otp`, `pin`, `cvv`/`cvc`, `bearer`, `jwt`, `refresh`, `access` + `token`.
4. For id-shaped keys in the `session` family, emit a short non-reversible tag of the value's *position* (`"[redacted:1]"`, stable within a row) rather than a hash. A hash of a low-entropy value leaks it.
5. Optionally scan string values that parse as JSON objects, and redact inside them.

**(b) Query strings.** The branch documents "Query strings are not recorded" in README.md:367, docs/gates/G4-mcp.md:333 (§3.3) and RUN.md's privacy section. That is true today: `network.request.url` is cut at `?` (runtime line 1210), and body rows carry no URL. Another branch is about to record path+query, so at merge these three lines must be rewritten to "body rows carry no URL; the request row's URL policy is in §<network.request>". Otherwise the docs will claim a privacy property the code no longer has. **Note for the merge of the path+query branch.**

## 4. Required changes (merge with changes)

1. **Request-object bodies (P5, P7).**
   - In `captureRequestObjectBody`, read only when the declared content type is JSON or `text/*`.
   - With no content type, record `captured:false, reason:"unknown_type"` (size from `Blob.size`/`byteLength` where the source is known, else null). Never invent `text/plain;charset=UTF-8`.
   - Read any clone through a reader capped at 1 MiB, as the response path already does. No `copy.text()`.
2. **Unhandled rejections (P18).**
   - The fetch tap must not change `unhandledrejection` or console behaviour for the app. The minimal fix is to return the derived pass-through promise (`then(onFulfilled)` with no rejection handler) to the app, and re-run D12 and continuations-neutral with bodies on to show the extra tick changes no attribution.
   - If the owner instead accepts the suppression, it must be stated as an app-visible change in G4 §3.3, README and RUN.md.
3. **Cancelled streams (P4).**
   - A `text/*` response without `content-length` must not hold the connection after the app cancels. Keep the first 4 KB, then cancel Tracer's branch, and record `truncated:true, bytes:null, bytes_at_least:N`.
   - State the remaining unknown-length-JSON residual in G4 §3.3.
4. **`bytes` honesty (P3).** An `over_parse_limit` reached while streaming must record `bytes:null` plus `bytes_at_least`, not the count at cutoff. Fix G4 §3.3's "`bytes` is always the full size" to list every basis (`parts`, `reserialized`, `at_least`).
5. **No-body and untyped responses (P14).**
   - 204/205/304 and HEAD produce no row, as documented. Check status and method, because Chrome's `body` is non-null.
   - A response with no content type gets `reason:"unknown_type"`, not `"binary"`.
6. **Pending reads (P4).** `capture.summary` must count body reads still in flight at pagehide (`bodies_pending`). Coverage and the MCP must surface them, so a request whose body was never recorded does not read as `complete` with `response_body: null`.

Recommended (not blocking):
- (R-a) The redaction changes in §3a.
- (R-b) MCP default `fields`: show non-id string values as `"<string, n chars>"` unless `include_bodies:true`. The owner's rule says "up to 12 top-level keys"; the branch shows values. Confirm with the owner.
- (R-c) Warn whenever bodies are on in a `vite build` whose mode is not `development` (e.g. `staging`).
- (R-d) Rewrite the query-string doc lines at merge (§3b).
- (R-e) Keep the first 4 KB of an over-limit JSON body (prefix-redacted with the prefix parser) so the entity id survives. Today a >1 MiB body yields no ids.

## 5. Residual risks after the required changes

- Key-name redaction only (§2).
- Rows persist in `.tracer/records.jsonl` in the checkout, and the store dir is not auto-git-ignored.
- The loopback collector accepts any origin.
- `'always'` cannot tell a real user's session from a developer's.
- The fetch tap adds one native reaction per request. Relative microtask order was checked only through D12 and continuations-neutral, not by a targeted probe.
- The synchronous parse, redact and serialize of string request bodies costs about 1.6 ms at 900 KB and 7.5 ms at 5 MB per `fetch()` call (P11). XHR was not timed.
- The anything-llm run (RUN.md) was not reproduced by this grader. Its raw rows are not banked by design, so its counts rest on the author's `analyze.mjs`.

## 6. Commands run

All from `/Users/austinho/dev/tracer-n4-body-capture` unless noted. `$S` is the grader's session scratchpad. Deps: `/Users/austinho/dev/trace-consolidated/.live-demo/librechat-m1`.

```sh
git diff fixes-2026-09-24...HEAD            # read in full
cmp src/runtime-attribution-browser.js dist/runtime-attribution-browser.js
node test/browser/body-capture.mjs --out $S/driver-out                      # 34/34
node grader-scratch/body-capture-keep.mjs                                   # 34/34, store kept
python3 grader-scratch/recompute_fixture.py <kept store>                    # §1.1
node grader-scratch/probe-driver.mjs $S/probe                               # §1.2 (on vs off)
python3 grader-scratch/probe_rows.py $S/probe/records.jsonl
node grader-scratch/mcp-probe.mjs . <probe store> '<calls>'                 # §1.5
# real Vite CLI builds in $S/vitecli (8 builds + dev server on :4377, killed by PID)
node grader-scratch/parity-driver.mjs $S/vitecli plain dev-default dev-false prod-always prod-default
node grader-scratch/probe2.mjs $S/vitecli ; node grader-scratch/probe3.mjs $S/vitecli
npm test                                                                    # 693/692/1
node test/browser/d12-stamp-neutrality.mjs <deps> $S/d12                    # 23/23
node grader-scratch/d12-raw.mjs <deps> $S/d12raw                            # raw A vs D diff
node test/browser/continuations-neutral.mjs ; PRODUCTTRACE_CONTINUATION_BODIES=always node test/browser/continuations-neutral.mjs
node grader-scratch/cont-count.mjs (both modes)                             # body-row counts
node test/g4-grader.mjs docs/evidence/m1-2026-09-22-final7 --manifest docs/evidence/g4-mcp-2026-09-23/manifest.json   # 81/81
# G6: store from g6-anything-llm-2026-09-23 + remap-bases manifests into $S/st2
node test/browser/g6-compare.mjs --store $S/st2 --source-root /Users/austinho/dev/fixtures/anything-llm --out $S/g6cmp --pair … (6 pairs)
node test/g6-grader.mjs $S/st2 --compare $S/g6cmp                           # 6/6
git archive main | tar -x -C $S/main-src
node grader-scratch/mcp-all.mjs <root> docs/evidence/m1-2026-09-22-final7 <out>   # branch vs main
git merge-tree --write-tree main HEAD                                       # clean
```

Not read: `/Users/austinho/dev/fixtures/heldout`, `docs/internal`.

---

## Regrade at 9b046875 (2026-09-24, same grader)

This is a targeted regrade of the five fix commits on top of bbfd707b (bc2f539f, 22c4a7cb, 1ac480d5, c62f77e5, 9b046875). I did not rely on RUN-2.md or on the new driver checks.

**Method.**
- A new probe app (`grader-scratch/probe-app2/`) and backend (`probe-backend2.mjs`).
- Nine builds with the **Vite CLI**, then one headless session per build (`regrade-driver.mjs`) over five of them: uninstrumented (`plain`), dev (on), dev `bodies:false`, prod `'always'`, prod default.
- Rows ship to a real collector. I read them raw, recorded the server-side bytes written and the connection close per request, and drove the MCP over stdio.
- Also run: `proto-probe.mjs` and the unchanged suites.

**Final verdict: `merge with changes`.**
- Every code defect from the first grade is fixed on the paths I probed.
- The remaining required changes are:
  - a merge conflict with current `main`;
  - documentation that overclaims in three places;
  - one new privacy residual, numeric secrets, that must at least be documented.

### R1. The six defects, from raw rows

| defect | verdict | raw evidence |
|---|---|---|
| Typeless `Request` bodies | FIXED | Blob, ArrayBuffer and ReadableStream `Request` bodies with no type give `captured:false, reason:"unknown_type", content_type:null, bytes:null`, with no text. (The echo *response* rows 3/5 carry the binary only because my echo server labels it `text/plain`.) |
| 1 MiB cap on every path | HOLDS | Request object, 2 MiB JSON: `over_parse_limit`, `bytes:null`, `bytes_read:1114112` (stopped one chunk past 1 MiB). `init.body` string, 2 MiB: `over_parse_limit`, `bytes:2097177` (a string already in memory; not read). Fetch response, chunked 2 MiB JSON: `over_parse_limit`, `bytes:null`, `bytes_read:2097152`. XHR, 2 MiB: `over_parse_limit`, `bytes:2097178`, `bytes_basis:"utf8_of_text"`. The *kept* buffer is capped. What is read before stopping is chunk-granular: one 2 MiB chunk was read whole before the stop. |
| Fire-and-forget failure | FIXED | Exactly one `unhandledrejection` (`TypeError: Failed to fetch`) and one page error in each of plain, dev, dev-off, prod-`'always'` and prod-default. |
| Cancelled `text/plain` stream (`reader.cancel()`) | FIXED | Server bytes at close: 106 in all five builds; closed about 32 ms after the start in all five. Row: `cancelled_by_app`, `bytes_read:106`. The same holds for JSON of unknown length with `reader.cancel()` (127 in all builds) and for async-iterator `break` (127). |
| `pipeTo` with an aborting destination (author: not noticed) | **NOT FIXED, as the author said. The consequence is not stated plainly.** | **Aborted via `signal`, `text/plain`:** plain, off and prod-default close at 206 bytes after about 65 ms. With bodies on, the connection stays open until Tracer's 4 KB prefix is read: **4106 bytes, 1.27 s**. **Destination errors, JSON of unknown length:** plain, off and prod-default close at 228 bytes. With bodies on, the connection was **still open at the end of the session (17,903 bytes and growing)**; Tracer keeps reading until 1 MiB or page unload. That read is pending: `bodies_pending` counts it and coverage says so (below). RUN-2 ("Other residuals") and G4 §3.3 line 403 state the mechanism ("not observed … ends at the cap"), but not what the app sees: **the server keeps sending, up to 1 MiB for JSON**. README.md line 366 and G4 §3.3's opening claim ("the same connection lifetime when it cancels a stream") state the guarantee without this exception. |
| `bytes:null` + `bytes_read` when unknown | FIXED | 20 KB chunked text: `truncated:true, bytes:null, bytes_read:8192`; the app still read 20480. The `pipeTo` prefix row: `bytes:null, bytes_read:4106`. Untyped endless: `bytes:null`. |
| 204/205/304/HEAD | FIXED | fetch `DELETE`→204, `POST`→205, `GET`→304, `HEAD`→200, and XHR `DELETE`→204: **no body rows**. |
| Untyped response | FIXED | With `content-length`: `unknown_type`, `bytes:42` (exact), `token` never read. Untyped endless stream: `unknown_type`, `bytes:null`. The server wrote 2 bytes before the app's cancel in all five builds, so the body was never teed or read. |
| `bodies_pending` and coverage | FIXED | Dev page `capture.summary` (pagehide): `bodies_emitted 26, bodies_pending 2` (the in-flight `very-slow-json` and the `pipeTo` JSON). The MCP gives `coverage.complete:false` with "2 body read(s) still in flight at the last capture.summary: their network.body rows were not recorded". The off page is complete. The pending requests are not named per segment (`response_body:null`); the reason is page-level. |

### R2. Microtask ordering (the derived promise)

Probe results, uninstrumented vs bodies on (dev and prod-`'always'`), identical in both on-builds:

| pattern | uninstrumented / off / prod-default | bodies on | changed? |
|---|---|---|---|
| `fetch().then(a)` vs `Promise.resolve().then(b)` (coordinator's race) | `b,a` | `b,a` | no |
| `p.then(a)` registered after `p` settled, vs `Promise.resolve().then(b)` | `a,b` | `a,b` | no |
| two reactions on the same fetch + nested microtask | `a1,a2,a1-micro` | same | no |
| `Promise.race(fetch, setTimeout 0)` | `timer` | `timer` | no |
| **`controller.abort()`: `p.catch(fetch-rejected)`, abort-listener microtask, then `Promise.resolve().then(b)` queued after `abort()`** | `listener-micro,fetch-rejected,b` | **`listener-micro,b,fetch-rejected`** | **YES** |

On the rejection path, the app's reaction now runs after a microtask the app queued synchronously after `abort()`. This is deterministic and visible in page output. It is the disclosed "one extra tick", but G4 §3.3 and README.md:366 say "the app behaves as without Tracer: the same page output". That is false for an app whose output depends on this order. I found no change on the fulfilment path.

- D12: **23/23**. My raw A-vs-D diff after dropping `network.body` rows: 87 = 87 rows, kinds in the same order, the only differing path `capture.page.bodies`; D has 4 body rows.
- continuations-neutral: `status ok` in both modes. The counting copy shows 0 body rows per run (`production_off`) vs **3,560–3,569 per run** (`on`).

### R3. Redaction by key segment (raw request row, 36 keys including nested and array keys)

- **Redacted (21):**
  - `session`, `apiKey`, `x-api-key`, `privateKey`, `accesstoken`;
  - `Password`, `access_token`, `cardNumber`, `cvv`, `otp`, `pin`, `jwt`, `bearer`, `credentials`;
  - `clientSecret`, `refreshToken`, `authToken`;
  - `items[0].token`, `items[1][0].password`, `nested.user.passwordHash`, `nested.user.secretAnswer`.
- **Kept:**
  - ids: `author`, `authorId`, `sessionId`, `cardId`, `tokenId`, `itemId`, `userId`;
  - `scorecard`, `cardinality`;
  - `maxTokenLimit: 4096`, `requiresAuth: true`, `tokenCount: 7`, `passwordHint: null`.
- **Recorded in clear (documented residuals):** `OpenAiKey`, `PineConeKey`, bare `key`, the JSON-in-string `payload` (with its inner password), and free-text `note`.
- **New residual, not documented as a consequence: numeric secrets.** Because numbers are never redacted, a numeric `pin: 1234`, `otp: 482913`, `cvv: 123` or `cardNumber: 4111111111111111` is recorded in clear. The docs say "numbers … are never redacted" but not that this includes numeric PINs, OTPs, CVVs and card numbers. My first grade's recommendation 2 ("never redact non-string scalars") caused this. I withdraw it as stated. The better rule keeps booleans and null, and redacts numbers under the strong segments (`password`, `pin`, `otp`, `cvv`, `card`, `ssn`, `secret`, `credential`). `maxTokenLimit`/`tokenCount` survive because `token` is not a strong segment.

### R4–R6

- **Warning (R4):** a Vite CLI build in `production` with `'always'`, `staging` or `test` each warns once: `body capture ON in a "<mode>"-mode build …`. `development`, `staging` with `bodies:false`, and prod-default are silent. Prod `bodies:true` says `disabled`. PASS.
- **Query-string lines (R5):** README.md:372, plugin/README.md and G4 §3.3 line 375 say query strings are "recorded as sent once `fix/mcp-gaps` merges … on this branch alone they are not recorded". PASS.
- **Suites (R6):**
  - `cmp` src = dist (128,764 bytes). PASS.
  - `npm test`: 693/692/1 (`react-context-ref-semantics`). PASS.
  - Author driver: 43/43. PASS.
  - D12 23/23, G4 81/81, G6 6/6 (compare files regenerated). PASS.
  - final7: MCP output byte-identical to this branch's previous run, which differed from main 9a8496fb only by the added `null` fields. PASS.
  - **Parity:** page text is identical for uninstrumented, off and prod-default. It differs for bodies on **only** in the R2 abort-order line (the probe prints it). The author's fixture O2 (uninstrumented) passes.

### New findings

- **N1. Merge conflict.** `main` is now 5e376320 (fix/outcome-labels merged). `git merge-tree main HEAD` reports **CONFLICT (content) in `mcp/tools.mjs`**. After resolving it, re-run the M0–M10 checks, G4 and the final7 branch-vs-main MCP comparison.
- **N2. Global stream prototypes.** With bodies on, the runtime replaces 8 `ReadableStream`/reader prototype methods: `cancel`, `getReader`, `pipeThrough`, `[Symbol.asyncIterator]`, `values`, and the default and BYOB readers' `cancel`. They are app-visible:
  - `name` is `""` (was `cancel`/`getReader`/…);
  - `pipeThrough.length` is 0 (was 1);
  - `toString` is not native;
  - `ReadableStream.prototype[Symbol.asyncIterator] === ReadableStream.prototype.values` becomes `false` (it was `true`).

  RUN-2 mentions the wrapping, but not these effects. `pipeTo` is not wrapped, which is why the `pipeTo` gap exists.
- **N3. Doc inconsistency.** G4 §3.3 lists "a `ReadableStream` request body" under `streaming`, "never read". That is true for `init.body`. But a `Request` object with a JSON-typed `ReadableStream` body is teed and read (capped): row 6 recorded `{"rsId":"r_2","password":"[redacted]"}`. The runtime cannot tell this case apart, because `Request.body` is always a stream. Say so in the docs.

### Required before merge

1. Resolve the `mcp/tools.mjs` conflict with main 5e376320. Re-run the M-series, G4 81/81 and the final7 comparison (only added `null` fields may differ).
2. Correct README.md:366 and G4 §3.3's opening claim. Name both exceptions to "behaves as without Tracer":
   - a `pipeTo` whose destination aborts or errors keeps the connection open while Tracer reads (up to 4 KB for text, up to 1 MiB for JSON of unknown length), and the server keeps sending;
   - a rejection reaction runs one microtask later, which can reorder it after microtasks the app queued in the same turn (probe R2).
3. Document numeric secrets recorded in clear (R3), or better, redact numbers under the strong segments.
4. Correct the `ReadableStream` request-body line in G4 §3.3 (N3).

### Recommended

- Wrap `pipeTo` as `pipeThrough` is, and cancel Tracer's read when it settles. This closes the only remaining connection-lifetime difference.
- Give the prototype wrappers their native `name`/`length` and keep `[Symbol.asyncIterator] === values` (N2).
- Name the pending requests in the coverage reason.

### Commands (regrade)

```sh
git fetch origin                                   # HEAD = origin/fix/body-capture = 9b046875
git diff bbfd707b..HEAD                            # read
cmp src/runtime-attribution-browser.js dist/runtime-attribution-browser.js
# $S/vitecli2: vite build [--mode development|staging|test], GRADER_BODIES=always|true|false, GRADER_PLAIN=1
node grader-scratch/regrade-driver.mjs $S/vitecli2 $S/regrade plain dev devoff prodalways proddefault
node grader-scratch/mcp-probe.mjs . <regrade store> '<action_chain calls>'
node grader-scratch/proto-probe.mjs $S/vitecli2 plain dev devoff
npm test ; node test/browser/body-capture.mjs --out $S/r2/fixture          # 692/693 ; 43/43
node grader-scratch/d12-raw.mjs <deps> $S/r2/d12raw                         # 23/23 + raw A/D diff
node grader-scratch/cont-count.mjs ; PRODUCTTRACE_CONTINUATION_BODIES=always node grader-scratch/cont-count.mjs
node test/g4-grader.mjs docs/evidence/m1-2026-09-22-final7 --manifest docs/evidence/g4-mcp-2026-09-23/manifest.json   # 81/81
node test/browser/g6-compare.mjs --store $S/st2 … (6 pairs) ; node test/g6-grader.mjs $S/st2 --compare $S/r2/g6cmp      # 6/6
node grader-scratch/mcp-all.mjs . docs/evidence/m1-2026-09-22-final7 $S/r2/final7-branch.jsonl
git merge-tree --write-tree main HEAD                                       # CONFLICT mcp/tools.mjs
```

---

## Regrade at 4803c877 (2026-09-24, same grader)

This is a short regrade of the three fix commits on top of 5b2b3b4a (9c446a33, 2468be18, 4fa8e3e3; RUN-3 in 4803c877).

**Method.**
- The probe app from the previous regrade, plus `preventCancel`, unhandled-`pipeTo` and numeric-key probes (`grader-scratch/probe-app3/`, `probe-backend3.mjs`, `regrade-driver3.mjs`).
- Vite CLI builds of plain (uninstrumented), dev (on), dev `bodies:false`, prod `'always'` and prod default. One session each, raw rows from a real collector, and the server's bytes written and close time per request.

**Final verdict: `merge with changes`.** The code at 4803c877 is correct on every probe. The remaining changes are all rebase work:
- the branch is not rebased, by design;
- `main` is now 0d6938d9 (fix/mcp-gaps merged);
- `git merge-tree origin/main HEAD` reports **content conflicts in `src/runtime-attribution-browser.js`, `dist/runtime-attribution-browser.js`, `collector/store.mjs` and `mcp/tools.mjs`**.

### Results

| item | verdict | raw evidence |
|---|---|---|
| (1) `pipeTo`, signal abort, `text/plain` | FIXED | Server bytes at close / ms: plain 206/65, dev 206/62, off 206/64, prod-`'always'` 206/64, prod default 206/64. Row: `cancelled_by_app`, `bytes_read:206`. |
| (1) `pipeTo`, erroring destination, JSON of unknown length | FIXED | 228 bytes and about 63 ms in all five builds (was still open at 17,903 bytes). Row: `cancelled_by_app`, `bytes_read:228`. |
| (1) `preventCancel: true` | RESPECTED | The app aborts the pipe after more than 150 bytes, then reads the rest itself: `rest=true total_ok=true` in every build. The server wrote 8024 bytes and closed after about 460 ms in all builds. Tracer did not cancel: its row is complete (`captured:true`, `bytes:8024`, `truncated:true` at 4 KB). |
| (1) unhandled `pipeTo` rejection | STAYS UNHANDLED | Exactly one `unhandledrejection` `Error: dest-full-unhandled` (plus the fire-and-forget `TypeError`) in each of the five builds. Server 26 bytes in all. |
| (1) other cancels (regression) | HOLD | `reader.cancel()` text 106, JSON 127, iterator `break` 127, untyped 2: equal in all five builds. |
| (2) wrapper shape | FIXED | With bodies on: `cancel/0`, `getReader/0`, `pipeThrough/1`, `pipeTo/1`, `values/0`, reader `cancel/0`, BYOB `cancel/0`: native names and lengths. `[Symbol.asyncIterator] === values` is `true`. `toString` is still non-native (unavoidable for a wrapper). |
| (3) microtask order | UNCHANGED FROM LAST REGRADE, NOW DOCUMENTED | Fulfilment path: race `b,a`, settled `a,b`, same-promise `a1,a2,a1-micro`, timer race `timer` in all five builds. Abort path: `listener-micro,fetch-rejected,b` (plain/off/prod) vs `listener-micro,b,fetch-rejected` (dev/prod-`'always'`). |
| (3) docs | PASS | README.md:366–374 and G4 §3.3 state both differences: (a) connection lifetime, "none known", naming the residual paths (JSON of unknown length abandoned without cancel, `preventCancel:true`, other stop mechanisms); (b) a rejection one microtask later, with my exact order. G4 also notes the derived `pipeTo` promise's extra tick. |
| (3) driver assertions | PASS | The driver asserts the fulfilment-path orders are unchanged (P5: race/settled/same across dev, off, prod, prod-`'always'` and plain) and pins the documented abort-path difference (P6). |
| (4) numeric redaction | PASS | Redacted: `pin 1234`, `otp`, `cvv`, `cardNumber`, `secretAnswer`, `password 123456`, `token 998877`, `pwd 1`, and the unknown suffixes `pinDigits` and `cardLast4`. Kept: `passwordLength`, `maxTokenLimit`, `tokenCount`, `pinLength`, `tokenExpiresAt`, `cardType`, `otpTtl`, `authLevel` (`auth` is not a strong segment), `sessionCount`. |
| (5) G4 ReadableStream line | PASS | G4 §3.3 line 344 separates `init.body` streams (never read) from a `Request` object's body. A `Request` body with a JSON or `text/*` type is teed and read (capped); otherwise it is never read. |
| (6) suites | PASS | `cmp` src = dist (131,059 bytes). `npm test` 693/692/1 (`react-context-ref-semantics`). Driver **49/49**. D12 **23/23**: my raw A/D diff, after dropping body rows, is 87 = 87 rows in the same kind order, with the only differing path `capture.page.bodies`; D has 4 body rows. continuations-neutral `ok` both modes (0 vs 3,556–3,582 body rows per run). G4 81/81. G6 6/6 (compare regenerated). final7 MCP output byte-identical to the previous branch run. **Parity**: page text is identical in all five builds except the documented abort-order line the probe prints. |

### Judgement on (4): the quantity-suffix exception

**It is a sound rule, not a patch**, because it fails closed:
- Numbers are redacted under a strong segment unless the key's *last* segment is on the exception list.
- An unlisted suffix is redacted, as `pinDigits` and `cardLast4` show. So a gap in the list costs a number, not a leak.

Two remarks:
- The list mixes quantities (`limit count max min length len size ttl`) with metadata nouns (`at ms seconds expiry expires expiration version type index`). It would read better as "quantity or metadata suffixes". Additions worth considering: `budget`, `usage`, `total`. Today `tokenBudget: 8000` is redacted.
- **Keep `token` in the strong numeric set.** Numeric one-time tokens (`token: 482913`) are real. The LLM counters that would otherwise suffer are `maxTokens`, `promptTokens` and `completion_tokens`. Their segment is `tokens`, which is neither `token` nor ends in `token`, so they are not secret keys at all and are kept. Dropping `token` would buy little and reopen the numeric-OTP leak.

### Required before merge (rebase only; no code change requested)

1. Rebase onto `main` 0d6938d9 and resolve the four conflicts. The runtime conflict (`src/`/`dist/runtime-attribution-browser.js`) touches the fetch/XHR wrappers, so after the rebase re-run:
   - the driver (49/49);
   - D12 with the raw A/D diff;
   - continuations-neutral in both modes;
   - G4 and G6;
   - `cmp` src/dist;
   - the final7 comparison against the new `main` (only the added `null` fields may differ).
2. `fix/mcp-gaps` has merged, so the query-string lines must now say that query strings **are** recorded as sent on `network.request`, and body rows still carry no URL. The lines to change are README.md:372, plugin/README.md, G4 §3.3 ("Query strings") and RUN-3's privacy restatement (via a new file, since evidence is immutable).

Recommended, not blocking: rename the suffix list as above and add `budget`/`usage`/`total`.

### Commands (this regrade)

```sh
git fetch origin                     # HEAD = 4803c877
git diff 5b2b3b4a..HEAD -- src/runtime-attribution-browser.js
cmp src/runtime-attribution-browser.js dist/runtime-attribution-browser.js
# $S/vitecli3: vite build [--mode development|staging], GRADER_BODIES=always|false, GRADER_PLAIN=1
node grader-scratch/regrade-driver3.mjs $S/vitecli3 $S/regrade3 plain dev devoff prodalways proddefault
node grader-scratch/proto-probe.mjs $S/vitecli3 plain dev
npm test ; node test/browser/body-capture.mjs --out $S/r3/fixture                 # 692/693 ; 49/49
node grader-scratch/d12-raw.mjs <deps> $S/r3/d12raw                               # 23/23 + raw diff
node grader-scratch/cont-count.mjs ; PRODUCTTRACE_CONTINUATION_BODIES=always node grader-scratch/cont-count.mjs
node test/g4-grader.mjs docs/evidence/m1-2026-09-22-final7 --manifest docs/evidence/g4-mcp-2026-09-23/manifest.json
node test/browser/g6-compare.mjs --store $S/st2 … ; node test/g6-grader.mjs $S/st2 --compare $S/r3/g6cmp
node grader-scratch/mcp-all.mjs . docs/evidence/m1-2026-09-22-final7 $S/r3/final7.jsonl
git merge-tree --write-tree --name-only origin/main HEAD                          # 4 conflicts
```
