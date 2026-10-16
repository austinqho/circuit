// Real marker gate for a served bundle (G2). Counts the executable
// instrumentation sites that actually survived into the emitted JavaScript,
// by parsing it, instead of comparing the manifest with the registerManifest
// JSON the plugin itself prepends (the old, tautological gate).
//
// Site kinds (the index is the manifest function index):
//   enter      <rt>.enter(N, {entry_hint: …})            framed body; emits function.enter
//   proxy      <rt>.tag(fn, N, true, hint)               transparent entry proxy; emits function.enter
//   register   <rt>.tag(fn, N, false, hint) / registerFunction(fn, N)   identity only
// Minifiers down-level optional chaining, so calls may appear as
// `(m=globalThis.__productTraceRuntime)==null?void 0:m.enter(N,{entry_hint:!1})`
// or `x.call(rt, fn, N, !0, !1)`; both shapes are recognized from the AST.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const tracerRoot = path.resolve(import.meta.dirname, '../..');
const ts = createRequire(path.join(tracerRoot, 'package.json'))('typescript');

const OWN_ASSETS = new Set(['producttrace-runtime.js', 'producttrace-request-bridge.js']);

function booleanLiteral(node) {
  if (!node) return null;
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken && ts.isNumericLiteral(node.operand)) return node.operand.text === '0';
  return null;
}
const unwrap = node => { while (node && ts.isParenthesizedExpression(node)) node = node.expression; return node; };
const functionNode = node => { node = unwrap(node); return Boolean(node) && (ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isClassExpression(node) || ts.isIdentifier(node) || ts.isCallExpression(node)); };
const calleeName = callee => {
  callee = unwrap(callee);
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  if (ts.isConditionalExpression(callee)) return calleeName(callee.whenFalse);
  return null;
};
const hasEntryHint = node => { node = unwrap(node); return Boolean(node) && ts.isObjectLiteralExpression(node) && node.properties.some(property => property.name && ts.isIdentifier(property.name) && property.name.text === 'entry_hint'); };

export function jsFiles(dir) {
  const files = [];
  const walk = current => { for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) walk(absolute); else if (entry.isFile() && /\.m?js$/u.test(entry.name)) files.push(absolute);
  } };
  walk(dir); return files;
}

export function countInstrumentationSites(dir) {
  const sites = { enter: new Map(), proxy: new Map(), register: new Map() };
  const bump = (kind, index) => sites[kind].set(index, (sites[kind].get(index) || 0) + 1);
  let registerManifestPrefixes = 0;
  for (const file of jsFiles(dir)) {
    if (OWN_ASSETS.has(path.basename(file))) continue;
    const code = fs.readFileSync(file, 'utf8');
    if (!code.includes('__productTraceRuntime')) continue;
    registerManifestPrefixes += (code.match(/__productTraceRuntime\.registerManifest\(\[/gu) || []).length;
    const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS);
    const visit = node => {
      if (ts.isCallExpression(node)) {
        const name = calleeName(node.expression);
        let args = [...node.arguments];
        // x.call(receiver, …) is how minifiers express an optional member call.
        if (name === 'call' && args.length >= 2) {
          const target = unwrap(node.expression).expression;
          const inner = target && (ts.isIdentifier(target) ? null : calleeName(target));
          void inner; args = args.slice(1);
        }
        const [first, second, third] = args;
        if (first && ts.isNumericLiteral(first) && hasEntryHint(second) && (name === 'enter' || name === 'call')) bump('enter', Number(first.text));
        else if (args.length === 4 && functionNode(first) && second && ts.isNumericLiteral(second) && booleanLiteral(third) !== null && booleanLiteral(args[3]) !== null && (name === 'tag' || name === 'call')) bump(booleanLiteral(third) ? 'proxy' : 'register', Number(second.text));
        else if (args.length === 2 && first && ts.isIdentifier(first) && second && ts.isNumericLiteral(second) && (name === 'registerFunction')) bump('register', Number(second.text));
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return { sites, registerManifestPrefixes };
}

export function markerGate(dir, manifest) {
  const { sites, registerManifestPrefixes } = countInstrumentationSites(dir);
  const manifestIndexes = new Set(manifest.functions.map(row => row.index));
  const executable = new Set([...sites.enter.keys(), ...sites.proxy.keys()]);
  const any = new Set([...executable, ...sites.register.keys()]);
  const describe = index => { const row = manifest.functions.find(fn => fn.index === index); return { index, file: row?.source?.file, start: row?.source?.start, end: row?.source?.end, generated: row?.generated ? path.relative(dir, row.generated.file) : null }; };
  const missing = [...manifestIndexes].filter(index => !executable.has(index));
  const unmanifested = [...any].filter(index => !manifestIndexes.has(index));
  const sum = map => [...map.values()].reduce((a, b) => a + b, 0);
  return {
    manifest_functions: manifest.functions.length,
    indexes_with_executable_site: [...manifestIndexes].filter(index => executable.has(index)).length,
    indexes_with_enter_site: [...manifestIndexes].filter(index => sites.enter.has(index)).length,
    indexes_with_proxy_only: [...manifestIndexes].filter(index => !sites.enter.has(index) && sites.proxy.has(index)).length,
    indexes_registration_only: [...manifestIndexes].filter(index => !executable.has(index) && sites.register.has(index)).length,
    enter_sites: sum(sites.enter), proxy_sites: sum(sites.proxy), register_sites: sum(sites.register),
    indexes_with_multiple_enter_sites: [...sites.enter.values()].filter(count => count > 1).length,
    register_manifest_prefixes: registerManifestPrefixes,
    missing: missing.map(describe), missing_count: missing.length,
    unmanifested: unmanifested.slice(0, 50), unmanifested_count: unmanifested.length,
    pass: manifest.functions.length > 0 && missing.length === 0 && unmanifested.length === 0,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [dir, manifestPath] = process.argv.slice(2);
  const result = markerGate(path.resolve(dir), JSON.parse(fs.readFileSync(manifestPath, 'utf8')));
  console.log(JSON.stringify({ ...result, missing: result.missing.slice(0, 20) }, null, 2));
}
