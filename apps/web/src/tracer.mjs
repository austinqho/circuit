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
    // producttrace-mcp returns the full result as structuredContent (and a summary as text).
    if (result.structuredContent) return result.structuredContent;
    const texts = (result.content || [])
      .filter((part) => part.type === 'text')
      .map((part) => part.text);
    for (const text of texts.reverse()) {
      try {
        return JSON.parse(text);
      } catch {}
    }
    return { text: texts.join('\n') };
  }

  async close() {
    await this.client?.close().catch(() => {});
    this.client = null;
  }
}

/**
 * The story lines for one store, from the collector's /story endpoint. A build
 * whose package has no story answers `source: "unavailable"` with no lines.
 */
export async function readStory({ collectorUrl, session = null }) {
  try {
    const response = await fetch(
      `${collectorUrl}/story${session ? `?session=${encodeURIComponent(session)}` : ''}`,
    );
    const story = response.ok ? await response.json().catch(() => null) : null;
    // Older collectors answer any GET; only a real story counts.
    if (story?.schema === 'producttrace.story.v1') {
      return { source: 'story', sessions: story.sessions || [], lines: story.lines || [] };
    }
  } catch {}
  // No sentences from this package build. Raw engine rows are not a substitute:
  // the page says so in one line, and circuit_tracer still reaches the raw tools.
  return { source: 'unavailable', sessions: [], lines: [] };
}

const SILENT_ACTIONS = new Set(['goto', 'wait', 'back']);

/**
 * Lines the package wrote, lined up with the steps the bench performed, plus
 * a scorecard to hillclimb on. Pairing uses each step's time window; that is
 * the bench's own bookkeeping, not a claim the package makes.
 */
const requestKey = (r) => `${r.method} ${r.path}`;

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
  // Only lines written during this run's steps count; the store may hold other sessions.
  const paired = byStep.flat();
  const labeled = paired.filter((line) => line.element?.label).length;
  const handled = paired.filter((line) => line.handler?.name).length;
  const browserTotal = rows.reduce((n, row) => n + row.browser_requests.length, 0);
  const packageTotal = rows.reduce((n, row) => n + row.package_requests.length, 0);
  const entityLines = paired.filter((line) => (line.entities || []).length).length;
  // Recall matches requests by method and path over the whole run, not by step:
  // the browser and the package stamp a request at slightly different moments.
  const unmatched = paired.flatMap((line) => line.requests || []).map(requestKey);
  const missed = [];
  for (const r of browserRequests.filter((r) => r.at >= (windows[0]?.step.started_at ?? 0))) {
    const i = unmatched.indexOf(requestKey(r));
    if (i === -1) missed.push(`${r.method} ${r.path}`);
    else unmatched.splice(i, 1);
  }
  return {
    source: story?.source ?? null,
    scorecard: {
      steps_acted: acted.length,
      steps_with_a_line_pct: pct(
        acted.filter((row) => row.package_said.length).length,
        acted.length,
      ),
      lines: paired.length,
      lines_naming_the_element_pct: pct(labeled, paired.length),
      lines_naming_a_handler_pct: pct(handled, paired.length),
      lines_with_entity_ids_pct: pct(entityLines, paired.length),
      request_recall_pct: pct(browserTotal - missed.length, browserTotal),
      browser_requests: browserTotal,
      package_requests: packageTotal,
    },
    steps: rows,
    // What to fix next: requests the package never reported, lines without a handler.
    missed_requests: missed,
    lines_without_a_handler: paired.filter((line) => !line.handler?.name).map((line) => line.text),
    unpaired_lines: unpaired.map((line) => ({ at: line.at, text: line.text })),
  };
}
