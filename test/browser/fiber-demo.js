const frame = document.getElementById('productFrame');
const loading = document.getElementById('productLoading');
const stream = document.getElementById('eventStream');
const template = document.getElementById('eventTemplate');
const countNode = document.getElementById('eventCount');
const statusNode = document.getElementById('runtimeStatus');
const demoCanvas = document.getElementById('demoCanvas');
const libreChatSlide = document.getElementById('libreChatSlide');
const palmierSlide = document.getElementById('palmierSlide');
const repoCarousel = document.getElementById('repoCarousel');
const repoPillTrack = document.getElementById('repoPillTrack');
const slideButtons = [...document.querySelectorAll('[data-slide]')];
const legendButton = document.getElementById('legendButton');
const activityLegend = document.getElementById('activityLegend');
const workflows = new Map();
let currentSlide = 0;
let swipeStart = null;

const clean = (value) => String(value ?? '').trim().replace(/\s+/g, ' ');
const stringify = (value) => typeof value === 'string' ? value : JSON.stringify(value, null, 2);

function setStatus(label, state) {
  statusNode.textContent = label;
  statusNode.dataset.state = state;
}

function selectSlide(index) {
  currentSlide = index;
  libreChatSlide.hidden = index !== 0;
  palmierSlide.hidden = index !== 1;
  repoPillTrack.style.transform = `translateX(-${index * 50}%)`;
  for (const button of slideButtons) {
    const selected = Number(button.dataset.slide) === index;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-selected', String(selected));
  }
}

function appendField(list, label, value) {
  const term = document.createElement('dt');
  const definition = document.createElement('dd');
  term.textContent = label;
  definition.textContent = stringify(value ?? 'Unavailable');
  list.append(term, definition);
}

function formatEffects(effects = []) {
  if (!effects.length) return 'No runtime effect observed';
  return effects.map((effect) => {
    const surface = effect.surfaces?.[0]?.anchor?.value;
    return `${clean(effect.type).replaceAll('_', ' ')}${surface ? `: ${surface}` : ''}`;
  }).join('\n');
}

function formatEvidenceFacts(facts = []) {
  if (!facts.length) return null;
  return facts.map((fact, index) => {
    const source = fact.source?.file
      ? `\nSource: ${fact.source.file}${fact.source.text ? ` · ${fact.source.text}` : ''}`
      : '';
    const ids = fact.evidence_ids?.length ? `\nEvidence IDs: ${fact.evidence_ids.join(', ')}` : '';
    return `${index + 1}. ${clean(fact.label)}\n${clean(fact.value)}\nWhy: ${clean(fact.reason)}${source}${ids}`;
  }).join('\n\n');
}

// ProductTrace causal-chain adapter. It deliberately keeps the raw chain
// kinds and admission reasons visible in the existing evidence disclosure.
function adaptCausalChain(record) {
  if (record?.schema !== 'producttrace.causal-chain.v1') return record;
  // Internal bridge/capture traffic is retained in raw evidence but is not a
  // product bus stop.  Hide it before deriving the viewer path so the exhibit
  // only shows user-caused requests and their exact backend joins.
  const chain = (Array.isArray(record.chain) ? record.chain : [])
    .filter(row => row?.internal !== true && row?.transport_internal !== true);
  const control = record.control || record.action_control || {};
  const spine = record.spine?.function_ids || [];
  const entry = record.entry_handler || null;
  const requests = chain.filter(row => row.kind === 'network.request');
  const routes = chain.filter(row => row.kind === 'route.dispatch');
  const handlers = chain.filter(row => row.kind === 'handler.enter');
  const db = chain.filter(row => row.kind === 'db.operation');
  const rejected = chain.filter(row => row.kind === 'submit.rejected');
  const stop = record.terminal?.stop_reason || record.abstained?.[0] || null;
  const evidenceLabel = record.display?.label || record.terminal?.label || 'Waiting for effect';
  const facts = [
    { label: 'Clicked control', value: control.label || control.text || control.aria || control.testid || record.event || 'dom.action', reason: 'The action row supplied the observed control.' },
    { label: 'Causal spine', value: spine.length ? spine.join(' → ') : 'No first-party function entered', reason: 'The request spine is carried by continuation lineage.' },
    ...(entry ? [{ label: entry.rooted ? 'Effect-rooted entry handler' : 'Unrooted entry handler', value: entry.function_id, reason: entry.rooted ? 'Its continuation subtree contains the terminal evidence.' : 'No terminal effect was observed; this is the earliest event-invoked frame.', source: entry.source, evidence_ids: [] }] : []),
    ...requests.map(row => ({ label: 'Request', value: `${row.method || 'GET'} ${row.url || row.id}`, reason: 'Transport wrapper admitted the outbound request.', evidence_ids: row.evidence_ids })),
    ...routes.map(row => ({ label: 'Route', value: row.id, reason: row.admission_reason || 'Exact trace-parent server span admitted route.dispatch.', evidence_ids: row.evidence_ids })),
    ...handlers.map(row => ({ label: 'Handler', value: row.id, reason: row.admission_reason || 'Exact descendant handler span admitted handler.enter.', evidence_ids: row.evidence_ids })),
    ...db.map(row => ({ label: row.hop ? `MongoDB operation (hop ${row.hop})` : 'MongoDB operation', value: `${row.operation || 'operation'} ${row.collection || 'unknown collection'}${row.issued_by ? ` (${row.issued_by})` : ''} · ${row.id}`, reason: row.admission_reason || 'Exact descendant database span admitted db.operation.', evidence_ids: row.evidence_ids })),
    // Server-to-server hops, worded by the one hop builder (record.hops).
    ...(Array.isArray(record.hops) ? record.hops : []).map(hop => ({ label: !hop.because ? `Outbound hop ${hop.hop}` : `Outbound hop ${hop.hop} (frontier)`, value: hop.summary,
      reason: hop.because || 'The receiving server span has the outbound span as parent (the traceparent it sent).', evidence_ids: [hop.span_id, ...(hop.server ? [hop.server.span_id] : [])] })),
    ...rejected.map(row => ({ label: 'Rejected submit', value: 'Submit rejected by the app', reason: row.admission_reason, evidence_ids: row.evidence_ids })),
  ];
  if (stop) facts.push({ label: 'Stop', value: stop, reason: 'The raw chain ended without a terminal effect.' });
  // Outcome labels (fix/outcome-labels): the chain's own outcome, computed by
  // the one label function; never re-derived here.
  if (record.outcome?.sentence) facts.push({ label: 'Outcome', value: record.outcome.label || record.outcome.status, reason: record.outcome.sentence });
  const steps = [
    { index: 1, caption: `Clicked ${control.label || control.text || control.aria || control.testid || 'control'}.`, type: 'dom.action' },
    { index: 2, caption: `Spine: ${spine.length ? spine.join(' → ') : 'none'}.`, type: 'causal.spine' },
    ...(entry ? [{ index: 3, caption: `${entry.rooted ? 'Effect-rooted' : 'Unrooted'} entry handler: ${entry.source?.file || entry.function_id}${entry.source?.start != null ? `:${entry.source.start}:${entry.source.end}` : ''}`, type: 'entry.handler' }] : []),
    ...requests.map((row, index) => ({ index: index + 3 + Number(Boolean(entry)), caption: `${row.method || 'GET'} ${row.url || row.id}`, type: 'network.request' })),
    ...routes.map((row, index) => ({ index: index + 3 + Number(Boolean(entry)) + requests.length, caption: row.id, type: 'route.dispatch' })),
    ...handlers.map((row, index) => ({ index: index + 3 + Number(Boolean(entry)) + requests.length + routes.length, caption: row.id, type: 'handler.enter' })),
    ...db.map((row, index) => ({ index: index + 3 + Number(Boolean(entry)) + requests.length + routes.length + handlers.length, caption: `${row.operation || 'operation'} ${row.collection || 'unknown collection'}${row.issued_by ? ` (${row.issued_by})` : ''} · ${row.id}`, type: 'db.operation' })),
    ...rejected.map((row, index) => ({ index: index + 3 + Number(Boolean(entry)) + requests.length + routes.length + handlers.length + db.length, caption: 'Submit rejected by the app', type: 'submit.rejected' })),
  ];
  if (stop) steps.push({ index: steps.length + 1, caption: `STOP: ${stop}`, type: 'stop' });
  const pending = record.terminal?.pending === true;
  const workflowId = `causal:${record.episode_id || record.action_id}`;
  // The status word and "proven" come from the chain's outcome only: a 409
  // whose handler read the database is failed, never a completed effect.
  const status = record.outcome?.status || record.display?.status || (pending ? 'pending' : 'stopped');
  const proven = status === 'completed';
  return { ...record, kind: 'workflow_event', schema: 'producttrace.workflow-event.causal-chain-adapter.v1', event_type: pending ? 'product.workflow_checkpoint' : (proven ? 'product.workflow_completed' : 'product.workflow_stopped'), event_id: `${workflowId}:event_1`, workflow_id: workflowId,
    session_id: record.session_id || null, properties: { workflow_label: evidenceLabel, workflow_status: status, caption: evidenceLabel, checkpoint: { index: 1, caption: evidenceLabel, type: record.display?.stage || 'dom.action', control, evidence: { count: facts.length, facts }, outcome: { observed_effects: proven ? [{ type: record.display?.stage || 'causal_chain_observed' }] : [] }, uncertainty: [] }, ...(pending ? {} : { summary: { reason: 'producttrace_causal_chain_adapter', steps, terminal_result_proven: proven, business_result: evidenceLabel } }), entities: {}, learning: { standalone_training_signal: false } } };
}

function adaptLegacyOperation(record) {
  if (record.kind !== 'operation' || record.schema !== 'producttrace.operation.v1') return record;
  const properties = record.properties || {};
  const control = properties.control || {};
  if (control.tag === 'div' && control.id === 'root' && !(properties.outcome?.observed_effects || []).length) return null;
  const label = clean(control.aria || control.text || control.title || control.testid || control.id
    || properties.trigger?.label || properties.operation_type || 'product action');
  const completed = record.event_type === 'product.form_submitted';
  const status = completed ? 'completed' : 'action';
  const checkpoint = {
    index: 1,
    caption: properties.caption || 'Observed a product action.',
    type: properties.operation_type || 'interaction',
    surface: properties.surface || {},
    trigger: properties.trigger || null,
    control,
    fields: properties.fields || [],
    entities: properties.entities || {},
    source_action: properties.source_action || null,
    outcome: properties.outcome || {},
    evidence: properties.evidence || { ids: [], count: 0, omitted: 0 },
    uncertainty: properties.uncertainty || [],
  };
  const workflowId = record.trace_id || record.event_id;
  return {
    ...record,
    kind: 'workflow_event',
    schema: 'producttrace.workflow-event.compat.v1',
    event_type: completed ? 'product.workflow_completed' : 'product.action_observed',
    event_id: `${record.event_id}:compat`,
    workflow_id: workflowId,
    properties: {
      caption: checkpoint.caption,
      workflow_label: label,
      workflow_status: status,
      checkpoint,
      summary: {
        reason: 'legacy_operation_adapter',
        steps: [{ index: 1, caption: checkpoint.caption, type: checkpoint.type }],
        terminal_result_proven: properties.outcome?.terminal_result_proven === true,
      },
      entities: properties.entities || {},
      learning: properties.learning || { standalone_training_signal: false },
    },
  };
}

function eventIndex(record) {
  return Number(record.event_id?.match(/:event_(\d+)$/)?.[1] || record.seq || 0);
}

function workflowState(records) {
  const ordered = [...records].sort((left, right) => eventIndex(left) - eventIndex(right));
  const latest = ordered.at(-1);
  const terminal = [...ordered].reverse().find((record) => record.properties?.summary);
  const checkpoints = ordered.map((record) => record.properties?.checkpoint).filter(Boolean);
  const summarySteps = terminal?.properties?.summary?.steps || [];
  const steps = summarySteps.length ? summarySteps : checkpoints.map(({ index, caption, type }) => ({ index, caption, type }));
  const status = terminal?.properties?.workflow_status || latest?.properties?.workflow_status || 'pending';
  const label = latest?.properties?.workflow_label || 'product activity';
  const caption = latest?.properties?.caption || terminal?.properties?.caption || `Working on “${label}”.`;
  const sourceVerified = checkpoints.some((checkpoint) => checkpoint.source_action);
  const effects = checkpoints.flatMap((checkpoint) => checkpoint.outcome?.observed_effects || []);
  const evidenceCount = checkpoints.reduce((total, checkpoint) => total + (checkpoint.evidence?.count || 0), 0);
  const evidenceFacts = checkpoints.flatMap((checkpoint) => checkpoint.evidence?.facts || []);
  const uncertainties = [...new Set(checkpoints.flatMap((checkpoint) => checkpoint.uncertainty || []))];
  return { ordered, latest, terminal, checkpoints, steps, status, label, caption,
    sourceVerified, effects, evidenceCount, evidenceFacts, uncertainties };
}

function withArticle(noun) {
  const value = clean(noun).toLowerCase();
  if (!value) return 'the workflow';
  if (/^(a|an|the)\s/.test(value)) return value;
  return `${/^[aeiou]/.test(value) ? 'an' : 'a'} ${value}`;
}

function activeWorkflowTitle(label) {
  const value = clean(label);
  let match = value.match(/^start creating\s+(.+)$/i);
  if (match) return `Creating ${withArticle(match[1])}`;
  match = value.match(/^create new\s+(.+)$/i);
  if (match) return `Creating a new ${clean(match[1]).toLowerCase()}`;
  match = value.match(/^create\s+(.+)$/i);
  if (match) return `Creating ${withArticle(match[1])}`;
  match = value.match(/^(.+) configuration form$/i);
  if (match) return `Configuring ${withArticle(match[1])}`;
  return `Working on ${value}`;
}

function workflowIntentLabel(state) {
  for (const step of state.steps) {
    const control = clean(step.caption).match(/^(?:Clicked|Used) “(.+)”\.$/)?.[1];
    if (/^(?:start creating|create new|create)\s+/i.test(control || '')) return control;
  }
  return state.label;
}

function renderJourneySteps(container, state) {
  container.replaceChildren();
  state.steps.forEach((step, index) => {
    const item = document.createElement('li');
    const isLast = index === state.steps.length - 1;
    item.className = `journey-step ${state.status === 'pending' && isLast
      ? 'current'
      : (state.status !== 'completed' && state.status !== 'action' && isLast ? 'interrupted' : 'done')}`;
    const text = document.createElement('strong');
    const meta = document.createElement('small');
    text.textContent = step.caption;
    meta.textContent = clean(step.type || 'checkpoint').replaceAll('_', ' ');
    item.append(text, meta);
    container.append(item);
  });
}

function upsertWorkflow(record) {
  if (record?.kind === 'workflow.retract' && record.workflow_id) {
    const view = workflows.get(record.workflow_id);
    view?.group?.remove();
    workflows.delete(record.workflow_id);
    countNode.textContent = `${workflows.size} ${workflows.size === 1 ? 'workflow' : 'workflows'}`;
    if (!workflows.size) stream.innerHTML = '<div class="empty-state"><img src="/test/browser/palmier-icons/cursorarrow.png" alt="" aria-hidden="true"><strong>Use LibreChat</strong><p>Your actions and their evidence will appear here.</p></div>';
    return;
  }
  record = adaptCausalChain(record);
  record = adaptLegacyOperation(record);
  if (!record || record.kind !== 'workflow_event' || !record.workflow_id) return;
  window.dispatchEvent(new CustomEvent('producttrace:workflow-update', { detail: {
    workflow_id: record.workflow_id,
    label: record.properties?.workflow_label || record.properties?.caption || '',
  } }));
  stream.querySelector('.empty-state')?.remove();
  let view = workflows.get(record.workflow_id);
  if (!view) {
    const group = template.content.firstElementChild.cloneNode(true);
    view = { group, records: new Map(), lastStatus: null };
    workflows.set(record.workflow_id, view);
    stream.append(group);
  }
  view.records.set(record.event_id, record);
  const state = workflowState(view.records.values());
  const group = view.group;
  const card = group.querySelector('.event-card');
  group.className = `activity-group ${state.status}`;
  group.dataset.workflowId = record.workflow_id;
  group.querySelector('.event-verdict').textContent = `${state.status}. `;
  card.title = `${state.label} · ${state.status}`;
  group.querySelector('.caption').textContent = state.caption;
  const statusLabel = state.status === 'pending' ? 'In progress' : (state.status[0].toUpperCase() + state.status.slice(1)).replaceAll('_', ' ');
  group.querySelector('.event-subtitle').textContent = `${statusLabel} · ${state.steps.length} ${state.steps.length === 1 ? 'step' : 'steps'}`;
  renderJourneySteps(group.querySelector('.journey-steps'), state);
  if (state.status === 'pending') card.open = true;
  else if (view.lastStatus === 'pending' || view.lastStatus == null) card.open = false;
  view.lastStatus = state.status;

  const fields = group.querySelector('.evidence-grid');
  fields.replaceChildren();
  appendField(fields, 'Status', statusLabel);
  appendField(fields, 'Business result', state.terminal?.properties?.summary?.business_result
    || (state.terminal?.properties?.summary?.terminal_result_proven
      ? 'Proven from source and runtime evidence'
      : (state.status === 'completed' ? 'Completion observed; product meaning still needs source proof' : 'No terminal result yet')));
  appendField(fields, 'Runtime effects', formatEffects(state.effects));
  appendField(fields, 'Proven entity IDs', Object.keys(state.latest?.properties?.entities || {}).length
    ? state.latest.properties.entities : 'No validated entity identity');
  appendField(fields, 'Correlation', `Workflow ${record.workflow_id}\nSession ${record.session_id}`);
  appendField(fields, 'Learning use', state.terminal?.properties?.learning?.use
    || (state.terminal?.properties?.learning?.standalone_training_signal
      ? 'Eligible training signal'
      : 'Context only — correlate with an agent outcome, edit, retry, or explicit feedback before training'));
  appendField(fields, 'Evidence', formatEvidenceFacts(state.evidenceFacts)
    || `${state.evidenceCount} retained facts across ${state.steps.length} checkpoints`);
  appendField(fields, 'Uncertainty', state.uncertainties.length ? state.uncertainties.join('\n') : 'None recorded');
  countNode.textContent = `${workflows.size} ${workflows.size === 1 ? 'workflow' : 'workflows'}`;
  [...workflows.values()]
    .sort((left, right) => {
      const leftTime = Math.max(...[...left.records.values()].map((item) => item.ts || Date.parse(item.timestamp) || 0));
      const rightTime = Math.max(...[...right.records.values()].map((item) => item.ts || Date.parse(item.timestamp) || 0));
      return rightTime - leftTime;
    })
    .forEach((item) => stream.append(item.group));
  requestAnimationFrame(() => group.classList.remove('fresh'));
}

async function connect() {
  try {
    frame.addEventListener('load', () => {
      loading.classList.add('hidden');
      loading.hidden = true;
    }, { once: true });
    const requestedPort = new URLSearchParams(window.location.search).get('productPort');
    const productPort = /^\d{2,5}$/.test(requestedPort || '') ? requestedPort : '3081';
    frame.src = `http://127.0.0.1:${productPort}/?producttraceRuntime=${Date.now()}`;
    const events = new EventSource('/api/demo/stream');
    events.onopen = () => setStatus('Observer connected', 'ready');
    events.onmessage = ({ data }) => upsertWorkflow(JSON.parse(data));
    events.onerror = () => setStatus('Caption stream reconnecting', 'error');
  } catch (error) {
    loading.textContent = 'LibreChat or the ProductTrace viewer is not running.';
    setStatus('Runtime unavailable', 'error');
    console.error(error);
  }
}

document.getElementById('reloadProduct')?.addEventListener('click', () => {
  loading.hidden = false;
  loading.classList.remove('hidden');
  frame.src = frame.src;
});

document.getElementById('clearEvents').addEventListener('click', () => {
  workflows.clear();
  countNode.textContent = '0 workflows';
  stream.innerHTML = '<div class="empty-state"><img src="/test/browser/palmier-icons/cursorarrow.png" alt="" aria-hidden="true"><strong>Use LibreChat</strong><p>Your actions and their evidence will appear here.</p></div>';
  fetch('/api/demo/events', { method: 'DELETE' }).catch(() => {});
});

function setLegendOpen(open) {
  legendButton.setAttribute('aria-expanded', String(open));
  legendButton.textContent = open ? '×' : 'Legend';
  legendButton.setAttribute('aria-label', open ? 'Close activity legend' : 'Open activity legend');
  activityLegend.hidden = !open;
}

legendButton.addEventListener('click', () => {
  setLegendOpen(legendButton.getAttribute('aria-expanded') !== 'true');
});

document.addEventListener('pointerdown', (event) => {
  if (activityLegend.hidden || activityLegend.contains(event.target) || legendButton.contains(event.target)) return;
  setLegendOpen(false);
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || activityLegend.hidden) return;
  setLegendOpen(false);
  legendButton.focus();
});

for (const button of slideButtons) {
  button.addEventListener('click', () => selectSlide(Number(button.dataset.slide)));
}

repoCarousel.addEventListener('wheel', (event) => {
  if (Math.abs(event.deltaX) < 8 || Math.abs(event.deltaX) < Math.abs(event.deltaY)) return;
  event.preventDefault();
  selectSlide(event.deltaX > 0 ? 1 : 0);
}, { passive: false });

demoCanvas.addEventListener('wheel', (event) => {
  if (Math.abs(event.deltaX) < 18 || Math.abs(event.deltaX) < Math.abs(event.deltaY)) return;
  event.preventDefault();
  selectSlide(event.deltaX > 0 ? 1 : 0);
}, { passive: false });

demoCanvas.addEventListener('pointerdown', (event) => {
  swipeStart = { x: event.clientX, y: event.clientY };
});

demoCanvas.addEventListener('pointerup', (event) => {
  if (!swipeStart) return;
  const deltaX = event.clientX - swipeStart.x;
  const deltaY = event.clientY - swipeStart.y;
  swipeStart = null;
  if (Math.abs(deltaX) > 55 && Math.abs(deltaX) > Math.abs(deltaY)) selectSlide(deltaX < 0 ? 1 : 0);
});

repoCarousel.addEventListener('pointerdown', (event) => {
  swipeStart = { x: event.clientX, y: event.clientY };
});

repoCarousel.addEventListener('pointerup', (event) => {
  if (!swipeStart) return;
  const deltaX = event.clientX - swipeStart.x;
  const deltaY = event.clientY - swipeStart.y;
  swipeStart = null;
  if (Math.abs(deltaX) > 35 && Math.abs(deltaX) > Math.abs(deltaY)) selectSlide(deltaX < 0 ? 1 : 0);
});

window.addEventListener('message', (event) => {
  if (![frame.contentWindow, palmierSlide.contentWindow].includes(event.source)) return;
  if (event.data?.source !== 'tracer-preview-carousel') return;
  selectSlide(event.data.direction === 'next' ? 1 : 0);
});

connect();
