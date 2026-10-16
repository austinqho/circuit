// Neutral worker fixture (classic script, no framework). A worker created at
// page load does the fetching: a click posts a message to it, the worker
// fetches /api/x, and the page receives the result. A second worker is
// created at load and is never messaged by the click (negative control).
(function workerFixture(global) {
  const results = global.__workerFixtureResults = [];
  const worker = new global.Worker('/worker.js');
  const idle = new global.Worker('/idle-worker.js');
  idle.postMessage({ op: 'warm' }); // at load, outside any action
  worker.addEventListener('message', event => {
    results.push(event.data);
    const output = global.document.getElementById('output');
    if (output) output.textContent = `loaded ${event.data?.path} (${event.data?.status})`;
  });
  global.document.getElementById('load').addEventListener('click', function loadViaWorker() {
    worker.postMessage({ op: 'load', path: '/api/x' });
  });
  global.document.getElementById('noop').addEventListener('click', function noop() {});
})(globalThis);
