# Negative replays

All runs were headless. Raw replay outcomes only; no grading.

Runtime smoke: {"status":"ok","headless":true,"function_id":"function:8707066c05657fed9db9430ccb57a662df8b1adf87efdc64710a84efd98a9daa:65:160","enters":1,"network_requests":3,"same_action":true,"poll_unattributed":true,"caused_attributed":true,"stream_attributed":true}

The negative fixture arms a poll timer before the click and starts an EventSource stream from the click; poll remains unattributed while the caused request and stream callback retain action continuity.

- remove network.request: chains=229; stops={"request_evidence_removed":127,"dispatch_evidence_removed":102}
- remove route.dispatch, handler.enter, db.operation: chains=230; stops={"span_evidence_removed":18,"request_evidence_removed":109,"dispatch_evidence_removed":103}
- remove function.enter: chains=229; stops={"span_evidence_removed":9,"request_evidence_removed":109,"dispatch_evidence_removed":102,"effect":9}
- remove dom.action: chains=224; stops={"dispatch_evidence_removed":224}
