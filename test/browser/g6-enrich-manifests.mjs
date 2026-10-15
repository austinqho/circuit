#!/usr/bin/env node
// G6 supplementary: enrich a store's per-build manifests with the remap keys
// (text_sha256, name) by reading each build's source from the fixture's git
// objects (`git show <commit>:<file>`; the working tree is never touched).
// Only rows whose blob hash matches the function id are enriched.
//
//   node test/browser/g6-enrich-manifests.mjs --store <dir with runs.jsonl + manifests/> --repo <fixture> --out <dir>
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { parseArgs } from 'node:util';
import { enrichManifest } from '../../collector/store-writer.mjs';

const { values: args } = parseArgs({ options: { store: { type: 'string' }, repo: { type: 'string' }, out: { type: 'string' } } });
const read = file => (fs.existsSync(file) ? fs.readFileSync(file) : zlib.gunzipSync(fs.readFileSync(`${file}.gz`))).toString('utf8');
const runs = read(path.join(args.store, 'runs.jsonl')).split('\n').filter(Boolean).map(line => JSON.parse(line));
fs.mkdirSync(args.out, { recursive: true });
const report = [];
for (const build of [...new Set(runs.map(run => run.build))]) {
  const commit = runs.find(run => run.build === build).source.commit;
  const manifest = JSON.parse(read(path.join(args.store, 'manifests', `${build}.json`)));
  const enriched = enrichManifest(manifest, file => execFileSync('git', ['-C', args.repo, 'show', `${commit}:${file}`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }));
  fs.writeFileSync(path.join(args.out, `${build}.json`), JSON.stringify(enriched));
  report.push({ build, commit, ...enriched.enrichment, named: enriched.functions.filter(row => row.name).length });
}
console.log(JSON.stringify(report, null, 2));
