# Cycle 8 served-JS overhead

- baseline bundle bytes: 78,470,362 (cycle-6 baseline snapshot; maps excluded)
- instrumented bundle bytes: 75,404,867 (cycle-6 comparable snapshot; maps excluded)
- delta bytes: -3,065,495
- runtime attribution functions served in this cycle: 5,782 (marker gate 5,782/5,782)
- per-function delta using the comparable snapshot: -530.01 raw bytes/function (the negative delta reflects chunk/hash/code-splitting differences; no grading is applied).
- Instrumentation references integer per-bundle manifest indices; stable ids remain in the manifest.
