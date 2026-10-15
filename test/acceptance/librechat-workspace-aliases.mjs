import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { analyzeReact, createReactRuntimeIntegration } from '../../analysis/index.mjs';

// Expected source paths are a post-analysis grader, never analyzer inputs.
const repository = path.resolve(process.argv[2] || '/tmp/producttrace-librechat-autonomous');
const git = args => execFileSync('git', args, { cwd: repository, encoding: 'utf8' }).trim();
assert.equal(git(['rev-parse', 'HEAD']), '45cc53c40b47645b887c3bb996168e06aaa83f4c');
assert.equal(git(['status', '--porcelain', '--untracked-files=no']), '', 'Acceptance requires unchanged tracked sources');
const start = performance.now();
const map = analyzeReact({ repository });
const integration = createReactRuntimeIntegration(map, { requestBridge: true });
const nodes = new Map(map.nodes.map(node => [node.id, node]));
const verifiedPaths = [];
for (const [call, file] of [
  ['clearMessagesCache(queryClient, conversation?.conversationId)', 'client/src/utils/messages.ts'],
  ['findConversationInInfinite(convos, conversationId)', 'client/src/utils/convos.ts'],
  ['removeCharIfLast(textAreaRef.current, commandChar)', 'client/src/utils/textarea.ts'],
  ['buildShareLinkUrl(shareId)', 'client/src/utils/share.ts'],
]) {
  const matches = map.edges.filter(edge => edge.relation === 'call' && nodes.get(edge.from)?.text === call);
  assert.ok(matches.length, `Missing actual source call: ${call}`);
  assert.ok(matches.every(edge => nodes.get(edge.to)?.file === file), `Foreign target for ${call}`);
  verifiedPaths.push({ call, target_file: file, edges: matches.length });
}
const aliases = map.resolution.module_aliases.filter(row => row.specifier === '~/hooks');
assert.deepEqual([...new Set(aliases.map(row => row.file))].sort(), ['client/src/hooks/index.ts', 'packages/client/src/hooks/index.ts']);
assert.ok(aliases.every(row => row.importer.startsWith(row.file.startsWith('client/') ? 'client/' : 'packages/client/')));
assert.equal(map.library_backlog.filter(row => row.package === '~/hooks').length, 0);
assert.equal(integration.request_bridge.actions.length, 1, 'Existing full request path must remain admitted');
assert.equal(git(['status', '--porcelain', '--untracked-files=no']), '');
const report = { schema: 'producttrace.workspace-alias-acceptance.v1',
  revision: git(['rev-parse', 'HEAD']), fingerprint: map.fingerprint,
  elapsed_ms: Math.round(performance.now() - start), verified_source_paths: verifiedPaths,
  controls: map.controls.length, source_edges: map.edges.length,
  runtime_candidates: integration.candidates.length, complete_request_candidates: integration.request_bridge.actions.length,
  library_backlog_entries: map.library_backlog.length,
  limitation: 'Source resolution verified; no new end-to-end runtime path is claimed.' };
if (process.argv[3]) fs.writeFileSync(process.argv[3], JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
