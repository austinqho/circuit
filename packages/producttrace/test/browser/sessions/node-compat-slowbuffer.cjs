// Harness-only Node compatibility shim (not part of the package).
// Node >= 25 removed buffer.SlowBuffer; older transitive dependencies of some
// fixture servers (buffer-equal-constant-time via jsonwebtoken/jwa) read
// SlowBuffer.prototype at require time and crash. The fixture machine only has
// Node 26, so the fresh-repo harness preloads this shim into fixture servers.
// It changes no application code and no Tracer behavior.
const buffer = require('node:buffer');
if (!buffer.SlowBuffer) {
  function SlowBuffer(size) { return Buffer.allocUnsafeSlow(size); }
  SlowBuffer.prototype = Buffer.prototype;
  buffer.SlowBuffer = SlowBuffer;
}
