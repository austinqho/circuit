// Finds the producttrace package this bench tests, and its command-line entry
// points (from its package.json "bin" map, so no internal path is assumed).
//
// Order: PRODUCTTRACE_DIR, then normal resolution by name (a workspace
// dependency), then the nearest ancestor directory whose package.json is named
// producttrace (the repository layout before the package moved into packages/).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const here = path.dirname(new URL(import.meta.url).pathname);

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
    const entry = createRequire(path.join(from, 'noop.js')).resolve('producttrace');
    let dir = path.dirname(entry);
    while (!isProducttrace(dir) && dir !== path.dirname(dir)) dir = path.dirname(dir);
    if (isProducttrace(dir)) return fs.realpathSync(dir);
  } catch {}
  for (let dir = from; dir !== path.dirname(dir); dir = path.dirname(dir)) {
    if (isProducttrace(dir)) return fs.realpathSync(dir);
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
