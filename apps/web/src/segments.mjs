// Segments: the parts of a visit ("Created a discussion") that group story lines.
// The package's story feed may carry them; until it does, the bench groups lines
// here: a segment ends at a form submit or when the page changes, and runs of
// plain navigation clicks fold into one "went to" segment. The page and the
// report both use this module, so what Austin sees is what Claude scores.

const short = (id) => (String(id).length > 10 ? `${String(id).slice(0, 8)}…` : String(id));
const lead = (text) => String(text || '').split(' → ')[0];

const isNav = (lines) =>
  lines.every((l) => l.kind !== 'submit' && l.kind !== 'type') &&
  lines.some((l) => l.navigations?.length);

export function segmentTitle(lines) {
  const submit = lines.find((l) => l.kind === 'submit');
  if (submit) {
    const made = lines
      .flatMap((l) => l.entities || [])
      .find((e) => e.created && e.from === 'response_body');
    if (made) return `Created a ${made.type}`;
    const label = submit.element?.label;
    return label ? `Submitted the ${label} form` : 'Submitted a form';
  }
  if (isNav(lines)) {
    const last = lines[lines.length - 1];
    const opened = (last.entities || []).find((e) => e.from === 'page_url');
    if (opened) return `Opened ${opened.type} ${short(opened.id)}`;
    const to = last.navigations?.[last.navigations.length - 1]?.to;
    return to ? `Went to ${to}` : lead(last.text);
  }
  return lines.length === 1 ? lead(lines[0].text) : `${lead(lines[0].text)} and more`;
}

export function groupLines(lines) {
  const raw = [];
  let cur = null;
  for (const line of lines) {
    if (!cur || cur.closed || cur.page !== (line.page || '')) {
      cur = { page: line.page || '', lines: [] };
      raw.push(cur);
    }
    cur.lines.push(line);
    if (line.kind === 'submit' || line.navigations?.length) cur.closed = true;
  }
  const merged = [];
  for (const s of raw) {
    const prev = merged[merged.length - 1];
    if (prev && isNav(prev.lines) && isNav(s.lines)) prev.lines.push(...s.lines);
    else merged.push(s);
  }
  return merged.map((s) => ({
    title: segmentTitle(s.lines),
    page: s.page,
    lines: s.lines,
    source: 'bench',
  }));
}

/**
 * The segments for these lines (sorted by time): the feed's own when the story
 * has them (their titles are the package's narration), the bench's otherwise.
 */
export function segmentsOf(story, lines) {
  const feed = Array.isArray(story?.segments) ? story.segments : [];
  if (!feed.length) return groupLines(lines);
  const byId = new Map(lines.map((l) => [l.id, l]));
  const segments = feed
    .map((s) => ({
      title: s.title ?? s.text ?? '',
      page: s.page ?? '',
      // The feed cites the lines each title rests on; those lines are the segment.
      lines: (s.cites ?? s.lines ?? s.line_ids ?? s.children ?? [])
        .map((l) => byId.get(typeof l === 'string' ? l : l?.id))
        .filter(Boolean),
      source: 'feed',
      ...(s.confidence != null ? { confidence: s.confidence } : {}),
      ...(s.verb !== undefined ? { verb: s.verb } : {}),
      ...(s.entities ? { entities: s.entities } : {}),
      ...(s.values ? { values: s.values } : {}),
    }))
    .filter((s) => s.lines.length);
  return segments.length ? segments : groupLines(lines);
}

// Tokens a title may only use when its evidence carries them: quoted strings,
// emails, and ID-shaped tokens (8+ characters mixing letters with digits, - or _).
const CITED = [
  /"([^"]+)"|“([^”]+)”/gu,
  /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/gu,
  /\b(?=[\w-]*\d)[A-Za-z0-9_-]{8,}\b/gu,
];

/** What a title claims that its evidence doesn't contain (empty when grounded). */
export function ungroundedTokens(title, evidence) {
  const haystack = evidence.join('\n').toLowerCase();
  const tokens = new Set();
  for (const pattern of CITED)
    for (const match of String(title).matchAll(pattern)) {
      const token = (match[1] ?? match[2] ?? match[0]).replace(/…$/u, '');
      if (token && !haystack.includes(token.toLowerCase())) tokens.add(token);
    }
  return [...tokens];
}
