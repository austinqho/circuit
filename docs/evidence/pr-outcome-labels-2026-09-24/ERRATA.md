# Errata to RUN.md (fix/outcome-labels, 2026-09-24)

RUN.md is kept as written, and these corrections apply to it. They follow the independent grade (`GRADE.md`, commit `2f10174f`).

1. **The raw store was not committed.** RUN.md says the store is in `store/`. It was ignored by `.gitignore` (`*.jsonl`) and never committed. The store that produced RUN.md's `outcome-labels-report.json` (session `s_0528419f`) is now committed gzipped (`git add -f`):
   - `store/records.jsonl.gz`: 154 rows, sha256 `012c53350bb87239a63c7a6085b6cbfa59c5cefbd607c3568498bccd03aebcd4`
   - `store/spans.jsonl.gz`: 22 rows, sha256 `5b251c2d426d33088c598abf71f0495a265179b0e9d7a0e063c4349eb8d09eb5`
   - `store/runs.jsonl.gz`: 1 row, sha256 `616626eaa12474dc9f1ae3e45269f368a31829674d94bf56a782f8d9282fbece`

   The second run's store is in `run-2/store/` (see `RUN-2.md`).
2. **"Control flow, stack and identity are unchanged" holds for thrown Error objects only.** For a thrown **non-Error** value (a string, number, plain object), the `error` event's `lineno`/`colno` and the reported source location point at Tracer's injected rethrow (`…threw?.(__ptFrameN,__ptErr);throw __ptErr;}`), not at the app's own `throw`. Error objects keep their original stack and location. Value identity and `typeof` are unchanged.
3. **Unseen rejections are broader than `async () => expr`.** A promise that is *returned* from instrumented code without passing through `await` or `throw` inside that body is never seen by the injected `catch`, because `try { return p } catch` does not observe `p` rejecting. That covers `async () => expr`, `async function f() { return api() }` and a sync `() => fetch(…)`. Such a rejection produces no `promise_rejected` signal. The label abstains and says `no_request` or the response's own status.
4. **2xx/3xx rule.** RUN.md and the first G4 amendment said `completed` = "2xx/3xx and a joined database span". As decided after the grade (G4 amendment "after the independent grade"), `completed` now means one of:
   - a **safe** method (GET/HEAD/OPTIONS/TRACE) answered 2xx, or 304, with any joined database span;
   - an **unsafe** method (POST/PUT/PATCH/DELETE/…) answered 2xx with a joined database **write**.

   Reads only on an unsafe method give `responded` with `note: "no write observed"`. Any other 3xx, and any 3xx on an unsafe method, gives `responded`. So RUN.md's claim-to-code wording on 3xx no longer applies.
5. **RUN.md's reason for leaving `status` out of `compare_chains` was wrong.** It said this kept "G6 verdicts unchanged". In G6 the status differs only in the three pairs whose path already changed, so adding it moves no verdict. `status` and `reason` are now in `outcome_delta.changed`.
6. **"`form_validation` from `form_invalid`" was a false reject source.** The runtime marked `submit` dispatches, and forms with `novalidate` or submitters with `formnovalidate`, although the browser had not validated. Fixed in the runtime and in analysis (see RUN-2.md). RUN.md's residual about multi-step forms still stands for the same-form-mutation rule. That rule now also requires the mutation receipt of the submit's **own** action.
