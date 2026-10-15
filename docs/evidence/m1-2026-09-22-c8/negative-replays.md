# Cycle 6 negative replays

Headless raw replays; no grading.

- remove network.request: chains=199; stops={"request_evidence_removed":190,"dispatch_evidence_removed":9}
- remove route.dispatch, handler.enter, db.operation: chains=208; stops={"span_evidence_removed":12,"request_evidence_removed":178,"dispatch_evidence_removed":18}
- remove function.enter: chains=208; stops={"span_evidence_removed":8,"request_evidence_removed":178,"dispatch_evidence_removed":18}
- remove dom.action: chains=206; stops={"dispatch_evidence_removed":206}
