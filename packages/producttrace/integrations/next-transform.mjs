/**
 * The per-module work behind `withProducttrace()` under `next dev`.
 *
 * Next.js hands each first-party browser module to `next-loader.cjs` before its
 * own compiler sees it. This module turns that TypeScript/JSX source into plain
 * JavaScript with a source map back to the file, runs the same
 * runtime-attribution pass the Vite plugin runs on its dev modules, and puts
 * one import of the generated client module (the in-page recorder) at the top.
 *
 * Next.js runs loaders in several worker processes, so function and placement
 * indexes are derived from their ids (unique across workers) and each process
 * writes its own manifest file under `<cacheDir>/next-manifests/`. The
 * process that owns the collector merges them (see `next.mjs`).
 */
import path from 'node:path';
import ts from 'typescript';
import { decode } from '@jridgewell/sourcemap-codec';
import { composeSourceMaps, createFirstPartyRule, runtimeAttributionPlugin } from './runtime-attribution.mjs';

const plugins = new Map();

function pluginFor({ repository, cacheDir, firstParty }) {
  const key = `${repository}\0${cacheDir}`;
  if (!plugins.has(key)) {
    const plugin = runtimeAttributionPlugin({ repository, firstParty, stableIndexes: true,
      manifestPath: path.join(cacheDir, 'next-manifests', `${process.pid}.json`) });
    // The dev-server path: each module output is what runs, so it registers its own functions.
    plugin.configResolved({ command: 'serve' });
    plugins.set(key, { plugin, rule: createFirstPartyRule(firstParty || {}) });
  }
  return plugins.get(key);
}

// A directive prologue ('use client', 'use strict', …) at the top of the emitted code.
const PROLOGUE = /^(?:\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)?\s*(['"])use [\w ]+\1;?)+/u;

/**
 * @param {string} source the module as Next.js read it (TypeScript/JSX allowed)
 * @param {string} file absolute path of the module
 * @param {{ repository: string, cacheDir: string, clientModule: string, firstParty?: object }} options
 * @returns {{ code: string, map: object | null } | null} null leaves the module untouched
 */
export function transformNextModule(source, file, { repository, cacheDir, clientModule, firstParty }) {
  if (path.resolve(file) === path.resolve(clientModule)) return null;
  const { plugin, rule } = pluginFor({ repository, cacheDir, firstParty });
  const relative = path.relative(repository, file).split(path.sep).join('/');
  if (!rule.isFirstParty(relative)) return null;
  // Server actions compile to references in the browser; Next.js must see them untouched.
  const directives = source.match(PROLOGUE)?.[0] || '';
  if (/(['"])use server\1/u.test(directives)) return null;

  const jsx = /\.[jt]sx$/u.test(file);
  const compiled = ts.transpileModule(source, {
    fileName: file,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      jsx: jsx ? ts.JsxEmit.ReactJSX : undefined,
      sourceMap: true,
      inlineSources: true,
      useDefineForClassFields: true,
    },
    reportDiagnostics: false,
  });
  const map = JSON.parse(compiled.sourceMapText);
  map.sources = [file];
  map.sourceRoot = '';
  let code = compiled.outputText.replace(/\n\/\/# sourceMappingURL=[^\n]*\s*$/u, '\n');
  const instrumented = plugin.transform.call({ getCombinedSourcemap: () => map }, code, file);
  let outputMap = map;
  if (instrumented) {
    code = instrumented.code;
    // The pass maps its output to the compiled module; carry that on to the file itself.
    outputMap = composeSourceMaps({ ...instrumented.map, mappings: decode(instrumented.map.mappings) }, map);
  }
  // Directives first (Next.js reads them), then the recorder, then the module.
  const prologue = compiled.outputText.match(PROLOGUE)?.[0].trim();
  let specifier = path.relative(path.dirname(file), clientModule).split(path.sep).join('/');
  if (!specifier.startsWith('.')) specifier = `./${specifier}`;
  const header = `${prologue ? `${prologue}\n` : ''}import ${JSON.stringify(specifier)};\n`;
  const lines = header.split('\n').length - 1;
  return {
    code: header + code,
    map: outputMap ? { ...outputMap, mappings: ';'.repeat(lines) + outputMap.mappings } : null,
  };
}
