# Cycle 6 negative replays

Headless raw replays; no grading.

- remove network.request: chains=284; stops={"request_evidence_removed":284}
- remove route.dispatch, handler.enter, db.operation: chains=284; stops={"request_evidence_removed":271,"span_evidence_removed":13}
- remove function.enter: chains=284; stops={"request_evidence_removed":271}
- remove dom.action: chains=280; stops={"dispatch_evidence_removed":280}
