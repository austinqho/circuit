# Cycle 5 negative replays

Headless raw replays; no grading.

- remove network.request: chains=376; stops={"request_evidence_removed":376}
- remove route.dispatch, handler.enter, db.operation: chains=376; stops={"span_evidence_removed":29,"request_evidence_removed":347}
- remove function.enter: chains=376; stops={"span_evidence_removed":16,"request_evidence_removed":347}
- remove dom.action: chains=374; stops={"dispatch_evidence_removed":374}
