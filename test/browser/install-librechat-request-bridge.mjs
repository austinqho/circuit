// Kept as a migration entrypoint for older local commands. The former installer
// supplied a selected path and patched bundle strings, so it cannot validate
// autonomous discovery. Use the clean build instead of modifying an existing app.
throw new Error('The path-specific installer has been retired. Run npm run demo:build:librechat-autonomous; see README.md for the viewer and backend setup.');
