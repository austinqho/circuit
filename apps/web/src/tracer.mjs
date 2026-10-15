// What the package produced, read only through its public surfaces: the
// collector's /story endpoint (natural-language lines) and the producttrace-mcp
// tools (raw evidence). Nothing here interprets the store's files directly.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { segmentsOf } from './segments.mjs';

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

/**
 * How Claude judges the narration (segment titles). Each title is scored 0-2 on
 * each criterion, with the segment's grounded lines as the only evidence.
 */
export const NARRATION_RUBRIC = {
  instructions:
    'Read each segment title as if a person were annotating what the user did, then score it against its evidence lines only. 0 = no, 1 = partly, 2 = yes. Call circuit_score_narration with one score object per segment, in order.',
  criteria: {
    high_level:
      'Says what the person did in their terms, not the UI mechanics: "Signed up as Ada Lovelace" or "Started a discussion about the engine", not "Submitted the form".',
    grounded:
      'Every claim is supported by the evidence lines (requests, IDs, labels, pages). Anything invented scores 0.',
    specific:
      'Names the concrete object the evidence carries: which discussion, which page, which account.',
    joined:
      'Related actions are one intent (typing into fields and submitting them is one step), and nothing unrelated is merged in.',
  },
};

export function narrationOf(story, lines) {
  return {
    rubric: NARRATION_RUBRIC,
    segments: segmentsOf(story, lines).map((segment, index) => ({
      index,
      title: segment.title,
      source: segment.source,
      page: segment.page,
      evidence: segment.lines.map((line) => line.text),
    })),
  };
}

/** Folds Claude's per-segment scores into one "reads like a person" percentage. */
export function narrationScore(segments, scores) {
  const keys = Object.keys(NARRATION_RUBRIC.criteria);
  if (!Array.isArray(scores) || scores.length !== segments.length)
    throw Object.assign(new Error(`send one score per segment (${segments.length}), in order`), {
      status: 400,
    });
  let total = 0;
  for (const score of scores)
    for (const key of keys) {
      const value = score?.[key];
      if (![0, 1, 2].includes(value))
        throw Object.assign(new Error(`each score needs ${keys.join(', ')} as 0, 1 or 2`), {
          status: 400,
        });
      total += value;
    }
  return Math.round((100 * total) / (2 * keys.length * scores.length));
}

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
    narration: narrationOf(story, paired),
    // What to fix next: requests the package never reported, lines without a handler.
    missed_requests: missed,
    lines_without_a_handler: paired.filter((line) => !line.handler?.name).map((line) => line.text),
    unpaired_lines: unpaired.map((line) => ({ at: line.at, text: line.text })),
  };
}
