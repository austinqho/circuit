/**
 * Read-only evidence store for agents (G4). A store is a directory:
 *   records.jsonl  (required) producttrace.runtime-evidence.v1 rows
 *   spans.jsonl    (optional) producttrace.backend-span.v1; absent/empty = backend not instrumented
 *   manifest.json  (optional) producttrace.runtime-attribution-manifest.v1
 *   manifests/<build>.json (optional, G6) one manifest per build; rows carry tracer_build
 *   runs.jsonl     (optional, G6) one producttrace.store-run.v1 row per run
 *
 * Coverage (`coverage`, `coverageFor(page)`) is computed only from the
 * capture.page / capture.summary / capture.received rows (collector/coverage.mjs).
 *
 * Everything else (episodes, entry-handler credit, chains, element index) is
 * derived here from the shared analysis functions; there is no second
 * implementation of joins or handler credit.
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import zlib from 'node:zlib';
import { createHash } from 'node:crypto';
import { attachBackendSpans, gestureContext, indexEntryHandlerUnits, indexWorkflowEpisodes, mergeRequestFacts } from '../analysis/runtime-attribution.mjs';
import { observedEventKinds } from '../analysis/user-event-model.mjs';
import { buildEpisodeChain, chainFrontier, episodeForAction, indexUnlinkedEvidence, memberOutcome, memberPointer, memberScope } from '../analysis/causal-chain.mjs';
import { indexCoverage, pageCoverage } from './coverage.mjs';
import { buildElementIndex, pageOf } from './element-index.mjs';
import { functionNameAt } from './store-writer.mjs';

const FUNCTION_ID = /^function:([0-9a-f]{64}):(\d+):(\d+)$/u;
const rowOrder = (left, right) => Number(left?.timestamp || 0) - Number(right?.timestamp || 0)
  || String(pageOf(left)).localeCompare(String(pageOf(right)))
  || Number(left?.sequence || 0) - Number(right?.sequence || 0);

/** A JSONL file may be banked gzipped (`name.jsonl.gz`) when it is large; resolve whichever exists. */
export function resolveJsonl(file) {
  if (!file) return null;
  if (fs.existsSync(file)) return file;
  if (!file.endsWith('.gz') && fs.existsSync(`${file}.gz`)) return `${file}.gz`;
  return null;
}

const IDENT = '[A-Za-z_$][\\w$]*';
const ANNOTATION = '(?:[^=;{}()<>,:\\n]|<[^=;{}()\\n]*>)+';
/**
 * Display-only name for a function passed as the first argument of a call
 * whose result is assigned (`const NAME = useCallback(() => …)`): the
 * identifier names the call's result, so it is reported with `via` and a
 * distinct status, never as the function's own name. Not used for remap.
 */
export function wrappedAssignmentAt(content, start) {
  const before = content.slice(Math.max(0, start - 200), start);
  // Same binding rule as the store writer's functionNameAt: the annotation cannot cross `,` `:` `(` `{` or a newline.
  const match = new RegExp(`(?<![\\w$])(${IDENT})\\s*(?::\\s*${ANNOTATION})?(?<![=!<>+\\-*/%&|^?:])=(?![=>])\\s*(?:await\\s+)?(${IDENT}(?:\\.${IDENT})*)\\s*(?:<[^()<>]*>)?\\(\\s*$`, 'u').exec(before);
  return match ? { name: match[1], via: match[2] } : null;
}

/** Stream a JSONL file (plain or gzipped). Malformed lines are counted, never silently dropped. */
export async function readJsonl(file) {
  const rows = []; let malformed = 0; let line = 0; const malformedLines = [];
  const resolved = resolveJsonl(file);
  if (!resolved) return { rows, malformed, malformed_lines: malformedLines, present: false };
  const raw = fs.createReadStream(resolved);
  const stream = resolved.endsWith('.gz') ? raw.pipe(zlib.createGunzip()) : raw;
  stream.setEncoding('utf8');
  const input = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const text of input) {
    line += 1;
    if (!text.trim()) continue;
    try { const value = JSON.parse(text); if (value && typeof value === 'object' && !Array.isArray(value)) rows.push(value); else { malformed += 1; if (malformedLines.length < 20) malformedLines.push(line); } }
    catch { malformed += 1; if (malformedLines.length < 20) malformedLines.push(line); }
  }
  return { rows, malformed, malformed_lines: malformedLines, present: true };
}

/** Resolve the store's file paths from a directory plus optional overrides. */
export function storePaths({ dir = null, records = null, spans = null, manifest = null } = {}) {
  const inDir = name => (dir ? path.resolve(dir, name) : null);
  const recordsPath = records ? path.resolve(records) : inDir('records.jsonl');
  const spansPath = spans ? path.resolve(spans) : inDir('spans.jsonl');
  let manifestPath = manifest ? path.resolve(manifest) : inDir('manifest.json');
  if (manifestPath && !manifest && !fs.existsSync(manifestPath)) manifestPath = null;
  const paths = { records: recordsPath, spans: spansPath, manifest: manifestPath };
  // G6 multi-build store: per-build manifests and the run index.
  const manifestsDir = inDir('manifests');
  if (manifestsDir && fs.existsSync(manifestsDir)) paths.manifests = manifestsDir;
  const runsPath = inDir('runs.jsonl');
  if (runsPath && fs.existsSync(runsPath)) paths.runs = runsPath;
  return paths;
}

/** Read manifests/<build>.json → Map(build → manifest). */
function readBuildManifests(dir) {
  const out = new Map();
  if (!dir) return out;
  for (const name of fs.readdirSync(dir).filter(file => file.endsWith('.json')).sort()) {
    let manifest;
    try { manifest = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')); }
    catch (error) { const wrapped = new Error(`manifest ${name} unreadable: ${error.message}`); wrapped.code = 'MANIFEST_INVALID'; throw wrapped; }
    const fromName = name.slice(0, -'.json'.length);
    const build = typeof manifest.build === 'string' ? manifest.build : fromName;
    // Never let a later file silently win: one build key, one manifest file.
    if (build !== fromName) { const error = new Error(`manifest ${name} declares build ${build}, which does not match its file name`); error.code = 'MANIFEST_INVALID'; throw error; }
    if (out.has(build)) { const error = new Error(`two manifest files declare build ${build}; refusing to pick one`); error.code = 'MANIFEST_INVALID'; throw error; }
    out.set(build, manifest);
  }
  return out;
}

export async function loadStore(options = {}) {
  const paths = storePaths(options);
  if (!paths.records || !resolveJsonl(paths.records)) {
    const error = new Error(`records.jsonl not found${paths.records ? ` at ${paths.records}` : ''}`); error.code = 'STORE_NOT_FOUND'; throw error;
  }
  const records = await readJsonl(paths.records);
  const spans = await readJsonl(paths.spans);
  let manifest = null;
  if (paths.manifest) {
    try { manifest = JSON.parse(fs.readFileSync(paths.manifest, 'utf8')); } catch (error) { const wrapped = new Error(`manifest unreadable: ${error.message}`); wrapped.code = 'MANIFEST_INVALID'; throw wrapped; }
  }
  const manifests = readBuildManifests(paths.manifests);
  const runs = paths.runs ? (await readJsonl(paths.runs)).rows : [];
  const store = createStore({ records: records.rows, spans: spans.rows, manifest, manifests, runs, sourceRoot: options.sourceRoot || null,
    load: { paths, malformed_records: records.malformed, malformed_record_lines: records.malformed_lines,
      malformed_spans: spans.malformed, spans_file_present: spans.present } });
  store.fingerprint = fileFingerprint(paths);
  store.paths = paths;
  return store;
}

export function fileFingerprint(paths) {
  // A directory's mtime moves when a file is added (a new build's manifest).
  return Object.values(paths).filter(Boolean).map(file => {
    try { const stat = fs.statSync(file); return `${file}:${stat.size}:${stat.mtimeMs}`; } catch { return `${file}:absent`; }
  }).join('|');
}

/**
 * Build the in-memory query engine from rows.
 * @param {object} input
 * @param {object[]} input.records
 * @param {object[]} [input.spans]
 * @param {object|null} [input.manifest]
 * @param {Map<string, object>|object} [input.manifests] G6: build id → manifest (one per build in the store)
 * @param {object[]} [input.runs] G6: runs.jsonl rows
 * @param {string|null} [input.sourceRoot]
 * @param {number} [input.idleMs] an episode whose newest row is younger than this is still pending
 * @param {() => number} [input.now]
 */
export function createStore({ records: input, spans = [], manifest = null, manifests = new Map(), runs = [], sourceRoot = null, idleMs = 1500, now = () => Date.now(), load = {} } = {}) {
  if (!Array.isArray(input)) throw new TypeError('records must be an array');
  // Abort and body-read facts onto their request rows (fix/client-aborts):
  // every tool reads the same merged rows; the fact rows themselves stay.
  const records = mergeRequestFacts(input);
  const backendInstrumented = spans.length > 0;
  const manifestsByBuild = manifests instanceof Map ? manifests : new Map(Object.entries(manifests || {}));
  // Function ids are content-derived (file hash + span), so the union of every
  // build's manifest is one consistent id → source map.
  const allManifests = [manifest, ...manifestsByBuild.values()].filter(Boolean);
  const manifestById = new Map(allManifests.flatMap(value => (value.functions || []).filter(row => typeof row?.id === 'string').map(row => [row.id, row])));
  const registeredFunctionIds = allManifests.length ? [...manifestById.keys()] : null;
  // First-party classes (manifest `classes`, builds since 2026-09-24): class id → source name, for error types.
  const classById = new Map(allManifests.flatMap(value => (Array.isArray(value.classes) ? value.classes : []).filter(row => typeof row?.id === 'string').map(row => [row.id, row])));
  const errorClassName = classId => { const row = classById.get(classId); return row && typeof row.name === 'string' && row.name ? row.name : null; };
  const buildByAction = new Map();
  for (const row of records) if (row?.kind === 'dom.action' && row.action_id && typeof row.tracer_build === 'string' && !buildByAction.has(row.action_id)) buildByAction.set(row.action_id, row.tracer_build);
  const fileCache = new Map();
  const root = sourceRoot ? path.resolve(sourceRoot) : null;

  const manifestSource = functionId => {
    const source = manifestById.get(functionId)?.source;
    return source ? { file: source.file, start: source.start, end: source.end } : null;
  };
  const readSource = file => {
    if (!root) return null;
    const absolute = path.resolve(root, file);
    if (absolute !== root && !absolute.startsWith(root + path.sep)) return { error: 'path_outside_source_root' };
    if (!fileCache.has(absolute)) {
      try { const content = fs.readFileSync(absolute, 'utf8'); fileCache.set(absolute, { content, hash: createHash('sha256').update(content).digest('hex') }); }
      catch { fileCache.set(absolute, { error: 'file_missing' }); }
    }
    return fileCache.get(absolute);
  };
  /** function id → source with a line number when the checkout matches the build. */
  const sourceFor = functionId => {
    if (typeof functionId !== 'string') return null;
    const base = manifestSource(functionId);
    const match = FUNCTION_ID.exec(functionId);
    if (!base) return match ? { file: null, start: Number(match[2]), end: Number(match[3]), line: null, line_status: manifest ? 'function_not_in_manifest' : 'manifest_not_configured' } : null;
    if (!root) return { ...base, line: null, line_status: 'source_root_not_configured' };
    const file = readSource(base.file);
    if (!file || file.error) return { ...base, line: null, line_status: file?.error || 'file_missing' };
    if (match && match[1] !== file.hash) return { ...base, line: null, line_status: 'stale_build' };
    const line = file.content.slice(0, base.start).split('\n').length;
    return { ...base, line, line_status: 'ok' };
  };

  /**
   * Function id → { name, name_kind, display_name, name_status, source, label }
   * for rendering (no credit rule).
   *
   * Builds since 2026-09-24 record names at build time from the source's own
   * declarations (manifest `name`, `name_kind`, `display_name`;
   * integrations/function-names.mjs). Those are printed as recorded:
   * `name_status: "manifest"` for a name the source gives the function,
   * `"inferred"` for name_kind `inferred` (name null: the function was passed
   * to a call whose result is bound; display `save = useCallback(<callback>)`),
   * `"anonymous"` when the build abstained (the display still says where it
   * sits: `<callback of items.map>`, `<button onClick>`).
   *
   * Older manifests carry no `name_kind`. For them the store writer's text
   * rule is a fallback: a `name` the writer enriched, or one `functionNameAt`
   * reads from a checkout whose file hash equals the id's hash, is
   * `name_status: "inferred_from_source_text"` (a usable name read from the
   * source text, not verified by a build); `NAME = call(fn)`
   * (`wrappedAssignmentAt`) is `"inferred"` with name null and `bound_to`
   * NAME, like the build's inferred kind; no identifier is `"anonymous"`.
   * Without either: `not_recorded` (manifest row, nothing to read) or
   * `not_in_manifest`.
   */
  const functionInfoCache = new Map();
  const functionInfo = functionId => {
    if (typeof functionId !== 'string') return null;
    if (functionInfoCache.has(functionId)) return functionInfoCache.get(functionId);
    const row = manifestById.get(functionId) || null;
    const source = sourceFor(functionId);
    let name = null; let via = null; let nameStatus = row ? 'not_recorded' : 'not_in_manifest'; let nameKind = null; let display = null; let basis = null; let boundTo = null;
    if (row && Object.hasOwn(row, 'name_kind')) {
      // Build-time name: printed as recorded, never re-derived.
      name = typeof row.name === 'string' && row.name ? row.name : null; nameKind = row.name_kind; via = row.via ?? null;
      if (nameKind === 'inferred') { name = null; boundTo = row.bound_to ?? null; } // never the function's own name (its binding holds a call's result)
      display = typeof row.display_name === 'string' && row.display_name ? row.display_name : null;
      nameStatus = nameKind === 'inferred' ? 'inferred' : name ? 'manifest' : 'anonymous'; basis = 'build';
    } else if (row && Object.hasOwn(row, 'name')) {
      // Older manifest enriched by the store writer's text rule.
      name = typeof row.name === 'string' && row.name ? row.name : null; nameStatus = name ? 'inferred_from_source_text' : 'anonymous'; basis = 'store_writer_text_rule';
    } else if (row?.source?.file && root) {
      const file = readSource(row.source.file); const match = FUNCTION_ID.exec(functionId);
      if (file && !file.error && match && match[1] === file.hash) {
        name = functionNameAt(file.content, Number(match[2]), Number(match[3])); nameStatus = name ? 'inferred_from_source_text' : 'anonymous'; basis = 'checkout_text_rule';
        // `NAME = call(fn)`: NAME holds the call's result, not the function; kept as context only.
        if (!name) { const wrapped = wrappedAssignmentAt(file.content, Number(match[2])); if (wrapped) { boundTo = wrapped.name; via = wrapped.via; basis = 'checkout_text_rule_via_call'; nameStatus = 'inferred'; } }
      }
    }
    const shown = display || (name || boundTo ? `${name || boundTo}${via ? ` (via ${via})` : ''}` : ({ anonymous: '<anonymous>', not_in_manifest: '<not in manifest>' }[nameStatus] || '<unnamed>'));
    const at = source?.file ? `${source.file}${source.line ? `:${source.line}` : `@${source.start}-${source.end}`}` : functionId;
    const info = { function_id: functionId, name, ...(nameKind ? { name_kind: nameKind } : {}), display_name: shown, name_status: nameStatus, ...(basis ? { name_basis: basis } : {}),
      ...(via ? { via } : {}), ...(boundTo ? { bound_to: boundTo } : {}), ...(row?.export_names?.length ? { export_names: row.export_names } : {}), source, label: `${shown} ${at}` };
    functionInfoCache.set(functionId, info);
    return info;
  };
  /** A first-party frame: registered in a manifest (every id when the store has none). */
  const isFirstPartyFunction = functionId => typeof functionId === 'string' && (registeredFunctionIds ? manifestById.has(functionId) : true);

  // Abstain, never pick a neighbour (G6 grade close): credit restricted to
  // registered ids would silently skip an entered function that is missing
  // from the action's build manifest and name the next registered function.
  // So the unrestricted credit is computed too; when its function is not
  // registered for the action's build, the entry handler is reported as
  // `resolution: "unmapped"` and no registered neighbour is credited.
  const manifestIdsByBuild = new Map([...manifestsByBuild].map(([build, value]) => [build, new Set((value.functions || []).map(row => row?.id))]));
  const unionIds = registeredFunctionIds ? new Set(registeredFunctionIds) : null;
  const registeredFor = actionId => { const build = buildByAction.get(actionId); return (build && manifestIdsByBuild.get(build)) || unionIds; };
  const unmappedEntry = (actionId, functionId, unitId, rooted = null) => {
    const registered = registeredFor(actionId);
    if (!functionId || !registered || registered.has(functionId)) return null;
    const build = buildByAction.get(actionId) ?? null;
    const otherBuilds = [...manifestIdsByBuild].filter(([, ids]) => ids.has(functionId)).map(([other]) => other);
    return { function_id: functionId, unit_id: unitId, rooted, resolution: 'unmapped', build, status: otherBuilds.length ? 'stale_build' : 'not_found',
      found_in_builds: otherBuilds, source: null,
      reason: `entry handler ${functionId} is not in ${build ? `build ${build}'s` : "the store's"} manifest${otherBuilds.length ? ` (it is in ${otherBuilds.join(', ')})` : ''}` };
  };
  const entryIndex = indexEntryHandlerUnits(records, { registeredFunctionIds });
  const rawEntryIndex = registeredFunctionIds ? indexEntryHandlerUnits(records) : null;
  const unmappedByAction = new Map();
  if (rawEntryIndex) for (const [actionId, unitIds] of rawEntryIndex.byAction) {
    const unitId = unitIds?.[0]; if (!unitId) continue;
    const miss = unmappedEntry(actionId, unitId.slice(0, unitId.lastIndexOf('|')), unitId);
    if (miss) unmappedByAction.set(actionId, miss);
  }
  const placedEntryIndex = unmappedByAction.size
    ? { ...entryIndex, byAction: new Map([...entryIndex.byAction].filter(([actionId]) => !unmappedByAction.has(actionId))) } : entryIndex;
  const elementIndex = buildElementIndex(records, { entryIndex: placedEntryIndex, sourceFor });
  const episodes = indexWorkflowEpisodes(records);

  const actionRows = records.filter(row => row?.kind === 'dom.action' && row.action_id).sort(rowOrder);
  const actionsById = new Map();
  for (const row of actionRows) { const list = actionsById.get(row.action_id) || []; list.push(row); actionsById.set(row.action_id, list); }
  const rowIndexesByAction = new Map();
  records.forEach((row, index) => {
    if (!row?.action_id) return;
    const list = rowIndexesByAction.get(row.action_id) || []; list.push(index); rowIndexesByAction.set(row.action_id, list);
  });
  const sessions = new Map();
  for (const row of actionRows) {
    const page = pageOf(row); const value = sessions.get(page) || { session: page, actions: 0, first_timestamp: row.timestamp ?? null, last_timestamp: row.timestamp ?? null };
    value.actions += 1; value.last_timestamp = row.timestamp ?? value.last_timestamp; sessions.set(page, value);
  }
  const spanById = new Map(spans.map(span => [span.span_id, span]));
  const requestsByAction = new Map();
  for (const row of records) if (row?.kind === 'network.request' && row.action_id && row.internal !== true && row.transport_internal !== true) {
    const list = requestsByAction.get(row.action_id) || []; list.push(row); requestsByAction.set(row.action_id, list);
  }
  // network.body rows (request / response bodies), keyed by (page, request_occurrence_id).
  // Rendering only: no chain, episode or join reads them.
  const bodiesByRequest = new Map();
  for (const row of records) if (row?.kind === 'network.body' && typeof row.request_occurrence_id === 'string') {
    const key = `${pageOf(row)}\u0000${row.request_occurrence_id}`;
    const entry = bodiesByRequest.get(key) || { request: null, response: null };
    const slot = row.direction === 'response' ? 'response' : 'request';
    if (!entry[slot]) entry[slot] = row;
    bodiesByRequest.set(key, entry);
  }
  const bodiesFor = requestRow => (requestRow?.request_occurrence_id ? bodiesByRequest.get(`${pageOf(requestRow)}\u0000${requestRow.request_occurrence_id}`) || null : null);
  const functionEnterByContinuation = new Map();
  for (const row of records) if (row?.kind === 'function.enter' && typeof row.continuation_id === 'string' && !functionEnterByContinuation.has(row.continuation_id)) functionEnterByContinuation.set(row.continuation_id, row);
  const chainCache = new Map();
  // Listed, never joined: rows seen but tied to no action (see indexUnlinkedEvidence).
  const unlinked = indexUnlinkedEvidence(records, spans);
  // Coverage per page, from capture.page / capture.summary / capture.received rows only.
  const malformedRecords = load.malformed_records ?? 0;
  const coverage = indexCoverage(records, { malformedRecords });
  const coverageFor = page => coverage.get(page) || pageCoverage(page, [], { malformedRecords });
  // Rows the page sink could not ship because they were malformed (capture.dropped).
  const droppedInPage = records.reduce((sum, row) => sum + (row?.kind === 'capture.dropped' ? (Number.isFinite(row.count) ? row.count : 1) : 0), 0);

  const episodeFor = actionId => episodeForAction(episodes, actionId, actionsById.get(actionId)?.[0] || null);
  const episodeRows = episode => {
    const indexes = episode.action_ids.flatMap(actionId => rowIndexesByAction.get(actionId) || []).sort((left, right) => left - right);
    return indexes.map(index => records[index]);
  };

  /**
   * The episode's public rows with every request's exact span joins
   * (`attachBackendSpans`, the same primitive the chain uses), for rendering
   * one segment per request. No join rule of its own. `joinedRowsFor` takes
   * the episode (or a member's own scope, see chainForAction) directly.
   */
  const joinedCache = new Map();
  // Rows depend only on the action ids, so they are the cache key.
  const joinedRowsFor = episode => {
    const cacheKey = episode.action_ids.join('\u0000');
    if (!joinedCache.has(cacheKey)) {
      const rows = episodeRows(episode).filter(row => row?.internal !== true && row?.transport_internal !== true);
      joinedCache.set(cacheKey, backendInstrumented ? attachBackendSpans(rows, spans) : rows);
    }
    return joinedCache.get(cacheKey);
  };
  const joinedEpisodeRows = actionId => joinedRowsFor(episodeFor(actionId).episode);

  const recordFor = (episode, idle, cacheKey) => {
    if (!chainCache.has(cacheKey)) {
      const rows = episodeRows(episode);
      const relatedRows = (episode.opened || []).flatMap(entry => (rowIndexesByAction.get(entry.action_id) || []).map(index => records[index]));
      let record = buildEpisodeChain(episode, rows, spans, { registeredFunctionIds, sourceFor: manifestSource, idle, sessionId: pageOf(episode.actions[0]), unlinked, backendInstrumented, errorClassName, relatedRows });
      if (registeredFunctionIds) {
        const raw = buildEpisodeChain(episode, rows, spans, { registeredFunctionIds: null, sourceFor: manifestSource, idle, sessionId: pageOf(episode.actions[0]), unlinked, backendInstrumented, errorClassName });
        const miss = raw.entry_handler ? unmappedEntry(raw.action_id, raw.entry_handler.function_id, raw.entry_handler.unit_id, raw.entry_handler.rooted) : null;
        if (miss) record = { ...record, entry_handler: miss, spine: { ...record.spine, function_ids: [] }, chain: record.chain.filter(step => step.kind !== 'function.enter') };
      }
      chainCache.set(cacheKey, { record, frontier: chainFrontier(record, { backendInstrumented }) });
    }
    return chainCache.get(cacheKey);
  };

  /**
   * The chain record + explicit frontier for `actionId` (episode-focus rule).
   *
   * - The carrier of its episode, or an action outside every episode: the
   *   episode's chain (unchanged).
   * - A non-carrier member: only that member's own evidence (its own rows:
   *   handlers, mutations, requests it made itself), built by the same
   *   assembler over a one-action scope, plus a pointer to the carrier. It
   *   never prints the carrier's requests, segments, routes, handlers or DB
   *   ops. `episodeView: true` returns the episode's chain instead
   *   (element_history attempts, which group by carrier).
   * - A caused focus (`gesture: false`): outside every episode, so its own
   *   single-action chain, plus the causing action and the episode it is
   *   listed under.
   */
  const chainForAction = (actionId, { episodeView = false } = {}) => {
    const { episode, standalone } = episodeFor(actionId);
    const newest = episodeRows(episode).reduce((max, row) => Math.max(max, Number(row.timestamp) || 0), 0);
    const idle = now() - newest > idleMs;
    const full = recordFor(episode, idle, `${episode.episode_id}\u0000${idle}`);
    const carrierActionId = full.record.action_id;
    const dispatch = actionsById.get(actionId)?.[0] || null;
    const caused = dispatch?.gesture === false ? causedPointer(dispatch) : null;
    const opened = dispatch?.opened_by_action_id ? openedPointer(dispatch) : null;
    if (standalone || episodeView || carrierActionId === actionId) {
      return { ...full, episode, standalone, scope: episode, carrier_action_id: carrierActionId, member: false, pointer: null,
        ...(caused ? { caused, record: { ...full.record, ...caused.fields } } : {}), ...(opened ? { opened } : {}) };
    }
    // Own evidence only (its own caused focuses stay listed on it); the
    // outcome label is the one function's over the member's own steps.
    const scope = memberScope(episode, actionId, dispatch);
    const own = recordFor(scope, idle, `member:${actionId}\u0000${idle}`);
    const pointer = memberPointer(episode, full.record);
    const record = { ...own.record, ...(own.record.outcome ? { outcome: memberOutcome(own.record.outcome, pointer) } : {}),
      episode_action_ids: episode.action_ids, evidence_action_ids: [actionId], episode_member: true,
      episode_carrier_action_id: carrierActionId, episode_pointer: pointer };
    return { record, frontier: own.frontier, episode, standalone: false, scope, carrier_action_id: carrierActionId, member: true, pointer, ...(opened ? { opened } : {}) };
  };
  /**
   * Pointer fields for an event dispatched on an element that live action
   * code activated with a synthetic click (D-G1-21 `opened_by_action_id`):
   * its own gesture (the user's choice in the picker the click opened), with
   * the opener named by identifier.
   */
  const openedPointer = dispatch => {
    const by = dispatch.opened_by_action_id;
    const episodeId = episodes.byAction.get(by) || null;
    const sentence = `this ${dispatch.event || 'event'} was dispatched on an element that action ${by}'s code activated with a synthetic click (${dispatch.opened_via || 'synthetic_click'}); it is its own gesture${episodeId ? `, listed under episode ${episodeId} as opened` : ''}`;
    return { opened_by_action_id: by, opened_by_episode_id: episodeId, opened_via: dispatch.opened_via ?? null, sentence };
  };
  /**
   * A gesture-context row (D-G1-21: a kind the episode rules do not cover,
   * e.g. pointerdown, keyup, a hover range) that no episode holds as a member.
   * recent_actions and element_history leave these out unless asked
   * (`include_context`), and say how many they left out.
   */
  // Coalesced range closes (D-G1-21 dom.action.range), by action.
  const rangesByAction = new Map();
  for (const row of records) if (row?.kind === 'dom.action.range' && row.action_id && !rangesByAction.has(row.action_id)) rangesByAction.set(row.action_id, row);
  const rangeFor = actionId => rangesByAction.get(actionId) || null;
  // Never hides evidence: a row that owns a request, a mutation receipt with
  // changes or a worker post is always listed.
  const evidenceActions = new Set();
  for (const row of records) if (row?.action_id && (row.kind === 'network.request' || row.kind === 'worker.postMessage' || (row.kind === 'dom.mutation' && row.count > 0))) evidenceActions.add(row.action_id);
  const contextOnly = actionId => { const row = actionsById.get(actionId)?.[0]; return Boolean(row && gestureContext(row) && !episodes.byAction.has(actionId) && !evidenceActions.has(actionId)); };
  /**
   * What the page's runtime observed (D-G1-21), from its own capture rows:
   * the kinds it listened for (capture.page), and per kind what it recorded,
   * coalesced, skipped as untrusted or classified not user-caused (the last
   * capture.summary). Null for pages from runtimes before D-G1-21.
   */
  const userEventsCache = new Map();
  const userEventsFor = page => {
    if (userEventsCache.has(page)) return userEventsCache.get(page);
    const pageRow = records.find(row => row?.kind === 'capture.page' && (row.page_id === page || pageOf(row) === page)) || null;
    const observed = observedEventKinds(pageRow);
    const summary = records.filter(row => row?.kind === 'capture.summary' && (row.page_id === page || pageOf(row) === page)).at(-1)?.user_events || null;
    const value = observed && !observed.legacy ? { model_version: observed.model_version, listened_kinds: observed.listened.length, listened: observed.listened,
      realms: pageRow?.user_events?.realms ?? null, summary: summary ? 'capture.summary' : 'absent (no capture.summary row for this page)',
      recorded_by_kind: summary?.recorded_by_kind ?? null, coalesced_by_kind: summary?.coalesced_by_kind ?? null, hover_segments: summary?.hover_segments ?? null,
      untrusted_skipped: summary?.untrusted_skipped ?? null, untrusted_by_kind: summary?.untrusted_by_kind ?? null, not_user_by_kind: summary?.not_user_by_kind ?? null } : null;
    userEventsCache.set(page, value); return value;
  };
  // dom.untrusted rows per page (sequence order): untrusted events the runtime skipped.
  const untrustedByPage = new Map();
  for (const row of records) if (row?.kind === 'dom.untrusted') { const list = untrustedByPage.get(pageOf(row)) || []; list.push(row); untrustedByPage.set(pageOf(row), list); }
  /** Pointer fields for a focus the runtime marked as not a gesture. */
  const causedPointer = dispatch => {
    const by = dispatch.caused_by_action_id || null;
    const episodeId = by ? (episodes.byAction.get(by) || null) : null;
    // PR #11 wrote these for focus; D-G1-21 marks any event (blur, submit, ...).
    const noun = ['focus', 'focusin'].includes(String(dispatch.event || 'focusin')) ? 'focus' : `${dispatch.event} event`;
    const sentence = by
      ? `this ${noun} was caused by action ${by}'s work${dispatch.caused_via ? ` (${dispatch.caused_via})` : ''}, not by a user gesture${episodeId ? `; it is listed under episode ${episodeId}` : ''}`
      : dispatch.cause_abstained === 'scheduler_lineage'
        ? `${noun} caused by app code committed from React's scheduler; causing action not attributable`
        : dispatch.cause_abstained === 'stale_frame'
          ? `${noun} caused by app code running on a frame that suspended code left behind (cause abstained: stale_frame); the causing action could not be proven`
          : `${noun} caused by app code running outside any action (cause abstained: ${dispatch.cause_abstained || 'unknown'}); causing action not attributable`;
    return { caused_by_action_id: by, caused_by_episode_id: episodeId, caused_via: dispatch.caused_via ?? null,
      ...(dispatch.cause_abstained ? { cause_abstained: dispatch.cause_abstained } : {}), sentence,
      fields: { gesture: false, caused_by_action_id: by, caused_by_episode_id: episodeId, caused_pointer: sentence } };
  };

  return {
    records, spans, manifest, manifestsByBuild, runs, buildByAction, backendInstrumented, entryIndex: placedEntryIndex, unmappedEntries: unmappedByAction, elementIndex, episodes, actionRows, actionsById, sessions, spanById, requestsByAction,
    sourceFor, manifestSource, chainForAction, contextOnly, rangeFor, userEventsFor, untrustedByPage, load, coverage, coverageFor, functionInfo, errorClassName, classById, isFirstPartyFunction, functionEnterByContinuation, joinedEpisodeRows, joinedRowsFor, bodiesFor,
    stats: () => ({ records: records.length, actions: actionRows.length, sessions: sessions.size, episodes: episodes.episodes.size,
      spans: spans.length, backend_instrumented: backendInstrumented, stamps: elementIndex.has_stamps, builds: elementIndex.builds,
      manifest_functions: allManifests.length ? manifestById.size : null, source_root: root,
      ...(manifestsByBuild.size || runs.length ? { manifest_builds: [...manifestsByBuild.keys()].sort(), runs: runs.length } : {}), malformed_records: (load.malformed_records ?? 0) + droppedInPage, dropped_in_page: droppedInPage, malformed_spans: load.malformed_spans ?? 0 }),
  };
}

/**
 * Remap a function id from one build's manifest into another's (G6).
 * Within the function's file, tried in this order; the first unique hit wins:
 *   1. text_match: equal whitespace-normalised source text (`text_sha256`,
 *      present when the store writer had the build's checkout);
 *   2. name_match: equal `name` (declaration or assigned identifier) when
 *      exactly one function in the file has it. Several same-named functions
 *      never pick by offset: a unique one that also matches the text is
 *      taken as text_match, else unmapped with `candidates: n`;
 *   3. ordinal: same function count and nesting shape (kind + depth in
 *      pre-order), same pre-order position.
 * Otherwise `unmapped` with the reason: abstain, never guess.
 *
 * @returns {{ status: 'mapped', basis: 'text_match'|'name_match'|'ordinal', mapped_id: string, file: string, ordinal: number, functions_in_file: number, tried: string[] }
 *   | { status: 'unmapped', basis: 'unmapped', reason: string, file: string|null, tried: string[] }}
 */
export function remapFunctionId(fromManifest, toManifest, functionId) {
  const row = (fromManifest?.functions || []).find(value => value?.id === functionId);
  if (!row?.source?.file) return { status: 'unmapped', basis: 'unmapped', reason: 'function not in its own build manifest', file: null, tried: [] };
  const file = row.source.file;
  const ordered = manifest => (manifest?.functions || []).filter(value => value?.source?.file === file && typeof value.id === 'string')
    .sort((left, right) => left.source.start - right.source.start || right.source.end - left.source.end);
  const shape = list => {
    const stack = []; const out = [];
    for (const value of list) {
      while (stack.length && !(value.source.start >= stack.at(-1).start && value.source.end <= stack.at(-1).end)) stack.pop();
      out.push(`${value.kind || 'function'}@${stack.length}`);
      stack.push(value.source);
    }
    return out.join(',');
  };
  const from = ordered(fromManifest); const to = ordered(toManifest);
  const tried = [];
  const mapped = (basis, target, why = []) => ({ status: 'mapped', basis, mapped_id: target.id, file, ordinal: to.indexOf(target), functions_in_file: to.length, tried: [...tried, ...why] });
  if (!to.length) return { status: 'unmapped', basis: 'unmapped', reason: `${file} has no functions in the other build`, file, tried };
  if (typeof row.text_sha256 === 'string') {
    const hits = to.filter(value => value.text_sha256 === row.text_sha256);
    if (hits.length === 1) return mapped('text_match', hits[0]);
    tried.push(hits.length ? `text_match: ${hits.length} identical functions (ambiguous)` : 'text_match: no function with the same normalised text');
  } else tried.push('text_match: no text hash in the manifest');
  // Build-time names (both manifests carry name_kind) compare by the qualified
  // display name without its export suffix (`ApiClient.get`); an abstained or
  // inferred name is not a name to compare by. Older manifests compare `name`.
  const both = Object.hasOwn(row, 'name_kind') && to.some(value => Object.hasOwn(value, 'name_kind'));
  // The export decoration is not part of the name: adding `export default f` keeps f's identity.
  const qualified = value => String(value.display_name || value.name).replace(/ \(exported as [^)]*\)$/u, '');
  const nameKey = value => (both
    ? (Object.hasOwn(value, 'name_kind') && value.name && value.name_kind !== 'inferred' ? qualified(value) : null)
    : (Object.hasOwn(value, 'name_kind') && value.name_kind === 'inferred' ? null : value.name));
  const rowName = nameKey(row);
  if (typeof rowName === 'string' && rowName) {
    const hits = to.filter(value => nameKey(value) === rowName);
    // A unique name maps (the nearest offset is then the only candidate).
    if (hits.length === 1) return mapped('name_match', hits[0]);
    if (hits.length > 1) {
      // Several same-named functions: never pick by offset. Only a unique
      // candidate that also matches the normalised text may be taken.
      const textual = typeof row.text_sha256 === 'string' ? hits.filter(value => value.text_sha256 === row.text_sha256) : [];
      if (textual.length === 1) return mapped('text_match', textual[0], [`name_match: ${hits.length} functions named ${rowName}; one also matches the normalised text`]);
      const reason = `${hits.length} functions named ${rowName} in file; no unique match`;
      return { status: 'unmapped', basis: 'unmapped', candidates: hits.length, reason, file, tried: [...tried, `name_match: ${reason}`] };
    }
    tried.push(`name_match: no function named ${rowName}`);
  } else tried.push('name_match: no name in the manifest');
  if (from.length === to.length && shape(from) === shape(to)) return mapped('ordinal', to[from.findIndex(value => value.id === functionId)]);
  tried.push(`ordinal: function structure of ${file} differs (${from.length} vs ${to.length} functions${from.length === to.length ? ', different nesting' : ''})`);
  return { status: 'unmapped', basis: 'unmapped', reason: tried.join('; '), file, tried };
}
