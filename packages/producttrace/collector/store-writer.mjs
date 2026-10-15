/**
 * The one writer of a Tracer store directory (G6). Append-only across runs;
 * each run is tagged with its manifest build id so before/after builds
 * coexist in one store. Layout (read by `collector/store.mjs` `loadStore`):
 *
 *   records.jsonl           runtime-evidence rows, each tagged tracer_run, tracer_build
 *   spans.jsonl             backend spans, each tagged tracer_run, tracer_build
 *   runs.jsonl              one producttrace.store-run.v1 row per closed run
 *   manifests/<build>.json  one attribution manifest per build, written once
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';

export const RUN_SCHEMA = 'producttrace.store-run.v1';
const BUILD_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

/** Deterministic build id: sha256 over the sorted manifest function ids. */
export function buildIdOf(manifest) {
  if (manifest && typeof manifest.build === 'string' && BUILD_ID.test(manifest.build)) return manifest.build;
  const ids = (manifest?.functions || []).map(row => row?.id).filter(id => typeof id === 'string').sort();
  return `b-${createHash('sha256').update(ids.join('\n')).digest('hex').slice(0, 16)}`;
}

/**
 * The manifest as stored. Dropped: build-machine `generated` paths, and the
 * runtime `index`, which is bundle-local (two builds of identical source can
 * number their functions differently) and so is not a property of the build id.
 * Rows join by `function_id`, never by index.
 */
export function storedManifest(manifest, build) {
  const { functions = [], ...rest } = manifest || {};
  return { ...rest, build, functions: functions.map(({ generated, index, ...row }) => row) };
}

const RESERVED = new Set(['async', 'function', 'if', 'for', 'while', 'switch', 'catch', 'return', 'new', 'await', 'typeof', 'yield', 'get', 'set', 'static']);
const IDENT = '[A-Za-z_$][\\w$]*';

/** Whitespace-normalised source text of a function (collapse runs, trim). */
export const normalizeFunctionText = text => String(text).replace(/\s+/gu, ' ').trim();

// A type annotation between a binding and its `=`: no top-level `,` `:` `(`
// `{` or newline (so it can never reach back across earlier object members or
// statements); generic arguments in `<…>` may contain commas.
const ANNOTATION = '(?:[^=;{}()<>,:\\n]|<[^=;{}()\\n]*>)+';

/**
 * Fallback only. Builds since 2026-09-24 record each function's name at build
 * time from the source's AST (manifest `name`, `name_kind`, `display_name`;
 * integrations/function-names.mjs), and readers use those. This text rule
 * names functions of older manifests that carry no `name_kind`; readers
 * report its result as `name_status: "inferred"`.
 *
 * The name a developer would use for the function at [start, end) in
 * `content`, or null (anonymous). Generic JS/TS syntax only, and only a name
 * that directly holds the function:
 *   - a declaration `function NAME` or a method `NAME(`;
 *   - the object property whose value is the function: `{ …, NAME: fn }`
 *     (the key must follow `{` or `,`, so a ternary `c ? a : fn` or an
 *     earlier member such as `{ required: true, onChange: fn }` never names it);
 *   - a variable, parameter default, field or member assignment `NAME = fn`,
 *     optionally with a type annotation `NAME: Type = fn`.
 * Anything else (a call argument, an array element, a JSX attribute) is null.
 */
export function functionNameAt(content, start, end) {
  const text = content.slice(start, end);
  const declared = new RegExp(`^\\s*(?:async\\s+)?function\\s*\\*?\\s*(${IDENT})`, 'u').exec(text);
  if (declared) return declared[1];
  const method = new RegExp(`^\\s*(?:(?:async|static|get|set)\\s+)*\\*?\\s*(${IDENT})\\s*\\(`, 'u').exec(text);
  if (method && !RESERVED.has(method[1])) return method[1];
  const before = content.slice(Math.max(0, start - 200), start);
  // Comments may sit between the previous member and the key; any identifier (get, set, …) is a valid key.
  const property = new RegExp(`[{,](?:\\s|//[^\\n]*\\n|/\\*(?:[^*]|\\*(?!/))*\\*/)*(${IDENT})\\s*:\\s*(?:async\\s*)?$`, 'u').exec(before);
  if (property) return property[1];
  const assigned = new RegExp(`(?<![\\w$])(${IDENT})\\s*(?::\\s*${ANNOTATION})?(?<![=!<>+\\-*/%&|^?:])=(?![=>])\\s*(?:async\\s*)?$`, 'u').exec(before);
  if (assigned && !RESERVED.has(assigned[1])) return assigned[1];
  return null;
}

/**
 * Add `text_sha256` (sha256 of the whitespace-normalised function text) and
 * `name` to manifest rows whose file can be read AND whose content hash
 * equals the hash in the function id (the checkout matches the build);
 * other rows are left unenriched rather than guessed.
 * @param {object} manifest
 * @param {(file: string) => string|null} readFile repository-relative path → content
 */
export function enrichManifest(manifest, readFile) {
  const cache = new Map();
  const load = file => {
    if (!cache.has(file)) { let content = null; try { content = readFile(file); } catch {} cache.set(file, content == null ? null : { content, hash: createHash('sha256').update(content).digest('hex') }); }
    return cache.get(file);
  };
  let enriched = 0;
  const functions = (manifest?.functions || []).map(row => {
    const match = /^function:([0-9a-f]{64}):(\d+):(\d+)$/u.exec(row?.id || '');
    const file = row?.source?.file ? load(row.source.file) : null;
    if (!match || !file || file.hash !== match[1]) return row;
    const start = Number(match[2]); const end = Number(match[3]);
    enriched += 1;
    const text_sha256 = createHash('sha256').update(normalizeFunctionText(file.content.slice(start, end))).digest('hex');
    // A build-time name (name_kind present) is the source's own; never overwrite it with the text rule.
    return Object.hasOwn(row, 'name_kind') ? { ...row, text_sha256 } : { ...row, text_sha256, name: functionNameAt(file.content, start, end) };
  });
  return { ...manifest, functions, enrichment: { rows: functions.length, enriched } };
}

const appendLines = (file, rows) => {
  if (!rows.length) return;
  fs.appendFileSync(file, rows.map(row => JSON.stringify(row)).join('\n') + '\n');
};

/**
 * Open a run in a store directory (created if needed).
 * @param {string} dir
 * @param {object} options
 * @param {object|null} options.manifest attribution manifest of the build being observed (null: build "unknown")
 * @param {string} [options.label]
 * @param {object} [options.source] e.g. { repository, commit, status_clean }
 * @param {string} [options.sourceRoot] checkout the build was made from; enables text/name remap keys
 */
export function openStoreWriter(dir, { manifest: rawManifest = null, label = null, source = null, sourceRoot = null, now = () => new Date() } = {}) {
  const manifest = rawManifest && sourceRoot
    ? enrichManifest(rawManifest, file => { const absolute = path.resolve(sourceRoot, file); return absolute.startsWith(path.resolve(sourceRoot) + path.sep) && fs.existsSync(absolute) ? fs.readFileSync(absolute, 'utf8') : null; })
    : rawManifest;
  const root = path.resolve(dir);
  fs.mkdirSync(path.join(root, 'manifests'), { recursive: true });
  const build = manifest ? buildIdOf(manifest) : 'unknown';
  if (!BUILD_ID.test(build)) throw new Error(`invalid build id ${JSON.stringify(build)}`);
  if (manifest) {
    const file = path.join(root, 'manifests', `${build}.json`);
    const stored = storedManifest(manifest, build);
    if (fs.existsSync(file)) {
      const existing = JSON.parse(fs.readFileSync(file, 'utf8'));
      const ids = value => JSON.stringify((value.functions || []).map(row => row.id).sort());
      if (ids(existing) !== ids(stored)) throw new Error(`store already has a different manifest for build ${build}; refusing to overwrite`);
    } else {
      fs.writeFileSync(file, JSON.stringify(stored));
    }
  }
  const started = now().toISOString();
  const runId = `run-${started.replace(/[-:.]/gu, '').replace('T', 't').replace('Z', 'z')}-${randomBytes(3).toString('hex')}`;
  const tag = row => ({ ...row, tracer_run: runId, tracer_build: build });
  let records = 0; let spans = 0; let closed = false;
  return {
    dir: root, run_id: runId, build,
    appendRecords(rows) { if (closed) throw new Error('run closed'); const list = [...rows].filter(row => row && typeof row === 'object'); appendLines(path.join(root, 'records.jsonl'), list.map(tag)); records += list.length; return list.length; },
    appendSpans(rows) { if (closed) throw new Error('run closed'); const list = [...rows].filter(row => row && typeof row === 'object'); appendLines(path.join(root, 'spans.jsonl'), list.map(tag)); spans += list.length; return list.length; },
    close({ steps = [], extra = {}, source: sourceOverride = undefined } = {}) {
      if (closed) return null; closed = true;
      const row = { schema: RUN_SCHEMA, run_id: runId, build, label, started, ended: now().toISOString(), source: sourceOverride ?? source,
        records, spans, manifest_functions: manifest ? (manifest.functions || []).length : null, steps, ...extra };
      appendLines(path.join(root, 'runs.jsonl'), [row]);
      return row;
    },
  };
}
