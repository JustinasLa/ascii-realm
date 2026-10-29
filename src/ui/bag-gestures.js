// A touch held this long without moving is a hold.
export const HOLD_MS = 450;
// How far a touch may wander, in px, before it is a scroll.
export const TOUCH_SLOP = 10;

/**
 * Tap and hold on bag cards and doll boxes, for touch and pen. A tap stays a
 * native click; a hold calls `onHold(selection, rect)` and swallows the click
 * its lift sends, on `swallowOn`, which holds whatever the hold shows under
 * the finger. Mice are left to click, right-click and drag.
 * `sourceOf(target)` gives `{ selection, node }` for a filled card or box, else null.
 */
export class BagGestures {
  constructor({ surface, sourceOf, onHold, swallowOn = surface, timers = globalThis }) {
    Object.assign(this, { surface, sourceOf, onHold, swallowOn, timers, _press: null, _held: false, _swallow: false });
    this._listeners = {
      pointerdown: (event) => this._down(event),
      pointermove: ({ pointerId, clientX, clientY }) => {
        const press = this._press;
        if (press && press.id === pointerId && Math.hypot(clientX - press.x, clientY - press.y) > TOUCH_SLOP) this.cancel();
      },
      // A busy page may run the lift before the timer: a long press is a hold all the same.
      pointerup: ({ timeStamp }) => {
        if (this._press && !this._held && timeStamp - this._press.t >= HOLD_MS) this._hold();
        this.cancel();
      },
      pointercancel: () => this.cancel(),
      // While held, the finger must not scroll the sheet under the panel.
      touchmove: (event) => { if (this._held) event.preventDefault(); },
    };
    this._click = (event) => {
      if (!this._swallow) return;
      this._swallow = false;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    for (const [type, listener] of Object.entries(this._listeners)) surface.addEventListener(type, listener, { passive: false });
    swallowOn.addEventListener('click', this._click, true);
  }

  // Held: touchmove is cancelled and the next click swallowed.
  get active() { return this._held; }

  _down(event) {
    // A click that never came after the last hold must not eat this tap.
    this._swallow = false;
    this.cancel();
    const { pointerType, isPrimary, button } = event;
    const source = pointerType !== 'mouse' && isPrimary !== false && !(button > 0) && this.sourceOf(event.target);
    if (!source) return;
    this._press = { id: event.pointerId, x: event.clientX, y: event.clientY, t: event.timeStamp, source,
      timer: this.timers.setTimeout(() => this._hold(), HOLD_MS) };
  }

  _hold() {
    this.timers.clearTimeout(this._press.timer);
    this._held = this._swallow = true;
    this.onHold(this._press.source.selection, this._press.source.node.getBoundingClientRect());
  }

  // Drops any press or hold (a lift, a scroll, closing the window).
  cancel() {
    if (this._press) this.timers.clearTimeout(this._press.timer);
    this._press = null;
    this._held = false;
  }

  destroy() {
    this.cancel();
    for (const [type, listener] of Object.entries(this._listeners)) this.surface.removeEventListener(type, listener);
    this.swallowOn.removeEventListener('click', this._click, true);
  }
}
