export { createLibraryExecutionContext } from './library-execution-context.mjs';
import fs from 'node:fs';
export { createLibraryProgram, validateLibraryProgram, LIBRARY_PROGRAM_SCHEMA, LibraryProgramFrontier } from './library-program.mjs';
export { createLibraryProgramBank, resolveVersionedProgram, programHash } from './library-program-bank.mjs';
export { createLibraryBoundary } from './library-boundary.mjs';
export { instrumentLibraryPrograms } from './library-program-integration.mjs';
export { createOwnedReferenceBoundary, createReactReferenceOwnerHost, createReactMemoOwnerHost } from './library-owned-reference.mjs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { compileReactSources } from './react-compiler.mjs';
import { compileBackendRoutes } from './backend-routes.mjs';
import { contractsForPackageVersion, libraryContractPackages } from './library-contracts.mjs';
import { reactPackageAttestation, reactSemanticPackages } from './react-semantics.mjs';
export { REACT_API_INVENTORY, REACT_PACKAGE_ATTESTATIONS, getReactApiRecord,
  reactPackageAttestation, reactSemanticPackages } from './react-semantics.mjs';
export { REACT_BEHAVIORS_18, REACT_IMPLICIT_BEHAVIORS_18, getReactBehavior, compareReactDependencies, planReactHookLifecycle } from './react-behavior.mjs';
export { createReactLifecycleEvidenceSession, REACT_LIFECYCLE_OBSERVATION_SCHEMA,
  REACT_LIFECYCLE_JOIN_SCHEMA } from './react-lifecycle-evidence.mjs';
export { createReactRuntimeIntegration } from './runtime-join.mjs';
export { createReactLazyCommitObserver, checkReactLazyCommit } from './react-lazy-commit.mjs';
export { createBrowserRequestBridgeSource, BROWSER_REQUEST_BRIDGE_SCHEMA } from './browser-request-bridge.mjs';
export { compileBackendRoutes, BACKEND_ROUTE_SCHEMA } from './backend-routes.mjs';
export { matchRequestToRoute, REQUEST_ROUTE_JOIN_SCHEMA } from './request-route-match.mjs';
export { connectRequestToHandler, REQUEST_HANDLER_BRIDGE_SCHEMA } from './request-handler-bridge.mjs';
export { confirmBackendExecution, BACKEND_EXECUTION_SPAN_SCHEMA } from './backend-execution.mjs';

const SOURCE = /\.[cm]?[jt]sx?$/i;
const TEST = /(?:^|\.)(?:test|spec)\.[cm]?[jt]sx?$/i;
const EXCLUDED = new Set(['node_modules', 'vendor', 'dist', 'build', 'coverage', '__tests__', 'test', 'tests']);
const DEFAULT_MAX_FILES = 5000;
const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;

function relativeName(value) {
  if (typeof value !== 'string' || !value || path.isAbsolute(value) || /^[A-Za-z]:/.test(value)) {
    throw new TypeError('Source paths must be nonempty repository-relative paths');
  }
  const portable = value.replaceAll('\\', '/');
  if (portable.startsWith('/') || portable.split('/').includes('..') || portable.includes('\0')) {
    throw new TypeError(`Source path escapes the repository: ${value}`);
  }
  return path.posix.normalize(portable).replace(/^\.\//, '');
}

function positiveLimit(value, fallback, name) {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result <= 0) throw new TypeError(`${name} must be a positive integer`);
  return result;
}

function workspaceAliases(root, files) {
  const aliases = Object.create(null);
  const conflicts = new Set();
  const checked = new Set();
  for (const file of Object.keys(files)) {
    let directory = path.dirname(path.join(root, file));
    while (directory === root || directory.startsWith(root + path.sep)) {
      const manifest = path.join(directory, 'package.json');
      if (!checked.has(manifest)) {
        checked.add(manifest);
        try {
          const manifestSource = fs.readFileSync(manifest, 'utf8');
          const metadata = JSON.parse(manifestSource);
          if (typeof metadata.name === 'string' && metadata.name) {
            const prefix = path.relative(root, directory).split(path.sep).join('/');
            const candidates = ['src/index.tsx', 'src/index.ts', 'src/index.jsx', 'src/index.js', 'index.tsx', 'index.ts', 'index.jsx', 'index.js']
              .map(entry => prefix ? `${prefix}/${entry}` : entry);
            const entry = candidates.find(candidate => Object.hasOwn(files, candidate));
            if (entry && !conflicts.has(metadata.name)) {
              const candidate = {
                file: entry,
                manifest: path.relative(root, manifest).split(path.sep).join('/'),
                manifest_sha256: createHash('sha256').update(manifestSource).digest('hex'),
              };
              if (!aliases[metadata.name]) aliases[metadata.name] = candidate;
              else if (aliases[metadata.name].file !== entry) {
                delete aliases[metadata.name];
                conflicts.add(metadata.name);
              }
            }
          }
        } catch (error) {
          if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
        }
      }
      if (directory === root) break;
      directory = path.dirname(directory);
    }
  }
  const imported = new Map();
  for (const [file, source] of Object.entries(files)) {
    const specifiers = [];
    const pattern = /(?:\bfrom\s*|\bimport\s*\()\s*['"]([^'"]+)['"]/gu;
    for (const match of source.matchAll(pattern)) specifiers.push(match[1]);
    imported.set(file, specifiers);
  }
  const configFiles = new Set();
  const configByImporter = new Map();
  for (const file of Object.keys(files)) {
    let directory = path.dirname(path.join(root, file));
    while (directory === root || directory.startsWith(root + path.sep)) {
      const config = path.join(directory, 'tsconfig.json');
      if (fs.existsSync(config)) { configFiles.add(config); configByImporter.set(file, config); break; }
      if (directory === root) break;
      directory = path.dirname(directory);
    }
  }
  const candidateFile = base => [base, ...['.tsx', '.ts', '.jsx', '.js', '/index.tsx', '/index.ts', '/index.jsx', '/index.js']
    .map(extension => base + extension)].find(file => Object.hasOwn(files, file));
  for (const config of [...configFiles].sort()) {
    let source;
    let parsed;
    try { source = fs.readFileSync(config, 'utf8'); parsed = JSON.parse(source); }
    catch { continue; }
    const directory = path.dirname(config);
    const base = path.resolve(directory, parsed.compilerOptions?.baseUrl || '.');
    const underConfig = [...imported].filter(([file]) => {
      return configByImporter.get(file) === config;
    });
    for (const [pattern, targets] of Object.entries(parsed.compilerOptions?.paths || {})) {
      if (!Array.isArray(targets)) continue;
      const wildcard = pattern.indexOf('*');
      const prefix = wildcard < 0 ? pattern : pattern.slice(0, wildcard);
      const suffix = wildcard < 0 ? '' : pattern.slice(wildcard + 1);
      for (const specifier of new Set(underConfig.flatMap(([, values]) => values))) {
        if (wildcard < 0 ? specifier !== pattern : !specifier.startsWith(prefix) || !specifier.endsWith(suffix)) continue;
        const matched = wildcard < 0 ? '' : specifier.slice(prefix.length, specifier.length - suffix.length || undefined);
        const resolved = targets.map(target => target.replace('*', matched)).map(target => path.resolve(base, target))
          .map(absolute => path.relative(root, absolute).split(path.sep).join('/')).map(candidateFile).filter(Boolean);
        const choices = [...new Set(resolved)];
        if (choices.length !== 1) continue;
        const evidence = { file: choices[0], manifest: path.relative(root, config).split(path.sep).join('/'),
          manifest_sha256: createHash('sha256').update(source).digest('hex') };
        // The same alias can denote different files in separate workspaces.
        // Keep config evidence tied to each importer instead of combining those
        // names into a repository-wide ambiguity (or borrowing a sibling path).
        for (const [importer, specifiers] of underConfig) {
          if (!specifiers.includes(specifier)) continue;
          const key = `${importer}\0${specifier}`;
          if (conflicts.has(key)) continue;
          if (!aliases[key]) aliases[key] = { ...evidence, importer };
          else if (aliases[key].file !== evidence.file) { delete aliases[key]; conflicts.add(key); }
        }
      }
    }
  }
  return aliases;
}

function resolvePackageInstall(root, importer, name) {
  let directory = path.dirname(path.join(root, importer));
  while (directory === root || directory.startsWith(root + path.sep)) {
    const packageRoot = path.join(directory, 'node_modules', ...name.split('/'));
    try {
      if (fs.statSync(path.join(packageRoot, 'package.json')).isFile()) {
        return path.relative(root, packageRoot).split(path.sep).join('/');
      }
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
    }
    if (directory === root) break;
    directory = path.dirname(directory);
  }
  return null;
}

function packageImporters(files, name) {
  const result = [];
  const pattern = /(?:\bfrom\s*|\bimport\s*\()\s*['"]([^'"]+)['"]/gu;
  for (const [file, source] of Object.entries(files)) {
    if ([...source.matchAll(pattern)].some(match => match[1] === name || match[1].startsWith(`${name}/`))) result.push(file);
  }
  return result.sort();
}

function lockedPackageEvidence(root, files) {
  const lockfile = path.join(root, 'package-lock.json');
  let source;
  let lock;
  try {
    source = fs.readFileSync(lockfile, 'utf8');
    lock = JSON.parse(source);
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return {};
    throw error;
  }
  const lockfileSha256 = createHash('sha256').update(source).digest('hex');
  const evidence = {};
  const lockedRow = installPath => lock.packages?.[installPath];
  const sourceAttestations = (contract, primaryInstallPath) => {
    const observed = [];
    for (const installation of contract.verification.installations || []) {
      const installPath = installation.package === contract.package ? primaryInstallPath
        : resolvePackageInstall(root, `${primaryInstallPath}/package.json`, installation.package);
      if (!installPath) return { verified: false, reason: 'dependency_resolution_unavailable' };
      const row = lockedRow(installPath);
      if (!row) return { verified: false, reason: 'dependency_lock_unavailable' };
      if (row.version !== installation.version) return { verified: false, reason: 'dependency_version_mismatch' };
      if (row.integrity !== installation.integrity) return { verified: false, reason: 'dependency_integrity_mismatch' };
      const packageRoot = path.join(root, installPath);
      let manifest;
      try { manifest = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8')); }
      catch { return { verified: false, reason: 'installed_dependency_unavailable' }; }
      if (manifest.version !== installation.version) return { verified: false, reason: 'installed_dependency_version_mismatch' };
      for (const [relative, expectedSha256] of Object.entries(installation.files || {})) {
        let bytes;
        try { bytes = fs.readFileSync(path.join(packageRoot, relative)); }
        catch { return { verified: false, reason: 'installed_dependency_source_unavailable' }; }
        let sha256 = createHash('sha256').update(bytes).digest('hex');
        // npm and pnpm can extract an identical package.json with different
        // final-newline bytes. Accept only that serialization difference;
        // executable package sources still require exact byte hashes.
        if (sha256 !== expectedSha256 && relative === 'package.json') {
          const text = bytes.toString('utf8').replace(/\n?$/u, '\n');
          const newlineNormalized = createHash('sha256').update(text).digest('hex');
          if (newlineNormalized === expectedSha256) sha256 = newlineNormalized;
        }
        if (sha256 !== expectedSha256) return { verified: false, reason: 'installed_dependency_source_mismatch' };
        observed.push({ package: installation.package, version: installation.version,
          install_path: installPath, file: relative, sha256 });
      }
    }
    return { verified: true, source_attestations: observed,
      verification_sha256: createHash('sha256').update(JSON.stringify(observed)).digest('hex') };
  };
  const reactPackages = new Set(reactSemanticPackages());
  for (const name of [...new Set([...libraryContractPackages(), ...reactPackages])].sort()) {
    const importers = packageImporters(files, name);
    if (!importers.length) continue;
    const resolutions = importers.map(importer => ({ importer, install_path: resolvePackageInstall(root, importer, name) }));
    const unresolvedImporters = resolutions.filter(row => !row.install_path);
    const resolvedInstallPaths = [...new Set(resolutions.filter(row => row.install_path).map(row => row.install_path))].sort();
    if (!resolvedInstallPaths.length) {
      evidence[name] = { version: 'unresolved', source: 'node_resolution', verified: false,
        reason: 'package_importer_unresolved', importers: resolutions };
      continue;
    }
    const installations = resolvedInstallPaths.map(installPath => {
      const scopedImporters = resolutions.filter(row => row.install_path === installPath);
      const row = lockedRow(installPath);
      let manifest;
      try { manifest = JSON.parse(fs.readFileSync(path.join(root, installPath, 'package.json'), 'utf8')); }
      catch { manifest = null; }
      const version = typeof manifest?.version === 'string' ? manifest.version : row?.version;
      if (typeof version !== 'string') return { version: 'unresolved', source: 'node_resolution',
        install_path: installPath, verified: false, reason: 'resolved_package_version_unavailable', importers: scopedImporters };
      const candidates = reactPackages.has(name)
        ? [reactPackageAttestation(name, version)].filter(Boolean)
        : contractsForPackageVersion(name, version);
      const base = { version, source: 'node_resolution+package-lock.json', lockfile: 'package-lock.json',
        install_path: installPath, lockfile_sha256: lockfileSha256,
        ...(typeof row?.integrity === 'string' ? { integrity: row.integrity } : {}), importers: scopedImporters };
      if (!row) return { ...base, verified: false, reason: 'resolved_installation_lock_unavailable', contract_verifications: [] };
      if (row.version !== version) return { ...base, verified: false, reason: 'resolved_installation_version_mismatch', contract_verifications: [] };
      if (!candidates.length) return { ...base, verified: false,
        reason: reactPackages.has(name) ? 'react_semantics_version_unavailable' : 'contract_version_unavailable',
        ...(reactPackages.has(name) ? { react_semantics_verification: null } : { contract_verifications: [] }) };
      const verificationRows = candidates.map(candidate => ({
        ...(reactPackages.has(name) ? { semantic_attestation_id: candidate.id } : { contract_id: candidate.id }),
        ...sourceAttestations(candidate, installPath),
      }));
      const verified = verificationRows.every(result => result.verified);
      const sourceAttestationRows = verificationRows.flatMap(result => result.source_attestations || []);
      const verificationHashes = [...new Set(verificationRows
        .map(result => result.verification_sha256).filter(Boolean))];
      const failureReasons = [...new Set(verificationRows
        .filter(result => !result.verified).map(result => result.reason).filter(Boolean))];
      return { ...base, verified, ...(verified ? {} : {
        reason: failureReasons.length === 1 ? failureReasons[0] : 'one_or_more_contracts_unverified',
      }),
        ...(verificationHashes.length === 1 ? { verification_sha256: verificationHashes[0] } : {}),
        ...(reactPackages.has(name)
          ? { react_semantics_verification: verificationRows[0] }
          : { contract_verifications: verificationRows }),
        source_attestations: sourceAttestationRows };
    });
    evidence[name] = installations.length === 1 && !unresolvedImporters.length ? installations[0] : {
      version: 'multiple', source: 'node_resolution+package-lock.json', lockfile: 'package-lock.json',
      lockfile_sha256: lockfileSha256, verified: false,
      reason: unresolvedImporters.length ? 'one_or_more_importers_unresolved' : 'multiple_resolved_installations',
      importers: resolutions, installations, ...(unresolvedImporters.length ? { unresolved_importers: unresolvedImporters } : {}),
    };
  }
  return evidence;
}

/** Analyze source snapshots or read one repository without executing its code. */
export function analyzeReact(options = {}) {
  const hasFiles = options.files !== undefined;
  const hasRepository = options.repository !== undefined;
  if (hasFiles === hasRepository) throw new TypeError('Supply exactly one of files or repository');
  if (hasFiles && options.include !== undefined) throw new TypeError('include is only supported for repository input');
  if (options.packages !== undefined) throw new TypeError('packages is not a public input; repository analysis verifies its lockfile and installed sources');
  const maxFiles = positiveLimit(options.maxFiles, DEFAULT_MAX_FILES, 'maxFiles');
  const maxBytes = positiveLimit(options.maxBytes, DEFAULT_MAX_BYTES, 'maxBytes');
  const files = Object.create(null);
  const diagnostics = [];
  let fileCount = 0;
  let byteCount = 0;
  const report = (code, file, message) => diagnostics.push({ code, file, message });
  const take = (file, source) => {
    if (Object.hasOwn(files, file)) return;
    if (fileCount >= maxFiles) return report('source_file_limit', file, `Source file limit ${maxFiles} reached; file not analyzed`);
    const size = Buffer.byteLength(source);
    if (byteCount + size > maxBytes) return report('source_byte_limit', file, `Source byte limit ${maxBytes} exceeded; file not analyzed`);
    files[file] = source;
    byteCount += size;
    fileCount++;
  };

  if (hasFiles) {
    if (!options.files || typeof options.files !== 'object' || Array.isArray(options.files)) throw new TypeError('files must map relative filenames to source strings');
    const entries = Object.entries(options.files).map(([file, source]) => [relativeName(file), source]);
    const names = new Set();
    for (const [file, source] of entries.sort(([a], [b]) => a.localeCompare(b))) {
      if (names.has(file)) throw new TypeError(`Duplicate normalized source path: ${file}`);
      names.add(file);
      if (typeof source !== 'string') throw new TypeError(`Source must be a string: ${file}`);
      if (!SOURCE.test(file) || /\.d\.[cm]?ts$/i.test(file)) throw new TypeError(`Unsupported source extension: ${file}`);
      take(file, source);
    }
  } else {
    if (typeof options.repository !== 'string' || !options.repository) throw new TypeError('repository must be a directory path');
    const root = fs.realpathSync(options.repository);
    if (!fs.statSync(root).isDirectory()) throw new TypeError('repository must be a directory');
    const includes = options.include ?? ['.'];
    if (!Array.isArray(includes) || !includes.length) throw new TypeError('include must be a nonempty array of relative paths');
    const visited = new Set();
    const walk = (requested) => {
      const file = path.relative(root, requested).split(path.sep).join('/') || '.';
      let real;
      let stat;
      try {
        real = fs.realpathSync(requested);
        const rel = path.relative(root, real);
        if (rel.startsWith('..' + path.sep) || rel === '..' || path.isAbsolute(rel)) {
          report('external_source_symlink', file, 'Source symlink points outside the repository and was not followed');
          return;
        }
        stat = fs.statSync(real);
      } catch (error) {
        report('unreadable_source', file, `Source could not be inspected (${error.code || 'IO_ERROR'})`);
        return;
      }
      if (visited.has(real)) return;
      visited.add(real);
      if (stat.isDirectory()) {
        let entries;
        try { entries = fs.readdirSync(real, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)); }
        catch (error) { report('unreadable_source', file, `Directory could not be read (${error.code || 'IO_ERROR'})`); return; }
        for (const entry of entries) {
          if (entry.name.startsWith('.') || EXCLUDED.has(entry.name)) continue;
          walk(path.join(real, entry.name));
        }
      } else if (stat.isFile() && SOURCE.test(real) && !TEST.test(real) && !/\.d\.[cm]?ts$/i.test(real)) {
        const canonical = path.relative(root, real).split(path.sep).join('/');
        if (stat.size > maxBytes - byteCount) { report('source_byte_limit', canonical, `Source byte limit ${maxBytes} exceeded; file not analyzed`); return; }
        if (fileCount >= maxFiles) { report('source_file_limit', canonical, `Source file limit ${maxFiles} reached; file not analyzed`); return; }
        try { take(canonical, fs.readFileSync(real, 'utf8')); }
        catch (error) { report('unreadable_source', canonical, `Source could not be read (${error.code || 'IO_ERROR'})`); }
      }
    };
    for (const entry of [...includes].map(relativeName).sort()) walk(path.resolve(root, entry));
  }
  if (!fileCount) report('empty_source_input', null, 'No supported source files were analyzed');
  const repositoryRoot = hasRepository ? fs.realpathSync(options.repository) : null;
  const aliases = hasRepository ? workspaceAliases(repositoryRoot, files) : {};
  const packages = hasRepository ? lockedPackageEvidence(repositoryRoot, files) : {};
  const map = compileReactSources(files, { moduleAliases: aliases, packages });
  map.diagnostics.push(...diagnostics);
  map.input = {
    mode: hasFiles ? 'snapshot' : 'repository',
    complete: diagnostics.length === 0,
    file_count: fileCount,
    byte_count: byteCount,
    limits: { maxFiles, maxBytes },
    exclusions: hasFiles ? [] : ['hidden paths', ...EXCLUDED, '*.test.*', '*.spec.*', '*.d.ts', 'external symlinks'],
  };
  return map;
}

/** Inventory backend route registrations without executing the target repository. */
export function analyzeBackendRoutes(options = {}) {
  const hasFiles = options.files !== undefined;
  const hasRepository = options.repository !== undefined;
  if (hasFiles === hasRepository) throw new TypeError('Supply exactly one of files or repository');
  if (hasFiles && options.include !== undefined) throw new TypeError('include is only supported for repository input');
  const maxFiles = positiveLimit(options.maxFiles, DEFAULT_MAX_FILES, 'maxFiles');
  const maxBytes = positiveLimit(options.maxBytes, DEFAULT_MAX_BYTES, 'maxBytes');
  const files = Object.create(null);
  const diagnostics = [];
  let fileCount = 0;
  let byteCount = 0;
  const report = (code, file, message) => diagnostics.push({ code, file, message });
  const take = (file, source) => {
    if (Object.hasOwn(files, file)) return;
    if (fileCount >= maxFiles) return report('source_file_limit', file,
      `Source file limit ${maxFiles} reached; file not analyzed`);
    const size = Buffer.byteLength(source);
    if (byteCount + size > maxBytes) return report('source_byte_limit', file,
      `Source byte limit ${maxBytes} exceeded; file not analyzed`);
    files[file] = source;
    fileCount++;
    byteCount += size;
  };
  if (hasFiles) {
    if (!options.files || typeof options.files !== 'object' || Array.isArray(options.files)) {
      throw new TypeError('files must map relative filenames to source strings');
    }
    const names = new Set();
    for (const [rawFile, source] of Object.entries(options.files)
      .map(([file, value]) => [relativeName(file), value]).sort(([a], [b]) => a.localeCompare(b))) {
      if (names.has(rawFile)) throw new TypeError(`Duplicate normalized source path: ${rawFile}`);
      names.add(rawFile);
      if (typeof source !== 'string') throw new TypeError(`Source must be a string: ${rawFile}`);
      if (!SOURCE.test(rawFile) || /\.d\.[cm]?ts$/i.test(rawFile)) {
        throw new TypeError(`Unsupported source extension: ${rawFile}`);
      }
      take(rawFile, source);
    }
  } else {
    if (typeof options.repository !== 'string' || !options.repository) {
      throw new TypeError('repository must be a directory path');
    }
    const root = fs.realpathSync(options.repository);
    if (!fs.statSync(root).isDirectory()) throw new TypeError('repository must be a directory');
    const includes = options.include ?? ['.'];
    if (!Array.isArray(includes) || !includes.length) throw new TypeError('include must be a nonempty array of relative paths');
    const visited = new Set();
    const walk = requested => {
      const display = path.relative(root, requested).split(path.sep).join('/') || '.';
      let real;
      let stat;
      try {
        real = fs.realpathSync(requested);
        const rel = path.relative(root, real);
        if (rel.startsWith(`..${path.sep}`) || rel === '..' || path.isAbsolute(rel)) {
          report('external_source_symlink', display, 'Source symlink points outside the repository and was not followed');
          return;
        }
        stat = fs.statSync(real);
      } catch (error) {
        report('unreadable_source', display, `Source could not be inspected (${error.code || 'IO_ERROR'})`);
        return;
      }
      if (visited.has(real)) return;
      visited.add(real);
      if (stat.isDirectory()) {
        let entries;
        try { entries = fs.readdirSync(real, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)); }
        catch (error) { report('unreadable_source', display, `Directory could not be read (${error.code || 'IO_ERROR'})`); return; }
        for (const entry of entries) {
          if (entry.name.startsWith('.') || EXCLUDED.has(entry.name)) continue;
          walk(path.join(real, entry.name));
        }
      } else if (stat.isFile() && SOURCE.test(real) && !TEST.test(real) && !/\.d\.[cm]?ts$/i.test(real)) {
        const canonical = path.relative(root, real).split(path.sep).join('/');
        try { take(canonical, fs.readFileSync(real, 'utf8')); }
        catch (error) { report('unreadable_source', canonical, `Source could not be read (${error.code || 'IO_ERROR'})`); }
      }
    };
    for (const include of includes.map(relativeName).sort()) walk(path.resolve(root, include));
  }
  if (!fileCount) report('empty_source_input', null, 'No supported source files were analyzed');
  const map = compileBackendRoutes(files, { serviceId: options.serviceId });
  map.diagnostics.push(...diagnostics);
  map.input = {
    mode: hasFiles ? 'snapshot' : 'repository', complete: diagnostics.length === 0,
    file_count: fileCount, byte_count: byteCount, limits: { maxFiles, maxBytes },
    exclusions: hasFiles ? [] : ['hidden paths', ...EXCLUDED, '*.test.*', '*.spec.*', '*.d.ts', 'external symlinks'],
  };
  return map;
}

export { createOwnedValueBoundary } from './library-owned-value.mjs';
export { createRuntimeAttributionEngine, createIdentityEncoder, stableFunctionId, indexEntryHandlerUnits, replayCausalChains, attachBackendSpans, buildActionChains } from './runtime-attribution.mjs';
export { buildEpisodeChain, chainControl, chainFrontier, hopSegments } from './causal-chain.mjs';
export { serverHops } from './runtime-attribution.mjs';
export { indexElementStamps, resolveElement, isElementKey } from './element-index.mjs';

export {createHostEventBoundary} from './library-host-events.mjs';
export {createReactEffectEventHost} from './library-react-effect-host.mjs';
