# M1 final runtime attribution drive

Headless Playwright only. One authenticated page performed the scripted flow, fiber checkpoints, hover/menu/panel checkpoints, and state-local trusted dispatch.

- prerequisite gates: marker presence 8952/8952; neutral registration 8/8; burst capture 3001/3001 with queue=0 and gaps=0; Agent Builder parity=true
- consistency publication gate: 8/8 scripted mutations emitted action IDs and reached DB spans
- static units: 343
- runtime-only units: 102
- states visited: 59
- reveal depth: 2
- detached dispatches: 0; states={}
- capture: 370/370; dropped=0; gaps=0
- transport reconciliation rows: 0
- identity before: intersection=168/341; static-only=173; runtime-registry-only=8703
- identity after: intersection=280/341; static-only=61; runtime-registry-only=8672
- consistency gate: {"send":{"action_ids":["action:mucwt8mo:7","action:mucwt8qz:8","action:mucwt8ru:9","action:mucwt8s6:10","action:mucwt8si:11"],"reached_db":true},"feedback":{"action_ids":["action:mucwtbp2:13","action:mucwtc0b:14"],"reached_db":true},"regenerate":{"action_ids":["action:mucwtc8z:15"],"reached_db":true},"edit-resubmit":{"action_ids":["action:mucwteh9:16","action:mucwtekb:17","action:mucwteke:18","action:mucwtekf:19","action:mucwteki:20","action:mucwtekl:21","action:mucwtel2:22"],"reached_db":true},"rename":{"action_ids":["action:mucwtgsj:23","action:mucwth3u:24","action:mucwth65:25","action:mucwth7o:26","action:mucwth7o:27"],"reached_db":true},"agent-create":{"action_ids":["action:mucwti9x:30","action:mucwtj3y:31","action:mucwtj6l:32","action:mucwtj6m:33","action:mucwtj7r:34","action:mucwtj7s:35","action:mucwtjdf:36","action:mucwtjos:37"],"reached_db":true},"agent-chat":{"action_ids":["action:mucwu7ke:38","action:mucwu7pn:39","action:mucwu7ss:40","action:mucwu7t7:41","action:mucwu7tl:42"],"reached_db":true},"delete":{"action_ids":["action:mucwu9zz:43","action:mucwua8a:44","action:mucwuajr:45"],"reached_db":true}}
