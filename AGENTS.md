# Working in circuit

circuit is an npm workspace. The publishable package is `packages/producttrace`; `examples/*` and `apps/*` consume it by name.

## Commands

- `npm install`: installs everything and builds `packages/producttrace/dist`.
- `npm run check`: lint (import boundaries + prettier), typecheck, tests. CI runs exactly this. Run it before you push.
- `npm test -w producttrace`, or `node --test packages/producttrace/test/<file>.test.mjs` for one file.

## Rules that CI enforces

- **Packages are deep modules.** A package's public surface is the files at its root; everything in a subfolder is private. Outside code imports `producttrace/vite`, never `../packages/producttrace/integrations/vite.mjs`. `npm run lint:boundaries` (dependency-cruiser, config in `.dependency-cruiser.cjs`) fails on deep imports and on import cycles. To expose something new, add a small root entry file and an `exports` entry in the package's `package.json`; don't build a barrel that re-exports a whole folder.
- **New code is formatted** by prettier (the pre-commit hook does it). The dense engine folders are exempt; see `.prettierignore`.

## How the engine must behave

The reasons are in `docs/adr/`.

- Read-only to the app's source: at most one or two lines in one config file.
- Identifiers attach; timestamps only order. Never join two events because they happened close together.
- Abstain over guess. Say what was reached, where it stopped, and because of what. Never claim "mapped".
- No model in the runtime path, and no app-specific rules in the package.
- Don't build a crawler or path enumerator.

Until v1 ships, keep engine changes to what a v1 feature needs.

## Pull requests

- One PR per change, against `main`. Keep CI green.
- Never merge your own PR. Another agent reviews; Austin gives the final call.
- In the PR, say what a reviewer should run to see the change working.

## Agent skills

This repo is set up for [Matt Pocock's skills](https://github.com/mattpocock/skills).

### Issue tracker

Issues live in GitHub Issues on austinqho/circuit. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
