// List every unattributed non-internal request of a G1 run with its context:
// the preceding action, the time since it, the scripted step it fell in, and
// a reason. The runtime only records `unattributed_transport` (no action
// frame was current when the request was created); the reason here names
// which kind of creation site that was, from the continuation evidence:
//   before_first_action   - boot requests, no action has happened yet;
//   unowned_continuation  - created on a continuation whose owner is unknown
//                           (an unowned timer/interval, a scheduler message or
//                           effect with no receipt, a promise created outside
//                           any action);
// and optional hand annotations (url regex -> note) from --notes=<json>.
//   node test/browser/g1-unattributed.mjs <evidenceDir> [--notes=<json>]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const dir = process.argv[2];
const flag = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
const notes = flag('notes') ? JSON.parse(fs.readFileSync(flag('notes'), 'utf8')) : [];
const plain = path.join(dir, 'records.jsonl');
const text = fs.existsSync(plain) ? fs.readFileSync(plain, 'utf8') : zlib.gunzipSync(fs.readFileSync(`${plain}.gz`)).toString('utf8');
const rows = text.split('\n').filter(Boolean).map(line => JSON.parse(line)).filter(row => Number.isInteger(row.sequence)).sort((a, b) => a.sequence - b.sequence);
const timeline = fs.readFileSync(path.join(dir, 'timeline.jsonl'), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)).filter(entry => Number.isInteger(entry.step));
// Scripted steps are noted when they complete: a request belongs to the first
// step whose completion note is at or after it.
const stepAt = ts => timeline.find(entry => Date.parse(entry.at) >= ts)?.step ?? null;
let lastAction = null; const out = [];
for (const row of rows) {
  if (row.kind === 'dom.action') { lastAction = row; continue; }
  if (row.kind !== 'network.request' || row.internal || row.action_id) continue;
  if (/(?:\/api\/demo\/|\/react-observations|\/__capture(?:$|\?))/u.test(String(row.url || ''))) continue;
  const note = notes.find(item => new RegExp(item.url).test(`${row.method} ${row.url}`) && (item.step == null || item.step === stepAt(row.timestamp)));
  out.push({ sequence: row.sequence, method: row.method, url: row.url, transport: row.transport, runtime_reason: row.reason || null,
    reason: lastAction ? 'unowned_continuation' : 'before_first_action',
    during_step: stepAt(row.timestamp), preceding_action: lastAction ? { action_id: lastAction.action_id, event: lastAction.event, target: lastAction.target?.attributes || null, ms_before: row.timestamp - lastAction.timestamp } : null,
    ...(note ? { note: note.note } : {}) });
}
const counts = Object.fromEntries(Object.entries(Object.groupBy(out, item => item.reason)).map(([key, value]) => [key, value.length]));
console.log(JSON.stringify({ count: out.length, counts, requests: out }, null, 2));
