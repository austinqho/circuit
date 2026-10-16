// Finds the producttrace package this bench tests, and its command-line entry
// points (from its package.json "bin" map, so no internal path is assumed).
//
// Order: PRODUCTTRACE_DIR, then normal resolution by name (a workspace
// dependency), then packages/producttrace in an ancestor directory.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

function isProducttrace(dir) {
  try {
    return (
      JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).name === 'producttrace'
    );
  } catch {
    return false;
  }
}

export function findPackageDir({ env = process.env, from = here } = {}) {
  if (env.PRODUCTTRACE_DIR) {
    const dir = path.resolve(env.PRODUCTTRACE_DIR);
    if (!isProducttrace(dir))
      throw new Error(`PRODUCTTRACE_DIR=${dir} is not the producttrace package`);
    return fs.realpathSync(dir);
  }
  try {
    // package.json is an exported subpath; "." has only an import condition.
    const dir = path.dirname(
      createRequire(path.join(from, 'noop.js')).resolve('producttrace/package.json'),
    );
    if (isProducttrace(dir)) return fs.realpathSync(dir);
  } catch {}
  for (let dir = from; dir !== path.dirname(dir); dir = path.dirname(dir)) {
    const nested = path.join(dir, 'packages', 'producttrace');
    if (isProducttrace(nested)) return fs.realpathSync(nested);
  }
  throw new Error('producttrace package not found: set PRODUCTTRACE_DIR or add it as a dependency');
}

export function packageBin(packageDir, name) {
  const { bin = {} } = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
  if (!bin[name]) throw new Error(`producttrace has no "${name}" bin`);
  return path.join(packageDir, bin[name]);
}
