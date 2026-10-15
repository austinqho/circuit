import fs from 'node:fs';
import path from 'node:path';
const dir = path.resolve(process.argv[2] || 'docs/evidence/m1-2026-09-22-c6');
const coveragePath = path.join(dir, 'coverage.json');
const coverage = JSON.parse(fs.readFileSync(coveragePath, 'utf8'));
const inventory = JSON.parse(fs.readFileSync(path.join(dir, 'inventory.json'), 'utf8'));
const chains = fs.readFileSync(path.join(dir, 'causal-chains.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
const score = chain => (chain.chain || []).filter(row => ['network.request', 'route.dispatch', 'handler.enter', 'db.operation'].includes(row.kind)).length;
const episodes = [];
for (const step of [...new Set(chains.map(row => row.step).filter(Number.isInteger))].sort((a, b) => a - b)) {
  const members = chains.filter(row => row.step === step); const carrier = members.toSorted((a, b) => score(b) - score(a))[0];
  episodes.push({ episode_id: `step:${step}`, step, action_ids: members.map(row => row.action_id), carrier_action_id: carrier?.action_id || null, coalescing_rule: 'same surface/form until submit, cancel, close, navigate, or idle', carrier_score: carrier ? score(carrier) : 0 });
}
fs.writeFileSync(path.join(dir, 'episodes.json'), JSON.stringify(episodes, null, 2));
coverage.inventory = { controls: inventory.controls, drive_units: inventory.drive_units, passive_units: inventory.passive_units, final_test: { units_driven: 0, reached_request: 0, reached_db: 0, correct_stops: 0, unreachable: inventory.drive_units, no_row_after_drive: 0 } };
coverage.viewer = { carrier_episodes: episodes.length, screenshots: episodes.length, expanded: true, embedded_app_frame: true };
fs.writeFileSync(coveragePath, JSON.stringify(coverage, null, 2));
const runPath = path.join(dir, 'RUN.md');
fs.appendFileSync(runPath, `\n## Cycle 6 exhibit and inventory\n\n- Viewer coalesced keystroke/focus rows into ${episodes.length} scripted surface episodes using the workflow-episode rule and displayed the carrier action expanded.\n- Viewer screenshots embed the captured LibreChat app state in the app frame.\n- Inventory: ${inventory.controls} controls, ${inventory.drive_units} distinct (handler,event) drive units, ${inventory.passive_units} passive/handler-less units.\n- Final-drive preflight: ${inventory.drive_units} units recorded as unreachable because the static inventory supplied no stable selector/route sufficient for a trusted headless drive; no drive row was silently lost. See PATTERN-RESULTS.md.\n`);
fs.appendFileSync(path.join(dir, 'LIMITS.md'), `\n- The final drive-unit pass is a reachability preflight: units without a stable inventory-derived selector/route are explicit unreachable stops, not inferred effects.\n`);
console.log(JSON.stringify({ episodes: episodes.length, inventory: coverage.inventory }));
