// What the package produced, read only through its public surfaces: the
// collector's /story endpoint (natural-language lines) and the producttrace-mcp
// tools (raw evidence). Nothing here interprets the store's files directly.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

/** One MCP client per store, started on first use. */
export class TracerTools {
  constructor({ mcpBin, storeDir, sourceRoot }) {
    this.args = [mcpBin, '--store', storeDir, ...(sourceRoot ? ['--source-root', sourceRoot] : [])];
    this.client = null;
  }

  async connect() {
    if (this.client) return this.client;
    const client = new Client({ name: 'circuit-web', version: '0.1.0' });
    await client.connect(
      new StdioClientTransport({ command: process.execPath, args: this.args, stderr: 'ignore' }),
    );
    this.client = client;
    return client;
  }

  async list() {
    const { tools } = await (await this.connect()).listTools();
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));
  }

  async call(name, args = {}) {
    const result = await (await this.connect()).callTool({ name, arguments: args });
    const text = result.content?.find((part) => part.type === 'text')?.text ?? '';
    try {
      return JSON.parse(text);
    } catch {
      return { text };
    }
  }

  async close() {
    await this.client?.close().catch(() => {});
    this.client = null;
  }
}

/**
 * The story lines for one store. Prefers the collector's /story endpoint; when
 * the package in use has none yet, falls back to recent_actions, marked
 * `source: "recent_actions"` so nobody mistakes it for the package's sentences.
 */
export async function readStory({ collectorUrl, tools, session = null }) {
  try {
    const response = await fetch(
      `${collectorUrl}/story${session ? `?session=${encodeURIComponent(session)}` : ''}`,
    );
    if (response.ok) {
      const story = await response.json();
      return { source: 'story', sessions: story.sessions || [], lines: story.lines || [] };
    }
  } catch {}
  const recent = await tools
    .call('recent_actions', { n: 100, ...(session ? { session } : {}) })
    .catch((error) => ({ status: 'error', error: error.message }));
  if (recent.status !== 'ok')
    return {
      source: 'recent_actions',
      sessions: [],
      lines: [],
      note: recent.summary || recent.error || recent.status,
    };
  const lines = (recent.actions || [])
    .slice()
    .reverse()
    .map((action) => ({
      id: action.action_id,
      kind: action.event,
      session: action.session,
      at: action.timestamp,
      text: `${action.event} on <${action.target?.tag || '?'}>: ${action.outcome?.sentence || action.summary || ''}`,
      event: action.event,
      element: { tag: action.target?.tag ?? null, label: null, key: action.element_key ?? null },
      handler: null,
      requests: [],
      entities: [],
      outcome: action.outcome?.status ?? null,
      action_id: action.action_id,
    }));
  const sessions = [...new Set(lines.map((line) => line.session))].map((id) => ({
    session: id,
    actions: lines.filter((l) => l.session === id).length,
  }));
  return { source: 'recent_actions', sessions, lines };
}

const SILENT_ACTIONS = new Set(['goto', 'wait', 'back']);

/**
 * Lines the package wrote, lined up with the steps the bench performed, plus
 * a scorecard to hillclimb on. Pairing uses each step's time window; that is
 * the bench's own bookkeeping, not a claim the package makes.
 */
export function buildReport({ steps = [], browserRequests = [], story }) {
  const lines = (story?.lines || []).slice().sort((a, b) => a.at - b.at);
  const windows = steps.map((step, i) => ({
    step,
    from: step.started_at - 150,
    to: steps[i + 1]?.started_at ?? Infinity,
  }));
  const byStep = windows.map(() => []);
  const unpaired = [];
  for (const line of lines) {
    const index = windows.findIndex((w) => line.at >= w.from && line.at < w.to);
    if (index === -1) unpaired.push(line);
    else byStep[index].push(line);
  }
  const rows = windows.map((w, i) => {
    const seen = browserRequests.filter((r) => r.at >= w.step.started_at && r.at < w.to);
    const recorded = byStep[i].flatMap((line) => line.requests || []);
    return {
      step: w.step.index,
      did: w.step.description,
      ok: w.step.ok,
      ...(w.step.error ? { error: w.step.error } : {}),
      url: w.step.url_after,
      package_said: byStep[i].map((line) => line.text),
      browser_requests: seen.map((r) => `${r.method} ${r.path} ${r.status ?? ''}`.trim()),
      package_requests: recorded.map((r) =>
        `${r.method} ${r.path} ${r.status ?? (r.aborted ? 'aborted' : '')}`.trim(),
      ),
    };
  });

  const acted = rows.filter((row, i) => row.ok && !SILENT_ACTIONS.has(windows[i].step.action));
  const pct = (n, d) => (d ? Math.round((100 * n) / d) : null);
  const labeled = lines.filter((line) => line.element?.label).length;
  const handled = lines.filter((line) => line.handler?.name).length;
  const browserTotal = rows.reduce((n, row) => n + row.browser_requests.length, 0);
  const packageTotal = rows.reduce((n, row) => n + row.package_requests.length, 0);
  const entityLines = lines.filter((line) => (line.entities || []).length).length;
  return {
    source: story?.source ?? null,
    scorecard: {
      steps_acted: acted.length,
      steps_with_a_line_pct: pct(
        acted.filter((row) => row.package_said.length).length,
        acted.length,
      ),
      lines: lines.length,
      lines_naming_the_element_pct: pct(labeled, lines.length),
      lines_naming_a_handler_pct: pct(handled, lines.length),
      lines_with_entity_ids_pct: pct(entityLines, lines.length),
      request_recall_pct: pct(Math.min(packageTotal, browserTotal), browserTotal),
      browser_requests: browserTotal,
      package_requests: packageTotal,
    },
    steps: rows,
    unpaired_lines: unpaired.map((line) => ({ at: line.at, text: line.text })),
  };
}
