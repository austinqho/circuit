// Listen mode, the browser half. Pasted as one <script> in the app's page (or
// added by a test harness as an init script). The contract, checked by verify
// and by test/listen.test.mjs:
//   - it defines no globals and replaces no browser API;
//   - it writes nothing into the page: no attributes, no headers, no storage;
//   - it only adds passive listeners on window/document, runs
//     PerformanceObservers, reads React's own props/fiber keys on DOM nodes
//     and sends its rows with navigator.sendBeacon;
//   - its cost is measured exactly: circuit code only ever runs inside its own
//     callbacks, so it times every one and reports the total (cost_ms).
// Any error inside circuit is caught and counted; the app never sees it.
(function (config) {
  'use strict';
  var w = window;
  var perf = w.performance;
  var now = function () {
    return perf.now();
  };
  var setupStart = now();
  var page = Math.random().toString(36).slice(2, 10);
  var cost = 0;
  var calls = 0;
  var errors = 0;
  var seq = 0;
  var sent = 0;
  var buffer = [];
  var maxRows = config.maxRows || 200;

  function timed(fn) {
    return function (arg) {
      var t = now();
      try {
        fn(arg);
      } catch (error) {
        errors += 1;
      }
      cost += now() - t;
      calls += 1;
    };
  }

  function push(row) {
    seq += 1;
    row.seq = seq;
    buffer.push(row);
    if (buffer.length >= maxRows) flush();
  }

  // A handler's fingerprint is a hash of its own source text, which the
  // language defines as the exact slice of the file it came from. A build step
  // hashes every function in the bundle the same way, so a fingerprint maps to
  // file and line without anything added to the app.
  var fnToString = Function.prototype.toString;
  var prints = new WeakMap();
  function fingerprint(fn) {
    var known = prints.get(fn);
    if (known) return known;
    var source = '';
    try {
      source = fnToString.call(fn);
    } catch (error) {}
    var hash = 0x811c9dc5;
    for (var i = 0; i < source.length; i++) {
      hash ^= source.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    known = {
      name: (typeof fn.name === 'string' && fn.name) || null,
      hash: (hash >>> 0).toString(16),
      length: source.length,
    };
    prints.set(fn, known);
    return known;
  }

  function reactKey(el, prefix) {
    var keys = Object.keys(el);
    for (var i = 0; i < keys.length; i++) if (keys[i].indexOf(prefix) === 0) return keys[i];
    return null;
  }

  // React handler props that can answer each recorded event, nearest first.
  var PROPS = {
    click: ['onClick', 'onPointerDown', 'onMouseDown', 'onPointerUp', 'onMouseUp'],
    drag: ['onPointerDown', 'onMouseDown', 'onPointerUp', 'onMouseUp', 'onDragStart'],
    submit: ['onSubmit'],
    input: ['onChange', 'onInput'],
    change: ['onChange', 'onInput'],
    keydown: ['onKeyDown'],
  };

  function components(el) {
    var key = reactKey(el, '__reactFiber$');
    var names = [];
    var owners = [];
    for (var f = key && el[key]; f && owners.length < 12; f = f.return) {
      if (typeof f.type !== 'function') continue;
      var print = fingerprint(f.type);
      names.push(f.type.displayName || print.name || null);
      owners.push(print.hash + ':' + print.length);
    }
    return { names: names, owners: owners };
  }

  function handlerFor(target, type) {
    var props = PROPS[type] || [];
    for (
      var el = target, depth = 0;
      el && el.nodeType === 1 && depth < 20;
      el = el.parentElement, depth++
    ) {
      var key = reactKey(el, '__reactProps$');
      if (!key) continue;
      var bag = el[key];
      for (var i = 0; i < props.length; i++) {
        var fn = bag && bag[props[i]];
        if (typeof fn !== 'function') continue;
        var print = fingerprint(fn);
        var tree = components(el);
        return {
          prop: props[i],
          depth: depth,
          name: print.name,
          fingerprint: print.hash + ':' + print.length,
          components: tree.names,
          owners: tree.owners,
        };
      }
    }
    return null;
  }

  function text(value, max) {
    return String(value || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, max || 80);
  }

  function labelOf(el) {
    if (!el || el.nodeType !== 1) return null;
    var name = el.getAttribute('aria-label');
    var by = el.getAttribute('aria-labelledby');
    if (!name && by) {
      var ref = document.getElementById(by.split(' ')[0]);
      name = ref && ref.textContent;
    }
    if (!name && el.labels && el.labels[0]) name = el.labels[0].textContent;
    if (!name)
      name = el.getAttribute('title') || el.getAttribute('alt') || el.getAttribute('placeholder');
    if (!name && el.tagName !== 'FORM' && el.tagName !== 'BODY' && el.tagName !== 'HTML')
      name = el.textContent;
    return {
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role'),
      type: el.getAttribute('type'),
      name: text(name) || null,
    };
  }

  var ACTIONABLE =
    'a,button,input,textarea,select,summary,label,[role],[contenteditable],[tabindex]';
  function actionTarget(t) {
    if (!t || t.nodeType !== 1) return t && t.parentElement;
    return (t.closest && t.closest(ACTIONABLE)) || t;
  }

  function where() {
    return w.location.pathname + w.location.search;
  }

  // Dispatch window: opened by a capture listener on window, closed by a
  // bubble listener on window. When the app stops propagation the window never
  // closes and nothing is joined through it.
  var open = null;
  var lastInput = null;

  function record(event, type, extra) {
    var el = type === 'submit' && event.submitter ? event.submitter : actionTarget(event.target);
    var row = {
      kind: 'action',
      type: type,
      at: event.timeStamp,
      start: now(),
      end: null,
      path: where(),
      target: labelOf(el),
      handler: handlerFor(event.target, type),
    };
    if (type === 'submit') row.form = labelOf(event.target);
    if (extra) for (var k in extra) row[k] = extra[k];
    return row;
  }

  var onCapture = timed(function (event) {
    if (!event.isTrusted) return;
    var type = event.type;
    if (type === 'keydown') {
      var plain =
        event.key && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;
      if (plain) return;
    }
    if (type === 'input') {
      var field = event.target;
      var sensitive = field && field.type === 'password';
      var value =
        field && 'value' in field ? String(field.value) : text(field && field.textContent, 200);
      // One row per field while typing continues: later input updates it in place.
      if (lastInput && lastInput.el === field && buffer.indexOf(lastInput.row) !== -1) {
        lastInput.row.length = value.length;
        if (config.values && !sensitive) lastInput.row.value = value.slice(0, 200);
        open = null;
        return;
      }
      var row = record(event, 'input', { length: value.length, sensitive: sensitive || undefined });
      if (config.values && !sensitive) row.value = value.slice(0, 200);
      lastInput = { el: field, row: row };
      open = row;
      push(row);
      return;
    }
    if (type === 'change') {
      var t = event.target;
      var kind = t && (t.type || t.tagName);
      if (
        !/^(select-one|select-multiple|checkbox|radio|file|range|color|date|datetime-local|month|time|week)$/i.test(
          String(kind),
        )
      )
        return;
    }
    var extra = null;
    if (type === 'change')
      extra = {
        checked:
          typeof event.target.checked === 'boolean' && /checkbox|radio/.test(event.target.type)
            ? event.target.checked
            : undefined,
        value:
          config.values && /^select/.test(event.target.type) ? text(event.target.value) : undefined,
      };
    if (type === 'keydown') {
      var mods =
        (event.ctrlKey ? 'Control+' : '') +
        (event.metaKey ? 'Meta+' : '') +
        (event.altKey ? 'Alt+' : '') +
        (event.shiftKey && event.key.length > 1 ? 'Shift+' : '');
      extra = { key: mods + event.key };
    }
    open = record(event, type, extra);
    push(open);
  });
  var onBubble = timed(function (event) {
    if (open && event.isTrusted && open.type === event.type) open.end = now();
    open = null;
  });
  var TYPES = ['click', 'submit', 'input', 'change', 'keydown'];
  for (var i = 0; i < TYPES.length; i++) {
    w.addEventListener(TYPES[i], onCapture, { capture: true, passive: true });
    w.addEventListener(TYPES[i], onBubble, { passive: true });
  }
  var down = null;
  w.addEventListener(
    'pointerdown',
    timed(function (event) {
      if (event.isTrusted)
        down = { x: event.clientX, y: event.clientY, target: event.target, at: event.timeStamp };
    }),
    { capture: true, passive: true },
  );
  w.addEventListener(
    'pointerup',
    timed(function (event) {
      if (!down || !event.isTrusted) return;
      var dx = event.clientX - down.x;
      var dy = event.clientY - down.y;
      if (dx * dx + dy * dy >= 64) {
        var row = record({ target: down.target, timeStamp: down.at }, 'drag', {
          from: [Math.round(down.x), Math.round(down.y)],
          to: [Math.round(event.clientX), Math.round(event.clientY)],
        });
        row.end = row.start;
        push(row);
      }
      down = null;
    }),
    { capture: true, passive: true },
  );

  var endpoint = config.endpoint;
  function own(url) {
    return endpoint && url.indexOf(endpoint) === 0;
  }
  function serverId(entry) {
    var list = entry.serverTiming || [];
    for (var i = 0; i < list.length; i++)
      if (list[i].name === (config.serverTimingName || 'rid')) return list[i].description || null;
    return null;
  }
  var REQUEST_TYPES = { fetch: 1, xmlhttprequest: 1, beacon: 1, other: 1 };
  function observe(type, fn, options) {
    try {
      if (!w.PerformanceObserver || PerformanceObserver.supportedEntryTypes.indexOf(type) === -1)
        return;
      var o = new PerformanceObserver(timed(fn));
      var opts = { type: type, buffered: true };
      if (options) for (var k in options) opts[k] = options[k];
      o.observe(opts);
    } catch (error) {
      errors += 1;
    }
  }
  observe('resource', function (list) {
    var entries = list.getEntries();
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (!REQUEST_TYPES[e.initiatorType] || own(e.name)) continue;
      // The browser fetches the tab icon by itself; it is not the app's request.
      if (e.initiatorType === 'other' && /\/favicon\.(ico|png|svg)(\?|$)/.test(e.name)) continue;
      var url =
        e.name.indexOf(w.location.origin) === 0 ? e.name.slice(w.location.origin.length) : e.name;
      push({
        kind: 'request',
        url: url,
        initiator: e.initiatorType,
        start: e.startTime,
        end: e.responseEnd,
        status: typeof e.responseStatus === 'number' ? e.responseStatus : null,
        size: e.transferSize || null,
        server_id: serverId(e),
      });
    }
  });
  // A page has one navigation entry, but Chrome hands it to a buffered
  // observer and again once the load finishes; record it once.
  var loadSeen = false;
  observe('navigation', function (list) {
    var entries = list.getEntries();
    for (var i = 0; i < entries.length && !loadSeen; i++) {
      loadSeen = true;
      push({
        kind: 'load',
        path: where(),
        type: entries[i].type,
        server_id: serverId(entries[i]),
        dom_ms: Math.round(entries[i].domContentLoadedEventEnd),
      });
    }
  });
  // Chrome's long-animation-frame entries name the script behind a slow frame.
  // Off unless asked for: few frames qualify, and the browser does extra
  // bookkeeping while anyone observes them.
  if (config.slowScripts)
    observe('long-animation-frame', function (list) {
      var frames = list.getEntries();
      for (var i = 0; i < frames.length; i++)
        for (var j = 0; j < frames[i].scripts.length; j++) {
          var s = frames[i].scripts[j];
          push({
            kind: 'slow_script',
            invoker: s.invoker,
            invoker_type: s.invokerType,
            function: s.sourceFunctionName || null,
            source: s.sourceURL || null,
            position: s.sourceCharPosition,
            duration: Math.round(s.duration),
            start: s.startTime,
          });
        }
    });

  var lastPath = where();
  var onNavigate = timed(function () {
    var path = where();
    if (path === lastPath) return;
    push({ kind: 'navigate', from: lastPath, to: path, at: now() });
    lastPath = path;
  });
  if (w.navigation && w.navigation.addEventListener)
    w.navigation.addEventListener('navigatesuccess', onNavigate, { passive: true });
  w.addEventListener('popstate', onNavigate, { passive: true });
  w.addEventListener('hashchange', onNavigate, { passive: true });

  function flush() {
    if (!buffer.length || !endpoint) return;
    var t = now();
    var rows = buffer.splice(0, buffer.length);
    sent += rows.length;
    var body = JSON.stringify({
      schema: 'producttrace.listen.v1',
      page: page,
      origin: w.location.origin,
      rows: rows,
      cost_ms: Math.round(cost * 100) / 100,
      calls: calls,
      errors: errors,
    });
    try {
      navigator.sendBeacon(endpoint, body);
    } catch (error) {
      errors += 1;
    }
    cost += now() - t;
  }
  var flushTimed = timed(flush);
  if (config.flushMs !== 0) w.setInterval(flushTimed, config.flushMs || 5000);
  document.addEventListener(
    'visibilitychange',
    timed(function () {
      if (document.visibilityState === 'hidden') flush();
    }),
    { passive: true },
  );
  w.addEventListener('pagehide', flushTimed, { passive: true });
  // Setting up counts too: everything this script does is in cost.
  cost += now() - setupStart;
})(__CIRCUIT_LISTEN_CONFIG__);
