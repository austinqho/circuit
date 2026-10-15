import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const evidenceDir = path.resolve(process.argv[2] || 'docs/evidence/m1-2026-09-22-c6');
const baselineRoot = path.resolve(process.argv[3] || '/Users/austinho/dev/trace-consolidated/.live-demo/librechat-m1/client/dist');
const instrumentedRoot = path.resolve(process.argv[4] || '/tmp/producttrace-librechat-m1-cycle3e/client/dist');
const files = root => { const out = []; const walk = dir => { if (!fs.existsSync(dir)) return; for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const file = path.join(dir, entry.name); if (entry.isDirectory()) walk(file); else if (entry.isFile() && file.endsWith('.js') && !file.endsWith('.map')) out.push(file); } }; walk(root); return out; };
const measure = root => { const list = files(root); let raw = 0; let gzip = 0; for (const file of list) { const bytes = fs.readFileSync(file); raw += bytes.length; gzip += zlib.gzipSync(bytes, { level: 9 }).length; } return { files: list.length, raw_bytes: raw, gzip_bytes: gzip }; };
const baseline = measure(baselineRoot); const instrumented = measure(instrumentedRoot); const functions = 5238;
const delta = { raw_bytes: instrumented.raw_bytes - baseline.raw_bytes, gzip_bytes: instrumented.gzip_bytes - baseline.gzip_bytes };
const perFunction = { raw_bytes: delta.raw_bytes / functions, gzip_bytes: delta.gzip_bytes / functions };
fs.writeFileSync(path.join(evidenceDir, 'overhead.md'), `# Cycle 6 served-JS overhead\n\nSource maps (*.map files) are excluded. Measurements are over served JavaScript assets only.\n\n| build | JS files | raw bytes | gzip bytes |\n|---|---:|---:|---:|\n| baseline | ${baseline.files} | ${baseline.raw_bytes} | ${baseline.gzip_bytes} |\n| instrumented | ${instrumented.files} | ${instrumented.raw_bytes} | ${instrumented.gzip_bytes} |\n| delta | — | ${delta.raw_bytes} | ${delta.gzip_bytes} |\n\n- instrumented runtime-attribution functions: ${functions}\n- per-function delta: ${perFunction.raw_bytes.toFixed(2)} raw bytes; ${perFunction.gzip_bytes.toFixed(2)} gzip bytes\n- runtime source now uses integer per-bundle manifest indices and resolves them back to stable content ids; the measured dist is the existing lossless-session build captured before this source-only size comparison.\n`);
console.log(JSON.stringify({ baseline, instrumented, delta, perFunction }));
