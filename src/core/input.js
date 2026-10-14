import { InputState } from './input-state.js';

export const input = new InputState();

export function isControlTarget(target) {
  return Boolean(target?.closest?.('#scenery-builder, #audio-controls, input, textarea, select, button, summary, [contenteditable="true"]'));
}

export function clearInput() {
  input.clear();
}

window.addEventListener('keydown', (e) => {
  if (isControlTarget(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
  input.keyDown(e.code, e.repeat);
});
window.addEventListener('keyup', (e) => input.keyUp(e.code));
window.addEventListener('blur', clearInput);
globalThis.document?.addEventListener('visibilitychange', () => { if (document.hidden) clearInput(); });

export const wasTapped = (...codes) => input.wasTapped(...codes);
export const isDown = (...codes) => input.isDown(...codes);
export const moveAxis = () => input.moveAxis();
