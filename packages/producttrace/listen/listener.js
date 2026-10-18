// Listen mode, the browser half. Pasted as one <script> in the app's page (or
// added by a test harness as an init script). The contract, checked by verify
// and by test/listen.test.mjs:
//   - it defines no globals and replaces no browser API;
//   - it writes nothing into the page: no attributes, no headers, no storage;
//   - it only adds passive listeners on window/document, runs
//     PerformanceObservers and one MutationObserver (password fields' `type`),
//     reads React's own props/fiber keys on DOM nodes and sends its rows with
//     navigator.sendBeacon;
//   - its cost is measured exactly: circuit code only ever runs inside its own
//     callbacks, so it times every one and reports the total (cost_ms).
// Any error inside circuit is caught and counted; the app never sees it.
//
// What the app can still notice, the complete list:
//   - CPU time, the total reported as cost_ms (parsing this script is not in it);
//   - its beacons: the app's own service worker and resource-timing observers
//     see them, and a Content-Security-Policy whose connect-src does not allow
//     the endpoint turns each into a violation (event, console error, report),
//     so serve the endpoint from the app's own origin;
//   - one setInterval for sending, and one setTimeout(0) after each pointerup;
//   - the observers and passive listeners above, which no page API lists.
// It draws no random numbers from Math.random, so it cannot shift an app's
// own random sequence.
(function (config) {
  'use strict';
  var w = window;
  // Only app pages: a blank tab or a browser page has nothing to record.
  if (!/^https?:$/.test(w.location.protocol)) return;
  var perf = w.performance;
  var now = function () {
    return perf.now();
  };
  var setupStart = now();
  // A page id from the browser's crypto source, not Math.random: the app's
  // own random sequence stays exactly as it would be without this script.
  var page = (function () {
    try {
      var bytes = new Uint32Array(2);
      w.crypto.getRandomValues(bytes);
      return bytes[0].toString(36) + bytes[1].toString(36);
    } catch (error) {
      return String(Date.now()) + String(perf.now()).replace('.', '');
    }
  })();
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
    if (buffer.length >= maxRows) flush(true);
  }

  // A handler's fingerprint is a hash of its own source text, which the
  // language defines as the exact slice of the file it came from. A build step
  // hashes every function in the bundle the same way, so a fingerprint maps to
  // file and line without anything added to the app.
  var fnToString = Function.prototype.toString;
  // A function's own name as a plain data property: never a getter or a
  // Proxy trap, which would run app code.
  var describe = Object.getOwnPropertyDescriptor;
  function ownString(fn, key) {
    try {
      var d = describe(fn, key);
      return d && 'value' in d && typeof d.value === 'string' && d.value ? d.value : null;
    } catch (error) {
      return null;
    }
  }
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
      name: ownString(fn, 'name'),
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
      names.push(ownString(f.type, 'displayName') || print.name || null);
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

  // The first words shown inside an element, read from its first few text
  // nodes only: a click on a big container never reads (or sends) all of it.
  function shownText(el) {
    var out = '';
    var visited = 0;
    var stack = [el];
    while (stack.length && out.length < 80 && visited < 60) {
      var node = stack.pop();
      visited += 1;
      if (node.nodeType === 3) out += ' ' + node.nodeValue;
      else if (node.nodeType === 1 && node.childNodes)
        for (var i = node.childNodes.length - 1; i >= 0; i--) stack.push(node.childNodes[i]);
      else if (node.nodeType === 1 && typeof node.textContent === 'string')
        out += ' ' + node.textContent.slice(0, 80);
    }
    return out;
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
    // An editable field's text is what the person typed, never its name.
    if (
      !name &&
      !editable(el) &&
      el.tagName !== 'FORM' &&
      el.tagName !== 'BODY' &&
      el.tagName !== 'HTML'
    )
      name = shownText(el);
    // An icon button: the name is on the icon inside it.
    if (!text(name) && el.querySelector) {
      var inner = el.querySelector('[aria-label],[title],img[alt]');
      if (inner)
        name =
          inner.getAttribute('aria-label') ||
          inner.getAttribute('title') ||
          inner.getAttribute('alt');
    }
    return {
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role'),
      type: el.getAttribute('type'),
      name: text(name) || null,
    };
  }

  function editable(el) {
    if (!el || el.nodeType !== 1) return false;
    var tag = el.tagName;
    if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (tag === 'INPUT')
      return !/^(button|submit|reset|checkbox|radio|image|file|range|color)$/i.test(el.type || '');
    if (el.isContentEditable) return true;
    var ce = el.getAttribute('contenteditable');
    return (
      (ce !== null && ce !== 'false') ||
      /^(textbox|searchbox|combobox)$/.test(el.getAttribute('role') || '')
    );
  }

  // A field is sensitive if it is, or ever was, a password field (a "show
  // password" toggle turns it into plain text), or says it holds a secret.
  var wasPassword = new WeakSet();
  var SECRET =
    /pass(word|wd|code|phrase)?|secret|\bpin\b|otp|one-time-code|cvc|cvv|cc-number|cc-csc/i;
  function sensitive(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.type === 'password') wasPassword.add(el);
    if (wasPassword.has(el)) return true;
    if (el.labels && el.labels[0] && SECRET.test(el.labels[0].textContent || '')) return true;
    var hints = [
      el.getAttribute('autocomplete'),
      el.getAttribute('name'),
      el.getAttribute('id'),
      el.getAttribute('aria-label'),
      el.getAttribute('placeholder'),
    ];
    for (var i = 0; i < hints.length; i++) if (hints[i] && SECRET.test(hints[i])) return true;
    return false;
  }
  // Typed values are recorded only from fields known to hold ordinary text,
  // never by default: a field that swapped in for a password field, or any
  // unlabeled text box, could hold a secret, so it gives its length only.
  function valueAllowed(el) {
    if (!config.values || !el || el.nodeType !== 1 || sensitive(el)) return false;
    var tag = el.tagName;
    if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (tag === 'INPUT') {
      var type = String(el.type || 'text').toLowerCase();
      if (/^(email|search|url|tel|number|date|time|month|week|datetime-local)$/.test(type))
        return true;
      if (type !== 'text') return false;
      return Boolean(
        text(el.getAttribute('aria-label')) ||
        (el.labels && el.labels[0] && text(el.labels[0].textContent)) ||
        text(el.getAttribute('placeholder')),
      );
    }
    return editable(el);
  }
  // A "show password" toggle changes type="password" to text; watch that one
  // attribute (read-only) so the field stays secret even before any typing.
  try {
    if (w.MutationObserver)
      new w.MutationObserver(
        timed(function (list) {
          for (var i = 0; i < list.length; i++)
            if (String(list[i].oldValue).toLowerCase() === 'password')
              wasPassword.add(list[i].target);
        }),
      ).observe(document, {
        subtree: true,
        attributes: true,
        attributeFilter: ['type'],
        attributeOldValue: true,
      });
  } catch (error) {
    errors += 1;
  }

  // Roles a person acts on; an icon's role="img" or a layout role is not one.
  var ACTIONABLE =
    'a,button,input,textarea,select,summary,label,[contenteditable],[tabindex]:not([tabindex="-1"]),' +
    [
      'button',
      'link',
      'menuitem',
      'menuitemcheckbox',
      'menuitemradio',
      'option',
      'tab',
      'checkbox',
      'radio',
      'switch',
      'combobox',
      'textbox',
      'searchbox',
      'slider',
      'treeitem',
      'gridcell',
      'row',
    ]
      .map(function (r) {
        return '[role="' + r + '"]';
      })
      .join(',');
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

  function record(event, type, extra, snapshot) {
    var el = type === 'submit' && event.submitter ? event.submitter : actionTarget(event.target);
    var row = {
      kind: 'action',
      type: type,
      at: event.timeStamp,
      start: now(),
      end: null,
      path: where(),
      target: snapshot ? snapshot.target : labelOf(el),
      handler: snapshot ? snapshot.handlers[type] : handlerFor(event.target, type),
    };
    if (type === 'submit') row.form = labelOf(event.target);
    if (extra) for (var k in extra) row[k] = extra[k];
    return row;
  }

  // What a typing row says about a field: a secret field only that it is one
  // (no value, no length); otherwise its length, and its value when allowed.
  function describeTyping(row, field) {
    delete row.value;
    delete row.length;
    if (sensitive(field)) {
      row.sensitive = true;
      return;
    }
    var value =
      field && 'value' in field ? String(field.value) : String((field && field.textContent) || '');
    row.length = value.length;
    if (valueAllowed(field)) row.value = text(value, 200);
  }

  var MODIFIERS = { Control: 1, Shift: 1, Alt: 1, Meta: 1, CapsLock: 1, Fn: 1, AltGraph: 1 };
  var CHOICE = /^(checkbox|radio)$/i;
  var onCapture = timed(function (event) {
    if (!event.isTrusted) return;
    var type = event.type;
    if (type === 'keydown') {
      if (MODIFIERS[event.key]) return;
      // Plain characters typed into a field are typing (the input row covers
      // them); outside a field the same key is a shortcut and is recorded.
      var plain =
        event.key && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;
      if (plain && editable(actionTarget(event.target))) return;
      if (plain && sensitive(event.target)) return;
    }
    if (type === 'input') {
      var field = event.target;
      // A checkbox or radio fires input too; its change row says what happened.
      if (field && CHOICE.test(field.type || '')) return;
      // One row per field while typing continues: later input updates it in place.
      var same = lastInput && lastInput.el === field && buffer.indexOf(lastInput.row) !== -1;
      var row = same ? lastInput.row : record(event, 'input');
      describeTyping(row, field);
      if (same) {
        lastInput.at = now();
        open = row;
        return;
      }
      lastInput = { el: field, row: row, at: now() };
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
    var snapshot = null;
    if (type === 'click') {
      var hit = actionTarget(event.target);
      // The change row names a checkbox or radio; its click (or its label's) would repeat it.
      if (hit && hit.tagName === 'INPUT' && CHOICE.test(hit.type || '')) return;
      if (hit && hit.tagName === 'LABEL' && hit.control && CHOICE.test(hit.control.type || ''))
        return;
      snapshot = gestureFor(event.target);
      if (snapshot && down) {
        // The press was already recorded as a drag, or as a press on something
        // the app removed before this click arrived.
        if (down.recorded) return;
        down.recorded = true;
      }
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
      // Outside a field a character could still be typed text (a PIN pad, a
      // canvas editor): it is named only when typed values are asked for.
      var key = event.key === ' ' ? 'Space' : event.key;
      if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && !config.values)
        key = 'character';
      extra = { key: mods + key };
    }
    open = record(event, type, extra, snapshot);
    push(open);
  });
  var onBubble = timed(function (event) {
    if (open && event.isTrusted && open.type === event.type) {
      open.end = now();
      // A controlled field may refuse the keystroke: by the time the event has
      // bubbled, React has put back the value it keeps. Record that one.
      if (event.type === 'input' && lastInput && lastInput.row === open)
        describeTyping(open, lastInput.el);
    }
    open = null;
  });
  var TYPES = ['click', 'submit', 'input', 'change', 'keydown'];
  for (var i = 0; i < TYPES.length; i++) {
    w.addEventListener(TYPES[i], onCapture, { capture: true, passive: true });
    w.addEventListener(TYPES[i], onBubble, { passive: true });
  }
  // What was under the pointer when it went down, read before the app reacts:
  // a dragged card or a picked menu option is often gone from the page (and
  // its React props with it) by the time the pointer comes up or click fires.
  var down = null;
  function snapshotOf(target) {
    var el = actionTarget(target);
    return {
      target: labelOf(el),
      handlers: { click: handlerFor(target, 'click'), drag: handlerFor(target, 'drag') },
    };
  }
  function gestureFor(target) {
    // A click belongs to the press only until that press is over (see pointerup).
    if (!down || down.closed) return null;
    var snap = down.snapshot;
    var same =
      target === down.target || (target && target.contains && target.contains(down.target));
    var gone = down.target.isConnected === false;
    var tag = target && target.tagName;
    if (same || gone || tag === 'HTML' || tag === 'BODY') return snap;
    return null;
  }
  // A field seen as a password field while focused or pressed stays secret.
  var notePassword = timed(function (event) {
    if (event.target && event.target.type === 'password') wasPassword.add(event.target);
  });
  w.addEventListener('focusin', notePassword, { capture: true, passive: true });
  w.addEventListener(
    'pointerdown',
    timed(function (event) {
      if (event.target && event.target.type === 'password') wasPassword.add(event.target);
      if (event.isTrusted)
        down = {
          x: event.clientX,
          y: event.clientY,
          target: event.target,
          at: event.timeStamp,
          snapshot: snapshotOf(event.target),
        };
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
        var row = record(
          { target: down.target, timeStamp: down.at },
          'drag',
          {
            from: [Math.round(down.x), Math.round(down.y)],
            to: [Math.round(event.clientX), Math.round(event.clientY)],
          },
          down.snapshot,
        );
        row.end = row.start;
        push(row);
        down.recorded = true;
      }
      // Picking an option often removes it on pointerup (a Radix or MUI menu
      // closing), and then the browser fires no click at all. When the pressed
      // element is gone once this press is over and no click came, the press
      // is recorded as the click it was.
      var gesture = down;
      w.setTimeout(
        timed(function () {
          gesture.closed = true;
          if (gesture.recorded || gesture.target.isConnected !== false) return;
          gesture.recorded = true;
          var press = record(
            { target: gesture.target, timeStamp: gesture.at },
            'click',
            { pressed: true },
            gesture.snapshot,
          );
          press.end = press.start;
          push(press);
        }),
        0,
      );
    }),
    { capture: true, passive: true },
  );

  // Resolved once: resource entries carry absolute URLs, and a relative
  // endpoint would otherwise look like an app request and be sent again.
  var endpoint = null;
  try {
    endpoint = new URL(config.endpoint, w.location.href).href;
  } catch (error) {
    errors += 1;
  }
  function own(url) {
    return endpoint && url.indexOf(endpoint) === 0;
  }
  // Only the app's own server: another origin's id must never be joined to
  // the app's server logs (cross-origin entries need Timing-Allow-Origin
  // anyway, which the app's server should not send for this header).
  function serverId(entry) {
    if (entry.name && entry.name.indexOf(w.location.origin + '/') !== 0) return null;
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

  // A timed send holds back the field still being typed into, so one field
  // stays one row; leaving the page sends everything.
  function flush(final) {
    if (!buffer.length || !endpoint) return;
    var t = now();
    var keep = final !== true && lastInput && now() - lastInput.at < 1500 ? lastInput.row : null;
    var rows = buffer.splice(0, buffer.length);
    if (keep && rows.indexOf(keep) !== -1) {
      rows.splice(rows.indexOf(keep), 1);
      buffer.push(keep);
    }
    if (!rows.length) {
      cost += now() - t;
      return;
    }
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
  var flushTimed = timed(function () {
    flush(false);
  });
  if (config.flushMs !== 0) w.setInterval(flushTimed, config.flushMs || 5000);
  document.addEventListener(
    'visibilitychange',
    timed(function () {
      if (document.visibilityState === 'hidden') flush(true);
    }),
    { passive: true },
  );
  w.addEventListener(
    'pagehide',
    timed(function () {
      flush(true);
    }),
    { passive: true },
  );
  // Setting up counts too: everything this script does is in cost.
  cost += now() - setupStart;
})(__CIRCUIT_LISTEN_CONFIG__);
