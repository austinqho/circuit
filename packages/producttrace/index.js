import './dist/producttrace-runtime.js';

const api = globalThis.ProductTrace;
let activeRecorder = null;

if (!api) {
  throw new Error('ProductTrace requires a browser window');
}

export function start(bindings, options) {
  activeRecorder = api.start(bindings, options);
  return activeRecorder;
}

export function stop() {
  return activeRecorder ? activeRecorder.stop() : null;
}

export function status() {
  return activeRecorder ? activeRecorder.status() : null;
}

export function discover(enabled = true) {
  return api.discover(enabled);
}

export function discoveryReport() {
  return api.discoveryReport();
}

export { api as productTrace };
