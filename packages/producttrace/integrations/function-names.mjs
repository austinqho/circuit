/**
 * Build-time names for instrumented functions and classes, read from the
 * original source's own declarations (the AST the transform already parses).
 * The runtime never infers a name; readers print what this module recorded.
 *
 * Every function-like node with a body gets one entry keyed by its original
 * span `start:end` (the same span the function id hashes):
 *   { name, name_kind, display_name, [export_names], [via], [bound_to], [accessor], [static] }
 *
 * name_kind (the rule that gave the name):
 *   declaration   `function foo`, `export function foo`, a named function
 *                 expression `function saveTodo() {}` (its own name wins)
 *   binding       the function is the direct value of a variable, parameter
 *                 default, destructuring default or `name = fn` assignment
 *   property      the direct value of an object-literal key (`key: () => …`,
 *                 shorthand method `key() {}`), a class field, or `a.b = fn`
 *   method        a class method, getter, setter or constructor (`Class.method`)
 *   export_alias  the only name is the export's (`export default function () {}`;
 *                 `export default () => …` would be too, but its boundary is
 *                 not resolved today, so it is not instrumented): name `default`
 *   callback      a call argument; named by the callee's parameter at that
 *                 position only when the callee's name has exactly one
 *                 binding in the file, that binding is a function (a
 *                 declaration or `const f = fn`) and its scope encloses the
 *                 call; imports, destructured and parameter bindings, and any
 *                 second binding of the name abstain: name null, display
 *                 `<callback of callee>`
 *   inferred      the first argument of a call whose result is bound
 *                 (`const save = useCallback(() => …)`, `memo(() => …)`):
 *                 the binding holds the call's result, not the function, so
 *                 name stays null; `bound_to` / `via` keep the context and
 *                 display_name the source shape `save = useCallback(<callback>)`
 *   anonymous     nothing names it (computed keys, array elements, returned
 *                 functions, JSX attribute values, IIFEs): name null
 *
 * `export { a as b }` / `export default a` add `export_names` to `a`'s entry;
 * the declared name stays the name.
 */
import path from 'node:path';
import { createHash } from 'node:crypto';
import ts from 'typescript';

const cache = new Map();

function scriptKind(file) {
  return /\.tsx$/u.test(file) ? ts.ScriptKind.TSX : /\.[cm]?ts$/u.test(file) ? ts.ScriptKind.TS : /\.jsx?$/u.test(file) ? ts.ScriptKind.JSX : ts.ScriptKind.JS;
}

function functionLike(node) {
  return ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)
    || ts.isMethodDeclaration(node) || ts.isGetAccessor(node) || ts.isSetAccessor(node)
    || ts.isConstructorDeclaration(node);
}

/** Wrappers that do not change which value a position holds: `(x)`, `x as T`, `x satisfies T`, `x!`, `<T>x`. */
function outerValue(node) {
  let child = node; let parent = node.parent;
  while (parent && (ts.isParenthesizedExpression(parent) || ts.isAsExpression(parent) || ts.isSatisfiesExpression?.(parent)
    || ts.isNonNullExpression(parent) || ts.isTypeAssertionExpression(parent))) { child = parent; parent = parent.parent; }
  return { child, parent };
}

function innerValue(node) {
  while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression?.(node)
    || ts.isNonNullExpression(node) || ts.isTypeAssertionExpression(node))) node = node.expression;
  return node;
}

/** A property or member name the source spells out; computed keys abstain (null). */
function memberName(name) {
  if (!name) return null;
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) return name.text;
  if (ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return null;
}

/** Dotted text of a callee or assignment target made only of identifiers / `this`; null otherwise. */
function dottedText(node) {
  node = innerValue(node);
  if (!node) return null;
  if (ts.isIdentifier(node)) return node.text;
  if (node.kind === ts.SyntaxKind.ThisKeyword) return 'this';
  if (ts.isPropertyAccessExpression(node)) { const left = dottedText(node.expression); return left ? `${left}.${node.name.text}` : null; }
  if (ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression)) { const left = dottedText(node.expression); return left ? `${left}.${node.argumentExpression.text}` : null; }
  // A call in the chain keeps its place, not its arguments: `text.trim().replace`.
  if (ts.isCallExpression(node)) { const left = dottedText(node.expression); return left && left.length <= 60 ? `${left}()` : null; }
  return null;
}

/** `(0, x.y)(…)` interop form → `x.y`; a call of a call (`create<T>()(…)`) → `create()`. */
function calleeText(call) {
  let callee = innerValue(call.expression);
  if (callee && ts.isBinaryExpression(callee) && callee.operatorToken.kind === ts.SyntaxKind.CommaToken) callee = innerValue(callee.right);
  if (callee && ts.isCallExpression(callee)) { const inner = calleeText(callee); return inner ? `${inner}()` : null; }
  const text = dottedText(callee);
  if (text) return `${ts.isNewExpression(call) ? 'new ' : ''}${text}`;
  if (callee && ts.isPropertyAccessExpression(callee)) return `….${callee.name.text}`;
  return null;
}

function classNameOf(cls) {
  if (cls.name) return cls.name.text;
  const { parent } = outerValue(cls);
  if (parent && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
  if (ts.isClassDeclaration(cls) && cls.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.DefaultKeyword)) return 'default';
  if (parent && ts.isExportAssignment(parent)) return 'default';
  return null;
}

/**
 * The holder of a call's result, climbing through calls whose first argument
 * is this call (`memo(forwardRef(fn))`): a variable binding, an assignment
 * target, or `default` for `export default call(…)`. `via` lists the callees
 * from the outermost in.
 */
function callHolder(call) {
  const via = [calleeText(call) || 'an expression'];
  let node = call;
  for (;;) {
    const { child, parent } = outerValue(node);
    if (parent && (ts.isCallExpression(parent) || ts.isNewExpression(parent)) && parent.arguments?.[0] === child && parent.expression !== child) {
      via.unshift(calleeText(parent) || 'an expression'); node = parent; continue;
    }
    if (parent && ts.isVariableDeclaration(parent) && parent.initializer === child && ts.isIdentifier(parent.name)) return { name: parent.name.text, via, kind: 'binding', node: parent };
    if (parent && ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken && parent.right === child) {
      const target = dottedText(parent.left); if (target) return { name: target.split('.').at(-1), path: target, via, kind: 'assignment', node: parent };
    }
    if (parent && ts.isPropertyAssignment(parent) && parent.initializer === child) {
      const key = memberName(parent.name); if (key) return { name: key, via, kind: 'property', node: parent };
    }
    if (parent && ts.isExportAssignment(parent)) return { name: 'default', via, kind: 'export', node: parent };
    return { name: null, via, node };
  }
}

export function buildNameIndex(file, content) {
  const key = `${file}\0${createHash('sha256').update(content).digest('hex')}`;
  if (cache.has(key)) return cache.get(key);
  const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, scriptKind(file));
  const base = path.posix.basename(file);

  // Every binding of every name in the file (value namespace): declarations,
  // imports, destructured variables and parameters (object and array
  // patterns), class and enum names, catch and loop variables. A callee names
  // its callback's parameter only when its name has exactly ONE binding in the
  // file, that binding is a function declaration or `const/let/var f = fn`,
  // and its scope encloses the call. Anything else (an import, a
  // destructured or parameter binding, a second same-named function anywhere,
  // a binding whose scope does not contain the call) abstains.
  const bindings = new Map();
  const bind = (name, node, value = null) => { const list = bindings.get(name) || []; list.push({ node, value }); bindings.set(name, list); };
  const bindPattern = (name, node) => {
    if (!name) return;
    if (ts.isIdentifier(name)) { bind(name.text, node); return; }
    if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) for (const element of name.elements) if (ts.isBindingElement(element)) bindPattern(element.name, node);
  };
  const visitScope = node => {
    if (ts.isFunctionDeclaration(node) && node.name) bind(node.name.text, node, node);
    else if (ts.isVariableDeclaration(node)) {
      const value = node.initializer ? innerValue(node.initializer) : null;
      if (ts.isIdentifier(node.name) && value && (ts.isArrowFunction(value) || ts.isFunctionExpression(value))) bind(node.name.text, node, value);
      else bindPattern(node.name, node);
    } else if (ts.isParameter(node)) bindPattern(node.name, node);
    else if ((ts.isClassDeclaration(node) || ts.isClassExpression(node) || ts.isFunctionExpression(node) || ts.isEnumDeclaration(node) || ts.isModuleDeclaration(node)) && node.name && ts.isIdentifier(node.name)) bind(node.name.text, node);
    else if (ts.isImportClause(node) && node.name) bind(node.name.text, node);
    else if (ts.isImportSpecifier(node) || ts.isNamespaceImport(node) || ts.isImportEqualsDeclaration(node)) bind(node.name.text, node);
    ts.forEachChild(node, visitScope);
  };
  visitScope(source);
  // The scope a binding lives in: the nearest block / module / function body
  // (function declarations are hoisted to theirs; `var` to its function).
  const scopeOf = node => {
    const isVar = ts.isVariableDeclaration(node) && node.parent && ts.isVariableDeclarationList(node.parent) && !(node.parent.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const));
    for (let cursor = node.parent; cursor; cursor = cursor.parent) {
      if (ts.isSourceFile(cursor) || ts.isModuleBlock(cursor) || functionLike(cursor)) return cursor;
      if (!isVar && (ts.isBlock(cursor) || ts.isCaseBlock(cursor) || ts.isForStatement(cursor) || ts.isForOfStatement(cursor) || ts.isForInStatement(cursor))) return cursor;
    }
    return source;
  };
  const contains = (outer, inner) => outer.getStart(source) <= inner.getStart(source) && inner.getEnd() <= outer.getEnd();
  const visibleCallee = call => {
    const callee = innerValue(call.expression);
    if (!callee || !ts.isIdentifier(callee)) return null;
    const list = bindings.get(callee.text) || [];
    if (list.length !== 1 || !list[0].value) return null;
    return contains(scopeOf(list[0].node), call) ? list[0].value : null;
  };

  // Exports of module-level names: local → [export names that differ].
  const exportsOf = new Map();
  const addExport = (local, exported) => { if (!local || !exported || local === exported) return; const list = exportsOf.get(local) || []; if (!list.includes(exported)) list.push(exported); exportsOf.set(local, list); };
  for (const statement of source.statements) {
    if (ts.isExportDeclaration(statement) && !statement.moduleSpecifier && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) addExport((element.propertyName || element.name).text, element.name.text);
    } else if (ts.isExportAssignment(statement) && !statement.isExportEquals && ts.isIdentifier(innerValue(statement.expression))) {
      addExport(innerValue(statement.expression).text, 'default');
    } else if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name
      && statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.DefaultKeyword)) {
      addExport(statement.name.text, 'default');
    }
  }
  const topLevel = node => {
    for (let cursor = node.parent; cursor; cursor = cursor.parent) {
      if (ts.isSourceFile(cursor)) return true;
      if (functionLike(cursor) || ts.isClassLike(cursor) || ts.isBlock(cursor) || ts.isModuleBlock(cursor)) return false;
    }
    return false;
  };

  // Path of the value holding an object literal (for display only).
  const objectPath = object => {
    const { child, parent } = outerValue(object);
    if (!parent) return null;
    if (ts.isPropertyAssignment(parent) && parent.initializer === child && ts.isObjectLiteralExpression(parent.parent)) {
      const key = memberName(parent.name); if (!key) return null;
      const outer = objectPath(parent.parent);
      return outer ? `${outer}.${key}` : key;
    }
    if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
    if (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken && parent.right === child) return dottedText(parent.left);
    if (ts.isExportAssignment(parent)) return 'default';
    // Returned by a function (concise body or `return`): the holder of that function.
    let fn = null;
    if (ts.isArrowFunction(parent) && parent.body === child) fn = parent;
    else if (ts.isReturnStatement(parent)) { for (let cursor = parent.parent; cursor; cursor = cursor.parent) if (functionLike(cursor)) { fn = cursor; break; } }
    if (fn) {
      const own = (ts.isFunctionDeclaration(fn) || ts.isFunctionExpression(fn)) && fn.name ? `${fn.name.text}()` : null;
      if (own) return own;
      const holder = outerValue(fn);
      if (holder.parent && (ts.isCallExpression(holder.parent) || ts.isNewExpression(holder.parent)) && holder.parent.arguments?.includes(holder.child)) {
        const bound = callHolder(holder.parent); return bound.name ? (bound.path || bound.name) : null;
      }
      if (holder.parent && ts.isVariableDeclaration(holder.parent) && ts.isIdentifier(holder.parent.name)) return `${holder.parent.name.text}()`;
      return null;
    }
    if ((ts.isCallExpression(parent) || ts.isNewExpression(parent)) && parent.arguments?.includes(child)) {
      const callee = calleeText(parent); return callee ? `${callee}({…})` : null;
    }
    return null;
  };
  const inObject = (object, key) => { const holder = objectPath(object); return holder ? (holder.endsWith('({…})') ? `${holder.slice(0, -5)}({ ${key} })` : `${holder}.${key}`) : key; };

  const functions = new Map();
  const classes = [];
  const record = (node, info) => {
    const entry = { name: info.name ?? null, name_kind: info.name_kind, display_name: info.display_name ?? info.name ?? '<anonymous>' };
    if (info.via) entry.via = info.via;
    if (info.bound_to) entry.bound_to = info.bound_to;
    if (info.accessor) entry.accessor = info.accessor;
    if (info.static) entry.static = true;
    const exported = info.local && topLevel(info.local) ? exportsOf.get(entry.name) : null;
    if (exported?.length) { entry.export_names = [...exported]; entry.display_name = `${entry.display_name} (exported as ${exported.join(', ')})`; }
    functions.set(`${node.getStart(source)}:${node.getEnd()}`, entry);
  };

  const nameFunction = node => {
    // Declarations and named function expressions: the source's own name wins.
    if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) && node.name) {
      return { name: node.name.text, name_kind: 'declaration', local: ts.isFunctionDeclaration(node) ? node : null };
    }
    if (ts.isFunctionDeclaration(node)) return { name: 'default', name_kind: 'export_alias', display_name: `default (${base})` };
    if (ts.isMethodDeclaration(node) || ts.isGetAccessor(node) || ts.isSetAccessor(node) || ts.isConstructorDeclaration(node)) {
      const accessor = ts.isGetAccessor(node) ? 'get' : ts.isSetAccessor(node) ? 'set' : null;
      const isStatic = Boolean(node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.StaticKeyword));
      const name = ts.isConstructorDeclaration(node) ? 'constructor' : memberName(node.name);
      if (!name) return { name: null, name_kind: 'anonymous', display_name: '<computed key>' };
      const suffix = accessor ? ` (${accessor}ter)` : '';
      if (ts.isClassLike(node.parent)) {
        const owner = classNameOf(node.parent);
        return { name, name_kind: 'method', display_name: `${owner ? `${owner}.` : ''}${name}${suffix}`, accessor, static: isStatic };
      }
      if (ts.isObjectLiteralExpression(node.parent)) return { name, name_kind: 'property', display_name: `${inObject(node.parent, name)}${suffix}`, accessor };
      return { name, name_kind: 'property', display_name: name, accessor };
    }
    // Arrow functions and anonymous function expressions: the position they are the value of.
    const { child, parent } = outerValue(node);
    if (!parent) return { name: null, name_kind: 'anonymous' };
    if (ts.isVariableDeclaration(parent) && parent.initializer === child) {
      return ts.isIdentifier(parent.name) ? { name: parent.name.text, name_kind: 'binding', local: parent } : { name: null, name_kind: 'anonymous' };
    }
    if ((ts.isParameter(parent) || ts.isBindingElement(parent)) && parent.initializer === child && ts.isIdentifier(parent.name)) {
      return { name: parent.name.text, name_kind: 'binding' };
    }
    if (ts.isPropertyAssignment(parent) && parent.initializer === child) {
      const name = memberName(parent.name);
      if (!name) return { name: null, name_kind: 'anonymous', display_name: '<computed key>' };
      return { name, name_kind: 'property', display_name: ts.isObjectLiteralExpression(parent.parent) ? inObject(parent.parent, name) : name };
    }
    if (ts.isPropertyDeclaration(parent) && parent.initializer === child) {
      const name = memberName(parent.name);
      if (!name) return { name: null, name_kind: 'anonymous', display_name: '<computed key>' };
      const owner = ts.isClassLike(parent.parent) ? classNameOf(parent.parent) : null;
      return { name, name_kind: 'property', display_name: `${owner ? `${owner}.` : ''}${name}`, static: Boolean(parent.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.StaticKeyword)) };
    }
    if (ts.isBinaryExpression(parent) && parent.right === child && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      if (ts.isIdentifier(innerValue(parent.left))) return { name: innerValue(parent.left).text, name_kind: 'binding' };
      const target = dottedText(parent.left);
      if (!target) return { name: null, name_kind: 'anonymous' };
      let display = target;
      if (target.startsWith('this.')) {
        for (let cursor = parent.parent; cursor; cursor = cursor.parent) if (ts.isClassLike(cursor)) { const owner = classNameOf(cursor); if (owner) display = `${owner}.${target.slice(5)}`; break; }
      }
      return { name: target.split('.').at(-1), name_kind: 'property', display_name: display };
    }
    if (ts.isExportAssignment(parent)) return { name: 'default', name_kind: 'export_alias', display_name: `default (${base})` };
    if ((ts.isCallExpression(parent) || ts.isNewExpression(parent)) && parent.arguments?.includes(child) && parent.expression !== child) {
      const position = parent.arguments.indexOf(child);
      const callee = calleeText(parent);
      const target = ts.isCallExpression(parent) ? visibleCallee(parent) : null;
      const parameter = target?.parameters?.[position];
      if (parameter && !parameter.dotDotDotToken && ts.isIdentifier(parameter.name)) {
        return { name: parameter.name.text, name_kind: 'callback', via: callee, display_name: `${parameter.name.text} (callback of ${callee})` };
      }
      if (position === 0) {
        // The binding holds the call's result, not the function: never the
        // function's name. Recorded as context in the source's own shape.
        const holder = callHolder(parent);
        if (holder.name) {
          const via = `${holder.via.join('(')}${')'.repeat(holder.via.length - 1)}`;
          const shape = holder.via.reduceRight((inner, callee) => `${callee}(${inner})`, '<callback>');
          const bound = holder.path || holder.name;
          const display = holder.kind === 'export' ? `export default ${shape}` : holder.kind === 'property' ? `${bound}: ${shape}` : `${bound} = ${shape}`;
          return { name: null, name_kind: 'inferred', via, bound_to: bound, display_name: display };
        }
      }
      return { name: null, name_kind: 'callback', via: callee, display_name: `<callback of ${callee || 'an expression'}>` };
    }
    if (ts.isJsxExpression(parent) && parent.parent && ts.isJsxAttribute(parent.parent)) {
      const element = parent.parent.parent?.parent; // JsxAttributes → opening/self-closing element
      const tag = element && (ts.isJsxOpeningElement(element) || ts.isJsxSelfClosingElement(element)) ? element.tagName.getText(source) : null;
      return { name: null, name_kind: 'anonymous', display_name: `<${tag ? `${tag} ` : ''}${parent.parent.name.getText(source)}>` };
    }
    return { name: null, name_kind: 'anonymous' };
  };

  const visit = node => {
    if (functionLike(node) && node.body) record(node, nameFunction(node));
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
      const name = classNameOf(node);
      const heritage = node.heritageClauses?.find(clause => clause.token === ts.SyntaxKind.ExtendsKeyword)?.types?.[0];
      classes.push({ start: node.getStart(source), end: node.getEnd(), name, name_kind: name ? (node.name ? 'declaration' : name === 'default' ? 'export_alias' : 'binding') : 'anonymous',
        head: node.name ? node.name.getStart(source) : node.getStart(source), extends: heritage ? heritage.expression.getText(source).slice(0, 80) : null,
        export_names: name && topLevel(node) ? (exportsOf.get(name) || []) : [] });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  const index = { functions, classes };
  cache.set(key, index);
  if (cache.size > 2000) cache.delete(cache.keys().next().value);
  return index;
}

/** Name fields for the original function at [start, end) of `content`, or an explicit abstention. */
export function functionNamesAt(file, content, start, end) {
  if (typeof content !== 'string') return null;
  return buildNameIndex(file, content).functions.get(`${start}:${end}`) || { name: null, name_kind: 'anonymous', display_name: '<anonymous>' };
}

/** The original class whose span contains `offset` between its start and its name (or `class` keyword). */
export function classAt(file, content, offset) {
  if (typeof content !== 'string') return null;
  const hits = buildNameIndex(file, content).classes.filter(row => row.start <= offset && offset <= row.head + 1);
  hits.sort((left, right) => (left.end - left.start) - (right.end - right.start));
  return hits[0] || null;
}
