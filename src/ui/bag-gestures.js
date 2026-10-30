// A touch held this long without moving is a hold.
export const HOLD_MS = 450;
// How far a touch may wander, in px, before it is a scroll.
export const TOUCH_SLOP = 10;
// How far a pressed mouse moves, in px, before it drags.
export const MOUSE_SLOP = 4;

/**
 * Tap, hold and drag on bag cards and doll boxes, for mouse, pen and touch.
 * A tap or click stays a native click. A touch or pen held still calls
 * `onHold(selection, rect)`; held, then moved, it drags, as a pressed mouse
 * does once it moves. A drag calls `onDragStart(selection, point)`, then
 * `onDragMove(point, element)` per move and `onDrop(selection, element)` on
 * the lift, where `element` is under the point (`hitTest`), and always ends
 * with `onDragEnd()`. A hold or drag swallows the click its lift sends, on
 * `swallowOn`, which holds whatever it shows under the finger.
 * `sourceOf(target)` gives `{ selection, node }` for a filled card or box, else null.
 */
export class BagGestures {
  constructor({ surface, sourceOf, onHold, onDragStart, onDragMove, onDrop, onDragEnd, swallowOn = surface,
    hitTest = (x, y) => document.elementFromPoint(x, y), timers = globalThis }) {
    Object.assign(this, { surface, sourceOf, onHold, onDragStart, onDragMove, onDrop, onDragEnd, swallowOn, hitTest,
      timers, _press: null, _held: false, _dragging: false, _swallow: false });
    this._listeners = {
      pointerdown: (event) => this._down(event),
      pointermove: (event) => this._move(event),
      pointerup: (event) => this._up(event),
      // A cancelled touch sends no click to swallow.
      pointercancel: () => { this._swallow = false; this.cancel(); },
      // While held or dragging, the finger must not scroll the sheet.
      touchmove: (event) => { if (this.active) event.preventDefault(); },
    };
    // A click that never came after the last hold or drag must not eat the
    // next press anywhere on `swallowOn`, a pinned panel's buttons too.
    this._unswallow = () => { if (!this.active) this._swallow = false; };
    this._click = (event) => {
      if (!this._swallow) return;
      this._swallow = false;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    for (const [type, listener] of Object.entries(this._listeners)) surface.addEventListener(type, listener, { passive: false });
    swallowOn.addEventListener('click', this._click, true);
    swallowOn.addEventListener('pointerdown', this._unswallow, true);
  }

  // Held or dragging: touchmove is cancelled and the next click swallowed.
  get active() { return this._held || this._dragging; }
  get dragging() { return this._dragging; }

  _down(event) {
    // A second finger never ends a drag.
    if (this._dragging) return;
    this._swallow = false;
    this.cancel();
    const { pointerType, isPrimary, button } = event;
    const source = isPrimary !== false && !(button > 0) && this.sourceOf(event.target);
    if (!source) return;
    const mouse = pointerType === 'mouse';
    this._press = { id: event.pointerId, x: event.clientX, y: event.clientY, t: event.timeStamp, source, mouse,
      timer: mouse ? null : this.timers.setTimeout(() => this._hold(), HOLD_MS) };
  }

  _move({ pointerId, clientX: x, clientY: y }) {
    const press = this._press;
    if (!press || press.id !== pointerId) return;
    const point = { x, y, touch: !press.mouse };
    if (this._dragging) {
      this.onDragMove(point, this.hitTest(x, y));
      return;
    }
    if (Math.hypot(x - press.x, y - press.y) <= (press.mouse ? MOUSE_SLOP : TOUCH_SLOP)) return;
    // A touch that moves before its hold is a scroll.
    if (!press.mouse && !this._held) {
      this.cancel();
      return;
    }
    this.timers.clearTimeout(press.timer);
    this._held = false;
    this._dragging = this._swallow = true;
    if (press.mouse) this.surface.setPointerCapture?.(pointerId);
    this.onDragStart(press.source.selection, point);
    this.onDragMove(point, this.hitTest(x, y));
  }

  _up({ pointerId, clientX, clientY, timeStamp }) {
    const press = this._press;
    if (this._dragging && press.id !== pointerId) return;
    if (this._dragging) this.onDrop(press.source.selection, this.hitTest(clientX, clientY));
    // A busy page may run the lift before the timer: a long press is a hold all the same.
    else if (press && !press.mouse && !this._held && timeStamp - press.t >= HOLD_MS) this._hold();
    this.cancel();
  }

  _hold() {
    this.timers.clearTimeout(this._press.timer);
    this._held = this._swallow = true;
    this.onHold(this._press.source.selection, this._press.source.node.getBoundingClientRect());
  }

  // Drops any press, hold or drag (a lift, a scroll, Esc, closing the window).
  cancel() {
    if (this._press) this.timers.clearTimeout(this._press.timer);
    const dragging = this._dragging;
    this._press = null;
    this._held = this._dragging = false;
    if (dragging) this.onDragEnd();
  }

  destroy() {
    this.cancel();
    for (const [type, listener] of Object.entries(this._listeners)) this.surface.removeEventListener(type, listener);
    this.swallowOn.removeEventListener('click', this._click, true);
    this.swallowOn.removeEventListener('pointerdown', this._unswallow, true);
  }
}
