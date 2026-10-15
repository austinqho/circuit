import fs from 'node:fs';
import path from 'node:path';

const config = JSON.parse(fs.readFileSync(path.resolve(process.argv[2] || '/tmp/producttrace-librechat-m1-cycle5.json'), 'utf8'));
const output = path.resolve(process.argv[3] || 'docs/evidence/m1-2026-09-22-c5/PATTERNS.md');
const controls = config.react_map?.controls || [];
const nodes = new Map((config.react_map?.nodes || []).map(node => [node.id, node]));
const rules = [
  ['send', /send|submit|prompt|message/i], ['copy', /copy|clipboard/i], ['edit-resubmit', /edit|resubmit/i],
  ['regenerate', /regenerat|retry/i], ['feedback', /feedback|thumb|rating/i], ['rename', /rename|title/i],
  ['delete', /delete|remove/i], ['archive', /archive/i], ['pin', /pin/i], ['share', /share/i],
  ['duplicate', /duplicat/i], ['fork', /fork/i], ['bookmark-tag', /bookmark|tag/i], ['project', /project|move/i],
  ['agent', /agent|assistant/i], ['memory', /memor/i], ['prompt', /prompt|preset/i], ['settings-toggle', /setting|toggle|enable|disable/i],
  ['model-endpoint-switch', /model|endpoint|provider/i], ['file-attach', /file|attach|upload/i], ['search', /search|filter/i],
  ['export', /export|download/i], ['navigation', /navigate|route|sidebar|conversation/i], ['keyboard-shortcut', /key(down|up)|shortcut/i],
];
const buckets = new Map();
for (const control of controls) {
  const handlers = (control.handler_ids || []).map(id => nodes.get(id)?.text || '').join(' ');
  const evidence = `${control.event} ${control.tag} ${handlers} ${(control.conditions || []).map(c => c.text).join(' ')}`;
  const match = rules.find(([, pattern]) => pattern.test(evidence));
  const key = match?.[0] || `inventory-${control.event}-${control.tag}`;
  if (!buckets.has(key)) buckets.set(key, []);
  buckets.get(key).push({ id: control.id, event: control.event, tag: control.tag, handlers: control.handler_ids || [], source_node_id: control.source_node_id });
}
const lines = ['# LibreChat interaction-pattern inventory', '', `Source: Tracer react_map.controls (${controls.length} controls) from ${path.basename(process.argv[2] || 'producttrace config')}.`, 'Clustering is generated from each control’s event/tag, handler source text, and conditions; no controls were hand-selected.', ''];
for (const [pattern, members] of [...buckets].sort(([a], [b]) => a.localeCompare(b))) {
  lines.push(`## ${pattern} (${members.length})`, '', 'Headless drive plan: locate one visible control in this cluster, dispatch a trusted event, wait for its network/DOM effect, then capture the causal chain and stop reason. Vary conditions and continuation shape before treating the pattern as covered.', '');
  for (const member of members) lines.push(`- \`${member.id}\` — ${member.event} on <${member.tag}>; handlers ${member.handlers.join(', ') || 'none'}; source ${member.source_node_id}`);
  lines.push('');
}
fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, `${lines.join('\n')}\n`);
console.log(JSON.stringify({ controls: controls.length, patterns: buckets.size, output }));
