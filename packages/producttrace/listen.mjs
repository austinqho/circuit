// Entry point: `producttrace/listen`. Listen mode: one script on the page that
// only listens. It replaces no browser API and writes nothing into the page,
// reports its own cost exactly, and works in production in any browser.
export { fingerprintSource, listenScript } from './listen/script.mjs';
