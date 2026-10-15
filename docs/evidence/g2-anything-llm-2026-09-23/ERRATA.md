# Errata (anything-llm run 1, superseded: marker gate failed)

The corrections in `../g2-anything-llm-2026-09-23-r3/ERRATA.md` apply here as well:
- one pre-session autofocus `dom.action` outside the step windows;
- the page-load request count;
- `global-listener` rows relabelled `unrooted_global` (a known credit defect);
- `frontend/bundleinspector.html` is written by the fixture's visualizer;
- the Express handler index is not unique for array middleware (fixed in `a64adeff`);
- the raw rows are now committed gzipped, with checksums in `RAW-SHA256.txt`;
- the builds are not kept.

This directory was not independently graded.
