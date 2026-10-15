/**
 * Capture coverage, provable from the records alone.
 *
 * Three row kinds, written by three parties that never trust each other:
 *   capture.page     the runtime, once per page at install: page id, build,
 *                    React version(s), runtime version, transport wrappers installed
 *   capture.summary  the runtime, at pagehide / flush: rows emitted by kind,
 *                    last sequence, sink dropped / malformed, capture.limit count,
 *                    network.body rows emitted / truncated (body_sequence)
 *   capture.received the collector, once per page at run close: rows received
 *                    by kind, last sequence, sequence gaps
 *
 * `pageCoverage` compares them, and the rows the store actually loaded for the
 * page against `capture.received` (plus the store's malformed-line count):
 * no timing, no heuristics.
 * `complete: true` only when every check passes; each failed check is one
 * reason. It is a statement about delivery of what the runtime emitted, never
 * about what uninstrumented code, workers or third-party scripts did
 * (`unobserved` lists the transports the runtime did not wrap).
 */
import { pageOf } from '../analysis/element-index.mjs';
import { observedEventKinds } from '../analysis/user-event-model.mjs';

export const COVERAGE_SCOPE = 'delivery of the rows this page\'s runtime emitted; `unobserved` lists what this page\'s rows show the runtime did not observe (event kinds, transports, realms), which is not an exhaustive list: navigations, <img>/<form>/<link> loads, WebRTC and similar paths are never recorded; not what uninstrumented scripts, workers or third-party code did';

/**
 * What the page's runtime did not observe, from its own rows (never a
 * constant): `capture.page.observes` (event kinds the browser exposes that
 * start no action; transports not wrapped), `capture.limit` rows (each realm:
 * a child frame, a worker, a controlling service worker), the latest
 * `capture.realm` status of each frame, and `worker.create` rows.
 * Each entry is `{ kind, name, reason, ... }`. A runtime older than
 * `observes` states that its event coverage is not declared.
 */
export function unobservedOf(pageRow, own, summary = null) {
  if (!pageRow) return null;
  const entries = [];
  const observes = pageRow.observes && typeof pageRow.observes === 'object' ? pageRow.observes : null;
  // Event kinds: one source with the runtime's listeners (observedEventKinds:
  // capture.page.user_events.listened, else observes.events.recorded).
  const kinds = observedEventKinds(pageRow);
  if (kinds && Array.isArray(kinds.unobserved)) {
    const names = kinds.unobserved;
    const bound = kinds.lower_bound ? 'at least ' : '';
    const recorded = pageRow.user_events ? `listens for ${kinds.listened.length} event kind(s) (capture.page.user_events.listened) and records every trusted dispatch of them` : `starts an action only for ${kinds.listened.join(', ') || 'no event kind'}`;
    if (names.length) entries.push({ kind: 'events', name: 'event kinds', names, count: names.length, lower_bound: Boolean(kinds.lower_bound), recorded: kinds.listened,
      reason: `the runtime ${recorded}; a user action through any of these ${bound}${names.length} event kind(s) the browser can dispatch is not recorded, and work its listeners do runs under no action${bound ? ' (the list is a lower bound: on* handler properties plus known kinds with none)' : ''}` });
  } else {
    entries.push({ kind: 'events', name: 'event kinds', names: null, count: null,
      reason: 'this runtime did not declare which event kinds it listens to (capture.page has no observes); which user events start an action cannot be proven from these rows' });
  }
  const transports = observes?.transports && typeof observes.transports === 'object' ? observes.transports
    : Object.fromEntries(Object.entries(pageRow.wrappers || {}).map(([name, wrapped]) => [name, wrapped ? 'wrapped' : 'not_wrapped']));
  for (const [name, status] of Object.entries(transports)) {
    if (status !== 'not_wrapped') continue;
    entries.push({ kind: 'transport', name, status,
      reason: observes ? `${name} is present on this page and not wrapped by the runtime: requests sent through it are not recorded`
        : `${name} was not wrapped by this runtime (a capture.page before observes does not tell an absent API from an unwrapped one)` });
  }
  // A wrapper the runtime installed that a later check found replaced (capture.summary.wrapper_replaced).
  for (const name of Array.isArray(summary?.wrapper_replaced) ? summary.wrapper_replaced : []) {
    entries.push({ kind: 'transport', name, status: 'replaced',
      reason: `${name}: the runtime's wrapper was replaced after install; requests through the replacement are recorded only if it still calls the runtime's wrapper` });
  }
  // Realms: one capture.limit per realm; a frame's latest capture.realm status wins.
  const realms = new Map();
  for (const row of own.filter(value => value.kind === 'capture.limit' && value.feature === 'realm')) realms.set(row.realm_id || `sequence:${row.sequence}`, { ...row });
  for (const row of own.filter(value => value.kind === 'capture.realm' && value.realm_id).sort((left, right) => Number(left.sequence || 0) - Number(right.sequence || 0))) {
    const known = realms.get(row.realm_id); if (known) Object.assign(known, { same_origin: row.same_origin, url: row.url ?? known.url });
  }
  const frames = [...realms.values()].filter(row => row.realm_kind === 'frame');
  if (frames.length) {
    const same = frames.filter(row => row.same_origin === true).length;
    entries.push({ kind: 'realm', name: 'frame', count: frames.length, same_origin: same, cross_origin: frames.length - same,
      realms: frames.map(row => ({ realm_id: row.realm_id ?? null, same_origin: row.same_origin ?? null, url: row.url ?? null })),
      reason: `${frames.length} child browsing context(s) in this page (${same} same-origin, ${frames.length - same} cross-origin; content not read): code in them runs outside this page's runtime, so their events and requests are not recorded` });
  }
  for (const row of [...realms.values()].filter(value => value.realm_kind !== 'frame')) {
    entries.push({ kind: 'realm', name: row.realm_kind || 'realm', count: 1, url: row.url ?? null, reason: row.reason || 'a realm this runtime does not observe' });
  }
  const workerLimits = own.filter(row => row.kind === 'capture.limit' && row.feature === 'worker_fetch');
  const workers = new Map();
  for (const row of [...own.filter(value => value.kind === 'worker.create'), ...workerLimits]) {
    if (row.worker_id && !workers.has(row.worker_id)) workers.set(row.worker_id, { worker_id: row.worker_id, worker_kind: row.worker_kind ?? null, script_url: row.script_url ?? null });
  }
  const workerCount = Math.max(workers.size, workerLimits.length ? 1 : 0);
  if (workerCount) entries.push({ kind: 'realm', name: 'worker', count: workerCount, workers: [...workers.values()],
    reason: `${workerCount} worker(s) created on this page: worker code is not instrumented, so requests a worker makes are not recorded (posts into it are)` });
  return entries;
}
const MAX_GAP_RANGES = 50;

/** Contiguity of a set of positive integer sequences over 1..max. */
function gapsOf(sequences) {
  const sorted = [...new Set(sequences)].sort((left, right) => left - right);
  const gaps = []; let missing = 0; let expected = 1;
  for (const value of sorted) {
    if (value > expected) { missing += value - expected; if (gaps.length < MAX_GAP_RANGES) gaps.push([expected, value - 1]); }
    expected = value + 1;
  }
  return { gaps, missing, distinct: sorted.length, last: sorted.length ? sorted.at(-1) : 0, first: sorted.length ? sorted[0] : null };
}

/**
 * The collector's per-page tally of what it received. `add(rows)` for every
 * ingested batch; `unparsed()` for a body that was not JSON (its rows are
 * unknown); `rows(extra)` returns one `capture.received` row per page.
 */
export function createReceivedTally() {
  const pages = new Map(); let unparsedBodies = 0; let nonObjectItems = 0;
  const pageEntry = key => {
    if (!pages.has(key)) pages.set(key, { rows: 0, byKind: {}, unsequencedByKind: {}, sequences: [], stampSequences: [], duplicates: 0, seen: new Set(), stampSeen: new Set(), stampDuplicates: 0,
      bodySequences: [], bodySeen: new Set(), bodyDuplicates: 0 });
    return pages.get(key);
  };
  return {
    add(rows) {
      for (const row of rows) {
        if (!row || typeof row !== 'object' || Array.isArray(row)) { nonObjectItems += 1; continue; }
        if (row.kind === 'capture.received') continue;
        const entry = pageEntry(pageOf(row));
        const kind = typeof row.kind === 'string' ? row.kind : '(no kind)';
        entry.rows += 1;
        if (Number.isInteger(row.sequence) && row.sequence > 0) {
          entry.byKind[kind] = (entry.byKind[kind] || 0) + 1;
          if (entry.seen.has(row.sequence)) entry.duplicates += 1; else entry.seen.add(row.sequence);
          entry.sequences.push(row.sequence);
        } else {
          entry.unsequencedByKind[kind] = (entry.unsequencedByKind[kind] || 0) + 1;
          if (Number.isInteger(row.stamp_sequence) && row.stamp_sequence > 0) {
            if (entry.stampSeen.has(row.stamp_sequence)) entry.stampDuplicates += 1; else entry.stampSeen.add(row.stamp_sequence);
            entry.stampSequences.push(row.stamp_sequence);
          }
          if (Number.isInteger(row.body_sequence) && row.body_sequence > 0) {
            if (entry.bodySeen.has(row.body_sequence)) entry.bodyDuplicates += 1; else entry.bodySeen.add(row.body_sequence);
            entry.bodySequences.push(row.body_sequence);
          }
        }
      }
    },
    unparsed() { unparsedBodies += 1; },
    stats() { return { pages: pages.size, unparsed_bodies: unparsedBodies, non_object_items: nonObjectItems }; },
    rows({ runId = null, now = () => Date.now() } = {}) {
      return [...pages].map(([page, entry]) => {
        const main = gapsOf(entry.sequences); const stamps = gapsOf(entry.stampSequences); const bodies = gapsOf(entry.bodySequences);
        return { schema: 'producttrace.runtime-evidence.v1', kind: 'capture.received', capture_page_id: page, page_id: page, run_id: runId, timestamp: now(),
          rows_received: entry.rows, received_by_kind: entry.byKind, unsequenced_by_kind: entry.unsequencedByKind,
          first_sequence: main.first, last_sequence: main.last, distinct_sequences: main.distinct, duplicate_sequences: entry.duplicates,
          gaps: main.gaps, gap_rows: main.missing, gaps_truncated: main.gaps.length >= MAX_GAP_RANGES,
          last_stamp_sequence: stamps.last, stamp_gaps: stamps.gaps, stamp_gap_rows: stamps.missing, duplicate_stamp_sequences: entry.stampDuplicates,
          last_body_sequence: bodies.last, body_gaps: bodies.gaps, body_gap_rows: bodies.missing, duplicate_body_sequences: entry.bodyDuplicates,
          collector: { unparsed_bodies: unparsedBodies, non_object_items: nonObjectItems } };
      });
    },
  };
}

const range = ([from, to]) => (from === to ? String(from) : `${from}-${to}`);

/** What the store actually holds for one page, classified exactly like the collector's tally. */
function tallyLoaded(own) {
  const byKind = {}; const unsequencedByKind = {}; const sequences = new Set();
  for (const row of own) {
    if (row.kind === 'capture.received') continue;
    const kind = typeof row.kind === 'string' ? row.kind : '(no kind)';
    if (Number.isInteger(row.sequence) && row.sequence > 0) { byKind[kind] = (byKind[kind] || 0) + 1; sequences.add(row.sequence); }
    else unsequencedByKind[kind] = (unsequencedByKind[kind] || 0) + 1;
  }
  return { byKind, unsequencedByKind, distinct: sequences.size };
}

const storeReasons = malformedRecords => (malformedRecords > 0
  ? [`the store's records.jsonl has ${malformedRecords} malformed line(s) that were not loaded; their page is unknown, so no page's delivery can be proven`] : []);

/**
 * Coverage for one page. `rows` must hold every loaded row of the page (any
 * superset is fine: rows of other pages are ignored), because the rows the
 * store actually holds are checked against `capture.received` too (a row the
 * collector counted can still be missing from the store: a truncated or
 * hand-edited records.jsonl, a failed append). `malformedRecords` is the
 * store-level count of records.jsonl lines that could not be parsed.
 */
export function pageCoverage(page, rows, { malformedRecords = 0 } = {}) {
  const own = rows.filter(row => pageOf(row) === page);
  const pages = own.filter(row => row.kind === 'capture.page');
  const summaries = own.filter(row => row.kind === 'capture.summary').sort((left, right) => Number(left.sequence || 0) - Number(right.sequence || 0));
  const received = own.filter(row => row.kind === 'capture.received');
  const dropped = own.filter(row => row.kind === 'capture.dropped').reduce((sum, row) => sum + (Number.isFinite(row.count) ? row.count : 1), 0);
  const reasons = [];
  const pageRow = pages[0] || null;
  if (!pages.length && !summaries.length && !received.length) {
    // A store written before coverage rows existed (or a page none of whose
    // coverage rows arrived): delivery cannot be proven either way.
    reasons.push('no coverage rows for this page (capture.page, capture.summary, capture.received): recorded before coverage existed, or none were delivered; delivery cannot be proven');
    if (dropped > 0) reasons.push(`${dropped} capture.dropped row(s) for this page`);
    reasons.push(...storeReasons(malformedRecords));
    return { page, complete: false, reasons, scope: COVERAGE_SCOPE, unobserved: null, runtime_version: null, build: null, wrappers: null, bodies: null, body_rows: null, emitted: null, received: null };
  }
  if (!pages.length) reasons.push('no capture.page row for this page: the runtime did not report its wrappers (older runtime, or the row was not delivered)');
  else if (pages.length > 1) reasons.push(`${pages.length} capture.page rows share this page id; their rows cannot be told apart`);
  const summary = summaries.at(-1) || null;
  if (!summary) reasons.push('no capture.summary row: the page never reported its emitted totals (no pagehide or flush reached the collector)');
  const receipt = received.length === 1 ? received[0] : null;
  if (!received.length) reasons.push('no capture.received row: the collector run that received this page has not closed');
  else if (received.length > 1) reasons.push(`this page was received across ${received.length} collector runs; their tallies are not merged`);
  if (receipt) {
    if (receipt.gap_rows > 0) reasons.push(`sequence gaps: ${receipt.gaps.map(range).join(', ')}${receipt.gaps_truncated ? ', …' : ''} (${receipt.gap_rows} row(s) emitted but not received)`);
    if (receipt.duplicate_sequences > 0) reasons.push(`${receipt.duplicate_sequences} duplicate sequence(s) received`);
    if (receipt.stamp_gap_rows > 0) reasons.push(`element.stamp gaps: ${receipt.stamp_gaps.map(range).join(', ')} (${receipt.stamp_gap_rows} stamp row(s) missing)`);
    if (receipt.body_gap_rows > 0) reasons.push(`network.body gaps: ${receipt.body_gaps.map(range).join(', ')} (${receipt.body_gap_rows} body row(s) missing)`);
    if (receipt.duplicate_body_sequences > 0) reasons.push(`${receipt.duplicate_body_sequences} duplicate body sequence(s) received`);
    if (receipt.collector?.unparsed_bodies > 0) reasons.push(`collector could not parse ${receipt.collector.unparsed_bodies} ingest body(ies); the rows in them are unaccounted for`);
    // Received is not stored: compare what the store loaded with what the collector counted.
    const loaded = tallyLoaded(own);
    for (const [label, have, got] of [['', loaded.byKind, receipt.received_by_kind || {}], ['unsequenced ', loaded.unsequencedByKind, receipt.unsequenced_by_kind || {}]]) {
      for (const kind of [...new Set([...Object.keys(have), ...Object.keys(got)])].sort()) {
        const stored = have[kind] || 0; const counted = got[kind] || 0;
        if (stored !== counted) reasons.push(`the store holds ${stored} ${label}${kind} row(s) for this page; the collector received ${counted}`);
      }
    }
    if (loaded.distinct !== receipt.distinct_sequences) reasons.push(`the store holds ${loaded.distinct} distinct sequence(s) for this page; the collector received ${receipt.distinct_sequences}`);
  }
  if (summary) {
    if (receipt) {
      if (receipt.last_sequence > summary.last_sequence) reasons.push(`${receipt.last_sequence - summary.last_sequence} row(s) emitted after the last capture.summary (sequence > ${summary.last_sequence}) are not covered by it`);
      else if (receipt.last_sequence < summary.last_sequence) reasons.push(`rows ${receipt.last_sequence + 1}-${summary.last_sequence} were emitted but not received (tail missing)`);
      else {
        const kinds = [...new Set([...Object.keys(summary.emitted_by_kind || {}), ...Object.keys(receipt.received_by_kind || {})])].sort();
        for (const kind of kinds) {
          const emitted = summary.emitted_by_kind?.[kind] || 0; const got = receipt.received_by_kind?.[kind] || 0;
          if (emitted !== got) reasons.push(`emitted ${emitted} ${kind} row(s), received ${got}`);
        }
      }
      const stampsReceived = receipt.unsequenced_by_kind?.['element.stamp'] || 0;
      if (Number.isInteger(summary.stamps_emitted) && summary.stamps_emitted !== stampsReceived) {
        reasons.push(`emitted ${summary.stamps_emitted} element.stamp row(s), received ${stampsReceived}`);
      }
      const bodiesReceived = receipt.unsequenced_by_kind?.['network.body'] || 0;
      if (Number.isInteger(summary.bodies_emitted) && summary.bodies_emitted !== bodiesReceived) {
        reasons.push(`emitted ${summary.bodies_emitted} network.body row(s), received ${bodiesReceived}`);
      }
    }
    if (summary.bodies_pending > 0) reasons.push(`${summary.bodies_pending} body read(s) still in flight at the last capture.summary: their network.body rows were not recorded`);
    if (summary.capture_limits > 0) reasons.push(`capture.limit: ${summary.capture_limits} (${(summary.capture_limit_features || []).join(', ') || 'unnamed'}): part of the capture is off on this page`);
    else if (own.some(row => row.kind === 'capture.limit')) reasons.push(`capture.limit: ${own.filter(row => row.kind === 'capture.limit').length} row(s) emitted after the last capture.summary: part of the capture is off on this page`);
    if (summary.dropped > 0) reasons.push(`the page sink dropped ${summary.dropped} row(s) after retries`);
    if (summary.malformed > 0) reasons.push(`the page sink received ${summary.malformed} malformed row(s)`);
    if (summary.host_errors > 0) reasons.push(`the host capture hook threw ${summary.host_errors} time(s); those rows may not have left the page`);
  }
  if (dropped > 0 && !(summary?.malformed > 0)) reasons.push(`${dropped} capture.dropped row(s) for this page`);
  reasons.push(...storeReasons(malformedRecords));
  const wrappers = pageRow?.wrappers || null;
  const unobserved = unobservedOf(pageRow, own, summary);
  for (const name of Array.isArray(summary?.wrapper_replaced) ? summary.wrapper_replaced : []) reasons.push(`transport wrapper replaced after install: ${name} (its requests may not be recorded)`);
  // An unobserved realm present in the page is its own reason (its capture.limit row is counted above too).
  for (const entry of (unobserved || []).filter(value => value.kind === 'realm')) reasons.push(`unobserved realm present: ${entry.reason}`);
  return { page, complete: reasons.length === 0, reasons, scope: COVERAGE_SCOPE,
    unobserved, observes: pageRow?.observes ?? null,
    runtime_version: pageRow?.runtime_version ?? null, build: summary?.build ?? pageRow?.build ?? null, wrappers,
    // Body capture declared by the page (on | off | production_off); null for runtimes before body capture.
    bodies: pageRow?.bodies ?? summary?.bodies ?? null,
    body_rows: summary && Number.isInteger(summary.bodies_emitted) ? { emitted: summary.bodies_emitted, truncated: summary.body_truncations ?? null, not_captured: summary.bodies_not_captured ?? null, pending: summary.bodies_pending ?? null } : null,
    emitted: summary ? summary.last_sequence : null, received: receipt ? receipt.distinct_sequences : null };
}

/**
 * An action's coverage: its page's coverage plus the reasons its own window
 * gives (`windowCoverageReasons` in analysis/causal-chain.mjs: unattributed
 * requests with no known issuer, server spans with no browser parent,
 * unfollowed outbound calls). `complete` is true only when both are clean.
 */
export function actionCoverage(page, windowReasons = []) {
  if (!page) return null;
  if (!windowReasons.length) return page;
  return { ...page, complete: false, reasons: [...page.reasons, ...windowReasons], window_reasons: windowReasons };
}

/** page → coverage, for every page that has any row. */
export function indexCoverage(rows, { malformedRecords = 0 } = {}) {
  const byPage = new Map();
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const page = pageOf(row); if (!byPage.has(page)) byPage.set(page, []);
    byPage.get(page).push(row);
  }
  return new Map([...byPage].map(([page, own]) => [page, pageCoverage(page, own, { malformedRecords })]));
}
