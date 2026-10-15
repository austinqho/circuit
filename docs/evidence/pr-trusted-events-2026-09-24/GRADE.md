# GRADE: trusted user events (D-G1-21), branch `fix/trusted-events`

Independent grader. I did not write this branch. Every number below comes from rows I read myself, from the MCP server driven over stdio as a black box, or from probes I wrote.

- **Graded head: `53eb8882`**: 7 commits on `main` f9a925d7, including the author's follow-up that turns typed text off by default behind `inputText`. I ran `git log --oneline f9a925d7..HEAD` at the start (head was 96c4d2f2) and again before writing this file (head was 53eb8882).
- The probes first ran on 96c4d2f2. I re-ran all of them on 53eb8882, and every behaviour listed here reproduces there.
- **Where things ran:** snapshots came from `git archive` into the grader scratchpad (`te/final`, `te/head`, `te/main`, `te/neg`). The author was editing the worktree during the grade, so I did not run anything against it.
- **Probe scripts:** `grader-scratch/` in this worktree (not committed): `probes.mjs`, `probe-app.jsx`, `show.mjs`, `rows.mjs`, `mcp.mjs`, `banked.mjs`, `hidden.mjs`, `perf.mjs`, `d12-hover.mjs`, `privacy.mjs`, `privacy-app.jsx`, `kinds-check.mjs`, `legacy-kinds.mjs`, `suite.sh`.

**Verdict: merge with changes.** The mechanism is real, and the main claim holds on the fixture:
- the drag, the Radix choice, the shortcut modifiers, the file input, dblclick, contextmenu, auxclick, drop, touch and long-press requests now have owners (on main, none of them did);
- banked stores are unchanged;
- the suite is green.

It must not merge as it stands. It has:
- two regressions against main: typed characters leak by default through Alt and AltGr keys, and hover-heavy pages lose their `capture.summary` at pagehide;
- one MCP sentence that states a false cause (`opened_by` on the user's own Tab focus);
- gesture ids that are wrong for touch input and for any click made while a key is held;
- recording still decided by a hand list, which misses user kinds that fire;
- MCP output that hides evidence it used to show.

The required changes are listed at the end.

## 1. Per-rule table

| rule | verdict | raw evidence |
|---|---|---|
| **Discovery from `on*` properties at install; `capture.page` lists them** | **Partial** | 3/3 fixture loads: `listened` 147 = 142 from on* setters (Element 8, HTMLElement 102, Document 117, window 125) + 5 supplemented; every recorded kind is in `listened`. **But four user kinds fire and are not listened:** `textInput` (TextEvent), `DOMActivate` (UIEvent), `DOMFocusIn` and `DOMFocusOut` (FocusEvent). All four were `isTrusted: true` on click and typing (`legacy-kinds.mjs`). `textInput` is what React's `onBeforeInput` listens to, and the probe's `onBeforeInput → GET /api/beforeinput` is **unowned** (a_kinds, both heads). Nothing in the rows or the MCP says so. Touch kinds are discovered only when the context has touch (`ontouchstart` false with `hasTouch: false`, true with it), which is correct. |
| **No hand list decides recording; lists only classify; unknown kinds default to record-per-event** | **Violated** | `user_interfaces` (5 names) and `user_plain_kinds` (20 names) decide recording. A trusted event of any other interface, or a plain `Event` not in the list, is not recorded (only counted in `not_user_by_kind`). Probe a_kinds: after browser **Back**, `popstate` → `GET /api/popstate` is **unowned**; `hashchange` is not recorded; the form-validation `invalid` → `/api/invalid` is **unowned**. Native media controls (play, pause, volumechange, seeked: plain Events) are not recorded by construction. `handlerless_kinds` decides what is listened (see the row above). The default is inverted: unknown non-UIEvent kinds are dropped. `animationend`/`transitionend` after a hover are unowned. That is a defensible classification, but today it comes from the same allowlist. |
| **Continuous kinds coalesced per (kind, control, gesture) with a closing range row** | **Holds on the fixture; defects at scale** | Fixture, per load: 127–130 ranges, 124–127 of them count 1. Canvas drag: 8 pointermoves → one range (count 8, x span ≥ 88). Wheel 4 → 4 one-event ranges. Scroll range owns `/api/more`, close row `scroll.last[1] > 150`. **Hover-heavy page** (200 items, 10-row sweep, ~1,250 moves), 3/3 loads per mode: 1,405 coalesced `dom.action` rows (plain divs) / 1,274 (buttons), i.e. 7 kinds × every element crossed. At `pagehide`, only 74–87 of 1,405 close rows and **no `capture.summary`** reached the collector (`maxseq` 1,480–1,493, summary absent in 6/6 hover loads). Coverage then reports the page incomplete ("no capture.summary row"). Main delivered a summary on the same pages. Keydown auto-repeat in a text field: every repeat is its own count-1 range (closed by the following keypress/input), so coalescing does nothing there. On a button, 5 repeats → one range action owning 5 requests. |
| **Gestures tracked by held state, not time** | **Violated for touch, held modifiers, boundary events and HTML drag** | **Touch** (CDP touch and `touchscreen.tap`): `pointerover` = `press`, `pointerdown` = `activation`, `gotpointercapture` = `release`, `pointerup` = `activation`. The pointer events get gesture:1 and the touch events of the same finger gesture:2; one tap spans 4 gesture ids. **Held key** (e2: keydown J with no keyup; e: Shift held): every later mouse click's `mouseup` and `click` get the key's gesture:3, while their `pointerdown`/`pointerup` get gesture:5/7/9. Cause: `latest()` prefers anything held over the pointer gesture released in this task. This affects every Shift-, Ctrl- or Cmd-click, not only lost keyups. A lost keyup stays held for the life of the page: headless had no window blur (`document.hasFocus()` stayed true). RUN.md residual 5 discloses the hold but not this consequence. **Mouse boundary events:** on the Radix trigger, a `pointerout` carrying the release state is classified `release` and the real `pointerup` is `activation`. **HTML drag and drop:** `pointercancel` releases the gesture, so `drag`, `dragover`, `drop` and `dragend` have `gesture_id: null`. The drop still owns `/api/drop`. |
| **Rows carry everything the event carries, never values** | **Holds, with one leak** | pointer (type, id, button, buttons, pressure, x/y, modifiers), key (key, code, 4 modifiers, repeat, location), clipboard `types`, toggle states, files `{count, types}`, drag types, related_target: all present. No `value` in any row. **Leak (default build, prod and dev):** a printable key pressed with Alt, or with Ctrl+Alt (AltGr), is recorded verbatim: `[å+alt]`, `[@+alt+ctrl]` in a plain text field (`privacy.mjs`, trusted CDP key events). On macOS Option and on AltGr layouts these are typed characters, not commands. Main folded every one-character key to `Printable`, so this is a regression. |
| **Caused-by-live-code mark on every discrete event** | **Holds** | `el.focus()` inside a click: blur, focusout, focus, focusin all marked `gesture:false, caused_by` the click. `requestSubmit()` → submit marked `CAUSED` (main did not mark it). Radix pointerup → blur/focus marked. |
| **Episodes fold correctly** | **Partial** | The driver's drag episode is right. Drag from Card one to Card three: `pointerup` on Card three owns `/api/move`; its episode is `[pointerup]` plus `gesture_action_ids`; **the press target (Card one) is not named anywhere in MCP output**, only in the raw `gesture_id`. The click on the common ancestor `<ul>` becomes its own no-request episode. With a held key, the fold of pointerup into the click episode survived only through focusin folding; there is no anchor by gesture. |
| **`opened_by` link lifetime** | **Violated** | g_opener: OpenerA's click calls `B.click()`. After 2 s the user presses **Tab** to B: the `focus`, `focusin` and `keyup` rows on B, and 5 hover-range rows on B, all carry `opened_by_action_id` = OpenerA's click (8 rows, reproduced on 53eb8882). `action_chain(focusin)` renders "this focusin was dispatched on an element that action …'s code activated with a synthetic click". That is false; it was the user's Tab. OpenerA's chain lists these 8 rows under `opened`. Only the later real press cleared the link. |
| **`capture.page` lists observed kinds; the runtime can prove what it observes** | **Raw rows only** | `capture.page.user_events` (listened, sources, interfaces, plain kinds, realms string) and `capture.summary.user_events` (`recorded_by_kind`, `coalesced_by_kind`, `untrusted_skipped`, `not_user_by_kind`) are present. **No MCP tool surfaces any of it.** `coverage.unobserved` is still `["beacon"]`. `observedEventKinds()` is exported and used nowhere. The cycle-2 follow-up (§6.1) asked for `coverage.unobserved` to list unobserved kinds and realms; that was not done. |
| **D12 byte identity** | **Holds** | Suite D12: 23/23. My hover-heavy D12 (A stamps on / B stripped / C stamps off, fixed clock and seed): normalized records identical for hoverbtn (3,481 records, 1,281 actions, 1,274 ranges) and hover (2,823 records). |
| **No attribution change on banked stores except a previously unrecorded event owning a request** | **Holds on banked stores; one live-run change weakens MCP** | See §5. Banked: 780/780 comparable calls identical. Live runs: `/api/pre-armed` and `/api/ping-down` are right by the rows (timer or listener created under the recorded pointerdown). `/api/focused`-type work moves from the click to a caused `focus` row that `recent_actions` hides, and the click's chain text no longer shows it (§4). |

## 2. Driver and fixture (step 1)

The driver at 53eb8882 (`node test/browser/trusted-events.mjs`, 3 invocations × 3 page loads, `TRACER_KEEP_STORE=1`) passed **79/79 each time**. At 96c4d2f2 it passed 73/73 ×3. I recomputed from the raw rows with `rows.mjs`. These results were the same in all 3 loads:

| request | owner (raw rows) |
|---|---|
| `/api/choice?value=banana` | `pointerup` release on the portal `div[role=option]`; the trigger `pointerdown` is recorded |
| `/api/archive` | `click` on "Confirm archive" |
| `/api/dialog-dismissed` | `keydown` Escape |
| `/api/drag` | `pointerup` release on the canvas. Its gesture also holds `pointerdown` (buttons 1), `gotpointercapture` and a pointermove range with count 8 |
| `/api/upload` | trusted `change` on `input[type=file]`, `files {count:1, types:[text/plain]}`, `opened_by` = the Upload click |
| `/api/shortcut` | `keydown` `{key:K, code:KeyK, ctrlKey, shiftKey}` |
| `/api/more` | coalesced `scroll` range on `role=list` |
| `/api/pasted` | `paste` (ClipboardEvent) |
| `/api/details?open=true` | `toggle` (ToggleEvent) |
| `/api/size?value=l` | `change` on `<select>` |
| `/api/ping` (1st) | `click` |
| `/api/ping` (2nd) | none: an untrusted dispatch; `untrusted_skipped` 2 |

Other results:
- Per load: 621–627 rows; 285–288 `dom.action` (158 discrete, 127–130 coalesced); 124–127 one-event ranges.
- **Negative control:** I reran it myself, with main's runtime in `src/` and `dist/`, the 96c4d2f2 driver and 1 load: **3/25** (R0, X2, P2), matching RUN.md.
- The 53eb8882 driver **crashes** on main's runtime: `TypeError` at the inputText `secretRedacted` line, which is not null-safe. The final driver therefore cannot serve as its own negative control.

## 3. Probes (step 2), numbers from 53eb8882 (the same on 96c4d2f2)

| probe | result |
|---|---|
| (a) unlisted kinds | **Owned:**<br>• dblclick → `/api/dbl`<br>• contextmenu → `/api/ctx`<br>• auxclick → `/api/aux`<br>• drop → `/api/drop`<br>On main all four are unowned.<br>**Unowned:**<br>• `onBeforeInput` (textInput is not listened)<br>• `popstate` after Back (not recorded)<br>• `invalid`<br>• `animationend`, `transitionend` ×2<br>`beforeinput` itself is recorded as a row. |
| (b) touch | Tap and CDP touch drag: `touchend` owns `/api/touchend` (main: unowned). Phases and gesture ids are wrong (see §1). touchmove is coalesced (count 5). |
| (c) long press / auto-repeat | 800 ms press: `pointerup` owns `/api/long?ms=803` in the same gesture as the pointerdown. ArrowDown ×6 on a button: 1 keydown press + one continuous range (count 5) owning 5 requests. On main these were 6 separate keydown actions. `x` ×6 in a text field: 5 count-1 keydown ranges plus 5 keypress, 6 beforeinput and 6 input rows. |
| (d) drag across controls | `pointerup` on Card three owns `/api/move?from=one&to=three` (main: unowned). Shared gesture:2 with the pointerdown on Card one. Move ranges are split into 7 per control. MCP never names Card one. The `click` lands on the `<ul>` as a standalone episode. |
| (e) lost keyup | Shift or J held without keyup: every later `click`/`mouseup` carries the key's gesture id. The key stays held until the page ends. RUN.md residual 5 discloses the lost release, not the corruption of click gesture ids. |
| (f) hover-heavy | **Rows:** 1,405 `dom.action` rows (plain divs) / 1,274 (buttons) for one sweep, ~920 B per row, 1.37 MB per page. **Delivery:** pagehide lost ~1,318 close rows plus the summary in 6/6 loads. **CPU** (CDP, 3 reps each):<br>• script time: bare 37–40 ms, main-instrumented 33–43 ms, **branch 206–262 ms**;<br>• task time: bare 293–350 ms, **branch 546–681 ms**;<br>• JS heap: +3 MB.<br>Wall time is identical (~10 s), because Playwright step latency dominates it. **D12:** exact (§1). |
| (g) opener link | Wrong for 2 s and more across a keyboard focus and a hover (§1). |
| (h) untrusted file change | `setInputFiles` from a buffer: 0 `dom.action` rows, `untrusted_skipped: 2`, `/api/upload-buf` unowned. `page_requests` renders "[none: no user action]". No MCP surface mentions the 2 skipped untrusted events. Through a real path (`filechooser`): the `change` owns it, `files {count:1, types:[text/csv]}`, and no file name is recorded. |
| (i) caused work (extra) | Click → `el.focus()`. A native `focus` listener sends `/api/native-focused`:<br>• **main:** owned by the click and shown in the click's chain;<br>• **branch:** owned by the caused `focus` row, which `recent_actions` hides (`context_omitted`), and the click's chain text omits it (listed only in structured `caused`).<br>`requestSubmit()` → POST: the click's text says `no_request … stopped at browser`. |

## 4. Lists in `analysis/user-event-model.mjs` (step 3)

| list | role | judgement |
|---|---|---|
| `user_interfaces` (UIEvent, ClipboardEvent, SubmitEvent, ToggleEvent, CommandEvent) | **decides recording** | Violates the rule (an allowlist). |
| `user_plain_kinds` (20 names) | **decides recording** for plain Events | Violates the rule. Unknown plain kinds default to *not recorded*. |
| `handlerless_kinds` (5 names) | **decides listening** | Hand supplement. It misses textInput, DOMActivate, DOMFocusIn and DOMFocusOut, which fire. |
| `continuous_kinds` (6 names) | classifies | OK. |
| `episode_kinds` (6 names) | classifies episodes | Also decides MCP default visibility (`contextOnly`). OK as classification, but see the hidden-evidence defect. |

Other name uses (tracker `blur`/`visibilitychange`/`keydown`/`keyup`/`pointercancel`/`touchcancel`, runtime `CREDENTIAL_AUTOCOMPLETE`, `EVENT_PROPS`) classify only.

## 5. Volume, `context_omitted`, banked stores (steps 4–5)

**Volume on the fixture** (my count, one load):
- 285 `dom.action` rows against 45 on main;
- 127 ranges, of which **124 are one-event** (mouseover 20, pointerover 19, mouseout 17, pointerout 16, pointerrawupdate 12, pointermove 12, mousemove 12, selectionchange 7, wheel 4, scroll 4, gotpointercapture 1);
- one click produces 7–10 discrete rows: pointerdown, mousedown, focus, focusin, blur, focusout, pointerup, mouseup, click.

**Judgement: a one-event hover range should not be a row pair.** It records that the pointer crossed an element and nothing else. It costs two rows of about 920 B each, per kind, per element, and it produced the pagehide loss. A hover segment should be one range across controls (element count, first and last control), and a per-element row should be emitted only when a listener's work runs under it.

**`context_omitted`:**
- Hides 702 of 858 actions on the fixture store and 8,393 of 8,471 on my probe store.
- The fixture and hover stores have no hidden row that owns a request.
- In my probe, the hidden rows include a caused `focus` that **owns a request** (`/api/native-focused`). `contextOnly` does not check evidence for caused rows, so evidence is hidden.

**Banked stores** (my own `banked.mjs`: recent_actions globally and per session, page_requests per session, action_chain per action, element_history + resolve_element per key, compare_chains for up to 39 consecutive pairs; main f9a925d7 vs 53eb8882 over stdio):

| store | calls | rendered text identical | structured identical (ignoring `context_omitted`) |
|---|---|---|---|
| final7 | 101 | 100 | 100 |
| g3-2026-09-23e | 97 | 96 | 96 |
| g2-anything-llm r4 | 113 | 112 | 112 |
| g6 store | 473 | 472 | 472 |

The one difference per store is the `include_context: true` call, which is invalid on main by design. **780/780 comparable calls are identical.**
- G6: `g6-compare.mjs` regenerated with main and with 53eb8882. `diff -r` of the two output directories is empty. `g6-grader` passes 6/6.
- **Caveat:** banked rows carry no `phase`, so `gestureContext` is false for all of them and this identity holds by construction. It says nothing about the new runtime.

**Changed tests (all read):**
- continuations-neutral (`/api/pre-armed` → the recorded pointerdown; the Ctrl+m lookup by key and modifier): right by the rows, and stricter.
- shadow-dom-context: `/api/ping-down` is right. `/api/focused` is right by the rows, but it moves the request off the click's visible chain (§3 i). The assertion `owned_listeners_ui_unowned>=1` became `dispatch_won>=2`, which is consistent.
- no-cross-control: restricted to episode kinds plus "no other episode"; acceptable.
- outcome-labels: skips the recent_actions/element_history comparison for context rows; acceptable only once hidden rows never carry evidence.
- D12: keys split into down/settle/up because `selectionchange` races keyup; harness-only.
- VM helper fakes: fine.

## 6. Suite at 53eb8882 (step 6)

`suite.sh` on a `git archive` snapshot:

| check | result |
|---|---|
| `cmp` src/dist (committed) | identical |
| `npm run build`, then `cmp` src/dist | identical |
| `npm test` | 700 tests: 699 pass, 1 fail (the known `react-context-ref-semantics`) |
| D12 | 23/23 |
| continuations-neutral | ok |
| shadow-dom-context | ok |
| no-cross-control | ok |
| episode-focus | ok ×3 |
| outcome-labels | 160/160 |
| mcp-gaps | 35/35 |
| body-capture | 51/51 |
| G4 | 81/81 |
| G6 | 6/6; compare output identical to main |

## 7. Privacy after 53eb8882 (step 7)

Probe: `privacy.mjs`. Builds tested: default production, default development, and development with `inputText: true`.

**Default builds (`input_text: "off"`):**
- Typed text is absent: email, OTP, contenteditable and IME strings appear in no row. InputEvent rows carry only `inputType`, `data_length` and `credential_field`, and keys read `Printable`.
- **Except** Alt- and AltGr-produced characters (`å`, `@`), which appear verbatim in keydown rows.

**With `inputText: true` (development build):**
- Text is recorded, including IME composition `data`.
- Redacted: `type=password` and `autocomplete=one-time-code` fields.
- **Not redacted:**
  - an OTP field without `autocomplete` (`908172` recorded);
  - a password field after "show password" switches it to `type=text` (`er7qz` recorded);
  - contenteditable.
- The production build with `inputText: true` states `production_off` and warns (driver I3).

**What a developer might not expect in default rows:**
- **Length of anything typed:** the number of input and keydown rows, plus `data_length`, including password length.
- **Named keys:** Backspace, arrows, Enter and Tab, which show editing behaviour.
- **Command keys and modifiers.**
- **Pointer coordinates:** clientX/Y on every pointer row and range bounds.
- **Selected files:** MIME types and counts (never names).
- **Clipboard and drag type lists.**
- **aria-label text of every hovered element:** this was already present on main, but is now recorded for every element the pointer crosses.

## 8. Residual risks (beyond the author's list)

- iframes, workers, declarative shadow roots (not created through `attachShadow`) and events before install are unobserved. Only a free-text `realms` string on `capture.page` says so.
- Agents drive with Playwright. `selectOption` and buffer `setInputFiles` produce untrusted events, which leave no rows and unowned requests. The MCP says "no user action" and never mentions the `untrusted_skipped` count.
- Overhead: 147 passive capture listeners plus per-event row construction, about 5× script time on pointer movement. Long real sessions are unmeasured.
- The "released in the current task" gesture ends at `setTimeout(0)` and is timing-adjacent. The same `selectionchange`/keyup race forced a D12 harness change.

## 9. Required changes (merge with changes)

1. **Typed-text leak (regression):** do not treat Alt or AltGr as a command. A printable key is recorded as pressed only when Ctrl or Meta is held without Alt, and `getModifierState('AltGraph')` is false. Otherwise fold it. Add a driver check with a trusted Alt and Ctrl+Alt key event in a text field.
2. **Pagehide loss (regression):** closing ranges must not dump thousands of rows at pagehide. Close ranges incrementally: when a range goes idle for a task, or when the pointer leaves the control. Make sure `capture.summary` is delivered first or independently. Add a hover-heavy page (≥200 elements) to the driver, asserting that a summary is present and that range counts equal `coalesced_by_kind`.
3. **Hover volume:** do not emit a row pair per kind per element crossed with nothing held. One hover-segment range with element count and first/last control is enough. Emit a per-control row only when work runs under it. Re-measure against main.
4. **`opened_by` lifetime:** clear the link on any trusted UIEvent on the element (focus, key, pointer, including hover), or apply it only to the non-UIEvent kinds a picker produces (input, change, cancel). Add the Tab-after-2 s case to the driver.
5. **Gesture identity:**
   - Activation and compatibility events (click, mouseup, contextmenu, auxclick) take the gesture of the pointer released in this task before any held key.
   - Boundary events (over, out, enter, leave, got/lostpointercapture) never decide press or release.
   - One touch contact's pointer and touch events share a gesture.
   - HTML drag events inherit the gesture that `pointercancel` ended.
   - Driver checks for Shift+click, touch tap/drag and DnD gesture ids.
6. **Recording decision:** invert it. Record every trusted event of a listened kind unless one documented classification list marks it not-user (load, readystatechange, page lifecycle, device*, animation*, transition*, progress, message …). With that, popstate, hashchange, invalid, resize and media-control kinds are recorded, and unknown kinds default to record-per-event, as the rule says. Add `textInput`, `DOMActivate`, `DOMFocusIn` and `DOMFocusOut` to the handler-less supplement, or discover them another way, and prove that React `onBeforeInput` work is owned.
7. **MCP proof of observation:** surface the listened kinds, `not_user_by_kind`, `untrusted_skipped` and the unobserved realms through coverage (`coverage.unobserved`, as cycle-2 §6.1 asked) and in `page_requests`. An unowned request on a page with untrusted events skipped should say so instead of "no user action".
8. **Hidden evidence:** `contextOnly` must never hide a row that owns evidence, caused rows included. `renderChainLine` must render `caused` and `opened` rows with their requests (for example "opened change … → POST /api/upload", "caused submit → POST /api/submitted"). This fixes the "no_request while the upload happens in its window" defect the cycle-2 handoff named, which the text line still shows.
9. **Driver robustness:** make the inputText section null-safe, so the final driver can run its own negative control against main.

Should-fix, not blocking:
- name the press control of a cross-control drag in the pointerup chain;
- keydown auto-repeat in text fields produces count-1 ranges;
- delete or use `observedEventKinds`.

---

# Regrade at cd91a186

This is the same independent grader (Claude), regrading after the Claude author applied the nine changes (RUN-3) and a Codex agent rebased onto `main` 39449f7a and verified the result (RUN-4). Under the cross-model rule, I graded the code Codex touched last.

**Setup**
- `origin/fix/trusted-events` = `rebase-work` = `cd91a186`. My 1312f427 is an ancestor.
- Snapshots came from `git archive` of cd91a186 (`te/r`) and 39449f7a (`te/m2`).
- Probes are the same `grader-scratch/` scripts. I added a hash-link case, a Shift/Meta-click case, and a DOMActivate check (`domact.mjs`).

**Verdict: merge with one change**: add a hover-cost gate to the driver (§R3). One should-fix item is not blocking (§R1, item 5).

## R1. The nine items, from rows

| # | item | verdict | raw evidence (cd91a186) |
|---|---|---|---|
| 1 | Alt/AltGr characters folded by default | **Fixed** | `privacy.mjs`, trusted CDP keys `å` (Alt) and `@` (Ctrl+Alt): default production and development builds read `Printable` for all 11 Email keys, and `å` appears in no row (it did at 53eb8882). With `inputText: true` (development) they are recorded, as specified. |
| 2 | Ranges close as they go; summary delivered | **Fixed** | 200-item hover sweep, 6/6 loads (3 plain, 3 buttons): every page has `capture.summary`, no missing sequence numbers, `last_sequence` = max. The close rows' counts equal the summary's coalesced events exactly (4,454 plain, 4,394 buttons). This holds on all 18 probe pages. |
| 3 | Hover volume | **Fixed** | Plain divs: 23 rows (5 segment `dom.action` + 5 range closes, split at the 1,000-event bound), 22 KB. At 53eb8882 it was 1,405 `dom.action` and 1.37 MB. Buttons with `onMouseEnter`: 185 per-control rows, all listed in their segment's `with_work` (41/40/48/49/2), plus 752 function rows. Those rows are the work, recorded as the rule says. |
| 4 | `opened_by` cleared | **Fixed** | g_opener: after OpenerA's synthetic click, Tab onto B 2 s later: **0** rows carry `opened_by` (8 did at 53eb8882). The driver's U1 still links the file input's change. |
| 5 | Gesture ids | **Fixed for the named cases; one remaining defect** | **Shift-click and Meta-click:** pointerdown, mousedown, pointerup, mouseup and click all share the pointer gesture (3, 6), not Shift's (1) or Meta's (4). **Touch tap:** pointerdown and touchstart are `press`, pointerup and touchend are `release`, and the compatibility events and click are one gesture. **Boundary kinds:** 0 of 568 boundary rows are press or release (564 continuous, 4 discrete). **Drag and drop:** dragstart, drag, dragenter, dragover, drop and dragend all carry gesture 18, the pointerdown's. **Lost keyup:** later clicks keep their pointer gesture. **Remaining (should-fix):** `DOMActivate` still takes a held key's gesture. 11 of 30 DOMActivate rows differ from their click's gesture: Shift/Meta-click (gesture 1/4), every click after a lost keyup (gesture 3), and the touch tap (DOMActivate and selectstart get a new id). The fix lists click/mouseup/contextmenu/auxclick by name. It does not use the rule "an event dispatched during a pointer activation takes that pointer's gesture", so DOMActivate, which this round added, inherits the old defect. Impact: DOMActivate is context, and in these runs it owned no request. |
| 6 | No hand list decides recording | **Fixed** | `not_user_interfaces` and `not_user_kinds` classify; everything else is recorded. a_kinds: `popstate` ×2 (hash link, then Back), `hashchange` ×2 and `invalid` own `/api/popstate`, `/api/hash` and `/api/invalid`. React `onBeforeInput` → `/api/beforeinput` is owned by `textInput`. DOMActivate, DOMFocusIn and DOMFocusOut are recorded. Lifecycle kinds are `dom.event` rows with `user: false`: readystatechange, load, pageshow, device*, pagereveal, beforeunload, pageswap, animation*, transition*. Residual: `play`/`pause`/`volumechange` are not classified, so an app-started or autoplay `play` is recorded as a user event unless live code marks it caused (disclosed as "errs toward recording"). |
| 7 | MCP exposure; one source for `unobserved` | **Fixed; one source verified** | **One source:** `actionListeners = [...userEventDiscovery.listened]` feeds both `observes.events.recorded` and `user_events.listened`, and the rows prove they match (`observes.events.recorded` = sorted `user_events.listened`, 155 kinds). The runtime enumerates exposed kinds separately, but that walk only computes `unobserved` (exposed_total 155, unobserved `[]` in this Chromium). Its handler-less kinds come from the same `handlerless_kinds`. **The store has one reader:** `observedEventKinds()` feeds both `coverage.mjs` and `store.mjs`. **MCP:** `coverage.user_events` appears on chains. `page_requests` on the buffer-upload page reads "an untrusted (synthetic) input/change event was skipped before it in this window (never a user action)" and "2 untrusted event(s) skipped". Minor: a stale comment on `capture.page` still names `user_interfaces / user_plain_kinds`. |
| 8 | Nothing hidden that owns or caused a request; Upload names its opened change | **Fixed** | `hidden.mjs` over 1,046 probe actions: 947 omitted, **0 own a request**. `el.focus()` → `/api/native-focused`, `el.focus()` → `/api/focused` and `requestSubmit()` → `POST /api/submitted` are each owned by their click and printed in its chain line; on main the first two already were. The driver's Upload click reads `[outcome opened; its change (…) sent POST /api/upload] … this action opened change … → POST /api/upload`. Wording nit: the same line keeps "because no request could be attributed to this action". The drag across cards names the press control: "gesture pressed on `<li … Card one>` (pointerdown …)". |
| 9 | Driver null-safe on main | **Fixed** | I ran cd91a186's driver myself with 39449f7a's runtime in `src` and `dist`: it completes, **5/44** (R0, X2, P1, L1, M5), matching RUN-4. |

## R2. The rebase

**#18's page-end grace against coalesced ranges.** `windowOf` closes a window only at a discrete, non-caused dispatch outside the episode's own gestures. Continuous rows (hover and scroll segments) never close a window, and the last episode's window runs to the last row + 2 s. Ranges closed at pagehide are rows like any other, so `last_timestamp` includes them.
- No request moved on any banked store (below).
- The probe pages' windows are consistent: a hover after a click keeps the click's window open, as on main, where hover was not recorded at all.
- One interaction with R1 item 5: an episode that contains a DOMActivate carrying a stuck key's gesture adds that gesture to `ownGestures`. A later row in that key gesture would then not close the window. Later pointerdowns always open new gestures, so I found no case where this changed an owner.

**#19 names in event rows' handler text** are correct in every chain I read: `onPointerUp` (window listener, drag), `onKeyDown` (document shortcut), `onScroll`, `<Select.Root onValueChange>`, `<details onToggle>`, `<input onPaste>`, `<li onPointerUp>`, `<button onClick>`, `<form onSubmit>`. A native listener assigned to a local named `on` renders as `on client/src/main.jsx@…`, which is its real name.

## R3. Hover cost

I measured twice on a 200-item sweep with about 1,250 moves, 3 reps per cell, as CDP script time.

| run | build | plain divs | buttons with `onMouseEnter` |
|---|---|---|---|
| 1 (loaded machine) | 39449f7a | median 40 ms | median 55.5 ms |
| 1 | cd91a186 | median 157.5 ms (**3.9×**) | median 214.5 ms (**3.9×**) |
| 2 (quiet) | 39449f7a | 27–28 ms | 28–36 ms |
| 2 | cd91a186 | 53–73 ms (**~2.2×**) | 95–120 ms (**~3.3×**) |

In run 2, bare builds were 23–29 ms, and there were **0 long tasks** (≥50 ms) in any cell.

The absolute cost is at most about 0.1 ms per pointer move. That is far below a 16 ms frame, with no long task, and it buys the new per-event ownership. **Judgement: acceptable for a dev tool, but only as a stated residual with a gate.** The ratio moves between 2.2× and 3.9× with machine load, so a ratio gate would flap.

**The gate I require is absolute, one driver check on the driver's existing hover-heavy page:**
- no long task (PerformanceObserver `longtask`, ≥50 ms) during the sweep;
- instrumented minus bare CDP `ScriptDuration`, median of 3, ≤ **0.25 ms per pointer move**.

RUN-3 and RUN-4 state the residual but have no gate. **This is the one required change.**

## R4. Suite, graders, banked stores (cd91a186)

| check | result |
|---|---|
| `cmp` src/dist (committed; and after `npm run build`) | identical |
| trusted-events driver | **118/118 ×3** |
| `npm test` | **730/731** (known `react-context-ref-semantics`) on a rerun. The first run, made while my banked comparison loaded the machine, also failed `backend-register.test.mjs:248` (esm-app outbound fetch, `actual: null`). That file passed 11/11 in each of 3 standalone runs and in the full rerun, so I count it as a load flake in a test this branch does not touch. |
| D12 | **24/24 ×3** |
| my hover D12 (A/B/C, `dom.event` rows as a multiset without `event_sequence`, as the harness does) | identical for both modes |
| continuations-neutral | ok |
| shadow-dom-context | ok |
| no-cross-control | ok |
| episode-focus | ok ×3 |
| outcome-labels | 169/169 |
| mcp-gaps | 35/35 |
| body-capture | 51/51 |
| unlinked-coverage-neutral | 13/13 |
| honest-coverage | 45/45 |
| function-names | 263/263 |
| middleware-reads | 343/343 |
| client-aborts | 245/245 |
| server-outbound `--runs 3 --control` | 170/170 |
| **G4** | **81/81** |
| **G6** | `g6-compare` regenerated with 39449f7a and cd91a186 on the gunzipped banked store: `diff -r` is **empty** (byte-identical, no normalization needed); `g6-grader` **6/6** |
| banked stores, 39449f7a vs cd91a186 | my `banked.mjs` over stdio: final7 101 calls, g3e 97, g2r4 113, g6 473. **Rendered text is identical for every call except the `include_context` call that main rejects.** Structured output is identical once the added empty `chain.window_evidence.untrusted_followed: []` is ignored. |

**Correction to RUN-4:** the 582-row g3e store is committed at `docs/evidence/g3-2026-09-23e/records.jsonl`. The 97-call comparison it says could not be repeated was repeated here: 96/96 identical.

## R5. Remaining residuals

- **DOMActivate / selectstart** take a held key's gesture, or a new one on touch (R1 item 5; should-fix).
- **Hover script time** is 2–4× main, about 0.1 ms per move: gate required (R3).
- **Unclassified media kinds** (play, pause, volumechange) are recorded as user events when app code or autoplay causes them without a live frame.
- **Privacy**, unchanged: lengths of typed text and named keys. With `inputText: true`, credential detection is by `type` and `autocomplete` only (a revealed password, an OTP field without `autocomplete`).
- **Timing bounds:** the 1 s idle and 1,000-event bounds split ranges by clock and count. They are disclosed and never merge ranges.

**Final verdict at cd91a186: merge with changes. Exact list: (1) add the absolute hover-cost gate of R3 to `test/browser/trusted-events.mjs`.** Should-fix, not blocking: the DOMActivate/selectstart gesture (take the gesture of the pointer activation in progress, by mechanism rather than by name), the "no request could be attributed" wording on an `opened` outcome, and the stale `capture.page` comment.
