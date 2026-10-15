import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { runtimeAttributionPlugin } from '../integrations/runtime-attribution.mjs';

function fixture() {
  const real = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'producttrace-passes-')));
  const link = `${real}-link`;
  fs.symlinkSync(real, link);
  const source = 'export async function load(get) {\n  const value = await get();\n  return fetch("/api/" + value);\n}\nexport async function tight(get){return(await(get())).v}\nexport const View = () => <button onClick={() => load(() => 1)}>Go</button>;\n';
  const file = path.join(real, 'src/View.jsx');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, source);
  const output = ts.transpileModule(source, { fileName: file, compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, sourceMap: true, inlineSources: true } });
  const map = JSON.parse(output.sourceMapText); map.sources = [file];
  const code = output.outputText.replace(/\/\/# sourceMappingURL=.*$/mu, '');
  return { real, link, file, code, map, cleanup: () => { fs.rmSync(link, { force: true }); fs.rmSync(real, { recursive: true, force: true }); } };
}

test('the module pass runs identically for a real and a symlinked repository path', () => {
  const f = fixture();
  try {
    const context = { getCombinedSourcemap: () => f.map };
    const real = runtimeAttributionPlugin({ repository: f.real }).transform.call(context, f.code, f.file);
    const linked = runtimeAttributionPlugin({ repository: f.link }).transform.call(context, f.code, f.file);
    assert.ok(real, 'real path is instrumented');
    assert.ok(linked, 'symlinked path is instrumented (not silently skipped)');
    assert.equal(linked.code, real.code);
    assert.deepEqual(linked.manifest?.map?.(row => row.id), real.manifest?.map?.(row => row.id));
  } finally { f.cleanup(); }
});

test('chunk pass keeps the entry hint the module pass computed for a wrapped callback', async () => {
  const { instrumentPostTransformedSource } = await import('../integrations/runtime-attribution.mjs');
  const f = fixture();
  try {
    // Module-pass output shape: the callback argument is hidden inside `tag((fn), N, proxy, hint)`.
    const chunk = 'submit(globalThis.__productTraceRuntime?.tag?.(((data) => send(data)),7,false,true));\n';
    const rows = new Map([[7, { index: 7, id: 'function:x:1:2', source: { file: 'src/View.jsx', start: 1, end: 2 } }]]);
    const result = instrumentPostTransformedSource(chunk, f.file, { repository: f.real, map: null, instrumentLeafOnly: true, moduleRows: rows, indexForId: () => 7 });
    assert.match(result.code, /enter\(7,\{entry_hint:true(?:,a0:data)?\}\)/u);
  } finally { f.cleanup(); }
});

test('chunk-level edits: await continuation and placement wrappers are span-neutral', async () => {
  const { instrumentPostTransformedSource } = await import('../integrations/runtime-attribution.mjs');
  const f = fixture();
  try {
    const numbered = () => { const ids = new Map(); return id => { if (!ids.has(id)) ids.set(id, ids.size); return ids.get(id); }; };
    const plain = instrumentPostTransformedSource(f.code, f.file, { repository: f.real, map: f.map, instrumentLeafOnly: true, indexForId: numbered() });
    const full = instrumentPostTransformedSource(f.code, f.file, { repository: f.real, map: f.map, instrumentLeafOnly: true, awaitContinuations: true, indexForPlacement: () => 0, indexForId: numbered() });
    assert.deepEqual(full.manifest.map(row => row.id), plain.manifest.map(row => row.id), 'same ids with and without the G1/G3 edits');
    assert.match(full.code, /__ptAwR\(__ptAw=__ptAwS\(__ptAw\),await  __ptAwL\(__ptAw,get\(\)\)\)/u, 'await continuation inserted');
    assert.match(full.code, /__productTracePlace\|\|__ptIdentity/u, 'placement wrapper inserted');
    assert.doesNotMatch(full.code, /await__pt/u, 'an operand without whitespace after await keeps the keyword separate');
    new Function(full.code.replace(/^import .*$/gmu, '').replace(/export /gu, '')); // syntax check
  } finally { f.cleanup(); }
});
