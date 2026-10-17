#!/usr/bin/env node
// Does producttrace change how an app behaves? Runs a flow twice without the
// package and once with it on the bench, through the same MCP tools Claude
// uses, and prints every difference, the overhead and the package's footprint.
//
//   node apps/web/scripts/verify.mjs [--repo owner/name] [--app-dir dir] [--flow file.jsonl] [--out result.json]
//   node apps/web/scripts/verify.mjs --probe
//   node apps/web/scripts/verify.mjs --observe [--probe]
//   node apps/web/scripts/verify.mjs --listen [--probe]
//
// Defaults to bulletproof-react and flows/bulletproof-react.jsonl. `--probe`
// runs the probe page instead (apps/web/probe): one click per case where an
// instrumented app is known to be able to behave differently. `--observe`
// checks debugger mode instead of the package: the third run is the plain app
// with Chrome's debugger watching it. `--listen` checks listen mode: the plain
// app with the listen-mode script on the page. A flow is
// one circuit_act step per line; lines starting with # are comments. Exits 1
// when the app behaved differently.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (name, fallback = null) =>
  process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback;
const probe = process.argv.includes('--probe');
const repo = probe ? path.join(here, '..', 'probe') : arg('--repo', 'alan2207/bulletproof-react');
const flow = probe
  ? path.join(here, '..', 'flows', 'probe.jsonl')
  : arg('--flow', path.join(here, '..', 'flows', 'bulletproof-react.jsonl'));
const out = arg('--out');
const steps = fs
  .readFileSync(flow, 'utf8')
  .split('\n')
  .filter((line) => line.trim() && !line.trim().startsWith('#'))
  .map((line) => JSON.parse(line));

const client = new Client({ name: 'verify', version: '0.1.0' });
await client.connect(
  new StdioClientTransport({
    command: process.execPath,
    args: [path.join(here, '..', 'src', 'mcp.mjs')],
    env: process.env,
  }),
);
const call = async (name, args) => {
  // Starting a large app's dev server can outlast the client's 60 s default.
  const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 600000 });
  const text = result.content[0].text;
  if (result.isError) throw new Error(`${name}: ${text}`);
  return JSON.parse(text);
};

const added = await call('circuit_add_app', {
  repo,
  ...(arg('--app-dir') ? { app_dir: arg('--app-dir') } : {}),
});
let status = await call('circuit_app_status', { app: added.id, wait_seconds: 50 });
while (['queued', 'building', 'starting'].includes(status.status)) {
  console.error(`${added.id}: ${status.status}${status.phase ? ` (${status.phase})` : ''}`);
  status = await call('circuit_app_status', { app: added.id, wait_seconds: 50 });
}
if (status.status !== 'ready') {
  console.error(status.log_tail);
  throw new Error(`app is ${status.status}: ${status.error}`);
}

const mode = process.argv.includes('--observe')
  ? 'observe'
  : process.argv.includes('--listen')
    ? 'listen'
    : 'rewrite';
const modeLabel = { rewrite: '', observe: ' (debugger mode)', listen: ' (listen mode)' }[mode];
let job = await call('circuit_verify', { app: added.id, steps, mode, wait_seconds: 50 });
let phase = null;
while (job.status === 'running') {
  if (job.phase !== phase) console.error(`verify: ${(phase = job.phase)}`);
  job = await call('circuit_verify', { app: added.id, wait_seconds: 50 });
}
await client.close();
if (job.status !== 'done') throw new Error(`verify ${job.status}: ${job.error}`);

const { result } = job;
console.log(
  `${repo}${modeLabel}: ${result.verdict === 'same' ? 'SAME' : 'DIFFERENT'} over ${result.steps} steps`,
);
for (const d of result.divergences) {
  console.log(`  ${d.kind}${d.step ? ` at step ${d.step.index + 1} (${d.step.description})` : ''}`);
  for (const key of ['error', 'plain', 'traced', 'plain_error'])
    if (d[key]) console.log(`    ${key}: ${d[key]}`);
  for (const line of d.only_traced || []) console.log(`    + ${line}`);
  for (const line of d.only_plain || []) console.log(`    - ${line}`);
}
for (const step of result.failed_in_every_run || [])
  console.log(
    `  not checked: step ${step.index + 1} (${step.description}) failed in every run: ${step.error}`,
  );
const { overhead, footprint } = result;
console.log(
  `overhead: script ${overhead.script_ms.plain} ms plain, ${overhead.script_ms.traced} ms traced (x${overhead.ratio ?? '?'}); pages took ${overhead.settle_ms.plain} ms plain, ${overhead.settle_ms.traced} ms traced to settle`,
);
if (overhead.worst_step)
  console.log(
    `  worst step: ${overhead.worst_step.description} (${overhead.worst_step.plain_ms} -> ${overhead.worst_step.traced_ms} ms)`,
  );
console.log(`footprint: attributes ${JSON.stringify(footprint.dom_attributes)}`);
console.log(`  request headers added: ${footprint.request_headers.join(', ') || 'none'}`);
console.log(`  browser APIs replaced: ${footprint.replaced_browser_apis.join(', ') || 'none'}`);
console.log(`  globals added: ${footprint.globals?.join(', ') || 'none'}`);
if (result.observed) {
  const { actions, requests, joined, via, dispatches, runs, unread, pauses } = result.observed;
  console.log(
    `observed: ${actions} actions, ${requests} requests, ${joined} joined to an action ${JSON.stringify(via)}; ${dispatches} user events, ${runs} other events, ${unread} unreadable, ${pauses} pauses`,
  );
}
if (result.listened) {
  const l = result.listened;
  console.log(
    `listened: ${l.actions} actions (${l.with_handler} with a React handler) ${JSON.stringify(l.action_types)}, ${l.requests} requests (${l.started_during_action} started during an action, ${l.with_server_id} with a server id); own cost ${l.cost_ms} ms, ${l.errors} errors, ${l.bytes_sent} bytes in ${l.batches} batches over ${l.pages} page loads`,
  );
}
if (out) fs.writeFileSync(out, JSON.stringify(job, null, 2));
process.exit(result.verdict === 'same' ? 0 : 1);
