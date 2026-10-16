#!/usr/bin/env node
/**
 *   producttrace-collector [port] [records.jsonl]                    legacy: one JSONL file
 *   producttrace-collector --store <dir> [--manifest <file>] [--source-root <repo>] [--label <text>] [--port N]
 *
 * --source-root: the checkout the build was made from; stored manifest rows then
 * carry text_sha256 and name (remap keys for compare_chains).
 *
 * Store mode appends records (POST /ingest) and backend spans (POST /spans)
 * into a Tracer store directory that `producttrace-mcp --store <dir>` reads,
 * tagged with this run and the manifest's build id. The run is closed (one
 * row in runs.jsonl) on SIGINT/SIGTERM. POST /run-info {source?, steps?, extra?}
 * sets what that row records about the run (e.g. the source commit and steps).
 * It accepts any origin, like /ingest; the listener is loopback-only (low risk).
 */
import path from 'node:path';
import { parseArgs } from 'node:util';
import { createCollector } from './index.js';

const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  store: { type: 'string' }, manifest: { type: 'string' }, 'source-root': { type: 'string' }, label: { type: 'string' }, port: { type: 'string' },
} });
const port = Number(values.port ?? positionals[0] ?? 8787);
let collector;
if (values.store) {
  // The manifest file is followed, not read once: under a dev server it grows as modules load.
  collector = createCollector({ port, store: { dir: values.store, manifestFile: values.manifest ? path.resolve(values.manifest) : null, label: values.label ?? null, sourceRoot: values['source-root'] ?? null } });
} else {
  collector = createCollector({ port, outputPath: positionals[1] || 'producttrace-evidence.jsonl' });
}

await collector.ready;
console.log(`ProductTrace collector: ${collector.url}/ingest`);
if (collector.store) console.log(`  store: ${collector.store.dir} (run ${collector.store.run_id}, build ${collector.store.build}); spans: ${collector.url}/spans`);
else console.log(`  records: ${collector.outputPath}`);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => {
    await collector.close();
    process.exit(0);
  });
}
