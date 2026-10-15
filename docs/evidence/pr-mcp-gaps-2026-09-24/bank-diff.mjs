// node bank-diff.mjs main.jsonl branch.jsonl → per tool: JSON path patterns added/removed/changed, and text line diffs.
import fs from 'node:fs';
const read = file => fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
const [mainRows, branchRows] = process.argv.slice(2, 4).map(read);
const key = row => `${row.name} ${JSON.stringify(row.args)}`;
const branchByKey = new Map(branchRows.map(row => [key(row), row]));
const patterns = new Map(); // tool → Map(pattern → {kind, count, example})
const note = (tool, kind, pathText, example) => {
  const pattern = pathText.replace(/\[\d+\]/gu, '[]');
  if (!patterns.has(tool)) patterns.set(tool, new Map());
  const map = patterns.get(tool); const id = `${kind} ${pattern}`;
  const entry = map.get(id) || { kind, pattern, count: 0, example };
  entry.count += 1; map.set(id, entry);
};
const walk = (tool, left, right, at) => {
  if (JSON.stringify(left) === JSON.stringify(right)) return;
  const object = value => value && typeof value === 'object';
  if (Array.isArray(left) && Array.isArray(right)) {
    for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
      if (i >= left.length) note(tool, 'added', `${at}[${i}]`, right[i]);
      else if (i >= right.length) note(tool, 'removed', `${at}[${i}]`, left[i]);
      else walk(tool, left[i], right[i], `${at}[${i}]`);
    }
    return;
  }
  if (object(left) && object(right) && !Array.isArray(left) && !Array.isArray(right)) {
    for (const k of new Set([...Object.keys(left), ...Object.keys(right)])) {
      if (!(k in left)) note(tool, 'added', `${at}.${k}`, right[k]);
      else if (!(k in right)) note(tool, 'removed', `${at}.${k}`, left[k]);
      else walk(tool, left[k], right[k], `${at}.${k}`);
    }
    return;
  }
  note(tool, 'changed', at, { main: left, branch: right });
};
const text = new Map();
let compared = 0; const missing = [];
for (const row of mainRows) {
  const other = branchByKey.get(key(row));
  if (!other) { missing.push(key(row)); continue; }
  compared += 1;
  walk(row.name, row.structured, other.structured, '$');
  const a = row.text.split('\n'); const b = other.text.split('\n');
  const t = text.get(row.name) || { calls: 0, first_line_changed: 0, lines_added: 0, lines_removed: 0, examples: [] };
  t.calls += 1;
  if (a[0] !== b[0]) { t.first_line_changed += 1; if (t.examples.length < 2) t.examples.push({ main: a[0].slice(0, 400), branch: b[0].slice(0, 400) }); }
  const setA = new Set(a); const setB = new Set(b);
  t.lines_added += b.filter(line => !setA.has(line)).length; t.lines_removed += a.filter(line => !setB.has(line)).length;
  text.set(row.name, t);
}
const onlyBranch = branchRows.filter(row => !mainRows.some(other => key(other) === key(row))).map(key);
console.log(JSON.stringify({ compared, missing_in_branch: missing, only_in_branch: onlyBranch }, null, 1));
for (const [tool, map] of patterns) {
  console.log(`\n## ${tool}`);
  for (const entry of [...map.values()].sort((a, b) => a.pattern.localeCompare(b.pattern))) console.log(`${entry.kind.padEnd(8)} ${String(entry.count).padStart(5)}  ${entry.pattern}  e.g. ${JSON.stringify(entry.example)?.slice(0, 220)}`);
}
console.log('\n## text');
for (const [tool, t] of text) console.log(tool, JSON.stringify(t).slice(0, 1500));
