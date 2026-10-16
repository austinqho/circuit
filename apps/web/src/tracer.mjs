// What the package produced, read only through its public surfaces: the
// collector's /story endpoint (natural-language lines) and the producttrace-mcp
// tools (raw evidence). Nothing here interprets the store's files directly.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { segmentsOf, ungroundedTokens } from './segments.mjs';

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
      return {
        source: 'story',
        sessions: story.sessions || [],
        lines: story.lines || [],
        // The package's goals over those lines, when it groups them.
        ...(Array.isArray(story.segments) ? { segments: story.segments } : {}),
        ...(Array.isArray(story.narrative) ? { narrative: story.narrative } : {}),
      };
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
 * How Claude judges the narration (segment titles), aligned with §7 of the
 * narration spec (circuit-narration/narration-spec.md): GUM's observation voice,
 * its target sentences as the bar, its verb table as the vocabulary. Each title is
 * scored 0-2 per criterion with the segment's cited lines as the only evidence.
 */
export const NARRATION_RUBRIC = {
  instructions:
    "Read each segment title as an annotation of what the person did, and score it against its evidence only. 0 = no, 1 = partly, 2 = yes. A title that cites an email, ID or quoted label its evidence lacks scores 0 on everything (the bench enforces this; see each segment's ungrounded list). Each segment's voice_flags lists what a quick check found off-voice; use them as hints, not as the score. Call circuit_score_narration with one score object per segment, in order.",
  voice:
    '<Verb>ed <object> [as/for <qualifier>] [on/in <place>] [to <purpose>][, then <next verb>]. Past tense, verb first, no subject, on-screen labels and typed values quoted, the place named, and a "to …" purpose only when the evidence shows the result. ", then" joins the steps of one goal.',
  bar: [
    'Registered as ada@example.test for the team "Analytical Engines" and landed on the dashboard.',
    'Opened Discussions and started a discussion titled "Notes on the engine".',
    'Clicked the "Register" button to create user U5kY… and team ruRH…, then landed on /app.',
  ],
  verbs: [
    'Registered',
    'Logged in / out',
    'Created / Started',
    'Edited / Renamed',
    'Deleted',
    'Opened',
    'Viewed',
    'Scrolled through',
    'Searched',
    'Filtered / Sorted',
    'Paged through',
    'Typed … into',
    'Clicked … to',
    'Posted',
    'Started … but left without',
  ],
  criteria: {
    voice:
      'Reads like an annotation: past tense, verb first, no subject ("Opened Discussions and started …"). "The user is …", "In X, the user …", present tense, or a vague verb ("edited text", "interacted with") scores 0.',
    high_level:
      'Names the goal the way the person would say it (registered, started a discussion), not the UI operation ("Submitted the form").',
    grounded:
      'Every claim is in the evidence: requests, IDs, values, labels, pages. A "to …" purpose only when a cited navigation, write or response shows that result; nothing guessed about why.',
    specific:
      'Carries the qualifiers the evidence has: the typed value or entity title in quotes, the place, and the outcome (what was created, where the person landed).',
    joined:
      'One goal per title: lines joined by a shared form, entity or navigation lead-in, steps chained with ", then", nothing unrelated merged in, and no navigation left alone when the next part names its destination.',
  },
};

// Opening words that are past tense without ending in -ed.
const IRREGULAR_PAST = new Set(
  'began chose did drew found gave got hid left lost made put ran read rewrote sent set saw shut sold spent swept took threw undid unhid went withdrew wrote'.split(
    ' ',
  ),
);
const VAGUE = /\b(edited text|interacted with|clicked on elements|did something|made changes)\b/iu;

/** What a quick read finds off-voice in a title (empty when it reads as an annotation). */
export function voiceFlags(title) {
  const text = String(title).trim();
  const flags = [];
  const first = (text.match(/^[A-Za-z-]+/u)?.[0] ?? '').toLowerCase();
  if (
    /^(the user|a user|in |on |they |he |she )/iu.test(text) ||
    /\b(is|are) \w+ing\b/iu.test(text)
  )
    flags.push('has a subject or present tense; write it verb first, past tense');
  else if (!(first.endsWith('ed') || IRREGULAR_PAST.has(first)))
    flags.push('does not open with a past-tense verb');
  if (VAGUE.test(text)) flags.push('uses a vague verb');
  return flags;
}

const lineEvidence = (line) => [
  line.text,
  ...(line.values || []).map((v) => `${v.field || v.key}: ${v.value ?? `${v.length} characters`}`),
  ...(line.entities || []).map((e) => `${e.type} ${e.id}`),
];

export function narrationOf(story, lines) {
  return {
    rubric: NARRATION_RUBRIC,
    segments: segmentsOf(story, lines).map((segment, index) => {
      const evidence = [
        ...segment.lines.flatMap(lineEvidence),
        ...[segment.values || []]
          .flatMap((v) =>
            Array.isArray(v) ? v : Object.entries(v).map(([key, value]) => ({ key, value })),
          )
          .map((v) => `${v.field || v.key}: ${v.value ?? `${v.length} characters`}`),
        ...(segment.entities || []).map((e) => `${e.type} ${e.id}`),
      ];
      return {
        index,
        title: segment.title,
        source: segment.source,
        page: segment.page,
        ...(segment.confidence != null ? { confidence: segment.confidence } : {}),
        evidence,
        ungrounded: ungroundedTokens(segment.title, evidence),
        voice_flags: voiceFlags(segment.title),
      };
    }),
  };
}

/**
 * Folds Claude's per-segment scores into one "reads like a person" percentage.
 * A segment whose title cites something its evidence lacks counts as zero.
 */
export function narrationScore(segments, scores) {
  const keys = Object.keys(NARRATION_RUBRIC.criteria);
  if (!Array.isArray(scores) || scores.length !== segments.length)
    throw Object.assign(new Error(`send one score per segment (${segments.length}), in order`), {
      status: 400,
    });
  let total = 0;
  scores.forEach((score, i) => {
    for (const key of keys)
      if (![0, 1, 2].includes(score?.[key]))
        throw Object.assign(new Error(`each score needs ${keys.join(', ')} as 0, 1 or 2`), {
          status: 400,
        });
    if (segments[i].ungrounded?.length) return;
    for (const key of keys) total += score[key];
  });
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
