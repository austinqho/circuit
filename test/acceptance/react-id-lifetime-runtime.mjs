// Reuse the browser harness; the extended scenario adds alias and Suspense checks.
process.env.PRODUCTTRACE_REACT_ID_LIFETIMES='1';
await import('./react-id-runtime.mjs');
