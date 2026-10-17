// Entry point: `producttrace/observe`. Debugger mode: what the user did and
// what each action caused, read from Chrome's debugger with nothing in the
// app rewritten. Needs a DevTools Protocol session for the page, so it runs
// where the browser is driven (the bench, verify, Playwright, an agent).
export { observePage } from './observe/observer.mjs';
