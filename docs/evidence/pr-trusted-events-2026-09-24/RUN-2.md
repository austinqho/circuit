# Trusted user events: RUN-2 (2026-09-24, typed text off by default)

This file adds to `RUN.md`, which was not edited. The implementer wrote it; it is not a grade.

**Coordinator decision.** Typed text is not recorded by default. It is applied as one commit on top of 96c4d2f2.

## Change

**Default.** Rows carry no typed text:
- InputEvent and CompositionEvent rows carry `inputType`, `isComposing`, `data_length` and `credential_field`. There is no `data`.
- A printable key pressed without Ctrl, Alt or Meta reads `"Printable"` (key and code).
- Named keys are recorded by name.
- A key pressed with Ctrl, Alt or Meta is a command and is recorded as pressed. The shortcut row still reads `key: "K", code: "KeyK", ctrlKey, shiftKey`.

**Plugin option `inputText: true`.**
- In a non-production build it records `data` and the key and code of printable keys, and warns at build: `input text capture ON in a "development"-mode build ...`.
- In a production build it stays off, reports `production_off`, and warns: `input text capture disabled ...`.

`capture.page.input_text` states the mode: `off`, `on` or `production_off`. The option is typed in `integrations/vite.d.mts`.

**Password and credential fields** (`type=password`, or `autocomplete` current-password, new-password, one-time-code, cc-*) are redacted in every mode:
- `data_redacted: "credential_field"` with `data_length`;
- keys folded to `"Printable"`, even with a modifier held.

**Fixture.** Adds a password field (`Secret`). The driver types `ab` into Note and `pw` into Secret in every mode.

## Results at the new head

| run | result | file |
|---|---|---|
| `npm run build`, `cmp` src/dist | identical | (shown in the session) |
| `npm test` | 700 tests, 699 pass, 1 known failure (`react-context-ref-semantics`) | `runs/npm-test-input-text.txt` |
| trusted-events driver: 3 default page loads, plus one `inputText: true` development build and one `inputText: true` production build | **79/79** | `runs/trusted-events-input-text.txt` |
| D12 (A, B, C, D) | 23/23, byte-identical (`input_text: "off"` in every variant) | `runs/d12-input-text.txt` |

New checks in the driver:

| check | mode | asserts |
|---|---|---|
| P1 | default | `input_text: "off"`; Note input rows have `data_length: 1`, `credential_field: false` and no `data` |
| P4 | default | no row about Note or Secret carries the text; every printable key and code reads `Printable`; Secret is flagged as a credential field |
| I1 | development, `inputText: true` | `input_text: "on"`, the build warning, data `a` and `b`, keys `a:KeyA,b:KeyB` |
| I2 | development, `inputText: true` | Secret is still redacted, and `"pw"` appears in no row |
| I3 | production, `inputText: true` | `input_text: "production_off"`, the build warning, no typed text, Secret redacted |

## Updated residual 3 (supersedes RUN.md residual 3)

Typed text is opt-in and dev-only. Nothing else about typing is recorded beyond `inputType`, `data_length` and named keys.

Two things still reveal information about what is typed:
- `data_length` and the count of `Printable` keydowns reveal how long the typed text is;
- named keys (Backspace, arrows) reveal how the text was edited.
