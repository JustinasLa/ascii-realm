import { InputState } from './input-state.js';

export const input = new InputState();
window.addEventListener('keydown', (e) => {
  if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
  input.keyDown(e.code, e.repeat);
});
window.addEventListener('keyup', (e) => input.keyUp(e.code));
window.addEventListener('blur', () => input.clear());
document.addEventListener('visibilitychange', () => { if (document.hidden) input.clear(); });

export const wasTapped = (...codes) => input.wasTapped(...codes);
export const isDown = (...codes) => input.isDown(...codes);
export const moveAxis = () => input.moveAxis();
