// An uninstrumented script (served from public/, never transformed). It knows
// nothing about Tracer. The driver arms one event kind at run time; the
// listener then sends a request. It also sends a beacon when the page hides.
(function () {
  var fired = [];
  var probeListeners = [];
  window.__vendorProbe = function (kinds) {
    var panel = document.getElementById('notes-panel');
    fired = [];
    kinds.forEach(function (kind) {
      var listener = function (event) { if (event.isTrusted && fired.indexOf(kind) < 0) fired.push(kind); };
      panel.addEventListener(kind, listener);
      probeListeners.push([kind, listener]);
    });
  };
  window.__vendorProbeResult = function () {
    var panel = document.getElementById('notes-panel');
    probeListeners.forEach(function (entry) { panel.removeEventListener(entry[0], entry[1]); });
    probeListeners = [];
    return fired.slice();
  };
  window.__vendorArm = function (kind) {
    var panel = document.getElementById('notes-panel');
    panel.addEventListener(kind, function () {
      fetch('/api/hover-note', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"via":"vendor"}' });
    }, { once: true });
  };
  // Replaces window.fetch late (as some SDKs do), still calling the previous one.
  window.__vendorWrapFetch = function () {
    var previous = window.fetch;
    window.fetch = function () { return previous.apply(this, arguments); };
  };
  window.addEventListener('pagehide', function () {
    navigator.sendBeacon('/api/bye', '{"left":true}');
  });
})();
