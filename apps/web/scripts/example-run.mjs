#!/usr/bin/env node
// An example of what a Claude session does with the bench, scripted so it can be
// rerun after every package change: add bulletproof-react, click through it with
// circuit_act over MCP (the same tools Claude gets), then print the report.
//
//   node apps/web/scripts/example-run.mjs [--out report.json]
import fs from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const here = path.dirname(new URL(import.meta.url).pathname);
const out = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : null;
const client = new Client({ name: 'example-run', version: '0.1.0' });
await client.connect(
  new StdioClientTransport({
    command: process.execPath,
    args: [path.join(here, '..', 'src', 'mcp.mjs')],
    env: process.env,
  }),
);
const call = async (name, args) => {
  const result = await client.callTool({ name, arguments: args });
  const text = result.content[0].text;
  if (result.isError) throw new Error(`${name}: ${text}`);
  return JSON.parse(text);
};

const { id } = await call('circuit_add_app', { repo: 'alan2207/bulletproof-react' });
console.error(`app ${id}: building (first build takes several minutes)…`);
const status = await call('circuit_app_status', { app: id, wait_seconds: 900 });
if (status.status !== 'ready') {
  console.error(status.log_tail);
  throw new Error(`app is ${status.status}: ${status.error}`);
}
await call('circuit_reset', { app: id });

const steps = [
  { action: 'goto', value: '/' },
  { action: 'click', target: { role: 'button', name: 'Get started' } },
  { action: 'click', target: { role: 'link', name: 'Register' } },
  { action: 'type', target: { label: 'First Name' }, value: 'Ada' },
  { action: 'type', target: { label: 'Last Name' }, value: 'Lovelace' },
  { action: 'type', target: { label: 'Email Address' }, value: 'ada@example.test' },
  { action: 'type', target: { label: 'Password' }, value: 'circuit-pass' },
  { action: 'type', target: { label: 'Team Name' }, value: 'Analytical Engines' },
  { action: 'click', target: { role: 'button', name: 'Register' } },
  { action: 'wait', value: '1500' },
  { action: 'click', target: { role: 'link', name: 'Discussions' } },
  { action: 'click', target: { role: 'button', name: 'Create Discussion' } },
  { action: 'type', target: { label: 'Title' }, value: 'Notes on the engine' },
  { action: 'type', target: { label: 'Body' }, value: 'First discussion from the bench.' },
  { action: 'click', target: { role: 'button', name: 'Submit' } },
  { action: 'wait', value: '1200' },
  { action: 'click', target: { role: 'link', name: 'View' } },
  { action: 'click', target: { role: 'button', name: 'Create Comment' } },
  { action: 'type', target: { label: 'Body' }, value: 'A first comment.' },
  { action: 'click', target: { role: 'button', name: 'Submit' } },
  { action: 'wait', value: '1200' },
];
for (const step of steps) {
  const result = await call('circuit_act', { app: id, ...step });
  console.error(
    `${result.step.ok ? 'ok ' : 'ERR'} ${result.step.description}${result.step.error ? ` (${result.step.error})` : ''}`,
  );
  for (const line of result.package_said) console.error(`      package: ${line}`);
}

const report = await call('circuit_report', { app: id });
// The same steps on every build so far, side by side: the hillclimb signal.
const keys = Object.keys(report.scorecard);
const cols = report.history.map(
  (row) => `build ${row.build}${row.package ? ` (${row.package})` : ''}`,
);
console.log(['', ...cols].join('\t'));
for (const key of keys)
  console.log([key, ...report.history.map((row) => row.scorecard[key] ?? '-')].join('\t'));
if (out) fs.writeFileSync(out, JSON.stringify(report, null, 2));
await client.close();
