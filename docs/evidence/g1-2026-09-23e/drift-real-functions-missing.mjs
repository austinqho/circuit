import fs from 'node:fs'; import path from 'node:path'; import ts from 'typescript';
const [driftPath, manifestPath, repo, outPath] = process.argv.slice(2);
const drift = JSON.parse(fs.readFileSync(driftPath, 'utf8'));
const ids = new Set(JSON.parse(fs.readFileSync(manifestPath, 'utf8')).functions.map(f => f.id));
const cache = new Map();
const fns = file => {
  if (cache.has(file)) return cache.get(file);
  const text = fs.readFileSync(path.join(repo, file), 'utf8');
  const kind = /\.tsx$/.test(file) ? ts.ScriptKind.TSX : /\.ts$/.test(file) ? ts.ScriptKind.TS : /\.jsx$/.test(file) ? ts.ScriptKind.JSX : ts.ScriptKind.JS;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const out = [];
  const visit = n => { if (ts.isFunctionLike(n) && n.body) out.push([n.getStart(sf), n.end, text.slice(n.getStart(sf), Math.min(n.end, n.getStart(sf) + 80))]); ts.forEachChild(n, visit); };
  visit(sf); cache.set(file, out); return out;
};
const lost = [], kept = [];
for (const row of drift.categories.abstained_not_a_function) {
  const [s, e] = row.old_span; const hash = row.old.split(':')[1];
  // a real function node that starts within 3 chars before the old span and contains it
  const hits = fns(row.file).filter(([fs0, fe]) => fs0 <= s && fs0 >= s - 3 && fe >= e);
  for (const [fs0, fe, text] of hits) {
    const id = `function:${hash}:${fs0}:${fe}`;
    (ids.has(id) ? kept : lost).push({ old: row.old, file: row.file, function: id, text });
  }
}
fs.writeFileSync(outPath, JSON.stringify({ rule: 'abstained old id whose span lies inside a function node starting at most 3 chars before it', abstained: drift.categories.abstained_not_a_function.length, real_function_present_in_new_manifest: kept.length, real_function_missing_from_new_manifest: lost.length, lost, kept }, null, 1));
console.log({ abstained: drift.categories.abstained_not_a_function.length, kept: kept.length, lost: lost.length });
