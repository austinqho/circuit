// Uninstrumented classic script (served from public/, never transformed):
// polls the DOM on its own interval, armed at load outside every action, and
// fetches when the flag flips. No first-party frame is ever on its stack.
(function () {
  var last = null;
  setInterval(function () {
    var node = document.querySelector('[data-toggled]');
    var value = node ? node.getAttribute('data-toggled') : null;
    if (last !== null && value !== last) fetch('/api/third-party?state=' + value);
    last = value;
  }, 25);
})();
