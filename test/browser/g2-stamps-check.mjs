#!/usr/bin/env node
// Resolve element.stamp keys to file:line and check them against the fixture
// source (G3's two-repo clause, run on the G2 fixtures). Reads only the
// evidence dir (stamps.jsonl, records.jsonl) and the fixture files.
//
// For every stamped placement: the placement id's content hash must equal the
// sha256 of the fixture file; the source at `start` must be `<` followed by
// the recorded JSX tag; `line` must be the line of `start`; the source at
// `end - 1` must be `>` (end of the element). The sample is the element keys
// the scripted session acted on (dom.action target), topped up to 10 with
// other stamped keys in stamp order.
//
// Usage: node test/browser/g2-stamps-check.mjs <evidence dir> <fixture repo>
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const [dirArg, repoArg] = process.argv.slice(2);
const dir = path.resolve(dirArg); const repo = path.resolve(repoArg);
const readJsonl = file => fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
// element.stamp rows live in records.jsonl (ordered after the page's runtime
// rows); evidence written before that merge kept them in stamps.jsonl.
const records = readJsonl(path.join(dir, 'records.jsonl'));
const stamps = fs.existsSync(path.join(dir, 'stamps.jsonl')) ? readJsonl(path.join(dir, 'stamps.jsonl')) : records.filter(row => row.kind === 'element.stamp');
const sources = new Map();
const source = file => { if (!sources.has(file)) { const absolute = path.join(repo, file); sources.set(file, fs.existsSync(absolute) ? fs.readFileSync(absolute, 'utf8') : null); } return sources.get(file); };

const check = row => {
  const content = source(row.file);
  const match = /^placement:([0-9a-f]{64}):(\d+):(\d+)$/u.exec(row.placement_id || '');
  const problems = [];
  if (content == null) problems.push('file missing');
  if (!match) problems.push('placement id malformed');
  if (content != null && match) {
    if (crypto.createHash('sha256').update(content).digest('hex') !== match[1]) problems.push('content hash differs from fixture file');
    if (Number(match[2]) !== row.start || Number(match[3]) !== row.end) problems.push('placement offsets differ from row start/end');
    const opening = content.slice(row.start, row.start + 1 + String(row.tag).length + 1);
    if (!new RegExp(`^<${String(row.tag).replace(/[.$]/gu, '\\$&')}[\\s/>]`, 'u').test(opening)) problems.push(`source at start is ${JSON.stringify(content.slice(row.start, row.start + 30))}, not <${row.tag}`);
    if (content.slice(0, row.start).split('\n').length !== row.line) problems.push('line differs from start offset');
    if (content[row.end - 1] !== '>') problems.push('source before end is not >');
  }
  return problems;
};

// The binding site (outermost placement in the host's chain that binds a
// registered handler, when different from the element's own JSX site).
const checkBinding = binding => {
  const match = /^placement:([0-9a-f]{64}):(\d+):(\d+)$/u.exec(binding.placement_id || '');
  const content = source(binding.file);
  if (!match || content == null) return { verified: false, problem: 'unresolvable binding placement' };
  const start = Number(match[2]);
  const ok = crypto.createHash('sha256').update(content).digest('hex') === match[1] && content[start] === '<'
    && content.slice(0, start).split('\n').length === binding.line;
  return { verified: ok, source: content.slice(start, start + 70).replace(/\s+/gu, ' ') };
};
const byKey = new Map();
for (const row of stamps) if (!byKey.has(row.element_key)) byKey.set(row.element_key, row);
const byPlacement = new Map();
for (const row of stamps) if (!byPlacement.has(row.placement_id)) byPlacement.set(row.placement_id, row);
const placementResults = [...byPlacement.values()].map(row => ({ row, problems: check(row) }));
const acted = [...new Set(records.filter(row => row.kind === 'dom.action' && row.target?.element_key).map(row => row.target.element_key))];
const sampleKeys = [...acted.filter(key => byKey.has(key)), ...[...byKey.keys()].filter(key => !acted.includes(key))];
const sample = [];
for (const key of sampleKeys) {
  const row = byKey.get(key);
  if (sample.some(item => item.row.placement_id === row.placement_id)) continue; // distinct placements
  sample.push({ key, acted_on: acted.includes(key), row, problems: check(row) });
  if (sample.length === 10) break;
}
const snippet = row => (source(row.file) || '').slice(row.start, Math.min(row.end, row.start + 90)).replace(/\s+/gu, ' ');
const result = {
  schema: 'producttrace.g2-stamp-check.v1', stamp_rows: stamps.length, distinct_keys: byKey.size, distinct_placements: byPlacement.size,
  placements_verified: placementResults.filter(item => !item.problems.length).length,
  placement_problems: placementResults.filter(item => item.problems.length).map(item => ({ placement_id: item.row.placement_id, file: item.row.file, line: item.row.line, problems: item.problems })),
  acted_on_keys: acted.length, acted_on_keys_with_stamp_row: acted.filter(key => byKey.has(key)).length,
  sample: sample.map(item => ({ element_key: item.key, acted_on: item.acted_on, file: item.row.file, line: item.row.line, start: item.row.start, end: item.row.end,
    tag: item.row.tag, host_tag: item.row.host_tag, component: item.row.component, placement_via: item.row.placement_via,
    binding: item.row.binding_placement ? { file: item.row.binding_placement.file, line: item.row.binding_placement.line, component: item.row.binding_placement.component, ...checkBinding(item.row.binding_placement) } : null,
    handlers: (item.row.handlers || []).map(handler => `${handler.prop}`), source: snippet(item.row), verified: !item.problems.length, problems: item.problems })),
};
fs.writeFileSync(path.join(dir, 'stamp-check.json'), `${JSON.stringify(result, null, 2)}\n`);
const lines = [`# Stamp keys resolved against source (${path.basename(dir)})`, '',
  `Generated by \`test/browser/g2-stamps-check.mjs\` from the element.stamp and dom.action rows and the fixture at \`${repo}\`.`, '',
  `- element.stamp rows: ${result.stamp_rows}; distinct keys ${result.distinct_keys}; distinct placements ${result.distinct_placements}`,
  `- placements verified against source (hash, \`<tag\` at start, line, \`>\` before end): ${result.placements_verified}/${result.distinct_placements}`,
  `- element keys the session acted on: ${result.acted_on_keys} (with a stamp row: ${result.acted_on_keys_with_stamp_row})`, '',
  'The key resolves to the element\'s own JSX site (file:line). When a different, outer placement binds the registered handler, the stamp row also carries that binding site; both are checked.', '',
  '| # | element_key | acted on | element site file:line | tag (host) | via | handlers | source at span | binding site (handler authored) | verified |', '|---|---|---|---|---|---|---|---|---|---|',
  ...result.sample.map((item, index) => `| ${index + 1} | \`${item.element_key}\` | ${item.acted_on ? 'yes' : 'no'} | \`${item.file}:${item.line}\` | ${item.tag} (${item.host_tag}) | ${item.placement_via} | ${item.handlers.join(', ')} | \`${item.source.replace(/\|/gu, '\\|')}\` | ${item.binding ? `\`${item.binding.file}:${item.binding.line}\` \`${(item.binding.source || '').replace(/\|/gu, '\\|')}\`${item.binding.verified ? '' : ' (UNVERIFIED)'}` : ''} | ${item.verified && (!item.binding || item.binding.verified) ? 'yes' : [...item.problems, ...(item.binding && !item.binding.verified ? ['binding'] : [])].join('; ')} |`), ''];
if (result.placement_problems.length) lines.push('## Placement problems', '', ...result.placement_problems.map(item => `- ${item.file}:${item.line}: ${item.problems.join('; ')}`), '');
fs.writeFileSync(path.join(dir, 'STAMPS.md'), `${lines.join('\n')}\n`);
console.log(JSON.stringify({ placements_verified: `${result.placements_verified}/${result.distinct_placements}`, sample_verified: result.sample.filter(item => item.verified && (!item.binding || item.binding.verified)).length, problems: result.placement_problems.length }));
