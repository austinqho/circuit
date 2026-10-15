import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
import { analyzeReact, createReactRuntimeIntegration } from '../../analysis/index.mjs';

const repository = path.resolve(process.argv[2] || '/tmp/producttrace-librechat-autonomous');
const git = args => execFileSync('git', args, { cwd: repository, encoding: 'utf8' }).trim();
assert.equal(git(['rev-parse', 'HEAD']), '45cc53c40b47645b887c3bb996168e06aaa83f4c');
assert.equal(git(['status', '--porcelain', '--untracked-files=no']), '');
const started = performance.now();
const map = analyzeReact({ repository });
const integration = createReactRuntimeIntegration(map, { requestBridge: true });
const nodes = new Map(map.nodes.map(node => [node.id, node]));
const verified = [];

// These are grading expectations. The analyzer above receives the repository,
// not this file list or these callback names.
for (const [file, handler] of [
  ['client/src/components/Chat/Messages/Content/ToolCall.tsx', 'handleOAuthClick'],
  ['client/src/components/Prompts/sidebar/FilterPrompts.tsx', 'handleSearchChange'],
  ['client/src/components/Nav/SettingsTabs/Data/ImportConversations.tsx', 'handleImportClick'],
  ['client/src/components/Prompts/display/PromptActions.tsx', 'handleUsePrompt'],
]) {
  const source = fs.readFileSync(path.join(repository, file), 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const callbacks = [];
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === handler && node.initializer
      && ts.isCallExpression(node.initializer)) callbacks.push(node.initializer.arguments[0]);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.equal(callbacks.length, 1);
  const candidates = integration.candidates.filter(row => row.source.file === file
    && map.controls.find(control => control.id === row.control_id)?.event === (handler === 'handleSearchChange' ? 'change' : 'click')
    && row.source.text.includes(`{${handler}}`));
  assert.ok(candidates.length, `No bindable control for ${handler}`);
  for (const candidate of candidates) {
    assert.equal(candidate.handler_ids.length, 1);
    const target = nodes.get(candidate.handler_ids[0]);
    assert.equal(target.file, file);
    assert.equal(target.start, callbacks[0].getStart(ast));
    assert.equal(target.end, callbacks[0].end);
    const eventEdge = map.edges.find(edge => edge.relation === 'event_handler'
      && edge.scenario_id === candidate.scenario_id && edge.to === candidate.handler_ids[0]);
    assert.ok(eventEdge.producer_call_id);
    assert.equal(eventEdge.react_semantic_id, 'react/useCallback/18.3.1');
  }
  verified.push({ file, handler, controls: candidates.length });
}

assert.ok(integration.request_bridge.actions.length >= 2,
  'the clean repository must expose multiple independently discovered request controls');
const requestActionSources = new Set(integration.request_bridge.actions.map(action =>
  integration.candidates.find(candidate => candidate.action === action.action)?.source.file));
assert.ok(requestActionSources.size >= 2,
  'request controls in one source file cannot satisfy multi-path acceptance');
assert.ok(map.diagnostics.some(row => row.code === 'memoized_callback_capture_unresolved'));
assert.equal(git(['status', '--porcelain', '--untracked-files=no']), '');
console.log(JSON.stringify({
  elapsed_ms: Math.round(performance.now() - started),
  fingerprint: map.fingerprint,
  verified,
  runtime_candidates: integration.candidates.length,
  request_candidates: integration.request_bridge.actions.length,
  limitation: 'Exact callback source identity only; retained captures, callback invocation, and new end-to-end effects are not proven.',
}, null, 2));
