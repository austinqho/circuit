// @ts-check
// Deep-module enforcement (from Matt Pocock's setup-ts-deep-modules skill).
//
// Each package under packages/ is a DEEP MODULE: a lot of behaviour behind a
// small interface. A package's PUBLIC SURFACE is its ENTRY POINTS, the files
// at the package root (for producttrace: index.js, vite.mjs, collector.js,
// backend.js, backend-register.js, analysis.mjs, runtime-attribution.mjs,
// mcp*.mjs). Everything in a subfolder is private. Its package.json "exports"
// map points only at those root files.
//
// examples/* and apps/* are consumers. They import packages by name
// (`producttrace/vite`), which resolves to a root entry point, never by a
// relative path into a package's folders.
//
// Deviation from the skill: producttrace keeps its unit tests in `test/`
// (singular), which counts as an ordinary private subfolder, so those tests
// may reach internals. New packages should put tests in `tests/` and go
// through the entry points.

const R = 'packages';
const PACKAGE_INTERNALS = `^${R}/[^/]+/[^/]+/`;

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'entrypoint-boundary-from-app',
      comment:
        "examples/ and apps/ may import a package's entry points (its root files), never anything inside its subfolders.",
      severity: 'error',
      from: { pathNot: `^${R}/` },
      to: { path: PACKAGE_INTERNALS },
    },
    {
      name: 'entrypoint-boundary-across-packages',
      comment:
        "A package's own files import each other freely, but reach OTHER packages only through their entry points.",
      severity: 'error',
      from: { path: `^${R}/([^/]+)/`, pathNot: `^${R}/[^/]+/tests/` },
      to: { path: PACKAGE_INTERNALS, pathNot: `^${R}/$1/` },
    },
    {
      name: 'tests-through-entrypoints',
      comment:
        "Files in a package's tests/ folder use entry points like everyone else, plus their own tests/ fixtures.",
      severity: 'error',
      from: { path: `^${R}/([^/]+)/tests/` },
      to: { path: PACKAGE_INTERNALS, pathNot: `^${R}/$1/tests/` },
    },
    {
      name: 'tests-folder-is-private',
      comment: "Only tests may import a package's tests/ fixtures.",
      severity: 'error',
      from: { pathNot: `^${R}/[^/]+/tests?/` },
      to: { path: `^${R}/[^/]+/tests?/` },
    },
    {
      name: 'no-circular',
      comment: 'No dependency cycles.',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    includeOnly: '^(packages|examples|apps)/',
    doNotFollow: { path: 'node_modules' },
    exclude: {
      path: [
        'node_modules',
        '/dist/',
        // Throwaway clones of other people's apps that the test bench runs.
        '/\\.work/',
        // Inline app sources written to temp dirs by fixtures, not real modules.
        `^${R}/[^/]+/test/(fixtures|browser/fixtures|browser/palmier-sample)/`,
      ],
    },
    enhancedResolveOptions: {
      extensions: [
        '.mjs',
        '.js',
        '.cjs',
        '.ts',
        '.tsx',
        '.jsx',
        '.mts',
        '.d.mts',
        '.d.ts',
        '.json',
      ],
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
    },
  },
};
