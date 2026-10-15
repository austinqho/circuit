import fs from 'node:fs';
const [a, b] = process.argv.slice(2).map(f => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(JSON.parse));
const diffs = {}; let identicalText = 0, identicalStruct = 0;
const walk = (x, y, p, out) => { if (JSON.stringify(x) === JSON.stringify(y)) return; if (x && y && typeof x === 'object' && typeof y === 'object') { for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) walk(x[k], y[k], `${p}.${Array.isArray(x) ? '[]' : k}`, out); } else out.add(`${p}: ${JSON.stringify(x)?.slice(0,60)} -> ${JSON.stringify(y)?.slice(0,60)}`); };
a.forEach((row, i) => { const other = b[i]; if (row.text === other.text) identicalText++; if (JSON.stringify(row.structured) === JSON.stringify(other.structured)) identicalStruct++; else { const out = new Set(); walk(row.structured, other.structured, row.name, out); for (const d of out) { const key = d.replace(/: .*/, ''); diffs[key] = diffs[key] || { n: 0, example: d }; diffs[key].n++; } } });
console.log(JSON.stringify({ calls: a.length, identical_text: identicalText, identical_structured: identicalStruct, differences: diffs }, null, 2));
