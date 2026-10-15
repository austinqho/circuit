# Cycle 12 limits and stops

- Headless Chromium only; no visible browser or GUI application.
- Transport coverage is 79/79 with 0 reconciliation rows; full-session capture is 1817 emitted/1817 received, with no dropped rows and an empty queue at drain.
- Linkage is labeled direct or mount_effect; unattributed transport remains recorded with a reason.
- Exact backend joins require W3C trace parentage; exported span absence remains a stop.
- Agent Builder used the real provider/model flow; API shapes are retained in coverage.json.
- Stops are reported raw; no model calls were added to the runtime path.
- Surface acceptance is applied literally: a second probe with identical fiber counts is `not_reached`, not a reached surface. In this run, existing-conversation-with-messages, agent-builder/model-panel, prompts, bookmarks, settings-dialog, and search did not produce a distinct signature/count state; sidebar menu and file-attach did.
- The production probe did not retain unregistered function objects, so the required `fn.toString()` first-party-marker versus library-internal split is `not_measured` (no invented classification).
- The c12 same-session harness drove the eight consistency actions below, but did not yet dispatch every deduplicated fiber unit. That is a harness integration blocker for the exhaustive final drive; no unit is silently credited.
