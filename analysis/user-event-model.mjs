/**
 * Trusted user events: which event kinds the browser runtime listens for,
 * which dispatches it records as `dom.action` rows, and how it classifies
 * each one (discrete or continuous, gesture phase, gesture identity).
 *
 * One implementation for both sides. `scripts/build.mjs` inlines
 * `createUserEventModel` verbatim into `src/runtime-attribution-browser.js`
 * (between the GENERATED USER EVENT MODEL markers), so the function must stay
 * self-contained: no imports, no references outside its own body. Node code
 * (analysis, coverage, graders) reads the same data from `USER_EVENT_KINDS`.
 *
 * Rules (G1 D-G1-21 as amended by D-G1-21a, docs/gates/G1-frontend-only.md):
 *
 * 1. What is listened for is DISCOVERED at install: every `on*` event-handler
 *    property (an accessor with a setter) on Element.prototype,
 *    HTMLElement.prototype, Document.prototype, Window.prototype and the
 *    window object, plus the kinds the platform dispatches with no `on*`
 *    property (`handlerless_kinds`: focusin/focusout, composition, textInput,
 *    DOMActivate, DOMFocusIn/Out). One capture-phase listener per kind at the
 *    window and inside every shadow root.
 * 2. What is RECORDED as a user event: every trusted event of a listened kind
 *    dispatched in the document (a node, the document or the window) unless
 *    classified not user-caused by interface (`not_user_interfaces`:
 *    progress, animation, transition, message, page lifecycle, device ...)
 *    or by kind (`not_user_kinds`: load, error, readystatechange, media
 *    loading ...). Unknown kinds and interfaces ARE user events. The list
 *    only classifies: a not-user event still leaves a `dom.event` row
 *    (user: false, first per kind and target, all counted). Untrusted events
 *    are never user events; they leave `dom.untrusted` rows.
 * 3. Continuous vs discrete by interface properties first: PointerEvent
 *    `button === -1` or a boundary notification (`boundary_kinds`, which
 *    never press or release); a `buttons` bit set or cleared is a
 *    press/release; MouseEvent `detail > 0` an activation; WheelEvent
 *    continuous; TouchEvent `touches.length` up/down a press/release;
 *    keydown `repeat` continuous. A name list (`continuous_kinds`) only where
 *    no property decides. Unknown kinds are discrete (one row per event).
 * 4. Gesture identity (held state, never a clock). Pointer (mouse, pen,
 *    touch, their compatibility mouse events, HTML drag) and keyboard are
 *    separate tracks: pointer-caused dispatches take the pointer's gesture
 *    (held, or released in this task), never a held key's; keyboard-caused
 *    dispatches take the key's. One touch contact's pointer,
 *    touch and compatibility mouse events share one gesture; HTML drag events
 *    carry the gesture the drag started in until dragend. Pointer and mouse
 *    movement with nothing held is a hover segment (a new one after each
 *    press); wheel joins that segment. Held state resets when the window
 *    loses focus or the page hides.
 *
 */
export function createUserEventModel(global) {
  const KINDS = {
    version: 2,
    // Classification only (D-G1-21 amended, RUN-3): a trusted event of a
    // listened kind dispatched in the document is recorded as a user event
    // unless its interface or kind is classified here as not user-caused;
    // unknown kinds and interfaces are user events (recorded per event).
    not_user_interfaces: ['AnimationEvent', 'BeforeUnloadEvent', 'CloseEvent', 'ContentVisibilityAutoStateChangeEvent', 'DeviceMotionEvent', 'DeviceOrientationEvent',
      'ErrorEvent', 'FormDataEvent', 'GamepadEvent', 'MediaEncryptedEvent', 'MessageEvent', 'PageRevealEvent', 'PageSwapEvent', 'PageTransitionEvent', 'ProgressEvent',
      'PromiseRejectionEvent', 'SecurityPolicyViolationEvent', 'StorageEvent', 'TrackEvent', 'TransitionEvent', 'WebGLContextEvent'],
    not_user_kinds: ['DOMContentLoaded', 'abort', 'appinstalled', 'beforeinstallprompt', 'canplay', 'canplaythrough', 'contextlost', 'contextrestored', 'cuechange',
      'durationchange', 'emptied', 'encrypted', 'ended', 'error', 'freeze', 'languagechange', 'load', 'loadeddata', 'loadedmetadata', 'loadend', 'loadstart', 'message',
      'messageerror', 'offline', 'online', 'open', 'pagehide', 'pagereveal', 'pageshow', 'pageswap', 'playing', 'prerenderingchange', 'progress', 'readystatechange',
      'rejectionhandled', 'resume', 'slotchange', 'stalled', 'suspend', 'timeout', 'timeupdate', 'unhandledrejection', 'unload', 'waiting', 'waitingforkey'],
    // Listening only: kinds the platform dispatches with no on* property.
    handlerless_kinds: ['DOMActivate', 'DOMFocusIn', 'DOMFocusOut', 'compositionend', 'compositionstart', 'compositionupdate', 'focusin', 'focusout', 'textInput',
      'touchcancel', 'touchend', 'touchmove', 'touchstart'],
    // Phase classification where no property decides.
    continuous_kinds: ['drag', 'dragenter', 'dragleave', 'dragover', 'resize', 'scroll', 'selectionchange'],
    // Boundary notifications never press or release a pointer.
    boundary_kinds: ['gotpointercapture', 'lostpointercapture', 'mouseenter', 'mouseleave', 'mouseout', 'mouseover', 'pointerenter', 'pointerleave', 'pointerout', 'pointerover'],
    episode_kinds: ['change', 'click', 'focusin', 'input', 'keydown', 'submit'],
  };
  const notUserKinds = new Set(KINDS.not_user_kinds), continuousNames = new Set(KINDS.continuous_kinds), boundary = new Set(KINDS.boundary_kinds);
  const ctors = new Map();
  const ctor = name => { if (ctors.has(name)) return ctors.get(name); let value = null; try { const found = global && global[name]; value = typeof found === 'function' ? found : null; } catch {} ctors.set(name, value); return value; };
  const instance = (event, name) => { const C = ctor(name); try { return Boolean(C && event instanceof C); } catch { return false; } };
  // Interface verdicts are per constructor (every event of one interface shares it): computed once.
  const verdicts = new Map();
  const FAMILIES = ['WheelEvent', 'DragEvent', 'PointerEvent', 'MouseEvent', 'TouchEvent', 'KeyboardEvent'];
  const verdictOf = event => {
    const key = event.constructor;
    let verdict = key ? verdicts.get(key) : undefined;
    if (!verdict) {
      verdict = { notUser: KINDS.not_user_interfaces.some(name => instance(event, name)), family: FAMILIES.find(name => instance(event, name)) || null, ui: instance(event, 'UIEvent') };
      if (key) verdicts.set(key, verdict);
    }
    return verdict;
  };
  // Rule 1: discovery. The prototype chains of HTMLElement (Element, Node,
  // EventTarget), Document and the window (Window.prototype and above), and
  // the window object itself.
  const discover = () => {
    const names = new Set(); const sources = []; const visited = new Set();
    for (const [label, start] of [['HTMLElement', ctor('HTMLElement')?.prototype], ['Document', ctor('Document')?.prototype], ['window', global]]) {
      let found = 0;
      for (let source = start, depth = 0; source && depth < 16; source = Object.getPrototypeOf(source), depth += 1) {
        if (visited.has(source)) continue; visited.add(source);
        let own = []; try { own = Object.getOwnPropertyNames(source); } catch {}
        for (const name of own) {
          if (name.length < 3 || !name.startsWith('on') || name !== name.toLowerCase()) continue;
          let descriptor = null; try { descriptor = Object.getOwnPropertyDescriptor(source, name); } catch {}
          if (!descriptor || typeof descriptor.set !== 'function') continue;
          if (!names.has(name.slice(2))) found += 1;
          names.add(name.slice(2));
        }
      }
      sources.push({ source: label, handlers: found });
    }
    const fromHandlers = names.size, supplemented = KINDS.handlerless_kinds.filter(name => !names.has(name));
    for (const name of supplemented) names.add(name);
    return { listened: [...names].sort(), on_handler_kinds: fromHandlers, supplemented, sources };
  };
  // Rule 2: a dispatch in the document (a node, the document or the window)
  // is a user event unless classified not user-caused. Events on other
  // targets (XMLHttpRequest, WebSocket, workers) are never user events.
  const inDocument = event => { try { const target = event.target; return target === global || Boolean(target && typeof target.nodeType === 'number'); } catch { return false; } };
  const notUser = event => notUserKinds.has(event.type) || verdictOf(event).notUser;
  const isUserEvent = event => Boolean(event && typeof event.type === 'string' && inDocument(event) && !notUser(event));
  const interfaceOf = event => { try { const name = event?.constructor?.name; return typeof name === 'string' && name ? name : null; } catch { return null; } };
  // Rules 3 and 4: phase and gesture. Pointer (mouse, pen, touch) and
  // keyboard are separate tracks.
  const createTracker = ({ nextId, defer }) => {
    const pointers = new Map(), keys = new Map(), held = [], trackOf = new Map(), recent = { pointer: null, key: null };
    let mouseButtons = 0, touchCount = 0, touchGesture = null, lastTouch = null, hover = null, cancelled = null, drag = null, lastReleased = null;
    const open = track => { const id = nextId(); held.push(id); trackOf.set(id, track); if (track === 'pointer') hover = null; return id; };
    const release = id => {
      const at = held.lastIndexOf(id); if (at >= 0) held.splice(at, 1);
      const track = trackOf.get(id) || 'pointer'; recent[track] = id; lastReleased = id;
      defer(() => { if (recent[track] === id) recent[track] = null; if (lastReleased === id) lastReleased = null; });
    };
    const heldOf = track => { for (let at = held.length - 1; at >= 0; at -= 1) if (trackOf.get(held[at]) === track) return held[at]; return null; };
    const latest = () => held[held.length - 1] || lastReleased || null;
    const pointerGesture = () => heldOf('pointer') || recent.pointer;
    // Pointer evidence is independent of event names. A generic activation
    // may be a UIEvent (rather than a MouseEvent); a selection event can fire
    // while the pointer is down. A keyboard activation has no pointer evidence.
    const pointerCause = event => {
      let fromTouch = false; try { fromTouch = event.sourceCapabilities?.firesTouchEvents === true; } catch {}
      if (fromTouch) return lastTouch || pointerGesture();
      if (heldOf('pointer')) return heldOf('pointer');
      if (verdictOf(event).ui && Number(event.detail) > 0) return pointerGesture();
      return null;
    };
    const hoverId = () => hover || (hover = nextId());
    const added = (now, before) => (now & ~before) !== 0, removed = (now, before) => (before & ~now) !== 0;
    const reset = () => { pointers.clear(); keys.clear(); held.length = 0; mouseButtons = 0; touchCount = 0; touchGesture = null; hover = null; drag = null; };
    return event => {
      const type = event.type, family = verdictOf(event).family;
      // The window losing focus or the page hiding ends every held gesture.
      if ((type === 'blur' && event.target === global) || (type === 'visibilitychange' && global.document?.visibilityState === 'hidden')) {
        const gesture = latest(); reset(); return { phase: 'discrete', gesture_id: gesture };
      }
      // Wheel: one segment per pointer segment, across the controls it passes over.
      if (family === 'WheelEvent') return { phase: 'continuous', gesture_id: heldOf('pointer') || hoverId(), segment: 'wheel' };
      if (family === 'DragEvent') {
        // HTML drag and drop: the gesture the drag started in (the browser
        // cancels the pointer when a native drag starts) until dragend.
        if (!drag) drag = heldOf('pointer') || cancelled || latest() || nextId();
        const gesture = drag; if (type === 'dragend') drag = null;
        return { phase: continuousNames.has(type) ? 'continuous' : 'discrete', gesture_id: gesture };
      }
      if (family === 'PointerEvent') {
        const id = event.pointerId; const state = pointers.get(id) || { buttons: 0, gesture: null };
        if (boundary.has(type)) {
          if (type === 'gotpointercapture' || type === 'lostpointercapture') return { phase: 'discrete', gesture_id: state.gesture || recent.pointer || null };
          return state.gesture ? { phase: 'continuous', gesture_id: state.gesture } : { phase: 'continuous', gesture_id: hoverId(), hover: true };
        }
        const buttons = Number(event.buttons) | 0;
        if (type === 'pointercancel') {
          const gesture = state.gesture; state.buttons = 0; state.gesture = null; pointers.set(id, state);
          if (gesture) { release(gesture); cancelled = gesture; }
          return { phase: 'release', gesture_id: gesture || recent.pointer };
        }
        if (added(buttons, state.buttons)) {
          if (!state.gesture) { cancelled = null; state.gesture = event.pointerType === 'touch' && touchGesture ? touchGesture : open('pointer'); }
          if (event.pointerType === 'touch') { if (!touchGesture) touchGesture = state.gesture; lastTouch = state.gesture; }
          state.buttons = buttons; pointers.set(id, state); return { phase: 'press', gesture_id: state.gesture };
        }
        if (removed(buttons, state.buttons)) {
          const gesture = state.gesture; state.buttons = buttons;
          if (!state.buttons && gesture) { release(gesture); state.gesture = null; }
          pointers.set(id, state); return { phase: 'release', gesture_id: gesture || recent.pointer };
        }
        if (event.button === -1) return state.gesture ? { phase: 'continuous', gesture_id: state.gesture } : { phase: 'continuous', gesture_id: hoverId(), hover: true };
        // click, auxclick, contextmenu: a real pointer's own gesture (held,
        // or released in this task); a keyboard-initiated activation (no
        // pointer type) is the key's.
        if (!event.pointerType) return { phase: 'activation', gesture_id: heldOf('key') || recent.key || latest() };
        return { phase: 'activation', gesture_id: state.gesture || pointerGesture() || (event.pointerType === 'touch' ? lastTouch : null) };
      }
      if (family === 'MouseEvent') {
        // Compatibility mouse events belong to the pointer track; those a touch
        // produced (sourceCapabilities.firesTouchEvents) to that touch's gesture.
        let fromTouch = false; try { fromTouch = event.sourceCapabilities?.firesTouchEvents === true; } catch {}
        const buttons = Number(event.buttons) | 0;
        if (fromTouch && lastTouch) {
          const phase = added(buttons, mouseButtons) ? 'press' : removed(buttons, mouseButtons) ? 'release' : Number(event.detail) > 0 ? 'activation' : 'continuous';
          mouseButtons = buttons; return { phase, gesture_id: lastTouch };
        }
        if (boundary.has(type)) return heldOf('pointer') ? { phase: 'continuous', gesture_id: heldOf('pointer') } : { phase: 'continuous', gesture_id: hoverId(), hover: true };
        if (added(buttons, mouseButtons)) { mouseButtons = buttons; return { phase: 'press', gesture_id: heldOf('pointer') || open('pointer') }; }
        if (removed(buttons, mouseButtons)) { mouseButtons = buttons; return { phase: 'release', gesture_id: pointerGesture() }; }
        if (Number(event.detail) > 0) return { phase: 'activation', gesture_id: pointerGesture() };
        return heldOf('pointer') ? { phase: 'continuous', gesture_id: heldOf('pointer') } : { phase: 'continuous', gesture_id: hoverId(), hover: true };
      }
      if (family === 'TouchEvent') {
        // One contact: its touch events share the gesture of its touch pointer.
        const count = Number(event.touches?.length) | 0;
        if (count > touchCount) { if (!touchGesture) touchGesture = heldOf('pointer') || open('pointer'); lastTouch = touchGesture; touchCount = count; return { phase: 'press', gesture_id: touchGesture }; }
        if (count < touchCount || type === 'touchcancel') {
          const gesture = touchGesture || recent.pointer; touchCount = count;
          if (!count) { if (gesture && held.includes(gesture)) release(gesture); touchGesture = null; }
          return { phase: 'release', gesture_id: gesture };
        }
        return { phase: 'continuous', gesture_id: touchGesture || heldOf('pointer') };
      }
      if (family === 'KeyboardEvent') {
        const code = String(event.code || event.key || '');
        if (type === 'keydown') {
          if (event.repeat && keys.has(code)) return { phase: 'continuous', gesture_id: keys.get(code) };
          const gesture = open('key'); keys.set(code, gesture); return { phase: 'press', gesture_id: gesture };
        }
        if (type === 'keyup') {
          const gesture = keys.get(code) || null; keys.delete(code);
          if (gesture) release(gesture);
          return { phase: 'release', gesture_id: gesture || recent.key };
        }
        return { phase: 'discrete', gesture_id: heldOf('key') || recent.key || latest() };
      }
        // A pointer-caused event outside the pointer/mouse interfaces still
        // belongs to that pointer, even while a modifier key is held.
        const pointer = pointerCause(event);
        return { phase: continuousNames.has(type) ? 'continuous' : 'discrete', gesture_id: pointer || latest() || hover || null };
    };
  };
  const isUI = event => verdictOf(event).ui;
  const familyOf = event => verdictOf(event).family;
  return { kinds: KINDS, discover, isUserEvent, notUser, isUI, familyOf, interfaceOf, createTracker };
}

/** The data both branches read (runtime and Node): the not-user classification, handler-less, continuous, boundary and episode kinds. */
export const USER_EVENT_KINDS = Object.freeze(createUserEventModel(null).kinds);

/**
 * The one source for which event kinds a page observed, from its
 * `capture.page` row (read by coverage `unobserved` and MCP `user_events`):
 *   - `listened`: the kinds the runtime listened for (`user_events.listened`,
 *     D-G1-21), else the kinds that start an action (`observes.events.recorded`,
 *     fix/honest-coverage), else the six a runtime before both listened for;
 *   - `unobserved`: kinds the browser exposes (the runtime's own enumeration,
 *     `observes.events.unobserved`, a lower bound) that are not listened; null
 *     when the page did not declare what the browser exposes.
 */
export function observedEventKinds(capturePage) {
  if (capturePage?.kind !== 'capture.page') return null;
  const events = capturePage.observes?.events || null;
  const fromUserEvents = Array.isArray(capturePage.user_events?.listened) ? capturePage.user_events.listened.map(String) : null;
  const listened = fromUserEvents || (Array.isArray(events?.recorded) ? events.recorded.map(String) : ['change', 'click', 'focusin', 'input', 'keydown', 'submit']);
  const set = new Set(listened);
  const unobserved = Array.isArray(events?.unobserved) ? events.unobserved.map(String).filter(name => !set.has(name)) : null;
  return { listened: [...listened], unobserved, lower_bound: events ? events.lower_bound !== false : null, exposed_total: events?.exposed_total ?? null,
    legacy: !fromUserEvents && !events, model_version: capturePage.user_events?.model_version ?? null };
}
