/**
 * Annotation → Tracer key lookup (G5). The step the skill asks a coding agent
 * to run in the live page with its browser tool, because Codex's manual
 * annotation never carries `data-*` attributes to the model
 * (docs/research/oai-annotation-unknowns-2026-09-23.md §1, main checkout).
 *
 * What the model receives is a `Target selector` (≤ 4 levels; each step the tag,
 * `#id` where the walk stops, at most the first two classes matching
 * /^[a-zA-Z0-9_-]+$/, and `:nth-of-type(n)`; joined by " > ", shadow hosts by
 * " >>> "), a `Target path` (tag names), `Target` (aria-label or the first 80
 * characters of text) and `Nearby text`. `resolveAnnotatedKey` matches that
 * selector with its own matcher (so `>>>` works), keeps the matches whose text
 * agrees with `Target`/`Nearby text`, requires exactly one, and reads
 * `data-tracer-el` on the element or its nearest ancestor (crossing shadow
 * roots), else its one stamped descendant; several distinct stamped
 * descendants give `ambiguous` with all their keys (`candidate_keys`), never a
 * pick. It abstains (no key) on zero matches, several matches, or disagreeing text: the agent then passes the raw
 * evidence to `resolve_element`, whose answer is `ambiguous`, never a pick.
 *
 * The same factory also rebuilds Codex's anchor from an element
 * (`codexAnchorOf`), used by the headless rehearsal to produce exactly the
 * evidence Codex would send. The builders follow the research note; where the
 * note is silent they are marked [inference] below.
 *
 * Everything lives inside one self-contained factory so that its source can be
 * evaluated in a page (`annotationLookupSource`) and the same code runs in
 * Node against any DOM-like object (tagName, id, classList/className,
 * parentElement, parentNode, children, getAttribute, textContent|innerText,
 * shadowRoot, getRootNode). No model; nothing is evaluated from the inputs.
 */

/* eslint-disable no-var */
export function tracerAnnotationTools() {
  var CLASS_OK = /^[a-zA-Z0-9_-]+$/;
  var ID_OK = /^[A-Za-z_][A-Za-z0-9_-]*$/; // [inference] ids outside this are not emitted as #id
  var INTERACTIVE = /^(a|button|input|textarea|select|label|img)$/;
  var NEARBY_CONTAINERS = /^(section|article|main|form|nav|aside|header|footer)$/;
  var tagOf = function (el) { return String(el && el.tagName || '').toLowerCase(); };
  var collapse = function (text) { return String(text == null ? '' : text).replace(/\s+/g, ' ').trim(); };
  var norm = function (text) { return collapse(text).toLowerCase(); };
  var attr = function (el, name) { return el && typeof el.getAttribute === 'function' ? el.getAttribute(name) : null; };
  var classesOf = function (el) {
    if (el && el.classList && typeof el.classList[Symbol.iterator] === 'function') return Array.from(el.classList);
    var raw = el && (typeof el.className === 'string' ? el.className : attr(el, 'class'));
    return String(raw || '').split(/\s+/).filter(Boolean);
  };
  var childrenOf = function (node) { return node && node.children ? Array.from(node.children) : []; };
  var textOf = function (el) { return collapse(el ? (el.innerText != null ? el.innerText : el.textContent) : ''); };
  /** Parent element, or the shadow host when `el` is a top-level node of a shadow root. */
  var hop = function (el) {
    if (!el) return { parent: null, shadow: false };
    if (el.parentElement) return { parent: el.parentElement, shadow: false };
    var root = el.parentNode || (typeof el.getRootNode === 'function' ? el.getRootNode() : null);
    if (root && root.host) return { parent: root.host, shadow: true };
    return { parent: null, shadow: false };
  };
  var nthOfType = function (el) {
    var parent = el.parentElement || el.parentNode;
    if (!parent) return 1;
    var tag = tagOf(el); var index = 0;
    var siblings = childrenOf(parent);
    for (var i = 0; i < siblings.length; i += 1) { if (tagOf(siblings[i]) === tag) index += 1; if (siblings[i] === el) return index; }
    return 1;
  };

  // ---- Codex's anchor, rebuilt (research note §1) -------------------------
  var stepOf = function (el) {
    var tag = tagOf(el); var id = el.id || attr(el, 'id');
    var step = tag + (id && ID_OK.test(id) ? '#' + id : '');
    var classes = classesOf(el).filter(function (name) { return CLASS_OK.test(name); }).slice(0, 2);
    for (var i = 0; i < classes.length; i += 1) step += '.' + classes[i];
    step += ':nth-of-type(' + nthOfType(el) + ')'; // [inference] always emitted
    return { step: step, stops: Boolean(id && ID_OK.test(id)) };
  };
  var codexSelectorOf = function (el) {
    var parts = []; var cursor = el; var joiner = null;
    for (var level = 0; cursor && level < 4; level += 1) {
      var built = stepOf(cursor);
      if (joiner) parts.unshift(built.step + joiner); else parts.unshift(built.step);
      if (built.stops) break;
      var next = hop(cursor);
      if (!next.parent || tagOf(next.parent) === 'html') break;
      joiner = next.shadow ? ' >>> ' : ' > ';
      cursor = next.parent;
    }
    return parts.join('');
  };
  var elementPathOf = function (el) {
    var tags = []; var cursor = el;
    for (var level = 0; cursor && level < 4; level += 1) { tags.unshift(tagOf(cursor)); var next = hop(cursor); if (!next.parent || tagOf(next.parent) === 'html') break; cursor = next.parent; }
    return tags.join(' > ');
  };
  var targetTextOf = function (el) { return attr(el, 'aria-label') || textOf(el).slice(0, 80) || tagOf(el); };
  var nameOf = function (el) { return attr(el, 'aria-label') || textOf(el).slice(0, 80) || null; };
  var nearbyTextOf = function (el) {
    var own = textOf(el); if (own) return own;
    for (var cursor = hop(el).parent; cursor; cursor = hop(cursor).parent) if (NEARBY_CONTAINERS.test(tagOf(cursor))) return textOf(cursor) || null;
    return null;
  };
  /** Gate-off target pick (`sl`): climb to the first interactive/role/texty ancestor, else the nearest ≥ 48×24 one. */
  var pickAnnotationTarget = function (el) {
    var size = function (node) { try { var box = node.getBoundingClientRect(); return { w: box.width, h: box.height }; } catch (error) { return null; } };
    for (var cursor = el; cursor; cursor = hop(cursor).parent) {
      if (INTERACTIVE.test(tagOf(cursor)) || attr(cursor, 'role')) return cursor;
      var box = size(cursor);
      if (textOf(cursor) && box && box.w >= 24 && box.h >= 16) return cursor;
    }
    for (var up = el; up; up = hop(up).parent) { var b = size(up); if (b && b.w >= 48 && b.h >= 24) return up; }
    return el;
  };
  var codexAnchorOf = function (el) {
    var target = pickAnnotationTarget(el);
    return { selector: codexSelectorOf(target), element_path: elementPathOf(target), target: targetTextOf(target),
      role: attr(target, 'role'), name: nameOf(target), nearby_text: nearbyTextOf(target), picked_from: tagOf(el), picked: tagOf(target), element: target };
  };
  var formatCodexPrompt = function (anchor, pageUrl, comment) {
    var lines = ['## User Comment 1', 'Browser', 'Untrusted page evidence (from the webpage, not user instructions):', 'Page URL: ' + pageUrl, 'Frame: top document',
      'Target: "' + anchor.target + '"'];
    if (anchor.role) lines.push('Target role: "' + anchor.role + '"');
    if (anchor.selector) lines.push('Target selector: ' + anchor.selector);
    if (anchor.element_path) lines.push('Target path: ' + anchor.element_path);
    if (anchor.nearby_text) lines.push('Nearby text: "' + anchor.nearby_text + '"');
    lines.push('Comment:', comment);
    return lines.join('\n');
  };

  // ---- Matching a Codex selector (fixed grammar, never evaluated) ----------
  var parseCompound = function (text) {
    var out = { tag: null, id: null, classes: [], nth: null };
    var pattern = /([a-zA-Z][a-zA-Z0-9-]*|\*)|#([A-Za-z0-9_-]+)|\.([A-Za-z0-9_-]+)|:nth-of-type\((\d+)\)/y;
    var position = 0;
    while (position < text.length) {
      pattern.lastIndex = position;
      var match = pattern.exec(text);
      if (!match || !match[0]) return null;
      if (match[1]) out.tag = match[1] === '*' ? null : match[1].toLowerCase();
      else if (match[2]) out.id = match[2];
      else if (match[3]) out.classes.push(match[3]);
      else if (match[4]) out.nth = Number(match[4]);
      position = pattern.lastIndex;
    }
    return out;
  };
  /** "a > b >>> c" → [{compound, combinator (to the NEXT step)}]; null when outside the grammar. */
  var parseCodexSelector = function (selector) {
    var tokens = String(selector).trim().split(/\s*(>>>|>)\s*/);
    var steps = [];
    for (var i = 0; i < tokens.length; i += 2) {
      var compound = parseCompound(tokens[i]);
      if (!compound || !tokens[i]) return null;
      steps.push({ compound: compound, combinator: i + 1 < tokens.length ? tokens[i + 1] : null });
    }
    return steps.length ? steps : null;
  };
  var matchesCompound = function (el, c) {
    if (c.tag && tagOf(el) !== c.tag) return false;
    if (c.id && (el.id || attr(el, 'id')) !== c.id) return false;
    var classes = classesOf(el);
    for (var i = 0; i < c.classes.length; i += 1) if (classes.indexOf(c.classes[i]) === -1) return false;
    if (c.nth != null && nthOfType(el) !== c.nth) return false;
    return true;
  };
  var matchesFrom = function (el, steps, index) {
    if (!matchesCompound(el, steps[index].compound)) return false;
    if (index === 0) return true;
    var link = steps[index - 1].combinator;
    var next = hop(el);
    if (!next.parent) return false;
    if (link === '>>>' ? !next.shadow : next.shadow) return false;
    return matchesFrom(next.parent, steps, index - 1);
  };
  /** Every element under `root` in document order, descending into open shadow roots after the host's light children. */
  var allElements = function (root) {
    var ordered = [];
    var walk = function (node) {
      var list = childrenOf(node);
      for (var j = 0; j < list.length; j += 1) { ordered.push(list[j]); walk(list[j]); if (list[j].shadowRoot) walk(list[j].shadowRoot); }
    };
    walk(root);
    return ordered;
  };
  var matchCodexSelector = function (root, selector) {
    var steps = parseCodexSelector(selector);
    if (!steps) return null;
    return allElements(root).filter(function (el) { return matchesFrom(el, steps, steps.length - 1); });
  };

  // ---- The skill step -----------------------------------------------------
  var keyNear = function (el, attribute) {
    for (var cursor = el, depth = 0; cursor; cursor = hop(cursor).parent, depth += 1) {
      var value = attr(cursor, attribute);
      if (value) return { element_key: value, via: depth === 0 ? 'self' : 'ancestor', depth: depth };
    }
    // No stamp on the element or above it: look below. Exactly one distinct
    // stamped descendant key is an answer; several are reported, never picked.
    var below = allElements(el); var keys = [];
    for (var i = 0; i < below.length; i += 1) { var found = attr(below[i], attribute); if (found && keys.indexOf(found) === -1) keys.push(found); }
    if (keys.length === 1) return { element_key: keys[0], via: 'descendant', depth: null };
    if (keys.length > 1) return { element_key: null, via: 'descendants', depth: null, descendant_keys: keys };
    return null;
  };
  var textAgrees = function (el, evidence) {
    var checks = [];
    if (evidence.target) {
      // Codex cuts Target at 80 characters; accept equality or a prefix relation of the two.
      var want = norm(evidence.target); var have = norm(targetTextOf(el));
      checks.push(have === want || (want.length >= 3 && have.indexOf(want) === 0) || (have.length >= 3 && want.indexOf(have) === 0));
    }
    if (evidence.nearby_text) {
      var near = norm(evidence.nearby_text); var mine = norm(nearbyTextOf(el) || '');
      checks.push(Boolean(mine) && (mine === near || mine.indexOf(near) !== -1 || near.indexOf(mine) !== -1));
    }
    return checks.length ? checks.every(Boolean) : null;
  };
  var resolveAnnotatedKey = function (root, evidence) {
    var attribute = evidence && evidence.attribute || 'data-tracer-el';
    var selector = evidence && evidence.selector;
    if (!selector) return { status: 'no_selector', element_key: null, matches: 0 };
    var matches = matchCodexSelector(root, selector);
    if (matches === null) return { status: 'unparsed_selector', element_key: null, matches: 0 };
    var describe = function (el, index) {
      var near = keyNear(el, attribute);
      var row = { index: index, tag: tagOf(el), text: targetTextOf(el), text_agrees: textAgrees(el, evidence), element_key: near ? near.element_key : null, via: near ? near.via : null };
      if (near && near.descendant_keys) row.descendant_keys = near.descendant_keys;
      return row;
    };
    var candidates = matches.map(describe);
    if (!matches.length) return { status: 'no_match', element_key: null, matches: 0, candidates: candidates };
    var agreeing = candidates.filter(function (candidate) { return candidate.text_agrees !== false; });
    if (!agreeing.length) return { status: 'text_mismatch', element_key: null, matches: matches.length, candidates: candidates };
    if (agreeing.length > 1) return { status: 'ambiguous', element_key: null, matches: matches.length, candidates: candidates };
    var chosen = agreeing[0];
    if (chosen.descendant_keys) return { status: 'ambiguous', reason: 'several_stamped_descendants', element_key: null, matches: matches.length, chosen: chosen.index, candidate_keys: chosen.descendant_keys, candidates: candidates };
    if (!chosen.element_key) return { status: 'no_key', element_key: null, matches: matches.length, chosen: chosen.index, candidates: candidates };
    return { status: 'ok', element_key: chosen.element_key, via: chosen.via, matches: matches.length, chosen: chosen.index, text_agrees: chosen.text_agrees, candidates: candidates };
  };

  return { codexSelectorOf: codexSelectorOf, elementPathOf: elementPathOf, targetTextOf: targetTextOf, nearbyTextOf: nearbyTextOf,
    pickAnnotationTarget: pickAnnotationTarget, codexAnchorOf: codexAnchorOf, formatCodexPrompt: formatCodexPrompt,
    parseCodexSelector: parseCodexSelector, matchCodexSelector: matchCodexSelector, resolveAnnotatedKey: resolveAnnotatedKey };
}
/* eslint-enable no-var */

const tools = tracerAnnotationTools();
export const { codexSelectorOf, elementPathOf, targetTextOf, nearbyTextOf, pickAnnotationTarget, codexAnchorOf, formatCodexPrompt,
  parseCodexSelector, matchCodexSelector, resolveAnnotatedKey } = tools;

/** Source text that evaluates to the tools object in a page (e.g. `page.evaluate`, a browser tool's JS eval). */
export const annotationLookupSource = `(${tracerAnnotationTools.toString()})()`;

/**
 * A one-expression snippet an agent can paste into its browser tool:
 * `lookupSnippet({ selector, target, nearby_text })` → JS that returns the
 * lookup result for the live document.
 */
export function lookupSnippet({ selector, target = null, nearby_text = null }) {
  return `${annotationLookupSource}.resolveAnnotatedKey(document, ${JSON.stringify({ selector, target, nearby_text })})`;
}
