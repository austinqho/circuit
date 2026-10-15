# Gates

- live instrumented smoke click: PASS; action_id=action:mud5f6pd:7; enters=197; exits=197
- exact request ownership: PASS; violations=0
- write-only DB predicate: PASS; reads excluded from reached_db
- effect-witnessed correct stops: PASS; violations=0
- state-local unreachable reasons: PASS; violations=0
- seven-outcome ledger: PASS; silent=0
- lossless runtime capture: PASS; emitted=647573; raw=647573; pages=50; pagehide_pages=50; dropped=0; gaps=0
- wrapper-recorded == Playwright-observed, zero reconciliation: PASS; wrapper=1110; playwright=1110; reconciliation=0
- required state setup: PASS; stops=0

## Eight-flow consistency gate

| flow | actions | write actions | required request actions | jointly proven | entry-handler units | result |
|---|---:|---:|---:|---:|---:|---|
| send | 9 | 1 | n/a | 1 | 1 | PASS |
| feedback | 2 | 1 | n/a | 1 | 1 | PASS |
| regenerate | 1 | 1 | n/a | 1 | 1 | PASS |
| edit-resubmit | 7 | 1 | n/a | 1 | 1 | PASS |
| rename | 5 | 1 | n/a | 1 | 1 | PASS |
| agent-create | 11 | 1 | 1 | 1 | 1 | PASS |
| agent-chat | 5 | 1 | 1 | 1 | 1 | PASS |
| delete | 4 | 1 | n/a | 1 | 1 | PASS |

- send entry units: function:5bffa2fdd4c733f29915e45df0c96db29349642d734d468587e001d45b4495ac:17345:18011|submit
- feedback entry units: function:b6e145fc35bd0ba6db55e49be03b3feca87fa96f6806ac5b0544ae8b6145c59c:3347:3559|click
- regenerate entry units: function:c057074eb90d959be20f9e8d7801624cfaa20e2e8d36fad2558178c65501d329:3465:3490|click
- edit-resubmit entry units: function:331fd4345137cbf1b7c01850c3999c382577bbec382335994fe42dd9a8b4616b:308:413|click
- rename entry units: function:348389e6924deb31f91c5d32cce54049ff9abb71061655c299e6cfc4957e1491:1876:1902|click
- agent-create entry units: function:03e1cb3bc038e969913a678f7dba70299865e9d83f2601d7e4a8a558aec974db:8299:8402|submit
- agent-chat entry units: function:5bffa2fdd4c733f29915e45df0c96db29349642d734d468587e001d45b4495ac:17345:18011|submit
- delete entry units: function:3dace8c0d4accdb10fae5d6fa1c4ebfae91dc12defb5c15125de63e5c908766f:2331:2656|click
