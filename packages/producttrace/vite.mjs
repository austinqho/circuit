// Entry point: `producttrace/vite`. The Vite plugin that instruments a React app at build time.
// `producttrace()` is the one-line install; the other two are its parts.
export {
  producttrace,
  productTraceVitePlugin,
  runtimeAttributionPlugin,
} from './integrations/vite.mjs';
