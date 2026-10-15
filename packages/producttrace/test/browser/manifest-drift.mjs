// Classify every function-id difference between two runtime-attribution
// manifests of the same source revision, against the source files on disk.
//   node test/browser/manifest-drift.mjs <old manifest> <new manifest> <repository> [out.json]
// Categories for an old id missing from the new manifest:
//   boundary_corrected  the old span is not an exact function node on disk and
//                       the new manifest has the exact function that contains
//                       (or starts at) that position
//   abstained_not_a_function  the old span is not an exact function node on disk
//                       and no new function replaces it (bundler-synthesized)
//   first_party_filter  the old file is excluded as non-first-party
//   unexplained         everything else
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const [oldPath, newPath, repository, outPath] = process.argv.slice(2);
const load = file => JSON.parse(fs.readFileSync(file, 'utf8')).functions;
const oldRows = load(oldPath), newRows = load(newPath);
const excluded = /(?:^|\/)(?:node_modules|vendor|dist|build|\.git)(?:\/|$)/u;
const functionsOnDisk = new Map();
const functionsOf = file => {
  if (functionsOnDisk.has(file)) return functionsOnDisk.get(file);
  let rows = [];
  try {
    const content = fs.readFileSync(path.join(repository, file), 'utf8');
    const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, /\.tsx$/u.test(file) ? ts.ScriptKind.TSX : /\.[cm]?ts$/u.test(file) ? ts.ScriptKind.TS : ts.ScriptKind.JSX);
    const visit = node => {
      if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node)
        || ts.isGetAccessor(node) || ts.isSetAccessor(node) || ts.isConstructorDeclaration(node)) && node.body) {
        rows.push({ start: node.getStart(source), end: node.getEnd(), text: content.slice(node.getStart(source), Math.min(node.getEnd(), node.getStart(source) + 80)).replace(/\s+/gu, ' ') });
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  } catch { rows = null; }
  functionsOnDisk.set(file, rows);
  return rows;
};
const exact = row => (functionsOf(row.source.file) || []).some(fn => fn.start === row.source.start && fn.end === row.source.end);
const newIds = new Set(newRows.map(row => row.id)), oldIds = new Set(oldRows.map(row => row.id));
const newByFile = new Map();
for (const row of newRows) { const list = newByFile.get(row.source.file) || []; list.push(row); newByFile.set(row.source.file, list); }
const categories = { boundary_corrected: [], abstained_not_a_function: [], first_party_filter: [], unexplained: [] };
for (const row of oldRows) {
  if (newIds.has(row.id)) continue;
  const file = row.source.file;
  if (excluded.test(file)) { categories.first_party_filter.push({ old: row.id, file }); continue; }
  if (exact(row)) { categories.unexplained.push({ old: row.id, file, span: [row.source.start, row.source.end], reason: 'old span is an exact function on disk but is absent' }); continue; }
  const replacement = (newByFile.get(file) || []).filter(candidate => !oldIds.has(candidate.id) && exact(candidate)
    && candidate.source.start <= row.source.start && candidate.source.end >= row.source.start)
    .sort((a, b) => (a.source.end - a.source.start) - (b.source.end - b.source.start))[0];
  const text = (() => { try { return fs.readFileSync(path.join(repository, file), 'utf8').slice(row.source.start, Math.min(row.source.end, row.source.start + 80)).replace(/\s+/gu, ' '); } catch { return null; } })();
  if (replacement) categories.boundary_corrected.push({ old: row.id, new: replacement.id, file, old_span: [row.source.start, row.source.end], old_text: text,
    new_span: [replacement.source.start, replacement.source.end], new_text: (functionsOf(file) || []).find(fn => fn.start === replacement.source.start && fn.end === replacement.source.end)?.text || null });
  else categories.abstained_not_a_function.push({ old: row.id, file, old_span: [row.source.start, row.source.end], old_text: text });
}
const newOnly = newRows.filter(row => !oldIds.has(row.id));
const newOnlyExact = newOnly.filter(exact).length;
const replaced = new Set(categories.boundary_corrected.map(entry => entry.new));
const summary = {
  schema: 'producttrace.manifest-drift.v1', old: oldPath, new: newPath, repository,
  old_functions: oldRows.length, new_functions: newRows.length, shared: oldRows.filter(row => newIds.has(row.id)).length,
  old_only: Object.fromEntries(Object.entries(categories).map(([key, value]) => [key, value.length])),
  new_only: newOnly.length, new_only_exact_function_on_disk: newOnlyExact, new_only_not_exact: newOnly.length - newOnlyExact,
  new_only_explained_as_replacement: newOnly.filter(row => replaced.has(row.id)).length,
  new_exact_share: newRows.filter(exact).length / newRows.length,
  old_exact_share: oldRows.filter(exact).length / oldRows.length,
  examples: { boundary_corrected: categories.boundary_corrected.slice(0, 5), abstained_not_a_function: categories.abstained_not_a_function.slice(0, 5), unexplained: categories.unexplained.slice(0, 10) },
};
if (outPath) fs.writeFileSync(outPath, JSON.stringify({ ...summary, categories, new_only: newOnly.map(row => ({ id: row.id, file: row.source.file, exact: exact(row) })) }, null, 2));
console.log(JSON.stringify(summary, null, 2));
