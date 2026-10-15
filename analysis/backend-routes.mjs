import { createHash } from 'node:crypto';
import path from 'node:path';
import ts from 'typescript';

const SCHEMA = 'producttrace.backend-route-map.v1';
const HTTP_METHODS = new Set(['all', 'delete', 'get', 'head', 'options', 'patch', 'post', 'put']);
const SOURCE_EXTENSIONS = ['', '.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'];

const digest = value => createHash('sha256').update(value).digest('hex');
const stable = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const slash = value => value.replaceAll('\\', '/').replace(/^\.\//u, '');

function sourceKind(node) {
  return ts.SyntaxKind[node.kind] || 'Unknown';
}

function literalPath(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return null;
}

function composePath(...parts) {
  const body = parts.flatMap(part => String(part || '').split('/')).filter(Boolean).join('/');
  return body ? `/${body}` : '/';
}

function propertyName(node) {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node) && node.argumentExpression) return literalPath(node.argumentExpression);
  return null;
}

/**
 * Compile Express registrations from a repository-relative source snapshot.
 *
 * The compiler intentionally models Express's public registration surface rather
 * than its implementation. Unsupported identities and dynamic mount paths remain
 * diagnostics and never become speculative routes.
 */
export function compileBackendRoutes(files, options = {}) {
  if (!files || typeof files !== 'object' || Array.isArray(files)) {
    throw new TypeError('compileBackendRoutes(files) expects a repository-relative source snapshot');
  }
  if (options.serviceId !== undefined
      && (typeof options.serviceId !== 'string' || options.serviceId.trim() === '')) {
    throw new TypeError('serviceId must be a nonempty string');
  }
  const serviceId = options.serviceId?.trim() || null;

  const sources = new Map(Object.entries(files).map(([file, source]) => [slash(file), String(source)])
    .sort(([a], [b]) => a.localeCompare(b)));
  const manifest = [...sources].sort(([a], [b]) => a.localeCompare(b))
    .map(([file, source]) => ({ path: file, sha256: digest(source) }));
  const fingerprint = digest(stable({ schema: SCHEMA, service_id: serviceId, files: manifest }));
  const output = { schema: SCHEMA, fingerprint, service_id: serviceId, files: manifest,
    source_nodes: [], routes: [], frontiers: [], diagnostics: [] };
  const programs = new Map();
  const nodes = new Map();
  const diagnostics = new Map();
  const unresolvedHandlerIds = new Set();

  const addNode = (file, node, kind = sourceKind(node)) => {
    const sourceFile = programs.get(file);
    const start = node.getStart(sourceFile);
    const end = node.getEnd();
    const text = sources.get(file).slice(start, end);
    const id = `source:${digest(stable({ file, start, end, text })).slice(0, 24)}`;
    if (!nodes.has(id)) nodes.set(id, { id, kind, file, start, end, text });
    return id;
  };
  const report = (code, file, node, message, details = {}) => {
    const source_node_id = node ? addNode(file, node) : undefined;
    const row = { code, file, ...(source_node_id ? { source_node_id } : {}), message, ...details };
    diagnostics.set(stable(row), row);
  };

  for (const [file, source] of sources) {
    const kind = /\.[cm]?tsx?$/u.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.JS;
    const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
    programs.set(file, sourceFile);
    for (const diagnostic of sourceFile.parseDiagnostics || []) {
      report('syntax_error', file, diagnostic.start == null ? null : findNodeAt(sourceFile, diagnostic.start),
        ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
    }
  }

  const symbols = new Map();
  const imports = new Map();
  const exports = new Map();
  const expressFactories = new Set();
  const routerFactories = new Set();
  const routers = new Map();
  const duplicateRouterIds = new Set();
  const assignments = [];
  const registrations = [];

  const key = (file, name) => `${file}#${name}`;
  const moduleFile = (from, specifier) => {
    if (!specifier.startsWith('.')) return null;
    const base = slash(path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier)));
    for (const extension of SOURCE_EXTENSIONS) {
      const candidate = `${base}${extension}`;
      if (sources.has(candidate)) return candidate;
    }
    for (const extension of SOURCE_EXTENSIONS.slice(1)) {
      const candidate = `${base}/index${extension}`;
      if (sources.has(candidate)) return candidate;
    }
    return null;
  };

  // First pass records declarations and module aliases. Later passes can then
  // resolve imports without depending on file enumeration order.
  for (const [file, sourceFile] of programs) {
    const fileImports = new Map();
    const fileExports = new Map();
    imports.set(file, fileImports);
    exports.set(file, fileExports);
    const rememberDeclaration = (name, node) => symbols.set(key(file, name), { file, name, node });

    for (const statement of sourceFile.statements) {
      if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
        const specifier = statement.moduleSpecifier.text;
        const clause = statement.importClause;
        if (!clause) continue;
        if (specifier === 'express') {
          if (clause.name) expressFactories.add(key(file, clause.name.text));
          const bindings = clause.namedBindings;
          if (bindings && ts.isNamedImports(bindings)) {
            for (const element of bindings.elements) {
              if ((element.propertyName || element.name).text === 'Router') routerFactories.add(key(file, element.name.text));
            }
          }
        }
        const targetFile = moduleFile(file, specifier);
        if (!targetFile) continue;
        if (clause.name) fileImports.set(clause.name.text, { file: targetFile, exported: 'default', node: statement });
        const bindings = clause.namedBindings;
        if (bindings && ts.isNamedImports(bindings)) {
          for (const element of bindings.elements) fileImports.set(element.name.text,
            { file: targetFile, exported: (element.propertyName || element.name).text, node: element });
        }
      }
      if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name)) {
            rememberDeclaration(declaration.name.text, declaration);
            if (hasExport(statement)) fileExports.set(declaration.name.text, { local: declaration.name.text, node: declaration });
            const required = requireSpecifier(declaration.initializer);
            if (required === 'express') expressFactories.add(key(file, declaration.name.text));
            else if (required) {
              const targetFile = moduleFile(file, required);
              if (targetFile) fileImports.set(declaration.name.text, { file: targetFile, exported: '*', node: declaration });
            }
          } else if (ts.isObjectBindingPattern(declaration.name)) {
            const required = requireSpecifier(declaration.initializer);
            if (required === 'express') {
              for (const element of declaration.name.elements) {
                if (ts.isIdentifier(element.name) && (element.propertyName || element.name).text === 'Router') {
                  routerFactories.add(key(file, element.name.text));
                }
              }
            } else if (required) {
              const targetFile = moduleFile(file, required);
              if (targetFile) for (const element of declaration.name.elements) {
                if (!ts.isIdentifier(element.name)) continue;
                fileImports.set(element.name.text, { file: targetFile,
                  exported: (element.propertyName || element.name).text, node: element });
              }
            }
          }
        }
      } else if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name) {
        rememberDeclaration(statement.name.text, statement);
        if (hasExport(statement)) fileExports.set(statement.name.text, { local: statement.name.text, node: statement });
      }
      if (ts.isExportAssignment(statement) && !statement.isExportEquals && ts.isIdentifier(statement.expression)) {
        fileExports.set('default', { local: statement.expression.text, node: statement });
      }
      if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        const targetFile = statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
          ? moduleFile(file, statement.moduleSpecifier.text) : null;
        for (const element of statement.exportClause.elements) {
          const exported = element.name.text;
          const original = (element.propertyName || element.name).text;
          fileExports.set(exported, targetFile
            ? { reexport: { file: targetFile, exported: original }, node: element }
            : { local: original, node: element });
        }
      }
      if (ts.isExpressionStatement(statement) && ts.isBinaryExpression(statement.expression)
        && statement.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        const { left, right } = statement.expression;
        if (isModuleExports(left)) {
          if (ts.isIdentifier(right)) fileExports.set('default', { local: right.text, node: statement });
          else if (ts.isFunctionExpression(right) || ts.isArrowFunction(right) || ts.isClassExpression(right)) {
            fileExports.set('default', { declaration: right, node: statement });
          }
          else if (ts.isObjectLiteralExpression(right)) {
            for (const property of right.properties) {
              if (ts.isShorthandPropertyAssignment(property)) fileExports.set(property.name.text,
                { local: property.name.text, node: property });
              else if (ts.isPropertyAssignment(property) && ts.isIdentifier(property.initializer)) {
                const exported = propertyNameText(property.name);
                if (exported) fileExports.set(exported, { local: property.initializer.text, node: property });
              }
            }
          }
        } else {
          const exported = commonJsExportName(left);
          if (exported && ts.isIdentifier(right)) fileExports.set(exported, { local: right.text, node: statement });
        }
      }
    }
  }

  const resolveSymbol = (file, name, seen = new Set()) => {
    const identity = key(file, name);
    if (seen.has(identity)) return { cycle: true, identity };
    seen.add(identity);
    const imported = imports.get(file)?.get(name);
    if (!imported) return { identity, file, name, declaration: symbols.get(identity)?.node };
    return resolveExport(imported.file, imported.exported, seen);
  };
  const resolveExport = (file, exported, seen = new Set()) => {
    const marker = `${file}#export:${exported}`;
    if (seen.has(marker)) return { cycle: true, identity: marker };
    seen.add(marker);
    const row = exports.get(file)?.get(exported === '*' ? 'default' : exported);
    if (!row) return { unresolved: true, identity: marker };
    if (row.declaration) return { identity: marker, file, name: exported, declaration: row.declaration };
    if (row.reexport) return resolveExport(row.reexport.file, row.reexport.exported, seen);
    return resolveSymbol(file, row.local, seen);
  };
  const resolveExpression = (file, expression, seen = new Set()) => {
    if (ts.isIdentifier(expression)) return resolveSymbol(file, expression.text, seen);
    if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression)) {
      const imported = imports.get(file)?.get(expression.expression.text);
      if (imported?.exported === '*') return resolveExport(imported.file, expression.name.text, seen);
    }
    return { unresolved: true, identity: `${file}#dynamic:${expression.getStart(programs.get(file))}` };
  };

  const callCreatesRouter = (file, expression) => {
    if (!expression || !ts.isCallExpression(expression)) return null;
    if (ts.isIdentifier(expression.expression)) {
      const identity = key(file, expression.expression.text);
      if (expressFactories.has(identity)) return 'application';
      if (routerFactories.has(identity)) return 'router';
      if (expression.expression.text === 'require' && expression.arguments[0]
        && literalPath(expression.arguments[0]) === 'express') return 'application';
    }
    if (ts.isPropertyAccessExpression(expression.expression)
      && expression.expression.name.text === 'Router') {
      const owner = expression.expression.expression;
      if (ts.isIdentifier(owner) && (expressFactories.has(key(file, owner.text))
        || (owner.text === 'require' && expression.arguments[0] && literalPath(expression.arguments[0]) === 'express'))) return 'router';
      if (ts.isCallExpression(owner) && ts.isIdentifier(owner.expression) && owner.expression.text === 'require'
        && literalPath(owner.arguments[0]) === 'express') return 'router';
    }
    return null;
  };

  let registrationOrder = 0;
  for (const [file, sourceFile] of programs) {
    const visit = node => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
        const kind = callCreatesRouter(file, node.initializer);
        if (kind) {
          const identity = key(file, node.name.text);
          if (routers.has(identity)) duplicateRouterIds.add(identity);
          routers.set(identity, { id: identity, file, name: node.name.text,
            kind, declaration: node, source_node_id: addNode(file, node) });
        }
      }
      if (ts.isBinaryExpression(node) && assignmentOperator(node.operatorToken.kind) && ts.isIdentifier(node.left)) {
        assignments.push({ file, name: node.left.text, node });
      }
      if (ts.isCallExpression(node) && (ts.isPropertyAccessExpression(node.expression)
        || ts.isElementAccessExpression(node.expression))) {
        const method = propertyName(node.expression);
        const receiver = node.expression.expression;
        if (method && (method === 'use' || HTTP_METHODS.has(method)) && ts.isIdentifier(receiver)) {
          registrations.push({ file, receiver: receiver.text, method, args: [...node.arguments], node,
            source_node_id: addNode(file, node), order: registrationOrder++ });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  const canonicalRouter = (file, expression) => {
    const resolved = typeof expression === 'string' ? resolveSymbol(file, expression) : resolveExpression(file, expression);
    if (resolved.cycle || resolved.unresolved) return resolved;
    return routers.get(resolved.identity) ? { ...resolved, router: routers.get(resolved.identity) } : { ...resolved, unresolved: true };
  };
  const tainted = new Set(duplicateRouterIds);
  for (const identity of duplicateRouterIds) {
    const router = routers.get(identity);
    report('ambiguous_router_identity', router.file, router.declaration,
      `More than one lexical router is named ${router.name} in ${router.file}; its registrations are omitted.`);
  }
  for (const assignment of assignments) {
    const resolved = resolveSymbol(assignment.file, assignment.name);
    if (routers.has(resolved.identity)) {
      tainted.add(resolved.identity);
      report('reassigned_router_identity', assignment.file, assignment.node,
        `Router ${assignment.name} is reassigned; its registrations are omitted.`);
    }
  }

  const endpointRegistrations = [];
  const mounts = [];
  const middlewareRegistrations = [];
  const unresolvedRegistrations = [];
  for (const registration of registrations) {
    const owner = canonicalRouter(registration.file, registration.receiver);
    if (!owner.router) continue; // Calls on unrelated application objects are outside this adapter.
    if (tainted.has(owner.identity)) continue;
    if (registration.method !== 'use') {
      const prefix = literalPath(registration.args[0]);
      if (prefix == null) {
        unresolvedRegistrations.push({ owner_id: owner.identity, framework: 'express',
          method: registration.method.toUpperCase(), path_prefix: null,
          source_node_id: registration.source_node_id });
        report('dynamic_route_path', registration.file, registration.args[0] || registration.node,
          `Express ${registration.method.toUpperCase()} path is dynamic; the route is omitted.`);
        continue;
      }
      const callbacks = registration.args.slice(1);
      if (!callbacks.length) {
        report('missing_route_handler', registration.file, registration.node, 'Express route has no handler.');
        continue;
      }
      const callbackIds = callbacks.map(callback => handlerId(registration.file, callback, resolveExpression,
        addNode, report, unresolvedHandlerIds));
      if (callbackIds.some(value => !value)) {
        unresolvedRegistrations.push({ owner_id: owner.identity, framework: 'express',
          method: registration.method.toUpperCase(), path_prefix: prefix,
          source_node_id: registration.source_node_id });
        continue;
      }
      endpointRegistrations.push({ ...registration, owner_id: owner.identity, path: prefix,
        middleware_ids: callbackIds.slice(0, -1), terminal_handler_ids: callbackIds.slice(-1) });
      continue;
    }

    const firstPath = literalPath(registration.args[0]);
    const hasPrefix = firstPath != null;
    const prefix = hasPrefix ? firstPath : '/';
    const callbacks = registration.args.slice(hasPrefix ? 1 : 0);
    const candidates = callbacks.map((callback, index) => ({ callback, index,
      router: ts.isIdentifier(callback) || ts.isPropertyAccessExpression(callback)
        ? canonicalRouter(registration.file, callback) : null }));
    const mounted = candidates.filter(candidate => candidate.router?.router);
    if (mounted.some(candidate => candidate.index > 0) && !hasPrefix) {
      unresolvedRegistrations.push({ owner_id: owner.identity, framework: 'express',
        method: 'ALL', path_prefix: null, source_node_id: registration.source_node_id });
      report('dynamic_mount_path', registration.file, registration.args[0],
        'Express mount prefix is dynamic; the mount is omitted.');
      continue;
    }
    if (!mounted.length) {
      if (!hasPrefix && callbacks.length) {
        const middleware = callbacks.map(callback => handlerId(registration.file, callback, resolveExpression,
          addNode, report, unresolvedHandlerIds));
        if (middleware.every(Boolean)) middlewareRegistrations.push({ ...registration,
          owner_id: owner.identity, middleware_ids: middleware });
      } else if (hasPrefix && callbacks.length) {
        const middleware = callbacks.map(callback => handlerId(registration.file, callback, resolveExpression,
          addNode, report, unresolvedHandlerIds));
        const resolvedMiddleware = middleware.every(Boolean)
          && middleware.every(id => !unresolvedHandlerIds.has(id));
        if (resolvedMiddleware) {
          middlewareRegistrations.push({ ...registration, owner_id: owner.identity,
            path: prefix, middleware_ids: middleware });
          continue;
        }
        const likelyRouter = candidates.find(candidate => ts.isIdentifier(candidate.callback)
          && (imports.get(registration.file)?.has(candidate.callback.text) || /router$/iu.test(candidate.callback.text)));
        if (likelyRouter) {
          unresolvedRegistrations.push({ owner_id: owner.identity, framework: 'express', method: 'ALL',
            path_prefix: hasPrefix ? prefix : null, source_node_id: registration.source_node_id });
          report('unresolved_router_identity', registration.file, likelyRouter.callback,
            `Mounted router ${likelyRouter.callback.text} cannot be resolved; the mount is omitted.`);
        }
        else if (hasPrefix && callbacks.length && callbacks.every(callback => !ts.isIdentifier(callback))) {
          unresolvedRegistrations.push({ owner_id: owner.identity, framework: 'express', method: 'ALL',
            path_prefix: prefix, source_node_id: registration.source_node_id });
          report('unresolved_router_identity', registration.file, registration.node,
            'The dynamic mounted value cannot be proven to be an Express router; the mount is omitted.');
        }
      }
      continue;
    }
    for (const candidate of mounted) {
      if (tainted.has(candidate.router.identity)) {
        report('reassigned_router_identity', registration.file, candidate.callback,
          `Mounted router ${candidate.callback.text} is reassigned; the mount is omitted.`);
        continue;
      }
      const middleware = callbacks.slice(0, candidate.index)
        .filter(value => !((ts.isIdentifier(value) || ts.isPropertyAccessExpression(value))
          && canonicalRouter(registration.file, value).router))
        .map(callback => handlerId(registration.file, callback, resolveExpression,
          addNode, report, unresolvedHandlerIds));
      if (middleware.some(value => !value)) continue;
      mounts.push({ ...registration, parent_id: owner.identity, child_id: candidate.router.identity, prefix,
        middleware_ids: middleware, path_node_id: hasPrefix ? addNode(registration.file, registration.args[0]) : registration.source_node_id });
    }
  }

  const cyclicRouters = findCyclicRouters(mounts);
  for (const identity of [...cyclicRouters].sort()) {
    const router = routers.get(identity);
    report('router_mount_cycle', router?.file || null, router?.declaration || null,
      `Router mount cycle includes ${identity}; routes through the cycle are omitted.`, { router_id: identity });
  }

  const outgoing = new Map();
  for (const mount of mounts) {
    if (cyclicRouters.has(mount.parent_id) || cyclicRouters.has(mount.child_id)) continue;
    const rows = outgoing.get(mount.parent_id) || [];
    rows.push(mount);
    outgoing.set(mount.parent_id, rows);
  }
  const endpointsByOwner = new Map();
  for (const endpoint of endpointRegistrations) {
    if (cyclicRouters.has(endpoint.owner_id)) continue;
    const rows = endpointsByOwner.get(endpoint.owner_id) || [];
    rows.push(endpoint);
    endpointsByOwner.set(endpoint.owner_id, rows);
  }
  const middlewareByOwner = new Map();
  for (const middleware of middlewareRegistrations) {
    if (cyclicRouters.has(middleware.owner_id)) continue;
    const rows = middlewareByOwner.get(middleware.owner_id) || [];
    rows.push(middleware);
    middlewareByOwner.set(middleware.owner_id, rows);
  }
  const frontiersByOwner = new Map();
  for (const frontier of unresolvedRegistrations) {
    const rows = frontiersByOwner.get(frontier.owner_id) || [];
    rows.push(frontier);
    frontiersByOwner.set(frontier.owner_id, rows);
  }

  const roots = [...routers.values()].filter(router => router.kind === 'application' && !tainted.has(router.id)
    && !cyclicRouters.has(router.id)).sort((a, b) => a.id.localeCompare(b.id));
  const routeRows = [];
  const frontierRows = [];
  let flattenedOrder = 0;
  const walk = (router, prefix, chain, inheritedMiddleware, inheritedScopedMiddleware, seen, applicationId) => {
    if (seen.has(router.id)) return;
    const nextSeen = new Set(seen).add(router.id);
    for (const frontier of frontiersByOwner.get(router.id) || []) {
      const path_prefix = frontier.path_prefix == null ? null : composePath(prefix, frontier.path_prefix);
      const seed = { owner_id: router.id, method: frontier.method, path_prefix,
        source_node_id: frontier.source_node_id, mount_chain: chain };
      frontierRows.push({ id: `frontier:${digest(stable(seed)).slice(0, 24)}`,
        framework: frontier.framework, method: frontier.method, path_prefix,
        application_id: applicationId, service_id: serviceId, owner_id: router.id,
        mount_chain: chain, source_node_id: frontier.source_node_id,
        evidence_ids: [...new Set([...chain.flatMap(row => row.evidence_ids), frontier.source_node_id])],
        reason: 'unresolved_route_registration' });
    }
    const items = [
      ...(endpointsByOwner.get(router.id) || []).map(value => ({ kind: 'endpoint', value })),
      ...(outgoing.get(router.id) || []).map(value => ({ kind: 'mount', value })),
      ...(middlewareByOwner.get(router.id) || []).map(value => ({ kind: 'middleware', value })),
    ].sort((a, b) => a.value.order - b.value.order);
    let activeMiddleware = [...inheritedMiddleware];
    let scopedMiddleware = [...inheritedScopedMiddleware];
    for (const item of items) {
      if (item.kind === 'middleware') {
        if (!item.value.path || item.value.path === '/') activeMiddleware.push(...item.value.middleware_ids);
        else {
          const pathPrefix = composePath(prefix, item.value.path);
          scopedMiddleware.push(...item.value.middleware_ids.map(id => ({ id, path_prefix: pathPrefix })));
        }
        continue;
      }
      if (item.kind === 'mount') {
        const mount = item.value;
        const child = routers.get(mount.child_id);
        if (!child) continue;
        const chainRow = { router_id: child.id, prefix: mount.prefix,
          source_node_id: mount.source_node_id,
          evidence_ids: [...new Set([mount.source_node_id, mount.path_node_id, ...mount.middleware_ids])] };
        walk(child, composePath(prefix, mount.prefix), [...chain, chainRow],
          [...activeMiddleware, ...mount.middleware_ids], scopedMiddleware, nextSeen, applicationId);
        continue;
      }
      const endpoint = item.value;
      const path_template = composePath(prefix, endpoint.path);
      const matchingScopedMiddleware = scopedMiddleware.filter(row =>
        path_template === row.path_prefix || path_template.startsWith(`${row.path_prefix}/`)).map(row => row.id);
      const mountEvidence = chain.flatMap(row => row.evidence_ids);
      const evidence_ids = [...new Set([...mountEvidence, endpoint.source_node_id,
        ...endpoint.middleware_ids, ...endpoint.terminal_handler_ids])];
      const seed = { method: endpoint.method.toUpperCase(), path_template, mount_chain: chain,
        source_node_id: endpoint.source_node_id, registration_order: flattenedOrder };
      routeRows.push({ id: `route:${digest(stable(seed)).slice(0, 24)}`, framework: 'express',
        method: endpoint.method.toUpperCase(), path_template, mount_chain: chain,
        middleware_ids: [...activeMiddleware, ...matchingScopedMiddleware, ...endpoint.middleware_ids],
        terminal_handler_ids: endpoint.terminal_handler_ids,
        // Kept as an explicit alias because consumers commonly call the terminal
        // continuation a handler while the inventory retains its terminal role.
        handler_ids: endpoint.terminal_handler_ids,
        application_id: applicationId, service_id: serviceId,
        source_node_id: endpoint.source_node_id, evidence_ids,
        registration_order: flattenedOrder++, ambiguity: null,
        middleware_resolution: handlerResolution(
          [...activeMiddleware, ...matchingScopedMiddleware, ...endpoint.middleware_ids], unresolvedHandlerIds),
        handler_resolution: handlerResolution(endpoint.terminal_handler_ids, unresolvedHandlerIds) });
    }
  };
  for (const root of roots) walk(root, '/', [], [], [], new Set(), root.id);

  const competing = new Map();
  for (const route of routeRows) {
    const matchKey = `${route.application_id}\u0000${route.method}\u0000${route.path_template}`;
    const rows = competing.get(matchKey) || [];
    rows.push(route);
    competing.set(matchKey, rows);
  }
  for (const rows of competing.values()) {
    if (rows.length < 2) continue;
    const ids = rows.map(route => route.id).sort();
    for (const route of rows) route.ambiguity = { code: 'multiple_matching_registrations',
      competing_route_ids: ids.filter(id => id !== route.id) };
  }

  output.source_nodes = [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id));
  output.routes = routeRows.sort((a, b) => a.id.localeCompare(b.id));
  output.frontiers = [...new Map(frontierRows.map(row => [row.id, row])).values()]
    .sort((a, b) => a.id.localeCompare(b.id));
  output.diagnostics = [...diagnostics.values()].sort((a, b) => stable(a).localeCompare(stable(b)));
  return output;
}

function hasExport(node) {
  return Boolean(node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword));
}

function requireSpecifier(expression) {
  if (!expression || !ts.isCallExpression(expression) || !ts.isIdentifier(expression.expression)
    || expression.expression.text !== 'require') return null;
  return expression.arguments[0] ? literalPath(expression.arguments[0]) : null;
}

function isModuleExports(node) {
  return ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)
    && node.expression.text === 'module' && node.name.text === 'exports';
}

function commonJsExportName(node) {
  if (!ts.isPropertyAccessExpression(node)) return null;
  if (ts.isIdentifier(node.expression) && node.expression.text === 'exports') return node.name.text;
  if (isModuleExports(node.expression)) return node.name.text;
  return null;
}

function propertyNameText(node) {
  return ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node) ? node.text : null;
}

function assignmentOperator(kind) {
  return kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment;
}

function findNodeAt(root, position) {
  let found = root;
  const visit = node => {
    if (position >= node.getFullStart() && position < node.getEnd()) {
      found = node;
      ts.forEachChild(node, visit);
    }
  };
  visit(root);
  return found;
}

function handlerId(file, expression, resolveExpression, addNode, report, unresolvedHandlerIds) {
  if (ts.isIdentifier(expression) || ts.isPropertyAccessExpression(expression)) {
    const resolved = resolveExpression(file, expression);
    if (resolved.cycle || resolved.unresolved || !resolved.declaration) {
      if (ts.isPropertyAccessExpression(expression)) {
        const id = addNode(file, expression, 'HandlerReference');
        unresolvedHandlerIds.add(id);
        report('unresolved_handler_implementation', file, expression,
          `Handler ${expression.getText()} is retained as a source reference, but its implementation cannot be resolved.`);
        return id;
      }
      report('unresolved_handler_identity', file, expression,
        `Handler ${expression.getText()} cannot be resolved; the route is omitted.`);
      return null;
    }
    return addNode(resolved.file, resolved.declaration, 'HandlerDeclaration');
  }
  if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) return addNode(file, expression, 'HandlerDeclaration');
  report('dynamic_handler_identity', file, expression, 'Dynamic handler identity cannot be resolved; the route is omitted.');
  return null;
}

function handlerResolution(ids, unresolvedHandlerIds) {
  const evidence_ids = [...new Set(ids.filter(id => unresolvedHandlerIds.has(id)))];
  return evidence_ids.length
    ? { status: 'unresolved', reason: 'unresolved_handler_implementation', evidence_ids }
    : { status: 'resolved', reason: null, evidence_ids: [] };
}

function findCyclicRouters(mounts) {
  const graph = new Map();
  for (const mount of mounts) {
    const children = graph.get(mount.parent_id) || [];
    children.push(mount.child_id);
    graph.set(mount.parent_id, children);
  }
  const visiting = new Set();
  const visited = new Set();
  const stack = [];
  const cyclic = new Set();
  const visit = identity => {
    if (visiting.has(identity)) {
      const start = stack.indexOf(identity);
      for (const member of stack.slice(start)) cyclic.add(member);
      return;
    }
    if (visited.has(identity)) return;
    visiting.add(identity);
    stack.push(identity);
    for (const child of graph.get(identity) || []) visit(child);
    stack.pop();
    visiting.delete(identity);
    visited.add(identity);
  };
  for (const identity of graph.keys()) visit(identity);
  return cyclic;
}

export const BACKEND_ROUTE_SCHEMA = SCHEMA;
