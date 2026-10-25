import { input } from './input.js';
import { InteractButton } from './interact.js';

// A press on CAST shorter than this casts the bound rune; a longer one opens
// the rune wheel on the same finger instead, and never casts.
export const CAST_HOLD_MS = 300;
// The button shows that the wheel is coming after this long.
export const CAST_HINT_MS = 150;

// The stick, the thumb cluster (STRIKE, JUMP, CAST and the contextual
// INTERACT) and the tablet zoom buttons. STRIKE, CAST and INTERACT press
// input codes no keyboard sends, so the game can tell them from J, R and E.
export function installTouchControls(zoomBy) {
  const root = document.getElementById('touch-controls');
  const pad = document.getElementById('move-pad');
  const stick = document.getElementById('move-stick');
  let pointer = null;
  let centerX = 0;
  let centerY = 0;
  let radius = 1;

  function resetStick() {
    pointer = null;
    input.setMove(0, 0);
    stick.style.transform = 'translate(0px, 0px)';
    pad.classList.remove('running');
  }

  function move(e) {
    if (e.pointerId !== pointer) return;
    const dx = (e.clientX - centerX) / radius;
    const dy = (e.clientY - centerY) / radius;
    const distance = Math.hypot(dx, dy);
    const scale = Math.max(1, distance);
    const x = dx / scale;
    const y = dy / scale;
    const running = distance > 0.82;
    input.setMove(distance < 0.16 ? 0 : x, distance < 0.16 ? 0 : y, running);
    stick.style.transform = `translate(${x * radius}px, ${y * radius}px)`;
    pad.classList.toggle('running', running);
  }

  pad.addEventListener('pointerdown', (e) => {
    if (pointer !== null || e.button !== 0) return;
    e.preventDefault();
    // A panel's focused control blocks movement. Touching the joystick
    // returns to the scene before setting a fresh movement axis.
    document.getElementById('screen')?.focus({ preventScroll: true });
    pointer = e.pointerId;
    const rect = pad.getBoundingClientRect();
    centerX = rect.left + rect.width / 2;
    centerY = rect.top + rect.height / 2;
    radius = rect.width * 0.34;
    pad.setPointerCapture(pointer);
    move(e);
  });
  pad.addEventListener('pointermove', move);
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    pad.addEventListener(type, (e) => { if (e.pointerId === pointer) resetStick(); });
  }

  for (const button of root.querySelectorAll('[data-key]')) {
    const pointers = new Set();
    const release = (e) => {
      pointers.delete(e.pointerId);
      input.releasePointer(e.pointerId);
      button.classList.toggle('pressed', pointers.size > 0);
    };
    button.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      pointers.add(e.pointerId);
      input.pressPointer(e.pointerId, button.dataset.key);
      button.classList.add('pressed');
      button.setPointerCapture(e.pointerId);
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(type, release);
    button.addEventListener('click', (e) => { if (e.detail === 0) input.tapped.add(button.dataset.key); });
    const clear = () => { pointers.clear(); button.classList.remove('pressed'); };
    window.addEventListener('blur', clear);
    window.addEventListener('resize', clear);
    document.addEventListener('visibilitychange', () => { if (document.hidden) clear(); });
  }
  const cast = castButton(document.getElementById('touch-cast'));
  for (const button of root.querySelectorAll('[data-zoom]')) {
    button.addEventListener('click', () => zoomBy(Number(button.dataset.zoom)));
  }
  const reset = () => { resetStick(); input.clear(); };
  window.addEventListener('blur', reset);
  window.addEventListener('resize', reset);
  document.addEventListener('visibilitychange', () => { if (document.hidden) reset(); });
  root.addEventListener('contextmenu', (e) => e.preventDefault());
  return { setCastHold: cast.setHold, interact: new InteractButton(document.getElementById('touch-interact')) };
}

// CAST: a tap casts on release; holding it hands the finger to the rune
// wheel through `hold(pointerId, isTap)`. Whether a press was a tap is read
// from the events' own times, so a busy frame that delays the lift (and lets
// the wheel open) still casts a quick tap; `isTap` lets the wheel close on
// that lift without choosing anything. Losing the finger after the wheel has
// it calls `drop(pointerId)`, which puts the wheel away.
function castButton(button) {
  let hold = () => false;
  let drop = () => {};
  let pointer = null;
  let downAt = 0;
  let timer = null;
  let hint = null;
  const isTap = (e) => e.timeStamp - downAt < CAST_HOLD_MS;
  const reset = () => {
    clearTimeout(timer);
    clearTimeout(hint);
    timer = hint = pointer = null;
    button.classList.remove('pressed', 'holding');
  };
  button.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || pointer !== null) return;
    e.preventDefault();
    pointer = e.pointerId;
    downAt = e.timeStamp;
    button.classList.add('pressed');
    button.setPointerCapture(pointer);
    hint = setTimeout(() => button.classList.add('holding'), CAST_HINT_MS);
    timer = setTimeout(() => {
      timer = null;
      hold(pointer, isTap);
    }, CAST_HOLD_MS);
  });
  button.addEventListener('pointerup', (e) => {
    if (e.pointerId !== pointer) return;
    if (isTap(e)) input.tapped.add('TouchCast');
    reset();
  });
  for (const type of ['pointercancel', 'lostpointercapture']) {
    button.addEventListener(type, (e) => {
      if (e.pointerId !== pointer) return;
      if (timer === null) drop(pointer);
      reset();
    });
  }
  button.addEventListener('click', (e) => { if (e.detail === 0) input.tapped.add('TouchCast'); });
  window.addEventListener('blur', reset);
  window.addEventListener('resize', reset);
  document.addEventListener('visibilitychange', () => { if (document.hidden) reset(); });
  return { setHold: (open, cancel = () => {}) => { hold = open; drop = cancel; } };
}
