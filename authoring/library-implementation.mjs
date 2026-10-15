import fs from 'node:fs';
import path from 'node:path';
import { createRequire, isBuiltin } from 'node:module';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import {resolvePureExportGetter} from './library-export-getter.mjs';
import {types} from 'node:util';

const sha = value => createHash('sha256').update(value).digest('hex');
const loadedSnapshots = new Map();
const loadedEnvironments = new Map();
const boundSources = new WeakMap();
// Capture the host primitive before importing any inspected package. Identity,
// not the exported name or a native-looking function string, grants this hint.
const hostArrayIsArray = Array.isArray;
const builtin = new Set(['undefined', 'arguments', 'Object', 'Function', 'Array', 'Symbol', 'String', 'Number', 'Boolean',
  'Math', 'JSON', 'Date', 'RegExp', 'Error', 'TypeError', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Promise',
  'console', 'process', 'module', 'exports', 'require', 'setTimeout', 'clearTimeout', 'queueMicrotask',
  'Reflect', 'Infinity', 'NaN']);

function declarationSlices(files, targetSource) {
  const locations = files.flatMap(file => {
    const start = file.source.indexOf(targetSource);
    if (start < 0) return [];
    // Duplicate text is ambiguity, not a reason to ignore this file and pick
    // an unrelated unique copy from another dependency.
    return file.source.indexOf(targetSource, start + 1) >= 0 ? [{ ...file, start }, { ...file, start }]
      : [{ ...file, start }];
  });
  if (locations.length !== 1) return { ready: false, reason: 'runtime_function_source_not_unique' };
  const target = locations[0], end = target.start + targetSource.length;
  const options = { allowJs: true, checkJs: true, noLib: true, noResolve: true, target: ts.ScriptTarget.Latest };
  const host = ts.createCompilerHost(options);
  const sources = new Map(files.map(file => [file.path, file.source]));
  host.getSourceFile = name => sources.has(name) ? ts.createSourceFile(name, sources.get(name), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS) : undefined;
  host.fileExists = name => sources.has(name);
  host.readFile = name => sources.get(name);
  const program = ts.createProgram([...sources.keys()], options, host), checker = program.getTypeChecker();
  const source = program.getSourceFile(target.path);
  let root;
  const locate = node => {
    if (node.getStart(source) === target.start && node.end === end) root ??= node;
    if (!root) ts.forEachChild(node, locate);
  };
  locate(source);
  if (!root) return { ready: false, reason: 'runtime_source_ast_unaligned' };
  const nodes = new Set([root]), pending = [root], unresolved = new Set();
  const includeDependency = node => {
    if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression) || node.expression.text !== 'require') return;
    if (node.arguments.length !== 1 || !ts.isStringLiteral(node.arguments[0])) { unresolved.add('dynamic_dependency_requires_resolution'); return; }
    const specifier = node.arguments[0].text;
    if (isBuiltin(specifier)) { unresolved.add(`native_dependency_requires_contract:${specifier}`); return; }
    let filename;
    try { filename = createRequire(node.getSourceFile().fileName).resolve(specifier); }
    catch { unresolved.add(`dependency_unresolved:${specifier}`); return; }
    const dependency = program.getSourceFile(filename);
    if (!dependency) { unresolved.add(`dependency_not_loaded:${specifier}`); return; }
    // A small module is one exact implementation unit. For a larger module,
    // locate the actual callable export in the already loaded, pinned files;
    // unrelated exports and padding do not belong in the model's context.
    if (Buffer.byteLength(dependency.text) > 20000) {
      const exported = createRequire(node.getSourceFile().fileName).cache[filename]?.exports;
      let callable = exported;
      if (ts.isPropertyAccessExpression(node.parent) && node.parent.expression === node) {
        const descriptor = exported != null ? Object.getOwnPropertyDescriptor(exported, node.parent.name.text) : null;
        callable = descriptor && 'value' in descriptor ? descriptor.value : null;
      }
      if (typeof callable !== 'function') { unresolved.add(`dependency_requires_export_slice:${specifier}`); return; }
      const text = Function.prototype.toString.call(callable), candidates = [];
      let ambiguous = false;
      for (const file of program.getSourceFiles()) {
        const start = file.text.indexOf(text);
        if (start < 0) continue;
        if (file.text.indexOf(text, start + 1) >= 0) { ambiguous = true; continue; }
        let found;
        const locate = current => {
          if (current.getStart(file) === start && current.end === start + text.length) found ??= current;
          if (!found) ts.forEachChild(current, locate);
        };
        locate(file); if (found) candidates.push(found);
      }
      if (ambiguous || candidates.length !== 1) { unresolved.add(`runtime_dependency_function_not_unique:${specifier}`); return; }
      const selected = candidates[0];
      if (!nodes.has(selected)) { nodes.add(selected); pending.push(selected); }
      return;
    }
    if (!nodes.has(dependency)) { nodes.add(dependency); pending.push(dependency); }
  };
  while (pending.length && nodes.size <= 100) {
    const current = pending.shift();
    const inspect = node => {
      includeDependency(node);
      if (ts.isIdentifier(node)) {
        const parent = node.parent;
        const propertyName = ts.isPropertyAccessExpression(parent) && parent.name === node
          || ts.isPropertyAssignment(parent) && parent.name === node && !ts.isShorthandPropertyAssignment(parent)
          || ts.isMethodDeclaration(parent) && parent.name === node
          || ts.isLabeledStatement(parent) && parent.label === node
          || (ts.isBreakStatement(parent) || ts.isContinueStatement(parent)) && parent.label === node;
        if (!propertyName) {
          const symbol = checker.getSymbolAtLocation(node);
          const declarations = symbol?.declarations || [];
          if (!declarations.length && !builtin.has(node.text)) unresolved.add(`unresolved_binding:${node.text}`);
          for (const declaration of declarations) {
            if (declaration.getSourceFile() === current.getSourceFile()
              && declaration.getStart() >= current.getStart() && declaration.end <= current.end) continue;
            if (ts.isParameter(declaration)) { unresolved.add(`captured_parameter:${node.text}`); continue; }
            if (!ts.isVariableDeclaration(declaration) && !ts.isFunctionDeclaration(declaration)) {
              unresolved.add(`unsupported_binding:${node.text}`); continue;
            }
            if (!nodes.has(declaration)) { nodes.add(declaration); pending.push(declaration); }
          }
        }
      }
      ts.forEachChild(node, inspect);
    };
    inspect(ts.isSourceFile(current) ? selectedEnvironmentBranch(current) ?? current : current);
  }
  if (pending.length) unresolved.add('declaration_limit');
  const slices = [...nodes].map(node => ({ file: node.getSourceFile().fileName,
    start: node.getStart(), end: node.end, source: node.getText() }));
  if (slices.reduce((n, row) => n + Buffer.byteLength(row.source), 0) > 80000) unresolved.add('relevant_source_byte_limit');
  return { ready: unresolved.size === 0, reason: [...unresolved].join(';') || null, slices };
}

// A whole-file, side-effect-free CJS environment selector can exclude its
// inactive import. Do not constant-fold arbitrary application conditions or
// selectors with local bindings/calls: those still need dependency evidence.
function selectedEnvironmentBranch(source) {
  const statements = source.statements.filter(node => !(ts.isExpressionStatement(node) && ts.isStringLiteral(node.expression)));
  if (statements.length !== 1 || !ts.isIfStatement(statements[0])) return null;
  const branch = statements[0], test = branch.expression;
  if (!ts.isBinaryExpression(test) || test.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsEqualsToken
    || test.left.getText(source) !== 'process.env.NODE_ENV' || !ts.isStringLiteral(test.right)) return null;
  const requireOnly = block => {
    if (!block || !ts.isBlock(block) || block.statements.length !== 1) return false;
    const statement = block.statements[0];
    if (!ts.isExpressionStatement(statement) || !ts.isBinaryExpression(statement.expression)) return false;
    const assignment = statement.expression;
    return assignment.operatorToken.kind === ts.SyntaxKind.EqualsToken && assignment.left.getText(source) === 'module.exports'
      && ts.isCallExpression(assignment.right) && ts.isIdentifier(assignment.right.expression)
      && assignment.right.expression.text === 'require' && assignment.right.arguments.length === 1
      && ts.isStringLiteral(assignment.right.arguments[0]);
  };
  if (!requireOnly(branch.thenStatement) || !requireOnly(branch.elseStatement)) return null;
  return process.env.NODE_ENV === test.right.text ? branch.thenStatement : branch.elseStatement;
}

function completeSmallClosure(files) {
  const known = new Set(files.map(file => file.path)), unresolved = new Set();
  for (const file of files) {
    const source = ts.createSourceFile(file.path, file.source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const inspect = node => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'require') {
        if (node.arguments.length !== 1 || !ts.isStringLiteral(node.arguments[0])) unresolved.add('dynamic_dependency_requires_resolution');
        else {
          const specifier = node.arguments[0].text;
          if (isBuiltin(specifier)) unresolved.add(`native_dependency_requires_contract:${specifier}`);
          else try {
            if (!known.has(createRequire(file.path).resolve(specifier))) unresolved.add(`dependency_not_loaded:${specifier}`);
          } catch { unresolved.add(`dependency_unresolved:${specifier}`); }
        }
      }
      ts.forEachChild(node, inspect);
    };
    inspect(selectedEnvironmentBranch(source) ?? source);
  }
  return { ready: unresolved.size === 0, reason: [...unresolved].join(';') || null,
    slices: files.map(row => ({ file: row.path, start: 0, end: row.source.length, source: row.source })) };
}

/**
 * Pin a CommonJS runtime entry and its loaded initialization dependencies. A
 * small complete closure is supplied verbatim; larger modules are sliced by
 * TypeScript binding identity. Dynamic dependencies loaded later must trigger
 * re-discovery; this does not claim a universal static dependency closure.
 */
export function readLibraryImplementation({ repository, specifier, exportName }) {
  const nodeEnvironment = process.env.NODE_ENV;
  const root = fs.realpathSync(repository), require = createRequire(path.join(root, 'package.json'));
  const entry = require.resolve(specifier);
  const alreadyLoaded = new Set(Object.keys(require.cache));
  // Record native bind results while this synchronous import initializes. The
  // real native bind still creates each function; no function argument, result,
  // or receiver is replaced. Restore the descriptor even when import throws.
  // This authoring reader runs separately from the application's browser host.
  const bindDescriptor = Object.getOwnPropertyDescriptor(Function.prototype, 'bind');
  const nativeBind = bindDescriptor.value;
  const observedBind = new Proxy(nativeBind, { apply(target, receiver, args) {
    const bound = Reflect.apply(target, receiver, args);
    boundSources.set(bound, { target: receiver, receiver: args[0], argument_count: Math.max(0, args.length - 1) });
    return bound;
  } });
  const hostMicrotask = globalThis.queueMicrotask;
  let moduleValue;
  Object.defineProperty(Function.prototype, 'bind', { ...bindDescriptor, value: observedBind });
  try { moduleValue = require(specifier); }
  finally { Object.defineProperty(Function.prototype, 'bind', bindDescriptor); }
  const loaded = new Set();
  const visit = module => {
    if (!module || loaded.has(module.filename)) return;
    loaded.add(module.filename);
    for (const child of module.children) visit(child);
  };
  visit(require.cache[entry]);
  const lockSource = fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8');
  const lock = JSON.parse(lockSource);
  const packages = new Map(), rows = [];
  for (const filename of [...loaded].sort()) {
    const real = fs.realpathSync(filename);
    if (!real.startsWith(root + path.sep + 'node_modules' + path.sep)) throw new Error('implementation_outside_installed_dependencies');
    let folder = path.dirname(real);
    while (!fs.existsSync(path.join(folder, 'package.json'))) {
      const parent = path.dirname(folder);
      if (parent === folder) throw new Error('package_manifest_missing');
      folder = parent;
    }
    const packagePath = path.relative(root, folder).split(path.sep).join('/');
    const manifest = fs.readFileSync(path.join(folder, 'package.json'), 'utf8'), metadata = JSON.parse(manifest);
    const locked = lock.packages?.[packagePath];
    if (!locked || locked.version !== metadata.version || typeof locked.integrity !== 'string' || !locked.integrity.startsWith('sha512-'))
      throw new Error('installed_version_or_integrity_unverified');
    packages.set(packagePath, { path: packagePath, name: metadata.name, version: metadata.version,
      integrity: locked.integrity, manifest_sha256: sha(manifest) });
    const source = fs.readFileSync(real, 'utf8');
    if (alreadyLoaded.has(filename) && loadedSnapshots.get(filename) !== sha(source))
      throw new Error('runtime_cache_not_attested_or_changed');
    if (alreadyLoaded.has(filename) && loadedEnvironments.get(filename) !== nodeEnvironment)
      throw new Error('runtime_cache_environment_changed');
    loadedSnapshots.set(filename, sha(source));
    loadedEnvironments.set(filename, nodeEnvironment);
    rows.push({ path: real, relative: path.relative(root, real).split(path.sep).join('/'), sha256: sha(source), source });
  }
  // Attest our own synchronous load even when the requested export is absent
  // or non-callable. A failed lookup must not make a later valid lookup look
  // like an unrelated, unattested preload. Existing foreign preloads still fail.
  const segments = exportName === 'default' ? [] : exportName.split('.');
  if (segments[0] === 'default') segments.shift();
  if (segments.length > 8 || segments.some(part => !/^[A-Za-z_$][\w$]*$/.test(part)
    || ['__proto__', 'prototype', 'constructor'].includes(part))) throw new Error('export_path_unsupported');
  let producer = moduleValue;
  const exportReads=[],getterProofs=[];
  for (const part of segments) {
    if(types.isProxy(producer))throw new Error('export_requires_own_data_property');
    const owner=producer,descriptor=producer!=null?Object.getOwnPropertyDescriptor(producer,part):null;
    if(!descriptor)throw new Error('export_requires_own_data_property');
    if('value'in descriptor)producer=descriptor.value;
    else {
      let resolved;try{resolved=resolvePureExportGetter(descriptor.get,{files:rows})}catch(error){throw new Error(`export_requires_own_data_property:${error.message}`)}
      producer=resolved.value;getterProofs.push(...resolved.resolutions);
    }
    exportReads.push({owner,part,descriptor,value:producer});
  }
  if (typeof producer !== 'function') throw new Error('export_not_callable');
  const source = Function.prototype.toString.call(producer);
  const fullBytes = rows.reduce((n, row) => n + Buffer.byteLength(row.source), 0);
  const selection = fullBytes <= 20000 ? completeSmallClosure(rows)
    : declarationSlices(rows, source);
  if (source.includes('[native code]')) {
    selection.ready = false; selection.reason = 'native_or_bound_runtime_function_requires_source_contract';
  }
  const binding = boundSources.get(producer);
  let hostBinding = null;
  if (binding?.target === hostMicrotask && binding.argument_count === 0) {
    // Microtask scheduling is an explicit interpreter host capability. The
    // bound target is observed by identity, not inferred from the package name.
    // Other native or bound targets still need their own source/capability.
    hostBinding = { capability: 'microtask', target: 'globalThis.queueMicrotask', node_version: process.versions.node,
      target_source: Function.prototype.toString.call(hostMicrotask),
      target_source_sha256: sha(Function.prototype.toString.call(hostMicrotask)),
      receiver: binding.receiver === globalThis ? 'host_global' : 'opaque_bound_receiver', bound_argument_count: 0 };
    selection.ready = true; selection.reason = null;
  }
  const arrayIntrinsic = producer === hostArrayIsArray && Array.isArray === hostArrayIsArray;
  if (arrayIntrinsic) {
    hostBinding = { capability: 'array_brand', target: 'Array.isArray', node_version: process.versions.node,
      target_source_sha256: sha(Function.prototype.toString.call(hostArrayIsArray)) };
  }
  const context = { schema: 'producttrace.library-implementation.v1',
    specifier, export_name: exportName, runtime: { host: 'node', mode: process.env.NODE_ENV || 'development', entry: path.relative(root, entry) },
    packages: [...packages.values()], files: rows.map(({ relative, sha256 }) => ({ path: relative, sha256 })),
    source_status: arrayIntrinsic ? 'ready_for_catalog_recheck' : selection.ready ? 'ready_for_scoped_proposal' : 'frontier',
    source_reason: arrayIntrinsic ? 'native_host_intrinsic_requires_independent_recheck' : selection.reason,
    scope: 'runtime_export_and_loaded_initialization_dependencies',
    implementation: source, slices: (selection.slices || []).map(row => ({ ...row, file: path.relative(root, row.file) })),
    ...(hostBinding ? { host_binding: hostBinding } : {}),
    ...(getterProofs.length?{export_resolution:{kind:'v8_pure_forwarding_getter',node_version:process.versions.node,getters:getterProofs.map(row=>({...row,file:path.relative(root,row.file)}))}}:{}),
  };
  const currentFiles = () => {
    const current = new Set();
    const walk = module => { if (!module || current.has(module.filename)) return; current.add(module.filename); for (const child of module.children) walk(child); };
    walk(require.cache[entry]);
    return current;
  };
  return { producer, context, sha256: sha(JSON.stringify(context)),
    unchanged() {
      const current = currentFiles();
      let exportsUnchanged=true;
      try { for(const read of exportReads) {
        const descriptor=Object.getOwnPropertyDescriptor(read.owner,read.part);
        if(!descriptor||descriptor.get!==read.descriptor.get||descriptor.set!==read.descriptor.set||descriptor.enumerable!==read.descriptor.enumerable||descriptor.configurable!==read.descriptor.configurable||descriptor.writable!==read.descriptor.writable){exportsUnchanged=false;break;}
        const value='value'in descriptor?descriptor.value:resolvePureExportGetter(descriptor.get,{files:rows}).value;
        if(!Object.is(value,read.value)){exportsUnchanged=false;break;}
      }}catch{exportsUnchanged=false;}
      return (!arrayIntrinsic || Array.isArray === hostArrayIsArray) && exportsUnchanged && process.env.NODE_ENV === nodeEnvironment
        && fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8') === lockSource
        && current.size === loaded.size && [...current].every(file => loaded.has(file))
        && rows.every(row => sha(fs.readFileSync(row.path)) === row.sha256)
        && [...packages.values()].every(row => sha(fs.readFileSync(path.join(root, row.path, 'package.json'))) === row.manifest_sha256);
    } };
}
