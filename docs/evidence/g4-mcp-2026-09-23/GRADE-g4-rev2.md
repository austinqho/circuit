# G4 grade

store: docs/evidence/m1-2026-09-22-final7
manifest: docs/evidence/g4-mcp-2026-09-23/manifest.json
result: 81/81 checks pass

| check | pass | detail |
|---|---|---|
| login: entry handler = HANDLERS.md | PASS | mcp=function:c15c44aa0e87167c0174eb68367210b93204299c880fce28068d3117f8c0bf0e:3870:3894 client/src/components/Auth/LoginForm.tsx; key=function:c15c44aa0e87167c0174eb68367210b93204299c880fce28068d3117f8c0bf0e:3870:3894 client/src/components/Auth/LoginForm.tsx |
| login: chain request belongs to the episode | PASS | POST /api/auth/login action=action:mud8rf23:6 |
| login: route span = exact-parent server span | PASS | mcp=0087e26c536bbccb grader=0087e26c536bbccb |
| login: handler spans equal | PASS | mcp=7 grader=7 |
| login: db spans equal | PASS | mcp=8 grader=8 |
| login: writes equal and non-empty | PASS | mcp=["insert sessions"] grader=["insert sessions"] |
| login: frontier says terminal effect | PASS | db / null / database write insert sessions joined by exact span parentage |
| send: entry handler = HANDLERS.md | PASS | mcp=function:5bffa2fdd4c733f29915e45df0c96db29349642d734d468587e001d45b4495ac:17345:18011 client/src/components/Chat/Input/ChatForm.tsx; key=function:5bffa2fdd4c733f29915e45df0c96db29349642d734d468587e001d45b4495ac:17345:18011 client/src/components/Chat/Input/ChatForm.tsx |
| send: chain request belongs to the episode | PASS | POST /api/agents/chat/openAI action=action:mud8sc1x:9 |
| send: route span = exact-parent server span | PASS | mcp=086fc7830bbeea01 grader=086fc7830bbeea01 |
| send: handler spans equal | PASS | mcp=1 grader=1 |
| send: db spans equal | PASS | mcp=21 grader=21 |
| send: writes equal and non-empty | PASS | mcp=["findAndModify conversations","findAndModify messages","insert transactions"] grader=["findAndModify conversations","findAndModify messages","insert transactions"] |
| send: frontier says terminal effect | PASS | db / null / database write findAndModify messages joined by exact span parentage |
| feedback: entry handler = HANDLERS.md | PASS | mcp=function:b6e145fc35bd0ba6db55e49be03b3feca87fa96f6806ac5b0544ae8b6145c59c:3324:3559 client/src/components/Chat/Messages/Feedback.tsx; key=function:b6e145fc35bd0ba6db55e49be03b3feca87fa96f6806ac5b0544ae8b6145c59c:3324:3559 client/src/components/Chat/Messages/Feedback.tsx |
| feedback: chain request belongs to the episode | PASS | PUT /api/messages/f5671dfe-05e8-56bb-9f02-6aea011ec4a5/ec05db9b-e9e8-4b78-afa2-cba32a1903a1/feedback action=action:mud8slme:3 |
| feedback: route span = exact-parent server span | PASS | mcp=e9b1ca52fbe7859b grader=e9b1ca52fbe7859b |
| feedback: handler spans equal | PASS | mcp=3 grader=3 |
| feedback: db spans equal | PASS | mcp=2 grader=2 |
| feedback: writes equal and non-empty | PASS | mcp=["findAndModify messages"] grader=["findAndModify messages"] |
| feedback: frontier says terminal effect | PASS | db / null / database write findAndModify messages joined by exact span parentage |
| regenerate: entry handler = HANDLERS.md | PASS | mcp=function:c057074eb90d959be20f9e8d7801624cfaa20e2e8d36fad2558178c65501d329:3465:3490 client/src/components/Messages/ContentRender.tsx; key=function:c057074eb90d959be20f9e8d7801624cfaa20e2e8d36fad2558178c65501d329:3465:3490 client/src/components/Messages/ContentRender.tsx |
| regenerate: chain request belongs to the episode | PASS | POST /api/agents/chat/openAI action=action:mud8smva:4 |
| regenerate: route span = exact-parent server span | PASS | mcp=4dcacd699579634c grader=4dcacd699579634c |
| regenerate: handler spans equal | PASS | mcp=1 grader=1 |
| regenerate: db spans equal | PASS | mcp=17 grader=17 |
| regenerate: writes equal and non-empty | PASS | mcp=["findAndModify conversations","findAndModify messages","insert transactions"] grader=["findAndModify conversations","findAndModify messages","insert transactions"] |
| regenerate: frontier says terminal effect | PASS | db / null / database write findAndModify messages joined by exact span parentage |
| edit-resubmit: entry handler = HANDLERS.md | PASS | mcp=function:289ebfafc16db6ab1b7c43f3ad92ef1ef1bbc05f52d4aaad5105283f68e4ab40:1759:3526 client/src/components/Chat/Messages/Content/EditMessage.tsx; key=function:289ebfafc16db6ab1b7c43f3ad92ef1ef1bbc05f52d4aaad5105283f68e4ab40:1759:3526 client/src/components/Chat/Messages/Content/EditMessage.tsx |
| edit-resubmit: chain request belongs to the episode | PASS | POST /api/agents/chat/openAI action=action:mud8sqw6:11 |
| edit-resubmit: route span = exact-parent server span | PASS | mcp=26e556377950b2c9 grader=26e556377950b2c9 |
| edit-resubmit: handler spans equal | PASS | mcp=1 grader=1 |
| edit-resubmit: db spans equal | PASS | mcp=17 grader=17 |
| edit-resubmit: writes equal and non-empty | PASS | mcp=["findAndModify conversations","findAndModify messages","insert transactions"] grader=["findAndModify conversations","findAndModify messages","insert transactions"] |
| edit-resubmit: frontier says terminal effect | PASS | db / null / database write findAndModify messages joined by exact span parentage |
| rename: entry handler = HANDLERS.md | PASS | mcp=function:348389e6924deb31f91c5d32cce54049ff9abb71061655c299e6cfc4957e1491:1876:1902 client/src/components/Conversations/RenameForm.tsx; key=function:348389e6924deb31f91c5d32cce54049ff9abb71061655c299e6cfc4957e1491:1876:1902 client/src/components/Conversations/RenameForm.tsx |
| rename: chain request belongs to the episode | PASS | POST /api/convos/update action=action:mud8sw9p:16 |
| rename: route span = exact-parent server span | PASS | mcp=dd2664be4f74ae38 grader=dd2664be4f74ae38 |
| rename: handler spans equal | PASS | mcp=2 grader=2 |
| rename: db spans equal | PASS | mcp=2 grader=2 |
| rename: writes equal and non-empty | PASS | mcp=["findAndModify conversations"] grader=["findAndModify conversations"] |
| rename: frontier says terminal effect | PASS | db / null / database write findAndModify conversations joined by exact span parentage |
| agent-create: entry handler = HANDLERS.md | PASS | mcp=function:8d743139e77d92b28cd8136781b34251ae924d248459cafcdbca5688fb1bab76:13140:14819 client/src/components/SidePanel/Agents/AgentPanel.tsx; key=function:8d743139e77d92b28cd8136781b34251ae924d248459cafcdbca5688fb1bab76:13140:14819 client/src/components/SidePanel/Agents/AgentPanel.tsx |
| agent-create: chain request belongs to the episode | PASS | POST /api/agents action=action:mud8t56z:29 |
| agent-create: route span = exact-parent server span | PASS | mcp=c8298d3458113b49 grader=c8298d3458113b49 |
| agent-create: handler spans equal | PASS | mcp=2 grader=2 |
| agent-create: db spans equal | PASS | mcp=5 grader=5 |
| agent-create: writes equal and non-empty | PASS | mcp=["findAndModify aclentries","insert agents"] grader=["findAndModify aclentries","insert agents"] |
| agent-create: frontier says terminal effect | PASS | db / null / database write insert agents joined by exact span parentage |
| agent-chat: entry handler = HANDLERS.md | PASS | mcp=function:5bffa2fdd4c733f29915e45df0c96db29349642d734d468587e001d45b4495ac:17345:18011 client/src/components/Chat/Input/ChatForm.tsx; key=function:5bffa2fdd4c733f29915e45df0c96db29349642d734d468587e001d45b4495ac:17345:18011 client/src/components/Chat/Input/ChatForm.tsx |
| agent-chat: chain request belongs to the episode | PASS | POST /api/agents/chat/agents action=action:mud8tqrr:34 |
| agent-chat: route span = exact-parent server span | PASS | mcp=36be24b54a48627d grader=36be24b54a48627d |
| agent-chat: handler spans equal | PASS | mcp=1 grader=1 |
| agent-chat: db spans equal | PASS | mcp=17 grader=17 |
| agent-chat: writes equal and non-empty | PASS | mcp=["findAndModify conversations","findAndModify messages","insert transactions"] grader=["findAndModify conversations","findAndModify messages","insert transactions"] |
| agent-chat: frontier says terminal effect | PASS | db / null / database write findAndModify messages joined by exact span parentage |
| delete: entry handler = HANDLERS.md | PASS | mcp=function:3dace8c0d4accdb10fae5d6fa1c4ebfae91dc12defb5c15125de63e5c908766f:2331:2656 client/src/components/Conversations/ConvoOptions/DeleteButton.tsx; key=function:3dace8c0d4accdb10fae5d6fa1c4ebfae91dc12defb5c15125de63e5c908766f:2331:2656 client/src/components/Conversations/ConvoOptions/DeleteButton.tsx |
| delete: chain request belongs to the episode | PASS | DELETE /api/convos action=action:mud8u8jo:38 |
| delete: route span = exact-parent server span | PASS | mcp=886047b249e2022f grader=886047b249e2022f |
| delete: handler spans equal | PASS | mcp=2 grader=2 |
| delete: db spans equal | PASS | mcp=11 grader=11 |
| delete: writes equal and non-empty | PASS | mcp=["delete agent_checkpoint_writes","delete agent_checkpoints","delete conversations","delete messages","delete sharedlinks","delete toolcalls"] grader=["delete agent_checkpoint_writes","delete agent_checkpoints","delete conversations","delete messages","delete sharedlinks","delete toolcalls"] |
| delete: frontier says terminal effect | PASS | db / null / database write delete conversations joined by exact span parentage |
| recent_actions: newest-first order equals raw rows | PASS | first=action:mud8u8jo:38 grader=action:mud8u8jo:38 |
| login: element_history(client/src/components/Auth/LoginForm.tsx) lists the credited action(s) | PASS | listed=action:mud8rf23:6 |
| send: element_history(client/src/components/Chat/Input/ChatForm.tsx) lists the credited action(s) | PASS | listed=action:mud8tqrr:34,action:mud8sc1x:9 |
| feedback: element_history(client/src/components/Chat/Messages/Feedback.tsx) lists the credited action(s) | PASS | listed=action:mud8slme:3 |
| regenerate: element_history(client/src/components/Messages/ContentRender.tsx) lists the credited action(s) | PASS | listed=action:mud8sys4:17,action:mud8smva:4 |
| edit-resubmit: element_history(client/src/components/Chat/Messages/Content/EditMessage.tsx) lists the credited action(s) | PASS | listed=action:mud8sqw6:11 |
| rename: element_history(client/src/components/Conversations/RenameForm.tsx) lists the credited action(s) | PASS | listed=action:mud8sw9p:16 |
| agent-create: element_history(client/src/components/SidePanel/Agents/AgentPanel.tsx) lists the credited action(s) | PASS | listed=action:mud8t56z:29 |
| agent-chat: element_history(client/src/components/Chat/Input/ChatForm.tsx) lists the credited action(s) | PASS | listed=action:mud8tqrr:34,action:mud8sc1x:9 |
| delete: element_history(client/src/components/Conversations/ConvoOptions/DeleteButton.tsx) lists the credited action(s) | PASS | listed=action:mud8u8jo:38 |
| resolve_element {"selector":"form"}: no silent pick | PASS | status=ambiguous candidates=3 |
| resolve_element {"selector":"div > form > textarea#prompt-textarea","name":"Message input"}: no silent pick | PASS | status=ambiguous candidates=2 |
| resolve_element {"element_path":"div > div > button","nearby_text":"Save"}: no silent pick | PASS | status=ambiguous candidates=5 |
| resolve_element {"role":"menuitem"}: no silent pick | PASS | status=ambiguous candidates=2 |
| compare action:mud8smva:4 vs action:mud8sys4:17: path_changed=false | PASS | runtime path unchanged: 11 same; outcome unchanged |
| compare action:mud8sc1x:9 vs action:mud8tqrr:34: path_changed=true | PASS | runtime path changed: 10 same, 1 changed; outcome unchanged |
| compare action:mud8sc1x:9 vs action:mud8sw9p:16: path_changed=true | PASS | runtime path changed: 3 changed, 6 removed, 2 same, 2 added; entry_handler changed (different_handler); outcome http_status 200 → 201, writes ["findAndModify conversations","findAndModify messages","insert transactions"] → ["findAndModify conversations"] |
| frontend-only: 13 request-bearing actions, 0 backend stops, all end at the network frontier | PASS | network_frontiers=13; violations= |
