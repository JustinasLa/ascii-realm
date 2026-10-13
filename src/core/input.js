// Tracks which keys are held, by physical key code so WASD works on any layout.
const held = new Set();
// Keys pressed since the game last asked, so a quick tap is never missed.
const tapped = new Set();
const inputWindow = window;
const inputDocument = inputWindow.document ?? globalThis.document;
let gameplayBlocked = false;

// Controls and their descendants keep their normal keyboard behavior. Panel
// keys must never become actions queued for the scene after a panel closes.
export function isGameplayTarget(target) {
  return !target?.isContentEditable
    && !target?.closest?.('button, select, input, textarea, a[href], summary, [contenteditable], [data-game-ui]');
}

export function clearInput() {
  held.clear();
  tapped.clear();
}

export function setGameplayBlocked(blocked) {
  gameplayBlocked = Boolean(blocked);
  clearInput();
}

export function isGameplayBlocked() {
  return gameplayBlocked || !!inputDocument?.hidden
    || !isGameplayTarget(inputDocument?.activeElement);
}

inputWindow.addEventListener('keydown', (e) => {
  if (e.defaultPrevented || isGameplayBlocked() || !isGameplayTarget(e.target)) return;
  // A key held through a menu, blur, or focus change must be released and
  // pressed again. Auto-repeat cannot restore a key that was cleared.
  if (e.repeat && !held.has(e.code)) return;
  if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
  if (!e.repeat) tapped.add(e.code);
  held.add(e.code);
});
inputWindow.addEventListener('keyup', (e) => held.delete(e.code));
inputWindow.addEventListener('blur', clearInput);

inputDocument?.addEventListener('focusin', (e) => {
  if (!isGameplayTarget(e.target)) clearInput();
});
inputDocument?.addEventListener('visibilitychange', clearInput);

// True once for each press of any of the keys.
export function wasTapped(...codes) {
  if (isGameplayBlocked()) return false;
  let hit = false;
  for (const c of codes) hit = tapped.delete(c) || hit;
  return hit;
}

export function isDown(...codes) {
  if (isGameplayBlocked()) return false;
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
