import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { analyzeReact } from '../analysis/index.mjs';
import {compileReactSources} from '../analysis/react-compiler.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = `export function App() { const save = () => {}; return <button onClick={save}>Save</button>; }`;
async function temporary(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'producttrace-react-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}
async function file(directory, relative, content = source) {
  await mkdir(path.dirname(path.join(directory, relative)), { recursive: true });
  await writeFile(path.join(directory, relative), content);
}
function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 60000 });
  assert.equal(result.status, 0, `${command} failed: ${result.stderr || result.stdout || result.error}`);
  return result.stdout;
}

test('repository snapshots are read-only, exclude generated/tests, and remain identical after relocation', async t => {
  const directory = await temporary(t);
  const a = path.join(directory, 'first');
  const b = path.join(directory, 'second');
  for (const repo of [a, b]) {
    await file(repo, 'src/App.tsx');
    await file(repo, 'node_modules/Other.tsx', 'this is invalid');
    await file(repo, 'dist/App.js', 'this is invalid');
    await file(repo, '.hidden/Hidden.tsx', 'this is invalid');
    await file(repo, 'src/App.test.tsx', 'this is invalid');
  }
  const first = analyzeReact({ repository: a });
  const second = analyzeReact({ repository: b });
  assert.deepEqual(first, second);
  assert.equal(first.input.file_count, 1);
  assert.equal(first.input.complete, true);
  assert.equal(await readFile(path.join(a, 'src/App.tsx'), 'utf8'), source);
  assert.ok(!JSON.stringify(first).includes(directory));
});

test('input limits retain omitted-file diagnostics and cannot imply complete source coverage', async t => {
  const directory = await temporary(t);
  await file(directory, 'A.tsx');
  await file(directory, 'B.tsx');
  for (const options of [
    { repository: directory, maxFiles: 1 },
    { files: { 'A.tsx': source, 'B.tsx': source }, maxFiles: 1 },
    { files: { 'A.tsx': source, 'B.tsx': source }, maxBytes: Buffer.byteLength(source) },
  ]) {
    const result = analyzeReact(options);
    assert.equal(result.input.file_count, 1);
    assert.equal(result.input.complete, false);
    assert.ok(result.diagnostics.some(d => ['source_file_limit', 'source_byte_limit'].includes(d.code)));
    assert.equal(result.claims.source_complete, false);
    assert.equal(result.claims.runtime_observed, false);
  }
});

test('external source symlinks and missing includes remain explicit, and no target module is executed', async t => {
  const directory = await temporary(t);
  const repo = path.join(directory, 'app');
  await file(repo, 'App.tsx', `throw new Error('NEVER EXECUTE');\n${source}`);
  await file(directory, 'outside/External.tsx');
  await symlink(path.join(directory, 'outside/External.tsx'), path.join(repo, 'External.tsx'));
  const result = analyzeReact({ repository: repo, include: ['.', 'missing.tsx'] });
  assert.equal(result.input.file_count, 1);
  assert.equal(result.input.complete, false);
  assert.ok(result.diagnostics.some(d => d.code === 'external_source_symlink'));
  assert.ok(result.diagnostics.some(d => d.code === 'unreadable_source'));
});

test('invalid snapshots and empty input cannot silently become valid source maps', () => {
  assert.throws(() => analyzeReact(), /exactly one/);
  assert.throws(() => analyzeReact({ repository: '.', files: {} }), /exactly one/);
  assert.throws(() => analyzeReact({ files: { '../escape.tsx': source } }), /escapes/);
  assert.throws(() => analyzeReact({ files: { '/absolute.tsx': source } }), /relative/);
  assert.throws(() => analyzeReact({ files: { './App.tsx': source, 'App.tsx': source } }), /Duplicate/);
  assert.throws(() => analyzeReact({ files: { 'App.tsx': 5 } }), /string/);
  assert.throws(() => analyzeReact({ files: {}, maxFiles: 0 }), /positive/);
  const empty = analyzeReact({ files: {} });
  assert.equal(empty.input.complete, false);
  assert.ok(empty.diagnostics.some(d => d.code === 'empty_source_input'));
});

test('workspace Button forwardRef redirects separate source placements to their own callbacks', async t => {
  const directory = await temporary(t);
  await file(directory, 'packages/ui/package.json', '{"name":"@demo/ui"}');
  await file(directory, 'packages/ui/src/index.ts', "export * from './Button';");
  await file(directory, 'packages/ui/src/Button.tsx', `import * as React from 'react';
    const Button = React.forwardRef(({ asChild = false, ...props }, ref) => {
      const Comp = asChild ? 'a' : 'button';
      return <Comp ref={ref} {...props} />;
    });
    export { Button };`);
  await file(directory, 'src/Auth.tsx', `import { Button } from '@demo/ui';
    function goToLogin() {}
    export function Auth() { return <Button onClick={goToLogin}>Continue</Button>; }`);
  await file(directory, 'src/Feed.tsx', `import { Button } from '@demo/ui';
    function publishPost() {}
    export function Feed() { return <Button onClick={publishPost}>Continue</Button>; }`);
  const snapshot = analyzeReact({ repository: directory });
  assert.ok(!snapshot.components.some(component=>component.name==='Button'),'uninstalled React must not receive an assumed wrapper rule');
  // Exercise repository-discovered workspace aliases with explicit unit-fixture
  // attestation. Installed React behavior is checked by the browser acceptances.
  const files=Object.fromEntries(await Promise.all(snapshot.files.map(async row=>[row.path,await readFile(path.join(directory,row.path),'utf8')])));
  const result={...compileReactSources(files,{moduleAliases:Object.fromEntries(snapshot.resolution.module_aliases.map(row=>[row.specifier,row])),
    packages:{react:{version:'18.3.1',verified:true,verification_sha256:'workspace-wrapper-fixture'}}}),resolution:snapshot.resolution};
  assert.deepEqual(result.resolution.module_aliases.map(alias => [alias.specifier, alias.file]),
    [['@demo/ui', 'packages/ui/src/index.ts']]);
  assert.equal(result.resolution.module_aliases[0].manifest, 'packages/ui/package.json');
  assert.match(result.resolution.module_aliases[0].manifest_sha256, /^[a-f0-9]{64}$/);
  const nodes = new Map(result.nodes.map(node => [node.id, node]));
  const buttons = result.components.filter(component => component.name === 'Button');
  assert.equal(buttons.length, 1);
  const placements = result.placements.filter(placement => placement.component_id === buttons[0].id && placement.parent_id);
  assert.equal(placements.length, 2);
  const controls = placements.map(placement => {
    const values = result.controls.filter(control => control.placement_id === placement.id && control.event === 'click');
    assert.equal(values.length, 1);
    return values[0];
  });
  const handlers = controls.map(control => control.handler_ids.map(id => nodes.get(id)?.text).join('\n'));
  assert.match(handlers[0] + handlers[1], /goToLogin/);
  assert.match(handlers[0] + handlers[1], /publishPost/);
  assert.ok(handlers.every(text => !(text.includes('goToLogin') && text.includes('publishPost'))));
  assert.notEqual(controls[0].id, controls[1].id);
});

test('packed Node analysis API and TypeScript declarations work in an isolated consumer', async t => {
  const directory = await temporary(t);
  const packed = JSON.parse(run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', directory], root))[0];
  assert.ok(packed.files.some(entry => entry.path === 'analysis/index.mjs'));
  assert.ok(packed.files.some(entry => entry.path === 'analysis/react-compiler.mjs'));
  assert.ok(packed.files.some(entry => entry.path === 'analysis/runtime-join.mjs'));
  assert.ok(packed.files.some(entry => entry.path === 'analysis/backend-routes.mjs'));
  assert.ok(packed.files.some(entry => entry.path === 'analysis/request-route-match.mjs'));
  assert.ok(packed.files.some(entry => entry.path === 'analysis/request-handler-bridge.mjs'));
  assert.ok(!packed.files.some(entry => /^(test|src|scripts|node_modules)\//.test(entry.path)));
  const consumer = path.join(directory, 'consumer');
  await mkdir(consumer);
  await file(consumer, 'package.json', '{"name":"react-analysis-consumer","private":true,"type":"module"}');
  run('npm', ['install', '--prefer-offline', '--ignore-scripts', '--no-audit', '--no-fund', path.join(directory, packed.filename)], consumer);
  await file(consumer, 'inspect.mjs', `import { analyzeReact, createReactRuntimeIntegration } from 'producttrace/analysis';\nconst result = analyzeReact({files:{'App.tsx':${JSON.stringify(source)}}});\nconst integration = createReactRuntimeIntegration(result);\nconsole.log(JSON.stringify({schema:result.schema,controls:result.controls.length,observed:result.claims.runtime_observed,bindings:integration.bindings.actions.length}));`);
  const result = JSON.parse(run(process.execPath, ['inspect.mjs'], consumer));
  assert.equal(result.schema, 'producttrace.react-map.v1');
  assert.ok(result.controls > 0);
  assert.equal(result.observed, false);
  assert.equal(result.bindings, 1);
  await file(consumer, 'check.ts', `import { start } from 'producttrace';\nimport { analyzeReact, analyzeBackendRoutes, createReactRuntimeIntegration, connectRequestToHandler, matchRequestToRoute, type ReactAnalysis, type ReactMap, type ReactRuntimeIntegration, type BackendRouteAnalysis, type HttpRequestObservation } from 'producttrace/analysis';\nconst map: ReactAnalysis = analyzeReact({files:{'App.tsx':''}});\nconst core: ReactMap = map;\nconst integration: ReactRuntimeIntegration = createReactRuntimeIntegration(map);\nconst backend: BackendRouteAnalysis = analyzeBackendRoutes({files:{'server.js':"const express = require('express'); const app = express();"}});\nconst observed = {} as HttpRequestObservation;\nconst routeJoin = matchRequestToRoute({method:'GET',url:'/items'}, backend);\nif (routeJoin.match) console.log(routeJoin.match.application_id, routeJoin.match.handler_resolution?.status);\nvoid connectRequestToHandler; void observed;\nstart(integration.bindings, { onRecord: integration.onRecord });\nconst runtime = integration.createApiRuntime({onObservation(record) { if (record.kind === 'react_host') integration.joinHost(record); else if (record.kind === 'react_server') integration.joinServer(record); else if (record.kind === 'react_root') integration.joinRoot(record); else if (record.kind === 'react_element') integration.joinElement(record); }});\nconst factory = runtime.elementTarget('factory', (value: number) => value);\nconst result: number = factory(1);\nconst handle = runtime.rootCall('root', () => runtime.rootArgument('root', 0, {render() {}, unmount() {}}));\nruntime.rootMethod('root', handle, 'render')(null);\nconsole.log(core.fingerprint, map.input.complete, integration.map_fingerprint, result);`);
  run(process.execPath, [path.join(consumer, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--target', 'ES2022', 'check.ts'], consumer);
});

test('workspace aliases resolve per importer and never borrow a sibling config', async t => {
  const directory = await temporary(t);
  for (const workspace of ['left', 'right']) {
    await file(directory, `${workspace}/tsconfig.json`, JSON.stringify({ compilerOptions: {
      baseUrl: '.', paths: { '~/*': ['src/*'] },
    } }));
    await file(directory, `${workspace}/src/handlers.ts`, `export function save() { console.log('${workspace}'); }`);
    await file(directory, `${workspace}/src/App.tsx`, `import { save } from '~/handlers'; export function ${workspace}App() { return <button onClick={save}>Save</button>; }`.replace(`${workspace}App`, workspace === 'left' ? 'LeftApp' : 'RightApp'));
  }
  // A nested config intentionally lacks the alias: the parent cannot supply it.
  await file(directory, 'left/nested/tsconfig.json', '{}');
  await file(directory, 'left/nested/App.tsx', `import { save } from '~/handlers'; export function NestedApp() { return <button onClick={save}>Save</button>; }`);
  const map = analyzeReact({ repository: directory });
  const nodes = new Map(map.nodes.map(node => [node.id, node]));
  for (const control of map.controls) {
    const owner = nodes.get(control.source_node_id).file;
    const handlers = control.handler_ids.map(id => nodes.get(id).file);
    if (owner.includes('nested/')) assert.deepEqual(handlers, []);
    else assert.deepEqual(handlers, [owner.startsWith('left/') ? 'left/src/handlers.ts' : 'right/src/handlers.ts']);
  }
  assert.equal(map.controls.length, 3);
  assert.deepEqual(map.resolution.module_aliases.map(row => row.importer).sort(), ['left/src/App.tsx', 'right/src/App.tsx']);
});
