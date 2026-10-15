const SCHEMA = 'producttrace.request-route-join.v1';
const REQUEST_BASES = new Set(['source_candidate', 'runtime_observation']);
const ORDERED_FRAMEWORKS = new Set(['express']);
const SPECIFIC_FRAMEWORKS = new Set(['fastify', 'next', 'next.js', 'nextjs']);
const METHOD = /^[A-Z][A-Z0-9!#$%&'*+.^_`|~-]*$/u;

function copy(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function normalizeFramework(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function normalizeMethod(value) {
  if (typeof value !== 'string') return null;
  const method = value.trim().toUpperCase();
  return METHOD.test(method) ? method : null;
}

function normalizeService(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  return value.trim();
}

function normalizeEvidenceIds(value) {
  return Array.isArray(value)
    ? [...new Set(value.filter(id => typeof id === 'string' && id !== ''))].sort()
    : [];
}

function parseRequestUrl(value, basis) {
  if (typeof value !== 'string' || value.trim() === '') {
    return { error: 'invalid_request_url', path: null, query: [] };
  }
  const source = value.trim();
  // Static source candidates sometimes preserve an interpolation as text. It
  // is safer to leave that request unresolved than to treat braces as bytes a
  // browser actually sent. Runtime observations may contain literal colons or
  // asterisks, so those characters alone are not rejected there.
  if (basis === 'source_candidate'
      && (/\$\{|\{\{|\}\}/u.test(source) || source.split(/[?#]/u, 1)[0].split('/').some(segment => /^[:*]/u.test(segment)))) {
    return { error: 'dynamic_request_url', path: null, query: [] };
  }
  if (!source.startsWith('/') && !/^https?:\/\//iu.test(source)) {
    // A path such as "projects" depends on the page URL. The matcher does not
    // receive that base URL, so resolving it here would invent a pathname.
    return { error: 'relative_request_url_without_base', path: null, query: [] };
  }
  let parsed;
  try {
    parsed = source.startsWith('/') ? new URL(source, 'https://producttrace.invalid') : new URL(source);
  } catch {
    return { error: 'invalid_request_url', path: null, query: [] };
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return { error: 'unsupported_request_protocol', path: null, query: [] };
  }
  const query = [...parsed.searchParams.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1
      : left.value < right.value ? -1 : left.value > right.value ? 1 : 0);
  return { error: null, path: parsed.pathname || '/', query };
}

function invalidTemplate(pathTemplate) {
  return {
    valid: false,
    path_template: pathTemplate,
    segments: [],
    reason: 'unsupported_dynamic_route_template',
  };
}

function parseTemplate(pathTemplate) {
  if (typeof pathTemplate !== 'string' || !pathTemplate.startsWith('/')
      || pathTemplate.includes('#')
      || /\$\{|\{\{|\[[^\]]*\]|[(){}]/u.test(pathTemplate)) return invalidTemplate(pathTemplate);
  const raw = pathTemplate === '/' ? [] : pathTemplate.slice(1).split('/');
  const segments = [];
  for (let index = 0; index < raw.length; index += 1) {
    const value = raw[index];
    const terminal = index === raw.length - 1;
    if (value === '*' || /^\*[A-Za-z_$][\w$]*$/u.test(value) || /^:[A-Za-z_$][\w$]*\*$/u.test(value)) {
      if (!terminal) return invalidTemplate(pathTemplate);
      segments.push({ kind: 'wildcard', name: value.replace(/^[:*]/u, '').replace(/\*$/u, '') || null });
    } else {
      const parameter = /^:([A-Za-z_$][\w$]*)(\?)?$/u.exec(value);
      if (parameter) segments.push({ kind: parameter[2] ? 'optional' : 'parameter', name: parameter[1] });
      else if (value === '' || /[*:+]/u.test(value)) return invalidTemplate(pathTemplate);
      else segments.push({ kind: 'literal', value: decodeLiteral(value) });
    }
  }
  return { valid: true, path_template: pathTemplate, segments, reason: null };
}

function decodeLiteral(value) {
  try { return decodeURIComponent(value); } catch { return value; }
}

function pathSegments(pathname) {
  if (pathname === '/') return [];
  const path = pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  return path.slice(1).split('/').map(decodeLiteral);
}

function templateMatches(template, pathname, caseSensitive = true) {
  const actual = pathSegments(pathname);
  const visit = (templateIndex, pathIndex) => {
    if (templateIndex === template.segments.length) return pathIndex === actual.length;
    const segment = template.segments[templateIndex];
    if (segment.kind === 'wildcard') return true;
    if (segment.kind === 'optional') {
      return visit(templateIndex + 1, pathIndex)
        || (pathIndex < actual.length && visit(templateIndex + 1, pathIndex + 1));
    }
    if (pathIndex >= actual.length) return false;
    if (segment.kind === 'literal') {
      const expected = caseSensitive ? segment.value : segment.value.toLocaleLowerCase('en-US');
      const observed = caseSensitive ? actual[pathIndex] : actual[pathIndex].toLocaleLowerCase('en-US');
      if (expected !== observed) return false;
    }
    return visit(templateIndex + 1, pathIndex + 1);
  };
  return visit(0, 0);
}

function unsupportedTemplateCouldCompete(pathTemplate, pathname) {
  if (typeof pathTemplate !== 'string' || !pathTemplate.startsWith('/')) return true;
  const actual = pathSegments(pathname);
  const raw = pathTemplate === '/' ? [] : pathTemplate.slice(1).split('/');
  // Compare the literal prefix before the unsupported construct. A dynamic
  // route under /admin cannot shadow a proven /api match, while /api/${name}
  // still correctly forces abstention for /api/projects.
  for (let index = 0; index < raw.length; index += 1) {
    const value = raw[index];
    if (/[$:*+?()[\]{}]/u.test(value)) return true;
    if (index >= actual.length || decodeLiteral(value) !== actual[index]) return false;
  }
  return raw.length === actual.length;
}

function specificity(template) {
  const kinds = template.segments.map(segment => ({ literal: 4, parameter: 3, optional: 2, wildcard: 1 })[segment.kind]);
  return {
    kinds,
    literals: template.segments.filter(segment => segment.kind === 'literal').length,
    wildcards: template.segments.filter(segment => segment.kind === 'wildcard').length,
    optionals: template.segments.filter(segment => segment.kind === 'optional').length,
    length: template.segments.length,
  };
}

function compareSpecificity(left, right) {
  const summary = (left.literals - right.literals)
    || (right.wildcards - left.wildcards)
    || (right.optionals - left.optionals);
  if (summary) return summary;
  const length = Math.max(left.kinds.length, right.kinds.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (left.kinds[index] || 0) - (right.kinds[index] || 0);
    if (difference) return difference;
  }
  return left.length - right.length;
}

function routeService(route) {
  return normalizeService(route.service ?? route.service_id);
}

function routeMethodMatches(routeMethod, requestMethod) {
  const normalized = normalizeMethod(routeMethod);
  return normalized === requestMethod || routeMethod === '*' || normalized === 'ALL';
}

function result(status, reason, request, match = null, candidates = []) {
  return {
    schema: SCHEMA,
    status,
    reason,
    request,
    match: match ? copy(match) : null,
    candidates: candidates.map(copy),
    // A runtime HTTP observation confirms that a request left the browser. It
    // does not prove that a particular handler ran; that requires backend span
    // evidence joined in a later module.
    handler_confirmation: 'source_route_match_only',
  };
}

function validateRoutes(routes) {
  if (!Array.isArray(routes)) throw new TypeError('routes must be an array');
  for (const route of routes) {
    if (!route || typeof route !== 'object' || typeof route.id !== 'string' || route.id === ''
        || typeof route.framework !== 'string' || route.framework === ''
        || typeof route.method !== 'string' || typeof route.path_template !== 'string'
        || !Array.isArray(route.handler_ids) || !Array.isArray(route.middleware_ids)
        || !Array.isArray(route.evidence_ids)) {
      throw new TypeError('Each route must provide id, framework, method, path_template, handler_ids, middleware_ids, and evidence_ids');
    }
  }
}

function inventoryParts(inventory) {
  if (Array.isArray(inventory)) return { routes: inventory, frontiers: [], completeMap: false, serviceId: null };
  if (!inventory || inventory.schema !== 'producttrace.backend-route-map.v1'
      || !Array.isArray(inventory.routes) || !Array.isArray(inventory.frontiers)) {
    throw new TypeError('routes must be an array or a producttrace.backend-route-map.v1 result');
  }
  return { routes: inventory.routes, frontiers: inventory.frontiers, completeMap: true,
    serviceId: normalizeService(inventory.service_id) ?? null };
}

function frontierCouldMatch(frontier, method, pathname, service, applicationId) {
  const frontierMethod = normalizeMethod(frontier.method);
  if (frontierMethod !== 'ALL' && frontierMethod !== method) return false;
  const frontierService = routeService(frontier);
  if (service !== null && frontierService !== service) return false;
  if (applicationId !== null && frontier.application_id !== applicationId) return false;
  if (frontier.path_prefix == null || frontier.path_prefix === '/') return true;
  const prefix = frontier.path_prefix.endsWith('/') && frontier.path_prefix !== '/'
    ? frontier.path_prefix.slice(0, -1) : frontier.path_prefix;
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/**
 * Join one normalized frontend request to the backend route that would receive
 * it. This is a source-level prediction even when the request itself was seen
 * at runtime; backend telemetry must separately confirm handler execution.
 */
export function matchRequestToRoute(input, inventory) {
  const { routes, frontiers, completeMap, serviceId } = inventoryParts(inventory);
  validateRoutes(routes);
  if (!input || typeof input !== 'object') throw new TypeError('request must be an object');
  const basis = input.basis === undefined ? 'source_candidate' : input.basis;
  if (!REQUEST_BASES.has(basis)) throw new TypeError('request basis must be source_candidate or runtime_observation');
  const method = normalizeMethod(input.method);
  const service = normalizeService(input.service);
  const applicationId = normalizeService(input.application_id);
  const parsed = parseRequestUrl(input.url, basis);
  const request = {
    basis,
    method,
    url: typeof input.url === 'string' ? input.url : null,
    path: parsed.path,
    query: parsed.query,
    service: service === undefined ? null : service,
    application_id: applicationId === undefined ? null : applicationId,
    evidence_ids: normalizeEvidenceIds(input.evidence_ids),
  };

  if (!method) return result('unresolved', 'invalid_request_method', request);
  if (service === undefined) return result('unresolved', 'invalid_request_service', request);
  if (applicationId === undefined) return result('unresolved', 'invalid_request_application', request);
  if (parsed.error) return result('unresolved', parsed.error, request);
  if (routes.length === 0) return result('unresolved', 'empty_route_inventory', request);
  if (completeMap && serviceId !== null && service === null) {
    return result('unresolved', 'request_service_required', request, null, routes);
  }
  const applicationIds = [...new Set(routes.map(route => route.application_id).filter(Boolean))];
  if (completeMap && applicationId === null && applicationIds.length > 1) {
    return result('unresolved', 'request_application_required', request, null, routes);
  }
  const blockingFrontiers = frontiers.filter(frontier =>
    frontierCouldMatch(frontier, method, parsed.path, service, applicationId));
  if (blockingFrontiers.length) {
    return result('unresolved', 'backend_inventory_gap', request, null, blockingFrontiers);
  }

  const serviceCandidates = service === null
    ? routes
    : routes.filter(route => routeService(route) === service);
  if (serviceCandidates.length === 0) return result('unresolved', 'no_service_match', request);
  const applicationCandidates = applicationId === null
    ? serviceCandidates
    : serviceCandidates.filter(route => route.application_id === applicationId);
  if (applicationCandidates.length === 0) return result('unresolved', 'no_application_match', request);

  const methodCandidates = applicationCandidates.filter(route => routeMethodMatches(route.method, method));
  if (methodCandidates.length === 0) return result('unresolved', 'no_method_match', request, null, serviceCandidates);

  const parsedCandidates = methodCandidates.map((route, inputOrder) => ({
    route,
    inputOrder,
    template: parseTemplate(route.path_template),
  }));
  const unsupported = parsedCandidates.filter(candidate => !candidate.template.valid
    && unsupportedTemplateCouldCompete(candidate.route.path_template, parsed.path));
  if (unsupported.length) {
    return result('unresolved', 'unsupported_dynamic_route_template', request, null,
      unsupported.map(candidate => candidate.route));
  }

  const matches = parsedCandidates.filter(candidate => templateMatches(candidate.template, parsed.path,
    normalizeFramework(candidate.route.framework) !== 'express'));
  if (matches.length === 0) return result('unresolved', 'no_path_match', request, null, methodCandidates);
  const inventoryAmbiguities = matches.filter(candidate => candidate.route.ambiguity !== null
    && candidate.route.ambiguity !== undefined);
  if (inventoryAmbiguities.length) {
    return result('ambiguous', 'inventory_route_ambiguity', request, null,
      matches.map(candidate => candidate.route));
  }
  if (matches.length === 1) return result('resolved', 'unique_route_match', request, matches[0].route);

  const frameworks = [...new Set(matches.map(candidate => normalizeFramework(candidate.route.framework)))];
  if (frameworks.length !== 1) {
    return result('ambiguous', 'mixed_framework_precedence', request, null, matches.map(candidate => candidate.route));
  }
  const [framework] = frameworks;
  if (ORDERED_FRAMEWORKS.has(framework)) {
    const ordered = matches.filter(candidate => Number.isSafeInteger(candidate.route.registration_order));
    if (ordered.length !== matches.length) {
      return result('ambiguous', 'framework_route_order_unavailable', request, null,
        matches.map(candidate => candidate.route));
    }
    const firstOrder = Math.min(...ordered.map(candidate => candidate.route.registration_order));
    const first = ordered.filter(candidate => candidate.route.registration_order === firstOrder);
    if (first.length !== 1) {
      return result('ambiguous', 'duplicate_route_precedence', request, null,
        first.map(candidate => candidate.route));
    }
    return result('resolved', 'framework_registration_order', request, first[0].route);
  }

  if (!SPECIFIC_FRAMEWORKS.has(framework)) {
    return result('ambiguous', 'framework_precedence_unknown', request, null,
      matches.map(candidate => candidate.route));
  }
  const scored = matches.map(candidate => ({ ...candidate, specificity: specificity(candidate.template) }));
  let best = scored[0].specificity;
  for (const candidate of scored.slice(1)) {
    if (compareSpecificity(candidate.specificity, best) > 0) best = candidate.specificity;
  }
  const winners = scored.filter(candidate => compareSpecificity(candidate.specificity, best) === 0);
  if (winners.length !== 1) {
    return result('ambiguous', 'duplicate_route_precedence', request, null,
      winners.map(candidate => candidate.route));
  }
  return result('resolved', 'path_specificity', request, winners[0].route);
}

export const REQUEST_ROUTE_JOIN_SCHEMA = SCHEMA;
