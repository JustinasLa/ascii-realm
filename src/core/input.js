// Tracks which keys are held, by physical key code so WASD works on any layout.
const held = new Set();
// Keys pressed since the game last asked, so a quick tap is never missed.
const tapped = new Set();
let gameplayBlocked = false;

function isInteractiveTarget(target) {
  const element = target?.nodeType === 3 ? target.parentElement : target;
  return Boolean(element?.isContentEditable
    || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'SUMMARY'].includes(element?.tagName?.toUpperCase())
    || element?.closest?.('input, textarea, select, button, a[href], summary, [role="button"], [role="link"], [role="textbox"]'));
}

function isInteractiveEvent(event) {
  return isInteractiveTarget(event.target)
    || Boolean(event.composedPath?.().some(isInteractiveTarget));
}

export function clearInput() {
  held.clear();
  tapped.clear();
}

// Opening or closing a modal requires fresh gameplay presses afterward.
export function setGameplayBlocked(blocked) {
  const next = Boolean(blocked);
  if (gameplayBlocked === next) return;
  gameplayBlocked = next;
  clearInput();
}

export function isGameplayBlocked() {
  return gameplayBlocked;
}

window.addEventListener('keydown', (e) => {
  if (gameplayBlocked || e.defaultPrevented || isInteractiveEvent(e) || !e.code) return;
  // Auto-repeat can continue after a modal closes or the window regains focus.
  // It must not revive a key that was cleared while gameplay was unavailable.
  if (e.repeat && !held.has(e.code)) return;
  if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
  if (!e.repeat && !held.has(e.code)) tapped.add(e.code);
  held.add(e.code);
});
// Always accept releases, including events consumed by a UI control.
window.addEventListener('keyup', (e) => held.delete(e.code));
window.addEventListener('blur', clearInput);
window.addEventListener('focusout', clearInput);
window.addEventListener('focusin', (e) => {
  if (isInteractiveEvent(e)) clearInput();
});
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clearInput();
  });
}

// True once for each press of any of the keys.
export function wasTapped(...codes) {
  if (gameplayBlocked) return false;
  let hit = false;
  for (const c of codes) hit = tapped.delete(c) || hit;
  return hit;
}

export function isDown(...codes) {
  if (gameplayBlocked) return false;
  return codes.some((c) => held.has(c));
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
