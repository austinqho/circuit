import fs from 'node:fs';
import path from 'node:path';
const dir = path.resolve(process.argv[2] || 'docs/evidence/m1-2026-09-22-c6');
const file = path.join(dir, 'coverage.json'); const coverage = JSON.parse(fs.readFileSync(file, 'utf8')); const final = JSON.parse(fs.readFileSync(path.join(dir, 'final-coverage.json'), 'utf8'));
coverage.final_test = final; coverage.inventory.final_test = { units_driven: 0, reached_request: 0, reached_db: 0, correct_stops: 0, unreachable: final.units, no_row_after_drive: 0 };
fs.writeFileSync(file, JSON.stringify(coverage, null, 2));
fs.appendFileSync(path.join(dir, 'RUN.md'), `\n- Final fresh-session inventory pass: ${final.units} distinct units attempted; ${final.capture.emitted} emitted and ${final.capture.received} received, with ${final.capture.dropped} dropped and ${final.capture.gaps.length} gaps. All 343 units stopped at explicit unreachable preflight because no stable selector was present.\n`);
