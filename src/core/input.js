// Tracks which keys are held, by physical key code so WASD works on any layout.
const held = new Set();
// Keys pressed since the game last asked, so a quick tap is never missed.
const tapped = new Set();
const released = new Set();
const scenePointers = new Set();
let cancelled = false;

// Native controls keep their normal keyboard behavior. A key pressed while
// choosing equipment must never become a queued action in the world.
export function isGameplayTarget(target) {
  return !target?.closest?.('button, select, input, textarea, [contenteditable], [data-game-ui]');
}

function cancelInput() {
  held.clear();
  tapped.clear();
  released.clear();
  scenePointers.clear();
  cancelled = true;
}

function press(code) {
  if (!held.has(code)) tapped.add(code);
  held.add(code);
}

function release(code) {
  if (held.delete(code)) released.add(code);
}

window.addEventListener('keydown', (e) => {
  if (!isGameplayTarget(e.target)) return;
  if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
  if (!e.repeat) tapped.add(e.code);
  held.add(e.code);
});
window.addEventListener('keyup', (e) => release(e.code));
window.addEventListener('blur', cancelInput);

const mouseCode = (button) => button === 0 ? 'MouseLeft' : button === 2 ? 'MouseRight' : null;
const pointerKey = (event) => event.pointerId ?? 'mouse';
function syncMouseButtons(buttons) {
  if (buttons & 1) press('MouseLeft');
  else release('MouseLeft');
  if (buttons & 2) press('MouseRight');
  else release('MouseRight');
}
window.addEventListener('pointerdown', (e) => {
  if (e.target?.id !== 'screen' || e.isPrimary === false) return;
  const code = mouseCode(e.button);
  if (!code) return;
  e.target.focus?.({ preventScroll: true });
  if (e.button === 2) e.preventDefault();
  scenePointers.add(pointerKey(e));
  if (typeof e.buttons === 'number') syncMouseButtons(e.buttons);
  else press(code);
  if (e.pointerId !== undefined) e.target.setPointerCapture?.(e.pointerId);
});
window.addEventListener('pointermove', (e) => {
  // Pointer events use pointermove for pressing or releasing another button
  // while a mouse button is already held. Only track gestures begun on scene.
  if (scenePointers.has(pointerKey(e)) && typeof e.buttons === 'number') syncMouseButtons(e.buttons);
});
window.addEventListener('pointerup', (e) => {
  if (scenePointers.has(pointerKey(e)) && typeof e.buttons === 'number') syncMouseButtons(e.buttons);
  const code = mouseCode(e.button);
  if (code) release(code);
  if (!e.buttons) scenePointers.delete(pointerKey(e));
});
window.addEventListener('pointercancel', cancelInput);
window.addEventListener('contextmenu', (e) => {
  if (e.target?.id === 'screen') e.preventDefault();
});
document.addEventListener('focusin', (e) => {
  if (!isGameplayTarget(e.target)) cancelInput();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) cancelInput();
});

// True once for each press of any of the keys.
export function wasTapped(...codes) {
  let hit = false;
  for (const c of codes) hit = tapped.delete(c) || hit;
  return hit;
}

export function isDown(...codes) {
  return codes.some((c) => held.has(c));
}

export function wasReleased(...codes) {
  let hit = false;
  for (const code of codes) hit = released.delete(code) || hit;
  return hit;
}

// Cancelling a charge on blur or while focusing a control is different from
// deliberately releasing it: a cancelled bow draw must not fire an arrow.
export function wasCancelled() {
  const result = cancelled;
  cancelled = false;
  return result;
}

// Returns the requested movement as a vector with components in -1..1.
export function moveAxis() {
  let x = 0;
  let y = 0;
  if (isDown('KeyA', 'ArrowLeft')) x -= 1;
  if (isDown('KeyD', 'ArrowRight')) x += 1;
  if (isDown('KeyW', 'ArrowUp')) y -= 1;
  if (isDown('KeyS', 'ArrowDown')) y += 1;
  return { x, y };
}
