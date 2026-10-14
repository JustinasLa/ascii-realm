import { InputState } from './input-state.js';

export const input = new InputState();
let gameplayBlocked = false;

// Panels, form fields and buttons keep their own keys.
const CONTROLS = '#scenery-builder, #audio-controls, #weather-panel, #inventory-root, input, textarea, select, button, summary, '
  + 'a[href], [role="button"], [role="link"], [role="textbox"], [contenteditable="true"], [data-game-ui]';

export function isControlTarget(target) {
  const element = target?.nodeType === 3 ? target.parentElement : target;
  return Boolean(element?.isContentEditable
    || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'SUMMARY'].includes(element?.tagName?.toUpperCase?.())
    || element?.closest?.(CONTROLS));
}

// Includes controls inside shadow roots and nested labels.
function isControlEvent(event) {
  return isControlTarget(event.target) || Boolean(event.composedPath?.().some(isControlTarget));
}

export function clearInput() {
  input.clear();
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
  if (gameplayBlocked || e.defaultPrevented || !e.code) return;
  if (isControlEvent(e) || e.ctrlKey || e.metaKey || e.altKey) return;
  // Auto-repeat can continue after a modal closes or the window regains
  // focus; it must not revive a key that was cleared meanwhile.
  if (e.repeat && !input.held.has(e.code)) return;
  if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
  input.keyDown(e.code, e.repeat || input.held.has(e.code));
});
// Always accept releases, including events consumed by a UI control.
window.addEventListener('keyup', (e) => input.keyUp(e.code));
window.addEventListener('blur', clearInput);
window.addEventListener('focusout', clearInput);
window.addEventListener('focusin', (e) => {
  if (isControlEvent(e)) clearInput();
});
globalThis.document?.addEventListener('visibilitychange', () => { if (document.hidden) clearInput(); });

export const wasTapped = (...codes) => !gameplayBlocked && input.wasTapped(...codes);
export const isDown = (...codes) => !gameplayBlocked && input.isDown(...codes);
export const moveAxis = () => gameplayBlocked ? { x: 0, y: 0 } : input.moveAxis();

// The lobby panel's name for the same test.
export const isUiTarget = isControlTarget;
