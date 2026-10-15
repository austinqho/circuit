import { programHash, resolveVersionedProgram } from '../analysis/library-program-bank.mjs';
import { readLibraryImplementation } from './library-implementation.mjs';

/** Resolve catalog-declared host packages without treating their entire runtime
 * as source-closed for a new model proposal. This path is only for rechecking an
 * existing exact-source catalog entry through the independent checker. */
export function readCatalogImplementation({ repository, specifier, exportName, skeleton }) {
  const primary = readLibraryImplementation({ repository, specifier, exportName });
  const requirements = skeleton.host_dependencies ?? [];
  if (!Array.isArray(requirements) || requirements.length > 8) throw new TypeError('catalog_host_requirements');
  if (!requirements.length) return primary;
  const hosts = requirements.map(row => readLibraryImplementation({ repository, specifier: row.specifier, exportName: row.export_name }));
  const context = { ...primary.context, source_status: 'ready_for_catalog_recheck',
    source_reason: 'host_runtime_requires_existing_catalog_and_independent_recheck',
    host_dependencies: hosts.map(host => host.context) };
  return { producer: primary.producer, context, sha256: programHash(context),
    unchanged: () => primary.unchanged() && hosts.every(host => host.unchanged()) };
}

/** npm aliases rename the package segment, not its public entry point. Keep
 * subpath exports distinct: two modules may both export a function as default. */
export function libraryImportSubpath(specifier) {
  if(typeof specifier!=='string'||!specifier.length)throw new TypeError('catalog_import_specifier');
  const segments=specifier.split('/'),packageSegments=specifier.startsWith('@')?2:1;
  return segments.length===packageSegments?'.':'./'+segments.slice(packageSegments).join('/');
}

/** Remove checkout paths and npm aliases without removing source identity. */
export function portableImplementation(context) {
  const packages = [...context.packages].sort((a, b) => b.path.length - a.path.length);
  const identify = filename => {
    const owner = packages.find(row => filename === row.path || filename.startsWith(row.path + '/'));
    if (!owner) throw new TypeError('source_package_identity_missing');
    return { name: owner.name, version: owner.version, path: filename.slice(owner.path.length + 1) };
  };
  const sort = rows => rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return {
    runtime: { host: context.runtime.host, mode: context.runtime.mode, entry: identify(context.runtime.entry) },
    export_name: context.export_name,
    packages: sort(packages.map(({ name, version, integrity, manifest_sha256 }) => ({ name, version, integrity, manifest_sha256 }))),
    files: sort(context.files.map(file => ({ ...identify(file.path), sha256: file.sha256 }))),
    ...(context.host_dependencies ? { host_dependencies: context.host_dependencies.map(portableImplementation) } : {}),
    ...(context.export_resolution ? {export_resolution:{...context.export_resolution,getters:context.export_resolution.getters.map(row=>({...row,file:identify(row.file)}))}} : {}),
    ...(context.host_binding ? { host_binding: context.host_binding } : {}),
  };
}

/** Build replacement-only version data; this function confers no admission. */
export function programOverrides(base, target) {
  const overrides = [];
  const visit = (left, right, path) => {
    if (JSON.stringify(left) === JSON.stringify(right)) return;
    if (left && right && typeof left === 'object' && typeof right === 'object'
      && Array.isArray(left) === Array.isArray(right)
      && JSON.stringify(Object.keys(left).sort()) === JSON.stringify(Object.keys(right).sort())) {
      for (const key of Object.keys(left)) visit(left[key], right[key], [...path, Array.isArray(left) ? Number(key) : key]);
    } else overrides.push({ path, value: structuredClone(right) });
  };
  visit(base.body, target.body, ['body']);
  return overrides;
}

/**
 * A portable catalog is a source-pinned candidate cache, not a trusted boolean.
 * Every installation rechecks its bytes and runs the host's independent checker
 * before the program becomes available to the tracing adapter.
 */
export async function admitCatalogProgram({ skeleton, implementation, bank }) {
  if (!['ready_for_scoped_proposal', 'ready_for_catalog_recheck'].includes(implementation.context.source_status) || !implementation.unchanged())
    return { status: 'rejected', stage: 'source', reason: 'implementation_not_attested' };
  let source;
  try { source = portableImplementation(implementation.context); }
  catch (error) { return { status: 'rejected', stage: 'source', reason: error.message }; }
  if (skeleton.package !== source.runtime.entry.name || skeleton.export_name !== source.export_name)
    return { status: 'rejected', stage: 'catalog', reason: 'catalog_export_mismatch' };
  if((skeleton.import_subpath??'.')!==libraryImportSubpath(implementation.context.specifier))
    return {status:'rejected',stage:'catalog',reason:'catalog_import_subpath_mismatch'};
  let resolved = resolveVersionedProgram(skeleton, source.runtime.entry.version);
  if (resolved.status !== 'resolved_program') return { status: 'rejected', stage: 'version', reason: resolved.reason };
  const row = skeleton.versions.find(row => row.version === source.runtime.entry.version);
  const variants = row.source_variants ?? [row];
  if (!Array.isArray(variants)) return { status: 'rejected', stage: 'catalog', reason: 'source_variant_shape' };
  const matches = variants.filter(variant => variant.implementation_sha256 === programHash(source));
  if (matches.length !== 1)
    return { status: 'rejected', stage: 'source', reason: 'catalog_installed_source_mismatch' };
  const selected = matches[0];
  if (row.source_variants) {
    // Build mode and peer/dependency bytes can differ at the same package
    // version. Only an explicitly checked source variant may override the
    // version program; an unknown combination never inherits a nearby match.
    resolved = resolveVersionedProgram({ schema: skeleton.schema, program: resolved.program, versions: [{
      version: source.runtime.entry.version, base_sha256: resolved.sha256, overrides: selected.overrides,
    }] }, source.runtime.entry.version);
    if (resolved.status !== 'resolved_program') return { status: 'rejected', stage: 'catalog', reason: resolved.reason };
  }
  if (selected.program_sha256 !== resolved.sha256)
    return { status: 'rejected', stage: 'catalog', reason: 'catalog_program_changed' };
  // A changed version/build may expose different observable paths as well as
  // different instructions. Its scope is explicit versioned data and still
  // goes through the caller's independent behavior/integration checker.
  const scope = selected.scope ?? row.scope ?? skeleton.scope;
  return bank.admit({ implementation, program: resolved.program, scope });
}
