import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import MagicString from 'magic-string';
import { GREATEST_LOWER_BOUND, TraceMap, originalPositionFor, traceSegment } from '@jridgewell/trace-mapping';
import { encode as encodeMappings } from '@jridgewell/sourcemap-codec';
import { stableFunctionId } from '../analysis/runtime-attribution.mjs';
import { classAt, functionNamesAt } from './function-names.mjs';

const extensions = /\.[cm]?[jt]sx?$/u;

/**
 * Default first-party rule: a repository-relative JS/TS source is first-party
 * unless one of its path segments is node_modules, vendor, dist, build or .git.
 * Workspace packages consumed through their built `dist/` are therefore
 * excluded by default; add them with `firstParty.include`.
 */
export const DEFAULT_FIRST_PARTY_EXCLUDE = Object.freeze(['**/node_modules/**', '**/vendor/**', '**/dist/**', '**/build/**', '**/.git/**']);

function globRegExp(glob) {
  if (typeof glob !== 'string' || !glob) throw new TypeError('firstParty globs must be nonempty strings');
  let pattern = '';
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    if (char === '*' && glob[index + 1] === '*') {
      const before = index === 0 || glob[index - 1] === '/';
      const after = glob[index + 2] === '/';
      if (before && after) { pattern += '(?:.*/)?'; index += 2; }
      else if (before && index + 2 === glob.length) { pattern = pattern.replace(/\/$/u, '') + '(?:/.*)?'; index += 1; }
      else { pattern += '.*'; index += 1; }
    } else if (char === '*') pattern += '[^/]*';
    else if (char === '?') pattern += '[^/]';
    else pattern += char.replace(/[.+^${}()|[\]\\]/gu, '\\$&');
  }
  return new RegExp(`^${pattern}$`, 'u');
}

/**
 * First-party rule from `{ include, exclude }` repository-relative globs.
 * A file is first-party when it is inside the repository, is a JS/TS source,
 * and matches `include` or matches no `exclude` (default
 * DEFAULT_FIRST_PARTY_EXCLUDE). `excludedBy(relative)` names the rule that
 * excluded a file, or null.
 */
export function createFirstPartyRule({ include = [], exclude = DEFAULT_FIRST_PARTY_EXCLUDE } = {}) {
  if (!Array.isArray(include) || !Array.isArray(exclude)) throw new TypeError('firstParty.include and firstParty.exclude must be arrays of globs');
  const includes = include.map(glob => [glob, globRegExp(glob)]);
  const excludes = exclude.map(glob => [glob, globRegExp(glob)]);
  const excludedBy = relative => {
    if (!relative || relative === '..' || relative.startsWith('../') || path.isAbsolute(relative)) return 'outside repository';
    if (!extensions.test(relative)) return 'not a JS/TS source';
    if (includes.some(([, pattern]) => pattern.test(relative))) return null;
    return excludes.find(([, pattern]) => pattern.test(relative))?.[0] || null;
  };
  return { include: [...include], exclude: [...exclude], excludedBy, isFirstParty: relative => excludedBy(relative) === null };
}

const defaultFirstPartyRule = createFirstPartyRule();

function lineColumn(source, offset) {
  const before = source.slice(0, Math.max(0, offset));
  const lines = before.split('\n');
  return { line: lines.length, column: lines.at(-1).length };
}

function offsetAt(source, line, column) {
  if (!Number.isInteger(line) || line < 1 || !Number.isInteger(column) || column < 0) return null;
  const lines = source.split('\n');
  if (line > lines.length) return null;
  return lines.slice(0, line - 1).reduce((n, row) => n + row.length + 1, 0) + column;
}

function functionLike(node) {
  return ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)
    || ts.isMethodDeclaration(node) || ts.isGetAccessor(node) || ts.isSetAccessor(node)
    || ts.isConstructorDeclaration(node);
}

function sourceFileForMap(map, id, repository, sourceName, sourceContent) {
  const sources = Array.isArray(map?.sources) ? map.sources : [];
  const sourceContents = Array.isArray(map?.sourcesContent) ? map.sourcesContent : [];
  const first = sources.findIndex((source, index) => source === sourceName || source.endsWith(`/${sourceName}`));
  const candidate = first >= 0 ? sources[first] : sourceName;
  const mappedAbsolute = path.resolve(path.dirname(id), map?.sourceRoot || '', candidate || '');
  if (mappedAbsolute.startsWith(`${repository}${path.sep}`) && fs.existsSync(mappedAbsolute)) {
    return { file: path.relative(repository, mappedAbsolute).split(path.sep).join('/'), content: sourceContent || sourceContents[first] || fs.readFileSync(mappedAbsolute, 'utf8') };
  }
  const absolute = path.resolve(id);
  if (absolute.startsWith(`${repository}${path.sep}`) && fs.existsSync(absolute)) {
    return { file: path.relative(repository, absolute).split(path.sep).join('/'), content: fs.readFileSync(absolute, 'utf8') };
  }
  return null;
}

// Diagnostic only: PRODUCTTRACE_SPAN_DEBUG=<file> (and optional
// PRODUCTTRACE_SPAN_DEBUG_FILES=<regex>) appends every span resolution for
// matching original files, to explain boundary-rule abstentions.
const spanDebug = process.env.PRODUCTTRACE_SPAN_DEBUG ? { file: process.env.PRODUCTTRACE_SPAN_DEBUG, pattern: new RegExp(process.env.PRODUCTTRACE_SPAN_DEBUG_FILES || '.') } : null;
function originalSpan({ map, code, id, repository, start, end, depth = 0 }) {
  const startLC = lineColumn(code, start);
  const endLC = lineColumn(code, Math.max(start, end - 1));
  const trace = map && new TraceMap(map, id);
  if (!trace) return null;
  const mappedStart = originalPositionFor(trace, { line: startLC.line, column: startLC.column });
  const mappedEnd = originalPositionFor(trace, { line: endLC.line, column: endLC.column, bias: GREATEST_LOWER_BOUND });
  if (!mappedStart.source || !mappedStart.line || !mappedEnd.line) return null;
  const sourceIndex = (map.sources || []).findIndex(source => {
    const resolved = path.resolve(path.dirname(id), map.sourceRoot || '', source);
    return resolved === path.resolve(path.dirname(id), map.sourceRoot || '', mappedStart.source)
      || source === mappedStart.source;
  });
  const content = sourceIndex >= 0 && map.sourcesContent?.[sourceIndex];
  const sourceFile = sourceFileForMap(map, id, repository, mappedStart.source, content);
  if (!sourceFile && typeof content !== 'string') return null;
  const original = content || sourceFile.content;
  const originalFile = sourceFile?.file || path.relative(repository, mappedStart.source).split(path.sep).join('/');
  const originalStart = offsetAt(original, mappedStart.line, mappedStart.column);
  const originalEnd = offsetAt(original, mappedEnd.line, mappedEnd.column + 1) ?? originalStart;
  if (originalStart == null || originalEnd == null) return null;
  const mappedEndOffset = Math.max(originalStart, originalEnd);
  // Workspace packages are commonly consumed from their compiled dist entry.
  // Vite's final map can stop at that entry even though it has its own map back
  // to the package source. Follow that map so package handlers share exactly
  // the same original-file content hash and span as the static analyzer.
  if (depth < 3 && sourceFile?.file) {
    const intermediate = path.resolve(repository, sourceFile.file);
    const nestedMapPath = `${intermediate}.map`;
    if (fs.existsSync(nestedMapPath)) {
      try {
        const nested = originalSpan({ map: JSON.parse(fs.readFileSync(nestedMapPath, 'utf8')), code: original, id: intermediate, repository, start: originalStart, end: mappedEndOffset, depth: depth + 1 });
        if (nested) return nested;
      } catch {
        // A malformed secondary source map is a registration gap, not a reason
        // to discard the valid first-level attribution below.
      }
    }
  }
  const exact = exactOriginalFunctionBoundary(originalFile, original, originalStart, mappedEndOffset);
  if (spanDebug && spanDebug.pattern.test(originalFile)) {
    try { fs.appendFileSync(spanDebug.file, `${JSON.stringify({ depth, id: path.relative(repository, id), file: originalFile, start: originalStart, end: mappedEndOffset,
      head: original.slice(originalStart, originalStart + 60), tail: original.slice(Math.max(originalStart, mappedEndOffset - 30), mappedEndOffset), exact: exact ? [exact.start, exact.end] : null })}\n`); } catch {}
  }
  // No original function at this position: the generated function is
  // bundler/compiler synthesized (dynamic-import preload thunks, enum IIFEs).
  // Abstain rather than register an id for a span that is not a function.
  if (!exact) return null;
  return { file: originalFile, content: original, start: exact.start, end: exact.end };
}

function generatedMapFromContext(context) {
  try {
    const map = context.getCombinedSourcemap?.();
    if (!map || !Array.isArray(map.sources)) return null;
    return map;
  } catch {
    return null;
  }
}

function hasFirstPartySource(map, id, repository, rule = defaultFirstPartyRule) {
  return Array.isArray(map?.sources) && map.sources.some(source => {
    const resolved = path.resolve(path.dirname(id), map.sourceRoot || '', source);
    const relative = path.relative(repository, resolved).split(path.sep).join('/');
    return rule.isFirstParty(relative) && fs.existsSync(resolved);
  });
}

// A bundled chunk commonly mixes first-party modules with dependencies whose
// own sources also live under the repository (node_modules/...). Only
// functions whose original source is first-party are instrumented; a library
// frame must never become an action's depth-zero entry handler. This is the
// same rule the module-level transform applies to module ids.
function firstPartySpan(span, rule = defaultFirstPartyRule, onExcluded = null) {
  if (!span?.file) return null;
  const reason = rule.excludedBy(span.file);
  if (reason === null) return span;
  onExcluded?.(reason, `${span.file}:${span.start}:${span.end}`);
  return null;
}

const originalFunctionBoundaries = new Map();

function exactOriginalFunctionBoundary(file, content, start, end) {
  const cacheKey = `${file}\0${content.length}\0${content.slice(0, 64)}`;
  let boundaries = originalFunctionBoundaries.get(cacheKey);
  if (!boundaries) {
    const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true,
      /\.tsx$/u.test(file) ? ts.ScriptKind.TSX : /\.[cm]?ts$/u.test(file) ? ts.ScriptKind.TS : /\.jsx?$/u.test(file) ? ts.ScriptKind.JSX : ts.ScriptKind.JS);
    boundaries = [];
    const visit = node => {
      // `head` is where a map may point for a function whose generated code
      // dropped its type parameters (`<T,>(x: T) => …` becomes `(x) => …`).
      if (functionLike(node) && node.body) boundaries.push({ start: node.getStart(source), end: node.getEnd(),
        head: node.typeParameters ? node.typeParameters.end + 1 : node.getStart(source) });
      ts.forEachChild(node, visit);
    };
    visit(source);
    originalFunctionBoundaries.set(cacheKey, boundaries);
  }
  // Source maps often point one character into an arrow function (after an
  // opening parenthesis or async token). Prefer the original function that
  // contains that mapped start and ends at the mapped end before considering
  // functions wholly inside the generated range.
  const containingExactEnd = boundaries.filter(boundary => boundary.start <= start && start - boundary.start <= 8 && boundary.end === end);
  if (containingExactEnd.length) {
    containingExactEnd.sort((a, b) => b.start - a.start || (a.end - a.start) - (b.end - b.start));
    return containingExactEnd[0];
  }
  const candidates = boundaries.filter(boundary => boundary.start >= start && boundary.end <= end);
  const exactEnd = candidates.filter(boundary => boundary.end === end);
  if (exactEnd.length) {
    exactEnd.sort((a, b) => b.start - a.start || (a.end - a.start) - (b.end - b.start));
    return exactEnd[0];
  }
  // Minified output maps a function's last generated token (often a renamed
  // identifier or a JSX closing tag) to a position before the original
  // function's end. When the mapped start is at (or just inside) an original
  // function's start and that function contains the mapped end, it is the
  // function: take the innermost such boundary. This must precede the
  // wholly-inside fallback, which would otherwise pick a nested function.
  // A function that is the argument, property value, JSX attribute value or
  // JSX child of the token the map starts on (`setOpen((prev) => !prev)`,
  // `retryDelay: () => …`, `onClick={() => …}`, `index}>\n  {(…) => (`) and
  // that contains the mapped end is that function: only a (dotted) name and a
  // separator `(` / `:` / `={` / `}>{` lie between the mapped start and it.
  // Checked before the enclosing-function rule below, which would otherwise
  // take the enclosing function whose start is a few characters earlier.
  // The map can also start a variable- or default-initializer arrow on the
  // binding name (`const lookupOwn = <T>(…) => …` maps to `lookupOwn`): a
  // plain `=` separator is accepted too.
  const valueOfToken = boundary => /^[\w$.-]*\s*(?:\}\s*)?(?:\/?>\s*)?(?::|=\s*\{|=|\{|\()\s*$/u.test(content.slice(start, boundary.start));
  const tokenValue = boundaries.filter(boundary => boundary.start > start && boundary.end >= end && valueOfToken(boundary));
  if (tokenValue.length) {
    tokenValue.sort((a, b) => (a.end - a.start) - (b.end - b.start));
    return tokenValue[0];
  }
  const nearStart = boundary => boundary.start <= start && (start - boundary.start <= 8 || (start >= boundary.head && start - boundary.head <= 8));
  const containing = boundaries.filter(boundary => nearStart(boundary) && boundary.end >= end - 2);
  if (containing.length) {
    containing.sort((a, b) => (a.end - a.start) - (b.end - b.start));
    return containing[0];
  }
  // A map can put a callback's first generated token on the call it is an
  // argument of (`map(` before `(line, i) => ({…})`) and its last token just
  // before the callback's end. The exact function that starts a few characters
  // after the mapped start and contains the mapped end is that callback: take
  // the innermost such boundary. The enclosing function is only a fallback
  // when no such exact boundary exists.
  // The same holds when the map puts the first token on the property or JSX
  // attribute the callback is the value of (`retryDelay: () => …`,
  // `onClick={() => …}`), or on the end of the opening tag whose child
  // expression it is (`rowIndex={index}>\n  {({ registerChild }) => (`): only
  // a name, the tag's closing `}>` and the opening `:` / `={` / `{` separate them.
  const keyThenValue = boundary => /^[\w$-]*\s*(?:\}\s*)?(?:\/?>\s*)?(?::|=\s*\{|\{)\s*$/u.test(content.slice(start, boundary.start));
  const justAfterStart = boundaries.filter(boundary => boundary.start >= start
    && (boundary.start - start <= 8 || keyThenValue(boundary)) && boundary.end >= end);
  if (justAfterStart.length) {
    justAfterStart.sort((a, b) => (a.end - a.start) - (b.end - b.start));
    return justAfterStart[0];
  }
  candidates.sort((a, b) => Math.abs(a.end - end) - Math.abs(b.end - end)
    || Math.abs(a.start - start) - Math.abs(b.start - start)
    || (a.end - a.start) - (b.end - b.start));
  return candidates[0] || null;
}

function hasNestedFunction(node) {
  let found = false;
  const visit = child => {
    if (found) return;
    if (functionLike(child)) { found = true; return; }
    ts.forEachChild(child, visit);
  };
  ts.forEachChild(node, visit);
  return found;
}

function isEntryCallback(node) {
  const parent = node.parent;
  if (parent && ts.isCallExpression(parent) && parent.arguments.some(argument => argument === node)) return true;
  if (parent && ts.isPropertyAssignment(parent)) {
    const name = parent.name && (ts.isIdentifier(parent.name) || ts.isStringLiteral(parent.name)) ? parent.name.text : '';
    return /^on[A-Z]/u.test(name);
  }
  return false;
}

// Instrumentation sites a previous (module) pass left in the code, recognized
// on the AST in raw and minifier-down-leveled forms:
//   enter:  <rt>.enter(N, {entry_hint: …})  /  (m=rt)==null?void 0:m.enter(N,{entry_hint:!1})
//   tag:    <rt>.tag(fn, N, flag, flag)      /  x.call(rt, fn, N, !0, !1)
// N may be printed in exponent form (4000 -> 4e3). Only these exact shapes
// count; a bare text match on `,N,!0,!1)` is not a site.
// Build-time name fields a manifest row carries (integrations/function-names.mjs).
const NAME_FIELDS = ['name', 'name_kind', 'display_name', 'export_names', 'via', 'bound_to', 'accessor', 'static'];
const nameFields = row => Object.fromEntries(NAME_FIELDS.filter(key => row && Object.hasOwn(row, key)).map(key => [key, row[key]]));

const unwrapParens = node => { while (node && ts.isParenthesizedExpression(node)) node = node.expression; return node; };
const siteCallee = callee => {
  callee = unwrapParens(callee);
  if (callee && ts.isPropertyAccessExpression(callee)) return callee.name.text;
  if (callee && ts.isConditionalExpression(callee)) return siteCallee(callee.whenFalse);
  return null;
};
const siteFlag = node => Boolean(node) && (node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword
  || (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken && ts.isNumericLiteral(node.operand)));
const hasEntryHint = node => { node = unwrapParens(node); return Boolean(node) && ts.isObjectLiteralExpression(node)
  && node.properties.some(property => property.name && ts.isIdentifier(property.name) && property.name.text === 'entry_hint'); };
function enterSiteIndex(node) {
  if (!ts.isCallExpression(node)) return null;
  const [first, second] = node.arguments;
  return siteCallee(node.expression) === 'enter' && node.arguments.length === 2 && ts.isNumericLiteral(first) && hasEntryHint(second)
    ? Number(first.text) : null;
}
function tagSite(node) {
  if (!ts.isCallExpression(node)) return null;
  const callee = siteCallee(node.expression);
  const args = callee === 'call' ? node.arguments.slice(1) : callee === 'tag' ? [...node.arguments] : null;
  if (!args || args.length !== 4 || !ts.isNumericLiteral(args[1]) || !siteFlag(args[2]) || !siteFlag(args[3])) return null;
  return { fn: args[0], index: Number(args[1].text) };
}
function embeddedSiteIndexes(source) {
  const indexes = new Set();
  const visit = node => {
    const enter = enterSiteIndex(node); if (enter !== null) indexes.add(enter);
    const tag = tagSite(node); if (tag) indexes.add(tag.index);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return indexes;
}

// ---- G3 JSX placements ---------------------------------------------------
// A placement is one JSX element occurrence in first-party original source,
// identified like functions: file content hash + original start:end span.
const ELEMENT_FACTORIES = new Set(['jsx', 'jsxs', 'jsxDEV', '_jsx', '_jsxs', '_jsxDEV', 'createElement']);
const jsxIndexCache = new Map();

function elementFactoryCallee(expression) {
  let callee = expression;
  while (ts.isParenthesizedExpression(callee)) callee = callee.expression;
  // `(0, runtime.jsx)(...)` interop form.
  if (ts.isBinaryExpression(callee) && callee.operatorToken.kind === ts.SyntaxKind.CommaToken) callee = callee.right;
  if (ts.isIdentifier(callee)) return ELEMENT_FACTORIES.has(callee.text) ? callee.text : null;
  if (ts.isPropertyAccessExpression(callee)) return ELEMENT_FACTORIES.has(callee.name.text) ? callee.name.text : null;
  return null;
}

function enclosingName(node) {
  for (let cursor = node.parent; cursor; cursor = cursor.parent) {
    if ((ts.isFunctionDeclaration(cursor) || ts.isClassDeclaration(cursor)) && cursor.name) return cursor.name.text;
    if ((ts.isFunctionExpression(cursor) || ts.isArrowFunction(cursor) || ts.isClassExpression(cursor)) && cursor.parent) {
      const parent = cursor.parent;
      if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
      if (ts.isPropertyAssignment(parent) && (ts.isIdentifier(parent.name) || ts.isStringLiteral(parent.name))) return parent.name.text;
      // forwardRef(function X() {}) / memo(() => ...) assigned to a variable
      if (ts.isCallExpression(parent) && ts.isVariableDeclaration(parent.parent) && ts.isIdentifier(parent.parent.name)) return parent.parent.name.text;
    }
    if (ts.isMethodDeclaration(cursor) && cursor.name && ts.isIdentifier(cursor.name)) {
      const owner = cursor.parent && ts.isClassLike(cursor.parent) && cursor.parent.name ? cursor.parent.name.text : null;
      return owner || cursor.name.text;
    }
  }
  return null;
}

function jsxElementsOf(file, content) {
  const kind = /\.tsx$/u.test(file) ? ts.ScriptKind.TSX : /\.ts$/u.test(file) ? ts.ScriptKind.TS : ts.ScriptKind.JSX;
  const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, kind);
  const elements = [];
  const visit = node => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const opening = ts.isJsxElement(node) ? node.openingElement : node;
      const tag = opening.tagName.getText(source);
      if (tag && tag !== 'Fragment' && !tag.endsWith('.Fragment')) {
        const start = node.getStart(source);
        const isComponent = /^[A-Z_$]/u.test(tag) || tag.includes('.');
        elements.push({ start, end: node.getEnd(), line: source.getLineAndCharacterOfPosition(start).line + 1, tag,
          component: isComponent ? tag : enclosingName(node), component_element: isComponent });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return elements;
}

/**
 * Map a position in the content a sourcemap points at -> the JSX placement in
 * the file on disk. Placements are always identified against the file on
 * disk (the true original). When an earlier pre-transform changed the text
 * the map points at (e.g. inserted source attributes), elements are paired
 * in document order and every pair must agree on tag and line; any
 * disagreement abstains for the whole file.
 */
function jsxPlacementIndex(file, mappedContent, repository = null) {
  let disk = null;
  if (repository) { try { disk = fs.readFileSync(path.resolve(repository, file), 'utf8'); } catch {} }
  const content = disk ?? mappedContent;
  const cacheKey = `${file}\0${createHash('sha256').update(mappedContent).digest('hex')}\0${disk === null ? '' : createHash('sha256').update(disk).digest('hex')}`;
  if (jsxIndexCache.has(cacheKey)) return jsxIndexCache.get(cacheKey);
  const hash = createHash('sha256').update(content).digest('hex');
  const originals = jsxElementsOf(file, content);
  const located = content === mappedContent ? originals : jsxElementsOf(file, mappedContent);
  const byStart = new Map();
  let paired = located.length === originals.length
    && located.every((element, i) => element.tag === originals[i].tag && element.line === originals[i].line);
  if (paired) located.forEach((element, i) => {
    const original = originals[i];
    byStart.set(element.start, { id: `placement:${hash}:${original.start}:${original.end}`, hash, file, ...original });
  });
  const index = { hash, byStart, paired, rewritten: content !== mappedContent };
  jsxIndexCache.set(cacheKey, index);
  return index;
}

/** Map one generated offset to its original file offset, following nested package maps. */
function originalPoint({ map, code, id, repository, offset, depth = 0, firstParty = defaultFirstPartyRule }) {
  if (!map || !Array.isArray(map.sources)) return null;
  const at = lineColumn(code, offset);
  let mapped;
  try { mapped = originalPositionFor(new TraceMap(map, id), { line: at.line, column: at.column }); } catch { return null; }
  if (!mapped.source || !mapped.line || mapped.column == null) return null;
  const sourceIndex = (map.sources || []).findIndex(source => source === mapped.source
    || path.resolve(path.dirname(id), map.sourceRoot || '', source) === path.resolve(path.dirname(id), map.sourceRoot || '', mapped.source));
  const content = sourceIndex >= 0 ? map.sourcesContent?.[sourceIndex] : undefined;
  const sourceFile = sourceFileForMap(map, id, repository, mapped.source, content);
  if (!sourceFile) return null;
  const original = typeof content === 'string' ? content : sourceFile.content;
  const originalOffset = offsetAt(original, mapped.line, mapped.column);
  if (originalOffset == null) return null;
  if (depth < 3) {
    const intermediate = path.resolve(repository, sourceFile.file);
    const nestedMapPath = `${intermediate}.map`;
    if (fs.existsSync(nestedMapPath)) {
      try {
        const nested = originalPoint({ map: JSON.parse(fs.readFileSync(nestedMapPath, 'utf8')), code: original, id: intermediate, repository, offset: originalOffset, depth: depth + 1, firstParty });
        if (nested) return nested;
      } catch {}
    }
  }
  if (!firstParty.isFirstParty(sourceFile.file)) return null;
  return { file: sourceFile.file, content: original, offset: originalOffset };
}

/** Exact placement for an element-factory call, or null (abstain). */
function placementForCall(node, source, { map, code, id, repository, firstParty = defaultFirstPartyRule }) {
  if (!ts.isCallExpression(node) || !elementFactoryCallee(node.expression)) return null;
  const point = originalPoint({ map, code, id, repository, offset: node.getStart(source), firstParty });
  if (!point) return null;
  return jsxPlacementIndex(point.file, point.content, repository).byStart.get(point.offset) || null;
}

// Reject signal (outcome labels): the frame records that its body threw (the
// error's constructor name only) and the error is rethrown unchanged, so the
// app's own try/catch, error boundaries and rejections behave as before.
// The first argument, when the function's first parameter is a plain
// identifier, is passed to enter() as `a0` (read, never stored or emitted):
// for a React handler it is the SyntheticEvent, whose `_reactName` and
// `currentTarget` say which prop and host React is invoking (D-G1-22).
const firstArgMeta = node => { const parameter = node?.parameters?.[0]; return parameter && !parameter.dotDotDotToken && ts.isIdentifier(parameter.name) ? `,a0:${parameter.name.text}` : ''; };
const THREW_CATCH = name => `catch(__ptErr){globalThis.__productTraceRuntime?.threw?.(${name},__ptErr);throw __ptErr;}`;

function instrumentPostTransformedSource(code, id, { repository, map, indexForId = idValue => idValue, register = true, instrument = true, instrumentLeafOnly = false, prefix = null, composeWith = null, moduleRows = null, firstParty = defaultFirstPartyRule, onExcluded = null, indexForPlacement = null, awaitContinuations = false, placementFallback = '__ptIdentity', framePass = null, registerClasses = false }) {
  // The chunk pass frames leaf bodies the module pass may already have framed; its
  // enter says so (`pass: "chunk"`) so a reader can count one call, not two.
  const passMeta = framePass ? `,pass:${JSON.stringify(framePass)}` : '';
  // This parser is intentionally JS-only. Vite/esbuild has already removed TS syntax.
  const source = ts.createSourceFile(id, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const functions = [];
  const placements = [];
  const classes = [];
  const edits = [];
  // G3/G1 edits (placement wrappers, await continuations) are computed from
  // the unedited `code` and never feed an id: every function id is resolved
  // before any edit is applied, so these edits are span-neutral by
  // construction. `nested` edits inside an overwritten leaf concise-arrow body
  // are folded into that overwrite's text.
  const functionStack = [];
  const firstPartyFunctions = new Set();
  const awaitFunctions = new Set();
  const nested = (index, content, rank, depth) => ({ kind: 'insert', index, content, rank, depth, nested: true });
  const functionIndexByNode = new Map();
  const placementCalls = [];
  let depth = 0;
  let frame = 0;
  let functionDepth = 0;
  // Identity for a function the module pass already instrumented is the index
  // that pass embedded in the code, not a fresh source-map lookup: bundler
  // rewrites (and the module pass's own unmapped insertions) can make the
  // chunk map land on a nested function, which would give this function the
  // nested function's id.
  const embeddedRow = node => {
    if (!moduleRows) return null;
    // Registered in place: the function is the `fn` argument of a tag site.
    let child = node; let parent = node.parent;
    while (parent && ts.isParenthesizedExpression(parent)) { child = parent; parent = parent.parent; }
    const tag = parent && tagSite(parent);
    if (tag && unwrapParens(tag.fn) === unwrapParens(child)) { const row = moduleRows.get(tag.index); if (row) return row; }
    // Framed body: the module pass puts its enter site in the first statement
    // (a declaration); look only there, and never inside nested functions.
    if (node.body && ts.isBlock(node.body)) {
      let found = null;
      const visit = child => { if (found !== null || functionLike(child)) return; const index = enterSiteIndex(child); if (index !== null) { found = index; return; } ts.forEachChild(child, visit); };
      for (const statement of node.body.statements.slice(0, 2)) visit(statement);
      if (found !== null) { const row = moduleRows.get(found); if (row) return row; }
    }
    return null;
  };
  // A function the module pass already wrapped as `tag((fn), N, proxy, hint)`
  // sits inside that wrapper at the chunk pass, so its own syntactic position
  // (e.g. a callback argument) is hidden behind the wrapper call. Keep the hint
  // the module pass computed from the real position.
  const embeddedEntryHint = node => {
    let child = node; let parent = node.parent;
    while (parent && ts.isParenthesizedExpression(parent)) { child = parent; parent = parent.parent; }
    const tag = parent && tagSite(parent);
    if (!tag || unwrapParens(tag.fn) !== unwrapParens(child)) return null;
    const hint = parent.arguments[parent.arguments.length - 1];
    if (hint.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (hint.kind === ts.SyntaxKind.FalseKeyword) return false;
    return ts.isPrefixUnaryExpression(hint) && ts.isNumericLiteral(hint.operand) ? hint.operand.text === '0' : null;
  };
  const resolveFunction = (node, start, end) => {
    const row = embeddedRow(node);
    if (row) return { id: row.id, file: row.source.file, start: row.source.start, end: row.source.end, names: nameFields(row) };
    const span = firstPartySpan(originalSpan({ map, code, id, repository, start, end }), firstParty, onExcluded);
    return span ? { id: stableFunctionId(span.content, span.start, span.end), file: span.file, start: span.start, end: span.end,
      names: functionNamesAt(span.file, span.content, span.start, span.end) } : null;
  };
  // Error types (and any class): a first-party class bound to a name is
  // registered by its original span's id right after its definition, so the
  // runtime can say which instrumented class a thrown object was constructed
  // by (the class object is compared by identity; its runtime name may be
  // minified). The manifest's `classes` rows carry the source name.
  const classBinding = node => {
    if (ts.isClassDeclaration(node) && node.name) return { name: node.name.text, after: node.getEnd() };
    if (!ts.isClassExpression(node)) return null;
    let child = node; let parent = node.parent;
    while (parent && ts.isParenthesizedExpression(parent)) { child = parent; parent = parent.parent; }
    if (!parent || !ts.isVariableDeclaration(parent) || parent.initializer !== child || !ts.isIdentifier(parent.name)) return null;
    const statement = parent.parent?.parent;
    return statement && ts.isVariableStatement(statement) ? { name: parent.name.text, after: statement.getEnd() } : null;
  };
  const visit = node => {
    if (registerClasses && (ts.isClassDeclaration(node) || ts.isClassExpression(node))) {
      const binding = classBinding(node);
      const point = binding && originalPoint({ map, code, id, repository, offset: node.getStart(source), firstParty });
      const original = point && classAt(point.file, point.content, point.offset);
      if (original) {
        const classId = stableFunctionId(point.content, original.start, original.end);
        classes.push({ id: classId, kind: 'class', name: original.name, name_kind: original.name_kind, display_name: original.name || '<anonymous class>',
          ...(original.export_names.length ? { export_names: original.export_names } : {}), extends: original.extends, source: { file: point.file, start: original.start, end: original.end } });
        edits.push({ kind: 'insert', index: binding.after, after: true, content: `;globalThis.__productTraceRuntime?.registerClass?.(${binding.name},${JSON.stringify(classId)});` });
      }
    }
    // G3: remember which JSX site produced each element's props. The wrapper
    // returns the element unchanged (identity fallback when the runtime is absent).
    if (indexForPlacement && ts.isCallExpression(node) && !insidePlacementWrapper(node)) {
      const placement = placementForCall(node, source, { map, code, id, repository, firstParty });
      if (placement) {
        const index = indexForPlacement(placement);
        placements.push({ ...placement, index });
        placementCalls.push({ node, row: placements[placements.length - 1] });
        edits.push(nested(node.getStart(source), ` (globalThis.__productTracePlace||${placementFallback})(`, 1, depth));
        edits.push(nested(node.getEnd(), `,${index})`, -1, depth));
      }
    }
    // G1: carry the continuation across native `await` resumptions in
    // first-party async functions. The frame current at the await is restored
    // when the function resumes and the resumption's ambient is restored when
    // it suspends again or settles. Async generators and `for await` are not
    // rewritten (explicit frontier). Opens carry a leading space so an operand
    // written without whitespace (`await(x)`) keeps the keyword separate.
    if (awaitContinuations && ts.isAwaitExpression(node)) {
      const owner = functionStack[functionStack.length - 1];
      // 'all' also carries continuations through library async functions
      // (context only: no frames, ids or handler credit for library code).
      if (owner && isPlainAsync(owner) && (awaitContinuations === 'all' || firstPartyFunctions.has(owner))) {
        awaitFunctions.add(owner);
        const operand = node.expression;
        edits.push(nested(node.getStart(source), ' __ptAwR(__ptAw=__ptAwS(__ptAw),', 1, depth));
        edits.push(nested(operand.getStart(source), ' __ptAwL(__ptAw,', 1, depth + 0.5));
        edits.push(nested(operand.getEnd(), ')', -1, depth + 0.5));
        edits.push(nested(node.getEnd(), ')', -1, depth));
      }
    }
    if (functionLike(node) && node.body) {
      // Module transforms only register concise arrows. At the authoritative
      // emitted-chunk boundary, however, a leaf concise arrow has no nested
      // function edits to overlap, so frame its exact expression. This keeps
      // O(actions) capture complete for the common inline React-handler form
      // without changing the function object returned by tag().
      if (ts.isArrowFunction(node) && !ts.isBlock(node.body)) {
        const generatedStart = node.getStart(source);
        const generatedEnd = node.getEnd();
        const span = resolveFunction(node, generatedStart, generatedEnd);
        if (span) {
          firstPartyFunctions.add(node);
          const idValue = span.id;
          const index = indexForId(idValue);
          functionIndexByNode.set(node, index);
          functions.push({ id: idValue, index, kind: 'function', source: { file: span.file, start: span.start, end: span.end }, ...span.names, generated: { file: id, start: generatedStart, end: generatedEnd } });
          // The module pass is registration-only. The emitted-chunk leaf pass
          // may additionally frame the exact expression below.
          const proxyEntry = Boolean(instrument && instrumentLeafOnly && hasNestedFunction(node));
          const entryHint = embeddedEntryHint(node) ?? isEntryCallback(node);
          if (register) {
            edits.push({ kind: 'insert', index: generatedStart, content: ' globalThis.__productTraceRuntime?.tag?.((' });
            edits.push({ kind: 'insert', index: generatedEnd, after: true, content: `),${index},${proxyEntry},${entryHint})` });
          }
          if (instrument && instrumentLeafOnly && !proxyEntry) {
            const name = `__ptFrame${frame++}`;
            const bodyStart = node.body.getStart(source);
            const bodyEnd = node.body.getEnd();
            const asyncPrefix = node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword) ? 'async ' : '';
            // The expression text is assembled after the traversal so nested
            // placement/await edits inside the body are kept.
            edits.push({ kind: 'overwrite', start: bodyStart, end: bodyEnd, fn: node,
              render: (expression, awaits) => `(${asyncPrefix}()=>{${awaits ? 'var __ptAw=__ptAwB();try{' : ''}const ${name}=globalThis.__productTraceRuntime?.enter(${index},{entry_hint:${entryHint}${passMeta}${firstArgMeta(node)}});try{return (${expression});}${THREW_CATCH(name)}finally{globalThis.__productTraceRuntime?.exit(${name});}${awaits ? '}finally{__ptAwE(__ptAw);}' : ''}})()` });
          }
        }
        functionStack.push(node); depth += 1;
        ts.forEachChild(node, visit);
        functionStack.pop(); depth -= 1;
        return;
      }
      const generatedStart = node.getStart(source);
      const generatedEnd = node.getEnd();
      const span = resolveFunction(node, generatedStart, generatedEnd);
      if (span) {
        firstPartyFunctions.add(node);
        const idValue = span.id;
        const index = indexForId(idValue);
        functionIndexByNode.set(node, index);
        const functionRecord = { id: idValue, index, kind: 'function', source: { file: span.file, start: span.start, end: span.end }, ...span.names, generated: { file: id, start: generatedStart, end: generatedEnd } };
        functions.push(functionRecord);
        const name = `__ptFrame${frame++}`;
        const proxyEntry = Boolean(instrument && instrumentLeafOnly && hasNestedFunction(node));
        const entryHint = embeddedEntryHint(node) ?? isEntryCallback(node);
        if (instrument && ts.isBlock(node.body) && !proxyEntry) {
          const open = node.body.getStart(source) + 1;
          const close = node.body.getEnd() - 1;
          edits.push({ kind: 'insert', index: open, content: `\nconst ${name}=globalThis.__productTraceRuntime?.enter(${index},{entry_hint:${entryHint}${passMeta}${firstArgMeta(node)}});try {` });
          edits.push({ kind: 'insert', index: close, content: `}${THREW_CATCH(name)} finally {globalThis.__productTraceRuntime?.exit(${name});}` });
        } else if (instrument && ts.isArrowFunction(node) && !ts.isBlock(node.body)) {
          const start = node.body.getStart(source);
          const end = node.body.getEnd();
          const expression = code.slice(start, end);
          edits.push({ kind: 'overwrite', start, end, content: `(()=>{const ${name}=globalThis.__productTraceRuntime?.enter(${index},{entry_hint:${entryHint}${passMeta}${firstArgMeta(node)}});try{return (${expression});}${THREW_CATCH(name)}finally{globalThis.__productTraceRuntime?.exit(${name});}})()` });
        }
        if (register && (ts.isFunctionExpression(node) || ts.isArrowFunction(node))) {
          edits.push({ kind: 'insert', index: generatedStart, content: ' globalThis.__productTraceRuntime?.tag?.((' });
          edits.push({ kind: 'insert', index: generatedEnd, after: true, content: `),${index},${proxyEntry},${entryHint})` });
        }
        if (register && ts.isFunctionDeclaration(node) && node.name) {
          edits.push({ kind: 'insert', index: generatedEnd, after: true,
            content: `;globalThis.__productTraceRuntime?.registerFunction?.(${node.name.text},${index});` });
        }
        // Register the actual handler object at definition time. Declarations
        // can be registered after their declaration without changing identity;
        // expressions/arrows are tagged in-place so JSX props and closures keep
        // their original object while becoming discoverable through the runtime
        // WeakMap.
      }
    }
    const entersFunction = functionLike(node) && Boolean(node.body);
    if (entersFunction) { functionDepth += 1; functionStack.push(node); }
    depth += 1;
    ts.forEachChild(node, visit);
    depth -= 1;
    if (entersFunction) { functionDepth -= 1; functionStack.pop(); }
  };
  visit(source);
  // Handler binding per placement: the first-party functions written inside
  // each on* prop of the element (e.g. the callback in
  // onSubmit={handleSubmit((data) => save(data))}). The runtime adds the prop
  // values themselves; together they say which functions are bound to the
  // element, which the entry-handler credit uses to tell a bound handler from
  // a global listener.
  for (const { node, row } of placementCalls) {
    const props = node.arguments[1];
    if (!props || !ts.isObjectLiteralExpression(props)) continue;
    const bound = {};
    for (const property of props.properties) {
      if (!ts.isPropertyAssignment(property)) continue;
      const name = ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) ? property.name.text : null;
      if (!name || !/^on[A-Z]/u.test(name)) continue;
      const indexes = [];
      const collect = child => { const index = functionIndexByNode.get(child); if (Number.isInteger(index)) indexes.push(index); ts.forEachChild(child, collect); };
      collect(property.initializer);
      if (indexes.length) bound[name] = [...new Set(indexes)];
    }
    if (Object.keys(bound).length) row.bound = bound;
  }
  if (!functions.length && !placements.length && !classes.length && !awaitFunctions.size && !(moduleRows && embeddedSiteIndexes(source).size)) return { code, manifest: [], placements: [], classes: [], embedded_indexes: new Set(), library_boundaries: [], skipped: ['no_source_map_function_match'] };
  // Await wrappers: one continuation slot per invocation of each rewritten
  // async function, released in a finally when the function settles.
  for (const fn of awaitFunctions) {
    if (edits.some(edit => edit.kind === 'overwrite' && edit.fn === fn)) continue; // folded into the leaf render
    if (ts.isBlock(fn.body)) {
      edits.push({ kind: 'insert', index: fn.body.getStart(source) + 1, content: 'var __ptAw=__ptAwB();try{', rank: -2, depth: 0 });
      edits.push({ kind: 'insert', index: fn.body.getEnd() - 1, content: '}finally{__ptAwE(__ptAw);}', rank: 2, depth: 0 });
    } else {
      edits.push({ kind: 'insert', index: fn.body.getStart(source), content: '{var __ptAw=__ptAwB();try{return ', rank: -2, depth: 0 });
      edits.push({ kind: 'insert', index: fn.body.getEnd(), content: '}finally{__ptAwE(__ptAw);}}', rank: 2, depth: 0 });
    }
  }
  // Fold nested edits into overwritten leaf bodies.
  const folded = new Set();
  for (const overwrite of edits.filter(edit => edit.kind === 'overwrite')) {
    const inner = edits.filter(edit => edit.nested && edit.index >= overwrite.start && edit.index <= overwrite.end);
    for (const edit of inner) folded.add(edit);
    const local = new MagicString(code.slice(overwrite.start, overwrite.end));
    for (const edit of orderEdits(inner)) local.appendLeft(edit.index - overwrite.start, edit.content);
    if (overwrite.render) overwrite.content = overwrite.render(local.toString(), awaitFunctions.has(overwrite.fn));
  }
  const magic = new MagicString(code);
  for (const edit of orderEdits(edits.filter(edit => !folded.has(edit)))) {
    if (edit.kind === 'insert') {
      // appendRight is important at a function's end boundary: appendLeft can
      // land inside a rewritten concise-arrow expression when the bundler has
      // attached a trailing comma/semicolon to the AST node.
      if (edit.after) magic.appendRight(edit.index, edit.content);
      else magic.appendLeft(edit.index, edit.content);
    }
    else magic.overwrite(edit.start, edit.end, edit.content);
  }
  const embeddedIndexes = moduleRows ? embeddedSiteIndexes(source) : new Set();
  if (typeof prefix === 'function') {
    const inserted = prefix(functions, embeddedIndexes, placements, awaitFunctions.size);
    if (inserted?.content) magic.appendLeft(inserted.index, inserted.content);
  }
  // At the emitted-chunk boundary the input map already describes the chunk;
  // compose the edit map onto it so the served code keeps a map to the
  // original sources instead of a map to the pre-edit chunk.
  const outputMap = composeWith
    ? composeSourceMaps(magic.generateDecodedMap({ source: id, hires: 'boundary' }), composeWith)
    : magic.generateMap({ source: id, includeContent: true, hires: true });
  return { code: magic.toString(), map: outputMap, manifest: functions, placements, classes, embedded_indexes: embeddedIndexes, library_boundaries: [], skipped: [] };
}

/**
 * Compose an edit map (edited chunk -> pre-edit chunk, decoded, single source)
 * with the chunk's own map (pre-edit chunk -> original sources). Inserted
 * instrumentation text has no segment and stays unmapped.
 */
function composeSourceMaps(editMap, chunkMap) {
  const trace = new TraceMap(chunkMap);
  const mappings = editMap.mappings.map(line => {
    const out = [];
    for (const segment of line) {
      if (segment.length < 4) continue;
      const original = traceSegment(trace, segment[2], segment[3]);
      if (!original || original.length < 4) continue;
      out.push(original.length === 5
        ? [segment[0], original[1], original[2], original[3], original[4]]
        : [segment[0], original[1], original[2], original[3]]);
    }
    return out;
  });
  return {
    version: 3,
    ...(chunkMap.file ? { file: chunkMap.file } : {}),
    ...(chunkMap.sourceRoot ? { sourceRoot: chunkMap.sourceRoot } : {}),
    sources: [...(chunkMap.sources || [])],
    ...(Array.isArray(chunkMap.sourcesContent) ? { sourcesContent: [...chunkMap.sourcesContent] } : {}),
    names: [...(chunkMap.names || [])],
    ...(Array.isArray(chunkMap.x_google_ignoreList) ? { x_google_ignoreList: [...chunkMap.x_google_ignoreList] } : {}),
    mappings: encodeMappings(mappings),
  };
}

// A factory call the module pass already wrapped as
// (globalThis.__productTracePlace||Object)(call, N): not placed again.
function insidePlacementWrapper(node) {
  let child = node; let parent = node.parent;
  while (parent && ts.isParenthesizedExpression(parent)) { child = parent; parent = parent.parent; }
  if (!parent || !ts.isCallExpression(parent) || parent.arguments[0] !== child) return false;
  let callee = parent.expression; while (ts.isParenthesizedExpression(callee)) callee = callee.expression;
  return ts.isBinaryExpression(callee) && ts.isPropertyAccessExpression(callee.left) && callee.left.name.text === '__productTracePlace';
}

function isPlainAsync(fn) {
  return Boolean(fn.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword)) && !fn.asteriskToken;
}

// Stable edit order. Pre-existing function edits keep their push order at a
// shared index (rank 0). New edits nest around them: opens that belong inside
// (rank 1) are applied after, outer-first by depth; closes that belong inside
// (rank -1) before, inner-first; await slot wrappers (rank -2 open / 2 close)
// enclose the function frame's own try/finally.
function orderEdits(edits) {
  return edits.map((edit, order) => ({ edit, order })).sort((a, b) => {
    const ai = a.edit.index ?? a.edit.start, bi = b.edit.index ?? b.edit.start;
    if (ai !== bi) return bi - ai;
    const ar = a.edit.rank ?? 0, br = b.edit.rank ?? 0;
    if (ar !== br) return ar - br;
    if (ar === 1) return (a.edit.depth ?? 0) - (b.edit.depth ?? 0) || a.order - b.order;
    if (ar === -1) return (b.edit.depth ?? 0) - (a.edit.depth ?? 0) || a.order - b.order;
    return a.order - b.order;
  }).map(entry => entry.edit);
}

// Chunk prelude helpers for placement wrappers and await continuations. They
// delegate to the runtime when present and are the identity otherwise.
const CHUNK_HELPERS = 'function __ptIdentity(v){return v}'
  + 'function __ptAwB(){var r=globalThis.__productTraceRuntime;return r&&r.awaitBegin?r.awaitBegin():undefined}'
  + 'function __ptAwS(w){var r=globalThis.__productTraceRuntime;return r&&r.awaitSuspend?r.awaitSuspend(w):w}'
  + 'function __ptAwL(w,v){var r=globalThis.__productTraceRuntime;return r&&r.awaitLeave?r.awaitLeave(w,v):v}'
  + 'function __ptAwR(w,v){var r=globalThis.__productTraceRuntime;return r&&r.awaitResume?r.awaitResume(w,v):v}'
  + 'function __ptAwE(w){var r=globalThis.__productTraceRuntime;if(r&&r.awaitEnd)r.awaitEnd(w)}\n';

/**
 * Library code under `vite dev` (prebundled deps): carry the continuation
 * across `await` the way the build's chunk pass does, and nothing else (no
 * frames, ids or placements, and no source-map work). Opens are inserted
 * outer-first and closes are single parens, so nested awaits need no ordering.
 */
export function rewriteLibraryAwaits(code, id) {
  if (!code.includes('await')) return null;
  const source = ts.createSourceFile(id, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const magic = new MagicString(code);
  const stack = [];
  let rewritten = 0;
  const visit = node => {
    const fn = functionLike(node) && node.body ? node : null;
    if (fn) { stack.push({ fn, opened: false }); }
    if (ts.isAwaitExpression(node)) {
      const owner = stack[stack.length - 1];
      if (owner && isPlainAsync(owner.fn)) {
        if (!owner.opened) {
          owner.opened = true;
          const body = owner.fn.body;
          if (ts.isBlock(body)) {
            magic.appendLeft(body.getStart(source) + 1, 'var __ptAw=__ptAwB();try{');
            magic.appendRight(body.getEnd() - 1, '}finally{__ptAwE(__ptAw);}');
          } else {
            magic.appendLeft(body.getStart(source), '{var __ptAw=__ptAwB();try{return ');
            magic.appendRight(body.getEnd(), '}finally{__ptAwE(__ptAw);}}');
          }
        }
        magic.appendLeft(node.getStart(source), ' __ptAwR(__ptAw=__ptAwS(__ptAw),');
        magic.appendLeft(node.expression.getStart(source), ' __ptAwL(__ptAw,');
        rewritten += 1;
      }
    }
    ts.forEachChild(node, visit);
    if (ts.isAwaitExpression(node) && stack.length && isPlainAsync(stack[stack.length - 1].fn)) {
      magic.appendLeft(node.expression.getEnd(), ')');
      magic.appendLeft(node.getEnd(), ')');
    }
    if (fn) stack.pop();
  };
  visit(source);
  if (!rewritten) return null;
  magic.prepend(CHUNK_HELPERS);
  return { code: magic.toString(), map: magic.generateMap({ source: id, hires: false }) };
}

/** Output directory of a Rollup/Vite output, whatever the project's layout. */
function outputDirectory(outputOptions, fallback) {
  if (outputOptions?.dir) return path.resolve(outputOptions.dir);
  if (outputOptions?.file) return path.dirname(path.resolve(outputOptions.file));
  return fallback;
}

export function runtimeAttributionPlugin({ repository, manifestPath, firstParty } = {}) {
  if (typeof repository !== 'string' || !repository) throw new TypeError('repository is required');
  // Module ids arrive as real paths. Compare against the real repository so a
  // symlinked checkout (macOS /tmp -> /private/tmp) gets the same module pass
  // as a real one instead of silently skipping it.
  try { repository = fs.realpathSync(repository); } catch {}
  const firstPartyRule = createFirstPartyRule(firstParty || {});
  // Chunk-pass functions left uninstrumented, by the rule that excluded them
  // (deduplicated by original span), reported once per build.
  const excludedFunctions = new Map();
  const excludedModules = new Map();
  const noteExcluded = (map, reason, key) => { const set = map.get(reason) || new Set(); set.add(key); map.set(reason, set); };
  const firstPartyReport = () => ({ include: firstPartyRule.include, exclude: firstPartyRule.exclude,
    excluded_functions: Object.fromEntries([...excludedFunctions].map(([reason, keys]) => [reason, keys.size])),
    excluded_modules: Object.fromEntries([...excludedModules].map(([reason, keys]) => [reason, keys.size])) });
  const entries = new Map();
  const emittedEntries = new Map();
  const boundaries = new Map();
  const functionIndexes = new Map(); let nextFunctionIndex = 0;
  const indexForId = id => { if (!functionIndexes.has(id)) functionIndexes.set(id, nextFunctionIndex++); return functionIndexes.get(id); };
  // G3 placements: index per placement id; the short element-key prefix must
  // identify exactly one placement in this build, else the full hash is used.
  const placementIndexes = new Map(), placementRows = new Map(), shortKeys = new Map(), emittedPlacements = new Map(), placementsByModule = new Map();
  // First-party classes by module (source names for error types), kept for modules that reached a chunk.
  const classesByModule = new Map(); let emittedModules = null;
  let nextPlacementIndex = 0, shortKeyCollisions = 0, buildId = null;
  const indexForPlacement = placement => {
    if (!placementIndexes.has(placement.id)) {
      const index = nextPlacementIndex++;
      let key = `p_${placement.hash.slice(0, 12)}:${placement.start}-${placement.end}`;
      const holder = shortKeys.get(key);
      if (holder && holder !== placement.id) { shortKeyCollisions += 1; key = `p_${placement.hash}:${placement.start}-${placement.end}`; }
      shortKeys.set(key, placement.id);
      placementIndexes.set(placement.id, index);
      placementRows.set(index, { index, id: placement.id, key, file: placement.file, line: placement.line, tag: placement.tag, component: placement.component, start: placement.start, end: placement.end });
    }
    return placementIndexes.get(placement.id);
  };
  // Measurement switches for the span-neutrality check (stamps/awaits off on the same build).
  const stampsDisabled = process.env.PRODUCTTRACE_PLACEMENTS === '0';
  const awaitsDisabled = process.env.PRODUCTTRACE_AWAIT_CONTINUATIONS === '0';
  const writeManifest = () => {
    if (!manifestPath) return;
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    const functions = new Map();
    // Source transforms are an intermediate inventory. Only functions that
    // survive into an emitted chunk are reportable/served and receive a
    // manifest marker; keeping module entries here caused the build gate to
    // count dead/lazy modules that never reached client/dist.
    const source = emittedEntries.size ? emittedEntries : entries;
    for (const row of [...source.values()].flat()) if (!functions.has(row.id)) functions.set(row.id, row);
    const placements = [...emittedPlacements.values()].sort((a, b) => a.index - b.index);
    const classes = new Map();
    for (const [module, rows] of classesByModule) if (!emittedModules || emittedModules.has(module)) for (const row of rows) if (!classes.has(row.id)) classes.set(row.id, row);
    fs.writeFileSync(manifestPath, JSON.stringify({ schema: 'producttrace.runtime-attribution-manifest.v1', first_party: firstPartyReport(), build: buildId, functions: [...functions.values()], placements, classes: [...classes.values()], placement_short_key_collisions: shortKeyCollisions, library_boundaries: [...boundaries.values()].flat() }, null, 2));
  };
  // Chunk instrumentation needs the chunk's source map. When the project did
  // not ask for maps, generate hidden ones for instrumentation and drop the
  // map assets again so the project's output layout is unchanged.
  let ownsSourcemaps = false;
  let serving = false;
  return {
    name: 'producttrace-runtime-attribution',
    enforce: 'post',
    configResolved(config) { serving = config.command === 'serve'; },
    config(userConfig) {
      if (userConfig?.build?.sourcemap) return null;
      ownsSourcemaps = true;
      return { build: { sourcemap: 'hidden' } };
    },
    transform(code, id) {
      const clean = id.split('?')[0].split('#')[0];
      if (!path.isAbsolute(clean)) return null;
      let real;
      try { real = fs.realpathSync(clean); } catch { real = clean; }
      const relative = path.relative(repository, real).split(path.sep).join('/');
      const reason = firstPartyRule.excludedBy(relative);
      if (reason !== null) {
        if (reason !== 'outside repository' && reason !== 'not a JS/TS source') noteExcluded(excludedModules, reason, relative);
        // A workspace package consumed from its built output (excluded as
        // non-first-party) may still map, through its own source map, to
        // first-party JSX. Take placements only (no functions, frames or
        // awaits); each placement is kept only if it maps to a first-party file.
        // `vite dev` serves libraries unbundled (Vite's prebundled deps): the
        // build's chunk pass would carry continuations through their awaits.
        if (serving && !awaitsDisabled && real.split(path.sep).includes('node_modules') && /\.[cm]?js$/u.test(real)) return rewriteLibraryAwaits(code, real);
        // Installed libraries (including Vite's prebundled deps under
        // node_modules/.vite, which carry maps) are never first-party JSX.
        if (reason === 'outside repository' || reason === 'not a JS/TS source' || stampsDisabled || real.split(path.sep).includes('node_modules') || !fs.existsSync(`${real}.map`)) return null;
        const placed = instrumentPostTransformedSource(code, real, { repository, map: generatedMapFromContext(this), indexForId: () => null,
          register: false, instrument: false, firstParty: firstPartyRule, indexForPlacement, placementFallback: 'Object',
          prefix: (functions, embedded, placements = []) => placements.length
            ? { index: 0, content: `${placementRegistration(placements.map(row => ({ ...placementRows.get(row.index), ...(row.bound ? { bound: row.bound } : {}) }))).replace(/\n/gu, '')}\n` } : null });
        if (!placed.placements?.length) return null;
        placementsByModule.set(real, [...new Set([...(placementsByModule.get(real) || []), ...placed.placements.map(row => row.index)])]);
        return { code: placed.code, map: placed.map };
      }
      const map = generatedMapFromContext(this);
      // G3 placements are taken here, on the unminified module output whose
      // map lands exactly on each JSX element (the minified chunk map does so
      // for a small fraction). The factory calls are the real React element
      // factories, so `Object` is a safe identity fallback. Registration is a
      // plain statement (no function syntax the chunk pass could resolve).
      // Under `vite dev` there is no chunk pass: this module output is what
      // runs, so it also registers its functions and carries await
      // continuations itself (first-party async functions only: prebundled
      // libraries are not transformed).
      const prefix = (functions, embedded, placements = [], awaitCount = 0) => {
        const content = (serving && functions.length ? `globalThis.__productTraceRuntime && globalThis.__productTraceRuntime.registerManifest && globalThis.__productTraceRuntime.registerManifest(${JSON.stringify(functions.map(row => ({ index: row.index, id: row.id })))});` : '')
          + (placements.length ? placementRegistration(placements.map(row => ({ ...placementRows.get(row.index), ...(row.bound ? { bound: row.bound } : {}) }))) : '')
          + (serving && awaitCount ? CHUNK_HELPERS : '');
        return content ? { index: 0, content: `${content.replace(/\n/gu, '')}\n` } : null;
      };
      const result = instrumentPostTransformedSource(code, real, { repository, map, indexForId, firstParty: firstPartyRule,
        indexForPlacement: stampsDisabled ? null : indexForPlacement, placementFallback: 'Object', prefix, registerClasses: true,
        ...(serving && !awaitsDisabled ? { awaitContinuations: true } : {}) });
      if (result.classes?.length) classesByModule.set(real, result.classes);
      if (!result.manifest.length && !result.placements.length && !result.classes?.length) return null;
      for (const row of result.placements) if (row.bound && !placementRows.get(row.index).bound) placementRows.get(row.index).bound = row.bound;
      placementsByModule.set(real, [...new Set([...(placementsByModule.get(real) || []), ...result.placements.map(row => row.index)])]);
      // A module can be transformed more than once in one build (query
      // variants, worker pipelines). Every index this pass embedded must stay
      // resolvable, so accumulate rows instead of keeping only the last pass.
      const previous = entries.get(relative) || [];
      const byIndex = new Map([...previous, ...result.manifest].map(row => [row.index, row]));
      entries.set(relative, [...byIndex.values()]);
      boundaries.set(relative, result.library_boundaries);
      writeManifest();
      return { code: result.code, map: result.map };
    },
    generateBundle(outputOptions, bundle) {
      emittedEntries.clear();
      emittedPlacements.clear();
      const instrumentedChunks = [];
      excludedFunctions.clear();
      const moduleRowsByIndex = new Map();
      for (const rows of entries.values()) for (const row of rows) if (!moduleRowsByIndex.has(row.index)) moduleRowsByIndex.set(row.index, row);
      // Source-map sources are relative to the emitted file's directory, so
      // resolve chunks against the real output directory (any outDir).
      const outDir = outputDirectory(outputOptions, path.resolve(repository, 'dist'));
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk') continue;
        const map = chunk.map && (typeof chunk.map === 'string' ? JSON.parse(chunk.map) : chunk.map);
        if (!map || !Array.isArray(map.sources)) continue;
        const generatedFile = path.resolve(outDir, chunk.fileName);
        // Chunks without first-party sources are still rewritten for await
        // continuations (library async code); nothing in them is instrumented.
        const firstPartyChunk = hasFirstPartySource(map, generatedFile, repository, firstPartyRule);
        // Register the function objects that actually survive bundling. The
        // pre-bundle tags can be folded away by the optimizer; post-bundle
        // tagging is what makes the live React fiber props discoverable.
        // The emitted chunk is the authoritative executable. Earlier module
        // probes can be folded away while Rollup renders/minifies the graph,
        // leaving registration markers without any function.enter evidence.
        // Leaf bodies are framed directly. Non-leaf expression/arrow values
        // are registered through a transparent entry proxy so they emit enter
        // rows without overlapping nested post-bundle source edits.
        // Imports carry no functions, so the leading import run has the same
        // extent before and after edits; the registration goes right after it.
        const importsEnd = chunk.code.match(/^(?:(?:import)[^;]+;)+/u)?.[0]?.length || 0;
        // Module-level probes (transform hook) that survived into this chunk
        // carry their own function indexes (AST-recognized sites). When the
        // chunk pass maps the same function differently (or abstains), those
        // indexes must still be in the manifest and registration, or their
        // enter rows cannot resolve.
        const withModuleRows = (functions, embeddedIndexes) => {
          const present = new Set(functions.map(row => row.index));
          const surviving = [...embeddedIndexes].map(index => moduleRowsByIndex.get(index)).filter(Boolean);
          return [...functions, ...surviving.filter(row => !present.has(row.index))];
        };
        const prefix = (functions, embeddedIndexes, placements = [], awaitCount = 0) => {
          const rows = withModuleRows(functions, embeddedIndexes);
          if (!rows.length && !placements.length && !awaitCount) return null;
          const placed = placements.map(row => ({ ...placementRows.get(row.index), ...(row.bound ? { bound: row.bound } : {}) }));
          // One line: the registration and helpers never share a line with chunk code.
          const content = (rows.length ? `globalThis.__productTraceRuntime && globalThis.__productTraceRuntime.registerManifest && globalThis.__productTraceRuntime.registerManifest(${JSON.stringify(rows.map(row => ({ index: row.index, id: row.id })))});` : '')
            + placementRegistration(placed) + CHUNK_HELPERS;
          return { index: importsEnd, content: `${content.replace(/\n/gu, '')}\n` };
        };
        const result = instrumentPostTransformedSource(chunk.code, generatedFile, { repository, map, indexForId, register: true, instrument: true, instrumentLeafOnly: true, prefix, composeWith: map, moduleRows: moduleRowsByIndex,
          firstParty: firstPartyRule, onExcluded: (reason, key) => noteExcluded(excludedFunctions, reason, key),
          awaitContinuations: awaitsDisabled ? false : 'all', framePass: 'chunk',
          // Fallback placements for JSX the module pass did not see (e.g.
          // workspace packages consumed from their built dist, mapped back
          // through nested maps); wrapped calls are skipped.
          indexForPlacement: stampsDisabled ? null : indexForPlacement });
        result.manifest = withModuleRows(result.manifest, result.embedded_indexes);
        if (!firstPartyChunk) { result.manifest = []; }
        for (const row of result.placements || []) {
          if (row.bound && !placementRows.get(row.index).bound) placementRows.get(row.index).bound = row.bound;
          emittedPlacements.set(row.index, placementRows.get(row.index));
        }
        if (!result.manifest.length && result.code === chunk.code) continue;
        if (result.manifest.length) instrumentedChunks.push({ chunk, result });
        chunk.code = result.code;
        chunk.map = { ...result.map, toString() { return JSON.stringify(this); }, toUrl() { return `data:application/json;charset=utf-8;base64,${Buffer.from(JSON.stringify(this)).toString('base64')}`; } };
        // Rollup has already emitted the pre-edit map as an asset; replace it.
        const mapAsset = bundle[chunk.sourcemapFileName || `${chunk.fileName}.map`];
        if (mapAsset?.type === 'asset') mapAsset.source = JSON.stringify(result.map);
        if (result.manifest.length) { emittedEntries.set(chunk.fileName, result.manifest); boundaries.set(chunk.fileName, result.library_boundaries); }
      }
      // Build identity over every function and placement id that reached a
      // chunk. Appended at each chunk's end (no mapping shift); it is read
      // only when a stamp row is emitted, after module evaluation.
      // Placements (and classes) registered by the module pass for modules that reached a chunk.
      emittedModules = new Set();
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk') continue;
        for (const moduleId of chunk.moduleIds || Object.keys(chunk.modules || {})) {
          let real = String(moduleId).split('?')[0].split('#')[0]; try { real = fs.realpathSync(real); } catch {}
          emittedModules.add(real);
          for (const index of placementsByModule.get(real) || []) emittedPlacements.set(index, placementRows.get(index));
        }
      }
      buildId = createHash('sha256').update([...new Set([...instrumentedChunks.flatMap(({ result }) => result.manifest.map(row => row.id)), ...[...emittedPlacements.values()].map(row => row.id)])].sort().join('\n')).digest('hex').slice(0, 12);
      for (const { chunk } of instrumentedChunks) chunk.code += `\n;globalThis.__productTraceRuntime && globalThis.__productTraceRuntime.registerBuild && globalThis.__productTraceRuntime.registerBuild(${JSON.stringify(buildId)});\n`;
      if (ownsSourcemaps) {
        for (const [fileName, output] of Object.entries(bundle)) {
          if (output.type === 'chunk') output.map = null;
          else if (output.type === 'asset' && fileName.endsWith('.map')
            && Object.values(bundle).some(chunk => chunk.type === 'chunk' && (chunk.sourcemapFileName || `${chunk.fileName}.map`) === fileName)) delete bundle[fileName];
        }
      }
      writeManifest();
      // One visible line per build so a monorepo user sees what was left out.
      const report = firstPartyReport();
      const instrumented = new Set([...emittedEntries.values()].flat().map(row => row.id)).size;
      const reasons = Object.entries(report.excluded_functions).map(([reason, count]) => `${reason} ${count}`).join(', ') || 'none';
      const modules = Object.entries(report.excluded_modules).map(([reason, count]) => `${reason} ${count}`).join(', ') || 'none';
      console.info(`[producttrace] first-party: ${instrumented} functions instrumented; excluded functions by rule: ${reasons}; excluded modules by rule: ${modules}; include=${JSON.stringify(report.include)} exclude=${JSON.stringify(report.exclude)}`);
    },
    closeBundle: writeManifest,
  };
}

function placementRegistration(placements) {
  const rows = placements.map(({ index, id, key, file, line, start, end, tag, component, bound }) => ({ index, id, key, file, line, start, end, tag, component, ...(bound ? { bound } : {}) }));
  return (rows.length ? `globalThis.__productTraceRuntime && globalThis.__productTraceRuntime.registerPlacements && globalThis.__productTraceRuntime.registerPlacements(${JSON.stringify(rows)});\n` : '');
}

export { instrumentPostTransformedSource, exactOriginalFunctionBoundary, jsxPlacementIndex };

// Kept as a neutral-fixture helper for the existing package tests. The Vite
// plugin never calls this path; production instrumentation uses the post-JS
// transform above and requires a source map.
export function instrumentFirstPartySource(code, file) {
  const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const functions = [];
  const imports = [];
  const edits = [];
  let frame = 0;
  const visit = node => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)
      && !node.moduleSpecifier.text.startsWith('.') && !node.moduleSpecifier.text.startsWith('/')) {
      imports.push({ module: node.moduleSpecifier.text, source: { file, start: node.moduleSpecifier.getStart(source), end: node.moduleSpecifier.getEnd() } });
    }
    if (functionLike(node) && node.body) {
      const start = node.getStart(source), end = node.getEnd();
      const id = stableFunctionId(code, start, end);
      functions.push({ id, kind: 'function', source: { file, start, end } });
      const name = `__ptFrame${frame++}`;
      if (ts.isBlock(node.body)) {
        edits.push({ kind: 'insert', index: node.body.getStart(source) + 1, content: `\nconst ${name}=globalThis.__productTraceRuntime?.enter(${JSON.stringify(id)});try {` });
        edits.push({ kind: 'insert', index: node.body.getEnd() - 1, content: `}${THREW_CATCH(name)} finally {globalThis.__productTraceRuntime?.exit(${name});}` });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  const magic = new MagicString(code);
  for (const edit of edits.sort((a, b) => b.index - a.index)) magic.appendLeft(edit.index, edit.content);
  return { code: magic.toString(), manifest: functions, library_boundaries: imports, skipped: [] };
}
