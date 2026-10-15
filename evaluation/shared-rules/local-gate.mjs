import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const stampPath = path.join(root, 'evaluation/shared-rules/local-gate.json');

function fingerprint() {
  const files = [];
  const visit = directory => {
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      if (item.name === 'node_modules' || item.name === '.git') continue;
      const file = path.join(directory, item.name);
      if (item.isDirectory()) visit(file);
      else if (/\.(?:[cm]?[jt]sx?|html)$/.test(item.name)
        || ['package.json', 'package-lock.json'].includes(item.name)
        || /^frozen(?:-.*)?\.json$/.test(item.name)
        || (file.startsWith(path.join(root, 'authoring/banks/')) && item.name.endsWith('.json'))) files.push(file);
    }
  };
  for (const name of ['analysis', 'authoring', 'backend', 'collector', 'dist', 'integrations', 'scripts', 'src', 'test', 'evaluation/shared-rules']) visit(path.join(root, name));
  files.push(path.join(root, 'package.json'), path.join(root, 'package-lock.json'));
  const digest = createHash('sha256');
  for (const file of files.sort()) digest.update(path.relative(root, file)).update('\0').update(fs.readFileSync(file)).update('\0');
  return digest.digest('hex');
}

/** Reuse a passing gate only while the tested source is byte-identical. */
export function requireLocalGate() {
  const current = fingerprint();
  if (fs.existsSync(stampPath)) {
    const previous = JSON.parse(fs.readFileSync(stampPath));
    if (previous.passed && previous.source_sha256 === current) return previous;
  }
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/KEY|TOKEN|SECRET|PASSWORD/.test(key)) delete env[key];
  const checks = [];
  for (const [name, command, args, overrides = {}] of [
    ['regressions', 'npm', ['test']],
    ['real_libraries', process.execPath, ['evaluation/shared-rules/run.mjs', 'offline']],
    ['library_composition', process.execPath, ['test/acceptance/shared-library-composition.mjs']],
    ['actual_http', process.execPath, ['test/acceptance/shared-library-http.mjs']],
    ['react182_owned_reference', process.execPath, ['test/acceptance/shared-library-react-owned-reference.mjs', 'evaluation/shared-rules/react-runtime/18.2']],
    ['react18_owned_reference', process.execPath, ['test/acceptance/shared-library-react-owned-reference.mjs', 'evaluation/shared-rules/react-runtime/18']],
    ['react19_owned_reference', process.execPath, ['test/acceptance/shared-library-react-owned-reference.mjs', 'evaluation/shared-rules/react-runtime/19']],
    ['react_production_catalog', process.execPath, ['evaluation/shared-rules/react-production-catalog.mjs'], { NODE_ENV: 'production' }],
    ['react_transition', process.execPath, ['evaluation/shared-rules/react-transition-boundary.mjs']],
    ['react_memo_generations', process.execPath, ['evaluation/shared-rules/react-memo-boundary.mjs'], { NODE_ENV: 'production' }],
    ['react_dom_scope_development', process.execPath, ['evaluation/shared-rules/react-dom-scope-boundary.mjs'], { NODE_ENV: 'development' }],
    ['react_dom_scope_production', process.execPath, ['evaluation/shared-rules/react-dom-scope-boundary.mjs'], { NODE_ENV: 'production' }],
    ['react_state_development', process.execPath, ['evaluation/shared-rules/react-state-boundary.mjs'], { NODE_ENV: 'development' }],
    ['react_state_production', process.execPath, ['evaluation/shared-rules/react-state-boundary.mjs'], { NODE_ENV: 'production' }],
    ['react_imperative_development', process.execPath, ['evaluation/shared-rules/react-imperative-boundary.mjs'], { NODE_ENV: 'development' }],
    ['react_imperative_production', process.execPath, ['evaluation/shared-rules/react-imperative-boundary.mjs'], { NODE_ENV: 'production' }],
    ['react_effect_production', process.execPath, ['evaluation/shared-rules/react-effect-boundary.mjs'], { NODE_ENV: 'production' }],
    ['react_effect_lifecycle', process.execPath, ['evaluation/shared-rules/react-effect-boundary.mjs'], { NODE_ENV: 'development' }],
    ['react_ref_cells', process.execPath, ['evaluation/shared-rules/react-ref-cell.mjs']],
    ['react_context_read_development', process.execPath, ['evaluation/shared-rules/react-context-read.mjs'], { NODE_ENV: 'development' }],
    ['react_context_read', process.execPath, ['evaluation/shared-rules/react-context-read.mjs'], { NODE_ENV: 'production' }],
    ['react_context_creation', process.execPath, ['evaluation/shared-rules/react-context-boundary.mjs']],
    ['react_children_traversal_development', process.execPath, ['evaluation/shared-rules/react-children-traversal.mjs'], { NODE_ENV: 'development' }],
    ['react_children_traversal_production', process.execPath, ['evaluation/shared-rules/react-children-traversal.mjs'], { NODE_ENV: 'production' }],
    ['react_children_only', process.execPath, ['evaluation/shared-rules/react-children-only.mjs']],
    ['react_element_data', process.execPath, ['evaluation/shared-rules/react-element-boundary.mjs'], { NODE_ENV: 'production' }],
    ['react_simple_production', process.execPath, ['evaluation/shared-rules/react-simple-production.mjs'], { NODE_ENV: 'production' }],
    ['version_compatibility', process.execPath, ['evaluation/shared-rules/version-compatibility.mjs']],
    ['usable_catalog', process.execPath, ['evaluation/shared-rules/recheck-usable-catalog.mjs']],
  ]) {
    const run = spawnSync(command, args, { cwd: root, env: { ...env, ...overrides }, encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
    const output = (run.stdout || '') + (run.stderr || '');
    fs.writeFileSync(path.join(root, `evaluation/shared-rules/local-${name}.txt`), output);
    checks.push({ name, exit_status: run.status, output_sha256: createHash('sha256').update(output).digest('hex') });
    if (run.status !== 0) {
      fs.writeFileSync(stampPath, JSON.stringify({ passed: false, source_sha256: current, checks }, null, 2) + '\n');
      throw new Error(`paid_testing_requires_passing_local_${name}`);
    }
  }
  if (fingerprint() !== current) throw new Error('source_changed_during_local_gate');
  const result = { passed: true, source_sha256: current, checked_at: new Date().toISOString(), checks };
  fs.writeFileSync(stampPath, JSON.stringify(result, null, 2) + '\n');
  return result;
}
if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) console.log(JSON.stringify(requireLocalGate()));
