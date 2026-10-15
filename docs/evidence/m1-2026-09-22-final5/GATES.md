# Gates

- live instrumented smoke click: PASS; action_id=action:mud1whds:7; enters=220; exits=213
- exact request ownership: PASS; violations=0
- write-only DB predicate: PASS; reads excluded from reached_db
- effect-witnessed correct stops: PASS; violations=0
- state-local unreachable reasons: PASS; violations=0
- seven-outcome ledger: PASS; silent=0
- lossless raw ledger retention: PASS; emitted=533846; raw=533846; pages=25; dropped=0; gaps=0
- required state setup: PASS; stops=0

## Eight-flow consistency gate

| flow | actions | write actions | required request actions | jointly proven | result |
|---|---:|---:|---:|---:|---|
| send | 9 | 1 | n/a | 1 | PASS |
| feedback | 2 | 1 | n/a | 1 | PASS |
| regenerate | 1 | 1 | n/a | 1 | PASS |
| edit-resubmit | 7 | 1 | n/a | 1 | PASS |
| rename | 5 | 1 | n/a | 1 | PASS |
| agent-create | 11 | 1 | 1 | 1 | PASS |
| agent-chat | 5 | 1 | 1 | 1 | PASS |
| delete | 4 | 1 | n/a | 1 | PASS |
