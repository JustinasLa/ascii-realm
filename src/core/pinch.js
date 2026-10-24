// Two fingers on the scene zoom it, replacing the − / + buttons on phones.
// Joystick and action buttons capture their own pointers, so their touches
// never reach the canvas and walking can't turn into a pinch.

const MIN_STEP = 0.8;
const MAX_STEP = 1.25;
// Fingers this close together give a jumpy ratio, so they don't zoom.
const MIN_DISTANCE = 8;

// The zoom change for one pinch event: the ratio of finger distances, clamped
// so a dropped frame can't jump the view.
export function pinchFactor(previous, distance) {
  if (!(previous >= MIN_DISTANCE) || !(distance >= MIN_DISTANCE)) return 1;
  return Math.max(MIN_STEP, Math.min(MAX_STEP, distance / previous));
}

export function installPinchZoom(surface, zoomBy, { win = window, doc = document } = {}) {
  const fingers = new Map();
  let spread = 0;
  const distance = () => {
    const [a, b] = fingers.values();
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  // A new pair starts from its own distance rather than the last pair's.
  const restart = () => { spread = fingers.size === 2 ? distance() : 0; };
  const reset = () => {
    fingers.clear();
    spread = 0;
  };
  const down = (event) => {
    if (event.pointerType !== 'touch') return;
    fingers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    restart();
  };
  const move = (event) => {
    const finger = fingers.get(event.pointerId);
    if (!finger) return;
    finger.x = event.clientX;
    finger.y = event.clientY;
    if (fingers.size !== 2) return;
    const next = distance();
    const factor = pinchFactor(spread, next);
    spread = next;
    if (factor !== 1) zoomBy(factor);
  };
  const up = (event) => {
    if (!fingers.delete(event.pointerId)) return;
    restart();
  };
  const hidden = () => { if (doc.hidden) reset(); };
  surface.addEventListener('pointerdown', down);
  surface.addEventListener('pointermove', move);
  surface.addEventListener('pointerup', up);
  surface.addEventListener('pointercancel', reset);
  win.addEventListener('blur', reset);
  doc.addEventListener('visibilitychange', hidden);
  return {
    get fingers() { return fingers.size; },
    dispose() {
      surface.removeEventListener('pointerdown', down);
      surface.removeEventListener('pointermove', move);
      surface.removeEventListener('pointerup', up);
      surface.removeEventListener('pointercancel', reset);
      win.removeEventListener('blur', reset);
      doc.removeEventListener('visibilitychange', hidden);
    },
  };
}
