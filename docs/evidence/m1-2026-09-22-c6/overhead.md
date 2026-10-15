# Cycle 6 served-JS overhead

Source maps (*.map files) are excluded. Measurements are over served JavaScript assets only.

| build | JS files | raw bytes | gzip bytes |
|---|---:|---:|---:|
| baseline | 86 | 18242085 | 4968867 |
| instrumented | 86 | 25875398 | 5722974 |
| delta | — | 7633313 | 754107 |

- instrumented runtime-attribution functions: 5238
- per-function delta: 1457.30 raw bytes; 143.97 gzip bytes
- runtime source now uses integer per-bundle manifest indices and resolves them back to stable content ids; the measured dist is the existing lossless-session build captured before this source-only size comparison.
