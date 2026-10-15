# Cycle 12 negative replays (raw, headless)

Headless raw replays; no grading.

- remove network.request: chains=297; stops={"request_evidence_removed":297}
- remove route.dispatch, handler.enter, db.operation: chains=297; stops={"request_evidence_removed":284,"span_evidence_removed":13}
- remove function.enter: chains=297; stops={"request_evidence_removed":284}
- remove dom.action: chains=293; stops={"dispatch_evidence_removed":293}
