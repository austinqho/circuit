import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  analyzeBackendRoutes,
  analyzeReact,
  createBrowserRequestBridgeSource,
  createReactRuntimeIntegration,
} from '../analysis/index.mjs';
import {
  discoverCompiledRequestTargets,
  instrumentCompiledRequestSource,
} from './compiled-request-bridge.mjs';
import { runtimeAttributionPlugin } from './runtime-attribution.mjs';
import { collectorSinkSource, normalizeCollectorOption } from './collector-sink.mjs';

export { runtimeAttributionPlugin };

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtimeSource = fs.readFileSync(path.join(packageRoot, 'dist/producttrace-runtime.js'), 'utf8');
// Shipped as a byte-identical dist copy of src/runtime-attribution-browser.js
// (scripts/build.mjs); `src/` is not part of the installed package.
const attributionRuntimeSource = fs.readFileSync(path.join(packageRoot, 'dist/runtime-attribution-browser.js'), 'utf8');
const assetRevision = source => createHash('sha256').update(source).digest('hex').slice(0, 16);
const runtimeRevision = assetRevision(runtimeSource);

function required(value, name) {
  if (typeof value !== 'string' || !value) throw new TypeError(`${name} must be a nonempty string`);
  return value;
}

function portableRelative(root, id) {
  const clean = id.split('?')[0].split('#')[0];
  if (!path.isAbsolute(clean)) return null;
  let absolute;
  try { absolute = fs.realpathSync(clean); } catch { absolute = clean; }
  const relative = path.relative(root, absolute);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;
  return relative.split(path.sep).join('/');
}

function applicationForEntrypoint(backendMap, entrypoint) {
  if (entrypoint === undefined) {
    const ids = [...new Set(backendMap.routes.map(route => route.application_id).filter(Boolean))];
    return ids.length === 1 ? ids[0] : null;
  }
  const normalized = required(entrypoint, 'backendEntrypoint').replaceAll('\\', '/').replace(/^\.\//u, '');
  const ids = [...new Set(backendMap.routes.filter(route =>
    route.application_id?.startsWith(`${normalized}#`)).map(route => route.application_id))];
  if (ids.length !== 1) throw new Error(`backendEntrypoint must identify one backend application; found ${ids.length}`);
  return ids[0];
}

/**
 * Vite integration for a repository-level ProductTrace installation. Analysis
 * reads the whole repository; the plugin receives no control, file, contract,
 * request URL, route, or handler selection.
 */
export function productTraceVitePlugin(options = {}) {
  const repository = fs.realpathSync(required(options.repository, 'repository'));
  const service = required(options.service, 'service');
  // Frontend-only installs (fresh repos) run without the static-era request
  // bridge; the attribution runtime's own transport wrappers emit
  // network.request rows when no bridge is present.
  const requestBridge = options.requestBridge !== false;
  const bridgeEndpoint = requestBridge ? required(options.bridgeEndpoint, 'bridgeEndpoint') : null;
  // G3 element stamps (dev builds). `stamps: false` disables them;
  // `oaiAttributes` is 'detect' (default: write OAI attributes only when
  // document.oai.annotation exists), 'always' (dev opt-in) or 'never'.
  if (options.stamps !== undefined && typeof options.stamps !== 'boolean') throw new TypeError('stamps must be a boolean');
  const oaiAttributes = options.oaiAttributes ?? 'detect';
  if (!['detect', 'always', 'never'].includes(oaiAttributes)) throw new TypeError("oaiAttributes must be 'detect', 'always' or 'never'");
  // G5: `collector` ships every runtime row to a `producttrace-collector
  // --store` at `<collector>/ingest`. Dev-only and localhost-only by default:
  // a non-loopback URL needs `{ url, allowRemote: true }`, and a Vite
  // `production`-mode build gets no sink unless `{ url, force: true }`.
  const collector = normalizeCollectorOption(options.collector);
  // Request/response bodies (network.body rows, bounded and redacted in the
  // page). On by default in dev builds (Vite mode !== 'production'); off in a
  // production-mode build unless `bodies: 'always'`; `bodies: false` turns
  // them off everywhere. Mirrors the collector sink's `force` rule.
  const bodies = options.bodies ?? true;
  if (![true, false, 'always'].includes(bodies)) throw new TypeError("bodies must be true, false or 'always'");
  let viteMode = null;
  const collectorActive = () => Boolean(collector) && (viteMode !== 'production' || collector.force);
  const bodyMode = () => (bodies === false ? 'off' : viteMode === 'production' && bodies !== 'always' ? 'production_off' : 'on');
  // Typed text (D-G1-21): InputEvent/CompositionEvent `data` and printable
  // key text. Off unless `inputText: true`, and then only in a non-production
  // build (warned); always redacted in password/credential fields.
  const inputText = options.inputText ?? false;
  if (typeof inputText !== 'boolean') throw new TypeError('inputText must be true or false');
  const inputTextMode = () => (!inputText ? 'off' : viteMode === 'production' ? 'production_off' : 'on');
  // Control labels (button/link text, field labels; never typed text): on in
  // non-production builds, `labels: false` turns them off, 'always' keeps them in production.
  if (options.labels !== undefined && ![true, false, 'always'].includes(options.labels)) throw new TypeError("labels must be true, false or 'always'");
  const labelMode = () => (options.labels === false ? 'off' : options.labels === 'always' || viteMode !== 'production' ? 'on' : 'production_off');
  const runtimeSettings = () => `globalThis.__PRODUCTTRACE_LABELS__=${JSON.stringify(labelMode())};${options.stamps === false ? 'globalThis.__PRODUCTTRACE_STAMPS__=false;' : ''}${oaiAttributes === 'detect' ? '' : `globalThis.__PRODUCTTRACE_OAI_ATTRIBUTES__=${JSON.stringify(oaiAttributes)};`}globalThis.__PRODUCTTRACE_BODIES__=${JSON.stringify(bodyMode())};globalThis.__PRODUCTTRACE_INPUT_TEXT__=${JSON.stringify(inputTextMode())};${collectorActive() ? collectorSinkSource(collector) : ''}`;
  // Source analysis only names handlers. Code it cannot read must never stop the
  // app from starting: abstain with an empty map and say so once.
  let reactMap;
  try {
    reactMap = analyzeReact({ repository,
      ...(options.maxFiles === undefined ? {} : { maxFiles: options.maxFiles }),
      ...(options.maxBytes === undefined ? {} : { maxBytes: options.maxBytes }) });
  } catch (error) {
    console.warn(`[producttrace] source analysis stopped (${error?.message || error}); recording without handler names.`);
    reactMap = analyzeReact({ files: {} });
  }
  const backendMap = analyzeBackendRoutes({ repository, serviceId: service,
    ...(options.maxFiles === undefined ? {} : { maxFiles: options.maxFiles }),
    ...(options.maxBytes === undefined ? {} : { maxBytes: options.maxBytes }) });
  const applicationId = applicationForEntrypoint(backendMap, options.backendEntrypoint);
  const integration = createReactRuntimeIntegration(reactMap, { requestBridge,
    name: options.name || `producttrace:${path.basename(repository)}` });
  const bridgeManifest = integration.request_bridge || { actions: [] };
  const compiledPlan = requestBridge ? discoverCompiledRequestTargets({ repository, reactMap,
    requestBridge: bridgeManifest }) : { targets: [], diagnostics: [], request_node_ids: [] };
  const compiledTargetsByFile = new Map();
  for (const target of compiledPlan.targets) {
    const values = compiledTargetsByFile.get(target.generated_file) || [];
    values.push(target);
    compiledTargetsByFile.set(target.generated_file, values);
  }
  const loaderSource = requestBridge ? createBrowserRequestBridgeSource(integration,
    { bridgeEndpoint, service, ...(applicationId ? { applicationId } : {}) }) : null;
  const loaderRevision = loaderSource ? assetRevision(loaderSource) : null;
  const transformDiagnostics = [...compiledPlan.diagnostics];
  const transformedFiles = new Map();
  const configPath = options.configPath ? path.resolve(options.configPath) : null;
  const attributionManifestPath = options.attributionManifestPath ? path.resolve(options.attributionManifestPath) : null;

  const snapshot = () => {
    const applied = [...transformedFiles.values()].flat();
    const instrumentedRequestNodes = new Set(applied.filter(row =>
      row.transform === 'request_bridge_request' || row.transform === 'compiled_request_bridge_request')
      .map(row => row.node_id));
    const instrumentedHandlerControls = new Set(applied.filter(row =>
      row.transform === 'request_bridge_handler').map(row => row.control_id));
    const expectedHandlerControls = integration.candidates.filter(candidate =>
      candidate.path.outbound_requests.length > 0).map(candidate => candidate.control_id);
    const missing = [
      ...compiledPlan.request_node_ids.filter(nodeId => !instrumentedRequestNodes.has(nodeId)).map(nodeId => ({
        code: 'request_call_not_in_build', node_id: nodeId,
        message: 'The analyzed outbound request call was not loaded at its source or a proven compiled target.' })),
      ...expectedHandlerControls.filter(controlId => !instrumentedHandlerControls.has(controlId)).map(controlId => ({
        code: 'request_handler_not_in_build', control_id: controlId,
        message: 'The analyzed control handler was not loaded by this browser build.' })),
    ];
    const relevantDiagnostics = transformDiagnostics.filter(diagnostic =>
      !diagnostic.node_id || !instrumentedRequestNodes.has(diagnostic.node_id));
    return ({
    schema: 'producttrace.autonomous-installation.v1',
    repository,
    service,
    application_id: applicationId,
    react_map: reactMap,
    backend_map: backendMap,
    request_bridge: integration.request_bridge,
    request_bridge_enabled: requestBridge,
    coverage: {
      source_files: reactMap.input.file_count,
      controls: reactMap.controls.length,
      runtime_candidates: integration.candidates.length,
      request_actions: bridgeManifest.actions.length,
      source_requests: bridgeManifest.actions.reduce((count, action) =>
        count + action.requests.length, 0),
      backend_routes: backendMap.routes.length,
      transformed_files: [...transformedFiles].map(([file, applied]) => ({ file, applied })),
      request_source_nodes: compiledPlan.request_node_ids.length,
      instrumented_request_source_nodes: instrumentedRequestNodes.size,
      request_action_handlers: expectedHandlerControls.length,
      instrumented_request_action_handlers: instrumentedHandlerControls.size,
        runtime_attribution_manifest: attributionManifestPath,
    },
    frontiers: {
      react: reactMap.diagnostics,
      runtime: integration.diagnostics,
      backend: backendMap.diagnostics,
      transforms: [...relevantDiagnostics, ...missing],
      application_identity: applicationId ? [] : [{ code: 'backend_application_identity_required',
        message: 'Multiple backend applications were discovered; supply the deployed backend entrypoint.' }],
    },
  });
  };
  const writeSnapshot = () => {
    if (configPath) fs.writeFileSync(configPath, JSON.stringify(snapshot(), null, 2));
  };
  writeSnapshot();

  return {
    name: 'producttrace-autonomous-instrumentation',
    enforce: 'pre',
    configResolved(config) {
      viteMode = config?.mode ?? null;
      if (collector && viteMode === 'production' && !collector.force) {
        (config.logger?.warn || console.warn).call(config.logger || console, '[producttrace] collector sink disabled: Vite mode is "production" (pass collector: { url, force: true } to keep it in this build)');
      }
      if (viteMode === 'production' && options.bodies === true) {
        (config.logger?.warn || console.warn).call(config.logger || console, '[producttrace] body capture disabled: Vite mode is "production" (pass bodies: \'always\' to keep it in this build)');
      }
      if (inputText && viteMode === 'production') {
        (config.logger?.warn || console.warn).call(config.logger || console, '[producttrace] input text capture disabled: Vite mode is "production" (inputText is dev-only)');
      }
      if (inputTextMode() === 'on') {
        (config.logger?.warn || console.warn).call(config.logger || console, `[producttrace] input text capture ON in a ${JSON.stringify(viteMode)}-mode build: typed text (InputEvent data, printable keys) is recorded, except in password and credential fields (inputText: false turns this off)`);
      }
      // Any mode other than development (production with 'always', staging, …) is warned.
      if (bodyMode() === 'on' && viteMode !== 'development') {
        (config.logger?.warn || console.warn).call(config.logger || console, `[producttrace] body capture ON in a ${JSON.stringify(viteMode)}-mode build: request and response bodies are recorded, bounded, and redacted by key name only (bodies: false turns this off)`);
      }
    },
    transform(code, id) {
      const relative = portableRelative(repository, id);
      let result = null;
      let displayFile = relative;
      // Keep source-level control stamps separate from function attribution.
      // They are position-preserving JSX attribute edits and therefore safe to
      // apply before Vite's TypeScript/JSX transform; all function wrappers
      // remain in the post-JS runtime-attribution plugin below.
      if (relative && reactMap.files.some(file => file.path === relative)) {
        const stamped = integration.instrumentSource(relative, code, { stampsOnly: true });
        if (!stamped.applied.length) return null;
        return { code: stamped.code, map: null };
      }
      else {
        const clean = id.split('?')[0].split('#')[0];
        let real = null;
        try { real = fs.realpathSync(clean); } catch {}
        const targets = real ? compiledTargetsByFile.get(real) || [] : [];
        if (targets.length > 1) {
          transformDiagnostics.push({ code: 'ambiguous_compiled_request_target', generated_file: real,
            node_ids: targets.map(target => target.node_id),
            message: 'More than one analyzed request maps to this compiled module; no wrapper was applied.' });
          return null;
        }
        if (targets.length === 1) {
          result = instrumentCompiledRequestSource(code, targets[0]);
          displayFile = targets[0].source_file;
        }
      }
      if (!result) return null;
      transformDiagnostics.push(...result.diagnostics);
      if (!result.applied.length) return null;
      const previous = transformedFiles.get(displayFile) || [];
      const unique = new Map([...previous, ...result.applied].map(row => [
        `${row.transform}\0${row.node_id}\0${row.generated_file || ''}`, row,
      ]));
      transformedFiles.set(displayFile, [...unique.values()]);
      return { code: result.code, map: null };
    },
    transformIndexHtml() {
      return { tags: [
        // Install transport hooks before any application module (including
        // preloaded module graphs) can retain fetch/XHR/EventSource. The
        // attribution runtime queues early rows until its normal recorder is
        // available; navigation/reload executes this synchronous inline tag
        // again.
        { tag: 'script', children: runtimeSettings() + attributionRuntimeSource, injectTo: 'head-prepend' },
        // These precede the application's <base> element. Root-relative URLs
        // therefore keep tracing alive on deep entries such as /c/new instead
        // of resolving the assets under /c/.
        { tag: 'script', attrs: { src: `/producttrace-runtime.js?v=${runtimeRevision}` }, injectTo: 'head-prepend' },
        ...(loaderSource ? [{ tag: 'script', attrs: { src: `/producttrace-request-bridge.js?v=${loaderRevision}` }, injectTo: 'head-prepend' }] : []),
      ] };
    },
    // `vite dev`: serve the same assets the build emits.
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = (request.url || '').split('?')[0];
        const source = pathname === '/producttrace-runtime.js' ? runtimeSource : pathname === '/producttrace-request-bridge.js' ? loaderSource : null;
        if (!source) return next();
        response.setHeader('content-type', 'text/javascript');
        response.end(source);
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'producttrace-runtime.js', source: runtimeSource });
      if (loaderSource) this.emitFile({ type: 'asset', fileName: 'producttrace-request-bridge.js', source: loaderSource });
    },
    closeBundle() { writeSnapshot(); },
    api: { reactMap, backendMap, integration, applicationId, snapshot, attributionManifestPath, collector: () => ({ option: collector, mode: viteMode, active: collectorActive() }), bodies: () => ({ option: bodies, mode: viteMode, state: bodyMode() }), inputText: () => ({ option: inputText, mode: viteMode, state: inputTextMode() }) },
  };
}

function repositoryRoot(start) {
  let cursor = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(cursor, '.git'))) return cursor;
    const parent = path.dirname(cursor);
    if (parent === cursor) return path.resolve(start);
    cursor = parent;
  }
}

/**
 * One-line installation: `plugins: [...producttrace(), react()]`.
 * Returns the source-stamp/request-bridge plugin and the post-transform
 * runtime-attribution plugin. Every option is optional:
 * - repository: the analyzed repository (default: nearest ancestor of the
 *   working directory containing `.git`, else the working directory);
 * - service: backend service name (default: repository directory name);
 * - bridgeEndpoint: where the browser bridge posts (default
 *   `/__producttrace/bridge`, a same-origin path the app does not own);
 * - attributionManifestPath / configPath: default under
 *   `<cwd>/node_modules/.producttrace/`, beside Vite's own cache.
 * - firstParty: `{ include, exclude }` repository-relative globs deciding which
 *   sources are instrumented. Default excludes any path with a node_modules,
 *   vendor, dist, build or .git segment; workspace packages consumed from a
 *   built `dist/` need `include: ['packages/<name>/dist/**']`.
 * - bodies: request/response body capture (network.body rows). Default on in
 *   dev builds (Vite mode !== 'production'), off in production-mode builds;
 *   `'always'` keeps it in a production build (with a warning), `false`
 *   turns it off. Bodies are cut to 4 KB and JSON keys matching
 *   pass|secret|token|auth|cookie|session|credential|ssn|card are redacted
 *   in the page before the row leaves it.
 * - inputText: record typed text (InputEvent/CompositionEvent `data`,
 *   printable key and code) on dom.action rows. Default false: rows carry
 *   inputType, data_length and credential_field only, and printable keys read
 *   "Printable". `true` turns it on in non-production builds only (warned);
 *   password and credential fields are always redacted.
 * Set `runtimeAttribution: false` to install only the first plugin.
 */
export function producttrace(options = {}) {
  const repository = fs.realpathSync(options.repository || repositoryRoot(process.cwd()));
  const cacheDir = path.join(process.cwd(), 'node_modules', '.producttrace');
  const attributionManifestPath = options.attributionManifestPath
    || path.join(cacheDir, 'runtime-attribution-manifest.json');
  const configPath = options.configPath || path.join(cacheDir, 'installation.json');
  fs.mkdirSync(path.dirname(attributionManifestPath), { recursive: true });
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const { runtimeAttribution = true, firstParty, ...rest } = options;
  const staticPlugin = productTraceVitePlugin({
    ...rest,
    repository,
    service: options.service || path.basename(repository),
    bridgeEndpoint: options.bridgeEndpoint || '/__producttrace/bridge',
    configPath,
    attributionManifestPath,
  });
  return runtimeAttribution
    ? [staticPlugin, runtimeAttributionPlugin({ repository, manifestPath: attributionManifestPath, firstParty })]
    : [staticPlugin];
}
