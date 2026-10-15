# 5. A package's public surface is its root files

Status: accepted.

Decision: each package under `packages/` is a deep module. Its root files are its entry points and the only targets of its `package.json` `exports`; everything in a subfolder is private. dependency-cruiser enforces this and forbids import cycles (`npm run lint:boundaries`). Adopted from Matt Pocock's `setup-ts-deep-modules` skill.

Exception: producttrace's existing unit tests in `test/` reach internals directly. New packages put tests in `tests/` and go through entry points.
