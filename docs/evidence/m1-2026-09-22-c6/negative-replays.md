# Cycle 6 negative replays

Headless raw replays; no grading.

- remove network.request: chains=284; stops={"request_evidence_removed":284}
- remove route.dispatch, handler.enter, db.operation: chains=284; stops={"span_evidence_removed":30,"request_evidence_removed":254}
- remove function.enter: chains=284; stops={"span_evidence_removed":17,"request_evidence_removed":254}
- remove dom.action: chains=282; stops={"dispatch_evidence_removed":282}
