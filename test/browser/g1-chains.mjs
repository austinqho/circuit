// Build one explicit-frontier chain per dom.action from a session's raw
// evidence. Usage:
//   node test/browser/g1-chains.mjs <evidenceDir> --backend=on|off [--manifest=<attribution manifest>]
// Reads records.jsonl (+ spans.jsonl when present), writes causal-chains.jsonl
// and chains-summary.json. The backend declaration is required.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import zlib from 'node:zlib';
import { buildActionChains } from '../../analysis/runtime-attribution.mjs';

const evidenceDir = path.resolve(process.argv[2] || '');
const flag = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
const backend = flag('backend');
if (!['on', 'off'].includes(backend)) { console.error('--backend=on|off is required (declared, never inferred)'); process.exit(2); }
// Evidence stores large raw files gzipped (lossless); read either form.
const readJsonl = async file => {
  const rows = [];
  const gz = `${file}.gz`;
  if (!fs.existsSync(file) && !fs.existsSync(gz)) return rows;
  const input = fs.existsSync(file) ? fs.createReadStream(file) : fs.createReadStream(gz).pipe(zlib.createGunzip());
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) if (line.trim()) rows.push(JSON.parse(line));
  return rows;
};
const records = await readJsonl(path.join(evidenceDir, 'records.jsonl'));
const spans = await readJsonl(path.join(evidenceDir, 'spans.jsonl'));
const manifestPath = flag('manifest');
const registeredFunctionIds = manifestPath ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')).functions.map(row => row.id) : null;
const attributionRows = records.filter(row => row.kind !== 'element.stamp');
const chains = buildActionChains(attributionRows, spans, { backendInstrumented: backend === 'on', registeredFunctionIds });
const out = fs.openSync(path.join(evidenceDir, 'causal-chains.jsonl'), 'w');
try { for (const chain of chains) fs.writeSync(out, `${JSON.stringify(chain)}\n`); } finally { fs.closeSync(out); }
const terminals = {};
for (const chain of chains) { const key = `${chain.stopped_at ?? 'reached_db'} | ${chain.because ?? '-'}`; terminals[key] = (terminals[key] || 0) + 1; }
const backendStops = chains.filter(chain => chain.reached.some(step => ['route', 'server_handler', 'db'].includes(step.stop))).length;
const summary = {
  schema: 'producttrace.g1-chain-summary.v1', backend_instrumented: backend === 'on', records: records.length, spans: spans.length,
  actions: chains.length, actions_with_requests: chains.filter(chain => chain.requests.length).length,
  terminals, chains_with_backend_steps: backendStops,
  credited_entry_handlers: chains.filter(chain => chain.entry_handler).length,
};
fs.writeFileSync(path.join(evidenceDir, 'chains-summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
