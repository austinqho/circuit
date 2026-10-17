import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import MagicString, { Bundle as MagicBundle } from 'magic-string';
import {
  DEFAULT_FIRST_PARTY_EXCLUDE,
  createFirstPartyRule,
  exactOriginalFunctionBoundary,
  runtimeAttributionPlugin,
} from '../integrations/runtime-attribution.mjs';

test('first-party rule: default excludes, include overrides, custom excludes', () => {
  const rule = createFirstPartyRule();
  assert.deepEqual(rule.exclude, [...DEFAULT_FIRST_PARTY_EXCLUDE]);
  assert.equal(rule.excludedBy('src/app.tsx'), null);
  assert.equal(rule.excludedBy('src/builder/x.ts'), null);
  assert.equal(rule.excludedBy('node_modules/react/index.js'), '**/node_modules/**');
  assert.equal(rule.excludedBy('packages/ui/dist/index.js'), '**/dist/**');
  assert.equal(rule.excludedBy('src/build/tool.ts'), '**/build/**');
  assert.equal(rule.excludedBy('../sibling/a.js'), 'outside repository');
  assert.equal(rule.excludedBy('src/a.css'), 'not a JS/TS source');
  const workspace = createFirstPartyRule({ include: ['packages/ui/dist/**'] });
  assert.equal(workspace.excludedBy('packages/ui/dist/index.js'), null);
  assert.equal(workspace.excludedBy('packages/ui/node_modules/x.js'), '**/node_modules/**');
  const custom = createFirstPartyRule({ exclude: ['**/*.stories.tsx'] });
  assert.equal(custom.excludedBy('packages/ui/dist/index.js'), null);
  assert.equal(custom.excludedBy('src/Button.stories.tsx'), '**/*.stories.tsx');
});

test('first-party rule drives chunk instrumentation and the per-rule build report', () => {
  const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'producttrace-firstparty-')));
  try {
    const repository = path.join(temp, 'repo');
    fs.mkdirSync(path.join(repository, 'src'), { recursive: true });
    fs.mkdirSync(path.join(repository, 'packages', 'ui', 'dist'), { recursive: true });
    const pkg = 'export function button(fn) { return fn(); }\n';
    const app = 'export const onClick = () => { return 2; };\n';
    fs.writeFileSync(path.join(repository, 'packages', 'ui', 'dist', 'index.js'), pkg);
    fs.writeFileSync(path.join(repository, 'src', 'app.js'), app);
    const build = firstParty => {
      const joined = new MagicBundle();
      joined.addSource({ filename: '../packages/ui/dist/index.js', content: new MagicString(pkg) });
      joined.addSource({ filename: '../src/app.js', content: new MagicString(app) });
      const bundle = { 'index.js': { type: 'chunk', fileName: 'index.js', code: joined.toString(),
        map: JSON.parse(joined.generateMap({ includeContent: true, hires: true }).toString()) } };
      const manifestPath = path.join(temp, `manifest-${firstParty ? 'include' : 'default'}.json`);
      const lines = []; const info = console.info; console.info = line => lines.push(line);
      try { runtimeAttributionPlugin({ repository, manifestPath, firstParty }).generateBundle({ dir: path.join(repository, 'out') }, bundle); }
      finally { console.info = info; }
      return { manifest: JSON.parse(fs.readFileSync(manifestPath, 'utf8')), lines };
    };
    const byDefault = build(undefined);
    assert.deepEqual(byDefault.manifest.functions.map(row => row.source.file), ['src/app.js']);
    assert.deepEqual(byDefault.manifest.first_party.excluded_functions, { '**/dist/**': 1 });
    assert.match(byDefault.lines.join('\n'), /\[producttrace\] first-party: 1 functions instrumented; excluded functions by rule: \*\*\/dist\/\*\* 1/u);
    const included = build({ include: ['packages/ui/dist/**'] });
    assert.deepEqual(included.manifest.functions.map(row => row.source.file).sort(), ['packages/ui/dist/index.js', 'src/app.js']);
    assert.deepEqual(included.manifest.first_party.excluded_functions, {});
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('skip list: whole files, one function by name, or every method of a class', () => {
  const rule = createFirstPartyRule({ skip: ['src/workers/**', 'src/scene/export.js#exportToCanvas', 'src/scene/Scene.js#Scene.*'] });
  assert.equal(rule.excludedBy('src/workers/encode.js'), 'skip src/workers/**');
  assert.equal(rule.excludedBy('src/scene/export.js'), null, 'a named function skips only that function');
  assert.equal(rule.skippedBy('src/scene/export.js', { name: 'exportToCanvas', display_name: 'exportToCanvas' }), 'src/scene/export.js#exportToCanvas');
  assert.equal(rule.skippedBy('src/scene/export.js', { name: 'exportToSvg', display_name: 'exportToSvg' }), null);
  assert.equal(rule.skippedBy('src/scene/Scene.js', { name: 'mutate', display_name: 'Scene.mutate' }), 'src/scene/Scene.js#Scene.*');
  assert.equal(rule.skippedBy('src/other.js', { name: 'exportToCanvas', display_name: 'exportToCanvas' }), null);
  assert.throws(() => createFirstPartyRule({ skip: ['src/a.js#'] }), /file-glob#function-name/u);
  assert.throws(() => createFirstPartyRule({ skip: 'src/a.js' }), /must be an array/u);
});

test('a skipped function is left as written and reported by its rule', () => {
  const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'producttrace-skip-')));
  try {
    const repository = path.join(temp, 'repo');
    fs.mkdirSync(path.join(repository, 'src'), { recursive: true });
    const app = 'export function exportToCanvas(scene) { return scene.length; }\nexport const onClick = () => { return 2; };\n';
    fs.writeFileSync(path.join(repository, 'src', 'app.js'), app);
    const joined = new MagicBundle();
    joined.addSource({ filename: '../src/app.js', content: new MagicString(app) });
    const bundle = { 'index.js': { type: 'chunk', fileName: 'index.js', code: joined.toString(),
      map: JSON.parse(joined.generateMap({ includeContent: true, hires: true }).toString()) } };
    const manifestPath = path.join(temp, 'manifest.json');
    const info = console.info; console.info = () => {};
    try { runtimeAttributionPlugin({ repository, manifestPath, skip: ['src/app.js#exportToCanvas'] }).generateBundle({ dir: path.join(repository, 'out') }, bundle); }
    finally { console.info = info; }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.deepEqual(manifest.functions.map(row => row.display_name ?? row.name), ['onClick']);
    assert.deepEqual(manifest.first_party.skip, ['src/app.js#exportToCanvas']);
    assert.deepEqual(manifest.first_party.excluded_functions, { 'skip src/app.js#exportToCanvas': 1 });
    const code = bundle['index.js'].code;
    assert.match(code, /export function exportToCanvas\(scene\) \{ return scene\.length; \}/u, 'the skipped function is byte-for-byte the original');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

// Bounds of the boundary tolerance used to recover a function from a minified
// map (docs/gates/G2-generality.md, "Tolerances").
test('function-boundary recovery: what the 8-character start tolerance matches and where it stops', () => {
  const source = 'const add = (a) => (b) => a + b;\nfunction outer() { run(() => 1); return 0; }\nconst id = <T,>(value: T) => value;\nfunction plain() { return 1234567890; }\n';
  const at = (text, from = 0) => source.indexOf(text, from);
  const find = (start, end) => exactOriginalFunctionBoundary('a.tsx', source, start, end);
  const outerArrow = { start: at('(a)'), end: at(';') };
  const innerArrow = { start: at('(b)'), end: at(';') };
  const strip = value => value && { start: value.start, end: value.end };
  // Exact spans resolve to themselves; curried arrows keep their own ids.
  assert.deepEqual(strip(find(outerArrow.start, outerArrow.end)), outerArrow);
  assert.deepEqual(strip(find(innerArrow.start, innerArrow.end)), innerArrow);
  // Map lands 1 char into the function and ends 1 char early (minified tail): same function.
  assert.deepEqual(strip(find(outerArrow.start + 1, outerArrow.end - 1)), outerArrow);
  // Type parameters dropped by the compiler: the start maps to the head after `<T,>`.
  const generic = { start: at('<T,>'), end: at(';', at('<T,>')) };
  assert.deepEqual(strip(find(at('(value'), generic.end)), generic);
  // More than 8 chars into a body with no function there: no boundary; the caller abstains.
  assert.equal(find(at('1234567890'), at('1234567890') + 10), null);
  // A nested function whose mapped end is exact is still found even when its
  // mapped start falls inside the enclosing function's first 8 chars.
  const outerFn = { start: at('function outer'), end: at('}', at('function outer')) + 1 };
  const nested = { start: at('() => 1'), end: at('() => 1') + 7 };
  assert.deepEqual(strip(find(outerFn.start + 3, nested.end)), nested);
  // Known limit: if both the mapped start (within the enclosing function's
  // first 8 chars) and the mapped end (inside the nested body) are off, the
  // enclosing function is returned. The module-pass embedded index (tag/enter
  // site) takes precedence over this path for every module-registered function.
  assert.deepEqual(strip(find(outerFn.start + 3, nested.start + 5)), outerFn);
});

// Module-pass sites are recognized on the AST, not by text: an application
// call that merely looks like `,N,!0,!1)` is not a site.
test('embedded module-pass sites are AST shapes, not text matches', async () => {
  const { instrumentPostTransformedSource } = await import('../integrations/runtime-attribution.mjs');
  const row = { id: 'function:x', index: 5, source: { file: 'src/a.js', start: 0, end: 1 } };
  const run = code => [...(instrumentPostTransformedSource(code, '/nowhere/out/index.js', { repository: '/nowhere', map: null,
    register: true, instrument: true, instrumentLeafOnly: true, moduleRows: new Map([[5, row]]) }).embedded_indexes || [])];
  assert.deepEqual(run('foo(a,5,!0,!1);'), []);
  assert.deepEqual(run('var s="enter(5,{entry_hint:";'), []);
  assert.deepEqual(run('x.call(rt,()=>1,5,!0,!1);'), [5]);
  assert.deepEqual(run('(m=rt)==null?void 0:m.enter(5e0,{entry_hint:!1});'), [5]);
});
