# M1 final7 scripted verification

Headless verification of login plus the eight requested flows. The pattern crawler was not run.

- autonomous build gates: runtime markers 8952/8952; smoke=ok; parity=true
- capture: 216724/216724, dropped=0, gaps=0
- transports: wrapper=165, Playwright=165, reconciliation=0
- function.enter invoked_by completeness: true; enters=108217
- edit-resubmit handler enters: 1
- eight-flow write gate: 8/8
- login write gate: PASS
- chat generation: deterministic local OpenAI-compatible fixture; no external model call in this verification run

See HANDLERS.md for before/after source confirmation.
