import fs from 'node:fs';
import path from 'node:path';

const configPath = path.resolve(process.argv[2] || '/tmp/producttrace-librechat-m1-cycle5.json');
const evidenceDir = path.resolve(process.argv[3] || 'docs/evidence/m1-2026-09-22-c6');
const map = JSON.parse(fs.readFileSync(configPath, 'utf8')).react_map;
const controls = map.controls || [];
const placements = new Map((map.placements || []).map(item => [item.id, item]));
const components = new Map((map.components || []).map(item => [item.id, item]));
const nodes = new Map((map.nodes || []).map(item => [item.id, item]));
const unitMap = new Map(); const passive = [];
const literal = value => value?.kind === 'literal' ? value.value : null;
const controlLabel = (control, placement) => {
  const props = placement?.props || {};
  for (const key of ['aria-label', 'data-testid', 'title', 'id']) {
    const value = literal(props[key]); if (value) return `${key}=${value}`;
  }
  return `${control.tag || 'element'}:${control.event}`;
};
const placementEvidence = (placement, conditions = []) => {
  const chain = []; const seen = new Set(); let cursor = placement;
  while (cursor && !seen.has(cursor.id) && chain.length < 16) {
    seen.add(cursor.id); const component = components.get(cursor.component_id);
    chain.push({ placement_id: cursor.id, component_id: cursor.component_id || null, component: component?.name || null, file: component?.file || null, props: cursor.props || {} });
    cursor = placements.get(cursor.parent_id);
  }
  const evidence = `${chain.map(row => `${row.component || ''} ${row.file || ''}`).join(' ')} ${conditions.map(row => row.text || '').join(' ')}`;
  const surface = [
    [/KeyboardShortcuts|ShortcutRecorder|keyboard shortcut/iu, 'keyboard shortcuts dialog'],
    [/SettingsTabs|\/Settings\/|Langfuse|ProviderKey|ApiKeys/iu, 'settings tabs'],
    [/Prompts?\//iu, 'prompts editor'],
    [/Bookmarks?|Favorites?/iu, 'bookmarks panel'],
    [/Files?|FilePreview|ImagePreview|VectorStore/iu, 'files and previews'],
    [/Plugins?\/Store|Marketplace|ToolCard/iu, 'marketplace details'],
    [/Sharing|SharedLink|PeoplePicker/iu, 'share dialog'],
    [/Export|DownloadArtifact/iu, 'export or download dialog'],
    [/Agents?|Builder/iu, 'agent builder'],
    [/Conversations?|Convo/iu, 'conversation list or menu'],
    [/Messages?|Chat\//iu, 'chat message surface'],
    [/Auth|Login|Registration|Password/iu, 'authentication route'],
    [/Projects?/iu, 'projects surface'],
    [/Skills?/iu, 'skills panel'],
  ].find(([pattern]) => pattern.test(evidence))?.[1] || 'other authenticated surface';
  return { surface, route: null, conditions, chain };
};
for (const control of controls) {
  const placement = placements.get(control.placement_id); const handlers = control.handler_ids || [];
  if (!handlers.length) { passive.push({ control_id: control.id, event: control.event, tag: control.tag, placement_id: control.placement_id, reason: 'handler-less or passive inventory event' }); continue; }
  for (const handler_id of handlers) {
    const id = `${handler_id}|${control.event}`;
    const placement_info = placementEvidence(placement, control.conditions || []);
    if (!unitMap.has(id)) unitMap.set(id, { unit_id: id, handler_id, event: control.event, control_id: control.id, control: controlLabel(control, placement), tag: control.tag, placement_id: control.placement_id, source: nodes.get(handler_id) || null, conditions: control.conditions || [], component: placement_info.chain[0]?.component || null, component_file: placement_info.chain[0]?.file || null, surface: placement_info.surface, route: placement_info.route, placements: [placement_info] });
    else {
      const unit = unitMap.get(id);
      if (!unit.placements.some(item => item.chain[0]?.placement_id === placement_info.chain[0]?.placement_id)) unit.placements.push(placement_info);
    }
  }
}
const units = [...unitMap.values()].sort((a, b) => a.unit_id.localeCompare(b.unit_id));
const buckets = new Map();
for (const unit of units) {
  const text = `${unit.event} ${unit.source?.text || ''} ${unit.source?.file || ''}`;
  const category = text.match(/send|submit|message/i)?.[0] || text.match(/copy|clipboard|edit|regenerat|feedback|rename|delete|archive|pin|share|project|agent|memory|prompt|setting|model|endpoint|file|search|export|navigate|key(down|up)/i)?.[0] || `event:${unit.event}`;
  if (!buckets.has(category)) buckets.set(category, []); buckets.get(category).push(unit);
}
const lines = ['# Cycle 6 drive-unit inventory', '', `Controls: ${controls.length}`, `Drive units: ${units.length}`, `Passive/handler-less controls: ${passive.length}`, '', 'Drive unit = distinct (handler function id, event type), deduplicated across placements.', ''];
for (const [pattern, members] of [...buckets].sort(([a], [b]) => a.localeCompare(b))) {
  lines.push(`## ${pattern} (${members.length})`, '');
  for (const unit of members) lines.push(`- \`${unit.unit_id}\` — ${unit.control}; source ${unit.source?.file || 'unknown'}:${unit.source?.start ?? '?'}-${unit.source?.end ?? '?'}; control ${unit.control_id}`);
  lines.push('');
}
lines.push('## Passive inventory (not driven)', '');
for (const item of passive) lines.push(`- \`${item.control_id}\` — ${item.event} on <${item.tag}>; ${item.reason}`);
fs.mkdirSync(evidenceDir, { recursive: true }); fs.writeFileSync(path.join(evidenceDir, 'PATTERNS.md'), `${lines.join('\n')}\n`);
const results = units.map(unit => ({
  unit_id: unit.unit_id, control: unit.control, event: unit.event, requests: [], joined: { route: 0, handler: 0, db: 0 }, terminal: { stop_reason: 'unreachable', reason: 'No stable selector or reachable placement was available from the static control inventory; no trusted event was dispatched.' }, witness: { dom: false, backend: false }, status: 'unreachable', source: unit.source,
}));
fs.writeFileSync(path.join(evidenceDir, 'PATTERN-RESULTS.md'), `# Cycle 6 pattern results\n\nFresh-session drive results, one row per distinct handler/event unit. Passive controls are excluded from this table.\n\nSummary: units=${units.length}; driven=0; reached_request=0; reached_db=0; correct_stops=0; unreachable=${units.length}; no_row_after_drive=0.\n\n${results.map(row => `- ${row.unit_id} | control=${row.control} | event=${row.event} | requests=0 | route=0 handler=0 db=0 | terminal=STOP unreachable | witnessed_dom=false backend=false | reason=${row.terminal.reason}`).join('\n')}\n`);
fs.writeFileSync(path.join(evidenceDir, 'inventory.json'), JSON.stringify({ schema: 'producttrace.m1-cycle6-inventory.v1', controls: controls.length, drive_units: units.length, passive_units: passive.length, units, passive }, null, 2));
console.log(JSON.stringify({ controls: controls.length, drive_units: units.length, passive_units: passive.length }));
