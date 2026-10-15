#!/usr/bin/env node
// G6 harness step: pick "the same action" in each run of a multi-build store,
// ask the real MCP server (stdio, `producttrace-mcp --store`) to compare them,
// and write the raw results plus a deterministic "what an agent would read"
// rendering. Harness code: the selection rule knows the scenario (step name,
// event); the package does not.
//
//   node test/browser/g6-compare.mjs --store <dir> --source-root <repo> --out <dir> \
//     --step rename-workspace --event submit --pair A-baseline:B-seeded-422 [--pair …]
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const tracerRoot = path.resolve(import.meta.dirname, '../..');
const { values: args } = parseArgs({ options: {
  store: { type: 'string' }, 'source-root': { type: 'string' }, out: { type: 'string' },
  step: { type: 'string', default: 'rename-workspace' }, event: { type: 'string', default: 'submit' },
  pair: { type: 'string', multiple: true },
} });
if (!args.store || !args.out || !args.pair?.length) throw new Error('--store, --out and at least one --pair are required');
const readJsonl = file => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) : []);
const runs = readJsonl(path.join(args.store, 'runs.jsonl'));
const records = readJsonl(path.join(args.store, 'records.jsonl'));

/** Harness selection: the unique `event` dom.action of run `label` inside step `args.step`. */
function select(label) {
  const matching = runs.filter(row => row.label === label);
  if (matching.length !== 1) throw new Error(`expected exactly one run labelled ${label}, found ${matching.length}`);
  const run = matching[0];
  const step = run.steps.find(row => row.name === args.step);
  if (!step) throw new Error(`run ${label} has no step ${args.step}`);
  const actions = records.filter(row => row.kind === 'dom.action' && row.tracer_run === run.run_id && row.event === args.event
    && row.timestamp >= step.started && row.timestamp <= step.ended);
  if (actions.length !== 1) throw new Error(`run ${label}: expected one ${args.event} in step ${args.step}, found ${actions.length}`);
  return { label, run_id: run.run_id, build: run.build, commit: run.source?.commit ?? null, step: args.step, event: args.event, action_id: actions[0].action_id,
    rule: `the unique dom.action with event "${args.event}", tracer_run ${run.run_id}, timestamp within step "${args.step}" [${step.started}, ${step.ended}]` };
}

const serverArgs = [path.join(tracerRoot, 'mcp', 'server.mjs'), '--store', path.resolve(args.store), ...(args['source-root'] ? ['--source-root', path.resolve(args['source-root'])] : [])];
const client = new Client({ name: 'g6-compare', version: '0.0.0' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: serverArgs, stderr: 'ignore' }));
const call = async (name, input) => (await client.callTool({ name, arguments: input })).structuredContent;

const where = source => (source?.file ? `${source.file}${source.line ? `:${source.line}` : `@${source.start}-${source.end}`}` : 'unknown source');
function agentReads(pair, result) {
  const lines = [];
  const entry = result.stops.find(stop => stop.stop === 'entry_handler');
  const changed = result.stops.filter(stop => stop.status !== 'same');
  lines.push(`**${pair.before.label} → ${pair.after.label}** (\`${pair.before.action_id}\` → \`${pair.after.action_id}\`). `
    + `${result.path_changed ? `The runtime path changed (${result.path_change_reasons.join(', ')}).` : 'The runtime path did not change.'} `
    + `Before: reached ${result.before.reached} / stopped at ${result.before.stopped_at ?? 'none'} / because ${result.before.because}. `
    + `After: reached ${result.after.reached} / stopped at ${result.after.stopped_at ?? 'none'} / because ${result.after.because}. `);
  if (entry) lines.push(`Entry handler ${entry.status}${entry.change_kind ? ` (${entry.change_kind}${entry.change_basis ? `, ${entry.change_basis}` : ''})` : ''}: ${where(entry.before?.source)}${entry.status === 'same' ? '' : ` → ${where(entry.after?.source)}`}${entry.detail ? `; ${entry.detail}` : ''}. `);
  const others = changed.filter(stop => stop.stop !== 'entry_handler');
  if (others.length) lines.push(`Stops that differ: ${others.map(stop => `${stop.stop} ${stop.key} ${stop.status}${stop.status === 'changed' ? ` (${stop.before} → ${stop.after})` : stop.status === 'removed' ? ` (was ${stop.before})` : ` (now ${stop.after})`}`).join('; ')}. `);
  else lines.push('Every request, route and handler stop is the same. ');
  lines.push(result.outcome_delta.changed.length ? `Outcome: ${result.outcome_delta.changed.map(field => `${field} ${JSON.stringify(result.outcome_delta.before[field])} → ${JSON.stringify(result.outcome_delta.after[field])}`).join(', ')}.` : 'Outcome unchanged.');
  return lines.join('');
}

fs.mkdirSync(path.join(args.out, 'compare'), { recursive: true });
const reads = ['# What an agent would read', '', 'Rendered deterministically from each `compare_chains` result (no model). Raw results: `compare/*.json`.', ''];
const index = [];
for (const spec of args.pair) {
  const [beforeLabel, afterLabel] = spec.split(':');
  const pair = { before: select(beforeLabel), after: select(afterLabel) };
  const result = await call('compare_chains', { before_action_id: pair.before.action_id, after_action_id: pair.after.action_id });
  const chains = { before: await call('action_chain', { action_id: pair.before.action_id }), after: await call('action_chain', { action_id: pair.after.action_id }) };
  const name = `${beforeLabel}__${afterLabel}`;
  fs.writeFileSync(path.join(args.out, 'compare', `${name}.json`), JSON.stringify({ pair, server_args: serverArgs.slice(1).map(arg => arg.replace(tracerRoot, '<tracer>')), compare_chains: result,
    action_chain_summaries: { before: chains.before.summary, after: chains.after.summary } }, null, 2));
  reads.push(`## ${beforeLabel} → ${afterLabel}`, '', agentReads(pair, result), '', `MCP summary line: \`${result.summary.replace(/`/gu, "'")}\``, '');
  index.push({ pair: name, before: pair.before.action_id, after: pair.after.action_id, path_changed: result.path_changed, reasons: result.path_change_reasons,
    entry_handler: result.stops.find(stop => stop.stop === 'entry_handler')?.change_kind ?? 'same', outcome_changed: result.outcome_delta.changed });
}
fs.writeFileSync(path.join(args.out, 'AGENT-READS.md'), reads.join('\n'));
fs.writeFileSync(path.join(args.out, 'compare', 'index.json'), JSON.stringify(index, null, 2));
await client.close();
console.log(JSON.stringify(index, null, 2));
