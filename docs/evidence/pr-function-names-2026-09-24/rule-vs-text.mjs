// For every manifest function whose checkout file hash equals the id's hash:
// the build-time rule's name vs the store writer's text rule (and the via-call rule).
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
const [code, manifestPath, root, out] = process.argv.slice(2);
const { functionNamesAt } = await import(path.join(code, 'integrations/function-names.mjs'));
const { functionNameAt } = await import(path.join(code, 'collector/store-writer.mjs'));
const { wrappedAssignmentAt } = await import(path.join(code, 'collector/store.mjs'));
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const files = new Map();
const read = file => { if (!files.has(file)) { let c = null; try { c = fs.readFileSync(path.join(root, file), 'utf8'); } catch {} files.set(file, c && { c, h: createHash('sha256').update(c).digest('hex') }); } return files.get(file); };
const stats = { rows: manifest.functions.length, matched: 0, kinds: {}, same: 0, text_only: 0, build_only: 0, differ: 0, via_same: 0 };
const rows = { differ: [], text_only: [], build_only: [] };
for (const row of manifest.functions) {
  const m = /^function:([0-9a-f]{64}):(\d+):(\d+)$/u.exec(row.id); const f = read(row.source.file);
  if (!m || !f || f.h !== m[1]) continue;
  stats.matched++;
  const s = +m[2], e = +m[3];
  const built = functionNamesAt(row.source.file, f.c, s, e);
  stats.kinds[built.name_kind] = (stats.kinds[built.name_kind] || 0) + 1;
  let text = functionNameAt(f.c, s, e); let via = null;
  if (!text) { const w = wrappedAssignmentAt(f.c, s); if (w) { text = w.name; via = w.via; } }
  const b = built.name;
  const line = f.c.slice(0, s).split('\n').length;
  const entry = { at: `${row.source.file}:${line}`, text: via ? `${text} (via ${via})` : text, build: built.display_name, kind: built.name_kind, head: f.c.slice(s, s + 50).replace(/\s+/gu, ' ') };
  if (b === text || (via && built.name_kind === 'inferred' && b === text)) { stats.same++; if (via) stats.via_same++; }
  else if (text && !b) { stats.text_only++; rows.text_only.push(entry); }
  else if (!text && b) { stats.build_only++; rows.build_only.push(entry); }
  else { stats.differ++; rows.differ.push(entry); }
}
fs.writeFileSync(out, JSON.stringify({ stats, ...rows }, null, 1));
console.log(JSON.stringify(stats));
