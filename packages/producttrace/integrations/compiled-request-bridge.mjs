import { configureRequestCall } from '../analysis/request-call-transform.mjs';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  GREATEST_LOWER_BOUND,
  TraceMap,
  generatedPositionFor,
  originalPositionFor,
} from '@jridgewell/trace-mapping';
import ts from 'typescript';

const sha256 = value => createHash('sha256').update(value).digest('hex');

function walkMaps(root) {
  const maps = [];
  const visit = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile() && entry.name.endsWith('.map')) maps.push(absolute);
    }
  };
  visit(root);
  return maps;
}

function owningPackage(repository, sourceFile) {
  const absolute = path.join(repository, ...sourceFile.split('/'));
  let directory = path.dirname(absolute);
  while (directory !== repository && directory.startsWith(`${repository}${path.sep}`)) {
    const manifest = path.join(directory, 'package.json');
    if (fs.existsSync(manifest)) {
      const parsed = JSON.parse(fs.readFileSync(manifest, 'utf8'));
      if (typeof parsed.name === 'string' && parsed.name) return { directory, name: parsed.name };
    }
    directory = path.dirname(directory);
  }
  return null;
}

function lineColumn(source, offset) {
  const lines = source.slice(0, offset).split('\n');
  return { line: lines.length, column: lines.at(-1).length };
}

function callExpressions(source, filename) {
  const parsed = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true,
    filename.endsWith('.ts') || filename.endsWith('.mts') ? ts.ScriptKind.TS : ts.ScriptKind.JS);
  const calls = [];
  const visit = node => {
    if (ts.isCallExpression(node)) calls.push({ start: node.getStart(parsed), end: node.getEnd() });
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return calls;
}

function sourceMapMatches(raw, index, sourceHash) {
  return Array.isArray(raw.sourcesContent) && typeof raw.sourcesContent[index] === 'string'
    && sha256(raw.sourcesContent[index]) === sourceHash;
}

/**
 * Locate analyzed TypeScript request calls inside installed, precompiled
 * workspace packages. A target is accepted only when the package source map
 * contains the exact analyzed source snapshot and maps the call start to one
 * JavaScript CallExpression. No generated string or route value is searched.
 */
export function discoverCompiledRequestTargets({ repository, reactMap, requestBridge }) {
  const nodeById = new Map(reactMap.nodes.map(node => [node.id, node]));
  const fileHashByPath = new Map(reactMap.files.map(file => [file.path, file.sha256]));
  const requestsByNode = new Map();
  for (const action of requestBridge.actions) for (const request of action.requests) {
    const values = requestsByNode.get(request.invocation_call_id) || [];
    values.push({ action: action.action,
      contract_application_id: request.contract_application_id,
      method: request.method });
    requestsByNode.set(request.invocation_call_id, values);
  }

  const targets = [];
  const diagnostics = [];
  const packageCache = new Map();
  for (const [nodeId, requests] of requestsByNode) {
    const sourceNode = nodeById.get(nodeId);
    const sourceHash = sourceNode && fileHashByPath.get(sourceNode.file);
    if (!sourceNode || !sourceHash) {
      diagnostics.push({ code: 'compiled_request_source_missing', node_id: nodeId,
        message: 'The analyzed request call has no source snapshot, so compiled output cannot be aligned.' });
      continue;
    }
    const owner = owningPackage(repository, sourceNode.file);
    if (!owner) continue; // First-party application source is handled by the normal Vite transform.
    const installed = path.join(repository, 'node_modules', ...owner.name.split('/'));
    if (!fs.existsSync(installed)) {
      diagnostics.push({ code: 'compiled_workspace_package_missing', node_id: nodeId,
        source_file: sourceNode.file, package: owner.name,
        message: 'The workspace package is not installed at the repository root; source transformation remains the only path.' });
      continue;
    }
    let maps = packageCache.get(installed);
    if (!maps) {
      maps = walkMaps(installed);
      packageCache.set(installed, maps);
    }
    const originalSource = fs.readFileSync(path.join(repository, ...sourceNode.file.split('/')), 'utf8');
    const originalStart = lineColumn(originalSource, sourceNode.start);
    const originalEnd = lineColumn(originalSource, sourceNode.end - 1);
    let matches = 0;
    for (const mapFile of maps) {
      let raw;
      try { raw = JSON.parse(fs.readFileSync(mapFile, 'utf8')); } catch { continue; }
      if (!Array.isArray(raw.sources)) continue;
      for (let index = 0; index < raw.sources.length; index++) {
        if (!sourceMapMatches(raw, index, sourceHash)) continue;
        const generatedFile = mapFile.slice(0, -4);
        if (!fs.existsSync(generatedFile)) continue;
        const generatedSource = fs.readFileSync(generatedFile, 'utf8');
        const trace = new TraceMap(raw, mapFile);
        const start = generatedPositionFor(trace, { source: raw.sources[index],
          line: originalStart.line, column: originalStart.column });
        if (start.line === null || start.column === null) continue;
        const mappedStart = originalPositionFor(trace, { line: start.line, column: start.column });
        if (mappedStart.source !== trace.resolvedSources[index]
          || mappedStart.line !== originalStart.line
          || mappedStart.column !== originalStart.column) continue;
        const lines = generatedSource.split('\n');
        if (!lines[start.line - 1]) continue;
        const generatedOffset = lines.slice(0, start.line - 1)
          .reduce((count, line) => count + line.length + 1, 0) + start.column;
        const calls = callExpressions(generatedSource, generatedFile)
          .filter(call => call.start === generatedOffset);
        if (calls.length !== 1) continue;
        const call = calls[0];
        const callEnd = lineColumn(generatedSource, call.end - 1);
        const mappedEnd = originalPositionFor(trace, { line: callEnd.line,
          column: callEnd.column, bias: GREATEST_LOWER_BOUND });
        if (mappedEnd.source !== mappedStart.source || mappedEnd.line !== originalEnd.line
          || mappedEnd.column > originalEnd.column
          || (mappedEnd.line === originalStart.line && mappedEnd.column < originalStart.column)) continue;
        targets.push({ node_id: nodeId, source_file: sourceNode.file, package: owner.name,
          generated_file: fs.realpathSync(generatedFile), generated_sha256: sha256(generatedSource),
          start: call.start, end: call.end, requests });
        matches++;
      }
    }
    if (matches === 0) diagnostics.push({ code: 'compiled_request_target_unresolved', node_id: nodeId,
      source_file: sourceNode.file, package: owner.name,
      message: 'No installed source map proved one compiled JavaScript call for this request source node.' });
  }
  return { targets, diagnostics, request_node_ids: [...requestsByNode.keys()] };
}

export function instrumentCompiledRequestSource(source, target) {
  if (sha256(source) !== target.generated_sha256) return { code: source, applied: [],
    diagnostics: [{ code: 'compiled_source_snapshot_mismatch', node_id: target.node_id,
      generated_file: target.generated_file,
      message: 'The loaded JavaScript differs from the source-mapped snapshot; the request was not wrapped.' }] };
  const original = source.slice(target.start, target.end);
  const unique = [...new Map(target.requests.map(request => [
    `${request.action}\0${request.contract_application_id}`, request,
  ])).values()];
  const metadata = JSON.stringify({ requests: unique });
  const configured = configureRequestCall(original, unique);
        const replacement = `(globalThis.__productTraceRequestBridge ? globalThis.__productTraceRequestBridge.request(${metadata}, () => (${configured})) : (${original}))`;
  return { code: source.slice(0, target.start) + replacement + source.slice(target.end),
    applied: [{ file: target.source_file, generated_file: target.generated_file,
      node_id: target.node_id, event: 'request', control_id: null,
      transform: 'compiled_request_bridge_request' }], diagnostics: [] };
}
