import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import {
  discoverCompiledRequestTargets,
  instrumentCompiledRequestSource,
} from '../integrations/compiled-request-bridge.mjs';

test('compiled workspace requests are aligned through exact source maps instead of bundle strings', () => {
  const repository = fs.mkdtempSync(path.join(os.tmpdir(), 'producttrace-compiled-request-'));
  try {
    const packageRoot = path.join(repository, 'packages/data');
    const sourceFile = path.join(packageRoot, 'src/request.ts');
    const dist = path.join(packageRoot, 'dist');
    fs.mkdirSync(path.dirname(sourceFile), { recursive: true });
    fs.mkdirSync(dist, { recursive: true });
    fs.writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({ name: '@fixture/data' }));
    const source = 'export async function get(url: string) { return client.get(url); }\n';
    fs.writeFileSync(sourceFile, source);
    const compiled = ts.transpileModule(source, {
      fileName: 'src/request.ts',
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
        sourceMap: true, inlineSources: true },
    });
    fs.writeFileSync(path.join(dist, 'request.js'), compiled.outputText);
    fs.writeFileSync(path.join(dist, 'request.js.map'), compiled.sourceMapText);
    fs.mkdirSync(path.join(repository, 'node_modules/@fixture'), { recursive: true });
    fs.symlinkSync(packageRoot, path.join(repository, 'node_modules/@fixture/data'), 'dir');

    const text = 'client.get(url)';
    const start = source.indexOf(text);
    const reactMap = {
      nodes: [{ id: 'call:request', file: 'packages/data/src/request.ts', start,
        end: start + text.length, text }],
      files: [{ path: 'packages/data/src/request.ts',
        sha256: createHash('sha256').update(source).digest('hex') }],
    };
    const requestBridge = { actions: [{ action: 'action:one', requests: [{
      invocation_call_id: 'call:request', contract_application_id: 'contract:get', method: 'GET',
    }] }] };
    const plan = discoverCompiledRequestTargets({ repository, reactMap, requestBridge });
    assert.deepEqual(plan.diagnostics, []);
    assert.equal(plan.targets.length, 1);
    const generated = fs.readFileSync(path.join(dist, 'request.js'), 'utf8');
    const result = instrumentCompiledRequestSource(generated, plan.targets[0]);
    assert.equal(result.diagnostics.length, 0);
    assert.match(result.code, /__productTraceRequestBridge\.request/u);
    assert.match(result.code, /client\.get\(url\)/u);

    // A coarse map must not redirect the request to an earlier call on its line.
    const coarseMap = JSON.parse(compiled.sourceMapText);
    coarseMap.mappings = 'AAAA';
    fs.writeFileSync(path.join(dist, 'request.js.map'), JSON.stringify(coarseMap));
    const coarse = discoverCompiledRequestTargets({ repository, reactMap, requestBridge });
    assert.equal(coarse.targets.length, 0);
    assert.equal(coarse.diagnostics[0].code, 'compiled_request_target_unresolved');

    const stale = instrumentCompiledRequestSource(`${generated}\n`, plan.targets[0]);
    assert.equal(stale.applied.length, 0);
    assert.equal(stale.diagnostics[0].code, 'compiled_source_snapshot_mismatch');
  } finally {
    fs.rmSync(repository, { recursive: true, force: true });
  }
});
