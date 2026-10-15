# Cycle 9 limits and stops

- Headless Chromium only; no visible browser or GUI application.
- Transport coverage is 79/79 with 0 reconciliation rows.
- Linkage is labeled direct or mount_effect; unattributed transport remains recorded with a reason.
- Exact backend joins require W3C trace parentage; exported span absence remains a stop.
- Agent Builder used the real provider/model flow; API shapes are retained in coverage.json.
- Stops are reported raw; no model calls were added to the runtime path.
- The action-window default reduces the session from 796173 rows (c8) to 1791;
  full-session capture remains lossless.
- Live `/c/new` fiber enumeration (direct/via_ancestor/unregistered) was not
  completed by the current headless harness, so the final fiber-driven pattern
  test stopped before dispatch; no units are claimed as driven.
