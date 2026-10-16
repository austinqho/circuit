// The loader `withProducttrace()` adds to `next dev` (Turbopack or webpack) for
// first-party browser modules. All the work is in next-transform.mjs.
let transform = null;

module.exports = function producttraceLoader(source) {
  const callback = this.async();
  const options = this.getOptions();
  transform ||= import('./next-transform.mjs');
  transform
    .then(({ transformNextModule }) => transformNextModule(String(source), this.resourcePath, options))
    .then(
      (result) => (result ? callback(null, result.code, JSON.stringify(result.map)) : callback(null, source)),
      // Recording is never a reason for the app not to compile.
      (error) => {
        this.emitWarning?.(new Error(`producttrace left ${this.resourcePath} as it is: ${error?.message || error}`));
        callback(null, source);
      },
    );
};
