import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import MagicString, { Bundle as MagicBundle } from 'magic-string';
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping';
import { runtimeAttributionPlugin } from '../integrations/runtime-attribution.mjs';

const packageRoot = path.resolve(import.meta.dirname, '..');

// G2 packaging gate: the package as npm would install it (tarball contents
// only) must import its Vite entrypoints. Dependencies are linked from this
// checkout so the test needs no network.
test('npm-packed tarball installs and exposes the Vite plugins', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'producttrace-installed-'));
  try {
    const packed = JSON.parse(execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', temp],
      { cwd: packageRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
    const tarball = path.join(temp, packed[0].filename);
    const consumer = path.join(temp, 'consumer');
    const installed = path.join(consumer, 'node_modules', 'producttrace');
    fs.mkdirSync(installed, { recursive: true });
    execFileSync('tar', ['-xzf', tarball, '-C', installed, '--strip-components=1']);
    assert.equal(fs.existsSync(path.join(installed, 'src')), false, 'src/ must not ship');
    const manifest = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
    for (const name of Object.keys(manifest.dependencies)) {
      const target = path.join(consumer, 'node_modules', name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      // In the workspace, dependencies are hoisted to the repository root.
      let dir = packageRoot;
      while (!fs.existsSync(path.join(dir, 'node_modules', name)) && path.dirname(dir) !== dir) dir = path.dirname(dir);
      fs.symlinkSync(fs.realpathSync(path.join(dir, 'node_modules', name)), target);
    }
    fs.writeFileSync(path.join(consumer, 'package.json'), JSON.stringify({ name: 'consumer', private: true, type: 'module' }));
    fs.writeFileSync(path.join(consumer, 'probe.mjs'), `
import * as vite from 'producttrace/vite';
import * as attribution from 'producttrace/runtime-attribution';
console.log(JSON.stringify({
  vite: Object.keys(vite).sort(),
  attribution: Object.keys(attribution).sort(),
  same: vite.runtimeAttributionPlugin === attribution.runtimeAttributionPlugin,
}));
`);
    const output = JSON.parse(execFileSync(process.execPath, ['probe.mjs'], { cwd: consumer, encoding: 'utf8' }));
    assert.deepEqual(output.vite.filter(name => ['producttrace', 'productTraceVitePlugin', 'runtimeAttributionPlugin'].includes(name)),
      ['productTraceVitePlugin', 'producttrace', 'runtimeAttributionPlugin']);
    assert.ok(output.attribution.includes('runtimeAttributionPlugin'));
    assert.equal(output.same, true);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

// The chunk pass must not assume an output layout, and the emitted map must
// still describe the served (edited) chunk in terms of the original source.
test('runtime attribution instruments chunks in any outDir and keeps their source map', () => {
  const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'producttrace-outdir-')));
  try {
    const repository = path.join(temp, 'repo');
    fs.mkdirSync(path.join(repository, 'web', 'src'), { recursive: true });
    const original = 'export const onSave = () => { return send(1); };\nexport function send(value) {\n  return value + 1;\n}\n';
    fs.writeFileSync(path.join(repository, 'web', 'src', 'app.js'), original);
    const outDir = path.join(temp, 'elsewhere', 'build-output');
    const fileName = 'assets/index-abc.js';
    const sourceFromChunk = path.relative(path.dirname(path.join(outDir, fileName)), path.join(repository, 'web', 'src', 'app.js'));
    const chunkMap = JSON.parse(new MagicString(original).generateMap({ source: sourceFromChunk, includeContent: true, hires: true }).toString());
    const bundle = {
      [fileName]: { type: 'chunk', fileName, code: original, map: chunkMap },
      [`${fileName}.map`]: { type: 'asset', fileName: `${fileName}.map`, source: JSON.stringify(chunkMap) },
    };
    const manifestPath = path.join(temp, 'manifest.json');
    const plugin = runtimeAttributionPlugin({ repository, manifestPath });
    assert.deepEqual(plugin.config({ build: { sourcemap: true } }), null);
    plugin.generateBundle({ dir: outDir }, bundle);
    const chunk = bundle[fileName];
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.equal(manifest.functions.length, 2);
    assert.ok(manifest.functions.every(row => row.source.file === 'web/src/app.js'));
    for (const row of manifest.functions) assert.match(chunk.code, new RegExp(`(?:enter\\(${row.index},|\\),${row.index},(?:true|false),(?:true|false)\\)|registerFunction\\?\\.\\([^,]+,${row.index}\\))`));
    const emitted = JSON.parse(bundle[`${fileName}.map`].source);
    assert.notEqual(emitted.mappings, chunkMap.mappings);
    const trace = new TraceMap(emitted);
    const lines = chunk.code.split('\n');
    const line = lines.findIndex(text => text.includes('return value + 1'));
    const position = originalPositionFor(trace, { line: line + 1, column: lines[line].indexOf('value + 1') });
    assert.equal(position.line, 3);
    assert.equal(position.source.endsWith('web/src/app.js'), true);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('runtime attribution enables hidden maps only when the project has none, and drops them again', () => {
  const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'producttrace-nomaps-')));
  try {
    const repository = path.join(temp, 'repo');
    fs.mkdirSync(path.join(repository, 'src'), { recursive: true });
    const original = 'export const go = () => { return 1; };\n';
    fs.writeFileSync(path.join(repository, 'src', 'a.js'), original);
    const outDir = path.join(repository, 'out');
    const chunkMap = JSON.parse(new MagicString(original).generateMap({ source: '../src/a.js', includeContent: true, hires: true }).toString());
    const bundle = {
      'a.js': { type: 'chunk', fileName: 'a.js', code: original, map: chunkMap },
      'a.js.map': { type: 'asset', fileName: 'a.js.map', source: JSON.stringify(chunkMap) },
    };
    const plugin = runtimeAttributionPlugin({ repository });
    assert.deepEqual(plugin.config({ build: {} }), { build: { sourcemap: 'hidden' } });
    plugin.generateBundle({ dir: outDir }, bundle);
    assert.match(bundle['a.js'].code, /__productTraceRuntime/);
    assert.equal(bundle['a.js.map'], undefined);
    assert.equal(bundle['a.js'].map, null);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

// A chunk that bundles a dependency with first-party code (one-entry apps,
// or chunks merged by the bundler) must instrument only first-party functions.
test('runtime attribution never instruments dependency functions bundled into a first-party chunk', () => {
  const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'producttrace-mixed-')));
  try {
    const repository = path.join(temp, 'repo');
    fs.mkdirSync(path.join(repository, 'src'), { recursive: true });
    fs.mkdirSync(path.join(repository, 'node_modules', 'lib'), { recursive: true });
    const library = 'export function dispatch(fn) { return fn(); }\n';
    const app = 'export const onClick = () => { return 2; };\n';
    fs.writeFileSync(path.join(repository, 'node_modules', 'lib', 'index.js'), library);
    fs.writeFileSync(path.join(repository, 'src', 'app.js'), app);
    const bundleSource = new MagicBundle();
    bundleSource.addSource({ filename: '../node_modules/lib/index.js', content: new MagicString(library) });
    bundleSource.addSource({ filename: '../src/app.js', content: new MagicString(app) });
    const code = bundleSource.toString();
    const map = JSON.parse(bundleSource.generateMap({ includeContent: true, hires: true }).toString());
    const bundle = { 'index.js': { type: 'chunk', fileName: 'index.js', code, map } };
    const manifestPath = path.join(temp, 'manifest.json');
    runtimeAttributionPlugin({ repository, manifestPath }).generateBundle({ dir: path.join(repository, 'out') }, bundle);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.deepEqual(manifest.functions.map(row => row.source.file), ['src/app.js']);
    const libraryPart = bundle['index.js'].code.split('export const onClick')[0].split('\n').slice(1).join('\n');
    assert.doesNotMatch(libraryPart, /__productTraceRuntime/u);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

// Identity attaches by the index the module pass embedded, never by where a
// chunk source map happens to land (it can land on a nested function).
test('chunk pass reuses the module-pass index embedded around an already-registered function', async () => {
  const { instrumentPostTransformedSource } = await import('../integrations/runtime-attribution.mjs');
  const { encode } = await import('@jridgewell/sourcemap-codec');
  const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'producttrace-embedded-')));
  try {
    const repository = path.join(temp, 'repo');
    fs.mkdirSync(path.join(repository, 'src'), { recursive: true });
    const original = 'setFiles((prev) => prev.map((file) => file.id));\n';
    fs.writeFileSync(path.join(repository, 'src', 'a.js'), original);
    // Minified chunk with the module pass's registration around the outer arrow.
    const chunk = 'var Z,z;c((z=(Z=globalThis.__productTraceRuntime)==null?void 0:Z.tag)==null?void 0:z.call(Z,e=>e.map(t=>t.id),7,!1,!0));\n';
    // A deliberately misleading map: every generated column maps to the inner arrow.
    const inner = original.indexOf('(file)');
    const segments = [...chunk.trimEnd()].map((_, column) => [column, 0, 0, inner]);
    const map = { version: 3, sources: ['../src/a.js'], sourcesContent: [original], names: [], mappings: encode([segments]) };
    const outer = { id: 'function:outer-from-module-pass', index: 7, source: { file: 'src/a.js', start: original.indexOf('(prev)'), end: original.indexOf('));') + 1 } };
    const indexes = new Map([[outer.id, 7]]); let next = 8;
    const result = instrumentPostTransformedSource(chunk, path.join(repository, 'out', 'index.js'), { repository, map,
      indexForId: value => { if (!indexes.has(value)) indexes.set(value, next++); return indexes.get(value); },
      register: true, instrument: true, instrumentLeafOnly: true, moduleRows: new Map([[7, outer]]) });
    const outerRow = result.manifest.find(row => row.generated.start === chunk.indexOf('e=>'));
    assert.equal(outerRow.id, outer.id);
    assert.equal(outerRow.index, 7);
    assert.ok(result.manifest.every(row => row === outerRow || row.index !== 7));
    // A framed body whose module-pass index the minifier printed as 4e3.
    const framed = 'c(function(N){var m;const t=(m=globalThis.__productTraceRuntime)==null?void 0:m.enter(4e3,{entry_hint:!1});try{return N.map(t=>t.id)}finally{}});\n';
    const framedSegments = [...framed.trimEnd()].map((_, column) => [column, 0, 0, inner]);
    const framedRow = { ...outer, id: 'function:framed-from-module-pass', index: 4000 };
    indexes.set(framedRow.id, 4000);
    const framedResult = instrumentPostTransformedSource(framed, path.join(repository, 'out', 'index.js'), { repository,
      map: { ...map, mappings: encode([framedSegments]) },
      indexForId: value => { if (!indexes.has(value)) indexes.set(value, next++); return indexes.get(value); },
      register: true, instrument: true, instrumentLeafOnly: true, moduleRows: new Map([[4000, framedRow]]) });
    assert.equal(framedResult.manifest.find(row => row.generated.start === framed.indexOf('function')).id, framedRow.id);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
